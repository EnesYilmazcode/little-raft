# Raft (Redbeet Interactive, 1.0): progression reference

Research notes for a team building an original Raft-like game. Facts only. Nothing here is copied art.

## Method and confidence (read first)

- WebFetch could not reach raft.wiki.gg, raft.fandom.com, steamcommunity.com, techraptor.net, ginx.tv or gamerant.com because they are outside this session's allowed network domains. No page could be opened directly.
- All data below comes from **WebSearch result summaries**: snippets of the fandom wiki, craftpedia.info, mejoress.com, segmentnext.com, primagames, gamesfuze, itemlevel, gameranx and similar sites. Many of those guides predate 1.0 (2022), and the numbers sometimes differ between them.
- Confidence tags:
  - **[S]** means at least one search snippet supports it, and nothing contradicted it.
  - **[S?]** means sources conflict, or the only source may be pre-1.0.
  - **[unverified]** means it comes from general knowledge and no source checked here confirms it.
- To confirm everything, allow `raft.wiki.gg` (or `raft.fandom.com`) in the session network settings and re-check the "Research Table" and "Crafting" pages.

## Naming note: "Item Net"

- The game has no 1.0 item called "Item Net". The passive debris catcher is the **Simple Collection Net**. It was called "Collection Net" before Update 12, when the "Simple" prefix was added to make room for the Advanced Collection Net. [S] (raft.fandom.com/wiki/Simple_Collection_Net)
- How it works:
  - It is placed on a foundation edge facing the current.
  - Floating debris that drifts into it (planks, plastic, palm leaves, barrels) is caught and **stored in the net's own inventory**, up to **10 items**. [S]
  - Once the net is full, further debris floats through. [S]
  - The player walks up and presses **E (interact)** to collect the contents into their inventory. [unverified: key binding, standard Raft interaction]
- Recipe: **6 Plank, 8 Rope, 2 Nail** (mejoress, gamersdecide). [S]
- It is unlocked at the Research Table by researching **Plank, Scrap, Nail** [S], so it is not a start recipe. Some beginner guides tell players to build nets "early", but none of them say the nets are available at the start.
- **Advanced Collection Net**:
  - Recipe: 6 Plank, 10 Rope, 4 Titanium Ingot. It holds 15 items. [S]
  - It unlocks when Titanium Ingot is researched (primagames, touchtapplay). [S]

## 1. Stage 0: start-of-game recipes

The player begins on a 2x2 foundation raft holding a **Plastic Hook**, used to throw and pull in debris. Guides consistently describe the starting crafting menu as a "minor selection" that grows through the Research Table. [S]

| Item | Recipe (as reported) | Start? | Function |
|---|---|---|---|
| Plastic Hook | 1 Plank, 2 Plastic [S?, older guide]; other versions list more Rope | Start (also in starting inventory) | Thrown and reeled in to grab floating debris |
| Building Hammer | "4x, 2x" (snippet without material names; likely 4 Plank + 2 Rope) [S?] | Start | Opens the build menu (foundations, floors, walls, stairs) and repairs |
| Rope | 2 Palm Leaf → 1 Rope [S] | Start [unverified but universal] | Basic crafting material |
| Wooden Spear | 8 Plank, 3 Rope [S?] (other guides: 6 Plank, 4 Rope) | Start [S: listed as first craft] | Melee weapon used against the shark and on islands |
| Paddle | 4 Plank, 6 Plastic, 2 Rope [S?] | Start [unverified] | Moves the raft slowly by hand |
| Empty Cup | Plastic (count unverified, ~4) | Start [S: "hammer, spare hook and a cup" listed as first crafts] | Holds water; filling it with seawater makes salt water to purify |
| Simple Purifier | 6 Plank, 6 Palm Leaf, 4 Plastic [S] | Start [S?: guides list it among first crafts] | Turns salt water into fresh water in about 30 s, burning planks as fuel |
| Simple Grill | 6 Plank, 1 Scrap, 3 Rope [S] (one table: 4 Plank, 4 Scrap, 1 Nail) | Start [S?: one guide marks it "Start"; another says it needs research of Plank, Scrap, Rope] | Cooks one food item at a time, burning planks as fuel |
| Research Table | **14 Plank, 2 Scrap** [S, several sources; one says 3 Scrap] | Start [S] | Gate for almost every other recipe (see section 2) |
| Wooden Fishing Rod | 6 Plank, 8 Rope [S] | [unverified: start vs research] | Catches fish; a Metal tier is unlocked by research [S] |
| Small Storage | 8 Plastic, 1 Scrap, 2 Rope? (snippet cut off) [S?] | [unverified] | Small chest |
| Simple Collection Net | 6 Plank, 8 Rope, 2 Nail | **No: Research (Plank, Scrap, Nail)** [S] | See naming note above |
| Simple Bed | **10 Palm Leaf, 6 Plank, 4 Plastic, 3 Nail** [S] | **No: Research** (needs Nail) [S?] | Sleep, skip the night, set spawn, revive teammates. Sleeping heals about 40% health and costs about 20% hunger and thirst [S] |
| Nail | Scrap (yield unverified) | [unverified: likely research of Scrap] | Building and crafting material |
| Shovel | not found | [unverified: research item] | Digs sand, clay and treasure |

