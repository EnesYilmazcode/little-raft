// Little Raft input map: actions, default bindings, rebinding, persistence and
// stick/look shaping helpers. Pure ES module (no DOM) so it is unit-testable in node.
//
// Binding codes:
//   keyboard  KeyboardEvent.code ('KeyW', 'Space', 'ShiftLeft', ...)
//   mouse     'Mouse0'..'Mouse4', 'WheelUp', 'WheelDown'   (stored in the `keys` device)
//   gamepad   'Pad0'..'Pad16' (standard mapping buttons), 'PadAxis0-'..'PadAxis3+' (stored in `pad`)

const hotbar = Array.from({ length: 10 }, (_, i) => {
  const n = (i + 1) % 10;
  return { id: `hotbar${n}`, label: `Hotbar ${i + 1}`, group: 'Hotbar', kind: 'button' };
});

export const ACTIONS = Object.freeze([
  { id: 'moveForward', label: 'Move forward', group: 'Movement', kind: 'axis' },
  { id: 'moveBack', label: 'Move back', group: 'Movement', kind: 'axis' },
  { id: 'moveLeft', label: 'Move left', group: 'Movement', kind: 'axis' },
  { id: 'moveRight', label: 'Move right', group: 'Movement', kind: 'axis' },
  { id: 'jump', label: 'Jump', group: 'Movement', kind: 'button' },
  { id: 'sprint', label: 'Sprint', group: 'Movement', kind: 'button' },
  { id: 'crouch', label: 'Crouch', group: 'Movement', kind: 'button' },
  { id: 'use', label: 'Use / throw', group: 'Actions', kind: 'button' },
  { id: 'aim', label: 'Aim / reel', group: 'Actions', kind: 'button' },
  { id: 'interact', label: 'Interact', group: 'Actions', kind: 'button' },
  { id: 'inventory', label: 'Inventory', group: 'Actions', kind: 'button' },
  { id: 'rotate', label: 'Rotate', group: 'Actions', kind: 'button' },
  { id: 'pause', label: 'Pause', group: 'Actions', kind: 'button' },
  ...hotbar,
  { id: 'hotbarNext', label: 'Next slot', group: 'Hotbar', kind: 'button' },
  { id: 'hotbarPrev', label: 'Previous slot', group: 'Hotbar', kind: 'button' },
  { id: 'buildMenu', label: 'Build menu', group: 'Gamepad', kind: 'button' },
].map(Object.freeze));

const ACTION_IDS = new Set(ACTIONS.map((a) => a.id));
export const SLOT_COUNT = Object.freeze({ keys: 2, pad: 1 });
const DEVICES = ['keys', 'pad'];

const b = (keys = [], pad = []) => ({ keys, pad });
export const DEFAULT_BINDINGS = Object.freeze({
  moveForward: b(['KeyW', 'ArrowUp'], ['PadAxis1-']),
  moveBack: b(['KeyS', 'ArrowDown'], ['PadAxis1+']),
  moveLeft: b(['KeyA', 'ArrowLeft'], ['PadAxis0-']),
  moveRight: b(['KeyD', 'ArrowRight'], ['PadAxis0+']),
  jump: b(['Space'], ['Pad0']),
  sprint: b(['ShiftLeft', 'ShiftRight'], ['Pad10']),
  crouch: b(['KeyC'], ['Pad1']), // not Ctrl: crouch-walk would be Ctrl+W (closes the tab)
  use: b(['Mouse0'], ['Pad7']),
  aim: b(['Mouse2'], ['Pad6']),
  interact: b(['KeyE'], ['Pad2']),
  inventory: b(['Tab', 'KeyI'], ['Pad3']),
  rotate: b(['KeyR'], ['Pad11']),
  pause: b(['Escape'], ['Pad9']),
  ...Object.fromEntries(hotbar.map((a) => [a.id, b([`Digit${a.id.slice(6)}`])])),
  hotbarNext: b(['WheelDown'], ['Pad5']),
  hotbarPrev: b(['WheelUp'], ['Pad4']),
  buildMenu: b([], ['Pad12']),
});

export const SETTINGS_DEFAULTS = Object.freeze({
  invertY: false, sprintMode: 'hold', crouchMode: 'hold', mouseSmoothing: 0, rawInput: true,
  padDeadzone: 0.15, padCurve: 2, padLookSpeed: 2.6, padInvertY: false,
});
const SETTING_RULES = {
  invertY: 'bool', rawInput: 'bool', padInvertY: 'bool',
  sprintMode: ['hold', 'toggle'], crouchMode: ['hold', 'toggle'],
  mouseSmoothing: [0, 1], padDeadzone: [0, 0.9], padCurve: [0.5, 4], padLookSpeed: [0.5, 10],
};

