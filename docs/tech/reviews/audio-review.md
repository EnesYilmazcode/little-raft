# Audio review (harsh judge)

Reviewed `origin/fleet-tech/audio` at b3ec854. I checked everything myself: I re-ran `shoot.py`, read the PNGs and analysed the WAVs with numpy, re-measured costs, ran `adopt.py --check`, matched every ADOPT line reference against `dist/game.js`, and ran a real hot-swap test (adopt on a scratch copy of dist/, boot solo, then republish twice with the `publish_local.py` rewrite and call `raftLive.check()`).

## Scores

| axis | score |
|---|---|
| LOOKS (sound quality, as evidenced) | 7 |
| COST | 6 |
| ADOPT-CORRECTNESS | 5 |
| OVERALL (at most lowest + 2) | **5** |

## What holds up

- `shoot.py` covers 34 cases. `warnings {}`, errors `[]`, max peak −3.4 dBFS, every |DC| < 6e-4, no clipping. All one-shots decay to 0 (tails reach −∞ or below −60 dB). The first and last samples of every one-shot are 0. I looked for clicks with a second-difference detector: every spike is a deliberate transient onset (0.5–3 ms rise, no steps). The mix spike at 6.6 s is the hammer.
- Spectrograms read as described. Catch: noise sweep, then plucks, then an octave chime ringing to about 1 s. Hammer: broadband crack plus a 165 Hz body. Gull: a harmonic stack with an irregular kyow/ha contour. Reel: evenly spaced ratchet near 3 kHz. Creak-calm: a clear block with 640 Hz / 1.2 kHz lines over the bed. I saw no aliasing hash: the PeriodicWave and the ratchet are band-limited.
- All ADOPT line numbers (17, 199, 400, 530, 618, 640, 661, 690, 770, 779, 784, 792, 804, 827, 857, 928, 1139, 1171, 1183) and old strings match the current `dist/game.js` exactly. `charge`, `pos`, `T`, `camera` and `options` are in scope where they are used.
- `adopt.py --check` printed ok: `audio-worklet.js?build=v3-survival-ae77fa84ac2b`, 1 worklet, 1 context, no page errors.
- Hot swap (my test, two consecutive updates): **1 AudioContext total**, state running. The worklet loaded as `?build=hot2` and then `?build=hot3`. 3 worklet nodes for 3 builds, so the ambience is not duplicated. No errors. `publish_local.py`'s regex does stamp the `'./audio-worklet.js'` literal.
- Offline render cost matches the doc: ambience 28–68 ms per audio second, stress-24 82 ms/s.

## Problems found

1. **The hot update cuts the ocean to silence (the doc claims the opposite).** `live.js` does capture → mount → dispose synchronously in one task. `destroy()` (`sandbox/audio/audio.js:783-798`) hard-stops voices (`killVoice` at 778 calls `src.stop()` with no ramp) and disconnects the master/limiter at once. The new engine has not loaded its worklet yet (`addModule` is async), and then it fades in from 0 over 2.5 s (line 195). Measured in the realtime context at the swap: about −37 dB RMS, then digital silence (−120) for a few blocks, then −55 to −60 dB for about 1.8 s, and back to about −36 dB after roughly 2 s. That is a click plus a 2 s hole on every published update. `audio-ADOPT.md:109` ("keep playing through the swap … old and new overlap briefly") is false.
2. **The ADOPT call sites break the loudness hierarchy in the game.** `catch` (`game.js:792`), the hook-landing `splash` and `bite` are given `pos` = the hook position. That position is usually 8–30 m away (hook range is up to 32 m), with `refDistance` 2 m and the inverse model (`audio.js:47`, `296`), so gain is 2/d. A catch at 16 m is about −18 dB and low-passed to about 6 kHz: roughly −34 LUFS, quieter than `pickup` (−29) and level with the UI `error`. The "catch is the loudest one-shot" result is only true for the non-spatial test case.
3. **There is an undocumented main-thread hitch on first gesture and inside every hot-update mount.** `resume()` → `buildGraph()` makes 11 s of noise (`audio.js:121`) plus the reverb IR on the main thread. Measured synchronous `resume()` cost was 15, 20, 20, 25, 33, 52, 72 and 202 ms (median 33 ms). In the ADOPT design it runs inside `mount()` during the hot swap (step 2, `sfx.resume()`), so the swap stalls the frame too.
4. **The `play()` cost claim is understated for the gull.** The doc's `audio.md:88` gives 0.1–0.5 ms median and p95 ≤ 4 ms. My `shoot.py` run measured gull at median 1.3 ms and p95 13.3 ms (about 140 automation events per long call), and catch at p95 3.6 ms. The engine schedules gulls itself every 9–30 s on the main thread, so this is a periodic frame spike.
5. `adopt.py --check`'s `ok` (`adopt.py:137`) never checks that the worklet URL carries `?build=`, and never exercises a hot swap. The two things most likely to regress are untested.
6. Minor doc errors. `audio.md:23` says "8 call sites" but lists 7, and 7 is the true count. `audio.md:117` says the far gull's harmonics above 5 kHz are "gone", but `gull-far.png` still shows them at 8–10 kHz (a 12 dB/oct low-pass only dulls them).
7. Sound nit: `ambience-rough` has a ~12 dB spectral valley at 500–700 Hz, between the bed low-pass (≤420 Hz) and the wind band (~0.9–1.3 kHz). Rough seas read as two separate layers, rumble plus hiss.

## Required fixes (OVERALL < 7)

1. `sandbox/audio/audio.js` `destroy()` (783-798) and `killVoice()` (778): ramp `graph.master` to 0 over about 60–100 ms, then stop and disconnect (use `setTimeout`, or a ConstantSource `onended` on the shared context). In `startAmbience()` (195), skip the 2.5 s fade (use about 0.3 s) when the context is already running at creation, so a hot swap crossfades instead of leaving a hole. Then fix the claim at `docs/tech/audio-ADOPT.md:109`.
2. `sandbox/audio/audio.js:47` `REF_DISTANCE`: give `catch` (about 12–15 m), `splash` and `bite` (about 8 m) larger reference distances. Alternatively, in ADOPT step 4 at `game.js:792`, play `catch` without `pos`. Add a render case for a catch and a splash at 16 m and put the result in the level table.
3. `sandbox/audio/audio.js:121` (`buildGraph`): cache the noise buffers and IR per context (a module-level `WeakMap<BaseAudioContext, …>`) so a hot mount doesn't regenerate them. Shorten them or build them lazily. Document the first-gesture cost in `audio.md`.
4. Gull scheduling cost (`gullSeries`, `audio.js:408-455`): cut the automation events per call (for example, drop the per-call formant ramps or share one ramp set), or pre-build the call off the critical path. Re-measure and correct `audio.md:88`.
5. `sandbox/audio/adopt.py:137`: require `'?build=' in module URL`, and add a hot-swap step (republish with a new token, `raftLive.check()`, then assert 1 context, the new `?build=` module, and the ambience level not dropping below a threshold across the swap).

Nice-to-haves: fill the 500–700 Hz hole in rough seas (widen the bed low-pass, or add a low wash band). Fix the two doc errata. When sound is toggled off, `suspend()` the context or stop the worklet so the always-on DSP doesn't cost CPU.
