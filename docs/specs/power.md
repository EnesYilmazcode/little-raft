# Spec: Wind Turbine, Battery, String Lights and Lamp Post

Source: docs/features/power-research.md, with its line numbers re-checked against the current tree. Cozy rules: nothing breaks, nothing is lost, and an empty battery just means the lights rest until the wind returns.
Put a Wind Turbine next to a Battery, and the battery charges from the daynight wind. String Lights and Lamp Posts within 3 tiles of a charged battery glow at night and drain it.
Logic goes in the new content module `dist/power.js` (pure helpers plus `createPower(ctx)`). Models go in the new `dist/power-model.js`, which gets THREE as `T` and imports nothing (copy the tiny `bake` from `bees-model.js:6`).
New modules are imported with `?build=v3-survival-ae77fa84ac2b`. game.js gets **no edits**. One builder can do all of it.

## 1. Items, recipes, gating (dist/items.js, after the candle row `:183-185`)
| id | name | recipe | unlock | radius |
|---|---|---|---|---|
| `turbine` | Wind Turbine | `hand({wood:4, metalingot:2, bolt:2, rope:2})` | `research('metalingot','bolt')` | .2 |
| `battery` | Battery | `hand({copperingot:2, metalingot:1, plastic:2})` | `research('copperingot')` | .3 |
| `stringlights` | String Lights | `hand({glass:2, copperingot:1, rope:2})` | `research('glass','copperingot')` | .1 |
| `lamppost` | Lamp Post | `hand({wood:3, glass:1, copperingot:1, nail:2})` | `research('glass','copperingot')` | .12 |
- All are `'decor'` with `placeable:true` and an `iconTint`. Tips: turbine "Spins in the breeze and charges a battery next to it."; battery "Stores wind power. Lights within 3 tiles share it at night."; stringlights "A little post with a wire of warm bulbs. Needs a charged battery nearby."; lamppost "A tall lamp that lights the deck at night. Needs a charged battery nearby."
- Add the radii to `BLOCK_RADII` (`items.js:221`). Add `PROGRESSION_PLAN` row `{minute:115, goal:'Light the raft with wind power', ids:['turbine','battery','stringlights']}` between `:277` and `:278`.
- Every input is already reachable through research, so the reachability test (`progression.test.mjs:199`) needs no edit. No `craftLocked` either: progression enforces `research` unlocks on host craft.
- craft-book.js: add the 4 ids to `survival` (`:23`) and add `ITEM_TEXT` rows after `:83`. item-svg.js: add 4 inline icons after `:215` (a three-blade rotor on a mast, a box with a bolt mark, a looped wire with bulbs, a lamp on a post). All tagged `// [power]`.

## 2. Adjacency (pure, Chebyshev distance on tile ints, derived from `world.decor` and never stored)
- `turbinesNear(decor, x, z)`: the count of `turbine` decor with `max(|dx|,|dz|) <= 1`, capped at `TURBINE_CAP = 2`. One decor per tile (`build-rules.js:32`), so a turbine sits *beside* its battery, never on it. One turbine may feed two batteries.
- `servingBattery(st, decor, x, z)`: among `battery` decor with `max(|dx|,|dz|) <= LIGHT_RANGE` (3) and `e > 0`, return the one with the smallest distance, ties broken by the smallest `tileKey` string. Return null if there is none.
- **Lit rule (every peer, locally):** a `stringlights`/`lamppost` at (x,z) is lit iff `servingBattery(...) !== null`. The rule only reads `decor` (from the snapshot) and `b` (from `ext.power`), so host and guest agree with no extra traffic.

## 3. State: `world.ext.power = {v:1, s, r, b:{"x,z": e}}`
- `s` is a session id and `r` a revision int (same as bees). `b` holds **charge only**: an int `e` in `1..CAP`, one key per battery tile (`/^-?\d+,-?\d+$/`). A missing key means `e = 0`, and `e = 0` deletes the key.
- `cleanPower(v, decor)` prunes keys with no `battery` decor and rounds and clamps `e`. Junk, undefined or an array gives the defaults. With at most 400 entries it stays far below `EXT_MAX`.
- **Numbers:** `CAP = 1800`, `GAIN = 4`, `DRAIN_STRING = 1`, `DRAIN_LAMP = 2`, `NIGHT_ON = 0.15`, `MAX_TICK = 60`, `REACH = 2.6`.
- **Tick (host only, one whole second at a time, `wind`/`night` sampled once per call):** for each battery, `e += round(min(turbinesNear, 2) * wind * GAIN)`. Then, if `night >= NIGHT_ON`, each light subtracts its drain from its `servingBattery`, chosen again for every light in decor order so a battery that empties hands over to the next one. Clamp to `0..CAP` and bump `r` only when some `e` changed.
- Per turbine per second this gives calm `W_WIND .15` → 1, rain `.5` → 2, breezy `.7` → 3, and 2 turbines in breezy wind → 6. A night (`nf >= .15`) lasts about 420 s of the 1200 s day (`daynight.js:6,38`).
  One breezy day (about 780 s × 3) fills a battery. A full battery plus one turbine in calm wind lights 4 String Lights all night (net 3/s × 420 = 1260 < 1800). With 6 lights or more it runs dry before dawn, which is fine.
