# Aspect: UI typography and panels

Scope: text sizes (as % of screen height, H), weight and case, panel fill and opacity, borders, corner radii, slot sizes and gaps, icon padding, the item info / tooltip layout and contrast ratios. This covers the in-game HUD text (prompts, pickup feed, hotbar) and the inventory/crafting panels. Stat bars, crosshair and HUD placement are only touched where they share a panel style.

Raft (Redbeet Interactive) is studied here only as a reference. Nothing in the change list copies its font, skin, icons or colours. Each change is a functional or legibility goal, to be met in Little Raft's own style.

Method: measurements were taken with Pillow and numpy (scripts in `scratchpad/ui-typography-panels/`: `prof.py` for edge profiles, `rows.py` for text row occupancy, `text.py` for the text box and fg/bg, `samp.py` for 5x5 median hex, `contrast.py` for WCAG ratios). Text size is given as **cap height** (the height of an uppercase letter) in % of H. As a rough guide, font-size ≈ cap height / 0.7. Colours are 5x5 medians at the stated pixel. All sources are JPEGs, so measured text colours are softened and **contrast figures for Raft are lower bounds**.

## 1. Images examined

High-resolution (1280x720) stills, the main measurement sources:
- `stills/steam/store_04.jpg`: crafting rail, recipe card, inventory grid and hotbar. This is the primary panel source.
- `stills/steam/store_16.jpg`: build-cost chip and key-cap hints.
- `stills/steam/community_063.jpg`: E key-cap prompt above the crosshair, pickup feed, hotbar with TAB/T tabs.
- `stills/steam/community_147.jpg`: three stacked pickup toasts on a dark night frame.
- Contact sheets of `stills/steam/store_01..24` (24 frames) were scanned for HUD and menu content.

YouTube frames (960x540) in `inventory-crafting/yt/`, all 46 viewed as contact sheets **[CORRECTED: the folder holds 45 .jpg frames plus a SOURCES.md, so 45, not 46]**:
- Measured: `68lj91mBrDI_0119.jpg` (full layout), `68lj91mBrDI_0149.jpg` ("You learned" card), `qVVltzNBaGw_0030.jpg` (unaffordable state), `qVVltzNBaGw_0455.jpg` (+1 pickup), `qdWZgcjkYNI_0905.jpg` (hotbar, selection and durability).
- The `9qt0eezZZMs_*` frames are zoomed by the video author. They are used only for layout patterns, never for % sizes.

