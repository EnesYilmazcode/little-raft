// Islands content module: small islands stay put on the seabed like Raft's. One spawns ahead of the raft's
// travel every few minutes and the world drifting past brings it closer: steer (sail, paddle) and drop anchor
// to stay, or drift past. Players gather leaves, seeds, stone and sand with E, and chop palms for wood with a
// Stone Axe. Host-authoritative; saved in world.ext.islands.
// Design and notes: docs/features/islands.md. Pure logic lives in islands-layout.js (unit tested).
import {
  ISLAND, NODE_MAX, SHORE_U, layoutFor, clean, lootFor, groundHeight, nextDelay, dockOffset,
  applyGather, standOnSand, DEFAULTS, CHOP, isAxe, spawnRel, islandRel, shouldDespawn, phaseAt, wrapGround,
} from './islands-layout.js?build=v3-survival-ae77fa84ac2b';
import { SAIL } from './sailing-core.js?build=v3-survival-ae77fa84ac2b';
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

// Prompt text, built once: PROMPTS[kind][left]. Palms need a Stone Axe (LMB chops, E works too).
const LABEL = { palm: 'Chop palm', bush: 'Pick from bush: leaves, maybe a seed, a flower or berries', /* [juicer] */ rock: 'Gather stone', sand: 'Scoop sand' };
const PROMPTS = {};
for (const k of KINDS) {
  PROMPTS[k] = [];
  for (let left = 0; left <= NODE_MAX[k]; left++) PROMPTS[k][left] = k === 'palm' ? `<kbd>LMB</kbd>${LABEL[k]} (${left} left)` : `<kbd>E</kbd>${LABEL[k]} (${left} left)`;
}
const NEED_AXE = 'Need a Stone Axe';
const itemName = k => (ITEM_INFO[k] && ITEM_INFO[k].name) || k;

// Read-only view of the live island for sibling modules (treasure.js). Import this file with the same
// ?build= specifier content.js uses, or a second module instance is loaded and this stays null.
// Returns one cached object (do not keep or mutate it) or null when no island is shown.
let live = null;
export function islandNow() { return live ? live() : null; }

