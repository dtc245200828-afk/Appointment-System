# Báo cáo bảo mật — Hệ thống đặt lịch hẹn (Đề 40)

Tài liệu mô tả mô hình mối đe doạ, các biện pháp đã triển khai, cách kiểm chứng và rủi ro còn lại.
Mọi kết luận đều gắn với file/tham số cụ thể trong repository.

## 1. Tài sản cần bảo vệ

| Tài sản | Vị trí | Hậu quả nếu bị xâm phạm |
|---|---|---|
| Thông tin tài khoản (email, SĐT, hash mật khẩu) | bảng `users` | Lộ dữ liệu cá nhân, chiếm tài khoản |
| Lịch hẹn của khách | bảng `appointments`, `time_slots` | Lộ lịch trình, sửa/huỷ lịch trái phép |
| JWT & `JWT_SECRET` | `.env`, `sessionStorage` | Giả mạo danh tính, leo thang quyền |
| Mật khẩu DB (`postgres_admin`, `app_user`, `exporter_user`) | `.env`, container env | Đọc/ghi/xoá toàn bộ dữ liệu |
| Log hệ thống | volume `app_logs`, `nginx_logs` | Lộ token/PII nếu không lọc |
| Dashboard quản trị | Grafana/Prometheus/pgAdmin | Lộ metric, log, cấu trúc DB |

## 2. Mô hình mối đe doạ (tóm tắt STRIDE)

| Mối đe doạ | Kịch bản | Biện pháp đối phó |
|---|---|---|
| **S**poofing | Đăng nhập bằng mật khẩu rò rỉ, giả token | bcrypt cost 12, JWT HS256 có `iss`/`aud`, hạn 8h, rate limit đăng nhập |
| **T**ampering | Sửa `slotId`, sửa `role` trong token | Kiểm tra kiểu/giới hạn đầu vào; role admin truy vấn lại DB mỗi request |
| **R**epudiation | Phủ nhận đã đặt/huỷ lịch | Log có `req.id`, user id, hành động; dữ liệu có `created_at`, `cancelled_at`, `cancel_reason` |
| **I**nformation disclosure | Đọc lịch hẹn người khác, xem log chứa token | Truy vấn lọc theo `user_id` lấy từ token; pino `redact`; PostgreSQL chỉ bind 127.0.0.1 |
| **D**enial of service | Spam đăng nhập/đặt lịch | Nginx 5 r/s + burst, `limit_conn 30`, rate limit ứng dụng, `statement_timeout` 10s |
| **E**levation of privilege | User thường gọi API admin | `requireAdmin` kiểm tra DB + `role`, trả 403; integration test xác nhận |
| SQL injection | Chèn SQL vào `q`, `status`, `id` | 100% truy vấn tham số hoá; `parsePositiveInt`, whitelist trạng thái |
| XSS | Chèn script vào `note`/`fullName` | Frontend render bằng `textContent`, CSP không cho inline script |
| Clickjacking | Nhúng iframe trang đặt lịch | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |
| Rò rỉ bí mật qua Git | Commit `.env` | `.gitignore`, chỉ commit `.env.example`, secret sinh ngẫu nhiên |
| Leo thang trong container | RCE trong container app | non-root, `read_only`, `cap_drop: ALL`, `no-new-privileges` |

## 3. Kiểm soát đã triển khai

### 3.1. Xác thực & phân quyền

| Biện pháp | Chi tiết | File |
|---|---|---|
| Hash mật khẩu | bcrypt cost 12 (cấu hình 10–15), không lưu plaintext | `src/routes/auth.js`, `src/config.js` |
| Chống dò email | So sánh với `DUMMY_HASH` khi email không tồn tại → thời gian phản hồi tương đương | `src/routes/auth.js` |
| Chính sách mật khẩu | 8–72 ký tự, đủ chữ hoa/thường/số/ký tự đặc biệt | `src/validation.js` |
| JWT | HS256, `issuer`/`audience` cố định, hạn 8h, secret ≥32 ký tự và chặn giá trị mẫu ở production | `src/middleware/auth.js`, `src/config.js` |
| Phân quyền admin | `requireAdmin` truy vấn lại `users.role` + `is_active` trong DB | `src/middleware/auth.js` |
| Kiểm tra tài khoản bị khoá | `/api/auth/me` và `requireAdmin` trả `ACCOUNT_DISABLED` | `src/routes/auth.js` |
| Giới hạn tài nguyên | Tối đa 5 lịch đang hoạt động/khách (đổi bằng env) | `src/booking.js`, `.env.example` |

