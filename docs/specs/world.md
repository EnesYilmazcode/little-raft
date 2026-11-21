# World spec: ocean, sky, day/night, weather, fog, islands, reefs, underwater, horizon and scale

Analyst topic: **world**. The scope is the ocean surface and waves, the foam pattern, the sky and
day/night (sun and moon discs, stars), weather and fog, island silhouettes and their scale relative
to the raft, reefs and how they show through the water, underwater views, and horizon distance.
Colour palettes are covered in depth by the aspect analyst (`docs/aspects/`). Colours here are
given only as luminance or contrast structure, or as reference ranges.

The sources are reference stills of Raft (Redbeet Interactive), for internal study only. Nothing
here is an asset to copy. Percentages are of frame width (W) or height (H). Colours are medians of a
7x7 patch, sampled with Pillow/numpy. L is Rec.709 luminance, 0 to 255. The scratch scripts
(`sheet.py`, `disc.py`, `disc2.py`, `samp.py`) and the contact sheets are in
`/tmp/claude-0/-home-user-little-raft/357b287e-6b25-59b7-a94d-bb803559ea72/scratchpad/world/`.
Network access was blocked, so anything about Raft that does not come from an image is marked
"(from memory, unverified)".

Branches: `origin/wip/feature/islands` and `origin/wip/fleet/world` were read with read-only
`git show` and `git diff` only, as the caller instructed. That is a narrow exception to the shared
brief's "do not run git" rule. Nothing was checked out or modified.

## 1. Images examined

I viewed all 60 entries of `references/raft/world/SELECTED.md` on five contact sheets (12 images
each). The images below were also viewed at full size, measured or sampled:

- `stills/steam/`: store_20, community_097, community_102, community_024, community_039,
  community_068, community_134, community_119, community_094, community_146, community_007,
  community_053, store_24, community_121, community_103, community_016, community_010,
  community_082, community_106, store_09, store_08, community_090, community_140, store_05
- `stills/press/`: 2018-07-13-development-blog-35-01, 2021-04-01-devblog-46-03,
  2018-08-15-update-6-auto-saving-bug-fixes-and-a-new-05, 2019-02-07-the-domesticated-update-out-now-07,
  2022-01-13-dev-blog-47-07, 2018-07-09-raft-building-event-winners-future-updat-04
- I looked at the other 30 on the contact sheets only: community_085, _059, _032, _113, _006, _008,
  _035, _057, _002, _047, _009, _107, _069, _067, _089, _065, store_15, the press 2018-10-11-*,
  2022-01-13-dev-blog-47-09, 2022-06-20-*, 2019-08-16-devblog-38-05, 2018-07-26-*,
  2018-07-09-*-09, 2019-12-03-*, the wiki-building screenshots, palm-leaf-floating and
  qdWZgcjkYNI_0410.

Known gaps in the set: there is little rain (only community_024 and community_106), no lightning
and no open-sea fog bank. Fog appears only as haze around islands and landmarks (community_068,
community_140, community_047, store_05). All "storm" claims rest on a single image.

## 2. Observations / spec

### Horizon and sky structure

- **C1 The day horizon is a crisp line, not a blend.** Luminance steps from the sky just above the
  horizon to the sea just below it: 2018-08-15-update-6-*-05 L199 to L150 (step 49, horizon at
  y 327, 45.3 % H), 2019-02-07-*-07 L191 to L149 (step 42), 2021-04-01-devblog-46-03 L237 to L189
  (step 48, at y 357). The sea just below the horizon is about 20 % darker than the sky just above
  it. On calm days the line is dead straight: in 2018-08-15-*-05, the horizon row varies by 1 px
  (0.14 % H) across the full width. **[VERIFIED: re-measured sky 4 px above vs sea 3 to 7 px below,
  x 30 to 70 % W: 2018-08-15 L202 to L158 (22 % darker, falls to L149 by +9 px), 2019-02-07 L190 to
  L150 (21 %), 2021-04-01 L230 to about L180 (about 20 to 22 %); so "about 20 %" holds, range 20 to
  26 % depending on how far below the line you sample. Per-column horizon in 2018-08-15 is rows
  326 to 327 only.]**
- **C2 The sea brightens strongly toward the horizon.** In the same frames, the sea 25 % H below the
  horizon is L54 to L61 (2019-02-07-*-07, 2018-08-15-*-05), while the sea just under the line is
  L149 to L150, about 2.5x brighter. store_20 shows the same: sea at the horizon (640,276) L199
  against deep water near the reef (1150,450) L77. **[CORRECTED: about 3x, not 2.5x. Re-measured sea
  25 % H below the horizon is L55 (2018-08-15) and L50 (2019-02-07), against L158/L150 just under
  the line, ratios 2.9 and 3.0. store_20 samples L199 and L77 reproduce exactly.]**
- **C3 The sky is a vertical gradient that is brightest at the horizon.** The zenith is 7 to 40 %
  darker than the horizon: 2018-07-13-development-blog-35-01 top (640,30) L123 against the horizon
  band (40,440) L203; 2021-04-01-devblog-46-03 top L173 against L237; store_20 top L215 against L231.
  Even the storm frame community_024 keeps this structure: top L169, horizon (900,480) L216.
  **[VERIFIED: re-sampled 2018-07-13 L123/L203, store_20 top (640,20) L209, 2021-04-01 top L168 vs
  horizon L229, community_024 L168/L216; zenith 7 to 40 % darker holds.]**
