# Kite flying (Sky Kite): spec

One builder. Source research: `docs/features/kite-research.md`. The tree is mid-merge (`dist/content.js`, `content-items.js`,
`craft-book.js` and `game.js` are UU), so **re-grep every quoted anchor right before each Edit**, append only, and never reformat.
Cosy and cosmetic: no damage and no fail states. All names and art are original.

## Files
| File | What |
|---|---|
| `dist/kite-core.js` (new, pure, no THREE/DOM) | constants, `cleanKite`, `kitePose`, `easeInputs`, `steerFromYaw`, `anchorOf`, `spotDue`, `pickDebris`, `linePoints`, `tailPoints` |
| `dist/kite-model.js` (new) | `buildKiteMesh(T, p)` (world kite), `createKiteHeld(T, p)` (spool + folded kite), `PATTERNS` colours |
| `dist/kite.js` (new) | `createKite(ctx)` content module, `name:'kite'` |
| `tests/kite.test.mjs` (new) | node:test, imports only `dist/kite-core.js` |
| small appends | `content.js` FEATURES, `content-items.js`, `held-items.js`, `coop.js`, `coop-avatar.js`, `icons.svg`, `survival-ui.js`, `craft-book.js`, one `game.js` contentCtx line |

Ids are all `kite`/`kite_*`/`kite.*`. They do not clash with parallel features (shipwreck `wreck.*`, dolphin `conch*`).
Neither spec exists yet; grep `kite` in `dist/` before you start.

## Items, recipes, icon (`dist/content-items.js`)
- In `CONTENT_ITEMS`, add 3 items written out as `Object.freeze({kind, name, icon:'icon-kite', maxStack:1, tool:false, placeholder:false})`:
  `kite_sunburst` "Sunburst Kite", `kite_gullwing` "Gullwing Kite", `kite_tidestripe` "Tidestripe Kite".
- In `CONTENT_RECIPES`, add one recipe each with `recipe(id, name, 1, cost)`. Sunburst and Gullwing cost `{leaf:4, wood:2, rope:3}`.
  Tidestripe costs `{leaf:4, wood:2, rope:3, paint_lagoon:1}`. This is verified: `paint_lagoon` exists at `content-items.js:39`, from paint.js `PALETTE`.
- `dist/icons.svg`: add one `<symbol id="icon-kite" viewBox="0 0 48 48">` showing a diamond sail, a cross spar and a wavy tail. Use the house stroke style.
- `dist/survival-ui.js`: append `'kite'` to the `SPRITES` Set (anchor `const SPRITES = new Set([`).
- `dist/craft-book.js`: in the group map, next to `brush: 'tools', driftboard: 'tools'`, append
  `kite_sunburst: 'tools', kite_gullwing: 'tools', kite_tidestripe: 'tools',` and add an info entry to each:
  `{desc:'A light leaf-and-spar kite on a long line.', use:'Hold it on deck: click to launch, tug and tie it to a railing.'}`.

## Pure core (`dist/kite-core.js`)
Constants: `LINES=[8,16,24]`, `STEER_MAX=0.9`, `MAX_TIED=6`, `TUG=0.25`, `TUG_T=1.2`, `LAUNCH_T=3`, `REEL_MPS=2`,
`SPOT_MIN=90`, `SPOT_MAX=150`, `SPOT_S=0.85`, `PULL_T=10`, `PULL_MPS=2.5`, `LINE_N=17`, `TAIL_N=8`, `TIE_TYPES={railing:1,pillar:1,gate:1,halfwall:1}`.
- `windOf(sail, weather, out)`: `Wx = sin(windDir)*windStr - vx` and `Wz = cos(windDir)*windStr - vz`. If |W| < 0.3, rescale W to 0.3 along its direction, or use (0, 0.3) when W is zero.
  `out.az = atan2(Wx, Wz)` and `out.s = clamp(|W|*(0.75 + 0.6*weather), 0.3, 1.25)`. When `sail` or `weather` is not finite, fall back to defaults `{windDir:0.6, windStr:0.8, vx:0, vz:0}` and `weather = 0.5`.
