# Item icons from 3D models

Goal: every item in the hotbar, bag and recipe list shows a small picture of the same procedural
model the player holds or places, rendered once at load and cached. No art files, no new deps,
nothing that costs frame time after the bake.

## Retarget onto main's item-icons.js (round 3, current decision)

Main has since shipped its own `dist/item-icons.js`:
- a lazy queue that renders one kind per `requestIdleCallback`;
- a private 128 px WebGL context, released 2.5 s after the queue drains;
- PNG data URLs, models from `setModelProvider(models.js getModel)`;
- SVG fallback while an icon renders or when a kind has no model.

`survival-ui.js` and `game.js` (pickup feed) call it through `iconURL / getItemIcon /
loadItemIcon / warmIcons / onIconReady / setModelProvider`. The round-2 plan below (bake on the
game renderer, `setItemIcons`, blob URLs, a localStorage cache) is a second, competing pipeline
against that code. The comparison below is what decided between them.

**Decision: merge.** Keep main's architecture and API unchanged and bring in the fleet work that
measurably helps. The result is `sandbox/icons/item-icons.js` (drop-in, same exports) plus
`sandbox/icons/item-icon-models.js` (new). No caller changes. Steps are in `icons-ADOPT.md`
(`adopt_patch.py --check/--apply`).

### Looks (`sandbox/icons/shots/compare-sheet.png`, all 34 `ITEM_IDS` kinds, SVG | main | fleet | merged)

Each icon is shown on a 52 px dark slot, as an 18 px chip and on a light strip.
- **Main** renders 16 of 34 kinds; 18 have no model and keep their SVG.
  - The world tools are unreadable at slot size. The hook is a thin forked stick (the models.js
    prop, not the scrap hook the player holds), and the rod and hammer are one-pixel diagonals.
  - Wood is a single plank, nail is a few grey hairlines, the lantern is mostly its post and the
    net is a dark slab.
  - The icons have no outline, so on the dark slots they read as floating photos beside the outlined
    SVG icons.
- **Fleet** has the best tools, wood, scrap, net and lantern, but it covers only the 15 legacy kinds.
  It has no nail, and its bench, crate, palm and sail come from the old crafts.js models, not models.js.
- **Merged** uses the fleet stand-ins for the 10 kinds whose world model does not read (wood, scrap,
  rope, fish, hook, hammer, rod, lantern, net, plus a new chunky nail). The other 6 rendered kinds
  (leaf, plastic, bench, palm, sail, crate) come from models.js as on main, so they match the world.
  Every icon gets the navy outline (`icons.svg` stroke family), and thin tools also get a light rim.
  The same 18 kinds stay SVG.

Real game, same seeded save:
- `shots/main-hotbar.png` vs `shots/adopt-hotbar.png`: the hotbar goes from thin sticks and a plank
  to a held-hook, rod, hammer, log pile, bottle, rusty sheet, rope coil and nails that all read at 40 px;
- `shots/main-bag.png` vs `shots/adopt-bag.png`: the recipe list and the cost chips also use the new icons.

### Cost (`python sandbox/icons/shoot.py`, SwiftShader)

Load average was 35 to 58 on 4 cores, so the numbers swing 3 to 5x between runs. The table gives
medians of 4 interleaved runs each, with a 480x270 game-like scene rendering every rAF:

| | main | merged | fleet (round 2) |
|---|---|---|---|
| kinds with a 3D icon | 16 / 34 | 16 / 34 | 15 / 34 |
| GL program links (icon work) | 4 | 4 | 4 (on the game renderer) |
| all 34 queued -> last ready, cold | ~8.2 s | ~8.8 s | 4 to 9 s (atlas bake) |
| worst game frame while rendering, cold | ~1.7 s (0.6 to 2.8) | ~1.7 s (0.6 to 3.5) | 0.3 to 3.0 s |
| worst frame, warm reload | ~0.9 s | ~0.7 s | 0.1 to 0.8 s (localStorage hit, 0 links) |
| data URL bytes in memory | 161 KB | 319 KB | 260 KB + 260 KB localStorage |
| extra WebGL contexts | 1, released after 2.5 s | 1, released after 2.5 s | 0 |
| game `renderer.info` after (programs / geometries / textures) | unchanged | unchanged | unchanged |

