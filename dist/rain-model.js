// Procedural rain barrel (banded tub with a leaf funnel and a pip gauge) and sprinkler
// (copper tank, pipe and a spinning two-arm head with a spray of points).
// Imports nothing: callers pass THREE in as T. Origin = floor top. docs/specs/rain-sprinkler.md section 9.

const PIP_ON = 0x9ad7f0, PIP_OFF = 0x4a3a2a, SPRAY_N = 24, TAU = Math.PI * 2;

function kit(T, g) {
  const std = (hex, rough = .8, metal = 0, extra = {}) => new T.MeshStandardMaterial({color:hex, roughness:rough, metalness:metal, ...extra});
  const add = (parent, geo, mat, name, x = 0, y = 0, z = 0, shadow = true) => {
    const m = new T.Mesh(geo, mat); if (name) m.name = name; m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = shadow; parent.add(m); return m;
  };
  const pips = (name, n, y0, dy, z, size) => {
    const grp = new T.Group(); grp.name = name; g.add(grp);
    // One material per pip, recoloured in place: swapping shared on/off materials would leave the unused
    // one outside the scene graph, where rebuildRaft's disposeGeometry never finds it (leak per rebuild).
    for (let i = 0; i < n; i++) add(grp, new T.BoxGeometry(size, size, .02), std(PIP_OFF, .9, 0, {emissive:PIP_ON, emissiveIntensity:0}), name + i, 0, y0 + i * dy, z, false);
    return grp;
  };
  return {std, add, pips};
}

function lightPips(grp, n) {
  const c = grp.children;
  for (let i = 0; i < c.length; i++) {
    const m = c[i].material, on = i < n;
    m.color.setHex(on ? PIP_ON : PIP_OFF); m.emissiveIntensity = on ? .6 : 0; m.roughness = on ? .3 : .9;
  }
}

// Round spray drops: discard the corners of each square point sprite (no texture, no allocation).
function roundPoints(mat) {
  mat.onBeforeCompile = (s) => { s.fragmentShader = s.fragmentShader.replace('void main() {', 'void main() {\n\tif ( length( gl_PointCoord - vec2( .5 ) ) > .5 ) discard;'); };
  mat.customProgramCacheKey = () => 'rain-round-points';
  return mat;
}

export function createRainBarrel(T) {
  const g = new T.Group(); g.name = 'craft_rainbarrel';
  const {std, add, pips} = kit(T, g);
  add(g, new T.CylinderGeometry(.26, .23, .52, 12, 1, true), std(0x9c7649, .9, 0, {side:T.DoubleSide}), 'barrelBody', 0, .28, 0);
  add(g, new T.CircleGeometry(.23, 12), std(0x7d5d38, .95), 'barrelFloor', 0, .03, 0).rotation.x = -Math.PI / 2;
  const hoops = new T.Group(); hoops.name = 'barrelHoops'; g.add(hoops);
  const steel = std(0x76838a, .45, .7);
  for (const y of [.12, .44]) add(hoops, new T.TorusGeometry(.25, .012, 6, 24), steel, null, 0, y, 0).rotation.x = Math.PI / 2;
  add(g, new T.CylinderGeometry(.34, .2, .18, 12, 1, true), std(0x6f9a4a, .85, 0, {side:T.DoubleSide, flatShading:true}), 'barrelFunnel', 0, .63, 0);
  const water = add(g, new T.CircleGeometry(.22, 16), std(0x7fc4dc, .2, 0, {emissive:0x2a6f8a, emissiveIntensity:.25}), 'barrelWater', 0, .06, 0, false);
  water.rotation.x = -Math.PI / 2; water.visible = false;
  const ripple = add(g, new T.RingGeometry(.08, .1, 20), new T.MeshBasicMaterial({color:0xe8f7ff, transparent:true, opacity:.7, depthWrite:false, side:T.DoubleSide}), 'barrelRipple', 0, .065, 0, false);
  ripple.rotation.x = -Math.PI / 2; ripple.visible = false;
  pips('barrelPips', 4, .14, .1, .27, .05);
  g.userData.craftType = 'rainbarrel';
  g.userData.height = .8;
  paintRainBarrel(g, null, false, 0);
  return g;
}

