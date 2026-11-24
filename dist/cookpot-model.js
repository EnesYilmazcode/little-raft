// Cooking Pot model (docs/specs/cookpot.md §5). Geometry and materials are built ONCE and shared;
// instance() returns a cheap Group of 5 Meshes (body, lid, glow, steam, stew). No lights.
// game.js rebuildRaft() disposes children it removes, so shared dispose() calls are no-ops here;
// the module's dispose() frees them for real. Local origin = centre of the floor tile top.
import { MEAL_IDS } from './cookpot-core.js?build=v3-survival-ae77fa84ac2b';

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

const STEW_TINT = { meal_chowder: 0xf3e2b8, meal_omelette: 0xf5cf4a, meal_broth: 0x5f9a57, meal_fishbowl: 0xc77b3c, meal_custard: 0xf7e7a8, meal_stew: 0xb5542c,
  meal_gardensoup: 0xd0623f, meal_hotpot: 0xe2b765, meal_sharkroast: 0x9a5a3e };
const STONE_Y = .09, POT_Y = .14; // pot bottom sits on the stones

export function buildCookpot(T) {
  const { parts, add } = painter(T, 23);
  // three grey stones in a ring
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3 + .3;
    add(new T.DodecahedronGeometry(.1, 0), [0x8d8a82, 0x7d7a73, 0x96928a][i], Math.cos(a) * .2, STONE_Y, Math.sin(a) * .2, i, i * .7, 0, .12, [1.15, .9, 1]);
  }
  // a few twigs under the pot
  add(new T.CylinderGeometry(.025, .025, .3, 6), 0x7a5a38, 0, .04, 0, Math.PI / 2, 0, .4, .1);
  add(new T.CylinderGeometry(.025, .025, .28, 6), 0x8a6842, 0, .05, 0, Math.PI / 2, 0, -.6, .1);
  // squat terracotta pot (lathe, r .26, h .3)
  const prof = [[.001, 0], [.16, 0], [.23, .05], [.26, .13], [.25, .21], [.22, .27], [.23, .3]].map(([x, y]) => new T.Vector2(x, y));
  add(new T.LatheGeometry(prof, 18), 0xc06a3e, 0, POT_Y, 0, 0, 0, 0, .06);
  // rim
  add(new T.TorusGeometry(.225, .022, 6, 18), 0xa9572f, 0, POT_Y + .3, 0, Math.PI / 2, 0, 0, .05);
  // two little handles
  add(new T.TorusGeometry(.04, .012, 5, 8, Math.PI), 0x9a4e2a, .265, POT_Y + .2, 0, 0, Math.PI / 2, 0, .04);
  add(new T.TorusGeometry(.04, .012, 5, 8, Math.PI), 0x9a4e2a, -.265, POT_Y + .2, 0, 0, Math.PI / 2, 0, .04);
  const bodyGeo = mergeParts(T, parts);
  const bodyMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0, side: T.DoubleSide }); bodyMat.name = 'cookpotBody';

  // lid: darker disc + knob, tilted a little so the stew shows
  const lp = painter(T, 7);
  lp.add(new T.CylinderGeometry(.2, .22, .03, 18), 0x7f4127, 0, 0, 0, 0, 0, 0, .05);
  lp.add(new T.SphereGeometry(.035, 8, 6), 0x5e2f1b, 0, .035, 0, 0, 0, 0, .04);
  const lidGeo = mergeParts(T, lp.parts);
  const lidMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85 }); lidMat.name = 'cookpotLid';

  // glow: ember plane under the pot (kiln glow recipe)
  const glowGeo = new T.PlaneGeometry(.3, .3); glowGeo.rotateX(-Math.PI / 2); glowGeo.translate(0, .03, 0);
  const glowMat = new T.MeshStandardMaterial({ color: 0xff8a3d, emissive: 0xff6a1a, emissiveIntensity: 1.8, roughness: 1 }); glowMat.name = 'cookpotGlow';

  // steam: one merged geometry of 3 low-poly puffs
  const sp = painter(T, 3);
  sp.add(new T.IcosahedronGeometry(.05, 0), 0xffffff, .02, 0, 0, 0, 0, 0, 0);
  sp.add(new T.IcosahedronGeometry(.04, 0), 0xffffff, -.05, .09, .02, 0, 0, 0, 0);
  sp.add(new T.IcosahedronGeometry(.035, 0), 0xffffff, .04, .17, -.02, 0, 0, 0, 0);
  const steamGeo = mergeParts(T, sp.parts);
  const steamMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .35, depthWrite: false }); steamMat.name = 'cookpotSteam';

  // stew: a flat disc inside the rim, tinted per meal (6 shared materials)
  const stewGeo = new T.CircleGeometry(.21, 18); stewGeo.rotateX(-Math.PI / 2);
  const stewMats = {};
  for (const id of MEAL_IDS) { const m = new T.MeshStandardMaterial({ color: STEW_TINT[id] ?? 0xc77b3c, roughness: .6 }); m.name = 'cookpotStew_' + id; stewMats[id] = m; }

  const free = shareable(T, [bodyGeo, lidGeo, glowGeo, steamGeo, stewGeo, bodyMat, lidMat, glowMat, steamMat, ...Object.values(stewMats)]);
  const mesh = (geo, mat, name, x, y, z) => { const m = new T.Mesh(geo, mat); m.name = name; m.position.set(x, y, z); m.castShadow = false; return m; };
  const LID_Y = POT_Y + .325, STEAM_Y = POT_Y + .36;

  return {
    LID_Y, STEAM_Y, stewMats,
    instance() {
      const g = new T.Group(); g.name = 'cookpot_station';
      const body = mesh(bodyGeo, bodyMat, 'cookpotBody', 0, 0, 0); body.castShadow = true; body.receiveShadow = true;
      const lid = mesh(lidGeo, lidMat, 'cookpotLid', -.03, LID_Y, -.02); lid.rotation.z = .12;
      const glow = mesh(glowGeo, glowMat, 'cookpotGlow', 0, 0, 0);
      const steam = mesh(steamGeo, steamMat, 'cookpotSteam', 0, STEAM_Y, 0);
      const stew = mesh(stewGeo, stewMats[MEAL_IDS[0]], 'cookpotStew', 0, POT_Y + .26, 0);
      glow.visible = steam.visible = stew.visible = false;
      g.add(body, lid, glow, steam, stew);
      g.userData.craftType = 'cookpot'; g.userData.height = .55;
      g.userData.cookpot = { lid, glow, steam, stew };
      return g;
    },
    // Shared per-frame animation (materials are shared, so one call covers every pot).
    flicker(time) {
      glowMat.emissiveIntensity = 1.6 + .35 * Math.sin(time * 9) + .2 * Math.sin(time * 23);
      const ph = (time % 2.4) / 2.4;
      steamMat.opacity = .35 * (1 - ph);
      return ph;
    },
    dispose: free,
  };
}