On this box merged and main cost the same. The first version of the merge did not: the stand-in
models brought their own material flag sets and cost **14 to 15 program links** and twice the worst
frame. Two fixes brought it back to 4 links:
- unify the materials for the render;
- keep the stand-in materials alive until the context is released, because three frees a program
  together with its last material.

Per-kind timing showed that the cost is almost entirely the GPU sync at the first read of each
render, which waits for any new shader compile. Model building (1 to 70 ms), PNG encode (2 to 16 ms)
and the 2D outline pass are small next to it.

### What was taken, what was left

Taken from the fleet:
- the icon-only models;
- the outline look, done as a 2D-canvas pass instead of a GLSL resolve, so it adds no program;
- material unify with a metal cap;
- `userData.shared`-aware disposal;
- hot-swap ownership, so a stale engine stops working.

Left out:
- **Baking on the game renderer.** It saves the second context, but it puts the bake's state
  changes and compiles inside the game's own render path. Main's private context is simpler and
  cannot corrupt game render state.
- **The localStorage cache.** It is the one clear win of the fleet design, since warm loads do
  zero GL work. But the game save (`little-raft-v1`), progression and fishing journal all share the
  same ~5 MB origin quota. A 260 to 330 KB icon blob that can push a save write into
  `QuotaExceededError` is the wrong trade for saving about a second of idle-time rendering. If
  wanted later, put it in IndexedDB or the Cache API, keyed by build, behind the same API.
- **Blob URLs.** They would need revoke ownership in survival-ui. Data URLs keep the contract (`getItemIcon` -> data URL) unchanged.

Robustness (`python sandbox/icons/robust.py`, all 12 cases pass on the merged module):
- the provider throwing falls back to the old builders;
- an empty model, or a kind with no model, resolves null (the SVG stays);
- `onIconReady` fires only for real icons;
- **WebGL context loss** mid-queue drops the context and retries, and the icons still render;
- a provider swap keeps the stand-in icons and re-renders the provider kinds;
- **hot swap**: once copy B claims the queue, copy A's pending kinds resolve null within 5 ms and A
  keeps its finished icons. B renders, and no live contexts remain after release.

By code reading, main renders a lost context into a blank PNG and caches it for the session (an
invisible icon). Its old module copy also keeps rendering its whole queue after a hot swap.

Still open:
- 18 kinds have no 3D model and stay SVG. That is the same mix as on main; adding them to models.js
  or `ICON_MODELS` would fill the set.
- Bench and sail from models.js are thin at chip size.

The SVG sprites remain the fallback for the first idle seconds and for no-WebGL.

---

Round-2 history follows. Superseded by the retarget above: it targets the pre-merge dist, and its
survival-ui / game.js patches no longer apply. `icon-atlas.js` / `item-models.js` / `index.html` /
`main.js` remain in `sandbox/icons/` as the reference the `fleet` column of the compare harness runs.
The `ui` mode of `index.html` relied on the retired survival-ui patch.

Before main's item-icons.js, `dist/survival-ui.js` drew icons from `dist/icons.svg` plus hand-drawn SVG fallbacks.
Several kinds share a sprite (`plastic` and `scrap` both use `icon-scrap`, `fishingrod` uses
`icon-hook`, `rope` uses `icon-net`, `bench` uses `icon-repair`, `crate` uses `icon-barrel`).

## Round-2 decision (fleet atlas baker, superseded)

Runtime-baked atlas with the game's own renderer, cached per build, SVG fallback. Working code:

