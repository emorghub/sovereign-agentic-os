#!/bin/sh
# Thin wrapper: run `docker compose` for the lakehouse deployment from the repo root.
# Usage (any directory):  ./deploy/lakehouse-compose/lakehouse.sh up -d --build
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
if [ ! -f "$here/.env" ]; then
  echo "Missing $here/.env - copy .env.example to .env first (see README.md)." >&2
  exit 1
fi
cd "$root"
exec docker compose -f compose.yaml -f deploy/lakehouse-compose/compose.lakehouse.yaml \
  --env-file deploy/lakehouse-compose/.env "$@"
