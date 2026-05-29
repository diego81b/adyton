@echo off
REM Adyton — docker compose wrapper. Adapted from the user's standard run.bat
REM pattern. Use base + overlay (dev or prod). See docker-compose*.yml headers.

if "%1"=="dev-up"          ( docker compose -f docker-compose.yml -f docker-compose.dev.yml up ) & exit /b
if "%1"=="dev-up-d"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d ) & exit /b
if "%1"=="dev-up-b"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build ) & exit /b
if "%1"=="dev-up-bd"       ( docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d ) & exit /b
if "%1"=="dev-fresh-api"   ( docker compose -f docker-compose.yml -f docker-compose.dev.yml stop api & docker compose -f docker-compose.yml -f docker-compose.dev.yml rm -v -f api & docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d api ) & exit /b
if "%1"=="dev-fresh-web"   ( docker compose -f docker-compose.yml -f docker-compose.dev.yml stop web & docker compose -f docker-compose.yml -f docker-compose.dev.yml rm -v -f web & docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d web ) & exit /b
if "%1"=="dev-down"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml down ) & exit /b
if "%1"=="dev-build"       ( docker compose -f docker-compose.yml -f docker-compose.dev.yml build ) & exit /b
if "%1"=="dev-logs"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f ) & exit /b

if "%1"=="test-api"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api pnpm test ) & exit /b
if "%1"=="test-api-cov"    ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api pnpm test:cov ) & exit /b
if "%1"=="test-api-e2e"    ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec api pnpm test:e2e ) & exit /b
if "%1"=="test-web"        ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web pnpm test ) & exit /b
if "%1"=="test-web-cov"    ( docker compose -f docker-compose.yml -f docker-compose.dev.yml exec web pnpm test:cov ) & exit /b
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
echo Dev:    dev-up dev-up-d dev-up-b dev-up-bd dev-fresh-api dev-fresh-web dev-down dev-build dev-logs
echo Test:   test-api test-api-cov test-api-e2e test-web test-web-cov test-shared test-shared-cov test-all test-all-cov
echo Shell:  shell-api shell-web shell-db
echo Prod:   prod-up prod-down prod-build prod-logs (stub until Phase 8)
echo Misc:   ps clean
