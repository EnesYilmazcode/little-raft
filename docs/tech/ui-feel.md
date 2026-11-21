# UI feel: a juicy HUD layer that costs (almost) nothing

Goal: make the DOM HUD respond to the player the way good survival games do. The hotbar should bounce,
loot should visibly fly into the bag, damage should leave a trail, and the reticle should react. All of
this must stay off the layout path and respect `prefers-reduced-motion`.

Prototype: `sandbox/ui-feel/` (serve the repo root, open `/sandbox/ui-feel/`).

- `ui-feel.js` is the module, a drop-in copy target for `dist/ui-feel.js`. It has no imports and carries
  its own CSS.
- `mock.js` builds the mock HUD. It runs the **real** `dist/survival-ui.js` and the real `Bag` from
  `dist/inventory-state.js`, under the real `dist/style.css` and `dist/graphics.css`. The world behind it is
  a static frame of the game (`bg.jpg`, captured headless from `dist/`). The palette and cascade are
  therefore the shipped ones, not an imitation.
- `shoot.py` takes key frames frozen mid-animation and measures cost (see below).
- Keys in the sandbox: `1-8` and the wheel select a slot, `E` picks up, `B` picks up a barrel, hold click
  to charge, `F` toggles hover, `X` shows a deny marker, `H`/`J` hurt and heal, `K` drains hunger, `Tab`
  opens the inventory and `M` toggles reduced motion.

Adoption steps are in `docs/tech/ui-feel-ADOPT.md`.

## What it does

