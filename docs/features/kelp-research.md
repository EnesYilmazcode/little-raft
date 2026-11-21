# Kelp Line: research

A rope with floats hung off a raft edge tile, with seaweed growing on it in the water. It ripens over a
few minutes and E harvests it. It never decays. Anchors were checked against the current tree
(branch `claude/loop-features-202611210952`, based on raft-master 92cd4ea).

## (a) Patterns and an original cozy take

**What other games do**
- *Aquaculture and seaweed farming in sims* (Stardew Valley's crab pots, Animal Crossing's 2.0 diving
  and seaweed, Ocean farming in Dinkum and Sun Haven): you place something once, it fills on a timer,
  and you come back to collect. The fun is checking your route of devices, not managing them.
- *Passive devices off the edge of a raft* (the genre's nets, traps and catchers): a device sits on the
  border of the build, touches the water and pays out over time. Its state shows on the model (full
  basket, items in a net) so you can read it from across the deck.
- *Visible stages* (crops in nearly every farming game): 3 to 4 silhouettes that are easy to tell
  apart, with the last one looking clearly "ready". It works better than a % bar on its own.
- *Pairing with nearby devices*: a small "this helps that" bonus (beehive plus flowers, sprinkler plus
  crops) gives placement a reason without making it a puzzle.

**Little Raft take: the Kelp Line**
- Craft: `wood 2, rope 3, plastic 1` (the plastic makes the floats; plastic is a common barrel drop
  and is otherwise only recycled or burned in the motor). Unlock with `discover('seaweed')`, the same
  way the fish trap uses `discover('fish')` (items.js:273).
- Place on an **edge** tile only, like the fish trap (reuse `isEdgeTile` / `openSide`). The model is a
  short post with a cleat, and a rope runs out ~1.2 m over the open side to a row of 3 cork or plastic
  floats bobbing on the surface. 3 to 4 strands hang under the floats into the water.
- Growth: 3 visible stages. **Bare** (thin strands), **Leafy** (short blades), **Lush** (long blades
  with a tuft above the floats so it can be read from the deck). About 180 s from bare to lush. A lush
  line stays lush forever and never rots, drifts off or gets eaten.
- E on a lush line: the host gives `seaweed` x2, or x3 when a bonus applied (see below). The line goes
  back to Bare. E before then shows the prompt "Kelp Line: growing… 62%". Harvesting is all or
  nothing: a full bag leaves the line lush (the same rule as fish-trap `collect`).
- Gentle bonuses (only the host computes them, from state that is already synced):
  - **Sunshine**: the line grows 25% faster while `night < .5` and `rain < .2` (the daynight getters
    `night` and `rain`, daynight.js:782).
  - **Good neighbours**: a fish trap within 1 tile gives +1 seaweed on harvest. Fish like the shade,
    and the kelp likes the company. Read it from `world.decor` (type `fishtrap`) in the same way.
  - No penalties. Nothing is ever lost.
- **New uses for seaweed** (today it is fuel at 0.5, items.js:380; bait, fish-trap.js:314; 3 cookpot
  meals, cookpot-core.js:8-9; goat food, animals-core.js:18):
  1. **Kelp mulch for crop plots** (crops ARE on master: crops.js, in FEATURES at content.js:94).
     Holding seaweed and clicking a planted slot mulches it, and a mulched slot gives +1 crop at
     harvest (beet or potato x3 instead of x2). It does not replace water. Hook it through the existing
     `crops.*` action family (crops.js:96) as `crops.mulch`, with a new optional slot field `m` (0|1).
  2. **Kelp twine** as a second way to make rope is tempting, but `ITEMS` has one recipe per item, so
     a second rope recipe means a new item. Use (1) only. Optionally add later: seaweed counts as a
     palm-planter "feed" in watering.js. That is out of scope for v1.

## (b) Code anchors (current tree)

**Closest prior art: Fish Trap** (`dist/fish-trap.js`, an edge-tile passive device in a content module)
- Header and design rules: fish-trap.js:1-4. Constants `CATCH_SEC, MAX_TICK=60, REACH, HOST_SLACK`: :9.
  `OLD_HOST` guest text and `NOT_EDGE`: :12-13.
- `trapList(decor)`, one per tile in decor order: :25-33. `isEdgeTile`: :36-40. `openSide` and
  `sideIndex` (allocation-free): :43-55. Copy these or import them from fish-trap.js.
- `cleanTrap(v, decor)` validated slice, which prunes tiles without the decor: :74-95. This is the
  template for `cleanKelp`.
- `tickTraps(st, tiles, decor, dt)` whole-second host tick, which bumps `st.r` on any change and only
  runs for live edge tiles: :101-123.
- All-or-nothing `collect` through a snapshot Bag: :133-148.
- Module: `session`/`st.s`/`st.r` net dedupe in `load(...,'net')`: :259 (fn at ~:240-255). The
  serialize cache is :248-252. Host 1 Hz clock in `update`: :265-274. `placeBlock` returns
  `'trapedge'`: :275-277. `prompt`/`interact` are at :278-293 and `action` with the reach check
  `REACH + HOST_SLACK` against `ctx.other` for a guest is at :294-320. `decorModel`: :321-324.
  `debug.place/fastForward/fill`: :325-353.
- Aim targeting along the view ray to an overhanging spot: :175-198. Mesh scan of the `craft_fishtrap`
  groups in `ctx.raft`, rotated to face the open side: :200-212. Paint with frustum and 30 m cull:
  :214-231.
- Model: `dist/fish-trap-model.js`. `OVERHANG=1.15`: :6. `paintTrap` cheap sine bob (no ocean
  sampling): :130-145.
- Wiring: import at content.js:84 and in `FEATURES` at :94. `NO_UNDECOR` at content.js:97 (add
  `kelpline` there, or implement `beforeUndecor/undecorLoot/afterUndecor`, documented at
  content.js:38-46). Block text at build-rules.js:22 (`trapedge`). Game placement goes through
  `content.placeBlock` at game.js:1118, :1134 and :1294. Item at items.js:273 and `BLOCK_RADII` at
  items.js:350 (a new placeable needs both: tests/progression.test.mjs ~:120). Book text at
  craft-book.js:29 and :177. Icon at item-svg.js:508. Preload list at live.js:23 (add the new files).
  Trap fish land in the journal at game.js:1156.
- **Collection nets** (`dist/nets.js`) are core, not content. They live in `world.nets` (game.js:205,
  :227-228, :239) and attach to a tile *side* (`NET_DIRS`, `netEdgeX/Z`, `netYaw`: nets.js:19-37).
  Kelp should follow the fish trap (decor on an edge tile plus an ext slice), not nets, because a new
  core world field would break old builds and co-op with them.

**Seaweed today**
- Item: items.js:107-108 (material, icon `#4f9a5c`). Fuel 0.5: items.js:380. Barrel loot weight 8:
  items.js:462. Fuel names: game.js:1052. Book: craft-book.js:100 and source tag craft-book.js:457
  ("Hook floating barrels"). Add a "Kelp Line" source there, because tests/craft-ux.test.mjs:124
  needs every item to have a source.
- Cookpot ingredient and meals: cookpot-core.js:6-9 (Kelp Broth is at :14, so the name "kelp" is
  already in the game's vocabulary). Goat food: animals-core.js:18 and :335. Fish-trap bait:
  fish-trap.js:253 and :314. Treasure loot: treasure-rules.js:54.
- Look: `seaweedGeometry` (3 curved blades, vertex-coloured, 1.6 m) at seafloor.js:272. The palette
  is `weed/weedTip/kelp` at seafloor.js:139, and the sway shader snippet is at ~seafloor.js:158-172
  (the shipwreck spec already copies it). Scale it down for the strands.
- `content-items.js` (CONTENT_DECOR at :143) is the older registry. The progression `ITEMS` in
  items.js is what the craft UI uses for fishtrap/cropplot, so put `kelpline` in items.js.

**Water surface for bobbing floats**
- `ocean.getHeight(x, z, t)` at ocean.js:400 (world coords, includes the sailing flow offset) and
  `sample(x,z,t,out)` at ~ocean.js:427-437. They are exposed on `ctx.ocean` (content.js:53, used in
  buoycourse.js:309 and fishing-v2.js:196). The floats are raft children, so convert local to world
  and back, or do what `paintTrap` does: a cheap per-float sine bob with a phase. I recommend the sine
  bob, because the raft itself already rides the waves.

**Crops (for the mulch hook)**
- crops.js:1-13 explains the design. Slot `{c,g,w}` lives ON the decor entry (`d.crop`). `YIELD=2` and
  `MAX_TICK`: :23. `cleanCrop`: ~:38-43 (it must accept and clamp a new `m`). `tickCrops`: :66-82.
  Actions are at :96-130. The crosshair provider `raftPrompts.provide({id:'crops'})` is at :171.
  game.js:74 and :2147 use the `withoutCrops` replacer so crop ticks do not count as a raft rebuild.
  **Do not** store kelp growth on the decor entry: it would trigger guest raft rebuilds unless
  game.js:2147 is also patched. Use `world.ext.kelpline` instead.

**Prompts**
- Content `prompt()` is now bridged: game.js:780 registers `raftPrompts.provide({id:'content'})` from
  `contextHtml`, and it mutes while holding a placeable decor. So a module `prompt(aim)` like the fish
  trap's is visible again. It only needs its own provider when it must win over pickups (see
  crops.js:171 and the provider API at prompts.js:3-4 and :235; a provider returns null when
  `c.state.pickup` is set, as at paddle.js:126).

**Tests to imitate or keep green**
- tests/fish-trap.test.mjs: clean (:29), edge (:52), tick (:66), determinism round trip (:103),
  collect (:118), module/placeBlock (:149), guest OLD_HOST (:189), 1 Hz (:227), model (:247), item
  (:275). tests/crops.test.mjs covers mulch. tests/progression.test.mjs ~:100-200 covers item
  completeness, `BLOCK_RADII` and reachability. tests/survival.test.mjs:555 covers book text for
  every kind. tests/craft-ux.test.mjs:124 covers sourceOf. tests/live-preload.test.mjs covers the
  PRELOAD list. tests/content.test.mjs and content-prompts.test.mjs cover the registry and prompts.

## (c) Risks
- **Co-op and old builds**: a host on an old build has no `ext.kelpline`, so a guest must show
  `OLD_HOST` and do nothing (the fish-trap `hostHasTrap` pattern). An old guest build will not know
  the `kelpline` item: it starts a fresh bag (content-items.js:4 note), which is accepted.
- **Net cost**: `load(...,'net')` runs about 8 times a second. Skip it when `r`/`s` are unchanged and
  never rebuild meshes there. Stage changes are only a few per line per 3 minutes, so `r` should bump
  on a *stage* or harvest change, not every second (the fish trap bumps every second; kelp can be
  cheaper by storing `g` but bumping `r` only on stage changes, with guests showing the stage only).
- **Edge loss**: a floor built later can close in the line's open side. Freeze growth (no loss) and
  still allow harvesting a lush line, the same as the fish trap's inner-trap rule (fish-trap.js:283).
- **Undecor**: if `kelpline` is left out of `NO_UNDECOR` without hooks, picking up a lush line loses
  its seaweed. Either add it to the set or return `[['seaweed', n]]` from `undecorLoot`.
- **Bonus sources**: daynight `night`/`rain` exist only on the host's live module (use
  `env.night()` via `link(env)`, content.js:135-137, plus `peer('daynight')?.rain`). Fall back to "no
  bonus" if they are missing, and never block growth on them.
- **Economy**: 2 to 3 seaweed per 3 minutes per line, with up to 400 lines (the tile cap), could flood
  fuel. That is fine for a cozy game, but keep the yield small and the plastic cost real.
- **Mulch touches crops.js**: a new slot field `m` must survive `cleanCrop` and the guest decor sync.
  It must also be ignored by old builds, which drop it and so only lose the bonus. Coordinate with the
  crops owner; keep the change to a few lines tagged `// [kelpline]`.
- **Names and art**: original names (Kelp Line, kelp mulch), our own geometry, and no text from the
  commercial game.
