# Spec: raft flag (Flagpole + flag designer)

Source: docs/features/raft-flag-research.md. One builder. A craftable **Flagpole** decor carries a rectangular cloth flag that each player designs in a small dialog
(background, pattern, pattern colour, emblem, emblem colour). The cloth waves in the sailing wind and points downwind, and both co-op players see the same design.
The template is the Signboard (`dist/decor-pack.js`, `signs-core.js`, `signs-ui.js`). Copy its structure, but share no state with it.
New files: `dist/flags.js` (content module `name:'flags'`), `dist/flags-core.js` (pure, no imports), `dist/flags-model.js` (THREE pole, cloth and painter, no imports),
`dist/flags-ui.js` (dialog, lazy), and `tests/flags.test.mjs`. Every import carries `?build=v3-survival-ae77fa84ac2b` (`tests/module-specifiers.test.mjs`).

## 1. Item, recipe, decor (append only; re-read each array right before editing, because other builders append too)
- `dist/content-items.js`:
  - `CONTENT_ITEMS`: `flagpole: item('flagpole', 'Flagpole', 'icon-flag', false),` with a comment `// raft flag (flags.js)`.
  - `CONTENT_RECIPES`: `flagpole: recipe('flagpole', 'Flagpole', 1, { wood: 4, rope: 2, leaf: 2 }),`. Register it here only, not in `items.js`.
  - Append `'flagpole'` to `CONTENT_DECOR`, and `flagpole: .1` to `CONTENT_BLOCK_RADIUS`.
- **Research gating** needs no code. The recipe unlocks once wood, rope and leaf are researched (`learnedFrom`), which is the same tier as the pennant and sign. `STARTER` does not change.
  - Existing test: in `tests/storage-research.test.mjs:478`, the sorted `learnedFrom(['wood','rope','leaf'])` list gains `'flagpole'` between `'fern'` and `'hammock'` (re-read it first; other builders may change it).
- `dist/item-svg.js` `ITEM_ICONS`: add `flagpole`, an original 48×48 drawing with outline `#153e49`.
  - Content: a pole `#8a6a45` from (12,44) to (12,4), a gold knob `#ffbd66`, and a rectangular flag from x 13 to 40, y 6 to 24, filled `#f1c84d`, with a navy `#24456b` shell shape inside it.
  - Do not add an `icon-flag` sprite: `CUSTOM` is keyed by kind, so the drawing is used.
- `dist/craft-book.js`: append `flagpole: 'building'` to `CATEGORY_OF` after the decor pack entries; `ITEM_TEXT`: add `flagpole: { desc: 'A tall pole with a cloth flag that flies in the wind.', use: 'Place it, then press E to design your flag.' }`.
- `dist/coop-fx.js:9` `DECOR` set: append `'flagpole'` so the ghost footprint shows.

## 2. Registry and preload (anchored edits)
- `dist/content.js`: add `import { createFlags } from './flags.js?build=v3-survival-ae77fa84ac2b'; // [flags]` after the last feature import, and append `createFlags` at the **end** of `FEATURES`.
  - `decorModel(type, d)` already exists, so game.js needs no edit.
- `dist/live.js` `PRELOAD`: add `'flags-core.js', 'flags-model.js', 'flags.js'` in alphabetical order, after `'fishing-v2.js'`.
  - **`flags-ui.js` must not be added**, because it is lazy-loaded. `tests/live-preload.test.mjs` enforces both rules.

