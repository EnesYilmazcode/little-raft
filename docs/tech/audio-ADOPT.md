# Adopting the procedural audio engine (against the current dist/)

Checked against the current `dist/` on `claude/raft-tech` (= origin/main 8d21618): build token `v3-survival-ae77fa84ac2b`, `dist/game.js` 2284 lines, `dist/audio.js` 609 lines.

**Drift since the 3c62305 retarget (refreshed against 8d21618).** Main's `dist/audio.js` gained the Seashell Finder events `detect` and `chime` (`treasure.js` plays them through `ctx.play`, and as `e.sound` on dig-up notices), a `note(i, step, s)` member for the held instruments (`game.js:303` `sfx.note?.(…)`, used by `instruments.js`), a slower reel ratchet (`MIN_GAP.reel` 0.075 → 0.4 s, 2.5 clicks/s) and a single-pass crossfaded brown loop (the new engine's ocean is the worklet, so that one needs no port). All of it is ported, so the engine stays a strict superset. In `game.js` only one anchor moved: the transfer line now has `hintsDone` after `audio:sfx.context`, so adopt.py matches `fishWait, sound, audio:sfx.context,` instead. The line numbers below are refreshed. `dist/live.js` now has a `PRELOAD` list; `audio-worklet.js` stays out of it (see Files).

Main has already done the wiring: `game.js` imports `createOceanAudio` from `./audio.js`, calls `play()`, `tick()`, `setBus()`, `setVolume()`, `resume()` and `destroy()`, hands its AudioContext to the next build as `X.audio`, and passes diving's low-pass through the `output` option. **So the adoption is a file swap.** `sandbox/audio/audio.js` becomes `dist/audio.js` and is a strict superset of the API that `game.js` uses today. The four `game.js` edits in step 3 are optional extras. The default mix keeps main's in-game levels (see "In-game levels vs current main").

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
| 301 | `const sfx = createOceanAudio({context:X?.audio ?? null, volume:sound ? options.volume : 0, output:ctx => diving?.audioOut(ctx) ?? null});` | `context`, `volume` and `output` options |
| 305 | `if (X?.audio) sfx.resume(); // hot swap: …` | the hot-update mount takes the playing ocean over here |
| 2183 | `…, fishWait, sound, audio:sfx.context, hintsDone, …` | hands the context to the next build |
| 2221 | `pause(); disposed = true; ac.abort(); sfx.destroy(); …` | destroy (also runs when a mount fails) |

Every other call site keeps working unchanged: `play` through the `play` wrapper at 302 (handed to the feature modules: fishing-cooking's `beep(f)` mapping, `treasure.js`'s `detect` / `chime`), and direct calls at 670, 996, 1020 (`e.sound` / effect kinds), 1200, 1221, 1267, 1291, 1394–1397, 1535, 1547–1549 (`reel` every frame while reeling, kept to 2.5 clicks/s by the 0.4 s gap) and 2253; `note(i, n, s)` through the wrapper at 303 (`instruments.js`); `tick` at 1585; `resume` at 1724–1726 and 1799; `setVolume` and `setBus('effects' | 'ambience')` in `applyVolume` at 304; and `raftDebug.audio` (2085) for the menus (`setBus`, `getBus`, `setMusic`).

## 2. Files

| file | action |
|---|---|
| `dist/audio.js` | replace with `sandbox/audio/audio.js`, changing the one literal `'./audio-worklet.js'` to `'./audio-worklet.js?build=v3-survival-ae77fa84ac2b'` (the same token as the import on line 3). `publish_local.py` restamps it on every release like any other `./x.js` literal. |
| `dist/audio-worklet.js` | add: a copy of `sandbox/audio/audio-worklet.js` |
| `dist/live.js` | no change. Its `PRELOAD` list is `game.js`'s static import graph, which `tests/live-preload.test.mjs` asserts is exact (an extra entry fails as `stale`). The worklet is not in that graph: `audioWorklet.addModule()` loads it into the audio thread's own global scope, which a `<link rel=modulepreload>` on the document cannot fill, so preloading it would only cost a request. |

With only step 2 done, the game runs on the new engine. The checks below were also run in that state (the `tests/` suite passes, see Verify).

### API compatibility (current dist/audio.js -> new engine)