Hunger and thirst are the main pressures, so the stage 0 loop is: hook debris, purify water, cook fish or potatoes, build a Research Table.

## 2. Research Table

How it works [S] (fandom wiki snippet, gamerempire, primagames, ginx):

1. Place one material in the table's slot and press **Research**. The item is consumed. Each material can only be researched once.
2. The table lists blueprints. Each blueprint needs a **set** of researched materials. When every material in a blueprint's set has been researched, press **Learn** and the recipe is added to the crafting menu for good.
3. New materials, such as ingots, glass and vine goo, have to be researched after they are first obtained before recipes that use them appear. [S?]
4. Example from an old revision: Metal Spear needs Plank, Rope, Metal Ingot and Bolt researched. [S]

Unlockables. "Research set" means the materials that must be researched.

| Item | Research set | Recipe | Function |
|---|---|---|---|
| Simple Collection Net | Plank, Scrap, Nail [S] | 6 Plank, 8 Rope, 2 Nail [S] | Passive debris catch, 10 slots |
| Simple Grill (if not start) | Plank, Scrap, Rope [S?] | 6 Plank, 1 Scrap, 3 Rope | Cooks 1 item |
| Simple Bed | (Plank, Palm Leaf, Plastic, Nail) [unverified] | 10 Palm Leaf, 6 Plank, 4 Plastic, 3 Nail [S] | Sleep and respawn |
| Smelter | Plank, **Dry Brick**, Scrap, Nail [S] | 4 Plank, 6 Dry Brick, 4 Scrap, 6 Nail [S] (some guides: 6 Plank) | Smelts ore into ingots, sand into glass, seaweed into vine goo; burns planks |
| Wet/Dry Brick | (Sand, Clay) [unverified] | 2 Sand + 2 Clay → Wet Brick, which dries on the raft in ~5 min [S] | Smelter material |
| Metal Ingot | (not a learnable item) | Metal Ore in Smelter, ~80 s per ingot [S] | Researching it unlocks Bolt and Hinge [S] |
| Copper Ingot | (not a learnable item) | Copper Ore in Smelter [S] | Electronics; researching it unlocks Battery and Circuit Board paths [S] |
| Glass | (not a learnable item) | Sand in Smelter [S] | Needed for the Advanced Purifier and others |
| Vine Goo | (not a learnable item) | Seaweed in Smelter [S] | Glue for the Bow, Flippers, Circuit Board and others |
| Bolt | Metal Ingot [S] | 1 Metal Ingot (+Scrap?) → 1 Bolt [S?] | Material |
| Hinge | Metal Ingot [S] | 1 Metal Ingot (+Scrap?) [S?] | Material |
| Sail | not found [unverified] | 10 Plank, 20 Palm Leaf, 3 Scrap [S] | Wind propulsion that can be rotated; raise or lower it to move or stop |
| Stationary Anchor | Metal Ingot, Rope, Hinge [S] | 10 Plank, 6 Rope, 3 Metal Ingot, 1 Hinge [S] | Holds the raft in place (no drift) |
| Throwable Anchor | [unverified] | [unverified] | Temporary anchor |
| Advanced Purifier | Plank, Plastic, Glass [S] | 8 Plank, 6 Plastic, 4 Glass [S] | Purifies without fuel? (snippet says "without needing planks"; may be fuel-free or electric-capable) [S?] |
| Advanced Grill | Plank, Metal Ingot, Rope, Nail [S] | 6 Plank, 2 Metal Ingot, 2 Rope, 6 Nail [S] | Cooks several items at once |
| Circuit Board | (Copper Ingot, Vine Goo, Plastic) [unverified] | 5 Plastic, 2 Copper Ingot, 1 Vine Goo [S] (one guide: 2 Copper, 1 Plastic) | Electronics material |
| Battery (Simple) | Copper [S] | 1 Copper Ingot, 3 Scrap, 6 Plastic [S?] (other: 2 Copper, 1 Plastic, 1 Scrap) | Powers the Receiver; recharged at the Battery Charger [unverified] |
| Receiver | (Circuit Board, Hinge, Plastic) [unverified] | 8 Plank, 6 Plastic, 2 Circuit Board, 1 Hinge [S] | Shows radio signals (story locations) on a radar; needs 3 Antennas and a Battery |
| Antenna | (Bolt, Circuit Board, Scrap) [unverified] | 4 Scrap, 1 Circuit Board, 1 Bolt [S] | 3 are needed, placed apart and at height |
| Large Storage | **Blueprint (Tangaroa)**, not research [S] | [unverified] | Big chest |
| Storage (medium) | [unverified] | 8 Plank, 3 Scrap, 4 Rope, 1 Hinge [S?] | Chest |
| Metal Axe | (Bolt, Scrap) [unverified] | 8 Plank, 4 Rope, 2 Scrap, Bolt [S] | Cuts trees for planks |
| Metal Spear | Plank, Rope, Metal Ingot, Bolt [S] | Metal Ingot ×2 + … [S partial] | Better melee |
| Machete | **Blueprint (Balboa)** [S] | Metal Ingot ×2, Bolt ×2 + … [S partial] | Cuts vines and jungle; stronger weapon |
| Basic Bow | (Vine Goo, Bolt) [unverified] | 6 Plank, 4 Rope, 2 Vine Goo, 1 Bolt [S] | Ranged weapon |
| Stone Arrow | [unverified] | 3 Plank, 3–6 Stone, 6 Plastic [S?] | Ammo |
| Metal Fishing Rod | research [S] | [unverified] | Faster or better fishing |
| Flippers | (Vine Goo, Seaweed) [unverified] | 6 Plastic, 6 Seaweed, 5 Vine Goo, 4 Rope [S] | Faster swimming |
| Empty Bottle | [unverified] | 6 Plastic, 4 Vine Goo [S] | Oxygen Bottle part; also a drink container |
| Oxygen Bottle | [unverified] | 8 Plastic, 4 Rope, 1 Empty Bottle, 5 Vine Goo [S] | Longer dives |
| Binoculars | (Bolt, Rope, Bottle) [unverified] | includes 1 Bolt, 2 Rope, 2 Bottle(?) [S partial] | Spotting islands and signals |
| Scarecrow | research [S: "Scarecrow ... discovered at research table"] | [unverified] | Keeps seagulls off crops |
| Crop plots (Small/Medium/Grass) | research [unverified] | Grass Plot uses 4 Plastic + … [S partial] | Grow potatoes, beets, palm trees and other crops |
| Rain Catcher | [unverified] | [unverified] | Gathers fresh water passively |
| Recycler | **Blueprint (Radio Tower)**, then research [S] | [unverified] | Turns junk into materials |
| Zipline (tool + rope) | **Blueprint (Caravan Town)** [S] | 5 Plank, 5 Rope, 1 Bolt (from the Caravan Town snippet, likely the zipline) [S?] | Fast movement across the raft |
| Engine / Steering Wheel | **Blueprint (Vasagatan)** [S] | see section 3 | Motorized propulsion |

