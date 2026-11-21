// Little Raft co-op - world-space effects for the second player.
// createPings:       "look here" markers (diamond + beam + ring), orange for mine, blue for theirs.
// createRemoteRope:  the brother's hook + rope line, same look as the local one, tinted toward his blue.
// createRemoteGhost: the brother's build preview tile with a pulsing outline.
// Nothing touches the DOM; all geometry/materials are created once and reused (no per-frame allocation).

const MINE = '#efae55', THEIRS = '#70a7e4';
const ROPE = '#e9d39a', GHOST_REMOTE = '#3d8ff0', GHOST_BAD = '#ee8e75';
const DECOR = new Set(['sail', 'palm', 'lantern', 'net', 'bench', 'crate']);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fin = Number.isFinite;   // fixed-arity checks below: no rest-arg arrays in per-frame paths
const fin2 = (a, b) => fin(a) && fin(b);
const fin3 = (a, b, c) => fin(a) && fin(b) && fin(c);
const groundY = (ocean, x, z) => (ocean ? ocean.getHeight(x, z) + 0.03 : -Infinity);

function disposeTree(root) {
  root.traverse(o => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material || [])) m.dispose?.();
  });
  root.parent?.remove(root);
}

// ---------------------------------------------------------------- pings
const PING_LIFE = 5, PER_OWNER = 3, BEAM_H = 7;

export function createPings(T, scene) {
  // shared geometry: a tall diamond, an open beam whose vertex alpha fades upward, a thin flat ring
  const diamondGeo = new T.OctahedronGeometry(0.3, 0); diamondGeo.scale(1, 1.45, 1);
  const beamGeo = new T.CylinderGeometry(0.03, 0.07, BEAM_H, 10, 6, true); beamGeo.translate(0, BEAM_H / 2, 0);
  { const p = beamGeo.attributes.position, c = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) { const a = 1 - p.getY(i) / BEAM_H; c.set([1, 1, 1, a * a * a], i * 4); }
    beamGeo.setAttribute('color', new T.BufferAttribute(c, 4)); }
  const ringGeo = new T.RingGeometry(0.78, 1, 40); ringGeo.rotateX(-Math.PI / 2); ringGeo.translate(0, 0.12, 0);
  const coreGeo = new T.CircleGeometry(0.16, 24); coreGeo.rotateX(-Math.PI / 2); coreGeo.translate(0, 0.12, 0);

  const slots = [];
  for (let i = 0; i < PER_OWNER * 2; i++) {
    const mine = i < PER_OWNER, col = new T.Color(mine ? MINE : THEIRS);
    const basic = o => new T.MeshBasicMaterial({ color: col, transparent: true, depthWrite: false, fog: false, ...o });
    const g = new T.Group(); g.visible = false; g.name = 'coopPing';
    const diamond = new T.Mesh(diamondGeo, new T.MeshBasicMaterial({ color: col, fog: false, transparent: true }));
    const xray = new T.Mesh(diamondGeo, basic({ depthTest: false, opacity: 0.3 })); // faint see-through copy
    const beam = new T.Mesh(beamGeo, basic({ depthTest: false, vertexColors: true, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false }));
    const ring = new T.Mesh(ringGeo, basic({ side: T.DoubleSide }));
    const core = new T.Mesh(coreGeo, basic({ side: T.DoubleSide }));
    xray.renderOrder = 20; beam.renderOrder = 19;
    for (const m of [diamond, xray, beam, ring, core]) { m.frustumCulled = false; g.add(m); }
    scene.add(g);
    slots.push({ g, diamond, xray, beam, ring, core, mine, born: -1, age: 0, x: 0, y: 0, z: 0, label: '' });
  }

  function add({ x, y, z, mine = false, label = '' } = {}) {
    if (!fin3(x, y, z)) return null;
    // reuse a free slot of this owner, else the oldest one
    let s = null;
    for (const c of slots) {
      if (c.mine !== !!mine) continue;
      if (c.born < 0) { s = c; break; }
      if (!s || c.age > s.age) s = c;
    }
    Object.assign(s, { born: 1, age: 0, x, y, z, label: String(label || '') });
    s.g.position.set(x, y, z); s.g.visible = true; s.g.userData.label = s.label;
    return s.g;
  }

  const cam = new T.Vector3();
  function update(dt, time, camera) {
    if (camera) camera.getWorldPosition(cam);
    for (const s of slots) {
      if (s.born < 0) continue;
      s.age += dt;
      if (s.age >= PING_LIFE) { s.born = -1; s.g.visible = false; continue; }
      const fade = Math.min(1, s.age / 0.2) * Math.min(1, (PING_LIFE - s.age) / 1.2);
      const pop = 1 + 0.6 * Math.max(0, 1 - s.age / 0.35) ** 2;           // little overshoot on spawn
      const d = camera ? cam.distanceTo(s.g.position) : 10;
      const k = clamp(0.35 + d * 0.065, 0.6, 7);                           // constant-ish screen size
      const bob = Math.sin(time * 3 + s.x) * 0.12 * k;
      s.diamond.position.y = s.xray.position.y = 1.1 * k + bob;
      s.diamond.rotation.y = s.xray.rotation.y = time * 1.6;
      s.diamond.scale.setScalar(k * pop); s.xray.scale.setScalar(k * pop);
      s.beam.scale.set(k, 1 + k * 0.15, k);
      s.core.scale.setScalar(k);
      const r = ((s.age * 0.8) % 1);                                        // ring pulses outward every 1.25 s
      s.ring.scale.setScalar(k * (0.4 + r * 1.6));
      s.diamond.material.opacity = fade;
      s.xray.material.opacity = 0.3 * fade;
      s.beam.material.opacity = 0.22 * fade;
      s.core.material.opacity = 0.55 * fade;
      s.ring.material.opacity = 0.9 * fade * (1 - r);
    }
  }

  function dispose() {
    for (const s of slots) for (const m of [s.diamond, s.xray, s.beam, s.ring, s.core]) m.material.dispose();
    for (const s of slots) s.g.parent?.remove(s.g);
    diamondGeo.dispose(); beamGeo.dispose(); ringGeo.dispose(); coreGeo.dispose();
    slots.length = 0;
  }
  return { add, update, dispose, get active() { return slots.filter(s => s.born >= 0).length; } };
}

