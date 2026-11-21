# UI feel: a juicy HUD layer that costs (almost) nothing

Goal: make the DOM HUD respond to the player the way good survival games do. The hotbar should bounce,
loot should visibly fly into the bag, damage should leave a trail, and the reticle should react. All of
this must stay off the layout path and respect `prefers-reduced-motion`.

Prototype: `sandbox/ui-feel/` (serve the repo root, open `/sandbox/ui-feel/`).

- `ui-feel.js` is the module, a drop-in copy target for `dist/ui-feel.js`. It has no imports and carries
  its own CSS.
- `mock.js` builds the mock HUD. It runs the **real, current** `dist/survival-ui.js` (sv3: its own hotbar
  cursor, name tag, paint bumps and 3D icons), the real `dist/pickup-feed.js` and the real `Bag` from
  `dist/inventory-state.js`, under the real `dist/style.css`, `dist/graphics.css` and `dist/prompts.css`, and
  wires ui-feel exactly as ADOPT wires game.js (`toasts:false`: the pickup feed keeps the text). `?toasts=1`
  switches to ui-feel's standalone toast stack; `?nofeel=1` drops ui-feel (cost baseline). The world behind it
  is a static frame of the game (`bg.jpg`).
- `shoot.py` takes key frames frozen mid-animation and measures cost (see below).
- Keys in the sandbox: `1-8` and the wheel select a slot, `E` picks up, `B` picks up a barrel, hold click
  to charge, `F` toggles hover, `X` shows a deny marker, `H`/`J` hurt and heal, `K` drains hunger, `Tab`
  opens the inventory and `M` toggles reduced motion.

Adoption steps are in `docs/tech/ui-feel-ADOPT.md`.

## Retarget onto current main (round 2)

Main now ships its own HUD feedback: `pickup-feed.js` (bottom-left loot/notice rows with 3D icons), `prompts.js`
(`#lrPrompt` key prompt and `#lrFeed`), `coop-feed.js`, and survival-ui sv3 with a sliding `.sv-cursor`, a
name tag and `sv-bumpA/B` paint bumps. Rather than draw a second version of any of these, ui-feel now:

- **drops its toasts in the game** (`toasts:false`): the pickup feed is the one text feed and is unchanged,
  including its node tests. A fourth stack would have put loot text in two corners at once.
- **drops its hotbar cursor and paint bumps** automatically when the hotbar has `.sv-cursor`
  (`hotbarCursor:'auto'`).
- **keeps what main lacks**: the loot fly into the slot, the reticle (hover, charge arc, hit markers), the
  inventory open/close motion, press states and the recipe flash. The fly is now tied to main's bump: the
  target slot keeps its old count (an empty slot stays blank) until the icon lands, then main's own bump plays.

The toast stack stays in the module for hosts without a feed, with the round-1 bugs fixed (fullscreen,
inventory overlap), and the sandbox exercises it with `?toasts=1`.

## What it does