- **C4 Clouds are thin, wispy and streaky.** They are high and flat, and none of them reads as a
  3D blob: 2021-04-01-devblog-46-03 (streaks fanning from the sun), store_20, community_008,
  community_024 (overcast bands). community_036 and screenshot_custom-raft show a few small flat
  puffs low on the horizon. No cloud ever shows parallax against the raft. **[VERIFIED: visual check of
  2021-04-01, store_20 and community_024; thin streaky layers only. "No parallax" cannot be seen in
  stills and is an inference.]**

### Sun, moon and stars

- **C5 The moon is a crisp disc about 4 to 6 % W wide, with almost no halo.** The half-max
  diameter is 51 px (4.0 % W) in community_094, 57 px (4.5 % W) in community_146, 61 px (4.7 % W) in
  community_053 and 76 px (5.9 % W, at 1280x800) in community_007. Crops (`discs.png`) show a hard
  limb and a few large soft crater blotches. community_102 shows a 148 px (11.5 % W) moon, so it is
  probably zoomed or in photo mode, and I treat it as an outlier. Assuming a horizontal FOV of
  about 90 deg (from memory, unverified), 4 to 6 % W is roughly 4 to 6 deg of arc, about 10x the
  real moon. **[CORRECTED: was "4 to 6 % W" (51/57/61/76 px); the disc is about 5 to 7 % W. Raw row and
  column profiles through each centre show a 1 px hard limb; limb-to-limb widths are 61 px (4.8 % W)
  in community_094, 69 to 71 px (5.4 % W) in community_146, 66 px (5.2 % W) in community_053 and
  83 to 87 px (6.6 to 6.8 % W) in community_007. The analyst's half-max cut fell inside the disc
  because the moon has limb darkening and dark crater blotches (inner L135 to L216). community_102
  is 136 px (10.6 % W, not 148 px), still an outlier. At an assumed 90 deg FOV this is about 5 to
  7 deg.]**
- **C6 The sun is a soft blown-out core of about 5 to 8 % W, inside a very wide bloom.** In
  2021-04-01-devblog-46-03, the core at L>=250 is 44 px (4.8 % W), at L>=240 it is 72 px (7.9 % W)
  and at L>=200 it is 228 px (25.1 % W). community_103 (low sun) gives 8.0 % W at L>=240 and
  31 % W at L>=200. The sunset in store_24 is a pale disc of about 93 px (7.3 % W) half-max, with no
  hard edge. So the moon has a hard edge and a small halo, while the sun has a soft edge and a huge
  halo. **[VERIFIED: 2021-04-01 core re-measured at 46 px (5.1 % W) at L>=250 and 72 px (7.9 % W) at
  L>=240; the L>=200 width is ill-defined because that contour merges with the bright horizon band
  (20 to 33 % W depending on row), so treat "25 % W" as approximate. community_103 at L>=240 is
  107 to 113 px (8.4 to 8.8 % W, not 8.0). store_24 has a soft ramp about 30 px wide on each side,
  half-max about 7.3 to 7.8 % W.]**
- **C7 The glint path is a narrow broken column.** Under the moon or a low sun, the glints are
  2 to 3 % W wide: community_094 x 667 to 693 (2.0 % W), community_146 2.9 % W, community_121
  2.0 % W. Only 24 to 70 % of the rows in the column are lit, which gives a dashed look. The column
  runs from the horizon to 84 to 98 % H. community_068, community_020 and community_025 show the
  same thing at dusk. **[CORRECTED: 2 to 4 % W, not 2 to 3. Re-measured (L>150, 5th to 95th
  percentile of lit columns): community_094 x 663 to 697 (2.7 % W), lit rows 63 %, lowest lit row
  98 % H; community_146 3.6 % W, 39 % lit, down to 84 % H. community_121 not re-measured (my mask
  caught non-glint highlights).]**
- **C8 Star density varies a lot, and in moonlit frames stars are almost absent.** Counting local
  maxima at least 25 L above a 9x9 background mean: community_094 has 2 stars in a 1280x280 sky
  band (0.06 per 100x100 px), community_146 has 0, and community_007 has 1. The 45 that
  community_053 returned were JPEG noise, which I confirmed visually in `stars.png`. Only
  community_102 is starry: about 8 per 100x100 px (43 in 270x200 and 57 in 320x210), mostly 1 to
  2 px points with a few brighter 3 to 4 px points. Its frame has a full moon too, which suggests a
  mod or photo mode. The press shot 2018-07-09-*-04 has 8 faint stars in a 1280x300 band.
  **[CORRECTED (minor): community_146 has 1 star (175,122), visible by eye, not 0. community_094 = 2
  reproduced. community_102 gives 83 in the 320x210 corner with a 5x5 local-max detector, so the
  "about 8 per 100x100" density is detector-dependent (8 to 12). The conclusion stands.
  2018-07-09-*-04 and community_007 not recounted.]**
