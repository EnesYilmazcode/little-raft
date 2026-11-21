# Adopting the procedural audio engine

This replaces the inline `beep(f)` sine in `dist/game.js` with the engine from `sandbox/audio/` (worklet ocean ambience, spatial one-shots, buses and ducking). It was checked against the current `dist/` (build token `v3-survival-ae77fa84ac2b`, `dist/game.js` 1208 lines).

## Fast path (scripted, verified)

```sh
python sandbox/audio/adopt.py --check   # copies dist/ to a temp dir, applies everything below, boots the game headless
python sandbox/audio/adopt.py --apply   # same edits on dist/ in place
```

`adopt.py` holds every edit as an exact `old -> new` string that must match `dist/game.js` exactly once, so it refuses to half-apply if game.js has drifted. `--check` starts a solo game, clicks the canvas (user gesture), presses R (which plays an effect sound), and asserts four things: no page errors, exactly one `AudioContext`, `audio-worklet.js?build=…` loaded with one `AudioWorkletNode` built, and oscillators created. The last run passed:

```
modules: ["http://127.0.0.1:…/audio-worklet.js?build=v3-survival-ae77fa84ac2b"], worklets: 1, contexts: 1, oscillators: 1-9 (varies with which effect R triggers), errors: []
```

## Manual steps (what the script does)

### 1. Add two files to `dist/`

| source | destination | note |
|---|---|---|
| `sandbox/audio/audio.js` | `dist/audio.js` (replaces it) | change the one literal `'./audio-worklet.js'` (in `workletDefault`, near the top) to `'./audio-worklet.js?build=v3-survival-ae77fa84ac2b'` |
| `sandbox/audio/audio-worklet.js` | `dist/audio-worklet.js` | copied unchanged |

**Worklet location.** It is served next to the module as `dist/audio-worklet.js`, so the URL is `/audio-worklet.js?build=<token>`. `audio.js` resolves it with `new URL('./audio-worklet.js?build=…', import.meta.url)`, which means it works under any base path.
- `publish_local.py` rewrites every `'./name.js'` literal in root `.js` files to carry the new `?build=`, the worklet literal included. Each release therefore loads its own processor file.
- `audio-worklet.js` wraps `registerProcessor` in try/catch. A hot update that loads the new file into the same `AudioContext` keeps working: the first-registered class is used.
- AudioWorklet needs a secure context. `127.0.0.1` (desktop app and the local server) and https qualify. On a plain-http LAN address the engine silently uses its node-graph ambience instead.

`dist/audio.js` keeps the old API: `createOceanAudio({context, volume, ambience})` returns `{context, resume(), setVolume(v), play(ev, s), destroy()}`, and `EVENTS` contains every old event. Nothing else in `dist/` imports `audio.js` today, so the old callers' contract is preserved trivially. The new members (`setListener`, `setOcean`, `setReel`, `setBus`, `duck`, `stats`, the `opts` argument to `play`) are optional.

Two behaviour differences from the old `dist/audio.js`:
- **Play before the context is running.** After `resume()` has been *called*, `play()` schedules the sound even while the context is still `suspended` (it plays on resume). The old version returned false and dropped it.
- **Ambient gulls.** Gulls start on their own after `resume()`. Pass `gulls:false` to turn them off.

### 2. Edit `dist/game.js`

The build token below is the one game.js already uses on its other imports.

1. **Import** (after line 17, the `survival-ui.js` import):
   ```js
   import { createOceanAudio } from './audio.js?build=v3-survival-ae77fa84ac2b';
   ```
2. **Create the engine** (after line 199, `let sound = …, audio = X?.audio ?? null;`). It reuses the context a hot update handed over:
   ```js
   const sfx = createOceanAudio({context:audio, volume:options.volume});
   if (sound && audio?.state === 'running') sfx.resume(); // hot update: context already unlocked, keep the ocean going
   let reelSound = false, lastHookStage = null; const earDir = new T.Vector3();
   ```
3. **Helpers.** Insert before line 400 (`function beep(f = 500) {…}`), then delete the `beep` line once every call site below has been converted:
   ```js
   function wakeAudio() { if (!sound || !(options?.volume > 0)) return; sfx.setVolume(options.volume); sfx.resume(); audio = sfx.context ?? audio; }
   function sfxPlay(ev, s = 1, pos = null) { if (!sound || !(options?.volume > 0)) return; wakeAudio(); sfx.play(ev, s, pos); }
   ```
