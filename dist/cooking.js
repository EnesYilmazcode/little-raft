// Cooking: driftwood grill state + model + pooled smoke (ES module, no imports, no textures).
// Usage: import { GrillState, createGrillModel, createSmoke } from './cooking.js?build=v3-survival-ae77fa84ac2b';
//
// Pure (Node-safe, no THREE at import time):
//   COOK_TUNING                         tuning constants (see below)
//   cookTime({cm}) -> seconds           raw -> cooked time on a lit grill
//   new GrillState(snapshot?)           { id, x, z, fuel(seconds), idle, slots:[{species,cm,t,state}|null x2] }
//     .addFuel(nWood) -> accepted       capped at maxFuel wood; (re)kindles an idled fire
//     .lit                              fuel > 0
//     .burning                          lit and (a fish is on, or emptied less than idleBurn seconds ago)
//     .place({species,cm}) -> slot|-1   raw fish only, needs a free slot
//     .take(slot) -> {species,cm,state}|null
//     .update(dt) -> events             [{kind:'cooked',slot}|{kind:'burnt',slot}|{kind:'out',idle?}]
//                                       (returns a shared frozen empty array when nothing happened)
//     .snapshot()                       plain JSON; the constructor sanitises anything (never throws)
// Visuals (T = THREE):
//   createGrillModel(T, {light}?) -> Group, origin at the floor surface, ~0.86 x 0.62 m, ~0.72 m tall.
//     userData: slotPositions[2], fireAnchor, smokeAnchor, setFire(0..1), update(dt,time), dispose(), meshCount (4)
//     Static geometry/materials are shared by all grills (refcounted per THREE instance); dispose() releases them.
//   createSmoke(T, {max=48}) -> { points, emit(x,y,z,n,dark), update(dt,wind{x,z}), dispose() }  one draw call

export const COOK_TUNING = Object.freeze({
  // Raft Simple Grill numbers (docs/loop/research/fidelity-r2b-stations.md): 1 plank = 50 s, holds 2 planks,
  // a ~30 cm fish takes ~40 s. Raft never burns food; ours only chars after a long two minutes of neglect.
  cookSeconds: Object.freeze({ default: 28, perCm: 0.4 }),
  burnAfter: 120,    // extra seconds after cooked before it chars
  fuelPerWood: 50,   // seconds of fire per wood (plank)
  maxFuel: 2,        // wood
  slots: 2,
  idleBurn: 10,      // the fire keeps burning this long after the grill is emptied, then idles out
});

const NO_EVENTS = Object.freeze([]);
const STATES = ['raw', 'cooked', 'burnt'];
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pushEv = (ev, e) => { if (ev === NO_EVENTS) ev = []; ev.push(e); return ev; };
const cmOf = fish => clamp(fin(fish && fish.cm, 30), 1, 300);

export function cookTime(fish) {
  const c = COOK_TUNING.cookSeconds;
  return c.default + c.perCm * cmOf(fish);
}

function cleanFish(f) {
  if (!f || typeof f !== 'object') return null;
  if (typeof f.species !== 'string' || !f.species || f.species.length > 24) return null;
  if (typeof f.cm !== 'number' || !Number.isFinite(f.cm)) return null;
  const cm = clamp(f.cm, 1, 300);
  const state = STATES.includes(f.state) ? f.state : 'raw';
  const ct = cookTime({ cm });
  let t = Math.max(0, fin(f.t, 0));
  if (state === 'cooked') t = clamp(t, ct, ct + COOK_TUNING.burnAfter);
  if (state === 'burnt') t = Math.max(t, ct + COOK_TUNING.burnAfter);
  if (state === 'raw') t = Math.min(t, ct);
  return { species: f.species, cm, t, state };
}

