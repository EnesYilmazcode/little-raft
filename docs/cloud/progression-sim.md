# Little Raft progression sim results

Tool: `tools/sim-progression.mjs` (node, no dependencies, seeded PRNG). Run it with
`node tools/sim-progression.mjs --runs 200` (`--seed`, `--skill`, `--dist DIR`, `--strict`, `--max-tiles`, `--json`).

## Method

- The sim imports the real `dist/items.js` (`rollBarrel`, recipes, `wearPerUse`, `repairCost`, `FUEL_VALUE`), `dist/progression.js` (`Progression`, `craft`), `dist/smelter.js` (`StationModel`) and `dist/inventory-state.js` (`Bag`, 28 slots).
- It parses `SPAWN_TABLE`, `LOOT`, `FLOOR_COST`, `CHARGE_MS`, the item count (30), drift (0.22 m/s), the net radius and clock (4 m, 0.8 s) from `dist/game.js`. It parses the speeds, reel speed, catch radius and max catch from `dist/hook-physics.js`.
- World: 30 items spawn and drift exactly as `makeItem`/`updateItems` do. They respawn past the raft or when they touch a tile. Nets on the front row auto-collect as at game.js ~L835: atomic, and never when the item does not fit.
- Player, skill 1:
  - Each cycle the player hooks the nearest item it would keep. It skips debris it already holds 40+ of, and items that do not fit.
  - Cycle time is 1 s aim + charge + ballistic flight + reel (d/8 m/s) + 7 s human overhead. Hit chance falls with distance. The reel line sweeps up extra items (1 m radius, at most 8).
  - Calibrated to 4.7 hooked items/min over the first 30 min, which matches the design's 4-5.
- Goals are taken in `PROGRESSION_PLAN` order: rope, hammer, 3 floors, bench, palm, nail, rod, sail, table, grill, grilled fish, 2 nets, brick, smelter, ingot, bolt, hinge, metal hook, glass, copper, binoculars, then lantern, crate and nets 3-4.
  - Earlier goals reserve the materials they need. Later goals are crafted ahead when they are ready (`--strict` turns this look-ahead off).
- Research happens as soon as a needed kind is held. The grill and smelter run through `StationModel`, with leaf or seaweed fuel first and spare planks after.
- Tools wear by `wearPerUse` and are repaired at 20 % (hook) or 5 % (hammer, rod) by `repairCost`.
- Surplus planks and plastic become floor tiles, up to the 400-tile game cap. Spare leaves become rope (up to 12) and spare scrap becomes nails (up to 12).
- Barrels use `rollBarrel()`, not game.js's fixed `LOOT.barrel`.
- "Dry spell" = at least 5 min in which every open goal waits only on raw income. "Stall" = the head goal has been blocked on one single material for at least 5 min.

## Results (200 seeds, skill 1, median min [p10-p90], runs that missed it within 120 min)

| Milestone | Plan | Current `dist/items.js` | Proposed |
|---|---|---|---|
| Research table | 30 | 17.4 | 17.3 |
| Nets | 40 | 26.4 | 26.6 |
| First brick | 50 | 21.7 | 21.7 |
| Smelter placed | 75 | 47.1 [33-66], 2 missed | **68.3** [52-86], 0 missed |
| First metal ingot | 80 | 48.0 | 69 |
| Metal hook | 92 | 60.3 [42-never], 23 missed | **81.0** [66-104], 7 missed |
| Glass + copper | 105 | 56.3 | 75.7 |
| Binoculars | 115 | 74.7 [52-never], 46 missed | **103.5** [79-never], 44 missed |
| Barrels opened at smelter / hook / binoculars | | 25 / 34 / 44 | 44 / 55 / 74 |
| Bag full (min of 120), median (p90) | | 29.6 (49.2) | 0 (0) |
| Bag first full at minute, median | | 84.7 | never |
| Longest dry spell per run, median (p90) | | 14.9 (56.5) | 20.9 (39.1) |

Income: barrels average 0.5/min early and about 0.7-0.8/min once the raft is large and the player is skipping surplus debris. That is above the 0.35-0.4 the design notes assume, and it is why the current numbers run about 40 % fast.

