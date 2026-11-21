// Little Raft gamepad focus layer: moves keyboard focus around the open panel (bag/crafting, pause, settings,
// other dialogs) from the pad events input.js emits while blocked (menuNav). DOM module, nothing happens on import.
// createPadNav({doc, scope}) -> {handle(id, phase)}; scope() returns the open panel's root element or null.
//  - nav*: a synthetic Arrow keydown/keyup goes to the focused element first, so panels with their own arrow
//    handling (survival-ui.js slots, recipe list, category tabs) keep it; unhandled, focus moves spatially.
//    Range inputs step left/right, selects cycle left/right.
//  - activate: Enter keydown on 'down' (craft button: starts hold-to-craft) and keyup on 'up'; buttons, checkboxes
//    and links that do not handle Enter themselves are clicked.
//  - tabPrev/tabNext: the panel's visible tablist moves one tab.

const FOCUSABLE = 'button, input:not([type=hidden]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
const ARROW = { navUp: 'ArrowUp', navDown: 'ArrowDown', navLeft: 'ArrowLeft', navRight: 'ArrowRight' };
const DIRS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
const STYLE_ID = 'lr-padnav-style';
const CSS = 'body.pad-nav :focus{outline:2px solid var(--amber,#e9a640)!important;outline-offset:2px}';

// Nearest rect in the arrow's direction (centre distance along it, span gap across it): inside a 45 degree cone first, else anywhere in that half-plane. -1 = none.
export function pickNeighbor(rects, from, code) {
  const d = DIRS[code], a = rects[from];
  if (!d || !a) return -1;
  const cx = r => r.left + r.width / 2, cy = r => r.top + r.height / 2;
  const ax = cx(a), ay = cy(a), tol = Math.min(a.width, a.height) / 4;
  let cone = -1, coneScore = Infinity, half = -1, halfScore = Infinity;
  rects.forEach((r, i) => {
    if (!r || i === from) return;
    const dx = cx(r) - ax, dy = cy(r) - ay;
    // across = gap between the two spans perpendicular to the move (0 when they overlap): a wide button
    // straight below (the craft button under its recipe's Pin) beats a nearer-centred one off to the side
    const lo = d[0] ? 'top' : 'left', ext = d[0] ? 'height' : 'width';
    const along = dx * d[0] + dy * d[1], across = Math.max(0, r[lo] - (a[lo] + a[ext]), a[lo] - (r[lo] + r[ext]));
    if (along <= tol) return;
    const score = along + across * 2;
    if (across <= along) { if (score < coneScore) { coneScore = score; cone = i; } }
    else if (score < halfScore) { halfScore = score; half = i; }
  });
  return cone >= 0 ? cone : half;
}

