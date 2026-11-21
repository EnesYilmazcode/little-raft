# Adopting the merged item icons into dist/

Target: main `8d21618` as merged into `claude/raft-tech` (game.js 2284 lines, 10-slot hotbar, build
`v3-survival-ae77fa84ac2b`). Main has its own `dist/item-icons.js` (298 lines). Since `3c62305` it renders
each kind once, in idle time, **through the game's own renderer** (`setIconRenderer`, a fresh 256 px render
target per icon, one `readRenderTargetPixels`, 2x downsample on a 2D canvas), encodes off the main thread
with `toBlob` into blob URLs (data URLs under `window.__det`), serves slot requests (`iconURL`) before the
warm-up (`warmIcons`), and falls back to models.js `getModel` for cup, seed and water. Callers:

- `dist/game.js:59` imports `iconURL, onIconReady, setIconRenderer`;
- `dist/game.js:438` calls `setIconRenderer(renderer)` right after the renderer is made;
- `dist/game.js:2255` passes `getModel: modelOf` (models.js) to `createSurvivalUI`;
- `dist/game.js:2262` pickup feed: `setIconProvider(k => iconURL(k) || feedSprite(k))` and `onIconReady`;
- `dist/survival-ui.js:6` imports `iconURL, warmIcons, onIconReady, setModelProvider`
  (`:131` slot lookup, `:460` provider, `:875` listener, `:1053`/`:1056` warm-up);
- tests: `tests/ux-r2.test.mjs` reads `POSE` and `ICON_FATTEN`, `tests/craft-r2.test.mjs` calls
  `resolveIconModel`, `tests/survival.test.mjs` checks the no-WebGL path.

**This adoption changes no caller.** It swaps one file, adds one file, and adds one line item to
`live.js`'s `PRELOAD`. Why a merge rather than a replace or a drop: see `docs/tech/icons.md`, section
"Retarget onto main's item-icons.js".

## What changes

| file | action | notes |
|---|---|---|
| `dist/item-icons.js` | **replace** with `sandbox/icons/item-icons.js` | superset of main's exports: `iconURL`, `getItemIcon`, `loadItemIcon`, `warmIcons`, `onIconReady`, `setModelProvider`, `setIconRenderer`, `resolveIconModel`, `buildFallbackModel`, `POSE`, `ICON_FATTEN` |
| `dist/item-icon-models.js` | **new**, from `sandbox/icons/item-icon-models.js` | icon-only stand-in models (10 kinds); imports `./hammer.js?build=…` |
| `dist/live.js` | `PRELOAD` (line 26): `'item-icons.js', 'item-svg.js',` -> `'item-icon-models.js', 'item-icons.js', 'item-svg.js',` | the new module joins game.js' static import graph; `tests/live-preload.test.mjs` fails without it |
| `dist/game.js`, `dist/survival-ui.js` | none | their caller lines are asserted unchanged by `--check` |

Both sandbox files are written against `?build=v3-survival-ae77fa84ac2b`. `adopt_patch.py` rewrites the
build id to the target dist's id, read from `game.js`.

Everything main's module does is kept as is: the shared-renderer path (and the private 128 px context
when `setIconRenderer` was never called), render-state save/restore, fresh target per icon, `toBlob` blob
URLs with stale-URL revocation after a provider swap, synchronous data URLs under `window.__det`, the
urgent queue ahead of the warm-up, the 5 ms / idle-deadline drain, `RELEASE_MS` 60 s, `FRAME` (pose, view,
crop, exposure for models.js hammer, lantern, rod, net), side-on `POSE` for hammer and rod, `ICON_FATTEN`
on the procedural hammer and rod, and the models.js `getModel` fallback for cup, seed and water.

What the merged module adds on top:

1. **Icon-only models first** (`ICON_MODELS`), then the models.js provider, then the procedural
   builders, then models.js `getModel`. These 10 kinds are hairlines or unreadable in models.js at
   40 px: wood (log pile), scrap (corrugated rusty sheet), rope (coil), fish, hook (the held scrap hook),
   hammer (hammer.js, thickened), fishing rod (thick, with reel and bobber), lantern (without its post),
   net (light frame with floats) and nail (three thick nails). `resolveIconModel(kind)` returns the same
   pick (`{model, own, src}`; `own` is true for stand-ins and procedural builds, false for provider and
   models.js clones).
