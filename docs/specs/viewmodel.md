# Viewmodel spec: first-person held items and hands

Scope: how Raft (Redbeet Interactive) frames the first-person held item and hand, studied for framing and feel only. It covers screen position, size, crop, grip, arm and sleeve visibility, apparent size against screen height, idle sway, swing poses and the empty pointing hand used for placeables. This spec does not propose copying Raft's item models, textures or hand art. Little Raft keeps its own procedural meshes (`dist/hands.js`, `dist/hook.js`, `dist/hammer.js`, `dist/fishing-tool.js`).

Method: I opened every image below with the Read tool. Boxes were read off native-resolution views and 5% / 10% grid overlays made with Pillow (`scratchpad/viewmodel/tools/grid.py`, plus the contact sheets `sheet1.jpg` and `sheet2.jpg`). Precision is about ±1% on native views and ±2% on the grid sheets, which are marked (g). All boxes are `x left–right, y top–bottom` in % of the frame, with the origin at the top left. The crosshair sits at (50, 50) in every frame. Hex colours are the median of a 7x7 patch.

Little Raft numbers come from projecting the real meshes rather than estimating them. `scratchpad/viewmodel/tools/project.mjs` imports `dist/hands.js`, `hook.js`, `hammer.js` and `fishing-tool.js` with the vendored three.js. It builds the three viewmodels exactly as `dist/game.js` `buildViewmodels()` does (`holdable` included), then projects every vertex through a 16:9 PerspectiveCamera.

## Images examined

Ranked selection from `references/raft/viewmodel/SELECTED.md`:
- Hook: `stills/steam/store_11.jpg` (1280x720), `stills/press/2018-06-11-raft-update-1-02-02.jpg` (1270x712, FOV slider 50), `stills/steam/community_097.jpg` (looking down), `inventory-crafting/yt/68lj91mBrDI_0009.jpg` (inventory open), `stills/steam/community_119.jpg` (scrap hook)
- Hammer: `building/yt/M4AhtY9BB1I_0142.jpg` (960x540), plus `_0118`, `_0148` and `_0154`; `building/yt/iVT88Yq-PU0_0004.jpg`, plus `_0020`, `_0028`, `_0032`, `_0040` and `_0044`; `stills/steam/store_16.jpg`
- Hammer swing: `building/yt/YSMrrtHtpIc_0315.jpg` (960x540), `building/yt/2rqSgyWX6N0_0330.jpg` (960x600)
- Rod: `inventory-crafting/yt/qdWZgcjkYNI_0410.jpg`, `stills/steam/community_084.jpg`
- Other tools: `stills/steam/store_02.jpg` (machete), `stills/steam/store_06.jpg` (spear), `stills/steam/store_22.jpg` (axe, lifted), `stills/steam/community_087.jpg` (spear while swimming)
- Consumables and items: `stills/steam/community_086.jpg` (cup, 1280x800), `stills/steam/community_115.jpg` (bottle), `farming/yt/Dle8DwL05lw_0450.jpg` (beet)
- Pointing hand: `building/yt/9vVu3idmeV4_0736.jpg`, `inventory-crafting/yt/qVVltzNBaGw_0250.jpg`, `stills/steam/community_032.jpg` (sleeve)

That is 31 frames. Code read: `dist/hands.js`, `dist/game.js` (lines 183-345 and 700-740), `dist/hammer.js` (grip constants), `dist/settings.js` (FOV range). I also read the branches `origin/wip/fleet/viewmodel` and `origin/wip/tech/viewmodel` with `git show` and `git diff` only.

## Observations (Raft)

**C1. Every one-handed tool anchors at one lower-right spot.** The fist centre sits at x 81–84%, y 88–93% in all tool frames:
- hook in `store_11`: hand x 75.9–91, y 83–100
- rod in `qdWZgcjkYNI_0410`: x 75.2–88.5, y 85.6–100
- machete in `store_02`: x 75.6–89.8, y 85–100
- bottle in `community_115`: x 73.8–93, y 87.5–100 **[VERIFIED]**
- hammer in `M4AhtY9BB1I_0142`: x 85–100, y 82–100

