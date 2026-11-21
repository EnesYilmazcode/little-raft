# Dolphin friend (spec v1)

The wild dolphin that already visits (wildlife circler) can be fed 3 raw fish. Once fed it stays as the raft's named friend. It plays and leaps near the raft, swims beside a swimmer or Driftboard rider, comes when the **Conch Call** is blown, now and then noses a floating item toward the deck, and sometimes swims out to point at a signal cache or a docked wreck. No damage, no upkeep, it never leaves.
Research: `docs/features/dolphin-friend-research.md`. One builder. Re-grep every anchor below before editing, because a merge may still be settling: `dist/content.js`, `content-items.js`, `craft-book.js`, `icons.svg` and `survival-ui.js` are `UU` and `content-items.js` has duplicate recipe keys (harmless).

## Files
- NEW `dist/dolphin-core.js`: pure, no imports except `./animals-core.js` (`cleanName`, `rnd`, `mulberry32`) and `./wildlife.js` exports (side-effect free).
- NEW `dist/dolphin.js`: `createDolphin(ctx, { peek })`, module `name: 'dolphin'`, slice `world.ext.dolphin`, actions `dolphin.*`.
- NEW `tests/dolphin.test.mjs`.
- EDIT `dist/wildlife.js`: 2 one-word export edits (see Motion). EDIT `dist/content.js`: import + FEATURES. EDIT `content-items.js`, `craft-book.js`, `icons.svg`, `survival-ui.js` for the conch.
- No `game.js`, `cookpot.js` or `player-physics.js` edits in v1.

## Ids (all checked free: grep `conch|dolphin` hits only wildlife/shark)
- Item `conch`, 'Conch Call', icon `icon-conch`, `maxStack: 1`, `tool: false`, `placeholder: false` (write it as an `Object.freeze({...})` literal like `fins`). Put it in CONTENT_ITEMS after the `driftboard` line, under the comment `// dolphin friend (dolphin.js)`.
- Recipe `conch: recipe('conch', 'Conch Call', 1, { shell: 2, rope: 1 })`, appended after the `driftboard` recipe. It is not decor (not in CONTENT_DECOR).
- Module/ext/debug name `dolphin`, action prefix `dolphin.`, DOM id `lrDolphin`, rename action `dolphin.name`.
- `icons.svg`: append `<symbol id="icon-conch" viewBox="0 0 48 48">`, an original spiral horn shape in the shell symbol's colours (copy its stroke/fill style). `survival-ui.js:23` SPRITES: append `'conch'` after `'driftboard'`.
- `craft-book.js`: CATEGORY_OF `conch: 'tools'` (next to `driftboard: 'tools'`, :32); ITEM_TEXT `conch: { desc: 'A spiral shell horn with a rope loop.', use: 'Blow it (left click) to call your dolphin friend.' }`.

## Research reachability
Content recipes are locked until studied at the Tinker's Desk (`storage-research.js` `isLearned`: all cost kinds seen). `rope` is a starter. `shell` comes from Pim (`trader-core.js:12`, 3 fish -> 2 shells) and the wreck chest, if that lands. So: trade fish, study shell + rope, and the conch is learned. Also, `craftLocked(recipe)` in dolphin returns `'Befriend a dolphin first'` for `recipe === 'conch'` while `!st.friend`, and null for everything else. Storage runs first in FEATURES, so the study lock shows first; both must clear.

