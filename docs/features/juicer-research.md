# Research: Juicer and fruit drinks

Goal: island fruit is gathered or grown; a placeable **Juicer** blends 2 fruit + 1 Cup of Fresh Water into a smoothie in a cup;
drinking it gives water + a little food and hands back the empty cup. Original design. No new npm deps. Imports carry `?build=v3-survival-ae77fa84ac2b`
(`tests/module-specifiers.test.mjs` fails on a stray or missing stamp, and an unstamped import would load a second copy of vitals.js with its own FOOD table).

## 1. Vitals, eat/drink flow, cup return (works with no game.js logic change)
- `dist/vitals.js:26-33` `FOOD = {kind: {food, water, returns?}}`. `freshcup` is `{food:0, water:40, returns:'cup'}`. `addFood(kind, entry)` at `:39`, `isEdible` at `:45`, `consume` at `:74`.
- `eatLabel` (`:83-90`) says "Drink" only when `!food && water` **or `kind.endsWith('cup')`**. Name the drink so it ends in `cup`, e.g. `smoothiecup` → "Drink (+12 food, +35 water)".
- game.js: `eatKind` `:660`, `startEat` `:661-665` (0.8 s `EAT_SECONDS`), the timer fires `action({kind:'eat', item})` at `:681`. Left click on any edible goes to `startEat` at `:1157-1160`
  (the cup kinds first try `wateringTarget`; a new kind skips that because `CUP_KINDS` at `:844` lists only cup/saltcup/freshcup).
- Host `a.kind === 'eat'` at `:1087-1091`: removes 1 on a scratch Bag, **adds `FOOD[k].returns`** (refuses with "No room for the empty cup"), commits, then emits `{kind:'ate', item}` to the eater.
  The eater applies the bars in `effect()` at `:936`. So a FOOD row with `returns:'cup'` gives the cup back in solo and in co-op on both sides.
- Two cosmetic spots key on `food > 0`: the "Eating…/Drinking…" label `:699` and `gulp(munch)` `:936`. A smoothie with food would read "Eating…" with a munch sound.
  Optional 2-line fix: use `FOOD[k].returns === 'cup' ? drink : eat` at both lines (or export an `isDrink(kind)` from vitals.js).
- Put the rows straight into the `FOOD` literal in vitals.js (both clients load it, no ordering risk). `tests/vitals.test.mjs:67-98` pins only existing rows, so new rows are safe.
- Found while reading: **`honeyfish` (items.js:181) has no FOOD row, so it cannot be eaten.** Out of scope; worth a one-line `honeyfish:{food:45, water:0}` while in the file.

## 2. Fruit sources (no NODE_KINDS change)
- `islands-layout.js:24` `NODE_KINDS` / `:88` layout loop: adding a kind changes the rng sequence and node order, so saved `isl.used[k]` (clean at `:177`) would point at other nodes. Do not touch it.
- **Bush outcome** (`lootFor`, `islands-layout.js:186`): `h<.2` leaf+flowerseed, `h<.5` leaf+seed, else leaf. `tests/islands.test.mjs:128-131` counts extras (`length-1`, must be 120..280 of 400)
  and flower seeds (40..130). Adding an extra item would push extras to ~0.7 and fail. Safe: **replace the plain-leaf branch's top part with berries only**:
  `h < .2 ? [[leaf],[flowerseed]] : h < .5 ? [[leaf],[seed]] : h < .75 ? [['leaf',1]] : [['berries',2]]` — length 1, both rates unchanged, deterministic (hash3).
  Bushes have max 2 uses and islands 2-4 bushes (`:25`, `:72`), so ~1-2 berry picks (2-4 berries) per island. Update the label at `islands.js:29` ("…a seed, a flower or berries").
  Optional test: berries rate over 400 seeds within ~60..140.
