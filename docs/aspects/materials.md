# Aspect: materials (surface look)

Scope: how surfaces look on wood planks and foundations, thatch and palm leaves, floating plastic and debris, rope, metal and water. Covers roughness and specular response, texture scale (texel density relative to plank width), colour variation, edge wear and how stylised the surfaces are.
Reference images are of Raft (Redbeet Interactive), used for internal study only. Little Raft must keep its own textures and art. The change list asks for the same *effects*, not Raft's pixels.

Method: colours are the median of a 9x9 patch (`samp.py`) or of a box region (`region.py`, which also reports HSV and luminance std Lstd on a 0-255 scale). Little Raft's wood canvas was re-drawn in Python from the code in dist/wood.js (`simwood.py`) so its texture could be measured the same way. Scratch scripts and crops are in
`/tmp/claude-0/-home-user-little-raft/357b287e-6b25-59b7-a94d-bb803559ea72/scratchpad/materials/`
(`cmp_wood.png` puts the two wood textures side by side).

Images examined (all under references/raft/):
- stills/wiki-building: screenshot_foundations.jpg, screenshot_floors.jpg, screenshot_thatch-walls.jpg, screenshot_rope-fences.jpg, piece-render_foundation.jpg, piece-render_thatch-roof.jpg
- stills/steam: store_01..24 (contact sheet), mainly store_10.jpg and store_16.jpg
- stills/press: 2018-07-26-update-5-new-building-blocks-shark-balan-05.jpg (shortened below to "0726-05"), 2018-10-11-the-large-island-update-06.jpg ("1011-06"), plus contact sheets of 2018-10-11-*, 2018-08-15-*, 2018-07-26-*, 2018-05-25-*
- building/yt: all 57 frames on contact sheets; looked at full size: iVT88Yq-PU0_0120.jpg, 2rqSgyWX6N0_0215.jpg

## 2. Observations / spec

**Wood: deck and foundations**

C1. **Starter foundation boards are wide.** Each starter foundation tile is made of 3-4 boards. Each board is about 40-60% of the tile across. In screenshot_foundations.jpg the left tile is about 370 px wide (x 40-410). Its front boards span x 40-270 (62%) and x 232-410 (48%), and one full-length board lies behind them. The same chunky 2-3 boards per tile show in 0726-05, store_16.jpg and iVT88Yq-PU0_0120.jpg.
The upgraded foundation has 4-5 planks across (about 20-25% of the tile each; screenshot_foundations.jpg, right). The refined wooden floor has 6 planks across 265 px, so each plank is about 17% of the tile (screenshot_floors.jpg, x 710-975).

C2. **Wood is low in contrast, and most of its variation is broad.** Luminance std inside a board is 6-9 everywhere:
- 0726-05 tiles A-F: Lstd 6.3-8.7, p5-p95 spread about 105-130
- screenshot_floors.jpg basic boards: Lstd 8.1-8.9
- screenshot_foundations.jpg: Lstd 6.2-7.6

On a 96 px board (screenshot_floors.jpg box 282,30-376,190), the std of 8 px block means is 5.4 out of 7.4. So about 73% of the variation is mottling at roughly 1/12 of the board width or coarser: dark stain patches and grime toward the ends. Fine grain lines are faint (see cmp_wood.png).

C3. **Wood holds its texture at a distance.** The Raft board was box-downsampled by 1, 2, 4 and 8. Its Lstd went 7.1, 6.7, 6.0, 5.2, so it keeps 73% of its variation at 1/8 size.

C4. **In-game wood is desaturated olive-tan; the neutral-light render is a warmer albedo.**
In-game:
- 0726-05 deck: #8a724b to #8c7651 (H 37-38°, S 0.42-0.46, V 0.54-0.55)
- store_16.jpg: #6f6340 to #736643 (H 44-45°, S 0.42)
- screenshot_floors.jpg basic: #77684b (H 40°, S 0.37)
- screenshot_floors.jpg refined: #816649 (H 31°, S 0.43)

In the wiki infobox render, which is lit neutrally on grey, the same wood is #946e3f (H 33°, S 0.57, V 0.58; piece-render_foundation.jpg box 50,30-130,60). So the base colour is a warm mid-tan at about V 0.58. The olive look comes from lighting and grading.

