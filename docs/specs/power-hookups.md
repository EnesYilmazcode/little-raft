# Spec: Power Hookups (purifier, kiln, Simple Grill)

Source: docs/features/power-hookups-research.md, with line numbers re-checked against `claude/loop-features-202611210926` (path prefix `dist/`). Builds on docs/specs/power.md.
A **charged Battery within 2 tiles** (Chebyshev) of a Water Purifier, Seaside Kiln or Simple Grill station makes it work **twice as fast**. While it works powered, it drains the battery by 1 charge per second. An empty or distant battery just means normal speed. Nothing breaks, and no job is lost.
No new items, recipes, actions, save fields or slice version. One builder. Every edit is tagged `// [power-hookups]`.

## 1. Pure rules (power.js)
- Constants (`power.js:9-10`): add `HOOK_RANGE = 2`, `DRAIN_HOOK = 1` (charge per powered appliance-second), `BOOST = 2` and `HOOK_TYPES = Object.freeze(['purifier', 'kiln', 'grill'])`. Also add `MAX_CABLES = 64`.
- `nearest(st, decor, x, z, force, range = LIGHT_RANGE)` (`:65`, with the test at `:71` using `range`). `servingBattery` (`:80`) is unchanged.
- New export `poweringBattery(st, decor, x, z) = nearest(st, decor, x, z, null, HOOK_RANGE)`. It returns the battery key or null, breaks ties by key as before, and stays deterministic on every peer.
- `tickPower(st, decor, dt, wind, night, pending)` (`:83`): `pending` is an optional plain object `{batteryKey: float}`. After the per-second loop (`:96-103`), and only when `n > 0`, go through each key of `pending`. If the key is not in `bats`, delete it. Otherwise set `w = Math.floor(pending[k])`. If `w > 0`, subtract it from `pending[k]` (the remainder stays), then set `e = (st.b[k] || 0) - w`. If `e <= 0`, delete the key and push it to `emptied` once; otherwise store `e`. `b` stays an int, and `cleanPower` and the `r` bump logic are unchanged.
- Order within a call: gain, then lights per second, then the hookup drain as one lump. One 60 s call can differ from 60 one-second calls by less than one charge, which is fine. Document it in the comment.

## 2. Module API (createPower, `power.js:218`)
- `powerAt(x, z)`: returns `oldHost() ? 0 : poweringBattery(st, decor(), x, z) ? 1 : 0`. It is a pure read on every peer, from the synced `b` + decor, with no side effects. It is O(decor), and its callers run at 1 Hz, per frame per burning kiln or cooking grill, or at prompt rate (10 Hz), which is fine.
- `draw(x, z, sec)`: **host only**. Return early when `ctx.role === 'guest'` or `!(sec > 0)`. Then `k = poweringBattery(...)`, and when `k` is set, `pending[k] = (pending[k] || 0) + sec * DRAIN_HOOK`. `pending` is a module-level `{}` that is never serialized (a reload loses less than 1 charge). Reset it in `load()`.
- `update` (`:222-234`) passes `pending` as the 6th arg of `tickPower`. The `emptied` → notice path and the per-night `warned` set (`:130, :230-232`) are reused as-is.
- `afterRebuild()`: re-adds the cable (section 5).
- `debug` (`:267`): add `powered()` (keys of the `HOOK_TYPES` decor where `powerAt` is 1), `pending()` (a copy) and `cable()` (`{pairs, visible, attached: cable.parent === ctx.raft}`). `fastForward` passes `pending` too.

## 3. content.js bridge
- `:107` env: add `powerAt: (x, z) => { const m = peer('power'); return m ? num(call(m, 'powerAt', x, z), 0) : 0; }` and `draw: (x, z, s) => { const m = peer('power'); if (m) call(m, 'draw', x, z, s); }`. Use `call` so that a throwing power module is disabled, not the caller. `env` stays one object and is never spread.
- `:133` registry, beside `wind`/`night`: `powerAt: (x, z) => env.powerAt(x, z), powerDraw: (x, z, s) => env.draw(x, z, s)`.
- `:27`: extend the header comment to `link(env) … env.powerAt(x,z) / env.draw(x,z,sec) [power-hookups]`.
- With power disabled or missing, `powerAt` returns 0 everywhere, which is exactly today's behaviour.

