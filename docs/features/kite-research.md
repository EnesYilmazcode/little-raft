# Kite flying: research

This note replaces the earlier Sky Kite note (hand-held steering, tying to railings). The new design is
**Kite Post first**. You craft a kite, place a Kite Post on the deck, and press E with the kite to clip it on.
It then flies downwind on the live wind. Hand-flying is an optional extra. The closed-form flight model from
the old note still fits, so it is kept and simplified. All anchors are file:line in the current tree on
2026-11-21 (`claude/loop-features-202611210952`, based on `92cd4ea`). Re-grep before you edit.

## (a) Patterns and an original cosy take
- **The genre.** Raft and island sandboxes use decor that reacts to wind: pennants, wind chimes, turbines,
  flags. Kite games (beach kite toys, festival kites in life sims) read well because of a few cues: the kite
  sits high downwind on a *visibly sagging* line, it bobs and swings in figure-eights, the tail ribbons lag and
  flutter, and in calm air it sinks or droops. Most players never need "real" aerodynamics. They need the
  kite to point the right way, hang at a believable height, and move all the time.
- **Our take, "Kite Post".**
  1. Craft a **Kite** (cloth, or plastic in this tree, plus wood and rope) in 4-5 colours. Each colour is its
     own bag kind (`kite_coral` and so on), stack 1. The names are ours: Coral, Sunshell, Seafoam, Lagoon, Plum.
  2. Craft and place a **Kite Post**: a short stout post with a spool/reel on top. It is a placeable decor
     with a small block radius.
  3. Hold a kite and press **E** at an empty post: the kite clips on and climbs over about 3 s. Press E at a
     post with a kite (empty hand, or any item): the kite reels in and goes back to the bag.
  4. **Flight.** The kite flies downwind at 8-15 m altitude. The line length is about 14-20 m, and the
     elevation follows wind strength. It bobs, rolls a little, and swings slowly side to side. The line sags
     more in weak wind. Two or three tail ribbons trail downwind with a travelling sine wave.
  5. **Calm.** At low weather wind (daynight `wind` ≈ 0.15) the kite hovers low (about 4-6 m), droops nose-down,
     and the tail hangs. In a storm it climbs to the top of the range and twitches faster. It never breaks,
     which keeps it cosy.
  6. **Optional: hold by hand.** With a kite selected, LMB launches it from your fist for about 60 s. The line
     starts at the right hand, and the kite lands on its own when the time ends or you switch slots. This is
     purely local flair and can be skipped in v1.
  7. **Optional tiny reward.** Logbook line "Kites flown: N", or a gull that sometimes circles a high kite
     (wildlife already has gulls). No economy hook is needed.

## (b) Code anchors

### Wind (both sources are shared in co-op)
- **Sailing wind (direction plus base strength):** `dist/sailing-core.js`. `windDir` is the heading the wind
  blows *toward*, and `windVector()` at :100-102 gives `(sin a, cos a) * windStr`. `windStr` stays in
  `WIND_MIN..WIND_MAX` = 0.55..1 (:17) and eases with τ = `WIND_STR_TAU` 20 s (:16). The wander in
  `stepSailing` :113 runs **host-only** (`if (o.host)` :123, with `Math.random`), so it is *not* deterministic.
  Guests take `world.sailing` from `hostState()` (`dist/game.js:1797`, the `sailing:world.sailing` field
  at :1800). The values change slowly, so a guest kite matches without any extra sync.
- **Raft velocity:** `world.sailing.vx/vz` (`sailTarget` :86). Use the apparent wind `W = windVector - (vx,vz)`
  so a sailing raft makes the kite lean back and climb.
- **Weather wind (gustiness or strength scalar):** `dist/daynight.js`. `W_WIND = [0.15, 0.7, 0.5]` (:101) is
  blended at :104, and the getter `get wind()` is at :782. Weather is a pure function of (seed, clock)
  (header :3-4), so both peers compute the same value. Content-side access: `ctx.content.wind()`
  (`dist/content.js:171`), or the `link(env)` hook (`content.js:34`, called at :137), which is how `dist/power.js:136`
  reads it. The storm level is on the same module, `get storm()` (`daynight.js:782`, `STORM_LIVE` :34).
