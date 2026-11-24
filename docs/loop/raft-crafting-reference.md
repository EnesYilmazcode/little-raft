# Raft inventory and crafting screen: reference

This is research for Little Raft's inventory and crafting UI. It describes Raft (Redbeet Interactive, 1.0 "The Final Chapter", released 20 June 2022).

## How this was researched, and its limits

- WebFetch could not reach any page, because DNS failed for raft.wiki.gg, raft.fandom.com, raft.gamepedia.com, wiki.biligame.com, steamcommunity.com, magicgameworld.com and en.wikipedia.org. github.com was the only host that loaded.
- Every claim below therefore comes from search-engine summaries and quotes of those pages. No screenshot was viewed directly. A pixel-level layout (exact sizes, colours) could not be checked.
- Tags used:
  - **[V]** means a source states it (cited).
  - **[V1]** means only one source states it, or the sources disagree.
  - **[U]** means unverified: it comes from memory of the game or is inferred. Treat it as a hypothesis to check against a screenshot.
- To finish the job, allow raft.fandom.com, raft.wiki.gg and steamcommunity.com in the session network settings. Then open the File: pages listed under References and record the static.wikia.nocookie.net image URLs.

## Opening and closing

- Tab opens the crafting menu, and the Inventory key (default I) opens it with the inventory [V]. Source: fandom Crafting Menu page, quoted in search: "a menu that can be found in the top-left corner of the player screen. It can be accessed by using the [TAB] key or when using the Inventory key (default [I])".
- One screen holds both crafting and inventory, so there is no separate crafting window [V]. Steam guide 2840337010: "on the left hand side of your inventory screen ... an area with a bunch of tabs, labeled things like Tools, Food, and Other".
- Opening the inventory hides the vitals and character stats [U]. One SteamDB UI patch note was summarised as "Character Stats are now hidden when opening the inventory", but its version could not be confirmed [V1].

## Overall layout (left / centre / right)

| Region | Contents | Status |
|---|---|---|
| Left edge, top-left | Crafting menu: category tabs, recipe list, recipe detail | [V] top-left / left-hand side |
| Centre | Player inventory grid, with an open chest also centred | [V] "Buildmenu will be on left and inventory/chest in the middle without any collisions of an UI (at 1080p)" (Steam thread 2992039579108882880) |
| Lower part of the inventory window | 5 equipment slots | [V] fandom Inventory page |
| Bottom centre | Hotbar of 10 slots, which stays visible | [V] hotbar at the bottom of the screen, keys 1-0 and scroll wheel |
| Bottom left, beside the hotbar | Health / hunger / thirst bars (HUD, not part of the inventory screen) | [V] "health, food and water bars are found to the left of the hotbar" |
| Right side | Nothing documented. It seems to stay mostly open, showing the world | [U] |

Approximate sizes as fractions of the screen. These are all **[U]**, estimated from memory of 16:9 1080p play and not measured:
- Crafting column (tabs, list and detail together): about 0.30-0.40 of screen width, full height from the top-left down to about 0.75.
- Inventory panel: about 0.30-0.35 of screen width, centred. It sits a little above the hotbar.
- Hotbar: about 0.35-0.40 of screen width, along the bottom edge.

The sizes are close enough that the panels touch at 1080p. At lower resolutions the crafting detail pane overlaps the inventory's top-left slots [V]. Steam threads 2963890181154154873, 4199112341326724370 and 3408677083953980334 report that the detail pane "hid the two top-left inventory slots". One player suggests "set the crafting menu on the left to food -> water cup" (a recipe with few ingredients) so that the pane is shorter. This tells us three things:
- The detail pane sits to the right of the recipe list and reaches toward the centre.
- Its height grows with the number of ingredients.
- At 1080p its right edge almost touches the inventory's left edge.

## Crafting menu

### Category tabs

