# Truy vấn LogQL & PromQL dùng cho demo

Tất cả truy vấn dưới đây đã khớp với label/cấu hình thực tế trong
`deployment/promtail/promtail-config.yml` và `deployment/prometheus/prometheus.yml`.

## 1. Khám phá label trong Loki

Mở Grafana → **Explore** → chọn datasource **Loki**, chạy lần lượt:

```logql
{job="nginx"}
{job="appointment-app"}
{service="nginx"}
{service="appointment-web"}
```

Label có sẵn:

| Label | Giá trị | Nguồn |
|---|---|---|
| `job` | `nginx`, `appointment-app` | Promtail scrape config |
| `service` | `nginx`, `appointment-web` | Promtail labels |
| `env` | `production` | Promtail labels |
| `log_type` | `access`, `error`, `app` | Promtail labels |
| `level` | `info`, `warn`, `error`, `critical`, `fatal` | Pipeline stage |
| `method`, `status_code` | `GET`, `200`, ... | JSON stage (access log, app log) |

> Không đưa `uri`, `request_id`, `remote_addr` thành label (cardinality cao) — các field này vẫn
> nằm trong nội dung log và có thể lọc bằng `| json`.

## 2. Log Nginx

```logql
# Toàn bộ access log
{job="nginx", log_type="access"}

# Chỉ request lỗi 5xx
{job="nginx", log_type="access"} | json | status >= 500

# Request API trả 4xx (loại trừ 404 tài nguyên tĩnh)
{job="nginx", log_type="access"} | json | uri =~ "/api/.*" | status >= 400 | status < 500

# Tìm theo từ khoá (ví dụ email trong query string)
{job="nginx", log_type="access"} |= "customer1@example.com"

# Request chậm hơn 1 giây (request_time là số, dùng unwrap)
quantile_over_time(0.95, {job="nginx", log_type="access"} | json | unwrap request_time [5m])

# Tốc độ request theo status code (log-based)
sum by (status_code) (count_over_time({job="nginx", log_type="access"}[1m]))

# Top 10 endpoint được gọi nhiều nhất trong 1 giờ
topk(10, sum by (uri) (count_over_time({job="nginx", log_type="access"} | json [1h])))

# Log lỗi của Nginx (error.log), chỉ mức error/critical
{job="nginx", log_type="error"} | json | level =~ "error|critical"
```

## 3. Log ứng dụng (pino JSON)

```logql
# Log có mức warn/error/fatal
{job="appointment-app"} | json | level =~ "warn|error|fatal"

# Chỉ error/fatal
{job="appointment-app"} | json | level =~ "error|fatal"

# Đăng nhập thất bại (kèm email/IP trong log line)
{job="appointment-app"} |= "Đăng nhập thất bại"

# Đặt lịch thành công
{job="appointment-app"} |= "Đặt lịch hẹn thành công"

# Huỷ lịch (phân biệt khách tự huỷ và admin huỷ qua trường actorRole)
{job="appointment-app"} | json | msg = "Huỷ lịch hẹn và giải phóng khung giờ"

# Lỗi xử lý request theo route
{job="appointment-app"} | json | level = "error" | method = "POST" | uri =~ "/api/appointments.*"

# Đếm log lỗi theo phút
sum(count_over_time({job="appointment-app"} | json | level =~ "error|fatal" [1m]))

# Tìm theo request id (correlation với header X-Request-Id)
{job=~"nginx|appointment-app"} |= "<request-id>"
```

## 4. Truy vấn PromQL

### 4.1. Sức khoẻ hệ thống

```promql
up                                                               # 1 = target đang lên
up{job="appointment-web"}                                        # riêng ứng dụng
time() - nodejs_process_start_time_seconds                       # uptime (giây)
appointments_active                                              # số lịch đang hoạt động
count(container_last_seen{name=~".+"})                           # số container cAdvisor thấy
```

### 4.2. HTTP & nghiệp vụ

```promql
sum(rate(http_requests_total[1m]))                                        # request/giây
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m]))                                    # tỉ lệ lỗi 5xx
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))   # P95
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))
http_requests_in_flight                                                   # request đang xử lý
rate(appointments_created_total[5m]) * 60                                 # lịch tạo/phút
rate(appointment_booking_conflicts_total[5m]) * 60                        # xung đột/phút
sum by (actor_role) (rate(appointments_cancelled_total[5m])) * 60         # huỷ theo vai trò
topk(10, sum by (method, route, status) (rate(http_requests_total[5m])))
```

### 4.3. Tài nguyên container (cAdvisor)

```promql
sum by (name) (rate(container_cpu_usage_seconds_total{name=~".+"}[5m]))
sum by (name) (container_memory_working_set_bytes{name=~".+"})
```

### 4.4. PostgreSQL

```promql
pg_up
pg_stat_database_numbackends{datname="appointment"}
pg_database_size_bytes{datname="appointment"}
sum by (state) (pg_stat_activity_count{datname="appointment"})
sum(rate(pg_stat_database_xact_commit{datname="appointment"}[5m]))
sum(rate(pg_stat_database_xact_rollback{datname="appointment"}[5m]))
sum(rate(pg_stat_database_deadlocks{datname="appointment"}[15m]))
histogram_quantile(0.95, sum by (le, operation) (rate(database_query_duration_seconds_bucket[5m])))
pg_pool_total_connections
pg_pool_idle_connections
pg_pool_waiting_requests
```

### 4.5. Nginx

```promql
sum(rate(nginx_http_requests_total[5m]))
nginx_up
rate(nginx_http_requests_total{status=~"5.."}[5m])
```

## 5. Kịch bản demo gợi ý

1. Mở Grafana → **Appointment System / Overview**, chỉ vào uptime và số lịch đang hoạt động.
2. Chạy `sum(rate(http_requests_total[1m]))` trong Explore (Prometheus) và tải lại trang web
   để thấy biểu đồ tăng.
3. Mở dashboard **Logs**, gõ `{job="appointment-app"} |= "Đăng nhập thất bại"` sau khi cố tình
   đăng nhập sai → log xuất hiện gần như tức thì (batch 1s).
4. Đặt trùng một khung giờ bằng 2 tài khoản → dashboard Web tăng
   `appointment_booking_conflicts_total`, Loki hiển thị log lỗi 409.
5. Dừng app (`docker compose stop app`) → sau ~1 phút Prometheus báo `AppointmentAppDown`
   và Nginx trả 503 (trang lỗi tuỳ chỉnh) → bật lại bằng `docker compose start app`.