| Feature | How | Where it hooks in |
|---|---|---|
| Hotbar select (standalone only; off under survival-ui sv3) | A single gold cursor in a fixed overlay slides between cached slot positions (`transform` transition, back-ease overshoot) and squashes in the direction of travel. The new icon hops (scale 1.22 and -7 px). | A MutationObserver on `.tools` sees `.sv-sel` move. survival-ui is untouched. |
| Pickup fly | Pooled icons (8) pop out of the reticle, hang for a beat, then accelerate along a quadratic curve into the slot that received the item, with `+N` riding along. On landing the slot icon bumps, the count text pops, and a ring flashes. When no hotbar slot shows the gain (the item went to the backpack, or a guest's predicted bag does not have it yet) the icon flies to a **generic target**, the middle of the hotbar's top edge, and shrinks into the bar. The real slot then bumps through the observer whenever it is painted. | `uiFeel.pickup(items)` from `effect()` on `loot`. The target is the hotbar stack whose count in the live Bag differs from the last observed paint, so it is correct before survival-ui repaints, and it never guesses. |
| Count held until landing | While an icon flies to a slot the slot gets `uf-wait`: its `.sv-count` text is hidden and a `::after` shows the count the observer last saw (`data-uf-old`); an empty slot also hides its new art (`uf-fresh`); survival-ui's paint bump is suspended (`animation:none`). On landing the classes go, so main's `sv-bumpA/B` animation starts exactly then. | `pickup()`; pure CSS on survival-ui's markup |
| Count bumps (standalone only) | Any hotbar or inventory count change outside a fly gets a small pop (up) or dip (down). Off when survival-ui bumps its own slots. | The same observers. |
| Toast stack (standalone only, `toasts:true`) | Desktop: five pooled rows at bottom right, newest at the bottom. Phone (760 px wide or less): three rows dropping from the top centre, newest on top. Older rows slide away and dim to 60%. The stack is a `popover="manual"` in the **top layer**, re-shown after every `<dialog>` opens and every `fullscreenchange`, so it reads above modal backdrops and above a fullscreen `<html>`. While a modal is open it moves to where the dialog leaves room (beside it if 250 px are free on the right, else the larger of the top/bottom gaps, 1-2 rows). A repeat merges into the visible row (`Wood +2` becomes `Wood +6` with a number pop and an opacity glow) and resets its 3.2 s life. Each kind has its own accent stripe: loot is amber, craft gold, build teal, full/warn red. | `uiFeel.toast(text, {kind, icon, amount, key})` |
| Stat bars | The fill and trail are full-width layers scaled with `scaleX`. On **damage** the fill drops in 110 ms, a pale-amber trail holds for 420 ms and then drains over 520 ms, the track flashes, and the icon shakes when the hit is above 12%. On **heal** a green ghost snaps ahead and the fill catches up. At 25% or less the bar pulses (opacity). Re-targeting mid-animation starts from the *visual* value, computed from `getComputedTiming().progress` without reading styles. | `uiFeel.statBar(container, {tone})`, then `.set(v)` |
| Crosshair | Built inside the existing `#crosshair`: ring, dot, an SVG charge arc and four hit ticks. **Hover** grows the ring to 1.32x and turns it gold. **Charge** fills an amber arc (via `stroke-dashoffset`), and at full charge it turns gold, glows and pops. **Hit** variants: `hit` (cream), `gold` (catch or pickup) and `deny` (red ticks with a ring shake). | `crosshair.hover(bool)`, `crosshair.charge(v or null)` and `crosshair.hit(kind)` from `frame()`, `updateHook()` and `effect()` |
| Inventory open/close | Pure CSS. The panel fades in from 0.96 scale and +14 px, the craft column slides in from the left and the bag from the right, and the backdrop fades. On close it fades out over 120 ms. `@starting-style` plus `overlay`/`display` `allow-discrete` keep the dialog in the top layer while it animates out, *after* `open` is already gone, so `dialog[open]` checks in game.js do not change. | None. |
| Craft | The recipe row gets a gold flash (opacity on its `::after`) and its icon pops. | `uiFeel.crafted(recipeIdOrKind)`: strings only, looked up with `CSS.escape` by `data-recipe`, then `data-tip-kind` |
| Press states | Slots sink 2 px, scale to 0.88, darken to 70% and show a gold inner ring with an inset shadow (not while being dragged: `.sv-dragging`, `.sv-src`, `.sv-over` are excluded). They spring back with the back-ease on release. Recipes and the craft button sink 1 px, and recipe icons tilt on hover. `.primary` drops onto its 3 px base. `.secondary`, header buttons, Repair, Copy and Close press too. | None (CSS). |
| Reduced motion | `matchMedia('(prefers-reduced-motion: reduce)')` toggles `html.uf-rm`, and every effect has a no-motion branch. The cursor jumps, nothing flies (the target slot gets a quiet glow instead), the trail fades instead of draining, the inventory only fades, toasts fade in place, and there is no shake and no pulse. `setReducedMotion(true/false/'auto')` lets a settings toggle override the OS setting. | None. |

## Rules that keep it cheap

1. **Anything that moves animates only `transform` and `opacity`**: the fly, bumps, slides, shakes, the stat
   fill and trail, the toast rows, the count pop and the toast merge pop (which no longer animates `color`).
   The craft flash and the toast merge glow animate the `opacity` of an overlay (`::after` / a pooled `<i>`).
   Exceptions, all small boxes and discrete state changes rather than continuous motion:
   - the charge arc's `stroke-dashoffset` on a 40 px SVG, written while charging;
   - `box-shadow`/`background`/`filter` transitions (50-180 ms) on hover/press of slots, recipes, the craft
     button and menu buttons, and on the reticle ring and dot when hover toggles;
   - the inventory `::backdrop` `background-color` fade on open/close.
1b. **No permanent layers, no layout on animation start.** Only the cursor keeps `will-change: transform`.
   Every other animated node (slot art and counts, fly icons, rings, hit ticks, toast numbers, stat icons,
   recipe art) carries a static 2D identity `transform: translate(0)`. It costs no layer, and it means the
   node is already a containing block, so a WAAPI transform starting or ending does not trigger layout.
   Removing the old `will-change` without this took `select` from 2 to 64 layouts. The animation promotes
   the node to a compositor layer only while it runs.
2. **Layout is read in one place**: the `ResizeObserver` callback on `.tools`, which runs after layout and
   before paint, so the read is already clean. That callback, plus `resize`, caches the 8 slot rects.
   Selection, fly and ring motion all use the cached numbers. The same callback publishes the hotbar box as
   `--uf-hbx/--uf-hbw/--uf-hbt` on `<html>`. The phone stat strip is positioned from those. No per-frame or animation path calls
   `getBoundingClientRect`, `offsetWidth` or `getComputedStyle`. The standalone toast stack reads one dialog's
   `offset*` once per dialog open/close (to place itself), and the flight hold reads no layout.
3. **No reflow tricks to restart animations.** WAAPI `el.animate()` restarts cleanly. The naive version,
   `animation:none; void el.offsetWidth; animation:...`, is the `naive-select` row below.
4. **Pooled nodes.** 8 fly nodes, 4 rings, 6 toast rows and one cursor are created once. A toast reuse
   changes only its text, `data-kind` and, when the kind changed, its icon.
5. **No per-frame DOM writes when nothing changes.** `crosshair.hover()` and `charge()` return early,
   `statBar.set()` ignores an unchanged value, and `effect()` events only happen on actual events.
6. **No changes to survival-ui's render path.** The feel layer reacts through two MutationObservers. They
   fire once per paint batch, in a microtask after survival-ui's writes, and do only class and WAAPI work.
   A broken feel layer cannot break the inventory. Every public method is guarded inside the module (logs,
   returns false). In game.js, creation is in `try`, `feelEffect` is in `try` and returns false on error, and
   the per-frame reticle call is gated with `feelFailed` exactly like `survivalUI.update` / `uiFailed`.

## Measurements

### Round 2, on current main (retarget)

`shoot.py --cost-only --reps 2`, median of 2 fresh pages, on the new mock (survival-ui sv3 + pickup feed, wired
as ADOPT). Raw data: `sandbox/ui-feel/shots/report.json`. Machine load average was 40+, so trust counts over ms.

| Scenario (120 frames) | style ms / recalcs | layout ms / layouts | script ms |
|---|---|---|---|
| idle | 0 / 0 | 0 / 0 | 2.8 |
| select (40 selects) | 51.2 / 128 | 11.2 / 68 | 3.9 |
| select-nofeel | 52.3 / 126 | 11.8 / 81 | 2.7 |
| pickup (12 pickups, flights + held counts) | 46.0 / 173 | 8.9 / 49 | 7.8 |
| pickup-nofeel (same pickups, feed rows only) | 24.4 / 145 | 7.8 / 46 | 3.1 |
| stats (20 sets) | 19.0 / 149 | 0 / 0 | 2.5 |
| crosshair | 14.5 / 122 | 1.3 / 11 | 2.6 |
| inventory (4 open/close) | 28.0 / 73 | 11.0 / 16 | 2.9 |
| inventory-nofeel | 11.9 / 20 | 7.8 / 12 | 3.0 |

- **select now costs what main costs**: ui-feel no longer draws a cursor under sv3, so select and
  select-nofeel are the same (main's own cursor and name tag are the 68-81 layouts).
- **pickup: +3 layouts, +28 recalcs, +4.7 ms script over 12 pickups** for the flights and the held counts (the
  `uf-wait` class flip and `data-uf-old` write). The feed rows are in both rows.
- **inventory: +4 layouts and about +4 ms style per open/close pair** for the CSS open/close transitions.
- Idle is 0/0: nothing ticks when nothing happens.

### Round 1 (old mock, before main had its own cursor and feed)

`python sandbox/ui-feel/shoot.py [--cost-only | --shots-only] [--reps N]`

Each scenario drives ~120 frames of input on a fresh page, plus 30 frames of tail. It runs once to warm up
and is then measured with Chrome's `Performance.getMetrics` (main-thread `RecalcStyle`/`Layout`/`Script`
time and counts) and a `longtask` PerformanceObserver. The value is the median of 3 fresh pages. The
`*-nofeel` rows drive the **same input through the same real survival UI without ui-feel**, so the
difference is what the feel layer costs. The `naive-*` rows are the patterns this layer avoids: width
transitions, toasts inserted into the DOM with `top`, and reflow-restarted keyframes.

Median of 3. Each run is ~150 frames (120 driven plus 30 tail). Headless Chromium 1243, `--use-angle=swiftshader`.
Raw data: `sandbox/ui-feel/shots/report.json`.

Each cell is *first prototype -> current*. The first prototype's numbers are from the commit that added this
doc (70cd56d).

| Scenario (input over 120 frames) | style ms / recalcs | layout ms / layouts | script ms | long tasks |
|---|---|---|---|---|
| idle | 0 / 0 -> **0 / 0** | 0 / 0 -> **0 / 0** | 3.98 -> 3.32 | 0 |
| select: 40 hotbar selects | 33.8 / 132 -> **32.2 / 135** | 0.18 / 2 -> **0 / 0** | 12.3 -> 10.4 | 2* |
| select-nofeel | 7.6 / 40 -> 6.9 / 40 | 0 / 0 -> 0 / 0 | 2.9 -> 2.8 | 0 |
| pickup: 12 pickups, 21 flying icons, toasts | 47.0 / 150 -> **39.0 / 151** | 6.6 / 31 -> **4.5 / 24** | 8.5 -> 7.4 | 5* |
| pickup-nofeel | 0.8 / 11 -> 0.8 / 11 | 1.6 / 11 -> 1.4 / 11 | 3.5 -> 2.7 | 0 |
| toast: 30 toasts, merges | 19.0 / 133 -> **16.4 / 130** | 3.4 / 23 -> **2.7 / 16** | 3.7 -> 3.1 | 1* |
| stats: 20 damage/heal sets | 23.7 / 150 -> **21.7 / 150** | 0 / 0 -> **0 / 0** | 3.0 -> 3.0 | 1* |
| crosshair: charge every frame, 2 hits, 6 hover flips | 13.4 / 119 -> **11.9 / 123** | 1.7 / 16 -> **1.5 / 14** | 3.3 -> 2.7 | 1* |
| inventory: 4 open/close | 38.1 / 72 -> **35.5 / 85** | 8.7 / 16 -> **8.7 / 16** | 3.6 -> 3.1 | 4* |
| inventory-nofeel | 17.4 / 20 -> 14.4 / 20 | 8.5 / 12 -> 7.1 / 12 | 3.3 -> 2.7 | 0 |
| naive-select (reflow-restart pop) | 27.5 / 189 -> 20.9 / 184 | 0 / 0 -> 0 / 0 | 4.0 -> 3.2 | 1 |
| naive-toast (DOM insert + `top`) | 12.1 / 116 -> 10.9 / 117 | **9.5 / 116 -> 8.4 / 117** | 3.5 -> 2.9 | 0 |
| naive-stats (width transitions) | 7.6 / 110 -> 7.3 / 112 | **8.0 / 105 -> 7.6 / 109** | 3.7 -> 3.2 | 1 |

\* Long tasks also appear in `idle`/`nofeel` runs on other repetitions. The machine is shared with other
headless jobs, so long-task counts and frame times (not shown) are noise here. Unchanged rows (`*-nofeel`,
`naive-*`) also came out 5-20% faster in ms on this second pass, from machine load. Compare ms *relative to
the nofeel row*, and trust the counts most.

What changed in this pass, and what it bought:

- **Layout counts on the animation path went down: select 2 -> 0, pickup 31 -> 24, toast 23 -> 16, crosshair
  16 -> 14.** The cause is rule 1b. Every animated node now carries a static 2D transform, so starting or
  ending a WAAPI transform no longer changes its containing block. The first attempt simply dropped the
  blanket `will-change`, and that *raised* select to 64 layouts. The static transform is what made removing
  it free.
- **About 45 permanent compositor layers removed.** Before, there were `will-change: transform` hints on 16
  hotbar art/count nodes, 13 overlay children, 6 toast rows and 9 bar layers. Now only the cursor keeps one.
  This saves GPU memory and layer-tree work on every frame, including idle ones. The headless metrics do
  not show it.
- **Main-thread-only animations replaced:** the count pop no longer animates `color`, the toast merge
  flash animates an overlay's `opacity` instead of `filter`, and the craft flash animates a `::after`
  overlay's `opacity` instead of `box-shadow`. A select now runs 2 WAAPI animations instead of 3 (the old icon's
  dip is gone). Pickup style relative to nofeel: +46.1 ms -> +38.2 ms (-17%). Toast: 30 toasts, 7 fewer layouts.
