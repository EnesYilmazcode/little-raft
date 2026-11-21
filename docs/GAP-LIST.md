# Gap list: Little Raft main vs the Raft reference

Main at `bc5df84`, checked against `docs/RAFT-REFERENCE.md` (rule IDs in brackets). Grounded in the code in `dist/` and headless shots of a fresh solo game at 1280x720 (`shoot.py`: 01 title, 02 spawn, 03 charging, 04 thrown, 05 inventory, 06 Esc from inventory, 07 pause, 08 walked). Ranked by how soon the owner notices. Each row: what main does now, the target, where the fix lives, and which lane owns it.

## P0: visible in the first ten seconds

1. **Text near the screen centre** [R3.0, R3.3.4-5]. Every `notice()`/`toast()` while playing ("Wood placed", "Need 2 more wood", "Hold click to reel", "E Pick up Plank") goes to `#contextPrompt` at `top:calc(50% + 26px)` (`game.js` inline CSS line 48, text from `updateContext` line ~402). Shot 03 shows a "THROW POWER" bar at y=405-427 right under the crosshair (`#chargeMeter`, `graphics.css` line 367). Target: key prompts on one line above the hotbar, status text in the pickup feed, charge as a 2px arc round the crosshair. Lanes: feed, hotbar.
2. **No pickup feed** [R3.2]. Catches only change slot counts; nothing shows `+3 Wood` and nothing lives bottom-left. Target: 40px 3D icon + text rows, 180ms in, 2.5 s hold, 600ms fade, merge counts, pool of 5. Hook it to the hook `collected` path, E pick-ups and crafting. Lane: feed (`dist/pickup-feed.js`).
3. **Hotbar is a wooden panel with flat SVG icons** [R3.1.2-7]. Shots 02-08: 8 slots of 58px inside a brown striped frame with a 2px tan border (`survival-ui.js` CSS lines 117-124), selected slot is a tan gradient, icons from `icons.svg`. Target: 10 plain dark 52px slots, no frame, `#f1e4c3` 2px selected border, 3D-rendered icons shared with bag, recipes and feed. `HOTBAR = 8` in `game.js` line 37 and `HOTBAR_SIZE` in `inventory-state.js`; going to 10 touches tests and saved bags. Lane: hotbar (`dist/item-icons.js`).
4. **Hand is an open empty palm after the throw** [R5.4]. Shot 04: right hand is a flat open palm with nothing in it, left holds a rope coil. Target: right hand keeps a rope grip while the hook is out; hand-over-hand pull at 2.5 Hz while reeling. Lane: viewmodel (`hands.js`).
5. **Overcast grey-green sky** [R10.1, R10.4]. Shots 02-04: flat `~#cdd5c4` sky, clouds with dark teal bellies. Code: `scene.background`/fog `#cbd2c0`, sky defaults zenith `#9ebabb`, horizon `#cbd2c0`, cloud shade `#b9c4c0` (`sky.js` lines 113-118), ocean `uZenith #a9c1c0` (`game.js` line ~291). Target zenith `#5fa8e0`, horizon `#cfe6f3`, white clouds with `#c9d3db` bellies, fog = horizon. Lane: world.
6. **Pause menu is a settings form** [R8]. Shot 07: centred navy card with gold border, Resume plus Fullscreen / How to play / Play together, then five sliders and a select on the first screen (`settings.js` lines 42-61). Target: left column of large text buttons (Resume, Options, Controls, Invite brother, Exit to title) over a dimmed blurred world; sliders inside Options tabs; Esc in Options goes back one level. Lane: menus.

## P1: core Raft feel

