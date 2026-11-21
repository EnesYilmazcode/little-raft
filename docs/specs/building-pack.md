# Spec: Building pack: Railing, Hatch, Ladder (+ optional Gate)

Source: docs/features/building-pack-research.md. These are four new hammer pieces in the existing building system. Nothing is lost: a toggle never collapses anything, and removing a piece refunds its cost.
One builder ships them in this order: railing, hatch (adds the `o` field and the E toggle), ladder (MoveFeel climb), then **gate (optional, phase 4)**, which reuses `o`.
There is no player-physics.js change, no new module, no protocol bump and no npm dependency. Edits go into building-pieces.js, building.js, building-models.js, build-menu.js, paint.js, animals-core.js and 5 game.js hook lines. Tag every hook `[buildpack]`.

## 1. Piece table (dist/building-pieces.js:15-30)
| id | name | slot | SLOT_OF | cost | full | height |
|---|---|---|---|---|---|---|
| `railing` | Railing | edge | 2 | `{wood:1, rope:1}` | false | 0.95 |
| `hatch` | Hatch | cell | 0 (replaces a floor cell) | `{wood:3, rope:1}` | false | `FLOOR_THICK` |
| `ladder` | Ladder | cell | 1 (one per cell, like stairs) | `{wood:3, rope:1}` | false | `LEVEL_H` |
| `gate` (opt.) | Gate | edge | 2 | `{wood:2, rope:1}` | false | 0.95 |
- `PIECE_ORDER` (:27): **append** the new ids at the end: `[...old 9, 'railing', 'hatch', 'ladder', 'gate']`. `ORDER_OF` only sets the load order. Fix `tests/building-pieces.test.mjs:34` to match.
- Add `const STATEFUL = Object.assign(Object.create(null), {hatch:1, gate:1})` and `const RAIL_H = 0.95, GATE_GAP = 1.2, LEAF_H = 1.0, LAD_IN = 0.86, LAD_OUT = 0.96, LAD_HALF = 0.45`.
- Railing at 0.95 m is above the 0.88 m jump height and above STEP_UP, so the generic edge branch (:235) blocks walking, jumping and clamber with no extra code. `full:false`, so nothing rests on it. If jump tuning ever goes above 0.95, raise RAIL_H.

## 2. Record shape and the `o` whitelist
The record stays `{t,i,j,l,r}`. A stateful piece adds `o:1` **only while open**. A closed record is byte-identical to today's shape, and so is every old save.
- New exported helper `toRec(p)`: returns `{t, i, j, l, r}` (with r = 0 for a pillar, as today), and sets `rec.o = 1` only if `STATEFUL[p.t] && p.o === 1`. It never writes `o: undefined`, so deepEqual on a closed record holds.
- Use it everywhere a record is rebuilt:
  - `load` cand push (:97), so a garbage `o` (2, true, '1') or an `o` on a non-stateful type is dropped;
  - `load` return map (:107);
  - `place` (:177);
  - `building.js:142` (`world.pieces = grid.list.map(toRec)`).
- The guest's `cleanWorld → cleanPieces`, the save's `cleanPieces` (`game.js:199`) and shark pruning (`shark.js:81`) all go through `load`, so they keep `o` with no edit. `game.js:205` already copies with `{...p}`.
- `apply` (`building.js:127`) builds `p` without `o`, so a newly placed hatch or gate is always closed.
- New `toggle(rec)`: flip `rec.o` (`delete rec.o` / `rec.o = 1`) and `this.version++`. Support never reads `o`, so `canRemove` and the support checks give the same answer open or closed.

## 3. Rules (canPlace :159-173, _supported :135-156)
- Hatch: slot 0, l ≥ 1, same support as a floor (default branch). `_floor()` (:113) stays **floor-only**, so edges, pillars, stairs and ladders cannot stand on a hatch.
- Ladder: support like stairs (case 1). `_direct` (:128-131) already treats any slot-1 piece with `s.r === r` as support for the landing cell `(i,j)+DIR[r]` at l+1, so a ladder supports its landing floor automatically. Keep this and test it.
- :169 becomes `if (s === 1 && above && !(t === 'ladder' && above.t === 'hatch')) return 'Floor above is in the way'`.
- :170 becomes `if (s === 0 && below && !(t === 'hatch' && below.t === 'ladder')) return 'Stairs are in the way'`.

