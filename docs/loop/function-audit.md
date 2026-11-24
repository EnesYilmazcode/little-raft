# Little Raft function audit (branch claude/raft-feedback-all @ 81e6c9aa)

Player complaint: "a lot of the survival things is just decoration ... no net catcher ... no bed ... can't even craft."

Short version: almost everything in the craft list really does something (83 of 110 craftables have full gameplay logic,
17 more have a small cosmetic function, only 10 are pure decoration), and both the Collection Net and the Simple Bed exist and
work end-to-end (verified headless). The complaint comes from **how a fresh game presents crafting**: you start with only a hook,
the first look at the craft panel is 57 rows of which 0 are craftable and 45 are red "Locked: Study it first at a Tinker's Desk",
while the Net is hidden outright and the Bed, Purifier and Cup sit behind a second, unexplained research station.

Legend: works = yes (real gameplay logic) / partial (small cosmetic function: light, sit, display, text) / decor (model only, at most E to rotate).
"in Raft?" names the real Raft equivalent or says invented. Reachability is for a brand-new save (empty localStorage).
Costs from dist/inventory-state.js RECIPES (items.js costs win for its ids).

Totals: 110 rows. works: 83 yes, 17 partial, 10 decor. 31 invented (no Raft equivalent).
45 recipes visible-but-locked behind the Tinker's Desk; ~44 items.js recipes hidden from the list until their discover/research gate
(only the 3 nearest hand-recipe goals are shown greyed, progression-hooks.js:259-265).

Decor-only (10): rug, pennant, fern, chime, hammock, pots (decor-pack.js, E rotates), stormlamp (storm-model.js:144, mesh only),
shellwreath + glassfloat (trader.js:197-198, model only), trophystand (display.js "purely cosmetic").

## Item table

