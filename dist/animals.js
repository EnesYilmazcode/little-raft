// Raft animals v1: the Puffhen (see docs/specs/raft-animals.md). A Nest Box decor lures a Puffhen that
// hops around the deck near its box, lays eggs and sometimes drops a feather. Never hungry, never leaves.
// Slice: world.ext.animals (host-authoritative, actions 'animals.*'). Wander is a closed-form plan of the
// synced clock, seed, born and deck layout, so no positions are ever sent. 3 draw calls (5 while goats live), no per-frame allocations.
// The Bramblegoat (docs/specs/goats.md) lives on a Hay Corner, wades up the raft edge, and gives a Pail of Milk to a held Wooden Pail.
import {
  MAX_ANIMALS, BEAT, TILE, REACH, FULL_AT, cleanAnimals, cleanName, buildGraph, homeDist, plan, pose, newPlan,
  tick, feed, pet, collect, lure, rename, rnd, findId, findHome, lureAt,
  MAX_SLOTS, SPECIES, milk, edgeStart, GOAT_BEAT, GOAT_HOP_T, ARRIVE_GOAT_T, gone, kindCount,
} from './animals-core.js?build=v3-survival-ae77fa84ac2b';
import { puffhenGeometry, eggGeometry, heartGeometry, nestBoxModel, cushionModel, vertexMaterial, goatBodyGeometry, goatHeadGeometry, goatPenModel, GOAT_NECK } from './animals-models.js?build=v3-survival-ae77fa84ac2b';

const FLOOR_Y = .2, DECOR_Y = .22, BOX_LIFT = .18, BIRD_R = .24, BIRD_CY = .18, BOX_R = .4, BOX_CY = .3;
const EGG_SLOTS = [[-.11, .05], [.1, .07], [0, -.1]], EGG_Y = .24;
const HEART_T = 1.2, ARRIVE_T = 2, GRILL_EVERY = 2, CACHE_EVERY = 5, SIG_EVERY = 1, PRUNE_EVERY_FRAMES = 30;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const isInt = Number.isInteger;
const round = v => Math.round(v);
const FOOD_NAME = { seed: 'Palm Seed', leaf: 'Leaf' };
const GOAT_FOOD_NAME = { leaf: 'Palm Leaf', seaweed: 'Seaweed' };
const GOAT_R = .34, GOAT_CY = .3, PEN_R = .45, PEN_CY = .3, GOAT_LIFT = .03, GOAT_CAP = SPECIES.goat.cap, EAT_T = 2.5;
const TAU = Math.PI * 2;
const REASON_KIND = { full: 'notice' };