### 3.2. Kiểm tra dữ liệu đầu vào

- `src/validation.js`: chuẩn hoá email (trim + lowercase), giới hạn độ dài tên (2–100), SĐT (9–15 số),
  ghi chú ≤500 ký tự, `parsePositiveInt`, `parseDateParam` (đúng `YYYY-MM-DD`), `parseDays` 1..60.
- `express.json({ limit: '100kb' })` + `urlencoded` → chặn payload lớn.
- Whitelist trạng thái lịch hẹn (`pending`, `confirmed`, `cancelled`, `completed`), giá trị lạ trả `INVALID_STATUS`.
- Lỗi trả về theo cấu trúc thống nhất, không lộ stack trace ở production (`src/middleware/errorHandler.js`).

### 3.3. Chống lạm dụng (rate limiting)

| Lớp | Giới hạn | File |
|---|---|---|
| Nginx | 5 r/s/IP (`burst` 5 cho `/api/auth/`, 10 cho `/api/`, 30 cho trang tĩnh), 30 kết nối đồng thời/IP, trả 429 | `deployment/nginx.conf` |
| Auth API | 20 request / 15 phút / IP | `src/routes/auth.js` |
| Đặt lịch | 30 request / 5 phút / user (fallback IP) | `src/routes/appointments.js` |
| Body/timeout | `client_max_body_size 1m`, `client_body_timeout 15s`, `proxy_read_timeout 60s` | `deployment/nginx.conf` |

### 3.4. Bảo vệ dữ liệu trong PostgreSQL

| Biện pháp | Chi tiết | File |
|---|---|---|
| Tài khoản tối thiểu quyền | `app_user`: chỉ `SELECT/INSERT/UPDATE/DELETE`, `NOINHERIT`, `REVOKE CREATE ON SCHEMA public` (không DDL) | `db/init/02_roles.sql` |
| Tách quyền giám sát | `exporter_user` chỉ có `pg_monitor` + `SELECT` | `db/init/02_roles.sql` |
| Thu hẹp PUBLIC | `REVOKE ALL ON DATABASE/SCHEMA FROM PUBLIC` | `db/init/02_roles.sql` |
| Mật khẩu role | Bắt buộc ≥16 ký tự, `\getenv` + raise exception nếu thiếu | `db/init/02_roles.sql` |
| Kết nối | `scram-sha-256`, `--data-checksums`, network `backend` internal | `docker-compose.yml` |
| Chống đặt trùng | Transaction + `SELECT ... FOR UPDATE` trên `time_slots`, unique `(service_id, start_time)` | `src/booking.js`, `db/init/01_schema.sql` |
| Timeout truy vấn | `statement_timeout` 10s, pool tối đa 10 kết nối | `src/db.js`, `src/config.js` |

### 3.5. TLS & HTTP security headers

- Nginx chỉ phục vụ HTTPS (TLS 1.2/1.3), HTTP 301 → HTTPS; `ssl_session_tickets off`,
  bộ cipher ECDHE-GCM/CHACHA20; `server_tokens off`.