- `kitePose(ax, ay, az0, W, L, steer, tug, launch, t, phase, waterY, out)`: closed form, no integrator, writes `out.{x,y,z,yaw,pitch,roll,e}`.
  The azimuth is `a = W.az + steer`. The elevation is `e = (lerp(0.25, 1.05, smooth(clamp((s-0.3)/0.95, 0, 1)))*(0.6 + 0.4*cos(steer)) + tug) * lerp(0.1, 1, launch)`.
  Position: `K = A + L*(cos e*sin a, sin e, cos e*cos a)`. Add wobble `0.5*s*sin(1.3t+phase)` along the side axis `(cos a, 0, -sin a)` and `0.35*sin(0.9t+2*phase)` in y.
  Then clamp `K.y ≥ waterY + 2`. The kite faces A: yaw and pitch come from `A-K`, and `roll = -steer*0.6 + out.dSteer*0.3`, where the caller passes dSteer in through `out`.
- `easeInputs(st, dt)`: frame-rate independent with `k = 1-exp(-rate*dt)`. `st.L` moves toward `st.Lt` at ≤`REEL_MPS*dt`.
  `st.steer` moves toward `st.steerT` with rate 3, and `st.dSteer` is the steer change per second. `st.launch` rises by `dt/LAUNCH_T` up to 1, and falls by `dt/1` while `st.landing`.
  `st.tug` decays linearly to 0 over `TUG_T`. The function returns `true` when a landing has finished (`launch` reached 0).
- `steerFromYaw(camYaw, az, prev)`: `look = camYaw + PI` (the camera looks down -Z) and `d = angDiff(look, az)`.
  If `|d| > 1.6`, return `prev`, so the steer holds while the player looks upwind. Otherwise return `clamp(d, ±STEER_MAX)`. Quantise steer to 0.05 for the network.
- `anchorOf(rec, deckY)`: the piece record `{t,i,j,l,r}` gives a point. Edge `r=0` is at `(2i, 2j-1)` and edge `r=1` is at `(2i-1, 2j)`, verified against `building-pieces.js occupied()`.
  A pillar is at `(2i-1, 2j-1)`. The height is `y = deckY + l*2.2 + (pillar ? 2.0 : halfwall ? 1.1 : 0.95)`. Any other type returns null.
- `pieceKey(rec)`: `t:i,j,l,r`, the same format as paint `pieceKeyOf`. `KEY_RE` is the paint `PIECE_RE`, restricted to the TIE_TYPES.
- `cleanKite(raw, from)` returns `{v:1, rev, fly:{h:null,g:null}, tied:[]}`. It keeps `rev` as a finite int clamped to 0..1e9.
  It keeps `tied` entries `{k, p, L, s}` where `k` matches KEY_RE, `p∈0..2`, `L∈LINES` and `|s|≤0.9`, removes duplicate `k`, and caps the list at 6.
  It keeps `fly.h` and `fly.g` (`{p,L,s}`, same checks) only when `from==='net'`. A save always resets `fly` to null.
- `spotDue(clock, n, seed)`: returns the next threshold `SPOT_MIN + frac(sin((n+1)*12.9898 + seed)*43758.5)*(SPOT_MAX-SPOT_MIN)`. It is deterministic.
- `pickDebris(items, held, cx, cz, out)`: picks the nearest item with `type ∈ {wood, leaf, scrap, plastic, barrel}`.
  This excludes `cache` and `bottle` and any unknown type. It also skips any token in `held` (a Set or null) and any item closer than 14 m or farther than 70 m from (cx,cz). It returns the item or null and does not allocate.
- `linePoints(A, K, L, s, out17)`: a parabola with sag `L*0.05*(1.3-s)`. `tailPoints(K, W, t, out8)` trails downwind of K with a sine travelling along it.
  Both write into a caller `Float32Array`.

## Module (`dist/kite.js`)
- Import `windOf…` from `./kite-core.js` and the models from `./kite-model.js` with no `?build` suffix, the same as neighbouring new modules (check `buoycourse.js`).
  Local state: `st` (eased inputs for my hand kite), `remote` (eased copy for the partner), `tiedViz[]` (up to 6 per-entry meshes and phases),
  and a preallocated `W`, `pose`, line and tail arrays. Weather comes from `ctx.content?.mods.find(m => m.name==='daynight' && !m.dead)?.wind`. Cache the module reference after the first lookup. `debug.setWind` overrides `s`.
