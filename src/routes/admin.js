'use strict';

const express = require('express');
const { asyncHandler } = require('../errors');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { parsePositiveInt, parseDateParam, validateNote } = require('../validation');
const booking = require('../booking');

const router = express.Router();

// Toàn bộ router yêu cầu JWT hợp lệ + role admin kiểm tra lại trong DB.
router.use(authenticate, requireAdmin);

function parsePagination(query) {
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 100);
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

// GET /api/admin/appointments?status=&date=&q=&page=&limit=
router.get(
  '/appointments',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePagination(req.query);
    const status = req.query.status ? String(req.query.status) : null;
    const date = parseDateParam(req.query.date);
    const search = req.query.q ? String(req.query.q).trim().slice(0, 100) : null;

    const result = await booking.listAppointments({ status, date, search, limit, offset });
    res.json({ ...result, page });
  })
);

// GET /api/admin/stats
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    res.json(await booking.getAdminStats());
  })
);

// PATCH /api/admin/appointments/:id/confirm
router.patch(
  '/appointments/:id/confirm',
  asyncHandler(async (req, res) => {
    const appointmentId = parsePositiveInt(req.params.id, 'id');
    const { appointment, alreadyConfirmed } = await booking.confirmAppointment({
      appointmentId,
      actor: req.user,
    });
    res.json({
      message: alreadyConfirmed ? 'Lịch hẹn đã được xác nhận trước đó.' : 'Đã xác nhận lịch hẹn.',
      alreadyConfirmed,
      appointment,
    });
  })
);

// PATCH /api/admin/appointments/:id/cancel  (admin có thể huỷ cả lịch đã bắt đầu)
router.patch(
  '/appointments/:id/cancel',
  asyncHandler(async (req, res) => {
    const appointmentId = parsePositiveInt(req.params.id, 'id');
    const reason = validateNote(req.body ? req.body.reason : null);
    const appointment = await booking.cancelAppointment({
      appointmentId,
      actor: req.user,
      reason: reason || 'Quản trị viên huỷ lịch',
    });
    res.json({ message: 'Đã huỷ lịch hẹn và giải phóng khung giờ.', appointment });
  })
);

module.exports = router;
