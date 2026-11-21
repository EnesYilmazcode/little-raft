// Shell Book tab for the logbook: pure string builders (no THREE, no game state). shellSvg(id, known) is
// a 48x48 inline SVG per kind (unknown = the same shape as a faint silhouette); shellsBookHTML(view) is
// the panel HTML for a shells-rules.js bookView(). All text is escaped here. Spec: docs/specs/shells.md.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// [main, dark (ribs, lines), light (highlight)] per kind
const COLORS = {
  button: ['#e9c7a4', '#a97b55', '#fbe7d2'], sunfan: ['#f4b860', '#b9732c', '#ffe3a8'], tiddly: ['#d8c3a5', '#8a6d52', '#f1e4cf'],
  pebble: ['#9fa8a3', '#5f6a66', '#cfd6d1'], ribbon: ['#e3a38e', '#9b5c4b', '#f6d3c6'], moonsnail: ['#dfe4f2', '#7f88a8', '#ffffff'],
  piggy: ['#e8b4b8', '#a0636b', '#fbe1e3'], butterfly: ['#b9d7e8', '#5f8aa3', '#e7f4fb'], crown: ['#f08a6c', '#a34a35', '#ffc8b4'],
  lantern: ['#f2e2c4', '#a2764a', '#fff6e4'], starry: ['#ece3c9', '#a8996c', '#fffaf0'], pearl: ['#f6c6d6', '#b56f88', '#ffffff'],
};

