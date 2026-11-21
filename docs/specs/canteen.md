# Spec: Seaglass Canteen

Source: docs/features/canteen-research.md. Cozy rules: a refused fill, pour or sip changes nothing. The canteen saves cups and slots, **not water**.
Craft a **Seaglass Canteen**, fill it one sip at a time at a ready purifier or a rain barrel, or pour a Cup of Fresh Water into it in the bag.
Click to drink one sip (+40 water, the same as a fresh cup). The canteen stays in its slot. It holds 4 sips, shown as a blue bar under the slot.
Pure rules go in the new `dist/canteen.js`. The held/icon mesh goes in the new `dist/canteen-model.js` (it is given THREE and imports nothing).
**Build-query import rule:** every new or edited import carries `?build=v3-survival-ae77fa84ac2b` exactly (`tests/module-specifiers.test.mjs`).
canteen.js must **never import vitals.js**, because an unstamped copy would have its own FOOD table. Tag every hook `// [canteen]`.

## 1. Data shape: a tool whose durability is the fill
- `slot.durability` (0..100) is the fill, at 25 per sip. That makes `wearPerUse('canteen') === 25`, and `sips = clamp(round(d / 25), 0, 4)`.
  Tool durability already survives saves, co-op bags, chests and crate loot (`migrateSnapshot` `items.js:610-670`, `validateSlot` `inventory-state.js:129-155`, `copySlot` `:113`).
  A new `sips` field would be stripped in about 7 places, so do not add one. Stack 1 is forced for tools (`items.js:68`).
- **Crafted empty (durability 0).** If it came out full, every craft would give 160 free water for 1 glass + 1 rope + 2 plastic, which skips the purifier loop.
  Crafting it empty keeps the rule "purifier/barrel are the only water sources". It needs 3 small edits (section 6).
- **Not repairable:** add no `REPAIRS` row, so `repairCost('canteen')` stays null (`items.js:507`). R does nothing, and the spear/hook wear code is kind-specific, so it never touches the canteen.

## 2. Item, FOOD row, texts (dist/items.js, dist/vitals.js, dist/craft-book.js)
- `items.js`, after `camera` (`:192-193`):
  `item('canteen', 'Seaglass Canteen', 'tool', { tool: true, durability: 4, startEmpty: true, iconTint: '#8fd8f2', recipe: hand({ glass: 1, rope: 1, plastic: 2 }), unlock: research('glass'),`
  `tip: 'A sea-glass flask on a rope strap. Holds 4 sips of fresh water.' }), // [canteen]`
  The gating matches `camera` (`:192`, `research('glass')`). Every ingredient is reachable: glass from the smelter, rope and plastic from start.
- `item()` (`:63-74`): destructure `startEmpty = false` and set `if (tool && startEmpty) e.startEmpty = true;`.
  Export `freshDurability(kind)`, which returns `0` when `ITEMS[kind]?.startEmpty` and `MAX_DURABILITY` (100) otherwise. Put it next to `wearPerUse` (`:510`).
- `vitals.js` FOOD (`:27-40`): `canteen: {food:0, water:40, drink:true}, // [canteen] one sip; the host keeps the canteen (no returns)`.
  `isDrink` (`:96`) is true through `drink`, and `eatLabel` reads "Drink (+40 water)". `consume` works unchanged for the eater on `'ate'`.
- `craft-book.js`: in `CATEGORY_OF` (`:14-23`) add `canteen: 'survival'`, so it does not fall into "tools" through `info.tool` at `:208`.
  ITEM_TEXT after the cup rows (`:91`): `canteen: { desc: 'A sea-glass flask that holds 4 sips.', use: 'Click to sip. Fill at a purifier or rain barrel, or drop a fresh cup on it.' }`.
  ITEM_SOURCE is left to the recipe, as for `camera`.

## 3. Pure rules: dist/canteen.js (no DOM, no Date, no Math.random)
```js
import { BARREL_CAP } from './rain.js?build=v3-survival-ae77fa84ac2b';
export const SIP = 25, MAX = 100, SIPS = 4;
export const OLD_HOST = 'Your friend’s raft doesn’t have canteens yet';
export const EMPTY = 'Empty: fill at a purifier or rain barrel';
export const sipsOf = slot => slot?.kind === 'canteen' ? Math.max(0, Math.min(SIPS, Math.round((Number(slot.durability) || 0) / SIP))) : 0;
export function fillAmount(d, sips = 1)       // -> min(MAX, clamp(d,0,MAX) + sips*SIP); a non-finite d counts as 0
export function sipFrom(bag)                  // -> {ok:true, index} | {ok:false, reason:'empty'|'none', text}
export function fillFrom(world, key, bag)     // -> {ok:true, kind:'loot', text} | {ok:false, reason:'notarget'|'notready'|'empty'|'full'|'nocanteen', text}
export function isPour(bag, from, to)         // -> true when slot[from] is freshcup and slot[to] is a canteen below MAX
export function pourCup(bag, from, to)        // -> {ok:true, text} | {ok:false, reason:'notpour'|'full', text}
export function canteenTarget(world, d, slot) // d = {key, type, x, z} -> {prompt, click, e, why} | null
```
- `sipFrom`: use the **selected** slot if it is a canteen, else the first canteen with `sipsOf >= 1`. A selected canteen at 0 gives `{reason:'empty', text:EMPTY}`, and no canteen gives `none`.
  On ok, set `slot.durability = Math.max(0, d - SIP)` in place. The slot is never removed.