- **Held kind**: `const b = ctx.localBag(), k = b?.slots[b.selectedIndex]?.kind ?? null`, copied from paint `heldKind()` (`paint.js:127`). The kind is a kite when `k.startsWith('kite_')`; then `p = ['kite_sunburst','kite_gullwing','kite_tidestripe'].indexOf(k)`.
- **use(aim, kind)** (LMB on press, verified at `game.js:1279`) for `kite_*` kinds only:
  - When nothing is flying, a launch needs `ctx.physics.grounded && !ctx.physics.swimming`. If that fails, show the notice "Stand on the deck to launch".
    Otherwise set `st = {p, Lt:16, L:6, steer:0, launch:0, tug:0}`, call `ctx.play('throw', .5)` and send `ctx.action({kind:'kite.fly', p, L:16, s:0})`.
  - When the kite is flying, LMB is a tug: `st.tug = TUG` and `ctx.play('reel', .4)`. A tug is local only.
  - Return true.
- **alt(aim, kind)** (RMB, `game.js:1685`) while flying cycles `Lt` through 8→16→24→8. Send `kite.fly` and return true. When nothing is flying, return false.
- **interact(aim)** (E): find the target with `ctx.building?.grid.pick(cam…, dir…, ctx.deckY(), 4)`, the same as `paint.js findTarget`.
  When the kite is flying and the target rec type is in TIE_TYPES, send `ctx.action({kind:'kite.tie', k:pieceKey(rec), p, L:st.Lt, s:q(st.steer)})`. Land the kite locally at once, without the reel animation, and return true.
  When a tied entry's key equals the picked key, send `{kind:'kite.untie', k}` and return true. Otherwise return false.
  If `ctx.building` or `grid.pick` is missing, interact returns false and tie-off is simply unavailable. There is no kite-post fallback, because `grid.pick` is verified at `building-pieces.js:323`.
- **prompt(aim)**: return escaped HTML and also register a `raftPrompts` provider `{id:'kite', priority:1}`, copying paint `provide()` and its pickup and guest yield rules.
  The rows are:
  - holding, stowed: `LMB Launch kite`
  - flying: `LMB Tug · RMB Line 16 m`, and `E Tie to railing` when aiming at a valid piece
  - aiming at a tied piece: `E Untie kite`, whether or not a kite is held
- **Auto-land** (local, in `update`): the kite lands when the held kind changes away from that kite, when `physics.swimming`, when `ctx.content.riding()`, or when the item is no longer in the bag.
  Landing sets `st.landing=1` and lasts 1 s. When it finishes, send `{kind:'kite.land'}`. While `ctx.uiOpen()`, freeze the steer target but keep flying.
- **update(dt)** runs on every peer and allocates nothing:
  1. Compute W.
  2. My hand kite: anchor at `ctx.camera.localToWorld(v.set(0.36,-0.30,-0.72))`, then `easeInputs`, then `steerTarget = steerFromYaw(ctx.camera.rotation.y, W.az, st.steerT)`.
     Re-send `kite.fly` when `Lt` or the quantised steer changes, at most every 250 ms.
  3. The remote kite is drawn when `ext.fly[otherRole]` is set and `ctx.other` exists. Anchor it at `other` + yaw-rotated `(0.3 right, -0.25 down, 0.35 forward)`, with `y = other.y`, and ease toward its `{L,s}`.
  4. Tied kites anchor at `anchorOf(rec, ctx.deckY())`. Look up the rec by key in `ctx.world.pieces`, and rebuild the map only when `world.pieces` changes identity.
     Each tied kite uses the entry's `L` and `s`, `launch=1`, and phase `i*1.7`.
  5. Write the pose, line and tail into the meshes. Hide pooled meshes that are not used.
  6. Host only: run prune and the reward tick (below).
- **Hide the folded sail** while my kite flies: `ctx.heldModel?.(kind)?.userData.sail.visible = !flying`. This needs one line in `game.js` contentCtx, next to `get brush()` (anchor `get brush() { return hands?.itemModel('brush') ?? null; }`): add
  `heldModel: k => hands?.itemModel(k) ?? null, heldTokens: () => allHeldTokens(), // [kite]`. Both helpers are optional-chained, so the kite still works without them.

