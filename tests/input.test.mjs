// Unit tests for the pure input map module.
// Run: node --test tests/input.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, DEFAULT_BINDINGS, SETTINGS_DEFAULTS, ActionMap, shapeStick, smoothLook, label,
} from '../dist/input-map.js';

const KEY = 'little-raft-controls-v1';
const fakeStorage = (init = {}) => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('actions and defaults are consistent', () => {
  const ids = ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['moveForward', 'jump', 'use', 'pause', 'hotbar1', 'hotbar0', 'buildMenu', 'aim']) assert.ok(ids.includes(id));
  for (const id of ids) assert.ok(DEFAULT_BINDINGS[id], `default for ${id}`);
  const m = new ActionMap();
  assert.deepEqual(m.conflicts(), []);
  assert.deepEqual(m.bindingsFor('moveForward'), { keys: ['KeyW', 'ArrowUp'], pad: ['PadAxis1-'] });
  assert.equal(m.bindingsFor('hotbar0').keys[0], 'Digit0');
  assert.equal(m.bindingsFor('pause').pad[0], 'Pad9');
  assert.deepEqual(m.bindingsFor('drop'), { keys: ['KeyQ', null], pad: ['Pad8'] }, 'Raft: Q drops the held item');
  assert.deepEqual(m.settings, SETTINGS_DEFAULTS);
  assert.equal(m.bindingsFor('nope'), null);
});

test('reverse lookup', () => {
  const m = new ActionMap();
  assert.deepEqual(m.actionFor('KeyW'), ['moveForward']);
  assert.deepEqual(m.actionFor('Pad0'), ['jump']);
  assert.deepEqual(m.actionFor('Mouse0'), ['use']);
  assert.deepEqual(m.actionFor('KeyZ'), []);
  assert.deepEqual(m.actionFor(42), []);
});

test('rebind swaps conflicting code into the freed slot', () => {
  const m = new ActionMap();
  const r = m.rebind('jump', 'KeyE');
  assert.equal(r.ok, true);
  assert.equal(r.swappedWith, 'interact');
  assert.equal(m.bindingsFor('jump').keys[0], 'KeyE');
  assert.equal(m.bindingsFor('interact').keys[0], 'Space');
  assert.deepEqual(m.conflicts(), []);
  // pad device inferred
  assert.equal(m.rebind('jump', 'Pad3').swappedWith, 'inventory');
  assert.equal(m.bindingsFor('inventory').pad[0], 'Pad0');
  // into an empty slot: conflicting action just loses the code
  const r2 = m.rebind('interact', 'KeyR', { slot: 1 });
  assert.equal(r2.swappedWith, 'rotate');
  assert.equal(m.bindingsFor('rotate').keys[0], null);
});

test('rebinding to the same action is a no-op', () => {
  const m = new ActionMap();
  const before = JSON.stringify(m.serialize());
  assert.deepEqual(m.rebind('moveForward', 'ArrowUp', { slot: 0 }), { ok: true, unchanged: true });
  assert.equal(JSON.stringify(m.serialize()), before);
});

test('invalid rebinds are rejected', () => {
  const m = new ActionMap();
  assert.equal(m.rebind('jump', 'Pad99').ok, false);
  assert.equal(m.rebind('jump', 'KeyW', { slot: 5 }).ok, false);
  assert.equal(m.rebind('jump', 'KeyW', { device: 'pad' }).ok, false);
  assert.equal(m.rebind('bogus', 'KeyW').ok, false);
});

test('Escape and pause are protected', () => {
  const m = new ActionMap();
  assert.equal(m.rebind('jump', 'Escape').ok, false);
  assert.equal(m.rebind('pause', 'KeyP', { slot: 0 }).ok, false);
  assert.equal(m.unbind('pause', 0, 'keys'), false);
  assert.equal(m.bindingsFor('pause').keys[0], 'Escape');
  assert.equal(m.rebind('pause', 'KeyP', { slot: 1 }).ok, true);
  assert.deepEqual(m.bindingsFor('pause').keys, ['Escape', 'KeyP']);
  assert.equal(m.unbind('pause', 0, 'pad'), true);
});

test('unbind, resetAction, resetAll', () => {
  const m = new ActionMap();
  assert.equal(m.unbind('moveForward', 1, 'keys'), true);
  assert.deepEqual(m.bindingsFor('moveForward').keys, ['KeyW', null]);
  assert.deepEqual(m.actionFor('ArrowUp'), []);
  assert.equal(m.unbind('moveForward', 9, 'keys'), false);
  m.rebind('jump', 'KeyW');
  assert.equal(m.bindingsFor('moveForward').keys[0], 'Space');
  m.resetAction('moveForward');
  assert.deepEqual(m.bindingsFor('moveForward').keys, ['KeyW', 'ArrowUp']);
  assert.equal(m.bindingsFor('jump').keys[0], null, 'reset steals its default code back');
  assert.deepEqual(m.conflicts(), []);
  m.setSetting('invertY', true);
  m.resetAll();
  assert.deepEqual(m.serialize(), new ActionMap().serialize());
});

test('persistence round trip with injectable storage', () => {
  const storage = fakeStorage();
  const m = new ActionMap({ storage });
  m.rebind('jump', 'KeyF');
  m.setSetting('padDeadzone', 0.25);
  m.setSetting('sprintMode', 'toggle');
  assert.ok(storage.data[KEY], 'auto-saved under versioned key');
  const m2 = new ActionMap({ storage });
  assert.equal(m2.bindingsFor('jump').keys[0], 'KeyF');
  assert.equal(m2.settings.padDeadzone, 0.25);
  assert.equal(m2.settings.sprintMode, 'toggle');
  assert.deepEqual(m2.serialize(), m.serialize());
});

