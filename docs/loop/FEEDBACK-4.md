# Player feedback round 4

Branch: claude/raft-feedback-4, from origin/main (68ccda2).

Merged:
- claude/raft-free-placement (f2ff838)
- claude/raft-jump (39faafe)
- claude/raft-movement (cdf7eed)

## Player feedback

Paraphrased from the lane briefs (no verbatim quotes are kept in the repo):

- "Items snap to the middle of a tile. I want to put a crate where I point, right next to the other one, and
  four candles on one tile."
- "I can't jump onto anything. A jump should get me up onto a one-storey floor."
- "Moving feels floaty: slow to start and stop, and the deck wobbles under me when the raft rocks."

## Changes per lane

### Free placement (raft-free-placement)

- Crates, decor and stations sit at the exact aimed point (raft-local tile units) instead of a tile centre.
  Floors and building pieces keep the grid.
- R turns a placeable 15 degrees (ROT_STEP = PI / 12); Shift+R or Shift+wheel turns it 5 degrees
  (FINE_STEP = PI / 36).
- A footprint check keeps items on the deck and out of other items, walls, pillars, stairs and grills.
  Flush neighbours (0 gap) pass: PLACE_EPS lets two footprints touch by 4 mm after rounding.
- Edge snap: a gap or overlap under 6 cm (SNAP_GAP = 0.06 m) to a parallel neighbour, wall or pillar closes
  to 0, one axis at a time. It never moves an item more than 6 cm per axis; there is no grid.
- Positions are rounded to 1/1000 tile (2 mm) in saves and on the wire (roundCoord); rotation to 1/1000 rad.
- Fixed footprint table: 61 placeables (54 in MODEL_FOOTPRINT plus 7 in FOOTPRINT), so host and guest test the
  same rectangles from the first frame and loading a raft builds no ghost models.
- Old tile-centred saves load unchanged (integer cells are the tile centres). Hosts advertise caps.free; a guest
  of an old host keeps the old one-per-tile grid.
- A wall, pillar or stairs ghost turns red over a placed item and the host refuses it too. No item is placed
  through a wall or a storey floor: the piece in front hides the deck behind it.
- Gulls perch on off-centre items where they stand. Station, storage and decor modules accept fractional spots.
- Place mode prompt is icons only; the ghost tint says valid or not.

### Jump (raft-jump)

| | before | after |
|---|---|---|
| Apex (v^2 / 2g) | 0.882 m | 2.445 m |
| Time to apex | 0.383 s | 0.495 s (0.500 s in 1/60 s frames) |
| Airtime (flat deck) | 0.767 s | 0.898 s (0.900 s in 1/60 s frames) |
| JUMP_IMPULSE | 4.6 m/s | 9.89 m/s |
| GRAVITY | 12 m/s^2 | 20 m/s^2 rising |
| FALL_GRAVITY | (none) | 30 m/s^2 falling |
| Wall height (LEVEL_H) | 2.2 m | 2.2 m |

- The apex is 0.245 m over one wall, so a player can hop onto a one-storey floor. A two-storey wall still
  blocks the jump.
- PlayerPhysics._fall() splits the step that crosses the apex exactly, so height and airtime hold at any fps.
- Ceilings stop the rise on long frames too (the bonk now runs before the step-up filter).
- Railing and gate guard box: 3.5 m in the open (RAIL_GUARD), capped at LEVEL_H where a floor or stairs one
  storey up sits beside the edge. It stops sprint jumps and the cookpot jump buff from clearing railings.

### Movement (raft-movement)

- Ground start and stop are snappier: GROUND_ACCEL 14 -> 20, new GROUND_DECEL 22 and GROUND_FRICTION 6 m/s^2.
- Lighter air control: AIR_ACCEL 3.5 -> 1.2. Sprint 4.0 -> 4.3 m/s.
- Coyote jump: a jump pressed within 0.1 s of walking off a ledge still jumps.
- Swimming buoyancy is stiffer (spring 30 -> 60, damping 7 -> 12) and runs in 1/240 s substeps.
- RaftRide: the camera rides the raft's pitch and roll while aboard, blended out in the water. The partner
  avatar rides the tilt too.

## Integration

- Free placement and jump merged without conflicts.
- Movement conflicted in dist/player-physics.js: kept the jump lane's constants, FALL_GRAVITY and _fall(), and
  the movement lane's coyote jump and substepped buoyancy. The railing guard logic in building-pieces.js is the
  jump lane's, untouched by movement.
- Three tests needed updates after the merge (the code is unchanged):
  - building-physics "sprinting and bunny-hopping on stairs": hops now stop before z 0.5 instead of 1. With
    sprint 4.3 the last hop started on the top step and cleared the one-storey wall upstairs, which is by design.
  - jump "a running jump from the deck lands on top of a one-wall-high room": the walking take-off moved from
    x -2.1 to -2.45. A take-off at -2.1 touches the wall face 7 cm below its top; with AIR_ACCEL 1.2 the body
    cannot pick its speed up again before it drops. The clean walking window is x -2.75 to -2.20 (1.2 to 1.75 m
    before the wall); sprinting works from much further out.
  - movement-dynamics "air control is reduced but present": measured as a share of walking for the same airtime
    (0.36 to 0.44) instead of a fixed distance, since the jump lane made the airtime longer.

