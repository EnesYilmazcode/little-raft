# Spec: Wind-up Music Box (decor + 5 original seeded tunes)

Source: docs/features/musicbox-research.md. Cozy rules: no damage, no wear, nothing is lost. The box is decor that plays tunes.
It owns one save slice, `world.ext.musicbox`. It adds no `applyAction` kind, no migration and no new bag fields. Tunes are composed in code from fixed seeds,
and there are no audio files and no existing melodies. Both peers compute the same notes and the same bar from the shared day/night clock, so no notes are ever sent over the network.
New: `dist/musicbox-core.js` (pure: no DOM, no THREE, no Date, no Math.random), `dist/musicbox-model.js` (THREE meshes; it imports nothing and is given `T`), `dist/musicbox.js` (`createMusicBox(ctx)` content module) and `tests/musicbox.test.mjs`.
Hooks are small and tagged `// [musicbox]`. Imports use the neighbouring `?build=` suffix. `STORM_LIVE` must be imported with the exact specifier storm.js:5 uses, so it is the same object.

## 1. Item, recipe, unlock, icon (dist/items.js, craft-book.js, item-svg.js)
- items.js decor block, right after `photoframe` (:261):
  `item('musicbox', 'Music Box', 'decor', { placeable:true, iconTint:'#b4824b', recipe: hand({ wood:3, nail:1, shell:2, scrap:1 }), unlock: discover('shell'), tip: 'A shell-inlaid box with a tiny turning cylinder. Press E to wind it up.' }), // [musicbox]`
- items.js `BLOCK_RADII` (:315): add `musicbox: 0.2, // [musicbox]`. `PLACEABLE_IDS` picks it up by itself (game.js:49/80). Do not add it to content-items.js.
- craft-book.js `CATEGORY_OF` (:14, next to `shelf`): `musicbox:'survival'`. Add an `ITEM_TEXT` (:57) row: `{desc:'A shell-inlaid box with a tiny turning cylinder.', use:'E to play or stop; right-click or E twice: next tune.'}`.
- item-svg.js `ITEM_ICONS` (:10): an original 48x48 drawing of a wood `#bb8650` box with the lid open, two cream shell dots on it, a brass comb inside and an amber `#ffbd66` crank on the right side. Follow `photoframe` (:199) for style.
- content.js: leave `NO_UNDECOR` (:94) alone. The box stores no items, so pickup is allowed and just stops it.

## 2. Model: `buildMusicBox(T)` in dist/musicbox-model.js
Return a Group with its origin on the deck at the tile centre and at most 20 meshes, using MeshStandardMaterial with roughness .6–.8. Every mesh has `castShadow = true` except the pins.
- `body`: a box .32 w x .15 h x .22 d in wood `#bb8650`, sitting at y .075. `trim`: a thin darker band `#8a5a33` (.33 x .02 x .23) at the top rim and one at the base.
- Shell inlay: on the front face, a rosette of 5 cream `#f1e4cf` flattened spheres (r .018, scale z .3) around a centre `#e8b9a8` pink one. On the lid's top face, 3 small cream ovals in a row.
- `lidPivot`: a Group at the back top edge (y .15, z −.11). It holds `lid`, a box .32 x .02 x .22 offset +.11 in z, with the 3 inlay ovals. `lidPivot.rotation.x` is 0 when closed and −1.75 when open (about 100°).
- `cylinder`: a CylinderGeometry r .028, length .2, 14 segments, turned with rotation.z = π/2, at y .1 and z −.03. It is brass `#c9a24a` (metalness .7, roughness .35).
  Its 18 `pins` are one InstancedMesh of .006 boxes scattered on the surface, set up once with a fixed pattern (no randomness).
- `comb`: a steel `#b8bcc4` plate .2 x .008 x .05 at z +.03, with 10 teeth (one merged geometry, or one InstancedMesh) touching the cylinder.
- `crank`: on the +x side, a small Group with an arm (.008 x .05 x .008) and a knob sphere r .012 in amber `#ffbd66`.
- Set `userData = {lidPivot, cylinder, crank}`. Nothing in the model raycasts except `body` and `lid`. The whole box must fit a 0.4 m box (test 6).