| item id | name | in Raft? | works? | reachable in new game? | cost | notes |
|---|---|---|---|---|---|---|
| rope | Rope | Rope | yes | yes, visible at start | 2 leaf | ingredient; craft verified in probe (2 leaf -> 1) |
| hook | Hook | Plastic Hook | yes | yes, visible at start | 1 wood, 2 plastic | starter tool; game.js collect/hook loop |
| hammer | Hammer | Building Hammer | yes | yes, visible at start | 4 wood, 2 rope | floors 2 wood + 2 plastic (game.js build floor) |
| fishingrod | Fishing Rod | Fishing Rod | yes | HIDDEN until you own rope (then visible) | 6 wood, 8 rope | fishing-v2.js / fishing-cooking.js |
| sail | Sail | Sail | yes | HIDDEN until you own leaf+scrap (then visible) | 10 wood, 20 leaf, 3 scrap | sailing-core.js/sailing-world.js; probe crafted it |
| palm | Palm Planter | ~ Plant pot / crop plot | yes | yes, visible at start | 2 wood, 3 leaf | farming.js grows palms, harvest leaves; watering.js |
| lantern | Lantern | Lantern | partial | HIDDEN until you own scrap (then visible) | 2 wood, 2 scrap | night light pool only (daynight.js:271 LANTERN_PARTS) |
| net | Collection Net | Item Net | yes | HIDDEN until you own nail (then visible) | 6 wood, 8 rope, 2 nail | nets.js: catches drifting debris (cap 10), E empties loot into bag; probe: caught 5, "E Empty net (5)" gave wood/leaf/plastic |
| bench | Bench | ~ chairs/benches | partial | yes, visible at start | 3 wood | sit on it (sitting.js) |
| crate | Crate | Small Storage | yes | HIDDEN until you own scrap (then visible) | 4 wood, 1 scrap | 12-slot chest (storage-research.js CHEST_SLOTS) |
| research | Tinker’s Desk | Research Table (2nd copy) | yes | yes, visible at start | 6 wood, 2 scrap | content "Tinker's Desk": studying kinds unlocks the 45 content recipes (storage-research.js:40-56, 213-222). Duplicates items.js researchtable |
| motor | Little Motor | Engine | yes | visible but LOCKED; build Tinker's Desk + study wood+scrap+rope | 6 wood, 4 scrap, 2 rope | engine.js pushes raft along sail heading while fuelled |
| wheel | Steering Wheel | Steering Wheel | yes | visible but LOCKED; build Tinker's Desk + study wood+rope | 5 wood, 2 rope | engine.js second steer point + motor toggle |
| bed | Simple Bed | Simple Bed | yes | visible but LOCKED; build Tinker's Desk + study leaf+wood+plastic+nail | 10 leaf, 6 wood, 4 plastic, 3 nail | sleep.js: placing sets home; E at night sleeps (+40hp -20 food/water); faint respawn at bed 25/50/50 (BED_RESPAWN sleep.js:17). Probe verified home + respawn 25/50/50 + daytime refusal |
| brush | Paint Brush | Paint brush | yes | visible but LOCKED; build Tinker's Desk + study wood+rope | 2 wood, 1 rope | paint.js colours pieces/tiles |
| paint_seafoam | Seafoam Paint | Paint | yes | visible but LOCKED; build Tinker's Desk + study leaf+sand | 1 leaf, 1 sand | paint pot for brush |
| paint_coral | Coral Paint | Paint | yes | visible but LOCKED; build Tinker's Desk + study clay | 2 clay | paint pot |
| paint_sunshell | Sunshell Paint | Paint | yes | visible but LOCKED; build Tinker's Desk + study sand+seed | 1 sand, 1 seed | paint pot |
| paint_lagoon | Lagoon Paint | Paint | yes | visible but LOCKED; build Tinker's Desk + study plastic+leaf | 1 plastic, 1 leaf | paint pot |
| paint_pebble | Pebble Paint | Paint | yes | visible but LOCKED; build Tinker's Desk + study stone+clay | 1 stone, 1 clay | paint pot |
| rug | Woven Deck Mat | ~ Rug decoration | decor | visible but LOCKED; build Tinker's Desk + study leaf+rope | 4 leaf, 2 rope | decor-pack.js: E rotates only |
| pennant | Wind Pennant | invented | decor | visible but LOCKED; build Tinker's Desk + study wood+leaf+rope | 2 wood, 2 leaf, 1 rope | decor-pack.js: E rotates only |
| fern | Hanging Fern Post | ~ hanging plant | decor | visible but LOCKED; build Tinker's Desk + study wood+rope+leaf | 2 wood, 2 rope, 3 leaf | decor-pack.js: E rotates only |
| chime | Shell Chime | invented | decor | visible but LOCKED; build Tinker's Desk + study wood+scrap+rope | 1 wood, 2 scrap, 2 rope | decor-pack.js: rotate + chime sound |
| hammock | Rope Hammock | invented (as decor) | decor | visible but LOCKED; build Tinker's Desk + study wood+rope+leaf | 4 wood, 4 rope, 2 leaf | decor-pack.js: rotate only; not a bed (sleep.js only accepts bed) |
| pots | Clay Pot Trio | ~ plant pots | decor | visible but LOCKED; build Tinker's Desk + study clay+leaf | 3 clay, 2 leaf | decor-pack.js: rotate only |
| sign | Signboard | Sign | partial | visible but LOCKED; build Tinker's Desk + study wood+rope | 3 wood, 1 rope | writable 3-line text (signs-core.js) |
| kiln | Seaside Kiln | invented (dup of Smelter) | yes | visible but LOCKED; build Tinker's Desk + study stone+clay+scrap | 4 stone, 4 clay, 1 scrap | kiln.js smelts ore/sand/clay: same outputs as items.js smelter + grill(brick) |
| glasslamp | Glass Lantern | invented | partial | visible but LOCKED; build Tinker's Desk + study glass+metalingot+wood | 2 glass, 1 metalingot, 1 wood | light only (kiln-model lantern parts) |
| sinker | Line Sinker | invented | yes | visible but LOCKED; build Tinker's Desk + study metalingot+stone | 1 metalingot, 1 stone | in bag halves hook wear (game.js wearHook) |
| stormrod | Lightning Rod | invented | yes | visible but LOCKED; build Tinker's Desk + study metalingot+copperingot+wood | 2 metalingot, 1 copperingot, 2 wood | storm.js: catches lightning -> Storm Shards |
| stormlamp | Storm Lantern | invented | decor | visible but LOCKED; build Tinker's Desk + study stormshard+glass+metalingot | 2 stormshard, 1 glass, 1 metalingot | storm-model.js:144 buildLamp: mesh only, no light pool, no logic |
| stormglass | Storm Glass | invented | partial | visible but LOCKED; build Tinker's Desk + study stormshard+glass | 1 stormshard, 1 glass | storm.js:376 shows storm forecast prompt |
| glasscups | Glass Cups | Cup (alt recipe) | yes | visible but LOCKED; build Tinker's Desk + study glass | 1 glass | alt recipe -> 3 Cups |
| brickplanter | Brick Planters | invented alt recipe | yes | visible but LOCKED; build Tinker's Desk + study brick+leaf | 3 brick, 2 leaf | alt recipe -> 2 Palm Planters |
| nestbox | Nest Box | ~ Clucker via Animal Trap | yes | yes, visible at start | 3 wood, 2 leaf, 1 rope | animals.js: Puffhen lays eggs/feathers |
| cushion | Feather Cushion | invented | partial | visible but LOCKED; build Tinker's Desk + study feather+leaf | 3 feather, 2 leaf | seat (sitting.js) |
| egglamp | Egg Lantern | invented alt recipe | partial | visible but LOCKED; build Tinker's Desk + study puffegg+wood | 1 puffegg, 2 wood | alt recipe -> Lantern |
| goatpen | Hay Corner | ~ Goat + feeder | yes | visible but LOCKED; build Tinker's Desk + study wood+leaf+rope | 4 wood, 3 leaf, 1 rope | animals.js Bramblegoat, milk with pail |
| bucket | Wooden Pail | Bucket | yes | visible but LOCKED; build Tinker's Desk + study wood+rope | 3 wood, 1 rope | milk goat (animals.js) |
| fins | Puff-Feather Fins | Flippers | yes | visible but LOCKED; build Tinker's Desk + study feather+plastic+rope | 3 feather, 2 plastic, 1 rope | diving-gear-core.js swim mult |
| airjug | Breath Jug | Oxygen bottle | yes | visible but LOCKED; build Tinker's Desk + study plastic+metalingot+rope | 3 plastic, 1 metalingot, 1 rope | diving-gear-core.js oxygen mult |
| goggles | Seaglass Goggles | invented | yes | visible but LOCKED; build Tinker's Desk + study glass+rope+leaf | 2 glass, 1 rope, 1 leaf | diving-gear fog mult |
| scraper | Tide Scraper | invented | yes | visible but LOCKED; build Tinker's Desk + study metalingot+scrap+wood | 1 metalingot, 2 scrap, 1 wood | diving-gear gather mult |
| shellwreath | Shell Wreath | invented | decor | locked: buy plan at trading post | 3 shell, 2 rope, 2 leaf | trader.js:197 model only; plan bought at trading post |
| cookpot | Cooking Pot | Cooking Pot | yes | visible but LOCKED; build Tinker's Desk + study clay+stone+scrap | 3 clay, 2 stone, 1 scrap | cookpot.js meals with timed buffs |
| bowl | Driftwood Bowl | Empty bowl | yes | visible but LOCKED; build Tinker's Desk + study wood | 1 wood | cookpot servings |
| coursekit | Course Kit | invented | yes | visible but LOCKED; build Tinker's Desk + study plastic+rope+wood | 4 plastic, 3 rope, 3 wood | buoycourse.js minigame (makes Start Flag) |
| scoreboard | Race Scoreboard | invented | partial | visible but LOCKED; build Tinker's Desk + study wood+scrap | 3 wood, 1 scrap | buoycourse.js race scores display |
| gametable | Driftwood Game Table | invented | yes | visible but LOCKED; build Tinker's Desk + study wood+rope+stone | 6 wood, 1 rope, 2 stone | gametable.js board minigames |
| driftboard | Driftboard | invented | yes | visible but LOCKED; build Tinker's Desk + study wood+plastic+rope | 6 wood, 3 plastic, 2 rope | paddleboard.js ride |
| flagpole | Flagpole | ~ Flag | partial | visible but LOCKED; build Tinker's Desk + study wood+rope+leaf | 4 wood, 2 rope, 2 leaf | flags.js custom flag cosmetic |
| receiver | Receiver | Receiver | yes | visible but LOCKED; build Tinker's Desk + study wood+scrap+plastic+rope | 3 wood, 4 scrap, 3 plastic, 2 rope | signal.js navigation to signal cache |
| antenna | Antenna | Antenna | yes | visible but LOCKED; build Tinker's Desk + study wood+scrap+rope | 2 wood, 1 scrap, 1 rope | signal.js (3 needed) |
| cup | Cup | Empty Cup | yes | visible but LOCKED; build Tinker's Desk + study plastic | 4 plastic | fill sea water (fillCup), purify, drink (+40 water) |
| purifier | Water Purifier | Simple Purifier | yes | visible but LOCKED; build Tinker's Desk + study wood+leaf+plastic | 6 wood, 6 leaf, 4 plastic | watering.js: cup + fuel -> fresh water |
| rainbarrel | Rain Barrel | invented (~Water tank) | yes | visible but LOCKED; build Tinker's Desk + study wood+leaf+plastic | 3 wood, 2 leaf, 1 plastic | rain.js collects rain |
| sprinkler | Sprinkler | Sprinkler | yes | visible but LOCKED; build Tinker's Desk + study scrap+plastic+rope | 2 scrap, 2 plastic, 1 rope | rain.js waters planters |
| nail | Nail | Nail | yes | HIDDEN until you own scrap (then visible) | 2 scrap | ingredient (scrap 2 -> 3) |
| bolt | Bolt | Bolt | yes | HIDDEN; research metalingot at Research Table | 1 metalingot, 1 scrap | ingredient |
| hinge | Hinge | Hinge | yes | HIDDEN; research metalingot+nail at Research Table | 1 metalingot, 2 nail | ingredient |
| metalhook | Metal Hook | Metal Hook | yes | HIDDEN; research metalingot+bolt at Research Table | 6 metalingot, 2 bolt, 2 rope, 2 wood | game.js hook tiers |
| spear | Wooden Spear | Wooden Spear | yes | HIDDEN until you own rope (then visible) | 8 wood, 3 rope | spear.js shark |
| metalspear | Metal Spear | Metal Spear | yes | HIDDEN; research metalingot+bolt at Research Table | 6 wood, 2 rope, 2 metalingot, 1 bolt | spear.js |
| paddle | Paddle | Paddle | yes | HIDDEN until you own rope (then visible) | 4 wood, 2 rope, 2 plastic | paddle.js pushes raft |
| axe | Stone Axe | Axe | yes | HIDDEN until you own stone+rope (then visible) | 6 wood, 3 stone, 2 rope | islands.js trees |
| binoculars | Binoculars | Binoculars | yes | HIDDEN; research glass+copperingot at Research Table | 2 glass, 1 copperingot, 2 hinge, 1 bolt | progression-hooks barrel HUD + spyglass zoom |
| spyglass | Spyglass | invented | yes | HIDDEN until you own rope+plastic+scrap (then visible) | 3 wood, 1 rope, 2 plastic, 1 scrap | spyglass.js zoom + labels |
| drum | Tide Drum | ~ Raft instruments | yes | HIDDEN until you own rope (then visible) | 3 wood, 2 leaf, 1 rope | instruments.js |
| pipes | Reed Pipes | ~ Pan flute | yes | HIDDEN until you own rope+plastic (then visible) | 3 plastic, 1 rope | instruments.js |
| bells | Bell Bars | ~ Xylophone | yes | HIDDEN; research nail at Research Table | 2 wood, 3 scrap, 2 nail | instruments.js |
| finder | Seashell Finder | Metal Detector | yes | HIDDEN until you own sand+scrap (then visible) | 4 scrap, 2 wood, 2 rope | treasure.js |
| spade | Little Spade | Shovel | yes | HIDDEN until you own sand (then visible) | 3 wood, 2 scrap | treasure.js dig |
| camera | Little Camera | invented | yes | HIDDEN; research glass at Research Table | 1 glass, 2 plastic, 2 scrap, 1 rope | camera.js photos |
| glidehandle | Glide Handle | Zipline tool | yes | HIDDEN until you own nail (then visible) | 2 wood, 2 rope, 2 scrap | zipline.js |
| honeyfish | Honey Glazed Fish | invented | yes | HIDDEN until you own honey (then visible) | 1 cookedfish, 1 honey | food |
| cropplot | Small Crop Plot | Small Crop Plot | yes | HIDDEN until you own rope (then visible) | 6 wood, 4 rope | crops.js beet/potato |
| flowerbox | Flower Box | ~ Flower pot | yes | HIDDEN until you own flowerseed (then visible) | 2 wood, 1 flowerseed | bees.js feeds beehive |
| beehive | Beehive | Beehive | yes | HIDDEN until you own flowerseed (then visible) | 4 wood, 2 rope, 2 leaf | bees.js honey + wax |
| candle | Beeswax Candle | invented | partial | HIDDEN until you own wax (then visible) | 2 wax, 1 rope | light only |
| perch | Gull Perch | invented | partial | HIDDEN until you own cookedfish (then visible) | 3 wood, 2 rope, 1 leaf | gull.js gull lands on it |
| juicer | Juicer | Juicer | yes | HIDDEN until you own berries (then visible) | 4 wood, 2 scrap, 1 rope | juicer.js smoothies |
| turbine | Wind Turbine | Wind Turbine | yes | HIDDEN; research metalingot+bolt at Research Table | 4 wood, 2 metalingot, 2 bolt, 2 rope | power.js charges battery |
| battery | Battery | Battery | yes | HIDDEN; research copperingot at Research Table | 2 copperingot, 1 metalingot, 2 plastic | power.js |
| stringlights | String Lights | ~ powered lights | partial | HIDDEN; research glass+copperingot at Research Table | 2 glass, 1 copperingot, 2 rope | power.js night glow |
| lamppost | Lamp Post | ~ powered lights | partial | HIDDEN; research glass+copperingot at Research Table | 3 wood, 1 glass, 1 copperingot, 2 nail | power.js night glow |
| fishtrap | Fish Trap | invented | yes | HIDDEN until you own fish (then visible) | 3 wood, 3 rope, 2 leaf | fish-trap.js passive fish |
| shelf | Display Shelf | ~ shelves | partial | HIDDEN until you own nail (then visible) | 4 wood, 2 nail | display.js cosmetic slots |
| trophystand | Trophy Stand | ~ trophy | decor | HIDDEN until you own fish (then visible) | 3 wood, 1 scrap | display.js "purely cosmetic" |
| taskboard | Task Board | invented | partial | yes, visible at start | 3 wood, 1 leaf | tasks.js daily crew tasks |
| photoframe | Photo Frame | invented | partial | HIDDEN; research glass+nail at Research Table | 3 wood, 1 glass, 1 nail | photo-frame.js shows a photo |
| skyrocket | Sky Rocket | Firework | partial | HIDDEN until you own plastic+scrap (then visible) | 2 plastic, 1 leaf, 1 scrap | fireworks.js cosmetic |
| scarecrow | Scarecrow | Scarecrow | yes | HIDDEN until you own rope (then visible) | 3 wood, 4 leaf, 2 rope, 1 plastic | scarecrow.js keeps gulls off planters |
| maptable | Map Table | invented | yes | HIDDEN; research copperingot at Research Table | 6 wood, 3 rope, 2 nail, 1 copperingot | maptable.js pins + sail heading |
| glidepost | Glide Post | Zipline base | yes | HIDDEN until you own nail (then visible) | 6 wood, 3 rope, 2 nail | zipline.js |
| glidestep | Low Glide Post | Zipline base | yes | HIDDEN until you own nail (then visible) | 4 wood, 2 rope, 1 nail | zipline.js |
| armor | Foundation Armor | Foundation Armor | yes | HIDDEN; research metalingot+nail at Research Table | 1 metalingot, 2 nail | armor.js shark never bites tile |
| researchtable | Research Table | Research Table | yes | HIDDEN until you own nail (then visible) | 10 wood, 4 nail, 2 rope | progression.js research() unlocks items.js research recipes |
| grill | Simple Grill | Simple Grill | yes | HIDDEN until you own fish (then visible) | 6 wood, 1 scrap, 3 rope | station panel cooking (progression-hooks + smelter.js StationModel) |
| smelter | Smelter | Smelter | yes | HIDDEN; research clay+stone at Research Table | 6 wood, 10 brick, 7 stone, 6 nail | station: ore->ingot, sand->glass |
| recycler | Sorting Tub | invented | yes | HIDDEN until you own nail (then visible) | 6 wood, 2 rope, 3 nail | Sorting Tub turns junk into materials |
| brick | Brick | Brick (Raft: dried clay) | yes | via grill station panel | 1 clay | grill station |
| metalingot | Metal Ingot | Metal Ingot | yes | via smelter station panel | 1 metalore | smelter |
| copperingot | Copper Ingot | Copper Ingot | yes | via smelter station panel | 1 copperore | smelter |
| glass | Glass | Glass | yes | via smelter station panel | 1 sand | smelter |
| cookedfish | Grilled Fish | Cooked fish | yes | via grill station panel | 1 fish | grill |
| cookedbeet | Grilled Beet | Cooked beet | yes | via grill station panel | 1 beet | grill |
| cookedpotato | Baked Potato | Cooked potato | yes | via grill station panel | 1 potato | grill |
| cookedsharkmeat | Grilled Shark Meat | Cooked shark | yes | via grill station panel | 1 sharkmeat | grill |
| glassfloat | Glass Float | invented | decor | trade-only (trader.js), no recipe | - | trader.js:198 model only |
| anchor | (none) | Anchor | n/a | no item: anchoring is a sail toggle (sailing-core.js:32 anchored) | - | Raft's craftable anchors do not exist as items |


