# Build context: repository root
#   docker build -f apps/pipeline/Dockerfile -t soundcheck-pipeline .
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
RUN npm install --global pnpm@12.6.0 turbo@2.11.7
WORKDIR /app

# Keep only the workspaces the pipeline needs.
FROM base AS pruner
COPY . .
RUN turbo prune @soundcheck/pipeline --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN turbo run build --filter=@soundcheck/pipeline

# Production dependencies, hoisted so the bundle (which inlines
# @soundcheck/core) can resolve core's own dependencies from /app/node_modules.
# No lifecycle scripts: nothing at runtime needs them.
FROM base AS prod-deps
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --config.node-linker=hoisted

FROM node:${NODE_VERSION}-slim AS runtime
# ffprobe is needed to read uploaded cuts.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/pipeline/package.json ./apps/pipeline/package.json
COPY --from=builder /app/apps/pipeline/dist ./apps/pipeline/dist
USER node
ENTRYPOINT ["node", "--enable-source-maps", "apps/pipeline/dist/main.js"]
