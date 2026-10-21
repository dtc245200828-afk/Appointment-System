'use strict';

const client = require('prom-client');
const { pool } = require('./db');

const register = new client.Registry();

register.setDefaultLabels({ service: 'appointment-web' });

// Metrics mặc định: CPU, RSS (RAM), heap, GC, event loop, file descriptors...
client.collectDefaultMetrics({ register, prefix: 'nodejs_' });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Tổng số HTTP request nhận được',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Thời gian xử lý HTTP request (giây)',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Số HTTP request đang được xử lý',
  registers: [register],
});

const httpErrorsTotal = new client.Counter({
  name: 'http_errors_total',
  help: 'Tổng số HTTP response lỗi 5xx do ứng dụng sinh ra',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

const activeAppointmentsGauge = new client.Gauge({
  name: 'appointments_active',
  help: 'Số lịch hẹn đang chờ xác nhận hoặc đã xác nhận',
  registers: [register],
});

const appointmentsCreatedTotal = new client.Counter({
  name: 'appointments_created_total',
  help: 'Tổng số lịch hẹn được tạo thành công',
  registers: [register],
});

const appointmentsConfirmedTotal = new client.Counter({
  name: 'appointments_confirmed_total',
  help: 'Tổng số lịch hẹn được quản trị viên xác nhận',
  registers: [register],
});

const appointmentsCancelledTotal = new client.Counter({
  name: 'appointments_cancelled_total',
  help: 'Tổng số lịch hẹn bị huỷ',
  labelNames: ['actor_role'],
  registers: [register],
});

const bookingConflictsTotal = new client.Counter({
  name: 'appointment_booking_conflicts_total',
  help: 'Số lần đặt lịch bị từ chối do khung giờ không còn trống',
  registers: [register],
});


const databaseUpGauge = new client.Gauge({
  name: 'database_up',
  help: 'PostgreSQL có phản hồi hay không (1 = up, 0 = down)',
  registers: [register],
});

const databaseQueryDuration = new client.Histogram({
  name: 'database_query_duration_seconds',
  help: 'Thời gian thực thi query PostgreSQL (giây)',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
  registers: [register],
});

/**
 * Middleware đo request/latency. Đặt trước tất cả các route.
 * `route` được lấy sau khi router đã match (nhờ res.on('finish')).
 */
function metricsMiddleware(req, res, next) {
  if (req.path === '/metrics') return next();

  const start = process.hrtime.bigint();
  httpRequestsInFlight.inc();

  res.on('finish', () => {
    httpRequestsInFlight.dec();
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const matched = req.route ? `${req.baseUrl || ''}${req.route.path}` : null;
    const route = matched ? matched.replace(/\/+/g, '/') : 'unmatched';
    const labels = { method: req.method, route, status: String(res.statusCode) };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, durationSeconds);
    if (res.statusCode >= 500) {
      httpErrorsTotal.inc(labels);
    }
  });

  next();
}

const poolTotalGauge = new client.Gauge({
  name: 'pg_pool_total_connections',
  help: 'Tổng số connection trong pool của ứng dụng',
  registers: [register],
});

const poolIdleGauge = new client.Gauge({
  name: 'pg_pool_idle_connections',
  help: 'Số connection đang idle trong pool',
  registers: [register],
});

const poolWaitingGauge = new client.Gauge({
  name: 'pg_pool_waiting_requests',
  help: 'Số request đang chờ connection từ pool',
  registers: [register],
});

const databaseConnectionsGauge = new client.Gauge({
  name: 'pg_stat_activity_connections',
  help: 'Số session đang kết nối tới database hiện tại',
  registers: [register],
});

async function refreshDatabaseMetrics() {
  const startedAt = process.hrtime.bigint();
  try {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*) FROM appointments WHERE status IN ('pending','confirmed'))::int AS active,
         (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS connections`
    );
    databaseUpGauge.set(1);
    activeAppointmentsGauge.set(rows[0].active);
    databaseConnectionsGauge.set(rows[0].connections);
    poolTotalGauge.set(pool.totalCount);
    poolIdleGauge.set(pool.idleCount);
    poolWaitingGauge.set(pool.waitingCount);
  } catch (error) {
    databaseUpGauge.set(0);
  } finally {
    databaseQueryDuration.observe(
      { operation: 'collect_metrics' },
      Number(process.hrtime.bigint() - startedAt) / 1e9
    );
  }
}

let metricsTimer = null;

function startMetricsCollector(intervalMs = 15_000) {
  if (metricsTimer) return metricsTimer;
  refreshDatabaseMetrics();
  metricsTimer = setInterval(refreshDatabaseMetrics, intervalMs);
  metricsTimer.unref();
  return metricsTimer;
}

function stopMetricsCollector() {
  if (metricsTimer) {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
}

async function metricsHandler(req, res) {
  res.setHeader('Content-Type', register.contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(await register.metrics());
}

module.exports = {
  register,
  metricsMiddleware,
  metricsHandler,
  httpRequestsTotal,
  httpRequestDuration,
  httpErrorsTotal,
  databaseUpGauge,
  databaseQueryDuration,
  appointmentsCreatedTotal,
  appointmentsConfirmedTotal,
  appointmentsCancelledTotal,
  bookingConflictsTotal,
  startMetricsCollector,
  stopMetricsCollector,
  refreshDatabaseMetrics,
};
