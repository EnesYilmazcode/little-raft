# Electric hookups research: powered purifier, grill, kiln, receiver

Research only, no code. Line numbers are for `claude/loop-features-202611210926`. Path prefix `dist/` is left out below.

## 1. Power chain today (power.js)

| What | Where |
|---|---|
| Constants `CAP 1800, GAIN 4, DRAIN_STRING 1, DRAIN_LAMP 2, NIGHT_ON .15, MAX_TICK 60`, `LIGHT_RANGE 3` | `power.js:9-10` |
| Slice `world.ext.power = {v:1, s:session, r:rev, b:{"x,z": e}}`. `e` is an int 1..CAP, and empty batteries are deleted | `:4, :38-55` |
| `nearest(st, decor, x, z, force)`: the nearest charged battery by Chebyshev distance `<= LIGHT_RANGE`, ties broken by the smaller key. Range is **hardcoded** | `:65-77` |
| `servingBattery()` = `nearest(..., null)`. The lit rule is "a light is lit iff this is not null" | `:80` |
| `tickPower(st, decor, dt, wind, night)`: whole seconds, host only. Gain goes first, then each light drains its serving battery each second; it bumps `st.r` on any change | `:83-109` |
| Module host guard `if (!ctx.running \|\| ctx.role === 'guest') return`, with a 1 s clock | `:223-234` |
| Lit/pips are worked out **locally on every peer** from the synced `b` + decor (`paint`, gated on `st.r`/decor length) | `:178-189` |
| Old host: `load(undefined,'net')` sets `hostHasPower=false`, so `oldHost()` hides everything | `:191-198, :138` |
| `link(env)` receives `{wind, night}`. There are no `power.*` actions | `:220`, `content.js:106-108` |

Lights find batteries by scanning `decor` each call (O(decor)), which is fine at these counts.

## 2. Appliance timing and authority

| Appliance | Tick | Who simulates | State | Multiplier hook |
|---|---|---|---|---|
| **Purifier** (game.js-owned decor `purifier`) | `watering.js:96-117`: `e.t += s` (int s), done at `PURIFY_SECONDS=15` (`:5`) | host only, `game.js:1727` (1 s clock, `tickWatering(world,1,pecked)`) | `world.purifiers["x,z"]={t:int 0..15, ready:0/1}`, sent raw in hostState `game.js:1679` | add an optional 4th arg `fast` (Set of keys): powered entries get `e.t += 2*s`. That stays integer and deterministic, and `cleanPurifierEntry` (`:39-46`) already clamps |
| Purifier prompt | `game.js:1025` `Purifying… ${PURIFY_SECONDS - e.t}s` | every peer | | when powered, show `ceil((15-t)/2)` and add "· powered" |
| Purifier visual | `game.js:1050` `paintPurifier(g, entry, elapsed)` (`purifier-model.js:87`) | every peer | | the plug/cable goes here or in the power module (sec. 5) |
| **Kiln** (content, decor `kiln`) | `kiln-core.js:290-300` `step(e,dt)`: `e.t += min(dt, MAX_DT=1)`, batch at `SMELT[r].secs` (18/12/10). Fuel is spent **per batch** (`:292`), not per second | host only, `kiln.js:99-101` `stepAll(st, dt, onDone)` per frame | `world.ext.kiln={v:1,r,k:{"x,z":{r,q,t,h,f,o,n}}}` | `stepAll(st, dt, onDone, rateOf)`, where `step(e, dt*rate(key))`. Wood per batch stays the same, and per-frame dt*2 stays well under MAX_DT |
| Kiln prompt | `kiln.js:116-133` (cached on key/r/sel/pct) | every peer | | add `powered` to the cache key and suffix |
| **Simple Grill station** (decor `grill`, progression) | `smelter.js:113-135` `StationModel.tick(dt)`: recipe `time` 15-20 s (`items.js:133,196,208`), fuel spread over the time | host only, `progression-hooks.js:288-292`; guest sees `prog:sync` snapshots every 0.3 s | localStorage `littleRaft.progression.v1` `stations` | `st.tick(dt*m)` (fuel per item unchanged). It needs `powerAt` passed into the `attachProgression` ctx at `game.js:2400` |
| **Driftwood grill** (fishing-cooking, NOT decor) | `cooking.js:98-121` `GrillState.update(dt)`: `f.t += use`, where `use` is also fuel. The cooked-to-burnt timer `burnAfter 20` runs off the same `t` | **both peers** simulate (`fishing-cooking.js:396-398`); the host re-sends snapshots every 0.5 s (`:430-431`) | localStorage `little-raft-fc-v1`, grills `{id,x,z,fuel,idle,slots}` | `update(dt, rate)`: scale only the raw phase (`f.t = min(ct, f.t + use*rate)`) so power never chars fish faster. A guest on an old host would drift and then snap back |
| **Receiver** (game.js decor `receiver`) | `signal.js:428-464` `signalTick`, host only (`game.js:1718`); `TIERS[antennas]` `:377-382` | host tick; the readout `game.js:819` runs on every peer from `countAntennas(decor)` | `world.signal={cooldown,cache}` | "Range" is the **spawn distance** of the cache (`:442`). A bigger range brings it in *later*, which is a nerf. A real buff is "+1 virtual antenna tier", but that changes loot (`game.js:1187`), cooldown (`:487`) and wobble, and it touches 3 call sites |

## 3. How modules talk

