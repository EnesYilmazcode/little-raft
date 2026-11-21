"""Print the markdown tables used in docs/tech/perf.md from results*.json (+ pixel diffs of the screenshots).
Usage: python sandbox/perf/tables.py [merge A.json B.json ...]   (merge: combine sweep files into results.json first)"""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from imgdiff import read_png, diff

HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]
if len(sys.argv) > 2 and sys.argv[1] == 'merge':
    out = None
    for p in sys.argv[2:]:
        r = json.loads(Path(p).read_text())
        if out is None: out = r
        else: out['scenarios'].update(r['scenarios'])
    order = ['baseline', 'baseline-2', 'items-no-shadow', 'shadow-fit', 'shadow-10hz', 'merge-scenery', 'merge-raft', 'wood-bump-aniso1',
             'wood-aniso-1', 'wood-no-bump', 'dpr-0.75', 'shadows-off', 'hide-raft', 'all-safe']
    out['scenarios'] = {k: out['scenarios'][k] for k in sorted(out['scenarios'], key=lambda k: order.index(k) if k in order else 99)}
    (HERE / 'results.json').write_text(json.dumps(out, indent=1))

cpu = lambda r, k: r['cpuMsPerFrame'].get(k, 0)
pct = lambda v, b: f"{100 * (v - b) / b:+.0f}%"
R = json.loads((HERE / 'results.json').read_text())['scenarios']
base = R['baseline']; A = read_png(ROOT / base['shot'])
print('### census (baseline)\n\n| owner | objects | meshes | shadow casters | vertices (drawn) | materials |\n|---|---|---|---|---|---|')
for k, e in base['census']['byOwner'].items(): print(f"| {k} | {e['objects']} | {e['meshes']} | {e['casters']} | {e['verts']:,} | {e['materials']} |")
c = base['census']; print(f"| **total** | | {c['meshes']} | {c['casters']} | {c['verts']:,} | {c['materials']} |")
if 'mainPassOnly' in base: print(f"\nmain pass only: {base['mainPassOnly']['calls']} calls; with shadow pass: {base['calls']}")
print('\n### fixes\n\n| scenario | draw calls | Δ calls | triangles | submit ms (median) | renderer CPU ms/frame | GPU-process (SwiftShader) CPU ms/frame | Δ raster | pixel diff deck / changed px |\n|---|---|---|---|---|---|---|---|---|')
for n, r in R.items():
    d = diff(A, read_png(ROOT / r['shot']))
    print(f"| {n} | {r['calls']} | {r['calls'] - base['calls']:+d} | {r['triangles'] / 1000:.0f}k | {r['submitMs']} | {cpu(r, 'renderer'):.1f} | {cpu(r, 'gpu-process'):.0f} | {pct(cpu(r, 'gpu-process'), cpu(base, 'gpu-process'))} | {d['deck']} / {d['changedPct']}% |")
for f in ('results-patched.json', 'results-patched-big.json'):
    p = HERE / f
    if not p.exists(): continue
    S = list(json.loads(p.read_text())['scenarios'].items()); (sn, s), (pn, q) = S[0], S[1]
    d = diff(read_png(ROOT / s['shot']), read_png(ROOT / q['shot']))
    print(f"\n### {f}\n\n| build | draw calls | triangles | submit ms | renderer CPU ms/frame | GPU-process CPU ms/frame |\n|---|---|---|---|---|---|")
    for n, r in S: print(f"| {n} | {r['calls']} | {r['triangles'] / 1000:.0f}k | {r['submitMs']} | {cpu(r, 'renderer'):.1f} | {cpu(r, 'gpu-process'):.0f} |")
    print(f"| **change** | {pct(q['calls'], s['calls'])} | {pct(q['triangles'], s['triangles'])} | {pct(q['submitMs'], s['submitMs'])} | {pct(cpu(q, 'renderer'), cpu(s, 'renderer'))} | {pct(cpu(q, 'gpu-process'), cpu(s, 'gpu-process'))} |")
    print(f"\npixel diff stock vs patched: deck {d['deck']}, full {d['full']}, changed pixels {d['changedPct']}%")
cdp = base.get('cdp')
if cdp:
    print(f"\n### CDP ({cdp['windowMs']} ms window), allocation {cdp['allocKBperSec']} KB/s\n")
    for f in cdp['selfTop'][:15]: print(f"- {f['fn']}: {f['ms']} ms ({f['pct']}%)")
