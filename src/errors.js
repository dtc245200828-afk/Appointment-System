'use strict';

/**
 * Lỗi nghiệp vụ có HTTP status + mã lỗi ổn định cho frontend.
 */
class ApiError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(code, message, details) {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(code, message) {
    return new ApiError(401, code, message);
  }

  static forbidden(code, message) {
    return new ApiError(403, code, message);
  }

  static notFound(code, message) {
    return new ApiError(404, code, message);
  }

  static conflict(code, message, details) {
    return new ApiError(409, code, message, details);
  }

  static tooManyRequests(message) {
    return new ApiError(429, 'RATE_LIMITED', message);
  }
}

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    try {
      Promise.resolve(fn(req, res, next)).catch(next);
    } catch (error) {
      // Hàm xử lý ném lỗi đồng bộ (không phải async) vẫn phải đi qua errorHandler.
      next(error);
    }
  };
}

module.exports = { ApiError, asyncHandler };