- `fillFrom`: the canteen is the selected slot. It must be `kind === 'canteen'` with `d < MAX`, else `nocanteen`, or `full` ("Your canteen is full").
  - `purifier` (a decor at key): it needs `world.purifiers[key]?.ready`, else `notready` ("Still purifying"). Then `d = fillAmount(d, 1)`, `delete world.purifiers[key]`, and the text is `'+ 1 sip (n/4)'`.
  - `rainbarrel`: it needs `world.collectors[key]?.w >= 1`, else `empty` ("The rain barrel is empty"). Then `d = fillAmount(d, 1)`, `e.w -= 1`, and delete the entry when `w <= 0` (same as `rain.js` `tidy`).
  - **One purifier load = 1 sip.** `loadPurifier` uses up a saltcup (one cup of sea water), and `takeWater` gives exactly 1 freshcup (`watering.js:157-175`). 1 sip = 1 freshcup = +40 water.
    Giving 2 or 4 sips would turn one cup of sea water into 80-160 water, so the purifier would become better than cups and the cup economy would break. The barrel gives 1 sip per `w`, the same as `takeRain`.
- `pourCup` is all-or-nothing on `s = new bag.constructor(bag.snapshot())`. If `!isPour` → `notpour`.
  If the from count is 1, that slot becomes `{kind:'cup', count:1}`. Otherwise count-1 and `s.add('cup', 1) === 0`, or `full` ("No room for the empty cup").
  Then `s.slots[to].durability = fillAmount(d, 1)`. Copy `s.slots` into `bag.slots`. Ok text `'Poured into the canteen (n/4)'`. One drop pours **one** cup and `amount` is ignored.
- `canteenTarget` returns null unless `slot` is a canteen and `d.type` is `purifier` or `rainbarrel`.
  - **Room and water** → `{prompt:'<kbd>E</kbd>Fill canteen (n/4)', click:{kind:'canteenFill', x, z}, e:{same}, why:null}`. Click and E both fill.
  - **Purifier still working** → `{prompt:'Purifying… (canteen n/4)', click:null, e:null, why:same}`. The game uses its own countdown text.
    A purifier with no entry, or an empty barrel → `null`. A full canteen → `null`. Null lets the normal cup prompts show, and a click then drinks.

## 4. Host actions and authority (dist/game.js)
| action | sent by | host check | effect |
|---|---|---|---|
| `canteenFill {x, z}` (new) | click / E at a fill source | ints, reach `USE_REACH + HOST_SLACK` from the actor's pose, as `applyRain` `:1174-1179` | `fillFrom(world, tileKey(x,z), bag)`, emit `loot` / `full` / `notice` |
| `eat {item:'canteen'}` (existing) | the eat timer | `sipFrom(bag)` | durability -25, emit `{kind:'ate', item:'canteen'}` |
| `moveSlot {from, to}` (existing) | dropping a freshcup on a canteen | `isPour(bag, from, to)` | `pourCup`; on ok emit `loot`, on `full` emit `full`, and never fall through to a swap |
- `applyAction`, before `'eat'` (`:1314`): `if (a.kind === 'canteenFill') { applyCanteen(a, actor, bag); return; }`. `applyCanteen` sits next to `applyRain` and copies its pose and reach checks.
- `'eat'` (`:1314-1319`): first line `if (a.item === 'canteen') { const r = sipFrom(bag); if (r.ok) emit({kind:'ate', item:'canteen'}, actor); else emit({kind:'notice', text:r.text}, actor); return; }`.
  This skips `bag.count`, remove and `returns`.
