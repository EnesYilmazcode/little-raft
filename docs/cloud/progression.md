# Lane: items, recipes and progression

Branch `claude/raft-progression`. This lane makes the hook, craft, unlock and build loop work like Raft's, with original art and a friendly tone (no damage, hunger or thirst). It aims at about 2 hours of play.

More detail lives in two other files:

- `docs/cloud/progression-design.md` has every item's cost, unlock, stack and durability, the target timeline, and how the design compares to Raft.
- `docs/cloud/progression-sim.md` has the 2-hour economy simulation: method, before/after timings and caveats.

## What was built

All of the logic is in new files under `dist/`. Existing files only get small hooks, each marked `// [progression-hook]`.

| File | What it does |
|---|---|
| `dist/items.js` | The item catalogue, as pure data plus helpers. It has 34 items. Each one has `id`, `name`, `category`, `stack`, `icon`, `tool`/`durability` (in uses), `placeable`, `recipe` (`cost`, `count`, and `station`, `time`, `fuel` for station recipes), `unlock` (`start` / `discover` / `research` / `station`) and `tip`. Helpers: `infoTable`, `recipeTable`, `migrateSnapshot` + `LEGACY_ALIASES`, `rollBarrel(rand, luck)` (with bad-luck protection), `repairCost`, `wearPerUse`, `toolRole`, `PLACEABLE_IDS`, `BLOCK_RADII`, `FUEL_VALUE`, `PROGRESSION_PLAN`. |
| `dist/progression.js` | `Progression`, which tracks what the player has discovered, researched, learned and placed. `isUnlocked`, `whyLocked` and `nextGoals` read from it. `research()` never uses up the item. Also atomic `canCraft`/`craft`. |
| `dist/smelter.js` | `StationModel`, the cooking model shared by the smelter and the grill. It holds input, fuel units and output stacks. Fuel burns steadily over each item's cook time. Running out of fuel pauses cooking without losing progress, and a full output slot also pauses it. A long `dt` is processed exactly. |
| `dist/smelter-ui.js` | The station panel: input, fuel and output slots, a flame, fuel and progress bars, and friendly hints. |
| `dist/smelter-model.js` | Original low-poly 3D models for the clay smelter (with a glowing mouth and ingot tray), the research table and the grill. |
| `dist/item-tooltips.js` | Tooltips when you hover or focus a bag slot, hotbar slot, recipe row or station chip. They show name, category, stack or durability in uses, tip, cost (have/need), station and time, and the lock reason. They render above modal dialogs. |
| `dist/item-icons.js` | 24 new inline SVG icons drawn in the existing icon style. |
| `dist/progression-hooks.js` | The single integration point, `attachProgression(ctx)`. It covers: one Progression per player, "New recipe!" toasts, the research dialog, a station per placed smelter or grill, saving to `littleRaft.progression.v1`, `prog:*` actions (host-authoritative, also used by the guest), the binoculars HUD, barrel luck, hot-reload handover, and `raftDebug.progression`. |

### Progression in brief

1. **Start.** You have the hook, rope, hammer, bench, palm planter and floors.
2. **Discover.** Scrap unlocks the nail. Holding nails unlocks the collection net and the research table. Holding a fish unlocks the grill.
3. **Research.** Researching clay and stone unlocks the smelter. The grill fires clay into bricks.
4. **Smelter.** Placing it gives metal and copper ingots and glass.
5. **Mid-game.** Research the metal ingot for bolts and hinges, then the metal hook (150 uses, works as a hook) and binoculars (a HUD line points to the nearest barrel).

New raw materials (sand, clay, stone, copper ore, metal ore, seaweed) come from barrels. Their odds are guaranteed to turn up within a few barrels, so there are no long droughts.

**Durability and repair.** The Bag still stores durability as 0..100. `items.js` gives uses per tool: hook 50, metal hook 150, hammer 120, fishing rod 40. Wear per use is 100/uses. Pressing **R** repairs with the per-tool `repairCost`. Raft has no repair; we keep it because it is friendlier.

## Hooks in existing files

