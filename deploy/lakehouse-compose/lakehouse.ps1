# Thin wrapper: run `docker compose` for the lakehouse deployment from the repo root.
# Usage (any directory):  .\deploy\lakehouse-compose\lakehouse.ps1 up -d --build
#                         .\deploy\lakehouse-compose\lakehouse.ps1 ps
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here '..\..')
$envFile = Join-Path $here '.env'
if (-not (Test-Path $envFile)) {
  Write-Error "Missing $envFile - copy .env.example to .env first (see README.md)."
  exit 1
}
Push-Location $root
try {
  docker compose -f compose.yaml -f deploy/lakehouse-compose/compose.lakehouse.yaml --env-file deploy/lakehouse-compose/.env @args
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
