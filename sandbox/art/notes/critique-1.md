# Critique round 1 (harsh art critic), scores /10 for Raft-like, bright, warm, clean
- planks 6: hard 4-board repeat, the grey board stripe is identical on every face (h<0.16), nails in stamped pairs (lu .27/.73, 5 px after every joint), near-black comic GAP outline. Fix: jitter nail nu/dvp per board, GAP ~#5A4228, grey chance ~0.08 or P=5.
- plank 7 (deck): grain contrast (lines*0.17) disappears beyond 3 m; the fixed knot (0.58, 0.62) with repeat [1,3] gives 3 identical knots per board. Fix: grain ~0.25 (+40%), 0-1 hashed knots per tile or no fixed knot.
- bark 4: reads as flagstone/cobble, round plates with thick black outlines. Fix: elongate (KY 1.6->~4, PY 8->4), thinner fissures (cw .07+.13 -> .03+.06), crack darkening .95->.7, more dry ridge weight.
- plastic 5: frosted ice/crackle glass, uniform P=4 voronoi web of even white lines, noisy normal (10 x 1.3), alpha .76. Fix: P=4 crease whitening weight 1->.4, fold fbm .5->.8, alpha .85+ (lead sets normalScale .8).
- leaf 6: metronome chevrons (L=6, same K), yellow tips plus dark slits make striped olive columns at the tile edge. Fix: vary K per leaflet by lid, tip .35+.5lid -> .15+.35lid, slits transparent not dark-tinted.
- rope 4: vertical corduroy (A=27, B=1 ~2 deg), no twist on cube/plank. Fix: visible 30-40 deg lay (e.g. A~9, B=3), wider strand profile, grooves .85->.7 darkness. Must also still look right on the deck lashing torus (u along rope, preset repeat [1,3]); retune the preset repeat if needed and tell the lead.
- scrap 5: clown camo, saturated blue/red paint blobs, orange decal rust, binary roughness blotches. Fix: paint threshold .635->.67, BLUE toward #5F7F95, soften rust edge smooth(.565,.595)->(.53,.62), more halo.
- sand 8: 6 ripples per tile at 3x3 make a grid. Fix: RIP 6->5, warp 1.6w->2.2w.
- rock 6: paving not boulder: equal P=4 cells, moss in cracks like grout, weak facet tilt. Fix: moss only on top (drop crack*mossN), tilt .7->1.2, mix in P=3 cells, narrower cracks.
- foam 5: swiss-cheese bubbles, one big blob per tile (repeats at 2x2). Fix: coverage P 4->6, smaller r (.3+.32 -> .2+.2), fewer popped holes in body.
- cloth 6: patch and seam repeat every .5 m (polka-dot patches). Fix: keep seam, drop the patch or make it rare via hashed flag.
Scene: islands mapped to leaf (fixed: foliage preset leaf x [10,5]); tint gain wrecks dark presets (lead fixing); per-instance repetition (lead adding per-material uv phase); two cloud styles (lead); plastic/foam unused in game.