// ---------------------------------------------------------------- remote rope + hook
const SEGS = 16, FLAT_Y = 0.05;   // FLAT_Y = hook-physics WATER_Y

// Low-poly third-person stand-in for hook.js's scrap hook (286 tris / 6 meshes instead of 8.8k / 18):
// same frame and proportions (wooden handle down -Y with rope wrap + dangling rope eye, iron shank
// curving up and over toward -Z, cone point), re-centred on its bounding box like createHook.
function createFlyingHook(T, tint) {
  const root = new T.Group(), inner = new T.Group(); root.add(inner);
  const M = (c, metalness, roughness) => new T.MeshStandardMaterial({ color: new T.Color(c).lerp(tint, 0.3), metalness, roughness });
  const steel = M(0x8ca8ac, 0.7, 0.3), iron = M(0x5f7376, 0.75, 0.45), wood = M(0x8a6a45, 0, 0.9), rope = M(0xb89a64, 0, 0.95);
  const add = (g, m, x = 0, y = 0, z = 0) => { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = false; inner.add(o); return o; };
  const HX = 0.2, R = 0.022;
  const curve = new T.CatmullRomCurve3([[HX, -0.08, 0], [HX, 0.12, -0.01], [0.17, 0.27, -0.05], [0.06, 0.38, -0.12], [-0.1, 0.4, -0.2],
    [-0.25, 0.34, -0.26], [-0.34, 0.2, -0.28], [-0.33, 0.06, -0.25], [-0.24, 0, -0.2], [-0.15, 0.04, -0.16], [-0.11, 0.11, -0.13]]
    .map(p => new T.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  add(new T.TubeGeometry(curve, 18, R, 5, false), steel);                       // 180 tris
  const end = curve.getPoint(1), dir = curve.getTangent(1).normalize();
  const tip = add(new T.ConeGeometry(R, 0.075, 5), steel);                      // 10
  tip.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); tip.position.copy(end).addScaledVector(dir, 0.0375);
  add(new T.CylinderGeometry(0.05, 0.053, 0.075, 5), iron, HX, -0.09, 0);       // ferrule, 20
  add(new T.CylinderGeometry(0.042, 0.046, 0.265, 5), wood, HX, -0.2575, 0);   // handle, 20
  add(new T.CylinderGeometry(0.05, 0.05, 0.16, 5), rope, HX, -0.25, 0);         // rope wrap, 20
  const eye = add(new T.TorusGeometry(0.04, 0.01, 3, 6), rope, HX + 0.13, -0.305, 0.03); // rope eye, 36
  eye.rotation.set(0.2, 0.3, 0.5);
  const box = new T.Box3().setFromObject(inner), c = new T.Vector3();
  inner.position.sub(box.getCenter(c));
  return root;
}

export function createRemoteRope(T, scene) {
  const tint = new T.Color(THEIRS);
  const attr = new T.BufferAttribute(new Float32Array((SEGS + 1) * 3), 3);
  attr.setUsage(T.DynamicDrawUsage);
  const geo = new T.BufferGeometry(); geo.setAttribute('position', attr);
  const line = new T.Line(geo, new T.LineBasicMaterial({ color: new T.Color(ROPE).lerp(tint, 0.35) }));
  line.frustumCulled = false; line.visible = false; line.name = 'coopRope';
  scene.add(line);

  const hook = createFlyingHook(T, tint); hook.scale.setScalar(0.5); hook.visible = false; hook.name = 'coopHook';
  scene.add(hook);

  let sag = 0, lift = 0, spin = 0;   // smoothed shape params so stage changes ease instead of popping
  function hide() { line.visible = false; hook.visible = false; }

  function update(dt, hand, h, ocean, time = 0) {
    if (!hand || !h || h.stage === 'done' || !fin3(hand.x, hand.y, hand.z) || !fin3(h.x, h.y, h.z)) { hide(); sag = lift = 0; return; }
    const st = h.stage, water = st === 'floating' || st === 'fishing';
    const dx = h.x - hand.x, dy = h.y - hand.y, dz = h.z - hand.z, d = Math.hypot(dx, dy, dz);
    const k = Math.min(1, dt * 6);
    // slack sag matches hook-physics ropePoints (span * 0.12 * slack, slack ~0.9 while floating); deeper sag
    // dragged the rope through the deck between the brother and the raft edge
    sag += ((water ? Math.min(1.2, d * 0.11) : st === 'reeling' ? d * 0.015 : 0) - sag) * k;
    lift += ((st === 'flying' ? Math.min(1.4, d * 0.12) : 0) - lift) * k;

    // sender reports flat physics water (y≈.05); map near-water heights onto the visible waves like game.js surfaceY
    let hy = h.y;
    if (ocean) { const w = groundY(ocean, h.x, h.z) + 0.01 + (h.y - FLAT_Y); hy = w + (h.y - w) * clamp((h.y - FLAT_Y) / 0.6, 0, 1); }
    if (water) hy += Math.sin(time * 2.2) * 0.015;

    const a = attr.array;
    for (let i = 0; i <= SEGS; i++) {
      const t = i / SEGS, bow = 4 * t * (1 - t);
      // skewed sag: slack rope hangs lowest nearer the hook end, like a catenary from a raised hand
      const x = hand.x + dx * t, z = hand.z + dz * t;
      let y = hand.y + (hy - hand.y) * t + lift * bow - sag * bow * (0.7 + 0.6 * t) * 0.8;
      if (water && i > 0) y = Math.max(y, groundY(ocean, x, z));
      a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
    }
    attr.needsUpdate = true; line.visible = true;

    // orient like the local hook: yaw faces along the throw
    const yaw = Math.atan2(-dx, -dz);
    hook.visible = true; hook.position.set(h.x, hy, h.z);
    if (st === 'flying') { spin += dt * 9; hook.rotation.set(-spin, yaw, 0); }
    else if (st === 'reeling') hook.rotation.set(-0.6, yaw, 0);
    else hook.rotation.set(0, yaw, 1.1);
  }

  function dispose() { disposeTree(line); disposeTree(hook); }
  return { update, dispose, line, hook };
}

// ---------------------------------------------------------------- remote build ghost
export function createRemoteGhost(T, scene) {
  // saturated blue: the pale mint/blue mix vanished against the light sea from the other player's view
  const okCol = new T.Color(GHOST_REMOTE), badCol = new T.Color(GHOST_BAD);
  const box = new T.BoxGeometry(1.9, 0.13, 1.9);
  const edges = new T.EdgesGeometry(box);
  const g = new T.Group(); g.name = 'coopGhost'; g.visible = false;
  const body = new T.Mesh(box, new T.MeshBasicMaterial({ color: okCol.clone(), transparent: true, opacity: 0, depthWrite: false }));
  const outline = new T.LineSegments(edges, new T.LineBasicMaterial({ color: okCol.clone(), transparent: true, opacity: 0, depthWrite: false }));
  body.renderOrder = 2; outline.renderOrder = 3;
  g.add(body, outline); scene.add(g);

  let alpha = 0, red = 0, foot = 1, have = false, last = NaN;
  const target = new T.Vector3(), white = new T.Color('#ffffff');

  function update(ghost, deckY = 0.2, time = 0) {
    const dt = Number.isFinite(last) && time > last ? Math.min(0.1, time - last) : 1 / 60; last = time;
    const on = !!ghost && fin2(ghost.x, ghost.z);
    if (on) {
      target.set(ghost.x * 2, (Number.isFinite(deckY) ? deckY : 0.2) + 0.09, ghost.z * 2);
      if (!have || g.position.distanceTo(target) > 2.5) g.position.copy(target);   // snap on jumps, glide on neighbours
      else g.position.lerp(target, Math.min(1, dt * 18));
      have = true;
      const decor = DECOR.has(ghost.kind);
      foot += ((decor ? 0.9 / 1.9 : 1) - foot) * Math.min(1, dt * 12);
      red += ((ghost.ok === false ? 1 : 0) - red) * Math.min(1, dt * 10);
    }
    alpha += ((on ? 1 : 0) - alpha) * Math.min(1, dt * 8);
    if (!on && alpha < 0.02) { g.visible = false; have = false; alpha = 0; return; }
    g.visible = true;
    g.scale.set(foot, 1, foot);
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.2);
    body.material.color.copy(okCol).lerp(badCol, red);
    outline.material.color.copy(body.material.color).lerp(white, (0.15 + 0.3 * pulse) * (1 - 0.6 * red));
    body.material.opacity = (0.55 + 0.05 * red) * alpha;
    outline.material.opacity = (0.55 + 0.45 * pulse) * alpha;
  }

  function dispose() { disposeTree(g); }
  return { update, dispose, group: g };
}
