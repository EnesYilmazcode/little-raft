# Spec: Kelp Line

Source: docs/features/kelp-research.md (anchors re-checked on this branch). Cozy rules: the line never breaks, rots or drifts, nothing is lost.
A short post with a cleat on a raft edge tile; a rope runs out over the open side to 3 floats, and seaweed strands hang under them in the water. It ripens in 3 visible stages over about 3 minutes and stays lush until E harvests it.
Modelled on the Fish Trap (dist/fish-trap.js). New files: `dist/kelpline-core.js` (pure: no DOM, THREE, Date or Math.random), `dist/kelpline.js` (content module, name `'kelpline'`), `dist/kelpline-model.js` (given THREE, imports nothing). Import with `?build=v3-survival-ae77fa84ac2b`. Tag every hook line `// [kelpline]`.
kelpline-core.js imports `isEdgeTile, openSide, tileKey` from `./fish-trap.js` (its top half is pure; do not copy them).

## 1. Item, recipe and boilerplate
- items.js, after the fishtrap row (`:273-274`): `item('kelpline', 'Kelp Line', 'decor', { placeable: true, iconTint: '#4f9a5c', recipe: hand({ wood: 2, rope: 3, plastic: 1 }), unlock: discover('seaweed'), tip: 'A float line off the raft edge. Seaweed grows on it while you sail.' })`.
- `BLOCK_RADII` (`items.js:341`, after `fishtrap` at `:350`): `kelpline: 0.2` (tests/progression.test.mjs:120,123).
- craft-book.js: tab `kelpline: 'survival'` after `:29`. ITEM_TEXT after `:177`: `kelpline: { desc: 'A float line with seaweed strands.', use: 'Place on an edge tile. Harvest lush seaweed with E.' }`. A crafted item gets its source from the recipe (`sourceOf`, `:503`). Change the seaweed source (`:457`) to `how: 'Hook floating barrels, or grow it on a Kelp Line.'` (tag stays `'barrels'`). Add to seaweed `use` (`:100`): `'Quick fuel for the grill and smelter, or mulch for a crop plot.'`.
- item-svg.js, after the `fishtrap` icon (`:508+`): an original icon: a post with a rope to three round floats, with three wavy green blades hanging below.
- live.js PRELOAD (`:23`, after `'fish-trap.js' /* [fishtrap] */`): `'kelpline-core.js', 'kelpline-model.js', 'kelpline.js' /* [kelpline] */` (tests/live-preload.test.mjs).
- build-rules.js `BLOCK_TEXT` (after `:22`): `kelpedge: 'Kelp lines hang on an edge tile, next to open water'`. game.js already routes `content.placeBlock` at `:1118, :1134, :1294`, so game.js needs no edits.
- content.js: import beside `:84` and append `createKelpLine` to the end of `FEATURES` (`:94`) as a separate `FEATURES.push(createKelpLine); // [kelpline]` line. Do NOT add `kelpline` to `NO_UNDECOR` (`:97`); the module implements the undecor hooks (section 6).

## 2. Placement (edge tile, open side)
- `placeBlock(kind, x, z)` returns `'kelpedge'` for `kind === 'kelpline' && !isEdgeTile(ctx.world.tiles, x, z)`, else null.
- Facing: same as the fish trap. Scan `ctx.raft.children` for `craft_kelpline` groups (rescan when the children length or `children[0]` changes) and set `g.rotation.y = atan2(dx, dz)` from `openSide(tiles, x, z, d.rot)`. With no open side, keep `d.rot`.
- If floor later closes the open side, the line stays and **freezes** (section 3). It is never deleted.

