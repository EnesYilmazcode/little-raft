# Adopting the merged item icons into dist/

Target: the CURRENT dist (game.js 1780 lines, build `v3-survival-ae77fa84ac2b`), which already has
its own `dist/item-icons.js`: a lazy, idle-time renderer that draws each kind once into a PNG data
URL with its own small WebGL context. Callers:

- `dist/game.js:51` imports `getItemIcon, onIconReady` (pickup feed);
- `dist/game.js:1754` passes `getModel: modelOf` (models.js) to `createSurvivalUI`;
- `dist/survival-ui.js:6` imports `iconURL, warmIcons, onIconReady, setModelProvider`.

The round-2 fleet plan (game-renderer atlas baker, `setItemIcons`, blob URLs, 9 survival-ui edits,
2 game.js edits) no longer applies: it would compete with main's module, and the hooks it patched
have changed. **This adoption changes no caller.** It swaps one file and adds one file. Why this is
a merge rather than a replace or a drop: see `docs/tech/icons.md`, section "Retarget onto main's
item-icons.js".

## What changes

| file | action | notes |
|---|---|---|
| `dist/item-icons.js` | **replace** with `sandbox/icons/item-icons.js` | same exports: `iconURL`, `getItemIcon`, `loadItemIcon`, `warmIcons`, `onIconReady`, `setModelProvider`, `buildFallbackModel` |
| `dist/item-icon-models.js` | **new**, from `sandbox/icons/item-icon-models.js` | icon-only stand-in models (10 kinds); imports `./hammer.js?build=…` |
| `dist/game.js`, `dist/survival-ui.js` | none | their import lines are asserted unchanged by `--check` |

Both sandbox files are written against `?build=v3-survival-ae77fa84ac2b`. `adopt_patch.py`
rewrites the build id to the target dist's id, read from `game.js`.

What the merged module adds to main's renderer. The queue, the private context, data URLs and the
API all stay.

1. **Icon-only models first** (`ICON_MODELS`), then the models.js provider, then the old builders.
   These 10 kinds are hairlines or unreadable in models.js at 40 px: wood (log pile), scrap
   (corrugated rusty sheet), rope (coil), fish, hook (the held scrap hook, as in held-items.js /
   hook.js), hammer (hammer.js, thickened), fishing rod (thick, with reel and bobber), lantern
   (without its 1.9 m post), net (light frame with floats) and nail (three thick nails). These models
   come from the fleet baker's `item-models.js`; the nail is new.
2. **Cream rim for thin dark tools** (hook, hammer, rod, nail; 3.5 px at 128 px) so they read on
   the navy slots. It is a 2D-canvas pass, so it needs no GL program. Every other icon is encoded
   straight from the GL canvas, one readback as on main. (Round 3 also put a navy outline on every
   icon; it was invisible on the slots and cost two extra readbacks per icon, so it was dropped.)
3. **Material unify** for the render only. Each mesh gets a stand-in MeshStandardMaterial with the
   same uniforms, DoubleSide + vertexColors, no map, flatShading kept, and metalness capped at 0.35
   (the rig has no env map). This keeps the compile budget at main's level: 4 program links for all
   34 kinds. Without it the stand-in models cost 14 to 15 links.
4. **Robustness:**
   - a blank render returns null, so the slot keeps its SVG (detected by PNG size: no extra readback);
   - after a WebGL context loss the module drops the context and retries the kind, up to 2 times;
   - `setModelProvider` re-renders only the kinds the provider supplied, not the stand-in kinds;
   - after a live.js hot swap only one module copy renders (one GL context at a time): the copy
     that claimed last among those still in use (listeners or waiters). On a successful swap the
     old engine's `dispose()` drops the old copy's listeners, so the new copy owns the queue; if
     the new `mount()` throws, its `dispose()` drops the new copy's listeners and the old copy owns
     it again (`robust.py` case `failedSwapOldRenders`, `hotswap.py merged fail`).

## One command

```sh
python sandbox/icons/adopt_patch.py --check     # temp copy only: anchors, boot, shots, tests
python sandbox/icons/adopt_patch.py --apply     # writes the two files into dist/
```

`--check` does the following and never writes the real dist/:

1. Copies dist/ (or `--dist D`) to a temp dir.
2. Asserts that each of these 14 anchors appears exactly once:
   - 7 export lines of main's `item-icons.js`, to prove it replaces the right file;
   - 3 caller lines in `game.js`;
   - 4 caller lines in `survival-ui.js`.
3. Checks that the merged file exports every API name that main's does.
4. Checks that every `./x.js` that the new files import exists. `item-icon-models.js` must not
   already exist.
5. Applies the patch to the temp copy and re-asserts that the caller anchors are untouched.
6. Boots the **real game** through `index.html` / `live.js` in headless Chromium, using the brief's
   `executable_path` and SwiftShader args. It seeds a save (hotbar: hook, rod, hammer, wood,
   plastic, scrap, rope, nail; bag: 14 more kinds, including SVG-only ones), clicks Solo, waits for 8
   `img.sv-3d` in the hotbar, and writes `sandbox/icons/shots/adopt-hotbar.png`, `adopt-game.png`
   and `adopt-bag.png` (Tab).
