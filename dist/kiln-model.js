// Seaside Kiln and Glass Lantern models (docs/specs/kiln.md §6).
// Geometry and materials are built ONCE and shared; instance() returns a cheap Group of new Meshes.
// game.js rebuildRaft() disposes children it removes, so shared dispose() calls are no-ops here;
// the module's dispose() frees them for real. Local origin = centre of the floor tile top (y = .22).

function mergeParts(T, parts) {
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}

// Collects vertex-coloured, transformed, non-indexed pieces for one merged geometry.
function painter(T, seed0) {
  const parts = [];
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), one = new T.Vector3(1, 1, 1), sc = new T.Vector3();
  let seed = seed0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function add(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, jitter = 0.05, scale = null) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); m4.compose(p, q, scale ? sc.set(scale[0], scale[1], scale[2]) : one); g.applyMatrix4(m4);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), base = new T.Color(hex), c = new T.Color();
    for (let i = 0; i < n; i++) {
      const tone = 1 + (rnd() - .5) * jitter * 2;
      c.copy(base).multiplyScalar(tone);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  }
  return { parts, add };
}

function shareable(T, list) {
  const noop = () => {};
  for (const x of list) x.dispose = noop;
  const realGeo = T.BufferGeometry.prototype.dispose, realMat = T.Material.prototype.dispose;
  return () => { for (const x of list) (x.isMaterial ? realMat : realGeo).call(x); };
}

export function buildKiln(T) {
  const { parts, add } = painter(T, 11);
  // stone plinth (jittered stones)
  add(new T.BoxGeometry(.9, .16, .9), 0x8d8a82, 0, .08, 0, 0, 0, 0, .12);
  // clay drum + dome
  add(new T.CylinderGeometry(.4, .42, .34, 18), 0xb8653d, 0, .16 + .17, 0, 0, 0, 0, .06);
  add(new T.SphereGeometry(.4, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), 0xc9774a, 0, .5, 0, 0, 0, 0, .06, [1, 1.05, 1]);
  // dark mouth at the front (+z) with a little arch lip
  add(new T.BoxGeometry(.26, .24, .06), 0x2a1a12, 0, .34, .385, 0, 0, 0, .02);
  add(new T.BoxGeometry(.32, .04, .08), 0xa2552f, 0, .48, .38, 0, 0, 0, .04);
  // back chimney
  add(new T.CylinderGeometry(.065, .065, .38, 10), 0x7f4127, 0, .85, -.24, 0, 0, 0, .05);
  add(new T.CylinderGeometry(.08, .08, .04, 10), 0x6b3720, 0, 1.05, -.24, 0, 0, 0, .03);
  // 3 logs at the side
  for (let i = 0; i < 3; i++) add(new T.CylinderGeometry(.045, .045, .34, 8), 0x906f48, -.36 + (i === 2 ? .05 : i * .1) - .05, .2 + (i === 2 ? .085 : 0), .32, Math.PI / 2, 0, 0, .08);
  // front-right tray plank
  add(new T.BoxGeometry(.32, .03, .2), 0xa97d4c, .3, .175, .36, 0, 0, 0, .05);
  const bodyGeo = mergeParts(T, parts);
  const bodyMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 }); bodyMat.name = 'kilnBody';

  // glow: plane in the mouth + an ember box (one merged geometry)
  const gp = new T.PlaneGeometry(.22, .2); gp.translate(0, .33, .417);
  const ge = new T.BoxGeometry(.18, .04, .08); ge.translate(0, .24, .39);
  const glowParts = [gp.toNonIndexed(), ge.toNonIndexed()]; gp.dispose(); ge.dispose();
  for (const g of glowParts) { g.setAttribute('color', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); g.deleteAttribute('uv'); }
  const glowGeo = mergeParts(T, glowParts);
  const glowMat = new T.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0xff6a1a, emissiveIntensity: 1.8, roughness: 1 }); glowMat.name = 'kilnGlow';

  // flame: 2 crossed planes, origin at the base so scale.y grows upward
  const f1 = new T.PlaneGeometry(.14, .22); f1.translate(0, .11, 0);
  const f2 = f1.clone(); f2.rotateY(Math.PI / 2);
  const flameParts = [f1.toNonIndexed(), f2.toNonIndexed()]; f1.dispose(); f2.dispose();
  for (const g of flameParts) { g.setAttribute('color', new T.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); g.deleteAttribute('uv'); }
  const flameGeo = mergeParts(T, flameParts);
  const flameMat = new T.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: .8, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, forceSinglePass: true }); flameMat.name = 'kilnFlame';

  // tray goods (on the plank, y top .19)
  const ingotGeo = new T.BoxGeometry(.15, .04, .06);
  const glassGeo = new T.BoxGeometry(.16, .11, .012);
  const brickGeo = new T.BoxGeometry(.15, .05, .07);
  const ingotMat = new T.MeshStandardMaterial({ color: 0x9aa6ad, metalness: .6, roughness: .4 }); ingotMat.name = 'trayIngot';
  const glassMat = new T.MeshStandardMaterial({ color: 0xbfe8e4, transparent: true, opacity: .5, roughness: .1 }); glassMat.name = 'trayGlass';
  const brickMat = new T.MeshStandardMaterial({ color: 0xb5532f, roughness: .9 }); brickMat.name = 'trayBrick';

  const free = shareable(T, [bodyGeo, glowGeo, flameGeo, ingotGeo, glassGeo, brickGeo, bodyMat, glowMat, flameMat, ingotMat, glassMat, brickMat]);
  const mesh = (geo, mat, name, x, y, z, rx = 0) => { const m = new T.Mesh(geo, mat); m.name = name; m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = false; return m; };

  return {
    instance() {
      const g = new T.Group(); g.name = 'kiln_station';
      const body = mesh(bodyGeo, bodyMat, 'kilnBody', 0, 0, 0); body.castShadow = true; body.receiveShadow = true;
      const glow = mesh(glowGeo, glowMat, 'kilnGlow', 0, 0, 0);
      const flame = mesh(flameGeo, flameMat, 'kilnFlame', 0, .245, .44);
      const ingot = mesh(ingotGeo, ingotMat, 'trayIngot', .3, .21, .36);
      const glass = mesh(glassGeo, glassMat, 'trayGlass', .3, .245, .34, -.25);
      const brick = mesh(brickGeo, brickMat, 'trayBrick', .3, .215, .36);
      glow.visible = flame.visible = ingot.visible = glass.visible = brick.visible = false;
      g.add(body, glow, flame, ingot, glass, brick);
      g.userData.craftType = 'kiln'; g.userData.height = 1.07;
      g.userData.kiln = { glow, flame, tray: { ingot, glass, brick } };
      return g;
    },
    flicker(time) {
      glowMat.emissiveIntensity = 1.6 + .35 * Math.sin(time * 9) + .2 * Math.sin(time * 23);
      flameMat.opacity = .75 + .2 * Math.sin(time * 13);
    },
    dispose: free,
  };
}

