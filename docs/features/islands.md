# Islands

Small islands drift past the raft every few minutes. You swim over, walk on the sand, gather
palm leaves, sand, stones and seeds by holding interact, and swim back before the island drifts
off. Shallow water around each island shows a glimpse of seafloor.

## What Raft does

raft.wiki.gg returned HTTP 401 to automated fetches and raft.fandom.com returned 402, so the
facts below come from search snippets of those wikis and from guides. Each one names its source.

- Raft has about 10 hand-built small islands. One of them spawns with high probability while you
  sail, and each looks the same every time you see it. Vegetation grows on top and resources lie
  in the water around it. ([Raft wiki: Islands](https://raft.fandom.com/wiki/Islands))
- Islands spawn based on their distance from the raft. Players report a finite pool of
  hand-built islands, with resources restored when one comes back. That report may be out of date.
  ([Steam discussion](https://steamcommunity.com/app/648800/discussions/0/3002172045223679474))
- Shipwreck Island has a 2% chance to spawn in place of a small island and has three palm trees.
  ([Raft wiki: Islands](https://raft.fandom.com/wiki/Islands))
- Palm trees grow on small and large islands. A tree falls after five axe chops and drops planks
  and palm leaves, with a small chance of coconuts and palm seeds on each chop. A planted palm seed
  takes 12 minutes to grow. ([Raft wiki: Palm Tree](https://raft.fandom.com/wiki/Palm_Tree))
- Small islands also have flowers, fruit and seeds. ([Raft wiki: Islands](https://raft.fandom.com/wiki/Islands))
- Sand and clay lie on the seafloor, and you mine them by swinging the hook
  ([gameplay.tips survival guide](https://gameplay.tips/guides/2464-raft.html)). Clay, sand,
  metal ore, copper and scrap are the underwater finds around small islands
  ([Raft wiki: Islands](https://raft.fandom.com/wiki/Islands)). Guides tell new players to gather
  clay, sand, scrap and stone in the shallows by their first island
  ([TechRaptor guide hub](https://techraptor.net/gaming/guides/raft-guides-guide-hub)).
- The island never moves. The raft drifts with the current, so you drop an anchor before you go
  ashore or dive, or the raft leaves without you
  ([Steam discussion](https://steamcommunity.com/app/648800/discussions/0/1777135944136644161),
  [Bloxodes Raft wiki](https://bloxodes.com/wiki/raft)). A Stationary Anchor needs a smelter,
  metal ingots and a hinge, and it can be used any number of times
  ([Gameranx](https://gameranx.com/features/id/326012/article/raft-how-to-get-a-permanent-anchor-crafting-guide/)).
- In Raft, sharks attack you while you swim to an island, and a shark bite does damage.

## Our version

Raft uses tension: the raft leaves you behind, and a shark bites you on the swim. Little Raft
keeps the visit and drops the danger.

| Raft | Little Raft |
| --- | --- |
| The raft drifts and the island stays put, so you need an anchor | The raft stays at the origin as it does now, and the island floats past it on a slow track. No anchor. |
| Sharks attack on the swim | Nothing attacks. Swimming is free. |
| Axe chops, hook mining, many resource kinds | You hold interact (E) on a node for 1.2 s. There are four node kinds and no tool requirement. |
| About 10 hand-built layouts plus rare variants | Each layout is generated from a 32-bit seed, so both co-op players build the same island from one number |
| Island stays until you sail away | The island stays docked for about 3 minutes. When 30 s remain, a gentle warning appears and the island starts drifting away. If you are still standing on it, it waits until you leave (see below). |

Nobody gets stranded. While a player stands on the island or swims within 6 m of it, departure
pauses. If the island has to leave anyway (for example the 10 minute hard cap ran out), the player
is carried along and gets the existing respawn-to-raft treatment, never a death.

### Timeline

1. **Calm:** No island exists for 150 to 270 s (the delay is seeded, and the first island comes
   about 3.5 minutes into a fresh world).
2. **Approach:** The island spawns 70 m upstream (−z, where debris comes from), 14 to 22 m off to
   one side of the raft, and slides in over 25 s along `z` with an ease-out curve.
3. **Docked:** It sits 10 to 16 m from the nearest raft tile for 180 s. That is an easy swim.
4. **Depart:** It slides 70 m downstream over 30 s, the mirror of the approach, and is then removed.

The island never overlaps the raft. The spawn side is the one with more clear space, which is the
smaller `|x|` extent of `world.tiles`, and the gap is measured from the raft's bounding box at the
moment of spawn. The raft is capped at 400 tiles (±25 tile coords = ±50 m), so the lateral offset
is clamped to the raft's half-width plus 10 m.

### Island content

- **Ground:** One sand dome (a flattened `SphereGeometry`, radius 5 to 8 m, top 0.35 m above the
  mean water level), with a ring of darker wet sand at the waterline.
- **Palms:** 1 to 3. Each is a curved trunk built from cylinders plus 5 leaf planes, reusing the
  look of the `palm` decor on the raft. Gather gives **2 Palm Leaf**. Each palm has 3 gathers,
  after which its fronds droop. The tree stays.
- **Bushes:** 2 to 4 green lumps (`IcosahedronGeometry`, detail 0). Each gather gives **1 Seed**
  and has a 50% chance to also give 1 Palm Leaf. 2 gathers per bush.
- **Rocks:** 2 to 4 grey lumps, some half submerged. Each gather gives **1 Stone**. 3 gathers per rock.
- **Sand patches:** 2 to 3 raked spots. Each gather gives **1 Sand**. 4 gathers per patch.
- **Seafloor glimpse:** A disc (radius ×2.2 of the island) 2.5 m below the water, with a
  turquoise-to-deep gradient through vertex colours and a few rocks and starfish on it. The disc
  shows only through the existing water transparency. It is not walkable, because diving is a
  separate feature.

Node yields are deterministic. The 50% leaf roll on a bush comes from `hash(seed, node, used)`,
so the host and the guest agree. A drained node shows its spent state, a frond or leaf colour
that has dimmed, and stops showing the interact prompt.

### New item kinds

`sand`, `stone` and `seed` need entries in `ITEM_INFO` (`dist/inventory-state.js`), each with
`maxStack: STACK_SIZE` and `tool: false`, plus icons. `leaf` already exists.

Old builds throw on unknown kinds in `Bag` snapshots (`validateSlot`), so they fall back to a
fresh bag. That is the same forward-compatibility cost every new item has. A new build loading an
old save is fine.

Other fleets own `inventory-state.js`, so this feature adds the three entries in one small,
clearly marked block. If the three kinds are missing, `islands.js` falls back to granting `leaf`
only and does not crash, because it checks `ITEM_INFO[kind]` before adding.

Recipes that use sand, stone and seed (a sand-and-stone lantern base, a seed planter) are out of
scope here. They belong to the crafting fleet.

## Data model

Everything visual and positional is a pure function of `(seed, t)`, so the save and the network
both carry a few numbers per island.

```js
// world.island (host-authoritative; null while calm)
{
  v: 1,
  seed: 12345678,        // uint32, picks layout, side, offsets, node counts
  born: 812.4,           // islandClock (s) when the approach started
  dockFor: 180,          // seconds in the docked phase, extended while someone is near
  side: 1,               // +1 or -1 (x side)
  offset: 18.5,          // lateral centre distance in metres, fixed at spawn
  used: [0, 2, 1],       // gathers consumed per node, index = node order from layoutFor(seed)
}
world.islandClock = 1003.2;  // seconds of island time elapsed (advances only while running)
world.islandNext = 1170;     // islandClock value at which the next island is born
```

A derived `layout` object is cached by seed and never saved. It holds the node list
`{kind, lx, lz, r, max}` in island-local metres, plus the radius. The island centre is
`cx = side * offset`, `cz = pathAt(islandClock - born, dockFor).z`.

The clock is the world's own accumulator: `islandClock += dt` only while the game runs. It is not
`performance.now()`, so a pause, a save or a reload resumes the same phase.

## Save format

The feature adds three optional top-level fields to the existing `little-raft-v1` blob:
`island`, `islandClock` and `islandNext`. `cleanWorld()` currently rebuilds the world object field
by field and would drop them, so the hook passes them through `cleanIsland(v)`. That function:

- returns `island: null` unless `v.island` is an object with `v === 1`, a finite `seed`, `born`,
  `dockFor` and `offset`, `side` of ±1, and `used`, an array of non-negative ints no longer than 32
- clamps `islandClock` and `islandNext` to finite values of 0 or more, with defaults of `0` and
  `210`

Old saves have no fields, which means calm with the first island at the default delay. An old
build reading a new save ignores the fields, because `cleanWorld` drops them. Nothing breaks
either way.

## Co-op sync

- The **host** owns the timeline. It sends `island` and `islandClock` in the existing
  `{type:'state'}` world payload (`world:{...}` near game.js:817). That adds a few dozen bytes,
  and `used` changes only when someone gathers.
- The **guest** rebuilds the layout from the seed and advances its own copy of the clock between
  host states, snapping when one arrives. It never spawns or despawns on its own.
- Gathering goes through the existing action channel as a new action:
  `{kind:'gather', node:i, seed}`. The host's `applyAction` checks `seed === world.island.seed`,
  that `used[i] < max`, and that the actor is within 3 m of the node. It adds the loot to the
  actor's bag atomically, the same way `collect` does (scratch bag, all or nothing), and bumps
  `used[i]`. The guest shows the hold progress locally, and the host result settles it.
- A stale seed (the island left before the action arrived) is ignored silently.
- The guest's own-raft backup (`ownWorldBackup`) keeps its own island fields, so visiting a host
  and returning does not lose the guest's island.

## API (`dist/islands.js`)

```js
import { createIslands, layoutFor, pathAt, cleanIsland } from './islands.js';

const islands = createIslands({ THREE, scene, ocean, getWorld: () => world });

islands.update(dt, { players: [{x, z, swimming}], role }); // host advances the clock; everyone moves the mesh
islands.groundAt(x, z)               // -> {y} | null  (sand height for player physics)
islands.nodeAt(origin, dir, reach)   // -> {index, kind, label} | null  (interact target)
islands.gather(index, bag, actorPos) // host only: -> {ok:true, loot} | {ok:false, reason}
islands.capture()                    // -> {island, islandClock, islandNext} for save and state payload
islands.restore(fields)              // validated restore (same rules as cleanIsland)
islands.dispose()                    // frees geometry and materials, removes the group

// pure helpers, exported for tests
layoutFor(seed)          // deterministic node list
pathAt(t, dockFor)       // {phase: 'approach'|'docked'|'depart'|'gone', z}
cleanIsland(v)           // save validation
```

### Performance

- Geometries and materials are built once per module: sand dome, wet ring, trunk, leaf, bush,
  rock and seafloor disc. Each island is one `Group` of `Mesh`es that share them, with scale and
  rotation varied from the seed.
- `update` moves one group and allocates nothing. Temporary vectors are module-scoped. The island
  bobs a few centimetres, with `ocean.getHeight` sampled once per frame at its centre.
- While calm, the group has `visible = false` and nothing is updated. After a departure the
  meshes are kept for the next seed, so a new island only rewrites node transforms.

## Hook into game.js

Each change is a small, clearly delimited block marked `// ISLANDS HOOK begin` and
`// ISLANDS HOOK end`:

1. Import `createIslands` from `./islands.js` and create the instance after the ocean exists.
2. In `cleanWorld`, copy `island`, `islandClock` and `islandNext` through `cleanIsland`.
3. In the frame loop, call `islands.update(dt, ...)`, and pass `ground: islands.groundAt` in the
   `physics.update` input. `player-physics.js` ignores unknown inputs today. Using the extra
   ground there is one guarded branch: when `ground(x, z)` returns a height above the feet and
   within step range, the player is supported at that height instead of swimming.
4. On interact (E) hold, if there is no debris target and `islands.nodeAt` hits, show the prompt
   "Hold E: gather palm leaves" and send `{kind:'gather'}` after 1.2 s.
5. In `applyAction`, add one `if (a.kind === 'gather')` branch that delegates to `islands.gather`.
6. For the state payload and the save, spread `islands.capture()` into `world` before `save()`
   and before sending the state.

## Test plan

Unit tests go in `tests/islands.test.mjs` and run with `node --test`. They need no DOM and use
only the pure helpers plus `Bag`:

- `layoutFor(seed)` is deterministic: the same seed gives a deep-equal layout. Node counts fall
  within the ranges above, and every node lies inside the island radius.
- `pathAt` goes through approach, docked, depart and gone in order. `z` is continuous at every
  phase boundary, and the island never comes closer than 10 m to a 3x3 raft.
- `cleanIsland` rejects a bad `v`, NaN fields, `side` 0, negative `used` entries and an oversized
  `used`. It accepts a good blob, and it returns `island: null` for `undefined`, which covers old
  saves.
- `gather` on a drained node fails. A gather into a full bag changes nothing, because it is
  atomic. A stale seed is rejected, and `used` increments by exactly 1.
- Departure pauses while a player is within 6 m of the island.

Headless shots use `python shoot.py dist .qa/islands-*` with a debug query param
(`?island=docked`) that forces the docked phase at a fixed seed:

- `.qa/islands-approach.png`: the island is visible on the horizon.
- `.qa/islands-docked.png`: the view from the raft shows sand, palms, rocks and a turquoise
  seafloor ring.
- `.qa/islands-ashore.png`: the player stands on the sand with the gather prompt visible.

Manual co-op check: the host and the guest see the same layout. When the guest gathers, its bag
updates and the node drains for both players. Reloading the host mid-docked restores the same
island with the same drained nodes.

Performance check: with the island docked, frame time stays within about 0.3 ms of calm on medium
graphics, and the heap does not grow over two full island cycles.