export class GrillState {
  constructor(snapshot) {
    const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const cap = COOK_TUNING.maxFuel * COOK_TUNING.fuelPerWood;
    this.id = (typeof s.id === 'string' && s.id.length <= 64) || (typeof s.id === 'number' && Number.isFinite(s.id)) ? s.id : null;
    this.x = fin(s.x, 0);
    this.z = fin(s.z, 0);
    this.fuel = clamp(fin(s.fuel, 0), 0, cap);
    this.idle = clamp(fin(s.idle, COOK_TUNING.idleBurn), 0, COOK_TUNING.idleBurn);
    this.slots = [];
    const src = Array.isArray(s.slots) ? s.slots : [];
    for (let i = 0; i < COOK_TUNING.slots; i++) this.slots.push(cleanFish(src[i]));
  }
  get lit() { return this.fuel > 0; }
  get occupied() { return this.slots.some(Boolean); }
  get burning() { return this.lit && (this.occupied || this.idle < COOK_TUNING.idleBurn); }
  addFuel(nWood) {
    const n = Math.max(0, Math.floor(fin(nWood, 0)));
    const per = COOK_TUNING.fuelPerWood, cap = COOK_TUNING.maxFuel * per;
    const room = Math.max(0, Math.ceil((cap - this.fuel) / per - 1e-9));
    const ok = Math.min(n, room);
    if (ok > 0) { this.fuel = Math.min(cap, this.fuel + ok * per); this.idle = 0; }
    return ok;
  }
  place(fish) {
    if (!fish || (fish.state && fish.state !== 'raw')) return -1;
    const f = cleanFish({ species: fish.species, cm: fish.cm, t: 0, state: 'raw' });
    if (!f) return -1;
    const i = this.slots.indexOf(null);
    if (i < 0) return -1;
    this.slots[i] = f;
    this.idle = 0;
    return i;
  }
  take(slot) {
    const f = this.slots[slot];
    if (!f) return null;
    this.slots[slot] = null;
    this.idle = 0;
    return { species: f.species, cm: f.cm, state: f.state };
  }
  update(dt) {
    dt = fin(dt, 0);
    if (dt <= 0 || this.fuel <= 0) return NO_EVENTS;
    const occ = this.occupied, IB = COOK_TUNING.idleBurn;
    let burn = dt;
    if (!occ) {
      if (this.idle >= IB) return NO_EVENTS;
      burn = Math.min(dt, IB - this.idle);
      this.idle = Math.min(IB, this.idle + dt);
    }
    const use = Math.min(burn, this.fuel);
    this.fuel -= use;
    let ev = NO_EVENTS; // allocated only when an event fires (no per-frame closure/array)
    if (occ) {
      for (let i = 0; i < this.slots.length; i++) {
        const f = this.slots[i];
        if (!f || f.state === 'burnt') continue;
        const ct = cookTime(f);
        f.t += use;
        if (f.state === 'raw' && f.t >= ct) { f.state = 'cooked'; ev = pushEv(ev, { kind: 'cooked', slot: i }); }
        if (f.state === 'cooked' && f.t >= ct + COOK_TUNING.burnAfter) { f.state = 'burnt'; ev = pushEv(ev, { kind: 'burnt', slot: i }); }
      }
    }
    if (this.fuel <= 1e-9) { this.fuel = 0; ev = pushEv(ev, { kind: 'out' }); }
    else if (!occ && this.idle >= IB) ev = pushEv(ev, { kind: 'out', idle: true });
    return ev;
  }
  snapshot() {
    return {
      id: this.id, x: this.x, z: this.z, fuel: this.fuel, idle: this.idle,
      slots: this.slots.map(f => (f ? { species: f.species, cm: f.cm, t: f.t, state: f.state } : null)),
    };
  }
}