- There are 8 sections, in wiki order [V]:
  1. Food & Water
  2. Other
  3. Tools
  4. Weapons
  5. Equipment
  6. Resources
  7. Navigation
  8. Decorations

  Creative Mode adds Miscellaneous. The order is consistent across pages: the Equipment page calls Equipment "the fifth section of the Crafting Menu", and the Decorations page calls Decorations "the eighth section". The categories were rearranged during Early Access [V].
- Placement is a vertical column of square category icons along the far left edge of the screen, one tab per row [U]. Sources only say "on the left hand side ... an area with a bunch of tabs". That the tabs are arranged vertically, and are icon-only versus icon plus label, is **unverified**. The Steam guide's phrase "tabs, labeled things like Tools, Food" suggests that names show, either as labels or on hover [V1].

### Recipe list

- Clicking a category shows that category's recipes as a column next to the tabs [U]. A Steam guide says "press TAB, then click on the desired icon/name of the item", which confirms that each recipe entry has an icon and a name [V].
- Only recipes you have learned appear. Researching at the Research Table and pressing "Learn" adds them "to your Crafting list" [V] (techraptor and gamerant research guides).
- Whether recipes you cannot afford are greyed out or tinted in the list is **unverified**.

### Recipe detail pane

- Selecting a recipe opens a detail pane beside the list, on the side toward the screen centre [V, inferred from the overlap reports above].
- The pane shows "how many Materials and Resources the player needs to build the specific item, and how many the player already has in their inventory" [V] (fandom Crafting Menu). That is a have/need count per ingredient, with ingredient icons; recipe pages render ingredients as "icons and a multiplier (x2)" [V].
- It also shows the item name and a short description [U].
- It has a **Craft** button [V]. Sources quote "hit the 'craft' button", and the research guide says to select the Research Table "then Craft".
- Missing ingredients are shown in red [V1]. The base-game behaviour is implied by the RaftModding "Craft From All Storage" changelog: "The red marking for missing ingredients will look in storage". Red is also Raft's "can't" colour elsewhere: a red Research button, and a red build ghost when you lack materials [V]. Whether the red applies to the count text, the icon tint or the slot background is **unverified**.
- **Sub-craft "+" button** [V]: "If the player does not have a particular component, and the component is a craftable Resource, such as a nail or hinge, the player can mouse over the image of the component to see a '+' symbol" (fandom, with the example of crafting a Hinge from a Metal Ingot inside the Storage recipe). An older guide says the plus is green when you can craft the sub-component and red when you cannot [V1, 2018]. Whether it chains more than one level deep is **unverified**.
- The pane stays open after you select a recipe and does not close on mouse-out [V]. The reported bug is that it "stayed open" over the inventory. So the pane is click-selected, not a hover tooltip.

### Craft feedback

- The crafted item goes "in the next available slot in your inventory/hotbar" [V] (Steam guide 1393150790). The ingredients may sit anywhere in the inventory, not only on the hotbar [V].
- You need at least one free slot. One player reports that the crafted item fell out of the raft when the inventory was full [V1, itch.io player report].
- Each click crafts one item. There is no amount selector: a Steam thread asking how to craft 250+ ropes was answered with "use an auto-clicker", and the poster wished for "5/10/20/50/100" options [V1]. The thread URL was not captured.
- A craft sound, a pickup popup or feed line, and any animation on the button are **unverified**.
- 1.0 changed recipe display "from UI to textures to improve performance" (Version 1.0 changelog summary) [V1]. One summary also said that storage contents count toward crafting in 1.0, but another search attributed crafting from storage only to mods. **Unverified; treat it as false.**

### Pinning