## 3. Pure composer: dist/musicbox-core.js
```js
export const TUNE_COUNT = 5, HEAR_FULL = 1.5, HEAR_MAX = 14, SWITCH_HYST = 1, LOOKAHEAD = 0.15, DRIFT_MAX = 0.12, JUMP_MAX = 0.25, BOX_CAP = 16;
export const SCALES = Object.freeze({ pent:[0,2,4,7,9], major:[0,2,4,5,7,9,11] });
export const TUNES = Object.freeze([ // seeds are fixed forever; changing one changes a saved box's tune
  { name:'Driftwood Lullaby', seed:0x5eed0001, scale:'pent',  root:62, bpm:84,  bars:8,  meter:6 }, // D, 3/4 waltz
  { name:'Lantern Tide',      seed:0x5eed0002, scale:'pent',  root:65, bpm:96,  bars:12, meter:8 }, // F
  { name:"Gull's Nap",        seed:0x5eed0003, scale:'major', root:67, bpm:88,  bars:16, meter:8 }, // G
  { name:'Sunwarm Planks',    seed:0x5eed0004, scale:'pent',  root:64, bpm:108, bars:16, meter:8 }, // E
  { name:'Shell Song',        seed:0x5eed0005, scale:'major', root:63, bpm:100, bars:12, meter:6 }, // Eb, 3/4
].map(Object.freeze));
export function mulberry32(seed)  // returns () => [0,1); pure integer math (Math.imul), the same on every engine
export function midiHz(m)         // 440 * 2 ** ((m - 69) / 12)
export function compose(i)        // -> frozen {name, step, loop, notes}; memoised per i; non-integer or out-of-range i -> compose(0)
export function phaseAt(clock, s, loop) // ((clock - s) % loop + loop) % loop; any non-finite input -> 0
export function windowNotes(tune, p0, dur, out) // fills out with {n, dt}: notes whose t is in [p0, p0+dur) modulo loop (handles the wrap); returns out.length
export function boxGain(d)        // 1 at d <= 1.5; ((14 - d) / 12.5) ** 2 out to 14 m; 0 beyond 14 m or for non-finite d
export function cleanBoxes(data, decor) // -> {v:1, r, b} (section 6)
export function applySet(st, decor, a, clock) // host rule for musicbox:set; mutates st; returns true when it changed
```
**compose(i)** is deterministic and uses only `mulberry32(seed)`, called in a fixed order. `step = 60 / bpm / 2` (an eighth note), and `loop = bars * meter * step`, which comes to about 15–37 s.
- Chords: one per bar, cycling a progression picked by `rng` from `[[0,7,9,5],[0,5,0,7],[0,9,5,7],[0,5,7,0]]` (root semitones above `root`: I, V, vi, IV …).
  The last bar is always I (0). A chord's tones are `{c, c+4, c+7}`, with c+3 for vi.
- Melody: the bars are grouped into 4-bar phrases A, A', B, A''. With 8 bars use A A''. With 12 bars use A B A''.
  - Phrase A is a random walk over scale-degree indices (the octave-extended scale, index range 0..9, reflecting at the edges, starting at index 2 or 4).
    The step weights are Δ = −2:.15, −1:.3, 0:.05, +1:.3, +2:.15, and ±3:.05.
  - Rhythm: a bar's step 0 always sounds. The other even steps sound with p = .7 and odd steps with p = .4. A sounding step may hold, which means no note on the next step (p = .2).
  - The last sounding note of each bar snaps to the nearest index whose pitch class is a tone of that bar's chord. The final bar ends on index 0 or 5 (the tonic).
  - A' copies A, then regenerates its 4th bar so it ends on the tonic. B is a fresh walk starting 2 indices higher, with half the hold probability. A'' copies A, and its last bar is a cadence (a walk forced downward to the tonic on beat 1 of the final bar of the loop).
