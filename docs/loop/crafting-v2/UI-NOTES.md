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

- **Crafting** is anchored on the left edge and runs full height (up to 780px). It has three columns:
  - a column of 8 icon tabs, in Raft's order: food and water, other, tools, weapons, equipment, resources, navigation, decorations. The tabs come from `CRAFT_TABS` and `craftTabOf` in items.js. Each name is the tab's `title` and its aria label.
  - the recipe list.
  - the detail pane: icon, name, description, pin, ingredient tiles showing have/need (red when short) with the + sub-craft, and the Craft button. Clicking a recipe selects it, and the pane stays open; hovering does not open it. The pane's height follows its ingredients.
- **Backpack**: the panel sits on the bottom edge, centred on the screen when there is room, and otherwise right beside the crafting column. The detail pane has its own grid column, so it never covers the bag (checked at 1229x691, 1536x864 and 1920x1080). The panel holds, from top to bottom:
  - the 18-slot grid
  - Raft's **5 generic equipment slots**
  - the hotbar row, which is the bottom-centre hotbar of the bag screen
- **Equipment slots**: they show the diving gear you carry (`GEAR_IDS`; gear works while it is in the bag, one of each kind). They fill from the left and are read-only: the bag has no separate equipment storage.
- **Right side**: kept clear of panels. The pickup feed docks out of flow beside the bag, or above it on windows narrower than 1500px, so feed rows never resize anything.
- **Less text**: the "Crafting" and "Backpack" headings, the "Requires" label and the controls hint are visually hidden, but screen readers still get them. A refusal ("Can't place that there") shows briefly above the bag.
- **Tooltips**: crafting tooltips anchor beside the whole crafting panel, so they never cover the recipe list or the open recipe.
- **Sizing**: everything comes from the dialog size through container units, so layout is CSS only, with no per-frame reads or writes.
  - Slot size: `clamp(36px, ..., 56px)`.
  - Below 1230px wide, a tighter crafting column.
  - Below 1000px wide or 520px tall, one scrolling column.
- **Unchanged behaviour**: + sub-craft, pin, hold-to-craft, drag and drop, click and right-click moves, keyboard (roving tabs, arrow keys over slots and recipes), research gating, the co-op guest bag and no text selection. A browser probe confirmed these: 8 tabs with labels, click-select persists after the pointer leaves, hold-to-craft, arrow keys over tabs, the held stack under the pointer at zoom 1.2, a move, `user-select:none`, equipment showing fins and goggles, and no page errors.

## Data hooks

- craft-book `ITEM_TEXT` is `{...ITEM_TEXT_EXTRA, ...own rows}`, so the craft-book rows win.
- `ITEM_SOURCE` is `{...ITEM_SOURCE_EXTRA, ...own rows}`. items.js exports an empty `ITEM_SOURCE_EXTRA`, so a later items pass can add source hints without touching craft-book.
- `tabOf(id, kind)` maps any recipe to a tab: by recipe id, then by output kind, then the old group, then Other.

## Screenshots

- docs/loop/crafting-v2/crafting-1536x864-chip-hover.png
- docs/loop/crafting-v2/crafting-1920x1080-chip-hover.png (zoom 1.2: the card sits beside the panel, on screen)
- docs/loop/crafting-v2/crafting-1229x691-chip-hover.png (the detail pane is clear of the bag)
- docs/loop/crafting-v2/crafting-1920x1080-equipment.png (fins and goggles in the equipment slots)
- docs/loop/crafting-v2/flicker-before-1536x864-swap.png and flicker-after-1536x864-swap.png (pointer resting on a chip after a live swap)
