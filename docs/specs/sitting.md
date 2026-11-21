# Spec: sit on seats

Source: `docs/features/sitting-research.md`. Comfort only: sitting costs nothing and never traps you, and any move
key, Jump or E gets you up. New files: `dist/sitting.js` (content module `name:'sit'`), `dist/sitting-core.js` (pure,
no THREE) and `tests/sitting.test.mjs`. Template: `dist/sleep.js`. Line refs are for this branch.

## Decisions
- **Seats in v1:** `bench` (2 seats, side by side) and `cushion` "Feather Cushion" (1 low floor seat).
  **No crate stool**: E on a crate already opens storage (storage-research.js:207/286), so it would steal E.
  No hammock (E turns it, decor-pack.js:206). No new item or recipe.
- **Look:** on sit, yaw snaps to the seat facing `rot + π`. After that yaw is **clamped to ±100°** of the seat facing,
  and pitch stays free. Why: past 100° you look through your own backrest or shoulder. The remote avatar's body turns
  with `yaw` (coop-avatar.js:184), so a clamped yaw keeps your brother's seated body facing roughly out of the bench
  rather than sideways through it. No extra wire data is needed for that.
- **Vitals:** yes, `exertion = .85` while seated (hunger and thirst drain 15% slower). It is one game.js line, it is
  cosy, and there is no way to farm it.
- **Held items:** all allowed (eat, fish, hammer, place). Placement and the hammer use the aim ray only.
- **Achievement:** `sit1` "Sit a While" (30 s seated in total, either brother). There is no `sit2` in v1.

## Seat geometry (`sitting-core.js`, raft-local metres)
Decor `d` sits at `(d.x*2, .22, d.z*2)` with `rotation.y = d.rot || 0` (game.js:613-614). `d.x`/`d.z` may be
**fractional**, because placement is free (placement.js:3). Seats are matched by `|Δ| < 1e-3`, never by `===`.
`SEATS = { bench: [[-.36, .04], [.36, .04]], cushion: [[0, 0]] }` (local lx, lz; the sitter faces local +z).
`EYE = { bench: 1.25, cushion: .95 }` above `deckY()`. Bench hips land on the seat top at about deck+.49. The cushion
top is about deck+.17, and its eye sits .8 above the hips (avatar.js:119).
- `seatPoint(d, i, out)`: `r = d.rot||0`; `out.x = d.x*2 + lx*cos r + lz*sin r`; `out.z = d.z*2 - lx*sin r +
  lz*cos r`; `out.yaw = r + π`. This is the same rotation as coop-rules.js:56-58. `out` is reused, so it does not allocate.
- `findDecor(world, x, z)`: the first `world.decor` entry with `SEATS[type]` and a position within 1e-3, else null.
- `standSpot(world, d, i, out)`: the seat point pushed to local lz `+.59` (.55 in front of the seat). If the tile
  `(round(x/2), round(z/2))` is in `world.tiles`, use it. Else use `getUpSpot(world, round(d.x), round(d.z))`,
  **copied** from sleep.js:64-74 (do not import sleep.js; it pulls daynight).
- `clampYaw(yaw, seatYaw, lim = 100°)`: wraps `yaw - seatYaw` into (-π, π]. Returns null if `|δ| <= lim`, else
  `seatYaw ± lim`.
- `cleanSit(d)`: junk becomes `{v:1, in:{host:null, guest:null}, t:0}`. Each `in` entry is `[x, z, seat]`, where x/z
  are finite with `|v| <= 60` and seat is an integer 0..1; anything else becomes null. `t` (host seconds seated, total) is
  clamped to finite 0..1e9.
- Exports: `SEATS, EYE, REACH = 2.5, AWARD_S = 30, YAW_LIM = 100*π/180`, and the functions above.

## Data
`world.ext.sit = {v:1, in:{host:[x,z,seat]|null, guest:[x,z,seat]|null}, t:seconds}`. The host owns it and sends
it in state (~8/s).
- `load(d, 'save'|'restore')`: keeps `t` and always clears `in`. Nobody wakes up seated after a reload
  (sleep.js:223-227). `load(undefined)` gives the defaults. `load(d, 'net')` (guest): compare the 7 primitives with the
  last copy and return early if they are unchanged (sleep.js:210-221). On a **world change** (first net state, restore),
  forget the local seat without teleporting.
- Runtime only: `pendingUp` (local, s), `sentDown` (local, s), and `awarded` (host, true once `t >= 30`).