export function paintRainBarrel(g, entry, raining, elapsed) {
  const ud = g.userData, w = entry?.w ?? 0, sig = w * 2 + (raining ? 1 : 0); // numeric: no per-frame string
  if (!ud.parts) { const get = n => g.getObjectByName(n); ud.parts = {water:get('barrelWater'), ripple:get('barrelRipple'), pips:get('barrelPips')}; }
  const p = ud.parts;
  if (ud.sig !== sig) {
    ud.sig = sig;
    p.water.visible = w > 0;
    p.water.position.y = .06 + .44 * (w / 4);
    lightPips(p.pips, w);
    p.ripple.visible = !!raining;
    p.ripple.position.y = (w > 0 ? p.water.position.y : .03) + .005;
  }
  if (!raining) return;
  const ph = ((elapsed * 1.2) % 1 + 1) % 1;
  p.ripple.scale.setScalar(1 + ph * 1.4);
  p.ripple.material.opacity = .7 * (1 - ph);
}

export function createSprinkler(T) {
  const g = new T.Group(); g.name = 'craft_sprinkler';
  const {std, add, pips} = kit(T, g);
  add(g, new T.CylinderGeometry(.14, .14, .2, 16), std(0xb87333, .4, .6), 'sprinklerTank', 0, .1, 0);
  pips('sprinklerPips', 3, .05, .05, .15, .035);
  const steel = std(0x76838a, .45, .7);
  add(g, new T.CylinderGeometry(.02, .02, .32, 8), steel, 'sprinklerPipe', 0, .36, 0);
  const head = new T.Group(); head.name = 'sprinklerHead'; head.position.y = .54; g.add(head);
  add(head, new T.SphereGeometry(.035, 10, 8), steel, 'sprinklerHub');
  for (let i = 0; i < 2; i++) {
    const arm = new T.Group(); arm.rotation.y = i * Math.PI / 2; head.add(arm);
    add(arm, new T.BoxGeometry(.26, .018, .018), steel, 'sprinklerArm' + i);
    for (const s of [-1, 1]) { const tip = add(arm, new T.BoxGeometry(.018, .04, .018), steel, null, s * .13, .012, s * .01); tip.rotation.z = -s * .6; }
  }
  const pos = new Float32Array(SPRAY_N * 3);
  for (let i = 0; i < SPRAY_N; i++) pos[i * 3 + 1] = .56;
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  const spray = new T.Points(geo, roundPoints(new T.PointsMaterial({color:0xcfefff, size:.05, transparent:true, opacity:.8, depthWrite:false})));
  spray.name = 'spray'; spray.frustumCulled = false; spray.visible = false; g.add(spray);
  spray.raycast = () => {}; // Points raycast with the default 1 m threshold (even while hidden) would steal aims from nearby palms

  g.userData.craftType = 'sprinkler';
  g.userData.height = .6;
  paintSprinkler(g, null, 0, false);
  return g;
}

export function paintSprinkler(g, entry, elapsed, inView) {
  const ud = g.userData, w = entry?.w ?? 0;
  if (!ud.parts) { const get = n => g.getObjectByName(n); ud.parts = {head:get('sprinklerHead'), spray:get('spray'), pips:get('sprinklerPips')}; }
  const p = ud.parts;
  if (ud.sig !== w) { ud.sig = w; lightPips(p.pips, w); }
  const active = entry?.s > 0;
  if (active) p.head.rotation.y = elapsed * 6;
  if (!active || !inView) { p.spray.visible = false; return; }
  p.spray.visible = true;
  const attr = p.spray.geometry.attributes.position, a = attr.array;
  for (let i = 0; i < SPRAY_N; i++) {
    const ang = elapsed * 6 + i * TAU / SPRAY_N, ph = ((elapsed * 1.5 + i / SPRAY_N) % 1 + 1) % 1, r = ph * .9;
    a[i * 3] = Math.cos(ang) * r; a[i * 3 + 1] = .56 + ph * .35 - ph * ph * .6; a[i * 3 + 2] = Math.sin(ang) * r;
  }
  attr.needsUpdate = true;
}