Five frames are listed (the original said n=9). The hand box centres for hook, rod, machete and bottle are x 82–84, y 91.5–94; the hammer fist is the outlier, with its box centre at about x 92.5, roughly 9% further right, and the right edge crops it. The hand is always cut by the bottom edge, and the wrist and forearm run off-screen below. **[CORRECTED: the original said "the hammer fist is about 3% further right" and "y 88–93". Re-measured `M4AhtY9BB1I_0142` hand x 85.2–100, y 82.4–100, so the centre is about 92.5, which is 9% right of the hook's 83.5. The bottle centre y is 93.75. Only 5 frames are listed, not 9. The other four boxes were re-measured within ±1%: store_11 hand x 76.2–91.4, y 83.6–100; rod x 75.2–88.5, y 85.6–100.]**

**C2. The item sits entirely above the fist and is cut by the bottom edge only through the hand.** On the Plastic Hook in `store_11` the item spans x 76.3–91.4, y 24.7–83.0 (15.1% wide, 58% of screen height), and the hand covers y 83–100. The whole viewmodel, hand included, is 15.5% wide and 75% tall. The tip of the head is nowhere near the top edge, with a 24.7% gap. **[VERIFIED: re-measured at native resolution with a pixel ruler. Orange top y 176 px (24.4%), orange left tip x 976 (76.3%), white canister right edge about x 1178 (92.0%, against the 91.4% stated), dark lower block bottom y 577 (80.2%), and the wooden handle meeting the fist at y about 600 (83.3%). All within ±1%.]**

**C3. The framing is stable across frames, FOV setting and pitch.** Hook top and left edges across four frames:

| Frame | Top | Left |
|---|---|---|
| `store_11` | 24.7% | 75.9% |
| `2018-06-11-...-1-02-02` (FOV slider 50) | 26.4% | 78.7% |
| `community_097` (camera pitched far down at the sea) | 25.5% | 76.2% |
| `68lj91mBrDI_0009` (inventory open) (g) | 24% | 77% |

The spread is 2.4% vertically and 2.8% horizontally. The viewmodel does not tilt with pitch. **[VERIFIED]** The FOV of the other three frames is unknown, so "independent of the FOV slider" is likely but UNSURE. **[VERIFIED: the boxes match the grid sheets within ±1–2%. The `2018-06-11` settings panel shows "50" on the FOV row. Independence from the FOV slider stays UNSURE, as the analyst says.]**

**C4. The hammer is the largest viewmodel and is cropped by the right edge.**
- `M4AhtY9BB1I_0142`: head x 80.1–100 (cut), y 19–64. That is 45% of screen height for the head alone, and the whole viewmodel spans y 19–100. The wrapped handle is near-vertical at x 94–98 (centre about 95.5), from y 67.6 down into the fist at about y 91, so it is almost entirely in the right 6% of the frame. **[CORRECTED: the original said the handle "runs diagonally from (88, 67) to the fist at (93, 92)". The green-wrapped handle spans x 900–945 px of 960 from y 365 to 490, with no diagonal. The head box was re-measured as x 80.4–100, y 18.9 to about 64–66, which confirms that part. A diagonal handle (about (85, 65) to (92, 88)) does appear in `iVT88Yq-PU0_0004`.]**
- `iVT88Yq-PU0_0004`: head x 79.7–100 (cut), y 19.4–65.7. **[VERIFIED]**
- `store_16` (g): head x 88–100, y 25–68, so at idle only about 12% of the head width shows. **[UNSURE: on the grid sheet the dark head shape against the wooden wall starts nearer x 85, and its lower edge is hard to separate from the background. Treat this as x 85–88 to 100, ±3%.]**

**C5. The rod is a thin, near-vertical line.**
- `qdWZgcjkYNI_0410`: rod x 77–82, y 0 (cut by the top edge) to 87, leaning less than 3° from vertical. The line leaves off the top of the screen.
- `community_084` (g): rod x 79–82, y 0–90. **[VERIFIED]**

The rod never crosses the crosshair half of the screen. **[VERIFIED: re-measured at native resolution. `qdWZgcjkYNI_0410`: shaft x 737–753 px (76.8–78.4%) at y 0, side knot to x 790 (82.3%) at y about 130, and the rod enters the fist at y about 465 (86.1%). Lean is about 17 px over 465 px, or 2.1°. Hand x 75.2–88.5+, y 85.6–100. `community_084`: shaft x 1020–1065 (79.7–83.2%), y 0–86.]**

**C6. Bladed and long tools follow the same recipe.**
- Machete in `store_02`: blade x 74.4–83, y 0 (cut top) to 78, fist at the bottom right. **[VERIFIED]**
- Spear in `store_06`: x 60.3–82.8, y 67–100, a diagonal at about 42° from horizontal (tip at 60.5, 67.4; shaft exits near 81, 100). No hand is visible.
- Spear while swimming in `community_087` (g): spear on the same diagonal, and the left hand appears at x 0–25, y 85–100 doing a swim stroke. **[VERIFIED: on the grid sheets the machete band is at x 74–83 from the top to y about 78. The spear runs from (60.5, 67) toward (82, 100), which is 41° at 16:9. The swim hand is at x 0–25, y 85–100.]**

**C7. Small items sit lower and smaller.**

| Item | Frame | Box | Height |
|---|---|---|---|
| Cup | `community_086` (16:10) | x 74.6–86, y 80.4–100 (hand to x 97.7) | 19.6% |
| Bottle | `community_115` | x 73.8–83, y 56–100 | 44% |
| Beet | `Dle8DwL05lw_0450` (g) | x 71–82, y 67–100 | 33% |

Compare 58–81% for the tools (C2, C4). **[VERIFIED (g): cup x 75–85, y 81–100; bottle x 76–83, y 56–92, with the hand below it; beet x 70–82, y 68–100. The bottle's left edge is nearer 76 than 73.8, which is within the ±2% of the grid sheets.]**

**C8. Only the right hand shows by default.** None of the 18 single-tool or consumable frames shows a left hand. It appears only for swimming (`community_087`) and, per SELECTED.md, for the bow, zipline, notebook and piano (not opened here). The left side of the lower screen stays clear for the stat bars, at x 1–16%, y 83–97 in `store_11`. **[VERIFIED for the frames I opened. The bow, zipline, notebook and piano frames were not opened, so that part rests on SELECTED.md only.]**

**C9. The arm shows mostly hand and wrist, with a sleeve only when the outfit has one.** In the tool frames the visible arm is the hand plus 0–5% of wrist, about 15–18% of screen height (`store_11`, `qdWZgcjkYNI_0410`, `store_02`). **[VERIFIED]** On the pointing pose the forearm is long, and in `community_032` a striped sleeve covers it from y 72% down to the corner. `community_119` shows a pale cuff at the wrist (g, about 85, 98). Skin samples:
- `community_097` (1040, 650): #c4805c
- `community_115` (1080, 690): #d6997c
- `9vVu3idmeV4_0736` (600, 420), in shade: #8c5b4c **[VERIFIED: all three hex values were reproduced exactly as the 7x7 median. The striped sleeve in `community_032` and the pale cuff in `community_119` are visible.]**

**C10. Placeables are held as an empty pointing hand, with no item in the hand.** The fingertip lands just below and right of the crosshair:

| Frame | Fingertip | Arm box |
|---|---|---|
| `9vVu3idmeV4_0736` | (52.8, 63.0) | x 52.6–89.6, y 63–100 |
| `qVVltzNBaGw_0250` | (52.9, 65.7) | x 52.9–83, y 65.7–100 |
| `community_032` | (54.9, 65.0) | x 54.9–92, y 65–100 |

Median offset from the crosshair: +2.9% x, +15% y. The arm enters from the bottom-right corner along a diagonal of about 30–35°. **[VERIFIED (g): fingertips read (53, 63), (53, 65) and (55, 65). The arm diagonal in `9vVu3idmeV4_0736` is about 29.5° at 16:9.]** The coloured ghost (green valid, red/pink invalid, per `M4AhtY9BB1I_0148`) carries the preview, and the hand never holds a miniature. **[VERIFIED]**

**C11. Swing poses lift the hammer head to the screen centre.**
- `YSMrrtHtpIc_0315`: head x 43.2–61.5, y 25.4–53.7. The head covers the crosshair. The fist rises to x 51–58, y 70–91.
- `2rqSgyWX6N0_0330` (960x600): head x 51.4–71.7, y 36.3–62.5, fist x 59–70, y 82–92. **[VERIFIED]**

Against idle (C4), the head moves about 30% of screen width to the left and stays the same size or larger. It does not foreshorten. **[CORRECTED: the boxes are verified (g), but the shift is 28–38%, not "about 30%". The idle head centre is about x 90, and the swing centres are 52.4 (`YSMrrtHtpIc_0315`) and 61.6 (`2rqSgyWX6N0_0330`).]**
- Axe lifted in `store_22`: blade x 86–100, y 0–26, cut by the top and right edges, so the lift goes up and off-screen. **[VERIFIED]**

Swing duration cannot be measured because the frames are 6–15 s apart. From memory, unverified: a hammer hit takes about 0.4–0.5 s, and the hook charge pulls the hook back and to the right before a forward throw. **[UNSURE: the timings come from memory only, and the wiki is unreachable.]**

**C12. Idle drift is small.** I tracked the hammer head left and top edges across idle or near-idle frames of one session:
- `M4AhtY9BB1I_0118`, `_0142`, `_0148`, `_0154` (n=4): left 78.8–82.3%, top 19–22% **[VERIFIED]**
- `iVT88Yq-PU0_0020`–`_0044` (n=5): left 78–83%, top 21–25% (g). `_0020` has no build menu open. **[CORRECTED: the original said "all with the build menu open: left 77–80%, top 21–23%". On my grid sheets `_0044` has its head left edge near 83, and `_0028` its top near 24.]**

These ranges include any walk or look motion, so idle sway amplitude is at most about ±2.5% of the screen. From memory, unverified: there is a slow breathing bob and a slight lag on mouse look. **[CORRECTED: the original said ±1.5%. The iVT88 left edge spans about 5%, so the ceiling is about ±2.5%. Both values are upper bounds at grid-sheet precision. The breathing and look-lag claim is UNSURE: it comes from memory, and the wiki is unreachable.]**

**C13. The viewmodel stays drawn under the UI.** The hook stays visible with the inventory and crafting open (`68lj91mBrDI_0009`) and the hammer with the build menu open (`M4AhtY9BB1I_0148`, `iVT88Yq-PU0_0028`–`_0044`). **[VERIFIED]**

## Little Raft today

The numbers below are projected from the real meshes (`project.mjs`) in the idle pose (`update({dt:0,time:0})`) at 16:9.

**L1. The viewmodel is parented to the world camera and inherits the FOV slider.** `game.js:333-342` parents it, `game.js:714` sets the FOV, and the slider spans 60–95, default 75 (`settings.js:10`). Hook height on screen:

| FOV | Hook height | Hook box |
|---|---|---|
| 60 | 48.8% | x 59.0–78.8, y 45.8–94.6 |
| 75 | 36.8% | x 56.8–71.7, y 46.8–83.6 |
| 95 | 25.8% | x 54.8–65.2, y 47.8–73.6 |

The viewmodel shrinks by 47% across the slider range, and the arms stretch toward the corners. The tech branch confirms the same finding. **[VERIFIED: I re-ran `project.mjs` at FOV 60, 75 and 95, and the output matches to 0.1%. My own projection (`skeptic/proj2.mjs`) settles the hands for 120 real frames, uses a YXZ camera at an arbitrary world pose and builds the camera-space transform through `matrixWorldInverse`. It gives the same boxes. Line refs and settings `60–95, def 75` are correct. The tech-branch statement is UNSURE because the brief bars git.]**

**L2. The right fist sits too central and too high.** Base position (0.38, -0.32, -0.80) (`hands.js:131`) projects to (67.4, 76.1) at FOV 75 and to (73.1, 84.6) at FOV 60. Raft's fist sits at about (82, 90) (C1). At FOV 75 the hook's top reaches only 46.8% against Raft's 25%, its centre x is 64% against 84%, and its height is 37% against 58%. **[VERIFIED. These are projections of `basePos`, not of the posed wrist.]**

**L3. The left arm and rope coil always show, for every tool.** The left arm sits at (-0.34, -0.35, -0.70) (`hands.js:132`). The left arm plus coil projects to x 0–37.5, y 77.4–100 at FOV 75 for the hook, hammer and rod alike: all three are built with `createHands` (`game.js:328-332`), and the left arm is never hidden. That puts a second hand over the stat-bar corner, which Raft keeps clear (C8). **[VERIFIED: `hands.js` toggles visibility only on `hookModel` (line 270), and never on the left arm.]**

**L4. The hammer is too small and too central.** It is held through `holdable(..., {ry:PI/2, rz:.2, scale:.6})` (`game.js:330`). At FOV 75 it spans x 65.7–75.8, y 47.0–85.8: 10% wide and 39% tall, with nothing cropped. Raft's hammer head alone is 20% or more wide and 45% tall, and the right edge crops it (C4). **[VERIFIED]**

**L5. The rod is laid diagonally across the screen.** It is held with `{rx:-.15, rz:.6, scale:.55}` (`game.js:332`). At FOV 75 it spans x 38.3–100, y 0.5–100, sweeping over the crosshair half of the view. Raft's rod is a vertical sliver at x 77–82 (C5). **[VERIFIED. The raw extent is x 38.3–103.7, y 0.5–110.3, so it is cropped at the right and bottom.]**

**L6. Placeables and resources show no hands at all.** Only `hook`, `hammer` and `fishingrod` set a group visible (`game.js:726-728`). Selecting a sail, palm, lantern, net, bench or crate (`DECOR_TYPES`, `game.js:27`), a resource or an empty slot leaves the screen without a viewmodel. **[VERIFIED]**

**L7. The hammer swing reuses the hook throw curve.** `swing = 1` (`game.js:634`) decays at 3/s (`game.js:723`), so it lasts 0.33 s. `hands.js:221-250` then pushes the arm forward (-0.24 m z) and slightly up (+0.07 m y), and pitches it -0.75 rad. Projected at `casting .7`, the hammer shrinks to x 51.6–63, y 55.4–73 (18% tall, foreshortened away from the eye). Raft's raised hammer is the same size or larger and sits higher, at y 25–63 (C11). **[CORRECTED: the original said the code pushes the arm "forward and down". At `hands.js:244` the term is `rpy = ... + 0.07*a`, so the arm rises while it pitches forward. The tool ends lower on screen only because of the forward push and the pitch. The 0.33 s duration and the projected box x 51.6–63, y 55.4–73 are verified: a settled re-run that decays `swing` at 3/s gives x 51.6–63.1, y 55.3–72.9.]**

**L8. Hand bob runs on its own clock.**
- Hands: fixed stride of 0.85 Hz (`hands.js:230`), with the bob term `cos(2*ph)` at 1.7 Hz and amplitude 0.012 m, which is about 1.0% of screen height at FOV 75.
- Camera: bob `sin(walkPhase)` (`game.js:717`), with `walkPhase += dt*9*min(1.6, speed/2.6)` (`game.js:689`), about 1.43 Hz at normal walk.

The two drift in and out of phase. **[VERIFIED: `ph = t*2π*0.85` (`hands.js:230`), and the bob term is `0.5-0.5cos(2ph)` at 1.7 Hz with a peak-to-peak of `0.012*wA`, where `wA = walkW*amp` and `amp` is 1 at the default motion 0.35. That is 0.012/1.228 m = 0.98% of view height at z -0.8 and FOV 75. Hand x-sway and roll run at 0.85 Hz. Camera: `walkPhase += dt*9*min(1.6, speed/2.6)` (`game.js:689`) with `WALK_SPEED 2.6` (`player-physics.js:8`), which gives 9 rad/s = 1.43 Hz. Sprint at 4 m/s gives 2.2 Hz. Minor fix: the `sin(walkPhase)` bob is computed at `game.js:716`, and line 717 applies it.]**

**L9. Idle breathing is fine but there is no look lag.** Breathing runs at 0.22 Hz (4.5 s), y amplitude 0.0045 m (about 0.37% of screen) and 0.010 rad pitch (`hands.js:228, 244, 246`), well inside Raft's ±1.5% (C12). Nothing in `main` reacts to yaw or pitch speed. **[VERIFIED: the `update()` params at `game.js:729-733` carry no yaw or pitch.]**

**L10. The viewmodel stays drawn with the inventory open, which matches Raft (C13).** `running` stays true and only `uiBlocked()` gates input (`game.js:231`). The hands have `receiveShadow=false` and sit in the transparent queue (`game.js:341`). **[VERIFIED]**

**L11. The skin and sleeve colours are already in range.** Skin is #c89068 (`hands.js:36`), inside the sampled range #c4805c–#d6997c (C9). The sleeve is #52705e and the cuff #3e5648, and at idle they mostly fall off-screen (right arm box x 65–100, y 70.8–100 at FOV 75). **[VERIFIED]**

**Branch `origin/wip/fleet/viewmodel`.** One `createHands(T)` with `setHeld(kind)`, `setPose('grip'|'point'|'open')`, `ropeAnchor()` and `state`, and a new `dist/held-items.js` (a `HOLD` table and `buildItemModel` for every inventory kind).
- It adds look lag on a `lagRoot` (yaw and pitch rate × 0.012, cap 0.07 rad × motion, smoothing k=9).
- It adds a swap animation: 0.13 s down, 0.26 s up with easeOutBack.
- It shows the left arm only for the hook or left-hand items.
- Its point pose uses `R.pointPos = (0.27, -0.27, -0.60)`, which projects the wrist to about (66.5, 79) at FOV 75.
- It puts decorations as models on the left fist. Raft shows an empty pointing hand instead (C10).
- It keeps the hook throw curve for every strike (scaled by 0.55 for non-hooks).
- It includes `tests/viewmodel.test.mjs`. **[UNSURE: none of the branch content was re-checked, because the skeptic brief bars git.]**

**Branch `origin/wip/tech/viewmodel`.** `docs/tech/viewmodel.md` and `sandbox/viewmodel/` compare four render modes and recommend candidate C: a single pass with its own projection matrix (vmFOV 62) through `onBeforeCompile`, the rig scaled ×0.3 toward the eye, depth squashed to the front 2%, and real `receiveShadow`. It also adds `Spring3` sway, bob and recoil springs (sway k90/c12, bob k160/c18, recoil k220/c16, scaled by `cameraMotion`) and a `vmToWorld` helper for the rope anchor. It does not touch framing or poses. **[UNSURE: not re-checked, because the brief bars git.]**

## Ranked change list

**#1 Fixed viewmodel FOV.** In `dist/game.js` `buildViewmodels()` and the resize handler, adopt tech-branch candidate C (fallback B) with `vmFov` around 60. Route `handPos` through `vmToWorld`. The goal is identical framing at every FOV slider value; today the hook is 48.8% tall at FOV 60 and 25.8% at FOV 95. Impact H, effort M. **[VERIFIED for the current numbers and code locations. Candidate C and `vmToWorld` are branch content that I could not re-check, because git is barred.]**

**#2 Re-anchor the right fist at the lower right, about (82, 90) on screen.** In `dist/hands.js:131`, at vmFov 60 the base position becomes about (0.51, -0.37, -0.80), against (0.38, -0.32, -0.80) today. Raise `TOOL_SCALE` (0.55, `hands.js:15`) or move the hook's grip toward the bottom of its handle so the hook spans about x 76–91, y 25–83. Today it spans x 56.8–71.7, y 46.8–83.6. Add a projection test (like `project.mjs`) that asserts these boxes ±3%. Impact H, effort S. **[VERIFIED: (0.51, -0.37, -0.80) at FOV 60 and 16:9 projects to (81.1, 90.0).]**

**#3 One hand by default.** In `dist/hands.js` `update()`, hide or dip the left arm and coil for the hammer, rod, placeables and items. For the hook, keep the coil below the frame at idle and raise it only while charging, while the hook is out, or while reeling. The fleet branch's `usesLeft` is a start, but it still shows the coil at hook idle. This frees the stat-bar corner, which is covered at x 0–37.5, y 77–100 today. Impact H, effort S. **[VERIFIED]**

**#4 Make the hammer big and let the right edge crop it.** In `dist/game.js:330`, change `holdable` scale from 0.6 to about 0.9–1.0 and move it right so the head spans about x 80–100+ and y 19–64 (head about 45% of screen height). The handle should drop steeply into a fist at about x 85–100, y 82–100, mostly in the right 10% of the frame. Today the hammer is 10% wide and 39% tall at x 65.7–75.8. Impact H, effort S. **[CORRECTED: the original said "handle diagonal into the fist at about (93, 92)". `M4AhtY9BB1I_0142` shows a near-vertical handle at x about 95.5 (C4). The rank is unchanged.]**

**#5 Empty pointing hand for decorations and placeables.** In `dist/hands.js`, add a `point` pose using the fleet branch's finger sets, but put no model in the hand. Aim the fingertip at about (53, 64), which is +3% x and +15% y from the crosshair, with the forearm running to the bottom right (box about x 53–90, y 63–100). Show it whenever `DECOR_TYPES.includes(kind)` (`game.js:726-728`). The existing ghost (`game.js:809-812`) stays the only preview. Impact H, effort M. **[VERIFIED. This is an original-style pose with no Raft art.]**

**#6 Upright rod.** In `dist/game.js:332`, change `rz` from 0.6 to about 0.05–0.1 and `rx` from -0.15 to about -0.05, so the rod reads as a vertical sliver at about x 77–82 that runs off the top edge. Today it spans x 38–100. Impact M, effort S. **[VERIFIED]**

**#7 Hammer strike pose separate from the hook throw.** In `dist/hands.js`, add a `strike` param or `kind`. Lift the head up and left so it covers about x 45–65, y 25–55 near the crosshair, at the same or larger size, then chop down. Suggested timing, from memory: 0.12 s raise, 0.12 s hit, 0.2 s recover. In `game.js:723`, decay `swing` over about 0.45 s for the hammer. Impact M, effort M. **[UNSURE: the target timings come from memory. The code refs are verified.]**

**#8 Drive the hand walk bob from the camera's `walkPhase`.** Pass `walkPhase` into `hands.update()` (`game.js:729-733`) and use it in place of the fixed 0.85 Hz `ph` (`hands.js:230`), so hand and camera bob share one rhythm. Keep the amplitude at 1% of screen or less. Impact M, effort S. **[VERIFIED: 1.7 Hz against 1.43 Hz at walk and 2.2 Hz at sprint. The two never lock.]**

**#9 Look-lag sway.** In `dist/hands.js`, take the fleet branch's `lagRoot` (yaw and pitch rate × 0.012, cap 0.07 rad × motion) or the tech branch's `Spring3` sway (k90/c12). Keep total idle and lag excursion within about ±1.5% of the screen at the default `cameraMotion` 0.35 (C12). Impact M, effort S. **[UNSURE: the C12 ceiling is corrected to ±2.5%, so ±1.5% is a conservative target and does not need to change. The branch parameters were not re-checked.]**

**#10 Lower and raise on hotbar swap.** Use the fleet branch's 0.13 s down and 0.26 s up with easeOutBack in `dist/hands.js`, and switch the model while it is below the frame. Impact M, effort S. **[UNSURE: the branch timings were not re-checked, because git is barred.]**

**#11 Hold small items lower and smaller.** For resources, fish and later cups or food, use `dist/held-items.js` from the fleet branch with a lower anchor so the item and hand box is about x 72–92, y 56–100 (at most 45% of screen height), against 58–81% for tools (C7). Impact L, effort M. **[VERIFIED]**

**#12 Light the hands with the world.** Candidate C gives sail and roof shadows on the hands, and it removes the transparent-queue hack (`game.js:341`) and the internal `state.buffers.depth.setMask` call (`game.js:338`). Impact L, effort S once #1 lands. **[VERIFIED for the code refs `game.js:338` and `341`.]**

**#13 Keep the viewmodel drawn under the inventory and build UI.** This already happens (L10). Add a regression assertion in the test from #2. Impact L, effort S. **[VERIFIED]**

## Open questions and UNSURE items

- **U1.** Is Raft's viewmodel truly independent of the FOV slider? Only one frame has a known FOV (50, in `2018-06-11-...-1-02-02`), and its framing matches the other three hook frames within 3% (C3). That is consistent with a fixed viewmodel FOV, but not proof.
- **U2.** Swing and throw timings and the look-lag amount are from memory, because the yt frames are 6 s or more apart. A short clip sampled at 10 fps or more would settle C11 and C12.
- **U3.** `store_06` (spear) shows no hand. The hand may be just below the frame, or the shaft may be held further back. I did not use this framing in the change list.
- **U4.** The vmFov 60 base-position numbers in #2 assume a 16:9 view. Ultrawide views push the fist further from the item, so anchor in NDC and derive the position from the aspect at runtime.
- **U5.** With the item fully above the fist (#2), the hook's current grip point (`handleLocal`, `hands.js:144`) leaves about 20% of the hook below the fist. The hook model may need a grip nearer its bottom end. A first try that only offset and scaled the hook (`project_try.mjs`) still cropped its bottom and left the top at 47%.
- **U6.** I opened only the left-hand swim frame from the two-hand set. The bow, zipline, notebook and piano frames in SELECTED.md were not reviewed.

## Verification log

The skeptic pass found 38 VERIFIED, 7 CORRECTED and 7 UNSURE tags.

**Projection.** I re-ran `scratchpad/viewmodel/tools/project.mjs` at FOV 60, 75 and 95 and in swing mode, and every box reproduced to 0.1%. I then checked its camera setup against `dist/game.js` `buildViewmodels()` (lines 323-344):
- The `holdable()` wrapper and its parameters match line for line: `ry PI/2, rz .2, scale .6` and `rx -.15, rz .6, scale .55`.
- The game adds each `h.group` to the camera, so screen position depends only on the camera-local transform and the projection matrix. The script's identity camera at the origin is therefore equivalent.
- The near plane (.05) matches `game.js:284`. The aspect is fixed at 16:9.
- `update({dt:0})` matches the settled idle state because `st.toolW` starts at 1.

The depth-clear marker and material tweaks do not change geometry. An independent script (`scratchpad/viewmodel/skeptic/proj2.mjs`) produced the same boxes within 0.2%. It settles 120 real frames, uses a YXZ camera at an arbitrary world pose, applies `matrixWorldInverse`, and decays `swing` at 3/s for the swing pose. One caveat: the script's "right fist" line projects `basePos`, not the posed wrist.

**Reference images.** I re-measured the hook in `store_11`, the hammer in `M4AhtY9BB1I_0142` and the rod in `qdWZgcjkYNI_0410` at native resolution with pixel-ruler zooms (`skeptic/z.py`). The hook and rod boxes hold within ±1%. The hammer head holds too, but its handle is near-vertical at x about 95.5, not a diagonal from (88, 67). The hammer fist centre sits about 9% right of the hook fist, not 3%. I re-sampled the three skin hexes as 7x7 medians, and all three match exactly.

**Bob frequency.** The claim of 1.7 Hz for the hands against 1.43 Hz for the camera is confirmed from `hands.js:230/232` and `game.js:689`, with `WALK_SPEED` 2.6 in `player-physics.js:8`.

**Not re-checked.** I did not re-check the branch content (`origin/wip/fleet/viewmodel` and `origin/wip/tech/viewmodel`), because the brief bars git.

**Originality.** No change item copies Raft art. All of them are framing and pose numbers on Little Raft's own meshes.

**Re-ranking.** None is needed. #4 keeps its rank, and only its handle description changed.

**Images re-checked.** Native zooms:
- `store_11`
- `M4AhtY9BB1I_0142`
- `qdWZgcjkYNI_0410`
- `community_084`
- `2018-06-11-raft-update-1-02-02` (FOV readout)

10% grid sheets:
- `store_02`, `store_06`, `store_16`, `store_22`
- `community_032`, `community_086`, `community_087`, `community_097`, `community_115`, `community_119`
- `iVT88Yq-PU0_0004`, `_0020`, `_0028`, `_0040`, `_0044`
- `YSMrrtHtpIc_0315`, `2rqSgyWX6N0_0330`
- `9vVu3idmeV4_0736`, `qVVltzNBaGw_0250`, `68lj91mBrDI_0009`, `Dle8DwL05lw_0450`
- `M4AhtY9BB1I_0118`, `_0148`, `_0154`
