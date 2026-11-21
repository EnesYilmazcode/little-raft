# Little Raft improvement loop log

## Round 1: claude/loop-ux-202611210451 (base: origin/claude/raft-integration d5419eb)

Fleet: 8 subsystem bug hunters, 2 independent adversarial verifiers per bug report (16), 7 fixers each with regression tests, 1 new-player UX reviewer reading screenshots, and 1 crafting UX builder.

### Fixed (confirmed by both verifiers)
- **Cursor (CUR-1..5, LIVE-5):**
  - Esc from the inventory or crafting relocks straight into play. The activation pre-check is gone.
  - SecurityError and WrongDocumentError are treated as temporary, so the game no longer sticks in drag-look forever.
  - The resume hint can be clicked.
  - Closing Help or Crew from the pause menu returns to the pause menu.
  - Held-Esc key repeat no longer reopens the pause menu.
  - Electron: `before-input-event` swallows Esc while a panel is open, then closes it and relocks via `executeJavaScript(code, true)`. Panel state reaches the shell through `window.raftShell` and console sentinels.
- **No centred popups (HUD-1/2, INV-2/3, CRA-1):**
  - All notices go to an edge stack at the bottom-left, which stays visible while the bag is open.
  - Prompts, the throw meter and the resume hint moved to the edges.
- **Crafting UX:**
  - Category tabs with craftable-count badges.
  - Cached 3D item icons rendered from the real meshes.
  - Owned/needed rows shown in green or red.
  - A detail card with a Craft button: click crafts one; holding repeats faster and faster, with a fill bar and a +N counter.
  - Tooltips anchored beside the hovered element.
- **Inventory (INV-1/4/5/6):**
  - Closing on the backdrop needs both the press and the release on it.
  - E closes the bag.
  - Tab and the arrow keys navigate inside the bag.
  - The right-click hint is corrected, and refused placements show a reason.
- **HUD and audio (HUD-3..6, UX-1):**
  - Help text contrast fixed.
  - The sound toggle is saved.
  - Ocean audio is wired in, replacing the beeps.
  - Drag-look follows the sensitivity setting.
  - A first-run hint chain was added.
- **Movement and building (MOV-1..4):**
  - Climbing onto the raft beside a prop no longer leaves you inside it.
  - A 0.12 s jump buffer was added.
  - The world bound and tile cap now apply to the ghost, with a notice.
  - Building reach is limited to 6 m.
- **Hook (HOOK-1/2/4/5):**
  - R repairs the worn hook.
  - The hook stops on deck tiles.
  - The dead condition widget was removed, along with a stale test.
- **Net and co-op (CRA-3/4/5, HOOK-3):**
  - The net picks the first item that fits the bag.
  - The guest's held tokens are protected on the host.
  - The bench collider matches its mesh.
- **Fishing (FISH-1..5):**
  - Releasing the mouse never fires a tool switched to mid-press.
  - A distinct rod icon.
  - A real bobber.
  - A cast can be reeled in or cancelled, with a prompt.
  - The fish count is written.
- **Live, save and co-op (LIVE-1/2/3/6):**
  - Hidden tabs no longer drop co-op, thanks to a heartbeat, visibility messages and a 20 s timeout.
  - Network and save timers run on wall-clock time.
  - The game saves on hide and on pagehide.
  - The live loader knows the boot build and protocol.
  - A save revision guard stops two tabs clobbering each other's saves.

### Not fixed or refuted
- LIVE-4: refuted, because the crew button is hidden during play.
- MOV-5: the walkable surface doesn't follow raft tilt. Design-level, deferred.

### Checks
- `npm test`: 98 pass, 0 fail. It now runs `tests/*.test.mjs`.
- `python shoot.py dist <out>`: no page errors, and Esc from the inventory does not open the pause menu.
- Pointer-lock probe with real headless pointer lock: relocks after Esc from the inventory using Playwright keys, after the shell escape, after injected SecurityError and WrongDocumentError, after clicking the hint, and through the pause → Help → Esc path.

### Open for next round
- A raw CDP held-Esc sequence (rawKeyDown with autoRepeat, then keyUp) from the open inventory requests the lock but ends unlocked with the hint showing. Playwright keyboard events pass. Next round should establish whether real OS key input behaves like the raw path.
- In plain Chrome, Esc from the pause menu still needs one click to relock. The Electron shell covers it.
- The inventory and pause panels are still centred modals (UX-2/UX-8). Consider docked or side-sheet layouts.
- Title screen copy and the pause menu styling (UX-7/UX-8).

