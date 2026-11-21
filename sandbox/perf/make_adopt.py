"""Build sandbox/perf/adopt.patch from exact anchors in the CURRENT dist/ (every anchor must occur exactly once).
Usage: python sandbox/perf/make_adopt.py [--steps 1,2,3,4,5] [--out sandbox/perf/adopt.patch]
Each step is one perf-ADOPT.md section; the text replaced here is quoted there verbatim.
The patch is made with `diff -ruN a/dist b/dist`, so `git apply -p1` / `patch -p1` apply it at the repo root."""
import argparse, re, shutil, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]
B = 'v3-survival-ae77fa84ac2b'

# step -> list of (file, old, new). `old` must occur exactly once in the file at that point.
STEPS = {
  # 1. Incremental raft rebuild: deck tiles generated once (deck-cache.js), unchanged decor keeps its model.
  1: [
    ('game.js', f"import {{ mergeGeometries }} from './merge-geo.js?build={B}';\n",
     f"import {{ mergeGeometries }} from './merge-geo.js?build={B}';\n"
     f"import {{ createDeckCache }} from './deck-cache.js?build={B}'; // perf: incremental raft rebuilds\n"),
    ('game.js', """  function rebuildRaft() {
    for (const c of [...raft.children]) { raft.remove(c); disposeGeometry(c); }
    wateringGroups.clear();
    raft.add(createRaftMesh(T, world.tiles.map(([x, z]) => ({index:x * 719 + z * 311, x:x * 2, z:z * 2})), mat));
    for (const d of world.decor) {
""", """  // perf: rebuildRaft() runs on every floor, decoration, synced world and save load. Floor tiles are generated once
  // (deck-cache.js; the deck group is kept while the tile list is unchanged) and a decoration whose save entry is
  // unchanged keeps its model (a sail is ~46 ms of geometry), so a build costs one tile or one model, not the raft.
  let deckCache = null;
  function rebuildRaft() {
    deckCache ??= createDeckCache(T, createRaftMesh, mat);
    const floors = deckCache.build(world.tiles.map(([x, z]) => ({index:x * 719 + z * 311, x:x * 2, z:z * 2}))), reuse = new Map();
    for (const c of [...raft.children]) {
      if (c === floors) continue;
      const k = c.userData.decorKey;
      if (k !== undefined) { if (!reuse.has(k)) reuse.set(k, []); reuse.get(k).push(c); continue; }
      raft.remove(c); disposeGeometry(c);
    }
    wateringGroups.clear();
    if (floors.parent !== raft) raft.add(floors);
    for (const d of world.decor) {
      const decorKey = JSON.stringify(d), kept = reuse.get(decorKey)?.pop();
      if (kept) { if (kept.userData.tileKey !== undefined) wateringGroups.set(kept.userData.tileKey, kept); continue; }
"""),
    ('game.js', "      if (detailed) { detailed.position.set(d.x * 2, .22, d.z * 2); detailed.rotation.y = d.rot || 0; raft.add(detailed);",
                "      if (detailed) { detailed.position.set(d.x * 2, .22, d.z * 2); detailed.rotation.y = d.rot || 0; detailed.userData.decorKey = decorKey; raft.add(detailed);"),
    ('game.js', "      const g = new T.Group(); g.position.set(d.x * 2, .22, d.z * 2); g.rotation.y = d.rot || 0;\n",
                "      const g = new T.Group(); g.position.set(d.x * 2, .22, d.z * 2); g.rotation.y = d.rot || 0; g.userData.decorKey = decorKey;\n"),
    ('game.js', """      raft.add(g);
    }
    blockList = world.decor.flatMap(d => decorBlockers(d, BLOCK_RADIUS));
""", """      raft.add(g);
    }
    for (const list of reuse.values()) for (const c of list) { raft.remove(c); disposeGeometry(c); } // decor that was removed or changed
    blockList = world.decor.flatMap(d => decorBlockers(d, BLOCK_RADIUS));
"""),
    ('game.js', "    materialCache.clear(); itemMeshes.clear(); scene.clear();\n",
                "    materialCache.clear(); itemMeshes.clear(); scene.clear(); deckCache?.dispose(); deckCache = null; // perf: cached tile geometry\n"),
  ],
  # 2. Perf panel (F3 or ?perf) reading quality.js; no dynamic resolution of its own.
  2: [
    ('game.js', f"import {{ createQuality }} from './quality.js?build={B}';\n",
     f"import {{ createQuality }} from './quality.js?build={B}';\n"
     f"import {{ createPerfOverlay }} from './perf-overlay.js?build={B}'; // perf: F3 / ?perf panel\n"),
    ('game.js', "  let disposed = false, active = false, rafId = 0;\n",
                "  let disposed = false, active = false, rafId = 0, perfHud = null; // perfHud: perf-overlay.js (F3)\n"),
    ('game.js', "  function frame() {\n    const now = performance.now(),",
                "  function frame() {\n    perfHud?.begin();\n    const now = performance.now(),"),
    ('game.js', "    renderer.info.reset(); renderer.render(scene, camera); diving?.render(renderer); // perf: manual info reset counts the shadow pass too; diving lane hook\n",
                "    renderer.info.reset(); renderer.render(scene, camera); diving?.render(renderer); // perf: manual info reset counts the shadow pass too; diving lane hook\n    perfHud?.end();\n"),
    ('game.js', "    init();\n    try { coop = createCoop(",
                "    init();\n    try { perfHud = createPerfOverlay({renderer, quality}); } catch (e) { console.warn('perf overlay unavailable', e); } // perf: hidden until F3 / ?perf\n    try { coop = createCoop("),
    ('game.js', "    try { settingsController?.destroy(); } catch {}\n    try { survivalUI?.destroy?.(); } catch {}\n",
                "    try { settingsController?.destroy(); } catch {}\n    try { perfHud?.dispose(); } catch {} perfHud = null; // perf\n    try { survivalUI?.destroy?.(); } catch {}\n"),
  ],
  # 3. live.js: two overlapping check() calls both swapped (guard only set inside swap(), after an await).
  3: [
    ('live.js', """    manifest = await fetchManifest();
  } catch (e) {
    // Silent: network hiccups must not disturb play.
""", """    manifest = await fetchManifest();
    if (state.updating) return { status: 'busy', build: state.build }; // another check() started a swap while this one waited
  } catch (e) {
    // Silent: network hiccups must not disturb play.
"""),
  ],
  # 4. wood.js: no plank bump map (invisible at bumpScale .018; 11-18% of a SwiftShader frame even through the twin).
  4: [
    ('wood.js', """ // The bump term samples its map three times per pixel; anisotropic filtering there is invisible at this bump
 // scale but costly on software GL, so the bump reads the same canvas through an isotropic twin.
 const bump=texture.clone();bump.anisotropy=1;
 return new T.MeshStandardMaterial({map:texture,bumpMap:bump,bumpScale:.018,roughness:.86,metalness:0});
""", """ // No bump map: at bumpScale .018 it changed no pixel by more than 8/255 (deck diff 0.01 of 255), but even through
 // an isotropic twin its three extra taps per pixel were 11-18% of a SwiftShader frame (docs/tech/perf.md).
 return new T.MeshStandardMaterial({map:texture,roughness:.86,metalness:0});
"""),
  ],
  # 5. The 'low' preset also creates the WebGL context without MSAA (a context attribute: from the next page load).
  5: [
    ('game.js', f"import {{ createSettings, SETTINGS_DEFAULTS }} from './settings.js?build={B}';\n",
                f"import {{ createSettings, SETTINGS_DEFAULTS, SETTINGS_STORAGE_KEY, validateSettings }} from './settings.js?build={B}';\n"),
    ('game.js', "const PIN_QUALITY = /[?&]pinQuality\\b/.test(globalThis.location?.search || ''); // perf probes hold quality at the preset's top level\n",
                "const PIN_QUALITY = /[?&]pinQuality\\b/.test(globalThis.location?.search || ''); // perf probes hold quality at the preset's top level\n"
                "const storedGraphics = () => { try { return validateSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY))).graphics; } catch { return null; } }; // perf: the saved preset, before createSettings() runs\n"),
    ('game.js', "new T.WebGLRenderer({canvas, antialias:devicePixelRatio < 1.5}); // dense screens get their smoothing from pixels, not MSAA\n",
                "new T.WebGLRenderer({canvas, antialias:devicePixelRatio < 1.5 && storedGraphics() !== 'low'}); // dense screens get their smoothing from pixels, not MSAA; 'low' skips MSAA (~1/3 of software-GL raster; applies from the next load)\n"),
  ],
}
NEW_FILES ={1: ['deck-cache.js'], 2: ['perf-overlay.js']}