- Header: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Content-Security-Policy`
  (`default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; object-src 'none'`).
- Ứng dụng đặt thêm lớp header tương đương bằng Helmet (`src/app.js`), tắt `x-powered-by`.
- Frontend **không** dùng inline `<script>`/`style` hay `onclick=` → CSP không cần `unsafe-inline`.
- Chặn truy cập file ẩn (`.git`, `.env`) và trả 404 cho `/metrics` từ Internet.

### 3.6. Bảo vệ container & mạng

| Biện pháp | Chi tiết | File |
|---|---|---|
| Non-root | App chạy user `node` (uid 1000); Nginx chạy user `nginx` | `Dockerfile`, `deployment/nginx/Dockerfile` |
| Filesystem chỉ đọc | `read_only: true` + `tmpfs: /tmp` (Nginx thêm `/var/cache/nginx`) | `docker-compose.yml` |
| Giảm đặc quyền | `cap_drop: ALL`, `no-new-privileges:true` cho app/nginx/prometheus/grafana/exporter | `docker-compose.yml` |
| Tách network | `frontend` (nginx↔app), `backend` internal (app↔db), `monitoring` | `docker-compose.yml` |
| Không publish DB | `postgres` **không map cổng ra host**, chỉ tồn tại trong network `backend` (internal) | `docker-compose.yml` |
| UI quản trị nội bộ | pgAdmin/Prometheus/Grafana bind `127.0.0.1`; pgAdmin gắn thêm network `monitoring` (Docker không forward port của container chỉ ở network internal) | `docker-compose.yml` |
| Giới hạn log | `json-file` max 10 MB × 3 file/container | `docker-compose.yml` |
| Healthcheck | App, Nginx, PostgreSQL, Prometheus, Grafana, Loki đều có healthcheck | `docker-compose.yml` |
| Graceful shutdown | `server.close()` + đóng pool khi SIGTERM/SIGINT, tini làm PID 1 | `src/server.js`, `Dockerfile` |

> Ngoại lệ có kiểm soát: `cadvisor` cần `privileged` + mount `/sys`, `/var/lib/docker` (đặc thù công cụ),
> không publish cổng và chỉ nằm trong network `monitoring`.

### 3.7. Ghi log an toàn

- pino `redact`: `authorization`, `cookie`, `req.body.password`, `passwordHash`, `token`, `set-cookie` → `[REDACTED]`.
- Nginx access log không ghi body, không ghi `Authorization`; chỉ ghi method/URI/status/thời gian.
- Log tách volume, Promtail chỉ đọc (read-only mount), retention Loki 7 ngày (`retention_period: 168h`).
- `/metrics` và `/api/health` được loại khỏi auto-logging để tránh nhiễu.

### 3.8. Quản lý bí mật

- `.env` nằm trong `.gitignore`; chỉ `.env.example` được commit (giá trị mẫu, không dùng được).
- `docker compose` dùng cú pháp `${VAR:?message}` → dừng ngay nếu thiếu secret quan trọng.
- `scripts/generate-secrets.js` sinh secret bằng `crypto.randomBytes` (24–48 byte), ghi file mode `0600`.
- Ứng dụng fail-fast nếu `JWT_SECRET` < 32 ký tự hoặc chứa chuỗi mẫu (`change-me`, `secret`, ...) ở production.

## 4. Cách kiểm chứng

```bash
# 1. Cấu hình compose hợp lệ, không thiếu biến bắt buộc
docker compose config -q

# 2. Bí mật không bị commit
git check-ignore -v .env
git ls-files | findstr /i ".env"      # Windows (chỉ thấy .env.example)

# 3. Header bảo mật & redirect HTTPS
curl -k -I https://localhost/
curl -I http://localhost/             # mong đợi 301

# 4. Chặn /metrics và file ẩn từ Internet
curl -k -o NUL -w "%{http_code}\n" https://localhost/metrics   # 404
curl -k -o NUL -w "%{http_code}\n" https://localhost/.env      # 404

# 5. Phân quyền API
curl -k -o NUL -w "%{http_code}\n" https://localhost/api/admin/stats   # 401

# 6. Quyền của role DB (không được tạo bảng)
docker compose exec postgres psql -U app_user -d appointment -c "CREATE TABLE hack(id int);"
# mong đợi: ERROR: permission denied for schema public

# 7. Container không chạy root
docker compose exec app id            # uid=1000(node)
docker compose exec nginx id          # uid=101(nginx)

# 8. Unit test
npm test

