"""Build a scratch copy of dist/ with other engine-tech topics' ADOPT steps and this patch applied, in a given order.
Used to check docs/tech/perf-ADOPT.md section 8 (order and conflicts) and to profile the combination.

Usage: python sandbox/perf/combine.py OUT_DIR STEP [STEP...]      steps: pm, vm, water, perf (applied in the given order)
  e.g. python sandbox/perf/combine.py /tmp/d-all pm vm perf water
       python sandbox/perf/shoot.py --dist /tmp/d-all --only baseline --no-cdp --frames 12 --tag all --json /tmp/all.json
Other topics' files are read with `git show` from --pm-ref / --vm-ref / --water-ref (defaults below), so the branch
being tested does not need them. perf is applied with `patch -F0` (no fuzz: as strict as `git apply`); FUZZ=2 relaxes it.
Each topic's steps are applied exactly as its ADOPT doc quotes them (every replaced snippet must match exactly once).
"""
import os, shutil, subprocess, sys, argparse
from pathlib import Path
HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]
ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('steps', nargs='+', choices=['pm', 'vm', 'water', 'perf'])
ap.add_argument('--pm-ref', default='origin/claude/raft-tech'); ap.add_argument('--vm-ref', default='origin/claude/raft-tech')
ap.add_argument('--water-ref', default='origin/fleet-tech/water')
a = ap.parse_args()
out = Path(a.out).resolve()
if out.exists(): shutil.rmtree(out)
shutil.copytree(ROOT / 'dist', out)
g = out / 'game.js'
B = 'v3-survival-ae77fa84ac2b'

def show(ref, path, dest): dest.write_bytes(subprocess.run(['git', 'show', f'{ref}:{path}'], cwd=ROOT, check=True, capture_output=True).stdout)
def sub(old, new):
    s = g.read_text(); n = s.count(old)
    if n != 1: sys.exit(f'expected 1x, found {n}x: {old[:90]!r}')
    g.write_text(s.replace(old, new))

for st in a.steps:
    if st == 'pm':  # docs/tech/procedural-models-ADOPT.md steps 1-3
        show(a.pm_ref, 'sandbox/procedural-models/lowpoly-props.js', out / 'lowpoly-props.js')
        sub(f"import {{ createFloor }} from './deck.js?build={B}';\n", f"import {{ createFloor, createDebris, createCraft, createPlastic }} from './lowpoly-props.js?build={B}';\n")
        for f, fn in (('debris', 'createDebris'), ('crafts', 'createCraft'), ('plastic', 'createPlastic')): sub(f"import {{ {fn} }} from './{f}.js?build={B}';\n", '')
        sub("if (!cached.has(m) && m !== clothMat) materials.add(m);", "if (!cached.has(m) && m !== clothMat && !m.userData?.shared) materials.add(m);")
    elif st == 'perf':  # sandbox/perf/adopt.patch
        r = subprocess.run(['patch', '-p2', '-F', os.environ.get('FUZZ', '0'), '--forward', '--no-backup-if-mismatch', '-r', '-', '-i', str(HERE / 'adopt.patch')], cwd=out, capture_output=True, text=True)
        if r.returncode: sys.exit('adopt.patch failed:\n' + r.stdout + r.stderr)
    elif st == 'water':  # water-ADOPT.md steps 1-3; step 2 goes after fitShadow() when perf step 4 is in (perf-ADOPT section 8)
        show(a.water_ref, 'sandbox/water/water.js', out / 'ocean.js')
        if 'deckBatch.add(' in g.read_text(): sub("    fitShadow();\n", "    fitShadow();\n    ocean?.setRaft?.(world.tiles);\n")
        else: sub("raft.add(g); });\n    for (const d of world.decor)", "raft.add(g); });\n    ocean?.setRaft?.(world.tiles);\n    for (const d of world.decor)")
        sub("  const itemMeshes = new Map();\n", "  const itemMeshes = new Map();\n  const floaters = []; // capsule footprints [x, z, r, hx, hz] fed to the ocean for contact foam\n")
        sub("it.phase) * .05);\n    }\n  }\n", "it.phase) * .05);\n    }\n    floaters.length = 0; for (const m of itemMeshes.values()) if (m.visible) floaters.push(ocean.footprint?.(m) ?? [m.position.x, m.position.z, .35]);\n    ocean.setBobber?.(hookMesh?.visible ? hookMesh.position : null);\n    ocean.setFloaters?.(floaters, camera.position.x, camera.position.z);\n  }\n")
    elif st == 'vm':  # viewmodel-ADOPT.md steps 1-7
        show(a.vm_ref, 'sandbox/viewmodel/viewmodel.js', out / 'viewmodel.js'); show(a.vm_ref, 'sandbox/viewmodel/hands.js', out / 'hands.js')
        sub(f"import {{ createHands }} from './hands.js?build={B}';\n", f"import {{ createHands }} from './hands.js?build={B}';\nimport {{ createViewmodel }} from './viewmodel.js?build={B}';\n")
        sub("rodTip = null, clothMat;", "rodTip = null, clothMat, vm = null;")
        sub("{ry:Math.PI / 2, rz:.2, scale:.6}));", "{ry:Math.PI / 2, rz:.2, scale:.6}), {use:'strike'});")
        s = g.read_text(); end = '      h.group.visible = false; camera.add(h.group);\n    }\n'
        i = s.index('    // Viewmodels draw last'); j = s.index(end, i) + len(end)
        g.write_text(s[:i] + "    vm = createViewmodel(T, {camera, fov:70});\n    vm.add('hook', hookHands); vm.add('hammer', hammerHands, {use:'strike'}); vm.add('fishingrod', rodHands);\n" + s[j:])
        sub("    hookHands.group.visible = running && kind === 'hook';\n    hammerHands.group.visible = running && kind === 'hammer';\n    rodHands.group.visible = running && kind === 'fishingrod';\n",
            "    vm.update({dt, kind:running ? kind : null, yaw, pitch, walking, walkPhase, grounded:physics.grounded, vy:physics.vy, charge:ch, swing, motion});\n")
        sub("(kind === 'fishingrod' ? rodTip : hookHands.handTip).getWorldPosition(handPos);", "vm.anchor(kind === 'fishingrod' ? rodTip : hookHands.handTip, handPos);")
        sub("camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });", "camera.updateProjectionMatrix(); vm?.setAspect(camera.aspect); renderer.setSize(innerWidth, innerHeight); });")
    print('applied', st, file=sys.stderr)
r = subprocess.run(['node', '--check', str(g)], capture_output=True, text=True)
if r.returncode: sys.exit('game.js does not parse:\n' + r.stderr)
print(out)
