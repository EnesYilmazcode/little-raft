# Review: icons, round 2 (fleet-tech/icons @ bf13795)

Judge run on 2026-11-21. Box: 4 cores, load average 17 to 27 (other fleet agents), SwiftShader, so all ms
are relative only. dist/ itself is unchanged on the branch; everything was checked on a scratch copy built
with `adopt_patch.py`.

## Scores

| | round 1 | round 2 |
|---|---|---|
| LOOKS | 7 | 8 |
| COST | 7 | 7 |
| ADOPT-CORRECTNESS | 6 | 7 |
| **OVERALL** | **6** | **7** |

## Round 1 summary

Round 1 scored OVERALL 6. The 8 required fixes were:
1. a try/finally around the bake;
2. cancelling the bake on dispose and hot swap, and stopping an orphan bake from wiping the new build's cache;
3. revoking blob URLs;
4. validating the cache contents;
5. fixing stale docs (the missing variants.py, wrong comments, conflicting cache-hit figures, the 100 to 150 KB size claim);
6. being honest about mid-gameplay rebakes on hot swap;
7. making the hook icon match the held scrap hook;
8. making thin tools, and scrap and net at 18 px, readable (plus stack counts sitting on the art).

## What I ran (round 2)

- `adopt_patch.py --check` prints ok (build `v3-survival-ae77fa84ac2b`).
- `robust.py`: `allPass: true`. The 6 cases are a throw in make(), a throw in a render, cancel after 2
  tiles, an orphan write, stale-key cleanup and corrupt entries (a missing kind, a non-PNG value, an array,
  truncated JSON). After each throw and after the cancel, the renderer comes back with autoClear true, a
  null render target, the shadow map on and autoReset on.
- `hotswap.py midswap`: the old engine drew 6 tiles, was disposed, and drew 0 old tiles after that.
  15 blobs were created, all of them for the new build. localStorage ends with only
  `ia4.v3-test-hotswap`. After the swap the renderer has autoClear true and programs/textures 9/7. No
  errors. `pass: true`.
- `hotswap.py postswap`: 30 blobs created, 15 revoked, 15 live. The old key is replaced by the new one.
  Programs/textures/geometries are 9/7/248 before and 9/7/248 after. `pass: true`.
- `shoot.py` took 4 m 37 s:

  | | bake total | worst frame during bake | cache hit |
  |---|---|---|---|
  | DPR 1 | 4.9 s | 0.95 s | 6.3 ms |
  | DPR 2 | 5.0 s | 1.15 s | 6.4 ms |

  4 programs are compiled. renderer.info is the same before and after, 25 calls / 41,734 triangles /
  25 geometries / 2 textures / 6 programs. The data URLs total 259,814 chars. In `lateSwap`, 47 SVG
  icons go to 0 and 47 baked icons appear while the bag stays open. The only page errors are SwiftShader
  ReadPixels stall notices and one 404, which is the sandbox page's missing favicon.
- `game_probe.py` on my own patched copy. A fresh bake shows baked hotbar icons 34.9 s after Solo. There
  are no page or console errors and one `ia4` key of 260,016 chars. The in-game cache hit took 19.7,
  9.5, 4.3, 4.8 and 5.3 ms. After a reload the hotbar is baked 3.1 s after Solo.
- `RAFT_DIST=<patched> node --test tests/survival.test.mjs` passes 22/22.
- I read sheet-2x-compare, sheet-2x-chip18, ui-inventory-1x and ui-hotbar-2x-bar, plus my own in-game
  hotbar and bag screenshots.

## The 8 round-1 fixes

| # | fix | status | evidence |
|---|---|---|---|
| 1 | try/finally around the bake | done | A per-tile `try/finally` restores RT, clear, shadow, autoClear and autoReset. The outer `finally` disposes the targets, the quad, the unified materials and any prebuilt models. robust.py makeThrows and renderThrows pass and leave the renderer clean. |
| 2 | cancel and orphan handling | done | `isCancelled` is checked before the bake, before each tile, after the readback and before the cache write. game.js passes `() => disposed`. The orphan rule ("a key appeared during my bake, so write nothing and delete nothing") holds in robust.py and in the midswap run, where 0 old tiles were drawn after dispose. |
| 3 | revoke blob URLs | done | `setItemIcons` revokes the URLs it replaces and `destroy()` revokes the rest. postswap ends with 30 created, 15 revoked, 15 live. midswap makes no blobs for the cancelled build. |
| 4 | validate cache contents | done | `readIconCache(key, kinds)` requires every kind to be a `data:image/png;base64,` string. Corrupt entries are misses and get rebaked. |
| 5 | stale docs | done | `variants.py` is committed. The item-models.js header now matches (5 unchanged, 2 rescaled, 2 procedural, 6 icon-only) and says it returns blob URLs. The cache-hit numbers are reconciled: about 6.8 ms in the sandbox, 10 to 200 ms in game under load. I measured 4 to 20 ms in game, so the claim holds. The 100 to 150 KB figure is now labelled as a first-pass estimate next to the measured 254 KB. |
| 6 | mid-gameplay rebake on hot swap | done as documentation | A hot swap to a new build still rebakes in the middle of play. This is now stated plainly in icons.md and ADOPT ("Hot swaps"). The orphan is cancelled, and ADOPT suggests a content-hash key as the next step. Acceptable. |
| 7 | hook icon matches the held tool | done | In the real game the slot 1 icon is the same grey curved scrap hook on a rope-wrapped handle that the right hand holds. |
| 8 | thin tools, 18 px, stack counts | done | Hammer, hook and rod have a cream rim and read on the dark 34 px recipe rows. At 18 px, scrap is a rust-red corrugated sheet and net is a tan grid with orange floats. Stack counts ("14", "20", "7") sit in the corner, clear of the art. |

