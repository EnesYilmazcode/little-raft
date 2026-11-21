// The Old Beacon Mast model: low-poly, built once. Three draw calls in all:
//   body   one merged vertex-coloured mesh (rock, legs, braces, deck, railing, ladder, pole, lamp hood, keeper's board),
//          the only shadow caster;
//   lamp   the emissive beacon glass (pulsed by mast.js through emissiveIntensity);
//   crates an InstancedMesh of the three loot crates (looted ones squash to an open base).
// Origin = the rock's centre at mean water. Sizes come from mast-core.js so the physics matches what you see.
import { MAST, CRATES, BOARD, rockShape } from './mast-core.js?build=v3-survival-ae77fa84ac2b';
import { hash3 } from './islands-layout.js?build=v3-survival-ae77fa84ac2b';

function tint(T, g, hex, shade = null) { // flat colour (or a per-vertex shade fn(y, c)) into a color attribute
  const c = new T.Color(hex), p = g.attributes.position, a = new Float32Array(p.count * 3), t = new T.Color();
  for (let i = 0; i < p.count; i++) {
    t.copy(c); if (shade) shade(p.getX(i), p.getY(i), p.getZ(i), t);
    a[i * 3] = t.r; a[i * 3 + 1] = t.g; a[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new T.BufferAttribute(a, 3));
  return g;
}
// Merge position/normal/color into one non-indexed geometry (flat faces). Disposes the inputs.
function merge(T, geos) {
  const parts = geos.map(g => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); return n; });
  let count = 0;
  for (const p of parts) count += p.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    const c = p.attributes.position.count;
    pos.set(p.attributes.position.array.subarray(0, c * 3), o * 3);
    nor.set(p.attributes.normal.array.subarray(0, c * 3), o * 3);
    col.set(p.attributes.color.array.subarray(0, c * 3), o * 3);
    o += c; p.dispose();
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.BufferAttribute(nor, 3));
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