| Feature | How | Where it hooks in |
|---|---|---|
| Hotbar select | A single gold cursor in a fixed overlay slides between cached slot positions (`transform` transition, back-ease overshoot) and squashes in the direction of travel. The new icon hops (scale 1.22 and -7 px). | A MutationObserver on `.tools` sees `.sv-sel` move. survival-ui is untouched. |
| Pickup fly | Pooled icons (8) pop out of the reticle, hang for a beat, then accelerate along a quadratic curve into the slot that received the item, with `+N` riding along. On landing the slot icon bumps, the count text pops, and a ring flashes. When no hotbar slot shows the gain (the item went to the backpack, or a guest's predicted bag does not have it yet) the icon flies to a **generic target**, the middle of the hotbar's top edge, and shrinks into the bar. The real slot then bumps through the observer whenever it is painted. | `uiFeel.pickup(items)` from `effect()` on `loot`. The target is the hotbar stack whose count in the live Bag differs from the last observed paint, so it is correct before survival-ui repaints, and it never guesses. |
| Count bumps | Any hotbar or inventory count change outside a fly gets a small pop (up) or dip (down). | The same observers. |
| Toast stack | Desktop: five pooled rows at bottom right, newest at the bottom. Phone (760 px wide or less): three rows dropping from the top centre, newest on top. Older rows slide away and dim to 60%. The stack is a `popover="manual"` in the **top layer**, re-raised when the inventory dialog opens, so a craft toast reads above the panel and its backdrop. A repeat merges into the visible row (`Wood +2` becomes `Wood +6` with a number pop and an opacity glow) and resets its 3.2 s life. Each kind has its own accent stripe: loot is amber, craft gold, build teal, full/warn red. | `uiFeel.toast(text, {kind, icon, amount, key})` |
| Stat bars | The fill and trail are full-width layers scaled with `scaleX`. On **damage** the fill drops in 110 ms, a pale-amber trail holds for 420 ms and then drains over 520 ms, the track flashes, and the icon shakes when the hit is above 12%. On **heal** a green ghost snaps ahead and the fill catches up. At 25% or less the bar pulses (opacity). Re-targeting mid-animation starts from the *visual* value, computed from `getComputedTiming().progress` without reading styles. | `uiFeel.statBar(container, {tone})`, then `.set(v)` |
| Crosshair | Built inside the existing `#crosshair`: ring, dot, an SVG charge arc and four hit ticks. **Hover** grows the ring to 1.32x and turns it gold. **Charge** fills an amber arc (via `stroke-dashoffset`), and at full charge it turns gold, glows and pops. **Hit** variants: `hit` (cream), `gold` (catch or pickup) and `deny` (red ticks with a ring shake). | `crosshair.hover(bool)`, `crosshair.charge(v or null)` and `crosshair.hit(kind)` from `frame()`, `updateHook()` and `effect()` |
| Inventory open/close | Pure CSS. The panel fades in from 0.96 scale and +14 px, the craft column slides in from the left and the bag from the right, and the backdrop fades. On close it fades out over 120 ms. `@starting-style` plus `overlay`/`display` `allow-discrete` keep the dialog in the top layer while it animates out, *after* `open` is already gone, so `dialog[open]` checks in game.js do not change. | None. |
| Craft | The recipe row gets a gold flash (opacity on its `::after`) and its icon pops. The output slot bumps through the observer. | `uiFeel.crafted(recipeId)` |
| Press states | Slots sink 2 px, scale to 0.88, darken to 70% and show a gold inner ring with an inset shadow. They spring back with the back-ease on release. Recipes sink 1 px with an inset shadow, and their icons tilt on hover. `.primary` drops onto its 3 px base. `.secondary`, header buttons, Repair, Copy and Close press too. | None (CSS). |
| Reduced motion | `matchMedia('(prefers-reduced-motion: reduce)')` toggles `html.uf-rm`, and every effect has a no-motion branch. The cursor jumps, nothing flies (the target slot gets a quiet glow instead), the trail fades instead of draining, the inventory only fades, toasts fade in place, and there is no shake and no pulse. `setReducedMotion(true/false/'auto')` lets a settings toggle override the OS setting. | None. |

## Rules that keep it cheap

1. **Only `transform` and `opacity` move.** The one exception is the charge arc's `stroke-dashoffset` on a
   40 px SVG, written while charging. The count pop is transform only. The craft flash and the toast merge
   glow animate the `opacity` of an overlay (`::after` / a pooled `<i>`), not `box-shadow` or `filter`.
1b. **No permanent layers, no layout on animation start.** Only the cursor keeps `will-change: transform`.
   Every other animated node (slot art and counts, fly icons, rings, hit ticks, toast numbers, stat icons,
   recipe art) carries a static 2D identity `transform: translate(0)`. It costs no layer, and it means the
   node is already a containing block, so a WAAPI transform starting or ending does not trigger layout.
   Removing the old `will-change` without this took `select` from 2 to 64 layouts. The animation promotes
   the node to a compositor layer only while it runs.
2. **Layout is read in one place**: the `ResizeObserver` callback on `.tools`, which runs after layout and
   before paint, so the read is already clean. That callback, plus `resize`, caches the 8 slot rects.
   Selection, fly and ring motion all use the cached numbers. The same callback publishes the hotbar box as
   `--uf-hbx/--uf-hbw/--uf-hbt` on `<html>`. The phone stat strip is positioned from those. No action path calls
   `getBoundingClientRect`, `offsetWidth` or `getComputedStyle`.
3. **No reflow tricks to restart animations.** WAAPI `el.animate()` restarts cleanly. The naive version,
   `animation:none; void el.offsetWidth; animation:...`, is the `naive-select` row below.
4. **Pooled nodes.** 8 fly nodes, 4 rings, 6 toast rows and one cursor are created once. A toast reuse
   changes only its text, `data-kind` and, when the kind changed, its icon.
5. **No per-frame DOM writes when nothing changes.** `crosshair.hover()` and `charge()` return early,
   `statBar.set()` ignores an unchanged value, and `effect()` events only happen on actual events.
6. **No changes to survival-ui's render path.** The feel layer reacts through two MutationObservers. They
   fire once per paint batch, in a microtask after survival-ui's writes, and do only class and WAAPI work.
   A broken feel layer cannot break the inventory. In game.js it is also wrapped in `try`.

## Measurements

`python sandbox/ui-feel/shoot.py [--cost-only] [--reps N]`

Each scenario drives ~120 frames of input on a fresh page, plus 30 frames of tail. It runs once to warm up
and is then measured with Chrome's `Performance.getMetrics` (main-thread `RecalcStyle`/`Layout`/`Script`
time and counts) and a `longtask` PerformanceObserver. The value is the median of 3 fresh pages. The
`*-nofeel` rows drive the **same input through the same real survival UI without ui-feel**, so the
difference is what the feel layer costs. The `naive-*` rows are the patterns this layer avoids: width
transitions, toasts inserted into the DOM with `top`, and reflow-restarted keyframes.

Median of 3. Each run is ~150 frames (120 driven plus 30 tail). Headless Chromium 1243, `--use-angle=swiftshader`.
Raw data: `sandbox/ui-feel/shots/report.json`.

