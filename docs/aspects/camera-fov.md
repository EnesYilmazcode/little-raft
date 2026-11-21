# Aspect: camera-fov

Scope: the first-person camera. This covers vertical and horizontal FOV, eye height, head bob and sway, how the viewmodel sits in the frame, near-plane clipping, horizon position and camera roll. Raft (Redbeet Interactive) frames were used for internal study only. Little Raft must keep its own look, so the change list below covers feel and layout only.

Scratch work (scripts, overlays, crops): `/tmp/claude-0/-home-user-little-raft/357b287e-6b25-59b7-a94d-bb803559ea72/scratchpad/camera-fov/` (`vp.py`, `homo.py`, `mc.py`, `people.py`, `tilt.py`, `node/proj.mjs`).

Timing note: yt file suffixes are **mmss**. For example, `_0142` is 1:42, which is 102 s. The closest frame pairs are 3 to 6 s apart (`68lj91mBrDI_0110` and `_0113`: 3 s; `iVT88Yq-PU0_0040` and `_0044`: 4 s; `M4AhtY9BB1I_0142`, `_0148`, `_0154`: 6 s apart). A walk cycle lasts about 0.5 to 1 s, so these frames **cannot resolve head bob**. They only show slow drift and the idle pose.

## Images examined

All paths are under `references/raft/`. Sizes: yt frames are 960x540, except `2rqSgyWX6N0` at 960x600. Steam store shots are 1280x720.

- building/yt: all 57 frames on contact sheets. Measured in detail: `M4AhtY9BB1I_0142`, `M4AhtY9BB1I_0154` (FOV grid), `M4AhtY9BB1I_0024..0048`, `M4AhtY9BB1I_0118`, `YSMrrtHtpIc_0430`, `YSMrrtHtpIc_0530`, `YSMrrtHtpIc_0745`, `iVT88Yq-PU0_0004`, `iVT88Yq-PU0_0028..0052`, `iVT88Yq-PU0_0120`, `9vVu3idmeV4_0200`, `9vVu3idmeV4_0736`, `2rqSgyWX6N0_0315`.
- inventory-crafting/yt: 48 frames on sheets. Measured: `68lj91mBrDI_0009`, `68lj91mBrDI_0036..0149`, `68lj91mBrDI_0244`, `qVVltzNBaGw_0025`.
- farming/yt: all 18 frames on sheets. Measured: `Dle8DwL05lw_0240`, `Dle8DwL05lw_0450`, `Dle8DwL05lw_0800`, `Dle8DwL05lw_1130`.
- stills/steam: `store_01..24` on a sheet. The first-person shots with HUD are `store_02`, `06`, `11`, `15`, `16`, `21`. Measured in detail: `store_11`, `store_16`.
- stills/press: 285 files were listed. None were measured, because the yt frames and store shots gave cleaner first-person geometry with the HUD visible.

## FOV estimation method

Two frames show a clean foundation grid: blue seam lines between square deck tiles.

1. Rough lines were drawn by hand on gridded overlays, for example `g0142.png`. Each seam centre was then refined automatically. At 8 to 28 points along each line, I took a perpendicular profile of B−R (seams are blue, wood is orange), used its weighted peak, and fitted a line by PCA. The worst residual was 3.8 px.
2. The fitted lines were intersected to get 8 grid vertices per frame: two rows of 4 vertices, covering 3 tiles in `0142` and 2 tiles by 3 rows in `0154`. These were mapped to world points (i, j) in tile units.
3. A homography H was fitted by DLT. The worst reprojection error was 1.73 px (`0142`) and 0.52 px (`0154`).
4. Focal length came from H, assuming a centred principal point and square pixels. Rotation columns r1 and r2 must satisfy two constraints: (a) orthogonal, and (b) equal length, which means the tiles are square. Each constraint gives its own f, and the least-squares combination gives f_LS.
5. The noise sensitivity was checked with 60 Monte-Carlo runs at σ = 1.5 px per vertex.
6. One cross-check used the horizon: the vanishing line predicted by H against the sea/sky edge observed in `0154`.
7. A second cross-check used the free-aspect solution (fx ≠ fy). It came out ill-conditioned, so I rejected it.

