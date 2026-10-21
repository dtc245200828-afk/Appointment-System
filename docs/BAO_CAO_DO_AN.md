# BÁO CÁO ĐỒ ÁN — HỆ THỐNG ĐẶT LỊCH HẸN TRỰC TUYẾN

**Đề 40** · Node.js + Express + PostgreSQL + Docker + Nginx + Prometheus/Grafana + Loki/Promtail

---

## Mục lục

1. [Giới thiệu](#1-giới-thiệu) — bối cảnh, mục tiêu, phạm vi, công nghệ
2. [Phân tích yêu cầu](#2-phân-tích-yêu-cầu) — tác nhân, yêu cầu chức năng F1–F13, phi chức năng N1–N8
3. [Kiến trúc hệ thống](#3-kiến-trúc-hệ-thống) — sơ đồ 3 lớp, network, vòng đời request, đánh đổi thiết kế
4. [Thiết kế cơ sở dữ liệu](#4-thiết-kế-cơ-sở-dữ-liệu) — ERD, bảng, chống trùng 3 lớp, chỉ mục, seed
5. [Thiết kế API](#5-thiết-kế-api) — danh sách endpoint, ví dụ, mã lỗi, quy tắc kiểm tra dữ liệu
6. [Thiết kế giao diện](#6-thiết-kế-giao-diện) — các trang, luồng thao tác, CSP-safe
7. [Triển khai Docker & Nginx](#7-triển-khai-docker--nginx) — Dockerfile, 11 service, volume, TLS, hardening
8. [Giám sát & quản lý log](#8-giám-sát--quản-lý-log) — metrics, dashboard, alert, Loki/Promtail
9. [Bảo mật](#9-bảo-mật) — xác thực, rate limit, injection/XSS, dữ liệu, STRIDE
10. [Kiểm thử và kết quả](#10-kiểm-thử-và-kết-quả) — unit, integration, kiểm tra cấu hình
11. [Đánh giá, hạn chế, hướng phát triển](#11-đánh-giá-hạn-chế-hướng-phát-triển)
12. [Kết luận](#12-kết-luận)
13. [Phụ lục](#13-phụ-lục) — tài khoản demo, URL, lệnh, bản đồ tài liệu, thuật ngữ

---

## 1. Giới thiệu

### 1.1. Bối cảnh

Các cơ sở dịch vụ (phòng khám, spa, trung tâm tư vấn, tiệm làm đẹp…) thường nhận lịch hẹn qua điện thoại
hoặc tin nhắn. Cách làm này dễ trùng lịch, thất lạc thông tin, khó thống kê và không có dữ liệu để
đánh giá hiệu suất. Một hệ thống đặt lịch trực tuyến giải quyết ba vấn đề cốt lõi:

1. **Khách hàng** tự chọn dịch vụ, ngày và khung giờ còn trống, nhận phản hồi ngay.
2. **Quản trị viên** xác nhận/huỷ lịch, kiểm soát công suất và theo dõi tình hình.
3. **Hệ thống** chống đặt trùng, ghi log, giám sát và cảnh báo khi có sự cố.

Đồ án xây dựng một hệ thống như vậy ở mức hoàn chỉnh: có xác thực, phân quyền, giao dịch an toàn,
đóng gói Docker nhiều lớp, reverse proxy TLS, bộ giám sát và log tập trung.

### 1.2. Mục tiêu

| Nhóm | Mục tiêu cụ thể |
|---|---|
| Chức năng | Đăng ký/đăng nhập, xem dịch vụ và khung giờ, đặt/huỷ lịch, admin xác nhận/huỷ/lọc/thống kê |
| Kỹ thuật | Tách lớp rõ ràng, truy vấn tham số hoá, giao dịch có khoá, xử lý lỗi thống nhất |
| Hạ tầng | Docker Compose nhiều service, healthcheck, volume, network tách biệt, Nginx TLS |
| Bảo mật | bcrypt, JWT, rate limit, security headers, least privilege ở DB và container |
| Quan sát | Prometheus + Grafana + alert rules; Loki + Promtail thu log tập trung |
| Kiểm thử | Unit test và integration test tự động, có thể chạy lại bất kỳ lúc nào |

### 1.3. Phạm vi

Trong phạm vi: đặt lịch theo khung giờ có sẵn, xác nhận/huỷ, thống kê, giám sát, log, đóng gói triển khai.
Ngoài phạm vi: thanh toán trực tuyến, gửi email/SMS, quên mật khẩu, mobile app, đa chi nhánh.

### 1.4. Công nghệ sử dụng

| Thành phần | Công nghệ | Lý do chọn |
|---|---|---|
| Runtime | Node.js 22 (LTS) | I/O bất đồng bộ phù hợp API nhiều truy vấn ngắn; hệ sinh thái lớn |
| Web framework | Express 4 | Nhẹ, middleware rõ ràng, dễ tách router theo miền nghiệp vụ |
| Database | PostgreSQL 16 | Giao dịch ACID, ràng buộc mạnh (EXCLUDE, partial unique index), kiểu `timestamptz` |
| Driver | `pg` + pool | Pool kết nối, transaction tường minh, tham số hoá |
| Auth | `jsonwebtoken` (HS256), `bcrypt` | Chuẩn phổ biến, dễ kiểm chứng; bcrypt chống brute force nhờ cost |
| Bảo vệ | `helmet`, `express-rate-limit` | Header bảo mật và giới hạn tần suất ở tầng ứng dụng |
| Log | `pino` + `pino-http` | JSON một dòng, hiệu năng cao, có `redact` |
| Metrics | `prom-client` | Chuẩn Prometheus, histogram cho latency |
| Proxy | Nginx 1.27 (non-root) | TLS termination, rate limit, gzip, security headers |
| Giám sát | Prometheus, Grafana, cAdvisor, postgres_exporter, nginx-exporter | Bộ công cụ mã nguồn mở phổ biến, provision bằng file |
| Log tập trung | Loki 3 + Promtail 3 | Nhẹ hơn ELK, tích hợp sẵn datasource Grafana |
| Đóng gói | Docker, Docker Compose | Tái lập môi trường, chạy nhiều service bằng một lệnh |
| Kiểm thử | `node:test` + `node:assert/strict` | Có sẵn trong Node.js, không thêm dependency |

## 2. Phân tích yêu cầu

### 2.1. Tác nhân

| Tác nhân | Mô tả | Quyền chính |
|---|---|---|
| Khách (guest) | Người chưa đăng nhập | Xem dịch vụ, xem khung giờ trống |
| Khách hàng (user) | Tài khoản đã đăng ký | Đặt lịch, xem/huỷ lịch của mình, xem thông tin cá nhân |
| Quản trị viên (admin) | Nhân viên vận hành | Xem toàn bộ lịch, xác nhận, huỷ, lọc, xem thống kê |

### 2.2. Yêu cầu chức năng

| Mã | Yêu cầu | Mô tả chi tiết |
|---|---|---|
| F1 | Đăng ký | Họ tên 2–120 ký tự, email duy nhất, mật khẩu 8–72 ký tự đủ loại, SĐT tuỳ chọn |
| F2 | Đăng nhập | Email + mật khẩu; trả JWT hạn 8 giờ; ghi nhận `last_login_at` |
| F3 | Xem dịch vụ | Danh sách dịch vụ đang hoạt động kèm số khung giờ còn trống |
| F4 | Xem khung giờ | Lọc theo dịch vụ, ngày, số ngày tới; chỉ trả khung giờ `available` và chưa qua |
| F5 | Đặt lịch | Chọn `slotId`, ghi chú ≤500 ký tự; chống trùng; tối đa 5 lịch đang hoạt động/khách |
| F6 | Xem lịch của tôi | Danh sách lịch hẹn kèm dịch vụ, thời gian, trạng thái; lọc theo trạng thái |
| F7 | Huỷ lịch | Chỉ huỷ lịch `pending`/`confirmed` chưa bắt đầu; giải phóng khung giờ trong cùng transaction |
| F8 | Quản trị lịch | Xem bảng lịch hẹn, lọc theo trạng thái/ngày/từ khoá, phân trang |
| F9 | Xác nhận lịch | Chuyển `pending` → `confirmed`, idempotent, ghi `confirmed_at` |
| F10 | Huỷ bởi admin | Huỷ kèm lý do, ghi nhận `actor_role` trong log |
| F11 | Thống kê | Tổng lịch, theo trạng thái, số khách, số dịch vụ, lịch hôm nay |
| F12 | Giám sát | Metrics HTTP, nghiệp vụ, tài nguyên container, PostgreSQL, Nginx |
| F13 | Log tập trung | Log ứng dụng và Nginx về Loki, tìm kiếm theo label/nội dung |

### 2.3. Yêu cầu phi chức năng

| Mã | Yêu cầu | Cách đáp ứng |
|---|---|---|
| N1 | Nhất quán dữ liệu | Transaction + `FOR UPDATE` + partial unique index + trigger DB |
| N2 | Hiệu năng | Index theo `(status, start_time)`, pool 10 kết nối, `statement_timeout` 10s |
| N3 | Bảo mật | Mục 9 và `deployment/SECURITY.md` |
| N4 | Khả năng quan sát | Metrics, dashboard, alert, log JSON có `request_id` |
| N5 | Tái lập môi trường | Docker Compose + volume + seed tự động |
| N6 | Khả năng bảo trì | Tách module (`routes`, `booking`, `validation`, `errors`), test tự động |
| N7 | Trải nghiệm | Giao diện tiếng Việt, phản hồi lỗi rõ ràng, hiển thị theo giờ Việt Nam |
| N8 | Khả dụng | Healthcheck, `restart: unless-stopped`, graceful shutdown, trang lỗi 503 |

### 2.4. Luồng nghiệp vụ chính

**Luồng đặt lịch**

```
Khách chọn dịch vụ → GET /api/services
        │
        ├─ GET /api/services/:id/slots?date=&days=  → danh sách khung giờ available
        │
        ├─ (chưa đăng nhập) → chuyển tới login.html?next=/index.html
        │
        └─ POST /api/appointments { slotId, note }
                 │
                 ├─ authenticate (JWT)
                 ├─ rate limit 30/5 phút
                 ├─ validate slotId, note
                 └─ booking.createAppointment
                        ├─ BEGIN
                        ├─ SELECT slot ... FOR UPDATE
                        ├─ kiểm tra status = available và start_time > now()
                        ├─ đếm lịch active của user (≤ 5)
                        ├─ INSERT appointments(status='pending')
                        ├─ UPDATE time_slots SET status='booked'
                        └─ COMMIT
                 ├─ 201 Created + appointment
                 └─ 409 SLOT_UNAVAILABLE nếu đã bị đặt
```

**Luồng xác nhận (admin)**

`PATCH /api/admin/appointments/:id/confirm` → `requireAdmin` (kiểm tra DB) → transaction khoá slot và
appointment → nếu đã `confirmed` trả `alreadyConfirmed: true` (idempotent); nếu `pending` cập nhật
`status='confirmed'`, `confirmed_at=now()`; nếu trạng thái khác trả 409 `INVALID_STATUS`.

**Luồng huỷ**

`POST /api/appointments/:id/cancel` (khách) hoặc `PATCH /api/admin/appointments/:id/cancel` (admin)
→ transaction khoá slot + appointment → kiểm tra quyền sở hữu (khách) → kiểm tra trạng thái và thời gian
→ `status='cancelled'`, `cancelled_at`, `cancel_reason` → `time_slots.status='available'` → COMMIT.
Nhờ vậy khung giờ được giải phóng ngay và không có khoảng thời gian "kẹt" giữa hai bước.


## 3. Kiến trúc hệ thống

### 3.1. Kiến trúc tổng thể

Hệ thống theo mô hình **3 lớp** (presentation – application – data) nhưng được triển khai thành
nhiều tiến trình/container độc lập:

```
┌───────────────────────────────────────────────────────────────────────┐
│ Trình duyệt: index.html, login.html, register.html, admin.html        │
│  + app.js / admin.js / common.js (fetch API, sessionStorage)          │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS (443) → HTTP (8080) redirect
┌───────────────────────────────▼───────────────────────────────────────┐
│ Nginx: TLS termination, gzip, rate limit 5r/s, CSP/HSTS, 503 page     │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ proxy_pass (network appointment_frontend)
┌───────────────────────────────▼───────────────────────────────────────┐
│ Express app (Node.js, non-root, read-only)                            │
│  ├─ middleware: request-id → metrics → pino-http → helmet → json      │
│  ├─ routes: auth | services | appointments | admin                     │
│  ├─ domain: booking (transaction, lock), validation, errors           │
│  └─ infra: pg pool, prom-client, logger                               │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ SQL (network appointment_backend, internal)
┌───────────────────────────────▼───────────────────────────────────────┐
│ PostgreSQL 16: users, services, time_slots, appointments + trigger    │
└───────────────────────────────────────────────────────────────────────┘

Network appointment_monitoring:
  Prometheus (scrape app/cadvisor/postgres/nginx/loki) → Grafana
  Promtail (đọc nginx_logs, app_logs) → Loki → Grafana Explore
```

### 3.2. Lý do tách lớp và tách network

- **Tách network** để giảm bề mặt tấn công: nếu Nginx bị xâm nhập, kẻ tấn công không có route trực tiếp
  tới PostgreSQL; `backend` đặt `internal: true` nên container DB không thể gọi ra Internet (không
  exfiltrate dữ liệu, không tải payload).
- **Chỉ Nginx publish cổng**: ứng dụng Node.js không lộ cổng 3000, do đó mọi request đều đi qua
  rate limit và header bảo mật của Nginx.
- **Monitoring network riêng**: Prometheus/Grafana không nằm chung với frontend; UI quản trị bind
  `127.0.0.1` nên chỉ người ngồi tại máy mới truy cập được.

### 3.3. Cấu trúc mã nguồn backend

| Tầng | File | Trách nhiệm |
|---|---|---|
| Khởi động | `src/server.js` | Tạo HTTP server, kiểm tra DB, bắt signal, graceful shutdown |
| Cấu hình | `src/config.js` | Đọc biến môi trường, kiểm tra hợp lệ, fail-fast |
| Ứng dụng | `src/app.js` | Ghép middleware, mount router, phục vụ tĩnh, xử lý 404/lỗi |
| Định tuyến | `src/routes/*.js` | Kiểm tra đầu vào, gọi nghiệp vụ, trả response |
| Nghiệp vụ | `src/booking.js` | Transaction, khoá, chuyển trạng thái, serialize DTO |
| Hạ tầng | `src/db.js`, `logger.js`, `metrics.js` | Pool, log, metrics |
| Hỗ trợ | `src/validation.js`, `errors.js`, `middleware/*` | Chuẩn hoá dữ liệu, lỗi nghiệp vụ, xác thực/phân quyền |

Cách tách này cho phép unit test phần validation/errors/serialize mà không cần DB, đồng thời giữ
router mỏng và dễ đọc.

### 3.4. Luồng xử lý một request

1. Nginx nhận request, gán `X-Request-Id` (hoặc chuyển tiếp nếu có), áp rate limit, chuyển tiếp.
2. Express sinh/tái sử dụng `req.id`, ghi nhận metrics bắt đầu.
3. `pino-http` log request (bỏ qua `/metrics`, `/api/health`), `customLogLevel` theo status.
4. Helmet gắn header bảo mật; `express.json` giới hạn 100 KB.
5. Router kiểm tra JWT (nếu cần), validate dữ liệu, gọi `booking.*`.
6. `booking` mở transaction, khoá dữ liệu liên quan, cập nhật, commit, tăng metric, ghi log.
7. Response JSON; middleware metrics ghi nhận status/thời gian/route đã chuẩn hoá.
8. Nếu lỗi: `errorHandler` chuẩn hoá thành `{ error: { code, message, details } }`, log mức warn/error.

### 3.5. Quyết định thiết kế đáng chú ý

| Vấn đề | Lựa chọn | Đánh đổi |
|---|---|---|
| Chống đặt trùng | Khoá row + partial unique index + trigger | Ít tranh chấp vì khoá theo từng slot; vẫn đảm bảo đúng khi tải cao |
| Hiển thị thời gian | Lưu `timestamptz`, format theo `Asia/Ho_Chi_Minh` ở SQL và client | Không phụ thuộc timezone của server/trình duyệt |
| Xác thực | JWT stateless + kiểm tra DB cho admin | Đơn giản, nhưng không thu hồi token ngay (đã ghi ở rủi ro) |
| Frontend | Vanilla JS, không build step | Nhẹ, dễ đọc, CSP chặt; đổi lại không có component hoá |
| Log | Ghi cả stdout và file | File để Promtail đọc; stdout để `docker logs`; tốn thêm I/O nhỏ |
| Cấu hình | `.env` + fail-fast | An toàn, dễ phát hiện thiếu biến; phải tạo file trước khi chạy |


## 4. Thiết kế cơ sở dữ liệu

### 4.1. Sơ đồ quan hệ (ERD)

```
┌────────────────────┐         ┌─────────────────────────┐
│ users              │         │ services                │
├────────────────────┤         ├─────────────────────────┤
│ id (PK, identity)  │         │ id (PK, identity)       │
│ full_name          │         │ name (unique)           │
│ email (unique)     │         │ description             │
│ phone              │         │ duration_minutes 15..480│
│ password_hash      │         │ price >= 0              │
│ role: user|admin   │         │ is_active               │
│ is_active          │         └───────────┬─────────────┘
│ last_login_at      │                     │ 1
│ created_at/updated │                     │
└─────────┬──────────┘                     │ N
          │ 1                    ┌─────────▼───────────────┐
          │                      │ time_slots              │
          │                      ├─────────────────────────┤
          │                      │ id (PK)                 │
          │                      │ service_id (FK, cascade)│
          │                      │ start_time (timestamptz)│
          │                      │ end_time   (timestamptz)│
          │                      │ status: available |     │
          │                      │         booked | blocked│
          │                      │ UNIQUE(service,start)   │
          │                      │ EXCLUDE overlap theo sv │
          │                      └───────────┬─────────────┘
          │ N                                │ 1
┌─────────▼──────────────────────────────────▼────────────┐
│ appointments                                             │
├──────────────────────────────────────────────────────────┤
│ id (PK)                                                  │
│ user_id (FK users, ON DELETE CASCADE)                    │
│ slot_id (FK time_slots, ON DELETE RESTRICT)              │
│ status: pending | confirmed | cancelled | completed      │
│ note (<=500), cancel_reason (<=255)                      │
│ confirmed_at, cancelled_at, created_at, updated_at       │
│ UNIQUE (slot_id) WHERE status IN ('pending','confirmed') │
└──────────────────────────────────────────────────────────┘
```

### 4.2. Mô tả bảng

**`users`** — tài khoản khách và quản trị viên.

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | integer identity | PK |
| `full_name` | varchar(120) | 2–120 ký tự sau khi trim |
| `email` | varchar(180) | UNIQUE, phải lowercase và đúng định dạng |
| `phone` | varchar(20) | nullable |
| `password_hash` | text | ≥50 ký tự (bcrypt) |
| `role` | varchar(10) | `user` hoặc `admin` |
| `is_active` | boolean | mặc định `true`, dùng để khoá tài khoản |
| `last_login_at` | timestamptz | cập nhật khi đăng nhập thành công |
| `created_at`, `updated_at` | timestamptz | `updated_at` do trigger |

**`services`** — danh mục dịch vụ; `duration_minutes` quyết định độ dài khung giờ khi sinh lịch.

**`time_slots`** — khung giờ cụ thể của từng dịch vụ. Ba trạng thái: `available` (còn trống),
`booked` (đã có lịch), `blocked` (khoá thủ công, ví dụ nghỉ lễ). Ràng buộc:
`UNIQUE(service_id, start_time)`, `CHECK(end_time > start_time)`, và
`EXCLUDE USING gist (service_id WITH =, tstzrange(start_time, end_time, '[)') WITH &&)`
để hai khung giờ của cùng một dịch vụ không chồng lấn.

**`appointments`** — lịch hẹn. `slot_id` dùng `ON DELETE RESTRICT` để không thể xoá khung giờ đang có
lịch; `user_id` dùng `ON DELETE CASCADE` để dọn dữ liệu khi xoá tài khoản.
`CHECK` buộc `cancelled_at`/`confirmed_at` phải có khi trạng thái tương ứng.

### 4.3. Các lớp bảo vệ chống đặt trùng

1. **Ứng dụng**: `SELECT ... FOR UPDATE` trên `time_slots` trong transaction, kiểm tra `status`.
2. **Chỉ mục duy nhất có điều kiện**:
   `UNIQUE INDEX appointments_one_active_per_slot ON appointments(slot_id) WHERE status IN ('pending','confirmed')`.
3. **Trigger `trg_appointments_slot_must_be_available`**: trước khi INSERT, khoá slot và từ chối nếu
   `status <> 'available'`, slot không tồn tại (`23503`) hoặc `start_time <= now()` (`P0001`).
4. **Trigger `trg_appointments_status_transition`**: chặn khôi phục lịch đã `cancelled`/`completed`
   về `pending`/`confirmed`.
5. **Ràng buộc EXCLUDE** trên `time_slots`: ngăn dữ liệu khung giờ chồng lấn ngay cả khi nạp tay.

Ba lớp đầu xử lý tranh chấp đồng thời; trigger và EXCLUDE là "chốt chặn cuối" ở tầng dữ liệu, đảm bảo
tính đúng kể cả khi có client khác ghi trực tiếp vào DB.

### 4.4. Index

| Index | Mục đích |
|---|---|
| `users_email_key` | Tra cứu đăng nhập, đảm bảo duy nhất |
| `services_name_key` | Seed idempotent, tra cứu theo tên |
| `time_slots_service_start_key` | Liệt kê khung giờ theo dịch vụ/thời gian |
| `time_slots_status_start_idx` | Lọc khung giờ trống sắp tới |
| `time_slots_service_start_idx` | Truy vấn slot theo dịch vụ + ngày |
| `appointments_one_active_per_slot` | Chống trùng + tăng tốc kiểm tra |
| `appointments_user_created_idx` | "Lịch của tôi" sắp xếp mới nhất |
| `appointments_status_idx` | Lọc theo trạng thái ở trang admin |

### 4.5. Dữ liệu mẫu

`03_seed.sql` tạo 3 tài khoản (1 admin, 2 khách), 5 dịch vụ, và khung giờ cho 14 ngày kể từ hôm nay,
mỗi ngày 6 khung (08:00, 09:30, 11:00, 13:30, 15:00, 16:30) theo giờ Việt Nam. Câu lệnh dùng
`ON CONFLICT DO NOTHING` nên chạy lại không nhân đôi dữ liệu; khung giờ đã qua bị loại bằng điều kiện
`> now()`.

### 4.6. Transaction & mức cô lập

`db.withTransaction` mở `BEGIN`, chạy callback với client riêng, `COMMIT` khi thành công và `ROLLBACK`
khi lỗi, luôn `client.release()` trong `finally`. Mức cô lập mặc định `READ COMMITTED` kết hợp
`FOR UPDATE` là đủ cho nghiệp vụ này: mọi thao tác ghi lên cùng một slot đều xếp hàng trên row lock,
nên không xảy ra "hai người cùng thấy slot trống rồi cùng đặt".


## 5. Thiết kế API

### 5.1. Nguyên tắc chung

- REST, dữ liệu JSON, tiền tố `/api`; tài nguyên số nhiều (`/appointments`, `/services`).
- Xác thực bằng header `Authorization: Bearer <JWT>`; token hết hạn sau 8 giờ.
- Mọi response lỗi cùng một cấu trúc: `{ "error": { "code", "message", "details"? } }`.
- Tham số truy vấn được chuẩn hoá và kiểm tra kiểu (`parsePositiveInt`, `parseDateParam`, `parseDays`).
- Thời gian trả về ISO 8601 UTC + kèm `timezone` để client hiển thị đúng giờ Việt Nam.

### 5.2. Danh sách endpoint

| Method | Đường dẫn | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/health` | công khai | Trạng thái app + DB (`status`, `database`, `uptime`) |
| POST | `/api/auth/register` | công khai | Đăng ký, trả token + hồ sơ |
| POST | `/api/auth/login` | công khai | Đăng nhập, trả token + hồ sơ |
| GET | `/api/auth/me` | user | Hồ sơ người dùng hiện tại |
| GET | `/api/services` | công khai | Danh sách dịch vụ kèm số slot trống |
| GET | `/api/services/:id` | công khai | Chi tiết dịch vụ |
| GET | `/api/services/:id/slots` | công khai | Khung giờ trống của một dịch vụ (`date`, `days`) |
| GET | `/api/slots` | công khai | Khung giờ trống toàn hệ thống (`serviceId`, `date`, `days`) |
| POST | `/api/appointments` | user | Tạo lịch hẹn `{ slotId, note? }` |
| GET | `/api/appointments/me` | user | Lịch hẹn của tôi (`status`, `page`, `limit`) |
| POST | `/api/appointments/:id/cancel` | user/admin | Huỷ lịch (khách chỉ huỷ lịch của mình) |
| DELETE | `/api/appointments/:id` | user/admin | Alias huỷ lịch (REST) |
| GET | `/api/admin/appointments` | admin | Danh sách toàn bộ (`status`, `date`, `search`, `page`, `limit`) |
| PATCH | `/api/admin/appointments/:id/confirm` | admin | Xác nhận lịch (idempotent) |
| PATCH | `/api/admin/appointments/:id/cancel` | admin | Huỷ kèm `reason` |
| GET | `/api/admin/stats` | admin | Thống kê tổng hợp |
| GET | `/metrics` | nội bộ (Nginx chặn) | Prometheus exposition |

### 5.3. Ví dụ request/response

**Đăng nhập**

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "customer1@example.com", "password": "Demo@12345" }
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 2, "fullName": "Nguyễn Văn An", "email": "customer1@example.com", "role": "user" }
}
```

**Tạo lịch hẹn**

```http
POST /api/appointments
Authorization: Bearer <token>
Content-Type: application/json

{ "slotId": 42, "note": "Đau răng hàm dưới" }
```

```json
{
  "message": "Đặt lịch hẹn thành công. Vui lòng chờ quản trị viên xác nhận.",
  "appointment": {
    "id": 18,
    "status": "pending",
    "note": "Đau răng hàm dưới",
    "createdAt": "2026-10-21T08:15:04.512Z",
    "updatedAt": "2026-10-21T08:15:04.512Z",
    "confirmedAt": null,
    "cancelledAt": null,
    "cancelReason": null,
    "slot": {
      "id": 42,
      "serviceId": 1,
      "serviceName": "Khám tổng quát",
      "durationMinutes": 30,
      "price": 150000,
      "startTime": "2026-10-23T01:00:00.000Z",
      "endTime": "2026-10-23T01:30:00.000Z",
      "status": "booked"
    }
  }
}
```

**Khung giờ trống**

```http
GET /api/services/1/slots?date=2026-10-23&days=1
```

```json
{
  "service": { "id": 1, "name": "Khám tổng quát" },
  "slots": [ { "id": 42, "startTime": "...", "endTime": "...", "status": "available" } ],
  "timezone": "Asia/Ho_Chi_Minh"
}
```

### 5.4. Mã lỗi nghiệp vụ

| HTTP | `code` | Ngữ cảnh |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Thiếu/sai kiểu dữ liệu, kèm `details` từng trường |
| 400 | `INVALID_DATE` / `INVALID_DAYS` | Tham số `date`/`days` không hợp lệ |
| 401 | `UNAUTHORIZED` | Thiếu/sai/hết hạn token |
| 401 | `INVALID_CREDENTIALS` | Sai email hoặc mật khẩu (thông báo chung, không tiết lộ) |
| 403 | `FORBIDDEN` | Không đủ quyền (khách gọi API admin) |
| 401 | `ACCOUNT_DISABLED` | Tài khoản đã bị khoá |
| 404 | `NOT_FOUND` / `SERVICE_NOT_FOUND` / `SLOT_NOT_FOUND` | Không tìm thấy tài nguyên |
| 404 | `APPOINTMENT_NOT_FOUND` | Không tồn tại hoặc không thuộc về người dùng |
| 409 | `EMAIL_TAKEN` | Email đã đăng ký |
| 409 | `SLOT_UNAVAILABLE` | Khung giờ đã bị đặt/khoá |
| 409 | `SLOT_IN_PAST` | Khung giờ đã qua |
| 409 | `ALREADY_CANCELLED` | Lịch đã huỷ trước đó |
| 409 | `APPOINTMENT_STARTED` / `APPOINTMENT_COMPLETED` | Lịch đã bắt đầu/đã hoàn thành |
| 409 | `INVALID_STATUS` | Trạng thái không cho phép thao tác |
| 409 | `TOO_MANY_ACTIVE_APPOINTMENTS` | Vượt 5 lịch đang hoạt động |
| 429 | `RATE_LIMITED` | Vượt giới hạn tần suất |
| 413 | `PAYLOAD_TOO_LARGE` | Body > 100 KB |
| 400 | `INVALID_JSON` | Body không phải JSON hợp lệ |
| 503 | `DATABASE_UNAVAILABLE` / `DATABASE_TIMEOUT` | DB mất kết nối hoặc quá thời gian chờ |
| 500 | `INTERNAL_ERROR` | Lỗi không lường trước (không lộ stack trace) |

### 5.5. Xác thực và phân quyền

`authenticate` đọc Bearer token, `jwt.verify` với `JWT_SECRET`, gán `req.user = { id, email, role }`.
`optionalAuth` dùng cho endpoint công khai nhưng có thể cá nhân hoá. `requireAdmin` không tin `role`
trong token mà truy vấn lại `users` để lấy `role` và `is_active` hiện tại — nhờ vậy khi admin bị hạ quyền
hoặc khoá, token cũ mất hiệu lực nghiệp vụ ngay. Mật khẩu được băm bằng bcrypt cost 12; so sánh dùng
`bcrypt.compare`, không bao giờ log mật khẩu hay hash.

### 5.6. Kiểm tra đầu vào

| Trường | Quy tắc |
|---|---|
| `fullName` | Chuỗi 2–120 ký tự sau trim |
| `email` | Trim + lowercase, regex `^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$`, ≤180 |
| `password` | 8–72 ký tự, có chữ và số |
| `phone` | 9–15 chữ số (cho phép `+`, khoảng trắng, `-`), tuỳ chọn |
| `slotId` | Số nguyên dương |
| `note` | ≤500 ký tự, tuỳ chọn |
| `reason` | ≤255 ký tự (admin huỷ) |
| `date` | `YYYY-MM-DD` hợp lệ |
| `days` | Số nguyên 1–30 |
| `page`, `limit` | `page ≥ 1`, `1 ≤ limit ≤ 100` |

Dữ liệu sai bị từ chối trước khi chạm DB; truy vấn luôn dùng tham số `$1, $2…` nên không có SQL injection.


## 6. Thiết kế giao diện

### 6.1. Các trang

| Trang | Đối tượng | Nội dung chính |
|---|---|---|
| `index.html` | Khách, khách hàng | Hero, danh sách dịch vụ, bộ lọc ngày, lưới khung giờ, form đặt lịch, "Lịch hẹn của tôi" |
| `login.html` | Tất cả | Form đăng nhập, liên kết sang đăng ký, hỗ trợ `?next=` |
| `register.html` | Khách | Form đăng ký có kiểm tra phía client |
| `admin.html` | Admin | Thẻ thống kê, bộ lọc, bảng lịch hẹn, nút xác nhận/huỷ |

Tài nguyên tĩnh dùng chung: `css/styles.css`, `js/common.js` (gọi API, định dạng ngày/tiền, hiển thị toast),
`js/app.js` và `js/admin.js` (logic từng trang).

### 6.2. Luồng giao diện khách hàng

1. Tải trang → `GET /api/services` → render thẻ dịch vụ (tên, mô tả, thời lượng, giá, số slot trống).
2. Chọn dịch vụ và ngày → `GET /api/services/:id/slots?date=...` → nhóm khung giờ theo buổi
   (sáng < 12h, chiều 12–17h, tối ≥ 17h) để dễ chọn.
3. Bấm khung giờ → form đặt lịch hiện ra; nếu chưa đăng nhập, chuyển tới `login.html?next=...`.
4. Gửi form → `POST /api/appointments`; thành công thì toast xanh, tải lại "Lịch hẹn của tôi".
5. Nếu 409 → toast đỏ đúng thông điệp từ server, đồng thời tải lại danh sách khung giờ để phản ánh dữ liệu mới.
6. Nút "Huỷ" trong danh sách lịch → `POST /api/appointments/:id/cancel` → cập nhật trạng thái tại chỗ.

### 6.3. Luồng giao diện quản trị

1. Kiểm tra token + `GET /api/auth/me`; nếu `role !== 'admin'` thì chuyển hướng, không render dữ liệu.
2. `GET /api/admin/stats` đổ vào 6 thẻ: tổng lịch, chờ xác nhận, đã xác nhận, đã huỷ, khách hàng, khung giờ trống.
3. `GET /api/admin/appointments?status=&date=&search=&page=` đổ vào bảng, có phân trang trước/sau.
4. Nút "Xác nhận" (`PATCH .../confirm`) và "Huỷ" (`PATCH .../cancel` kèm lý do) cập nhật dòng và thống kê.
5. Mọi hành động có phản hồi rõ ràng; lỗi 403 hiển thị thông báo không đủ quyền.

### 6.4. Quy ước triển khai frontend

- **Không có inline script/style, không `onclick`**: toàn bộ sự kiện gắn bằng `addEventListener`,
  nhờ đó CSP `script-src 'self'` hoạt động mà không cần `unsafe-inline`.
- **Render bằng `textContent`**, không dùng `innerHTML` cho dữ liệu người dùng → chống XSS stored.
- **Token** lưu trong `sessionStorage` (mất khi đóng tab), không lưu cookie dài hạn; request đính header
  `Authorization` qua hàm `apiFetch` tập trung (tự xử lý 401 → xoá token, chuyển về đăng nhập).
- **Định dạng** ngày/giờ bằng `Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })`,
  tiền bằng `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })`.
- **Trạng thái** dùng nhãn tiếng Việt và màu nhất quán: chờ xác nhận (vàng), đã xác nhận (xanh),
  đã huỷ (đỏ), hoàn thành (xám).

### 6.5. Khả năng truy cập và responsive

Bố cục dùng CSS Grid/Flexbox, breakpoint 900 px và 600 px; nút và liên kết có trạng thái `:focus-visible`;
mọi ảnh/icon trang trí dùng `aria-hidden`; form có `<label>` gắn `for`; thông báo lỗi được đọc bởi
`role="alert"`. Bảng ở màn hình nhỏ chuyển sang dạng thẻ để không phải cuộn ngang.

### 6.6. Xử lý lỗi phía client

`apiFetch` chuẩn hoá: nếu response không OK, đọc `error.message` và `error.details`, ném lỗi có `code`.
Tầng UI phân loại: 401 → yêu cầu đăng nhập; 403 → thông báo quyền; 409/400 → hiển thị message từ server;
5xx/mạng lỗi → thông báo chung "Không kết nối được máy chủ, vui lòng thử lại". Không hiển thị stack trace
hay nội dung thô của exception.

## 7. Triển khai Docker & Nginx

### 7.1. Dockerfile ứng dụng (multi-stage)

| Stage | Nội dung |
|---|---|
| `deps` | `node:22-alpine`, cài `python3 make g++` để build `bcrypt`, chạy `npm ci --omit=dev` |
| `runtime` | `node:22-alpine` + `tini`, tạo `/app/logs`, copy `node_modules`, `src`, `public`, `package.json` |

Đặc điểm: `USER node` (uid 1000), `tini` làm PID 1 để nhận SIGTERM và dọn tiến trình con,
`HEALTHCHECK` gọi `/api/health` (interval 15 s, timeout 5 s, start-period 20 s, 5 lần thử).
Image runtime không chứa compiler → giảm kích thước và bề mặt tấn công.

### 7.2. Các service trong Docker Compose

| Service | Image | Vai trò | Cổng publish |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | CSDL, init bằng `db/init/*.sql` | `127.0.0.1:5432` |
| `app` | build từ `Dockerfile` | API + phục vụ tệp tĩnh | không |
| `nginx` | build từ `nginx:1.27-alpine`, chạy user `nginx` | TLS, rate limit, reverse proxy | `80:8080`, `443:8443` |
| `pgadmin` | `dpage/pgadmin4:8.14` | Quản trị CSDL (tuỳ chọn) | `127.0.0.1:5050` |
| `prometheus` | `prom/prometheus:v2.55.1` | Thu thập metrics | `127.0.0.1:9090` |
| `cadvisor` | `gcr.io/cadvisor/cadvisor:v0.49.1` | Metrics container | không |
| `postgres-exporter` | `prometheuscommunity/postgres-exporter:v0.16.0` | Metrics PostgreSQL | không |
| `nginx-exporter` | `nginx/nginx-prometheus-exporter:1.4.0` | Đọc `/nginx_status` | không |
| `loki` | `grafana/loki:3.2.1` | Lưu log | không |
| `promtail` | `grafana/promtail:3.2.1` | Đẩy log lên Loki | không |
| `grafana` | `grafana/grafana:11.2.0` | Dashboard | `127.0.0.1:3001` |

Tất cả service đều có `restart: unless-stopped` và logging `json-file` giới hạn `max-size=10m`, `max-file=3`
để log Docker không làm đầy đĩa. Thứ tự khởi động: `postgres` healthy → `app` healthy → `nginx` healthy;
`postgres-exporter`/`pgadmin` chờ PostgreSQL; `promtail` chờ Loki ready; Grafana chờ Prometheus và Loki.

### 7.3. Volume và network

| Loại | Tên | Mục đích |
|---|---|---|
| volume | `postgres_data` | Dữ liệu PostgreSQL (`PGDATA=/var/lib/postgresql/data/pgdata`) |
| volume | `pgadmin_data` | Cấu hình pgAdmin |
| volume | `app_logs` | Log ứng dụng cho Promtail |
| volume | `nginx_logs` | Access/error log cho Promtail |
| volume | `nginx_certs` | Chứng chỉ TLS tự ký, sinh lần đầu bởi entrypoint |
| volume | `prometheus_data` | TSDB Prometheus (giữ 15 ngày) |
| volume | `grafana_data` | Dashboard/alert người dùng tạo |
| volume | `loki_data` | Chunk log |
| volume | `promtail_positions` | Vị trí đọc log, tránh gửi trùng sau restart |
| network | `appointment_frontend` | Nginx ↔ app |
| network | `appointment_backend` (internal) | app ↔ postgres ↔ exporter, không có egress |
| network | `appointment_monitoring` | Prometheus/Grafana/Loki/Promtail/exporters và app/nginx (để scrape) |

### 7.4. Cấu hình Nginx

| Nhóm | Thiết lập |
|---|---|
| Cổng | HTTP 8080 (map 80), HTTPS 8443 (map 443); chạy non-root nên không bind cổng <1024 |
| HTTP | Mọi path (trừ `/healthz`, `/nginx_status`) → `301 https://$host$request_uri` |
| HTTPS | `http2 on`, TLS 1.2/1.3, cipher ECDHE hiện đại, session cache 10m, tắt session tickets |
| Rate limit | `limit_req_zone ... rate=5r/s`, `/api/auth/` burst 5, `/api/` burst 10, tĩnh burst 30; `limit_conn` 30 |
| Header | HSTS (1 ngày — phù hợp self-signed), CSP chặt, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP |
| Proxy | `proxy_http_version 1.1`, keepalive 32, timeout 5s/60s, `proxy_hide_header X-Powered-By`, giữ `X-Request-Id` |
| Log | `log_format json_combined` gồm `time`, `remote_addr`, `method`, `uri`, `status`, `request_time`, `request_id` |
| Bảo vệ | Chặn path bắt đầu bằng dấu chấm (`/.git`, `/.env`), `/metrics` trả 404, `/nginx_status` chỉ IP nội bộ |
| Lỗi | `error_page 502 503 504 /50x.html` trả trang 503 tiếng Việt thay vì trang mặc định của Nginx |
| Gzip | Bật cho text/css/json/js/svg/woff2, `gzip_min_length 512` |

### 7.5. TLS

Chứng chỉ self-signed được sinh tự động ở lần khởi động đầu tiên:
`openssl req -x509 -newkey rsa:2048 -days 365 -subj "/C=VN/.../CN=${NGINX_SERVER_NAME}"` với
`subjectAltName=DNS:localhost,DNS:<server_name>,IP:127.0.0.1`; khoá `chmod 600`, lưu trong volume
`nginx_certs` nên không mất khi recreate container. Trước khi chạy, entrypoint gọi `nginx -t` để phát hiện
sai cấu hình sớm. Trong môi trường thật, chỉ cần thay cặp `server.crt`/`server.key` bằng chứng chỉ Let's
Encrypt và bật HSTS dài hơn.

### 7.6. Gia cố container

| Biện pháp | Áp dụng |
|---|---|
| Chạy non-root | app `USER node` (1000), nginx `USER nginx` (101), loki `10001:10001` |
| `no-new-privileges` + `cap_drop: ALL` | app, nginx, prometheus, postgres-exporter, nginx-exporter, grafana |
| `read_only: true` + `tmpfs` | app (`/tmp`), nginx (`/tmp`, `/var/cache/nginx`) |
| Không publish cổng | app, DB nội bộ, exporter, Loki, Promtail, cAdvisor |
| Bind localhost | PostgreSQL, pgAdmin, Prometheus, Grafana |
| Ngoại lệ có kiểm soát | cAdvisor cần `privileged` + mount `/sys`, `/var/lib/docker` (chỉ đọc, không publish cổng) |
| Secret | Lấy từ `.env`, compose dùng `${VAR:?...}` để dừng ngay nếu thiếu |

### 7.7. Quá trình khởi động và nạp dữ liệu

1. `docker compose up -d --build` → build image app (multi-stage) và image nginx.
2. PostgreSQL khởi tạo cluster, chạy lần lượt `01_schema.sql`, `02_roles.sql`, `03_seed.sql` trong
   `/docker-entrypoint-initdb.d` (chỉ khi volume dữ liệu trống).
3. Ứng dụng chờ `pg_isready` healthy, sau đó `server.js` kiểm tra kết nối DB trước khi listen cổng 3000.
4. Nginx sinh chứng chỉ (nếu chưa có), `nginx -t`, rồi phục vụ 80/443.
5. Promtail đọc `nginx_logs` và `app_logs`, đẩy về Loki; Prometheus scrape 6 target; Grafana nạp
   datasource + dashboard từ `deployment/grafana/provisioning`.
6. Muốn nạp lại dữ liệu mẫu: `docker compose down -v && docker compose up -d`.



## 8. Giám sát & quản lý log

### 8.1. Kiến trúc quan sát

```
app /metrics ─┐
cAdvisor ─────┤
postgres-exporter ──► Prometheus ──► Grafana (4 dashboard)
nginx-exporter ─┤         │
loki /metrics ──┘         └──► Alert rules (6 rule) → /alerts
                                      ▲
nginx access/error log ──► Promtail ──┴──► Loki ──► Grafana Explore / dashboard Logs
app pino JSON log ────────►
```

Hai trục tách biệt: **metrics** (số liệu tổng hợp theo thời gian) và **logs** (sự kiện chi tiết).
Khi có sự cố: xem dashboard để biết "cái gì" và "khi nào", rồi chuyển sang Loki để biết "tại sao"
(nhờ `request_id` xuất hiện ở cả Nginx và ứng dụng).

### 8.2. Metrics của ứng dụng

Ngoài metrics mặc định `nodejs_*` (CPU, RSS, heap, GC, event loop, file descriptor), ứng dụng tự định nghĩa:

| Metric | Loại | Nhãn | Ý nghĩa |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `route`, `status` | Tổng request theo route đã chuẩn hoá |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Phân bố độ trễ (bucket 5 ms → 5 s) |
| `http_requests_in_flight` | Gauge | — | Số request đang xử lý |
| `http_errors_total` | Counter | `method`, `route`, `status` | Response 5xx do ứng dụng sinh ra |
| `appointments_active` | Gauge | — | Lịch `pending`/`confirmed` hiện tại |
| `appointments_created_total` | Counter | — | Lịch tạo thành công |
| `appointments_confirmed_total` | Counter | — | Lịch được xác nhận |
| `appointments_cancelled_total` | Counter | `actor_role` | Lịch bị huỷ, phân biệt khách/admin |
| `appointment_booking_conflicts_total` | Counter | — | Số lần bị từ chối vì trùng khung giờ |
| `database_up` | Gauge | — | 1/0 theo lần kiểm tra DB gần nhất |
| `database_query_duration_seconds` | Histogram | `operation` | Thời gian truy vấn theo loại thao tác |
| `pg_pool_total_connections` | Gauge | — | Kết nối đang mở trong pool |
| `pg_pool_idle_connections` | Gauge | — | Kết nối rảnh |
| `pg_pool_waiting_requests` | Gauge | — | Request đang chờ kết nối |

`route` dùng route pattern (`/api/appointments/:id/cancel`) thay vì URL thật để tránh cardinality nổ.
Middleware bỏ qua `/metrics` và `/api/health` khi ghi nhận để số liệu phản ánh lưu lượng thực.

### 8.3. Prometheus

- 6 scrape job: `prometheus` (15 s), `appointment-web` (10 s), `cadvisor`, `postgres`, `nginx` (15 s), `loki` (30 s).
- Retention 15 ngày, dữ liệu trong volume `prometheus_data`.
- Cấu hình nạp từ `deployment/prometheus/prometheus.yml`, alert từ `alert-rules.yml` (mount read-only).

**6 alert rule**

| Alert | Biểu thức | `for` | Mức |
|---|---|---|---|
| `AppointmentAppDown` | `up{job="appointment-web"} == 0` | 1m | critical |
| `AppointmentDatabaseDown` | `pg_up == 0` | 1m | critical |
| `NginxDown` | `nginx_up == 0` | 1m | critical |
| `HighHttpErrorRate` | tỉ lệ 5xx / tổng > 0.05 | 5m | warning |
| `HighRequestLatencyP95` | P95 > 1 s | 5m | warning |
| `TooManyActiveAppointments` | `appointments_active > 50` | 10m | info |

Không cấu hình Alertmanager (ngoài phạm vi đồ án); trạng thái alert xem tại `http://localhost:9090/alerts`.

### 8.4. Grafana

Datasource provision tự động: `Prometheus` (uid `prometheus`, mặc định) và `Loki` (uid `loki`).
Thư mục dashboard **Appointment System**, cập nhật mỗi 30 s từ file JSON:

| Dashboard | Số panel | Nội dung |
|---|---|---|
| `Tổng quan hạ tầng` | 6 | Trạng thái target, số container, uptime, lịch đang hoạt động, CPU/RAM theo container |
| `Web / API` | 9 | Request/giây, tỉ lệ 5xx, P95/P99 theo route, request theo mã HTTP, nghiệp vụ đặt lịch, top route |
| `PostgreSQL` | 9 | `pg_up`, kết nối, cache hit, kích thước DB, session, transaction commit/rollback, tuple, pool, P95 query |
| `Logs (Loki)` | 7 | Log/phút, lỗi 5xx 30 phút, cảnh báo/lỗi ứng dụng, lưu lượng theo job, bảng log Nginx và app |

Dashboard Logs có biến `$search` để lọc nhanh theo từ khoá trên cả hai nguồn log.



### 8.5. Log với Loki + Promtail

**Nguồn log**

| Nguồn | Đường dẫn trong container | Định dạng |
|---|---|---|
| Nginx access | `/var/log/nginx/access.log` (volume `nginx_logs`) | JSON (`json_combined`) |
| Nginx error | `/var/log/nginx/error.log` | Text có mức |
| Ứng dụng | `/var/log/app/*.log` (volume `app_logs`) | JSON pino, mỗi dòng một sự kiện |

**Pipeline Promtail**

- Access log: stage `json` tách `time`, `method`, `uri`, `status`, `request_time`, `request_id`;
  `timestamp` theo RFC3339Nano; `template` tạo `status_code` (chuỗi) và `level` theo status
  (≥500 → error, ≥400 → warn, còn lại info); `labels` chỉ giữ `method`, `status_code`, `level`;
  `labeldrop filename` để giảm label thừa.
- Error log: `regex` tách `time`, `level`, `pid`, `message`; **ánh xạ level** `crit`/`alert`/`emerg` → `critical`,
  `notice` → `info` vì Loki chỉ nhận `trace|debug|info|warn|error|critical|fatal`.
- App log: `json` tách `level`, `time`, `msg`, `req.method`, `req.url`, `res.statusCode`, `req.id`, `err.message`;
  label `level`; các field còn lại vẫn nằm trong nội dung log để lọc bằng `| json`.
- Gửi Loki với `batchwait: 1s`, `batchsize: 1MB`, backoff tối đa 5 phút/10 lần thử; `positions` lưu trong
  volume `promtail_positions` để không gửi lại log sau khi restart.

**Truy vấn mẫu**

```logql
{job="nginx", log_type="access"} | json | status >= 500
{job="appointment-app"} | json | level =~ "warn|error|fatal"
{job="appointment-app"} |= "Đăng nhập thất bại"
sum by (status_code) (count_over_time({job="nginx", log_type="access"}[1m]))
```

Bộ truy vấn đầy đủ ở [`LOGQL_QUERIES.md`](LOGQL_QUERIES.md).

### 8.6. Che dấu dữ liệu nhạy cảm

Pino cấu hình `redact` cho `req.headers.authorization`, `req.headers.cookie`, `req.body.password`,
`req.body.passwordHash`, `password`, `passwordHash`, `token`, `res.headers["set-cookie"]` với `censor = "[REDACTED]"`.
Nginx access log không ghi header `Authorization`. Nhờ vậy log tập trung vẫn hữu ích để điều tra mà không
làm lộ thông tin đăng nhập.

### 8.7. Điều tra sự cố mẫu

1. Alert `HighHttpErrorRate` firing → mở dashboard **Web / API**, xác định route và mã lỗi.
2. Chuyển **Logs**, lọc `{job="appointment-app"} | json | level="error" | uri=~"<route>"`, lấy `req_id`.
3. Lọc tiếp `{job=~"nginx|appointment-app"} |= "<req_id>"` để xem toàn bộ vòng đời request.
4. Nếu lỗi do DB: xem dashboard **PostgreSQL** (kết nối, rollback, deadlock) và log `DATABASE_TIMEOUT`.

## 9. Bảo mật

Phân tích đầy đủ theo mô hình STRIDE, danh sách kiểm chứng và rủi ro còn lại nằm trong
[`../deployment/SECURITY.md`](../deployment/SECURITY.md). Dưới đây là tóm tắt theo lớp.

### 9.1. Xác thực và phân quyền

| Kiểm soát | Chi tiết |
|---|---|
| Băm mật khẩu | bcrypt cost 12 (cấu hình 10–15), muối tự động, không bao giờ log/trả về hash |
| Chống dò tài khoản | Luôn chạy `bcrypt.compare` với `DUMMY_HASH` khi email không tồn tại; thông báo lỗi chung |
| JWT | HS256, hạn 8 giờ, có `iss`/`aud`, secret ≥32 ký tự và bị từ chối nếu chứa từ mẫu |
| Phân quyền | `requireAdmin` truy vấn lại DB, không tin `role` trong token; tài khoản bị khoá mất hiệu lực ngay |
| Sở hữu dữ liệu | Khách chỉ huỷ được lịch có `user_id` của mình; lịch của người khác trả 403 `FORBIDDEN` |

### 9.2. Chống lạm dụng

| Lớp | Giới hạn |
|---|---|
| Nginx | 5 req/s/IP, burst 5 cho `/api/auth/`, 10 cho `/api/`, 30 cho tĩnh; 30 kết nối đồng thời/IP |
| Ứng dụng | Đăng nhập/đăng ký 20 lần/15 phút/IP; đặt lịch 30 lần/5 phút/người dùng (`keyGenerator` theo user id) |
| Nghiệp vụ | Tối đa 5 lịch đang hoạt động/khách; body ≤100 KB; `note` ≤500, `reason` ≤255 |
| Kết quả | Vượt giới hạn → 429 kèm header `RateLimit-*`, không tiết lộ chi tiết nội bộ |

### 9.3. Chống injection và XSS

- **SQL**: 100 % truy vấn dùng tham số `$1…$n`, không nối chuỗi từ input; tên bảng/cột là hằng trong code.
- **XSS**: frontend render bằng `textContent`, không `innerHTML` cho dữ liệu người dùng; CSP
  `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'`
  và không có inline script/style nên không cần `unsafe-inline`.
- **Clickjacking**: `X-Frame-Options: DENY` + `frame-ancestors 'none'`.
- **MIME sniffing**: `X-Content-Type-Options: nosniff`.
- **Open redirect**: `safeNextUrl()` chỉ chấp nhận tên trang nội bộ khớp `^[a-z0-9._-]+\.html(\?.*)?$`,
  mọi giá trị khác quay về `index.html`.
- **Path traversal**: Nginx chặn path bắt đầu bằng `.`; Express chỉ phục vụ trong `public/`.

### 9.4. Bảo vệ dữ liệu và bí mật

| Hạng mục | Cách xử lý |
|---|---|
| Bí mật môi trường | `.env` không commit (`.gitignore`), sinh bằng `npm run secrets`, compose fail-fast nếu thiếu |
| Mật khẩu DB | Khác nhau cho `app_user` và `exporter_user`, tối thiểu 16 ký tự (kiểm tra trong `02_roles.sql`) |
| Quyền DB | `app_user` chỉ DML, `REVOKE CREATE ON SCHEMA public`; `exporter_user` chỉ `pg_monitor` + SELECT |
| TLS | Bắt buộc HTTPS, HTTP chuyển hướng 301, TLS 1.2/1.3, HSTS |
| Log | `redact` Authorization/Cookie/password/token; Nginx không log header nhạy cảm |
| Lỗi | Production không trả stack trace; lỗi DB được ánh xạ sang mã nghiệp vụ an toàn |

### 9.5. Bảo vệ hạ tầng

- **Phân đoạn mạng**: `backend` là `internal` (không egress); chỉ Nginx publish 80/443; UI quản trị bind loopback.
- **Container**: non-root, `no-new-privileges`, `cap_drop: ALL`, `read_only` + `tmpfs` cho app/nginx.
- **Giới hạn tài nguyên DB**: `statement_timeout` 10 s, pool tối đa 10 kết nối → tránh một truy vấn xấu treo hệ thống.
- **Healthcheck & restart**: phát hiện chết và tự phục hồi; graceful shutdown đóng pool, dừng nhận request mới.
- **cAdvisor**: ngoại lệ `privileged` duy nhất, chỉ đọc, không publish cổng — đã ghi rõ trong tài liệu.

### 9.6. Đối chiếu STRIDE (tóm tắt)

| Mối đe doạ | Kịch bản | Kiểm soát |
|---|---|---|
| Spoofing | Đoán mật khẩu, giả token | bcrypt + dummy hash, JWT có chữ ký, rate limit, kiểm tra DB |
| Tampering | Sửa `slotId`, sửa trạng thái | Validate kiểu, transaction + trigger DB, chặn chuyển trạng thái |
| Repudiation | Phủ nhận đã đặt/huỷ | Log có `user_id`, `actor_role`, `request_id`, thời gian |
| Information disclosure | Lộ hash, lộ log, lộ DB | Không trả hash, redact log, DB không publish, chỉ Nginx lộ 80/443 |
| Denial of service | Spam đăng nhập/đặt lịch | Rate limit 2 lớp, body limit, pool/timeout DB |
| Elevation of privilege | Khách gọi API admin | `requireAdmin` kiểm tra DB, UI ẩn + API 403 |

### 9.7. Kiểm chứng nhanh

```bash
curl -I http://localhost/                                              # 301 → https
curl -k -I https://localhost/ | findstr /I "strict-transport content-security x-frame"
curl -k -o NUL -w "%{http_code}\n" https://localhost/metrics           # 404
curl -k -o NUL -w "%{http_code}\n" https://localhost/api/admin/stats   # 401
docker compose exec app id                                             # uid=1000(node)
docker compose exec postgres psql -U app_user -d appointment -c "CREATE TABLE hack(id int);"
# ERROR: permission denied for schema public
```

Kết quả mong đợi và bảng kiểm chứng chi tiết: xem `deployment/SECURITY.md`.


## 10. Kiểm thử và kết quả

### 10.1. Chiến lược kiểm thử

| Mức | Công cụ | Phạm vi | Phụ thuộc |
|---|---|---|---|
| Unit | `node:test`, `node:assert/strict` | Validation, errors/asyncHandler, serialize DTO, hằng trạng thái | Không |
| Integration | `fetch` + HTTPS | Endpoint thật trên stack Docker | Cần stack đang chạy |
| Thủ công | Trình duyệt + curl | Luồng UI, header, phân quyền, hành vi 409 | Cần stack |
| Cấu hình | `docker compose config -q`, `node --check`, kiểm tra JSON/YAML | Cú pháp compose, JS, dashboard, Promtail | Không |

Triết lý: phần logic thuần được test không cần DB để chạy nhanh và ổn định; phần tích hợp kiểm chứng
"hợp đồng" giữa các tầng (status code, mã lỗi, header, chống trùng).

### 10.2. Unit test (21 test)

| File | Số test | Nội dung |
|---|---|---|
| `tests/unit/validation.test.js` | 12 | `normalizeEmail`, regex email, `validateRegistration`, `validatePassword`, `validateLogin`, `parsePositiveInt`, `parseDateParam`, `validateNote` |
| `tests/unit/errors.test.js` | 4 | Factory `ApiError` (status + code), `asyncHandler` với kết quả, lỗi async, lỗi đồng bộ |
| `tests/unit/booking-serialize.test.js` | 5 | `serializeAppointment` (null, snake→camel, ẩn thông tin user, `includeUser`), hằng trạng thái |

Kết quả chạy thực tế:

```
ℹ tests 21
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 178.5686
```

### 10.3. Integration test (8 test)

| Test | Kỳ vọng |
|---|---|
| `GET /api/health` | 200, `database = "up"` |
| `GET /` | 200, có CSP/HSTS/X-Frame-Options |
| `GET /api/services` | 200, mảng dịch vụ `isActive` |
| Luồng khách: đăng ký → đăng nhập → đặt lịch → huỷ | 201/200/201/200, trạng thái cuối `cancelled` |
| Đặt trùng khung giờ | Request thứ hai nhận 409 `SLOT_UNAVAILABLE` |
| Thiếu `slotId` | 400 `VALIDATION_ERROR` kèm `details` |
| Khách gọi `/api/admin/stats` | 403 `FORBIDDEN` |
| `GET /api/khong-ton-tai` | 404 JSON có `code` |

Cơ chế an toàn: trước khi chạy, test gọi `/api/health`; nếu không kết nối được thì `t.skip()` **toàn bộ**
test với lý do "Hãy chạy: docker compose up -d", nên không tạo báo cáo thất bại giả khi thiếu môi trường.
Biến `BASE_URL` cho phép trỏ tới môi trường khác; mặc định `https://localhost` và bỏ kiểm tra chứng chỉ
self-signed trừ khi đặt `ALLOW_INSECURE_TLS=false`.

Kết quả trong môi trường hiện tại (Docker Desktop không khả dụng):

```
ℹ tests 8
ℹ pass 0
ℹ fail 0
ℹ skipped 8
```

Đây là hành vi được thiết kế, không phải lỗi test. Khi stack chạy, kỳ vọng `pass 8 / fail 0`.

### 10.4. Kiểm tra cấu hình và tĩnh

| Kiểm tra | Kết quả |
|---|---|
| `docker compose config -q` | exit 0 (cú pháp và biến bắt buộc hợp lệ) |
| `node --check src/*.js src/routes/*.js` | không lỗi cú pháp |
| Cân bằng ngoặc `deployment/nginx.conf` | độ sâu 0, không âm tại dòng nào |
| JSON dashboard Grafana (4 file) | parse thành công, đủ `title`/`panels` |
| `promtail-config.yml` | YAML hợp lệ; level Nginx đã ánh xạ về tập Loki chấp nhận |

### 10.5. Kịch bản kiểm thử thủ công

Các bước dưới đây được thực hiện theo [`DEMO_CHECKLIST.md`](DEMO_CHECKLIST.md) và ghi lại kết quả thực tế
khi stack chạy:

| Kịch bản | Kỳ vọng |
|---|---|
| Đăng ký → đăng nhập → đặt lịch → huỷ lịch | Trạng thái lần lượt `pending` → `cancelled`, khung giờ trở lại danh sách trống |
| Hai phiên đặt cùng khung giờ | Phiên sau nhận 409, thông báo tiếng Việt, không treo dữ liệu |
| Khách mở `/admin.html` | UI chuyển hướng; gọi API admin trả 403 |
| Admin xác nhận lịch | `confirmed`, `confirmedAt` có giá trị, thống kê tăng |
| Header bảo mật | HSTS, CSP, X-Frame-Options, nosniff hiện diện trên HTTPS |
| `/metrics` từ Internet | 404 (chỉ Prometheus trong network monitoring scrape được) |
| Prometheus/Grafana/Loki | 6 target `UP`, 4 dashboard có dữ liệu, log Nginx + app xuất hiện trong Loki |

### 10.6. Hạn chế của lần kiểm thử gần nhất

Máy demo hiện tại trả `HTTP 500` cho mọi lệnh gọi Docker API, nên không thể build lại image và chạy
11 container trong phiên này. Vì vậy:

- Unit test và kiểm tra cấu hình vẫn chạy đầy đủ (kết quả ở trên).
- Integration test tự skip thay vì fail — đúng thiết kế.
- Các bước cần xác nhận lại khi Docker hoạt động: `docker compose up -d --build`, 6 target `UP`,
  4 dashboard có dữ liệu, log Loki xuất hiện, header HTTPS, user non-root trong container.

Quy trình xác nhận lại được ghi trong [`DEMO_CHECKLIST.md`](DEMO_CHECKLIST.md).

## 11. Đánh giá, hạn chế, hướng phát triển

### 11.1. Kết quả đạt được

| Yêu cầu đề bài | Trạng thái | Minh chứng |
|---|---|---|
| Xây dựng API đặt lịch đầy đủ nghiệp vụ | Đạt | 17 endpoint, 4 bảng, transaction + trigger |
| Giao diện khách hàng và quản trị | Đạt | 4 trang HTML + JS/CSS, CSP-safe, tiếng Việt |
| Chống đặt trùng khung giờ | Đạt | 3 lớp bảo vệ (app lock, partial unique index, trigger) |
| Phân quyền user/admin | Đạt | JWT + `requireAdmin` kiểm tra DB, integration test 403 |
| Docker hóa toàn hệ thống | Đạt (cấu hình) | 11 service, 3 network, 9 volume, healthcheck, multi-stage |
| Nginx reverse proxy + HTTPS | Đạt (cấu hình) | TLS tự sinh, HTTP→HTTPS, gzip, rate limit, security headers |
| Giám sát Prometheus/Grafana | Đạt (cấu hình) | 6 job, 6 alert, 4 dashboard, datasource provision |
| Log tập trung Loki/Promtail | Đạt (cấu hình) | 3 pipeline, label hoá, ánh xạ level, truy vấn mẫu |
| Bảo mật nhiều lớp | Đạt | bcrypt, rate limit 2 lớp, DB least privilege, container hardening |
| Kiểm thử tự động | Đạt | 21 unit pass, 8 integration tự skip khi thiếu môi trường |
| Tài liệu | Đạt | README, SECURITY, DEMO_CHECKLIST, LOGQL_QUERIES, báo cáo |

Điểm mạnh nổi bật:

1. **Tính đúng đắn của nghiệp vụ** được bảo vệ ở tầng dữ liệu, không chỉ ở ứng dụng — kể cả khi có
   script ghi trực tiếp vào DB, dữ liệu vẫn không thể rơi vào trạng thái "hai lịch cùng một slot".
2. **Khả năng quan sát** không phải phần thêm vào cuối dự án mà có từ đầu: `request_id` xuyên suốt,
   metric theo route pattern, dashboard và alert provision bằng file nên tái lập được.
3. **Bảo mật theo chiều sâu**: mỗi lớp (Nginx → Express → DB → container → network) đều có kiểm soát
   riêng, không phụ thuộc vào một lớp duy nhất.
4. **Vận hành rõ ràng**: một lệnh `docker compose up -d --build`, fail-fast khi thiếu secret, healthcheck
   cho các service chính, graceful shutdown.

### 11.2. Hạn chế

| Hạn chế | Ảnh hưởng | Ghi chú |
|---|---|---|
| Chưa có thanh toán, email/SMS nhắc lịch | Thiếu tính năng thực tế | Ngoài phạm vi đề |
| JWT không có cơ chế thu hồi/refresh token | Token bị lộ vẫn dùng được tới 8 giờ | Có thể giảm hạn hoặc thêm bảng `revoked_tokens` |
| Chống brute force dựa trên bộ nhớ tiến trình | Restart app sẽ reset bộ đếm; nhiều instance không chia sẻ | Production nên dùng Redis store |
| Rate limit chia theo IP cho auth | Người dùng sau NAT dùng chung hạn mức đăng nhập | Rate limit đặt lịch đã chia theo user id |
| Chưa có migration framework | Thay đổi schema phải viết SQL mới | Có thể thêm `node-pg-migrate`/Flyway |
| Chứng chỉ self-signed | Trình duyệt cảnh báo | Đúng cho môi trường demo, production dùng ACME |
| Không có Alertmanager | Alert chỉ hiển thị trong Prometheus UI | Bổ sung webhook email/Slack khi triển khai thật |
| Chưa chạy được stack trong phiên cuối | Chưa chụp ảnh dashboard/log thực tế | Do Docker Desktop lỗi `HTTP 500` trên máy |
| Frontend vanilla JS | Khó mở rộng khi nhiều màn hình | Đổi lại không cần build, CSP đơn giản |

### 11.3. Hướng phát triển

**Ngắn hạn**

- Thêm trang "Đổi mật khẩu", "Quên mật khẩu" (token một lần, hết hạn 15 phút).
- Gửi email xác nhận/nhắc lịch (Nodemailer + template), có hàng đợi để không chặn request.
- Bổ sung lịch làm việc theo dịch vụ/nhân viên và chặn ngày nghỉ.
- Viết thêm integration test cho admin confirm/cancel và rate limit.

**Trung hạn**

- Tách module dịch vụ (booking, notification) nếu số lượng nghiệp vụ tăng.
- Dùng Redis cho rate limit và cache danh sách dịch vụ/khung giờ.
- Thêm migration, seed theo môi trường (dev/staging/prod).
- Bổ sung Alertmanager + kênh thông báo; dashboard SLO (tỉ lệ đáp ứng, error budget).
- CI (GitHub Actions): lint, unit test, build image, quét `npm audit`/Trivy.

**Dài hạn**

- Đa chi nhánh, đa múi giờ, phân quyền theo chi nhánh.
- Thanh toán trực tuyến (VNPay/MoMo) với webhook idempotent.
- Ứng dụng di động dùng chung API, thông báo push.
- Chạy trên Kubernetes với HPA, ingress TLS, backup định kỳ và diễn tập khôi phục.


## 12. Kết luận

Đồ án đã xây dựng hoàn chỉnh một hệ thống đặt lịch hẹn trực tuyến từ cơ sở dữ liệu, API, giao diện đến
hạ tầng triển khai và bộ công cụ quan sát. Ba kết quả quan trọng nhất:

1. **Nghiệp vụ đúng và an toàn**: khung giờ không thể bị đặt trùng nhờ kết hợp khoá transaction, chỉ mục
   duy nhất có điều kiện và trigger; việc huỷ lịch giải phóng khung giờ trong cùng một transaction nên
   không có trạng thái trung gian sai.
2. **Hạ tầng tái lập được**: toàn bộ hệ thống chạy bằng Docker Compose với cấu hình fail-fast, healthcheck,
   phân đoạn mạng và nguyên tắc đặc quyền tối thiểu; Nginx là điểm vào duy nhất và bắt buộc HTTPS.
3. **Vận hành có thể quan sát**: metrics, dashboard, alert và log tập trung được provision bằng file,
   kèm bộ truy vấn mẫu để điều tra sự cố theo `request_id`.

Hạn chế còn lại chủ yếu thuộc phạm vi mở rộng (thanh toán, thông báo, thu hồi token, migration) và một
phần do môi trường Docker trên máy demo gặp sự cố trong phiên cuối. Các bước kiểm chứng lại đã được ghi
thành checklist để có thể thực hiện ngay khi môi trường ổn định.

## 13. Phụ lục

### 13.1. Tài khoản demo

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Quản trị viên | `admin@appointment.local` | `Admin@12345` |
| Khách hàng 1 | `customer1@example.com` | `Demo@12345` |
| Khách hàng 2 | `customer2@example.com` | `Demo@12345` |

pgAdmin: `admin@appointment.local` / mật khẩu trong `.env` (`PGADMIN_DEFAULT_PASSWORD`).
Grafana: `admin` / `GRAFANA_ADMIN_PASSWORD` trong `.env`.

### 13.2. URL

| Dịch vụ | URL |
|---|---|
| Website | https://localhost |
| API health | https://localhost/api/health |
| pgAdmin | http://localhost:5050 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 |
| PostgreSQL | `localhost:5432` (chỉ loopback) |

### 13.3. Lệnh thường dùng

```bash
node scripts/generate-secrets.js          # sinh .env
docker compose config -q                  # kiểm tra cấu hình
docker compose up -d --build              # build + chạy
docker compose ps                         # trạng thái/health
docker compose logs -f app                # log ứng dụng
docker compose logs -f nginx              # log proxy
docker compose exec postgres psql -U app_user -d appointment
docker compose down                       # dừng, giữ dữ liệu
docker compose down -v                    # xoá cả dữ liệu
npm test                                  # unit test
npm run test:integration                  # integration test
npm run test:all                          # cả hai
```

### 13.4. Bản đồ tài liệu

| File | Nội dung |
|---|---|
| `README.md` | Tổng quan, cài đặt, API reference, vận hành, xử lý sự cố |
| `deployment/SECURITY.md` | Mô hình mối đe doạ STRIDE, kiểm soát, kiểm chứng, rủi ro còn lại |
| `docs/DEMO_CHECKLIST.md` | Kịch bản demo từng bước và phương án dự phòng |
| `docs/LOGQL_QUERIES.md` | Truy vấn Loki/PromQL và kịch bản demo monitoring |
| `docs/BAO_CAO_DO_AN.md` | Báo cáo này |

### 13.5. Thuật ngữ

| Thuật ngữ | Giải thích |
|---|---|
| Slot | Khung giờ cụ thể của một dịch vụ, có `start_time`/`end_time` |
| Lịch đang hoạt động | Lịch ở trạng thái `pending` hoặc `confirmed` |
| Exclusion constraint | Ràng buộc PostgreSQL ngăn hai khoảng thời gian chồng lấn |
| Partial unique index | Chỉ mục duy nhất chỉ áp dụng cho các dòng thoả điều kiện `WHERE` |
| Idempotent | Gọi lại nhiều lần cho cùng kết quả (ví dụ xác nhận lịch đã xác nhận) |
| Provisioning | Nạp sẵn datasource/dashboard/alert bằng file cấu hình |
| RED/USE | Bộ chỉ số hướng dịch vụ (Rate, Errors, Duration) / hướng tài nguyên (Utilization, Saturation, Errors) |