- **Grown: palm planter harvest** (`watering.js:7` `HARVEST = {leaf:2}`, `:188-196` `harvest`, text `:14`). The ripe planter already shows coconuts (`purifier-model.js:89`, `paintPlanter`).
  Make it `HARVEST = {leaf:2, coconut:1}` and texts `'+ 2 palm leaf · 1 coconut'` / `'… · 1 wood'`. Breaks exact text asserts at `tests/watering.test.mjs:144,148` (update them).
  Harvest stays atomic via `trade()` (`:137`). Pre-watering saves seed every palm ripe (`cleanWatering` `:67-70`): a free coconut each, harmless.
- Island palms (`lootFor` palm `:185`) could also drop a coconut on the last gather, but `islands.test.mjs:123-124,153` pin exact arrays; not needed.
- **Barrels** (`items.js:320-332`): leave alone. Weights are pinned by pacing comments (`:310-318`), `rollBarrel` edge tests (`progression.test.mjs:282-283`) and the pity table.
- `dist/farming.js` is a legacy module not wired into game.js (planters run on watering.js); ignore it.

## 3. Cups, purifier, watering
- Kinds live in `inventory-state.js:42-45`: `cup`, `saltcup`, `freshcup`, all **maxStack 5**. Cycle: cup →(click sea, `fillCup` `watering.js:150`)→ saltcup →(purifier load `:156`, the cup stays in it)
  → `takeWater` `:166` gives freshcup → drink (returns cup) / water planter (`swapOne` → cup) / rain barrel (`rain.js:140`) / sprinkler (`rain.js:154`).
- `swapOne(bag, from, to)` (`watering.js:127`) is the right helper shape; for 3-in-1-out use a scratch Bag (`trade` pattern `:137-143`).
- Holding a freshcup, **left click = drink** (or water a planter you aim at); **E goes through `content.interact` first** (`game.js:1142`, before `fc`, `prog` and watering `:1145`). So E on a juicer while holding anything is free for us.

## 4. Station patterns
- `smelter.js` `StationModel` (`:12-40`) + `smelter-ui.js`: single input + fuel + slot panel, driven by `progression-hooks.js`. **Any items.js item with `category:'station'`
  is auto-adopted** (`progression-hooks.js:32,88,229-239`) and gets a StationModel and slot panel on E. Station recipes must have exactly one input (`progression.test.mjs:142-144`)
  and `unlock:{type:'station'}` must name a `category:'station'` item (`:152`). A 3-input blend does not fit; **give the juicer `category:'decor'`** (like beehive) to stay out of that path.
- `cooking.js` GrillState / `fishing-cooking.js`: own fc lane, bespoke; not a template.
- `kiln.js` + `kiln-core.js` (docs/specs/kiln.md): content-module timed station, slice `world.ext.kiln`, E-load/E-take actions `kiln.*`, host tick, net revision. Good model **if** a timer is wanted.
- No `docs/specs/cookpot.md` exists.
- `bees.js` (docs/specs/beehive.md) is the closest template: items in items.js, `decorModel`, ray `target()` (`bees.js:116-137`), `prompt`/`interact`/`action` (`:200-225`), reach check `REACH + HOST_SLACK` on `ctx.other`/`ctx.physics`, OLD_HOST guard.

## 5. Content module plumbing
- `content.js:33-47`: import + append to `FEATURES`. Hooks listed at `:7-26`. A throwing module is disabled, not fatal. `world.ext[name]` saved/sent via `serialize()`/`load()`, capped 200k (`:48`).
- Placeable decor: items.js `placeable:true` + `BLOCK_RADII` (`items.js:240`, test `progression.test.mjs:120-123` requires both ways) → game.js `DECOR_TYPES` `:74` / `BLOCK_RADIUS` `:82` with no game.js edit.
  Model: `content.decorModel(type)` is reached by the decor chain `game.js:591` and the ghost `:428`.
- Prompts: `prompt(aim)` returns `<kbd>E</kbd>…` HTML; `promptParts` (`content.js:61`) feeds `#lrPrompt`.
- UI copy: `craft-book.js` `CATEGORY_OF` `:23`, `ITEM_TEXT` `:36ff` (bees rows `:95-101`), `ITEM_SOURCE` `:308ff`. `tests/craft-ux.test.mjs:123-130` needs a source for **every** ITEM_INFO kind:
  add ITEM_SOURCE rows for berries, coconut, smoothiecup (not hand-crafted). Icons: leave `icon` out → placeholder, drawn by `item-svg.js` `ITEM_ICONS` (`:10`, add `icon-<kind>` art);
  only a real icons.svg symbol must be listed in `survival-ui.js:22` SPRITES (`tests/item-icons.test.mjs:12-22`).

