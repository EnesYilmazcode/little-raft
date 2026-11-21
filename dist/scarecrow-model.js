// Scarecrow model (see docs/specs/scarecrow.md section 5). Given THREE, imports nothing.
// Local origin = centre of the floor tile top (game.js places decor at y = .22). Our own cozy design:
// a bleached driftwood post on a plank cross foot, a crossbar with two rag strips per arm, a palm-leaf
// skirt, a burlap sack head with a painted shell smile, and a floppy bucket hat made from the plastic.
// The static parts are one merged vertex-coloured mesh; only the rag groups (ragL, ragR) move.

export const HAT_TOP_Y = 1.75; // keep in sync with HAT_TOP in scarecrow.js (gulls sit here)
const ARM_Y = 1.25, ARM_LEN = .85, HEAD_Y = 1.4, HEAD_R = .16;

// Merge a list of [geometry, hex, matrix] into one non-indexed geometry with a colour attribute.
function bake(T, parts) {
  const geos = [];
  let n = 0;
  for (const [geo, hex, m4] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    if (m4) g.applyMatrix4(m4);
    const c = new T.Color(hex), cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    geos.push(g); n += cnt;
  }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count; g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('color', new T.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

function kit(T) {
  const parts = [], q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), s = new T.Vector3();
  // rotation order YXZ: tilt (x) first, then turn (y), so leaves tilt out along their own facing
  const add = (geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    e.set(rx, ry, rz, 'YXZ'); q.setFromEuler(e); p.set(x, y, z); s.set(sx, sy, sz);
    parts.push([geo, hex, new T.Matrix4().compose(p, q, s)]);
  };
  return { parts, add };
}

// A plane strip hanging down from y = 0 to y = -len, narrowing to `tip` of its width at the bottom.
function strip(T, w, len, tip) {
  const g = new T.PlaneGeometry(w, len, 1, 2); g.translate(0, -len / 2, 0);
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) { const f = -a.getY(i) / len; a.setX(i, a.getX(i) * (1 - (1 - tip) * f)); }
  g.computeVertexNormals();
  return g;
}

export function createScarecrow3D(T) {
  const g = new T.Group(); g.name = 'craft_scarecrow';
  const { parts, add } = kit(T);
  // plank cross foot
  add(new T.BoxGeometry(.5, .05, .1), '#a98a5f', 0, .025, 0);
  add(new T.BoxGeometry(.1, .05, .5), '#9a7b52', 0, .03, 0, 0, 0, 0, 1, 1.05, 1);
  add(new T.BoxGeometry(.12, .06, .12), '#8d7350', 0, .07, 0);
  // bleached driftwood post: a slightly bent chain of boxes, grey-brown at the tip
  add(new T.BoxGeometry(.085, .56, .08), '#cdbb9a', 0, .33, 0, 0, 0, .025);
  add(new T.BoxGeometry(.08, .46, .075), '#c8b593', -.012, .83, 0, 0, 0, -.03);
  add(new T.BoxGeometry(.07, .26, .07), '#9e8e73', .002, 1.18, 0, 0, 0, .02);
  // crossbar, with a little lashing of rope
  add(new T.BoxGeometry(ARM_LEN, .06, .06), '#cdbb9a', 0, ARM_Y, 0, 0, 0, .02);
  add(new T.BoxGeometry(.1, .075, .075), '#b89b6a', 0, ARM_Y, 0, 0, Math.PI / 4, 0);
  for (const sx of [-1, 1]) add(new T.BoxGeometry(.035, .07, .07), '#9e8e73', sx * (ARM_LEN / 2 - .02), ARM_Y + sx * .008, 0);
  // palm-leaf skirt: 8 tapered leaves from 1.0 down to .45, tilted out 15 degrees
  add(new T.CylinderGeometry(.07, .07, .05, 8), '#5a9a40', 0, 1.0, 0);
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + .2;
    add(strip(T, .2, .55, .35), k % 2 ? '#5a9a40' : '#6fae4f', Math.sin(a) * .06, 1.0, Math.cos(a) * .06, -15 * Math.PI / 180, a, 0);
  }
  // burlap sack head with button eyes and a painted shell smile (5 little white discs)
  add(new T.SphereGeometry(HEAD_R, 10, 8), '#d8c08e', 0, HEAD_Y, 0, 0, 0, 0, 1, .95, 1);
  add(new T.CylinderGeometry(.045, .06, .05, 8), '#c4a874', 0, HEAD_Y - HEAD_R + .01, 0); // tied neck
  const onFace = (x, y) => Math.sqrt(Math.max(0, HEAD_R * HEAD_R - x * x - (y - HEAD_Y) * (y - HEAD_Y))) * .99;
  for (const sx of [-1, 1]) { const x = sx * .055, y = HEAD_Y + .03; add(new T.SphereGeometry(.02, 6, 4), '#3a2c22', x, y, onFace(x, y) - .004); }
  for (let k = -2; k <= 2; k++) {
    const x = k * .032, y = HEAD_Y - .045 + .007 * k * k, z = onFace(x, y);
    add(new T.CylinderGeometry(.012, .012, .012, 6), '#fbf6ea', x, y, z, Math.PI / 2 - (y - HEAD_Y) * 4, Math.atan2(x, z), 0);
  }
  // floppy bucket hat: wide thin brim, slightly squashed crown, top at HAT_TOP_Y
  add(new T.CylinderGeometry(.25, .26, .025, 14), '#e07a4f', 0, 1.545, 0, .07, 0, .03);
  add(new T.CylinderGeometry(.125, .15, .17, 12), '#e07a4f', 0, HAT_TOP_Y - .085, 0, 0, 0, 0, 1, 1, .9);
  add(new T.CylinderGeometry(.152, .152, .03, 12), '#c4623a', 0, 1.585, 0, 0, 0, 0, 1, 1, .9); // hat band
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0, flatShading: true, side: T.DoubleSide });
  const body = new T.Mesh(bake(T, parts), mat); body.name = 'scarecrowBody'; body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // rags: two thin strips per arm end, pivoting at the crossbar
  const rags = [];
  for (const [name, sx] of [['ragL', -1], ['ragR', 1]]) {
    const r = new T.Group(); r.name = name; r.position.set(sx * (ARM_LEN / 2 - .05), ARM_Y - .02, 0);
    const k2 = kit(T);
    k2.add(strip(T, .06, .3, .6), sx < 0 ? '#8fb8d8' : '#e8d6a8', -.025, 0, .035, 0, 0, .05);
    k2.add(strip(T, .05, .24, .5), sx < 0 ? '#e8d6a8' : '#8fb8d8', .03, 0, .035, 0, 0, -.06);
    const m = new T.Mesh(bake(T, k2.parts), mat); m.castShadow = true; r.add(m);
    g.add(r); rags.push(r);
  }
  g.userData.rags = rags;
  return g;
}

/** Rag flutter: k = 1 normally, 1.8 in the rain. No allocations. */
export function swayRags(g, t, k = 1) {
  const r = g && g.userData && g.userData.rags; if (!r) return;
  const L = r[0], R = r[1];
  L.rotation.z = .25 * k * Math.sin(t * 2.1); L.rotation.x = .06 * k * Math.sin(t * 5.3);
  R.rotation.z = -.25 * k * Math.sin(t * 2.1 + 1.3); R.rotation.x = .06 * k * Math.sin(t * 5.3 + 2);
}
