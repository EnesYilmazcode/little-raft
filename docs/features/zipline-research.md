# Zipline: research

Goal: put up two posts on the raft, string a line between them, and glide along it while holding a handle.
The ride is friendly: there is no damage and no fall damage, and a drop into the sea just means a swim.
Line numbers are for branch `claude/loop-features-202611210749` as checked out.

## 1. How Raft does it (reference only. Our version is original.)
- **Pieces.** Raft has a *Zipline Base*, a post with a pulley wheel that is built as a piece on foundations or floors. It
  also has a *Zipline Tool*, a hand-held trolley/handle. In Raft you use the tool on one base and then on a second
  base to connect them, and a rope line appears between the two pulleys.
- **Riding.** With the tool equipped, you look at a line or base and press use to hook on. You hang below the line
  and travel fast along it. Gravity drives the speed: going downhill speeds you up, and a flat or uphill run is slow
  or stops you. You can jump off at any point, and you are released automatically when you reach the far base.
  The line can join bases on different levels, so the usual use is a tower top to a lower deck, or across a large raft.
- **Materials** (approximate, they changed between versions): the base costs planks, rope and some scrap or metal.
  The tool needs metal and rope. Linking uses no extra rope in most versions. Do not copy the numbers. Use our own.
- **What we take:** two anchors, a link step, and a hanging glide that is faster downhill and gentle uphill, ending
  with a jump or at the end. **What we change:** our own names, models, numbers and cozy rules (below).

## 2. Proposed original take (names are suggestions)
- `glidepost` **Glide Post** (decor, `placeable:true`): a tall wooden mast with a grooved wheel at the top.
  Height `POST_TOP` is about 3.0 m above the deck. An optional `glidestep` **Low Glide Post** has its top at about 1.4 m,
  so a tall-to-low link makes a downhill line on a flat raft. Decor only sits at deck level (see section 3), so slope has to come from post height.
- `glidehandle` **Glide Handle** (`tool:false`, stack 1, like the instruments at `items.js:154-158`): a wooden
  T-bar with a little wheel. To link, hold it and press E on post A, then E on post B. That costs `rope` scaled to the length (e.g. 1 per 4 m).
  To ride, hold it and press E near a post or line end. Space drops off. Pressing E on a post again lets you unlink and get the rope back.
- Speed rule (pure function, testable): `v' = v + (g*sin(slope) - drag*v)*dt`. Clamp `v` to `[V_MIN, V_MAX]`,
  with `V_MIN` about 1.2 m/s so you never get stuck on a flat line and `V_MAX` about 9 m/s. Forward/back input adds ±1 m/s².
- Recipes: Glide Post `hand({wood:6, rope:3, nail:2})` and Glide Handle `hand({wood:2, rope:2, scrap:2})`, both unlocking on
  `discover('nail')`.

## 3. Hosting it in Little Raft's code
**Content module.** Add a new file `dist/zipline.js` exporting `createZipline(ctx)`, imported in `dist/content.js:25-31`
(append to `FEATURES`, using the `?build=v3-survival-ae77fa84ac2b` suffix). Put models in `dist/zipline-model.js` (it receives THREE and imports nothing).
The registry (`content.js:39-64`) isolates failures: a throwing module is disabled once and the game keeps running. The module shape is
documented at `content.js:7-23`. `dist/bees.js` is the best template (spec `docs/specs/beehive.md`), with its pure top half and `createBees` at `bees.js:102`.

**Items.** Add entries to the `LIST` catalogue in `dist/items.js` (`item()` at `:62`, decor at `:169-198`). A `placeable:true` item lands in
`PLACEABLE_IDS` (`:215`), which game.js spreads into `DECOR_TYPES` (`game.js:68`). Add a collision radius to
`BLOCK_RADII` (`items.js:218-222`), about `glidepost:0.15`, because tests need a radius for every placeable. Add icons to `dist/icons.svg` or leave
`icon` out so the item falls back to `placeholder`. The alternative route through `content-items.js` (`CONTENT_DECOR`) is older, so prefer items.js the way bees does.
Held pose: if nothing is added, held-items.js uses its generic fallback (`holdFor`, `held-items.js:45`). A tuned T-bar needs a `HOLD` entry (`:29`) and a
model in `buildItemModel` (`:143`).

