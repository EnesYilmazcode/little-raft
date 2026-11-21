# Inventory and crafting: reference study and change list

Topic: the inventory grid, crafting menu, recipe panels, item stacks, tooltips and craft/pickup feedback.
These are reference frames from Raft (Redbeet Interactive), kept for internal study only. The change list
covers function and feel. It does not ask Little Raft to copy Raft's skin, icons, fonts or item art.

Scratch work (contact sheets, gridded crops, sampling scripts) is in
`/tmp/claude-0/-home-user-little-raft/357b287e-6b25-59b7-a94d-bb803559ea72/scratchpad/inventory-crafting/`.

## 1. Images examined

The primary set was all 45 frames in `references/raft/inventory-crafting/yt/` (960x540). **[CORRECTED: 45 frames, not 46; the 46th file in the folder is SOURCES.md]** Filenames use
`<id>_<mmss>`, so `_0110` = 1:10 = 70 s. The inventory is open in 42 of the 45 frames. **[CORRECTED: 42 of 45, was 43 of 46; the 3 closed frames below are right]** The 3 frames without it
are `qVVltzNBaGw_0250`, `qVVltzNBaGw_0255` and `qdWZgcjkYNI_0410`. In `qdWZgcjkYNI_0640` only the
inventory and recipe panels are open (rail, list and detail plus inventory; no right-hand context panel). **[VERIFIED]**

I measured these frames on 2x gridded crops:
- `68lj91mBrDI_0110.jpg`: inventory, crafting and research panels
- `qdWZgcjkYNI_0140.jpg`: the large categorised recipe list
- `qdWZgcjkYNI_1045.jpg`: the storage panel and hotbar
- `qVVltzNBaGw_0400.jpg`: a recipe the player cannot craft (red state)
- `qdWZgcjkYNI_0720.jpg`: the hover info header
- `qdWZgcjkYNI_0945.jpg`: research rows marked "LEARNED"
- `9qt0eezZZMs_0012.jpg`: zoomed view of stacks and counts
- `qVVltzNBaGw_0455.jpg`: the "+1 item" pickup feed
- `68lj91mBrDI_0149.jpg` and `9qt0eezZZMs_0042.jpg`: the "learned" notification card **[VERIFIED: all 10 files exist and show what is listed]**

Stills: I scanned contact sheets of all 174 images in `stills/steam`, 283 in `stills/press` and 49 in
`stills/wiki-items`. **[CORRECTED: 174 and 283 images, was 175 and 285; the extra files are SOURCES.md and rows.json]** Almost every gameplay shot shows only the HUD hotbar. The useful inventory stills are:
- `stills/steam/store_04.jpg` (1280x720, the sharpest full inventory and crafting screen; also at `stills/press/steam-store-04.jpg`)
- `stills/wiki-items/storage-large-ui.jpg` (a large storage panel)
- `stills/press/2021-06-24-hotfix-13-01-01.jpg` (a building-variant menu) **[VERIFIED: store_04 and steam-store-04 are byte-identical; storage-large-ui is 388x693]**

All measurements are % of frame width (W) or height (H). Colours are the median of a 3x3 or 5x5 patch, with
(x,y) given in source pixels.

## 2. Observations (spec of the reference)

### Layout

**C1. Panels float in a row across the upper part of the screen.** There is no full-screen backdrop and no dimming. **[VERIFIED]**
- The world stays at full brightness behind and between the panels in all 43 open frames, for example the sky in `store_04` and the ocean in `68lj91mBrDI_0110`.
- The HUD stat bars (bottom-left) and the hotbar (bottom-centre) stay visible and unchanged.

**C2. The inventory panel is centred horizontally.** It is the anchor of the layout. **[VERIFIED: re-measured store_04 panel 516-773 px, top 132, bottom 410 (38.6% H); 68lj_0110 387-580 px, top 98; qdW_1045 384-576 px, top 78]**

| Frame | x range | Centre | Top | Height | Width |
|---|---|---|---|---|---|
| `store_04` | 516-773 px | 50.4% W | 18.2% H | 38.9% H | 20.1% W |
| `68lj91mBrDI_0110` | 387-579 px | 50.3% W | 18.1% H | - | - |
| `qdWZgcjkYNI_1045` | 384-576 px | 50.0% W | 14.4% H | 38.9% H | 20.0% W |

