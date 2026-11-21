# Spec: Raft Beacon

Source: docs/features/beacon-research.md. Line numbers were re-checked against the current tree, and all paths are under `dist/`.
The Raft Beacon is a tall fuelled lantern you place on the deck. While it is lit, it glows at night, sends a soft light column up into the sky, and shows a **Home** marker on screen whenever you are away from the raft.
Cozy rules: fuel burns only at night, and running out just means the light rests until you add more. Nothing breaks.
**Scope: fuel only.** There is no battery, power or `powerAt` coupling this round (see Future work). game.js gets **no edits**. One builder can do all of it.

## 1. Files
- New: `beacon-core.js` (pure, imports nothing), `beacon-model.js` (THREE passed as `T`, imports nothing; copy the tiny `bake` from `power-model.js`), `beacon.js` (`createBeacon(ctx)`), and `tests/beacon.test.mjs`.
- beacon.js imports `./beacon-core.js`, `./beacon-model.js`, `nearestTile` from `./paddleboard-core.js` and `islandNow` from `./islands.js`. Every import uses `?build=v3-survival-ae77fa84ac2b`.
  The islands stamp must match content.js:60 exactly, or the import gets a second instance whose `islandNow()` is always null (see spyglass.js:7).

## 2. Item, recipe, gating (items.js, all tagged `// [beacon]`)
- After the lamppost row (items.js:270-272), add `item('beacon', 'Raft Beacon', 'decor', { placeable: true, iconTint: '#5fe0c8', recipe: hand({ wood: 4, glass: 2, rope: 2, nail: 2 }), unlock: research('glass'), tip: 'A tall lantern that guides you home. Burns fuel only at night.' })`.
- In `BLOCK_RADII` (items.js:349), add `beacon: 0.14`. There is no `PROGRESSION_PLAN` row, and every input is already reachable, so `progression.test.mjs` needs no edit.
- craft-book.js:28: add `beacon: 'survival'`. craft-book.js:176: add the row `beacon: { desc: 'A tall lantern with a turning lens.', use: 'Add leaves, planks or plastic. Shows the way home at night.' }`.
- item-svg.js: after the lamppost icon (:372), add a `beacon` icon: a post with a lantern head and two short teal rays.
- held-items.js is not touched. As with the lamp post, the placement ghost comes from `decorModel` (game.js ghost path).

## 3. Pure core (beacon-core.js)
- Constants: `CAP = 600`, `FUEL = Object.freeze({ leaf: 60, wood: 45, plastic: 60 })` (leaf per the scope decision; wood and plastic copy the engine values from engine.js:13), `NIGHT_ON = 0.15`, `MAX_TICK = 60`, `REACH = 2.6`, `AWAY = 8`, `MAX_ENTRIES = 64`, `OP_GAP = 250`, `MAX_BEAMS = 2`.
  Also `OLD_HOST = 'Your friend’s raft doesn’t have beacons yet'` and `NAMES = { leaf: 'Palm Leaf', wood: 'Plank', plastic: 'Plastic' }` (items.js:82-86).
- `KEY_RE` and `isKey` are copied from power.js:17-20. Also export a local `tileKey(x, z)` that returns `x + ',' + z`.
- `cleanBeacon(v, decor)` returns `{v:1, s, r, b}`. Junk, undefined or an array gives `{v:1, s:'', r:0, b:{}}`. `s` is a string of 32 characters or fewer, and `r` is an int ≥ 0.
  Each entry of `b` is `{on:0|1, f:int}`, with `f` rounded and clamped to `0..CAP`. A key is dropped when it is invalid, when it has no `beacon` decor, or when the entry is idle (`on:0, f:0`). Keep at most `MAX_ENTRIES` entries.
- `applyBeaconAction(st, a, decor, bag)` returns `{ok, text}`. It is shaped like engine.js:130-158, and `a` is `{kind:'beacon', op:'fuel'|'toggle', x, z, item?}`.
  - Both ops first check for int x and z and a `beacon` decor at that tile. If either check fails, return `no('No beacon there')`.
  - `toggle`: flip `on`. The text is `'Beacon on'`, `'Beacon off'`, or `'Beacon on · needs fuel'` when `f = 0`.
  - `fuel`: look up `FUEL` with hasOwnProperty, so an unknown item returns `'Not fuel'`. If `f >= CAP - 1`, return `'Beacon is full'`. If `bag.remove(item, 1)` fails, return `'No <Name> in your bag'`.
    Otherwise set `f = min(CAP, f + add)`. If the beacon was empty and off, set `on = 1` (fuelling an empty beacon lights it). The text is `'+60 s fuel'`.
  - On success, bump `st.r` and drop the entry if it is now idle.
