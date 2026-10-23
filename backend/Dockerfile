# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Install on Linux, including the lockfile's optional native Next.js packages.
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# The API-only app currently has no public directory. Make the runtime COPY
# valid while preserving public assets if they are added in a future change.
RUN mkdir -p public && npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libreoffice-impress fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home app \
    && chown app:app /app \
    && mkdir -p /data/library /data/camera /data/media-downloads \
    && chown app:app /data/library /data/camera /data/media-downloads
COPY --from=build --chown=app:app /app/.next/standalone/ ./
COPY --from=build --chown=app:app /app/.next/static/ ./.next/static/
COPY --from=build --chown=app:app /app/public/ ./public/
# Private MCP operations checker: no .env or SSH key is included in the image.
COPY --from=build --chown=app:app /app/scripts/check-moodle.mjs ./scripts/check-moodle.mjs
COPY --from=build --chown=app:app /app/src/lib/ ./src/lib/
COPY --from=build --chown=app:app /app/scripts/sync-library.mjs ./scripts/sync-library.mjs
COPY --from=build --chown=app:app /app/scripts/test-calendar-pdf.mjs ./scripts/test-calendar-pdf.mjs
COPY --from=build --chown=app:app /app/scripts/lib/calendar-pdf-fixture.mjs ./scripts/lib/calendar-pdf-fixture.mjs
USER 10001:10001
EXPOSE 3001
CMD ["node", "server.js"]
