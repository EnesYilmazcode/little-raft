# Player feedback, round 1: island arrival and held items

Branch claude/raft-feedback-1, built from origin/main 68ccda2 with two plain merge commits:
claude/raft-island-arrival (463be51), then claude/raft-held-items-alt (376c361). The two lanes touch no
common file and neither merge had a conflict. The competing branch claude/raft-held-items was not merged.

Player reports:
- Islands rise out of the sea and sink back into it in plain view.
- Most items show the same cloth bundle in the hand instead of what they are.

## Island arrival (claude/raft-island-arrival)

### Change
- Islands now spawn and despawn at full height 261 m up and down the current (ISLAND.START_Z / END_Z in
  dist/islands-layout.js), past the 200 m camera far plane. The sink and the vegetation scale-in are gone.
- Island materials carry their own fog that ends at camera far minus 10 m (190 m), computed on true
  distance through a vertex varying, not view depth, so an island at the side of the view is not half
  fogged when it appears.
- Island meshes take renderOrder 2 so the sky dome (radius 150, no depth write) does not paint over them.
- The "An island is drifting this way" notice fires once, on the host, when the island crosses z >= -150,
  which is when it first shows through the fog.
- Saves without `isl.tl` are mapped onto the new timeline at the same z (legU based), so a docked island
  stays docked after loading an old save.

### Evidence
`python3 check_island_arrival.py dist /home/user/little-raft-shots/feedback-1/island` (rc 0, no page errors,
669 frames):
- camera far 200 m, scene fog 90 to 260 m, island fog end 190 m.
- First frame in the frustum: t 16.2 s, approach, depth 200.0 m, fog 1 (fully fogged), vegetation at full scale.
- Last frame in the frustum: t 364.3 s, depart, depth 200.0 m, fog 1; removed after it left view.
- Island y while in view stays within -0.296 to -0.182 m, which is wave bob only. No rise or sink.
- Shots at 190, 160, 110, 70, 35 m, docked, and 110, 160, 190 m leaving:
  /home/user/little-raft-shots/feedback-1/island/1-far-190m.png to 9-leave-190m.png.

## Held items (claude/raft-held-items-alt)

### Change
- New dist/held-models.js. Every one of the 148 bag kinds gets its own held model, tagged with
  `userData.heldKey` (`world:`, `icon:` or `prop:`). The cloth bundle is now only a last resort that no
  current kind reaches.
- The Metal Hook is held as the steel grapple of its icon (vmKind in dist/game.js picks `metalhook` when
  the selected slot holds one).
- Six kinds that had lettered icon tiles get 3D icons (dist/item-icons.js).
- Refined first-person hands (dist/hands.js): 128 px skin texture with bump, warm terminator, rim light,
  nails and a slimmer wrist.
- Held models no longer share mutable materials with placed stations (smelter, research table, grill and
  purifier are marked shared).
- dist/live.js preloads held-models.js.

### Evidence
- Measured with a node script over ITEM_KINDS using the game's own model factory: on origin/main 103 of
  148 kinds fell back to the cloth bundle (the lane reported 102; this count matches the bundle by
  heldKey or by its mesh fingerprint). On this branch 0 of 148 do, and there are 147 distinct mesh
  fingerprints. The one shared pair is glidepost/glidestep, on purpose.
- `python3 shoot_held.py dist /home/user/little-raft-shots/feedback-1/held`: rc 0, no page errors,
  296 shots (148 kinds, full frame plus zoom), for example held/metalhook-zoom.png and held/battery.png.
  The full 148-kind run takes a little over 8 minutes.

## Tests and checks

- `npm test`: 1416 tests, 1416 pass, 0 fail (origin/main: 1402 of 1402).
  New: tests/island-arrival.test.mjs, tests/held-distinct.test.mjs (4 tests); islands and treasure tests
  updated (55 pass across the three island files).
- `check_island_arrival.py`: pass, see above.
- `shoot.py dist /home/user/little-raft-shots/feedback-1/shoot`: rc 0, 15 shots, no page errors.
- check_game, check_hook, check_multiplayer, check_survival, check_settings: all fail with a 30 s timeout
  clicking `#solo`. The same five fail the same way on origin/main 68ccda2. With no save, `#solo` is a hidden
  "Continue" button and a new game starts from `#newGame`; the scripts predate that menu. Pre-existing, not
  fixed here. Logs: /home/user/little-raft-shots/feedback-1/check_*.log and main/check_*.log.
- check_connection, check_live_feed and check_upgrade were not run: they need the signalling server, the
  live feed or the release queue, which neither lane touches.
- No per-frame allocations added: the island update only writes scalars and uniforms, the vmKind check reads
  the existing bag, and held models are built when the held item changes.

## Known risks

Island:
- The visible cycle is longer, about 380 s (100 s approach, 180 s docked, 100 s departure) plus the gap.
- The spyglass can label an island that is still hidden in fog.
- Island fog differs slightly from the scene fog between 90 and 200 m (island fog ends at 190 m, scene fog at 260 m).
- Mixed-version coop (one player on the old island timeline) is not supported. Old saves load fine.

Held items:
- Placed gear (stations, decor) is held in the pointing pose with the other hand free.
- Large held world models add draw calls, though they are merged per material.
- Metal looks dark at night and in rain, since there is no environment map.
- glidepost and glidestep share a held model on purpose (one post at two heights).
- The competing branch claude/raft-held-items is left unmerged.

Shared:
- The five `#solo` check scripts fail on main too (see above).
