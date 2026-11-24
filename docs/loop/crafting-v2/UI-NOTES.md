# Crafting UI v2: notes

## The flicker report

"When I try to craft something, it just keeps flickering back and forth really fast, and there's like something on the right hand side."

### Root cause

1. A live engine swap (dist/live.js) mounts the new engine before it disposes the old one.
2. The new item-tooltips instance saw the old `#item-tooltips-style` and did not add its own. The old instance's `dispose()` then found no `.it-tip` in the page (the new card is only appended on its first show) and deleted that shared sheet.
3. The new card was now unstyled, so it was a normal block. It was appended inside the bag dialog, which was `display:flex;justify-content:center`. That made it a flex sibling of the panel, so the panel moved sideways (x 238 to 0 at 1536 wide), the chip left the cursor, the card hid, the panel moved back, the card showed again, about once per frame.
4. The pale column on the right was that unstyled card taking flex width, plus survival-ui's own `.sv-tip`, whose hide rule had lived in the deleted sheet.
5. A separate bug: at 1600x950 and up, graphics.css zooms the bag by `--ui-scale` 1.2, but the card and the held stack were positioned in unzoomed px, so the card landed off screen (x=1904 at 1920 wide) and the held stack trailed the pointer.

### Fix

- item-tooltips.js: every instance owns its own `<style class="item-tooltips-style" data-owner=...>` and removes only that one on dispose. The card carries `position:fixed;left:0;top:0;pointer-events:none` as inline style, so it never joins a layout even with no sheet at all.
- survival-ui.js: the bag dialog is a plain block (`display:block`), and `.sv-wrap` places the panels with absolute positioning, so nothing appended to the dialog can move them. The rule that hides survival-ui's fallback `.sv-tip` now lives in survival-ui's own sheet: `:root:has(style.item-tooltips-style) #inventory .sv-tip{display:none!important}`.
- Zoom: the card and the held stack read `currentCSSZoom` (the card on each show, the bag on open and resize, never per frame). They measure in viewport px and divide their translate by the zoom.

### Repro numbers (tools/repro_craft_flicker.mjs)

The test matrix ran:
- Viewports: 1536x864, 1920x1080, 1229x691 and 1536x864 at dpr 1.25 (plus 1536x864 with UI_SCALE=1.2), each with and without LIVE_SWAP.
- Targets: chip, plus, row and chip+feed.
- 40 cases per build.

| Case | Before: panel x per rAF / inside mutations / tooltip toggles per frame | After |
|---|---|---|
| LIVE_SWAP 1536x864 chip | FLICKER: 238 / {0:89, 238:291} / 3.96 | STABLE: 14 / {14:31} / 0.02 |
| LIVE_SWAP 1536x864 plus | FLICKER: 238 / {38:89, 238:292} / 3.96 | STABLE: 14 / {14:32} / 0.02 |
| LIVE_SWAP 1536x864 row | FLICKER: 238/63/0 / {0:3, 63:32, 238:8} / 0.11, tooltip in flow | STABLE: 14 / {14:27} / 0.02 |
| LIVE_SWAP 1536x864 chip+feed | FLICKER: 238 / {0:90, 238:323} / 4.00 | STABLE: 14 / {14:60} / 0.02 |
| LIVE_SWAP 1920x1080 chip | FLICKER: 324 / {0:90, 324:296} / 4.00 | STABLE: 17 / {17:33} / 0.02 |
| LIVE_SWAP 1920x1080 plus, row, chip+feed | FLICKER: about 3.96 toggles/frame each | STABLE: 0.02 each |
| LIVE_SWAP 1229x691 chip | FLICKER: 85/0, tooltip in flow | STABLE: 10 / {10:40} / 0.03 |
| LIVE_SWAP 1229x691 plus, row, chip+feed | FLICKER (all) | STABLE (all) |
| LIVE_SWAP 1536x864 dpr 1.25, all 4 targets | FLICKER (all, up to 4.00 toggles/frame) | STABLE (all, 0.02) |
| LIVE_SWAP UI_SCALE=1.2, all 4 targets | FLICKER (all, up to 4.00 toggles/frame) | STABLE (all, 0.02) |
| No swap, all 20 cases | STABLE | STABLE |

- **Totals**: before, 20 of 20 swap cases FLICKER (exit 1) and 20 of 20 no-swap cases are STABLE. After, all 40 cases are STABLE (exit 0).
- **Off-screen card**: at 1920x1080 before the swap, the card sat at x=1904 with width 324, so it was off screen. After, it sits at x=719, on screen in every case.
- **Load sensitivity**: on a heavily loaded machine, one base run with the swap came out STABLE, so the repro's detection depends on load. Every base run on a quiet machine was FLICKER.

## Layout (Raft arrangement)

