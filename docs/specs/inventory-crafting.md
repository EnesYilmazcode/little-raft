# Inventory and crafting: reference study and change list

Topic: the inventory grid, crafting menu, recipe panels, item stacks, tooltips and craft/pickup feedback.
These are reference frames from Raft (Redbeet Interactive), kept for internal study only. The change list
covers function and feel. It does not ask Little Raft to copy Raft's skin, icons, fonts or item art.

Scratch work (contact sheets, gridded crops, sampling scripts) is in
`/tmp/claude-0/-home-user-little-raft/357b287e-6b25-59b7-a94d-bb803559ea72/scratchpad/inventory-crafting/`.

## 1. Images examined

The primary set was all 46 frames in `references/raft/inventory-crafting/yt/` (960x540). Filenames use
`<id>_<mmss>`, so `_0110` = 1:10 = 70 s. The inventory is open in 43 of the 46 frames. The 3 frames without it
are `qVVltzNBaGw_0250`, `qVVltzNBaGw_0255` and `qdWZgcjkYNI_0410`. In `qdWZgcjkYNI_0640` only the
inventory and recipe panels are open.

I measured these frames on 2x gridded crops:
- `68lj91mBrDI_0110.jpg`: inventory, crafting and research panels
- `qdWZgcjkYNI_0140.jpg`: the large categorised recipe list
- `qdWZgcjkYNI_1045.jpg`: the storage panel and hotbar
- `qVVltzNBaGw_0400.jpg`: a recipe the player cannot craft (red state)
- `qdWZgcjkYNI_0720.jpg`: the hover info header
- `qdWZgcjkYNI_0945.jpg`: research rows marked "LEARNED"
- `9qt0eezZZMs_0012.jpg`: zoomed view of stacks and counts
- `qVVltzNBaGw_0455.jpg`: the "+1 item" pickup feed
- `68lj91mBrDI_0149.jpg` and `9qt0eezZZMs_0042.jpg`: the "learned" notification card

Stills: I scanned contact sheets of all 175 files in `stills/steam`, 285 in `stills/press` and 49 in
`stills/wiki-items`. Almost every gameplay shot shows only the HUD hotbar. The useful inventory stills are:
- `stills/steam/store_04.jpg` (1280x720, the sharpest full inventory and crafting screen; also at `stills/press/steam-store-04.jpg`)
- `stills/wiki-items/storage-large-ui.jpg` (a large storage panel)
- `stills/press/2021-06-24-hotfix-13-01-01.jpg` (a building-variant menu)

All measurements are % of frame width (W) or height (H). Colours are the median of a 3x3 or 5x5 patch, with
(x,y) given in source pixels.

## 2. Observations (spec of the reference)

### Layout

**C1. Panels float in a row across the upper part of the screen.** There is no full-screen backdrop and no dimming.
- The world stays at full brightness behind and between the panels in all 43 open frames, for example the sky in `store_04` and the ocean in `68lj91mBrDI_0110`.
- The HUD stat bars (bottom-left) and the hotbar (bottom-centre) stay visible and unchanged.

**C2. The inventory panel is centred horizontally.** It is the anchor of the layout.

| Frame | x range | Centre | Top | Height | Width |
|---|---|---|---|---|---|
| `store_04` | 516-773 px | 50.4% W | 18.2% H | 38.9% H | 20.1% W |
| `68lj91mBrDI_0110` | 387-579 px | 50.3% W | 18.1% H | - | - |
| `qdWZgcjkYNI_1045` | 384-576 px | 50.0% W | 14.4% H | 38.9% H | 20.0% W |

Mean of these 3 frames: centre 50.2% W, width 20.0% W.

**C3. Crafting has three panels on the left, from the screen edge inward** (`qdWZgcjkYNI_1045`):
- (a) A vertical category rail: x 1.3-6.5% W, 5.2% W wide, up to 72% H tall.
- (b) A list of recipes in the chosen category: x 7.1-23.3% W, 16.3% W wide.
- (c) A detail panel for the selected recipe: x 24.0-37.1% W, 13.1% W wide, about 33% H tall.

