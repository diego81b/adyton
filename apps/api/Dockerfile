# syntax=docker/dockerfile:1.7
# Build from monorepo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat python3 make g++ \
    && corepack enable \
    && corepack prepare pnpm@9.15.4 --activate

# --- deps: install all workspace deps (cached unless lockfile changes) ---
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- build: compile TypeScript via nest build ---
FROM deps AS build
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY tsconfig.base.json ./
# rootDir="./" → nest build preserves src/ prefix → dist/src/main.js
RUN pnpm --filter @adyton/api build

# --- runner: minimal runtime image ---
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S adyton && adduser -S adyton -G adyton
# Root node_modules carries all pnpm-hoisted deps
COPY --chown=adyton:adyton --from=build /app/node_modules ./node_modules
# Package-scoped node_modules for any non-hoisted deps
COPY --chown=adyton:adyton --from=build /app/apps/api/node_modules ./apps/api/node_modules
# Compiled output (nest build → dist/main.js at apps/api/dist/main.js)
COPY --chown=adyton:adyton --from=build /app/apps/api/dist ./apps/api/dist
# package.json read by mikro-orm CLI config resolution at runtime
COPY --chown=adyton:adyton apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
USER adyton
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
