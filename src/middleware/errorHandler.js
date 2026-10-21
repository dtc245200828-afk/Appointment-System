'use strict';

const logger = require('../logger');
const config = require('../config');

/**
 * 404 cho API (đặt sau tất cả route).
 */
function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy endpoint.' } });
    return;
  }
  next();
}

/**
 * Chuyển lỗi PostgreSQL sang HTTP status phù hợp.
 */
function mapDatabaseError(error) {
  switch (error.code) {
    case '23505': // unique_violation
      return { status: 409, code: 'CONFLICT', message: 'Dữ liệu đã tồn tại hoặc khung giờ vừa được người khác đặt.' };
    case '23503': // foreign_key_violation
      return { status: 400, code: 'INVALID_REFERENCE', message: 'Dữ liệu tham chiếu không tồn tại.' };
    case '23514': // check_violation
      return { status: 400, code: 'CONSTRAINT_VIOLATION', message: 'Dữ liệu không thoả ràng buộc của hệ thống.' };
    case '23P01': // exclusion_violation
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return { status: 409, code: 'CONFLICT', message: 'Có giao dịch đồng thời, vui lòng thử lại.' };
    case 'P0001': // raise_exception từ trigger nghiệp vụ
      return { status: 409, code: 'BUSINESS_RULE_VIOLATION', message: 'Khung giờ này không còn trống.' };
    case '57014': // query_canceled (statement_timeout)
      return { status: 503, code: 'DATABASE_TIMEOUT', message: 'Cơ sở dữ liệu phản hồi chậm, vui lòng thử lại.' };
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
      return { status: 503, code: 'DATABASE_UNAVAILABLE', message: 'Không kết nối được cơ sở dữ liệu.' };
    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  const mapped = error.code ? mapDatabaseError(error) : null;

  if (mapped) {
    logger.warn(
      { err: error, code: error.code, detail: error.detail, path: req.originalUrl },
      'Lỗi cơ sở dữ liệu được ánh xạ sang HTTP'
    );
    res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message },
    });
    return;
  }

  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Body JSON không hợp lệ.' } });
    return;
  }

  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload quá lớn.' } });
    return;
  }

  if (error instanceof Error && error.name === 'ApiError') {
    const payload = { error: { code: error.code, message: error.message } };
    if (error.details) payload.error.details = error.details;
    res.status(error.statusCode).json(payload);
    return;
  }

  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (status >= 500) {
    logger.error({ err: error, path: req.originalUrl, method: req.method }, 'Lỗi chưa được xử lý');
    res.status(status).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Có lỗi xảy ra ở server.',
        ...(config.isProduction ? {} : { detail: error.message }),
      },
    });
    return;
  }

  res.status(status).json({ error: { code: 'BAD_REQUEST', message: error.message } });
}

module.exports = { notFoundHandler, errorHandler };
