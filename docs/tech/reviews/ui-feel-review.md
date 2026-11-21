# UI-FEEL review, round 2 (harsh judge)

Reviewed `origin/retarget/ui-feel` @ a466afe. ADOPT says it was checked against `3c62305` (game.js 1780 lines).
`origin/main` has moved on twice since then: round 3 (3031d67), then round 4 (**8d21618**, game.js 2284 lines,
10-slot hotbar). I judged against **both**: 3c62305, because that is what the doc claims, and 8d21618, because
that is current main and the brief requires "correct against the CURRENT dist code". I re-ran everything myself.

## Scores

| Axis | Score |
|---|---|
| LOOKS | 6 |
| COST | 8 |
| ADOPT-CORRECTNESS | 4 |
| **OVERALL** | **5** |

All five round-1 fixes are done properly, and on 3c62305 this is a clean 7-8. On current main, ADOPT no longer
applies as written. Once the two broken blocks are fixed by hand, the result has a visibly broken reticle, empty
fly icons, and one new test failure. The decision table ("Main today") also describes a HUD that main has
replaced.

## Round 1 in short (e843823, OVERALL 6)

LOOKS 7 / COST 8 / ADOPT 5. Required fixes:

1. Fullscreen hid every toast.
2. Toasts covered the open inventory at 761-1279 px.
3. Unguarded `feelEffect` and per-frame calls, plus a `querySelector` throw on a hostile recipe.
4. The partner's build flashed your reticle.
5. The docs overstated the "transform/opacity only" rule.

## Round-1 fixes, verified

| # | Status | Evidence |
|---|---|---|
| 1 fullscreen | **Fixed** (and moot in game: `toasts:false`) | `fullscreenchange` and any `dialog[open]` re-raise the popover. shoot.py `fullscreen.toastIsTopmost: true`. (The `26-fullscreen-toasts.png` frame itself shows no toast: the rows expired before the screenshot. Freeze them like frame 25.) |
| 2 inventory overlap | **Fixed** (standalone only) | My own probe, not frozen, at 1280x720 and 1024x600: one row (`uf-top`, `uf-tight` at 1024) in the band above the panel. shoot.py `overlapPanelContent: 0` at all three sizes. At 1920 the stack stays bottom-right beside the panel. |
| 3 guards | **Fixed** | `feelEffect` is wrapped in try and returns false. The per-frame call is gated by `feelFailed`. `crafted()` accepts only strings and uses `CSS.escape`. realgame: `guardEffect` (feed still gets the row), `guardHostileCraft`, `guardFrame` (`feelFailed`, game keeps running), 0 page errors. |
| 4 partner build | **Fixed** | `by:actor` on the 3 build emits. realgame `buildMarker`: partner 0, no owner 0, mine 1. |
| 5 docs rule | **Fixed** | Exceptions are listed (dashoffset, hover box-shadow/background/filter, backdrop). The merge pop no longer animates `color`. |

Round-1 nice-to-haves also landed:

- `destroy()` removes `#ui-feel-style` (verified: style 1 -> 0).
- Wider fan.
- Generic-flight halo and minimum scale.
- `.sv-dragging`/`.sv-src`/`.sv-over` excluded from press states.
- `var(--ui-font)`.
- The count is held until the icon lands (`countHeldUntilLanding`: painted 4, shown "2").

## Retarget decisions

- **Feeds, against 3c62305 and 8d21618: correct.** `toasts:false` means no `#uf-toasts`, and the pickup feed
  keeps every row, so there is no second text feed. `hotbarCursor:'auto'` sees `.sv-cursor`, so there is no
  second cursor. realgame `attached`: `ownCursorShown false, mainCursor true, toastPopover false`.
- **The branch does not touch main's tests.** `git diff origin/main...HEAD` touches only docs/ and sandbox/.
- **Reticle: stale against current main.** Main (8d21618) now has its own reticle feedback:
  - `graphics.css:328` makes `#crosshair` a 4 px dot.
  - `#crosshair.usable` grows it to 8 px over interactables (game.js `updateContext`).
  - `#chargeMeter` is now a conic **ring around the crosshair** (graphics.css:315), not a bar.

  ADOPT's table still says "static ring + `#chargeMeter` bar beside the prompt". ui-feel's hover ring and
  charge arc now *replace* a design that main deliberately chose. The prompts.css append hides main's ring, and
  ui-feel's 40 px box overrides the `.usable` size. That is a product decision ADOPT has to state and own, not
  slip in.
- **Stat bars: stale.** Main now ships health/food/water bars (bottom-left, see the screenshot below). ADOPT §4
  ("The game has no health, hunger or thirst") and the "bottom-right, feed owns bottom-left" placement are
  out of date.

## What I ran

- `shoot.py --shots-only` printed `errors: []`. I read frames 04, 05, 06 (fly, held counts, landing bump +
  ring), 19 (reticle states), 20 (reduced motion: nothing in flight), 21 (phone), 25 at three sizes, and 26.
  The mock's look is good.
- `realgame.py` (3c62305) applied 13 blocks. This time a **real hook catch landed** (`via: hook catch`, 2 wood).
  `heldWhileFlying` held a fresh slot blank, the feed got `+2 Plank`, fullscreen showed 4 icons flying, the
  build marker and guards behaved, and the only errors were the two favicon 404s. I read rg-01, 02, 04, 05 and
  06. **However, `craftReady: 0`**: with only 2 wood the craft step was silently skipped, so the craft
  flash was *not* exercised in the real game in this run. The script passes vacuously.
