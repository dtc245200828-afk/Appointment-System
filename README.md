# Hệ thống đặt lịch hẹn trực tuyến (Đề 40)

Ứng dụng web cho phép khách hàng xem dịch vụ, chọn khung giờ còn trống, đặt và huỷ lịch hẹn;
quản trị viên xác nhận/huỷ lịch, lọc và theo dõi thống kê. Toàn bộ hệ thống chạy bằng Docker Compose
với reverse proxy Nginx, giám sát Prometheus + Grafana và tập trung log về Loki.

- **Backend**: Node.js 22 + Express 4 (CommonJS), PostgreSQL 16, `pg` pool, JWT, bcrypt.
- **Frontend**: HTML/CSS/JavaScript thuần (không framework), phục vụ tĩnh bởi chính Express.
- **Hạ tầng**: Docker multi-stage (image Node.js non-root), Nginx non-root + TLS, 3 network tách biệt.
- **Giám sát**: Prometheus, Grafana (dashboard provision tự động), cAdvisor, postgres_exporter, nginx-exporter.
- **Log**: pino (JSON) + Promtail → Loki; Nginx access log dạng JSON.
- **Kiểm thử**: `node:test` (unit + integration).

## 1. Kiến trúc

```
                        Internet / Trình duyệt
                                 │
                     HTTP :80 ───┤─── HTTPS :443 (self-signed)
                                 ▼
                    ┌───────────────────────────┐
                    │  nginx (non-root, TLS)    │  rate limit 5r/s, CSP, HSTS
                    │  :8080 / :8443            │
                    └─────────────┬─────────────┘
                       network: frontend
                                 ▼
                    ┌───────────────────────────┐
                    │  app (Node.js/Express)    │  JWT, bcrypt, helmet,
                    │  :3000  +  /metrics        │  express-rate-limit, pino
                    └─────────────┬─────────────┘
                       network: backend (internal)
                                 ▼
                    ┌───────────────────────────┐
                    │  postgres:16 (volume)     │  app_user (DML),
                    │  :5432 (không publish)    │  exporter_user (pg_monitor)
                    └───────────────────────────┘

  network: monitoring
  ┌────────────┬───────────┬──────────────────┬─────────────┬──────────┐
  │ Prometheus │  Grafana  │ cAdvisor         │ postgres_   │ nginx_   │
  │ :9090      │  :3001    │ :8080 (nội bộ)   │ exporter    │ exporter │
  └────────────┴───────────┴──────────────────┴─────────────┴──────────┘
  ┌───────────────────────────────┬─────────────────────────────────────┐
  │ Loki :3100 (volume loki_data) │ Promtail (đọc nginx_logs/app_logs)  │
  └───────────────────────────────┴─────────────────────────────────────┘
```

Nguyên tắc thiết kế:

1. Chỉ Nginx được publish cổng ra ngoài (80/443). Các UI quản trị (pgAdmin, Prometheus, Grafana)
   bind `127.0.0.1`, không truy cập được từ mạng LAN.
2. `postgres` chỉ nằm trong network `backend` (đặt `internal: true` → không có egress Internet).
3. Ứng dụng chạy `read_only`, `cap_drop: ALL`, `no-new-privileges`; Nginx cũng chạy user `nginx`.
4. Mọi secret lấy từ `.env`, không hard-code trong source hay trong compose.

## 2. Cấu trúc thư mục

