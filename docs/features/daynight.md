# Day, night and weather

Status: **built** (see section 10 for what shipped and how to verify it). Branch `claude/raft-content-daynight`.
Code lives only in `dist/daynight.js` (plus `dist/daynight-*.js` helpers if it grows) and
`tests/daynight.test.mjs`. **No game.js edits are needed**: everything goes through the module
shape in `dist/content.js` and the ctx getters listed in `docs/features/content-hooks.md`.

## 1. What Raft does

raft.wiki.gg could not be read. In this pass `/wiki/Weather` failed DNS resolution from the
session sandbox (host not in the allowed network list). Earlier passes got HTTP 401 or a "Blocked"
page, and raft.fandom.com returned 402. The facts below come from pages that could be read. Lines
marked *unverified* are common player knowledge.

| Topic | What Raft does | Source |
|---|---|---|
| Day length | Players time a full cycle at 13 to 20 real minutes, about two thirds day. No official number. | [Steam (2021)](https://steamcommunity.com/app/648800/discussions/0/5673948479042064974), [Steam (2023)](https://steamcommunity.com/app/648800/discussions/0/3819662797149669011) |
| Night | Dark enough that the raft is hard to see. Beds skip it. | [Raft fandom, Lantern (old rev.)](https://raft.fandom.com/wiki/Lantern?oldid=5114) (snippet) |
| Lanterns | Researched, then crafted. Lights a small area at night. | same |
| Weather | *Unverified:* calm alternates with rain and storms (rough waves, dark sea, lightning). | [Wikipedia](https://en.wikipedia.org/wiki/Raft_(video_game)) (premise only) |

We keep a ~20 min cycle, a moody but readable night, lanterns that matter, and weather that
changes the look of the sea. We leave out darkness you cannot see in, a night you must skip,
lightning, storm damage and any survival pressure.

## 2. Our version

- **Cycle.** `DAY_SECONDS = 1200`. Phase `p` in [0,1), `p = 0` at sunrise. Day 0 to 0.62, dusk
  0.62 to 0.70, night 0.70 to 0.94 (4.8 min), dawn 0.94 to 1.
- **Readable night (brightness floor).** `light = max(NIGHT_FLOOR, curve(p))` with
  `NIGHT_FLOOR = 0.38`. Concretely, at deep night: `hemi.intensity >= 0.75` (day 1.8),
  `sun.intensity >= 0.55` as a blue moon light (day 2.5), and
  `renderer.toneMappingExposure >= 0.85` (day 1.0). Nothing in gameplay depends on time of day.
- **Sky.** Keyframed palette (dawn peach, day sage `#cbd2c0`, dusk coral, night indigo). The
  horizon colour drives `scene.background`, `scene.fog.color` **and** `ocean.uniforms.uSky`
  together (see 4.2), so the sea's distance fade keeps blending into the sky.
- **Stars.** One `THREE.Points`, 450 points on a radius-140 sphere, follows the camera position.
  `opacity = nightFactor * (1 - cloud)`, twinkle in the vertex shader. Moon: one billboard disc
  opposite the sun direction.
- **Weather.** `calm` (today's look), `breezy` (more cloud, cooler tint, `wind` 0.7 for other
  modules), `rain` (grey-green sky, darker sea, fog far 125 to 80, sun -15%, rain streaks).
  Waves never change, so `ocean.getHeight`, physics, hook and debris are untouched.
- **Schedule.** Segments of 180 to 360 s. Segment `i`'s state and length are a pure hash of
  `(seed, i)`. Weights calm 0.5, breezy 0.3, rain 0.2, and rain never follows rain. 25 s blends.
  Co-op only needs `clock` and `seed`.
- **Lanterns.** Glow and pool lights scale with `nightFactor` (section 5).
- **Opt out.** `?daynight=off` or localStorage `little-raft.daynight = "day"` (try/catch) pins
  mid-morning calm.

## 3. Module shape (`createDayNight(ctx)` in `dist/daynight.js`)

| Hook | Behaviour |
|---|---|
| `name` | `'daynight'` (slice `world.ext.daynight`) |
| `update(dt)` | host/solo: `clock += dt`. Guest: `clock += dt + drift correction` (section 6). Then derive state and write visuals. Zero allocations. |
| `serialize()` | returns one reused object `{v:1, clock, seed}` (clock rounded to 0.01 s). The registry JSONs it. |
| `load(data, from)` | `cleanDayNight(data)`. `null` keeps current/default state. `'save'`/`'restore'` snap; `'net'` feeds the drift filter. |
| `debug` | section 8 |
| `dispose()` | remove stars, moon, rain, 4 point lights; restore cloud materials, fog, exposure, ocean uniforms; dispose own geometries/materials |
| others | not used (`action`, `interact`, `prompt`, `craftLocked`, `decorModel`, `afterMove`) |

Pure exports (no WebGL, used by tests):

```js
export const DAY_SECONDS = 1200, NIGHT_FLOOR = 0.38, WEATHERS = ['calm', 'breezy', 'rain'];
export function phaseAt(clock)                 // -> [0,1); NaN/negative -> 0
export function lightAt(phase, out)            // fills {sunHeight, nightFactor, light}
export function segmentAt(seed, index, out)    // fills {weather, start, length}
export function weatherAt(seed, clock, out)    // fills {weather, weatherNext, blend, rain, wind, cloud}
export function paletteAt(phase, rain, out)    // fills preallocated Float32Array(3 * N_COLORS)
export function cleanDayNight(v)               // -> {v:1, clock, seed} | null
export function driftStep(local, target, dt)   // -> corrected local clock (section 6)
```

## 4. What ctx gives us, and what we touch

All read through ctx getters every frame (they are live; `scene` is replaced on rejoin).

### 4.1 Scene and lights
- `ctx.scene.background` (a `T.Color`) and `ctx.scene.fog` (`T.Fog('#cbd2c0', 25, 125)`): write
  `.color` / `.near` / `.far` in place. Never replace the objects.
- `ctx.sun` DirectionalLight (`#fff0c7`, 2.5, position (-15,28,12), shadow camera +-25): move
  `position` on an arc around the raft at the same radius, set `color` / `intensity`. By night it
  becomes the moon light (from the opposite side, cool `#9fb4e6`). It keeps casting shadows, so the
  light count and shadow setup never change.
- `ctx.hemi` HemisphereLight (`#f2ead4` / `#3d6b6a`, 1.8): `color`, `groundColor`, `intensity`.
- `ctx.renderer.toneMappingExposure` (1.0 by day, floor 0.85). The getter is already in
  `contentCtx` even though content.js's header comment does not list it.
- `ctx.camera`: position for stars, moon, rain and lantern ranking.

### 4.2 Ocean (`dist/ocean.js`)
The ocean fragment shader ends with `mix(col, uSky, smoothstep(uFadeNear, uFadeFar, dist))`, and
reflections use `mix(uSky, uZenith, R.y)`. To keep the horizon seamless:
- `uSky` **must equal** the fog/background colour every frame (game.js sets all three to `#cbd2c0`).
- `uFadeFar` follows `fog.far` (125 by default, 80 in rain). `uFadeNear` stays at 28.
- `uZenith` (`#a9c1c0`), `uDeep` (`#14505a`), `uShallow` (`#3f8c88`) come from the palette.
  Night darkens deep and shallow by about 55%, not to black.
- `uSunDir` = normalised sun/moon position, `uSunColor` = sun colour times a specular factor
  (0.25 at night so the moon glint stays soft).
- Capture the starting values at create time and restore them in `dispose()`.

### 4.3 Clouds
`ctx.clouds` is 24 Groups of icosahedron spheres whose material comes from game.js's shared
`mat('#e7f9eb')` cache. **Do not tint the shared material**, because other meshes may use the same
colour. At create time, give every cloud mesh one module-owned `MeshStandardMaterial` (built once),
remember the original material, and put it back in `dispose()`. Per frame, tint that one material
(dusk pink, night slate, rain grey) and, in `breezy`/`rain`, nudge group `x` with the wind
(wrapping at +-85).

### 4.4 Sky dome
`dist/sky.js` (`createSky`) is **not imported anywhere** (grep for `createSky` and `sky.js` in
dist finds only the file itself). We do not mount it: it would add a draw call and a full-screen
shader for little gain over background plus fog. If it is mounted later, daynight drives its
`uHorizon/uZenith/uSunColor/uSunDir/uCloudLit/uCloudShade/uCoverage` from the same palette.

### 4.5 Lanterns (`ctx.raft`)
Lanterns are decor built by `createCraft(T, 'lantern')` in `rebuildRaft()`, which places each group
at `(d.x*2, .22, d.z*2)` in raft-local space. Each call creates **its own** materials, so every
lantern is tinted separately. Mesh names to drive:

| Mesh name | Base `emissiveIntensity` | Night |
|---|---|---|
| `lanternGlow` | 1.6 | x2.0 |
| `flame` | 3.0 | x1.6 |
| `lanternGlass` | 0.6 | x2.5 |
| `candle` | 0.25 | x2.0 |

(`lanternTimber`, `lanternSteel`, `lanternBrass`, `lanternRope` stay as they are.) There is no
"raft rebuilt" hook, so: every 0.5 s compare a cheap signature (`raft.children.length` plus the
number of `'lantern'` entries in `world.decor`). When it changes, walk `raft.children` once and fill
preallocated arrays (cap 64 lanterns): material refs, base intensities, and the lantern's local
position. Emissive = `base * (1 + (mult - 1) * nightFactor)`. The fallback lantern box (built when
crafts.js fails) has no named meshes and is ignored.

## 5. Lantern pool lights (fixed count)

- `POOL_LIGHTS = 4` `T.PointLight('#ffb35c', 0, 7, 2)`, `castShadow = false`, added to the scene
  in `createDayNight` **before the first render** and never removed until `dispose()`. The count
  never changes, so no shader recompiles.
- By day (`nightFactor < 0.15`) intensity is exactly 0. Above that it eases to 2.2 at full night.
- Every 0.5 s, rank lanterns by distance to the camera (preallocated Float32Array, partial
  selection of 4) and copy `raft.localToWorld(scratch)` + (0, 1.25, 0) into the lights. Between
  ranks, positions follow the raft each frame via the cached local positions. Unused lights get
  intensity 0.

## 6. Save and co-op sync

- Slice: `world.ext.daynight = {v:1, clock, seed}`. `clock` is seconds since world start
  (finite, 0 to 1.2e9). `seed` is a uint32.
- An old save gives `load(undefined, 'save')`, so the module keeps its default: `clock = 0.10 *
  DAY_SECONDS` (morning) and a random seed. The first save writes the slice.
- **Host** serializes about 8 times a second. That is ~40 bytes and one reused object, no
  allocations beyond what the registry does.
- **Guest `load(data, 'net')`** must not snap on every message (that would stutter 8 times a
  second, since messages arrive with jitter):
  - store `target = data.clock` and the local time it arrived. Between messages the target advances
    by dt too, so `err = target - clock`.
  - `|err| > 5 s` or a seed change (join, host debug jump): snap `clock = target`, `seed = data.seed`.
  - otherwise, `driftStep` slews: `clock += dt + clamp(err * 0.5 * dt, -0.1 * dt, 0.1 * dt)`, so
    time never runs backwards and never more than 10% fast or slow. A 1 s drift closes in ~10 s,
    which no one can see.
  - Same data twice is a no-op (idempotent). No meshes are ever rebuilt on load.
- `'restore'` (guest back on its own raft) snaps to the saved slice. Weather follows from
  `(seed, clock)` on both peers, so rain starts at the same moment for both.

## 7. Rain budget

- One `THREE.LineSegments`: **600 streaks = 1,200 vertices**, one draw call, `frustumCulled =
  false`, `depthWrite = false`, transparent. Hidden (`visible = false`) when `rain < 0.01`, so
  0 draw calls in dry weather.
- The positions are a static `Float32Array` built once: random (x, y, z) in a 30 x 18 x 30 box,
  plus a per-vertex `aTop` attribute (0/1) for the streak end. Nothing is written on the CPU per
  frame. Only 3 uniforms change: `uTime`, `uRain`, `uCam` (vec3, copied from camera position).
- The vertex shader wraps each streak into a box anchored to world space around the camera:
  `p = uCam + mod(base - uCam + vec3(0, -uTime*9, 0) + wind*uTime, box) - box*0.5`. Streak length
  is 0.5 m with a slight wind slant. Alpha is `uRain * 0.35`, fading with distance.
  Thinning: streaks with `index/1200 > uRain` collapse to zero length, so
  light rain draws fewer visible streaks at the same cost.
- Cost: about 1.2k vertices and a few thousand fragments of thin lines. That is negligible next to
  the ocean mesh.

**Total added cost:** stars 1 draw, moon 1, rain 0 or 1, and 4 point lights (fixed). Per frame:
about 60 float lerps into preallocated `T.Color`/`Float32Array`, about 15 uniform/colour writes,
and N lantern material writes (N <= 64). There is no `new`, closure, array literal or `.clone()`
in `update`.

## 8. Debug (`raftDebug.content.daynight`)

- `setPhase(p)`: host/solo sets `clock = day * DAY_SECONDS + p * DAY_SECONDS` (guests see it on
  the next message as a > 5 s jump, so they snap). On a guest it is a local pin.
  `setPhase(null)` clears a pin.
- `setWeather('calm' | 'breezy' | 'rain')`: pins the weather with no blend, local only, for
  screenshots. `setWeather(null)` returns to the schedule. Invalid names are ignored.
- `state()`: returns a plain copy `{phase, day, clock, seed, nightFactor, light, weather,
  weatherNext, blend, rain, wind, cloud, lanterns, poolLit, pinned}`. Allocating here is fine,
  because it is debug only.

## 9. Test plan (`tests/daynight.test.mjs`, pure functions only)

Imports use the same `base` pattern as `tests/survival.test.mjs`. The suite is picked up by the
existing `tests/*.test.mjs` glob.

1. **phaseAt:** `phaseAt(0) === 0`; `phaseAt(3 * DAY + 300) ≈ 0.25`; never returns 1; NaN,
   negative and Infinity give 0.
2. **lightAt:** `light >= NIGHT_FLOOR` for 10,000 phases; nightFactor ≈ 0 at 0.31 and ≈ 1 at
   0.82; a step of 0.001 changes `light`/`nightFactor` by < 0.02, including the 0.999 to 0 wrap;
   it returns the same `out` object.
3. **Weather schedule determinism:** the same `(seed, clock)` gives deep-equal output across calls
   and across fresh imports; different seeds diverge within 20 segments; segment lengths are 180
   to 360; rain never follows rain; shares over 2,000 segments are 0.5/0.3/0.2 +- 0.05; `blend`
   is monotonic inside a transition and `rain`/`wind`/`cloud` stay in [0,1].
4. **Palette lerp:** at each key phase the output equals the key colour (within 1e-6); midway
   between keys it is the average; all channels are in [0,1]; continuous across the wrap; with rain
   1 the horizon equals the rain tint blend; it writes into the passed buffer (same identity).
5. **cleanDayNight / validate:** it rejects undefined, null, strings, arrays, `{}`, NaN/Infinity/
   negative/over-1.2e9 clock, and fractional, negative or >= 2^32 seeds, returning null and never
   throwing. It accepts a valid object, returns a fresh copy with unknown keys stripped, and
   tolerates `v` missing or 0 by migrating to v1.
6. **Round trip:** `cleanDayNight(JSON.parse(JSON.stringify(serialize())))` equals the slice.
7. **driftStep:** a large error snaps; a small error converges in < 15 simulated s; the clock is
   strictly increasing for any dt > 0; it is idempotent when `target === local`.
8. **Module without WebGL:** `createDayNight` with a stub ctx (plain T objects, `raft = new T.Group()`)
   runs `load(undefined, 'save')`, `load('garbage', 'net')` and `update(1/60)` x 10,000 without
   throwing; light count and scene child count stay constant; pool light intensity is 0 at noon.

Screenshots (separate playwright script, after the code lands): dawn 0.97, noon 0.31, dusk 0.66,
night 0.82 with a lantern placed, rain day, rain night. The night shot must show the deck clearly,
the stars and a warm pool around the lantern.

## 10. As built

Everything lives in `dist/daynight.js` (one file, ~520 lines) and `tests/daynight.test.mjs`.
No shared file (game.js, content.js, inventory-state.js) was touched. `ctx.renderer` is used for
the exposure; it is already a getter in `contentCtx`.

**What shipped**

- 20 minute cycle with the phases of section 2. `lightAt` gives `nightFactor` (0 by day, 1 from
  0.72 to 0.92) and `light = max(0.38, ...)`. At deep night hemi is 0.75, the directional light is a
  cool moon at 0.6 (0.55 floor) and exposure is 0.85.
- Eight palette keys (sunrise peach, day sage x2, dusk coral, blue hour, cosy blue night x2,
  predawn) for horizon, ocean zenith/deep/shallow, sun/moon colour, hemi sky/ground and clouds.
  The horizon colour drives `scene.background`, `scene.fog.color` and `ocean.uSky` together, so the
  sea still fades seamlessly into the sky. Rain pulls every colour toward a cool grey-green of the
  same brightness (`rainBlend`, 65%).
- The sun moves on an arc (east to west, tilted south). At night the same DirectionalLight becomes
  the moon, which rides lower (about 40 degrees at midnight) on the opposite side. The light's height
  is clamped so shadows never stretch across the whole raft at dawn and dusk.
- Ocean: `uSky`, `uZenith`, `uDeep`, `uShallow`, `uSunDir`, `uSunColor` (glint fades at the horizon,
  soft 0.18 moon glint) and `uFadeFar` (follows fog: 125 dry, 80 in rain). **Addition:** `uFoam` is
  also dimmed and tinted at night, because white foam glared on a dark sea in the first night shots.
- Clouds get one module-owned material (originals restored on dispose) with a soft emissive term,
  so their undersides read as lit puffs instead of dark slabs (they were dark in the old look too).
  Wind drifts them in breezy/rain; cloud cover scales them up to 1.35x.
- Stars: one `Points` (450, additive, twinkle in the vertex shader, fade toward the horizon).
  Moon: one billboard quad with a shader disc and halo. Both are hidden when invisible.
- Weather schedule exactly as section 2. Segment `i` starts at `i*270 + jitter(+-45)`, so lengths
  are 180 to 360 s and the segment for any clock is found in O(1). Raw weights calm .4236 / breezy .3
  / rain .2764 give the 0.5 / 0.3 / 0.2 shares after the "no rain after rain" rule.
- Rain: one `LineSegments`, 600 streaks (1,200 vertices) in a 14 x 10 x 14 m box around the camera,
  all motion in the vertex shader, hidden when dry.
- Lanterns: emissive boost on `lanternGlow` x2.4, `flame` x1.6, `lanternGlass` x1.6, `candle` x2.0
  (glass was lowered from the design's 2.5, which washed the amber out to white). Four
  `PointLight('#ffb35c', 0 to 5, range 8, decay 2)` follow the nearest four lanterns with a gentle
  flicker. Peak raised from the design's 2.2 to 5 so the warm pool on the deck is clearly visible.
- Co-op: as section 6. One detail changed: `driftStep(local, target, dt)` takes both clocks at the
  start of the frame and the caller then advances `target += dt`, which removes a one-frame bias.
  `load(data,'net')` with the same clock twice is a no-op.
- Opt out: `?daynight=off` or `localStorage['little-raft.daynight'] = 'day'` pins phase 0.15, calm.

**Debug (`raftDebug.content.daynight`)**: `setPhase(p|null)`, `setWeather(name|null)`,
`freeze(bool)` (stop the clock for screenshots), `giveLantern(n)` (adds lanterns to your bag),
`placeLantern(x, z)` (gives one and places it on tile x,z through the normal build action),
`renderInfo()` (renderer draw calls / triangles / points / lines of the last frame) and `state()`.

**How to verify**

1. `npm test`: 13 day/night tests (pure functions, headless module with a stub ctx, save round
   trip, driftStep, and a two-minute co-op simulation with jittery, lossy, duplicated messages).
2. In the browser console after clicking Play solo:
   `d = raftDebug.content.daynight; d.freeze(true); d.placeLantern(1, 0); d.setPhase(0.82)`. You
   should see a blue night with stars, a moon up and to the left of the start view, readable deck
   and a warm pool around the lantern. `d.setWeather('rain')` shows streaks and a closer fog;
   `d.setPhase(0.655)` is dusk; `d.setPhase(null); d.setWeather(null); d.freeze(false)` resumes.
3. A playwright script that does this headless is described in the report: it seeds
   `localStorage['little-raft-v1']` with three lanterns and a bench in `decor`, clicks `#solo`,
   freezes the clock and walks through the phases.

Screenshots: `docs/cloud/shots/content/daynight-morning.png`, `daynight-dusk.png`,
`daynight-night.png` (lanterns), `daynight-rain.png`.

**Cost** (measured, see report): stars +1 draw call at night, moon +1, rain +1 only while
raining. Four point lights are always present, so every lit material evaluates four extra lights
(the main frame-time cost, fixed and shader-stable). The per-frame update does no allocation.

**Known issues**

- The sky is a single colour (background + fog). Dusk reads as an even coral wash rather than a
  gradient; mounting `dist/sky.js` would fix that at the cost of one full-screen draw.
- Rain streaks are 1 px WebGL lines, so they look thin at high resolutions.
- The four point lights add fragment cost to every standard material all day long (at intensity 0).
