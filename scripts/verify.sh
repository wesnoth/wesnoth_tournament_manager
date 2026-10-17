#!/usr/bin/env bash
# Local verification (audit finding 13). The project does not use a hosted CI,
# so this is the single command that gates a push: it runs from the versioned
# pre-push hook (.githooks/pre-push) and can be run by hand with
# `npm run verify`. It stops at the first failing step.
#
# Steps, cheapest first:
#   1. i18n parity: every locale has the English keys and placeholders.
#   2. i18n keys: every literal key used in frontend/src exists in en.json
#      (parity alone cannot see a key missing from every locale).
#   3. UI API contract: every request of the API-driven E2E tests is one the
#      frontend makes (scripts/check-ui-api-contract.mjs), so those tests
#      cannot keep covering an endpoint the interface stopped calling.
#   4. Legacy columns: no application source references the version 1
#      relationship columns that cleanup plan step 4 drops
#      (scripts/check-legacy-columns.mjs).
#   5. Frontend type-check (`vite build` does not type-check).
#   6. Backend compile, including the unit tests (tsconfig.test.json), into a
#      scratch directory, so the working tree's backend/dist (used by a
#      running server) is never touched. The backend locale files are copied
#      beside the compiled translation service, as the build does, because it
#      loads them from its own directory at import time.
#   7. Backend unit tests (*.test.ts) with Node's built-in runner.
#   8. Tournament-engine self-test, run from that scratch build.
#   9. Group-progression harness (in-memory SQL, no database or Discord).
# The replay-pipeline E2E suite needs the local stack and takes ~20 min, so it
# is not part of this gate: run `npm run verify:e2e` for it. The tournament
# lifecycle suite also needs the local stack: `npm run verify:lifecycle`.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for dir in backend frontend; do
  if [ ! -d "$root/$dir/node_modules" ]; then
    echo "verify: $dir/node_modules is missing; run npm install in $dir first." >&2
    exit 1
  fi
done

# Inside backend/ so compiled imports resolve backend/node_modules, but not
# inside node_modules itself: node --test skips paths under node_modules.
# Ignored by git.
scratch="$root/backend/.verify-dist"
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
step "i18n keys" node "$root/scripts/check-i18n-keys.mjs"
step "UI API contract" node "$root/scripts/check-ui-api-contract.mjs"
step "legacy columns" node "$root/scripts/check-legacy-columns.mjs"
step "frontend type-check" bash -c "cd '$root/frontend' && npx --no-install tsc --noEmit --incremental false"
step "backend compile" bash -c "cd '$root/backend' && rm -rf '$scratch' && npx --no-install tsc -p tsconfig.test.json --outDir '$scratch' && mkdir -p '$scratch/i18n' && cp -r src/i18n/locales '$scratch/i18n/'"
step "backend unit tests" bash -c "cd '$root/backend' && find '$scratch' -name '*.test.js' -print0 | xargs -0 node --test --test-reporter=dot"
step "tournament-engine self-test" node "$scratch/tournament-engine/tournamentEngine.selftest.js"
step "group-progression harness" bash -c "cd '$root/backend' && node scripts/test-group-progression.cjs"

echo "verify: all checks passed."