## 4. Collision cache `_rebuild` (:208-238). Local frame: u along DIR[r], w across.
- **hatch**: the pick box is the floor slab box (:221), open or closed, so you can aim at the hole. Closed: the slab box (:222), as a floor. Open: no slab, plus two solid leaves, one on each hinge edge parallel to DIR[r]: thickness 0.06 at w = ±(1-0.03), full 2 m along u, y0 .. y0+LEAF_H. The r side (where the ladder stands) stays open.
- **ladder**: the pick box covers only the strip `u ∈ [0.75, 1]`, `|w| ≤ 0.5`, y0 .. y0+LEVEL_H, so it doesn't swallow aim rays across the cell. One solid box `u ∈ [LAD_IN, LAD_OUT]`, `|w| ≤ LAD_HALF`, full height. At the top this box is under `feet + STEP_UP`, so it is stepped over (:482).
- **gate**: the pick box is the full edge. Closed: one box, like a railing. Open: the two side boxes of the door branch (:230-232) with `side = (2 - GATE_GAP)/2` and height RAIL_H, and no lintel.

## 5. Walking special cases (top bug risk)
- `_scan` (:338). Before the ramp branch:
  - `if (p.t === 'hatch') { if (p.o) continue; }`: closed is flat at `h = y`, open has no surface.
  - `if (p.t === 'ladder') { if (!this._inStrip(p, x, z) || feet < y + LEVEL_H - 0.04) continue; h = y + LEVEL_H; }`: the strip is a flat ledge at the top only. Then guard the ramp math with `else if (p.t !== 'floor')`.
- `_ramps` (:413): `if (!p || p.t === 'floor' || p.t === 'hatch' || p.t === 'ladder') continue;`.
- `_inStrip(p,x,z)`: body centre has u ∈ [0.35, 1.0] and |w| ≤ 0.6 (u and w in metres from the cell centre, along `DIR[p.r]`).

## 6. Ladder climbing (MoveFeel `move-feel.js:167` setLadder, :182 ladderInput)
New grid method `climb(feel, phys, deckY, inp, dt)`. It is pure, with feel injected, so tests drive it without game.js. It returns the climb `dy` for this frame, or `undefined` when you are not climbing. State lives in `this._cl = {rec, phys, h}`, where `h` = feet − base. Storing `h` relative to base keeps raft bob from fighting the climb.
- `ladderAt(x, z, feet, deckY)` returns a ladder whose `_inStrip` holds with `base - 0.3 ≤ feet ≤ base + LEVEL_H + 0.05`. It searches the 3x3 cells and levels L-1..L.
- `capH` = LEVEL_H. If a slab exists at (i,j,l+1), meaning a closed hatch, `capH = LEVEL_H - FLOOR_THICK - EYE - HEAD - 0.02`. The head then stops under the hatch, and `_solids` never shoves a grounded body sideways.
- **Attach** (not attached, `feel` present, `!phys.swimming`): you need a ladder at the feet, and yaw forward `(-sin yaw, -cos yaw)` within 60° of `DIR[r]` (dot ≥ 0.5). Then either `forward > 0`, or `forward < 0` with feet within 0.04 of the top (getting on from the landing). Call `feel.setLadder({bottomY:0, topY:capH, x, z, normal:[-DIR[r][0], -DIR[r][1]]})` and set `_cl.h = clamp(feet - base, 0, capH)`.
- **Each frame** while attached: `r = feel.ladderInput(dt, {forward, jump, y:_cl.h})`.
  - If `r.detach` (jump): release, `phys.vx += r.pushX; phys.vz += r.pushZ; phys.vy = r.vy; phys.grounded = false`, and return undefined.
  - Otherwise `dy = r.vy * dt` and `_cl.h = clamp(h + dy, 0, capH)`. Return dy.
- **Release** (`feel.setLadder(null)`, `_cl = null`) when any of these happens: the ladder is gone; not `_inStrip` (stepped off at the top, or strafed off); `phys !== _cl.phys` (respawn or teleport recreated physics, `game.js:672/1287/1698/1794/2006`); `phys.swimming`; `!feel.isOnLadder()`; `r.atBottom && forward < 0`.
- `preStep(phys, deckY, climbing)` gets a new optional 3rd argument. While `_cl` is set and `climbing !== undefined`: `ground = base + _cl.h`, `pre.deckY = ground`, `pre.tiles = [[i,j]]` (a reused array), `phys.grounded = true; phys.vy = 0; phys.y = ground + EYE`, return pre. The existing grounded branch of PlayerPhysics then holds the height, so there is no gravity fight and hanging still works.
- At the top (`h = LEVEL_H`), `_scan` offers the strip at landing height. Walking forward moves onto `(i,j)+DIR[r]` at l+1, and the strip check fails, which releases you. Through an open hatch the same thing happens: you step onto the landing beside the hole.
- The guest runs this from its own synced grid. There is no network message, and the footstep and rung bob already come from `controls.js:84 onLadder`.

