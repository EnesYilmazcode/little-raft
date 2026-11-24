# Feedback round 1: island arrival and held items

Branch `claude/raft-feedback-1`, built on origin/main at 68ccda20. It merges two lanes with plain merge commits:

- `origin/claude/raft-island-arrival` at 463be512
- `origin/claude/raft-held-items` at 25c51f1d

origin/main had not moved since either lane branched off, so both merges were clean with no conflicts. The lanes touch separate files except `dist/live.js` (only held-items adds `held-models.js` to PRELOAD) and `dist/game.js` (only held-items changes one line, for the metal hook viewmodel). The island VIEW constants still match current main: game.js builds the camera with far 200 and `new T.Fog(.., 90, 260)`, and daynight.js never pushes fog past 260.

## Island arrival (what changed, checked against the commits)

- Islands now arrive and leave at full height. The old rise out of the sea and sink back (4 s, 3 m) is gone from `pathAt`, and so is the plant shrinking that went with it (89b09038, 3cbaf9a1).
- Spawn and removal happen at z = -261 and z = +261. `islands-layout.js` derives this from a new `VIEW` constant (camera far 200, fog far 260, fog margin 10). The value is the smaller of camera far and fog far, plus the largest island radius with its sand rim (9 x 1.15), plus the raft's max player distance, rounded up. `tests/island-arrival.test.mjs` reads game.js and daynight.js and fails if those values drift from `VIEW`.
- Island fog clamp. Lit island materials end their fog at `islandFogFar` = 190 m (camera far minus the margin), so an island fades in from full fog instead of popping in at the far plane. The fog uses true straight-line distance, not view depth, so an island at the side of the view does not show half fogged (67591565). The live value follows `camera.far`, capped at `VIEW`.
- Render order. Each island mesh gets renderOrder 2, so it draws after the sky dome (order 1, radius 150, no depth write), which would otherwise paint over an island past 150 m. The order is set per mesh rather than on the group, so the ocean (order 10) keeps its early depth rejection (463be512).
- Timing. Approach and departure are 100 s each (they used to be 25 s and 30 s): a steady drift of about 2.9 m/s, then 30 m of easing into the dock and out of it.
- Saves. Island state now carries `isl.tl = 2`. Saves and peers without `tl` go through `oldAge`, which maps the old timeline onto the new one at the same z. A docked island stays docked with the same time left. One that was still rising goes back to the start of the approach, out in the fog.
- Notice. "An island is drifting this way" now waits until the island is past z = -150, where it can actually show through the fog, instead of firing at spawn while the island is still out of sight (444eabc6).
- New probe `check_island_arrival.py` and 10 new node tests.

## Held items (what changed, checked against the commits)

- All 148 item ids now have their own first-person held model. Before, 103 ids fell back to the same generic cloth bundle and there were only 46 distinct held meshes (see `docs/loop/held-items-audit.md`). New module `dist/held-models.js` (370 lines) builds placeables from their world models and builds small icon-matching models for everything else (0073889b).
- Hands: warmer skin shading with a red tint in the shadows and a soft rim, a 128 px procedural skin detail texture also used as a bump map (pores, blotches, knuckle creases), nail plates on every finger and thumb pose, and contact shading baked once per pose mesh (8bad44a7).
- The metal hook shows the metal grapple in hand instead of the plastic hook, and throws and reels like the hook (c8ca475d).
- Tests: `held-items-distinct.test.mjs` checks that no two ids share a model, that none falls back to the bundle, and that same-shape models differ by a visible colour distance (62e13323, c7d98216). `held-items-world-mats.test.mjs` checks that mounting held models never retunes materials shared with placed world copies (bdc2a94a).
- World material sharing fix: held and icon models work on material copies (bdc2a94a).
- Left-hand mirror fix: placeables on the left fist get un-mirrored, so text and art read correctly. Wall pieces face the eye, and the rug and bed tip up (a07bfc3a).
- Finger clipping fix: bowls and shark steaks sit on the fist, so fingers no longer poke through them (25c51f1d).
- New probe `check_held_items.py` and audit table `docs/loop/held-items-audit.md`.

