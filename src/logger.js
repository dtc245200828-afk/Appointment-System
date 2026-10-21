'use strict';

const path = require('node:path');
const pino = require('pino');
const config = require('./config');

// Log JSON một dòng/1 sự kiện để Promtail parse bằng pipeline `json`.
// Ghi đồng thời ra stdout (docker logs) và ra file trong volume chia sẻ với Promtail.
const streams = [{ level: config.logLevel, stream: process.stdout }];

if (config.logDir) {
  const file = path.join(config.logDir, config.logFile);
  try {
    streams.push({ level: config.logLevel, stream: pino.destination({ dest: file, sync: false, mkdir: true }) });
  } catch (error) {
    console.warn(`[logger] Không mở được file log ${file}: ${error.message}`);
  }
}

const logger = pino(
  {
    level: config.logLevel,
    base: {
      service: 'appointment-web',
      env: config.nodeEnv,
      pid: process.pid,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.passwordHash',
        'password',
        'passwordHash',
        'token',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  pino.multistream(streams, { levels: { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 } })
);

module.exports = logger;
