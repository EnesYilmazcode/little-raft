# Aspect: colour and lighting (Raft reference study, then Little Raft changes)

**Scope:** sky gradients by time of day, water colour (deep, near-horizon and foam), the balance between sun and ambient light, fog distance and colour, exposure, saturation and shadow tint. The study images are for internal use only. The change list asks for an *effect*, such as "clear tropical blue", in Little Raft's own palette. It does not ask us to copy Raft's colours. The hex values below are reference ranges.

**Method.** I ran `colour-lighting/stats.py` in the scratchpad over all 577 game frames in `references/raft/stills/{steam,press}` and `references/raft/*/yt`. For each frame it records the median of the top 1/6 of the image, the mean luminance (Rec.709 luma, 0–255), the 5th and 95th luminance percentiles and the mean HSV saturation. It also gives a rough sky class. I then checked the classes by eye on contact sheets (`sheet_*.jpg` and `g_day/g_dusk/g_night/g_cycle.jpg`, which have 10% grid ticks) and chose clean ocean views for point sampling. `hz.py` takes the median colour of a band across a chosen x-range at fixed offsets from the horizon: zenith (top 3%), the midpoint of the sky, 0.8–2.5% above the horizon, 0.8–2.5% below it, then 10% and 25% of screen height below it. `pt.py` takes the median of a 7×7 patch at a pixel. `sun.py` measures the radial falloff of the sun or moon glow, and `foam.py` gives the 99th and 99.8th percentile water pixels. For Little Raft I took headless Chrome screenshots of the current `dist/` build (`colour-lighting/lr/0[1-5]-*.png`, 1280×720) and sampled them with the same tools.

**Images examined** (sampled = point-measured; all 577 got whole-frame stats):
- Day (20 sampled): press/2021-06-21-update-13-the-renovation-update-out-now-{02,04,12}.jpg, press/2021-04-01-devblog-46-03.jpg, steam/store_{01,09,10}.jpg, steam/community_{014,032,034,039,082,089,092,107,124}.jpg, building/yt/2rqSgyWX6N0_0045.jpg, building/yt/YSMrrtHtpIc_{0430,0745,1045}.jpg
- Dusk/dawn (15): press/steam-store-24.jpg, steam/community_{008,010,016,022,035,037,040,050,057,067,068,085,103,121}.jpg
- Night (15): steam/community_{020,025,033,045,053,056,079,094,095,100,102,120,140,146}.jpg, press/2018-07-09-raft-building-event-winners-future-updat-04.jpg
- Storm (1): steam/community_024.jpg
- Day-to-night sequence: inventory-crafting/yt/qVVltzNBaGw_{0135,0250,0305,0325,0345,0400,0455,0535,0545,0600,0615}.jpg
- Little Raft now: scratchpad colour-lighting/lr/03-horizon.png, 04-turn.png, 05-down.png

The pixel coordinates below are in each image's native resolution. Percentages are of image width (w) or height (h).

---

## 2. Observations / spec

### Day sky
**C1 – The day sky is brightest at the horizon and gets bluer and more saturated towards the zenith.** Clean ocean views:

| image | zenith | sky mid | just above horizon | horizon at |
|---|---|---|---|---|
| press/…out-now-12.jpg (x 5–55%) | #47d1ea H189 S.70 V.92 | #60e2ee | #b0e7ea H183 S.25 V.92 | 38% h |
| press/2021-04-01-devblog-46-03.jpg (x 30–45%) | #78a7d8 H211 S.44 V.85 | #a1d0ec | #c6f3f1 H177 S.19 V.95 | 71% h |
| steam/store_01.jpg (x 0–28%) | #0f8cbd H197 S.92 V.74 | #2db1ce | #85d2d8 H184 S.38 V.85 | 44% h |
| building/yt/2rqSgyWX6N0_0045.jpg (x 85–100%) | #93f2fa H185 S.41 V.98 | #82fdf9 | #baf9f5 H176 S.25 V.98 | 41% h |
| steam/community_034.jpg (x 78–98%) | #7edbf9 H195 S.49 V.98 | #6debfb | #bbf5fa H185 S.25 V.98 | 41% h |
| steam/community_014.jpg (x 85–100%) | #5ca3de H207 S.59 V.87 | #60c0eb | — | ~60% h |

