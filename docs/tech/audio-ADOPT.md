# Adopting the procedural audio engine (against the current dist/)

Checked against the current `dist/` on `claude/raft-tech` (= origin/main): build token `v3-survival-ae77fa84ac2b`, `dist/game.js` 1780 lines, `dist/audio.js` 550 lines.

Main has already done the wiring: `game.js` imports `createOceanAudio` from `./audio.js`, calls `play()`, `tick()`, `setBus()`, `setVolume()`, `resume()` and `destroy()`, hands its AudioContext to the next build as `X.audio`, and passes diving's low-pass through the `output` option. **So the adoption is a file swap.** `sandbox/audio/audio.js` becomes `dist/audio.js` and is a strict superset of the API that `game.js` uses today. The three `game.js` edits in step 3 are optional extras.

## Fast path (scripted, verified)

```sh
python sandbox/audio/adopt.py --check   # temp copy of dist/, apply, boot headless, failed + good hot update
python sandbox/audio/adopt.py --apply   # same edits on dist/ in place
```

`--apply` refuses to touch anything unless every required anchor (step 1) and every edit anchor (step 3) matches exactly once.

## 1. What the engine relies on (already in dist/game.js, unchanged)

| line | text | why |
|---|---|---|
| 3 | `import { createOceanAudio } from './audio.js?build=v3-survival-ae77fa84ac2b';` | the import; the token is reused for the worklet URL |
| 258 | `const sfx = createOceanAudio({context:X?.audio ?? null, volume:sound ? options.volume : 0, output:ctx => diving?.audioOut(ctx) ?? null});` | `context`, `volume` and `output` options |
| 261 | `if (X?.audio) sfx.resume(); // hot swap: …` | the hot-update mount takes the playing ocean over here |
| 1690 | `…, sound, audio:sfx.context, peer, …` | hands the context to the next build |
| 1725 | `pause(); disposed = true; ac.abort(); sfx.destroy(); …` | destroy (also runs when a mount fails) |

Every other call site keeps working unchanged: `play(ev, s)` at 551 (the `beep(f)` mapping for fishing-cooking), 750, 772 (`e.sound` / effect kinds), 919, 931, 969, 991, 1059–1062, 1184, 1196–1198, 1345 and 1752; `tick` at 1222; `resume` at 1343–1344; `setVolume` and `setBus('effects' | 'ambience')` in `applyVolume` at 260; and `raftDebug.audio` (1618) for the menus (`setBus`, `getBus`, `setMusic`).

## 2. Files

| file | action |
|---|---|
| `dist/audio.js` | replace with `sandbox/audio/audio.js`, changing the one literal `'./audio-worklet.js'` to `'./audio-worklet.js?build=v3-survival-ae77fa84ac2b'` (the same token as the import on line 3). `publish_local.py` restamps it on every release like any other `./x.js` literal. |
| `dist/audio-worklet.js` | add: a copy of `sandbox/audio/audio-worklet.js` |

With only step 2 done, the game runs on the new engine. The checks below were also run in that state (the `tests/` suite passes, see Verify).

### API compatibility (current dist/audio.js -> new engine)

| dist/audio.js | new engine |
|---|---|
| `EVENTS` (20 names) | the same 20 first, in the same order, then `hammer grab error return creak gull hover` and the feature events `sizzle stoke clank ingot sail anchor dive surface` |
| `ALIASES` `{pickup: collect, cast/hook: throw, pour: water, click: ui}` | identical (the round-2 sandbox's own `pickup` recipe is now `grab`) |
| `BUSES` `master effects ambience music` | identical. `setBus` returns the clamped value or `null`; `getBus` reads it back. `'sfx'` and `'ui'` still work as sub-buses under `'effects'`. |
| options `context, volume, ambience, music, output` | identical. `output(ctx)` is also retried from `tick()` every 0.5 s until it returns a node (see the fix below). |
| `resume, setVolume, setMusic, play(ev, s), tick(dt, {swimming}), destroy, context, music` | identical signatures and return values. `play` takes an optional third argument `{x, y, z}`. `tick` reads optional `underwater`, `sail` and `flow`. |
| music bed (pad + plucks, chord change every 10 s) | ported unchanged onto the music bus |
| `tick` lapping/creak one-shots | done by the worklet ocean (slaps, creaks) on the audio thread |
| ambience level | the ambience bus defaults to 0.7, which is `settings.js`'s default. The game's slider at 0.7 gives exactly the level the loudness hierarchy was tuned at. |

### Bugs on main that this fixes without any game.js change

- **No underwater muffling after a hot update.** `let diving` is declared at line 320, after `sfx` is created at 258. In a hot-update mount, `sfx.resume()` (line 261) builds the graph before `diving` exists: `output()` throws a TDZ error, which gets swallowed, so the limiter goes straight to `ctx.destination` for the rest of the session. The new engine retries `output` from `tick()` and re-routes once `diving` exists. `--check` asserts `stats().routed` after a hot update.
- **The `reel` spam** keeps main's 75 ms gap. `game.js:1198` calls `play('reel')` every frame.

## 3. Optional game.js edits (all applied by adopt.py)

1. **Reusable tick state and listener scratch** (after line 279, the `[sailing]` declarations):
   ```js
   let sailing = null; const scenery = [], sailFlow = {x:0, z:0}, aimNdc = {x:0, y:0}; // [sailing]
   const sfxSt = {swimming:false, sail:null, flow:sailFlow}, earDir = new T.Vector3(); // [audio] tick state + listener scratch
   ```
2. **Sailing into tick()** (line 1222, replace):
   ```js
   ocean.update(elapsed, camera); sfxSt.swimming = physics.swimming; sfxSt.sail = sailing ? world.sailing : null; sfx.tick(dt, sfxSt); // [audio]
   ```
   `world.sailing` (`{raised, anchored, windStr, …}`, kept in sync on guests too) drives these:
   - the wind layer: `windStr` 0.55–1 maps to wind 0.3–0.85;
   - a canvas luff loop while the sail is up and not anchored. It is 6 nodes, its flutter rate and level follow the wind, and it stops when the sail is lowered;
   - `sail` on the raise/lower edge and `anchor` on the anchor edge. The first tick only records the state, so there is no sound at load.

   `sailFlow` (raft speed through the water) drives the hull wash and the creak rate. Nothing is allocated per frame.
3. **Spatial listener** (after line 1225, `updateAvatars(dt); updateCamera(dt); …diving?.update…`):
   ```js
   if (sfx.context) { camera.getWorldDirection(earDir); sfx.setListener(camera.position.x, camera.position.y, camera.position.z, earDir.x, earDir.y, earDir.z); } // [audio]
   ```
   The camera is a direct child of the scene (line 377), so `camera.position` is its world position.
4. **Station and cooking sounds** (line 754, `function action(a) {` + `if (role === 'guest') {`). Insert an `actionSound(a)` helper and call it first in `action()`:
   - smelter `prog:fuel` → `stoke`, `prog:insert` → `clank`, `prog:take` → `ingot`;
   - grill `prog:insert` → `sizzle`, `prog:fuel` → `stoke`, `prog:take` → `grab`;
   - driftwood grill `fc:cook` → `sizzle`.

   The station sounds play spatially at the station's tile (`x*2, .6, z*2`). `action()` runs on the acting client only (a guest's action is sent to the host and goes through `applyAction`), so a player hears their own action once.

