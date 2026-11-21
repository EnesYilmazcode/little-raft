# Water review (harsh judge)

Reviewed `origin/retarget/water` at 5677879 against **current `origin/main` 8d21618**. I checked everything myself. I did not trust the doc's numbers and did not edit any code. The scratch work is in `scratchpad/judge-water/` and is not committed: `main/` is an `origin/main` export, `patched/` has the ADOPT steps applied exactly as written, and `fixed/` has the same steps with the two rejected hunks and the two missing methods hand-shimmed, so that the looks and cost could still be judged.

## Scores

| axis | score |
|---|---|
| LOOKS | 6 |
| COST | 8 |
| ADOPT-CORRECTNESS | 2 |
| OVERALL (at most lowest + 2) | **3** |

## The blocker: the branch is not retargeted to the current dist

`water-ADOPT.md` and `water.md` say they were "checked against `claude/raft-tech` 20fed47". That is the dist on this branch, but `origin/main` has moved on by 1213 commits since the merge base. In that time `dist/ocean.js` gained its **own** contact foam, and `dist/game.js` was rewritten around it (+807/−213 lines in those two files alone).

- `git apply --check sandbox/water/adopt-game.diff` passes only against the branch's own stale dist. Against `origin/main`, `patch --dry-run` fails: **2 of 6 hunks are rejected** (the `createOcean` line at old 382 is now 444 with a new palette and a different `fadeFar`, and `rebuildRaft` is now at 606). The other 4 hunks apply only with fuzz 1–2 and offsets of 117–350 lines.
- `origin/main` `dist/game.js` calls **`ocean.trackFoam(itemsGroup)`** (line 447) and **`ocean.setRaftTiles(world.tiles)`** (line 607) without a guard. `water.js` has neither method. After `cp water.js dist/ocean.js` plus the diff, **the game does not start**. I booted it and got `TypeError: ocean.trackFoam is not a function at init (game.js:447)`, then the "The 3D ocean could not start" card, and live.js fails the same way on every hot update (`update ... failed; keeping null`). `shoot_game.py` on that tree times out waiting for `raftDebug`.
- `node sandbox/water/parity.mjs` prints ok only because it imports the branch's stale `dist/ocean.js`. Pointed at `origin/main`'s `ocean.js` it fails: `{"ok":false,"missing":"setRaftTiles"}`. It also reports missing `trackFoam`, `uRaftMask` and `uFoamPts`. The physics is still bit-identical: worstDiff 0 over 100,800 samples and 4 `uFlow` offsets, and setAmp diff 0. The height maths are fine. The API is not.
- `npm test` (node --test, 910 tests): main gives 909 pass / 1 fail (the `atlas` timing test, which fails on this box either way). Patched gives 908 / 2. The new failure is **`tests/ocean.test.mjs` "foam points are the nearest 8 visible items within 15 m"** with `ocean.trackFoam is not a function`. The doc's "532/533 same both ways" is from the old tree.
- Defaults drifted. `origin/main` `ocean.js` now defaults to sky `#a6e9f2`, zenith `#2a8fd6`, deep `#08355f`, shallow `#1a78b0` and foam `#f4fbfc`, and takes `options.zenith`. `game.js` no longer overrides `uDeep`/`uShallow`/`uZenith`. `water.js:387-392` still has the old grey-green palette and reads `options.zenithColor`. In game, daynight overwrites these every frame, so the effect is small there. They still show with `?daynight=off`, and `islands-models.js` captures the ocean's colours at creation as the lagoon's "day" reference, so the lagoon would get the wrong reference.

## LOOKS (6)

I compared `shoot_game.py` shots from `main/dist` and `fixed/dist` (spawn, down, cast, noon, dusk, night, swim, under, sail) and the lab shots (fp, over, sun, rough sea).

