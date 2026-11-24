# Climb and scale

Branch claude/raft-climb-scale, built on claude/raft-feedback-all. The player could not jump onto walls, crates or
tables, and walls looked too big. This is what was wrong, what changed, and how it was checked.

## Root cause

From the before probe (docs/loop/climb-scale/climb-before.json, check_climb.py on the old build): 53 of 58 objects that
should be standable were never landed on.

- Decor colliders were XZ circles or boxes with no height and no top. A crate blocked the body at every feet height,
  even 2.4 m up, and there was nothing to stand on (dist/coop-rules.js decorBlockers).
- Wall, half wall, window, door and pillar tops were never walkable: BuildGrid._scan only registered slots 0 and 1
  (floors, stairs, roofs, hatches, ladder tops). The body went over the top and fell through it.
- Railing and gate collision was a 3.5 m invisible guard box, so nothing could get over a 0.95 m rail.
- Next to a one-storey floor, the slab edge head-bumped any jump: a standing jump capped at 0.33 m feet height.
- FOV 75 deg vertical framed everything wider and lower than Raft (about 60 deg), so a 2.2 m wall one tile away
  read as a short wall, and nearby things read as big.

## What landed, before and after

Feet height in m above the deck. Before: jump apex 2.445 m. After: apex 1.37 m plus a ledge pull-up.
"Landed" means at least one of the standing or running jump ended on top.

| Group | Before | After |
|---|---|---|
| Full wall, window, door top (2.2), pillar (2.2) | not landed (pushed off or fell through) | landed, by ledge pull-up |
| Half wall (1.1), railing (0.95), gate (0.95) | not landed (no top; rail 3.5 m guard box) | landed by jump |
| Floor, hatch, roof one storey up beside pillars | landed only by running jump; standing jump capped at 0.33 | landed (pull-up), standing and running |
| Stairs, ladder | landed | landed |
| Crates, bench, bed, tables (map, research, game), shelf, trophy stand, motor, receiver | not landed (height-less blockers) | landed |
| Stations: purifier, rain barrel, kiln, smelter, grill, recycler, cookpot, juicer, research, battery, beehive, nest box, goat pen | not landed | landed |
| Low tops: cushion, crop plot, flower box, glass float, pots, palm planter, hammock bed | not landed | landed (cushion is a step) |
| Thin or tall: lamps, lantern, flags, poles, sign, scoreboard, task board, wheel, turbine, antenna, scarecrow, chime, string lights, fern, glass lamp, fish trap, sail, candle | not landed, height-less columns | blocked with their true height, not standable by design; body never inside (max penetration 0.001 m) |
| Rug | walk over | walk over |

After: 42 of 42 standable objects landed, 0 blocking decor penetrated (docs/loop/climb-scale/climb-after.json,
check_climb.py --strict exit 0).

## Scale, ours vs Raft

Raft numbers from docs/loop/raft-scale-reference.md (several are estimates).

| Quantity | Before | After | Raft |
|---|---|---|---|
| Foundation tile | 2.0 m | 2.0 m (unchanged, keeps saves) | 1.5 m |
| Full wall | 2.2 m | 2.2 m | about 2.2 m |
| Eye height | 1.6 m | 1.6 m | about 1.6 to 1.7 m |
| FOV (vertical) | 75 deg | 60 deg default, range 50 to 100; a stored 75 with no fovRev migrates once to 60 | about 60 deg |
| Jump impulse / apex | 9.89 m/s / 2.445 m | 7.4 m/s / 1.37 m | 7 m/s / about 1.23 m |
| Wall top | jumped onto (moon jump) | ledge pull-up (hands reach 1.3 m above the feet) | cannot jump onto a full wall |
| Wall top on screen, eye level, 1 tile away | 0.70 of screen height | 0.76 | about 0.86 |
| Same, half a tile away | 0.89 | above the top edge | above the top edge |
| Same, 1.5 tiles away | 0.63 | 0.67 | about 0.74 |

Raft cannot jump onto a full wall. The player asked to climb walls, so the full wall is reached with a short pull-up
when you jump at it, instead of a jump that clears a storey.

## Screenshots

All in docs/loop/climb-scale/, 1536x864, normal in-game HUD.

- Before (old build, deck level, no way up): before-wall.png, before-chest.png, before-table.png
- FOV only: scale-before-wall.png, scale-before-chest.png, scale-before-deck.png (75 deg) and the scale-after-* set (60 deg)
- After (final build): after-wall.png (standing on a wall top), after-chest.png (on a crate), after-table.png (on the
  map table), after-clamber.png (frozen mid pull-up onto a wall), after-nextwall.png (one tile from a full wall)

## Checks

- npm test: 1516 of 1516 pass, 0 fail (includes tests/climb.test.mjs, tests/climb-r2.test.mjs, tests/fov-scale.test.mjs).
- Final review fix: a step-up at the edge of a decor top now lands just inside the edge margin. Exactly on it, float
  error could leave the body one airborne frame (two land sounds when brushing past a cushion). Test in
  tests/climb-r2.test.mjs.
- check_climb.py --strict: 42 of 42 standable landed, no blocker penetrated, exit 0.
- check_climb_coop.py: guest climbs onto a crate (feet 0.87) and pulls up onto a wall (feet 2.2); the host sees the
  guest up there. No page errors.
- check_settings.py (FOV applies, settings saved), check_paddle.py (includes an old save without the sailing slice),
  check_held_items.py, check_island_arrival.py: all exit 0 on the final build.
- Old saves: tile size and save schema are unchanged; colliders are rebuilt from the saved decor on load, and
  old height-less blockers still block at every height (tests/climb.test.mjs).
- Physics cost (node, 24 decor plus walls and rails, 60 fps, 7 runs, three interleaved rounds): base about 2.7 us per
  frame, head about 3.7 us per frame.
- followModels (decor colliders follow model turns), measured in Chrome with 60 decor (87 colliders): 0.6 us per frame
  when nothing turned, 4.2 us when all 60 turn. It allocates nothing (no literals or closures in the loop).
- Whole game frame in Chrome with 60 decor, GL draw skipped, 4 interleaved runs each: base 5.85 ms, head 5.80 ms
  (median of medians; same within noise).

## Risks

- A sprint jump can clear a railing into the sea (Raft does the same).
- A player who deliberately picked FOV 75 gets 60 once, after the migration. Any other stored value is kept.
- The decor height table in dist/decor-collision.js must be updated when a model changes size or a new decor type is
  added (an unknown type falls back to the old full-height column).
- Slightly more physics work per frame (about 1 us at 60 fps).
- A random fuzz (300 worlds of walls, rails and decor) still finds a few cm of body overlap with a standable decor side
  in 4 worlds (spawned inside it, or squeezed by a wall); round 1 had 5. Very long frames (0.1 to 0.25 s) on a
  0.3 m heave can miss a thin wall top on landing, as before this round.
- dist/game.js still imports decorBlockers, which it no longer uses.
- Possible merge conflicts with claude/raft-build-hud in dist/building-pieces.js (_solids, _scan) and the placement
  lines in dist/game.js.
- check_settings.py expects a server on port 41897; it was run against a plain static server of dist/ on that port,
  not the QA server. Check scripts that need the full QA server were not run.
