#!/bin/sh
# =====================================================================
# Entrypoint của Nginx container (chạy bằng user nginx, không phải root).
# Sinh chứng chỉ self-signed nếu chưa có trong volume nginx_certs.
# =====================================================================
set -eu

CERT_DIR="/etc/nginx/certs"
CERT_FILE="${CERT_DIR}/server.crt"
KEY_FILE="${CERT_DIR}/server.key"
SERVER_NAME="${NGINX_SERVER_NAME:-localhost}"

mkdir -p "$CERT_DIR"

if [ ! -s "$CERT_FILE" ] || [ ! -s "$KEY_FILE" ]; then
    echo "[nginx-entrypoint] Chưa có chứng chỉ, đang sinh self-signed certificate cho CN=${SERVER_NAME} ..."
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
        -keyout "$KEY_FILE" \
        -out "$CERT_FILE" \
        -subj "/C=VN/ST=HCM/L=Ho Chi Minh/O=Appointment System/OU=DevOps/CN=${SERVER_NAME}" \
        -addext "subjectAltName=DNS:localhost,DNS:${SERVER_NAME},IP:127.0.0.1" \
        >/dev/null 2>&1
    chmod 600 "$KEY_FILE"
    chmod 644 "$CERT_FILE"
    echo "[nginx-entrypoint] Đã tạo chứng chỉ: $CERT_FILE (self-signed, hết hạn sau 365 ngày)"
else
    echo "[nginx-entrypoint] Dùng chứng chỉ có sẵn: $CERT_FILE"
fi

# Kiểm tra cú pháp cấu hình trước khi chạy
nginx -t

exec "$@"