## What blocks crafting in a new game

### Repro (headless, probes/probe_craft.cjs, screenshots in audit-shots/)
1. Empty localStorage, title, New Game. Bag = `[{hook}]` only (game.js:204 newWorld, `new Bag()` is empty apart from the hook).
2. Tab opens the bag. Craft panel shows 4 tabs (Tools, Materials, Survival, Building), header "45 more recipes to discover",
   57 recipe rows: **0 ready**, 12 "missing" (rope 0/2, hook, hammer, bench, palm, taskboard, research desk, nestbox),
   45 red "Locked: Study it first at a Tinker's Desk", plus fishingrod "Craft Rope first", nail "Find Scrap first",
   bolt "Research Metal Ingot at a Research Table", shellwreath "Buy the plan at a trading post"
   (audit-shots/A1-fresh-bag.png, A2-tab-*.png).
3. Not in the list at all: Collection Net, Simple Grill, Research Table, Fishing Rod's siblings (spear, paddle...), Sorting Tub etc.
   (hidden by the progression gate until you own rope/nail/scrap/fish).
4. Select Rope, press the Craft button: button is a greyed hammer icon, nothing happens, no notice (A3-rope-nothing.png).
   With materials (simulated pickups via raftDebug.give or an injected save) rope/nail/hammer/crate/sail/desk craft fine through
   the same button (probe B / probe_function: +1 rope per click, nail +3, net +1, hammer +1, sail +1).
