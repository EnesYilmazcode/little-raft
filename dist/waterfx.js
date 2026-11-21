// Little Raft - light, original water splash effects.
// Pooled drops (one InstancedMesh, 48 max) + 8 pooled ripple rings.
// No textures, sprites, lights, timers, DOM or cameras. No per-frame allocation.

const MAX_DROPS = 48;
const MAX_RINGS = 8;
const MAX_LIFE = 1.5;
const GRAVITY = 9.8;
const MAX_DT = 0.05;

const FOAM_CREAM = 0xe9e6d6;
const PALE_TEAL = 0xa9cfc8;
const RING_COLOR = 0xcfe0d8;
const RING_OPACITY = 0.42;

export function createWaterEffects(T) {
  const group = new T.Group();
  group.name = 'WaterEffects';

  // ---------- Drops ----------
  const dropGeo = new T.IcosahedronGeometry(1, 0);
  const dropMat = new T.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const drops = new T.InstancedMesh(dropGeo, dropMat, MAX_DROPS);
  drops.name = 'WaterDrops';
  drops.instanceMatrix.setUsage(T.DynamicDrawUsage);
  drops.frustumCulled = false; // instances span far outside the unit geometry bounds
  drops.renderOrder = 2;
  drops.visible = false;
  group.add(drops);

  const px = new Float32Array(MAX_DROPS);
  const py = new Float32Array(MAX_DROPS);
  const pz = new Float32Array(MAX_DROPS);
  const vx = new Float32Array(MAX_DROPS);
  const vy = new Float32Array(MAX_DROPS);
  const vz = new Float32Array(MAX_DROPS);
  const floorY = new Float32Array(MAX_DROPS);
  const age = new Float32Array(MAX_DROPS);
  const life = new Float32Array(MAX_DROPS); // 0 => dead
  const size = new Float32Array(MAX_DROPS);
  let dropCursor = 0;
  let liveDrops = 0;

  const tmpMat = new T.Matrix4();
  const zeroMat = new T.Matrix4().makeScale(0, 0, 0);
  const cream = new T.Color(FOAM_CREAM);
  const teal = new T.Color(PALE_TEAL);
  const tmpColor = new T.Color();

  for (let i = 0; i < MAX_DROPS; i++) {
    drops.setMatrixAt(i, zeroMat);
    drops.setColorAt(i, cream); // allocates instanceColor once, up front
  }
  drops.instanceMatrix.needsUpdate = true;
  if (drops.instanceColor) drops.instanceColor.needsUpdate = true;

  // ---------- Rings ----------
  const ringGeo = new T.RingGeometry(0.93, 1, 40, 1);
  ringGeo.rotateX(-Math.PI / 2); // lie flat on the water
  const rings = [];
  const ringMats = [];
  for (let i = 0; i < MAX_RINGS; i++) {
    const mat = new T.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: T.DoubleSide,
      forceSinglePass: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new T.Mesh(ringGeo, mat);
    mesh.name = 'WaterRing' + i;
    mesh.visible = false;
    mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = true;
    group.add(mesh);
    ringMats.push(mat);
    rings.push({ mesh, mat, age: 0, life: 0, delay: 0, r0: 0.1, r1: 1, peak: RING_OPACITY });
  }
  let ringCursor = 0;

  function pickDrop() {
    // Prefer a dead slot; otherwise recycle round-robin (oldest-ish).
    for (let n = 0; n < MAX_DROPS; n++) {
      const i = (dropCursor + n) % MAX_DROPS;
      if (life[i] <= 0) { dropCursor = (i + 1) % MAX_DROPS; return i; }
    }
    const i = dropCursor;
    dropCursor = (dropCursor + 1) % MAX_DROPS;
    liveDrops--; // slot is being reused, will be re-counted on spawn
    return i;
  }

  function pickRing() {
    for (let n = 0; n < MAX_RINGS; n++) {
      const i = (ringCursor + n) % MAX_RINGS;
      if (rings[i].life <= 0) { ringCursor = (i + 1) % MAX_RINGS; return rings[i]; }
    }
    const r = rings[ringCursor];
    ringCursor = (ringCursor + 1) % MAX_RINGS;
    return r;
  }

  function spawnRing(x, y, z, s, delay) {
    const r = pickRing();
    r.age = 0;
    r.delay = delay;
    r.life = Math.min(MAX_LIFE - delay, 1.05 + 0.35 * s);
    r.r0 = 0.06 + 0.12 * s;
    r.r1 = 0.55 + 0.85 * s + Math.random() * 0.15;
    r.peak = RING_OPACITY * (0.55 + 0.45 * Math.min(1, s));
    r.mesh.position.set(x, y + 0.015, z);
    r.mesh.rotation.y = Math.random() * Math.PI * 2;
    r.mesh.scale.set(r.r0, 1, r.r0);
    r.mat.opacity = 0;
    r.mesh.visible = false; // becomes visible once delay elapses
  }

  function splash(x, y, z, strength = 1) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    let s = Number.isFinite(strength) ? strength : 1;
    s = Math.max(0.05, Math.min(2, s));
    const ss = Math.sqrt(s);

    const count = Math.min(MAX_DROPS, Math.round(4 + 14 * s));
    for (let n = 0; n < count; n++) {
      const i = pickDrop();
      const a = Math.random() * Math.PI * 2;
      const spread = (0.15 + Math.random() * 0.85) * (0.55 + 0.75 * s);
      const rad = Math.random() * 0.08 * (0.5 + s);
      px[i] = x + Math.cos(a) * rad;
      py[i] = y + 0.01;
      pz[i] = z + Math.sin(a) * rad;
      vx[i] = Math.cos(a) * spread;
      vz[i] = Math.sin(a) * spread;
      // Center drops jump higher, outer ones flatter: crown-like shape.
      vy[i] = (1.1 + Math.random() * 1.9) * ss * (1.15 - 0.45 * (spread / (1.3 + 0.75 * s)));
      floorY[i] = y - 0.04;
      age[i] = 0;
      life[i] = Math.min(MAX_LIFE, 0.55 + Math.random() * 0.6);
      size[i] = (0.014 + Math.random() * 0.022) * (0.7 + 0.3 * ss);
      tmpColor.copy(cream).lerp(teal, Math.random() * 0.6);
      drops.setColorAt(i, tmpColor);
      liveDrops++;
    }
    if (drops.instanceColor) drops.instanceColor.needsUpdate = true;
    drops.visible = true;

    spawnRing(x, y, z, s, 0);
    if (s >= 0.6) spawnRing(x, y, z, s * 0.75, 0.16);
  }

  function update(dt /*, time */) {
    let d = Number.isFinite(dt) ? dt : 0;
    if (d <= 0) return;
    if (d > MAX_DT) d = MAX_DT;

    // Drops
    if (liveDrops > 0) {
      let alive = 0;
      for (let i = 0; i < MAX_DROPS; i++) {
        if (life[i] <= 0) continue;
        age[i] += d;
        vy[i] -= GRAVITY * d;
        px[i] += vx[i] * d;
        py[i] += vy[i] * d;
        pz[i] += vz[i] * d;
        if (age[i] >= life[i] || (vy[i] < 0 && py[i] < floorY[i])) {
          life[i] = 0;
          drops.setMatrixAt(i, zeroMat);
          continue;
        }
        const t = age[i] / life[i];
        const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
        const sc = size[i] * (0.35 + 0.65 * fade);
        // Slight vertical stretch along motion reads as a falling droplet.
        const stretch = 1 + Math.min(0.8, Math.abs(vy[i]) * 0.18);
        tmpMat.makeScale(sc, sc * stretch, sc);
        tmpMat.setPosition(px[i], py[i], pz[i]);
        drops.setMatrixAt(i, tmpMat);
        alive++;
      }
      liveDrops = alive;
      drops.instanceMatrix.needsUpdate = true;
      if (alive === 0) drops.visible = false;
    }

    // Rings
    for (let k = 0; k < MAX_RINGS; k++) {
      const r = rings[k];
      if (r.life <= 0) continue;
      if (r.delay > 0) {
        r.delay -= d;
        if (r.delay > 0) continue;
        r.mesh.visible = true;
      } else if (!r.mesh.visible) {
        r.mesh.visible = true;
      }
      r.age += d;
      if (r.age >= r.life) {
        r.life = 0;
        r.mesh.visible = false;
        r.mat.opacity = 0;
        continue;
      }
      const t = r.age / r.life;
      const ease = 1 - (1 - t) * (1 - t) * (1 - t); // fast start, slow spread
      const rad = r.r0 + (r.r1 - r.r0) * ease;
      r.mesh.scale.set(rad, 1, rad);
      const fadeIn = t < 0.08 ? t / 0.08 : 1;
      r.mat.opacity = r.peak * fadeIn * (1 - t) * (1 - t);
    }
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (group.parent) group.parent.remove(group);
    group.remove(drops);
    for (const r of rings) group.remove(r.mesh);
    drops.dispose();
    dropGeo.dispose();
    dropMat.dispose();
    ringGeo.dispose();
    for (const m of ringMats) m.dispose();
    liveDrops = 0;
  }

  return { group, splash, update, dispose };
}

export default createWaterEffects;
