# Drying Rack: research

Fuel-free slow food station: 4 hooks, raw food dries over a few minutes into stackable snacks. Paths are `dist/` unless noted.
This is the researcher's read of the code only. No code was written.

## 1. Vitals and the eat flow
- `vitals.js:27-45` is the static `FOOD` table. `isEdible` is at `:54` (own key in FOOD) and `isDrink` at `:101` (no food and water != 0, or `returns`, `drink`, or a kind ending in `cup`). Snack kinds with food > 0 that don't end in `cup` count as food.
- `addFood` (`:47`) exists, but **juicer.js:6 warns against importing vitals.js from a content module**. A copy without the stamp gets its own FOOD table. **Add the snack rows to the static FOOD table directly** so host and guest both know them before any content loads.
- Eat flow: `game.js:726` `eatKind()` → `:1451` click with an edible starts the eat (`startEat`). The host action runs at `game.js:1361-1366` (`a.kind==='eat'`): it checks `isEdible`, removes 1 from a scratch Bag, and emits `{kind:'ate'}`. The eater applies `consume` at `:1156`. The tip label comes from `eatLabel` at `:768`.
- The eat tip is suppressed only when the content prompt starts with `<kbd>E</kbd>` (`game.js:786`). Every rack prompt must start with that, or a held fish shows "Click Eat" instead.
- Suggested values: driedfish `{food:10, water:0}`, kelpcrisp `{food:5, water:0}`, driedberries `{food:6, water:1}`. Raw fish is `12.5 / -10` and berries `4 / 2`, so drying trades a little food for no salt penalty and a bigger stack.

## 2. Raw item kinds (all exist)
- `items.js:118` `fish` (food) and `:120` `sharkmeat` (food, 4 per shark, `shark.js:27`). `:107` `seaweed` (material, not edible). `:116` `berries` (material, edible via FOOD). `:209` `coconut` (food).
- **There is no coconut-slice kind.** Coconut is a single nut item (`+5 food / +20 water`), and drying a drink makes no sense. Recommend leaving coconut out of v1.
- Optional 4th recipe: sharkmeat → "Salt-Sun Jerky". The rest of this doc assumes 3 recipes: fish→driedfish, seaweed→kelpcrisp, berries→driedberries.
- Fishing always yields the plain `fish` kind (`fishing-cooking.js:159`), so there are no species variants to handle.

## 3. Weather getters
- `content.js:134` `rain()` is a live 0..1 value through `bindRain(fn)` (`:135`). `content.js:138-140` `env = {wind(), night()}` comes through the optional `link(env)` hook, with fallbacks `.15` and `0`.
- `daynight.js:101` gives per-weather values: rain `[0,0,1]`, wind `[.15,.7,.5]` and cloud `[.25,.6,.95]` for calm, breezy and rain, blended over 25 s. The getters are at `daynight.js:782` (`wind`, `night`, `rain`, `day`, `storm`). **Cloud is not exposed**, so "sunny" means low night plus no rain. Calm weather is the sunny one.
- Weather is deterministic from seed and clock, but only the host steps the rack.
- With `?daynight=off` (`daynight.js:296`) there are no getters: rain is 0, wind .15 and night 0, so drying always runs at the calm rate.
- Suggested rate: `rate = rain>=.2 ? 0 : (0.3 + 0.7*(1-night)) * (0.8 + 0.6*wind)`. That is about 0.89 for calm day, 1.22 for breezy day and 0.27 at night. With `DRY_SECS = 150`, a calm day takes about 2.8 min.

## 4. Timed-station template (kiln)
- `kiln-core.js` is a pure module with no imports:
  - `KILN` consts (`:5`) and `blank()`/`cleanEntry`/`cleanSlice(data, decorAt)` (`:25-66`). The tile key regex is `/^(-?\d{1,2}),(-?\d{1,2})$/` with `|x|,|z|<=25`.
  - `sliceOf` (`:69`) returns `{v, r, k}`. `step` and `stepAll` (`:93-117`) clamp dt to `MAX_DT` and never allocate.
  - `applyKilnAction` (`:132`) runs every check first. It does bag edits on a scratch `new bag.constructor(bag.snapshot())`, then `commit`. It checks reach against `env.pos(actor)` (guest uses `ctx.other`), and every success bumps `st.r`.
- `kiln.js` is the wrapper:
  - Host-only stepping plus a 1 s prune of tiles with no decor (`:99-114`).
  - Cached `serialize` (`:50`). `load` (`:55`) skips the net copy when `r` is unchanged.
  - Ray `target(aim)` (`:26`). Prompt cache keyed on key, r, selection and pct (`:116`). `interact` → `ctx.action` (`:136`). `action` → emit `loot`/`notice` (`:145`).
  - `debug.run(sec)`. Undecor hooks at `:193-198`: veto while busy, loot = contents, then delete the key.
- `cookpot-core.js` follows the same pattern (`POT`, slots array `e.i`, `pot.back` returns the last ingredient). `biofuel-core.js` **does not exist**.

