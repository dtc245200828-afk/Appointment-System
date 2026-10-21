'use strict';

const { Pool } = require('pg');
const config = require('./config');
const logger = require('./logger');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: config.dbStatementTimeoutMs,
  query_timeout: config.dbStatementTimeoutMs,
  application_name: 'appointment-web',
});

// Lỗi trên connection idle (ví dụ Postgres restart) không được làm sập process.
pool.on('error', (error) => {
  logger.error({ err: error }, 'Lỗi connection pool PostgreSQL');
});

async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Chạy callback trong một transaction thật (BEGIN/COMMIT/ROLLBACK).
 * Callback nhận một client duy nhất, bắt buộc dùng client này cho mọi query.
 */
async function withTransaction(callback, { isolationLevel = 'READ COMMITTED' } = {}) {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'ROLLBACK thất bại');
    }
    throw error;
  } finally {
    if (!released) {
      released = true;
      client.release();
    }
  }
}

async function ping() {
  const startedAt = process.hrtime.bigint();
  await pool.query('SELECT 1');
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

async function closePool() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, ping, closePool };