## Host authority (`action(a, actor)`, claims `a.kind` starting with `sit.`, host only)
- `{kind:'sit.down', x, z, seat}`: refuse with a notice to the actor unless all of these hold: `findDecor` finds it;
  `seat` is an integer `< SEATS[type].length`; the actor's pose (`ctx.physics` for host, `ctx.other` for guest) is
  finite and within REACH of the seat point; the actor is not swimming (`other.swimming`); and the seat is not
  `in[other]`. A bench with the chosen seat taken but the other seat free gets the **free seat** instead. If the
  actor is already seated elsewhere, move them. Then `in[actor] = [d.x, d.z, seat]`.
- `{kind:'sit.up'}`: `in[actor] = null`.
- Host `update(dt)`: if `!ctx.other`, clear `in.guest`. For each role, if `findDecor` no longer finds its seat, clear
  it. That covers shark tile damage (shark.js:77), the new `'undecor'` pickup action from another builder this round,
  and a decor type change. This needs no coupling to that code: re-read `world.decor` every frame. While
  `in.host || in.guest`, do `t += dt`. On the first frame with `t >= AWARD_S` and `!awarded`, call
  `ctx.award?.({kind:'sit'})`. `award()` dedupes and is host-only.

## Local player (both roles; `me = ctx.role === 'guest' ? 'guest' : 'host'`)
- `seated()` = `slice.in[me] && !pendingUp`. Exported to the registry as `content.seated()`.
- **E (`interact(aim)`)**: if seated, send `sit.up`. Otherwise use `target(aim)`, a ray against seat points as in
  sleep.js:106-127, with cy = `raft.position.y + .5` for the bench and `+.2` for the cushion and an off-ray limit of `.6`.
  It picks the nearest seat index. It refuses locally (a notice, no action) when:
  `!physics.grounded || physics.swimming` ("Find your feet first"), `ctx.vitals?.hp <= 0`, or the seat is `in[other]`
  ("Your brother is sitting there"). Otherwise it sends `sit.down` and sets `sentDown = .6`. Diving never gets here
  (game.js:1223), and pickups in aim win E first (game.js:1224-1229).
- **Becoming seated** (`in[me]` goes from unset to set): call `ctx.faceYaw(seatYaw)` once.
- **`ride(physics, dt, input)`** (new hook, below): returns false unless `seated()`. If
  `|input.forward| > .3 || |input.strafe| > .3 || input.jump`, stand up. Else re-read the decor (if it is gone, stand
  up), then set `physics.x/z` = the seat point, `y = deckY() + EYE[type]`, `vx = vy = vz = 0` and `grounded = true`.
  This keeps the camera roll at game.js:1432. If `clampYaw(input.yaw, …)` is non-null, call `ctx.faceYaw(it)`. Return true.
- **Stand up** (local): `pendingUp = 1`. Teleport to `standSpot` (`y = deckY() + 1.6`, `grounded = true`, zero
  velocities) and send `sit.up`. `pendingUp` clears when the host shows `in[me]` null, or after 1 s. When
  the host clears the seat by itself (decor gone, or a remote `sit.up`), stand up as well. The tile may be gone, so the
  `standSpot` fallback covers it.
- Fainted (`ctx.vitals.hp <= 0`) while seated: stand up. `ctx.uiOpen()` (inventory, logbook) does **not** stand you
  up, which differs from sleep.js:181. `ride` only runs while `running` (game.js:1374).
- **Old host guard**: a guest whose state has no `sit` slice (no net load seen after the first state) gets a notice
  on E: "Your brother’s raft doesn’t have seats yet". Nothing else happens.

## Prompts (`prompt(aim)` plus a `raftPrompts.provide({id:'sit', priority:1})` provider, as at sleep.js:252-260)
| situation | prompt |
|---|---|
| aim free bench seat | `<kbd>E</kbd>Sit` (`Sit beside your brother` if the other bench seat is in[other]) |
| aim free cushion | `<kbd>E</kbd>Sit` |
| aim seat held by other | `Your brother is sitting there` (muted) |
| seated (ignores aim) | `Sitting · <kbd>WASD</kbd>/<kbd>Space</kbd>/<kbd>E</kbd> Get up` |
Refusals: "Step a little closer", "Find your feet first", "Your brother is sitting there". The provider yields to
pickups (`pc.state.pickup`) and to the guest waiting prompt, exactly like sleep.

## Hook lines
1. **dist/content.js**
   - Module-shape comment (:7-26): add `ride(physics, dt, input)  takes over player motion this frame; return true to
     skip physics.update (sit, zipline)` and `seated()  -> true while the local player sits`.
   - In the `createContent` return object, add **exactly** this line (the zipline branch adds the same one, so a merge
     collapses to one copy): `ride: (p, dt, i) => !!first('ride', p, dt, i), // content hook (sit, zipline): first module to take over motion wins`.
     `first()` stops at the first truthy module. Two modules can't both be riding (each refuses to start while
     `content.seated()`/zipping), so first-wins is the correct coexistence rule.
   - Add `seated: () => !!first('seated'),`.
   - Import `createSitting` from `./sitting.js?build=v3-survival-ae77fa84ac2b` and append it to `FEATURES`.
     Position doesn't matter (it only claims seat types). Put it after `createSleep`.