**Decor placement and save.** In practice decor is **tile-integer**. `cleanWorld` (`game.js:177-183`) keeps only `isInt(x,z)`,
allows one decor per tile, and accepts an optional `rot`. The place action is at `game.js:907-916` and pushes `{type, x, z, rot?}`. `rebuildRaft()`
(`game.js:519-539`) puts each model at `(x*2, .22, z*2)` with `rotation.y = rot`, and gets content models through `content.decorModel(type)`
(`:525`, used again for the ghost at `:400`). `placement.js:1-3` describes float free placement (`decorCheck`, `normaliseDecor`), but
game.js does not use it yet (see GAP-LIST item 9). **Write the zipline against tile ints and compute the post top as
`(x*2, deckY()+POST_TOP, z*2)`** in raft-local metres, which equal world XZ (`building-pieces.js:2`). This also keeps working if decor becomes float later.
Decor cannot be removed (no such action exists), so every line must be pruned whenever an end post is missing.

**State in `world.ext.zipline`.** Use `{v:1, s, r, L:[[ax,az,bx,bz], ...]}`. `s` is the session id and `r` the revision (the same as `cleanBees`, `bees.js:26`).
Validate in a pure `cleanZip(v, decor)`: both ends must be glide posts, the two ends must differ, the length must be ≤ `MAX_LEN` (about 24 m), duplicates are dropped, and keep at most 2 lines per post.
The save path is `syncWorldInventories()`, which runs `world.ext = content.serialize()` (`game.js:1067`). Restore is
`content.load(world.ext,'save')` (`:416`). `cleanExt` (`content.js:34`) caps the whole ext at 200k chars. Cache `serialize()` by `r` (`bees.js:180`),
because the host sends it about 8 times per second in `hostState()` (`game.js:1267`).

**Linking is host-authoritative.** In `interact(aim)` (game.js calls it at `:984`, after pickups and sails), call
`ctx.action({kind:'zip.link', ax, az, bx, bz})`. A guest's `action()` (`game.js:789-795`) sends `{type:'action', a, seq}`, and the host runs
`applyAction(a,'guest')`, which ends in `content.action(a, actor, bag)` (`:951`) with the actor's bag. Check reach against
`actor === 'guest' ? ctx.other : ctx.physics` plus slack (`bees.js:226-227`), and spend rope with `bag.remove`. Report back with
`ctx.emit({kind:'notice'|'build', text}, actor)`. Prompts come from `prompt(aim)` (`game.js:589`), and the module must escape them itself.
Keep the "first post picked" state local to the module, because it is per player. Do not save it.

**Riding is local (client-side), the same as walking.** Each client simulates only its own body and sends the pose, so no host action is needed.
There are two options for the override:
1. **No game.js edit:** use `afterMove(physics, dt)` (`game.js:1108`, which runs after `physics.update`, `building.postStep` and
   `controls.afterMove`). While riding, overwrite `physics.x/y/z` with the point on the line minus the hang offset (eye about 1.4 m below the wheel), and
   set `vx/vz` to the line velocity, `vy=0`, `grounded=false`, `swimming=false`. Islands already move the player this way
   (`islands.js:240-263`). The cost is that the next `physics.update` applies one step of gravity and collision before the override.
   That is harmless because the dt is ≤ .05 s, but `blockList` can push the body sideways near posts.
2. **Cleaner, with a one-line hook** modelled on diving: in `movePlayer` (`game.js:1097-1102`), `if (!dive)` skips `physics.update`. Add
   `const ride = !dive && content?.ride?.(laneDt, physics, {forward:fwd, jump})` and skip physics when it is truthy. This also needs a
   `ride` passthrough in `content.js`. `diving.move` (`diving.js:198-212`) is the template, since it writes x/y/z/v back into `physics`.