```
appointment-system/
├─ src/                        # Mã nguồn backend
│  ├─ server.js                # Khởi động HTTP server + graceful shutdown
│  ├─ app.js                   # Cấu hình Express (helmet, CORS, JSON, routes, errors)
│  ├─ config.js                # Đọc & kiểm tra biến môi trường (fail-fast)
│  ├─ db.js                    # pg Pool + withTransaction + health check
│  ├─ booking.js               # Nghiệp vụ đặt/xác nhận/huỷ lịch (transaction + lock)
│  ├─ validation.js            # Chuẩn hoá & kiểm tra dữ liệu đầu vào
│  ├─ errors.js                # ApiError + asyncHandler
│  ├─ metrics.js               # prom-client registry + middleware HTTP
│  ├─ logger.js                # pino (stdout + file cho Promtail), redact secrets
│  ├─ middleware/auth.js       # Xác thực JWT, phân quyền admin (kiểm tra lại DB)
│  └─ routes/                  # auth, services, appointments, admin
├─ public/                     # Frontend tĩnh (CSP-safe, không inline JS/CSS)
│  ├─ index.html               # Trang đặt lịch
│  ├─ login.html, register.html, admin.html
│  ├─ css/styles.css
│  └─ js/{common,app,login,register,admin}.js
├─ db/init/                    # 01_schema.sql, 02_roles.sql, 03_seed.sql
├─ deployment/
│  ├─ nginx.conf               # Reverse proxy + TLS + security headers
│  ├─ nginx/{Dockerfile,entrypoint.sh}
│  ├─ prometheus/{prometheus.yml,alert-rules.yml}
│  ├─ grafana/{provisioning,dashboards}
│  ├─ loki/loki-config.yml
│  ├─ promtail/promtail-config.yml
│  └─ SECURITY.md              # Báo cáo bảo mật & hardening checklist
├─ docs/                       # Báo cáo, checklist demo, truy vấn LogQL/PromQL
├─ tests/unit, tests/integration
├─ scripts/generate-secrets.js # Sinh .env với secret ngẫu nhiên
├─ Dockerfile                  # Multi-stage, chạy user node (uid 1000)
├─ docker-compose.yml          # 11 service, 9 volume, 3 network
└─ package.json
```

## 3. Yêu cầu

| Thành phần | Phiên bản tối thiểu | Ghi chú |
|---|---|---|
| Docker Engine | 24.x | Cần Compose v2 (`docker compose`) |
| Docker Desktop (Windows/macOS) | 4.30 | Bật WSL2 backend |
| RAM trống | ~3 GB | Prometheus + Grafana + Loki + PostgreSQL |
| Cổng trống | 80, 443 | Đổi `HTTP_PORT`/`HTTPS_PORT` trong `.env` nếu bận |
| Node.js | 20+ | Chỉ cần khi chạy test/không dùng Docker |

## 4. Cài đặt & chạy

### 4.1. Chuẩn bị biến môi trường

```powershell
# Windows PowerShell
node scripts/generate-secrets.js        # tạo .env với secret ngẫu nhiên
# hoặc copy thủ công rồi sửa từng giá trị
Copy-Item .env.example .env
```

```bash
# Linux / macOS
node scripts/generate-secrets.js
# hoặc: cp .env.example .env && nano .env
```

Script sinh sẵn 6 secret (mật khẩu PostgreSQL, `app_user`, `exporter_user`, `JWT_SECRET`,
pgAdmin, Grafana) và in ra thông tin đăng nhập tương ứng. `.env` đã nằm trong `.gitignore`.

### 4.2. Khởi động toàn bộ hệ thống

```bash
docker compose config -q          # kiểm tra cú pháp compose (không cần daemon)
docker compose up -d --build      # build image app + nginx rồi chạy 11 service
docker compose ps                 # xem trạng thái/health
docker compose logs -f app        # theo dõi log ứng dụng
```

Lần chạy đầu tiên: PostgreSQL chạy `db/init/*.sql` (schema → role → seed dữ liệu 14 ngày),
app chờ `postgres` healthy rồi mới start, Nginx chờ `app` healthy.

### 4.3. Kiểm tra nhanh

```bash
curl -k https://localhost/api/health
curl -k https://localhost/api/services
curl -k -I https://localhost/            # xem security headers
```

> Chứng chỉ là **self-signed** nên trình duyệt sẽ cảnh báo — chọn "Advanced → Proceed".
> Có thể thay bằng chứng chỉ thật bằng cách mount file vào volume `nginx_certs`
> (`/etc/nginx/certs/server.crt` + `server.key`).

### 4.4. Dừng / xoá dữ liệu

```bash
docker compose stop                # dừng, giữ dữ liệu
docker compose down                # xoá container + network, giữ volume
docker compose down -v             # XOÁ TOÀN BỘ dữ liệu (volume) - dùng khi muốn seed lại
```

