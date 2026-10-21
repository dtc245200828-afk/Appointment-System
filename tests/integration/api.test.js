'use strict';

/**
 * Integration test cho API đang chạy trong Docker Compose.
 *
 * Cách chạy:
 *   docker compose up -d --build
 *   npm run test:integration
 *
 * Biến môi trường:
 *   BASE_URL  - mặc định https://localhost (đi qua Nginx, TLS self-signed)
 *   ALLOW_INSECURE_TLS - đặt "false" nếu dùng chứng chỉ thật và muốn kiểm tra TLS
 *
 * Chứng chỉ của Nginx là self-signed nên mặc định test tắt kiểm tra chuỗi
 * chứng chỉ (chỉ trong tiến trình test, không ảnh hưởng ứng dụng).
 *
 * Nếu máy chủ chưa sẵn sàng, các test sẽ được SKIP thay vì báo lỗi,
 * để `npm run test:all` vẫn dùng được trong môi trường không có Docker.
 * Lưu ý: test tạo tài khoản/dữ liệu thật trong DB dev, nên chỉ chạy trên môi
 * trường demo hoặc database dùng để kiểm thử.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { before } = require('node:test');

const BASE_URL = (process.env.BASE_URL || 'https://localhost').replace(/\/+$/, '');
const TIMEOUT_MS = 10_000;

// fetch của Node (undici) đọc biến này khi thiết lập TLS handshake.
if (BASE_URL.startsWith('https://') && process.env.ALLOW_INSECURE_TLS !== 'false') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}


let serverUp = false;
let skipReason = 'Máy chủ chưa sẵn sàng.';

async function request(path, options) {
  const opts = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;

  try {
    const response = await fetch(BASE_URL + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
      redirect: 'manual',
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (error) {
      json = null;
    }
    return { status: response.status, json, text, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

function uniqueEmail(prefix) {
  const stamp = Date.now();
  const random = Math.floor(Math.random() * 1_000_000);
  return `${prefix}.${stamp}.${random}@example.com`;
}

before(async () => {
  try {
    const response = await request('/api/health');
    if (response.status === 200 && response.json && response.json.status === 'ok') {
      serverUp = true;
    } else {
      skipReason = `GET /api/health trả về HTTP ${response.status}.`;
    }
  } catch (error) {
    skipReason = `Không kết nối được ${BASE_URL} (${error.message}). Hãy chạy: docker compose up -d`;
  }
});

test('GET /api/health: báo cáo trạng thái ứng dụng và database', async (t) => {
  if (!serverUp) return t.skip(skipReason);

  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.json.status, 'ok');
  assert.equal(response.json.database, 'up');
  assert.equal(typeof response.json.databaseLatencyMs, 'number');
});

test('GET /: phục vụ frontend kèm security headers', async (t) => {
  if (!serverUp) return t.skip(skipReason);

  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /Đặt lịch hẹn/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('GET /api/services: trả về danh sách dịch vụ đang hoạt động', async (t) => {
  if (!serverUp) return t.skip(skipReason);

  const response = await request('/api/services');
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.json.services));
  assert.ok(response.json.services.length > 0, 'cần ít nhất một dịch vụ từ seed data');

  const service = response.json.services[0];
  ['id', 'name', 'duration_minutes', 'price', 'available_slots'].forEach((field) => {
    assert.ok(Object.prototype.hasOwnProperty.call(service, field), `thiếu trường ${field}`);
  });
});

test('Luồng khách hàng: đăng ký -> đăng nhập -> đặt lịch -> huỷ lịch', async (t) => {
  if (!serverUp) return t.skip(skipReason);

  const email = uniqueEmail('e2e.customer');
  const password = 'MatKhau123';

  // (1) Đăng ký
  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Khách Kiểm Thử', email, password, phone: '0901234567' },
  });
  assert.equal(registered.status, 201, registered.text);
  assert.ok(registered.json.token);
  assert.equal(registered.json.user.email, email);
  assert.equal(registered.json.user.role, 'user');
  assert.equal(registered.json.user.password_hash, undefined, 'không được trả về hash mật khẩu');

  // (2) Đăng nhập lại để lấy token mới
  const loggedIn = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(loggedIn.status, 200, loggedIn.text);
  const token = loggedIn.json.token;
  assert.ok(token);

  // (3) Token hợp lệ truy vấn được hồ sơ
  const me = await request('/api/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, email);

  // (4) Sai mật khẩu -> 401
  const wrongPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: 'SaiMatKhau123' },
  });
  assert.equal(wrongPassword.status, 401);

  // (5) Không có token -> 401
  const anonymous = await request('/api/appointments/me');
  assert.equal(anonymous.status, 401);

  // (6) Tìm một khung giờ còn trống
  const slotsResponse = await request('/api/slots?days=14');
  assert.equal(slotsResponse.status, 200);
  const slot = (slotsResponse.json.slots || [])[0];
  if (!slot) {
    t.diagnostic('Không còn khung giờ trống trong 14 ngày tới, bỏ qua phần đặt lịch.');
    return;
  }

  // (7) Đặt lịch
  const created = await request('/api/appointments', {
    method: 'POST',
    token,
    body: { slotId: slot.id, note: 'Đặt bởi integration test' },
  });
  assert.equal(created.status, 201, created.text);
  const appointment = created.json.appointment;
  assert.equal(appointment.status, 'pending');
  assert.equal(appointment.slot.id, slot.id);
  assert.equal(appointment.slot.serviceName, slot.service_name);

  // (8) Lịch hẹn xuất hiện trong danh sách của tôi
  const mine = await request('/api/appointments/me', { token });
  assert.equal(mine.status, 200);
  assert.ok(mine.json.appointments.some((item) => item.id === appointment.id));

  // (9) Người khác không thể huỷ lịch hẹn này
  const other = await request('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Khách Khác', email: uniqueEmail('e2e.other'), password },
  });
  assert.equal(other.status, 201, other.text);
  const forbiddenCancel = await request(`/api/appointments/${appointment.id}/cancel`, {
    method: 'POST',
    token: other.json.token,
    body: { reason: 'Không phải lịch của tôi' },
  });
  assert.equal(forbiddenCancel.status, 403);

  // (10) Chủ lịch hẹn huỷ được
  const cancelled = await request(`/api/appointments/${appointment.id}/cancel`, {
    method: 'POST',
    token,
    body: { reason: 'Huỷ bởi integration test' },
  });
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal(cancelled.json.appointment.status, 'cancelled');

  // (11) Khung giờ được giải phóng và có thể đặt lại
  const slotsAgain = await request('/api/slots?days=14');
  assert.equal(slotsAgain.status, 200);
  assert.ok(
    (slotsAgain.json.slots || []).some((item) => item.id === slot.id),
    'khung giờ phải trở lại trạng thái còn trống'
  );
});

test('POST /api/appointments: chống đặt trùng khung giờ (409)', async (t) => {
  if (!serverUp) return t.skip(skipReason);

  const slotsResponse = await request('/api/slots?days=14');
  const slot = (slotsResponse.json.slots || [])[0];
  if (!slot) {
    t.diagnostic('Không còn khung giờ trống, bỏ qua test đặt trùng.');
    return;
  }

  const password = 'MatKhau123';
  const first = await request('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Khách Một', email: uniqueEmail('e2e.first'), password },
  });
  const second = await request('/api/auth/register', {
    method: 'POST',
    body: { fullName: 'Khách Hai', email: uniqueEmail('e2e.second'), password },
  });
  assert.equal(first.status, 201, first.text);
  assert.equal(second.status, 201, second.text);

  const booking = await request('/api/appointments', {
    method: 'POST',
    token: first.json.token,
    body: { slotId: slot.id },
  });
  assert.equal(booking.status, 201, booking.text);

  const duplicate = await request('/api/appointments', {
    method: 'POST',
    token: second.json.token,
    body: { slotId: slot.id },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.error.code, 'SLOT_UNAVAILABLE');

  // Dọn dẹp: huỷ lịch vừa tạo để không chiếm khung giờ của seed data.
  await request(`/api/appointments/${booking.json.appointment.id}/cancel`, {
    method: 'POST',
    token: first.json.token,
    body: { reason: 'Dọn dẹp sau integration test' },
  });
});

test('POST /api/appointments: thiếu slotId trả về 400 VALIDATION_ERROR', async (t) => {
  if (!serverUp) return t.skip(skipReason);

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Khách Kiểm Tra Dữ Liệu',
      email: uniqueEmail('e2e.invalid'),
      password: 'MatKhau123',
    },
  });
  assert.equal(registered.status, 201, registered.text);

  const response = await request('/api/appointments', {
    method: 'POST',
    token: registered.json.token,
    body: { note: 'Không có slotId' },
  });
  assert.equal(response.status, 400);
  assert.equal(response.json.error.code, 'VALIDATION_ERROR');
  assert.equal(response.json.error.details[0].field, 'slotId');
});

test('GET /api/admin/stats: khách hàng thường bị chặn 403', async (t) => {
  if (!serverUp) return t.skip(skipReason);

  const registered = await request('/api/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Khách Không Phải Admin',
      email: uniqueEmail('e2e.nonadmin'),
      password: 'MatKhau123',
    },
  });
  assert.equal(registered.status, 201, registered.text);

  const response = await request('/api/admin/stats', { token: registered.json.token });
  assert.equal(response.status, 403);

  const anonymous = await request('/api/admin/stats');
  assert.equal(anonymous.status, 401);
});

test('GET /api/khong-ton-tai: trả về 404 JSON có mã lỗi', async (t) => {
  if (!serverUp) return t.skip(skipReason);

  const response = await request('/api/khong-ton-tai');
  assert.equal(response.status, 404);
  assert.ok(response.json.error.code);
});
