#!/usr/bin/env bash
# Run every Little Raft test tool against one git ref and print a single JSON verdict.
#
#   tools/fleet-gate.sh <ref> [--base <ref>] [--out <dir>] [--checks unit,playbot,visual,perf,electron]
#
# The ref's tree is exported with `git archive` into a temp dir, so the current checkout is never
# touched and any branch (local or origin/...) can be graded. The tools themselves always come
# from THIS checkout (tests/e2e, tools), so every branch is judged by the same rules.
#
# Exit code: 0 = all checks passed, 1 = at least one check found a game failure,
#            2 = no game failure but at least one check could not run (infra).
# Env: PYTHON (default: first of python3.13/python3/python that imports playwright),
#      GATE_PLAYBOT_DURATION (seconds, default 90), GATE_KEEP=1 keeps the exported tree.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ref="" base="origin/main" out="" checks="unit,playbot,visual,perf,electron"
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --checks) checks="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) if [ -z "$ref" ]; then ref="$1"; shift; else echo "unknown arg: $1" >&2; exit 2; fi ;;
  esac
done
[ -n "$ref" ] || { echo "usage: $0 <ref> [--base <ref>] [--out <dir>] [--checks a,b]" >&2; exit 2; }

cd "$here" || exit 2
sha="$(git rev-parse --verify -q "$ref^{commit}")" || { printf '{"ref":"%s","pass":false,"status":"infra","error":"unknown ref"}\n' "$ref"; exit 2; }

if [ -z "${PYTHON:-}" ]; then
  for c in python3.13 python3 python; do
    if command -v "$c" >/dev/null && "$c" -c 'import playwright' 2>/dev/null; then PYTHON="$c"; break; fi
  done
fi
PYTHON="${PYTHON:-python3}"

work="$(mktemp -d "${TMPDIR:-/tmp}/fleet-gate.XXXXXX")"
[ "${GATE_KEEP:-0}" = 1 ] || trap 'rm -rf "$work"' EXIT
out="${out:-$here/.qa/gate/${sha:0:12}}"; mkdir -p "$out"; out="$(cd "$out" && pwd)"
export_tree() { mkdir -p "$2" && git archive "$1" | tar -x -C "$2"; }
export_tree "$sha" "$work/head" || { printf '{"ref":"%s","sha":"%s","pass":false,"status":"infra","error":"git archive failed"}\n' "$ref" "$sha"; exit 2; }
[ -e "$here/node_modules" ] && ln -s "$here/node_modules" "$work/head/node_modules"
base_sha="$(git rev-parse --verify -q "$base^{commit}" || true)"
[ -n "$base_sha" ] && export_tree "$base_sha" "$work/base"

results="$work/results.jsonl"; : > "$results"
# run_check <name> <cmd...>: runs a tool, keeps its last JSON line, records exit code and wall time.
run_check() {
  local name="$1"; shift
  local log="$out/$name.log" t0 t1 rc json
  t0=$(date +%s)
  "$@" > "$log" 2>&1; rc=$?
  t1=$(date +%s)
  json="$(grep -E '^\s*\{' "$log" | tail -n 1)"
  "$PYTHON" - "$name" "$rc" "$((t1 - t0))" "$log" "$json" >> "$results" <<'PY'
import json, sys
name, rc, secs, log, raw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
try:
    data = json.loads(raw) if raw.strip() else None
except ValueError:
    data = None
if not isinstance(data, dict):
    tail = open(log, errors='replace').read()[-1500:]
    data = {'pass': False, 'failures': [], 'error': 'no JSON verdict on stdout', 'log_tail': tail}
    rc = 2 if rc in (0, 1) else rc
status = 'pass' if rc == 0 else 'fail' if rc == 1 else 'infra'
print(json.dumps({'check': name, 'status': status, 'exit': rc, 'seconds': secs, 'log': log,
                  'failures': data.get('failures', []), 'metrics': data.get('metrics', {}),
                  'error': data.get('error'), 'log_tail': data.get('log_tail')}))
PY
}

has() { case ",$checks," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
head_dist="$work/head/dist"
if has unit; then
  # The ref's own unit tests (npm test), with the ref's own test files.
  run_check unit bash -c "cd '$work/head' && npm test --silent 2>&1; rc=\$?; printf '{\"tool\":\"unit\",\"pass\":%s,\"failures\":%s}\n' \$([ \$rc = 0 ] && echo true || echo false) \$([ \$rc = 0 ] && echo [] || echo '[{\"id\":\"npm-test\",\"detail\":\"npm test failed, see log\",\"repro\":\"git checkout $sha && npm test\"}]'); [ \$rc = 0 ] || exit 1"
fi
if has playbot; then
  run_check playbot "$PYTHON" "$here/tests/e2e/playbot.py" --dist "$head_dist" --out "$out/playbot" --duration "${GATE_PLAYBOT_DURATION:-90}"
fi
if has visual; then
  vargs=(--dist "$head_dist")
  [ -d "$work/base/dist" ] && vargs=(--base "$work/base/dist" --head "$head_dist")
  run_check visual "$PYTHON" "$here/tools/visual-diff.py" "${vargs[@]}" --out "$out/visual"
fi
if has perf; then
  pargs=()
  if [ -d "$work/base/dist" ] && "$PYTHON" "$here/tests/e2e/perf_gate.py" "$work/base/dist" --json "$out/perf-base.json" > "$out/perf-base.log" 2>&1; then pargs=(--baseline "$out/perf-base.json"); fi
  run_check perf "$PYTHON" "$here/tests/e2e/perf_gate.py" "$head_dist" --json "$out/perf.json" "${pargs[@]}"
fi
if has electron; then
  run_check electron "$PYTHON" "$here/tests/e2e/electron_check.py" --dist "$head_dist" --out "$out/electron"
fi

"$PYTHON" - "$ref" "$sha" "$base" "$out" "$results" <<'PY'
import json, sys
ref, sha, base, out, results = sys.argv[1:6]
checks = [json.loads(l) for l in open(results) if l.strip()]
statuses = {c['status'] for c in checks}
status = 'fail' if 'fail' in statuses else 'infra' if 'infra' in statuses else 'pass'
print(json.dumps({'ref': ref, 'sha': sha, 'base': base, 'pass': status == 'pass', 'status': status,
                  'artifacts': out, 'checks': {c.pop('check'): c for c in checks}}))
sys.exit({'pass': 0, 'fail': 1, 'infra': 2}[status])
PY
