// [bait] Shark Bait: hold it, left click to lob it into the sea. While it floats (BAIT.DURATION s) the shark leaves
// the raft and swimmers alone and circles / bites the bait instead (dist/shark.js lureStep). Our own take on the
// survival classic's bait; recipe in items.js (2 rope + 2 raw fish).
//
// Three parts:
//   - pure rules (no THREE, no DOM): createBaitState, throwBait, stepBait, syncLure, baitNet (tests/bait.test.mjs)
//   - createBaitModel(T): original low-poly lure (two fish lashed to a driftwood stick with a red cork float),
//     one merged vertex-coloured geometry
//   - attachBait(ctx): game.js glue. Host/solo simulate the bait and steer the shark; a co-op guest sends a
//     'bait:throw' action and renders the bait from 4 numbers riding on the shark pose (shark.setNetExtra/netTail).
// The bait is not saved: an active bait is dropped on reload or hot swap (the shark simply resumes circling).
import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b'; // same specifier as content.js: one shared instance

export const BAIT = Object.freeze({
  KIND: 'sharkbait', DURATION: 80, SPEED: 8.5, LOFT: 0.45, GRAVITY: 9.8, DECK_Y: 0.35, WATER_Y: 0,
  FLIGHT_MAX: 4, MAX_RANGE: 90, EDGE_OFF: 2.4, COOLDOWN: 0.6, ORIGIN_SLACK: 4,
});
export const BAIT_STAGE = Object.freeze({ none: 0, flying: 1, floating: 2 });
const fin = v => typeof v === 'number' && Number.isFinite(v);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ------------------------------------------------------------------ rules (pure)

export function createBaitState() { return { stage: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, left: 0, t: 0 }; }

