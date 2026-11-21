// Procedural models for the receiver, antenna and floating signal cache.
// Each model owns its geometry and materials (the engine's disposeGeometry frees them). Origin = deck / water level.
// The matte parts of each model are merged into one vertex-coloured mesh (all share roughness .8, metalness 0);
// only the emissive parts (receiver screen, antenna tip) and the cache's light beam stay separate meshes.

// Bake a flat colour (sRGB -> linear, as material.color does) into a color attribute.
function tint(T, g, hex) {
  const c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new T.BufferAttribute(a, 3));
  return g;
}

// Merge position/normal/color of several geometries into one non-indexed geometry. Disposes inputs.
function merge(T, geos) {
  const parts = geos.map((g) => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); return n; });
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(p.attributes.normal.array.subarray(0, c * 3), o * 3);
    col.set(p.attributes.color.array.subarray(0, c * 3), o * 3);
    o += c;
    p.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

export function createSignalModel(T, type) {
  if (type !== 'receiver' && type !== 'antenna' && type !== 'cache') return null;
  const g = new T.Group();
  const std = (color, extra = {}) => new T.MeshStandardMaterial({color, roughness:.8, metalness:0, ...extra});
  const add = (geo, material, x = 0, y = 0, z = 0) => {
    const m = new T.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  const parts = [];
  const part = (geo, color, x = 0, y = 0, z = 0, rx = 0) => { if (rx) geo.rotateX(rx); parts.push(tint(T, geo.translate(x, y, z), color)); };
  const addParts = (extra) => add(merge(T, parts), std('#ffffff', {vertexColors:true, ...extra}));
  if (type === 'receiver') {
    part(new T.BoxGeometry(.7, .35, .5), '#8c6745', 0, .175, 0);
    part(new T.SphereGeometry(.04, 10, 8), '#ffbd66', .27, .2, .26);
    part(new T.CylinderGeometry(.02, .02, .6, 8), '#c0c6c8', -.3, .65, -.2);
    part(new T.BoxGeometry(.4, .02, .25), '#2e5f8a', .1, .42, -.05, -.5);
    addParts();
    add(new T.BoxGeometry(.5, .22, .02), std('#1f4a52', {emissive:'#2f8f86', emissiveIntensity:.4}), 0, .2, .26);
  } else if (type === 'antenna') {
    part(new T.BoxGeometry(.3, .08, .3), '#906f48', 0, .04, 0);
    part(new T.CylinderGeometry(.035, .05, 2.2, 8), '#906f48', 0, 1.1, 0);
    [[1.7, .6], [1.9, .45], [2.1, .3]].forEach(([y, w]) => part(new T.BoxGeometry(w, .03, .03), '#c0c6c8', 0, y, 0));
    addParts();
    add(new T.SphereGeometry(.06, 10, 8), std('#ff8a5c', {emissive:'#ff8a5c', emissiveIntensity:.6}), 0, 2.25, 0);
  } else {
    part(new T.CylinderGeometry(.45, .38, .5, 16), '#f2a33a', 0, .1, 0);
    part(new T.CylinderGeometry(.46, .46, .1, 16), '#fff3cf', 0, .15, 0);
    part(new T.ConeGeometry(.2, .3, 12), '#e0523f', 0, .5, 0);
    part(new T.CylinderGeometry(.02, .02, 1, 6), '#725942', 0, 1, 0);
    part(new T.PlaneGeometry(.35, .22), '#e0523f', .18, 1.35, 0);
    addParts({side:T.DoubleSide}); // the flag is a single sheet
    const beam = new T.Mesh(new T.CylinderGeometry(.12, .12, 8, 16, 1, true),
      new T.MeshBasicMaterial({color:'#fff0b0', transparent:true, opacity:.25, depthWrite:false, side:T.DoubleSide, forceSinglePass:true}));
    beam.position.y = 4.5; beam.visible = false; beam.castShadow = false; beam.name = 'signalBeam';
    beam.raycast = () => {}; // light only: never a pick/aim target
    g.add(beam); g.userData.beam = beam;
  }
  g.name = 'signal-' + type;
  return g;
}