## 3. Pure core: dist/flags-core.js
```
export const PALETTE = ['#fff4dc','#f1c84d','#e0694e','#6fc3a8','#4f93c9','#24456b','#33383d','#8a5a8f']; // Cream, Sunshell, Coral, Seafoam, Lagoon, Navy, Charcoal, Plum
export const COLOR_NAMES = ['Cream','Sunshell','Coral','Seafoam','Lagoon','Navy','Charcoal','Plum'];
export const PATTERNS = ['plain','stripes','halves','cross','border','diagonal'];
export const EMBLEMS = ['none','shell','fish','star','gull','palm','anchor','sun','wave'];
export const EMBLEM_PATHS = { shell:'M…', fish:'M…', … };   // 8 original SVG path strings, viewBox 0 0 64 64
export const RANGES = [8, 6, 8, 9, 8];                      // bg, pat, patCol, emb, embCol
export const DEFAULT = Object.freeze([1, 0, 5, 1, 5]);       // sunshell, plain, navy, shell, navy
export const MAX_FLAGS = 24, REACH = 3.2, HOST_SLACK = .8;
export const keyOf = (x, z) => x + ',' + z;
export const designKey = d => d.join('.');
```
- `EMBLEM_PATHS` holds one `d` string per emblem. Each is original art, drawn with filled closed shapes only (no stroke-only lines), centred on (32,32) and kept inside 6..58. Each string is at most 600 chars of `MLHVCQZ` commands with no `A` arcs, so a fake `Path2D` can parse it.
  - shell: a scallop fan with 5 ribs cut in as notches.
  - fish: an oval body, a tail triangle and an eye hole made with a reversed sub-path.
  - star: a 5-point star.
  - gull: a wide shallow "M"-wing silhouette.
  - palm: a trunk curve and 4 fronds.
  - anchor: a ring, shank, stock and two flukes.
  - sun: a disc with 8 triangular rays.
  - wave: two stacked curling crests.
  - All shapes use the `nonzero` fill rule.
- `cleanDesign(v, strict=false)` returns a fresh array of 5 ints.
  - Each index must be an int in `[0, RANGES[i])`. A bad index takes `DEFAULT[i]`. A non-array gives `DEFAULT.slice()`.
  - With `strict`, any bad or extra value returns `null` instead (used for actions). The function never throws.
- `cleanSlice(data, decor?)` → `{ r, s, f }`.
  - It copies `signs-core.cleanSlice`: r is a safe int ≥ 0, s is a string ≤ 16 chars, and keys match `/^(-?\d{1,3}),(-?\d{1,3})$/` and are canonicalised.
  - Each entry goes through `cleanDesign` (lenient), and entries stop at `MAX_FLAGS`.
  - With a `decor` array, it drops keys whose tile type is not `'flagpole'`.
- `pruneSlice(st, decor)` deletes keys whose tile is no longer a flagpole and returns how many it deleted. It does not bump `r`; the caller does.
- `applyFlagAction(st, a, actor, env)` takes `env = { decorAt(x,z), pos(actor) }` and copies `applyDecorAction`. It checks everything before mutating, in this order:
  1. `kind === 'flag.set'`, else `bad`.
  2. x and z are ints and `decorAt` returns `'flagpole'`, else `notarget`.
  3. Distance ≤ `REACH + HOST_SLACK` from tile centre `(x*2, z*2)`, else `far`.
  4. `cleanDesign(a.d, true)` is not null, else `bad`.
  5. Same as the current design → `{ok:true, same:true}`.
  6. New key while at `MAX_FLAGS` → `full`.
  - On success it sets `st.f[key] = d`, does `st.r++`, and returns `{ok:true, key, d}`.

## 4. Model and painter: dist/flags-model.js
`export function buildFlagModel(T)` returns `{ instance(), uniforms, clothGeo, dispose(), stats() }`. Origin is the tile top. The model faces **+Z**.
- **Pole**: one merged, vertex-coloured, shared geometry built once, using the `decor-pack-models.js` add/merge helpers. It is unmistakably not the 2.4 m pennant.
  - Base: plinth box .4×.08×.4 `#6b4c30`, plus 4 corner pegs.
  - Mast: `Cylinder(.035,.05,3.3,8)` at y 1.73, `#8a6a45`.
  - Gold finial: `Icosahedron(.07,1)` at y 3.42, `#d9b25a`. Cleat: box .12×.03×.03 at (0,.9,.05). Halyard: box .012×2.4×.012 at (.045,2.1,0), `#eadcae`.
  - Material: `MeshStandardMaterial({vertexColors:true, roughness:.85})`.
- **Cloth**: shared `PlaneGeometry(1.2, .6, 12, 4)` translated by (.6, −.3, 0), so x runs 0..1.2 from the hoist and the top edge sits at y 0.
  - The cloth mesh is a child of the `pivot` Group at (0, 3.3, 0), stored as `g.userData.pivot` and `g.userData.cloth`.
  - Set `cloth.castShadow = false` (the depth pass would not wave) and `receiveShadow = true`.
