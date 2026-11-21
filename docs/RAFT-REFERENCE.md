# Raft reference spec for Little Raft

What the game Raft does, turned into numbers we can build and check against. We copy mechanics, layout and feel. We never copy Raft art, icons, fonts, sounds or names.

All pixel values are for a 1280x720 viewport. Scale them with viewport height (1vh = 7.2px), so the HUD looks the same on any screen.

Confidence tags: **[src]** taken from a public source (Wikipedia, community wikis and guides, Steam threads). **[recall]** from knowledge of the game, not confirmed this session. **[ours]** our own design choice where Raft is unclear or we want to do better.

## 1. Starting state

1. The player spawns alone on a raft of **4 foundations in a 2x2 square** [src: Wikipedia, "a small raft with four panels"].
2. The only item is a **Plastic Hook** in hotbar slot 1 [src]. Nothing else in the bag, no hammer, no rope.
3. The first minute teaches itself: debris drifts past within hook range, so the first throw lands on something within about 10 s [recall].
4. A Raft foundation is about 1.5 m square [recall]. Ours is 2 m, which is fine, but the start raft should be **2x2 tiles (4x4 m)**, not 3x3. A small raft makes the first expansion feel earned.

## 2. Controls (PC defaults)

1. WASD move, Space jump, Shift sprint, Ctrl crouch or dive [src].
2. LMB uses the held item: throw the hook, swing, place [src].
3. RMB is the secondary action. With the hammer it opens the build menu [src].
4. E interacts and picks up, R rotates a placement, X removes a placed piece, Q drops the held item [src].
5. Tab or I opens the inventory and crafting [src]. Tab again or Esc closes it.
6. Number keys 1 to 0 pick hotbar slots, so the hotbar has **10 slots**; the scroll wheel cycles them [src].
7. Esc on the plain game opens pause. Esc while any panel is open only closes that panel [ours, matches the owner's ask].

## 3. HUD layout

The rule: nothing ever sits in the centre 40% of the screen except the crosshair.

### 3.1 Hotbar
1. Bottom centre, bottom edge 16px (2.2vh) above the screen edge [recall].
2. 10 square slots of **52px (7.2vh)**, 4px gap, about 560px total (44% of width) [ours].
3. Slot fill: dark see-through, `rgba(18,16,14,.55)`, 1px border `rgba(255,255,255,.14)`, corner radius 3px. No thick wooden frame around the bar [recall: Raft slots are plain dark squares].
4. Selected slot: 2px warm border `#f1e4c3`, fill lifted to `rgba(60,52,40,.65)`, scaled to 1.06 over 90ms. The other slots stay put.
5. Slot number top-left, 10px, 55% opacity. Stack count bottom-right, 12px bold white with a 1px dark shadow, hidden when the count is 1.
6. Tools show durability as a 3px bar along the slot bottom, inset 4px. Green `#79c75a` above 50%, amber `#e3b23c` from 20 to 50%, red `#d9553f` below 20%.
7. Icons are **rendered 3D models** of the item (three-quarter view, soft key light), drawn once into an icon atlas and reused. Never redraw them per frame.

### 3.2 Survival stats (for later)
1. Raft has health, thirst and hunger as three thin horizontal bars with an icon each, near a bottom corner [src: guides place them bottom-left].
2. Bottom-left is ours for the pickup feed, so when stats ship they go **bottom-right**: three 120x6px bars, 6px apart, with 14px icons [ours].
3. Thirst drains faster than hunger. At zero either one, health drains [src].

### 3.3 Pickup feed (owner ask)
1. Anchored bottom-left: 20px from the left, bottom row 24px above the screen bottom [ours].
2. One row per item type: a **40px 3D icon** (same atlas as the hotbar), then `+3 Wood` in 16px semibold white with a 1px shadow. Behind it a left-to-right fade, `rgba(0,0,0,.35)` to transparent, 220px wide. No box, no border.
3. Newest row at the bottom, older rows push up 44px over 180ms. Show at most 5 rows; the 6th drops the oldest at once.
4. Life of a row: slides in from 24px left with opacity 0 to 1 over **180ms** ease-out, holds **2.5 s**, fades out over **600ms**.
5. Catching the same item while its row is alive adds to the count (`+3 Wood` becomes `+5 Wood`), resets the hold timer and pulses the number to 1.15 scale for 120ms.
6. Rows are DOM nodes from a pool of 5. Reuse them, never create one per pickup.

### 3.4 Crosshair and prompts
1. Crosshair: a 4px white dot at 85% opacity [recall: Raft uses a small dot]. Our 18px ring is too big.
2. When the aim is on something usable, the dot grows to 8px over 80ms. No text next to it.
3. Key prompts (`E Pick up`, `R Rotate`) go in one line **just above the hotbar**, 13px, 70% opacity. Never in the centre.
4. Hook charge has no text label. Show it as a **2px arc around the crosshair** (radius 12px) filling clockwise, plus the arm pulling back in the viewmodel [ours].
5. Status lines ("Hook repaired", "Not enough wood") use the pickup feed slot, or a short line above the hotbar. No pill at 25% screen height.

## 4. First-person viewmodel

1. Draw the hands and held item as a separate pass: own camera, **fixed 60 degree FOV**, depth cleared before it. Hands never clip into walls and do not stretch when the player changes FOV [ours, standard FPS practice].
2. The right hand holds the active item, item origin near camera-space `(0.30, -0.30, -0.55)`. The left hand stays in view only when the item needs two hands (hook rope coil, reeling, hammer swing).
3. Every hotbar item has a held 3D model. An item with no custom model shows its icon mesh scaled to about 0.25 m in the right hand. Never show an empty hand while a slot holds something.
4. Switching items: the old one drops out of view over **120ms**, the new one rises over **180ms** with a slight overshoot.
5. Walk bob: 8mm vertical and 5mm sideways, tied to the footstep rhythm (about 1.8 Hz walking, 2.4 Hz sprinting). Idle breathing: 3mm at 0.25 Hz.
6. Look lag: the viewmodel follows camera rotation through a spring (stiffness about 120, critically damped), so fast mouse moves leave the hands about 2 to 4 degrees behind.
7. **Placing pose (owner ask):** while holding the hammer or a placeable, the right hand shows a **pointing finger** (index straight, other fingers curled, thumb tucked) aimed at the ghost. Blend into it over 120ms.
8. Materials and geometry for the hands are built once and shared. Pose changes only move bones or groups, never rebuild meshes.

## 5. Hook: throw, float, reel

1. **Charge:** hold LMB. Power rises from 15% to 100% over about **0.9 to 1 s** [src: longer hold throws farther]. The arm draws back as it charges.
2. **Throw:** release to throw. Range grows with charge and with aim pitch, longest around **45 degrees up** [src]. The arm swings forward over about 150ms.
3. **Float:** the hook lands, bobs on the waves, and stays out until reeled. The rope is a thin line from the left hand to the hook with a little sag.
4. **Reel:** hold LMB. The hook skims back on the water at a steady speed; both hands do a hand-over-hand pull at about 2.5 Hz with a soft ratchet click. Letting go stops the reel and leaves the hook floating.
5. **Catch:** anything the hook passes within about **1 m** of attaches and rides back with it. Collection happens when it reaches the hand, and each item then gets one pickup-feed row.
6. **Stuck on the raft:** if the hook lands on the raft, RMB or E picks it straight back up [src].
7. **Durability:** a Plastic Hook breaks after about **40 uses** [src]. Better hooks throw and reel faster and last longer (Scrap about 100, Titanium about 200) [src].

## 6. Building

### 6.1 Hammer and foundations
1. RMB with the hammer opens a build menu: a grid or wheel of pieces grouped by type (foundations and floors, walls and pillars, roofs, stairs, fences) [src: categories].
2. A foundation costs **2 planks and 2 plastic** [src]. Repair costs 1 plank [src].
3. Foundations **snap to the raft grid** and need at least one side touching an existing foundation [recall].
4. The ghost is the **real piece mesh**, see-through: valid is a cool white-green (`#b6ffd0` at 40% opacity is fine), invalid is red `#ff6a55` at 40% [src: green preview; red for bad spots]. A slow pulse (opacity 0.32 to 0.48 at 1.2 Hz) helps it read against the deck.
5. R rotates structural pieces in **90 degree** steps [src].
6. X (or hold RMB) removes a piece and refunds some of its cost [src for the key, recall for the refund].

### 6.2 Placeables and decorations (owner ask)
1. Held placeables (crop plot, lantern, crate, bench) are placed from the hand, not the hammer menu [recall].
2. **Free placement:** the ghost follows the exact point where the aim ray hits the deck. No snapping to tile centres. It can sit near a tile edge [ours, matches owner ask].
3. Valid when: the whole footprint (corners of its rotated base) sits over raft tiles, it does not overlap another placeable (circle or box test with 5cm slack), and the spot is within 4 m reach.
4. R or the scroll wheel rotates in **15 degree** steps, with the rotation kept between placements of the same item. Hold Shift to snap to the 0.5 m grid when you want neat rows [ours].
5. The ghost is the item's own mesh in the same see-through valid and invalid colours. One cloned material per state, made once.

## 7. Inventory and crafting

1. Tab opens one full-screen panel over the paused-looking world (world dims to 45%, slight blur) [recall].
2. Left side: crafting. Category tabs in a narrow vertical column of icons, then the recipe list for the active tab. Each recipe shows its icon, name and cost with have/need counts; missing counts turn red [recall].
3. Right side: the bag grid (20 slots, 5 per row in Raft) [recall] with the hotbar row underneath, same slot look as the in-game hotbar.
4. Drag to move, click to pick up, right-click to split, Shift-click to move between bag and hotbar [recall].
5. Esc or Tab closes it and **re-locks the pointer at once**, with no pause menu and no free cursor left behind.

## 8. Pause menu

1. The world stays visible behind it, darkened to about 50% with a soft blur [recall].
2. A single left-aligned column at about 8vw from the left: the game logo or title, then large text buttons: **Resume, Options, Controls, Invite friend, Exit to menu** [recall: Raft uses a short text-button list].
3. Buttons 280x44px, 18px text, no fill; on hover a light bar slides in from the left and the text moves 6px right over 120ms.
4. Settings live inside **Options** with tabs (Game, Graphics, Audio, Controls), not as sliders on the first screen.

## 9. Ocean, sky and debris

1. **Sky:** clear blue by day. Zenith about `#5fa8e0`, horizon about `#cfe6f3` [recall]. White cumulus clouds with light grey undersides `#c9d3db`, never dark teal.
2. **Ocean:** saturated blue-green. Deep `#1d5f7a`, shallow and wave crests `#3aa6b8`, foam white [recall]. Strong sun glint path toward the sun.
3. Gentle swells about 0.3 to 0.5 m high with a period of about 4 to 6 s, plus fine ripples. The raft bobs with them a little.
4. **Debris** drifts in a band toward and past the raft: planks, palm leaves, plastic and barrels [src: Wikipedia]. Something new enters hook range every 1 to 2 s at the start. Barrels hold several items.
5. Islands on the horizon are rare landmarks, not a constant ring around the raft.

## 10. Feel and performance targets

1. 60 fps on a mid laptop at 1080p on the medium preset. No per-frame allocations in the render loop.
2. Input to visible response: the viewmodel reacts on the same frame as the click.
3. Every HUD animation runs on `transform` and `opacity` only.
4. Thumbnails, ghost materials, hand meshes and feed rows are made once and reused.

## Sources used

Wikipedia "Raft (video game)"; bloxodes.com Raft wiki (controls, hook uses); magicgameworld.com build-cost list (2018) and controls page; Steam community threads on hook charge and reel; Raft fan wiki search snippets (the wiki itself blocked direct fetching). Anything tagged [recall] should be checked against real gameplay footage before it is treated as exact.