## 4. Appliances
**Purifier** (game.js-owned `world.purifiers`, host 1 s clock):
- `watering.js:96` `tick(world, dt, skip, fast)`: `fast` is an optional Set of purifier keys. At `:111`: `e.t = Math.min(PURIFY_SECONDS, e.t + s * (fast && typeof fast.has === 'function' && fast.has(k) ? 2 : 1))`. It stays an int in 0..15, so `cleanPurifierEntry` (`:39-46`) is unchanged.
- game.js: add a reused `const fastPurifiers = new Set()` and a helper `poweredPurifiers()`. It clears the set and returns it at once when `!content?.powerAt`. Otherwise, for each key `k` of `world.purifiers` with `!e.ready`, it parses `x,z` with `indexOf(',')` and adds `k` when `content.powerAt(x, z)`, also calling `content.powerDraw(x, z, 1)`. Build the set **before** the tick and only on the host, from the host's own state.
- `game.js:1727`: `tickWatering(world, 1, content?.pecked?.() ?? null, poweredPurifiers())`.
- `game.js:1026` prompt (every peer): `const pw = content?.powerAt?.(d.x, d.z) ? 1 : 0, left = PURIFY_SECONDS - e.t, t = pw ? \`Purifying… ${Math.ceil(left / 2)}s · powered\` : \`Purifying… ${left}s\`;`. So the half-time countdown reads 8s → 7s … → 1s.

**Kiln** (content slice, host per frame):
- `kiln-core.js:93` `step(e, dt, rate = 1)`: the clamp to `MAX_DT` stays as it is, and then `e.t += d * (rate > 0 && rate <= BOOST_MAX ? rate : 1)`, with `BOOST_MAX = 4` local. Fuel stays per batch (`:95`), so wood per ingot is unchanged.
- `kiln-core.js:106` `stepAll(st, dt, onDone, rateOf)`: `const done = step(e, dt, rateOf && e.h === 1 ? rateOf(key) : 1);`. On the batch's first frame (`h` 0→1) it runs at 1x, which is negligible.
- kiln.js: add `let env = null, frameDt = 0;` and `link(e) { env = e && typeof e === 'object' ? e : null; }` in the returned object (`:192`). Add `rateOf(key)`, which parses `x,z` the same way as the prune loop (`:105`), returns `BOOST` (2) and calls `env.draw(x, z, frameDt)` when `env?.powerAt?.(x, z)`, else returns 1.
- `kiln.js:101`: `frameDt = dt > 0 ? Math.min(dt, KILN.MAX_DT) : 0; if (stepAll(st, dt, onDone, rateOf)) st.r++;`. `debug.run` (`:184`) stays at 1x with no drain.
- Prompt (`:116-133`): `const pw = env?.powerAt?.(d.x, d.z) ? 1 : 0`, add `pw === pPw` to the cache test with `pPw` stored beside `pPct` (`:14`), and finish with `if (pw) parts.push('powered')`. That gives `… · fuel 3 · powered`.

**Simple Grill station** (progression, host per frame):
- `game.js:2400` attachProgression ctx: add `powerAt:(x, z) => content?.powerAt(x, z) ?? 0, powerDraw:(x, z, s) => content?.powerDraw(x, z, s)`.
- `progression-hooks.js:103`: after `new StationModel(...)`, set the transient `s.px = d.x; s.pz = d.z` (these are not in `snapshot()`). For a station that already exists, the key fixes x,z.
- `progression-hooks.js:290`: `const m = st.stationId === 'grill' && st.cooking && ctx.powerAt?.(st.px, st.pz) ? 2 : 1; if (m > 1) ctx.powerDraw?.(st.px, st.pz, dt); st.tick(dt * m);`. `StationModel.tick` (`smelter.js:113`) spreads fuel over progress, so fuel per item is unchanged. Only `grill` gets the boost; smelter, recycler and the rest stay 1x.
- Prompt `progression-hooks.js:379`: the label gets `+ (d.type === 'grill' && ctx.powerAt?.(d.x, d.z) ? ' · powered' : '')`.

