# Zipline spec

Build two Zipline Posts on the raft (on the deck or on an upper floor), string a rope between them, and
press E to glide along it. The game stays cozy: nothing can hurt you, you can drop off at any time, and you
never get stuck. Research: `docs/features/zipline-research.md`. Anchors checked at 16aedaa: `content.js:7-27`
(hooks, `use` and `alt`, `peek` at :75), `game.js:735` (content prompt bridge), `:1239` (E), `:1274` (use),
`:1394` (afterMove), `:425-428` (ctx), `sleep.js:63,283-288`, `paint.js:55,208`, `building-pieces.js:6,113`,
`player-physics.js:109-111,161-190`, `items.js:62,114`.

## Files
- `dist/zipline-rules.js` is pure (no THREE or DOM). It holds the constants, `cleanZip`, the placement and
  link checks, prune, the parabola, ride stepping and the landing spot. Node tests import it directly.
- `dist/zipline-models.js` builds `postModel(T)` (a 2.0 m pole with a pulley wheel and a small crossbar,
  plus a ghost variant) and `lineMesh(T, pts)` (a TubeGeometry with radius .03 and a rope colour).
- `dist/zipline.js` is the content module `createZipline(ctx, {peek})` with `name: 'zipline'`. It is appended
  to FEATURES in `content.js` with a `// [zipline]` marker.
- Item in `dist/items.js` (progression system, since the crafting UI reads it), after the instruments:
  `item('zippost', 'Zipline Post', 'build', {iconTint:'#a67c4e', stack:4, recipe: hand({wood:4, rope:1}),
  unlock: discover('rope'), tip:'A sturdy pole with a pulley. Build two, then string Rope between them and
  ride.'})`. It is not `placeable`, so it stays out of DECOR_TYPES and a click reaches `content.use`.
- One added line in the game.js ctx (`:428`): `steering: () => !!sailing?.steering, // [zipline]`.

## Rules (`zipline-rules.js`)
Constants: `MAX_POSTS 16`, `MAX_LINES 12`, `MAX_PER_POST 2`, `SPAN_MIN 2`, `SPAN_MAX 14`, `POST_H 2.0`,
`LEVEL_H 2.2` (imported from building-pieces.js), `FLOOR_Y .2`, `SAG_K .04`, `HANG 0.3` (eye below rope),
`SPEED 4`, `DOWN_BONUS 1.2`, `SPEED_MAX 5.2`, `REACH 2.2` (grab), `PLACE_REACH 6`, `START_S .5` (metres).
- Ext state: `world.ext.zipline = {v:1, rev, posts:[{id,i,j,l}], lines:[[a,b]]}`.
- `cleanZip(d)`: any input is accepted, and `undefined` gives `{v:1, rev:0, posts:[], lines:[]}`. Posts need
  integer id ≥ 1, integer i and j with |i|,|j| ≤ 27 and integer l in 0..5. Duplicate ids and duplicate cells
  (same i,j,l) are dropped and the list is capped at 16. Lines must be integer pairs a≠b that point at live
  ids. Each pair is stored as `[min,max]`, duplicates are dropped, posts with 2 lines already are skipped,
  and the list is capped at 12. `rev` is a non-negative integer, otherwise 0. The function never throws.
- `nextId(state)` returns the largest id + 1.
- `supported(world, i, j, l)`: at l=0 the tile (i,j) must be in `world.tiles` (a foundation counts as a
  tile). At l≥1 `world.pieces` must contain `{t:'floor', i, j, l}`.
- `canPost(state, world, i, j, l)` returns '' or a reason: `'full'` (16 posts), `'taken'` (a post is already in
  that cell), `'nosupport'`, or `'decor'` (l=0 and a non-net decor entry is on tile i,j).
- `topOf(p, out)` gives the raft-local top of a post: `x=2i`, `y=FLOOR_Y + l*LEVEL_H + POST_H`, `z=2j`.
  `span(A,B)` is the 3D distance between the two tops.
- `canLink(state, pieces, a, b)` returns '' or a reason: `'missing'`, `'same'`, `'linked'` (the pair exists),
  `'busy'` (one of the posts already has 2 lines), `'lines'` (12 lines), `'short'` (horizontal distance < 2,
  meaning the same column: no vertical lines), `'long'` (span > 14) or `'blocked'`.
