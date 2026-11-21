# Raft animals: research note

Scope: a cozy take on "keep an animal on your raft". Animals never get hungry, never die and never leave once they
have settled in. Feeding speeds up what they make, and petting gives hearts. Line numbers refer to the tree at commit 980b412.

## 1. How the survival-raft genre usually does it (general patterns)
- **Three roles.** There is usually an egg layer (a bird), a fibre animal (wool or fur, sheared with a tool) and a drink animal (milked with a bucket). Each one feeds one crafting chain.
- **Acquisition.** You find a wild animal on an island and bring it home, either with a lure food or a craftable cage or lasso. Often you need a pen or nest first so it has a home.
- **Feeding.** Animals eat crop output (seeds, grass, vegetables). A hunger bar gates production, and if you neglect them for a long time they get sick or die.
- **Production.** You get one output per timer or per day. The egg lands in the nest or on the floor. Wool regrows, and you need a tool to shear it.
- **Bonding.** You can pet or name them, they make a sound, and hearts or a mood icon appear. Some games add a friendship meter that raises output.
- **Movement.** They wander inside a pen or on the deck, avoid walls and stations, and play idle animations (peck, sit, shake). In multiplayer, positions come from the host.

## 2. Our cozy take
| Genre mechanic | Little Raft version |
|---|---|
| Hunger, sickness, death | **Dropped.** If you never feed them, they still produce, just slowly (each animal has a slow base timer). |
| Feeding | Optional. One feed makes the animal "content" for 180 s, and production runs 3x faster while that lasts. |
| Cage or lasso | **Dropped.** You lure an animal with food at a home station, so there is no capturing. |
| Pen walls | Not needed. Animals wander on free deck tiles, and the walls you already built act as fences. |
| Shearing or milking tool | **Dropped.** Press E to collect output when it is ready. |
| Friendship | Keep: hearts (0 to 10) from petting (once every 60 s) and from feeding. Each heart cuts the production timer by 3%. Hearts never decay. |

### Animal 1 (v1): the **Puffhen**
A round, fist-sized seabird puff (about 0.35 m) with stubby wings, a little crest tuft and big eyes. It hops instead of walking.
- **Getting one.** Craft a **Nest Box** (decor `nestbox`, cost `{wood:3, leaf:2, rope:1}`) and place it on a free tile. Press E on it
  while you have Palm Seeds to scatter 2 seeds ("Scatter seeds to lure a Puffhen"). 20 to 40 s later a Puffhen flutters down from the gull
  circle and settles in. Each box houses one Puffhen. Cap: 4 animals per raft, which bounds the `ext` size and the draw calls.
- **Feed.** `seed` (Palm Seed) or `leaf`, one per E while you hold it. Today seed has no recipe use. It drops on islands
  (`dist/islands-layout.js:177-178`) and is defined at `dist/content-items.js:12`, so this gives island loot a job.
- **Outputs**, laid in its own nest box. You press E on the box to take them.
  - `puffegg` **Puff Egg**: one every 240 s (80 s while content), up to 3 waiting in the box.
  - `feather` **Puff Feather**: a 35% bonus with each egg, or 1 from petting at 5 hearts or more (at most one per 120 s).

### Animal 2 (stretch): the **Mossling**
A low, round, sheep-like creature with mossy grey-green fleece (about 0.6 m). It sometimes waits at a bush on a passing island (10% of islands).
Press E with 3 leaves to befriend it, and it swims back after you. It needs a **Moss Bed** decor (`{wood:4, leaf:4}`). It eats `leaf`. Its
`fleece` (**Moss Fleece**) regrows every 300 s (100 s while content), and E gathers 2. It is cut from v1 because the follow-and-swim step needs islands.js changes.

