"""The exact viewmodel adoption edits (docs/tech/viewmodel-ADOPT.md), as data.
Each edit: (step, file, old, new). `old` must occur exactly once in the current dist file.
Used by adopt_check.py (applies them to a temp copy of dist/) and by `python adopt_edits.py --sandbox`,
which regenerates sandbox/viewmodel/hands.js = dist/hands.js + the hands.js edits."""
import sys
from pathlib import Path

B = '?build=v3-survival-ae77fa84ac2b'

HANDS = [
  ('H1', 'hands.js',
   "//   const hands = createHands(THREE, { modelFactory });  // factory optional, e.g. (k) => getModel(k) (models.js)\n"
   "//   camera.add(hands.group);                       // camera must be in the scene\n",
   "//   const hands = createHands(THREE, { modelFactory });  // factory optional, e.g. (k) => getModel(k) (models.js)\n"
   "//   camera.add(hands.group);                       // camera must be in the scene\n"
   "//   // or, with the viewmodel layer (viewmodel.js): own FOV, no wall clipping, real shadows, long sleeve\n"
   "//   const vm = createViewmodel(THREE, { camera }); const hands = createHands(THREE, { modelFactory, prepare: vm.prepare }); vm.attach(hands);\n"
   "//   options: prepare(obj) per-mesh setup hook (replaces the transparent-queue default), strikeKinds (default\n"
   "//   ['hammer']): kinds whose click use is a cock-back + downward strike instead of the forward sweep\n"),
  ('H2', 'hands.js',
   "export function createHands(T, { modelFactory = null } = {}) {\n",
   "export function createHands(T, { modelFactory = null, prepare = null, strikeKinds = ['hammer'] } = {}) {\n"),
  ('H3', 'hands.js',
   "  // Viewmodel meshes draw in the transparent queue after the camera's depth-clear marker (see game.js),\n"
   "  // never cast shadows and are never culled.\n"
   "  const prep = (o) => o.traverse((c) => {\n"
   "    if (!c.isMesh) return;\n"
   "    c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; c.renderOrder = 1000;\n"
   "    for (const m of [].concat(c.material)) { m.depthTest = true; m.depthWrite = true; m.transparent = true; }\n"
   "  });\n",
   "  // Default: viewmodel meshes draw in the transparent queue after a camera depth-clear marker, never cast shadows\n"
   "  // and are never culled. `prepare` (viewmodel.js vm.prepare) replaces this for every mesh, incl. lazily built models.\n"
   "  const prep = prepare || ((o) => o.traverse((c) => {\n"
   "    if (!c.isMesh) return;\n"
   "    c.castShadow = false; c.receiveShadow = false; c.frustumCulled = false; c.renderOrder = 1000;\n"
   "    for (const m of [].concat(c.material)) { m.depthTest = true; m.depthWrite = true; m.transparent = true; }\n"
   "  }));\n"),
  ('H4', 'hands.js',
   "    seg(frame, sleeveMat, at(0.23), at(0.60), 0.051, 0.070, 14);   // sleeve (runs off-screen)\n",
   "    // sleeve: under the viewmodel layer (prepare) it runs back past the eye, so a swing never shows its open end;\n"
   "    // the default path keeps the short one (a long sleeve would cross the world camera's near plane)\n"
   "    seg(frame, sleeveMat, at(0.23), at(prepare ? 1.10 : 0.60), 0.051, prepare ? 0.066 : 0.070, 14);\n"),
  ('H5', 'hands.js',
   "  const st = { walkW: 0, reelW: 0, outW: 0, toolW: 1, chargeS: 0, releaseCharge: 0.6, lastCasting: 0, spool: 0, t: 0,\n",
   "  const st = { walkW: 0, reelW: 0, outW: 0, toolW: 1, chargeS: 0, releaseCharge: 0.6, lastCasting: 0, strikeOn: false, spool: 0, t: 0,\n"),
  ('H6', 'hands.js',
   "      if (st.dip >= 1) swapNow();\n"
   "    } else if (st.raise < 1) st.raise = Math.min(1, st.raise + dt / 0.26);\n",
   "      if (st.dip >= 1) swapNow();\n"
   "    } else {\n"
   "      // re-selected the item that was being lowered: raise it again from the current height (no pop, no stuck dip)\n"
   "      if (st.lowering) { const d = st.dip * st.dip; let lo = 0, hi = 0.59; for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (1 - easeOutBack(m) > d) lo = m; else hi = m; } st.raise = lo; st.lowering = false; }\n"
   "      if (st.raise < 1) st.raise = Math.min(1, st.raise + dt / 0.26);\n"
   "    }\n"),
  ('H7', 'hands.js',
   "    if (casting > 0 && (st.lastCasting <= 0 || casting > st.lastCasting + 0.25)) st.releaseCharge = Math.max(st.chargeS, charge, 0.35);\n",
   "    if (casting > 0 && (st.lastCasting <= 0 || casting > st.lastCasting + 0.25)) {\n"
   "      st.releaseCharge = Math.max(st.chargeS, charge, 0.35);\n"
   "      st.strikeOn = casting > 0.7;    // a click use (swing 1) strikes; a pickup tap (swing .6) keeps the light sweep\n"
   "    }\n"
   "    if (casting <= 0) st.strikeOn = false;\n"),
  ('H8', 'hands.js',
   "    const a = (forward - recoil) * (isHook ? 1 : 0.55);\n",
   "    const STRIKE = st.strikeOn && strikeKinds.includes(st.shown);\n"
   "    const a = STRIKE ? 0 : (forward - recoil) * (isHook ? 1 : 0.55);\n"
   "    // strike curve (hammer): cock back 0-.2, hit .2-.36 (impact ~.36, ~120 ms after the click), rebound, recover .5-1\n"
   "    const sUp = STRIKE ? smooth(0, 0.2, p) * (1 - smooth(0.2, 0.36, p)) : 0;\n"
   "    const sHit = STRIKE ? smooth(0.2, 0.36, p) * (1 - smooth(0.5, 1, p)) : 0;\n"
   "    const sReb = STRIKE ? Math.sin(Math.PI * clamp01((p - 0.36) / 0.22)) : 0;\n"),
  ('H9', 'hands.js',
   " + 0.008 * oW - 0.008 * rW + trem;\n",
   " + 0.008 * oW - 0.008 * rW + trem\n"
   "      + 0.02 * sUp - 0.03 * sHit;\n"),
  ('H10', 'hands.js',
   " - 0.025 * catchDip + trem * 0.7 - 0.45 * down;\n",
   " - 0.025 * catchDip + trem * 0.7 - 0.45 * down\n"
   "      + 0.05 * sUp - 0.08 * sHit + 0.012 * sReb;\n"),
  ('H11', 'hands.js',
   "    const rpz = 0.20 * ce - 0.24 * a + 0.025 * oW - 0.012 * rW * (pull - 0.5);\n",
   "    const rpz = 0.20 * ce - 0.24 * a + 0.025 * oW - 0.012 * rW * (pull - 0.5) + 0.02 * sUp - 0.04 * sHit;\n"),
  ('H12', 'hands.js',
   "    const rrx = 0.40 * ce - 0.75 * a + 0.010 * amp * br + 0.10 * oW + 0.12 * catchDip - 0.5 * down;\n",
   "    const rrx = 0.40 * ce - 0.75 * a + 0.010 * amp * br + 0.10 * oW + 0.12 * catchDip - 0.5 * down + 0.20 * sUp - 0.35 * sHit + 0.10 * sReb;\n"),
  ('H13', 'hands.js',
   "    const rwx = 0.35 * ce - 0.55 * a - 0.10 * oW + 0.06 * rW * Math.sin(t * 18.85);\n",
   "    const rwx = 0.35 * ce - 0.55 * a - 0.10 * oW + 0.06 * rW * Math.sin(t * 18.85) + 0.30 * sUp - 1.40 * sHit;\n"),
  ('H14', 'hands.js',
   " + 0.004 * amp * brL - 0.45 * down - 0.45 * (1 - lIn);\n",
   " + 0.004 * amp * brL - 0.45 * down - 0.45 * (1 - lIn) - 0.010 * sHit;\n"),
  ('H15', 'hands.js',
   "chargeEased: ce, throw: a,\n",
   "chargeEased: ce, throw: a, strike: sHit - sUp,\n"),
]