Better than main:
- **Plank gaps.** On current main the water seen through the deck gaps is a **bright white line** in every shot (down, noon, dusk, sail), and at night it glows. The new exact inside-SDF makes them dark shaded water. This is a clear win.
- **Contact.** Items get lace shaped by their footprint, and the raft gets a thin ragged collar plus rings (lab `over` and `sun`, game `down`, `sail`). Main's raft collar is a soft white smudge, and its item rings barely read.
- **Swimmer eye.** Main shows big soft white blobs across the near sea. The new water is clean, with no white sheet.
- No seams while sailing (`sail`). Underwater shots are identical, because the fx hides the ocean.

Worse than main:
- **Sun path.** Main's newer specular (pow 420 ×2.6 + pow 60 ×.28) gives a strong, continuous sun road at dusk and while sailing. The new glitter (`water.js:277-286`) turns it into a sparse **field of discrete white dots**: game `dusk` and `sail`, lab `over`. The dots read as sparkle noise, not as glints, and this is the most visible regression.
- **Body colour.** The new sea is paler and milkier, with fresnel capped at .75 against main's .5 and a mint band toward the horizon. Main's newer look is deeper blue with visible ripple texture. At night the new sea is lighter and flatter, and item lace is fairly bright under moonlight. That is acceptable, but the sea looks less like night.
- Rough sea (lab amp 2.6): the Jacobian crest bands are good, but the far field washes out to a near-white band.

Net: better contact, gaps and swimmer view, but a worse sun path and a flatter body colour. It is not "clearly better" than the current main ocean.

## COST (8)

- Game, GPU-process CPU ms per frame. I interleaved two browsers, swapping order each round, 3 rounds × 20 frames, with **`?pinQuality`**, which is essential. My first run without it gave a bogus 0.5×, because the adaptive ladder dropped the shadows in one browser (calls 57 vs 43). `shoot_game.py` and `profile.py`'s game numbers have the same flaw.
  - down: main 1207, new 1007 (**0.83×**)
  - sea: main 1050, new 891 (**0.85×**)
  - night: main 1180, new 1031 (**0.87×**)

  The new shader is cheaper than main's current ocean. Main's 8-slot item loop and 4-tap hand-filtered raft mask are heavier.
- Draw calls track the visible items (48–57 either way). Programs are the same, 103–106. Textures go 12 → 14: main already has 1 mask, and the new water has raft SDF RG8 128², float map R8 256² and noise R8 512².
- CPU (node, box load average 50–60, so the absolute numbers are inflated):
  - `setRaft` takes 1–9 ms for 7–400 tiles per `cpu-cost.mjs`. My runs swung between 8 and 150 ms, with JIT warm-up and load mixed in, and it runs on every build action.
  - The sun shadow re-bake is 0.1–2 ms for 9 tiles and up to 5 ms for 400 tiles, every 1.5° of sun movement (about every 5 s).
  - `onBeforeRender` without a re-bake is ≤ 0.01 ms.
  - `footprint` ×30 plus `setFloaters` is 0.07 ms.
- `setQuality` toggles `WATER_LOW` and recompiles once per preset change. It returns early when nothing changed, so it is safe that `applyOptions` calls it on every options change.

## ADOPT-CORRECTNESS (2)

