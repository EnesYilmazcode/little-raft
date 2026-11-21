// Bloatfish (content module 'puffer'): a spiny little puffer that hovers just under the surface around
// the docked island. Swim or dive within 4 m and it swims at you, swells up over 1.2 s and bursts
// (20 damage within 3 m) into a green poison cloud (5 damage per second for 9 s within 3 m).
// Two wooden-spear jabs (or one metal) kill it first; it drops Puffer Goo.
// Rules: puffer-core.js (pure, tested). Model + particles: puffer-model.js.
//
// Co-op: local per player, like diving and the seafloor. Each client runs its own Bloatfish and hurts only
// its own player; the goo drop is a host action ('puffer:goo') checked against the actor's position.
// Draw calls: one InstancedMesh (all fish) + one Points (bubbles and poison), both hidden above water.
import { createPufferSim, PUFFER, PUFF, swell } from './puffer-core.js?build=v3-survival-ae77fa84ac2b';
import { createBloatfishGeometry, createPufferPoints } from './puffer-model.js?build=v3-survival-ae77fa84ac2b';
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b'; // same specifier as content.js: one shared instance
import { addSpearTarget } from './spear-targets.js?build=v3-survival-ae77fa84ac2b';

const BUBBLES = 48, PER_CLOUD = 18, NPTS = BUBBLES + PER_CLOUD * PUFFER.MAX_CLOUDS;
const GUEST_COOL = 600; // ms between goo drops per actor (the spear cooldown is 700 ms)

