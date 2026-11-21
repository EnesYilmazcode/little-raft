# Cooking Pot and bowl soups: research

> Status (round 202611210849): not built here. A cookpot is already implemented on origin/claude/loop-features-202611210722 and -0814; merge that instead.

Status: research only, no code. Line numbers are from 2026-11-21 on `claude/loop-features-202611210849`. Re-grep the anchors before you edit.

## 1. How Raft's Cooking Pot works (web search, 2026-11-21)
- **Station.** You build it on deck. It has four ingredient pads around the pot and a fuel slot (planks). You press E to start.
  Sources disagree on fuel numbers. One says about 50 s of cooking per plank.
- **Recipes.** Every recipe takes exactly 4 ingredients. Most match exact items. A few match a category, for example
  Vegetable Soup takes any 4 potatoes or beets. Raft has about 12 pot recipes. If the 4 ingredients match no recipe, the pot will not start.
- **Cook time.** Dishes take 90, 150 or 210 s. Hearty Stew takes about 120 s.
- **Bowls.** You need an empty Clay Bowl to scoop up a finished dish. The bowl is used up when you eat, in contrast to cups.
  Pot dishes restore much more hunger and thirst than grilled food, and some give a bonus.
- **Stacking.** Bowl dishes stack in the inventory. The pot holds the finished servings until someone collects them.
- Sources: https://techraptor.net/gaming/guides/raft-cooking-guide, https://progameguides.com/raft/raft-cooking-pot-recipes/,
  https://primagames.com/tips/all-cooking-pot-recipes-in-raft-full-list, https://segmentnext.com/raft-cooking-pot,
  https://gamerempire.net/raft-how-to-use-the-cooking-pot/. Treat the exact fuel numbers as unconfirmed.

**Our take:** use 3 ingredient slots, not Raft's 4, because our ingredient economy is small. One wood cooks once, in 20 to 30 s, and makes 2 servings.
Every bowl comes back after eating. Nothing burns, spoils or is lost (the kiln rule, `kiln-core.js:3`). The recipe names are our own.

## 2. Prior art in other branches (read before building)
- `origin/claude/loop-features-202611210722` (commit a39b647b) already has `docs/specs/cookpot.md` and
  `docs/features/cooking-pot-research.md`. They use the same structure: `cookpot-core.js` (pure, kiln-core pattern), `cookpot.js` (content module)
  and `cookpot-model.js`, with ids `cookpot`, `bowl` and `meal_*`, actions `pot.add|fuel|take|back|eat`, and `world.ext.cookpot`.
  Its design is **buff-only, with no food values**, because vitals did not exist yet. Vitals (`dist/vitals.js`) now exist, so reuse its
  core and state shape, drop the buffs and give the soups FOOD rows. Keep its ids, so the two branches do not create duplicate kinds if both merge.
- The juicer branch is `origin/claude/loop-features-202611210831`. It has `docs/specs/juicer.md` (38686017) and work in progress (09b0f6b0).
  It **adds** `berries`, `coconut` and the smoothie cups `berrycup`, `coconutcup` and `mixcup`. It also **adds the missing `honeyfish` FOOD row**
  `{food:45}`, changes the watering `HARVEST` to `{leaf:2, coconut:1}`, adds `isDrink` to vitals.js and edits game.js `:736-738` (the prompt order, see §5).

## 3. What exists in this repo to reuse
**Content registry** (`dist/content.js`, its header lists the hooks). A module factory `(ctx, {peek}) => mod` has `name`, `serialize`/`load(data, from)`
(saved as `world.ext[name]`), `action(a, actor, bag)` (host only, claim the `pot.*` kinds), `interact(aim)` (E), `prompt(aim)`
(HTML `<kbd>E</kbd>…`), `decorModel(type)`, `update(dt)` and `debug`. Register it in `FEATURES` (`content.js:42`) and append it last.
`docs/features/content-hooks.md` describes the save, co-op and prompt flow.

**Items.** There are two registries. `dist/items.js` holds `ITEMS` (the catalogue, with `category:'food'`, recipes, unlocks and tips).
`dist/content-items.js` holds `CONTENT_ITEMS`, `CONTENT_RECIPES`, `CONTENT_DECOR` and `CONTENT_BLOCK_RADIUS`, and `inventory-state.js:33,82` spreads them
into `ITEM_INFO`/`RECIPES`. `registerBagKinds` (`items.js:457`) keeps those kinds through save and co-op snapshots. The kiln, animals and paint
add their kinds through content-items.js, and the pot should do the same. **Do not use `pots`** as an id: it is the Clay Pot Trio decor.

