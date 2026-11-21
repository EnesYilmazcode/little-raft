# Sit on seats: research

Research note. The next step is a spec in `docs/specs/sitting.md`. Sitting is a comfort feature only: it never
costs anything and never traps the player, and any move key gets you up. Line refs are for this branch's `dist/`.

## (a) How the genre does it, and our take

Common patterns in cozy and co-op survival games (general mechanics only, no names or art borrowed):

- **E on a chair or bench to sit.** The camera drops to seated eye height and the body snaps to the seat, facing the
  way the seat faces. Mouse look stays free, often within a wide arc.
- **Getting up.** Any move key, Jump or E again stands you up and places you just in front of the seat.
- **Friends see it.** Remote players are shown in a seated pose: hips on the seat, legs bent forward.
- **Multi-seat furniture.** Benches and sofas have two or three seat points, so friends can sit side by side.
  A taken seat is refused or skipped to the next free one.
- **Small perks, sometimes.** A slow regen, a "rested" bonus or a quieter ambience. Many games add none.

**Little Raft take (original, friendly):**

1. **Seats that already exist.** `bench` (dist/items.js:189, tip "A comfy spot to sit…") gets **two seats**, so both
   brothers can sit together. `cushion` "Feather Cushion" (dist/content-items.js:29, craft-book.js:116 says "for a
   soft seat") gets one low floor seat. `crate` (items.js:211, 0.8 m box) could be an optional one-seat stool.
   `hammock` (content-items.js:18) is **not** in v1, because E on it already turns it (decor-pack.js:206) and lying
   in it overlaps with the bed. There is no small wooden seat, so a "Driftwood Stool" (`wood: 2`, one seat) is
   optional. The cushion covers the "small seat" role, but it needs feathers from the animals feature.
2. **Seat facing follows decor `rot`.** The bench backrest is at local -z (crafts.js:580-600, `LZ = .15`), so
   the sitter faces local +z. In world terms that direction is `(sin rot, cos rot)`, which gives **yaw = rot + π**.
3. **Prompt** "E Sit" / "E Sit beside your brother"; while seated, "Sitting · WASD/Space/E Get up".
4. **Clock stays as is.** A faster clock while seated would fight the sleep feature, so we leave it out.
5. **Achievement (optional).** `sit1` "Sit a While": sit for 30 s. Optional `sit2` "Bench Buddies": both
   brothers on one bench. The name "Take a Seat" is already used for crafting the bench (logbook.js:24).

## (b) How Little Raft would host it

**New content module `dist/sitting.js` (`name: 'sit'`)**, registered in `FEATURES` (content.js:47). Copy the
structure of `dist/sleep.js`, which is the closest existing takeover of player motion:

- **Host-authoritative slice** `world.ext.sit = {v:1, in:{host:[x,z,seat]|null, guest:[x,z,seat]|null}}`.
  The actions `sit.down {x,z,seat}` and `sit.up` go through `ctx.action()` and are handled in `action()`, as
  `sleep.lie`/`sleep.up` are at sleep.js:266-272. The host validates the tile, the type, reach and the free seat
  in the same way as `lie()` at sleep.js:131-140. A load from `'save'`/`'restore'` seats nobody (sleep.js:223-227).
  A load from `'net'` replaces the slice, and the module skips the update when the data has not changed
  (sleep.js:210-221).
- **Targeting**: a ray against the seat points, as `target()` does at sleep.js:106-127. Use `REACH = 2.5` and
  seat height `raft.position.y + .5`. `PICK_HEIGHT.bench = .55` (placement.js:72) agrees.
- **E**: `interact(aim)` is reached from game.js:1237 (`content.interact`). It runs **after** pickups, sailing,
  shark loot and watering (game.js:1222-1236), so E on a floating item still collects it. Order in FEATURES
  matters: `first()` (content.js:79) gives E to the first module that claims it. The new module only claims
  seat types, so it can go anywhere. If the hammock is ever added, the module must go **before** `createDecorPack`.
- **Prompt**: `prompt(aim)` (game.js:738), plus a `raftPrompts` provider with priority 1, as at sleep.js:252-260.

**Seat geometry (raft-local coordinates).** The raft group sits at world x = z = 0. Only its `position.y` bobs
and its `rotation.x/z` tilt (game.js:446, `updateRaft` game.js:1419-1425). Decor sits at `(d.x*2, .22, d.z*2)`
with `rotation.y = d.rot` (game.js:613-614). So physics x/z are already raft-local, and height comes from
`ctx.deckY()` = `raft.position.y + FLOOR_Y(.2)` (game.js:364). The player is never tilted. The camera only
gets roll from `raft.rotation.z` **while `physics.grounded`** (game.js:1432), so keep `grounded = true` while seated
and the cosy sway stays.

- Bench seat top: `.22 + SY(.445) + .02` gives about `deckY() + .49`. Seat points are at local `(±.36, +.04)`.
  World offset: `x = lx·cos r + lz·sin r`, `z = −lx·sin r + lz·cos r` (the same formula as `decorBlockers`,
  coop-rules.js:56-58).
- Seated eye: `deckY() + 1.25` (standing is `+1.6`, `EYE_OFFSET` game.js:87, player-physics.js:13). This puts the
  remote avatar's hips (`hip.position.y = .8`, avatar.js:119) right on the seat. Cushion eye: about `deckY() + .95`.
- Stand-up spot: 0.55 m in front of the seat (local +z) if that tile exists, else `getUpSpot()` (sleep.js:64-74).
  The bench blocker circles are r .22 at local z 0 (coop-rules.js:53), which leaves a 0.33 m gap. That is more
  than `BODY_RADIUS .25`, so the player stands clear.
- Blocking: `BLOCK_RADII.bench = .45` (items.js:241, game.js:84), but the bench uses the three `BENCH_CIRCLES`.
  The seat point is inside a circle. That is harmless while seated, because `_propOk` only allows moves outward
  (player-physics.js:310-320), and we teleport out on stand-up anyway.

**Taking over motion: use a ride hook, not afterMove.** Sleep pins the pose in `afterMove` (sleep.js:283-288)
*after* `physics.update` has already run (game.js:1382-1386). With the eye at deck + 1.25, the feet are 0.35 m
below the deck. Then `physics.update` runs `_pushOutOfTiles` (player-physics.js:158-159) and the water checks
(player-physics.js:186-196), which can shove the player sideways or set `splashed` before afterMove pins it back.
Instead, add one optional hook, in the same style as `diving.move` skipping physics (`if (!dive)`, game.js:1381):

```js
const ride = !dive && content?.ride?.(physics, laneDt, {forward:fwd, strafe:side, jump:...}); // content hook (sit)
if (!dive && !ride) for (...) physics.update(...)
```

`ride()` pins x/y/z, zeroes the velocities, keeps `grounded`, and returns true. It also reads the passed input:
`forward`, `strafe` or `jump` sends `sit.up` (stand up). Add `ride: (p, dt, i) => !!first('ride', p, dt, i)` to the
registry (content.js:82-101) and document it in the module-shape comment (content.js:7-26). `controls.afterMove`
(game.js:1387) still runs with `ev = null`. The exertion line (game.js:1392) sees speed 0, so the multiplier is 1.

**Facing.** Modules cannot set `yaw` (a game.js closure, not in `contentCtx` game.js:420-431). Add an optional
`faceYaw: y => { yaw = y; }` to `contentCtx` and call it once when sitting down. After that, look stays free.

**Co-op pose.** On this base the pose flags are `1 swimming | 2 grounded | 4 reeling` (coop.js:150, decoded at
coop.js:139). Bit 8 is free here but is reserved by the zipline branch, so use **bit 16 = seated**.
- Sender: `coopContext().local()` (game.js:1948) adds `seated: !!content?.seated?.()`, and `snapshot()` ORs in
  `(l.seated ? 16 : 0)`.
- Receiver: `onPose` adds `seated: !!(f & 16)`. `renderRemote` (coop.js:174) passes `seated: L.seated` to
  `avatar.update`.
- `coop-avatar.js update()` (181-268): when `s.seated`, blend `A.sit` toward 1. Then set the legs
  `lL = rL = −1.45` (thighs forward), arms resting (`laX = raX = −.35`), and `amp` and bob to 0.
  No extra height offset is needed, because the chosen eye height already puts the hips on the seat. Optional: snap
  `group.rotation.y` to the seat facing by finding the nearest seat point in `world.decor` on the receiver,
  so the body faces the sea while the head (`P.head`) follows `pitch`. No extra wire data is needed.
- `HELD` (coop.js:27-28) is unchanged. An old client ignores bit 16 and shows the brother standing sunk 0.35 m into
  the bench, which is acceptable. The fallback `friend` avatar (game.js:1460-1465) behaves the same.

**Vitals (optional).** `vitals.js` has hp/food/water only, with no stamina (vitals.js:16-24). The only gentle lever is
`exertion`. Setting it to something like `.85` while seated (game.js:1392, fed to `tickVitals` mult at game.js:705)
would make hunger and thirst drain a little slower. That is cosy, but it needs a game.js change. Recommend leaving
it out of v1, or making it a one-line `content?.seated?.() ? .85 : …`.

**Achievement (optional).** Add entries to `ACHIEVEMENTS` (logbook.js:27-40) and cases to `evaluate().holds`
(logbook.js:87-97), for example `case 'sit1': return ev.kind === 'sit'`. Content modules have no award path
today: `award()` is a game.js closure (game.js:1032-1037). Add `award: ev => award(ev)` to `contentCtx`. It is
host-only already. The host's module calls `ctx.award({kind:'sit'})` after 30 s seated. tests/logbook.test.mjs:22,24
assert exactly 15 achievements and must be bumped.

## (c) Risks

- **Seat taken by partner.** Use host arbitration (slice `in`), as sleep does. The guest's request is refused
  ("Your brother is sitting there"), or it picks the bench's other seat. A local pre-check against the slice keeps
  the prompt honest. There is a latency of about 125 ms (state about 8/s), so two simultaneous E presses are
  resolved by the host.
- **Decor removed or raft rebuilt while seated.** `rebuildRaft()` (game.js:606) does not touch `world.decor`, so
  it is safe. A shark tile kill removes decor (shark.js:77), and the guest's `world` is replaced by host state.
  The host step must clear seats whose decor is gone (as sleep.js:145 does). When a seat disappears, the local
  step calls stand-up, and the stand-up tile may be gone too, so fall back to `getUpSpot`. Also clear the guest
  seat when `ctx.other` is null (sleep.js:144). On a world change (first net state, restore), use
  `forgetSeat()` without teleporting (sleep.js:205-207).
- **Rotation changes.** Rotating at placement changes `d.rot`. Re-read `rot` every frame from `world.decor`, never
  cache it.
- **Holding items.** Allow it: eating works (game.js:1244-1248) and fishing from the bench is charming. Hook
  throws start at the hand anchor, which follows the camera. Block hammer and decor placement while seated,
  or simply allow them, since placement uses the aim ray only. Decide in the spec.
- **E conflicts.** A pickup in aim wins E before content (game.js:1224-1229), so stand-up must not rely on E alone.
  Move keys and Jump also stand you up, through `ride()`.
- **Swim and dive.** Sitting requires `physics.grounded && !physics.swimming`. `interact()` returns early while
  diving (game.js:1223). A fainted player (`vitals.hp <= 0`) should be stood up.
- **Menus and pointer lock.** `ride()` only runs while `running` (movePlayer returns early, game.js:1374). Opening
  the inventory or logbook while seated is fine: stay seated (unlike sleep, which gets up on `uiOpen`, sleep.js:181).
  Losing pointer lock (game.js:1654) needs no handling.
- **Wildlife.** Gulls perch on bench tops (`PERCH_TOP.bench = .47`, wildlife.js:17). They already avoid players
  within 3.5 m (wildlife.js:11), so a seated player keeps them away. That is fine.
