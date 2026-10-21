'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { asyncHandler, ApiError } = require('../errors');
const { authenticate } = require('../middleware/auth');
const { parsePositiveInt, validateNote } = require('../validation');
const booking = require('../booking');

const router = express.Router();

router.use(authenticate);

const bookingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user ? req.user.id : req.ip}`,
  handler: (req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau vài phút.' },
    });
  },
});

// POST /api/appointments - đặt lịch hẹn
router.post(
  '/',
  bookingLimiter,
  asyncHandler(async (req, res) => {
    const { slotId } = req.body || {};
    if (slotId === undefined || slotId === null || slotId === '') {
      throw ApiError.badRequest('VALIDATION_ERROR', 'Thiếu slotId.', [
        { field: 'slotId', message: 'Vui lòng chọn khung giờ.' },
      ]);
    }
    const parsedSlotId = parsePositiveInt(slotId, 'slotId');
    const note = validateNote(req.body ? req.body.note : null);

    const appointment = await booking.createAppointment({
      userId: req.user.id,
      slotId: parsedSlotId,
      note,
    });

    res.status(201).json({
      message: 'Đặt lịch hẹn thành công. Vui lòng chờ quản trị viên xác nhận.',
      appointment,
    });
  })
);

// GET /api/appointments/me - danh sách lịch hẹn của tôi
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const appointments = await booking.listUserAppointments(req.user.id, { status });
    res.json({ appointments });
  })
);

// POST /api/appointments/:id/cancel - huỷ lịch hẹn
router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const appointmentId = parsePositiveInt(req.params.id, 'id');
    const reason = validateNote(req.body ? req.body.reason : null);
    const appointment = await booking.cancelAppointment({
      appointmentId,
      actor: req.user,
      reason,
    });
    res.json({ message: 'Đã huỷ lịch hẹn và giải phóng khung giờ.', appointment });
  })
);

// DELETE /api/appointments/:id - huỷ lịch hẹn (alias)
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const appointmentId = parsePositiveInt(req.params.id, 'id');
    const appointment = await booking.cancelAppointment({
      appointmentId,
      actor: req.user,
      reason: null,
    });
    res.json({ message: 'Đã huỷ lịch hẹn và giải phóng khung giờ.', appointment });
  })
);

module.exports = router;
