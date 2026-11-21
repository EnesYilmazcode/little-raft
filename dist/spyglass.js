// Spyglass content module: hold Aim (RMB / pad LT) with a Spyglass or the Binoculars to zoom the view.
// A round lens vignette fades in, the crosshair clutter hides, and a small label under the crosshair
// names the best thing in a ~4 degree cone: an island (name + distance), the signal cache, a bottle,
// a barrel or other floating debris. Purely local: no world state, no serialize, no action, nothing
// saved or sent. game.js reads content.zoom() once per frame for the FOV, look speed and camera motion.
// Spec: docs/specs/spyglass.md. Pure exports below are node-importable (no DOM/THREE at module scope).
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b'; // same specifier as content.js: one shared instance
import { islandName, distText } from './maptable.js?build=v3-survival-ae77fa84ac2b';

export const SPY = Object.freeze({ ZOOM: Object.freeze({ spyglass: 3, binoculars: 4.5 }), EASE_S: 0.18, CONE_DEG: 2, // half-angle: 4 deg cone
  STICKY_DEG: 0.75, ISLAND_BIAS_DEG: 1, ITEM_RANGE: 200, ISLAND_RANGE: 1200, LABEL_AT: 0.5, HIDE_VM_AT: 0.6, VIGNETTE_STEPS: 20 });
export const ITEM_LABEL = Object.freeze({ cache: 'Signal cache', bottle: 'Message in a bottle', barrel: 'Barrel',
  wood: 'Plank', plastic: 'Plastic jug', scrap: 'Scrap', leaf: 'Leaves' }); // copy of game.js ITEM_NAMES, capitalised

const DEG = 180 / Math.PI;
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

// Zoom factor for a held kind; 0 = this kind cannot zoom.
export const zoomFor = kind => (own(SPY.ZOOM, kind) ? SPY.ZOOM[kind] : 0);

// Move t (0..1) toward on ? 1 : 0 at 1 / EASE_S per second.
export function easeStep(t, dt, on) {
  if (!(dt >= 0)) return t;
  const v = t + (on ? 1 : -1) * (dt / SPY.EASE_S);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Smoothstepped zoom between 1 and Z.
export function zoomAt(t, Z) {
  if (!(Z > 1)) return 1;
  const c = t < 0 ? 0 : t > 1 ? 1 : t, s = c * c * (3 - 2 * c);
  return 1 + (Z - 1) * s;
}

// Degrees between unit forward f and direction d (any length); d == 0 -> 180.
export function angleTo(fx, fy, fz, dx, dy, dz) {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(len > 0)) return 180;
  let c = (fx * dx + fy * dy + fz * dz) / len;
  c = c > 1 ? 1 : c < -1 ? -1 : c;
  return Math.acos(c) * DEG;
}

let islKeySeed = null, islKeyStr = '';
const islKey = seed => { if (seed !== islKeySeed) { islKeySeed = seed; islKeyStr = 'isl:' + seed; } return islKeyStr; };

// Best target in the cone from (px,py,pz) along unit f. items: world.items [{type,x,z,token}] (y = seaY);
// isl: islandNow() shape {seed,cx,gy,cz,R} or null. Writes {key, kind, seed, d} into out, or returns null.
export function pick(px, py, pz, fx, fy, fz, items, isl, seaY, prevKey, out) {
  const cone = SPY.CONE_DEG, stickyMax = cone + SPY.STICKY_DEG;
  let bS = Infinity, bKey = null, bKind = null, bSeed = 0, bD = 0;
  let pS = Infinity, pKind = null, pSeed = 0, pD = 0, pFound = false;
  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || !own(ITEM_LABEL, it.type)) continue;
      const dx = it.x - px, dz = it.z - pz, dh = Math.sqrt(dx * dx + dz * dz);
      if (!(dh >= 1 && dh <= SPY.ITEM_RANGE)) continue;
      const s = angleTo(fx, fy, fz, dx, seaY - py, dz);
      if (s < bS) { bS = s; bKey = it.token; bKind = it.type; bSeed = 0; bD = dh; }
      if (prevKey !== null && prevKey !== undefined && it.token === prevKey && s < pS) { pS = s; pKind = it.type; pSeed = 0; pD = dh; pFound = true; }
    }
  }
  if (isl && Number.isFinite(isl.cx) && Number.isFinite(isl.cz) && isl.R > 0) {
    const dx = isl.cx - px, dy = (Number.isFinite(isl.gy) ? isl.gy : seaY) - py, dz = isl.cz - pz;
    const dh = Math.sqrt(dx * dx + dz * dz), d3 = Math.sqrt(dh * dh + dy * dy);
    if (dh <= SPY.ISLAND_RANGE && dh > isl.R) {
      const half = Math.asin(Math.min(1, isl.R / d3)) * DEG;
      const a = angleTo(fx, fy, fz, dx, dy, dz) - half;
      const s = (a > 0 ? a : 0) + SPY.ISLAND_BIAS_DEG, key = islKey(isl.seed), ds = dh - isl.R;
      if (s < bS) { bS = s; bKey = key; bKind = 'island'; bSeed = isl.seed; bD = ds; }
      if (prevKey === key && s < pS) { pS = s; pKind = 'island'; pSeed = isl.seed; pD = ds; pFound = true; }
    }
  }
  if (pFound && pS <= stickyMax && (bS > cone || pS - bS < SPY.STICKY_DEG)) {
    out.key = prevKey; out.kind = pKind; out.seed = pSeed; out.d = pD; return out;
  }
  if (!(bS <= cone)) return null;
  out.key = bKey; out.kind = bKind; out.seed = bSeed; out.d = bD;
  return out;
}

