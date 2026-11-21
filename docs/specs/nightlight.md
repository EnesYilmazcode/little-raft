# Night light: Hand Lantern + Firefly Jar (spec)

Research: docs/features/nightlight-research.md (anchors re-checked on the current tree). Tag every line touched outside
the new files with `// [nightlight]`. No new npm deps. No new Light objects of any kind; no world.ext slice.

## Decisions
- **Hand Lantern** (`handlantern`): items.js `category:'tool', stack:1`, no `tool:true` (no durability, no fuel, never
  wears, like Binoculars items.js:160). It is a **normal right-hand held item** in the hotbar, not a left-hand
  off-hand. Why: the hotbar already decides "what am I holding", the partner learns it from the synced held kind
  (coop.js `HELD`, game.js `validPose().held`), both avatars already render one held kind, and an off-hand would need
  a second held slot in the viewmodel, the pose format and the wire. Cost: no hook in the other hand; at night you
  swap with a number key, which is a fine cosy trade. Not placeable (not in PLACEABLE_KINDS).
- **Light**: carried lights are extra prioritized sources in the existing daynight pool (daynight.js:386-410). Local
  carried light takes slot 0; the partner's carried light (derived from `ctx.other.held`) takes the next slot; placed
  lanterns fill the rest by distance. On `low` (1 slot) the deck lanterns keep only their emissive glow: accepted.
- **Firefly Jar**: craft an empty **Glass Jar** (`jar`), hold it, press E near an island at dusk/night: a host action
  swaps it for a `fireflyjar`. The jar is placeable decor lit through the pool name convention. Plus one cheap
  `THREE.Points` swarm (40 points, unlit) around the island at night.

## Items (dist/items.js, progression system; it owns the crafting UI)
| id | name | category | stack | recipe | unlock |
|---|---|---|---|---|---|
| handlantern | Hand Lantern | tool | 1 | hand `{wood:1, scrap:2, rope:1}` | `discover('scrap','rope')` |
| jar | Glass Jar | refined | 10 | hand `{glass:1, rope:1}` | `discover('glass')` |
| fireflyjar | Firefly Jar | decor | 10, `placeable:true` | null (caught) | START |
Tips (>10 chars): "A little tin lantern on a loop. Hold it at night and the deck glows around you.", "An empty glass jar.
Hold it near an island after dusk and press E to catch fireflies.", "A jar of sleepy fireflies. Place it on the
raft for a soft green-gold glow." `iconTint`s `#ffc76a`, `#bfe6ef`, `#d8ff6a`; all `placeholder:true`.
- `BLOCK_RADII.fireflyjar = 0.1` (items.js:241, every placeable needs one).
- item-svg.js `ITEM_ICONS`: `handlantern`, `jar`, `fireflyjar` (simple stroke drawings next to `candle` :319).
- craft-book.js: `CATEGORY` handlantern 'tools', jar/fireflyjar 'survival' (:20-23); `ITEM_TEXT` desc+use for all
  three (survival.test.mjs:555 requires it).
- tests/progression.test.mjs:191 reachability loop: add `if (have.has('jar') && !have.has('fireflyjar')) { have.add('fireflyjar'); changed = true; } // [nightlight] caught at night`, like the honey line.

## Models (dist/nightlight-models.js, pure THREE, no imports besides what the factory receives)
- `createHandLantern(T)`: wire loop handle, tin cap and base (merged, vertexColors MeshStandardMaterial), glass box
  (transparent .35, its own material) and a glow sphere named `handLanternGlow` using `heldGlowMaterial(T)`: one
  module singleton MeshStandardMaterial `{color:#fff0c8, emissive:#ffb050, emissiveIntensity:.6}` that
  nightlight.js scales at night. `userData.grip` at the loop top, `userData.size`, height ~0.28 m.
- `createFireflyJar(T)`: group **name `craft_lantern`** (so daynight.js:437 scans it, like kiln glasslamp),
  `userData.craftType='fireflyjar'`. Children: cork + twine (merged, `jarCork`), glass cylinder `jarGlass` (not in
  LANTERN_PARTS, so it is not tinted amber), glow sphere **`lanternGlow`** (emissive `#c8f060`, .9) placed so its
  bounding-sphere centre sits ~0.22 m above the deck (candle lift lesson, bees-model.js:163), and `jarBugs`: 6 tiny
  emissive spheres merged into one mesh (`#e8ff7a`). Glass and glow materials cloned per instance (daynight scales
  base emissive per material, kiln-model.js:142). Budget: <= 400 triangles, <= 4 meshes.
