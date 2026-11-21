#!/usr/bin/env bash
# Grade every origin branch matching the given patterns with tools/fleet-gate.sh.
#
#   tools/grade-branches.sh [out.jsonl] [pattern ...]      (default patterns: claude/raft-* wip/*)
#
# Branches whose game-relevant trees (dist/, desktop/, tests/, package.json) are identical are
# graded once and the verdict is reused, marked "reused_from". One JSON line per branch.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$here" || exit 2
out="${1:-$here/.qa/grades.jsonl}"; shift || true
[ $# -gt 0 ] || set -- 'claude/raft-*' 'wip/*'
git fetch -q --prune origin || echo "warning: fetch failed, grading cached refs" >&2
mkdir -p "$(dirname "$out")"; : > "$out"
declare -A seen
refs=()
for p in "$@"; do while read -r r; do [ -n "$r" ] && refs+=("$r"); done < <(git for-each-ref --format='%(refname:short)' "refs/remotes/origin/$p"); done
for r in "${refs[@]}"; do
  key="$(for t in dist desktop tests package.json; do git rev-parse -q --verify "$r:$t" || echo none; done | tr '\n' ' ')"
  if [ -n "${seen[$key]:-}" ]; then
    python3 -c 'import json,sys; d=json.loads(sys.argv[1]); d["reused_from"]=d["ref"]; d["ref"]=sys.argv[2]; d["sha"]=sys.argv[3]; print(json.dumps(d))' \
      "${seen[$key]}" "$r" "$(git rev-parse "$r")" >> "$out"
    echo "reused  $r" >&2; continue
  fi
  echo "grading $r" >&2
  v="$("$here/tools/fleet-gate.sh" "$r" | tail -n 1)"
  [ -n "$v" ] || v="{\"ref\":\"$r\",\"pass\":false,\"status\":\"infra\",\"error\":\"gate printed nothing\"}"
  seen[$key]="$v"; echo "$v" >> "$out"
  echo "        -> $(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("status"))' "$v")" >&2
done
