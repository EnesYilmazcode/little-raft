# Fidelity round 4: next 5 gaps (Raft vs Little Raft)

Base read: `origin/claude/raft-master` (+ loop-fidelity-* branch logs). Raft numbers are from web search snippets (fandom/gamepedia mirrors, Gamerant, Gameranx, SegmentNext); the sources disagree in places, and those spots are marked "verify".

## Ranked top 5

### 1. You get left behind: swimming back to a drifting raft (no 50 m teleport)
- **Raft:** the raft keeps drifting unless it is anchored. If you fall off or go ashore, you have to swim, paddle or anchor, or you lose the raft. Nothing teleports you. Gamerant gives these speeds: drift alone ~1.5 m/s, a sail +0.2 m/s, paddling +0.8 m/s, a max of ~3.2 m/s. Forum posts use an abstract scale instead: sail 1.5, engines 2/2.5.
- **Ours:**
  - `dist/player-physics.js:38` sets `MAX_RAFT_DISTANCE: 50`, and `_safety()` at lines 229-235 snaps you back onto the raft.
  - The raft frame never moves (`dist/sailing-world.js` header: "the world drifts past it"), so a swimmer moves with the raft and is never left behind.
  - Only island sand carries you along (`dist/islands.js:255-259`). When an un-anchored raft drifts more than 50 m from the island, the player is teleported off it.
  - Speeds: current `CURRENT_Z 0.30` m/s, `SAIL_SPEED 1.3`, `TARGET_CAP 2.0` (`dist/sailing-core.js:9-28`), `SWIM_SPEED 2.1` (player-physics.js).
- **Sketch:**
  - Each frame, while `physics.swimming` (and not diving-locked), move the player by minus the raft's water-relative velocity. That is the sail, paddle and engine velocity that `stepSailing` already integrates into the `dwx/dwz` deltas in sailing-world.js. The swimmer then drifts with the water, not with the raft. The current moves both equally, so it cancels.
  - Islands already carry a player who stands on sand.
  - Raise `MAX_RAFT_DISTANCE` to a "lost at sea" fallback of about 400 m, and make it a faint ("You lost the raft") through the existing `hurtPlayer` / bed-respawn path instead of a silent snap.
  - Add a HUD edge marker pointing to the raft past 30 m. Reuse the signal edge-marker code.
  - Co-op: the host owns the sailing velocity. Guests apply the same offset locally from the synced `world.sailing`.
  - Tests: a swimmer with the sail up falls behind at the sail speed. A swimmer at anchor does not drift. Standing on sand past 50 m no longer teleports you.

### 2. Story progression: the Receiver leads to a Radio Tower, not a loot buoy
- **Raft:**
  - The Receiver costs 8 planks, 6 plastic, 2 Circuit Boards and 1 Hinge.
  - You need three Antennas, each 1 Bolt, 4 scrap and 1 Circuit Board.
  - A Battery powers the Receiver for about 500 s and is researched with a Copper Ingot.
  - A Circuit Board is 2 copper ingots, 1 Vine Goo and plastic (1, 5 or 8 depending on the source; verify). Vine Goo is seaweed smelted in the Smelter.
  - The Receiver starts tuned to the Radio Tower, the first story location. Its whiteboard note gives the next 4-digit code (Vasagatan) plus the Recycler blueprint. Notes go into a journal. Story locations are far away (hundreds of metres to km).
- **Ours:**
  - Receiver `{wood 3, scrap 4, plastic 3, rope 2}` and Antenna `{wood 2, scrap 1, rope 1}` (`dist/inventory-state.js:84-85`). There is no battery and no circuit board. Copper ingot and seaweed exist, but there is no vine goo.
  - The signal targets are only `cache` buoys at range 45-75 m (`dist/signal.js:5-11` TIERS).
  - There is no destination, no code and no notes chain.
- **Sketch:**
  - Add `vinegoo` (a smelter recipe from seaweed, about 25 s, 1 fuel), `circuitboard` (hand recipe: 2 copper ingots + 1 vine goo + 2 plastic) and `battery` (2 scrap + 1 copper ingot + 4 plastic, 500 s of charge, insert with E) to `items.js`.
  - Retune the receiver and antenna costs to Raft's.
  - In `signal.js`, add a target kind `tower` that spawns once at about 500-800 m along a seeded bearing, using the fixed-position island seabed coordinates from `islands-layout.js`.
  - The tower is a climbable landmark built from a few merged meshes: pontoon, ladder, top room. It holds 3-4 loot crates (circuit board, bolts, hinges), a note written in our own words that goes to `logbook.js`, and a code that unlocks the next frequency (a second landmark, the "drifting liner").
  - The HUD pill shows the bearing and range from the existing tiers. The battery drains only while the receiver is on.
  - Save the state in `world.signal` (`{stage, towerSeed, looted[]}`).

### 3. Constant wind direction (and fixed strength)
- **Raft:** the wind direction never changes (Raft wiki and guides; a few forum posts disagree). A streamer or flag shows it. A sail only helps with or across the wind, never against it. You go upwind with paddles or engines.
- **Ours:**
  - The wind wanders. `WIND_RATE 0.05` rad/s, and a new target is drawn every 70-140 s at ±60° (`WIND_SWING`), clamped to ±100° of +z (`dist/sailing-core.js:13-18, 125-136`).
  - Strength wanders between 0.55 and 1 with a 20 s tau.
  - The downwind-only rule (`cos > 0`, line 91) already matches Raft.