- `createSwarm(T, n=40)`: `THREE.Points` + `PointsMaterial({size:.09, color:#d8ff6a, transparent, opacity:0,
  blending:Additive, depthWrite:false, toneMapped:false})`, `frustumCulled=false`, name `nightlight-swarm`.

## Hooks (exact)
- **daynight.js**
  - Export `DAYNIGHT_CARRY = { want:false, local:{on:false,x:0,y:0,z:0}, partner:{on:false,x:0,y:0,z:0} }` next to
    `DAYNIGHT_LIVE` (:32) and `CARRY_PEAK = 1.6` next to `POOL_PEAK` (:265; must stay < POOL_PEAK).
  - Export pure `planPool(cap, localOn, partnerOn, picks, out)`: writes `out[0..cap)`; `-2` local, `-3` partner,
    `>=0` lantern index taken in order from `picks` (skipping `-1`), `-1` empty. Returns the filled count. No allocation.
  - Before `sizePool()` in applyVisuals (:610): `if (DAYNIGHT_CARRY.want) poolWanted = true;`.
  - Pool loop (:612-620): call `planPool(poolOn, carry.local.on, carry.partner.on, poolPick, slotSrc)` (slotSrc is an
    Int32Array(POOL_LIGHTS) built once); for `-2/-3` copy the world position from the carry entry and set
    `intensity = poolI * CARRY_PEAK / POOL_PEAK * (0.96 + 0.04*sin(time*6.1 + slot))`; lanterns unchanged.
    `castShadow` stays false; count still only changes in sizePool().
  - `debug.state()` adds `poolCarry` (slots given to carried lights).
  - `createDayNightOff` untouched: with `?daynight=off` the carry registry is written but never read; no errors.
- **content.js**: import `createNightlight` from `./nightlight.js?build=...` and put it in FEATURES **before**
  `createDayNight` so the carry registry is fresh for the same frame.
- **coop.js:27-28** `HELD`: append `'handlantern'` at the end (index 21), update the comment (`[nightlight] 21`).
- **held-items.js**: `HOLD.handlantern = { hand:'right', pose:'grip', rx:0.1, arm:[0,0.02,0] }`, `SIZE.handlantern
  = 0.2`; a `kind === 'handlantern'` branch in `buildItemModel` (next to spade/finder :250) using createHandLantern.
- **coop-avatar.js** BUILD (:31-125): `handlantern(g,K)` low-poly box + `K.glow` sphere, return tip; `TOOL_TILT
  .handlantern = 0.25` (hangs down). **avatar.js** BUILD (:245): same tiny lantern for the legacy friend.
- **game.js**: none (contentCtx already gives `other`, `physics`, `camera`, `localBag`, `actorBag`, `deckY`).

## Module (dist/nightlight.js, `name:'nightlight'`)
Imports: `DAYNIGHT_LIVE, DAYNIGHT_CARRY, lightAt` from daynight.js, `islandNow` from islands.js (same `?build=`
specifiers as content.js), models file. Exports pure helpers for tests: `CATCH_REACH = 6`, `catchWindow(phase)`
(`phase >= 0.64 || phase < 0.03`), `canCatch({ready, phase, island, x, z, jars, wait})` -> `null` or one of
`'nojar' | 'day' | 'noisland' | 'far' | 'wait'` (island needs `phase !== 'gone'`, reach `hypot(x-cx, z-cz) <=
R + CATCH_REACH`; `ready:false` (daynight off) -> `'day'`), `carryPoint(cam, out)`.
- **update(dt)** (no allocation): `nf = lightAt(DAYNIGHT_LIVE.phase, tmp).nightFactor` when ready else 0.
  - Local on = `ctx.running && selected kind === 'handlantern'`; point = camera position + (0, +0.22, 0) + flat
    forward x 0.3 m (well above the viewmodel hand, so neither the hand nor the view washes out).
  - Partner on = `ctx.other?.held === 'handlantern'` and within 40 m of the camera; point = `(o.x, (o.y ?? deckY()+1.6)
    + 0.15, o.z)` (`o.y` is eye height, as coop.js renders `s.y - 1.6` for the feet).
  - Every 1 s: `DAYNIGHT_CARRY.want ||= localBag().count('handlantern') > 0 || partner on`. So the pool attaches
    (one-off shader link) when the lantern is first crafted, not when it is first lit or equipped.
  - `heldGlowMaterial(T).emissiveIntensity = 0.6 + 2.0 * nf`.
  - Swarm: island = islandNow(); visible-lit when island and nf > 0.2; opacity `0.9 * smooth(0.2, 0.6, nf)`, else 0.
    The Points object is always in the scene (added once in the factory, frustumCulled false) so its program links on
    frame 1. Points are seeded from the island seed in a ring R*0.5..R+3, height gy+0.4..2.4; CPU drift (sin/cos per
    point, 40 points) only while opacity > 0; `position.set(cx, 0, cz)`.
  - Jars: list of raft children with `userData.craftType === 'fireflyjar'` (rebuilt in `afterRebuild`, cap 32);
    while nf > 0.1 spin each `jarBugs` mesh `rotation.y += 0.6*dt` and bob it +-0.01 m.
