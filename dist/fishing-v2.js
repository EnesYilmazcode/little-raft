// Fishing v2: pure FishingSession state machine + createFishingV2(T, opts) visuals (bobber, line, splash, reel HUD).
// The pure part needs no THREE/DOM and is deterministic given an injected rand() -> [0,1).
// API:
//   FISHING_TUNING                               tuning constants (ours)
//   new FishingSession({ rand, night })
//     .stage  'idle'|'charging'|'flying'|'waiting'|'nibble'|'bite'|'reeling'|'caught'|'escaped'|'done'
//     .charge .castDistance .catch {species,cm,stars}|null .progress .tension .pulling .holding
//     .stageT (s in stage) .flightTime .reason ('early'|'missed'|'snapped' once escaped)
//     startCharge() releaseCast()->m press()->bool release() cancel() debugForceBite(speciesId?)
//     update(dt) -> null | {kind:'landed'|'nibble'|'bite'|'missed'|'caught'|'escaped'|'done', catch?, reason?}
//   createFishingV2(T, { scene, ocean }) -> { bobber, line, hud:{el, update(session)}, splash(x,y,z),
//     update(dt, session, { tip, origin, dir, time }), dispose() }
import { rollCatch, biteDelay, speciesById } from './fish-species.js?build=v3-survival-ae77fa84ac2b';

export const FISHING_TUNING = {
  chargeMs: 1100, minCast: 4, maxCast: 18, bobberFlight: 0.9, nibbleCount: [0, 2], nibbleTime: 0.28,
  wait: [4, 9], biteWindow: 1.1, endLinger: 0.7,
  reelTime: 3.5, reelFight: 0.6, pullReel: 0.35, progressDecay: 0.04,
  tensionRise: 0.32, pullRise: 0.25, pullDrag: 0.12, tensionFall: 0.6, jolt: 0.3, joltFight: 0.2,
  pullGap: [1.4, 3.2], pullLen: [0.5, 1.1],
}; // plain object so the glue/QA can tweak
const F = FISHING_TUNING, clamp01 = (v) => (v > 1 ? 1 : v > 0 ? v : 0);