// ---------------------------------------------------------------- grill model
// Static grill geometry + materials are identical for every grill (fixed seed), so they are built once per THREE
// instance and shared (refcounted); only the ember/flame materials (fire level) are per grill.
// Draw calls per lit grill: 4 (wood+logs+stones, box+grate, embers, 3 instanced flames); shadow casters: 2.
const KITS = new WeakMap();
function grillKit(T) {
  let kit = KITS.get(T);
  if (kit) { kit.refs++; return kit; }
  let seed = 0x51c0ffee;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 8) / 16777216; };
  const _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _p = new T.Vector3(), _s = new T.Vector3();
  const UP = new T.Vector3(0, 1, 0), c = new T.Color(), c2 = new T.Color();
  const bake = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => {
    _e.set(rx, ry, rz); _q.setFromEuler(_e);
    return geo.applyMatrix4(_m.compose(_p.set(x, y, z), _q, _s.set(s, s, s)));
  };
  const along = (geo, a, b) => {
    const d = b.clone().sub(a), len = d.length();
    _q.setFromUnitVectors(UP, d.divideScalar(len));
    return geo.applyMatrix4(_m.compose(_p.copy(a).add(b).multiplyScalar(0.5), _q, _s.set(1, 1, 1)));
  };
  const paint = (geo, fn) => {
    const p = geo.attributes.position, arr = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      c.setRGB(1, 1, 1); fn(p.getX(i), p.getY(i), p.getZ(i), c);
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(arr, 3));
    return geo;
  };
  const solid = (geo, hex, j = 0, mul = 1) => { c2.set(hex).multiplyScalar((1 - j / 2 + rnd() * j) * mul); const k = c2.clone(); return paint(geo, (x, y, z, o) => o.copy(k)); };
  const merge = list => {
    const parts = list.map(x => (x.index ? x.toNonIndexed() : x));
    const out = new T.BufferGeometry();
    for (const n of ['position', 'normal', 'color']) {
      const size = parts[0].attributes[n].itemSize;
      const arr = new Float32Array(parts.reduce((s, p) => s + p.attributes[n].count * size, 0));
      let off = 0;
      for (const p of parts) { arr.set(p.attributes[n].array, off); off += p.attributes[n].array.length; }
      out.setAttribute(n, new T.BufferAttribute(arr, size));
    }
    new Set(list.concat(parts)).forEach(x => x.dispose());
    out.computeBoundingSphere();
    return out;
  };
  const std = (o) => new T.MeshStandardMaterial(Object.assign({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0 }, o));

  // dimensions: fire box spans BX x BZ, from Y0 to Y1; grate at GY
  const BX = 0.78, BZ = 0.52, Y0 = 0.44, Y1 = 0.62, GY = 0.645, TH = 0.014;

  // --- driftwood: four bent splayed legs, two lashed stretchers, rope wraps
  const WOOD = [];
  const drift = (hex) => { const b = new T.Color(hex), d = new T.Color(0x5e5348), ph = rnd() * 9;
    return (x, y, z, o) => o.copy(b).lerp(d, 0.25 + 0.25 * Math.sin(y * 60 + Math.sin(x * 40 + ph) * 3 + ph)); };
  const stick = (a, b, r0, r1, hex) => {
    const len = a.distanceTo(b), geo = new T.CylinderGeometry(r1, r0, len, 6, 5);
    const p = geo.attributes.position, bend = (rnd() - 0.5) * 0.05, ph = rnd() * 6;
    for (let i = 0; i < p.count; i++) {
      const u = p.getY(i) / len + 0.5, k = Math.sin(u * Math.PI);
      p.setX(i, p.getX(i) * (1 + 0.18 * Math.sin(u * 17 + ph)) + bend * k);
      p.setZ(i, p.getZ(i) + bend * 0.5 * k);
    }
    geo.computeVertexNormals();
    return along(paint(geo, drift(hex)), a, b);
  };
  const V = (x, y, z) => new T.Vector3(x, y, z);
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of legs) {
    WOOD.push(stick(V(sx * 0.4, 0, sz * 0.28), V(sx * 0.31, Y0 + 0.03, sz * 0.2), 0.032, 0.024, 0xb3a690));
    WOOD.push(bake(solid(new T.TorusGeometry(0.03, 0.009, 4, 10), 0x8c6a3f), sx * 0.315, Y0 - 0.06, sz * 0.205, Math.PI / 2));
  }
  for (const sz of [-1, 1]) {
    WOOD.push(stick(V(-0.42, 0.17, sz * 0.25), V(0.42, 0.17, sz * 0.25), 0.02, 0.018, 0xa89a82));
    for (const sx of [-1, 1]) WOOD.push(bake(solid(new T.TorusGeometry(0.024, 0.008, 4, 10), 0x8c6a3f), sx * 0.37, 0.17, sz * 0.25, 0, Math.PI / 2));
  }

  // --- dented scrap-metal fire box: floor, 4 walls (dents pushed inward), rolled rim, rivets
  const METAL = [];
  const rust = (ph) => (x, y, z, o) => {
    const n = Math.sin(x * 23 + ph) * Math.sin(y * 31 - ph * 2) + Math.sin((x + y) * 11 + ph);
    o.set(0x737b80).lerp(c2.set(0x9a5430), clamp(n * 0.5 + 0.4, 0, 0.9));
    o.multiplyScalar(0.75 + 0.35 * clamp((y - Y0) / (Y1 - Y0), 0, 1));
  };
  const wall = (w, x, z, ry) => {
    const geo = new T.BoxGeometry(w, Y1 - Y0, TH, 10, 4, 1);
    const dents = [0, 1, 2].map(() => [(rnd() - 0.5) * w * 0.7, (rnd() - 0.5) * 0.1, 0.05 + rnd() * 0.05, 0.014 + rnd() * 0.016]);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let d = 0;
      for (const [u, v, r, k] of dents) d += k * Math.exp(-((p.getX(i) - u) ** 2 + (p.getY(i) - v) ** 2) / (r * r));
      p.setZ(i, p.getZ(i) + d);
    }
    geo.computeVertexNormals();
    METAL.push(bake(geo, x, (Y0 + Y1) / 2, z, 0, ry));
    const lip = new T.CylinderGeometry(0.011, 0.011, w + 0.02, 6);
    METAL.push(bake(lip, x, Y1, z, 0, ry, Math.PI / 2));
  };
  wall(BX, 0, -BZ / 2, 0); wall(BX, 0, BZ / 2, Math.PI);
  wall(BZ, -BX / 2, 0, Math.PI / 2); wall(BZ, BX / 2, 0, -Math.PI / 2);
  METAL.push(bake(new T.BoxGeometry(BX, TH, BZ), 0, Y0, 0));
  const ph0 = rnd() * 9; METAL.forEach(geo => paint(geo, rust(ph0)));
  for (const sx of [-1, 1]) for (const y of [Y0 + 0.035, Y1 - 0.04]) {
    for (const sz of [-1, 1]) {
      METAL.push(bake(solid(new T.SphereGeometry(0.011, 6, 4), 0x4b4440), sx * (BX / 2 - 0.035), y, sz * (BZ / 2 + TH * 0.6)));
      METAL.push(bake(solid(new T.SphereGeometry(0.011, 6, 4), 0x4b4440), sx * (BX / 2 + TH * 0.6), y, sz * (BZ / 2 - 0.035)));
    }
  }

  // --- wire grate: frame, cross wires, two bent carry handles. Merged into the box mesh (one material); the wire
  // colour is pre-darkened so its diffuse matches the old dedicated metalness 0.7 material.
  const wr = 0.0055, gw = BX - 0.03, gd = BZ - 0.03, WIRE_MUL = 0.6;
  const wire = (a, b, r = wr) => METAL.push(along(solid(new T.CylinderGeometry(r, r, a.distanceTo(b), 5), 0x2f3133, 0, WIRE_MUL), a, b));
  for (let i = 0; i <= 10; i++) { const z = -gd / 2 + gd * i / 10; wire(V(-gw / 2, GY, z), V(gw / 2, GY, z)); }
  for (const x of [-gw / 2, -0.19, 0, 0.19, gw / 2]) wire(V(x, GY - 0.007, -gd / 2), V(x, GY - 0.007, gd / 2), x === 0 || Math.abs(x) > 0.3 ? 0.008 : wr);
  for (const sx of [-1, 1]) METAL.push(bake(solid(new T.TorusGeometry(0.06, 0.006, 4, 12, Math.PI), 0x2f3133, 0, WIRE_MUL), sx * (BX / 2 + 0.01), GY, 0, Math.PI / 2, 0, sx * Math.PI / 2));

  // --- stones: a little lip around the fire bed + two by the legs. Icosahedra are non-indexed, so their computed
  // normals are already per-face (the flat look) and they share the wood mesh/material (same roughness).
  const stone = (r, x, y, z) => {
    const geo = new T.IcosahedronGeometry(r, 0), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + rnd() * 0.4), p.getY(i) * (0.55 + rnd() * 0.3), p.getZ(i) * (0.8 + rnd() * 0.4));
    geo.computeVertexNormals();
    WOOD.push(bake(solid(geo, [0x6f6d68, 0x7d786e, 0x5f5b56, 0x868174][(rnd() * 4) | 0], 0.15), x, y, z, 0, rnd() * 6));
  };
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; stone(0.04 + rnd() * 0.015, Math.cos(a) * 0.3, Y0 + 0.025, Math.sin(a) * 0.19); }
  stone(0.05, 0.43, 0.03, 0.33); stone(0.04, 0.44, 0.022, 0.18); stone(0.045, -0.42, 0.025, -0.34);

  // --- charred logs (also in the wood mesh) and an ember bed (basic material so vertex colours glow)
  for (const [a, b] of [[V(-0.22, Y0 + 0.04, -0.08), V(0.2, Y0 + 0.06, 0.09)], [V(-0.2, Y0 + 0.06, 0.1), V(0.22, Y0 + 0.04, -0.07)]]) {
    WOOD.push(along(paint(new T.CylinderGeometry(0.03, 0.035, a.distanceTo(b), 7, 3),
      (x, y, z, o) => o.set(0x3a2a20).lerp(c2.set(0x15100d), 0.5 + 0.5 * Math.sin(y * 50 + x * 30))), a, b));
  }
  const EMB = [];
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.22;
    EMB.push(bake(paint(new T.IcosahedronGeometry(0.018 + rnd() * 0.016, 0), (x, y, z, o) => o.set(0xff7a1a).lerp(c2.set(0xffd04a), rnd() * 0.6).multiplyScalar(0.6 + rnd() * 0.6)),
      Math.cos(a) * r * 1.2, Y0 + 0.014, Math.sin(a) * r * 0.7));
  }
  const flame = paint(new T.ConeGeometry(0.085, 1, 8, 4, true).translate(0, 0.5, 0), (x, y, z, o) =>
    o.set(0xffe27a).lerp(c2.set(0xff5a14), clamp(y * 1.4, 0, 1)).multiplyScalar(1 - y * 0.75));
  kit = {
    refs: 1, Y0, GY,
    wood: merge(WOOD), metal: merge(METAL), embers: merge(EMB), flame,
    woodMat: std({ roughness: 0.95 }), metalMat: std({ roughness: 0.62, metalness: 0.45 }),
    release() {
      if (--kit.refs > 0) return;
      for (const x of [kit.wood, kit.metal, kit.embers, kit.flame, kit.woodMat, kit.metalMat]) x.dispose();
      if (KITS.get(T) === kit) KITS.delete(T);
    },
  };
  KITS.set(T, kit);
  return kit;
}

