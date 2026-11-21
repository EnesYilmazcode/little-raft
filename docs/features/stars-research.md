# Shooting-star nights research

Goal: on some nights a gentle meteor shower crosses the sky. You look up at a falling star and make a wish, and
a small gift turns up. There is no timer to beat, no fail state and no rare drop to grind for.
Line numbers are from branch `claude/loop-features-202611210952` (based on raft-master `92cd4ea`).

## 1. Night sky events in other games (reference only, our take is original)
- **Animal Crossing: New Horizons.** On clear nights shooting stars sometimes fall. You look up and press A to wish,
  and star fragments wash up on the beach the next morning. Notes: an announcement says it is a shower night, the
  wish is a simple look-and-press, and the reward is delayed and small. This is the closest genre precedent.
- **Stardew Valley.** A meteorite can land on the farm overnight as a random night event and leave rare stone.
  Notes: rare events are rolled per night, and a morning message explains them.
- **Sky: Children of the Light / Journey.** The sky is used as calm spectacle with no reward. The wonder comes from
  motion and light alone.
- **Real meteor showers** (Perseids, Geminids). Meteors seem to stream out of one point in the sky (the radiant), last
  0.2 to 1 s, have short bright heads with fading tails, and come every few seconds to minutes. Many folk traditions
  say you should make a wish on a shooting star.
- **Constellation games** (Outer Wilds sky, Animal Crossing Celeste). Naming star patterns works as a collection.
  It is possible later work, out of scope here.
- **Shared patterns:** the event is announced softly, it is rare enough to feel special but frequent enough to be
  seen, the interaction is "look up and press" with a forgiving cone, the reward is small and cosmetic or cozy, and in
  multiplayer everyone sees the same sky.

## 2. Our original take (proposal): "Wishing Nights"
- **Which nights.** Night `day` is a shower night when `hash01(seed, day, SALT_STARS) < 0.3` (about 1 night in 3).
  The first night of a new world is never one, so the event stays a surprise. Day 1 or 2 can be forced so the
  player learns about it early. Rain hides it: if `weatherAt(seed, midnightClock)` is `rain`, that night is skipped
  in the pure schedule, so the stars never hide behind clouds while the notice promises a show.
- **Dusk notice** (phase about 0.64, once per night, local `notice`): "The sky feels sparkly tonight". A guest gets the
  same line because it comes from the same pure schedule.
- **Schedule** (pure, no `Math.random`): the shower runs from phase .70 to .95, which is about 300 s of full night.
  Meteor `k` starts at `t_k = start + k*GAP + jitter(hash(seed, day, k))` with GAP about 4 s, which gives about 70 per night.
  Each meteor also gets a head direction near one radiant (the radiant drifts per night, `hash(seed, day, 7)`), a path
  12 to 25 degrees long, a life of 0.6 to 1.1 s, and a tint from a soft palette (white, pale gold, seafoam).
  Because every value is pure in `(seed, day, k)`, host and guest draw the same meteor at the same moment and **no net
  traffic is needed** beyond the existing daynight `{clock, seed}`.
- **Wish.** The crosshair has to sit within about 5 degrees of the meteor head while it is alive. The player then
  presses **E**, or simply keeps looking for 0.5 s (looking alone counts, which makes it touch- and accessibility-friendly).
  The client sends `ctx.action({kind:'stars.wish', day, k})`. The host checks: is this a shower night, is meteor
  `k` alive at the host clock (plus or minus 2 s slack for guest drift), has this actor not wished on `k` before, and
  has this actor made fewer than 5 wishes this night. Then the host adds one gift to `ctx.actorBag(actor)` and emits
  `{kind:'loot', text:'A wish came true: + 1 Honey', loot:{honey:1}}` to that actor, which gives a pickup-feed row with
  an icon. It also bumps that actor's counter. Each player wishes on their own star, so no one takes a star from the other.
- **Gift pool** (existing item ids, weighted, all cozy): `flowerseed`, `honey`, `berries`, `coconut`, `rope`, `glass`,
  `candle`, `skyrocket` (rare, a nice loop back to fireworks). The pick is `hash(seed, day, k, actorSalt)`, so it is
  fair and can be replayed in tests. When the shells or kite features land, a "star shell" or a star-pattern kite
  ribbon could join the pool.