## 3. What the outputs do in THIS build (there is no hunger, so outputs must feed crafting)
- **Puff Egg.** The grill is fish-only. `GrillState.place` takes raw fish only (`dist/cooking.js:11`), `cleanFish` needs `species` and `cm`
  (`dist/cooking.js:44-53`), and cooked dishes live in the fish-journal basket, not the bag. So in v1 eggs go into recipes:
  - **Hatch** (the main sink). Press E on a nest box that holds 3 eggs when the raft has fewer than 4 animals and a free nest box. After 120 s
    a chick appears at 0.6 scale and grows to full size over 10 min.
  - **Egg Lantern** `{puffegg:1, wood:2}` is a scrap-free second recipe that outputs a `lantern`. `Bag.craft` grants `output.kind` (`dist/inventory-state.js:356`),
    but the `recipe()` helper sets kind = id (`dist/content-items.js:17`), so write this one as a hand-frozen object.
  - Stretch: a "Sunny Egg" on the grill. It needs either a non-fish slot in `cooking.js`, or an animals module that claims E on grill tiles first.
    Content `interact` runs before `fc` (`dist/game.js:844-845`). Grill tiles are not in `world.decor`, so that needs a `hasGrill` getter on
    `contentCtx` (`dist/game.js:328-336`, wrapping `fc.hasGrill`, `dist/fishing-cooking.js:456`).
- **Puff Feather.** It makes three things:
  - **Feather Cushion** decor `cushion` (`{feather:3, leaf:2}`). Gulls like it too: add it to `PERCH_TOP` (`dist/wildlife.js:13`, height about 0.3).
  - **Wind Vane** decor (`{feather:2, wood:2, rope:1}`), which spins with the sailing wind.
  - **Fletched Rope**, which outputs 3 rope for `{feather:1, leaf:3}`. Plain rope is 2 leaf each (`dist/inventory-state.js:59`).
- **Moss Fleece (stretch).** 2 rope from `{fleece:1}`, and a Moss Rug decor.
- **Research gating.** New recipes are locked unless they are in `STARTER` (`dist/storage-research.js:10`). `learnedFrom` (`:35-41`) unlocks a
  recipe once all its cost kinds have been seen. That means `nestbox` (wood, leaf, rope) unlocks early, and the egg and feather recipes unlock after the first egg or feather.

## 4. Petting and naming
- **E on an animal.** The priority is: collect any ready output, then feed it if you hold seed or leaf, otherwise pet it. Petting plays a local
  squish animation, a chirp and a floating heart. It also sends the host action `animals.pet`, which adds +1 heart (the host keeps a 60 s cooldown per animal).
- **Prompt.** For example "<kbd>E</kbd> Pet Biscuit ♥ 4", "<kbd>E</kbd> Feed (seed)" or "<kbd>E</kbd> Collect 2 eggs". Build it with `ctx.esc(name)`.
- **Names.** Each animal gets a random name from an original list (Biscuit, Dumpling, Pip, Marlo, Sprout, Tuffet, Nib, Clover, Bun). Rename it in
  a small panel opened from the nest box (copy `dist/storage-research-ui.js`), which sends host action `animals.name` `{id, name}`. Clean names
  to 1 to 14 printable characters, and always pass them through `esc` when rendering.

## 5. Animation and wandering on the deck
- **Walkable cells.** Cells in `world.tiles` with no `world.decor` entry, on level 0 only. Animals never use `stairs` or upper floors.
  The home nest box tile is the one decor tile an animal may sit on, to lay.
- **Blockers.**
  - Decor tiles (`BLOCK_RADIUS`, `dist/game.js:52`). Nothing removes decor anywhere, so a nest box is permanent.
  - Level-0 `wall`, `halfwall` and `window` pieces in `world.pieces` `{t,i,j,l,r}`. Edge `(i,j,0)` is the -z side of cell (i,j) and `(i,j,1)` is the
    -x side (`dist/building-pieces.js:3`). An edge piece blocks the move between the two cells it separates. A `door` lets animals through.
  - Grill tiles are unknown to content. Either add the `hasGrill` getter or accept the cosmetic clipping.
  - Animals do not block players.
- **Graph.** Rebuild the cell adjacency only when the `tiles`, `decor` or `pieces` refs or lengths change, as `refreshPerches` does (`dist/wildlife.js:235-240`).
- **Motion.** Every 5 to 9 s a beat picks one of three things:
  - idle (peck, preen, sit, look around);
  - 1 to 3 hops to neighbouring cells (puffhen: 0.6 m/s, hop arc `sin·0.08` m, to a jittered point ±0.5 m inside each cell);
  - go home (when an egg is due, it walks to its box and sits for 3 s).

  Animals face their heading and follow the raft's bob and tilt, the way a perched gull does (`v3.applyMatrix4(raft.matrixWorld)`, `dist/wildlife.js:265`), and they squash and stretch each frame.
  There are no per-frame allocations: scratch vectors plus merged low-poly geometry, in the style of `dist/wildlife-models.js`.