## State (`world.ext.dolphin`, host-authoritative)
`{ v:1, r, t, seed, pts, tossAt, by, friend, name, hearts, patAt, callAt, callWho, esc, nudge, nextNudge, pops }`
- `t` clock (s, host `+= dt` while `ctx.running`); `seed` uint32 drawn on befriend (host `Math.random`); `pts` 0..3 fish; `tossAt` last toss t; `by` 'host'|'guest'|'' (who gave the 3rd fish; opens the name dialog on that client); `friend` bool; `name` string; `hearts` 0..10; `patAt`; `callAt`, `callWho` 'host'|'guest'|''; `esc` 'host'|'guest'|''; `nudge` null | `{tok, at}`; `nextNudge` t of the next nudge try; `pops` int (heart-burst counter).
- `cleanDolphin(v)`: junk/non-object -> `emptyState()` (`friend:false`, `pts:0`, `t:0`, `tossAt/patAt/callAt:-1e9`, `nextNudge:120`). Non-finite numbers become defaults. `t` is clamped 0..1e9 and `pts`/`hearts` are ints clamped to 0..3 / 0..10. `tossAt/patAt/callAt` are clamped to `<= t`. `seed` is `>>> 0`. `name = cleanName(v.name)` (`animals-core.js:38`, max 14). A friend with no name gets `defaultName(seed)`. A non-friend gets name '' and `pts` < 3, so `pts:3` with `friend:false` becomes 2. `callWho`/`esc`/`by` must be in the allowed set, else ''. `nudge` is always null on load (transient). `pops` is a non-negative int. `nextNudge` is clamped to `t..t+600`.
- `DOLPHIN_NAMES = ['Splash','Marina','Ripple','Nori','Skipper','Coral','Breeze','Pippa','Finn','Lumi','Tango','Wavelet']`; `defaultName(seed) = DOLPHIN_NAMES[seed % 12]`.
- Host `bump()` = `st.r++`; serialize caches the object by `r` and only refreshes `t` (copy `gull.js` serialize/cache).

