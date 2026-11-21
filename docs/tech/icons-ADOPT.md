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
`bakeIconAtlas(T, renderer, items, opts)`, `readIconCache(key)`, `ICON_ATLAS_VERSION`.

## 2. New file `dist/item-icons.js`

Copy `sandbox/icons/item-models.js` and rewrite its imports to the dist convention:

```js
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { bakeIconAtlas } from './icon-atlas.js?build=v3-survival-ae77fa84ac2b';
```

Exports `bakeItemIcons(T, renderer, getMaterial, build, kinds)` -> `Promise<{ kind: blobURL }>`,
plus `makeIconItems` and `ICON_POSES` (pose per kind; tweak there). Fish and rope have no world
model in dist, so this file holds two small procedural ones (`createFishModel`,
`createRopeCoil`). It also holds icon-only variants where the world model does not read at
40 px: `createRodIcon` (short thick rod, reel, bobber), `createJHook` (J hook, eye, rope),
`createScrapIcon` (torn corrugated sheet, rust, rivets), `createLogPile` (wood), and
`createLanternIcon` (the lantern without its 1.9 m post); the sail uses the craft model with
its height squashed to 0.68. If a world model changes, swap the builder in `makeIconItems`.

## 3. `dist/survival-ui.js` (6 edits, all additive)

a) Above `// Symbols that actually exist in icons.svg.` add:

```js
// Baked 3D item icons (kind -> image URL) from item-icons.js. Until set, the SVG sprite is used.
let BAKED = null, ICON_REV = 0;
export function setItemIcons(urls) {
  BAKED = urls && typeof urls === 'object' ? urls : null; ICON_REV++;
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
.sv-slot .sv-icon.sv-baked{margin:-5px;width:calc(100% + 10px);height:calc(100% + 10px)}
#inventory .sv-req .sv-icon.sv-baked{width:22px;height:22px;margin:-2px}
```

(The baked PNG has its own outline and shadow, so the CSS drop-shadow is dropped, and it has
about 5 percent transparent padding, so it is allowed to use the slot's inset. `pointer-events:none`
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
      bakeItemIcons(T, renderer, mat, iconBuild, Object.keys(ITEM_INFO)).then(urls => { if (!disposed && urls) setItemIcons(urls); }, e => console.warn('item icon bake failed, keeping SVG icons', e)); }, 400);
```

Uses existing locals: `later` (timer that is cancelled on dispose), `renderer`, `mat` (shared
material cache; debris icons draw from it and the baker never disposes those materials),
`disposed`, `ITEM_INFO` (already imported on line 12). Note the second
`rafId = requestAnimationFrame(animate)` in `resume()` (line ~1150) is NOT the anchor; the patch
anchors on the line followed by `  } catch (e) {`.

## Cache behaviour

With a real build id the 15 PNGs (data URLs, about 250 KB total) are stored in `localStorage`
under `littleRaft.icons.ia4.<build>`; older `littleRaft.icons.*` keys are removed when a new one
is written. The next load skips WebGL entirely (cache hit measured at 5.5 ms on SwiftShader, including blob conversion).
`build === 'dev'` never caches, so model edits show on reload. Changing poses, lighting or the
shader without a new build id: bump `ICON_ATLAS_VERSION` in `icon-atlas.js`.

## Verify

1. `python sandbox/icons/adopt_patch.py --check` prints `ok`.
2. `python sandbox/icons/shoot.py` (sandbox; uses a patched copy of the current
   `dist/survival-ui.js`), then read `sandbox/icons/shots/ui-inventory-2x-panel.png` and
   `ui-hotbar-2x-bar.png`: every slot, recipe and cost chip shows a 3D icon.
3. After `--apply` (do it on a scratch copy of the repo): run the game, read the inventory.
   The bake starts 400 ms after mount (title screen) and on SwiftShader finishes in a few seconds,
   before Solo; the hotbar, bag, recipes and cost chips all show PNGs. `localStorage` has one
   `littleRaft.icons.ia4.*` key; a reload paints PNG icons from it without a bake.
   (SwiftShader logs "GPU stall due to ReadPixels" a few times per page; the unpatched baseline
   logs the same.)
4. `RAFT_DIST=<patched copy>/dist node --test tests/survival.test.mjs` passes 22/22.
   `tests/legacy_hook.mjs` fails 2 tests on the unpatched dist too (HookCast attachment token);
   unrelated to icons.

## Rollback

Remove the two game.js lines; survival-ui keeps working with `BAKED = null` (pure SVG path).
