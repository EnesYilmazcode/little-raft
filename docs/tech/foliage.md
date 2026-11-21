# Foliage: stylized palms, bushes and grass with GPU wind

Prototype: `sandbox/foliage/`, with `foliage.js` (drop-in module), `island.js` (reference island consumer),
`index.html` (island scene + raft) and `shoot.py` (headless check). Adoption: `foliage-ADOPT.md`.

## Decision

- **Leaves are real geometry with vertex colours, not alpha-tested cards.** Every leaflet is 2 to 4 flat triangles,
  coloured from base to tip, drawn with a stock `MeshLambertMaterial({vertexColors, side: DoubleSide})`. This
  matches the rest of the game: `crafts.js` and `debris.js` already build palm leaves this way, and nothing in
  `dist/` uses textures. The cards variant (`?leaves=card`) is kept only for comparison.
- **Wind is applied in the vertex shader of the stock material** through `onBeforeCompile`, after `<begin_vertex>`.
  Fog, lights, shadow receiving and instancing all keep working. A matching `MeshDepthMaterial` twin
  (`customDepthMaterial`) sways the shadows too.
- **Sway weights are derived from object-space position, so no extra vertex attributes are needed.** Bend
  follows height above `uBase`. Flutter on a tree follows the horizontal distance from `uCrown`, so the trunk
  stays rigid. As a result the merged `crafts.js` palm sways without changing `crafts.js` at all:
  `F.swayCraftPalm(group)` patches its materials in place.
- **Each plant kind on each island is one `InstancedMesh`.** Instance colour adds tint variety. The phase comes
  from the instance's world position, and the wind direction is transformed into instance space, so rotated
  instances bend the same way.
- **LOD is cheap and two-level.**
  1. Per instance, a shader shrink fade (`FOL_FADE`): grass, ferns, broadleaf plants and bushes scale to 0
     toward the base between `uFade.x` and `uFade.y` metres from the eye. They sink into the ground, with no
     dither and no transparency.
  2. Whole kind per island: `F.lod(mesh, maxDist)` hides each `InstancedMesh` once the island is past its fade
     distance, so the vertices stop costing anything. Palms swap from the 2.4k-triangle near mesh to a
     410-triangle `palmFar` mesh with 2-triangle leaflets, 5 trunk segments and no coconuts.
  3. The palm swap is a **screen-door crossfade** (`dither: [from, to]` material param, `FOL_DITHER`): over
     ±5 m around the switch distance both meshes draw, each discarding a complementary half of an
     interleaved-gradient-noise pattern. The ramp uses the distance to the mesh origin (the island centre),
     the same distance `F.lod` uses, so the extra draw calls exist only inside that 10 m band.

## Wind model

All of the wind code lives in `foliage.js` as the `BODY` string. It runs in object space:

1. **Gust envelope.** `0.62 + 0.38 * sin(t * .47 + ph) * sin(t * .19 + ...)`. `ph` comes from the instance's
   world xz position, so neighbours gust out of step.
2. **Detail flutter.** Two incommensurate sines, weighted by `w^2`. For grass and bushes `w` is the normalized
   height. For trees it is the horizontal distance from the crown divided by `uReach`, multiplied by a
   height mask. The flutter moves leaves mostly vertically, which gives frond bob, plus a little downwind.
3. **Main bend.** The whole plant leans downwind by `bend * strength * h^2 * height`, then the point is
   renormalised to its original distance from the base. The trunk curves instead of shearing, and it never
   stretches.
4. **Fade** (optional define). `transformed *= 1 - smoothstep(near, far, distance(uEye, instanceOrigin))`.
   `uEye` is a uniform set in `F.update`. It deliberately does not use `cameraPosition`, because in the
   shadow pass `cameraPosition` is the light, and the shadows would then fade differently from the plants.
5. **Normal tilt** (colour pass only, `FOL_COLOR_PASS`). The view-space normal is tilted downwind by the slope
   of the bend (`2 * bend * strength * h`) plus the flutter bob, so lighting shimmers on fluttering leaflets
   and stays right in a storm. It is one extra `normalMatrix` multiply per vertex. The depth twin skips it.
