# Review: procedural-models (judge)

Branch reviewed: `fleet-tech/procedural-models` @ a0cf7dc. `dist/` on the branch is identical to `origin/main`.

## Scores

| | score |
|---|---|
| LOOKS | 6 |
| COST | 9 |
| ADOPT-CORRECTNESS | 8 |
| OVERALL | 7 |

## What I ran

- `python sandbox/procedural-models/shoot.py`: all 9 views rendered. The only error was a 404 (favicon). I read every PNG.
- `stats.json` matches the doc tables exactly: scene 271 → 50 calls (main + shadow), 251,208 → 50,218 tris,
  137 → 26 meshes, 78 → 4 materials (3 shared `lp-*` + the water). Per-model rows match too.
- I applied ADOPT literally to a scratch copy of `dist/` with an asserting script. Lines 8/9/11/16 matched
  byte for byte, and the `disposeGeometry` old string matched once on line 255. `node --check` passed.
- Node contract check of the new against the old builders (4 floor indices, 4 debris types × 2 seeds, plastic, 6 crafts,
  unknown types). I checked userData keys, child names (`debris-<type>-model`, `barrel-tilt`), bounds, determinism,
  NaNs and normals.
- Headless game probe (brief launch line, GL calls instrumented) on the old and new dist. Seeded save: 3×3 raft
  and all decor in the bag. Steps: spawn, hook throw, place all 6 decor, hammer-build a tile, 3 more throws, walk,
  and a `raftLive.check()` hot swap.

## Findings

Game probe (new / old): 0 page errors on both. All 6 decor placed and the floor build went 9 → 10 tiles on both,
with identical placement candidate counts (so footprints and `BLOCK_RADIUS` are unchanged). The hot swap reported `updated`
and decor/tiles survived. Real GL draw calls per frame were **187 vs 547** at spawn and **134 vs 476** after decor + build.
GL programs stayed **flat at 12** while items churned (old: 19, with 6 deletes from rebuild material disposal).
The frame average under load ~50 was 1.2 s vs 3.5 s (relative only).

Contracts: all usages in `game.js` are satisfied. That covers the recursive raycast on `itemsGroup` with `userData.token`
walk-up, `userData.sx/sz` written on the item root, `disposeGeometry`, `disposeScene`, decor at y=.22, and
`createCraft` returning null for unknown types. hands/hammer/fishing-tool do not use these builders.

Inaccuracies (none of them break anything):
- The floor is not in [-1,1] × [0, ~0.21]. Measured x is ±1.014 and top y is 0.223–0.226, because the rope lashings overhang
  the tile edge and sit 2.5 cm above `FLOOR_TOP`. Lashings of neighbouring tiles overlap by about 28 mm. I saw no visible
  z-fighting in the screenshots.
- ADOPT says "3 materials" and the research doc says "share 4 materials". It is 3 (the 4th in the scene count is water).
- ADOPT step 4 says nothing imports the old modules. `sandbox/icons/main.js` imports `dist/plastic.js` and
  `dist/crafts.js`, so deleting them breaks the icons sandbox. Also, HUD icons rendered from the old models will no
  longer match the new props.
- About 3–7% of triangles per mesh are zero-area with zero normals (cone/lathe caps). They are invisible but wasted.

Looks:
- Better: barrel, jug, crate (as an object), bench, the lantern post, the scrap rust, and floating debris readability.
  The set is clearly more cohesive.
- Worse or regressed:
  - **Deck** (the most-seen surface). Up close in first person it is flatter and more orange/plastic than the textured
    current planks (`02-spawn`, `fp.png`).
  - **Sail canvas.** It is a 7×8 flat-shaded sheet with per-facet tint, so in first person it reads as mottled grey
    triangles (`fp.png`, in-game swap shot).
  - **Crate on deck.** It uses the same woodLight/woodMid as the deck, so it loses figure/ground contrast (`fp.png` bottom).
  - **Palm pot.** The cream band makes it read greyish rather than terracotta.
  - **Net.** The thin frame is less substantial than the current log frame.
- No broken normals, flicker or z-fighting were visible.

## Nice-to-haves (OVERALL ≥ 7)

1. `sandbox/procedural-models/lowpoly-props.js:738-741`: smooth-shade the sail cloth or drop `tint`/facet variation on
   it (or raise the sheet resolution a little). Faceted canvas is the most visible artifact in first person.
2. `lowpoly-props.js:504-545` (`createFloor`): add a little more per-plank value variation / a 2-strip top so the deck is
   not one flat orange at eye level. Consider desaturating `woodLight`/`woodMid` (line 19) slightly.
3. `lowpoly-props.js:550-583` (`craftCrate`): use darker/greyer slats (woodDark/drift) so the crate separates from the deck.
4. `lowpoly-props.js:668-670`: drop or darken the cream band on the palm pot.
5. `docs/tech/procedural-models-ADOPT.md` contract table: fix the floor bounds (x ±1.014, y up to 0.226). Step 4: mention
   `sandbox/icons/main.js` and the icons topic. Make the material count consistent (3).
6. Kit: skip zero-area cap triangles in `lathe`/`cone` builds.