C5. **All starter tiles have the same colour.** Six tile medians in 0726-05 fall within #8a724b-#8c7651, a V spread of 0.01. Adjacent refined planks are #816649 vs #83694a (screenshot_floors.jpg). Variation lives inside each board, not between boards.

C6. **Wood is fully matte.** No frame shows a sun highlight on deck wood, including the bright midday shots 0726-05, store_10.jpg and store_16.jpg. The board surface patch std is 2-5 (samp.py, 9x9). This fits a roughness of about 0.85-0.95 with no clear-coat look.

C7. **Edge wear comes from shape and darkening, not light chipped paint.**
- Corners are clearly rounded. The radius is about 5-8% of the board width (0726-05 near row, store_16.jpg).
- Board edges are 12-17% darker than the board centre within the outer ~6% of the width: cols 262-268 read 86-93 vs a 104 centre (screenshot_floors.jpg row band y 60-170).
- Nail heads are visible as small dark dots, 2-4 per board near the ends (screenshot_floors.jpg, 0726-05, store_16.jpg).
- Gaps are 4-8 px dark seams, #51453a (0726-05 at 400,520), and water shows through them (store_16.jpg).

C8. **Upgraded wood edges: a lighter bevel and pale metal corner caps.** The upgraded foundation has a lighter bevel rim along the plank tops and pale grey metal corner caps, #98a1a0 (screenshot_foundations.jpg at 760,198). Metal trim reads light and matte, not dark and mirror-like.

**Leaves and thatch**

C9. **Thatch is large, overlapping single leaves.** About 7 leaves span a wall, so each is about 14% of the wall width. They sit in 3 overlapping rows. Each leaf has a darker midrib and slit edges (screenshot_thatch-walls.jpg).
- Colour is teal-green: #2b5c4b and #225247 (H 159-166°, S 0.53-0.59, V 0.32-0.36), with Lstd 13.3-13.6.
- Lit leaves are about 2.5x brighter than shaded ones: #467250 vs #184945.
- The roof render reads olive, #636020 (H 57°; piece-render_thatch-roof.jpg). The hue depends on lighting, but values stay dark-to-mid.

C10. **Floating leaves read as pale sage.** A floating leaf is a pale sage shape, #729889 / #6d9985 (H about 155°), against water #023f69 (1011-06 at 293,255 vs 260,290). Its luminance is about 2.3x the water's.

**Debris, plastic and rope**

C11. **Floating planks look grey-tan and weathered.** Floating planks are #8f8969 and #7c7673 (1011-06 at 466,288 and 247,278). That is greyer than the deck wood (S about 0.2 vs 0.45). Floating plastic is a pale cream or white block, #bcb49e (1011-06 at 100,253). All debris has high value contrast with the water.

C12. **Floats and painted barrels are matte, low-saturation surfaces.**
- The raft's under-floats are pale grey-beige with diagonal moulded ribs, #877f6d (S 0.19, Lstd 23 from the rib shading; store_10.jpg box 0,470-240,640). Their sheen is soft, with no sharp highlight.
- The red barrel is matte, #721b1e (store_10.jpg at 250,260).
- Submerged float parts glow pale through the water, #b6bbb5 (screenshot_foundations.jpg at 250,270).

C13. **Rope is mid tan with visible twist.** Rope is #a68562 (H 31°, S 0.41, V 0.65), with chunky twist bumps about 1 rope-diameter apart and Lstd 9.3 (screenshot_rope-fences.jpg box 40,40-250,50). Posts are #816853 with paler cut tops, #a7a278.

**Water**

C14. **Water is saturated blue, bluer near the camera and cyan toward the horizon.** Saturation is about 0.97-0.99.
- Near the camera: #012d51 (1011-06 box 0,300-800,410; H 207°, V 0.32), #025684 (store_10.jpg; H 201°), #0a3758 (screenshot_foundations.jpg)
- Mid distance: #05789b and #047198 (H 194°)
- Toward the horizon: #0388a8 and #44a4b8 (H 192°)

Lstd near the camera is 13-22. The variation comes from broad swells, not small ripples.

C15. **Water specular is concentrated in a sun glint.** The rest of the surface is a broad, soft sheen. A sharp white sun glint shows only where the sun reflects (screenshot_foundations.jpg bottom centre). Elsewhere there is no sparkle and almost no foam at rest (0726-05, 1011-06).
The water looks clear: submerged floats and raft undersides are visible about 0.5-1 m down (screenshot_foundations.jpg, store_10.jpg).