// 'Mossy Cay · 140 m' | 'Barrel · 85 m'
export function labelText(out) {
  if (!out) return '';
  if (out.kind === 'island') return islandName(out.seed) + ' · ' + distText(out.d);
  return (own(ITEM_LABEL, out.kind) ? ITEM_LABEL[out.kind] : String(out.kind)) + ' · ' + Math.round(out.d) + ' m';
}

const CSS = `#lrSpyVignette{position:fixed;inset:0;pointer-events:none;z-index:2;opacity:0;display:none;
  background:radial-gradient(circle at 50% 50%,transparent 0 33vmin,rgba(6,14,20,.55) 39vmin,rgba(4,10,14,.97) 45vmin)}
#lrSpyVignette:after{content:'';position:absolute;left:50%;top:50%;width:78vmin;height:78vmin;margin:-39vmin 0 0 -39vmin;
  border-radius:50%;box-shadow:inset 0 0 5vmin rgba(0,0,0,.5),0 0 0 2px rgba(201,161,90,.35)}
#lrSpyLabel{position:fixed;left:50%;top:calc(50% + 30px);transform:translateX(-50%);padding:3px 10px;border-radius:8px;
  background:rgba(8,22,36,.6);color:#f6ecd6;font:700 14px/1.3 system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:4}
body.lr-spy #lrPrompt,body.lr-spy #binocularsHud,body.lr-spy #treasureHud,body.lr-spy #chargeMeter{visibility:hidden!important}
body.lr-spy #crosshair{width:6px;height:6px;opacity:1;background:#fff!important;box-shadow:0 0 0 1.5px rgba(8,22,36,.9),0 0 5px rgba(0,0,0,.7)!important}`; // graphics.css dot (#fffd, faint shadow) vanishes on bright sky at zoom