export function createIslands(ctx) {
  const T = ctx.T;
  const st = DEFAULTS();              // {v, clock, next, isl: {seed, born, bx, bz, used, end?}}
  let layout = null;                  // layoutFor(st.isl.seed)
  let warned = false;                 // local "your raft is drifting away" notice given for this island
  const cool = { host: 0, guest: 0 };
  const gatherState = { isl: null, layout: null, cx: 0, cz: 0, clock: 0, cool };
  const out = { v: 2, clock: 0, next: 0, isl: null }; // cached serialize() object
  const outIsl = { seed: 0, born: 0, bx: 0, bz: 0, used: null };
  const path = { phase: 'gone', sink: 0 };
  const rel = { x: 0, z: 0 }, gnd = { x: 0, z: 0 }, ahead = { x: 0, z: 0 };
  const blocker = { x: 0, z: 0, r: 0 }; // grounding blocker handed to sailing-world (raft-relative)
  let blockerOwner = null, lastGx = NaN, lastGz = NaN, dgx = 0, dgz = 0;

  // Live placement, refreshed in update().
  let shown = false, cx = 0, cz = 0, gy = 0, carryX = NaN, carryZ = NaN;
  const sandState = { onSand: false, lastJump: false };
  let localCool = 0, chopCool = 0, bounceNode = -1, bounceT = 0, hoverNode = -1, prompted = false;
  // Selected bag slot of the local player (the stub ctx in tests has no bag): its index and raw kind.
  const heldSlot = () => { try { const b = ctx.localBag && ctx.localBag(); const i = b ? b.selectedIndex : -1; return b && b.slots && b.slots[i] ? i : -1; } catch { return -1; } };
  const holdingAxe = () => { const i = heldSlot(); return i >= 0 && isAxe(ctx.localBag().slots[i].kind); };
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
  // Seabed offset: the sailing display offset (what the scenery is drawn with), else the synced world state
  // (tests, or before sailing exists), else 0.
  function ground(o) {
    const s = ctx.sailing;
    if (s && typeof s.groundOffset === 'function') return s.groundOffset(o);
    const w = ctx.world && ctx.world.sailing;
    o.x = w && Number.isFinite(w.gx) ? w.gx : 0; o.z = w && Number.isFinite(w.gz) ? w.gz : 0;
    return o;
  }
  // Seabed step since the last call (the raft's travel over the seabed; 0 while anchored).
  function trackGround() {
    ground(gnd);
    if (lastGx === lastGx) { dgx = wrapGround(gnd.x - lastGx); dgz = wrapGround(gnd.z - lastGz); } else dgx = dgz = 0;
    lastGx = gnd.x; lastGz = gnd.z;
  }
  // Hand our blocker to the live sailing module (once per instance) and keep it on the island's shore.
  function updateBlocker() {
    const s = ctx.sailing;
    if (s && s !== blockerOwner && typeof s.addBlocker === 'function') { s.addBlocker(blocker); blockerOwner = s; }
    if (s && typeof s.markIsland === 'function') s.markIsland(shown && path.phase !== 'sink' ? cx : NaN, cz); // compass marker
    if (!shown || path.phase !== 'here') { blocker.r = 0; return; }
    blocker.x = cx; blocker.z = cz;
    blocker.r = layout.R * SHORE_U * 1.05 + (s && typeof s.blockerClear === 'function' ? s.blockerClear() : 6);
  }
  function place() {
    const isl = st.isl;
    if (!isl || !layout) { shown = false; group.visible = lagoon.visible = false; return; }
    phaseAt(isl, st.clock, path);
    if (path.phase === 'gone') { shown = false; group.visible = lagoon.visible = false; return; }
    ground(gnd); islandRel(isl, gnd.x, gnd.z, rel);
    cx = rel.x; cz = rel.z;
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

  // A new island at raft-relative (rx, rz), t seconds old. Stored on the seabed: base = offset + relative.
  function spawnAt(seed, rx, rz, t) {
    const lay = layoutFor(seed);
    ground(gnd);
    st.isl = { seed, born: st.clock - Math.max(0, t), bx: wrapGround(gnd.x + rx), bz: wrapGround(gnd.z + rz), used: lay.nodes.map(() => 0) };
    relayout(); place();
  }
  const pickSeed = seed => ((Number.isInteger(seed) && seed >= 0 && seed < 4294967296) ? seed : (Math.random() * 4294967296) >>> 0);
  // The real spawn: SPAWN_MIN..SPAWN_MAX m ahead of the raft's travel over the seabed (sail + current), a
  // seeded 20-40 m to one side. The first island of a fresh world comes FIRST_MIN..FIRST_MAX ahead: that is
  // the one whose countdown is still the fresh-world ISLAND.FIRST (later countdowns are clock + >= CALM_MIN).
  function spawn(seed) {
    seed = pickSeed(seed);
    const s = ctx.world && ctx.world.sailing;
    const vx = s && Number.isFinite(s.vx) ? s.vx : 0, vz = s && Number.isFinite(s.vz) ? s.vz : 0;
    spawnRel(seed, vx + SAIL.CURRENT_X, vz + SAIL.CURRENT_Z, ahead, st.next === ISLAND.FIRST);
    spawnAt(seed, ahead.x, ahead.z, 0);
    emitAll('Land ahead! Steer for it and drop anchor to stay');
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
    if (chopCool > 0) chopCool -= dt;
    trackGround();
    const isl = st.isl;
    if (authority()) {
      if (!isl) {
        if (st.clock >= st.next) spawn();
      } else if (layout) {
        phaseAt(isl, st.clock, path);
        if (path.phase === 'gone') {
          st.isl = null; st.next = st.clock + nextDelay(isl.seed); relayout();
        } else if (path.phase !== 'sink') {
          islandRel(isl, gnd.x, gnd.z, rel); cx = rel.x; cz = rel.z;
          // Left behind (or far off): sink and go, unless someone is on or right by it.
          if (shouldDespawn(rel.x, rel.z, dgx, dgz) && !near(ctx.physics) && !near(ctx.other)) isl.end = st.clock;
        }
      }
    }
    place();
    updateBlocker();
    if (!shown) { sandState.onSand = false; return; }
    // Standing on the island while the raft drifts off: say so once.
    if (!warned && sandState.onSand && cx * cx + cz * cz > (layout.R + 20) ** 2 && (dgx || dgz)) {
      warned = true; try { ctx.notice?.('Your raft is drifting away from the island!'); } catch {}
    }
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
    // Stay on the island while the world (and the island with it) moves past the raft. A big jump means a
    // re-placement (load, new island), not motion: no carry then.
    if (sandState.onSand && carryX === carryX && (cx - carryX) ** 2 + (cz - carryZ) ** 2 < 4) { p.x += cx - carryX; p.z += cz - carryZ; }
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
      outIsl.seed = i.seed; outIsl.born = i.born; outIsl.bx = i.bx; outIsl.bz = i.bz;
      if (Number.isFinite(i.end)) outIsl.end = i.end; else delete outIsl.end;
      for (let k = 0; k < i.used.length; k++) outIsl.used[k] = i.used[k];
      out.isl = outIsl;
    }
    return out;
  }

  function load(data, from) {
    // v1 saves migrate against the synced seabed state (not the smoothed display, which may lag a fresh load).
    const ws = ctx.world && ctx.world.sailing;
    const c = clean(data, layoutFor, ws && Number.isFinite(ws.gx) ? ws : null);
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
      isl.born = c.isl.born; isl.bx = c.isl.bx; isl.bz = c.isl.bz;
      if (c.isl.end !== undefined) isl.end = c.isl.end; else delete isl.end;
      for (let k = 0; k < isl.used.length; k++) if (isl.used[k] !== c.isl.used[k]) { isl.used[k] = c.isl.used[k]; writeNode(k); }
    }
    place();
  }

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || a.kind.slice(0, 8) !== 'islands.') return false;
    if (!authority()) return true;
    if (a.kind !== 'islands.gather' && a.kind !== 'islands.chop') return true;
    const pos = actor === 'guest' ? ctx.other : ctx.physics;
    gatherState.isl = st.isl; gatherState.layout = layout; gatherState.clock = st.clock;
    gatherState.cx = cx; gatherState.cz = cz;
    if (st.isl && layout) { ground(gnd); islandRel(st.isl, gnd.x, gnd.z, rel); gatherState.cx = rel.x; gatherState.cz = rel.z; }
    const r = applyGather(gatherState, a, actor, pos, bag);
    if (r.ok) {
      writeNode(a.node);
      if (r.loot.length) {
        const text = r.loot.map(([k, n]) => `+${n} ${itemName(k)}`).join(', ');
        const loot = {}; for (const [k, n] of r.loot) loot[k] = (loot[k] || 0) + n;
        ctx.emit({ kind: 'loot', text, loot }, actor);
      }
      if (r.felled) ctx.emit({ kind: 'notice', text: 'Timber! The palm comes down', sound: 'collect' }, actor);
      if (r.broke) ctx.emit({ kind: 'notice', text: 'Your Stone Axe broke!' }, actor);
    } else if (r.reason === 'full') ctx.emit({ kind: 'full', text: 'Your bag is full' }, actor);
    else if (r.reason === 'axe') ctx.emit({ kind: 'notice', text: NEED_AXE }, actor);
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
    if (n.kind === 'palm' && !holdingAxe()) return NEED_AXE;
    return PROMPTS[n.kind][n.max - st.isl.used[k]];
  }

  // One chop at palm k with the held axe (local side: cooldown, swing sound, pop; the host decides the rest).
  function chop(k) {
    if (chopCool > 0) return false;
    const i = heldSlot();
    if (i < 0 || !isAxe(ctx.localBag().slots[i].kind)) return false;
    chopCool = CHOP.COOLDOWN;
    if (!(ctx.localBag().slots[i].durability > 0)) { ctx.notice?.('This axe is worn out'); return true; }
    if (k < 0) return true; // a swing at the air
    if (ctx.action({ kind: 'islands.chop', seed: st.isl.seed, node: k, slot: i }) === false) return true; // not sent
    try { ctx.play?.('chop', 1); } catch {}
    bounceNode = k; bounceT = .3;
    return true;
  }
  const palmAt = aim => { const k = pickNode(aim); return k >= 0 && nodeKind[k] === 0 ? k : -1; };
  // LMB with a bag item (content hook): the Stone Axe swings and chops the palm under the crosshair.
  function use(aim, kind) {
    if (kind !== 'axe') return false;
    return chop(palmAt(aim));
  }

  function interact(aim) {
    const k = pickNode(aim);
    if (k < 0) return false;
    if (nodeKind[k] === 0) { // palms: chop with the axe, or say what is missing
      if (holdingAxe()) chop(k); else if (localCool <= 0) { localCool = LOCAL_COOLDOWN; ctx.notice?.(NEED_AXE); }
      return true;
    }
    if (localCool > 0) return true;
    if (ctx.action({ kind: 'islands.gather', seed: st.isl.seed, node: k }) === false) return true; // not sent
    localCool = LOCAL_COOLDOWN;
    bounceNode = k; bounceT = .3;
    return true;
  }

  function dispose() {
    if (live === mine) live = null;
    blocker.r = 0; try { blockerOwner?.markIsland?.(NaN, NaN); } catch {} // no stale grounding blocker or compass marker
    if (group.parent) group.parent.remove(group);
    if (lagoon.parent) lagoon.parent.remove(lagoon);
    for (const m of veg) m.dispose?.();
    models.dispose();
  }

  // ---------- live accessor (islandNow) ----------
  const now = { seed: 0, cx: 0, cz: 0, gy: 0, R: 0, rot: 0, phase: 'gone', onSand: false, hover: -1, groundAt };
  function mine() {
    if (!shown || !st.isl || !layout) return null;
    now.seed = st.isl.seed; now.cx = cx; now.cz = cz; now.gy = gy; now.R = layout.R; now.rot = layout.rot;
    now.phase = path.phase; now.onSand = sandState.onSand; now.hover = hoverNode;
    return now;
  }
  live = mine;

  // ---------- QA helpers (raftDebug.content.islands) ----------
  const debug = {
    // QA: an island a short swim from the raft (the clearer side, 10-13 m from the deck), t seconds old.
    spawnNear(seed = 1234, t = ISLAND.RISE + 1) {
      if (!authority()) return false;
      seed = seed >>> 0;
      const lay = layoutFor(seed), { side, off } = dockOffset(ctx.world && ctx.world.tiles, lay);
      spawnAt(seed, side * off, lay.dockZ, t); return debug.phase();
    },
    // QA: the real spawn (ahead of the raft's travel), as if the calm had just ended.
    spawnAhead(seed) { if (!authority()) return false; spawn(seed === undefined ? undefined : seed >>> 0); return debug.phase(); },
    phase() {
      if (!st.isl || !layout) return { phase: 'calm', t: 0, left: Math.max(0, st.next - st.clock), seed: null, clock: st.clock, next: st.next };
      const p = phaseAt(st.isl, st.clock, {}), r = islandRel(st.isl, ground(gnd).x, gnd.z, {});
      return { phase: p.phase, t: st.clock - st.isl.born, left: 0, seed: st.isl.seed, clock: st.clock, next: st.next, x: r.x, z: r.z, dist: Math.hypot(r.x, r.z), R: layout.R, bx: st.isl.bx, bz: st.isl.bz };
    },
    blocker: () => ({ ...blocker }),
    // QA: drop (true) or raise (false) the anchor through the normal sail action, to check an island holds still.
    anchor(on = true) { return ctx.action({ kind: 'sail', op: on ? 'anchor' : 'unanchor' }) !== false; },
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

  return { name: 'islands', update, afterMove, serialize, load, action, interact, prompt, use, debug, dispose };
}
