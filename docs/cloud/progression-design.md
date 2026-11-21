# Little Raft progression design

The source of truth is `dist/items.js` (`ITEMS`, `BARREL_LOOT`, `PROGRESSION_PLAN`). This page explains the numbers.
The aim is Raft's *hook -> craft -> unlock -> build* loop over about 2 hours, with no damage, hunger or thirst.

## Income model (from `dist/game.js`)

- There are always 30 floating items, drifting at 0.22 m/s, so about 3 minutes per lane pass.
  `SPAWN_TABLE` is 3 wood : 3 plastic : 3 leaf : 1 scrap : 1 barrel.
- An attentive player hooks about 4-5 items a minute, which is roughly 0.35-0.4 barrels a minute.
  Collection nets (auto-collect within 4 m, from about minute 40) raise that to about 0.5 or more.
- The new raw materials (sand, clay, stone, copper ore, metal ore, seaweed) come **only from barrels**.
  There are no islands yet: axe and shovel belong to the islands lane.
- Barrel = 3 picks from the **basic** pool + 1 pick from the **treasure** pool (each treasure pick is exactly 1 item, so variance stays low).

| Pool | Kind | Qty | Weight | Mean per barrel |
|---|---|---|---|---|
| basic | wood | 2-3 | 30 | 2.5 |
| basic | leaf | 1-3 | 22 | 1.5 |
| basic | plastic | 1-2 | 22 | 1.0 |
| basic | scrap | 1-2 | 16 | 0.7 |
| treasure | clay | 1 | 28 | 0.28 |
| treasure | stone | 1 | 20 | 0.20 |
| treasure | metal ore | 1 | 13 | 0.13 |
| treasure | sand | 1 | 12 | 0.12 |
| treasure | seaweed | 1-2 | 8 | 0.12 |
| treasure | copper ore | 1 | 6 | 0.06 |
| treasure | scrap (filler) | 1 | 13 | 0.13 |

Monte Carlo (4000 runs) of barrels opened before the materials are in hand:

| Milestone | Material need | p10 | median | p90 |
|---|---|---|---|---|
| Smelter | 6 clay + 4 stone | 17 | 23 | 33 |
| Metal hook | + 3 metal ore | 20 | 30 | 42 |
| Binoculars | 5 metal ore, 2 sand, 1 copper | 27 | 38 | 65 |

At about 0.4 barrels a minute, plus nets, that puts the smelter at about 65-80 min and the metal hook at about 80-95 min.

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
| metalhook | 2 metal ingot, 2 bolt, 2 rope, 2 wood | 1 | res metalingot, bolt | tool, acts as hook |
| binoculars | 2 glass, 1 copper ingot, 1 hinge, 1 bolt | 1 | res glass, copperingot | stack 1, never wears |
| bench | 3 wood | 1 | start | decor |
| palm | 2 wood, 3 leaf | 1 | start | decor |
| sail | 4 wood, 3 rope, 3 leaf | 1 | disc rope, plastic | build |
| lantern | 2 wood, 2 scrap | 1 | disc scrap | decor |
| crate | 4 wood, 1 scrap | 1 | disc scrap | build |
| net | 3 wood, 3 rope, **2 nail** | 1 | disc nail | **retuned: +2 nail** |
| researchtable | 10 wood, 4 nail, 2 rope | 1 | disc nail | station, stack 5 |
| grill | 6 wood, 1 scrap, 3 rope | 1 | disc fish | station, stack 5 |
| smelter | 6 wood, 6 brick, 4 stone, 6 nail | 1 | res clay, stone | station, stack 5 |

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
| 0 | Hook the first planks, leaves and plastic |
| 3 | Rope |
| 6 | Hammer, first floor tiles |
| 10 | Bench + palm planter |
| 15 | Nails (lantern, crate unlock) |
| 20 | Fishing rod, first fish |
| 25 | Sail |
| 30 | Research Table |
| 35 | Grill, grilled fish for the seagull |
| 40 | Collection nets (barrel income goes up) |
| 50 | Clay/stone from barrels, first bricks |
| 65 | Research clay + stone, learn the smelter |
| 75 | Smelter built and fuelled |
| 80 | First metal ingot |
| 85 | Bolts, hinges |
| 92 | Metal hook |
| 105 | Glass, copper ingot |
| 115 | Binoculars, barrel spotting |
| 120 | Cosy, well-equipped raft |

## Rationale vs Raft

- **Same spine, gentler gates.** Raft's chain is research table -> bricks -> smelter -> ingots -> bolts/hinges -> better hook. We keep it, but the materials come from barrels instead of island diving. Treasure picks are always 1 item so a run never stalls badly (p90 smelter is 33 barrels).
- **Bricks are fired on the grill (20 s)** instead of Raft's 5-minute drying on the raft. This makes the grill a useful mid-game station rather than a hunger fix, and avoids a smelter-needs-bricks loop.
- **Smelt times are 15-30 s instead of about 80 s.** Fuel is 1 plank per ingot, as in Raft. Leaves and seaweed give half a unit, so early leaf surplus has a use.
- **Researching never consumes items.** Raft's community disagrees on whether it does; friendly is the clear choice here.
- **Durability is forgiving and repairable.** Raft has no repair. We keep the existing hook repair (2 wood, 1 scrap). Upgrades mean more uses (50 -> 150, like Raft's plastic -> scrap hook) rather than raw power.
- **No survival meters.** The purifier is left out (the station id `purifier` is reserved). Grilled fish is a cosy treat.
- **Discover unlocks for the basics** (holding scrap teaches nails), research for the mid tier, and station placement for station outputs. The 30-75 min window is mostly about collecting: nets, the grill and bricks keep it busy.

## Changes to existing items (saves keep every id)

- `wood` is displayed as **Plank**. `net` is displayed as **Collection Net**, and its recipe gains 2 nails, so nets arrive about minute 40.
- fishingrod, sail, lantern, crate and net are now unlock-gated (discover). They were always available before. `progression-hooks` should grandfather by noting the current bag on load. Every gate is something a player with an old save already holds.
- Everything else keeps its old cost.
- The barrel loot table replaces `LOOT.barrel` via `rollBarrel()`: about 5.3 basic items plus 1 treasure item, against the old 7 fixed.
