# Spec: Glide Posts, glide lines and the Glide Handle

Source: docs/features/zipline-research.md. Cozy rules: no damage, no fall damage, nothing is lost. A drop into the sea just means a swim, and auto-clamber brings you back aboard.
Put up two posts, hold the Glide Handle, press E on one post and then on the other, and a rope line appears between their wheels. Hold the handle and press E at a post (or aim at the line) to hang on and glide. The ride speeds up downhill, crawls gently uphill or on the flat, ends with a little hop, and Space lets go at any point.
Logic goes in the new content module `dist/zipline.js`: a pure top half plus `createZipline(ctx)`, with the name `'zipline'`. Models go in the new `dist/zipline-model.js` (it is given THREE and imports nothing). Import both with `?build=v3-survival-ae77fa84ac2b`.
Line numbers are from the current branch. Builders: find each hook by its function name, because line numbers drift.

## 1. Items and recipes (dist/items.js)
| id | name | category | stack | recipe | unlock |
|---|---|---|---|---|---|
| `glidepost` | Glide Post | decor, `placeable:true` | default | `hand({wood:6, rope:3, nail:2})` | `discover('nail')` |
| `glidestep` | Low Glide Post | decor, `placeable:true` | default | `hand({wood:4, rope:2, nail:1})` | `discover('nail')` |
| `glidehandle` | Glide Handle | tool, `tool:false`, `stack:1` | 1 | `hand({wood:2, rope:2, scrap:2})` | `discover('nail')` |
- Place the two posts after `net` (`items.js:~196`, the end of the decor block) under a `// [zipline]` comment. Put the handle after `bells` (`:158`), in the same style as the instruments: `item('glidehandle','Glide Handle','tool',{iconTint:'#b0805a', stack:1, …})`. Leave `tool` false so it has no durability.
- Tips: glidepost "A tall mast with a little wheel on top. String a glide line to another post."; glidestep "A shorter glide post. Run a line down to it from a tall one for a speedy glide."; glidehandle "A wooden T-bar with a wheel. E links two posts or hooks you onto a line. Space lets go."
- `BLOCK_RADII` (`items.js:218-222`): add `glidepost: 0.15, glidestep: 0.15, // [zipline]`. `PLACEABLE_IDS` feeds `DECOR_TYPES` in game.js, so the posts place and save with no game.js edit.
- craft-book.js: add categories `glidepost:'decor', glidestep:'decor', glidehandle:'tools'` and `ITEM_TEXT` rows. item-svg.js: add three small inline icons (post with a wheel, short post, T-bar). If there is no time for icons, leave them out and the items fall back to `placeholder`.

## 2. Geometry and constants (pure, exported from zipline.js)
```js
export const POSTS = Object.freeze({glidepost: 3.4, glidestep: 2.4}); // wheel height above deckY()
export const MIN_LEN = 4, MAX_LEN = 16, ROPE_PER = 4, MAX_PER_POST = 2, MAX_LINES = 64; // horizontal metres (tile = 2 m)
export const G = 9.8, DRAG = 0.35, PUSH = 1.0, V_MIN = 1.2, V_MAX = 9, V_START = 2;
export const HANG = 0.55, ENDPAD = 0.6, HOP_VY = 2.2, DROP_VY = 0.3, END_CARRY = 0.5, REACH = 2.6, LINE_REACH = 3, HOST_SLACK = 2;
export const OLD_HOST = 'Your friend’s raft doesn’t have glide lines yet';
```
- The wheel of the post at tile (x,z) is at world `(x*2, deckY() + POSTS[type], z*2)`. Raft-local XZ equals world XZ (`building-pieces.js:2`). Recompute both ends from `ctx.deckY()` **every frame**, so the line and the rider bob with the raft.
- Rider eye = wheel point − `HANG` (hands on the bar just under the rope) and feet = eye − 1.6. At the low post the feet clear the deck by about 0.25 m. The heights are chosen so that no ride ever clips the deck.
- The usable span is `[ENDPAD, L3 − ENDPAD]` metres along the 3D length `L3`, so the rider never passes through a mast.
- `ropeCost(len) = Math.ceil(len / ROPE_PER)`, which gives 1 to 4 rope.

