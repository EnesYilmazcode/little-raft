# Raft HUD reference (for imitation)

Target: Raft by Redbeet Interactive, 1.0 / "The Final Chapter" (June 2022).
Purpose: describe the real HUD well enough to imitate its feel. Do not copy assets.

## How this was researched, and its limits

- In this session WebFetch could not reach raft.wiki.gg, raft.fandom.com,
  store.steampowered.com or gamerempire.net (DNS blocked). Only WebSearch
  snippets were available. No screenshot was opened and checked by eye.
- Tags used below:
  - **[sourced]**: stated in a wiki or guide snippet (source listed).
  - **[recalled]**: from general knowledge of the game, not checked against an
    image in this session. Treat as likely but **unverified**.
  - **[unverified]**: a guess or unclear. Check against a screenshot before
    relying on it.
- To verify, allow those domains and open the image pages listed at the end.

## Hotbar

- Position: bottom centre of the screen, one horizontal row. [recalled]
- Slot count: 10. Keys 1 to 9 and 0 pick slots, mouse wheel cycles. [sourced:
  Steam beginners guide, PwrDown controls guide]
- Main inventory has 15 more slots, and a backpack adds 10. [sourced: fandom
  Inventory/Backpack]
- Slot look: square slots, dark translucent fill, thin light border, item icon
  centred. Slight gap between slots. [recalled]
- Selected slot: brighter, thicker light border (whitish) around the active
  slot. No large scale-up. [recalled, exact style unverified]
- Stack count: small white number at the bottom right of the slot. [recalled]
- Durability: thin horizontal bar along the bottom edge of the slot for tools
  and weapons, drains as the tool wears. Colour green leaning to red when low
  is **unverified**. [recalled]
- No slot number labels are drawn on the slots. [unverified]

## Vitals

- Position: bottom left corner. [sourced: fandom Thirst and Hunger pages]
- Order, top to bottom: Thirst, Hunger, Health. Thirst is "above the hunger
  bar", hunger is "below the thirst bar and above the health bar". [sourced:
  fandom Thirst, Hunger]
- Form: horizontal bars, each with a small stat icon at the left (water drop,
  food, heart). Wiki has "StatIcon_Thirst", "StatIcon_Oxygen" files, so icons
  exist per stat. [sourced for icons existing; layout recalled]
- Colours: health red [sourced: "red health bar"], thirst blue, hunger
  orange/brown. [thirst and hunger colours recalled, unverified]
- Hunger and thirst drain over time, thirst faster. At zero, health drains
  (thirst costs 0.75 hp/s). [sourced]
- Oxygen: an extra bar shown only while underwater. One older guide says it
  appears "at the top of your screen"; I recall it sitting with the other
  vitals in 1.0. Position is **unverified**. Base time 33 s before drowning;
  refills gradually after surfacing. Colour light blue/cyan [unverified].
- Low-stat feedback: vignette or red flash when hurt. [unverified]

## Crosshair

- Small dot or tiny circle, white, at exact screen centre. Very minimal.
  [recalled, unverified exact shape]
- While breaking a building piece with the axe, a **white circle** in the
  middle of the screen fills to show removal progress. [sourced: gamerempire
  "How to remove foundations"]

## Interaction prompts

- Shown near the screen centre, just below the crosshair, when looking at an
  interactable (debris, chests, nets, stations). [recalled]
- Look: a key cap (small rounded square with the letter, e.g. "E") followed by
  a short verb label, e.g. "E  Pick up", "E  Open", "E  Sleep". White text,
  thin dark outline or shadow, no background panel. [recalled, unverified]
- Hold actions (e.g. hook/pick up from far, eat/drink) use the same layout,
  sometimes with a fill ring. [unverified]
- A later patch added an interaction icon that shows above items when the
  player is near them, not only when looking straight at them. [sourced:
  steamdb patch note 11125169, game match not fully confirmed]
- Floating debris in the water is picked with the hook, not E. [recalled]

## Building mode (Building Hammer)

- Equip the hammer from the hotbar to enter build mode. No separate key.
  [sourced]
- Choose piece: **hold right mouse** to open the build menu, move the mouse to
  a piece, release (or click) to select. It is a radial/category wheel
  (foundation, floor, wall, pillar, stairs, roof, etc.), with an upgrade /
  replace tool in it too. [sourced: itch.io "building hammer controls":
  "Right Mouse(Hold) - Menu, Left Mouse - Build Object"; layout of categories
  recalled]
- Default piece when first equipped: basic Foundation, cost 2 planks + 2
  plastic. [sourced: building hammer tips mirror]
- Place: left click. [sourced]
- Rotate: R. [sourced: itch.io dev thread]
- Ghost colours: green semi-transparent when placement is valid. Developers
  said a red effect would be added for invalid rotation or position; red for
  invalid is the 1.0 behaviour as far as I recall. [green sourced, red
  recalled]
- Cost: the selected piece's cost (icons + have/need counts) is shown on
  screen while in build mode, usually near the bottom right. [unverified]
