// Round-6 building regressions: stairs underfoot pickable (K5), host reach for pieces (K4), pieces vs decor
// overlap (K3), hammer chip / R routing (K1), decor rotation steps (K2), pad rotate + remove (P2), and
// X removing decor and bare floor tiles (K6).
// Run: node --test tests/r6-build.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;

// ---- minimal DOM: any unknown property is a no-op function / nested fake ----
const noop = () => {};
function fakeEl() {
  const cls = new Set(), store = { dataset: {}, style: {}, hidden: false, offsetWidth: 0, width: 0, height: 0 };
  const classList = { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) };
  const el = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'classList') return classList;
      if (k === 'querySelectorAll') return () => Array.from({ length: 16 }, () => fakeEl());
      if (k === 'getContext' || k === 'closest') return () => fakeEl();
      if (k === 'querySelector') return sel => (store.q ??= {})[sel] ??= fakeEl(); // stable children, so tests can read them
      if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 100, height: 100 });
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0)) * 4) });
      if (typeof k === 'symbol' || k === 'then') return undefined;
      return () => fakeEl();
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return el;
}
const win = new EventTarget();
globalThis.window = win;
globalThis.addEventListener = win.addEventListener.bind(win);
globalThis.removeEventListener = win.removeEventListener.bind(win);
const doc = new EventTarget();
Object.assign(doc, { pointerLockElement: null, visibilityState: 'visible', head: fakeEl(), body: fakeEl(),
  getElementById: () => null, createElement: () => fakeEl(), createElementNS: () => fakeEl() });
globalThis.document = doc;
const gpads = [null, null, null, null];
try { globalThis.navigator.getGamepads = () => gpads; } catch { Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => gpads }, configurable: true }); }

const T = await import(new URL('vendor/three.module.js', base));
const { createBuilding } = await import(new URL('building.js', base));
const { BuildGrid, PIECES, PIECE_ORDER } = await import(new URL('building-pieces.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');

const tiles3 = () => { const t = []; for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) t.push([x, z]); return t; };
const DECK = 0.2;

// ============================================================ K5: stairs underfoot

test('K5: the stairs you stand on can be picked, but never steal an aim at a piece the ray enters', () => {
  const g = new BuildGrid(); g.setTiles(tiles3());
  assert.ok(g.place({ t: 'stairs', i: 1, j: 1, l: 0, r: 2 }));
  const eye = [2, DECK + 0.4 + 1.6, 2.6]; // on the lower half of the stairs, eye inside its box
  assert.equal(g.pick(eye[0], eye[1], eye[2], 0, -1, -0.3, DECK, 7)?.t, 'stairs', 'looking down at the tread underfoot');
  assert.ok(g.place({ t: 'wall', i: 1, j: 0, l: 0, r: 0 })); // a wall ahead, on the z = -1 edge of cell (1, 0)
  assert.equal(g.pick(eye[0], eye[1], eye[2], 0, -0.2, -1, DECK, 7)?.t, 'wall', 'a box the ray enters wins over the one we are inside');
  const g2 = new BuildGrid(); g2.setTiles(tiles3()); g2.place({ t: 'stairs', i: 1, j: 1, l: 0, r: 2 });
  const out = g2.aim(eye[0], eye[1], eye[2], 0, 0.3, -1, 'floor', 0, DECK, 7, {});
  assert.ok(out && out.t === 'floor' && out.l === 1, 'aiming a floor above from the stairs finds a slot');
});

// ============================================================ K4 / K3: host checks in building.apply

const { Bag } = await import(new URL('inventory-state.js', base));
const { cleanPieces } = await import(new URL('building.js', base));
function builderBag(wood = 30) { const b = new Bag(); b.add('hammer', 1); b.add('wood', wood); b.add('leaf', 10); return b; }