// Lob a bait from (ox, oy, oz) along (dx, dy, dz) (need not be unit). A new throw replaces a bait already out.
export function throwBait(b, ox, oy, oz, dx, dy, dz) {
  if (![ox, oy, oz, dx, dy, dz].every(fin)) return false;
  const l = Math.hypot(dx, dy, dz); if (l < 1e-6) return false;
  const s = BAIT.SPEED / l;
  b.x = ox; b.y = oy; b.z = oz; b.vx = dx * s; b.vy = dy * s + BAIT.SPEED * BAIT.LOFT; b.vz = dz * s;
  b.stage = BAIT_STAGE.flying; b.left = BAIT.DURATION; b.t = 0;
  return true;
}
function onTile(tiles, x, z) {
  const tx = Math.round(x / 2), tz = Math.round(z / 2);
  for (let i = 0; i < tiles.length; i++) if (tiles[i][0] === tx && tiles[i][1] === tz) return true;
  return false;
}
function hasTile(tiles, x, z) { for (let i = 0; i < tiles.length; i++) if (tiles[i][0] === x && tiles[i][1] === z) return true; return false; }
// Moves the bait to the open water just off the nearest raft edge (it landed on, or drifted onto, the deck).
function pushOff(b, tiles) {
  let bd = Infinity, px = b.x, pz = b.z;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    for (let k = 0; k < 4; k++) {
      const a = N4[k][0], c = N4[k][1];
      if (hasTile(tiles, t[0] + a, t[1] + c)) continue;
      const x = t[0] * 2 + a * BAIT.EDGE_OFF, z = t[1] * 2 + c * BAIT.EDGE_OFF, d = Math.hypot(x - b.x, z - b.z);
      if (d < bd) { bd = d; px = x; pz = z; }
    }
  }
  b.x = px; b.z = pz;
}
// Advances the bait. Returns 0, 1 when it just landed in the water, 2 when it was just used up (or drifted off).
export function stepBait(b, dt, tiles, flowX = 0, flowZ = 0) {
  if (!(dt > 0) || b.stage === 0) return 0;
  const tl = Array.isArray(tiles) ? tiles : [];
  if (b.stage === BAIT_STAGE.flying) {
    dt = Math.min(dt, 0.1); b.t += dt;
    b.vy -= BAIT.GRAVITY * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    const deck = b.y <= BAIT.DECK_Y && onTile(tl, b.x, b.z);
    if (deck || b.y <= BAIT.WATER_Y || b.t >= BAIT.FLIGHT_MAX) {
      if (deck || onTile(tl, b.x, b.z)) pushOff(b, tl); // a short throw onto the deck rolls off the nearest edge
      b.y = BAIT.WATER_Y; b.vx = b.vy = b.vz = 0; b.stage = BAIT_STAGE.floating; b.t = 0;
      return 1;
    }
    return 0;
  }
  b.t += dt; b.left -= dt;
  b.x += (fin(flowX) ? flowX : 0) * dt; b.z += (fin(flowZ) ? flowZ : 0) * dt; // drifts with the water past a sailing raft
  if (onTile(tl, b.x, b.z)) pushOff(b, tl);
  if (b.left <= 0 || Math.hypot(b.x, b.z) > BAIT.MAX_RANGE) { b.stage = 0; b.left = 0; return 2; }
  return 0;
}
export const baitFloating = b => b.stage === BAIT_STAGE.floating;
// A floating bait on (or drifted onto) a docked island's sand rolls back out to sea, far enough past the
// waterline that the shark's LURE circle stays in the water, and past any raft tiles in the way (a docked raft
// sits right off the shore). isl: {cx, cz, R, groundAt(x, z) -> y | NaN}.
export function offIsland(b, isl, tiles = null, clear = 2.6) {
  if (!baitFloating(b) || !isl || !(isl.R > 0) || typeof isl.groundAt !== 'function') return false;
  const wet = y => !(y === y) || y < BAIT.WATER_Y - 0.15;
  if (wet(isl.groundAt(b.x, b.z))) return false;
  let dx = b.x - isl.cx, dz = b.z - isl.cz, l = Math.hypot(dx, dz);
  if (l < 1e-3) { dx = 1; dz = 0; l = 1; }
  const tl = Array.isArray(tiles) ? tiles : [], ux = dx / l, uz = dz / l;
  let r = l;
  while (r < l + isl.R + 30 && !wet(isl.groundAt(isl.cx + ux * r, isl.cz + uz * r))) r += 0.5;
  r += clear;
  let crossed = false;
  while (r < l + isl.R + 90 && onTile(tl, isl.cx + ux * r, isl.cz + uz * r)) { r += 0.25; crossed = true; }
  if (crossed) r += BAIT.EDGE_OFF - 1; // as far off the raft edge as pushOff puts it
  b.x = isl.cx + ux * r; b.z = isl.cz + uz * r;
  return true;
}
// Writes the shark's lure target ({active, x, z}) from the bait. Only a floating bait attracts the shark.
export function syncLure(b, lure) {
  if (!lure) return;
  lure.active = baitFloating(b); lure.x = b.x; lure.z = b.z;
}
// Compact co-op state [stage, x, y, z] (into out, no allocation).
export function baitNet(b, out) {
  out[0] = b.stage; out[1] = Math.round(b.x * 100) / 100; out[2] = Math.round(b.y * 100) / 100; out[3] = Math.round(b.z * 100) / 100;
  return out;
}

// ------------------------------------------------------------------ model