2. **dist/game.js `movePlayer`** (:1381-1386): before the loop, add
   `const ride = !dive && !!content?.ride(physics, laneDt, rideIn); // content hook (sit, zipline)` and change the loop
   guard to `if (!dive && !ride)`. Fill `rideIn` (a module-level reused `{forward:0, strafe:0, jump:false, yaw:0}`, next to
   `moveInput` at :1368) just before, from `fwd`, `side`, the jump expression and `yaw`. If zipline already added an
   identical `rideIn`, keep one copy and add `yaw` to it.
3. **dist/game.js `movePlayer`** (:1392): prefix the exertion expression with `content?.seated?.() ? .85 : ` [vitals].
4. **dist/game.js `contentCtx`** (:420-431): add `faceYaw: y => { if (Number.isFinite(y)) yaw = y; }, award: ev => award(ev),`.
   Skip either if another builder already added it.
5. **dist/game.js `coopContext().local()`** (:1948): add `seated: !!content?.seated?.(),`.
6. **dist/coop.js**: `snapshot()` (:150) ORs in `(l.seated ? 16 : 0)`. `onPose` (:139) adds `seated:!!(f & 16)`.
   `renderRemote` (:174-175) passes `seated:L.seated`. Bit 8 is reserved for zipline. Update the flags comment.
7. **dist/coop-avatar.js `update()`** (:181-268): `A.sit = damp(A.sit || 0, s.seated ? 1 : 0, 10, dt)` and
   `amp *= 1 - A.sit`. After the leg/arm targets are computed and before the damping (~:245), apply
   `lL = lerp(lL, -1.45, A.sit); rL = lerp(rL, -1.45, A.sit); laX = lerp(laX, -.35, A.sit); raX = lerp(raX, -.35, A.sit)`,
   skipped for the right arm while reeling or charging, so fishing from the bench still animates. Scale the walk bob by
   `1 - A.sit`. No height offset (the eye heights put the hips on the seat). Add `sit:0` to `A`'s initial object.
8. **dist/logbook.js**: in `ACHIEVEMENTS` (:27-40), add `a('sit1', 'Sit a While', 'Sit down for 30 seconds.', 'compass')`
   after `homestead`. In `evaluate().holds` (:87-97), add `case 'sit1': return ev.kind === 'sit';`.
   **tests/logbook.test.mjs:22**: raise the count by one from whatever it is at build time (15 to 16 on this base).
9. **dist/live.js `PRELOAD`** (:16-): add `'sitting-core.js', 'sitting.js'` in alphabetical order. The
   tests/live-preload.test.mjs:38 test asserts that PRELOAD equals the static import graph.

## Save / co-op compatibility
- Old saves have no `ext.sit`, so they get the defaults. New saves on an old build: `cleanExt` keeps the slice, but it
  is unused.
- Old guest on a new host: it never sends `sit.*`, ignores bit 16, and sees the host standing 0.35 m into the bench
  (acceptable, research (b)). The host's slice still clears `in.guest` when `ctx.other` is null.
- New guest on an old host: there is no slice, so the old-host notice shows and the guest never sits.
- Achievement ids: `cleanProgress` keeps known ids only, and an old build drops `sit1` harmlessly.

## Tests (`tests/sitting.test.mjs`, node only, stub ctx like tests/sleep.test.mjs)
1. `seatPoint`: bench at (0,0) rot 0 gives (±.36, .04) and yaw π. rot π/2 swaps the axes. Fractional `d.x` works.
2. `clampYaw`: inside ±100° gives null; 150° gives seat+100°; wrap across ±π (seat 3.0, yaw -3.0) gives null.
3. `cleanSit`/`load`: junk gives the defaults; `load(d,'save')` with `in.host` set leaves nobody seated and keeps `t`.
4. `sit.down`: refused off-seat, out of reach, swimming guest, or cushion held by the other. On a bench with seat 0
   taken by the other, the actor gets seat 1. Accepted otherwise. `sit.up` clears.
5. Host `update`: removing the bench from `world.decor` (as undecor or a shark kill would) clears the seat. Then
   `ctx.other = null` clears the guest. Running `update(1)` 30 times while seated gives exactly one `award({kind:'sit'})`.
