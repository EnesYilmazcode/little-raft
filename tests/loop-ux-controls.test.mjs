// Regressions for loop UX control bugs: keys held through a panel, sub-frame jump taps,
// big mouse flicks, and the fish journal's J-to-close on non-QWERTY layouts.
// Run: node --test tests/loop-ux-controls.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;

// ---------------------------------------------------------------- tiny fake DOM (window + document)
class El extends EventTarget {
  constructor(tag = 'div') {
    super(); this.tagName = tag; this.children = []; this.attrs = {}; this.style = {}; this.textContent = ''; this.className = ''; this.id = '';
    const cls = new Set(); this.classList = { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c), contains: c => cls.has(c) };
    this.open = false;
  }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'open') this.open = true; }
  append(...k) { this.children.push(...k); } appendChild(k) { this.children.push(k); return k; }
  replaceChildren(...k) { this.children = k; } remove() {} focus() {}
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent(new Event('close')); }
}
const doc = new EventTarget();
Object.assign(doc, { pointerLockElement: null, visibilityState: 'visible', head: new El('head'), body: new El('body'),
  getElementById: () => null, createElement: t => new El(t), createElementNS: () => new El() });
const win = new EventTarget(); win.document = doc;
globalThis.document = doc;
globalThis.window = win;
globalThis.dispatchEvent = () => true;
try { globalThis.navigator.getGamepads = () => []; } catch { Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true }); }

const { createInput } = await import(new URL('input.js', base));
const { ActionMap } = await import(new URL('input-map.js', base));
const { createControls } = await import(new URL('controls.js', base));
const { createJournalPanel } = await import(new URL('fish-journal.js', base));

function fire(target, type, props = {}) {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  target.dispatchEvent(e);
  return e;
}
function setupInput() {
  const w = new EventTarget(), d = new EventTarget(), canvas = new EventTarget();
  d.pointerLockElement = null; d.visibilityState = 'visible'; w.document = d;
  let blocked = false;
  const actions = [];
  const input = createInput({ target: w, element: canvas, map: new ActionMap(), doc: d, isBlocked: () => blocked,
    onAction: (id, phase) => actions.push(`${id}:${phase}`), getGamepads: () => [] });
  const key = (type, code, x = {}) => fire(w, type, { code, key: code, target: x.target ?? w, ...x });
  return { input, actions, w, d, canvas, tick: () => input.update(1 / 60), block: v => { blocked = v; },
    down: (c, x) => key('keydown', c, x), up: (c, x) => key('keyup', c, x),
    lock() { d.pointerLockElement = canvas; fire(d, 'pointerlockchange'); } };
}

// ---------------------------------------------------------------- A1: keys held through a panel
test('W held through a panel keeps moving after it closes', () => {
  const s = setupInput();
  s.down('KeyW'); s.tick();
  assert.equal(s.input.move().forward, 1);
  s.block(true);
  for (let i = 0; i < 30; i++) { s.down('KeyW', { repeat: true }); s.tick(); } // many frames with the panel open
  assert.equal(s.input.move().forward, 0, 'no movement while the panel is open');
  assert.equal(s.input.down('moveForward'), false);
  s.block(false); s.tick();
  assert.equal(s.input.move().forward, 1, 'W still held after the panel closes');
  assert.equal(s.input.down('moveForward'), true);
  assert.equal(s.input.pressed('moveForward'), false, 'held-through key is not a new press');
  s.up('KeyW'); s.tick();
  assert.equal(s.input.move().forward, 0);
});

test('a key pressed while a panel is open counts once it closes (not in form fields)', () => {
  const s = setupInput();
  s.block(true); s.tick();
  s.down('KeyD'); s.down('KeyA', { target: { closest: () => ({}) } }); s.tick();
  assert.equal(s.input.move().strafe, 0);
  s.block(false); s.tick();
  assert.equal(s.input.move().strafe, 1, 'D (pressed during the panel) counts, A typed in a field does not');
});

test('the key that closed a panel does not re-fire its action', () => {
  const s = setupInput();
  s.down('Tab'); s.tick();                      // opens inventory
  assert.deepEqual(s.actions, ['inventory:down']);
  s.up('Tab'); s.block(true); s.tick();
  s.actions.length = 0;
  s.down('Tab'); s.block(false); s.tick();      // Tab closes the panel; still held this frame
  assert.equal(s.input.pressed('inventory'), false);
  assert.ok(!s.actions.includes('inventory:down'), 'would reopen the panel: ' + s.actions);
  s.up('Tab'); s.tick();
  s.down('KeyE'); s.tick();
  assert.equal(s.input.pressed('interact'), true, 'later presses work normally');
});

test('blur during a panel still forgets held keys', () => {
  const s = setupInput();
  s.down('KeyW'); s.tick();
  s.block(true); s.tick();
  fire(s.w, 'blur');
  s.block(false); s.tick();
  assert.equal(s.input.move().forward, 0);
});