## Round 2: claude/loop-ux-202611210547 (base: origin/claude/raft-integration 7d19797 + round 1 merged in e4c3aee)

Fleet:
- 4 subsystem hunters: cursor/Electron, crafting/backpack, menus/settings, tools/viewmodel.
- 2 adversarial verifiers per hunter report (8).
- 5 fixers.
- 1 new-player UX reviewer, reading screenshots.
- 1 crafting UX builder.
- 1 merge agent.

### Merge
Round 1 was merged into raft-integration, keeping both sides:
- integration's dark translucent restyle, menus, pickup feed and hands viewmodel;
- loop-ux's lock rules, edge notices and crafting features.

The two item-icon modules became one shared cache.

### Fixed (each confirmed by both verifiers)
- **Cursor (CUR2-1..5)**, found with real X11 keys in headful Chrome:
  - A relock made inside the Esc keyup was granted and then dropped by Chrome's Escape key-release shortcut. The relock is now deferred 250 ms, with guards.
  - Chrome sometimes eats the Esc in locked play. Any lock loss the page didn't cause now opens the pause menu if the window is focused.
  - Electron:
    - on an eaten-Esc keyUp, `raftShell.escapedLock()` runs with a gesture;
    - on window focus, `raftShell.focusRelock()` relocks after alt-tab, but only if play was locked and nothing is open;
    - a gesture retry covers the Escape cooldown;
    - the extra key-release round trip is gone.
  - In the desktop app, Esc while holding a stack in the bag now puts the stack back first.
- **Menus (MEN2-1..5):**
  - The ambience slider is wired up, with its gain after the swell.
  - The title help button no longer shows Resume or Quit, and quit-to-title is a no-op on the title screen.
  - The shell Escape goes through settings' stepwise routing.
  - The default renderScale is now 0.85.
  - The Audio tab has a Sound toggle.
- **Tools (TOOL2-1..5):**
  - A cancelled hand swap rises back instead of staying half-lowered.
  - A pose override waits for its own item.
  - models.js is wired into held items and icons, with a fallback.
  - Rod prompts no longer invite a losing click.
  - Switching slots pulls the hook back, ported from lane-bugs 53426f0.
- **Crafting (CRA2-1..6 + builder):**
  - The crafting panel no longer jumps between tabs.
  - Esc or a backdrop click while holding a stack puts it back.
  - A stack picked up with the keyboard sits on its slot.
  - No overflow between 861 and 923 px.
  - The icon fallback is shared with the pickup feed.
  - Tooltips show on focus.
  - Inline ingredient counts.
  - Craftable recipes sort first.
  - A pinned-recipe tracker sits at the top-right edge.
  - Shift crafts the maximum.
  - Tools craft one at a time.
  - The bag opens on the first ready recipe the player doesn't own yet.
  - Counts read "have X · need Y".
  - Clicking an ingredient jumps to its recipe.
  - A slot flashes after crafting.
- **UX (UX2-2/3/6/7/8):**
  - Help shows in the pause side panel.
  - Action prompts are in the edge stack.
  - The hint chain teaches look → walk → throw → bag → slots.
  - Key and reel wording is unified.
  - The throw meter has a gradient fill and a full-power cue.
  - One palette and font across all menus.
  - Segmented preset picker.
  - Title: a legible logo and a single "Play together" button.

### Checks
- `npm test`: 166 pass, 0 fail.
- `python shoot.py dist <out>`: no page or console errors. The pause menu is a left rail; the bag shows inline counts.
- `python tests/e2e/escape_lock.py`: the Esc-from-inventory relock and locked-play Esc → pause pass with native key codes, 3/3 in my run and 5/5 in the fixer's. The fixer measured HEAD before the fix at 0/5.
- XTest real-key trials: 15/15, from the fixer.

### Open for next round
- None of the Electron main.cjs paths have ever run. They have only been reasoned from source and checked in a node sim. A real desktop run is needed.
- The focus relock also fires when the player returns by clicking the title bar or taskbar, which is debatable.
- Play together is still a separate centred dialog.
- The Hammer and Fishing Rod icons are still dim on their tiles.