- **Shared wave uniforms**: `uniforms = { uTime:{value:0}, uStr:{value:.3} }`, a single object for all poles.
  - `waveMaterial(map)` returns `MeshLambertMaterial({ map, side: DoubleSide })`, opaque and with no `forceSinglePass`, plus:
    - `onBeforeCompile = sh => { sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uStr = uniforms.uStr; sh.vertexShader = 'uniform float uTime; uniform float uStr;\n' + sh.vertexShader.replace('#include <begin_vertex>', WAVE); }`
    - `customProgramCacheKey = () => 'raftFlagWave'`.
  - `WAVE`:
```
#include <begin_vertex>
float fu = clamp(position.x / 1.2, 0.0, 1.0);
vec3 fo = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float fph = fo.x * 0.7 + fo.z * 1.3;
float famp = 0.04 + 0.14 * uStr * uStr;
transformed.z += famp * fu * sin(7.0 * fu - uTime * (4.0 + 5.0 * uStr) + fph);
transformed.y -= 0.06 * fu * fu * (1.2 - uStr);
```
  - The hoist edge (`fu = 0`) stays pinned. A weak wind droops the fly end.
- Every shared geometry and material gets `dispose = noop` and `userData.shared = true`, so `disposeGeometry` in rebuildRaft skips them. `dispose()` frees them with the prototype disposes.
- `instance()` returns a `Group` named `decor_flagpole` holding the pole mesh (cast and receive shadow) and the pivot with its cloth. The cloth material is set by flags.js.
- `paintFlag(g2d, d, w=128, h=64, P2D=globalThis.Path2D)` uses only the 2D API plus `P2D`, so it can be tested with fakes. Canvas x=0 is the hoist.
  1. Fill `PALETTE[bg]`.
  2. Draw the pattern in `PALETTE[pc]`, in units of h/64:
     - stripes: 5 equal horizontal bands; bands 1 and 3 are filled.
     - halves: the hoist half, `rect(0,0,w/2,h)`; cross: a centred bar 10 wide horizontally and vertically.
     - border: a 6-wide inset frame of four rects; diagonal: a triangle (0,h) (w,0) (w,h).
  3. When `emb > 0`, fill the emblem: `save`, with `k = 0.75*h/64`: `translate((w − 64k)/2, (h − 64k)/2)`, `scale(k)`, `fill(new P2D(path))` in `PALETTE[ec]`, `restore`.
  4. Draw a thin 1px darker hem line at the hoist.

## 5. Content module: dist/flags.js
State: `st = cleanSlice(undefined)` with `st.s = session`, a `live` Map of `tileKey → group`, an `anim` array of `{g, pivot}`, and `texs = Map<designKey, {tex, mat}>`.
- **Texture cache** `matFor(d)`:
  - It keys by `designKey(d)` and makes a 128×64 canvas with the `makeCanvas()` fallback (`decor-pack.js:31`).
  - It calls `paintFlag`, then creates `CanvasTexture` with `SRGBColorSpace` and anisotropy 4, and builds `waveMaterial(tex)`.
  - `tex.dispose` and `mat.dispose` become noop, plus `userData.shared = true`.
  - With no canvas, as in node, it uses one shared plain `waveMaterial(null)` whose `color` is `PALETTE[bg]`, keyed `'c'+bg`.
  - `prune()` keeps the keys used by `st.f`, plus `DEFAULT` when any live pole has no entry. It frees the others with the real prototype `dispose`. The cache size is therefore ≤ `MAX_FLAGS + 1`.
- `decorModel(type, d)`: when `type === 'flagpole'` and T and an int tile are available, it builds `models ??= buildFlagModel(T)` and calls `instance()`.
  - It sets `cloth.material = matFor(st.f[k] ?? DEFAULT).mat`, records the group in `live` and `anim`, and sets `dirty = true`.
  - It must not set `g.rotation.y`, because game.js applies `d.rot`.
