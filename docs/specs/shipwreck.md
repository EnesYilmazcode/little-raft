# Sunken shipwreck dive sites: spec

Research: [docs/features/shipwreck-research.md](../features/shipwreck-research.md) (it says `wreck.*`; the real file names are `shipwreck*`, as below).
Every 8 to 12 minutes a small broken ship settles 6 to 12 m down beside the raft for about 4 minutes. A ring of floating planks and a bubble column mark the spot. Divers hold E (using the normal gather ring) to open 3 to 4 crates, 1 to 2 barrels and one captain's chest, which may hold a logbook note. There are no hazards. Host-authoritative, saved in `world.ext.shipwreck`.

Files: `dist/shipwreck-core.js` (pure, no THREE/DOM), `dist/shipwreck.js` (`createShipwreck(ctx)`, name `'shipwreck'`), `dist/shipwreck-model.js`, `tests/shipwreck.test.mjs`. Imports use `?build=v3-survival-ae77fa84ac2b`, like trader.js and treasure.js.
No new items, icons, recipes or decor.

## 1. diving.js: the `getTargets` hook (small anchored edits)
- Signature (`createDiving`, :162): append `, getTargets = null` after `getMods = null`. Update the header comment: `getTargets(x,y,z,r,out): push extra hold-E targets {id,x,y,z,secs,label,done(id),hover(id|null)} into out (docs/specs/shipwreck.md)`.
- Add state next to `const mods = …`: `const extra = []; let targetExt = null; // extra (content) targets, reused array`.
- In `resetGather`, inside the `if (targetId !== null)` block, add: `if (targetExt) { try { targetExt.hover?.(null); } catch {} targetExt = null; }`.
- In `updateGather`, after the `nodesNear` for-loop and before `if (!lastInput.gather) needRelease = false;`, add:
```js
    let bestExt = null;
    if (getTargets) { extra.length = 0; try { getTargets(p.x, p.y, p.z, DIVE.REACH + 0.5, extra); } catch (e) { console.error('dive targets failed', e); extra.length = 0; }
      for (let i = 0; i < extra.length; i++) { const t = extra[i]; if (!t || typeof t.id !== 'string' || pending.has(t.id)) continue;
        const vx = t.x - p.x, vy = t.y - p.y, vz = t.z - p.z, dist = Math.hypot(vx, vy, vz);
        if (!(dist <= DIVE.REACH) || dist < 1e-4) continue;
        const ang = Math.acos(clamp((vx * dx + vy * dy + vz * dz) / dist, -1, 1));
        if (ang <= DIVE.GATHER_CONE && ang + dist * 0.05 < bestScore) { bestScore = ang + dist * 0.05; best = null; bestExt = t; } } }
```
- Change `const id = best ? best.id : null;` to `const id = bestExt ? bestExt.id : best ? best.id : null;`.
- In the `if (id !== targetId)` block, replace the body with:
  `gather = 0; targetId = id; targetType = bestExt ? 'ext' : best ? best.type : null; try { seafloor.highlight?.(best ? id : null); } catch {} if (targetExt && targetExt !== bestExt) { try { targetExt.hover?.(null); } catch {} } targetExt = bestExt; if (bestExt) { try { bestExt.hover?.(id); } catch {} }`
- Hold time: `gather += dt / ((targetExt ? clamp(fin(targetExt.secs, 1), 0.2, 5) : (DIVE.GATHER_SLOW[targetType] ?? DIVE.GATHER_SECONDS)) * mods.gather);` (the scraper and meal bonus apply).
- Completion: replace `try { onGather?.(id); } …` with `const ext = targetExt; targetExt = null; try { if (ext) { ext.hover?.(null); ext.done?.(id); } else onGather?.(id); } catch (e) { console.error('gather failed', e); }`. Move this before the `targetId = targetType = null` line, or capture `ext` first. `pending.set(id, …)` stays as it is, so the target is skipped for 1.5 s while the host replies.
- Label (in `update`): `if (labelId !== targetId || targetExt) { labelId = targetId; label = targetId ? (targetExt ? String(targetExt.label || 'Hold E') : \`Hold E · ${NAMES[targetType] ?? targetType}\`) : ''; }`. The labels are cached strings, so this does not allocate.
- QA warp, added to the returned API next to `cancel`: `warp(physics, x, y, z) { if (!body) { body = new DiveBody({ x, y, z, vx: 0, vy: 0, vz: 0, oxygen }); owner = physics; } body.x = x; body.y = y; body.z = z; body.vx = body.vy = body.vz = 0; return true; },`