5. Bed / Purifier / Cup / Rain Barrel / Receiver / Antenna / Motor / Wheel: craft button does nothing, detail says
   "Locked: Study it first at a Tinker's Desk", even with every ingredient in the bag (B2-after-bed.png, C1-bed-locked.png).
6. Craft Tinker's Desk (6 wood + 2 scrap), place it, E, study one Plank, Palm Leaf, Plastic, Nail, Scrap
   (each study consumes one item) -> learned: bed, bowl, cup, paint_lagoon, purifier, rainbarrel, scoreboard;
   then Bed, Purifier, Cup, Rain Barrel craft fine (probe_function.out.json steps "after study"..."rainbarrel"; C3/C4 shots).
No console errors or page errors in any run (only swiftshader GL warnings).

### Root causes
1. **Two independent recipe gates, stacked** (game.js:2630 `recipeGate: id => mergeGate(prog?.recipeGate(id), content?.craftLocked(id, ...))`):
   - items.js progression (progression.js, progression-hooks.js:259-265): every locked items.js recipe is **hidden** except the
     3 nearest hand goals (`nextGoals(99).filter(isHand).slice(0,3)`), so the Net (unlock `discover('nail')`, items.js:301),
     Grill (`discover('fish')`, items.js:323), Research Table, Fishing Rod siblings etc. are invisible in a new game.
   - storage-research.js "Tinker's Desk" gate: every RECIPES entry not owned by items.js and not in
     `STARTER = ['rope','hook','hammer','crate','research','nestbox']` (storage-research.js:11) is locked with
     `LOCK_REASON` (storage-research.js:12, isLearned :48, craftLocked :392-395; ownership wired at game.js:508).
     That is 45 recipes including the core Raft survival kit: **Simple Bed, Water Purifier, Cup, Rain Barrel, Receiver,
     Antenna, Motor, Steering Wheel, Bucket, Cooking Pot**. They show as red locked rows, which reads as "can't craft".
