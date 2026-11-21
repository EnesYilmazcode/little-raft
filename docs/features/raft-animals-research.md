# Raft animals: research note

Scope: a cozy take on "keep an animal on your raft". Animals never get hungry, never die and never
leave once they have settled in. Feeding speeds up what they make, and petting gives hearts.
Line numbers refer to the tree at commit 980b412.

## 1. How the survival-raft genre usually does it (general patterns)
- **Three roles.** There is usually an egg layer (a bird), a fibre animal (wool or fur, sheared
  with a tool) and a drink animal (milked with a bucket). Each one feeds one crafting chain.
- **Acquisition.** You find a wild animal on an island and bring it home, either with a lure food
  or a craftable cage or lasso. Sometimes you need a pen or nest first so it has a home tile.
- **Feeding.** Animals eat crop output (seeds, grass, vegetables). A hunger bar gates production,
  and if you neglect them for a long time they get sick or die. **We drop that part.**
- **Production.** You get one output per timer, or per day. The egg lands in a nest or on the
  floor. Wool regrows until it can be sheared again, then you need a tool to collect it.
- **Bonding.** You can pet or name them, they make a sound, and hearts or a mood icon appear.
  Some games add a friendship meter that raises output quality.
- **Movement.** They wander inside a pen or on deck tiles, avoid walls and stations, and play
  idle animations (peck, sit, shake). In multiplayer, positions come from the host.

## 2. Our cozy take: what we keep and what we drop
| Genre mechanic | Little Raft version |
|---|---|
| Hunger, sickness, death | **Dropped.** If you never feed them, they still produce, just slowly (each animal has a slow base timer). |
| Feeding | Optional. One feed fills a "content" timer (180 s) and production runs 3x faster while it lasts. |
| Cage or lasso | **Dropped.** You lure an animal with food at a home station, so there is no capturing. |
| Pen walls | Not needed. Animals wander on free deck tiles and the walls you already built act as fences. |
| Shearing or milking tool | **Dropped.** Press E on an animal that is ready to collect its output. |
| Friendship | Keep: hearts (0 to 10) from petting once every 60 s and from feeding. Each heart cuts the production timer by 3%. Hearts never decay. |