export function createGrillModel(T, opts = {}) {
  const g = new T.Group();
  g.name = 'grill';
  const kit = grillKit(T), { Y0, GY } = kit;
  const V = (x, y, z) => new T.Vector3(x, y, z);
  let meshCount = 0;
  const add = (geo, mat, name, shadow = true) => {
    const m = new T.Mesh(geo, mat);
    m.name = name; m.castShadow = shadow; m.receiveShadow = true; g.add(m); meshCount++;
    return m;
  };
  add(kit.wood, kit.woodMat, 'grillWood');
  add(kit.metal, kit.metalMat, 'grillBox');
  const emberMat = new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  add(kit.embers, emberMat, 'grillEmbers', false);

  // --- three flickering cone flames: one instanced draw call, additive, no shadows
  const flameMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, toneMapped: false });
  const FL = [[-0.1, 0.04, 0.27, 1.0], [0.11, -0.04, 0.24, 1.1], [0, 0, 0.36, 1.3]].map(([x, z, h, w], i) => ({ x, z, h, w, ph: i * 2.1 }));
  const flames = new T.InstancedMesh(kit.flame, flameMat, FL.length);
  flames.instanceMatrix.setUsage(T.DynamicDrawUsage);
  flames.boundingSphere = new T.Sphere(V(0, Y0 + 0.25, 0), 0.5); // fixed: instance scales animate (never recomputed)
  flames.name = 'grillFlame'; flames.castShadow = false; flames.receiveShadow = false; g.add(flames); meshCount++;
  const dummy = new T.Object3D();
  const light = opts.light ? new T.PointLight(0xff8a3a, 0, 2.6, 2) : null;
  if (light) { light.position.set(0, Y0 + 0.25, 0); g.add(light); }

  let level = 0;
  const ud = g.userData;
  ud.slotPositions = [V(-0.19, GY + 0.012, 0), V(0.19, GY + 0.012, 0)];
  ud.fireAnchor = V(0, Y0 + 0.04, 0);
  ud.smokeAnchor = V(0, GY + 0.1, 0);
  ud.meshCount = meshCount;
  ud.setFire = (v) => { level = clamp(fin(v, 0), 0, 1); flames.visible = level > 0.01; };
  ud.update = (dt, time = 0) => {
    const t = fin(time, 0);
    if (flames.visible) {
      for (let i = 0; i < FL.length; i++) {
        const { x, z, h, w, ph } = FL[i];
        const k = 0.78 + 0.16 * Math.sin(t * 9.3 + ph) + 0.1 * Math.sin(t * 23.7 + ph * 3);
        dummy.position.set(x, Y0 + 0.03, z);
        dummy.scale.set(w * (0.55 + 0.45 * level) * (1.1 - k * 0.2), h * level * k, w * (0.55 + 0.45 * level));
        dummy.rotation.set(0.12 * Math.sin(t * 5.1 + ph), t * 1.7 + ph, 0.12 * Math.sin(t * 4.3 + ph * 2));
        dummy.updateMatrix(); flames.setMatrixAt(i, dummy.matrix);
      }
      flames.instanceMatrix.needsUpdate = true;
      flameMat.opacity = 0.75 + 0.15 * Math.sin(t * 13);
    }
    emberMat.color.setScalar(0.16 + level * (0.75 + 0.15 * Math.sin(t * 3.1) + 0.1 * Math.sin(t * 7.7)));
    if (light) light.intensity = level * (0.8 + 0.25 * Math.sin(t * 11) + 0.2 * Math.sin(t * 27));
  };
  let disposed = false;
  ud.dispose = () => {
    if (disposed) return; disposed = true;
    emberMat.dispose(); flameMat.dispose(); flames.dispose(); kit.release();
    if (light) light.dispose();
  };
  ud.setFire(0); ud.update(0, 0);
  return g;
}

