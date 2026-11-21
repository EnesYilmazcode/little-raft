# Procedural audio

How Little Raft should sound without shipping a single audio file: a living ocean bed that rises and falls with the swell, wind with gusts, a raft that creaks when it tilts, distant gulls, and satisfying one-shots for the hook loop (throw, splash, reel, catch), building (hammer), pickups and UI. Everything is synthesised at runtime with Web Audio: one AudioWorklet for the ambience and short node graphs for the one-shots.

Prototype: `sandbox/audio/` (serve the repo root, open `sandbox/audio/index.html`, press **Start audio**). The page has a button per sound, sea-state and bus sliders, a hold-to-reel button, a top-down spatial pad (click to play a sound at that spot around the listener) and an offline-render button per test case that draws the waveform and spectrogram.

Headless check: `python sandbox/audio/shoot.py` renders 31 cases through `OfflineAudioContext` (48 kHz stereo, volume 1, which is the loudest case) and writes `sandbox/audio/shots/<case>.wav`, `<case>.png` (waveform plus a log-frequency spectrogram) and `report.json`. It also runs a realtime smoke test in which a real AudioContext loads the worklet, plays every event, runs the reel, then destroys the engine and re-creates it on the same context with a new `?build=` worklet URL, which is the hot-update path. `python sandbox/audio/shoot.py --bench` runs the engines interleaved for a cost comparison.

Files:

| file | role |
|---|---|
| `sandbox/audio/audio.js` | the engine, a drop-in replacement for `dist/audio.js` |
| `sandbox/audio/audio-worklet.js` | the `raft-ocean` AudioWorkletProcessor (ambience) |
| `sandbox/audio/render-lab.js` | test cases, offline render, analysis, waveform/spectrogram drawing, WAV encoder |
| `sandbox/audio/index.html` | interactive lab |
| `sandbox/audio/shoot.py` | headless render and level/cost report |
| `sandbox/audio/adopt.py` | applies the adoption to `dist/` (`--check` runs it on a temp copy and boots the game) |

## What the game does today

- `dist/audio.js` (`createOceanAudio`) exists but **nothing imports it**. It has 8 events, a looped brown-noise surf at gain 0.025, and node-graph one-shots.
- `dist/game.js` makes every sound with `beep(f)` at line 400: one sine with a pitch blip, a new `AudioContext` on first use, and no buses, ducking, spatialisation or ambience. Its 8 call sites are effect feedback (line 530), pickup (618), rod cast (640), hook throw (661), player splash (690), catch (792) and hook returned (804). The `AudioContext` is carried across hot updates as `X.audio` and `capture().audio`.

## Approaches considered

| approach | how | verdict |
|---|---|---|
| A. node graph | looped noise buffers, BiquadFilters, LFO oscillators, all native | Cheap and robust, but the swell, washes and creaks cannot be correlated without a JS timer scheduling envelopes, and loops repeat. This is now the **fallback** ambience when AudioWorklet is missing. |
| B. AudioWorklet | one processor, per-sample DSP on the audio thread | **Chosen for ambience.** One clock drives everything, so a wash arrives on each crest, slaps land in the troughs and creaks fire on the steepest tilt. Nothing repeats, there are no DOM timers, and it costs about the same as A or less (below). |
| C. baked buffers | render A/B once with OfflineAudioContext, then loop the buffers | Cheapest at runtime, but 24 s of stereo float audio per weather state is ~9 MB of RAM, it takes about 1 s to bake on load, and you can hear the loop. Rejected. |
| one-shots in the worklet | voice pool inside the processor | Tried in the salvaged lab (`ocean-worklet.js`, since removed). Every SFX tweak then means editing DSP code, the port messages arrive with jitter, and PannerNode cannot be used per voice. One-shots stay as short node graphs: native nodes are cheap and get garbage-collected when they end. |

## Design

```
one-shot voice ─► [PannerNode, if play(ev, s, {x,y,z})] ─► sfx bus ─┐
UI voice (ui/hover/error/craft) ──────────────────────────► ui bus ─┤
raft-ocean worklet (or node fallback) ─► fade-in ─► ambience bus ─► duck ─┴► mix ─► lowpass 9 kHz ─► master (volume × 0.8) ─► limiter (-6 dB, 12:1) ─► out
reel loop (setReel) ───────────────────────────────────────► sfx bus
```