| Frame | orthogonality vFOV | squareness vFOV | LS vFOV | hFOV (16:9) | camera height | optical axis below horizon |
|---|---|---|---|---|---|---|
| M4AhtY9BB1I_0142 | 81.9° | 64.1° | **74.2°** (MC sd 1.3°) | 106.7° | 1.008 tile | 51.5° |
| M4AhtY9BB1I_0154 | 73.8° | 85.3° | **80.1°** | 112.4° | 1.055 tile | 28.1° |

In the two frames, the two constraints disagree in opposite directions. That points to measurement and model error rather than a real lens difference, so I average them. The cross-check fits within the range. In `0154`, the H-predicted vanishing line crosses the centre at y = 98 px, against an observed horizon at 109 px (20.2% of H). The observed horizon together with the homography pitch gives f = 302 px, which is a vFOV of 83.6°.

## Observations / spec

- **C1 FOV.** Raft's gameplay camera has a vertical FOV of about **77° (likely range 74–80°; outer bound 64–85°)**. At 16:9 that is a horizontal FOV of about **109°**. Evidence: `M4AhtY9BB1I_0142` and `M4AhtY9BB1I_0154`, with the method above. Unity FOV is vertical (from memory, unverified). Video makers may have changed their FOV settings, but both frames come from one video.
- **C2 Eye height vs tile.** Raft's eye sits **1.01–1.06 tile widths** above the deck surface (C1 table). If a Raft foundation is about 1.5 m (from memory, unverified), the eye height is about 1.51–1.58 m.
- **C3 Eye height vs other characters.** In `store_16`, the horizon is at y = 128–130 px of 720. Points at the camera's height project onto the horizon, so you can read off where the horizon cuts a standing character. I corrected for pitch with `people.py`, which sweeps f across 300–800 px. The horizon cuts the near girl at **0.88–0.93** of her height (feet y = 432, hair top y = 79) and the far fisherman at **0.82–0.84** (feet 227, hair top 105). The player camera therefore sits at roughly **0.82–0.92 of a standing character's height**, about where that character's eyes would be or slightly lower.
- **C4 Horizon while building.** Six frames with a clean horizon fit (residual sd ≤ 1.5 px, or close agreement between 2 columns) put the horizon at **16.4%H** (`YSMrrtHtpIc_0745`), **16.6%H** (`YSMrrtHtpIc_0430`), **20.0%H** (`store_16`), **20.2%H** (`M4AhtY9BB1I_0154`), **20.0%H** (`Dle8DwL05lw_0450`) and **23.5%H** (`Dle8DwL05lw_1130`). That is a median of about 20%H, which means players build and farm looking **about 22–29° down** at vFOV 77°. In frames where the player is looking around, the horizon sits near the middle: `store_11` 57.7%H, `9vVu3idmeV4_0736` 50.6%H, `qVVltzNBaGw_0025` 46.7%H. When placing foundations, players look down about 51° (`M4AhtY9BB1I_0142`, C1 table). `Dle8DwL05lw_0240` (horizon at about 1%H) and `Dle8DwL05lw_0800` (horizon above the frame) are also steep.
- **C5 No camera roll.** The fitted horizon tilt is **0.05°** (`YSMrrtHtpIc_0745`), **0.02°** (`M4AhtY9BB1I_0154`), **−0.04°** (`Dle8DwL05lw_1130`) and **−0.70°** (`9vVu3idmeV4_0736`, over a short 270 px span). Even on a raft at sea, the horizon stays level within about 0.1° in 3 of 4 clean frames.
- **C6 Viewmodel framing (tools).** The held tool sits hard against the right edge, and only **one (right) hand** shows. In 8 of 8 tool frames checked, no left hand is visible: `M4AhtY9BB1I_0142`, `store_11`, `store_16`, `68lj91mBrDI_0009`, `iVT88Yq-PU0_0044`, `YSMrrtHtpIc_0430`, `Dle8DwL05lw_0450`, `9vVu3idmeV4_0200`. The measured boxes, in % of the screen:
  - Hammer head: x **80–100%W**, y **19–62%H** (`M4AhtY9BB1I_0142`); x 82–100, y 22–67 (`store_16`); x 82–100, y 25–60 (`iVT88Yq-PU0_0044`).
  - Hammer hand: x 85–100%W, y 82–100%H, cut off by the corner.
  - Hook: x **76–92%W**, y **25–80%H**, with the hand at x 76–92 and y 83–100 (`store_11`). In `68lj91mBrDI_0009`, the hook is at about x 75–90 and y 25–68.
  - The tool spans **about 40–45% of the screen height** above the hand. Together with the hand, it fills roughly the right fifth of the screen from 20%H down to the bottom edge.
