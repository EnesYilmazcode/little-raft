# Spec: Snack Float (shark bait)

Source: docs/features/shark-bait-research.md. Toss a little fish parcel on a cork into the sea; the shark swims off and nibbles it for 120 s instead of
biting the raft or swimmers, then its attack timer starts over from the full 300 s. Cozy rules hold: one float at a time, an item is never lost to a
refused toss, no new danger, a shark that is dead or fleeing just comes back to the float later. Line numbers refer to the current tree.

## 1. Ids and files
New kind `snackfloat` ("Snack Float"). Host action `shark:bait`. Save field `world.shark.bait` (optional). Co-op pose grows from 7 to 10 numbers (append only).
No new state code, no new npm deps, no content module (the lure lives in the pure shark sim, which is already saved, synced and tested).

| File | Change |
|---|---|
| dist/shark.js | `BAIT` constants, `baitSpot`, `setBait`, `clearBait`, `baitActive`, state `snack` in `step`, save/clean, pose 7-9, float view (sections 3-4, 7) |
| dist/snack-float-model.js | new: `createSnackFloat(T)` merged vertex-coloured mesh, imports nothing (section 6) |
| dist/items.js | catalogue entry after `hinge` (line 152), refined block (section 2) |
| dist/craft-book.js | `CATEGORY_OF` (after `fishtrap`, line 29) `snackfloat: 'survival'`; `ITEM_TEXT` (after line 177) desc/use |
| dist/item-svg.js | `ITEM_ICONS.snackfloat` before the closing `});` (section 6) |
| dist/held-items.js | import `createSnackFloat`; `MODEL_KINDS.snackfloat: T => createSnackFloat(T)`; `SIZE.snackfloat = 0.16` |
| dist/game.js | `useSelected` branch, `tossSnack`, `shark:bait` host action, `sharkEffect` fx, prompt row, two host callbacks, debug (section 5) |
| dist/live.js | `PRELOAD` + `'snack-float-model.js'` next to `'shark-model.js'` (tests/live-preload.test.mjs enforces it) |
| tests/shark.test.mjs, tests/snack-float.test.mjs | section 9 |

## 2. Item and recipe (dist/items.js)
```js
item('snackfloat', 'Snack Float', 'refined', { stack: 10, iconTint: '#e0b070',
  recipe: hand({ fish: 2, seaweed: 1, rope: 1 }), unlock: discover('fish', 'seaweed'),
  tip: 'A little seaweed parcel of fish tied to a cork. Toss it in the water and the shark will happily nibble it instead of your raft.' }),
```
- Category `'refined'`, never `'food'`: it is not in vitals `FOOD`, so `isEdible('snackfloat')` is false and the click is never ambiguous. Shows on the Survival tab via `CATEGORY_OF`.
- No shark meat in the recipe (feeding the shark shark is grim). Makes 1. No `placeable`, no `tool`.
- craft-book `ITEM_TEXT.snackfloat: { desc: 'A fish parcel tied to a bobbing cork.', use: 'Click the water within 12 m. The shark snacks for 2 min, then leaves the raft alone a while.' }`.

## 3. Pure sim (dist/shark.js; still no THREE in the top half)
```js
export const BAIT = Object.freeze({ TIME: 120, MAX: 180, REACH: 12, SLACK: 1.5, PAD: 2, OUT: 10, LIM: 200,
  EAT_OFF: 1.2, NIBBLE_R: 3, NIBBLE_EVERY: 2, FAST_R: 6, SLOW: 2.5 });
export const SHARK_STATES = Object.freeze(['circle', 'approach', 'bite', 'flee', 'hunt', 'dead', 'snack']); // appended
export const baitActive = s => s.bt > 0;
export function baitSpot(tiles, x, z, out = { x: 0, z: 0 })   // -> out | null
export function setBait(s, tiles, x, z, t = BAIT.TIME)        // -> 'ok' | 'busy' | 'water'
export function clearBait(s)                                  // bt = 0 (debug only); next step leaves 'snack' via the end path
```
- **State fields** (createSharkState, line 116): `bx, bz, bt` (bt = seconds of nibbling left, 0 = no float) and `bitten: false`, filled from `cleanShark(saved).bait`.
- **baitSpot.** Null when x/z are not finite, `|x|` or `|z|` > `LIM`, or `overRaft(tiles, x, z, 0.2)` (the click was on the deck). Otherwise push the point outward along
  the ray from the origin in 0.25 m steps (at most 40) until `!overRaft(tiles, px, pz, PAD)`; still over → null. Then clamp the radius to `raftExtent(tiles) + OUT`.
  Write `out.x/z` rounded to 0.01. Keeps the float 2 m clear of the deck and out of most of the dolphin/turtle `circler` lane. Deterministic, no allocation.
