# Little Raft — QA audit of `main` (bc5df84)

Audit date: 2026-11-21. Scope: the shipped `dist/` build. Nothing in `dist/` was changed.

## Method

- **Auditors:** 12 lanes, each run separately: hook/rope, inventory, crafting, building, fishing, movement/swimming, save/load and migration, live hot-swap, networking, UI/CSS (1280x720, 1920x1080, 2560x1440, DPR 1 and 2), audio, render performance (allocations, draw calls, 5-minute memory run).
  - Each auditor read its code and drove the real game headlessly (Chromium + SwiftShader, real mouse and keyboard input, `window.raftDebug`), or imported the pure modules in node.
- **Verifiers:** every reported bug went to at least two independent verifiers who tried to refute it. One re-checked the auditor's repro; the other reproduced it from scratch without seeing it.
  - Kept: findings both verifiers confirmed, or one confirmed and one rated "partial" (real but smaller). The severity used is the verifiers' corrected one.
  - Dropped: findings either verifier refuted (listed at the end).
- **Regression tests:** each kept finding has a regression test in `tests/audit/`. Every test **fails on this commit** and is written to pass once the bug is fixed.
  - For PERF-1, LIVE-3 and UI-5, the test was also run against a patched copy of `dist/` with the suggested fix, and it passed.

### Running the audit tests

```
tests/audit/run.sh                        # everything; exits nonzero while any bug remains
node --test tests/audit/*.test.mjs        # fast node-only tests
python tests/audit/<name>.py              # one browser test; exit 0 = fixed, 1 = bug present, 2 = inconclusive
```

- **Requirements:** Python `playwright` and a Chromium. The tests use `/opt/pw-browsers/chromium` when it exists; set `CHROMIUM=<binary>` to use a different one.
- **Testing a candidate build:** set `RAFT_DIST=<dir>`.
- **Timing:** browser tests allow long timeouts, because software GL runs at roughly 1–5 fps. LIVE-2 takes about 70 s by design.
- **Helpers:** `_harness.py` (static server on port 0 plus browser launch), `_save.py` (save fixtures) and `_fakenet.py` (an in-process fake PeerJS transport that joins two pages, so co-op runs without the public broker).

## Summary

| # | ID | Severity | Title | Test |
|---|----|----------|-------|------|
| 1 | PERF-1 | **High** | Every live hot-swap keeps all previous engines in memory (~4–14 MB per swap, unbounded) | `perf1_hotswap_leaks_old_engine.py` |
| 2 | NET-1 | **High** | Co-op drops if either player's tab is in the background for more than 8 s | `net1_background_tab_drops_coop.py` |
| 3 | INV-1 | **High** | Upgrading a v2 save permanently deletes supplies that don't fit in the new bag | `inv1_legacy_migration_overflow.test.mjs`, `inv1_legacy_migration_overflow_e2e.py` |
| 4 | LIVE-3 | **Medium** | Overlapping update checks swap twice and leave an orphan engine rendering | `live3_concurrent_checks_double_swap.py` |
| 5 | LIVE-2 | **Medium** | One failed submodule fetch blocks that build for the rest of the session | `live2_submodule_failure_blocks_build.py` |
| 6 | MOVEMENT-1 | Medium-low | Climbing aboard onto a tile with a crate, palm or bench puts you inside the prop | `movement1_climb_into_prop.test.mjs` |
| 7 | UI-1 | Medium-low | Help dialog key chips are unreadable (1.2:1) and guide text is low contrast (2.5:1) | `ui1_help_key_chips_unreadable.py` |
| 8 | FISHING-2 | Low | The HUD prompt goes blank while the fishing line is out (regression from v2) | `fishing2_blank_prompt_while_fishing.py` |
| 9 | BUILDING-1 | Low | Green build ghost shows at cells the host always rejects; the click silently does nothing | `building1_ghost_beyond_bounds.py` |
| 10 | UI-5 | Low | The title-screen "LITTLE RAFT" brand is hidden under the welcome overlay | `ui5_title_brand_hidden.py` |
| 11 | SAVE-2 | Low | One invalid slot in a saved bag throws away the whole bag | `save2_one_bad_slot_discards_bag.py` |
| 12 | AUDIO-1 | Low | The Sound on/off toggle resets on reload | `audio1_sound_toggle_persists.py` |
| 13 | FISHING-1 | Low | The Fishing Rod uses the same icon as the Hook | `fishing1_rod_icon_matches_hook.py` |
| 14 | UI-2 | Low | The craft list hides its last recipes below the fold, with no scroll hint | `ui2_craft_list_cut_off.py` |
| 15 | MOVEMENT-2 | Low | Jump height depends on frame rate (11% lower at 20 fps than at 144 fps) | `movement2_jump_framerate.test.mjs` |

