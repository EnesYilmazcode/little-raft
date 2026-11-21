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

YouTube frames (960x540) in `inventory-crafting/yt/`, all 46 viewed as contact sheets:
- Measured: `68lj91mBrDI_0119.jpg` (full layout), `68lj91mBrDI_0149.jpg` ("You learned" card), `qVVltzNBaGw_0030.jpg` (unaffordable state), `qVVltzNBaGw_0455.jpg` (+1 pickup), `qdWZgcjkYNI_0905.jpg` (hotbar, selection and durability).
- The `9qt0eezZZMs_*` frames are zoomed by the video author. They are used only for layout patterns, never for % sizes.

Reference lists: `hud/SELECTED.md` (present, and used for picks #1, #2, #3, #4, #9, #12 and #27). `menus/SELECTED.md` did not exist when this was written.

Little Raft code read: `dist/style.css`, `dist/graphics.css` (it re-skins most of style.css), `dist/index.html`, `dist/survival-ui.js`, the HUD_CSS and prompt code in `dist/game.js` (lines 45-52 and 394-412), and the CSS in `dist/settings.js` (lines 40-60).

## 2. Observations / spec (Raft)

### Layout and proportions

**C1. The UI scales with screen height.** Panel and slot proportions are the same at 540p and 720p.
- Inventory panel width is 20.1% W in `68lj91mBrDI_0119` (x387-580 of 960) and 20.0% W in `store_04` (x517-773 of 1280).
- Inventory slot pitch is 6.7% H (36/540) and 6.8% H (49/720).

**C2. Inventory slot spec** (`store_04`, column 560 and visual check):
- Slot: 43 px = 6.0% H.
- Gap: 5-6 px = 0.8% H.
- Pitch: 49 px = 6.8% H.
- Grid: 5 columns. Icons fill about 75-80% of the slot, so the padding is about 10-12% of the slot per side.
- `68lj91mBrDI_0119`: slot 33 px = 6.1% H, gap 3-4 px = 0.7% H.

**C3. The hotbar is 10 slots.**
- Slot strip: x383-887 = 39.4% W in `store_04`, and x297-663 = 38.1% W in `68lj91mBrDI_0119`. Including the end tabs it is 43.6% W.
- Pitch: 48.8 px = 6.8% H. Slot: about 44 px = 6.1% H.
- The bar sits almost flush with the bottom edge: the frame top is at y662 and the slot bottom at y715 of 720, so the bottom margin is ≤0.7% H.
- The end tabs carry tiny "TAB" and "T" key labels with a cap height of about 1% H (`community_063`, x362-390 and y690-720). They tell the player which key opens the inventory.

**C4. Crafting is split into three adjacent opaque panels, anchored top-left** (`store_04`):
- Category rail: x17-82 = 5.1% W.
- Recipe list: x90-298 = 16.3% W.
- Recipe card: about x306-475 = 13.3% W.
- Outer margin: 12 px = 1.7% H. Gap between panels: 8 px = 1.1% H.
- Rail icon pitch: 56.6 px = 7.9% H.
- The inventory panel is a separate block, centred horizontally (its centre is at 50.4% W) with its top at 18% H.
- In `68lj91mBrDI_0119` the panel gaps are 3-5 px = 0.6-0.9% H.

### Panel fill, border and radius

**C5. Panels are fully opaque.**
- The inventory panel fill is `#6a4f31` over wood at (540,230) and `#684d2f` over sea at (750,230) in `store_04`, which is the same colour.
- The same fill measures `#6a4e31` in `68lj91mBrDI_0119` (150,100).
- There is no dimming backdrop: the sea and deck behind the panels keep their normal colours in all 46 frames.

**C6. Border, radius and rules.**
- Each panel has a single light rim of 2-3 px (about 0.35% H): `#bba478` at y130-132 in `store_04`, and `#ae9f88` at x384-386 in `68lj91mBrDI_0119`.
- There is no heavy drop shadow.
- The corner radius is about 2-3 px at 720p (≤0.4% H). The corners read as almost square.
- Titles are underlined by a 2 px cream rule (`68lj91mBrDI_0119` y47-48, under "OTHER").

**C7. Slots are lighter than the panel.**
- Empty inventory slots: `#b09560` (store_04 600,330). Empty hotbar slots: `#b79e67` (store_04 560,690).
- The hotbar frame is `#6a492a`.
- Slot-to-panel separation is 2.6:1 (inventory) and 3.1:1 (hotbar), so empty slots read clearly.

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

**C9. Colour roles.**
- Primary text is warm cream on brown: about `#c2a77b` on `#6c5031` (A720 title box), up to `#efd6ae` on stack counts.
- Secondary text (ingredient names) is dimmer: `#9c7d58`.
- Green marks "can do / learned": the CRAFT button fill is `#57641f` to `#8d9849` (A720 x398-464, y106-134), and the learned item name is green in `68lj91mBrDI_0149`.
- Red marks shortage. In `qVVltzNBaGw_0030` the CRAFT button turns red (`#7a482b` at 320,90) and the short ingredient row gets a red band (`#91422f` at 275,118).

**C10. Raft's text contrast is modest.** Measured lower bounds: title 3.2:1, list item 3.4:1, slot count 3.5:1, ingredient name 2.1:1, CRAFT label on green about 1.5:1 (too faint to segment). Raft's legibility comes from size and the condensed caps, not from contrast. Little Raft should not inherit those ratios.

### Item info, tooltips and notifications

**C11. No floating cursor tooltip.**
- Item info is a **fixed header block at the top of the inventory panel**: an icon, then the item name in caps at 1.9% H cap, then a 2 px rule, then one sentence-case description line.
- The block takes 17-18% H, about 45% of the panel height (A540 y98-192; A720 y130-260).
- About 15 of the 46 yt frames show a hovered item name there (for example `68lj91mBrDI_0119` "LARGE CROP PLOT / Lets you grow trees", `9qt0eezZZMs_0016`, `qVVltzNBaGw_0345`, `qdWZgcjkYNI_0945`). None shows a cursor-following tooltip.

**C12. The recipe card has a separate action button.**
- The CRAFT button is 5.2% W x 3.9% H in A720. The LEARN buttons are 41x19 px = 3.5% H in A540.
- When ingredients are short, the button colour flips to red (C9). The whole card is not dimmed.

**C13. Pickup feed, bottom-right, flush to the right edge.**
- Each row reads "+N [icon] NAME".
- `community_147`: x1114-1280 = 13% W, three rows at 33 px pitch = 4.6% H, translucent dark fill (`#222320` at 1200,612, with the background visible through it).
- `qVVltzNBaGw_0455`: a single row 24 px = 4.4% H at y507-530 of 540.

**C14. Prompts.**
- The key-cap is a solid cream rounded square: `#e2cdb2` (community_063 637,282), 22-24 px = 3.1-3.3% H, with a dark glyph and a darker bottom lip.
- The verb sits under the key-cap with no panel behind it. The text is cream `#f6efdc` with a dark outline or shadow, measuring 4.7:1 even over a bright red bird in `community_063`.
- The interact prompt sits **above** the crosshair (key-cap at 39-41% H, text at 44% H). Build hints sit low (80-87% H, `store_16`).
- A cost chip sits just below the crosshair: a parchment chip 3% W x 6.9% H, 33 px below the centre (`store_16`).

**C15. Research toast, top-right** (`68lj91mBrDI_0149`): x787-950, y15-60, so 17% W x 8.3% H with a 1.6% W right margin. It has two lines: a caps title with a green item name, then a dim sub-line.

**C16. Durability and selection in slots.**
- The durability bar is 3-4 px = 0.6% H, about 80% of the slot width, light green `#bcd06d` (qdWZgcjkYNI_0905 y532-535).
- The selected slot gets a 2-3 px cream outline or underline: `#ebd0a5` at y536-538 in qdWZgcjkYNI_0905, and `#f6debc` in store_04 x383-388.

## 3. Little Raft today

### Fonts: 4-5 stacks, and the loaded web fonts are mostly overridden

- `style.css:1` imports DM Sans and Outfit from Google Fonts (render-blocking).
- `graphics.css:25-27` then sets the root to `--ui-font` (Bahnschrift, then Segoe UI Variable, Segoe UI, Helvetica, Arial). Bahnschrift exists only on Windows, so macOS and Linux players get Helvetica or Arial.
- `--display-font` is a Palatino/Georgia serif, used for h1, h2 and the brand (`graphics.css:60,263,295`).
- `survival-ui.js:115` uses its own `'Segoe UI',system-ui` for the whole hotbar, inventory and tooltip.
- `game.js:49` (`#contextPrompt`) uses system-ui, and `settings.js:44,47` uses system-ui plus Georgia.
- `graphics.css:375` forces `'Segoe UI'` on the tool labels.

Net result: the HUD and inventory, which are the in-game text, render in the OS default font. The two web fonts only reach a few `kbd` elements (`style.css:2,17`).

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

At 1080p every in-game text role is 40-60% of Raft's relative size. At 720p it is close to Raft. On large monitors the UI looks tiny and the hierarchy is flat: the recipe name, requirement count, tooltip name and slot count are all 13-14 px.

### Panels: two competing skins and many radii

- **Navy skin.** "Lacquered navy" plates use `rgba(9,20,30,.80)` with a blur and a bronze frame (`graphics.css:8,38-48`) for the supplies, goal, recipes, toast and durability panels.
- **Wood skin.** The hotbar uses a wood gradient (`#9a7643` to `#6a4a2a`) with a `#c9a66b` border (`survival-ui.js:117-119`, repeated in `graphics.css:373`). The inventory dialog uses a striped wood frame (`#b48d55` to `#8a663a`, a 3 px `#3e2a17` border plus a 2 px `#d6b67e` ring, radius 6) with dark inner wells `#3a2716eb` (`survival-ui.js:141-145`).
- **Other skins.** The context prompt is navy `rgba(8,22,36,.55)` with radius 8 (`game.js:48-49`). The aim hint is teal `#162e3199` (`graphics.css:383`). The settings dialog is navy `rgba(13,29,52,.9)` with radius 14 and Georgia (`settings.js:41-47`).
- **Radii in use:** 2, 3, 4, 5, 6, 7, 8, 9, 10, 14 px, plus a 12 px base in `style.css:2`. Raft uses one radius of about 0.4% H.

### Slot legibility

- Inventory slots (`#4b3420` average, from `#5a3f28` to `#3d2a19`) on the inner well (`#3a2716`, alpha .92): **1.22:1**. Empty slots almost vanish into the panel. Raft: 2.6:1 (C7).
- Hotbar slots on the hotbar frame: 2.0:1.
- The selected hotbar slot (`#b3925a`, `survival-ui.js:135`) under the count text `#fff2cc`: 2.6:1, which relies on the text-shadow.

### Text contrast is good on solid panels and weak on translucent ones

- Inventory text `#fff2cc` / `#eadcbe` on the dark wells: 7.8-10.4:1. The short-ingredient colour `#ffab8f`: 5.8:1. This beats Raft (C10) and should be kept.
- `#contextPrompt` (`#f6ecd6` on `rgba(8,22,36,.55)`) falls to **3.46:1** over a white sky or sail. The aim hint `#f4eddd` on `#162e3199` falls to **3.43:1**. Both are below 4.5:1 for 13 px text.

### Item info and tooltip

- `survival-ui.js:180-183` and `444-458` add a cursor-following tooltip: name plus "count / max" or "Durability N%".
- The tooltip has no description. When a slot is hovered, nothing in the panel itself shows what the item is.
- Recipes use the whole row as the button (`survival-ui.js:161-167`). A recipe that cannot be made becomes `opacity:.6`, which dims the ingredient counts the player needs to read. There is no separate affordance for "craftable".

### Notifications

- While playing, `#toast` is hidden (`game.js:46`, `graphics.css:382`). Every toast and every loot event goes through `notice()`, which writes into the single `#contextPrompt` under the crosshair (`game.js:394-411`, loot text at `game.js:562`).
- So a pickup message ("+ 2 Plank · 1 Leaf") **replaces** the "E Pick up" prompt for 1.8 s. Prompts and loot compete for one 13 px line.

### Grid shape

The backpack is 20 slots in **7 columns** (`survival-ui.js:147`, with TOTAL 28 and HB 8), so the last row has 6 of 7 slots and looks ragged. Raft uses 5 columns (C2).

### Discoverability

The hotbar has no key hint for the inventory. The controls strip that would show one is hidden while playing (`game.js:47`, `graphics.css:382`). Raft labels the hotbar end tabs (C3).

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

**#2 Scale slots with height** (`dist/survival-ui.js:122,137,147-149,185`).
- Hotbar slot: `--slot: clamp(44px, 6.2vh, 72px)`, gap `calc(var(--slot)*.12)`.
- Inventory slot: `clamp(40px, 6.0vh, 68px)`, gap 0.8vh.
- Icon inset: 14% of the slot (today it is a fixed 8-9 px).
- Target hotbar strip width: 36-40% W at 16:9.
- Impact H, effort S.

**#3 Make empty slots read against the panel** (`dist/survival-ui.js:123,144,151`). Raise slot-to-well contrast from 1.22:1 to ≥2.5:1. In Little Raft's own palette, either lighten the wells or put lighter, sun-bleached slot tiles on a darker frame. Keep the icon-to-slot contrast ≥3:1. Impact H, effort S.

**#4 Fixed item-info header in the inventory instead of (or as well as) the cursor tooltip** (`dist/survival-ui.js:209-218` markup, `444-458` showTip).
- Add a block at the top of `.sv-bag`, about 16% of the panel height: a 40 px icon, the name in display caps at `--fs-head`, a 2 px rule, and a one-line description in `--fs-body`. The description comes from `ITEM_INFO[kind].desc`, falling back to count / durability.
- Fill the block on hover, focus and pick-up.
- Keep the tooltip only for pointer users, or remove it.
- This is also better for keyboard and screen-reader users.
- Impact H, effort M.

**#5 Split pickups from prompts** (`dist/game.js:394-411,529,562`).
- Send `kind:'loot'` events to a new bottom-right feed, not to `notice()`.
- Feed spec: rows of "+N [icon] Name", up to 3 stacked, row height 4.5% H, width 12-14% W, right margin 1.5% W, bottom at the hotbar's top line. Each row lives 2.5 s, then fades out over 0.3 s.
- `#contextPrompt` then only shows actions.
- Impact H, effort M.

**#6 Key-cap prompts with stronger contrast** (`dist/game.js:48-51`).
- Render `<kbd>` as a solid light cap (≈3.2% H tall, dark glyph, 2 px darker bottom lip) instead of an outline.
- Set the verb in `--fs-label`. Either drop the 55% navy pill and use a 1 px dark text outline plus a 6 px soft shadow, or raise the pill's alpha to ≥.75 so it stays ≥4.5:1 over a white sky (today 3.46:1).
- Consider moving the interact prompt above the crosshair (≈44% H) so loot and charge UI below it never overlap.
- Impact M-H, effort S.

**#7 Recipe card hierarchy** (`dist/survival-ui.js:161-178,307-311,336`).
- Recipe name in `--fs-head` caps.
- Have/need numbers in `--fs-num`, tabular, right-aligned on their own row per ingredient, about 1.3x the name size.
- Shortage shown as a tinted row band plus colour on the number (keep `#ffab8f`-like ≥4.5:1), not as `opacity:.6` on the whole card.
- Add an explicit "Craft" button per selected recipe: about 5% W x 3.8% H, with clearly different enabled and disabled fills, and the disabled label still ≥3:1.
- Impact H, effort M.

**#8 Add panel titles** (`dist/survival-ui.js:209-218`). Add "Crafting" and "Backpack" headings in `--fs-title` display caps, each with a 2 px rule underneath. This gives the dialog the missing top step in the hierarchy. Impact M, effort S.

**#9 Backpack grid to 5 or 10 columns** (`dist/survival-ui.js:147,185`). With 20 backpack slots, `repeat(5, var(--slot))` (4 full rows) or `repeat(10, …)` (2 rows that match the hotbar width) removes the ragged 7-column last row. Impact M, effort S.

**#10 One panel skin and one radius** (`dist/graphics.css:8,38-48,373,377,383`; `dist/survival-ui.js:117-119,141-145`; `dist/game.js:48-49`; `dist/settings.js:41-47`).
- Choose either the navy-and-bronze plates or the wood. Little Raft's own wood look suits the raft; keep the navy for menus only if it is clearly a different layer.
- Use one in-game panel recipe: opaque or ≥.92 fill, a single 1-2 px light rim, and `--radius: clamp(3px, .4vh, 5px)`.
- Remove the striped double frame, the extra 2 px ring and the 8, 9, 10 and 14 px radii.
- Impact M, effort M.

**#11 Inventory key hint on the hotbar** (`dist/survival-ui.js` ensureTools, `:344-361`). Add a small end tab on the left of the hotbar reading "Tab" (and "I"), using a key-cap at about 1.4% H cap. Today nothing in play mode says how to open the inventory. Impact M, effort S.

**#12 Clearer selected slot** (`dist/survival-ui.js:135`). Keep the fill change. Add a 3 px light outline or underline (≈0.3% H) that is ≥3:1 against both the slot and the frame. Raise the count text contrast on the selected fill: it is 2.6:1 today, so darken the selected fill or add a dark count plate. Impact M, effort S.

**#13 Lighter inventory backdrop** (`dist/survival-ui.js:140`). Change `rgba(12,9,5,.42)` to about `.22`. Raft keeps the world fully visible (C5), which helps with "what am I standing next to" while crafting. Impact L, effort S.

**#14 Bottom margin and stacking** (`dist/graphics.css:111`). Set the hotbar bottom margin to `clamp(6px, 1vh, 14px)` (Raft ≤0.7% H). Raise the pickup feed and any prompts by `var(--slot)` plus a gap, so they never overlap the hotbar. Impact L, effort S.

**#15 Remove dead font weight** (`dist/style.css:1`). After #1, import only the two faces and weights you actually use (about 4 files instead of 9). Use `font-display: swap` and preconnect, or self-host. Impact L, effort S.

## 5. Open questions and UNSURE items

- **Cap-height to font-size factor.** The 0.7 factor is an estimate. Condensed display faces often have taller caps (0.72-0.75), so confirm the clamp values on screen at 1280x720 and 2560x1440.
- **Raft contrast.** The ratios are lower bounds from JPEG; the real game text is likely 0.5-1.0 higher. The direction of the finding (Raft relies on size, not contrast) still holds.
- **Equipment row.** Raft's dark row of 5 slots under the inventory grid (`store_04` y410-454; `68lj91mBrDI_0119` y304-341) looks like an equipment row (from memory, unverified). Little Raft has no equipment slots, so this was not specced.
- **Description data.** `ITEM_INFO` may not carry descriptions yet. Change #4 needs a one-line `desc` per item; inventory-state.js was not checked in detail.
- **Pickup feed fade time.** The 2.5 s life is from memory (unverified). No frame sequence shows a toast fading.
- **Menus.** `menus/SELECTED.md` was absent, so the title-screen and pause-menu typography was not compared against Raft. The welcome screen and dialogs (`graphics.css:259-300`) are out of scope here, apart from the radius and font unification in #1 and #10.
- **Font choice.** This is a creative decision. Any condensed caps face with open counters works. Avoid stencil or hand-cut faces that would echo Raft's own face.
