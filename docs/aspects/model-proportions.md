# Aspect: model proportions (object size relative to a foundation tile and to the player)

Scope: how big things are compared with one foundation tile and with the player's eye height. That covers tile size and thickness, wall height, floating debris (plank, plastic, palm leaf, barrel), the hook head, rope thickness, character height, crop plot size and island scale. Raft (Redbeet Interactive) images are for internal study only. The change list recommends proportions and readability, not Raft's art.

Method. Images are 960x540 (yt), 1280x720 (steam), 800x450 / 813x451 / 909x508 (press) and 690x541 / 1148x393 (wiki). All coordinates below are source pixels. The scratch scripts are in `scratchpad/model-proportions/` (`cam.py`, `hz.py`, `seg.py`, `sheet.py`). I used three independent rulers:
1. **Ground homography** (first-person yt frames): I clicked foundation-grid intersections, fit a ground-to-image homography, searched focal length for orthonormal rotation columns, and read camera height in tile units.
2. **Horizon rule** (any roughly level camera): the horizon crosses every object at camera height. For a floating object, true width = `w_px / (y_waterline - y_horizon)` x camera height above water. This needs no focal length.
3. **Frontal ratios** (wiki screenshots with walls square to the camera).

Units used below: **T** = one foundation tile edge. **E** = eye height above the deck. **h** = eye height above the water (about E + 0.1 T). **C** = standing character height.

## 1. Images examined

- building/yt: `M4AhtY9BB1I_0142.jpg`, `M4AhtY9BB1I_0154.jpg`, `M4AhtY9BB1I_0148.jpg`, `YSMrrtHtpIc_0315.jpg`, `YSMrrtHtpIc_0530.jpg`, plus contact sheets of all 58 frames (`yt1.jpg`, `yt2.jpg` in scratch).
- stills/wiki-building: `screenshot_foundations.jpg`, `piece-render_foundation.jpg`, `screenshot_wood-walls.jpg`, `screenshot_thatch-walls.jpg`, `screenshot_raised-floor.jpg`, plus contact sheets of all 70 `screenshot_*` (`wb1.jpg`, `wb2.jpg`).
- stills/steam: `store_01.jpg`, `store_10.jpg`, `store_12.jpg`, `store_18.jpg`, `store_22.jpg`, `community_024.jpg`, plus contact sheets of store_01-24 and community_001-150.
- stills/press: `2021-04-01-devblog-46-03.jpg`, `2018-10-11-the-large-island-update-06.jpg`, `2019-02-07-the-domesticated-update-out-now-07.jpg`.

## 2. Observations / spec

**Tile and player**

- **C1. Eye height is about 1.0 tile above the deck (E ≈ 1.0 T; range 0.94-1.25).** Four estimates:
  - `M4AhtY9BB1I_0142.jpg`: homography on 7 armored-foundation grid corners, (243,50) (333,92) (470,153) (672,240) (83,100) (173,170) (308,273), max residual 2.9 px. Best orthogonality at f = 323 px (hFOV about 112°), giving camera height 0.97 T. At f = 450 the result is 1.09 T.
  - `M4AhtY9BB1I_0154.jpg`: 6 corners. Camera height is 1.11-1.25 T for f = 350-600 (the noisier fit).
  - `screenshot_wood-walls.jpg`: horizon y = 215, wall base y = 497, wall top y = 44. Camera is at 0.62 of wall height, which is 0.97 T (see C4).
  - `2021-04-01-devblog-46-03.jpg`: a lone player on the starter raft. The character is y 374→398 (24 px) and the raft is x 429→474 (45 px). If the raft is 2 tiles wide (from memory, unverified), C ≈ 1.07 T and E ≈ 0.99 T.
- **C2. Standing character is about 1.05-1.1 T tall, with the eye at about 0.92-0.93 C.**
  - `devblog-46-03`: as in C1.
  - `store_10.jpg`: the character is 260 px tall (y 203→462) beside a side-on armored edge. Float seams at x = 250, 550, 705, 800, 868 fit a projective ruler (residual ≤ 1.6 px, cross-ratio 1.334 against the ideal 1.333). The local scale is 271 px/tile along the edge, which gives C = 0.85-1.01 T for hFOV 90-110°. The store camera FOV is unknown.
- **C3. Foundation thickness: the deck sits about 0.1 T above the waterline.**
  - `screenshot_foundations.jpg`, solid foundation (right): front edge 375 px wide (x 735→1110). Top face to the bottom of the dark beam is y 190→236 (46 px). Corrected for about 19° view elevation, that is 0.13 T. A white float below continues another 0.2 T underwater.
  - Basic foundation (left): the board slab front face is y 194→218 (24 px), so 0.07 T.
  - Plank count per tile: the solid foundation has 5 planks across (plank width 0.2 T). The basic foundation has 3 slabs: one full-width back board and two square front boards. `piece-render_foundation.jpg` shows 2 cylindrical floats under one basic tile.

