# Raft fidelity research, round 2b: stations, tools, inventory

The wiki hosts were DNS-blocked, so these numbers come from search summaries of raft.fandom.com / gamepedia, bloxodes and guides. [?] marks a figure from only one source or one the sources disagree on.

## Stations
- **Simple Grill.** Raft: burns planks, holds 2, 1 plank = 50 s, cooks 1 item at a time. Pause without fuel. Accepts small and medium fish, potato, beet. Catfish, salmon and shark go on the Advanced Grill. Cook time 40 s pomfret, 60 s mackerel (r1). Ours: `cooking.js:22` COOK_TUNING has fuelPerWood 45 s, maxFuel 4, slots 2, cook time 22 + 0.4*cm (~34 s at 30 cm), burns 20 s after it is done (Raft has no burning). The `items.js:173` cook recipe still says fish 15 s and shark 20 s, which is a second, inconsistent timing path. Potato and beet are not on the grill (farming is claimed by another lane, but the grill should accept them).
- **Simple Purifier.** Raft: planks as fuel (1 plank lasts about 50 s). One cup of salt water takes about 1 min and needs about 1 plank [?]. Ours: `watering.js:5` PURIFY_SECONDS = 15 with **no fuel at all**, which makes it the biggest time sink missing from the water loop.
- **Cup.** Raft: empty cup → scoop salt water → purify → drink 40 thirst → empty cup comes back. Ours matches (`vitals.js:26`, cup stack 5 in `inventory-state.js:43`).
- **Food values.** These match r1: mackerel 15/35, pomfret 12.5/20, potato 10/15. Ours: a generic fish gives 12.5 raw and 35 cooked, and shark meat gives 10/30. No species split in FOOD, although fish-species.js exists.

## Islands / trees
- Raft: a palm needs a **Stone Axe** (6 plank, 3 stone, 2 rope; 50 hits). A chopped palm gives 5 planks + 2 palm leaves, sometimes coconuts or a palm seed. A coconut is eaten for a little hunger and a lot of thirst (r1: +5 / +20).
- Ours: `islands-layout.js:185` palms are gathered by hand for 1 wood + 1 leaf per use, NODE_MAX 3, with a seed on the last use. The coconut cluster is only visual (`islands.js:68`). There is **no axe and no coconut item**.

## Diving
- Raft: 33 s of air (17 s when hungry or thirsty, 58 s with an oxygen bottle). Once the air is gone you lose **3.5 HP/s** while drowning.
- Ours: `diving.js:20` OXY_SECONDS 45, REFILL x6. "Friendly: no damage", so at 0 air you just float up (`diving.js:106`).

## Tools / durability (uses)
| Tool | Raft | Ours (items.js) |
|---|---|---|
| Plastic Hook | 40 (older wiki: 38) | 50 (`:140`) |
| Wooden Fishing Rod | **10 catches**, 6 plank + 8 rope | 40 (`:150`), same cost |
| Metal Fishing Rod | 30 | none |
| Stone Axe | 50 hits, 6 plank / 3 stone / 2 rope | **missing** |
| Metal Axe | 120 | missing |
| Paddle | 4 plank, 6 plastic, 2 rope; has durability | **free action** (`sailing-core.js:190`) |
| Throwable Anchor | 2 plank, 4 rope, 4 stone [?] | anchor is a free toggle on the sail (`sailing-world.js:307`) |
| Stationary Anchor | 10 plank, 6 rope, 3 metal ingot, 1 hinge | none |

## Inventory
- Raft: the base personal inventory plus the hotbar comes to about 30 slots [?]. A backpack adds +10 slots (it was +5 before Update 12). Planks stack to 20, and tools stack to 1.
- Ours: `inventory-state.js:6-7` SLOT_COUNT 28 and HOTBAR_SIZE 10, but `items.js:44` comments HOTBAR_SIZE = 8, which is stale. STACK 20 and tools 1 match Raft. There is no backpack.

## Bed
- Raft: the Simple Bed sets your respawn point, and better beds respawn you with more HP. Sleeping skips the night. The recipe was not confirmed (searches only returned ARK and Minecraft).
- Ours: `sleep.js` handles the night skip. The bed costs 6 wood + 4 leaf (`content-items.js:33`). There is **no respawn at the bed**: `vitals.js` always wakes you at the raft centre.

## Top 4 gaps (ranked by player impact)
1. **Purifier and grill fuel economy (planks = time).** In `watering.js`, give each purifier entry a `fuel` field in seconds. A plank adds 50 s (cap 3 planks, 150 s), PURIFY_SECONDS becomes 60, and the timer only advances while fuel > 0, burning 1 s of fuel per second. Reuse `FUEL_VALUE` from `items.js:241` so a leaf adds 25 s. Add a "Add plank" prompt branch in the `game.js:850` water-aim code and paint the flame in `purifier-model.js` from fuel/cap. Grill: in `cooking.js` COOK_TUNING set fuelPerWood to 50, maxFuel to 2 and burnAfter to Infinity (or keep a long cozy timer), and set cookSeconds so 30 cm takes about 40 s (default 28, perCm 0.4). Change the `items.js:173/179` cook times to match (40 / 60).
2. **Stone Axe + chop palms → 5 planks, 2 leaves, coconut chance.** Add `item('axe','Stone Axe','tool',{tool:true,durability:50,recipe:hand({wood:6,stone:3,rope:2}),unlock:discover('stone')})` to `items.js`, plus `toolRole` 'axe'. In `islands-layout.js:185`, gathering a palm with an axe held takes 3 hits, the last one yields [['wood',5],['leaf',2]] with a coconut at 50% and a seed at 25%, and wears the axe by 1 per hit. Bare-hand gathering stays at 1 leaf per use. Add a `coconut` food {food:5, water:20} through `addFood` in `vitals.js`, then hide the nut instances on the spent palm (already wired in `islands.js:118`).
3. **Diving air 33 s + drowning 3.5 HP/s.** In `diving.js:20`, set OXY_SECONDS to 33, and to 17 when hunger or thirst is 0 (`vitals.js` state is passed in). When `ox.empty`, keep the forced rise but emit `{drown: dt*3.5}` for the vitals lane to apply as damage, then remove the "no damage" comment. The low-oxygen UI already exists (`diving-ui.js`). This turns diving for ore into a real risk.
4. **Tool durability to Raft values + the bed as a respawn point.** In `items.js`: hook 50 → 40, fishingrod 40 → 10 (tip text "about 10 catches"). This makes rod and hook upkeep a constant plank and rope sink as in Raft. In `vitals.js` and `game.js`, the respawn uses the player's last-slept bed tile (`world.ext.sleep` already stores the bed coordinates in `in[role]`, so persist a `spawn[role]` alongside them) and wakes at 100 HP instead of the raft centre. The paddle and throwable anchor items (4 plank / 6 plastic / 2 rope; 2 plank / 4 rope / 4 stone [?]) gating the free `sailing-core` 'paddle' and 'anchor' ops are a smaller follow-up.
