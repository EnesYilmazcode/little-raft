# Audio review (harsh judge, round 2)

Reviewed `origin/fleet-tech/audio` at ca507ce. Everything below was re-measured by me: `shoot.py` (36 cases), `adopt.py --check`, my own 5-swap and sound-off hot-update test in the real game (`dist/live.js` polling a patched temp copy of `dist/`, my own audio-thread recorder worklet, a FinalizationRegistry over every AudioNode, forced GC through CDP), a cost bench on fresh contexts with two module copies, a failed-mount simulation, and numpy spectra of the WAVs. Scripts: `scratchpad/judge-audio2/{swaps.py,swaps2.py,cost2.py,failmount.py}`.

## Scores

| axis | round 1 | round 2 |
|---|---|---|
| LOOKS (sound quality, as evidenced) | 7 | 8 |
| COST | 6 | 8 |
| ADOPT-CORRECTNESS | 5 | 7 |
| OVERALL (at most lowest + 2) | 5 | **7** |

## Round 1 in short

OVERALL was 5. Five fixes were required:
1. A hot update cut the ocean to digital silence for about 2 s, with a click.
2. A catch at the hook's distance was quieter than a pickup.
3. `resume()` regenerated 11 s of noise on the main thread during every hot mount (median 33 ms).
4. Gull `play()` had a p95 of 13 ms.
5. `adopt.py --check` checked neither `?build=` nor a hot swap.

## Required fixes: all five verified

1. **Hot-update hole: fixed.** The new engine takes over the playing ocean node through `globalThis[Symbol.for('little-raft.audio.shared')]` (`audio.js:66-69`, `214-233`), and `destroy()` fades the master over 80 ms before freeing (`audio.js:873-911`).
   - `adopt.py --check`: `ok: true` with all 10 checks true. Dip 3.3 dB, against 1.8 dB on the same metric before the swap. Minimum −42.9 dB, no empty input blocks, 1 context, 1 worklet node, and the single module URL carries `?build=`.
   - My 5 consecutive live.js swaps: the worst 100 ms window was 1.0–6.7 dB under the median of the 2 s before (for example −39.1 → −44.5 and −41.5 → −48.2). It never went near silence. Every swap kept 1 context, `running`, 1 worklet node and 1 module load.
   - At 20 ms resolution, the biggest sample steps around each dispose were ocean content inside 100 ms clusters at normal level, comparable to the pre-swap maximum (0.013–0.029). There was no step at the dispose instant, so no click.
2. **Catch at distance: fixed.** `REF_DISTANCE` gives catch 14 m and splash/bite 8 m (`audio.js:52`). `catch-16m` measures −23.6 LUFS momentary, louder than the hammer (−25.1). `splash-16m` measures −35.8. Spectrograms:
   - `catch-16m` keeps the full shape: noise sweep, drips, root and fifth plucks, octave chime ringing to about 0.9 s. It is darker above 3 kHz, and R > L as panned.
   - `splash-16m` is a short dull burst plus two bubble chirps at about 1–2 kHz.
   - Both start and end on exact 0.
3. **resume() hitch: fixed for the hot path.** Measured over 12 fresh contexts:
   - Second engine on the same context, from a *new module copy*: median 4.1 ms, p90 12 ms.
   - First engine on a context: median 12.9 ms, p90 116 ms (box noise).
   - `stats()` after the takeover shows `worklet: true`, so the Symbol cache really works across module copies. The first-gesture cost is documented.
4. **Gull cost: fixed.** `shoot.py` gives gull median 0.4 ms, p95 0.9 ms. My realtime bench gives median 0.6 ms, p90 3.2 ms; its single 147 ms max matches the catch's 281 ms max, which is box contention. `audio.md` is corrected.
5. **adopt.py coverage: fixed.** It asserts `worklet_url_has_build` and runs a real republish, then waits for live.js's own poll instead of racing it. It checks one context, no second ocean node, no un-stamped module, and the level across the swap.