- **Feedback.** The meteor flares and splits into a few twinkles (the head shows 3x brighter for 0.3 s locally), and a
  new `twinkle` sound plays. A wish made on the last meteor of the night shows a soft feed line: "The shower fades.
  N wishes tonight".
- **Logbook.** Slice `world.ext.stars = {v:1, wishes:{host:n, guest:n}, night:{day, host:[k..], guest:[k..]}}`. The
  `night` lists are capped at 5 and reset when `day` changes. Achievements: `wish1` "Wish Upon a Star" (first wish) and
  `wish10` "Stargazer" (10 wishes). The Achievements tab could show "Wishes made: N" as a subtitle, or a stat card.

## 3. Code anchors (current tree)
**daynight.js**
- Day length is `DAY_SECONDS = 1200` (6). `DAYNIGHT_LIVE = {phase, optOut, ready}` (32) holds the phase only.
  `STORM_LIVE` (34) mirrors `clock`, `seed` and `nf` every frame (`update` 686, `nf` 521). This is the cheapest
  zero-allocation way for another module to read `clock` and `seed`. Better still, add `get clock()` / `get seed()`
  getters next to `get day()` on the module return (782) and read them through `peer('daynight')`.
- `phaseAt` (39), `lightAt` (50; nightFactor ramps up from .62 to .72, holds, and fades from .92 to 1.02, wrapped) and
  `hash01(seed, index, salt)` (61), which is what the schedule should reuse. Also `weatherAt(seed, clock, out)` (108),
  `stormAt` (123), `sleepable` (37: `p >= .66 || p < .04`) and `skipClock` (25).
- Stars: `STAR_COUNT=700, STAR_RADIUS=140, MOON_DIST=120` (276). They are a `T.Points` built once (360-377), with
  shaders at `STAR_VS` (202, `gl_PointSize` 212), additive blending, `renderOrder -5` and `frustumCulled=false`.
  Their visibility is `starA = nf*(1-.85*cloud^2)*(1-wet)` (585). **They follow the camera**:
  `stars.position.copy(cam.position)` (624), and the moon is at `cam + vMoon*MOON_DIST` (625). A meteor mesh should do
  the same: place it at `cam.position` and give its vertices at radius about 130, inside the star shell. Because of
  this, a sky direction is just a unit vector, whatever the camera position.
- `owned`/`attach` (414/416) is the pattern for adding module meshes to the current scene. `dispose` (729) frees the
  geometry. The day index is `Math.floor(clock/DAY_SECONDS)` (getter at 782, and `ctx.dayIndex()` at game.js 463).
- `action` (720) handles host `daynight.skipTo` from sleep. `createDayNightOff` (296) is the `?daynight=off` no-op path.
**fireworks.js (prior art for sky sparks)**
- It works from a pure top half: `hash32` (26), `fwRoll` (36), `cleanFwMsg` (45) and `windowGate` (55).
- `createSparkPool` (fireworks-model.js 163) builds a fixed-size `Points` with per-vertex random attributes and
  uniform slots `uSlot`/`uShape`. The GPU animates the sparks, so the CPU only writes a few Vector4 uniforms per frame.
  Meteors fit the same pattern: N slots (say 4 alive at once), each a short line or point trail of about 16 vertices.
- It builds lazily into `ctx.scene` (105-115), shows the pool only while it is live (182), sets the pixel scale
  `uPx` (185-188), and sets `BUDGET` per graphics level (11).
- Co-op: the host validates `fw.light` (247) and emits `{kind:'fw', ..., sound:'none'}` to `'all'` (259), which
  `effect` consumes (263). Stars need no effect message because the schedule is pure.
- It uses the `ctx.night()` fallback (99) and adds a hemisphere flash after daynight writes the light (190-198).
  A wish flare should **not** touch the lights.
**Aim / camera**
- `ctx.aim()` returns `frameAim` (game.js 464, set at 1823), which is `{point, dir, ...}` from `pickCenter` (1014).
  It is **null when the pointer is not locked or a dialog is open** (1015-1019). Fall back to
  `ctx.camera.getWorldDirection(scratch)`. The test is `dot(dir, headDir) > cos(5 deg)`. For prior art for an
  angular cone test on a ray, see `fireworks.js target` (200-220).