**Overall style**

C16. **Stylisation level: stylised-realistic.** Albedo looks hand-painted with broad tonal patches and little micro-detail. Geometry is chunky with rounded bevels. Surfaces are matte, except for water and a few metal accents. Silhouettes are easy to read (all sets). Little Raft is already in the same broad family. Its differences are in texture frequency, value and saturation.

## 3. Comparison with Little Raft today

**Wood texture (dist/wood.js)**
- wood.js:3 draws a 128x512 canvas: 100 bezier strokes (wood.js:6-10), widths 0.35-1.85 px. A third are light (rgba 255,235,187,.2) and the rest dark (64,37,18,.13). It adds 3 knots (wood.js:11-14).
- It is used as both map and bumpMap, with bumpScale .018, roughness .86 and metalness 0 (wood.js:16).
- Measured on the re-drawn texture: Lstd is 7.0-7.3, the same as Raft, but the variation is pinstripe grain. The 16 px block-mean std is only 2.3.
- Under downsampling Lstd goes 7.0, 5.8, 3.7, 3.0: it loses 57% of its variation at 1/8 size, against Raft's 27% (C3). Distant deck therefore flattens to plain orange.
- There is no low-frequency staining and no edge or end darkening (vs C2, C7).
- Roughness .86 matches C6. The bump from albedo is fine.

**Deck tiles (dist/deck.js)**
- deck.js:158 builds 7-8 planks per 2 m tile, so each plank is about 0.25 m, or 12.5-14% of the tile. That is narrower than even Raft's refined floor (C1).
- deck.js:103 maps UVs as u = (x-xc)/0.34, so one plank covers about 0.74 of the texture width (~94 px). That gives about 376 texels/m across the plank and about 240 texels/m along it (v = (z+1)*0.47 over 512 px). The texture is stretched about 1.6x along the plank, which is acceptable for grain.
- deck.js:27 uses plank colours #bb8a53, #c69860 and #ad7c4a (H 30-32°, S 0.52-0.57, V 0.68-0.78). That is about 0.15-0.2 brighter in V than Raft's albedo (C4, #946e3f, V 0.58). Plank-to-plank V spread is ±5%, against about 1% in Raft (C5). This is a deliberate, original choice and fine to keep, but narrower.
- deck.js:29 uses bevel BEV 0.011 with bevelSegments 1 (deck.js:96), which is a 4% chamfer and not a rounded corner (vs C7, 5-8% rounded).
- Ends are jagged (deck.js:63-77) and nails are geometry (deck.js:204-218); both are good.
- The logs, #5e4029 (deck.js:28), use the wood texture through the TIMBER set (game.js:43).

**Lighting context (dist/game.js)**
- game.js:244-249: any colour in TIMBER gets the canvas wood material, and everything else gets plain MeshStandard with roughness .85.
- game.js:287: ACES tone mapping, exposure 1.0.
- game.js:288: hemisphere light #f2ead4 / #3d6b6a, intensity 1.8.
- There is no scene.environment or envMap anywhere (grep for PMREM/envMap finds nothing).

**Metal (dist/debris.js, dist/hook.js)**
- debris.js:76 metalMat uses metalness .55 and roughness .5. hook.js:12-14 uses metalness .7-.8 and roughness .3-.45.
- With no environment map, MeshStandard metals get only (1-metalness) of the hemisphere diffuse plus the sun's specular lobe. They render darker and flatter than their hex suggests. Raft's metal accents read pale and matte (C8).

**Vertex colours treated as linear: a colour-space bug**
- Three.js uses vertex colour attributes as linear values. rope.js:12-13 writes TAN_LIGHT [0.86,0.74,0.52] and TAN_DARK [0.63,0.50,0.32] straight into the attribute (rope.js:62). These display as sRGB #eedfbe and #cfbb99, a pale cream, not the intended #dbbc84 and #a07f51. Raft's rope is #a68562 (C13).
- debris.js:232 has the same problem. Steel [0.63,0.72,0.8] shows as #cfdce7, rust [0.5,0.24,0.1] as #bb8659 (tan, not rust) and orange as #dfa972.
- plastic.js:48 grime of 0.86-0.96 is barely visible for the same reason: the mid grime shows as #ecebdf vs #f2f0e6.
- crafts.js:74-82 converts through T.Color(hex) and is correct.

