# Little Raft progression sim results

Tool: `tools/sim-progression.mjs` (node, no dependencies, seeded PRNG). Run it with
`node tools/sim-progression.mjs --runs 200` (`--seed`, `--skill`, `--dist DIR`, `--no-luck`, `--strict`, `--max-tiles`, `--json`).

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
- Barrels use `rollBarrel(rand, luck)` with one luck object per run (the per-world state `progression-hooks.js` keeps), not game.js's fixed `LOOT.barrel`. `--no-luck` passes null.
- "Dry spell" = at least 5 min in which every open goal waits only on raw income. "Stall" = the head goal has been blocked on one single material for at least 5 min.

## Results (200 seeds, skill 1, median min [p10-p90], runs that missed it within 120 min)

"Before" is `dist/items.js` at a96ba07 with the old plan minutes. "After" is the shipped tuning (below) with the per-world luck object passed to `rollBarrel`.

| Milestone | Plan before -> after | Before | After |
|---|---|---|---|
| Research table | 30 -> 20 | 17.4 | 17.4 [13.9-20.4] |
| Nets | 40 -> 27 | 26.4 | 26.3 [22.8-31.0] |
| First brick | 50 -> 30 | 21.7 | 22.1 |
| Smelter placed | 75 -> 70 | 47.1 [33-66], 2 missed | **66.0** [55.6-79.3], 0 missed |
| First metal ingot | 80 -> 72 | 48.0 | 66.7 |
| Metal hook | 92 -> 85 | 60.3 [42-never], 23 missed | **74.1** [62.5-88.3], 5 missed |
| Glass + copper | 105 -> 100 | 56.3 | 72.8 |
| Binoculars | 115 -> 110 | 74.7 [52-never], 46 missed | **81.1** [67.9-98.3], 7 missed (3.5 %) |
| Barrels opened at smelter / hook / binoculars | | 25 / 34 / 44 | 42 / 46 / 50 |
| Bag full (min of 120), median (p90) | | 29.6 (49.2) | 20.5 (39.0) |
| Bag first full at minute, median | | 84.7 | 93.0 |
| Longest dry spell per run, median (p90) | | 14.9 (56.5) | 6.5 (16.4) |

Income: barrels average about 0.5/min (0.5 in the first 30 min). That is above the 0.35-0.4 the old design notes assumed, and it is why the old numbers ran about 40 % fast.

## Shipped `dist/items.js` changes

1. `STACK` stays 20 (lead decision).
2. smelter `hand({ wood: 6, brick: 6, stone: 4, nail: 6 })` -> `brick: 10, stone: 7`.
3. metalhook `metalingot: 2` -> `metalingot: 6`.
4. binoculars `hinge: 1` -> `hinge: 2` (bolt stays 1, see below).
5. `BARREL_LOOT` treasure weights: clay 28 -> 18, stone 20 -> 12, metal ore 13 -> 10, scrap filler 13 -> 30. Sand 12, seaweed 8 and copper ore 6 are unchanged (total 96).
6. New `BARREL_PITY` = clay 4, stone 5, metal ore 5, sand 8, copper ore 12, used by `rollBarrel(rand, luck)`.
7. `PROGRESSION_PLAN` early minutes moved earlier (table 20, nets 27), late minutes smelter 70, ingot 72, bolts 75, metal hook 85, glass 100, binoculars 110.

## How the numbers were chosen

The brief was variant C without the stack change (smelter 8 brick / 6 stone, metal hook 6 ingots, binoculars 2 hinges / 7 bolts, metal ore 20, scrap filler 30), then iterate.

| Variant (all with luck unless noted) | Smelter | Metal hook | Binoculars, missed of 200 |
|---|---|---|---|
| C at STACK 20, luck limits clay 5 / stone 6 / ore 6 | 57.8 | 70.8 | never (median), 119 |
| C at STACK 20, `--no-luck` | 68.8 | 89.3 | never, 145 |
| C, binoculars 3 bolts (10 ore in all), limits clay 8 / stone 9 | 66.4 | 73.3 | 84.2, 35 |
| same, binoculars 1 bolt (9 ore in all) | 66.7 | 75.0 | 79.9, 12 |
| 1 bolt, tight limits (4/5/5/8/12), low weights clay 12 / stone 8 / ore 8, brick 10 | 67.0 | 74.3 | 81.5, 10 |
| same, metal hook 7 ingots | 67.0 | 80.8 | 90.5, 26 |
| same, metal hook 8 ingots | 67.0 | 91.8 | 101.8, 66 |
| tight-limits row with seaweed instead of scrap as the filler | 68.7 | 76.1 | 82.0, 17 |
| **shipped**: tight limits, weights clay 18 / stone 12 / ore 10, brick 10, stone 7 | **66.0** | **74.1** | **81.1, 7** |
| shipped, `--no-luck` | 95.5, 75 missed | never | never, 172 |