- **C9 Night is navy, not black, and stays readable.** In community_094 the sky near the horizon is
  L42, the sea L18 to L44 and the moon L250. community_140 has an island at L31 against sky at L59.
  Large raft silhouettes stay legible against the sky (community_053, community_007). The green
  aurora appears only in the late-game cold biome (2022-01-13-dev-blog-47-07). **[CORRECTED: in
  community_094 the sea runs from L49 near the horizon (300,480) to L27 at y 560 and L9 (#00082f) at
  the bottom edge, so the near sea does go almost black; "L18 to L44" understates the range. The sky
  near the horizon is L49 to L82 (moon side), not L42. community_140 sky sample (200,400) L39
  matches. Sky stays navy; near sea can reach L10.]**

### Waves and foam

- **C10 The calm sea is low-amplitude swell with no visible crests on the horizon.** 2018-08-15-*-05,
  2021-04-01-devblog-46-03 and community_047 show a flat horizon (C1). Close up, broad smooth swells
  carry small ripple detail (community_097, community_039, community_082). **[VERIFIED: visual, same
  frames as C1.]**
- **C11 In a storm, swells break the horizon line.** In community_024, right half (x 720 to 1150),
  the sea-sky edge undulates between rows 509 and 520, which is 11 px (1.5 % H). There are 5 crests
  across 430 px, so crests are about 86 px apart (6.7 % W) at the horizon. Rain shows as faint pale
  streaks, 1 to 2 px wide and 40 to 100 px long, nearly vertical. I counted about 25 visible streaks
  across the frame by eye, because my automatic detector found none at a contrast of 6 L or more.
  The rain sky stays bright teal (L169 to L216), and nothing in the frame is grey or dark.
  **[CORRECTED: per-column horizon (5 px steps, x 720 to 1150) runs rows 508 to 522, 14 px (1.9 % H),
  not 11 px. The profile is mostly one broad hump plus a slope; I could not resolve 5 distinct crests,
  so the 86 px crest spacing is UNSURE. Rain streaks are clearly visible by eye; count not re-done.
  The sky has darker grey-teal cloud bands, so "nothing grey" is a slight overstatement.]**
- **C12 Open-sea foam is soft, translucent and streaky, and it is never lacy or opaque.** Soft foam
  (saturation below 0.55 and at least 30 L above the 30th percentile of the water) covers 11.3 % of
  the open water in community_097 (0,0 to 560,600), 13.7 % in community_082 and 9.1 % in
  community_134. Bright opaque foam (saturation below 0.3 and L above 170) covers 0.01 to 0.5 %.
  The patches are tens of pixels across and drift like mist on the surface (community_097 left,
  community_039 bottom right). **[CORRECTED: only the community_097 figure reproduces (11.2 % in
  0,0-560,600), and there the mask sits mostly at the bottom, beside the raft: 15.4 % in y 300 to
  600 but 3.6 % in y 0 to 400. In community_082 the same mask on open water only is 1.7 %
  (860,300-1280,540) and 0.7 % (190,300-540,490); over the whole lower strip it is 9.2 %, but an
  overlay shows that is the raft, walkway and HUD, not foam. In community_134 open water it is 0.0 %
  (0,20-430,290) and 3.0 % (750,30-1280,250). So soft open-sea foam covers about 1 to 4 %, rising to
  about 10 to 15 % only in the mist near a raft. Hard foam 0.00 to 0.09 % on open water is
  confirmed. Overlay: scratchpad/world-skeptic/foam_overlay.png.]**
- **C13 Contact foam is the strong foam.** A bright, continuous, near-white line traces every place
  where water meets a solid. Along the island shore in store_20, column scans give peak values
  #f0f6f2 to #fffff8 (L244 to L254) against water at L100 to L143, with a line 7 to 18 px thick
  (1 to 2.5 % H) close to the camera. Raft hulls carry the same white rim and a short wake: the
  right hull edge in community_039, the barge outline in community_107, the starter raft in
  2021-04-01-devblog-46-03 (a white wake patch under the raft at y 405 to 420). **[VERIFIED: store_20
  column x 200 peaks at #f0f6f2 (y 500) over water L100 or less; (300,500) is L238. Hulls checked by
  eye in community_039/107 and 2021-04-01.]**

### Islands, landmarks and scale

- **C14 Islands are large irregular rock masses with a tall feature, and they dominate the frame.**
  2018-07-13-development-blog-35-01 spans x 105 to 1222 (87 % W). Its top is at y 148 and its
  waterline at about y 478, which gives a height of 330 px (50 % H) and a height-to-width ratio of
  0.30. community_068 spans x 120 to 695 (45 % W), with trees to y 255 and the waterline at y 450:
  height 27 % H, ratio 0.34. Their silhouettes are layered, with low beach shelves, rock humps,
  one pinnacle and palm tufts on top. Islands arrive one at a time and are never a ring around the
  player. **[VERIFIED: 2018-07-13 (1280x664) re-measured from colour profiles: pinnacle top y 147 to
  148, waterline y 478 to 479, left tip about x 105 to 113, right x 1216 to 1222; height about 331 px
  (50 % H), width about 1110 px, ratio 0.30. community_068: x 124 to 691, tree top about y 255,
  waterline about y 452, ratio 0.35 with the trees; the rock mass alone (top about y 318) is about
  0.23. "One at a time" is an inference from stills.]**
- **C15 Distant islands and landmarks are washed into the haze.** On a clear day
  (2018-07-13-development-blog-35-01), the mid-height rock is L137 against sky at L187 on the same
  row (ratio 0.73), and the low rock is L155 against a horizon at L203. In heavy dusk haze
  (community_068), the island is L95 against L105 (0.90). Landmarks such as store_05, community_047
  and community_009 fade toward the sky colour with distance in the same way, and the far towers in
  store_05 are nearly sky-coloured. **[CORRECTED: the clear-day ratio depends on where you sample. My
  samples in 2018-07-13: mid rock (880,300) L139 against sky (1100,300) L165, ratio 0.84; low rock
  (450,440) L173 against horizon (40,440) L203, 0.85. Use "about 0.75 to 0.85" on a clear day.
  community_068: (260,400) L107 against (60,400) L115, 0.93, which matches about 0.90.]**
- **C16 The starter raft is tiny against the ocean.** In 2021-04-01-devblog-46-03, the starter raft
  is 46 px wide (5.1 % W) just below the horizon, and about 6 pieces of flotsam are scattered
  between it and the horizon. Big bases (community_102, community_039, store_09) are multi-storey
  rafts that span 40 to 70 % W at close range. Raft scale grows with play, while islands stay
  larger than any early raft (store_20: the island is in the foreground and the raft sits at
  x 718 to 1028, 24 % W, mid-distance). **[VERIFIED: 2021-04-01 raft at row 402 spans x 426 to 474,
  48 px (5.3 % W); store_20 raft extent checked by eye.]**

### Reefs, shallows and underwater

- **C17 Reefs are readable from above because the water goes clear and turquoise over them.** In
  store_20, shallow coral (700,620) is L131 against deep water at (1150,450) L77, and a sandy
  shallow (200,600) is L98. The boundary between shallow and deep water is a clear band. In
  community_134, looking straight down from the raft, open deep water is dark (#023d66, L51), and a
  pale submerged rock shelf plus two green and purple coral heads near the surface (450,310) at L111
  stand out beside the raft. So looking down at open water is dark. Clarity is a property of the
  shallows, not of the viewing angle. **[VERIFIED: store_20 L131/L77/L98 reproduced exactly;
  community_134 open water re-sampled at (300,220) #003c65 L50, (800,200) L48, (1100,300) L49, and
  coral (450,310) L111.]**
- **C18 Underwater, the scene sits in a strong blue depth fog with caustics on the sand.** In
  community_119, the sand at the near floor (400,690) is L131 and the sand about 3x further away
  (250,470) is L52. Fog at mid distance (640,200) is L44, and the water toward the surface
  (640,20) is lighter at L68. Rocks at mid distance are L81. Similar fog values appear in store_08
  (L65), community_090 (L39) and 2018-10-11-*-08. Caustic light ripples are visible on the near sand
  in community_119. Visibility reads as roughly 20 to 30 m (from memory, unverified). At night,
  jellyfish give off their own glow (community_113, community_006). **[CORRECTED (minor):
  community_119 values L131/L52/L44/L68 reproduce exactly. community_090 at (640,200) is L125 (that
  point is the shark and seabed); its dark fog is near the top-right, so the "L39" needs a stated
  coordinate. store_08 (640,200) L71, not L65. Visibility in metres is UNSURE (wiki unreachable).]**

### Day/night and weather timing

- **C19 Raft has a full day/night cycle with long, colourful dusks and dawns.** Pink or purple
  horizon bands appear in community_020/121, _023/035, _024/057 and _022/008. Day length (from
  memory, unverified): a full cycle of about 20 to 24 min, with night shorter than day. Weather
  (from memory, unverified): rain or storms come occasionally and last a few minutes, the waves
  get bigger and the raft rocks harder. No still shows lightning or open-sea fog, so those are
  unverified. **[UNSURE: the dusk/dawn colour bands are visible (community_068, community_103,
  store_24), but cycle length, night share and weather timing are from memory; wiki unreachable.]**

## 3. Comparison with Little Raft today (HEAD)

**Sky and horizon**
- The sky is a flat colour. `dist/game.js:283` sets `scene.background = #cbd2c0` and
  `scene.fog = Fog(#cbd2c0, 25, 125)`. `dist/sky.js` exists but no module imports it (grep finds
  no `createSky` outside sky.js), so there is no gradient, sun disc or dome clouds (against C3, C4,
  C6). **[VERIFIED: game.js:283 is exact; sky.js exports `createSky` (:109) and no file in dist/
  imports sky.js or calls createSky.]**
- The clouds are 24 groups of 3 icospheres each (`#e7f9eb`, y scale 0.5) at a height of 17 to
  25 m, within +/-85 m (`dist/game.js:301`). They are low, close and solid, so they show parallax
  when the player moves (against C4). **[VERIFIED: game.js:301, `sphere()` is an IcosahedronGeometry
  (:254), radii 1.3 to 2.0, y 17 to 25, x/z (rand-.5)*170.]**
- The ocean fades fully into the sky colour, using a smoothstep over 28 to 125 m of camera distance
  (`dist/game.js:290` with `fadeNear:28, fadeFar:125`, applied at `dist/ocean.js:148-149`). The
  sea-to-sky step at the horizon is therefore 0 and there is no horizon line (against C1).
  **[VERIFIED: game.js:290 passes skyColor '#cbd2c0', fadeNear 28, fadeFar 125; ocean.js:148-149
  mixes to uSky after tone mapping.]**
- The camera far plane is 200 (`dist/game.js:284`). The default FOV is 75 deg vertical
  (`dist/settings.js:10`), which is about 107 deg horizontal at 16:9. **[VERIFIED: the constructor
  at :284 uses 70/48, but game.js:714 applies options.fov (default 75) while running.]**
- If `sky.js` were wired in as it is now, its sun would be a soft glow
  (`pow(sd,400)*0.45`, `dist/sky.js:72`) with no crisp edge, and the clouds would be fbm puffs on a
  flat layer (`dist/sky.js:80-95`). **[VERIFIED: sky.js:72.]**

**Sun, moon, stars and day/night**
- The sun is fixed at `(-15,28,12)` (`dist/game.js:289`), an elevation of 55.6 deg. There is no
  time of day, no moon and no stars. A low-sun glint path (C7) can never appear, because the
  specular term (`dist/ocean.js:128-132`) only shows when the player looks steeply down toward the
  sun. **[VERIFIED: game.js:289; atan(28 / hypot(15,12)) = 55.6 deg.]**

**Waves**
- There are 4 Gerstner waves (`dist/ocean.js:11-16`): wavelengths 31, 19, 12.5 and 9.2 m, and
  amplitudes 0.10, 0.065, 0.05 and 0.04 m, so crest-to-trough is at most about 0.51 m. The speed
  factor is 0.6 (`:17`), which gives periods of about 7.4, 5.8, 4.7 and 4.0 s. The largest
  steepness `k*a` is 0.027.
- Five normal-only ripples (`:101-105`) have wavelengths of 3.0 to 0.69 m and fade out between 8
  and 60 m. This matches a calm Raft sea (C10).
- There is no weather state. The amplitudes are compiled into the shader as constants (`:20-24`),
  so a storm (C11) cannot scale them at runtime. **[VERIFIED: ocean.js:11-24; amplitudes sum to
  0.255 m; T for 31 m = 2 pi / (0.6 sqrt(g k)) = 7.4 s; k a max 0.027 (9.2 m wave); ripple fade
  smoothstep(8, 60) at :98.]**
- The ocean is a 280 m plane with 100 segments (`:155-156`), and it does not follow the camera:
  `followCamera` is unset in `dist/game.js:290`, so the snap code at `ocean.js:197-201` never
  runs. If a swimmer goes about 15 m or more from the origin, the far edge comes inside the
  125 m fade, and a faint seam is possible. **[VERIFIED: waves at ocean.js:11-17, ripples
  :101-105, plane :155-156; `followCamera` appears only at ocean.js:197 and is not passed at
  game.js:290 (nor on fleet/world). The seam distance is arithmetic (140 - 125 = 15 m), not
  observed.]**

**Foam**
- The foam is a thin "lace" iso-line, `smoothstep(0, .035, |n-.5|)` (`dist/ocean.js:138`). It is
  shown only on crests (`vHeight` 0.06 to 0.17), plus sparse specks, capped at 0.6 and faded out
  between 30 and 90 m (`:134-143`). That is hard-edged lines instead of soft patches (against C12).
  **[CORRECTED (wording): the line at :138 is `lace = 1.0 - smoothstep(0.0, 0.035, abs(n1*0.7 +
  n2*0.3 - 0.5))`, i.e. the lace is the inverted smoothstep. Crest window 0.06 to 0.17, cap 0.6, fade
  30 to 90 m (:142) are correct.]**
- There is no contact foam around the raft hull or floating items (against C13). The wake look
  depends on that foam.

**Islands and scale**
- There are 12 static "islands" in a fixed ring (`dist/game.js:300`), at angles of i*2.4 rad and
  65 to 90 m away. Each one is a cylinder (top radius 3, bottom radius 5, height 0.8 at y -0.1),
  plus a sphere of radius 3.4 at y 1.4 (top at about 4.8 m) and a single palm.
- So each island is about 10 m across and about 5 m tall: a height-to-width ratio of 0.5, shaped
  like a dome. At 75 m it fills about 4.9 % W and 4.3 % H, and linear fog blends it about 50 % into
  the sky colour.
- The starter raft is 3x3 tiles of 2 m, so 6x6 m (`dist/game.js:114`). An island is therefore only
  about 1.7x the raft's width, it never comes closer, and there are always several in view
  (against C14 and C16). **[VERIFIED: game.js:300 exact. 10 m / (2*75*tan 53.5 deg) = 4.9 % W;
  4.8 m / (2*75*tan 37.5 deg) = 4.2 % H; fog (75-25)/100 = 50 %.]**

**Water clarity, reefs and underwater**
- The ocean is opaque: the ShaderMaterial is not transparent and writes alpha 1.0
  (`dist/ocean.js:145`). There is no seafloor, reef or shallow tint (against C17). **[VERIFIED:
  ocean.js:145 `vec4(col, 1.0)`; the ShaderMaterial at :175-182 sets no `transparent`.]**
- The swimmer's eye stays 0.45 m above the water (`dist/player-physics.js:22`), so there is no
  underwater view (C18 does not apply yet).

**Splashes**
- `dist/waterfx.js` (48 pooled drops and 8 rings) is not imported anywhere, so hook landings and
  water entries have no splash or ring. **[VERIFIED: waterfx.js exports `createWaterEffects` (:16,
  :240); no dist/ file imports it.]**

**Branch `origin/wip/fleet/world`** (one WIP commit, fe9f146):
- It wires `sky.js` into game.js: `SKY.horizon #d6ecf2`, fog 40 to 140, ocean fade 40 to 130.
- It deletes the 24 sphere clouds and pins the sky dome to the far plane.
- It adds a crisp sun disc, `smoothstep(.9993,.9997,sd)`. That is about 1.8 deg of radius, a 3.6 deg
  disc, about 2.3 % W at 107 deg horizontal FOV. That is roughly half the Raft value in C5 and C6.
- It adds a raft foam collar: a 128x128 mask with 0.5 m texels and a 1.4 m falloff, rebuilt in
  `setRaftTiles`. It adds foam rings around up to 32 floating items (`trackFoam`), and replaces the
  lace foam with a lace field that is shown where `max(crest, edge)` is high.
- It adds "clear" water when looking down, `pow(ndv,1.4)` within 4 to 45 m, which turns the near
  open sea turquoise. That contradicts C17, where open water looking down is dark.
- It still keeps the full fade to the horizon colour, so there is still no horizon line.
  **[VERIFIED via `git show`/`git diff HEAD...origin/wip/fleet/world`: SKY.horizon '#d6ecf2', fog
  40/140, fade 40/130, cloud loop removed, `gl_Position.z = gl_Position.w`, disc
  smoothstep(.9993,.9997) (acos = 2.1 to 1.4 deg, about 1.8 deg half-intensity radius, about 2.3 % W),
  GRID 128 / TEXEL 0.5 / COLLAR 1.4, MAX_FOAM 32, `max(crest, edge)`, `pow(ndv,1.4)` with
  smoothstep(4,45), and the uSky fade at ocean.js:165. Its sun disc is about 2.3 % W against Raft's
  5 to 8 % W, and its moon is absent.]**

**Branch `origin/wip/feature/islands`** (design document only, `docs/features/islands.md`):
- One island at a time on a 150 to 270 s cycle. It spawns 70 m upstream, docks 10 to 16 m from the
  raft for 180 s, then departs.
- The island is a sand dome of radius 5 to 8 m with its top only 0.35 m above the water, with 1 to
  3 palms, bushes and rocks.
- A seafloor disc (2.2x the island radius, 2.5 m down) is meant to show "only through the existing
  water transparency", but that transparency does not exist (see above).
- Spawning at 70 m with fog from 25 to 125 (or 40 to 140) means the island pops in at 45 % (or
  20 %) fog instead of emerging from the haze (C15). **[CORRECTED: with fog 40 to 140 it is
  (70-40)/100 = 30 %, not 20 %. The 45 % figure is right. Phases (150 to 270 s, 70 m, 10 to 16 m,
  180 s), the 5 to 8 m dome with a 0.35 m top, and the x2.2 / 2.5 m seafloor disc are verified in
  docs/features/islands.md on origin/wip/feature/islands.]**
- A 0.35 m dome is a height-to-width ratio of about 0.02 to 0.035 for the sand alone, against
  about 0.3 in C14. Most of its height would come from the palms. **[VERIFIED: 0.35/16 = 0.022,
  0.35/10 = 0.035.]**

## 4. Ranked change list

1. **#1 Give the sky a real dome and drop the blob clouds.** (dist/game.js:283, :290, :301,
   dist/sky.js: import `createSky`, add `sky.group`, call `sky.update` each frame, delete the
   24-sphere cloud loop. Follow the integration in `wip/fleet/world`, including pinning to the far
   plane. Keep a horizon-to-zenith gradient where the zenith is 15 to 35 % darker than the horizon
   (C3). Keep clouds thin, flat and high, with no parallax (C4).) Impact H, effort S. **[VERIFIED]**
2. **#2 Restore a visible horizon line.** (dist/ocean.js:148-149, dist/game.js:290: fade the far
   ocean to a separate `uHorizonSea` colour that is about 15 to 20 % darker than the sky horizon,
   instead of to `uSky`. Let the sea get lighter toward the horizon, reaching about 3x the
   near-sea luminance (C1, C2). Start the fade later (40 to 130 m, as in fleet/world). Use our own
   colours; the aspect analyst owns the palette.) Impact H, effort S. **[CORRECTED: "2 to 2.5x" ->
   "about 3x" per C2; the 15 to 20 % step (re-measured 20 to 26 %) stands; rank unchanged.]**