`store_04` gives the same widths within 1% W: rail 5.0%, list 16.4%, detail 13.2%.

**C4. A context panel goes to the right of the inventory.** A storage container (`qdWZgcjkYNI_1045`: x 61-81% W, 20 slots in 5x4) or the research table (`68lj91mBrDI_0110`, x 61-83% W) docks there. With it open, the panels span 1.3% to 81-83% W, in one row.

**C5. The category rail grows as content unlocks.**
- `68lj91mBrDI_0110` (early game) has 8 rail buttons.
- `store_04` and `qdWZgcjkYNI_1045` have 9: 8 icons plus a "..." overflow button.
- Button pitch is 43 px at 540p (8.0% H). The button is about 36 px (6.7% H).
- Empty categories seem to be hidden rather than greyed out (inferred, UNSURE).

### Inventory grid

**C6. The backpack is a 5-column grid with 3 rows (15 slots).**
- Seen in `store_04`, `68lj91mBrDI_0110`, `qdWZgcjkYNI_1045` and `9qt0eezZZMs_0012`.
- Below it is a separate row of 5 darker equipment slots with placeholder silhouettes (`store_04`, y 411-457 px).
- The 10-slot HUD hotbar is the rest of the inventory. It is not repeated inside the panel.

**C7. Slots are light wells on a dark panel.**

| Element | Colour | Sample point |
|---|---|---|
| Panel | #684d2f | `store_04` (700,230) |
| Slot centre | #ba9f6a | `store_04` (545,330) |
| Slot edge | #a48859 | `store_04` (530,320) |
| Gap between slots | #6e502e | `store_04` (569,330) |

- WCAG contrast between slot and panel is 2.99:1.
- Slot size: 44 px of 720 (6.1% H) in `store_04`, 36 px of 540 (6.7% H) in `qdWZgcjkYNI_1045`.
- The gap is 10% of pitch (44/49 px). `storage-large-ui.jpg` gives 67/73 px.

