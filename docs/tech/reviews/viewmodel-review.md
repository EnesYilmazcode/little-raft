# Viewmodel: judge review

Reviewed at `origin/fleet-tech/viewmodel` (dc8d527). I did not take the authors' claims on trust: every check below was re-run.

## Scores

| Axis | Score |
|---|---|
| LOOKS | 7 |
| COST | 9 |
| ADOPT-CORRECTNESS | 9 |
| OVERALL | 8 |

## What I ran

1. `python sandbox/viewmodel/shoot.py`: all 27 shots written, no page errors. I looked at every shot named in the brief.
2. ADOPT steps 1-7 applied literally to a scratch copy of `dist/` by a script that asserts each quoted line is unique and sits at the stated line number. All of them matched: line 10 import, 183 state, 330 hammer, 333-343 block, 726-728 visibility, 736 handPos, 915 resize. The side references are also correct: 660 `throwHook`, 714 FOV, 716 bob, 723 swing decay, 366 `BLOCK_RADIUS`, 467 `pickNdc`, 1183 settings. `diff dist/hands.js sandbox/viewmodel/hands.js` contains exactly edits 7a-7f and nothing else.
3. Patched game booted headless with the brief's chromium. I seeded a save with hook, hammer, rod and materials, then played it: solo start, hotbar swaps to hammer, rod and back, a fast 1-2-3 swap, full charge, throw (rope from the coil, an item caught), walk, FOV slider set to 95 through the options dialog (camera.fov became 95). With the hammer I built a floor tile (tiles went 9 -> 10). To catch the strike pose I slowed `performance.now` to 3%: the hammer head lands on the deck and then returns to rest. Page errors: none. Console: only SwiftShader's ReadPixels stall message.
4. Hot swap through `dist/live.js`: booted, changed `version.json`, called `raftLive.check()`. The build swapped with `lastError` null, the game kept running, hands rendered and there was still one canvas.
5. `node --test tests/survival.test.mjs`: 22/22 pass on both the patched and the unpatched copy.
6. Anchor math (node, FOV 95, 600 frames covering equip, strike, charge, land): `vm.anchor` lands on the hand pixel to within 1.6e-13 NDC, with no NaN. Its world distance is 0.85 m, the true unscaled distance; the naive `getWorldPosition` would return 0.13 m. The whole rig stays within 0.166 m of the eye, so it is inside BODY_RADIUS 0.25 m.

## Findings

- **Clipping.** It works. With the wall 0.12 m from the eye, the vm hook draws cleanly (`11`) and naive loses it (`13`). The depth math checks out: the hand NDC z is at most -0.96, which the world only reaches within about 5 cm of the eye.
- **FOV.** It works. In `16` vs `17`, and in game at FOV 95, the hand size does not change.
- **Shade.** It works, with real shadows. `14b` shows the hook going black without the fill, so the fill is justified. `14` shows the fill: hands still read as shaded and nothing glows.
- **Cost.** It matches the claims in the lab: calls 169 vs 170, programs 5 vs 6, geometries -1, triangles identical, and `vm.update` takes about 1 us. In game, draw calls per frame and programs are the same as legacy within scene noise. Millisecond timings were meaningless here (load average was about 44).
- **Shader patch.** It is sound on three r170: the `#include <common>`, `<project_vertex>`, `<normal_fragment_begin>` and `<opaque_fragment>` chunks exist. `castShadow=false` means the hands never enter the shadow or depth passes, so no `customDepthMaterial` is needed. `onBeforeCompile` runs once per material per key, and uniforms are shared objects.
- **Other users of hand positions.** I checked `handPos` (rope, `throwHook` origin, `hook.update` hand, debug `state.hand`); they now come from `vm.anchor`, and the in-game rope leaves the coil. Multiplayer sends no hand positions. Avatars, picking (itemsGroup only) and `rope.js` are unaffected. No world material is shared with the hands (hook, hammer, rod and hands each create their own materials), and no world object uses `depthTest:false`.

## Nice-to-haves (OVERALL >= 7)

1. `sandbox/viewmodel/viewmodel.js:65`: `prevKey.call(m)` runs after `onBeforeCompile` has been replaced. The prototype key therefore returns the vm arrow's source, not the previous patch's source. Two materials that already had different `onBeforeCompile` patches would share one program. No such material exists today. Include `prevCompile?.toString()` in the key.
2. `viewmodel.js:109`: if the player re-selects the tool that is being lowered, the curve switches from `1-smooth(e)` to `1-easeOutBack(e)` at the same `e`. At e = .5 that jumps from 0.5 to -0.05, a visible pop. Keep `down` continuous, for example by re-parameterising `e` on the switch.
3. `sandbox/viewmodel/hands.js:228`: a pickup while holding the hammer (`swing = .6`, so p = .4) starts directly in the full hit pose, a one-frame snap. Ease `sHit` in from the current pose, or skip the strike when `casting` starts below about .64.
4. `hands.js:128`: the long sleeve fixes the throw club, but at hammer impact and recover (`09c`, `09d`, and in game) it becomes a large flat green wedge across the bottom-right corner. Lower the elbow in the strike or taper the sleeve end (0.078 is wide).
5. The framing was judged without the HUD. In game (640x360) the left coil hand sits behind the hotbar, and at full charge the hook grip goes under the hotbar's right end. Both are pre-existing; legacy is the same. Consider a slightly higher or more inward rest pose when the HUD is visible.
6. The hammer head faces left at impact, so it reads as a chop (the authors note this themselves).
7. Lab oddity: the wall in `11-wall-vm.png` is lighter than in `12` and `13`, but `readPixels` after a direct render gives identical wall colour in vm and naive (96,62,28). It is a screenshot artefact, not a lighting change. Worth knowing before trusting colour comparisons between lab shots.