export class FishingSession {
  constructor({ rand = Math.random, night = false } = {}) {
    this.rand = () => { const v = Number(rand()); return Number.isFinite(v) ? clamp01(v) : 0.5; };
    this.night = !!night;
    this.stage = 'idle'; this.stageT = 0; this.charge = 0; this.castDistance = 0; this.flightTime = F.bobberFlight;
    this.catch = null; this.progress = 0; this.tension = 0; this.pulling = false; this.holding = false; this.reason = null;
    this._wait = 0; this._nibbles = []; this._misses = 0; this._pullT = 0; this._pending = null;
  }
  _range(r) { return r[0] + (r[1] - r[0]) * this.rand(); }
  _set(stage) { this.stage = stage; this.stageT = 0; }
  _startWait(sec) {
    this._wait = sec; this._set('waiting');
    const n = Math.round(this._range(F.nibbleCount)); this._nibbles.length = 0;
    for (let i = 0; i < n; i++) this._nibbles.push(sec * (0.25 + 0.6 * this.rand()));
    this._nibbles.sort((a, b) => b - a); // pop() yields the earliest
    this._waitT = 0;
  }
  _escape(reason) { this.reason = reason; this.pulling = false; this.holding = false; this._set('escaped'); return { kind: 'escaped', reason }; }
  _bite() {
    if (!this.catch) this.catch = rollCatch(this.rand, { charge: this.charge, night: this.night });
    this._set('bite'); return { kind: 'bite' };
  }
  startCharge() { if (this.stage !== 'idle') return false; this.charge = 0; this._set('charging'); return true; }
  releaseCast() {
    if (this.stage !== 'charging') return 0;
    this.charge = clamp01(this.charge);
    this.castDistance = F.minCast + (F.maxCast - F.minCast) * this.charge;
    this.flightTime = F.bobberFlight * (0.7 + 0.3 * this.charge);
    this._set('flying'); return this.castDistance;
  }
  press() {
    const s = this.stage;
    if (s === 'bite') { this._set('reeling'); this.holding = true; this.progress = 0.04; this.tension = 0.1; this._pullT = this._range(F.pullGap) * 0.5; return true; }
    if (s === 'waiting' || s === 'nibble') { this._pending = this._escape('early'); return true; }
    if (s === 'reeling') { this.holding = true; return true; }
    if (s === 'idle') return this.startCharge();
    return s === 'charging' || s === 'flying';
  }
  release() { this.holding = false; if (this.stage === 'charging') this.releaseCast(); }
  cancel() { this.pulling = false; this.holding = false; this._pending = null; this._set('done'); }
  debugForceBite(speciesId) {
    if (!['flying', 'waiting', 'nibble', 'bite'].includes(this.stage)) return false;
    if (this.stage === 'flying' && !this.castDistance) this.releaseCast();
    this.catch = rollCatch(this.rand, { charge: this.charge, night: this.night });
    const sp = speciesById(speciesId);
    if (sp) this.catch = { species: sp.id, cm: Math.round((sp.minCm + sp.maxCm) * 5) / 10, stars: 2 };
    this._pending = this._bite(); return true;
  }
  update(dt) {
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    if (this._pending) { const e = this._pending; this._pending = null; return e; }
    this.stageT += dt;
    switch (this.stage) {
      case 'charging': this.charge = clamp01(this.charge + dt * 1000 / F.chargeMs); return null;
      case 'flying':
        if (this.stageT < this.flightTime) return null;
        this._startWait(this._range(F.wait) * (1 - 0.3 * this.charge)); return { kind: 'landed' };
      case 'waiting':
        this._waitT += dt;
        if (this._waitT >= this._wait) return this._bite();
        if (this._nibbles.length && this._waitT >= this._nibbles[this._nibbles.length - 1]) {
          this._nibbles.pop(); this.stage = 'nibble'; this.stageT = 0; return { kind: 'nibble' };
        }
        return null;
      case 'nibble':
        this._waitT += dt;
        if (this.stageT >= F.nibbleTime) this.stage = 'waiting';
        return null;
      case 'bite':
        if (this.stageT < F.biteWindow) return null;
        if (++this._misses >= 2) return this._escape('missed');
        this._startWait(biteDelay(this.rand, this.catch.species) * 0.6); return { kind: 'missed' };
      case 'reeling': return this._reel(dt);
      case 'caught': case 'escaped':
        if (this.stageT < F.endLinger) return null;
        this._set('done'); return { kind: 'done' };
    }
    return null;
  }
  _reel(dt) {
    const fight = clamp01(speciesById(this.catch?.species)?.fight ?? 0.5);
    this._pullT -= dt;
    if (this._pullT <= 0) {
      this.pulling = !this.pulling;
      if (this.pulling) { this._pullT = this._range(F.pullLen) * (0.7 + 0.6 * fight); this.tension += F.jolt * (1 + F.joltFight * (fight - 0.5)) * (0.4 + 0.6 * this.rand()); }
      else this._pullT = this._range(F.pullGap) * (1 - 0.4 * fight);
    }
    if (this.holding) {
      this.progress += dt / (F.reelTime * (1 + F.reelFight * fight)) * (this.pulling ? F.pullReel : 1);
      this.tension += dt * (F.tensionRise + (this.pulling ? F.pullRise * (0.5 + fight) : 0));
    } else {
      this.progress -= dt * F.progressDecay * (this.pulling ? 2 : 1);
      this.tension += dt * (this.pulling ? F.pullDrag * fight : 0) - dt * F.tensionFall;
    }
    this.progress = clamp01(this.progress); this.tension = clamp01(this.tension);
    if (this.tension >= 1) return this._escape('snapped');
    if (this.progress >= 1) { this.pulling = false; this.holding = false; this._set('caught'); return { kind: 'caught', catch: this.catch }; }
    return null;
  }
}

