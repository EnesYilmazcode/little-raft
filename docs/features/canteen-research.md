# Canteen: research

Research for a refillable multi-sip water container. Line refs are against the current branch (`dist/`).

## 1. Reference (Raft) and our original take

What Raft does, kept general (exact numbers vary by version, so we copy none of them):
- **Cup**: filled with sea water from the ocean, purified in a purifier; one drink, then the empty cup comes back.
- **Canteen**: a crafted container holding several servings, drunk one at a time with the normal drink action,
  refilled at a purifier or water collector. It can also hold salt water.
- **Drinking bottle**: a later, bigger container on the same model. Filled/empty show as different item states.

**Our take (original): the Seaglass Canteen**
- Hand-crafted, `stack: 1`, holds up to **4 sips** of fresh water. Proposed recipe `{ glass: 1, rope: 1, plastic: 2 }`,
  unlock `research('glass')` (`glass` exists at `dist/items.js:141`).
- One sip = one cup: `+40 water`, same as `FOOD.freshcup` (`dist/vitals.js:29`). The water economy is unchanged;
  the canteen saves cups and slots, not water.
- A small blue bar under the hotbar slot shows the fill, reusing the durability bar.
- **Filling**: E/click on a *ready* purifier = +1 sip and the purifier empties (same yield as `takeWater`);
  E/click on a rain barrel with `w >= 1` = +1 sip, `w -= 1`; drag a Cup of Fresh Water onto the canteen in
  the bag = +1 sip and an empty cup back.
- **Drinking**: left click with sips runs the normal `EAT_SECONDS` drink flow, uses 1 sip, the canteen stays
  in its slot. Empty shows "Canteen: empty".
- **No salt water, no salt variant.** The barrel is already fresh-only (`dist/rain.js:138`); a salt canteen would
  need a second kind, purifier loading from it and a negative-water drink. Skip it.
- **Later**: a Clay Jug (`clay`, `dist/items.js:97`) with 8 sips: the same code with `durability: 8`.

## 2. How Little Raft hosts it

**Vitals and the eat flow**
- `dist/vitals.js`: `EAT_SECONDS` :23, `FOOD` :27-40 (cup drinks use `returns:'cup'`), `addFood` :46,
  `isEdible` :52, `consume` :87-93, `isDrink` :96, `eatLabel` :99.
- Client (`dist/game.js`): `eatKind()` :706 (selected kind if `isEdible`), `startEat` :707-711, the timer in
  `updateVitals` :726-730 (cancels on slot/kind change, then `action({kind:'eat', item})`), `updateEatTip`
  :744-749, `promptTip` :750, `updateContext` :765 (an E content prompt beats the eat tip).
- Click `dist/game.js:1401-1405`: an edible cup kind with a watering `click` target does that, else `startEat`.
  Cup fallback click :1424; `WATER_WHY` :1028, `CUP_KINDS` :1029.
- Host `'eat'` `dist/game.js:1314-1319`: checks `bag.count(k)`, removes 1, adds `FOOD[k].returns` (or "No room"),
  commits, emits `{kind:'ate', item}`. The eater applies bars on `'ate'` at :1126 (`consumeVitals`).

**Water sources**
- `dist/watering.js`: `PURIFY_SECONDS` :5, `WATER_ACTIONS` :8, `swapOne` :128 (keeps a single held item in its
  slot), `trade` :137, `loadPurifier` :157 (takes a `saltcup`, sets `world.purifiers[key] = {t, ready}`),
  `takeWater` :167-175 (needs `ready`, gives `freshcup:1` via `trade`, deletes the entry; uses no empty cup).
- `wateringTarget` `dist/game.js:1044-1061`: the barrel/sprinkler go to `rainTarget` (:1047); the purifier
  branch :1049-1055 sets `click` only when `cupHeld`, `e` always.
- Host validation: `applyWatering` `dist/game.js:1158-1172` (reach `USE_REACH + HOST_SLACK`), `applyRain` :1174-1179.
- `dist/rain.js`: `BARREL_CAP = 4` :8; `takeRain` :132-144 refuses a selected salt/fresh cup, then
  `swapOne('cup','freshcup')`, `e.w -= 1`; `rainTarget` :164-174 builds the prompts.
- Juicer `dist/juicer.js:43-62`: all-or-nothing on a scratch Bag; a model for "pour".
- E order, `interact()` `dist/game.js:1373-1391`: pickup, shark, **watering `w.e`** (:1385), hatch, content,
  grill, prog, inventory.

**Per-slot metadata: only `durability` (and `id`) exists**
- No generic `uses`/`charges` field anywhere in `dist/` (grep for charges/uses/sips: none on slots).
- Slots are `{kind, count, durability?, id?}` (`dist/inventory-state.js`): `copySlot` :113-119; `makeSlot`
  :121-126 (durability only for `isTool`); `validateSlot` :129-155 (**throws** on durability for a non-tool,
  silently drops unknown fields); `snapshot()` :358.
- `migrateSnapshot` `dist/items.js:610-670` rebuilds each slot as `{kind, count, durability (tools), id}`;
  **every other field is dropped**. Saves and co-op bags go through it via `snapBag` (`dist/game.js:154`):
  save load :246-249, the guest's canonical bag :2087-2089.
- `isTool`: `TOOL_KINDS` (`dist/inventory-state.js:12`) = hook, hammer, fishingrod + `TOOL_IDS`
  (`dist/items.js:310`, every `tool:true` entry). Tools get forced `stack: 1` (:68), `durability: <uses>` (:70),
  and `wearPerUse = 100 / uses` (:510-513).