- **interact(aim)**: only when the selected kind is `jar`: if `canCatch(local)` is null, `ctx.action({kind:
  'nightlight.catch'})`, `ctx.notice('You scoop up a few fireflies.')`, return true; otherwise return false (E keeps
  its normal meaning).
- **prompt(aim)**: holding `jar` near an island: null reason -> `<kbd>E</kbd>Catch fireflies`; `'day'` -> muted
  `Fireflies come out after dusk`; else null. Content prompts are already bridged to `#lrPrompt` (game.js:732).
- **action(a, actor, bag)** host only, `a.kind === 'nightlight.catch'`: pose = `actor === 'guest' ? ctx.other :
  ctx.physics` (treasure.js:206); `canCatch({..., jars: bag.count('jar'), wait: cooldown[actor] > 0})`; on null:
  `bag.remove('jar',1)`, `left = bag.add('fireflyjar',1)`, if `left` re-add the jar; cooldown 1.5 s per actor. Return
  true for this kind even when refused.
- **decorModel(type)**: `type === 'fireflyjar'` -> `createFireflyJar(T)`; else null.
- **serialize()** -> undefined; **load()** no-op (no world state; old saves untouched).
- **debug**: `give(kind,n)`, `state()` -> `{nf, local, partner, want, swarm:{lit, opacity}, jars, reason}`,
  `catchNow()` (host: bypass window, still needs a jar), `placeJar(x,z)` (host, like bees.js:238).
- **dispose()**: remove and dispose the swarm; reset `DAYNIGHT_CARRY` on/want to false.

## Tests (tests/nightlight.test.mjs)
1. `planPool`: cap 1 local on -> [-2]; cap 1 local off partner on -> [-3]; cap 2 both -> [-2,-3]; cap 4 local + picks
   [5,2,-1,-1] -> [-2,5,2,-1]; cap 0 -> nothing; never writes past cap; returns the filled count.
2. `canCatch`: each reason (no jar, noon, daynight off `ready:false`, no island, island `'gone'`, too far, cooldown),
   success at phase .8 and .01 on the shore edge `R + 6`; `catchWindow` edges .639/.64/.029/.03.
3. Action with a mock ctx/bag: host success swaps jar -> fireflyjar; full bag keeps the jar; guest actor uses
   `ctx.other`; unknown kinds return false; guest role never runs action logic.
4. Item rules: `handlantern` stack 1, `tool:false`, not in PLACEABLE_KINDS/PLACEABLE_IDS; `fireflyjar` placeable with
   a radius; `jar` recipe costs only real items; `coop.HELD` ends with `'handlantern'` and its old indices are unchanged.
5. No new lights: build the module with a mock T whose `PointLight/SpotLight/DirectionalLight` constructors count
   calls; run update() at night with local + partner on; count stays 0. Swarm is one Points with <= 40 vertices.
6. Models: jar group name `craft_lantern`, has a `lanternGlow` mesh, glow bounding centre y >= 0.18; triangle budget.
7. daynight off: with `createDayNightOff`, nightlight update/prompt/interact run without throwing and catching says `'day'`.
Keep all existing suites green (`npm test`), esp. progression, survival, models, item-icons, daynight, net-coop.

