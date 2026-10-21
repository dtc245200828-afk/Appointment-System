# syntax=docker/dockerfile:1
# =====================================================================
# Dockerfile cho ứng dụng Node.js/Express (production, chạy non-root)
# =====================================================================

# ---------- Stage 1: cài dependency (kể cả build native module bcrypt) ----------
FROM node:22-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Stage 2: runtime tối giản ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_DIR=/app/logs

# tini làm PID 1 để xử lý signal/zombie process đúng cách
RUN apk add --no-cache tini \
    && mkdir -p /app/logs \
    && chown -R node:node /app

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

# Chạy bằng user không đặc quyền (uid 1000 - node)
USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
