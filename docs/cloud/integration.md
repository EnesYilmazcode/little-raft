# Cloud fleet integration: `claude/raft-integration`

Base: `main` @ `bc5df84`. All twelve local-fleet lanes were finished on their own `claude/lane-<name>` branches, then merged in the agreed order. After that, three QA rounds were run, each with four reviewers (detail, bugs, performance, Raft fidelity), and their findings were fixed on `claude/fix-<area>` branches. QA round 3 found nothing important, so the loop stopped there.

## What landed

### Lanes (merge commits, in order)

| Lane | Merge | What it brings |
|---|---|---|
| reference | 105544b | `docs/RAFT-REFERENCE.md`: rule IDs, sizes, colours and timings. `docs/GAP-LIST.md` |
| models | f597ba0 | `dist/models.js`: procedural low-poly library (`getModel`, `buildModel`, `MODEL_KINDS`, aliases) covering every item, palm growth stages and cups |
| viewmodel | 4e4a3d6 | `dist/hands.js` and `dist/held-items.js`: 3D hands holding a 3D model of every item, with `setPose('point')` |
| hotbar | 4a95275 | `dist/item-icons.js`: 3D icons rendered once and cached, used in the hotbar, inventory and crafting (including cost chips) |
| feed | 8418cdf | `dist/pickup-feed.js`: bottom-left fading "+3 Wood" rows with a 3D icon. Every centred popup removed |
| menus | 7d19797 | Left-column pause menu with tabbed settings. Esc from the inventory closes it with no pause and no free cursor; Electron routes Esc through `before-input-event` + `executeJavaScript(code, true)`. New game starts with only the hook |
| placement | de4f2e9 | `dist/placement.js`: free decoration placement at the aimed point with a green/red ghost, and a 2x2 start raft |
| farming | 8cff3ec | `dist/farming.js` and `dist/farming-view.js`: planter, seed, seedling. The plant grows only while watered (Filter Cup filled at the sea), 4 stages, then harvest |
| perf | 9b683bd | Static mesh baking, adaptive resolution, no per-frame allocations, `raftDebug.renderInfo` |
| bugs | db9370e | Hook rests on the deck and no longer drifts under the raft. Save salvage. Switching slots retracts the line. `tests/playtest.py` |
| feel | 86ed124 | `dist/audio.js` procedural audio with buses and ambience; co-op avatar holds its item; eased head bob and sway |
| world | 80e8543 | Blue sky with baked clouds and a sun, deep turquoise ocean with glint and fresnel, foam around the raft and items, horizon haze |

The integrator then wired the lanes together in `06200a4`:
- hands, icons and farming all read their models from `models.js`;
- the pickup feed uses the 3D icons;
- farming results and notes go through the feed;
- one pointing-pose rule covers every placeable item;
- `shoot.py` was reconciled across the lanes that had edited it.

### Fix rounds

| Round | Branches | Main fixes |
|---|---|---|
| 1 | fix-bugs, fix-hud, fix-detail, fix-perf, fix-viewmodel | **Placement and farming:** planter ghost matches the placed pot; E handling on planters.<br>**HUD:** crosshair is a 4px dot with a charge ring (no text); reel hint removed; level spawn view; 10-slot hotbar.<br>**Menus and models:** readable help; title brand visible; offline fonts; water cup model.<br>**Performance:** held models and ghosts preloaded, shaders compiled up front, icons rendered in idle time, hand meshes merged.<br>**Hands:** fixed 60° field of view, compact hook, rope fist and hand-over-hand reeling. |
| 2 | fix-world2, fix-viewmodel2, fix-ui2, fix-perf2 | **World:** 3 distant varied islands instead of a ring of 12; throw tuned to about 10 m level and 18 m max; ghost no longer z-fights; deeper sea colour; Shift+R turns 15°.<br>**Hands:** smaller hammer and placeables.<br>**Inventory:** fits the 900 px Electron minimum; icon framing fixed.<br>**Performance:** foam limited to the nearest 8 items; sky drawn after opaque objects; no shader compiles mid-play. |
| 3 | fix-polish, plus two small commits on the integration branch | **Pickup feed:** clear of the hotbar on narrow windows.<br>**Icons:** priority warm-up; hook icon matches the model.<br>**Hotbar:** slots more opaque.<br>**Ocean:** foam loop gated by distance.<br>**Hook:** rope stays above the water.<br>**Ghosts:** floor ghost easier to see.<br>**Farming:** watering with no room for the empty cup is refused instead of losing the cup. |

