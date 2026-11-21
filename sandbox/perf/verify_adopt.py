"""Verify sandbox/perf/adopt.patch against the CURRENT dist/, end to end, on a temp copy (dist/ is never touched).

Usage: python sandbox/perf/verify_adopt.py [--frames 8] [--skip shoot,node,gate,audit,play] [--out DIR]

1. anchors: every text make_adopt.py replaces occurs exactly once in stock dist/, and `git apply --check` passes.
2. shoot:   shoot.py profiles stock and patched at spawn on the 9-tile raft and on the 49-tile raft (frozen seeded scene),
            imgdiff.py compares the screenshots (expect 0.0: the patch changes no pixel). READ the PNGs it lists.
3. node:    `node --test tests/*.test.mjs` on a temp repo root holding stock vs patched dist/.
4. gate:    tests/e2e/perf_gate.py (the budgeted perf gate) on stock and patched.
5. audit:   tests/audit/live3_concurrent_checks_double_swap.py and perf1_hotswap_leaks_old_engine.py on stock and
            patched (live3 fails on stock: that is the live.js double-mount race the patch fixes).
6. play:    playtest.py --big on stock and patched: hammer floors, decor, hook, hot swaps through live.js's poll;
            build handler time, deck checksum incremental == full rebuild, memory flat across swaps.
Prints one JSON summary; writes it to <out>/verify.json."""
import argparse, json, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import make_adopt

ap = argparse.ArgumentParser()
ap.add_argument('--frames', default='8'); ap.add_argument('--skip', default=''); ap.add_argument('--out', default=str(HERE / 'shots'))
a = ap.parse_args(); skip = set(a.skip.split(',')); out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
PY = sys.executable
tmp = Path(tempfile.mkdtemp(prefix='raft-verify-'))
report = {}

# 1. anchors + apply
stock_dist = ROOT / 'dist'
anchors = []
for s, edits in make_adopt.STEPS.items():
    for f, old, new in edits:
        n = (stock_dist / f).read_text().count(old)
        anchors.append({'step': s, 'file': f, 'occurrences': n, 'anchor': old.strip().splitlines()[0][:70]})
bad = [x for x in anchors if x['occurrences'] != 1]
report['anchors'] = {'checked': len(anchors), 'bad': bad}
if bad: print(json.dumps(report, indent=1)); sys.exit('anchors do not match the current dist/')
for tag in ('stock', 'patched'):
    (tmp / tag).mkdir(); shutil.copytree(stock_dist, tmp / tag / 'dist'); shutil.copytree(ROOT / 'tests', tmp / tag / 'tests')
r = subprocess.run(['git', 'apply', '-p1', str(HERE / 'adopt.patch')], cwd=tmp / 'patched', capture_output=True, text=True)
if r.returncode:  # git apply refuses paths when cwd is inside another repo's ignored dir; fall back to patch(1)
    r = subprocess.run(['patch', '-p1', '-F0', '-s', '-i', str(HERE / 'adopt.patch')], cwd=tmp / 'patched', capture_output=True, text=True)
if r.returncode or not (tmp / 'patched/dist/deck-cache.js').exists(): sys.exit('adopt.patch does not apply: ' + r.stderr)
report['applies'] = True
def run(cmd, cwd=ROOT, timeout=3600, env=None):
    import os
    e = dict(os.environ, **(env or {}))
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=e)
    return p.returncode, p.stdout, p.stderr

# 2. shoot + pixel diff
if 'shoot' not in skip:
    report['shoot'] = {}
    for big in (False, True):
        for tag in ('stock', 'patched'):
            j = tmp / f'{tag}{"-big" if big else ""}.json'
            run([PY, str(HERE / 'shoot.py'), '--dist', str(tmp / tag / 'dist'), '--multi', '--only', 'baseline', '--no-cdp', '--frames', a.frames,
                 '--tag', tag, '--json', str(j), '--out', str(out)] + (['--big'] if big else []))
            s = json.loads(j.read_text())['scenarios']['baseline']
            report['shoot'][f'{tag}{" big" if big else ""}'] = {k: s[k] for k in ('draws', 'shadowDraws', 'triangles', 'submitMs', 'cpuMsPerFrame', 'geometries', 'programs', 'errors', 'shot')}
        sh = [str(out / f'game-{t}-{"big-" if big else ""}baseline.png') for t in ('stock', 'patched')]
        c, o, e = run([PY, str(HERE / 'imgdiff.py')] + sh)
        report['shoot'][f'pixelDiff{" big" if big else ""}'] = json.loads(o) if c == 0 and o.strip().startswith(('{', '[')) else (o + e)[-400:]

# 3. node tests
if 'node' not in skip:
    report['node'] = {}
    for tag in ('stock', 'patched'):
        c, o, e = run(['bash', '-c', 'node --test tests/*.test.mjs 2>&1 | grep -E "^# (tests|pass|fail)|^not ok"'], cwd=tmp / tag, timeout=3000)
        report['node'][tag] = o.strip().splitlines()

# 4. perf gate
if 'gate' not in skip:
    report['gate'] = {}
    for tag in ('stock', 'patched'):
        c, o, e = run(['python3.13', 'tests/e2e/perf_gate.py', '--dist', 'dist', '--out', str(tmp / f'gate-{tag}')], cwd=tmp / tag, timeout=3000)
        try:
            g = json.loads(o.strip().splitlines()[-1]); m = g.get('metrics', {})
            report['gate'][tag] = {'exit': c, 'pass': g.get('pass'), 'failures': g.get('failures'), 'drawCalls': m.get('drawCalls'), 'triangles': (m.get('triangles') or {}).get('p95'),
                                   'growth': m.get('growth'), 'hitches': (m.get('longTasks') or {}).get('hitches')}
        except Exception: report['gate'][tag] = {'exit': c, 'tail': (o + e)[-600:]}

# 5. audit tests touching live.js and hot swaps
if 'audit' not in skip:
    report['audit'] = {}
    for t in ('live3_concurrent_checks_double_swap.py', 'perf1_hotswap_leaks_old_engine.py'):
        for tag in ('stock', 'patched'):
            c, o, e = run([PY, f'tests/audit/{t}'], cwd=tmp / tag, env={'RAFT_DIST': str(tmp / tag / 'dist')}, timeout=1200)
            report['audit'][f'{t} {tag}'] = {'exit': c, 'tail': o.strip().splitlines()[-2:]}

# 6. playtest
if 'play' not in skip:
    report['play'] = {}
    for tag in ('stock', 'patched'):
        c, o, e = run([PY, str(HERE / 'playtest.py'), '--dist', str(tmp / tag / 'dist'), '--big', '--tag', tag, '--swaps', '2', '--floors', '4', '--out', str(out)], timeout=5400)
        try:
            p = json.loads(o)
            report['play'][tag] = {k: p[k] for k in ('floorsBuilt', 'buildHandlerMs', 'incrementalDeckEqualsFullRebuild', 'memoryAfterSwaps', 'memoryFlatAcrossSwaps', 'undisposedAfterSwap', 'errors')}
            report['play'][tag]['decorAfterBuild'] = next((s['decor'] for s in p['log'] if s['step'] == '3-decor'), None)
            report['play'][tag]['scenesRenderingAfterSwaps'] = [s['scenesRendering'] for s in p['log'] if s['step'].startswith('4-swap')]
        except Exception: report['play'][tag] = {'exit': c, 'tail': (o + e)[-800:]}

(out / 'verify.json').write_text(json.dumps(report, indent=1))
print(json.dumps(report, indent=1))
shutil.rmtree(tmp, ignore_errors=True)