3. **#3 Rework foam into two kinds: strong contact foam and soft open-sea patches.**
   (dist/ocean.js:134-143: take the fleet/world raft collar mask and item foam rings, about a 1.4 m
   falloff, and make the contact band near-opaque (alpha 0.85 or more) right at the hull. Replace
   the thin lace iso-line with soft low-frequency patches (about 1 to 3 m blobs) that cover about
   2 to 4 % of the open sea at an opacity of 0.25 to 0.4, rising to about 10 to 15 % as soft mist
   within a few metres of the raft (C12, C13). Add a short wake streak on the downstream side of
   the raft.) Impact H, effort M. **[CORRECTED: was "about 10 % of the open sea"; per C12 the open
   sea is about 1 to 4 % and the 11 % figure is mist next to the raft. Rank unchanged, since contact
   foam (C13, verified) is the main win.]**
4. **#4 Replace the ring of 12 mini-islands with occasional landmark islands.** (dist/game.js:300
   and the design in `wip/feature/islands`: one island at a time. Give it a layered silhouette with
   a height-to-width ratio of about 0.25 to 0.35, plus one tall feature such as a rock spur or a
   palm cluster of 6 m or more, so it reads on the horizon (C14). Make it at least 3 to 5x the
   starter raft's 6 m width (C16). Spawn it beyond the fade distance (at least 130 m) and let it
   emerge from the haze instead of popping in at 70 m (C15). Amend the 0.35 m dome height in the
   design.) Impact H, effort L. **[VERIFIED: ratio 0.30/0.35 re-measured (rock alone 0.23, so 0.25 to
   0.35 is fair). The pop-in is 30 % fog under fleet fog 40 to 140, not 20 %; that does not change
   the item.]**