- `sandbox/icons/icon-atlas.js`: `bakeIconAtlas(T, renderer, items, opts)`. No imports, drops into dist unchanged.
- `sandbox/icons/item-models.js`: kind -> model builder + icon pose for all 15 `ITEM_INFO` kinds,
  and the engine entry `bakeItemIcons(T, renderer, mat, build, kinds, isCancelled)` ->
  `{ kind: blobURL }` or `null` when cancelled. 5 kinds use dist builders unchanged
  (`createPlastic`, `createDebris` leaf, `createCraft` palm/bench/crate). 2 use a dist model
  rescaled: the hammer (`createHammer`, handle and head fattened 1.9x / 1.45x so it is not a
  hairline) and the sail (`createCraft`, height squashed to 0.68). Fish and rope have no world
  model, so two small procedural ones live here (ellipsoid fish with gradient + fins; braided rope
  coil). 6 kinds use icon-only variants because the world model does not read at 40 px:
  `createScrapHookIcon` (the held scrap hook of `dist/hook.js`: same curve, barb, riveted ferrule and
  rope-wrapped wooden handle, laid flat and about twice as thick), `createRodIcon` (short thick
  bamboo rod, side reel, line hanging to a red/white bobber), `createScrapIcon` (torn corrugated
  zinc sheet with wide ridges, folded corner, heavy edge rust, rivets, bent strap), `createLogPile`
  (three logs with ringed end grain), `createLanternIcon` (the lantern without its 1.9 m post) and
  `createNetIcon` (light wooden frame, coarse grid of thick tan rope, orange floats).
- `sandbox/icons/adopt_patch.py`: exact anchored patches for `dist/survival-ui.js` and `dist/game.js`
  (`--check`, `--apply`). See `icons-ADOPT.md`.
- `sandbox/icons/shoot.py`: headless run, writes `sandbox/icons/shots/*.png` and prints the JSON report.
  The UI shots use a patched copy of the CURRENT `dist/survival-ui.js`, not a mock.
- `sandbox/icons/robust.py` (failure paths), `sandbox/icons/hotswap.py` (real live.js hot swap on a
  patched copy), `sandbox/icons/game_probe.py` (real game: fresh bake, shots, in-game cache hit) and
  `sandbox/icons/variants.py` (bake-config table below).

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
   `info.autoReset`. This is a `try/finally` around each tile's renders, so a throw cannot leave the
   game rendering with `autoClear = false` into the atlas. An outer `try/finally` disposes the
   targets, quad, unified materials and every model built so far on every path (success, throw,
   cancel). Materials from the engine's `mat()` cache are tracked and never disposed.
6. `isCancelled()` (game.js passes `() => disposed`) is checked before every tile and around the
   readback. A disposed or hot-swapped engine's bake stops, returns `null`, and writes no cache
   and no blob URLs. See `icons-ADOPT.md` for the cache read/write rules and the hot-swap numbers.

Gotcha that cost a run: `renderer.render()` with `autoClear` clears the WHOLE render target, not
the viewport, so only the last tile survived. The baker sets `autoClear = false` while baking.

## Measured (`python sandbox/icons/shoot.py`, `shots/report.json`)

Headless Chromium + SwiftShader on a 4-core box with load average ~32 (other fleet agents), so
treat ms as relative and noisy. 15 icons at 96 px.

First-bake shader cost, same page and models, DPR 1, two runs each (`python sandbox/icons/variants.py
<repo>`, query flags `?unify=0&env=1` etc. on `index.html?mode=sheet`; round-1 models, so absolute
times differ a little from the table below):

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

Default config, `shoot.py` run (round 2, current models):

| | DPR 1 run | DPR 2 run |
|---|---|---|
| setup (targets, shader, no env) | 0.6 ms | 1.7 ms |
| per-tile CPU submit | 4.7 to 343 ms | 4.2 to 153 ms |
| total incl. per-tile frame yields | 5.7 s | 7.4 s |
| single readback of the 384x384 atlas | 215 ms | 260 ms |
| PNG encode + slice (15 data URLs) | 12 ms | 13 ms |
| cache hit (`localStorage` -> 15 blob URLs) | 6.8 ms | 6.9 ms |
| game frame worst / avg during bake (light sandbox scene) | 751 ms / 357 ms | 1.23 s / 463 ms |