## Core API (`dist/dolphin-core.js`)
Constants: `FISH_NEED=3, TOSS_CD=8, TOSS_REACH=18, PAT_REACH=4, PAT_CD=60, MAX_HEARTS=10, HOST_SLACK=2, BEAT=12, BLEND=1.5, CALL_DUR=20, CALL_CD=30, ESC_RANGE=25, ESC_SIDE=1.8, ESC_AHEAD=0.5, BOOST=1.15, BOOST_R=4, NUDGE_EVERY=120, NUDGE_JIT=20, NUDGE_DUR=12, NUDGE_SPEED=0.6, NUDGE_MIN=8, NUDGE_MAX=25, NUDGE_PLAYER=6, NUDGE_NET=3, POINT_MAX=14, OLD_HOST='Your friend’s raft doesn’t know any dolphins yet'`.
- `emptyState()`, `cleanDolphin(v)`, `defaultName(seed)`.
- `toss(st, bag, t, wildNear)` -> `{ok, text, bonded}`. It fails with no reason text when `friend` is set, `!wildNear`, `t < tossAt + TOSS_CD` ('It’s still munching…') or `bag.count('fish') < 1` ('Bring a raw fish'). On success: `bag.remove('fish', 1)`, `pts++`, `pops++`, `tossAt = t`. At `pts === FISH_NEED` it sets `friend = true`, `hearts = 1` and returns `bonded: true`. The caller sets `seed`, `name` and `by` (seed stays out of core so the tests can inject it).
- `pat(st, t)` -> ok when `friend` and `t >= patAt + PAT_CD`; then `hearts = min(10, hearts+1)`, `patAt = t`, `pops++`. On cooldown it returns ok with no heart (a pat is still nice), `{ok:true, heart:false}`.
- `rename(st, name)` -> `cleanName`; an empty result is refused.
- `call(st, actor, t)` -> refused if `!friend` or `t < callAt + CALL_CD` (text 'Still echoing… try again soon'); else `callAt = t`, `callWho = actor`.
- `calling(st, t)` -> `st.callWho && t < st.callAt + CALL_DUR ? st.callWho : ''`.
- `modeAt(seed, t, hasPoint)` -> 'loop'|'show'|'point' for the beat `b = floor(t/BEAT)`: beat 0 = 'loop'; `rnd(seed, b) < .2 && hasPoint` -> 'point'; `b % 4 === 3` -> 'show'; else 'loop'. Final priority in the module: **call > nudge > escort > point > show > loop**. `behaviour(st, t, hasPoint)` returns that string, using `calling()`, `st.nudge`, `st.esc` and modeAt.
- `pickEscort(cands, centre, cur)` -> 'host'|'guest'|''. `cands` = `[{who, x, z, inWater}]`. A candidate must be `inWater` (swimming or riding a board) and within `ESC_RANGE` of `centre`. It keeps `cur` if still valid, else takes 'host' before 'guest'.
- `pickNudge(items, centre, players, nets)` -> the item or null. Eligible types are a **whitelist** `['wood','plastic','leaf','scrap','barrel']`, so `cache`, `bottle` and any future type are skipped. Item horizontal distance from centre must be in `[max(NUDGE_MIN, centre.r + 3), NUDGE_MAX]`. The item must be more than `NUDGE_PLAYER` m from every player pose (a proxy for "on a hook / being grabbed", because game.js does not expose held tokens) and more than `NUDGE_NET` m from every net (`nets` = world xz of `decor.type==='net'`, i.e. tile*2). Finite x/z only. Picks the nearest. No allocations beyond the return.
- `stepNudge(it, centre, dt)` -> moves `it.x/z` toward centre at `NUDGE_SPEED`. Returns false (done) once within `centre.r + 3`.
- `nudgeAbort(st, it, t, players, nets)` -> true when the item is missing, `t > at + NUDGE_DUR`, a player is within `NUDGE_PLAYER`, or the item is within `NUDGE_NET` of a net.
- `nextNudgeAt(seed, t, k)` -> `t + NUDGE_EVERY + (rnd(seed, 1000 + k) * 2 - 1) * NUDGE_JIT` (k = st.r keeps it deterministic and testable).
- `loopPose(seed, t, ext, out)`: closed form, raft frame. `dir = rnd(seed,1) < .5 ? -1 : 1`, `a = rnd(seed,2)*2π + dir*0.32*t`, `R = 7 + 1.5*sin(0.07t) + pushOut(ext, CIRCLER_MARGIN, 7)`. It writes `out.x/z/heading` (tangent) and `out.kind = 'dolphin'`, then `dolphinMotion(t, out)` for `y/pitch/roll`. `showPose` is the same but over a 5 m arc of ±0.6 rad centred on the bow direction (-z) at `R = ext + 4`, with a `DOLPHIN_CYCLE` of 1.4 s, so it is leap-heavy (call `dolphinMotion(t*3/1.4 % 3 ...)`; simplest is `dolphinMotion((t % 1.4) / 1.4 * DOLPHIN_LEAP, out)` during the first 70% and porpoise otherwise).
- `pointPose(seed, t, centre, target, out)`: in-beat phase `u = t % BEAT`. 0–4 s ease from the loop pose out to `P = centre + min(POINT_MAX, |target-centre|) * dir`, 4–8 s three leaps at P (heading toward the target), 8–12 s ease back. Blends use `smooth` with the loop pose at the same t, so no state is needed.
- `followPose(target, yaw, out)`: a point `ESC_SIDE` to the right and `ESC_AHEAD` ahead of `target` with yaw `yaw` (right = `(cos yaw, -sin yaw)` in the camera YXZ convention; check against `ctx.camera.rotation.y`).
- `nudgePose(it, centre, out)`: item xz + 0.9 m on the far side from the centre, heading toward the centre, a porpoise `y`.
- Every pose function writes into `out` (no allocation) and is a pure function of its inputs.