- `moveSlot` (`:1199`): `if (a.kind === 'moveSlot') { if (isPour(bag, a.from, a.to)) { const r = pourCup(bag, a.from, a.to); emit(...); return; } bag.move(...); return; }`.
- Client `moveSlot` (`:1349-1353`): the guest skips the local `localBag().move` when `isPour(localBag(), from, to)`, so the bag does not briefly swap. It waits for the next `state.bag`.
- **Co-op:** only the host mutates. The guest sends requests and sees the result in the next `state.bag`, and the eater applies the bars on `'ate'` (`:1126`).
  Two players on one ready purifier: the first fill deletes the entry, so the second gets `notready` and nothing changes. This mirrors `takeWater`.
- **Old host:** `HOST_CAPS` (`:1733`) becomes `Object.freeze({undecor:1, canteen:1})`. `const hostCanteen = () => role !== 'guest' || !!hostCaps?.canteen;`.
  When `!hostCanteen()`, the guest canteen branches (click, E, pour) call `notice(OLD_HOST, 2400)` and send nothing. An old host would ignore `canteenFill` and `isEdible('canteen')` anyway.
  An old host's `migrateSnapshot` drops the kind, so in practice the guest never holds one there. Mixed-version co-op is unsupported; say so in the PR.

## 5. Client hooks (dist/game.js)
- Import line: `import { sipsOf, isPour, pourCup, sipFrom, fillFrom, canteenTarget, OLD_HOST as CANTEEN_OLD_HOST, EMPTY as CANTEEN_EMPTY } from './canteen.js?build=v3-survival-ae77fa84ac2b'; // [canteen]`.
- `eatKind` (`:706`): `const s = …slots[selectedIndex], k = s?.kind ?? null; return isEdible(k) && (k !== 'canteen' || sipsOf(s) > 0) ? k : null;`. An empty canteen shows no eat tip.
- `wateringTarget` (`:1043-1047`): inside the reach branch, first `if (kind === 'canteen') { const c = canteenTarget(world, d, localBag().slots[localBag().selectedIndex]); if (c) return c; }`.
  So `w.e` in `interact()` (`:1385`) fills, instead of `takeWater` making a loose freshcup or `takeRain` refusing.
- `useSelected` (`:1401`), before the `isEdible` branch: `if (kind === 'canteen') { if (!hostCanteen()) { notice(CANTEEN_OLD_HOST, 2400); return; } const w = wateringTarget(aim);`
  `if (w?.click) { swing = 1; action(w.click); } else if (sipsOf(bag.slots[bag.selectedIndex]) > 0) startEat('canteen'); else notice(CANTEEN_EMPTY); return; }`.
  Do not add `canteen` to `CUP_KINDS` (`:1029`): that would route purifier clicks to `takeWater`.
- `promptTip` (`:753`): show the watering prompt also when `selectedKind() === 'canteen'`. An empty canteen aimed at nothing shows `CANTEEN_EMPTY` as a muted tip.
- `updateVitals` (`:728`): no change. The kind stays the same, and the host refuses a sip from an empty canteen.
- `debugApi` (`:2260`), host/solo only: `canteen: {give(sips = 4), fill(sips), state()}`.
  `give` adds a canteen at `sips*25` to the host bag and selects it. `fill` sets the selected canteen. `state()` returns `{selected, sips, durability, hostCaps}`.

## 6. Craft path, UI, models
- Crafted empty. Use `freshDurability(r.output.kind)` in place of `TOOL_DURABILITY` at `inventory-state.js:406` (import it from the items.js line `:3`).
  Use `freshDurability(id)` in place of `100` at `progression.js:174`. Leave `progression-hooks.js:344` (debug grant) full.
- `survival-ui.js:483`: `r.bar.style.background = s.kind === 'canteen' ? '#4fb6e8' : f > 0.5 ? …`. At `:486`, the aria label uses `', ' + sips + ' of 4 sips'` for a canteen.
  The fast-path signature (`:557`) already tracks durability. An empty canteen keeps the bar track visible at 0% width (it is not hidden).
- `item-tooltips.js:85`, before the tool branch: `if (kind === 'canteen') meta = slot ? \`Sips <b>${sipsOf(slot)}</b>/4\` : 'Holds <b>4</b> sips';`. The category chip reads "survival".
- `canteen-model.js` `createCanteenModel(T)`: Group `held_canteen`, about 0.16 x 0.2 x 0.07, low-poly with flat shading.
  - Body: a flattened round flask (cylinder r .08 h .06, 10 segments, rotated so its face is forward), sea-glass `#8fd8f2` with `transparent` .85 and `userData.glass = true`.
  - Neck: cylinder r .022 h .04 `#4f93b8`. Cork: r .02 h .025 `#c69860`. Rope strap: a thin torus r .085 tube .008 `#b0805a` around the rim.
  - Allocate it once per call. It has no fill mesh, because the bar shows the fill.