## 7. Toggle (E): client, host, prompts
- `building.target(camPos, aim, deckY)` calls `grid.pick(..., REACH_E = 2.5)` and returns the record only if `STATEFUL[rec.t]`. The nearest piece wins, so you can't toggle through a wall. It returns null while the hammer wheel is open or remove mode is on.
- `building.prompt(...)` returns `'<kbd>E</kbd>Open hatch'`, `'<kbd>E</kbd>Close hatch'`, `'<kbd>E</kbd>Open gate'` or `'<kbd>E</kbd>Close gate'` (static, no esc). `building.interact(...)` returns `{kind:'piecetoggle', t, i, j, l, r}` or null.
- game.js:
  - `:717` insert `else if ((contextHtml = building?.prompt(camera.position, frameAim, deckY()) ?? null)) html = contextHtml;` before the content prompt.
  - `:722` add `|| building?.target(...)` to `usable`. Compute it once per frame and reuse it.
  - `:1143` insert before content: `const pt = building?.interact(camera.position, currentAim(), deckY()); if (pt) { if (guestWaiting()) { notice('Wait for your raft to connect'); return; } swing = .4; action(pt); return; }`.
- Host branch next to `game.js:1058`: `if (a.kind === 'piecetoggle' && building) { const r = building.toggle(a, world, actor === 'guest' ? other : physics, [physics, other], deckY()); if (r.ok) emit({kind:'build', text:r.text, sound:'place'}, 'all'); else if (r.text) emit({kind:'notice', text:r.text}, actor); return; }`.
- `building.toggle(a, world, pose, bodies, deckY)`:
  1. `sync(world)`.
  2. `rec = grid.find(a)`. It must exist with `rec.t === a.t && STATEFUL[rec.t]`, else `{ok:false, text:''}`.
  3. Reach: the actor pose must be within `REACH_E + 1.5` (XZ and Y) of the piece centre, else silent `ok:false`.
  4. **Occupancy refusal when closing** (`rec.o === 1`). If any body in `bodies` with finite coords overlaps the piece's closed box, return `{ok:false, text:'Someone is in the way'}`. Overlap means the XZ circle (BODY_R) touches the box, and the vertical span `[y - EYE, y + HEAD]` meets `[y0 - FLOOR_THICK - 0.05, y0 + 0.05]` (hatch) or `[y0, y0 + RAIL_H]` (gate). Opening is never refused. Anyone standing on an open hatch falls one storey, which is the feature.
  5. `grid.toggle(rec)`, `world.pieces = lastPieces = grid.list.map(toRec)`. The new identity makes hostState resend (`game.js:1456`). Then `rebuild()`.
  6. Return `{ok:true, text: rec.o ? 'Hatch opened' : 'Hatch closed'}` (or the Gate text).