Diving needs no edit. `diving.js` dispatches `raft:underwater` `{underwater}` on every change; the engine listens to it, plays `dive` / `surface` on the edges, closes its tone stage to about 1 kHz, and drops the wind layer. This is on top of diving's own 600 Hz output low-pass. `tick(dt, {underwater})` overrides the event if a caller prefers that.

## 4. Hot update and failed hot update

- **Good update.** The new build's `sfx.resume()` (line 261) takes over the ocean worklet node that is playing: the node and its fade gain move onto the new engine's ambience bus in that task. The old build's `destroy()` then leaves the ocean alone and fades its own master out over 80 ms. The result is one context, no second worklet node, no module load, and no hole.
- **Failed update.** `live.js` mounts the new build. If its `mount()` throws after line 261, `game.js` disposes it (`sfx.destroy()`), and `live.js` keeps the old build ("Update paused — still playing this version"). The handle the new engine took records the engine it took it from (`from`). Because that engine is still alive, `destroy()` first hands the ocean back: the fade gain moves onto the old engine's ambience bus in the same task, the old engine marks it as its own again, and only then does the failed engine fade out its own master. A second safety net covers the case where an owner dies without handing back: the old engine's `tick()` sees the handle's shared `core.dead` flag and starts a fresh ocean.
- **Version field.** The per-context shared record (`Symbol.for('little-raft.audio.shared')` → WeakMap) and every ocean handle carry `v: SHARED_VERSION` (2). A build takes over or reuses only a record and handle of its own version. Otherwise it starts its own and leaves the foreign one to its owner, so a future build that changes the shape is never handed one it misreads.
- Worklet DSP changes still need a page load: the first `registerProcessor('raft-ocean')` on a context wins, and the ocean node is handed over.

## Verify

`python sandbox/audio/adopt.py --check`. It copies `dist/` to a temp dir, applies steps 2 and 3, serves it over http, and launches Chromium headless with the fleet brief's `executable_path` and SwiftShader args. A probe counts contexts, worklet nodes and modules, and records the speaker output RMS every 20 ms on the audio thread. Then:

1. Boot, then solo, then the first gesture. It asserts:
   - no page errors and one AudioContext;
   - the worklet module URL ends in `audio-worklet.js?build=<token>`;
   - the ocean is a worklet;
   - the limiter is routed into diving's low-pass;
   - every EVENT schedules in the game;
   - a `raft:underwater` event is seen and then cleared;
   - the buses are at their defaults (effects 1, ambience 0.7, music 0.7).
2. **Failed hot update.** It republishes with a `game.js` whose `mount()` throws right after `init()`, which is after the ocean takeover, and lets `live.js`'s own 6 s poll pick it up. It asserts that `live.js` kept the old build with the injected error, that the old engine owns a worklet ocean again, that no new worklet node was created, and that the level holds: no 100 ms window more than 10 dB under the trailing 1 s, and never below −70 dB.
3. **Good hot update.** It republishes a clean build. It asserts the swap happened, that there is one context in the `running` state, that the ocean was handed over (same worklet-node count), that every module URL carries `?build=`, that the level holds, and that the new engine re-routed into the new diving module's low-pass.

Then run `node --test tests/*.test.mjs` with and without `RAFT_DIST=<patched copy>`. `tests/survival.test.mjs` has two audio API tests (buses, gesture, voice cleanup, music, cap, destroy) that run the engine against a fake Web Audio graph.

Results from the run on this branch are in `docs/tech/audio.md` → "Retarget to main".