- Hammer can also repair damaged foundations (shark bites). [sourced]

## Removal (important)

- Removal is **not done with the hammer**. You equip an **axe** (any axe,
  even the stone axe) and **hold left mouse** while looking at the building
  piece. [sourced: gamerempire, Steam discussions]
- It is a hold: the character swings repeatedly. The piece breaks after two
  consecutive hits, or when the **white centre circle** fills. Releasing early
  resets progress. [sourced: gamerempire]
- Applies to floors, foundations, walls, stairs, roofs, pillars, doors.
  [sourced]
- Refund: **50%** of the piece's material cost is returned to inventory.
  Mods exist to make it 100%. [sourced: gamerempire, Steam thread
  "Unfortunately, yes", RaftModding mod descriptions]
- Axe loses durability per hit, not per removal. [sourced]
- Supported pieces: removing a floor/foundation also removes what is built on
  it (stuff above falls/breaks). Raft does not block you from removing a
  supporting piece. [sourced: "Removing a floor also removes anything built on
  it"]
- Foundations can be removed with the axe. If the last foundation is gone the
  game is effectively over. [sourced: fandom Foundation / Solid Foundation]
- Placed crafted items (chests, purifiers, grills, beds) are different: they
  are **picked up** whole with an interaction key, not axed. [sourced: Steam
  thread "Items you crafted and placed can be picked up"; exact key
  unverified]
- Hint text: I could not confirm a text hint such as "Hold LMB to remove". The
  only confirmed feedback is the centre progress circle. [unverified]

## Notifications / pickup feed

- When items enter the inventory a short entry appears with item icon, name
  and "+N" count. Entries stack vertically, slide/fade in, then fade out after
  a couple of seconds. [recalled]
- Side: I recall the right side of the screen, above the lower right corner.
  **Unverified**, check a screenshot.
- Quest/research messages and "Inventory full" style warnings appear as text
  near the screen centre or top. [unverified]

## Pause menu and settings

- Esc opens a pause menu: a simple vertical list of text buttons (Resume,
  Options/Settings, Help/Controls, Exit to menu, Quit). Game world dimmed
  behind. [recalled, exact labels unverified]
- Default controls are listed from the pause menu. [sourced: fandom Controls]
- Settings: tabbed panel (Graphics, Audio, Controls, Game or similar) with
  sliders and dropdowns on a dark translucent panel. [unverified]

## Fonts and palette

- UI font: clean sans serif, light to medium weight, white on dark. Exact font
  is **unknown** (Unity game; font not identified). [unverified]
- Palette (suggested for imitation, not measured):
  - Panels: near-black at 50 to 70% opacity, e.g. `rgba(0,0,0,0.55)`.
  - Borders/selected: off-white `#f2f2f2`, normal border `rgba(255,255,255,0.35)`.
  - Text: white `#ffffff` with soft dark shadow.
  - Health red `#c8382f`, thirst blue `#3a8fd6`, hunger orange `#d9862b`,
    oxygen cyan `#6fd3e8`. Hex values are **approximations, unverified**.
- Overall style: minimal, flat, translucent, low contrast frames, no heavy
  ornament. [recalled]

## Image and source links (not downloaded)

Images (open to verify; contents described from page titles only):

- https://store.steampowered.com/app/648800/Raft/ : store gallery, 24
  official screenshots, several show the hotbar and vitals.
- https://steamcommunity.com/app/648800/screenshots/ : player screenshots,
  sort by most popular for HUD shots.
- https://raft.gamepedia.com/File:StatIcon_Oxygen.png : oxygen stat icon.
- https://raft.fandom.com/wiki/Thirst , /wiki/Hunger : include stat icons
  (StatIcon_Thirst) and bar position text.
- https://raft.fandom.com/wiki/Building_Hammer : hammer page, build menu
  images expected (not opened).
- YouTube: search "Raft 1.0 building guide" or "Raft final chapter gameplay";
  thumbnails at https://i.ytimg.com/vi/<id>/maxresdefault.jpg (no specific
  video checked).

Text sources:

- https://gamerempire.net/raft-how-to-remove-foundations/
- https://gamerempire.net/raft-how-to-destroy-floors/
- https://www.touchtapplay.com/raft-how-to-remove-foundations/
- https://steamcommunity.com/app/648800/discussions/0/1694922526917025023/
- https://steamcommunity.com/app/648800/discussions/0/3044979493850970074/
- https://itch.io/t/55143/building-hammer-controls
- https://itch.io/post/287304 (red ghost dev reply)
- https://steamcommunity.com/sharedfiles/filedetails/?id=1393150790
- https://www.pwrdown.com/gaming/raft-controls-and-how-to-change-them/
- https://raft.fandom.com/wiki/Inventory , /wiki/Backpack , /wiki/Foundation
- https://raft.fandom.com/wiki/Controls
- https://steamdb.info/patchnotes/11125169
- https://gameplay.tips/guides/2464-raft.html (oxygen bar note)