## 8. Render (building.js) and models (building-models.js)
- `meshKey(p) = p.o ? p.t + 'Open' : p.t`. `VARIANTS = ['hatchOpen', 'gateOpen']`. `geos[k]` is built for `STORED` plus VARIANTS (`:18`, using `createPieceGeometry(T, base, true)`).
- `rebuild` (:42-57) and `retint` (:102-107) count, index and loop over meshKey instead of `p.t` (loop `STORED.concat(VARIANTS)`). Use one InstancedMesh per variant, never a mesh per piece. Each type in use costs about 2 draw calls. There is no animation: the toggle snaps.
- `showGhost` (:111) uses `geos[meshKey(p)]`, so the remove ghost of an open hatch matches it. The place ghost is always the closed piece. `dispose` loops over the variants too.
- `createPieceGeometry(T, type, open = false)` passes `open` to the builder. `BUILDERS` (:247) gets the 4 ids; variants are not keys, so `PIECE_TYPES` stays the piece ids. Use the original low-poly designs below, built with the existing kit (`K.box`, `ring`, `nail`, PLANKS/POST/BEAM/ROPE, jitter), with origins and local axes as for walls (edges) and stairs (cells, local +z = DIR[r]):
  - **Railing**: three 0.09 m square posts (POST) at x = -0.92, 0 and 0.92, 0.95 tall with a small BEAM cap; a top rail (1.94 x .07 x .06) at 0.90 and a mid rail at 0.50 (PLANKS, slight jitter); 2-turn rope rings at all 6 post–rail joints. It is see-through, unlike the halfwall.
  - **Hatch**: four 0.12 m BEAM frame strips around the cell rim (top at 0); two leaves (1.0 x .045 x 1.9), each 4 planks with 2 under-battens, nails, and a rope pull loop by the seam. Open: each leaf turns 90° up about its outer hinge edge at x = ±0.97 and stands 1.0 m tall.
  - **Ladder**: two POST rails (.07 x .09) at x = ±0.42, z = 0.91, from y 0 to 2.2; 6 rungs (cylinder r .025, length .84) at y = 0.30 + 0.33k; rope lashings at every rung end; two small foot blocks.
  - **Gate**: railing-style end posts at ±0.92 with 0.4 m rail stubs; a 1.2 m leaf with 2 stiles, top and bottom rails, a diagonal brace, 3 slats and a rope-loop latch. Open: the leaf turns 90° about its hinge stile at x = -0.6 towards local +z.
- `BOUNDS` (:267): `railing`/`gate: [-1, 0, -0.08, 1, 0.97, 0.08]`, `hatch: [-1, -0.13, -1, 1, 0.01, 1]`, `ladder: [-0.5, 0, 0.82, 0.5, 2.2, 1.0]`.
- Menu `build-menu.js:10-20` ICONS (original 24x24 line icons, stroke currentColor):
  - `railing` 3 posts and 2 rails;
  - `hatch` a square frame with a split seam and a small loop;
  - `ladder` 2 rails and 4 rungs;
  - `gate` posts with a braced leaf.

  13 sectors is about 27.7° each. Check the mobile `min(380px, 92vw)` wheel in shoot.py.

## 9. Other world.pieces readers
- `paint.js:19` PIECE_RE: add `railing|hatch|ladder|gate`. `paint.js:21` PIECE_TYPES: add the 4 ids. The paint key `t:i,j,l,r` has no `o`, so a tint survives a toggle.
- `animals-core.js:89` WALLS: add `railing`. At :101, add a ladder cell at l = 0 to the blocked `stairs` set. Treat a gate as a wall only when closed: `WALLS.has(p.t) || (p.t === 'gate' && !p.o)`.

## 10. Co-op, old peers, saves
- Host-authoritative: place, remove and toggle run only through `apply`/`toggle` on the host. The guest sees the result through the `pieces` resend (the whole array, at most about 18 kB, only on change).
- Old guest on a new host: `load` drops the unknown types. The guest doesn't see railings, ladders, hatches or gates, walks through them and sees holes. That is a cosmetic/physics desync only, with no crash. A closed record carries no `o`, and old builds never see `o` on known types.
- New guest on an old host: the old host refuses new pieces, so there are none to see. An unknown `piecetoggle` is ignored silently. Mixed-version co-op is unsupported; say so in the PR.
- Saves: old saves load unchanged (no `o`, no new types). A downgraded build drops the new pieces silently. An open hatch saves `o:1` and reloads open.

## 11. Tests
- `tests/building-pieces.test.mjs`:
  - PIECE_ORDER (appended);
  - `toRec`/`load` keeps `o:1` only on hatch/gate and drops `o` values 2, true and '1' and `o` on a floor;
  - a closed record round-trips deepEqual through `cleanPieces`;
  - a hatch needs floor-like support and is l ≥ 1;
  - ladder + hatch above is allowed, ladder + floor above is refused, a hatch over stairs is refused;
  - a ladder supports its landing floor;
  - `toggle` bumps version and leaves `canRemove` answers unchanged;
  - removing an open hatch refunds the cost (building.js apply with a stub T is not needed: test the grid only);
  - nothing may be placed on a hatch (pillar, wall, ladder → 'Needs support below').
