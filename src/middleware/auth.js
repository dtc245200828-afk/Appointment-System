'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { ApiError, asyncHandler } = require('../errors');
const { pool } = require('../db');

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), email: user.email, role: user.role },
    config.jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: config.jwtExpiresIn,
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
  });
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
}

function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    next(ApiError.unauthorized('NO_TOKEN', 'Vui lòng đăng nhập để thực hiện chức năng này.'));
    return;
  }
  try {
    const payload = verifyToken(token);
    req.user = {
      id: Number(payload.sub),
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch {
    next(ApiError.unauthorized('INVALID_TOKEN', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.'));
  }
}

/**
 * Kiểm tra quyền admin trực tiếp trong DB (không tin hoàn toàn claim trong JWT)
 * để có thể thu hồi quyền ngay khi tài khoản bị hạ cấp/khoá.
 */
const requireAdmin = asyncHandler(async (req, res, next) => {
  if (!req.user) {
    throw ApiError.unauthorized('NO_TOKEN', 'Vui lòng đăng nhập.');
  }
  const { rows } = await pool.query('SELECT id, role, is_active FROM users WHERE id = $1', [req.user.id]);
  const dbUser = rows[0];
  if (!dbUser || !dbUser.is_active) {
    throw ApiError.unauthorized('ACCOUNT_DISABLED', 'Tài khoản không tồn tại hoặc đã bị khoá.');
  }
  if (dbUser.role !== 'admin') {
    throw ApiError.forbidden('FORBIDDEN', 'Chỉ quản trị viên mới có quyền truy cập.');
  }
  req.user.role = dbUser.role;
  next();
});

module.exports = { signToken, verifyToken, authenticate, requireAdmin };
