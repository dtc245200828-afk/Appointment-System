# =====================================================================
# Nginx reverse proxy chạy NON-ROOT (user nginx) trên cổng 8080/8443
# Build context: ./deployment  (dockerfile: nginx/Dockerfile)
# =====================================================================
FROM nginx:1.27-alpine

# openssl để sinh chứng chỉ self-signed ở lần khởi động đầu tiên
RUN apk add --no-cache openssl \
    && rm -f /etc/nginx/conf.d/default.conf \
    && mkdir -p /etc/nginx/certs \
    && rm -f /var/log/nginx/access.log /var/log/nginx/error.log \
    && touch /var/log/nginx/access.log /var/log/nginx/error.log \
    && chown -R nginx:nginx /var/log/nginx /var/cache/nginx /etc/nginx/certs

COPY nginx.conf /etc/nginx/nginx.conf
COPY nginx/entrypoint.sh /usr/local/bin/nginx-entrypoint.sh

# Chuẩn hoá line ending (repo có thể được clone trên Windows) và cấp quyền thực thi
RUN sed -i 's/\r$//' /usr/local/bin/nginx-entrypoint.sh \
    && chmod 0755 /usr/local/bin/nginx-entrypoint.sh

USER nginx

EXPOSE 8080 8443

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/nginx-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
