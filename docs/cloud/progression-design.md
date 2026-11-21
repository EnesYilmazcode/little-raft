# Little Raft progression design

The source of truth is `dist/items.js` (`ITEMS`, `BARREL_LOOT`, `PROGRESSION_PLAN`). This page explains the numbers.
The aim is Raft's *hook -> craft -> unlock -> build* loop over about 2 hours, with no damage, hunger or thirst.

## Income model (from `dist/game.js`)

- There are always 30 floating items, drifting at 0.22 m/s, so about 3 minutes per lane pass.
  `SPAWN_TABLE` is 3 wood : 3 plastic : 3 leaf : 1 scrap : 1 barrel.
- An attentive player hooks about 4-5 items a minute. With collection nets (auto-collect within 4 m, from about minute 27) that is about 0.5 barrels a minute (the simulator's measurement, see `progression-sim.md`).
- The new raw materials (sand, clay, stone, copper ore, metal ore, seaweed) come **only from barrels**.
  There are no islands yet: axe and shovel belong to the islands lane.
- Barrel = 3 picks from the **basic** pool + 1 pick from the **treasure** pool (each treasure pick is exactly 1 item, so variance stays low).
- **Bad-luck protection** (`BARREL_PITY`): `rollBarrel(rand, luck)` takes an optional caller-owned `{misses: {kind: n}}`. Each barrel counts, per mid-game kind, how many barrels in a row did not give it. When a count reaches its limit, the treasure pick is forced to that kind (the most overdue kind first, so two overdue kinds can take a barrel or two longer). `progression-hooks.js` owns one luck object per world, saves it with the progression save and exposes it as `barrelLuck`; game.js calls `rollBarrel(Math.random, prog?.barrelLuck)`. With `luck = null` the roll is the plain weighted pick.

| Kind | Pity limit (barrels without it) | Longest gap seen (200k barrels) |
|---|---|---|
| clay | 4 | 5 |
| stone | 5 | 7 |
| metal ore | 5 | 7 |
| sand | 8 | 10 |
| copper ore | 12 | 15 |

| Pool | Kind | Qty | Weight | Plain mean per barrel | With luck |
|---|---|---|---|---|---|
| basic | wood | 2-3 | 30 | 2.5 | 2.5 |
| basic | leaf | 1-3 | 22 | 1.5 | 1.5 |
| basic | plastic | 1-2 | 22 | 1.1 | 1.1 |
| basic | scrap | 1-2 | 16 | 0.8 | 0.8 |
| treasure | clay | 1 | 18 | 0.19 | 0.24 |
| treasure | stone | 1 | 12 | 0.13 | 0.19 |
| treasure | metal ore | 1 | 10 | 0.10 | 0.18 |
| treasure | sand | 1 | 12 | 0.13 | 0.14 |
| treasure | seaweed | 1-2 | 8 | 0.13 | 0.05 |
| treasure | copper ore | 1 | 6 | 0.06 | 0.09 |
| treasure | scrap (filler) | 1 | 30 | 0.31 | 0.14 |

The weights are deliberately low and the pity limits tight: the limits set the pace, so every world gets close to the same schedule. Without the luck state the mid game is much slower (see below), so the luck object must always be passed in game.

Monte Carlo (4000 runs) of barrels opened before the materials are in hand:

| Milestone | Material need | With luck p10 / median / p90 | Plain (`luck = null`) |
|---|---|---|---|
| Smelter | 10 clay + 7 stone | 37 / 42 / 47 | 46 / 63 / 89 |
| Metal hook | + 7 metal ore (6 ingots + 1 for bolts) | 39 / 43 / 47 | 58 / 77 / 108 |
| Binoculars | 9 metal ore, 2 sand, 1 copper | 45 / 49 / 55 | 64 / 88 / 123 |

At about 0.5-0.6 barrels a minute that puts the smelter at about 66 min and the metal hook at about 74 min (simulator medians at skill 1).

## Items

Stack is 20 unless noted. *Disc* = unlocks once the player has ever held all the listed items. *Res* = research each listed item at the Research Table; the item is **not** consumed. *Station X* = unlocks when X is placed.

### Materials and food (gathered)

| id | Name | Source | Stack | Use |
|---|---|---|---|---|
| wood | Plank | debris, barrels | 20 | everything; fuel 1 |
| leaf | Palm Leaf | debris, barrels | 20 | rope; fuel 0.5 |
| plastic | Plastic | debris, barrels | 20 | hook, floor |
| scrap | Scrap | debris, barrels | 20 | nails, lantern, repairs |
| sand | Sand | barrel | 20 | glass |
| clay | Clay | barrel | 20 | brick |
| stone | Stone | barrel | 20 | smelter |
| metalore | Metal Ore | barrel | 20 | metal ingot |
| copperore | Copper Ore | barrel | 20 | copper ingot |
| seaweed | Seaweed | barrel | 20 | fuel 0.5 |
| fish | Fish | fishing rod | 20 | grill |

### Hand crafts

| id | Cost | Out | Unlock | Notes |
|---|---|---|---|---|
| rope | 2 leaf | 1 | start | |
| nail | 2 scrap | 3 | disc scrap | **new** |
| bolt | 1 metal ingot, 1 scrap | 2 | res metalingot | **new** |
| hinge | 1 metal ingot, 2 nail | 2 | res metalingot, nail | **new** |
| hook | 1 wood, 2 plastic | 1 | start | tool |
| hammer | 4 wood, 2 rope | 1 | start | tool |
| fishingrod | 6 wood, 8 rope | 1 | disc rope | tool |
| metalhook | **6** metal ingot, 2 bolt, 2 rope, 2 wood | 1 | res metalingot, bolt | tool, acts as hook (was 2 ingots) |
| binoculars | 2 glass, 1 copper ingot, **2** hinge, 1 bolt | 1 | res glass, copperingot | stack 1, never wears (was 1 hinge) |
| bench | 3 wood | 1 | start | decor |
| palm | 2 wood, 3 leaf | 1 | start | decor |
| sail | 4 wood, 3 rope, 3 leaf | 1 | disc rope, plastic | build |
| lantern | 2 wood, 2 scrap | 1 | disc scrap | decor |
| crate | 4 wood, 1 scrap | 1 | disc scrap | build |
| net | 3 wood, 3 rope, **2 nail** | 1 | disc nail | **retuned: +2 nail** |
| researchtable | 10 wood, 4 nail, 2 rope | 1 | disc nail | station, stack 5 |
| grill | 6 wood, 1 scrap, 3 rope | 1 | disc fish | station, stack 5 |
| smelter | 6 wood, **10** brick, **7** stone, 6 nail | 1 | res clay, stone | station, stack 5 (was 6 brick, 4 stone) |

Floor tiles stay in the engine: 2 wood + 2 plastic with the hammer.

### Station recipes (one input -> one output, one at a time)

| id | Station | Input | Time | Fuel/item | Unlock |
|---|---|---|---|---|---|
| cookedfish | grill | 1 fish | 15 s | 0.5 | station grill |
| brick | grill | 1 clay | 20 s | 0.5 | station grill |
| metalingot | smelter | 1 metal ore | 30 s | 1 | station smelter |
| copperingot | smelter | 1 copper ore | 30 s | 1 | station smelter |
| glass | smelter | 1 sand | 25 s | 1 | station smelter |

Fuel (`FUEL_VALUE`): plank 1, leaf 0.5, seaweed 0.5. Plastic is never burned. Grilled fish stacks to 10 and is a snack, a treat for the seagull. There is no hunger.

### Tools (Bag durability stays 0..100 %; wear per use = 100 / uses)

| id | Uses | Wear/use | Repair (to 100 %) | Role |
|---|---|---|---|---|
| hook | 50 | 2 (same as `WEAR_PER_CATCH`) | 2 wood, 1 scrap (unchanged) | hook |
| metalhook | 150 | 0.67 | 2 scrap, 2 nail | hook (`toolRole`) |
| hammer | 120 | 0.83 | 2 wood, 1 rope | hammer |
| fishingrod | 40 | 2.5 | 1 wood, 2 rope | fishingrod |

Placeables (`PLACEABLE_IDS`) with block radius: palm .42, crate .55, bench .45, sail .14, lantern .12, net 0, smelter .5, researchtable .55, grill .45.

## Unlock graph

```
start: rope hook hammer bench palm (+ all raw materials, fish)
  hold scrap  -> nail, lantern, crate
  hold rope   -> fishingrod         hold rope+plastic -> sail
  hold nail   -> net, researchtable
  hold fish   -> grill --placed--> cookedfish, brick
  research clay+stone (table) -> smelter --placed--> metalingot, copperingot, glass
  research metalingot         -> bolt;  + nail -> hinge
  research metalingot+bolt    -> metalhook
  research glass+copperingot  -> binoculars
```

The check script verified every cost, unlock and repair key, that there are no dependency cycles, and that every item is reachable from the start items plus debris and barrel loot.

## Target 2-hour timeline (`PROGRESSION_PLAN`)

| Min | Goal |
|---|---|
The early minutes were moved earlier to match what the simulator measures (they used to be about 40 % behind it). The late targets are the design aim; the simulator currently lands the binoculars earlier, see "Known limit" below.

| Min | Goal | Sim median, skill 1 |
|---|---|---|
| 0 | Hook the first planks, leaves and plastic | 0 |
| 2 (was 3) | Rope | 0.9 |
| 4 (was 6) | Hammer, first floor tiles | 3.8 |
| 6 (was 10) | Bench + palm planter | 4.7 |
| 8 (was 15) | Nails (lantern, crate unlock) | 1.6 |
| 12 (was 20) | Fishing rod, first fish | 11.1 |
| 16 (was 25) | Sail | 15.8 |
| 20 (was 30) | Research Table | 17.4 |
| 24 (was 35) | Grill, grilled fish for the seagull | 21.3 |
| 27 (was 40) | Collection nets (barrel income goes up) | 26.3 |
| 30 (was 50) | Clay/stone from barrels, first bricks | 22.1 |
| 35 (was 65) | Research clay + stone, learn the smelter | 17.8 |
| 70 (was 75) | Smelter built and fuelled | 66.0 |
| 72 (was 80) | First metal ingot | 66.7 |
| 75 (was 85) | Bolts, hinges | 67.3 |
| 85 (was 92) | Metal hook | 74.1 |
| 100 (was 105) | Glass, copper ingot | 72.8 |
| 110 (was 115) | Binoculars, barrel spotting | 81.1 (7/200 runs miss it) |
| 120 | Cosy, well-equipped raft | |

## Known limit: the bag fills up

The bag is 28 slots of 20-stacks (`STACK` stays 20: other fleets and the survival tests depend on it). From about minute 75-95 it is full in most simulated runs, mostly with planks, scrap, leaves and rope that nets keep pouring in. A full bag cannot take a barrel (loot is added atomically), so barrel income nearly stops.

- That is a cliff for the late game: any tuning that puts the binoculars' median past about 85 min makes 15-35 % of runs miss them within 2 hours. That is why the shipped numbers land the binoculars at about 81 min, not 105-120.
- With `STACK = 40` the same tuning reaches the binoculars in about 97 % of runs even at an 88 min median.
- A friendlier net, a discard/burn action or crate storage would move the cliff. That is out of scope for this lane and is left for the engine lane.

## Rationale vs Raft

- **Same spine, gentler gates.** Raft's chain is research table -> bricks -> smelter -> ingots -> bolts/hinges -> better hook. We keep it, but the materials come from barrels instead of island diving. Treasure picks are always 1 item and the per-world luck state caps every dry run, so a run never stalls badly (p90 smelter is 47 barrels).
- **Bricks are fired on the grill (20 s)** instead of Raft's 5-minute drying on the raft. This makes the grill a useful mid-game station rather than a hunger fix, and avoids a smelter-needs-bricks loop.
- **Smelt times are 15-30 s instead of about 80 s.** Fuel is 1 plank per ingot, as in Raft. Leaves and seaweed give half a unit, so early leaf surplus has a use.
- **Researching never consumes items.** Raft's community disagrees on whether it does; friendly is the clear choice here.
- **Durability is forgiving and repairable.** Raft has no repair. We keep the existing hook repair (2 wood, 1 scrap). Upgrades mean more uses (50 -> 150, like Raft's plastic -> scrap hook) rather than raw power.
- **No survival meters.** The purifier is left out (the station id `purifier` is reserved). Grilled fish is a cosy treat.
- **Discover unlocks for the basics** (holding scrap teaches nails), research for the mid tier, and station placement for station outputs. The 25-65 min window is mostly about collecting: nets, the grill and bricks keep it busy.

## Changes to existing items (saves keep every id)

- `wood` is displayed as **Plank**. `net` is displayed as **Collection Net**, and its recipe gains 2 nails, so nets arrive about minute 27.
- fishingrod, sail, lantern, crate and net are now unlock-gated (discover). They were always available before. `progression-hooks` should grandfather by noting the current bag on load. Every gate is something a player with an old save already holds.
- Everything else keeps its old cost.
- The barrel loot table replaces `LOOT.barrel` via `rollBarrel(Math.random, prog?.barrelLuck)`: about 5.3 basic items plus 1 treasure item, against the old 7 fixed.