Some bugs were reported by two lanes and are listed once:
- The save lane also found INV-1 (as SAVE-1).
- The building lane also found MOVEMENT-1 (as BUILDING-2).
- The UI lane also found AUDIO-1 (as UI-4).
- The live lane also found PERF-1 (as LIVE-1).

---

## 1. PERF-1 — Every live hot-swap keeps all previous engines in memory (High)

**Repro**
1. Start a solo game.
2. Change `version.json` `build` (same `protocol`) and wait for the 6 s poll (or call `raftLive.check()`). Repeat.
3. Force GC.

Two measurements:

| Run | Swaps | Live engines | JS heap |
|---|---|---|---|
| Verifier A | 4 | all 5 | 25.7 → 82.7 MB |
| Verifier B | 6 | — | 11.4 → 35.9 MB |

Meshes, BufferGeometry vertex buffers and materials stay reachable. GPU-side `renderer.info.memory` stays flat, so the GPU counters don't show the leak. Live updates are pushed automatically, so long desktop sessions grow without limit.

**Root cause:** `dist/game.js:918-919`.
- `setHandler` pushes `[el, prop, previous, next]` into `propertyHandlers`.
- `previous` is the previous engine's guarded `onclick`/`onsubmit` closure, which keeps that engine's whole `mount()` scope alive (raft, itemsGroup, ocean, hands, …).
- That scope has its own `propertyHandlers`, so every engine ever mounted stays reachable.
- The array is only needed for the rollback in mount's `catch` (`dist/game.js:1198`).
- The suspected second chain through `previousDebug` (`game.js:1130`) was refuted by both verifiers.

**Suggested fix:** after a successful mount (after `rafId = requestAnimationFrame(animate)` at the end of the `try`, ~`game.js:1194`), run `propertyHandlers.length = 0;`. Optionally null the scene references in `dispose()`. With this one line, memory stayed flat across 4–6 swaps in both verifier runs.

**Test:** `tests/audit/perf1_hotswap_leaks_old_engine.py`.
- It holds a WeakRef to the first engine's ocean mesh, does 2 real poll-driven swaps, forces GC through CDP, and asserts the mesh was collected.
- Main: `FAIL: first engine's ocean mesh is still reachable after 2 hot swaps + GC`. Patched copy: `PASS`.

## 2. NET-1 — Co-op drops if either player's tab is in the background for more than 8 s (High)

**Repro (fake PeerJS transport)**
1. Host and join.
2. Suspend `requestAnimationFrame` on one page. This is what Chrome does to a hidden tab; timers and data channels keep running.
3. Wait 11 s.

Results:
- **Host hidden:** the guest falls back to `role: solo` with the toast "Host disconnected".
- **Guest hidden:** the host evicts it ("BROTHER LEFT · ROOM OPEN") and the guest goes solo.
- **Control (no suspension):** stays connected.
- **7 s instead of 11 s:** stays connected.

A natural way to hit this is the host switching to a chat app to send the room code.

**Root cause:** everything runs from the rAF-driven `frame()` (`dist/game.js:844-847`):
- **Sending:** the only periodic send is in `frame()` (`dist/game.js:839`). It covers host state and the guest's `move`, which is the guest's only keepalive.
- **Timeouts:** both 8 s checks are also in `frame()` (`dist/game.js:823` for the guest, `:824` for the host).
- **Liveness:** it is only refreshed by those messages (`:1007`, `:1013`).
- **No backup:** game.js has no `setInterval` heartbeat and no `visibilitychange` handling.

**Suggested fix:**
- Send a small `{type:'ping'}` (or the state/move message) from a `setInterval` of 1 s or less. Background tabs throttle intervals to about 1 Hz, which is still well inside 8 s.
- Run the liveness checks there too, and count every received message as liveness.

**Test:** `tests/audit/net1_background_tab_drops_coop.py`. It runs a control session first and exits 2 if even that disconnects.

## 3. INV-1 — Upgrading a v2 save permanently deletes supplies that don't fit in the new bag (High)

