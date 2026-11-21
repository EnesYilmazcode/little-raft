# Wildlife

Seagulls that circle and land on the raft, fish schools you can see just under the surface, and now and then a dolphin or a sea turtle swimming by. Everything is scenery. Nothing bites, steals, or breaks anything.

## What Raft does

raft.wiki.gg could not be reached. An earlier pass got HTTP 401 (Cloudflare). This pass's WebFetch of `/wiki/Seagull` failed DNS because the host is outside this session's allowed network domains. The facts below come from the older official fandom wiki (through search snippets), Wikipedia, and guides.

| Creature | Raft behaviour | Source |
|---|---|---|
| Shark ("Bruce") | Always circles the raft, attacks swimmers and bites raft tiles. | https://en.wikipedia.org/wiki/Raft_(video_game) |
| Seagull | Farm pest. Circles, then dives at a crop about every 4 minutes. You have 15 s to stop it, and walking within about 2.25 m scares it off. A scarecrow within 3.5 m pulls the attack onto itself. | https://raft.fandom.com/wiki/Seagulls, https://www.gameskinny.com/tips/raft-how-to-defend-your-crops-from-seagull-attacks/ |
| Fish | You only meet them as catches from a rod. You never see them swim. | https://techraptor.net/gaming/guides/raft-fishing-guide |
| Dolphins, turtles | Not in Raft. Players asked for them on Steam. | https://steamcommunity.com/app/648800/discussions/0/3068621701766650206 |

## Our friendlier version

- **Gulls (3 to 6).** They glide on wide circles 8 to 14 m above the raft. Every 20 to 50 s a gull picks a free perch (a raft tile with no decor, or the top of a `sail`, `crate` or `bench`), glides down, folds its wings, and hops around for 6 to 15 s before leaving. If the local player comes within 2.25 m it takes off early. Gulls never touch items, crops or inventory.
- **Fish schools (2 of 12).** Each school swims a loose loop 0.4 to 1.2 m under the surface, 6 to 18 m out, and shows through the shallow water colour.
- **Friendly circler (one at a time).** This takes the shark's place. Every 90 to 180 s a dolphin (70%) or a turtle (30%) makes one or two slow laps at 9 to 14 m, never closer than 7 m, then leaves.
- Nothing has collision or any gameplay effect.

## Module shape (content registry)

`dist/wildlife.js` exports `createWildlife(ctx)`, which returns a module for `dist/content.js`. It needs no new game.js hook.

| Hook | Wildlife does |
|---|---|
| `name` | `'wildlife'` |
| `update(dt)` | Advances the clock, plans each creature, writes the instance matrices. No allocations. |
| `serialize()` | Solo or guest: `undefined` (nothing saved). Host: one reused `{t}` object (see Co-op clock). |
| `load(data, from)` | `'net'`: read the host clock. `'save'` and `'restore'`: reset the offset to 0. Garbage is ignored, and it never throws. |
| `debug` | QA helpers, below. |
| `dispose()` | Removes the group, disposes every geometry and material. |

`action`, `interact`, `prompt`, `craftLocked`, `decorModel` and `afterMove` are unused. Meshes are built on the first `update`, when `ctx.scene` and `ctx.ocean` exist, and go into one `T.Group`. The local player is `ctx.physics` (`x, y, z`). Perched gulls take the bob and tilt of `ctx.raft`.

## Co-op clock

Both clients evaluate the same closed-form plan from a clock `t`, plus `world.tiles` and `world.decor`, which the state message already syncs. `Date.now()` is out because machine clocks can disagree by seconds. `ctx.elapsed` is per-client, so it is not shared on its own.

**Decision: use the host's elapsed time.**

- Host: `serialize()` sets `net.t = Math.round(ctx.elapsed * 10) / 10` on one preallocated object and returns it. That is about 12 bytes per state message. It also lands in `world.ext.wildlife` on host saves, which is harmless because `load(_, 'save')` ignores it.
- Guest, `load(d, 'net')`: if `Number.isFinite(d?.t)`, compute `off = d.t - ctx.elapsed`. On the first message, or if `|off - offset| > 2`, set `offset = off`. Small drift is left alone, so nothing jitters at 8 Hz. A big jump (the host reloaded) snaps.
- Clock: `t = ctx.elapsed + offset`. Solo and host keep `offset = 0`. `load(_, 'restore')` (the guest back on their own raft) resets the offset and the synced flag.
- The scare reaction stays local (`scaredUntil[i]`). A gull you spook leaves on your screen only, at no network cost.

## Lean rendering

Everything is created once and cached. Per-frame work writes only to scratch `Matrix4`, `Vector3`, `Quaternion` and `Euler` objects and sets `instanceMatrix.needsUpdate`. Hidden instances get a zero-scale matrix, and `count` stays at the maximum.

