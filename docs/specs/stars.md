# Shooting-star nights ("Wishing Nights") spec

On about one night in three a gentle meteor shower crosses the sky. Look at a falling star, press E, and a small
cozy gift turns up. There is no fail state and no grind. Everything is derived from the daynight `{seed, clock}`, so
host and guest see the same sky with **no new net traffic** apart from the wish action and the tiny ext slice.
Research and anchors: docs/features/stars-research.md (anchors re-checked on `claude/loop-features-202611210952`).

## Files
- `dist/stars-core.js` (pure, no THREE): constants, night choice, meteor schedule, wish validation, gift pick,
  slice clean/serialize. Imports only `DAY_SECONDS, hash01, weatherAt` from daynight.js.
- `dist/stars-model.js`: `createMeteorMesh(T)` builds one fixed-buffer `T.Points` plus its ShaderMaterial.
- `dist/stars.js`: `createStars(ctx)` content module (`name: 'stars'`). It goes in content.js `FEATURES` right after
  `createStorm`.
- `dist/daynight.js`: add `get clock()`, `get seed()` and `get skyA()` next to `get day()` on the module return (line 782).
  `skyA` returns the per-frame `starA` (line 585), stored in a closure `let skyA = 0`. The off path
  (`createDayNightOff`) gets none of these.
- `dist/audio.js`: `'twinkle'` in `EVENTS` (24), `MIN_GAP.twinkle = 0.3` (35), and a recipe modelled on `chime` (389).
- `dist/logbook.js`: `wish1` and `wish10`, plus the logbook tab (see Logbook).
- `tests/stars.test.mjs`. Update `tests/logbook.test.mjs:22` (`ACHIEVEMENTS.length` +2 from whatever it is then).

## Night choice (pure)
Salts 61-70 (daynight and storm use 1-7). `SHOWER = {P:.3, FROM:.70, TO:.95, GAP:4, JIT:3, SLOTS:75, CAP:5, SLACK:2}`.
- `isShowerNight(seed, day)`: false if `!(day >= 1)` (the first night of a world, day 0, is never one). For day 1 it
  returns true unless it rains, so new players meet the shower early. Otherwise it needs `hash01(seed, day, 61) < .3`.
  For every day the night is **skipped if it rains**: `weatherAt(seed, base + f*DAY_SECONDS, scratch).weather === 'rain'`
  for any f in {.70, .82, .95}, where `base = day*DAY_SECONDS`. That is 3 pure lookups, so memoise the last
  `(seed, day)`.
- The shower window is phase .70 to .95 of the same day index (300 s of full night, inside the nightFactor plateau).

## Meteor schedule (pure, O(1))
`meteorAt(seed, day, k, out)` for `0 <= k < 75` sets `out.ok=false` when `hash01(seed, day*128+k, 62) < .07`
(gaps give about 70 meteors a night). Otherwise it fills:
- `t0 = day*1200 + 840 + k*4 + 3*h(63)` as an absolute clock, `life = .6 + .5*h(64)` (always at least .6 s, which keeps it readable).
- The radiant per night: azimuth `2π*hash01(seed, day, 65)`, elevation 50-70°. The start direction sits 8-30° from the
  radiant, rotated by `h(66)`. The meteor travels away from the radiant by `len = 12 + 13*h(67)` degrees. Clamp the
  start elevation to at least 20° and the end to at least 12°, so heads never dip into the horizon haze.
- `tint`: index `floor(3*h(68))` into `[0xffffff, 0xffe9a8, 0xbff5e6]` (white, pale gold, seafoam).
- Directions are unit vectors (the sky follows the camera), written into `out.a` (start) and `out.b` (end) as plain
  `{x,y,z}`. `headDir(m, t, out)` gives the normalised lerp at `u = clamp((t-t0)/life)`.
- `aliveAt(seed, clock, list)`: `day = floor(clock/1200)`, `k = floor((clock - day*1200 - 840)/4)`, check k-1..k+1,
  and fill a caller-owned 3-slot list with no allocation. That is O(1) whatever the clock.

## Client (every peer)
- `update(dt)`: read `dn = peer('daynight')`. If it is missing, or `dn.clock`/`dn.seed` is not finite (which covers
  `?daynight=off` and old builds), hide the mesh and return. Also hide it underwater, using the same test as rain at
  daynight.js 629. Otherwise fill the alive list and write at most 3 slot uniforms.