**Building**

- **C4. A wall is 1.56 T tall and 1 T wide, which is about 1.6 E.**
  - `screenshot_wood-walls.jpg`: post centres x 68 / 351 | 364 / 650, so the tile edge is about 288 px. Post top y 44 to base y 497 is 453 px. 453/288 = 1.57.
  - `screenshot_thatch-walls.jpg`: post top y 37 to base y 492 is 455 px, over the same tile edge. 455/290 = 1.57.
  - Horizon crossing at 0.62 of wall height gives wall = 1.61 E.
  - A wall has 2 posts, and adjacent walls do not share posts (both images).

**Floating debris** (horizon rule, first-person, h = eye above water)

- **C5. Plank: length 0.81 h (lower bound, since it may be angled), thickness about 0.07 h.**
  - `2018-10-11-…-06.jpg`, horizon y = 208: the plank runs (219,283)→(275,273), which is 57 px at Δ = 70. 57/70 = 0.81 h. It is 5 px thick.
  - `2019-02-07-…-07.jpg`, horizon y = 163: the plank is x 356→411 (56 px) at y ≈ 236, Δ = 73, giving 0.77 h.
- **C6. Palm leaf: about 0.70 h long** (`2018-10-11-…-06.jpg`: (279,258)→(311,252), 33 px at Δ = 47).
- **C7. Barrel (upright): diameter 0.61 h, about 0.36 h above the water** (`2019-02-07-…-07.jpg`: x 610→632 = 22 px, top y 186, waterline y 199, Δ = 36).
- **C8. Plastic chunk: 0.42-0.46 h across.**
  - `2019-02-07-…-07.jpg`: blue piece x 239→255 (17 px) at Δ = 40.
  - `2018-10-11-…-06.jpg`: white piece x 86→108 (22 px) at Δ = 48.
- **C9. Debris size order (largest first): plank > palm leaf ≈ barrel > plastic.** No piece is longer than about 0.9 T. Debris reads as clearly smaller than a tile from the deck (C5-C8 with C1).

**Hook, rope and crops**

- **C10. Hook head (claw) is about 0.10-0.12 C, roughly 0.2 m on a 1.8 m person.** In `store_01.jpg` the left character is 311 px tall (y 271→582). The black and orange claw being swung spans x 345→375, y 262→300 (30x38 px). The coiled rope on the hip is 50x60 px (0.17 C).
- **C11. Rope diameter is about 0.011-0.013 C, roughly 2 cm.** In `store_01.jpg` the rope over the shoulder near (420,330) is 3-4 px against a 311 px character. Rope is a solid shaded tube, not a hairline.
- **C12. Small crop plot: about 0.6 C wide (about 0.55 T), with a front face about 0.17 C tall.**
  - `store_01.jpg`: the box is x 707→930 (223 px), front face y 570→635.
  - It is nearer the camera than the right character (feet y 560, head y 275, horizon y 318). Scaling by horizon offsets (317/242 = 1.31), the character would be 373 px tall at the plot's depth.

**Scene scale**

- **C13. A small island is about 16-28 h wide and 5-9 h tall. Its palms are roughly 1/5 of the island width.**
  - `2018-10-11-…-06.jpg`: island x 356→495 (140 px), top y 174, waterline y 212-218, horizon y 209, so Δ = 5-9 px. Δ is tiny here, so expect about ±40%.
- **C14. Typical first-person FOV in creator footage is wide: hFOV about 94-112°** (from the C1 focal fits; UNSURE).

## 3. Little Raft today

Little Raft values are below. The "Raft-equivalent" column uses E_LR = 1.6 and h_LR = 0.2 + 1.6 − 0.05 = 1.75 m.

