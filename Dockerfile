# =============================================================================
# LEVELUP RWANDA — Production Dockerfile for Google Cloud Run
# =============================================================================
# Production CLI commands (zero devDependencies / tsx required):
#   Migration status:    node dist-server/migrate-cli.js status
#   Migration dry-run:   node dist-server/migrate-cli.js dry-run
#   Apply migrations:    node dist-server/migrate-cli.js up
#   Seed reference data: node dist-server/seed-cli.js
#   Bootstrap admin:     node dist-server/bootstrap-admin-cli.js --email=... --name=... --username=... --password=...
# =============================================================================

FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Prune devDependencies for minimal runtime image (bundled CLIs run via node)
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV UPLOAD_STORAGE_DRIVER=gcs

# Non-root runtime user for Cloud Run security best practices
RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/package*.json ./
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/dist-server ./dist-server

USER appuser
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/v1/health || exit 1

CMD ["node", "dist-server/server.js"]
