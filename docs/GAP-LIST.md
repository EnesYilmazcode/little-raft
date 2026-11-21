# Gap list: Little Raft baseline vs the Raft reference

Compared the baseline shots in `.qa/baseline/` (1280x720, fresh solo game) against `docs/RAFT-REFERENCE.md`. Ranked by how visible each gap is to the owner. Each row gives what we see now, the target, and where the fix lives.

## P0: the owner will notice in the first ten seconds

1. **Text in the centre of the screen.** `04-thrown` and `06/08` show a "Hold click to reel" pill at y=397, 37px under the crosshair. `03-charging` shows a "THROW POWER" bar at y=415. The `#toast` pill sits at `top:25%` centred (`style.css`). Target: nothing in the middle 40% but the crosshair (ref 3.4). Reel hint goes away (the hands show it), charge becomes a 2px arc round the crosshair, toasts move to the pickup feed. Files: `game.js` (`aimHint` text at line ~408), `index.html` `#chargeMeter`, `style.css` `#toast`, `#aimHint`.
2. **No pickup feed.** Catches never show `+N Item`. Target: bottom-left feed with a 3D icon, 180ms in, 2.5 s hold, 600ms fade, merging counts, pool of 5 rows (ref 3.3). Hook it to the `collected` event in `updateHook` and to hand pickups. Files: `game.js`, `survival-ui.js`, `style.css`.
3. **Empty open hands after the throw.** In `04-thrown`, `06` and `08` the right hand is an open flat palm with nothing in it and the left hand holds only the rope coil. Target: while the hook is out the right hand keeps a reel/rope grip; when reeling both hands pull hand-over-hand at about 2.5 Hz (ref 5.4). File: `hands.js`.
4. **Hotbar reads as a flat 2D wooden panel.** Thick brown frame, 8 slots of 58px, flat SVG icons. Target: 10 plain dark see-through 52px slots, no frame, warm 2px selected border, icons rendered once from the 3D item models (ref 3.1). Files: `survival-ui.js`, `style.css`, `game.js` `HOTBAR = 8` (going to 10 touches tests and the saved bag shape, so do it in one focused change or keep 8 and match the look only).
5. **Sky is grey-green and looks overcast.** Every in-game shot has a flat `~#cdd5c4` sky with dark teal cloud undersides. Target: blue zenith `#5fa8e0` fading to `#cfe6f3` at the horizon, white clouds with light grey bellies (ref 9.1). Files: `sky.js`, possibly fog colour in `game.js`.

## P1: core Raft feel

6. **Start raft is 3x3 tiles (6x6 m).** `game.js` line ~114 builds 9 tiles. Raft starts at 2x2. Target: 4 tiles, so the first foundation built feels like progress (ref 1.1). Check `tests/survival.test.mjs` and the save migration before changing, since old saves already have 9 tiles.
7. **Decorations snap to tile centres and one per tile.** `placementFor` rounds to the tile and rejects any tile that already has decor. Target: free placement at the ray hit, footprint over tiles, overlap test against other decor, R/scroll rotate in 15 degree steps, Shift for a 0.5 m grid (ref 6.2). Saved decor needs float `x,z` plus `rot`; keep reading old integer saves. Files: `game.js` (`placementFor`, `placementCandidates`, decor render and save).
8. **Ghost is a plain mint box.** `ghost` is a 1.9x0.13x1.9 `BoxGeometry`, mint or salmon, for every kind. Target: the real foundation or decor mesh, see-through, valid `#b6ffd0` and invalid `#ff6a55`, slow opacity pulse (ref 6.1.4). Invalid also needs to show when the spot is bad, not only when the player cannot afford it. File: `game.js` `updateGhost`.
9. **No pointing hand while placing.** Target: index-finger pose aimed at the ghost when the hammer or a placeable is held (ref 4.7). File: `hands.js`.
10. **Pause menu is a settings form.** `07-pause`: navy card, Resume plus three small buttons, then five sliders on the first screen. Target: left column of big text buttons over a dimmed, blurred world, sliders moved into an Options tab view (ref 8). Files: `index.html`, `style.css`, `settings.js`.
11. **Crosshair ring is too big.** 22px ring in every shot. Target: 4px dot that grows to 8px over usable targets (ref 3.4.1). File: `style.css`.

## P2: polish

12. **Inventory layout.** `05-inventory` is close to Raft already: recipes left, bag right, hotbar row under the bag. Gaps: no category tabs on the recipes, the help sentence sits in the middle of the panel, the bag grid is 7+7+6 (ragged last row, use 5x4), and the panel's wood frame is heavy. Esc closing it is correct in `06` (no pause, no cursor visible), keep it that way. Files: `survival-ui.js`, `style.css`.
13. **No item switch animation.** Target: 120ms drop, 180ms rise with overshoot (ref 4.4). File: `hands.js`.
14. **Viewmodel shares the world FOV.** In `03-charging` the hook fills the right third of the screen and is cut off. Target: separate viewmodel pass at fixed 60 degree FOV (ref 4.1). Files: `game.js` render loop, `hands.js`.
15. **Islands ring the horizon.** Four or five green islands are always in view. Target: rare landmarks, open sea most of the time (ref 9.5). File: `game.js` or `sky.js`, wherever islands are placed.
16. **Ocean colour.** Close to target but a little pale and grey near the horizon because of the fog colour. Target deep `#1d5f7a`, crests `#3aa6b8`, a clear sun glint (ref 9.2). File: `ocean.js`.
17. **Survival stats are missing.** Raft has health, thirst and hunger. Not asked for yet; if added, bottom-right so the pickup feed keeps bottom-left (ref 3.2).

## Already right

- Spawn holds only the hook in slot 1, matching Raft.
- Charge time `CHARGE_MS = 900` and catch radius 1 m match the Raft feel.
- Hook durability bar under the slot exists; only its colours need the green, amber, red steps.
- Esc from the inventory returns to play without the pause menu.