const PAD_RE = /^Pad(\d|1[0-6])$|^PadAxis[0-3][+-]$/;
const KEY_RE = /^(Mouse[0-4]|Wheel(Up|Down)|[A-Z][A-Za-z0-9]{1,24})$/;
export function deviceOf(code) {
  if (typeof code !== 'string') return null;
  if (code.startsWith('Pad')) return PAD_RE.test(code) ? 'pad' : null;
  return KEY_RE.test(code) ? 'keys' : null;
}

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3',
  'D-Pad Up', 'D-Pad Down', 'D-Pad Left', 'D-Pad Right', 'Home'];
const AXIS_NAMES = { '0-': 'Left Stick Left', '0+': 'Left Stick Right', '1-': 'Left Stick Up', '1+': 'Left Stick Down',
  '2-': 'Right Stick Left', '2+': 'Right Stick Right', '3-': 'Right Stick Up', '3+': 'Right Stick Down' };
const KEY_NAMES = {
  Space: 'Space', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock',
  ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow', ArrowLeft: 'Left Arrow', ArrowRight: 'Right Arrow',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`',
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', PageUp: 'Page Up', PageDown: 'Page Down',
  Mouse0: 'Left Mouse', Mouse1: 'Middle Mouse', Mouse2: 'Right Mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  WheelUp: 'Wheel Up', WheelDown: 'Wheel Down',
};
const MODS = { Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Meta: 'Meta' };

export function label(code) {
  if (!code || typeof code !== 'string') return '—';
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code)) || (m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^PadAxis([0-3][+-])$/.exec(code))) return AXIS_NAMES[m[1]];
  if ((m = /^Pad(\d+)$/.exec(code))) return PAD_NAMES[+m[1]] ?? `Button ${m[1]}`;
  if ((m = /^Numpad(.+)$/.exec(code))) return `Num ${m[1]}`;
  if ((m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code))) return `${m[2]} ${MODS[m[1]]}`;
  return code;
}

const blank = () => ({ keys: new Array(SLOT_COUNT.keys).fill(null), pad: new Array(SLOT_COUNT.pad).fill(null) });
const fill = (dst, src) => {
  for (const d of DEVICES) {
    if (!Array.isArray(src?.[d])) continue;
    dst[d] = new Array(SLOT_COUNT[d]).fill(null);
    src[d].slice(0, SLOT_COUNT[d]).forEach((c, i) => { if (deviceOf(c) === d) dst[d][i] = c; });
  }
  return dst;
};

