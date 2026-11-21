// Placed anchor model: a short wooden post with a rope drum and a crank, an arm reaching out over the raft edge,
// and a rope that lowers a small iron anchor into the sea (sailing-world.js animates the rope, hook and coil).
// Cheap: geometry and materials are built once and shared by every instance (marked userData.shared, so
// game.js rebuildRaft never frees them) and live for the page; 4 draw calls, no shadows. The static part carries
// two braces, a pulley at the arm tip and the rope run from the drum up to it.
// Local origin = centre of the floor tile top (place at y = .22). The arm points along +z (rotate the group
// so +z faces open water: anchor-rules.js outwardRot). Named parts: anchorRope, anchorHook, anchorCoil.

export const ANCHOR_MODEL = Object.freeze({
  POST_Z: .35,      // post stands this far toward the edge from the tile centre
  ARM_Z: 1.08,      // rope hangs from here (tile edge at 1.0): over the water
  ARM_Y: .95,       // rope top (local, above the tile top)
  DRUM_Y: .72,
  ROPE_UP: .07,     // rope length raised; the hook hangs right under the arm
  ROPE_DOWN: 3.4,   // rope length dropped (well under the waterline)
});

let shared = null; // { T, stat, coil, rope, anchor (geometries), woodMat, ropeMat, ironMat }

function build(T) {
  const M = ANCHOR_MODEL;
  const vc = (geo, hex) => {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    g.deleteAttribute('uv');
    const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new T.Color(hex);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return g;
  };
  const WOOD = '#906f48', LIGHT = '#b4824b', DARK = '#6f5235', ROPE = '#b99a62';
  // Diagonal brace from the post up to the arm's underside, at lateral offset x.
  const brace = x => {
    const z0 = M.POST_Z + .05, y0 = M.ARM_Y - .32, z1 = M.POST_Z + .36, y1 = M.ARM_Y - .01, len = Math.hypot(z1 - z0, y1 - y0);
    return vc(new T.BoxGeometry(.022, len, .04).rotateX(Math.atan2(z1 - z0, y1 - y0)).translate(x, (y0 + y1) / 2, (z0 + z1) / 2), DARK);
  };
  // Straight rope segment in the x = const plane from (y0, z0) to (y1, z1).
  const ropeSpan = (x, y0, z0, y1, z1) => {
    const len = Math.hypot(z1 - z0, y1 - y0);
    return vc(new T.CylinderGeometry(.016, .016, len, 5).rotateX(Math.atan2(z1 - z0, y1 - y0)).translate(x, (y0 + y1) / 2, (z0 + z1) / 2), ROPE);
  };
  const parts = [
    vc(new T.CylinderGeometry(.065, .08, M.ARM_Y + .06, 8).translate(0, (M.ARM_Y + .06) / 2, M.POST_Z), WOOD),     // post
    vc(new T.BoxGeometry(.06, .06, M.ARM_Z - M.POST_Z + .06).translate(0, M.ARM_Y + .02, (M.POST_Z + M.ARM_Z) / 2), WOOD), // arm
    ...[-1, 1].map(sx => brace(sx * .036)),                                                                          // two arm braces (the rope runs between them)
    vc(new T.CylinderGeometry(.045, .045, .09, 10).rotateZ(Math.PI / 2).translate(0, M.ARM_Y - .015, M.ARM_Z), DARK), // pulley at the arm tip
    ropeSpan(0, M.DRUM_Y + .02, M.POST_Z + .1, M.ARM_Y - .05, M.ARM_Z - .03),                                     // rope: drum up to the pulley
    vc(new T.CylinderGeometry(.075, .075, .34, 10).rotateZ(Math.PI / 2).translate(0, M.DRUM_Y, M.POST_Z), LIGHT),  // rope drum
    vc(new T.BoxGeometry(.03, .18, .03).translate(.2, M.DRUM_Y - .06, M.POST_Z), DARK),                             // crank
    vc(new T.BoxGeometry(.3, .04, .3).translate(0, .02, M.POST_Z), DARK),                                          // foot plate
  ];
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const stat = new T.BufferGeometry();
  stat.setAttribute('position', new T.BufferAttribute(pos, 3)); stat.setAttribute('normal', new T.BufferAttribute(nor, 3)); stat.setAttribute('color', new T.BufferAttribute(col, 3));
  stat.computeBoundingSphere(); stat.computeBoundingBox();
  const coil = new T.CylinderGeometry(.085, .085, .24, 10).rotateZ(Math.PI / 2);
  const rope = new T.CylinderGeometry(.018, .018, 1, 5).translate(0, -.5, 0); // unit length hanging down, scaled by y
  const anchor = anchorGeometry(T);
  const mats = {
    woodMat: new T.MeshStandardMaterial({ vertexColors: true, roughness: .9 }),
    ropeMat: new T.MeshStandardMaterial({ color: '#b99a62', roughness: 1 }),
    ironMat: new T.MeshStandardMaterial({ color: '#5e5a52', roughness: .6, metalness: .3 }),
  };
  // Shared for the page's lifetime (tiny): rebuildRaft skips userData.shared, and the build ghost (which disposes the
  // materials of the model it is handed) gets a no-op dispose, like the bed model.
  const noop = () => {};
  for (const g of [stat, coil, rope, anchor]) { g.userData.shared = true; g.dispose = noop; }
  for (const k in mats) { mats[k].userData.shared = true; mats[k].name = 'anchor-' + k; mats[k].dispose = noop; }
  return { T, stat, coil, rope, anchor, ...mats };
}

