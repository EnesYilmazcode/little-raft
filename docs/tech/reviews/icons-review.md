# Review: icons (fleet-tech/icons @ 2e18e3f)

Judge run on 2026-11-21. Box: 4 cores, load average ~35 (other fleet agents), SwiftShader, so all ms are
relative only.

## Scores

| | score |
|---|---|
| LOOKS | 7 |
| COST | 7 |
| ADOPT-CORRECTNESS | 6 |
| **OVERALL** | **6** |

## What I ran

- `python sandbox/icons/shoot.py` (9.5 min wall). Read sheet-2x-compare, sheet-2x-native, sheet-2x-chip18,
  ui-inventory-1x, ui-inventory-2x-panel and ui-hotbar-2x-bar.
- `adopt_patch.py --check` prints ok. I applied `--apply` to a scratch copy of dist/ and diffed it against
  the ADOPT doc. All 8 survival-ui edits and both game.js edits match the doc, and the symbols they use
  (`INST_KEY`, `esc`, `dragging`, `isOpen`, `later`, `mat`, `disposed`, `ITEM_INFO`) all exist in scope.
- `node --test` on the unpatched and patched dist. `survival.test.mjs` passes 22/22 on both.
  `legacy_hook.mjs` fails 2/4 on both (tests 1 and 3, a known failure). Neither suite touches survival-ui,
  so the tests do not exercise the patch.
- Real game on the patched copy, headless with `executable_path`: a fresh load, a reload, a `setItem` that
  throws QuotaExceeded, and a hot-swap to a second build id done the way live.js does it (capture,
  dispose, then mount(transfer) from a module with a different `?build=`), both mid-bake and after the bake.
  The unpatched baseline ran under the same harness.

## Measured (real game, patched copy)

| | value |
|---|---|
| bake wall time from mount (fresh LS) | 25.0 / 27.6 / 29.7 s (3 runs) |
| game frames during bake, worst / avg | 3.35 s / 1.58 s; 2.83 s / 1.71 s |
| unpatched baseline, same window, worst / avg | 3.05 s / 1.63 s |
| renderer.info programs / textures / geometries, before -> after bake | 9/7/262 -> 9/7/262 (no leak) |
| transient during bake (mid-bake sample) | programs 11, textures 9, back to 9/7 after |
| localStorage | one key `littleRaft.icons.ia4.<build>`, 250,960 chars |
| cache hit (`bakeItemIcons` with a warm LS) | 63 ms in game under load (docs claim 5.5 to 8.3 ms) |
| quota throws | icons still bake and apply, no errors, nothing cached (so every load rebakes) |
| hot-swap mid-bake | the old engine's bake keeps running after `dispose()`. Two bakes run on the shared renderer, 30 blob URLs are created and none are revoked |
| hot-swap after bake | a full rebake for the new build (expected), and the 15 old blob URLs are never revoked |

Sandbox shoot.py: 4.7 s total at DPR 1 and 6.6 s at DPR 2. The bake compiles 4 programs and renderer.info
is unchanged before and after, which matches the docs. In the real game the bake takes about 15 game frames
because it yields one rAF per tile, so its wall time is 15 times the frame time. The bake's frame hitch
cannot be told apart from baseline on this box. The docs' "worst 1 s" figure comes from the light sandbox
scene and not from the game.

## Looks

The baked icons are clearly better than the SVGs. All 15 kinds are distinct, where the SVGs reuse sprites
for 6 kinds (plastic and scrap, rod and hook, rope and net). Lighting direction, the navy outline and the
shadow are consistent across the set, and placeables (bench, crate, palm, lantern) read at once.

Problems:
- **The hook icon does not match the held tool.** In game, slot 1 at spawn holds a large curved scrap hook
  on a rope-wrapped handle. The icon is a thin J fish hook, which reads as fishing gear next to the fishing
  rod. It is the first icon every player sees.
- Hammer, rod and hook are thin dark diagonals. On the dark brown slot at 1x (recipe list, 34 px) the
  hammer is nearly invisible, because a navy outline on dark brown adds no contrast.
- At 18 px, scrap is a grey smear and net is a dark square. The plastic jug is low contrast and white on
  white.
- Expanding baked icons by -5 px puts the stack count on top of the art (wood "20", plastic "7"). It stays
  readable thanks to the text shadow, but it looks crowded.

## ADOPT correctness issues

1. No try/finally in the bake loop (`sandbox/icons/icon-atlas.js` lines 230-246 and 258-281). If a render,
   `make()` or the readback throws after `save()`, `renderer.autoClear` stays `false` and the render target
   stays set, which corrupts every later game frame. The targets, quad and unified materials also leak.
2. A bake is not cancelled on dispose or hot-swap (adopt_patch.py game patch; `bakeItemIcons` in
   item-models.js line 16). The orphan keeps rendering on the transferred renderer and creates blob URLs.
   It also calls `writeIconCache`, which deletes every `littleRaft.icons.*` key, so an old-build bake that
   finishes after the new one wipes the new build's cache (`icon-atlas.js` lines 160-166).
3. Blob URLs are never revoked: `setItemIcons` in the survival-ui patch and `item-models.js` line 25.
4. The cache does not check its contents: `readIconCache` (`icon-atlas.js` line 153) accepts any `urls`
   object. It does not check that every requested kind is present or that the values are data URLs.
5. Stale or wrong documentation:
   - `icons.md` cites the scratch `variants.py`, which is not in the repo, for its headline table.
   - Comments in `item-models.js` contradict the code: line 2 says "Twelve use the existing dist builders"
     where icons.md says 8, and line 14 says it returns dataURL where it returns blob URLs.
   - The cache-hit figure differs across docs: ADOPT says 5.5 ms, icons.md says 8.3 and 7.5 ms, and the
     real game measured 63 ms.
   - The first-pass section of icons.md gives "100 to 150 KB", where the measured size is 250 KB.
6. On a hot-swap during play, each new build triggers a full bake in the middle of gameplay. This
   contradicts the note in icons.md: "never in the middle of gameplay".

The cache-key and version logic is otherwise sound. The key is per build plus `ia4`, `dev` never caches,
and a throwing or full localStorage is handled.