// ---------------------------------------------------------------- visuals
const CSS = `#fcReelHud{position:fixed;left:50%;top:calc(50% + 58px);transform:translateX(-50%);width:150px;z-index:4;
pointer-events:none;display:none;font:600 12px/1.2 system-ui,sans-serif;color:#fffdf4;text-align:center;text-shadow:0 1px 2px #0b3a44}
#fcReelHud.show{display:block}#fcReelHud .bar{height:8px;border-radius:5px;background:#0d3d4766;box-shadow:0 0 0 1.5px #fffdf4aa;overflow:hidden;margin-top:5px}
#fcReelHud .bar i{display:block;height:100%;width:0;border-radius:5px;background:#fffdf4}
#fcReelHud .t i{background:#7ed69a}#fcReelHud .t.amber i{background:#f5b94a}#fcReelHud .t.red i{background:#ef5d4a}
#fcReelHud .p{height:5px}#fcReelHud .p i{background:#8fe3ef}#fcReelHud b{display:block;margin-top:4px;font-weight:700}`;

function createHud() {
  if (typeof document === 'undefined') return { el: null, update() {}, dispose() {} };
  if (!document.getElementById('fc-style-reel')) {
    const st = document.createElement('style'); st.id = 'fc-style-reel'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('div'); el.id = 'fcReelHud'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="bar t"><i></i></div><div class="bar p"><i></i></div><b></b>';
  document.body.appendChild(el);
  const tBar = el.children[0], tFill = tBar.firstChild, pBar = el.children[1], pFill = pBar.firstChild, txt = el.children[2];
  let shown = false, mode = '', tw = -1, pw = -1, cls = '', text = null;
  const width = (fill, v, last) => { if (Math.abs(v - last) <= 0.01) return last; fill.style.width = (v * 100).toFixed(1) + '%'; return v; };
  return {
    el,
    update(s) {
      const m = s?.stage === 'charging' ? 'charge' : s?.stage === 'reeling' ? 'reel' : '';
      if (!!m !== shown) { shown = !!m; el.classList.toggle('show', shown); }
      if (!m) return;
      if (m !== mode) { mode = m; pBar.style.display = m === 'reel' ? '' : 'none'; tw = pw = -1; }
      const tv = m === 'reel' ? s.tension : s.charge;
      tw = width(tFill, tv, tw);
      const c = m === 'charge' ? '' : tv > 0.75 ? 'red' : tv > 0.45 ? 'amber' : '';
      if (c !== cls) { if (cls) tBar.classList.remove(cls); if (c) tBar.classList.add(c); cls = c; }
      if (m === 'reel') pw = width(pFill, s.progress, pw);
      const tx = m === 'charge' ? 'Cast power' : tv > 0.7 ? 'Ease off!' : s.holding ? 'Reeling...' : 'Reel! Hold click';
      if (tx !== text) { txt.textContent = tx; text = tx; }
    },
    dispose() { el.remove(); if (!document.getElementById('fcReelHud')) document.getElementById('fc-style-reel')?.remove(); }, // hot swap: keep it for the new HUD
  };
}

// A flat indexed geometry plus a reversed-winding, flipped-normal copy: looks the same as side: DoubleSide
// but lets the material use the plain front-sided program.
function twoSided(T, g) {
  const n = g.attributes.position.count, idx = g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i);
  const out = new T.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const arr = new Float32Array(n * 2 * a.itemSize); arr.set(a.array); arr.set(a.array, n * a.itemSize);
    if (name === 'normal') for (let i = n * 3; i < arr.length; i++) arr[i] = -arr[i];
    out.setAttribute(name, new T.BufferAttribute(arr, a.itemSize));
  }
  const back = []; for (let i = 0; i < idx.length; i += 3) back.push(idx[i] + n, idx[i + 2] + n, idx[i + 1] + n);
  out.setIndex(idx.concat(back)); g.dispose();
  return out;
}

