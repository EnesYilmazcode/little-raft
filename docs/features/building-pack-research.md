# Building pack research: railing, ladder, hatch (+ gate)

Research only. Line numbers are for branch `claude/loop-features-202611210831` as it stands now.

## How the building system works today
- **Piece table** `dist/building-pieces.js:15-27`: `piece(id, name, slot, cost, full, height)`. Slots are `tile | cell | edge | corner`. `PIECE_ORDER` (:27) drives the wheel order and the canonical load order.
- **Slot codes** `SLOT_OF` (:30): 0 = BASE (floor/roof), 1 = VOLUME (stairs), 2 = EDGE, 3 = CORNER. `pieceKey` (:35) gives one record per (slot,i,j,l[,axis]). A new type must be added to `SLOT_OF`, or `load`/`canPlace`/`find` silently drop it (:94, :118, :160).
- **Record** `{t,i,j,l,r}`. `r` is the rotation 0..3 for cells (floors store it too, see `aim` :297) and the axis 0/1 for edges. Unknown fields are **stripped** in four places: `load` :97 and :107, `place` :177, `building.js:142` (`apply` rebuilds `world.pieces`).
- **Rules** `canPlace` :159-173. Support is in `_supported` :135-156: edges need a tile, a `floor` either side, or a full edge below. `_floor()` :113 accepts only `t === 'floor'`. Stairs and floors exclude each other vertically (:169-170).
- **Collision cache** `_rebuild` :208-238 builds three box lists: pick, solid and slabs. An edge's solid box is `PIECES[t].height` tall (:228-235). Doors are built from 3 boxes.
- **Walking** `_scan` :316-354. For slot 0/1, anything whose `t !== 'floor'` is treated as a ramp (:338-341). `_ramps` :401-424 likewise treats every non-floor slot-0/1 piece as a stairs/roof underside. New cell pieces must be special-cased in both places.
- **Physics glue** `preStep` :357-377 feeds PlayerPhysics a virtual `{deckY, tiles}`. When `ground > feet` on a grounded body it lifts with `phys.y = ground + EYE` (:375); this is how stairs raise you. `postStep` :475-486 runs slabs, then solids (step-over within `STEP_UP` 0.55 when grounded), then ramps, then the clamber refusal.
- **Jump height** is about 0.88 m (4.6²/24). The halfwall (1.1 m) cannot be jumped (test `building-physics.test.mjs:216`).
- **Render** `building.js:42-57`: one `InstancedMesh` per type (keyed by `p.t`, from `STORED` :12), plus a per-instance tint for paint (:54, :102-108). Geometry comes from `building-models.js` `BUILDERS` :247 and the ghost bounds in `BOUNDS` :267.
- **Menu** `build-menu.js:10-20` `ICONS` (24x24 line SVG per id, `FALLBACK_ICON` otherwise). The wheel splits 360/n (:90), so 9 → 13 sectors is still about 28° each, which is fine. `build-radial.js` is only the controls.js pad wheel with a stale list (`controls.js:11`) and is not the hammer menu.
- **Apply** (host-authoritative) `building.js:125-145`, called from `game.js:1058`. Removing refunds `def.cost`.