- `tickPower(st, decor, dt, wind, night)` floors `dt` and clamps it to `0..MAX_TICK`, then mutates `st.b` and returns `{emptied:[keys]}`. `batteryInfo(st, decor, x, z)` returns `{e, pct, turbines, lights}` or null.

## 4. Content module `createPower(ctx)` (name `'power'`)
- **Env link:** modules cannot see daynight. content.js passes `{wind(), night()}` through a new optional `link(env)` hook. Read them as `env?.wind() ?? 0.15` and `env?.night() ?? 0`. With `?daynight=off` the getters are missing, so the fallbacks apply: batteries just fill and lights never reach night, and the prompt says nothing about night.
- `load`/`serialize`, the net early-out, `hostHasPower = data !== undefined`, and `OLD_HOST = 'Your friend’s raft doesn’t have power yet'` are copied from `bees.js:102-185`.
- `update(dt)`: every peer runs the visuals (section 6). The host tick runs only when `ctx.running && ctx.role !== 'guest'` (`bees.js:193-199`). It emits `'A battery ran out of charge'` once per emptied key to `'all'`, at most once per night per key.
- `target(aim)` is copied from `bees.js:116-136`. It accepts types `battery`, `turbine`, `stringlights` and `lamppost` and returns `{x, z, key, type}`.
- `prompt(aim)` returns static strings. The E prompt goes through `aimHtml` and the `game-aim` providers (`game.js:568,1795`, `prompts.js:50`):
  - battery: `<kbd>E</kbd>Check battery · 62%`. On an old host it shows `OLD_HOST`.
  - turbine (status only): `Wind Turbine · spinning (breezy)` or `Wind Turbine · place a battery next to it`.
  - light (status only): `String Lights · powered` or `String Lights · needs a charged battery within 3 tiles`, and the same with `Lamp Post`.
  - Wind word: `w < .3` 'calm', `w < .6` 'gentle wind', else 'breezy'.
- `interact(aim)` is local and sends no action. On a battery it calls `ctx.notice('Battery 62% · 2 turbines · breezy · lights 3 at night', 2400)` and returns true. On an old host it shows the `OLD_HOST` notice. Other targets return false. v1 has no `power.*` actions.
- `decorModel(type)` returns the 4 factories, else null. That reaches both `game.js:504` and the ghost at `:395`.
- `debug`: `state()`, `lit()` (keys of lit lights), `place(type,x,z)` (host, as `bees.js:241`), `setCharge(x,z,e)`, `fastForward(sec, wind=.7, night=1)`.

## 5. daynight.js hooks (all tagged `// [power]`)
1. `:658` add `get night() { return L.nightFactor; }` next to `get wind()`. `createDayNightOff` (`:264`) stays unchanged.
2. `:405` signature: also count `stringlights` and `lamppost`. `:414` scan: also accept `craft_stringlights` and `craft_lamppost`.
3. `:397-400` preallocate `lanternPower = new Array(MAX_LANTERNS).fill(null)`, `lanternOn = new Uint8Array(MAX_LANTERNS).fill(1)`, `lanternNoPool = new Uint8Array(MAX_LANTERNS)` and `partOwner = new Uint8Array(MAX_PARTS)`.
   In `scanLanterns`, set `partOwner[partCount] = lanternCount` at `:421`. Before `lanternGroups[lanternCount++] = g` (`:432`), set `lanternPower[i] = g.userData.power ?? null`, `lanternOn[i] = lanternPower[i] ? (lanternPower[i].lit ? 1 : 0) : 1` and `lanternNoPool[i] = g.userData.noPool ? 1 : 0`.