7. **Held hook is oversized and enters the centre box** [R4.1, R4.3]. Shot 02: the hook head reaches x 730, y 335 (inside the centre 40%); shot 03: the drawn-back hook fills the right third and is cut by the screen edge. Viewmodels share the world camera FOV (75, `game.js` line ~714); depth is already cleared before them (`viewmodelDepthClear`), so clipping is solved but FOV stretch is not. Target: own pass at fixed 60 degree FOV, item within the lower-right 30%. Lane: viewmodel.
8. **No pointing pose while placing** [R4.8]. `hands.js` has no `setPose`; there are only hook, hammer and rod viewmodels (`buildViewmodels`, `game.js` line ~327). Decor items in hand show no held model at all [R4.4]. Lanes: viewmodel, models.
9. **Decor snaps to tile centres, one per tile** [R6.2.2-4]. `placementFor` (`game.js` line 499) rounds to the tile and refuses a tile that has decor; `applyAction` stores integer `x,z` with no rotation (line ~577); `cleanWorld` drops non-integer decor. Target: free placement at the hit point, footprint and overlap tests, 15 degree rotation, Shift 0.5 m grid, saves with float `x,z` and `rot`, still reading old saves. Lane: placement.
10. **Ghost is a mint box for everything** [R6.1.4, R6.2.5]. `ghost` is one `BoxGeometry(1.9,.13,1.9)` at opacity .55 (`game.js` line 294); turns `#ee8e75` only when a floor is unaffordable, never for a bad spot. Target: real piece mesh, `#b6ffd0` / `#ff6a55` at 40% with a 1.2 Hz pulse. Lane: placement.
11. **No farming** [R9]. Palm Planter is a decor item; there are no seeds, crop plots, seedlings, watering or growth stages anywhere in `dist/`. Target: crop plot placed freely, seed plants a seedling, growth only while watered, 3 stages over 4-6 min, E to harvest into the feed. Lane: farming.
12. **Start raft is 3x3** [R1.1]. `newWorld()` builds 9 tiles (`game.js` line ~113). Target 2x2. Old saves keep their tiles; check `tests/` before changing. Lane: world or placement.
13. **Crosshair is a ring** [R3.3.1-2]. Shots 02-08: about 22px ring with a centre dot (`graphics.css` line 384). Target 4px dot, 8px over usable targets. Lane: hotbar/HUD.
14. **Islands ring the horizon** [R10.6]. 12 islands at 65-90 m in a full circle (`game.js` line ~300); shots 02-04 show 3-4 at once. Target: open sea in most directions. Lane: world.
15. **Esc in the Electron app** [R2.6]. `desktop/main.cjs` has no `before-input-event` handler, so Esc from the inventory can drop pointer lock or fullscreen before the page sees it. Browser behaviour is right (shot 06, `pauseOpenAfterInvEsc` false). Target: intercept Esc in main and forward it with `webContents.executeJavaScript(code, true)`. Lane: menus.

## P2: polish

16. **Inventory layout** [R7]. Shot 05: recipes left and bag right is right. Gaps: no category tabs; bag is 7+7+6 (`grid-template-columns:repeat(7,52px)`, `survival-ui.js` line 147), target 5x4; heavy wooden frame and brown panels; a help sentence under the hotbar row; recipe icons are flat SVG. Lane: hotbar.
17. **Audio is one sine beep** [R11]. `game.js` plays `beep()` (an oscillator) for every effect. `dist/audio.js` (`createOceanAudio`: ambience, throw, splash, collect, build) exists but is **not imported**. Target: ocean ambience plus per-action sounds, pickup pop rate-limited. Lane: audio (wire `audio.js`).
18. **No item switch animation or look lag** [R4.5, R4.7]. Viewmodels swap visibility instantly. Lane: viewmodel.
19. **Ocean a little pale and grey** [R10.2]. Deep `#14505a`, shallow `#3f8c88`, fog washes the far water grey. Target deep `#1d5f7a`, crests `#3aa6b8`, sun glint. Lane: world.
20. **No hammer build menu** [R6.1.1]. The hammer only places floors; structural pieces beyond foundations do not exist. Not asked for yet.
21. **Title screen brand text** is near-invisible dark-on-dark top-left (shot 01). Lane: menus.

## Already right

- Spawn holds only the hook in slot 1 with an empty bag [R1.2].
- Charge `CHARGE_MS = 900`, `MIN_CHARGE = .15`, catch radius about 1 m [R5.1, R5.5].
- Esc from the inventory in the browser closes it without opening pause (shot 06) [R2.6].
- Viewmodels draw after a depth clear, so hands never clip into the world [R4.1, partial].
- Hook durability bar under slot 1 exists; only the three colour steps are missing [R3.1.6].
