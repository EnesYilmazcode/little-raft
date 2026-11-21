# Little Raft onboarding: UX design (v1)

The game teaches through three surfaces only: **Tracker** (top-right notes), **Prompt** (small slot just below and right of
the crosshair) and **Feed** (bottom-left event lines). There are no modals and no centre banners.
Ground truth comes from the code: LMB press starts the hook charge and release throws it (`beginCharge`/`releaseCharge`); holding LMB
while the hook is out reels it in. E picks up a supply within 2.5 m, or opens the bag when nothing is targeted (`interact`).
Tab/I toggle the bag (survival-ui.js:615). R repairs. 1-8 or the wheel pick a hotbar slot. Esc frees the mouse or opens settings.
Hammer + LMB on an empty spot next to the raft builds a floor tile (2 wood + 2 plastic). Decor in hand + LMB on a free tile places it.
Rod + LMB on water waits 3-5 s, then `fish` adds 1. RMB is unused (contextmenu is suppressed).

## 0. Condition helpers (all read `raftDebug.state`, polled every 250 ms)
- `S` = current state, `S0` = snapshot taken when the step became active. `inv(k)` = `S.stock[k] ?? 0`.
- `gained(k)` = running sum of positive per-poll increases of `S.stock[k]` since activation. Crafting spends items, so a
  plain count could go back down; this sum cannot.
- `yawTravel` = running sum of |wrapPi(S.me.yaw - prevYaw)| since activation. `walked` = hypot(S.me.x-S0.me.x, S.me.z-S0.me.z).
- Steps are **sticky**: once the condition is true, the step is done even if the counts drop later.
- Polls are skipped while `!S.running`. Hosts and solo players see their own bag. Tiles, decor and fish are shared, so a guest
  also gets credit for a brother's build. That is intentional and friendly.
- On Continue, every step whose condition already holds against `S0 = fresh-start defaults` is auto-completed silently (no feed spam).

## 1. Steps
Visibility: the tracker shows the first ≤3 incomplete steps in order whose `needs` are all done. Field order: id · title · hint · done when.

### Chapter 1 "First Ten Minutes"
| id | title | hint | done when |
|---|---|---|---|
| look | Look out to sea | Move the [Mouse] to look around | `yawTravel ≥ 1.6` (rad) |
| walk | Stretch your legs | [W][A][S][D] to walk, [Space] hops | `walked ≥ 1.5` |
| throw | Toss your hook | Hold [LMB] to wind up, let go to throw | `S.hookStage ∈ {flying,floating,reeling}` |
| reel | Reel in a treasure | Hold [LMB] while the hook floats | `S.collected - S0.collected ≥ 1` (needs throw) |
| wood | Gather 6 wood | Planks and barrels give wood | `gained('wood') ≥ 6` (needs reel) |
| leaves | Gather 4 palm leaves | Leafy bundles drift by now and then | `gained('leaf') ≥ 4` (needs reel) |
| bag | Peek in your bag | [Tab] opens your bag | `S.inventoryOpen === true` (needs reel) |
| rope | Twist 2 rope | In your bag: Rope, 2 leaves each | `gained('rope') ≥ 2` (needs bag, leaves) |
| hammer | Make a hammer | Bag: 4 wood + 2 rope | `S.ownedTools.includes('hammer')` (needs rope, wood) |
| plastic | Fish out 2 plastic | Hook the bobbing jugs | `gained('plastic') ≥ 2` (needs hammer) |
| floor | Add a floor tile | Hammer [1]–[8], aim beside the raft, [LMB] | `S.tiles - S0.tiles ≥ 1` (needs hammer) |

Pacing: look, walk and throw show together at spawn. The `reel` step pops in once `throw` completes. The resource steps show
in parallel with their crafts, so a fast player never waits on the tracker.

### Chapter 2 "Make Yourself at Home" (about 10-35 min)
| id | title | hint | done when |
|---|---|---|---|
| grow3 | Grow your raft by 3 | Each tile: 2 wood + 2 plastic | `S.tiles ≥ S0.tiles + 3` |
| grab | Grab one by hand | Walk close, [E] picks it up | `S.collected` rises on a poll where the previous poll had `S.pickup` set and `S.hookStage==='idle'` |
| barrel | Hook a barrel | Barrels hold a bit of everything | `S.hookCaughtItems.some(c=>c.type==='barrel')` or a single poll delta of wood+3, leaf+2, scrap+1, plastic+1 |
| palm-craft | Make a palm planter | Bag: 2 wood + 3 leaves | `gained('palm') ≥ 1` |
| plant | Plant your first palm | Hold it, aim at the deck, [LMB] | `S.decor.some(d=>d.type==='palm')` |
| lantern | Hang a lantern | Bag: 2 wood + 2 scrap, then place it | `S.decor.some(d=>d.type==='lantern')` |
| repair* | Mend your hook | [R] repairs: 2 wood + 1 scrap | `S.hookHealth === 100` after `S.hookHealth < 100` was seen |