6. `ride`: returns false when not seated. Seated, it pins x/y/z to the seat (y = deckY+1.25) and zeroes v. Input
   `forward:1` stands up at `standSpot`, sends `sit.up` and returns false next frame. A yaw outside the limit calls `faceYaw`.
7. `standSpot`: front tile present gives the front point; front tile missing gives a getUpSpot neighbour.
8. Registry: `createContent(ctx, [a, b])` with two fake ride modules. `ride()` is true if either one consumes it, and
   the second is not called when the first consumes.
9. coop: `snapshot({seated:true,…}).f & 16`; `onPose({f:16|2,…})` buffers `seated:true`.
10. logbook: `evaluate(w(), [], {kind:'sit'})` includes `sit1`.

## QA (`raftDebug.content.sit`)
Expose `{ place(type, x, z, rot), sit(x, z, seat), up(), state(), stand(x, z) }`. `place` (host) pushes a decor entry
and calls `ctx.rebuildRaft()`. `sit` sends `sit.down` without the aim test. `state()` returns `{in, t, seated, pendingUp,
yaw}`. Screenshots: (1) place a bench at (0, .5) rot 0 and aim at it: "E Sit". (2) sit: the view over the sea from
bench height, with the "Sitting" prompt. (3) rotate the bench to π/2 and re-sit: the facing follows. (4) look 150° back:
clamped. (5) press W: you stand in front of the bench. (6) co-op (tests/coop-e2e.mjs harness): host sits on seat 0 and
the guest sits: the guest gets seat 1, and both avatars are in the seated pose (check `raftDebug.avatars.remote` y ≈
deck-.35). (7) the host removes the bench while the guest sits: the guest stands on deck. (8) cushion: low eye.

## Build notes
- **Files:** new `dist/sitting-core.js`, `dist/sitting.js`, `tests/sitting.test.mjs` (14 tests). Hooks tagged `// [sit]` /
  `content hook (sit, zipline)` in content.js, game.js (contentCtx `faceYaw`/`award`, `rideIn` + `ride` in `movePlayer`,
  exertion `.85`, `local().seated`), coop.js, coop-avatar.js, logbook.js, live.js PRELOAD; logbook test count 15 -> 16.
- **coop.js:** the flag math moved into two exported pure helpers, `poseFlags(l)` and `readFlags(f)`, so the bit-16 round
  trip is unit-testable without a DOM. `snapshot()` and `onPose()` call them; the wire format is unchanged apart from bit 16.
  **Zipline merge:** add bit 8 inside `poseFlags`/`readFlags` instead of inline in `snapshot()`.
- **Decor pickup:** `beforeUndecor(d)` returns "Someone is sitting there" while either seat entry points at d's position;
  `afterUndecor(d)` clears any seat there. The per-frame `findDecor` sweep is still the safety net.
- **Decor positions:** placement.js says decor can be fractional, but `cleanWorld` (game.js) keeps integer `x`/`z` only on
  this base. A fractional bench works for the host but is dropped from the guest's copy and from saves. The module matches by
  1e-3 either way. QA used the bench at **(0, 1)**, not (0, .5).
- **Small choices the spec left open:** `update()` clamps dt to 1 s (sleep uses .25), so `update(1)` x30 awards exactly once.
  A missing decor or a bad seat index is refused with "Nothing to sit on there". `sentDown` stops a second `sit.down` while
  the first one is in flight. E while seated does the full local stand-up (teleport + `sit.up`), the same as WASD.
  `awarded` resets on every save/restore load. `award()` dedupes, so an old save with `t >= 30` grants `sit1` once on load.
- **QA debug extras:** `raftDebug.content.sit.remove(x, z)` (host: drop the seat decor, as a pickup or shark would),
  `state().inMax` (the largest move input seen while seated) and `state().hostHas`.
- **Headless smoke** (swiftshader, solo + loopback co-op, no page errors and no console errors):
  E on the aimed bench gives "E Sit", and sitting puts the eye at deck + 1.45 (deckY + 1.25) facing yaw π. 150° back clamps to
  seat + 100°. Holding W stands you in front of the bench. Rotated π/2 and re-sat, the facing is 3π/2. Cushion eye: deck + 1.15.
  Co-op: the host sits on seat 0 and the guest asks for seat 0 and gets seat 1. Remote avatar y = deck - .35, in the seated
  pose (thighs forward, hands on knees). When the host removes the bench, the guest stands at the front tile.
- **Known gaps:** modules ahead of `sit` in FEATURES (storage crate, decor pack…) and pickups in aim still win E while
  seated. WASD/Space always get you up. The move threshold `.3` applies after move-feel's ramp (.14 s), so a tap shorter
  than about a frame is ignored. The avatar has no knee joint, so seated legs stick straight out and the feet dangle. It
  reads fine at play distance.
