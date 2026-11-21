# Building spec: hammer, ghost placement, pieces, snapping, cost display

Analyst topic: **building**. Scope: the hammer build menu, the ghost (preview) piece, foundations, floors,
walls, pillars, beams, stairs, roofs, snapping, valid and invalid colours, and the build cost display.
Decoration placement with an empty hand is noted only where it shares the ghost rules.

Sources are reference stills of Raft (Redbeet Interactive), for internal study only. Nothing here is
an asset to copy. YouTube frame names are `<videoid>_<mmss>.jpg`, where the suffix is minutes and seconds
(for example `_0118` = 1:18 = 78 s). All yt frames are 960x540, except `2rqSgyWX6N0_*`, which are 960x600.
Percentages are of frame width (W) or height (H). Colours are medians of a 9x9 patch, sampled with
Pillow/numpy (scratch work is in the scratchpad under `building/`).

## 1. Images examined

`references/raft/building/yt/`:
- M4AhtY9BB1I_0018, _0030, _0036, _0042, _0118, _0154, _0318
- iVT88Yq-PU0_0020, _0052, _0116
- YSMrrtHtpIc_0100, _0115, _0345
- 2rqSgyWX6N0_0100, _0930
- 9vVu3idmeV4_0436, _0736
- SOURCES.md (captions for all 58 frames, used to locate the frames above)

`references/raft/stills/wiki-building/`:
- piece-render_building-hammer-full.jpg
- screenshot_pillars-supporting-floors.jpg
- SOURCES.md (list of piece names: about 90 piece renders across foundation, floor, pillar, wall,
  roof, stair, fence and ladder families)

## 2. Observations / spec

### Build menu