**Fuel.** `FUEL_VALUE` (`items.js:250`) is `{wood:1, leaf:0.5, seaweed:0.5}`, read with `fuelValue(kind)`. The grill (`cooking.js:22`) uses 45 s per wood
and holds at most 4 wood. A later commit on another branch changes that to 50 s per plank. The kiln (`kiln-core.js:5`) uses `FUEL_MAX:8` and `PER_WOOD:2`.
Seaweed and leaf are also ingredients, so, like the kiln, **only wood fuels the pot** (`interact` branches on the held kind).

**Kiln template** (`kiln.js` and `kiln-core.js`): this is the closest model to copy.
- State is `{k:{"x,z":entry}, r}`, with a revision counter `r` for cheap net change checks.
- `cleanEntry` and `cleanSlice` take a `decorAt` check. `stepAll(st, dt, onDone)` advances the stations, and `applyKilnAction(st, a, actor, bag, env)` handles actions.
- Actions are `kiln.load|fuel|take`. Station reach is `REACH:3.2`, and the guest's position comes from `ctx.other`.
- `target(aim)` does a ray test against decor of type `'kiln'`.
- Work happens on a scratch `Bag` and is committed only if everything fits.
- `onDone` calls `ctx.emit({kind:'loot', text}, 'all')`.

**Item kinds that exist** (names checked in this tree):
| kind | source | edible now (vitals `FOOD`) |
|---|---|---|
| `fish` | hook, rod (`items.js:106`) | 12.5 food, -10 water |
| `cookedfish` (Grilled Fish) | grill (`items.js:178`) | **35 food**, 0 water |
| `sharkmeat` / `cookedsharkmeat` | shark loot ×4, grill | 10 food, -5 water / 30 food, 0 water |
| `honeyfish` (Honey Glazed Fish) | hand: cookedfish + honey | **no FOOD row, so it cannot be eaten** (the juicer branch fixes this with 45) |
| `freshcup` / `saltcup` / `cup` | purifier, sea, plastic | 0 food, 40 water, returns `cup` / 0 food, -5 water / not edible |
| `puffegg`, `feather` | Puffhen nest (`animals.js`, `animals.collect`) | not edible (used by Egg Lantern) |
| `honey`, `wax` | beehive harvest (`bees.js:93`, `bees.harvest`) | not edible |
| `seaweed` | barrels (treasure pool) | not edible, 0.5 fuel |
| `leaf`, `seed` (Palm Seed) | debris, palm planter harvest (`farming.js:169`: leaf + seed) | not edible. Puffhens eat `seed`/`leaf` (`animals-core.js:10`) |
| `flowerseed` | island bushes, barrels | not edible (used by flower boxes) |
There are **no vegetable or fruit crops** in this tree. Farming only grows palms. `berries` and `coconut` exist only on the juicer branch, so do not use them.

**How eating works** (`game.js`).
1. Holding an `isEdible` kind and pressing left click calls `startEat` (`:682`). The bite takes `EAT_SECONDS` 0.8.
2. The host gets the action `{kind:'eat', item}` (`:1170`). It removes 1 item on a scratch bag, adds `FOOD[k].returns`, and refuses with "No room for the empty cup"
   if the returned item does not fit.
3. The host then emits `'ate'`, and the eater applies the bars with `consume` (`:1014`).
4. `eatLabel` builds the prompt, "Eat (+35 food)". It calls any kind ending in `cup` a drink, so soup ids must not end in `cup`.

So a soup needs nothing new in game.js: a FOOD row `{food, water, returns:'bowl'}` gives the bowl back for free.
Register the row with `addFood(kind, entry)` (`vitals.js:35`). If cookpot.js imports vitals.js, use exactly `./vitals.js?build=v3-survival-ae77fa84ac2b`.
A different query string loads a second module copy with its own `FOOD`, which is the juicer spec's warning.
The alternative is to append the rows in vitals.js `FOOD`, but the juicer edits that same block, so a merge conflict is likely.

## 4. Proposed recipes (3 slots, original names, existing kinds only)
**The baseline.** Hunger drains 0.09/s, so a full bar lasts about 18.5 min. Thirst drains 0.11/s, so a full bar lasts about 15 min.
Grilling 2 fish and drinking 1 fresh cup gives 70 food and 40 water for about 1 wood. A pot cook makes **2 bowls** and should beat its ingredients
eaten the "best" other way by about 15 to 25%. That keeps soup a nice upgrade, not a must-have.