- Bass: the chord root at `root - 12 + c` on step 0 of every bar, plus the fifth (`+7`) at mid-bar (step 4 when meter is 8, step 3 when it is 6). Bass `g = .5`.
- Melody `g` is .9 on step 0, .75 on the other even steps and .6 on odd steps. The midi range is `root`..`root + 19`, so every hz falls between about 146 and 1250 and is inside the 80..2000 that `box()` accepts.
- `notes` is a frozen array, sorted by `t`, of frozen `{t, m, hz, g, bass}`, where t = stepIndex * step. It is preallocated once per tune and never rebuilt.
Copyright guard: the melodies come only from these seeded walks. Never hand-write or tweak a melody. If a test finds two tunes sharing their first 8 melody midis, change only that tune's seed and record it in Build notes.

## 4. Audio: dist/audio.js
- Header comment (:11-17): document `box(hz, when, s)` and `now`.
- `buildGraph` (:92-111): add `const duck = ctx.createGain();` and wire `mu.connect(duck); duck.connect(tone);` instead of `mu.connect(tone)`. Add `duck` to `graph`, and to the disconnect list in `destroy` (:628).
- `play` (:550), after `lastPlay[event] = now;`: duck the music under effects with
  `try { graph.duck.gain.setTargetAtTime(.45, now, .03); graph.duck.gain.setTargetAtTime(1, now + .25, .4); } catch (_) {}`. There are no timers.
- New `box(hz, when, strength)` beside `note` (:565):
  - Return false when `!ready()`, when hz is not finite or is outside 80..2000, or when `when` is not finite or is outside `[ctx.currentTime, ctx.currentTime + 1]`.
  - `s = clamp01(strength)`, and return false if s ≤ .001.
  - It obeys `MAX_VOICES`. Voices are tagged `v.box = true`, and the call returns false when 8 box voices are already live.
  - The voice is `newVoice(graph.music)`. The recipe uses `tone()`: a sine at hz with peak .16·s, plus a sine at hz·3.01 with peak .05·s, plus a sine at hz·6.2 with peak .02·s. Each has a .002 attack. The decay is `1.4 - .8·clamp01((hz - 150) / 1100)` seconds, and the upper partials decay at 0.5x and 0.3x of that.
    Add a noise `burst` (highpass at 4000, peak .015·s, under 8 ms) for the "tink".
  - Everything is scheduled at `when`, not at `currentTime`, and ends via `onended` as usual.
- Return object (:635): add `box, // [musicbox]` and `get now() { return ctx && graph ? ctx.currentTime : null; }`.
- settings.js `SPEC`: after `ambience` (:31), add `music: { tab:'audio', label:'Music', type:'range', min:0, max:1, step:0.05, def:0.7, fmt:pct }, // [musicbox]`.
- game.js `applyVolume` (:315): append `sfx.setBus('music', options.music ?? .7); // [musicbox]`. The settings `onChange` already calls applyVolume (:1465).
- game.js `contentCtx` (:439-457): add `box: (hz, when, s) => sfx.box?.(hz, when, s) ?? false, audioNow: () => sfx.now ?? null, // [musicbox]`.

## 5. Module: dist/musicbox.js `createMusicBox(ctx)` (content.js import + FEATURES (:91), before `createCookpot`, which stays last)
State: `st = cleanBoxes(undefined)`, plus `rev`, `serCache` (cached on `rev` + the musicbox tile signature, like photo-frame.js `serialize` :169-176), `models: Map key → group`, and the scheduler `{key, tune, anchor, cursor, checkAt}`.
- **decorModel(type, d)**: for `'musicbox'`, build `buildMusicBox(ctx.T)`, store it under `models.set(tileKey(d.x, d.z), g)` and return it. Other types return null. Entries whose `group.parent` is null are dropped in update.
- **Clock**: `clock = STORM_LIVE.ready ? STORM_LIVE.clock : null`. When the clock is null, nothing plays and the animation holds.
- **Animation (update, every box that is on)**: `ph = phaseAt(clock, e.s, loop)`. The cylinder's and crank's `rotation.x = ph / loop * 2π * bars / 4` (one turn per 4 bars). The lid eases toward −1.75 when on and 0 when off, at a rate of `1 - exp(-6·dt)`.
  All of this is derived from the shared clock, so both peers see the same thing. Allocate nothing per frame.