| File | Hook |
|---|---|
| `dist/inventory-state.js` | Imports from `items.js`. `TOOL_KINDS` gets `TOOL_IDS` added. `...infoTable()` is merged into `ITEM_INFO` and `...recipeTable()` into `RECIPES`. |
| `dist/survival-ui.js` | `Object.assign(CUSTOM, ITEM_ICONS)`. `createSurvivalUI` takes an optional `recipeGate`, which hides locked recipes except the next goals; those are greyed out with a "Locked: …" reason and the `sv-locked` class. |
| `dist/game.js` (~25 one-line hooks) | Imports. `DECOR_TYPES` and `BLOCK_RADIUS` extended. `snapBag` runs `migrateSnapshot` first. `toolRole` for the hook checks (so the metal hook works). Station models via `prog.modelFor`. Per-tool wear, repair cost and the worn-hook notice. `prog.apply` in `applyAction`. `rollBarrel(Math.random, prog?.barrelLuck)`. `prog.interact` before opening the inventory. `prog.tick(dt)` in `frame()`. `attachProgression(...)`, `installUI()` and `dispose()`. `raftDebug.progression`. |
| `package.json` | `npm test` runs all four test files. |

`grep -n "progression-hook" dist/*.js` lists all of them.

## Migration

Every existing kind keeps its id. `wood` now displays as "Plank" and `net` as "Collection Net". `migrateSnapshot` handles old or messy bag snapshots. It maps aliases (e.g. `plank` to `wood`, `rod` to `fishingrod`), splits oversized stacks, clamps durability, drops unknown kinds and fixes `selected`. It never throws (fuzzed 2000×).

An old save without a progression key keeps every recipe it could craft before; they are marked as learned. The net now costs 2 nails as well.

## Tests

`npm test` passes 71/71.

| File | Covers |
|---|---|
| `tests/progression.test.mjs` | Catalogue integrity and reachability, migration (including the fuzz), the full unlock chain with the real catalogue, barrel bounds and luck, station exploit cases, old-save legacy recipes, hot-reload handover. |
| `tests/progression-core.test.mjs` | Unlock rules, `whyLocked`, `nextGoals`, snapshot junk, atomic craft and station gating. |
| `tests/smelter.test.mjs` | Cooking timing, fuel starvation, large `dt`, a blocked output slot, the grill, snapshots. |
| `tests/survival.test.mjs` | Existing tests, unchanged and passing. |

`node tools/sim-progression.mjs --runs 200` runs the scripted 2-hour economy using the real modules. Median minutes at skill 1:

| Milestone | Before tuning | After tuning |
|---|---|---|
| Research table | 17 | 17 |
| Nets | 26 | 26 |
| Smelter | 47 | 66 |
| Metal hook | 60 | 74 |
| Binoculars | 75 (23% of runs never get them) | 81 (3.5% never get them) |

## Screenshots

These are in `docs/cloud/shots/progression/`. Re-create them with `python3 tools/shoot-progression.py`, which needs python Playwright and a Chromium.

| Shot | Shows |
|---|---|
| `01-start-inventory.png` | Starting recipes, with locked next goals greyed out |
| `02-tooltip-slot.png`, `03-tooltip-locked-recipe.png` | Tooltips |
| `04-research-table.png` | Research dialog |
| `05-raft-stations.png` | Smelter, research table and grill on the raft |
| `06-smelter-cooking.png`, `07-smelter-done.png` | Station panel |
| `08-midgame-inventory.png` | Mid-game bag |
| `09-binoculars-hud.png` | Binoculars HUD |
| `10-mobile-inventory.png` | Inventory at 390 px wide |
| `icon-sheet.png`, `model-*.png` | Art sheets |

## Known limits and handoffs

- **The bag fills up around minutes 75–95.** Once it is full, barrel income stalls, so the binoculars land at about 81 minutes instead of the planned 110. Fixing this needs storage crates, a burn/discard action or friendlier nets. That belongs to the inventory/building lanes, not to item numbers.
- **No islands yet.** The axe and shovel are left out because they need the islands lane. Spear and purifier are left out too (they map to combat and thirst). The grill and cooked fish are kept as a cosy "snack".
- **Binoculars have no first-person model or zoom yet.** That belongs to `hands.js` (hands lane).
- **The inventory's hotbar row is clipped at 390 px.** That is a layout issue in `survival-ui.js`, outside this lane.
- **Multiplayer.** A guest's progression is stored in the host's save. The guest's station and research views lag behind by one sync (~0.3 s).
- `tests/legacy_hook.mjs` already fails 2/4 on `main` and is not part of `npm test`.