6. **Canopy underside tint** (trees only, colour pass). Per vertex: `up = clamp(viewDir.y * 1.8)` times a leaf
   mask (far from the crown, high on the tree). The vertex colour is darkened by up to 38% when seen from
   below, and a yellow-green glow is added when looking toward the sun (`uSunDir`, shared, defaults to the
   game's sun position). This is the cheap translucency: it costs a few ALU ops per vertex and nothing per pixel.

There is one shared uniform object for time, wind direction, strength and eye position, so a frame costs one
write. Per-material uniforms hold the shape parameters: base, height, bend, flutter, crown, reach and fade.
Programs are shared through `customProgramCacheKey` (`foliage` + `T`/`F`/`2` flags). The whole island scene
uses 11 to 17 programs in total, ocean, sky and deck included.

### Two-sided lighting trick

On a `DoubleSide` material, three flips the normal for back faces. Leaves get up-biased normals (`n*.55 + up*.7`)
for a soft look. With the flip, grass backs and frond undersides rendered nearly black: this was the first
iteration, and the grass read as dark spikes. Foliage materials therefore undo the flip
(`normal *= faceDirection` again after `<normal_fragment_begin>`), so both faces use the authored normal.
Depth from below comes from a vertex-colour AO term instead: leaflets darken toward the crown (base of each
leaflet at 50%, ramping to 100% by 55% along the frond), plus the view-dependent underside tint above.

## Art

- **Palm** (island, about 4.3 m): a smooth-shaded 7-sided tube along a curved, tapering spine with a root
  flare. Its 15 ring bands each start slightly proud and dark (leaf scar) and taper in, lightening, to the
  next band, so the silhouette is ringed but the surface reads round. On top: a fibrous crown knob and 3
  green-yellow coconuts with spherical normals (readable from below), and 10 fronds on a golden-angle spiral
  in 3 tiers (high arching, mid, low drooping). The last 2 fronds are dry and golden and hang lower. Each frond
  has 22 V-folded leaflet pairs on a parabolic rib. Triangles: 2386 near (trunk 406), 410 far (trunk 50).
- **Bush**: 3 to 5 squashed, jittered icosahedron lumps (detail 1) with spherical normals, plus 7 five-petal
  flowers (pink, yellow or none per variant). 355 triangles.
- **Fern**: a rosette of 7 short pinnate fronds that reuses the palm-frond builder. 602 triangles.
- **Broadleaf**: an elephant-ear rosette of 6 paddle leaves on stems. 132 triangles, and the strongest
  silhouette for its cost.
- **Grass tuft**: 8 curved 3-triangle blades with up normals, 1.5x wider blades spread over a 1.7x wider
  footprint than the first version. 24 triangles. A paler 5-blade beach-grass variant scatters sparsely on the
  sand. The recipe is `GRASS` in `island.js` (`?grass=count,blades,width,spread` in the lab).
- **Island**: a polar-grid sand dome with a wobbly coastline, 0.35 m high at the centre by default (the islands
  plan value; the two background islands in the lab pass 0.7 and 1.1 for variety). Its vertex colours are wet sand, dry sand, a
  grass-edge band and a grassy interior, flat shaded. A few dodecahedron rocks sit at the shore. Palms lean
  out toward the sea.

Scatter is deterministic dart throwing (`scatter()`, seeded `rng`), so co-op peers get identical islands from a
single seed, as the islands feature plan requires.

## Numbers

These come from SwiftShader at 1280x720 on a 4-core box that other fleet agents were loading heavily (load
average around 35). The absolute milliseconds are meaningless. Read only the interleaved A/B rows, which
alternate frames inside one page so that load spikes hit both sides. The full JSON comes from
`python sandbox/foliage/shoot.py`.

Hero island counts at normal density: 6 palms, 12 bushes, 16 ferns, 9 broadleaf plants and 260 grass tufts
(520 in the first version; the table below is the first version, see "Improver pass" for the current numbers).
Sparse density (×0.35) roughly matches the islands plan (1 to 3 palms, 2 to 4 bushes). Dense is ×2.
Three islands are in the scene. The table excludes the ocean and sky.

| view | calls | triangles (incl. shadow pass) | programs | A/B: frame with foliage vs hidden (ms, median) | foliage share |
| --- | --- | --- | --- | --- | --- |
| raft (island at 18 m, craft palm in front) | 48 | 95.6k | 17 | 1294 vs 912 | ~30% |
| raft, no foliage baseline | 35 | 47.5k | 8 | (869 median) | - |
| beach (standing in the grass) | 17 | 71.8k | 11 | 1277 vs 647 | ~49% |
| canopy (looking up a palm) | 16 | 82.1k | 11 | 1071 vs 705 | ~34% |
| over (aerial, 18 m) | 27 | 80.5k | 14 | 629 vs 427 | ~32% |
| far (3 islands, horizon) | 58 | 103k | 17 | 956 vs 693 | ~27% |
| over, sparse | 27 | 50.6k | 14 | 587 vs 613 | noise (≈0) |
| over, dense | 27 | 124k | 14 | 1557 vs 905 | ~42% |
| beach, dense | 17 | 116k | 11 | 2040 vs 876 | ~57% |
| raft, alpha cards | 48 | 86.1k | 18 | 2018 vs 1195 | ~41% (geo: 30%) |
| canopy, alpha cards | 16 | 63.2k | 11 | 1245 vs 616 | ~50% (geo: 34%) |
| raft, Standard material | 48 | 95.6k | 17 | 1588 vs 1228 | ~23% (no measurable difference from Lambert) |
| raft, shadows off | 48 | 95.6k | 12 | 721 vs 564 | ~22% |

Shadow casting by foliage, A/B toggling `castShadow` on the foliage meshes: +28 to +130 ms in the near views,
and within noise in the raft and far views. The shadow pass is cheap because it is vertex-only, and the
triangle counts are small.

Wind is visible: the share of pixels that change between t and t+0.6 s at wind 0.4 is:

| region | swayed | no-foliage baseline (only ocean and sky move) |
| --- | --- | --- |
| craft palm region (raft view) | 26.9% | 0.17% |
| island region (raft view) | 9.6% | 1.5% |
| beach view, whole frame | 8.7% | 1.9% |

Per-geometry triangles: island palm 2176, palmFar 410, bush 355, fern 602, broadleaf 132, grass tuft 30.
The existing crafts.js palm is 8996, and gets wind with no geometry change. Building one palm geometry takes
about 20 ms of CPU, once per kit. `F.update` is O(registered LOD objects) and costs about 0 ms of JS.

**Reading these numbers.** SwiftShader is a CPU rasterizer, so its cost is dominated by fill. Foliage close
to the camera costs the most (beach view, especially dense), because blades and leaflets overlap. On a real
GPU the whole island is a few hundred thousand vertex shader runs and about 30 draw calls, which is small. The
tuning knob on weak hardware is grass density and the grass fade distance (`DEFAULT_PARAMS.grass.fade`), not
the palms.

### Improver pass (2026-11-21)

Changes: a smooth ringed trunk, crown AO and an underside/translucency tint, readable coconuts, wind normal
tilt, a dithered palm LOD crossfade, fewer but wider grass tufts, and island `top` 0.35. Timing under load
average 30 to 45 was too noisy to rank recipes; one grass A/B run even flipped sign between repeats. So cost is
judged on deterministic numbers. `lab.overdraw(prefix)` re-renders only the named foliage meshes, additively
with no depth test, and counts rasterised fragments per screen pixel. Before = commit `bbf0630`; after = the
current branch, same views, hero-island scope:

| view | calls before / after | triangles before / after | all-foliage fragments / px | grass fragments / px |
| --- | --- | --- | --- | --- |
| raft | 48 / 48 | 95.6k / 87.7k | 0.112 / 0.100 | 0.028 / 0.016 |
| beach | 17 / 17 | 71.8k / 63.8k | 1.255 / 1.097 (-13%) | 0.470 / 0.271 (-42%) |
| canopy | 16 / 13 | 82.1k / 59.4k | 0.404 / 0.444 * | 0 / 0 |
| over | 27 / 27 | 80.5k / 72.6k | 0.104 / 0.093 | 0.016 / 0.009 |
| far | 58 / 58 | 103k / 95.2k | 0.120 / 0.108 | 0.028 / 0.016 |

\* The canopy camera stands on the ground, which is now 0.55 m lower (`top` 0.35), so the palm fills more of
the frame. It is not a per-palm cost increase. Programs are unchanged (11 to 17). Grass depth complexity
(fragments per covered pixel) on the beach view fell from 2.99 to 2.02, while grass screen coverage kept 88%
(0.152 to 0.134 of the frame); the screenshots read just as lush. Grass recipes tried (beach fragments/px):
520x10 (0.456), 300x8 wide (0.274), 340x9 (0.250), 300x7 (0.211, visibly thinner), 260x8 w1.5 s1.7 (0.271,
chosen), 240x9 (0.301).

Crossfade (`lod` view, `?lod=` metres from the hero centre, LOD at 49 m): 57 calls at 40 m, 57 at 49 m (both
meshes in the band), 52 at 58 m. The band costs +2 calls per island only while the eye is 44 to 54 m away.
Wind motion is unchanged: 27.8% changed pixels in the craft palm region and 10.2% in the island region.
Triangles per palm: 2386 (trunk 196 to 406). The grass saving (520x30 to 260x24, -9.4k per island) more than
pays for that.

## Alternatives considered

| approach | verdict |
| --- | --- |
| Alpha-tested frond cards (salvage version, `?leaves=card`) | Measured: 10k fewer triangles in the scene, but the foliage cost was higher in A/B (raft 823 vs 382 ms, canopy 628 vs 366 ms), because large cards are mostly discarded pixels. The thin comb-like leaflets alias and shimmer, and it would be the only textured plant in an untextured game. Rejected. |
| Geometry leaves plus vertex colours (chosen) | Crisp low-poly silhouettes, MSAA anti-aliases the edges, no textures, and the same look as `crafts.js` palms and `debris.js` leaves. |
| Crossed-quad or billboard impostors for far palms | Not needed. `palmFar` is 410 triangles and fog covers the rest. At 3 islands the instance counts are tiny. |
| One giant GPU grass field (blade per instance, procedural shader) | Overkill for 5 to 9 m islands. Tufts in one InstancedMesh draw 520 tufts in one call. |
| Animating with the CPU (rotating frond meshes) | Cannot instance, costs per-object matrix uploads, and gives no shadow match. Rejected. |
| `MeshStandardMaterial` for foliage | Works (`?mat=standard`). There was no measurable difference under this noise, and it looks the same on rough, matte leaves. Lambert is the default because it is theoretically cheaper. The craft palm keeps its Standard materials, since `swayCraftPalm` patches whatever material it finds. |

## Weaknesses (honest)

- The craft (raft) palm comes from `crafts.js` and still has its own stacked-block trunk. It sways, but the
  new smooth trunk applies only to the island palms. Porting it means editing `crafts.js`, which this module
  avoids on purpose.
- The crossfade is screen-door dithering. At normal FOV and 44 to 54 m it is barely visible, but zoomed in
  (the `lod` shots use 3.5x zoom) the fronds speckle during the band. Discard disables early-z for the palm
  program on some GPUs. The palms are small on screen at that range, so this is cheap, but it is not free.
- The underside tint is per vertex, so on very large leaflets it would band. On these leaflets it is smooth.
  It reads `uSunDir`, which a day/night system has to keep updated.
- The normal tilt is an approximation (slope of the bend plus flutter), not a true derivative. That is fine at
  wind 0.4 to 1.0. Far stronger wind would need more than a lean anyway.
- The trunk ring bands are regular (15 equal bands). A real coconut palm has denser scars near the top.
- Grass and fern shrink-fade happens per instance, while the island-level LOD hides whole kinds. The fade
  distances are tuned for islands of 9 m radius or less. A much larger island would need chunked
  InstancedMeshes.
- Frond shadows on the 1024 shadow map (±25 m frustum, copied from game.js) are blobby wedges. That is the
  shadow map resolution, not foliage.
- Collisions and gather interaction are out of scope. `island.userData.palms` and `heightAt` are exposed for the
  islands module.
- SwiftShader timing under heavy shared load is noisy (the box sat at load average 30 to 45 during this pass).
  Trust the calls, triangles and overdraw numbers. The interleaved A/B milliseconds are indicative only.
