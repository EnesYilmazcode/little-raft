# Zipline research

Feature (round loop-features-202611210855): two posts plus a rope line on the raft, upper floors included,
ridden with E. Anchors were checked against the current tree (branch base 16aedaa). All paths are under `dist/`.

## (a) Genre patterns and our take

How survival and sandbox games usually do ziplines:
- Two anchor poles or bases, linked by a rope or cable that the player strings between them by hand,
  often with a length limit and a rule that nothing may block the line.
- You ride by holding a tool or item (a handle or hook) and interacting near one end. You hang under the line,
  and the camera is locked to the line direction or free-look.
- Ziplines are used to cross floors and towers, so the two ends sit at different heights.
- Speed builds going downhill. Going uphill is either blocked or slow (some games need a motor for it).
- The ride stops at the far anchor with a small brake. Usually you can drop off mid-line with jump.

Little Raft take, kept cozy (no damage, no hunger):
- **Zipline Post**: a small wooden post with a pulley wheel on top. It can stand on the deck or on any
  upper-floor `floor` piece.
- **Link**: hold Rope and press E on post A, then E on post B. This uses 1 rope (maybe 1 per 4 m) and draws a
  sagging line between them. A post holds at most 2 lines, so you can build chains.
- **Ride**: press E near a post that has a line. You hang about 1.1 m under the rope and glide along it.
  Proposed speed: a constant gentle 3.5 m/s with a slight boost downhill (up to 5 m/s) and a slowdown uphill
  (down to 2.5 m/s). Uphill never stalls, so nobody gets stuck.
- **Drop off**: press Space at any time. You land wherever you are, and there is never fall damage (none
  exists in the game). At the far post you are set down on its tile.
- **Length**: 3 to 12 m. The guard text says "Too far for one rope" or "Too close".
- Look stays free the whole ride. WASD does nothing. A soft rope creak plays while you glide.

## (b) Code anchors

**Player physics and taking control**
- `player-physics.js:12` sets `GRAVITY: 12`. `update()` at :91 takes `{deckY, tiles, blocked}`. The deck snap is at
  :118 and :131, and the fall plus landing at :172-190. Physics x/y/z is the EYE position (`EYE_OFFSET` 1.6, :3).
- `game.js:1373-1394` is `movePlayer`. The order is `building.preStep` (:1381), then `physics.update` substeps (:1388),
  then `building.postStep` (:1393), then `content.afterMove(physics, dt)` (:1394). The content hook runs last,
  so a module can pin the player there.
- Prior art for pinning the player is the sleep module (`sleep.js:283-288`, `afterMove`). It overwrites
  `physics.x/y/z`, zeroes `vx/vy/vz` and sets `grounded = true` every frame. The zipline should copy this,
  with `grounded = false` so the remote avatar shows the airborne pose.
- Space to drop: physics applies the jump impulse on the press edge (:165/:190). A rider reported as grounded
  gets `vy = JUMP_IMPULSE` on the next update. The module can treat `physics.vy > 0` in afterMove as
  "dismount" and then stop pinning. That way the player keeps the hop, and gravity and the deck snap do the
  landing. This avoids reading keys directly.
- E routing: `game.js:1239` calls `content?.interact(currentAim())`. Steering prior art is `sailing-world.js`
  (hold R) plus `content.js:20` `steerTargets()`.

**Upper floors and the world y of a post**
- `building-pieces.js:4,6`: `base(l) = deckY + l*LEVEL_H` with `LEVEL_H = 2.2` and `MAX_L = 5` (:11). Records are
  `{t,i,j,l,r}`. Cell (i,j) is centred at raft-local (2i, 2j). A `floor` piece at level l puts its walk surface
  at `deckY + l*2.2` (see `_scan`, :330-345).
- `game.js:364`: `deckY() = raft.position.y + FLOOR_Y(.2)`. Content modules get it as `ctx.deckY()`.
  Post foot y = `ctx.deckY() + l*LEVEL_H`, and the rope top is about +2.0 m above that.
- `building.js:64` syncs `world.pieces`. `apply()` at :124-144 places and removes pieces with
  `grid.canPlace/canRemove`. It has no content veto, so a post cannot stop its floor being removed.
- `ctx.building` (content.js:30) exposes the live grid.

**Decor placement**
- Decor is deck-only. Records are `{type,x,z,rot?}` with no y or level (`game.js:1139`), the
  `build-rules.js:37` `decorBlock` needs a deck tile, and `placement.js:56-63` `decorCheck` tests deck tiles.
- So a post on an upper floor cannot be a CONTENT_DECOR entry. Store posts in `world.ext.zipline.posts =
  [{id,i,j,l}]`, placed through a module action (`zipline.post`) that checks
  `l===0 ? tile exists : grid has floor(i,j,l)`. A deck-level post could still be decor, but one storage path
  for both is simpler.
