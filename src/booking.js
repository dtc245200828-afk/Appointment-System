'use strict';

const db = require('./db');
const config = require('./config');
const logger = require('./logger');
const { ApiError } = require('./errors');
const metrics = require('./metrics');

const ACTIVE_STATUSES = ['pending', 'confirmed'];
const ALL_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'];

const APPOINTMENT_SELECT = `
  SELECT a.id,
         a.user_id,
         a.slot_id,
         a.status,
         a.note,
         a.created_at,
         a.updated_at,
         a.confirmed_at,
         a.cancelled_at,
         a.cancel_reason,
         ts.start_time,
         ts.end_time,
         ts.status AS slot_status,
         sv.id AS service_id,
         sv.name AS service_name,
         sv.duration_minutes,
         sv.price,
         u.full_name AS user_full_name,
         u.email AS user_email,
         u.phone AS user_phone
    FROM appointments a
    JOIN time_slots ts ON ts.id = a.slot_id
    JOIN services sv ON sv.id = ts.service_id
    JOIN users u ON u.id = a.user_id
`;

function serializeAppointment(row, { includeUser = false } = {}) {
  if (!row) return null;
  const appointment = {
    id: row.id,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    slot: {
      id: row.slot_id,
      serviceId: row.service_id,
      serviceName: row.service_name,
      durationMinutes: row.duration_minutes,
      price: Number(row.price),
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.slot_status,
    },
  };
  if (includeUser) {
    appointment.user = {
      id: row.user_id,
      fullName: row.user_full_name,
      email: row.user_email,
      phone: row.user_phone,
    };
  }
  return appointment;
}

/**
 * Đặt lịch hẹn.
 *
 * Chống đặt trùng khi có nhiều request đồng thời bằng 3 lớp:
 *  1. PostgreSQL transaction + `SELECT ... FOR UPDATE` khoá row khung giờ.
 *  2. Kiểm tra lại trạng thái khung giờ + lịch hẹn đang hoạt động trong transaction.
 *  3. Ràng buộc DB: partial unique index `appointments_one_active_per_slot`
 *     và trigger `trg_appointments_slot_must_be_available`.
 */