## 5. Cable visual (power.js, every peer)
- One `T.LineSegments` named `power_cable`, built lazily when `T` exists. It uses a preallocated `BufferGeometry` with a `Float32Array(MAX_CABLES * 6)` position attribute and a `LineBasicMaterial({color:'#2b2b2b'})`. Set `geometry.userData.shared = material.userData.shared = true` so `disposeGeometry` (`game.js:392`) skips them, plus `castShadow = false`, `raycast = () => {}` (it must never steal aim), `frustumCulled = false` and `visible = false`.
- **Pairs**: for each decor of `HOOK_TYPES` where `!old && poweringBattery(...)` is set, take (battery tile → appliance tile), at most `MAX_CABLES`, in decor order. The signature is a string `"bk>ak;"…`. Recompute it only inside paint's existing change gate (`:181-182`: rescan, `st.r`, decor length, old). Rebuild the positions **only when the signature changes**. Raft-local endpoints are `(x*2, .47, z*2)` (deck .22 + .25). Then call `setDrawRange(0, pairs*2)`, set `needsUpdate`, `computeBoundingSphere()` and `visible = pairs > 0`. Never add/remove it to show or hide.
- Attachment: on the first paint, `ctx.raft.add(cable)`. `rebuildRaft()` (`game.js:629-648`) removes every child, then calls `content.afterRebuild()` (`:648`), where power re-adds it when `cable.parent !== ctx.raft`. paint does the same check once as a fallback (for a raft identity change). The cable is the last child, so the power scan (`:167`) and kiln scan (`kiln.js:88`) each rescan once per rebuild only.
- paint currently returns early when there are no power groups (`:179`). Move the cable step before that return, so a removed last battery hides the cable (`pairs = 0`).
- `dispose()`: remove the cable from its parent and dispose its geometry and material (the module owns them).

## 6. Drain numbers and balance
- `DRAIN_HOOK = 1`/s per powered appliance that is actually working: a purifier that is `!ready`, a kiln with `h === 1`, or a grill that is `cooking`. An idle appliance draws nothing.
- One purifier batch goes from 15 s to 8 s and costs 8 charge. Kiln: metal 18 → 9 s (9 charge), glass 12 → 6 s, brick 10 → 5 s. Grill: fish 15 → 7.5 s, brick and shark 20 → 10 s.
- A full battery (1800) runs one appliance for 30 min. A calm turbine (+1/s) breaks even with one appliance, and a breezy one (+3/s) with three. At night, hookups and lights share the battery. When the battery empties, the job just falls back to 1x, and the existing "A battery ran out of charge" notice fires at most once per night per key.

## 7. Co-op, old hosts, save compatibility
- Authority: purifier, kiln and station ticks and all `draw` calls run on the host only. Guests call only `powerAt` (prompts and cable), from the synced `ext.power` + decor. Ties are broken by key, so both peers draw the same cables.
- **New guest, old host**: `hostHasPower = false`, so `powerAt` returns 0. Prompts show no "powered", the cable stays hidden and the timings match the old host's 1x.
- **Old guest, new host**: the host finishes sooner. The old guest's purifier countdown overstates the time (harmless, since it jumps to ready), kiln % comes from the synced `t` and grill state from `prog:sync`. The old guest has no cable. Mixed-version co-op stays unsupported, as in power.md.
- Saves: no new fields. `pending` and the station `px/pz` are transient. The power slice stays `v:1`, purifier `t` stays an int in 0..15, kiln `t` stays a float as today, and station snapshots are unchanged. Old saves load unchanged, and an old build reads new saves unchanged.