- **Choosing the audible box**: the distance is `hypot(p.x - x*2, p.z - z*2)` in raft metres (using ctx.physics, the same as photo-frame.js `target` :76). The candidate is the nearest box that is on and has d < HEAR_MAX.
  Keep the current box unless it is off, gone or out of range, or the candidate is more than `SWITCH_HYST` closer. When the box or its tune changes, reset the scheduler. Notes that have already started ring out.
- **Scheduler**: `now = ctx.audioNow()`. It needs `now !== null` and `ctx.options.music > 0`, and otherwise idles with the cursor cleared.
  - Anchor: `ph = phaseAt(clock, e.s, loop)`, `anchor = now - ph`, and `cursor = now + timeToNextStep`.
  - Each frame, schedule every note n whose ctx time `anchor + k·loop + n.t` falls in `[cursor, now + LOOKAHEAD)`, using `windowNotes` with `p0 = (cursor - anchor) mod loop`.
    Call `ctx.box(n.hz, time, n.g * boxGain(d))` for each, then set `cursor = now + LOOKAHEAD`.
  - Re-anchor rule: check it each frame, which is cheap. Let `err` be the circular difference between `(now - anchor) mod loop` and `phaseAt(clock, …)`.
    If `|err| > JUMP_MAX` (a sleep `skipClock`, a daynight snap or a `MAX_CLOCK` wrap), or `|err| > DRIFT_MAX` (checked only once per bar, at `checkAt`, because clock dt is clamped below 20 fps), or `now - cursor > JUMP_MAX` (a hidden tab or a resumed context), then re-anchor.
    A re-anchor recomputes `anchor` and sets the cursor to the next **bar line**, so missed steps are skipped and there is a short rest, never a burst.
  - There is never a `setTimeout`. A hidden tab simply lets the ≤ .15 s already queued play out.
- **Glyphs (view only)**: on each bar line of the audible box, one pooled note sprite (a pool of 4, with a CanvasTexture drawn once, an eighth-note glyph tinted `#ffbd66`) rises .3 m over 1.2 s from the lid and fades.
  Copy the pattern from instruments.js `glyphTexture`/`FX_MAX` (:69-130). Set `raycast = () => {}` and `depthWrite:false`.
- **Targeting** `target(aim)`: copy photo-frame.js `target` (:67-90) with `d.type === 'musicbox'` and the same `REACH`.
- **interact(aim)** (E, reached from game.js `interact` :1387): `t = target(aim)`; return false if there is no target. Let `e = st.b[key] ?? {on:0, t:0}`, and let `last` be `{key, at}` from the previous E, using `ctx.elapsed`.
  - If `last.key === key` and less than 1 s has passed, cancel `pendingStop` and send `{kind:'musicbox:set', key, on:1, t:(e.t + 1) % 5}`. This is a double-E: next tune.
  - Otherwise, if the box is off, send `{…, on:1, t:e.t}`. If it is on, set `pendingStop = {key, at: elapsed + 1}`. update sends `{on:0, t:e.t}` once `elapsed` passes `at`, so a double-E never stops and restarts the box.
  - Return true. Everything goes through `ctx.action(a)`, so the host applies it directly and a guest's action reaches the host.
