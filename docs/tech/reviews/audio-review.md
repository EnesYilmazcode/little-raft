# Audio review (harsh judge, round 3: retarget to main)

Reviewed `origin/retarget/audio` at 0a1b5e4 against the current `origin/main` `dist/` (144c94a, build `v3-survival-ae77fa84ac2b`, `dist/game.js` 1780 lines, `dist/audio.js` 550 lines). I trusted nothing from the authors and re-measured all of it myself. The box was heavily loaded the whole time (load average 22–43 on 4 cores), so every timing is relative only.

What I ran:
- `adopt.py --check`, twice;
- `shoot.py` (55 cases) into my own directory, then read the spectrograms;
- an export-surface diff of both modules in node, and a grep of every `dist/` caller;
- my own in-game hot-swap test, patched and unpatched: 1 failed swap then 4 good ones driven by `live.js`'s poll, with a FinalizationRegistry over every AudioNode, forced GC through CDP, and the limiter's connect targets logged;
- an in-game level comparison, main engine against the new engine;
- `node --test tests/*.test.mjs`, patched and unpatched.

My scripts are in the session scratchpad under `judge-audio3/` (`surface.mjs`, `swaps.py`, `levels.py`).

## Scores

| axis | round 1 | round 2 | round 3 (retarget) |
|---|---|---|---|
| LOOKS (sound quality, as evidenced) | 7 | 8 | 8 |
| COST | 6 | 8 | 8 |
| ADOPT-CORRECTNESS | 5 | 7 | 8 |
| OVERALL (at most lowest + 2) | 5 | 7 | **8** |

## History in short

- **Round 1: OVERALL 5.** A hot update cut the ocean to silence for about 2 s. A catch at the hook's distance was quieter than a pickup. There was a 33 ms `resume()` hitch, a gull p95 of 13 ms, and `adopt.py` checked neither `?build=` nor a swap. All five were fixed.
- **Round 2: OVERALL 7.** New defect: a failed hot update silenced the ocean until reload. ADOPT targeted the fleet snapshot and did not apply to main. Nice-to-haves: hand the ocean back, add a version field, seed the renders.

Round 3 retargets the engine onto main's `dist/audio.js` API and fixes all of the round-2 items.

## Verified

**Strict superset of `dist/audio.js`** (both modules imported in node):
- The exports are a superset: `SHARED_VERSION` is added.
- `EVENTS[0..19]` are identical and in the same order. 15 more follow, including `sizzle stoke clank ingot sail anchor dive surface`.
- `ALIASES` and `BUSES` are deep-equal.
- The instance has every member of main's (`context music resume setVolume setBus getBus setMusic play tick destroy`), plus 6 extras.
- These behave the same as main's: `setBus` clamping (2 → 1, −1 → 0, unknown name → `null`), `getBus` defaults (master 0.5, music 0.7, unknown → `null`), `play` returning `false` without a context, `tick` returning `undefined`, `setMusic`/`music`, and `resume()` returning `Promise<false>` without a constructor.

**Callers.** I grepped all of `dist/*.js`. Only `game.js` touches the engine: lines 3, 258–261, 551, 750, 772, 919, 931, 969, 991, 1059–1062, 1184, 1196–1198, 1222, 1343–1345, 1618, 1690, 1725 and 1752. The only `e.sound` string anywhere is `'repair'`. Every call is covered by the identical signatures.