// Original low-poly lure, ~0.75 m long: a driftwood stick with a red-and-white cork float at one end and two
// fish lashed along it with rope. One merged geometry with vertex colours (1 draw call). Origin at the waterline.
export function createBaitModel(T) {
  const parts = [];
  const col = (g, hex) => {
    const c = new T.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(a, 3));
    if (g.index) g = g.toNonIndexed();
    g.deleteAttribute('uv');
    parts.push(g); return g;
  };
  // stick along X
  const stick = new T.CylinderGeometry(0.022, 0.028, 0.78, 6, 1); stick.rotateZ(Math.PI / 2); stick.translate(-0.02, 0.03, 0); col(stick, 0x8a6440);
  const nub = new T.CylinderGeometry(0.012, 0.018, 0.12, 5, 1); nub.rotateZ(Math.PI / 2 + 0.6); nub.translate(-0.2, 0.07, 0.01); col(nub, 0x7a5636);
  // cork float: red cap over a white belly
  const floatTop = new T.IcosahedronGeometry(0.1, 0); floatTop.scale(1, 0.75, 1); floatTop.translate(0.37, 0.07, 0); col(floatTop, 0xd8452f);
  const floatBand = new T.CylinderGeometry(0.096, 0.08, 0.05, 7, 1); floatBand.translate(0.37, 0.0, 0); col(floatBand, 0xf1ead8);
  // two fish hung either side of the stick, heads toward the float
  for (const side of [-1, 1]) {
    const body = new T.OctahedronGeometry(1, 0); body.scale(0.17, 0.065, 0.05); body.translate(-0.04, 0.015, side * 0.075); col(body, side > 0 ? 0x6f93a8 : 0x8aa0a8);
    const belly = new T.OctahedronGeometry(1, 0); belly.scale(0.12, 0.035, 0.042); belly.translate(-0.02, -0.02, side * 0.075); col(belly, 0xe6ece6);
    const tail = new T.ConeGeometry(0.06, 0.1, 4, 1); tail.rotateZ(-Math.PI / 2); tail.scale(1, 1, 0.35); tail.translate(-0.25, 0.015, side * 0.075); col(tail, 0x4f6f80);
    const eye = new T.OctahedronGeometry(0.014, 0); eye.translate(0.09, 0.03, side * 0.117); col(eye, 0x1c1c1c);
  }
  // rope lashings round stick + fish
  for (const x of [-0.13, 0.06]) {
    const r = new T.TorusGeometry(0.09, 0.013, 4, 8); r.rotateY(Math.PI / 2); r.scale(1, 0.75, 1.05); r.translate(x, -0.01, 0); col(r, 0xd9c38c);
  }
  const geo = mergeGeometries(T, parts);
  for (const g of parts) g.dispose();
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  const mat = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new T.Mesh(geo, mat); mesh.name = 'sharkBait'; mesh.castShadow = false; mesh.receiveShadow = false;
  return mesh;
}

// ------------------------------------------------------------------ game glue

