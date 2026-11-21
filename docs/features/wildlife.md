# Wildlife

Seagulls that circle and land on the raft, fish schools you can see just under the surface, and now and then a dolphin or a sea turtle swimming by. Everything is scenery. Nothing bites, steals, or breaks anything.

## What Raft does

raft.wiki.gg would not load for automated fetches (HTTP 401, Cloudflare), and the search index has no pages from it. The facts below come from the older official fandom wiki (shown through search snippets, since a direct fetch hit a paywall), Wikipedia, and guides.

| Creature | Raft behaviour | Source |
|---|---|---|
| Shark ("Bruce") | Always circles the raft, attacks swimmers and bites raft tiles. It was added because players kept jumping in to grab loot. | https://en.wikipedia.org/wiki/Raft_(video_game) |
| Seagull | Farm pest. Circles, then dives at a crop or scarecrow about every 4 minutes (Update 12). You have 15 s to stop it, and walking within about 2.25 m scares it off. 10 HP. A scarecrow within 3.5 m pulls the attack onto itself. | https://raft.fandom.com/wiki/Seagulls, https://www.gameskinny.com/tips/raft-how-to-defend-your-crops-from-seagull-attacks/ |
| Pufferfish | Hostile, in the shallows around big islands. | https://en.wikipedia.org/wiki/Raft_(video_game) |
| Fish (Herring, Mackerel, Pomfret, Salmon, Tilapia, Catfish) | You only meet them as catches from a rod. You never see them swim in open water. | https://techraptor.net/gaming/guides/raft-fishing-guide, https://raft.gamepedia.com/Fishing_Rod?oldid=8003 |
| Dolphins, turtles, whales | Not ambient wildlife in Raft. Players asked for them on Steam and got no official answer. | https://steamcommunity.com/app/648800/discussions/0/3068621701766650206 |

What makes it feel like Raft: an empty ocean around you, one big animal that keeps circling the raft, and gulls that show up when you have something they want. Wildlife creates pressure. It never just fills the scene.

## Our friendlier version

We keep the shapes and rhythms people recognise and drop the threat.

- **Gulls (3 to 6).** They glide on wide circles 8 to 14 m above the raft. Every 20 to 50 s a gull chooses a free spot (a raft tile with no decor, or the top of a `sail`, `crate` or `bench`), glides down, folds its wings, and hops around for 6 to 15 s before flying off. If a player walks within 2.25 m it takes off early, the same scare radius as Raft. Gulls never touch items, crops or inventory.
- **Fish schools (2 schools of 12 fish).** Each school swims a loose loop 0.4 to 1.2 m under the surface, 6 to 18 m from the raft, so the fish show through the clear shallow colour of the water. The school drifts as a group, and each fish adds its own phase-offset wiggle. The schools stay away from an active hook cast so they never seem to be "the thing you caught".
- **The friendly circler (one at a time).** This takes the shark's place. About every 90 to 180 s a dolphin (70%) or a sea turtle (30%) arrives from the fog. It makes one or two slow laps around the raft at 9 to 14 m, then leaves. The dolphin surfaces in arcs, and the turtle paddles along the surface. It never comes closer than 7 m, so it never blocks a swimming player.
- **No sharks.** Nothing harms the player or the raft. Wildlife has no collision and no gameplay effect beyond being nice to look at.

## Lean rendering

- One module, `dist/wildlife.js`, with one `T.Group`.
- **Gulls.** Two `InstancedMesh` objects (body, and wings as one bent quad mirrored by scale) sharing a single `MeshLambertMaterial` with vertex colours. The wing flap is a scale.y and rotation applied while rebuilding the instance matrix, so there are no skeletons and no shader edits.
- **Fish.** One `InstancedMesh` of 24 low-poly diamond fish (8 triangles). The tail wiggle is a yaw oscillation in the matrix. The material is `MeshBasicMaterial` with `transparent:true` and opacity 0.55, `depthWrite:false`, and the colour tinted toward the water's shallow colour so the fish read as below the surface.
- **Circler.** Two small merged `BufferGeometry` meshes (dolphin, turtle) built once. Only one is visible at a time.
- Every geometry and material is created once at mount. Per-frame updates write only to preallocated `Matrix4`, `Vector3`, `Quaternion` and `Euler` scratch objects and to `instanceMatrix.needsUpdate`. Nothing is allocated per frame.
- Graphics `low` gives 3 gulls, 1 school and the circler. `medium` and `high` give everything. Draw calls: 4 at most.
- Ocean height comes from `ocean.getHeight(x, z)`, sampled once per gull landing check and once per circler surfacing. Fish depth is relative to the mean water level, so we avoid 24 height samples per frame.

## Data model

Wildlife is cosmetic and deterministic, so there is no world state to keep.

```
state(t) = f(SEED, floor(t / slot), world.tiles, world.decor)
t        = Date.now() / 1000      // wall clock, same on host and guest within clock skew
```