**Audio**
- The name "wish" is **not** a sound in audio.js. It only shows up inside "swish" (320, 453).
  `EVENTS` (24) and `MIN_GAP` (35) need a new `'twinkle'` entry. You can model it on `chime` (389), as 3 to 4 high
  sine pings in D pentatonic from `SCALE` (44). tests/survival.test.mjs 1091 plays every event, so it also needs a
  recipe. A bare play is `ctx.play(ev, s)` (game.js 460), which stays local.
**Logbook**
- `ACHIEVEMENTS` (logbook.js 27), `evaluate` switch (75-105), event-based ids such as `firework1` (34, 91).
  The award call is `ctx.award({kind:'wish', n})` (game.js 471, then `award` 1177). It is host only and pushes to
  `world.achievements`. tests/logbook.test.mjs 22 asserts `ACHIEVEMENTS.length === 17`, so update that test.
  The tabs are in logbook-ui.js 89-96, and `render` (185) writes the tab labels. A wish count would need a getter in
  `createLogbookUI`, the way `tasks.view` comes from `content.tasksView` (game.js 2553, content.js 174).
**Content hooks / co-op**
- The hook list is the content.js header (7-60) and `FEATURES` (94). Put `createStars` after `createDayNight` and
  `createStorm`. The useful hooks are `update`, `prompt`, `interact`, `action`, `serialize`/`load` and `debug`.
  `content.interact` goes first-wins (147), so return true only while a meteor is aimed.
- Prompts: `#contextPrompt` is hidden, and game.js forwards the content `prompt()` result through
  `raftPrompts.provide({id:'content'})` (game.js 780). An aimed-star prompt "E Make a wish" therefore shows without
  extra work, but it is only useful while the pointer is locked.
- Gifts go through `emit` (game.js 1149) with `{kind:'loot', loot}`, which shows pickup-feed rows (1162). Guests get
  their bag through state sync. `ctx.notice` (game.js 708) feeds the bottom-left feed for the dusk line.
**Perf**
- Use one `Points` or `LineSegments` with a fixed buffer, allocated at build time. Animate in the shader from a few
  uniforms (slot start time, head direction, tail direction, life, tint). Rebuild nothing per frame. Keep scratch
  Vector3s. The schedule lookup is O(1): `k = floor((clock-start)/GAP)`, and you check k-1..k+1.

## 4. Risks
- **`?daynight=off` / disabled daynight.** `createDayNightOff` (296) adds no sky. Then `STORM_LIVE.ready` stays false
  and the stars module must do nothing: no notice, no meteors, and the host refuses `stars.wish`.
- **Sleep skips the night.** sleep.js 177 jumps from phase .66 or later straight to MORNING, which skips the whole
  shower. Options: show the dusk notice at .64, before beds work, so players can choose to stay up. Or, on a
  shower night, give one "dream wish" after a skip (sleep `skips` changes, sleep.js 178). Recommendation: keep it
  simple and mention it in the notice ("...stay up and look").
- **Clock drift and jumps.** Guest drift is at most SNAP_SECONDS = 5 s (16), which explains the 2 s host slack plus the
  1 s meteor life. `debug.setPhase` and skips jump the clock, so key the schedule on the absolute clock, not on
  accumulated dt. `MAX_CLOCK` wrap (12): `day` resets, which is harmless.
- **Co-op fairness.** Each actor has their own counter and their own per-night `k` list, so neither can take the other's
  star. There is a cap of 5 per night. The host checks reach by time only (the sky follows each camera, so there is no
  position check). Old hosts ignore `stars.wish`, so the guest should show the prompt only when the host slice has `v:1`.
- **Saves.** `load(undefined)` must give defaults. Validate counts as ints and clamp them. A `'net'` load only copies
  numbers.
- **Weather and visibility.** Clouds dim `starA` (585). Scale meteor alpha by the same term, so they don't shine
  through overcast. Under water, hide them (as rain does, 628).
- **Spyglass zoom** (`ctx.content.zoom`) makes the 5 degree cone look large. Divide the cone angle by the zoom
  factor, or accept it.
- **Accessibility.** Looking alone (0.5 s) counts as a wish, so E is not required. Keep the meteors slow enough, with
  a life of at least 0.6 s.