- `tests/building-physics.test.mjs`, using the same harness (:17-29) and all 4 VARIANTS:
  1. Railing on a deck edge: walking into it never crosses it; a jump from a run doesn't clear it; a swimmer's clamber onto that edge is refused.
  2. Closed hatch at l = 1 (floors around it): walking across stays at `feet = LEVEL_H`.
  3. Open hatch: walking onto it drops to the l = 0 deck within 1 s, and `penetration` stays ≤ 0.01.
  4. Ladder in all 4 r, using a real `MoveFeel` with `grid.climb`: forward reaches `h = LEVEL_H` in about 1.1 s; stepping forward lands on the landing floor at l = 1 and releases the ladder; backward from the landing re-attaches and climbs down to the deck and detaches.
  5. Ladder under a closed hatch stops at capH, with the head below the slab bottom.
  6. Ladder through an open hatch reaches the side floor.
  7. Jump off a ladder pushes along the normal and releases it.
  8. Recreating `phys` mid-climb releases the ladder.
- `tests/paint.test.mjs`: the new ids match PIECE_RE and a hatch tint key is unchanged by a toggle. Animals graph: a railing edge blocks and an open gate does not.
- A models smoke test with the vendored THREE: each of the 4 pieces plus 2 variants builds, and each fits inside BOUNDS ±0.02.
- Building glue test (stub T if the existing tests have one, otherwise via grid plus a `toggle` unit): closing with a body inside the cell is refused with 'Someone is in the way', and opening with a body on it succeeds.
- Run `npm test` and shoot.py. `errors` must be empty, and the draw calls on main should not grow with no new pieces placed.

## 12. File list and hooks
- `dist/building-pieces.js`:
  - :15-26 PIECES rows;
  - :27 PIECE_ORDER;
  - :30 SLOT_OF;
  - new STATEFUL/consts and `toRec` (export);
  - :97 and :107 load;
  - :169-170 canPlace;
  - :177 place;
  - :208-238 `_rebuild`;
  - :338 `_scan`;
  - :357-377 `preStep` (3rd arg);
  - :413 `_ramps`;
  - new `toggle`, `_inStrip`, `ladderAt`, `climb`, `occupied`.
- `dist/building.js`:
  - :5 import toRec;
  - :12 STORED + VARIANTS;
  - :18 geos;
  - :42-57 rebuild;
  - :102-107 retint;
  - :111 showGhost;
  - :142 toRec;
  - new target/prompt/interact/toggle;
  - :160-170 dispose and the return object (`preStep:(ph, d, c) => grid.preStep(ph, d, c)`, `climb:(...a) => grid.climb(...a)`).
- `dist/building-models.js`: 4 new builders (with the `open` flag); :247 BUILDERS; :251 createPieceGeometry; :267 BOUNDS.
- `dist/build-menu.js:10-20` ICONS. `dist/paint.js:19,21`. `dist/animals-core.js:89,101`.
- `dist/game.js`:
  - :717 prompt;
  - :722 usable;
  - :1058 host `piecetoggle` branch;
  - :1143 interact;
  - :1265 `const climb = !diving?.state.diving ? building?.climb(controls?.feel, physics, deckY(), {forward:fwd, jump:ci ? ci.jump : input && held('Space'), yaw}, dt) : undefined;` then `building.preStep(physics, deckY(), climb)`.

  With no controls lane, `feel` is null and ladders are not climbable; they are still solid and the top is still a ledge.
- Tests: `tests/building-pieces.test.mjs`, `tests/building-physics.test.mjs`, `tests/paint.test.mjs`, `tests/animals.test.mjs`, and the models smoke test in building-pieces.test.mjs.

## Build notes
All four pieces shipped, including the optional gate. There is no protocol bump, no new module and no npm dependency.

**Files changed**
- `dist/building-pieces.js`: the 4 piece rows, appended `PIECE_ORDER`, `SLOT_OF`, the exported `STATEFUL`, `RAIL_H`/`GATE_GAP`/`LEAF_H`/`LAD_*`, and `toRec`, used in `load` (both places) and `place`. It also has the canPlace exceptions, the `_rebuild` boxes for hatch, ladder and open gate (plus a `_cellBox` helper), the `_scan`/`_ramps` cases, `preStep(phys, deckY, climbing)`, and the new `toggle`, `occupied`, `_inStrip`, `ladderAt`, `_capH`, `climb` and `_pin`.
- `dist/building.js`: `toRec`, `VARIANTS`/`meshKey` (one InstancedMesh per variant), and `target`/`prompt`/`promptOf`/`interact`/`toggle`. The return object gains `climb` and a 3-argument `preStep`.
- `dist/building-models.js`: the railing, hatch, ladder and gate builders, with an `open` flag for the hatch and gate. `createPieceGeometry(T, type, open)` uses the same seed both ways. `BOUNDS` covers the 4 ids plus `hatchOpen`/`gateOpen`.
- `dist/build-menu.js`: 4 icons. A phone-width wheel was checked with 13 sectors.
- `dist/paint.js`: `PIECE_RE` and `PIECE_TYPES`.
- `dist/animals-core.js`: the railing joins WALLS, a closed gate blocks, and a ladder cell at l=0 is removed like stairs.
- `dist/animals.js`: one tagged line so `worldSig` includes `o`. Without it, toggling a gate at deck level would not re-plan the walk graph. This file was not on the spec's list.
- `dist/game.js`: the following hooks, all tagged `[buildpack]`.
  - `bt` is computed once per frame in `updateContext` and drives both the prompt (through `contextHtml`, so the shared prompt bar shows it) and `usable`.
  - The host `piecetoggle` branch.
  - E in `interact()`, before content.
  - A reused `climbIn` object, and `building.climb(...)` → `preStep(..., climb)`.
