# Kite flying: research

Craft a small kite, fly it from the deck on the real sailing wind, steer it with the mouse, let line out or
reel it in, and tie it to a railing or pillar so it keeps flying as decoration. It is cosy and mostly
cosmetic, with one small, rare reward. Line numbers are from the tree on 2026-11-21 (mid-merge), so grep the
quoted anchor before you edit.

## Conventions that apply
- Content registry module: `dist/kite.js` exports `createKite(ctx)` and is appended to `FEATURES`
  (`dist/content.js:58`). Pure maths goes in `dist/kite-core.js` with `tests/kite.test.mjs`. Models go in
  `dist/kite-model.js`. Items, recipes and icons follow `dist/content-items.js` (`CONTENT_ITEMS` :9, `CONTENT_RECIPES` :69), `dist/icons.svg`, and `SPRITES` in `dist/survival-ui.js:22`.
- State lives in `world.ext.kite` through `serialize()`/`load()`. Shared changes are host-authoritative
  through `action(a, actor, bag)`. Guests call `ctx.action(a)`. `load(data,'net')` must not rebuild meshes unless `rev` changed (paint pattern, `dist/paint.js` `load`).
- Clicks: `use(aim, kind)` is left click (`dist/content.js:104`, called at the end of `useSelected()`,
  `dist/game.js:1279`, and only on press). `alt(aim, kind)` is right click (`content.js:105`, `game.js:1683`).
  There is no hold or release hook, so the design uses single clicks only. Copy `dist/paint.js` `use`/`alt`/`prompt` and its `raftPrompts` provider, including `heldKind()` from `ctx.localBag()`.
- Names and art are original: "Sky Kite", patterns "Sunburst", "Gullwing", "Tidestripe".

## Wind sources (what is real)
- **The main source is `world.sailing`** (`dist/sailing-core.js`). `windDir` is in radians and gives the
  direction the wind blows *toward*, with vector `(sin a, cos a)` in world x/z (`windVector()` :100).
  `windStr` stays in `WIND_MIN..WIND_MAX` = 0.55..1 and changes slowly: direction ≤0.05 rad/s, strength
  τ = 20 s (:13-17). The host steps it and it reaches guests in `hostState` (`game.js:1581`, `sailing:world.sailing`).
  The pennant already reads it this way (`dist/decor-pack.js:168`). There is always some wind, so a kite always flies.
- **Raft motion:** `world.sailing.vx/vz` is the raft's virtual velocity (the world moves, the raft stays at
  the origin). The kite should use the apparent wind `W = windVector - (vx, vz)`, so it leans back harder when the raft runs under sail. Clamp |W| to ≥0.3.
- **Weather:** the daynight module exposes `get wind()` (`dist/daynight.js:734`). This is a weather wind of
  0.15 (calm), 0.7 (breezy) or 0.5 (rain), blended between states (`W_WIND` :99). It is deterministic from the seed and clock on both peers. Read it like `content.rain()` does (`content.js:112`):
  `ctx.content?.mods.find(m => m.name==='daynight' && !m.dead)?.wind`. A one-line `wind()` getter next to `rain()` would be tidier. This tree has no storm, and `grep storm dist` finds nothing.
- **Strength:** `s = clamp(|W| * (0.75 + 0.6*weatherWind), 0.3, 1.25)`. Calm weather gives a lazy, low kite. A breezy day gives a high, lively one.

## Flight model (closed form, stable, cheap)
The kite has no integrator, so it cannot diverge. The pose is a pure function of
`(anchor A, azimuth az, s, L, steer, t, phase)` in `kite-core.js`:
- `az = atan2(Wx, Wz) + steer` and `steer ∈ [-0.9, 0.9]` rad. Elevation is `e = lerp(0.25, 1.05, smooth(s)) * (0.6 + 0.4*cos(steer)) + tugLift`, so the kite sinks at the edge of the wind window.
- Position: `K = A + L*(cos e*sin az, sin e, cos e*cos az)`, plus wobble `0.5*s*sin(1.3t+φ)` sideways and `0.35*sin(0.9t+2φ)` up. Clamp `K.y ≥ water + 2`.
- Eased inputs, framerate-independent with `1-exp(-k dt)`: L follows its target at about 2 m/s, steer
  at k = 3, and launch ramps e from 0.1 over 3 s. A "tug" adds +0.25 rad that decays over 1.2 s, plus a small roll flourish.
