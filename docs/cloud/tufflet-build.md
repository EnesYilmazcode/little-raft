# Tufflet build notes

Spec: docs/specs/tufflet.md. Built on top of e6fb1a7a ("Add Tufflet spec").

## What was done
- **dist/animals-core.js**: `SPECIES` is now table-driven (each row carries `stock`, `prodMax`, `base`, `fed`, `tail` and its texts), with a new `tufflet` row.
  Added `MAX_TOTAL` (8), `HOME_TYPES`, `KIND_OF_HOME`, `WOOL_*`/`TUFT_*` constants, `TUFT_NAMES`, `woolPeriod`, `periodOf`, `entryOf` and `shear()`.
  `cleanAnimals`, `buildGraph`, `tick`, `lure`, `feed`, `pet`, `gone` and `labelOf` no longer have hen-or-goat branches. The hen lay block is unchanged
  and makes the same rng calls. `HOME_CODE` and `MAX_SLOTS` keep their old values.
- **dist/animals.js**: slots are sized by `MAX_TOTAL`, with an instance index per species code. Adds the `tufflets` and `tuffletFluff` instanced meshes (visible only while a tufflet exists),
  `renderTufflet` (paddle-up arrival, waddle, loaf, fluff shake, look, nibble, squish .18), and a coat scale of `[.8, .9, 1][wool]` read from the synced state.
  Also: tuft and nook picking with the own-home aim rule, `tuftPrompt`/`nookPrompt`, the `animals.shear` host verb (id check, reach, bag), and lures on any home type.
  Serialize goes through the table. The Tuft Nook is protected from undecor, `decorModel` covers the three new decor types, and dispose handles the new meshes.
  Debug gains `spawnTufflet`, `woolNow`, `spawn(x, z, kind)` for any species, and `give()` now adds shears.
- **dist/tufflet-models.js** (new): body (440 tris), fluff (616 tris), Tuft Nook (856), Tuft Rug (560), Cosy Blanket (480).
- **dist/animals-models.js**: one export line at the end (`part, merge, ball, hash`).
- **dist/content-items.js, craft-book.js, survival-ui.js, icons.svg**: the 5 items, 5 recipes, decor and radius rows, craft book category/desc/how rows,
  sprite rows and 5 original icons.
- **dist/live.js**: `tufflet-models.js` added to PRELOAD.
- **tests/tufflets.test.mjs** (new, 11 tests) covering spec section 9.

## Deviations / notes
- Two existing tests had to change to match spec-driven data (tests/goats.test.mjs and tests/animals.test.mjs did not change):
  - tests/storage-research.test.mjs: `learnedFrom(['wood','rope','leaf'])` now also includes `tuftnook`, because its cost is wood + leaf + rope.
  - tests/survival.test.mjs: the craft book tools tab gains `shears` (after `brush`), and the materials tab gains `woolrope` (filed under its output `rope`).
- tufflet-models.js has its own small `decorMesh`/`group` helpers, because the spec only exports `part, merge, ball, hash` from animals-models.js.
  It also exports `FLUFF_CENTER` (informational).
- animals.js no longer imports `MAX_SLOTS` (every use became `MAX_TOTAL`). The core still exports it.
- The loaf idle runs for u in [1, 5) s of the beat. The fluff shake runs for the first .8 s of each 3 s of the clock.

## Checks
- `npm test`: 1409/1409 pass (1398 before, plus 11 new).
- `python3 shoot.py dist <scratch>`: `errors: []`.
- Scripted Playwright pass via `raftDebug.content.animals`: `spawnTufflet`, `ff(150)`, `woolNow` and `give` all worked with no page errors.
  The nook, the wandering tufflet and the shears hotbar icon render, and the HUD shows `E Shear <name> · 2 tufts` while aiming with shears held.
  A synthetic Playwright `KeyE` press opened the inventory instead of interacting. The same thing happens when milking a goat on this tree,
  so the cause is the harness, not this feature. Shear-by-E, coat shrink and guest shear are covered by the module tests in tests/tufflets.test.mjs.
- `node tests/coop-e2e.mjs` fails before any animal code runs: its title-screen `#welcomeCrew` click times out with "element is not visible".
  This is a harness/UI mismatch on this tree, unrelated to this feature.
- Not done in-game: crafting the shears and Wool Rope through the craft UI. The recipes are tested with `bag.craft` and the craft book rows.

## Known limits
- The models were not added to tools/model-sheet.html, so no 200/64 px contact-sheet check was done. Proportions were checked from bounding boxes
  (top .44 m, face pokes out of the coat) and from in-game screenshots.
- No sleep or vitals effect for the blanket or rug (v1, as specced).
- Mixed-version co-op is not supported (as specced). Old builds drop tufflets, their lures, the new decor and bags holding the new kinds.