- **My own literal patcher** (`<!-- copy/apply/append -->` blocks):
  - 3c62305: all 11 game.js blocks, the copy and the append each matched exactly once.
  - **8d21618: 2 of 11 blocks match 0 times.**
    - 2a: game.js:55 already reads `import { createSurvivalUI, iconSVG } ...`.
    - 2g: line 1637 is now `refreshPointerUI(); updateCharge(); updateContext(dialog); updateSignalHud(); updateNotices(dialog); warmKinds();`.
  - The other 9 still match. I hand-fixed those two to keep testing.
- **Node tests, `node --test tests/*.test.mjs`:**
  - 3c62305: 532/533 both unpatched and patched. The failure is the `atlas ... build stays fast` timing test, on both.
  - 8d21618: unpatched 909/910 (same atlas timing failure). **Patched 908/910.** The new failure is
    `live.js PRELOAD equals the static import graph of game.js` (`missing: ['ui-feel.js']`,
    tests/live-preload.test.mjs).
- **Coop / `by:actor`.** It is a plain string inside an `effect` message. `coop.encode` only rewrites
  `move`/`state`, so effects pass through untouched. Nothing in dist reads `e.by`. `session-rules.js PROTOCOL = 1`
  is unaffected, and an older peer ignores the field. Safe.
- **Hot swap (8d21618 patched).** The boot instance plus two more `createUIFeel` calls from fresh module URLs
  give `#ui-feel-style` 1, `#uf-layer` 1, `.uf-x` 4, MutationObservers 5, ResizeObservers 2, the same after each
  call. `destroy()` drops them back to the game's own 3/1 and removes the style and the `uf-rm` class. No duplicates.
- **Reduced motion.** `html.uf-rm` is set under `reduced_motion='reduce'`, and frame 20 shows no flight.
- **Reticle on the real game.** I faked pointer lock so `#crosshair` shows and zoomed 4x:
  - 3c62305: clean ring, arc, dot.
  - 8d21618: **a grey square outline around the reticle** (`scratchpad ret-curp-hover.png / ret-curp-charge.png`).
    Main's new `#crosshair{box-shadow:0 0 0 1px #0003,0 0 3px #0006}` now draws on ui-feel's 40x40 box,
    because ui-feel sets `border-radius:0` and does not reset `box-shadow`. It shows in every frame of play.
- **Loot fly on 8d21618.** `effect({kind:'loot', ...})` launches 3 flights, but **every `.uf-art` is empty**: only
  `+3`/`+2` labels fly. ADOPT 2c's `iconHTML` calls `getItemIcon`, which game.js no longer imports (main moved it
  into the pickup feed). The ReferenceError is swallowed by `safe()`, so any item that is not already in a
  hotbar slot flies as a bare number: every backpack-bound or first-of-kind pickup, and every guest generic
  flight.

## Cost

Unchanged in substance from the round-2 table and plausible on re-read:

- idle 0/0.
- pickup +3 layouts / +28 recalcs / +4.7 ms script over 12 pickups.
- select equal to nofeel, since there is no own cursor any more.
- inventory +4 layouts per 4 open/close pairs.

No per-frame DOM writes when nothing changes. COST 8.

## Required fixes (OVERALL < 7)

1. **Re-check ADOPT against current `origin/main` (8d21618) and make every block match.**
   - 2a: only add `import { createUIFeel } from './ui-feel.js?build=...'`, because `iconSVG` is already imported.
   - 2g: use the new context line, which ends in `updateNotices(dialog); warmKinds();`.
   - Refresh the header and line numbers (game.js 2284 lines, `HOTBAR = 10`).
   - realgame.py should fail loudly when the base is not current main.
2. **Fly icons are empty on current main.** 2c's `iconHTML` uses `getItemIcon`, which is no longer imported in
   game.js. Either add `import { getItemIcon } from './item-icons.js?build=...'` in 2a, or make `iconHTML` use
   `iconSVG` only. Have realgame assert that a flying `.uf-art` is non-empty.
3. **Add `'ui-feel.js'` to `dist/live.js` `PRELOAD`** as an ADOPT block. Otherwise
   `tests/live-preload.test.mjs` fails on the patched build.
4. **The reticle clashes with main's new crosshair.**
   - In `ui-feel.js`, `#crosshair.uf-xh` must reset `box-shadow`, `background`, `filter` and `transition`
     (main's 4 px-dot rules at graphics.css:328-330) so there is no square outline.
   - Update the retarget table to the current main (4 px dot, `.usable` growth, conic `#chargeMeter` ring),
     and **state explicitly** whether ui-feel replaces main's ring and dot or defers to them. If it replaces
     them, say why that beats main's deliberate minimal design.
   - Update §4: vitals bars now exist bottom-left.
5. **realgame.py craft step must not pass vacuously.** If `craftReady == 0` after the pickup, top the bag up
   through the QA action or fail. The doc's "`crafted('rope')` returned true" was not reproduced.

## Nice-to-haves

- The 26-fullscreen frame should freeze the toasts like frame 25, so the PNG shows what the JSON claims.
- In rg-02 the in-flight icon is tiny near the bar (the scale-down reads as a speck at 600 ms). Consider ending
  the shrink later.
- A two-browser `check_multiplayer.py` run on a GPU machine is still owed for `by:actor`.