**Rope (dist/rope.js, dist/game.js, dist/deck.js)**
- dist/rope.js is not imported by any file. The fishing line in game is a 1 px T.Line in #e9d39a (game.js:296).
- The deck lashings use #a8946c (deck.js:28): H 40°, close to Raft's rope value but greyer.

**Leaves (dist/debris.js)**
- debris.js:192 uses greens #4f9a3a to #6bb84c (H 100-106°, S 0.58-0.62, V 0.54-0.72), each frond one flat colour. There is no midrib or tip gradient and no lit/shaded split beyond lighting. The rachis is the same colour as the blades (debris.js:181-184).
- This is yellow-green, compared with Raft's teal and sage (C9, C10). It is an original choice and fine as hue, but it lacks internal value structure. Lstd is about 0 apart from shading, vs 13 in Raft.
- There are no thatch building pieces in Little Raft yet.

**Floating wood (dist/debris.js)**
- debris.js:125 uses #d5a265 (V 0.84), the brightest wood in the game, so driftwood looks newer than the built deck. In Raft it is greyer and more weathered (C11).

**Plastic (dist/plastic.js)**
- plastic.js:10 uses roughness .7, which matches C12.
- The body is #f2f0e6 (plastic.js:54) with a blue cap #2f6fc4 (plastic.js:64) and translucent crease triangles (plastic.js:107). This is fine and reads as cream/white like C11.

**Water (dist/ocean.js, dist/game.js)**
- ocean.js:168-170 defaults are deep #0a4a5a and shallow #1fa9a8. game.js:290 overrides them to deep #14505a (H 189°, S 0.78, V 0.35) and shallow #3f8c88 (H 177°, S 0.55). Sky/haze is #cbd2c0 and zenith #a9c1c0.
- Compared with C14 (H 192-207°, S about 0.98), Little Raft's water is about 15-25° greener and 0.2-0.4 less saturated, under a grey-beige haze.
- Specular is pow 260 × 1.6 plus pow 36 × 0.12 (ocean.js:130), and fresnel is capped at .72 (ocean.js:111). That is in line with C15.
- Five fine ripples (ocean.js:100-105, amplitude .003-.010) add higher-frequency detail than Raft's broad swells. They fade from 8 to 60 m.
- The ocean is opaque (ShaderMaterial, no transparency), so submerged parts are never visible (vs C15).

## 4. Ranked change list

#1 **Replace pinstripe grain with broad stain mottling** (dist/wood.js: createWoodMaterial).
- Before the strokes, paint 6-10 large soft radial-gradient blobs per 128x512 canvas, 30-90 px across, at alpha 0.08-0.15, mixing darker and greyer tones.
- Add a vertical gradient that darkens the last ~12% of v at each end by about 12%.
- Halve the stroke count to about 50 and set the minimum width to 0.8 px.
- Target: Lstd about 7-9 that stays ≥5 at 1/8 downsample (now 3.0; C2, C3).
- Impact H, effort S.

#2 **Fix vertex colours entered as sRGB** (dist/debris.js:232, dist/rope.js:12-13 and 62, dist/plastic.js:48).
- Build the colours with `new T.Color().setRGB(r,g,b, T.SRGBColorSpace)`, or pass values through `T.Color.convertSRGBToLinear`, before writing the attribute.
- Expected result: rope #dbbc84 to #a07f51 instead of near-cream; scrap rust becomes a dark orange-brown; plastic grime becomes visible.
- Impact H, effort S.

#3 **Make metals read light and matte** (dist/debris.js:76 metalMat, dist/hook.js:12-14).
- Option A: lower metalness to 0.2-0.35 and raise roughness to 0.55-0.7.
- Option B: give the scene a cheap environment, e.g. a PMREM of a 2-colour sky gradient assigned to `scene.environment` in game.js init (near game.js:288), so metalness .5+ has something to reflect.
- Target: rendered steel median about V 0.55-0.65 in daylight (C8).
- Impact M-H, effort S (A) / M (B).

