# Menus spec: main menu, settings/pause, build menu panel

Scope: the title (main) menu, the settings window as seen from the title and in play, the pause flow, and the hammer build menu. In Raft the build menu is an L-shaped panel, a cost card plus a vertical category column with a flyout of variants. It is not a radial. Reference images are of Raft (Redbeet Interactive) and are for internal study only. Nothing here is a licence to copy Raft's logo, fonts, icons, parchment skin or textures.

Known gaps with no images: the pause list (Resume/Save/Quit), the new-game, load-world and join-world screens, and the Controls and Audio settings tabs. Every claim about these is marked "(from memory, unverified)".

Measurement method: scratchpad scripts in `.../scratchpad/menus/` (m.py for colours, p.py, s.py and t.py for luminance profiles and bright-text masks). Colours are the median of a 5x5 or 7x7 patch at the given (x,y). Percentages are of the full image.

## 1. Images examined (opened and viewed)

Paths are relative to `references/raft/`.
- `stills/press/2020-10-08-update-12-the-second-chapter-out-now-23.jpg` (1280x698): main menu
- `stills/press/2020-10-08-update-12-the-second-chapter-out-now-25.jpg` (1280x698): main menu with a different backdrop
- `stills/press/2018-08-15-update-6-auto-saving-bug-fixes-and-a-new-02.jpg` (820x488): Settings, General tab, close-up
- `stills/press/2018-06-11-raft-update-1-02-02.jpg` (1270x712): Settings, Graphics tab, open during play
- `stills/press/2021-06-24-hotfix-13-01-01.jpg` (1093x847): build menu, high resolution
- `building/yt/M4AhtY9BB1I_0018.jpg` (960x540): hammer HUD before the menu opens
- `building/yt/M4AhtY9BB1I_0024.jpg`: build menu, pillar flyout
- `building/yt/M4AhtY9BB1I_0030.jpg`: build menu, repair entry
- `building/yt/M4AhtY9BB1I_0148.jpg`: build menu with an unaffordable cost
- `building/yt/iVT88Yq-PU0_0032.jpg`: build menu with an L-shaped wall flyout
- `stills/steam/community_148.jpg` (1280x720): NPC dialogue box, for panel language