- `lineBlocked(pieces, A, B)` samples t = .1, .2 … .9. For each sample, take the cell (round(x/2), round(z/2))
  and every floor or roof piece in that cell at level l≥1 with slab height `h = FLOOR_Y + l*2.2`. The sample
  is blocked if `ropeY-2.0 < h < ropeY+.1` (the rider's body would pass through the slab). The slabs that
  hold up the two end posts are skipped. Walls are not checked in v1: the rider is pinned, so a wall only
  clips visually (follow-up).
- `ropePoint(A, B, t, out)`: x and z are lerped and `y = lerp(yA,yB,t) - 4*S*t*(1-t)` with `S = SAG_K*span`.
  `linePoints(A, B, n=24)` uses it, so the drawn rope and the ride follow the same curve exactly.
- `rideStep(r, A, B, dt)`, where `r = {t, dir}` and dir is +1 or -1. The slope is the curve's dy per unit
  length along dir, read from the analytic derivative. The speed is `v = min(SPEED_MAX, SPEED +
  DOWN_BONUS*max(0,-slope))`, so going uphill keeps the base 4 m/s. The arc speed is
  `|dP/dt| = hypot(dxz, dyA + S*4*(2t-1))` with `dxz` = horizontal span and `dyA = yB-yA`, and
  `t += dir*v*dt/|dP/dt|`. The step returns `'end'` when t leaves [0,1] (t is clamped), `'bad'` for NaN or
  a zero derivative, and otherwise `''`.
- `landSpot(world, post, dirX, dirZ, out)` gives raft-local `{x, z, footY}` beside the far post. It tries
  the 4 neighbour cells at the same level that are `supported` (and free of decor at l=0), ordered by dot
  product with the ride direction (straight ahead first). The fallback is the post cell offset .7 m back
  toward the line. `footY = FLOOR_Y + l*2.2`, the same `getUpSpot` idea as sleep.js:63.
- `prune(state, world)` drops posts whose `supported` is false, then the lines that touch them. It returns
  `{posts, lines}` counts, and the caller bumps rev and refunds the host bag (1 zippost per post, 1 rope per
  line) with the notice "A zipline post lost its floor".

## Host actions (`action(a, actor, bag)`, host only, bump rev on success, emit notices to actor)
- `zipline.post {i,j,l}` needs `bag.count('zippost') ≥ 1`. It runs `canPost`, removes 1 zippost and pushes
  `{id:nextId, i,j,l}`.
- `zipline.link {a,b}` needs `bag.count('rope') ≥ 1`. It runs `canLink`, removes 1 rope and pushes `[min,max]`.
- `zipline.unlink {a,b}` removes the pair and gives back 1 rope.
- `zipline.remove {id}` removes the post and its lines. It gives back 1 zippost and 1 rope per line.
- Reason texts: full "Sixteen posts is plenty", taken "A post already stands here", nosupport "Posts need a
  deck tile or a floor", decor "Clear this tile first", linked "These two are already linked", busy "A post
  holds two lines", lines "Twelve lines is plenty", short "Too close for a line", long "Too far for one rope",
  blocked "Something is in the way", norope "You need Rope", nopost "Build a Zipline Post first".
- Prune check: in `update()` on the host, run it when `world.pieces` or `world.tiles` changes identity or
  length, the same as paint.js:208. Also run it after `load('save')` and `load('restore')`.

## Client: placing, linking, removing
- Placing: while holding `zippost`, `update()` reads `ctx.aim()`. If the aim point is within PLACE_REACH, it
  sets `i=round(x/2)`, `j=round(z/2)` and `l=clamp(round((y-ctx.deckY())/2.2),0,5)`, and requires
  `|y-(deckY+l*2.2)| < .35`, which means you aim at a walk surface. A ghost post parented to `ctx.raft` is
  green when `canPost` is '' and red otherwise. `use(aim,'zippost')` sends `zipline.post` or shows the
  reason. Returns true.
- Aim at a post: a ray against each post's vertical cylinder (radius .4, height 2.0, raft-local) within 4 m.
  The nearest hit becomes `aimPost`.
- Remove: holding zippost and `alt(aim,'zippost')` on an aimed post sends `zipline.remove`.
- Linking (local `pending = {id, until}`): with `rope` held, E on an aimed post sets pending (20 s, notice
  "Now press E on another post"). E on a second post sends `zipline.link` if the pair is not linked yet,
  or `zipline.unlink` if it is, then clears pending. Pending is cleared when the selected item changes, the
  post disappears or the 20 s run out. While pending, the local preview draws a straight thin line from post
  A's top to the aim point.
- Prompt order for `prompt(aim)`:
  1. holding rope on a post: `<kbd>E</kbd>Tie rope here` (or `Link to this post` / `Untie line` when
     pending is set);
  2. holding zippost: `<kbd>Click</kbd>Place post` (or the reason text, muted), or
     `<kbd>Right click</kbd>Pick up post` when aiming at one;
  3. near a post with a line: `<kbd>E</kbd>Ride the zipline`;
  4. while riding: `<kbd>Space</kbd>Let go`.
  It returns null otherwise. This reaches `#lrPrompt` through the existing content bridge (game.js:735,
  priority 1), so no extra provider is needed.

## Riding (local only, no ride actions)
- Start: `interact(aim)` with no rope held, when the player's eye is within REACH horizontally of a post top
  that has lines and is within 2.6 m vertically of it. The start is refused (a notice and return true) when
  `ctx.uiOpen()`, `ctx.steering?.()`, `physics.swimming`, `!physics.grounded`, or the sleep peek
  `peek('sleep')?.in?.[role]` is truthy. If the post has 2 lines, pick the one whose horizontal direction has
  the larger dot product with the camera forward. Set `ride = {a, b, t, dir}`, where t starts START_S metres
  from the grabbed end, and play a soft creak (`ctx.play?.('reel', .3)`).
- `afterMove(physics, dt)`: compute `ropePoint` and step. World pos is `x = local x`, `z = local z` and
  `y = ctx.deckY() - FLOOR_Y + ropeY - HANG`. Set physics x/y/z, `vx = vz = 0`, `vy = -.01`,
  `grounded = false` (so the remote pose shows the airborne pose) and `swimming = false`. This is the sleep.js
  pin, run last after building.postStep, so any shove from postStep is undone.
- Let go: with grounded=false the physics never uses up its jump buffer. Dismount when
  `physics._jumpBuffer > 0 || physics.vy > 0` (the vy check stays for safety). Then set `vy = 2`, clear ride
  and stop pinning. Gravity and the floor snap do the landing.
- End: when `rideStep` returns 'end', place the player at `landSpot`. Physics gets
  `y = deckY - FLOOR_Y + footY + 1.6 + .02`, `vy = 0`, grounded false (lands next substep).
- Auto-drop (like let go, but with vy 0): `'bad'` or NaN, the line or a post is gone after a load or prune,
  `ctx.uiOpen()`, `!ctx.running`, a stall where t has not changed for .5 s, or a world identity change.
  A prune that removes the ridden line releases the rider in the same frame.
- Feet hang 1.9 m below the rope, so on a long line between two deck posts they can dip up to about .46 m
  below the deck in the middle (eye ≥ 1.1 m above the deck). This is acceptable because the rider is pinned.

## Co-op and save
- Posts and lines are owned by the host. Guests send the four actions through `ctx.action`. On the guest,
  `load(data,'net')` returns at once when `data.rev === lastRev`, so post and line meshes are rebuilt only
  when rev changes. `serialize()` returns state.
- Riding is purely local. The remote avatar follows the pose stream (game.js:1952) and draws the air pose
  because grounded is false. No new net fields are added (an arms-up `ride` flag is a follow-up).
- Two riders on one line is allowed. An old save has no `ext.zipline` and gets the defaults.
- `debug`: `{state, ride, place(i,j,l), link(a,b), grab(id), ropeAt(lineIdx,t)}` for QA.

## Tests (`tests/zipline.test.mjs`, rules only)
1. cleanZip: undefined, junk, negative and float values give defaults. Duplicate ids and cells are dropped,
   l is clamped/rejected, lines to missing ids are dropped, and the 16/12 caps and max 2 lines per post hold.
2. canPost: works on a deck tile and on `floor` at l=2. Gives 'nosupport' for a roof-only or empty cell and
   'taken' for a duplicate. Gives 'decor' for a bench tile, but a net tile is fine.
3. canLink: covers same, missing, linked (also with the pair reversed), busy, lines, short (the same i,j at
   l=0 and l=1; adjacent cells, exactly 2 m apart, are allowed), long and blocked (a floor
   slab at mid-span).
4. prune: removing a floor piece drops its post and both of its lines and returns the counts. Removing a
   tile drops a deck post. Untouched posts stay.
5. Parabola: ropePoint at t=0 and t=1 equals the two tops. At t=.5 it equals the lerp minus .04*span, and
   linePoints[12] matches ropePoint(.5).
6. rideStep: a level 10 m line at 60 fps takes about 10.4/4 s (±10%, the arc is a bit longer). A downhill
   line is faster than the same line ridden uphill, and uphill is never below 4 m/s. dir -1 moves t down,
   'end' clamps t, and NaN input gives 'bad'.
7. landSpot: prefers the neighbour straight ahead, skips cells without support and cells with decor, uses
   the floor level for posts at l≥1 and falls back to .7 m back.

## QA plan (shoot.py copy plus raftDebug)
- Setup: build 4 tiles of foundation, a floor at l=1 over two cells (with walls or pillars as support), a
  post at deck (0,0,0) and a post at (4,0,1), then link them. The span is about 8.3 m.
- Shots: (1) the ghost post green on the deck and red on water, (2) both posts with the sagging line,
  (3) mid-ride at t≈.3 and t≈.7, looking forward and looking down, (4) the arrival on the upper floor
  standing beside the post, (5) let go mid-line over the deck after one second, (6) the prompts on
  `#lrPrompt`.
- Checks: no console errors. `ride` clears at the end. The player is grounded on the l=1 floor
  (y ≈ deckY+2.2+1.6). Removing the l=1 floor prunes the post and the line, refunds the items and drops the
  rider if one is on it. Save/reload keeps posts and line. The guest sees the line and a remote rider
  in the air pose. Steering (hold R) or opening the inventory refuses or ends the ride.
