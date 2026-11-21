// Bottom-left pickup feed: "+3 Wood" rows with the item's icon, plus short text notes.
// Repeats of one kind inside MERGE_MS fold into one row; rows hold, then fade. No per-frame work.
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';

export const HOLD_MS = 3000, MERGE_MS = 2000, FADE_MS = 450, MAX_ROWS = 5;
const SVG = 'http://www.w3.org/2000/svg';

// doc and clock are injectable so the merge/cap logic runs under node tests.
export function createFeed({ doc = globalThis.document, now = () => performance.now(), timer = setTimeout, clear = clearTimeout } = {}) {
  let iconProvider = null, host = null;
  const rows = new Map(); // key -> row, insertion order = oldest first

  function root() {
    if (host?.isConnected) return host;
    host = doc.getElementById('pickupFeed');
    if (!host) {
      host = doc.createElement('div'); host.id = 'pickupFeed';
      host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite');
      doc.body.appendChild(host);
    }
    return host;
  }

  function icon(kind) {
    let got = null;
    try { got = iconProvider?.(kind); } catch {}
    if (typeof got === 'string' && got) { const img = doc.createElement('img'); img.src = got; img.alt = ''; return img; }
    if (got && got.nodeType === 1) {
      if (got.tagName === 'CANVAS' && got.isConnected) { // a shared cached canvas: copy its pixels
        const c = doc.createElement('canvas'); c.width = got.width; c.height = got.height; c.getContext('2d')?.drawImage(got, 0, 0); return c;
      }
      return got.isConnected ? got.cloneNode(true) : got;
    }
    const sym = ITEM_INFO[kind]?.icon;
    if (!sym) return null;
    const svg = doc.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 48 48'); svg.setAttribute('aria-hidden', 'true');
    const use = doc.createElementNS(SVG, 'use'); use.setAttribute('href', `icons.svg#${sym}`); svg.appendChild(use);
    return svg;
  }

  function drop(key, row) {
    if (rows.get(key) === row) rows.delete(key);
    clear(row.hold); row.el.classList.add('out');
    row.hold = timer(() => row.el.remove(), FADE_MS);
  }
  function arm(key, row) { clear(row.hold); row.hold = timer(() => drop(key, row), HOLD_MS); }

  function push(key, build, update) {
    const t = now(), old = rows.get(key);
    if (old && t - old.at < MERGE_MS) {
      old.at = t; update(old);
      // Restart the pop by alternating two classes bound to identical keyframes (no forced reflow).
      const cl = old.el.classList, b = cl.contains('bump');
      cl.remove(b ? 'bump' : 'bump2'); cl.add(b ? 'bump2' : 'bump');
      root().appendChild(old.el); rows.delete(key); rows.set(key, old); // newest sits at the bottom
      arm(key, old); return old;
    }
    if (old) drop(key, old);
    const el = doc.createElement('div'); el.className = 'pf-row';
    const row = { el, at: t, hold: 0, count: 0 };
    build(row); update(row);
    root().appendChild(el); rows.set(key, row); arm(key, row);
    while (rows.size > MAX_ROWS) { const [k, r] = rows.entries().next().value; drop(k, r); }
    return row;
  }

  return {
    /** +count of an item kind, with its icon. */
    add(kind, count = 1) {
      const n = Math.floor(Number(count)); if (!kind || !(n > 0)) return null;
      return push('k:' + kind, row => {
        row.el.classList.add('pf-item');
        row.box = doc.createElement('span'); row.box.className = 'pf-icon';
        const ic = icon(kind); if (ic) row.box.appendChild(ic);
        row.label = doc.createElement('b');
        row.el.append(row.box, row.label);
      }, row => { row.count += n; row.label.textContent = `+${row.count} ${ITEM_INFO[kind]?.name ?? kind}`; });
    },
    /** A short text line in the same corner (replaces centred toasts). Same text merges. */
    note(text) {
      const s = String(text ?? '').trim().slice(0, 90); if (!s) return null;
      return push('t:' + s, row => {
        row.el.classList.add('pf-note');
        const dot = doc.createElement('i'); row.label = doc.createElement('span'); row.label.textContent = s;
        row.el.append(dot, row.label);
      }, () => {});
    },
    /** fn(kind) -> data URL | canvas | element | null (null: sprite fallback, or the bare swatch tile). */
    setIconProvider(fn) { iconProvider = typeof fn === 'function' ? fn : null; },
    /** Re-ask the provider for a live row's icon, e.g. when an async 3D icon finishes rendering. */
    refresh(kind) {
      const row = rows.get('k:' + kind); if (!row?.box) return;
      const ic = icon(kind); if (ic) row.box.replaceChildren(ic);
    },
    clear() { for (const [k, r] of [...rows]) { rows.delete(k); clear(r.hold); r.el.remove(); } },
    get rows() { return [...rows.values()].map(r => r.label.textContent); },
  };
}

// Shared instance; lazily bound so importing under node (no document) is harmless.
let shared = null;
const feed = () => (shared ??= createFeed());
export const pickupFeed = Object.freeze({
  add: (kind, count) => feed().add(kind, count),
  note: text => feed().note(text),
  setIconProvider: fn => feed().setIconProvider(fn),
  refresh: kind => shared?.refresh(kind),
  clear: () => feed().clear(),
  get rows() { return shared ? shared.rows : []; },
});
export default pickupFeed;