#4 **Water: more saturated and bluer near the camera, cyan toward the horizon** (dist/game.js:290 overrides; dist/ocean.js:168-170 defaults).
- Keep an original palette, but move the hue from about 177-189° to about 195-205° for deep and 188-195° for shallow, and raise saturation to 0.85+.
- Keep the deep value at about V 0.3-0.4 (C14).
- Coordinate with the sky/lighting analyst on the #cbd2c0 haze and the fade colour.
- Impact H, effort S.

#5 **Lower and narrow the deck plank colours** (dist/deck.js:27, game.js:43 TIMBER).
- Drop V by about 0.12-0.15, to about 0.58-0.65, and cut saturation slightly, to about 0.48-0.52.
- Squeeze the three plank colours to about ±3% V around the base, so the variation lives inside each board (C4, C5).
- Update the matching entries in the TIMBER set at the same time, or the wood texture is lost.
- Impact M-H, effort S.

#6 **Weathered driftwood colour for floating planks** (dist/debris.js:125).
- Replace #d5a265 with a greyer, darker wood in TIMBER: about 25-30% mixed toward grey, V about 0.6.
- Floating wood then reads as found material, distinct from built deck, while staying high-contrast on the water (C11).
- Impact M, effort S.

#7 **Edge and end darkening on planks** (dist/deck.js:plankGeometry).
- Add a vertex-colour attribute: 0.85 within 6% of the plank side edges and 0.8 within 5 cm of the ends, 1.0 elsewhere.
- Enable `vertexColors` on the plank material, or do the darkening in the canvas texture's u-edges (C7).
- Impact M, effort S-M.

#8 **Rounder plank corners** (dist/deck.js:96, :29).
- Use bevelSegments 2-3 and raise BEV toward 0.014-0.018, so corners read as soft and worn (C7: 5-8% radius) instead of a crisp 4% chamfer.
- Watch the triangle count: 8 planks × tiles.
- Impact M, effort S.

#9 **Fewer, wider planks per tile** (dist/deck.js:158).
- Use 5-6 planks instead of 7-8, about 17-20% of the tile each. That is chunkier at first-person distance while staying original (Raft's starter uses about 50% boards; C1).
- Adjust the UV divisor at deck.js:103 (0.34 to about 0.42) so texel density across the plank stays about 300+/m.
- Impact M, effort S.

#10 **Leaf value structure** (dist/debris.js:191-205, leafletGeo uv).
- Add vertex colours: a darker midrib (×0.75), lighter tips (×1.15) and a slight per-leaflet hue jitter of ±6°.
- Darken the rachis separately.
- Pull saturation from about 0.6 to about 0.5 so floating leaves read as a lighter shape on the water (C9, C10).
- Impact M, effort S-M.

#11 **Calm the fine water ripples** (dist/ocean.js:100-105).
- Cut the two highest-frequency ripple amplitudes (.004 and .003) by about 50%, and shift that energy into the broad patches noise (ocean.js:118).
- Water then reads as smooth swells with one sun glint (C14, C15).
- Impact L-M, effort S.

#12 **Fake shallow see-through near the raft** (dist/ocean.js fragment).
- Lighten and desaturate the body colour within about 1.5 m of the raft footprint, e.g. by passing the raft AABB as a uniform. This suggests submerged logs and floats without real transparency (C15).
- Impact L-M, effort M.

#13 **Use the braided rope mesh for the fishing line** (dist/game.js:296 vs dist/rope.js).
- Replace the 1 px T.Line with createRope at radius about .006, after fix #2, so the line has volume and mid-tan colour (C13).
- Impact M, effort S-M.

## 5. Open questions / UNSURE

- No Little Raft screenshots are available, so its on-screen colours are inferred from hex values and lighting code, not measured. A render pass with the same sampling scripts would confirm C4 vs #5 before tuning.
- The in-game olive tint of Raft's wood (C4) is partly lighting and grading and partly JPEG and video compression. I treated the neutral render (#946e3f) as the closest to albedo.
- The ~2.5x lit-to-shaded ratio on Raft's thatch may come from fake translucency or just sun angle; one still can't tell. From memory, unverified: Raft leaves use a two-sided foliage shader with some backlight.
- The hook and scrap metal material look in Raft was not visible at useful size in these sets. The hook-early and viewmodel sets were outside my brief.
- Water saturation (C14) partly depends on Raft's sky and post-processing. Change #4 should be decided together with the sky/lighting aspect.
- The texel density numbers assume a plank of about 0.25 m and the current UV mapping; with change #9 they need recalculating.