## 6. Co-op and saves
- Host-authoritative: guest `ctx.action({kind:'juicer.blend', x, z})` → host `content.action(a, actor, bag)` with the actor's bag; reply via `ctx.emit({kind:'loot'|'full'|'notice', text, loot}, actor)`.
- Bag snapshots of an older build drop unknown kinds (`content-items.js:4`); `registerBagKinds` (`inventory-state.js`) keeps items.js kinds through `migrateSnapshot`. Same as every new item.
- An instant blend needs **no state**: only a `juicer` decor entry plus bag kinds. To show "Your friend's raft has no juicer yet" to a guest of an old host, `serialize()` a constant `{v:1}`
  and set `hostHas = data !== undefined` in `load(data,'net')` (bees pattern `bees.js:165-176`).
- Reachability test `tests/progression.test.mjs:179-198`: `have` starts from debris + barrel loot. Add berries/coconut to the start set (island/planter sources) and a line like the bees one at `:191`:
  `if (have.has('juicer') && !have.has('smoothiecup')) { have.add('smoothiecup'); changed = true; }`.

## 7. Risks
- `category:'station'` for the juicer silently hijacks E with the smelter panel. Use `'decor'`.
- Stack caps: smoothie should be maxStack 5 like cups (cups are the limiting resource; 5 cups never multiply).
- Eat timer cancels when the slot changes (`game.js:678-680`), fine. Full bag: host refuses the eat if the cup cannot come back (`:1090`); the blend itself frees a cup slot net (3 in, 1 out).
- Name collisions: `fruit`, `berry` (a paint colour id in look.js, not an item, ok), `juice`. Pick `berries`, `coconut`, `juicer`, `smoothiecup`; check ITEM_INFO, RECIPES, DECOR_TYPES.
- Don't make raw fruit too good: a free water source would undercut the purifier loop.

## 8. Recommendation (simplest good design)
- **Items (items.js):** `berries` "Island Berries" (material, 20), `coconut` "Coconut" (material, 20), `smoothiecup` "Fruit Smoothie" (food, stack 5, recipe null),
  `juicer` "Juicer" (decor, placeable, `hand({wood:4, scrap:2, rope:1})`, `unlock: discover('berries')`), `BLOCK_RADII.juicer = .3`.
- **FOOD (vitals.js):** `smoothiecup:{food:12, water:35, returns:'cup'}`; raw snacks `berries:{food:4, water:2}`, `coconut:{food:6, water:8}` (raw fruit gives a reason to blend: 2 fruit raw ≈ 10 food/10 water, blended 12/35 + cup back).
- **Sources:** bush berries (§2 safe branch) and planter coconut (§2). No barrel, no node kind change.
- **Juicer = instant E-craft, stateless content module `dist/juicer.js` (+ `dist/juicer-model.js`)**, no timer, no slot UI, no world.ext data beyond `{v:1}`:
  prompt holding/with a freshcup and ≥2 fruit → `<kbd>E</kbd>Blend a smoothie`; else hints "Juicer: needs 2 fruit and a cup of fresh water". Action `juicer.blend`: host checks reach,
  takes `freshcup:1` + 2 fruit (any mix, berries first), adds `smoothiecup:1` on a scratch Bag atomically; client plays a 1 s whirr/spin on the model (visual only). Any two fruits make one smoothie kind.
- Edits: vitals.js FOOD, items.js, islands-layout.js `:186`, islands.js `:29`, watering.js `:7,14`, content.js import+FEATURES, craft-book.js rows, item-svg.js icons; optional game.js `:699,:936` drink cue.
  Tests: watering.test `:144,148`, progression.test reachability, new `tests/juicer.test.mjs` (blend atomicity, full bag, missing inputs, reach, cup returned on drink, bush rates unchanged).
