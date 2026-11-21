# Spec: playable held instruments (Tide Drum, Reed Pipes, Bell Bars)

Source: docs/features/instruments-research.md. Cozy rules: there is no damage, hunger or wear, and nothing is lost. An instrument is a held tool you click to play.
It creates **no world state**. Nothing goes into `world`, `world.decor`, the save, `BLOCK_RADII`, `applyAction` or migration. Playing a note is local, and the only network traffic is one transient co-op message.
Logic goes in the new `dist/instruments.js` (pure top half plus `createInstruments(host)`) and `dist/instrument-models.js` (THREE meshes; it imports nothing and is given `T`).
game.js, audio.js, items.js, held-items.js, coop.js, coop-avatar.js, craft-book.js and item-svg.js get only small hooks, tagged `// [instruments]`. Import new modules with the neighbouring `?build=` suffix.

## 1. Items, recipes and gating (dist/items.js tools block, after `binoculars` at :143)
All three are shaped like `binoculars`: `category:'tool'`, `tool:false` (no durability, no repairCost), `stack:1`, no `icon` opt (so `icon-<id>`, placeholder), no `actsAs`, and no `START`.
```js
item('drum',  'Tide Drum',  'tool', { iconTint:'#b0805a', stack:1, recipe: hand({ wood:3, leaf:2, rope:1 }), unlock: discover('rope'),
  tip: 'A palm-leaf hand drum. Click to thump; look up or down to change the note.' }),
item('pipes', 'Reed Pipes', 'tool', { iconTint:'#8fc3c9', stack:1, recipe: hand({ plastic:3, rope:1 }), unlock: discover('rope', 'plastic'),
  tip: 'Breathy little tubes tied in a row. Look up for high notes, down for low ones.' }),
item('bells', 'Bell Bars',  'tool', { iconTint:'#c9b26a', stack:1, recipe: hand({ wood:2, scrap:3, nail:2 }), unlock: research('nail'),
  tip: 'Scrap-metal bars on a little frame. They ring bright and fade out softly.' }),
```
- `infoTable()`/`recipeTable()` feed `ITEM_INFO` and `RECIPES` automatically. Do **not** add them to `content-items.js` (the Tinker's Desk ignores catalogue ids).
- craft-book.js: add `drum:'tools', pipes:'tools', bells:'tools'` to `CATEGORY_OF` (:14), plus three short `ITEM_TEXT` rows (:26).
- item-svg.js `ITEM_ICONS` (:10): three original 48x48 drawings: a squat cylinder with a lashed leaf head (`drum`), five tubes of falling length tied by a band (`pipes`), and four bars of falling length on two rails (`bells`).

## 2. Held models (dist/instrument-models.js + dist/held-items.js)
`export function buildInstrument(T, kind)` returns a Group (or `null` for other kinds) with its own geometries and materials (MeshStandardMaterial, roughness .6–.8), at most about 12 meshes, origin at the grip:
- `drum`: body is an open CylinderGeometry (top r .11, bottom r .09, h .12, 12 segments) in wood #9c7649. `drumHead` is a disc r .112 in leaf green #7da35a on top. Three rope tori (`drumLash`, R .1, tube .006) circle the body.
- `pipes`: five tubes (`pipe0..4`, CylinderGeometry r .012, lengths .16/.14/.12/.10/.08, top-aligned) spaced .028 apart on x, in pale teal #8fc3c9 plastic. A rope band (box .14 x .016 x .03, #c9a46a) sits .03 below the tops.
- `bells`: two wood rails (box .2 x .015 x .015, at z ±.035), and four bars (`bar0..3`, boxes .016 x .008 x lengths .09/.08/.07/.06) in brass #c9b26a (metalness .7, roughness .35) across the rails. A small mallet (`mallet`: stick r .004 h .1 with a sphere head r .012) is attached to the group, offset to the right.
held-items.js hooks: add `drum:{hand:'left', pose:'grip', rx:.3}`, `pipes:{hand:'right', pose:'grip', rx:-1.2}`, `bells:{hand:'left', pose:'grip', rx:.9}` to `HOLD` (:23).
Add `drum:.24, pipes:.2, bells:.22` to `SIZE` (:39). In `buildItemModel` (:117), before the bundle fallback, add `const ins = buildInstrument(T, kind); if (ins) return fit(T, ins, SIZE[kind], null);`.
Do **not** add them to `PLACEABLE_KINDS` or `TOOL_KINDS`. They must read clearly in the lower-right viewmodel: each model is a single bold silhouette with high-contrast parts (the green head, the stepped tubes, the brass bars).

## 3. Pure module: top of dist/instruments.js (no DOM, no THREE, no Date)
```js
export const INSTRUMENT_IDS = Object.freeze(['drum', 'pipes', 'bells']);
export const SCALE_HZ = Object.freeze([293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99]); // D4 E4 F#4 A4 B4 D5 E5 F#5
export const PITCH_SPAN = 0.9, SEND_GAP_MS = 80, RECV_MAX_PER_S = 16, HEAR_RANGE = 30, TEACH_NOTES = 10;
export const isInstrument = (k) => INSTRUMENT_IDS.includes(k);
export function noteFor(pitch)            // clamp(floor((pitch + .9) / 1.8 * 8), 0, 7); NaN gives 3; looking up gives a higher note
export function cleanNoteMsg(m)           // -> {i, n, v} | null; see section 6
export function rateGate(minGapMs)        // -> (nowMs) => boolean; true when the gap since the last true is at least minGapMs
export function windowGate(max, ms=1000)  // -> (nowMs) => boolean; a sliding window of at most `max` passes per `ms`
export function distanceGain(d)           // clamp(1 - d / HEAR_RANGE, 0, 1), with a .15 floor while d < 30 and 0 for non-finite d
```

## 4. Input (dist/game.js)
- Hook (useSelected, game.js:952, right after the `guestWaiting` line): `if (instruments?.use(kind)) { swing = .7; return; }`.
  LMB (`game.js:1289-1299`) and gamepad RT (`controls.js:69` → `useDown`, `game.js:1369`) already reach `useSelected`, and the existing `swing` decay gives the strike bob. No new bindings or ACTIONS entries are needed.
- `use(kind)` returns false unless `isInstrument(kind)`. Otherwise it reads `n = noteFor(host.pitch())`, plays locally at `s=1` (section 5), spawns the FX (section 8), and sends the message (section 6) if `host.netReady()`. Then it returns true.
  Clicks faster than `SEND_GAP_MS` still return true (so the click is consumed), but they play nothing.

## 5. Audio: `note(instr, step, s = 1)` in dist/audio.js
Add it beside `play` (:476) and export it in the returned object (:536). Document it in the header comment (:13). Never route notes through `play()`: there `MIN_GAP` is per event, and `play()` has no pitch.
- `if (!ready()) return false`. Reject an unknown `instr` (`hasOwnProperty` on a private `NOTES` table), a non-integer `step` outside 0..7, and `s <= .001`.
- Rate limit: there is a per-instrument `lastNote[instr]`, and the call returns false if `ctx.currentTime - last < .05`.
- Voice cap: the shared `MAX_VOICES` 24 still applies. Instrument voices are tagged `v.inst = true`, and if 10 of them are already live the call returns false, so co-op play cannot starve the game SFX.
  Build it with `newVoice(graph.effects)` exactly as `voice()` does (:424), so the effects/master sliders, `sound` off and the underwater low-pass all apply.
- `const f = NOTE_HZ[step]` (the same values as `SCALE_HZ`; audio.js must not import instruments.js). Every tail is 1.5 s or less. The recipes use `tone/burst` (:211-222):
  - drum: `tone(sine, f/2, .55s, .002, .28, f/2*.6)` plus `burst(lowpass, 900, .7, .35s, .001, .06)` for the slap.
  - pipes: `tone(triangle, f, .22s, .04, .5)` and `tone(sine, f*2, .05s, .05, .35)`, plus `burst(bandpass, f*2, 1.2, .08s, .03, .25)` for breath. Add slow vibrato by ramping the main oscillator's frequency to `f*1.008` and back over .25 s.
  - bells: sine partials at `f*2`, `f*2*2.76` and `f*2*5.4` with peaks `.3s/.12s/.06s`, attack .002, and decays `1.2/.6/.3`.
- game.js:259: add `const note = (i, n, s) => sfx.note?.(i, n, s) ?? false;`. The instruments module gets the function through `host` and keeps no audio nodes, so hot reload is safe.

## 6. Co-op transient message `{type:'inst', i, n, v}`
- Send: `host.send({type:'inst', i:kind, n, v:1})`, gated by `rateGate(SEND_GAP_MS)` (at most about 12/s). `coop.encode` passes unknown types through unchanged.
- Receive hook (game.js:1479, right after the `'fc'` line): `if (data.type === 'inst') { if (isHost) lastGuestMessage = performance.now(); instruments?.onNet(data); return; } // [instruments]`.
- `cleanNoteMsg(m)`: m must be a plain object (not null, not an array) with own `type === 'inst'`. `i` must be in `INSTRUMENT_IDS`, `n` an integer 0..7, and `v` a finite number (clamped to 0..1, default 1).
  Extra keys are ignored, and `__proto__`/`constructor` tricks give null. `onNet` drops a message when `windowGate(RECV_MAX_PER_S)` says no.
- Falloff: `d = host.friendPos()?.distanceTo(host.camera.position)`, and `s = v * distanceGain(d)`. If s is 0, nothing plays (and there is no FX). Otherwise it calls `note(i, n, s)` and shows the FX at the friend's hand.
- coop.js `HELD` (:25): **append** `'drum', 'pipes', 'bells'` at the very end and never reorder it. Old peers decode the unknown indices as `null` (an empty hand), and the old host ignores `type:'inst'`.

## 7. Friend avatar (dist/coop-avatar.js)
Add `BUILD` (:45) entries using the local `part/Box` helpers and the `K` materials, each returning a tip `[x,y,z]`:
- `drum`: cylinder r .08 h .1 (K.wood) plus a disc cap (leaf green). `pipes`: 4 thin boxes (.015 x .1-.16 x .015), light teal. `bells`: a .16 x .02 x .1 frame (K.wood) plus 3 brass slats.
Add `drum:1.5, pipes:.4, bells:1.2` to `TOOL_TILT` (:96). Pipes point up toward the friend's face, and the drum and bells sit flat in front.

## 8. Strike FX (view-only, in createInstruments)
On each local or remote note, add a small sprite to `host.scene`, at most 6 live at once (the oldest is recycled). It is a `PlaneGeometry(.14,.14)` facing the camera, using a CanvasTexture drawn once per instrument
(drum: a ring; pipes: an eighth-note glyph; bells: a four-point sparkle) and tinted with that instrument's `iconTint`. It is transparent, `depthWrite:false`, and has no shadows and no raycast (`raycast = () => {}`).
Local strikes start .5 m ahead of the camera and .15 m to the right and down. Remote strikes start at `friendPos + (0, 1.5, 0)`. Over .9 s each sprite rises .35 m, scales 1→1.4 and fades its opacity .9→0. The step also tints it: hue shifts ±8% across 0..7.
It updates from `update(dt)` (game.js, next to `fc.update` at :1232, one line) and never touches `world`. `dispose()` removes the sprites and frees the geometries, materials and textures.

## 9. Prompts (no edit to prompts.js)
`createInstruments` calls `window.raftPrompts?.provide({id:'instruments', priority:1, prompt})` and keeps the unregister function for `dispose()`.
`prompt(ctx)` returns null unless `isInstrument(ctx.state.heldKind)`. Otherwise it returns `[{key:'LMB', label:'Play'}]`, followed by `{key:'↕', label:'Look up/down: change note', muted:true}` until `TEACH_NOTES` local notes have been played this session.

## 10. Host adapter and wiring (dist/game.js, one line each)
- Import (next to :27): `import { createInstruments } from './instruments.js?build=...'; // [instruments]`. Add `let instruments = null;` beside `fc` (:240).
- Create (:396 pattern): `try { instruments = createInstruments(T, instHost()); } catch (e) { console.error('instruments failed', e); instruments = null; }`.
- `instHost()` beside `fcHost` (:413): `{scene, camera, pitch:() => pitch, send, netReady:() => networkReady, note, friendPos:() => (other && friend?.visible ? friend.position : null)}`.
- Update (:1232 pattern) and dispose (:1730 pattern): `instruments?.update(dt)` and `instruments?.dispose()`, each wrapped in try/catch like the fc lines.

## 11. Save and compatibility
- No world state. Saves only change in that bags may now hold `drum`, `pipes` or `bells`, and `Bag` accepts them via `ITEM_INFO`. Round-trip them in a test.
- Known limitation (the same one as watering): an older build that loads a bag holding a new kind resets that bag. Mixed-version co-op is unsupported, and the `?build=` suffix keeps peers matched.
- The `HELD` append and the ignored `inst` type mean an old peer only loses the friend-hand model and the friend's notes. Nothing errors.

## 12. Files (new / hooked)
New: `dist/instruments.js`, `dist/instrument-models.js`, `tests/instruments.test.mjs`.
Hooked: `dist/items.js:143`, `dist/craft-book.js:14,26`, `dist/item-svg.js:10`, `dist/held-items.js:23,39,117`, `dist/audio.js:13,476,536`, `dist/coop.js:25`,
`dist/coop-avatar.js:45,96`, `dist/game.js:27,240,259,396,413,952,1232,1479,1730`.

## 13. Tests
New `tests/instruments.test.mjs` (`node:test` + `assert/strict`, `RAFT_DIST` base URL idiom from `tests/signal.test.mjs:1-8`):
1. `noteFor`: -1.35 gives 0, +1.35 gives 7, 0 gives 4, NaN gives 3. The mapping is monotonic over 200 samples, and all 8 steps are reachable.
2. `cleanNoteMsg`: it accepts a valid message. It rejects null, arrays, strings, a wrong `type`, `i:'hook'`, `n:8`, `-1`, `2.5` and `'3'`, `v:NaN`/`Infinity`, and `JSON.parse('{"__proto__":{"i":"drum"}}')`. It clamps `v:5` to 1.
3. `rateGate(80)`: passes at 0, blocks at 50, passes at 80. `windowGate(16)`: 16 pass and the 17th fails within 1 s, then it passes again after the window.
4. `distanceGain`: 0 gives 1, 30+ gives 0, NaN gives 0, and the output is monotonic.
5. Items: `ITEMS` has all three with `category:'tool'`, `tool:false`, `stack:1`, a recipe and a non-START unlock. `RECIPES` crafts them. `new Bag` accepts a snapshot holding all three, and it round-trips.
6. audio.js with no context: `note('drum',0)` returns false and never throws. With the fake context from `tests/survival.test.mjs:1050`: valid calls return true, an unknown instr or step 9 returns false, a second note within .05 s returns false, and the 11th concurrent instrument voice is refused.
7. `buildInstrument(T, kind)` with the vendored THREE: it has the named meshes from section 2, the bounding box is at most .3 m, and the result is null for `'wood'`.
8. `createInstruments` with a stub host (fake `send`, `note`, `scene`, and pitch 0): `use('drum')` returns true, calls `note('drum',4,1)` and sends once. `use('hammer')` returns false. Two uses 10 ms apart send once.
   `onNet` with a friend at 45 m plays nothing, and at 5 m plays with `s<1`. `dispose()` leaves the scene with no children added.
9. coop.js: `HELD.slice(0,14)` is unchanged, and the new ids are at indices 14-16 (export `HELD` for tests if needed).
Existing tests that must keep passing: `tests/progression.test.mjs` (:100 completeness: tips, icon prefix, category set at :20; :113-121 repairCost and actsAs rules; :126 references; :186-198 reachability; :202 INFO keys = ITEM_IDS),
`tests/progression-core.test.mjs:38-39` (START set unchanged), `tests/viewmodel.test.mjs:19` (every kind fits 1 m and has a grip), `tests/survival.test.mjs` audio tests,
`tests/prompts.test.mjs`, `tests/net-coop.test.mjs`, `tests/coop-interp.test.mjs`, `tests/bag-roundtrip.test.mjs` and `tests/models.test.mjs`. Run `npm test` plus shoot.py, and the `errors` list must be empty.

## Out of scope
Placeable music stand, recorded songs, RMB articulations, per-note keys, a feed line and achievements. The audio `note()` API is generic, so these can come later.

## Build notes (deviations)
- `createInstruments(T, host)` takes `T` first, as section 10 shows (section 3's header omits it). `host.now?.()` is an optional clock for tests; otherwise it uses `performance.now()`.
- `friendPos` returns `friend.position` whenever `other` is set, ignoring `friend.visible`. coop.js hides game.js's fallback avatar each frame while its own remote avatar is drawn, but `friend.position` still tracks the peer. Gating on `visible` would have muted every remote note in normal co-op.
- The useSelected hook goes one line lower than :952, right after `const kind = ...`, because it needs `kind`. Guests still waiting for the host can't play.
- The create line first calls `instruments?.dispose()` so a rebuilt scene doesn't leak the old prompt provider.
- Hold rotations were tuned from headless screenshots so each part reads in first person: drum `rx:-0.7` (green head toward the eye), pipes `rx:0.2` (stepped tubes upright), bells `rx:-1.25` (bars face the eye). The spec's values (.3 / -1.2 / .9) showed the drum's side, the pipes end-on and the bells edge-on.
- The bells SIZE is .26 (was .22). The bells model sets `userData.gripFrac = [-.4, 0, 0]`, and the held-items hook turns it into a grip function so the fist holds the rail ends instead of covering the bars. The other two kinds use the centre grip (`null`).
- The bells mallet rests in front of the bars (x≈.03–.12) rather than off to the right, which keeps the bounding box under .3 m.
- Local strike sprites are drawn at 0.5x scale. At .5 m, a .14 m plane covered about a fifth of the screen height. Remote sprites stay full size.
- coop.js now exports `HELD` and freezes it.
- `tests/survival.test.mjs` hard-codes the Tools tab order, so `drum, pipes, bells` were appended to it.
- The avatar.js fallback friend model (old clients) gets no instrument meshes, so it shows an empty hand, as the spec allows.