- **C1 The menu is a single panel in the middle of the screen, opened while the hammer is held.**
  M4AhtY9BB1I_0042: the panel body (fill about #684c34 at (470,160)) runs x 360–558, y 107–413. That is
  37.5–58.1 % W (20.6 % W wide) and 19.8–76.5 % H (56.7 % H tall), so the aspect ratio is about 0.65
  (taller than wide). It sits slightly right of the screen centre (centre x 47.8 % W). The same box
  appears in M4AhtY9BB1I_0030 and _0036. iVT88Yq-PU0_0052 shows the same size, shifted to x 39.6–60.2 % W.
  The world stays visible and unblurred around the panel. The hint "RMB Hold for more parts"
  (M4AhtY9BB1I_0018) shows that the menu opens while the right mouse button is held. Selecting on
  release is from memory, unverified. **[VERIFIED]** (re-measured: left edge x 359/360, top y 107 by gradient; iVT88Yq-PU0_0052 panel x 379–581 = 39.5–60.5 % W, y 107–414; release-to-select stays unverified)
- **C2 There are eight category slots in a vertical column on the panel's right edge.**
  M4AhtY9BB1I_0030 and _0042: slots sit at x 522–556 (about 3.5 % W square, 6.3 % H). Their centres are
  at y ≈ 126, 163, 200, 237, 274, 312, 349, 386, a pitch of about 37 px (6.9 % H). By matching each
  sub-row to the slot it is level with, the order is: 1 foundation/floor, 2 roof, 3 pillar, 4 wall,
  5 triangular (gable) wall, 6 fence/railing, 7 stair, 8 repair/replace.
  **[CORRECTED: order was "foundation, floor, pillar, wall, roof, stair or furniture, floor variants, repair". Evidence: foundation row (M4_0042) and Wooden Floor row (2rqSgyWX6N0_0215) both hang off slot 1; Wooden Roof row off slot 2 (M4_0048); pillar off slot 3 (M4_0024); wall off slot 4 (M4_0036); Triangular Wooden Wall off slot 5 (iVT88Yq-PU0_0040); Plank Fence off slot 6 (iVT88Yq-PU0_0044); Stair off slot 7 (iVT88Yq-PU0_0048). Slot gaps measured at y ≈ 108,145,181,219,256,293,331,367,404, so centres were 125…390 → 126…386, pitch 38 → 37 px]**
- **C3 Hovering a category opens a horizontal sub-row of variants that sticks out to the right of the
  panel.** M4AhtY9BB1I_0042 (foundation row): 7 variants at y 108–143, x 560–808 (25.8 % W).
  M4AhtY9BB1I_0036 (wall row): 5 variants beside the wall slot, plus a 3-slot vertical extension.
  M4AhtY9BB1I_0030 and iVT88Yq-PU0_0052 (repair row): 4 entries, Repair plus three "Replace with …".
  The sub-row always starts level with the hovered category slot. **[VERIFIED]** (foundation row x 560–808 re-measured; 7, 5+3 and 4 entries counted; level-with-slot holds in all 9 menu frames checked)
- **C4 The panel's left part is a detail card.** It shows the piece render at the top (about 12 % H),
  then the name in caps on an underline, then a one-line description, then the cost rows. M4AhtY9BB1I_0042
  has two rows, "PLANK 19/3" and "PLASTIC 15/3". M4AhtY9BB1I_0036 has "PLANK 19/6" and M4AhtY9BB1I_0030
  has "PLANK 19/1". Each row is an icon, a name, and right-aligned **have/need** numbers. The row height
  is about 28 px (5.2 % H), and the rows start about 49 % H down the screen.
  **[CORRECTED: render height "about 12 % H" → about 6.5–11 % H (M4_0042 ≈ 35 px, M4_0030 ≈ 58 px incl. the plus sign, M4_0036 ≈ 55 px); row pitch is 30 px, first row starts at y ≈ 258 = 47.8 % H. Cost text values verified]**
- **C5 Material swap and repair are hammer modes, not separate tools.** iVT88Yq-PU0_0052 shows
  "Replace with thatch". M4AhtY9BB1I_0154 shows the "FORTIFY" label over a foundation, an armour upgrade
  that costs metal and nails. **[VERIFIED]** (chips read 0/1 ingot icon and 11/2 nail icon; M4AhtY9BB1I_0148 caption "Foundation Armor (metal + nails)")

### Ghost (preview) piece

- **C6 The ghost is the real piece mesh, drawn as a flat, bright fill.** The plank seams stay faintly
  visible.
  - M4AhtY9BB1I_0118 (foundation over water): the fill is #bde97a at (420,260) and #bee97b at (520,250).
    Luminance mean is 202, with p5–p95 of only 199–209. The real deck beside it has mean 98.
  - So the ghost is about 2x brighter than lit wood and almost unshaded. Water does not show through,
    so its opacity is high (≥ 0.85, estimated).
    **[CORRECTED: opacity ≥ 0.85 not supported. In iVT88Yq-PU0_0020 the same pillar ghost reads #8ee8b7 over sky (#80f9fa) and #9ad077 over deck (#b79b73), so the background bleeds through; a two-background estimate gives alpha roughly 0.55–0.8 (motion blur makes it loose). Over dark water in M4_0118 the tint just looks opaque. Fill samples #bde97a/#bee97b, luminance 202 with p5–p95 199–209, deck 98–100 all re-measured and verified]**
  - Shapes match the final piece exactly: a beam (M4AhtY9BB1I_0318), a pillar (iVT88Yq-PU0_0020), a stair
    wedge (YSMrrtHtpIc_0115), a floor slab (YSMrrtHtpIc_0345), and a sloped thatch roof with its straw
    detail (2rqSgyWX6N0_0930). **[VERIFIED]** (all five shapes seen in the cited frames)
- **C7 Valid colour is a yellow-green.** It ranges #93d668–#d2e782 depending on light:
  - #93d668 / #98d56d indoors (M4AhtY9BB1I_0318)
  - #96d76f (YSMrrtHtpIc_0115)
  - #abef8a on the roof (2rqSgyWX6N0_0930)
  - #d2e782 / #cfe583 in full sun (YSMrrtHtpIc_0345)
  - #bde97a over water (M4AhtY9BB1I_0118)
  **[VERIFIED]** (re-sampled: #8ed266/#93d768/#98d56d; #97d870/#99d870; #a9f08a/#a8ea86; #d0e380/#cfe583; #bde97a. All within ±4 per channel. Over bright sky a ghost can shift bluer, #8ee8b7 in iVT88Yq-PU0_0020)
- **C8 Invalid colour is a rose red.**
  - #da4268 / #db4167 in M4AhtY9BB1I_0154. That is the "Fortify" upgrade with the cost chip reading
    **0/1** of metal, so **red means unaffordable** as well as blocked.
  - #c42b62 in 2rqSgyWX6N0_0100, a piece blocked by furniture. That frame has a colour filter; the hue is
    still red-magenta.
  - Empty-hand decoration ghosts use the same green/red scheme: green in 9vVu3idmeV4_0736 (#a8ca8b
    sampled on a thin shelf, mixed with background). The 9vVu3idmeV4_0436 caption says pink, but my sample
    at (480,300) hit the deck, so this is unconfirmed.
  - The ghost stays visible when invalid. It turns red; it does not disappear.
  **[CORRECTED: colours re-sampled #dc4268/#db4167 and #c42b62/#c82b56 (verified). Pink in 9vVu3idmeV4_0436 is confirmed after all: thin strokes at the lamp-post base (≈ x 545–720, y 352–479) median #cf648b, mixed with background. But that frame shows an "X Remove" prompt, so it may be a target highlight, not a placement ghost. "Red means unaffordable" is an inference from one frame (0/1 chip on Fortify over an existing tile); it cannot be separated from other block reasons, so UNSURE for that part]**
- **C9 A third, amber highlight marks the piece you are aiming at for removal.** YSMrrtHtpIc_0100 has
  the axe selected in slot 2. The tile reads #e6b767 / #e6b565 against unhighlighted deck #98815b, an
  amber tint at about +50 % luminance. The same tint appears on a stair (YSMrrtHtpIc_0130), a floor seen
  from below (2rqSgyWX6N0_0400) and a railing (YSMrrtHtpIc_0745), according to their SOURCES.md
  captions. That it means "will be removed" is from memory, unverified.
  **[CORRECTED: re-sampled #e2b362–#e4b364 vs deck #98815b; luminance 188 vs 135, about +40 % (was "+50 %"). Amber tint confirmed by pixel count in YSMrrtHtpIc_0130 (#e8b85d), 2rqSgyWX6N0_0400 (#e6b655), YSMrrtHtpIc_0745 (#e1b763), plus YSMrrtHtpIc_0445 and 9vVu3idmeV4_0812. In every one of these 6 frames the axe is the selected hotbar slot, never the hammer, so the amber target belongs to the axe (removal by axe is from memory)]**
- **C10 The ghost follows the crosshair continuously and jumps between snap points.**
  iVT88Yq-PU0_0004 (caption) shows motion blur on a wall ghost sweeping across the deck. No ghost is shown
  when you aim at an occupied foundation with no snap target (M4AhtY9BB1I_0018, iVT88Yq-PU0_0116): only
  the cost chips stay. **[UNSURE: the no-ghost part is verified in both frames. But iVT88Yq-PU0_0004 shows no wall ghost at the crosshair, only a blurred green patch behind the hammer at the right edge (x ≈ 780–900), so "follows continuously and jumps between snap points" cannot be shown from stills]**

### Snapping and pieces

- **C11 Foundations snap edge to edge, one tile out from the raft, over water.** In M4AhtY9BB1I_0118
  the ghost box is x 359–566, y 223–316 (21.6 % W at its near edge). That matches the width of the real
  tile it touches. It is a full square tile with the plank pattern, and it sits flush with deck height.
  **[CORRECTED: box re-measured as x 359–566, y 225–308 (was y 223–316); the near edge meets the real tile's far edge at y ≈ 310. Width 207 px = 21.6 % W verified]**
- **C12 Vertical pieces snap to foundation edges and corners.**
  - Pillars stand on a tile corner and are about 3+ tile-widths tall on screen (iVT88Yq-PU0_0020, the ghost
    runs off the top of the frame).
  - Beams span pillar tops (M4AhtY9BB1I_0318: a T-shaped beam on two pillar stubs, 22 % W wide).
    **[CORRECTED: the two legs are green too, so the whole ghost is a Π shape (bar plus two short legs), not a beam on placed stubs. Green bbox is x 440–603 = 163 px = 17 % W (was 22 % W)]**
  - Walls snap to tile edges (YSMrrtHtpIc_0315 and iVT88Yq-PU0_0104 captions).
  - Upper floors need support from pillars, walls or beams. screenshot_pillars-supporting-floors.jpg shows
    a 4x2 upper floor held by 2 pillars, with the slab overhanging the pillars by about 1 tile.
  **[UNSURE: the pillar ghost in iVT88Yq-PU0_0020 does run off the top. "Stands on a tile corner" cannot be seen (the caption says edge). The wall-to-edge snap is caption-only; YSMrrtHtpIc_0315 shows a wall ghost filling a gap in a wall line. The 4x2 / 2-pillar / about-1-tile overhang count matches the screenshot approximately]**
- **C13 Stairs are a single wedge piece that spans one tile, rising to the next floor.**
  YSMrrtHtpIc_0115 shows the green stair ghost against a wall, next to placed stairs and railings, with
  a cost of 1 plank type. **[UNSURE: the wedge ghost, the placed stair and railings, and the single plank chip are verified. "Spans one tile, rising to the next floor" is not visible in the frame. Note that the menu's Stair entry (iVT88Yq-PU0_0048) costs plank 6 + nail 3, so the one-chip wedge may be a different stair variant]**
- **C14 Roofs snap onto wall tops as a sloped panel** (2rqSgyWX6N0_0930, 2 cost chips: plank and thatch).
  **[UNSURE: the sloped panel and the two chips (plank, leaf) are verified. The frame shows the ghost continuing an existing roof slope; that it attaches to wall tops comes from the caption only]**

### Cost display and hints in the world

- **C15 Cost chips sit just under the crosshair, one per material, as have/need.**
  - M4AhtY9BB1I_0118: two chips with icons at x ≈ 461 and 497, about ±2 % W from centre. The chip
    centres are at y ≈ 318, 48 px = **8.9 % H below the crosshair**. Each chip is about 3 % W wide and
    5 % H tall, an icon over small text ("25/3", "18/3").
  - The same placement shows in M4AhtY9BB1I_0018, M4AhtY9BB1I_0318 (one chip, "60/3"),
    YSMrrtHtpIc_0115 (one chip), and 2rqSgyWX6N0_0930 (two chips).
  - The chips also show when no ghost is visible (M4AhtY9BB1I_0018).
  **[VERIFIED]** (icons at x ≈ 461 / 497, text at y ≈ 325; also seen in iVT88Yq-PU0_0020 and _0116)
- **C16 Contextual key hints sit in one row at the bottom centre.** The row is a keycap
  ("RMB", "R", "MMB") above a short label: "HOLD FOR MORE PARTS", "ROTATE", "BLOCK PICK".
  - Box in M4AhtY9BB1I_0118: x 410–549, y 414–450, which is 76.7–83.3 % H, centred.
  - With three hints the row widens to x 377–580 (21 % W) (YSMrrtHtpIc_0115).
  - "R Rotate" appears only for rotatable pieces. The foundation in M4AhtY9BB1I_0118 shows it; the
    Fortify upgrade in M4AhtY9BB1I_0154 does not.
    **[CORRECTED: the boxes are verified (x 410–549, y 414–450; three-hint row x 377–580). But R is also missing for the beam ghost in M4AhtY9BB1I_0318, while the floor, stair, pillar and roof ghosts show it, so the rule is not determinable from stills. Do not claim "only rotatable pieces". MMB "Block pick" seems to appear when the crosshair is on an existing piece]**
  - Decorations show "R press or hold to rotate smoothly" (9vVu3idmeV4_0736). **[VERIFIED]** (shelf ghost re-sampled at #acd88d–#b5db90)
- **C17 A short text label floats just above the crosshair for special modes.** In M4AhtY9BB1I_0154,
  "FORTIFY" is at y ≈ 232, 7 % H above the crosshair. **[VERIFIED]** (bright text row at y 232; crosshair at y 270)
- **C18 The hammer itself is a chunky, stylised mallet.** It has a block head made of stacked planks
  and a wrapped green handle (piece-render_building-hammer-full.jpg). In first person it fills the right
  20 % W, from y 20–100 % H (M4AhtY9BB1I_0118). We study only its scale and silhouette; we do not copy
  the design. **[VERIFIED]** (hammer x ≈ 780–960, top y ≈ 110. dist/hammer.js already has an original procedural hammer, `createHammer`)

### Timings (estimates)

- **C19** In M4AhtY9BB1I, the guide tours the whole menu in 0:24–0:48 (24 s for 5 categories), so
  browsing is fast. Placement feedback, a hammer swing plus a "thunk", feels quick: about 0.3 s per
  placement (from memory, unverified). The frames give no other timing evidence. **[UNSURE: the menu frames do span 0:24–0:48 with 5 categories (pillar, repair, wall, foundation, roof). But a tutorial narrator's pace is not evidence of browse speed, and 0.3 s is from memory]**

## 3. Comparison with Little Raft today

| Area | Little Raft now (file:line) | Raft (claims) |
|---|---|---|
| Buildable pieces | Only a floor tile. `kind==='hammer'` always means recipe `'floor'` (dist/game.js:634, 567) **[CORRECTED: 566 is the bounds check; the floor branch is 567. Cap 400 verified at 118 and 568]**. Tiles are saved as `[x,z]` only (dist/game.js:114–139, cap 400). | 8 categories, 4–7 variants each (C2, C3). |
| Build menu | None. Hammer = floor. The `#recipes` bar is hidden while playing (dist/game.js:47; dist/game.js:265) **[CORRECTED: was dist/style.css:47, but style.css has only 20 lines. The rule `body.playing #recipes{display:none!important}` is CSS injected at dist/game.js:47]**. | RMB-hold centre panel (C1–C4). |
| Cost | `FLOOR_COST = {wood:2, plastic:2}` (dist/game.js:33), also in a comment at dist/inventory-state.js:42–43 **[VERIFIED]**. The cost is shown **only when unaffordable**, as "Floor needs N more …" text in `#contextPrompt` (dist/game.js:407; `updateContext` starts at 401, and `#contextPrompt` is created at 262 and placed at 50 % + 26 px by the CSS at game.js:48) **[VERIFIED]**. | have/need chips under the crosshair, always shown (C15). |
| Ghost mesh | A generic slab: `BoxGeometry(1.9, .13, 1.9)` with `MeshBasicMaterial #b6ffd0`, opacity .55 (dist/game.js:294). It is not the real tile from `createFloor` (dist/deck.js:135) **[VERIFIED]**. | The real piece mesh, as a bright flat tint (C6). |
| Ghost pose | Placed at `raft.position.y + .29` (dist/game.js:811). It is in `scene`, not `raft`, so it ignores raft roll (`raft.rotation` rx/rz, dist/game.js:291). It floats above the deck top (FLOOR_TOP .2, dist/deck.js:7) **[VERIFIED]**. | Flush with the deck, follows the raft. |
| Valid / invalid | Invalid position: the ghost is **hidden** (`placementFor` returns null, dist/game.js:499–505, 810). Unaffordable: salmon `#ee8e75` (dist/game.js:812). Valid: mint `#b6ffd0` **[VERIFIED]**. | Valid green, red for both blocked and unaffordable, ghost stays visible (C7, C8). |
| Snapping | Rounds the hit on the deck plane to a 2-unit grid; needs a 4-neighbour tile (dist/game.js:42, 500–501). There is no reach limit for building (only `FISH_REACH` and `PICKUP_REACH`, dist/game.js:37–39), and the aim plane is infinite (`T.Plane`, dist/game.js:189, offset set at 469) **[VERIFIED]**. | Edge snap from the aim ray; reach is short (from memory, unverified). |
| Rotation / remove | None. KeyR is already bound to hook repair (dist/game.js:909, and the `Repair R` button in dist/index.html:9) **[added by skeptic]**. | R rotates (C16); an amber remove highlight (C9). |
| Hints | Build-mode crosshair tint `body.build #crosshair i{background:#bff3c6}` (dist/style.css:10), but `body.build` is **never added**, only removed (dist/game.js:264), so the rule is dead **[VERIFIED]**. | Bottom-centre key-hint row (C16). |
| Feedback | `swing = 1` (dist/game.js:634); 640 Hz beep (dist/game.js:530); toast "A little more room!" (dist/game.js:579) **[VERIFIED]**. | Swing plus a sound. |
| Materials | `createWoodMaterial` (dist/wood.js:2) is a shared timber texture, available for walls and pillars **[VERIFIED]**; signature `createWoodMaterial(T, color)`. | — |

## 4. Ranked change list

1. **#1 Always show the build cost at the crosshair as "have/need" chips.** (dist/game.js `updateContext`
   ~407, dist/style.css, dist/index.html.) Add a small `#buildCost` element centred about 9 % H below the
   crosshair. It gets one chip per material (an icon from our own `icons.svg` plus "have/need"), and the
   number turns warm red when have < need. Keep the "needs N more" text as the secondary line.
   Impact H, effort S.
2. **#2 Keep the ghost visible when placement is invalid, and use one clear two-state colour scheme.**
   (dist/game.js `placementFor` 499 and `updateGhost` 807–813.) Return `{x, z, ok:false, reason}`
   instead of null for blocked or unreachable cells, so the ghost can turn red. Use a valid green in our
   own palette (in the #9fe08a–#c8ee8a range) and an invalid warm red/rose (in the #d0455f–#e06070
   range). Show red for both blocked and unaffordable cells. Put the reason in the context prompt.
   Impact H, effort S.
3. **#3 Make the ghost the real piece mesh, flush with the deck and parented to the raft.**
   (dist/game.js:294 and 811, dist/deck.js `createFloor`.) Build the ghost from `createFloor(T, 0, ghostMat)`
   with an unlit tinted material at opacity about 0.8 and `depthWrite:false`. Add it to `raft` at
   y = 0, so it follows the raft's roll and matches the final tile one-to-one. Impact H, effort S.
4. **#4 Add a build reach limit and snap from the view ray.** (dist/game.js `pickNdc` 467–484,
   `placementFor`.) Only offer cells within about 4–5 units of the player (a new `BUILD_REACH`
   constant beside `PICKUP_REACH`, dist/game.js:37). When aiming past the edge, clamp to the nearest
   free neighbour cell along the ray, so the ghost "sticks" to the raft edge instead of vanishing.
   Impact M, effort S.
5. **#5 Add a hammer build menu: hold the right mouse button for a compact centred panel.**
   (dist/game.js input plus a new small module or dist/survival-ui.js.) The panel is about 20 % W by
   55 % H, has a category column on its right, and has a detail card with the piece name, a one-line
   description and have/need rows. Release to select. Start with 4 categories: Foundation, Floor (upper),
   Pillar, Wall. Use our own rounded, light HUD style (the current `--paper`/`--ink` tokens in
   dist/style.css:2), not a parchment skin. Impact H, effort M.
6. **#6 Add walls and pillars as edge and corner pieces.** (dist/game.js world schema 114–139 and
   `rebuildRaft` 351, plus a new `dist/pieces.js` built on `createWoodMaterial` from dist/wood.js.)
   - Add `world.pieces: [{type, x, z, edge|corner, rot}]` and validate it in `liveWorld`, as tiles are.
   - A pillar snaps to a tile corner (a 0.12-unit square post, about 2.4 units tall).
   - A wall snaps to a tile edge (2 units wide, 2.4 tall).
   - Give each a new action recipe validated on the host (dist/game.js:565–579).
   - Impact H, effort M.
7. **#7 Add the key-hint row at the bottom centre.** (dist/index.html, dist/style.css; reuse the hidden
   `#aimHint` slot.) While the hammer is held, show keycap-over-label hints at about 77–83 % H:
   "RMB hold: pieces", "R: rotate" (only for rotatable pieces), "Click: build". Impact M, effort S.
8. **#8 Turn on the build crosshair state.** (dist/game.js `heldKind` and `updateGhost`; dist/style.css:10.)
   Toggle `document.body.classList.toggle('build', kind==='hammer')` every frame, so the existing green
   crosshair rule works. Optionally tint it red while invalid. Impact L, effort S.
9. **#9 Add a remove mode with an amber highlight and refund.** (dist/game.js.) Use the hammer's
   alt-action, or hold a key, to tint the aimed placed piece amber (#e0b060 range: warm, clearly
   different from the valid and invalid colours). Remove it on click with a 50–100 % refund. Never allow
   removing the last tile or one that strands other tiles. Impact M, effort M.
10. **#10 Add upper floors and stairs, with support rules.** (dist/game.js, dist/pieces.js.) An upper
    floor needs ≥ 1 pillar or wall under one of its edges or corners, with up to 1 tile of overhang
    (screenshot_pillars-supporting-floors.jpg). A stair is a single wedge spanning one tile and rising one
    level. Impact M, effort L.
11. **#11 Add R to rotate for edge and decor pieces.** (dist/game.js keydown.) Turn in 90° steps.
    Store `rot` in the piece record, and show the "R: rotate" hint only for those pieces.
    Impact M, effort S.
12. **#12 Make placement feel solid.** (dist/game.js:530 and 634, dist/audio.js 'build' event.) Use a
    0.25–0.35 s hammer swing that lands on placement, a short low "thunk" instead of the 640 Hz sine,
    and a 0.15 s scale-in pop (0.9→1.0) on the new piece. Impact M, effort S.
13. **#13 Rebalance costs per piece and display them consistently.** (dist/game.js:33,
    dist/inventory-state.js:42.) For example: foundation 2 wood + 2 plastic, wall 3 wood, pillar 2 wood,
    floor 2 wood, stair 3 wood. Keep one cost table as the source for the menu, the chips and the host
    check. Impact M, effort S.

## 5. Open questions / UNSURE

- What the amber tint means (C9). It appears with the axe or hammer selected and might be "remove
  target" or "paint/replace target". That it means removal is from memory, unverified.
- Menu open and select timing: does it open on hold or on press, and does it select on release?
  The hint text says "Hold", but frames can't show input timing.
- The exact ghost opacity: it is estimated ≥ 0.85 because water doesn't show through in
  M4AhtY9BB1I_0118. Video compression may hide transparency.
- The 9vVu3idmeV4_0436 "pink" ghost was not confirmed by sampling (the patch hit the deck). In
  2rqSgyWX6N0_0100 the colour is altered by the video filter.
- Raft's tile size relative to player height is from memory, about 1.5 m (unverified). Little Raft uses
  2-unit tiles with a 1.6 eye height (dist/game.js:37), so wall and pillar heights in #6 are proposals to
  tune in game.
- Whether the in-world cost chips show for pieces you cannot afford in red. In M4AhtY9BB1I_0154 the
  "0/1" chip's text colour was not legible at 480p.
