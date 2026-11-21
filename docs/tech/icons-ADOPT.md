# Adopting baked 3D item icons into dist/

Result: every item in the hotbar, the bag grid, the recipe list and the recipe cost chips shows a
picture of the game's own 3D model (navy outline + soft drop shadow, one fixed studio light rig),
baked once at startup with the game's renderer. The existing SVG sprite stays as the fallback
until the bake finishes, and permanently if it fails or a kind has no model.

Checked against the current `dist/` (build `v3-survival-ae77fa84ac2b`): every anchor below occurs
exactly once (`python sandbox/icons/adopt_patch.py --check`).

## One-command version

```
python sandbox/icons/adopt_patch.py --check   # anchors match current dist/ exactly once
python sandbox/icons/adopt_patch.py --apply   # does steps 1-4 below
```

`--apply` reads the build id from `dist/game.js` and writes it into every new import. The manual
steps are listed so a reviewer can see exactly what changes.

## 1. New file `dist/icon-atlas.js`

Copy `sandbox/icons/icon-atlas.js` unchanged. It has no imports (THREE is passed in). Exports
`bakeIconAtlas(T, renderer, items, opts)`, `readIconCache(key, kinds)`, `ICON_ATLAS_VERSION`.

Failure and cancel behaviour (checked by `python sandbox/icons/robust.py`, all 6 cases pass; the
previous version failed 5 of them, and a throwing render left `renderer.autoClear = false`):
- Each tile's renders run inside `try/finally` that restores the render target, clear color and
  alpha, `shadowMap.enabled`, `autoClear` and `info.autoReset`. The whole bake is inside an outer
  `try/finally` that disposes the MSAA and atlas targets, the resolve quad (material + geometry),
  the optional env, every unified material, and every model built so far. That cleanup runs on
  success, on a throw from `make()`, a render or the readback, and on cancel.
- `opts.isCancelled()` is polled before the bake, before every tile, after the readback and before
  the cache write. When it returns true the bake resolves to `null` and writes nothing.
- Cache read: `readIconCache(key, kinds)` is a hit only if every requested kind is a
  `data:image/png;base64,` string. A missing kind, a non-PNG value, an array, or truncated JSON is
  a miss, so the bake runs again and overwrites the entry.
- Cache write: only keys that existed when the bake started (older builds or versions) are removed.
  If a different `littleRaft.icons.*` key appeared during the bake, then a newer engine wrote it
  (hot swap), so this bake is the orphan: it removes nothing and does not write its own key.

## 2. New file `dist/item-icons.js`

Copy `sandbox/icons/item-models.js` and rewrite its imports to the dist convention:

```js
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { bakeIconAtlas } from './icon-atlas.js?build=v3-survival-ae77fa84ac2b';
```

Exports `bakeItemIcons(T, renderer, getMaterial, build, kinds, isCancelled)` ->
`Promise<{ kind: blobURL } | null>` (null when cancelled; no blob URLs are created then), plus
`makeIconItems` and `ICON_POSES` (pose per kind, plus optional `look` resolve overrides; tweak
there). The caller owns the returned blob URLs (the survival-ui patch revokes them).

Builders for the 15 kinds: 5 dist builders unchanged (`createPlastic`, `createDebris` leaf,
`createCraft` palm / bench / crate). 2 dist models rescaled: hammer (`createHammer` with the
handle and head fattened 1.9x / 1.45x) and sail (`createCraft` squashed to 0.68 height). Fish and
rope have no world model in dist, so there are two small procedural ones (`createFishModel`,
`createRopeCoil`). 6 icon-only variants replace world models that do not read at 40 px:
`createScrapHookIcon` (the held scrap hook from `dist/hook.js`: the same curve, barb, riveted
ferrule and rope-wrapped wooden handle, laid flat and about twice as thick), `createRodIcon`
(short thick rod, reel, bobber), `createScrapIcon` (torn corrugated sheet, rust, rivets),
`createLogPile` (wood), `createLanternIcon` (the lantern without its 1.9 m post) and
`createNetIcon` (light frame, coarse grid of thick tan rope, orange floats). Hook, hammer and
fishing rod get `look: { rimPx: 1.6 }`, a light cream rim outside the navy outline, so they stay
readable on the dark brown slots. If a world model changes, swap the builder in `makeIconItems`.

## 3. `dist/survival-ui.js` (9 anchored edits, all additive)

a) Above `// Symbols that actually exist in icons.svg.` add:

