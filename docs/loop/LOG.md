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

## Round 2: claude/loop-ux-202611210603 (base: origin/claude/raft-integration 8cff3ec + round 1 merged)

The round-1 branch had never landed in integration, so it was merged first (399253e). A parallel session had pushed a different merge to claude/loop-ux-202611210547, so this round uses its own branch name.

Fleet: 8 subsystem hunters (lock, craft, build, hook, survival, net, input, hud), 1 new-player UX reviewer reading screenshots, and 1 crafting UX builder. Every findings file went to 2 adversarial verifiers (18 in all), and 8 fixers each added regression tests.

### Fixed (confirmed by both verifiers)
- **Cursor and lock (LOCK-1..4):**
  - In real Chrome, Esc from the inventory, pause or crew granted the lock and then lost it. Playwright's key events hid this because they carry no native key code.
  - The Escape keyup now calls preventDefault, and the relock is deferred.
  - A failed relock no longer leaves a hidden cursor with no prompt.
  - Holding Esc opens pause.
  - Drag-look mode keeps its cursor.
  - New e2e test `tests/e2e/esc-relock.py` uses raw CDP Esc with native code 27. It fails before the fix and passes after.
- **Crafting:**
  - Craftable recipes sort first.
  - Ingredient sources are shown ("found floating", "craft it ›" jumps to the recipe).
  - A pinned recipe tracker on the HUD edge.
  - Owned/needed chips on every recipe row and in the tooltips; the slot tooltip says "stack".
  - Readable hammer and rod icons, and 3D icons for cup, seed and water.
  - The ×N count and "hold: up to N" respect free bag space.
  - The first open picks a ready recipe.
  - Holding to craft ends on "Crafted N" instead of grey "Missing materials".
  - Feed rows use the same 3D icons.
- **No centred popups (HUD-1..6, UX-2, UX-7):**
  - The live-update toast goes to the feed; before play it sits bottom-left.
  - The feed docks into lanes inside the open bag and the pause rail, so it never covers buttons.
  - Feed width is capped left of the hotbar.
  - The bag's top edge is pinned, so tabs no longer jump.
  - Guide keycaps and the title brand are readable.
- **Controls (INPUT-1..4):**
  - Held W/Shift survive opening and closing a panel.
  - A spike filter replaces the ±200 look clamp, so fast flicks are kept.
  - Physics substeps, giving the same speed and jump at any fps.
  - The wheel works over the hotbar in drag-look.
- **Building (BUILD-1..5, UX-1):**
  - Pieces can't be placed on a player.
  - The planter ghost shows the empty pot.
  - Sail and lantern footprints and colliders match the models.
  - Shift+wheel fine rotation works, and R rotate appears in the prompt and the guide.
  - X with the hammer removes a piece for about half its cost back.
  - The edge prompt shows cost and refusal reasons.
- **Hook and farming (HOOK-1/2/5, SURV-2/3/4):**
  - With a full bag the catch stays on the hook in the water, instead of teleporting back out to sea.
  - The hook can be thrown while swimming.
  - A catch survives a deck landing.
  - Empty planters dry out.
  - Harvest loot shows in the feed with icons.
  - Clear notes when a farm action fails.
- **Save and co-op (NET-1..5):**
  - A tab idle on the title no longer gets save-blocked; save status shows inline on the title.
  - A failed hot-swap keeps the desktop Esc hooks.
  - The first hook to claim an item keeps it.
  - A guest leaving no longer races the host's autosave.
  - New game resets the hints.

### Not fixed or refuted
- HOOK-4 (the rod lands a fish on its own after a bite): refuted, because it is intended.
- SURV-1 (solo pause doesn't freeze farming or drift): design question. Verifier B says freezing would have to cover the whole simulation.
- HOOK-3: a duplicate of NET-3.

### Checks
- `npm test`: 216 pass, 0 fail.
- `python shoot.py dist <out>`: no errors. After Esc from the inventory the game is locked, with no pause and no relock class.
- `tests/e2e/esc-relock.py`: PASS.

### Open for next round
- Removing a floor tile someone stands on drops them into the sea; it should be blocked.
- Pause-menu buttons don't respond to normal Playwright clicks (only JS clicks), and "Save and quit" shows a hover highlight while Resume has focus. Confirm whether real mouse clicks work.
- The hold-to-craft progress is still a bar, not a ring.
- Electron was not run here. The desktop Esc path was checked only by reading the code.
- The machine was heavily loaded, so shoot.py frame times are not comparable between runs.