## 5. Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `NODE_ENV` | `production` | Chế độ chạy |
| `APP_TIMEZONE` | `Asia/Ho_Chi_Minh` | Múi giờ hiển thị/tính khung giờ |
| `LOG_LEVEL` | `info` | Mức log của pino |
| `MAX_ACTIVE_APPOINTMENTS_PER_USER` | `5` | Giới hạn lịch đang hoạt động/khách |
| `JWT_SECRET` | (bắt buộc, ≥32 ký tự) | Khoá ký JWT |
| `JWT_EXPIRES_IN` | `8h` | Hạn token |
| `BCRYPT_ROUNDS` | `12` | Cost hash mật khẩu |
| `POSTGRES_DB` / `POSTGRES_USER` | `appointment` / `postgres_admin` | Database & superuser |
| `POSTGRES_PASSWORD` | (bắt buộc) | Mật khẩu superuser |
| `APP_DB_PASSWORD` | (bắt buộc, ≥16 ký tự) | Mật khẩu role `app_user` |
| `EXPORTER_DB_PASSWORD` | (bắt buộc, ≥16 ký tự) | Mật khẩu role `exporter_user` |
| `POSTGRES_PORT` | `5432` | **Không còn dùng**: PostgreSQL không publish cổng ra host (network `backend` là `internal`) |
| `HTTP_PORT` / `HTTPS_PORT` | `80` / `443` | Cổng public của Nginx |
| `NGINX_SERVER_NAME` | `localhost` | CN của chứng chỉ tự sinh |
| `PGADMIN_DEFAULT_EMAIL` / `PGADMIN_DEFAULT_PASSWORD` | `admin@appointment.local` / (bắt buộc) | Tài khoản pgAdmin |
| `PGADMIN_PORT` | `5050` | Cổng bind `127.0.0.1` |
| `PROMETHEUS_PORT` | `9090` | Cổng bind `127.0.0.1` |
| `GRAFANA_PORT` | `3001` | Cổng bind `127.0.0.1` |
| `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` | `admin` / (bắt buộc) | Tài khoản Grafana |
| `GRAFANA_ROOT_URL` | `http://localhost:3001` | URL gốc của Grafana |

## 6. Cổng & URL truy cập

| Dịch vụ | URL | Ghi chú |
|---|---|---|
| Website | https://localhost | Qua Nginx (TLS) |
| Redirect HTTP | http://localhost | 301 → HTTPS |
| API | https://localhost/api/... | Xem mục 8 |
| Health check Nginx | http://localhost:8080/healthz | Chỉ trong container |
| pgAdmin | http://localhost:5050 | Bind 127.0.0.1 |
| Prometheus | http://localhost:9090 | Targets: `/targets`, Alerts: `/alerts` |
| Grafana | http://localhost:3001 | Dashboard tự provision |
| Loki | http://localhost:3100 | Chỉ trong network monitoring |
| PostgreSQL | Không publish | Chỉ truy cập trong network `backend`; dùng `docker compose exec postgres psql ...` hoặc pgAdmin (host `postgres`, port `5432`) |

## 7. Tài khoản demo (seed)

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Quản trị viên | `admin@appointment.local` | `Admin@12345` |
| Khách hàng | `customer1@example.com` | `Demo@12345` |
| Khách hàng | `customer2@example.com` | `Demo@12345` |

> Mật khẩu seed chỉ phục vụ học tập/demo. Khi triển khai thật hãy đổi ngay và xoá dữ liệu seed.

## 8. API

Tất cả phản hồi là JSON. Endpoint cần xác thực dùng header `Authorization: Bearer <JWT>`.
Token lấy từ `/api/auth/login` hoặc `/api/auth/register`.

