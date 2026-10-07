#!/usr/bin/env bash
# Local verification (audit finding 13). The project does not use a hosted CI,
# so this is the single command that gates a push: it runs from the versioned
# pre-push hook (.githooks/pre-push) and can be run by hand with
# `npm run verify`. It stops at the first failing step.
#
# Steps, cheapest first:
#   1. i18n parity: every locale has the English keys and placeholders.
#   2. Frontend type-check (`vite build` does not type-check).
#   3. Backend compile into a scratch directory, so the working tree's
#      backend/dist (used by a running server) is never touched.
#   4. Tournament-engine self-test, run from that scratch build.
#   5. Group-progression harness (in-memory SQL, no database or Discord).
# The replay-pipeline E2E suite needs the local stack and takes ~20 min, so it
# is not part of this gate: run `npm run verify:e2e` for it.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for dir in backend frontend; do
  if [ ! -d "$root/$dir/node_modules" ]; then
    echo "verify: $dir/node_modules is missing; run npm install in $dir first." >&2
    exit 1
  fi
done

# Inside node_modules so compiled imports resolve the backend's packages;
# node_modules is ignored by git.
scratch="$root/backend/node_modules/.cache/verify-dist"
cleanup() { rm -rf "$scratch"; }
trap cleanup EXIT

step() {
  local label="$1"; shift
  local started=$SECONDS
  echo "▶ $label"
  "$@"
  echo "  ✓ $label ($((SECONDS - started)) s)"
}

step "i18n parity" node "$root/scripts/check-i18n-parity.mjs"
step "frontend type-check" bash -c "cd '$root/frontend' && npx --no-install tsc --noEmit --incremental false"
step "backend compile" bash -c "cd '$root/backend' && rm -rf '$scratch' && npx --no-install tsc --outDir '$scratch'"
step "tournament-engine self-test" node "$scratch/tournament-engine/tournamentEngine.selftest.js"
step "group-progression harness" bash -c "cd '$root/backend' && node scripts/test-group-progression.cjs"

echo "verify: all checks passed."
