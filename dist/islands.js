// Islands content module: small islands drift past the raft, dock for a few minutes, and let players
// gather wood, leaves, seeds, stone and sand with E. Host-authoritative; saved in world.ext.islands.
// Design and notes: docs/features/islands.md. Pure logic lives in islands-layout.js (unit tested).
import {
  ISLAND, NODE_MAX, SHORE_U, layoutFor, pathAt, clean, lootFor, groundHeight, nextDelay, dockOffset,
  applyGather, standOnSand, DEFAULTS,
} from './islands-layout.js?build=v3-survival-ae77fa84ac2b';
import { createIslandModels, PALM_H, PALM_BEND } from './islands-models.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { PLAYER_CONSTANTS } from './player-physics.js?build=v3-survival-ae77fa84ac2b';

export * from './islands-layout.js?build=v3-survival-ae77fa84ac2b';

const EYE = PLAYER_CONSTANTS.EYE_OFFSET;
const KINDS = ['palm', 'bush', 'rock', 'sand'];
const KIND_INDEX = { palm: 0, bush: 1, rock: 2, sand: 3 };
const MAX_PER_KIND = [3, 4, 4, 3];
// Pick spheres per kind: centre height above the node base and radius (times node scale). Palms
// instead use a trunk capsule (PALM_PICK_R) plus a small sphere round the coconuts at the crown;
// PICK_Y[0] is only the aim point QA scripts look at (mid trunk).
const PICK_Y = [1.6, .45, .3, .08], PICK_R = [.3, .75, .55, .55];
const PALM_PICK_R = .25; // trunk is ~0.15 m thick at mid height: about 10 cm of slack
// Solid trunks and rocks the player walks around (radius times node scale; 0 = walk through).
const SOLID_R = [.28, 0, .42, 0];
const LOCAL_COOLDOWN = 0.35;
const SLEW_SNAP = 1, SLEW_RATE = 4; // guest clock: snap past 1 s of error, else ease at 4/s

// Prompt text, built once: PROMPTS[kind][left].
const LABEL = { palm: 'Gather palm: wood and leaves', bush: 'Pick from bush: leaves, maybe a seed', rock: 'Gather stone', sand: 'Scoop sand' };
const PROMPTS = {};
for (const k of KINDS) {
  PROMPTS[k] = [];
  for (let left = 0; left <= NODE_MAX[k]; left++) PROMPTS[k][left] = `<kbd>E</kbd>${LABEL[k]} (${left} left)`;
}
const itemName = k => (ITEM_INFO[k] && ITEM_INFO[k].name) || k;