export function validateSetting(key, value) {
  const rule = SETTING_RULES[key];
  if (!rule) return undefined;
  if (rule === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (typeof rule[0] === 'string') return rule.includes(value) ? value : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(rule[1], Math.max(rule[0], value));
}

export class ActionMap {
  constructor({ bindings, settings, storage = null, storageKey = 'little-raft-controls-v1', autoSave = true } = {}) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.autoSave = false;
    this._apply({ bindings, settings });
    if (storage) this.load();
    this.autoSave = autoSave;
  }

  // Replace state with defaults overlaid by (sanitized) data; enforce invariants.
  _apply(data) {
    this.bindings = {};
    for (const a of ACTIONS) this.bindings[a.id] = fill(blank(), DEFAULT_BINDINGS[a.id]);
    const src = data?.bindings && typeof data.bindings === 'object' ? { ...data.bindings } : {};
    // old default crouch was Ctrl+C; saves that still hold exactly that move to the new default (customised ones stay)
    const ck = src.crouch?.keys;
    if (Array.isArray(ck) && ck.length === 2 && ck[0] === 'ControlLeft' && ck[1] === 'KeyC') src.crouch = { ...src.crouch, keys: ['KeyC'] };
    for (const id of Object.keys(src)) if (ACTION_IDS.has(id)) fill(this.bindings[id], src[id]);
    this.settings = { ...SETTINGS_DEFAULTS };
    const s = data?.settings && typeof data.settings === 'object' ? data.settings : {};
    for (const k of Object.keys(s)) {
      const v = validateSetting(k, s[k]);
      if (v !== undefined) this.settings[k] = v;
    }
    // Escape belongs to pause only; pause always keeps it; first claimant wins on duplicates.
    const seen = new Set(['Escape']);
    for (const a of ACTIONS) for (const d of DEVICES) {
      const list = this.bindings[a.id][d];
      list.forEach((c, i) => {
        if (!c || (c === 'Escape' && a.id === 'pause')) return;
        if (seen.has(c)) list[i] = null; else seen.add(c);
      });
    }
    const pk = this.bindings.pause.keys;
    if (!pk.includes('Escape')) pk[pk.indexOf(null) >= 0 ? pk.indexOf(null) : 0] = 'Escape';
  }

  _changed() { if (this.autoSave) this.save(); }

  bindingsFor(id) {
    const e = this.bindings[id];
    return e ? { keys: [...e.keys], pad: [...e.pad] } : null;
  }

  actionFor(code) {
    const d = deviceOf(code);
    if (!d) return [];
    return ACTIONS.filter((a) => this.bindings[a.id][d].includes(code)).map((a) => a.id);
  }

  rebind(id, code, { slot = 0, device } = {}) {
    const d = deviceOf(code);
    device = device ?? d;
    if (!ACTION_IDS.has(id) || !d || d !== device || !(slot >= 0 && slot < SLOT_COUNT[d])) return { ok: false, reason: 'invalid' };
    if (code === 'Escape' && id !== 'pause') return { ok: false, reason: 'reserved' };
    const list = this.bindings[id][d];
    if (list.includes(code)) return { ok: true, unchanged: true };
    const prev = list[slot];
    if (id === 'pause' && prev === 'Escape') return { ok: false, reason: 'reserved' };
    const res = { ok: true };
    for (const a of ACTIONS) {
      const other = this.bindings[a.id][d];
      const j = other.indexOf(code);
      if (a.id === id || j < 0) continue;
      other[j] = prev;
      res.swappedWith = a.id;
      if (prev) res.swappedCode = prev;
    }
    list[slot] = code;
    this._changed();
    return res;
  }

  unbind(id, slot = 0, device = 'keys') {
    const list = this.bindings[id]?.[device];
    if (!list || !(slot >= 0 && slot < list.length)) return false;
    if (id === 'pause' && list[slot] === 'Escape') return false;
    list[slot] = null;
    this._changed();
    return true;
  }

  resetAction(id) {
    if (!ACTION_IDS.has(id)) return false;
    const def = fill(blank(), DEFAULT_BINDINGS[id]);
    for (const d of DEVICES) for (const c of def[d]) {
      if (!c) continue;
      for (const a of ACTIONS) {
        const j = this.bindings[a.id][d].indexOf(c);
        if (a.id !== id && j >= 0) this.bindings[a.id][d][j] = null;
      }
    }
    this.bindings[id] = def;
    this._changed();
    return true;
  }

  resetAll() {
    this._apply({});
    this._changed();
  }

  setSetting(key, value) {
    const v = validateSetting(key, value);
    if (v === undefined) return false;
    this.settings[key] = v;
    this._changed();
    return true;
  }

  conflicts() {
    const owners = new Map();
    for (const a of ACTIONS) for (const d of DEVICES) for (const c of this.bindings[a.id][d]) {
      if (c) owners.set(c, [...(owners.get(c) || []), a.id]);
    }
    return [...owners].filter(([, ids]) => ids.length > 1).map(([code, ids]) => ({ code, ids }));
  }

  serialize() {
    const bindings = {};
    for (const a of ACTIONS) bindings[a.id] = this.bindingsFor(a.id);
    return { v: 1, bindings, settings: { ...this.settings } };
  }

  save() {
    if (!this.storage) return false;
    try { this.storage.setItem(this.storageKey, JSON.stringify(this.serialize())); return true; } catch { return false; }
  }

  load() {
    let data = null;
    try {
      const raw = this.storage?.getItem(this.storageKey);
      if (raw) data = JSON.parse(raw);
    } catch { data = null; }
    if (!data || typeof data !== 'object' || data.v !== 1) return false;
    this._apply(data);
    return true;
  }

  label(code) { return label(code); }
}

// Radial deadzone, rescale to 0..1 past the deadzone, magnitude^curve, clamp length <= 1.
// Pass `out` (a 2-array) to fill and return it instead of allocating.
export function shapeStick(x, y, deadzone = 0.15, curve = 2, out = null) {
  const r = out || [0, 0];
  const m = Math.hypot(x, y);
  const dz = Math.min(0.99, Math.max(0, deadzone || 0));
  if (!Number.isFinite(m) || m <= dz) { r[0] = 0; r[1] = 0; return r; }
  const t = (Math.min(1, m) - dz) / (1 - dz);
  const s = Math.pow(t, curve > 0 ? curve : 1) / m;
  r[0] = x * s; r[1] = y * s;
  return r;
}

// Exponential averaging of look deltas; smoothing 0 is an exact passthrough.
// Pass `out` (a 2-array) to fill and return it instead of allocating.
export function smoothLook(state, dx, dy, smoothing = 0, out = null) {
  const r = out || [0, 0];
  if (!(smoothing > 0)) {
    state.x = dx; state.y = dy;
  } else {
    const k = 1 - Math.min(0.95, smoothing);
    state.x = (state.x || 0) + (dx - (state.x || 0)) * k;
    state.y = (state.y || 0) + (dy - (state.y || 0)) * k;
  }
  r[0] = state.x; r[1] = state.y;
  return r;
}
