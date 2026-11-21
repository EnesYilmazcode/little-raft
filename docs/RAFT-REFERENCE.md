# Raft reference spec for Little Raft

What the game Raft does, turned into numbers we can build and QA can check. We copy mechanics, layout and feel. We never copy Raft art, icons, fonts, sounds, music or names. Little Raft is friendly: no damage, hunger, sharks or death, so those Raft systems are left out on purpose.

All pixel values are for a 1280x720 viewport and scale with viewport height (1vh = 7.2px). Times are wall-clock. Each rule has an ID (R3.1.4 = section 3.1, item 4) so reviews can cite it.

Tags: **[src]** from a public source (wikis, guides, store page). **[recall]** from knowledge of the game, not re-checked against footage. **[ours]** our design choice where Raft is unclear, where the owner asked for it, or where we want better. A QA miss on an [ours] rule is still a miss.

## 1. Starting state

1. Spawn alone on **4 foundations in a 2x2 square** [src]. Ours are 2 m tiles, so the start raft is 4x4 m.
2. The only item is the **Plastic Hook in hotbar slot 1** [src]. Bag, other slots and world stock are empty: no hammer, no wood, no rope.
3. The hook is in the right hand on the first frame of play. No tutorial text, no centre popups [ours].
4. Debris drifts past within hook range so the first throw catches something within about 10 s [recall].

## 2. Controls (PC defaults)

1. WASD move, Space jump, Shift sprint, Ctrl crouch [src].
2. LMB uses the held item (throw, reel, swing, place); RMB is the secondary (hammer: build menu) [src].
3. E interact/pick up, R rotate placement, X remove piece, Q drop held item [src].
4. Tab opens inventory and crafting; Tab or Esc closes it [src].
5. Keys 1 to 0 pick hotbar slots (**10 slots**); the wheel cycles them, wrapping at the ends [src].
6. Esc in plain play opens pause. **Esc with any panel open only closes that panel**: pause does not open, the pointer re-locks at once, no cursor is left on screen. This holds in the browser and in the Electron app [ours, owner ask].

## 3. HUD

Rule R3.0: nothing sits in the **centre 40% of the screen** (x 384 to 896, y 216 to 504) except the crosshair and the hook charge arc. No text there, ever.

### 3.1 Hotbar
1. Bottom centre; bottom edge **16px** above the screen edge [recall].
2. 10 square slots of **52px**, 4px gap, about 556px wide [ours].
3. Slot: fill `rgba(18,16,14,.55)`, 1px border `rgba(255,255,255,.14)`, radius 3px. **No wooden frame or panel** behind the row [recall: Raft slots are plain dark squares].
4. Selected: 2px border `#f1e4c3`, fill `rgba(60,52,40,.65)`, scale 1.06 over 90ms. Others do not move.
5. Slot number top-left, 10px, 55% opacity. Stack count bottom-right, 12px bold white, 1px dark shadow, hidden at 1.
6. Durability: 3px bar along the slot bottom, inset 4px. `#79c75a` above 50%, `#e3b23c` 20 to 50%, `#d9553f` below 20%.
7. Icons are **3D renders of the item model** (three-quarter view, key light upper left, transparent background), rendered once into a cache and reused. No flat SVG or emoji icons. The same icon is used in hotbar, bag, recipes and pickup feed.

### 3.2 Pickup feed (owner ask)
1. Bottom-left: 20px from the left, lowest row 24px above the bottom [ours]. Nothing else lives in this corner.
2. One row per item type: **40px 3D icon**, then `+3 Wood` in 16px semibold white with a 1px shadow. Behind it a gradient `rgba(0,0,0,.35)` to transparent, 220px wide. No box, no border.
3. Newest at the bottom; older rows move up 44px over 180ms. At most 5 rows; a 6th drops the oldest at once.
4. Row life: slide in from 24px left, opacity 0 to 1, **180ms** ease-out; hold **2.5 s**; fade **600ms**.
5. Same item while its row lives: count adds (`+3 Wood` becomes `+5 Wood`), hold timer resets, number pulses to 1.15 for 120ms.
6. Rows come from a pool of 5 DOM nodes; none are created per pickup.
7. Every gain of items shows here: hook catches, E pick-ups, harvests, crafted results. Short status lines ("Not enough wood") may also use a row with no icon.

