# Crafting v2

Branch `claude/raft-crafting-v2` merges two branches that both start at aac7852 (`claude/raft-items`):

- `claude/raft-crafting-ui`: the flicker fix and the Raft-style bag and crafting layout (survival-ui.js, craft-book.js, item-tooltips.js, live.js, crafting tests).
- `claude/raft-items-fix`: the item parity passes and their save, seed and co-op compatibility work (trader-core.js, treasure-rules.js, items.js, coop.js and their tests).

The two branches touch separate files, so the merge was clean with no conflicts.

More detail is in:
- docs/loop/crafting-v2/UI-NOTES.md
- docs/loop/raft-item-parity.md
- docs/loop/raft-crafting-reference.md

## The flicker

The report said: "When I try to craft something, it just keeps flickering back and forth really fast, and there's like something on the right hand side."

**Root cause.** Every deploy reaches a running game, because raftLive polls for new builds and hot-swaps the engine mid-session. On that swap, the old item-tooltips instance's `dispose()` deleted the shared `#item-tooltips-style`, because the new instance's tooltip was not in the DOM yet. The unstyled `.it-tip` then became a flex child of the bag dialog. Since commit 635cec3 that dialog is `display:flex;justify-content:center`, so the panel recentred. The chip then left the cursor, hover ended and the panel recentred again. This repeated about once per frame.

| Viewport | Panel x before the swap | Panel x after the swap | Tooltip toggles per frame |
|---|---|---|---|
| 1536x864 | 238 | 0 | 3.96 to 4.0 (0.02 normally) |
| 1920x1080 | 324 | 0 | 3.96 to 4.0 |
| 1229x691 | 85 | 0 | flicker |

The empty pale column on the right had two causes:
- the unstyled tooltip taking flex width
- survival-ui's own `.sv-tip` card showing, because its hide rule lived in the deleted sheet

Two related bugs:
- At 1920 wide, the 1.2 UI zoom put tooltips off screen (x=1904).
- In live.js, two overlapping update checks could both swap. That leaked a whole engine and showed duplicate tooltips.

**Fixes:**
- each item-tooltips instance owns its own style sheet, and a global registry keeps only one instance live
- the tooltip card has inline `position:fixed`, so it never joins a layout
- the bag dialog is `display:block`
- tooltip and held-stack placement correct for the zoom
- live.js runs one update check at a time

**After the fix:**
- every repro case is STABLE and the panel x stays constant
- after a double swap there is 1 sheet and 1 card

## Layout

The layout follows Raft: crafting on the left, the backpack in the centre, and the right side clear.

**Crafting**
- A column of 8 Raft tabs shown as icons: food, other, tools, weapons, equipment, resources, navigation and decorations.
- A recipe list that is as tall as its content.
- A recipe card beside the list, sized to its ingredients. Ingredients you are short of show in red. The card has + sub-craft, pin and Craft.

**Backpack**
- Centred when it fits:
  - 1536x864: x 453 to 1084
  - 1920x1080: x 581 to 1338
  - 1229x691: beside the crafting panel
- 5 equipment slots under the grid. They are real drop targets and show the gear you are wearing.
  - Worn gear is the first 5 gear stacks in the bag. Each one shows once.
  - The save shape does not change.

**Tooltips**
- Crafting tooltips stay out of the screen centre.

### Screenshots

All in docs/loop/crafting-v2/:
- crafting-1536x864-chip-hover.png
- crafting-1920x1080-chip-hover.png
- crafting-1229x691-chip-hover.png
- crafting-1920x1080-equipment.png
- crafting-1920x1080-short-tab.png
- flicker-before-1536x864-swap.png
- flicker-after-1536x864-swap.png
- items-bag.png
- items-icons.png
- items-pass2-bag.png
- items-pass2-icons.png
- items-pass2-tooltip.png

## Items

The Raft 1.0 list has 191 items. It was built from search summaries, because the wiki hosts were unreachable. Recipes taken from memory are marked `[recall]` in the parity doc.

| Measure | Before | After |
|---|---|---|
| Matched in Little Raft | 102 | 115 |
| Bag kinds | 148 | 160 |

**Added (12 items):**
- metalaxe
- machete
- headlamp
- titaniumore
- titaniumingot
- vinegoo (Kelp Glue)
- circuitboard
- titaniumaxe
- titaniumsword
- meal_gardensoup
- meal_hotpot
- meal_sharkroast

**Retunes:**
- grill: rope 3 to 6
- scarecrow: new cost

**Still missing:**
- **40 cheap-ish.** Each one is blocked on code outside the data files, for example hook kind checks, fishing rod checks, bush loot code and the juicer mix.
- **36 need new systems.**

**Kept:** 59 items that only Little Raft has.

The circuit board has no use yet. Raft's circuit board recipe changes were declined because they would wreck the economy: copper and seaweed are too scarce.

## Review

- An adversarial review found no blocking bugs.
- Main-thread frame time averaged 16.7 ms on both the candidate and base. That is no regression. SwiftShader real-draw numbers were within noise.
- An old save from base loads identically.
- Unknown and legacy ids are mapped or dropped.
- Co-op host and guest of old and new builds connect without errors, in either mix.
- The check_*.py results are identical to base. Several fail on base too, or need the PeerJS cloud, which is unreachable here.

**Save and seed compatibility**
- **Traders:** offers are identical on about 71% of seeds. Otherwise they differ in one slot only.
- **Buried loot:** keeps the old picks and may add titanium.
- **Barrels:** use Math.random.
- **Co-op:** HELD is extended with version negotiation. Old peers see the item's tool role.

## Verification on the merge

These were measured on the merge commit in this environment.

- **`npm test`:** 1510 tests, 1510 pass, 0 fail.
- **`tools/repro_craft_flicker.mjs`** (VIEWPORTS=1536x864@1,1920x1080@1, TARGETS=chip,row): all 8 cases STABLE, exit 0 both with and without LIVE_SWAP.

| Case | Without swap | With LIVE_SWAP |
|---|---|---|
| 1536x864 chip | STABLE, 1/1, x 14, 0.02 | STABLE, 1/1, x 14, 0.02 |
| 1536x864 row | STABLE, 1/1, x 14, 0.02 | STABLE, 1/1, x 14, 0.02 |
| 1920x1080 chip | STABLE, 1/1, x 17, 0.02 | STABLE, 1/1, x 17, 0.02 |
| 1920x1080 row | STABLE, 1/1, x 17, 0.02 | STABLE, 1/1, x 17, 0.02 |

Each cell gives: verdict, tooltip sheets/cards, panel x per frame, tooltip toggles per frame. The panel x was a single value inside every mutation batch too.

- **`python shoot.py dist <dir>`** (Chrome, SwiftShader):
  - 0 page errors and 15 screenshots.
  - The console showed only WebGL driver performance notices.
  - Average frame time was 137 ms. That is the SwiftShader software renderer, not a game number.
- **Commit hygiene:**
  - The commit log from `claude/raft-feedback-all` to here has no em dashes and no AI trailers.
  - The diff adds no em dash characters.

## Risks

- The research web sources are unverified.
- The trader slot changes on 29% of seeds.
- Equipment is a view over bag slots, not separate storage.
- The Weapons tab is hidden on fresh games until research unlocks it.
- Short tabs show empty wood panel below the rows.
- check_connection.py and check_multiplayer.py could not run here.