2. **Cream rim for thin dark tools** (hook, hammer, rod, nail; 3.5 px at 128 px), a 2D-canvas pass on the
   copied canvas, so it needs no GL program and no extra readback. Rimmed art is framed with a 7 px
   margin; everything else keeps main's 1.06 framing. Note: the rim was tuned for the old navy slots.
   Main's slots are now light tan, where the rim is low contrast (it reads as a pale halo, see the shots).
   It still separates the tool from the slot; re-judge it if the slot colour stays.
3. **Material unify** for the render only. Each mesh gets a stand-in MeshStandardMaterial with the
   same uniforms, DoubleSide + vertexColors, no map, flatShading kept, and metalness capped at 0.35 (the
   rig has no env map). Stand-ins live until the icon renderer is released (60 s idle), then are
   disposed, which frees their programs on the shared renderer too.
4. **Robustness:**
   - a blank render gives no icon (`''`), so the slot keeps its SVG (PNG blob under 1100 bytes, or data
     URL under 1500 chars; no extra readback);
   - after a WebGL context loss the module drops the context (or its render target on the shared
     renderer) and retries the kind, up to 2 times;
   - `setModelProvider` re-renders only kinds that did not come from `ICON_MODELS` (main re-renders all);
   - after a live.js hot swap only one module copy renders: the copy that claimed last among those
     still in use (listeners or waiters). On a successful swap the old engine's `dispose()` drops the old
     copy's listeners, so the new copy owns the queue; if the new `mount()` throws, its `dispose()` drops
     the new copy's listeners and the old copy owns it again (`robust.py` `failedSwapOldRenders`).

## One command

```sh
python sandbox/icons/adopt_patch.py --check --baseline   # temp copy only: anchors, node --check, boot, shots, tests
python sandbox/icons/adopt_patch.py --apply              # writes the three files into dist/
```

`--check` never writes the real dist/. It:

1. copies dist/ (or `--dist D`) to a temp dir;
2. asserts that each of these 20 anchors appears exactly once:
   - 11 export lines of main's `item-icons.js`, to prove it replaces the right file;
   - 4 caller lines in `game.js` (`:59`, `:438`, `:2255`, `:2262`);
   - 4 caller lines in `survival-ui.js` (`:6`, `:131`, `:460`, `:875`);
   - the `PRELOAD` entry in `live.js` (`:26`);
3. checks that the merged file exports every API name that main's does, that every `./x.js` the new
   files import exists, and that `item-icon-models.js` does not exist yet;
4. applies the patch to the temp copy, re-asserts the caller anchors and the new `PRELOAD` entry, and
   runs `node --check` on the three written files;
5. boots the **real game** through `index.html` / `live.js` in headless Chromium (brief's
   `executable_path` and SwiftShader args), with a seeded save (hotbar: hook, rod, hammer, wood, plastic,
   scrap, rope, nail; bag: 14 more kinds, including SVG-only ones), clicks Solo, waits for 8 `img.sv-3d`
   in the hotbar and writes `sandbox/icons/shots/adopt-hotbar.png`, `adopt-game.png`, `adopt-bag.png`;
6. runs `node --test tests/*.test.mjs` with `RAFT_DIST=<temp copy>` (and, with `--baseline`, first with
   `RAFT_DIST=<unpatched dist>`).

Flags: `--no-game` and `--no-tests` skip those steps.

### Manual equivalent

```sh
B=$(grep -o "?build=[A-Za-z0-9._-]*'" dist/game.js | head -1 | sed "s/?build=//;s/'//")
sed "s/v3-survival-ae77fa84ac2b/$B/g" sandbox/icons/item-icons.js        > dist/item-icons.js
sed "s/v3-survival-ae77fa84ac2b/$B/g" sandbox/icons/item-icon-models.js  > dist/item-icon-models.js
sed -i "s/'item-icons.js', 'item-svg.js',/'item-icon-models.js', 'item-icons.js', 'item-svg.js',/" dist/live.js
```

Do not bump `?build=` in the callers by hand. The release flow bumps all of them together, as usual.

## Measured on 8d21618 (2026-11-21)

SwiftShader, 4-core box shared with other fleet agents: ms are relative and noisy.

`--check --baseline`:

