# Research notes (art lane). Hex values are estimates, not measured.
## Raft look (direction)
- Calm, sunny, saturated (+10-20% over realistic), soft contrast. Standard PBR, not cel shading. Stylized via chunky bevels, clean readable textures, painted highlights, no grime overload.
- Signature: honey-tan plank square on saturated blue-teal sea. Crumpled white-blue plastic, green palm fronds, brown planks and barrels bobbing in the water. Foam and soft fog dissolve the horizon.
- Planks: #B8925E-#D2AE7A, each plank ±8% value with a slight hue shift, sometimes a greyer weathered plank #9C8A70. Long low-contrast grain, a few knots, dark gaps #4A3520, nail heads #3A3A3A near the ends, lighter worn edges. Roughness 0.8-0.9.
- Bark: #5E4A36-#7A644A, vertical fissures. Cut ends #C9A66E with rings. Roughness 0.95.
- Plastic: #DDE8EE / #A9C8DE / #7FAED0, faceted crumple normal, roughness 0.35-0.5, opacity 0.85-0.9.
- Palm leaf: #4E9A2E-#6DB33A, lighter midrib #A6CF5A, yellowed tips #B9B04A, waxy roughness 0.45-0.55, alpha-cut fronds, double-sided.
- Rope: #B89B68-#CDB383, diagonal twist, grooves #8E7448, roughness 0.9.
- Scrap: rust #8A4A24-#A85D2E mixed with steel #7D8288, chipped paint #4F7EA0 / #A23A2A. Metalness 0.4-0.7 bare, 0.1 rust. Roughness 0.55 steel, 0.85 rust.
- Sand: #E8D3A0-#F0DFB0 speckle, wet #B9A276, roughness 0.95. Rock: #7C7F80-#9A9C98 facets, moss #5F7F3A on top, dark crevices, roughness 0.9.
- Foam: #F4FAFA with a cyan edge, alpha 0.6-0.9. Sail cloth: #E9DFC6-#D8CCAE, faint weave, patch seams, roughness 0.9.
- Lighting: hemisphere sky #BFE3FF / ground #3A6E7A, intensity 0.6-0.8. Sun #FFF1D6 at 2.5-3. Fog = horizon colour #CFE3EC. ACES at exposure 1.0-1.2.
## Techniques
- Tiling: whole-number frequencies per tile, periods double per octave, wrapped distances. Domain warping stays seamless if the warp is periodic.
- Planks: rows. Stretched grain noise (low px, high py). Warped ring bands, hashed knots, dark gaps, nails beside joints, worn edges.
- Bark: worley stretched vertically, ridges = smoothstep(f2-f1).
- Plastic: three worley layers at P=4, 9, 17; crease = 1-smoothstep(0, .15, f2-f1). Creases slightly more opaque.
- Leaf: midrib + parallel veins pow(|sin(PI*u*40)|, 8). Rope: ph=fract(3u+8v), strand profile pow(sin(PI*ph), .6), fibre noise.
- Scrap: rust = smoothstep(.52, .6, fbm). Scratches = stretched, thresholded vnoise. Rivets on a grid.
- Sand: grain hash + asymmetric ripple fract(7v + .3fbm). Rock: worley cells, crack = smoothstep(0, .04, f2-f1 + .05fbm).
- Foam: worley rims at P=8, 16, 32 masked by low-frequency fbm coverage. Cloth: woven over/under checker of arched threads.
- Roughness: rougher in cavities (1-h), worn convex edges.
