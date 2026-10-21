'use strict';

const path = require('node:path');
const fs = require('node:fs');

// dotenv chỉ dùng khi chạy ngoài Docker (không override biến môi trường có sẵn).
require('dotenv').config({ path: process.env.ENV_FILE || path.join(__dirname, '..', '.env') });

function fail(message) {
  // Không dùng logger ở đây để tránh phụ thuộc vòng.
  console.error(`[config] ${message}`);
  process.exit(1);
}

function readInt(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${name} phải là số nguyên trong khoảng ${min}..${max}, nhận được "${raw}"`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret.length < 32) {
  fail('JWT_SECRET phải được đặt và dài tối thiểu 32 ký tự. Sinh secret bằng: node scripts/generate-secrets.js');
}
if (isProduction && /change[-_ ]?me|secret|example|password/i.test(jwtSecret)) {
  fail('JWT_SECRET đang dùng giá trị mẫu/không an toàn. Hãy sinh secret thật bằng: node scripts/generate-secrets.js');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  fail('Thiếu DATABASE_URL, ví dụ: postgresql://app_user:matkhau@postgres:5432/appointment');
}

const logDir = process.env.LOG_DIR === '' ? null : (process.env.LOG_DIR || path.join(__dirname, '..', 'logs'));

const config = {
  nodeEnv,
  isProduction,
  port: readInt('PORT', 3000, { min: 1, max: 65535 }),
  trustProxy: readInt('TRUST_PROXY', 1, { min: 0, max: 10 }),
  databaseUrl,
  dbPoolMax: readInt('DB_POOL_MAX', 10, { min: 1, max: 100 }),
  dbStatementTimeoutMs: readInt('DB_STATEMENT_TIMEOUT_MS', 10000, { min: 1000, max: 120000 }),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  jwtIssuer: 'appointment-system',
  jwtAudience: 'appointment-system-web',
  bcryptRounds: readInt('BCRYPT_ROUNDS', 12, { min: 10, max: 15 }),
  appTimezone: process.env.APP_TIMEZONE || 'Asia/Ho_Chi_Minh',
  logLevel: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  logDir,
  logFile: process.env.LOG_FILE || 'app.log',
  maxActiveAppointmentsPerUser: readInt('MAX_ACTIVE_APPOINTMENTS_PER_USER', 5, { min: 1, max: 50 }),
  publicDir: path.join(__dirname, '..', 'public'),
};

// Chỉ tạo thư mục log khi thực sự cần (Docker mount volume /app/logs).
if (config.logDir) {
  try {
    fs.mkdirSync(config.logDir, { recursive: true });
  } catch (error) {
    // Không có quyền ghi (ví dụ read-only filesystem) -> chỉ log ra stdout.
    console.warn(`[config] Không tạo được thư mục log "${config.logDir}": ${error.message}. Chỉ ghi log ra stdout.`);
    config.logDir = null;
  }
}

module.exports = config;
