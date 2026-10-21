'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const config = require('./config');
const logger = require('./logger');
const db = require('./db');
const { metricsMiddleware, metricsHandler } = require('./metrics');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const serviceRoutes = require('./routes/services');
const appointmentRoutes = require('./routes/appointments');
const adminRoutes = require('./routes/admin');

const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  upgradeInsecureRequests: null,
};

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // Request id để correlate log giữa Nginx và ứng dụng.
  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && incoming.length <= 100 ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  app.use(metricsMiddleware);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: {
        ignore: (req) => req.url === '/metrics' || req.url === '/api/health',
      },
      customLogLevel: (req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
      customErrorMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
          userAgent: req.headers['user-agent'],
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    })
  );

  // Security headers ở tầng ứng dụng (Nginx đặt thêm một lớp headers tương đương).
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: CSP_DIRECTIVES },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Trùng giá trị với Nginx (X-Frame-Options: DENY) để hai lớp không xung đột
      xFrameOptions: { action: 'deny' },
      hsts: false, // HSTS chỉ bật ở Nginx trên cổng HTTPS
    })
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.get('/api/health', async (req, res) => {
    let database = 'up';
    let databaseLatencyMs = null;
    try {
      databaseLatencyMs = Number((await db.ping()).toFixed(2));
    } catch (error) {
      database = 'down';
      logger.error({ err: error }, 'Healthcheck: không kết nối được PostgreSQL');
    }
    res.status(200).json({
      status: 'ok',
      service: 'appointment-web',
      database,
      databaseLatencyMs,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Chỉ Prometheus (trong network monitoring) scrape endpoint này; Nginx chặn /metrics từ Internet.
  app.get('/metrics', metricsHandler);

  app.use('/api/auth', authRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', serviceRoutes);

  app.use(
    express.static(config.publicDir, {
      index: 'index.html',
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (path.extname(filePath) === '.html') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