// ctx: {T, scene, ocean, camera(), world(), role(), shark(), localBag(), physics(), other(), flow() -> {x, z},
//       action(a), emit(e, to), notice(text), beep(f), setSwing(v), elapsed()}
export function attachBait(ctx) {
  const { T } = ctx;
  const b = createBaitState(), out = [0, 0, 0, 0], shown = { stage: 0, x: 0, y: 0, z: 0 };
  const camPos = new T.Vector3(), camDir = new T.Vector3();
  const mesh = createBaitModel(T); mesh.scale.setScalar(1.35); mesh.visible = false; ctx.scene.add(mesh); // a bit larger than life so it reads from the deck
  let lastThrow = -Infinity, spin = 0, lastGuest = 0;
  const guest = () => ctx.role() === 'guest';

  /** LMB with Shark Bait held. Returns true when the click was handled. */
  function use(kind) {
    if (kind !== BAIT.KIND) return false;
    const now = ctx.elapsed();
    if (now - lastThrow < BAIT.COOLDOWN) return true;
    const cam = ctx.camera(); if (!cam) return true;
    lastThrow = now;
    cam.getWorldPosition(camPos); cam.getWorldDirection(camDir);
    const r = v => Math.round(v * 100) / 100;
    ctx.setSwing?.(1); ctx.beep?.(240);
    ctx.action({ kind: 'bait:throw', o: [r(camPos.x), r(camPos.y), r(camPos.z)], d: [r(camDir.x), r(camDir.y), r(camDir.z)] });
    return true;
  }
  /** Host: 'bait:throw' from host or guest. Returns true when the action was a bait action. */
  function apply(a, actor, bag) {
    if (!a || a.kind !== 'bait:throw') return false;
    if (!bag || !(bag.count(BAIT.KIND) > 0)) return true;
    const o = Array.isArray(a.o) && a.o.length === 3 && a.o.every(fin) ? a.o : null, d = Array.isArray(a.d) && a.d.length === 3 && a.d.every(fin) ? a.d : null;
    if (!o || !d) return true;
    const p = actor === 'guest' ? ctx.other() : ctx.physics();
    if (p && fin(p.x) && fin(p.z) && Math.hypot(o[0] - p.x, o[2] - p.z) > BAIT.ORIGIN_SLACK) return true; // throw from where you stand
    if (actor === 'guest') { const now = ctx.elapsed(); if (now - lastGuest < BAIT.COOLDOWN * 0.8) return true; lastGuest = now; }
    if (!throwBait(b, o[0], Math.min(o[1], 6), o[2], d[0], d[1], d[2])) return true;
    bag.remove(BAIT.KIND, 1);
    return true;
  }
  function render(dt, t) {
    mesh.visible = shown.stage !== 0;
    if (!mesh.visible) return;
    const ocean = ctx.ocean;
    if (shown.stage === BAIT_STAGE.flying) {
      spin += dt * 9;
      mesh.position.set(shown.x, shown.y, shown.z); mesh.rotation.set(spin * 0.3, spin, 0.4);
      return;
    }
    const h = ocean ? ocean.getHeight(shown.x, shown.z) : 0, s = ctx.shark(), v = s && s.view;
    const nip = v && v.anim > 0 && Math.hypot(v.x - shown.x, v.z - shown.z) < 2.6 ? v.anim : 0; // the shark is snapping at it
    mesh.position.set(shown.x, h + 0.03 + Math.sin(t * 2.1) * 0.025 - nip * 0.12, shown.z);
    mesh.rotation.set(Math.sin(t * 1.3) * 0.12 + nip * Math.sin(t * 40) * 0.25, t * 0.15, Math.sin(t * 1.7 + 1) * 0.1);
  }
  /** Every frame (host before shark.update): steps the bait, steers the shark, renders. */
  function update(dt, t, active = true) {
    const shark = ctx.shark();
    if (!active) { mesh.visible = false; return; }
    if (!guest()) {
      const f = ctx.flow ? ctx.flow() : null, w = ctx.world();
      const ev = stepBait(b, dt, w && w.tiles, f ? f.x : 0, f ? f.z : 0);
      offIsland(b, islandNow(), w && w.tiles); // never floats on the sand (the shark would swim through the island)
      if (ev === 1) { ctx.emit?.({ kind: 'notice', text: 'The shark smells the bait' }, 'all'); shark?.fx?.('lure', b.x, b.z); }
      if (shark) { syncLure(b, shark.lure); shark.setNetExtra?.(baitNet(b, out)); }
      shown.stage = b.stage; shown.x = b.x; shown.y = b.y; shown.z = b.z;
    } else {
      const n = shark && shark.netTail;
      const stage = n && fin(n[0]) ? Math.max(0, Math.min(2, n[0] | 0)) : 0;
      if (stage !== shown.stage || stage === BAIT_STAGE.flying) { shown.x = n ? n[1] : 0; shown.y = n ? n[2] : 0; shown.z = n ? n[3] : 0; }
      else if (n) { const k = Math.min(1, dt * 6); shown.x += (n[1] - shown.x) * k; shown.z += (n[3] - shown.z) * k; }
      shown.stage = stage;
    }
    render(dt, t);
  }
  function clear() { b.stage = 0; b.left = 0; const s = ctx.shark(); if (s) { syncLure(b, s.lure); s.setNetExtra?.(null); } }
  function dispose() { clear(); mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); }
  const debug = () => ({ stage: ['none', 'flying', 'floating'][shown.stage], left: Math.round(b.left * 10) / 10, x: shown.x, y: shown.y, z: shown.z, visible: mesh.visible });
  // QA: drop a floating bait at (x, z) (host / solo)
  function place(x, z, left = BAIT.DURATION) { if (guest() || !fin(x) || !fin(z)) return false; b.stage = BAIT_STAGE.floating; b.x = x; b.z = z; b.y = 0; b.left = left; b.t = 0; return true; }
  return { use, apply, update, clear, dispose, debug, place, get state() { return b; }, mesh };
}
