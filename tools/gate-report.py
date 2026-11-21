"""Turn tools/grade-branches.sh output (JSON lines) into docs/cloud/GATE-REPORT.md-style markdown.

Usage: python3 tools/gate-report.py <grades.jsonl> [--baseline origin/main] > report.md

A failure id that the baseline ref also has is "inherited" (a bug already on main); anything
else is "new" on that branch. Hand-written triage notes can be appended after the generated part.
"""
import argparse, json, sys
from collections import OrderedDict

ap = argparse.ArgumentParser()
ap.add_argument('grades')
ap.add_argument('--baseline', default='origin/main')
a = ap.parse_args()

rows = [json.loads(l) for l in open(a.grades) if l.strip()]
base = next((r for r in rows if r.get('ref') == a.baseline), None)


def fail_ids(r):
    out = set()
    for name, c in (r.get('checks') or {}).items():
        for f in c.get('failures') or []:
            out.add(f'{name}:{f.get("id")}')
    return out


base_ids = fail_ids(base) if base else set()
p = lambda *s: print(*s)
p('| Branch | Verdict | unit | playbot | visual | perf | electron | New failures vs main | Diff vs main (scenes) |')
p('|---|---|---|---|---|---|---|---|---|')
for r in rows:
    ch = r.get('checks') or {}
    cell = lambda n: ch.get(n, {}).get('status', '-')
    new = sorted(fail_ids(r) - base_ids)
    diff = (ch.get('visual', {}).get('metrics') or {}).get('differentScenes') or []
    reused = f' (same tree as {r["reused_from"]})' if r.get('reused_from') else ''
    verdict = r.get('status', '?')
    if verdict == 'fail' and not new and base:
        verdict = 'fail (main bugs only)'
    p(f'| `{r["ref"].removeprefix("origin/")}`{reused} | {verdict} | {cell("unit")} | {cell("playbot")} | {cell("visual")} | '
      f'{cell("perf")} | {cell("electron")} | {", ".join(new) or "none"} | {len(diff)} |')

p('\n### Failure details by branch\n')
seen = OrderedDict()
for r in rows:
    if r.get('reused_from'):
        continue
    for name, c in (r.get('checks') or {}).items():
        for f in c.get('failures') or []:
            key = f'{name}:{f.get("id")}'
            seen.setdefault(key, {'refs': [], 'detail': f.get('detail'), 'repro': f.get('repro')})['refs'].append(r['ref'])
        if c.get('status') == 'infra':
            key = f'{name}:INFRA'
            seen.setdefault(key, {'refs': [], 'detail': c.get('error') or (c.get('log_tail') or '')[-400:], 'repro': r.get('replay')})['refs'].append(r['ref'])
for key, v in seen.items():
    p(f'- **{key}** on {", ".join("`" + x.removeprefix("origin/") + "`" for x in v["refs"])}')
    p(f'  - detail: {str(v["detail"])[:600]}')
    if v['repro']:
        p(f'  - repro: `{str(v["repro"])[:600]}`')
