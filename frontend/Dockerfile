# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY . .
ARG VITE_MEMO_HTTPS_PORT=3443
ENV VITE_MEMO_HTTPS_PORT=${VITE_MEMO_HTTPS_PORT}
RUN npm run build

FROM caddy:2-alpine AS runtime
# The upstream Caddy binary can carry a low-port capability. Remove it so
# cap_drop: ALL and no-new-privileges work with our unprivileged listener.
RUN apk add --no-cache libcap jq \
    && if [ -n "$(getcap /usr/bin/caddy)" ]; then setcap -r /usr/bin/caddy; fi \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app \
    && mkdir -p /srv /config /data \
    && chown -R app:app /srv /config /data
COPY Caddyfile /etc/caddy/Caddyfile
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/dashboard-entrypoint
COPY --from=build --chown=app:app /app/dist/ /srv/
USER 10001:10001
EXPOSE 8080 8443 8444
ENTRYPOINT ["/usr/local/bin/dashboard-entrypoint"]
CMD ["caddy", "run", "--config", "/config/runtime.json"]
