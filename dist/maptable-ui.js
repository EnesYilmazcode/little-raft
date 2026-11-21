// Map Table dialog: a parchment sea chart drawn on a canvas (north = -z at the top), with the raft,
// its trail, charted islands, the receiver's signal wedge and up to 8 shared pins.
// createMapTableUI(api) -> {open, close, isOpen, update, dispose, debug}. Spec: docs/specs/maptable.md §8.
import { SCALES, PIN_MAX, PIN_ICONS, FULL_TEXT, HG, islandName, courseTo, compassPoint, distText } from './maptable.js?build=v3-survival-ae77fa84ac2b';
import { layoutFor, shape } from './islands-layout.js';
import { signalReadout, raftCentre, countAntennas, TIERS } from './signal.js?build=v3-survival-ae77fa84ac2b';
import { wrapAxis } from './sailing-core.js';

const STYLE_ID = 'little-raft-map-style';
const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const INK = '#5a4128', PAPER = '#f3e6c4';
const WOOD = 'repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a)';
const PIN_COLORS = ['#e0a128', '#4f8fa8', '#d0605a', '#5f9a5a'];
const PIN_LABELS = ['Star', 'Fish', 'Heart', 'Flag'];
const HIT = 16; // css px
const BAR_M = [50, 250, 1000, 5000]; // scale bar length per SCALES preset
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fin = Number.isFinite;

const CSS = `
#lrMap.lrm{padding:0;margin:auto;border:0;background:transparent;box-shadow:none;color:#fff2cc;width:min(600px,calc(100vw - 16px));max-width:none;max-height:96dvh;overflow:visible;font:500 14px/1.4 ${FONT}}
#lrMap.lrm::backdrop{background:rgba(12,9,5,.45)}
#lrMap .lrm-wrap{display:flex;flex-direction:column;gap:8px;padding:10px;max-height:96dvh;box-sizing:border-box;overflow:auto;overscroll-behavior:contain;border-radius:6px;
  background:${WOOD};border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#lrMap .lrm-head{display:flex;align-items:center;gap:6px}
#lrMap h2{font:700 19px/1.2 ${FONT};margin:0 auto 0 2px;color:#fff2cc;text-shadow:0 1px 0 #3e2a17}
#lrMap button{min-width:44px;height:44px;padding:0 12px;border:0;border-radius:5px;cursor:pointer;font:600 15px/1 ${FONT};color:#fff2cc;
  background:linear-gradient(180deg,#5a3f28,#3d2a19);box-shadow:inset 0 0 0 1px #d4b07a66;transform:none}
#lrMap button:hover{filter:brightness(1.1);transform:none}
#lrMap button:focus-visible{outline:2px solid #ffe3a6;outline-offset:1px}
#lrMap button:disabled{opacity:.45;cursor:default;filter:none}
#lrMap .lrm-zoom{font-size:22px;padding:0;width:44px}
#lrMap .lrm-scale{min-width:62px;text-align:center;font:600 14px/1 ${FONT};color:#fff2cc}
#lrMap .lrm-x{padding:0;width:44px;font-size:22px}
#lrMap .lrm-paper{align-self:center;position:relative;padding:6px;border-radius:4px;background:#3a2716;box-shadow:inset 0 0 0 2px #24170c}
#lrMap canvas{display:block;width:min(92vw - 28px,70dvh,560px);height:min(92vw - 28px,70dvh,560px);touch-action:none;border-radius:2px;cursor:crosshair}
#lrMap .lrm-shake{animation:lrm-shake .35s}
@keyframes lrm-shake{20%{transform:translateX(-5px)}50%{transform:translateX(5px)}80%{transform:translateX(-3px)}}
#lrMap .lrm-tools{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
#lrMap .lrm-icons{display:flex;gap:4px;margin-right:auto}
#lrMap .lrm-icons button{width:44px;padding:0;display:grid;place-items:center}
#lrMap .lrm-icons button[aria-pressed=true]{background:linear-gradient(180deg,#b3925a,#8a6a3c);box-shadow:inset 0 0 0 2px #ffe3a6}
#lrMap .lrm-icons svg{width:26px;height:26px}
#lrMap .lrm-go{background:linear-gradient(180deg,#3f7f74,#2b5a52)}
#lrMap .lrm-hint{margin:0;font-size:12px;color:#f0dcb0}
#lrMap details{background:#3a2716eb;border-radius:4px;box-shadow:inset 0 0 0 2px #24170c;padding:4px 8px}
#lrMap summary{cursor:pointer;font:600 14px/1 ${FONT};padding:10px 2px;color:#fff2cc}
#lrMap ul{list-style:none;margin:0 0 6px;padding:0;display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto}
#lrMap li button{width:100%;height:auto;min-height:44px;display:flex;align-items:center;gap:8px;justify-content:space-between;text-align:left;padding:6px 10px;
  background:#f3e6c4;color:#3e2a17;box-shadow:0 2px 0 #24170c;font:600 14px/1.25 ${FONT}}
#lrMap li button[aria-current=true]{box-shadow:0 0 0 2px #ffbd66,0 2px 0 #24170c}
#lrMap li small{font:500 12px/1.2 ${FONT};color:#7a5a38;white-space:nowrap}
#lrMap .lrm-tick{color:#3f7f74;margin-left:4px}
#lrMap .lrm-empty{margin:4px 2px 8px;font-style:italic;color:#e8d3a8}
@media (max-width:520px){#lrMap .lrm-wrap{padding:8px}#lrMap h2{font-size:17px}#lrMap summary{pointer-events:none;list-style:none}#lrMap summary::-webkit-details-marker{display:none}
  #lrMap canvas{width:min(100vw - 44px,62dvh);height:min(100vw - 44px,62dvh)}#lrMap ul{max-height:none}
  #lrMap .lrm-icons{flex:1 1 100%;justify-content:space-between}#lrMap .lrm-icons button{flex:1}#lrMap .lrm-go,#lrMap .lrm-close{flex:1}}
@media (prefers-reduced-motion:reduce){#lrMap .lrm-shake{animation:none}}
`;