In the real game the scene is heavier, so the numbers differ: the bake takes about 15 game frames
(one tile per frame), 25 to 30 s from mount in the judge's runs and 86 s from Solo in round 2 on a
box at load average 42. Its hitch could not be told apart from the game's own frame times. The
cache hit measured inside the running game was 7.4 to 192 ms over 5 calls (median 10 ms; the
judge saw 63 ms). The sandbox 6.8 ms is the idle-page figure.

On a real GPU, expect a few ms per tile and one short compile hitch for 4 small programs; with
the cache every load after the first per build does no GL work at all.

`renderer.info`:
- bake total: 171 draw calls, 89,534 triangles for all 15 tiles.
- game scene before -> after bake: calls 25 -> 25, triangles 41,734 -> 41,734, geometries 25 -> 25,
  textures 2 -> 2, programs 6 -> 6 (no leak; the previous version left the debris timber texture
  and two env-lit programs behind).

Memory:
- transient VRAM during the bake: 1.18 MB MSAA renderbuffer + 0.29 MB HalfFloat resolve
  + 0.59 MB atlas, all freed after the bake. No PMREM target any more.
- CPU: 590 KB readback buffer (freed), 259,814 chars (about 254 KB) of PNG data URLs (15 icons) in
  `localStorage`, 15 blob URLs for the DOM (revoked when replaced and when the UI is destroyed).
  Nothing stays on the GPU.

## Visual check (read the PNGs)

- `shots/sheet-1x.png`, `shots/sheet-2x.png`, `shots/sheet-2x-native.png`: all 15 at native 96 px,
  in 58/52 px slots, on a light 40 px strip and at 18 px cost-chip size, and SVG vs baked.
- `shots/ui-inventory-1x.png`, `shots/ui-inventory-2x-panel.png`, `shots/ui-hotbar-2x-bar.png`:
  the real survival UI with baked icons. `shots/ui-inventory-svg-1x.png`: same UI, current SVG.
- `shots/ui-inventory-late-2x-panel.png`: bag opened with SVG icons, then `setItemIcons()` lands
  with the bag still open (no reopen): 47 SVG icons -> 0, 47 baked (`lateSwap` in the report).
- `shots/game-adopted-hotbar.png`, `shots/game-adopted-bag.png`: the real game (booted through
  index.html / live.js) on a copy of dist with `adopt_patch.py --apply`, fresh `localStorage`. At
  spawn the hotbar slot 1 icon is the same curved scrap hook on a rope-wrapped handle that the
  player holds; recipes and cost chips are baked. A reload hits the `ia4` cache.

Reads well: wood is a log pile with ringed ends like the SVG; the fishing rod is a thick diagonal
rod with a visible reel and a red/white bobber; the hook is the held scrap hook (round 1 drew a thin
J fish hook, which read as fishing gear next to the rod); scrap is a rusty corrugated sheet that stays
rust-red with visible ridges at 18 px (round 1: a grey smear); the net is a light tan grid with
orange floats at 18 px (round 1: a dark square); the lantern fills the slot. Hammer, rod and hook
carry a 1.6 px cream rim outside the navy outline, so they are visible on the dark brown slots at
1x in the 34 px recipe list (round 1: the hammer nearly disappeared). Stack counts keep the SVG's
bottom-right inset (the art grows 2 px up-left only), so "20" and "14" no longer sit on the art.

Still weak: the rim gives the three tools a slightly sticker-like edge that the other 12 icons do
not have; the plastic jug is white and low contrast on the light strip; metal is darker than with
the env because metalness is capped and lit by lights only; the sail is still taller than wide.

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
under the `?build=` id the game already carries, wrapped in try/catch. (First-pass estimate: 100
to 150 KB as base64. Measured on the final models: 259,814 chars, about 254 KB.)

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
the first frame. (The adopted version bakes 400 ms after mount, which is on the title screen
for a page load. A live.js hot swap to a new build does mount mid-gameplay, so every such swap
rebakes during play, with SVG icons until it lands; a remount with an unchanged build is a cache
hit. See `icons-ADOPT.md`, Hot swaps.)

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