```js
// Baked 3D item icons (kind -> image URL) from item-icons.js. Until set, the SVG sprite is used.
// This module owns the blob: URLs it is given: replaced ones are revoked here, the rest on destroy().
let BAKED = null, ICON_REV = 0;
function revokeIcons(urls, keep) {
  const k = new Set(keep ? Object.values(keep) : []);
  for (const u of urls ? Object.values(urls) : []) if (typeof u === 'string' && u.startsWith('blob:') && !k.has(u)) { try { URL.revokeObjectURL(u); } catch {} }
}
export function setItemIcons(urls) {
  const next = urls && typeof urls === 'object' ? urls : null;
  if (BAKED && BAKED !== next) revokeIcons(BAKED, next);
  BAKED = next; ICON_REV++;
  // repaint the live UI now: hotbar, open bag and recipe list swap without a reopen
  try { window[INST_KEY]?.update?.(); } catch (e) { console.error(e); }
}
```

b) First lines of `function iconSVG(kind) {` become:

```js
function iconSVG(kind) {
  const baked = BAKED && typeof BAKED[kind] === 'string' ? BAKED[kind] : null;
  if (baked) return `<img class="sv-icon sv-baked" src="${esc(baked)}" alt="" draggable="false" decoding="async">`;
  const n = norm(kind);
```

c) In `CSS`, after the `.sv-slot .sv-icon{...drop-shadow...}` line add:

```css
.sv-icon.sv-baked{filter:none;object-fit:contain;-webkit-user-drag:none;user-select:none;pointer-events:none}
.sv-slot .sv-icon.sv-baked{margin:-2px 0 0 -2px;width:calc(100% + 2px);height:calc(100% + 2px)}
#inventory .sv-req .sv-icon.sv-baked{width:22px;height:22px;margin:-2px}
```

(The baked PNG has its own outline and shadow, so the CSS drop-shadow is dropped. It has about
5 percent transparent padding plus the shadow on the lower right, so it grows 2 px up and left
only; the bottom-right corner, where the stack count sits, keeps the SVG's inset. The round-1
-5 px on every side put counts such as "20" on top of the art. `pointer-events:none`
plus `draggable="false"` keep the slot button as the drag source for the bag's drag and drop.)

d) In `slotSig(s)`:
`return s.kind + ':' + s.count + ':' + (f == null ? '' : Math.round(f * 100));` ->
`return s.kind + ':' + s.count + ':' + (f == null ? '' : Math.round(f * 100)) + ':' + ICON_REV;`

and in `paintSlot`:
`if (el._svKind !== s.kind) { r.art.innerHTML = iconSVG(s.kind); el._svKind = s.kind; }` ->

```js
  const ik = s.kind + '@' + ICON_REV;
  if (el._svKind !== ik) { r.art.innerHTML = iconSVG(s.kind); el._svKind = ik; }
```

This makes already painted hotbar slots swap SVG -> PNG on the next `update()` (game.js calls it
every frame), and the open bag on its next render.

e) In `buildRecipes()`:
`const key = recipes.map(r => r.id).join(',');` -> `const key = recipes.map(r => r.id).join(',') + '#' + ICON_REV;`

f) Refresh while the bag is open. In `createSurvivalUI`, after `let recipes = [], recipeEls = [];` add
`let iconRevSeen = ICON_REV;`, and in `render(force)` after `curSlots = slots; curSelected = selected;` add:

```js
    if (iconRevSeen !== ICON_REV && !dragging) {
      iconRevSeen = ICON_REV;
      if (isOpen) { buildRecipes(); recipeEls.forEach(v => { v.sig = null; }); force = true; }
    }
```

So when the bake lands while the bag is open, bag slots, recipe icons and cost chips swap at once
(the `setItemIcons` call itself triggers the repaint), with no close/reopen. Checked in the sandbox
(`ui-inventory-late-2x`: 47 SVG icons -> 0, 47 baked, dialog still open) and in the real game
(see Verify).

g) In the UI's `destroy()`, after `if (window[INST_KEY] === api) window[INST_KEY] = null;` add:

```js
      revokeIcons(BAKED); BAKED = null; ICON_REV++;
```

`destroy()` runs when the engine is disposed, and on a live.js hot swap when the new build's
`createSurvivalUI` replaces this instance. Each build's `survival-ui.js?build=` is its own module
with its own `BAKED`, so this revokes exactly the old build's 15 blob URLs.

## 4. `dist/game.js` (2 edits)

a) Line 17:
`import { createSurvivalUI } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';` ->

```js
import { createSurvivalUI, setItemIcons } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
import { bakeItemIcons } from './item-icons.js?build=v3-survival-ae77fa84ac2b';
```

b) In `mount()`, the bootstrap `try` block (around line 1194), right after
`    active = true; last = performance.now(); rafId = requestAnimationFrame(animate);`
and before `  } catch (e) {`, add:

```js
    later(() => { if (!renderer) return; const iconBuild = new URL(import.meta.url).searchParams.get('build') || 'dev';
      bakeItemIcons(T, renderer, mat, iconBuild, Object.keys(ITEM_INFO), () => disposed).then(urls => { if (!disposed && urls) setItemIcons(urls); }, e => console.warn('item icon bake failed, keeping SVG icons', e)); }, 400);
```

Uses existing locals: `later` (timer that is cancelled on dispose), `renderer`, `mat` (shared
material cache; debris icons draw from it and the baker never disposes those materials, nor any
material flagged `userData.shared`),
`disposed` (line 61; set by `dispose()`, which live.js calls on the old engine right after the
new one mounts), `ITEM_INFO` (already imported on line 12). `() => disposed` cancels the bake
between tiles, so a disposed engine's bake stops drawing on the transferred renderer, writes no
cache entry and creates no blob URLs. Note the second
`rafId = requestAnimationFrame(animate)` in `resume()` (line ~1150) is NOT the anchor; the patch
anchors on the line followed by `  } catch (e) {`.

## With procedural-models

`fleet-tech/procedural-models` replaces `dist/plastic.js`, `dist/crafts.js` and `dist/debris.js` (and
`deck.js`) with one module, `dist/lowpoly-props.js`, which exports `createPlastic(T)`,
`createCraft(T, type)` and `createDebris(T, type, getMaterial, opts)` with the same signatures and
return contracts (no imports of its own; THREE is passed in). Its 3 materials (`lp-solid`, `lp-cloth`,
`lp-glow`) are module-shared and flagged `material.userData.shared = true`.

The baker already leaves those alone: `disposeTree` in `item-icons.js` and `defaultDispose` in
`icon-atlas.js` skip any material (and geometry) with `userData.shared` truthy, as well as the game's
`mat` cache. Before this, a bake disposed `lp-solid` / `lp-cloth` 8 times (sail, palm, bench, crate,
plastic, leaf), forcing every raft prop to re-acquire its program.

Order: adopt either topic first. Then:

1. procedural-models steps 1 to 3 (add `dist/lowpoly-props.js`, switch the `game.js` imports, the
   `disposeGeometry` guard).
2. icons steps 1 to 4 (`adopt_patch.py --apply`), if not already done. Do this while
   `plastic.js`, `crafts.js` and `debris.js` still exist: `--check` refuses a dist that lacks a module
   `item-icons.js` imports.
3. In `dist/item-icons.js` replace the three builder imports

   ```js
   import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
   import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
   import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
   ```

   with

   ```js
   import { createPlastic, createCraft, createDebris } from './lowpoly-props.js?build=v3-survival-ae77fa84ac2b';
   ```

   No call sites change (`createDebris(T, 'leaf', gm, { seed: 3 })`, `createPlastic(T)`,
   `createCraft(T, 'sail' | 'palm' | 'bench' | 'crate')`). The `hammer.js` and `icon-atlas.js` imports
   stay. Do the same in `sandbox/icons/item-models.js` (`../../dist/lowpoly-props.js`) so later
   `--apply` runs produce it.
4. In `dist/icon-atlas.js` bump `ICON_ATLAS_VERSION` from `'ia4'` to `'ia5'` (also in the sandbox copy),
   so icons cached from the old models under the same build id are not reused. A new build id alone
   would also miss the cache, but the bump keeps a same-build adopt honest.
5. Only now delete the old builder files, after procedural-models step 4's grep over `dist/` and
   `sandbox/` comes back empty. `game.js` imports `item-icons.js` statically, so a missing builder
   module stops the game from booting.

Checked on a scratch copy of `dist/` with procedural-models steps 1 to 3, `--apply` and steps 3 and 4
above: the game boots with no page or console errors, loads `lowpoly-props.js` and `item-icons.js`
(not `plastic.js`, `crafts.js` or `debris.js`), and the hotbar and bag show baked icons of the low-poly
props with one `littleRaft.icons.ia5.*` key. Dispose listeners on the 3 `lp-*` materials counted
0 events during a full 15-icon bake with the current `item-icons.js`, against 8 with the previous
`disposeTree`. `adopt_patch.py --check --dist <copy without plastic.js crafts.js debris.js>` exits 1
and names the three missing modules.

## Cache behaviour

With a real build id the 15 PNGs (data URLs, 259,814 to 260,016 chars, about 255 KB) are stored in
`localStorage` under `littleRaft.icons.ia4.<build>`; keys of older builds that existed when the
bake started are removed when the new one is written (see section 1 for the orphan rule). A
`setItem` that throws (quota) is caught: icons still apply, nothing is cached, and the next load
bakes again. `build === 'dev'` never caches, so model edits show on reload. Changing poses,
lighting or the shader without a new build id: bump `ICON_ATLAS_VERSION` in `icon-atlas.js`.