- **Inventory: +13 style recalcs, the same layout.** This is the price of the top-layer toast stack. The
  attribute observer sees `open`, and `hidePopover()`/`showPopover()` restyles the stack once per open.
  It is about 0.4 ms per open/close pair.

Read the rest as before:

- **Layout: none on the animation path.** Stat bars and select cause 0 layouts. Width transitions cause 109.
  The remaining toast/pickup layouts are real text changes (row label, count, fly `+N` label), each about
  0.15 ms and contained to the element.
- **Cost moves to style recalcs while something animates: about 0.2-0.3 ms per animated frame** in this
  headless/SwiftShader build, where WAAPI transform/opacity still ticks style on the main thread. On a GPU
  Chrome they run on the compositor. When nothing animates, the cost is zero (idle row).
- **The stat bar trades layout for style.** Its style time is higher than the naive width bar's, so the
  totals are similar *on this headless build*. The scaleX version wins where the transform is composited,
  and its cost does not grow with the document.

Headless-on-shared-CPU frame times (avg and worst rAF delta) and long-task counts are too noisy here to rank
anything. They swing by 100s of ms between identical runs, including the `idle` and `*-nofeel` rows. The
style, layout and script counts are stable from run to run, and the times drift only with machine load. The conclusions
rest on the counts first.