**Repro**
1. Store a v2 save (no `hostInventory`) in `localStorage['little-raft-v1']`, e.g. 12 tiles, a net, `stock:{wood:600, leaf:120, scrap:40}`.
2. Load and start solo. The bag holds hook + hammer + 520 wood; all leaf and scrap are gone.
3. The next autosave (every 3 s) or `beforeunload` writes the reduced bag and `world.stock`, so the loss is permanent.

This is reachable in real play:
- v2 stock was uncapped (up to 1e6 in `cleanWorld`).
- v2 nets auto-collected every 0.8 s from endlessly respawning supplies.
- A simulation of v2 with 3 nets passes the bag's 520-supply limit in about 30 minutes.

README: "Earned legacy supplies are migrated into stacks."

**Root cause:**
- `Bag.fromCounts` (`dist/inventory-state.js:151-168`) ignores the remainder that `bag.add()` returns (`:161`, `:166`). It fills kinds in `ITEM_KINDS` order, so wood takes every slot and later kinds get nothing.
- `bagsFromWorld` (`dist/game.js:103`) takes that bag as truth.
- `syncWorldInventories` (`dist/game.js:672`, `world.stock = legacyStock(hostBag)`) overwrites the original counts.
- Related: `game.js:1023` uses the same path for the guest's display-only remote bag.

**Suggested fix:**
- Spread migrated stock fairly across kinds.
- Keep the excess instead of dropping it. Recommended contract: `bag.migrationOverflow = {kind: n}` from `fromCounts`, persisted as `world.legacyOverflow` and fed back into the bag as space frees up, or into a crate.
- Stop `syncWorldInventories` from erasing stock that never made it into the bag.

**Tests:**
- `tests/audit/inv1_legacy_migration_overflow.test.mjs` (node). It requires `bag.count(k) + bag.migrationOverflow[k] == legacy[k]`, and that leaf and scrap are not starved.
- `tests/audit/inv1_legacy_migration_overflow_e2e.py` (browser). It requires saved bag + `saved.legacyOverflow[k]` to equal the legacy stock.
- If the fix keeps the excess under a different name, update the one accessor line in each test.

## 4. LIVE-3 — Overlapping update checks swap twice and leave an orphan engine rendering (Medium)

**Repro:** start solo, bump `version.json`, then `await Promise.all([raftLive.check(), raftLive.check()])`. Both return `updated` and two `animate` rAF loops stay pending for good, so two engines render and simulate.

In normal use the 6 s poll tick can overlap:
- a `visibilitychange` → `schedule(0)` (`dist/live.js:299`), or
- a manual `raftLive.check()`.

This also made an earlier leak test flaky.

**Root cause:** `dist/live.js:201-229`. `check()` tests `state.updating` before `await fetchManifest()`, but only `swap()` (`:233`) sets it. Both calls therefore swap from the same `old` engine, and the first new engine is never disposed.

**Suggested fix:** make `check()` single-flight. Set a `checking`/`updating` flag synchronously at entry and clear it in `finally`. A patched copy passes the test (`['updated','busy']`, 1 loop).

**Test:** `tests/audit/live3_concurrent_checks_double_swap.py`. Main: `FAIL: two overlapping checks swapped 2 times and left 2 render loops running`.

## 5. LIVE-2 — One failed submodule fetch blocks that build for the rest of the session (Medium)

**Repro**
1. Deploy a build whose `game.js` imports `hook.js?build=nb2`.
2. Return 503 for the first request to `hook.js?build=nb2`. This happens when `version.json` goes live before every file is uploaded.
3. `raftLive.check()` → `failed`.
4. After `FAILED_RETRY_MS` (60 s) the retry also fails. `hook.js?build=nb2` is never requested again.

The player sees "Update paused" until they reload. No crash: the old engine keeps running.

**Root cause:** `dist/live.js:105-111` (`moduleUrl`) adds `&retry=N` only to `game.js`. Its static imports (`dist/game.js:2-17`) keep the same URLs. Chromium keeps a failed module fetch in its module map per URL (HTML spec), so the build can never link. The comment at `live.js:108` shows the authors intended retries to work.

**Suggested fix:**
- Make every module URL of a retried attempt unique, e.g. a per-attempt import map, or rewrite or serve imports with the retry token.
- Alternatively, after one failed retry of the same build, mark it for the next session (`state.nextSessionBuild`) or reload at a safe moment, such as on the title screen.

**Test:** `tests/audit/live2_submodule_failure_blocks_build.py` (~70 s).

## 6. MOVEMENT-1 — Climbing aboard onto a tile with a crate, palm or bench puts you inside the prop (Medium-low)