- `held-items.js`: import `createCanteenModel` (stamped). `HOLD` (`:40`): `canteen: { hand: 'right', pose: 'grip', rx: 0.15, rz: -0.35 }`. `SIZE` (`:69`): `canteen: 0.2`.
  In `buildItemModel` beside camera (`:305`): `if (!root && kind === 'canteen') root = fit(T, createCanteenModel(T), SIZE.canteen);`.
- `icon-models.js`: import the model, and in `SMALL` (`:188`, next to `freshcup` `:197`) add `canteen: T => createCanteenModel(T)`.
  `item-svg.js` ITEM_ICONS (`:10`): a flask body with a pale-blue disc, a cork and a strap arc. No icons.svg edit.
- `live.js` PRELOAD (`:16-36`): add `'canteen-model.js', 'canteen.js' /* [canteen] */` in alphabetical position after `'camera.js'`. `tests/live-preload.test.mjs` checks the list.

## 7. Tests: new tests/canteen.test.mjs (node:test, `RAFT_DIST` base, `bagWith` as in watering.test)
1. `fillAmount`: 0→25, 75→100, 100→100, NaN→25, -5→25, `fillAmount(0, 4) === 100`. `sipsOf` gives 0/1/4 for d 0/25/100, 0 for a non-canteen, and rounds 49→2.
2. `sipFrom`: the selected canteen at 100 → 75, and the slot keeps its kind, count 1 and index. An empty selected canteen → `empty` with the text `EMPTY` and the bag unchanged.
   Selecting a cup with a canteen at 50 elsewhere sips from that one. No canteen → `none`.
3. `fillFrom` purifier: ready → +25 and the entry is deleted. A second call → `notready` and nothing changes. Not ready → `notready`. Full canteen → `full`.
   A canteen not selected → `nocanteen`. A key with no purifier decor → `notarget`.
4. `fillFrom` barrel: w 2 → 1 and +25. At w 1 the entry is removed. Empty → `empty`. No salt or fresh cup is involved.
5. `pourCup`: freshcup ×1 onto a canteen at 0 → that slot is a `cup` and the canteen is at 25. Freshcup ×3 → ×2 plus a cup added.
   A full bag with freshcup ×3 → `full`, snapshot unchanged. A full canteen → `isPour` false. A saltcup → `notpour`.
6. `canteenTarget`: ready purifier → the E/click `canteenFill` action. Busy → prompt only. A full canteen or empty barrel → null. A non-canteen slot → null.
7. Items/vitals: `ITEMS.canteen.tool`, stack 1, `wearPerUse('canteen') === 25`, `repairCost('canteen') === null`, `freshDurability('canteen') === 0`, `freshDurability('hammer') === 100`.
   `new Bag().craft('canteen')` (with the cost given) gives durability 0. `migrateSnapshot` round-trips durability 50. `isDrink('canteen')`, and `eatLabel` is "Drink (+40 water)".
8. Model with the vendored THREE: it is named `held_canteen` and fits in 0.25 x 0.25 x 0.12.
- Existing tests: `progression.test.mjs` reachability (the canteen is reachable through glass). `survival.test.mjs:555` ITEM_TEXT. `craft-ux` every-kind loop. `live-preload`. Run `npm test` and `shoot.py`; `errors` must be `[]`.

## 8. Files and hooks
- New: `dist/canteen.js`, `dist/canteen-model.js`, `tests/canteen.test.mjs`.
- `dist/items.js` `:63-74`, `:192` and `freshDurability` near `:510`. `dist/vitals.js` FOOD row. `dist/inventory-state.js:3,406`. `dist/progression.js:174`.
- `dist/game.js` import, `:706`, `:753`, `:1043-1047`, `:1199`, `:1314`, a new `applyCanteen` near `:1174`, `:1349-1353`, `:1401`, `:1733`, `debugApi` `:2260`.
- `dist/survival-ui.js:483,486`, `dist/item-tooltips.js:85`, `dist/craft-book.js` CATEGORY_OF and ITEM_TEXT, `dist/held-items.js` `:40,69,305`, `dist/icon-models.js:188`, `dist/item-svg.js:10`, `dist/live.js:16`.
- **QA shot:** in the scratchpad, `raftDebug.canteen.give(1)` and hotbar close-up (blue bar at 25%, tooltip "Sips 1/4").
  Then place a purifier, make it ready, aim, and check the prompt "E Fill canteen (1/4)". Press E, then `state().sips === 2`.
  Click to drink, then `sips === 1`. Empty it and check the notice reads EMPTY. Take a held-model close-up.
- **Out of scope:** salt water in a canteen, pouring from the canteen back into a cup, the Clay Jug (later: the same code with `durability: 8`).