2. **Duplicate research stations with near-identical names**: items.js `researchtable` "Research Table" (items.js:320,
   progression.js research()) vs content `research` "Tinker's Desk" (content-items.js:38/79, storage-research.js; its code and
   model are even called buildResearchTable). Lock texts mix "Research X at a Research Table" and "Study it first at a
   Tinker's Desk"; nothing in onboarding points at the desk.
3. **Thirst makes gate 1b critical**: THIRST_RATE 0.11/s (vitals.js:19) empties water in ~15 min, but Cup + Purifier
   (the only steady fresh-water source) are desk-locked, so a new player who never builds the desk faints from thirst.
4. **Fresh start has nothing to craft with**: only a hook, so every visible row is "missing" or "locked"; the craft button is a
   greyed hammer icon with no text (survival-ui.js craftNow :870-879 returns early on non-ready, denyBtn only shakes).
5. **Testers never saw it**: both gates grandfather any "progressed" save (progression-hooks.js:373-378 LEGACY_RECIPES when
   collected>0/decor/tiles>9; storage-research.js:126-128 isProgressed -> all learned), so old saves unlock everything and
   only a truly new save shows the lock wall.
6. Minor data smell: content-items.js defines `bed` twice in CONTENT_RECIPES (:82 `{wood 6, leaf 4}` then :115
   `{leaf 10, wood 6, plastic 4, nail 3}`; the second wins), same for motor, wheel, brush and the paints.