- **C7 Strike pose.** In mid-strike (`YSMrrtHtpIc_0430`), the hammer head swings in to x **50–68%W**, y **37–53%H**, close to the crosshair, and the hand moves to x 56–63%W, y 83–92%H. An empty hand pointing at a placement does the same: it reaches from the bottom-right toward the crosshair, to about 53%W, 62%H (`9vVu3idmeV4_0736`) or about 52–75%W, 55–100%H (`9vVu3idmeV4_0200`).
- **C8 Idle stability.** I sampled the white hook grip in `68lj91mBrDI_0036..0149`: 8 frames over 1:13 of standing at a table, 3–9 s apart. The top of the grip stays at **38.3–41.5%H** (a 3.2%H spread) and x at 88–94%W. The idle sway is therefore at most about ±1.6%H, and the viewmodel stays fixed to the screen while the view rotates.
- **C9 Near plane.** In `YSMrrtHtpIc_0530`, the camera stands about 0.5 m from a wall (an estimate) and the wall shows no clipping or see-through. In `9vVu3idmeV4_0736`, the hand draws cleanly over the wall it points at. No frame shows world geometry cutting through the viewmodel.
- **C10 Head bob.** This cannot be measured. The frames are 3–6 s apart (see the timing note). From memory, unverified: Raft has a mild vertical bob with a small viewmodel bob when walking, and no FOV kick when sprinting.

## Comparison with Little Raft today