5. **#5 Make shallows and reefs readable without real transparency.** (dist/ocean.js: add a
   shallow mask, the same technique as the raft foam mask, that a nearby island writes into. Over
   the mask, lighten the water body toward a clear turquoise and blend in a procedural sand or
   reef pattern, with a clear boundary band against deep water (C17). Do not adopt fleet/world's
   global "clear when looking down": keep open water dark when the player looks straight down
   (community_134).) Impact M, effort M. **[VERIFIED]**
6. **#6 Make the ocean follow the camera.** (dist/game.js:290: pass `followCamera:true`. The
   snapping code at dist/ocean.js:197-201 already exists. This removes the possible far-edge seam
   when a player swims away from the raft.) Impact M, effort S. **[VERIFIED: note `update` must also
   receive the camera, which the per-frame call at game.js:825 already does.]**
7. **#7 Size the sun disc to Raft's readability, in our own style.** (dist/sky.js: a soft-edged
   core about 5 to 6 deg across, about 4 to 6 % W at the default FOV, with a wide warm halo out to
   about 25 % W (C6). The current fleet disc is 3.6 deg. Scale the bloom down when the sun is
   high.) Impact M, effort S. **[VERIFIED: core 5.1 % W (L>=250) to 7.9 % W (L>=240) re-measured;
   the "25 % W" halo is approximate.]**