### 3.3 Crosshair and prompts
1. Crosshair: **4px white dot**, 85% opacity, 1px dark halo [recall]. No ring.
2. Over something usable the dot grows to 8px over 80ms. No text beside it.
3. Key prompts (`E Pick up`, `R Rotate`) sit on one line **12px above the hotbar**, 13px text, 70% opacity, key in a small outlined box.
4. Hook charge: a **2px arc around the crosshair**, radius 12px, filling clockwise from 12 o'clock. No bar, no "THROW POWER" label [ours].
5. No hint pills ("Hold click to reel") anywhere; the hands show what to do.

## 4. Hands and held items (viewmodel)

1. Hands and held item render in their own pass with a **fixed 60 degree vertical FOV** and depth cleared first, so they never clip into walls and do not stretch with the FOV setting [ours].
2. Hands are 3D: forearm sleeve, palm, five separate fingers with at least 2 segments, skin tone with soft shading. Never flat sprites [ours].
3. Right hand holds the active item, item origin near camera-space `(0.30, -0.30, -0.55)`, filling no more than the **lower-right 30%** of the screen at rest.
4. Every hotbar item has a held 3D model. An item without a custom model shows its model scaled to about 0.25 m in the right hand. An empty slot shows a relaxed empty hand, or no hands.
5. Switching: old item drops out over **120ms**, new one rises over **180ms** with slight overshoot.
6. Walk bob 8mm vertical and 5mm sideways at about 1.8 Hz (2.4 Hz sprinting); idle breathing 3mm at 0.25 Hz.
7. Look lag: the viewmodel trails camera rotation through a critically damped spring, about 2 to 4 degrees behind on fast turns.
8. **Placing pose (owner ask):** holding the hammer or any placeable, the right hand **points**: index straight, other fingers curled, thumb tucked, aimed at the ghost. Blend in over 120ms. API: `hands.setPose('point' | 'idle' | ...)`.
9. Hand meshes and materials are built once; poses only move groups/bones.

## 5. Hook: charge, throw, float, reel

1. **Charge:** hold LMB; power goes 15% to 100% over **0.9 s** [src: longer hold, farther throw]. The right arm draws back.
2. **Throw:** release; the arm swings forward over about 150ms; range grows with power and pitch, longest near **45 degrees up** [src]. Full-power reach about 12 to 15 m [ours].
3. **Float:** the hook lands with a small splash, bobs on the waves and stays out until reeled. A thin rope runs from the hand to the hook with visible sag.
4. **Reel:** hold LMB; the hook skims back at a steady speed; hands pull hand-over-hand at about **2.5 Hz** with a ratchet click. Releasing stops the reel and leaves the hook floating. While the hook is out, the right hand keeps a rope grip, never an open empty palm.
5. **Catch:** anything within about **1 m** of the hook attaches and rides back with it; items are collected when the hook reaches the player and each type gets one feed row.
6. The hook landing on the raft is picked straight back up with E or RMB [src].
7. Plastic Hook lasts about **40 uses** [src]; better hooks are faster and last longer.

## 6. Building

### 6.1 Hammer and foundations
1. RMB with the hammer opens a **build menu**: pieces grouped by type (foundations and floors, walls and pillars, roofs, stairs, fences) as a radial or grid menu with 3D piece icons and costs [src: categories; recall: layout].
2. Foundation costs 2 planks and 2 plastic; repair costs 1 plank [src].
3. Foundations **snap to the raft grid** and must touch an existing foundation edge [recall].
4. Ghost = the **real piece mesh**, see-through: valid `#b6ffd0` at 40%, invalid `#ff6a55` at 40%, opacity pulsing 0.32 to 0.48 at 1.2 Hz [src: green valid, red invalid]. Invalid shows for a bad spot **and** for missing materials.
5. R rotates structural pieces in **90 degree** steps [src]. X removes a piece and refunds about half [src key; recall refund].

### 6.2 Placeables and decorations (owner ask)
1. Placeables (crop plot, lantern, crate, bench, sail, palm pot) are placed from the hand by holding them, not via the hammer menu [recall].
2. **Free placement:** the ghost sits at the exact aim hit point on the deck. **No snapping to tile centres**; it can sit near a tile edge and several can share a tile [ours].
3. Valid when the rotated footprint lies over raft tiles, it does not overlap another placeable (5cm slack) and it is within 4 m reach.
4. R or wheel rotates in **15 degree** steps; the angle carries over to the next placement of the same item. Shift snaps to a 0.5 m grid [ours].
5. Ghost uses the item's own mesh in the 6.1.4 colours; one shared material per state.
6. The placed object appears exactly where the ghost was, same position and angle (no jump on confirm).

## 7. Inventory and crafting