**Main bug: real, and fixed.**
- Static check: `let diving` is at `game.js:320`. On a hot mount, `sfx.resume()` at 261 runs `buildGraph()` synchronously, so `output()` hits the TDZ. Main's `audio.js:87` swallows the error and connects the limiter to `ctx.destination` for good.
- Measured, unpatched: after the good swaps the limiter's connect targets are `['dest','dest','dest']`, so the limiter never reaches diving's low-pass again.
- Measured, patched: every engine ends on `BiquadFilterNode:20000` (diving's filter), and `stats().routed` is true after each of 5 swaps.

**adopt.py --check.**
- **Run 1 failed on 1 of 18 checks.** `worklet_built` was false because the ocean was not up yet 5 s after the gesture (load average 43). The rest passed: the failed mount dipped 5.1 dB with a minimum of −43.8 dB, and the good swap dipped 4.0 dB with a minimum of −45.2 dB.
- **Run 2 passed all 18.** The failed mount dipped 2.2 dB (minimum −42.6), and the good swap dipped 7.2 dB (minimum −43.0, control 1.7).
- So the engine is fine and the boot check is timing-fragile.

**My own swap test (patched).**
- 1 failed swap, then 4 good ones.
- `live.js` kept the old build on the injected error.
- Throughout: 1 engine context, 1 worklet node, 1 module load, and every context `running`.
- The ocean median stayed −36 to −38 dB, and the 3 s minimum after each step was −40.8 to −43.7 dB. The only stretch under −60 dB is the first 2 s fade-in at boot.
- Live AudioNodes after forced GC were 26, 47, 29, 49, 31, 32. The two high readings are one-shot voices still in flight. Unpatched stayed at 27. There is no leak I can attribute to the engine.
- Heap grows about 17 MB per swap in both patched and unpatched, so that growth is the game's.

**ADOPT step 3 anchors.**
- All 4 old strings match `dist/game.js` exactly once (279, 1222, 1225, 754), and so do the 5 required anchors.
- What the edits rely on is in scope:
  - `world.sailing` has `raised`, `anchored` and `windStr`.
  - Station keys are `x,z` (`progression-hooks.js:25`).
  - `COOKERS` are only `grill` and `smelter`.
  - Tiles are 2 m.
  - The camera is a direct child of the scene (`game.js:377`).
  - `fc:cook` goes through `game.js` `action()`.

**Tests.**
- Unpatched: 532 of 533 pass.
- Patched (`RAFT_DIST`): 532 of 533 pass.
- The failure is the same in both: the atlas build-time assertion, caused by load. Both audio API tests in `survival.test.mjs` pass on the new engine.

**shoot.py.**
- 55 cases, no errors and no clipping. Max peak −2.8 dBFS. Every |DC| < 8e-4. The only warning is the `music` bed, which keeps playing.
- The loudness numbers match the doc table exactly, because the renders are now seeded.
- `play()` median is 0.1–1.6 ms. The worst p95 is anchor at 12.8 ms with 56 nodes.
- `tick()` costs 10–15 µs per frame, against 1.8 µs for main's engine. Both are negligible.

**Spectrograms read.**
- `sizzle`: a contact burst, then a 2–10 kHz hiss fading by about 1.5 s. The crackle ticks are sparse and faint.
- `stoke`: a knock, then a low whumpf with a body to about 0.4 s and four late crackles.
- `clank`: a broadband knock with 110 Hz and 600 Hz rings and gravel ticks.
- `ingot`: two clinks with clean inharmonic lines at about 1.7, 4 and 9 kHz. The first rings to about 0.6 s.
- `sail`: a low flap thud, then canvas noise at 0.2–0.4 s.
- `anchor`: six accelerating chain clicks with 2.4 kHz pings, a broadband splash at 0.45 s, then bubbles.
- `dive`: a dark plunge whose top closes from about 3 kHz, then rising bubble chirps at 300–900 Hz.
- `surface`: a bright shed, then drips and a breath.
- `underwater`: the top end goes dark from 3 to 6.5 s, and the dive and surface cues sit on the edges. Hammer transients still show faint lines up to 10 kHz, which is documented. In the game, diving's 600 Hz filter covers them.
- `sail-luff`: two flaps with a flutter loop between them, low in level. The loop's spectrum is broader than the doc's "400–900 Hz band": a Q 0.8 band-pass on pink noise shows energy up to 10 kHz.
- `catch`, `hammer` and `mix-ducking` are unchanged from round 2 and still read well. The catch chime is the brightest line in the mix.

## Findings (none blocking)

1. **The ADOPT claims "drop-in" but does not disclose an audible mix change.** In the game, at the same settings and with the same recorder, main's engine gives a bed median of **−61.3 dB**, and the new engine gives **−43.1 dB** (+18 dB). One-shot 100 ms peaks:

   | event | main engine (dB) | new engine (dB) | change |
   |---|---|---|---|
   | catch | −28.2 | −22.2 | +6 |
   | splash | −30.6 | −23.8 | +7 |
   | ui | −47.3 | −36.8 | +10.5 |
   | deny | −44.0 | −37.0 | +7 |
   | collect | −36.9 | −36.7 | 0 |

   The sea goes from barely audible to clearly present, which is arguably better. But it changes what main's players hear on update day, and the ADOPT should say so.
2. **`adopt.py` boot check is flaky.** It reads `stats().worklet` after a fixed 5 s. Under load the worklet module load takes longer, and run 1 failed on that alone.
3. **The one-time transition from main's engine is undocumented.** On the first live update after adoption, main's `destroy()` (`dist/audio.js:521`) hard-stops its ocean with no fade. The new engine finds no shared ocean and has to `addModule` the worklet first. Open tabs get one click and a short hole, once.
4. **`tick()` re-targets the luff on every frame.** While the sail is up, `setLuff` makes 3 `setTargetAtTime` calls every frame (`audio.js:1117-1119`), even when the wind has not changed. `applyOcean` gates on a change of more than 0.02; the luff should too.
5. `stats().nodes` is a cumulative creation counter (566 after all voices ended in the realtime smoke test), not a count of live nodes. Rename it or decrement it in `finishVoice`.
6. `actionSound` plays before the action is validated. A guest who is not yet connected, or a rejected insert, still gets `sizzle`/`clank`.
7. On a good swap, the old `diving.dispose()` disconnects its low-pass in the same task. One-shot tails still on the old engine are cut without the 80 ms fade. This is minor, since the ocean has already moved.
8. Edge case in `game.js`, not the engine: if `mount()` throws before its `try` (`game.js:1741`), `dispose()` never runs. The new engine then keeps the ocean on a master the live build's volume slider does not control.

## Nice-to-haves (OVERALL ≥ 7)

1. Add an "In-game levels vs current main" table to `audio-ADOPT.md` (finding 1). Also say how to match main if wanted, for example `setBus('ambience', ~0.1)`.
2. `adopt.py`: replace the fixed 5 s wait with `wait_for_function('raftDebug.audio.stats().worklet', timeout=30000)`.
3. Document the one-time main → new transition (finding 3). Or have the new engine fade in over `AMB_FADE_IN` when it finds no shared record (the old engine is main's).
4. Gate the `setLuff` re-targets on a wind change, as `applyOcean` does. Rename `stats().nodes` to `nodesCreated`.
5. Sound: denser, louder crackle in `sizzle` (it reads as a steady hiss). A steeper or second band-pass on the luff loop to match the doc. A longer chain run on `anchor`, whose six clicks take 0.4 s.
6. Play the station sounds from the host's `applyAction` result, or after `action()` returns true.
