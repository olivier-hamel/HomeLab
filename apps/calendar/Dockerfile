# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=4173
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts/ ./scripts/
COPY --chown=node:node dist/ ./dist/
USER node
EXPOSE 4173
CMD ["node", "scripts/serve.mjs"]
