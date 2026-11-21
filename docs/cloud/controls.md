# Controls lane: input, gamepad and movement feel

Branch: `claude/raft-controls`. All of the lane's code is in new files under `dist/`. `dist/game.js` gets small hooks, each marked `// controls lane`.

## What was built

| File | What it does |
|---|---|
| `dist/input-map.js` | Pure, no DOM. `ACTIONS`, `DEFAULT_BINDINGS`, `SETTINGS_DEFAULTS`, and `ActionMap`: rebinding with conflict swap, Escape reserved for pause, unbind/reset, settings clamping, and `localStorage` persistence under `little-raft-controls-v1` (bad saved data is ignored). Also `shapeStick` (radial deadzone, rescale, response curve), `smoothLook` and `label()`. |
| `dist/input.js` | Keyboard, mouse, pointer lock and Gamepad layer. Reports per-frame action state (`down`/`pressed`/`released`), `move()`, `lookDelta()` in radians, hold/toggle sprint and crouch, analog `triggers()`, and `hotbarStep()`/`hotbarSlot()`. |
| `dist/move-feel.js` | Pure. Acceleration S-curve, sprint blend, crouch (half speed, eye 0.55 m lower), head bob tied to distance walked with a footstep event at each bob trough, landing-dip spring, a ladder API (`setLadder`, `ladderInput`, `isOnLadder`) and `motionScale` for accessibility. Same results at any frame rate. |
| `dist/controls.js` | Connects the modules above to game callbacks and adds an extra ground brake so stops are quick. Puts `window.raftControls` on the page (`map`, `input`, `feel`, `mountTab(el)`, `unmountTab(tab)`, `radialOpen`). |
| `dist/controls-tab.js` | Controls settings tab as a DOM module (`.lrc-` classes). Has Feel options: invert mouse Y and gamepad Y, sprint and crouch hold/toggle, smoothing, deadzone, curve and look speed. Rebinding grid: two key slots and one gamepad slot per action. Esc cancels a capture, Backspace clears a slot. Mouse buttons, wheel and gamepad buttons can be captured. "Reset all" button. Keyboard accessible. |
| `dist/build-radial.js` | Gamepad radial for build pieces (`.lrr-` classes). Opens while D-pad up is held, the right stick (or mouse while locked) picks a piece, releasing places it. |
| `dist/controls-preview.html` | Standalone preview of the tab and the radial. |

### Default bindings (similar to Raft)
| Action | Keyboard / mouse | Gamepad (standard mapping) |
|---|---|---|
| Move | WASD / arrows | Left stick |
| Look | Mouse | Right stick (deadzone 0.15, curve 2, 2.6 rad/s) |
| Jump | Space | A |
| Sprint (hold or toggle) | Shift | L3 |
| Crouch (hold or toggle) | Left Ctrl / C | B |
| Use / throw | Left mouse | RT (analog) |
| Aim / reel | Right mouse | LT (analog) |
| Interact | E | X |
| Inventory | Tab / I | Y |
| Hotbar 1–0 | 1…0 | — |
| Hotbar next/prev | Wheel | RB / LB |
| Rotate | R | R3 |
| Drop | Q | Back |
| Pause | Esc | Start |
| Build radial | — | D-pad up (hold) |

## Hooks in existing files
- `dist/game.js`:
  - an import;
  - `let controls`;
  - `clearInput()` also clears the input layer;
  - `movePlayer()` reads shaped input from `controls.movement()` and calls `controls.afterMove()`;
  - `updateCamera()` uses `controls.camera(yaw)` (bob, sway, roll, crouch, landing dip) instead of the old sine bob;
  - the `mousemove` and `keydown` handlers return early when `controls` is running;
  - the wheel handler skips while pointer lock is on (`input.js` steps the hotbar then);
  - `pointerdown` is ignored while the radial is open;
  - one `try { controls = createControls({...callbacks}) }` block in the Input section.
  
  If `createControls` throws, `controls` stays `null` and every original code path runs unchanged.
