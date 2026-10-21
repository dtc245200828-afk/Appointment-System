'use strict';

const { ApiError } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[0-9+\s().-]{8,20}$/;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function collectErrors(checks) {
  const errors = [];
  for (const { field, ok, message } of checks) {
    if (!ok) errors.push({ field, message });
  }
  if (errors.length > 0) {
    throw ApiError.badRequest('VALIDATION_ERROR', 'Dữ liệu không hợp lệ.', errors);
  }
}

function validatePassword(password, field = 'password') {
  const value = typeof password === 'string' ? password : '';
  return {
    field,
    ok:
      value.length >= 8 &&
      value.length <= 72 && // giới hạn an toàn của bcrypt
      /[a-z]/.test(value) &&
      /[A-Z]/.test(value) &&
      /[0-9]/.test(value),
    message: 'Mật khẩu phải dài 8-72 ký tự, gồm chữ thường, chữ hoa và chữ số.',
  };
}

function validateRegistration(payload = {}) {
  const fullName = String(payload.fullName || '').trim().replace(/\s+/g, ' ');
  const email = normalizeEmail(payload.email);
  const password = typeof payload.password === 'string' ? payload.password : '';
  const phoneRaw = payload.phone === undefined || payload.phone === null ? '' : String(payload.phone).trim();

  collectErrors([
    { field: 'fullName', ok: fullName.length >= 2 && fullName.length <= 120, message: 'Họ tên phải dài 2-120 ký tự.' },
    { field: 'email', ok: email.length <= 180 && EMAIL_RE.test(email), message: 'Email không hợp lệ.' },
    validatePassword(password),
    { field: 'phone', ok: phoneRaw === '' || PHONE_RE.test(phoneRaw), message: 'Số điện thoại không hợp lệ.' },
  ]);

  return { fullName, email, password, phone: phoneRaw === '' ? null : phoneRaw };
}

function validateLogin(payload = {}) {
  const email = normalizeEmail(payload.email);
  const password = typeof payload.password === 'string' ? payload.password : '';
  collectErrors([
    { field: 'email', ok: email.length > 0 && EMAIL_RE.test(email), message: 'Email không hợp lệ.' },
    { field: 'password', ok: password.length > 0 && password.length <= 72, message: 'Mật khẩu không hợp lệ.' },
  ]);
  return { email, password };
}

function parsePositiveInt(value, field = 'id') {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== String(value).trim()) {
    throw ApiError.badRequest('VALIDATION_ERROR', `${field} không hợp lệ.`, [
      { field, message: 'Phải là số nguyên dương.' },
    ]);
  }
  return parsed;
}

function parseDateParam(value, field = 'date') {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  const valid = DATE_RE.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`));
  if (!valid) {
    throw ApiError.badRequest('VALIDATION_ERROR', `${field} phải có định dạng YYYY-MM-DD.`, [
      { field, message: 'Định dạng ngày không hợp lệ.' },
    ]);
  }
  return text;
}

function validateNote(note) {
  if (note === undefined || note === null) return null;
  const text = String(note).trim();
  if (text.length === 0) return null;
  if (text.length > 500) {
    throw ApiError.badRequest('VALIDATION_ERROR', 'Ghi chú tối đa 500 ký tự.', [
      { field: 'note', message: 'Ghi chú quá dài.' },
    ]);
  }
  return text;
}

module.exports = {
  EMAIL_RE,
  normalizeEmail,
  validateRegistration,
  validateLogin,
  validatePassword,
  parsePositiveInt,
  parseDateParam,
  validateNote,
};
