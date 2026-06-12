@echo off
REM Adyton — docker compose wrapper. Adapted from the user's standard run.bat
REM pattern. Use base + overlay (dev or prod). See docker-compose*.yml headers.

if "%1"=="dev-up"          ( docker compose -f docker-compose.yml -f docker-compose.dev.yml up ) & exit /b
if "%1"=="dev-up-d"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d ) & exit /b
if "%1"=="dev-up-b"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build ) & exit /b
if "%1"=="dev-up-bd"       ( docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d ) & exit /b
if "%1"=="dev-fresh-api"   ( docker compose -f docker-compose.yml -f docker-compose.dev.yml stop api & docker compose -f docker-compose.yml -f docker-compose.dev.yml rm -v -f api & docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d api ) & exit /b
if "%1"=="dev-fresh-web"   ( docker compose -f docker-compose.yml -f docker-compose.dev.yml stop web & docker compose -f docker-compose.yml -f docker-compose.dev.yml rm -v -f web & docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d web ) & exit /b
if "%1"=="dev-no-web"      ( docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db redis api ) & exit /b
if "%1"=="dev-down"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml down ) & exit /b
if "%1"=="dev-build"       ( docker compose -f docker-compose.yml -f docker-compose.dev.yml build ) & exit /b
if "%1"=="dev-logs"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f ) & exit /b

REM web-local: stop web container (if running), start db/redis/api in Docker,
REM then run Nuxt dev natively on Windows — eliminates Docker bind-mount overhead.
REM First load: ~3-5 s instead of 90 s.  http://localhost:30000
if "%1"=="web-local" (
    docker compose -f docker-compose.yml -f docker-compose.dev.yml stop web 2>nul
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db redis api
    set NUXT_PUBLIC_API_BASE_URL=http://localhost:30001
    set NODE_ENV=development
    set PORT=30000
    pnpm --filter @adyton/web dev
) & exit /b

if "%1"=="test-api"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api pnpm test ) & exit /b
if "%1"=="test-api-cov"    ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api pnpm test:cov ) & exit /b
if "%1"=="test-api-e2e"    ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api pnpm test:e2e ) & exit /b
if "%1"=="test-web"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web pnpm test ) & exit /b
if "%1"=="test-web-cov"    ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web pnpm test:cov ) & exit /b
if "%1"=="test-web-local"  ( pnpm --filter @adyton/web exec vitest run ) & exit /b
if "%1"=="test-web-local-cov" ( pnpm --filter @adyton/web test:cov ) & exit /b
if "%1"=="test-shared"     ( pnpm --filter @adyton/shared test ) & exit /b
if "%1"=="test-shared-cov" ( pnpm --filter @adyton/shared test:cov ) & exit /b
if "%1"=="test-all"        ( pnpm -r test ) & exit /b
if "%1"=="test-all-cov"    ( pnpm -r test:cov ) & exit /b

if "%1"=="shell-api"       ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api sh ) & exit /b
if "%1"=="shell-web"       ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web sh ) & exit /b
if "%1"=="shell-db"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec db psql -U adyton -d adyton ) & exit /b

if "%1"=="prod-up"         ( docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d ) & exit /b
if "%1"=="prod-down"       ( docker compose -f docker-compose.yml -f docker-compose.prod.yml down ) & exit /b
if "%1"=="prod-build"      ( docker compose -f docker-compose.yml -f docker-compose.prod.yml build ) & exit /b
if "%1"=="prod-logs"       ( docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f ) & exit /b

if "%1"=="ps"              ( docker compose ps ) & exit /b
if "%1"=="clean"           ( docker compose down -v --remove-orphans ) & exit /b

echo Uso: run.bat [comando]
echo.
echo Dev (Docker): dev-up dev-up-d dev-up-b dev-up-bd dev-fresh-api dev-fresh-web dev-no-web dev-down dev-build dev-logs
echo Dev (local):  web-local  ^<-- API in Docker + web native on host, http://localhost:30000 (fast)
echo Test:         test-api test-api-cov test-api-e2e test-web test-web-cov test-web-local test-web-local-cov
echo               test-shared test-shared-cov test-all test-all-cov
echo Shell:        shell-api shell-web shell-db
echo Prod:         prod-up prod-down prod-build prod-logs (stub until Phase 8)
echo Misc:         ps clean