test('garbage in storage is tolerated', () => {
  for (const raw of ['{not json', 'null', '42', '[]', JSON.stringify({ v: 99, bindings: { jump: { keys: ['KeyF'] } } })]) {
    const m = new ActionMap({ storage: fakeStorage({ [KEY]: raw }) });
    assert.deepEqual(m.serialize(), new ActionMap().serialize(), raw);
  }
  const m = new ActionMap({
    storage: fakeStorage({
      [KEY]: JSON.stringify({
        v: 1,
        bindings: {
          ghost: { keys: ['KeyG'] }, jump: { keys: [7, 'KeyF', 'KeyH'], pad: 'Pad0' },
          crouch: { keys: ['Escape'] }, interact: { keys: ['KeyF'] }, pause: { keys: ['KeyP'] }, use: null,
        },
        settings: { invertY: 'yes', padCurve: 99, mouseSmoothing: NaN, padDeadzone: -1, sprintMode: 'run', bogus: 1 },
      }),
    }),
  });
  assert.deepEqual(m.bindingsFor('jump'), { keys: [null, 'KeyF'], pad: ['Pad0'] });
  assert.equal(m.bindingsFor('crouch').keys[0], null, 'Escape stripped from non-pause');
  assert.ok(!m.bindingsFor('interact').keys.includes('KeyF'), 'duplicate dropped');
  assert.ok(m.bindingsFor('pause').keys.includes('Escape'), 'pause keeps Escape');
  assert.deepEqual(m.bindingsFor('use'), new ActionMap().bindingsFor('use'));
  assert.equal(m.settings.invertY, false);
  assert.equal(m.settings.padCurve, 4);
  assert.equal(m.settings.padDeadzone, 0);
  assert.equal(m.settings.mouseSmoothing, 0);
  assert.equal(m.settings.sprintMode, 'hold');
  assert.ok(!('bogus' in m.settings));
  assert.deepEqual(m.conflicts(), []);
});

test('storage that throws does not break anything', () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const m = new ActionMap({ storage });
  assert.equal(m.load(), false);
  assert.equal(m.rebind('jump', 'KeyF').ok, true);
  assert.equal(m.save(), false);
  assert.equal(new ActionMap({ storage: null }).save(), false);
});

test('settings validation and clamping', () => {
  const m = new ActionMap();
  assert.equal(m.setSetting('padDeadzone', 5), true);
  assert.equal(m.settings.padDeadzone, 0.9);
  assert.equal(m.setSetting('mouseSmoothing', -3), true);
  assert.equal(m.settings.mouseSmoothing, 0);
  assert.equal(m.setSetting('padLookSpeed', Infinity), false);
  assert.equal(m.setSetting('padLookSpeed', '3'), false);
  assert.equal(m.setSetting('crouchMode', 'toggle'), true);
  assert.equal(m.setSetting('crouchMode', 'sometimes'), false);
  assert.equal(m.setSetting('invertY', 1), false);
  assert.equal(m.setSetting('unknown', true), false);
  assert.equal(m.settings.crouchMode, 'toggle');
});

test('labels', () => {
  const m = new ActionMap();
  const cases = { KeyW: 'W', Digit3: '3', Space: 'Space', ShiftLeft: 'Left Shift', ControlRight: 'Right Ctrl',
    Mouse0: 'Left Mouse', Mouse2: 'Right Mouse', WheelUp: 'Wheel Up', Pad4: 'LB', Pad7: 'RT', Pad12: 'D-Pad Up',
    'PadAxis1-': 'Left Stick Up', 'PadAxis2+': 'Right Stick Right', Escape: 'Esc', Numpad5: 'Num 5', F5: 'F5' };
  for (const [c, l] of Object.entries(cases)) assert.equal(m.label(c), l, c);
  assert.equal(label(null), '—');
});

test('shapeStick deadzone, curve and clamp', () => {
  assert.deepEqual(shapeStick(0.1, 0.1, 0.15, 2), [0, 0]);
  assert.deepEqual(shapeStick(NaN, 0, 0.15, 2), [0, 0]);
  const [x] = shapeStick(1, 0, 0.15, 2);
  near(x, 1);
  // halfway between deadzone and edge -> 0.5^curve
  const mid = 0.15 + 0.85 / 2;
  near(shapeStick(mid, 0, 0.15, 2)[0], 0.25);
  near(shapeStick(0, -mid, 0.15, 1)[1], -0.5);
  // over-range diagonals clamp to unit length, keep direction
  const [cx, cy] = shapeStick(1, 1, 0.15, 2);
  near(Math.hypot(cx, cy), 1);
  near(cx, cy);
  // monotonic just past the deadzone
  assert.ok(shapeStick(0.16, 0, 0.15, 2)[0] < shapeStick(0.3, 0, 0.15, 2)[0]);
});

test('smoothLook passthrough at 0 and convergence', () => {
  const s = {};
  assert.deepEqual(smoothLook(s, 3.5, -2, 0), [3.5, -2]);
  const t = { x: 0, y: 0 };
  let out;
  const first = smoothLook(t, 10, -10, 0.5);
  assert.ok(first[0] > 0 && first[0] < 10);
  for (let i = 0; i < 200; i++) out = smoothLook(t, 10, -10, 0.5);
  near(out[0], 10, 1e-6);
  near(out[1], -10, 1e-6);
  // smoothing 1 still converges (internally capped)
  const u = {};
  for (let i = 0; i < 2000; i++) out = smoothLook(u, 1, 1, 1);
  near(out[0], 1, 1e-6);
});
