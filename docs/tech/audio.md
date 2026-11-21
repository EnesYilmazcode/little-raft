# Procedural audio

How Little Raft should sound without shipping a single audio file: a living ocean bed that rises and falls with the swell, wind with gusts, a raft that creaks when it tilts, distant gulls, and satisfying one-shots for the hook loop (throw, splash, reel, catch), building (hammer), pickups and UI. Everything is synthesised at runtime with Web Audio: one AudioWorklet for the ambience and short node graphs for the one-shots.

Prototype: `sandbox/audio/` (serve the repo root, open `sandbox/audio/index.html`, press **Start audio**). The page has a button per sound, sea-state and bus sliders, a hold-to-reel button, a top-down spatial pad (click to play a sound at that spot around the listener) and an offline-render button per test case that draws the waveform and spectrogram.

Headless check: `python sandbox/audio/shoot.py` renders 34 cases through `OfflineAudioContext` (48 kHz stereo, volume 1, which is the loudest case) and writes `sandbox/audio/shots/<case>.wav`, `<case>.png` (waveform plus a log-frequency spectrogram) and `report.json`. It also runs a realtime smoke test in which a real AudioContext loads the worklet, plays every event, runs the reel, then destroys the engine and re-creates it on the same context with a new `?build=` worklet URL, which is the hot-update path. `python sandbox/audio/shoot.py --bench` runs the engines interleaved for a cost comparison.

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
spatial voice ─► air low-pass (by distance) ─► PannerNode ─► crossfeed ─┐
plain one-shot voice / reel loop ───────────────────────────────────────┴► sfx bus ─┬──────────────────────┐
                                                     sfx bus ─► air send (0.16) ─► HP 220 Hz ─► convolver ─┤
