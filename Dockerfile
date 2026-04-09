# =============================================================================
# OctoMate — ElizaOS GitHub copilot for the Nosana Builders Challenge
#
# Multi-stage build:
#   1. deps   — install workspace deps (pnpm, frozen lockfile)
#   2. build  — compile agent (tsc) and web (next build)
#   3. runner — minimal runtime image with only what's needed to `node` + `next start`
# =============================================================================

FROM node:23-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY agent/package.json agent/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile || pnpm install

# ---- build ----
FROM deps AS build
COPY . .
RUN pnpm --filter agent build \
 && pnpm --filter web build

# ---- runner ----
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

# Copy workspace root files so pnpm inside the image can resolve packages.
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/pnpm-lock.yaml* ./

# Agent: compiled JS + its node_modules + its character files
COPY --from=build /app/agent/package.json ./agent/package.json
COPY --from=build /app/agent/dist ./agent/dist
COPY --from=build /app/agent/characters ./agent/characters
COPY --from=build /app/agent/node_modules ./agent/node_modules

# Web: built next output + runtime deps + public assets
COPY --from=build /app/web/package.json ./web/package.json
COPY --from=build /app/web/.next ./web/.next
COPY --from=build /app/web/node_modules ./web/node_modules
COPY --from=build /app/web/public ./web/public
COPY --from=build /app/web/next.config.ts ./web/next.config.ts

# Entrypoint script
COPY scripts/start.sh /app/scripts/start.sh
RUN chmod +x /app/scripts/start.sh

# Nosana only exposes the public web port; the agent stays internal.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["/app/scripts/start.sh"]
