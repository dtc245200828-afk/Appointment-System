# Checklist demo — Hệ thống đặt lịch hẹn (Đề 40)

Mục tiêu: chạy demo 10–15 phút, chứng minh đủ 5 nhóm yêu cầu (chức năng, Docker, bảo mật,
giám sát, log) và có phương án dự phòng khi Docker gặp sự cố.

## 0. Chuẩn bị trước demo (làm trước 10 phút)

```bash
# 1. Kiểm tra Docker hoạt động
docker info

# 2. Sinh .env nếu chưa có (ghi lại mật khẩu Grafana/pgAdmin được in ra)
node scripts/generate-secrets.js

# 3. Kiểm tra cấu hình
docker compose config -q

# 4. Build & chạy
docker compose up -d --build

# 5. Chờ tất cả service healthy (app, nginx, postgres, prometheus, grafana, loki)
docker compose ps

# 6. Unit test (không phụ thuộc Docker)
npm test
```

Checklist chuẩn bị:

- [ ] `docker compose ps` hiển thị `healthy` cho `postgres`, `app`, `nginx`, `prometheus`, `grafana`, `loki`.
- [ ] `curl -k https://localhost/api/health` trả `{"status":"ok","database":"up",...}`.
- [ ] Đã mở sẵn 4 tab: website, Grafana, Prometheus, pgAdmin.
- [ ] Đã đăng nhập Grafana và mở dashboard **Appointment System / Overview**.
- [ ] Đã biết mật khẩu demo: `admin@appointment.local / Admin@12345`, `customer1@example.com / Demo@12345`.
- [ ] Nếu cổng 80/443 bận: đã đổi `HTTP_PORT`/`HTTPS_PORT` trong `.env` và dùng URL tương ứng.

## 1. Kiến trúc & hạ tầng Docker (2 phút)

```bash
docker compose ps
docker compose images
docker network ls | findstr appointment
docker volume ls | findstr appointment
```

Kỳ vọng:

- 11 service: `postgres`, `app`, `nginx`, `pgadmin`, `prometheus`, `cadvisor`,
  `postgres-exporter`, `nginx-exporter`, `loki`, `promtail`, `grafana`.
- 3 network: `appointment_frontend`, `appointment_backend` (internal), `appointment_monitoring`.
- Chỉ `nginx` publish 80/443; `pgadmin`/`prometheus`/`grafana` bind `127.0.0.1`;
  PostgreSQL **không publish cổng** (chỉ trong network `backend` internal).

Nói: "Ứng dụng không publish cổng 3000, database không ra Internet; Nginx là điểm vào duy nhất."

## 2. Chức năng khách hàng (3 phút)

1. Mở `https://localhost` → chấp nhận cảnh báo chứng chỉ.
2. Quan sát: danh sách dịch vụ, bộ lọc ngày, các khung giờ nhóm theo buổi sáng/chiều/tối.
3. Đăng nhập `customer1@example.com / Demo@12345`.
4. Chọn dịch vụ → chọn ngày → chọn khung giờ → nhập ghi chú → **Đặt lịch**.
5. Kiểm tra mục **Lịch hẹn của tôi**: lịch mới ở trạng thái `Chờ xác nhận`.
6. Mở tab ẩn danh, đăng nhập `customer2@example.com`, đặt **cùng khung giờ** → nhận lỗi 409
   "Khung giờ đã được đặt".
7. Quay lại tab đầu, **Huỷ** lịch → trạng thái `Đã huỷ`; tải lại danh sách khung giờ → khung giờ xuất hiện lại.

Kỳ vọng: không lỗi console; thông báo tiếng Việt rõ ràng; khung giờ giải phóng ngay sau khi huỷ.

## 3. Chức năng quản trị (2 phút)

1. Đăng nhập `admin@appointment.local / Admin@12345`.
2. Vào `https://localhost/admin.html`:
   - Thẻ thống kê: tổng lịch, chờ xác nhận, đã xác nhận, đã huỷ, khách hàng, dịch vụ.
   - Bảng lịch hẹn có phân trang, lọc theo trạng thái/ngày/từ khoá.
3. Bấm **Xác nhận** một lịch `pending` → trạng thái chuyển `Đã xác nhận`, thống kê cập nhật.
4. Bấm **Huỷ** kèm lý do → trạng thái `Đã huỷ`, khung giờ được giải phóng.
5. Đăng xuất, đăng nhập tài khoản khách rồi mở `/admin.html` → bị chuyển về trang chủ/không có quyền.

Kỳ vọng: không thể truy cập chức năng admin bằng tài khoản khách (UI + API 403).

## 4. Bảo mật (2 phút)

```bash
curl -I http://localhost/                       # 301 -> https
curl -k -I https://localhost/                   # HSTS, CSP, X-Frame-Options, ...
curl -k -o NUL -w "%{http_code}\n" https://localhost/metrics      # 404
curl -k -o NUL -w "%{http_code}\n" https://localhost/.env         # 404
curl -k -o NUL -w "%{http_code}\n" https://localhost/api/admin/stats  # 401
docker compose exec app id                      # uid=1000(node)
docker compose exec nginx id                    # uid=101(nginx)
docker compose exec postgres psql -U app_user -d appointment -c "CREATE TABLE hack(id int);"
```

