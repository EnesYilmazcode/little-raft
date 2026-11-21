# Foliage review (harsh judge)

Branch reviewed: `fleet-tech/foliage` at `4f2117c`. I ran everything myself and did not rely on the authors' numbers.

## Scores

| axis | score |
| --- | --- |
| LOOKS | 8 |
| COST | 8 |
| ADOPT-CORRECTNESS | 7 |
| OVERALL | 7 |

## What I ran

1. `python sandbox/foliage/shoot.py --quick`: 0 page errors. The one 404 is the sandbox favicon. I looked at all 8 PNGs.
2. I followed `foliage-ADOPT.md` literally on two scratch copies of `dist/`: the required edits, and the required
   edits plus the optional background islands. Every search string occurs exactly once, and every line number
   is current (11, 182, 290, 355, 825, 255, 1164, 300). `node --check` passes on both.
3. I booted both copies headless (Chromium 1243, SwiftShader). For inspection only, I exposed `renderer`, `scene`,
   `rebuildRaft` and `world` on `window.__probe` in the scratch copies. A palm decor was pre-seeded through the
   `little-raft-v1` save. Then I clicked Solo, rebuilt the raft 20 times, removed the palm, put it back, and did two
   live hot swaps through `dist/live.js` by bumping `version.json`. I ran the same sequence on unpatched `dist/`
   as a baseline.
4. `node --test tests/survival.test.mjs tests/legacy_hook.mjs` gives 24 pass and 2 fail on unpatched `dist/`, on the
   patched copy, and on the patched copy with the optional edit. The 2 failures are in `legacy_hook.mjs`, already
   fail without the patch, and are not caused by foliage.

## LOOKS (8)

- The island palms are charming and fit the game's art style. The fronds are crisp folded-leaflet geometry with a
  gradient from base to tip, and the golden dry fronds add variety. The trunk is smooth and ringed. The canopy
  seen from below has no black undersides, and the two-sided normal fix works. I saw no z-fighting.
- The beach view is lush. The grass, broadleaf and bushes read well at eye height. The bushes are faceted green
  lumps, a little "blobby" but consistent with the game's low-poly style.
- Wind: sandbox motion is 27.8% changed pixels in the craft palm region against a 0.17% baseline, and 10.2%
  against 1.5% in the island region. In game, `uTime` advances and the uniforms are bound to the raft palm.
- Downsides:
  - Bushes fade out at 34 to 46 m and grass at 17 to 27 m. From about 46 m, which is well inside the 125 m fog
    range, the island interior is a bald flat green disc under the palms (`lod-lod58.png`).
  - The dither crossfade speckles visibly in the zoomed `lod49` shot.
  - The raft craft palm keeps its stacked-block trunk next to the smooth island palms, so the two read as
    different art.

## COST (8)

- These numbers match the doc exactly: raft view 48 calls, 87.7k triangles, 17 programs; beach view 1.10
  foliage fragments per pixel with depth complexity 3.3; the LOD band costs +2 calls per island, only while
  the camera is 44 to 54 m away.
- Each island adds about 11 to 13 InstancedMeshes, and again as many in the shadow pass when it is inside the
  ±25 m shadow frustum. The cost scales linearly and gently. Whole kinds are hidden per island past their fade
  distance.
- In game, placing the first palm adds exactly 5 programs (3 `physical foliageT` and 2 `depth foliageTD`), as
  documented. A second palm adds 0.
- Cache keys are correct: the shader ID, the defines and `customProgramCacheKey` keep foliage programs apart from
  every other game material. The `onBeforeCompile` uniforms are set per material, so shared programs are safe.
- Depth twins run the same BODY without the colour pass, with the same uniform objects and the same `uEye` fade.
  Their sway is consistent with the visible mesh.
- The optional background-island palms bring the 12 islands from 8 meshes each down to 1. They also make the palms
  visible: the old cone palm sits mostly inside the 3.4 m hill sphere.

## ADOPT-CORRECTNESS (7)

- The patched game boots with 0 page errors and 0 console errors, and `running` is true. The craft palm gets its 5
  depth twins.
- 20 calls to `rebuildRaft()` leak nothing: programs stay at 17 and geometries are stable. Removing the palm drops
  programs back to 12, the unpatched baseline, so edit (e) works for `disposeGeometry`.
- **Hot-swap leak.** `disposeScene()` (dist/game.js line 1157) collects only `o.material`. Edit (e) adds
  `foliage?.dispose()`, but `F.dispose()` does not own the craft-palm depth twins. Each live swap therefore leaks 5
  `MeshDepthMaterial`s and keeps their programs referenced. Measured: the `depth foliageTD` usedTimes went
  4 → 4 → 8 and 1 → 1 → 2, and programs went to 18 after a swap, against 11 on unpatched `dist/`.
  - Because the cache key carries no version, a later build that changes `BODY` would also keep reusing the stale
    leaked depth program, so shadows would stop matching until the page reloads.
- `F.dispose()` is documented as disposing "every material that F created", but the depth twins made by
  `instanced()` and `swayCraftPalm()` are never added to `owned`.
- In the verify section (`foliage-ADOPT.md` line 145), the claim that "the raft palm renders with the smooth ringed
  trunk" is false. The craft palm keeps the crafts.js block trunk, as the authors' own weaknesses list says.
- The hover and placement preview (`ghost`) is a plain box with `MeshBasicMaterial`, so the patch does not touch it.
  Every craft creates its own materials, so `swayCraftPalm` cannot affect shared materials or `materialCache`.

## Fixes (OVERALL is 7, so these are nice-to-haves; the first one should be done when adopting)

1. Add a step to `foliage-ADOPT.md`: in `disposeScene()` (dist/game.js line 1157), also collect
   `o.customDepthMaterial`, for example
   `if (o.customDepthMaterial) mats.add(o.customDepthMaterial);`.
   Another option: track depth twins in `owned` inside `depth()` (`sandbox/foliage/foliage.js` lines 172 to 186),
   so that `F.dispose()` really disposes everything.
2. Add a version tag to the program cache keys (`foliage.js` lines 164 to 165 and 183), for example `'foliage1'`,
   bumped whenever `BODY` changes. This keeps live hot swaps from reusing stale programs.
3. Fix the false "smooth ringed trunk" claim (`foliage-ADOPT.md` line 145).
4. Push the bush fade out to about 60 to 75 m (`foliage.js` line 120, `fade: [34, 46]`). Bushes are only 355
   triangles each, and this keeps islands from looking bald at mid range. Or keep a cheap far-bush LOD.
5. Port the smooth ringed trunk to the crafts.js palm, so the raft palm matches the island palms.