## Key frames (`sandbox/ui-feel/shots/`)

PNGs are gitignored (repo `.gitignore` has `*.png`); run `shoot.py` to regenerate them. Each one is frozen with `document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms })` in the
same task as the action. One `await` comes first, because the feel layer reacts in a MutationObserver
microtask. This pauses WAAPI animations, CSS transitions and CSS animations alike.

| File | What it shows |
|---|---|
| `01-hud.png` | The resting HUD: survival-ui's own cursor, the pickup feed bottom-left, stats bottom-right, reticle |
| `02-select-90ms.png`, `03-select-150ms.png` | Selection under sv3: survival-ui's cursor and name tag only (ui-feel's cursor is off) |
| `04-pickup-150ms.png` | Barrel loot (4 icons, fanned 46 px apart, alternate ones raised) popping out of the reticle |
| `05-pickup-420ms.png` | The same loot mid-curve; the target slots still show their old counts (e.g. 12 -> 15 shown as 12) |
| `06-pickup-landing.png` | Overflow wood landing: count released, survival-ui's bump, gold ring |
| `07-toast-stack.png`, `08-toast-merge-110ms.png` | `?toasts=1`: mixed-kind stack with accent stripes, and a merge pop (transform only) |
| `09-...` to `12-...` | Stat bars (damage trail, heal ghost, low pulse) |
| `13-inv-open-70ms.png`, `14-inv-open.png`, `17-inv-close-60ms.png` | The inventory transition in, at rest and out |
| `15-recipe-pressed.png`, `16-craft-140ms.png` | Recipe press state, then the craft button: the recipe row flashes |
| `24-inv-craft-toast-rest.png` | `?toasts=1`: the craft toast at rest, top centre above the open inventory |
| `25-inv-toasts-{1280x720,1024x600,800x600}.png` | `?toasts=1`, three toasts fired with the bag open: the stack sits in the gap above the panel (1 row), never on its content |
| `26-fullscreen-toasts.png` | `?toasts=1` after `requestFullscreen()` on `<html>`: toasts still on top (`elementFromPoint` hits the toast) |
| `18-slot-pressed.png` | Hotbar slot 6 held down |
| `19-crosshair-states.png` | Idle, hover, charge 40%, charge full, hit, catch and deny (3x zoom) |
| `20-reduced-motion-150ms.png` | `reduced_motion='reduce'`: nothing in flight |
| `21-phone-pickup-300ms.png`, `23-phone-inv-craft.png` | 390x844 |
| `22-guest-generic-590ms.png` | Loot the bag does not show yet (fish, wood) heading to the hotbar's top centre, with the stronger halo and min scale .6 |