Kỳ vọng: `permission denied for schema public`; log container không chứa `Authorization`/mật khẩu
(tìm `REDACTED`).

## 5. Giám sát Prometheus (2 phút)

1. http://localhost:9090/targets → 6 job: `prometheus`, `appointment-web`, `cadvisor`, `postgres`,
   `nginx`, `loki` — tất cả `UP`.
2. http://localhost:9090/alerts → 6 rule đã nạp (`AppointmentAppDown`, `AppointmentDatabaseDown`,
   `NginxDown`, `HighHttpErrorRate`, `HighRequestLatencyP95`, `TooManyActiveAppointments`).
3. Chạy query:
   ```promql
   sum(rate(http_requests_total[1m]))
   histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
   ```
   Tải lại trang web vài lần → biểu đồ tăng.
4. (Tuỳ chọn) `docker compose stop app` → sau ~1 phút alert `AppointmentAppDown` chuyển `firing`,
   Nginx trả 503; `docker compose start app` để phục hồi.

## 6. Grafana dashboard (2 phút)

http://localhost:3001 → thư mục **Appointment System**:

| Dashboard | Điểm cần chỉ |
|---|---|
| Overview | Uptime app, số lịch đang hoạt động, CPU/RAM container, trạng thái target |
| Web | Request/giây, tỉ lệ 5xx, P95 theo route, lịch tạo/xác nhận/huỷ mỗi phút, xung đột |
| Database | `pg_up`, kết nối, transaction commit/rollback, cache hit, kích thước DB, pool |
| Logs | Tốc độ log theo service, bảng log lỗi, ô tìm kiếm `$search` |

Kỳ vọng: dữ liệu hiển thị (không "No data"); đổi time range 15m/1h đều có dữ liệu.

## 7. Loki & log tập trung (2 phút)

Trong Grafana → **Explore** → **Loki**, chạy:

```logql
{job="nginx", log_type="access"} | json | status >= 400
{job="appointment-app"} | json | level =~ "warn|error|fatal"
{job="appointment-app"} |= "Đăng nhập thất bại"
sum by (status_code) (count_over_time({job="nginx", log_type="access"}[1m]))
```

Sau đó cố tình đăng nhập sai 1 lần → log `Đăng nhập thất bại` xuất hiện trong vài giây.
Xem thêm bộ truy vấn đầy đủ tại [`LOGQL_QUERIES.md`](LOGQL_QUERIES.md).

## 8. Kiểm thử tự động (1 phút)

```bash
npm test                     # 21 unit test
npm run test:integration     # 10 integration test khi stack đang chạy
```

Kết quả mong đợi: unit `pass 21 / fail 0`; integration `pass 10 / fail 0 / skipped 0`
(nếu stack chưa chạy: `skipped 10` kèm lý do, không tính là lỗi). Bộ test giãn nhịp ~4 request/giây
để không chạm rate limit 5 r/s của Nginx; `/api/auth/` giới hạn 20 request/15 phút/IP nên nếu chạy
lại nhiều lần liền, reset bộ đếm bằng `docker compose restart app`.

## 9. Dọn dẹp sau demo

```bash
docker compose stop                 # dừng, giữ dữ liệu
docker compose down                 # xoá container, giữ volume
docker compose down -v              # xoá toàn bộ dữ liệu (dùng khi muốn reset seed)
```

## 10. Phương án dự phòng

| Tình huống | Cách xử lý |
|---|---|
| Docker Desktop lỗi `HTTP 500` | Restart Docker Desktop → `wsl --shutdown` → mở lại; kiểm tra `docker info` trước khi demo |
| Cổng 80/443 bị chiếm | Sửa `HTTP_PORT`/`HTTPS_PORT` trong `.env`, `docker compose up -d`, dùng `https://localhost:<port>` |
| App không lên do DB init lỗi | `docker compose logs postgres`; nếu volume cũ hỏng: `docker compose down -v` rồi up lại |
| Grafana trắng dashboard | `docker compose restart grafana`; kiểm tra log provisioning |
| Không có Loki log | `docker compose logs promtail`; đảm bảo volume `app_logs`/`nginx_logs` có file |
| Không thể chạy Docker | Trình bày kiến trúc bằng sơ đồ, chạy `npm test`, `docker compose config -q`, trình bày source + báo cáo; nêu rõ hạn chế môi trường |

## 11. Bảng đối chiếu yêu cầu → minh chứng

| Yêu cầu | Minh chứng khi demo |
|---|---|
| Đăng ký/đăng nhập, phân quyền | Mục 2, 3 |
| Xem dịch vụ, khung giờ trống | Mục 2 |
| Đặt lịch, chống trùng, huỷ lịch | Mục 2 (bước 6–7) |
| Quản trị: xác nhận/huỷ, lọc, thống kê | Mục 3 |
| Docker hóa nhiều service | Mục 1 |
| Nginx reverse proxy + HTTPS | Mục 4 |
| Bảo mật (header, rate limit, least privilege) | Mục 4 |
| Prometheus + alert rules | Mục 5 |
| Grafana dashboard | Mục 6 |
| Loki/Promtail log tập trung | Mục 7 |
| Kiểm thử tự động | Mục 8 |