### Animal 1 (v1): the **Puffhen**
A round, fist-sized seabird puff (about 0.35 m) with stubby wings, a little crest tuft and big
eyes. It hops instead of walking.
- **Getting one.** Craft a **Nest Box** (decor `nestbox`, cost `{wood:3, leaf:2, rope:1}`) and place
  it on a free tile. Press E on it while you have Palm Seeds to scatter 2 seeds ("Scatter seeds to
  lure a Puffhen"). 20 to 40 s later a Puffhen flutters down from the gull circle and settles in.
  Each nest box houses one Puffhen. Cap: 4 animals per raft (this bounds `ext` size and draw calls).
- **Feed.** `seed` (Palm Seed) or `leaf`, one at a time with E while holding it. Today seed has
  no recipe use at all. It comes from islands at `dist/islands-layout.js:177-178` and is defined at
  `dist/content-items.js:12`, so this gives islands loot a job.
- **Outputs** (it lays them in its own nest box, and you press E on the box to take them):
  - `puffegg` **Puff Egg**, every 240 s (80 s while content), 1 at a time, up to 3 waiting in the box.
  - `feather` **Puff Feather**, a 35% bonus with each egg, or 1 when you pet it at 5 hearts or more (max 1 per 120 s).

### Animal 2 (stretch): the **Mossling**
A small, low creature like a round sheep, with a mossy green-grey fleece (about 0.6 m long).
- **Getting one.** It sometimes appears on a passing island (10% per island) at a bush. Press E with
  3 leaves to befriend it, and it follows you while you swim back. You need a **Moss Bed** decor
  (`{wood:4, leaf:4}`). If the island drifts away first, nothing is lost and it can come back later.
- **Feed.** `leaf`. **Output.** `fleece` **Moss Fleece** regrows every 300 s (100 s while content).
  When the fleece is fluffy, E gathers 2 fleece.
- It is cut from v1 because the follow and swim step is the only part that needs islands.js changes.

## 3. What the outputs do in THIS build (no hunger, so outputs must feed crafting)
- **Puff Egg.** The grill is fish-only for now. `GrillState.place` accepts raw fish only
  (`dist/cooking.js:11`), `cleanFish` requires `species` and `cm` (`dist/cooking.js:44-53`), and
  dishes live in the fish journal basket, not the bag. So in v1 eggs go into recipes:
  - **Egg Lantern** (`{puffegg:1, wood:2}`) is a scrap-free second recipe that outputs a `lantern`.
    The recipe output kind can differ from its id (`dist/content-items.js:17`).
  - **Hatch.** Press E on a nest box that holds 3 eggs while you own fewer than 4 animals: "Keep
    the eggs warm". After 120 s a baby Puffhen appears, starts at 0.6 scale and grows over 10 min.
    It needs a free nest box. This is the main egg sink.
  - Stretch: "Sunny Egg" on the grill. It needs either a non-fish slot type in `cooking.js` or an
    `animals` module that claims E on grill tiles first. Content `interact` runs before `fc`
    (`dist/game.js:844-845`). Grill tiles are not in `world.decor`, so the module would need a new
    `hasGrill` getter on `contentCtx` (`dist/game.js:328-336`, wrapping `fc.hasGrill`,
    `dist/fishing-cooking.js:456`). Defer.
- **Puff Feather.** **Feather Cushion** decor `cushion` (`{feather:3, leaf:2}`), a soft seat that
  gulls also like to perch on (add it to `PERCH_TOP` at `dist/wildlife.js:13`, height about 0.3).
  **Wind Vane** decor (`{feather:2, wood:2, rope:1}`) is a mast-top whirligig that spins with the
  sailing wind. Also the cheap **Fletched Rope** recipe `rope` x3 from `{feather:1, leaf:3}`.
- **Moss Fleece (stretch).** **Rope** x2 from `{fleece:1}` (today rope costs leaf 2,
  `dist/inventory-state.js:59`), and the **Moss Rug** decor.
- **Research.** All the new kinds go into recipe costs. That makes them researchable through
  `learnedFrom` (`dist/storage-research.js:35-41`), and new recipes stay locked unless they are
  added to `STARTER` (`:10`). Put `nestbox` in STARTER, or give it a seed-only path: cost
  `{wood, leaf, rope}` is learned as soon as those kinds have been seen.

## 4. Petting and naming
- **E on an animal:** if it has output ready, collect it. If you hold seed or leaf, feed it.
  Otherwise **pet** it: a local squish animation, a chirp (`audio`), and a host action
  `animals.pet` that adds +1 heart (60 s cooldown per animal, kept on the host) and floats a
  heart sprite.
- **Prompt:** "<kbd>E</kbd> Pet Biscuit ♥ 4" or "<kbd>E</kbd> Collect egg". Build it with `ctx.esc(name)`.
- **Names.** It gets a random name from an original list (Biscuit, Dumpling, Pip, Marlo, Sprout,
  Tuffet, Nib, Clover, Bun). To rename, use a small panel opened with Shift+E or from the nest box
  (copy `dist/storage-research-ui.js`). Host action `animals.name` with `{id, name}`. Clean names
  to 1 to 14 printable characters, and always pass them through `esc` when rendering.

## 5. Animation and wandering on the deck
- **Walkable cells:** `world.tiles` cells with no `world.decor` entry (the nest box tile is the
  home, where the animal sits to lay). Level 0 only. Animals never climb `stairs` and never stand
  under or on upper floors.
- **Blockers:** decor tiles (BLOCK_RADIUS, `dist/game.js:52`). There is no decor removal anywhere,
  so a nest box is permanent. Walls, half walls, windows and pillars on level 0 come from
  `world.pieces` records `{t,i,j,l,r}`. An edge `(i,j,0)` is the -z side of cell (i,j) and `(i,j,1)`
  is the -x side (`dist/building-pieces.js:3`). A move between neighbouring cells is allowed unless
  a full-height edge piece (`wall`/`window`/`halfwall`) sits on the shared edge. `door` is a gap, so
  it allows the move. Grill tiles are unknown to content, so either add the `hasGrill` ctx getter or
  accept that an animal clips a grill (it is cosmetic only). Animals do not block players.
- **Graph:** rebuild a cell adjacency list only when the `tiles`, `decor` or `pieces` refs or lengths
  change (the same trick as `refreshPerches`, `dist/wildlife.js:235-240`).
- **Motion:** each animal runs a "beat" every 5 to 9 s. On a beat it idles (peck, preen, sit, look
  around), takes 1 to 3 neighbouring-cell hops (about 0.6 m/s for the puffhen, with a hop arc of
  sin·0.08 m), or goes home (when an egg is due it walks to its nest box and sits for 3 s). Inside a
  cell it aims for a jittered point (±0.5 m). It faces its heading, takes the raft's bob and tilt as
  the gull perch does (`v3.applyMatrix4(raft.matrixWorld)`, `dist/wildlife.js:265`), and gets a
  per-frame squash and stretch. No allocations: use scratch vectors and one `InstancedMesh` per
  part (body, wing, eye) or merged low-poly geometry as in `dist/wildlife-models.js`.
- **Gulls:** they still perch on free tiles (`perchesFrom`, `dist/wildlife.js:30`). If an animal is
  within 0.6 m it can "shoo" the gull locally, like the player scare. That costs nothing on the network.

## 6. Co-op sync (cheap)
- **Deterministic wander, no position stream.** The wander path is a pure function
  `plan(animal.seed, beatIndex, graph, homeCell)`, with `beat = floor((t - born)/7)` and the
  stateless `mulberry32` (`dist/wildlife.js:17-24`). Both clients use the host clock: the
  wildlife approach of `{t}` in `serialize()`, snap if the error is over 2 s
  (`dist/wildlife.js:335-345`). `tiles`, `decor` and `pieces` already sync, so both sides build
  the same graph. Path state is the cell where the beat starts. Make it reproducible by replaying
  from the home cell each N=8 beats, so a late joiner converges within about 1 minute without
  any position bytes.
- **Host-authoritative state:** hearts, timers, eggs waiting, names and lure arrivals. The host
  ticks the timers in `update(dt)` while `ctx.running`. The guest only renders and sends
  `animals.feed|pet|collect|lure|hatch|name` through `ctx.action`. Local petting squish plays at once.
- **Size:** at most 4 animals × about 60 bytes, sent at about 8 Hz through `hostState`
  (`dist/game.js:1062`). Round the timers to 1 s. `load(d,'net')` must not rebuild meshes unless
  the count or kinds changed.

## 7. Save
`world.ext.animals = {v:1, t, list:[{id, kind:'puffhen', name, seed, home:[x,z], born, hearts,
content, prod, eggs, feather, petAt, grow?}], lures:[{home:[x,z], at}]}`. `load(undefined)` gives an
empty list, so old saves load. Cleaning: drop entries whose home tile is not a `nestbox` decor,
clamp the numbers, cap the list at 4, and dedupe `id` and `home`. Item kinds `puffegg`, `feather`
(and `fleece`) go into the bag. Old builds reset a bag that holds unknown kinds
(`dist/content-items.js:4`); the risk is the same as with earlier content kinds.

## 8. Integration points (content registry)
- `dist/animals.js` exports `createAnimals(ctx)`. Import it and append it to `FEATURES` at
  `dist/content.js:25-30`. Put the pure logic (graph, plan, timers, clean) in `dist/animals-core.js`
  and the tests in `tests/animals.test.mjs`. Models go in `dist/animals-models.js`.
- `dist/content-items.js`: add `puffegg`, `feather` and `nestbox` to `CONTENT_ITEMS` (`:9-14`), the
  `nestbox`, `cushion` and `windvane` recipes to `CONTENT_RECIPES` (`:19-21`), `nestbox` and `cushion`
  to `CONTENT_DECOR` (`:24`), and `CONTENT_BLOCK_RADIUS` entries (`:25`, about `nestbox:.35`). Core
  placement then works with no game.js edits (`dist/game.js:44,52,772-781`). The model comes from
  `decorModel('nestbox')` (`dist/game.js:428`), and the eggs shown inside the box are a child the
  module updates.
- Hooks: `interact`/`prompt` via a ray against animal spheres and the nest box tile (`dist/game.js:844,
  490`), `action` with the `animals.` prefix (`dist/game.js:814`; follow the islands prefix guard,
  `dist/islands.js:239`), `update`, `serialize`/`load` (`dist/game.js:903,1062,1312,1230`), and
  `debug` (`raftDebug.content.animals`, `dist/game.js:1434`) with `spawn(kind)`, `ff(seconds)`,
  `list()`, `beat(n)`.
- Icons: `icon-egg`, `icon-feather` and `icon-nest` go in `dist/icons.svg`, and their ids go in
  `SPRITES` at `dist/survival-ui.js:19`.
- Optional tiny game.js edit: `hasGrill:(x,z)=>!!fc?.hasGrill(x,z)` in `contentCtx` (`dist/game.js:334`).