## 2. content.js aggregator (copied from the `diveMods` pattern)
- Header line after `diveMods(m)`: `//   diveTargets(x,y,z,r,out) push cached hold-E dive targets into out (never allocate per frame; docs/specs/shipwreck.md)`.
- Next to `call1`: `const callT = (m, x, y, z, r, out) => { try { m.diveTargets(x, y, z, r, out); } catch (e) { console.error(\`content ${m.name}.diveTargets failed\`, e); off(m); } };`
- In the returned object, after `diveMods(out) {…},`:
  `diveTargets(x, y, z, r, out) { out.length = 0; for (let i = 0; i < mods.length; i++) { const m = mods[i]; if (!m.dead && typeof m.diveTargets === 'function') callT(m, x, y, z, r, out); } return out; }, // [shipwreck] extra hold-E dive targets`
- Import `createShipwreck` and append it to FEATURES before `createCookpot`, so cookpot stays last.

## 3. game.js (two one-liners, nothing else)
- `createDiving({…})` (:473): after `getMods:out => content?.diveMods?.(out)` insert `, getTargets:(x, y, z, r, o) => content?.diveTargets?.(x, y, z, r, o)`.
- contentCtx: add a new line after the `note: … // [buoycourse]` line:
  `floorAt: (x, z) => diving?.seafloor?.heightAt?.(x, z) ?? NaN, get diving() { return diving; }, award: ev => award(ev), // [shipwreck] seafloor y, dive QA warp, logbook awards`
  `heightAt` is the pure `seafloorHeight(x, z, islands)`, so host and guest get the same value.

## 4. Schedule and phases (core `SW`, frozen)
`FIRST 420, CALM_MIN 480, CALM_MAX 720, APPROACH 20, DOCK 240, DOCK_CAP 600, DEPART 20, WARN 30, NEAR 25, START_Z -60, END_Z 60, RETRY 60, FLOOR_MIN -12, FLOOR_MAX -6, REACH 2.8, SLACK 1.5, OFF_MIN 10, OFF_MAX 30, GAP 9`.
- `nextDelay(seed, first)`: if `first`, return FIRST, else `CALM_MIN + (CALM_MAX-CALM_MIN)*hash3(seed>>>0, 91, 7)`.
- `pathAt(t, dock, z, out)`: approach (the marker eases out from START_Z to z), then docked, then depart (eases in to END_Z), then gone. It writes `out.phase/left/mz` (marker z) and does not allocate. **The hull and containers exist only in `docked`.** The approach and depart glides move only the surface marker, because a hull gliding over noise terrain would clip.
- The clock ticks only while `ctx.running`. A guest slews toward the host clock using the islands rules (`SLEW_SNAP 1`, `SLEW_RATE 4`, `islands.js:286-292`).
- Host, while docked: if `left <= WARN+1`, `dock < DOCK_CAP` and a player (`ctx.physics`/`ctx.other`) is within NEAR m (3D) of the site, then `dock += dt`. Otherwise, at `left <= WARN`, send one notice: "The bubbles are thinning: the wreck will soon be lost to the currents". When the phase is gone: `site = null; next = clock + nextDelay(seed)`.
- Spawn notice ('all'): "Bubbles are rising nearby: something rests on the seafloor!". The first time every slot is open ('all'): "Wreck cleared! Nothing left but kelp and fish."

