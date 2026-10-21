#!/usr/bin/env node
'use strict';

/**
 * Sinh file .env từ .env.example với mật khẩu/khoá ngẫu nhiên.
 *
 * Cách dùng:
 *   node scripts/generate-secrets.js            # tạo .env (bỏ qua nếu đã tồn tại)
 *   node scripts/generate-secrets.js --force    # ghi đè .env hiện có
 *
 * Script chỉ dùng module có sẵn của Node.js, không cần cài thêm package.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const examplePath = path.join(projectRoot, '.env.example');
const targetPath = path.join(projectRoot, '.env');
const force = process.argv.includes('--force');

// Các biến sẽ được thay bằng giá trị ngẫu nhiên (độ dài byte của entropy)
const SECRET_KEYS = {
  POSTGRES_PASSWORD: 24,
  APP_DB_PASSWORD: 24,
  EXPORTER_DB_PASSWORD: 24,
  JWT_SECRET: 48,
  PGADMIN_DEFAULT_PASSWORD: 18,
  GRAFANA_ADMIN_PASSWORD: 18,
};

function randomToken(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function main() {
  if (!fs.existsSync(examplePath)) {
    console.error(`Không tìm thấy ${examplePath}`);
    process.exit(1);
  }

  if (fs.existsSync(targetPath) && !force) {
    console.error('File .env đã tồn tại. Dùng --force nếu muốn ghi đè.');
    process.exit(1);
  }

  const generated = new Map();
  for (const [key, bytes] of Object.entries(SECRET_KEYS)) {
    generated.set(key, randomToken(bytes));
  }

  const lines = fs.readFileSync(examplePath, 'utf8').split(/\r?\n/);
  const output = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) return line;
    const [, key] = match;
    return generated.has(key) ? `${key}=${generated.get(key)}` : line;
  });

  fs.writeFileSync(targetPath, `${output.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });

  console.log(`Đã tạo ${targetPath} với ${generated.size} giá trị bí mật ngẫu nhiên.\n`);
  console.log('Thông tin đăng nhập cho môi trường demo:');
  console.log(`  PostgreSQL admin : postgres_admin / ${generated.get('POSTGRES_PASSWORD')}`);
  console.log(`  pgAdmin          : admin@appointment.local / ${generated.get('PGADMIN_DEFAULT_PASSWORD')}`);
  console.log(`  Grafana          : admin / ${generated.get('GRAFANA_ADMIN_PASSWORD')}`);
  console.log('\nLưu ý: KHÔNG commit file .env lên Git (đã có trong .gitignore).');
}

main();