GAME = [
  ('G1', 'game.js',
   f"import {{ createHands, isPlaceable }} from './hands.js{B}';\n",
   f"import {{ createHands, isPlaceable }} from './hands.js{B}';\n"
   f"import {{ createViewmodel }} from './viewmodel.js{B}';\n"),
  ('G2', 'game.js',
   "  let hands = null, offIconReady = null, clothMat; // one hands controller swaps the held item model per hotbar kind\n",
   "  let hands = null, vm = null, offIconReady = null, clothMat; // one hands controller swaps the held item model per hotbar kind; vm = viewmodel layer\n"),
  ('G3', 'game.js',
   "    hands = createHands(T, {modelFactory:modelOf}); hands.preload(['hook']); // 3D models from models.js, built-ins as fallback\n"
   "    // Viewmodels draw last (transparent queue, renderOrder 1000) after a camera-owned marker clears depth, so the\n"
   "    // world never clips them while fingers and tools still depth-sort correctly against each other.\n"
   "    const depthClear = new T.Mesh(new T.PlaneGeometry(1e-4, 1e-4), new T.MeshBasicMaterial({colorWrite:false, depthWrite:false, depthTest:false, transparent:true}));\n"
   "    depthClear.name = 'viewmodelDepthClear'; depthClear.frustumCulled = false; depthClear.castShadow = false; depthClear.receiveShadow = false;\n"
   "    depthClear.renderOrder = 999; depthClear.position.set(0, 0, -.1);\n"
   "    depthClear.onBeforeRender = (r, _s, cam) => { if (cam !== camera) return; r.state?.buffers?.depth?.setMask?.(true); r.clearDepth(); };\n"
   "    camera.add(depthClear);\n"
   "    camera.add(hands.group);\n",
   "    // Own-FOV, depth-squashed viewmodel layer (viewmodel.js): one pass, world lighting and shadows, never clips.\n"
   "    vm = createViewmodel(T, {camera, fov:70});\n"
   "    hands = createHands(T, {modelFactory:modelOf, prepare:vm.prepare}); hands.preload(['hook']); // 3D models from models.js, built-ins as fallback\n"
   "    vm.attach(hands);\n"),
  ('G4', 'game.js',
   "casting:swing, walking, hasHookOut:!!castOut(), motion, yaw, pitch}); // [fishing-cooking] rod reel pose from the lane\n"
   "    camera.updateMatrixWorld(true);\n"
   "    hands.ropeAnchor().getWorldPosition(handPos);\n",
   "casting:swing, walking, hasHookOut:!!castOut(), motion, yaw, pitch}); // [fishing-cooking] rod reel pose from the lane\n"
   "    vm.update({dt, held:hands.state.held, grounded:physics.grounded, vy:physics.vy, charge:ch, swing, motion});\n"
   "    camera.updateMatrixWorld(true);\n"
   "    vm.anchor(hands.ropeAnchor(), handPos); // the hands draw scaled toward the eye: map the anchor to its on-screen world point\n"),
  ('G5', 'game.js',
   "camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });\n",
   "camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vm?.setAspect(camera.aspect); renderer.setSize(innerWidth, innerHeight); });\n"),
  ('G6', 'game.js',
   "(viewmodels stay at 1000)",
   "(viewmodels draw in their own front depth slice, viewmodel.js)"),
]