## 5. Placement (host only, in `spawn(seed)`; the result is stored, so guests never re-derive it)
- `side`: if `islandNow()` is not null and its phase is not 'gone', then `side = -Math.sign(islandNow().cx) || 1`. Otherwise `side = seed & 1 ? 1 : -1`.
- `edge` is the raft bbox edge on that side, taken from `ctx.world.tiles` (the same loop as `dockOffset`, `islands-layout.js:146`). `off = clamp(edge + GAP, OFF_MIN, OFF_MAX)`. This keeps the site well inside the 50 m dive leash.
- `candidates(seed, side, off, dockZ, out6)` (core) writes 6 `[x,z]` points: `x = side*(off + 2*(k%3))` and `z = dockZ + (k<3 ? 0 : (hash3(seed,k,3)-.5)*6)`, where `dockZ = -4 + 8*hash3(seed,5,9)`. The host takes the first point where `y = ctx.floorAt(x,z)` is finite and between FLOOR_MIN and FLOOR_MAX. If none fits, or `floorAt` returns NaN because diving is off: `next = clock + RETRY`, and nothing spawns.
- State: `site = {seed, born: clock, dock: DOCK, x, z, y, opened: 0}`.
- Each client computes container world positions once per site: `slotWorld(lay, k, site)` = the yawed local slot + `site.x/z`. Then `y = clamp(floorAt(wx,wz), site.y-1.5, site.y+1.5) + slot.h`. If `floorAt` is NaN, use `site.y`. The result is cached in a `Float32Array(21)`.

## 6. Layout `layoutFor(seed)` (core, cached and frozen; site-local metres; hull runs along local z)
`r = rng(seed ^ 0x5eed5)`, `variant = ['keel','listing','bow'][seed % 3]`, `yaw = r()*2π`. Crates: 3 + (r()<.5) picked without repeats from 6 spots. Barrels: 1 + (r()<.5) from 3 spots. Each gets jitter of ±0.3 and `rot = r()*2π`. Slot order: **0 = chest**, then crates, then barrels (at most 7, so `opened` fits in 7 bits). `slot.kind` is 'chest' | 'crate' | 'barrel', and `slot.h` is the height of the container base above the bed.
| variant | crate spots (x,z) | barrel spots | chest (x,z,h) |
|---|---|---|---|
| keel: upright split hull 9 m | (-1.2,-2.5) (1.2,-2.5) (-1,0.5) (1.1,1) (-2.4,2.8) (2.6,-0.8) | (0,-3.6) (-2.2,-0.6) (2,3.2) | (0,3.4,0.3) stern cabin |
| listing: rolled 35° to +x, hold spilled | (1.8,-2) (2.8,-0.4) (2.2,1.6) (3.6,0.8) (-0.6,-1.2) (0.4,2.6) | (3.4,-2.4) (4.2,2.2) (-1.6,3.4) | (1.2,3.6,0) |
| bow: bow half + scattered stern ribs | (-0.8,-3) (0.9,-1.8) (-1.5,0.4) (2.2,2.4) (-2.6,3.6) (0.6,4.2) | (1.6,0.2) (-0.4,2.6) (3,4.6) | (-0.2,-0.4,0) broken edge |
Kelp: 10 + floor(r()*7) tufts within a radius of 6 m, rejected (up to 40 tries) if within 0.8 m of a slot or 0.6 m of the hull centreline. Fish: `6 + floor(r()*3)`, `orbitR 3+2r()`, `orbitH 1.5+1.5r()`, `speed 0.25+0.15r()` rad/s, phase spread evenly.

## 7. Loot `lootFor(seed, slot, kind, hasNote, known)` (core; deterministic per (seed, slot), returns `[[id, n], …]`, merged)
`r = rng((hash3(seed, slot, 13) * 4294967296) >>> 0)`. Weighted picks use only the entries where `known(id)` is true. The module passes `id => !!ITEM_INFO[id]` (content items are merged into ITEM_INFO). An empty table gives nothing, and a container that rolls nothing gives `[['wood',1]]` if wood is known.
- crate, 2 rolls: wood 2-3 (4), scrap 2-3 (4), rope 1-2 (3), nail 2-3 (3), plastic 1-2 (2), glass 1 (1), metalingot 1 (1).
- barrel: plastic 1, plus 1 roll from rope 2 (3), seaweed 2 (2), clay 2 (2), copperore 1 (1), cup 1 (1).
- chest: shell 3-5, plus, if `!hasNote`, 1 roll from glassfloat 1 (4), metalingot 2 (3), copperingot 1 (2), shellwreath 1 (1). When `hasNote` is true the note replaces the rare roll.
Every id was checked on 2026-11-21 (wood scrap rope nail plastic glass metalingot seaweed clay copperore cup shell glassfloat copperingot shellwreath are all in ITEM_INFO). The `known` filter covers future removals.