## 3. State `world.ext.kelpline` and growth (kelpline-core.js)
`{v:1, s, r, t:{"x,z": g}}`. `s` is the session id, `r` the revision, and `g` an int of growth points in `1..LUSH_AT`. A missing key means bare (g = 0).
- Constants: `GROW_PTS = 4` (points per second), `SUN_PTS = 5` (+25 %), `LEAFY_AT = 240` (60 s), `LUSH_AT = 720` (180 s), `YIELD = 2`, `TRAP_BONUS = 1`, `MAX_TICK = 60`, `REACH = 2.6`, `HOST_SLACK = 2`, `OVERHANG = 1.2`, `MAX_LINES = 400`.
- `STAGES = ['Bare', 'Leafy', 'Lush']`; `stageOf(g)` = `g >= LUSH_AT ? 2 : g >= LEAFY_AT ? 1 : 0`.
- `cleanKelp(v, decor)`: junk gives `{v:1, s:'', r:0, t:{}}`. `s` is a string of at most 32 chars, `r` an int >= 0. Keys must match `/^-?\d+,-?\d+$/` round trip (fish-trap `isKey`) and have a `kelpline` decor at that tile. `g` is clamped to an int in `0..LUSH_AT`; 0 is dropped. At most `MAX_LINES` entries. Inner (non-edge) lines are kept.
- `tickKelp(st, tiles, decor, dt, sunny)`: `n = clamp(floor(dt), 0, MAX_TICK)`. Prune keys without decor (bump `r`). For each `kelpline` decor **in decor order** that is an edge tile (fish-trap `edgeIn` style, one tile Set per tick): if `g < LUSH_AT`, `g = min(LUSH_AT, g + n * (sunny ? SUN_PTS : GROW_PTS))`. Bump `st.r` **only when `stageOf` changes** (or on a prune). Returns `{ripe:[keys that just reached Lush]}`. A non-edge line is untouched (frozen, not lost).
- `kelpInfo(st, tiles, decor, x, z)` returns `{g, stage, pct, edge, bonus}` or null when there is no line. `pct = min(99, floor(g / LUSH_AT * 100))` below Lush. `bonus` is true when a `fishtrap` decor is within 1 tile (Chebyshev: `max(|dx|,|dz|) <= 1`, not the same tile).
- `yieldFor(decor, x, z) = YIELD + (bonus ? TRAP_BONUS : 0)`.
- Sunshine (host only, computed in the module): `sunny = env.night() < .5 && rain < .2`, where `env` comes from the `link(env)` hook (content.js:134-137) and `rain = peer('daynight')?.rain` (daynight.js:782). If `rain` is not finite, `sunny = false`. Never block growth on these getters.

## 4. Harvest (all or nothing)
`harvest(st, decor, key, bag)` returns `{ok:true, n, text}` or `{ok:false, reason:'notarget'|'notripe'|'full', text}`.
- No line: `notarget` ("Nothing to harvest"). `stageOf(g) < 2`: `notripe` ("Still growing"). Snapshot bag `s = new bag.constructor(bag.snapshot())`; only when `s.add('seaweed', n) === 0` copy `s.slots` into `bag.slots` (bump `bag.version`) and `delete st.t[key]` (back to Bare). Otherwise `full` ("Your bag is full") and the line stays Lush.
- Allowed on a blocked (non-edge) line that is already Lush. Text `+ N seaweed from the kelp line`.

## 5. Module (dist/kelpline.js): prompts, interact, host actions
- `target(aim)`: copy fish-trap `target` (fish-trap.js:176-198) aiming at the overhang point `(x*2 + dx*OVERHANG, raft.y + .05, z*2 + dz*OVERHANG)`, or the tile centre when no side is open. Reach `REACH` from the player.
- `prompt(aim)` (static text, no user strings): old host `OLD_HOST = 'Your friend’s raft doesn’t have kelp lines yet'`; Lush `<kbd>E</kbd>Harvest seaweed (N)`; not edge `Kelp line: it needs open water beside it`; else `Kelp line: ${stage}… ${pct}%` (host), or `Kelp line: ${stage}…` on a guest (guests only track stages, section 7). Content `prompt()` is bridged by game.js `raftPrompts.provide({id:'content'})` (game.js:780), so no own provider.
- `interact(aim)`: no target returns false. Old host or not-edge-and-not-Lush: `ctx.notice(text, 2400)`. Lush: `ctx.action({kind:'kelpline.harvest', x, z})`. Else `ctx.notice('Still growing')`. True in all those cases.
- `action(a, actor, bag)`: claims `kind.startsWith('kelpline.')`. `x`, `z` must be ints with a line there. Pose `actor === 'guest' ? ctx.other : ctx.physics`; reject (return true, no change) when farther than `REACH + HOST_SLACK` from the overhang point. `kelpline.harvest`: on ok `st.r++`, emit `{kind:'loot', text, loot:{seaweed:n}}` to the actor; else `{kind: reason === 'full' ? 'full' : 'notice', text}`. Unknown subkinds do nothing.
- `update(dt)`: paint on every client. Host tick only when `ctx.running && ctx.role !== 'guest'`, on a 1 Hz clock; `ripe.length` emits `{kind:'notice', text:'A kelp line is lush'}` to `'all'`.
- `debug`: `state()`, `lines()`, `target(aim)`, `place(x, z, rot)`, `fastForward(sec, sunny = false)` (MAX_TICK chunks), `ripen(key)`.

