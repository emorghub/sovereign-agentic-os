"""query-tool READINESS probe (Compose healthcheck).

The service's GET /health is static (it reports `host: trino` even when Trino does not
exist). This probe runs a real read through POST /query -> Trino -> Iceberg catalog
and fails if the response carries an `error` (e.g. `no_catalog_configured`).
Uses SERVICE_BEARER_TOKEN from the container env when set. Exit 0 = ready.
"""
import json
import os
import sys
import urllib.request

port = os.environ.get("PORT", "8000")
headers = {"content-type": "application/json"}
token = os.environ.get("SERVICE_BEARER_TOKEN", "")
if token:
    headers["authorization"] = f"Bearer {token}"
body = json.dumps({"sql": "SELECT count(*) FROM iceberg.information_schema.schemata"}).encode()
req = urllib.request.Request(f"http://127.0.0.1:{port}/query", data=body, headers=headers, method="POST")
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())
except Exception as exc:
    print(f"not ready: {type(exc).__name__}: {exc}")
    sys.exit(1)
if data.get("error") or "rows" not in data:
    print(f"not ready: {data}")
    sys.exit(1)
print("ready")