EDITS = HANDS + GAME


def line_of(text, old):
    return text[:text.index(old)].count('\n') + 1


def apply(dist_dir, edits=EDITS, report=None):
    """Apply edits in place under dist_dir. Asserts each anchor occurs exactly once (in the file as edited so far)."""
    dist_dir = Path(dist_dir)
    for step, f, old, new in edits:
        p = dist_dir / f
        s = p.read_text()
        n = s.count(old)
        assert n == 1, f'{step}: anchor in {f} matches {n} times: {old[:80]!r}'
        if report is not None: report.append({'step': step, 'file': f, 'line': line_of(s, old)})
        p.write_text(s.replace(old, new, 1))


if __name__ == '__main__' and '--sandbox' in sys.argv:
    import shutil, tempfile
    root = Path(__file__).resolve().parents[2]
    tmp = Path(tempfile.mkdtemp(prefix='vm-hands-'))
    shutil.copy(root / 'dist/hands.js', tmp / 'hands.js')
    apply(tmp, HANDS)
    # the sandbox copy imports held-items.js from dist/
    s = (tmp / 'hands.js').read_text().replace("from './held-items.js", "from '../../dist/held-items.js")
    (root / 'sandbox/viewmodel/hands.js').write_text(s)
    print('wrote sandbox/viewmodel/hands.js')
