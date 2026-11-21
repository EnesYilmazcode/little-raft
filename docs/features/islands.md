# Islands

Small islands drift past the raft every few minutes. You swim over, walk on the sand, gather
from palms, bushes, rocks and sand patches by tapping E, and swim back before the island drifts
off. Nothing hurts you, and nobody gets stranded.

This revision targets the content registry (`dist/content.js`, `docs/features/content-hooks.md`).
Everything lives in `dist/islands.js` (plus an optional `dist/islands-layout.js` for pure logic)
and needs **no game.js edits**.

## What Raft does

raft.wiki.gg did not resolve from this session (DNS blocked, as before it returned HTTP 401), and
raft.fandom.com returns 402. The facts come from search snippets.

- About 10 hand-built small islands. One spawns with high probability while you sail. Vegetation
  grows on top, and sand, clay, scrap and ore lie in the shallows.
  ([Raft wiki: Islands](https://raft.fandom.com/wiki/Islands))
- A palm tree yields planks, coconuts and palm leaves when chopped (about five axe chops, each with
  a chance of a drop). Small islands also carry seeds, Palm Seed among them.
  ([Raft wiki: Islands](https://raft.fandom.com/wiki/Islands),
  [palm leaves guide](https://anakjjut.pages.dev/posts/raft-how-to-get-palm-leaves-and-rope))
- The island stays put and the raft drifts, so you need an anchor. Sharks bite on the swim.

## Our version

| Raft | Little Raft |
| --- | --- |
| Raft drifts, island stays, anchor needed | Raft stays at the origin, the island glides past and docks. No anchor. |
| Sharks attack on the swim | Nothing attacks. |
| Axe chops, hook mining | Tap E on a node (no tool). One gather per tap, 0.35 s cooldown. |
| Hand-built layouts | Layout generated from a uint32 seed, so co-op players build the same island from one number. |

### Nodes and loot

| Node | Count | Gathers | Each gather gives |
| --- | --- | --- | --- |
| Palm | 1 to 3 | 3 | 1 wood + 1 leaf; the 3rd gather also gives 1 seed |
| Bush | 2 to 4 | 2 | 1 leaf; 50% chance of +1 seed (`hash(seed, node, used)`, deterministic) |
| Rock | 2 to 4 | 3 | 1 stone |
| Sand patch | 2 to 3 | 4 | 1 sand |

Total node count is at most 14 (`MAX_NODES`). A drained node turns a dimmer colour and stops
showing a prompt. Palms stay standing. Kinds used: `wood`, `leaf` (core), `sand`, `stone`, `seed`
(`dist/content-items.js`). Before granting, check the kind exists in the bag's item table
(`bag.add` returning the full count means unknown/full); never throw.

## Pacing

All timing uses the module's own clock, which advances by `dt` only while `ctx.running`.

1. **Calm:** 150 to 240 s (seeded). The first island in a fresh world comes at 90 s, so a new
   player meets one early.
2. **Approach:** 25 s. Spawns at z = −60 (upstream, where debris comes from) and eases out to its
   dock z, which is 0 to 6 m upstream of the raft centre.
3. **Docked:** 180 s, 10 to 14 m gap from the raft's bounding box on the clearer `x` side, so an
   easy swim (about 6 s at `SWIM_SPEED` 2.1). Keep the island centre within 38 m of the nearest
   tile, because `PlayerPhysics._safety` teleports a player more than 50 m from the raft.
4. **Warning:** at 30 s left, `ctx.notice('The island is starting to drift away')` once per actor
   standing on it or near it.
5. **Depart:** 30 s, eases to z = +60, then the island hides and the next calm starts.

Departure pauses while any player (host `ctx.physics`, guest `ctx.other`) is within
`radius + 6 m` of the centre, up to a hard cap of 10 min docked. After the cap it departs anyway;
the existing 50 m safety teleport puts a lingering swimmer back on the raft. That is the only
"penalty", and it is friendly.

## Save shape: `world.ext.islands`

```js
{
  v: 1,
  clock: 1003.2,   // module seconds, finite >= 0
  next: 1170,      // clock value when the next island is born
  isl: null | {    // null while calm
    seed: 12345678,  // uint32
    born: 812.4,     // clock at approach start
    dock: 180,       // docked seconds, grows while someone is near (cap 600)
    side: 1,         // +1 | -1
    off: 22.5,       // lateral centre distance, metres (clamped 8..38)
    used: [0,2,1],   // gathers per node, length === layout node count
  }
}
```

`clean(data)` (pure, exported) returns a fresh valid object and never throws:

- not an object, or `v !== 1`: defaults `{v:1, clock:0, next:90, isl:null}` (old saves land here).
- `clock`, `next`: finite and `>= 0`, else defaults. `next` is clamped to `clock + 600` at most.
- `isl`: kept only if `seed` is an integer in `[0, 2^32)`, `born`/`dock`/`off` finite, `side` is
  ±1 and `used` is an array. `used` is rebuilt to the layout's node count, each entry an integer
  clamped to `[0, max]`. Anything else gives `isl: null`.
- An island whose phase is already `gone` at load time is dropped (`isl: null`).

Layout, positions and the path are pure functions of `(seed, clock)`; nothing derived is saved.

## Module hooks (`createIslands(ctx)`)

| Hook | Behaviour |
| --- | --- |
| `name` | `'islands'` |
| `update(dt)` | Solo/host: advance `clock`, run the timeline (spawn, dock extension, depart). Guest: advance its local copy of `clock` only (it never spawns or despawns). Everyone: place the island group from `pathAt`, bob it with one `ctx.ocean.getHeight` sample at its centre, and update the gather cooldown. No allocations. |
| `afterMove(physics, dt)` | Stand on sand (below). |
| `serialize()` | Returns one cached object; only `clock` is rewritten each call. `isl.used` is the live array. Cheap at 8 Hz. |
| `load(data, from)` | `clean()` it. If `isl.seed` differs from the current one: re-layout (rewrite instance matrices, no new geometry). If only `used` differs: update instance colours. Guest `'net'`: snap `clock` to the host's value. Idempotent. |
| `action(a, actor, bag)` | Handles `islands.gather` (below). Return `true` for any `islands.*` kind. |
| `interact(aim)` / `prompt(aim)` | E to gather (below). |
| `debug` | QA helpers (below). |
| `dispose()` | Remove the group, dispose the cached geometries and materials. |

The guest's own island survives a visit, because game.js keeps the guest's own `world.ext` in its
backup and calls `load(ext, 'restore')` on return.

## Action: `islands.gather` (host-authoritative)

Client (any role) sends `ctx.action({kind:'islands.gather', seed, node})`. In solo/host it runs
locally right away through the same path.

Host `action(a, actor, bag)` checks, in order, and returns `true` silently on any failure:

1. `a.kind === 'islands.gather'`, an island exists, `a.seed === isl.seed` (stale seed: ignore).
2. `node` is an integer in `[0, nodes.length)` and `used[node] < max`.
3. Reach: actor position (`ctx.physics` for `'host'`, `ctx.other` for `'guest'`; null means
   reject) is within 3.5 m horizontally of the node's world position.
4. Per-actor cooldown 0.3 s on the host clock (stops key-repeat spam).
5. Loot is atomic: `const s = new bag.constructor(bag.snapshot())`, add each loot kind to `s`; if
   any `add` returns leftover, `ctx.emit({kind:'full', text:'Your bag is full'}, actor)` and stop.
   Else copy `s.slots[i]` into `bag.slots[i]` (same as game.js `commit`), `used[node]++`, and
   `ctx.emit({kind:'loot', text:'+1 Stone'}, actor)` (friendly, built from item names).

The guest sees the drained node when the next state message arrives (≤ 125 ms). It may dim the
node locally on press for feedback; the next `load('net')` settles it.

## Standing on sand: `afterMove(physics, dt)`

`movePlayer()` calls `physics.update(...)` first; the physics knows only raft tiles, so on the
island it would fall into swimming every frame. `afterMove` corrects that. Ground:

```
groundAt(x, z): local r = distance to island centre / R
  r > 1 -> NaN (off island)
  g = baseY + bob + TOP - (TOP + DROP) * r*r      // TOP = 0.7, DROP = 1.4, baseY = ocean.mesh.position.y
```

So the dome top is 0.7 m above mean water and the rim sits 0.7 m under it (the shallow ring).
Fields used are the public ones of `PlayerPhysics` (`x, y, z, vy, grounded, swimming,
verticalSpeed, climbing`) and `PLAYER_CONSTANTS.EYE_OFFSET` (1.6) and `JUMP_IMPULSE` (4.6),
imported from `./player-physics.js`. Per frame:

```
if (physics.climbing) { onSand = false; return }
g = groundAt(physics.x, physics.z); w = ocean.getHeight(physics.x, physics.z)
if (!isFinite(g) || g < w + 0.25) { onSand = false; return }   // wet edge: normal swimming
feet = physics.y - EYE_OFFSET; up = g - feet
jumpEdge = physics._prevJump && !lastJump; lastJump = physics._prevJump
if (onSand && jumpEdge) { physics.vy = JUMP_IMPULSE; physics.verticalSpeed = JUMP_IMPULSE;
                          physics.grounded = false; onSand = false; return }
if (physics.vy > 0 && up < 0) return                             // still rising from a jump
stick = onSand ? 0.35 : 0.06                                     // follow downslopes when walking
step  = physics.swimming ? 1.6 : 0.6                             // wade ashore from swim height
if (up >= -stick && up <= step) {
  physics.y = g + EYE_OFFSET; physics.vy = 0; physics.verticalSpeed = 0
  physics.grounded = true; physics.swimming = false; onSand = true
} else onSand = false
```

Why it works: next frame `update()` sees `grounded = true`, so horizontal movement uses
`WALK_SPEED`/`GROUND_ACCEL`. Its grounded branch finds no tile, clears `grounded`, and gravity
drops the feet about 1 cm; because `g >= w + 0.25` the feet stay above `waterY + WATER_ENTER`
(0.1), so it never flips to swimming or plays the splash beep. `afterMove` then snaps back, and
game.js reads `physics.grounded` after the hook, so the walk animation plays. The 0.25 margin
covers wave height (amplitudes sum to 0.255) at the walkable part.

`_prevJump` is a private field. It is the only way to see the jump key from the hook; if it is
`undefined`, jumping on sand is simply disabled (safe). Note this in the code.

## E to gather: `interact(aim)` / `prompt(aim)`

`aim` from game.js is `{point, item, dir}` (no origin) or `null` when the pointer is unlocked.
Ray origin is `ctx.camera.getWorldPosition(scratchV)`; direction is `aim.dir`, or the camera
forward from `ctx.camera.getWorldDirection(scratchD)` when `aim` is null.

`pickNode()` is an analytic ray-sphere test against each node's bounding sphere (centre and
radius cached in world space when the island moves; ≤ 14 nodes). Nearest hit within 3.5 m of the
camera with `used < max` wins. This avoids `Raycaster.intersectObject` on the InstancedMesh,
which allocates result arrays each frame. Returns a node index or −1, no allocation.

- `prompt(aim)`: `null` unless a node is hit. Else a cached string per kind and state, e.g.
  `<kbd>E</kbd>Gather palm (wood, leaf)`, `<kbd>E</kbd>Gather stone`, `<kbd>E</kbd>Scoop sand`.
  Text is static, so no `esc` needed, and strings are prebuilt (no per-frame concatenation).
- `interact(aim)`: if a node is hit and the local cooldown has passed, send the action, start a
  0.35 s cooldown, and return `true` (so the inventory does not open). Off island: return `false`.

Floating debris pickup runs before the content hook in game.js, so debris near the beach still
wins. That is fine.

## Rendering plan

Geometries and materials are created once in `createIslands` and reused for every island.

| Draw | Object | Notes |
| --- | --- | --- |
| 1 | Island `Mesh` | Flattened `SphereGeometry(1, 32, 12)` scaled to R (5 to 8 m) and the dome profile; vertex colours: dry sand top, wet sand band near the waterline. Receives shadows. |
| 2 | Shallow disc `Mesh` | `CircleGeometry(1, 32)` at R × 2, 0.9 m under mean water, turquoise-to-deep vertex colours, `depthWrite: false`. Seen through the water. |
| 3 | Palm trunks `InstancedMesh(count 3)` | One tapered, slightly bent `CylinderGeometry` (6 radial segments). Casts shadows. |
| 4 | Palm fronds `InstancedMesh(3)` | One merged geometry of 5 leaf planes (`BufferGeometryUtils` is not vendored, so merge by hand into one `BufferGeometry`). `side: DoubleSide`. Drained: droop via instance matrix, dim via `setColorAt`. |
| 5 | Bushes `InstancedMesh(4)` | `IcosahedronGeometry(1, 0)`, `flatShading`. |
| 6 | Rocks `InstancedMesh(5)` | `DodecahedronGeometry(1, 0)`, per-instance squash and rotation from the seed. Casts shadows. |
| 7 | Sand patches `InstancedMesh(3)` | Small flat `CircleGeometry` decal, a lighter sand colour, `polygonOffset`. |

Budget: **7 draw calls** for the whole island (plus shadow passes for trunks, fronds, rocks),
**about 3k triangles**, no new lights, no texture. All are children of one `Group`; while calm
the group has `visible = false` and `update` returns early after advancing the clock. Instance
counts are allocated at the max and `mesh.count` is set per layout. Instance colours use
`MeshStandardMaterial({vertexColors:false})` + `setColorAt` (initialised once so the shader
does not recompile later). Per-frame motion moves only the group (`position`, small `rotation.z`
bob); instance matrices are written only on re-layout or a node draining. Scratch `Vector3`,
`Matrix4`, `Quaternion`, `Color` are module-level.

## Debug: `raftDebug.content.islands`

- `spawnNear(seed?)`: create an island right now in the docked phase at the default spot (seed
  default `1234`). Host/solo only.
- `phase()`: `{phase, t, left, seed, clock, next}` for scripts.
- `skip(seconds)`: advance the clock (e.g. skip calm).
- `teleportAshore()`: put the local player on the dome top (sets `physics.x/z/y`, grounded).
- `aimAt(i)`: turn the camera to look at node `i` (for prompt screenshots); `nodes()` lists
  `{i, kind, used, max, x, y, z}`.
- `drain()`: mark every node used (spent look).
- `clear()`: remove the island and restart calm.

## Exports for tests

`dist/islands.js` (or `islands-layout.js`) exports pure helpers with no THREE dependency:
`layoutFor(seed)`, `pathAt(t, dock)` → `{phase, z}`, `clean(data)`, `lootFor(kind, seed, node,
used)`, `groundHeight(r, R)`, `nextDelay(seed, first)`, and `applyGather(state, a, actorPos, bag)`
(the host action logic, so tests run it without a scene).

## Test plan (`tests/islands.test.mjs`)

Same base-URL import pattern as `tests/survival.test.mjs`.

- `layoutFor`: same seed gives a deep-equal layout; counts in range; every node inside 0.8 R;
  nodes at least 1 m apart; total ≤ 14.
- `pathAt`: phases in order approach → docked → depart → gone; `z` continuous at each boundary;
  docked centre gap ≥ 10 m from a 3x3 raft and centre ≤ 38 m from the nearest tile.
- `clean`: `undefined`, `null`, `'x'`, `{v:2}` give defaults; NaN clock, `side: 0`, non-integer
  seed, oversized or negative `used` are fixed or dropped; a good blob round-trips through
  `serialize()` → `JSON` → `load()` → `serialize()` unchanged.
- `applyGather` with a real `Bag`: grants the loot table; stale seed, bad node, out of reach,
  drained node and cooldown all change nothing; a full bag changes nothing (atomic) and emits
  `full`; `used` goes up by exactly 1; bush seed roll is deterministic.
- Stand on sand: a `PlayerPhysics` placed over the dome, stepped 120 frames with
  `update()` + `afterMove()` (fake ctx with a flat ocean), stays `grounded`, never `swimming`,
  feet within 2 cm of the ground; walking off the rim ends up swimming; swimming in toward the
  beach lands on the sand.
- Timeline: departure pauses while a fake player is within `R + 6`, and the 600 s cap still
  departs.
- `createIslands` with a stub ctx (THREE from vendor, a `Scene`, a fake ocean) survives
  `load(undefined, 'save')`, `load(garbage, 'net')`, and an `update` loop over a full cycle.

Screenshots (own playwright script, modelled on `tools/shoot_headless.py`): `spawnNear()` then
shots from the raft (island visible, palms, rocks, shallow ring), after `teleportAshore()`
(standing on sand), and with `aimAt(0)` (gather prompt). Read the PNGs and judge them.

Manual co-op: host and guest see the same layout; a guest gather fills the guest's bag and drains
the node for both; reloading the host mid-dock restores the same island and drained nodes; an old
save without `ext` starts calm with the first island at 90 s.