- **How existing cloth reacts (copy these conventions):**
  - Sail pennant: `dist/sailing-world.js:142-143` (downwind = `windDir - heading - PI/2` in the group frame)
    and :182 (yaw plus `amp*sin(t*(5+4*windStr))`).
  - Wind Pennant decor: `dist/decor-pack.js:167-174` (`amp = .08 + .35*ws*ws`, swing `rotation.y = wd - PI/2 - g.rotation.y`).
  - Raft flag: `dist/flags.js:15-16` (frame note), :192-199 (per-frame pivot yaw, uniforms only).
- **Raft frame:** "The raft never moves in x/z: the world drifts past it instead" (`sailing-world.js:3`).
  Raft-local and world x/z are the same, and the raft never yaws. Only y bobs, via `ctx.deckY()` (content ctx,
  `content.js:55`). A kite anchored to a post needs no scrolling compensation. Just re-add `deckY()` every
  frame. The sky and islands drift, which sells the motion.

### Line and rope rendering (prior art)
- `dist/rope.js:19` `createRope(T,{segments,radius})` is a tube with no allocations in `update()`. Its radius
  is clamped to 0.002-0.02 (:7-8). Nothing in dist imports it except `textures.js`. A 1-2 cm tube at 15 m is
  sub-pixel and shimmers, so do **not** use it for the kite line.
- Fishing line: `T.Line` + `LineBasicMaterial` (`game.js:495`). `setRope(points)` at :1629 writes into a
  preallocated attribute and calls `setDrawRange`. **This is the pattern to copy:** one `T.Line` per kite, about
  16-20 points on a sagging catenary-ish parabola, `frustumCulled=false`.
- Glide lines: `dist/zipline-model.js:73` `createRopeLines`, one `InstancedMesh` of straight cylinders
  (`userData.set(i, a, b)` :80). These are straight with no sag. They are useful only if a thicker line is wanted near the post.

### Fluttering cloth (prior art)
- `dist/flags-model.js:11-18`: the `WAVE` vertex-shader chunk injected after `<begin_vertex>`. The hoist is
  pinned, the phase comes from the model matrix (no per-instance uniform), `famp = .04+.14*uStr²`, and the
  fly end droops in weak wind (`y -= .06*fu²*(1.2-uStr)`). The uniforms `uTime/uStr` are set once per frame
  (`flags.js:195`). **Reuse this idea for the tail ribbons:** a thin strip mesh (8-10 segments) with the same
  shader trick, so the CPU only moves the kite transform. The sail itself can get a tiny billow on the same material.

### Decor placement, models and pickup
- **Which item system:** the crafting UI merges `CONTENT_ITEMS/CONTENT_RECIPES` and then `infoTable()/recipeTable()` from
  `dist/items.js` (`inventory-state.js:33,55,83,91`). items.js wins. The newest decor (glide posts) lives in
  items.js: `item('glidepost', …, {placeable:true, recipe: hand({...}), unlock: discover('nail')})` at
  `items.js:308-313`. Put **Kite Post and the kite kinds in items.js**. Materials are `wood` :82, `leaf` :84,
  `plastic` :86 and `rope` :131. There is no "cloth" kind, so use plastic or leaf as the sail cloth.
- `PLACEABLE_IDS` (`items.js:338`) feeds `DECOR_TYPES` (`game.js:86`). Add `kitepost: 0.12` to `BLOCK_RADII`
  (`items.js:341`, zipline entry at :356). These merge into `BLOCK_RADIUS` (`game.js:96`).
- Model: content `decorModel(type, d)` (`content.js:21`, dispatch at :164). game.js calls it for ghosts (:493)
  and for the built decor (:655). Copy `zipline.js:496-500`.
- E order: `interact()` at `game.js:1421`. Pickups, sails, nets and building go first, then `content.interact`
  at :1436. Aim-test the post like `flags.js:90-100` (a ray against the vertical mast segment).
- Pickup with the hammer (hold X): `beforeUndecor`/`undecorLoot` (`content.js:35-41`, `NO_UNDECOR` :95,161).
  A post with a kite on it must return the kite through `undecorLoot` (as `[kind,1]`) and then drop its
  `ext` entry, so the kite is never lost.
