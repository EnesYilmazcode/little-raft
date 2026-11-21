# Raft Beacon: research

Round loop-features-202611211004. Read-only survey. Paths are under `dist/`, and line numbers are from the current tree.

## 1. HUD markers we already have
- **Signal cache marker** (the closest match). The CSS for `#signalMarker` is at game.js:125-128 and the DOM is created at :431. `updateSignalHud()` (:840-860) calls
  `project()` (:2257, which allocates a Vector3 and is a diagnostics helper) and then `edgePoint(sx, sy, inFront, w, h, margin)` from signal.js:144.
  It writes `transform` only when the value changes. It is hidden when `!running` or `uiBlocked()`, and on dispose (:2520). `edgePoint` is pure and exported: reuse it.
- **Co-op ping** (coop.js:12, :133-136, :218-226) is a 3D world marker, not a HUD element. coop-fx.js:25-105 `createPings`
  draws a diamond and a 7 m additive beam (`CylinderGeometry` open-ended, vertex alpha fading upward, `MeshBasicMaterial`
  `{transparent, depthWrite:false, fog:false, AdditiveBlending, forceSinglePass}`) with roughly constant screen size `k = clamp(.35+d*.065,.6,7)`.
  This is the template for the beacon's light beam.
- **Compass**: sailing-ui.js:5-23 `#sailBadge` (top-right, 84 px SVG). `toScreen(a, yaw)` (:53) converts a world angle to clockwise screen degrees.
  It is hidden while `#inventory[open]` (:9).
- **Content-owned HUD prior art**: treasure.js:92-118 (`#treasureHud`, lazily built, inline cssText) and buoycourse.js:7, :206-209 (`#buoyTimer`).
  The top-left corner is crowded (signal pill at top:14, treasure at top:16, buoy timer at top:48). An edge marker avoids that corner.

## 2. "Away from the raft"
- The raft never moves in x/z; the world drifts past it instead (sailing-world.js:3). So `physics.x/z` and the tile centres `t*2` share one frame,
  and home is `(d.x*2, d.z*2)` for the beacon tile. The camera y comes from `raft.position.y + .22 + height`.
- **Distance to the deck**: `nearestTile(tiles, x, z, out)` paddleboard-core.js:63 gives `out.d`, the metres to the nearest tile square, with no allocations.
  signal.js `raftCentre` :45 is the alternative (it allocates).
- **State flags** (all reachable from ctx):
  - swimming and diving: `ctx.physics.swimming`. diving.js:240 keeps `swimming = true` underwater; spyglass.js:130 uses the same test.
  - driftboard: `peer('paddleboard').riding()` paddleboard.js:401. The board tethers 38-45 m from the nearest tile (paddleboard-core.js:9).
  - glide line: `ctx.content.hanging()` (content.js:161), and zipline.js:482 `riding()`. Lines run only between raft posts, so they are rarely far away.
  - island: `islandNow()?.onSand` islands.js:42/:453-459. Import it with the exact `?build=` stamp, or you get a second instance that returns null.
  - swim leash: a swimmer more than 10 m out is dragged along with the raft while sailing (sailing-world.js:280).
- Suggested rule: **away** = (swimming || riding || hanging || onSand || `out.d > 1.5`) && distance to the beacon > 8 m.
  Hide the marker when `!ctx.running`, `ctx.uiOpen()`, `ctx.vitals.hp <= 0` (fainted), or a seated/sleeping module is active.

## 3. Night factor and lights (perf rules)
- `env.night()` (content.js:138-140, :174) returns daynight `L.nightFactor` (daynight.js:782 `get night`). Light thresholds: `NIGHT_ON = .15` (power.js:9) and the
  pool turns on at `nf >= .15` (daynight.js:597).