// Each shape: (m, d, l) -> inner SVG markup. Fills/strokes use the three colours only.
const ray = (cx, cy, r, a0, a1, n, d, w = 1.4) => {
  let s = '';
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (n === 1 ? 0.5 : i / (n - 1));
    s += `<path d="M${cx} ${cy}L${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}" stroke="${d}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
  }
  return s;
};
const SHAPES = {
  // round fan, 7 ribs
  fan: (m, d, l) => `<path d="M24 41L9.5 24.5A16 16 0 0 1 38.5 24.5Z" fill="${m}"/><path d="M19 41h10l-2 -4h-6Z" fill="${d}"/>${ray(24, 39, 15, -2.55, -0.59, 7, d)}<path d="M14 21A12 12 0 0 1 22 12" stroke="${l}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  // wide fan, wavy rim, two ears
  scallop: (m, d, l) => `<path d="M24 40L6 22Q8 17 11 17Q13 12 17 12Q20 8 24 9Q28 8 31 12Q35 12 37 17Q40 17 42 22Z" fill="${m}"/><path d="M16 40h16l-3 -5h-10Z" fill="${d}"/>${ray(24, 38, 24, -2.6, -0.54, 9, d, 1.2)}<path d="M12 20Q15 14 21 12" stroke="${l}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  // short spiral cone
  cone: (m, d, l) => `<path d="M24 5L35 30Q36 40 26 42Q15 43 13 33Z" fill="${m}"/><path d="M17 16L31 21M15 24L34 29M14 32L34 36" stroke="${d}" stroke-width="1.5" fill="none" stroke-linecap="round"/><ellipse cx="23" cy="37" rx="4" ry="3" fill="${d}"/><path d="M21 9L18 18" stroke="${l}" stroke-width="1.6" stroke-linecap="round"/>`,
  // low dome, no spiral
  dome: (m, d, l) => `<path d="M5 34Q8 14 24 13Q40 14 43 34Z" fill="${m}"/><rect x="4" y="33" width="40" height="4" rx="2" fill="${d}"/>${ray(24, 33, 18, -2.8, -0.34, 7, d, 1.2)}<circle cx="24" cy="18" r="2.5" fill="${l}"/>`,
  // long thin spike
  spike: (m, d, l) => `<path d="M33 4L38 9L14 44L11 42Z" fill="${m}"/><path d="M31 9L35 12M27 15L31 18M23 21L27 24M19 27L23 30M15 33L19 36" stroke="${d}" stroke-width="1.6" stroke-linecap="round"/><path d="M33 7L17 36" stroke="${l}" stroke-width="1" stroke-linecap="round"/>`,
  // fat round coil
  coil: (m, d, l) => `<circle cx="24" cy="25" r="17" fill="${m}"/><path d="M24 25m-3 0a3 3 0 1 1 6 0a7 7 0 1 1 -14 0a11 11 0 1 1 22 0a14 14 0 0 1 -6 11" stroke="${d}" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M14 15A13 13 0 0 1 22 10" stroke="${l}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  // glossy egg, slit belly
  egg: (m, d, l) => `<ellipse cx="24" cy="24" rx="12" ry="18" fill="${m}"/><path d="M24 8Q21 24 24 40" stroke="${d}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M21 14h2M20 19h2.5M20 24h2.5M20 29h2.5M21 34h2" stroke="${d}" stroke-width="1.3" stroke-linecap="round"/><ellipse cx="30" cy="16" rx="2.5" ry="5" fill="${l}"/>`,
  // two joined wings
  wings: (m, d, l) => `<path d="M24 33L5 19Q8 9 18 11Q23 14 24 20Z" fill="${m}"/><path d="M24 33L43 19Q40 9 30 11Q25 14 24 20Z" fill="${m}"/>${ray(24, 32, 16, -2.7, -1.75, 4, d, 1.2)}${ray(24, 32, 16, -1.39, -0.44, 4, d, 1.2)}<circle cx="24" cy="33" r="3" fill="${d}"/><path d="M10 16Q13 12 17 13" stroke="${l}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
  // spiky crown spiral
  crown: (m, d, l) => `<path d="M8 40L10 20L15 28L18 12L22 26L24 6L26 26L30 12L33 28L38 20L40 40Z" fill="${m}"/><rect x="7" y="36" width="34" height="6" rx="3" fill="${d}"/><path d="M12 33Q24 28 36 33" stroke="${d}" stroke-width="1.5" fill="none"/><circle cx="24" cy="10" r="1.8" fill="${l}"/><circle cx="18" cy="16" r="1.4" fill="${l}"/><circle cx="30" cy="16" r="1.4" fill="${l}"/>`,
  // chambered coil
  nautilus: (m, d, l) => `<path d="M40 26A16 16 0 1 1 26 9Q38 10 40 26Z" fill="${m}"/><path d="M26 26m0 -3a3 3 0 1 1 -3 3a7 7 0 1 1 7 7a11 11 0 1 1 -11 -11" stroke="${d}" stroke-width="1.6" fill="none"/><path d="M26 9L25 17M38 20L31 23M39 32L31 30M29 41L27 33M14 38L20 31M9 25L17 26" stroke="${d}" stroke-width="1.3" stroke-linecap="round"/><path d="M14 16A15 15 0 0 1 22 11" stroke="${l}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  // flat disc, five-petal star
  star: (m, d, l) => {
    let petals = '';
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; const x = 24 + Math.cos(a) * 9, y = 24 + Math.sin(a) * 9; petals += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="2.2" ry="5" transform="rotate(${(i * 72).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${d}"/>`; }
    return `<circle cx="24" cy="24" r="18" fill="${m}"/>${petals}<circle cx="24" cy="24" r="2" fill="${d}"/><path d="M11 15A16 16 0 0 1 19 8" stroke="${l}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  },
  // heart-shaped clam with a pearl
  heart: (m, d, l) => `<path d="M24 42L8 25Q3 17 9 11Q16 6 24 14Q32 6 39 11Q45 17 40 25Z" fill="${m}"/>${ray(24, 40, 22, -2.4, -0.74, 6, d, 1.1)}<circle cx="24" cy="26" r="5.5" fill="${l}"/><circle cx="22.4" cy="24.4" r="1.6" fill="#ffffff"/>`,
};
const SHAPE_OF = {
  button: 'fan', sunfan: 'scallop', tiddly: 'cone', pebble: 'dome', ribbon: 'spike', moonsnail: 'coil',
  piggy: 'egg', butterfly: 'wings', crown: 'crown', lantern: 'nautilus', starry: 'star', pearl: 'heart',
};

const svgCache = new Map();
// 48x48 inline SVG for a shell kind. known=false draws the same shape flat in currentColor at 25%.
export function shellSvg(id, known = true) {
  const key = id + (known ? '+' : '-');
  const hit = svgCache.get(key);
  if (hit) return hit;
  const fn = SHAPES[SHAPE_OF[id]] || SHAPES.fan;
  const inner = known ? fn(...(COLORS[id] || COLORS.button)) : `<g opacity=".25">${fn('currentColor', 'currentColor', 'currentColor')}</g>`;
  const s = `<svg class="sb-art" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">${inner}</svg>`;
  svgCache.set(key, s);
  return s;
}

const CSS_ID = 'shells-book-css';
const CSS = `
.sb-head{margin:0 0 8px;font:600 12px/1.3 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#d6b67e}
.sb-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.sb-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:8px 6px;min-width:0;text-align:center;background:linear-gradient(180deg,#664730e8,#46301ce8);border-radius:4px;box-shadow:inset 0 0 0 1px #d4b07a44;color:#fff2cc}
.sb-card .sb-art{width:48px;height:48px;flex:none}
.sb-card b{display:block;font:600 13px/1.25 system-ui,sans-serif;color:#fff2cc;overflow-wrap:anywhere}
.sb-card .sb-chip{display:inline-block;padding:2px 6px;border-radius:3px;font:700 10px/1.2 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#2a1b0e}
.sb-card p{margin:0;font-size:12px;line-height:1.35;color:#e8d3a8;font-style:italic}
.sb-card small{display:block;font-size:11px;line-height:1.3;color:#d6b67e}
.sb-card.sb-unknown{background:#2a1b0ecc;box-shadow:inset 0 0 0 1px #b48d5533;color:#d6b67e}
.sb-card.sb-unknown b{color:#d6b67e99}
.sb-card.sb-unknown small{color:#d6b67e99}
.sb-n{position:absolute;top:4px;right:6px;font:700 11px/1 system-ui,sans-serif;color:#ffe3a6;font-variant-numeric:tabular-nums}
.sb-sets{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.sb-set{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;background:#2a1b0ecc;box-shadow:inset 0 0 0 1px #b48d5544;font-size:13px;color:#e8d3a8}
.sb-set b{color:#fff2cc;font-weight:600}
.sb-set.sb-done{box-shadow:inset 0 0 0 2px #ffcf7d99}
.sb-set em{font:600 11px/1.2 system-ui,sans-serif;font-style:normal;text-transform:uppercase;letter-spacing:.06em;color:#ffcf7d;white-space:nowrap}
.sb-bar{flex:none;width:52px;height:6px;border-radius:3px;background:#24170c;overflow:hidden}
.sb-bar i{display:block;height:100%;background:linear-gradient(90deg,#c58f32,#ffcf7d)}
@media (max-width:520px){.sb-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.sb-card{padding:6px 4px}.sb-card p{font-size:11px}.sb-set{flex-wrap:wrap}}
`;
// Inject the scoped CSS once (no-op without a document).
export function ensureShellsCss() {
  if (typeof document === 'undefined' || !document.head) return;
  let st = document.getElementById(CSS_ID);
  if (!st) { st = document.createElement('style'); st.id = CSS_ID; document.head.append(st); }
  if (st.textContent !== CSS) st.textContent = CSS;
}

const who = by => (by === 'guest' ? 'Guest' : 'Host');
function card(c) {
  if (!c.known) return `<div class="sb-card sb-unknown">${shellSvg(c.id, false)}<b>???</b><small>${esc(c.hint)}</small></div>`;
  return `<div class="sb-card">${shellSvg(c.id, true)}<span class="sb-n" title="Times found">×${c.n}</span><b>${esc(c.name)}</b>`
    + `<span class="sb-chip" style="background:${esc(c.color)}">${esc(c.rarityLabel)}</span><p>${esc(c.note)}</p>`
    + `<small>First found on day ${c.day | 0} by ${who(c.by)}</small></div>`;
}
function setRow(s) {
  const pct = s.need > 0 ? Math.round(s.have / s.need * 100) : 0;
  const end = s.done ? '<em>Gift received</em>' : `<span class="sb-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>`;
  return `<li class="sb-set${s.done ? ' sb-done' : ''}"><span><b>${esc(s.name)}</b> ${s.have}/${s.need} · gift: ${esc(s.gift)}</span>${end}</li>`;
}
// Panel HTML for bookView(st). Safe with a missing/odd view (renders an empty book).
export function shellsBookHTML(v) {
  ensureShellsCss();
  const cards = v && Array.isArray(v.cards) ? v.cards : [], sets = v && Array.isArray(v.sets) ? v.sets : [];
  const found = cards.filter(c => c.known).length;
  return `<p class="sb-head">Crew Shell Book · ${found}/${cards.length} found · repeats give Bright Shells</p>`
    + `<div class="sb-grid">${cards.map(card).join('')}</div>`
    + `<ul class="sb-sets">${sets.map(setRow).join('')}</ul>`;
}
