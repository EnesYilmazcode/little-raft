# Spec: Sky Rockets (fireworks)

Source: docs/features/fireworks-research.md. Cozy rules: no damage, no fire, nothing is lost but the rocket itself. Launches work by day too (never refused); they just look best at night.
Craft Sky Rockets, set one on a deck tile, aim at it and press E. It fizzes for 1.6 s, whistles up 25-35 m, pops into coloured sparks and briefly lights the sky. Both co-op players see the same burst.
Logic goes in the new content module `dist/fireworks.js` (pure top half plus the `createFireworks(ctx)` factory). Models and the particle material go in the new `dist/fireworks-model.js` (it is given THREE and imports nothing).
New modules are imported with `?build=v3-survival-ae77fa84ac2b`. **Never import `dist/paint.js`** (not on this branch); v1 has no paint dependency.

## 1. Item and recipe (dist/items.js)
| id | name | category | stack | recipe | unlock |
|---|---|---|---|---|---|
| `skyrocket` | Sky Rocket | decor, `placeable:true` | 20 | `hand({ plastic: 2, leaf: 1, scrap: 1 }, 3)` (a 3-pack) | `discover('plastic', 'scrap')` |
- Insert after `candle` (`items.js:183-185`) under a `// [fireworks]` comment: `item('skyrocket', 'Sky Rocket', 'decor', { placeable: true, stack: 20, iconTint: '#e9a08c', recipe: …, unlock: …, tip: 'A paper-and-plastic rocket on a little stand. Press E to light it, best after dark!' })`.
  Plastic is the tube, the leaf is the paper wrap and fuse, and the scrap is the spark powder. These are all early materials, so rockets are cheap.
- `BLOCK_RADII` (`items.js:218-222`): add `skyrocket: 0.1, // [fireworks]`. `PLACEABLE_IDS` feeds `DECOR_TYPES` in game.js, so game.js needs no edit for placement.
- `dist/craft-book.js`: `CATEGORY_OF` (:23) `skyrocket: 'survival'`; `ITEM_TEXT` (:82) `skyrocket: { desc: 'A little sky rocket on a stand.', use: 'Place on a tile, then press E to launch it.' }`.
- `dist/item-svg.js` `ITEM_ICONS` (after the bees block, :215+): an original 48x48 icon with a striped coral tube, a cone cap, a stick stand and a small four-point star. Use the same stroke style (`O`, width 2).
- Held pose: none. The generic fallback in held-items.js is used.

## 2. State: `world.ext.fireworks`
`{v:1, n}`. `n` is a non-negative int launch counter (clamped to `0..2**31-1`, junk gives 0). The module name is `'fireworks'`.
- An unlit rocket is ordinary decor `{type:'skyrocket', x, z, rot?}`. `cleanWorld` (game.js:167-182) keeps `type,x,z,rot`, so it saves and syncs with no new code. There is no per-rocket state.
- Colour and shape are **deterministic**: `fwRoll(x, z, n)` gives `{c, s}` from a 32-bit integer hash of `(x, z, n)`. `c = (h >>> 8) % 6` and `s = h >>> 0`. The host bumps `n` after every launch, so the same tile gives a new show each time. A lit rocket is transient: a reload mid-flight just loses the show.

## 3. Pure API in dist/fireworks.js (no DOM, no Date, no Math.random in the helpers)
```js
export const FUSE = 1.6, RISE = 1.3, REACH = 2.6, HOST_SLACK = 2, HEAR_RANGE = 80, FLASH_GAP = 0.5, RECV_MAX_PER_S = 6;
export const SHAPES = Object.freeze(['sphere', 'ring', 'willow']);
export const COLORS = Object.freeze(['#ff9a7a', '#ffe08a', '#8fffd6', '#8cc8ff', '#e8e2ff']); // bright night versions of the paint.md palette (coral, sunshell, seafoam, lagoon, pebble)
// c = 0..4: one colour; c = 5: 'mix', where each spark picks COLORS[rnd*5]
export const BUDGET = Object.freeze({ low: { slots: 2, sparks: 60, trail: 12 }, medium: { slots: 3, sparks: 120, trail: 24 }, high: { slots: 4, sparks: 160, trail: 24 } });
export function cleanFw(v)                  // -> {v:1, n}
export function hash32(a, b, c)             // int mix (for example Math.imul-based murmur finaliser) -> uint32
export function fwRoll(x, z, n)             // -> {c: 0..5, s: uint32}
export function shapeOf(s)                  // -> 0|1|2 = s % 3
export function heightOf(s)                 // -> 25 + ((s >>> 4) & 255) / 255 * 10   (metres above the deck)
export function burstLife(shape)            // -> 2.0 (sphere, ring) | 3.2 (willow)
export function cleanFwMsg(e)               // -> {x, z, c, s} or null: x,z ints in -64..64, c int 0..5, s uint32 (any extra field ignored)
export function windowGate(max, ms = 1000)  // copy of instruments.js:51 (do not import instruments.js)
export function hearGain(d)                 // 0 when d >= HEAR_RANGE, else max(.2, 1 - d/HEAR_RANGE)
export function flashLevel(t)               // envelope for t s after a peak: 0..0.25 attack, 0.25..1.05 decay, 0 after
export function budgetFor(graphics)         // BUDGET[graphics] ?? BUDGET.medium
```