- **No new PointLights** (LOG.md:45, :198, :905). The 4 pool lights are built once (daynight.js:406-430). Their count changes only with graphics,
  never with time, so nothing triggers a shader recompile. The scan matches group names `craft_lantern|craft_candle|craft_stringlights|craft_lamppost`
  (:444 signature, :459 scan). The light sits at the `lanternGlow` mesh's bounding-sphere centre (:470-474), with an optional `userData.pool {color, gain}` (:475-476).
  `g.userData.power = {lit}` (:481) is honoured for **any** scanned group: unlit means no pool light and emissive at `UNLIT = .05` (:275, :493, :651-656).
  Glow mesh names come from `LANTERN_PARTS` (:270).
- Two ways to join the pool:
  - (a) Name the group `craft_beacon` and add it to :444 and :459 with `[beacon]` tags.
  - (b) Reuse `craft_lantern` (the kiln-model.js:140 Glass Lantern trick, which needs no daynight edit).
  - I recommend (a), which is explicit and costs 2 lines. The module toggles `userData.power.lit` the way power.js:187 does.
- The far beam has to be an unlit additive mesh, not light. Use `fog:false` so it reads through the fog at 90-260 (game.js:478), and the camera
  far plane is 200. Any transparent DoubleSide material needs `forceSinglePass:true` (tests/perf-lint.test.mjs).
  Set `visible=false` by day or when unlit, so the beam costs no draw call. Share geometry and material across beacons, and cap the number of beams drawn (e.g. the 2 nearest).
- The 64-lantern cap (`MAX_LANTERNS`) is shared with lanterns, candles and lamp posts.

## 4. Power
- **There is no `powerAt`**. Content `env` has only `wind()` and `night()` (content.js:139). power.js exports the pure
  `servingBattery(st, decor, x, z)` :80 (a charged battery within Chebyshev `LIGHT_RANGE = 3`, or null). The power state is read with
  `peer.peek('power')` (content.js:127-128). Old host: power.js:138 `oldHost()`.
- Drain lives only in `tickPower` :83-110 (lights are `isLight(type)` :21, with `DRAIN` :14). A beacon outside that list would shine for free.
- Recommendation:
  - Add `env.powerAt(x, z)` in content.js:139. It returns `peer('power')?.servingAt?.(x, z) ?? null`, and power gets a 1-line `servingAt` that respects `oldHost`.
  - For drain, add `beacon` to `isLight` and `DRAIN` (`DRAIN_BEACON = 1`) with `[beacon]` tags.
  - Caveat: tickPower drains for every beacon at night, even one switched off. Either accept that (it is cosy, and a battery-powered beacon
    is simply "always on") or skip `off` beacons by passing a filter. Keep v1 simple: battery means always on at night.
- Fuel prior art: engine.js:13 `FUEL {leaf:20, wood:45, plastic:60}`, :130-158 `applyEngineAction` (hasOwnProperty lookup, takes 1 item,
  clamps), :248/:312 prompt "Add Palm Leaf (+20 s)". Biofuel is **not in dist** (docs only), so key fuel by kind and add `biofuel` later.

## 5. Module pattern and the files to touch
- content.js: import with `?build=v3-survival-ae77fa84ac2b` (tests/module-specifiers.test.mjs checks the stamp). Add the module to `FEATURES`
  (content.js:95) **before `createCookpot`**, which must stay last (tests/cookpot.test.mjs:326-327). Put it after `createPower`. `first('prompt')` takes
  the first truthy prompt, so a beacon prompt that fires only when aiming at a beacon is safe.
- items.js LIST: `item('beacon', 'Raft Beacon', 'decor', {placeable:true, iconTint, recipe:hand({...}), unlock, tip})`, like lamppost at :270.
  Add `BLOCK_RADII.beacon` at :349.
- Other touch points:
  - craft-book.js:28 (category) and :176 (desc/use)
  - an item-svg.js icon (:372)
  - held-items.js:32 `LANE_DECOR`, :78 size and :83 a held model factory
  - live.js:16-37 `PRELOAD` (tests/live-preload.test.mjs)
  - tests/syntax.test.mjs runs `node --check`
