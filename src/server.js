'use strict';

const http = require('node:http');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const { createApp } = require('./app');
const { startMetricsCollector, stopMetricsCollector } = require('./metrics');

const app = createApp();
const server = http.createServer(app);

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = 30_000;

server.listen(config.port, '0.0.0.0', () => {
  logger.info(
    { port: config.port, env: config.nodeEnv, timezone: config.appTimezone },
    'Appointment System API đang chạy'
  );
  startMetricsCollector();
});

db.ping()
  .then((ms) => logger.info({ latencyMs: Number(ms.toFixed(2)) }, 'Kết nối PostgreSQL thành công'))
  .catch((error) => logger.error({ err: error }, 'Không kết nối được PostgreSQL khi khởi động'));

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Bắt đầu tắt server (graceful shutdown)');

  stopMetricsCollector();

  const forceExit = setTimeout(() => {
    logger.error('Quá thời gian chờ, buộc dừng process');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await db.closePool();
      logger.info('Đã đóng HTTP server và connection pool');
    } catch (error) {
      logger.error({ err: error }, 'Lỗi khi đóng connection pool');
    }
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception, dừng process');
  process.exit(1);
});