- `apply(prevF)`: for each key that changed, if `live` has that key, swap `cloth.material` in place, then call `prune()`. **It never calls `rebuildRaft`.**
- `update(dt)`:
  - Read `s = ctx.world?.sailing`, with `wd = finite(s?.windDir) ?? 0` and `ws = finite(s?.windStr) ?? .3`.
  - Write `uniforms.uTime.value = ctx.elapsed` and `uniforms.uStr.value = ws`. These are two writes in total.
  - For each anim entry, set `pivot.rotation.y = wd − g.rotation.y + .06*sin(t*1.3 + ph)`, in the same direction convention as the pennant (`decor-pack.js:170`). Use a plain loop with no allocations.
  - Run a rescan when the decor array identity or length changes, or every 2 s on the host. The rescan drops dead groups from `live` and `anim`.
  - On the host only, the rescan runs `pruneSlice(st, decor)`. If anything was removed, it does `st.r++` and `apply`.
  - This covers shark breaks and a host `'undecor'` action that another builder may add. Nothing hooks undecor directly.
- `serialize()` is cached by `r`, like decor-pack. On the host, before returning, it runs the decor-staleness check and the prune above, so a save never stores an orphan entry.
  - It returns `{ v:1, r, s, f:{ key: d.slice() } }`.
- `load(data, from)`:
  - `'net'`: set `hostHasFlags = data !== undefined`. Short-circuit if `r` and `s` are unchanged. Otherwise `st = cleanSlice(data)`, with no decor pruning because the guest's decor may lag.
  - Otherwise: `st = cleanSlice(data, ctx.world?.decor)`, `st.s = session`, `st.r++`, and reset netR/netS and `hostHasFlags = true`.
  - Either path then calls `apply(prev.f)`.
  - Old saves load as `load(undefined)`, which gives an empty slice, so poles draw `DEFAULT`.
- `action(a, actor)` handles only `a.kind === 'flag.set'`.
  - It calls `applyFlagAction` with `decorAt` and `posOf` copied from decor-pack.
  - On a real change it calls `apply` and `ctx.emit({kind:'build', text:'Flag raised!'}, actor)`.
  - Refusals go out with `ctx.emit({kind:'notice', text})` using `REFUSALS = { far:'Step a little closer', full:'This raft already flies 24 flags' }`.
  - It returns true for every `flag.*` kind. Guests never mutate their own state: they wait for the host's ext.
- `target(aim)`: copy decor-pack's ray pick, limited to flagpole tiles, with an aim point near the pole axis between y .2 and 3.5 or on the cloth, within `REACH`.
- `prompt(aim)` returns `"Host's game is older"` when `oldHost()` (`ctx.role === 'guest' && !hostHasFlags`, copied from the bees guard). Otherwise it returns `'<kbd>E</kbd>Design flag'`.
- `interact(aim)`:
  - Return false if `ctx.uiOpen?.()` or there is no target.
  - If `oldHost()`, call `ctx.notice(OLD_HOST, 2400)` and return true.
  - Otherwise call `ctx.releaseLock?.()` and `openFlag(x, z)`, which lazy-imports `./flags-ui.js?build=…` as `loadUI` does in `decor-pack.js:106-115`, then return true.
- `dispose()`: destroy the UI, free every cached texture and material for real, call `models.dispose()`, and clear `live` and `anim`.

## 6. Dialog: dist/flags-ui.js (copy signs-ui.js structure)
`export function createFlagUI(api)`, where `api = { ctx, design(x,z) -> d|null, send(a), PALETTE, COLOR_NAMES, PATTERNS, EMBLEMS, EMBLEM_PATHS, paintFlag, cleanDesign, DEFAULT }`.
It returns `{ open(x,z), close(), destroy(), get isOpen }`.
- **Structure**: one `<dialog class="flag-dlg">`, built only with `createElement` and `createElementNS`, never `innerHTML`, plus an id-guarded `<style id="flag-ui-css">`.
  - Title "Your flag".
  - **Preview**: a `<canvas>` 256×128 at CSS 240×120, repainted with `paintFlag(g2d, cur, 256, 128)` on every change.
  - Rows:
    - **Background**: 8 swatch radio buttons.
    - **Pattern**: 6 buttons, each with a tiny 48×24 canvas painted with that pattern in the current colours.
    - **Pattern colour**: 8 swatches.
    - **Emblem**: 9 buttons, where "none" is an empty frame and each other button is an inline `<svg viewBox="0 0 64 64"><path d=…>` set with `setAttribute`.
    - **Emblem colour**: 8 swatches.
  - Buttons are ≥ 40×40 px, use `aria-pressed`, and have `aria-label` and `title` set to the colour, pattern or emblem name.
  - Footer buttons: Random, Cancel, Save. The Pattern colour row is hidden when the pattern is plain, and the Emblem colour row when the emblem is none.