## Motion / rendering (`dolphin.js`)
- `dist/wildlife.js` export edits (exact): `function dolphinMotion(u, out) {` -> `export function dolphinMotion(u, out) {` (:255), and `const pushOut = (ext, margin, r0) =>` -> `export const pushOut = (ext, margin, r0) =>` (:21). `raftExtent`, `CIRCLER_MARGIN`, `DOLPHIN_CYCLE/LEAP` are already exported. `dolphinMotion` requires `out.kind === 'dolphin'`.
- Mesh: built lazily on the first update when `st.friend` and `ctx.T` exist. One `T.Mesh(dolphinGeometry(T), mat)` (`wildlife-models.js:94`), with `mat = new T.MeshLambertMaterial({vertexColors:true, color:0xd8ecff})` (the friend tint), scale 0.92, `matrixAutoUpdate=false`, composed like wildlife `updateCircler` (:514-522) with `ocean.getHeight(x,z) + out.y`. It is added to `ctx.scene` (wildlife does the same, :357). There are 3 heart meshes from `heartGeometry` (`animals-models.js:87`) for the burst on a `pops` change (gull `seenPops` pattern, no burst on join), and the same hearts during befriending above the **wild** circler pose.
- Name tag: one `T.Sprite` with a 256×64 `CanvasTexture` (rounded pill, the name in 28px bold, dark text on `#ffffffcc`), `depthTest:true`, scale 1.6×0.4, 1.1 m above the pose. It is redrawn only when `name` changes and visible when the camera is within 20 m. Dispose it with the mesh.
- Mode switches: keep `prevMode`/`switchAt`. For `BLEND` s, lerp xz/heading/y from a pose scratch of the old mode to the new (positions only, angles via shortest arc). Escort smoothing: an allocation-free critically damped spring on xz (`k = 3/s`: `v += (k*k*(tx-x) - 2k*v)*dt; x += v*dt`), seeded from the current pose on entering escort/call/nudge. In escort, y uses `dolphinMotion` on a 3 s cycle, so it leaps every 3 s.
- Point target (local, from synced data): `site = mods.find(m => (m.name === 'shipwreck' || m.name === 'wreck') && !m.dead)?.site` through `ctx.content?.mods` with optional chaining. The getter is not specified yet; `docs/specs/shipwreck.md` did not exist when this was written, so the builder re-checks it and uses its getter if it defines one. Accept only `{x, z}` with finite numbers in raft frame; otherwise `ctx.world?.signal?.cache` (`{x,z}`, world == raft frame XZ). The wreck wins over the cache. With neither, `hasPoint = false`.
- Chirp: on each leap start (the dolphinMotion phase crossing 0) and when the camera is within 30 m, `ctx.note?.('pipes', 6, s)` then `('pipes', 7, s)` 0.09 s later (a local timer in update), with `s = 0.35*(1-d/30)`. A missing `ctx.note` is a silent no-op. No audio.js edit.
- `update(dt)`: no allocations (scratch objects at module scope); it bails cheaply when `!st.friend` except for the toss hearts.

## Interaction
- Aim test: ray (camera world pos + `aim.dir`, copy gull `camRay`) vs sphere r 1.6 m at the wild circler pose (`ctx.content?.mods.find(m=>m.name==='wildlife')?.circler`, kind 'dolphin', y = waterH + y) within `TOSS_REACH`, or at the friend pose within 12 m.
- `prompt(aim)`. Not friend, wild dolphin aimed: holding `fish` -> `<kbd>E</kbd>Toss a fish · ♥ ${pts}/3`; else muted `A dolphin! Bring it a raw fish`. Friend aimed: within `PAT_REACH` (horizontal) -> `<kbd>E</kbd>Pat ${esc(name)}`; else `<kbd>E</kbd>Rename ${esc(name)}`. Use `oldHost()` -> OLD_HOST (gull `hostHasGull` pattern).
- `interact(aim)` maps to the same targets: `ctx.action({kind:'dolphin.toss'})`, `{kind:'dolphin.pat'}` or open the rename dialog. E goes through interact, not left click, because a left click with fish eats it (`game.js` `isEdible` before `content.use`). Note that `interact()` returns early while diving, so tossing and patting happen at the surface or deck.
- Rename dialog: copy `gull.js` `loadUI/openRename` exactly, with `createAnimalsUI(ctx, {title:'Name your dolphin', kind:'dolphin.name', label:'Dolphin name', domId:'lrDolphin'})` and `u.open('dolphin', st.name)`. Auto-open: when `friend` flips false->true (on host action or net load, not on the first net load) and `st.by === mine`, open it and show the notice "`Name` wants to stay with your raft!".
- `use(aim, kind)`: `kind !== 'conch'` -> false. Not friend -> `ctx.notice('No dolphin friend yet')`, true. Else `ctx.play?.('splash', .5)`, `ctx.action({kind:'dolphin.call'})`, true. The conch is never consumed.

