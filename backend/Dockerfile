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
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home app \
    && chown app:app /app
COPY --from=build --chown=app:app /app/.next/standalone/ ./
COPY --from=build --chown=app:app /app/.next/static/ ./.next/static/
COPY --from=build --chown=app:app /app/public/ ./public/
USER 10001:10001
EXPOSE 3001
CMD ["node", "server.js"]
