#!/usr/bin/env bash
# Forces an out-of-schedule dump from the running container.
set -euo pipefail
STAMP=$(date +%Y-%m-%d-%H%M)
docker exec valeriapp sh -c \
  "pg_dump --no-owner --no-privileges \"\$DATABASE_URL\" | gzip -9 > /data/backups/valeriapp-manual-$STAMP.sql.gz"
echo "backups/valeriapp-manual-$STAMP.sql.gz"