- **alt(aim, kind)** (right-click, game.js :1842; the hammer never gets here because :1841 opens the build wheel first): with a target, send `{on:1, t:(e.t + 1) % 5}` and return true. Otherwise return false.
- **Prompt**: `window.raftPrompts?.provide({id:'musicbox', priority:2, prompt})`, as photo-frame.js does (:197-199). Keep the unregister function for `dispose`.
  When off: `{key:'E', label:'Play · ' + name}`. When on: `{key:'E', label:'Stop · ♪ ' + name}`. Follow either with `{label:'E twice or right-click: next tune', muted:true}`. Skip the prompt when `uiOpen()`, swimming or holding a pickup (photo-frame.js `promptFor`).
- **Old host notice**: on a guest, the first send arms `ctx.elapsed + 3`. If `load(data, 'net')` has never seen a defined slice by then, show `ctx.notice("The host's game is older, so music boxes stay quiet here.")` once per session.
- **dispose()**: free the sprites, textures and model geometries/materials, and call the prompt unregister. It cannot stop the scheduled notes, but they end within 1.4 s.

## 6. Save slice and host action
`world.ext.musicbox = {v:1, r, b:{"x,z":{on:0|1, t:0..4, s}}}`, where `r` is the module's `rev` (informational) and `s` is the start time in **daynight clock seconds** (finite, ≥ 0, rounded to 0.01).
- `cleanBoxes(data, decor)`: a non-object gives `{v:1, r:0, b:{}}`. Keys must pass the photo-frame `isKey` rule (`"x,z"` integers, at most 24 chars). With `decor` given, keep only keys that have a `musicbox` decor tile.
  An entry is kept only when it is a plain object. `on` must be 0 or 1, and anything else becomes 0. `t` must be an integer 0..4, or it becomes 0. A non-finite `s` becomes 0. The slice is capped at `BOX_CAP` entries, and `__proto__` keys are ignored.
- **load(data, from)**: `st = cleanBoxes(data, ctx.world?.decor)`, then `rev++`. For `'net'`, skip it when the JSON signature is unchanged, as photo-frame.js does (:160-166). An old save gives `load(undefined)`, which leads to an empty slice.
- **serialize()**: return the cached value, re-cleaning against the current decor, so decor that has been moved or removed prunes the slice (photo-frame.js :169-176).
- **action(a, actor)**: return false unless `a?.kind === 'musicbox:set'`. Otherwise call `applySet(st, ctx.world.decor, a, STORM_LIVE.clock)`, bump `rev` on a change and return true. Return true even for an invalid action, so it is consumed.
  `applySet` checks a valid key, a musicbox on that tile, `on ∈ {0,1}` and an integer `t` in 0..4. It sets `s = round2(clock)` when `on` becomes 1 or `t` changes, and leaves `s` untouched on a stop. It refuses a new key once `BOX_CAP` is reached.
- **afterUndecor(d)**: for `d.type === 'musicbox'`, `delete st.b[tileKey(d.x, d.z)]` and `rev++`. If it was the audible box, reset the scheduler. Other types are ignored. It must never throw (pattern: bees.js:190, kiln.js:198).
- Compatibility: an older build keeps `ext.musicbox` untouched (cleanWorld keeps `ext`), and its host ignores `musicbox:set` (content.js:142). It rejects the unknown `musicbox` kind in a bag snapshot, which is the same trade-off as every new item.

## 7. QA helper: `debug` → `raftDebug.content.musicbox`
`state()` returns a deep copy of st. `tunes()` returns the 5 names. `place(x, z)` is for the host: it pushes `{type:'musicbox', x, z}` onto a free deck tile and calls `ctx.rebuildRaft()` (photo-frame.js debug `place` :231).
`play(n = 0, key?)` and `stop(key?)` are for the host. They apply a `musicbox:set` to the key, or to the first box. `next(key?)`.
`active()` returns `{key, tune, name, d, gain, anchor, cursor}` or null. `notes(sec = 4)` returns the next `sec` seconds of the audible (or first) box's tune from the current clock phase, as `[{t, m, hz, bass}]` built with `windowNotes`. It works without an AudioContext.
`scheduled()` counts the `box()` calls that returned true since load.