- **Sketch:**
  - Add `SAIL.WIND_FIXED = true`. When it is on, `stepSailing` skips the re-roll, and `windDir` is seeded once per world: `defaultSailing(rng)`, about +z ±30° so it roughly agrees with the current.
  - Hold `windStr` at about 0.9.
  - Keep `cleanSailing` accepting old saves. Snap `windTarget = windDir` so loaded worlds stop drifting.
  - Island placement (`placeUpstream`) can then rely on "downwind = forward", which is also how Raft spawns story targets (in the travel direction).
  - Update the tests in `tests/sailing.test.mjs` that assert the wind changes. This is the smallest of the five changes, with a large effect on how sailing feels.

### 4. Medium Crop Plot + watermelon / pineapple (island fruit)
- **Raft:**
  - The Medium Crop Plot holds 2 seeds and grows watermelon and pineapple. It is watered once, and rain counts.
  - Harvesting returns a seed 66.7% of the time.
  - A watermelon is eaten in two bites and gives both hunger and thirst, more water than a pineapple.
  - Watermelons, pineapples and mangoes grow on tropical islands.
  - The recipe is about 8 planks + 4 scrap (one guide; verify). Grow times were not found; verify.
  - Advanced plots hold 4.
- **Ours:**
  - Only the Small Crop Plot exists, with 3 slots for beet (50 s) and potato (300 s) (`dist/crops.js:1-20`, `SLOTS = 3`).
  - Island nodes are only `palm, bush, rock, sand` (`dist/islands-layout.js:25-26`).
  - No watermelon or pineapple items exist.
- **Sketch:**
  - Add `watermelon` and `pineapple` as food items. Watermelon: 2 bites, each about +8 food and +10 water through the vitals eat path. Pineapple: about +12 food, +4 water.
  - Add seed items `melonseed` and `pineseed`.
  - Add a `fruit` node kind to `islands-layout.js` (1-2 per island, gathered by hand; a pick drops the fruit plus a seed at 66.7%).
  - Generalise `crops.js` to a per-type table, `{cropplot: {slots: 3, crops: [beet, potato]}, cropplot2: {slots: 2, crops: [watermelon, pineapple]}}`, with its own wider model in `crops-model.js` and long grow times (start at about 600 s; verify).
  - Gull raids and the scarecrow already target plots, so extend `isPlot` to cover both types.

### 5. Island/sea threats beyond the shark: Poison Puffer first
- **Raft:**
  - Poison-Puffer: 40 HP. It lives underwater near large islands, swims at you and bursts into a poison gas cloud (5-20 damage). It takes 6 stone or 3 metal arrows, and drops Explosive Goo (1, plus a 33% chance of a second).
  - Warthog: 90 HP, charges for 20 damage, found on large tropical islands, does not respawn.
  - Screecher: 100 HP, drops a boulder for 35 damage, one per large island.
- **Ours:**
  - The only hostile is the shark (`dist/shark.js`), plus gull crop raids.
  - Islands and the seafloor are safe. Diving and gathering (`dist/diving.js`, `dist/seafloor.js` nodes sand/clay/scrap/metalore) carry no risk except breath.
- **Sketch:**
  - Add `dist/puffer.js` (pure rules) and `puffer-model.js`.
  - Spawn 0-2 puffers within about 25 m of a fixed island's seafloor while a player is diving there. A puffer drifts, notices a diver within 6 m, swims at 1.5 m/s and puffs at 1.2 m.
  - The puff is a 2.5 m cloud lasting 4 s. It deals 3 HP per 0.5 s inside (about 20 HP total) through `hurtPlayer(hp, 'poison')`, with a green fog tint in `underwater-fx.js`.
  - 40 HP: a wooden spear (20) kills it in 2 stabs, a metal spear in 1. A spear kill drops `goo`, a placeholder for future explosives or bait.
  - The host is authoritative, like the shark. Puffers respawn per island visit.
  - Warthogs and Screechers would need large islands with land AI, so they come later.

## Checked and not ranked (at or near parity)
- **Backpack / slots:** ours has 28 slots, 10 of them hotbar (`dist/items.js:46-47`). Raft has 20, or 30 with a backpack. We are already roomy.
- **Equipment / flippers / oxygen:** diving gear exists: fins swim x1.3, the air jug gives 55 s, plus goggles and scraper (`dist/diving-gear-core.js:4-5`). Breath is 33 s (diving.js).
- **Hook:** launch speed 5 + 7 * charge m/s (about 10-18 m), reel 8 m/s (`dist/hook-physics.js:56-62`). The hook fidelity work is already merged (`loop-fidelity-202611210910`).
- **Cooking Pot:** there are 6 meals (broth, chowder, custard, fishbowl, omelette, stew) in `content-items.js` / `cookpot*.js`. More recipes would be nice but are lower priority.
- **Smelter:** ore takes 30 s and sand 25 s, at 1 fuel each (`items.js:141-147`). No reliable Raft timings were found.
- **Seagull / bird nest:** gull raids plus the scarecrow have landed or been claimed. The Puffhen and Bramblegoat cover animal husbandry (`animals-core.js`).