- **FOV.** `dist/game.js:284` creates the camera with `PerspectiveCamera(running ? 70 : 48, aspect, .05, 200)`. `dist/game.js:714` then sets the vertical fov to `options.fov` while playing. The default is **75°** (`dist/settings.js:10`, `:15`; `dist/game.js:184`), with a slider from 60 to 95. At 16:9 that gives an hFOV of 107.4°. This **already matches C1** (74–80°). The welcome screen uses 48°. Resize keeps vFOV fixed (Hor+) at `dist/game.js:915`, which is fine.
- **Eye height.** `EYE_OFFSET = 1.6` appears at `dist/game.js:37` and `dist/player-physics.js:13`. The deck top is at `FLOOR_Y = .2` (`dist/game.js:37`), and a tile is **2 m** (`dist/deck.js:3`, `x * 2`; spawn test ±0.95 at `dist/game.js:224`). The eye/tile ratio is **0.80**, against Raft's 1.01–1.06 (C2), so Little Raft's tiles look about 25–30% bigger relative to the player. The avatar's eyes are at about 1.65 m and the hair top at about 1.79 m (`dist/avatar.js:5`, `:102–105`), so the camera sits at **0.89** of the avatar's height. That matches C3 (0.82–0.92).
- **Pitch.** The spawn pitch is −0.28 rad, or −16° (`dist/game.js:187`), which puts the horizon at about 31%H at 75°. The limit is ±1.35 rad, or 77° (`dist/game.js:38`, `:463`). Both are compatible with C4 (51° down when placing).
- **Head bob.** At `dist/game.js:716`, `bob = sin(walkPhase) * .025 * cameraMotion`. The default `cameraMotion` is .35, so the amplitude is **8.75 mm**, vertical only, with no lateral sway. `walkPhase` advances at `9 * min(1.6, speed/2.6)` rad/s (`dist/game.js:689`), which is **1.43 Hz** walking and **2.2 Hz** sprinting. The viewmodel bob in `dist/hands.js:228–232` runs on wall-clock time instead: `ph = t·2π·0.85` and `bob = ½−½cos 2ph`, a fixed **1.7 Hz** at any speed. **Head and hands are not phase-locked**, so they drift in and out of sync, and the hands ignore sprint.
- **Roll.** `dist/game.js:718` sets roll to `raft.rotation.z * CAMERA_ROLL(.2) * cameraMotion` while grounded, which is a fraction of the raft's roll. Raft keeps the horizon level (C5). The effect here is small (about 0.07 × raft roll) but non-zero.
- **Viewmodel placement.** I projected the meshes with `node/proj.mjs` at the default pose, fov 75, 16:9.
  - The right fist base is `(.38,-.32,-.80)` and the left is `(-.34,-.35,-.70)` (`dist/hands.js:130–131`). They project to about **67%W, 76%H** (right) and **32%W, 83%H** (left).
  - The hammer tool covers x **66–76%W**, y **47–86%H** (`dist/game.js:321–330`, `holdable(... scale:.6)`). The hook covers x 57–72%W, y 47–84%H.
  - Against C6, the tool is about 15 points of width further toward the centre, its top is about 25 points of height lower, it is about half as wide, and **both arms show**: the left arm and rope coil appear for the hammer and rod too, at x 0–37%W, y 77–100%H. `createHands` always builds both arms and the coil (`dist/hands.js:130–131`, `:155–184`).
- **Viewmodel FOV.** The hands are children of the world camera (`dist/game.js:343`), so the FOV slider rescales them.
  - At fov 60, the hammer covers x 71–84%W, y 46–97%H.
  - At fov 95, it shrinks to x 61–68%W, y 48–75%H. That is about **2× in screen size across the slider**.
- **Near plane.** The near plane is 0.05 m and the far plane 200 m (`dist/game.js:284`). The viewmodel draws after a depth clear (`dist/game.js:336–344`), so the world never clips the hands. That matches C9, and no change is needed.
- **Strike.** The hammer reuses the hook's throw curve through `casting:swing` (`dist/game.js:730`; `dist/hands.js:219–223`: `rpx −0.12a`, `rpz −0.24a`). It sweeps forward, but I did not measure how close to the crosshair it gets.
- **Idle sway.** The idle term is `0.0045·amp·br` (`dist/hands.js:244`), which is about 0.4%H. That is well inside C8's ≤1.6%H, so no change is needed.

## Ranked change list

1. **Lock the viewmodel's apparent size against the FOV slider.** (`dist/game.js` `updateCamera`, at the point where `camera.fov` changes, line 714.) Set `k = tan(fov/2) / tan(75°/2)` and apply `group.scale.set(k, k, 1)` to `hookHands`, `hammerHands` and `rodHands`. Scaling only x and y about the eye keeps the hands' screen box identical at any FOV. The alternative is to render the hands with a fixed 70–75° projection. Impact: H, because the 60–95° slider currently halves or doubles the hands. Effort: S.
2. **Anchor tool viewmodels to the bottom-right corner, larger.** (`dist/hands.js:130` right `basePos`; `dist/game.js:321–330` `holdable` scale.)
   - Target at 16:9: the fist at about 85–90%W, 88–95%H, partly cut off by the frame.
   - The tool should rise to about 20–30%H and fill about 80–100%W. Currently the hammer covers 66–76%W, 47–86%H.
   - Derive `basePos.x` from `camera.aspect` on resize, so the hand stays at the same screen fraction on 4:3 and on ultrawide screens.
   - Keep Little Raft's own hand and tool art.
   - Impact: H, because it frames the world and gets the tool away from the crosshair and hotbar. Effort: M.
