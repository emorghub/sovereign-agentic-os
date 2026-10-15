#!/bin/sh
# One-shot (postgres image): make the `polaris` JDBC metastore exist, then decide
# whether the Polaris realm still needs its one-time bootstrap.
#
# Mirrors the chart's polaris.yaml `bootstrap-check` initContainer: the admin tool's
# `bootstrap` is NOT idempotent, so we look for the realm's root-principal row and
# leave a sentinel (/bootstrap-state/needed | /bootstrap-state/done) that the
# polaris-bootstrap service reads. Role + database creation is idempotent, so this is
# safe on every `up`.
set -eu
export PGPASSWORD="$POSTGRES_PASSWORD"

echo "waiting for Postgres ($PG_HOST) ..."
ok=
for i in $(seq 1 60); do
  if psql -h "$PG_HOST" -U "$POSTGRES_USER" -d postgres -tAc 'select 1' >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || { echo "ERROR: Postgres not reachable"; exit 1; }

# Role + database (idempotent). Values come from env; nothing is hard-coded here.
psql -h "$PG_HOST" -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -v role="$POLARIS_DB_USER" -v pw="$POLARIS_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'role', :'pw') \gexec
SELECT format('CREATE DATABASE polaris OWNER %I', :'role')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'polaris') \gexec
SQL
echo "database 'polaris' ready (owner $POLARIS_DB_USER)"

export PGPASSWORD="$POLARIS_DB_PASSWORD"
# Two queries, not one CASE: Postgres resolves every table a statement references at
# parse time, so a single CASE over a not-yet-created table errors on a fresh DB.
cnt=0
exists=$(psql -h "$PG_HOST" -U "$POLARIS_DB_USER" -d polaris -tAc \
  "select to_regclass('polaris_schema.principal_authentication_data') is not null")
if [ "$(printf '%s' "$exists" | tr -d '[:space:]')" = "t" ]; then
  cnt=$(psql -h "$PG_HOST" -U "$POLARIS_DB_USER" -d polaris -v ON_ERROR_STOP=1 -tAc \
    "select count(*) from polaris_schema.principal_authentication_data where realm_id = '$POLARIS_REALM'")
  cnt=$(printf '%s' "$cnt" | tr -d '[:space:]')
fi
rm -f /bootstrap-state/needed /bootstrap-state/done
if [ "${cnt:-0}" -gt 0 ]; then
  echo "realm '$POLARIS_REALM' already bootstrapped ($cnt root-principal row(s))"
  : > /bootstrap-state/done
else
  echo "realm '$POLARIS_REALM' not bootstrapped -- polaris-bootstrap will run"
  : > /bootstrap-state/needed
fi
