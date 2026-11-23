# Syntax: Multi-stage production Dockerfile for SyncDesk (frontend + backend)

# -----------------------------------------------------------------------------
# Stage 1: Dependency installation (cached layer)
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: Frontend static bundle build (Vite + React 19 + Tailwind CSS v4)
# -----------------------------------------------------------------------------
FROM deps AS frontend-build

ARG VITE_BACKEND_URL=/api
ARG VITE_DEMO_MODE=true
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}

COPY index.html tsconfig.json vite.config.ts ./
COPY .figma ./.figma
COPY public ./public
COPY src ./src

RUN pnpm run build

# -----------------------------------------------------------------------------
# Stage 3: Production frontend runtime (non-root, zero node_modules, SPA + proxy)
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS frontend

WORKDIR /app

ENV NODE_ENV=production
ENV FRONTEND_HOST=0.0.0.0
ENV FRONTEND_PORT=8443
ENV FRONTEND_DIST_DIR=/app/dist
ENV BACKEND_UPSTREAM_URL=http://backend:8787

COPY --chown=node:node --from=frontend-build /app/dist ./dist
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node scripts/serve-frontend.mjs ./scripts/serve-frontend.mjs

USER node

EXPOSE 8443

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.FRONTEND_PORT || 8443) + '/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "scripts/serve-frontend.mjs"]

# -----------------------------------------------------------------------------
# Stage 4: Production backend runtime (default target, non-root, persistent volume)
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS backend

WORKDIR /app

ENV NODE_ENV=production
ENV BACKEND_HOST=0.0.0.0
ENV BACKEND_PORT=8787
ENV BACKEND_STORE_PATH=/var/lib/syncdesk/replica.json

RUN mkdir -p /var/lib/syncdesk && chown -R node:node /var/lib/syncdesk /app

COPY --chown=node:node package.json ./package.json
COPY --chown=node:node src/backend ./src/backend
COPY --chown=node:node src/domain ./src/domain
COPY --chown=node:node src/lib ./src/lib
COPY --chown=node:node scripts/run-distributed-experiment.mjs ./scripts/run-distributed-experiment.mjs

USER node

VOLUME ["/var/lib/syncdesk"]

EXPOSE 8787

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.BACKEND_PORT || 8787) + '/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "--experimental-transform-types", "--loader", "./src/backend/api/ts-loader.mjs", "src/backend/api/server.ts"]