- No source mentions a pin, track or favourite feature in vanilla Raft. Searches for "Raft pin recipe" returned only other games (Icarus, Valheim mod, Vintage Story mod, Don't Starve). **Unverified, but probably absent.**

### Hover behaviour

- **Recipe:** you choose a recipe by clicking it. The detail pane opens on selection, not on hover [V].
- **Ingredient icon:** hovering a missing craftable ingredient shows the "+" [V]. A name tooltip on hover is [U].
- **Inventory item:** item descriptions exist. The stuck detail pane was reported to "block item descriptions" [V1]. Where they render (a tooltip at the cursor or a fixed box) is **unverified**.

## Backpack grid

- The fandom Inventory page says the base inventory has **15 item slots** [V1]. A Backpack adds +10 and a Big Backpack +15, and only one backpack can be equipped [V]. An earlier round of our research estimated "about 30 total" [?], and memory says 20 [U]. Whether the 10 hotbar slots are counted inside the 15 is **unverified**.
- The grid sits in the centre, above the hotbar [V]. The number of columns is **unverified**. Memory suggests rows of 5 to 10, matching the hotbar width [U].
- Shift-click moves a full stack between the inventory and an open chest without dragging [V]. Dragging and right-click splitting are [U].
- By default, picked-up items go to the hotbar first. Players asked for a way to stop this [V] (Steam suggestions thread 601895662819254772).

## Hotbar

- There are 10 slots, selected with keys 1-0 or the scroll wheel, centred along the bottom [V].
- The hotbar stays visible while the inventory is open and acts as the bottom row of the inventory screen [U].

## Equipment slots

- There are **5 generic equipment slots** in the lower part of the inventory window [V]. Raft does **not** use typed head/body/legs/feet/neck slots. Any wearable item goes in any slot ("it doesn't matter which order you place them in, just put them in any slots", PwrDown flippers guide). You can wear only one item of each type, for example the Head Light and the Leather Helmet cannot both be worn [V].
- Older versions had 3 slots [V] (Steam "Equipment?" thread 1694922980046128789).
- Wearables include:
  - Backpack and Big Backpack
  - Flippers and Oxygen Bottle
  - Head Light and Advanced Head Light
  - Leather Helmet and Leather Body Armor (later metal armor)
  - Zipline Tool, which may sit in an equipment slot [U]
- There is no paper doll or character model shown in the inventory [V1]. No source mentions one, and none was found.

## Colours

- **Unverified.** No source describes the palette. From memory [U]:
  - Panels are dark, semi-transparent blue-grey.
  - Slots are rounded squares in a lighter tint.
  - The selected hotbar slot gets a bright outline.
  - Text is white with a sans-serif face.
  - Red marks missing items and green marks available ones (the red/green scheme is [V] from the Research button and the build ghost).

## Text in the screen centre

- When the inventory is open, the centre of the screen holds the inventory grid itself [V]. No source describes a centred text banner, title or message on the crafting screen. Titles such as "Inventory" above the grid are [U].

## Implications for Little Raft

These cite `dist/craft-book.js` (4 tabs: Tools, Materials, Survival, Building) and `dist/inventory-state.js` (28 slots plus a hotbar of 10).

1. **Put crafting on the left and the inventory in the centre, on one screen opened by Tab or I.** Keep the right side clear, so the world stays visible.
2. **Lay out the left column as tabs, then list, then detail, from left to right.** Use a narrow tab column on the far left edge, then the recipe list, then the detail pane toward the centre. Size the panels so that at 1280x720 and up the detail pane does not cover the inventory. Raft's worst-known UI complaint is exactly that overlap, so ours should do better: clamp the pane height or let the inventory shift right.
3. **Split the 4 categories closer to Raft's 8.** Food & Water, Other, Tools, Weapons, Equipment, Resources, Navigation, Decorations. At minimum split out Food & Water, Equipment and Navigation (also suggested in research/fidelity-r2b-world.md).
4. **Open the detail pane on click and keep it open.** Hover can preview it, but a click pins the selection. Show ingredient icons with a `have/need` count and colour the count red when short. Add a "+" on a missing craftable sub-ingredient (nail, hinge, rope) that crafts it in place, green when affordable and red when not.
5. **Make the Craft button craft one item per click.** Raft has no amount picker. Little Raft's hold-to-craft repeat (craft-book.js) is already a quality-of-life improvement over Raft; keep it. Put the result in the first free slot, preferring the hotbar, and block crafting when no slot is free, so the item is never dropped.
6. **Make equipment slots generic, not typed.** Use 5 slots, each accepting any wearable, with one item per wearable type. This is simpler than a paper doll and matches Raft.
7. **Raft has no recipe pin.** If we add one, it is our own feature, so keep it small (for example a HUD checklist of one recipe's ingredients).
8. **Leave the screen centre free of text banners.** Keep messages in a corner feed.

## References

Pages (as quoted by search; not fetched directly):
- https://raft.fandom.com/wiki/Crafting_Menu
- https://raft.fandom.com/wiki/Inventory
- https://raft.fandom.com/wiki/Equipment
- https://raft.fandom.com/wiki/Decorations
- https://raft.fandom.com/wiki/Backpack
- https://raft.fandom.com/wiki/Big_Backpack
- https://raft.fandom.com/wiki/Research_Table
- https://raft.fandom.com/wiki/Recipes
- https://raft.fandom.com/wiki/Version_1.0
- https://raft.fandom.com/wiki/Controls
- https://wiki.biligame.com/raft/制作选单 (Chinese mirror of the Crafting Menu page)
- https://steamcommunity.com/sharedfiles/filedetails/?id=2840337010 (How to Raft guide)
- https://steamcommunity.com/sharedfiles/filedetails/?id=1393150790 (Beginners Guide To Raft)
- https://steamcommunity.com/sharedfiles/filedetails/?id=1648718375 (Raft - Complete Guide)
- https://steamcommunity.com/app/648800/discussions/0/2992039579108882880/ (build menu on the left, inventory in the middle at 1080p)
- https://steamcommunity.com/app/648800/discussions/0/2963890181154154873/ (craft menu overlaps the inventory at low resolution)
- https://steamcommunity.com/app/648800/discussions/0/3408677083953980334 (detail pane stuck, covers the top-left slots)
- https://steamcommunity.com/app/648800/discussions/0/4199112341326724370/ (Crafting Menu Covers Inventory)
- https://steamcommunity.com/app/648800/discussions/0/3002172045218599603/ (inventory covered by another window)
- https://steamcommunity.com/app/648800/discussions/0/1694922980046128789/ (Equipment? 3 slots, older version)
- https://steamcommunity.com/app/648800/discussions/2/601895662819254772/ (picked-up items go to the hotbar)
- https://store.steampowered.com/news/app/648800/view/3323107422495479397 (1.0 The Final Chapter announcement)
- https://www.pwrdown.com/gaming/raft-how-to-use-flippers-oxygen-bottles/ (equipment goes in any slot)
- https://www.pwrdown.com/gaming/raft-controls-and-how-to-change-them/
- https://techraptor.net/gaming/guides/raft-research-and-blueprints-guide
- https://gamerant.com/raft-research-table/
- https://gamerant.com/raft-backpack-increase-inventory-size-get-how-make-craft/
- https://raftmodding.com/mods/craft-from-all-storage (red marking for missing ingredients)
- https://github.com/kohanis/raft-comfortable-inventory (inventory QoL mod; describes vanilla shift-move behaviour)
- https://itch.io/post/111780 (early-access player report)

Reference images. None were viewed, and none were downloaded or committed:
- https://raft.gamepedia.com/File:Crafting_menu_-_Storage_.png. This is the wiki File page for a screenshot of the Crafting Menu with the Storage recipe selected (the hinge "+" example). The direct static.wikia.nocookie.net URL could not be resolved. **This is the first image to open when verifying the layout above.**
- No Steam store screenshots, YouTube thumbnails or Reddit images could be fetched. A search for direct image URLs returned none.