- **setBait.** `bt > 0` → `'busy'` (nothing changes). `baitSpot` null → `'water'`. Else `bx, bz = spot`, `bt = clamp(t, 0.1, MAX)`, return `'ok'`.
  Allowed while the shark is dead/looted: the float waits and the 120 s are only counted once the shark is back at it.
- **step (203-294).** After the dead block (233) and before the prey check (235):
  `if (s.bt > 0 && s.state !== 'flee' && s.state !== 'snack') { s.hasTarget = false; s.prey = -1; s.attackDmg = 0; s.warned = false; s.leg = 0; s.biteClock = 0.5; setState(s, 'snack'); }`
  The prey check (235) gains `&& s.state !== 'snack'`, so swimmers are ignored while it snacks. `circle` never runs with a float out, so `startAttack` never fires.
- **case 'snack'.** `dx = bx - x, dz = bz - z, d = hypot`. If `d > EAT_OFF + 0.05`: `steer(s, bx - dx/d*EAT_OFF, bz - dz/d*EAT_OFF, d > FAST_R ? ATTACK_SPEED : SLOW, dt)`;
  else turn the heading toward the float at `3 * dt` (like hunt, 281). `s.bitten = d <= NIBBLE_R`. While bitten: `bt = max(0, bt - dt)`; `biteClock -= dt`;
  at `biteClock <= 0`: `biteClock += NIBBLE_EVERY; anim = 1; hooks.nibble?.(bx, bz)`. When `bt <= 0` (any path, also `clearBait`): `bt = 0; bitten = false; endAttack(s)`
  (timer = 300) `; setState(s, 'circle'); hooks.ate?.(bx, bz)`. The 120 s therefore count only at the float; travel, flee and death time are free.
- **hit (152)** is unchanged: 15 damage while snacking → `flee` (timer 300) → after `FLEE_TIME` 6 s `circle` → the entry check above puts it back on the float. `kill` keeps the float.
- **forceAttack** (debug) while a float is out: the next step re-enters `snack` (the attack is dropped). `under` (292) is untouched; the float is 2 m off the deck.
- **Save.** `cleanShark` (121): `bait` kept only if it is a plain object with finite `x, z` (|v| ≤ LIM) and finite `t > 0`; returns `bait: {x: round2, z: round2, t: clamp(round1(t), 0.1, MAX)}`.
  The key is **absent** otherwise, so old saves clean exactly as today. `saveShark` (130) appends `bait: {x, z, t}` only while `bt > 0`. Still `v: 1`.
  Old build loading a new save: its `cleanShark` drops `bait`, the float is gone (accepted, nothing breaks). The item in a bag on an old build resets the bag (content-items.js:4, known trade-off for every new kind).

## 4. Co-op pose (never a new state code)
- `update()` (413): `v.code = sim.state === 'snack' ? (sim.bitten ? STATE_CODE.bite : STATE_CODE.approach) : (today's mapping)`. Depth target (415): `-0.32` also when `snack && bitten`.
  Code 2 gives the head-up nibble pitch and the anim sway in `showPose` for free; code 1 reads as a fast swim. **Code 7 is never sent:** old guests clamp it to 6 ("gone").
- `net()` (453): `pose` (335) becomes 10 numbers; `pose[7] = round2(bx)`, `pose[8] = round2(bz)`, `pose[9] = round1(bt)` (host: sim; all 0 without a float). Still allocation-free.
  Old guests read `p[0..6]` only (`length >= 7`, extra numbers finite), so they see the shark swim off and nibble, just no float.