Reference lists: `hud/SELECTED.md` (present, and used for picks #1, #2, #3, #4, #9, #12 and #27). `menus/SELECTED.md` did not exist when this was written. **[CORRECTED: `references/raft/menus/SELECTED.md` exists now; the menu typography comparison can be done from it]**

Little Raft code read: `dist/style.css`, `dist/graphics.css` (it re-skins most of style.css), `dist/index.html`, `dist/survival-ui.js`, the HUD_CSS and prompt code in `dist/game.js` (lines 45-52 and 394-412), and the CSS in `dist/settings.js` (lines 40-60).

## 2. Observations / spec (Raft)

### Layout and proportions

**C1. The UI scales with screen height.** Panel and slot proportions are the same at 540p and 720p.
- Inventory panel width is 20.1% W in `68lj91mBrDI_0119` (x387-580 of 960) and 20.0% W in `store_04` (x517-773 of 1280).
- Inventory slot pitch is 6.7% H (36/540) and 6.8% H (49/720).
**[VERIFIED: edge profiles give x386-580 (20.2% W) and x516-772 (20.1% W); pitch 36.5 px/540 = 6.8% H and 48-49 px/720 = 6.8% H]**

**C2. Inventory slot spec** (`store_04`, column 560 and visual check):
- Slot: 43 px = 6.0% H.
- Gap: 5-6 px = 0.8% H.
- Pitch: 49 px = 6.8% H.
- Grid: 5 columns. Icons fill about 75-80% of the slot, so the padding is about 10-12% of the slot per side.
- `68lj91mBrDI_0119`: slot 33 px = 6.1% H, gap 3-4 px = 0.7% H.
**[VERIFIED: store_04 slots x524-568, 573-617 ... and y259-302, 308-351, so 43-44 px, gap 5 px, pitch 48-49 px; 0119 slots x394-426, 430-462, so 33 px with 3-4 px gaps]**

**C3. The hotbar is 10 slots.**
- Slot strip: x383-887 = 39.4% W in `store_04`, and x297-663 = 38.1% W in `68lj91mBrDI_0119`. Including the end tabs it is 43.6% W.
- Pitch: 48.8 px = 6.8% H. Slot: about 44 px = 6.1% H.
- The bar sits almost flush with the bottom edge: the frame top is at y662 and the slot bottom at y715 of 720, so the bottom margin is ≤0.7% H.
- The end tabs carry tiny "TAB" and "T" key labels with a cap height of about 1% H (`community_063`, x362-390 and y690-720). They tell the player which key opens the inventory.
**[CORRECTED: strip, pitch, slot (y670-714 = 44 px) and margin re-measure the same (frame x383-888, top y661). The "TAB" label is not 1% H: its glyphs occupy y707-716 = 10 px = 1.4% H, and the frame edge clips them, so 1.4% is a minimum]**

**C4. Crafting is split into three adjacent opaque panels, anchored top-left** (`store_04`):
- Category rail: x17-82 = 5.1% W.
- Recipe list: x90-298 = 16.3% W.
- Recipe card: about x306-475 = 13.3% W.
- Outer margin: 12 px = 1.7% H. Gap between panels: 8 px = 1.1% H.
- Rail icon pitch: 56.6 px = 7.9% H.
- The inventory panel is a separate block, centred horizontally (its centre is at 50.4% W) with its top at 18% H.
- In `68lj91mBrDI_0119` the panel gaps are 3-5 px = 0.6-0.9% H.
**[VERIFIED: the row-180 profile gives edges at 17/82, 90/298 and 306/474; the top rim is at y12-16; the rail tile gaps fall at y70, 127 ... 524, a pitch of 56.75 px; the inventory centre is 50.3% W and its top y129 = 17.9% H]**

### Panel fill, border and radius

**C5. Panels are fully opaque.**
- The inventory panel fill is `#6a4f31` over wood at (540,230) and `#684d2f` over sea at (750,230) in `store_04`, which is the same colour.
- The same fill measures `#6a4e31` in `68lj91mBrDI_0119` (150,100).
- There is no dimming backdrop: the sea and deck behind the panels keep their normal colours in all 46 frames.
**[CORRECTED: the store_04 samples re-measure exactly. In 0119, (150,100) sits beside list text and gives #715436. Clean fill is #694e31 at (480,175) and #694d2f at (200,165), so the conclusion holds. There are 45 frames, not 46]**

**C6. Border, radius and rules.**
- Each panel has a single light rim of 2-3 px (about 0.35% H): `#bba478` at y130-132 in `store_04`, and `#ae9f88` at x384-386 in `68lj91mBrDI_0119`.
- There is no heavy drop shadow.
- The corner radius is about 2-3 px at 720p (≤0.4% H). The corners read as almost square.
- Titles are underlined by a 2 px cream rule (`68lj91mBrDI_0119` y47-48, under "OTHER").
**[CORRECTED: the light rim, about #b9a475 at y130-132 in store_04, is on the TOP edge only. The side edges are a dark 1-2 px line: store_04 y230 drops to luminance 52-65 at x516-517 and x771-772. In 0119, x384-386 is the white cloth behind the panel (#cdc7af to #b4a28c), not a rim, and the panel's left edge is dark (#5c402b). So the edge reads as a top highlight plus a dark outline, not a single light rim. The radius and the "OTHER" underline at y47-48 are confirmed]**

**C7. Slots are lighter than the panel.**
- Empty inventory slots: `#b09560` (store_04 600,330). Empty hotbar slots: `#b79e67` (store_04 560,690).
- The hotbar frame is `#6a492a`.
- Slot-to-panel separation is 2.6:1 (inventory) and 3.1:1 (hotbar), so empty slots read clearly.
**[VERIFIED: the samples match exactly; WCAG ratios recomputed as 2.64:1 and 3.12:1. The inventory-crafting spec gets 2.99:1 from the slot centre #ba9f6a at another pixel; both put Raft's ratio between 2.6 and 3:1]**

### Typography: sizes, weight and case

**C8. Measured cap heights.** "A720" is `store_04` and "A540" is `68lj91mBrDI_0119`.

| Role | Example | Cap height | % H | Case and weight |
|---|---|---|---|---|
| Panel title | "INVENTORY" | 16 px (A720 y142-157); 11 px (A540) | 2.2%; 2.0% | caps, condensed display, bold |
| Section and recipe header | "WEAPONS", "METAL SPEAR" | 14 px (A720) | 1.9% | caps, display |
| Have/need count | "6/6" | 17 px (A720 y158-174) | 2.4% (the largest text) | display numerals, right-aligned |
| Label | "REQUIRES" | 12 px | 1.7% | caps |
| Recipe list item | "BOW AND ARROW" | 11 px (A720 y85-95) | 1.5% | caps, display |
| Ingredient name | "PLANK" | 10 px | 1.4% | caps, dimmer colour |
| Description | "An even greater device for…" | cap about 8 px, x-height 5 px, line pitch 15 px | 1.1% cap, 2.1% line | sentence case, plain sans |
| Slot stack count | "3" | 11 px (A720 y261-271) | 1.5% | numerals, top-left |
| Key-cap prompt label | "HOLD FOR MORE PARTS" (`store_16`) | 12-13 px | 1.7% | caps, cream, outlined, no panel |
| Prompt line (1.0, ru locale) | `community_063` | cap about 10 px, x-height 7 px | 1.4% | sentence case |

So the hierarchy has about four steps: title 2.2%, header 1.9%, label/list 1.5%, body 1.1%. Numbers that matter (have/need) are the largest text on the card. Everything except the body text is all-caps in one condensed display face. That face is a custom typeface (from memory, unverified); it must not be copied.
**[CORRECTED: the same threshold method gives the A720 title as y141-157 = 17 px (2.4%) and "6/6" as y158-174 = 17 px (2.4%). So have/need ties the title rather than being larger; the measurement supports only 16-17 px = 2.2-2.4% for both. The A540 title is y106-117 = 12 px = 2.2% H (was 11 px / 2.0%), which matches A720. "METAL SPEAR" measures 15 px (2.1%), "WEAPONS" 14 px (1.9%), "REQUIRES" 13 px (1.8%). "BOW AND ARROW" (11 px), "PLANK" (10 px), the "3" count (y262-272, 11 px), "HOLD FOR MORE PARTS" (y614-626, 13 px), the description line pitch (15 px) and the ru prompt are confirmed. The identity of Raft's typeface is UNSURE (wiki unreachable)]**

**C9. Colour roles.**
- Primary text is warm cream on brown: about `#c2a77b` on `#6c5031` (A720 title box), up to `#efd6ae` on stack counts.
- Secondary text (ingredient names) is dimmer: `#9c7d58`.
- Green marks "can do / learned": the CRAFT button fill is `#57641f` to `#8d9849` (A720 x398-464, y106-134), and the learned item name is green in `68lj91mBrDI_0149`.
- Red marks shortage. In `qVVltzNBaGw_0030` the CRAFT button turns red (`#7a482b` at 320,90) and the short ingredient row gets a red band (`#91422f` at 275,118).
**[VERIFIED: the title's brightest 5% is #c1a57a on #67492d; the count's brightest 5% is #f0d7af; PLANK is #987a56; the CRAFT box spans #384400 to #94a253; qVVltzNBaGw_0030 re-samples exactly #7a482b and #91422f]**

**C10. Raft's text contrast is modest.** Measured lower bounds: title 3.2:1, list item 3.4:1, slot count 3.5:1, ingredient name 2.1:1, CRAFT label on green about 1.5:1 (too faint to segment). Raft's legibility comes from size and the condensed caps, not from contrast. Little Raft should not inherit those ratios.
**[CORRECTED: recomputed from the colours above. Title 2.9-3.5:1 (consistent). List item "BOW AND ARROW" 2.8-3.0:1 (was 3.4). Slot count about 2.5:1 (was 3.5): the "3" is #f0d7af over the slot tile #a18354, not over the dark panel. Ingredient name 2.0-2.1:1 (consistent). CRAFT label about 1.2:1. The conclusion holds and is stronger]**

### Item info, tooltips and notifications

**C11. No floating cursor tooltip.**
- Item info is a **fixed header block at the top of the inventory panel**: an icon, then the item name in caps at 1.9% H cap, then a 2 px rule, then one sentence-case description line.
- The block takes 17-18% H, about 45% of the panel height (A540 y98-192; A720 y130-260).
- About 15 of the 46 yt frames show a hovered item name there (for example `68lj91mBrDI_0119` "LARGE CROP PLOT / Lets you grow trees", `9qt0eezZZMs_0016`, `qVVltzNBaGw_0345`, `qdWZgcjkYNI_0945`). None shows a cursor-following tooltip.
**[CORRECTED: the header contact sheet shows 17 of 45 frames with a hovered name: 0119, 0137, 0146, 0238, 0244, 9qt 0016/0024/0032, qV 0030/0325/0345/0535, qdWZ 0200/0720/0920/0945/1005. The description is 1-3 lines, not always one (PAINT MILL, SCARECROW, ROPE and YELLOW SEED wrap). In 0119 the name cap is y137-147 = 11 px = 2.0% H. The 45% figure counts from the panel top (title included) to the grid top. The icon-to-rule strip alone is about y162-206 of y129-410 in A720, which is 16% of the panel]**

**C12. The recipe card has a separate action button.**
- The CRAFT button is 5.2% W x 3.9% H in A720. The LEARN buttons are 41x19 px = 3.5% H in A540.
- When ingredients are short, the button colour flips to red (C9). The whole card is not dimmed.
**[CORRECTED: the green mask gives the A720 CRAFT button as x396-465, y107-136 = 70x30 px = 5.5% W x 4.2% H (was 5.2% x 3.9%). LEARN is 39x18 px = 3.3% H (close). The red flip without dimming is confirmed in qVVltzNBaGw_0030]**

**C13. Pickup feed, bottom-right, flush to the right edge.**
- Each row reads "+N [icon] NAME".
- `community_147`: x1114-1280 = 13% W, three rows at 33 px pitch = 4.6% H, translucent dark fill (`#222320` at 1200,612, with the background visible through it).
- `qVVltzNBaGw_0455`: a single row 24 px = 4.4% H at y507-530 of 540.
**[VERIFIED: the fill starts at x1114 (luminance 18 to 34) and #222320 re-samples exactly; the 0455 row is y506-531 from x835. Note: the 0455 chip is an opaque mid-brown, not translucent dark, so the fill varies by version or locale]**

**C14. Prompts.**
- The key-cap is a solid cream rounded square: `#e2cdb2` (community_063 637,282), 22-24 px = 3.1-3.3% H, with a dark glyph and a darker bottom lip.
- The verb sits under the key-cap with no panel behind it. The text is cream `#f6efdc` with a dark outline or shadow, measuring 4.7:1 even over a bright red bird in `community_063`.
- The interact prompt sits **above** the crosshair (key-cap at 39-41% H, text at 44% H). Build hints sit low (80-87% H, `store_16`).
- A cost chip sits just below the crosshair: a parchment chip 3% W x 6.9% H, 33 px below the centre (`store_16`).
**[CORRECTED: the text over the red-orange feather is #fddfc9 on #b8503f = 3.9:1, not 4.7:1. Over the dark-blue part it is 8:1. #e2cdb2, the key-cap size (about y277-299), the positions and the chip (x621-659, y393-443, so 3.0% W x 6.9% H, 33 px below centre) are confirmed]**

**C15. Research toast, top-right** (`68lj91mBrDI_0149`): x787-950, y15-60, so 17% W x 8.3% H with a 1.6% W right margin. It has two lines: a caps title with a green item name, then a dim sub-line.
**[CORRECTED: the box re-measures as x786-950, y15-61, but the right margin is 960-950 = 10 px = 1.0% W, not 1.6%]**

**C16. Durability and selection in slots.**
- The durability bar is 3-4 px = 0.6% H, about 80% of the slot width, light green `#bcd06d` (qdWZgcjkYNI_0905 y532-535).
- The selected slot gets a 2-3 px cream outline or underline: `#ebd0a5` at y536-538 in qdWZgcjkYNI_0905, and `#f6debc` in store_04 x383-388.
**[CORRECTED: the durability bar (y532-535, #bbd06b, x303-330 = about 80%) and the 0905 underline (#e9d1a5 at y537) are confirmed. In store_04, x383-388 is the hotbar frame and TAB tab (#bda58b), not the selection. The selected slot there is slot 5 (x592-638): a cream edge #e7c798 at x592 and an underline #e9cca4 at y715-717. The store_04 durability bar is y395-399 = 4-5 px = 0.6-0.7% H]**

## 3. Little Raft today

### Fonts: 4-5 stacks, and the loaded web fonts are mostly overridden

- `style.css:1` imports DM Sans and Outfit from Google Fonts (render-blocking). **[VERIFIED]**
- `graphics.css:25-27` then sets the root to `--ui-font` (Bahnschrift, then Segoe UI Variable, Segoe UI, Helvetica, Arial). Bahnschrift exists only on Windows, so macOS and Linux players get Helvetica or Arial. **[VERIFIED]**
- `--display-font` is a Palatino/Georgia serif, used for h1, h2 and the brand (`graphics.css:60,263,295`). **[VERIFIED: also used at :65 and :75]**
- `survival-ui.js:115` uses its own `'Segoe UI',system-ui` for the whole hotbar, inventory and tooltip. **[VERIFIED: survival-ui.js:89 also hard-codes Segoe UI in an SVG label]**
- `game.js:49` (`#contextPrompt`) uses system-ui, and `settings.js:44,47` uses system-ui plus Georgia. **[VERIFIED]**
- `graphics.css:375` forces `'Segoe UI'` on the tool labels. **[CORRECTED: the rule is at graphics.css:376 (`.tools button em{font:600 10px/1.15 'Segoe UI'…}`); :375 is `.tools button.selected`]**

Net result: the HUD and inventory, which are the in-game text, render in the OS default font. The two web fonts only reach a few `kbd` elements (`style.css:2,17`). **[CORRECTED: DM Sans reaches only `.guide kbd` (style.css:17), because the style.css:2 `:root` font is overridden by graphics.css:27. Outfit reaches nothing: its only use, style.css:5 `.tools button>em`, is overridden by graphics.css:376]**

### All sizes are fixed px, so nothing scales with H

| Element | Current value (file:line) | % H at 1080p | % H at 720p | Raft (C8) |
|---|---|---|---|---|
| Hotbar slot | 58 px (`survival-ui.js:122`) | 5.4% | 8.1% | 6.1% |
| Inventory slot / gap | 52 / 6 px (`survival-ui.js:147-149`) | 4.8% / 0.6% | 7.2% / 0.8% | 6.0% / 0.8% |
| Recipe name | 700 14px (`:172`), cap about 9.8 px | 0.9% | 1.4% | header 1.9% |
| Requirement count | 600 13px (`:174`) | 0.85% cap | 1.3% | have/need 2.4% |
| Hint text | 500 12px (`:160`) | 0.8% | 1.2% | body 1.1% |
| Tooltip name / sub | 700 14px, 500 12px (`:181,183`) | 0.9% / 0.8% | 1.4% / 1.2% | info header 1.9% |
| Slot count / number | 700 14px / 700 11px (`:130,127`) | 0.9% / 0.7% | 1.4% / 1.1% | 1.5% |
| Context prompt | 600 13px (`game.js:49`) | 0.85% | 1.3% | 1.4-1.7% |
| Panel titles | **none**: the inventory dialog has no "Inventory" or "Crafting" heading (`survival-ui.js:209-218`) | none | none | 2.2% |

**[VERIFIED: every file:line and px value matches the code. The % figures use cap ≈ 0.7 x font-size, as the header says. In the Raft column, read title as 2.2-2.4% and have/need as 2.4% (C8 correction)]**

At 1080p every in-game text role is 40-60% of Raft's relative size. At 720p it is close to Raft. On large monitors the UI looks tiny and the hierarchy is flat: the recipe name, requirement count, tooltip name and slot count are all 13-14 px. **[VERIFIED]**

### Panels: two competing skins and many radii

- **Navy skin.** "Lacquered navy" plates use `rgba(9,20,30,.80)` with a blur and a bronze frame (`graphics.css:8,38-48`) for the supplies, goal, recipes, toast and durability panels. **[VERIFIED: the selector at :37-38 is `.inventory,.goal,.tools,#recipes,#durability,.durability-meter`; #toast is not in it]**
- **Wood skin.** The hotbar uses a wood gradient (`#9a7643` to `#6a4a2a`) with a `#c9a66b` border (`survival-ui.js:117-119`, repeated in `graphics.css:373`). The inventory dialog uses a striped wood frame (`#b48d55` to `#8a663a`, a 3 px `#3e2a17` border plus a 2 px `#d6b67e` ring, radius 6) with dark inner wells `#3a2716eb` (`survival-ui.js:141-145`). **[CORRECTED: graphics.css:373 is not a repeat. It is a different `.tools` gradient (`#987944`→`#6f4e2c`, border `#c4ac71`, radius 5) that `.tools.sv-hotbar` overrides, so it is dead styling. The survival-ui.js values are confirmed]**
- **Other skins.** The context prompt is navy `rgba(8,22,36,.55)` with radius 8 (`game.js:48-49`). The aim hint is teal `#162e3199` (`graphics.css:383`). The settings dialog is navy `rgba(13,29,52,.9)` with radius 14 and Georgia (`settings.js:41-47`). **[VERIFIED]**
- **Radii in use:** 2, 3, 4, 5, 6, 7, 8, 9, 10, 14 px, plus a 12 px base in `style.css:2`. Raft uses one radius of about 0.4% H. **[CORRECTED: the list understates the spread. A grep of the five CSS sources also finds 1, 13, 16, 17, 18, 19, 25, 30 and 50 px and 50%. Most come from the welcome and dialog UI, but they reinforce #10]**

### Slot legibility

- Inventory slots (`#4b3420` average, from `#5a3f28` to `#3d2a19`) on the inner well (`#3a2716`, alpha .92): **1.22:1**. Empty slots almost vanish into the panel. Raft: 2.6:1 (C7). **[CORRECTED: 1.22:1 compares the unblended hexes. Compositing the slot (alpha .91) over the well (alpha .92 over the #b48d55→#8a663a frame) gives 1.03-1.33:1, about 1.1:1 mid-gradient. It is worse than stated]**
- Hotbar slots on the hotbar frame: 2.0:1. **[VERIFIED: composited, it varies with the two gradients from 1.2:1 to 3.0:1, about 1.6-2.2:1 mid-height]**
- The selected hotbar slot (`#b3925a`, `survival-ui.js:135`) under the count text `#fff2cc`: 2.6:1, which relies on the text-shadow. **[CORRECTED: 2.62:1 uses the gradient's top colour, but `.sv-count` sits at the bottom right (`:130`). Over the composited bottom colour (#8a6a3ccc → #846438 to #8d6c3d) the count is 4.3-4.9:1. The real weak spot is the top-left slot number `.sv-num` (#f3e4c2, 11 px, `:127`) at 2.5-2.8:1]**

### Text contrast is good on solid panels and weak on translucent ones

- Inventory text `#fff2cc` / `#eadcbe` on the dark wells: 7.8-10.4:1. The short-ingredient colour `#ffab8f`: 5.8:1. This beats Raft (C10) and should be kept. **[CORRECTED: on the composited well (#402c19 to #442f1b) the text is 9.3-11.8:1. On the recipe-row gradient (#5d4129→#4a3220, where the requirements actually sit) it is 6.9-10.7:1. #ffab8f is 5.1-7.2:1, but a disabled row's opacity:.6 cuts it to 2.9-3.4:1. The conclusion stands]**
- `#contextPrompt` (`#f6ecd6` on `rgba(8,22,36,.55)`) falls to **3.46:1** over a white sky or sail. The aim hint `#f4eddd` on `#162e3199` falls to **3.43:1**. Both are below 4.5:1 for 13 px text. **[VERIFIED: recomputed 3.46:1 and 3.43:1 over #fff; over the default sky #87d8df they are 4.86:1 and 4.60:1]**

### Item info and tooltip

- `survival-ui.js:180-183` and `444-458` add a cursor-following tooltip: name plus "count / max" or "Durability N%". **[VERIFIED]**
- The tooltip has no description. When a slot is hovered, nothing in the panel itself shows what the item is. **[VERIFIED: `ITEM_INFO` (inventory-state.js:13) has no description field either]**
- Recipes use the whole row as the button (`survival-ui.js:161-167`). A recipe that cannot be made becomes `opacity:.6`, which dims the ingredient counts the player needs to read. There is no separate affordance for "craftable". **[VERIFIED]**

### Notifications

- While playing, `#toast` is hidden (`game.js:46`, `graphics.css:382`). Every toast and every loot event goes through `notice()`, which writes into the single `#contextPrompt` under the crosshair (`game.js:394-411`, loot text at `game.js:562`). **[VERIFIED: notice() is game.js:394, the event→notice path is :529, the loot emit is :562]**
- So a pickup message ("+ 2 Plank · 1 Leaf") **replaces** the "E Pick up" prompt for 1.8 s. Prompts and loot compete for one 13 px line. **[VERIFIED: notice's default ms is 1800 and it takes priority over pickTarget in updateContext]**

### Grid shape

The backpack is 20 slots in **7 columns** (`survival-ui.js:147`, with TOTAL 28 and HB 8), so the last row has 6 of 7 slots and looks ragged. Raft uses 5 columns (C2). **[VERIFIED: TOTAL and HB come from inventory-state.js:5-6]**

### Discoverability

The hotbar has no key hint for the inventory. The controls strip that would show one is hidden while playing (`game.js:47`, `graphics.css:382`). Raft labels the hotbar end tabs (C3). **[VERIFIED: the only hint is in the help dialog (game.js:272: E, Tab or I). Tab/I is handled at survival-ui.js:615-618]**

## 4. Ranked change list

**#1 One type system, scaled by viewport height** (`dist/graphics.css` `:root` lines 25-26; `dist/survival-ui.js:115` FONT; `dist/game.js:49`; `dist/settings.js:44,47`; `dist/style.css:1`).
- Define tokens and use them everywhere. Replace the `FONT` constant and the system-ui stacks with `var(--ui-font)`, and point headings at `var(--display-font)`.
  - `--fs-title: clamp(16px, 3.0vh, 34px)` (cap ≈ 2.1% H)
  - `--fs-head: clamp(14px, 2.5vh, 28px)`
  - `--fs-label: clamp(12px, 2.0vh, 22px)`
  - `--fs-body: clamp(12px, 1.7vh, 19px)`
  - `--fs-num: clamp(15px, 3.2vh, 36px)` for have/need counts
- Choose two original, freely licensed faces and self-host them, or load them from the existing Google Fonts import:
  - A **condensed humanist display face** for caps titles, counts and key labels (for example Barlow Condensed 600/700 or Saira Condensed). Use caps with `letter-spacing: .04em`.
  - A **plain humanist sans** for sentences (keep DM Sans, which is already imported).
- Drop Outfit, the Bahnschrift-first stack and the Palatino serif from the in-game UI.
- Impact H, effort M.
**[VERIFIED: the file:line targets exist (FONT at :115, plus the SVG label at survival-ui.js:89). Originality check: Barlow Condensed, Saira Condensed and DM Sans are SIL OFL Google Fonts with smooth, regular grotesk strokes. Raft's caps in store_04/0119 (crops of "INVENTORY" and "OTHER") have irregular, hand-cut terminals, so these picks are original choices and not Raft's face. Raft's exact font name is UNSURE (wiki unreachable). Keep the title colour in Little Raft's own palette rather than cream-on-brown, so the condensed caps do not echo Raft's look]**

**#2 Scale slots with height** (`dist/survival-ui.js:122,137,147-149,185`).
- Hotbar slot: `--slot: clamp(44px, 6.2vh, 72px)`, gap `calc(var(--slot)*.12)`.
- Inventory slot: `clamp(40px, 6.0vh, 68px)`, gap 0.8vh.
- Icon inset: 14% of the slot (today it is a fixed 8-9 px).
- Target hotbar strip width: 36-40% W at 16:9.
- Impact H, effort S.
**[CORRECTED: the 36-40% W target is Raft's width for 10 slots. Little Raft has 8 (HOTBAR_SIZE = 8), and 8 x 6.2vh + 7 gaps ≈ 55vh ≈ 31% W at 16:9. Change the target to "about 30-32% W at 16:9" unless the hotbar grows to 10 slots. Conflict: docs/specs/inventory-crafting.md #13 proposes a single `clamp(42px, 6.5vh, 64px)` for both. Pick one set of tokens; this aspect's split values (hotbar 6.2vh, bag 6.0vh) match Raft's 6.1%/6.0% H more closely]**

**#3 Make empty slots read against the panel** (`dist/survival-ui.js:123,144,151`). Raise slot-to-well contrast from 1.22:1 to ≥2.5:1. In Little Raft's own palette, either lighten the wells or put lighter, sun-bleached slot tiles on a darker frame. Keep the icon-to-slot contrast ≥3:1. Impact H, effort S.
**[VERIFIED: the composited baseline is about 1.1:1, so the gap is larger than stated. The direction agrees with inventory-crafting.md #2 (≥2.5:1, icon ink ≥4:1). Use the stricter icon target of 4:1 from that spec]**

**#4 Fixed item-info header in the inventory instead of (or as well as) the cursor tooltip** (`dist/survival-ui.js:209-218` markup, `444-458` showTip).
- Add a block at the top of `.sv-bag`, about 16% of the panel height: a 40 px icon, the name in display caps at `--fs-head`, a 2 px rule, and a one-line description in `--fs-body`. The description comes from `ITEM_INFO[kind].desc`, falling back to count / durability.
- Fill the block on hover, focus and pick-up.
- Keep the tooltip only for pointer users, or remove it.
- This is also better for keyboard and screen-reader users.
- Impact H, effort M.
**[VERIFIED: 16% matches the icon-to-rule strip measured in store_04 (about y162-206 of a y129-410 panel). Conflict: inventory-crafting.md C11 and #4 say "about 27%" and "25% of the bag height", but its own numbers (y160-205 of 131-411) also work out to 16%, so that spec's percentage is the error. `ITEM_INFO` has no `desc` yet, so add the field. Allow 2 lines of description, not 1 (C11 correction)]**

**#5 Split pickups from prompts** (`dist/game.js:394-411,529,562`).
- Send `kind:'loot'` events to a new bottom-right feed, not to `notice()`.
- Feed spec: rows of "+N [icon] Name", up to 3 stacked, row height 4.5% H, width 12-14% W, right margin 1.5% W, bottom at the hotbar's top line. Each row lives 2.5 s, then fades out over 0.3 s.
- `#contextPrompt` then only shows actions.
- Impact H, effort M.
**[VERIFIED: the line refs are correct and the geometry matches C13. Raft's feed is flush to the right edge (0% margin); 1.5% W is a reasonable original choice. The 2.5 s life is a design value, not a Raft measurement. This item agrees with inventory-crafting.md #1]**

**#6 Key-cap prompts with stronger contrast** (`dist/game.js:48-51`).
- Render `<kbd>` as a solid light cap (≈3.2% H tall, dark glyph, 2 px darker bottom lip) instead of an outline.
- Set the verb in `--fs-label`. Either drop the 55% navy pill and use a 1 px dark text outline plus a 6 px soft shadow, or raise the pill's alpha to ≥.75 so it stays ≥4.5:1 over a white sky (today 3.46:1).
- Consider moving the interact prompt above the crosshair (≈44% H) so loot and charge UI below it never overlap.
- Impact M-H, effort S.
**[VERIFIED: alpha .75 over #fff gives 6.99:1. Originality: a solid key-cap is a generic convention. Draw it in Little Raft's own palette and shape (for example its sea-foam or sand tone), not as Raft's cream square]**

**#7 Recipe card hierarchy** (`dist/survival-ui.js:161-178,307-311,336`).
- Recipe name in `--fs-head` caps.
- Have/need numbers in `--fs-num`, tabular, right-aligned on their own row per ingredient, about 1.3x the name size.
- Shortage shown as a tinted row band plus colour on the number (keep `#ffab8f`-like ≥4.5:1), not as `opacity:.6` on the whole card.
- Add an explicit "Craft" button per selected recipe: about 5% W x 3.8% H, with clearly different enabled and disabled fills, and the disabled label still ≥3:1.
- Impact H, effort M.
**[VERIFIED: the targets exist. Raft's button measures 5.5% W x 4.2% H, so "about 5% x 4%" is fine. This overlaps inventory-crafting.md #6 (select, then Craft). Implement both together]**

**#8 Add panel titles** (`dist/survival-ui.js:209-218`). Add "Crafting" and "Backpack" headings in `--fs-title` display caps, each with a 2 px rule underneath. This gives the dialog the missing top step in the hierarchy. Impact M, effort S. **[VERIFIED]**

**#9 Backpack grid to 5 or 10 columns** (`dist/survival-ui.js:147,185`). With 20 backpack slots, `repeat(5, var(--slot))` (4 full rows) or `repeat(10, …)` (2 rows that match the hotbar width) removes the ragged 7-column last row. Impact M, effort S.
**[CORRECTED: 10 columns do not match the hotbar width. Little Raft's hotbar and `.sv-hotrow` have 8 slots (HB = 8), so a 10-wide bag would overhang it by 2 slots. Conflict: inventory-crafting.md #5 prefers 8 columns with SLOT_COUNT raised to 32 (3x8 above the 8-slot hotrow), and offers 5 columns (5x4, centred) as the cheaper option. Recommend: 5 columns now, since it needs no data or multiplayer-snapshot change and matches Raft's 5-wide rhythm; adopt 8 columns only if SLOT_COUNT changes. Drop the 10-column option. Also update the `@media` copy at :185]**

**#10 One panel skin and one radius** (`dist/graphics.css:8,38-48,373,377,383`; `dist/survival-ui.js:117-119,141-145`; `dist/game.js:48-49`; `dist/settings.js:41-47`).
- Choose either the navy-and-bronze plates or the wood. Little Raft's own wood look suits the raft; keep the navy for menus only if it is clearly a different layer.
- Use one in-game panel recipe: opaque or ≥.92 fill, a single 1-2 px light rim, and `--radius: clamp(3px, .4vh, 5px)`.
- Remove the striped double frame, the extra 2 px ring and the 8, 9, 10 and 14 px radii.
- Impact M, effort M.
**[VERIFIED: the line refs exist (graphics.css:373 is the dead `.tools` wood rule). Given the C6 correction, "a single light rim" is an original choice, not a copy of Raft, whose panels have a top highlight with dark sides. Either works]**

**#11 Inventory key hint on the hotbar** (`dist/survival-ui.js` ensureTools, `:344-361`). Add a small end tab on the left of the hotbar reading "Tab" (and "I"), using a key-cap at about 1.4% H cap. Today nothing in play mode says how to open the inventory. Impact M, effort S.
**[VERIFIED: ensureTools is at :344. Raft's TAB label is about 1.4% H (C3 correction), consistent with this item. Originality: render it as a Little Raft key-cap chip, not Raft's notched end-tab shape]**

**#12 Clearer selected slot** (`dist/survival-ui.js:135`). Keep the fill change. Add a 3 px light outline or underline (≈0.3% H) that is ≥3:1 against both the slot and the frame. Raise the count text contrast on the selected fill: it is 2.6:1 today, so darken the selected fill or add a dark count plate. Impact M, effort S.
**[CORRECTED: the count (bottom right) is already 4.3-4.9:1 on the selected gradient's bottom. The text under 3:1 is the top-left slot number `.sv-num` (`:127`, #f3e4c2, 2.5-2.8:1 on #b3925a). Retarget the second half: give `.sv-num` a dark plate or darken the top of the selected gradient. The outline part stands. Impact lowered to L-M]**

**#13 Lighter inventory backdrop** (`dist/survival-ui.js:140`). Change `rgba(12,9,5,.42)` to about `.22`. Raft keeps the world fully visible (C5), which helps with "what am I standing next to" while crafting. Impact L, effort S.
**[CORRECTED: the value at :140 is confirmed. To avoid two different numbers, align with inventory-crafting.md #7, which asks for "transparent or at most 0.15 alpha". Use ≤.15 (Raft has none)]**

**#14 Bottom margin and stacking** (`dist/graphics.css:111`). Set the hotbar bottom margin to `clamp(6px, 1vh, 14px)` (Raft ≤0.7% H). Raise the pickup feed and any prompts by `var(--slot)` plus a gap, so they never overlap the hotbar. Impact L, effort S. **[VERIFIED: `.bottom{bottom:20px}` is at graphics.css:111 (and 14px at :334 in the media query)]**

**#15 Remove dead font weight** (`dist/style.css:1`). After #1, import only the two faces and weights you actually use (about 4 files instead of 9). Use `font-display: swap` and preconnect, or self-host. Impact L, effort S. **[VERIFIED: 4 DM Sans weights + 5 Outfit weights = 9; `display=swap` is already in the URL]**

## 5. Open questions and UNSURE items

- **Cap-height to font-size factor.** The 0.7 factor is an estimate. Condensed display faces often have taller caps (0.72-0.75), so confirm the clamp values on screen at 1280x720 and 2560x1440. **[UNSURE: depends on the chosen font's metrics]**
- **Raft contrast.** The ratios are lower bounds from JPEG; the real game text is likely 0.5-1.0 higher. The direction of the finding (Raft relies on size, not contrast) still holds. **[VERIFIED for the direction; the size of the JPEG penalty is UNSURE]**
- **Equipment row.** Raft's dark row of 5 slots under the inventory grid (`store_04` y410-454; `68lj91mBrDI_0119` y304-341) looks like an equipment row (from memory, unverified). Little Raft has no equipment slots, so this was not specced. **[UNSURE: wiki unreachable. qVVltzNBaGw_0030/0455 show only 3 such slots, so the count varies]**
- **Description data.** `ITEM_INFO` may not carry descriptions yet. Change #4 needs a one-line `desc` per item; inventory-state.js was not checked in detail. **[VERIFIED: ITEM_INFO (inventory-state.js:13) has name and icon only, with no desc]**
- **Pickup feed fade time.** The 2.5 s life is from memory (unverified). No frame sequence shows a toast fading. **[UNSURE: wiki unreachable]**
- **Menus.** `menus/SELECTED.md` was absent, so the title-screen and pause-menu typography was not compared against Raft. The welcome screen and dialogs (`graphics.css:259-300`) are out of scope here, apart from the radius and font unification in #1 and #10. **[CORRECTED: menus/SELECTED.md now exists; the comparison is still not done]**
- **Font choice.** This is a creative decision. Any condensed caps face with open counters works. Avoid stencil or hand-cut faces that would echo Raft's own face. **[VERIFIED: consistent with the originality check in #1]**

## Conflicts with docs/specs/inventory-crafting.md

| Topic | This aspect | inventory-crafting.md | Resolution |
|---|---|---|---|
| Backpack columns | #9: 5 or 10 columns | #5: 8 columns with SLOT_COUNT 32 preferred, 5 columns as the cheap option | 5 columns now; 8 only with a SLOT_COUNT and snapshot version bump. 10 is ruled out (hotbar is 8) |
| Slot scaling | #2: hotbar clamp(44px,6.2vh,72px), bag clamp(40px,6.0vh,68px) | #13: clamp(42px,6.5vh,64px) for both | Pick one token set; 6.0-6.2vh matches Raft's measured 6.0-6.1% H |
| Info header height | #4: about 16% of the panel | C11/#4: 27% / 25% (its own pixels give 16%) | 16% for the icon-to-rule strip; the inventory-crafting spec should fix its percentage |
| Backdrop dimming | #13: .22 alpha | #7: transparent to ≤.15 | ≤.15 (corrected above) |
| Raft slot/panel contrast | C7: 2.6:1 | C7: 2.99:1 | Both valid at different pixels; target ≥2.5:1 in both specs |
| Selected slot | C16/#12: cream outline or underline; keep the fill change | C10: thin light outline, "no change to the fill" | In store_04 the selected slot also has a lighter cream edge and underline. Keeping a fill change is a Little Raft choice, not a conflict in function |
| Hotbar width | #2: 36-40% W target | §3: 8 x 58 px ≈ 39.5% W "matching C17" at 720p | Both use the 10-slot Raft width; with 8 scaled slots Little Raft is about 31% W. Accept that or add slots |

## Verification log

Counts, over all tags in this file (C1-C16, the §1 and §3 statements, change items #1-#15 and §5 open questions):
- **VERIFIED: 38**
- **CORRECTED: 24**
- **UNSURE: 3** (plus partial-UNSURE notes inside VERIFIED tags: Raft's font identity and the JPEG contrast penalty, both "wiki unreachable" or unmeasurable)

Split: claims C1-C16 have 6 VERIFIED (C1, C2, C4, C7, C9, C13) and 10 CORRECTED (C3, C5, C6, C8, C10, C11, C12, C14, C15, C16). Change items #1-#15 have 11 VERIFIED and 4 CORRECTED (#2, #9, #12, #13). #12 dropped to impact L-M after the C-level correction; no other re-ranking was needed.

Method: the Pillow/numpy scripts are in `scratchpad/ui-typography-panels-skeptic/`. `m.py` does 5x5 median hex and luminance edge profiles. `rows.py` does text-row occupancy at the midpoint threshold, and fg/bg medians. `cr.py` and `lr.py` compute WCAG ratios, with alpha compositing of the dist/ CSS colours over their real parents. `hdr0.png` and `hdr24.png` are contact sheets of the inventory header across all 45 yt frames. There are also zoomed crops (`inv_top.png`, `tab.png`, `prompt.png`). For Raft text contrast I used the brightest 5% of text pixels against a nearby background sample. Every dist/ file:line was opened and checked, and border radii were grepped across all CSS sources.

Images re-checked: `stills/steam/store_04.jpg` (primary: panel extents, slots, hotbar, rail pitch, all text cap heights, rim, CRAFT button, selection, durability), `inventory-crafting/yt/68lj91mBrDI_0119.jpg` (panel, slots, hotbar, titles, rim, fill, LEARN), `stills/steam/store_16.jpg`, `stills/steam/community_063.jpg`, `stills/steam/community_147.jpg`, `inventory-crafting/yt/68lj91mBrDI_0149.jpg`, `qVVltzNBaGw_0030.jpg`, `qVVltzNBaGw_0455.jpg` and `qdWZgcjkYNI_0905.jpg`, plus all 45 yt frames via the header contact sheets.
