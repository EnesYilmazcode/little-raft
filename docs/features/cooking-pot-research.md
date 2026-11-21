# Cooking Pot and cosy meals: research

Status: research only, no code edits. Line numbers are from 2026-11-21, mid-merge (`game.js`, `content.js` and
`content-items.js` had conflict markers), so re-grep the anchors before you edit.

## Genre conventions (what survival raft and crafting games do)
- **Cooking pot station.** You build it on deck and feed it fuel. You load 2 to 4 ingredients, it
  cooks for a few seconds, and the dish comes out in a bowl. Recipes come from found recipe cards or
  from known combinations. Some games match the exact set of ingredients. Others match categories
  ("any meat + any veg").
- **Bowls** are cheap, one per serving, often returned. **Eating.** You hold the food and use it with the primary button. Food restores the hunger/thirst
  meters, and better meals restore more. Some farming games and Norse-survival games add timed
  buffs instead, such as speed, more stamina or longer breath. Usually one buff runs at a time.
- **Pressure.** Hunger, spoiling and burnt food push the player to cook.

## Our cosy take
There is no hunger, no spoiling and no burning, which matches `kiln-core.js:3` ("nothing burns,
spoils or is lost"). A meal is a small treat. It gives one **cosy buff** for a few minutes and a
warm toast ("Tummy full of Tide Chowder: swimming feels easy"). Eating never needs to happen.
Every buff makes an existing activity (swimming, diving, fishing, night sailing) a bit nicer. The
pot also gives the leftover ingredients a use: puff eggs, seaweed, palm seeds, fresh water and the
spare raw or grilled fish.

## Ingredients that exist (bag kinds)
`fish` (items.js:99), `cookedfish` (items.js:144, from the grill), `seaweed` (items.js:97, from
barrels), `leaf`, `seed` (Palm Seed, a small coconut: models.js:417, also dropped by farming.js:18),
`freshcup` (inventory-state.js:42, from the purifier, see watering.js:127 `swapOne`), and `puffegg`
(content-items.js, raft animals, arriving in the current merge). **Honey and beeswax do not exist in
the tree.** `bees.js` lives only on `origin/claude/loop-features-202611210648`. When it lands, add
one honey recipe (see "Later" below). Do not reference `honey` now. Fish species live only in the
local fish journal basket (fishing-cooking.js), so the bag sees plain `fish`. Recipes use bag kinds.

## Recipes (a pot holds 3 ingredients; the match ignores order; one cook makes 2 servings)
| id | Name | Ingredients | Buff | Time |
|---|---|---|---|---|
| `tidechowder` | Tide Chowder | fish, seaweed, freshcup | Swift Fins: swim +35% | 3 min |
| `puffomelette` | Puff Omelette | puffegg, puffegg, leaf | Springy Step: walk/sprint +15%, jump +15% | 3 min |
| `kelpbroth` | Kelp Broth | seaweed, seaweed, freshcup | Deep Breath: dive oxygen lasts 1.6x | 3 min |
| `smokybowl` | Smoky Fish Bowl | cookedfish, seed, leaf | Steady Reel: rod reel 30% faster, hook reel +30% | 3 min |
| `coconutcustard` | Coconut Custard | seed, puffegg, freshcup | Night Owl: nights look brighter | 4 min |
| `captainstew` | Captain's Stew | cookedfish, puffegg, seaweed | Cosy Glow: +10% swim/walk, 1.25x oxygen, reel +10% | 5 min |

- A `freshcup` put in returns its `cup` at once (`swapOne`). An unmatched set never cooks ("No recipe yet"); empty-hand E takes the last one back.
- Optional snack: plain `cookedfish` gives Swift Fins for 60 s. One buff at a time; a new meal replaces it and restarts the timer.

## Buffs mapped to code knobs
Movement runs locally on each client (game.js:1099 `physics.update` in `movePlayer`, and
game.js:1098 `diving.move`). Buffs can therefore be **module-level mutable multipliers** that each
client sets for its own player. They survive the many `new PlayerPhysics(...)` re-creations
(game.js:314, 1111, 1472, 1565).
| Buff | Knob | Change needed |
|---|---|---|
| swim speed | player-physics.js:134 `speed = C.SWIM_SPEED` (`C` is frozen, :7) and diving.js:113 `inp.fast ? DIVE.FAST : DIVE.SPEED` | Tiny edit. Export `BUFF = {walk:1, swim:1, jump:1}` from player-physics.js and multiply at :134 to :136. Export `DIVE_BUFF = {oxy:1, swim:1}` from diving.js and multiply at :113. |
| walk/sprint | player-physics.js:135 to :136 (`WALK_SPEED`/`SPRINT_SPEED`). MoveFeel (move-feel.js:51, :92) blends by a ratio, so a uniform multiplier in physics is safe | the same `BUFF.walk` |
| jump | player-physics.js:154 and :178 `this.vy = C.JUMP_IMPULSE` | `* BUFF.jump`, capped at 1.15 so deck building still feels normal |
| oxygen | diving.js:57 `o - dt / DIVE.OXY_SECONDS` (`DIVE` is frozen, :20, 45 s) | `/ (DIVE.OXY_SECONDS * DIVE_BUFF.oxy)` on the drain only, the refill stays as it is |
| rod reel | fishing-v2.js:15 to :18 `FISHING_TUNING.reelTime` (a plain mutable object: "so the glue/QA can tweak") is used at :112 | **No edit.** Keep the base value (3.5) at import and set `reelTime = base / mul` |
| hook reel | hook-physics.js:61 `REEL_SPEED = 8` (const) is used at :269 | Tiny edit. Export `HOOK_BUFF = {reel:1}` and use `REEL_SPEED * HOOK_BUFF.reel` |
| night vision | daynight.js:487 `hemi.intensity = ...` and :489 `toneMappingExposure = 1 - 0.15*nf`, rewritten every frame | **No edit.** In the pot module's `update` (it runs after daynight in FEATURES order), use `exposure = max(exposure, 1.0)` and `hemi.intensity = max(hemi.intensity, 1.25)`. This raises values and never accumulates, so it does not drift with `?daynight=off` (exposure stays at 1.0, hemi at 1.8) |
Each frame the module writes these multipliers from `buffFor(localActor)`, and writes 1 when no buff
runs. That costs no allocations. In `dispose()` all of them reset to 1. A "stamina" buff has no knob
because the game has no stamina. Do not invent one.

## Station flow (copy the kiln pattern)
- `kiln-core.js` is the template. It has pure rules with no imports (:1 to :5) and a slice
  `{k:{'x,z':entry}, r:rev}` cleaned by `cleanSlice` (:47). `applyKilnAction(st, a, actor, bag, env)`
  (:132) checks reach and `decorAt`, works on a scratch bag (`new bag.constructor(bag.snapshot())`)
  and then commits. Fuel works like `kiln.fuel`: it prefers the held wood stack, and an idle kiln
  never burns wood. kiln.js handles `interact` (:135 to :141, picking load, fuel or take from the
  held kind), `action` (:145), `update` (:99, host steps, everyone animates) and `decorModel` (:193).
- **Cooking pot** (`cookpot` decor; recipe `{clay:3, stone:2, scrap:1}`; block radius .35) works
  like this:
  E with a recipe ingredient held → `pot.add` (max 3). E with wood held → `pot.fuel` (2 cook-seconds
  per wood, `FUEL_MAX` 8 wood). When 3 ingredients match a recipe and fuel is in, the pot simmers for
  20 s, then 2 servings wait in the pot (`o`, `n`, max 6, the same recipe only). E with `bowl` held,
  or with any bowl in the bag → `pot.take` turns 1 bowl into 1 meal. With an empty hand, E on
  ingredients that match nothing → `pot.back`.
- **Bowl:** `bowl` "Coconut Bowl", hand recipe `{wood:1}` → 2, stack 20. Eating gives it back (like cup → freshcup → cup).
- Model: a squat clay pot on three stones, a bobbing lid and steam puffs. Reuse the kiln-model.js ember glow; no new light.

## How eating works
The registry has no primary-click hook. To add one you would need a game.js edit, so use **E while
holding a meal**. `content.interact(aim)` runs after pickups and before the fishing/progression and
inventory handlers (game.js:977 to :986). The pot module goes **last** in FEATURES so that chests,
animals and kilns that the player aims at still win. `prompt(aim)` (game.js:560) shows
`<kbd>E</kbd>Eat Tide Chowder · Swift Fins 3:00` whenever a meal is held and nothing else claims the
aim. The client sends `ctx.action({kind:'pot.eat', item})`. The host checks that the item is a meal,
`bag.remove(item, 1)` and `bag.add('bowl', 1)` happen on a scratch bag and are then committed, and it
sets `b[actor] = {m, s}`. A toast and a small HUD chip (the meal icon plus mm:ss, the text refreshed
at 2 Hz) show the active buff.

## Content registry integration
- `dist/cookpot-core.js` holds the pure rules: RECIPES, BUFFS, `cleanSlice`, `match`, `step` and
  `applyPotAction`. It is tested by `tests/cookpot.test.mjs` (match ignores order, full tray, nothing
  lost, cup returned, buff replace and expiry, malformed saves).
- `dist/cookpot.js` exports `createCookpot(ctx)` (name `'cookpot'`), appended to FEATURES at content.js:33; plus `dist/cookpot-model.js`.
- `content-items.js`: add the items `cookpot`, `bowl` and the 6 meal kinds (stack 10) to
  CONTENT_ITEMS (:9), the recipes `cookpot` and `bowl` to CONTENT_RECIPES (:39), `'cookpot'` to
  CONTENT_DECOR (:62) and `cookpot: .35` to CONTENT_BLOCK_RADIUS (:63).
- Icons: `icon-cookpot`, `icon-bowl`, `icon-meal` (tinted per meal) in icons.svg, added to SPRITES (survival-ui.js:22); meal kinds map via SPRITE_FOR (:139).
- game.js: no edits. The only engine edits are the three tiny buff exports (player-physics, diving, hook-physics).

## Co-op and save
- Actors are `'host' | 'guest'` (game.js:333 `actorBag`, :784). Buffs live in the host-owned slice
  `b: {host:{m,s}, guest:{m,s}}`, and **only the host ticks `s` down** in `update`. It is sent in
  `hostState` about 8 times per second. The guest reads `b.guest` from `load(data, 'net')`, the host
  reads `b.host`. Each client applies only its own entry, to its own local physics, diving and
  fishing. The host does not simulate the guest's physics, so buffs never leak across players.
- A guest's eat is a host action like any other (`ctx.action`), so guests never change the shared
  state locally. Bump `r` only when the pots change. While a buff runs, `s` in the network copy can be
  rounded to whole seconds.
- Save: `world.ext.cookpot = {k:{'x,z':{i:[...kinds], f, t, o, n}}, b, r}`. An old save gets
  `load(undefined)` and starts with empty pots and no buffs. Unknown kinds, a bad `s` (keep it within
  0 to 300) and pots that no longer exist (`decorAt`) are removed. Drop `b.guest` on
  `load(_, 'save')`, because a past guest's buff should not stay in the host's save.
  `restoreOwnRaft` ('restore') brings back the guest's own `b.host`.

## Later
Once `bees.js` merges: Honey Tea (honey, freshcup, leaf) → Sunny Mood, and beeswax as a "pot lid" upgrade (+1 serving).
Logbook: write "New recipe!" the first time you cook a meal.