## Evidence

Tests: `npm test` 1436/1436 pass. New or changed for this round:

- tests/free-placement.test.mjs (14): flush crates, a row across tile borders, four items on one tile,
  rotated overlaps, walls and pillars, save/load, old saves, co-op round trip, fixed footprints, gull perches,
  piece ghost over items, no placing through a wall or storey floor, edge snap at most 6 cm.
- tests/jump.test.mjs (7): jump probe at 30/60/144 fps, fall vs rise gravity, ceiling stop from 1/144 to 0.25 s
  frames with deck bob, running jump onto a one-storey room, two-storey wall blocks, railings hold sprint and
  cookpot jumps, railing under an upper floor does not bump.
- tests/movement-dynamics.test.mjs (13) and tests/movement-probe.mjs: ground start and stop, air control,
  coyote jump, swimming at 30/60/144 fps, climb-out, standing still in the raft frame.

Screenshots (shoot_placement.py, docs/loop/shots/free-placement/):

- 01-crate-row-red-ghost.png: a row of five crates packed flush across tile borders; the ghost over the row is red.
- 02-crate-row-green-ghost.png: the ghost just behind the row slides flush against it and is green.
- 03-four-candles-one-tile.png: four candles on one tile.

shoot.py on the merged build: no page errors, 15 shots, the bench ghost turns 15 degrees.

Placement cost: edgeSnap + freeBlock with 400 placed items is about 43 to 48 us per frame (node, one check per
frame while a placeable is held).

Frame time against origin/main (68ccda2), SwiftShader software GL, so relative only; runs were sequential and
interleaved:

| probe | origin/main | feedback-4 |
|---|---|---|
| tests/e2e/perf_probe.py idle avg (2 x 2 runs) | 142 / 140 ms | 134 / 134 ms |
| tests/e2e/perf_probe.py walk avg | 130 / 122 ms | 116 / 119 ms |
| perf_probe draw calls idle / walk | 49-51 / 41-42 | 48-52 / 42-46 |
| shoot.py frameMs avg (2 runs) | 81 / 85 ms | 88 / 96 ms |

perf_probe (same fresh-game path on both builds) shows no regression. shoot.py ends in build mode at a different
camera pose on each build (bench ghost rotation and hover spot differ), so its 7 to 13% gap is mostly pose; the
placement check itself is microseconds. shoot_placement.py measured 255 ms per frame holding a crate ghost against
191 ms with an empty hand at the same view: that is the transparent ghost model rendering in software GL, not the
footprint check (9 items).

## Risks

- A running jump clears one-storey edge walls, half walls and windows. Only railings and gates (the guard box)
  keep players aboard at the raft edge.
- The landing camera dip is now always at its cap (DIP_MAX 0.18 m): a flat jump lands at about 12 m/s, which
  was about 4.6 m/s.
- The ladder jump (LADDER_JUMP_VY 3 m/s) feels weak next to the 9.89 m/s ground jump.
- A walking jump pressed against a one-storey wall no longer gets on top (the lighter air control cannot
  recover the speed the wall took). Taking off 1.2 to 1.75 m out works; sprinting works from the wall.
- Old guests drop fractional items, so host and guest need matched versions. (A new guest of an old host
  keeps the old grid.)
- No item placement on upper storeys. It never existed; placing through a floor is now refused instead of
  landing on the deck below.
- Overhang: after a shark removes a tile, items that straddled it can hang over the water.
- Animals and gulls still use tile centres to find empty deck.
- GRID_DECOR (nest box, goat pen, fish trap) and the G-key grill stay tile-centred.
- The building ghost slot picker shows red rather than moving to a free slot when an item blocks it.
- The check_*.py scripts are stale (see below).

## Checks

- `npm test`: 1436/1436.
- shoot.py (merged build): no page errors; same console noise as main (SwiftShader ReadPixels stalls).
- shoot_placement.py: no page errors, all 9 placements accepted, crate row at x -1, -0.51, -0.02, 0.47, 0.96 tile
  (flush, 0.98 m crates), the ghost over the row is red (overlap), the ghost behind it is green and flush.
- check_game.py, check_multiplayer.py, check_settings.py and check_hook.py fail identically on origin/main and on
  this branch: they click #solo, which is now a hidden Continue button (the start button is #newGame), and
  check_multiplayer then waits on #welcomeCrew. check_game also expects a release server (.qa/release,
  window.raftLive). check_survival, check_upgrade, check_connection and check_live_feed need the release QA
  server and were not run. These scripts are stale; not chased.