1. Tab opens one panel over the world; the world dims to about 45% with a light blur [recall].
2. Left: crafting. A narrow vertical column of category tabs (Tools, Building, Farming, Decor, Materials), then the recipe list. Each recipe shows 3D icon, name and costs as have/need; missing counts turn red; Craft is disabled until affordable [recall].
3. Right: the bag, **20 slots in a 5x4 grid** [recall], with the hotbar row below it in the same slot style as 3.1.
4. Drag to move, right-click to split, Shift-click to move between bag and hotbar [recall].
5. Panel style: dark see-through panels (`rgba(18,16,14,.75)`), thin light borders, no heavy wooden frame [ours, matches 3.1.3].
6. Esc or Tab closes it per 2.6.

## 8. Pause menu

1. The world stays visible behind it, darkened to about 50% with a soft blur [recall].
2. A short list of large text buttons: **Resume, Options, Controls, Invite brother, Exit to title** [recall: Raft uses a short text list]. Left-aligned column 8vw from the left, title above it.
3. Buttons 280x44px, 18px text, no fill; on hover a light bar slides in from the left and the text moves 6px right over 120ms. Keyboard focus looks the same as hover.
4. Settings live under **Options** with tabs (Game, Graphics, Audio, Controls). No sliders on the first pause screen.
5. Esc on the pause screen resumes; Esc inside Options goes back one level.

## 9. Farming (planters need water)

1. Craft a **crop plot** (small: 1 seed; ours costs wood and leaves) and place it per 6.2 [src: crop plots].
2. Holding a seed and clicking a plot plants it; a **small green seedling** appears at once (not a full plant) [recall].
3. Plants **only grow while watered**. A freshly planted seed is dry. Raft waters with fresh water from a cup or bucket; rain also waters [src].
4. Ours: hold a watering container and click the plot, or rain/sea spray if we add it later. The soil turns visibly darker and wetter (`#5a3d26` dry to `#3a2718` wet) and the plant gets a **water-drop marker** when it is dry and looked at [ours].
5. Growth stages: seedling, young plant, mature with visible fruit or crop. About 3 stages over **4 to 6 minutes** of watered time; growth pauses while dry; water lasts about one stage [ours; Raft times vary per crop].
6. E on a mature plant harvests it: the crop goes to the bag with a feed row, the plot is empty again; some crops return seeds [src].
7. No birds eat crops in Little Raft (Raft has seagulls; left out as unfriendly).

## 10. Ocean, sky and world

1. **Sky:** clear blue day. Zenith about `#5fa8e0`, horizon about `#cfe6f3` [recall]. White cumulus with light grey bellies `#c9d3db`; never grey-green or teal haze.
2. **Ocean:** saturated blue-green. Deep `#1d5f7a`, crests `#3aa6b8`, white foam where waves break against the raft; a bright sun glint path [recall].
3. Swells 0.3 to 0.5 m with a 4 to 6 s period plus fine ripples; the raft bobs and tilts slightly with them.
4. Fog colour matches the horizon so the sea fades into sky with no visible seam or band.
5. **Debris** (planks, palm leaves, plastic, barrels) drifts toward and past the raft; something new in hook range every 1 to 2 s early on. Barrels hold several items [src].
6. Islands are **rare landmarks**: open sea in most directions most of the time, never a permanent ring of islands [recall].

## 11. Audio

1. Constant **ocean ambience**: soft wave wash plus light wind, looping without an audible seam [recall].
2. Hook: whoosh on throw, plop/splash on landing, ratchet clicks while reeling (one per pull, about 2.5 Hz), wet pop on catch [recall].
3. Pickup: short soft pop per feed row; at most one per 80ms when several arrive together [ours].
4. Building: wooden knock when a piece is placed, dull thud on remove; crafting: short tool sound [recall].
5. Footsteps: hollow wood on the deck, soft splash when stepping or jumping into water [recall].
6. UI: quiet tick on hover/select; no harsh beeps. Music, if any, is sparse and calm [recall].
7. All sounds are synthesised or our own recordings and obey the master volume.

## 12. Performance targets

1. 60 fps on a mid laptop at 1080p, medium preset. No per-frame allocations in the render loop.
2. Input to visible response on the same frame as the click.
3. HUD animations use `transform` and `opacity` only.
4. Icons, ghost materials, hand meshes, models and feed rows are made once and reused. Opening the inventory or picking items up causes no frame hitch over 50ms.

## Sources

Wikipedia "Raft (video game)"; community wiki pages on controls, hooks, building costs and crop plots; Steam community threads on hook charge and reel. [recall] items should be checked against gameplay footage before being treated as exact.
