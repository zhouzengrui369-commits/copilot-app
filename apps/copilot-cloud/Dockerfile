# syntax=docker/dockerfile:1.6
# Copilot Cloud — Fastify server (multi-stage, distroless final).
# Build context = repo root, then target this app dir.

FROM node:24-alpine AS builder
WORKDIR /repo

# Cache deps first
COPY apps/copilot-cloud/package.json apps/copilot-cloud/package-lock.json* ./apps/copilot-cloud/
WORKDIR /repo/apps/copilot-cloud
RUN npm install --no-audit --no-fund

# Copy source + tsconfig
WORKDIR /repo
COPY apps/copilot-cloud/tsconfig.json ./apps/copilot-cloud/
COPY apps/copilot-cloud/src ./apps/copilot-cloud/src

# Build
WORKDIR /repo/apps/copilot-cloud
RUN npm run build

# ---- runtime ----
FROM gcr.io/distroless/nodejs24-debian12 AS runtime
WORKDIR /app

COPY --from=builder /repo/apps/copilot-cloud/dist ./dist
COPY --from=builder /repo/apps/copilot-cloud/node_modules ./node_modules
COPY --from=builder /repo/apps/copilot-cloud/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=8788
ENV HOST=0.0.0.0

EXPOSE 8788

USER nonroot
ENTRYPOINT ["node", "dist/index.js"]