- **Mesh**: one `Points`, 3 slots × 24 vertices (head plus a fading tail), built lazily into `ctx.scene` with additive
  blending, `depthWrite:false`, `renderOrder -4` (over the stars), and `frustumCulled=false`. Each frame it gets
  `position.copy(camera.position)`. The vertex shader places vertex i at `R=130 * slerp(a, b, u - i*tailStep)` with alpha
  `(1-i/24)^2 * fadeIn/Out * uSky`, where `uSky = dn.skyA`. That means clouds dim the meteors and daylight hides them.
  Per-slot uniforms are `uA[3], uB[3]` (vec3), `uT[3]` (vec4: t0, life, tint index, flare), plus `uClock` and `uPx`.
  Points use `gl_PointSize` scaled like `STAR_VS`. Nothing is rebuilt per frame, and scratch vectors are module scope.
  `dispose` frees the geometry and material.
- **Wish input (decision: E plus a soft look glow, no dwell).** The aim direction is `ctx.aim()?.dir`, falling back to
  `ctx.camera.getWorldDirection(v)` when the pointer is not locked. A meteor counts as aimed when
  `dot(dir, headDir) > cos(5°/zoom)`, where `zoom = ctx.content?.zoom?.() || 1` (so the spyglass does not make it trivial).
  When it is aimed, that slot's flare uniform eases to 1 for a soft glow, and `prompt()` returns `<kbd>E</kbd>Make a wish`
  through the existing `raftPrompts` bridge (game.js 779). E triggers `interact()`, which returns true **only** while a
  meteor is aimed, `ctx.aim()?.point` has no target within reach, and the host slice is `v:1`, so it never steals a
  bed or a decor E. There is no dwell: it would fire by accident when you only meant to watch.
- When E is pressed, the client sends `ctx.action({kind:'stars.wish', day, k})`, marks `k` as pending locally (so it
  cannot double-press), sets a local flare (3x for .3 s), and calls `ctx.play('twinkle')`.
- **Dusk notice**: once per (day) on a shower night, when the phase crosses .64 (before beds allow sleep at .66),
  every peer calls `ctx.notice('The sky feels sparkly tonight. Stay up and look for falling stars!', 6000)`. Sleeping
  skips the shower by design. The notice is the warning, and there is no dream-wish. A load or a clock jump past .64
  does not replay it, because the module remembers `lastNoticeDay`.

## Host action `stars.wish {day, k}`
`checkWish(slice, actor, seed, clock, a)` (pure) returns `{ok}` or `{ok:false, why}`. It requires: `a.day` and `a.k`
are ints, `isShowerNight(seed, a.day)`, `meteorAt(...).ok`, `t0 - 2 <= clock <= t0 + life + 2`, `a.k` is not in
`slice.night[actor]`, and fewer than 5 entries in it. `slice.night.day` must equal `a.day`, or else it is reset to it first.
On ok: `gift = giftFor(seed, day, k, actor)` from the weighted pool `{flowerseed:3, berries:3, coconut:2, honey:2,
rope:2, glass:2, candle:1, skyrocket:1}` (all existing items.js ids, actor salt 69 for host and 70 for guest).
Then `ctx.actorBag(actor).add(gift, 1)`. If the bag is full (`add` returns 1), the host emits
`{kind:'notice', text:'Your bag is full; the star waits for you.'}` to that actor and does **not** consume `k`.
Otherwise the host pushes `k`, bumps `wishes[actor]`, and emits
`{kind:'loot', text:'A wish came true: + 1 <Name>', loot:{[gift]:1}, sound:'twinkle'}` to the actor (a pickup-feed
row with an icon). It then calls `ctx.award({kind:'wish', n: wishes[actor]})` and `ctx.observe({kind:'wish'}, actor)`.
If the wish was the actor's 5th that night, or `k` is the night's last alive slot, it adds a feed line
`The shower fades. N wishes tonight.` A refused wish is silent; the client clears its pending mark after 3 s.

## State `world.ext.stars`
`{v:1, wishes:{host:int, guest:int}, night:{day:int, host:[k..], guest:[k..]}}`. `cleanStars(d)`: `load(undefined)`
or any garbage gives the defaults. Counts are ints clamped to 0..1e6, lists keep unique ints in 0..74, at most 5 each.
`load(d, 'net')` only copies numbers into the existing object (no allocation when nothing changed). Old saves have
no slice and so get the defaults. Old hosts never send `v:1`, so a new guest never shows the wish prompt to them.