7. Runs `node --test tests/*.test.mjs` with `RAFT_DIST=<temp copy>`.

Flags: `--no-game` and `--no-tests` skip those steps.

### Manual equivalent

```sh
B=$(grep -o "?build=[A-Za-z0-9._-]*'" dist/game.js | head -1 | sed "s/?build=//;s/'//")
sed "s/v3-survival-ae77fa84ac2b/$B/g" sandbox/icons/item-icons.js        > dist/item-icons.js
sed "s/v3-survival-ae77fa84ac2b/$B/g" sandbox/icons/item-icon-models.js  > dist/item-icon-models.js
```

Do not bump `?build=` in the callers by hand. The release flow bumps all of them together, as usual.

## Measured on this branch (2026-11-21)

Run on SwiftShader, on a 4-core box at load average 35 to 58 (other fleet agents), so ms are
relative and very noisy.

`--check` output:

```
ok: 14 anchors matched exactly once; API iconURL, getItemIcon, loadItemIcon, warmIcons, onIconReady, setModelProvider, buildFallbackModel preserved; imports present (build v3-survival-ae77fa84ac2b)
game: {"pageErrors": [], "consoleErrors": [], "hotbar3dAfterS": 103.0, "hotbar": ["img:hook", "img:fishingrod", "img:hammer", "img:wood", "img:plastic", "img:scrap", "img:rope", "img:nail"], "bag": {"img3d": 31, "svg": 19}}
tests (patched): not ok 1 - atlas: every generator gets a cell and the build stays fast | # tests 533 | # pass 532 | # fail 1
```

Tests, unpatched vs patched: both 533 tests, 532 pass, 1 fail. The failure is the same in both:
`tests/art.test.mjs` "atlas build took 3237 ms", a texgen timing assert that fails under box load.
It is unrelated to icons. The two item-icons tests in `tests/survival.test.mjs` (no-WebGL
degradation, `loadItemIcon` / `getItemIcon` contract) pass on the merged module.

Real game, same seeded save, unpatched main vs patched:
- time from Solo until 8 hotbar slots show 3D icons: 109 s vs 103 s;
- bag: 31 3D icons and 19 SVG icons in both;
- no page errors in either.

Shots: `shots/main-hotbar.png` / `shots/main-bag.png` (main) vs `shots/adopt-hotbar.png` /
`shots/adopt-bag.png` (merged).

Cost vs main (details in `icons.md`, Cost). Do not read this as "free":

| | main | merged (round 3, judge) | merged (now) |
|---|---|---|---|
| sandbox, all 34 ready, cold | 3.7 to 5.0 s (judge), 4.8 to 6.1 s (now) | 6.6 to 6.9 s, **~1.3 to 1.9x main** | 3.7 to 8.0 s, median ~1.1x main (within noise) |
| sandbox, worst game frame, cold | 0.27 to 0.55 s (judge), 0.5 to 1.8 s (now) | 0.93 to 1.23 s | 0.63 to 1.8 s |
| real game, Solo to 8 hotbar icons | 72.7 s | 72.0 / 53.5 / 74.5 s (equal) | equal (`--check` / `hotswap.py`) |
| data URL memory per module copy | 161 KB | 319 KB | 248 KB |
| GL links / contexts | 4 / 1 | 4 / 1 | 4 / 1 |

Hot swap through the real live.js (`python sandbox/icons/hotswap.py merged ok|fail`):
- `ok`: B's hotbar shows 8 3D icons, icon-context peak 1 during the swap, 0 live after both copies
  drain, bag 31 3D icons;
- `fail` (B's `mount()` throws after its UI claims the queue): live.js keeps the old engine and the
  old copy renders on (7 icons before, 19 after; the round-3 latch stopped at 11).

## Verify by hand

1. Start the game with `?build=` bumped and open the bag (Tab).
2. Hook, rod and hammer should be thick diagonal tools with a light rim. Wood should be a log pile,
   nails three thick nails. The other 3D icons have no outline, as on main.
3. Kinds with no model (sand, ingots, bolt, hinge, metal hook, binoculars, cooked fish, research
   table, grill, smelter, clay, stone, ores, seaweed, brick, glass) keep their SVG, as they do on main.
4. Hot swap to a new build (live.js): the icons come back and the console shows no "item icon" warnings.

## With procedural-models

`item-icons.js` (main's file and the merged one alike) imports `hook.js`, `hammer.js`,
`fishing-tool.js`, `plastic.js`, `crafts.js` and `debris.js` for the fallback builders, and
`item-icon-models.js` imports `hammer.js`. If procedural-models deletes any of these, update the
imports in the same commit. `--check` fails with "imports ./x.js, missing from dist" until you do.
`freeModel` already skips geometry and materials flagged `userData.shared`, so lowpoly-props' shared
`lp-*` materials are never disposed.

## Rollback

`git checkout dist/item-icons.js && rm dist/item-icon-models.js`. No caller was touched, and nothing
is persisted (no localStorage), so there is nothing else to undo.