## 3. Story-location blueprints

In 1.0 a blueprint teaches its recipe as soon as it is picked up [S]. Some guides say certain blueprints, such as the Recycler, still have to be confirmed at the Research Table [S?].

| Location (order) | Blueprints | Notes |
|---|---|---|
| 1. Radio Tower | **Recycler** (whiteboard at the top) [S]; **Head Light** (crate at the top, labelled a reward for preparing for Vasagatan) [S] | Reached by following a signal on the Receiver. Gives Vasagatan's frequency |
| 2. Vasagatan (wrecked ship) | **Engine**, **Steering Wheel** (bridge/cockpit, behind a door opened with a Bomb) [S] | Engine: ~20 Plank, 5 Metal Ingot, 5 Rope, 1 Circuit Board [S?, single guide]. Steering Wheel: 10 Scrap, 4 Metal Ingot, 4 Rope, 2 Bolt or 2 Hinge [S]. One wheel turns the whole raft no matter how many engines are fitted [S]. Engines burn Biofuel or Fuel [unverified fuel detail] |
| 3. Balboa Island | **Machete** (Mama Bear's cave) [S]; **Biofuel Refiner** (Ranger Station) [S]; **Fuel Tank** (Relay Station 6) [S]; **Fuel Pipe** (Relay Station 4) [S]; Advanced Biofuel Refiner (a wiki page exists, location unverified) | Biofuel production chain for engines |
| 4. Caravan Town | **Zipline** and **Zipline Tool** (collect 3 zipline parts; blueprint at the top of the central tower) [S] | Mayor's key puzzle [S] |
| 5. Tangaroa (floating city) | **Electric Purifier** (Plantation, after tape repairs) [S]; **Large Storage** (Main Tower top) [S]; **Water Tank** (Bridge) [S]; **Water Pipe** (basement) [S]; about 4 blueprints in total [S] | Sprinkler: [unverified] |
| 6. Varuna Point | **Advanced Headlight** (first one found) [S]; **Advanced Battery** (unfinished building opposite the crane) [S]; **Electric Grill** (end of the crane) [S]; **Wind Turbine** (planning room, after the Rhino Shark fight) [S] | Electricity tier |
| 7. Temperance (snow island) | **Advanced Stationary Anchor** (locked safe, observatory) [S]; **Electric Smelter** (Selene reactor room, after stabilising it) [S]; **Titanium Tools** (balcony table, last one) [S] | Titanium tier |
| 8. Utopia (finale) | **Big Backpack** (Detto's house, after the digging puzzle) [S]; one guide counts 3 blueprints in total, the other 2 unverified [S?] | Endgame |

Chapter grouping [S?]: Chapter 1 is Radio Tower, Vasagatan, Balboa. Chapter 2 is Caravan Town, Tangaroa. Chapter 3 is Varuna Point, Temperance, Utopia.

## 4. Natural stage order (compact)

### Stage 0: start (minutes 0–10)
| Goal | Items |
|---|---|
| Collect debris | Plastic Hook (owned) |
| Expand the raft | Building Hammer; foundations from Plank + Plastic [unverified counts] |
| Water | Empty Cup + Simple Purifier |
| Food | Simple Grill (start or quick research) + hooked or caught fish, potatoes and coconuts from debris |
| Defence | Wooden Spear (shark attacks foundations) |
| Unlock | Research Table (14 Plank, 2 Scrap) |

### Stage 1: early survival
| Goal | Items |
|---|---|
| Passive income | Simple Collection Net(s) (research Plank/Scrap/Nail) |
| Food loop | Fishing Rod, crop plots, Scarecrow |
| Rest | Simple Bed (10 Palm Leaf, 6 Plank, 4 Plastic, 3 Nail) |
| Storage | Small Storage |
| Exploration | Swim to small islands: Sand, Clay, Stone, Metal/Copper Ore, Seaweed (Shovel/Axe [unverified tier]) |

### Stage 2: research basics
| Goal | Items |
|---|---|
| Unlock by researching raw pickups | Plank, Plastic, Palm Leaf, Rope, Scrap, Nail, Stone, Sand, Clay, Seaweed |
| Bricks | Wet Brick (2 Sand + 2 Clay), dried → Dry Brick |
| Tools | Stone Arrows/Bow (after Vine Goo), Throwable Anchor [unverified] |

### Stage 3: smelting and metal
| Goal | Items |
|---|---|
| Smelter | 4 Plank, 6 Dry Brick, 4 Scrap, 6 Nail |
| Smelted products | Metal Ingot, Copper Ingot, Glass, Vine Goo; research each |
| Metal parts | Bolt, Hinge |
| Upgrades | Metal Axe, Metal Spear, Advanced Grill, Advanced Purifier, Storage (with Hinge), Metal Fishing Rod |
| Diving | Flippers, Empty Bottle → Oxygen Bottle |

### Stage 4: navigation
| Goal | Items |
|---|---|
| Steering by wind | Sail (10 Plank, 20 Palm Leaf, 3 Scrap) |
| Stop or park | Stationary Anchor (10 Plank, 6 Rope, 3 Metal Ingot, 1 Hinge) |
| Find story locations | Circuit Board → Battery, Receiver (8 Plank, 6 Plastic, 2 Circuit Board, 1 Hinge), 3× Antenna (4 Scrap, 1 Circuit Board, 1 Bolt each) |
| Scouting | Binoculars |
| First story stop | Radio Tower → Recycler, Head Light |

### Stage 5: engine and late game
| Goal | Items |
|---|---|
| Motor | Vasagatan → Engine + Steering Wheel |
| Fuel chain | Balboa → Biofuel Refiner, Fuel Tank, Fuel Pipe; Machete for vines |
| Mobility | Caravan Town → Zipline |
| Automation | Tangaroa → Electric Purifier, Water Tank/Pipe, Large Storage |
| Electricity | Varuna Point → Wind Turbine, Advanced Battery, Electric Grill, Advanced Headlight |
| Titanium | Temperance → Electric Smelter, Titanium Tools, Advanced Stationary Anchor; Advanced Collection Net (Titanium research) |
| End | Utopia → Big Backpack, ending |

## Design takeaways for a Raft-like game (brief)

- Recipes are gated by **material discovery** rather than XP. Researching a material consumes one unit, and a blueprint unlocks when its whole material set has been researched. That makes every new pickup type feel like progress.
- There are two tiers of unlocks. Research covers the systemic tech tree. Story blueprints gate traversal and automation: engine, zipline, electricity.
- The starting menu is small (hook, hammer, rope, spear, cup, purifier, grill, research table). Passive collection (nets) and sleep (bed) are the first things to research, which teaches players the research loop right away.

## Sources (via WebSearch results; direct fetch blocked)

- https://raft.fandom.com/wiki/Research_Table (and ?oldid=5371)
- https://raft.fandom.com/wiki/Simple_Collection_Net
- https://raft.fandom.com/wiki/Stationary_Anchor ; https://raft.fandom.com/wiki/Navigation
- https://raft.fandom.com/wiki/Food_%26_Water ; https://raft.fandom.com/wiki/Other ; https://raft.fandom.com/wiki/Equipment
- https://raft.fandom.com/wiki/Blueprint:_Fuel_Tank ; https://raft.fandom.com/wiki/Blueprint:_Pipe ; https://raft.fandom.com/wiki/Blueprint:_Advanced_Biofuel_Refiner
- https://craftpedia.info/raft/simple-bed ; https://craftpedia.info/raft/advanced-purifier ; https://craftpedia.info/raft/bolt ; https://craftpedia.info/raft/hinge ; https://craftpedia.info/raft/antenna
- https://www.mejoress.com/en/raft-recipes-cooking-crafting/
- https://segmentnext.com/raft-blueprints-locations/
- https://primagames.com/tips/how-to-use-the-research-table-in-raft ; https://primagames.com/tips/raft-caravan-town-guide-all-notes-and-blueprints ; https://primagames.com/tips/how-to-get-an-advanced-collection-net-in-raft
- https://gameranx.com/features/id/326010/article/raft-how-to-make-vine-goo-circuit-boards-crafting-guide/
- https://gameranx.com/features/id/326012/article/raft-how-to-get-a-permanent-anchor-crafting-guide/
- https://gamerant.com/raft-how-to-get-flippers-and-the-oxygen-bottle/ ; https://gamerant.com/raft-all-weapons-how-craft/
- https://www.pcgamer.com/raft-recycler-blueprint-craft
- https://itemlevel.net/raft-all-balboa-notes-and-blueprints-locations/
- https://gamesfuze.com/guides/raft-utopia-guide-and-walkthrough-notes-puzzles-and-blueprint-locations/
- https://gamesfuze.com/guides/raft-temperance-full-guide-and-walkthrough-notes-and-blueprint-locations/
- https://screenrant.com/raft-how-to-craft-use-electric-smelter-guide/
- https://www.thegamer.com/raft-vasagatan-walkthrough-ship-bridge-bomb-guide/
- https://game-guide.club/raft/cooking-recipes/ (Grill "Start" row)
- https://steamcommunity.com/sharedfiles/filedetails/?id=1648718375 (Raft - Complete Guide; seen in results only)