\* `repair` appears only after `S.hookHealth ≤ 50`. It is never blocking. The farming lane adds its crop steps here (see the API below).

### Chapter 3 "A Home on the Water" (about 35-60 min)
| id | title | hint | done when |
|---|---|---|---|
| rope8 | Stock up on rope | A rod needs 8 rope (16 leaves) | `inv('rope') ≥ 8` or `ownedTools` has fishingrod |
| rod | Make a fishing rod | Bag: 6 wood + 8 rope | `S.ownedTools.includes('fishingrod')` |
| fish1 | Catch a fish | Rod in hand, aim at water, [LMB] | `S.fish - S0.fish ≥ 1` |
| fish3 | Catch two more | Patience. Watch the bobber dip | `S.fish - S0.fish ≥ 3` (S0 taken at fish1 activation) |
| sail | Raise a sail | Bag: 4 wood, 3 rope, 3 leaves | `S.decor.some(d=>d.type==='sail')` |
| seat | Build a bench | Somewhere to watch the waves | `S.decor.some(d=>d.type==='bench')` |
| crate | Make a storage crate | Bag: 4 wood + 1 scrap | `S.decor.some(d=>d.type==='crate')` |
| home | Reach 16 tiles | A proper little home | `S.tiles ≥ 16` |

**Extension API (farming lane):** `window.raftOnboarding.register({chapter:'ch2', after:'plant', steps:[{id, title, hint,
needs:[], done:(S, ctx)=>bool}]})`. Here `ctx` exposes `S0`, `gained(k)`, `yawTravel` and `walked`. Ids must be unique (the
call throws otherwise). A chapter is complete only when every step in it, registered ones included, is done. Registering
after load re-opens a finished chapter, with no fanfare.

Persistence: completed ids go in `localStorage['little-raft-onboarding-v1']` (try/catch) and are cleared by New Game.

## 2. Tracker ("Notes")
- **Corner: top-right**, at `top:84px; right:28px; width:248px`. This is the slot of the legacy `.goal` panel, which the tracker
  replaces (hide `.goal`). Top-left already holds SHARED SUPPLIES. The bottom is taken by the hotbar (centre), the durability
  meter (bottom-left, 28/28) and the feed. Top-right is also where Raft's notes sit, so players look there by habit.
- **Look:** a `--plate` panel with a bronze hairline (`--frame`), radius 6px, padding 10px 14px. Header: chapter name in
  `--display-font` italic 13px `--bronze-lt`, then a thin rule. Rows: a 12px checkbox outline, the title in 13px/600 `--cream`,
  and the hint below it in 11px `--cream-dim` with inline key glyphs (§3). A row with a count shows `3/6` right-aligned, tabular-nums.
- **Expanded** (default): header plus ≤3 rows, about 150px tall at most. **Collapsed:** a 28px header strip "Notes · 2/3" with a chevron.
- **Toggle key: N** ("Notes"). Every key in use: WASD, arrows, Space, Shift, 1-8, E, R, Tab, I, Esc and the wheel. N and J are
  both free in game.js, survival-ui.js and settings.js. N is mnemonic. Clicking the header also toggles when the mouse is free.
  The state is remembered in localStorage.
- **Auto-dim:** opacity .55 after 20 s with no progress. It returns to 1 on any progress or when N is pressed. Hidden while
  `S.inventoryOpen` would also hide the instructions, so instead the tracker stays visible and slides 8px left of the bag panel if they overlap.
- **Completion animation** (about 900 ms): the box fills `--amber` and a check strokes in (160 ms). The title gets a strikethrough
  drawn left to right (240 ms). The row holds for 300 ms, then fades and its height collapses (200 ms). The next row fades up from 6px below (200 ms).
  A soft beep plays, and the feed gets `✓ Toss your hook`. With `prefers-reduced-motion`, rows simply crossfade.
- **Chapter done:** the header text shimmers once in amber, the feed gets `Chapter 1 complete: First Ten Minutes`, and after 2 s
  the next chapter's header and rows slide in.
- **All done:** the panel shrinks over 600 ms to a **tiny "Notes" tab**: 64×22px, top-right, 11px small caps, opacity .6.
  N or a click expands a read-only log of the chapters with every step ticked. It shows again by itself only when a registered
  step adds new work.

## 3. Prompt slot
- **Position:** anchored to the crosshair centre, `left:calc(50% + 22px); top:calc(50% + 16px)`, left-aligned, growing right
  and down. It never sits under the dot itself. This replaces today's centred `#contextPrompt` (top:50%+26px, translateX(-50%)).