const ICON_SVG = [
  '<path d="M12 2.5l2.8 6 6.5.7-4.9 4.4 1.4 6.4L12 16.8 6.2 20l1.4-6.4L2.7 9.2l6.5-.7z"/>',
  '<path d="M3 12c3-5 9-6 13-2l5-4v12l-5-4c-4 4-10 3-13-2z"/><circle cx="8" cy="11" r="1" fill="#3e2a17"/>',
  '<path d="M12 20s-8-5-8-11a4.3 4.3 0 0 1 8-2 4.3 4.3 0 0 1 8 2c0 6-8 11-8 11z"/>',
  '<path d="M6 21V3" stroke="#fff2cc" stroke-width="2" fill="none"/><path d="M7 4h12l-3 4 3 4H7z"/>',
].map((p, i) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${PIN_COLORS[i]}" stroke="#24170c" stroke-width="1.2" stroke-linejoin="round">${p}</svg>`);

const MARKUP = `<div class="lrm-wrap">
  <div class="lrm-head"><h2 id="lrm-title">Sea chart</h2>
    <button type="button" class="lrm-zoom" data-z="-1" aria-label="Zoom out">−</button>
    <span class="lrm-scale" aria-live="polite">600 m</span>
    <button type="button" class="lrm-zoom" data-z="1" aria-label="Zoom in">+</button>
    <button type="button" class="lrm-x" aria-label="Close chart">×</button></div>
  <div class="lrm-paper"><canvas aria-label="Sea chart. Tap to place a pin, tap a pin to lift it, tap an island to select it."></canvas></div>
  <div class="lrm-tools">
    <div class="lrm-icons" role="group" aria-label="Pin doodle">${ICON_SVG.map((s, i) => `<button type="button" data-i="${i}" aria-label="${PIN_LABELS[i]} pin" aria-pressed="${i === 0}">${s}</button>`).join('')}</div>
    <button type="button" class="lrm-go" disabled>Set course</button>
    <button type="button" class="lrm-close">Close</button>
  </div>
  <p class="lrm-hint">Tap the chart to drop a pin · tap a pin to lift it · tap an island to pick it</p>
  <details class="lrm-list"><summary>Charted islands</summary><p class="lrm-empty" hidden>Sail a while. Islands you meet are inked here.</p><ul></ul></details>
</div>`;

function ensureStyle() {
  let st = document.getElementById(STYLE_ID);
  if (!st) { st = document.createElement('style'); st.id = STYLE_ID; document.head.append(st); }
  if (st.textContent !== CSS) st.textContent = CSS;
}

export function createMapTableUI(api) {
  ensureStyle();
  const ac = new AbortController(), opt = { signal: ac.signal };
  let dlg = document.getElementById('lrMap');
  if (dlg) dlg.remove();
  dlg = document.createElement('dialog'); dlg.id = 'lrMap'; dlg.className = 'lrm'; dlg.setAttribute('aria-labelledby', 'lrm-title');
  dlg.innerHTML = MARKUP; document.body.append(dlg);
  const q = s => dlg.querySelector(s);
  const canvas = q('canvas'), g = canvas.getContext('2d');
  const scaleEl = q('.lrm-scale'), goBtn = q('.lrm-go'), list = q('ul'), empty = q('.lrm-empty'), details = q('details'), summary = q('summary');
  const iconBtns = [...dlg.querySelectorAll('.lrm-icons button')];
  const phone = () => { try { return matchMedia('(max-width:520px)').matches; } catch { return false; } };

  let scaleIdx = 1, icon = 0, sel = null; // sel: {t:'isl', s} | {t:'pin', n} | {t:'want', x, z}
  let lastRev = -1, lastGx = NaN, lastGz = NaN, lastH = NaN, clock = 0, listSig = '', listClock = 0;
  let size = 0, dpr = 1, hits = [];
  const scale = () => SCALES[scaleIdx];
  const isOpen = () => dlg.open;

  // ---------- geometry ----------
  function fit() {
    const css = canvas.getBoundingClientRect().width || 360;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(css * dpr);
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    size = css;
  }
  const view = () => {
    const s = api.sailing();
    return { gx: s ? s.gx : 0, gz: s ? s.gz : 0, h: s && fin(s.heading) ? s.heading : 0, wind: s && fin(s.windDir) ? s.windDir : NaN, ws: s && fin(s.windStr) ? s.windStr : .8 };
  };
  const R = () => size / 2 - 10;
  const toScreen = (v, x, z) => { const k = R() / scale(); return [size / 2 + wrapAxis(x - v.gx, HG) * k, size / 2 + wrapAxis(z - v.gz, HG) * k]; };
  const toWorld = (v, sx, sy) => { const k = R() / scale(); return [v.gx + (sx - size / 2) / k, v.gz + (sy - size / 2) / k]; };

  // ---------- drawing ----------
  function doodle(i, x, y, r) {
    g.save(); g.translate(x, y); g.lineJoin = 'round'; g.lineWidth = 1.6; g.strokeStyle = INK; g.fillStyle = PIN_COLORS[i];
    g.beginPath();
    if (i === 0) { for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * .45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); }
    else if (i === 1) { g.moveTo(-r, 0); g.quadraticCurveTo(-r * .2, -r * .9, r * .45, 0); g.quadraticCurveTo(-r * .2, r * .9, -r, 0); g.moveTo(r * .35, 0); g.lineTo(r, -r * .6); g.lineTo(r, r * .6); g.closePath(); }
    else if (i === 2) { g.moveTo(0, r * .8); g.bezierCurveTo(-r * 1.3, -r * .1, -r * .6, -r * 1.1, 0, -r * .35); g.bezierCurveTo(r * .6, -r * 1.1, r * 1.3, -r * .1, 0, r * .8); }
    else { g.moveTo(-r * .6, r); g.lineTo(-r * .6, -r); g.lineTo(r, -r * .55); g.lineTo(-r * .6, -r * .1); }
    g.fill(); g.stroke();
    if (i === 3) { g.beginPath(); g.moveTo(-r * .6, r); g.lineTo(-r * .6, -r); g.stroke(); }
    g.restore();
  }

  function draw() {
    fit();
    const v = view(), st = api.state, k = R() / scale(), c = size / 2;
    hits = [];
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // paper + vignette
    g.fillStyle = PAPER; g.fillRect(0, 0, size, size);
    const vg = g.createRadialGradient(c, c, size * .3, c, c, size * .75); vg.addColorStop(0, 'rgba(120,85,45,0)'); vg.addColorStop(1, 'rgba(120,85,45,.32)');
    g.fillStyle = vg; g.fillRect(0, 0, size, size);
    // grid every scale/4, fixed to the seabed so it slides as the raft sails
    const step = scale() / 4;
    g.save(); g.strokeStyle = 'rgba(90,65,40,.22)'; g.lineWidth = 1; g.setLineDash([3, 5]); g.beginPath();
    for (let x = Math.ceil((v.gx - scale() * 1.2) / step) * step; x <= v.gx + scale() * 1.2; x += step) { const sx = c + (x - v.gx) * k; g.moveTo(sx, 0); g.lineTo(sx, size); }
    for (let z = Math.ceil((v.gz - scale() * 1.2) / step) * step; z <= v.gz + scale() * 1.2; z += step) { const sy = c + (z - v.gz) * k; g.moveTo(0, sy); g.lineTo(size, sy); }
    g.stroke(); g.restore();
    // range ring at half scale
    g.save(); g.strokeStyle = 'rgba(90,65,40,.18)'; g.setLineDash([2, 6]); g.beginPath(); g.arc(c, c, R() / 2, 0, Math.PI * 2); g.stroke(); g.restore();

    // trail: dotted, older dots fainter
    const t = st.trail, n = t.length / 2;
    g.fillStyle = INK;
    let px = NaN, py = NaN;
    for (let j = 0; j <= n; j++) {
      const [sx, sy] = j < n ? toScreen(v, t[j * 2], t[j * 2 + 1]) : [c, c];
      if (px === px) {
        const len = Math.hypot(sx - px, sy - py), dots = Math.min(400, Math.floor(len / 6));
        g.globalAlpha = .25 + .65 * (n > 1 ? j / n : 1);
        if (len < size * 3) for (let d = 0; d < dots; d++) { const u = d / Math.max(1, dots); g.beginPath(); g.arc(px + (sx - px) * u, py + (sy - py) * u, 1.3, 0, Math.PI * 2); g.fill(); }
      }
      px = sx; py = sy;
    }
    g.globalAlpha = 1;

    // islands
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const e of st.isl) {
      const [sx, sy] = toScreen(v, e.x, e.z);
      const lay = layoutFor(e.s), r = Math.max(6, lay.R * k);
      if (sx < -r - 60 || sy < -r - 30 || sx > size + r + 60 || sy > size + r + 30) continue;
      g.beginPath();
      for (let a = 0; a <= 24; a++) { const th = a / 24 * Math.PI * 2, rr = r * shape(th - lay.rot); g.lineTo(sx + Math.cos(th) * rr, sy + Math.sin(th) * rr); }
      g.closePath(); g.fillStyle = '#e2c98c'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke();
      g.beginPath(); g.arc(sx, sy, r * .45, 0, Math.PI * 2); g.fillStyle = '#7fa66a'; g.fill();
      const chosen = sel && sel.t === 'isl' && sel.s === e.s;
      if (scale() <= 2500 || chosen) {
        const label = islandName(e.s) + (e.f & 1 ? ' ✓' : '') + (e.f & 2 ? ' ★' : '');
        g.font = `600 ${chosen ? 13 : 12}px ${FONT}`; g.fillStyle = INK;
        g.lineWidth = 3; g.strokeStyle = 'rgba(243,230,196,.85)'; g.strokeText(label, sx, sy + r + 3); g.fillText(label, sx, sy + r + 3);
      }
      hits.push({ t: 'isl', s: e.s, x: sx, y: sy, r: Math.max(HIT, r) });
    }

    // signal wedge (never more precise than the HUD readout)
    const w = api.ctx.world;
    const r0 = w ? signalReadout(w.signal, raftCentre(w.tiles), countAntennas(w.decor), api.ctx.elapsed) : null;
    wedge = !!(r0 && !r0.listening);
    if (wedge) {
      const th = r0.heading * Math.PI / 180, half = (TIERS[r0.antennas].wobble + 6) * Math.PI / 180;
      const len = Math.min(R(), Math.max(40, r0.distance * k));
      const ang = th - Math.PI / 2; // compass -> canvas angle (0 = +x screen, clockwise)
      g.save(); g.beginPath(); g.moveTo(c, c); g.arc(c, c, len, ang - half, ang + half); g.closePath();
      g.fillStyle = 'rgba(63,127,116,.16)'; g.fill(); g.setLineDash([5, 4]); g.lineWidth = 1.4; g.strokeStyle = '#3f7f74'; g.stroke(); g.restore();
      const tx = c + Math.sin(th) * len, ty = c - Math.cos(th) * len;
      if (r0.marker) { g.beginPath(); g.arc(tx, ty, 7, 0, Math.PI * 2); g.fillStyle = '#ffbd66'; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.4; g.stroke(); g.fillStyle = INK; g.font = `700 10px ${FONT}`; g.textBaseline = 'middle'; g.fillText('?', tx, ty + .5); }
      g.font = `600 11px ${FONT}`; g.textBaseline = 'top'; g.fillStyle = '#2f665d';
      const lx = Math.max(40, Math.min(size - 40, c + Math.sin(th) * Math.min(len + 12, R() - 6))), ly = Math.max(4, Math.min(size - 16, c - Math.cos(th) * Math.min(len + 12, R() - 6) - 6));
      g.fillText(r0.label, lx, ly);
    }

    // pins
    for (const p of st.pins) {
      const [sx, sy] = toScreen(v, p.x, p.z);
      if (sx < -20 || sy < -20 || sx > size + 20 || sy > size + 20) continue;
      g.save(); g.strokeStyle = INK; g.lineWidth = 1; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy - 6); g.stroke(); g.restore();
      doodle(p.i, sx, sy - 12, 8);
      hits.push({ t: 'pin', n: p.n, x: sx, y: sy - 8, r: HIT });
    }

    // faint wind arrow + raft glyph at the centre
    if (v.wind === v.wind) {
      const ax = Math.sin(v.wind), az = Math.cos(v.wind), L = 26 * v.ws;
      g.save(); g.globalAlpha = .4; g.strokeStyle = '#4f8fa8'; g.lineWidth = 2; g.lineCap = 'round';
      const bx = c - ax * 34, by = c - az * 34;
      g.beginPath(); g.moveTo(bx - ax * L, by - az * L); g.lineTo(bx, by); g.moveTo(bx, by); g.lineTo(bx - ax * 7 + az * 5, by - az * 7 - ax * 5); g.moveTo(bx, by); g.lineTo(bx - ax * 7 - az * 5, by - az * 7 + ax * 5); g.stroke(); g.restore();
    }
    g.save(); g.translate(c, c); g.rotate(Math.atan2(-Math.sin(v.h), Math.cos(v.h))); // screen dir (sin h, cos h) points along +y after rotation
    g.fillStyle = '#a27a4f'; g.strokeStyle = INK; g.lineWidth = 1.6;
    g.beginPath(); g.rect(-6, -6, 12, 12); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(0, 15); g.lineTo(-5, 6); g.lineTo(5, 6); g.closePath(); g.fillStyle = INK; g.fill();
    g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.moveTo(0, -6); g.lineTo(0, 6); g.lineWidth = .8; g.stroke();
    g.restore();

    // selection ring
    if (sel) {
      let s = null;
      if (sel.t === 'isl') s = hits.find(h => h.t === 'isl' && h.s === sel.s);
      else if (sel.t === 'pin') s = hits.find(h => h.t === 'pin' && h.n === sel.n);
      if (s) { g.save(); g.strokeStyle = '#d0605a'; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath(); g.arc(s.x, s.y, s.r + 4, 0, Math.PI * 2); g.stroke(); g.restore(); }
    }

    // compass rose (N up = -z)
    const rx = size - 30, ry = 30;
    g.save(); g.translate(rx, ry); g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = 1.2;
    g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.globalAlpha = .7; g.stroke(); g.globalAlpha = 1;
    for (let a = 0; a < 4; a++) { g.save(); g.rotate(a * Math.PI / 2); g.beginPath(); g.moveTo(0, -16); g.lineTo(3.5, 0); g.lineTo(-3.5, 0); g.closePath(); g.fillStyle = a === 0 ? '#b5533c' : INK; g.fill(); g.restore(); }
    g.font = `700 11px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillStyle = INK; g.fillText('N', 0, -17);
    g.restore();

    // scale bar (bottom left): a round distance, about a quarter of the chart width
    const nice = BAR_M[scaleIdx], bar = nice * k, bx0 = 14, by0 = size - 16;
    g.save(); g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(bx0, by0); g.lineTo(bx0 + bar, by0); g.moveTo(bx0, by0 - 4); g.lineTo(bx0, by0 + 4); g.moveTo(bx0 + bar, by0 - 4); g.lineTo(bx0 + bar, by0 + 4); g.stroke();
    g.font = `600 11px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = INK; g.fillText(nice < 1000 ? nice + ' m' : nice / 1000 + ' km', bx0 + 2, by0 - 5); g.restore();

    lastRev = api.viewRev(); lastGx = v.gx; lastGz = v.gz; lastH = v.h;
    renderList(v);
  }
  let wedge = false;

  // ---------- list + buttons ----------
  function target() {
    const st = api.state;
    if (!sel) return null;
    if (sel.t === 'isl') { const e = st.isl.find(x => x.s === sel.s); return e ? { x: e.x, z: e.z, name: islandName(e.s) } : null; }
    if (sel.t === 'pin') { const p = st.pins.find(x => x.n === sel.n); return p ? { x: p.x, z: p.z, name: PIN_LABELS[p.i] + ' pin' } : null; }
    return null;
  }
  function renderList(v) {
    const st = api.state;
    // resolve a pending pin once the host has it
    if (sel && sel.t === 'want') { const p = st.pins.find(x => Math.abs(x.x - sel.x) <= 1 && Math.abs(x.z - sel.z) <= 1); if (p) sel = { t: 'pin', n: p.n }; }
    if (sel && !target() && sel.t !== 'want') sel = null;
    goBtn.disabled = !target();
    const rows = st.isl.slice().reverse().map(e => {
      const c = courseTo(v.gx, v.gz, e.x, e.z);
      return { s: e.s, html: `<li><button type="button" data-s="${e.s}" aria-current="${!!(sel && sel.t === 'isl' && sel.s === e.s)}"><span>${esc(islandName(e.s))}${e.f & 1 ? '<span class="lrm-tick" title="visited">✓</span>' : ''}${e.f & 2 ? '<span class="lrm-tick" title="gathered">★</span>' : ''}</span><small>${compassPoint(c.bearing)} · ${distText(c.dist)}</small></button></li>` };
    });
    const sig = rows.map(r => r.html).join('');
    if (sig !== listSig) { listSig = sig; list.innerHTML = sig; }
    empty.hidden = st.isl.length > 0;
    summary.textContent = `Charted islands (${st.isl.length})`;
  }

  function hitAt(x, y) {
    let best = null, bd = Infinity;
    for (const h of hits) { const d = Math.hypot(h.x - x, h.y - y); if (h.t === 'pin' && d <= HIT && d < bd) { best = h; bd = d; } }
    if (best) return { pin: best.n };
    for (const h of hits) { const d = Math.hypot(h.x - x, h.y - y); if (h.t === 'isl' && d <= h.r && d < bd) { best = h; bd = d; } }
    return best ? { isl: best.s } : null;
  }

  function shake() { canvas.classList.remove('lrm-shake'); void canvas.offsetWidth; canvas.classList.add('lrm-shake'); }
  function tap(x, y) {
    const h = hitAt(x, y), st = api.state;
    if (h && h.pin !== undefined) { api.send({ kind: 'map', op: 'unpin', n: h.pin }); if (sel && sel.t === 'pin' && sel.n === h.pin) sel = null; }
    else if (h && h.isl !== undefined) sel = { t: 'isl', s: h.isl };
    else if (st.pins.length >= PIN_MAX) { shake(); api.notice(FULL_TEXT, 2600); }
    else {
      const [wx, wz] = toWorld(view(), x, y), px = Math.round(wx), pz = Math.round(wz);
      api.send({ kind: 'map', op: 'pin', x: px, z: pz, i: icon }); sel = { t: 'want', x: px, z: pz };
    }
    draw();
  }

  canvas.addEventListener('pointerdown', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); tap(e.clientX - r.left, e.clientY - r.top); }, opt);
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY > 0 ? -1 : 1); }, { ...opt, passive: false });
  dlg.addEventListener('wheel', e => e.stopPropagation(), { ...opt, passive: true });
  dlg.addEventListener('keydown', e => { if (e.key === '+' || e.key === '=') zoom(1); else if (e.key === '-' || e.key === '_') zoom(-1); else return; e.preventDefault(); }, opt);
  function zoom(d) { const n = Math.max(0, Math.min(SCALES.length - 1, scaleIdx - d)); setScale(n); }
  function setScale(n) {
    scaleIdx = n; scaleEl.textContent = distText(SCALES[n]);
    for (const b of dlg.querySelectorAll('.lrm-zoom')) b.disabled = b.dataset.z === '1' ? n === 0 : n === SCALES.length - 1;
    if (isOpen()) draw();
  }
  for (const b of dlg.querySelectorAll('.lrm-zoom')) b.addEventListener('click', () => zoom(+b.dataset.z), opt);
  iconBtns.forEach((b, i) => b.addEventListener('click', () => { icon = i; iconBtns.forEach((x, j) => x.setAttribute('aria-pressed', String(j === i))); }, opt));
  goBtn.addEventListener('click', () => { const t = target(); if (t) api.course(t.x, t.z); }, opt);
  q('.lrm-close').addEventListener('click', () => close(), opt);
  q('.lrm-x').addEventListener('click', () => close(), opt);
  list.addEventListener('click', e => { const b = e.target.closest('button[data-s]'); if (!b) return; sel = { t: 'isl', s: +b.dataset.s }; listSig = ''; draw(); }, opt);
  dlg.addEventListener('close', () => { api.requestLock(); }, opt);
  window.addEventListener('resize', () => { if (isOpen()) draw(); }, opt);
  setScale(1);

  function open() {
    if (isOpen() || document.querySelector('dialog[open]')) return false;
    api.releaseLock();
    if (phone()) details.open = true;
    dlg.showModal();
    listSig = ''; draw();
    return true;
  }
  function close() { if (isOpen()) dlg.close(); }

  function update(dt) {
    if (!isOpen()) return;
    clock += dt; listClock += dt;
    if (clock < .25) return;
    clock = 0;
    const v = view(), k = R() / scale();
    const moved = Math.hypot(wrapAxis(v.gx - lastGx, HG), wrapAxis(v.gz - lastGz, HG)) * k >= .5 || !(lastGx === lastGx);
    const turned = Math.abs(Math.atan2(Math.sin(v.h - lastH), Math.cos(v.h - lastH))) > Math.PI / 180;
    if (api.viewRev() !== lastRev || moved || turned || wedge || listClock > 1) { listClock = 0; draw(); }
  }

  function dispose() { ac.abort(); try { if (dlg.open) dlg.close(); } catch {} dlg.remove(); }

  const debug = {
    open, close,
    scale(i) { if (Number.isInteger(i) && i >= 0 && i < SCALES.length) setScale(i); return SCALES[scaleIdx]; },
    draw: () => { draw(); return hits.length; },
    hits: (x, y) => hitAt(x, y),
    tap: (x, y) => tap(x, y),
    select(seed) { sel = { t: 'isl', s: seed >>> 0 }; if (isOpen()) draw(); },
    screen(x, z) { return toScreen(view(), x, z); },
  };
  return { open, close, isOpen, update, dispose, debug };
}