- Orientation: the kite faces A (`lookAt`) and rolls by `-steer*0.6 + d(steer)/dt*0.3`.
- Line: about 16 points on a parabola from A to K with sag `L*0.05*(1.3 - s)`. Tail: 8 points trailing
  downwind of K with a travelling sine. Both write into preallocated `Float32Array`s with no allocations.
- The model is pure, so every client renders every kite locally from a few synced numbers.

## Controls (held "kite" item)
- **LMB** while the kite is stowed and you stand on the deck: launch. While it flies, LMB is a tug (climb flourish and a little "flap" sound via `ctx.play`).
- **RMB** (`alt`): line length cycles 8 → 16 → 24 m, eased (prompt "RMB Let out / Reel in").
- **Steering** comes from the look direction, with no new keys: `steer = clamp(angDiff(camYaw, az), ±0.9)`.
  Looking left of downwind pulls the kite left. WASD keeps moving the player, and free keys are scarce (A C D E G I J L N O Q R S W X Z are used).
- Switching the hotbar slot, swimming, opening a UI or walking >30 m from the anchor auto-lands the kite (it reels in over 1 s). The item never leaves the bag while it is hand-held.
- **E** with the kite flying, aimed at a railing or pillar: tie off. E at a tied kite's piece: untie, and
  the kite goes back to the bag. Picking uses `ctx.building.grid.pick(cam…, dir…, ctx.deckY(), 4)`, the same as `paint.js findTarget()`.

## Tie-off
- Anchor point from the piece record `{t,i,j,l,r}` (`dist/building-pieces.js:3`). For edge (i,j,0) it is
  (2i, 2j-1). For edge (i,j,1) it is (2i-1, 2j). For a pillar corner it is (2i-1, 2j-1). The height is
  `deckY + l*2.2 + RAIL_H(0.95)` for a railing and +2.0 for a pillar. Valid types are railing, pillar, gate and halfwall. The raft never yaws, so raft-local equals world x/z.