8. **#8 Add a slow, gentle day/night cycle.** (dist/game.js:288-289 lights, dist/sky.js uniforms,
   and the ocean `uSunDir`/`uSunColor`: animate the sun direction and colour over about 20 min (C19,
   from memory). Keep night navy, never black: sky L 35 or more and sea L 15 or more (C9). Add
   long pink or orange dawn and dusk bands. Have the hemisphere light follow. In co-op, drive it
   from the host clock.) Impact M, effort M. **[UNSURE: the 20 min cycle is from memory (wiki
   unreachable). The "sea L 15 or more" floor is a design choice; Raft's near sea goes to about L10
   (C9), so L15 is a safe readability floor, not a Raft value.]**
9. **#9 Night sky: a moon disc and sparse stars.** (dist/sky.js: a hard-edged moon about 5 to 6 %
   W with a faint halo (C5), in our own flat style with no copied craters. Stars: about 50 to 150
   1 to 2 px points across the whole sky, dimmed to near-zero within about 40 deg of the moon, so a
   moonlit view shows a handful (C8).) Impact M, effort M. **[CORRECTED: moon "4 to 5 % W" -> "5 to
   6 % W"; C5's limb-to-limb re-measure gives 4.8 to 6.8 % W. Originality guardrail is respected
   (own style, no copied craters).]**