The round-1 nice-to-haves are also done:
- **Rough-sea mid gap.** 100 Hz bands of `ambience-rough` from 300 to 1300 Hz now span 45.0–48.9 dB. The spectrogram is one body from the lows to about 2 kHz.
- **Doc errata.** Both are fixed: the call-site count is now 7, and the gull-far note says the 8–10 kHz harmonics are faint, not gone.
- **Suspend at volume 0.** On an idle page the context suspends 206–288 ms after `setVolume(0)` and resumes in a median of 44 ms. In the game under SwiftShader load the DOM timer took about 4.7 s, but the master fades out in about 30 ms, so it is audibly instant either way.

## Regression hunt

- **Memory across swaps: clean.** After forced GC, live AudioNodes stay at 25 after every one of 5 swaps (24 before the first). The heap grows 3.3 MB per swap, but the un-adopted `dist/` grows the same (11.7 → 15.1 → 18.4 → 21.8 → 25.1 MB). That growth comes from the game and live.js, not from audio.
- **Sound off, then hot update, then sound on: works.**
  1. With sound off, the context is suspended.
  2. The new mount does not resume, and the old `destroy()` frees at once and kills the ocean.
  3. Turning sound on builds a fresh ocean node with no module load (worklet nodes 1 → 2, modules still 1) and fades it in over 2.5 s. The level is back to about −39 dB.
- **Toggling off and back on inside the 200 ms idle window** leaves the context `running`, with the ocean at −44 dB.
- **ADOPT line references.** All 19 line numbers (17 … 1183) and every old string match `dist/game.js` (1208 lines) exactly. `adopt.py` refuses cleanly when they don't.
- **New defect: a failed hot update silences the ocean until the next good update or a reload.**
  - During a hot update, the new build's `mount()` in `game.js` calls `sfx.resume()`, which takes the ocean over, before anything else in `mount()` can throw. `game.js:1195` then calls `dispose()` → `sfx.destroy()`, and the new engine's `stopAmbience()` kills the ocean it now owns (`audio.js:308-316`). live.js keeps the old engine, but its `amb.handedOff` is `true`, and `startAmbience()` returns early because `amb` is set (`audio.js:215`).
  - Measured (`failmount.py`): the old engine went from −40.6 dB to −120 dB. It stayed at −120 after `e1.resume()`. `e1.stats()` still reports `worklet: true`.
  - Round 1 did not have this failure mode, and live.js has an explicit "Update paused, still playing this version" path for exactly this case.
- **Cross-version contract on a global.** The handed-over `amb` object (`kind`, `node`, `fade`, `params`, `nodes`, `sources`) and the shared buffers are now an ABI between builds. A later build that changes that shape will receive the old one. This is acceptable, but it is undocumented in the code beyond the comment. A version field on the shared record would let a future build refuse a foreign shape and start fresh.
- Note for integration, not scored: `origin/main` has since merged a different game. Its `dist/game.js` has 1780 lines and its own `createOceanAudio` wiring. This ADOPT targets the fleet snapshot and does not apply to main. `adopt.py` refuses there ("anchor matched 0 times"), which is the right failure.

## Nice-to-haves (OVERALL ≥ 7)

1. **Hand the ocean back on a failed mount.** Record the previous owner when taking over. In `destroy()`, if the previous owner is not destroyed, reconnect `fade` to its `ambBus` and clear its `handedOff` flag. Alternatively, let `startAmbience()` restart when `amb.handedOff && graph.sh.ocean?.dead`. Add a failed-mount case to `adopt.py --check`: inject a throw after `sfx.resume()` and assert the level holds.
2. Put a `v:` version on the shared record and the `ocean` handle, and refuse a mismatched shape.
3. Seed the one-shot randomness in render cases (`gull` is a different pattern each run: −20 LUFS and 530 ms this run, against 1370 ms in the doc table), so case numbers are reproducible.
4. The first-gesture noise build (about 9–13 ms, with spikes) could move into the worklet or an idle callback.