Range. Zenith: H185–211, S0.40–0.92, V0.74–0.98. Horizon band: H176–185, S0.19–0.38, V0.85–0.98, which is a near-white pale cyan. In every clean frame the horizon is the brightest part of the sky. The 2018–2019 YouTube builds (building/yt/*) use a paler, cyan-white zenith (#8dfff8–#9afdf9). The 2021+ stills use a deeper blue zenith.

**C2 – The day sky has a hue of about 185–210, cyan to azure.** No day frame among the 20 has a sky hue outside 176–211. This also holds for the 438 frames that the automatic classifier put in the "blue" class, with a top-band hue of 170–230.

**C3 – The sun has a very large, soft bloom.** In press/2021-04-01-devblog-46-03.jpg the sun sits at (58% w, 29% h). The core is #fafafa at luminance (L) 250, against L168 for the sky well away from it. Glow brightness falls to half at a radius of 9.7% w and to a quarter at 26% w. The sky 5% w from the sun is #dbe6f1. There is no hard sun disk at this exposure, only a clipped white blob of about 3% w.

### Water by day
**C4 – The water runs from pale at the horizon to deep, saturated blue near the camera.** Samples are taken at the same x-ranges as C1:

| image | just below horizon | +10% h | +25% h |
|---|---|---|---|
| press/…out-now-12.jpg | #59b8c8 H189 S.56 V.78 | #0794af H190 S.96 V.69 | #026b91 H196 S.99 V.57 |
| press/2021-04-01-devblog-46-03.jpg | #69c2cd S.49 V.80 | #1d8ca7 S.83 V.65 | — |
| steam/store_01.jpg | #55bcca S.58 V.79 | #0389aa S.98 V.67 | #034971 H202 S.97 V.44 |
| building/yt/2rqSgyWX6N0_0045.jpg | #7de4e3 S.45 V.89 | #28bbc3 S.79 V.76 | #0d8198 H190 S.91 V.60 |
| steam/community_034.jpg | #b0f5f9 (haze) | #2dc6d7 S.79 V.84 | #02779c H194 S.99 V.61 |
| steam/community_082.jpg (x 80–100%) | #a7f5fa (haze) | #6cc3d2 S.49 V.82 | #0887a7 H192 S.95 V.65 |
| steam/community_124.jpg | — | #02749a S.99 V.60 | #05527c H201 S.96 V.49 |

Range. Just below the horizon: H184–189, S0.45–0.58, V0.78–0.89. At +10% h: H183–193, S0.73–0.98, V0.60–0.84. At +25% h: H190–202, S0.91–0.99, V0.44–0.65. Near water is very saturated, with S above 0.9, and darker than the sky. The hue moves from cyan to blue with depth. It does **not** move towards green.

**C5 – Foam and whitecaps are a cool off-white, not pure white.** The brightest 0.2% of open-water pixels measure #b8d7df (press/…out-now-12.jpg), #c7d6d5 (building/yt/2rqSgyWX6N0_0045.jpg) and #cbe5ea (steam/community_082.jpg wake). That is H176–192, S0.07–0.17, V0.84–0.92. Foam is small: the whitecap in press/…out-now-12.jpg at (190,238) is about 4% w × 1% h. Foam takes up less than 1% of the water area in calm frames.

**C6 – The haze is a bright, saturated cyan, and it eats the horizon when the camera is high.** Samples from steam/community_032.jpg (1280×720, taken from a hilltop):

| point | colour | luminance |
|---|---|---|
| sky (640,10) | #8af2fc | L221 |
| haze band (300,200) | #a6fbfe | L233 |
| far water (300,250) | #66eaf6 | — |
| mid water (300,300) | #2bcce2 | — |
| distant tower (632,200) | #5eb6ce | L165 |
| sky beside the tower (700,200) | #8cf9fe | L226 |
| ship hull (620,335) | #2290a9 | L122 |
| water beside the hull (850,335) | #02aecf | L140 |

There is no visible horizon line. Objects about 150 m away (an estimate) keep roughly 27% luminance contrast against the haze. The fog colour is the horizon colour (C1), not grey.

**C7 – Distance haze sits only in a thin band at the horizon when the camera is at deck height.** In press/…out-now-12.jpg the colour stays saturated (S0.96 at +10% h) until about 1.5% h above the horizon. The washed-out band, with S below 0.6, takes up about 2–3% of screen height on each side of the horizon line. steam/store_01.jpg and building/yt/2rqSgyWX6N0_0045.jpg match this.

### Light balance, exposure, saturation and shadows
**C8 – Day frames are mid-bright and strongly saturated.** Whole-frame stats, as luma 0–255 and mean HSV S:

| set | mean L (range) | p5 | p95 | mean S (range) |
|---|---|---|---|---|
| Raft day (n=20) | 134 (91–174) | 62 | 214 | 0.59 (0.39–0.73) |
| Raft dusk (n=15) | 95 (30–142) | 31 | 192 | 0.53 (0.33–0.79) |
| Raft night (n=15) | 31 (11–53) | 8 | 76 | 0.89 (0.71–0.98) |
| Raft storm (n=1, steam/community_024.jpg) | 157 | 82 | 211 | 0.54 |
| **Little Raft now** (lr/04-turn.png, lr/03-horizon.png) | 171–180 | 99 | 207 | **0.21–0.29** |

**C9 – Shadows are soft and fairly weak, and they shift towards teal or green.** In press/…out-now-02.jpg (1280×720):

| point | colour | luminance |
|---|---|---|
| sunlit deck (500,650) | #a3895c H38 | L139 |
| door shadow on the deck (712,632) | #817053 H38 | L114, ratio 0.82 |
| rail-post shadow (195,606) | #555846 H70 | L86, ratio 0.62 |
| sunlit wall (450,470) | #6c5d4b H33 | L95 |
| shaded wall (880,470) | #3e4a43 H145 | L71, ratio 0.75 |
| interior (690,560) | #365047 H159 | — |

steam/store_01.jpg agrees: the lit deck (400,640) is #706546 H44 L101 and the planter shadow (950,620) is #484e3c H80 L75, a ratio of 0.74. So the shadow-to-lit luminance ratio is about 0.6–0.8, and the hue moves 30–110° towards green and teal, from sky-coloured ambient light.

**C10 – The sunlit wood is a muted mid-tone, not bright orange.** Deck samples: #a3895c S.44 V.64 (press/…out-now-02.jpg), #706546 S.37 V.44 (steam/store_01.jpg) and #9a8261 S.37 V.60 (press/…out-now-12.jpg (350,420)). In Little Raft the deck is #c48e47–#d0a056, with S0.59–0.64 and V0.77–0.82 (lr/03-horizon.png (560,470) and (250,600)).

### Dusk and dawn
**C11 – Dusk is strongly lit from one side.** The sun side is pink or magenta, the side away from it is blue, and the zenith is indigo.

| image | sun side, above horizon | away side, above horizon | zenith (sun side) | water below horizon (sun side) |
|---|---|---|---|---|
| steam/community_035.jpg | #d87d9b H340 S.42 V.85 | #386f8b H200 | #372856 H260 V.34 | #8b5173 |
| steam/community_057.jpg | #cb6f94 H336 | #025081 H203 | #2d0f3d H279 V.24 | #91406d |
| steam/community_121.jpg | #ffb9d3 H338 V1.0 | #4e8aae H202 | #1f2870 H233 | #cd8bb2 |
| steam/community_103.jpg (higher sun) | #fff5fd | #ceebf7 | #8b6ebf / #406cc4 | #bac6dd |

Water at +10% to +25% h is indigo to violet: #4d2b53, #311330, #634477 and #28214f. The sun glow is again huge. In steam/community_121.jpg the core is #ffbcd5 with a half-brightness radius of 11.9% w. In steam/community_040.jpg the half-brightness radius is 21.9% w. Sun-path glints on the water form a column about 13–15% w wide, coloured #8f5475 (steam/community_035.jpg) to #b77ba7 (steam/community_121.jpg).

### Night
**C12 – Night is a deep, highly saturated navy.** The band just above the horizon is a little brighter than the zenith, and there is a moon with a glow.

| image | zenith | above horizon | water below horizon | water +10% h |
|---|---|---|---|---|
| steam/community_020.jpg | #031239 | #022f51 | #021f40 | #030e2f |
| steam/community_025.jpg | #030c33 | #03284e | #02163d | #030a34 |
| steam/community_094.jpg | #00103b | #00305f | #00325f | #002251 |

Range: H206–231, S0.94–1.0, V0.20–0.37. The moon glow (steam/community_033.jpg and community_146.jpg) has a core of #9eb9db/#688fc3, a half-brightness radius of 2.5–3.8% w and a faint halo out to 20–33% w. The moon path on the water is narrow, 1.3–1.9% w (steam/community_094.jpg #80a5c9, steam/community_025.jpg #75b9d6). Lantern-lit decks stay readable and warm: in steam/community_056.jpg the deck at (1100,600) is #904f3e L92, while the sky at (200,40) is #03113d L17.

**C13 – The day–night transition takes minutes.** In inventory-crafting/yt/qVVltzNBaGw the sky at (900,90) and the deck at (860,420) change as follows:

| time | sky | deck |
|---|---|---|
| 250 s | #083054 | L57 |
| 305 s | — | L42 |
| 345 s | #05142f | L15 |
| 455 s | #020725 | L8 |
| 535 s | #06284b | — |
| 615 s | #0a557a | L37 (left deck L78) |

Darkness lasts at least 110 s of video, and dusk to dawn takes about 230–310 s. The video may be edited, so treat this as a lower bound. This 2018 build's night is much darker than the 2021+ stills in C12. From memory, unverified: one in-game day lasts about 20+ minutes.

**C14 – Storms desaturate towards cyan-grey but keep the bright horizon.** steam/community_024.jpg (x 30–70%) measures zenith #67bacb, mid sky #59b2c4 (darker than the zenith), horizon #a3e8f2, water below the horizon #54b1c9 and water at +10% h #187694, with rain streaks. This is a single sample.

---

## 3. Little Raft today

| Area | Current code | Measured result (lr/*.png) | Gap vs Raft |
|---|---|---|---|
| Sky | `dist/game.js:283` sets `scene.background = '#cbd2c0'` (flat). The gradient sky in `dist/sky.js` is **never imported**: `grep createSky dist/*.js` finds only sky.js. Its defaults, horizon #cbd2c0 and zenith #9ebabb (`sky.js:113-114`), are also grey-green. | The zenith, mid sky and horizon all measure #cbd2c0 H83 S.09 V.82 (lr/04-turn.png). | Hue 83° (olive-grey) against 176–211°. There is no gradient, and saturation is 0.09 against 0.2–0.9 (C1, C2). |
| Fog | `game.js:283` sets `Fog('#cbd2c0', 25, 125)`. The camera far plane is 200 (`game.js:284`). | Water at +10% h is already #9ab0aa S.13 (lr/04-turn.png (150,440)). | Raft keeps S above 0.7 until about 2% h from the horizon (C7). Our fog starts at 25 m and is grey-cream instead of bright cyan (C6). |
| Ocean colours | `ocean.js:165-170` has better defaults (deep #0a4a5a, shallow #1fa9a8, sky #99dfe1, zenith #5fb6dc), but `game.js:290` overrides them with deep #14505a, shallow #3f8c88, zenith #a9c1c0 and sky #cbd2c0. | Water at +25% h measures #619d9a H177 S.38 V.62 (lr/04-turn.png (560,540)). The near-right water is #6f918e S.23 (lr/03-horizon.png). | Ours is greyer and greener (H175 S0.23–0.38). Raft's is H190–202 S0.9+ (C4). |
| Water reflection | `ocean.js:110-114`: fresnel is capped at 0.72, and the reflection colour mixes uSky and uZenith, which are cream in game.js. `ocean.js:148-149` fades to uSky between fadeNear 28 and fadeFar 125 (`game.js:290`). | The grazing water takes on the cream sky colour. | Most of the screen-space water is greyed by the reflection and the fade. |
| Lights | `game.js:288` sets `HemisphereLight('#f2ead4', '#3d6b6a', 1.8)`. `game.js:289` sets `DirectionalLight('#fff0c7', 2.5)` at a fixed position of (-15,28,12), so the sun is 55° up. | Using the Lambert terms, the shadowed-to-lit ratio is about 1.8/(1.8+2.5·0.82) ≈ 0.47 (computed, not measured). The shadow tint is the cream hemisphere colour. | Raft's ratio is 0.6–0.8, with shadows shifted 30–110° towards teal (C9). Ours are darker and warm or neutral. |
| Clouds | `game.js:301`: 24 lit sphere clusters, colour #e7f9eb, at a height of 17–25. | Viewed from below they look dark teal: #194b44 S.67 V.29 at (750,40) and #4b6f63 at (600,195) in lr/04-turn.png. | They read as dark rocks floating in the sky. The hemisphere ground colour #3d6b6a and the sun lighting only their tops cause this. |
| Exposure and tone mapping | `game.js:287`: ACES Filmic, exposure 1.0, sRGB output. The sky shader is not tone-mapped (`sky.js:135`). The ocean is tone-mapped, then faded to the untone-mapped sky (`ocean.js:146-149`). | Mean L 171–180, p5 99, p95 207, mean S 0.21–0.29 (C8). | The frame is too bright and flat: p5 is 99 against 62, and saturation is half of Raft's. |
| Time of day | None. The sun is static (`game.js:289`) and the sky colours are fixed. | — | Raft has day, dusk, night and storm palettes (C11–C14). |
| Splash FX | `dist/waterfx.js:11-14`: foam #e9e6d6 (warm cream), pale teal #a9cfc8, ring #cfe0d8. The module is **never imported**. | — | Raft's foam is cool, #b8d7df–#cbe5ea (C5). |
| Ocean foam | `ocean.js:134-143` uses uFoam #eefbf8 and fades out between 30 and 90 m. | The lace reads well. | OK. Only the tint needs to follow the sky. |
| Sun visual | No sun in the scene: sky.js is unused. The specular is `ocean.js:130-132`. | No sun disk, glow or sun path. | Raft's bloom has a half-brightness radius of about 10% w by day and 12–22% w at dusk (C3, C11). |
| CSS | `graphics.css:33` sets the body to #0c2230 and `style.css:2` sets it to #87d8df. `index.html` theme-color is #096b82. The canvas has no colour filter. | — | A load flash appears before the first frame. This is minor. |

---

## 4. Ranked change list

#1 **Switch to a clear, tropical-blue day sky and wire in the gradient dome** (`dist/game.js:283`, `dist/sky.js:113-120`). Import `createSky` and add `sky.group`. Set the horizon to a bright pale cyan-white (target H180–188, S0.2–0.35, V0.92–0.97) and the zenith to a deeper azure (H195–210, S0.5–0.8, V0.8–0.9). The horizon must stay the brightest part of the sky (C1, C2). Use `sky.horizonColor` for `scene.background` and the fog so they stay matched. Pick our own hues inside these ranges, for example a slightly warmer, softer azure than Raft's. **Impact H, effort S.**

#2 **Re-key the ocean body to deep, saturated blue that darkens with distance from the horizon** (`dist/game.js:290` overrides, `dist/ocean.js:116-125`). Set uDeep to about H198–205, S0.85–0.95, V0.40–0.50 and uShallow to about H188–193, S0.8–0.9, V0.65–0.75, and set the uZenith reflection to the new sky zenith. Remove the greenish #3f8c88 and the grey #a9c1c0. Target an on-screen V of about 0.78 just below the horizon, about 0.68 at +10% h and about 0.5 at +25% h (C4). **Impact H, effort S.**

#3 **Push the fog and ocean fade out, and make them the horizon colour** (`dist/game.js:283` Fog 25/125, then `ocean.js` fadeNear 28 and fadeFar 125 at `game.js:290`). Start the fade at about 60 m and fully fog at about 170 m, which is under camera.far 200. Then the washed-out band covers only about 2–4% of screen height around the horizon at deck height, with S above 0.7 below that (C7). Islands and far objects should keep about 25–30% contrast at about 100–150 m (C6). **Impact H, effort S.**

#4 **Lower the brightness, add contrast and raise saturation** (`dist/game.js:287-289`). Targets for a day frame: mean luma 125–145, p5 about 55–65, p95 about 210, mean saturation 0.5–0.6 (C8). Start by cutting the hemisphere light from 1.8 to about 1.0–1.2 and raising the sun from 2.5 to about 2.8–3.2. Then tune toneMappingExposure (0.9–1.1) against these numbers in a screenshot. Also try `T.AgXToneMapping` or `NeutralToneMapping`, because ACES desaturates our bright cyan. Re-measure with the scratchpad `ptl.py`. **Impact H, effort M.**

#5 **Give shadows a cool sky-coloured ambient** (`dist/game.js:288`). Change the hemisphere sky colour from cream #f2ead4 to a light sky-cyan (taken from the new zenith, but brighter) and the ground colour to a sea blue-teal. Target a shadowed-to-lit luminance ratio of about 0.65–0.8, with shadows shifted towards teal (C9). Keep the key light warm (#fff0c7 is fine) for a warm-sun, cool-shade split. **Impact H, effort S.**

#6 **Fix the dark floating cloud blobs** (`dist/game.js:301`). Either remove the sphere clouds and rely on the procedural clouds in `sky.js:80-95`, or switch them to an unlit `MeshBasicMaterial` with `fog:false`, coloured lit #f4f1e6 on top and shade about 10–15% darker, tinted by the sky. They currently measure #194b44 V0.29 against the sky (§3). **Impact H, effort S.**

#7 **Add a big, soft sun glow and a sun path on the water** (`dist/sky.js:71-73`, `dist/ocean.js:128-132`). Make the halo's half-brightness radius about 8–12% of screen width at FOV 70 (about 6–9° of angle), with a clipped core of about 3% w (C3). That means a lower exponent on the broad term (pow 6 → pow 3–4) and a higher weight. Widen the ocean's broad sheen so a glint column under the sun appears at low sun angles (C11, C12). **Impact M, effort S.**

#8 **Add a time-of-day cycle with keyframed palettes** (a new small module, or an extension of `sky.js`, driven from `game.js`). Interpolate the sun direction, sun colour and intensity, hemisphere colours, sky horizon and zenith, fog colour, and ocean deep, shallow and sky uniforms. Use four keys: day (#1–#5), dusk, night and dawn. Make the transitions minutes long (C13). From memory, unverified: one in-game day is about 20+ minutes. Start with an option to lock it at "day". **Impact H, effort L.**

#9 **Design an original dusk palette with strong sun-side and away-side contrast** (part of #8). The lesson from Raft is the *structure*: the sky on the sun side is warm and bright, the side away from the sun is blue, the zenith is dark and cool, and the water is a darker, cooler version of the sky (C11). For our own look, use an amber, apricot or coral sun side (H15–35) rather than Raft's magenta-pink (H336–340). Use a dusky blue-violet zenith at V0.3–0.45. Target a mean frame luma of about 80–100. **Impact M, effort M** (with #8).

#10 **Night: deep saturated blue, with readability and warm lights as the focus** (part of #8). Sky and sea should sit around H210–230, S0.9+ and V0.2–0.35, with the band above the horizon slightly brighter than the zenith. Add a moon with a tight core (half-brightness radius about 3% w) and a soft halo out to about 25% w, plus a narrow moon path of about 1.5–2% w on the water (C12). Target a mean luma of about 30–45, and do not let it go lower (an older Raft build reached L8 on the deck, which is unreadable; C13). Lantern pools should stay warm at about L90 (`game.js:360` lantern) as the anchor. **Impact M, effort M.**

#11 **Remove the cream from the water reflection and cap the fresnel** (`dist/ocean.js:110-114`). Once #1 lands, the reflection automatically picks up blue. Also lower the fresnel cap from 0.72 to about 0.5 so that near water keeps its body colour, and raise the skyRefl blend to the zenith higher up (`smoothstep(0.0, 0.6, R.y)` → `(0.0, 0.3)`). **Impact M, effort S.**

#12 **Make foam a cool off-white tied to the sky** (`dist/ocean.js:170` uFoam #eefbf8, `dist/waterfx.js:11-13`). Target H180–195, S0.07–0.17, V0.85–0.92 (C5). Change waterfx's warm cream #e9e6d6 to the same cool off-white, then import `createWaterEffects` in game.js for hook and debris splashes. Foam should stay under about 1% of the water area in calm weather. **Impact L, effort S** (the wiring is M).

#13 **Tone down the deck wood so it sits in the scene** (`dist/game.js:43` TIMBER set, `wood.js`, `deck.js`). The current sunlit deck measures S0.59–0.64 and V0.77–0.82, against Raft's S0.37–0.44 and V0.44–0.64 (C10). Make about a 15–20% saturation cut and a little less value. Together with #4 this stops the raft looking pasted onto a grey sea. **Impact M, effort S.**

#14 **Add an optional storm or overcast palette** (later, inside #8). Desaturate the sky to a cyan-grey (S0.45–0.55, V0.75–0.8) and keep the horizon brighter than mid-sky (C14). Use darker water at +10% h (about V0.58), and lower the sun intensity by about 50% for weaker shadows. **Impact L, effort M.**

#15 **Match the page backdrop to the sky** (`dist/style.css:2` body #87d8df, `dist/graphics.css:33` body #0c2230, `dist/index.html` theme-color #096b82). Set the body and canvas background to the new horizon colour, so the first frame and any resize gaps do not flash navy. **Impact L, effort S.**

---

## 5. Open questions / UNSURE

- **Build versions are mixed.** The 2018–2019 YouTube frames (building/yt/*, inventory-crafting/yt/qVVltzNBaGw_*) have a paler cyan zenith and much darker nights than the 2021+ press and Steam stills. I based the targets mostly on the 2021+ stills.
- **Grading and compression.** The JPEGs, the YouTube re-encoding and some community shots may have been post-processed, and some are probably photo-mode shots (steam/community_*). Treat the hex values as ±10% in V and S.
- **Sky sampling.** On busy frames the automatic horizon finder was unreliable. I discarded rows where it landed on a raft or a ship: store_10, community_092, community_089, YSMrrtHtpIc_0745/1045, community_032 sky_hz and community_107 sky_hz.
- **Length of the day cycle.** The only evidence is one possibly edited video (C13). The ~20-minute day is from memory and unverified.
- **Storm.** There is only one sample (steam/community_024.jpg).
- **Little Raft shadow ratio.** This was computed from the light intensities, not measured from a clean shadow in our screenshots. The headless run uses SwiftShader, so colours may differ slightly from GPU output.
- **Dusk hue for Little Raft.** #9 proposes amber or coral to keep our identity. The team may still want a pink-violet option. That is an art-direction call.