- 7 binocular bolts means 4 more ingots after the metal hook, and the bag-full cliff (below) arrives before those ore barrels do. One bolt keeps the binoculars 2 ore after the hook.
- Low weights with tight pity limits give the lowest spread: the limits, not the dice, set the pace.

## The binoculars cannot land at 105-120 with STACK 20

The bag fills from about minute 75-95 (p10 75, median 93). After that, barrel income nearly stops, because loot is added atomically and a full bag rejects it. Every variant whose binoculars median passed about 85 min missed them in 13-58 % of runs.

As a check, the "metal hook 7 ingots, binoculars 3 bolts" tuning with `STACK = 40` gives smelter 58, metal hook 76, binoculars 88 with 3/200 missed. At `STACK = 20` the same tuning misses the metal hook in 35 runs and the binoculars in 115.

So the shipped numbers keep the miss rate under 10 % and accept binoculars at about 81 min. Moving them to 105-120 needs a bag-pressure fix: a friendlier net (only top up existing stacks), a discard/burn action, crate storage, or a bigger stack. That is out of scope for this lane.

## Sensitivity and caveats

- **Skill matters.** With the shipped numbers:

  | Skill | Smelter | Metal hook | Binoculars | Binoculars missed |
  |---|---|---|---|---|
  | 0.7 | 78.5 [66-97], 3 missed | 87.8, 14 missed | 96.8 | 31/200 (16 %) |
  | 1 | 66.0 | 74.1 | 81.1 | 7/200 |
  | 1.3 | 58.5 | 66.2 | 71.3 | 6/200 |

  A slow player gets the paced 2-hour loop, but about one in six misses the binoculars within 2 hours. A fast player finishes the chain at about 70 min.
- **The luck state is load-bearing.** With `--no-luck` (`rollBarrel(rand, null)`) the smelter median is 95 min and 172/200 runs miss the binoculars. Without the progression hooks, game.js passes `undefined`, which is the same as null, so barrels fall back to the plain odds.
- **Player who stops building floors (`--max-tiles 49`).** Nets keep pouring planks and plastic into the bag. With the shipped numbers it is full from about minute 55, 162/200 runs never place the smelter and none reach the binoculars (before: full from about minute 56, most runs never reached the metal hook). No `items.js` number fixes this.
  - Recommended follow-up for the engine lane: nets should only collect what tops up an existing stack (or only barrels), or the player needs a discard/burn action, or crates need storage.
- **The tail from one treasure pick per barrel is handled by the luck state.** The longest dry spell per run is now 6.5 min median (16.4 p90), down from 14.9 (56.5). The remaining tail is bag-full time, not dice.
- **Early milestones.** The sim player is greedy and knows the UI. The early `PROGRESSION_PLAN` minutes were moved earlier (table 20, nets 27) rather than slowing the early game down.
- **Head-goal stalls:**
  - Leaf stalls on the fishing rod (8 rope = 16 leaves) and on nets are frequent but short, because other goals keep progressing.
  - Clay and stone stalls before the smelter are expected collecting time; bricks and decor fill that window.
- **Bag shim.** The shipped `Bag` only knows the 15 legacy kinds and rejects clay, nail, brick and the rest. The sim loads the same Bag source with `ITEM_INFO = infoTable()` and `TOOL_KINDS = TOOL_IDS` from `items.js`. The integration has to do the same.
- **Not modelled:** game.js does not yet apply hammer or rod wear; the sim does, and assumes a tool at 0 % cannot be used. The metal hook is assumed to throw like the hook. Station walking and UI time is a flat 2-3 s per action. Binocular barrel-spotting is not modelled.