## 8. Opening flow
- **Targets (every client, per frame, no allocations).** `diveTargets(x,y,z,r,out)` returns at once unless the site is docked and `(x-site.x)²+(z-site.z)² < 100`. For each closed slot within r it pushes a cached target object, built once per site: `{id:'sw:'+seed+':'+k, x, y:slotY+0.35, z, secs: chest ? 1.6 : 1.2, label, done, hover}`. The labels are 'Hold E · Open crate', 'Hold E · Open barrel' and "Hold E · Open captain's chest". `hover(id)` sets the module's `hoverSlot` and calls `model.hover(k)`; `null` sets -1.
- **done(id)** → `ctx.action({kind:'wreck.open', seed, slot:k})`. The host handles it directly. A guest sends it to the host and never touches `opened` locally.
- **Host `action(a, actor, bag)`:** handle only `a.kind === 'wreck.open'`. `hasNote = nextNote(ctx.world.notes) >= 0` (import from logbook.js). `pos = actor === 'guest' ? ctx.other : ctx.physics`. `r = applyOpen(st, a, actor, pos, bag, hasNote, known)`. Always return true.
- **`applyOpen` (core, pure)** checks, in order, and returns `{ok, reason, loot, note}`:
  1. kind
  2. site exists ('none')
  3. `a.seed === site.seed` ('stale')
  4. phase is docked ('phase')
  5. `Number.isInteger(slot) && 0 <= slot < lay.slots.length` ('slot')
  6. `!(opened >> slot & 1)` ('opened')
  7. pos has finite x/y/z and its 3D distance to the slot centre is ≤ `REACH + SLACK` ('reach'). It uses `st.slotPos`, which the module fills from §5.
  8. the bag is valid ('bag')
  9. scratch `new bag.constructor(bag.snapshot())`, add each loot entry; any remainder > 0 gives 'full', and the slot stays closed
  10. commit `bag.slots[i] = scratch.slots[i]` and `site.opened |= 1 << slot`; `note = kind==='chest' && hasNote`
- **Host on ok:**
  - Emit `{kind:'loot', loot:{id:n…}, text:'+ …'}` to the actor.
  - If `r.note`, copy `collectBottle` (game.js:1032-1038): `const n = nextNote(ctx.world.notes); if (n >= 0) { ctx.world.notes.push(n); ctx.emit({kind:'note', note:n, text:\`A captain's note! (${ctx.world.notes.length}/${NOTE_COUNT}) · L to read\`}, 'all'); ctx.award?.({kind:'note'}); }`. `world.notes` already saves and syncs in hostState, and `kind:'note'` fires `logbookUI.celebrate`.
  - Re-tint locally with `model.setOpened(slot, true)`, and send the cleared notice if `opened === full mask`.
- **Host on failure:** 'full' → `emit({kind:'full', text:'Your bag is full'}, actor)`. 'opened' → `emit({kind:'notice', text:'Already empty'}, actor)`. Every other reason is silent, and the pending entry expires after 1.5 s.

## 9. Co-op
The host owns `clock`, `next` and `site`, including `opened`. Guests get `serialize()` through hostState ext (about 8/s) and call `load(d,'net')`:
- a different seed, or no site → rebuild
- the same seed → copy `born`/`dock`, and for each bit that changed call `model.setOpened(k, bit)`. There are no mesh rebuilds.
Diving and target scoring are per-client, so both players can loot at the same time. Slot positions come from the stored x/z/y plus the shared `floorAt`, so both clients agree.