export function createMastModel(T) {
  const parts = [];
  const UP = new T.Vector3(0, 1, 0), va = new T.Vector3(), vb = new T.Vector3(), q = new T.Quaternion();
  const box = (w, h, d, x, y, z, hex, ry = 0) => { const g = new T.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); parts.push(tint(T, g.translate(x, y, z), hex)); };
  // A round beam from a to b ([x, y, z] arrays).
  const beam = (a, b, r, hex, seg = 5) => {
    va.set(a[0], a[1], a[2]); vb.set(b[0], b[1], b[2]);
    const len = va.distanceTo(vb), g = new T.CylinderGeometry(r, r, len, seg, 1);
    q.setFromUnitVectors(UP, vb.clone().sub(va).normalize()); g.applyQuaternion(q);
    g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
    parts.push(tint(T, g, hex));
  };

  // ---- rock: a lathe profile, pushed out by rockShape and jittered, coloured by height
  const R = MAST.PLAT_R, top = MAST.PLAT_Y;
  const prof = [[0, top], [R * .45, top], [R - MAST.EDGE, top], [R - MAST.EDGE * .45, top - .55], [R, -.5], [R * 1.12, -2.2], [R * 1.05, -4]].map(([r, y]) => new T.Vector2(r, y));
  const rock = new T.LatheGeometry(prof.reverse(), 18);
  { const p = rock.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z);
      if (r < 1e-4) continue;
      const th = Math.atan2(z, x), edge = y < top - .01, j = edge ? 1 + (hash3(Math.round(th * 50) & 1023, Math.round(y * 20), 7) - .5) * .12 : 1;
      const k = rockShape(th) * j;
      p.setXYZ(i, x * k, y + (edge ? (hash3(Math.round(th * 50) & 1023, Math.round(y * 20), 9) - .5) * .25 : 0), z * k);
    }
  }
  const rockG = rock.toNonIndexed(); rock.dispose(); rockG.computeVertexNormals();
  parts.push(tint(T, rockG, '#7d766c', (x, y, z, c) => {
    if (y > top - .02) c.set('#8c8577').offsetHSL(0, 0, (hash3(Math.round(x * 3) + 64, Math.round(z * 3) + 64, 3) - .5) * .06);
    else if (y > -.3) c.set('#6f675b');
    else c.set('#4f5a52'); // weed line below the water
  }));
  // a few boulders round the rim and a lichen-green pad under the legs
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + .5, r = R * (.78 + .1 * hash3(i, 5, 1)), s = .45 + .35 * hash3(i, 5, 2);
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < .5) continue; // keep the ladder side (+x) clear
    const g = new T.DodecahedronGeometry(s, 0); g.scale(1, .7, 1);
    parts.push(tint(T, g.translate(Math.cos(a) * r * rockShape(a), top + s * .25, Math.sin(a) * r * rockShape(a)), '#857d70'));
  }
  const L0 = MAST.LEGS[0], L1 = MAST.LEGS[1], yb = top, yt = MAST.DECK_Y - .25;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) box(.55, .22, .55, sx * L0, top + .06, sz * L0, '#9a958a'); // concrete footings

  // ---- lattice tower: 4 tapered legs, X braces on three levels and ring girders
  const rust = '#a35a34', iron = '#5e5048';
  const at = (y, sx, sz) => { const t = (y - yb) / (yt - yb), s = L0 + (L1 - L0) * t; return [sx * s, y, sz * s]; };
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of corners) beam(at(yb, sx, sz), at(yt, sx, sz), MAST.LEG_R, rust, 6);
  const levels = [yb + .2, yb + (yt - yb) / 3, yb + 2 * (yt - yb) / 3, yt - .05];
  for (let f = 0; f < 4; f++) {
    const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
    for (let l = 0; l < 3; l++) {
      beam(at(levels[l], ax, az), at(levels[l + 1], bx, bz), .045, iron, 4);
      beam(at(levels[l], bx, bz), at(levels[l + 1], ax, az), .045, iron, 4);
    }
    for (let l = 1; l < 3; l++) beam(at(levels[l], ax, az), at(levels[l], bx, bz), .06, rust, 4);
  }

  // ---- deck, railing (a gap where the ladder comes up), ladder
  const D = MAST.DECK_Y, H = MAST.DECK_HALF;
  box(H * 2, .25, H * 2, 0, D - .125, 0, '#8a6a48');
  for (let i = -2; i <= 2; i++) box(H * 2 - .05, .02, .04, 0, D + .005, i * .9, '#6b5038'); // plank seams
  const rail = '#b3653c', rh = D + 1.0;
  for (const [x, z] of [[H, H], [H, -H], [-H, H], [-H, -H], [0, H], [0, -H], [-H, 0], [H, .5], [H, -.5]]) box(.09, 1.0, .09, x, D + .5, z, rail);
  for (const y of [rh, D + .5]) {
    box(H * 2, .07, .07, 0, y, H, rail); box(H * 2, .07, .07, 0, y, -H, rail); box(.07, .07, H * 2, -H, y, 0, rail);
    box(.07, .07, H - .5, H, y, (H + .5) / 2, rail); box(.07, .07, H - .5, H, y, -(H + .5) / 2, rail);
  }
  const lx = MAST.LADDER_X, ly0 = top, ly1 = D + 1.05;
  for (const z of [-.3, .3]) beam([lx, ly0, z], [lx, ly1, z], .04, '#c9c2b2', 4);
  for (let y = ly0 + .3; y < D - .05; y += .34) box(.05, .05, .6, lx, y, 0, '#c9c2b2');
  for (const y of [ly0 + 2.5, ly0 + 5.5, D - .4]) { box(lx - L1 - .1, .05, .05, (lx + L1) / 2, y, .3, iron); box(lx - L1 - .1, .05, .05, (lx + L1) / 2, y, -.3, iron); }

  // ---- mast pole, lamp hood and roof, pennant arm
  beam([0, D, 0], [0, MAST.LAMP_Y - .45, 0], .11, '#d9d2c2', 8);
  for (const y of [D + 2, D + 4]) box(.3, .06, .3, 0, y, 0, rust); // collar bands
  box(.75, .12, .75, 0, MAST.LAMP_Y - .42, 0, iron);
  for (const [x, z] of [[.3, .3], [.3, -.3], [-.3, .3], [-.3, -.3]]) box(.05, .62, .05, x, MAST.LAMP_Y - .05, z, iron);
  { const roof = new T.ConeGeometry(.6, .55, 8); roof.rotateY(Math.PI / 8); parts.push(tint(T, roof.translate(0, MAST.LAMP_Y + .5, 0), '#b8452f')); }
  box(.04, .04, 1.1, 0, D + 4.6, .55, iron);
  { const flag = new T.BoxGeometry(.02, .32, .5); parts.push(tint(T, flag.translate(0, D + 4.42, 1.0), '#f0c24a')); }

  // ---- keeper's board on the +z rail (dark slate with chalk lines), and a little cabinet beside it
  const bz = BOARD.z;
  box(1.1, .78, .06, BOARD.x, D + 1.45, bz - .02, '#4d6b5e');
  box(1.18, .06, .08, BOARD.x, D + 1.86, bz - .02, '#8a6a48'); box(1.18, .06, .08, BOARD.x, D + 1.04, bz - .02, '#8a6a48');
  for (let i = 0; i < 4; i++) box(.55 + .3 * hash3(i, 9, 1), .03, .01, BOARD.x - .15 + .1 * hash3(i, 9, 2), D + 1.68 - i * .13, bz - .06, '#e8e4d8');
  box(.05, 1.0, .05, BOARD.x - .5, D + 1.4, bz + .02, rail); box(.05, 1.0, .05, BOARD.x + .5, D + 1.4, bz + .02, rail);
  box(.5, .7, .4, 1.55, D + .35, 1.6, '#6c7a74'); box(.3, .08, .04, 1.55, D + .5, 1.39, '#d9a441'); // old radio cabinet

  const geo = merge(T, parts);
  const mat = new T.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .88, metalness: 0, flatShading: true });
  const body = new T.Mesh(geo, mat); body.name = 'mastBody'; body.castShadow = true; body.receiveShadow = true;

  const lampMat = new T.MeshStandardMaterial({ color: '#ffd28a', emissive: '#ffb347', emissiveIntensity: 1.2, roughness: .4 });
  const lamp = new T.Mesh(new T.CylinderGeometry(.22, .22, .5, 10), lampMat);
  lamp.position.y = MAST.LAMP_Y - .1; lamp.name = 'mastLamp'; lamp.castShadow = false; lamp.receiveShadow = false;

  // crates: one geometry (box + darker lid band + two straps), three instances
  const cp = [];
  cp.push(tint(T, new T.BoxGeometry(.72, .5, .55).translate(0, .25, 0), '#a7804f'));
  cp.push(tint(T, new T.BoxGeometry(.76, .08, .59).translate(0, .48, 0), '#6e5233'));
  for (const x of [-.22, .22]) cp.push(tint(T, new T.BoxGeometry(.06, .52, .58).translate(x, .25, 0), '#55606a'));
  const crateGeo = merge(T, cp);
  const crateMat = new T.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .9, metalness: 0, flatShading: true });
  const crates = new T.InstancedMesh(crateGeo, crateMat, CRATES.length);
  crates.name = 'mastCrates'; crates.castShadow = false; crates.receiveShadow = true;
  crates.instanceMatrix.setUsage(T.DynamicDrawUsage);
  for (let i = 0; i < CRATES.length; i++) crates.setColorAt(i, new T.Color(1, 1, 1));

  const group = new T.Group(); group.name = 'beaconMast';
  group.add(body, lamp, crates);
  const m4 = new T.Matrix4(), p3 = new T.Vector3(), s3 = new T.Vector3(), q4 = new T.Quaternion(), white = new T.Color(1, 1, 1), dim = new T.Color(.55, .5, .45);
  // Looted crates squash to an open, darker base. No allocation.
  function setCrates(looted) {
    for (let i = 0; i < CRATES.length; i++) {
      const c = CRATES[i], gone = looted && looted[i] === 1;
      q4.setFromAxisAngle(UP, i * .7 + .3);
      p3.set(c.x, D, c.z); s3.set(1, gone ? .35 : 1, 1);
      crates.setMatrixAt(i, m4.compose(p3, q4, s3)); crates.setColorAt(i, gone ? dim : white);
    }
    crates.instanceMatrix.needsUpdate = true; if (crates.instanceColor) crates.instanceColor.needsUpdate = true;
    crates.computeBoundingSphere();
  }
  setCrates(null);
  function dispose() { geo.dispose(); mat.dispose(); lamp.geometry.dispose(); lampMat.dispose(); crateGeo.dispose(); crateMat.dispose(); crates.dispose?.(); }
  return { group, body, lamp, crates, lampMat, setCrates, dispose };
}