Mean of these 3 frames: centre 50.2% W, width 20.0% W.

**C3. Crafting has three panels on the left, from the screen edge inward** (`qdWZgcjkYNI_1045`): **[VERIFIED: rail 12-62 px, y 12-403; list 68-224 px; detail 229-356 px, y 14-194; store_04 rail 18-82, list 90-300, detail 305-475]**
- (a) A vertical category rail: x 1.3-6.5% W, 5.2% W wide, up to 72% H tall.
- (b) A list of recipes in the chosen category: x 7.1-23.3% W, 16.3% W wide.
- (c) A detail panel for the selected recipe: x 24.0-37.1% W, 13.1% W wide, about 33% H tall.

`store_04` gives the same widths within 1% W: rail 5.0%, list 16.4%, detail 13.2%.

**C4. A context panel goes to the right of the inventory.** A storage container (`qdWZgcjkYNI_1045`: x 61-81% W, 20 slots in 5x4) or the research table (`68lj91mBrDI_0110`, x 61-83% W) docks there. With it open, the panels span 1.3% to 81-83% W, in one row. **[VERIFIED: storage 584-778 px (60.8-81.0% W); research table 584-800 px (60.8-83.3% W)]**

**C5. The category rail grows as content unlocks.** **[VERIFIED: 8 buttons in 68lj_0110, 8+"..." in store_04 and qdW_1045; pitch re-measured 42.5 px. The hidden-vs-greyed point stays UNSURE]**
- `68lj91mBrDI_0110` (early game) has 8 rail buttons.
- `store_04` and `qdWZgcjkYNI_1045` have 9: 8 icons plus a "..." overflow button.
- Button pitch is 43 px at 540p (8.0% H). The button is about 36 px (6.7% H).
- Empty categories seem to be hidden rather than greyed out (inferred, UNSURE).

### Inventory grid

**C6. The backpack is a 5-column grid with 3 rows (15 slots).** **[VERIFIED]**
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

