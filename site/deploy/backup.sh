#!/usr/bin/env bash
# Nightly backup for the Muninn site's analytics database.
#
# Cron (03:45 — SAB runs at 03:00 and my-future at 03:30; don't stack them):
#   45 3 * * * /opt/muninn-site/current/site/deploy/backup.sh >> /opt/muninn-site/shared/logs/backup.log 2>&1
set -euo pipefail

# The database holds referrer hosts and per-day visitor hashes. Not sensitive
# the way my-future's dumps are, but this is a shared box with other people's
# uids on it, and 0644 in a 0755 directory is world-readable.
umask 077

APP_DIR=${APP_DIR:-/opt/muninn-site/current/site}
BACKUP_DIR=${BACKUP_DIR:-/opt/muninn-site/backups}
ENV_FILE=${ENV_FILE:-/opt/muninn-site/shared/env/compose.env}
DATA_DIR=${DATA_DIR:-/opt/muninn-site/shared/data}
KEEP_DAYS=${KEEP_DAYS:-30}

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR/deploy"

stamp=$(date +%F)

# Written into the container's /data (the host bind mount), then moved out —
# the container has no other path both sides can see.
docker compose --env-file "$ENV_FILE" -f compose.prod.yml \
  exec -T app node deploy/scripts/backup.mjs "/data/backup-$stamp.db"

gzip -c "$DATA_DIR/backup-$stamp.db" > "$BACKUP_DIR/muninn-site-$stamp.db.gz"
rm -f "$DATA_DIR/backup-$stamp.db"

find "$BACKUP_DIR" -name 'muninn-site-*.db.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok → muninn-site-$stamp.db.gz"