3. **Show one hand for the hammer and rod.** (`dist/hands.js` `createHands`: add an option such as `{leftArm:false}` that skips `L` and the coil; `dist/game.js:330`, `:332` pass it.) Keep the two-handed rope coil only for the hook, since that pose is Little Raft's own. Impact: M, because it clears about 37%W × 23%H of the bottom-left. Effort: S.
4. **Phase-lock head bob and hand bob to one stride clock.** (`dist/game.js:689`, `:716`; `dist/hands.js:228–232`.)
   - Pass `walkPhase`, or a 0–1 stride value, into `hands.update`.
   - Run vertical bob at 2× stride frequency and lateral sway at 1×.
   - Default vertical amplitude: about 1.5–2 cm at `cameraMotion` .35. Today it is 8.75 mm. Add about 0.8 cm of lateral sway.
   - Scale both with speed so sprinting reads faster.
   - Keep the "Camera motion" slider as the master control.
   - Impact: M, because the walk feel improves and the two motions stop drifting apart. Effort: S. The Raft amplitude is unverified (C10).
5. **Bring the hammer strike to the crosshair.** (`dist/hands.js:219–243`, using a hammer-specific curve when the tool is not the hook.) At the peak of the strike, the hammer head should reach about 55–65%W, 40–50%H (C7), then return in about 0.3 s. The current swing decays at `swing -= dt*3`, about 0.33 s (`dist/game.js:723`). Impact: M. Effort: S–M.
6. **Keep the horizon level.** (`dist/game.js:41`, `CAMERA_ROLL = .2`.) Set the default roll to 0. If you keep it, offer it only at high "Camera motion" values (> 0.7), capped at ±0.3°. Raft's horizon tilt is ≤ 0.05° in 3 of 4 frames (C5). Impact: L–M, for comfort on a rocking raft. Effort: S.
7. **Keep the 75° default vFOV and the 60–95° range.** (`dist/settings.js:10`, `:15`.) Optionally, show the horizontal equivalent in `fmt`, for example "75° (107° horiz.)", so players coming from horizontal-FOV games are not confused. Impact: L. Effort: S.
8. **Leave the near plane and depth-clear viewmodel as they are.** (`dist/game.js:284`, `:336–344`.) They already meet C9. Impact: none (keep). Effort: none.
9. **Eye/tile scale: do not change for now.** (`dist/game.js:37`, `dist/player-physics.js:13`.) EYE_OFFSET 1.6 m already matches the eye/body ratio (0.89 against 0.82–0.92). Matching Raft's eye/tile ratio of about 1.03 would need tiles of about 1.55 m, or an eye height of about 2.06 m. Both would touch deck, physics and the save format. Revisit only if the deck feels "too big". Impact: L. Effort: L.
10. **Optional: raise the pitch limit.** (`dist/game.js:38`.) Raise PITCH_LIMIT from 1.35 to about 1.48 rad (85°), so players can look straight down to place a tile under their feet. Raft frames reach at least 51° down (C4). Impact: L. Effort: S.

## Open questions / UNSURE

- The **FOV comes from one video** (`M4AhtY9BB1I`), where the player may have changed the FOV setting, and the two constraints disagree by up to ±10°. A third grid frame from another channel would tighten it. `iVT88Yq-PU0_0120` and `store_16` have seams, but they are irregular or have no clean cross-lines.
- The **tile size in metres** (1.5 m) and **Unity's vertical FOV convention** are from memory and unverified. That makes C2's height in metres unverified too. The ratios themselves were measured.
- **Head bob amplitude and frequency** cannot be measured from frames 3–6 s apart. A 30 fps clip of walking would settle it.
- `store_16` assumes both characters stand on the deck plane at the camera's floor level. If the fisherman stands on a lower foundation, his 0.82 is biased low.
- I did not check how Raft frames the viewmodel on 4:3 or ultrawide screens. All samples are 16:9, plus one 16:10 (`2rqSgyWX6N0`).