export function createFishingV2(T, { scene, ocean } = {}) {
  const geos = [], mats = [];
  const G = (g) => (geos.push(g), g), M = (m) => (mats.push(m), m);
  const corkMat = M(new T.MeshStandardMaterial({ color: 0xc89a62, roughness: 0.85 }));
  const tealMat = M(new T.MeshStandardMaterial({ color: 0x1f9e9a, roughness: 0.5 }));
  const whiteMat = M(new T.MeshStandardMaterial({ color: 0xe8452c, roughness: 0.45 })); // red cap: reads against teal water, matches the rod's hanging float
  const pinMat = M(new T.MeshStandardMaterial({ color: 0x3a3430, roughness: 0.6 }));
  const flagMat = M(new T.MeshStandardMaterial({ color: 0xf2a83b, roughness: 0.6 })); // front-sided: the flag geometry carries its own back face
  const bobber = new T.Group(); bobber.name = 'fcBobber';
  const part = (geo, mat, y, sy = 1) => { const m = new T.Mesh(G(geo), mat); m.position.y = y; m.scale.y = sy; bobber.add(m); return m; };
  part(new T.SphereGeometry(0.032, 14, 7, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), corkMat, 0, 1.15);   // cork belly
  part(new T.CylinderGeometry(0.0325, 0.0325, 0.014, 14), tealMat, 0.006);                              // teal band
  part(new T.SphereGeometry(0.032, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), whiteMat, 0.013, 0.8);        // white cap
  part(new T.CylinderGeometry(0.0022, 0.0018, 0.06, 5), pinMat, 0.06);                                   // pin
  const flagShape = new T.Shape(); flagShape.moveTo(0, 0); flagShape.lineTo(0.026, -0.008); flagShape.lineTo(0, -0.017);
  const flag = new T.Mesh(G(twoSided(T, new T.ShapeGeometry(flagShape))), flagMat); flag.position.set(0.001, 0.088, 0); bobber.add(flag);
  bobber.visible = false;

  const N = 24, pos = new Float32Array(N * 3), lineGeo = G(new T.BufferGeometry());
  const attr = new T.BufferAttribute(pos, 3); attr.setUsage(T.DynamicDrawUsage); lineGeo.setAttribute('position', attr);
  const line = new T.Line(lineGeo, M(new T.LineBasicMaterial({ color: 0xf4f0e2, transparent: true, opacity: 0.85 })));
  line.frustumCulled = false; line.visible = false; line.name = 'fcLine';

  const ringGeo = G(new T.RingGeometry(0.8, 1, 28)), rings = [];
  for (let i = 0; i < 4; i++) {
    const r = new T.Mesh(ringGeo, M(new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })));
    r.rotation.x = -Math.PI / 2; r.visible = false; r.userData.t = 9; rings.push(r); scene?.add(r);
  }
  let ringNext = 0;
  function splash(x, y, z) { const r = rings[ringNext]; ringNext = (ringNext + 1) % rings.length; r.position.set(x, y + 0.01, z); r.userData.t = 0; r.visible = true; }

  scene?.add(bobber); scene?.add(line);
  const hud = createHud();
  const H = (x, z) => (ocean ? ocean.getHeight(x, z) : 0);
  const start = new T.Vector3(), land = new T.Vector3(), p = new T.Vector3(), top = new T.Vector3();
  let lastSession = null, lastStage = '', vy = 0, side = 0;

  function update(dt, session, { tip, origin, dir, time = 0 } = {}) {
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    for (const r of rings) {
      if (!r.visible) continue;
      const t = (r.userData.t += dt), k = t / 0.9;
      if (k >= 1) { r.visible = false; continue; }
      r.scale.setScalar(0.06 + k * 0.5); r.material.opacity = 0.75 * (1 - k);
    }
    hud.update(session);
    const st = session?.stage || 'idle';
    if (!tip || st === 'idle' || st === 'charging' || st === 'done') { bobber.visible = line.visible = false; lastStage = st; lastSession = session; return; }
    if (session !== lastSession || (st === 'flying' && lastStage !== 'flying')) {
      start.copy(tip); const o = origin || tip;
      const dx = dir?.x || 0, dz = dir?.z || 0, l = Math.hypot(dx, dz) || 1;
      land.set(o.x + dx / l * session.castDistance, 0, o.z + dz / l * session.castDistance);
      land.y = H(land.x, land.z); p.copy(start); vy = 0; side = 0;
    }
    const prev = lastStage, entered = st !== prev; lastStage = st; lastSession = session;
    let h;
    if (st === 'flying') {
      const u = clamp01(session.stageT / (session.flightTime || 1));
      land.y = H(land.x, land.z);
      p.lerpVectors(start, land, u); p.y += Math.sin(u * Math.PI) * (0.8 + session.castDistance * 0.1);
      bobber.rotation.set(u * 5, 0, u * 3); vy = 0;
    } else if (st === 'caught' || st === 'escaped') {
      const k = Math.min(1, dt * 7); p.lerp(tip, k); p.y += dt * 0.6;
      bobber.rotation.set(0, 0, 0);
    } else {
      if (st === 'reeling') {
        const pr = session.progress * 0.9;
        const px = -(land.z - tip.z), pz = land.x - tip.x, pl = Math.sqrt(px * px + pz * pz) || 1;
        side += ((session.pulling ? Math.sin(time * 9) * 0.35 : 0) - side) * Math.min(1, dt * 6);
        p.x = land.x + (tip.x - land.x) * pr + px / pl * side; p.z = land.z + (tip.z - land.z) * pr + pz / pl * side;
      } else { p.x = land.x; p.z = land.z; }
      if (prev === 'flying' && st !== 'flying') splash(p.x, H(p.x, p.z), p.z);
      if (entered && st === 'bite') splash(p.x, H(p.x, p.z), p.z);
      h = H(p.x, p.z);
      let off = 0.012;
      if (st === 'nibble') off -= 0.05 * Math.sin(Math.PI * Math.min(1, session.stageT / FISHING_TUNING.nibbleTime));
      else if (st === 'bite') off -= 0.18;
      else if (st === 'reeling') off -= session.pulling ? 0.07 : 0.02;
      vy += ((h + off - p.y) * 140 - vy * 13) * dt; p.y += vy * dt;
      const e = 0.4, sx = (H(p.x + e, p.z) - H(p.x - e, p.z)) / (2 * e), sz = (H(p.x, p.z + e) - H(p.x, p.z - e)) / (2 * e);
      bobber.rotation.set(-sz * 1.1 + (st === 'reeling' ? side * 0.6 : 0), 0, sx * 1.1);
    }
    // keep the float readable out on the water: grow with distance from the rod tip (1x close, up to 3x far)
    const bs = Math.min(3, Math.max(1, tip.distanceTo(p) / 3.5));
    bobber.position.copy(p); bobber.scale.setScalar(bs); bobber.visible = true;
    // line: tip -> bobber top with a sag that tightens with tension
    top.set(p.x, p.y + 0.06 * bs, p.z);
    const dist = tip.distanceTo(top);
    const sag = st === 'flying' ? 0.05 * dist : (st === 'reeling' ? 1 - session.tension * 0.9 : 1) * Math.min(0.5, 0.04 + dist * 0.03);
    const floor = (h ?? H(p.x, p.z)) - 0.02;
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      let y = tip.y + (top.y - tip.y) * s - sag * 4 * s * (1 - s);
      if (s > 0.5 && y < floor) y = floor;
      pos[i * 3] = tip.x + (top.x - tip.x) * s; pos[i * 3 + 1] = y; pos[i * 3 + 2] = tip.z + (top.z - tip.z) * s;
    }
    attr.needsUpdate = true; line.visible = true;
  }

  function dispose() {
    scene?.remove(bobber); scene?.remove(line); for (const r of rings) scene?.remove(r);
    geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); hud.dispose();
  }
  return { bobber, line, hud, splash, update, dispose };
}