**Repro**
1. Put a crate, palm or bench on an edge tile. On the default 3x3 raft, every tile except the middle one is an edge tile.
2. Fall in, swim to the middle of that edge, and hold Space.
3. The clamber ends at the tile centre, 0.00 m from the prop. The camera is inside the mesh until you walk out (walking outward is allowed).

Confirmed in a real browser run and a node sweep. Also found by the building lane.

**Root cause:** `dist/player-physics.js:307` (`_beginClimb`): `if (!this._propFree(tx, tz, blocked)) { tx = n.cx; tz = n.cz; }`.
- Decor always sits at the tile centre (`game.js:366`).
- The normal landing point, 0.55 m in from the edge, is always blocked for crate (0.80 incl. body radius), palm (0.67) and bench (0.70).
- So the fallback chooses the one spot that is guaranteed to be blocked.

**Suggested fix:** if the landing point is blocked, search other free points on the tile: slide along the edge, try the corners within the ±0.7 clamp, or push out radially to `r + BODY_RADIUS`. Never fall back to the centre without checking `_propFree`. A ring of radius 0.7 alone is not enough for the crate.

**Test:** `tests/audit/movement1_climb_into_prop.test.mjs` (3 cases).

## 7. UI-1 — Help dialog key chips are unreadable and guide text is low contrast (Medium-low)

**Repro:** Esc → How to play. The key chips (Mouse, Hook, Shift, Space, Tab, I …) look like blank white pills. The guide text is dim teal on navy.

**Root cause:**
- `dist/style.css:17`: `.guide kbd{background:#fff;color:var(--ink)}`, and `dist/graphics.css:29` redefines `--ink` as cream `#f1e7d0`. Result: 1.23:1.
- `dist/style.css:16`: `.guide li{color:#2f5f60}` on the navy dialog background (`graphics.css:288-291`). Result: 2.5:1.

**Suggested fix:** in `graphics.css`, restyle `.guide kbd` to match the dark keycap look of `.controls kbd`, and set `.guide li` to `var(--cream-dim)`. Target WCAG AA 4.5:1.

**Test:** `tests/audit/ui1_help_key_chips_unreadable.py`.

## 8. FISHING-2 — The HUD prompt goes blank while the fishing line is out (Low)

**Repro:**
1. Craft a rod (or seed one), select it and click the water.
2. "Wait for a bite…" shows for 2.5 s of wall-clock time.
3. Then `#contextPrompt` stays empty for the rest of the 3.8–5.8 s cast (game time), including the whole 0.8 s bite.

Clicks do nothing in that window and nothing tells you why. v2 (`5b5beb7`) showed "Bobbing along… wait for a bite" and then "A bite! Pulling it in…".

**Root cause:** `dist/game.js:401-412` `updateContext()` has no `hook.fishing` branch, and `castOut()` excludes fishing casts. `notice()` at `:640` is timed on the wall clock.

**Suggested fix:** add `else if (hook?.fishing) html = hook.t > fishWait ? 'A bite! Pulling it in…' : 'Bobbing along… wait for a bite';`.

**Test:** `tests/audit/fishing2_blank_prompt_while_fishing.py`. It polls the whole cast, and fails at any frame rate because the notice runs on wall-clock time.

## 9. BUILDING-1 — Green build ghost at cells the host always rejects; the click does nothing (Low)

**Repro**
1. Load a raft whose row reaches x = 25, holding a hammer, 20 wood and 20 plastic.
2. Aim just past the end of the row. A green ghost shows at (26,0), and `raftDebug.placements` lists it.
3. Click: the hammer swings, nothing is built or spent, and no notice appears.

The same happens at the 400-tile cap. This is reachable but late-game: 24 floors in a line is about 130 pickups.

**Root cause:**
- `placementFor` / `placementCandidates` (`dist/game.js:499-511`) only check "empty cell and has a neighbour".
- The host's `applyAction` build (`dist/game.js:566`, `:568`) also rejects `|x|,|z| > 25` and `tiles >= 400`, and it does so with a bare `return`.

**Suggested fix:**
- Use one shared `canPlaceFloor(x, z)` (bounds, cap, empty, neighbour) in all three places.
- Have the host emit a notice ("The raft can't grow any further") instead of returning silently.

**Test:** `tests/audit/building1_ghost_beyond_bounds.py`. Contract: `raftDebug.placements` lists only cells the host accepts.

## 10. UI-5 — The title-screen brand is hidden under the welcome overlay (Low)