**Ambience worklet (`raft-ocean`, stereo, k-rate params `swell wind speed creak gain`).** A dominant swell oscillator (period 8–12 s, shorter when `speed` rises) plus a 0.157 Hz partner gives the height `h`.
- Bed: brown noise per channel (decorrelated L/R, measured correlation 0.04–0.15), one-pole low-pass at 160–420 Hz that opens and gets louder with `h`.
- Wash: pink noise into a TPT state-variable band-pass that sweeps 450–1950 Hz. A 0.45 s attack and 1.2 s release fire on every crest, with random strength and pan.
- Slaps: 1–4 short band-passed bursts at 260–620 Hz in each trough, like water lapping the logs.
- Wind: two band-passes (L/R offset ×1.13) at 260–1260 Hz. Q and level follow a smoothed random gust walk, and a faint high-Q whistle comes in on strong gusts.
- Creaks: on the steepest part of each swell, with probability `creak × (0.35 + 0.65 swell)`, a stick-slip impulse train (25–70 Hz, rising ×1.5–2.6 then falling, ±25 % jitter) excites three wood resonators (290/640/1210 Hz, Q 9–12). Each creak is randomly panned, and the pool holds 3.
- DC blockers on both outputs. No allocation in `process()`, and filter coefficients are retuned once per 128-frame block.

**One-shots** are recipes of a few oscillators, noise-buffer sources, biquads and gains, each with an exponential envelope that ends in a linear ramp to 0. That end ramp is why every case decays to −∞ dB at its tail with no truncation clicks. The building blocks are:
- `knock`: resonant noise tick plus a falling sine body.
- `modes`: decaying sine partials. The hammer uses 165/395/720/1130 Hz plus a 3.3 kHz head ping and a 2 kHz contact crack.
- `bubble`: a Minnaert-style sine that rises as it decays. It is used for splash, catch, swim and bite.
- `gullCall`: a sawtooth with a fast up-glide and slow fall into a 2.3 kHz formant, with 40–55 Hz FM for roughness.
- The ratchet is a band-limited square wave → high-pass 2.5 kHz → band-pass 3.3 kHz. Each edge is a click, so the rate is the reel speed.

**Spatial.** `play(ev, s, {x,y,z})` inserts a PannerNode (`equalpower` by default, `hrtf:true` opt-in; inverse distance; `refDistance` 2 m, gull 10 m, creak 3 m). `setListener()` is called once per frame from the camera. Ambient gulls are scheduled by the engine itself every 9–30 s at 14–40 m, with an audio-clock timer: a silent ConstantSourceNode whose `ended` event arms the next one. No `setTimeout` is involved, so gulls pause with the context.

**Mixer and ducking.** The buses are `ambience`, `sfx` and `ui` (`setBus(name, v)`). Big events duck the ambience bus by `DUCK[ev] × strength` (catch 0.4, splash 0.35, hammer/build 0.25, craft 0.2, jump 0.15) with a 20 ms attack, 0.2 s hold and about 0.75 s recovery. The measured dip on a catch with the sfx bus muted (case `duck-only`) is −33.0 → −37.2 → −33.0 dB RMS.

**Budget guards.** At most 24 voices (`play()` returns false beyond that), a per-event minimum gap of 25–300 ms, and the reel is one persistent voice. Each voice's nodes are disconnected on its last source's `ended`. `destroy()` frees everything this instance made but never closes the context.

## Numbers

All numbers are from headless Chromium on a shared CI box. **Timings are relative**: they swing 2–5× between runs depending on load from the other agents, so the bench uses interleaved repeats and reports min and median.

**CPU (offline render, ms per second of audio; real time is 1000).** These are from `shoot.py --bench`, 7 interleaved runs:

| case | min | median | what |
|---|---|---|---|
| ambience-calm (worklet) | 16.6 | 39.8 | full ocean, about 2–4 % of one core |
| ambience-fallback (node graph) | 30.5 | 109.6 | same job with native nodes: the worklet is **not** more expensive |
| ambience-rough (worklet, all layers maxed, creaks) | 54.9 | 80.2 | |
| stress-24 (worklet + 24 spatial voices at once) | 78.4 | 126.6 | worst case, about 8–13 % of one core |
| hammer one-shot | 6.2 | 12.2 | |
| splash one-shot | 8.3 | 18.9 | |

**Main-thread JS cost of `play()`** (scheduling only, median and p95 over 60 calls) is 0.1–0.5 ms median for every event, and p95 is up to ~4 ms when the box is busy (gull 10 ms once). That is 3–21 Web Audio nodes per voice: hover 3, ui/jump/reel tick 6, hammer 14, catch/splash 21, gull 19–25.