## 6. Undecor (hammer X)
- `beforeUndecor(d)`: null (never busy).
- `undecorLoot(d)`: for `d.type === 'kelpline'` and a Lush entry, `[['seaweed', yieldFor(decor, d.x, d.z)]]`; else `[]`. Must not mutate. A Bare/Leafy line refunds only the item (growth is not seaweed yet; accepted, and the prompt shows the %).
- `afterUndecor(d)`: `delete st.t[key]`, `st.r++`. Old hosts are covered by the decor-pickup `caps:{undecor:1}` guard.

## 7. Net, save and the old-host guard
- `r` bumps on stage change, harvest, prune and undecor only, so guests (`load(...,'net')` ~8x/s) re-clean only a few times per line per 3 minutes. `'net'`: skip when `data.r === netR && data.s === netS`; `hostHasLine = data !== undefined` (dedupe a repeated undefined). Never rebuild meshes in `load`.
- `serialize()` cache: key it on an internal `ver` counter (not saved) that bumps on every growth change, NOT on `r`, so saves always carry the current `g`. `load('save'|'restore')`: `st = cleanKelp(data, decor)`, `st.s = session`, `st.r++`.
- Guest: never ticks; shows stage from `stageOf(g)` of the last accepted slice (stale `g` within a stage is fine).
- **OLD_HOST:** a new guest whose host has no `ext.kelpline` sees the OLD_HOST prompt and bare strands, and never sends `kelpline.*`. Mixed-version co-op is unsupported (say so in the PR).
- Saves: an old save has no slice, so `cleanKelp(undefined)` gives defaults. An old build loading a new save drops the decor and the unknown bag kind (accepted, as the fish trap).