/** Glass Lantern: an iron post with a bracket and a glass box. Named 'craft_lantern' so daynight.js lights it. */
export function buildGlassLamp(T) {
  const { parts, add } = painter(T, 5);
  add(new T.CylinderGeometry(.05, .06, 1.6, 10), 0x4a4f52, 0, .8, 0, 0, 0, 0, .04);           // post
  add(new T.CylinderGeometry(.1, .12, .06, 10), 0x3e4245, 0, .03, 0, 0, 0, 0, .03);           // foot
  add(new T.BoxGeometry(.34, .035, .035), 0x4a4f52, .15, 1.5, 0, 0, 0, 0, .03);               // bracket arm
  add(new T.BoxGeometry(.025, .18, .025), 0x4a4f52, .07, 1.42, 0, 0, 0, -.7, .03);            // brace
  add(new T.CylinderGeometry(.01, .01, .05, 6), 0x4a4f52, .3, 1.47, 0, 0, 0, 0, .02);         // hanger
  add(new T.BoxGeometry(.24, .03, .24), 0x3e4245, .3, 1.155, 0, 0, 0, 0, .03);                // base plate
  add(new T.ConeGeometry(.17, .1, 4), 0x3e4245, .3, 1.49, 0, 0, Math.PI / 4, 0, .03);         // cap
  const postGeo = mergeParts(T, parts);
  const postMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .5 }); postMat.name = 'lanternIron';
  const glassGeo = new T.BoxGeometry(.2, .28, .2); glassGeo.translate(.3, 1.3, 0);
  const glowGeo = new T.SphereGeometry(.07, 12, 8); glowGeo.translate(.3, 1.29, 0);
  const glassMat = new T.MeshStandardMaterial({ color: 0xdff4f0, transparent: true, opacity: .3, emissive: 0xffd08a, emissiveIntensity: .9, roughness: .1, depthWrite: false });
  const glowMat = new T.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffb050, emissiveIntensity: 2.2, roughness: 1 });
  const free = shareable(T, [postGeo, glassGeo, glowGeo, postMat, glassMat, glowMat]);
  return {
    instance() {
      const g = new T.Group(); g.name = 'craft_lantern';
      const post = new T.Mesh(postGeo, postMat); post.name = 'lanternPost'; post.castShadow = true;
      // daynight records and scales base emissive per material, so these two are cloned per instance.
      const glass = new T.Mesh(glassGeo, glassMat.clone()); glass.name = 'lanternGlass';
      const glow = new T.Mesh(glowGeo, glowMat.clone()); glow.name = 'lanternGlow';
      g.add(post, glass, glow);
      g.userData.craftType = 'glasslamp'; g.userData.height = 1.6;
      return g;
    },
    dispose: free,
  };
}