| Mesh | Geometry | Material | Instances |
|---|---|---|---|
| `gullBody` InstancedMesh | merged body, head and beak, about 40 tris, vertex colours | shared `MeshLambertMaterial({vertexColors:true})` | 6 |
| `gullWing` InstancedMesh | bent quad, 4 tris, pivot at the shoulder | same material | 12 (2 per gull; the left wing is mirrored with `scale.x = -1`). The flap is a roll in the matrix, folded when perched. |
| `fish` InstancedMesh | 8-tri diamond with a tail notch | `MeshBasicMaterial` tinted toward the shallow colour, `transparent`, opacity .55, `depthWrite:false` | 24. The tail wiggle is a yaw in the matrix. |
| `dolphin` Mesh | merged body, fin and flukes, about 120 tris | shared Lambert | 1 |
| `turtle` Mesh | merged shell, 4 flippers and head, about 100 tris | shared Lambert | 1 (only one circler is visible at a time) |

**Draw calls: 4** (gull bodies, gull wings, fish, the visible circler). There are no new lights and no shader edits, so nothing recompiles. Wildlife casts no shadows. The instanced meshes use `frustumCulled = false`, because their bounds would otherwise need per-frame updates.

**Graphics.** `ctx.options.graphics` is read every frame with a string compare, so changes apply live.

| Setting | Gulls | Fish | Circler |
|---|---|---|---|
| `low` | 3 | 1 school (12), no tail wiggle | yes |
| `medium` | 5 | 2 schools (24) | yes |
| `high` | 6 | 2 schools (24) | yes |

The circler takes one `ctx.ocean.getHeight` sample per frame. Fish use the mean water level.

## Pure plan (exported for tests, no THREE)

```js
export const WILDLIFE_SEED = 0x5eaf00d;
export function mulberry32(a)                       // -> () => [0,1)
export function perchesFrom(tiles, decor)           // -> [{x,y,z,key}] sorted by key: free tiles + sail/crate/bench tops
export function gullPlan(seed, i, t, perches, out)  // fills out {state:'circle'|'descend'|'perched'|'leave', x,y,z, yaw, flap}
export function schoolCenter(seed, i, t, out)       // fills out {x, z, heading}
export function circlerAt(seed, t, out)             // fills out {kind:null|'dolphin'|'turtle', x,y,z, heading}
```

Each function fills an `out` object, so `update` reuses scratch objects. The PRNG is seeded per window (`seed ^ i * 0x9e37 ^ slot`, where `slot = floor(t / SLOT)`), so each result depends only on its inputs. `perchesFrom` reruns only when the `world.tiles` or `world.decor` reference or length changes.

## Debug (`raftDebug.content.wildlife`)

| Helper | Effect |
|---|---|
| `snapshot()` | `{t, gulls:[{x,y,z,state}], schools:[{x,z}], circler:{kind,x,z}\|null}` |
| `summonCircler(kind)` | Takes `'dolphin'` or `'turtle'`. That circler arrives now, 10 m out in front of the camera, swims one lap, and then the schedule resumes. |
| `landGull(i = 0)` | Gull `i` perches for 15 s on the perch nearest the camera's look point. |
| `schoolHere(i = 0)` | Pins school `i` 5 m ahead of the camera on the water plane until `release()`. |
| `release()` | Clears all overrides. |
| `setTime(t)` | Sets the offset so the clock reads `t`, for repeatable shots. |

Overrides are local and are never serialized.

## Save format

Nothing is saved. In solo, `serialize()` returns `undefined`, so `world.ext` gets no `wildlife` key. Host saves may carry `{t}`, which loading ignores. Old saves load unchanged.

## Test plan (`tests/wildlife.test.mjs`, pure, no THREE)

Schedule determinism:
- `gullPlan`, `schoolCenter` and `circlerAt` give deep-equal output for equal inputs, across repeat calls and fresh `out` objects. A different seed changes at least one of 50 sampled `t`.
- Sampled at 10 Hz over 10 min, positions move less than 2 m per step, except across state edges. Every gull spends time in both `circle` and `perched`. Gull `y >= 0`, and fish `y` stays in [-1.2, -0.4].
- `circlerAt` is null most of the time. When present, `hypot(x, z) >= 7`. Over 2,000 windows the dolphin share is 0.70 +/- 0.05.
- Host and guest agree: after `load({t}, 'net')`, the guest clock equals the host time, so plans match.

Perch choice:
- `perchesFrom` drops tiles that hold decor, except sail, crate and bench, which give a raised perch. Shuffled input gives identical output, and empty input gives `[]`.
- A perched gull sits exactly on a perch, and two gulls never share a perch in the same window.
- After a tile is removed, the next window picks only from the new list. With no perches, gulls keep circling.

Module (stub ctx, no scene):
- `load(undefined)`, `load('junk')`, `load({t:NaN}, 'net')` and `load({t:1e308}, 'net')` never throw.
- Solo `serialize()` returns `undefined`, and host `serialize()` returns the same object every call.
- A big clock jump snaps the offset. A 0.5 s jitter does not.

Headless: screenshot scripts call `setTime`, `landGull`, `schoolHere` and `summonCircler`, then check that `renderer.info.render.calls` grows by at most 4.
