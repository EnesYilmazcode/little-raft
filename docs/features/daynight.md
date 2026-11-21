# Day, night and weather

Status: design. Branch `feature/daynight`. Code goes in a new `dist/daynight.js`, with a small delimited hook in `dist/game.js`.

## 1. What Raft does

The brief said to confirm against raft.wiki.gg. Every fetch of raft.wiki.gg (`/wiki/Weather`, `/wiki/Lantern`, `/wiki/Bed`, plus `?action=raw`) returned a wiki.gg "Blocked" page or HTTP 401 to automated clients. raft.fandom.com returned HTTP 402. The facts below come from the sources that could be read. Lines marked *unverified* are common player knowledge that no fetched page confirmed.

| Topic | What Raft does | Source |
|---|---|---|
| Day length | Players time a full cycle at roughly 13 to 20 real minutes. One thread estimates "24 game hours is around 20 real minutes", split about 13 to 15 min of day and about 7 min of night. Another player timed waking up to the next chance to sleep at "13 minutes and 15 seconds". No official number exists. | [Steam thread (2021)](https://steamcommunity.com/app/648800/discussions/0/5673948479042064974), [Steam thread (2023)](https://steamcommunity.com/app/648800/discussions/0/3819662797149669011) |
| Night | Night is dark enough that the raft is hard to see. Beds and hammocks let players skip it. | [Raft fandom, Lantern (old revision)](https://raft.fandom.com/wiki/Lantern?oldid=5114) (search snippet) |
| Lanterns | The lantern is researched, then crafted. It lights a small area so the raft is easier to see at night. It can be hung on a wall, hung under a floor, or set anywhere on the raft. The wiki notes it is "useless" if you own a bed, because you skip the night. | same |
| Weather | *Unverified:* calm weather alternates with rain and storms. Storms bring rougher waves, a darker sky and sea, rain, and lightning (which lightning rods catch). Rain fills rain collectors. | [Wikipedia, Raft](https://en.wikipedia.org/wiki/Raft_(video_game)) covers the general premise only |
| Danger | Sharks circle the raft and bite off parts of it. Survival needs hunger and thirst. Early storms are something players mostly ride out. | [Wikipedia, Raft](https://en.wikipedia.org/wiki/Raft_(video_game)), [NME feature](https://www.nme.com/features/raft-is-a-brilliant-castaway-from-traditional-survival-games-3377275) |

What we take from Raft: a cycle of about 20 minutes with roughly two thirds day, a night that changes the mood of the raft, lanterns that matter at night, and weather that changes how the sea looks.

What we leave out: being unable to see at night, a night you have to skip, lightning, storm damage, and any survival pressure.

## 2. Our version, friendlier and lean

- **Cycle.** One full day is `DAY_SECONDS = 1200` (20 min). Phase `p` runs from 0 to 1, with `p = 0` at sunrise. Day covers 0 to 0.62 (12.4 min), dusk 0.62 to 0.70, night 0.70 to 0.94 (4.8 min), and dawn 0.94 to 1.0. The night is shorter than Raft's, so nobody needs a bed.
- **Never too dark.** A moon (a directional light reusing the sun light, tinted blue) and a hemisphere floor keep the scene at least `NIGHT_FLOOR = 0.38` as bright as noon. Deck, items and the hook all stay readable. No mechanic depends on the time of day.
- **Sky.** Key colours are lerped along the cycle (dawn peach, day sage, dusk coral, night indigo): horizon, zenith, sun colour and cloud colours. `scene.background` and `scene.fog` follow the horizon, so the sea's distance fade still blends in.
- **Stars.** One static `THREE.Points` with 450 points on a sphere of radius 140 that follows the camera. Opacity is `nightFactor * (1 - cloudiness)`, and twinkle runs in the vertex shader. The moon is one billboard disc opposite the sun.
- **Weather.** Three gentle states:
  - `calm`: the current look.
  - `breezy`: more cloud cover, slightly cooler colours, sails and cloth flutter harder (exposed as `wind` 0 to 1 for other modules), and a stronger wind bed in the audio if audio exposes it.
  - `rain`: light rain. Grey-green sky, deeper and darker sea, fog pulled in from 125 to about 80, and about 15% less sun. Rain streaks fall around the player. There is no lightning, no damage and no bigger waves, so `ocean.getHeight` stays exactly as it is and physics, hook and floating debris behave the same.
- **Schedule.** Weather comes in segments of 180 to 360 s. Each segment's state is a pure function of `(seed, segmentIndex)` with weights calm 0.5, breezy 0.3 and rain 0.2. Rain never follows rain. Transitions blend over 25 s. Because it is deterministic, co-op only has to sync `clock` and `seed`.
- **Lanterns.** When `nightFactor > 0.15`, lanterns warm up. Emissive intensity on the `lanternGlow`, `flame` and `lanternGlass` meshes from `crafts.js` scales from 0.4x by day to 2.2x by night. A fixed pool of 4 `PointLight`s (warm `#ffb35c`, distance 7, decay 2, no shadows) is always in the scene. By day they sit at intensity 0. Every 0.5 s they move to the 4 lanterns nearest the camera. The light count never changes, so three.js never recompiles shaders.
- **Opt out.** `?daynight=off`, or the per-viewer localStorage key `little-raft.daynight` set to `"day"` (in try/catch), pins the scene at mid-morning calm. A Settings toggle can come later, because `settings.js` is being edited on another branch.

## 3. Data model

```js
// persistent (saved + synced)
{ v: 1, clock: 431.7, seed: 2654435761 }   // clock = seconds since world start (float), seed = uint32

// derived each frame, never saved (one preallocated object, mutated in place)
state = {
  phase,        // 0..1, (clock / DAY_SECONDS) % 1
  day,          // integer day count, floor(clock / DAY_SECONDS)
  sunHeight,    // -1..1
  nightFactor,  // 0 day .. 1 deep night, smooth
  light,        // NIGHT_FLOOR..1 overall brightness
  weather,      // 'calm' | 'breezy' | 'rain' (current segment)
  weatherNext,  // state being blended toward
  blend,        // 0..1 within the 25 s transition
  rain,         // 0..1 rain intensity (blended)
  wind,         // 0..1 (calm .15, breezy .7, rain .45)
  cloud,        // 0..1 cloud coverage
}
```

Palettes are module-level `Float32Array` keyframes: 5 time keys, each with horizon, zenith, sun, hemiSky, hemiGround, deep, shallow and cloud, plus a rain tint table. Lerps write into preallocated `T.Color` targets. Nothing is allocated per frame.

## 4. Save format

- It lives at `world.daynight = { v: 1, clock, seed }`, saved with the rest of `world` by the existing `save()`.
- `cleanWorld()` in game.js copies only the keys it knows, so the hook adds `daynight: cleanDayNight(v.daynight)` to its return object.
- `cleanDayNight(v)` returns a fresh object or `null`. It checks that `clock` is finite, at least 0 and at most `DAY_SECONDS * 1e6`, and that `seed` is an integer from 0 to 2^32 - 1.
- **Backward compatible.** An older save has no `daynight`, so `cleanDayNight` returns `null`. `createDayNight` then starts at `clock = 0.10 * DAY_SECONDS` (morning) with a random seed. The first save writes the field. Older builds that load a new save simply drop the field, because their `cleanWorld` ignores unknown keys. Nothing breaks in either direction.
- Guest backups (`normaliseBackup`) go through `liveWorld` → `cleanWorld`, so a guest's own raft keeps its time when the guest returns from a visit.

## 5. Co-op sync

- The host is authoritative. `hostState().world` gains `daynight: dayNight.snapshot()`. That adds about 40 bytes to a message that already goes out every 0.12 s.
- The guest calls `dayNight.applySnapshot(msg.world.daynight)`. If `|clock - local| > 2 s`, or the seed differs, the guest snaps to the host's values. Otherwise it keeps advancing locally with no jitter. Weather is derived from `seed` and `clock`, so both players see the same rain at the same moment.
- An older host sends no `daynight`, and the guest keeps its own cycle. An older guest ignores the field.

## 6. API (`dist/daynight.js`)

```js
export const DAY_SECONDS = 1200, NIGHT_FLOOR = 0.38, WEATHERS = ['calm', 'breezy', 'rain'];

// pure, testable without WebGL
export function phaseAt(clock)                       // -> 0..1
export function lightAt(phase, out)                   // fills out {sunHeight, nightFactor, light}; returns out
export function weatherAt(seed, clock, out)           // fills out {weather, weatherNext, blend, rain, wind, cloud}
export function cleanDayNight(v)                      // -> {v:1, clock, seed} | null

// runtime
export function createDayNight(T, {
  scene, camera, sun, hemi,          // required: existing DirectionalLight + HemisphereLight
  ocean,                             // optional: uses ocean.setPalette?.() else ocean.uniforms.*
  sky,                               // optional: uses sky.setPalette?.()/setCoverage?.() if present
  lanterns,                          // optional: () => iterable of lantern Object3D (cached by game.js)
  saved,                             // cleanDayNight() result or null
  enabled,                           // default true; false pins mid-morning calm
}) -> {
  update(dt),                        // advance clock, apply visuals; call once per frame after ocean.update
  state,                             // the live derived-state object (read only)
  snapshot(),                        // -> {v:1, clock, seed} (returns a reused object; callers JSON it)
  applySnapshot(s),                  // guest sync, tolerant of null/garbage
  setDebug({phase, weather}),        // pins phase and/or weather for QA shots; null clears
  dispose(),                         // removes stars, moon, rain, point lights; disposes geometry/material
}
```

**Hooks for sky and ocean.** Both are optional, and every call is guarded:

- `ocean.setPalette({deep, shallow, sky, zenith, sunColor})` and `ocean.setSunDirection(v3)`. When missing, daynight writes straight into `ocean.uniforms.uDeep`, `uShallow`, `uSky`, `uZenith`, `uSunColor` and `uSunDir`, which already exist.
- `sky.setPalette({horizon, zenith, sunColor, cloudLit, cloudShade})`, `sky.setCoverage(c)` and `sky.setSunDirection(v3)`. When missing, it falls back to `sky.uniforms.*`. game.js does not currently mount `sky.js`, so `sky` may be undefined, and then only `scene.background`, fog and lights change.

**Debug.** If `window.raftDebug` exists, `raftDebug.daynight = {set: setDebug, state}` is attached so `shoot.py` and the console can force a look.

**Rain particles.** One `THREE.LineSegments` with 700 streaks in a box 30 x 18 x 30 around the camera. The positions are a static `Float32Array` built once. A ShaderMaterial computes `y = mod(baseY - uTime * 9.0, 18.0)` and sets alpha from `uRain`. `visible = rain > 0.01`. No CPU writes happen per frame.

## 7. Hook in `dist/game.js` (keep it this small)

Every change sits between `// >>> daynight` and `// <<< daynight` markers:

1. Import: `import { createDayNight, cleanDayNight } from './daynight.js?build=...';`
2. In `init()`, name the hemisphere light (`hemi = new T.HemisphereLight(...)`). After the ocean is created, add `dayNight = createDayNight(T, {scene, camera, sun, hemi, ocean, lanterns: () => lanternGroups, saved: world.daynight, enabled: !/daynight=off/.test(location.search)});`.
3. In `cleanWorld()`'s return object, add `daynight: cleanDayNight(v.daynight)`.
4. In `syncWorldInventories()`, add `world.daynight = dayNight ? {...dayNight.snapshot()} : world.daynight;`.
5. In `frame()`, add `dayNight?.update(dt);` right after `ocean.update(elapsed, camera);`.
6. In `hostState()`, add `daynight: dayNight?.snapshot()` to `world`. In the guest `'state'` handler, add `dayNight?.applySnapshot(data.world?.daynight);`.
7. In the decor build at line 355 (`createCraft(T, d.type)`), push lantern groups into a cached `lanternGroups` array (cleared on rebuild).
8. In `disposeScene()`, add `dayNight?.dispose(); dayNight = null;`.

`package.json` `test` becomes `node --test tests/` so the new test file runs. That is one line, and it is noted for the integrator.

## 8. Performance budget

- Draw calls added: stars 1, moon 1, rain 1 (hidden when dry), so +2 to +3. Point lights: a fixed 4.
- Per frame: about 40 float lerps, about 12 `Color.setRGB` calls on preallocated objects, and uniform writes. No `new`, no closures, no array building. Lantern reassignment runs every 0.5 s with a preallocated distance buffer and partial selection.
- Shader recompiles: none after the first frame, because the light count is fixed and the materials are built once.

## 9. Test plan

**Unit tests (`tests/daynight.test.mjs`, node --test, no WebGL needed except the module import):**

1. `phaseAt` wraps: `phaseAt(0) === 0`, `phaseAt(DAY_SECONDS * 3 + 300) ≈ 0.25`, and negative or NaN input gives 0.
2. `lightAt` is continuous: stepping the phase by 0.001 never changes `light` or `nightFactor` by more than 0.02, including across the 1 to 0 wrap.
3. The night floor holds: `light >= NIGHT_FLOOR` for every phase, `nightFactor ≈ 0` at noon (0.31), and `nightFactor ≈ 1` at midnight (0.82).
4. `weatherAt` is deterministic: the same `(seed, clock)` gives identical output, and different seeds give different schedules.
5. The schedule holds: no rain segment follows another, segment lengths are 180 to 360 s, calm/breezy/rain shares are about 0.5/0.3/0.2 (within ±0.05 over 2000 segments), and `blend` is monotonic inside a transition.
6. `cleanDayNight` rejects `null`, strings, NaN, negative clock, clock above 1.2e9 and fractional or negative seeds. It accepts a valid object and returns a fresh copy.
7. Backward compatibility: run an existing v3 save fixture (no `daynight`) through the same path as `cleanWorld`. It gets `null`, and `createDayNight` with `saved: null` starts at phase 0.10.
8. Round trip: `snapshot()`, then `JSON`, then `cleanDayNight`, then `applySnapshot` reproduces the clock and seed exactly.
9. No allocations: `createDayNight` against a stub scene (plain T objects, no renderer) runs `update(1/60)` 10,000 times. `state` keeps its identity, and the child counts of the scene and lights stay constant.

**Headless shots (`python shoot.py <worktree>/dist .qa/daynight-*`):** extend the probe, or run a side script, so that after spawn it calls `raftDebug.daynight.set(...)` and captures:
`dn-01-dawn` (0.97), `dn-02-noon` (0.31), `dn-03-dusk` (0.66), `dn-04-night` (0.82, with a placed lantern), `dn-05-rain-day` (0.3, rain), `dn-06-rain-night`.
Check each one by eye. The night shot must show the deck clearly, with stars and a warm pool around the lantern. The rain shots must show visible streaks and a darker sea. `report.errors` and `console` errors must be empty. The frame-time probe should stay within 5% of the baseline.

**Manual co-op check:** host and guest through `check_multiplayer.py`. Force dusk on the host, and the guest snaps within one state message. Leave and rejoin, and the guest's own raft time comes back.