The soups are a gentle mode: nothing is harmful (no negative values), nothing burns or spoils, and an unmatched set just waits.
`freshcup` is the broth base, and the pot gives the empty `cup` back when it is added.

| id | name | ingredients (any order) | per bowl food / water | ingredients' best alternative → pot total (2 bowls) |
|---|---|---|---|---|
| `meal_chowder` | Driftwood Chowder | fish, fish, freshcup | 40 / 22 | 70 / 40 → 80 / 44 |
| `meal_eggdrop` | Puff Egg Drop Soup | puffegg, puffegg, freshcup | 28 / 24 | 0 / 40 → 56 / 48 (eggs finally become food) |
| `meal_broth` | Kelp & Leaf Broth | seaweed, leaf, freshcup | 14 / 28 | 0 / 40 → 28 / 56 (the cheap thirst-quencher) |
| `meal_stew` | Shark Steak Stew | sharkmeat, sharkmeat, freshcup | 36 / 22 | 60 / 40 → 72 / 44 |
| `meal_porridge` | Golden Seed Porridge | seed, seed, honey | 30 / 10 | 0 / 0 → 60 / 20 (a breakfast treat, no cup needed) |
| `meal_captain` | Captain's Hearty Stew | cookedfish, puffegg, seaweed | 50 / 15 | 35 / 0 → 100 / 30 (the best one, 3 different sources) |
| `meal_mush` (optional) | Raft Mush | any other 3 ingredients | 10 / 8 | a fallback so no combination is ever "wrong" |

- Use the `meal_` ids to stay compatible with the older spec. Its names (Tide Chowder and others) can be swapped in.
- Bowl: `bowl: recipe('bowl', 'Driftwood Bowl', 2, {wood:1})`, stack 10. Meals stack 10, like grilled fish.
- Pot: `{clay:3, stone:2, scrap:1}` (from the older spec, so the kiln research teaches it), placeable through `CONTENT_DECOR` and `CONTENT_BLOCK_RADIUS: .35`.
- Do not add a honey drink or any `*cup` output. Juice and smoothies belong to the juicer.

## 5. Risks
- **Save compatibility.** Use a new `world.ext.cookpot` slice `{v:1, k, r}`. `load(undefined)` gives an empty slice. Validate keys against
  `decorAt === 'cookpot'`, as the kiln does, and stay well under `EXT_MAX` (200k chars). `content-items.js:3` warns that **older builds drop the whole bag**
  when it has an unknown kind (bowl or meal). That matters only for downgrades and mixed-version co-op.
- **Co-op.** The host is authoritative. `action()` claims `pot.*`, checks reach with `ctx.other` for the guest, and works on a scratch bag.
  Guests send actions through `ctx.action(a)`. Eating uses the engine's `eat` action, so the pot needs no `pot.eat`.
  The host sends `ext` about 8 times a second, so `serialize()` must be cheap and `load(…,'net')` must rebuild the model only when `r` changes.
  For a host on an older build, use a friendly notice like the juicer's `OLD_HOST`.
- **Prompts.** Return HTML from `prompt(aim)`, and the `content` raftPrompts provider converts it.
  - **The catch:** at `game.js:736` an `eatTip` (holding fish, cookedfish, sharkmeat or freshcup, which are ingredients) wins over `content.prompt`
    at `:738`. While the player holds an ingredient, the pot prompt never shows. E still works, because `content.interact` runs at `:1234`.
  - The juicer spec rewrites `:736-738` so an E content prompt wins. **Reuse that edit, do not write a second one.** Merge after the juicer, or make the identical change.
- **Branch overlap.**
  - vitals.js `FOOD`: the juicer adds rows. Prefer `addFood` from the module.
  - content-items.js and content.js `FEATURES`: append at the end and re-read right before the edit.
  - `honeyfish`: the juicer fixes it, so do not touch it.
  - The 202611210722 branch's cookpot: same ids, so coordinate. Rebase on it, or confirm it was abandoned.
  - The grill retune on another branch: do not depend on its seconds.
- **Input clash.** Kiln-style interact branches on the held item. The trouble is that holding an ingredient also arms click-to-eat (fish, freshcup).
  Use E for the pot and keep left click for eating. Holding a `bowl` with an empty pot just shows a hint.