**C8. Stack counts are small cream numerals in the top-left corner of the slot.**
- Seen in `store_04` ("3", sampled #d2b991 at (530,267)) and `9qt0eezZZMs_0012` ("9", "5", "20", "15").
- The count is hidden when it is 1.
- The highest stack seen is 20 (`9qt0eezZZMs_0012`, `68lj91mBrDI_0110`, `qVVltzNBaGw_0400`).

**C9. Tools show a durability bar along the bottom of the slot.**
- In `store_04` (axe) the bar is 78% of the slot width and 5 px (11%) of its height, colour #bacf56 at (592,397).
- The same bar appears under most hotbar tools in `qdWZgcjkYNI_1045`.

**C10. Hover and selection are shown by a thin light outline on the slot**, with no change to the fill.
- Storage hover in `qdWZgcjkYNI_1045`: the brightest 10% of the rim pixels (x 662-666, y 275-295) is #cbb18e. The fill is #b79d6a.
- The selected hotbar slot in the same frame has a rim of #ceb58d.

**C11. Item info appears in a fixed header strip at the top of the inventory panel, not as a floating tooltip.**
- Hovering an item fills the strip with its icon well, name and a one-line description.
- Examples: `qdWZgcjkYNI_0720` ("YELLOW SEED / Add water to get a flower. Fits in a small crop plot.") and `qdWZgcjkYNI_0945` ("SCARECROW / Keeps seagulls away…").
- With nothing hovered, the strip shows an empty icon well and a divider (`store_04`, `qdWZgcjkYNI_1045`).
- The strip takes about 27% of the panel height (`store_04`: y 160-205 out of 131-411).

### Recipes and craft flow

**C12. Crafting takes three clicks: category, then recipe row, then CRAFT button.** The detail panel shows:
- the recipe icon and name
- a one-line description
- "REQUIRES" with one row per ingredient: icon, name and "have/need" (for example "6/6", "80/14", "27/8")

Sources: `store_04`, `qdWZgcjkYNI_0140`, `qdWZgcjkYNI_1045`.

**C13. Craftable and blocked states are shown on both the button and the rows.**

| Element | Colour | Sample point |
|---|---|---|
| CRAFT button, craftable | #859335 | `store_04` (415,112) |
| CRAFT button, craftable | #7f8d35 | `qdWZgcjkYNI_1045` (310,78) |
| CRAFT button, blocked | #94422d | `qVVltzNBaGw_0400` (308,91) |
| Missing ingredient row (tinted) | #854732 | `qVVltzNBaGw_0400` (300,153), "ROPE 0/4" |
| Satisfied ingredient row | #7d6042 | `qVVltzNBaGw_0400` (300,124) |

The same red state appears in `qdWZgcjkYNI_0720` ("ROPE 0/3").

**C14. Recipe rows group variants.**
- A row has a primary icon plus up to 2 variant icons. Examples: "BEDS" with 2, "STORAGES" with 3 (`qdWZgcjkYNI_0140`).
- The list has 13 rows plus a scrollbar.
- Row pitch is about 28.5 px at 540p (5.3% H).

### Feedback

**C15. Pickups and crafted items are reported in a right-aligned "+1 [icon] NAME" line at the bottom right.**
- In `qVVltzNBaGw_0455` the line covers x 87-100% W and y 93.7-98% H.
- Lifetime is about 2-3 s and lines stack upward (from memory, unverified).

**C16. Unlocks show a card at the top right**: "YOU LEARNED <name>", where the name is green, with "RESEARCHED BY: <player>" below.
- In `68lj91mBrDI_0149` the card covers x 82-99% W and y 2.6-11% H.
- `9qt0eezZZMs_0042` shows the same card.

### Hotbar and storage

**C17. The hotbar is 10 slots centred at the bottom, flush with the screen edge.**
- `store_04`: x 390-890 of 1280 (39.1% W), slots 45 px (6.25% H).
- `qdWZgcjkYNI_1045`: x 294-666 of 960 (38.8% W), top at 92% H.

**C18. A storage panel is the same slot grid with a title strip.**
- `qdWZgcjkYNI_1045`: 5x4 slots with sort buttons in the title strip.
- `storage-large-ui.jpg`: 5x8 = 40 slots.
- Moving items between the inventory and a container is shift-click or drag (from memory, unverified).

**C19. Raft has no craft timer** (from memory, unverified). The frames cannot show timing because they are 3-60 s apart.

## 3. Little Raft today

The data model is in `dist/inventory-state.js`:
- The constants are on lines 4-7: `STACK_SIZE = 20`, `SLOT_COUNT = 28`, `HOTBAR_SIZE = 8`, `TOOL_DURABILITY = 100`. That makes 8 hotbar slots and 20 backpack slots.
- `ITEM_INFO` (line 13) has `name` and `icon` but no description field.
- `RECIPES` (line 44) has 10 flat recipes with no categories.
- The constructor (line 138) rejects any snapshot whose `slots.length !== SLOT_COUNT`.
- `remove()` (line 222) takes from the back first, so hotbar stacks are spared. That is good.
- `craft()` (line 327) is atomic and instant.

The view is in `dist/survival-ui.js`. Its CSS is injected from lines 116-187.

**Inventory dialog**
- It is a centred modal (`showModal`, line 493).
- The backdrop dims the world: `#inventory.sv-inv::backdrop{background:rgba(12,9,5,.42)}` on line 140. That is the opposite of C1.

**Layout**
- The layout is `.sv-wrap` (line 141): a 300 px crafting column on the left (line 145) and the bag on the right (line 146).
- At 1280x720 the whole dialog is about 770 px (about 60% W).
- `.sv-craft` has `max-height:min(520px, 94vh-30px)` (line 145). Each recipe row is at least 58 px plus a 6 px margin (lines 161-169), so 10 rows need about 650 px. **The last 2-3 recipes are always below a scroll fold**, even at 1080p.

**Grid**
- `.sv-grid` is `repeat(7,52px)` (line 147) holding 20 backpack slots. That gives rows of 7, 7 and **6**, a ragged last row.
- `.sv-hotrow` is `repeat(8,52px)` (line 148), 458 px wide. The grid is 400 px wide, so the two rows do not line up.
- The hotbar is drawn twice: the HUD `.tools` hotbar sits behind the backdrop, and the copy in `.sv-hotrow` is the one you can use.

**Slot colours**
- Slots are dark (`linear-gradient(#5a3f28e8,#3d2a19e8)`, line 123) on a dark section (`#3a2716eb`, line 144).
- Contrast between an empty slot and the section is 1.22:1.
- Icon outlines are ink `#153e49` (the CUSTOM drawings on lines 34-49 and icons.svg) on a slot midpoint of about #4b3420. **That is 1.0:1, so icon outlines disappear.** Raft gets 2.99:1 for slot against panel and about 4.4:1 for dark outline against slot (C7).

**Selection, counts and durability**
- The selected slot is a lighter gradient with a `#ffe3a6` inset ring (line 135).
- The count is in the bottom-right, 14 px (line 130).
- The durability bar is 79% wide and 3 px tall, coloured green, then amber, then red (lines 131-133 and 254). This is close to C9 but thinner.

**Tooltip**
- The tooltip floats at the cursor (`.sv-tip`, lines 180-183; `showTip`, lines 444-451).
- It shows the name and either "n / max" or "Durability n%". There is no description (unlike C11).
- It can cover the neighbouring slots.

**Recipes**
- Clicking a recipe row crafts at once (line 528). There is no separate select step, no detail view and no description.
- Rows the player cannot craft are `disabled` at `opacity:.6` (line 167).
- Short ingredient chips are tinted `#ffab8f` (line 176).
- "No room in inventory" appears inline (line 338).
- The have/need order matches C12.

**Moving items**
- Click picks up and click places. Right-click takes half or places one (line 545). Drag moves, and shift-drag moves half (line 571).
- There is no shift-click quick-move between the hotbar and the backpack.

**Craft feedback**
- `game.js:546` emits "Crafted X" through `notice()` (`game.js:394`, which lasts 1800 ms) plus a 560 Hz beep (`game.js:530`).
- `updateContext` only draws notices when `running && !dialog` (`game.js:403`), and `uiBlocked()` is true while the inventory is open (`game.js:231`).
- **So a craft made inside the inventory gives no visible message.** The player gets the beep, the count change and a notice that runs out unseen.
- `#toast` is `display:none` while playing (`graphics.css:382`).
- There is no pickup feed like C15.

**Other**
- Hotbar: 8 slots of 58 px (line 122). At 1280x720 that is about 506 px (39.5% W, matching C17), with slots 8.1% H tall (C17 is 6.25%). Slot sizes are fixed px with no viewport scaling.
- The inventory opens with Tab or I (survival-ui.js:618).
- `crafts.js` holds only the 3D models of the 6 placeable crafts (sail, palm, lantern, net, bench, crate; `createCraft`, line 10). A placed crate is decoration only and has no storage (`game.js:27`).
- `index.html:8` still has the old "SHARED SUPPLIES" counter (wood, leaves, scrap). `index.html:10` has the `.tools` toolbar that survival-ui replaces.

## 4. Ranked change list

**#1 Show craft and pickup feedback while the inventory is open.**
- Where: `dist/survival-ui.js`, `dist/game.js`.
- Add a small feed inside the inventory dialog, plus a HUD feed at the bottom right (about 87-99% W, 90-97% H, C15).
- Each line reads "+1 [icon] Name". Lines stack upward, last about 2.5 s and fade out. Show at most 4 lines.
- In `game.js:403` let notices of kind `craft` reach the feed even when `uiBlocked()` is true.
- Briefly flash the slot that received the crafted item, using the existing `sv-over` styling, for about 400 ms.
- Impact H, effort S.

**#2 Make slots readable: light wells on a darker panel, in Little Raft's own palette.**
- Where: `dist/survival-ui.js` CSS, lines 123, 135, 144 and 151-152.
- The empty-slot fill should be a light sand or sea-foam tone, at least 2.5:1 against the section (Raft's is about 3:1, C7). Icon ink `#153e49` should then reach at least 4:1 against it (today 1.0:1).
- This also suits Little Raft's light "paper and ink" HUD (`style.css:2`, `--paper #f4fcf8`, `--ink #113e47`). Do not use Raft's parchment browns.
- Keep the selected state as a thicker light rim (C10), not a fill change.
- Impact H, effort S.

**#3 Stop the recipe list from hiding recipes.**
- Where: `dist/survival-ui.js`, lines 145 and 161-170, and `buildRecipes()` on line 303.
- Add 3-4 category tabs at the top of the crafting column, for example Tools, Materials, Raft, Comfort. Add a `cat` field to `RECIPES` in `inventory-state.js:44`.
- Or use compact 40-44 px rows so all 10 fit within 520 px. The rule: every recipe must be visible without scrolling at 1280x720.
- Raft's model is a rail plus list (C3, C5). With 10 recipes, tabs are enough.
- Impact H, effort M.

**#4 Add a fixed item-info strip at the top of the bag.**
- Where: `dist/survival-ui.js` `mountDialog()` (line 209) and `showTip` (line 444); `dist/inventory-state.js` `ITEM_INFO`.
- Add a `desc` string to each `ITEM_INFO` entry (one kid-friendly line, for example "Tie things together. Made from palm leaves.").
- Render the icon, name, description and count or durability in a strip above `.sv-grid`, about 25% of the bag height (C11).
- Fill it on hover and on keyboard focus. Show "Hover an item to see what it does" when nothing is hovered.
- Keep the cursor tooltip only for recipe ingredient chips, or remove it.
- Impact M-H, effort S.

**#5 Fix the grid shape so the backpack and hotbar line up.**
- Where: `dist/inventory-state.js` line 5 (`SLOT_COUNT`) and the constructor length check (line 138); `dist/survival-ui.js` line 147.
- Preferred: `SLOT_COUNT = 32`, giving an 8-column backpack of 3 rows above the 8-slot hotbar. The constructor should pad shorter legacy snapshots with `null` instead of throwing.
- Cheaper option: keep 28 and use `repeat(5,52px)` for 5x4 = 20, which matches Raft's 5-wide rhythm (C6, C18). The hotrow is then wider, so centre both rows.
- Either way, no ragged 7/7/6 last row.
- Impact M, effort S-M.

**#6 Separate choosing a recipe from crafting it, so a misclick cannot spend materials.**
- Where: `dist/survival-ui.js`, line 528.
- Clicking a row selects it and opens a detail area. The detail shows the icon, name, description and a "have/need" row per ingredient (C12), plus one large Craft button.
- Keep a quick path: double-click, or Enter on a focused row, crafts.
- Make the Craft button look clearly different when it is ready (a green-leaning tone) and when it is blocked (a warm red-leaning tone plus a lock or "Need 2 more Rope" text). Do not rely on `opacity:.6` (line 167). Tint the missing-ingredient rows as well (C13).
- Impact M, effort M.

**#7 Do not dim the world behind the inventory.**
- Where: `dist/survival-ui.js`, line 140.
- Set the `::backdrop` to transparent or at most 0.15 alpha, and keep the HUD stat bars visible (C1).
- Raft keeps the world bright so you can still see the sea, sharks and items drifting by. Little Raft is co-op, so the other brother's actions stay visible too.
- Impact M, effort S.

**#8 Put the bag at the screen centre, with crafting to its left.**
- Where: `dist/survival-ui.js`, lines 138-146.
- Anchor `.sv-bag` at 50% W, with its top at about 15-18% H (C2). Let the crafting column sit left of it, docked to the left side (C3).
- This leaves room on the right for a future storage or crate panel (C4).
- Today the dialog is centred as a whole, so the bag's centre drifts right of the screen centre.
- Impact M, effort M.

**#9 Add a shift-click quick-move between the hotbar and the backpack.**
- Where: `dist/survival-ui.js` click handler (line 525), which calls `onMove` to the first free or mergeable slot in the other section.
- Later the same rule can cover bag to crate (C18).
- Impact M, effort S.

**#10 Highlight the slot that receives a crafted item, and pulse the recipe row.**
- Where: `dist/survival-ui.js` `paintInventory` (line 428).
- When a slot's count goes up after `onCraft`, add a 300-500 ms light ring and a scale animation (1.0 → 1.08 → 1.0). Pulse the recipe row too.
- Honour `prefers-reduced-motion` (line 186).
- This is the in-panel half of #1.
- Impact M, effort S.

**#11 Mark newly craftable recipes.**
- Where: `dist/survival-ui.js` `paintRecipes` (line 320).
- When a recipe goes from blocked to craftable after a pickup, show a small dot on the row and on the Tab/I hint until the inventory is opened. This works in place of Raft's "You learned" card (C16), since Little Raft has no research system.
- Impact M, effort S.

**#12 Make the durability bar thicker and the count easier to read.**
- Where: `dist/survival-ui.js`, lines 130-131.
- The bar goes from 3 px to 4-5 px (about 9% of slot height, C9).
- The count keeps its corner but gets a solid dark backing pill, so it reads on the lighter wells from #2.
- Impact L-M, effort S.

**#13 Scale slot sizes with the viewport.**
- Where: `dist/survival-ui.js`, lines 122, 147-149 and 185.
- Use `clamp(42px, 6.5vh, 64px)` instead of fixed 52 and 58 px. Raft's slots are about 6-7% H at every resolution (C7, C17). Little Raft's are 7.2% at 720p but only 4.8% at 1080p.
- Impact L-M, effort S.

**#14 Let placed crates open a storage panel next to the bag.**
- Where: `dist/game.js` (DECOR_TYPES, line 27), plus a new storage Bag and a docked panel in `survival-ui.js`.
- Reuse the same slot component, with 5 columns (C4, C18).
- Impact M, effort L.

**#15 Remove the leftover "SHARED SUPPLIES" counter** (`index.html:8`), or move it into the inventory, now that the per-player bag is the source of truth.
- Impact L, effort S.

## 5. Open questions

- **C5:** I can't confirm from the frames whether empty Raft categories are hidden or locked. 8 against 9 rail buttons only shows that the rail grows.
- **C15 and C19:** notification lifetime and the lack of a craft timer are from memory. The frames are too far apart (≥3 s) to time either.
- **C8:** the stack cap of 20 is the largest count seen in 6 frames. Some items may stack higher. Little Raft's `STACK_SIZE = 20` already matches.
- **C18:** shift-click transfer to storage is from memory, unverified.
- **Equipment row (C6):** Little Raft has no wearables. I recommend skipping it unless equipment is planned.
- **#5:** changing `SLOT_COUNT` affects multiplayer snapshots. Host and guest builds must agree, so ship it with a version bump.
- **#6 against one-click crafting:** players are young (`index.html:11`, "Play with my brother"). One click may be part of the intended feel, so playtest before removing it. Double-click to craft is the compromise.
- **The red "cannot craft" CRAFT button (C13)** appears in only 2 frames (`qVVltzNBaGw_0400`, `qdWZgcjkYNI_0720`). Both are night scenes, so the sampled colours are darker than daytime.