## 4. Content module `createFireworks(ctx)` (name `'fireworks'`)
- Register in `dist/content.js` `FEATURES` (:32) **after** `createBees` (so it runs after `createDayNight`): `import { createFireworks } from './fireworks.js?build=…'; // [fireworks]`.
- `load(data, from)`: `st = cleanFw(data)` for every `from`. `serialize()`: returns `st` (it is tiny, so no cache).
- `target(aim)`: copy `bees.js:116-136` with `d.type === 'skyrocket'`, the aim point at deck + .3 m and the same .85 m cone. It returns `{x, z}` or null.
- `prompt(aim)`: target → night (`ctx` night ≥ .3) `<kbd>E</kbd>Light the sky rocket`; otherwise `<kbd>E</kbd>Light the sky rocket (best after dark)`.
- `interact(aim)`: no target → false. Else `ctx.action({kind:'fw.light', x, z})`, `ctx.play('ui', .4)`, true. The guest predicts nothing: an old host ignores the action and nothing is lost.
- `action(a, actor, bag)`: claim only `a.kind === 'fw.light'`. `x`,`z` must be ints. The pose is `actor === 'guest' ? ctx.other : ctx.physics`; reject (return true, no emit) if the pose is missing or `hypot(x*2 - pose.x, z*2 - pose.z) > REACH + HOST_SLACK`. Find `i = ctx.world.decor.findIndex(d => d.type === 'skyrocket' && d.x === x && d.z === z)`. If `i < 0`, return true silently (a double press or both players at once launches once). Else `decor.splice(i, 1)`, `ctx.rebuildRaft()`, `{c, s} = fwRoll(x, z, st.n)`, `st.n = (st.n + 1) % 2**31`, then
  `ctx.emit({kind:'fw', x, z, c, s, sound:'none'}, 'all')` (**no `text` field**, see section 8) and `ctx.award({kind:'firework'})`.
- `effect(e)`: `e.kind !== 'fw'` → false. Otherwise `m = cleanFwMsg(e)`; if it is null or the gate (`windowGate(RECV_MAX_PER_S)`) refuses, return true (consumed, silent). Else `launch(m.x, m.z, m.c, m.s)` and return true.
- `launch(x, z, c, s, freezeAt?)`: pick a free slot, or recycle the one with the largest age. Set the pad to `ctx.raft.localToWorld(v.set(x*2, deckTop, z*2))` (reused scratch Vector3; `deckTop = ctx.deckY()`), with `t = 0`, `shape = shapeOf(s)`, `h = heightOf(s)`, colour and spin from `s`, and `sounded = 0`. Call `ctx.play('ui', .3*g)` as a fuse fizz, where `g = hearGain(distance from ctx.physics to pad)`. Do nothing if g = 0 and the camera is more than 200 m away.
- `update(dt)`: no allocation. For each live slot: `t += dt` (unless frozen). At `t >= FUSE` and once only → `ctx.play('whistle', g)`. At `t >= FUSE + RISE` once → `ctx.play('pop', g)`; for sphere and willow, at `+0.15 s` once → `ctx.play('crackle', g)`; register a flash peak (section 6). At `t > FUSE + RISE + burstLife` → free the slot (`uSlot.w = -1`). Then write the uniforms (section 5) and apply the flash.
- `decorModel(type)`: `'skyrocket'` → `createRocket(T)`, else null (this also feeds the ghost at game.js:389).
- `dispose()`: remove the Points and the flight meshes from the scene, dispose the geometry and materials, and restore hemi only if this module still owes a flash offset.
- `debug` (`raftDebug.content.fireworks`): `launch(x = 0, z = 0, shape = 0, t)` runs a local launch with no host action or decor and a forced shape (it picks s with `s % 3 === shape`). If `t` is a number, the slot is frozen at that age (for example `t = FUSE + RISE + .6` for a full burst). `unfreeze()`, `state()` (a JSON copy of `st`), and `slots()` → `[{t, shape, c, frozen}]`.