async function createAppointment({ userId, slotId, note = null }) {
  try {
    const result = await db.withTransaction(async (client) => {
      // (1) Khoá row khung giờ để các request đồng thời phải xếp hàng.
      const slotResult = await client.query(
        `SELECT ts.id, ts.service_id, ts.start_time, ts.end_time, ts.status, sv.name AS service_name
           FROM time_slots ts
           JOIN services sv ON sv.id = ts.service_id
          WHERE ts.id = $1
          FOR UPDATE OF ts`,
        [slotId]
      );
      const slot = slotResult.rows[0];
      if (!slot) {
        throw ApiError.notFound('SLOT_NOT_FOUND', 'Khung giờ không tồn tại.');
      }
      if (slot.status !== 'available') {
        throw ApiError.conflict('SLOT_UNAVAILABLE', 'Khung giờ này đã được đặt hoặc đã bị khoá.');
      }
      if (new Date(slot.start_time).getTime() <= Date.now()) {
        throw ApiError.conflict('SLOT_IN_PAST', 'Khung giờ đã qua, vui lòng chọn khung giờ khác.');
      }

      // (2) Lớp kiểm tra thứ hai (row lock đã đảm bảo tính tuần tự).
      const existing = await client.query(
        `SELECT 1 FROM appointments
          WHERE slot_id = $1 AND status IN ('pending','confirmed')
          LIMIT 1`,
        [slotId]
      );
      if (existing.rowCount > 0) {
        throw ApiError.conflict('SLOT_UNAVAILABLE', 'Khung giờ này vừa được người khác đặt.');
      }

      const activeCount = await client.query(
        `SELECT count(*)::int AS total
           FROM appointments
          WHERE user_id = $1 AND status IN ('pending','confirmed')`,
        [userId]
      );
      if (activeCount.rows[0].total >= config.maxActiveAppointmentsPerUser) {
        throw ApiError.conflict(
          'TOO_MANY_ACTIVE_APPOINTMENTS',
          `Bạn đang có ${activeCount.rows[0].total} lịch hẹn chưa hoàn tất. Vui lòng huỷ bớt trước khi đặt thêm.`
        );
      }

      // (3) INSERT - partial unique index là chốt chặn cuối cùng ở tầng DB.
      const inserted = await client.query(
        `INSERT INTO appointments (user_id, slot_id, status, note)
         VALUES ($1, $2, 'pending', $3)
         RETURNING id`,
        [userId, slotId, note]
      );

      const slotUpdated = await client.query(
        `UPDATE time_slots
            SET status = 'booked', updated_at = now()
          WHERE id = $1 AND status = 'available'
          RETURNING id`,
        [slotId]
      );
      if (slotUpdated.rowCount !== 1) {
        throw ApiError.conflict('SLOT_UNAVAILABLE', 'Khung giờ này vừa được người khác đặt.');
      }

      const detail = await client.query(`${APPOINTMENT_SELECT} WHERE a.id = $1`, [inserted.rows[0].id]);
      return detail.rows[0];
    });

    metrics.appointmentsCreatedTotal.inc();
    logger.info(
      { appointmentId: result.id, userId, slotId, serviceId: result.service_id },
      'Đặt lịch hẹn thành công'
    );
    return serializeAppointment(result);
  } catch (error) {
    // Chỉ đếm xung đột thật sự (khung giờ đã bị đặt) để vẽ dashboard nghiệp vụ.
    if (error.code === 'SLOT_UNAVAILABLE' || error.code === '23505' || error.code === 'P0001') {
      metrics.bookingConflictsTotal.inc();
    }
    throw error;
  }
}

/**
 * Huỷ lịch hẹn (chủ lịch hẹn hoặc admin) và giải phóng khung giờ trong cùng transaction.
 * Thứ tự khoá: time_slots -> appointments (thống nhất với createAppointment) để giảm deadlock.
 */
