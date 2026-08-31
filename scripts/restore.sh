#!/usr/bin/env bash
# Restores a Valeriapp dump into a *fresh* database.
#
#   ./scripts/restore.sh backups/valeriapp-2026-08-30.sql.gz
#
# Deliberately refuses to touch a database that already has tables: recovering
# a backup is exactly the moment you do not want a half-merged schema.
set -euo pipefail

DUMP="${1:-}"
: "${DATABASE_URL:?Define DATABASE_URL}"

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Uso: $0 <fichero.sql.gz>" >&2
  exit 1
fi

existing=$(psql "$DATABASE_URL" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")

if [[ "$existing" != "0" ]]; then
  echo "La base de datos ya tiene $existing tablas." >&2
  echo "Crea una base vacía y apunta DATABASE_URL a ella." >&2
  exit 1
fi

echo "Restaurando $DUMP…"
gunzip -c "$DUMP" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1
echo "Hecho. Eventos restaurados: $(psql "$DATABASE_URL" -tAc 'SELECT count(*) FROM events')"
