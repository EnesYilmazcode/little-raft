# Feedback round 2: integration

Branch `claude/raft-feedback-2`, cut from `origin/main` (68ccda2). Four lanes merged with `--no-ff`, in order:

| Lane | Head | Commits |
|---|---|---|
| crafting-ui | e073a2b | 12 |
| drop-box | 192d253 | 9 |
| raft-control | eaa7e26 | 5 |
| movement | cdf7eed | 6 |

All four merges were clean (no textual conflicts). Files touched by more than one lane: `dist/game.js` (crafting-ui, drop-box, movement), `dist/controls.js` (drop-box, movement), `dist/craft-book.js` (crafting-ui, raft-control). Each was read after the merge; both sides' changes are present and do not interact.

Semantic checks done after merging:

- `dist/live.js` preload lists `drop-box-core.js` and `drop-box.js`. No other new module was added by the lanes. (The files missing from the preload list, such as `prompts.js` and `onboarding.js`, were already missing on main.)
- `craft-book.js`: the paddle text says "250 strokes" (raft-control) and the requirement chips from crafting-ui render it (seen in the crafting shot).
- Pickup feed: drop-box adds no feed code of its own. A box pickup shows up through the normal bag-change rows, so it gets crafting-ui's flat rope and plank icons. The `pickupFeed.need()` chips are untouched by drop-box.
- Q binding: drop-box updated the Controls tab text (Q drop one, Ctrl+Q stack, Ctrl+Q drops the hammer). Movement's `controls.js` change is only a comment and constants, so there is no clash.
- Movement's RaftRide camera tilt offset vs drop boxes: box aim uses a ray from the camera, so it follows the same offset. Boxes ride the raft transform. Paddle aim uses yaw and the player position, which the tilt offset does not change.

## Changes per lane

### Crafting UI

Player: "the crafting menu is off-centre, text gets selected when I click, and clicking an ingredient jumps away from what I was making."

- No text selection anywhere, including in modal dialogs and popovers (Chrome resets `user-select` in the top layer). `selectstart`/`dragstart` are blocked except in inputs and draggable bag slots.
- The dialog is fixed at `inset: 0` and centred with flex. The old offset came from the top margin being multiplied by `--ui-scale` 1.2. Margins are 324/164 px at 1920x1080 and 30/24 px at 900x600.
- Clicking an ingredient no longer jumps to its recipe. A missing ingredient that can be crafted right now shows a + on hover that crafts it in place (`craftNow`/`onCraft`). The open recipe stays selected.
- The craft button shows only an icon. A pin SVG icon shows the pinned state.
- Requirements are shown as count + icon chips (`reqChips`) in the recipe list, the detail view, the HUD pin card, tooltips, the build wheel, the hammer prompt and need-more notices in the feed (`pickupFeed.need`). Events still carry text for older peers.
- 8 new SVG icons (seed, rug, pennant, fern, hammock, glasslamp, sinker, water) and flat rope and plank icons. A test checks that no item falls back to a letter tile.
- Key files: `dist/survival-ui.js`, `dist/craft-book.js`, `dist/item-svg.js`, `dist/item-tooltips.js`, `dist/pickup-feed.js`, `dist/prompts.js`, `dist/build-menu.js`, `tests/crafting-ui.test.mjs`.

Integrated check: paddle recipe with 1/2 rope shows the + on the rope tile. Clicking it took rope from 1 to 2, and the paddle recipe stayed selected and turned ready.

### Drop box

Player: "I want to drop things."