## 8. Files (all edits tagged `// [power-hookups]`)
- `dist/power.js`: constants `:9-10`, `nearest` `:65/:71`, new `poweringBattery` after `:80`, `tickPower` `:83` + after `:103`, `pending` beside `warned` `:130`, cable in `paint` `:178-189`, `load` reset `:192-202`, API `powerAt`/`draw`/`afterRebuild` in the returned object `:218`, `update` `:233`, `debug` `:267`, `dispose` `:294`.
- `dist/content.js`: `:27` (comment), `:107` (env), `:133` (registry).
- `dist/watering.js`: `:96` signature, `:111` step.
- `dist/kiln-core.js`: `:93` `step` rate, `:106` `stepAll` `rateOf`.
- `dist/kiln.js`: `:14` `pPw`, `link` + `rateOf` near `:23`, `:101`, prompt `:116-133`, return `:192`.
- `dist/progression-hooks.js`: `:103` (px/pz), `:290` (boost + draw), `:379` (prompt suffix).
- `dist/game.js`: `fastPurifiers` + `poweredPurifiers()` near `:1727`, `:1727` tick, `:1026` prompt, `:2400` ctx.

## 9. Tests (node:test, `RAFT_DIST`, vendored THREE)
- `tests/power.test.mjs` (extend):
  1. `poweringBattery`: distance 2 is powered and 3 is not (while `servingBattery` still reaches 3). An empty battery is skipped, and ties go to the smaller key.
  2. `tickPower` with `pending {k: 2.5}`: after 1 s, `e` drops by 2 and the pending value is .5. A pending key with no battery is deleted. A drain that empties a battery lists it in `emptied` once. `r` bumps on drain. Two identical runs are `deepEqual`.
  3. Module: `powerAt` is 1 or 0 by range and charge. On a guest, `draw` is a no-op. `load(undefined, 'net')` makes `powerAt` 0. `draw` + one 1 s `update` on the host lowers `b`. `serialize()` has no `pending`.
  4. Cable (stub ctx with `ctx.raft = new T.Group()`): with no appliance, `debug.cable().visible === false`. Add a `kiln` decor 2 tiles from a charged battery, and after an update `pairs === 1`, it is visible and attached. A charge-only `st.r` bump does not change the geometry `version`. Emptying the battery gives `visible` false. `raft.remove(cable)` + `afterRebuild()` re-attaches it. Geometry and material have `userData.shared`.
- `tests/watering.test.mjs`: with a `fast` Set, a loaded purifier is ready after 8 one-second ticks (t goes 2…14 → 15 clamped), without it after 15. A key not in the set ticks 1x. `t` is always an int.
- `tests/kiln.test.mjs`: `step(e, .5, 2)` adds 1.0. `step(e, 5, 2)` clamps first and adds 2. A bad rate counts as 1. `stepAll(st, 1, null, () => 2)` finishes clay in 6 one-second calls (the first call lights the wood at 1x, and 1 + 4×2 = 9 < 10), uses the same wood as at 1x, and `rateOf` is only called while `h === 1`.
- QA: `npm test`, and shoot.py with `errors: []`. Close-up: battery + kiln + purifier + grill on adjacent tiles at night, so 3 cables are visible, and the prompts show "· powered".

## Future work (out of scope)
- Driftwood grill (fishing-cooking): both peers simulate it, it has a separate save, and burn time is coupled to the same `t`. It would need an `update(dt, rate)` that scales only the raw phase.
- Receiver: its "range" is the cache spawn distance, so a bigger value is a nerf. The buff (a +1 antenna tier or a shorter cooldown) needs a design call.
- A "plug in: battery within 2 tiles" hint when a battery is in light range but not hookup range, plus a pulsing cable colour.