## 10. Save and validation
- Format: `world.ext.shipwreck = {v:1, clock, next, site:null | {seed, born, dock, x, z, y, opened}}`.
- `DEFAULTS()` is `{v:1, clock:0, next:FIRST, site:null}`. Old saves call `load(undefined)`, which uses these defaults.
- `clean(data)` follows `islands-layout.js:163` and never throws:
  - require `v === 1`
  - clamp `clock` to [0, 1e9]
  - clamp `next` to [clock, clock+DOCK_CAP+CALM_MAX], else `clock+FIRST`
  - drop the site unless the seed is a uint32, x/z/y/born/dock are finite, `|x|,|z| ≤ 80` and `y` is in [-25, -2]
  - clamp `born` to [clock-(APPROACH+DOCK_CAP+DEPART), clock] and `dock` to [0, DOCK_CAP]
  - drop the site if `pathAt` reports gone
  - `opened = (opened|0) & ((1 << lay.slots.length) - 1)`
- `serialize()` returns one cached object, refreshed in place.

## 11. Model `dist/shipwreck-model.js`: `createShipwreckModel(T)` → `{group, marker, build(lay, slotPos), setOpened(k,on), hover(k), update(time, dt), dispose()}`
Everything uses `mergeGeometries` (merge-geo.js:7) and vertex-coloured MeshStandardMaterial (roughness 0.9, one shared material where possible), with `castShadow = receiveShadow = false`. Geometry is built lazily once per variant and cached. Under 6k triangles in total.
| # | mesh | |
|---|---|---|
| 1 | hull | planks, ribs, broken mast and rudder for the variant (listing is rolled 35°) |
| 2 | bed | sand skirt with a 6 m radius (its vertices are dropped onto `floorAt` in `build`), 4 loose planks, an anchor, 2 rocks |
| 3 | crates (closed) | InstancedMesh(4). Hover = `setColorAt` brighten ×1.35 |
| 4 | barrels | InstancedMesh(2). Open = tipped on its side, which is a matrix change |
| 5 | crates (open) | InstancedMesh(4), lid-off geometry. `count` is updated |
| 6 | chest | one Mesh. Open = `mesh.geometry = openGeo` (lid raised; both geometries are built once) |
| 7 | kelp | InstancedMesh(16) with its own copy of the sway snippet from `seafloor.js:163-172` (`onBeforeCompile`, module `uTime`) |
| 8 | fish | InstancedMesh(8). Its matrices are written in `update` from scratch Matrix4/Quaternion objects |
- `marker`: an InstancedMesh of 6 floating planks plus a merged bubble column (2 calls), bobbing on `ctx.ocean.getHeight`.
- Visibility, set each frame in the module:
  - `group.visible = docked && cam.y < ocean.getHeight(cam.x, cam.z) + 0.25` (the same gate as `diving.js` uses for the floor), so it costs 0 draw calls from the surface
  - `marker.visible = phase !== 'gone' && !group.visible`
  - fish and kelp time update only while `group.visible`
- The underwater peak is 8 calls.

## 12. Module `dist/shipwreck.js`
`name 'shipwreck'`. Hooks: `update(dt)` (tick, host schedule, place, model), `serialize`, `load`, `action`, `diveTargets`, `prompt(aim)`, `debug`, `dispose`. The optional `prompt` returns a muted hint ("Bubbles below: dive (C) to explore the wreck") only when not diving and `aim.point` is within 4 m horizontally of the marker.
- No allocations in update or diveTargets.
- **Accessor for the dolphin friend:** `export function shipwreckNow()` returns one cached `{seed, x, y, z, phase, left, cleared}` while a site exists, or null. It follows the `islandNow` pattern (islands.js:38-41, 415-424): a module-level `live`, cleared in `dispose`. Callers must import shipwreck.js with the content.js `?build=` specifier. `debug.site()` returns a copy of the same data, so a dolphin builder can also read `raftDebug.content.shipwreck?.site()`.
- **The kite** does not interact with this feature.

