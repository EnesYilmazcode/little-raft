# Raft fidelity research, round 3: seagulls, bed, station fuel, paddle

The wiki hosts were DNS-blocked, so these numbers come from search summaries of raft.fandom, gamepedia, segmentnext, techraptor, gamerant and Steam. Lines marked [G] are our own tuning.

## Seagulls and crops
- A gull dives at a crop, or at a scarecrow in range, every 4 min. Once landed it pecks for 15 s, then destroys the crop: the slot goes back to bare soil and the plot stays.
- A player within 2.25 m scares it off, which resets its timer. Gull HP is 10: a wooden spear kills in 2 hits, and any hit while it is landed also scares it.
- A dead gull drops 1-3 feathers and 1 raw drumstick [G].
- Plots inside a fully enclosed room (walls, roof and floor above) are safe.
- One active raider per 1-2 planted plots, at most 3 [G].
- Scarecrow: 5 planks, 3 leaves, 3 nails, 3 plastic. It protects crops within 6 m and gulls target it instead. It has 3 HP and each successful attack costs 1 (arm, arm, then head).

## Simple Bed
- Cost: 10 leaves, 6 planks, 4 plastic, 3 nails. It takes 1x2 tiles and rotates with R [G].
- Sleep only from 20:00 to 04:00; otherwise "You can only sleep at night".
- Sleeping fades out and skips to 04:00. It costs 20% hunger and 20% thirst and restores 40% health.
- In co-op, everyone must be in bed ("Waiting for others (1/2)") [G].
- The bed is a respawn point. Respawning there gives 25% health and 50% hunger and thirst.

## Purifier and grill fuel
- Planks are the only fuel. One plank burns for 50 s. The purifier holds 3 planks and the grill holds 2.
- The purifier does one salt cup per cycle in 30 s. The grill cooks one item at a time in 30-50 s.
- Without fuel, progress pauses [G]. Fuel burns only while something is processing [G].
- Hold a plank and press E to add fuel; the prompt reads "Add fuel (2/3)".

## Paddle and anchors
- Paddle: 4 planks, 6 plastic, 2 rope. Hold LMB at the edge; each stroke pushes the raft toward the camera's facing, about +0.4 m/s decaying, capped at 1.5 m/s [G]. About 100 strokes of durability [G].
- Throwable anchor: 2 planks, 4 rope, 4 stones, single use.
- Stationary anchor: 10 planks, 6 rope, 3 ingots, 1 hinge; toggles raised or lowered.

## Hook and controls compared with ours
- In Raft the plastic hook lasts about 38-40 hooked items, then BREAKS, and you craft a new one. Ours loses 2 per cast, never breaks, R repairs it, and range shrinks with wear (16 + dur*0.16 m). Gap: large.
- Reel: Raft feels like about 3-4 m/s, in pulled steps [G]. Ours is a constant 8 m/s.
- Charge feedback: Raft draws a thick cream arc around the crosshair, about 7% of screen height. Ours is a hairline ring.
- Raft has Q to drop an item; we have no drop binding. R in Raft only rotates; ours also repairs the hook.
- Rope: Raft's is thick tan (#726553) from a coil at the hip. Ours is a thin white line.
- The crafting UI layout differs: Raft uses a vertical category rail, about 12 recipe rows and a green/red CRAFT button.

## Round 3 picks
1. Seagull raids and a scarecrow.
2. Simple bed: sleep and a respawn point.
3. Hook fidelity: wear per item, breaks at 0, slower reel, a bold charge arc, Q to drop.