| Quantity | Little Raft now | Ratio | Raft (Section 2) |
|---|---|---|---|
| Tile | `player-physics.js:15` TILE_SIZE 2; `deck.js:8` bounds ±1; `game.js:353` `x*2` | E/T = 1.6/2 = **0.80** | E/T ≈ **1.0** (C1) |
| Eye | `player-physics.js:13` EYE_OFFSET 1.6; `game.js:37` EYE_OFFSET 1.6; `avatar.js:158` eyeHeight 1.65 | eye/C = 0.92 (avatar head top ≈1.79, 1.895 with hat) | 0.92-0.93 (C2) ✓ |
| Character | about 1.8 m (measured bbox 0.75 x 1.895 x 0.70 with hat) | C/T = 0.90 | C/T ≈ 1.05-1.1 |
| Deck height | `deck.js:7` FLOOR_TOP 0.2, planks THICK 0.052 (`deck.js:12`), beams r 0.064 (`deck.js:13`) | 0.10 T, 0.125 E | 0.07-0.13 T, about 0.1 E ✓ |
| Planks per tile | `deck.js:141`: 7-8 planks per 2 m (0.25-0.29 m wide) | 0.17 E per plank | 5 per tile (0.2 E) ✓ |
| Build ghost | `game.js:294` BoxGeometry(1.9, .13, 1.9) | n/a | n/a |
| Wall | none. Tallest decor: sail mast 3.8 (`game.js:358`), lantern pole 1.8 | n/a | 1.56 T = 1.6 E (C4) |
| Plank debris | `debris.js:357` fit 1.6; measured 1.53 x 0.16 x 0.30 | 0.87 h | 0.77-0.81 h (C5), slightly large |
| Leaf | `debris.js:358` fit 1.75; measured 1.25 x 0.26 x 1.10 | 0.71 h | 0.70 h ✓ |
| Scrap | `debris.js:359` fit 1.2; measured 0.93 x 0.32 x 0.60 | 0.53 h | not measured |
| Barrel | `debris.js:277` H = 1, rMid 0.435 (diameter 0.87) | 0.50 h | 0.61 h (C7), 18% small |
| Plastic | `game.js:373` createPlastic x 0.85; measured 0.52 x 0.60 x 0.35 | 0.30-0.34 h | 0.42-0.46 h (C8), 25-30% small |
| Hook in world | `game.js:297` `hookMesh.scale.setScalar(.5)`; measured 0.36 x 0.42 x 0.20 | 0.22 C | 0.10-0.12 C (C10), about 2x large |
| Rope | `game.js:296` `T.Line` with LineBasicMaterial, a 1 px hairline at any distance. `rope.js:19` createRope (tube, radius 0.012, `MAX_RADIUS 0.02` at `rope.js:8`) is not imported anywhere | n/a | 0.012 C, about 2 cm solid tube (C11) |
| Crop plot | none. Nearest is the "palm" planter (`game.js:359`), cylinder r 0.38/0.28 x 0.5 tall | 0.42 C wide, 0.28 C tall | 0.6 C wide, 0.17 C rim (C12) |
| Islands | `game.js:300`: 12 islands at 65-90 m; cylinder r 3-5 x 0.8 + sphere r 3.4 + palm x 1.4 (about 2.9 m) | width about 10 m = 5.7 h; height about 4.8 m = 2.7 h | 16-28 h wide, 5-9 h tall (C13) |
| Fog | `game.js:290` ocean fadeFar 125 | n/a | n/a |

Summary: the player and small props are internally consistent. The tile is about 25% too large for the player, so the deck feels like a wide platform rather than a cramped raft. The barrel and plastic are a bit small. The world hook is about 2x oversized. The rope has no physical thickness. Islands are 3-5x too small for their distance.

## 4. Ranked change list

1. **#1 Tighten the tile to player ratio to about E/T = 1.0.** Change TILE_SIZE 2 → 1.6 in `player-physics.js:15` and carry it through everywhere a tile is assumed:
   - `deck.js`: FLOOR_BOUNDS ±0.8, `pitch = 1.6/n` with n = 5-6, beam half-length and beamZ scaled by 0.8.
   - `game.js`: every `x * 2` / `z * 2` (about 17 sites, e.g. `game.js:353`, `game.js:356-357`, `game.js:366`, `game.js:370`), the ghost box 1.9 → 1.52 (`game.js:294`), and `* 2` in spawnPoint and makeItem.

   Keep the eye at 1.6. This change is what makes the deck feel like a crowded raft and gives every other prop its intended scale. As an interim step, 1.75 m (E/T 0.91). Impact H, effort L.