- **Gulls** still perch on free tiles (`perchesFrom`, `dist/wildlife.js:30`). An animal within 0.6 m can locally "shoo" the gull, like the player scare, at no network cost.

## 6. Co-op sync (cheap: deterministic wander, no position stream)
- **Wander.** The path is a pure function `plan(seed, beat, graph, home)`, where `beat = floor((t - born) / 7)`, using the stateless `mulberry32`
  (`dist/wildlife.js:17-24`). The clock `t` is the host clock, sent the wildlife way as `{t}` in `serialize()`, and the guest snaps when the error
  is over 2 s (`dist/wildlife.js:335-345`). `tiles`, `decor` and `pieces` already sync, so both sides build the same graph. Each beat starts from
  the cell where the previous one ended. Every 8th beat restarts from the home cell, so a late joiner converges within about a minute with zero position bytes.
- **Host-authoritative state.** Hearts, timers, waiting eggs and feathers, names, lures and hatches. The host ticks timers in `update(dt)`
  while `ctx.running`. Guests only render and send `animals.lure|feed|pet|collect|hatch|name` through `ctx.action`. The local squish plays at once.
- **Size.** At most 4 animals × about 60 bytes at about 8 Hz in `hostState` (`dist/game.js:1062`). Round timers to whole seconds.
  `load(d,'net')` rebuilds meshes only when the animal count or kinds change.

## 7. Save
`world.ext.animals = {v:1, t, list:[{id, kind:'puffhen', name, seed, home:[x,z], born, hearts, content, prod, eggs, feather, petAt, grow}], lures:[{home:[x,z], at}]}`.
- **Old saves.** `load(undefined)` gives an empty list.
- **Cleaning.** Drop entries whose `home` is not a `nestbox` decor, clamp the numbers, cap the list at 4, and dedupe `id` and `home`.
- **New bag kinds** `puffegg`, `feather` (and later `fleece`). Old builds reset a bag that has unknown kinds (`dist/content-items.js:4`), the same risk earlier content kinds took.

## 8. Integration points (content registry)
- **Module.** `dist/animals.js` exports `createAnimals(ctx)`; import it and append it to `FEATURES` (`dist/content.js:25-30`). Pure logic (graph,
  plan, timers, clean) goes in `dist/animals-core.js` with tests in `tests/animals.test.mjs`. Models go in `dist/animals-models.js`.
- **Items and decor.** In `dist/content-items.js`:
  - `CONTENT_ITEMS` (`:9-14`): add `puffegg`, `feather` and `nestbox`.
  - `CONTENT_RECIPES` (`:19-21`): add `nestbox`, `cushion`, `windvane`, `eggLantern` and `fletchRope`.
  - `CONTENT_DECOR` (`:24`): add `nestbox` and `cushion`.
  - `CONTENT_BLOCK_RADIUS` (`:25`): add `nestbox:.35` and `cushion:.3`.

  Core placement then works with no game.js edits (`dist/game.js:44,52,772-781`). The model comes from `decorModel('nestbox')`
  (`dist/game.js:428`). The eggs shown in the box are a child mesh that the module updates.
- **Hooks.**
  - `interact` and `prompt`: an analytic ray against animal spheres and the nest box (`dist/game.js:844,490`; pattern `dist/islands.js:255`).
  - `action`: kinds start with `animals.` (`dist/game.js:814`; copy the prefix guard at `dist/islands.js:239`).
  - `update`, `serialize` and `load` (`dist/game.js:903,1062,1230,1312`).
  - `debug` at `raftDebug.content.animals` (`dist/game.js:1434`): `spawn(kind)`, `ff(sec)`, `list()`, `beat(n)`.
- **Icons.** Add `icon-egg`, `icon-feather` and `icon-nest` to `dist/icons.svg`, and their ids to `SPRITES` (`dist/survival-ui.js:19`).
- **Optional tiny game.js edit.** Add `hasGrill:(x,z)=>!!fc?.hasGrill(x,z)` to `contentCtx` (`dist/game.js:334`).