- **Type:** 13px/1.35 `--ui-font` 600, `--cream`, text-shadow `0 1px 2px #000c`, no plate by default. Over bright sky it gets
  a faint `rgba(8,17,26,.45)` pill with 2px 8px padding. Max width 240px, **max 2 lines**, one action per line.
- **Key glyphs:** keycap boxes 18px high, min-width 18px, padding 0 5px, 1px border `rgba(241,231,208,.7)`, bottom border 2px,
  radius 4px, 11px/700, with an 8px gap before the label. Letter keys show the letter (`E`, `R`). `Tab` is a wider cap.
  Mouse buttons use a 12×16 mouse outline SVG with the left or right half filled amber, and "Hold" goes in front as a word: `Hold [LMB]  Throw`.
- **Timing:** fade in 120 ms after the target has held for 80 ms (stops flicker on sweeps). Fade out 180 ms. When the content
  changes, crossfade 100 ms without moving the slot.
- **Priority** (highest first; line 1 = the winner, line 2 = an optional secondary for the same target):
  1. Hook out and floating or reeling: `Hold [LMB]  Reel in`
  2. Charging: `Release [LMB]  Throw`. The charge meter loses its "THROW POWER" text and becomes a 4px bar under this line.
  3. Pickup in reach: `[E]  Pick up plank`, with line 2 `[Tab]  Bag` only while step `bag` is active.
  4. Valid placement: `[LMB]  Build floor` + `2 wood · 2 plastic` (dimmed when unaffordable: `Need 1 more plastic`). For decor, `[LMB]  Place palm planter`.
  5. Rod aimed at water: `[LMB]  Cast line`, or `Waiting for a bite…` while `hookStage==='fishing'`.
  6. Hook held, aiming at water, idle: `Hold [LMB]  Throw`. It shows only until 5 throws are done (stored in localStorage) or while step `throw` is active.
- `notice()` lines (bag full, missing items, crafted) move to the **Feed** and stay out of this slot. The slot hides whenever a dialog is open or the mouse is free.

## 4. Event feed (support for the onboarding surfaces)
Bottom-left at `left:28px; bottom:112px` (above `#durability`). On narrow screens it sits at `bottom:260px`. Up to 4 lines,
newest at the bottom. Each line is 12px `--cream` on a `--plate` chip and lives for 4 s, then fades over 400 ms. Lines with the same text merge as `×2`.
Sources: loot `+ 2 Wood`, crafts, builds, step checks, chapter completes, and notices.

## 5. Title screen
- **Layout:** a left-aligned column at `margin-left:8vw`, vertically centred (the existing `.welcome-card` slot). The left
  gradient scrim stays. Hide `.header-right` and the HUD on the title screen, because the menu already covers those buttons.
- **Logo:** "Little Raft" in `--display-font` 64px (44px on mobile), `--cream`, letter-spacing -1px, with the sail icon to the
  left at 1em. Under it, the tagline "A little ocean. A big adventure." in 13px small caps `--bronze-lt`. It fades in 600 ms after
  the ocean's first frame. There's no other marketing copy (the current h1, paragraph and pills go).
- **Menu:** vertical text buttons, 18px/600, 44px row height, left-aligned, with no plates. On hover or focus a 3px amber bar
  grows at the left and the label shifts 6px right. Arrow keys, Enter and mouse all work.
  1. **Continue** shows only when `localStorage.getItem('little-raft-v1')` is non-null (try/catch). It's first and focused, with a
     sub-line in 11px `--muted` from the save: `9 tiles · 3 fish`.
  2. **New Game** (focused when there is no save)
  3. **Play together** (opens the existing `#crew` dialog: an existing flow, out of scope here)
  4. **Settings** (the `settingsController.open()` overlay)
  A small save-status line in 11px `--muted` sits 24px below the menu: "Saves automatically in this browser".
- **Slow camera:** keep the welcome orbit (game.js updateCamera, not running), but slow it to one revolution per 150 s at
  radius 23 and height 0.68 ± 0.12 (sin, period about 120 s), looking at the raft. `cameraMotion=0` freezes it on a pleasing angle. On
  New Game or Continue the camera eases over 900 ms into the eye position while the menu fades and slides 12px left, and then the tracker fades in.
- **New Game with a save (inline two-step, no modal):** the first activation swaps the New Game row in place for
  `Start over? This raft will be lost` (13px `--cream-dim`) with two inline buttons, `Start fresh` (amber text) and
  `Keep my raft` (focused by default). Esc, clicking elsewhere or 6 s of inactivity returns the row to normal. `Start fresh`
  removes `little-raft-v1` and `little-raft-onboarding-v1`, then starts a new world. Without a save, New Game starts at once.
