'use strict';

const express = require('express');
const config = require('../config');
const db = require('../db');
const { asyncHandler, ApiError } = require('../errors');
const { parsePositiveInt, parseDateParam } = require('../validation');

const router = express.Router();

function parseDays(value, fallback = 7) {
  if (value === undefined || value === '') return fallback;
  const days = Number.parseInt(value, 10);
  if (!Number.isInteger(days) || days < 1 || days > 60) {
    throw ApiError.badRequest('VALIDATION_ERROR', 'days phải nằm trong khoảng 1..60.');
  }
  return days;
}

const SLOT_FIELDS = `
  ts.id,
  ts.service_id,
  sv.name AS service_name,
  sv.duration_minutes,
  sv.price,
  ts.start_time,
  ts.end_time,
  ts.status,
  to_char(ts.start_time AT TIME ZONE $3, 'YYYY-MM-DD') AS slot_date,
  to_char(ts.start_time AT TIME ZONE $3, 'HH24:MI') AS start_local,
  to_char(ts.end_time AT TIME ZONE $3, 'HH24:MI') AS end_local
`;

// GET /api/services - danh sách dịch vụ đang hoạt động + số khung giờ còn trống
router.get(
  '/services',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT sv.id,
              sv.name,
              sv.description,
              sv.duration_minutes,
              sv.price,
              sv.is_active,
              COALESCE((
                SELECT count(*) FROM time_slots ts
                 WHERE ts.service_id = sv.id
                   AND ts.status = 'available'
                   AND ts.start_time > now()
              ), 0)::int AS available_slots
         FROM services sv
        WHERE sv.is_active = true
        ORDER BY sv.name ASC`
    );
    res.json({ services: rows, timezone: config.appTimezone });
  })
);

// GET /api/services/:id
router.get(
  '/services/:id',
  asyncHandler(async (req, res) => {
    const serviceId = parsePositiveInt(req.params.id, 'id');
    const { rows } = await db.query(
      `SELECT id, name, description, duration_minutes, price, is_active
         FROM services WHERE id = $1`,
      [serviceId]
    );
    if (!rows[0]) throw ApiError.notFound('SERVICE_NOT_FOUND', 'Dịch vụ không tồn tại.');
    res.json({ service: rows[0] });
  })
);

// GET /api/services/:id/slots?date=YYYY-MM-DD&days=7
router.get(
  '/services/:id/slots',
  asyncHandler(async (req, res) => {
    const serviceId = parsePositiveInt(req.params.id, 'id');
    const date = parseDateParam(req.query.date);
    const days = parseDays(req.query.days);

    const service = await db.query('SELECT id, name FROM services WHERE id = $1 AND is_active = true', [serviceId]);
    if (!service.rows[0]) throw ApiError.notFound('SERVICE_NOT_FOUND', 'Dịch vụ không tồn tại.');

    const { rows } = await db.query(
      `WITH bounds AS (
         SELECT CASE WHEN $2::date IS NULL
                     THEN (now() AT TIME ZONE $3)::date
                     ELSE $2::date END AS from_date,
                CASE WHEN $2::date IS NULL
                     THEN (now() AT TIME ZONE $3)::date + $4::int
                     ELSE $2::date END AS to_date
       )
       SELECT ${SLOT_FIELDS}
         FROM time_slots ts
         JOIN services sv ON sv.id = ts.service_id
         CROSS JOIN bounds b
        WHERE ts.service_id = $1
          AND ts.status = 'available'
          AND ts.start_time > now()
          AND (ts.start_time AT TIME ZONE $3)::date BETWEEN b.from_date AND b.to_date
        ORDER BY ts.start_time ASC
        LIMIT 500`,
      [serviceId, date, config.appTimezone, days]
    );

    res.json({ service: service.rows[0], slots: rows, timezone: config.appTimezone });
  })
);

// GET /api/slots?serviceId=&date=YYYY-MM-DD&days=7
router.get(
  '/slots',
  asyncHandler(async (req, res) => {
    const date = parseDateParam(req.query.date);
    const days = parseDays(req.query.days);
    const serviceId = req.query.serviceId ? parsePositiveInt(req.query.serviceId, 'serviceId') : null;

    const { rows } = await db.query(
      `WITH bounds AS (
         SELECT CASE WHEN $2::date IS NULL
                     THEN (now() AT TIME ZONE $3)::date
                     ELSE $2::date END AS from_date,
                CASE WHEN $2::date IS NULL
                     THEN (now() AT TIME ZONE $3)::date + $4::int
                     ELSE $2::date END AS to_date
       )
       SELECT ${SLOT_FIELDS}
         FROM time_slots ts
         JOIN services sv ON sv.id = ts.service_id
         CROSS JOIN bounds b
        WHERE ts.status = 'available'
          AND sv.is_active = true
          AND ts.start_time > now()
          AND ($1::int IS NULL OR ts.service_id = $1::int)
          AND (ts.start_time AT TIME ZONE $3)::date BETWEEN b.from_date AND b.to_date
        ORDER BY ts.start_time ASC, sv.name ASC
        LIMIT 500`,
      [serviceId, date, config.appTimezone, days]
    );

    res.json({ slots: rows, timezone: config.appTimezone });
  })
);

module.exports = router;