UI voice (ui/hover/error/craft) ─────────────────────────────────────────────► ui bus ─────────────────┤
raft-ocean worklet (or node fallback) ─► fade-in to 0.7 ─► ambience bus ─► duck ─────────────────────┴► mix ─► lowpass 9 kHz ─► master (volume × 0.8) ─► limiter (-6 dB, 12:1) ─► out
```

**Ambience worklet (`raft-ocean`, stereo, k-rate params `swell wind speed creak gain`).** A dominant swell oscillator (period 8–12 s, shorter when `speed` rises) plus a 0.157 Hz partner gives the height `h`.
- Bed: brown noise per channel (decorrelated L/R, measured correlation 0.04–0.15), one-pole low-pass at 160–420 Hz that opens and gets louder with `h`.
- Wash: pink noise into a TPT state-variable band-pass that sweeps 450–1950 Hz. A 0.45 s attack and 1.2 s release fire on every crest, with random strength and pan.
- Slaps: 1–4 short band-passed bursts at 260–620 Hz in each trough, like water lapping the logs.
- Wind: two band-passes (L/R offset ×1.13) at 260–1260 Hz. Q and level follow a smoothed random gust walk, and a faint high-Q whistle comes in on strong gusts.
- Creaks: on the steepest part of each swell, with probability `creak × (0.55 + 0.45 swell)` and force `0.5–1 × (0.7 + 0.3 swell)`, a stick-slip impulse train (25–70 Hz, rising ×1.5–2.6 then falling, ±25 % jitter) excites three wood resonators (290/640/1210 Hz, Q 9–12, weights 0.8/0.85/0.55, so the two upper modes that clear the bed carry the creak). Each creak is randomly panned, and the pool holds 3. The engine's `creak(force)` posts one on demand (wave hit, someone landing on the deck). Earlier versions scaled both chance and force by swell, so creaks vanished under the bed below swell ≈ 0.7.
- DC blockers on both outputs. No allocation in `process()`, and filter coefficients are retuned once per 128-frame block.

**One-shots** are recipes of a few oscillators, noise-buffer sources, biquads and gains, each with an exponential envelope that ends in a linear ramp to 0. That end ramp is why every case decays to −∞ dB at its tail with no truncation clicks. The building blocks are:
- `knock`: resonant noise tick plus a falling sine body.
- `modes`: decaying sine partials. The hammer uses 165/395/720/1130 Hz plus a 3.3 kHz head ping and a 2 kHz contact crack.
- `bubble`: a Minnaert-style sine that rises as it decays. It is used for splash, catch, swim and bite.
- `gullSeries`: one oscillator per gull voice for the whole call series (calls never overlap, so about 14 nodes however many calls). The source is a PeriodicWave with a weak fundamental and strong 2nd–4th harmonics (nasal), f0 780–980 Hz. It feeds two band-pass formants (1.7 kHz Q 3, 3.1 kHz Q 4) that follow 40 % of the pitch movement. Pitch wobble comes from brown noise low-passed at 18 Hz (irregular, a few % of f0), not a periodic FM sine, which was what made the old gull read as a toy whistle. A breath layer of band-passed noise rides the same envelope at −21 dB. Each call is a pitch contour: `kyow` (up-glide ×1.12–1.25 over 14–24 % of the call, then a long fall to ×0.62–0.75), `ha` (short, nearly flat) or `mew` (slow fall). Patterns are random per voice: a long call (one kyow plus 3–6 falling, fading `ha`s with irregular gaps and the odd hesitation, 45 %), one or two `mew`s (30 %), or two to three clipped `kek`s (25 %).
- `catch`: the shloop and drips, then root and fifth plucks and an octave chime (with a faint 4× shimmer) ringing out over about 0.6 s, so the reward has a resolved, rising shape and is the loudest one-shot.
- The ratchet is a band-limited square wave → high-pass 2.5 kHz → band-pass 3.3 kHz. Each edge is a click, so the rate is the reel speed.

**Spatial.** `play(ev, s, {x,y,z})` inserts a PannerNode (`equalpower` by default, `hrtf:true` opt-in; inverse distance; `refDistance` 2 m, gull 10 m, creak 3 m).
- **Crossfeed (cheap head shadow).** Equal-power panning puts a 90° source entirely in one ear. All panners feed one shared crossfeed (10 nodes per engine, not per voice) that gives each ear a copy of the other ear delayed 0.3 ms, low-passed at 1.1 kHz, at −8 dB. Measured on `hammer-left` (6 m, 90°): the right channel goes from silent (−∞) to −26.6 dBFS against −16.8 on the left, about 10 dB down and dull, which is how a head shadows sound. Centred sources gain about 1.5 dB in the lows, so the crossfeed output is trimmed to 0.85.
- **Air absorption.** Spatial voices more than 4 m away get one low-pass at `max(2 kHz, 16 kHz / (1 + d/10))`: about 10 kHz at 6 m and 4 kHz at 30 m. This is exaggerated on purpose so that distant gulls sit back in the mix (`gull-far` momentary loudness −31.3 → −42.2).
- **Open-air early reflections.** At sea there are no walls, so there is no room reverb, only reflections from the deck (3–5 ms), the water surface (9–12 ms) and barrels, mast and sail (17–40 ms), plus a short, dark diffuse tail (−60 dB at 0.3 s). The engine builds this 0.32 s stereo IR (different L/R tap times and noise) once and runs it in one ConvolverNode, fed from the sfx bus through a 0.16 send and a 220 Hz high-pass so the lows stay dry. UI and ambience stay dry. `reverb:false` removes it. It adds 100–300 ms to the −60 dB decay of short one-shots (hammer 180 → 300 ms) and makes mono one-shots slightly stereo (L/R correlation 1.0 → 0.85–0.93).

`setListener()` is called once per frame from the camera. (Offline renders pass `seed` so the ambience cases are reproducible.) Ambient gulls are scheduled by the engine itself every 9–30 s at 14–40 m, with an audio-clock timer: a silent ConstantSourceNode whose `ended` event arms the next one. No `setTimeout` is involved, so gulls pause with the context.

**Mixer and ducking.** The buses are `ambience`, `sfx` and `ui` (`setBus(name, v)`). The ambience fades in to `AMB_LEVEL` 0.7 rather than 1, so `setBus('ambience', 1)` remains the user's full setting. Big events duck the ambience bus by `DUCK[ev] × strength` (catch 0.4, splash 0.35, hammer/build 0.25, craft 0.2, jump 0.15) with a 20 ms attack, 0.2 s hold and about 0.75 s recovery. The measured dip on a catch with the sfx bus muted (case `duck-only`) is −37.4 → −40.3 → −36.4 dB RMS.

**Budget guards.** At most 24 voices (`play()` returns false beyond that), a per-event minimum gap of 25–300 ms, and the reel is one persistent voice. Each voice's nodes are disconnected on its last source's `ended`. `destroy()` frees everything this instance made but never closes the context.

## Numbers

All numbers are from headless Chromium on a shared CI box. **Timings are relative**: they swing 2–5× between runs depending on load from the other agents, so the bench uses interleaved repeats and reports min and median.

**CPU (offline render, ms per second of audio; real time is 1000).** These are from `shoot.py --bench`, 7 interleaved runs, two sessions each. The "before" columns are the engine without crossfeed, air send and gull rework:

| case | before min | after min | after median | what |
|---|---|---|---|---|
| ambience-calm (worklet) | 22–25 | 25–28 | 50–74 | full ocean, about 3 % of one core |
| ambience-fallback (node graph) | 25–45 | 32–34 | 65–75 | same job with native nodes |
| ambience-rough (worklet, all layers maxed, creaks) | 24–25 | 26–33 | 60–90 | |
| stress-24 (worklet + 24 spatial voices at once) | 48 | 60–63 | 97–98 | worst case, about 6–10 % of one core |
| hammer one-shot | 8–10 | 18–23 | 22–27 | |
| splash one-shot | 9–11 | 18–19 | 28–113 | |

The convolver and crossfeed cost a fixed ~10 ms per audio second, about 1 % of a core, whether or not anything is playing. On the worst case they add ~25 %. `reverb:false` removes the convolver part.

**Main-thread JS cost of `play()`** (scheduling only, median and p95 over 60 calls) is 0.1–0.5 ms median for every event, and p95 is up to ~4 ms when the box is busy. That is 3–25 Web Audio nodes per voice: hover 3, ui/jump/reel tick 6, hammer 14, gull 14 (was 19–25 before the single-oscillator rewrite), splash 19, catch 25. Spatial voices add a panner and, beyond 4 m, one low-pass. The shared graph is 22 nodes (9 buses, 10 crossfeed, 3 air send).

**Levels at volume 1** (worst case). There is no clipping in any case, the maximum peak over all 34 cases is −3.4 dBFS (the mix case, where the limiter acts), and every |DC| is below 7e-4. `loud` is the momentary loudness that `render-lab.js` now computes: K-weighted (BS.1770), max over 400 ms windows, LUFS-like. It tracks perceived level much better than peak. Gull numbers vary per render because the call pattern is random.

| case | peak dBFS | loud before → after | −60 dB decay ms |
|---|---|---|---|
| catch | −5.3 | −19.1 → **−16.0** (loudest one-shot) | 890 |
| splash-big (player) / splash (hook) | −6.1 / −9.8 | −19.3 → −18.6 / −26.9 → −25.3 | 610 / 490 |
| gull at 10 m (ref distance) | −12.7 | −18.3 → −21 (−21 to −28 depending on pattern) | 1370 |
| creak one-shot | −13.6 | −24.8 → −22.2 | 820 |
| reel (2 s loop) | −10.2 | −24.6 → −24.4 | 1840 |
| hammer / build / craft | −7.0 / −11.3 / −13.0 | −25.5 / −26 / −26 → −25.5 / −25.7 / −25.9 | 300 / 380 / 710 |
| jump / repair / pickup / collect / return | −10 to −15 | −26 to −30 (unchanged) | 290–680 |
| throw (full / soft) | −14.6 / −21.1 | −30 / −36.9 → −29.5 / −35 | 670 / 550 |
| swim / bite | −18.8 / −14.5 | −33.8 / −33.3 → −32.6 / −32.5 | 500 / 340 |
| error (UI) | −20.2 | −30.1 → **−35.1** | 340 |
| ui / hover | −24.7 / −34.5 | −44.6 / −53.8 (unchanged) | 110 / 100 |
| ambience calm / mid / rough | −19.6 / −16.6 / −8.5 | −26.6 / −23.7 / −17.5 → **−29.7 / −26.8 / −20.4** | continuous |
| gull ~30 m / hammer at 6 m, 90° left | −29.2 / −16.8 (R −26.6, was −∞) | −31.3 → −42.2 / −38.1 → −38.7 | |
| mix (ambience + hook loop + hammer) | −3.4 | −18.9 → −17.1 | |

Order of loudness now: catch, big splash, close gull and creak, then the reel and the building sounds, then pickups and throws, and the UI at the bottom (error −35, click −45, hover −54). The ambience sits 4–5 dB under the hammer in a calm sea. Before, the calm sea measured −26.6 against the hammer's −25.5, so a hammer barely rose out of the bed, and a close gull outshouted a catch.

**Creak audibility** (case `creak-calm`: swell 0.3, random creaks off, one `creak(0.6)` at 5 s, RMS in the 500–1500 Hz band): the bed alone measures −51.2 dB and the creak window −38.1 dB, so the creak stands **13.1 dB** above the bed in its band. Before, the same forced creak measured 7.8 dB above the bed, and random creaks in a calm sea were also rarer (×0.55 vs ×0.35 chance at swell 0) and weaker (force scaled by swell).

**What the shots show** (I read the PNGs of every changed sound):
- `hammer`: a broadband crack, then the 165 Hz body ringing out in about 180 ms, plus the thin 3.3 kHz ping, now with a faint dark tail from the air send.
- `hammer-left`: both channels present; the right is quieter and has no top end.
- `catch`: a rising noise sweep, droplet chirps, two triangle plucks (a fifth apart), then the octave chime holding at about 1.3 kHz until about 1 s.
- `gull`, `gull-left`, `gull-far`: a long `kyow` (rise, then a long fall) followed by shorter, lower, fading calls at uneven spacing. Energy sits in two formant regions around 1.5–2 kHz and 3 kHz with a weak fundamental. The far gull is a thin, dull call with its harmonics above ~5 kHz gone.
- `creak-calm`: a clear 0.75 s creak block at 5 s with resonant lines at about 640 Hz and 1.2 kHz over a calm bed that is otherwise empty above 500 Hz.
- `reel`: evenly spaced ratchet clicks, faster after 0.8 s, centred near 3 kHz over line hiss.
- `ambience-*`: a broadband bed with a visible wash on each crest.
- `mix-ducking`: every event is distinct over the bed, and the catch chime is the brightest line in the picture.

## Decision

Adopt `sandbox/audio/audio.js` plus `audio-worklet.js` as `dist/audio.js` plus `dist/audio-worklet.js`, and wire `game.js` to it (`docs/tech/audio-ADOPT.md`; `sandbox/audio/adopt.py --check` proves it boots in the real game). The API is a strict superset of the current `dist/audio.js`. The extra events, positions, sea state, reel loop, buses and listener are all optional.

## Known weaknesses

- **Insecure origins lose the worklet.** AudioWorklet needs a secure context. Playing over `http://<LAN-IP>` (not localhost) falls back to the node-graph ambience. That fallback is fine but static: there are no crest-synced washes or creaks, and the swell is a fixed LFO. `creak()` then plays the node-graph creak one-shot instead. Electron/localhost/https are unaffected.
- **Not listened to by a human.** Everything here was judged from spectrograms, envelopes and K-weighted loudness in a headless box with no sound card. The gull is now built like a real call (nasal harmonics, formants, irregular contour and spacing), but whether it passes as a gull and not a squeaky toy still needs an ear, and so does the level of the air send (0.16).
- **Spatial is still basic.** The crossfeed removes the one-ear effect, but equal-power panning cannot tell front from back or up from down, and there is no occlusion or Doppler. `hrtf:true` adds those cues at several times the per-voice cost. Air absorption is set once when the voice starts: a sound does not change as the listener moves while it plays, which is fine for one-shots under 2 s.
- **The air send is always on.** It costs a fixed ~10 ms per audio second (about 1 % of a core) even when nothing plays, and it is the same for every place on the raft. Pass `reverb:false` on weak devices.
- **Creak loudness relative to rough seas.** Creaks now stand well clear of a calm bed. In rough weather the wash and wind still cover them for much of the time, which is realistic.
- **Timing noise.** The CPU numbers come from a contended shared box with SwiftShader. Treat them as ratios (worklet ≈ node fallback or better; full stress ≈ 2–3× calm ambience), not absolutes. No real-device audio-thread profiling was done. Mobile low-end devices could glitch at 24 voices plus HRTF.
- **The ambient gull scheduler needs a running realtime context.** It is disabled offline and pauses while the tab is suspended, which is intended.
- **Context autoplay policy.** Nothing plays until the first pointerdown or keydown, and `wakeAudio` in the adoption hooks both. A guest that only uses the gamepad would stay silent. There is no gamepad input today.
- **No music bus or per-category settings UI.** `setBus()` exists, but the settings dialog only has master volume.