# 9. pgAdmin (bind loopback)
curl -o NUL -w "%{http_code}\n" http://127.0.0.1:5050/login    # 200
```

Kết quả đã chạy trong môi trường hiện tại:

| Kiểm tra | Kết quả |
|---|---|
| `docker compose config -q` | Pass (exit 0) — cú pháp và biến bắt buộc hợp lệ |
| `docker compose ps -a` | 11/11 container `Up`; app/nginx/postgres/prometheus/loki/cadvisor healthy |
| `npm test` | 21/21 pass |
| `npm run test:integration` | 10/10 pass qua `https://localhost` (Nginx TLS), 0 skip |
| Prometheus `/api/v1/targets` | 6/6 target `UP`; 2 nhóm alert rule `health = ok` |
| Header/route | `X-Frame-Options: DENY` (một bộ header duy nhất), HTTP→301, `/metrics` & `/.env` 404, `/api/admin/stats` 401 |
| Non-root & hardening | app `uid=1000(node)`, nginx `uid=101(nginx)`, `read_only=true`, `cap_drop=[ALL]`, `no-new-privileges` |
| pgAdmin | `http://127.0.0.1:5050/login` → 200; kết nối `postgres:5432` trong network `backend` OK |
| Docker daemon | Hoạt động (Docker Desktop 4.31.0) sau khi restart engine/WSL |

## 5. Checklist trước khi demo / nộp bài

- [ ] `.env` được sinh mới bằng `node scripts/generate-secrets.js` (không dùng giá trị mẫu).
- [ ] `git status` không có `.env`, không có `node_modules/`, không có log.
- [ ] `docker compose config -q` không lỗi; `docker compose up -d --build` tất cả service `healthy`.
- [ ] `https://localhost` tải được trang đặt lịch; HTTP chuyển hướng 301 sang HTTPS.
- [ ] Đăng nhập `admin@appointment.local` thấy `/admin.html`; tài khoản khách bị chặn (403/redirect).
- [ ] Đặt lịch thành công, đặt trùng khung giờ trả 409; huỷ lịch giải phóng khung giờ.
- [ ] Prometheus `/targets` tất cả `UP`, `/alerts` hiển thị rule.
- [ ] Grafana có 4 dashboard, dữ liệu hiển thị; Loki có log 3 nguồn.
- [ ] `curl -k -I https://localhost/` có đủ HSTS/CSP/X-Frame-Options; `/metrics` trả 404.
- [ ] `app_user` không tạo được bảng (kiểm tra ở mục 4.6).
- [ ] Đổi mật khẩu seed hoặc ghi rõ trong báo cáo là dữ liệu demo.

## 6. Rủi ro còn lại & khuyến nghị

| Rủi ro | Mức | Khuyến nghị |
|---|---|---|
| JWT lưu `sessionStorage`, không có cơ chế thu hồi token | Trung bình | Thêm refresh token ngắn hạn + danh sách thu hồi (Redis) hoặc chuyển sang cookie `HttpOnly` + CSRF token |
| Chưa có MFA, chưa có reset mật khẩu | Trung bình | Bổ sung OTP email/SMS và luồng reset có token một lần |
| Chứng chỉ self-signed | Thấp (demo) | Dùng Let's Encrypt/ACME hoặc cert nội bộ do tổ chức cấp |
| Không có Alertmanager → alert không được gửi đi | Thấp | Thêm Alertmanager + webhook/Telegram/email |
| pgAdmin không chạy hardened, không có `read_only` | Thấp | Chỉ bật khi cần, hoặc thay bằng `psql`/client ngoài |
| Chưa quét lỗ hổng image tự động | Thấp | Thêm `trivy image` vào pipeline, ghim digest image |
| Rate limit theo IP có thể ảnh hưởng người dùng chung NAT | Thấp | Theo dõi 429, điều chỉnh `burst`/`rate` theo tải thực tế |
| Docker Desktop lỗi engine trên máy demo | Cao (vận hành) | Restart Docker Desktop/`wsl --shutdown`, hoặc demo trên máy Linux có Docker Engine |