| dist/audio.js | new engine |
|---|---|
| `EVENTS` (22 names) | the same 22 first, in the same order (`… close deny detect chime`), then `hammer grab error return creak gull hover` and the feature events `sizzle stoke clank ingot sail anchor dive surface` |
| `ALIASES` `{pickup: collect, cast/hook: throw, pour: water, click: ui}` | identical (the round-2 sandbox's own `pickup` recipe is now `grab`) |
| `BUSES` `master effects ambience music` | identical. `setBus` returns the clamped value or `null`; `getBus` reads it back. `'sfx'` and `'ui'` still work as sub-buses under `'effects'`. |
| options `context, volume, ambience, music, output` | identical. `output(ctx)` is also retried from `tick()` every 0.5 s until it returns a node (see the fix below). |
| `resume, setVolume, setMusic, play(ev, s), note(i, step, s), tick(dt, {swimming}), destroy, context, music` | identical signatures and return values. `note` keeps main's rules: `drum pipes bells`, integer step 0..7 (D4..F#5), 50 ms gap per instrument, at most 10 instrument voices inside the 24-voice cap, on the effects bus. `MIN_GAP` matches main for `reel` (0.4 s), `detect` (0.05 s) and `chime` (0.5 s). `play` takes an optional third argument `{x, y, z}`. `tick` reads optional `underwater`, `sail` and `flow`. |
| music bed (pad + plucks, chord change every 10 s) | ported unchanged onto the music bus |
| `tick` lapping/creak one-shots | done by the worklet ocean (slaps, creaks) on the audio thread |
| ambience level | the ambience bus defaults to 0.7, which is `settings.js`'s default. With the default `mix: 'main'` the sea plays at main's level (see the next section). |
| (none) | new option `mix`: `'main'` (default) or `'engine'`; `stats().mix` reports it. `stats().nodesCreated` counts the AudioNodes an engine has created (cumulative). |

### In-game levels vs current main (update day)

The engine's own balance (the sandbox loudness hierarchy) puts the sea about 24 dB louder than main's and most one-shots 2-8 dB louder. So that an update changes the sound but not the balance players are used to, the engine ships with `mix: 'main'` as its default: a fixed trim on the ambience bus (−24 dB) and per-event trims on the one-shots (`MIX` in `audio.js`). The buses themselves are unchanged, so `setBus` / the settings sliders mean what they meant on main.

Measured in the game, at the default settings (master 0.5, effects 1, ambience 0.7), in the same headless Chromium, with the same audio-thread recorder:
- the bed is the median 100 ms RMS over 12 s;
- each one-shot is the median, over 3 plays, of its 100 ms RMS peak, with the ambience bus at 0 so the sea does not lift the quiet ones. The judge's round-3 table measured the one-shots over the sea, which is why it had the `ui` click at +10.5 dB; without the sea under it, the click was only +1.4 dB.

| sound | main engine (dB) | new engine, `mix: 'engine'` (dB) | new engine, default `mix: 'main'` (dB) | default vs main |
|---|---|---|---|---|
| sea bed (median) | −62.0 | −38.3 | −62.3 | −0.3 |
| catch | −30.7 | −23.4 | −30.2 | +0.5 |
| splash | −30.0 | −23.6 | −30.1 | −0.1 |
| collect | −36.9 | −32.7 | −36.6 | +0.3 |
| build | −29.5 | −26.2 | −29.1 | +0.4 |
| place | −31.5 | −29.3 | −31.2 | +0.3 |
| craft | −34.3 | −30.8 | −34.0 | +0.3 |
| repair | −35.3 | −34.4 | −34.1 | +1.2 |
| plant | −37.2 | −34.7 | −36.3 | +0.9 |
| water | −38.2 | −40.3 | −37.7 | +0.5 |
| jump | −30.6 | −25.7 | −30.7 | −0.1 |
| land | −27.4 | −25.4 | −27.9 | −0.5 |
| step | −35.8 | −35.0 | −35.0 | +0.8 |
| swim | −40.7 | −36.9 | −40.5 | +0.2 |
| reel | −47.9 | −44.2 | −47.1 | +0.8 |
| bite | −34.7 | −33.6 | −33.7 | +1.0 |
| ui | −47.0 | −46.0 | −45.9 | +1.1 |
| open | −45.9 | −49.3 | −45.6 | +0.3 |
| close | −40.6 | −41.4 | −41.4 | −0.8 |
| deny | −43.9 | −39.1 | −43.9 | 0.0 |

All 20 of main's events are within 1.2 dB, and the bed is within 0.3 dB. The judge's own `levels.py` (3 s bed, one-shots over the sea) gives the same picture: catch 0.0, build −0.1, collect +0.7, splash −0.9, step +0.7, ui +0.9, deny +0.3 and craft +0.2 dB against main. The bed reads −68.2 there against −64.0, which is the spread of a 3 s window on a slow swell (p10–p90 over 12 s is −64.4 to −59.4 dB).

**Main's newer sounds (refresh against 8d21618).** Same recorder and method (ambience bus at 0, median of 3 plays of the 100 ms RMS peak). `detect` and `chime` are main's recipes on the engine's dry `ui` bus with no trim. `note()` plays main's three instrument recipes on the `sfx` bus with a `note: −2 dB` trim in `MIX.main.events`.

| sound | main engine (dB) | new engine, default `mix: 'main'` (dB) | default vs main |
|---|---|---|---|
| detect (finder tick) | −44.1 | −44.8 | −0.7 |
| chime (lock-on / dig-up) | −35.0 | −35.7 | −0.7 |
| note drum, step 0 / 4 | −25.7 / −25.6 | −25.8 / −24.5 | −0.1 / +1.1 |
| note pipes, step 2 / 6 | −28.2 / −28.1 | −28.0 / −26.8 | +0.2 / +1.3 |
| note bells, step 0 / 5 | −22.3 / −22.2 | −22.6 / −22.4 | −0.3 / −0.2 |

The control events in the same runs (build −29.5 → −29.1, catch −30.9 → −30.2, ui −47.1 → −45.8) and the bed (−62.0 → −62.9) agree with the table above.

The events main does not have (`sizzle stoke clank ingot sail anchor dive surface hammer grab error return creak gull hover`) and the sail luff loop get −3 dB, the median shift of main's events, so they keep their place among the sounds they sit next to.

**Tuning.**
- Per player: the settings sliders call `setBus('effects', v)` and `setBus('ambience', v)` (`applyVolume`, game.js:304), exactly as on main. They scale down from the default only: `setBus` clamps to 0..1, so the slider cannot bring the sea back to the engine's own level.
- Per game: for the sandbox balance, pass `mix: 'engine'` in the factory call at game.js:301 (`createOceanAudio({…, output:…, mix:'engine'})`). That gives a sea about 24 dB louder and one-shots 6–10 dB above it, with the catch as the loudest cue. In between: edit `MIX.main` in `audio.js`, where the `ambience` and `other` trims and the `events` table are in dB.
- One sound: `setBus('sfx', v)` or `setBus('ui', v)` scale the two halves of `effects`.

### Bugs on main that this fixes without any game.js change

- **No underwater muffling after a hot update.** `let diving` is declared at line 370, after `sfx` is created at 301. In a hot-update mount, `sfx.resume()` (line 305) builds the graph before `diving` exists: `output()` throws a TDZ error, which gets swallowed, so the limiter goes straight to `ctx.destination` for the rest of the session. The new engine retries `output` from `tick()` and re-routes once `diving` exists. `--check` asserts `stats().routed` after a hot update.
- **The `reel` spam** keeps main's 0.4 s gap. `game.js:1549` calls `play('reel', .7)` every frame.

## 3. Optional game.js edits (all applied by adopt.py)

1. **Reusable tick state and listener scratch** (after line 326, the `[sailing]` declarations):
   ```js
   let sailing = null; const scenery = [], sailFlow = {x:0, z:0}, aimNdc = {x:0, y:0}; // [sailing]
   const sfxSt = {swimming:false, sail:null, flow:sailFlow}, earDir = new T.Vector3(); // [audio] tick state + listener scratch
   ```
2. **Sailing into tick()** (line 1585, replace):
   ```js
   ocean.update(elapsed, camera); sfxSt.swimming = physics.swimming; sfxSt.sail = sailing ? world.sailing : null; sfx.tick(dt, sfxSt); // [audio]
   ```
   `world.sailing` (`{raised, anchored, windStr, …}`, kept in sync on guests too) drives these:
   - the wind layer: `windStr` 0.55–1 maps to wind 0.3–0.85;
   - a canvas luff loop while the sail is up and not anchored. It is 6 nodes, its flutter rate and level follow the wind, and it stops when the sail is lowered. It is re-targeted only when the wind changes by more than 0.02, like the ocean params, not every frame;
   - `sail` on the raise/lower edge and `anchor` on the anchor edge. The first tick only records the state, so there is no sound at load.

   `sailFlow` (raft speed through the water) drives the hull wash and the creak rate. Nothing is allocated per frame.
3. **Spatial listener** (after line 1588, `updateAvatars(dt); updateCamera(dt); …diving?.update…`):
   ```js
   if (sfx.context) { camera.getWorldDirection(earDir); sfx.setListener(camera.position.x, camera.position.y, camera.position.z, earDir.x, earDir.y, earDir.z); } // [audio]
   ```
   The camera is a direct child of the scene (line 436), so `camera.position` is its world position.
4. **Station and cooking sounds, after the host accepts the action** (four anchors: insert a `stationCue` helper before `function applyAction(a, actor = 'host') {` at line 1076; wrap the `prog?.apply` line at 1078 and the `fc:` line at 1081 in `applyAction`; add one line after `if (prog?.effect(e)) return;` at 1016 in `effect()`):
   ```js
   function stationCue(a, actor) { /* fingerprint before, emit {kind:'sfx'} if it changed */ }   // [audio]
   function applyAction(a, actor = 'host') {
     ...
     const cue = stationCue(a, actor); // [audio]
     if (prog?.apply(a, actor)) { cue?.(); return; } // [progression-hook] …
     if (… a.kind.startsWith('fc:')) { fc?.applyAction(a, actor, {…}); cue?.(); return; } // [fishing-cooking] [audio] cue
   ```
   ```js
   // effect(), after the progression hook
   if (e.kind === 'sfx') { if (typeof e.sound === 'string') sfx.play(e.sound, 1, Number.isFinite(e.x) && Number.isFinite(e.z) ? {x:e.x, y:.6, z:e.z} : undefined); return; } // [audio] stationCue
   ```
   - The mapping: smelter `prog:fuel` → `stoke`, `prog:insert` → `clank`, `prog:take` → `ingot`. Grill `prog:insert` → `sizzle`, `prog:fuel` → `stoke`, `prog:take` → `grab`. Driftwood grill `fc:cook` → `sizzle`.
   - How a cue waits for acceptance: before the hook runs, `applyAction()` (host only) records a fingerprint of what the action changes when it is accepted. For `prog:*` that is the actor's bag (`bag.snapshot()`: an insert or a fuel removes items, a take adds them). For `fc:cook` it is the number of occupied slots on that grill. Only if the fingerprint changed does the host `emit({kind:'sfx', sound, x, z}, actor)`. For the host that plays locally; for a guest it is sent as an effect, so the guest hears its own action once, after the host took it.
   - What stays silent: a rejected action (bag full on a take, nothing to take, grill full, no such station), and a guest's action while it is not connected. On the not-connected case, `action()` never reaches the host.
   - Sound placement: the cue plays spatially at the station's tile (`x*2, .6, z*2`). The `sfx` effect carries nothing else, so `effect()` shows no notice and does not fall back to `deny`. An older guest without the `effect()` line plays `e.sound` through its own `play()`; on main's engine those event names are unknown, so it stays silent.
   - `--check` drives it through the real station panel on a smelter. `Take` with an empty output is refused and stays silent. Adding wood as fuel plays exactly one spatial `stoke`.

Diving needs no edit. `diving.js` dispatches `raft:underwater` `{underwater}` on every change; the engine listens to it, plays `dive` / `surface` on the edges, closes its tone stage to about 1 kHz, and drops the wind layer. This is on top of diving's own 600 Hz output low-pass. `tick(dt, {underwater})` overrides the event if a caller prefers that.

## 4. Hot update and failed hot update

- **Good update.** The new build's `sfx.resume()` (line 305) takes over the ocean worklet node that is playing: the node and its fade gain move onto the new engine's ambience bus in that task. The old build's `destroy()` then leaves the ocean alone and fades its own master out over 80 ms. The result is one context, no second worklet node, no module load, and no hole.
- **Failed update.** `live.js` mounts the new build. If its `mount()` throws after line 305, `game.js` disposes it (`sfx.destroy()`), and `live.js` keeps the old build ("Update paused — still playing this version"). The handle the new engine took records the engine it took it from (`from`). Because that engine is still alive, `destroy()` first hands the ocean back: the fade gain moves onto the old engine's ambience bus in the same task, the old engine marks it as its own again, and only then does the failed engine fade out its own master. A second safety net covers the case where an owner dies without handing back: the old engine's `tick()` sees the handle's shared `core.dead` flag and starts a fresh ocean.
- **Version field.** The per-context shared record (`Symbol.for('little-raft.audio.shared')` → WeakMap) and every ocean handle carry `v: SHARED_VERSION` (2). A build takes over or reuses only a record and handle of its own version. Otherwise it starts its own and leaves the foreign one to its owner, so a future build that changes the shape is never handed one it misreads.
- **The one-time switch from main's engine (the first live update after adoption).** Tabs that are open on the current main build get the new engine by hot update, like any release. Main's `destroy()` (`dist/audio.js:579`) does not hand its ocean over: it hard-stops its surf and wind sources (`stopNodes(amb)`) with no fade, and it disconnects its buses. The new engine finds no shared ocean record of its own version, so it does what a first start does. It runs `addModule` for the worklet (about 0.1–0.5 s on a normal machine; this box's 23 s under load is the extreme), then fades its ocean in over 0.15 s, which is its swap fade, because the context is already running. Open tabs therefore hear one small click and a short gap in the sea, once. One-shots still sounding on main's engine are cut. With the default `mix: 'main'`, both seas sit near −62 dB, so the click is from a quiet bed into the same quiet bed. Every later update is engine to engine and goes through the handover above, with no gap. A page load (new tabs, or a reload) never hears the switch. This cannot be fixed from the new engine's side: main's `destroy()` runs in main's code, and no handover protocol exists there to answer.
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
   - the buses are at their defaults (effects 1, ambience 0.7, music 0.7);
   - the station cue (edit 4): a refused `Take` is silent, and an accepted fuel plays one spatial `stoke`.

   The ocean check waits for the worklet for up to 30 s (`wait_for_function`), not a fixed 5 s. On this loaded box (load average 40+) the worklet module took 23.4 s to come up.
2. **Failed hot update.** It republishes with a `game.js` whose `mount()` throws right after `init()`, which is after the ocean takeover, and lets `live.js`'s own 6 s poll pick it up. It asserts that `live.js` kept the old build with the injected error, that the old engine owns a worklet ocean again, that no new worklet node was created, and that the level holds: no 100 ms window more than 10 dB under the trailing 1 s, and never below −85 dB. The floor was −70 dB before the `main` mix put the sea at about −62 dB; digital silence reads −120 dB on this recorder.
3. **Good hot update.** It republishes a clean build. It asserts the swap happened, that there is one context in the `running` state, that the ocean was handed over (same worklet-node count), that every module URL carries `?build=`, that the level holds, and that the new engine re-routed into the new diving module's low-pass.

Then run `node --test tests/*.test.mjs` with and without `RAFT_DIST=<patched copy>`. `tests/survival.test.mjs` has two audio API tests (buses, gesture, voice cleanup, music, cap, destroy) that run the engine against a fake Web Audio graph.

Results from the run on this branch are in `docs/tech/audio.md` → "Retarget to main".

Refresh against 8d21618 (this box, load average 35–50): `adopt.py --check` passes all 20 checks: no page errors, the worklet came up after 8.2 s, every one of the 37 EVENTS schedules in the game, and the station cue was silent on the refused take and played one spatial `stoke` on the fuel. The failed hot update dipped at most 1.8 dB (minimum −65.4 dB), and the good hot update at most 5.0 dB (minimum −69.4 dB). `node --test tests/*.test.mjs` gives 909/910 both unpatched and with `RAFT_DIST=<patched copy>`. The one failure in both is the `art.test.mjs` atlas build-time limit (6.2 s on this loaded box), which has nothing to do with audio. With the engine in, `instruments.test.mjs`'s `audio note()` test and the three `live-preload.test.mjs` tests pass.
