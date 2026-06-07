# syntax=docker/dockerfile:1.7
# Build from monorepo root: docker build -f apps/web/Dockerfile .
#
# NUXT_PUBLIC_API_BASE_URL does NOT need to be a build ARG.
# Nuxt runtimeConfig.public is server-overridable at startup — pass it as a
# runtime env var in docker-compose.prod.yml (Coolify dashboard env var).
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@9.15.4 --activate

# --- deps: install all workspace deps (cached unless lockfile changes) ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- build: run nuxt build (pnpm scopes to apps/web workdir automatically) ---
FROM deps AS build
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
COPY tsconfig.base.json ./
RUN pnpm --filter @adyton/web build

# --- runner: minimal runtime image ---
# Nitro bundles all server deps into .output/ — no node_modules needed.
FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app
RUN addgroup -S adyton && adduser -S adyton -G adyton
COPY --chown=adyton:adyton --from=build /app/apps/web/.output ./.output
USER adyton
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