def build(dist, steps):
    for s in steps:
        for f in NEW_FILES.get(s, []): shutil.copy(HERE / f, dist / f)
        for f, old, new in STEPS[s]:
            p = dist / f; t = p.read_text()
            n = t.count(old)
            if n != 1: sys.exit(f'step {s}: anchor occurs {n} times in {f}: {old[:80]!r}')
            p.write_text(t.replace(old, new))

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--steps', default=','.join(map(str, STEPS))); ap.add_argument('--out', default=str(HERE / 'adopt.patch'))
    a = ap.parse_args(); steps = [int(x) for x in a.steps.split(',')]
    tmp = Path(tempfile.mkdtemp(prefix='raft-mk-'))
    shutil.copytree(ROOT / 'dist', tmp / 'a' / 'dist'); shutil.copytree(ROOT / 'dist', tmp / 'b' / 'dist')
    build(tmp / 'b' / 'dist', steps)
    d = subprocess.run(['diff', '-ruN', 'a/dist', 'b/dist'], cwd=tmp, capture_output=True, text=True).stdout
    d = re.sub(r'^(---|\+\+\+) (\S+)\t.*$', r'\1 \2', d, flags=re.M)  # no timestamps: the patch only changes when dist/ or a step does
    Path(a.out).write_text(d)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'wrote {a.out}: steps {steps}, {d.count(chr(10))} lines')