- Tests: the new `tests/building-pack.test.mjs` (17 tests), and the `PIECE_ORDER` line in `tests/building-pieces.test.mjs`.

**Deviations and additions (and why)**
- **Railing and gate collision height is `RAIL_H + 0.25` (1.2 m).** The visible rail stays at 0.95. With the test raft bob of ±0.15 m, a running jump from a deck that is moving down rose more than 0.95 relative to the deck and cleared the rail (z went to 5.4). The taller invisible box fixes this and changes nothing else, since nothing stands on a railing.
- **A hatch over a ladder takes the ladder's rotation**, in `place` in both orders and also on load. Otherwise a hatch placed with a different yaw would hinge its leaves across the ladder side, and a climber could not step out at the top. The leaves are symmetric, so only the axis matters.
- **The climb pins the body's along-ladder distance** to `LAD_IN - BODY_R - 0.02`, eased at 2.5 m/s, while `h < LEVEL_H - 0.04`. Without the pin, W and S also drive PlayerPhysics horizontally: S on the ladder walked you out of the strip and dropped you. Strafing stays free, so strafing off still releases. At the top the pin lets go, so forward walks onto the landing.
- **When the hatch above opens or closes mid-climb**, `capH` is recomputed and `feel.setLadder` is called again with the new `topY`. MoveFeel clamps to the old top otherwise.
- **A long frame climbs in pieces of 0.1 s or less** (capped at 0.25 s), because MoveFeel clamps dt to 0.1. Without this, the climb crawled at low fps.
- **`ladderAt` uses `L = floor((feet - deckY + 0.3) / LEVEL_H)`.** On a rising bob the feet sit a hair under the deck, and the plain floor gave L = -1, so the ladder never attached.
- **Ladder input:** `climb()` reuses one input object, and `game.js` reuses `climbIn`, so climbing allocates nothing per frame apart from MoveFeel's own result object.
- **New `postStep` → `_sweep`.** This fixes an existing bug with walls too. game.js runs up to five 0.05 s physics substeps before a single `postStep`. On a lag frame of 0.25 s or more, the body could move more than its radius, and the push-out then popped it to the far side of a thin wall or rail. In the close-up at low fps, the player walked straight through an upper-floor railing and fell. `_sweep` tests the frame's XZ segment against the solids it meets vertically, using the same `lo`/`hi` as `_solids`, and skips boxes it already overlapped at the start. It stops the body 1 cm before the first entry. It runs only when the frame moved more than 0.2 m. The new test "lag spike" covers this. Without the sweep, a wall is crossed at 4 fps (z 8.4).
- **The gate opens towards local +z (as in the spec).** On a platform's +z edge it swings out over the drop. It is cosmetic only, because the open leaf has no collision.

**Co-op:** the host-authoritative toggle resends `pieces` by identity. A guest climbs on its own synced grid. Mixed versions are unsupported: an old host ignores `piecetoggle` silently, and an old guest drops the new types.

**Verified:**
- `npm test` passes, all `node --check` runs pass, and `shoot.py` reports `errors: []`.
- A Playwright close-up (`scratchpad/r3/build/closeup.py`) runs a seeded save with a 2x2 upper floor on 4 pillars, a ladder up to a hatch, railings and a gate. In it:
  - E opens the hatch from the ladder and closes and reopens it from the landing.
  - The climb runs through the hole onto the landing.
  - E opens the gate.
  - Closing with yourself in the hole is refused.
