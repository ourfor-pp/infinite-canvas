# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
# 网页与后台共用声明式预演求值器及固定版本 Three.js。
COPY server/package.json server/package-lock.json /app/server/
RUN --mount=type=cache,target=/root/.bun/install/cache cd /app/server && bun install --cache-dir=/root/.bun/install/cache
COPY server/src/previs /app/server/src/previs
RUN bun run build

# 此镜像仅包含静态前端；Express、媒体与预演工作进程部署仍需单独配置。
FROM nginx:1.27-alpine

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 3000