- Deck decor model prior art: `content-items.js:78` `CONTENT_DECOR`, and `decorModel(type, d)` (content.js:17).

**Rope rendering**
- `rope.js:19` `createRope(T,{segments,radius})` builds one preallocated tube from a polyline, with no
  allocations per update. It could be reused per line, but a static line only needs a TubeGeometry built
  once when the line changes.
- `coop-fx.js:138-180` `createRemoteRope` draws a skewed catenary-ish sag
  (`y = lerp + lift*bow - sag*bow*...`, :171-173). `hook-physics.js:370` `ropePoints` uses sag = span*0.12*slack.
- For the zipline, a parabola `y(t) = lerp(yA,yB,t) - 4*S*t*(1-t)` with S = 0.04*span works for both drawing
  and riding, so the rider follows the drawn rope exactly.

**Raft coordinates**
- `sailing-world.js:3`: "The raft never moves in x/z: the world drifts past it instead." `game.js:446`: the
  raft group has only y bob plus small pitch/roll (:1428-1429), with no yaw. Physics x/z equals raft-local
  x/z. Only y needs `deckY()`, which bobs. Store posts in grid cells, compute world y each frame, and parent
  the meshes to `ctx.raft` so they bob and tilt for free.

**Co-op avatar**
- `game.js:1952` sends the local pose `{x,y,z,yaw,pitch,swimming,grounded,held,...}`. `coop-avatar.js:5,183-196`
  draws the remote avatar at that position and uses the air pose (legs tucked) when `grounded === false`.
  A rider pinned by the rider's own client therefore shows up correctly on the other screen with no new
  fields. Optional: add `ride:true` for arms raised, as a follow-up.
- `coop-interp.js:51` `SnapshotBuffer` smooths the remote pose at about 8 Hz, and a constant glide
  interpolates well.

**Content hooks and prompts**
- Module shape: `content.js:7-27`. Register the module in FEATURES (:47). Save goes through `world.ext[name]`
  via serialize/load (`EXT_MAX` 200k).
- Prompts: content prompt HTML is now bridged to `#lrPrompt` (`game.js:735` provides id 'content',
  priority 1, through `promptParts`, content.js:62). A separate `raftPrompts.provide` is only needed
  for a higher priority. Engine (`engine.js:254`) and instruments (`instruments.js:193`) are prior art for that.
- Rope item: `items.js:114` (progression system). Recipes live there (`hand({...})`, `unlock: discover('rope')`,
  as in :152). Suggested Zipline Post recipe: wood 4, rope 1.
- Tests to imitate: `tests/sleep.test.mjs` (pinning and actions), `tests/paint.test.mjs` (pruning against
  pieces), `tests/content-prompts.test.mjs`.

## (c) Risks

- **Desync.** The host owns posts and lines (`zipline.post`, `zipline.link`, `zipline.unlink`, consuming rope
  from the actor's bag). Riding is local and client-driven, like walking, so there are no ride actions. The
  rider moves their own physics, and the pose reaches the other player through the normal pose stream.
  `load(data,'net')` should compare a revision counter and rebuild line meshes only when it changes.
- **Getting stuck.** Line validation should reject a line that passes through walls, roofs or floors: sample
  about 12 points against the grid boxes (or only require clear headroom). Walls built after linking are
  still possible, so `building.postStep` may shove a rider. While riding, ignore that shove by pinning in
  afterMove. On a stall (UI opens, line vanishes, NaN) auto-drop: stop pinning and let the player fall
  softly. Dismount at a post should use `getUpSpot`-style logic (`sleep.js:63`) so the player lands on a
  real tile.
- **Links outliving piece removal.** `building.apply` cannot veto removal. Use paint's pattern
  (`paint.js:55` `prunePaint`, called on a `world.pieces` identity change, :208): drop posts whose floor or tile is
  gone, drop their lines, refund rope to the host or let it be lost (cozy choice: drop a rope item). Also
  prune posts whose deck tile was removed. `floorRemoveBlock` (`placement.js:97`) only knows decor, not ext.
- **A rider when a line is pruned.** Release the pin that same frame.
- **Save compatibility.** `load(undefined)` gives `{posts:[],lines:[],rev:0}`. Validate integers, clamp l to 0..5,
  drop lines that point at missing ids, and cap counts (for example 40 posts and 40 lines). No core
  save fields change.
- **Sleep, diving and steering conflicts.** Refuse to ride while lying down, diving or steering. Sleep's afterMove
  would fight the zipline's, so check `raftDebug.content.sleep` state, or simply refuse to start when not
  grounded on the deck.
- **Two riders on one line.** Allowed, since there is no collision between players. Keep it simple.
- **Hammer removal of the post itself.** A post is not decor, so the X/hammer path will not find it.
  It needs its own aim test and a `zipline.remove` action that refunds wood and rope.