- Q drops one of the held item and Ctrl+Q drops the stack. With the hammer, Q still opens the build wheel (as on main) and Ctrl+Q drops the hammer.
- Drops land in a half-size crate 1.3 m ahead. On the raft it rides the raft transform, at sea it bobs, and on land it rests on the sand. Drops within 5 s and 1.6 m merge into one box. E picks a box up and shows a feed row.
- Saved in `world.ext.dropbox`. Old saves load. In coop the host has authority and old peers are tolerated. A box is removed after 600 s adrift or beyond 150 m. Boxes slide around the raft edge instead of snagging on it.
- Q is blocked while diving, passed out, in menus or typing. `dropHeld()` lives in `game.js`.
- Key files: `dist/drop-box-core.js`, `dist/drop-box.js`, `dist/content.js`, `dist/input-map.js`, `dist/controls.js`, `dist/live.js`, `tests/drop-box.test.mjs` (10 tests).

Integrated check: two Q presses on the raft made one box with 2 wood (the merge worked). Swimming and pressing Ctrl+Q made a box with 4 wood in the `sea` state.

### Raft control (paddle and anchor)

Player: "paddling does nothing and I can't find a way to stop the raft."

- Root cause: the 0.25 m/s impulse was below the ocean current (0.30) and the debris drift (0.22). The splash spawned under the deck, the stroke animation moved only 4 cm, and clicks during the cooldown were dropped.
- The impulse is now 0.9 m/s with a 1.2 m/s cap, so the paddle stays below one sail (1.3). Clicks during the cooldown are queued, the splash appears past the deck edge and the stroke is deeper. Durability went from 60 to 250 strokes.
- The anchor post already existed on main (derived from tiles, not saved) but sat at the back corner, out of view. It now stands at the front-left corner in the spawn view. E drops and raises it. Old saves get it automatically because it is derived from tiles.
- Feedback in the bottom-left feed for edge, anchored and worn states. `check_paddle.py` probes all of this.
- Key files: `dist/paddle.js`, `dist/sailing-core.js`, `dist/sailing-world.js`, `dist/hands.js`, `dist/items.js`, `dist/craft-book.js`, `check_paddle.py`.

### Movement

Player: "movement feels floaty and the camera wobbles on the raft."

- `GROUND_ACCEL` 20, `GROUND_DECEL` 22, friction 6, air control 1.2, `COYOTE` 0.1 s. Buoyancy is 60/12, integrated in 1/240 s substeps.
- RaftRide applies the raft's pitch and roll to the camera and to the coop friend avatar (optional `rideOffset`).
- Key files: `dist/player-physics.js`, `dist/move-feel.js`, `dist/game.js`, `dist/coop.js`, `dist/controls.js`, `tests/movement-dynamics.test.mjs`, `tests/movement-probe.mjs`, `tests/e2e/raft_frame_probe.py`.

## Numbers (measured on the integrated build)

`node tests/movement-probe.mjs --compare <origin/main dist>`, 60 fps (144 fps gives the same picture):

| Metric | main | feedback-2 | Change |
|---|---|---|---|
| walk to 90% | 0.25 s | 0.15 s | -40% |
| walk to 95% | 0.30 s | 0.15 s | -50% |
| sprint to 90% | 0.283 s | 0.217 s | -23.5% |
| sprint top speed | 4.0 m/s | 4.3 m/s | +7.5% |
| walk stop distance | 0.181 m | 0.090 m | -50% |
| walk stop time | 0.267 s | 0.10 s | -62.5% |
| sprint stop distance | 0.271 m | 0.158 m | -41.5% |
| jump apex | 0.882 m | 0.882 m | 0 |
| air lateral carry | 1.155 m | 0.659 m | -43% |
| late edge jump (60 ms coyote) | no | yes | fixed |
| splash dunk | 0.080 m | 0.023 m | -71% |
| splash settle | 1.17 s | 0.58 s | -50% |
| raft local drift std | 0.1066 m | 0 | -100% |

`python check_paddle.py dist`: ok, no errors. The first stroke adds 0.87 m/s (main: 0.246) and glides 2.344 m in 6 game seconds (main: 0.65 m). Following strokes add 0.847 and 0.551 m/s as the speed reaches the cap. Durability 100% to 98% after 5 strokes (250-stroke tool). Anchored drift 0.0 m in 3 s. The anchor raises again. An old save without the sailing slice loads with the anchor.

