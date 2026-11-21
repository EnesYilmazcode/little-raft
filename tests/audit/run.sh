#!/usr/bin/env bash
# Run every audit regression test. Each one FAILS on the audited main (bc5df84) and should pass once fixed.
# Usage: tests/audit/run.sh            (env RAFT_DIST=<dist dir> to test another build, CHROMIUM=<binary>)
cd "$(dirname "$0")/../.." || exit 2
fail=0
node --test tests/audit/*.test.mjs || fail=1
for t in tests/audit/[a-z]*.py; do
  echo "== $t"; timeout 600 python "$t" || { echo "-- FAILED: $t"; fail=1; }
done
exit $fail