## 8. Tests: tests/musicbox.test.mjs (node:test + assert/strict, using the `RAFT_DIST` base idiom from tests/storm.test.mjs:1-10)
1. Determinism: `compose(i)` deep-equals a fresh re-import (use `?x=` cache-bust) for all 5 tunes. A `mulberry32(1)` sequence of 5 values is pinned. A checksum of `notes.map(n => n.m + ':' + n.t.toFixed(4))` is pinned per tune (the builder records the values).
2. Scale membership: every melody `(m - root) % 12 ∈ SCALES[scale]`, and every bass `(m - root) % 12 ∈ SCALES.major`. Every hz is in 80..2000. `loop` equals `bars * meter * step` and falls between 8 and 40 s.
   The last bar of each tune ends on the tonic. Bar lengths are 8–16. There are no notes past `loop`, and the notes are sorted.
3. Originality: no two tunes share their first 8 melody midis, and all 5 names are distinct.
4. Phase math: `phaseAt(10, 4, 6) = 0`, `phaseAt(3, 4, 6) = 5`, and NaN inputs give 0. `windowNotes` across the wrap returns notes from the end and then the start with increasing `dt`. A window of `loop` length returns every note exactly once.
   `boxGain`: 1 at 0 and 1.5, 0 at 14 and at NaN, and monotonic in between.
5. Slice: `cleanBoxes` drops a bad key, `on:2`, `t:7`, `t:1.5`, `s:NaN` (which becomes 0) and `__proto__`. It caps at 16, prunes keys without a decor tile and round-trips through JSON.
   `applySet`: a valid action sets `s`; a stop keeps `s`; a missing tile, `t:5` or a 17th key returns false.
6. Model: `buildMusicBox(T)` with the vendored THREE has `userData.lidPivot/cylinder/crank`, a bounding box of at most .4 m and at most 20 meshes.
7. Audio with the fake context from tests/survival.test.mjs:1050: `box` returns false with no context. With the fake context, valid calls return true; hz 50, `when` in the past, `when` > now + 1 and s = 0 return false; the 9th live box voice is refused; and `play('chop')` sets duck targets.
8. Module with a stub ctx (with a fake `box`, `audioNow`, `STORM_LIVE` set by the test, and a world with one box):
   - play runs `box` only for notes inside the .15 s window;
   - a clock jump of 3 s re-anchors to a bar line with no burst;
   - the nearer of two boxes plays, and a box .5 m closer does not take over (hysteresis);
   - a double-E within 1 s sends `{on:1, t:1}` and never `on:0`;
   - `afterUndecor` prunes the key;
   - a guest whose host never sends a slice gets one notice.
9. Items: `musicbox` is in `ITEMS` (decor, placeable, recipe, unlock `discover`), in `BLOCK_RADII`, `CATEGORY_OF`, `ITEM_TEXT` and `ITEM_ICONS`. settings `validateSettings({})` gives `music` 0.7.
These must keep passing: tests/progression.test.mjs (completeness, reachability, INFO keys), tests/survival.test.mjs (audio and settings tab), tests/storm.test.mjs, tests/viewmodel.test.mjs, tests/models.test.mjs, tests/prompts.test.mjs and tests/bag-roundtrip.test.mjs.
Run `npm test`, plus a headless screenshot with a placed, playing box, and the `errors` list must be empty.

## 9. Hook index (file:function)
items.js: item list (:261) and `BLOCK_RADII` (:315) · craft-book.js: `CATEGORY_OF` and `ITEM_TEXT` · item-svg.js: `ITEM_ICONS` · settings.js: `SPEC` (:31) ·
audio.js: header, `buildGraph`, `play`, new `box`, `destroy`, return object · game.js: `applyVolume` (:315) and `contentCtx` (:439) · content.js: import (:82 area) and `FEATURES` (:91).

## Out of scope
Player-composed tunes, more than one audible box at once, syncing over the network beyond the slice, a crank-winding mechanic and achievements.
