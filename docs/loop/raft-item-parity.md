# Raft 1.0 item parity

Every Raft 1.0 item we could pin down, matched against Little Raft's item data, with an effort call for each missing one.
The research pass changed no game code; the items pass (section 0) added items and applied retunes.

## 0. Items pass (branch `claude/raft-items`)

Added (catalogue entry, recipe, unlock, icon, held model, crafting tab, craft-book text; all hand recipes):

| Id | Name | Tab | Recipe | Unlock | What it does |
|---|---|---|---|---|---|
| `metalaxe` | Metal Axe | tools | 4 wood + 3 metal ingot + 2 rope + 1 bolt | research metal ingot + Stone Axe | `actsAs: 'axe'`, 100 uses (stone 50); repair 1 ingot + 1 wood |
| `machete` | Machete | weapons | 3 metal ingot + 2 bolt + 3 wood + 2 rope | research Metal Spear | `actsAs: 'spear'`, 15 damage (`SPEAR_DAMAGE`), 60 uses; repair 1 ingot + 1 scrap. Jabs like the spears (no slash mechanic) |
| `headlamp` | Headlamp | equipment | 1 battery + 2 rope + 2 scrap [src] | Tinker's Desk research (like the other diving gear) | Diving gear (`GEAR_IDS` bit 4): fog x1.25 while in the bag, stacks with the goggles |

The metal axe and machete recipes are our picks: their rows below are `[recall]` (Raft's are ingot + plank + rope,
plus bolt, based), so the counts follow our metal spear (2 ingot + 1 bolt) one step up. Verify on the wiki.
Damage 15 and 60 uses for the machete, 100 uses for the metal axe, and the headlamp's fog x1.25 are also our picks.

Retunes applied (recipe only, ids unchanged): `grill` 3 rope -> 6 rope [src]; `scarecrow` 3 wood + 4 leaf + 2 rope +
1 plastic -> 5 wood + 3 leaf + 3 nail + 3 plastic [src] (unlock moved from holding rope to holding a nail, since it
now costs nails). Both stay inside `PROGRESSION_PLAN` (the grill is minute 24, rope is plentiful by then).

Crafting tabs: every recipe id (ITEMS, content and lane recipes, and station outputs) has one of Raft's 8 tabs:
`CRAFT_TABS` and `craftTabOf(id)` in `dist/items.js`, and `ITEMS[id].tab`. Text for kinds newer than the craft book:
`ITEM_TEXT_EXTRA` in `dist/items.js`.

Save safety: `tests/item-ids-save.test.mjs` loads bags, Progression, decor, chests, drop boxes and pickup loot with
new, legacy, renamed, future and junk ids. New ids do not collide with `LEGACY_ALIASES` (added `metal_axe` ->
`metalaxe`). Old saves simply lack the new ids. Co-op: a host snapshot with a kind the guest lacks is dropped by
`migrateSnapshot` (the rest of the bag stays); the held kind travels as its role (`axe`, `spear`), so older guests
see the stone axe or wooden spear in a partner's hand; an unknown held kind is sent as index 0 (nothing).

Why many CHEAP rows stayed open: the crafting UI (`dist/craft-book.js`, owned by the UI lane this round) needs an
`ITEM_SOURCE` row for every bag kind that is not hand crafted (gathered items, station outputs, meals, juices), and an
`ITEM_TEXT` row for every kind (`tests/craft-ux.test.mjs`, `tests/survival.test.mjs`). Hand-crafted items can ship
with `ITEM_TEXT_EXTRA`; gathered or station-made kinds cannot until the craft book reads a source hint from item
data. The rows marked "Blocked: ITEM_SOURCE" below are the ones that are otherwise ready.

| Measure | Before | After |
|---|---|---|
| Raft 1.0 items listed | 191 | 191 |
| Matched in Little Raft (MATCH) | 102 | 106 |
| Ours-only (OURS) | 59 | 59 |
| Missing, CHEAP | 53 | 49 |
| Missing, SYSTEM | 36 | 36 |
| Our bag kinds (`ITEM_KINDS`) | 148 | 151 |

The fourth new match is Drinking Glass, which the existing `glasscups` recipe (1 glass -> 3 cups) already covers.

## Summary

| Measure | Count |
|---|---|
| Raft 1.0 items listed | 191 |
| Matched in Little Raft (MATCH) | 106 |
| Ours-only (OURS) | 59 |
| Missing, CHEAP | 49 |
| Missing, SYSTEM | 36 |

Coverage: 106 of 191 Raft items (55%) have a Little Raft counterpart; adding every CHEAP item would reach 155 (81%).
Every one of our 151 bag kinds (`ITEM_KINDS` in `dist/inventory-state.js`) appears in this file, either as a match
or in the ours-only table (the three new kinds are in the item tables as MATCH rows).