**Repro:** load the page at any resolution. The top-left "LITTLE RAFT" name and tagline are dark grey and barely legible, at about 1.35:1 contrast.

**Root cause:** `header` has `z-index:2` and `.overlay` has `z-index:5` (`dist/style.css:2`). The overlay's `rgba(6,13,20,.86)` left-edge gradient (`dist/graphics.css:259`) paints over the brand.

**Suggested fix:** give `header` `z-index:6`, or start the gradient below the header. With the `z-index:6` fix the test passes (peak luma 242).

**Test:** `tests/audit/ui5_title_brand_hidden.py`. It takes a pixel measurement of the brightest pixel in the brand box: 67/255 on main.

## 11. SAVE-2 — One invalid slot in a saved bag throws away the whole bag (Low)

**Repro:**
1. Use a v3 save whose `hostInventory` holds hook, hammer, rope ×5, sail ×1 and wood ×21 (21 is over the 20-stack limit).
2. On load the bag is only `{wood:21, hook:1, hammer:1}`. Rope and sail are deleted, and the next save writes that.
3. The guest bag falls back to a bare hook.

**Reachability:** the current game can't write such a slot itself. Both verifiers fuzzed it, and `inventory-state.js` is the same in every release. It takes storage corruption, a hand edit, or a future build that renames an item kind or lowers a stack cap. That last case is plausible: the save key is still `little-raft-v1`, the snapshot has no version, and updates are pushed live.

**Root cause:**
- `dist/inventory-state.js:96-120` `validateSlot` throws.
- The `Bag` constructor (`:145`) rejects the whole bag.
- `dist/game.js:72-73` `snapBag`/`validSnapshot` turns the bag into `null`.
- `bagsFromWorld` (`dist/game.js:92-108`) then falls back to the four-kind legacy `stock`.
- The same all-or-nothing rule applies at `game.js:158`, `:168` and `:946`.

**Suggested fix:**
- Validate slot by slot: clamp counts to `maxStack`, and drop only unknown or invalid slots.
- Never fall back to legacy stock when a `hostInventory` exists.
- Add a snapshot version.

**Test:** `tests/audit/save2_one_bad_slot_discards_bag.py`.

## 12. AUDIO-1 — The Sound on/off toggle resets on reload (Low)

**Repro:** open Help, click "Sound: on" so it reads "Sound: off", then reload. The label reads "Sound: on" again, and the next hook throw beeps.

The volume slider in Settings does persist, in `little-raft-settings`, so the two mute controls behave differently.

**Root cause:** `dist/game.js:199` `let sound = X ? X.sound !== false : true` only carries the flag across hot-swaps. The click handler at `:928` never stores it.

**Suggested fix:** persist `sound` with the other settings (`dist/settings.js`), or in its own localStorage key, and read it when `X` is null.

**Test:** `tests/audit/audio1_sound_toggle_persists.py`. It counts `createOscillator` calls; a verifier's patched copy passes.

## 13. FISHING-1 — The Fishing Rod uses the same icon as the Hook (Low)

**Repro:** put a hook in slot 1 and a rod in slot 2. Both render `icons.svg#icon-hook`, in the hotbar and in the bag. Only the `aria-label` differs; the hotbar has no visible tooltip.

**Root cause:** `dist/inventory-state.js:22` sets the rod to `icon:'icon-hook', placeholder:true`. `iconSVG` (`dist/survival-ui.js:78-90`) only draws a custom icon when `CUSTOM[kind]` exists, and there is no `CUSTOM.fishingrod`. `icons.svg` has no rod symbol.

**Suggested fix:** add an original rod drawing, either as `CUSTOM.fishingrod` or a new `icons.svg` symbol. Don't reuse `icon-fish`, which belongs to the Fish item.

**Test:** `tests/audit/fishing1_rod_icon_matches_hook.py`.

## 14. UI-2 — The craft list hides its last recipes below the fold (Low)

**Repro:** at 1920x1080, start solo and press I. The craft list stops at Net. Bench and Crate are below the panel edge (520 px shown of 652 px), while about 280 px of screen height is unused. Net ends flush with the edge and no scrollbar is visible, so nothing hints that more recipes exist. The mouse wheel does reach them.

**Root cause:** `dist/survival-ui.js:145`: `#inventory .sv-craft{…max-height:min(520px,calc(94vh - 30px));overflow:auto}`.

**Suggested fix:** use `max-height:calc(94vh - 30px)`, or stretch to the bag column's height. Also add a visible scrollbar or a bottom fade for small viewports.