## Regressions introduced by the fixes

None found in the icons code itself. Specifically:
- Removing the -5 px slot expansion did not shrink the icons badly. They still fill the slots.
- `pointer-events:none` on the baked img leaves drag on the button. The bag drag hint and slot layout
  are unchanged in the shots.
- The `ICON_REV` repaint path did not cause per-frame innerHTML churn. The slot signature changes only
  when the revision bumps.
- renderer.info has no leak in the sandbox or after the hot swaps.

## Cross-topic: procedural-models (`origin/fleet-tech/procedural-models`)

`docs/tech/icons-ADOPT.md` does not mention procedural-models at all. The coordination note lives only in
`procedural-models-ADOPT.md` step 4, which says to point `item-icons.js` at `./lowpoly-props.js` and bump
`ICON_ATLAS_VERSION`. Following that note exposes two problems on the icons side:

1. **The bake disposes the game's shared low-poly materials.** `disposeTree` in `item-models.js` disposes
   every material except those from `getMaterial`. lowpoly-props materials are module-shared and flagged
   `userData.shared = true`. I baked the real `item-models.js` with its plastic, crafts and debris imports
   pointed at `lowpoly-props.js` from the procedural-models branch. The bake fired **8 `dispose` events on
   `lp-solid` / `lp-cloth`** (sail, palm, bench, crate, plastic, leaf). In game those are the materials of
   every raft prop, so the bake forces their programs to be re-acquired. This is exactly the hitch that
   procedural-models step 3 exists to prevent. The fix is one line: also skip `m.userData?.shared` in
   `disposeTree`, and ideally in `defaultDispose` in icon-atlas.js too.
2. **A static import makes boot depend on the old files.** The game.js patch imports `item-icons.js`
   statically, and that file imports `./plastic.js`, `./crafts.js` and `./debris.js`. If procedural-models
   lands first and someone deletes those files, the game fails to boot. Procedural step 4 warns against
   this, but `adopt_patch.py --check` does not verify that the modules `item-icons.js` imports exist in
   dist/.

Neither problem breaks the game when the topics are adopted in either order with the old files kept. It
is still a gap. It does not block OVERALL 7, but it is the first nice-to-have.

## Looks

The 15 kinds are distinct and consistent: same light, navy outline and soft shadow. The hook now matches
the viewmodel, which matters because it is the first icon the player sees. The rod reads with its reel
and bobber, the log pile has ringed ends and the net has floats. Remaining weak spots:
- the white jug is low-contrast on the light strip;
- the cream rim on three tools gives them a slightly sticker-like edge that the other 12 do not have;
- the sail is taller than wide;
- with no env, metal comes out a little flat and dark.

## Cost

Nothing changed here since round 1, and the numbers are honest. A first bake costs:
- 4 small programs;
- about 15 game frames, one tile per frame (35 s from Solo under SwiftShader load, a few ms per tile on a
  real GPU);
- 2 MB of transient VRAM, freed afterwards;
- 255 KB of localStorage per build.

A warm load costs 4 to 20 ms in game. Each hot swap to a new build still pays a full bake during play.

## Nice-to-haves (OVERALL >= 7, none required)

1. Add a "procedural-models" section to icons-ADOPT:
   - skip `userData.shared` materials in `disposeTree` and `defaultDispose`;
   - give the import swap to `./lowpoly-props.js` together with the `ICON_ATLAS_VERSION` bump;
   - have `adopt_patch.py --check` assert that every module `item-icons.js` imports exists in dist/.
2. Key the cache on a content hash of `item-icons.js` and `icon-atlas.js` (plus the builder files)
   instead of the build id, so a hot swap that does not touch the models does not rebake mid-play.
3. Darken or tint the plastic jug a little, or give it the rim, so it reads on light strips.
4. Consider a softer rim colour, or a thinner rim (1.2 px), so the three tools match the rest of the set.
