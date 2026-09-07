# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY . .
RUN npm run build

FROM caddy:2-alpine AS runtime
# The upstream Caddy binary can carry a low-port capability. Remove it so
# cap_drop: ALL and no-new-privileges work with our unprivileged listener.
RUN apk add --no-cache libcap \
    && if [ -n "$(getcap /usr/bin/caddy)" ]; then setcap -r /usr/bin/caddy; fi \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app \
    && mkdir -p /srv /config /data \
    && chown -R app:app /srv /config /data
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build --chown=app:app /app/dist/ /srv/
USER 10001:10001
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