**Test:** `tests/audit/ui2_craft_list_cut_off.py`. Contract: every recipe is visible at 1920x1080.

## 15. MOVEMENT-2 — Jump height depends on frame rate (Low)

**Repro:** jump from standstill with `PlayerPhysics` at different frame rates. The analytic apex is 0.882 m. dt is clamped to 0.05, so 20 fps is the worst case.

| Frame rate | Apex |
|---|---|
| 240 fps | 0.872 m |
| 144 fps | 0.866 m |
| 60 fps | 0.843 m |
| 20 fps | 0.770 m |

The effect is cosmetic: the deck is flat and props block only on xz. Co-op players at different frame rates jump visibly differently.

**Root cause:** `dist/player-physics.js:150-156` uses semi-implicit Euler (`vy -= g*dt` before `y += vy*dt`).

**Suggested fix:** `y += vy*dt - 0.5*g*dt*dt; vy -= g*dt;` when not swimming, or fixed 1/120 s substeps. `tests/survival.test.mjs` still passes 22/22 with this change.

**Test:** `tests/audit/movement2_jump_framerate.test.mjs`. It checks that the 20 fps and 144 fps apexes are within 4% of each other.

---

## Refuted or not kept

- **HOOK-1, "a full-charge throw aimed at a supply lands short": refuted.** The arc is the design.
  - Evidence: `game.js:653` ("Ballistic… Misses are real"), the help text "aim higher to throw farther", and `tests/survival.test.mjs:397-437`, which asserts the arc and "target is only used for direction".
  - Full range (32 m) is reachable at about +30° aim.
  - The UX gap that remains: there is no landing preview. `index.html` `#aimHint` says "Point the dot at a floating supply and click", but that hint is hidden while you play.
- **UI-3, "Tab inside the open inventory closes it": not kept.** One verifier refuted it and one rated it partial. It is documented (README "Tab / I") and commented as intentional. As an accessibility note, keyboard-only crafting is not possible.
- **LIVE-1b, a second leak chain through `previousDebug` (`game.js:1130`): refuted** by both verifiers. It is only read in mount's own `catch` and is dead after mount returns.

## Observations for the "feel like Raft, no lag" goal (not bugs)

- **Unused modules (no defect, missed polish):** `dist/audio.js` (`createOceanAudio`: surf ambience and per-event sounds) is never imported, so the only sound is a sine `beep()`. `dist/rope.js`, `dist/sky.js` and `dist/waterfx.js` are not imported either; the rope is a 1 px `THREE.Line`. Wiring them in is the cheapest big jump in Raft feel. The audio lane stress-tested `audio.js` on its own (320 sounds, no NaN, node connects balanced).
- **Draw calls grow with raft size:** about 290–330 for a 3x3 raft, 437 for 6x6 and 617 for 10x10. Each tile has its own geometries, and `rebuildRaft` regenerates every tile on each build, so each build costs O(N). Merging or instancing deck geometry would keep large rafts smooth.
- **Small per-frame allocations:** `updateItems` makes a new Set and 30 slope objects per frame; while fishing, `updateHook` clones about 11 `Vector3`s (`game.js:775-777`); `hands.update` uses `Object.assign`. Over 5 minutes there was no heap growth (11–12 MB), geometries went 400→404, and items stayed at exactly 30.
- **Stale checks:**
  - `tests/legacy_hook.mjs` fails 2 of 4 against the ballistic redesign. It is intentionally outside `npm test`.
  - `check_hook.py` expects wear while the hook floats, plus a free repair. It also uses `channel='chrome'` and a fixed port.
  - `check_multiplayer.py` predates personal bags.
  - `release_queue_README.md:49` still lists `check_hook.py` as a gate.
- **Unreproduced leads:** both are real in the code but have no repro yet.
  - Host nets may grab a supply that the guest's hook is holding.
  - A guest who rejoins within 8 s of a silent drop is refused as "room full".
- **README wording:** "Craft a hammer to build foundations (2 wood + 2 plastic)" is the cost per floor. The hammer itself costs 4 wood + 2 rope.
- **Clean lanes:**
  - **Crafting:** no defects in 20k-case fuzz, the full-bag UI and guest code review.
  - **Inventory:** no defects outside INV-1 in a 2000×200-op Bag fuzz and real-mouse UI moves.
  - **Live hot-swap:** state carried across swaps intact, and mount-failure rollback worked in all three failure modes.
  - **Audio:** one `AudioContext` across swaps, created on a user gesture.
  - **UI layout:** fits at all three resolutions.