| Scenario (input over 120 frames) | style ms / recalcs | layout ms / layouts | script ms | long tasks |
|---|---|---|---|---|
| idle | 0 / 0 | 0 / 0 | 3.98 | 0 |
| select: 40 hotbar selects | 33.8 / 132 | 0.18 / 2 | 12.3 | 1* |
| select-nofeel | 7.6 / 40 | 0 / 0 | 2.9 | 0 |
| pickup: 12 pickups, 21 flying icons, toasts | 47.0 / 150 | 6.6 / 31 | 8.5 | 2* |
| pickup-nofeel | 0.8 / 11 | 1.6 / 11 | 3.5 | 0 |
| toast: 30 toasts, merges | 19.0 / 133 | 3.4 / 23 | 3.7 | 0 |
| stats: 20 damage/heal sets | 23.7 / 150 | **0 / 0** | 3.0 | 1* |
| crosshair: charge every frame, 2 hits, 6 hover flips | 13.4 / 119 | 1.7 / 16 | 3.3 | 1* |
| inventory: 4 open/close | 38.1 / 72 | 8.7 / 16 | 3.6 | 6* |
| inventory-nofeel | 17.4 / 20 | 8.5 / 12 | 3.3 | 1 |
| naive-select (reflow-restart pop) | 27.5 / 189 | 0 / 0 | 4.0 | 1 |
| naive-toast (DOM insert + `top`) | 12.1 / 116 | **9.5 / 116** | 3.5 | 0 |
| naive-stats (width transitions) | 7.6 / 110 | **8.0 / 105** | 3.7 | 0 |

\* Long tasks also appear in `idle`/`nofeel` runs on other repetitions. The machine is shared with other
headless jobs, so long-task counts and frame times (not shown; avg rAF delta 21-44 ms, including idle) are
noise here.

Read this as:

- **Layout: none on the animation path.** Stat bars cause 0 layouts against 105 for width transitions. The
  toast stack causes 23 layouts for 30 toasts, against 116 for the naive version. The remaining ones are
  real text changes: the row label, the count, and the fly `+N` label. Each is about 0.15 ms and contained
  to the element. The select path causes 2 layouts in total: the ResizeObserver at start-up.
- **Cost moves to style recalcs while something is animating: about 0.2-0.3 ms per animated frame.** For
  example, select is +26 ms style over ~45 animated frames, and pickup is +46 ms over ~140 frames. In this
  headless/SwiftShader build, WAAPI transform/opacity animations still tick style on the main thread every
  frame. On a GPU Chrome, most of them (cursor, fly, toasts, bars) run on the compositor and this drops. The
  `color`, `box-shadow` and `filter` one-shots (count pop, craft flash, toast merge flash) always tick on the
  main thread, but they last 260-520 ms. When nothing animates, the cost is zero: compare idle against the
  quiet tails.
- **Per event:** a select costs about 0.65 ms style plus 0.24 ms script, the latter including the observer
  callback. A pickup with flies and toasts costs about 3.9 ms style plus 0.4 ms script, spread over ~45
  frames. A craft-free inventory open/close pair costs +5 ms style over survival-ui alone (the
  `@starting-style` transitions).
- **The stat bar honestly trades layout for style.** Its style time (23.7 ms) is higher than the naive width
  bar (7.6 ms + 8.0 ms layout), so the totals are similar *on this headless build*. The scaleX version
  wins on real GPUs, where the transform is composited. It also scales: layout cost grows with the
  document, while a composited transform does not.
- The naive reflow-restart (`naive-select`) causes no extra *layout* (style-only dirtiness), but it forces
  57 more style recalcs than the WAAPI version for the same 40 pops.

Headless-on-shared-CPU frame times (avg and worst rAF delta) and long-task counts are too noisy here to rank
anything. They swing by 100s of ms between identical runs, including the `idle` and `*-nofeel` rows. The
style, layout and script times and counts are stable from run to run, and those are what the conclusions
rest on.

## Key frames (`sandbox/ui-feel/shots/`)

PNGs are gitignored (repo `.gitignore` has `*.png`); run `shoot.py` to regenerate them. Each one is frozen with `document.getAnimations().forEach(a => { a.pause(); a.currentTime = ms })` in the
same task as the action. One `await` comes first, because the feel layer reacts in a MutationObserver
microtask. This pauses WAAPI animations, CSS transitions and CSS animations alike.