test('K4: the host refuses a guest piece / unpiece past REACH + slack from the guest, and allows it close by', () => {
  const b = createBuilding(T, new T.Scene()), world = { tiles: tiles3(), decor: [], pieces: [] };
  b.sync(world);
  const bag = builderBag(), far = { x: 40, z: 0 }, near = { x: 0, z: 0 };
  const wall = { kind: 'piece', t: 'wall', i: 1, j: 0, l: 0, r: 1 };
  let r = b.apply(wall, bag, world, far, true);
  assert.equal(r.ok, false); assert.match(r.text, /Too far/);
  assert.equal(world.pieces.length, 0, 'nothing built from across the sea');
  assert.equal(bag.count('wood'), 30, 'nothing charged');
  r = b.apply(wall, bag, world, { x: 1 + 7 + 1.9, z: 0 }, true); // edge centre (1, 0): 8.9 m away, inside 7 + 2 slack
  assert.equal(r.ok, true, r.text);
  r = b.apply({ ...wall, kind: 'unpiece' }, bag, world, far, true);
  assert.equal(r.ok, false, 'no removal from afar either'); assert.equal(world.pieces.length, 1);
  r = b.apply({ ...wall, kind: 'unpiece' }, bag, world, { x: 1 + 7.5, z: 0 }, false);
  assert.equal(r.ok, false, 'the host gets no slack');
  r = b.apply({ ...wall, kind: 'unpiece' }, bag, world, near, true);
  assert.equal(r.ok, true); assert.equal(world.pieces.length, 0);
  assert.match(gameSrc, /building\.apply\(a, bag, world, actor === 'guest' \? other : physics, actor === 'guest'\)/, 'game.js passes the actor pose');
  b.dispose();
});