## Host actions (`action(a, actor, bag)`; guests forward, `!isHost()` -> return true)
Actor pose = `actor === 'guest' ? ctx.other : ctx.physics`. A missing guest pose -> refuse; a missing host pose -> allow (gull `near`).
- `dolphin.toss`: the host's wildlife `circler` must be a dolphin and the actor within `TOSS_REACH + HOST_SLACK` (horizontal) of it, then `toss(...)`. On bond: `seed = Math.random()*2**32>>>0`, `name = defaultName(seed)`, `by = actor`, `nextNudge = t + 60`, emit `{kind:'notice', text, sound:'catch'}` to 'all'. Otherwise emit 'notice' with `sound:'collect'` to the actor ("♥ n/3"). Emits without `sound` play 'deny' (`game.js:1028`).
- `dolphin.pat`: friend pose (computed on the host for the host's t) within `PAT_REACH + HOST_SLACK` of the actor -> `pat`.
- `dolphin.name`: `rename`; notice "Your dolphin is now called X" to 'all'.
- `dolphin.call`: `call(st, actor, t)`; notice "`Name` is on the way" to the actor.
- Every change -> `bump()`. Unknown verbs -> true (consumed).

## Host tick (in `update`, host only, once per second via an accumulator)
- Escort: build 2 candidates. Host: `ctx.physics.swimming`, or riding (`peek('paddleboard')?.boards` has `r==='host'`, using that board's x,z). Guest: `ctx.other?.swimming`, or a board with `r==='guest'`. `centre = raftCentre(world.tiles)` (`signal.js:47`). `esc = pickEscort(...)`; `calling()` overrides it. Bump on change.
- Nudge: if `friend && !nudge && t >= nextNudge && behaviour is not call/escort`: `it = pickNudge(world.items, centre, [physics, other], nets)`; if found, `nudge = {tok: it.token, at: t}`; always `nextNudge = nextNudgeAt(seed, t, r)`; bump. Each frame on the host while `nudge`: find the item by token (linear scan, no alloc), `nudgeAbort` -> `nudge = null; bump()`; else `stepNudge(it, centre, dt)` (false -> clear). Only the host writes `it.x/z`, and `hostState()` already ships `items` every 120 ms (the guest eases meshes), so no syncItems call is needed. Guests never touch `world.items`.

## Swim boost (underwater only)
`diveMods(m) { if (boostOn) m.swim *= BOOST; }`. `boostOn` is computed in update: `friend && behaviour ∈ {escort, call} && who === mine && horizontal dist(friend pose, local player) <= BOOST_R`. diving.js clamps to 0.5–2 (:194). It stacks with fins and cookpot meals. **No cookpot or MOVE_MUL change in v1.** Future: a surface boost via a cookpot one-liner `MOVE_MUL.swim = mods.swim * SWIM_BONUS.friend`, and a board boost via a mutable multiplier in `stepRide` (`paddleboard-core.js`).

## Co-op / save
- serialize: host only (`undefined` on a guest). Guest load('net'): `hostHasDolphin = data !== undefined`; on the same `r` only `snap()` the clock (ease 15%, hard snap past 2 s, copy gull :590). Otherwise `st = cleanDolphin(data)`, then detect the friend flip/name change/pops. Guest clock `+= dt` between messages.
- All poses are closed form in `(seed, t)` plus synced `esc/callWho/nudge` and each client's own view of the followed player or item, so the escort pose differs slightly per client (cosmetic); host checks use `HOST_SLACK`.
- Save: `world.ext.dolphin`; an old save -> `load(undefined)` -> not befriended. 'restore' behaves like 'save'.

## FEATURES placement (`dist/content.js`)
Import `import { createDolphin } from './dolphin.js?build=v3-survival-ae77fa84ac2b'; // [dolphin]` before the cookpot import. In FEATURES, insert `createDolphin` **after `createPaddleboard` and before `createCookpot`**: `..., createBuoyCourse, createPaddleboard, createDolphin, createCookpot]`. Buoycourse/paddleboard prompts and E keep priority while riding, and cookpot stays last. Append `; [dolphin] after paddleboard` to the trailing comment. The factory gets `(ctx, { peek })`.

## Debug (`raftDebug.content.dolphin`)
`state()` (deep copy), `get clock`, `mode()` (behaviour), `pose()` (copy of the friend pose), `spawnWild()` (-> `ctx.content.debug.wildlife?.summonCircler('dolphin')`), `befriend(name?)` (host: pts 3, friend, seed, name, by = mine, bump), `advance(sec)` (host: `st.t += sec`, then run the host tick once), `call()` (sends `dolphin.call`), `nudgeNow()` (host: `nextNudge = t`, run the tick, return the picked token or null), `boost()` (the current `boostOn`).

## Tests (`tests/dolphin.test.mjs`, node:test, import `../dist/dolphin-core.js`)
1. `cleanDolphin`: undefined/array/garbage -> defaults; clamps pts/hearts; cooldowns `<= t`; long/HTML name cleaned; friend without name gets the default; `pts:3,friend:false` -> 2; bad `esc/callWho/by` -> ''; `nudge` dropped.
2. Toss: needs a fish (bag stub with `count/remove`), wildNear, 8 s cooldown; the 3rd toss bonds and removes exactly 3 fish; a toss after the bond is refused.
3. Pat: cooldown 60 s, hearts cap 10, `pops` increments only on a heart.
4. Call: refused when not friend; 30 s cooldown; `calling()` lasts 20 s and names the caller.
5. `modeAt` deterministic for the same (seed,t); beat 0 = loop; no 'point' when `hasPoint` false; about 20% point over 1000 beats (±5%).
6. `behaviour` priority: call > nudge > escort > point/show/loop.
7. `pickEscort`: out of water/out of range -> ''; keeps current; host before guest.
8. `pickNudge`: skips cache/bottle/unknown types, items too near/far, near a player, near a net; picks the nearest; non-finite items ignored.
9. `stepNudge` moves toward the centre at 0.6 m/s and stops inside `r+3`; `nudgeAbort` on timeout, a missing item, an approaching player.
10. Poses: `loopPose` same inputs -> same output; radius ≥ 7 + pushOut; `followPose` is 1.8 m to the side; `pointPose` reaches ≤ 14 m out at u = 6; no NaN for `ext` = 0/NaN.
11. `nextNudgeAt` lands in [100, 140] s ahead.
Also re-run `tests/content.test.mjs` (FEATURES count/name uniqueness) and the art/icon tests (SPRITES vs icons.svg).

## Acceptance
`npm test` green; `shoot2.py` errors `[]`. In the browser: `spawnWild()`, hold fish, E ×3 (use `advance(8)` between tosses) -> bond notice + name dialog; the friend loops/leaps near the raft; `swimAt` puts the player in the water and the friend escorts within ~2 m; conch click -> it comes; `nudgeNow()` moves a debris item toward the deck; in co-op loopback a guest toss/pat/call works and both see the same friend.