## Save and co-op
- Save/load: `game.js:199` `pieces: cleanPieces(v.pieces, tiles)`, copied at :205.
- Host → guest: `hostState` `game.js:1456` sends `pieces` only when the `world.pieces` identity changed (`sentPieces`). The guest keeps the old array when it is omitted (:1777) and calls `building.sync` (:1789). Pieces arrays have no `id`/`token`, so `coop-delta.js:75-79` resends the whole array on any change (at most 600 × ~30 B). That is fine for a rare E toggle.
- Guest: `cleanWorld` → `cleanPieces` → `load`. This **strips unknown fields and types**, so a new field must be whitelisted in `load` or it vanishes on the guest.
- **Older peers and saves:** an old build drops unknown `t` (`!(p.t in SLOT_OF)`). An old guest on a new host just doesn't see railings, ladders or hatches (it walks through them, and an open or closed hatch shows as a hole). An old host refuses new kinds (`apply` returns `ok:false`, silent). A downgraded save loses the new pieces. There is no crash anywhere, and no protocol bump is needed.
- Other `world.pieces` readers: `paint.js:21` `PIECE_TYPES` whitelist (add the new ids or they can't be painted). The paint key `t:i,j,l,r` (:24) is stable only if open/closed is not encoded in `t`/`r`. `animals-core.js:89` `WALLS` and :101 (level-0 stairs cells block animals): add railing and gate to WALLS, and ladder to the blocked cells. `shark.js:81` re-cleans pieces with `cleanPieces`, so the state field must survive it.

## Stateful piece: recommended data shape
`{t:'hatch', i, j, l, r, o:1}`. **`o` is present only when open** (closed = absent), so closed records are byte-identical to the old shape.
- Whitelist `o` in `load` :97/:107 (`o: p.o === 1 ? 1 : undefined`, or copy it only when the type is stateful) and in `place` :177. Replace the `building.js:142` map with a shared `toRec(q)`.
- Toggling must bump `grid.version` (a new `grid.toggle(p)`), so `_rebuild` and the mesh rebuild re-run.
- Rejected alternatives: separate types `hatch`/`hatchOpen` (this breaks the paint key, the refund lookup and the PIECE_ORDER/menu), and a high bit in `r` (`canPlace` :165 rejects r>3, and it's opaque). A side table in `world.ext` is a second source of truth that `cleanPieces`/shark pruning won't keep in step.

## Piece designs (original)
- **Railing** `piece('railing','Railing','edge',{wood:1, rope:1}, false, 0.95)`. Model: three thin square posts (ends + middle) with two lashed horizontal rails and rope wraps at the joints. It is see-through, unlike the solid-plank halfwall. Collision is free: the generic edge branch :235 makes one 0.95 m solid box. That blocks walking (above STEP_UP) and jumping (0.88 m < 0.95), refuses auto-clamber (`_pathHit` :445), and `full:false` means nothing can rest on it. Placement rules are those of the edge branch (:140-143), unchanged.
- **Ladder** `piece('ladder','Ladder','cell',{wood:3, rope:1}, false, LEVEL_H)`, slot 1 (one per cell, like stairs). `r` is the side it leans on. It is a thin strip u∈[0.75,1] along `DIR[r]` of the cell: two side rails and 6 rungs. It has a solid box across the strip (rails only, 0.08 deep at u≈0.95), so you rest against it.
  - Rules: support as for stairs (:145). At :169, allow a `hatch` above it (or nothing), but not a floor. At :170, let a `hatch` sit above a ladder. Like stairs, it counts as `_direct` support for the landing cell `(i,j)+DIR[r]` at l+1 (:128-131), and optionally for a hatch directly above.
  - Exclude it from the ramp code: `_scan` :338 and `_ramps` :413 must `continue` for `ladder`.
- **Hatch** `piece('hatch','Hatch','cell',{wood:3, rope:1}, false, FLOOR_THICK)`, slot 0 (it replaces a floor cell, l≥1, same support as floors). Model: a framed floor cell with a double-leaf trapdoor. When open, both leaves stand up about 1.0 m on the two hinge edges perpendicular to `r`, so the open hole is guarded on two sides and the `r` side (the ladder side) stays clear. That look is our own.
  - Closed: behaves as `floor`. The slab box is at :222, and `_scan` treats it as flat (:338). It is a support neighbour automatically (slot 0 lookups at :151). Keep `_floor()` :113 floor-only, so nothing rests on a hatch.
  - Open: no slab and no walk surface (skip it in `_scan`). The two leaves are solid thin boxes (`_solid`, like a railing). The pick box stays the cell slab (:221), so you can aim at the hole to close it. Support for other pieces must not depend on `o`: toggling must never collapse anything.
- **Gate** (optional, cheap once `o` exists): an edge piece that looks like the railing with a swinging middle leaf. When closed it is a single solid box; when open, it adds the two door-like jamb boxes (copy the door branch :230-234 with a 1.2 m gap). It uses the same E toggle. Skip the arch; the doorway already covers it.

## Ladder climbing approach (no player-physics.js change)
Use the existing **unused** MoveFeel ladder API: `move-feel.js:167` `setLadder({bottomY, topY, x, z, normal})` and :182 `ladderInput(dt, {forward, jump, y})` → `{vy, detach, pushX, pushZ, atTop}`. It already has `CLIMB_SPEED` 2, a jump-off push, rung bob and footsteps (`controls.js:84` passes `onLadder`).
1. Add `grid.ladderAt(x, z, feet, deckY)`: find a ladder cell whose strip contains the body centre (±BODY_R) for `base-0.3 ≤ feet ≤ base+LEVEL_H`.
2. In `game.js:1265` (movePlayer): if there is a ladder, `forward > 0` and the yaw is within about 60° of `DIR[r]`, call `controls.feel.setLadder(...)`. Then each frame call `r = feel.ladderInput(dt, {forward, jump, y: feet})`. Detach (`setLadder(null)`) when you leave the strip, are grounded at the bottom with `forward < 0`, or jump (apply `pushX/Z` and `vy`).
3. Pass the rate in: `building.preStep(physics, deckY, climbVy * frameDt)` (new optional 3rd argument). While climbing, `preStep` overrides `ground = clamp(feet + dy, base, cap)`, sets `pre.tiles = [the ladder cell]` and forces `phys.grounded = true, vy = 0`. The existing lift at :375 raises the eye, and PlayerPhysics' grounded branch holds it there, so there is no gravity fight and hanging still works.
4. `cap` = `base + LEVEL_H` (top). If a slab exists at (i,j,l+1), `cap` is that slab's bottom minus (EYE + HEAD + 0.02), so a closed hatch or floor above stops the head instead of `_solids` shoving a grounded body sideways (:470).
5. At the top, `_scan` must offer the strip as a flat surface at `base + LEVEL_H` once the feet are within 0.04 of it. Walking forward then moves onto the landing floor `(i,j)+DIR[r]` at l+1 at equal height. Through an open hatch, you walk along the strip onto the side floors.
6. The ladder's solid box top equals the top, so at the top it lies below `feet + STEP_UP` and no longer blocks (:482).
The guest runs this locally from its own grid, so no network message is needed.

## Hatch toggle (E), co-op
- Input: `game.js:1132` `interact()`. Insert `if (building?.interact(camera.position, currentAim()))` before the content/fc/prog hooks (:1143), and well before the `openInventory()` fallback (:1147). `building.interact` runs `grid.pick` with reach about 2.5 m, filtered to `hatch`/`gate`, and returns `{kind:'piecetoggle', t, i, j, l, r}`. It also needs `guestWaiting()` like the others.
- Prompt and crosshair: `game.js:715-723`. Add `building?.prompt(frameAim)` ('<kbd>E</kbd> Open hatch'), and make it count toward `usable`.
- Host: a new branch next to `game.js:1058` → `building.toggle(a, world)`. It validates the record type and the reach (actor pose), and refuses to close while either body (`physics`, `other`) is inside the cell column at the slab height ("Someone is in the way"). It then flips `o` and sets `world.pieces = new array`, so hostState resends, then `emit` a sound to 'all'. An old host ignores the unknown kind.
- Render: in `rebuild`/`retint` (`building.js:44-55`, :104-106), key the mesh by `meshKey(p) = p.o ? p.t + 'Open' : p.t`, with an extra geometry per stateful type. It snaps, with no animation. Each type in use adds about 2 draw calls (main + shadow). LOG.md shows about 96-129 calls on main today, and the crafts/debris instancing work (LOG :288, :324) is the model: keep one InstancedMesh per variant, never per-piece meshes.

## Tests to update or add
- `tests/building-pieces.test.mjs:34` asserts the exact `PIECE_ORDER`. Append the new ids at the **end**, since `ORDER_OF` sorting only affects load order. Add tests: rules (ladder/hatch stacking, railing support), `load` keeps `o` only on stateful types and drops garbage `o`, toggling doesn't change support/removal, and `cleanPieces` round-trips.
- `tests/building-physics.test.mjs` (same harness :17-29): railing blocks walking and jumping and refuses clamber; a closed hatch is walkable and an open one drops you to the level below; ladder up in all 4 `r`, at dt 1/60 and 1/20 with bob, reaching the landing and coming back down; climbing under a closed hatch stops at the head; a ladder through an open hatch.
- `tests/paint.test.mjs`, `tests/move-feel.test.mjs:162` (the API is already covered), and the animals graph test if WALLS changes.

## Risks
- `_scan`/`_ramps` treat every non-floor slot-0/1 piece as a ramp. Forgetting the ladder or hatch makes invisible slopes. This is the top bug risk.
- The climb override must be released robustly: on detach, swim, dive, death or teleport. Otherwise `phys.grounded` is forced mid-air. Tie it to `feel.isOnLadder()` and clear it in `game.js` wherever `physics` is recreated.
- The 0.95 m railing vs jump height 0.88: if jump tuning changes, railings become hoppable.
- Older guests see holes or walk through railings (cosmetic desync only; the host stays authoritative). Mention it in the notes.
- Wheel crowding: with 13 sectors, check the mobile `min(380px, 92vw)` wheel. Icons stay 44 units.

## Recommendation
Ship in this order: railing (data, model and icon only) → hatch with the `o` field and E toggle → ladder via the MoveFeel API and the `preStep` climb override → optional gate reusing `o`. Keep all state in `world.pieces`. Whitelist `o` in `load`/`place`/`apply`, special-case the ladder and hatch in `_scan`/`_ramps`/`_rebuild`, and append the ids to the end of `PIECE_ORDER`. No player-physics.js or protocol change is needed.
