# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS assets
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=optional --ignore-scripts
COPY scripts/ ./scripts/
COPY dist/ ./dist/
RUN npm run prepare:pdf

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4173
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts/ ./scripts/
COPY --from=assets --chown=node:node /app/dist/ ./dist/
USER node
EXPOSE 4173
CMD ["node", "scripts/serve.mjs"]