/** One placed anchor (a Group). Shares geometry/materials with every other instance. */
export function createAnchorModel(T) {
  if (!shared || shared.T !== T) shared = build(T);
  const S = shared, M = ANCHOR_MODEL;
  const g = new T.Group(); g.name = 'craft_anchor';
  const mesh = (geo, mat, name) => { const m = new T.Mesh(geo, mat); m.name = name; m.castShadow = false; m.receiveShadow = false; g.add(m); return m; };
  mesh(S.stat, S.woodMat, 'anchorPost');
  mesh(S.coil, S.ropeMat, 'anchorCoil').position.set(0, M.DRUM_Y, M.POST_Z);
  mesh(S.rope, S.ropeMat, 'anchorRope').position.set(0, M.ARM_Y, M.ARM_Z);
  mesh(S.anchor, S.ironMat, 'anchorHook').position.set(0, M.ARM_Y, M.ARM_Z);
  poseAnchor(g, 0);
  g.userData.craftType = 'anchor'; g.userData.height = M.ARM_Y + .1;
  return g;
}

/** Poses one anchor model for a drop amount k (0 raised .. 1 down). No allocations (4 children, matched by name). */
export function poseAnchor(g, k) {
  const M = ANCHOR_MODEL, len = M.ROPE_UP + (M.ROPE_DOWN - M.ROPE_UP) * k, ch = g.children;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (c.name === 'anchorRope') c.scale.y = len;
    else if (c.name === 'anchorHook') c.position.y = M.ARM_Y - len;
    else if (c.name === 'anchorCoil') c.scale.x = c.scale.z = 1.2 - .45 * k;
  }
}

// Anchor (one merged geometry, ring at the origin, hanging down -y): top ring, stock bar, shank, two flukes in a V.
function anchorGeometry(T) {
  const parts = [
    new T.TorusGeometry(.045, .012, 6, 14),
    new T.CylinderGeometry(.014, .014, .26, 6).rotateX(Math.PI / 2).translate(0, -.08, 0),
    new T.CylinderGeometry(.022, .026, .36, 8).translate(0, -.23, 0),
  ];
  for (const s of [-1, 1]) {
    parts.push(new T.CylinderGeometry(.016, .022, .2, 6).translate(0, .1, 0).rotateZ(s * .95).translate(0, -.4, 0));
    parts.push(new T.ConeGeometry(.034, .08, 4).rotateZ(s * .5).translate(-s * .17, -.27, 0)); // fluke tips
  }
  let n = 0;
  const flat = parts.map(g => { const f = g.index ? g.toNonIndexed() : g; if (f !== g) g.dispose(); n += f.attributes.position.count; return f; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const f of flat) { pos.set(f.attributes.position.array, o); nor.set(f.attributes.normal.array, o); o += f.attributes.position.array.length; f.dispose(); }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3)); out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.scale(1.2, 1.2, 1.2); // reads at a glance from across the raft (still clears the deck when raised)
  out.computeBoundingSphere();
  return out;
}