```
ok: 20 anchors matched exactly once; API iconURL, getItemIcon, loadItemIcon, warmIcons, onIconReady, setModelProvider, buildFallbackModel, setIconRenderer, resolveIconModel, POSE, ICON_FATTEN preserved; imports present (build v3-survival-ae77fa84ac2b)
node --check ok: item-icons.js, item-icon-models.js, live.js
game: {"pageErrors": [], "consoleErrors": [], "hotbar3dAfterS": 89.7, "hotbar": ["img:hook", "img:fishingrod", "img:hammer", "img:wood", "img:plastic", "img:scrap", "img:rope", "img:nail", "empty", "empty"], "bag": {"img3d": 34, "svg": 47}}
tests (unpatched): not ok 12 - atlas: every generator gets a cell and the build stays fast | # tests 910 | # pass 909 | # fail 1
tests (patched):   not ok 12 - atlas: every generator gets a cell and the build stays fast | # tests 910 | # pass 909 | # fail 1
```

The one failure is the same in both: `tests/art.test.mjs`, a texgen build-time assert that fails under box
load. It is unrelated to icons. `tests/live-preload.test.mjs`, `ux-r2` (POSE / ICON_FATTEN),
`craft-r2` (`resolveIconModel`) and the survival item-icon tests all pass on the merged module.

Real game, same seeded save, unpatched main vs patched (same boot code):
- Solo until 8 hotbar slots show 3D icons: 91.9 s vs 89.7 s (equal within noise);
- bag: 34 3D icons and 47 SVG icons in both (the bag now lists the crafting panel's icons too);
- no page or console errors in either.

Shots: `shots/main-hotbar.png` / `shots/main-bag.png` (main) vs `shots/adopt-hotbar.png` /
`shots/adopt-bag.png` (merged). Main's hook, rod and hammer are thin models.js props, wood is one plank,
rope a single loop and nails grey hairlines; merged shows the held scrap hook, a thick rod with reel, a
chunky hammer, a log pile, a coil, a corrugated scrap sheet and three nails. The lantern is the lamp
without its post, the net a light frame.

`python sandbox/icons/robust.py` (private-context path, plus the shared-renderer path): all 18 cases
pass, including `contextLossRecovered`, `failedSwapOldRenders`, `contextsReleased` (after the 60 s
release) and the new `hostRendererRenders`, `hostRendererNoExtraContext` (no 128 px context is created
when `setIconRenderer` was called) and `hostStateRestored` (the host's render target, tone mapping,
exposure and clear colour come back unchanged).

Hot swap through the real live.js (`python sandbox/icons/hotswap.py main|merged ok`, load average 30 to 50):

| | main | merged (2 runs) |
|---|---|---|
| A: Solo to 8 hotbar icons | 39.8 s | 40.3 / 49.2 s |
| B: swap to 8 hotbar icons | 29.8 s | 85.8 / 58.6 s |
| 128 px icon contexts created / peak live | 0 / 0 | 0 / 0 |
| WebGL contexts live after settling | 1 (the game's) | 1 |
| bag right after the swap (3D / SVG) | 8 / 73 | 7 / 74 |

Both now render through the game's context only (`iconCreated: 0`), so the old "one icon context at a
time" concern is moot on the shared-renderer path; the ownership registry still keeps a superseded copy
from rendering into the new engine's renderer. The post-swap time to a full hotbar was slower for merged
in both runs than in main's one run. On this loaded box that may be noise, but it was not shown to be,
so re-measure on a quiet machine before relying on it. The fail-mode probe (`hotswap.py merged fail`) was
not re-run for this refresh; `robust.py` `failedSwapOldRenders` covers the same hand-back.

## Verify by hand

1. Start the game with `?build=` bumped and open the bag (Tab).
2. Hook, rod and hammer should be thick diagonal tools with a light rim. Wood should be a log pile,
   nails three thick nails. The other 3D icons look as on main.
3. Kinds with no model (sand, ingots, bolt, hinge, metal hook, binoculars, cooked fish, research table,
   grill, smelter, clay, stone, ores, seaweed, brick, glass, ...) keep their SVG, as they do on main.
4. Hot swap to a new build (live.js): the icons come back and the console shows no "item icon" warnings.

## With procedural-models

`item-icons.js` (main's file and the merged one alike) imports `hook.js`, `hammer.js`, `fishing-tool.js`,
`plastic.js`, `crafts.js`, `debris.js` and `models.js`; `item-icon-models.js` imports `hammer.js`. If
procedural-models deletes any of these, update the imports in the same commit. `--check` fails with
"imports ./x.js, missing from dist" until you do. `freeModel` skips geometry and materials flagged
`userData.shared`, and models.js clones are never freed (`own: false`).

## Rollback

`git checkout dist/item-icons.js dist/live.js && rm dist/item-icon-models.js`. No caller was touched and
nothing is persisted, so there is nothing else to undo.