**Levels at volume 1** (worst case). There is no clipping in any case, the maximum peak over all 31 cases is −2.8 to −3.4 dBFS (the mix case, where the limiter acts), and every |DC| is below 1e-3. The worklet's DC blocker holds it below 6e-5.

| case | peak dBFS | RMS dBFS | −60 dB decay ms |
|---|---|---|---|
| throw (full charge / soft) | −17.7 / −22.7 | −39.1 / −45.8 | 690 / 540 |
| splash (hook) / splash-big (player) | −9.4 / −8.4 | −34.9 / −30.9 | 380 / 660 |
| reel (2 s loop, 2 speeds) | −10.4 | −33.2 | 1800 |
| catch | −6.0 | −26.8 | 610 |
| hammer / hammer at 6 m left | −6.5 / −15.0 (R channel silent) | −29.4 / −39.0 | 180 |
| gull close / gull ~30 m | −11.3 / −22.2 | −27.9 / −40.7 | 1370 / 760 |
| pickup / collect | −11.4 / −15.9 | −32.9 / −34.2 | 170 / 260 |
| build / craft / repair | −10.6 / −12.5 / −14.5 | −29 to −35 | 290 / 720 / 530 |
| jump / swim / bite / return / creak | −11.1 / −20 / −14.5 / −12.4 / −15.7 | −29 to −40 | 210 / 410 / 180 / 180 / 590 |
| ui / hover / error | −21.5 / −34.5 / −14.9 | −45.3 / −54.6 / −33.3 | 110 / 100 / 330 |
| ambience calm / rough | −13.5 / −7.4 | −30.7 / −24.7 | continuous |
| mix (ambience + hook loop + hammer) | −3.4 | −27.4 | |

**What the shots show** (I read every PNG):
- `hammer`: a broadband crack, then the 165 Hz body ringing out in about 180 ms, plus the thin 3.3 kHz ping.
- `catch`: a rising noise sweep, droplet chirps, then two triangle plucks (fifth apart).
- `reel`: evenly spaced ratchet clicks, faster after 0.8 s, centred near 3 kHz over line hiss.
- `gull`: 2–4 harmonic chevrons (up-glide, fall).
- `splash-big`: a broadband burst closing down, with separate bubble chirps.
- `ambience-*`: a broadband bed with a visible wash on each crest. Creaks show as three faint formant lines at about 640 Hz and 1.2 kHz.
- `mix-ducking`: every event is distinct over the bed.

## Decision

Adopt `sandbox/audio/audio.js` plus `audio-worklet.js` as `dist/audio.js` plus `dist/audio-worklet.js`, and wire `game.js` to it (`docs/tech/audio-ADOPT.md`; `sandbox/audio/adopt.py --check` proves it boots in the real game). The API is a strict superset of the current `dist/audio.js`. The extra events, positions, sea state, reel loop, buses and listener are all optional.

## Known weaknesses

- **Insecure origins lose the worklet.** AudioWorklet needs a secure context. Playing over `http://<LAN-IP>` (not localhost) falls back to the node-graph ambience. That fallback is fine but static: there are no crest-synced washes or creaks, and the swell is a fixed LFO. Electron/localhost/https are unaffected.
- **Not listened to by a human.** Everything here was judged from spectrograms, envelopes and levels in a headless box with no sound card. The mix balance (ambience around −31 dB RMS against SFX peaks of −6 to −18 dB at volume 1) and the timbres need an ear pass. The gull and creak are the riskiest: synthetic gulls can sound like toy whistles.
- **Equal-power panning is hard.** A source at 90° is fully in one ear (`hammer-left`: right channel silent). That is fine on speakers but blunt on headphones. `hrtf:true` fixes it at several times the per-voice cost. There is no reverb, occlusion or Doppler.
- **Creaks are subtle.** At default `creak 0.5` they sit under the bed and only cut through with `swell` ≥ 0.7. That is deliberate, but they may be inaudible on laptop speakers.
- **Timing noise.** The CPU numbers come from a contended shared box with SwiftShader. Treat them as ratios (worklet ≈ ½ of node fallback; full stress ≈ 5× calm ambience), not absolutes. No real-device audio-thread profiling was done. Mobile low-end devices could glitch at 24 voices plus HRTF.
- **The ambient gull scheduler needs a running realtime context.** It is disabled offline and pauses while the tab is suspended, which is intended.
- **Context autoplay policy.** Nothing plays until the first pointerdown or keydown, and `wakeAudio` in the adoption hooks both. A guest that only uses the gamepad would stay silent. There is no gamepad input today.
- **No music bus or per-category settings UI.** `setBus()` exists, but the settings dialog only has master volume.
