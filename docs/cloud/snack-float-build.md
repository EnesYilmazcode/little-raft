# Snack Float build notes

Spec: docs/specs/snack-float.md. Research: docs/features/shark-bait-research.md.

## What was built
- **dist/shark.js** (pure half): `BAIT` constants, `'snack'` appended to `SHARK_STATES`, `baitSpot`, `setBait`, `clearBait`, `baitActive`,
  state fields `bx, bz, bt, bitten`, the snack entry check (after the dead block, before the prey check), `case 'snack'` (steer to 1.2 m off the
  float, nibble every 2 s, drain only while within 3 m, then `endAttack` -> timer 300 and `circle`), `hooks.nibble` / `hooks.ate`.
  `cleanShark` keeps a sane `bait` only (key absent otherwise); `saveShark` writes `bait` only while `bt > 0`. Still `v: 1`.
- **dist/shark.js** (view): snacking maps to code `approach` (swimming over) or `bite` (nibbling), depth -0.32 while nibbling; never a new code.
  Pose grows to 10 numbers (`[7..9] = bx, bz, bt`, zeros without a float). `applyNet` sets `hostBait` from the length and clamps the bait;
  `clearNet` resets it. Getters `bait` / `hostBait`, `toss`, debug `setBait` / `clearBait`, `fx('snack')`. The float model is built once, raft-relative
  (stays beside the raft while sailing), bobs / rolls / yaws, shrinks with `bt`, dips and splashes on each nibble and splashes once when eaten
  (`host.onNibble`, `host.onAte` local view events).
- **dist/snack-float-model.js** (new): cork bobber + teal band + stick (small red tip added so it reads from the deck), squashed seaweed parcel with
  crossed twine, silver fish tail. One merged vertex-coloured mesh, 366 tris, ~0.38 m wide, no shadows. `disposeSnackFloat`.
- **items / craft-book / item-svg / held-items / live.js**: catalogue entry (`refined`, stack 10, fish 2 + seaweed 1 + rope 1, unlock fish + seaweed),
  Survival tab, desc/use text, original 48x48 icon, held model (SIZE 0.16), PRELOAD entry.
- **dist/game.js**: `useSelected` branch before `content.use`, `tossSnack` local checks (old host, no shark, diving, deck, reach, busy), `shark:bait` host
  action (400 ms rate limit, reach + guest slack, scratch bag committed only on `'ok'`), `sharkEffect` snack splash, prompt row, `onNibble` / `onAte`,
  `raftDebug.shark.bait / setBait / clearBait`.
- **Tests**: 12 new cases in tests/shark.test.mjs (spec cases 1-12), tests/snack-float.test.mjs (cases 13-16).
  tests/survival.test.mjs: `usedIn('fish')` now expects `['Snack Float']` (first recipe that takes raw fish; the old assertion pinned "no recipe uses fish").

## Verification
- `npm test`: 1414 / 1414 pass (base 1398 + 16 new).
- `python3 shoot.py dist <scratch>`: `errors: []` (python playwright installed into a scratch venv, not the repo).
- Playwright pass (solo): give 3, select, aim at the water, click -> "The shark swam off for a snack", count 3 -> 2; second click -> "The shark is
  still snacking", count stays 2; shark reaches the float and nibbles, `tileHp` stays empty. Screenshot: docs/cloud/shots/snack-float/nibble.png
  (float bobbing just off the raft edge with the shark nose-up on it, the held float in hand, the icon in the hotbar).

## Deviations
- Model has a small red stick tip (not in the spec part list) for readability; width 0.38 m (spec says ~0.3, test band 0.2-0.4).
- Icon: drawn as specified; the fish tail pokes out of the parcel's left side.
- `raftDebug.shark.clearBait()` returns `true` on host/solo, `false` on a guest.
- Host `net()` fills 7-9 from the shown bait (host = sim), same values the spec asks for.

## Known limits
- `node tests/coop-e2e.mjs` could not be run to completion here: the harness times out clicking `#welcomeCrew` (not visible on the current title
  screen) before any shark code runs, i.e. the harness is stale against the base UI, independent of this change. Guest behaviour is covered by the
  unit cases (old host 7 numbers -> refuse, 10 numbers -> float shown, junk clamped, clearNet).
- Headless swiftshader runs at ~5 fps, so the sim (dt clamped per frame) drains far slower than wall time in browser runs; the 120 s / 300 s timings
  are verified in the pure tests.
- As spec'd: an old build loading a new save drops the float; a bag holding `snackfloat` on an old build resets (same trade-off as every new kind).
