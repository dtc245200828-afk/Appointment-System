'use strict';

/**
 * Unit test cho ApiError / asyncHandler (src/errors.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ApiError, asyncHandler } = require('../../src/errors');

test('ApiError: các factory gắn đúng HTTP status và mã lỗi', () => {
  const cases = [
    [ApiError.badRequest('VALIDATION_ERROR', 'sai dữ liệu', [{ field: 'x' }]), 400, 'VALIDATION_ERROR'],
    [ApiError.unauthorized('UNAUTHORIZED', 'chưa đăng nhập'), 401, 'UNAUTHORIZED'],
    [ApiError.forbidden('FORBIDDEN', 'không có quyền'), 403, 'FORBIDDEN'],
    [ApiError.notFound('NOT_FOUND', 'không tồn tại'), 404, 'NOT_FOUND'],
    [ApiError.conflict('SLOT_UNAVAILABLE', 'đã được đặt'), 409, 'SLOT_UNAVAILABLE'],
    [ApiError.tooManyRequests('quá nhanh'), 429, 'RATE_LIMITED'],
  ];

  cases.forEach(([error, statusCode, code]) => {
    assert.ok(error instanceof ApiError);
    assert.ok(error instanceof Error);
    assert.equal(error.statusCode, statusCode);
    assert.equal(error.code, code);
    assert.equal(error.name, 'ApiError');
  });

  assert.deepEqual(cases[0][0].details, [{ field: 'x' }]);
  assert.equal(cases[1][0].details, undefined);
});

test('asyncHandler: chuyển kết quả async về response', async () => {
  const handler = asyncHandler(async (req, res) => {
    res.body = { echo: req.value };
  });
  const req = { value: 7 };
  const res = {};
  let nextCalled = false;

  await handler(req, res, () => {
    nextCalled = true;
  });

  assert.deepEqual(res.body, { echo: 7 });
  assert.equal(nextCalled, false);
});

test('asyncHandler: chuyển lỗi async sang middleware next', async () => {
  const boom = ApiError.conflict('SLOT_UNAVAILABLE', 'Khung giờ đã được đặt.');
  const handler = asyncHandler(async () => {
    throw boom;
  });
  let received = null;

  await handler({}, {}, (error) => {
    received = error;
  });

  assert.equal(received, boom);
});

test('asyncHandler: bắt cả lỗi đồng bộ', async () => {
  const handler = asyncHandler(() => {
    throw new Error('sync failure');
  });
  let received = null;

  await handler({}, {}, (error) => {
    received = error;
  });

  assert.equal(received.message, 'sync failure');
});
