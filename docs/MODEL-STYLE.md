# Little Raft model style

All props come from `dist/models.js`. It builds every model from code and loads no assets. This file covers the look, the units and the budgets, so new models fit in with the rest.

## Technique

What we took from looking at good procedural low-poly work in three.js, and how models.js does each one:

- **Bevelled boxes everywhere.** A plain box looks like a placeholder. A rounded box (the RoundedBoxGeometry trick) puts a small bevel on every edge, which catches the light. `rbox()` builds a segmented BoxGeometry, clamps each vertex to an inner box, then pushes it out by the bevel radius along the offset direction. That offset also gives the normal. With 1 segment you get a chamfer (LOD 1). With 2 you get a soft round edge (LOD 0).
- **One draw call per material.** Each model gathers its parts into buckets by material key and merges every bucket into one indexed BufferGeometry using the local `merge()` helper. The vendored three build has no addons, so we don't use BufferGeometryUtils. Most models end up with 2 to 4 meshes.
- **Colour lives in vertex colours, not materials.** Every material uses `vertexColors`. About ten materials are shared by all models, created once and never disposed. Colour variation per plank, per stave and per leaf costs nothing.
- **Baked ambient occlusion.** After merging, each vertex is darkened by its height above the model's base (ground-contact shadow) and a little more when it faces down. Parts can also bake their own cavity darkening through a colour function, as the crate seams and leaf bases do.
- **Wood grain from one cached canvas.** A 256x128 greyscale grain texture is drawn once and shared by the `wood` material. The vertex colour tints it, so one texture covers every wood tone. `uvSwap` turns the grain to run along barrel staves and posts.
- **Flat vs smooth normals.** Wood, plastic and cloth are smooth shaded with bevels. Scrap metal, soil, potatoes and the palm trunk use `flatShading` materials, so their facets read as crumpled, lumpy or ringed.
- **Crisp per-face colour.** `perFace` splits a part into separate triangles and colours each one from its centroid. Barrel staves, rust blotches and potato eyes get hard edges this way, with no texture.

## Palette

| Role | Hex | Used on |
|---|---|---|
| plank | `#c48c55` | planks, foundation, bench |
| plank light | `#d9a86c` | end grain, highlights |
| dark wood | `#6b4529` | posts, frames, crate edges |
| log | `#7d5535` | foundation logs, palm trunk |
| rope | `#cdb07a` / `#8f7646` | lashings, coils, handles |
| plastic white | `#ece9e0` | hook, bottle |
| plastic teal | `#2fa39a` | hook bands, watering can |
| plastic blue | `#3d8fd1` | bottle cap |
| red accent | `#d9483b` | bobber, float |
| metal | `#8e989e` / `#3f4448` | scrap, hammer head, hoops |
| rust | `#a5522a` | scrap blotches, nails |
| leaf | `#5fae3a` / `#3b7f2a` / `#a5d65a` | fronds, crops |
| soil | `#4a3222` / `#6b4a31` | crop plot, mounds |
| beet | `#8e1f3f` / `#c23a5c` | beet root, leaf veins |
| potato | `#c9a067` | potato |
| cloth | `#efe6cf` / `#d8c6a0` | sail, patches |
| glow | `#ffcf73` | lantern glass (emissive) |

Saturation stays medium-high and value contrast between parts stays big, so a model still reads at 48 px. Lighter details sit on darker parts (rope on a dark post), and the other way round.

## Proportions and origins

Units are metres. A foundation tile is 2 x 2 and its walkable top is y = 0.20 (matches `deck.js FLOOR_TOP`).

- **Placeables** (foundation, crop plot, lantern, net, sail, bench, crate, palm planter, planter pot, watering can) are centred on x/z and stand on y = 0. Every footprint fits inside 1.7 x 1.7, apart from the foundation.
- **Handheld tools** (hook, hammer, fishing rod) have the grip at the origin, the working end toward +Y and the face toward -Z. `userData.grip` is `[0,0,0]`.
- **Items** (plank, plastic, palm leaf, scrap, rope, barrel, seed, beet, potato, fish, nails, cup, water) rest on y = 0. `seed` is a palm seed (small coconut). Items are a bit larger than life (a plank is 1.2 m) so they read when floating.
- **Crop stages** (sprout, young, mature, harvestable) grow from the soil surface at y = 0. Drop them onto `plot.userData.slots`.
- **Palm stages** (palmSeedling, palmSprout, palmYoung, palmMature, aliased `palm-0`..`palm-3` for farming-view.js) grow from y = 0, which farming-view puts at the top of the `planter` pot (y = 0.5). Each stage is taller than the last.

`userData` always carries `kind`, `size` [x,y,z] and `height`, plus extras: `grip`, `light` (lantern bulb), `slots` and `soilY` (crop plot), `spout` (watering can) and `tip` (rod tip). All of them are plain arrays, so `clone()` copies them safely.

Chunky beats realistic. Handles are about 20% thicker than real ones, and leaves and prongs are wider, so silhouettes survive icon size and a first-person view at the bottom corner of the screen.

## Poly budgets (triangles, LOD 0 / LOD 1)

| Class | LOD 0 | LOD 1 |
|---|---|---|
| small item (seed, plank, scrap, beet, potato, nails, cup, water) | <= 600 | <= 300 |
| medium item (barrel, rope, plastic, leaf, fish) | <= 1500 | <= 800 |
| held tool (hook, hammer, rod, can) | <= 2500 | <= 1200 |
| crop stage, palm seedling/sprout | <= 1200 | <= 600 |
| placeable (crate, bench, plot, lantern) | <= 3000 | <= 1500 |
| big placeable (sail, net, palm, mature palm, foundation) | <= 5000 | <= 2500 |

The old modules spent 13k triangles on the hammer, 22k on the sail and 17k on the net. The new set does more with about a fifth of that.

## API

```js
import { buildModel, getModel, MODEL_KINDS } from './models.js';
const plot = getModel('cropPlot');          // shared geometry + materials, cheap: use for many copies
const hero = buildModel('hook', { lod: 0 }); // owns its geometry: dispose via hero.userData.dispose()
```

Every inventory item id resolves through `MODEL_ALIASES` (wood -> plank, palm -> palmPlanter, fishingrod -> rod, palm-0..3 -> palm stages), so `getModel(itemKind)` works for any item; `hasModel(kind)` checks first. `getModel` caches a template per kind and LOD and returns `template.clone()`. Clones share geometry, so never dispose a clone's geometry. Never dispose materials from either call.

## Checking

`python tools/model-sheet.py .qa/models/sheet.png "cell=200&cols=8"` renders every kind to a contact sheet. Use `cell=64&cols=14` for the icon-size check, `set=old` for the old models and `lod=1` for low detail. Read the PNG and fix anything that doesn't read clearly before you commit.