## Actions (host-authoritative, `action(a, actor, bag)`)
- `kite.fly {p,L,s}`: the actor's bag must hold `KINDS[p]`, `L∈LINES` and `|s|≤0.9` (quantise s). Set `ext.fly[actor==='host'?'h':'g']` and do not bump rev, because fly changes often and goes out in hostState anyway. Return true.
- `kite.land`: clear the actor's slot.
- `kite.tie {k,p,L,s}`: the action is valid only when the piece `k` exists in `world.pieces` and its type is in TIE_TYPES, `k` is not already tied, `tied.length < 6`, and `bag.remove(KINDS[p], 1)` succeeds.
  When valid, push the entry, clear the actor's fly slot, `rev++`, and `ctx.emit({kind:'notice', text:'Kite tied off. It will fly on its own.'}, actor)`.
  Otherwise emit a notice explaining why: "That spot already has a kite", "Six kites is plenty", or "Hold the kite you want to tie".
- `kite.untie {k}`: find the entry. `bag.add(KINDS[e.p], 1)` returns the leftover; when the leftover is 1, emit "Bag full" and keep the entry. Otherwise splice the entry out and `rev++`.
- Host housekeeping: when `ctx.other` is null, clear `fly.g`. When `world.pieces` changes identity, prune entries whose piece is gone. Each pruned kite goes back to the host bag through `add`, and nothing is lost if the add fails: the kite just vanishes. Then `rev++`.
- Guests never mutate the slice. Their local `st` is input only, and drawing their own kite never waits for the echo.

## Save and co-op sync
- `serialize()` returns `{v:1, rev, fly, tied}`. `load(d,'net')`: skip when `d.rev === netRev`, apart from copying `fly`, which is cheap. Otherwise `cleanKite(d,'net')` and rebuild `tiedViz`.
  `load(d)` from a save gives `cleanKite(d)`, with `fly` null. `load(undefined)` gives an empty slice. Old saves have no `ext.kite`, which is fine.
- Remote held prop: the game sends `held` as the raw kind string (`game.js pose()`, sliced to 16; `kite_tidestripe` is 15 characters, which fits). `coop-avatar` builds the prop from `BUILD[kind]`.
  - `dist/coop-avatar.js`: add `kite_sunburst`, `kite_gullwing` and `kite_tidestripe` to `BUILD`, all calling one helper `(g,K)`.
    The helper builds a spool cylinder and a small diamond in the pattern colour, at most 3 boxes or cylinders. Also add `TOOL_TILT` entries of `1.2` for the same three kinds.
  - `dist/coop.js` `HELD`: append `'kite_sunburst','kite_gullwing','kite_tidestripe'` at the end of the array, replacing nothing, and add the comment `// [kite] 21-23`.
    Before editing, check that the last entry is still `'metalspear'` (index 20). If other appends exist (for example spyglass at 21), append after them and correct the comment.
    Add a test asserting `HELD.indexOf('kite_tidestripe') === HELD.length - 1 && HELD.indexOf('metalspear') === 20`, which proves the append kept the old indices.

## Small reward (host only)
`spotClock` increases by dt while any kite (the host's hand kite, a guest's `fly.g`, or a tied kite) has `L === 24` and `W.s > SPOT_S`. Otherwise it holds and does not reset.
When `spotClock ≥ spotDue(…, n, worldSeed)` and there is no active pull:
1. Pick `it = pickDebris(world.items, ctx.heldTokens?.() ?? null, 0, 0)`. If `heldTokens` is missing, also skip items within 10 m of either player.
2. If no item is found, set `n++` and wait for the next threshold.
3. Otherwise set `pull = {token, t:0}` and the target `P` = the raft edge in the item's direction + 6 m (radius = max tile |x|,|z|·2 + 1).
   Emit `{kind:'notice', text:'Your kite spots driftwood off the bow!'}` to `'all'`, then `n++` and `spotClock = 0`.

Every host frame, move the pulled item (found again by token with a `for` loop) toward P at `PULL_MPS*dt`, on top of normal drift.
End the pull when the item is within 1 m, when `t > PULL_T`, when the item is gone, or when its token is in `heldTokens`. Item positions reach guests through hostState `items`, so no sync work is needed.
At most one spot per 90 s. Nothing is saved: `spotClock`, `n` and `pull` are runtime only.