## 5. Particles and models (dist/fireworks-model.js)
- `createRocket(T)`: a Group `craft_skyrocket` with its origin at the deck top, about .15 x .5 m. It has a coral/cream striped tube (2 stacked cylinders r .035, #e9a08c / #fff3cf), a cone cap (#f1d78d), a thin stick (#9c7649), a 3-leg wire stand, and a short dark fuse. MeshStandardMaterial, flat shading.
- `createFlight(T)`: the same silhouette with **MeshBasicMaterial** (unlit, so it never changes light-dependent shader variants), plus a small emissive-looking tip sphere. The module keeps `slots` of these, hidden, in `ctx.scene`. One is shown at the pad during the fuse and moves up the rise path; it is hidden at the burst. On `low` the rise is drawn by trail points only (no mesh).
- `createSparkPool(T, {slots, sparks, trail})` → `{points, uniforms}`: one `T.Points` with a `BufferGeometry` of `slots * (sparks + trail)` vertices. The attributes are **baked once** and never uploaded again: `position` (zeros, required), `aRnd` vec4 (from a fixed LCG seeded 1), `aSlot` float, `aKind` float (0 = spark, 1 = trail/fuse).
  - `ShaderMaterial`: `transparent`, `depthWrite:false`, `blending:T.AdditiveBlending`, `fog:false`, `toneMapped:false` (like the stars, daynight.js:342). `points.frustumCulled = false`, `points.raycast = () => {}`, `renderOrder = 11`. It is added to `ctx.scene`, never to `ctx.raft` (so lantern scans, `scanHives` and `rebuildRaft` never see it).
  - Uniforms are arrays sized by `slots`: `uSlot[S]` vec4 (pad xyz, t; t < 0 means hidden), `uShape[S]` vec4 (shape, height, spin angle, colour index c), plus `uColors[5]` vec3, `uPx` (= drawing-buffer height / 2 / tan(fov/2), updated on resize) and `uMaxPx` (24 * pixel ratio). The CPU writes only these.
  - Vertex shader, kind 1: during the fuse it draws small sparks spraying 0.1-0.4 m from the pad. During the rise the vertices are spaced along the path `y = pad.y + h * (1 - (1 - u)^2)` (u = rise progress) behind the head, and they fade.
    Kind 0 (hidden until the burst): `dir` from `aRnd`: **sphere**, a uniform unit sphere, speed 7-9; **ring**, `(cos θ, .12*(r-.5), sin θ)` tilted by the spin, speed 8; **willow**, a sphere, speed 4-5, gravity x3, life 3.2 s, colour pulled 60 % toward warm gold `#ffcf7a`.
    `p = burst + dir*speed*(1-exp(-2.5*a))/2.5 + vec3(0, -1.2*a*a, 0)` (a = burst age). Alpha `(1 - a/life)^1.5` with a little per-spark twinkle from `aRnd.w`. `gl_PointSize = clamp(size * uPx / -mv.z, 1., uMaxPx)`.
  - Fragment shader: a soft round dot (`smoothstep` on `gl_PointCoord`) times colour and alpha. Mix (c = 5) picks `uColors[int(rnd*5)]`.
  - The budget is read once from `budgetFor(ctx.options.graphics)` at creation. At most 4 x 184 = 736 points, in one draw call.

## 6. Sky flash (no new lights)
- **Never add a PointLight** (adding one changes the light count and recompiles every lit material, see game.js `warmShaders`). Use only the existing `ctx.hemi`.
- At most one flash peak per `FLASH_GAP` (0.5 s), however many rockets burst: a burst inside the gap does not retrigger the peak (no strobe).
- Each frame after day/night has written hemi (this is guaranteed by the FEATURES order): `f = flashLevel(now - peakAt) * night`; `hemi.intensity += 0.35 * f`; `hemi.color.lerp(burstColour, 0.25 * f)` (using a reused Color).
  Day/night rewrites both every frame (daynight.js:501-502), so nothing drifts. When `night === 0` (day, or `?daynight=off`, where nothing rewrites hemi) skip the flash entirely, so hemi is never touched.
- Night accessor: daynight.js:680 return object gains `get night() { return L.nightFactor; }`. content.js (after `rain()`, :61) gains
  `night() { const m = mods.find(m => m.name === 'daynight' && !m.dead); const n = m?.night; return Number.isFinite(n) ? n : 0; }, // [fireworks]`.
  The fireworks module reads it through `ctx.night?.() ?? 0` (see section 7, contentCtx).

## 7. Every hook (file:function)
| File | Function / place | Change |
|---|---|---|
| dist/items.js | `LIST`, `BLOCK_RADII` | `skyrocket` item, radius .1 |
| dist/craft-book.js | `CATEGORY_OF`, `ITEM_TEXT` | category and text |
| dist/item-svg.js | `ITEM_ICONS` | icon |
| dist/content.js | imports, `FEATURES`, `createContent` return | append `createFireworks`; add `effect(e) { for (const m of mods) if (call(m, 'effect', e)) return true; return false; }` and `night()`; document `effect(e)` in the header |
| dist/game.js | `effect()` (:800) | after the `prog?.effect` line (:803), **before** the loot/notice/play fallthrough: `if (content?.effect?.(e)) return; // [fireworks]` |
| dist/game.js | `contentCtx` (:375) | add `play: (ev, s) => play(ev, s), award: ev => award(ev), night: () => content?.night?.() ?? 0, // [fireworks]` |
| dist/daynight.js | `createDayNight` return (:680) | `get night()` |
| dist/audio.js | `EVENTS` (:23), `MIN_GAP` (:31), `recipes` (:250) | `whistle` (.25), `pop` (.12), `crackle` (.2) |
| dist/logbook.js | `ACHIEVEMENTS` (:27), `evaluate` `holds` (:83) | `a('firework1', 'Sky Sparkle', 'Launch your first sky rocket.', 'compass')` before `homestead`; `case 'firework1': return ev.kind === 'firework';` |

game.js gets exactly two edited lines (the effect hook and contentCtx). `award` is a host-only no-op on a guest (game.js:818), and the module calls it only in `action`.

## 8. Audio (dist/audio.js, existing `tone`/`burst`, effects bus)
- `whistle(v, t, s)`: `tone(v, t, 'sine', 900, .08*s, .02, 1.0, 2400)` + `burst(v, t, 'bandpass', 3000, 2, .03*s, .02, .9)`. This stays under the 6.5 kHz master low-pass.
- `pop(v, t, s)`: `burst(v, t, 'lowpass', 700, .8, .5*s, .001, .12)` + `tone(v, t, 'sine', 110, .35*s, .002, .25, 55)`. Soft and round, never a bang.
- `crackle(v, t, s)`: 8 x `burst(v, t + rand(.2, .9), 'highpass', rand(4000, 6000), 1, .04*s, .001, .03)`. Each segment is far below the 1.5 s noise buffer.
- These must pass `tests/survival.test.mjs:1066-1078` (every EVENT plays on the mock context). Gain for all launches is `hearGain(distance from the local player to the pad)`, so a partner's rocket on a far raft is quieter or silent. Remote and local launches use the same rule.

## 9. Save compat and co-op
- **Saves:** unlit rockets are decor and round-trip with no code. `world.ext.fireworks` is cleaned by `cleanFw`, and a missing slice gives `n = 0`. An **older build** drops the unknown decor type and resets a bag holding `skyrocket`. This is the same known limitation as the bees, rain and instruments specs, so say so in the PR. Old achievement lists drop `firework1` via `cleanProgress`.
- **New host, new guest:** the guest sends `fw.light` → the host validates, splices the decor and emits `{kind:'fw',…}` to `'all'` → both peers run `content.effect` → identical bursts (same `s`). The decor removal syncs through `hostState().world.decor`.
- **Old host, new guest:** the old host ignores `fw.light` (no content module claims it). Nothing happens and nothing is lost.
- **New host, old guest (verified against game.js:800-807):** the old `effect()` has no content hook. With no `loot` and no `text`, no notice is shown, but it calls `play(e.sound ?? … 'deny')`. **Decision:** the host always sets `sound:'none'`. On an old peer, `play('none')` returns false silently, because `audio.js play()` rejects unknown names via `hasOwnProperty(recipes, event)` (:503). So the old guest just sees the rocket vanish, with no deny buzz. New peers return early at the hook, before the `sound` field is read.
- The hook must sit before the notice/play fallthrough, or a new peer would also play 'deny'. Section 10 has a test for this.

## 10. Tests: tests/fireworks.test.mjs (node:test, `RAFT_DIST` idiom from tests/bees.test.mjs)
1. `cleanFw`: junk (undefined, null, [], 'x', {n:-1}, {n:1.5}, {n:2**40}) → `{v:1, n:0}` or clamped; a valid n is kept.
2. `fwRoll` is deterministic, `c` is in 0..5, and `s` is a uint32. Over 300 values of n on one tile all 6 colours and all 3 shapes appear. `heightOf` is in [25, 35].
3. `cleanFwMsg` rejects non-int x/z, out-of-range c, negative or float s, and non-objects. It ignores extra fields.
4. `windowGate(6)` allows 6 and refuses the 7th inside 1 s. `hearGain` is 1 at 0, the floor .2 near the range, and 0 at ≥ 80. `flashLevel` is 0 at t < 0 and t > 1.05, and peaks near .25.
5. Host action (stub ctx as bees.test, a real THREE scene): it removes exactly one `skyrocket` at the tile, calls rebuildRaft once, emits one `{kind:'fw'}` with `sound:'none'` and no `text` to `'all'`, bumps n, and awards `{kind:'firework'}`.
   An out-of-reach guest pose, a wrong tile, a non-int x, and a second press all emit nothing and leave decor unchanged. A non-`fw.light` kind returns false.
6. `effect`: a valid msg returns true and fills a slot. A junk msg returns true and fills nothing. `{kind:'loot'}` returns false. More than the budget recycles the oldest slot, and the slot count never exceeds `budgetFor(graphics).slots`.
7. Model: the spark pool vertex count equals `slots*(sparks+trail)` for each preset. The attributes have no `needsUpdate` after 100 updates (version unchanged). `frustumCulled === false`. The module adds no `T.Light` to the scene. `createRocket` has the name `craft_skyrocket`.
8. Flash: with a stub daynight writing `hemi.intensity = .5` each frame and night 1, two bursts 0.2 s apart give one peak. With night 0, hemi is untouched.
9. game.js source check (string test, like the hook tests): the `content?.effect?.(e)` line appears before `notice(e.text` inside `function effect`.
10. Logbook: `evaluate(world, [], {kind:'firework'})` includes `firework1`, and an old progress list containing `firework1` survives `cleanProgress`. Audio: EVENTS includes whistle, pop and crackle (the survival test covers playback).
- QA: `raftDebug.content.fireworks.launch(0, 0, 2, 4.0)` freezes a willow burst for screenshots. Check `renderInfo()` (daynight debug) draw calls rise by at most 1 plus the flight meshes. Check a night and a day screenshot, and a co-op e2e where the guest lights one and both see it.

## Build notes (deviations from the spec)
- **Pad height:** `launch` uses the raft-space tile top `ctx.deckY() - raft.position.y + .02` before `raft.localToWorld`. Passing `deckY()` (a world height) straight into `localToWorld` would count the raft height twice.
- **Burst size:** the shader uses drag `1.4` instead of `2.5` in `dir*speed*(1-exp(-k*a))/k`. With 2.5 a sphere was only about 3 m across and read as a smudge at 30 m. Spark sizes (.9 m sphere/ring, .75 m willow, .3 m rise tail, .03 m fuse) and a small white-hot core in the fragment shader were tuned from headless screenshots. The gravity term follows the spec (`-1.2*a*a`, x3 for willow).
- **Flight mesh:** one merged, vertex-coloured `MeshBasicMaterial` mesh per slot (one draw call each). The wire stand stays behind. The decor rocket (`craft_skyrocket`) is likewise one baked flat-shaded mesh inside the Group.
- **Draw calls when idle:** `points.visible` is false while no slot is live, so idle cost is 0. The pool and flights are created visible (flights parked at y = -1000) so the start-up `warmShaders` compile includes them, and the first `update` hides them.
- **Sound gain** is recomputed from the local player's current distance at each stage (fizz, whistle, pop, crackle), not only once at launch.
- **Gate clock:** `effect` feeds `windowGate` with `performance.now()`. Frame `dt` is clamped to .25 s.
- **Extra debug helpers:** `flash()` (peaks, peakAt, owed), `budget()`, `px()` (point-size uniforms) and `target(aim)`.
- **tests/logbook.test.mjs** now expects 16 achievements, with `firework1` before `homestead`. `raftDebug.logbook.totals.achievements` in game.js is still a hard-coded 15. I left it alone because the spec allows only two game.js edits.
- **Smoke test** used Python Playwright (the Node package is not installed). It loaded a save with rockets, set night, lit a real rocket with E (`n` went to 1 and `firework1` was awarded), then froze sphere, ring and willow bursts. No page errors.
- **Not done:** the two-browser co-op e2e (the guest lights a rocket and both peers see it). That path is covered only by unit tests: emit `'all'`, the `effect` hook and `sound:'none'`.