async function cancelAppointment({ appointmentId, actor, reason = null }) {
  const result = await db.withTransaction(async (client) => {
    const preview = await client.query('SELECT id, slot_id FROM appointments WHERE id = $1', [appointmentId]);
    if (!preview.rows[0]) {
      throw ApiError.notFound('APPOINTMENT_NOT_FOUND', 'Lịch hẹn không tồn tại.');
    }

    // Khoá khung giờ trước, sau đó mới khoá lịch hẹn.
    await client.query('SELECT id FROM time_slots WHERE id = $1 FOR UPDATE', [preview.rows[0].slot_id]);

    const locked = await client.query(
      `SELECT a.id, a.user_id, a.slot_id, a.status, ts.start_time
         FROM appointments a
         JOIN time_slots ts ON ts.id = a.slot_id
        WHERE a.id = $1
        FOR UPDATE OF a`,
      [appointmentId]
    );
    const appointment = locked.rows[0];
    if (!appointment) {
      throw ApiError.notFound('APPOINTMENT_NOT_FOUND', 'Lịch hẹn không tồn tại.');
    }

    const isOwner = appointment.user_id === actor.id;
    const isAdmin = actor.role === 'admin';
    if (!isOwner && !isAdmin) {
      throw ApiError.forbidden('FORBIDDEN', 'Bạn không có quyền huỷ lịch hẹn này.');
    }
    if (appointment.status === 'cancelled') {
      throw ApiError.conflict('ALREADY_CANCELLED', 'Lịch hẹn này đã được huỷ trước đó.');
    }
    if (appointment.status === 'completed') {
      throw ApiError.conflict('APPOINTMENT_COMPLETED', 'Lịch hẹn đã hoàn thành, không thể huỷ.');
    }
    if (!isAdmin && new Date(appointment.start_time).getTime() <= Date.now()) {
      throw ApiError.conflict('APPOINTMENT_STARTED', 'Lịch hẹn đã bắt đầu, không thể huỷ.');
    }

    const updated = await client.query(
      `UPDATE appointments
          SET status = 'cancelled',
              cancelled_at = now(),
              cancel_reason = $2,
              updated_at = now()
        WHERE id = $1 AND status IN ('pending','confirmed')
        RETURNING id`,
      [appointmentId, reason]
    );
    if (updated.rowCount !== 1) {
      throw ApiError.conflict('CANCEL_FAILED', 'Không thể huỷ lịch hẹn ở trạng thái hiện tại.');
    }

    // Chỉ mở lại khung giờ khi không còn lịch hẹn nào đang hoạt động.
    const stillActive = await client.query(
      `SELECT 1 FROM appointments
        WHERE slot_id = $1 AND status IN ('pending','confirmed')
        LIMIT 1`,
      [appointment.slot_id]
    );
    if (stillActive.rowCount === 0) {
      await client.query(
        `UPDATE time_slots
            SET status = 'available', updated_at = now()
          WHERE id = $1 AND status = 'booked'`,
        [appointment.slot_id]
      );
    }

    const detail = await client.query(`${APPOINTMENT_SELECT} WHERE a.id = $1`, [appointmentId]);
    return detail.rows[0];
  });

  metrics.appointmentsCancelledTotal.inc({ actor_role: actor.role });
  logger.info(
    { appointmentId, actorId: actor.id, actorRole: actor.role, slotId: result.slot_id },
    'Huỷ lịch hẹn và giải phóng khung giờ'
  );
  return serializeAppointment(result, { includeUser: actor.role === 'admin' });
}

/**
 * Admin xác nhận lịch hẹn đang ở trạng thái pending.
 */
async function confirmAppointment({ appointmentId, actor }) {
  const result = await db.withTransaction(async (client) => {
    const preview = await client.query('SELECT id, slot_id FROM appointments WHERE id = $1', [appointmentId]);
    if (!preview.rows[0]) {
      throw ApiError.notFound('APPOINTMENT_NOT_FOUND', 'Lịch hẹn không tồn tại.');
    }

    await client.query('SELECT id FROM time_slots WHERE id = $1 FOR UPDATE', [preview.rows[0].slot_id]);

    const locked = await client.query(
      `SELECT a.id, a.status, ts.start_time
         FROM appointments a
         JOIN time_slots ts ON ts.id = a.slot_id
        WHERE a.id = $1
        FOR UPDATE OF a`,
      [appointmentId]
    );
    const appointment = locked.rows[0];
    if (!appointment) {
      throw ApiError.notFound('APPOINTMENT_NOT_FOUND', 'Lịch hẹn không tồn tại.');
    }
    if (appointment.status === 'confirmed') {
      const detail = await client.query(`${APPOINTMENT_SELECT} WHERE a.id = $1`, [appointmentId]);
      return { row: detail.rows[0], alreadyConfirmed: true };
    }
    if (appointment.status !== 'pending') {
      throw ApiError.conflict('INVALID_STATUS', `Không thể xác nhận lịch hẹn ở trạng thái "${appointment.status}".`);
    }
    if (new Date(appointment.start_time).getTime() <= Date.now()) {
      throw ApiError.conflict('APPOINTMENT_STARTED', 'Lịch hẹn đã bắt đầu, không thể xác nhận.');
    }

    await client.query(
      `UPDATE appointments
          SET status = 'confirmed', confirmed_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'pending'`,
      [appointmentId]
    );
    await client.query(
      `UPDATE time_slots
          SET status = 'booked', updated_at = now()
        WHERE id = $1 AND status = 'available'`,
      [appointment.slot_id]
    );

    const detail = await client.query(`${APPOINTMENT_SELECT} WHERE a.id = $1`, [appointmentId]);
    return { row: detail.rows[0], alreadyConfirmed: false };
  });

  if (!result.alreadyConfirmed) {
    metrics.appointmentsConfirmedTotal.inc();
    logger.info({ appointmentId, actorId: actor.id }, 'Xác nhận lịch hẹn');
  }
  return {
    appointment: serializeAppointment(result.row, { includeUser: true }),
    alreadyConfirmed: result.alreadyConfirmed,
  };
}

