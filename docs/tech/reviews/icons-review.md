# Review: icons, round 3 (retarget/icons @ 9073000)

Judge run on 2026-11-21. Box: 4 cores, load average 28 to 43 (other fleet agents), SwiftShader, so ms are
relative only. The target is current origin/main dist (build `v3-survival-ae77fa84ac2b`, game.js 1780 lines),
which ships its own `dist/item-icons.js`. dist/ is identical between the branch and origin/main. Everything
was checked on scratch copies. My probes and logs are in `scratchpad/judge-icons3/` (not committed).

## Scores

| | round 1 | round 2 | round 3 (retarget) |
|---|---|---|---|
| LOOKS | 7 | 8 | 8 |
| COST | 7 | 7 | 6 |
| ADOPT-CORRECTNESS | 6 | 7 | 8 |
| **OVERALL** | **6** | **7** | **7** |

OVERALL is capped at lowest + 2 = 8. I give 7 because the cost claim in the docs does not reproduce.

## History (short)

- **Round 1 (OVERALL 6):** 8 required fixes: bake try/finally, cancel on dispose and hot swap, blob revoke,
  cache validation, stale docs, honest mid-play rebake, hook to match the held tool, readable thin tools at 18 px.
- **Round 2 (OVERALL 7):** all 8 were done. The nice-to-haves were the `userData.shared` disposal for
  procedural-models, an import-existence check in `--check`, and a content-hash cache key.
- **Round 3 (this one):** main shipped its own lazy `item-icons.js`, which made the round-2 atlas baker a
  competing pipeline. The authors retargeted the work as a merge. The result is a drop-in `item-icons.js`
  with the same exports, plus a new `item-icon-models.js`, and no caller changes. Round 2's
  `userData.shared` and import-check nice-to-haves are now in, and the localStorage cache was dropped on
  purpose. That is the right call given the shared ~5 MB origin quota with the save.

## What I ran

- **`adopt_patch.py --check`**, 4 m 05 s:
  - all 14 anchors matched exactly once, the 7 API names are preserved and the imports are present;
  - the real game booted through index.html / live.js with no page or console errors;
  - 8/8 hotbar slots showed 3D icons 74.5 s after Solo, and the bag had 31 3D and 19 SVG icons;
  - the patched test run gave 533 tests, 532 passing.
- **Unpatched `node --test tests/*.test.mjs`:** 533 tests, 532 passing. The single failure is the same on
  both sides: `art.test.mjs` "atlas ... build stays fast", a texgen timing assert under load that has
  nothing to do with icons. Both item-icons tests in `survival.test.mjs` pass on the merged module (that
  file honours `RAFT_DIST`, so the patched run really exercises the merged file).
- **`robust.py`:** 12/12 cases pass with no page errors. After context loss, 2 contexts have been created
  in total. The old copy stops in 11 ms (the docs say "within 5 ms", which is within noise). Live contexts
  after release: 0.
- **My own real live.js hot-swap probe** (`scratchpad/judge-icons3/hotswap_probe*.py`). The authors deleted
  their round-2 `hotswap.py`, and `robust.py` only imports two module copies, so I wrote this. It boots a
  seeded game, waits for 8 hotbar 3D icons, rewrites every `?build=` in the served copy to a new id, bumps
  version.json and calls `raftLive.check()`. It counts 128x128 WebGL contexts through a `getContext` hook:

  | | main | merged (run 1 / run 2) |
  |---|---|---|
  | swap status | updated | updated / updated |
  | peak live icon contexts during the swap | **2** (old copy keeps rendering) | **1** / **1** |
  | icon GL program links, both copies in total | 10 | 8 / 8 |
  | hotbar back to 8 3D icons after `check()` | 44 s | 66 s / 44 s |
  | live icon contexts once settled | 0 (195 s) | 0 (309 s) / 0 (303 s) |
  | bag after the swap (3D / SVG) | 31 / 19 | 31 / 19 / 31 / 19 |
  | console errors and item-icon warnings | none | none |

  The second merged run also logged a timeline: cached icons went 5 → 10 → 11 → 16 over about 190 s, and
  the context was released at about 300 s once the 18 no-model kinds had drained. That is slow
  idle-time draining behind a running game, **not a leak**. Main has the same queue shape. The bag
  screenshot after the swap (`hotswap-merged-bag.png`) is correct.