`shoot.py` also prints `countHeldUntilLanding` (painted vs shown count of a slot mid-flight), `toastPlacement`
(mode, rows, overlap with the panel frame and with its content per viewport) and `fullscreen`.

## Decisions and alternatives considered

- **A cursor overlay rather than animating each slot's border.** One composited layer moves, and slots never
  restyle. survival-ui's `.sv-sel` background stays as the in-slot highlight. The feel CSS only softens its
  inset ring when the cursor exists (`.uf-has-cursor`). The overlay cannot go *inside* `.tools`, because
  `ensureTools()` rebuilds when `childElementCount !== HB`.
- **MutationObserver rather than callbacks in survival-ui.** This gives zero edits to the render path and
  survives hot reloads. The cost is one observer callback per paint batch, which shows up in the
  `select`/`pickup` script time above and is tiny. The alternative, a call from `paintHotbar` when
  `_svSel` flips, is equally valid if someone prefers explicit hooks.
- **CSS `@starting-style` for the dialog rather than WAAPI with a delayed `close()`.** Delaying `close()`
  would keep `dialog[open]` true during the fade. `uiBlocked()` would then refuse `requestLock()` in
  `onResume`, and the player would have to click twice. With `allow-discrete` the attribute goes away
  instantly and only the pixels linger.