export function createPadNav({ doc = globalThis.document, scope = () => null } = {}) {
  const win = doc?.defaultView ?? globalThis.window;
  let pressed = null; // element that got the activate keydown (gets the keyup)

  function ensureStyle() {
    if (doc.getElementById(STYLE_ID)) return;
    const s = doc.createElement('style'); s.id = STYLE_ID; s.textContent = CSS; doc.head.appendChild(s);
  }
  // the ring shows while the pad drives the menu; the mouse takes it away again
  const padMode = on => doc.body?.classList.toggle('pad-nav', on);
  win?.addEventListener?.('pointermove', () => padMode(false), { passive: true });
  win?.addEventListener?.('pointerdown', () => padMode(false), { passive: true });

  const shown = el => {
    if (el.disabled || el.closest('[hidden], [inert]')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && win?.getComputedStyle?.(el).visibility !== 'hidden';
  };
  const focusables = root => [...root.querySelectorAll(FOCUSABLE)].filter(shown);
  function focus(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch {}
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
  }
  // first stop in a panel: its selected tab / autofocus, else the first control
  const preferred = (root, list) => list.find(el => el.matches('[autofocus], [role=tab][aria-selected=true]')) ?? list[0];
  function key(el, type, code) {
    const k = code.startsWith('Arrow') ? code : code === 'Space' ? ' ' : code;
    const ev = new win.KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }
  const fireValue = el => { el.dispatchEvent(new win.Event('input', { bubbles: true })); el.dispatchEvent(new win.Event('change', { bubbles: true })); };

  // returns the focused element inside root, or focuses the panel's first stop and returns null
  function current(root) {
    const list = focusables(root), a = doc.activeElement;
    if (a && root.contains(a) && list.includes(a)) return { el: a, list };
    focus(preferred(root, list));
    return null;
  }

  function move(root, code) {
    const cur = current(root); if (!cur) return;
    const { el, list } = cur, horiz = code === 'ArrowLeft' || code === 'ArrowRight', sign = code === 'ArrowRight' ? 1 : -1;
    if (horiz && el.matches('input[type=range]')) {
      const before = el.value;
      try { sign > 0 ? el.stepUp() : el.stepDown(); } catch {}
      if (el.value !== before) fireValue(el);
      return;
    }
    if (horiz && el.tagName === 'SELECT' && el.options.length) {
      const i = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + sign));
      if (i !== el.selectedIndex) { el.selectedIndex = i; fireValue(el); }
      return;
    }
    // a tablist's own arrows only run along it (survival-ui.js category tabs are vertical): across it, leave spatially
    const tl = el.matches('[role=tab]') ? el.closest('[role=tablist]') : null;
    const across = tl && (tl.getAttribute('aria-orientation') === 'vertical' ? horiz : !horiz);
    const handled = !across && key(el, 'keydown', code); if (!across) key(el, 'keyup', code); // keyup too: input.js must not think an arrow is held
    if (handled) return; // the panel moved focus itself (slot grid, recipe list, category tabs)
    // leaving a tablist forward (right of a vertical one, below a horizontal one): into its tab panel, at the picked entry
    if (across && (code === 'ArrowRight' || code === 'ArrowDown')) {
      const inPanel = list.filter(e => e.closest('[role=tabpanel]') && !tl.contains(e));
      const pick = inPanel.find(e => e.matches('[aria-selected=true], [aria-current], [aria-pressed=true], .sv-pick')) ?? inPanel[0];
      if (pick) { focus(pick); return; }
    }
    const i = pickNeighbor(list.map(e => e.getBoundingClientRect()), list.indexOf(el), code);
    if (i >= 0) focus(list[i]);
  }

  function activate(root, phase) {
    if (phase === 'up') { const el = pressed; pressed = null; if (el) key(el, 'keyup', 'Enter'); return; }
    const cur = current(root); if (!cur) return;
    const { el } = cur;
    if (el.matches('input[type=range]')) return;
    pressed = el;
    if (key(el, 'keydown', 'Enter')) return; // handled (craft button: one craft now, holding A keeps crafting)
    if (el.matches('button, a[href], input[type=checkbox], input[type=radio], input[type=button], input[type=submit], [role=button], [role=tab], summary')) el.click();
  }

  function tab(root, dir) {
    const lists = [...root.querySelectorAll('[role=tablist]')].filter(shown);
    const tl = lists[0]; if (!tl) return;
    const tabs = [...tl.querySelectorAll('[role=tab]')].filter(shown);
    if (!tabs.length) return;
    let i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    i = ((i < 0 ? 0 : i + dir) % tabs.length + tabs.length) % tabs.length;
    tabs[i].click();
    focus(tabs[i]);
  }

  function handle(id, phase = 'down') {
    const root = scope();
    if (!root) { pressed = null; return false; }
    ensureStyle(); padMode(true);
    if (ARROW[id]) { if (phase === 'down') move(root, ARROW[id]); }
    else if (id === 'activate') activate(root, phase);
    else if (id === 'tabPrev' || id === 'tabNext') { if (phase === 'down') tab(root, id === 'tabNext' ? 1 : -1); }
    else return false;
    return true;
  }
  return { handle };
}