## 13. Debug (`raftDebug.content.shipwreck`, host only unless noted)
- `summon(seed?)`: spawns now (with placement retries), at the approach phase.
- `dock()`: sets `born = clock - APPROACH`, so the wreck is docked.
- `skip(s)`: advances the clock.
- `phase()` and `site()`.
- `slots()`: `[{k, kind, x, y, z, open}]`.
- `teleportDiver(k=0)`: calls `ctx.diving.warp(ctx.physics, x, y+1.2, z+1.8)` facing the slot. Works on any client. Returns the position.
- `open(k)`: `ctx.action({kind:'wreck.open', seed, slot:k})` (as the local actor; the guest version is routed to the host).
- `openAll()`.
- `loot(k)`: returns `lootFor` without opening.

## 14. Tests `tests/shipwreck.test.mjs` (node:test, core only)
1. `layoutFor`: deterministic, frozen, chest at slot 0, 4-7 slots, crates 3-4, barrels 1-2, kelp 10-16 with clearance, all 3 variants reachable (seeds 0/1/2).
2. `pathAt`: phase boundaries, approach/depart marker z endpoints, `out` reused.
3. `nextDelay`: FIRST, and a range of [480, 720].
4. `candidates`: 6 points, all on `side`, finite, deterministic.
5. `lootFor`: deterministic per (seed, slot); only known ids; an unknown-id filter drops entries; the chest always has shell 3-5; with `hasNote` there is no rare roll; counts within ranges.
6. `applyOpen` happy path: the bag gains the loot and the bit is set.
7. `applyOpen` failures:
   - stale seed, bad slot, already opened
   - not docked, out of reach (and guest slack within it)
   - bag full: the bag is unchanged and the bit is unset
8. `clean`: undefined/garbage gives defaults; clamps; a gone site is dropped; the opened mask is trimmed; a round trip is stable.
9. `hash3`/`rng` imports match islands-layout (no new RNG).

Checks: `npm test`, shoot2.py `errors: []`. For a browser QA pass:
1. `summon` → `dock` → `teleportDiver(0)`
2. hold E, or use `open(0)`
3. expect a loot feed row and, on a new world, a note celebrate
4. take a screenshot underwater
5. check co-op with coop2.mjs: open a slot from the guest; the host bit is set and the guest re-tints.

## Implementation notes
- **Model `build` signature.** It is `build(lay, slotPos, site, floorAt)`, not `build(lay, slotPos)`. The bed skirt, the loose planks, the anchor, the rocks and the kelp all need the site's origin and `floorAt` to drop onto the floor. The model also exposes `updateMarker(x, z, getHeight, time)`, which bobs the marker planks, and `clear()`. The module calls `updateMarker` only while the marker is visible.
- **Open crates.** Open crates use a fixed `count` of 4, and a crate's closed and open instances swap between a zero-scale matrix and its real matrix. `count` is not changed.
- **Chest hover.** The chest uses a clone of the shared material (`chestMat`), so hovering can brighten it ×1.35 without an `instanceColor`.
- **Bed rim.** The bed rim sinks up to 0.29 m under the floor beyond r = 3.5 m, so the skirt blends into the noise floor without a hard seam.
- **Core extras.** The core also exports `dockZFor`, `raftEdge`, `offsetFor`, `fillSlotPos`, `fullMask`, `SLOT_CENTRE` (0.35) and `HULL_HALF`. The reach check (§8, step 7) measures to the slot base + `SLOT_CENTRE`, and `REACH + SLACK` applies to both host and guest, as §8 states.
- **`shipwreckNow()` and `debug.site()`.** `shipwreckNow().z` is the marker z (`path.mz`), which equals `site.z` while docked. During approach, `debug.site().z` is also the marker z.
- **Extra QA helpers.** `debug.warpTo(x, y, z)` is a free dive warp on any client. `debug.targets()` and `debug.hover()` are also available.
- **Late floor.** If `floorAt` is NaN when a site loads (for example, diving not created yet), the slot positions fall back to `site.y`. They are re-derived on the first frame where `floorAt` is finite.
- **FEATURES comment.** `createShipwreck` has no inline `/* … */` comment inside the FEATURES array. The cookpot and gametable tests parse the array with `[^\]]*`, so a bracketed tag there breaks them.