export function createIslands(ctx) {
  const T = ctx.T;
  const st = DEFAULTS();              // {v, clock, next, isl}
  let layout = null;                  // layoutFor(st.isl.seed)
  let warned = false;
  const cool = { host: 0, guest: 0 };
  const gatherState = { isl: null, layout: null, cx: 0, cz: 0, clock: 0, cool };
  const out = { v: 1, clock: 0, next: 0, isl: null }; // cached serialize() object
  const outIsl = { seed: 0, born: 0, dock: 0, side: 1, off: 0, used: null };
  const path = { phase: 'gone', z: 0, left: 0, sink: 0 };

  // Live placement, refreshed in update().
  let shown = false, cx = 0, cz = 0, gy = 0, carryX = NaN, carryZ = NaN;
  const sandState = { onSand: false, lastJump: false };
  let localCool = 0, bounceNode = -1, bounceT = 0, hoverNode = -1, prompted = false;
  let slew = 0;        // guest: host clock minus ours, eased out in tick()
  let ticked = false;  // afterMove already advanced the clock this frame

  // ---------- scene (built once) ----------
  const models = createIslandModels(T, ctx.ocean);
  const group = new T.Group(); group.name = 'islands'; group.visible = false;
  const dome = new T.Mesh(models.geos.dome, models.mats.dome); dome.receiveShadow = true; dome.name = 'islandDome';
  const lagoon = new T.Mesh(models.geos.lagoon, models.mats.lagoon); lagoon.name = 'islandLagoon'; lagoon.frustumCulled = false; lagoon.renderOrder = 1;
  const meshes = KINDS.map((k, i) => {
    const m = new T.InstancedMesh(models.geos[k], models.mats[k], MAX_PER_KIND[i]);
    m.name = 'island-' + k; m.count = 0; m.castShadow = k !== 'sand'; m.receiveShadow = true;
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let j = 0; j < MAX_PER_KIND[i]; j++) m.setColorAt(j, new T.Color(1, 1, 1)); // init instanceColor once (no recompiles later)
    return m;
  });
  // Palms have two extra instanced meshes: the spent (straw, drooped) palm and the coconut cluster.
  const extra = ['palmSpent', 'nuts'].map(k => {
    const m = new T.InstancedMesh(models.geos[k], models.mats[k], MAX_PER_KIND[0]);
    m.name = 'island-' + k; m.count = 0; m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false; // instances swap in after relayout, so a cached bounding sphere would be stale
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let j = 0; j < MAX_PER_KIND[0]; j++) m.setColorAt(j, new T.Color(1, 1, 1));
    return m;
  });
  const [palmSpent, nuts] = extra;
  const veg = [...meshes, ...extra]; // scaled down while the island rises or sinks
  group.add(dome, ...veg);
  if (ctx.scene) { ctx.scene.add(group); ctx.scene.add(lagoon); }
  lagoon.visible = false;

  // Node bookkeeping (sized for MAX_NODES).
  const N = ISLAND.MAX_NODES;
  const nodeKind = new Int8Array(N), nodeInst = new Int8Array(N);
  let nodeCount = 0;

  // ---------- scratch (no per-frame allocation) ----------
  const vO = new T.Vector3(), vD = new T.Vector3(), vP = new T.Vector3(), vS = new T.Vector3(), vN = new T.Vector3();
  const qA = new T.Quaternion(), qB = new T.Quaternion(), mtx = new T.Matrix4(), col = new T.Color();
  const ZERO = new T.Matrix4().makeScale(0, 0, 0);
  const UP = new T.Vector3(0, 1, 0);
  const baseY = () => (ctx.ocean && ctx.ocean.mesh ? ctx.ocean.mesh.position.y : -0.24);
  const waveAt = (x, z) => (ctx.ocean && typeof ctx.ocean.getHeight === 'function' ? ctx.ocean.getHeight(x, z) : baseY());
  const authority = () => ctx.role !== 'guest';

  // Sand height above the island origin at a point relative to its centre (NaN past the rim).
  const localGround = (x, z) => groundHeight(Math.sqrt(x * x + z * z), layout.R, Math.atan2(z, x) - layout.rot);

  function writeNode(k, pulse = 1) {
    const n = layout.nodes[k], ki = nodeKind[k], m = meshes[ki], used = st.isl.used[k], frac = used / n.max;
    let sx = n.s, sy = n.s, sz = n.s, sink = 0;
    if (ki === 1) { const f = 1 - .16 * used; sx *= f; sy *= f; sz *= f; }
    else if (ki === 2) { const f = Math.max(.5, 1 - .17 * used); sx *= f * 1.05; sy *= f * .7; sz *= f * .92; sink = .05; }
    else if (ki === 3) { sy *= Math.max(.12, 1 - .8 * frac); }
    sx *= pulse; sy *= pulse; sz *= pulse;
    // Tilt bushes, rocks and sand to the dome slope; palms grow straight up.
    qA.setFromAxisAngle(UP, n.a);
    if (ki !== 0) {
      const e = .2;
      const gx = (localGround(n.x + e, n.z) - localGround(n.x - e, n.z)) / (2 * e);
      const gz = (localGround(n.x, n.z + e) - localGround(n.x, n.z - e)) / (2 * e);
      vN.set(-gx, 1, -gz).normalize(); qB.setFromUnitVectors(UP, vN); qA.premultiply(qB);
    }
    vP.set(n.x, n.y - sink - (ki === 0 ? .1 : .04), n.z); vS.set(sx, sy, sz);
    mtx.compose(vP, qA, vS);
    if (ki === 0) { // live palm + coconuts, or the spent palm
      const j = nodeInst[k], spent = frac >= 1;
      m.setMatrixAt(j, spent ? ZERO : mtx); nuts.setMatrixAt(j, spent ? ZERO : mtx); palmSpent.setMatrixAt(j, spent ? mtx : ZERO);
      nuts.instanceMatrix.needsUpdate = true; palmSpent.instanceMatrix.needsUpdate = true;
    } else m.setMatrixAt(nodeInst[k], mtx);
    m.instanceMatrix.needsUpdate = true;
    paintNode(k);
  }
  function paintNode(k) {
    const n = layout.nodes[k], ki = nodeKind[k], frac = st.isl.used[k] / n.max;
    const m = ki === 0 && frac >= 1 ? palmSpent : meshes[ki];
    if (frac >= 1) { // spent: the palm has its own straw model; rocks go darker grey; the rest dry and dim
      if (ki === 0) col.setRGB(1, 1, 1); else if (ki === 2) col.setRGB(.66, .67, .69); else col.setRGB(.92, .66, .34);
    } else if (ki === 2) col.setRGB(1 - .14 * frac, 1 - .14 * frac, 1 - .12 * frac);
    else col.setRGB(1 - .12 * frac, 1 - .12 * frac, 1 - .2 * frac);
    if (k === hoverNode && frac < 1) col.multiplyScalar(1.12);
    m.setColorAt(nodeInst[k], col); m.instanceColor.needsUpdate = true;
  }

  function relayout() {
    layout = st.isl ? layoutFor(st.isl.seed) : null;
    hoverNode = -1; bounceNode = -1;
    for (const m of veg) m.count = 0;
    nodeCount = 0;
    if (!layout) return;
    const counts = [0, 0, 0, 0];
    nodeCount = Math.min(N, layout.nodes.length);
    for (let k = 0; k < nodeCount; k++) {
      const ki = KIND_INDEX[layout.nodes[k].kind];
      nodeKind[k] = ki; nodeInst[k] = counts[ki]++;
    }
    for (let i = 0; i < 4; i++) meshes[i].count = Math.min(counts[i], MAX_PER_KIND[i]);
    palmSpent.count = nuts.count = meshes[0].count;
    for (let k = 0; k < nodeCount; k++) writeNode(k);
    for (const m of veg) { m.boundingSphere = null; m.computeBoundingSphere(); }
    // Per-seed sand tint, a few percent either way.
    const tint = (layout.seed % 997) / 997;
    models.mats.dome.color.setRGB(1, .97 + .05 * tint, .94 + .08 * (1 - tint));
    dome.scale.set(layout.R, 1, layout.R); dome.rotation.y = -layout.rot;
    lagoon.scale.set(layout.R, 1, layout.R);
    models.lagoonUniforms.uR.value = layout.R; models.lagoonUniforms.uRot.value = layout.rot;
    warned = false;
  }

  // ---------- placement ----------
  function place() {
    const isl = st.isl;
    if (!isl || !layout) { shown = false; group.visible = lagoon.visible = false; return; }
    pathAt(st.clock - isl.born, isl.dock, layout.dockZ, path);
    if (path.phase === 'gone') { shown = false; group.visible = lagoon.visible = false; return; }
    cx = isl.side * isl.off; cz = path.z;
    const b = baseY();
    gy = b + (waveAt(cx, cz) - b) * .25 - path.sink;
    group.position.set(cx, gy, cz);
    // While rising or sinking, plants shrink with the sink so palm crowns never poke out of open sea.
    const grow = 1 - path.sink / ISLAND.SINK;
    for (let i = 0; i < veg.length; i++) veg[i].scale.setScalar(grow < 1e-3 ? 1e-3 : grow);
    lagoon.position.set(cx, b + .1, cz); // 10 cm up: clears the ocean mesh's ~4 cm interpolation error at grazing angles
    models.lagoonUniforms.uCentre.value.set(cx, cz);
    models.lagoonUniforms.uOpacity.value = 1 - path.sink / ISLAND.SINK;
    shown = group.visible = lagoon.visible = true;
  }
  function groundAt(x, z) { // world y of the sand, or NaN
    if (!shown) return NaN;
    const g = localGround(x - cx, z - cz);
    return g === g ? gy + g : NaN;
  }
  const near = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.z) && (p.x - cx) ** 2 + (p.z - cz) ** 2 < (layout.R + ISLAND.NEAR) ** 2;

  function spawn(seed, t = 0) {
    seed = (Number.isInteger(seed) && seed >= 0 && seed < 4294967296) ? seed : (Math.random() * 4294967296) >>> 0;
    const lay = layoutFor(seed);
    const { side, off } = dockOffset(ctx.world && ctx.world.tiles, lay);
    st.isl = { seed, born: st.clock - Math.max(0, t), dock: ISLAND.DOCK, side, off, used: lay.nodes.map(() => 0) };
    relayout(); place();
    if (t < ISLAND.APPROACH) emitAll('An island is drifting this way. Swim over and take a look!');
  }
  function emitAll(text) { try { ctx.emit({ kind: 'notice', text }, 'all'); } catch {} }

  // ---------- module hooks ----------
  // Advance the clock once per frame. game.js runs afterMove (player physics) before update and sets
  // the camera in between, so afterMove ticks first and places the island where it will be drawn.
  function tick(dt) {
    if (!ctx.running) return;
    st.clock += dt;
    if (slew !== 0) {
      const k = Math.min(1, SLEW_RATE * dt), d = slew * k;
      st.clock += d; slew -= d;
      if (Math.abs(slew) < 1e-4) { st.clock += slew; slew = 0; }
    }
  }
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    if (ticked) ticked = false; else tick(dt);
    if (localCool > 0) localCool -= dt;
    const isl = st.isl;
    if (authority()) {
      if (!isl) {
        if (st.clock >= st.next) spawn();
      } else if (layout) {
        pathAt(st.clock - isl.born, isl.dock, layout.dockZ, path);
        if (path.phase === 'gone') {
          st.isl = null; st.next = st.clock + nextDelay(isl.seed); relayout();
        } else if (path.phase === 'docked') {
          cx = isl.side * isl.off; cz = path.z;
          // Wait while someone is on or right by the island (hard cap DOCK_CAP).
          if (path.left <= ISLAND.WARN + 1 && isl.dock < ISLAND.DOCK_CAP && (near(ctx.physics) || near(ctx.other))) {
            isl.dock = Math.min(ISLAND.DOCK_CAP, isl.dock + dt);
          } else if (path.left <= ISLAND.WARN && !warned) { warned = true; emitAll('The island is starting to drift away'); }
        }
      }
    }
    place();
    if (!shown) { sandState.onSand = false; return; }
    // Gather pop: one instance matrix per frame for a third of a second.
    if (bounceNode >= 0) {
      bounceT -= dt;
      if (bounceT <= 0 || bounceNode >= nodeCount) { const k = bounceNode; bounceNode = -1; if (k < nodeCount) writeNode(k); }
      else writeNode(bounceNode, 1 + Math.sin((1 - bounceT / .3) * Math.PI) * .12);
    }
    if (!prompted && hoverNode >= 0) setHover(-1);
    prompted = false;
  }

  function afterMove(p, dt) {
    if (!(dt > 0)) dt = 0;
    if (!ticked) { tick(dt); ticked = true; }
    place();
    if (!p || !shown) { sandState.onSand = false; sandState.lastJump = !!(p && p._prevJump); carryX = NaN; return; }
    // Ride along while the island glides in to dock. Not while it departs: it slides out from under
    // the player, who stays near the dock spot instead of being carried 50 m out to sea.
    if (sandState.onSand && carryX === carryX && path.phase !== 'depart') { p.x += cx - carryX; p.z += cz - carryZ; }
    carryX = cx; carryZ = cz;
    // Walk around palm trunks and rocks.
    const fx = p.x - cx, fz = p.z - cz;
    if (fx * fx + fz * fz < (layout.R * 1.2) ** 2) {
      for (let k = 0; k < nodeCount; k++) {
        const ki = nodeKind[k], n = layout.nodes[k];
        let r = SOLID_R[ki] * n.s; if (!r) continue;
        if (ki === 2) r *= Math.max(.5, 1 - .17 * st.isl.used[k]);
        r += PLAYER_CONSTANTS.BODY_RADIUS;
        const dx = p.x - (cx + n.x), dz = p.z - (cz + n.z), d2 = dx * dx + dz * dz;
        if (d2 >= r * r || p.y - EYE > gy + n.y + 1.2) continue;
        const d = Math.sqrt(d2) || 1e-4, push = (r - d) / d;
        p.x += dx * push; p.z += dz * push;
      }
    }
    standOnSand(p, groundAt(p.x, p.z), waveAt(p.x, p.z), sandState);
  }

  function serialize() {
    out.clock = st.clock; out.next = st.next;
    const i = st.isl;
    if (!i) out.isl = null;
    else {
      // A copy (the caller may keep or mutate it), reusing two cached objects to stay cheap at ~8 Hz.
      if (!outIsl.used || outIsl.used.length !== i.used.length) outIsl.used = new Array(i.used.length);
      outIsl.seed = i.seed; outIsl.born = i.born; outIsl.dock = i.dock; outIsl.side = i.side; outIsl.off = i.off;
      for (let k = 0; k < i.used.length; k++) outIsl.used[k] = i.used[k];
      out.isl = outIsl;
    }
    return out;
  }

  function load(data, from) {
    const c = clean(data);
    // Saves and restores snap. Guests ('net') ease toward the host clock unless it is over 1 s off, so a
    // late packet does not make the drifting island pop.
    const err = c.clock - st.clock;
    if (from === 'net' && st.isl && c.isl && st.isl.seed === c.isl.seed && Math.abs(err) <= SLEW_SNAP) slew = err;
    else { st.clock = c.clock; slew = 0; }
    st.next = c.next;
    if (!c.isl) { if (st.isl) { st.isl = null; relayout(); } place(); return; }
    if (!st.isl || st.isl.seed !== c.isl.seed || st.isl.used.length !== c.isl.used.length) {
      st.isl = c.isl; relayout();
    } else {
      const isl = st.isl;
      isl.born = c.isl.born; isl.dock = c.isl.dock; isl.side = c.isl.side; isl.off = c.isl.off;
      for (let k = 0; k < isl.used.length; k++) if (isl.used[k] !== c.isl.used[k]) { isl.used[k] = c.isl.used[k]; writeNode(k); }
    }
    pathAt(st.clock - st.isl.born, st.isl.dock, layout.dockZ, path);
    warned = path.phase === 'depart' || (path.phase === 'docked' && path.left <= ISLAND.WARN);
    place();
  }

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || a.kind.slice(0, 8) !== 'islands.') return false;
    if (!authority()) return true;
    if (a.kind !== 'islands.gather') return true;
    const pos = actor === 'guest' ? ctx.other : ctx.physics;
    gatherState.isl = st.isl; gatherState.layout = layout; gatherState.clock = st.clock;
    gatherState.cx = cx; gatherState.cz = cz;
    if (st.isl && layout) { gatherState.cx = st.isl.side * st.isl.off; gatherState.cz = pathAt(st.clock - st.isl.born, st.isl.dock, layout.dockZ, path).z; }
    const r = applyGather(gatherState, a, actor, pos, bag);
    if (r.ok) {
      writeNode(a.node);
      const text = r.loot.map(([k, n]) => `+${n} ${itemName(k)}`).join(', ');
      ctx.emit({ kind: 'loot', text }, actor);
    } else if (r.reason === 'full') ctx.emit({ kind: 'full', text: 'Your bag is full' }, actor);
    else if (r.reason === 'reach') ctx.emit({ kind: 'notice', text: 'Get a little closer' }, actor);
    // 'cooldown' is ignored quietly: a second tap within 0.3 s just does nothing.
    return true;
  }

  // Ray vs segment A-B: squared distance at the closest approach, its ray distance in rayT. No allocation.
  let rayT = 0;
  function raySeg(ax, ay, az, bx, by, bz) {
    const ex = bx - ax, ey = by - ay, ez = bz - az, wx = vO.x - ax, wy = vO.y - ay, wz = vO.z - az;
    const b = vD.x * ex + vD.y * ey + vD.z * ez, c = ex * ex + ey * ey + ez * ez, d = vD.x * wx + vD.y * wy + vD.z * wz, e = ex * wx + ey * wy + ez * wz;
    const den = c - b * b;
    let u = den > 1e-6 ? (e - b * d) / den : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    let t = -d + u * b; if (t < 0) t = 0;
    // re-project the segment point for the clamped t
    u = c > 1e-9 ? ((wx + vD.x * t) * ex + (wy + vD.y * t) * ey + (wz + vD.z * t) * ez) / c : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const qx = wx + vD.x * t - ex * u, qy = wy + vD.y * t - ey * u, qz = wz + vD.z * t - ez * u;
    rayT = t;
    return qx * qx + qy * qy + qz * qz;
  }
  // Nearest gatherable node under the crosshair within reach, or -1. Candidates are ranked by how far
  // off the ray they are (angle), and sand, bushes and rocks win over a palm when both are hit. Palms
  // are a trunk capsule plus a small sphere round the coconuts, so the sky between fronds is not a palm.
  function pickNode(aim) {
    if (!shown || !ctx.camera || !layout) return -1;
    ctx.camera.getWorldPosition(vO);
    if (aim && aim.dir && Number.isFinite(aim.dir.x)) vD.copy(aim.dir).normalize(); else ctx.camera.getWorldDirection(vD);
    let best = -1, bestOff = Infinity, palm = -1, palmOff = Infinity;
    const reach = ISLAND.REACH, reach2 = (reach - .1) ** 2;
    for (let k = 0; k < nodeCount; k++) {
      const n = layout.nodes[k];
      if (st.isl.used[k] >= n.max) continue;
      const ki = nodeKind[k];
      const px = cx + n.x, pz = cz + n.z, py = gy + n.y;
      if ((vO.x - px) ** 2 + (vO.z - pz) ** 2 > reach2) continue;
      if (ki === 0) {
        const s = n.s, ca = Math.cos(n.a), sa = -Math.sin(n.a), by = py - .1;
        const mx = px + ca * PALM_BEND * .25 * s, my = by + PALM_H * .5 * s, mz = pz + sa * PALM_BEND * .25 * s;
        const tx = px + ca * PALM_BEND * s, ty = by + PALM_H * s, tz = pz + sa * PALM_BEND * s;
        let off = Infinity;
        let d2 = raySeg(px, by, pz, mx, my, mz);
        if (d2 <= PALM_PICK_R * PALM_PICK_R && rayT <= reach) off = Math.sqrt(d2) / Math.max(rayT, .3);
        d2 = raySeg(mx, my, mz, tx, ty - .1 * s, tz);
        if (d2 <= PALM_PICK_R * PALM_PICK_R && rayT <= reach) off = Math.min(off, Math.sqrt(d2) / Math.max(rayT, .3));
        d2 = raySeg(tx, ty - .17 * s, tz, tx, ty - .17 * s, tz); // coconut sphere
        if (d2 <= (.25 * s) ** 2 && rayT <= reach) off = Math.min(off, Math.sqrt(d2) / Math.max(rayT, .3));
        if (off < palmOff) { palmOff = off; palm = k; }
        continue;
      }
      const ox = vO.x - px, oy = vO.y - (py + PICK_Y[ki] * n.s), oz = vO.z - pz, rr = PICK_R[ki] * n.s;
      const b = ox * vD.x + oy * vD.y + oz * vD.z, c = ox * ox + oy * oy + oz * oz - rr * rr, disc = b * b - c;
      if (disc < 0) continue;
      let t = -b - Math.sqrt(disc);
      if (t < 0) { if (c > 0) continue; t = 0; } // behind us (unless we are inside the sphere)
      if (t > reach) continue;
      const perp2 = c + rr * rr - b * b, off = Math.sqrt(perp2 > 0 ? perp2 : 0) / Math.max(-b, .3);
      if (off < bestOff) { bestOff = off; best = k; }
    }
    return best >= 0 ? best : palm;
  }
  function setHover(k) {
    if (k === hoverNode) return;
    const old = hoverNode; hoverNode = k;
    if (old >= 0 && old < nodeCount) paintNode(old);
    if (k >= 0) paintNode(k);
  }

  function prompt(aim) {
    prompted = true;
    const k = pickNode(aim);
    setHover(k);
    if (k < 0) return null;
    const n = layout.nodes[k];
    return PROMPTS[n.kind][n.max - st.isl.used[k]];
  }

  function interact(aim) {
    const k = pickNode(aim);
    if (k < 0) return false;
    if (localCool > 0) return true;
    if (ctx.action({ kind: 'islands.gather', seed: st.isl.seed, node: k }) === false) return true; // not sent
    localCool = LOCAL_COOLDOWN;
    bounceNode = k; bounceT = .3;
    return true;
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    if (lagoon.parent) lagoon.parent.remove(lagoon);
    for (const m of veg) m.dispose?.();
    models.dispose();
  }

  // ---------- QA helpers (raftDebug.content.islands) ----------
  const debug = {
    spawnNear(seed = 1234, t = ISLAND.APPROACH) { if (!authority()) return false; spawn(seed >>> 0, t); return debug.phase(); },
    phase() {
      if (!st.isl || !layout) return { phase: 'calm', t: 0, left: Math.max(0, st.next - st.clock), seed: null, clock: st.clock, next: st.next };
      const p = pathAt(st.clock - st.isl.born, st.isl.dock, layout.dockZ, {});
      return { phase: p.phase, t: st.clock - st.isl.born, left: p.left, seed: st.isl.seed, clock: st.clock, next: st.next, x: st.isl.side * st.isl.off, z: p.z, R: layout.R };
    },
    skip(seconds = 0) { if (Number.isFinite(seconds) && seconds > 0) st.clock += seconds; update(0); return debug.phase(); },
    teleportAshore(dx = 0, dz = 0) {
      const p = ctx.physics; if (!p || !shown) return false;
      const x = cx + dx, z = cz + dz, g = groundAt(x, z); if (!(g === g)) return false;
      p.x = x; p.z = z; p.y = g + EYE; p.vx = p.vy = p.vz = 0; p.verticalSpeed = 0; p.grounded = true; p.swimming = false;
      sandState.onSand = true; carryX = cx; carryZ = cz; return true;
    },
    // Stand a short step from node i on its inland side. Returns the node (with its pick centre `cy`)
    // and `yaw`, the camera yaw that faces it (scripts turn the view with a mouse drag).
    aimAt(i = 0, dist) {
      if (!shown || !(i >= 0 && i < nodeCount)) return null;
      const n = layout.nodes[i], ki = nodeKind[i];
      const d = dist ?? [2.6, 2.1, 1.9, 1.7][ki];
      const r = Math.hypot(n.x, n.z), ux = r > .3 ? -n.x / r : 1, uz = r > .3 ? -n.z / r : 0;
      if (!debug.teleportAshore(n.x + ux * d, n.z + uz * d)) return null;
      const out = debug.nodes()[i];
      out.yaw = Math.atan2(ux, uz); // forward = (-sin yaw, -cos yaw) points back along -u to the node
      return out;
    },
    // Camera yaw from the local player toward the island centre.
    yawTo() { const p = ctx.physics; return p && shown ? Math.atan2(-(cx - p.x), -(cz - p.z)) : null; },
    nodes() {
      if (!layout || !st.isl) return [];
      // (ax, cy, az): a point on the node to aim at. For a palm that is on the bent trunk, not above its base.
      const bend = (PICK_Y[0] / PALM_H) ** 2 * PALM_BEND;
      return layout.nodes.map((n, i) => {
        const palm = nodeKind[i] === 0, ox = palm ? Math.cos(n.a) * bend * n.s : 0, oz = palm ? -Math.sin(n.a) * bend * n.s : 0;
        return { i, kind: n.kind, used: st.isl.used[i], max: n.max, x: cx + n.x, y: gy + n.y, z: cz + n.z, cy: gy + n.y + PICK_Y[nodeKind[i]] * n.s, ax: cx + n.x + ox, az: cz + n.z + oz };
      });
    },
    drain() { if (!st.isl) return false; st.isl.used.forEach((_, k) => { st.isl.used[k] = layout.nodes[k].max; writeNode(k); }); return true; },
    clear() { st.isl = null; st.next = st.clock + ISLAND.CALM_MIN; relayout(); place(); return debug.phase(); },
    state: () => ({ onSand: sandState.onSand, shown, cx, cz, gy, hover: hoverNode }),
    pick: () => pickNode(null), // node under the camera centre, or -1
    groundAt,
  };

  return { name: 'islands', update, afterMove, serialize, load, action, interact, prompt, debug, dispose };
}