- `applyNet` (459): after the 7-number part, `net.hostBait = p.length >= 10`; if so `net.bx = clamp(p[7], -LIM, LIM)`, `net.bz = clamp(p[8], -LIM, LIM)`, `net.bt = clamp(p[9], 0, MAX)`,
  else `net.bt = 0`. `clearNet` (466) also sets `hostBait = false, bt = 0`. New guest on an old host gets 7 numbers → `hostBait false` → it refuses tosses locally (5).
- Mod getters: `get bait()` → `{x, z, t}` of what is shown (host sim / guest net) or `null`; `get hostBait()` → host/solo `true`, guest `net.have && net.hostBait`;
  `toss(x, z)` host → `setBait(sim, host.world().tiles, x, z)`; `setBait(x, z, t)` / `clearBait()` host only (debug).

## 5. Engine (dist/game.js)
- **Click** (useSelected 1443): right after the spear/hammer/armor line (1450), **before** `content.use`: `if (kind === 'snackfloat') { tossSnack(p); return; }`.
- **tossSnack(p)**, local checks in order (each a `notice`, nothing sent, nothing removed):
  1. guest and `!shark?.hostBait` → `Your friend’s raft doesn’t have Snack Floats yet` (2400 ms); 2. `!shark` → `No shark around to feed`; 3. `diving?.state.diving` → `Surface to toss it`;
  4. `!p || hasTile(round(p.x/2), round(p.z/2))` → `Point at the water to toss it`; 5. `hypot(p - physics) > BAIT.REACH` → `Try a spot a little closer`;
  6. `shark.bait` non-null → `The shark is still snacking`. Then `swing = 1; play('throw', .5); action({kind:'shark:bait', x:round2(p.x), z:round2(p.z)})`.
  The guest never removes the item itself; the host snapshot updates the bag.
- **Host action** after `shark:hit` (1381):
```js
if (a.kind === 'shark:bait') { // [snackfloat]
  const p = actor === 'guest' ? other : physics, now = performance.now();
  if (!shark || !p || !Number.isFinite(a.x) || !Number.isFinite(a.z) || now - sharkBaitAt[actor] < 400 || bag.count('snackfloat') < 1) return;
  sharkBaitAt[actor] = now; const say = t => emit({kind:'shark', text:t}, actor);
  if (Math.hypot(a.x - p.x, a.z - p.z) > BAIT.REACH + (actor === 'guest' ? BAIT.SLACK : .01)) { say('Try a spot a little closer'); return; }
  const s = new Bag(bag.snapshot()); if (!s.remove('snackfloat', 1)) return;
  const r = shark.toss(a.x, a.z); if (r === 'busy') { say('The shark is still snacking'); return; } if (r !== 'ok') { say('Point at the water to toss it'); return; }
  commit(bag, s); const b = shark.bait;
  emit({kind:'shark', fx:'snack', bx:b.x, bz:b.z, text:shark.sim.state === 'dead' ? 'Snack Float bobbing · the shark will find it later' : 'The shark swam off for a snack'}, 'all');
}
```
  `sharkBaitAt = {host:0, guest:0}` next to `sharkHitAt` (364). Import `BAIT` with the other shark names (69). Refusals never consume (scratch bag, commit only on `'ok'`).
- **sharkEffect** (550), before the `isInt(e.x)` return: `if (e.fx === 'snack' && Number.isFinite(e.bx) && Number.isFinite(e.bz) && shark) { shark.fx('snack', e.bx, e.bz); play('splash', .6); }`
  (text still shows through the existing notice line). Old guests just get the text. `mod.fx('snack')` splashes at strength 0.6.
- **createShark host callbacks** (initShark 532): `onNibble:(x, z) => play('splash', .25 * nearK(x, z))`, `onAte:() => { play('pop', .4); notice('The shark finished its snack', 2200); }`,
  where `nearK = clamp(1 - dist(player, x, z) / 20, 0, 1)` and the call is skipped at 0. Both are local view events (section 7), so host and new guests each hear/see them; no emit.
- **Prompt** (updateContext 785), right after the harvest row: `else if (selectedKind() === 'snackfloat') html = snackPrompt();` →
  guest old host: the OLD_HOST text; `shark?.bait` → `The shark is still snacking`; aim point on water within 12 m → `<kbd>Click</kbd>Toss the Snack Float`; otherwise `Point at the water to toss it`.
