# Build context: repository root
#   docker build -f apps/web/Dockerfile -t soundcheck-web .
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.6.0 turbo@2.11.7
WORKDIR /app

# Keep only the workspaces the web app needs.
FROM base AS pruner
COPY . .
RUN turbo prune @soundcheck/web --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_USE_FIXTURES=false
ENV NEXT_PUBLIC_USE_FIXTURES=${NEXT_PUBLIC_USE_FIXTURES}
RUN turbo run build --filter=@soundcheck/web

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