## QA plan (scratchpad shoot.py copy, raftDebug)
- Dusk shot (`setPhase(.66)`) and night shot (`.8`) holding the Hand Lantern on a bare deck: warm pool on the planks
  around the feet, viewmodel not blown out, sky still dark. Same with 3 placed lanterns on `low`, `medium`, `high`.
- Night near a docked island: swarm visible over the shore; catch with a jar; place the Firefly Jar; night shot of it.
- **Program count**: craft the lantern by day, wait 2 s, select another slot, `setPhase(.8)`, read
  `raftDebug.renderInfo.programs`; select the lantern, wait 2 s, read again: **delta must be 0** (same for the
  partner equipping in the loopback co-op test). If the held model links a new program, change its materials to
  parameters already in use (vertexColors standard / plain standard), never prewarm with extra lights.
- `raftDebug.renderInfo.lights` unchanged before/after equipping; `daynight.state().poolCarry` 1 while held at night.
- `?daynight=off`: load, craft, hold, try catch: no console errors, no light, prompt says fireflies come out after dusk.
- Co-op loopback: guest holds the lantern -> host sees the avatar lantern and a lit pool around the guest.

## Build notes
Built as specified, except where noted.
- **Files**: `dist/nightlight.js`, `dist/nightlight-models.js`, `tests/nightlight.test.mjs` (10 tests). Hooks: daynight.js
  (`DAYNIGHT_CARRY`, `CARRY_PEAK`, `planPool`, `poolCarry`), content.js, coop.js, held-items.js, coop-avatar.js, avatar.js,
  items.js, craft-book.js (`CATEGORY`, `ITEM_TEXT`, and `ITEM_SOURCE.fireflyjar`), item-svg.js, live.js PRELOAD,
  tests/progression.test.mjs, plus the tools-tab list in tests/survival.test.mjs.
- **coop.js beyond `HELD`**: with the co-op hub, game.js `other` comes from coop.js `lastPose`, which had no `held`, so
  `ctx.other.held` was always null on the guest. `lastPose` now carries `held` (decoded from the existing `h` index).
  The wire format is unchanged.
- **`want`** is checked when the local bag's `version` changes as well as every 1 s. With only the timer, a slow first
  frame after crafting left the pool off until the lantern was equipped at night, which relinked shaders at that point.
- **Partner light**: placed at their hand height, eye -0.45 m and 0.35 m ahead, not eye +0.15 m. Above the head it lit
  only the hat and shoulders.
- **Jar pool light**: the `lanternGlow` bounding-sphere centre is lifted to 0.55 m (radius 0.5), not ~0.22 m. At 0.22 m a
  POOL_PEAK light blows the deck out white, as with the candle. The test still checks >= 0.18.
- **Swarm** uses a 16x16 radial-alpha DataTexture as `map`. Without it the points draw as squares. The swarm group sits
  at `(cx, gy, cz)`, and each point floats 0.4 to 2.4 m above the sand height at that spot (`groundAt`), so none sit
  inside the dune.
- **Held jar**: `jar`/`fireflyjar` use the Firefly Jar model in the hand (`heldJar`, not `craft_lantern`; the empty jar
  hides its glow and bugs) instead of the generic bundle. Hand Lantern hold: `arm: [-0.06, 0.17, 0]`, so the lantern
  shows above the hotbar.
- **Prompt**: the muted "Fireflies come out after dusk" hint shows only while an island is present.
- **QA** (swiftshader; see the night-shots folder of the round's scratchpad):
  - `programs` before/after equipping at night: low 107/107, medium 108/108, high 73/73.
  - `lights` are unchanged, and `poolCarry` is 1 while the lantern is held at night.
  - Catching swaps jar -> fireflyjar. The prompt reads "E Catch fireflies" at night and the hint by day.
  - Co-op loopback: the guest sees the host's lantern (`partner.on`, `poolCarry` 1).
- **Limits**:
  - A player who owns no lantern and has no placed lantern/candle/jar attaches the pool when a partner joins (review
    fix: was the first time the partner equipped a lantern at night). The one-time shader relink lands in the join
    hitch; co-op sessions then always carry the pool lights.
  - On `low` the carried lantern takes the only pool slot, so placed lanterns and jars keep only their emissive glow.
  - The first-person grip pose is the generic tool grip (fingers half open around the thin loop).