- **Crafting** is anchored on the top-left edge and is as tall as its content (up to 780px, then the list scrolls), so a short tab leaves no empty block. It has:
  - a column of 8 icon tabs, in Raft's order: food and water, other, tools, weapons, equipment, resources, navigation, decorations. The tabs come from `CRAFT_TABS` and `craftTabOf` in items.js. Each name is the tab's `title` and its aria label.
  - the recipe list, as tall as its rows. On a short tab the panel is as tall as the tab column and the list box hugs its rows.
  - the open recipe as its own card beside the list (`.sv-detail`, absolutely placed at the panel's right edge): icon, name, description, pin, ingredient tiles showing have/need (red when short) with the + sub-craft, and the Craft button. Clicking a recipe selects it, and the card stays open; hovering does not open it. The card's height follows its ingredients, and its `max-height` (`--dh`) ends it above the backpack, so it never covers the bag. There is no empty column under it.
- **Backpack**: the panel sits on the bottom edge, centred on the screen unless that would put it over the tabs and list panel, then right beside that panel. Its slot size no longer grows to fill the width, so it centres at 1536x864 and 1920x1080; at 1229x691 the centred spot (x 299) would overlap the panel (right edge 298 plus the gap), so it sits beside it at x 308. The panel holds, from top to bottom:
  - the 18-slot grid
  - Raft's **5 equipment slots**
  - the hotbar row, which is the bottom-centre hotbar of the bag screen
- **Right side**: kept clear of panels. The pickup feed docks out of flow to the right of the bag (its width fits the space left there), or above the bag's right end on windows narrower than 1150px, so feed rows never resize anything.
- **Less text**: the "Crafting" and "Backpack" headings, the "Requires" label and the controls hint are visually hidden, but screen readers still get them. A refusal ("Can't place that there", "Only gear goes there") shows briefly above the bag.
- **Tooltips**: crafting tooltips (`craft-book.js craftTip`) stay in the crafting area and never cover the screen centre:
  1. With a recipe open: right under its card, in the card's column (above the bag).
  2. With none open: in that column, level with the hovered row.
  3. No room under the card (1229x691): ingredient tiles put the card over the recipe list, rows put it over the card column. Any spot that would cover the screen's centre point is skipped.
  Other tooltips (bag slots, equipment) still sit beside their element (`anchorTip`).
- **Sizing**: everything comes from the dialog size through container units (`--pw` panel width, `--ch` tallest list, `--bh` bag height, `--dh` tallest recipe card), so layout is CSS only, with no per-frame reads or writes. Tooltip rects are read on show only.
  - Slot size: `clamp(36px, ..., 56px)`.
  - Below 1230px wide, a tighter crafting column.
  - Below 1000px wide or 520px tall, one scrolling column (the recipe card goes back into the flow under the list).
- **Unchanged behaviour**: + sub-craft, pin, hold-to-craft, drag and drop, click and right-click moves, keyboard (roving tabs, arrow keys over slots and recipes), research gating, the co-op guest bag and no text selection.

## Equipment slots

The review found that the equipment slots were read-only mirrors: gear showed twice (grid and equipment row) and dragging into a slot did nothing.

**Choice: the equipment row is a view over the bag, not new storage.** The Bag snapshot must be exactly 28 slots (`inventory-state.js` throws otherwise), co-op sends that snapshot and moves as `moveSlot` actions, and the save stores it. A real equipment store would change the save shape, the co-op protocol (an older peer would reject the snapshot) and diving-gear's "works while carried" rule, in files other agents are editing. So:

- **What is worn**: the first 5 gear stacks (`GEAR_IDS`) in the backpack grid (bag index 10 and up), packed from the left (`craft-book.js equipView`). They show in the equipment row and not in the grid, so every item shows exactly once. Gear on the hotbar stays on the hotbar.
- **The grid slot** that holds worn gear is drawn as a darker, empty "taken" slot (`data-worn`). It shows no icon and no tooltip (item-tooltips skips `data-worn`).
- **Wear**: drag or click-place gear onto an equipment slot (`equipTarget`):
  - From the hotbar, it moves to the first free backpack slot, so it shows in the row.
  - Onto a worn slot, it swaps with that gear.
  - Anything that is not gear is refused ("Only gear goes there").
  - With a full backpack, the move is refused ("Backpack full").
- **Unequip**: drag an equipment slot to the hotbar (a normal move or swap).
- **Dropping on a "taken" slot** (`gridTarget`): the worn gear first moves to the first free backpack slot, then the stack lands where it was dropped. These are two ordinary `onMove` calls, so the guest bag predicts both and the host applies both in order. With no free slot it is a plain swap.
- **Gear still counts as carried**: diving-gear-core's `gearMask(count)` reads `bag.count(kind)`, and the items never leave the bag, so swim, oxygen and fog bonuses are unchanged.
- **Compatibility**: old saves (no gear, or gear anywhere) load unchanged, because the row is computed from the slots. No new save fields and no protocol change.
- **The equipment slots are real `.sv-slot` buttons** (`data-equip`, plus `data-slot` = the bag index while filled). Click-pick, right-click, drag and drop, the held stack, deny shake and the item-tooltips card (with durability) all work on them.

## Review round 3: overlapping live checks

**Problem.** In dist/live.js, `check()` awaited `fetchManifest()` before `swap()` set `state.updating`. Overlapping checks could therefore both pass the busy test and both mount a new engine: the poll, a `visibilitychange` `schedule(0)` or a manual `raftLive.check()`. The first new engine was never disposed, so its item-tooltips sheet and listeners leaked, and two or three cards could show at once.

**Fix:**
- live.js keeps one in-flight promise: `check()` returns the running check to any overlapping caller, so at most one check and one swap run at a time.
- `boot()` sets `state.booting`, and a check during boot answers `busy`.
- item-tooltips.js keeps its live instance on `window.__littleRaftItemTooltips`, like survival-ui's `INST_KEY`. Installing a new instance disposes the previous one, so even a missed dispose leaves one sheet and one card. The old engine's late `dispose()` removes only its own sheet.

**Test.** tools/repro_craft_flicker.mjs now starts LIVE_SWAP with two overlapping `raftLive.check()` calls. Each case counts `style.item-tooltips-style` and `.it-tip` elements. Any count above one is reported as `duplicate-tooltips`, which makes the case a FLICKER. tests/crafting-v3.test.mjs covers the guard and the registry with a fake DOM.

**Repro numbers** (VIEWPORTS=1536x864@1,1920x1080@1,1229x691@1, TARGETS=chip,plus,row,chip+feed, plus UI_SCALE=1.2 at 1536x864):

| Run | Before (old live.js and item-tooltips.js) | After |
|---|---|---|
| LIVE_SWAP, 1536x864, 4 targets | FLICKER `duplicate-tooltips`: 2 styles and 2 cards each | STABLE: 1 style and 1 card; panel x 14; 0.02 toggles/frame |
| LIVE_SWAP, 1920x1080, chip, plus and row | FLICKER `duplicate-tooltips`: 2/2 each | STABLE: 1/1; panel x 17; 0.02 |
| LIVE_SWAP, 1920x1080 chip+feed and 1229x691 (all 4) | not measured: the run hit its 900 s limit | STABLE: 1/1; panel x 17 or 10; 0.02 |
| No swap, all 3 viewports, 12 cases | not rerun | STABLE: 1/1, 0.02 toggles/frame |
| UI_SCALE=1.2, with and without swap, 8 cases | not rerun | STABLE: 1/1, panel x 17, 0.02 |

- **Before:** every swap case that finished (7 of 7) left two sheets and two cards.
- **After:** all 32 cases are STABLE (exit 0), and both overlapping checks return the same `updated` result.

Measured placements after the change (viewport px, from the repro):

| Viewport | Crafting panel | Recipe card | Backpack | Chip card |
|---|---|---|---|---|
| 1536x864 | x 14, w 314 | x 334, h 252 | x 453..1084 (centred on 768) | x 334..604, under the recipe card |
| 1920x1080 (zoom 1.2) | x 17, w 377 | x 401, h 301 | x 581..1338 (centred on 960) | x 401..725 |
| 1229x691 | x 10, w 288 | x 304, h 235 | x 308 (beside the panel: centred would be x 299) | over the list (x 28..298); row cards under the recipe card (y 255..397, bag top 408) |

The screen centre stays clear in every case.

## Data hooks

- craft-book `ITEM_TEXT` is `{...ITEM_TEXT_EXTRA, ...own rows}`, so the craft-book rows win.
- `ITEM_SOURCE` is `{...ITEM_SOURCE_EXTRA, ...own rows}`. items.js exports an empty `ITEM_SOURCE_EXTRA`, so a later items pass can add source hints without touching craft-book.
- `tabOf(id, kind)` maps any recipe to a tab: by recipe id, then by output kind, then the old group, then Other.

## Screenshots

- docs/loop/crafting-v2/crafting-1536x864-chip-hover.png (a chip hovered: the card sits under the recipe card, the backpack is centred)
- docs/loop/crafting-v2/crafting-1920x1080-chip-hover.png (zoom 1.2: the same arrangement, the backpack centred)
- docs/loop/crafting-v2/crafting-1229x691-chip-hover.png (the backpack beside the panel, the chip card over the recipe list)
- docs/loop/crafting-v2/crafting-1920x1080-equipment.png (goggles worn in the equipment row, its grid slot shown as taken, fins moved to the hotbar)
- docs/loop/crafting-v2/crafting-1920x1080-short-tab.png (a short tab: the panel and list are as tall as their content)
- docs/loop/crafting-v2/flicker-before-1536x864-swap.png and flicker-after-1536x864-swap.png (pointer resting on a chip after a live swap; from round 2)
