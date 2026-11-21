# Art lane: textures, materials and lighting

Branch `claude/raft-art`. The goal is to make Little Raft look like the game Raft (bright, warm, tropical, honey-tan planks on a saturated blue-teal sea) with original procedural art. There are no image assets and no new npm dependencies.

**How to see it:** add `?art=1` to the game URL. Without it the game looks exactly as it does on `main`.

## What was built

### `dist/textures.js` (procedural texture library)

- **Generation:** generates 11 seamless 224 px tiles once at startup from `dist/texgen/*.js`, then packs them into two 1024² RGBA8 atlases:
  - `map` (sRGB): albedo in RGB, and alpha holding either transparency/cutout (leaf, plastic, foam) or metalness (scrap).
  - `normalMap` (linear): a tangent-space normal derived from height with a wrapped Sobel filter (OpenGL +Y), with roughness in the alpha.
- **Layout:** a 4x4 grid of 256 px cells. Each 224 px tile is surrounded by a 16 px wrapped gutter so bilinear filtering and mipmaps don't bleed. Mipmaps are generated on the GPU.
- **Memory:** about 11.2 MB of GPU memory including mipmaps, against a 16 MB budget. The CPU copies are released after upload. If three ever needs them again (context restore, clone), a getter rebuilds them on demand.
- **Build time:** about 230 ms warm in Node, and about 0.6 s cold in headless Chrome. `getAtlasAsync(T)` builds on up to 4 module workers and keeps the main thread free; it has been tested in Chrome.
- **API:**
  - `buildAtlasData()`: pure data, runs in Node or a worker.
  - `getAtlas(T)`: wraps the data in three.js `DataTexture`s.
  - `getAtlasAsync(T)`.
  - `GENERATORS`, `ATLAS`, `CELL`, `PAD`, `TILE`.

### `dist/texgen/` (one small generator per material, plus `noise.js`)

All generators are deterministic and seamless, and each takes 6–26 ms.

| cell | what it draws |
|---|---|
| `planks` | 5 honey-tan boards across, staggered butt joints, jittered nail heads, a hashed knot per board, warm gaps, worn edges, an occasional grey weathered board |
| `plank` | interior of one deck board: fine grain plus broad grain bands that survive mipmapping, sun-bleached streaks, light scratches |
| `bark` | meandering vertical fissures that split and merge into a long diamond net, rounded ridges with dry tops, a hint of lichen |
| `plastic` | crumpled milky white-blue sheet: big soft folds, pulled wrinkles, facets at three sizes; alpha 0.86–0.98 |
| `leaf` | palm frond: low midrib, alternating leaflets with drifting spacing and veins, faint yellow tips, transparent slits |
| `rope` | three-strand twisted lay with yarn ridges and loose fibres (tuned for the deck lashing torus) |
| `scrap` | weathered steel, brown rust with run-off streaks, faded blue (rarely red) chipped paint, scratches, a riveted overlap strip, a dent; metalness mask |
| `sand` | warm sand with soft warped wind ripples, grain, shell specks, slow tone drift |
| `rock` | mixed-size boulder facets with tilt and dome, thin cracks, moss on the tops |
| `foam` | lacy sea foam: bubble holes at three sizes opening into clear water, several drifts per tile |
| `cloth` | sail canvas: plain weave, slub, weather mottling, one stitched seam |

`noise.js` provides periodic value noise and fbm (with a lattice cache), Worley noise, `worleyGrid` (fast table-driven Worley), `hash2`, `rng`, `smooth` and `mix`.

### `dist/materials.js` (shared material registry and lighting rig)

- **`PRESETS`:** 12 `MeshStandardMaterial` presets: planks, plank, bark, plastic, foliage, leaf, rope, scrap, sand, rock, foam, cloth. Each preset sets the roughness scale, metalness, normalScale, repeat, transparency, cutout and side.
- **Shader patch:** a single patch makes every map read its own atlas cell with `fract()` + `textureGrad`, so cells repeat like ordinary textures with no mip seams. It also adds a per-material UV phase, reads roughness from the normal-atlas alpha, reads metalness from the albedo alpha (scrap), and applies an alpha cutout via the `lrCut` uniform.
  - Leaf cutout deliberately avoids `material.alphaTest`. With alphaTest, three's shadow depth material would copy the map and sample the whole atlas with leaf UVs.
