# Item icons from 3D models

Goal: every item in the hotbar, bag and recipe list shows a small picture of the same procedural
model the player holds or places, rendered once at load and cached. No art files, no new deps,
nothing that costs frame time after the bake.

Today `dist/survival-ui.js` draws icons from `dist/icons.svg` plus hand-drawn SVG fallbacks.
Several kinds share a sprite (`plastic` and `scrap` both use `icon-scrap`, `fishingrod` uses
`icon-hook`, `rope` uses `icon-net`, `bench` uses `icon-repair`, `crate` uses `icon-barrel`).

## Decision (final)

Runtime-baked atlas with the game's own renderer, cached per build, SVG fallback. Working code:

- `sandbox/icons/icon-atlas.js`: `bakeIconAtlas(T, renderer, items, opts)`. No imports, drops into dist unchanged.
- `sandbox/icons/item-models.js`: kind -> model builder + icon pose for all 15 `ITEM_INFO` kinds,
  and the engine entry `bakeItemIcons(T, renderer, mat, build, kinds)` -> `{ kind: blobURL }`.
  8 kinds use dist builders unchanged (`createHammer`, `createPlastic`, `createDebris` leaf,
  `createCraft` palm/net/bench/crate) and the sail uses `createCraft` with its height squashed to 0.68.
  Fish and rope have no world model, so two small procedural ones live here (ellipsoid fish with
  gradient + fins; braided rope coil). Five kinds use icon-only variants because the world model
  does not read at 40 px: `createRodIcon` (short thick bamboo rod, side reel, line hanging to a
  red/white bobber), `createJHook` (J hook with eye, barb and a rope tied through the eye),
  `createScrapIcon` (torn corrugated zinc sheet, folded corner, edge rust, rivets, bent strap),
  `createLogPile` (three logs with ringed end grain) and `createLanternIcon` (the lantern without
  its 1.9 m post).
- `sandbox/icons/adopt_patch.py`: exact anchored patches for `dist/survival-ui.js` and `dist/game.js`
  (`--check`, `--apply`). See `icons-ADOPT.md`.
- `sandbox/icons/shoot.py`: headless run, writes `sandbox/icons/shots/*.png` and `shots/report.json`.
  The UI shots use a patched copy of the CURRENT `dist/survival-ui.js`, not a mock.

How the bake works (per item, then once at the end):

1. Build the model, pose it (`ICON_POSES`: long tools on the diagonal, placeables 3/4 from above,
   flat things tipped up), fit a square ortho camera to the posed view-space box (`pad` 1.1, per-kind override).
2. Render into a 192 px 4x MSAA HalfFloat target with one fixed rig: hemisphere fill, warm key
   top-left-front, cool rim from behind. Shadow maps off. Every mesh's material is swapped for the
   bake (`unify()`) with a MeshStandardMaterial carrying the same uniforms but ONE flag set
   (vertexColors + DoubleSide; a white color attribute is added where missing; bump maps dropped;
   metalness capped at 0.3 so metal still reads under lights alone). Originals are restored before
   the model is disposed. No PMREM env by default (`env: true` brings it back).
