// Sandy Secrets models (procedural, own art): the held Little Spade and Seashell Finder, plus the
// dig-site kit (hole, mound, pop-up chest, sand puff) used by treasure.js.
// createSpade(T) / createFinder(T): handle along +Y with the butt at -Y, the root re-centred on its bounds
//   (like hammer.js). userData.grip (Vector3, where the fist closes, root space), userData.size {x,y,z}.
//   Spade: D-grip, shaft, rope wrap, collar, blade = 5 meshes, ~0.75 m. Finder: grip wrap, wand,
//   glowing bead (userData.bead), brass coil = 4 meshes, ~0.6 m. Deterministic, no randomness.
// createMoundKit(T): cached geometries/materials built once; hole(), mound(), chest(), puff() make meshes
//   that share them; dispose() frees them all.

function recentre(T, root, inner, grip) {
  root.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(inner), c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
  inner.position.sub(c);
  root.userData.grip = grip.clone().sub(c);
  root.userData.size = { x: s.x, y: s.y, z: s.z };
  return root;
}

export function createSpade(T) {
  const root = new T.Group(); root.name = 'littleSpade';
  const inner = new T.Group(); root.add(inner);
  const wood = new T.MeshStandardMaterial({ color: 0xbb8650, roughness: 0.85 });
  const dark = new T.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.9 });
  const metal = new T.MeshStandardMaterial({ color: 0x9fb1bf, roughness: 0.4, metalness: 0.55 });
  const rope = new T.MeshStandardMaterial({ color: 0xd9c38c, roughness: 0.95 });
  // D-grip at the butt (-Y): a torus standing in the XY plane, its cross bar through the shaft end.
  const grip = new T.Mesh(new T.TorusGeometry(0.05, 0.012, 8, 20), dark);
  grip.position.y = 0.05; grip.scale.set(1, 0.85, 1); inner.add(grip);
  const shaft = new T.Mesh(new T.CylinderGeometry(0.015, 0.017, 0.48, 10), wood);
  shaft.position.y = 0.33; inner.add(shaft);
  const wrap = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, 0.1, 10), rope);
  wrap.position.y = 0.2; inner.add(wrap);
  const collar = new T.Mesh(new T.CylinderGeometry(0.022, 0.026, 0.06, 10), metal);
  collar.position.y = 0.57; inner.add(collar);
  // Blade: a rounded spade outline, thin and bevelled, tip at +Y.
  const sh = new T.Shape();
  sh.moveTo(-0.075, 0); sh.lineTo(0.075, 0); sh.lineTo(0.075, 0.12);
  sh.quadraticCurveTo(0.07, 0.19, 0, 0.215); sh.quadraticCurveTo(-0.07, 0.19, -0.075, 0.12); sh.lineTo(-0.075, 0);
  const bg = new T.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1, curveSegments: 8 });
  bg.translate(0, 0, -0.003);
  const blade = new T.Mesh(bg, metal);
  blade.position.y = 0.59; blade.rotation.x = -0.12; inner.add(blade);
  return recentre(T, root, inner, new T.Vector3(0, 0.2, 0));
}

export function createFinder(T) {
  const root = new T.Group(); root.name = 'seashellFinder';
  const inner = new T.Group(); root.add(inner);
  const wood = new T.MeshStandardMaterial({ color: 0xc99560, roughness: 0.85 });
  const rope = new T.MeshStandardMaterial({ color: 0x8a6e44, roughness: 0.95 });
  const brass = new T.MeshStandardMaterial({ color: 0xd7a446, roughness: 0.35, metalness: 0.7 });
  const glow = new T.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffbd66, emissiveIntensity: 0.6, roughness: 0.3 });
  const wrap = new T.Mesh(new T.CylinderGeometry(0.021, 0.021, 0.14, 10), rope);
  wrap.position.y = 0.08; inner.add(wrap);
  const wand = new T.Mesh(new T.CylinderGeometry(0.012, 0.016, 0.5, 10), wood);
  wand.position.y = 0.25; inner.add(wand);
  const bead = new T.Mesh(new T.SphereGeometry(0.022, 14, 10), glow);
  bead.position.y = 0.16; inner.add(bead);
  const coil = new T.Mesh(new T.TorusGeometry(0.085, 0.014, 8, 26), brass);
  coil.position.set(0, 0.5, 0.06); coil.rotation.x = Math.PI / 2 + 0.7; inner.add(coil); // tilted so it lies flat over the sand in the forward-leaning hold
  root.userData.bead = bead;
  return recentre(T, root, inner, new T.Vector3(0, 0.08, 0));
}

export function createMoundKit(T) {
  const geos = {
    hole: new T.CircleGeometry(0.32, 20).rotateX(-Math.PI / 2),
    mound: new T.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2), // low-poly heap, flat shaded like the island rocks
    box: new T.BoxGeometry(0.28, 0.18, 0.2),
    lid: new T.BoxGeometry(0.3, 0.05, 0.22),
    puff: new T.SphereGeometry(0.3, 10, 6),
  };
  const mats = {
    hole: new T.MeshStandardMaterial({ color: 0x9c7a45, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    mound: new T.MeshStandardMaterial({ color: 0xdcb877, roughness: 1, flatShading: true }),
    wood: new T.MeshStandardMaterial({ color: 0xbb8650, roughness: 0.85 }),
    lid: new T.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.85 }),
    puff: new T.MeshBasicMaterial({ color: 0xf1dca8, transparent: true, opacity: 0, depthWrite: false }),
  };
  const mesh = (g, m, name) => { const o = new T.Mesh(geos[g], mats[m]); o.name = name; o.receiveShadow = true; return o; };
  return {
    geos, mats,
    hole: () => mesh('hole', 'hole', 'treasureHole'),
    mound: () => { const o = mesh('mound', 'mound', 'treasureMound'); o.scale.set(0.38, 0.16, 0.38); o.castShadow = true; return o; },
    // One group: the box and its lid (2 meshes).
    chest: () => {
      const g = new T.Group(); g.name = 'treasureChest';
      const b = mesh('box', 'wood', 'chestBox'); b.position.y = 0.09; b.castShadow = true;
      const l = mesh('lid', 'lid', 'chestLid'); l.position.y = 0.2; l.castShadow = true;
      g.add(b, l); return g;
    },
    puff: () => { const o = mesh('puff', 'puff', 'treasurePuff'); o.receiveShadow = false; o.renderOrder = 2; return o; },
    dispose() { for (const g of Object.values(geos)) g.dispose(); for (const m of Object.values(mats)) m.dispose(); },
  };
}