- **Raft total** counts the rows in sections 2 to 11 (one row per Raft item; colour or species families that share one
  bag kind in Raft's own menus, such as the 5 flower seeds or the 28 vending-machine decorations, are one row each).
- **Matched** means Little Raft has an item that plays the same role. The name, recipe or station may differ; see
  the Notes column and section 13.
- **Ours-only** are Little Raft bag kinds with no Raft counterpart (section 12).
- **CHEAP** fits existing systems: an `items.js` entry (or `content-items.js` row), an icon in `item-svg.js` /
  `icon-models.js`, a held model in `held-items.js`, and at most one row in an existing station table
  (smelter, grill, cookpot, juicer, recycler, trader, barrel loot, seafloor or island drops).
- **SYSTEM** needs a new mechanic or a mechanic our design leaves out on purpose (health, combat, hostile animals,
  story/keys, pipes and fuel, projectiles, bag size changes).

## 1. Sources and confidence

The wiki hosts named in the task (raft.wiki.gg and raft.fandom.com) do not resolve from this cloud session, and
WebFetch to other recipe sites is blocked the same way. WebSearch works but only returns summaries. So:

- **[src]**: the recipe or fact came back from a web search summary this session (sources listed in section 15).
- **[W]**: from earlier repo research that did read the wiki (`docs/loop/research/fidelity-r2b-world.md`).
- **[recall]**: from knowledge of the game, not re-checked this session. Counts marked `~` are the least sure.

Before retuning a recipe to a `[recall]` value, check it on the wiki (allow `raft.wiki.gg` in the session network
settings). Per `docs/RAFT-REFERENCE.md` we copy mechanics and numbers, never Raft names or art, so the Raft names
below are for reference; our display names stay our own unless a name is plain English (Plank, Rope, Nail).

Stations used below: **hand** (crafting menu, after the recipe is learned), **research** (the recipe is learned at
the Research Table, then crafted by hand), **blueprint** (learned by picking up a story blueprint), **smelter**,
**grill**, **cookpot**, **juicer**, **purifier**, **hammer** (build menu), **placed** (a placed item changes over time).

## 2. Raw materials and gathered resources

| Status | Raft item | Raft recipe / source | Ours (id) | Notes |
|---|---|---|---|---|
| MATCH | Plank | debris, barrels, axe on trees | `wood` | Displayed as Plank already |
| MATCH | Palm Leaf | debris, barrels, trees | `leaf` | |
| MATCH | Plastic | debris, barrels | `plastic` | |
| MATCH | Scrap | debris, barrels | `scrap` | |
| MATCH | Stone | barrels, seafloor | `stone` | |
| MATCH | Clay | seafloor near islands [src] | `clay` | |
| MATCH | Sand | seafloor near islands [src] | `sand` | |
| MATCH | Metal Ore | seafloor, island rocks | `metalore` | |
| MATCH | Copper Ore | seafloor, island rocks [src] | `copperore` | |
| CHEAP | Titanium Ore | deep seafloor, rare [src] | - | Add to seafloor/barrel tables (`BARREL_LOOT`, diving seafloor nodes). Blocked: ITEM_SOURCE |
| MATCH | Seaweed | seafloor | `seaweed` | |
| CHEAP | Sea Vine | seafloor plant [recall, verify use] | - | Seafloor node drop |
| CHEAP | Silver Algae | seafloor, glowing [recall] | - | Seafloor node drop; Raft uses it in late recipes (verify) |
| MATCH | Coconut | palm trees | `coconut` | |
| MATCH | Red Berries | island bushes | `berries` | Our name "Island Berries" |
| MATCH | Raw Beet | barrels, crop plots | `beet` | |
| MATCH | Raw Potato | barrels, crop plots | `potato` | |
| CHEAP | Watermelon | islands, crop plot [recall] | - | Island drop + crop entry in `crops.js` |
| CHEAP | Pineapple | islands, crop plot [recall] | - | Same as above |
| CHEAP | Mango | islands, crop plot [recall] | - | Same as above |
| CHEAP | Banana | islands, crop plot [recall] | - | Same as above |
| CHEAP | Cave Mushroom | island caves [src: Catfish Deluxe ingredient] | - | We have no caves; drop it from island rocks instead |
| MATCH | Palm Seed | palm chops [W] | `seed` | |
| MATCH | Flower Seed (5 colours) | islands | `flowerseed` | We keep one colourless kind |
| MATCH | Honeycomb | beehive | `honey` | Raft beehives give honeycomb; ours gives honey + wax |
| MATCH | Egg | chickens | `puffegg` | Our hen is the Puffhen |
| MATCH | Feather | chickens | `feather` | |
| MATCH | Bucket of Milk | goat + bucket | `milk` | |
| SYSTEM | Wool | llama + shears [src] | - | Needs a llama species and shearing in `animals-core.js` |
| SYSTEM | Leather | hostile island animals [recall] | - | Our animals are friendly; no hunting by design |
| SYSTEM | Raw Drumstick | chicken kill [recall] | - | No animal meat by design |
| SYSTEM | Raw Mutton | llama / goat kill [recall] | - | No animal meat by design |
| MATCH | Raw Pomfret | fishing | `fish` | One bag kind; species live in `fish-species.js` (journal only) |
| MATCH | Raw Mackerel | fishing | `fish` | As above |
| MATCH | Raw Herring | fishing [src] | `fish` | As above |
| MATCH | Raw Tilapia | fishing | `fish` | As above |
| CHEAP | Raw Catfish | fishing [src] | - | Only if a cookpot recipe needs it as its own kind (Catfish Deluxe) |
| CHEAP | Raw Salmon | fishing [src] | - | Same (Salmon Salad) |
| MATCH | Raw Shark Meat | dead shark | `sharkmeat` | |
| MATCH | Shark Head | dead shark | `sharkhead` | |

## 3. Refined materials (Raft "Resources" tab and station outputs)

| Status | Raft item | Raft recipe | Where | Ours (id) | Notes |
|---|---|---|---|---|---|
| MATCH | Rope | 2 Palm Leaf | hand | `rope` | Same |
| MATCH | Nail | ~1 Scrap -> 2 Nails [recall, verify] | hand | `nail` | Ours 2 scrap -> 3 |
| MATCH | Bolt | 1 Metal Ingot + 1 Scrap [recall] | research | `bolt` | Ours yields 2 per craft |
| MATCH | Hinge | 1 Metal Ingot + ~2 Nails [recall, verify] | research | `hinge` | Ours yields 2 per craft |
| MATCH | Metal Ingot | 1 Metal Ore, 1 plank fuel | smelter | `metalingot` | Also our Seaside Kiln (2 ore) |
| MATCH | Copper Ingot | 1 Copper Ore | smelter | `copperingot` | |
| CHEAP | Titanium Ingot | 1 Titanium Ore | smelter | - | One `cook('smelter', ...)` row |
| MATCH | Glass | 1 Sand | smelter | `glass` | |
| CHEAP | Vine Goo | 1 Seaweed [src: smelter takes seaweed] | smelter | - | One smelter row; seaweed is already smelter fuel, so check the fuel / input split. Blocked: ITEM_SOURCE (station output) |
| CHEAP | Circuit Board | 2 Copper Ingot + 5 Plastic + 1 Vine Goo [src, single source] | research | - | Gate on copper ingot + vine goo research. Waits on Vine Goo |
| CHEAP | Wet Brick | 1 Sand + 1 Clay [src] | hand | - | Raft dries it into Dry Brick when placed; we could keep firing it at the grill. Skipped: inert until placed drying exists, and `brick` already has its one grill recipe (clay) |
| MATCH | Dry Brick | Wet Brick, placed to dry [src] | placed | `brick` | Ours: 1 clay at the grill |
| CHEAP | Explosive Powder | ~1 Sand + 1 Explosive mushroom-type drop [recall, verify] | hand | - | Only useful with fireworks / arrows |
| CHEAP | Explosive Goo | 1 Explosive Powder [recall] | smelter | - | One smelter row |
| CHEAP | Empty Bottle | ~Glass [recall, verify count] | research | - | Ingredient for binoculars / oxygen bottle. Skipped: inert until `airjug` / `binoculars` use it (the airjug retune also needs Vine Goo) |
| SYSTEM | Biofuel | food or leaves in a Biofuel Refiner [recall] | refiner | - | Needs the refiner + fuel tank + engine fuel line |
| MATCH | Battery | 1 Copper Ingot + 6 Plastic [src, single source] | research | `battery` | Ours 2 copper + 1 ingot + 2 plastic |

## 4. Tools

| Status | Raft item | Raft recipe | Where | Ours (id) | Notes |
|---|---|---|---|---|---|
| MATCH | Plastic Hook | 2 Plank + 2 Plastic + ~3 Rope [recall] | start / hand | `hook` | Ours 1 wood + 2 plastic |
| MATCH | Scrap Hook | 3 Scrap + 2 Plank + 2 Rope [recall] | research | `metalhook` | Ours "Metal Hook": 6 ingot + 2 bolt + 2 rope + 2 wood. `scraphook` already aliases to it |
| CHEAP | Titanium Hook | ~2 Titanium Ingot + Plank + Rope [recall] | research | - | Third tier, more uses |
| MATCH | Building Hammer | Planks + Rope [src] | hand | `hammer` | Ours 4 wood + 2 rope |
| MATCH | Fishing Rod | ~6 Plank + 8 Rope [recall] | hand | `fishingrod` | Same as ours |
| CHEAP | Metal Fishing Rod | ~Metal Ingot + Plank + Rope [recall] | research | - | Faster bite / reel multiplier in `fishing-rules.js`. Skipped: `game.js` and `fishing-cooking.js` check the raw kind `'fishingrod'`, not `toolRole`, so a second rod needs code |
| MATCH | Axe | ~6 Plank + 3 Stone + 2 Rope [W guide] | research | `axe` | Ours "Stone Axe", same cost |
| MATCH | Metal Axe | Metal Ingot + Plank + Rope [recall] | research | `metalaxe` | Added: 4 wood + 3 ingot + 2 rope + 1 bolt (our pick), 100 uses. Same chop count as the stone axe |
| CHEAP | Titanium Axe | Titanium Ingot based [src: titanium tools exist] | research | - | Waits on titanium (ore blocked: ITEM_SOURCE) |
| MATCH | Shovel | Plank + Scrap based [recall] | research | `spade` | Our "Little Spade" |
| MATCH | Metal Detector | Battery + Circuit Board + Metal Ingot [recall] | research | `finder` | Ours "Seashell Finder", no battery |
| MATCH | Binoculars | Empty Bottle + Bolt + Glass + Rope [src] | research | `binoculars` | Ours 2 glass + 1 copper + 2 hinge + 1 bolt |
| MATCH | Paddle | ~4 Plank + 2 Rope [recall] | hand | `paddle` | Ours adds 2 plastic |
| MATCH | Bucket | Plank + Scrap based [recall] | research | `bucket` | Our "Wooden Pail" |
| MATCH | Zipline Tool | blueprint (3 Zipline Parts, Caravan Town) [src] | blueprint | `glidehandle` | Ours is a plain hand recipe |
| MATCH | Paint Brush | Plank + Palm Leaf based [recall] | hand | `brush` | |
| SYSTEM | Sweep Net | Plank + Rope + Plastic based [recall] | research | - | Catching bees: our beehive spawns its own bees (`bees.js`) |
| SYSTEM | Shears | Scrap + Plank based [recall] | research | - | Needs llamas / wool |
| SYSTEM | Fishing Bait (simple, advanced, expert) | food + seaweed based [recall, verify] | research | - | Rod slot for bait + catch-table modifiers |
| SYSTEM | Battery Charger | Copper + Circuit Board based [recall] | research | - | Charging carried batteries from `power.js` |
| SYSTEM | Healing Salve | plant based [recall, verify] | research | - | We have no health by design |

## 5. Weapons

| Status | Raft item | Raft recipe | Where | Ours (id) | Notes |
|---|---|---|---|---|---|
| MATCH | Wooden Spear | ~Plank + Rope + Scrap [recall] | hand | `spear` | Ours 8 wood + 3 rope |
| MATCH | Metal Spear | Metal Ingot + Plank + Rope [recall] | research | `metalspear` | |
| MATCH | Machete | blueprint, Metal Ingot + Bolt + Plank based [recall] | blueprint | `machete` | Added as a research recipe (we have no blueprints): 3 ingot + 2 bolt + 3 wood + 2 rope (our pick), 15 damage, 60 uses. Jabs, no slash |
| CHEAP | Titanium Sword | Titanium Ingot based [src] | research | - | Same role as machete |
| SYSTEM | Bow | Plank + Rope + Wool/Leather based [recall] | research | - | Projectile weapon, charge + aim |
| SYSTEM | Stone Arrow | Plank + Stone + Feather [recall] | research | - | Needs the bow |
| SYSTEM | Metal Arrow | Plank + Metal Ingot + Feather [recall] | research | - | Needs the bow |
| SYSTEM | Titanium Arrow | Plank + Titanium Ingot + Feather [src] | research | - | Needs the bow |
| SYSTEM | Shark Bait | raw fish + rope based [recall] | hand | - | Shark AI target in `shark.js` |

## 6. Equipment

| Status | Raft item | Raft recipe | Where | Ours (id) | Notes |
|---|---|---|---|---|---|
| MATCH | Oxygen Bottle | 8 Plastic + 4 Rope + 1 Empty Bottle + 5 Vine Goo [src] | research | `airjug` | Ours 3 plastic + 1 ingot + 1 rope ("Breath Jug") |
| MATCH | Flippers | 6 Plastic + 6 Seaweed + 5 Vine Goo + 4 Rope [src] | research | `fins` | Ours 3 feather + 2 plastic + 1 rope |
| MATCH | Headlight | 1 Battery + 2 Rope + 2 Scrap [src] | research | `headlamp` | Added as "Headlamp": diving gear, fog x1.25 underwater. No deck light at night and no battery drain yet (follow-up) |
| SYSTEM | Backpack | 4 Leather + 4 Rope + 6 Wool [src] | research | - | +5 bag slots: `SLOT_COUNT` is fixed and `new Bag()` rejects any other length |
| SYSTEM | Leather Helmet | 4 Leather + 2 Wool [src] | research | - | Armor; no damage in our design |
| SYSTEM | Leather Body Armor | 8 Leather + 4 Wool [src] | research | - | Same |
| SYSTEM | Leather Greaves | 5 Leather + Wool [src] | research | - | Same |

## 7. Navigation

| Status | Raft item | Raft recipe | Where | Ours (id) | Notes |
|---|---|---|---|---|---|
| MATCH | Sail | ~10 Plank + 20 Palm Leaf + 3 Scrap [recall, as in ours] | hand | `sail` | |
| MATCH | Engine | 20 Plank + 5 Metal Ingot + 5 Rope + 1 Circuit Board [src] | blueprint | `motor` | Ours "Little Motor": 6 wood + 4 scrap + 2 rope, fuelled with wood |
| MATCH | Steering Wheel | 10 Scrap + 4 Metal Ingot + 4 Rope + 2 Bolt [src] | blueprint | `wheel` | Ours 5 wood + 2 rope |
| MATCH | Receiver | 8 Plank + 6 Plastic + 2 Circuit Board + 1 Hinge [src] | research | `receiver` | Ours 3 wood + 4 scrap + 3 plastic + 2 rope |
| MATCH | Antenna | 4 Scrap + 1 Circuit Board + 1 Bolt [src]; 3 needed | research | `antenna` | Ours 2 wood + 1 scrap + 1 rope |
| CHEAP | Anchor | Scrap + Metal Ingot + Rope based [recall] | research | - | `sailing-core.js` already has `anchored`; a placed decor toggles it |
| CHEAP | Compass | small metal + glass recipe [src: 1.0 changelog] | research | - | HUD heading while held |
| SYSTEM | Engine Controls | Circuit Board based [recall] | research | - | Remote toggle for several engines; ours `wheel` already toggles all motors, so maybe skip |

## 8. Stations and "Other" tab

| Status | Raft item | Raft recipe | Where | Ours (id) | Notes |
|---|---|---|---|---|---|
| MATCH | Research Table | ~14 Plank + 2 Scrap [W guide] | hand | `researchtable` | Ours 10 wood + 4 nail + 2 rope. Duplicate: content item `research` ("Tinker's Desk") |
| MATCH | Simple Grill | 6 Plank + 1 Scrap + 6 Rope [src] | hand | `grill` | Ours 3 rope |
| CHEAP | Advanced Grill | Metal Ingot + Scrap + Plank [recall] | research | - | Grill with 2 slots / faster `time` |
| MATCH | Simple Purifier | Plank + Palm Leaf + Plastic [recall] | hand | `purifier` | Ours 6 wood + 6 leaf + 4 plastic |
| CHEAP | Advanced Purifier | Metal Ingot + Plastic + Scrap [recall] | research | - | Faster purifier tier |
| SYSTEM | Electric Purifier | Circuit Board + Metal + Titanium-tier [recall] | research | - | Battery-powered, feeds a Water Tank through pipes |
| MATCH | Smelter | Dry Brick + Clay + Stone + Scrap based [recall] | research | `smelter` | Ours 6 wood + 10 brick + 7 stone + 6 nail |
| SYSTEM | Electric Smelter | Titanium + Circuit Board based [src] | research | - | Draws from a battery (`power.js`) |
| MATCH | Cooking Pot | includes 2 Metal Ingot [src] | research | `cookpot` | Ours 3 clay + 2 stone + 1 scrap |
| MATCH | Juicer | 6 Plank + 6 Plastic + 1 Bolt + 4 Vine Goo + 1 Circuit Board [src] | research | `juicer` | Ours 4 wood + 2 scrap + 1 rope |
| MATCH | Small Storage | Plank + Scrap based [recall] | hand | `crate` | |
| CHEAP | Large Storage | more planks + nails [recall] | research | - | Bigger `crate` variant in `storage-research.js`. Skipped: that module hard-codes the `'crate'` decor type and `CHEST_SLOTS` |
| CHEAP | Fridge | Metal + Circuit Board based [src: 1.0 changelog] | research | - | Storage variant (no spoilage in our design) |
| CHEAP | Wardrobe | Plank based [src: 1.0 changelog] | research | - | Opens the existing `look.js` avatar UI |
| MATCH | Collection Net | Plank + Rope + Scrap [recall] | hand | `net` | |
| MATCH | Small Crop Plot | Plank + Rope [recall] | hand | `cropplot` | |
| CHEAP | Medium Crop Plot | more planks + rope [recall] | research | - | More slots, same `crops.js`. Skipped: `crops.js` has one `PLOT_TYPE` with a fixed `SLOTS = 3` |
| CHEAP | Large Crop Plot | more planks + rope [recall] | research | - | More slots, same `crops.js` |
| SYSTEM | Grass Plot | Plank + dirt / seeds [recall] | research | - | Llama/goat grazing |
| MATCH | Scarecrow | 5 Plank + 3 Palm Leaf + 3 Nail + 3 Plastic [src] | research | `scarecrow` | Ours 3 wood + 4 leaf + 2 rope + 1 plastic |
| MATCH | Sprinkler | Metal Ingot + Circuit Board + Bolt based [recall] | research | `sprinkler` | Ours 2 scrap + 2 plastic + 1 rope |
| SYSTEM | Water Tank | Plank + Metal + Plastic based [recall] | research | - | Pipe-fed by the Electric Purifier. Our `rainbarrel` fills from rain instead |
| SYSTEM | Pipe | Plastic + Scrap based [recall] | research | - | Pipe network for water and biofuel |
| MATCH | Beehive | Plank + Rope + Palm Leaf based [recall] | research | `beehive` | |
| MATCH | Wind Turbine | Metal + Bolt + Hinge based [recall] | research | `turbine` | |
| SYSTEM | Simple Biofuel Refiner | Plank + Scrap + Metal [recall] | research | - | Fuel production chain |
| SYSTEM | Advanced Biofuel Refiner | Circuit Board based [src: 1.0] | research | - | Same |
| SYSTEM | Fuel Tank | Metal + Plastic based [recall] | research | - | Same |
| SYSTEM | Animal Trap | Plank + Rope + Scrap based [recall] | research | - | Catching island animals |
| SYSTEM | Animal Feeder | Plank based [recall] | research | - | Feeding penned animals |
| MATCH | Recycler | Metal + Circuit Board based [src: 1.0] | research | `recycler` | Ours "Sorting Tub", junk -> scrap/plastic/sand |
| MATCH | Bed | Plank + Palm Leaf + Plastic + Nail [recall] | hand | `bed` | Ours 10 leaf + 6 wood + 4 plastic + 3 nail |
| MATCH | Bowl | Plank [recall, verify] | hand | `bowl` | Ours "Driftwood Bowl", 1 wood -> 2 |
| MATCH | Firework | Plastic + Explosive Powder based [recall] | research | `skyrocket` | Ours has no explosive input |

## 9. Food and water

| Status | Raft item | Raft recipe | Where | Ours (id) | Notes |
|---|---|---|---|---|---|
| MATCH | Empty Cup | 4 Plastic [recall, as ours] | hand | `cup` | |
| MATCH | Cup of Salt Water | scoop the sea | - | `saltcup` | |
| MATCH | Cup of Fresh Water | Salt Water in a purifier | purifier | `freshcup` | |
| CHEAP | Canteen | Plastic + Rope based [recall] | research | - | A bigger cup (3 sips) on the same watering lane. Skipped: needs a sip counter on the cup kinds |
| MATCH | Drinking Glass | Glass [recall] | research | `glasscups` recipe | Existing "Glass Cups" recipe: 1 glass -> 3 cups |
| MATCH | Cooked Beet | 1 Raw Beet | grill | `cookedbeet` | |
| MATCH | Cooked Potato | 1 Raw Potato | grill | `cookedpotato` | |
| MATCH | Cooked Fish (each species) | 1 raw fish | grill | `cookedfish` | One kind for all species |
| MATCH | Cooked Shark Meat | 1 Raw Shark Meat | grill | `cookedsharkmeat` | |
| SYSTEM | Cooked Drumstick | 1 Raw Drumstick | grill | - | No animal meat by design |
| SYSTEM | Cooked Mutton | 1 Raw Mutton | grill | - | No animal meat by design |
| CHEAP | Simple Fish Stew | 1-2 Potato/Beet + 1-2 Herring/Pomfret [src] | cookpot | - | One `RECIPES` key in `cookpot-core.js` (needs a 4-slot pot or a 3-item variant) |
| CHEAP | Catfish Deluxe | Potato + Beet + Catfish + Cave Mushroom [src] | cookpot | - | Needs catfish + mushroom kinds |
| CHEAP | Salmon Salad | Salmon + vegetables [src: wiki file name] | cookpot | - | Needs salmon kind |
| CHEAP | Shark Dinner | Shark Meat + vegetables [recall] | cookpot | - | |
| CHEAP | Vegetable Soup | Potato + Beet + more veg [recall] | cookpot | - | |
| CHEAP | Mushroom Omelette | Egg + Cave Mushroom [recall] | cookpot | - | Our Puff Egg fits |
| CHEAP | Leftovers | any 4 ingredients that match no recipe [src] | cookpot | - | Our pot refuses unknown sets instead |
| CHEAP | Fruit Juice | 2 fruit [recall] | juicer | - | One `juicer.js` mix row |
| CHEAP | Coconut Beat | Coconut + Beet [recall] | juicer | - | One `juicer.js` mix row |
| CHEAP | Silver Smoothie | Silver Algae + fruit [recall, verify] | juicer | - | Needs Silver Algae |
| MATCH | Jar of Honey | Honeycomb based [recall] | hand | `honey` | We hand out honey straight from the hive |

Raft lists about 12 cooking pot and 8 juicer recipes [src: wiki / guide counts disagree, 12 to 20]. The ones above
are the names we could confirm or are confident of; the rest need the wiki.

## 10. Building pieces (hammer menu)

| Status | Raft item | Raft recipe | Where | Ours (id) | Notes |
|---|---|---|---|---|---|
| MATCH | Foundation | 2 Plank + 2 Plastic [src] | hammer | piece `foundation` | Same |
| MATCH | Floor | Plank [recall] | hammer | piece `floor` | |
| MATCH | Wall | Plank [recall] | hammer | piece `wall` | |
| MATCH | Half Wall | Plank [recall] | hammer | piece `halfwall` | |
| MATCH | Window Wall | Plank [recall] | hammer | piece `window` | |
| MATCH | Doorway | Plank [recall] | hammer | piece `door` | |
| CHEAP | Door | Plank + Hinge based [recall] | hammer | - | A stateful edge piece like `gate` |
| MATCH | Pillar | Plank [recall] | hammer | piece `pillar` | |
| MATCH | Stairs | Plank [recall] | hammer | piece `stairs` | |
| MATCH | Roof | Plank + Palm Leaf [recall] | hammer | piece `roof` | |
| CHEAP | Roof Corner / Slope variants | Plank + Palm Leaf [recall] | hammer | - | New `PIECES` rows + models |
| MATCH | Ladder | Plank + Rope [recall] | hammer | piece `ladder` | |
| MATCH | Hatch | Plank + Hinge based [recall] | hammer | piece `hatch` | |
| MATCH | Railing / Fence | Plank + Rope [recall] | hammer | piece `railing` | |
| MATCH | Gate | Plank + Hinge based [recall] | hammer | piece `gate` | |
| CHEAP | Arch wall | Plank [recall] | hammer | - | New `PIECES` row + model |
| CHEAP | Glass window / glass ceiling | Glass + Plank [recall, verify] | hammer | - | New `PIECES` row |
| MATCH | Foundation Armor | Scrap / Metal Ingot based [recall] | hand | `armor` | Ours 1 ingot + 2 nail |

## 11. Decorations and story items

| Status | Raft item | Raft recipe | Where | Ours (id) | Notes |
|---|---|---|---|---|---|
| MATCH | Sign | Plank based | hand | `sign` | |
| MATCH | Rug | Palm Leaf / Wool based [recall] | hand | `rug` | |
| MATCH | Flower Pot | Plank + Flower | hand | `flowerbox` | |
| MATCH | Paint (several colours) | Flower petals + water-type base [recall] | hand | `paint_seafoam` .. `paint_pebble` | Our 5 colours use our own recipes and names |
| MATCH | Lantern | Scrap + Plank based [recall] | hand | `lantern` | |
| CHEAP | Ceiling Light / Wall Light | Glass + Copper based [recall] | research | - | Decor rows for `power.js` lights |
| MATCH | Shark Head Trophy | Shark Head | hand | `trophystand` | Ours is a generic trophy stand |
| MATCH | Tic-Tac-Toe | Plank based [src: 1.0 changelog] | hand | `gametable` | Ours is a game table |
| CHEAP | Honk Horn | Scrap + Plastic based [src: 1.0 changelog] | research | - | Placed decor + one sound |
| CHEAP | Foundation Counter | Plank based [src: 1.0 changelog] | hand | - | Decor that shows the tile count |
| CHEAP | Vending-machine decorations (28) | Scrap based [src: 1.0 changelog] | hand | - | One decor kind with a style index, like flags |
| SYSTEM | Blueprints (Engine, Steering Wheel, Machete, ...) | story pickups [src] | blueprint | - | Story islands + blueprint unlock type in `progression.js` |
| SYSTEM | Notes / logs | story pickups | - | - | We have notes in the logbook (`logbook.js`), not as bag items |
| SYSTEM | Keycards and keys (Vasagatan, Balboa, Caravan Town, Tangaroa, Varuna Point, Temperance, Utopia) | story [src] | - | - | Story locations |
| SYSTEM | Zipline Parts | story, Caravan Town [src] | - | - | Story locations |

## 12. Ours-only (in Little Raft, not in Raft)

| Status | Ours (id) | Name | Recipe | Notes |
|---|---|---|---|---|
| OURS | `research` | Tinker's Desk | 6 wood + 2 scrap | Duplicates `researchtable`; see section 13 |
| OURS | `palm` | Palm Planter | 2 wood + 3 leaf | Raft grows palms in crop plots |
| OURS | `rainbarrel` | Rain Barrel | 3 wood + 2 leaf + 1 plastic | Closest Raft item is the Water Tank |
| OURS | `bench` | Bench | 3 wood | |
| OURS | `water` | Cup of Fresh Water (legacy) | - | Loads as `freshcup` (LOAD_RENAMES) |
| OURS | `oldboot` | Old Boot | junk | Recycler input |
| OURS | `tincan` | Tin Can | junk | Recycler input |
| OURS | `seajar` | Sea Jar | junk | Recycler input |
| OURS | `wax` | Beeswax | beehive | |
| OURS | `honeyfish` | Honey Glazed Fish | 1 grilled fish + 1 honey | |
| OURS | `berrycup` | Berry Smoothie | juicer: freshcup + 2 berries | |
| OURS | `coconutcup` | Coconut Smoothie | juicer: freshcup + 2 coconut | |
| OURS | `mixcup` | Island Smoothie | juicer: freshcup + berry + coconut | |
| OURS | `meal_chowder` | Tide Chowder | cookpot: fish + freshcup + seaweed | |
| OURS | `meal_omelette` | Puff Omelette | cookpot: leaf + 2 puff egg | |
| OURS | `meal_broth` | Kelp Broth | cookpot: freshcup + 2 seaweed | |
| OURS | `meal_fishbowl` | Smoky Fish Bowl | cookpot: grilled fish + leaf + seed | |
| OURS | `meal_custard` | Coconut Custard | cookpot: freshcup + puff egg + seed | |
| OURS | `meal_stew` | Captain's Stew | cookpot: grilled fish + puff egg + seaweed | |
| OURS | `kiln` | Seaside Kiln | 4 stone + 4 clay + 1 scrap | Second smelter (ore, sand, clay) |
| OURS | `glasslamp` | Glass Lantern | 2 glass + 1 ingot + 1 wood | |
| OURS | `sinker` | Line Sinker | 1 ingot + 1 stone | |
| OURS | `stormshard` | Storm Shard | storm drop | |
| OURS | `stormrod` | Lightning Rod | 2 ingot + 1 copper + 2 wood | |
| OURS | `stormlamp` | Storm Lantern | 2 shard + 1 glass + 1 ingot | |
| OURS | `stormglass` | Storm Glass | 1 shard + 1 glass | |
| OURS | `nestbox` | Nest Box | 3 wood + 2 leaf + 1 rope | Puffhen home |
| OURS | `cushion` | Feather Cushion | 3 feather + 2 leaf | |
| OURS | `goatpen` | Hay Corner | 4 wood + 3 leaf + 1 rope | Loosely Raft's Grass Plot |
| OURS | `pennant` | Wind Pennant | 2 wood + 2 leaf + 1 rope | |
| OURS | `fern` | Hanging Fern Post | 2 wood + 2 rope + 3 leaf | |
| OURS | `chime` | Shell Chime | 1 wood + 2 scrap + 2 rope | |
| OURS | `hammock` | Rope Hammock | 4 wood + 4 rope + 2 leaf | |
| OURS | `pots` | Clay Pot Trio | 3 clay + 2 leaf | |
| OURS | `goggles` | Seaglass Goggles | 2 glass + 1 rope + 1 leaf | Diving gear |
| OURS | `scraper` | Tide Scraper | 1 ingot + 2 scrap + 1 wood | Diving gear |
| OURS | `shell` | Bright Shell | islands | Trader currency |
| OURS | `shellwreath` | Shell Wreath | 3 shell + 2 rope + 2 leaf | Trader plan |
| OURS | `glassfloat` | Glass Float | trader | |
| OURS | `courseflag` | Start Flag | buoy course | |
| OURS | `scoreboard` | Race Scoreboard | 3 wood + 1 scrap | |
| OURS | `driftboard` | Driftboard | 6 wood + 3 plastic + 2 rope | Paddleboard |
| OURS | `flagpole` | Flagpole | 4 wood + 2 rope + 2 leaf | Custom flags |
| OURS | `spyglass` | Spyglass | 3 wood + 1 rope + 2 plastic + 1 scrap | Early binoculars |
| OURS | `drum` | Tide Drum | 3 wood + 2 leaf + 1 rope | Instrument |
| OURS | `pipes` | Reed Pipes | 3 plastic + 1 rope | Instrument (not Raft's water pipe) |
| OURS | `bells` | Bell Bars | 2 wood + 3 scrap + 2 nail | Instrument |
| OURS | `camera` | Little Camera | 1 glass + 2 plastic + 2 scrap + 1 rope | Photo album |
| OURS | `glidepost` | Glide Post | 6 wood + 3 rope + 2 nail | Zipline anchor post |
| OURS | `glidestep` | Low Glide Post | 4 wood + 2 rope + 1 nail | Zipline anchor post |
| OURS | `candle` | Beeswax Candle | 2 wax + 1 rope | |
| OURS | `perch` | Gull Perch | 3 wood + 2 rope + 1 leaf | |
| OURS | `fishtrap` | Fish Trap | 3 wood + 3 rope + 2 leaf | |
| OURS | `shelf` | Display Shelf | 4 wood + 2 nail | |
| OURS | `taskboard` | Task Board | 3 wood + 1 leaf | |
| OURS | `photoframe` | Photo Frame | 3 wood + 1 glass + 1 nail | |
| OURS | `maptable` | Map Table | 6 wood + 3 rope + 2 nail + 1 copper | |
| OURS | `stringlights` | String Lights | 2 glass + 1 copper + 2 rope | Power lights |
| OURS | `lamppost` | Lamp Post | 3 wood + 1 glass + 1 copper + 2 nail | Power lights |

## 13. Recommended renames and retunes

Rule for all of these: **change the display `name` and the `recipe`, never the id.** An id change breaks old saves
in several places (section 14). If an id must change, add the old id to `LEGACY_ALIASES` in `dist/items.js` and see
section 14 for the stores that do not go through it.

1. **Merge `research` (Tinker's Desk, `content-items.js`) into `researchtable`.** Two research stations with
   different costs. Stop offering the `research` recipe and leave the id loadable so placed desks keep working;
   do not alias it (it is also a decor type in `CONTENT_DECOR`, so placed desks would need a decor rewrite).
2. **`metalhook`**: Raft's second hook is a cheap scrap hook (3 scrap + 2 plank + 2 rope). Ours costs 6 ingot + 2
   bolt and arrives about minute 85 by design (`docs/cloud/progression-design.md`). Either add a cheap middle tier
   or keep ours as the titanium-like third tier. If a new `scraphook` id is added, drop the `scraphook` and
   `scrap_hook` entries from `LEGACY_ALIASES` first (they map to `metalhook` today).
3. **`brick`**: split into a hand-crafted Wet Brick (1 sand + 1 clay) and keep `brick` as the fired one. Keep the id
   `brick` for the dry brick so the smelter recipe and old saves are untouched.
4. **Navigation / radio chain needs Circuit Board**: once `vinegoo` and `circuitboard` exist, retune
   `receiver` (8 wood + 6 plastic + 2 circuit + 1 hinge), `antenna` (4 scrap + 1 circuit + 1 bolt), `motor`
   (20 wood + 5 ingot + 5 rope + 1 circuit), `wheel` (10 scrap + 4 ingot + 4 rope + 2 bolt), `juicer`
   (6 wood + 6 plastic + 1 bolt + 4 vine goo + 1 circuit). Ours are all early-game wood/scrap costs today, so this
   moves them later; check `PROGRESSION_PLAN` timings before applying.
5. **`grill`**: 3 rope -> 6 rope [src]. **Applied** (items pass).
6. **`scarecrow`**: 3 wood + 4 leaf + 2 rope + 1 plastic -> 5 wood + 3 leaf + 3 nail + 3 plastic [src]. **Applied**
   (items pass; the unlock is now `discover('nail')`).
7. **`battery`**: 2 copper + 1 ingot + 2 plastic -> 1 copper + 6 plastic [src, single source, verify].
8. **`airjug` / `fins`**: Raft costs are much higher and need Vine Goo + Empty Bottle; retune after those exist.
9. **`cookpot`**: Raft's includes metal ingots; ours is clay/stone. Fine as a deliberate early cosy pot.
10. **`nail` / `bolt` / `hinge` yields**: ours give 3 / 2 / 2 per craft; Raft is closer to 2 / 1 / 1 [recall]. Verify
    before changing; the barrel economy in `items.js` is tuned around ours.
11. **Display names** (optional, plain English only): `axe` "Stone Axe" -> "Axe" if a Metal Axe tier lands;
    `berries` "Island Berries" is fine. Keep "Little Motor", "Seashell Finder", "Breath Jug" etc: our names are ours
    on purpose (`docs/RAFT-REFERENCE.md` rule on names).

## 14. How saves store item ids (for renames)

All item ids are plain strings in JSON in `localStorage`. There is no version-keyed id table, so a renamed id
must be mapped in each store below.

| Store | Key / slice | Shape | What happens to an unknown id |
|---|---|---|---|
| Bags (host and guest) | `little-raft-v1` -> `hostInventory`, `guestInventory` | `{slots:[28 x {kind, count, durability?, id?} or null], selected}` | Loaded through `migrateSnapshot(s, ITEM_INFO)` (`dist/items.js`): `LOAD_RENAMES` first, then exact id, then lower-case id, then `LEGACY_ALIASES`. Unknown kinds are **dropped**. `game.js` `snapBag` falls back to `Bag.salvage` |
| Placed decor and stations | `little-raft-v1` -> `world.decor` | `[{type, x, z, rot?}]` | `cleanDecor` (`dist/placement.js`) keeps only `types.includes(type)` (`DECOR_TYPES` in `game.js`). **No alias step**: an unknown type is dropped, and its per-tile state (crops, purifiers, motors) with it |
| Building pieces | `world.pieces` | `{t, i, j, l, r, o?}` with `t` from `PIECE_ORDER` (`dist/building-pieces.js`) | Dropped by `cleanPieces`; ids are appended only, never renamed |
| Content slices | `world.ext.*` (crates, drop boxes, kiln, cookpot, engine, power, zipline, flags...) | each slice keeps item kinds as strings | Each module checks `hasOwn(ITEM_INFO, kind)` (`storage-research.js`, `drop-box-core.js`, `decor-pickup.js`): unknown kinds dropped, no alias step |
| Progression | `littleRaft.progression.v1` | `{v:1, host, guest, stations, barrelLuck}`; each player `{discovered, researched, learned, stations}` id arrays | `Progression` (`dist/progression.js`) filters each list to ids in `ITEMS`. **No alias step**: a renamed id loses research and learned recipes |
| Fishing journal and grills | `little-raft-fc-v1` | `{v:1, journal, grills}` | Grill slots hold `fish` / cooked kinds |
| Co-op | host snapshots | same world and bag shapes | Same `cleanWorld` + `migrateSnapshot` path as a load |

So a safe id rename means: add the old id to `LEGACY_ALIASES` (bags), map it in `cleanDecor` or before
`cleanWorld` (decor), in `Progression`'s constructor (research), and in every `world.ext` slice that stores kinds.
Changing only `name` needs none of that.

## 15. Where item data lives

- `dist/items.js`: the main catalogue (`ITEMS`: id, name, category, stack, tool, durability, actsAs, placeable,
  recipe with station/time/fuel, unlock, tip), plus `REPAIRS`, `FUEL_VALUE`, `RECYCLE_YIELDS` / `EXTRA_RECIPES`,
  `BARREL_LOOT`, `BARREL_PITY`, `SPEAR_DAMAGE`, `LEGACY_ALIASES`, `LOAD_RENAMES`, `migrateSnapshot`, `PROGRESSION_PLAN`.
- `dist/inventory-state.js`: `ITEM_INFO` (every bag kind; legacy rows, then `CONTENT_ITEMS`, lane kinds such as
  cups, receiver, purifier, then `infoTable()` from items.js wins) and `RECIPES` (hand recipes; `recipeTable()` wins).
- `dist/content-items.js`: `CONTENT_ITEMS`, `CONTENT_RECIPES`, `CONTENT_DECOR`, `CONTENT_BLOCK_RADIUS` (decor, paints,
  diving gear, meals, storm items, animals' items).
- `dist/items.js` also holds the Raft crafting tabs (`CRAFT_TABS`, `craftTabOf(id)`, `ITEMS[id].tab`) and
  `ITEM_TEXT_EXTRA` (craft-book text for kinds newer than the craft book).
- `dist/craft-book.js`: crafting UI categories (`CATEGORIES`: tools, materials, survival, building), `ITEM_TEXT`,
  `categoryOf`, `ITEM_SOURCE`.
- `dist/building-pieces.js`: hammer pieces (`PIECES`, `PIECE_ORDER`).
- Station tables: `dist/cookpot-core.js` (`RECIPES`, `MEALS`, `INGREDIENTS`), `dist/juicer.js` (mixes), `dist/kiln-core.js`
  (`SMELT`), `dist/trader-core.js` (offers), `dist/diving-gear-core.js` (`GEAR`), `dist/fish-species.js` (species).
- Icons and models: `dist/item-svg.js`, `dist/icon-models.js`, `dist/item-icons.js`, `dist/held-items.js`,
  `dist/held-models.js`, `dist/icons.svg`. Tooltips: `dist/item-tooltips.js`.
- Save code: `dist/game.js` (`SAVE = 'little-raft-v1'`, `cleanWorld`, `DECOR_TYPES`), `dist/placement.js`
  (`cleanDecor`), `dist/progression.js`, `dist/progression-hooks.js` (`littleRaft.progression.v1`).

## 16. Web sources used this session

- Raft wiki style guide category map: https://raft.fandom.com/wiki/Raft_Wiki:Style_Guide/Category_Map (search snippet)
- Engine / Steering Wheel recipes: https://whatifgaming.com/?p=64480, https://progameguides.com/raft/how-to-turn-your-raft/
- Receiver, Antenna, Battery, Circuit Board: https://segmentnext.com/raft-receiver-battery-antenna, https://gamertweak.com/antenna-setup-raft, https://gameranx.com/features/id/326010/article/raft-how-to-make-vine-goo-circuit-boards-crafting-guide/
- Equipment (Oxygen Bottle, Flippers, Backpack, Leather armor, Headlight): https://www.mejoress.com/en/raft-recipes-cooking-crafting/ (search snippet)
- Cooking pot: https://progameguides.com/raft/raft-cooking-pot-recipes/, https://segmentnext.com/raft-cooking-pot, https://bloxodes.com/wiki/raft/recipes
- Juicer, Simple Grill, Scarecrow: https://www.pcgamesn.com/raft/juicer-recipes, https://gameranx.com/features/id/322040/article/raft-how-to-craft-every-useful-recipe-cooking-pot-juicer-guide/
- Smelter, Wet Brick, Electric Smelter: https://raft.fandom.com/wiki/Smelter?oldid=4438, https://screenrant.com/raft-how-to-craft-use-electric-smelter-guide/
- 1.0 additions: https://raft.fandom.com/wiki/Version_1.0, https://www.touchtapplay.com/everything-new-added-with-raft-the-final-chapter-update/, https://www.thegamer.com/raft-biggest-changes-from-early-access-full-release/

## 17. Follow-ups

Item lane (data ready once the craft book can describe non-hand kinds, see section 0):

- Vine Goo (smelter, 1 seaweed) -> Circuit Board (hand) -> the navigation retunes in section 13 item 4, then
  `airjug` / `fins` (section 13 item 8) and Empty Bottle.
- Titanium Ore (seafloor + barrels) -> Titanium Ingot (smelter) -> Titanium Hook, Axe and Sword.
- Fruit (Watermelon, Pineapple, Mango, Banana), Cave Mushroom, Sea Vine and Silver Algae as island or seafloor drops,
  then the juicer mixes (Fruit Juice, Coconut Beat, Silver Smoothie) and cooking pot meals (Simple Fish Stew,
  Vegetable Soup, Shark Dinner, Mushroom Omelette). `cookpot-core.js` and `juicer.js` take them as data, but each
  output kind needs an `ITEM_SOURCE` row.
- Battery retune (1 copper + 6 plastic) is single source: verify first. Nail, bolt and hinge yields: verify first.

Code (small, outside the item files): a second fishing rod tier (raw `'fishingrod'` checks in `game.js` and
`fishing-cooking.js`), Large Storage (`storage-research.js` decor type), Medium and Large Crop Plot (`crops.js` slot
count per plot type), Canteen (sip counter), Anchor, Compass, Honk Horn, Foundation Counter and vending decor (placed
decor with behaviour), Advanced Grill and Purifier (station speed tier), Door and roof variants (hammer pieces), and
the Headlamp as a deck light at night.

SYSTEM rows (sections 2 to 11) are unchanged: llamas and wool, hostile animals and meat, bait, bow and arrows, health,
armor, backpack slots, pipes and biofuel, the electric stations, story blueprints and keys.