- **The stat bar re-targets from eased progress, not `getComputedStyle`.** Rapid hits stay continuous
  without a style flush per hit.
- **No `@property`-registered custom properties for the charge ring.** A conic-gradient driven by an
  animated custom property repaints the same way, but needs a registration and is harder to freeze in
  tests. `stroke-dashoffset` on `pathLength=100` is simpler.
- **A top-layer popover for the (standalone) toast stack rather than a high z-index.** No z-index beats a
  modal dialog's `::backdrop` or a fullscreen element. `popover="manual"` puts the stack in the top layer,
  which stacks in show order, so the feel layer re-shows it (`hidePopover(); showPopover()`) when a
  document-level observer sees any `<dialog>` gain `open`, and on `fullscreenchange` (round 1 only re-raised
  on `#inventory`, so Settings > Enter fullscreen put `<html>` above every toast). This is one attribute
  observer and two calls per dialog open. It changes no `dialog[open]` check,
  because the stack is a `<div>`, not a dialog. Without popover support (Safari before 17, Firefox before
  125), the stack falls back to `z-index: 5` under the backdrop. The hotbar cursor and fly layer stay below
  the backdrop on purpose: they belong to the hotbar, which is dimmed too, and the dialog has its own hotbar
  row with its own selection.
- **Phone: toasts at the top, stats on the hotbar.** At 390 px the old bottom-right stack covered a third of
  the deck, and the stat panel was a large box in the top left. Top centre is empty while playing,
  because HUD_CSS hides the header. A stat strip sized to the hotbar box reads as part of it, as in
  Minecraft-style hotbars.
- **In the game, the pickup feed keeps the text; ui-feel keeps the motion.** Main routes every `notice()` and
  every loot row into `pickup-feed.js` (bottom-left, with icons and merging). ui-feel's toasts would be a
  second loot list in another corner, so ADOPT passes `toasts:false` and the feed, its tests and
  `raftDebug.state.feed` are untouched. Stats, when they exist, go bottom-right (the feed owns bottom-left).
- **Hold the count rather than delay survival-ui's paint.** Delaying the Bag paint would need a survival-ui
  edit and would desync the inventory panel. Hiding the painted text under a `::after` with the old value is
  pure CSS on the existing markup, and it releases on landing *or* on cancel, so a slot can never stay stale.

## In the real game (`realgame.py`)

`python sandbox/ui-feel/realgame.py [--hook-tries N] [--freeze MS] [--keep | --patch-only]` copies `dist/` to a
temp folder and applies `docs/tech/ui-feel-ADOPT.md` by **parsing its tagged blocks** (`<!-- copy/apply/append -->`),
each `-`/context text exactly once, so the doc cannot drift from the check. It then boots Solo headless at
1280x720 and writes `shots/rg-*.png`:

| File | What it shows |
|---|---|
| `rg-00-charge.png` | A hook throw being charged (pointer lock is refused headless: drag/aim fallback, where the game hides `#crosshair` by design) |
| `rg-01-loot-fly-330ms.png`, `rg-02-flight-600ms.png` | Real barrel loot through `applyAction -> emit -> effect -> feelEffect -> uiFeel.pickup`; the empty target slots stay blank while the icons fly |
| `rg-03-landed.png` | Flights finished (`finish()`, so `onfinish` runs): counts released, main's bump |
| `rg-04-inventory-craft-1280.png` | Rope crafted through the real recipe row + craft button; the feed's note bottom-left |
| `rg-05-inventory-1024.png` | The same open bag at 1024x600: no ui-feel node over it (no popover in the game) |
| `rg-06-fullscreen-fly-420ms.png` | After Pause > Graphics > Enter fullscreen: another barrel's icons in flight |

Last run (JSON): ADOPT 13 blocks applied; `attached` = reticle built, own cursor off, main cursor present, no
toast popover; `heldWhileFlying` = 3 fresh slots hidden until landing; `feedAtFreeze` = `+3 Palm Leaf`,
`+2 Scrap`, `+2 Plank` (the pickup feed runs as before); `craft` = `crafted('rope')` returned true with 2
animations on the row; `buildMarker` = partner `by:guest` 0 hit animations, no owner 0, mine `by:host` 1;
`guardEffect` = a throwing `pickup` logs, returns false, and the feed still gets its row, 0 page errors;
`guardHostileCraft` (`'x"]\n[y'`, `toString`) 0 page errors; `guardFrame` = a throwing per-frame `hover` sets
`feelFailed`, the game keeps running, 0 page errors; `fullscreen` true with 3 icons flying. The only console
errors are two `/favicon.ico` 404s, which an unpatched boot shows too.

The hook catch is tried first; at the few fps SwiftShader manages here it has not landed, so the script falls
back to a scratch-only `window.__qaAction` sending the exact `{kind:'collect'}` a catch sends. It freezes
animations and pins `performance.now` in the same task as the pickup (wall-clock waits are meaningless at
this frame rate), and restores both before crafting.

## Known weaknesses

- **The physical hook catch is not landed headless.** See above. The loot path from the `collect` action
  onward is exercised in the real game. The catch-to-collect step (`updateHook` -> `action`) is unchanged
  game code, and `check_hook.py` covers it on a GPU Chrome.
- **In the drag/aim fallback (no pointer lock), loot still flies from the screen centre**, while the player
  aimed with the mouse. `pickup(items, {x, y})` accepts an origin. game.js could pass the last `mouse`
  position when `lockFallback` is set. ADOPT leaves this out to keep 2e small.
- **The guest fallback is a generic target, not the right slot.** When the effect arrives before the
  guest's predicted bag shows the gain, icons fly to the hotbar's top centre and shrink in. The correct slot
  bumps a moment later, when survival-ui paints the host snapshot. That is honest but less precise than a
  host pickup. A backpack-bound pickup looks the same, by design.
- **Fly icons stay under the inventory backdrop.** A pickup while the bag is open (rare: a net) shows dimmed.
- **The standalone toast stack needs popover support** (Chrome 114+, Safari 17+, Firefox 125+) to sit above
  modals and fullscreen; older browsers keep it at `z-index: 5`. With a tall modal (1024x600, 800x600) the only
  room is a ~20 px band above the panel, so one row overlaps the panel's padding (not its content). Not used
  in the game.
- **No live two-machine run.** The partner-build rule is tested by injecting `{kind:'build', by}` effects
  into the real `effect()`; a two-browser `check_multiplayer.py` run on a GPU machine is still owed.
- **The main-thread style tick per animated frame.** In this headless/SwiftShader build, each animated frame
  still costs about 0.2 ms of style recalc. It is not profiled on a real GPU, where transform/opacity WAAPI
  runs on the compositor.
- **Stat bars have nothing to drive them.** The game has no health, hunger or thirst yet (ADOPT section 4).
- **The inventory transitions need Chrome 117+ or Safari 17.4+.** Firefox has no `overlay` property, so
  there it closes instantly (open still animates where `@starting-style` exists). That is graceful, not
  broken.
- **At 390x844 the sv3 panel scrolls and its hotbar row sits at the bottom edge** (`23-phone-inv-craft.png`).
  That is survival-ui's own narrow layout (ui-feel changes no dialog size); the panel scrolls to it.