- `tickBeacon(st, decor, dt, night)`: floor `dt`, then clamp it to `0..MAX_TICK`. When `night < NIGHT_ON`, it is a no-op.
  Otherwise each entry with `on && f > 0` loses `dt` seconds of fuel, down to 0. Return `{emptied:[keys]}`, and bump `r` only when some `f` changed.
  A night lasts about 420 s (power.md section 3), so a 600 s cap covers a full night. Ten leaves fill the beacon.
- `isLit(st, k)` returns `!!(e && e.on && e.f > 0)`. `fmtFuel(f)` returns `"4:10"`.
- `nearestLit(st, decor, x, z, out)` writes `out.found`, `out.x`, `out.z` and `out.d` (metres from `(x, z)` to the tile centre `(tx*2, tz*2)`) and allocates nothing.
- `isAway(f)` takes a reused flags object `{swimming, board, zip, sand, deckD}` and returns `(swimming || board || zip || sand) && deckD > AWAY`.
- `edgeInto(out, sx, sy, inFront, w, h, margin)` is an allocation-free copy of signal.js:144 `edgePoint` that writes `out.x`, `out.y` and `out.edge`. A test asserts that both functions give the same results.

## 4. Model (beacon-model.js)
- `createBeaconModel(T)` returns a Group named **`craft_beacon`**, about 2.4 m tall, with its origin at the floor top. Every material is fresh per call, except the beam's (see below). All named parts are **direct children**:
  - `beaconBody`: a wooden foot, a 2.1 m pole (#7a5a3a) and a cap ring (#5d6b78), baked into one mesh with `castShadow`.
  - `lanternGlass`: a box with `transparent`, opacity .45, `side: FrontSide` and `userData.glass = true`.
  - `lanternGlow`: a sphere at y 2.15 with emissive #ffe9b0 .5 and `userData.pool = {color:'#ffe9b0', gain:.9}`.
  - `lens`: a Group at the glow centre holding one mesh, two thin fresnel panels (#bff3ea, emissive .25), with `castShadow` false. Store it in `g.userData.lens`.
  - `beaconBeam`: see the next item.
  Set `g.userData.power = {lit:0}` at construction, so daynight caches the object even when it scans first (as power.md section 6 does).
- `beaconBeam(T)` lazily builds **one shared** geometry and material at module level:
  - The geometry is `CylinderGeometry(.16, .6, 18, 12, 1, true)`, translated so that its base sits at the lens. A vertex-colour alpha ramp fades it out toward the top.
  - The material is `MeshBasicMaterial({ color:'#ffe9b0', vertexColors:true, transparent:true, opacity:0, depthWrite:false, fog:false, blending:T.AdditiveBlending, side:T.DoubleSide, forceSinglePass:true })`.
  - Set `userData.shared = true` on both, so game.js:417 `disposeGeometry` keeps them when the raft is rebuilt.
  - Each model adds its own `Mesh` named `beaconBeam` with `visible = false`, `renderOrder = 19` (the co-op ping), and `castShadow` and `receiveShadow` false. Store it in `g.userData.beam`.
  `fog:false` lets the beam read through the fog at 90-260 m.
- Draw calls: 4 by day and 5 at night. **No new PointLights.**

## 5. daynight.js lantern pool (two lines, tagged `// [beacon]`)
- daynight.js:443 `lanternSignature`: also count `decor[i]?.type === 'beacon'`. daynight.js:459 `scanLanterns`: also accept `g.name === 'craft_beacon'`.
- The existing `[power]` path then does the rest. `userData.power.lit` gives `UNLIT` emissive when unlit (:656), keeps the beacon out of `rankLanterns` when unlit, and gives the beacon a share of the 1/2/4 pool lights when lit. The beacon shares the 64-lantern cap.

## 6. Module `createBeacon(ctx)` (name `'beacon'`)
- `load`, `serialize`, the net early-out on unchanged `r`/`s`, `hostHasBeacon = data !== undefined` and `oldHost()` are copied from power.js:138 and :191-209. `serialize` is cached by `st` and `r`.
- `link(env)` keeps `env`. Read `night()` as `env?.night() ?? 0`; with `?daynight=off` the beacon never burns and the beam never shows.
- `target(aim)` is copied from power.js:142-162 with types `['beacon']` and a target y of 2.1. `heldKind()` is copied from engine.js:183.
- `update(dt)`:
  - **Host tick** runs when `ctx.running && ctx.role !== 'guest'`. It accumulates `dt` and calls `tickBeacon` once per whole second.
    For each emptied key it emits `{kind:'notice', text:'A beacon ran out of fuel'}` to `'all'`, at most once per key per night. The warned set clears when `night < NIGHT_ON`.
  - **Visuals** run on every peer. `scan()` rebuilds the `{g, x, z, k}` list only when the raft, its child count or its first child changes (power.js:164-175).
    It sets `g.userData.power.lit = !oldHost() && isLit(st, k) ? 1 : 0` when the raft is rescanned or `st.r` changes. A lit lens spins at `lens.rotation.y += .6 * min(dt, .25)`.
  - The **beam** shows only when `nf >= NIGHT_ON`. It sets the shared `material.opacity = .4 * min(1, (nf - .15) / .35)` and then sets `visible` on the `MAX_BEAMS` lit beams nearest the camera.
    The ranking re-runs every 0.5 s with two index slots and no sort or allocation. All other beams get `visible = false`.
  - The **home marker** is described in section 7.
- `prompt(aim)`, a static string per state. A beacon prompt fires only while you aim at a beacon, so `first('prompt')` stays safe:
  - holding a fuel item and `f < CAP - 1`: `<kbd>E</kbd>Add Palm Leaf (+60 s)`
  - otherwise: `<kbd>E</kbd>Turn beacon off · 4:10 fuel`, `<kbd>E</kbd>Turn beacon on · 4:10 fuel`, or `<kbd>E</kbd>Turn beacon on · needs leaves, planks or plastic`
  - on an old host: `OLD_HOST`
- `interact(aim)`: if no beacon is aimed at, return false. On an old host, show `ctx.notice(OLD_HOST, 2400)` and return true.
  Otherwise send `ctx.action({kind:'beacon', op:'fuel', x, z, item})` when holding fuel and the beacon is not full, or `op:'toggle'` otherwise, and return true.
- `action(a, actor, bag)` (host): return false unless `a?.kind === 'beacon'`. Throttle toggles with `OP_GAP` per actor (engine.js:267-277).
  Call `applyBeaconAction(st, a, decor(), bag ?? ctx.actorBag?.(actor))`, emit `res.text` to `actor` as a notice, and return true.
- `decorModel(type)` returns `createBeaconModel(ctx.T)` for `'beacon'`, else null.
- **Undecor**: no `beforeUndecor`, so pickup is allowed and `beacon` stays out of `NO_UNDECOR`.
  `undecorLoot(d)` returns `[['leaf', min(10, floor(f / 60))]]` when that number is at least 1, else nothing, and must not mutate. `afterUndecor(d)` deletes `b[k]` and bumps `r`.
- `debug`: `state()`, `lit()`, `place(x, z)` (host, like bees.js), `setFuel(x, z, f, on = 1)`, `away()` (the last flags and result), `marker()` (`{shown, x, y, edge, text}`) and `fastForward(sec, night = 1)`.
- `dispose()`: remove only its own marker and style nodes, by reference (sailing-ui.js:27-29), and clear the group list.

## 7. Home marker (local, owned by beacon.js)
- **DOM**: lazily create `<style id="beaconStyle">` and `<div id="beaconMarker" hidden>`, which holds an inline SVG **house glyph** (a teal #5fe0c8 roof and body with a dark outline) and a `<span>` label.
  It must be distinct from `#signalMarker`, the orange 14 px dot at game.js:125. Use `position:fixed; left:0; top:0; pointer-events:none; z-index` the same as `#signalMarker`, and add `.edge{opacity:.7}`. Write the label as `Home · 34 m`.
- **Away flags**, reused in one object and filled once per frame:
  - `swimming = !!ctx.physics.swimming` (this includes diving)
  - `board = !!peer('paddleboard')?.riding?.()`
  - `zip = !!peer('zipline')?.riding?.()`
  - `sand = !!islandNow()?.onSand`
  - `deckD = nearestTile(ctx.world.tiles, p.x, p.z, scratchTile).d`
  Seated or sleeping players are on the deck, so `deckD` hides the marker for them.
- **Show** only if all of these hold: `ctx.running && !ctx.uiOpen() && (ctx.vitals?.hp ?? 1) > 0 && !oldHost() && isAway(flags)`, and `nearestLit(st, decor, p.x, p.z, near).found && near.d > AWAY`.
  The target is the nearest **lit** beacon (`on && f > 0`), day or night. Otherwise set `hidden = true`, written only when it changes.
- **Projection, allocation-free**: keep one module `Vector3` `v`.
  - Set `v.set(near.x * 2, raft.position.y + 2.4, near.z * 2)`. Do not call `v.clone()`, and do not use game.js `project()` (:2257), because both allocate.
  - Copy `v` into a second cached vector, apply `camera.matrixWorldInverse`, and set `inFront = z < 0`. Then call `v.project(camera)`.
  - Screen coordinates come from `innerWidth` and `innerHeight`, then `edgeInto(out, sx, sy, inFront, w, h, 28)`.
  - Write `transform` only when the rounded x or y changes, the `edge` class only when it flips, and the label only when the rounded metres change.

## 8. Co-op, OLD_HOST, saves
- The host is authoritative for `b`. Guests get `ext.beacon` in host state (about 8 Hz) and decor through the snapshot. `lit`, the lens, the beam and the marker are all derived locally, so there are no new net fields.
  Each peer projects from its own `physics` and `camera`. A guest's home is the host's raft, and `load(ext, 'restore')` brings the guest's own raft back after a visit.
- On an old host, `load(undefined, 'net')` sets `hostHasBeacon = false`. Every beacon then shows unlit, with no beam and no marker, and the prompt and interact show `OLD_HOST`.
  An old host's `cleanWorld` drops `beacon` decor anyway. An old guest drops the unknown decor, kind and ext slice. Mixed-version co-op is unsupported, as for power.
- An old save has no `ext.beacon`, so `cleanBeacon(undefined)` gives defaults. A beacon whose decor is missing is pruned on load.

## 9. content.js and live.js hooks (tagged `// [beacon]`)
- content.js, after :84: `import { createBeacon } from './beacon.js?build=v3-survival-ae77fa84ac2b'; // [beacon]`.
- content.js:95 `FEATURES`: insert `createBeacon` **right after `createPower`**. It must be before `createCookpot`, which stays last (tests/cookpot.test.mjs:326-327). Append `[beacon] after power` to the line comment.
- live.js:30 `PRELOAD`: after `'power.js' /* [power] */`, add `'beacon-core.js', 'beacon-model.js', 'beacon.js' /* [beacon] */`.

## 10. Tests (tests/beacon.test.mjs: node:test, `RAFT_DIST`, the vendored THREE and a stub ctx, as in power.test.mjs)
1. `cleanBeacon`: junk and arrays give the defaults. Bad keys, floats, `f > CAP`, `on: 7`, idle entries and keys with no decor are dropped or clamped. A round trip through JSON is stable.
2. Fuel: leaf adds +60, wood +45 and plastic +60. A stone is `Not fuel`. At `f = 599` the result is `Beacon is full` and the bag is untouched. The result clamps to 600.
   An empty bag gives `No Palm Leaf in your bag`. Fuelling an empty, off beacon turns it on, and `r` bumps.
3. Toggle flips `on`. A missing decor gives `No beacon there`.
4. Tick: by day there is no burn. With `night = 1`, 10 s removes 10. An `off` beacon does not burn. `dt` .9 counts as 0 and `1e6` clamps to 60. `emptied` lists the key once. Two identical worlds end up `deepEqual`.
5. `nearestLit` skips unlit beacons and picks the nearest. `isAway` checks each flag with `deckD` 7.9 against 8.1. `edgeInto` matches `edgePoint` on 50 seeded points.
6. Model: the group name is `craft_beacon`. The direct children are `lanternGlow` (pool gain .9), `lanternGlass`, `lens` and `beaconBeam`.
   Two models share the beam material but no other material. The beam material has `forceSinglePass`, `fog === false` and `AdditiveBlending`. The bounding box is under .9 m wide.
7. Module:
   - `load(same, 'net')` twice is a no-op, and `load(undefined, 'net')` gives the `OLD_HOST` prompt. The prompt starts with `<kbd>E</kbd>`, and `promptParts` gives the key `E`.
   - `interact` sends exactly one `ctx.action` of kind `beacon` (fuel while holding a leaf, toggle otherwise).
   - The host `action` notices through `ctx.emit`. `undecorLoot` returns floor(f/60) leaves and does not mutate.
   - With a stub `document`, the marker is created once, shows only while away and lit, hides on `uiOpen`, and is removed on `dispose`.
8. daynight (night pinned, as in power test 8): an unlit beacon `lanternGlow` reads `base*UNLIT`. Set `lit = 1`, and after one frame it reads the night value. The lantern count goes up with `craft_beacon`.
9. The beam is visible only at night while lit, and with three lit beacons exactly `MAX_BEAMS` are visible. A frame of `update` with the marker shown allocates no new `Vector3` (spy on `T.Vector3`).
- These existing tests must keep passing: perf-lint, module-specifiers, live-preload, syntax and cookpot. Run `npm test` and shoot.py, and the `errors` list must stay `[]`.

## Future work
- Power coupling: add `env.powerAt(x, z)` (content.js:139) and a `servingAt` in power.js. A battery-backed beacon would then stay lit with no fuel, with `beacon` added to `isLight` and `DRAIN`. Also add biofuel as a fuel kind.
- A compass tick on `#sailBadge`, and a co-op "friend's beacon" marker.