## 8. Model (dist/kelpline-model.js) and visuals
- seafloor.js: export the existing `seaweedGeometry` (`:272`, add `export`; no other change). kelpline.js builds it once (lazily, with `ctx.T`) and passes it in: `createKelpLine(T, weedGeo)` returns Group `craft_kelpline` (origin at floor top, water out local **+z**).
  - static, merged vertex-coloured: post (box .08 x .45 x .08, #8a6640) at z .6 with a cleat (box .18 x .04 x .05), and a rope (cylinder r .012, #d8c39a) sloping from the cleat to (0, -.18, OVERHANG + .3).
  - `floats`: Group of 3 floats (squashed spheres r .09, alternating #e9e4d4 / #d9774a, the plastic) at z `OVERHANG, +.3, +.6`, y about -.2 (on the waterline; check in shoot.py).
  - `strands`: 3 meshes sharing `weedGeo` and one `MeshStandardMaterial({vertexColors:true, side:DoubleSide, roughness:.8})`, hung under each float with `rotation.x = Math.PI` (blades hang down), and `tuft`: one upright small strand above the middle float, visible only when Lush.
- `paintKelp(g, stage, elapsed, phase, move)`: on `userData.sig !== stage` set the strand scale (Bare .18, Leafy .4, Lush .6; xz .5) and `tuft.visible = stage === 2`. When `move`: sine bob per float `y = base + .025*sin(elapsed*1.3 + phase + i*.9)`, strands follow their float, `rotation.z = .08*sin(elapsed*.8 + phase + i)`. No ocean sampling, no allocation.
- Per frame paint only lines within 30 m and in the frustum (fish-trap.js:215-230). `phase = (x*7 + z*13) % 6.28`. Old host: stage 0. `decorModel('kelpline')` returns the model (ghost and rebuildRaft already reach it).

## 9. New use: kelp mulch for crop plots (dist/crops.js, tag `// [kelpline]`)
A slot gets optional field `m` (1 = mulched). Mulch costs 1 seaweed, needs a planted, not-ripe, unmulched slot, and gives +1 crop at harvest. It does not replace water.
- `cleanSlot` (`:39-43`), exact backward-compatible change: keep the return shape and add `m` only when set:
  `const out = { c: v.c, g, w: g >= CROPS[v.c].grow ? 0 : clampInt(v.w, 0, WATER_SECONDS) }; if (v.m === 1) out.m = 1; return out;`
  Old saves and existing deepEqual tests are unchanged (no `m` key). Old builds drop `m` and only lose the bonus.
- `applyCrop` (`:100+`), new branch before the harvest branch: `crops.mulch`: `!s.c` -> `empty`; `isRipe(s)` -> `ripe`; `s.m === 1` -> new `TEXT.mulched = 'Already mulched with kelp'`; `bag.count('seaweed') < 1 || !takeOne(bag, 'seaweed')` -> new `TEXT.noweed = 'You need seaweed for mulch'`; else `s.m = 1`, `{ok:true, kind:'build', text:'Mulched with kelp: +1 at harvest'}`.
- Harvest: `const n = YIELD + (s.m === 1 ? 1 : 0)` replaces `YIELD` in the add, text and loot. `emptySlot()` already clears `m`.
- `useFor` (`:217`): accept `kind === 'seaweed'`: empty slot notice `TEXT.empty`, ripe `TEXT.ripe`, mulched `TEXT.mulched`, else `{a:{kind:'crops.mulch', ...at}}`. `claims` (`:281`): add `|| kind === 'seaweed'`.
- `slotPrompt` (`:133`): after the ripe line, `if (held === 'seaweed' && s.m !== 1) return ['Click', \`Mulch the ${name.toLowerCase()} with kelp\`];`. Growing lines get ` · mulched` when `s.m === 1`.
- Sync: `d.crop` already reaches guests through decor, hidden from the rebuild check by `withoutCrops` (game.js:2147), so no game.js change. Visual (optional): a dark green ring on the soil of a mulched slot in crops-model.js.

## 10. tests/kelpline.test.mjs (node:test, `RAFT_DIST` base, bag helpers as fish-trap.test.mjs)
1. `cleanKelp`: junk gives defaults; bad keys, floats, negatives, `g > LUSH_AT` are dropped or clamped; tiles without decor pruned; an inner line kept.
2. Tick: Bare to Leafy at 60 s (not 59), Lush at 180 s; sunny Lush at 144 s; `r` bumps exactly twice over a full grow (stage changes), not per second; a Lush line stays Lush after 1e5 s; non-edge line frozen with `g` kept; `dt` .9 is 0, 1e6 clamps to 60; decor-order determinism (same inputs, `deepEqual`).
3. Harvest: Lush gives +2 seaweed and Bare; fish trap at a diagonal neighbour gives 3, two tiles away gives 2; full bag gives `full` with bag snapshot and `g` unchanged; Leafy gives `notripe`; no line `notarget`; a blocked Lush line still harvests.
4. Module (stub ctx as fish-trap test): `placeBlock('kelpline')` is `'kelpedge'` on the 3x3 centre, null on the rim and for other kinds; out-of-reach / non-int actions change nothing; `load(same,'net')` twice is a no-op; `load(undefined,'net')` shows OLD_HOST and `interact` sends no action; serialize after a growth second carries the new `g` while `r` is unchanged; `undecorLoot` gives `[['seaweed',2]]` when Lush, `[]` otherwise; `afterUndecor` deletes the key and bumps `r`; `promptFromHtml` gives key `E` for harvest and muted for growing.
5. Model with vendored THREE and the exported `seaweedGeometry`: has `floats` (3), `strands`, `tuft`; `paintKelp(...,2,...)` shows the tuft; floats centre z > 1; bounds fit 0.6 x 1.0 x 2.2.
6. Items: `kelpline` crafts from `{wood:2, rope:3, plastic:1}`, unlock discovers seaweed, `BLOCK_RADII.kelpline` exists, book desc/use present, seaweed source mentions the Kelp Line.
7. Mulch (add to tests/crops.test.mjs): `cleanSlot` keeps `m:1`, drops `m:2`/`'1'`, and an old slot has no `m` key; `crops.mulch` takes exactly 1 seaweed; double mulch, ripe and empty slots refuse with no bag change; mulched beet harvests 3, unmulched 2.

## 11. QA plan
- `npm test` all green (known flaky: art.test.mjs atlas timing under parallel load; rerun alone).
- shoot.py (`/usr/bin/python3.13 …/scratchpad/shoot.py dist <out>`): `errors: []`. Probe via `raftDebug.content.kelpline`: `place` on a rim tile, `fastForward(60)` (Leafy), `ripen(key)`, walk to the edge, read `#lrPrompt` "E Harvest seaweed (2)", press E (+2 seaweed, stage Bare); place a fish trap beside it, ripen, harvest 3. Side shot from the water: floats on the waterline, strands below, tuft above at Lush; three stages readable.
- Try to place on a centre tile: red ghost with the `kelpedge` text. Build floor on the open side: prompt shows the blocked line, growth frozen, a Lush line still harvests.
- Mulch: plant a beet, hold seaweed, click: "Mulched with kelp"; water, ripen, harvest 3 beets.
- Hammer X on a Lush line: item + seaweed refunded; on a Bare line: item only. Reload a save: stages and `m` persist; an old save loads clean.
- Co-op loopback: guest sees stage changes, harvests within reach, is refused out of reach; guest on a host without the slice sees OLD_HOST.