## 3. State: `world.ext.zipline`
`{v:1, s, r, l:[[ax,az,bx,bz], …]}`. `s` is a session id and `r` a revision counter (the `cleanBees` pattern). Each line is stored once in canonical order, with `(ax,az) < (bx,bz)` in lexicographic order.
`cleanZip(v, decor)` → `{v:1, s, r, l}`. Junk, undefined or an array gives the defaults. A line is kept only if:
- it has 4 ints, and both ends are glide-post decor (`glidepost` or `glidestep`) at those tiles;
- its two ends differ, and its length `2*hypot(bx-ax, bz-az)` is in `[MIN_LEN, MAX_LEN]`;
- it is not a duplicate, and neither post already has `MAX_PER_POST` lines (first come wins);
- the total is under `MAX_LINES`.
Order is canonicalised. The slice stays under 2 kB, well inside `EXT_MAX`. **Pieces are not re-checked here** (see §4). Run it on every `load`, and on the host whenever `decor.length` changes (checked once per frame).

## 4. Pure API in dist/zipline.js (no DOM, no Date, no Math.random)
```js
export function cleanZip(v, decor)                          // §3
export function postAt(decor, x, z)                         // -> 'glidepost' | 'glidestep' | null
export function linesAt(st, x, z)                           // -> indices of lines touching that post
export function canLink(st, decor, pieces, ax, az, bx, bz)  // -> {ok:true, len, cost} | {ok:false, reason:'same'|'post'|'short'|'long'|'full'|'blocked'}
export function lineBlocked(pieces, A, B)                   // A,B = {x,y,z}, y relative to deck -> bool
export function lineWorld(st, i, decor, deckY, out)         // -> out {ax,ay,az,bx,by,bz} or null
export function stepRide(r, ln, dt, inp)                    // r = {t (metres along A->B), v, dir:±1}; -> 'ride' | 'end'
export function riderPose(r, ln, out)                       // -> out {x,y,z,vx,vy,vz}
export function nearestOnLine(ln, ox,oy,oz, dx,dy,dz)       // -> {s (metres from A), off (ray-to-segment distance), along}
```
- **`canLink`** checks, in order: `same` (A equals B); `post` (an end is not a glide post); `short` / `long` (length); `full` (`MAX_PER_POST` reached on either end, or `MAX_LINES` reached); `blocked`. An existing A–B pair is **not** an error, because `zip.link` treats it as an unlink (§6).
- **`lineBlocked`** is a segment test against `world.pieces` records `{t,i,j,l,r}`, using the box geometry from `building-pieces.js:3-4, 216-235`:
  - cells (`floor`, `roof`, `stairs`): x in `[2i−1, 2i+1]`, z in `[2j−1, 2j+1]`, y in `[l*LEVEL_H − FLOOR_THICK, l*LEVEL_H + PIECES[t].height]`;
  - edges (`wall`, `halfwall`, `window`, `door`): axis 0 is the plane z=`2j−1`, x in `[2i−1, 2i+1]`; axis 1 is the plane x=`2i−1`, z in `[2j−1, 2j+1]`; thickness ±0.07 and height `PIECES[t].height`;
  - pillars: a ±0.11 box at the corner `(2i−1, 2j−1)`;
  - `foundation` is skipped.
  Pad every box by 0.2. Test three parallel segments: the wheel line, the line 1.0 m lower and the line 2.0 m lower (the rider's body). Use a parametric slab test with `t` in [0,1]. It allocates nothing, because a module-level `Float64Array(2)` holds the scratch (the same idea as `building-pieces.js:47`). Import `LEVEL_H`, `FLOOR_THICK` and `PIECES` from building-pieces.js.
- **Motion rule (`stepRide`)**. Split dt into substeps of ≤ .05 s (dt is clamped to .25 first). For each substep `h`:
  1. `uy = (by − ay) / L3 * dir`
  2. `a = −G*uy − DRAG*v + PUSH*clamp(inp.forward, −1, 1)`
  3. `v = clamp(v + a*h, V_MIN, V_MAX)`
  4. `t += dir*v*h`
  5. If `t` leaves `[ENDPAD, L3 − ENDPAD]`, clamp it and return `'end'`.

  Because of `V_MIN`, a flat or uphill line always keeps moving in the mount direction ("the little wheel winds you along"). Holding S slows you, but never below `V_MIN`.
- **`riderPose`**: the point `P = A + (B−A)*t/L3`, so `x=P.x, y=P.y−HANG, z=P.z`. The velocity is the unit line vector × `dir*v`.

## 5. Riding (local, every client simulates its own body)
- **Mount** happens in `interact(aim)` when all of these hold: `ctx.heldKind() === 'glidehandle'`, `!physics.swimming`, `!ctx.uiOpen()`, not the old host, and `lineBlocked` is false for the line *now*. If a piece built after linking is now in the way, show the notice "Something is in the way of this line" and do not mount.
  - From a post within `REACH`: pick the post's line whose horizontal direction best matches the look yaw. Start at `ENDPAD` from that end, with `dir` pointing away from the post.
  - From the line: use `nearestOnLine` with the aim ray. Mount if `off < 0.6` and the point is ≤ `LINE_REACH` from the camera. Start at that `s` (clamped to the span), with `dir = sign(dot(look_xz, B−A))`.
  - In both cases `v = max(V_START, |horizontal player velocity · line dir|)` and `prevJump = current jump`.
- **Hook** (§8): `ride(dt, physics, inp)` is called every frame. It always caches `inp` (this is how `interact` knows whether you are crouching). When not riding it returns false. While riding it:
  1. rebuilds `ln` with `lineWorld` (using `ctx.deckY()`);
  2. runs `stepRide` and then `riderPose`;
  3. writes `physics.x/y/z`, `vx/vz` and `vy = 0`, sets `grounded = false` and `swimming = false`;
  4. returns true, so game.js skips `physics.update`.
- **Dismount**:
  - Space on its press edge: keep the line velocity and set `vy = DROP_VY`.
  - `'end'`: set `vx/vz = line velocity * END_CARRY` and `vy = HOP_VY`, which gives a small hop onto the deck by the post.
  - The line disappears (the partner unlinked it, or a post is gone), the handle is no longer held, or a debug teleport moves you more than 1 m from the expected pose: dismount the same way as Space.

  After any dismount return false, and `PlayerPhysics` takes over on the same frame. It lands the player on tiles or splashes, with no damage.
- **Camera sway**: `update(dt)` runs after `updateCamera` (`game.js:1278` vs `:1284`), so while riding it *adds* to the camera (no game.js edit):
  - `camera.rotation.z += sin(elapsed*1.8) * .025 * k`
  - `camera.position.y += sin(elapsed*3.1) * .015 * k`
  - where `k = options.cameraMotion * min(1, v/4)`.
- **Prompts** (static text, escaped with `ctx.esc` wherever a number is interpolated):
  - handle not held: aiming at a post shows `Glide Post: hold a Glide Handle to link or ride`;
  - old host: `OLD_HOST`;
  - a link is pending: `<kbd>E</kbd>Link line here (N rope)`, or `Unlink (get N rope back)` when the pair is already linked, or the `canLink` failure text, or `<kbd>E</kbd>Cancel` on post A;
  - a post with lines: `<kbd>E</kbd>Glide · <kbd>C</kbd>+<kbd>E</kbd>new line`;
  - a post with no lines: `<kbd>E</kbd>Start a glide line`;
  - aiming at a line: `<kbd>E</kbd>Hook on`;
  - riding: no prompt, plus a corner hint `Space to let go`, shown with `ctx.notice` once per ride.
- **Failure texts**: same `"Pick a different post"`, post `"That needs two glide posts"`, short `"Too close: posts must be 2 tiles apart"`, long `"Too far: lines reach 16 m"`, full `"That post already has two lines"`, blocked `"A wall or roof is in the way"`, rope `"Needs N rope"`.

## 6. Linking (host-authoritative)
- `interact(aim)` while holding the handle:
  - A post is targeted (the `bees.js:117-140` target pattern, type check `postAt`, reach `REACH`, aim point at mid-mast height `deckY+1.4`).
  - With a pending `A`, the same post cancels and a different post sends `ctx.action({kind:'zip.link', ax, az, bx, bz})`.
  - With no pending post, a post that has lines, and no crouch → **mount**.
  - Otherwise (no lines, or crouch held, `inp.crouch`) → set pending `A = {x,z}` and show the notice `"Now press E on the other post"`.
  - Pending state is local and is not saved. It clears after 30 s, when the handle is put away, or on any `load(…,'save')`.
- `action(a, actor, bag)` claims kinds that start with `'zip.'`. For `zip.link`:
  1. All four values must be ints. The actor pose (`actor === 'guest' ? ctx.other : ctx.physics`) must be within `REACH + HOST_SLACK` of post B, and `bag.count('glidehandle') > 0`.
  2. Canonicalise the pair. If the pair is already linked, this is an **unlink**: refund `ropeCost` atomically (the `harvest` snapshot-copy pattern, beehive.md §5); on a full bag emit `full` and change nothing. Otherwise remove the line, emit `{kind:'loot', text:'Line taken down · + N rope', loot:{rope:N}}` and `st.r++`.
  3. For a new pair, run `canLink(st, world.decor, world.pieces, …)`. On failure emit its text as a `notice`. Then check `bag.count('rope') >= cost`, or emit `"Needs N rope"`. Then `bag.remove('rope', cost)`, push the line, `st.r++` and emit `{kind:'build', text:'Glide line strung · − N rope'}`.
  Every path returns true.
- The host also prunes in `update`: when `decor.length` or `decor` identity changes, run `cleanZip`, and bump `r` only when the line count changed. Riders (local) see a vanished line and dismount.

## 7. Models and visuals (dist/zipline-model.js)
- `createGlidePost(T, top)`: a Group named `craft_glidepost` with its origin at the floor top.
  - A square foot plate (.5 × .06 × .5, #8b6a43) and a tapered mast (CylinderGeometry .07→.09, height `top − .1`, 6 sides, #a57a4c).
  - Two diagonal braces, and a rope wrap ring at 1.2 m (#c9a66b).
  - A horizontal grooved pulley at the top: a torus (r .12, tube .025, #6b5a4c) around a hub disc. Because it is horizontal it reads right in every link direction.
  - Merge the static parts into one vertex-coloured mesh, as in the bees build notes.
  - The `glidestep` model is the same function with `top = POSTS.glidestep`, named `craft_glidestep`.
- `createRopeLines(T, max)`: one `LineSegments` with a `BufferGeometry` position attribute `Float32Array(max*6)` (`DynamicDrawUsage`), `LineBasicMaterial({color:'#c9a66b'})`, `frustumCulled = false` and `drawRange` = 2·count. It is added to `ctx.scene` (not to the raft, because `rebuildRaft` clears raft children at `game.js:521`). `update` rewrites the positions in place from `lineWorld` each frame: no allocation, and only up to 64 lines.
- `createHandle(T)`: a T-bar (a .34 × .035 cylinder grip, #a57a4c) with a short stem, a small wheel (torus r .05, #6b5a4c) on top and rope wraps at the ends. Grip at the origin, long axis +Y (the coop-avatar convention, `coop-avatar.js:44`).
- `decorModel(type)` returns these for `glidepost` and `glidestep`, and null otherwise. The rebuild chain (`game.js:525`) and the ghost (`:400`) reach it.
- held-items.js:
  - `HOLD.glidehandle = {hand:'right', pose:'grip', rx:-0.2, rz:1.57}` (the bar sideways in the fist);
  - `SIZE.glidehandle = 0.3`;
  - an `else if (kind === 'glidehandle')` branch in `buildItemModel` (`:143`) that wraps `createHandle(T)` with `fit(...)`.

  While riding, the first-person hand model raises toward the top of the screen. This is optional: if hands.js has no simple hook for it, skip it, because the sway carries the feel.

## 8. Hook lines (all tagged `[zipline]`)
- `dist/items.js`: 3 item rows (§1) and the `BLOCK_RADII` row.
- `dist/content.js`:
  - import `createZipline` (`:25-31`) and append it to `FEATURES`;
  - in the returned object add `ride: (dt, p, inp) => !!first('ride', dt, p, inp), riding: () => !!first('riding'),`.
- `dist/game.js`:
  - `contentCtx` (`:375-383`): add `heldKind: () => heldKind(),`.
  - `movePlayer` (`:1097`, after the `dive` line): add `const ride = !dive && !!content?.ride?.(dt, physics, {forward:fwd, jump:ci ? ci.jump : input && held('Space'), crouch:ci ? !!ci.crouch : input && held('KeyC')}); // [zipline]`.
  - `movePlayer` (`:1101`): change `if (!dive)` to `if (!dive && !ride)`.
  - The coop `local()` (`:1612`): add `riding:!!content?.riding?.(),` to the returned object.
- `dist/coop.js`:
  - `HELD` (`:25-26`): append `'glidehandle'` (index 17, **append-only**, after `'bells'`, with a `[zipline] 17` comment);
  - `snapshot` (`:128`): `| (l.riding ? 8 : 0)`;
  - `onPose` (`:117`): `riding:!!(f & 8),`;
  - the avatar update call (`:152`): `riding:L.riding,`.
- `dist/coop-avatar.js`:
  - add the `s.riding` field to the header comment (`:3`);
  - after the reeling block (`:187-192`): `if (s.riding) { raX = laX = -2.75; raZ = -0.12; laZ = 0.12; }`, plus a slow leg dangle (legs ±0.15 at `sin(time*2)`), with `air` forced to 1;
  - add a `BUILD.glidehandle(g, K)` entry (a wood bar plus a rope stem, tip = the wheel).
- `dist/held-items.js`: `HOLD`, `SIZE` and the `buildItemModel` branch (§7).
- `dist/craft-book.js` and `dist/item-svg.js` (§1).
- New files: `dist/zipline.js`, `dist/zipline-model.js`, `tests/zipline.test.mjs`.

## 9. Co-op and compatibility
- **Riding**: the rider's pose already streams through `ctx.local()` → `snapshot()` at 15 Hz. The partner sees the body at `y − 1.6` (hanging under the rope) with both arms up (bit 8) and the handle model (HELD 17).
- **Overshoot**: interpolation can overshoot a line end by up to about 2 m at 9 m/s. That is accepted, because `END_CARRY` slows the exit.
- **Old client**: an old guest or host reads only bits 1/2/4 and shows HELD 17 as empty-handed.
- **Linking**: a guest's E sends `zip.link` through `ctx.action`, and the host validates it against the guest's bag and pose. Lines reach guests through `hostState` (`ext.zipline`). Guest `load(data,'net')` uses the `r`/`s` dedupe and the `netUndef` early return from bees.js.
- **OLD_HOST**: a guest that gets `ext.zipline === undefined` sets `hostHasZip = false`. Its prompt is `OLD_HOST`, `interact` shows `ctx.notice(OLD_HOST, 2400)`, and it never sends `zip.link`. With no lines there is nothing to ride.
- **Old save**: there is no `ext.zipline`, so `cleanZip(undefined)` gives defaults. The new kinds are additive.
- **Downgrade**: an older `DECOR_TYPES` drops `glidepost`/`glidestep` in `cleanWorld` (`game.js:167`), `migrateSnapshot` drops the handle, and the unknown ext slice is ignored. This matches what bees accepted.
- **Removal**: decor cannot be removed, so posts are permanent. Lines can be taken down (refund).
- **Mixed versions**: mixed-version co-op is unsupported. Say so in the PR.

## 10. QA helper: `raftDebug.content.zipline` (module `debug`)
- `state()`: a deep copy of `st`.
- `lines()`: `[{i, a:[x,z], b:[x,z], len, ln}]`.
- `place(type, x, z)`: host only. Puts a post on a free raft tile and calls `rebuildRaft` (a copy of bees `place`).
- `link(ax,az,bx,bz)`: host only. Skips the bag but runs `canLink`, and returns its result.
- `ride(i, t = 0.1, dir = 1)`: mounts the local player on line `i` at fraction `t` of the span, for screenshots. Then `stop()` dismounts.
- `pose()`: `{riding, t, v, dir, line}`.

Screenshot recipe: `place('glidepost',0,0)`, `place('glidestep',3,0)` (6 m), `link(0,0,3,0)`, `ride(0,.4)`, then shoot first person; in co-op e2e, shoot the guest view of the host riding (arms up).

## 11. tests/zipline.test.mjs (node:test, assert/strict, `RAFT_DIST` base, `bagWith` as in bees.test.mjs)
1. **Motion**: a 3.4→2.4 line of 6 m speeds up from `V_START` and stays ≤ `V_MAX`; a steep synthetic line (ay−by = 10, 12 m) clamps at `V_MAX`; a flat line holds `v === V_MIN` from 0.5 after one step; uphill and `forward = −1` never go below `V_MIN` and uphill still reaches `'end'`; `dt = 1e6` is clamped (one call advances at most `.25*V_MAX`); `'end'` clamps `t` to `L3 − ENDPAD`, and `dir = −1` ends at `ENDPAD`; two identical step sequences are `deepEqual`.
2. **`riderPose`**: the eye is `HANG` below the wheel point, the velocity magnitude equals `v`, and the direction follows `dir`.
3. **`cleanZip`**: undefined, null, an array or a string → defaults; floats, short or long lines, self lines, a third line on a post, duplicates or reversed duplicates, and lines on missing or non-post tiles are dropped; pairs are canonicalised; removing a post from decor prunes its lines.
4. **`canLink` / `lineBlocked`**: each reason in order. A wall edge between the posts gives `blocked`, a roof at level 0 over the span gives `blocked`, a foundation does not, and a wall beside the line (1 tile off) does not. Rope costs are 1, 2 and 4 for 4, 6 and 16 m.
5. **Module `action`**:
   - link spends rope, and relinking the same pair refunds it;
   - without a handle, with too little rope, a guest out of reach, or non-int values: the state and the bag snapshot do not change;
   - an unlink into a full bag changes nothing.
6. **Serialize roundtrip**: `serialize()` returns the same object until `r` changes. `load(serialize(), 'save')` in a fresh module gives equal lines. `load(same,'net')` twice keeps state identity, and `load(undefined,'net')` gives the `OLD_HOST` prompt.
7. **Ride hook**:
   - with a stub ctx (`deckY: () => 0.2`), `debug.ride(0,.5)` then `ride(.1, physics, {jump:false})` returns true and writes x/y/z onto the line;
   - a Space press edge returns false with `vy === DROP_VY`;
   - reaching the end gives `vy === HOP_VY`;
   - changing `deckY` moves `physics.y` by the same amount.
8. **Pose flag**: in coop.js, `HELD[17] === 'glidehandle'` and the indices 0..16 are unchanged (a snapshot of the old list). A `snapshot({…riding:true})` has `f & 8`, and an `onPose` roundtrip gives `riding:true`. Old bits 1/2/4 are unaffected.
9. **Models** with the vendored THREE: posts are named `craft_glidepost` / `craft_glidestep` with heights within ±.1 of `POSTS`; `createRopeLines(T,64)` draws 2·n vertices; `buildItemModel(T,'glidehandle')` returns a Group; every placeable has a `BLOCK_RADII` entry; the items craft from their costs.

Run `npm test` and shoot.py. The `errors` list must be empty.

## Build notes
These are the places where the build differs from the spec above, or adds to it.
- **HELD index**: the coop.js `HELD` list had 17 entries (0..16), so `glidehandle` went in at index **17** as the spec assumed.
- **Craft-book tab**: craft-book.js has no `decor` tab (its tabs are tools, materials, survival and building), so the posts go under `building` and the handle under `tools`. `tests/survival.test.mjs` lists the tools tab exactly, so `glidehandle` was added to that list.
- **Rope visuals**: `createRopeLines(T, max)` returns an `InstancedMesh` of thin rope cylinders, one instance per line, named `glide_lines`, instead of `LineSegments`. One-pixel GL lines barely show up and look out of place next to the bevelled props. The draw call is still a single one. Each frame `userData.set(i, a, b)` rewrites the instance matrices in place, with no allocation, and `count` is set to the number of lines. The tests check `count` and the instance positions.
- **game.js ride hook**: game.js passes a reused `rideIn` object (`{forward, jump, crouch}`) instead of an object literal, so it allocates nothing per frame. It passes the real frame `dt`, and `stepRide` clamps and substeps it.
- **coop.js**: there are two small exported pure helpers, `poseFlags(l)` (used by `snapshot`) and `readFlags(f)`, so the tests can check bit 8 without starting a hub. `onPose` reads `riding:!!(f & 8)` inline.
- **`canLink`** returns `{ok:true, len, cost, linked:true}` for a pair that is already linked, and the caller unlinks it. **`lineWorld`** also writes `l3` into `out`. **`nearestOnLine`** takes an optional `out` and otherwise reuses a module scratch object. `TEXT` and `ropeCost` are exported.
- **Post targeting**: the aim test measures the horizontal miss distance to the mast and allows ±1.6 m vertically around mid-mast (`deckY + 1.4`), so you can aim anywhere on a tall, thin mast.
- **E key**: while riding, E is consumed and does nothing. If you are not holding the handle, or you hold it but aim at nothing, E falls through to the rest of the chain (so the inventory still opens), and the prompt explains what to do.
- **Dismount**: dismounting also sets `physics._prevJump` and clears `_jumpBuffer`, so the Space press that let go does not queue a second jump on landing.
- **Debug helpers**: `debug.ride` skips the handle-held check (screenshots). `debug.link` on a pair that is already linked returns the `canLink` result without unlinking.
- **Prompt text**: the unlink prompt has an E key: `<kbd>E</kbd>Unlink (get N rope back)`.
- **Skipped**: the optional first-person hand raise while riding. No third-person debug camera exists, so the QA screenshot is first person: riding up the line toward the tall post, with the deck view of both posts and the line as a second shot.
- **Icons**: there are inline SVG icons for all three items in item-svg.js.
- **Mixed versions**: mixed-version co-op is unsupported (see §9).