- `content.js:91-108`: `createContent` builds `peer(name)` / `peer.peek(name)` and one `env` object, then calls each module's `link(env)` once. The `env` getters are live, so `env` is the natural place for `powerAt`.
- game.js reaches content through thin bridges like `rain()` / `pecked()` (`content.js:129-130`). Add the twin `powerAt: (x,z) => …` there for the purifier (game.js) and to pass into the prog / fc host adapters (`game.js:533-537`, `:2400`).
- game.js owns `world.purifiers`, `world.signal` and `world.decor`. Content owns `world.ext.*` slices (serialized via `content.serialize()` at `game.js:1446, 1679`, loaded at `:482, 1947, 2035`). The power module can **read** `ctx.world.purifiers` but must never write it.
- FEATURES order (`content.js:69`): kiln updates before power each frame. That is harmless if drain is queued and applied on power's next whole second.

## 4. Recommended design (minimal, robust)

1. **power.js**: generalise `nearest(st, decor, x, z, force, range=LIGHT_RANGE)`. Export pure `poweringBattery(st, decor, x, z) = nearest(..., HOOK_RANGE=2)`, and add `HOOK_RANGE = 2, DRAIN_HOOK = 1` to the constants at `:9`.
2. **Module API** (added to the returned object near `:218`):
   - `powerAt(x, z)` returns 1 when a charged battery is within 2 tiles, else 0. It returns 0 when `oldHost()`, is pure and works on every peer from synced `b`. Cache it per `st.r` + decor length (a Map) if profiling asks.
   - `draw(x, z, sec)` is **host only**. It finds the serving battery and adds to `pending[k] += sec*DRAIN_HOOK` (a float). `tickPower` takes an optional `pending` and subtracts `Math.floor` of it each second, keeping the remainder. `b` stays an int and `cleanPower` stays unchanged.
3. **content.js**: `env.powerAt = (x,z) => peer('power')?.powerAt?.(x,z) ?? 0` and `env.draw = …`. Do not spread `env`. Add the registry bridges `powerAt(x,z)` / `powerDraw(x,z,s)`.
4. **Callers**: the multiplier is `m = powered ? 2 : 1` (call it 1.5 for kiln/grill if 2x feels too strong). On the host, when an appliance actually advances while powered, call `draw(x,z,dt)`. Each appliance's "working" test is: a purifier entry with `!ready`, a kiln entry with `h===1`, or a station with `cooking`.
5. **No new actions, no new save fields, power slice stays `v:1`.** `pending` is not saved (a reload loses under 1 charge). Old saves load unchanged; purifier `t` stays an int in 0..15.

## 5. Visuals and perf

- **Prompt text**: add "· powered" (or "plug in: battery within 2 tiles" when a battery exists but is out of range) to the purifier (`game.js:1022-1026`), kiln (`kiln.js:116`), station and fc prompts. This is the cheapest cue and works on every peer.
- **Cable**: one `THREE.LineSegments` owned by the power module (a preallocated BufferGeometry, about 64 pairs, from battery to appliance at deck + 0.25), giving 1 draw call. Rebuild the positions only when the *pair signature* changes (a string of the powered appliance and battery keys), not on every `st.r` bump: `st.r` bumps every second while anything drains. Emissive glow should come from a pulsing material colour, not a light.
- Cable risks: `rebuildRaft()` (`game.js:629-633`) removes **and disposes** all raft children. Mark the geometry and material `userData.shared=true` (respected at `game.js:392`) and re-add the cable in `afterRebuild()`. Kiln, power and others rescan when `raft.children.length` changes (`kiln.js:88`, `power.js:167`), so adding the cable once costs one rescan only. Do not toggle add/remove; toggle `.visible`.
- An alternative to the cable is a tiny shared "plug" mesh on each powered appliance group. The scan of `craft_purifier` / `kiln_station` / station groups already exists; one shared geometry, `.visible` per group.

## 6. Co-op, old hosts, risks

- Authority: purifier, kiln and station ticks plus all drain are host only. Guests only read `powerAt` from the synced slice for prompts and visuals. Reads stay deterministic because `nearest` breaks ties by key.
- **New guest, old host**: `hostHasPower=false`, so `powerAt` returns 0, which matches the old host's 1x timing. Visuals stay hidden.
- **Old guest, new host**: the host finishes jobs sooner. The old guest's purifier countdown overstates the time (harmless), and kiln % comes from synced `t` (correct). fc grills on an old guest run 1x locally and snap to the host's snapshot every 0.5 s (minor jitter).
- Drain on a guest-only basis is impossible by design, since there is no `power.*` action. That is good.
- Risks: (a) fc `update` couples cook time and fuel, so scale only the raw phase. (b) The purifier `fast` Set must be built **before** `tickWatering` from the host's own `st`. (c) The receiver "range" semantics are inverted (sec. 2). (d) A battery emptying mid-job just drops back to 1x, which keeps it cozy. (e) Night lights and hookups share one battery, so the "battery ran out" notice may fire more often; keep the per-night `warned` set (`power.js:130,230-232`).

## 7. Recommendation: ship first

1. **Electric Purifier bonus** (game.js + watering.js `fast` arg): the clearest player value, integer and deterministic, and no new item.
2. **Kiln** (kiln-core `rateOf` + kiln.js): host-only content slice, which is the cleanest consumer of `env.powerAt` / `env.draw`.
3. **Simple Grill station** (progression-hooks tick `dt*m`): host-only and decor-based.

Defer the driftwood fc grill (two-peer sim, separate save, burn coupling) and the receiver (its semantics need a design call: "+1 antenna tier" vs a shorter cooldown). The plug cue goes in prompts first, then the single LineSegments cable.