- **`shoot.py main merged`, then `shoot.py merged main`** (2 runs per variant, in alternating order):

  | | main cold | merged cold | main warm | merged warm |
  |---|---|---|---|---|
  | all 34 queued → last ready | 4.95 / 3.67 s | 6.64 / 6.95 s | 5.65 / 5.90 s | 4.72 / 8.17 s |
  | worst game frame | 550 / 267 ms | 933 / 1233 ms | 1217 / 717 ms | 267 / 1967 ms |
  | frames > 100 ms | 6 / 9 | 12 / 14 | 10 / 8 | 8 / 13 |
  | GL links, contexts | 4, 1 | 4, 1 | 4, 1 | 4, 1 |
  | data URL bytes | 160,556 | 318,836 | | |
  | game renderer.info after (programs / geometries / textures) | 1 / 13 / 0 | 1 / 13 / 0 | | |

- **Screenshots read:** `shots/compare-sheet.png`, `main-hotbar.png` vs `adopt-hotbar.png`, `adopt-bag.png`,
  my own regenerated adopt shots (identical content) and my post-swap bag shot.

## API and caller audit

Diff of `sandbox/icons/item-icons.js` against `dist/item-icons.js`:
- The exports are unchanged: `iconURL`, `getItemIcon` (same function object, asserted by the test),
  `loadItemIcon`, `warmIcons`, `onIconReady` (it still returns the unsubscribe function) and
  `setModelProvider`. `buildFallbackModel` is kept but has no dist user.
- The dist users are `survival-ui.js:6/95/376/695/1043` and `game.js:51/1760`. All of them use only the sync
  null-while-rendering contract and `(kind, url)` listeners, and those semantics are unchanged. Listeners
  still fire only for real URLs.
- There are four deliberate behaviour changes, and each is benign for these callers:
  1. **A blank render now yields `null`.** Main cached an invisible PNG, for example after a lost context.
  2. **`setModelProvider` no longer re-renders `ICON_MODELS` kinds.** They do not depend on the provider.
  3. **`loadItemIcon` resolves `null` straight away when the kind was not queued.** This only happens when
     the copy is superseded.
  4. **After a hot swap the old copy returns `null` for uncached kinds and stops its queue.**
- **The merge fixes one real main bug.** On main, `freeModel` disposed geometry and materials flagged
  `userData.shared`, so the plastic.js fallback would dispose the game's shared jug geometry and material.
  The merge skips them, and `unify` never adds a color attribute to shared geometry. Provider models
  (`models.js getModel` clones sharing cached geometry and materials) are never disposed or mutated. Their
  materials are swapped only for the duration of the synchronous render and then restored.

## Looks: 8

The merged column is the best of the three on every rendered kind. The real hotbar goes from a pale forked
stick, two hairlines, a single plank and grey scratches (main) to a thick scrap hook, a rod with a reel and
bobber, a hammer, a log pile, a rusty corrugated sheet, a rope coil and three nails. All of them read at
40 px, and the cream rim makes the dark tools pop on the navy slots. The bag and the recipe rows look the
same.

Weak spots:
- The navy outline is nearly invisible on the dark slots. It only shows on the light strip, so on slots it
  does little.
- Bench and sail come from models.js and are still thin slivers at chip size.
- 18 of 34 kinds are still SVG, the same as main. The hotbar and bag mix painted 3D with flat outlined
  sprites (sand, ingot, bolt, glass, cooked fish, anchor). This is the biggest remaining visual
  inconsistency, but it is inherited from main and is not a regression.

## Cost: 6