Cache hit (`bakeItemIcons` with a warm cache: JSON parse, validate, 15 blob URLs; no WebGL):
- sandbox (`shoot.py`): 6.8 ms (DPR 1) and 6.9 ms (DPR 2).
- real game on a patched copy (`game_probe.py`), measured in the running game with a load average
  of about 42 on 4 cores: 191.9, 10.2, 61.2, 7.4 and 10.2 ms over 5 calls (median 10 ms; the first
  call includes module and storage warm-up). The judge measured 63 ms under similar load. Treat it
  as 10 to 200 ms on this box, with a few ms expected on an idle machine.
- after a reload, the hotbar shows baked icons 9.1 s after clicking Solo. That time is the game's
  own first frames on SwiftShader plus the 400 ms `later()`; the cache read is not the cost.

## Hot swaps (live.js)

Every new build id is a new cache key, so **each hot swap to a new build rebakes the icons
mid-gameplay** (the SVG sprite shows until the new bake lands). The old engine's bake is cancelled
when live.js disposes it. A remount with the same build id (same module) is a cache hit. Measured
with the real `live.js` (`python sandbox/icons/hotswap.py midswap|postswap`: version.json announces
a new build and the route handler serves the rewritten files the way a release does):

| | midswap (old bake in progress) | postswap (old bake done) |
|---|---|---|
| old-build tiles drawn after the old engine's `dispose()` | 0 (stopped after 6 of 15) | 0 |
| blob URLs created / revoked / live at the end | 15 / 0 / 15 | 30 / 15 / 15 |
| localStorage at the end | only `ia4.v3-test-hotswap` | only `ia4.v3-test-hotswap` (old key removed) |
| renderer after: autoClear, render target, programs / textures | true, null, 9 / 7 | true, null, 9 / 7 (same as before the swap) |
| page errors | none | none |

The round-1 code, under the judge's harness, ran both bakes on the shared renderer and created 30
blob URLs mid-swap, revoked none, and the orphan could delete the new build's cache key.

The rebake costs what a first bake costs: about 15 game frames (one tile per frame) with a short
compile hitch for 4 small programs. On SwiftShader the bake hitch could not be told apart from the
game's own frame times. If hot swaps during play become frequent, key the cache on a hash of
`item-icons.js` + `icon-atlas.js` instead of the build id, so a release that does not touch them
is a cache hit.

## Verify

1. `python sandbox/icons/adopt_patch.py --check` prints `ok` (anchors, plus every module `item-icons.js`
   imports exists in the target dist; `--dist <path>` checks or applies to another copy).
2. `python sandbox/icons/shoot.py` (sandbox; uses a patched copy of the current
   `dist/survival-ui.js`), then read `sandbox/icons/shots/ui-inventory-2x-panel.png` and
   `ui-hotbar-2x-bar.png`: every slot, recipe and cost chip shows a 3D icon.
3. After `--apply` (do it on a scratch copy of the repo): run the game, read the inventory.
   The bake starts 400 ms after mount (title screen) and yields one game frame per tile, so its
   wall time is about 15 game frames: 25 to 30 s from mount in the judge's runs and 86 s from the
   Solo click in round 2 (SwiftShader, load average about 42). Until it lands the SVG sprite
   shows; then the hotbar, bag, recipes and cost chips all show PNGs. `localStorage` has one
   `littleRaft.icons.ia4.*` key; a reload paints PNG icons from it without a bake.
   (SwiftShader logs "GPU stall due to ReadPixels" a few times per page; the unpatched baseline
   logs the same.)
4. `RAFT_DIST=<patched copy>/dist node --test tests/survival.test.mjs` passes 22/22.
   `tests/legacy_hook.mjs` fails 2 tests on the unpatched dist too (HookCast attachment token);
   unrelated to icons.
5. `python sandbox/icons/robust.py`: throw in `make()`, throw in a render, cancel after 2 tiles,
   orphan write, stale-key cleanup and corrupt cache entries all pass (`allPass: true`).
6. `python sandbox/icons/hotswap.py midswap` and `postswap`: `pass: true` (see Hot swaps).
7. `python sandbox/icons/game_probe.py <patched copy>/dist <out>`: fresh bake, hotbar and bag
   screenshots, in-game cache-hit timing, reload. Shots: `shots/game-adopted-hotbar.png` (spawn: the
   hotbar hook icon matches the held scrap hook) and `shots/game-adopted-bag.png`.

## Rollback

Remove the two game.js lines; survival-ui keeps working with `BAKED = null` (pure SVG path).