10. **#10 Add a low-sun or moon glint path.** (dist/ocean.js:127-132: raise the specular exponent
    and add a stretched anisotropic term so a low sun or the moon gives a broken column 2 to 3 % W
    wide from the horizon to the near water (C7). This only matters once #8 lowers the sun.)
    Impact M, effort S. **[CORRECTED: column width "2 to 3 % W" -> "2 to 4 % W" per C7.]**
11. **#11 Wire in the splash effects.** (dist/waterfx.js is unused: in dist/game.js, create it
    once, add `group`, call `update(dt)` in `frame()` at :820, and call `splash()` when the hook
    lands and when a player enters or leaves the water.) Impact M, effort S. **[CORRECTED (minor):
    the export is `createWaterEffects(T)` (waterfx.js:16); `frame()` is at game.js:820 as stated.]**
12. **#12 Make wave amplitude a runtime uniform, then add a rare rain shower.**
    (dist/ocean.js:11-24, :206-222: move the amplitudes to a uniform `uWaveScale` that is mirrored
    on the CPU so `getHeight` stays in sync. A shower scales the waves about 3 to 5x, pulls the fog
    in to about 15 to 80 m, adds faint 1 to 2 px streaks (about 25 on screen) and keeps the sky
    bright teal rather than grey (C11). Check deck clearance, since the raft floor is at 0.2 m and
    calm crests reach about 0.015 m.) Impact M, effort M. **[UNSURE: storm amplitude rests on one
    frame (C11, crest spacing not reproducible); 0.015 m crest height matches the ocean.js:10
    comment (base y -0.24 + 0.255).]**
13. **#13 Add occasional open-sea haze or fog banks.** (dist/game.js:283 fog: tween the fog near
    and far distances to about 10 and 70 m for a minute or two, so islands read as silhouettes at a
    contrast ratio of about 0.9 (C15). This is a cheap, original atmosphere beat with no Raft image
    to copy.) Impact L, effort S. **[VERIFIED: 0.90 to 0.93 dusk ratio re-measured in
    community_068.]**
