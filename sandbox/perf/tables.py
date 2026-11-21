"""Print markdown tables from shoot.py JSON files (one table per file).
Usage: python sandbox/perf/tables.py results.json [more.json ...] [--owners]
Columns: draws incl. shadow pass (probe count of renderBufferDirect), shadow-pass draws, triangles, median submit ms
(main-thread time inside renderer.render), renderer-process and GPU-process (SwiftShader raster) CPU ms per frame,
change of GPU-process CPU against the file's 'baseline' row. --owners adds the per-owner draw table of the baseline."""
import json, sys

files = [a for a in sys.argv[1:] if not a.startswith('--')]
for f in files:
    d = json.load(open(f)); sc = d['scenarios']; base = sc.get('baseline')
    tag = f"pose {d.get('pose', 'spawn')}{', 49-tile raft' if d.get('big') else ', 9-tile raft'}"
    print(f'\n**{f.split("/")[-1]}** ({tag})\n')
    print('| scenario | draws (shadow) | triangles | submit ms | renderer CPU ms/frame | GPU-process CPU ms/frame | Δ GPU |')
    print('|---|---|---|---|---|---|---|')
    for name, r in sc.items():
        g = r['cpuMsPerFrame'].get('gpu-process', 0); g0 = base['cpuMsPerFrame'].get('gpu-process', 1) if base else g
        print(f"| {name} | {r['draws']} ({r['shadowDraws']}) | {r['triangles'] // 1000}k | {r['submitMs']} | {r['cpuMsPerFrame'].get('renderer', 0)} | {g:.0f} | {100 * (g - g0) / g0:+.0f}% |")
    if '--owners' in sys.argv and base:
        print('\n| owner | main | shadow | extra |\n|---|---|---|---|')
        for k, v in base['byOwner'].items(): print(f"| {k} | {v['main']} | {v['shadow']} | {v['extra']} |")