2. **#2 Give the hook rope physical thickness.** Replace the `T.Line` at `game.js:295-296` with `createRope` from `rope.js`, radius 0.010-0.012 (about 0.012 C), and feed `hook.ropePoints` to it. A world-space tube thins naturally with distance and catches light. Keep a minimum on-screen width so it never disappears. Impact H, effort S-M.
3. **#3 Shrink the thrown hook to about 0.11 C.** Change `hookMesh.scale.setScalar(.5)` to about 0.30 at `game.js:297` (giving about 0.22 x 0.25 m). If readability at 15-20 m suffers, add a small bright accent or splash ring rather than enlarging the model. Impact M, effort S.
4. **#4 Rebalance debris against eye-above-water h = 1.75.** Targets:
   - Barrel diameter 0.61 h ≈ 1.05: rMid 0.435 → 0.53, rEnd → 0.45, H 1.0 → 1.15 in `debris.js:277`, and raise its fit to 1.45 in `debris.js:360`. Float it so about 0.35 h ≈ 0.6 m shows above the water.
   - Plastic 0.44 h ≈ 0.77: change scale .85 → 1.15 at `game.js:373`.
   - Plank length 0.8 h ≈ 1.4: change fit 1.6 → 1.4 at `debris.js:357` and thicken the board depth 0.065 → 0.09 at `debris.js:110` (Raft is about 0.07 h).
   - Keep the leaf at 1.25.
   - Order: plank > leaf ≈ barrel > plastic.

   Impact M, effort S.
5. **#5 Scale islands to read as places.** At `game.js:300`, use base radius 3-5 → 14-24 and dome radius 3.4 → 10-14 (height 5-9 h ≈ 9-15 m), with palms at 4-6 m tall (scale 1.4 → 2.5) so a palm is about 1/5 of the island width. Place them at 150-300 m and extend ocean fadeFar 125 → about 260 at `game.js:290` (or give islands their own fog), so they sit on the horizon instead of looking like nearby sandbars. Impact M, effort M.
6. **#6 Fix the wall and building height rule before adding walls.** Wall height = 1.6 E ≈ 2.55 m (1.6 T after #1). One tile wide, with its own corner posts, so adjacent walls double their posts. Floor-above height equals wall height. Add these as constants in a shared module, e.g. `deck.js` exports WALL_H, so crafts and the build ghost agree. Impact M (future building), effort S.
7. **#7 Unify the eye constants.** `avatar.js:158` eyeHeight 1.65 vs `player-physics.js:13` and `game.js:37` 1.6: choose one (1.6) and import it, so the remote avatar's head lines up with where the local camera is. Impact L, effort S.
8. **#8 Crop plot proportions when farming lands.**
   - Footprint about 0.6 C ≈ 1.1 m square (about 0.7 T after #1), with a low rim of 0.17 C ≈ 0.3 m.
   - The existing palm planter (`game.js:359`, 0.5 m tall) is taller than this rim. Keep tall pots for decor and use low wide boxes for crops so crops read at deck level.

   Impact L-M, effort S.
9. **#9 Plank count per tile after #1.** With a 1.6 m tile, use 5-6 planks (`deck.js:141`, n = 7|8 → 5|6) so each board stays about 0.27-0.32 m wide (Raft: 0.2 T). This keeps the grain scale and the "few big boards per tile" readability. Impact L, effort S.
10. **#10 Keep deck thickness as is, in eye units.** FLOOR_TOP 0.2 (`deck.js:7`) is already about 0.12 E, matching Raft's about 0.1 E (C3). When scaling the tile (#1), do not scale FLOOR_TOP or THICK down, because thickness is player-relative. Impact L, effort S.

## 5. Open questions / UNSURE

- **Focal length.** C1 and C2 depend on the camera FOV. The yt focal fits are only moderately conditioned: the orthogonality error is 0.06-0.12 at the optimum, and `M4AhtY9BB1I_0154` predicts the horizon at y 54 against 107 observed. The E/T ≈ 1.0 conclusion rests on four methods agreeing within about ±0.15 T, not on any single one.
- **Wiki screenshots as first-person views.** `screenshot_wood-walls.jpg` is assumed to be a first-person view (no HUD) for the 0.62 horizon reading. If it was a free camera, C4's 1.56 T still holds (it is a frontal ratio) but the 1.6 E does not.
- **Starter raft width.** "The starter raft is 2x2 tiles" and "foundation ≈ 1.5 m" are from memory, unverified. C1 does not depend on them, except for the devblog estimate.
- **Debris lengths are lower bounds.** C5-C8 assume a level camera and objects lying roughly square to the view. The domesticated-07 camera is pitched up about 8° (horizon 163 of 451). Lengths could be up to about 10% longer if a piece is angled away.
- **Raised floor.** `screenshot_raised-floor.jpg` legs look nearer 1.1-1.2 T than 1.56 T, but the view is oblique. I did not resolve whether the raised floor is a shorter piece.
- **Scrap.** Raft scrap was not found floating in the examined images, so scrap size is unspecified.
- **Island width** (C13) rests on a Δ of 5-9 px. Treat it as order-of-magnitude (3-5x Little Raft today).