export function createSpyglass(ctx) {
  const T = ctx.T;
  const fwd = T ? new T.Vector3() : { x: 0, y: 0, z: -1 };
  const hit = { key: null, kind: null, seed: 0, d: 0 };
  let t = 0, Z = 0, cur = 1, forced = null, lastKey = null, lastBucket = -1, nameSeed = null, nameStr = '';
  let rmbDrag = false, active = false, zoomedOn = false, lastQ = -1, hasHit = false;
  let style = null, vig = null, label = null;
  let promptCode = null, promptStr = '<kbd>RMB</kbd>Hold to look';
  const flag = { zoomed: false };
  globalThis.raftSpyglass = flag;
  const doc = () => (typeof document !== 'undefined' ? document : null);

  // Fallback hold for drag-look / no controls lane: right button on the canvas.
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  if (ac && typeof window !== 'undefined' && window.addEventListener) {
    const o = { capture: true, signal: ac.signal };
    window.addEventListener('pointerdown', e => { if (e.button === 2 && e.target && e.target === ctx.renderer?.domElement) rmbDrag = true; }, o);
    window.addEventListener('pointerup', e => { if (e.button === 2) rmbDrag = false; }, o);
    window.addEventListener('blur', () => { rmbDrag = false; }, o);
  }

  function heldKind() {
    const b = ctx.localBag ? ctx.localBag() : null, s = b && b.slots ? b.slots[b.selectedIndex] : null;
    return s ? s.kind : null;
  }
  // The zoomable kind in hand right now, or null (not running, menu, swimming, diving, hidden tab, other kind).
  // Cheapest checks first: the kind test means an idle frame never touches the DOM (uiOpen queries dialog[open]).
  function gate() {
    if (!ctx.running) return null;
    const k = forced || heldKind();
    if (!zoomFor(k)) return null;
    if (ctx.physics?.swimming || (ctx.vitals && ctx.vitals.hp <= 0)) return null; // fainted: hp stays 0 until the wake-up
    const cam = ctx.camera, sea = ctx.ocean?.mesh?.position?.y ?? 0;
    if (cam && cam.position && cam.position.y < sea) return null;
    const d = doc(); if (d && d.hidden) return null;
    if (ctx.uiOpen && ctx.uiOpen()) return null;
    return k;
  }
  function held() {
    if (forced) return true;
    const d = doc(); if (!d) return false;
    const rc = globalThis.raftControls;
    if (d.pointerLockElement && rc?.input?.down?.('aim')) return true;
    return rmbDrag && (!!d.body?.classList.contains('drag-look') || !rc?.input);
  }

  function ensureDom() {
    if (vig) return true;
    const d = doc(); if (!d || !d.body || !d.head) return false;
    style = d.createElement('style'); style.id = 'lrSpyStyle'; style.textContent = CSS; d.head.append(style);
    vig = d.createElement('div'); vig.id = 'lrSpyVignette'; vig.setAttribute('aria-hidden', 'true');
    label = d.createElement('div'); label.id = 'lrSpyLabel'; label.setAttribute('role', 'status'); label.hidden = true;
    d.body.append(vig, label);
    return true;
  }
  function applyDom(v) {
    if (!ensureDom()) return;
    const q = Math.round(v * SPY.VIGNETTE_STEPS);
    if (q !== lastQ) { lastQ = q; vig.style.opacity = String(q / SPY.VIGNETTE_STEPS); vig.style.display = q > 0 ? 'block' : 'none'; }
    const on = v >= SPY.LABEL_AT;
    if (on !== zoomedOn) {
      zoomedOn = on; flag.zoomed = on; doc().body.classList.toggle('lr-spy', on);
      if (!on) { label.hidden = true; lastKey = null; hasHit = false; }
    }
  }
  function writeLabel(r) {
    if (!label) return;
    if (!r) { if (!label.hidden) label.hidden = true; lastKey = null; hasHit = false; return; }
    hasHit = true;
    const island = r.kind === 'island', bucket = island ? Math.round(r.d / 10) : Math.round(r.d);
    if (r.key === lastKey && bucket === lastBucket && !label.hidden) return;
    lastKey = r.key; lastBucket = bucket;
    if (island) { if (nameSeed !== r.seed) { nameSeed = r.seed; nameStr = islandName(r.seed); } label.textContent = nameStr + ' · ' + distText(r.d); }
    else label.textContent = labelText(r);
    label.hidden = false;
  }
  function restore() {
    active = false; lastQ = 0; lastKey = null; hasHit = false;
    if (vig) { vig.style.opacity = '0'; vig.style.display = 'none'; }
    if (label) label.hidden = true;
    if (zoomedOn) doc()?.body?.classList.remove('lr-spy');
    zoomedOn = false; flag.zoomed = false;
  }

  function update(dt) {
    const k = gate();
    if (!k) { t = 0; cur = 1; if (active) restore(); return; }
    Z = zoomFor(k); t = easeStep(t, dt, held()); cur = zoomAt(t, Z);
    if (t === 0) { if (active) restore(); return; }
    active = true; applyDom(t);
    if (t < SPY.LABEL_AT || !ctx.camera) return;
    const cam = ctx.camera, p = cam.position;
    cam.getWorldDirection(fwd);
    const items = ctx.world && Array.isArray(ctx.world.items) ? ctx.world.items : null;
    const r = pick(p.x, p.y, p.z, fwd.x, fwd.y, fwd.z, items, islandNow(), ctx.ocean?.mesh?.position?.y ?? 0, lastKey, hit);
    writeLabel(r);
  }

  function keyText() {
    const code = globalThis.raftControls?.map?.bindings?.aim?.keys?.[0] ?? null;
    if (code !== promptCode) {
      promptCode = code;
      const map = globalThis.raftControls?.map;
      let txt = 'RMB';
      if (code && code !== 'Mouse2' && map && typeof map.label === 'function') { try { txt = String(map.label(code)); } catch { txt = 'RMB'; } }
      const e = ctx.esc ? ctx.esc(txt) : txt.replace(/[&<>"']/g, '');
      promptStr = `<kbd>${e}</kbd>Hold to look`;
    }
    return promptStr;
  }

  const debug = {
    zoom: () => cur,
    t: () => t,
    target: () => (hasHit && label ? { key: hit.key, kind: hit.kind, d: hit.d, label: label.textContent } : null),
    force(kind, opts) {
      forced = kind && zoomFor(kind) ? kind : null;
      if (forced && opts && opts.snap) { t = 1; cur = zoomAt(1, zoomFor(forced)); }
      return forced;
    },
    equip(kind = 'spyglass') {
      const b = ctx.localBag ? ctx.localBag() : null; if (!b || !b.slots) return -1;
      for (let i = 0; i < Math.min(10, b.slots.length); i++) if (b.slots[i] && b.slots[i].kind === kind) { ctx.action({ kind: 'selectSlot', index: i }); return i; }
      return -1;
    },
  };

  return {
    name: 'spyglass',
    update,
    zoom() { return gate() ? cur : 1; },
    prompt() { return gate() && t === 0 ? keyText() : null; },
    debug,
    dispose() {
      ac?.abort();
      restore();
      vig?.remove(); label?.remove(); style?.remove(); vig = label = style = null;
      if (globalThis.raftSpyglass === flag) delete globalThis.raftSpyglass;
    },
  };
}