The other SELECTED.md entries (#6, #8-#23 and #25-#37) are the same layouts in different states, or neighbouring UIs: paint menu, research table, notebook. I did not measure them separately.

## 2. Observations / spec

### Main menu
- **C1. Layout.** The menu is text only, left-aligned and anchored to the bottom left. The 3D world fills the whole screen behind it, with no panel and no gradient. Evidence: `...-23.jpg` and `...-25.jpg`. Measured on `-23`:
  - Left margin: x = 25 px (2.0% W).
  - Menu block: y 470-680 (67%-97% H), so the last item sits about 2.6% H from the bottom edge. **[VERIFIED]** (re-measured: text rows y 470-678, x from 25, so bottom gap 2.6-2.9% H)
- **C2. Two tiers of items.** Evidence: `-23`, bright-text mask in t.py.
  - Three primary items (New / Load / Join World): cap height 22-23 px (3.2-3.3% H), line pitch 37 px (5.3% H), widths 9.1-10.3% W.
  - Five secondary items (Character, Settings, Help Center, Credits, Exit): cap height 13-14 px (1.9-2.0% H), pitch 22 px (3.2% H).
  - Size ratio between tiers: about 1.65:1.
  - There are no buttons, boxes or icons. Each item is bare uppercase text. **[VERIFIED]** (re-measured: primary rows 470-491/507-529/544-566, widths 9.1/10.3/9.8% W; secondary heights 12-14 px, starts 578/600/623/645/667, pitch 22-23)
- **C3. Logo.** The logo sits top left at x 2.9-18.1% W and y 5.3-29.9% H. That leaves the whole centre and right of the screen for the backdrop. Evidence: `-23`. **[VERIFIED]** (re-measured cream mask: x 3.0-18.0% W, y 5.4-29.8% H)
- **C4. Text colour.** Text is a single warm cream. Menu text median is #dcc89d and logo fill is #e8d8b6 (`-23`, mask median and patch (60,140)). The text needs no outline because it sits over sky and sea in the lower-left third. **[VERIFIED]** (my mask median #e0cb9f, within mask tolerance of #dcc89d; logo patch (60,140) #e8d8b6 exact)
- **C5. Living backdrop.** The backdrop is a live 3D raft scene with an idle seated character. It changes between launches (`-23` and `-25` show different rafts) and carries a credit plate at the top right (y 0-32 px, 4.6% H). A small community button sits bottom right (x 1125-1259, y 667-697). **[CORRECTED: was "x 1125-1265, 2% from the edges"; the button is 1.6% W from the right edge but flush with the bottom edge (y 697 of 698), probably a cropped capture. Credit plate y 0-33 and the differing rafts in -23/-25 confirmed.]**
- **C6. Navigation (from memory, unverified).** Hover brightens or shifts the item. New World opens a sub-panel for world name, mode and difficulty. Load World lists saves with a date and a delete option. **[UNSURE: no image; wiki unreachable]**

### Settings window
- **C7. Tabbed modal.** The window is one modal with four tabs (General, Controls, Graphics, Audio) and a close X at the top right. Evidence: `2018-08-15-...-02.jpg`.
  - The active tab is a light fill (#bba26a at (230,30)). Inactive tabs are dark (#5e3821 at (420,30)).
  - A rule spans the full width under the tab strip. **[VERIFIED]** (both patches re-sampled exactly. Note: the older in-play capture `2018-06-11` has a Language dropdown where the General tab sits, so the tab set changed between builds)
- **C8. Size and position in play.** Evidence: `2018-06-11-...-02.jpg`.
  - Width: x 347-918 = 45.0% W. Height: y about 183-507 = about 45.5% H.
  - Centre: (49.8% W, about 48% H).
  - Aspect: about 1.76:1 (571x324 px).
  - The panel fill is opaque: #6b5033 at (600,480). The same value appears in the close-up (#6b5033 at (400,450)). **[VERIFIED]** (edges re-measured x ~346-919, top ~184, bottom ~503-507; both #6b5033 patches exact; centre 49.8% W, 48.5% H)
- **C9. Rows.** Each row is a label on the left and a control on the right. Evidence: `2018-06-11`, column x=500 profile.
  - Row pitch is 37-38 px (5.3% H) in play and about 57 px in the 820-wide close-up (11.7% of that crop).
  - Row fills alternate (luma 68 vs 75; #65432a vs #694b2f in `2018-08-15` at (400,240) and (400,185)).
  - Control types: checkbox (VSync, AA, AO, Quick Build, Show Nametag, Auto Save 10 min), slider with a numeric readout below the track (Shadow distance 14, FOV 50), dropdown (Framerate "FPS 60", Language), and an action button (GDPR).
  - A vertical scrollbar sits inside the right edge, so the list scrolls instead of the window growing. **[CORRECTED: was "numeric readout under the knob"; the readout sits at a fixed spot under the track (x ~800 for both 14 and 50) while the knobs are at x ~741 and ~738, so it does not follow the knob. Row pitch (bands start y 249/286/324/362 in play; 57 px in the close-up), alternating fills (#65432a/#694b2f exact) and scrollbar all confirmed.]**
- **C10. Settings during play.** The world is still visible behind the window. Evidence: `2018-06-11`.
  - Stat bars stay at the bottom left and the hotbar stays at the bottom centre. The held tool stays at the right.
  - There is no blur. The panel covers about 20% of the screen area.
  - Whether the simulation pauses in solo play is not visible (from memory, unverified: single player pauses, multiplayer does not). **[VERIFIED]** (visible parts only: HUD bars, hotbar and held tool present, world sharp, area 571x324/1270x712 = 20.5%. The solo-pause point stays UNSURE, wiki unreachable)
- **C11. Pause list (from memory, unverified).** Esc opens a short vertical list: Resume, Settings, Save, Exit to main menu, and sometimes Help. Settings opens the window in C7 on top of the list. **[UNSURE: no image; wiki unreachable]**
- **C12. Controls and Audio tabs (from memory, unverified).**
  - Controls has a list of rebindable keys (action name plus a key button), mouse sensitivity, and invert Y.
  - Audio has master, music, ambient and effects sliders, each 0-100. **[UNSURE: no image; wiki unreachable]**

### Build menu (hammer)
- **C13. How to get there.** With the hammer held, before any menu opens, the screen shows:
  - Cost chips just under the crosshair: two parchment tiles with an icon and have/need text ("19/3", "15/3"), centred at about 50% W, 59% H.
  - Two key hints further down: "RMB Hold for more parts" and "MMB Block pick" at 78-83% H.
  Evidence: `M4AhtY9BB1I_0018.jpg`. The menu is opened by holding RMB and closed by releasing it on a choice (from memory, unverified). **[VERIFIED]** (re-measured chips x 448-511, y 304-332, centre 49.9% W, 58.9% H; hints y 414-451 = 76.7-83.5% H. The release-to-select part stays from memory)
- **C14. L-shaped panel, size and position.** Measured from a luminance profile on `M4AhtY9BB1I_0024.jpg` (960x540):
  - Whole panel: x 359-558 (20.7% W), y 105-414 (57.2% H).
  - Panel centre: (47.8% W, 48.0% H), so it sits on the crosshair, slightly left of centre.
  - Card part: 16.8% W. Category column: about 3.6% W.
  - Aspect (w/h px): 0.64. The high-resolution still gives 0.65 (458x708 px, x 228-686 and y 70-778 in `2021-06-24-hotfix-13-01-01.jpg`), so the proportion holds across captures. **[VERIFIED]** (re-measured `_0024`: left edge x 359, top y 105, right ~558-560, bottom 407 at the card and ~413 at the last column slot; hi-res brown mask x 229-685, y 71-776 = 457x706, aspect 0.647)
- **C15. Category column.** Evidence: `_0024`, `_0030`, `_0148`, `iVT88_0032`, `hotfix-13-01-01`.
  - Eight square slots in one column on the card's right edge: foundation, floor, pillar, wall, stairs/triangle, fence, ladder or roof, and repair/replace.
  - Slot about 34 px (3.5% W, 6.3% H). Pitch 38.5 px (7.1% H).
  - Slot fill is a lighter parchment: #a48d61 at (540,200) in `_0024`, and #988055 in the high-resolution still. **[VERIFIED]** (#a48d61 exact; slot borders re-measured at a pitch of ~37.7 px (7.0% H), within 2% of 38.5. Hi-res slots carry a vertical gradient: samples ran #97703f to #af945e, so #988055 is one point in that range)
- **C16. Flyout of variants.** The flyout grows out of the hovered category slot. Evidence:
  - Right along the same row (pillar: 4 across plus 2 down in `_0024`).
  - As an L (wall: 5 across plus 3 down in `iVT88_0032`).
  - Along the top (foundation: 7 across plus 1 down in `_0148`).
  - Along the bottom (repair/replace: 4 across in `_0030` and `hotfix`).
  - Flyout slots are the same size as column slots. The flyout never covers the card. **[CORRECTED: the wall flyout in `iVT88_0032` is not an L. It is a row of 5 with a 3-slot column hanging under the 2nd row slot, so a T with a short left arm. Pillar (4+2 down under the first slot, a true L), foundation (7 across + 1 down at the far end) and repair (4 across) are confirmed.]**
- **C17. Cost card contents, top to bottom.** Evidence: `_0024`, `_0030`, `_0148`.
  - Large icon of the selected piece at about 12-20% of the card height.
  - Title in caps with a rule under it. Title colour is #b99f6e in the high-resolution still.
  - One line of description ("Provides support for additional floors.").
  - Up to two cost rows. Each row is icon + name + have/need in large digits, right-aligned ("Plank 19/3", "Nail 11/3").
  - Rows sit on a darker band: #60422a against card #664b30 (`_0024` at (440,272) and (440,350)).
  - The bottom third or more of the card is empty, so the card has a fixed height and does not resize per item. **[CORRECTED: was "icon about 12% of the card height" and "bottom half empty". The pillar icon spans about y 124-168 of a 302 px card (14%), and the hi-res icon about 145/706 px (20%). The last cost row ends about y 315 (`_0024`) or 285 (`_0030`) of a card ending at 407, so 30-40% is empty, not half. Fixed height across `_0024/_0030/_0148/iVT88_0032` confirmed. Title #b99f6e and bands #60422a/#664b30 re-sampled exactly.]**
- **C18. Unaffordable cost.** "Metal Ingot 0/1" in `_0148` uses the same layout. The row band reads #74563a against #61412a for the affordable row, which is lighter rather than clearly red. At 480p I cannot confirm a red tint (see UNSURE). The have count of 0 is what signals the shortfall. **[VERIFIED]** (re-sampled (440,272) #725739 and (440,301) #5e4328. The have/need digits are #b4997b vs #b79d7b, so they are not red either. SELECTED.md #11's "red-tinted" description is not supported at this resolution)
- **C19. Background.** The world is not dimmed behind the build menu. Luma just outside the panel is 34-40 in `_0024`, the same as the surrounding deck. The panel is opaque and the HUD stays visible. **[VERIFIED]** (luma 34-39 at five points outside the panel)
- **C20. Panel language is shared.** Toned-down translucent dark panels are reused elsewhere, such as the NPC dialogue box in `community_148.jpg`:
  - Box: x 400-880 (37.5% W), y 588-640 (7.2% H). Fill #24211c, centred over the hotbar.
  - It has a speaker-name line and a text line. **[VERIFIED]** (re-measured box x ~400-879, y 588-641; fill #27241d vs #24211c, same within JPEG noise; centred at x 640 like the hotbar)

## 3. Comparison with Little Raft today

- **Title screen.** This is the `#welcome` overlay (dist/index.html:11).
  - It has a left card with an eyebrow, an h1 ("Small raft. Endless possibilities."), a paragraph, three pills, and two buttons: `#solo` "Let's set sail" and `#welcomeCrew` "Play with my brother".
  - It is darkened by a left-to-right gradient, rgba(6,13,20,.86) to 0 by 72% (dist/graphics.css:259). The h1 is 40-68 px (graphics.css:263).
  - The backdrop is a slow orbit camera around the raft (dist/game.js:719-722, fov 48).
  - There is no Continue/New split, no settings entry before play (only the header `#helpButton`, game.js:924), and no quit. Clicking `#solo` calls `start()` and `requestLock()` (game.js:921, 665-668), and the autosave is loaded silently.
  - Compared with C1-C3: Little Raft's menu is a vertically centred marketing card, where Raft's is a compact bottom-left list that leaves about 80% of the screen to the living scene. **[VERIFIED]** (index.html:11 markup, graphics.css:259 gradient and :263 h1 clamp(40px,5vw,68px), game.js:719-722 orbit, game.js:284 fov 48 on the title, game.js:921/924 handlers, game.js:665-668 start(), and save read at game.js:178 all confirmed; vertical centring comes from style.css `.overlay{display:flex;align-items:center}`)
- **Pause and settings.** This is `#options`, built in dist/settings.js.
  - Esc opens it while playing (settings.js:187, keydown and keyup fallbacks).
  - It is one non-tabbed panel, width min(440px,92vw), navy rgba(13,29,52,.9) (settings.js:42-43), titled "Paused" (settings.js:78).
  - Buttons: Resume, fullscreen toggle, How to play, Play together (settings.js:79-83).
  - Sliders: sensitivity 0.4-2, FOV 60-95 (default 75), camera motion 0-1, volume 0-1 (settings.js:8-13), plus a graphics select (low/medium/high).
  - Values persist to localStorage `little-raft-settings` and apply live through onChange (game.js:1183).
  - `onPause` only calls `clearInput` (game.js:1183), so the world keeps simulating while "Paused". That is fine for co-op but surprising in solo play.
  - Missing: Save now, Exit to title, a controls/keybinding view, invert Y, and separate audio channels.
  - The navy skin also clashes with the warm cream/bronze palette of the HUD and welcome screen (graphics.css `--cream`, `--bronze-lt`). **[VERIFIED]** (settings.js:8-13 SPEC, :42-43 navy and width, :78 "Paused", :79-83 buttons, Esc keydown and keyup at :195/:205, and game.js:1183 onPause:clearInput all confirmed. Also note that `#options::backdrop` is already rgba(4,12,24,.55) with blur(2px) (settings.js:45))
- **Build selection.** There is no build menu. dist/hammer.js only builds the hammer mesh (hammer.js:13 `createHammer`), with no UI.
  - The hammer builds exactly one piece, a floor at `FLOOR_COST = {wood:2, plastic:2}` (game.js:33). It goes through `useSelected` (game.js:630-634).
  - Cost is only shown when you cannot afford it, as a "Floor needs N more ..." line in `#contextPrompt` 26 px under the crosshair (game.js:407, CSS at game.js:48). The ghost also tints #ee8e75 instead of #b6ffd0 (game.js:812).
  - The old `#recipes` bar is hidden and emptied on mount (game.js:265), and CSS hides it during play (game.js:46-47).
  - RMB is swallowed (game.js:892 contextmenu preventDefault) and the wheel cycles hotbar slots (game.js:893-901). Neither opens a selector.
  - Decorations (sail, palm, lantern, net, bench, crate; game.js:27) are crafted in the bag and placed one at a time, not chosen from a build menu. **[VERIFIED]** (hammer.js:13 createHammer, game.js:33 FLOOR_COST, :630-634 useSelected build path, :407 "Floor needs" line, :48 #contextPrompt top calc(50% + 26px), :812 ghost tints, :265 and :46-47 #recipes, :892 contextmenu, :893-901 wheel, :27 DECOR_TYPES all confirmed)

## 4. Ranked change list

1. **#1 Hammer build panel: an L of a cost card and a category column, held on RMB.** Files: new `dist/build-menu.js` (do not put it in hammer.js, which is mesh only), wired in dist/game.js where RMB is currently swallowed (game.js:892).
   - Hold RMB with the hammer: a panel about 21% W x 57% H opens, centred on the crosshair. Release over a slot to select it; Esc cancels.
   - Column on the right edge: one square slot per category, about 6-7% H pitch. Start with Floor and Repair, and add Wall, Pillar, Stairs and Fence as they exist.
   - A flyout of variants grows out of the hovered slot (sideways, as an L, or as a T) and never covers the card.
   - Use Little Raft's own cream/bronze tokens and its own icons from icons.svg. Do not use a parchment texture.
   - Impact H, effort M. **[CORRECTED: flyout shapes now include a T, per the C16 correction. Ranking unchanged. Guardrail OK: own tokens and icons, no parchment]**
2. **#2 Always-on cost chips under the crosshair while the hammer is held.** dist/game.js `updateContext` (game.js:400-411) and `#contextPrompt` CSS (game.js:48-51).
   - Show one chip per material with "have/need" (for example "wood 7/2", "plastic 1/2") at about 59% H.
   - Turn the "need" number warm red when short, instead of only showing text after you fail.
   - Add a small "RMB hold: more parts" hint at about 80% H.
   - Impact H, effort S. **[VERIFIED]** (updateContext is at game.js:401-411; line 400 is `beep`)
3. **#3 Cost card content standard.** In build-menu.js:
   - Large piece icon, then the name with a rule under it, then a one-line purpose, then up to 3 cost rows (icon, name, right-aligned have/need in tabular digits) on a slightly darker band.
   - Fixed card height, so the panel does not jump between items.
   - Shortfall uses colour plus a have value of 0 or less. Do not rely on colour alone.
   - Impact M, effort S. **[VERIFIED]** (card height should leave roughly the bottom third free, per C17)
4. **#4 Split pause from settings.** dist/settings.js `markup()` (settings.js:76-90).
   - Esc shows a short pause list (Resume, Settings, How to play, Play together, Save now, Exit to title) at about 25% W, centred.
   - Settings opens a tabbed window, about 45% W x 46% H and centred, with tabs General / Controls / Graphics / Audio.
   - Rows: label on the left, control on the right, about 5% H pitch, alternating row tint, scrolling inside the panel.
   - Impact H, effort M. **[VERIFIED]**
5. **#5 Actually pause in solo play.** dist/game.js:1183.
   - When `role === 'solo'`, `onPause` should also stop simulation time (drift, hook, hunger). Keep `clearInput`-only for host and guest.
   - Show "Paused" vs "Menu (game keeps running)" in the title accordingly.
   - Impact M, effort S. **[VERIFIED]**
6. **#6 Re-skin #options to the game palette.** settings.js:42-62.
   - Replace navy rgba(13,29,52,.9) and system-ui with the cream/bronze tokens and fonts used in graphics.css, so pause, HUD and title read as one UI.
   - Make the panel opaque or near-opaque (alpha 0.95 or higher). Keep `::backdrop` light (no blur, or 2px at most) so the world still reads, as in C10.
   - Impact M, effort S. **[VERIFIED]** (the current backdrop already uses blur(2px) plus a 55% navy dim at settings.js:45, so the change is to the dim tint, not the blur)
7. **#7 Title screen as a bottom-left text list over the living raft.** dist/index.html:11, graphics.css:258-284.
   - Primary items (Continue, New raft, Play together) at about 3.2% H cap height and 5.3% H pitch. Secondary items (Settings, How to play, Credits) at about 2% H and 3.2% H pitch.
   - Block anchored 2% W from the left, ending about 3% H above the bottom.
   - Move the Little Raft wordmark to the top left (about 15% W). Keep the tagline small.
   - Shrink the dark gradient to the lower-left quadrant so the orbiting raft is the hero.
   - Impact M, effort M. **[VERIFIED]** (this is a layout pattern only, using Little Raft's own wordmark and fonts, so the guardrail is OK)
8. **#8 Continue vs New raft.** dist/game.js `start()` (game.js:665) and the load path.
   - If a save exists, the first item is "Continue" and shows the raft size or last played time.
   - "New raft" asks for confirmation before it overwrites the single save slot.
   - Impact M, effort S. **[VERIFIED]**
9. **#9 Settings entry on the title screen.** game.js:924 and index.html:11. Add Settings to the title list so FOV, sensitivity and volume can be set before first lock. Today they are only reachable from the header icon. Impact M, effort S. **[VERIFIED]**
10. **#10 Controls tab.** settings.js `SPEC` (settings.js:8-13).
    - Add invert-Y and a read-only key list, generated from the same text as the `#help .guide` (game.js:268-276).
    - Rebinding can come later.
    - Impact L, effort S. **[VERIFIED]**
11. **#11 Audio tab with channels.** settings.js:12 and game.js `beep` (game.js:400). Split `volume` into master, effects and ambience (ocean/wind), each 0-100 with a numeric readout. Impact L, effort S. **[VERIFIED]**
12. **#12 Rotating title backdrops.** game.js:719-722. Pick one of 3-4 camera paths or times of day per launch (seeded), and optionally show the player's own saved raft. This gets the effect of C5 without Raft's community credit plate. Impact L, effort M. **[VERIFIED]**
13. **#13 Slider readouts and keyboard navigation.** Do this for the settings rows and for the build panel slots.
    - Put the value beside or under the slider knob.
    - Arrow keys move between rows or slots, Enter selects, Esc backs out one level (build panel, then pause list, then game).
    - Impact L, effort S. **[VERIFIED]**

## 5. Open questions / UNSURE

- C18: Raft's shortfall styling (red text or red band) cannot be confirmed at 480p. The sampled band is lighter, not redder.
- C10/C11: whether Raft pauses the simulation in solo play, and the exact contents of the pause list. No image (from memory, unverified).
- C6/C12: the new/load/join screens and the Controls/Audio tabs are from memory only and need a source before anyone relies on them.
- Timing: there are no consecutive frames covering open and close, so the RMB hold threshold and any open animation are unknown. Suggest 0.15-0.2 s hold and a 0.1 s fade (from memory, unverified).
- C8's height is approximate because the hotbar, which is also brown, contaminates the colour mask. The width (45.0% W) is reliable.
- Scope for #1: with only floors buildable today, the panel's value grows as pieces are added (see docs/specs/building.md). Until then, #2 gives most of the benefit for little effort.

## Verification log

Counts: VERIFIED 28 (13 claims, 3 Section 3 comparison blocks, 12 change items), CORRECTED 5 (C5, C9, C16, C17, change #1), UNSURE 3 (C6, C11, C12: no image, wiki unreachable).

Method:
- I opened every cited image with Read and checked it by eye.
- I re-measured with the scratchpad venv Python (Pillow/numpy). Scripts are in `scratchpad/menus-skeptic/` (mm.py, mm2.py, st.py, bm.py, hr.py, c18.py, c13.py). They take colour masks for the menu text and logo, luminance profiles along rows and columns for panel edges and row pitch, and 5x5 or 7x7 median patches at the stated coordinates.
- I checked every dist/ file:line by reading the lines.
- No git commands were run and no network was used.

Images re-checked:
- `stills/press/2020-10-08-...-23.jpg` and `-25.jpg`
- `stills/press/2018-08-15-...-02.jpg`
- `stills/press/2018-06-11-raft-update-1-02-02.jpg`
- `stills/press/2021-06-24-hotfix-13-01-01.jpg`
- `building/yt/M4AhtY9BB1I_0018.jpg`, `_0024.jpg`, `_0030.jpg`, `_0148.jpg`
- `building/yt/iVT88Yq-PU0_0032.jpg`
- `stills/steam/community_148.jpg`

Key corrections:
- C17: the cost-card icon is 12-20% of the card height, not 12%, and the empty area is the bottom 30-40%, not half.
- C16: the wall flyout is a T, not an L.
- C9: the slider readouts sit at a fixed spot under the track and do not follow the knob.
- C5: the community button is flush with the bottom edge.

Other notes:
- dist/ references were all accurate. game.js:400 is `beep`, and `updateContext` starts at :401.
- No change item tells us to copy Raft's logo, icons, fonts, parchment skin or creature designs.
- The ranking is unchanged, since no correction alters impact or effort.