### 8.1. Công khai

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/health` | `status`, `database` (`up`/`down`), `databaseLatencyMs`, `uptimeSeconds` |
| GET | `/api/services` | Danh sách dịch vụ đang hoạt động + `available_slots`, kèm `timezone` |
| GET | `/api/services/:id` | Chi tiết một dịch vụ |
| GET | `/api/services/:id/slots?date=YYYY-MM-DD&days=7` | Khung giờ trống của một dịch vụ (`days` 1..60) |
| GET | `/api/slots?serviceId=&date=&days=` | Khung giờ trống của tất cả dịch vụ (tối đa 500) |
| POST | `/api/auth/register` | Đăng ký: `fullName`, `email`, `password`, `phone` → `{ token, user }` |
| POST | `/api/auth/login` | Đăng nhập: `email`, `password` → `{ token, user }` |

### 8.2. Khách hàng (JWT bắt buộc)

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/auth/me` | Thông tin tài khoản hiện tại |
| POST | `/api/appointments` | Đặt lịch: `{ "slotId": 12, "note": "..." }` → 201 |
| GET | `/api/appointments/me?status=` | Danh sách lịch hẹn của tôi (lọc theo trạng thái) |
| POST | `/api/appointments/:id/cancel` | Huỷ lịch, body tuỳ chọn `{ "reason": "..." }` |
| DELETE | `/api/appointments/:id` | Huỷ lịch (alias của endpoint trên) |

Giới hạn: mỗi tài khoản tối đa `MAX_ACTIVE_APPOINTMENTS_PER_USER` lịch đang hoạt động,
30 thao tác đặt lịch / 5 phút / tài khoản.

### 8.3. Quản trị (JWT + role `admin`)

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/admin/appointments?status=&date=&q=&page=&limit=` | Danh sách + tổng số (limit 1..100) |
| GET | `/api/admin/stats` | Thống kê tổng quan cho dashboard |
| PATCH | `/api/admin/appointments/:id/confirm` | Xác nhận lịch (idempotent, trả `alreadyConfirmed`) |
| PATCH | `/api/admin/appointments/:id/cancel` | Huỷ lịch, body `{ "reason": "..." }` |

### 8.4. Mã lỗi

Mọi lỗi có dạng `{ "error": { "code": "...", "message": "...", "details": [...] } }`.

| HTTP | Mã lỗi |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_STATUS`, `SLOT_IN_PAST` |
| 401 | `NO_TOKEN`, `INVALID_TOKEN`, `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND`, `SERVICE_NOT_FOUND`, `SLOT_NOT_FOUND`, `APPOINTMENT_NOT_FOUND` |
| 409 | `EMAIL_TAKEN`, `SLOT_UNAVAILABLE`, `ALREADY_CANCELLED`, `APPOINTMENT_STARTED`, `APPOINTMENT_COMPLETED`, `CANCEL_FAILED` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` |

### 8.5. Ví dụ

```bash
# Đăng nhập
curl -k -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"customer1@example.com","password":"Demo@12345"}'

# Lấy khung giờ trống của dịch vụ 1 trong 7 ngày tới
curl -k "https://localhost/api/services/1/slots?days=7"

# Đặt lịch
curl -k -X POST https://localhost/api/appointments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"slotId":1,"note":"Tái khám"}'
```

## 9. Kiểm thử

```bash
npm test                 # unit tests (validation, errors, serialize) - không cần DB
npm run test:integration # integration tests qua https://localhost (tự skip nếu chưa chạy compose)
npm run test:all         # chạy cả hai bộ
```

- Unit test dùng `node:test` + `node:assert/strict`, không cần thư viện ngoài.
- Integration test tự kiểm tra `/api/health` trước khi chạy; nếu không kết nối được thì **skip**
  thay vì fail, nhờ đó pipeline không đỏ khi môi trường chưa bật Docker.
- Có thể đổi URL kiểm thử bằng biến `BASE_URL` (mặc định `https://localhost`);
  đặt `ALLOW_INSECURE_TLS=false` nếu dùng chứng chỉ thật và muốn kiểm tra TLS.
- Integration test giãn nhịp ~4 request/giây (Nginx giới hạn 5 r/s) và dùng tài khoản admin
  seed để kiểm tra luồng xác nhận lịch hẹn; đổi bằng `ADMIN_EMAIL`/`ADMIN_PASSWORD` nếu cần.
  `/api/auth/` giới hạn 20 request/15 phút/IP nên khi chạy lại nhiều lần liền hãy
  `docker compose restart app` để reset bộ đếm trong bộ nhớ.

