'use strict';

/**
 * Unit test cho lớp validation (src/validation.js).
 * Chạy: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EMAIL_RE,
  normalizeEmail,
  validateRegistration,
  validateLogin,
  validatePassword,
  parsePositiveInt,
  parseDateParam,
  validateNote,
} = require('../../src/validation');

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Mong đợi hàm ném ApiError nhưng không có lỗi nào.');
}

test('normalizeEmail: trim và chuyển về chữ thường', () => {
  assert.equal(normalizeEmail('  User.Name@Example.COM '), 'user.name@example.com');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(null), '');
});

test('EMAIL_RE: chấp nhận email hợp lệ, từ chối email sai', () => {
  assert.ok(EMAIL_RE.test('khach.hang@example.vn'));
  assert.ok(!EMAIL_RE.test('khach.hang@example'));
  assert.ok(!EMAIL_RE.test('khach hang@example.com'));
  assert.ok(!EMAIL_RE.test('@example.com'));
});

test('validateRegistration: chuẩn hoá họ tên, email, phone rỗng -> null', () => {
  const result = validateRegistration({
    fullName: '  Nguyễn   Văn   An ',
    email: '  AN.NGUYEN@Example.com ',
    password: 'MatKhau123',
    phone: '   ',
  });

  assert.deepEqual(result, {
    fullName: 'Nguyễn Văn An',
    email: 'an.nguyen@example.com',
    password: 'MatKhau123',
    phone: null,
  });
});

test('validateRegistration: giữ nguyên số điện thoại hợp lệ', () => {
  const result = validateRegistration({
    fullName: 'Trần Thị Bình',
    email: 'binh@example.com',
    password: 'MatKhau123',
    phone: '+84 (0)90-123-4567',
  });
  assert.equal(result.phone, '+84 (0)90-123-4567');
});

test('validateRegistration: báo lỗi cho từng trường không hợp lệ', () => {
  const error = captureError(() =>
    validateRegistration({ fullName: 'A', email: 'sai-email', password: '123', phone: 'abc' })
  );

  assert.equal(error.name, 'ApiError');
  assert.equal(error.statusCode, 400);
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.deepEqual(
    error.details.map((item) => item.field),
    ['fullName', 'email', 'password', 'phone']
  );
});

test('validatePassword: quy tắc độ dài 8-72 và đủ loại ký tự', () => {
  assert.equal(validatePassword('MatKhau123').ok, true);
  assert.equal(validatePassword('matkhau123').ok, false, 'thiếu chữ hoa');
  assert.equal(validatePassword('MẬTKHẨU123').ok, false, 'thiếu chữ thường ASCII');
  assert.equal(validatePassword('MatKhauAbc').ok, false, 'thiếu chữ số');
  assert.equal(validatePassword('MatKh1').ok, false, 'quá ngắn');
  assert.equal(validatePassword('A1' + 'b'.repeat(71)).ok, false, 'quá dài');
  assert.equal(validatePassword(undefined).ok, false);
});

test('validateLogin: bắt buộc email hợp lệ và mật khẩu không rỗng', () => {
  assert.deepEqual(validateLogin({ email: ' A@B.VN ', password: 'matkhau' }), {
    email: 'a@b.vn',
    password: 'matkhau',
  });

  const error = captureError(() => validateLogin({ email: '', password: '' }));
  assert.equal(error.statusCode, 400);
  assert.deepEqual(
    error.details.map((item) => item.field),
    ['email', 'password']
  );

  const tooLong = captureError(() => validateLogin({ email: 'a@b.vn', password: 'x'.repeat(73) }));
  assert.equal(tooLong.code, 'VALIDATION_ERROR');
});

test('parsePositiveInt: chấp nhận số nguyên dương', () => {
  assert.equal(parsePositiveInt(42), 42);
  assert.equal(parsePositiveInt('42'), 42);
  assert.equal(parsePositiveInt(' 7 '), 7);
});

test('parsePositiveInt: từ chối giá trị không hợp lệ', () => {
  ['0', '-1', '1.5', 'abc', '', '01', null, undefined].forEach((value) => {
    const error = captureError(() => parsePositiveInt(value, 'slotId'));
    assert.equal(error.statusCode, 400, `giá trị ${String(value)} phải bị từ chối`);
    assert.equal(error.details[0].field, 'slotId');
  });
});

test('parseDateParam: rỗng trả về null, đúng định dạng trả về chuỗi', () => {
  assert.equal(parseDateParam(undefined), null);
  assert.equal(parseDateParam(null), null);
  assert.equal(parseDateParam(''), null);
  assert.equal(parseDateParam(' 2026-03-15 '), '2026-03-15');
});

test('parseDateParam: từ chối định dạng ngày sai', () => {
  ['15-03-2026', '2026/03/15', '2026-3-15', '20260315'].forEach((value) => {
    const error = captureError(() => parseDateParam(value));
    assert.equal(error.statusCode, 400);
    assert.equal(error.details[0].field, 'date');
  });
});

test('validateNote: trim, rỗng thành null, quá 500 ký tự bị từ chối', () => {
  assert.equal(validateNote(undefined), null);
  assert.equal(validateNote(null), null);
  assert.equal(validateNote('   '), null);
  assert.equal(validateNote('  Cần tư vấn thêm  '), 'Cần tư vấn thêm');
  assert.equal(validateNote('a'.repeat(500)), 'a'.repeat(500));

  const error = captureError(() => validateNote('a'.repeat(501)));
  assert.equal(error.statusCode, 400);
  assert.equal(error.details[0].field, 'note');
});
