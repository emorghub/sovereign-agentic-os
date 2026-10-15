"""data-runner READINESS probe (Compose healthcheck).

The service's own GET /health returns a static {"status":"ok"} — it never touches a
backend. This probe proves the two things an ingest actually needs, using the
service's OWN client code (imported from /app/app.py, no re-implementation):
  1. the Polaris REST catalog answers an authenticated call (OAuth2 + warehouse), and
  2. the uploads bucket exists and is reachable with the configured S3 creds.
Exit 0 = ready, non-zero = not ready.
"""
import sys
import urllib.request

sys.path.insert(0, "/app")
import app  # noqa: E402  (the data-runner module; main() only runs under __main__)

try:
    urllib.request.urlopen(f"http://127.0.0.1:{app.PORT}/health", timeout=3).read()
    app._catalog().list_namespaces()
    app._s3_client().head_bucket(Bucket=app.UPLOADS_BUCKET)
except Exception as exc:  # any failure = not ready
    print(f"not ready: {type(exc).__name__}: {exc}")
    sys.exit(1)
print("ready")