- The game will not boot with the documented steps (see above). The diff does not apply, parity fails against the real `ocean.js`, and one unit test breaks.
- The ADOPT doc never mentions that main now has `setRaftTiles` / `trackFoam` / `userData.foamRadius` and its own collar system. It needs an explicit "supersedes" plan: either keep those names as aliases, or remove the calls from `game.js` and replace `tests/ocean.test.mjs`.
- Every other `ocean.*` user in main's dist is compatible:
  - `getHeight`/`sample`/`getSlope` in game, coop-fx, diving, underwater-fx, fishing-v2, islands, wildlife and shark
  - `mesh.position.y`, and `mesh.visible` in diving
  - `uniforms.uFlow` in sailing-world
  - the uniforms daynight writes (they are `.copy()`'d, so the `sunDir` reference tracking in `trackSun` works)
  - `sky.follow(ocean.uniforms)`, which reads `uZenith`/`uSunDir`/`uSunColor`
  - the lagoon reusing `material.vertexShader` with only `vWorld`/`vNormalW`/`vHeight` varyings (no shader errors in any shot)
- Hot swap:
  - `dispose()` frees all 3 textures (node: 3/3 dispose events).
  - There is no module-level GPU state. Only the 256 KB noise array is cached, on purpose.
  - The in-browser two-swap GC test did not finish within 40 min on this box (load average 60), so a browser-level leak check is **not verified**.
  - The existing audit `tests/audit/perf1_hotswap_leaks_old_engine.py` hooks `Mesh.prototype.onBeforeRender`. `water.js:427` sets an own `onBeforeRender` on the mesh, so that hook would never fire for the ocean and the audit would hang. The audit is already stale on main (`#solo` is hidden), but it should be updated, for example to find the mesh with `scene.getObjectByName('ocean')`.
- The cast shot does not prove the bobber foam: `raftDebug.state.hook.stage` was `'flying'` when `cast` was shot, on both trees.

## Required fixes (OVERALL < 7)

1. **Retarget to `origin/main` 8d21618 for real.** Regenerate `sandbox/water/adopt-game.diff` from the current `dist/game.js`:
   - 444: `createOcean` line
   - 447: `ocean.trackFoam(itemsGroup)`
   - 606–607: `rebuildRaft` already calls `ocean.setRaftTiles`
   - 1311: `applyOptions`
   - ~1424: `updateRaft`
   - ~1500: `updateItems`

   Re-run `git apply --check` against main's dist, not the branch's.
2. **`sandbox/water/water.js:728`: add the main API.** Either `setRaftTiles` (alias of `setRaft`) and `trackFoam(group)` (store the group and build floaters from its visible children in `update()`, honouring `userData.foamRadius`), or remove those calls in the diff and replace `tests/ocean.test.mjs` with an equivalent test of the floater map. `npm test` must have no new failures.
3. **`sandbox/water/parity.mjs`** must compare against `origin/main`'s `ocean.js`, and must pass the key check: either expose `uRaftMask`/`uFoamPts` stubs or document and whitelist their removal after checking that nobody reads them (`grep` shows no reader outside ocean.js).
4. **`water.js:387-394`: defaults.** Adopt main's palette (`#a6e9f2`, `#2a8fd6`, `#08355f`, `#1a78b0`, `#f4fbfc`), honour `options.zenith`, and check the `fadeFar` default (game passes 190).
5. **`water.js:273-286`: sun path.** Restore a continuous road. Keep a broad lobe at roughly main's strength (pow ~60 ×.28 plus a pow ~400 core), and use the glitter only as modulation on top of it, not as the whole tight lobe. At 1280×720 the dot field reads as noise in `dusk`, `sail` and lab `over`.
6. **`sandbox/water/shoot_game.py`, `profile.py`: open the game with `?pinQuality`.** Without it the adaptive ladder makes the A/B numbers meaningless. Also wait for `hook.stage === 'floating'` before the `cast` shot.
7. **`docs/tech/water-ADOPT.md`, `water.md`:**
   - Fix the "Checked against 20fed47" header, every line number, and the `npm test` and timing tables.
   - Add a section on replacing main's collar system.
   - Note that `perf1_hotswap_leaks_old_engine.py` needs `getObjectByName('ocean')` instead of the prototype hook.

## Nice-to-haves once fixed

- Make `setRaft` incremental (re-stamp only the changed tile's neighbourhood), so that building on a 400-tile raft does not spend 5–10 ms or more on the main thread.
- Share `uFlow`/`uAmp` with the lagoon (already listed as a follow-up).
- Delete tiers B and C from `water.js` (about 120 lines of dead code in the shipped file).