- **Debug** (sharkDebug 2306): `get bait()` → `shark?.bait ?? null`; `setBait(x, z, t = 120)` host/solo only → `shark.setBait(+x, +z, +t)` result string (`'ok'|'busy'|'water'`, guest `null`);
  `clearBait()` host only. `state` for a guest keeps reading the code list (a snacking shark shows `approach`/`bite`).

## 6. Float model (dist/snack-float-model.js) and icon
- `export function createSnackFloat(T)` → `Group` named `snackFloat` with one merged non-indexed `Mesh` (`MeshLambertMaterial({vertexColors:true})`, no shadows), own `bake()` as in scarecrow-model.js:14.
  Origin = waterline centre, ~0.3 m wide, ≤ 400 tris, MODEL-STYLE chunky shapes. Parts: a cream cork bobber (`CylinderGeometry(.08,.09,.08,10)`, `0xf3e2b8`) with a teal band (`0x54a6a4`)
  and a little stick on top (`0xbb8650`, h .09); a seaweed parcel ball (`0x4f9a5c`, r .1, squashed y .7) beside it at y -.02, crossed twine bands (`0xd9c38c`, two thin tori);
  a silver fish tail fan (`0x9fb1bf`, two flat cones) poking out of the parcel. `export function disposeSnackFloat(g)` disposes geometry and material.
- `ITEM_ICONS.snackfloat`: original 48×48 art in the item-svg palette: cork with teal band and stick, green parcel with tan twine cross, silver fish tail, two pale water arcs under it.

## 7. Float view (createShark, all from the shown bait: host sim, guest net; no per-frame allocation)
- Built once in `createShark`, added to `group` (scene/shark frame), hidden by default. Shown while `bait.t > 0` and the game is active.
- **Sailing: the float is raft-relative.** The raft stays at the origin while islands and debris drift past (`sailFlow`); the shark sim, its ring, its bite spots and the dead body's
  `floatSet` drift point are all in this frame, so the float sits where it was tossed beside the raft, like a bobber on a short line. Letting it drift with `sailFlow` would carry it
  60-240 m away during the 120 s and pull the shark off-ring for minutes; a fixed spot keeps it simple, keeps host and guest identical with three numbers, and never strands the shark.
- **Bob:** `y = ocean.getHeight(bx, bz) + .02 + .025*sin(t*2.2)`, roll `.08*sin(t*1.7)`, yaw `+= .3*dt`. **Shrink:** `scale = .55 + .45*min(1, bt / TIME)`.
- **Nibble:** when `view.code === bite`, the shown shark is within `NIBBLE_R + 1` of the float and `view.anim` jumps by > .5 since last frame: `waterFx.splash(bx, y, bz, .35)` (drops + ripple ring),
  a 0.3 s dip of `-.06`, and `host.onNibble?.(bx, bz)`. **End:** when the shown `bt` goes from > 0 to 0: splash .5 at the last spot, hide, `host.onAte?.()`.
- `dispose()` (468) also disposes the float.

## 8. Edge cases
- Second toss while one is out: refused locally and on the host (`busy`), item kept. Two players tossing in the same tick: the second gets `busy` and keeps the item.
- Toss mid-bite: the attack is dropped at once (`hasTarget = false`); the earlier "The shark is biting the raft!" is followed by the snack text. Damage already done stays.
- Toss while a swimmer is hunted: hunt ends, it goes to the float. After the snack a nearby swimmer can be hunted again right away (the timer reset is for raft attacks).
- Guest returns to its own raft: `clearNet(); load(world.shark)` (2066) restores its own float from its save.
- New guest, old host: local OLD_HOST refusal. Old guest, new host: no float drawn, the shark still visibly swims off and nibbles. Old host ignores `shark:bait` anyway.