- Each creature's path is a closed-form function of `t` and its index, using a small hash PRNG (`mulberry32(SEED ^ index ^ slot)`), where `slot` is the scheduling window. Examples: gull circle phase, the timing of the next landing, school loop phase, circler arrival time and kind.
- Landing spots are picked from `world.tiles` and `world.decor` sorted by key, using the same PRNG. Host and guest already share those arrays, so they pick the same perch.
- Local-only state: `scaredUntil[gull]`, set when this client's player gets close. This means a gull you scare flies off on your screen, while on your brother's screen it may stay a few seconds longer. That is fine for scenery and costs no network traffic.

## Save format

**Nothing new is saved.** There are two reasons.

1. `cleanWorld()` in `game.js` rebuilds the world from a fixed list of keys and drops anything else. A `world.wildlife` field would vanish on load unless we edited the validator, and other fleets are editing that file right now.
2. Everything can be derived from the clock and the tiles, so there is nothing worth keeping.

Old saves load unchanged, and new saves look exactly like old ones. If later work needs persistent wildlife (a named pet gull, say), add `world.wildlife = {v:1, ...}` together with one matching line in `cleanWorld`, and default it when it is missing.

## Co-op sync

No new messages. Both clients compute the same scene from the wall clock and from `world.tiles` and `world.decor`, which already sync through the host's `state` message. Clock skew of up to about 1 s shows up as a small phase offset, and nobody can see it on animals moving at gull speed.

## API

```js
// dist/wildlife.js
export const WILDLIFE_SEED = 0x5eaf00d;
export function createWildlife(T, {scene, ocean, getRaft, getWorld, quality = 'medium', now = () => Date.now() / 1000}) {
  // returns:
  return {
    group,                         // T.Group, already added to scene
    update(dt, {playerPos, hookPos}),   // playerPos: {x,y,z} of the local player; hookPos optional
    setQuality(q),                 // 'low' | 'medium' | 'high'
    snapshot(),                    // debug: {gulls:[{x,y,z,state}], schools:[{x,z}], circler:{kind,x,z}|null}
    dispose(),
  };
}
// pure helpers, exported for tests (no THREE needed):
export function gullPlan(seed, index, t, perches)   // -> {state:'circle'|'descend'|'perched'|'leave', x,y,z, yaw}
export function schoolCenter(seed, index, t)        // -> {x, z, heading}
export function circlerAt(seed, t)                  // -> null | {kind:'dolphin'|'turtle', x, z, y, heading}
export function perchesFrom(tiles, decor)           // -> sorted [{x,y,z}] world-space perch points
```

`getRaft()` returns the raft group, so perched gulls follow its bob and tilt: the perch y is `raft.position.y + perch.y`, and the gull's matrix uses the raft's rotation.

## Hook into game.js (the only edits outside new files)

Marked `// [wildlife] begin` and `// [wildlife] end`:

1. **Import** (top of file):
   `import { createWildlife } from './wildlife.js?build=...';`
2. **Scene build**, right after `scene.add(raft)` (around line 291):
   `wildlife = createWildlife(T, {scene, ocean, getRaft:() => raft, getWorld:() => world, quality:options.graphics});`
   plus `let wildlife = null;` next to the other scene locals.
3. **Frame**, right after `updateRaft(dt); movePlayer(...)` in `frame()`:
   `wildlife?.update(dt, {playerPos:physics, hookPos:hook ? hookMesh.position : null});`
4. **Dispose**, in `disposeScene()` next to `ocean?.dispose()`:
   `try { wildlife?.dispose(); } catch {} wildlife = null;`
5. Optional: in the settings `onChange`, call `wildlife?.setQuality(next.graphics)`.

`raftDebug` can expose `wildlife?.snapshot()` for headless probes. That is one more line, also inside the markers.

## Test plan

Unit tests (`tests/wildlife.test.mjs`, run with `node --test`, no THREE needed for the pure helpers):

- `gullPlan` is deterministic: the same `(seed, i, t, perches)` gives the same result, and different seeds give different results.
- Over a simulated 10 minutes (sampled at 10 Hz), every gull spends time in `circle` and in `perched`, a perched gull's position equals a perch point, and no `y` ever goes below the water level.
- `perchesFrom` ignores tiles that hold decor (except the sail, crate and bench tops) and returns sorted output whatever the order of `tiles`.
- `schoolCenter` stays in the 6 to 18 m ring, and fish depth stays between -1.2 and -0.4.
- `circlerAt` returns `null` for most of the time, never comes within 7 m of the origin, and gives the dolphin to turtle ratio within +/-10% of 70/30 over 2,000 windows.
- With `createWildlife` and a stub ocean: `update()` called 1,000 times creates no new objects (count allocations by wrapping `T.Matrix4` and `T.Vector3` constructors), and `dispose()` frees every geometry and material.
- Old save fixture: loading a v2 or v3 save from `tests/` still produces an identical `world` (no wildlife keys added).

Headless (`python shoot.py dist .qa/wildlife`):

- Shots at t+5 s (gulls circling), at a forced perched state through `raftDebug` (gull on a tile), and looking at the water (fish visible).
- Compare frame time with the pre-wildlife baseline. Budget: 0.3 ms or less on SwiftShader, and at most 4 extra draw calls (`renderer.info.render.calls`).
- No console errors. Toggling graphics low, then high, then low keeps the instance counts right.

Co-op: two tabs (host and guest). `snapshot()` positions agree within 0.5 m for the same wall-clock second, and the circler kind matches.