The ctx has no input getter. For a jump to drop off, read `physics._prevJump` (islands does this, `islands.js:244`), or add `get input()` to
`contentCtx` (`game.js:375-383`). On dismount, keep the line velocity as `vx/vz`, set `vy` to about 2, and let `PlayerPhysics` take over again.
It lands on tiles or splashes (`player-physics.js:176-186`), and the existing auto-clamber (`:189`) brings a swimmer back aboard.
Ladder climbing is in `move-feel.js:166-201` (`setLadder` / `ladderInput`). It is only an animation feel and nothing calls `setLadder` in game.js,
so it is not a ride hook. Its `onLadder` bob flag (`controls.js:84`) is a pattern we could copy for a gentle hang sway.

**Co-op avatars.** Poses go out through `coop.js` `snapshot()` (`coop.js:125-130`) as `cp` messages: `p:[x,y,z,yaw,pitch]`,
flags `f` (1 = swimming, 2 = grounded, 4 = reeling), and `h` (an index into `HELD`, `coop.js:25`, **append-only**). The source is `ctx.local()` (`game.js:1612`).
The remote avatar draws at `y - 1.6` (`coop.js:151`), so a rider already appears hanging in the right place with nothing extra.
To show the hang pose, add flag bit `8 = riding`, which old clients ignore because they read only bits 1/2/4, and teach `coop-avatar.js` to raise both arms.
Append `glidehandle` to `HELD` (index 17) or it shows as empty-handed. The legacy fallback avatar uses `other` from
`validPose` (`game.js:203-207`): y must be in -16..30 and xz within 120, and a rider stays well inside that.

## 4. Risks
- **Save compatibility.** An old save has no `ext.zipline`, so `load(undefined)` gives defaults. A **downgrade** drops the posts, because an older
  `DECOR_TYPES` does not know `glidepost` and `cleanWorld` filters it out at `:179`, and the old bag rejects the unknown kind. That matches what bees accepted.
  `cleanZip` must drop any line whose post is gone.
- **Co-op with an old host:** a guest gets `ext.zipline === undefined`. Show "Your friend's raft doesn't have ziplines yet", like `OLD_HOST`
  (`bees.js:9,112`). Riding still needs lines from the host, so there is nothing to ride. With an old guest and a new host, the guest
  sees bare posts with no line (it has no model) and the rider moving through the air, which is acceptable.
- **Remote interpolation:** at 15 Hz with Catmull-Rom plus extrapolation (`coop-interp.js`), a fast 9 m/s rider can overshoot the line end
  by up to 250 ms × 9 m ≈ 2 m. Cap `V_MAX` or send one more snap on dismount. `snapDistance=4` must not be crossed in one snap,
  which holds at ≤ 9 m/s × 67 ms ≈ 0.6 m.
- **Collision with raft pieces:** `world.pieces` (walls, roofs, pillars, `building-pieces.js:16-26`) can cross the line. When linking, test
  the segment against the piece boxes, using a pure test over `world.pieces` records `{t,i,j,l,r}` (see `BuildGrid.pick`, `:246`) or simply refuse a line that
  crosses a cell holding `wall/window/door/roof` at a level the line passes. While riding, the player's capsule is not collided, so pieces
  added after linking are a known clipping case. Re-validate on every `rebuildRaft` (scan like `bees.js:138`). Sails (decor, 3.8 m tall) can also clip.
- **Dismount into water:** this is friendly. Swimming and auto-clamber already handle it, with no damage. `PlayerPhysics._safety` teleports the player home only beyond
  50 m (`player-physics.js:38,218`), so keep `MAX_LEN` well inside the raft (tiles are capped at |x|≤25 → 50 m).
- **Raft bobbing:** `deckY()` = `raft.position.y + FLOOR_Y` (`game.js:325`) moves every frame. Recompute the line endpoints each frame
  from `deckY()` so the rider bobs with the raft rather than sinking into the line.
- **Sailing and diving:** block mounting while diving (`diving.state.diving`) or steering a sail. Islands' `afterMove` carry can fight
  ours, so do not mount when standing on sand.