14. **#14 Underwater view, only if diving is added later.** (dist/player-physics.js:22 currently
    keeps the eye above the water. If diving is added: a blue depth fog with visibility of about 20
    to 30 m, lighter toward the surface, animated caustics on the sand, and a back-face ocean
    surface seen from below (C18).) Impact L, effort L. **[UNSURE: player-physics.js:22
    SWIM_EYE_ABOVE_WATER 0.45 verified; visibility in metres is from memory, wiki unreachable.]**

## 5. Open questions and unsure items

- **FOV and angular sizes.** Raft's default FOV is not known from the images. The degree figures
  in C5 and C6 assume a horizontal FOV of about 90 deg (from memory, unverified). The screen-%
  figures are measured.
- **Storm wave scale in metres.** C11 is one frame. If read at Little Raft's horizon distance of
  about 125 m, the 1.5 % H undulation means a crest-to-trough of roughly 2 to 3 m. That is an
  estimate, not a measurement.
- **Star density.** community_102 is starry but probably not the default view. The moonlit frames
  show almost no stars. The recommendation in #9 is a compromise.
- **Rain.** The streak count is a visual estimate, because automatic detection failed. There are no
  lightning or open-sea fog references.
- **Day length.** The cycle length and the night share are from memory, unverified. There are no
  timed yt frames for the world topic.
- **The fleet/world WIP** is not on HEAD, and parts of it (the sky wiring, the foam collar) overlap
  with #1 and #3. Decide whether to land it first and then apply #2 and #5 on top. It should not
  ship its global "clear when looking down" turquoise as it stands.
- I did not render Little Raft for this spec. Its values come from reading the code, not from
  screenshots (`shoot.py` exists for a follow-up check).

## Verification log

Skeptic pass, 2026-11-21. Tag totals: **28 VERIFIED, 16 CORRECTED, 4 UNSURE**. By group:
- Claims C1 to C19: 9 VERIFIED (C1, C3, C4, C6, C10, C13, C14, C16, C17), 9 CORRECTED (C2, C5,
  C7, C8, C9, C11, C12, C15, C18), 1 UNSURE (C19).
- Change list #1 to #14: 6 VERIFIED (#1, #4, #5, #6, #7, #13), 5 CORRECTED (#2, #3, #9, #10,
  #11), 3 UNSURE (#8, #12, #14). The ranking is unchanged. No item asks to copy Raft's logo, icons,
  item art, UI, fonts or creatures; #9 already specifies its own style.
- Current-code and branch notes: 13 VERIFIED, 2 CORRECTED (the lace formula wording, and fog at a
  70 m spawn under fleet fog is 30 %, not 20 %).

The most important corrections:
1. **Foam coverage (C12, #3).** The 11 % soft-foam figure reproduces only in community_097, and
   there it is mist next to the raft. Open water in community_082 and community_134 is 0 to 4 %;
   the analyst's 13.7 % for 082 comes from the raft, walkway and HUD being counted. #3 now targets
   2 to 4 % on the open sea and 10 to 15 % near the raft.
2. **Moon size (C5, #9).** The disc has a 1 px hard limb. Limb to limb, it is 4.8 to 6.8 % W, not
   4.0 to 5.9 %. The half-max cut fell inside the disc because of limb darkening and crater
   blotches. #9 now says 5 to 6 % W.
3. **Sea brightening toward the horizon (C2, #2).** The sea just under the horizon is about 3x as
   bright as the sea 25 % H lower, not 2.5x.

Method. I used my own scripts in
`/tmp/claude-0/-home-user-little-raft/357b287e-6b25-59b7-a94d-bb803559ea72/scratchpad/world-skeptic/`
(hz.py, prof.py, rawprof.py, moonprof.py, disc.py, sun.py, sunrow.py, sunmax.py, foam.py,
foammask.py, foam_overlay.png, isl.py, p2.py, glint.py, stars.py, h024.py), with the venv's Pillow
and numpy (no scipy). Steps:
- I found the horizon as the strongest negative row step per column, then sampled the sky median
  4 px above it and the sea 3 to 7 px below it.
- For the moon I read raw row and column profiles through each centre.
- For the sun I took threshold runs along rows and columns.
- For foam I reapplied the analyst's mask (S < 0.55 and L >= P30 + 30) to the stated box and to
  several boxes of open water only, then checked it with a magenta overlay.
- For islands I read hex profiles across the pinnacle top, the waterline and the lateral tips.
- Code: grep and sed of dist/ (game.js, ocean.js, sky.js, waterfx.js, settings.js,
  player-physics.js).
- Branches: read-only `git show` and `git diff HEAD...origin/<branch>` on `wip/fleet/world` and
  `wip/feature/islands`, as the caller allowed. I ran no other git commands.

Images re-checked, viewed or measured:
- press: 2018-08-15-update-6-*-05, 2019-02-07-*-07, 2021-04-01-devblog-46-03,
  2018-07-13-development-blog-35-01.
- steam: community_094, _146, _053, _007, _102, _103, store_24, community_097, _082, _134,
  store_20, community_068, _024, _090, _119, _140, store_08, _121 (glint only, not resolved).
- Not re-checked (relied on the analyst's contact-sheet reading): community_039, _107, _113, _006,
  _047, _009, store_05, store_09, 2018-07-09-*-04, 2022-01-13-dev-blog-47-07.
