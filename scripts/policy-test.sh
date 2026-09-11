#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Borek Data Ventures UG
# =============================================================================
# policy-test.sh — run the OPA policy unit tests.
# =============================================================================
# Wraps `opa test` so CI and humans run the same command.
#
# Why this needs a wrapper rather than a bare `opa test policies/ tests/policies/`:
# the chart ships FOUR policy documents but only THREE of them are files.
#
#   charts/sovereign-agentic-os/policies/trino.rego        <- file
#   charts/sovereign-agentic-os/policies/marketplace.rego  <- file
#   charts/sovereign-agentic-os/policies/connections.rego  <- file
#   package agentic.authz                                  <- INLINE in the ConfigMap
#
# `authz.rego` lives as literal text inside templates/**/opa/opa.yaml (the other two
# are pulled in with `.Files.Get`). So `tests/policies/authz_test.rego` tests a
# package that no .rego file on disk defines, and a bare `opa test` reports it as
# undefined. This script extracts that inline block to a temp dir first, so the
# whole suite runs.
#
# Usage:  bash scripts/policy-test.sh
# Requires: opa on PATH (https://www.openpolicyagent.org/docs/latest/#running-opa)
set -euo pipefail

cd "$(dirname "$0")/.."

POLICIES="charts/sovereign-agentic-os/policies"
TESTS="tests/policies"

if ! command -v opa >/dev/null 2>&1; then
  echo "policy-test: 'opa' not found on PATH." >&2
  echo "  install: https://www.openpolicyagent.org/docs/latest/#running-opa" >&2
  exit 127
fi

# Locate the OPA ConfigMap template by NAME, not by a hard-coded path — the chart
# templates/ tree is being reorganised into base/ + extensions/ (issue #18), and
# this must keep working on both layouts.
OPA_TMPL="$(find charts/sovereign-agentic-os/templates -name 'opa.yaml' -type f | head -1)"
if [ -z "$OPA_TMPL" ]; then
  echo "policy-test: could not find opa.yaml under charts/sovereign-agentic-os/templates" >&2
  exit 1
fi

TMPDIR_POLICY="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_POLICY"' EXIT

# Extract the `authz.rego: |` block: everything indented under it, stopping at the
# next key at the same level. De-indents by the 4 spaces the YAML block scalar adds.
awk '
  /^  authz\.rego: \|/ { inblock = 1; next }
  inblock && /^  [^ ]/  { inblock = 0 }
  inblock               { sub(/^    /, ""); print }
' "$OPA_TMPL" > "$TMPDIR_POLICY/authz.rego"

if ! grep -q '^package agentic.authz' "$TMPDIR_POLICY/authz.rego"; then
  echo "policy-test: failed to extract package agentic.authz from $OPA_TMPL" >&2
  echo "  (the inline 'authz.rego: |' block may have moved or been made a file)" >&2
  exit 1
fi

echo "policy-test: authz.rego extracted from $OPA_TMPL"
opa test "$TMPDIR_POLICY" "$POLICIES" "$TESTS" --v1-compatible "$@"
