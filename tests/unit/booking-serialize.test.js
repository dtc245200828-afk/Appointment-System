'use strict';

/**
 * Unit test cho serializeAppointment (src/booking.js).
 *
 * booking.js kéo theo config.js/db.js nên cần biến môi trường tối thiểu.
 * Các biến được set TRƯỚC khi require để dotenv không ghi đè (dotenv chỉ điền
 * giá trị còn thiếu, không override biến đã có sẵn trong process.env).
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'test-only-secret-value-with-32-characters';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://app_user:test@localhost:5432/appointment_test';
process.env.LOG_DIR = '';

const test = require('node:test');
const assert = require('node:assert/strict');

const { serializeAppointment, ACTIVE_STATUSES, ALL_STATUSES } = require('../../src/booking');

function buildRow(overrides) {
  return {
    id: 12,
    user_id: 3,
    slot_id: 21,
    status: 'pending',
    note: 'Cần tư vấn thêm',
    created_at: '2026-03-01T02:00:00.000Z',
    updated_at: '2026-03-01T02:00:00.000Z',
    confirmed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    start_time: '2026-03-02T01:00:00.000Z',
    end_time: '2026-03-02T01:30:00.000Z',
    slot_status: 'booked',
    service_id: 5,
    service_name: 'Khám tổng quát',
    duration_minutes: 30,
    price: '250000.00',
    user_full_name: 'Nguyễn Văn An',
    user_email: 'an@example.com',
    user_phone: '0901234567',
    ...overrides,
  };
}

test('serializeAppointment: trả về null khi không có row', () => {
  assert.equal(serializeAppointment(null), null);
  assert.equal(serializeAppointment(undefined), null);
});

test('serializeAppointment: ánh xạ snake_case -> camelCase', () => {
  const appointment = serializeAppointment(buildRow());

  assert.equal(appointment.id, 12);
  assert.equal(appointment.status, 'pending');
  assert.equal(appointment.note, 'Cần tư vấn thêm');
  assert.equal(appointment.cancelReason, null);
  assert.equal(appointment.slot.id, 21);
  assert.equal(appointment.slot.serviceId, 5);
  assert.equal(appointment.slot.serviceName, 'Khám tổng quát');
  assert.equal(appointment.slot.durationMinutes, 30);
  assert.equal(appointment.slot.price, 250000);
  assert.equal(typeof appointment.slot.price, 'number');
  assert.equal(appointment.slot.status, 'booked');
  assert.equal(appointment.slot.startTime, '2026-03-02T01:00:00.000Z');
});

test('serializeAppointment: mặc định không lộ thông tin người dùng', () => {
  const appointment = serializeAppointment(buildRow());
  assert.equal(appointment.user, undefined);
});

test('serializeAppointment: includeUser = true bổ sung thông tin khách hàng', () => {
  const appointment = serializeAppointment(buildRow({ cancel_reason: 'Khách bận' }), {
    includeUser: true,
  });

  assert.deepEqual(appointment.user, {
    id: 3,
    fullName: 'Nguyễn Văn An',
    email: 'an@example.com',
    phone: '0901234567',
  });
  assert.equal(appointment.cancelReason, 'Khách bận');
});

test('danh sách trạng thái nghiệp vụ', () => {
  assert.deepEqual(ACTIVE_STATUSES, ['pending', 'confirmed']);
  assert.deepEqual(ALL_STATUSES, ['pending', 'confirmed', 'cancelled', 'completed']);
});