3. One resolve pass draws the 96 px tile straight into its cell of a 384x384 RGBA8 atlas target
   (`atlas.viewport`): 2x2 box downsample, ACES + sRGB (render targets are linear in r170),
   a 2.6 px navy outline (`#0e2630`-ish, same family as the sprite's `#153e49`) from a 16-tap
   dilation, and a soft drop shadow (offset 2.2/2.6 px, 12-tap disc). Premultiplied compositing,
   so thin parts have no dark fringe.
4. Yield a frame between tiles. After the last tile: ONE `readRenderTargetPixelsAsync` for the
   whole atlas, flip rows, slice 15 PNG data URLs (these go to `localStorage`), convert to blob
   URLs for the DOM.
5. Restore renderer state: render target, clear color/alpha, `shadowMap.enabled`, `autoClear`,
   `info.autoReset`. Dispose targets, quad, the unified materials and every model (materials from
   the engine's `mat()` cache are tracked and never disposed).

Gotcha that cost a run: `renderer.render()` with `autoClear` clears the WHOLE render target, not
the viewport, so only the last tile survived. The baker sets `autoClear = false` while baking.

## Measured (`python sandbox/icons/shoot.py`, `shots/report.json`)

Headless Chromium + SwiftShader on a 4-core box with load average ~32 (other fleet agents), so
treat ms as relative and noisy. 15 icons at 96 px.

First-bake shader cost, same page and models, DPR 1, two runs each (scratch `variants.py`, query
flags `?unify=0&env=1` etc. on `index.html?mode=sheet`):

| bake config | programs compiled | bake total | worst game frame during bake |
|---|---|---|---|
| per-model materials + PMREM env (previous default) | 22 (20 lit + resolve + PMREM) | 27.5 / 30.4 s | 10.3 / 15.4 s |
| unify + PMREM env | 4 | 20.1 / 23.0 s | 11.4 / 16.1 s |
| **unify, no env (default)** | **4** (3 lit + resolve) | **5.9 / 5.1 s** | **1.5 / 0.8 s** |
| unify, no env, `precompile` | 8 | 5.5 / 5.5 s | 0.9 / 1.3 s (plus 1.1 to 1.9 s setup block) |

The previous version's own baseline run (old models, DPR 2) was 42.0 s total with a 23.8 s worst
frame. Two findings: (1) every distinct material flag set was its own program (20 lit variants for
15 icons); `unify()` makes it 3 (opaque, transparent, and one more flag split). (2) Program count
alone was not the cost: the env-mapped standard shader (`cube_uv` sampling) is what SwiftShader
compiles slowly, so dropping the PMREM env took the worst hitch from ~11-16 s to ~1 s. Precompile
adds nothing here and stays off.

Default config, `shoot.py` run:

| | DPR 1 run | DPR 2 run |
|---|---|---|
| setup (targets, shader, no env) | 1.5 ms | 0.5 ms |
| per-tile CPU submit | 4 to 336 ms | 2 to 385 ms |
| total incl. per-tile frame yields | 6.0 s | 7.0 s |
| single readback of the 384x384 atlas | 105 ms | 554 ms |
| PNG encode + slice (15 data URLs) | 13 ms | 32 ms |
| cache hit (`localStorage` -> 15 blob URLs) | 8.3 ms | 7.5 ms |
| game frame worst / avg during bake | 1.39 s / 399 ms | 1.08 s / 460 ms |

On a real GPU, expect a few ms per tile and one short compile hitch for 4 small programs; with
the cache every load after the first per build does no GL work at all.

`renderer.info`:
- bake total: 139 draw calls, 104,498 triangles for all 15 tiles.
- game scene before -> after bake: calls 25 -> 25, triangles 41,734 -> 41,734, geometries 25 -> 25,
  textures 2 -> 2, programs 6 -> 6 (no leak; the previous version left the debris timber texture
  and two env-lit programs behind).

Memory:
- transient VRAM during the bake: 1.18 MB MSAA renderbuffer + 0.29 MB HalfFloat resolve
  + 0.59 MB atlas, all freed after the bake. No PMREM target any more.
- CPU: 590 KB readback buffer (freed), 251 KB of PNG data URLs (15 icons) in `localStorage`,
  15 blob URLs for the DOM. Nothing stays on the GPU.

## Visual check (read the PNGs)

- `shots/sheet-1x.png`, `shots/sheet-2x.png`, `shots/sheet-2x-native.png`: all 15 at native 96 px,
  in 58/52 px slots, on a light 40 px strip and at 18 px cost-chip size, and SVG vs baked.
- `shots/ui-inventory-1x.png`, `shots/ui-inventory-2x-panel.png`, `shots/ui-hotbar-2x-bar.png`:
  the real survival UI with baked icons. `shots/ui-inventory-svg-1x.png`: same UI, current SVG.
- `shots/ui-inventory-late-2x-panel.png`: bag opened with SVG icons, then `setItemIcons()` lands
  with the bag still open (no reopen): 47 SVG icons -> 0, 47 baked (`lateSwap` in the report).
- `shots/game-adopted-inventory.png`: the real game on a copy of dist with `adopt_patch.py --apply`
  (fresh `localStorage`): hotbar hook and all recipe and cost icons are baked. In the real game the
  bake (cleared cache) finishes on the title screen before Solo, so the bag opens already baked;
  a reload hits the `ia4` cache.

Reads well (now including the five reworked kinds): wood is a log pile with ringed ends like the
SVG; the fishing rod is a thick diagonal rod with a visible reel and a red/white bobber hanging
from the tip; the hook is a clear J with eye, barb and a rope tied through; scrap is corrugated
galvanised sheet with a folded corner, edge rust and rivets; the lantern fills the slot; the sail
fills more of it, tilted. Consistent light direction and outline across the set; at 2x every icon
is crisp; at 1x 40 px and at the 18 px cost chips still distinct.

Still weak: the hook's wire is the thinnest silhouette in the set at 40 px (outline carries it);
the hook icon is a J fish hook while the held tool in game is a scrap hook on a wooden handle
(by request, it matches the SVG instead); scrap at 18 px is a grey rectangle with an orange
fleck; metal (hammer head, lantern frame) is darker than with the env because metalness is
capped and lit by lights only; the sail is still taller than wide.

## Three facts that shape every approach

1. **Render targets are linear in r170.** `WebGLRenderer` only applies `outputColorSpace` and
   `toneMapping` when drawing to the screen (`three.module.js` line ~30655: a non-XR render
   target always gets `LinearSRGBColorSpace`). Read pixels back from a plain target and the
   icon comes out dark and flat next to the game. Fix it in a resolve pass (A) or render to a
   canvas (B).
2. **Metal needs an environment.** The hook and the hammer head use `metalness` 0.7 to 0.8.
   With only lights they render almost black. A tiny studio env from `PMREMGenerator.fromScene`
   (a gradient sphere plus two bright panels, built once, about 50 ms) fixes it without an
   addon such as `RoomEnvironment`, which is not vendored. Update: the env-mapped shader is what
   made the first bake hitch for 10 to 16 s on SwiftShader, so the default now skips the env and
   caps metalness at 0.3 for the bake instead (`metalCap`); metal reads a little darker. `env: true`
   restores the old look where compile cost does not matter.
3. **Fit with an ortho camera on the posed bounding box**, not a perspective camera on a
   sphere. Rotate the model into its icon pose with the camera fixed on +Z, take
   `Box3.setFromObject(pivot, true)` (already in view space), center it and set the ortho
   bounds to the larger side times about 1.12. Every icon then fills its slot the same way, whether
   it is a 1.5 m rod or a 0.2 m net. Long tools read best on the diagonal (roll about -40 degrees),
   the Raft and Minecraft convention. Placeables get a 3/4 view (yaw -35, pitch 15 to 25).

## A. Shared renderer, render target, shader resolve, one readback (recommended)

Reuse the game's `WebGLRenderer`. Render each model into a 2x MSAA `HalfFloatType` target,
then draw one full-screen quad into a small 8-bit target. The quad's shader does a 2x2
downsample, ACES and sRGB (the same curve the game uses, so icons match the world), and a
silhouette outline that samples alpha in two rings. Read it back with
`readRenderTargetPixelsAsync`, flip rows into `ImageData`, and keep two outputs:

- a PNG object URL (`canvas.toBlob` then `URL.createObjectURL`) for `<img>` and CSS in the DOM UI
- an `ImageBitmap` (`createImageBitmap(imageData)`) for anything drawn into a 2D canvas, with no
  PNG encode or decode

```js
const hi = new T.WebGLRenderTarget(S * 2, S * 2, { type: T.HalfFloatType, samples: 4 });
const lo = new T.WebGLRenderTarget(S, S, { depthBuffer: false });
// save state, render, restore
const rt = renderer.getRenderTarget(), a = renderer.getClearAlpha(); renderer.getClearColor(prev);
renderer.setClearColor(0, 0);
renderer.setRenderTarget(hi); renderer.clear(); renderer.render(stage, orthoCam);
renderer.setRenderTarget(lo); renderer.clear(); renderer.render(quadScene, quadCam); // resolve shader
renderer.setRenderTarget(rt); renderer.setClearColor(prev, a);
await renderer.readRenderTargetPixelsAsync(lo, 0, 0, S, S, pixels); // PBO + fence
// flip rows -> ImageData -> putImageData -> toBlob -> object URL; createImageBitmap(imageData)
```

Resolve shader core of the first pass (the current one, with drop shadow, is in `sandbox/icons/icon-atlas.js`):

```glsl
vec4 c = 0.25 * (tap(-t,-t) + tap(t,-t) + tap(-t,t) + tap(t,t)); // premultiplied (clear = 0,0,0,0)
vec3 rgb = toSRGB(aces(c.a > 0.001 ? c.rgb / c.a : vec3(0.)));
float ring = 0.;                                                  // 12 taps x 2 radii
for (int i = 0; i < 12; i++) { vec2 d = dir(i) * outlinePx * srcTexel * 2.;
  ring = max(ring, max(texture2D(tSrc, vUv + d).a, texture2D(tSrc, vUv + d * .5).a)); }
float oa = ring * outline.a, A = c.a + oa * (1. - c.a);
gl_FragColor = vec4((rgb * c.a + outline.rgb * oa * (1. - c.a)) / max(A, 1e-4), A);
```

Benefits: one GL context, so shaders are compiled once and the in-world materials share the
program cache with the game. The outline and tone mapping happen on the GPU at the source
resolution. The async readback avoids a hard `glFinish`. The game frame is untouched because
the four bits of state it changes (render target, clear color, clear alpha, shadow map
enabled) are restored. The sandbox renders a cube with the same renderer after baking to prove
this.

Costs: about 120 lines, and one extra shader to maintain. The 2x HalfFloat target at 96 px is
192 x 192 x 8 bytes, about 300 KB of VRAM, and is freed after the bake. The first bake of each
material type pays its shader compile, so call `renderer.compileAsync(stage, cam)` on a
throwaway scene holding all models before the loop if hitches show up.

## B. Dedicated small renderer on its own canvas (first-pass comparison; code removed, see git history of icon-baker.js)

Create a second `WebGLRenderer({ alpha: true, antialias: true })` at 2x icon size with the
game's `outputColorSpace` and `toneMapping`. Render, then in the same task (no
`preserveDrawingBuffer` needed) `drawImage(renderer.domElement)` into a 2D canvas at 1x. Do the
outline in 2D: tint the silhouette with `globalCompositeOperation = 'source-in'`, stamp it in 8
directions, draw the item on top. Then `toBlob`.

```js
const r = new T.WebGLRenderer({ antialias: true, alpha: true });
r.setSize(S * 2, S * 2, false); r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping;
r.render(stage, orthoCam);
ctx.drawImage(r.domElement, 0, 0, S, S);       // same task as render()
// outline: tinted silhouette x8 offsets, then the item
r.dispose(); r.forceContextLoss();             // give the context back
```

Benefits: the simplest code, with correct colors and tone mapping for free and no state to
save or restore. Because it is isolated, it can also run at build time or in a worker-free
tools page.

Costs: a second WebGL context (browsers cap them at about 16, and Safari on low-memory devices
can drop the oldest), every shader is compiled twice, and the env map is built twice. The
canvas MSAA downsample through `drawImage` is a bilinear 2:1 filter, a little softer than A's
box filter. The 2D outline runs on the CPU. It is fine for 15 icons and slower for hundreds.
In the sandbox the two results look the same to the eye.

## C. Live views: scissor viewports into the main canvas (no cache)

The `webgl_multiple_elements` pattern: each frame, for each visible slot, read the slot's
`getBoundingClientRect()`, `setViewport` and `setScissor` to that rect (flip y), and render the
model there. Icons can spin, show durability as real wear, and react to light.

```js
renderer.setScissorTest(true);
for (const s of visibleSlots) {
  const r = s.el.getBoundingClientRect(), y = canvas.clientHeight - r.bottom;
  renderer.setViewport(r.left, y, r.width, r.height); renderer.setScissor(r.left, y, r.width, r.height);
  renderer.render(s.scene, s.cam);
}
renderer.setScissorTest(false);
```

Benefits: no readback, no cache invalidation, and the icons can animate. It is the right tool
for one "inspect item" preview or a rotating crafting result.

Costs: it runs every frame, adding one draw per mesh per slot (the fishing rod alone is 17 meshes,
so 8 slots plus a 30-slot bag gets into hundreds of draws). The icons must sit under the
canvas or be punched through it, which clashes with the DOM hotbar and its drop shadows. It
also has layout reads every frame. Too expensive for a mid laptop as the main icon path.

## Recommendation (first pass, superseded by the decision above)

Use A for every item icon. Bake the kinds in `ITEM_INFO` that have a builder at startup, after
the first game frame, one per `requestIdleCallback` (or awaited in a loop, since each bake
yields on the async readback). Fall back to the existing SVG sprite until the PNG URL exists,
so the UI never waits. In `survival-ui.js` `iconSVG(kind)` becomes "baked `<img>` if cached,
else the current SVG". Keep C in reserve for a single animated preview. B is a good fit only
for an offline "export icons to PNG" tools page.

Cache: the bake is cheap enough to redo every load (see the numbers below), so start with the
in-memory `Map`. If startup time matters later, store the PNG data URLs in `localStorage`
under the `?build=` id the game already carries, wrapped in try/catch. Fifteen 96 px PNGs are
about 100 to 150 KB as base64.

Resolution: bake at 96 px for slots shown at 48 CSS px, so it stays sharp at
devicePixelRatio 2. On a 1x screen the browser downsamples, which looks fine.

## Measured in the first pass (per-icon readback, kept for history)

Headless Chrome with SwiftShader (CPU rasterizer, so this is a worst case and far slower than
any real GPU), 10 models at 96 px:

| | setup | per icon | total |
|---|---|---|---|
| A shared renderer | about 50 ms (env + targets) | 530 to 1060 ms (2950 ms for the first, which includes shader compile) | 11.9 s |
| B second renderer | about 50 ms | 550 to 1320 ms (2090 ms first) | 11.0 s |

On SwiftShader most of A's time is the readback waiting for the CPU raster to finish
(`read` column in the report), and PNG encode is 3 to 12 ms. On a real integrated GPU the
render and resolve take a few ms per icon. Treat these numbers as relative only. Bake after
the first frame and never in the middle of gameplay.

Visual check (`icons.png`): A and B match in color and outline. The metal on the hook and the
hammer head reads as metal. The game canvas renders normally after the bake.

## Gotchas found while building it

- Clear to `(0,0,0,0)` and treat the averaged color as premultiplied. Otherwise thin parts
  such as rope and the rod tip get a dark fringe.
- `readRenderTargetPixels` (the sync one) logs "GPU stall due to ReadPixels". Use the async
  one. It needs an `UnsignedByteType` RGBA target, which is why the resolve goes to an 8-bit `lo`.
- Rows come back bottom-up. Flip them before `putImageData`.
- `ImageBitmap` cannot go in `<img>` or CSS. Use the object URL for the DOM and the bitmap
  for canvas drawing.
- Turn off `renderer.shadowMap.enabled` while baking, or the bake renders the game's shadow
  maps for nothing.
- Dispose each model after its bake (`userData.dispose()` when present, else traverse). Leave
  the render targets, env and quad alive only while baking.

## References

- three.js manual, Render Targets: https://threejs.org/manual/en/rendertargets.html
- three.js manual, Multiple Canvases Multiple Scenes (scissor pattern): https://threejs.org/manual/en/multiple-scenes.html
- three.js example `webgl_multiple_elements`: https://threejs.org/examples/?q=multiple#webgl_multiple_elements
- three.js forum, Convert objects in 3D to 2D image (`preserveDrawingBuffer`, render before `toDataURL`): https://discourse.threejs.org/t/convert-objects-in-3d-to-2d-image/18918
- Minecraft item renderer on three.js (ortho camera, PNG export, cached): https://www.pkgstats.com/pkg:@iskallia-dev/item-model-renderer
- Godot RenderingServer thumbnails (same idea in another engine): https://hexaquo.at/pages/using-godots-renderingserver-for-dynamically-rendering-billboards-thumbnails-and-more/
- PlayCanvas render captures for product thumbnails: https://magnopus.com/blog/automating-render-captures-with-playcanvas
