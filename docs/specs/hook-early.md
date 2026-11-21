# Spec: hook-early (hook, rope, floating debris, starting raft, shark)

Scope: throwing and reeling the hook, the rope line, which debris floats by and how much, its spacing and drift, the size of the starting raft, and whether a shark is around. This compares the real game Raft (Redbeet Interactive) with Little Raft. The reference images are for internal study only. The change list recommends feel and function changes, never copied art.

Units: screen positions are % of image width (x) and height (y), measured on gridded crops made with the scratchpad venv (Pillow/numpy). Colours are medians of small patches; each gives the image and its pixel coordinates or window. Scratch crops are in `/tmp/claude-0/-home-user-little-raft/357b287e-6b25-59b7-a94d-bb803559ea72/scratchpad/hook-early/`.

Known gaps: none of the images shows the hook mid-flight, the rope going slack while the hook flies, or the reeling animation over time. None shows a clean top-down view of the exact starting raft. Claims about those are marked "(from memory, unverified)".

## 1. Images examined (all paths under references/raft/)

Viewed and measured (SELECTED.md rank in brackets):
- [1] stills/steam/store_01.jpg (1280x720): debris count, taut rope to a hooked barrel, barrel size
- [2] stills/steam/community_097.jpg (1280x720): hook-in-hand box, tiny raft, debris
- [3] stills/press/2021-04-01-devblog-46-03.jpg (909x508): starting state, raft vs player size, debris ring
- [4] stills/wiki-building/screenshot_raft-pre-release-v1-01.jpg: old large hook framing
- [5] stills/press/2018-10-11-the-large-island-update-06.jpg (800x450): spawn view, debris mix, shark shadow
- [6] inventory-crafting/yt/qVVltzNBaGw_0135.jpg (960x540): hook box, plank vs foundation
- [7] inventory-crafting/yt/68lj91mBrDI_0009.jpg (960x540): hook box
- [8] stills/steam/community_087.jpg: shark underwater, early hotbar
- [9] stills/press/2019-02-07-the-domesticated-update-out-now-07.jpg (813x451): debris distances
- [10] stills/steam/store_06.jpg: shark biting the raft edge
- [11] building/yt/YSMrrtHtpIc_0030.jpg: shark under the raft
- [12] stills/wiki-building/screenshot_collection-net-spacing.jpg: top-down shark
- [13] stills/steam/community_134.jpg: debris along the horizon
- [15] stills/press/2018-07-26-update-5-new-building-blocks-shark-balan-04.jpg: plastic vs foundation size
- [19] stills/steam/community_106.jpg: debris in rain
- [20] stills/wiki-items/hook-plastic-inhand.jpg: rope coil on the hook (third person)
- [23] inventory-crafting/yt/qVVltzNBaGw_0030.jpg: horizon debris
- [24] stills/press/2019-02-28-update-9-hotfix-3-01.jpg: debris around a small raft
- [25] building/yt/M4AhtY9BB1I_0100.jpg: barrel in a collection net, +1 pickup toast
- [42] stills/wiki-building/screenshot_triangle-foundations.jpg (600x451): shark length vs foundation
- [44] farming/yt/Dle8DwL05lw_0450.jpg: debris in open water
- [45] stills/press/2021-06-21-update-13-the-renovation-update-out-now-18.jpg: barrel next to the raft
- [47] stills/steam/store_22.jpg: shark fin near a built raft

Total: 23 images viewed, of which 12 were cropped and gridded or pixel-sampled.

## 2. Observations / spec

### Hook in hand (first person)
- **C1 Hook box on screen.** The held hook fills a tall strip at the right edge of the screen. Measured boxes:
  - community_097: x 76-93%, y 25-100%
  - qVVltzNBaGw_0135: x 76-92%, y 26-100%
  - 68lj91mBrDI_0009: x 77-93%, y 24-100%

  Mean: x 76-93% (about 16% wide), y 25-100% (about 75% tall). The bottom is cut off by the screen edge. The head reaches about a quarter of the way down the screen, well above the crosshair row (50%) but right of it. **[VERIFIED]** (re-measured: community_097 orange-pixel mask x 76.2-91.2%, top y 25.6%; qVVltzNBaGw_0135 x 76-92%, y 26-100%; 68lj91mBrDI_0009 x 77-93%, y 24-100%)
