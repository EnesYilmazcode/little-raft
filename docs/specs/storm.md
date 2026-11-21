# Spec: Friendly storms + Lightning Rod

Source: docs/features/storm-research.md. Cozy rules: **nothing is ever hurt, broken, burnt or lost to weather**. storm.js never calls
`ctx.hurtPlayer`, never removes tiles or decor, and bolts only land on open sea (20 m or more from the raft) or on a Lightning Rod.
New files: `dist/storm.js` (content module + pure helpers), `dist/storm-model.js` (THREE builders), `tests/storm.test.mjs`.
Edits (one small block each, they merge-conflict with other branches): dist/daynight.js, dist/ocean.js, dist/audio.js, dist/content.js,
dist/content-items.js, dist/settings.js, dist/icons.svg, dist/survival-ui.js (SPRITES), dist/craft-book.js. **No game.js edit.** No `?build=` on new imports.

## 1. Storm schedule (dist/daynight.js, pure, beside `weatherAt` l.106)
```js
export const STORM_P = 0.35, STORM_EASE = 40, STORM_TAIL = 5;  // salt 3 = storm roll
export function isStormSegment(seed, i) { return weatherIndex(seed, i) === 2 && hash01(seed, i, 3) < STORM_P; }
export function stormAt(seed, clock, out) // -> out {storm:0..1, index, start, end, on:bool}; no allocation
```
- `on = isStormSegment(seed, i)` for `i = segmentIndexAt(seed, c)`. `storm = on ? smooth(start, start+STORM_EASE, c) * (1 - smooth(end-STORM_EASE-STORM_TAIL, end-STORM_TAIL, c)) : 0`.
  Rain is already 1 at `start` (it blends in over the previous segment's last 25 s) and fades over `end-25..end`, so storm ≤ rain always holds.
- Shares: rain is .2 of segments, storms .2 × .35 = **7 %** (about one 3-6 min storm per hour). WEATHERS, the rain/wind/cloud tables and
  every existing daynight test stay unchanged; old worlds keep their weather and some old rain segments become storms (harmless).
- Co-op: pure in (seed, clock), which daynight already syncs. No new message, no new save field in `daynight`.

## 2. daynight.js edits (minimal, all inside createDayNight)
- Export a live object next to `DAYNIGHT_LIVE` (l.32): `export const STORM_LIVE = { ready:false, level:0, on:false, index:0, start:0, end:0, clock:0, seed:0, nf:0, pin:-1, flash:0, dirty:false };`
  daynight writes the rest; storm.js writes `flash` (0..1), `pin` (debug only, -1 = schedule) and `dirty` (daynight clears it).
- `const S = { storm:0, index:0, start:0, end:0, on:false };` beside `W` (l.144). In `refreshSky` (l.489) after `weatherAt` (l.492):
  `stormAt(seed, clock, S); const stm = STORM_LIVE.pin >= 0 ? STORM_LIVE.pin : pinWeather >= 0 && pinWeather !== 2 ? 0 : S.storm;` then copy S and stm into STORM_LIVE (`level = stm`, `nf = L.nightFactor`).
- **One storm block, absolute values, no compounding** (refreshSky rewrites every value from PAL each call):
  right after the `setSRGB` line (l.496) multiply cHorizon, cZenith, cDeep, cShallow, cHemiSky, cCloud by `1 - 0.35*stm` and cSun by `1 - 0.5*stm`.
  Then in the existing lines: fog `near *= 1 - 0.3*stm`, `far *= 1 - 0.25*stm` (l.503); sun intensity `*= 1 - 0.4*stm` (l.515);
  hemi intensity `*= 1 - 0.25*stm` (l.518), and store that value as `hemiBase`; exposure `- 0.1*stm` stored as `expBase` (l.520);
  `grow += 0.25*stm` (l.539); `rainUniforms.uWind.value = W.wind + 0.5*stm` (l.554, slanted streaks; uRain stays ≤ 1, rain.js rates unchanged).
  sky.js follows the darker uSky via `follow()`, so it needs no edit.
- Flash in `applyVisuals` (l.560), after the refresh check: `const fl = STORM_LIVE.flash;` and if `fl > 0 || flashWas`:
  `hemi.intensity = hemiBase + FLASH_HEMI*fl; renderer.toneMappingExposure = expBase + FLASH_EXP*fl; flashWas = fl > 0;` with
  `FLASH_HEMI = 1.6, FLASH_EXP = 0.35`. Additive to the cached base, never multiplied. No new light.
- `debug.setStorm(v)` is not needed: the pin goes through `STORM_LIVE.pin` (§9), and `skyDirty = true` is set by storm.js via `STORM_LIVE.dirty = true`,
  read and cleared in the applyVisuals refresh test (l.563). Getter on the module (l.728): `get storm() { return STORM_LIVE.level; }`.
- `update()` (l.633): `STORM_LIVE.ready = true; STORM_LIVE.clock = clock; STORM_LIVE.seed = seed;`. `dispose()` sets `STORM_LIVE.ready = false`.
  `createDayNightOff` never sets ready, so `?daynight=off` means no storms at all.

## 3. Waves: `ocean.setAmp(a)` (dist/ocean.js, about 10 lines, **in scope**)
- Shader: `uniform float uAmp;` above `void wave` (l.33) and `a *= uAmp;` as the first line of `wave()` (scales height, Q·a shift and normals together).
- `uAmp: { value: 1 },` in `uniforms` (after l.203). CPU: keep `AMP0 = AMP.slice()` and `QA0` (the W[o+4], W[o+5] values) after l.307, and
  `function setAmp(a) { a = clamp(a, 0.5, 1.6); if (a === amp) return; amp = a; uniforms.uAmp.value = a; for i: AMP[i] = AMP0[i]*a; W[o+4] = QA0[2i]*a; W[o+5] = QA0[2i+1]*a; }`.
  getHeight / getSlope / sample are untouched, and at a = 1 the tables are bit-identical. Add `setAmp` to the return (l.354).
- storm.js calls `ctx.ocean?.setAmp?.(1 + STORM_AMP*level)` with `STORM_AMP = 0.3` only when the value moved by > 0.002 (crests ≈ y .09 < deck .2).
  level is a 40 s ease, so it never jumps. `dispose()` calls `setAmp(1)`. Host and guest compute the same level, so buoyancy matches.

## 4. Strikes (pure, exported from dist/storm.js, salts 4-7)
```js
export const STRIKE = Object.freeze({ LEAD: 30, END: 45, GAP_MIN: 6, GAP_SPAN: 12, MAX_K: 62, R_MIN: 20, R_SPAN: 60, ROD_PULL: 32, TOP: 70 });
strikeId(i, k) = i * 64 + k                                   // k 0..62; 63 is reserved and never scheduled
strikeTime(seed, i, k) = segmentStart(seed,i) + LEAD + Σ_{j<=k} (GAP_MIN + GAP_SPAN*hash01(seed, strikeId(i,j), 4))   // O(k), once per strike
valid only while strikeTime < segmentStart(seed, i+1) - END and k <= MAX_K
strikePos(seed, id, out) -> out.a = 2π*hash01(seed,id,5), out.r = R_MIN + R_SPAN*hash01(seed,id,6)   // raft-relative, world axes
rodFor(seed, id, r, rodKeys) -> r < ROD_PULL && rodKeys.length ? rodKeys[floor(hash01(seed,id,7)*rodKeys.length)] : null
```
- About 20 % of strikes are within 32 m and get pulled to a rod when one exists; a 3-6 min storm makes 8-23 strikes, so a rod gets roughly 2-4 shards.
- `rodKeys` = sorted `"x,z"` keys of `stormrod` decor. Both peers have the same `world.decor`, so they draw the same bolt. Strikes are always
  ≥ 6 s apart, so at most 2 flash pulses in any second (WCAG 2.3.1: ≤ 3).
- Per-frame driver in storm.js keeps `segI, k, tNext, lastClock`. Each frame with `STORM_LIVE.on`: while `lastClock < tNext ≤ clock` fire strike k, then
  advance. If clock went backwards or jumped > 2 s (guest snap, sleep skip, load) it **resyncs** k/tNext to the first strike after clock without firing.
  Guests run the same driver (visual + thunder only). Strikes run off `S.on` from the schedule, not the debug pin.

## 5. Flash, bolt, thunder (each client, local)
- Mode: `m = ctx.options?.stormFlash ?? 'full'`; if `m === 'full'` and `reduced.matches` → `'soft'` (`reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')`, made once at create, read live).
- `flashAt(t, mode)` pure, t = seconds since the strike. full: 1 over 0-0.06, down to 0.2 by 0.11, 0.7 at 0.16-0.2, 0 by 0.32 (two pulses).
  soft: `0.25*sin(π t/0.6)` for t < 0.6, a single slow glow. off: 0. Scaled by `clamp(1.15 - r/100, 0.4, 1)` (r = 3 for a rod hit). Written to STORM_LIVE.flash each frame.
- Bolt: full mode only. One pooled `Mesh` (§7), rewritten in place once per strike from top (x, TOP, z) to the water (y 0) or the rod tip, visible for 0.3 s,
  opacity follows flashAt. In soft and off modes the bolt stays hidden; thunder and the darker sky stay.
- Thunder: a single pending slot `{at, s}` (strikes are ≥ 6 s apart, so one slot is enough). `delay = 0.6 + 2.4*clamp((r-20)/60, 0, 1)` (0.35 s on a rod),
  `s = clamp(1.1 - r/90, 0.3, 1)`. When `ctx.elapsed ≥ at`: `ctx.play('thunder', s)`. Local only, never sent.
- audio.js: add `'thunder'` to EVENTS (l.23), `thunder: 1.5` to MIN_GAP (l.31), and a recipe after `deny` (l.404), effects bus, ≤ 2 s, white `graph.noise`
  (1.5 s buffer, so each burst ≤ 1.4 s):
  `thunder(v,t,s){ v.bus = filter(v,'lowpass',300+900*s,0.6,v.bus); burst(v,t,'bandpass',700,0.8,0.12*s*s,0.004,0.25);`
  `const a = burst(v,t+0.03,'lowpass',160,0.9,0.5*s,0.08,1.3); a.frequency.exponentialRampToValueAtTime(70,t+1.4); burst(v,t+0.55,'lowpass',110,0.9,0.35*s,0.25,1.15); }`

## 6. Items, recipes, decor (dist/content-items.js)
Metal kinds verified in dist/items.js: `metalingot` (l.123), `copperingot` (l.126), `glass` (l.129). Append after the kiln block (l.24 / l.59):
| id | name | icon | cost | notes |
|---|---|---|---|---|
| `stormshard` | Storm Shard | `icon-stormshard` | not craftable | only from a rod; `item(..., false)` |
| `stormrod` | Lightning Rod | `icon-stormrod` | metalingot 2, copperingot 1, wood 2 | decor, block radius .15 |
| `stormlamp` | Storm Lantern | `icon-stormlamp` | stormshard 2, glass 1, metalingot 1 | decor, block .12 |
| `stormglass` | Storm Glass | `icon-stormglass` | stormshard 1, glass 1 | decor, block .1; forecasts the next storm |
Add the three decor ids to CONTENT_DECOR (l.78) and radii to CONTENT_BLOCK_RADIUS (l.79). Research gating is automatic (storage-research.js
`learnedFrom` derives from RECIPES): the rod unlocks when metal bar, copper bar and wood are known; lamp and glass unlock after a shard is studied.
SPRITES in survival-ui.js (l.22-23): add `stormrod, stormshard, stormlamp, stormglass`; symbols in icons.svg before `</svg>` (l.584), 48×48 like `icon-kiln`.
craft-book.js: stormrod "A tall metal rod with a copper tip." / "Place it on the raft: in a storm it catches lightning and grows Storm Shards.";
stormshard "Glassy sand fused by lightning." / "Make a Storm Lantern or a Storm Glass."; stormlamp "A lantern with a humming blue shard." / "Glows soft blue at night.";
stormglass "A sealed glass of cloudy crystals." / "Look at it to see when the next storm comes."

## 7. Models (dist/storm-model.js, MODEL-STYLE: rbox bevels, vertex colours, one merged mesh per material, y = 0 base)
Each builder `buildX(T)` returns `{ instance(), dispose() }` like kiln-model.js; materials shared by all instances.
- **Lightning Rod** `storm_rod` (≤ 900 tris, 0.45×2.6×0.45): dark wood plinth rbox .42×.12×.42 with 4 rust bolt heads; metal post (`#8e989e`)
  cylinder r .045 from .12 to 2.3; copper (`#d98a4e`) collars at 1.2 and 2.0; copper cone tip r .07 h .28 with a .05 ball; a copper cradle cup at y .9
  on +x holding 3 shard slots. `userData.rod = { slots:[m0,m1,m2], tip:[0,2.6,0] }`, slots visible by `n`. Meshes: wood, metal, copper, shard.
- **Storm Shard** (≤ 300 tris): 3 tapering 5-sided prisms fused at the base, 0.18 tall, flat shaded, pale cyan `#bfefff` vertex colour,
  emissive `#7fd8ff` at 0.6. Used in rod slots (scale .6) and inside the lamp.
- **Storm Lantern** `storm_lamp` (≤ 1800 tris, .3×.55×.3): sibling of buildGlassLamp. Wood base disc, 4 metal posts and cap ring, frosted cyan glass
  cylinder (emissive `#7fd8ff`), a shard cluster inside. **Emissive only, no light**; the group name must not match daynight's `craft_lantern`/`craft_candle`
  scan, so it never takes a pool light. storm.js sets the shared glass/shard emissiveIntensity `0.35 + 1.25*nf` (+0.3 while `level > 0.5`) only when the value changes.
- **Storm Glass** `storm_glass` (≤ 1200 tris, .3×.5×.3): wood base, clear glass cylinder r .07 h .42 (transparent .55, depthWrite false), brass cap,
  white crystal cluster inside; `userData.crystals` scale.y eases 0.3 (fair) → 1 (storm within 5 min or now).
- **Bolt** (module-owned, not decor): one `BufferGeometry` with a preallocated `Float32Array` for a 12-segment main path + 5-segment branch, each as two
  crossed ribbons (main 0.5 m wide, branch 0.25): 76 verts, 68 tris. Jitter from `hash01(seed, id, 8 + n)`. `MeshBasicMaterial({color:'#e8f4ff',
  transparent:true, blending:AdditiveBlending, depthWrite:false, fog:false, toneMapped:false})`, `frustumCulled = false`, added to ctx.scene, hidden when idle.

## 8. Slice, actions, prompts (dist/storm.js, kiln.js pattern)
- `world.ext.storm = { v:1, r, rods:{ "x,z": { n:0..3, last:id } } }`. `cleanSlice(v, decorAt?)`: non-object → empty; `r` int ≥ 0 else 0; keys match
  `/^-?\d+,-?\d+$/`, and (when decorAt is given: save/restore) the tile holds `stormrod`; `n` int clamped 0..3 else 0; `last` int ≥ -1 else -1;
  entries with n 0 and last -1 dropped; at most 256 entries. `serialize()` is cached by `(st, st.r)`; `load(d,'net')` skips a repeated `r` (kiln l.55-64).
- **Reward (host only, in the strike driver):** `award(st, key, id)`: `e = st.rods[key] ?? {n:0,last:-1}`; if `id <= e.last` return false (once-per-strike guard,
  survives a clock re-sync); `e.last = id; if (e.n < 3) e.n++; st.rods[key] = e; st.r++`. When n grew: `ctx.emit({kind:'loot', text:'Zap! The Lightning Rod caught a Storm Shard (n/3)'}, 'all')`.
- Host 1 s prune: drop entries whose tile no longer holds `stormrod` (bump r).
- `action(a, actor, bag)`: claims every `storm.*` kind (returns true). `storm.collect {x,z}`: guest-sent actions are ignored on a guest; x, z integers;
  `decorAt(x,z) === 'stormrod'`; actor position (host physics / `ctx.other` for guest) within 3.2 m of `(x*2, z*2)`; `n > 0` else notice
  "No shards yet. Wait for a storm"; `left = bag.add('stormshard', n)`; `n - left === 0` → `full` "Your bag is full"; else `e.n = left; st.r++`, loot "+k Storm Shard(s)".
- `interact(aim)`: on a rod with n > 0 → `ctx.action({kind:'storm.collect', x, z})`, true; otherwise false (inventory opens as usual).
- `prompt(aim)` (target ray as kiln `target`, cached on key, r and level bucket): rod with n → `<kbd>E</kbd>Collect n Storm Shard(s)`;
  rod empty in a storm → "Lightning Rod · waiting for a strike"; rod otherwise → "Lightning Rod · catches lightning in storms";
  storm glass → "Storm Glass · Storm now!" / "· A storm in about N min" / "· Fair skies for a good while" (forecast: scan `isStormSegment` forward up to 24 segments, once per second).
- HUD hint, local on every client: when `STORM_LIVE.on` and `level > 0.05` for a new `index` → `ctx.notice('A storm is rolling in', 4000)` (pickup feed, bottom-left,
  never centred). With no rod placed and the rod recipe learned, add `ctx.notice('Lightning Rods catch Storm Shards')` once per session.

## 9. Debug: `raftDebug.content.storm`
`state()` (slice, level, on, index, next strike {k, t, r, rod}, flash mode) · `force(level = 1)` / `force(null)`: sets `STORM_LIVE.pin` + `dirty`; while forced
and no real storm, a local driver strikes every 8 s (salt-8 jitter, visual + thunder only, never rewards) · `strike({rod:'x,z'} | {a, r})`: one strike now, visual only,
≥ 1 s since the last · `place(x, z, type = 'stormrod')` (host, like kiln `spawn`) · `fill(x, z, n)` (host, sets shards) · `give(kind, n)` · `next()` → `{index, start, inSec}`
of the next real storm · `renderInfo()`. Screenshot recipe: `place(0,1)`, `fill(0,1,2)`, `force(1)`, `strike({rod:'0,1'})`.

## 10. Registration and settings
- content.js: `import { createStorm } from './storm.js';` after l.45 and add `createStorm` to FEATURES (l.47) **right after `createDayNight`**. Module `name: 'storm'`.
  It imports `STORM_LIVE, isStormSegment, segmentStart, segmentIndexAt, hash01` from daynight.js and never uses `peek` per frame.
- settings.js SPEC after `shadows` (l.23): `stormFlash: { tab: 'graphics', label: 'Lightning flashes', type: 'select', options: ['full', 'soft', 'off'], def: 'full' },`
  (renders as Full / Soft / Off; validateSettings handles it; not in PRESETS). Read live via `ctx.options.stormFlash`.
- Old saves: no `ext.storm` → `load(undefined)` → empty rods, r 0. Older builds drop `ext.storm` and the unknown kinds (content-items.js header).
  No power.js import; a later battery top-up would go through an optional `power.*` action.

## 11. Performance budget
- No storm: `update` reads STORM_LIVE, runs the 0.5 s rod/lamp rescan (kiln childCount pattern) and returns. Storm: O(1) per frame plus O(k ≤ 62) once per strike.
- **No per-frame allocation**: scratch Vector3s, out objects for stormAt/strikePos, rodKeys array reused (rebuilt only on rescan), prompt string cached.
- Draw calls: bolt +1 for 0.3 s per strike; rod 4 meshes, lamp 3, storm glass 3 per instance; flash 0 (no lights, no shadow); rain unchanged (600 streaks).
- Shader cost: one extra multiply per wave in the ocean vertex shader. Check `renderInfo()` before/after in a storm on graphics `low`.

## 12. Tests: tests/storm.test.mjs (node:test, stub ctx like daynight.test.mjs)
1. Schedule determinism: `stormAt` equal across two calls and two "clients" with the same (seed, clock); different seeds differ; `isStormSegment` only on rain segments.
2. Share: 200 000 segments × 3 seeds → storms 7 % ± 0.5 % of segments, 35 % ± 1.5 % of rain; weather shares still .5/.3/.2 (daynight tests untouched).
3. Ease: storm 0 at `start` and at `end - 5`, 1 mid-segment, step 0.5 s changes < 0.03, and storm ≤ `weatherAt().rain` everywhere.
4. Strike schedule: times strictly increase, gaps in [6, 18], all inside [start + 30, end - 45], k ≤ 62, positions r in [20, 80], same for two clients;
   `rodFor` null with no rods or r ≥ 32, deterministic pick, ≈ 20 % pulled over many strikes.
5. Driver: a clock jump of 60 s or backwards fires nothing and resyncs; a normal 1/60 s step fires each strike exactly once; ≤ 3 flash pulses in any 1 s window.
6. Rod reward guard: `award` same id twice → one shard; lower id → no-op; cap 3 (last still moves); r bumps only on change; guest role never awards.
7. `storm.collect`: wrong decor, non-integer x, out of reach, n = 0, bag full (shards stay) all refused; success moves shards to the actor's bag; non-storm kinds → false.
8. `cleanSlice`: null/array/string, NaN/99/-1 n, bad keys, a key with no rod (save path), non-int last, 300 entries → valid and capped; idempotent.
9. Old save: `load(undefined, 'save')` → `{v:1, r:0, rods:{}}`; net load with the same r is a no-op (no rescan flag).
10. `flashAt`: full ≤ 1 and 0 after 0.32 s; soft ≤ 0.25; off 0. Settings: `validateSettings({stormFlash:'x'}).stormFlash === 'full'`, 'soft' kept.
11. ocean: `setAmp(1.3)` then `setAmp(1)` gives bit-identical `getHeight` to a fresh ocean; `uniforms.uAmp.value` follows; clamp 0.5..1.6. audio: EVENTS has 'thunder'.
12. Safety: storm.js source has no `hurtPlayer`; FEATURES order has createStorm after createDayNight; `?daynight=off` stub → level 0, no strikes.