## Verdict on current numbers

The ~2 h loop does not land.

- The smelter comes at about 47 min, the metal hook at about 60 and the binoculars at about 75.
- From about minute 65-85 the bag fills up (28 slots of 20-stacks), mostly with planks, leaves and scrap. After that, hooks and nets cannot open barrels, so in a quarter to a half of runs the late game stalls completely.
- The early game (rope to nets) runs about 1.6x faster than the plan. That is driven by leaves and rope, not planks; raising plank costs moved it by less than 1 min.

## Proposed `dist/items.js` changes (verified, variant C)

1. `const STACK = 20;` -> `const STACK = 40;`
2. smelter `recipe: hand({ wood: 6, brick: 6, stone: 4, nail: 6 })` -> `brick: 8, stone: 6`
3. metalhook `hand({ metalingot: 2, bolt: 2, rope: 2, wood: 2 })` -> `metalingot: 6`
4. binoculars `hand({ glass: 2, copperingot: 1, hinge: 1, bolt: 1 })` -> `hinge: 2, bolt: 7`
5. `BARREL_LOOT` treasure `metalore` `weight: 13` -> `weight: 20`
6. `BARREL_LOOT` treasure filler `scrap` `weight: 13` -> `weight: 30`

Points 5-6 make the treasure pool total 124. Each barrel now gives clay .23, stone .16, metal ore .16, sand .10, seaweed .06 (x1.5) and copper ore .05. The docs table and the comment on `BARREL_LOOT` need updating to match.

Alternatives tried:

| Variant | Smelter | Metal hook | Binoculars | Notes |
|---|---|---|---|---|
| A: metalhook 6, binoculars bolt 5, metal ore weight 16 | 66 | 88 | 113, 78/200 missed | longest dry spell median 28 min |
| B: metalhook 4, binoculars bolt 4, metal ore weight 13 | 64 | 83 | 99, 50 missed | |
| D: metalhook 7, binoculars hinge 4 / bolt 7, metal ore weight 20 | | 87 | median never | |

C has the best balance of median timings, tail and dry spells.

## Sensitivity and caveats

- **Skill matters a lot.** With the proposed numbers, skill 0.7 gives smelter 77, metal hook 98 and binoculars after 120 min in 51 % of runs. Skill 1.3 gives 60 / 71 / 93.
- **Player who stops building floors (`--max-tiles 49`).** Nets keep pouring planks and plastic into the bag. It is full from about minute 56 (current) or 67 (proposed), and most runs never reach the metal hook. No `items.js` number fixes this.
  - Recommended follow-up for the engine lane: nets should only collect what tops up an existing stack (or only barrels), or the player needs a discard/burn action, or crates need storage.
- **The tail comes from one treasure pick per barrel.** Metal ore is the single post-smelter gate, so dry spells of about 20 min remain in the median run.
  - Number changes cannot fix both the medians and the tail.
  - A structural fix would be bad-luck protection in `rollBarrel`, for example a weighted shuffle-bag carried in a small state object the caller passes in.
- **Early milestones stay about 40 % ahead of the plan.** The sim player is greedy and knows the UI. Consider moving the early `PROGRESSION_PLAN` minutes earlier (table about 20, nets about 30) rather than slowing them down.
- **Head-goal stalls:**
  - Leaf stalls on the fishing rod (8 rope = 16 leaves) and on nets are frequent but short, because other goals keep progressing.
  - Clay and stone stalls before the smelter are expected collecting time; bricks and decor fill that window.
- **Bag shim.** The shipped `Bag` only knows the 15 legacy kinds and rejects clay, nail, brick and the rest. The sim loads the same Bag source with `ITEM_INFO = infoTable()` and `TOOL_KINDS = TOOL_IDS` from `items.js`. The integration has to do the same.
- **Not modelled:** game.js does not yet apply hammer or rod wear; the sim does, and assumes a tool at 0 % cannot be used. The metal hook is assumed to throw like the hook. Station walking and UI time is a flat 2-3 s per action. Binocular barrel-spotting is not modelled.