async function listUserAppointments(userId, { status = null } = {}) {
  const params = [userId];
  let filter = '';
  if (status) {
    if (!ALL_STATUSES.includes(status)) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'Trạng thái lọc không hợp lệ.');
    }
    params.push(status);
    filter = ` AND a.status = $${params.length}`;
  }
  const { rows } = await db.query(
    `${APPOINTMENT_SELECT}
      WHERE a.user_id = $1${filter}
      ORDER BY ts.start_time DESC
      LIMIT 100`,
    params
  );
  return rows.map((row) => serializeAppointment(row));
}

async function listAppointments({ status = null, date = null, search = null, limit = 50, offset = 0 } = {}) {
  const params = [];
  const conditions = [];

  if (status) {
    if (!ALL_STATUSES.includes(status)) {
      throw ApiError.badRequest('VALIDATION_ERROR', 'Trạng thái lọc không hợp lệ.');
    }
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (date) {
    params.push(date);
    const dateParamIndex = params.length;
    params.push(config.appTimezone);
    const tzParamIndex = params.length;
    conditions.push(`(ts.start_time AT TIME ZONE $${tzParamIndex})::date = $${dateParamIndex}::date`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(u.email) LIKE $${params.length} OR lower(u.full_name) LIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await db.query(
    `SELECT count(*)::int AS total
       FROM appointments a
       JOIN time_slots ts ON ts.id = a.slot_id
       JOIN services sv ON sv.id = ts.service_id
       JOIN users u ON u.id = a.user_id
      ${where}`,
    params
  );

  const listParams = [...params, limit, offset];
  const { rows } = await db.query(
    `${APPOINTMENT_SELECT}
      ${where}
      ORDER BY
        CASE a.status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
        ts.start_time ASC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  return {
    total: countResult.rows[0].total,
    limit,
    offset,
    appointments: rows.map((row) => serializeAppointment(row, { includeUser: true })),
  };
}

async function getAdminStats() {
  const { rows } = await db.query(
    `SELECT
        count(*) FILTER (WHERE a.status = 'pending')::int   AS pending,
        count(*) FILTER (WHERE a.status = 'confirmed')::int AS confirmed,
        count(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled,
        count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
        count(*) FILTER (
          WHERE a.status IN ('pending','confirmed')
            AND (ts.start_time AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
        )::int AS today,
        count(*)::int AS total
      FROM appointments a
      JOIN time_slots ts ON ts.id = a.slot_id`,
    [config.appTimezone]
  );

  const users = await db.query(
    `SELECT count(*) FILTER (WHERE role = 'user')::int AS customers,
            count(*) FILTER (WHERE role = 'admin')::int AS admins
       FROM users WHERE is_active = true`
  );
  const slots = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'available' AND start_time > now())::int AS available,
            count(*) FILTER (WHERE status = 'booked')::int AS booked,
            count(*) FILTER (WHERE status = 'blocked')::int AS blocked
       FROM time_slots`
  );

  return {
    appointments: rows[0],
    users: users.rows[0],
    slots: slots.rows[0],
    timezone: config.appTimezone,
  };
}

module.exports = {
  ACTIVE_STATUSES,
  ALL_STATUSES,
  serializeAppointment,
  createAppointment,
  cancelAppointment,
  confirmAppointment,
  listUserAppointments,
  listAppointments,
  getAdminStats,
};
