#!/usr/bin/env bash
# Adyton — PostgreSQL backup script
#
# Usage:
#   PGPASSWORD=<pass> PGHOST=<host> PGPORT=5432 PGUSER=adyton PGDATABASE=adyton \
#     BACKUP_DIR=/var/backups/adyton ./scripts/backup.sh
#
# Environment variables:
#   PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD  — connection params
#   BACKUP_DIR   — local directory to write backups (default: /var/backups/adyton)
#   RCLONE_DEST  — optional rclone remote path for offsite copies (e.g. s3:my-bucket/adyton)
#   KEEP_DAILY   — number of daily backups to keep (default: 7)
#   KEEP_WEEKLY  — number of weekly backups to keep (default: 4)
#
# Retention: daily snapshots kept for KEEP_DAILY days; on Sundays an additional
# weekly copy is kept for KEEP_WEEKLY weeks.
#
# Designed to run as a cron job on the Hetzner VPS.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/adyton}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
TIMESTAMP="$(date +%Y%m%dT%H%M%SZ)"
DOW="$(date +%u)"  # 1=Mon … 7=Sun

mkdir -p "${BACKUP_DIR}/daily" "${BACKUP_DIR}/weekly"

DAILY_FILE="${BACKUP_DIR}/daily/adyton_${TIMESTAMP}.sql.gz"
echo "[backup] dumping database → ${DAILY_FILE}"
pg_dump \
  --host="${PGHOST:-localhost}" \
  --port="${PGPORT:-5432}" \
  --username="${PGUSER:-adyton}" \
  --dbname="${PGDATABASE:-adyton}" \
  --no-password \
  --format=plain \
  | gzip -9 > "${DAILY_FILE}"

echo "[backup] daily dump complete ($(du -sh "${DAILY_FILE}" | cut -f1))"

# Weekly copy on Sundays
if [ "${DOW}" -eq 7 ]; then
  WEEKLY_FILE="${BACKUP_DIR}/weekly/adyton_weekly_${TIMESTAMP}.sql.gz"
  cp "${DAILY_FILE}" "${WEEKLY_FILE}"
  echo "[backup] weekly copy → ${WEEKLY_FILE}"
fi

# Prune old daily backups
echo "[backup] pruning daily → keep ${KEEP_DAILY} newest"
ls -t "${BACKUP_DIR}/daily/"*.sql.gz 2>/dev/null \
  | tail -n "+$((KEEP_DAILY + 1))" \
  | xargs -r rm -v

# Prune old weekly backups
echo "[backup] pruning weekly → keep ${KEEP_WEEKLY} newest"
ls -t "${BACKUP_DIR}/weekly/"*.sql.gz 2>/dev/null \
  | tail -n "+$((KEEP_WEEKLY + 1))" \
  | xargs -r rm -v

# Offsite copy via rclone (optional)
if [ -n "${RCLONE_DEST:-}" ]; then
  echo "[backup] syncing to rclone dest: ${RCLONE_DEST}"
  rclone sync "${BACKUP_DIR}" "${RCLONE_DEST}" --quiet
  echo "[backup] offsite sync complete"
fi

echo "[backup] done"
