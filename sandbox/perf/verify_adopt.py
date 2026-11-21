"""Apply sandbox/perf/adopt.patch to a temp copy of dist/ and profile stock vs patched with shoot.py.
Usage: python sandbox/perf/verify_adopt.py [--frames 12] [--dsf 1]
Writes sandbox/perf/results-patched.json (read by index.html) and shots/game-stock-*.png, shots/game-patched-*.png."""
import json, shutil, subprocess, sys, tempfile, argparse
from pathlib import Path

HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]
ap = argparse.ArgumentParser(); ap.add_argument('--frames', default='12'); ap.add_argument('--dsf', default='1'); ap.add_argument('--big', action='store_true')
a = ap.parse_args()
tmp = Path(tempfile.mkdtemp(prefix='raft-adopt-'))
shutil.copytree(ROOT / 'dist', tmp / 'dist')
r = subprocess.run(['git', 'apply', '-p1', str(HERE / 'adopt.patch')], cwd=tmp)
if r.returncode: sys.exit('adopt.patch does not apply to the current dist/')
out = {'frames': int(a.frames), 'scenarios': {}}
for tag, dist in (('stock', ROOT / 'dist'), ('patched', tmp / 'dist')):
    j = tmp / f'{tag}.json'
    subprocess.run([sys.executable, str(HERE / 'shoot.py'), '--dist', str(dist), '--only', 'baseline', '--no-cdp', '--frames', a.frames, '--dsf', a.dsf, '--tag', tag, '--json', str(j)] + (['--big'] if a.big else []), check=True, stdout=subprocess.DEVNULL)
    out['scenarios'][f'{tag} dist'] = json.loads(j.read_text())['scenarios']['baseline']
(HERE / ('results-patched-big.json' if a.big else 'results-patched.json')).write_text(json.dumps(out, indent=1))
print(json.dumps({k: {x: v[x] for x in ('calls', 'triangles', 'submitMs', 'cpuMsPerFrame', 'errors')} for k, v in out['scenarios'].items()}, indent=1))
shutil.rmtree(tmp, ignore_errors=True)