- **Prefill**:
  1. If `api.design(x,z)` returns an entry, use that pole's design.
  2. Otherwise use the **last design this player saved**: `localStorage['little-raft-flag-last-v1']`, which holds a JSON array, read and parsed inside try/catch and passed through `cleanDesign`.
  3. Otherwise use `DEFAULT`.
- **Save**:
  - Store `cur` in localStorage inside try/catch, then send exactly one action, `api.send({kind:'flag.set', x, z, d:cur.slice()})`, then `close()`.
  - Clicks inside the dialog never go over the network.
- **Cancel**, Escape, and a backdrop click close the dialog without sending. Enter on a focused button activates that button natively, so Enter needs no global Save.
- **Input safety** (signs-ui):
  - Focus Save on `setTimeout(0)`, so the triggering E keydown does not land in the dialog.
  - Handle `cancel` with `preventDefault` followed by `close`.
  - Stop keydown propagation for every key except Escape, and stop wheel propagation. Never close on E.
  - Refuse to open while another `dialog[open]` exists.
  - On close, call `ctx.requestLock()` only if `ctx.running`.
  - `destroy()` sets `isOpen = false` first.
- The layout works at 360 px wide (rows wrap, `max-height: 90vh; overflow:auto`).

## 7. QA helper: raftDebug.content.flags
- `place(x=0, z=0)` works on the host only, on a raft tile with no decor. It pushes `{type:'flagpole', x, z}` and calls `ctx.rebuildRaft()`, as decor-pack does.
- `set(x, z, d)` calls `ctx.action({kind:'flag.set', x, z, d})`.
- `open(x=0, z=0)`, `close()` and `isOpen()` control the dialog. `state()` returns a JSON copy of `serialize()`, and `texCount()` returns `texs.size`.
- `wind()` returns `{ uTime, uStr, yaw:[pivot.rotation.y…] }`, and `models()` returns `models?.stats() ?? null`.

## 8. Tests: tests/flags.test.mjs (node, imports from `base` like signs.test.mjs)
- `cleanDesign`:
  - Lenient: clamps and defaults each index separately; non-array input gives `DEFAULT`; the result is a new array and the input is not mutated.
  - Strict: floats, negative values, out-of-range values, a length other than 5 and strings all give `null`.
- `cleanSlice`:
  - Removes bad keys, canonicalises `'01,2'` to `'1,2'`, caps at `MAX_FLAGS`, and prunes non-flagpole tiles when a decor array is given.
  - `undefined` input gives an empty slice, and the JSON round trip of a serialized slice is stable.
- `pruneSlice`: removing the flagpole from the decor array removes its entry, and other entries survive.
- `applyFlagAction`:
  - Covers the happy path, which bumps r, and the refusals `notarget`, `far` (at 4.1 m), `bad`, `same` (r unchanged) and `full` (the 25th new key), with no mutation on any refusal.
- **Content module**, built with fake ctx and no T: `createFlags(ctx)`.
  - Host action, then serialize, then a guest `load(net)` gives an equal `f`.
  - On a guest, `load(undefined,'net')` makes `prompt` return the old-host text, and `interact` returns true and calls `notice`.
  - Removing the pole from `ctx.world.decor` followed by `serialize()` drops the entry; `load(undefined)` (old save) does not throw.
- `paintFlag`, with a fake g2d that records calls and a fake Path2D:
  - It paints the background first, emblem 0 never constructs a Path2D, and each of the 6 patterns issues at least one fill.
- `EMBLEM_PATHS` has 8 keys equal to `EMBLEMS.slice(1)`. Each string matches `/^[MLHVCQZ0-9 .,\-]+$/i` and is at most 600 chars.
- Also run the existing `live-preload`, `module-specifiers`, `perf-lint`, `content`, `storage-research` and `signs` tests.

## 9. Out of scope
Free pixel painting, flags on sails or islands, raising and lowering animation, and per-player private designs. Picking a pole up drops its design. The last-design memory makes re-raising it one click.