## 5. Content module wiring
- `content.js:60-93` imports. Each one uses `./x.js?build=v3-survival-ae77fa84ac2b`, and `tests/live-preload.test.mjs:47` plus `module-specifiers.test.mjs:27` enforce the exact stamp.
- `content.js:95` `FEATURES` ends `..., createSpyglass, createCookpot]`, and the comment says "cookpot stays last". The reason is that `cookpot.interact` takes E anywhere while a meal is held (`cookpot.js:229-232`). **Insert `createDryingRack` just before `createCookpot`.**
- `content.js:98` `NO_UNDECOR`: don't add the rack to it. Implement `beforeUndecor`/`undecorLoot`/`afterUndecor` like the kiln instead.
- Items: put the rack **and** the snacks in `content-items.js`, the same way as the cookpot and meals (`:58-65`, `:120-121`). Also add `dryrack` to `CONTENT_DECOR` (`:134`) and `CONTENT_BLOCK_RADIUS` (`:135`, ~.4).
  - `game.js:86` DECOR_TYPES and `game.js:220` cleanWorld then accept the decor automatically.
  - `inventory-state.js:33` merges the items into ITEM_INFO, and `:57` registerBagKinds keeps them through save and co-op.
  - **Keep the snacks out of `items.js`.** `tests/progression.test.mjs:180-203` fails for any items.js entry that has no recipe and no special-cased source.
- `live.js:16` PRELOAD must list `drying-rack.js`, `drying-rack-core.js` and `drying-rack-model.js`, because content.js imports them statically. `tests/live-preload.test.mjs:38` enforces this.
- `craft-book.js`:
  - `ITEM_TEXT` (`:58`) needs `desc` and `use` for every new kind (`tests/survival.test.mjs:555`).
  - `ITEM_SOURCE` (`:435`; cookpot entries at `:447-452`) needs `{tag:'drying rack', how:'Hang raw fish on a Drying Rack (E); it dries in the sun.'}` for each snack (`tests/craft-ux.test.mjs:124-131`).
  - `CATEGORY_OF` (`:50`) should map rack to building and snacks to survival.
- Icons: `placeholder:true` skips the icons.svg/SPRITES check (`tests/item-icons.test.mjs:13-23`). Add `ITEM_ICONS` drawings in `item-svg.js` for real art.
- Research: the rack's `CONTENT_RECIPES` cost is learned once all its kinds are seen (`storage-research.js:40`, see the cookpot test at `tests/cookpot.test.mjs:332`). Suggested cost: `{wood:4, rope:3, leaf:2}`, which is early game.

## 6. Prompt path, co-op, saves
- E order in `game.js:1420-1436`: seated, pickups, sails, nets, shark, watering, hatch, then **content.interact** (`:1435`), then the grill. The prompt order is in `game.js:778-789`. `promptParts` (`content.js:112`) converts `<kbd>E</kbd>label`.
- Guests:
  - `interact` sends `ctx.action({kind:'rack.hang'|'rack.take', x, z, item?})`, and the host runs `action(a, actor, bag)` with the guest bag.
  - **OLD_HOST pattern** (`juicer.js:12,98,177`): set `hostHas = data !== undefined` on a net load. If the host is old, the prompt and E show `OLD_HOST = 'Your friend’s raft doesn’t have a drying rack yet'`.
  - `serialize` must always return an object (`{v,r,k}`), even an empty one, so guests can detect the feature. Also gate on `gotNet` as the cookpot does (`cookpot.js:231`).
- Saves:
  - The slice is `world.ext.dryrack`, capped by `EXT_MAX` 200k (`content.js:99`). `content.serialize` keeps the last loaded slice if the module dies (`:146`).
  - An old build drops the `dryrack` decor (`game.js:220`) and unknown bag kinds (`content-items.js:4`). This is accepted, as with every content item.
  - `load(undefined)` must give an empty rack.

## 7. Proposed state shape (`world.ext.dryrack`)
`{v:1, r:<int rev>, k:{"x,z":{h:[hook|null ×4]}}}` where each hook is `{i:'fish'|'seaweed'|'berries', t:0..DRY_SECS}` while drying, or `{o:'driedfish'|'kelpcrisp'|'driedberries'}` when done.
- `DRY = {fish:{out:'driedfish'}, seaweed:{out:'kelpcrisp'}, berries:{out:'driedberries'}}` and `RACK = {HOOKS:4, DRY_SECS:150, MAX_DT:1, REACH:3.2, MAX_RACKS:100}`.
- E with a raw item hangs it on the first free hook. E without one takes the done items first; otherwise the prompt shows `n/4 · 63% · paused (rain)`.
- Taking back a raw item before it's done needs no consumption and no loss, to keep the game cosy.
- Round `t` to 0.1 and bump `r` only when the rounded pct changes. That keeps network churn low, as in `kiln-core.js:111`.
- Pass the rate to `stepAll(st, dt, rate)` so the core stays pure.

## 8. Risks
1. Prompt without a leading `<kbd>E</kbd>` lets the eat tip win (`game.js:786`).
2. Importing vitals.js from the module creates a second FOOD table, so use the static rows.
3. Placing the module after the cookpot means the cookpot eats E when a meal is held.
4. A missing ITEM_TEXT or ITEM_SOURCE entry, or a missing PRELOAD entry, fails the tests.
5. Snacks in `items.js` fail the reachability test.
6. Rev bumps every frame would spam the network, so bump `r` only on pct steps.
7. Rain blends over 25 s, so use a threshold (`rain>=.2`) for a clear "paused" state.
8. Undecor must return hung items (raw or dried) or veto, or items are lost.

## 9. Recommendation
Build it the kiln way, in three files:
- `drying-rack-core.js`: pure rules and actions, with node tests.
- `drying-rack.js`: the wrapper, which uses `bindRain` and `link(env)` for its rate.
- `drying-rack-model.js`: a frame with 4 hooks whose visible items swap raw/dried meshes.

Register items, recipe and decor in `content-items.js`; FOOD rows in `vitals.js`; text, source and category in `craft-book.js`; PRELOAD in `live.js`; `createDryingRack` in FEATURES just before `createCookpot`. Leave coconut out. Shark jerky is an optional 4th recipe. Snack stack size 30, edible through the normal click-to-eat flow.