test('K3: stairs refuse a decorated tile; decor refuses a tile under stairs; old overlapping saves still load', () => {
  const b = createBuilding(T, new T.Scene()), world = { tiles: tiles3(), decor: [{ type: 'crate', x: 1, z: 1 }], pieces: [] };
  b.sync(world);
  const bag = builderBag();
  let r = b.apply({ kind: 'piece', t: 'stairs', i: 1, j: 1, l: 0, r: 0 }, bag, world, { x: 0, z: 0 });
  assert.equal(r.ok, false); assert.equal(r.text, 'Something is in the way');
  assert.equal(bag.count('wood'), 30);
  r = b.apply({ kind: 'piece', t: 'stairs', i: 0, j: 1, l: 0, r: 0 }, bag, world, { x: 0, z: 0 });
  assert.equal(r.ok, true, 'a free tile is fine');
  assert.equal(b.cellTaken(0, 1), true, 'decor on (0,1) would stand in the stairs');
  assert.equal(b.cellTaken(1, 0), false);
  assert.ok(b.apply({ kind: 'piece', t: 'wall', i: 1, j: 1, l: 0, r: 0 }, bag, world, { x: 0, z: 0 }).ok, 'walls on a decorated tile border are fine');
  assert.equal(b.cellTaken(1, 1), false, 'edge pieces do not take the cell');
  // an old save with both on one tile keeps both
  const old = [{ t: 'stairs', i: 1, j: 1, l: 0, r: 0 }];
  assert.deepEqual(cleanPieces(old, tiles3()), old);
  const w2 = { tiles: tiles3(), decor: [{ type: 'crate', x: 1, z: 1 }], pieces: old };
  b.sync(w2); assert.equal(w2.pieces.length, 1); assert.equal(w2.decor.length, 1);
  // game.js: the decor ghost, candidates and the host build branch all ask cellTaken
  assert.equal((gameSrc.match(/building\?\.cellTaken\(/g) || []).length, 3);
  const host = gameSrc.slice(gameSrc.indexOf('} else if (DECOR_TYPES.includes(a.recipe)) {'), gameSrc.indexOf('world.decor.push(rot ?'));
  assert.match(host, /if \(building\?\.cellTaken\(a\.x, a\.z\)\) \{ emit\(\{kind:'notice', text:BLOCK_TEXT\.overlap\}, actor\); return; \}/);
  b.dispose();
});

// ============================================================ K1: hammer chip and R behind the wheel

const { createControls } = await import(new URL('controls.js', base));
function pick(b, id) {
  const i = PIECE_ORDER.indexOf(id), step = 360 / PIECE_ORDER.length, a = (i * step) * Math.PI / 180;
  b.menu.open(); b.menu.move(Math.sin(a) * 200, -Math.cos(a) * 200); b.menu.close(true);
  assert.equal(b.piece, id);
}
function key(type, code, extra = {}) { const e = new Event(type); Object.assign(e, { code, key: code, repeat: false, ...extra }); win.dispatchEvent(e); }
const physics = { grounded: true, swimming: false, vx: 0, vz: 0, vy: 0 };
function setupControls(extra = {}) {
  let open = false;
  const calls = [];
  const rec = name => (...a) => calls.push([name, ...a]);
  const c = createControls({ canvas: null, isBlocked: () => false, look: rec('look'), hotbarSize: 10, slot: () => 0,
    selectSlot: rec('selectSlot'), interact: rec('interact'), inventory: rec('inventory'), repair: rec('repair'), pause: rec('pause'),
    useDown: noop, useUp: noop, useCancel: noop, reelDown: noop, reelUp: noop, buildWheelOpen: () => open, ...extra });
  return { c, calls, tick: () => c.movement(1 / 60, true, physics), setOpen: v => { open = v; } };
}

test('K1: the hammer chip offers "R rotate" only for pieces that rotate', () => {
  const made = [], make = doc.createElement;
  doc.createElement = () => { const e = fakeEl(); made.push(e); return e; };
  const b = createBuilding(T, new T.Scene());
  doc.createElement = make;
  const chip = made.find(e => e.className === 'bm-chip'), hint = chip.querySelector('.bm-hint');
  b.menu.setVisible(true);
  for (const id of PIECE_ORDER) {
    if (id !== b.piece) pick(b, id);
    b.menu.refresh();
    const rot = PIECES[id].slot === 'cell';
    assert.equal(/<kbd>R<\/kbd> rotate/.test(hint.innerHTML), rot, `${id}: R rotate shown=${rot}`);
    assert.match(hint.innerHTML, /<kbd>X<\/kbd> remove/);
  }
  b.dispose();
});

test('K1: R does not repair a hook while the build wheel is open', () => {
  const s = setupControls();
  s.setOpen(true);
  key('keydown', 'KeyR'); s.tick(); key('keyup', 'KeyR'); s.tick();
  assert.deepEqual(s.calls.filter(c => c[0] === 'repair'), [], 'swallowed behind the wheel');
  s.setOpen(false);
  key('keydown', 'KeyR'); s.tick(); key('keyup', 'KeyR'); s.tick();
  assert.equal(s.calls.filter(c => c[0] === 'repair').length, 1, 'works again once closed');
  s.c.dispose();
});

// ============================================================ K2: decor rotation steps

const { snapRot, ROT_STEP, FINE_STEP } = await import(new URL('placement.js', base));

test('K2: rotation snaps to whole 15 degree steps, so 8 x 45 and 24 x 15 come back to exactly 0', () => {
  for (const [step, n] of [[ROT_STEP, 8], [-ROT_STEP, 8], [FINE_STEP, 24], [-FINE_STEP, 24]]) {
    let r = 0; for (let k = 0; k < n; k++) r = snapRot(r + step);
    assert.equal(r, 0, `${n} x ${step}`);
  }
  assert.equal(snapRot(0.785), 3 * FINE_STEP, 'an old 3-decimal save value lands on 45 degrees');
  assert.equal(snapRot(-ROT_STEP), 21 * FINE_STEP);
  assert.ok(snapRot(1e9) >= 0 && snapRot(NaN) === 0);
});

test('K2: Shift+R and Alt+R reach game.js as {shift, alt}; both lanes map Shift = 15 degrees, Alt = 45 back', () => {
  const s = setupControls();
  key('keydown', 'ShiftLeft'); key('keydown', 'KeyR', { shiftKey: true }); s.tick(); key('keyup', 'KeyR'); key('keyup', 'ShiftLeft'); s.tick();
  key('keydown', 'AltLeft'); key('keydown', 'KeyR', { altKey: true }); s.tick(); key('keyup', 'KeyR'); key('keyup', 'AltLeft'); s.tick();
  key('keydown', 'KeyR'); s.tick(); key('keyup', 'KeyR'); s.tick();
  assert.deepEqual(s.calls.filter(c => c[0] === 'repair').map(c => c[1]),
    [{ shift: true, alt: false }, { shift: false, alt: true }, { shift: false, alt: false }]);
  s.c.dispose();
  assert.match(gameSrc, /const rotStep = \(shift, alt\) => \(shift \? FINE_STEP : alt \? -ROT_STEP : ROT_STEP\);/);
  assert.match(gameSrc, /rotatePlacement\(rotStep\(e\.shiftKey, e\.altKey\)\)/, 'legacy keyboard lane');
  assert.match(gameSrc, /rotatePlacement\(rotStep\(!!m\.shift, !!m\.alt\)\)/, 'controls lane');
  assert.match(gameSrc, /function rotatePlacement\(step\) \{ placeRot = snapRot\(placeRot \+ step\);/);
  assert.match(gameSrc, /<kbd>Shift<\/kbd> \+ <kbd>R<\/kbd>[^']*15°, <kbd>Alt<\/kbd> \+ <kbd>R<\/kbd> turns it back/, 'help documents both');
});

// ============================================================ P2: pad rotate + remove

const { DEFAULT_BINDINGS, ACTIONS } = await import(new URL('input-map.js', base));
const btn = (value = 0) => ({ pressed: value > 0.5, touched: value > 0, value });
const makePad = () => ({ index: 0, id: 'pad0', mapping: 'standard', connected: true, timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => btn(0)) });

test('P2: the pad remove button drives the same hold / release remove as X; R3 reaches the rotate callback', () => {
  const p = makePad(); gpads[0] = p;
  const s = setupControls({ removeDown: (...a) => s.calls.push(['removeDown', ...a]), removeUp: (...a) => s.calls.push(['removeUp', ...a]) });
  const [code] = DEFAULT_BINDINGS.remove.pad, i = +code.slice(3);
  p.buttons[i] = btn(1); s.tick(); s.tick();
  assert.deepEqual(s.calls.filter(c => c[0].startsWith('remove')).map(c => c[0]), ['removeDown'], 'press = start aiming');
  p.buttons[i] = btn(0); s.tick();
  assert.deepEqual(s.calls.filter(c => c[0].startsWith('remove')).map(c => c[0]), ['removeDown', 'removeUp'], 'release = remove');
  p.buttons[11] = btn(1); s.tick(); p.buttons[11] = btn(0); s.tick(); // R3
  assert.deepEqual(s.calls.filter(c => c[0] === 'repair'), [['repair', { shift: false, alt: false }]]);
  s.c.dispose(); gpads[0] = null;
});

test('P2: remove has its own unused pad button; game.js rotates a held build piece before sail / repair', () => {
  assert.ok(ACTIONS.some(a => a.id === 'remove'));
  const code = DEFAULT_BINDINGS.remove.pad[0];
  const others = Object.entries(DEFAULT_BINDINGS).filter(([id, bd]) => id !== 'remove' && bd.pad.includes(code));
  assert.deepEqual(others, [], `${code} is not bound to anything else`);
  const cb = gameSrc.slice(gameSrc.indexOf('repair:(m = {}) =>'), gameSrc.indexOf('release:() => sailing?.release()'));
  assert.match(cb, /^repair:\(m = \{\}\) => \{ if \(running && heldKind\(\) === 'hammer' && building\?\.key\('KeyR', true, true, false\)\) return;/);
  assert.match(gameSrc, /removeDown:\(\) => \{ if \(running && !uiBlocked\(\) && heldKind\(\) === 'hammer'\) building\?\.key\('KeyX', true, true, false\); \}, removeUp:removeRelease/);
  assert.match(gameSrc, /if \(e\.code === 'KeyX'\) removeRelease\(\);/, 'keyboard X releases through the same function');
  // building: a pad-started remove (key KeyX down) shows the mode, and R3 on a cell piece turns it
  const b = createBuilding(T, new T.Scene());
  b.key('KeyX', true, true, false); assert.equal(b.removing, true);
  assert.equal(b.removeAction(), null, 'nothing aimed: nothing to remove'); assert.equal(b.removing, false);
  pick(b, 'stairs'); const r0 = b.rotation;
  assert.equal(b.key('KeyR', true, true, false), true); assert.equal(b.rotation, (r0 + 1) % 4);
  b.dispose();
});

// ============================================================ K6: X removes decor and bare floor tiles

const { decorOnRay, floorRemoveBlock, refundOf } = await import(new URL('placement.js', base));
const { createStorage } = await import(new URL('storage-research.js', base));
const { createKiln } = await import(new URL('kiln.js', base));
const { createContent } = await import(new URL('content.js', base));
const norm = (x, y, z) => { const l = Math.hypot(x, y, z); return { x: x / l, y: y / l, z: z / l }; };

test('K6: decorOnRay finds tile-cell decor (game.js world.decor) including types without a footprint', () => {
  const eye = { x: 0, y: 1.8, z: 0 }, crate = { type: 'crate', x: 1, z: 0 }, kiln = { type: 'kiln', x: 0, z: -2 };
  assert.equal(decorOnRay([crate, kiln], eye, norm(2, 0.6 - 1.8, 0), 8, 2), crate, 'crate on tile (1, 0) = 2 m out');
  assert.equal(decorOnRay([crate, kiln], eye, norm(0, 0.6 - 1.8, -4), 8, 2), kiln, 'a kiln has no FOOTPRINT but still picks');
  assert.equal(decorOnRay([crate], eye, norm(2, 0.6 - 1.8, 1.4), 8, 2), null, 'aiming beside it');
  assert.equal(decorOnRay([{ type: 'crate', x: 3, z: 0 }], eye, norm(6, 0.6 - 1.8, 0), 8, 2)?.x, 3, 'tile 3 = 6 m out');
  assert.equal(decorOnRay([{ type: 'crate', x: 3, z: 0 }], eye, norm(6, 0.6 - 1.8, 0), 8), null, 'unit 1 would put it at 3 m: missed');
});

test('K6: a bare floor tile is removable unless decor stands on it, the raft would split, or it is the last tile', () => {
  const line = [[0, 0], [1, 0], [2, 0]];
  assert.equal(floorRemoveBlock(line, [{ type: 'crate', x: 2, z: 0 }], 2, 0, 2), 'decor', 'tile-cell decor on it');
  assert.equal(floorRemoveBlock(line, [{ type: 'crate', x: 1, z: 0 }], 2, 0, 2), null, 'decor next door is fine');
  assert.equal(floorRemoveBlock(line, [], 1, 0, 2), 'split');
  assert.deepEqual(refundOf({ wood: 2, plastic: 2 }), { wood: 1, plastic: 1 });
  // building pieces standing on a tile hold it
  const g = new BuildGrid(); g.setTiles(tiles3());
  assert.equal(g.tileNeeded(1, 1), false);
  g.place({ t: 'wall', i: 1, j: 1, l: 0, r: 1 }); // the -x edge of cell (1,1): also rests on (0,1)
  assert.equal(g.tileNeeded(1, 1), false, 'the other side still carries it');
  g.place({ t: 'stairs', i: 1, j: 0, l: 0, r: 0 });
  assert.equal(g.tileNeeded(1, 0), true, 'stairs stand on it');
  assert.equal(g.list.length, 2, 'the check changes nothing');
  assert.equal(g.tileNeeded(5, 5), false);
});

test('K6: hammer + X over no piece shows and returns what game.js names (decor / floor)', () => {
  const b = createBuilding(T, new T.Scene()), world = { tiles: tiles3(), decor: [], pieces: [] };
  b.sync(world);
  const res = { text: 'Release X to remove crate', action: { kind: 'remove', what: 'decor', x: 1, z: 0 } };
  let miss = res;
  b.setRemoveMiss(() => miss);
  const raft = new T.Object3D(), bag = builderBag(), dir = new T.Vector3(1, -0.5, 0).normalize(), eye = new T.Vector3(0, 1.8, 0);
  b.key('KeyX', true, true, false);
  b.update(raft, { dir }, eye, true, bag, 0, DECK);
  const a = b.removeAction();
  assert.deepEqual(a, res.action); assert.notEqual(a, res.action, 'a copy: action() may stamp a seq on it');
  assert.equal(b.removing, false);
  b.key('KeyX', true, true, false); miss = null;
  b.update(raft, { dir }, eye, true, bag, 0, DECK);
  assert.equal(b.removeAction(), null, 'nothing named: nothing removed');
  // a piece under the crosshair still wins
  world.pieces = [{ t: 'stairs', i: 1, j: 0, l: 0, r: 0 }]; b.sync(world); miss = res;
  b.key('KeyX', true, true, false);
  b.update(raft, { dir }, eye, true, bag, 0, DECK);
  assert.equal(b.removeAction()?.kind, 'unpiece');
  b.dispose();
});

test('K6: a crate with items, or a kiln still working, must be emptied first (content removeBlock hook)', () => {
  const world = { decor: [{ type: 'crate', x: 1, z: 0 }, { type: 'kiln', x: 0, z: 1 }, { type: 'bench', x: -1, z: 0 }], tiles: tiles3() };
  const ctx = { T: null, world, role: 'host', physics: { x: 0, z: 0 }, emit: noop, notice: noop, localBag: () => null };
  const st = createStorage(ctx), kl = createKiln(ctx);
  assert.equal(st.removeBlock(world.decor[0]), null, 'an empty crate can go');
  st.load({ v: 1, chests: { '1,0': [{ kind: 'wood', count: 3 }, ...Array(11).fill(null)] } }, 'save');
  assert.equal(st.removeBlock(world.decor[0]), 'Empty the crate first');
  assert.equal(kl.removeBlock(world.decor[1]), null);
  kl.load({ k: { '0,1': { r: 'clay', q: 2, t: 0, h: 0, f: 1, o: null, n: 0 } } }, 'save');
  assert.equal(kl.removeBlock(world.decor[1]), 'Empty the kiln first');
  const c = createContent(ctx, [() => ({ name: 'a', removeBlock: () => null }), () => ({ name: 'b', removeBlock: d => (d.type === 'bench' ? 'nope' : null) })]);
  assert.equal(c.removeBlock(world.decor[2]), 'nope'); assert.equal(c.removeBlock(world.decor[0]), null);
  st.dispose?.(); kl.dispose?.();
});

test('K6: game.js wires X / the host remove action (reach, blocks, refund, state clean-up) and the help line', () => {
  assert.match(gameSrc, /building\.setRemoveMiss\(removeMiss\);/);
  const host = gameSrc.slice(gameSrc.indexOf("if (a.kind === 'remove') {"), gameSrc.indexOf("if ((a.kind === 'piece' || a.kind === 'unpiece') && building)"));
  assert.ok(host.length > 100, 'host branch present');
  assert.match(host, /bag\.count\('hammer'\) < 1/);
  assert.match(host, /inReach\(who\.x, who\.z, a\.x, a\.z, BUILD_REACH \+ \(actor === 'guest' \? GUEST_REACH_SLACK : \.01\)\)/, 'host reach check');
  assert.match(host, /const why = removeBlock\(a\.what, a\.x, a\.z\); if \(why\)/, 'same rules as the chip');
  assert.match(host, /refund = decor \? \{\[type\]:1\} : refundOf\(FLOOR_COST\)/, 'decor back in the bag, about half a floor');
  assert.match(host, /scratch\.add\(k, n\) > 0\) \{ emit\(\{kind:'full'/, 'a full bag refuses, nothing lost');
  assert.match(host, /for \(const f of \['garden', 'purifiers', 'collectors', 'sprinklers'\]\) if \(world\[f\]\) delete world\[f\]\[key\]/);
  assert.match(host, /delete world\.tileHp\[key\]/);
  assert.match(host, /rebuildRaft\(\);/);
  const rb = gameSrc.slice(gameSrc.indexOf('function removeBlock(what, x, z)'), gameSrc.indexOf('const removeEye'));
  assert.match(rb, /content\?\.removeBlock\(d\) \|\| prog\?\.removeBlock\?\.\(d\)/, 'chests / kilns / stations holding items stay');
  assert.match(rb, /floorRemoveBlock\(world\.tiles, world\.decor, x, z, 2\)/);
  assert.match(rb, /fc\?\.hasGrill\(x, z\) \|\| building\?\.tileHolds\(x, z\)/, 'grills and pieces hold their tile');
  assert.match(gameSrc, /<kbd>X<\/kbd><span><b>Remove<\/b> with the Hammer[^']*decoration[^']*bare floor/);
});