## 10. Giám sát & log

### 10.1. Prometheus

- URL: http://localhost:9090 — kiểm tra `/targets` (6 job) và `/alerts`.
- Job: `prometheus`, `appointment-web` (`app:3000/metrics`, scrape 10s), `cadvisor`,
  `postgres`, `nginx`, `loki`.
- Alert rules (`deployment/prometheus/alert-rules.yml`): `AppointmentAppDown`,
  `AppointmentDatabaseDown`, `NginxDown`, `HighHttpErrorRate` (>5% lỗi 5xx trong 5 phút),
  `HighRequestLatencyP95` (>1s), `TooManyActiveAppointments` (>50 lịch đang hoạt động).
- Không cấu hình Alertmanager để gọn phạm vi đồ án; alert hiển thị trực tiếp trên Prometheus/Grafana.

### 10.2. Grafana

- URL: http://localhost:3001 — đăng nhập bằng `GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD`.
- Datasource provision tự động: Prometheus (uid `prometheus`), Loki (uid `loki`).
- Dashboard (thư mục **Appointment System**):

| Dashboard | Nội dung |
|---|---|
| `appointment-overview` | Số request, tỉ lệ lỗi, P95 latency, uptime, container |
| `appointment-web` | HTTP theo route/status, CPU/RAM, event loop, pool kết nối |
| `appointment-database` | Kết nối, transaction, cache hit, kích thước DB, query chậm |
| `appointment-logs` | Tốc độ log, log lỗi, tìm kiếm full-text (Nginx + app) |

### 10.3. Loki + Promtail

- Ứng dụng ghi log JSON ra `stdout` **và** `app_logs:/app/logs/*.log` (pino, có `redact`).
- Nginx ghi access log dạng JSON, error log dạng text → volume `nginx_logs`.
- Promtail đọc 3 nguồn và gắn label: `job` (`nginx`/`appointment-app`), `service`,
  `log_type` (`access`/`error`/`app`), `level`, `method`, `status` (với access log).
- Truy vấn mẫu: xem [`docs/LOGQL_QUERIES.md`](docs/LOGQL_QUERIES.md).

## 11. Bảo mật

Tóm tắt (chi tiết + checklist trong [`deployment/SECURITY.md`](deployment/SECURITY.md)):

- Mật khẩu hash bcrypt cost 12; so sánh với hash giả khi email không tồn tại (chống timing attack).
- JWT HS256, secret ≥32 ký tự, hạn 8 giờ, kiểm tra lại user/role trong DB ở mỗi request admin.
- `express-rate-limit`: 20 lần/15 phút cho auth, 30 lần/5 phút cho đặt lịch; Nginx giới hạn 5 req/s/IP.
- Helmet + CSP `default-src 'self'` (frontend không dùng inline script/style), HSTS, `X-Frame-Options: DENY`.
- Truy vấn tham số hoá 100% (`$1`, `$2`, ...) → chống SQL injection.
- `app_user` chỉ có DML, `exporter_user` chỉ `pg_monitor`; `postgres` không publish ra ngoài.
- Container app/Nginx: non-root, `read_only`, `cap_drop: ALL`, `no-new-privileges`.
- Log có `redact` cho `authorization`, `cookie`, `password`, `token`.
- `.env` không commit; `scripts/generate-secrets.js` sinh secret ngẫu nhiên 24–48 byte.




## 12. Vận hành

### 12.1. Xem log

```bash
docker compose logs -f app nginx            # log container
docker compose exec promtail cat /tmp/positions/positions.yaml
docker compose exec app ls -l /app/logs     # file log chia sẻ cho Promtail
```

### 12.2. Truy cập PostgreSQL

```bash
docker compose exec postgres psql -U postgres_admin -d appointment
# PostgreSQL KHÔNG publish cổng 5432 ra host (network backend internal):
#   dùng lệnh exec ở trên, hoặc pgAdmin: http://localhost:5050 (host: postgres, port: 5432)
# tài khoản chỉ đọc: exporter_user
```

### 12.3. Sao lưu / phục hồi