## Audio `twinkle`
Four sine pings drawn from `SCALE` (44), high octave (×2), 60 ms apart, quick attack, 0.25-0.4 s decay, about
0.05·s gain, plus a faint 2.6 kHz shimmer. The survival audio test (1091) plays every event, so a recipe is required.

## Logbook
- `a('wish1', 'Wish Upon a Star', 'Make a wish on a falling star.', 'compass')` → `ev.kind === 'wish'`.
- `a('wish10', 'Stargazer', 'Make 10 wishes on falling stars.', 'compass')` → `ev.kind === 'wish' && ev.n >= 10`.
- **Wishes made**: the stars module uses the generic logbook extra-tabs hook that the shells spec owns in
  logbook-ui.js. Stars must not hand-edit tab lines. At the time of writing, docs/specs/shells.md does not exist yet,
  so this is the **minimal API stars needs** (shells may extend it):
  a content hook `logbookTabs(out)` that each module may implement by pushing `{id, label, view}`. `view()` returns
  `{sig, html}`, where html is escaped by the module. content.js collects into a reused array, game.js passes
  `tabs:{list:() => content?.logbookTabs?.() ?? []}` to `createLogbookUI`, and logbook-ui creates a tab button and panel per
  id on open, re-rendering when `sig` changes. Stars pushes `{id:'stars', label:'Night Sky', view}`, with the label
  `Night Sky ✦N` (the local actor's wishes). The view shows "Wishes made: N", "Tonight: a shower is falling / a quiet
  sky" (or "Next shower: in D days" by scanning at most 10 days ahead with `isShowerNight`), and the wishes made
  tonight, as M/5. If the shells hook has not landed when stars is built, the fallback is to skip the tab (keeping the
  achievements). Do not add an ad-hoc tab.

## Debug (`raftDebug` via the content `debug` hook)
`stars.state()` returns the slice, `{night, day, alive:[k..]}`. `stars.forceNight(day)` is host and QA only: an
in-memory override set that makes `isShowerNight` true, never saved. `stars.aimAt(k)` points the camera yaw/pitch at
meteor k's head. `stars.wish(k)` sends the action for the current day.

## Tests `tests/stars.test.mjs` (node, pure core only)
1. Night choice: same `(seed, day)` gives the same answer, day 0 is never a shower, day 1 is one unless it rains,
   rainy nights are always false, and the rate over 2000 days for 3 seeds is within .2 to .3 (after rain).
2. The schedule is deterministic. `t0` values increase in k and fall inside [.70, .95] of the day, `life >= .6`, direction
   vectors are unit length, and elevations are at least 12°.
3. O(1) lookup: `aliveAt` matches a brute-force scan over all 75 k for 5000 random clocks, and it never returns more than 3.
4. `checkWish`: ok inside the ±2 s slack and refused just outside it; refused on a non-shower or rainy night, a bad
   k/day type, a repeat k, or the 6th wish (cap 5). A new day resets `night`. Host and guest caps are independent.
5. `giftFor` is deterministic, always an id in the pool, and differs for host and guest across a sample.
6. `cleanStars`: undefined, garbage, negative or float counts, oversize lists and duplicates all give a valid slice,
   and serialize(clean(x)) round-trips.
7. Audio: `EVENTS` includes `twinkle` (covered by the survival test once the recipe exists).

## QA plan
- `npm test` passes, including the logbook count.
- Screenshot probe (a copy of scratchpad shoot.py): `raftDebug` sets phase .80 with `stars.forceNight(day)` and clear
  weather, then `stars.aimAt(k)` mid-life for the alive k. Shot 1 is a night sky with a bright head, a tail and the
  E prompt visible.
- Then `stars.wish(k)`, wait 300 ms. Shot 2 shows the flare and the pickup-feed row "A wish came true: + 1 …" with
  the item icon. Check that `stars.state()` reports wishes 1 and `wish1` is in `world.achievements`.
- A day shot (phase .3) shows no meteors. An underwater shot shows none. `?daynight=off` loads with no errors and
  no mesh. A guest probe, if the harness supports co-op, gets the same `alive` k list as the host at the same clock.
