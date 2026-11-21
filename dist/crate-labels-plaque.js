// Crate label plaques (docs/specs/crate-labels.md §4): a small wooden board nailed to the crate front,
// showing an item picture or a short name. THREE + canvas only; loaded lazily by storage-research.js.
// One shared geometry pair, one material per label (LRU of 24, never evicting a material on a live plaque).
import { labelKey } from './crate-labels.js?build=v3-survival-ae77fa84ac2b';

const MAX_ENTRIES = 24;
const W = 128, H = 80;
const FONT = "Georgia, 'Times New Roman', serif";

export function createPlaques(T, { iconURL, onIconReady, svgFor, nameOf } = {}) {
  const faceGeo = new T.PlaneGeometry(0.34, 0.22); faceGeo.userData.shared = true;
  const backGeo = new T.BoxGeometry(0.36, 0.24, 0.015); backGeo.userData.shared = true;
  const backMat = new T.MeshStandardMaterial({ color: 0x5e4128, roughness: 0.9, metalness: 0 }); backMat.userData.shared = true;
  const cache = new Map();   // labelKey -> {mat, tex, cv, ready, kind, waiting}
  const live = new Map();    // crate group -> plaque group (rebuilt by sync)
  let disposed = false;

  const unsubscribe = typeof onIconReady === 'function' ? onIconReady((kind, url) => {
    if (disposed || !url) return;
    for (const e of cache.values()) if (e.waiting && e.kind === kind) drawIconURL(e, url);
  }) : null;

  function board(c) {
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#c99a5c'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(90,58,28,.28)'; c.lineWidth = 1.5;
    for (let y = 14; y < H; y += 17) { c.beginPath(); c.moveTo(4, y); c.bezierCurveTo(40, y - 2, 88, y + 2, W - 4, y - 1); c.stroke(); }
    c.strokeStyle = '#5e4128'; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
    for (const x of [12, W - 12]) {
      c.fillStyle = '#3d3a36'; c.beginPath(); c.arc(x, H / 2, 3.4, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#9aa3a8'; c.beginPath(); c.arc(x - 0.9, H / 2 - 0.9, 1.4, 0, Math.PI * 2); c.fill();
    }
  }
  function initials(c, name) {
    const s = String(name || '?').split(/\s+/).filter(Boolean).map(w => [...w][0]).join('').slice(0, 2).toUpperCase() || '?';
    c.fillStyle = '#3a2614'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `bold 34px ${FONT}`;
    c.fillText(s, W / 2, H / 2 + 2);
  }
  function drawText(c, text) {
    c.fillStyle = '#3a2614'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const maxW = W - 36, words = String(text).split(' ');
    for (let px = 28; px >= 14; px -= 2) {
      c.font = `bold ${px}px ${FONT}`;
      if (c.measureText(text).width <= maxW) { c.fillText(text, W / 2, H / 2 + 1); return; }
      if (words.length > 1 && px * 2.2 <= H - 14) { // best two-line split that fits
        let best = null;
        for (let i = 1; i < words.length; i++) {
          const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
          const w = Math.max(c.measureText(a).width, c.measureText(b).width);
          if (w <= maxW && (!best || w < best.w)) best = { a, b, w };
        }
        if (best) { const dy = px * 0.56; c.fillText(best.a, W / 2, H / 2 - dy + 1); c.fillText(best.b, W / 2, H / 2 + dy + 1); return; }
      }
    }
    c.font = `bold 14px ${FONT}`; // still too wide: squeeze it on one line
    c.save(); c.translate(W / 2, H / 2 + 1); const w = c.measureText(text).width; c.scale(Math.min(1, maxW / w), 1); c.fillText(text, 0, 0); c.restore();
  }
  function drawImage(e, src, onFail) {
    const img = new Image();
    img.onload = () => {
      if (disposed || !cache.has(e.key)) return;
      const c = e.cv.getContext('2d'); board(c);
      const s = 74; try { c.drawImage(img, (W - s) / 2, (H - s) / 2, s, s); } catch { onFail?.(); return; }
      e.tex.needsUpdate = true;
    };
    img.onerror = () => { if (!disposed) onFail?.(); };
    img.src = src;
  }
  function drawIconURL(e, url) {
    e.waiting = false;
    drawImage(e, url, () => { e.waiting = true; drawFallback(e); });
    e.ready = true;
  }
  function drawFallback(e) {
    const body = svgFor?.(e.kind);
    if (body) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="96" height="96">${body}</svg>`;
      drawImage(e, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), () => { const c = e.cv.getContext('2d'); board(c); initials(c, nameOf?.(e.kind) ?? e.kind); e.tex.needsUpdate = true; });
    }
    const c = e.cv.getContext('2d'); board(c); initials(c, nameOf?.(e.kind) ?? e.kind); e.tex.needsUpdate = true; // shown until an image lands
  }

  function entry(l) {
    const key = labelKey(l);
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit; } // touch: LRU order
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const tex = new T.CanvasTexture(cv); if ('colorSpace' in tex && T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new T.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22 }); mat.userData.shared = true; // a little glow so the label reads in the crate's shade
    const e = { key, mat, tex, cv, ready: false, kind: l.k ?? null, waiting: false };
    cache.set(key, e);
    const c = cv.getContext('2d');
    if (!c) return e;
    if (l.k) {
      const url = iconURL?.(l.k) ?? null;
      if (url) drawIconURL(e, url);
      else { e.waiting = true; drawFallback(e); e.ready = true; }
    } else { board(c); drawText(c, l.t); tex.needsUpdate = true; e.ready = true; }
    return e;
  }
  function prune() {
    if (cache.size <= MAX_ENTRIES) return;
    const used = new Set(); for (const p of live.values()) used.add(p.userData.face.material);
    for (const [k, e] of cache) {
      if (cache.size <= MAX_ENTRIES) break;
      if (used.has(e.mat)) continue;
      cache.delete(k); e.tex.dispose(); e.mat.dispose();
    }
  }
  function makePlaque() {
    const g = new T.Group(); g.name = 'crateLabel';
    g.position.set(0, 0.44, 0.425);
    const back = new T.Mesh(backGeo, backMat); back.castShadow = true; back.receiveShadow = true; g.add(back);
    const face = new T.Mesh(faceGeo, backMat); face.position.z = 0.0085; face.receiveShadow = true; g.add(face);
    g.userData.face = face;
    return g;
  }

  return {
    sync(raft, labels) {
      if (disposed || !raft) return;
      live.clear();
      const kids = raft.children;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i]; if (c.name !== 'craft_crate' || !c.userData.tileKey) continue;
        const l = labels?.[c.userData.tileKey] ?? null;
        let p = null; for (const ch of c.children) if (ch.name === 'crateLabel') { p = ch; break; }
        if (!l) { if (p) c.remove(p); continue; }
        const e = entry(l);
        if (!p) { p = makePlaque(); c.add(p); }
        if (p.userData.face.material !== e.mat) p.userData.face.material = e.mat;
        p.userData.labelKey = e.key; p.userData.tileKey = c.userData.tileKey;
        live.set(c, p);
      }
      prune();
    },
    info(withImage = false) { // QA: what each live plaque shows (withImage adds the canvas as a data URL)
      const out = [];
      for (const p of live.values()) {
        const e = cache.get(p.userData.labelKey);
        out.push({ key: p.userData.tileKey, labelKey: p.userData.labelKey, ready: !!e?.ready, ...(withImage && e ? { image: e.cv.toDataURL() } : {}) });
      }
      return out;
    },
    dispose() {
      disposed = true; unsubscribe?.();
      for (const [c, p] of live) c.remove(p);
      live.clear();
      for (const e of cache.values()) { e.tex.dispose(); e.mat.dispose(); }
      cache.clear();
      faceGeo.dispose(); backGeo.dispose(); backMat.dispose();
    },
  };
}