export function createAnimals(ctx) {
  const T = ctx.T;
  let st = cleanAnimals(undefined, null);
  let clock = 0, gotNet = false, lastR = -1;
  let cache = null, cacheR = -1, cacheAt = -1e9;
  let built = false, group = null, birds = null, eggs = null, heart = null, birdMat = null, heartMat = null, goats = null, goatHeads = null;
  let ui = null, uiLoading = null, disposed = false;
  // graph
  let graph = null, tilesRef = null, decorRef = null, piecesRef = null, tilesLen = -1, decorLen = -1, piecesLen = -1, grillSig = 0, grillTimer = 0, pruneDecorRef = null, pruneDecorLen = -1;
  let worldSigV = 0, sigTimer = 0, pruneSig = 0, pruneTick = 0;
  const homeIdx = new Int32Array(MAX_SLOTS).fill(-1), dists = new Array(MAX_SLOTS).fill(null), beatOf = new Int32Array(MAX_SLOTS).fill(-1);
  const plans = Array.from({ length: MAX_SLOTS }, newPlan), slotId = new Array(MAX_SLOTS).fill(null);
  const p = { x: 0, z: 0, yaw: 0, hop: 0, moving: false, f: 0, lift: 0 };
  const yawNow = new Float32Array(MAX_SLOTS), lastPos = new Float32Array(MAX_SLOTS * 3), shown = new Uint8Array(MAX_SLOTS);
  const squishAt = new Float64Array(MAX_SLOTS).fill(-1e9), eatAt = new Float64Array(MAX_SLOTS).fill(-1e9);
  const inst = new Int8Array(MAX_SLOTS), edgeX = new Float32Array(MAX_SLOTS), edgeZ = new Float32Array(MAX_SLOTS); // instance in its species mesh; wade-in start (raft metres)
  const henShown = new Uint8Array(MAX_ANIMALS), goatShown = new Uint8Array(GOAT_CAP);
  let tileKeys = new Set();
  let heartSlot = -1, heartAge = HEART_T, local = 0; // local: wall clock for local-only effects
  // scratch
  const v3 = T ? new T.Vector3() : null, vO = T ? new T.Vector3() : null, vD = T ? new T.Vector3() : null, sc = T ? new T.Vector3() : null;
  const q = T ? new T.Quaternion() : null, qY = T ? new T.Quaternion() : null, qX = T ? new T.Quaternion() : null, m4 = T ? new T.Matrix4() : null;
  const mN = T ? new T.Matrix4() : null, mH = T ? new T.Matrix4() : null, eH = T ? new T.Euler(0, 0, 0, 'YXZ') : null, qH = T ? new T.Quaternion() : null;
  const zero = T ? new T.Matrix4().makeScale(0, 0, 0) : null, UP = T ? new T.Vector3(0, 1, 0) : null, RIGHT = T ? new T.Vector3(1, 0, 0) : null, FWD = T ? new T.Vector3(0, 0, 1) : null;
  const hit = { type: null, i: -1, x: 0, z: 0 };

  const isHost = () => ctx.role !== 'guest';
  const bump = () => { st.r++; };
  const hasGrill = (x, z) => ctx.hasGrill?.(x, z) ?? false;
  const decorAt = (x, z) => { const d = ctx.world?.decor; if (!Array.isArray(d)) return null; for (let i = 0; i < d.length; i++) if (d[i].x === x && d[i].z === z) return d[i].type; return null; };
  const emit = (e, to) => { try { ctx.emit(e, to); } catch (err) { console.warn('animals emit failed', err); } };

  // ------------------------------------------------------------------ graph

  function grillSignature() {
    const tl = ctx.world?.tiles; let s = 0;
    if (Array.isArray(tl)) for (let i = 0; i < tl.length; i++) { const t = tl[i]; if (hasGrill(t[0], t[1])) s += (t[0] * 73856093) ^ (t[1] * 19349663); }
    return s;
  }
  // Order-independent content hash of the walk inputs (no allocations). Guests get fresh world arrays at 8 Hz and a
  // same-length decor swap keeps refs and lengths, so refs/lengths alone are not enough.
  const strH = s => { let h = 0; if (typeof s === 'string') for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h; };
  const mix = (a, b, c) => { let h = Math.imul((a | 0) ^ 0x27d4eb2d, 0x9e3779b1) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35); h ^= h >>> 15; return Math.imul(h, 0x2c1b3c6d); };
  function decorSig(d) { let s = 0; if (Array.isArray(d)) for (let i = 0; i < d.length; i++) { const e = d[i]; if (e) s = (s + mix(e.x, e.z, strH(e.type))) | 0; } return s; }
  function worldSig(w) {
    let s = decorSig(w.decor);
    const tl = w.tiles; if (Array.isArray(tl)) for (let i = 0; i < tl.length; i++) { const t = tl[i]; if (Array.isArray(t)) s = (s + mix(t[0], t[1], 0x51ed27)) | 0; }
    const pc = w.pieces; if (Array.isArray(pc)) for (let i = 0; i < pc.length; i++) { const q = pc[i]; if (q && q.l === 0) s = (s + mix(q.i, q.j, strH(q.t) + (q.r & 1) + (q.o === 1 ? 0x2f1 : 0) + 0x3c6ef3)) | 0; } // [buildpack] an open gate re-plans the walk graph
    return s;
  }
  function rebuildGraph() {
    const w = ctx.world;
    graph = buildGraph(w?.tiles, w?.decor, w?.pieces, hasGrill);
    tileKeys = new Set(); if (Array.isArray(w?.tiles)) for (const t of w.tiles) if (Array.isArray(t)) tileKeys.add(t[0] + ',' + t[1]);
    rehome();
  }
  function rehome() { // per-animal home index + distance field, instance index and wade-in start; forces a re-plan
    let nh = 0, ng = 0;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const a = st.list[i]; beatOf[i] = -1; slotId[i] = a ? a.id : null;
      if (a) inst[i] = a.kind === 'goat' ? ng++ : nh++;
      if (a && a.kind === 'goat') {
        const e = edgeStart(tileKeys, a.home[0], a.home[1]), dx = Math.sign(e[0] - a.home[0]), dz = Math.sign(e[1] - a.home[1]);
        edgeX[i] = TILE * e[0] - dx * TILE * .52; edgeZ[i] = TILE * e[1] - dz * TILE * .52; // just inside the deck edge
      }
      if (!a || !graph) { homeIdx[i] = -1; continue; }
      const h = graph.index.get(a.home[0] + ',' + a.home[1]);
      homeIdx[i] = h !== undefined && graph.box[h] === SPECIES[a.kind].code ? h : -1;
      dists[i] = homeDist(graph, homeIdx[i], dists[i]);
    }
  }
  function refreshGraph(dt) {
    const w = ctx.world; if (!w) return;
    const tl = Array.isArray(w.tiles) ? w.tiles.length : 0, dl = Array.isArray(w.decor) ? w.decor.length : 0, pl = Array.isArray(w.pieces) ? w.pieces.length : 0;
    const moved = w.tiles !== tilesRef || w.decor !== decorRef || w.pieces !== piecesRef || tl !== tilesLen || dl !== decorLen || pl !== piecesLen;
    let dirty = !graph;
    grillTimer -= dt;
    if (grillTimer <= 0) { grillTimer = GRILL_EVERY; const s = grillSignature(); if (s !== grillSig) { grillSig = s; dirty = true; } }
    sigTimer -= dt;
    if (moved || sigTimer <= 0 || dirty) {
      sigTimer = SIG_EVERY;
      tilesRef = w.tiles; decorRef = w.decor; piecesRef = w.pieces; tilesLen = tl; decorLen = dl; piecesLen = pl;
      const s = worldSig(w); if (s !== worldSigV) { worldSigV = s; dirty = true; }
    }
    if (!dirty) return;
    rebuildGraph();
  }
  function pruneHomes() { // host: animals and lures whose nest box is gone leave quietly
    const d = ctx.world?.decor, dl = Array.isArray(d) ? d.length : -1;
    if (d === pruneDecorRef && dl === pruneDecorLen && --pruneTick > 0) return;
    pruneTick = PRUNE_EVERY_FRAMES;
    if (!Array.isArray(d)) { pruneDecorRef = d; pruneDecorLen = dl; return; }
    const sig = decorSig(d);
    if (d === pruneDecorRef && dl === pruneDecorLen && sig === pruneSig) return;
    pruneDecorRef = d; pruneDecorLen = dl; pruneSig = sig;
    const before = st.list.length + st.lures.length;
    const next = cleanAnimals(st, d);
    if (next.list.length + next.lures.length !== before) { next.r = st.r; st = next; bump(); rehome(); }
  }

  // ------------------------------------------------------------------ rendering

  function build() {
    group = new T.Group(); group.name = 'animals';
    birdMat = vertexMaterial(T);
    birds = new T.InstancedMesh(puffhenGeometry(T), birdMat, MAX_ANIMALS); birds.name = 'puffhens';
    eggs = new T.InstancedMesh(eggGeometry(T), birdMat, MAX_ANIMALS * 3); eggs.name = 'puffEggs';
    goats = new T.InstancedMesh(goatBodyGeometry(T), birdMat, GOAT_CAP); goats.name = 'bramblegoats';
    goatHeads = new T.InstancedMesh(goatHeadGeometry(T), birdMat, GOAT_CAP); goatHeads.name = 'bramblegoatHeads';
    for (const m of [birds, eggs, goats, goatHeads]) { m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.frustumCulled = false; m.castShadow = true; for (let i = 0; i < m.count; i++) m.setMatrixAt(i, zero); }
    heartMat = new T.MeshBasicMaterial({ color: 0xff7d9c, transparent: true, opacity: 0, depthWrite: false });
    heart = new T.Mesh(heartGeometry(T), heartMat); heart.name = 'puffHeart'; heart.visible = false; heart.renderOrder = 3;
    group.add(birds, eggs, goats, goatHeads, heart);
    ctx.scene.add(group);
    built = true;
  }

  function toWorld(x, y, z) { v3.set(x, y, z); const r = ctx.raft; if (r) v3.applyMatrix4(r.matrixWorld); return v3; }
  function raftQuat(yaw, pitch, roll) {
    if (ctx.raft) q.copy(ctx.raft.quaternion); else q.identity();
    qY.setFromAxisAngle(UP, yaw); q.multiply(qY);
    if (pitch) { qX.setFromAxisAngle(RIGHT, pitch); q.multiply(qX); }
    if (roll) { qX.setFromAxisAngle(FWD, roll); q.multiply(qX); }
    return q;
  }

  function renderAnimals() {
    let nh = 0, ng = 0;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const a = st.list[i];
      if (!a) { shown[i] = 0; continue; }
      if (slotId[i] !== a.id) rehome();
      if (a.kind === 'goat') { renderGoat(i, a); ng++; } else { renderHen(i, a); nh++; }
    }
    for (let k = nh; k < MAX_ANIMALS; k++) if (henShown[k]) { birds.setMatrixAt(k, zero); henShown[k] = 0; }
    for (let k = ng; k < GOAT_CAP; k++) if (goatShown[k]) { goats.setMatrixAt(k, zero); goatHeads.setMatrixAt(k, zero); goatShown[k] = 0; }
    birds.instanceMatrix.needsUpdate = true; goats.instanceMatrix.needsUpdate = true; goatHeads.instanceMatrix.needsUpdate = true;
  }

  function renderHen(i, a) {
    {
      const life = clock - a.born;
      let x = TILE * a.home[0], z = TILE * a.home[1], lift = 1, hop = 0, yaw = yawNow[i], moving = false, f = 0, idle = -1, beat = 0;
      const h = homeIdx[i];
      if (h >= 0 && life >= ARRIVE_T) {
        beat = Math.max(0, Math.floor(life / BEAT));
        const u = life - beat * BEAT;
        if (beat !== beatOf[i]) { plan(a.seed, beat, graph, dists[i], h, plans[i]); beatOf[i] = beat; }
        pose(plans[i], graph, a.seed, beat, u, p);
        x = p.x; z = p.z; lift = p.lift; hop = p.hop; moving = p.moving; f = p.f;
        if (!plans[i].n) idle = plans[i].idle;
        // turn smoothly toward the pose yaw
        let dy = p.yaw - yaw; dy -= Math.PI * 2 * Math.round(dy / (Math.PI * 2));
        yaw += dy * Math.min(1, (moving ? 12 : 4) * frameDt);
      }
      yawNow[i] = yaw;
      let sy = 1, sxz = 1, pitch = 0, roll = 0, look = 0, yOff = 0;
      if (moving) { sy = 1 - .12 * Math.cos(Math.PI * 2 * 3 * f); sxz = 1 / Math.sqrt(sy); }
      else if (idle === 0) { const ph = rnd(a.seed, beat) * 2.3, c = (clock + ph) % 2.3; if (c < .6) pitch = Math.abs(Math.sin(c * 9)) * .35; }
      else if (idle === 1) roll = Math.sin(clock * 5) * .12 * Math.max(0, Math.sin(clock * .9));
      else if (idle === 2) look = Math.sin(clock * 1.3 + a.seed % 7) * .6;
      if (life < ARRIVE_T) { // flutter down from the sky
        const k = Math.max(0, life) / ARRIVE_T, s = k * k * (3 - 2 * k);
        yOff = 6 * (1 - s); const w = 1 + .12 * Math.sin(clock * 34) * (1 - s); sxz *= w; sy /= w;
      }
      const sq = local - squishAt[i];
      if (sq >= 0 && sq < 1) { const s = 1 - .25 * Math.exp(-8 * sq) * (1 - sq); sy *= s; sxz /= Math.sqrt(s); }
      const wp = toWorld(x, FLOOR_Y + .08 * hop + BOX_LIFT * lift + yOff, z);
      lastPos[i * 3] = wp.x; lastPos[i * 3 + 1] = wp.y; lastPos[i * 3 + 2] = wp.z;
      sc.set(sxz, sy, sxz);
      m4.compose(wp, raftQuat(yaw + look, pitch, roll), sc);
      birds.setMatrixAt(inst[i], m4); henShown[inst[i]] = 1; shown[i] = 1;
    }
  }

  function renderGoat(i, a) { // walks with a gentle bob and sway (no hop); wades up the raft edge on arrival
    const life = clock - a.born, h = homeIdx[i], hx = TILE * a.home[0], hz = TILE * a.home[1];
    let x = hx, z = hz, y = FLOOR_Y + GOAT_LIFT, yaw = yawNow[i], moving = false, f = 0, idle = -1, u = 0, sxz = 1, sy = 1;
    let roll = 0, hp = 0, hy = 0, turn = 4, target = yaw;
    if (life < ARRIVE_GOAT_T) {
      const ex = edgeX[i], ez = edgeZ[i];
      target = Math.atan2(hx - ex, hz - ez);
      if (life < 1.2) { // climb out of the water at the deck edge with a little shake
        const k = Math.max(0, life) / 1.2, s = k * k * (3 - 2 * k);
        x = ex; z = ez; y = -.35 + (FLOOR_Y + GOAT_LIFT + .35) * s; sxz *= 1 + .06 * Math.sin(clock * 30); yaw = target;
      } else { // then walk straight to the pen
        const k = (life - 1.2) / (ARRIVE_GOAT_T - 1.2), s = k * k * (3 - 2 * k), steps = Math.max(1, Math.round(Math.hypot(hx - ex, hz - ez) / TILE));
        x = ex + (hx - ex) * s; z = ez + (hz - ez) * s; moving = k < 1; f = (s * steps) % 1; turn = 12;
      }
    } else if (h >= 0) {
      const wl = life - ARRIVE_GOAT_T, beat = Math.max(0, Math.floor(wl / GOAT_BEAT));
      u = wl - beat * GOAT_BEAT;
      if (beat !== beatOf[i]) { plan(a.seed, beat, graph, dists[i], h, plans[i]); beatOf[i] = beat; }
      pose(plans[i], graph, a.seed, beat, u, p, GOAT_HOP_T);
      x = p.x; z = p.z; moving = p.moving; f = p.f; target = p.yaw; turn = moving ? 12 : 4;
      if (!plans[i].n) idle = plans[i].idle;
    }
    let dy = target - yaw; dy -= TAU * Math.round(dy / TAU);
    yaw += dy * Math.min(1, turn * frameDt);
    yawNow[i] = yaw;
    const w = Math.sin(TAU * 2 * f);
    if (moving) { y += .015 * Math.abs(w); roll = w * .05; hp = .08 * w; }
    else if (idle === 0 && u >= 1 && u < 4) hp = .55 + .12 * Math.sin(clock * 10); // graze and chew
    else if (idle === 1) roll = .06 * Math.sin(clock * 7);
    else if (idle === 2) hy = .7 * Math.sin(clock * 1.1 + a.seed % 7);
    if (local - eatAt[i] < EAT_T) { hp = .55 + .12 * Math.sin(local * 10); hy = 0; } // munching what you gave it
    const sq = local - squishAt[i];
    if (sq >= 0 && sq < 1) { const s = 1 - .12 * Math.exp(-8 * sq) * (1 - sq); sy *= s; sxz /= Math.sqrt(s); }
    const wp = toWorld(x, y, z);
    lastPos[i * 3] = wp.x; lastPos[i * 3 + 1] = wp.y; lastPos[i * 3 + 2] = wp.z;
    sc.set(sxz, sy, sxz);
    m4.compose(wp, raftQuat(yaw, 0, roll), sc);
    const k = inst[i];
    goats.setMatrixAt(k, m4);
    eH.set(hp, hy, 0); qH.setFromEuler(eH);
    mN.makeTranslation(GOAT_NECK[0], GOAT_NECK[1], GOAT_NECK[2]); mH.makeRotationFromQuaternion(qH); mN.multiply(mH);
    mH.multiplyMatrices(m4, mN);
    goatHeads.setMatrixAt(k, mH); goatShown[k] = 1; shown[i] = 1;
  }

  function renderEggs() {
    let nh = 0;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const a = st.list[i];
      if (!a || a.kind === 'goat') continue;
      nh++;
      for (let j = 0; j < 3; j++) {
        const k = inst[i] * 3 + j;
        if (j >= a.eggs) { eggs.setMatrixAt(k, zero); continue; }
        const s = EGG_SLOTS[j], wp = toWorld(TILE * a.home[0] + s[0], EGG_Y, TILE * a.home[1] + s[1]);
        sc.set(1, 1, 1);
        m4.compose(wp, raftQuat(j * 1.9, .25 * (j - 1), .2 * (j % 2 ? 1 : -1)), sc);
        eggs.setMatrixAt(k, m4);
      }
    }
    for (let k = nh * 3; k < MAX_ANIMALS * 3; k++) eggs.setMatrixAt(k, zero);
    eggs.instanceMatrix.needsUpdate = true;
  }

  function renderHeart(dt) {
    if (heartSlot < 0 || heartAge >= HEART_T || !st.list[heartSlot]) { heart.visible = false; return; }
    heartAge += dt;
    const k = Math.min(1, heartAge / HEART_T), i = heartSlot;
    heart.visible = true;
    heart.position.set(lastPos[i * 3], lastPos[i * 3 + 1] + (st.list[i].kind === 'goat' ? .75 : .5) + .6 * k, lastPos[i * 3 + 2]);
    if (ctx.camera) heart.quaternion.copy(ctx.camera.quaternion);
    heart.scale.setScalar(.8 + .4 * Math.min(1, k * 4));
    heartMat.opacity = k < .7 ? .95 : .95 * (1 - (k - .7) / .3);
  }

  let frameDt = 0;
  function update(dt) {
    const d = fin(dt) && dt > 0 ? Math.min(dt, 1) : 0;
    frameDt = d; local += d;
    if (isHost()) {
      if (ctx.running) {
        pruneHomes();
        st.t = Math.min(1e9, st.t + d);
        step(d);
      }
      clock = st.t;
    } else clock += d;
    if (!built) { if (!T || !ctx.scene) return; build(); }
    const any = st.list.length > 0;
    let anyHen = false, anyGoat = false;
    for (let i = 0; i < st.list.length; i++) if (st.list[i].kind === 'goat') anyGoat = true; else anyHen = true;
    birds.visible = eggs.visible = anyHen;
    goats.visible = goatHeads.visible = anyGoat;
    if (!any) { heart.visible = false; for (let i = 0; i < MAX_SLOTS; i++) shown[i] = 0; return; } // nothing to draw or wander
    refreshGraph(d);
    renderAnimals(); renderEggs(); renderHeart(d);
  }
  function step(d) { // host: one production tick, then arrivals and lays
    const res = tick(st, d, Math.random);
    if (res.arrived.length) {
      for (const id of res.arrived) {
        const a = findId(st, id);
        if (a) emit({ kind: 'build', text: a.kind === 'goat' ? `A Bramblegoat climbed aboard! Say hi to ${a.name}` : `A Puffhen settled in! Say hi to ${a.name}` }, 'all');
      }
      rehome();
    }
    if (res.laid.length || res.arrived.length || res.ready.length) bump();
  }

  // ------------------------------------------------------------------ picking

  function camRay(aim) {
    const cam = ctx.camera; if (!cam) return false;
    cam.getWorldPosition(vO);
    if (aim && aim.dir && fin(aim.dir.x)) vD.copy(aim.dir).normalize(); else cam.getWorldDirection(vD);
    return true;
  }
  function sphere(cx, cy, cz, r, best) { // ray distance to a sphere, or Infinity
    const ox = vO.x - cx, oy = vO.y - cy, oz = vO.z - cz;
    const b = ox * vD.x + oy * vD.y + oz * vD.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
    if (disc < 0) return Infinity;
    let t = -b - Math.sqrt(disc);
    if (t < 0) { if (c > 0) return Infinity; t = 0; }
    return t < best ? t : Infinity;
  }
  function pick(aim) {
    hit.type = null; hit.i = -1;
    if (!built || !camRay(aim)) return null;
    let best = REACH;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const a = st.list[i];
      if (!a || !shown[i]) continue;
      const goat = a.kind === 'goat';
      const t = sphere(lastPos[i * 3], lastPos[i * 3 + 1] + (goat ? GOAT_CY : BIRD_CY), lastPos[i * 3 + 2], goat ? GOAT_R : BIRD_R, best);
      if (t < best) { best = t; hit.type = goat ? 'goat' : 'bird'; hit.i = i; }
    }
    const goatI = hit.type === 'goat' ? hit.i : -1; // a goat in its open Hay Corner keeps the aim (feed/pet/milk); rename via the pen when it wanders
    const dec = ctx.world?.decor;
    if (Array.isArray(dec)) for (let k = 0; k < dec.length; k++) {
      const d = dec[k]; if (d.type !== 'nestbox' && d.type !== 'goatpen') continue;
      const pen = d.type === 'goatpen';
      const wp = toWorld(TILE * d.x, FLOOR_Y + (pen ? PEN_CY : BOX_CY), TILE * d.z);
      const t = sphere(wp.x, wp.y, wp.z, pen ? PEN_R : BOX_R, best);
      if (t < best) { best = t; hit.type = pen ? 'pen' : 'box'; hit.x = d.x; hit.z = d.z; hit.i = -1; }
    }
    if (hit.type === 'pen' && goatI >= 0) { // only its own corner: an empty or other pen in front of a goat keeps the aim
      const h = st.list[goatI].home;
      if (h[0] === hit.x && h[1] === hit.z) { hit.type = 'goat'; hit.i = goatI; }
    }
    return hit.type ? hit : null;
  }
  const heldKind = () => ctx.localBag?.()?.selected?.kind;
  const heldFood = a => { const k = heldKind(); return SPECIES[a ? a.kind : 'puffhen'].foods.includes(k) ? k : null; };
  const heldPail = () => heldKind() === 'bucket';
  const lureFood = (kind = 'puffhen') => { const b = ctx.localBag?.(); if (!b) return null; for (const [k, n] of SPECIES[kind].lure) if (b.count(k) >= n) return k; return null; };
  const esc = s => (ctx.esc ? ctx.esc(s) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

  function goatPrompt(a) {
    const food = heldFood(a), pail = heldPail();
    if (food) return a.content >= FULL_AT ? `${esc(a.name)} is full and happy` : `<kbd>E</kbd>Feed ${esc(a.name)} (${GOAT_FOOD_NAME[food]})`;
    if (pail && a.milk) return `<kbd>E</kbd>Milk ${esc(a.name)}`;
    const tail = a.milk ? ' · has milk (hold a pail)' : pail ? ' · milk soon' : a.content > 0 ? ' · content' : '';
    return `<kbd>E</kbd>Pet ${esc(a.name)} ♥ ${a.hearts}${tail}`;
  }
  function penPrompt(h) {
    const a = findHome(st, h.x, h.z);
    if (a) return heldPail() && a.milk ? `<kbd>E</kbd>Milk ${esc(a.name)}` : `<kbd>E</kbd>Rename ${esc(a.name)}`;
    if (lureAt(st, h.x, h.z)) return 'Hay Corner · a Bramblegoat is on its way…';
    if (kindCount(st, 'goat', true) >= GOAT_CAP) return `Hay Corner · the raft has ${GOAT_CAP} Bramblegoats`;
    const f = lureFood('goat');
    if (!f) return 'Hay Corner · needs 3 Seaweed or 4 Leaves';
    return f === 'seaweed' ? '<kbd>E</kbd>Set out greens to lure a Bramblegoat (3 seaweed)' : '<kbd>E</kbd>Set out greens to lure a Bramblegoat (4 leaves)';
  }
  function promptFor(h) {
    if (h.type === 'goat') return goatPrompt(st.list[h.i]);
    if (h.type === 'pen') return penPrompt(h);
    if (h.type === 'bird') {
      const a = st.list[h.i]; const food = heldFood(a);
      if (food) return a.content >= FULL_AT ? `${esc(a.name)} is full and happy` : `<kbd>E</kbd>Feed ${esc(a.name)} (${FOOD_NAME[food]})`;
      return `<kbd>E</kbd>Pet ${esc(a.name)} ♥ ${a.hearts}${a.content > 0 ? ' · content' : ''}`;
    }
    const a = findHome(st, h.x, h.z);
    if (a) {
      if (a.eggs || a.feather) {
        const parts = [];
        if (a.eggs) parts.push(`${a.eggs} egg${a.eggs > 1 ? 's' : ''}`);
        if (a.feather) parts.push(`${a.feather} feather${a.feather > 1 ? 's' : ''}`);
        return `<kbd>E</kbd>Collect ${parts.join(', ')}`;
      }
      return `<kbd>E</kbd>Rename ${esc(a.name)}`;
    }
    if (lureAt(st, h.x, h.z)) return 'Nest Box · a Puffhen is on its way…';
    if (kindCount(st, 'puffhen', true) >= MAX_ANIMALS) return `Nest Box · the raft has ${MAX_ANIMALS} Puffhens`;
    const f = lureFood();
    if (!f) return 'Nest Box · needs 1 Palm Seed or 3 Leaves';
    return f === 'seed' ? '<kbd>E</kbd>Scatter seeds to lure a Puffhen' : '<kbd>E</kbd>Scatter seeds to lure a Puffhen (3 leaves)';
  }

  function popAt(i) { squishAt[i] = local; heartSlot = i; heartAge = 0; }

  function interact(aim) {
    const h = pick(aim); if (!h) return false;
    if (ctx.role === 'guest' && !gotNet) { ctx.notice?.('Wait for your raft to connect'); return true; }
    if (h.type === 'bird' || h.type === 'goat') {
      const a = st.list[h.i], food = heldFood(a);
      if (food) { if (a.content < FULL_AT) { popAt(h.i); eatAt[h.i] = local; } ctx.action({ kind: 'animals.feed', id: a.id, food }); }
      else if (a.kind === 'goat' && heldPail() && a.milk) { popAt(h.i); ctx.action({ kind: 'animals.milk', id: a.id }); }
      else { popAt(h.i); ctx.action({ kind: 'animals.pet', id: a.id }); }
      return true;
    }
    const a = findHome(st, h.x, h.z);
    if (a && h.type === 'pen') {
      if (heldPail() && a.milk) { const i = st.list.indexOf(a); if (i >= 0) popAt(i); ctx.action({ kind: 'animals.milk', id: a.id }); }
      else openRename(a.id);
      return true;
    }
    if (a) {
      if (a.eggs || a.feather) ctx.action({ kind: 'animals.collect', x: h.x, z: h.z });
      else openRename(a.id);
      return true;
    }
    if (lureAt(st, h.x, h.z)) return true;
    ctx.action({ kind: 'animals.lure', x: h.x, z: h.z });
    return true;
  }

  function loadUI() {
    if (ui || uiLoading || typeof document === 'undefined') return uiLoading;
    uiLoading = import('./animals-ui.js?build=v3-survival-ae77fa84ac2b').then(m => { if (disposed) return null; ui = m.createAnimalsUI(ctx); return ui; }).catch(e => { console.error('animals ui failed', e); uiLoading = null; return null; });
    return uiLoading;
  }
  function openRename(id) {
    const a = findId(st, id); if (!a) return false;
    const go = u => u && u.open(a.id, a.name, SPECIES[a.kind].label);
    if (ui) go(ui); else loadUI()?.then(go);
    return true;
  }

  // ------------------------------------------------------------------ actions (host)

  function birdPos(a, out) { // host-computed bird position (world xz), or its box centre
    const i = st.list.indexOf(a);
    if (built && i >= 0 && shown[i]) { out.x = lastPos[i * 3]; out.z = lastPos[i * 3 + 2]; return out; }
    const wp = toWorld(TILE * a.home[0], FLOOR_Y, TILE * a.home[1]); out.x = wp.x; out.z = wp.z; return out;
  }
  const tmp = { x: 0, z: 0 };
  function near(actor, x, z) {
    const pos = actor === 'guest' ? ctx.other : ctx.physics;
    if (!pos || !fin(pos.x) || !fin(pos.z)) return actor !== 'guest';
    return Math.hypot(pos.x - x, pos.z - z) <= REACH + 1.5;
  }
  const fail = (actor, text, kind = 'notice') => { if (text) emit({ kind, text }, actor); return true; };

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || a.kind.slice(0, 8) !== 'animals.') return false;
    if (!isHost()) return true;
    const verb = a.kind.slice(8), t = st.t;
    const tileOk = isInt(a.x) && isInt(a.z) && Math.abs(a.x) <= 25 && Math.abs(a.z) <= 25;
    const idOk = typeof a.id === 'string' && a.id.length <= 8;
    let res;
    if (verb === 'lure' || verb === 'collect') {
      if (!tileOk) return true;
      const type = decorAt(a.x, a.z);
      if (type !== 'nestbox' && !(verb === 'lure' && type === 'goatpen')) return fail(actor, 'That spot has no nest box');
      const wp = toWorld(TILE * a.x, FLOOR_Y, TILE * a.z);
      if (!near(actor, wp.x, wp.z)) return fail(actor, 'Step a little closer');
      if (!bag) return true;
      res = verb === 'lure' ? lure(st, a.x, a.z, bag, t, Math.random, type === 'goatpen' ? 'goat' : 'puffhen') : collect(st, a.x, a.z, bag);
    } else if (verb === 'milk') {
      if (!idOk) return true;
      const an = findId(st, a.id); if (!an) return fail(actor, gone(a.id));
      if (!near(actor, birdPos(an, tmp).x, tmp.z)) return fail(actor, 'Step a little closer');
      if (!bag) return true;
      res = milk(st, a.id, bag);
    } else if (verb === 'feed' || verb === 'pet' || verb === 'name') {
      if (!idOk) return true;
      const an = findId(st, a.id); if (!an) return fail(actor, gone(a.id));
      if (verb === 'name') { const wp = toWorld(TILE * an.home[0], FLOOR_Y, TILE * an.home[1]); tmp.x = wp.x; tmp.z = wp.z; } // the dialog opens at the box
      else birdPos(an, tmp);
      if (!near(actor, tmp.x, tmp.z)) return fail(actor, 'Step a little closer');
      if (verb === 'feed') { if (!SPECIES[an.kind].foods.includes(a.food) || !bag) return true; res = feed(st, a.id, a.food, bag, t); }
      else if (verb === 'pet') res = pet(st, a.id, t);
      else { if (typeof a.name !== 'string' || a.name.length > 64) return true; res = rename(st, a.id, a.name); }
    } else return true;
    if (res.ok) { bump(); if (res.text) emit({ kind: res.kind, text: res.text }, actor); }
    else fail(actor, res.text, res.reason === 'full' && (verb === 'collect' || verb === 'milk') ? 'full' : REASON_KIND[res.reason] ?? 'notice');
    return true;
  }

  // ------------------------------------------------------------------ save / net

  const r1 = v => Math.round(v * 10) / 10;
  function serialize() {
    if (!isHost()) return undefined;
    if (!cache || cacheR !== st.r || st.t - cacheAt >= CACHE_EVERY || st.t < cacheAt) {
      cache = {
        v: 1, r: st.r, t: r1(st.t), next: st.next,
        list: st.list.map(a => (a.kind === 'goat'
          ? { id: a.id, kind: 'goat', name: a.name, seed: a.seed, home: [a.home[0], a.home[1]], born: r1(a.born), hearts: a.hearts,
            content: round(a.content), prod: round(a.prod), milk: a.milk, bondAt: Math.max(-1e9, round(a.bondAt)) }
          : { id: a.id, kind: 'puffhen', name: a.name, seed: a.seed, home: [a.home[0], a.home[1]], born: r1(a.born), hearts: a.hearts,
            content: round(a.content), prod: round(a.prod), eggs: a.eggs, feather: a.feather, bondAt: Math.max(-1e9, round(a.bondAt)), featherAt: Math.max(-1e9, round(a.featherAt)) })),
        lures: st.lures.map(l => (l.kind === 'goat' ? { home: [l.home[0], l.home[1]], at: round(l.at), kind: 'goat' } : { home: [l.home[0], l.home[1]], at: round(l.at) })),
      };
      cacheR = st.r; cacheAt = st.t;
    }
    cache.t = r1(st.t);
    return cache;
  }
  function load(d, from) {
    if (from === 'net') {
      const first = !gotNet; gotNet = true;
      if (d && typeof d === 'object' && d.r === lastR && !first) { snap(d); return; }
      st = cleanAnimals(d, null); lastR = d && typeof d === 'object' ? d.r : -1;
      snap(d, first); rehome();
      return;
    }
    st = cleanAnimals(d, ctx.world?.decor);
    clock = st.t; lastR = -1; gotNet = false; cache = null;
    pruneDecorRef = ctx.world?.decor; pruneDecorLen = Array.isArray(pruneDecorRef) ? pruneDecorRef.length : -1; pruneSig = decorSig(pruneDecorRef); pruneTick = PRUNE_EVERY_FRAMES;
    graph = null; rehome();
  }
  function snap(d, first) { // guest clock follows the host within 2 s
    if (!d || typeof d !== 'object' || !fin(d.t) || Math.abs(d.t) > 1e9) return;
    if (first || Math.abs(d.t - clock) > 2) clock = d.t;
    else clock += (d.t - clock) * .15; // slew: frame-capped dt drifts at low fps; keep the wander in phase without a jump
  }

  // ------------------------------------------------------------------ QA helpers

  const debug = {
    spawn(x, z, kind = 'puffhen') {
      if (!isHost()) return null;
      const S = SPECIES[kind === 'goat' ? 'goat' : 'puffhen'], home = S.home;
      const w = ctx.world; if (!w || !Array.isArray(w.tiles)) return null;
      if (kindCount(st, kind === 'goat' ? 'goat' : 'puffhen', false) >= S.cap) return null;
      let tx = x, tz = z;
      if (!isInt(tx) || !isInt(tz)) {
        const free = w.tiles.filter(t => !decorAt(t[0], t[1]) && !hasGrill(t[0], t[1])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (!free.length) return null; [tx, tz] = free[0];
      }
      const type = decorAt(tx, tz);
      if (type && type !== home) return null;
      if (!w.tiles.some(t => t[0] === tx && t[1] === tz)) return null;
      if (findHome(st, tx, tz)) return findHome(st, tx, tz).id;
      if (!type) { w.decor.push({ type: home, x: tx, z: tz }); ctx.rebuildRaft?.(); }
      st.lures = st.lures.filter(l => l.home[0] !== tx || l.home[1] !== tz);
      st.lures.push(home === 'goatpen' ? { home: [tx, tz], at: st.t, kind: 'goat' } : { home: [tx, tz], at: st.t });
      step(0);
      const a = findHome(st, tx, tz);
      return a ? a.id : null;
    },
    ff(sec = 60) {
      if (!isHost()) return false;
      const n = Math.min(3600, Math.max(0, Math.floor(sec)));
      for (let k = 0; k < n; k++) { st.t += 1; step(1); }
      clock = st.t;
      return st.t;
    },
    arrive() { if (!isHost()) return false; for (const l of st.lures) l.at = st.t; return st.lures.length; },
    list: () => JSON.parse(JSON.stringify(st.list)),
    lures: () => JSON.parse(JSON.stringify(st.lures)),
    plan(id) {
      const i = st.list.findIndex(a => a.id === id); if (i < 0) return null;
      const pl = plans[i];
      return { beat: beatOf[i], kind: pl.kind, cells: Array.from(pl.cells.slice(0, pl.n + 1)).map(c => (graph && c >= 0 ? [graph.x[c], graph.z[c]] : null)), pos: [lastPos[i * 3], lastPos[i * 3 + 1], lastPos[i * 3 + 2]] };
    },
    spawnGoat(x, z) { return debug.spawn(x, z, 'goat'); },
    milkNow() { if (!isHost()) return 0; let n = 0; for (const a of st.list) if (a.kind === 'goat') { a.milk = 1; a.prod = 0; n++; } if (n) bump(); return n; },
    edge(id) { const i = st.list.findIndex(a => a.id === id); return i < 0 ? null : [edgeX[i], edgeZ[i]]; },
    give() { const b = ctx.localBag?.(); if (!b) return false; b.add('puffegg', 3); b.add('feather', 3); b.add('bucket', 1); return true; },
    rename(id, name) { if (!isHost()) return false; const r = rename(st, id, name); if (r.ok) bump(); return r; },
    openRename: id => openRename(id),
    closeRename() { ui?.close(); },
    graph() { if (!graph) return { n: 0, edges: 0 }; let e = 0; for (let i = 0; i < graph.nb.length; i++) if (graph.nb[i] >= 0) e++; return { n: graph.n, edges: e / 2 }; },
    state: () => JSON.parse(JSON.stringify(st)),
    get clock() { return clock; },
    pick(aim) { const h = pick(aim); return h ? { type: h.type, i: h.i, x: h.x, z: h.z, prompt: promptFor(h) } : null; },
  };

  return {
    name: 'animals',
    beforeUndecor(d) { // [undecor] a hen (or a lure waiting for one) calls this nest box home
      if (d?.type !== 'nestbox') return null; const at = h => Array.isArray(h) && h[0] === d.x && h[1] === d.z;
      return st.list.some(e => at(e.home)) || st.lures.some(l => at(l.home)) ? 'Your puffhen lives here' : null;
    },
    update,
    serialize,
    load,
    action,
    interact,
    prompt(aim) { const h = pick(aim); return h ? promptFor(h) : null; },
    decorModel(type) {
      if (!T) return null;
      if (type === 'nestbox') return nestBoxModel(T);
      if (type === 'cushion') return cushionModel(T);
      if (type === 'goatpen') return goatPenModel(T);
      return null;
    },
    debug,
    dispose() {
      disposed = true; ui?.destroy(); ui = null;
      if (!built) return;
      group.removeFromParent();
      for (const m of [birds, eggs, goats, goatHeads, heart]) { m.geometry.dispose(); m.dispose?.(); }
      birdMat.dispose(); heartMat.dispose();
      built = false; group = null;
    },
  };
}

export { cleanName };