export function createPuffers(ctx) {
  const T = ctx.T;
  const sim = createPufferSim();
  const geo = createBloatfishGeometry(T);
  const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  const mesh = new T.InstancedMesh(geo, mat, PUFFER.MAX);
  mesh.name = 'bloatfish'; mesh.frustumCulled = false; mesh.count = PUFFER.MAX;
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  const white = new T.Color(1, 1, 1);
  for (let i = 0; i < PUFFER.MAX; i++) mesh.setColorAt(i, white); // instanceColor exists from the start: no recompiles
  mesh.instanceColor.setUsage(T.DynamicDrawUsage);
  const fx = createPufferPoints(T, NPTS);
  const group = new T.Group(); group.name = 'bloatfish'; group.visible = false;
  group.add(mesh, fx.points);
  let added = false;

  // scratch (no per-frame allocations)
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), s3 = new T.Vector3(), tint = new T.Color();
  const zero = new T.Matrix4().makeScale(0, 0, 0);
  let cx = 0, cz = 0, R = 0, live = false, lastNotice = -10;
  const cool = { host: 0, guest: 0 };

  // bubbles: ring buffer, island-relative
  const bx = new Float32Array(BUBBLES), by = new Float32Array(BUBBLES), bz = new Float32Array(BUBBLES);
  const bvx = new Float32Array(BUBBLES), bvz = new Float32Array(BUBBLES), blife = new Float32Array(BUBBLES), bmax = new Float32Array(BUBBLES), bsize = new Float32Array(BUBBLES);
  let bNext = 0;
  const emitAcc = new Float32Array(PUFFER.MAX);
  function bubble(x, y, z, sp, size) {
    const i = bNext; bNext = (bNext + 1) % BUBBLES;
    const a = Math.random() * 6.283;
    bx[i] = x; by[i] = y; bz[i] = z; bvx[i] = Math.cos(a) * sp; bvz[i] = Math.sin(a) * sp;
    blife[i] = bmax[i] = 0.8 + Math.random() * 0.8; bsize[i] = size;
  }
  // poison puffs: fixed per-slot seeds, position computed from the cloud's age
  const seeds = new Float32Array(PER_CLOUD * PUFFER.MAX_CLOUDS * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();

  sim.onTrigger = () => {
    if (ctx.elapsed - lastNotice > 6) { lastNotice = ctx.elapsed; ctx.notice?.('A Bloatfish is puffing up! Swim away or spear it', 1800); }
  };
  sim.onBurst = (i, f) => {
    for (let k = 0; k < 18; k++) bubble(f.x + (Math.random() - 0.5) * 0.6, f.y + (Math.random() - 0.5) * 0.6, f.z + (Math.random() - 0.5) * 0.6, 0.9, 0.07 + Math.random() * 0.08);
    try { ctx.play?.('splash', 0.7); } catch {}
    if (sim.lastBurstHit > 0) ctx.notice?.('The Bloatfish burst! Get out of the poison', 2200);
  };

  const hurt = (n, cause) => { try { ctx.hurtPlayer?.(n, cause); } catch (err) { console.error('bloatfish hurt failed', err); } };

  function anchor() {
    const isl = islandNow();
    if (!isl || !(isl.R > 0)) { live = false; return null; }
    cx = isl.cx; cz = isl.cz; R = isl.R; live = true;
    return isl;
  }

  // Spear hits (registered in the shared spear target list; spear-repair-hooks wears the spear on a hit).
  const offSpear = addSpearTarget((o, d, reach, dmg) => {
    if (!live || !ctx.running) return false;
    const i = sim.spear(o.x - cx, o.y, o.z - cz, d.x, d.y, d.z, reach, dmg);
    if (i < 0) return false;
    const f = sim.fish[i];
    for (let k = 0; k < 6; k++) bubble(f.x, f.y, f.z, 0.6, 0.05 + Math.random() * 0.05);
    if (sim.lastKill > 0) {
      for (let k = 0; k < 12; k++) bubble(f.x, f.y, f.z, 0.8, 0.06 + Math.random() * 0.06);
      ctx.action?.({ kind: 'puffer:goo', n: sim.lastKill });
    }
    return true;
  });

  function writeFish(time) {
    for (let i = 0; i < PUFFER.MAX; i++) {
      const f = sim.fish[i];
      if (f.state === PUFF.DEAD) { mesh.setMatrixAt(i, zero); continue; }
      const k = f.state === PUFF.INFLATE ? swell(f.t) : 0;
      const wob = k > 0 ? 1 + Math.sin(time * (18 + 30 * k)) * 0.05 * k : 1;
      // flat and long at rest, a spiky ball when swollen
      s3.set((0.9 + 0.95 * k) * wob, (0.78 + 1.07 * k) * wob, (1.12 + 0.6 * k) * wob);
      const roll = k > 0 ? 0 : Math.sin(time * 1.7 + f.phase) * 0.08, tailWag = Math.sin(time * 6 + f.phase) * 0.12 * (1 - k);
      e.set(roll * 0.5, f.yaw + tailWag, roll); q.setFromEuler(e);
      v.set(f.x, f.y, f.z);
      m4.compose(v, q, s3); mesh.setMatrixAt(i, m4);
      // hit flash, then a quickening yellow-green warning blink before the burst
      if (f.hurtT > 0) tint.setRGB(1.6, 0.7, 0.6);
      else if (k > 0) { const b = 0.5 + 0.5 * Math.sin(time * (8 + 26 * k)); tint.setRGB(1 + 0.15 * k * b, 1 + 0.25 * k * b, 1 - 0.45 * k * b); }
      else tint.copy(white);
      mesh.setColorAt(i, tint);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  }

  function writeFx(dt, time) {
    const P = fx.pos.array, C = fx.col.array, S = fx.size.array;
    // emit bubbles from inflating fish
    for (let i = 0; i < PUFFER.MAX; i++) {
      const f = sim.fish[i];
      if (f.state !== PUFF.INFLATE) { emitAcc[i] = 0; continue; }
      emitAcc[i] += dt * (10 + 22 * swell(f.t));
      const r = PUFFER.RADIUS * (1 + swell(f.t));
      while (emitAcc[i] >= 1) { emitAcc[i] -= 1; const a = Math.random() * 6.283; bubble(f.x + Math.cos(a) * r, f.y + r * 0.6, f.z + Math.sin(a) * r, 0.15, 0.035 + Math.random() * 0.045); }
    }
    for (let i = 0; i < BUBBLES; i++) {
      const j3 = i * 3, j4 = i * 4;
      if (blife[i] <= 0) { S[i] = 0; continue; }
      blife[i] -= dt;
      const drag = Math.exp(-2.5 * dt);
      bvx[i] *= drag; bvz[i] *= drag;
      bx[i] += bvx[i] * dt + Math.sin(time * 7 + i) * 0.05 * dt; bz[i] += bvz[i] * dt; by[i] += (0.55 + bsize[i] * 6) * dt;
      const top = ctx.ocean ? ctx.ocean.getHeight(bx[i] + cx, bz[i] + cz) - 0.05 : -0.3;
      if (by[i] > top) blife[i] = 0;
      P[j3] = bx[i]; P[j3 + 1] = by[i]; P[j3 + 2] = bz[i];
      C[j4] = 0.86; C[j4 + 1] = 0.97; C[j4 + 2] = 1; C[j4 + 3] = 0.85 * Math.min(1, blife[i] / 0.25);
      S[i] = blife[i] > 0 ? bsize[i] : 0;
    }
    for (let c = 0; c < PUFFER.MAX_CLOUDS; c++) {
      const cl = sim.clouds[c];
      for (let k = 0; k < PER_CLOUD; k++) {
        const i = BUBBLES + c * PER_CLOUD + k, j3 = i * 3, j4 = i * 4, s0 = (c * PER_CLOUD + k) * 4;
        if (!cl.on) { S[i] = 0; continue; }
        const t = cl.t, a = seeds[s0] * 6.283 + t * (0.25 + seeds[s0 + 1] * 0.3) * (seeds[s0 + 2] > 0.5 ? 1 : -1);
        const grow = 1 - Math.exp(-3 * t), rr = (0.4 + 2.1 * Math.sqrt(seeds[s0 + 3])) * grow;
        const yy = (seeds[s0 + 1] - 0.5) * 2.6 * grow + t * 0.04;
        P[j3] = cl.x + Math.cos(a) * rr; P[j3 + 1] = cl.y + yy; P[j3 + 2] = cl.z + Math.sin(a) * rr;
        const fade = Math.min(1, t / 0.35) * Math.min(1, (PUFFER.CLOUD_TIME - t) / 2.5);
        C[j4] = 0.48 + 0.2 * seeds[s0 + 2]; C[j4 + 1] = 0.85 + 0.1 * seeds[s0]; C[j4 + 2] = 0.12 + 0.1 * seeds[s0 + 3]; C[j4 + 3] = 0.42 * fade;
        S[i] = (0.9 + 1.1 * seeds[s0 + 2]) * (0.5 + 0.5 * grow);
      }
    }
    fx.pos.needsUpdate = true; fx.col.needsUpdate = true; fx.size.needsUpdate = true;
  }

  function update(dt) {
    if (!added && ctx.scene) { ctx.scene.add(group); added = true; }
    const ph = ctx.physics, cam = ctx.camera, time = ctx.elapsed || 0;
    const isl = ctx.running ? anchor() : null;
    if (!isl) sim.area(null, 0, 0);
    else if (ph) sim.area(isl.seed, R, Math.hypot(ph.x - cx, ph.z - cz));
    if (ph && ctx.running && dt > 0) sim.step(dt, ph.x - cx, ph.y - 0.35, ph.z - cz, !!ph.swimming, hurt);
    // visible only from below (or right at) the surface, when there is something to show
    let any = sim.alive() > 0;
    for (let i = 0; i < sim.clouds.length; i++) if (sim.clouds[i].on) any = true;
    for (let i = 0; i < BUBBLES && !any; i++) if (blife[i] > 0) any = true;
    const water = cam && ctx.ocean ? ctx.ocean.getHeight(cam.position.x, cam.position.z) : 0;
    const show = !!cam && any && cam.position.y < water + 0.25;
    group.visible = show;
    if (!show) return;
    group.position.set(cx, 0, cz);
    const r = ctx.renderer;
    if (r && cam) fx.mat.uniforms.uScale.value = r.domElement.height * cam.projectionMatrix.elements[5] * 0.5;
    writeFish(time); writeFx(dt, time);
  }

  // Host: goo from a Bloatfish this actor killed (local per player, so check the actor is near the island and in the water).
  function action(a, actor, bag) {
    if (a?.kind !== 'puffer:goo') return false;
    const n = a.n === 2 ? 2 : 1, p = actor === 'guest' ? ctx.other : ctx.physics, isl = islandNow(), now = performance.now();
    if (!p || !isl || !Number.isFinite(p.x) || !Number.isFinite(p.z) || now - (cool[actor] ?? 0) < GUEST_COOL) return true;
    if (Math.hypot(p.x - isl.cx, p.z - isl.cz) > isl.R * PUFFER.RING_IN + PUFFER.RING_OUT + 8) return true;
    cool[actor] = now;
    if (bag.add('goo', n) > 0) { ctx.emit({ kind: 'full', text: 'Your bag is full' }, actor); return true; }
    ctx.emit({ kind: 'loot', text: `Bloatfish popped: + ${n} Puffer Goo`, loot: { goo: n } }, actor);
    return true;
  }

  const debug = {
    get state() {
      return { live, key: sim.key, away: sim.away, alive: sim.alive(), inPoison: sim.inPoison, bursts: sim.bursts,
        fish: sim.fish.map((f) => ({ state: ['dead', 'idle', 'inflate'][f.state], x: f.x + cx, y: f.y, z: f.z + cz, hp: f.hp, t: f.t })),
        clouds: sim.clouds.filter((c) => c.on).map((c) => ({ x: c.x + cx, y: c.y, z: c.z + cz, t: c.t })) };
    },
    /** Move fish i to `dist` m in front of the camera (QA). k >= 0 pins it mid-swell (0..1). */
    place(i = 0, dist = 2.2, k = -1) {
      const f = sim.fish[i], cam = ctx.camera; if (!f || !cam || !live) return false;
      cam.getWorldDirection(v);
      f.x = f.hx = cam.position.x + v.x * dist - cx; f.z = f.hz = cam.position.z + v.z * dist - cz; f.y = f.hy = Math.min(PUFFER.TOP, cam.position.y + v.y * dist);
      f.yaw = Math.atan2(cam.position.x - cx - f.x, cam.position.z - cz - f.z);
      if (f.state === PUFF.DEAD) f.hp = PUFFER.HP;
      f.state = k >= 0 ? PUFF.INFLATE : PUFF.IDLE; f.t = k >= 0 ? k * PUFFER.INFLATE : 0; f.pin = k >= 0;
      return true;
    },
    unpin() { for (const f of sim.fish) f.pin = false; },
    sim,
  };

  return {
    name: 'puffer', update, action, debug,
    dispose() {
      offSpear();
      if (group.parent) group.parent.remove(group);
      geo.dispose(); mat.dispose(); mesh.dispose?.(); fx.geo.dispose(); fx.mat.dispose();
    },
  };
}
