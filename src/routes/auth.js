'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const logger = require('../logger');
const { ApiError, asyncHandler } = require('../errors');
const { signToken, authenticate } = require('../middleware/auth');
const { validateRegistration, validateLogin } = require('../validation');

const router = express.Router();

// Hash giả để chống dò email qua thời gian phản hồi (timing attack).
const DUMMY_HASH = '$2b$12$8fFU.znKyH1uFf2hBuS.EuZXzc8UdOgG1kFe9yruegBBgQ6KIL7Wm';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Quá nhiều lần thử đăng nhập/đăng ký. Vui lòng thử lại sau 15 phút.' },
    });
  },
});

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    createdAt: row.created_at,
  };
}

router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { fullName, email, password, phone } = validateRegistration(req.body);
    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    let rows;
    try {
      ({ rows } = await db.query(
        `INSERT INTO users (full_name, email, password_hash, phone)
         VALUES ($1, $2, $3, $4)
         RETURNING id, full_name, email, phone, role, created_at`,
        [fullName, email, passwordHash, phone]
      ));
    } catch (error) {
      if (error.code === '23505') {
        throw ApiError.conflict('EMAIL_TAKEN', 'Email này đã được đăng ký.');
      }
      throw error;
    }

    const user = rows[0];
    logger.info({ userId: user.id, email: user.email }, 'Đăng ký tài khoản mới');
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = validateLogin(req.body);
    const { rows } = await db.query(
      `SELECT id, full_name, email, phone, password_hash, role, is_active, created_at
         FROM users
        WHERE email = $1`,
      [email]
    );

    const user = rows[0];
    const hashToCompare = user ? user.password_hash : DUMMY_HASH;
    const passwordOk = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordOk || !user.is_active) {
      logger.warn({ email, ip: req.ip }, 'Đăng nhập thất bại');
      throw ApiError.unauthorized('INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
    }

    await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    logger.info({ userId: user.id, role: user.role }, 'Đăng nhập thành công');

    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, full_name, email, phone, role, created_at
         FROM users
        WHERE id = $1 AND is_active = true`,
      [req.user.id]
    );
    if (!rows[0]) {
      throw ApiError.unauthorized('ACCOUNT_DISABLED', 'Tài khoản không tồn tại hoặc đã bị khoá.');
    }
    res.json({ user: publicUser(rows[0]) });
  })
);

module.exports = router;