- Tied kites use the same flight model with their own `steer` (the steer at tie time) and `L`. They add the deck bob through `ctx.deckY()`.
- Allow at most 6 tied kites. The host prunes entries whose piece is gone from `world.pieces` (check once
  when `world.pieces` changes identity, like paint's `prune()`) and returns the kite to the host bag, or drops nothing if the bag is full.

## Co-op
- Slice `world.ext.kite = {v:1, rev, fly:{h:null|F, g:null|F}, tied:[{k, p, L, s}]}` where `F = {p, L, s}` (pattern index, line target, steer quantised to 0.05 rad).
- Actions: `kite.fly {p,L,s}` is sent on launch and when L or the quantised steer changes, throttled to
  ≥250 ms. `kite.land`, `kite.tie {k}` (host validates the piece and removes one `kite_*` from the actor's
  bag) and `kite.untie {i}` (host gives the item back). The host clears `fly.g` when the guest leaves (`ctx.other` is null).
- Rendering: the local kite uses local inputs right away and never waits for the echo. The remote kite uses
  `fly` from ext, anchored near `ctx.other` (pos + yaw-rotated fist offset 0.35 forward, 0.3 right, -0.25 down). Both peers share the wind, so the shapes match.
- Remote held prop: append `'kite'` to `HELD` in `dist/coop.js:27`. The list is append-only and its index
  is the wire format, so check whether spyglass, which is on `origin/claude/loop-features-202611210849` and
  not yet in this tree, already took 21. Also add `BUILD.kite` (spool cylinder + small diamond) and
  `TOOL_TILT.kite` in `dist/coop-avatar.js:49/127`. See commit `07af8ca` ("co-op held prop") for the exact 3-line pattern. Old clients map unknown kinds to index 0 (empty hand), which is harmless.

## Save
- Only `tied` and `rev` are saved, and `fly` is reset on `load(…,'save')`. `load(undefined)` gives an empty
  slice. Cleaning keeps entries with a valid piece key (paint `PIECE_RE` style), `p ∈ 0..2`, `L ∈ {8,16,24}`, `|s| ≤ 0.9`, and at most 6 of them.
- Items are `kite_sunburst`, `kite_gullwing` and `kite_tidestripe`, with maxStack 1 and `placeholder:false`.
  Recipes cost `{leaf 4, wood 2, rope 3}`, and Tidestripe also takes `paint_lagoon: 1` (paint pots exist: `content-items.js:36`). Add a craft-book group `tools` (`dist/craft-book.js:32`) and one icon
  `icon-kite` shared by all three, with different pattern colours in the swatch.

## Model budget
- World kite: one merged `BufferGeometry` with vertex colours for the pattern: a diamond or delta sail
  (8 tris, double-sided), two spars (2 boxes, 24 tris) and a bridle. Under 60 tris total, 1 material,
  `castShadow=false`. The tail is a vertex-coloured ribbon of 8 quads (CPU-updated) or a second `T.Line`.
  The string is a `T.Line` of 17 points, the same as the fishing line (`game.js:451-452`, `setRope` :1428).
- Kites use at most 3 draw calls each, with a cap of 2 flying + 6 tied = 24 calls worst case. Typical is 2-3 kites, so about 6 calls.
- `dist/rope.js` (`createRope(T,{segments,radius})` gives `{mesh, update(points,{tension,visible}), dispose}`,
  with radius clamped to 0.002-0.02 and no allocations in update) is **not used anywhere in dist**. A 0.012 m
  tube is subpixel at 10-24 m and would shimmer, so it is not used for the string. Optional use: a 1.5 m tube stub near the fist for close-ups.
- Held model (first person): a spool with the folded kite in the right fist. Add `kite_*` to `HOLD` in
  `dist/held-items.js:32` (`hand:'right', pose:'grip'`) and add a `buildItemModel` branch, mirroring
  spyglass `07af8ca` (`held-items.js` +6 lines). Unknown kinds otherwise fall back to a generic bundle. While flying, hide the folded sail part. This needs a tiny `contentCtx` getter, for example
  `heldModel: k => hands?.itemModel(k)`, next to `get brush()` (`game.js:428`).
- String start (first person): `camera.localToWorld(0.36, -0.30, -0.72)`, which is about where the right fist
  grips (`hands.js:15-16`). The viewmodel is drawn with a depth clear and no eye-scale (`dist/viewmodel.js` is not in dist), so a world-space point there lines up. This needs no engine edit.

## Small reward (keep it simple)
Every 90-150 s that a kite has been flying high (`s > 0.85`, `L = 24`), the host emits one notice, "Your
kite spots driftwood off the bow", and nudges the nearest free `world.items` debris toward the raft. If
that is too invasive, it can instead start a wildlife gull circling near the kite. Otherwise the kite is
purely cosmetic. Expose `debug.forceSpot()`, `debug.launch(p)`, `debug.setWind(s)` and `debug.tie(key)`.

## Integration points
| Where | What |
|---|---|
| `dist/content.js:58` FEATURES | append `createKite` (before cookpot, which stays last) |
| `dist/content-items.js:9/69` | 3 items + 3 recipes |
| `dist/held-items.js:32` HOLD, `buildItemModel` | held spool/kite (spyglass pattern) |
| `dist/coop.js:27` HELD, `dist/coop-avatar.js:49,127` | remote held prop (append only) |
| `dist/game.js:428` contentCtx | optional `heldModel(k)` getter (one line) |
| `dist/icons.svg`, `dist/survival-ui.js:22`, `dist/craft-book.js:32` | icon, sprite id, book group and text |
| reads `world.sailing.{windDir,windStr,vx,vz}`, daynight `.wind`, `ctx.building.grid.pick`, `ctx.other`, `ctx.deckY()` | wind, tie-off, co-op anchor |