- WCAG contrast between slot and panel is 3.07:1. **[CORRECTED: 3.07:1, was 2.99:1. The four sampled colours re-sample exactly (5x5 median), but #ba9f6a vs #684d2f computes to 3.07]**
- Slot size: 44 px of 720 (6.1% H) in `store_04`, about 33 px of 540 (6.1% H) at a 36.7 px pitch (6.8% H) in `qdWZgcjkYNI_1045`. **[CORRECTED: was "36 px (6.7% H)", which is the pitch, not the slot. The 540p slot is 0.75 x the 720p one]**
- The gap is 10% of pitch (44/49 px). `storage-large-ui.jpg` gives 67/73 px. **[VERIFIED: store_04 slots start at x 526, 575, 623, 671, 720; wiki slots 13-79, 86-151, ... pitch 73]**

**C8. Stack counts are small cream numerals in the top-left corner of the slot.** **[VERIFIED: #d2b991 re-sampled at (530,267) on 3x3; "20" seen in 9qt_0012, 68lj_0110 and qVV_0400. "Hidden when 1" is inferred from numberless filled slots]**
- Seen in `store_04` ("3", sampled #d2b991 at (530,267)) and `9qt0eezZZMs_0012` ("9", "5", "20", "15").
- The count is hidden when it is 1.
- The highest stack seen is 20 (`9qt0eezZZMs_0012`, `68lj91mBrDI_0110`, `qVVltzNBaGw_0400`).

**C9. Tools show a durability bar along the bottom of the slot.**
- In `store_04` (axe) the bar is 78% of the slot width and 5 px (11%) of its height, colour #bacf56 at (592,397).
- The same bar appears under most hotbar tools in `qdWZgcjkYNI_1045`. **[VERIFIED: green fill x 579-612 in a 576-619 slot (77%), 3 px of fill inside a ~5 px framed bar; colour #bacf56 re-sampled on 3x3]**

**C10. Hover and selection are shown by a thin light outline on the slot**, with no change to the fill.
- Storage hover in `qdWZgcjkYNI_1045`: the brightest 10% of the rim pixels (x 662-666, y 275-295) is #cbb18e. The fill is #b79d6a.
- The selected hotbar slot in the same frame has a rim of #ceb58d. **[VERIFIED: rim re-measured #ccb28e and #ceb58d; hovered fill #b19a68 against neighbour #af9865, so the fill does not change]**

**C11. Item info appears in a fixed header strip at the top of the inventory panel, not as a floating tooltip.** **[VERIFIED for the behaviour and both quoted texts; height corrected below]**
- Hovering an item fills the strip with its icon well, name and a one-line description.
- Examples: `qdWZgcjkYNI_0720` ("YELLOW SEED / Add water to get a flower. Fits in a small crop plot.") and `qdWZgcjkYNI_0945` ("SCARECROW / Keeps seagulls away…").
- With nothing hovered, the strip shows an empty icon well and a divider (`store_04`, `qdWZgcjkYNI_1045`).
- The strip takes about 35% of the panel height (`store_04`: y 160-258 out of 132-410, i.e. icon row and divider at 160-205 plus the description space down to the grid top at 258). **[CORRECTED: was 27%. The cited 160-205 span is only 16%; the description (see qdW_0720) sits below the divider, so the full strip runs to the grid at y 258]**

### Recipes and craft flow

**C12. Crafting takes three clicks: category, then recipe row, then CRAFT button.** The detail panel shows:
- the recipe icon and name
- a one-line description
- "REQUIRES" with one row per ingredient: icon, name and "have/need" (for example "6/6", "80/14", "27/8")

Sources: `store_04`, `qdWZgcjkYNI_0140`, `qdWZgcjkYNI_1045`. **[VERIFIED: "6/6" store_04, "80/14" 68lj_0110, "27/8" qVV_0400. "Three clicks" is inferred from the layout]**

**C13. Craftable and blocked states are shown on both the button and the rows.**

| Element | Colour | Sample point |
|---|---|---|
| CRAFT button, craftable | #859335 | `store_04` (415,112) |
| CRAFT button, craftable | #7f8d35 | `qdWZgcjkYNI_1045` (310,78) |
| CRAFT button, blocked | #94422d | `qVVltzNBaGw_0400` (308,91) |
| Missing ingredient row (tinted) | #854732 | `qVVltzNBaGw_0400` (300,153), "ROPE 0/4" |
| Satisfied ingredient row | #7d6042 | `qVVltzNBaGw_0400` (300,124) |

The same red state appears in `qdWZgcjkYNI_0720` ("ROPE 0/3"). **[VERIFIED: all five colours re-sample exactly on 5x5 medians]**

**C14. Recipe rows group variants.**
- A row has a primary icon plus up to 2 variant icons. Examples: "BEDS" with 2, "STORAGES" with 3 (`qdWZgcjkYNI_0140`).
- The list has 12 recipe rows under a category header, plus a scrollbar. **[CORRECTED: 12 rows, was 13 (research table to zipline in both qdW_0140 and qdW_1045)]**
- Row pitch is about 28.5 px at 540p (5.3% H). **[VERIFIED]**

### Feedback

**C15. Pickups and crafted items are reported in a right-aligned "+1 [icon] NAME" line at the bottom right.**
- In `qVVltzNBaGw_0455` the line covers x 87-100% W and y 93.7-98% H. **[VERIFIED: box from x ~835 to the frame edge, y 506-530]**
- Lifetime is about 2-3 s and lines stack upward (from memory, unverified). **[UNSURE: wiki unreachable, and frames are too far apart to time]**

**C16. Unlocks show a card at the top right**: "YOU LEARNED <name>", where the name is green, with "RESEARCHED BY: <player>" below.
- In `68lj91mBrDI_0149` the card covers x 82-99% W and y 2.6-11% H.
- `9qt0eezZZMs_0042` shows the same card. **[VERIFIED: card x 785-950 (81.8-99% W), y 14-60 (2.6-11.1% H); green name visible]**

### Hotbar and storage

**C17. The hotbar is 10 slots centred at the bottom, flush with the screen edge.**
- `store_04`: x 390-890 of 1280 (39.1% W), slots 45 px (6.25% H).
- `qdWZgcjkYNI_1045`: x 294-666 of 960 (38.8% W), top at 92% H. **[VERIFIED: store_04 slot pitch 49 px, slots ~45 px]**

**C18. A storage panel is the same slot grid with a title strip.**
- `qdWZgcjkYNI_1045`: 5x4 slots with sort buttons in the title strip.
- `storage-large-ui.jpg`: 5x8 = 40 slots. **[VERIFIED]**
- Moving items between the inventory and a container is shift-click or drag (from memory, unverified). **[UNSURE: wiki unreachable]**

**C19. Raft has no craft timer** (from memory, unverified). The frames cannot show timing because they are 3-60 s apart. **[UNSURE: wiki unreachable]**

## 3. Little Raft today

The data model is in `dist/inventory-state.js`:
- The constants are on lines 4-7: `STACK_SIZE = 20`, `SLOT_COUNT = 28`, `HOTBAR_SIZE = 8`, `TOOL_DURABILITY = 100`. That makes 8 hotbar slots and 20 backpack slots. **[VERIFIED]**
- `ITEM_INFO` (line 13) has `name` and `icon` but no description field. **[VERIFIED]**
- `RECIPES` (line 44) has 10 flat recipes with no categories. **[VERIFIED]**
- The constructor (line 127; the check is on line 138) rejects any snapshot whose `slots.length !== SLOT_COUNT`. **[CORRECTED: constructor starts at line 127, not 138; 138 is the length check]**
- `remove()` (line 222) takes from the back first, so hotbar stacks are spared. That is good. **[VERIFIED]**
- `craft()` (line 327) is atomic and instant. **[VERIFIED]**

The view is in `dist/survival-ui.js`. Its CSS is injected from lines 116-187. **[VERIFIED]**

**Inventory dialog**
- It is a centred modal (`showModal`, line 493). **[VERIFIED]**
- The backdrop dims the world: `#inventory.sv-inv::backdrop{background:rgba(12,9,5,.42)}` on line 140. That is the opposite of C1. **[VERIFIED: computed ::backdrop is rgba(12,9,5,0.42) in headless Chrome]**

**Layout**
- The layout is `.sv-wrap` (line 141): a 300 px crafting column on the left (line 145) and the bag on the right (line 146). **[VERIFIED]**
- At 1280x720 the whole dialog is about 830 px (about 65% W). **[CORRECTED: was 770 px / 60% W. Rendered in headless Chrome: `.sv-wrap` 830 px wide (crafting 300 + gap 12 + bag 488 + padding and border); the bag's centre is at x 796, 62% W]**
- `.sv-craft` has `max-height:min(520px, 94vh-30px)` (line 145). Each recipe row is at least 58 px plus a 6 px margin (lines 161-169), so 10 rows need about 650 px. **The last 2-3 recipes are always below a scroll fold**, even at 1080p. **[VERIFIED: rendered at 1280x720 and 1920x1080, `.sv-craft` clientHeight 520, scrollHeight 652, rows 58 px at a 64 px pitch, 8 of 10 rows fully visible, so exactly 2 are hidden]**

**Grid**
- `.sv-grid` is `repeat(7,52px)` (line 147) holding 20 backpack slots. That gives rows of 7, 7 and **6**, a ragged last row. **[VERIFIED: rendered grid has 20 slots, computed columns 7x52px, row counts [7,7,6]]**
- `.sv-hotrow` is `repeat(8,52px)` (line 148), 458 px wide. The grid is 400 px wide, so the two rows do not line up. **[VERIFIED: rendered widths 400 and 458 px]**
- The hotbar is drawn twice: the HUD `.tools` hotbar sits behind the backdrop, and the copy in `.sv-hotrow` is the one you can use. **[VERIFIED]**

**Slot colours**
- Slots are dark (`linear-gradient(#5a3f28e8,#3d2a19e8)`, line 123) on a dark section (`#3a2716eb`, line 144). **[VERIFIED]**
- Contrast between an empty slot and the section is about 1.1:1 (1.03-1.33 across the slot gradient). **[CORRECTED: was 1.22:1. That figure (1.23 by my maths) uses the opaque hex values. Both colours are translucent (e8 and eb alpha); composited over the `.sv-wrap` gradient #b48d55-#8a663a, the section is about #422e1a and the slot midpoint about #4a3420, giving 1.10:1]**
- Icon outlines are ink `#153e49` (the CUSTOM drawings on lines 34-49 and icons.svg) on a slot midpoint of about #4b3420. **That is 1.0:1, so icon outlines disappear.** Raft gets 3.07:1 for slot against panel and about 4.4:1 for dark outline against slot (C7). **[CORRECTED: ink against slot re-computed as 1.00-1.18:1 after compositing, so 1.0:1 stands. Raft's slot/panel is 3.07:1, not 2.99:1. Raft icons have no separate ink outline: their darkest 5% of tones are 3.8-5.2:1 against the slot centre (brick 5.2, axe 5.2, bolt 4.7, sail 3.8), so "about 4.4:1" is within range but describes dark fills, not outlines]**

**Selection, counts and durability**
- The selected slot is a lighter gradient with a `#ffe3a6` inset ring (line 135). **[VERIFIED]**
- The count is in the bottom-right, 14 px (line 130). **[VERIFIED]**
- The durability bar is 79% wide and 3 px tall, coloured green, then amber, then red (lines 131-133 and 254). This is close to C9 but thinner. **[VERIFIED: 46/58 = 79% in the HUD; 40/52 = 77% in the dialog; colour switch on line 254]**

**Tooltip**
- The tooltip floats at the cursor (`.sv-tip`, lines 180-183; `showTip`, lines 444-451).
- It shows the name and either "n / max" or "Durability n%". There is no description (unlike C11).
- It can cover the neighbouring slots. **[VERIFIED: `.sv-tip` lines 180-183, `showTip` 444-451]**

**Recipes**
- Clicking a recipe row crafts at once (line 528). There is no separate select step, no detail view and no description.
- Rows the player cannot craft are `disabled` at `opacity:.6` (line 167).
- Short ingredient chips are tinted `#ffab8f` (line 176).
- "No room in inventory" appears inline (line 338).
- The have/need order matches C12. **[VERIFIED: lines 528, 167, 176, 338; chip text is `${owned}/${need}` on line 333]**

**Moving items**
- Click picks up and click places. Right-click takes half or places one (line 545). Drag moves, and shift-drag moves half (line 571). **[VERIFIED]**
- There is no shift-click quick-move between the hotbar and the backpack. **[VERIFIED: the click handler (line 525) never reads shiftKey]**

**Craft feedback**
- `game.js:546` emits "Crafted X" through `notice()` (`game.js:394`, which lasts 1800 ms) plus a 560 Hz beep (`game.js:530`).
- `updateContext` only draws notices when `running && !dialog` (`game.js:403`), and `uiBlocked()` is true while the inventory is open (`game.js:231`). **[VERIFIED: line 403 is `if (running && !dialog) {`; the caller passes `dialog = uiBlocked()` (line 822, `updateContext(dialog)` on 841), and `uiBlocked` includes `survivalUI?.isOpen`. Lines 394, 530 and 546 are also correct]**
- **So a craft made inside the inventory gives no visible message.** The player gets the beep, the count change and a notice that runs out unseen. **[VERIFIED]**
- `#toast` is `display:none` while playing (`graphics.css:382`).
- There is no pickup feed like C15. **[VERIFIED: `graphics.css:382` hides `#toast` under `body.playing`]**

**Other**
- Hotbar: 8 slots of 58 px (line 122). At 1280x720 that is about 506 px (39.5% W, matching C17), with slots 8.1% H tall (C17 is 6.25%). Slot sizes are fixed px with no viewport scaling. **[VERIFIED: rendered HUD bar 506 px wide, slots 58 px]**
- The inventory opens with Tab or I (survival-ui.js:618). **[VERIFIED]**
- `crafts.js` holds only the 3D models of the 6 placeable crafts (sail, palm, lantern, net, bench, crate; `createCraft`, line 10). A placed crate is decoration only and has no storage (`game.js:27`). **[VERIFIED: `DECOR_TYPES` on game.js:27; crate is only drawn as a box (game.js:363)]**
- `index.html:8` still has the old "SHARED SUPPLIES" counter (wood, leaves, scrap). `index.html:10` has the `.tools` toolbar that survival-ui replaces. **[VERIFIED]**

## 4. Ranked change list

**#1 Show craft and pickup feedback while the inventory is open.**
- Where: `dist/survival-ui.js`, `dist/game.js`.
- Add a small feed inside the inventory dialog, plus a HUD feed at the bottom right (about 87-99% W, 90-97% H, C15).
- Each line reads "+1 [icon] Name". Lines stack upward, last about 2.5 s and fade out. Show at most 4 lines.
- In `game.js:403` let notices of kind `craft` reach the feed even when `uiBlocked()` is true.
- Briefly flash the slot that received the crafted item, using the existing `sv-over` styling, for about 400 ms.
- Impact H, effort S. **[VERIFIED: refs correct; no Raft art copied]**

**#2 Make slots readable: light wells on a darker panel, in Little Raft's own palette.**
- Where: `dist/survival-ui.js` CSS, lines 123, 135, 144 and 151-152.
- The empty-slot fill should be a light sand or sea-foam tone, at least 2.5:1 against the section (Raft's is about 3:1, C7). Icon ink `#153e49` should then reach at least 4:1 against it (today 1.0:1).
- This also suits Little Raft's light "paper and ink" HUD (`style.css:2`, `--paper #f4fcf8`, `--ink #113e47`). Do not use Raft's parchment browns.
- Keep the selected state as a thicker light rim (C10), not a fill change.
- Impact H, effort S. **[VERIFIED: lines and style.css:2 tokens correct; contrast target unchanged by the 1.22 to 1.1 correction; asks for Little Raft's own palette]**

**#3 Stop the recipe list from hiding recipes.**
- Where: `dist/survival-ui.js`, lines 145 and 161-170, and `buildRecipes()` on line 303.
- Add 3-4 category tabs at the top of the crafting column, for example Tools, Materials, Raft, Comfort. Add a `cat` field to `RECIPES` in `inventory-state.js:44`.
- Or use compact 40-44 px rows so all 10 fit within 520 px. The rule: every recipe must be visible without scrolling at 1280x720.
- Raft's model is a rail plus list (C3, C5). With 10 recipes, tabs are enough.
- Impact H, effort M. **[VERIFIED: 10 x 44 px rows + 9 x 6 px margins + 18 px padding = 512 px, fits 520]**

**#4 Add a fixed item-info strip at the top of the bag.**
- Where: `dist/survival-ui.js` `mountDialog()` (line 209) and `showTip` (line 444); `dist/inventory-state.js` `ITEM_INFO`.
- Add a `desc` string to each `ITEM_INFO` entry (one kid-friendly line, for example "Tie things together. Made from palm leaves.").
- Render the icon, name, description and count or durability in a strip above `.sv-grid`, about 30-35% of the bag height (C11). **[CORRECTED: was about 25%, following the C11 correction to ~35%; `mountDialog()` starts on line 197, and its markup is built on line 209]**
- Fill it on hover and on keyboard focus. Show "Hover an item to see what it does" when nothing is hovered.
- Keep the cursor tooltip only for recipe ingredient chips, or remove it.
- Impact M-H, effort S. **[CORRECTED: see the strip-height item above]**

**#5 Fix the grid shape so the backpack and hotbar line up.**
- Where: `dist/inventory-state.js` line 5 (`SLOT_COUNT`) and the constructor length check (line 138); `dist/survival-ui.js` line 147.
- Preferred: `SLOT_COUNT = 32`, giving an 8-column backpack of 3 rows above the 8-slot hotbar. The constructor should pad shorter legacy snapshots with `null` instead of throwing.
- Cheaper option: keep 28 and use `repeat(5,52px)` for 5x4 = 20, which matches Raft's 5-wide rhythm (C6, C18). The hotrow is then wider, so centre both rows.
- Either way, no ragged 7/7/6 last row.
- Impact M, effort S-M. **[VERIFIED]**

**#6 Separate choosing a recipe from crafting it, so a misclick cannot spend materials.**
- Where: `dist/survival-ui.js`, line 528.
- Clicking a row selects it and opens a detail area. The detail shows the icon, name, description and a "have/need" row per ingredient (C12), plus one large Craft button.
- Keep a quick path: double-click, or Enter on a focused row, crafts.
- Make the Craft button look clearly different when it is ready (a green-leaning tone) and when it is blocked (a warm red-leaning tone plus a lock or "Need 2 more Rope" text). Do not rely on `opacity:.6` (line 167). Tint the missing-ingredient rows as well (C13).
- Impact M, effort M. **[VERIFIED: generic green/red tones, not Raft's skin]**

**#7 Do not dim the world behind the inventory.**
- Where: `dist/survival-ui.js`, line 140.
- Set the `::backdrop` to transparent or at most 0.15 alpha, and keep the HUD stat bars visible (C1).
- Raft keeps the world bright so you can still see the sea, sharks and items drifting by. Little Raft is co-op, so the other brother's actions stay visible too.
- Impact M, effort S. **[VERIFIED]**

**#8 Put the bag at the screen centre, with crafting to its left.**
- Where: `dist/survival-ui.js`, lines 138-146.
- Anchor `.sv-bag` at 50% W, with its top at about 15-18% H (C2). Let the crafting column sit left of it, docked to the left side (C3).
- This leaves room on the right for a future storage or crate panel (C4).
- Today the dialog is centred as a whole, so the bag's centre drifts right of the screen centre.
- Impact M, effort M. **[VERIFIED: rendered bag centre at x 796 of 1280 (62% W)]**

**#9 Add a shift-click quick-move between the hotbar and the backpack.**
- Where: `dist/survival-ui.js` click handler (line 525), which calls `onMove` to the first free or mergeable slot in the other section.
- Later the same rule can cover bag to crate (C18).
- Impact M, effort S. **[VERIFIED]**

**#10 Highlight the slot that receives a crafted item, and pulse the recipe row.**
- Where: `dist/survival-ui.js` `paintInventory` (line 428).
- When a slot's count goes up after `onCraft`, add a 300-500 ms light ring and a scale animation (1.0 → 1.08 → 1.0). Pulse the recipe row too.
- Honour `prefers-reduced-motion` (line 186).
- This is the in-panel half of #1.
- Impact M, effort S. **[VERIFIED: paintInventory line 428, reduced-motion line 186]**

**#11 Mark newly craftable recipes.**
- Where: `dist/survival-ui.js` `paintRecipes` (line 320).
- When a recipe goes from blocked to craftable after a pickup, show a small dot on the row and on the Tab/I hint until the inventory is opened. This works in place of Raft's "You learned" card (C16), since Little Raft has no research system.
- Impact M, effort S. **[VERIFIED: paintRecipes line 320; original replacement for Raft's card]**

**#12 Make the durability bar thicker and the count easier to read.**
- Where: `dist/survival-ui.js`, lines 130-131.
- The bar goes from 3 px to 4-5 px (about 9% of slot height, C9).
- The count keeps its corner but gets a solid dark backing pill, so it reads on the lighter wells from #2.
- Impact L-M, effort S. **[VERIFIED]**

**#13 Scale slot sizes with the viewport.**
- Where: `dist/survival-ui.js`, lines 122, 147-149 and 185.
- Use `clamp(42px, 6.5vh, 64px)` instead of fixed 52 and 58 px. Raft's slots are about 6-7% H at every resolution (C7, C17). Little Raft's are 7.2% at 720p but only 4.8% at 1080p.
- Impact L-M, effort S. **[VERIFIED: 52/720 = 7.2%, 52/1080 = 4.8%]**

**#14 Let placed crates open a storage panel next to the bag.**
- Where: `dist/game.js` (DECOR_TYPES, line 27), plus a new storage Bag and a docked panel in `survival-ui.js`.
- Reuse the same slot component, with 5 columns (C4, C18).
- Impact M, effort L. **[VERIFIED]**

**#15 Remove the leftover "SHARED SUPPLIES" counter** (`index.html:8`), or move it into the inventory, now that the per-player bag is the source of truth.
- Impact L, effort S. **[VERIFIED]**

## 5. Open questions

- **C5:** I can't confirm from the frames whether empty Raft categories are hidden or locked. 8 against 9 rail buttons only shows that the rail grows.
- **C15 and C19:** notification lifetime and the lack of a craft timer are from memory. The frames are too far apart (≥3 s) to time either.
- **C8:** the stack cap of 20 is the largest count seen in 6 frames. Some items may stack higher. Little Raft's `STACK_SIZE = 20` already matches.
- **C18:** shift-click transfer to storage is from memory, unverified.
- **Equipment row (C6):** Little Raft has no wearables. I recommend skipping it unless equipment is planned.
- **#5:** changing `SLOT_COUNT` affects multiplayer snapshots. Host and guest builds must agree, so ship it with a version bump.
- **#6 against one-click crafting:** players are young (`index.html:11`, "Play with my brother"). One click may be part of the intended feel, so playtest before removing it. Double-click to craft is the compromise.
- **The red "cannot craft" CRAFT button (C13)** appears in only 2 frames (`qVVltzNBaGw_0400`, `qdWZgcjkYNI_0720`). Both are night scenes, so the sampled colours are darker than daytime. **[CORRECTED: the red CRAFT button appears in 12 frames, not 2: `68lj91mBrDI_0210`, `_0219`, `_0238`, `_0244`, `qVVltzNBaGw_0030`, `_0135`, `_0305`, `_0325`, `_0345`, `_0400`, `qdWZgcjkYNI_0640` and `_0720`. Several are daytime. The daytime red is #96462c (`68lj91mBrDI_0210`, mask median around (324,90)), close to the night #94422d, so night barely shifts it]**

## Verification log

Skeptic pass on 2026-11-21. Tag counts in this file: **VERIFIED 63, CORRECTED 14, UNSURE 3**. The 19 numbered claims break down as 13 VERIFIED, 3 CORRECTED (C7, C11, C14) and 3 with UNSURE sub-points from memory (C15 lifetime, C18 shift-click, C19). C5's hidden-vs-greyed inference was already flagged UNSURE by the analyst and is not counted again.

**Method**
- Images: I built 4x4 contact sheets of all 45 yt frames and checked open and closed inventory by eye. I re-measured boxes on gridded 1-4x crops with luminance profiles and run detection. I re-sampled every cited hex as a 3x3 and a 5x5 median (Pillow and numpy). I computed WCAG ratios with the standard relative-luminance formula. I detected the red and green CRAFT states across all 45 frames with a colour mask over x 220-360, y 60-110.
- Code: I read every cited file:line. I rendered `dist/survival-ui.js` with the real `Bag` in headless Chrome at 1280x720 and 1920x1080 (a harness in scratch, served locally) and measured `.sv-craft` clientHeight/scrollHeight, rows, grid columns and row counts, wrap, bag and hotbar sizes, and the computed `::backdrop`.
- Contrast from the actual CSS: I alpha-composited `#3a2716eb` over the `.sv-wrap` gradient (#b48d55 to #8a663a), then the slot gradient `#5a3f28e8` to `#3d2a19e8` over that. Results: empty slot against section 1.03-1.33 (midpoint 1.10), not 1.22. Ink #153e49 against slot 1.00-1.18, which confirms 1.0:1. Ink against `style.css` `--paper` #f4fcf8 is 11.2:1, so the #2 direction is sound. In the HUD hotbar (#9a7643 to #6a4a2a background), slot against background is 1.4-2.5:1 and ink against slot is about 1.1:1.
- Scratch: `/tmp/claude-0/-home-user-little-raft/357b287e-6b25-59b7-a94d-bb803559ea72/scratchpad/inventory-crafting/skeptic/` (samp.py, grid.py, contrast.py, web/h.html harness, crops).

**Images re-checked:** `stills/steam/store_04.jpg` (and byte-identical `stills/press/steam-store-04.jpg`), `stills/wiki-items/storage-large-ui.jpg`, `stills/press/2021-06-24-hotfix-13-01-01.jpg`, and yt `68lj91mBrDI_0110`, `_0149`, `_0210`, `9qt0eezZZMs_0012`, `qVVltzNBaGw_0400`, `_0455`, `qdWZgcjkYNI_0140`, `_0640`, `_0720`, `_0945`, `_1045`, plus all 45 on contact sheets.

**Corrections that matter**
1. The dialog is about 830 px wide (65% W), not 770 px. The bag centre sits at 62% W, which strengthens #8.
2. Empty-slot/section contrast is about 1.1:1, not 1.22:1, and Raft's is 3.07:1, not 2.99:1. Neither changes the #2 recommendation.
3. The recipe list cap (520 px) and needed height (652 px measured; about 650 claimed) are confirmed. Exactly 2 recipes are hidden at both 720p and 1080p.
4. `game.js:403` gating is confirmed, so the in-inventory craft notice really is invisible.
5. The 7-column, 20-slot, 7/7/6 layout is confirmed in the rendered DOM.
6. Smaller fixes: the frame and still counts (45, 42, 174, 283), C14 rows (12, not 13), the C11 strip height (about 35%, not 27%), the C7 540p slot size (33 px, with 36.7 px as the pitch), and the red CRAFT frames (12, not 2, and not only night).

**Ranking:** no change item depends on a claim that flipped. The order stays the same. Originality guardrail: every change item uses Little Raft's own palette and generic states. None asks to copy Raft's art, icons, fonts or skin, so no rewrite was needed.