## Evidence

All outputs are under `/home/user/little-raft-shots/integrate/`.

- `npm-test.txt`: full node test output.
- `island/1-far-190m.png` through `island/9-leave-190m.png`, plus `check_island_arrival.txt`. Probe numbers: far 200, fogNear 90, fogFar 260, islandFogFar 190, 669 frames. First in view at t = 16.2 s at view depth 199.995 with fog 1.0 (fully fogged). Last in view at t = 364.3 s at depth 199.98 with fog 1.0. Removed after it was last in view. Island y stayed within -0.296 to -0.182 for the whole run (no rise or sink). No page errors.
- `held/*.png` (32 kinds, normal and close shots) and `check_held_items.txt`: 32 kinds selected, each showed its own held kind, no page errors. Spot checks: the metal hook shows the grapple, the kiln sits on the left fist.
- `shoot/01-title.png` through `shoot/13-place-bench-rotated.png` and `shoot.txt`: no page errors. Islands, the hand with the hook, and the build ghost all look right.
- Perf, compared with origin/main in the same headless software-GL run (`shoot-main.txt`): draw calls 50 vs 45, triangles 55744 vs 51308, geometries 155 vs 150, programs 66 vs 65, heap 47.6 MB vs 50.9 MB. Frame time was 110 ms avg vs 123 ms avg, which is software-GL noise. The new per-frame work is a scalar fog clip update in islands.js and an `isHookKind` check. The texture, nails and contact shading are built once when the hands are built, and held models are built when a kind is mounted, not every frame. No new per-frame allocations.

## Test and check results

- `npm test`: 1417 tests, 1417 pass, 0 fail (origin/main has 1402, so these lanes add 15). The lane, island, treasure, net and coop node tests alone come to 118 of 118 passing.
- `python check_island_arrival.py dist ...`: exit 0, no errors.
- `python check_held_items.py dist ...`: exit 0, no errors.
- `python shoot.py dist ...`: exit 0, no errors.
- `check_game.py`, `check_hook.py`, `check_settings.py`, `check_survival.py`, `check_connection.py`, `check_multiplayer.py`: all time out clicking `#solo` or `#welcomeCrew`, which are hidden behind the current title flow. `check_hook.py` fails the same way on origin/main. These legacy checks are stale and say nothing about this branch.
- `check_live_feed.py` and `check_upgrade.py` were not run: they publish releases into the working tree or depend on an old release baseline.
- `tests/coop-e2e.mjs` (loopback coop; stock version is stale on the title click as well), run with DOM clicks: 9 of 12 checks pass. That covers connect, avatar tracking, smooth motion, emote, bandwidth, both reconnects, host leave and no page errors. Three fail: join line in the feed, middle-click ping, and hook throw reaching the host. origin/main gives the identical 9 and 3, so none of the failures come from this branch.
- Save compatibility: the island tests cover the old-save remap (no `tl`) and that serialize carries `tl`. All net and coop node tests pass.

## Risks and follow-ups

- If any lane changes camera far or the fog (game.js or daynight.js), the VIEW test in `tests/island-arrival.test.mjs` fails until `VIEW` in `islands-layout.js` is updated. That failure is intended, because spawn distance and the fog clamp come from those numbers.
- Placeables are now held on the left fist, un-mirrored. Lanes that add placeables should check their pose with `check_held_items.py`.
- Remote coop avatars still show the old held models. Only the local first-person viewmodel uses `held-models.js`.
- Several hotbar icons are still text placeholders (for example woven rug and rope hammock). They belong to the icon lane, but their held models are already real.
- The driftboard icon does not match its new held model.
- When a game loads, the map table may chart an island that is still hidden in fog (it now spawns 261 m out and takes 100 s to drift in).
- The headless Playwright checks and `tests/coop-e2e.mjs` need updating for the current title flow (`#newGame` and `.ob-item`, or DOM clicks). Three coop-e2e cases fail on main as well.