- Undecor: fuel stored per tile means implementing `beforeUndecor`/`undecorLoot`/`afterUndecor` (content.js:35-44), or adding `beacon` to `NO_UNDECOR` (:98).

## 6. Prompts, co-op, old host and saves
- Prompt path: module `prompt(aim)` HTML goes through `promptParts` (content.js:112-118) into the `#lrPrompt` provider at game.js:779. It is muted while a decor kind
  is held (:771/:779), which is fine because leaf is a material. E goes through `content.interact` (game.js:1435). For aim, copy power.js:142-162 `target()`.
- Actions: the client calls `ctx.action({kind:'beacon.fuel'|'beacon.toggle', x, z})`. The host's `action(a, actor, bag)` (game.js:1381) validates reach,
  the item and the cap, then bumps `r`. Guests receive `ext` in host state about 8 times a second, so `load(data, 'net')` must skip unchanged `r`/`s` (power.js:191-203).
- Co-op split: the **lit/fuel state is synced** through ext, and the **marker is local**. Each peer projects from its own `ctx.physics` and `ctx.camera`, so no new net fields are needed.
  A guest's home is the raft they are on (the host's). After a visit, `load(ext, 'restore')` (game.js:2064) brings back the guest's own raft.
- OLD_HOST: copy power.js:12/:138 and zipline.js:195/:205/:375. When `load(undefined, 'net')` arrives, set `hostHasBeacon = false`, and the prompt and interact show
  "Your friend’s raft doesn’t have beacons yet". An old host's `cleanWorld` drops `beacon` decor (game.js:220), so the marker never shows there.
- Save: `world.ext.beacon = {v:1, s, r, b:{"x,z":{on:0|1, f:seconds}}}`, with keys validated (power.js:17-18 `KEY_RE`), only tiles that have a beacon,
  `f` clamped to 0..CAP and rounded, idle entries omitted, and `serialize()` cached by `r`. An old save has no `ext.beacon` and gets defaults.
  Older builds drop unknown ext keys and decor, and reject unknown bag kinds (content-items.js:4).

## 7. Risks
- The marker could be confused with the orange `#signalMarker`. Use a distinct shape and colour (a teal house or lens glyph) plus "Home · 34 m".
- Per-frame allocation: game.js `project()` allocates. Use one cached Vector3 with `camera.matrixWorldInverse` and write the DOM only on change.
- An off-screen beacon behind you: `edgePoint` flips `inFront`. Already handled.
- Beam overdraw and sorting with water and the sky: use additive blending, `depthWrite:false`, a renderOrder like the ping (19), and keep it thin with low opacity.
- tickPower drains a switched-off beacon (section 4). The pool cap means a beacon may lose its PointLight to nearer lanterns, but that is fine: the beam carries the look.
- Hot-swap: remove only your own DOM and style nodes by reference (sailing-ui.js:27-29, :97-100).

## 8. Recommendation
Build a `beacon.js`, a `beacon-model.js` (pole, lantern, a lens group rotating at about 0.6 rad/s, a `lanternGlow` mesh with `userData.pool {color:'#ffe9b0', gain:.9}`,
and the group `craft_beacon`), and a pure `beacon-core.js` (clean/tick/apply).
- Lit = switched on && (`env.powerAt` battery || `f > 0`). Fuel is leaf (+60 s, CAP 600 s) and burns only at night while lit. Charge comes from a battery first.
- The beam shows at night only, scaled by `nf`. The home marker works whenever a beacon is lit, day or night. It points at the nearest lit beacon and hides within 8 m or on deck.
- Daynight: 2 tagged lines. Power: `servingAt`, plus optional `isLight`/`DRAIN` tags. content.js: `env.powerAt` and the FEATURES entry before cookpot.
