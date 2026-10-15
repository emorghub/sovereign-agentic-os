#!/bin/sh
# One-shot (apache/polaris-admin-tool image): bootstrap the realm's JDBC schema +
# root principal ONLY when db-init.sh said it is missing. Same gate + command as the
# chart's polaris.yaml `bootstrap` initContainer.
set -eu
if [ -f /bootstrap-state/done ]; then
  echo "realm '$POLARIS_REALM' already bootstrapped -- skipping admin-tool"
  exit 0
fi
if [ ! -f /bootstrap-state/needed ]; then
  echo "ERROR: no bootstrap sentinel -- polaris-db-init did not complete"
  exit 1
fi
echo "bootstrapping realm '$POLARIS_REALM' ..."
exec /opt/jboss/container/java/run/run-java.sh bootstrap -r "$POLARIS_REALM" -c "$POLARIS_BOOTSTRAP_CREDENTIALS"