- **Programs:** all materials share programs under the key `lr-atlas-2`. Measured: 6 programs serve 13 materials. `onBeforeCompile` runs once per material, so each material keeps its own uniforms. **Bump the key whenever `patch()` changes.**
- **`getMaterial(T, name, {color, repeat})`:** cached. With a game palette colour the texture is tinted: the texture's own average moves 65% of the way to the colour, with a clamped per-channel gain, so dark palette colours don't turn the texture to mud.
- **`materialForColor(T, hex)`:** maps the game's palette hexes (`COLOR_PRESETS`) to presets. It also returns a soft self-lit white for the mesh clouds, and `null` for anything unknown (avatars, hook, UI ghosts).
- **`LIGHTING` + `applyLighting(scene, renderer, L, {ocean, T})`:** the recommended rig:
  - Sky-blue hemisphere light `#bfe3ff` with a sea-teal ground colour `#86b6bc` (×1.1).
  - Warm sun `#ffe7c2` ×3.2, about 3x the fill.
  - Horizon-matched fog `#c6e3f0` from 38 to 150 m.
  - ACES tone mapping at exposure 1.05.
  - A sky dome from `sky.js` (zenith `#6fb4e6`, white cumulus wisps).
  - `applyOceanLook` retints `ocean.js`: deep `#05497a`, shallow `#13a0b0`, and a fade into the fog colour so there is no horizon band.
- **Also exports:** `artEnabled()` and `artStats(T)`.

## Hooks into existing files (all tiny, commented `art lane hook`)

- **`dist/game.js`** (4 changes, all gated on `ART.artEnabled()`, i.e. `?art=1` in the page URL):
  1. Import: `import * as ART from './materials.js?...'`.
  2. `mat(color)`: `let m = ART.artEnabled() ? ART.materialForColor(T, color) : null;` runs first; the old wood or flat material is the fallback.
  3. After the ocean is created: `ART.applyLighting(scene, renderer, ART.LIGHTING, {ocean, T})`.
  4. Plastic jug: the jug body's own material is swapped for `mat('#f2f0e6')`, the cached plastic preset. Because it comes from `mat()`, `disposeGeometry` never disposes the shared atlas.
- **`package.json`:** `npm test` also runs `tests/art.test.mjs`.

To make the art permanent, replace `ART.artEnabled()` with `true` at those 3 call sites. Recommended at that point: call `await ART.getAtlasAsync(T)` before the scene is built, so the ~0.6 s cold build happens off the main thread.

## Demo and tools (`sandbox/art/`)

- **`index.html`:** every preset on a sphere, a cube and a plank, under the recommended lighting.
  - Toggles: **Flat** (plain colour, for before/after), **Show atlas** and **Rotate**. URL flags `?flat`, `?atlas` and `?still` do the same.
  - A stats panel shows build ms, GPU MB, programs and draw calls.
  - To view it, serve the repo root and open `/sandbox/art/`.
- **`shoot_demo.mjs <out>`:** headless Playwright shots of the demo (`demo.png`, `demo-flat.png`, `demo-atlas.png`). It exits non-zero on any page error.
- **`shoot_art.py dist <out> '?art=1'`:** a copy of `shoot.py` that launches the preinstalled Chromium (no `channel`) and accepts a URL query.
- **`preview.mjs <out> [cell]`:** a Node-only PNG preview of the atlas, or a 2x2 tiled albedo|normal|roughness strip for one cell.
- **`notes/`:** the research brief, the builder brief and critique round 1.

## Tests (`tests/art.test.mjs`, run by `npm test`)

- Every generator gets a cell, and the build stays fast.
- GPU memory is under 16 MB.
- Every cell tiles seamlessly in albedo and normal: the step across the wrap is no bigger than the strongest interior line. Scrap's riveted plate edge is a declared exception.
- Gutters wrap correctly.
- No cell is flat, and only leaf, plastic, foam and scrap (metalness) use alpha.
- three's shader chunks still contain the strings we patch, which guards against a three upgrade silently breaking the patch.
- Presets are cached and the patch installs `lrCell`, `lrScale` and `lrCut`.
- Palette mapping leaves avatar colours alone.
- The lighting rig applies to a scene.
- `worleyGrid` matches `worley`, and the cached `vnoise` matches the hash.

## Screenshots (`docs/cloud/shots/art/`)

- **`before-spawn.png`, `before-walked.png`:** the game on `main` (no `?art`).
- **`after-*.png`:** the same frames with `?art=1`.
- **`demo.png`, `demo-flat.png`, `demo-atlas.png`:** the material demo, textured vs flat, and the atlas.

## Process

The lead plus about 15 subagents:
- 2 researchers: Raft art direction, and procedural techniques.
- 6 texture builders.
- A lighting artist and a demo-page builder.
- A perf/memory reviewer.
- 2 critic rounds and 3 round-2 fixers.
- Visual QA that read the screenshots.

Critic scores rose from 4–8 (round 1: bark and rope at 4, sand at 8) after the round-2 fixes. See `sandbox/art/notes/critique-1.md`.

## Known limits and follow-ups

- **Repeat phase is per material, not per mesh.** Moving objects would make a per-mesh world-space phase swim, so identical meshes with the same tint line up.
- **`material.clone()` drops the patch.** `onBeforeCompile` is not copied, so the clone samples the whole atlas. Always get materials from `getMaterial` instead.
- **Foam isn't used in the game yet.** The `foam` cell is ready for the ocean lane, for crest and raft-edge foam.
- **Rope is tuned for the deck lashing torus.** On other meshes the lay angle differs.
- **No environment map**, so scrap metalness is capped at 0.5 × the mask.