## Model budget (`dist/kite-model.js`)
- World kite: one merged `BufferGeometry` with vertex colours. The sail is a diamond of 4 tris, double-sided through `side:DoubleSide`. Add 2 spar boxes (24 tris) and a 2-tri bridle wedge, for ≤32 tris.
  It uses 1 shared `MeshLambertMaterial({vertexColors:true, side:DoubleSide})`, with `castShadow=false`.
- `PATTERNS`: Sunburst is coral and sunshell rays, Gullwing is white with slate wing tips, and Tidestripe is lagoon and seafoam bands.
- String: `T.Line` with 17 points (`LineBasicMaterial`, `#3b3126`, `transparent .85`). Tail: `T.Line` with 8 points in the pattern accent colour, in one shared material per pattern.
  That is 3 draw calls per kite. The worst case is 2 flying + 6 tied = 24 calls, and the typical case is about 6. Pool the meshes and create them lazily up to the 8 slots, and set `frustumCulled=false` on lines, because their bounds change every frame.
- Held model `createKiteHeld(T,p)`: a spool (cylinder with 12 segments) plus a folded kite (a slim diamond prism) of ≤80 tris. Put the sail part at `userData.sail` and set `userData.size` and `userData.grip`, following the spade/finder pattern.
- `dist/held-items.js`:
  - Import `createKiteHeld`.
  - Add `kite_sunburst`, `kite_gullwing` and `kite_tidestripe` to `HOLD`, each with `{hand:'right', pose:'grip', rx:0.3, rz:0.2}`.
  - Add a `buildItemModel` branch `else if (kind.startsWith('kite_'))`. It mirrors the spade/finder branch at scale 0.5 and sets `root.userData.model = m`.
- `dispose()`: dispose the geometries and materials that the module owns and remove its meshes from the scene.

## Debug (`raftDebug.content.kite`)
| Helper | What it does |
|---|---|
| `fly(p=0, L=24)` | gives the item if it is missing, then launches. The host gives via `localBag().add`. |
| `land()` | lands the kite |
| `tie(key?)` | ties to the given key, or to the first railing or pillar in `world.pieces` |
| `untie(k)` | unties the entry at key `k` |
| `setWind(s\|null)` | overrides strength `s` |
| `forceSpot()` | sets `spotClock` to the threshold |
| `state()` | returns `{fly, tied, st:{L,steer,launch}, spotClock, pull}` |
| `pose()` | returns the last pose of my kite |

## Tests (`tests/kite.test.mjs`, core only)
1. `windOf`: apparent wind subtracts raft velocity; min-0.3 clamp; `s` bounded to 0.3..1.25, with calm weather lower than breezy; NaN inputs fall back.
2. `kitePose`: deterministic; |K-A| ≈ L before wobble (within 1 m); elevation rises with `s`; `e` drops at |steer| 0.9 compared with 0; y never below waterY+2; outputs finite for extreme or NaN inputs.
3. `easeInputs`: 1×1 s and 100×0.01 s steps end within 2%; L moves at ≤2 m/s; launch reaches 1 after 3 s; landing returns true at 0; tug is 0 by 1.2 s.
4. `steerFromYaw`: clamps to ±0.9; holds `prev` when facing upwind; looking left of downwind steers left.
5. `anchorOf`: edge r0 and r1, pillar and level offsets, and null for a floor.
6. `cleanKite`: junk gives an empty slice; bad keys, p, L and s are dropped; duplicate keys removed; caps at 6; a save drops fly, a net load keeps it; rev clamped.
7. `spotDue`: deterministic and always within 90..150.
8. `pickDebris`: excludes cache, bottle, unknown types and held tokens; respects 14..70 m; returns the nearest.
9. `linePoints` and `tailPoints`: endpoints equal A and K, the line sags below the chord, no NaN.
10. `HELD` append check (import `dist/coop.js` only if it is side-effect-free under node; otherwise read the file and regex the array).

## Acceptance
- `npm test` is green.
- `shoot2.py` reports `errors: []`.
- `raftDebug.content.kite.fly(1)` shows a kite downwind at about 24 m that rises in breezy weather. `tie()` keeps it flying with no item in hand. After save and reload the tied kite is still there.
- In co-op through `coop2.mjs`, each peer sees the other's kite. A guest's tie and untie round-trip through the host.
