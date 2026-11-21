# Diving gear: spec (one builder)

Source: `docs/features/diving-gear-research.md`. Four carry-to-use items that make a dive longer, faster, clearer and quicker to gather.
They never break, need no refills, and diving without them is unchanged. "Works while it is in your bag" (same rule as the Line Sinker).
New files: `dist/diving-gear-core.js`, `dist/diving-gear.js`, `tests/diving-gear.test.mjs`. Small edits: `diving.js`, `underwater-fx.js`,
`content.js`, `content-items.js`, `craft-book.js`, `icons.svg`, `survival-ui.js`, and one line in `game.js`. No new saved state.

## 1. Items (`dist/content-items.js`, append a `// diving gear (diving-gear.js)` block at the end of CONTENT_ITEMS)
The ids were checked against ITEM_INFO, CONTENT_ITEMS, items.js LIST (incl. honey/wax/candle/beehive/flowerbox/drum/pipes/bells),
paint (`brush`, `paint_*`), sleep/motor (`bed`, `motor`, `wheel`), rain (`rainbarrel`, `sprinkler`), kiln, animals and decor. None of them clash.
`item()` hard-codes stack 20, so write each row out with `maxStack: 1` (do NOT depend on paint.md's optional 5th `item()` param):
```js
  fins:    Object.freeze({ kind: 'fins',    name: 'Puff-Feather Fins', icon: 'icon-fins',    maxStack: 1, tool: false, placeholder: false }),
  airjug:  Object.freeze({ kind: 'airjug',  name: 'Breath Jug',        icon: 'icon-airjug',  maxStack: 1, tool: false, placeholder: false }),
  goggles: Object.freeze({ kind: 'goggles', name: 'Seaglass Goggles',  icon: 'icon-goggles', maxStack: 1, tool: false, placeholder: false }),
  scraper: Object.freeze({ kind: 'scraper', name: 'Tide Scraper',      icon: 'icon-scraper', maxStack: 1, tool: false, placeholder: false }),
```
Recipes (append to CONTENT_RECIPES with the file's `recipe()` helper):
`fins {feather:3, plastic:2, rope:1}`, `airjug {plastic:3, metalingot:1, rope:1}`, `goggles {glass:2, rope:1, leaf:1}`, `scraper {metalingot:1, scrap:2, wood:1}`.
They are NOT added to CONTENT_DECOR or CONTENT_BLOCK_RADIUS, and they are not tools (no durability, TOOL_KINDS unchanged).

**Research gating (reachability).** None of the ids is in items.js PROG_ITEMS, so `setOwnedElsewhere` leaves them to the Tinker's Desk.
`learnedFrom` teaches a recipe once every cost kind is in `seen`. The kinds to study are: fins = feather+plastic+rope; airjug = plastic+metalingot+rope;
goggles = glass+rope+leaf; scraper = metalingot+scrap+wood. Every one is already an ingredient of an existing recipe, so `researchableKinds` already accepts it.
`metalingot`/`glass` come from the research-gated kiln, and `feather` from the Nest Box (a starter item). `storage-research.js` `load()` re-runs
`learnedFrom(st.seen, c.learned)` (line 132), so an old save that has already studied those kinds learns the gear on load. Nothing to add.
Guard test: every cost kind of the 4 recipes is in `ingredientKinds()` minus the 4 gear ids (no gear needs another gear).

`craft-book.js`: in `CATEGORY_OF`, after the `researchtable: ...` line, add `fins: 'tools', airjug: 'tools', goggles: 'tools', scraper: 'tools',`.
In `ITEM_TEXT`, after the `cushion:` line:
```js
  fins:       { desc: 'Webbed fins stitched with puff feathers.', use: 'Works from your bag: swim 30% faster underwater.' },
  airjug:     { desc: 'A sealed jug of fresh air.', use: 'Works from your bag: a dive lasts 75 s instead of 45 s.' },
  goggles:    { desc: 'Goggles with seaglass lenses.', use: 'Works from your bag: see much further underwater.' },
  scraper:    { desc: 'A flat metal scraper for the seafloor.', use: 'Works from your bag: gather sand, clay and ore faster.' },
```

## 2. Shared dive modifier hook (gear + cooking-pot meals + anyone else)
Shape: a plain object **`DiveMods = { swim, oxy, fog, gather }`**. Every field is a multiplier with neutral value 1:
- `swim`: swim speed and its cap (normal and Shift). `oxy`: the length of a dive (drain time; refill time stays 7.5 s).
- `fog`: underwater fog far distance; the vignette also lightens by `1/fog`. `gather`: the **time** to gather (0.6 = faster).

Contributors are content modules that implement **`diveMods(m)`**. It multiplies fields in place, e.g. `m.swim *= 1.3`, and never assigns them.
It runs every frame, for the LOCAL player only, and must not allocate. So gear and meal buffs always **multiply**: fins x1.3 plus a meal
x1.15 gives swim 1.495. The registry resets the object to 1 and then calls each module in FEATURES order. `diving.js` clamps the result.
`content.js` edits (whichever builder lands first adds them; the other builder only implements `diveMods` in their module):
- In the "Module shape" comment, after `decorModel` line:
  `//   diveMods(m)               multiply m.swim/oxy/fog/gather in place (local player, per frame, no allocations; docs/specs/diving-gear.md)`
- In the returned object, after the `decorModel:` line:
  `    diveMods(out) { out.swim = out.oxy = out.fog = out.gather = 1; for (const m of mods) call(m, 'diveMods', out); return out; }, // shared dive modifier hook`
- Append `createDivingGear` to the imports (`import { createDivingGear } from './diving-gear.js?build=v3-survival-ae77fa84ac2b';`,
  same suffix as the neighbours) and to `FEATURES`.

## 3. `dist/diving.js` (defaults keep today's behaviour exactly)
1. Line 55: `export function stepOxygen(o, dt, underwater, secs = DIVE.OXY_SECONDS) {`. Line 57 drain only:
   `o = clamp(underwater ? o - dt / Math.max(1, fin(secs, DIVE.OXY_SECONDS)) : o + dt * DIVE.REFILL_RATE / DIVE.OXY_SECONDS, 0, 1);`
2. `DiveBody.step`, after line 100 (`const tiles = ...`): `const sm = clamp(fin(e.swimMul, 1), 0.5, 2), om = clamp(fin(e.oxyMul, 1), 0.5, 3);`
   Line 104: `const ox = stepOxygen(this.oxygen, dt, true, DIVE.OXY_SECONDS * om);`
   Line 113: `const speed = (inp.fast ? DIVE.FAST : DIVE.SPEED) * sm;`. Line 119: `if (m > DIVE.FAST * sm) { const c = DIVE.FAST * sm / m; ... }`.
3. `createDiving({..., hideAbove = [], getMods = null } = {})`. After line 190 (`const detail = ...`):
   `const mods = { swim: 1, oxy: 1, fog: 1, gather: 1 };`
   `function readMods() { mods.swim = mods.oxy = mods.fog = mods.gather = 1; if (getMods) { try { getMods(mods); } catch (e) { console.error('dive mods failed', e); } }`
   `  mods.swim = clamp(fin(mods.swim, 1), 0.5, 2); mods.oxy = clamp(fin(mods.oxy, 1), 0.5, 3); mods.fog = clamp(fin(mods.fog, 1), 0.5, 2); mods.gather = clamp(fin(mods.gather, 1), 0.25, 2); }`
   Change line 187 to `const env = { waterY: 0, floorY: 0, tiles: null, deckY: 0, swimMul: 1, oxyMul: 1 };`, and line 188 adds `fogMul: 1` to fxState.
4. `move()` line 208: `env.tiles = getTiles(); env.deckY = getDeckY(); env.swimMul = mods.swim; env.oxyMul = mods.oxy;`
5. `updateGather` line 259: `gather += dt / ((DIVE.GATHER_SLOW[targetType] ?? DIVE.GATHER_SECONDS) * mods.gather);`
6. `update()`: first statement after `dt = ...` is `readMods();`. Line 291 appends `fxState.fogMul = mods.fog;`.
7. `state` getter: add `mods: { ...mods }` (debug only; the getter already allocates). `capture()` is unchanged (oxygen stays a 0..1 fraction).
Also add `getMods:out => ...` to the hook comment at the top of the file. `tests/diving.test.mjs` must pass unchanged.

## 4. `dist/underwater-fx.js`
- Line 49 `OV_FS`: `uniform float uTime, uAlpha, uDeep, uLow, uVig; varying vec2 vUv;`. Line 58: `... + vig * uVig * (0.45 + 0.12 * uLow);`
  Line 59: `col = mix(col, vec3(0.02, 0.1, 0.13), vig * uVig * 0.7) + ...`.
- Line 105: add `uVig: { value: 1 }` to `ovUniforms`.
- Line 164: `function update(dt, { underwater = false, depth = 0, time = 0, lowOxygen = false, breath01 = 0, fogMul = 1 } = {}) {`
- Line 174: `fog.far = (FOG_FAR - k * 10) * fogMul;` (the ceiling's `uFar` at :179 follows it). Line 183 appends
  `ovUniforms.uVig.value = 1 / Math.max(1, fogMul);` (goggles 1.533 -> 0.65; values below 1 never darken it more).
- Update the usage comment (line 11). `exit()` already restores the saved fog.far.

## 5. `dist/game.js`: one anchored edit (line ~406, the `// diving lane hook` createDiving line)
Replace `onGather:id => action({kind:'gather', id})}); diving?.warm(renderer);` with
`onGather:id => action({kind:'gather', id}), getMods:out => content?.diveMods?.(out)}); diving?.warm(renderer);`
`content` already exists by then (it is created at line ~401). `?.` covers a missing registry or an older content.js. Re-read first: a merge agent may still be editing game.js.

## 6. `dist/diving-gear-core.js` (pure, no imports)
```js
export const GEAR_IDS = Object.freeze(['fins', 'airjug', 'goggles', 'scraper']);           // bit i = GEAR_IDS[i]
export const GEAR = Object.freeze({ fins: Object.freeze({ swim: 1.3 }), airjug: Object.freeze({ oxy: 75 / 45 }),
  goggles: Object.freeze({ fog: 46 / 30 }), scraper: Object.freeze({ gather: 0.6 }) });
export function blankMods(out = {}) { out.swim = out.oxy = out.fog = out.gather = 1; return out; }
export function gearMask(count)       // count(kind) -> number; bit set when count(k) > 0. Missing/throwing count -> 0. Never throws.
export function applyGear(mask, out)  // multiplies out.* by GEAR of each set bit (count above 1 adds nothing); returns out. Bad mask -> unchanged.
export function maskIds(mask, list)   // fills a reused array with the worn ids (in GEAR_IDS order), returns it
```
The numbers in use are fins 1.3, a 45 s -> 75 s dive, fog 30 -> 46 m, and scraper 0.6 (metal ore 1.4 s -> 0.84 s, others 1.0 -> 0.6 s).

## 7. `dist/diving-gear.js`: `createDivingGear(ctx)`, name `'divegear'`
- Imports only the core. It has no serialize/load/action/interact/prompt/decorModel: gear lives in the Bag, which is already saved and synced.
- `update(dt)`: every 0.25 s, `mask = gearMask(k => ctx.localBag()?.count(k) ?? 0)` (try/catch -> 0). On the host this is the host bag; on a networked
  guest it is `remoteBag`. When the mask or `underwater` changes, refresh the DOM. Nothing allocates while they are steady.
- `diveMods(m) { if (mask) applyGear(mask, m); }`.
- Underwater state: `window.addEventListener('raft:underwater', onUw)` reads `e.detail.underwater` (no edit to diving-ui.js). The listener is removed in dispose.
- DOM is created lazily on the first `update` (skipped when there is no `document`). There is one `<style id="divingGearStyle">` and these classes:
  - `.dgGear`: `position:fixed;left:50%;bottom:172px;transform:translateX(-50%);z-index:3;pointer-events:none;display:flex;gap:5px;opacity:0;transition:opacity .4s`.
    `.dgGear.on{opacity:1}`. It holds one `<span class="dgChip"><svg viewBox="0 0 48 48"><use href="SPRITE#icon-<id>"></use></svg></span>` per worn id
    (chip 22x22, `border-radius:50%`, `background:rgba(9,20,30,.72)`, `box-shadow:0 0 0 1px rgba(201,164,107,.45)`, svg 16px). It sits just above the
    O2 pill (`diving-ui.js` has the pill at bottom:130px). `@media(max-width:760px){.dgGear{bottom:152px}}`. Title attribute = item name.
    SPRITE url: copy `SPRITE_URL` from survival-ui.js:16-19 (`new URL('icons.svg', import.meta.url)` + `?build=`). Rebuild innerHTML only when the mask changes.
    `.on` when underwater && mask.
  - `.dgMask` goggles frame: `position:fixed;inset:0;z-index:2;pointer-events:none;opacity:0;transition:opacity .4s;background:rgba(10,28,34,.5);`
    `-webkit-mask:radial-gradient(ellipse 25% 40% at 32% 50%,transparent 90%,#000 100%),radial-gradient(ellipse 25% 40% at 68% 50%,transparent 90%,#000 100%);`
    `-webkit-mask-composite:source-in;mask-composite:intersect` (the dark rim shows only outside both lenses). `.dgMask.on{opacity:1}` when underwater && goggles bit.
  - `@media(prefers-reduced-motion:reduce){.dgGear,.dgMask{transition:none}}`.
- `dispose()`: remove the listener, both elements and the style.
- `debug` (raftDebug.content.divegear): `mods()` -> `applyGear(mask, blankMods({}))`; `worn()` -> `maskIds(mask, [])`;
  `give()` (host only, like kiln `give`) adds one of each to `ctx.localBag()` and returns how many were added; `mask()` -> mask.
- No fin overlay, jug badge or 3D viewmodel in v1.

## 8. Icons
`dist/icons.svg`: add 4 `<symbol viewBox="0 0 48 48">` at the end, in the same palette (stroke `#153e49` width 2, round joins):
`icon-fins` (two teal webbed fins with rib lines, a feather tuft at the heel), `icon-airjug` (a squat cream jug with a cork, rope handle and bubble),
`icon-goggles` (two round seaglass `#54a6a4` lenses with a highlight, a brown strap), `icon-scraper` (a grey metal blade `#9aa6ad` on a wooden handle `#bb8650`).
`dist/survival-ui.js`: append `'fins', 'airjug', 'goggles', 'scraper'` to the `SPRITES` Set (line 22). SPRITE_FOR is not needed, because the icon ids match.

## 9. Tests: `tests/diving-gear.test.mjs` (node:test)
1. With no gear, `gearMask(() => 0)` is 0 and `applyGear(0, blankMods())` leaves all fields at 1. A null, throwing or NaN count gives 0.
2. Each item alone sets only its own field (1.3, 75/45, 46/30, 0.6). All four together set all four.
3. A count of 5 has the same effect as 1. `applyGear` returns the same object it was given, and a second call on fresh blank mods gives equal values.
4. Multiplying: mods pre-set to swim 1.15 (a meal) end at 1.3*1.15 after fins. The core never assigns over a contributor's value.
5. `maskIds` reuses the passed array (and clears old entries).
6. Data: each of the 4 ids is in CONTENT_ITEMS with maxStack 1 and tool false, and in CONTENT_RECIPES (output count 1), but not in CONTENT_DECOR.
   None is in items.js `ITEMS`/`LEGACY_ALIASES` (so the progression catalogue never shadows them), and `ITEM_INFO[id].maxStack === 1`.
7. Reachability: every cost kind of the 4 recipes is in storage-research `ingredientKinds()`. `learnedFrom(costKinds('fins'))` includes `'fins'`.
8. diving.js: `stepOxygen(1, 45, true).empty` is true. With `secs = 75`, 45 s leaves about 0.4 and 75 s empties it. Refill is the same for both secs.
   `DiveBody.step` with `env.swimMul = 1.3` and Shift settles near `DIVE.FAST * 1.3`; without the field it settles at `DIVE.FAST`.
9. A `createContent` registry with a fake module `{name:'x', diveMods(m){ m.oxy *= 2; }}` returns oxy 2. A module that throws is disabled and the rest stay at 1.
Run the full `npm test`. The existing `tests/diving.test.mjs` and `tests/content.test.mjs` must pass untouched.

## 10. Co-op and saves
- The effects are local feel only. Each client reads its own bag (`ctx.localBag()`: the host bag, or the guest's synced `remoteBag`). There are no new
  messages or host checks: the `gather` reach check (`DIVE.REACH + 1.5`) stays, and faster gathering is still limited by `pending`/`REGROW`.
- Avatar gear (the `gear` field in `pose()`, meshes on the remote avatar) is skipped in v1.
- Save: no new keys, and no `world.ext.divegear`. Old saves have no gear, so every multiplier is 1. A dive saved with the jug stores oxygen as a fraction, so it loads fine.
  An older build drops the unknown kinds (same as every new item). Malformed counts are already cleaned by `migrateSnapshot`.
- QA: `shoot.py` with a seeded bag that holds all 4 (errors []). In the browser: `raftDebug.content.divegear.give()`, then `.mods()`
  -> `{swim:1.3, oxy:1.667, fog:1.533, gather:0.6}`. After `swimAt`, `raftDebug.state.dive.mods` matches, and the badges plus the mask show underwater.
  `node tests/coop-e2e.mjs` must not regress (test 4 is a known failure).

## Implementation notes
- Built as specified: `content.diveMods` registry hook, `diving.js` multipliers (clamped), `underwater-fx.js` `fogMul`/`uVig`,
  the one `getMods` edit in `game.js`, module `divegear`, 4 items/recipes, icons, SPRITES, craft-book tab/text.
- Deviation (forced): `tests/survival.test.mjs` hard-codes the Craft Book tools tab list; it now includes `fins, airjug, goggles, scraper`
  (between `fishingrod` and `metalhook`, the RECIPES order), since §1 puts the gear in `tools`.
- `diving-gear.js` imports `./diving-gear-core.js` without a `?build=` suffix (same as kiln/animals and their cores).
- `.dgMask` also sets the unprefixed `mask:` next to `-webkit-mask:` so non-WebKit browsers get the lens frame too.
- Item names for the chip titles are a small local map in `diving-gear.js` (the module imports only the core).
- `debug.give()` returns 0 on a guest or without a bag; it also forces the next `update` to re-read the bag.
- Tests: 10 (the 9 listed + one that drives the real module through `createContent` with a fake bag, host and guest).
- Browser QA (swiftshader, dt capped at 0.05 s/frame): no gear -> swim 3.23 m/s, oxygen drop implies a 45 s dive; seeded save with all 4 ->
  `state.dive.mods` = {swim 1.3, oxy 1.667, fog 1.533, gather 0.6}, swim 4.18 m/s, 75 s dive; 4 chips and the goggles frame show underwater.