```bash
# Sao lưu
docker compose exec -T postgres pg_dump -U postgres_admin -Fc appointment > backup.dump

# Phục hồi (dùng --clean để ghi đè object đã có)
docker compose exec -T postgres pg_restore -U postgres_admin -d appointment --clean --if-exists < backup.dump
```

Volume dữ liệu: `appointment-system_postgres_data` (DB), `..._grafana_data`, `..._prometheus_data`,
`..._loki_data`, `..._app_logs`, `..._nginx_logs`, `..._nginx_certs`.

### 12.4. Chạy lại seed

```bash
docker compose down -v && docker compose up -d --build
```


## 13. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `POSTGRES_PASSWORD is required` | Chưa có `.env` | `node scripts/generate-secrets.js` |
| App restart liên tục, log `ECONNREFUSED postgres` | DB chưa init xong | Chờ healthcheck; xem `docker compose logs postgres` |
| Trình duyệt cảnh báo chứng chỉ | Self-signed | Chấp nhận cảnh báo hoặc thay cert thật vào volume `nginx_certs` |
| 429 khi tải trang | Vượt rate limit 5 r/s | Giảm tần suất hoặc tăng `burst` trong `deployment/nginx.conf` |
| Grafana không có dashboard | Volume cũ giữ trạng thái provisioning | `docker compose down -v` rồi up lại |
| Promtail không gửi log | Sai quyền file/volume | Kiểm tra `docker compose logs promtail`, đảm bảo app ghi được `/app/logs` |
| `docker compose up` báo cổng bận | 80/443 đã dùng (IIS, Skype, Apache) | Đổi `HTTP_PORT`/`HTTPS_PORT` trong `.env` |
| Docker Desktop trả `HTTP 500` cho mọi lệnh | Engine/WSL backend lỗi | Restart Docker Desktop, `wsl --shutdown`, kiểm tra `docker info` |
| pgAdmin restart liên tục, log `does not appear to be a valid email address` | pgAdmin 8.x coi `.local` là domain đặc biệt | Compose đã đặt `PGADMIN_CONFIG_ALLOW_SPECIAL_EMAIL_DOMAINS: '["local"]'` |
| Không mở được `http://localhost:5050` | Container chỉ ở network `internal` thì Docker không forward port ra host | pgAdmin được gắn thêm network `monitoring` (priority 100) trong `docker-compose.yml` |

## 14. Hạn chế đã biết

1. **Stack đã được chạy và kiểm chứng đầy đủ trên Docker Desktop**: 11/11 container `Up`,
   6/6 Prometheus target `UP`, 21 unit test + 10 integration test **pass** (qua HTTPS/Nginx),
   pgAdmin truy cập được ở `http://localhost:5050`. Hạn chế còn lại nằm ở các mục 2–6 bên dưới.
2. Chứng chỉ TLS là self-signed, chỉ phù hợp demo.
3. JWT lưu trong `sessionStorage` phía client (đơn giản, tránh CSRF bằng cookie nhưng vẫn nhạy cảm với XSS —
   đã giảm thiểu bằng CSP chặt và không render HTML từ dữ liệu người dùng).
4. Không có Alertmanager, không gửi email/thông báo khi có alert.
5. Chưa có chức năng quên mật khẩu, xác thực email, thanh toán trực tuyến (ngoài phạm vi đề).
6. Dữ liệu seed (tài khoản/mật khẩu demo) phải xoá khi triển khai thật.

## 15. Tài liệu liên quan

| File | Nội dung |
|---|---|
| [`deployment/SECURITY.md`](deployment/SECURITY.md) | Báo cáo bảo mật, mô hình mối đe doạ, checklist hardening |
| [`docs/DEMO_CHECKLIST.md`](docs/DEMO_CHECKLIST.md) | Kịch bản demo từng bước + lệnh kiểm tra + kết quả mong đợi |
| [`docs/LOGQL_QUERIES.md`](docs/LOGQL_QUERIES.md) | Truy vấn LogQL/PromQL dùng khi demo |
| [`docs/BAO_CAO_DO_AN.md`](docs/BAO_CAO_DO_AN.md) | Báo cáo đồ án đầy đủ (kiến trúc, thiết kế, kiểm thử, đánh giá) |