- **C2 Grip hand position.** The hand grips the handle low: x 76-90%, y 85-100% (community_097, qVVltzNBaGw_0135). The hook head (the coloured crossbar) sits at x 77-86%, y 25-40%. Its colour is a saturated orange, #aa5a39 (community_097, window x 80-86%, y 30-40%). It sits above a pale wrapped grip, #abb79e (x 86-91%, y 45-60%), and a dark handle, #44463e. **[CORRECTED: the orange head is a diagonal crossbar that spans x 76-91%, y 26-52% (community_097, qVVltzNBaGw_0135), not x 77-86%, y 25-40%. The median of the stated window x 80-86%, y 30-40% is water, #3c564a. A median over orange pixels only gives #b55c3a (original #aa5a39, close). The grip-hand box and the grip colour #abb79e reproduce.]**
- **C3 Pose.** The hook leans about 10-15° right of vertical, with the head angled towards the screen centre (all three frames). Only one hand shows; the free hand is off screen (community_097, 68lj91mBrDI_0009). **[VERIFIED]** (the lean is about 15-17° in qVVltzNBaGw_0135 and closer to vertical in community_097, so read it as 0-17°)
- **C4 Old version.** In the pre-release build the hook was even bigger: x 83-100%, y 33-100% (screenshot_raft-pre-release-v1-01.jpg). So a large, edge-cropped hook has been a constant in Raft. **[VERIFIED]** (re-measured x 1065-1280, y 238-720 = x 83-100%, y 33-100%)