Perf gate (`tests/e2e/perf_gate.py`, SwiftShader, seed 1, about 100 s of play), same box, back to back:

| Metric | main | feedback-2 |
|---|---|---|
| pass | yes | yes |
| fps | 11.93 | 11.84 |
| draw calls p50 / p95 | 47 / 53 | 46 / 56 |
| script ms/frame mean / p95 | 3.00 / 4.5 | 3.06 / 4.4 |
| frame interval p50 / p95 | 83.3 / 116.6 ms | 83.3 / 116.7 ms |
| hitches | 0 | 0 |
| JS heap growth, late half | 0.061 MB | 0.028 MB |

There is no frame-time regression. Draw-call differences are within the run-to-run supply mix (the scripted session drops no boxes).

## Tests and checks

- `npm test`: 1442 tests, 1442 pass, 0 fail. `art.test.mjs` passed both in the full run and on its own (9/9).
- `python shoot.py dist <out>`: 15 shots, 0 page errors (console shows only SwiftShader driver notes).
- `check_paddle.py`: passes (above).
- `check_settings.py`: passes on the integrated build and on main, after the selector fix below.
- `check_hook.py`: gets past the title screen now, then fails `raftDebug.state.charge > .9`. It fails the same way on main, so the failure is pre-existing and not from these lanes.
- `check_survival.py`: run against an isolated copy in `.qa/survival/dist`. It fails `.tools > button` count == 8, an old HUD assertion. None of the lanes touch `index.html` or the hotbar markup, so this is pre-existing.
- `check_game.py`: run against `.qa/release/dist`. It gets past the title, then fails the live-update step (`status: current`), which needs the release pipeline to bump the build. Not runnable here.
- `check_multiplayer.py`, `check_connection.py`, `check_upgrade.py`, `check_live_feed.py`: need live PeerJS or release servers. Not run.

Small commit on top of the merges: `check_game.py`, `check_hook.py`, `check_settings.py` and `check_survival.py` now click `.ob-item[data-act="new"]` and fall back to `#solo`. The title screen hides `#solo` on main, so all four scripts used to time out on the first click.

## Evidence

Integrated screenshots in `docs/loop/shots/feedback-2/`:

- `crafting-missing-rope-hover-1280x720.png`: paddle recipe, rope 1/2 in red with the + shown on hover, count and icon chips, rope tooltip.
- `crafting-after-plus-1280x720.png`: after clicking the +. Rope is 2/2 and the paddle recipe is still open and ready.
- `box-on-raft-1280x720.png`: a dropped box (2 wood, merged from two Q presses) on the deck near the new front-corner anchor.
- `box-in-water-1280x720.png`: a Ctrl+Q stack box bobbing at sea, seen while swimming.
- `paddle-mid-stroke.png`: paddle blade pinned halfway through the pull, at the raft edge.

Lane screenshots are kept in `docs/loop/shots/crafting-ui/` and `docs/loop/shots/drop-box/`.

## Risks and open items

- Crafting: the hammer prompt chips were not checked live (pointer lock). A locked recipe or a full bag shows no +. Quest tracker text still uses words.
- Drop box: Ctrl+Q quits Firefox on Linux. The 40-box cap means up to 40 extra draw calls. Boxes can get stuck in a U-shaped raft. Drop height from upper floors is not tuned. Coop was only tested over loopback by the builder, not live.
- Paddle: the stroke cooldown is shared across coop players, so a second player's stroke within the cooldown is dropped silently.
- Movement: the aim plane stays flat on a tilted deck. The faster stop may feel too crisp to some players.
- Coop and saves: `world.ext.dropbox` is optional and old saves load without it. The anchor is derived from tiles. Events keep their text fields for old peers. The old-save path is covered by tests and by `check_paddle.py`. Live two-browser coop was not run in this pass.