### Net and Bed status
- **Collection Net exists and works**: recipe 6 wood + 8 rope + 2 nail (items.js:301-302), hangs off a raft edge over water
  (game.js:1331-1336), catches drifting debris up to NET_CAPACITY 10 (nets.js:18, game.js:1779), `E Empty net (n)` puts the loot in
  the bag (game.js emptyNet ~1318-1323). Probe: placed by real click, 5 items caught, E gave wood 2, leaf 3, plastic 1 (D1-net-emptied.png).
  Note the logic is in nets.js, not storage-research.js. Hidden from the craft list until you own a Nail.
- **Simple Bed exists and works**: placing it sets your home (sleep.js:293-297), E at dusk/night sleeps to morning
  (daytime: "Not sleepy yet. Come back after sunset"), passing out respawns you beside it with 25/50/50 (BED_RESPAWN sleep.js:17,
  game.js:739-740). Probe verified home spot + respawn bars 25.4/49.9/49.8 (D2-bed.png).
  But it is locked behind the Tinker's Desk (must study leaf, wood, plastic, nail).

## Probe scripts (all in the scratchpad, run with `node <script> <dist> <shots_dir> > out.json`)
- probes/probe_craft.cjs: phase A fresh New Game panel dump + rope attempt; phase B injected raw materials, crafts rope, nail,
  hammer, net, bed, desk, purifier, cup, sail, receiver, crate, ... through the panel button. Output probes/probe_craft.out.json.
- probes/probe_function.cjs: fresh New Game, raftDebug.give materials, crafts via panel, places net (real aim + click), feeds it,
  places Tinker's Desk, studies 5 kinds through the desk UI, then crafts bed/purifier/cup/rain barrel. Output probes/probe_function.out.json.
- probes/probe_net_bed.cjs: net catch + E empty; bed placement, home spot, daytime sleep refusal, faint -> bed respawn bars.
  Output probes/probe_net_bed.out.json.
- probes/dump-items.mjs, probes/dump-recipes.mjs: node dumps of items.js ITEMS and RECIPES with gate owner (items.json, recipes.json).
- probes/gen_table.cjs: builds the table above from recipes.json + the hand classification.