### Rope
- **C5 A taut rope to a hooked item is visible.** In store_01 a straight line runs from the rope coil at the player's hip (52.3%, 55.6%) to the hooked barrel (58.5%, 63.0%). It is 96 px long and has no sag. Against the water it reads as a dark line, #263b47 (darkest pixel, median of 15 samples along it), about 3 px thick at 720p (0.4% of screen height). The barrel is lifted with a splash crown at its top (x 57-61%, y 55-58%). This is the only rope-under-load evidence in the set. **[VERIFIED]** (the line runs from about (669,400) to (749,454) = 96 px. The darkest pixels along it are #123145 to #1c3a52, a little bluer than #263b47 but the same dark read.)
- **C6 Rope colour and the coil.** The rope is a muted tan-brown, not a pale cream:
  - coil on the player: #82664f (store_01, window x 29-33%, y 55-65%)
  - rope in hand: #726553 (store_01, x 33-35%, y 40-47%)
  - coil in hook-plastic-inhand.jpg: #7d6354
  - single strand in hook-plastic-inhand.jpg: #a48b6d

  A big coil (about 0.35x the character's torso height) is worn at the hip or carried, and the line pays out from it (store_01, hook-plastic-inhand.jpg). **[CORRECTED: the colours reproduce only as medians of rope-coloured pixels (window medians include water). Masked re-samples: coil #85674f, rope in hand #7c6957 (at x 33-35%, y 40-47%), in-hand coil #876757, strand #a38769. The coil is about 0.7-0.9x the torso height, not 0.35x: store_01 left player, coil about 70 px against a torso of about 80 px; hook-plastic-inhand, coil about 85 px against about 100-125 px.]**
- **C7 Throw and reel feel (from memory, unverified).** You hold to charge, and a power bar fills. The hook flies in a short arc of roughly 5-15 m. While you hold to reel, the hook skims back across the surface in steady pulls and catches whatever it crosses. The rope sags in flight and goes straight while reeling. **[UNSURE: from memory only, wiki unreachable, and no image shows a throw]**

### Floating debris
- **C8 Items visible per screen.** I counted floating items in normal first-person sea views:

  | Image | Items |
  |---|---|
  | store_01 (staged promo) | 17 |
  | 2018-10-11 | 8 |
  | devblog-46-03 | 8 |
  | community_106 | 9 |
  | community_134 | 9 |
  | hotfix-3-01 | 8 |
  | Dle8DwL05lw_0450 | 6 |
  | domesticated-07 | 6 |
  | community_097 (looking down) | 5 |

  Median: 8 items per screen (n = 9 frames). Range: 5-17. **[CORRECTED: store_01 has about 20 items (17-21, depending on faint horizon specks; 3x zoom count), not 17. devblog-46-03 has 6, not 8 (items at x 322, 400, 502, 546, 586 and 711 px; the left and right thirds are empty). The other 7 counts reproduce within ±1. The median is still 8; the range becomes 5-20. Note that community_106, hotfix-3-01 and Dle8DwL05lw_0450 are late-game rafts, not early-game views.]**
- **C9 Most items are far away.** Most items sit in the 5-10% band of the screen just below the horizon: y 44-50% in store_01 and y 26-36% in 2018-10-11. Only 1-3 are close.

  Distance estimate for domesticated-07: horizon at y 163 px, assumed vertical FOV of 60° (focal length about 390 px) and assumed eye height of 2.0 m. On those assumptions the nearest plank (y 236) is about 11 m away, the small items (y 200-208) 17-21 m, and the barrel (y 192) about 27 m. So the nearest catchable item is typically about 10 m off, and the rest are spread to the horizon. The distances depend on the assumed FOV and eye height. **[CORRECTED: the 2018-10-11 band is wrong. Its horizon is at y 210 px (46.7%), and the items sit at y 207-290 px = 46-64%. y 26-36% is sky. The store_01 band (y 44-50%, horizon at about 44%) reproduces. The arithmetic for domesticated-07 reproduces: horizon at y 163 (gradient peak), plank rows 234-237, 10.7 m at 60°/2.0 m, including the camera pitch of about 9°. Across plausible inputs (vertical FOV 50-80°, eye height 1.6-2.4 m), however, the nearest plank is 6-16 m away. A size cross-check (plank 55 px wide, assuming it is 1.5 m long) gives 10.6 m at 60°, which agrees but rests on the same FOV. "Typically about 10 m" is drawn from one frame. Read it as "roughly 7-15 m".]**
- **C10 Spacing.** Items are scattered singly with no clumps; the gap between neighbours is usually 3-10% of screen width near the horizon (store_01, 2018-10-11). In devblog-46-03, 8 items lie within about 7 raft-widths of the raft. The nearest is 0.7 raft-widths from the raft edge, at (44%, 77%) against a raft spanning x 47.2-52.2%. **[CORRECTED: devblog-46-03 shows 6 items, not 8, and the farthest (x 711 px) is about 5.3 raft-widths from the raft centre, not 7. The nearest item at (400,391) px, 0.64 raft-widths from the edge, reproduces.]**
- **C11 Type mix (observed, n ≈ 45 items over 6 frames; my rough classification).** Plastic is the most common, about 40% (white jugs, white or blue sheets, pink sheets). Planks are about 30%, palm leaves about 15% and barrels about 10%. No free-floating scrap was clearly seen (store_01, 2018-10-11, domesticated-07, hotfix-3-01, community_106, Dle8DwL05lw_0450). **[UNSURE: most items are 5-15 px hazy specks. My re-count could not reliably tell plastic sheets from distant planks, so the shares are not reproducible to better than about ±15 points.]**
- **C12 Sizes relative to a foundation (estimates from perspective).**
  - Plank: about 0.9 of a foundation's length, and about 1/6 as wide as it is long. It floats flush with the water. (qVVltzNBaGw_0135: plank x 4-21% against a nearby tile of about 18% at the same depth.)
  - Plastic sheet: 0.3 of a foundation or less. (2018-07-26: plastic about 5% wide against ghost tiles of about 14% that are farther away.)
  - Barrel: about 0.4-0.5 of a foundation across. It floats upright and half submerged. (store_01: barrel x 56-61% = 67 px; domesticated-07; renovation-18.)
  - Palm leaf: about 0.6 of a foundation, flat on the water (2018-10-11).
  - In the devblog-46-03 overview, the items are 1-1.5% of screen width against a raft of 5%.

  **[UNSURE: the plank ratio reproduces (qVVltzNBaGw_0135 plank about 165 px against a tile of about 170 px), as does plastic (2018-07-26: about 40 px against ghost tiles of about 110 px, at a similar or slightly nearer depth, giving about 0.36). The store_01 barrel is 66 px wide, but no foundation lies at its depth, so the 0.4-0.5 ratio and the palm-leaf 0.6 are perspective guesses that could not be re-derived.]**
- **C13 Debris colours read clearly against the water.**
  - Ocean: #012d51 near (2018-10-11, window x 45-55%, y 70-75%) and #2f91aa in the bright start scene (devblog-46-03).
  - Plank: #8d8977 (2018-10-11) and #8e8576 (domesticated-07). These are desaturated grey-tan from haze.
  - Plastic jug: #b1b5a1.
  - Barrel: #706556 to #7d7364.

  The contrast comes from value (light items on dark water), not from saturation. **[VERIFIED]** (re-sampled: ocean #012d51 exact; devblog-46-03 ocean #288ba6; 2018-10-11 planks #847f6f and #8c846b; domesticated-07 plank #998574; jug #adb4a1; store_01 hooked barrel #7e7363)
- **C14 Drift (from memory, unverified).** Debris drifts past the raft on the current, from ahead to behind, slowly enough that you can walk along the raft edge while you aim. The raft itself drifts too. **[UNSURE: from memory only, wiki unreachable]**
- **C15 Pickup feedback.** Catching or collecting pops a small "+1 Plank" label at the right edge of the screen, at x 87-100%, y 59-63% (M4AhtY9BB1I_0100). **[VERIFIED]** (the toast reads "+1 PLANK" at x 835-960, y 320-343 px)

### Starting raft
- **C16 Raft size.** The starting raft is tiny: about 1.8x the player's height wide (devblog-46-03: raft 45 px wide at x 47.2-52.2%; player 25 px tall at y 73.5-78.5%). In community_097 the raft is about 2 tiles wide and 2-3 deep, with scuffed, broken-edged foundations and light gaps between the plates. It is a 2x2 of foundations (from memory, unverified). Early on, the hook is the only tool in the hotbar (devblog-46-03 slot 1; community_097 slot 1 plus two loot slots). **[CORRECTED: the raft at x 428-474 px and the player at y 373-400 px reproduce (1.8x). community_097 has three filled loot slots (4, 9 and 10), not two. "2x2" stays from memory (UNSURE, wiki unreachable).]**

### Shark
- **C17 Shark presence.** A shark circles close to the raft from the first minutes (2018-10-11: faint underwater shadow at (46%, 74%), #043256 against ocean #012d51, which is barely darker). It also shows under the raft in YSMrrtHtpIc_0030 and near the surface off a built raft in store_22. **[UNSURE: both colours reproduce exactly (#043256 at x 44-48%, y 71-77%; #012d51 at 45-55%, 70-75%), but the 2018-10-11 smudge is too faint to identify as a shark, and "from the first minutes" is inference. In YSMrrtHtpIc_0030 the shark is in open water beside and below the edge of a large raft, not under it. The store_22 fin is confirmed.]**
- **C18 Shark scale.** From top-down views the shark is about 3 foundations long (triangle-foundations: tail (83%, 11%) to nose (97%, 33%) = about 130 px; foundation ≈ 44 px). Because the shark is deeper than the deck, this is a lower bound. **[CORRECTED: the shark's 130 px length reproduces, but a foundation is not 44 px. The square tile cells in triangle-foundations are about 24 px wide (seams at x ≈ 203, 227, 252, 275 px; dark seams repeat every about 48 px). 44 px matches a triangle's base or a 2x2 block. That makes the shark about 5 foundations long (4 if a cell is taken as 32 px). collection-net-spacing gives about 109 px against cells of about 20-22 px (one net hole ≈ 25 px), also about 5. The two shots agree, so they are not inconsistent.]**
- **C19 Shark threat.** The shark bites the raft edge in a lunge with a large splash (store_06) and charges divers underwater (community_087, store_08). It removes foundations and can be driven off with a spear (from memory, unverified). **[UNSURE: the store_06 bite with splash and the community_087 underwater charge are confirmed. store_08 was not re-checked. Foundation removal and the spear deterrent are from memory, wiki unreachable.]**

## 3. Little Raft today (dist/)

- **Hook model.** `hook.js:5-160` builds a curved steel "scrap hook" with a wood handle, about 0.70x0.84x0.40 before scaling. **[VERIFIED]** (`createHook` at hook.js:5; the file is 160 lines)
  - In hand: `hands.js:15` TOOL_SCALE 0.55, giving about 0.40x0.46 m. The right arm base sits in camera space at (0.38, -0.32, -0.80) (`hands.js:131`). At FOV 75 (`game.js:184`) and 16:9, I computed the grip at about x 67%, y 76% of the screen. The hook spans about 37% of the screen's height. This is a computed approximation; the pose offsets were not rendered. The hook is therefore smaller and more central than Raft's 16% x 75% strip at x 76-93% (C1). **[VERIFIED]** (hands.js:15 TOOL_SCALE 0.55 and :131 basePos (0.38,-0.32,-0.80) are correct; my projection also gives x 67.4%, y 76.1%)
  - Thrown hook: scaled 0.5 (`game.js:297`). **[VERIFIED]**
- **Throw.** Charge time is CHARGE_MS 900 with MIN_CHARGE .15 (`game.js:40`). Launch speed is 7 + 11 × charge m/s, plus 1 m/s up (`hook-physics.js:203-205`). Rope length is `maxRange = 16 + durability × .16`, so 16-32 m (`game.js:658`). A full-charge throw at 45° flies about 33 m and is clamped by the tether. This is about 2-3x the reach of the nearest debris in Raft (C9) and of the remembered throw (C7). **[CORRECTED: the constants are at `hook-physics.js:43-45` (BASE_SPEED 7, CHARGE_SPEED 11, UP_BOOST 1), applied at `:93-94`, not `:203-205`; that file has 322 lines. game.js:40 and :658 are correct. maxRange is measured horizontally from the hand (`hook-physics.js:13, 163-167`). Ballistics from a hand about 1.5 m above the water: a full-charge throw at 45° carries about 37 m (not 33 m) before the tether clamps it at 32 m; half charge about 19 m; minimum charge about 10 m.]**
- **Reel.** REEL_SPEED is 8 m/s (`hook-physics.js:209`). CATCH_RADIUS is 1.0 m, or 0.65 m in flight (`:210-211`). Up to 8 items can be caught per cast (`:214`). Reeling is a constant-speed lerp; there is no pull rhythm in the hook motion itself, though the hands do animate pulls (`hands.js:236-238`). Wear is 2 per catch (`game.js:40`). **[CORRECTED: the values are right but the lines are not: REEL_SPEED is `hook-physics.js:49`, CATCH_RADIUS / _FLIGHT `:50-51`, MAX_CAUGHT 8 `:54`; the hands' pull rhythm is `hands.js:235-236` (1.5 Hz).]**
- **Rope rendering.** `game.js:295-296` draws the rope as a 1-px `T.Line` with colour `#e9d39a`, a pale cream, using 16 segments. `rope.js` (`createRope`: 6-sided tube, radius .012, tan #dbbd85/#a1805a, parallel-transport frames) exists but is never imported anywhere (`grep createRope dist/*.js` finds only `rope.js` itself). In the sim, sag is `span × .12 × slack` (`hook-physics.js:456-473`). The slack is 0.15 in flight and 0 once tethered. **[CORRECTED: rope at game.js:295-296 with #e9d39a and 16 segments (ROPE_SEGMENTS, :41) is correct. That rope.js is never imported is VERIFIED: no `import`/`import()` of it in any dist/*.js, and index.html loads only live.js and peerjs. Sag is in `ropePoints` at `hook-physics.js:297-313` (slack at `:305`), not `:456-473`. After the splash, slack is 1 − tension (`:305`, tension set at `:271-275`).]**
- **Debris types and sizes.** ITEM_TYPES are wood, leaf, scrap, barrel and plastic (`game.js:28`). SPAWN_TABLE has 11 entries: wood 3, plastic 3, leaf 3, scrap 1, barrel 1 (`game.js:30`), which is 27/27/27/9/9%. Model sizes from `debris.js:355-358` and `game.js:373`, against a foundation of 2 m (`deck.js:4`):

  | Item | Size | Fraction of a foundation |
  |---|---|---|
  | Plank | about 1.5 m | 0.75 |
  | Leaf bundle | up to 1.75 m | 0.88 |
  | Scrap | 0.95 x 0.65 m | 0.48 |
  | Barrel | 1.0 m tall, 0.87 m across | 0.44 |
  | Plastic jug | 0.65 x 0.85 ≈ 0.55 m | 0.28 |

  Items float at ITEM_FLOAT .05 above the wave (`game.js:41`), sitting on top of the water rather than in it. **[CORRECTED: game.js:28, :30, :41 and :373 are correct; the fit caps are at `debris.js:357-360` (wood 1.6, leaf 1.75, scrap 1.2, barrel 1.25), not `:355-358`. `fit()` (`debris.js:82`) only shrinks a model (scale = min(1, cap/extent)). The barrel is built at 1.0 m tall and about 0.87 m across, below its 1.25 cap. The table sizes were not rendered.]**
- **Density and spacing.** There are 30 items (`game.js:303`, `:948`). `makeItem` (`game.js:370`) places them at x in ±11 m and z from the upwind edge minus 3 to minus 20. For the 3x3 start raft that is z −6 to −23, a band of about 22 x 17 m, so the mean spacing is about √(374/30) ≈ 3.5 m. When you face upwind, nearly all 30 are in view at once, about 4x Raft's median of 8 per screen (C8). In steady state they spread over z −23 to +26 (`game.js:751`), which gives about 5.7 m spacing and about 15 items on the upwind side. **[CORRECTED: game.js:303, :948, :370 and :751 are correct. The spawn band (x ±11 m, since `spread` = max(11, 8); z −6 to −23 m for the 3x3) and 3.5 m spacing reproduce. At spawn, all 30 fall inside the 107° horizontal view facing upwind (one seeded run). A 20,000-step simulation of the drift and respawn rules gives about 11 items upwind of the raft (z < −3) and about 10 in view in steady state, not 15. Steady-state spacing is about 6.0 m.]**
- **Drift.** Items move at +0.22 m/s in z, plus a sway of sin(t·.13)×.04 m/s (`game.js:754`). They respawn upwind when they pass z > maxZ + 24 or touch a tile (`game.js:755`). A collected item respawns immediately (`game.js:560`). The hook copies the same drift (`hook-physics.js:362-363`). **[CORRECTED: the drift is at game.js:754, :755 and :560 as stated, but the hook's drift is at `hook-physics.js:202-203`, not `:362-363`.]**
- **Starting raft.** `newWorld()` creates 9 tiles in a 3x3 grid, each 2 m, so the raft is 6 x 6 m (`game.js:114`). Tiles come from `createFloor` (`deck.js:135`): planks on two logs, FLOOR_TOP .2. The starting bag holds only the hook (`game.js:103`), which matches Raft (C16). The raft itself is 2.25x Raft's tile count (9 against 4) and, at 6 m, about 1.7x Raft's 2-tile width. **[CORRECTED: game.js:114 3x3 with 2 m pitch VERIFIED; deck.js:135 createFloor and deck.js:7 FLOOR_TOP 0.2 VERIFIED. A fresh world's bag is `new Bag()` (game.js:113), and the Bag constructor puts the hook in slot 0 (`inventory-state.js:130`). game.js:103 is the legacy-save path. The 1.7x width depends on Raft's foundation size, which is from memory: with 1.5 m tiles it is 2.0x. UNSURE, wiki unreachable.]**
- **Shark.** There is none. The in-game guide states "Nothing can hurt you, and your raft never sinks" (`game.js:276`). **[VERIFIED]**

## 4. Ranked change list

1. **Render the rope with the existing tube** (`dist/game.js:295-296, 701-705`). Replace the 1-px `T.Line #e9d39a` with `createRope(T, {segments: 16, radius: .012})` from `dist/rope.js`, and darken its tan towards a weathered mid-brown. Raft's rope samples are #726553 to #a48b6d; Little Raft should choose its own value in that dark-mid range so the line reads as a dark stroke on bright water (C5, C6). Impact H; effort S. **[VERIFIED]** (the refs are correct; `createRope` returns `{mesh, update(points, {tension}), dispose}`, `rope.js:19, 131, 224`)
2. **Thin the debris field to about 8-12 visible items, spread to 10-40 m.** In `dist/game.js:303, 948` and `makeItem` at `:370`: lower the count from 30 to about 18-20. Spawn over a wider and deeper band, x ±20 m and z from edge −8 to −45. Keep 1-2 items within 6-12 m so the first throw always has a target (C8-C10). Impact H; effort S. **[VERIFIED]** (the refs are correct, and the C8 median is still 8 after correction. The edit is to `edge` and `spread` inside `makeItem`, which reads `Math.max(11, …)` today. The `side` respawn bound of 26 m at :751 still holds at x ±20.)
3. **Shrink the starting raft to 2x2 tiles** (`dist/game.js:114` `newWorld`). Use tiles [[0,0],[1,0],[0,1],[1,1]] or a centred equivalent, and check `spawnPoint` (`:222-225`) and the save guard `w.tiles.length > 9` (`:98`). A smaller raft makes the first planks feel earned and puts the edge within one step (C16) (from memory, unverified for the exact 2x2). Impact H; effort S. **[UNSURE: the refs are correct (spawnPoint is :222-226), but the 2x2 target is from memory, wiki unreachable]**
4. **Shorten throw reach to match the debris band.** In `dist/game.js:658`, set `maxRange` to about 10 + durability × .08 (10-18 m). In `dist/hook-physics.js:203-204`, use BASE_SPEED 5 and CHARGE_SPEED 8. A full throw then lands at about 12-15 m, where the nearest debris is (C9). Impact H; effort S. **[CORRECTED: the speeds are at `hook-physics.js:43-44`, not `:203-204`. With BASE 5 / CHARGE 8 (13 m/s), a full-charge throw at 45° flies about 20 m and is clamped at 18 m by the new maxRange, not 12-15 m. For a 12-15 m full throw, use about BASE_SPEED 4 and CHARGE_SPEED 6.5 (10.5 m/s: about 14 m full, about 7.7 m half), with maxRange 10 + durability × .08 as a cap. The C9 target band is itself only about 7-15 m.]**
5. **Make the held hook bigger and move it to the right edge.** In `dist/hands.js:131`, move the right arm basePos to about (0.50, -0.42, -0.72), and raise TOOL_SCALE (`:15`) from 0.55 to about 0.7. The tool should then fill about x 75-93%, y 25-100%, with the bottom cropped (C1-C3). Verify with a screenshot at 16:9 and FOV 75. Keep Little Raft's own scrap-hook design. Impact M-H; effort S. **[VERIFIED]** (the refs are correct; the proposed basePos projects the grip to about x 75.5%, y 88%, which matches Raft's grip box x 76-90%, y 85-100%)
6. **Change the debris mix towards plastic and drop free-floating scrap.** In `dist/game.js:30`, use a SPAWN_TABLE of about plastic 4, wood 3, leaf 2, barrel 1, scrap 0-1, and keep scrap mainly as barrel loot (`LOOT.barrel`, `:31`) (C11). Impact M; effort S. **[UNSURE: the refs are correct, but this rests on C11, whose shares could not be reproduced]**
7. **Let items sit in the water, not on it** (`dist/game.js:41` ITEM_FLOAT, and `:764` positioning). Set ITEM_FLOAT to about −0.02 for planks, leaves and plastic so they float flush. Sink the barrel by about 45% of its height so it rides upright and half submerged (C12). Impact M; effort S. **[CORRECTED: the positioning line is `game.js:766`, not `:764`; :41 is correct]**
8. **Give the rope real sag in flight and a taut snap on catch.** In `dist/hook-physics.js:465`, raise the flight slack from 0.15 to about 0.5 and let it fall to 0 when the tether goes tight. When reeling with a catch, keep the rope dead straight (tension 1, already at `:432`). Add a short splash crown when the hook first bites an item (C5) (from memory, unverified for the throw arc). Impact M; effort S-M. **[CORRECTED: the flight slack is at `hook-physics.js:305`, not `:465`; tension 1 while reeling with a catch is at `:272`, not `:432`]**
9. **Add a pull rhythm to the reel.** In `dist/hook-physics.js:372-382` `_stepReel`, multiply REEL_SPEED by a 0.4-1.4 pulse locked to the hands' pull cycle (`hands.js:236`, 1.5 Hz), so the hook surges with each pull (C7, from memory, unverified). Impact M; effort S. **[CORRECTED: `_stepReel` is at `hook-physics.js:212-222`, not `:372-382`, and the pull cycle is at `hands.js:235`. The basis is still UNSURE (from memory).]**
10. **Add an original, gentle predator presence.** Add a new `dist/predator.js`, wired into `dist/game.js` `updateItems` or the frame loop. A dark shape about 3 foundations long circles 6-12 m out at about 1.5 m depth. It is shown as a barely darker underwater silhouette plus an occasional fin (C17, C18). To keep the "nothing can hurt you" promise (`game.js:276`), it should only nudge or steal one floating item now and then, or tug a cast rope, and never destroy tiles. Put it behind a settings toggle. Use our own creature design, not a copy of Raft's shark. Impact M; effort M-L. **[CORRECTED: C18 now puts Raft's shark at about 5 foundations, not 3. "About 3 foundations" is fine as a deliberate gentler choice, but it is not a match. The originality guardrail is satisfied (own creature design).]**
11. **Rescale debris models to the foundation.** Planks are already 0.75 of a foundation, which is fine. Shrink the leaf bundle from 1.75 m to about 1.2 m (`dist/debris.js:356` fit 1.75 → 1.2) and the barrel from 1.25 to about 1.0 (`:358`). The plastic jug at 0.28 is fine (C12). Impact L-M; effort S. **[CORRECTED: the lines are `debris.js:358` (leaf) and `:360` (barrel). Lowering the barrel cap from 1.25 to 1.0 has almost no effect, because `fit()` only shrinks and the barrel is about 0.87 x 1.0 m already. To make it smaller, scale the barrel model directly. Keep only the leaf part.]**
12. **Slow the respawn of collected items.** At `dist/game.js:560`, a collected item reappears instantly upwind. Delay it by 10-30 s, or spawn it beyond the visible ring (at least 30 m), so the sea does not visibly refill (C9). Impact L; effort S. **[VERIFIED]**
13. **Show a pickup line at the right edge.** On collect (`dist/game.js:802` and the 'collect' action), stack short "+2 wood" style lines at about x 85-100%, y 58-64% for 1.5 s, in Little Raft's own UI style (C15). Impact L; effort S. **[VERIFIED]** (a loot notice is already emitted at `game.js:562`; this changes where it appears)

## 5. Open questions / UNSURE

- **Exact Raft throw distance, flight time and reel speed.** The images give no timing (no video frames of a throw). C7 is from memory. Tune #4, #8 and #9 by feel.
- **Starting raft.** "2x2" is from memory. devblog-46-03 only supports "about 2 tiles wide" (1.8x the player's height). Raft's foundation edge length is not measurable from these images; it is about 1.5 m (from memory, unverified). Little Raft tiles are 2 m, so a 2x2 here is 4 m, a bit larger than Raft's.
- **Item distances (C9).** These assume a vertical FOV of 60° and an eye height of 2 m. A wider FOV would make the items closer than estimated.
- **Type-mix shares (C11).** These come from a hand count of about 45 small, hazy items; plastic and paler planks can be confused at a distance.
- **Shark size (C18).** This comes from two top-down wiki shots of uncertain depth. The collection-net shot suggests up to about 6 tiles, which is inconsistent, so I trust the triangle shot. The shark-related changes (#10) depend on the game's no-harm promise; this is a design decision for the owner.
- **Little Raft hook framing.** The screen box in section 3 was computed from `hands.js` constants and not rendered. Take a screenshot before and after #5.
- **store_01 framing.** store_01 shows the rope paying out from a hip coil rather than the hand. It is a staged multiplayer promo, so it may not reflect the single-player first-person view.

## Verification log

Skeptic pass, 2026-11-21. Network blocked: anything that relies on the wiki or on memory is UNSURE.

**Counts (43 tags):** VERIFIED 15, CORRECTED 20, UNSURE 8.
- Claims C1-C19: 6 VERIFIED, 7 CORRECTED, 6 UNSURE.
- Section 3 code bullets: 4 VERIFIED, 7 CORRECTED (mostly wrong `hook-physics.js` line numbers; the values were right).
- Change list: 5 VERIFIED, 6 CORRECTED, 2 UNSURE.

**Most important corrections:**
1. **#4 throw tuning misses its own target.** BASE 5 / CHARGE 8 throws about 20 m at full charge and 45°, not 12-15 m. Use about 4 / 6.5 instead.
2. **C18 shark length.** The tile pitch was misread as 44 px; a foundation is about 24 px, so the shark is about 5 foundations long, not 3. Both top-down shots agree.
3. **C8 / C10 debris counts.** devblog-46-03 shows 6 items, not 8, and store_01 shows about 20, not 17. The median of 8 per screen is unchanged.
4. **C9 placement and distance.** The 2018-10-11 item band was placed in the sky; it is actually y 46-64%. The "about 11 m" nearest-debris figure is arithmetically right but spans 6-16 m over plausible FOV and eye heights.
5. **Line references.** Every `hook-physics.js` line ref was wrong; the file has 322 lines. The correct lines are given inline. The `debris.js` fit lines are off by 2. In #11, changing the barrel cap has no effect because `fit()` only shrinks.

**Ranking:** no re-ranking is needed. #4 keeps its rank with corrected values, and #10 keeps its rank with a size note.

**Originality:** all change items keep Little Raft's own art. #1 picks its own rope colour, #5 keeps the scrap-hook model, #10 asks for an original creature, and #13 uses Little Raft's UI style. No item needed rewriting.

**Method:**
- Re-read the dist/ code with `grep -n` and `sed`. `nl` skips blank lines, so it was not used for line numbers.
- Checked imports across all dist/*.js files and index.html.
- Ran a projection check of the hands.js base positions at a vertical FOV of 75° and 16:9.
- Computed closed-form ballistics with g 9.8, UP_BOOST 1 and the hand 1.5 m above the water.
- Ran a 20,000-step simulation of the makeItem / updateItems drift and respawn rules for the steady-state item counts.
- Images: gridded 2-3x crops and colour sampling (masked and window medians) with the scratchpad venv (Pillow/numpy). Horizon found by vertical gradient; tile pitch from autocorrelation plus visual seam reading.
- Scratch files: `/tmp/claude-0/-home-user-little-raft/357b287e-6b25-59b7-a94d-bb803559ea72/scratchpad/hook-early-skeptic/`.

**Images re-checked:**
- Debris counts: store_01, domesticated-07, 2018-10-11 (large-island-06), devblog-46-03, community_106, community_134, hotfix-3-01, Dle8DwL05lw_0450, community_097.
- Held hook: qVVltzNBaGw_0135, 68lj91mBrDI_0009, raft-pre-release-v1-01.
- Pickup toast: M4AhtY9BB1I_0100.
- Shark: triangle-foundations, collection-net-spacing, YSMrrtHtpIc_0030, store_22, store_06, community_087.
- Sizes and rope: 2018-07-26 update-5-04, hook-plastic-inhand.

**Not re-checked:** community_087 hotbar contents, store_08, renovation-18, qVVltzNBaGw_0030, store_22 beyond the fin.