- Hold model (optional hand-flying): `HOLD` (`dist/held-items.js:42`). Remote held prop: `HELD` (`dist/coop.js:27`)
  is **append-only** because its index is the wire format.

### Colours
- Paint: `dist/paint.js:8-15` `PALETTE` (Seafoam #9fd3c1, Coral #e9a08c, Sunshell #f1d78d, Lagoon #86b3d6,
  Pebble). Flag: `dist/flags-core.js:5-6` (8 colours including Plum #8a5a8f and Navy). Use the flag palette
  hexes so kites match flags. A recipe can take a `paint_<id>` pot (`PAINT_KINDS` paint.js:16) as the dye,
  or the colours can be free per recipe. Vertex colours (sail, plus a contrasting stripe and tail) keep one
  material for every colour.

### Per-frame budget
- `update(dt)` allocates nothing (`content.js:8`). Use module scratch vectors and `Float32Array` line buffers.
- Per kite: the sail plus spars merged into 1 mesh with vertex colours (about 40 tris), 1 `T.Line`, and 1 tail
  strip (shader-waved). That is 3 draws. Merging the tail into the sail mesh brings it to **2 draws**, and
  merging all kites into one instanced sail mesh plus one `LineSegments` gives about 2 draws total. Cap posts
  at 6-8. `castShadow=false` for kite and line, because a shadow on the deck from 15 m is mostly off-raft anyway.
- Merge helper: `dist/merge-geo.js` (used at `sailing-world.js:6`).

### Co-op
- Slice `world.ext.kite = {v:1, r, p:{'x,z': colourIdx}}`: the post tile and the clipped kite colour, small
  ints only (flags-core style). Actions `kite.clip {x,z,k}` and `kite.unclip {x,z}` are host-validated: the
  decor is a `kitepost`, the actor's bag has or can take the kind, and reach is checked (`flags-core.js:23`
  `REACH=3.2, HOST_SLACK=.8`). `load(…,'net')` rebuilds only when `r` changes, and
  `hostState` re-sends ext about 8x/s (`game.js:1848`, `wallTick … 120`).
- The pose is **not synced**. Each peer computes the pose from `(post x,z, deckY, sailing.windDir/windStr/vx/vz,
  daynight.wind, elapsed, per-post phase hash(x,z))`. Daynight is deterministic and sailing comes from the
  host, so the only mismatch is the `elapsed` phase of the bob. That is invisible.
- Hand-held kites are local cosmetics only. Optionally, show the remote one through the `HELD` prop.

## (c) Risks
1. **Stale anchors.** Master moves fast. This note's spec (`docs/specs/kite.md`) and its INDEX line describe the
   *old* hand-steer design and must be rewritten for the post design, or builders will follow the wrong one.
2. **Item system split.** Putting kinds in content-items.js gets overridden by, or misses, items.js
   (unlock gating, icons through `iconTint`). Use items.js like glidepost.
3. **Line through geometry.** A downwind line can pass through a roof, sail or mast. Accept it, or raise the
   elevation when the line hits a piece AABB (`zipline.js:115` `lineBlocked` is prior art). The line may
   also cross the main sail cloth. Keep posts low and kites high to reduce this.
4. **Wind frame bugs.** `windDir` is "toward", not "from", and model +x versus +z needs the `-PI/2` quirk.
   Get it wrong and the kite flies upwind of the pennant. Add a test that compares the kite azimuth with `windVector`.
5. **Guest wind lag.** The host steps the wind and the guest sees it about 120 ms late, smoothed. That is fine
   for a kite. Do not dead-reckon the wind on the guest.
6. **Pickup or loss.** Post pickup and unclip with a full bag must refuse gently (`UNDECOR_TEXT.full`,
   `decor-pickup.js:7`), never delete the kite. Old saves without `ext.kite` must give an empty slice.
7. **Visual noise and perf.** Eight kites with tails could clutter the sky and add about 24 draws. Cap the
   count, merge geometry, and fade the tail amplitude with distance.
8. **Shared IDs.** `HELD` and coop indices are append-only, so check them against concurrent branches (zipline
   and spyglass already appended). The names "Kite", "Kite Post" and the colours are generic and original.