## 9. Tests
**tests/shark.test.mjs** (pure; reuse `grid`, `world`, `run`; float at `(8, 0)` on `grid(3)` unless noted):
1. `BAIT` frozen with TIME 120, MAX 180, REACH 12, PAD 2, OUT 10; `SHARK_STATES` ends with `'snack'`; `STATE_CODE` unchanged (gone 6, 7 keys).
2. `baitSpot`: on a tile (0, 0) and (2.5, 0) → null; NaN / 500 → null; (3.4, 0) pushed to x ≥ 5 (clear by PAD); (40, 0) clamped to radius `raftExtent + 10` = 13; deterministic.
3. `setBait`: `'ok'` sets bt 120; second call `'busy'` leaves bx/bz/bt as they were; over the raft `'water'` with bt still 0; t 999 → 180.
4. Blocks attacks: `timer = 0`, setBait, run 30 s with a `bite` hook spy → never called, `tileHp` empty, state `'snack'`.
5. Drains only at the float: shark at its spawn (~30 m off), after 1 s bt > 119.9; run until `bitten`; then 10 s more → bt dropped by 10 ± 0.1. Reaches `bitten` within 20 s.
6. Nibble hook: 5 ± 1 calls in 10 s while bitten, each with (bx, bz); `anim` hits 1.
7. Completion: run until bt 0 → state `'circle'`, `timer` within 0.2 of 300 at that moment, `ate` hook once; the next `startAttack` (state `'approach'`) comes 300 ± 0.2 s later, no `bite` hook before it.
8. Mid-attack: `forceAttack` (state approach, hasTarget true), setBait, one step → `'snack'`, hasTarget false, attackDmg 0.
9. Hunt suppressed: swimmer prey parked 1 m from the float, run 60 s → `hurt` never called; after `clearBait` and one step → `'circle'`, within 1 s → `'hunt'`.
10. Hit while snacking: `hit(s, 15)` → `'flee'`, bt unchanged through the 6 s flee, then back to `'snack'` within 0.2 s of the flee ending.
11. Dead: `kill` with a float → bt unchanged over 60 s; `loot`, run 181 s (respawn) → `'snack'` again.
12. Save: no float → `saveShark` has no `bait` key and deep-equals today's shape; with a float → `bait: {x, z, t}` (t rounded 0.1); `createSharkState(saveShark(s))` keeps bx/bz/bt;
    `cleanShark` junk: `bait` string, array, `{x:NaN}`, `t:0`, `t:-5`, `x:900` → no `bait` key; `t:999` → 180; an old `{v:1, hp, timer}` save → identical output to before.
**tests/snack-float.test.mjs** (new; real THREE from dist/vendor, stub host `{scene:new T.Scene(), ocean:null, raft:() => null, world:() => w, role:() => r, preys(){}}`):
13. Item: `ITEM_INFO.snackfloat` stack 10; `RECIPES.snackfloat` cost `{fish:2, seaweed:1, rope:1}`, count 1; `isEdible('snackfloat') === false`; `categoryOf('snackfloat') === 'survival'`;
    `ITEM_TEXT.snackfloat.desc` set; `ITEM_ICONS.snackfloat` is a string without `<script`, ` id=` or `href`.
14. Model: `createSnackFloat(T)` has one Mesh with a `color` attribute, finite bbox, width 0.2-0.4 m, ≤ 400 tris; `disposeSnackFloat` does not throw.
15. View host: `net()` length 10, `[7..9]` all 0; after `toss(8, 0)` → `[8, 0, 120]`; over a 200 s `update` run `pose[3]` stays an integer in 0..6 and is 1 or 2 while snacking; `bait` getter null after.
16. View guest: `applyNet` with 7 numbers → `hostBait` false, `bait` null; with 10 numbers and bt 50 → `hostBait` true, `bait` `{x, z, t:50}`, float visible after `update`;
    junk `[..., 1e6, -1e6, 999]` → clamped to 200 / -200 / 180; `clearNet()` → `hostBait` false, `bait` null.
Also run `npm test` (live-preload must pass), shoot.py (`errors: []`), `node tests/coop-e2e.mjs`, and a Playwright pass: craft one, `raftDebug.shark.setTimer(5)`, toss beside the raft,
watch it swim off and nibble (no bite in 30 s), toss again → "still snacking" and the stack count unchanged, `setBait` while sailing keeps the float beside the raft, guest sees the float.