4. Before the emissive write at `:550`, loop `i < lanternCount`. When `lanternPower[i]` exists and its `lit` bit differs from `lanternOn[i]`, update `lanternOn[i]`, set `lastNf = -1` and `rankClock = 1e9`. This fixes the emissive-skip bug and the 0.5 s rank latency.
5. `:550` write: `partMat[i].emissiveIntensity = lanternOn[partOwner[i]] ? partBase[i] * (1 + (partMult[i] - 1) * nf) : partBase[i] * UNLIT`, with `UNLIT = 0.15`. Lanterns and candles have no `power`, so they are always on and keep their behaviour.
6. `rankLanterns` (`:442`): `if (!lanternOn[i] || lanternNoPool[i]) continue;` before the distance. String Lights set `noPool`, so they stay emissive-only and never take a PointLight. A powered Lamp Post competes for the existing 1/2/4 pool lights by distance. **Zero new lights.**

## 6. Models (dist/power-model.js) and visuals
- Each factory returns a Group named `craft_<type>`, origin at the floor top, built from **fresh materials per call**. daynight writes `emissiveIntensity` per material, so a shared material would light every copy.
- `createTurbine(T)`, about 2.4 m tall: a tapered grey mast (cylinder .05→.08, #b9c2c9) and a nacelle box (.12 × .12 × .3, #e9eef1), baked into one vertex-colour mesh `turbineBody` (castShadow).
  `blades`, one mesh with its pivot at the hub (y 2.3, z .17): 3 flat-shaded tapered boxes (.5 × .07 × .015, #f4f1ea) at 120° plus a hub cone (#e07a5f), with `castShadow=false`. Set `g.userData.blades`. Spin: `blades.rotation.z += wind * SPIN * dt` with `SPIN = 6`, every peer, with no net traffic.
- `createBattery(T)`, about .45 × .4 × .3: a box body (#4a5a6a) with a lid strip and two terminals (red and black studs), baked to `batteryBody` (castShadow). On the front sit 4 pip boxes `pip0..pip3` (.06 × .04 × .01), each with its own material (on: #7dff9a emissive .9; off: #2e3b33 emissive 0).
  `paintBattery(g, n)` lights pips `< n`, with `n = e ? ceil(e / CAP * 4) : 0`, and returns early on `g.userData.sig === n`. Pip names are not in `LANTERN_PARTS`, so daynight ignores them.
- `createStringLights(T)`: a short post (1.1 m, #906f48) with a top hook, plus a draped wire. The wire is a catenary of 8 points from the hook (0, 1.05, 0) out to an anchor peg (.85, .55, 0) and through to a small stake, built as one thin `TubeGeometry` (#2b2b2b).
  Post and wire bake to one mesh `lightsBody` with `castShadow=false`, except the post. 6 bulbs along the curve (small spheres r .035, colours #ffd27a/#ffb35a/#fff1c4 by vertex colour) bake into **one** mesh named `candle` (multiplier 2.0, emissive #ffc070, base .45, `castShadow=false`). Set `g.userData.power = {lit:0}` and `g.userData.noPool = true`.
- `createLampPost(T)`: a 2.1 m post (#5d6b78) with a small arm, baked into `lampBody` (castShadow). The head is a glass box `lanternGlass` (transparent .5, emissive #ffe2a8 .3, `userData.glass = true`), plus a sphere `lanternGlow` translated to y 1.95 (emissive #ffd27a .5, transparent .6) with `userData.pool = {color:'#fff1d6', gain:.8}`. Set `g.userData.power = {lit:0}`. All named parts are **direct children**.
- Each model creates its `power` object at construction and power.js only flips `.lit`. Because the object already exists, daynight caches it at scan time even when it scans before power.js in the same frame.
- **Light scan in power.js:** keep one list `{g, x, z, type}` per `craft_*` power group, rebuilt only when `ctx.raft.children` length, first child or raft identity changes (`bees.js:138-149`). Recompute `lit` for every light (and the battery pips) only when the raft is rescanned, `st.r` changes or the decor length changes. On an old host, everything is unlit, the pips show 0, and the turbines still spin.

## 7. content.js hooks
- `:29-31`: `import { createPower } from './power.js?build=…'; // [power]` and append `createPower` to `FEATURES` (after `createBees`).
- After `:49`: `const env = { wind: () => num(dn()?.wind, .15), night: () => num(dn()?.night, 0) }; for (const m of mods) call(m, 'link', env);`, where `dn = () => mods.find(m => m.name === 'daynight' && !m.dead)` and `num(v, d)` returns `v` when `Number.isFinite(v)`, else `d`. Do not spread `ctx` or the module, because the getters are live. Also expose `wind()` and `night()` on the returned object beside `rain()` (`:61`).

## 8. Co-op, OLD_HOST and save compatibility
- The host is authoritative for `b`. Guests receive `ext.power` in `hostState` (about 8 Hz) plus decor through the snapshot, then derive lit, pips and spin locally. Weather is deterministic from the synced `{clock, seed}`, so blade speed matches on every peer.
- A new guest on an old host gets `ext.power === undefined`, so every light stays unlit, pips show 0 and prompts show `OLD_HOST`. An old guest drops the unknown decor and the unknown slice. Mixed-version co-op is unsupported, as for bees (say so in the PR).
- An old save has no `ext.power`, and `cleanPower(undefined)` gives defaults, so batteries start empty. The kinds and decor are additive. An old build drops these four decor and their kinds (accepted). Decor cannot be removed, and a missing battery is pruned on load.

## 9. Perf limits
- Zero new PointLights or shadow-casting lights. Only `turbineBody`, `batteryBody`, the post of `lightsBody` and `lampBody` cast shadows. Blades, bulbs, wire and glass do not.
- Draw calls: turbine 2, battery 5, String Lights 2, Lamp Post 3. No per-bulb meshes.
- `update` allocates nothing: the lists are preallocated, the host tick runs at 1 Hz, and lit is recomputed only on change.
- The 64-lantern cap (`daynight.js:244`) is shared with lanterns and candles in `raft.children` order. A light past the cap simply never brightens. Document this in the item tip comment and the PR.

## 10. Files and tests
- New files: `dist/power.js`, `dist/power-model.js`, `tests/power.test.mjs`.
- Edited files, tagged `[power]`: `items.js` (4 rows after `:185`, radii `:221`, plan row `:277`), `content.js` (`:29-31`, `:49`, `:61`), `daynight.js` (`:397-400`, `:405`, `:414`, `:421`, `:432`, `:442`, `:550`, `:658`), `craft-book.js` (`:23`, `:83`), `item-svg.js` (`:215`).
- `tests/power.test.mjs` (node:test, `RAFT_DIST`, vendored THREE, stub ctx as in `bees.test.mjs:220`):
  1. `cleanPower`: junk gives defaults. Bad keys, floats, negatives and `e > CAP` are dropped or clamped. A key with no battery is pruned.
  2. Adjacency: a turbine at Chebyshev 1 counts and one at 2 does not; 3 turbines cap at 2. `servingBattery` respects range 3, skips `e = 0` and breaks ties by key.
  3. Charge: 1 turbine at wind .7 gives `e = 3` after 1 s, and 60 s gives 180. With no turbine, nothing changes. Calm wind gives 1/s. `e` stops at `CAP`, and `r` does not bump once full.
  4. Drain: with `night = 1`, 2 String Lights plus 1 Lamp Post drain 4/s and no turbine. During the day (`night < .15`) there is no drain. An emptied battery hands its lights to the next battery in range, and `emptied` lists the key once.
  5. `dt` .9 counts as 0 and `1e6` clamps to 60. Two identical worlds end up `deepEqual` (determinism).
  6. Module: `load(same,'net')` twice is a no-op, and `load(undefined,'net')` gives the `OLD_HOST` prompt. The battery prompt starts with `<kbd>E</kbd>Check battery`, and `promptFromHtml` returns `{key:'E'}`. `interact` on a battery calls `ctx.notice` and never `ctx.action`.
  7. Models: groups are named `craft_*`. The lamp post has direct children `lanternGlow` and `lanternGlass` and a `pool` gain of .8. String Lights have exactly one `candle` mesh and `noPool`. Two `createStringLights` share no material. `paintBattery(g, 2)` lights 2 pips. Bounding boxes fit within .9 m in width.
  8. daynight (night pinned at phase .82): an unlit String Lights `candle` reads `base*UNLIT`. Flip `lit = 1`, and after one frame it reads `base*2.0`, which proves the `lastNf` reset. An unlit Lamp Post never takes a pool, a lit one does (`debug.state().poolLit === 1`), and lit String Lights alone give `poolLit === 0`. The candle test still passes.
  9. Name sync: every `craft_*` name from power-model is accepted by the daynight scan (lanterns count goes up).
- Run `npm test` and shoot.py, and make sure the `errors` list stays empty.