The good part is real:
- 4 links, the same as main;
- 1 private context;
- no game `renderer.info` change;
- nothing persisted;
- on a hot swap, one live icon context at a time instead of main's two, and fewer total links.

**The headline claim does not reproduce.** The docs say merged and main cost the same, citing medians of
4 interleaved runs. In my 4 interleaved cold runs, merged was slower every time: total 6.6 to 6.9 s
against 3.7 to 5.0 s, and the worst frame 0.93 to 1.23 s against 0.27 to 0.55 s, with about twice the
frames over 100 ms. Warm runs were mixed. The likely causes are cheap per kind but real:
- the 2D outline pass does `drawImage` from the WebGL canvas, `getImageData`, 32 to 64 more `drawImage`
  calls and a second `toDataURL`, which is an extra readback and sync for each kind;
- `createHammer` with the icon wrapper and the heavier stand-in meshes (hammer `readyAt` jumps about 900 ms).

In the real game the time to 8 hotbar icons was the same: 72.7 s on main and 72.0 / 53.5 / 74.5 s merged.
So in practice this is probably a small extra idle-time cost, not a gameplay problem. But the table in
icons.md should say "cold ~1.3 to 1.9x main in the sandbox, equal in game", not "same". Data URL memory
doubles to 319 KB, and it stays resident in the module copy of every hot-swapped build, since modules are
never unloaded. Main has the same pattern at half the size.

## Adopt-correctness: 8

- No caller changes.
- Anchors and the API are asserted.
- Imports are checked.
- The build id is rewritten.
- The real game boots.
- Test parity holds (532/533 on both sides, with the same unrelated failure).
- Robustness cases pass.
- A real live.js swap leaves no leaked contexts and has a lower context peak than main.

Rollback is two files.

Deductions:
1. **The supersede latch is permanent, so a failed hot swap leaves the old engine stuck on SVG.**
   `claim()` runs in the new copy as soon as its `createSurvivalUI` calls `setModelProvider`, and that
   happens inside `mount()` (game.js:1747). If `mount()` then throws later, live.js resumes the old engine,
   but the old copy is superseded for good. Its uncached kinds return `null` forever and it never queues
   again. Only kinds still uncached at swap time are affected (`warmIcons` queues every `ITEM_INFO` kind
   at startup), and it needs a failed swap, so the impact is low. A fix: release ownership when the new
   copy's UI is destroyed or after its queue drains, or let a superseded copy render when the owner's
   queue is empty.
2. **The real live.js hot-swap probe was deleted.** The claim "B renders, and no live contexts remain"
   rests on `robust.py`, which imports two module copies by query string and never goes through live.js.
   My probe confirms the claim, but the branch no longer carries the evidence.
3. **Context-loss retry never sets `failed`.** A machine whose contexts are lost every time creates up to 3
   contexts per kind (one at a time, each released) before it gives up on that kind. This is bounded and
   harmless, but noisy.

## Nice-to-haves (OVERALL >= 7, none required)

1. **Fix the cost claim in `icons.md` and the table in `icons-ADOPT.md`.** State that merged cold is slower
   than main in the sandbox (my runs show 1.3 to 1.9x the total and 2 to 4x the worst frame) and equal in
   game. The current "On this box merged and main cost the same" is not what I measured. This is the top
   item.
2. **Make the supersede latch reversible** (deduction 1), and add a robust.js case: B claims and is never
   used, then A must still render.
3. **Bring back a real live.js hot-swap probe in the branch.** Mine is a ready template.
4. **Make the outline do something on dark slots.** Use a lighter rim for all icons, or a slightly lighter
   outline, or drop the dark ring there to save the 2D pass.
5. **Look at the outline pass cost.** For example, take `getImageData` alpha from the GL `readPixels` you
   already pay for, or reuse a single draw. The aim is that merged really does match main cold.
6. **Fill the 18 SVG-only kinds** (`ICON_MODELS` or models.js), and thicken bench and sail for chips.