- `package.json`: `npm test` now runs `tests/*.test.mjs`.

### For other lanes
- **Menus:** call `raftControls.mountTab(container)` to mount the tab, and `raftControls.unmountTab(tab)` to remove it. The dialog must call `document.exitPointerLock()` when it opens.
- **Audio:** listen for the `window` event `little-raft-footstep` (`{side, sprint, crouch}`).
- **Building:** listen for the `window` event `little-raft-action`, which carries `{id:'drop'}`, `{id:'rotate'}` or `{id:'buildPick', piece}`. R still runs the game's existing repair action.
- **Ladders:** call `raftControls.feel.setLadder({bottomY, topY, x, z, normal:[nx,nz]})`, then use `ladderInput()` to get climb `vy` and when to detach.
- **Physics:** for crisper stops, a separate ground deceleration rate in `player-physics.js` (about 20/s) could replace the brake in `controls.js`.

## Feel numbers
These come from a 60 fps node simulation of `PlayerPhysics` with `MoveFeel`; the curves are in `shots/controls/feel-curves.png`.

| Measure | Value |
|---|---|
| Walk 90% speed | 0.25 s, S-curve start |
| Sprint | 4.0 m/s (1.54× walk), 90% in 0.28 s |
| Stop below 10% speed | 0.15 s (0.22 s without the brake) |
| Steps per second | walk ≈2.3, sprint ≈2.75, crouch ≈2.0 |
| Bob | walk 3.5 cm, sprint 5.2 cm, crouch 1 cm |
| Landing dip | about 8 cm after a normal jump; 90% recovered by about 0.33 s |

In game, the crouch camera sits 0.54 m lower (camera y 1.738 → 1.203).

## Robustness
- Keys are released on blur, a hidden tab, pointer lock loss (mouse buttons), Meta keyup (stuck keys on macOS) and dialogs opening.
- Key auto-repeat never counts as a new press, and keys typed in form fields are ignored.
- The first mouse move after lock is dropped, and so is any move over 300 px.
- Ctrl chords are blocked while crouching (no Save or Bookmark dialogs).
- One wheel event steps the hotbar exactly once.
- Gamepads are polled again every frame. Null entries and non-standard mappings are ignored, and the pad used most recently is the one that counts.
- Triggers have hysteresis (on above 0.5, off below 0.4).
- A pad button held through a dialog stays ignored until it is released.
- A trigger held when a dialog opens or the pad disconnects cancels the action instead of throwing.
- The radial closes if a dialog opens over it.

## Tests
`npm test` runs 76 tests:
- `tests/input.test.mjs`: action map, rebinding, persistence, stick shaping.
- `tests/input-layer.test.mjs`: DOM and gamepad layer, using a fake EventTarget and fake pads.
- `tests/move-feel.test.mjs`: ramps, frame-rate independence, footsteps, dip, crouch, ladder.
- `tests/controls.test.mjs`: regression tests for the glue.
- `tests/survival.test.mjs`: existing tests.

## Screenshots (`docs/cloud/shots/controls/`)
- `ingame-walk.png`, `ingame-crouch.png`: first-person view walking and crouched.
- `controls-tab.png`, `controls-tab-capture.png`, `controls-tab-mobile.png`: the tab mounted in game, a slot waiting for a key, and the 390 px layout.
- `build-radial.png`: the radial in game, opened by a simulated gamepad with Sail selected.
- `preview.png`: `controls-preview.html`.
- `feel-curves.png`: speed and eye-offset curves.

(`*.png` is gitignored in this repo, so these are force-added.)

## Known limits
- Clicks are still wired in `game.js`, so a key rebound to `use` or `aim` has no effect. Gamepad RT and LT do work.
- Tab/I for the inventory and Esc for pause stay with `survival-ui.js` and `settings.js`.
- There are 8 hotbar slots today, so `hotbar9` and `hotbar0` are ignored.