Commit hygiene: AI trailers were removed from the models and placement lanes before merging, and `git log main..HEAD` has none.

## The owner's asks: final state

All eleven asks were verified by the QA detail reviewer in round 3 (screenshots at 900x620, 1280x720 and 1920x1080) and re-checked in the final run of `shoot.py`.

| Ask | Status |
|---|---|
| Spawn with only the hook | Done. `spawnState.inventory` holds only the hook, also after New game over an existing save |
| Hands, hook and held items as 3D models | Done: all 18 item kinds |
| 3D icons in the hotbar, inventory and crafting | Done (see "What didn't land" for warm-up timing) |
| Esc from the inventory: no pause, no free cursor | Done. `afterInvEsc = {pause:false, inv:false, locked:true}`. Electron path through `desktop/main.cjs` |
| Well-designed pause menu | Done (`after/07-pause.png`) |
| No text in the screen centre | Done. Context prompts sit just above the hotbar |
| Bottom-left pickup toast with 3D icon and "+3 Wood" | Done (`after/09-pickup-feed.png`) |
| Pointing finger while placing | Done (`after/12-place-crate-ghost.png`) |
| Free decoration placement with a ghost | Done. Placed at raft-local metres; foundations still snap to the grid |
| Planting gives a seedling that needs water | Done. It grows only while the soil is wet |
| Smooth, no lag | See the performance table |

## Test results

- `npm test` (`node --test "tests/*.test.mjs"`): **86 pass, 0 fail**.
- `tests/playtest.py` (QA round 3): 0 failures, 0 page errors.
- Final `shoot.py` run: 0 page errors; 77 draw calls and 103k triangles at spawn; 15 shader programs.

Performance, from the round-3 QA perf report:
- These numbers come from software GL (swiftshader) on a shared, loaded machine, so read them as relative only.
- "Typical" is the median frame and "Worst" the slowest frame in the run.

| | main | integration |
|---|---|---|
| Draw calls per frame | 416–492 | 63–137 |
| Triangles per frame | 185k–232k | 89k–135k |
| JS ms per frame, typical | 5.3–8.2 | 1.7–2.4 |
| JS ms per frame, worst | 29–159 | 11–13.5 |
| Worst frame, first item switch | 9–12 ms | 5–10 ms, no shader link |
| Shader programs compiled mid-play | several | 0 |
| Heap over about 3 minutes | | Flat at about 12.5 MB; geometries go down |

## What didn't land, and known minor gaps

- **Icon warm-up:** under software GL some 3D icons still finish in the first few seconds of play. Starting items render first, and other slots show a neutral initials tile until their icon is ready. On a real GPU this takes milliseconds.
- **Inventory layout:** the bag is a 10-column grid, not Raft's 5x4 with category tabs.
- **Pause labels:** they differ from the reference wording.
- **Farming timing:** a plant takes about 2.5 minutes, against 4–6 minutes in the reference, and dry plants have no water-drop marker.
- **Rotation keys:** R turns 45° and Shift+R turns 15°; the reference has 15° on plain R.
- **Debris:** items that drift into the raft respawn instead of sliding along its edge, as on main.
- **Sea colour:** the sea 15–40 m out reads a little milky.
- **Small windows:** below 860 px wide (browser only) the stacked inventory uses 44 px slots.
- **Not tested:** Electron was not run here (only `node --check` on `desktop/*.cjs` and a simulated `raftEscape()`), and co-op was not tested live.

## Screenshots

Before (main): `docs/cloud/shots/integration/before/`. After (this branch): `docs/cloud/shots/integration/after/`. Both come from `shoot.py`; the after run has more shots (settings tabs, feed, quit to title, build ghosts).
