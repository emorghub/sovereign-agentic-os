#!/bin/sh
# One-shot (postgres image): create the OpenMetadata role + database in pg-rw.
# Matches the chart's openmetadata.openmetadata.config.database values
# (host pg-rw, database `openmetadata`, user `openmetadata`). Idempotent.
set -eu
export PGPASSWORD="$POSTGRES_PASSWORD"

echo "waiting for Postgres ($PG_HOST) ..."
ok=
for i in $(seq 1 60); do
  if psql -h "$PG_HOST" -U "$POSTGRES_USER" -d postgres -tAc 'select 1' >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || { echo "ERROR: Postgres not reachable"; exit 1; }

psql -h "$PG_HOST" -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -v role="$OM_DB_USER" -v pw="$OM_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'role', :'pw') \gexec
SELECT format('CREATE DATABASE openmetadata OWNER %I', :'role')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'openmetadata') \gexec
SQL
echo "database 'openmetadata' ready (owner $OM_DB_USER)"