// ---------------------------------------------------------------- pooled smoke
const NO_WIND = Object.freeze({ x: 0, z: 0 });
export function createSmoke(T, { max = 48 } = {}) {
  const N = Math.max(1, Math.floor(fin(max, 48)));
  const pos = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N), shade = new Float32Array(N);
  const age = new Float32Array(N).fill(1e9), life = new Float32Array(N).fill(1), vel = new Float32Array(N * 3), s0 = new Float32Array(N);
  const geo = new T.BufferGeometry();
  const aPos = new T.BufferAttribute(pos, 3), aSize = new T.BufferAttribute(size, 1), aAlpha = new T.BufferAttribute(alpha, 1);
  for (const a of [aPos, aSize, aAlpha]) a.setUsage(T.DynamicDrawUsage);
  geo.setAttribute('position', aPos); geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha);
  geo.setAttribute('aShade', new T.BufferAttribute(shade, 1));
  const mat = new T.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aShade; uniform float uScale;
      varying float vA; varying float vS;
      void main(){ vA=aAlpha; vS=aShade; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;
        gl_PointSize = aAlpha > 0.001 ? aSize*uScale/max(0.1,-mv.z) : 0.0; }`,
    fragmentShader: `varying float vA; varying float vS;
      void main(){ vec2 d=gl_PointCoord-0.5; float r=dot(d,d)*4.0; if(r>1.0) discard;
        float a=(1.0-r); a*=a; vec3 col=mix(vec3(0.9,0.9,0.88),vec3(0.22,0.21,0.2),vS)*(0.85+0.15*(0.5-d.y));
        gl_FragColor=vec4(col,a*vA); }`,
    transparent: true, depthWrite: false,
  });
  const points = new T.Points(geo, mat);
  points.name = 'smoke'; points.frustumCulled = false;
  points.visible = false; // hidden (no draw call) while no puff is alive; emit() shows it, update() hides it again
  const _v2 = new T.Vector2();
  points.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(_v2);
    mat.uniforms.uScale.value = _v2.y * 0.5 * (camera.projectionMatrix ? camera.projectionMatrix.elements[5] : 1);
  };
  let cursor = 0, seed = 0x5eed;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 8) / 16777216; };
  const emit = (x, y, z, n = 1, dark = false) => {
    for (let k = 0; k < n; k++) {
      const i = cursor; cursor = (cursor + 1) % N;
      pos[i * 3] = x + (rnd() - 0.5) * 0.12; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z + (rnd() - 0.5) * 0.1;
      vel[i * 3] = (rnd() - 0.5) * 0.08; vel[i * 3 + 1] = 0.35 + rnd() * 0.25; vel[i * 3 + 2] = (rnd() - 0.5) * 0.08;
      age[i] = 0; life[i] = 3.0 + rnd() * 1.0; s0[i] = 0.12 + rnd() * 0.08; shade[i] = dark ? 0.85 : 0.05 * rnd();
    }
    geo.attributes.aShade.needsUpdate = true;
    if (n > 0) points.visible = true;
  };
  const update = (dt, wind = NO_WIND) => {
    dt = fin(dt, 0);
    const wx = fin(wind && wind.x, 0), wz = fin(wind && wind.z, 0);
    let alive = 0;
    for (let i = 0; i < N; i++) {
      if (age[i] >= life[i]) { alpha[i] = 0; continue; }
      age[i] += dt; alive++;
      const t = Math.min(1, age[i] / life[i]), j = i * 3;
      vel[j + 1] *= 1 - 0.25 * dt;
      pos[j] += (vel[j] + wx * (0.25 + t)) * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += (vel[j + 2] + wz * (0.25 + t)) * dt;
      size[i] = s0[i] * (1 + 2.6 * t);
      alpha[i] = t >= 1 ? 0 : Math.min(1, t * 8) * (1 - t) * (1 - t) * (shade[i] > 0.5 ? 0.75 : 0.55);
    }
    if (!alive && !points.visible) return; // idle: nothing to draw or upload
    points.visible = alive > 0;
    aPos.needsUpdate = aSize.needsUpdate = aAlpha.needsUpdate = true;
  };
  return { points, emit, update, dispose() { geo.dispose(); mat.dispose(); } };
}