- A crafted tool gets `durability: 100` (`dist/inventory-state.js:406`); so do `progression.js:174` and
  `progression-hooks.js:344`.
- Other carriers: chests use `cleanSlot` with Bag rules (`dist/storage-research.js:64-67`); crate undecor loot
  keeps `durability`/`id` (:388); `normLoot`/`tryLoot` pass meta through (`dist/decor-pickup.js:46,67`);
  `Bag.move` moves/swaps whole slot objects (`dist/inventory-state.js:307`).

**UI**
- Hotbar bar `durFrac` (`dist/survival-ui.js:123-131`) shows whenever `s.durability != null`; fixed
  green/orange/red at :483, aria "durability N percent" :486, the fast-path signature tracks durability :557.
- Tooltip `dist/item-tooltips.js:85-89`: tools show "Durability uses/max uses".
- Icons: `dist/item-svg.js` `ITEM_ICONS` :10 (juicer cups :418-440); 3D cups `dist/icon-models.js:196-197`.
- Held model `dist/held-items.js`: `HOLD` :40 (cup :57), sizes :70, `buildCup` :209, `buildItemModel` :243 (cup :294).
- Craft book `dist/craft-book.js`: `CATEGORY_OF` :14+ (a tool with no entry lands in "tools", :208), cup
  descriptions :90-91, "how to get" :454-455.
- Decor pickup: purifier veto/loot `dist/decor-pickup.js:24-36`. The canteen is not decor; no hooks needed.

## 3. Recommended data shape

**Make the canteen `tool:true` with `durability: 4`.** The fill level is the existing `slot.durability` on its
0..100 scale, 25 per sip (`wearPerUse('canteen') === 25`):
`item('canteen', 'Seaglass Canteen', 'tool', { tool:true, durability:4, iconTint:'#8fd8f2', recipe:hand({...}), unlock:research('glass') })`

- **Free**: stack 1; save, co-op, chest and undecor round-trips (`migrateSnapshot`, `validateSlot`, `copySlot`,
  `cleanSlot` and crate loot all keep tool durability); the hotbar bar; the tooltip count. An old build drops
  the unknown *kind* anyway (`dist/items.js:634`). A new `sips` field would need edits in about 7 places and
  would still be stripped by any peer that lacks them.
- **Rules**: `sips = clamp(round(d / 25), 0, 4)`; fill `d = min(100, d + 25)`; drink `d = max(0, d - 25)`,
  and the slot stays (never `remove`).
- **UI tweaks for `kind === 'canteen'`**: a blue bar instead of wear colours, tooltip "Sips 3/4", craft-book
  category `'survival'`.
- **A new canteen comes out full** (durability 100): a cozy starter bonus. Recommendation: accept it (or set
  `d = 0` after craft in the host's craft path).
- **New host actions**, validated like `applyWatering`:
  - `canteenFill {x, z}` on a purifier or barrel: checks reach, ready / `w >= 1`, selected canteen below 100.
  - `canteenPour {from, to}` (freshcup onto canteen): intercept `moveSlot` (`dist/game.js:1349`, host :1199)
    or add a new action; plain `Bag.move` would just swap the two slots.
- **Drinking reuses `'eat'`** with `item:'canteen'`: the host finds the selected (else the first) canteen with
  `d >= 25`, subtracts 25 and emits `{kind:'ate', item:'canteen'}`. Add `FOOD.canteen = {food:0, water:40,
  drink:true}` so `consume`/`eatLabel` work, but **skip the remove/returns path** for it.

## 4. Risks

- **Meta compat**: a `sips` field is dropped by `migrateSnapshot` (`dist/items.js:637-641`), `copySlot` and the
  HUD fast path, so it would be lost on every save and co-op tick. Non-tool durability throws in `validateSlot`
  (salvage then defaults it). The canteen **must** be `tool:true`.
- **Tool side effects**: hook/spear/spade wear and repair are kind-specific (`dist/game.js:1308`,
  `dist/spear-repair-hooks.js:67`, `dist/treasure-rules.js:151`). Keep `repairCost('canteen')` null (no R
  repair) and override the "tools" category (`TOOLISH`, `dist/craft-book.js:203-208`).
- **Stacking**: tools are forced to stack 1; `Bag.add` never merges them and `Bag.move` swaps whole slots. Fine.
- **Eat flow coupling**: once `isEdible('canteen')` is true, every call site needs a canteen case: `eatKind`
  (only with sips), the click at `dist/game.js:1401`, and the host at :1315 (`bag.count` is wrong; check the
  slot's durability). Cookpot/juicer must not treat it as freshcup. The `updateVitals` cancel check (:728)
  compares the kind only, which is fine because the slot keeps its kind.
- **Co-op authority**: fill and drink mutate on the host only; the guest sees the next `state.bag`. An old host
  rejects the unknown `item:'canteen'`, so nothing happens. New action kinds need an old-host notice like
  `dist/juicer.js:12` `OLD_HOST`. Two players on one purifier: `takeWater` deletes the entry, so the second
  request fails cleanly. Mirror that.
- **E vs click precedence**: the purifier `click` needs `CUP_KINDS` (`dist/game.js:1054`) and `rainTarget` keys
  on `kind === 'cup'`. Without explicit canteen branches, a click at a ready purifier would *drink*. Rule: aimed
  at a fill source with room = click and E both fill; otherwise click drinks. Today E on a ready purifier while
  holding a canteen would run `takeWater` and give a freshcup. Add the canteen to the `promptTip` check (:750).
- **Barrel "fresh only"**: `takeRain` refuses a selected salt/fresh cup; a selected canteen must route to
  `canteenFill`, not `takeRain`.