4. **Call sites.** Replace each `beep(...)`. `pos` is the hook's `T.Vector3` already in scope at those lines; PannerNode reads `.x/.y/.z`.

   | line | old | new |
   |---|---|---|
   | 530 `effect()` | `beep(e.kind === 'build' ? 640 : e.kind === 'craft' ? 560 : e.kind === 'full' ? 220 : 440);` | `sfxPlay(e.kind === 'build' ? 'hammer' : e.kind === 'craft' ? 'craft' : e.kind === 'full' ? 'error' : e.kind === 'loot' ? 'collect' : 'ui');` |
   | 618 pickup | `swing = .6; beep(500);` | `swing = .6; sfxPlay('pickup');` |
   | 640 rod cast | `notice('Wait for a bite…', 2500); beep(280);` | `notice('Wait for a bite…', 2500); sfxPlay('throw', .5);` |
   | 661 `throwHook()` | `reeling = false; swing = 1; beep(230);` | `reeling = false; swing = 1; lastHookStage = 'flying'; sfxPlay('throw', .35 + .65 * charge);` |
   | 690 player splash | `if (ev?.splashed) beep(180);` | `if (ev?.splashed) sfxPlay('splash', 1);` |
   | 792 new catch | `if (caught.length > lastCaughtCount) beep(520 + caught.length * 30);` | `if (caught.length > lastCaughtCount) sfxPlay('catch', Math.min(1, .7 + caught.length * .1), pos);` |
   | 804 hook back | `} else if (ev?.kind === 'returned') beep(300);` | `} else if (ev?.kind === 'returned') sfxPlay('return');` |

5. **New hook cues** in `updateHook()`:
   - After line 784 (`hookMesh.visible = true; hookMesh.position.copy(pos);`) and before `if (hook.stage === 'flying')`, add:
     ```js
     if (lastHookStage === 'flying' && hook.stage === 'floating') sfxPlay('splash', .55, pos);
     lastHookStage = hook.stage;
     const wantReel = sound && hook.stage === 'reeling'; if (wantReel !== reelSound) { reelSound = wantReel; sfx.setReel(wantReel, .6); }
     ```
   - In the fishing-rod branch, before line 779 (`if (f >= 1) { action({kind:'fish'}); …`), add:
     ```js
     if (u >= 1 && (hook.t - dt) * 5 / hook.duration < 1) sfxPlay('splash', .4, pos);
     if (hook.t > fishWait && hook.t - dt <= fishWait) sfxPlay('bite', 1, pos);
     ```
   - In `endHook()` (line 770), make it start with: `function endHook() { if (reelSound) { reelSound = false; sfx.setReel(false); } hook = null; …`
6. **Listener** in `frame()`, right after line 827 (`updateAvatars(dt); updateCamera(dt);`):
   ```js
   if (sfx.context) { camera.getWorldDirection(earDir); sfx.setListener(camera.position.x, camera.position.y, camera.position.z, earDir.x, earDir.y, earDir.z); }
   ```
7. **Unlock on the first gesture** (autoplay policy). After line 857 (`on(document, 'pointerlockerror', lockFailed);`), add the line below. `on()` attaches the mount's AbortSignal, so dispose removes it.
   ```js
   on(window, 'pointerdown', wakeAudio, {capture:true}); on(window, 'keydown', wakeAudio, {capture:true});
   ```
8. **Volume and sound toggle:**
   - Line 1183: `createSettings({onChange:next => { options = next;` becomes `createSettings({onChange:next => { options = next; sfx.setVolume(sound ? next.volume : 0);`
   - Line 928: `() => { sound = !sound; soundLabel(); }` becomes `() => { sound = !sound; soundLabel(); sfx.setVolume(sound ? options.volume : 0); if (sound) sfxPlay('ui'); }`
9. **Hot update:**
   - In `capture()` (line 1139), change `fishWait, sound, audio, peer,` to `fishWait, sound, audio:sfx.context ?? audio, peer,`. The next build receives the live context as `X.audio` and passes it to its own `createOceanAudio({context:audio})`.
   - In `dispose()` (after line 1171 `try { settingsController?.destroy(); } catch {}`), add `try { sfx.destroy(); } catch {}`. This stops and disconnects only this build's nodes and worklet and **never closes the context**.

Optional, not in the script: drive the sea from the game. Once per frame (or less often), call `sfx.setOcean({swell: clamp(Math.hypot(raft.rotation.x, raft.rotation.z) * 8, .2, 1), wind: weatherWind, speed: raftSpeed})`. All values are 0..1 and smoothed over about 1 s, so per-frame calls are fine. Footsteps on planks can use `sfxPlay('creak', .3, {x, y, z})` sparingly.

### 3. Verify

1. `python sandbox/audio/adopt.py --check` must print `"ok": true`.
2. `python sandbox/audio/shoot.py`: `summary.warnings` must be `{}` (no clipping, DC or truncated tails), `errors` must be `[]`, and `realtime.hotSwap.sameContext` must be `true`.
3. Manual, with sound:
   - Start solo and click once. The ocean fades in over 2.5 s.
   - Throw the hook and listen for the whoosh, then a splash where it lands. Hold to reel for the ratchet. A catch should give a shloop plus pluck, with the ocean dipping briefly.
   - Build a floor for the hammer crack.
   - Turn your head: the hook splash and gulls should move between the ears.
   - Toggle Sound off and on, and move the volume slider.
4. Hot update: publish a candidate with `publish_local.py`. The ocean should keep playing through the swap: the new mount calls `sfx.resume()` straight away on the context that is already running, and old and new overlap briefly because `live.js` disposes the old build only after the new mount succeeds. `stats().worklet` should be `true` after the swap (`raftDebug` does not expose it; check with a breakpoint or a temporary `window.__sfx = sfx`).

## Rollback

Restore `dist/game.js` and `dist/audio.js` from git and delete `dist/audio-worklet.js`. The game never depended on `audio.js` before.