| File | What it shows |
|---|---|
| `01-hud.png` | The resting HUD: stat panel, hotbar with cursor, two toasts, reticle |
| `02-select-90ms.png`, `03-select-150ms.png` | The cursor overshooting into slot 5, then settling on 3. The hammer is mid-hop |
| `04-pickup-150ms.png` | Barrel loot (4 icons with `+3`/`+2`) popping out of the reticle as the toasts slide in |
| `05-pickup-420ms.png` | The same loot mid-curve toward slots 2/3/4/7 |
| `06-pickup-landing.png` | Overflow wood landing in slot 8: ring, icon bump, count pop |
| `07-toast-stack.png`, `08-toast-merge-110ms.png` | Mixed-kind stack with accent stripes, and a merge pop |
| `09-damage-300ms.png`, `10-damage-700ms.png` | The health trail holding, then draining |
| `11-heal-380ms.png` | The water heal ghost ahead of the fill |
| `12-low-pulse.png` | Hunger at 18%, pulsing |
| `13-inv-open-70ms.png`, `14-inv-open.png`, `17-inv-close-60ms.png` | The inventory transition in, at rest and out |
| `15-recipe-pressed.png`, `16-craft-140ms.png` | Recipe press state and craft flash (the toast is still fading in at 140 ms) |
| `24-inv-craft-toast-rest.png` | The "Crafted Rope" toast at rest, above the inventory backdrop (top layer) |
| `18-slot-pressed.png` | Hotbar slot 6 held down: sunk, darkened, gold inner ring |
| `19-crosshair-states.png` | Idle, hover, charge 40%, charge full, hit, catch and deny (3x zoom) |
| `20-reduced-motion-150ms.png` | The same pickup, select and damage with `reduced_motion='reduce'`: nothing in flight, the cursor already moved, the trail fading |
| `21-phone-pickup-300ms.png` | 390x844: toasts drop from the top centre (3 max, equal width), stats become one strip sitting on the hotbar |
| `22-guest-generic-590ms.png` | Effect for loot the bag does not show yet (fish, wood): both icons head to the hotbar's top-centre and shrink in, not to a guessed slot |
| `23-phone-inv-craft.png` | 390x844 with the inventory open after a craft: the toasts sit above the panel's backdrop |

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
- **A top-layer popover for the toast stack rather than a high z-index.** No z-index beats a modal dialog's
  `::backdrop`. `popover="manual"` puts the stack in the top layer, which stacks in show order, so the
  feel layer re-shows it (`hidePopover(); showPopover()`) when the observer sees `#inventory` gain `open`.
  This is one attribute observer and two calls per inventory open. It changes no `dialog[open]` check,
  because the stack is a `<div>`, not a dialog. Without popover support (Safari before 17, Firefox before
  125), the stack falls back to `z-index: 5` under the backdrop. The hotbar cursor and fly layer stay below
  the backdrop on purpose: they belong to the hotbar, which is dimmed too, and the dialog has its own hotbar
  row with its own selection.
- **Phone: toasts at the top, stats on the hotbar.** At 390 px the old bottom-right stack covered a third of
  the deck, and the stat panel was a large box in the top left. Top centre is empty while playing,
  because HUD_CSS hides the header. A stat strip sized to the hotbar box reads as part of it, as in
  Minecraft-style hotbars.
- **Toasts at the bottom right, stats at the bottom left (desktop).** The middle of the screen belongs to the reticle
  and to the game's own `#contextPrompt` (`E Pick up`, hints), which stays as it is. While playing,
  `#toast` is already hidden by HUD_CSS, and game.js routes `toast()` to `notice()`. With ui-feel adopted,
  loot, craft, build and full events go to the stack and hints stay under the reticle.

## Known weaknesses

- **The loot fly is not exercised in the real game by the harness.** I applied the ADOPT steps to a scratch
  copy of `dist/` and drove it headless. It booted with the feel layer attached: the new reticle, the hotbar
  cursor, the inventory transitions, and a craft that showed the recipe flash plus the "Crafted Rope"
  toast, with no console errors besides a pre-existing 404. Scripted hook throws did not land a catch
  headless, so the `loot` path, `effect()` with `e.loot`, was only verified in the sandbox with the real
  Bag and survival-ui.
- **Guest pickups can target the wrong slot.** A guest's predicted bag may not contain the loot yet when the
  host's effect arrives. The fly then goes to the first stack of that kind, or to the hotbar end for a new
  kind. It is cosmetic.
- **Toasts and the cursor sit under the inventory's `::backdrop`.** They are not in the top layer, so a
  craft toast shows dimmed behind the open panel. The recipe flash and slot bump carry the craft feedback
  there instead. A `popover="manual"` stack would fix it, at the cost of more code.
- **The main-thread style tick per animated frame**, described above. It is measured only on SwiftShader
  headless, and is not profiled on a real GPU.
- **Stat bars have nothing to drive them.** The game has no health, hunger or thirst yet, so the bars are a
  ready component. The hook condition can use them today; see ADOPT 3j.
- **The inventory transitions need Chrome 117+ or Safari 17.4+.** Firefox has no `overlay` property, so
  there it closes instantly (open still animates where `@starting-style` exists). That is graceful, not
  broken.
- **The `:active` press state is subtle.** Scale 0.9 plus a darken on a 58 px slot is easy to miss in a
  still frame (`18-slot-pressed.png`). That is deliberate, but it is a matter of taste.
- **The phone layout is tolerable, not designed.** At 390 px the stats panel in the top left is large
  relative to the screen. The game's own `.inventory` plate sits there too when it is not hidden, though
  HUD_CSS hides it while playing.
