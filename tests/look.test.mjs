import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_KEY, PALETTE, HATS, DEFAULT_LOOK, PARTNER_DEFAULT, cleanLook, lookColors, lookKey, loadLook, saveLook, noteAchievements, hatAvailable, createLookGate } from '../dist/look.js';
import { ACHIEVEMENT_IDS } from '../dist/logbook.js';

const fakeStorage = () => { const m = new Map(); return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('cleanLook rejects junk and fills defaults', () => {
  for (const x of [undefined, null, [], 'sky', 7]) assert.deepEqual(cleanLook(x), DEFAULT_LOOK);
  assert.deepEqual(cleanLook({ shirt: 3 }), { ...DEFAULT_LOOK, shirt: 3 });
  for (const v of [-1, 10, 2.5, NaN, '3', Infinity]) assert.equal(cleanLook({ shirt: v }).shirt, DEFAULT_LOOK.shirt, String(v));
  assert.equal(cleanLook({ trousers: 8 }).trousers, 0);
  assert.equal(cleanLook({ trousers: 7 }).trousers, 7);
  assert.equal(cleanLook({ hat: 'crown' }).hat, 'straw');
  assert.equal(cleanLook({ hat: 'bucket' }).hat, 'bucket');
  const extra = cleanLook({ shirt: 2, evil: 1, __proto__x: 2 });
  assert.deepEqual(Object.keys(extra).sort(), ['hair', 'hat', 'shirt', 'skin', 'trousers']);
  assert.deepEqual(cleanLook({ hat: 'nope' }, PARTNER_DEFAULT), PARTNER_DEFAULT);
  assert.equal(cleanLook({ shirt: 'x' }, PARTNER_DEFAULT).shirt, 1);
  assert.ok(Object.isFrozen(cleanLook({})));
});

test('defaults match the colours the game used before customisation', () => {
  assert.deepEqual(lookColors(DEFAULT_LOOK), { shirt: '#efae55', trousers: '#2f4a6b', skin: '#f2c29b', hair: '#6b4226' });
  assert.equal(DEFAULT_LOOK.hat, 'straw');
  assert.equal(lookColors(PARTNER_DEFAULT).shirt, '#70a7e4');
  for (const [slot, list] of Object.entries(PALETTE)) {
    assert.ok(list.length >= 8, slot);
    for (const [id, label, hex] of list) { assert.match(hex, /^#[0-9a-f]{6}$/, slot + ' ' + id); assert.ok(label); }
    assert.equal(new Set(list.map(e => e[0])).size, list.length, slot + ' ids unique');
  }
});

test('storage round trip and corrupt data', () => {
  const s = fakeStorage();
  const look = cleanLook({ shirt: 5, trousers: 1, skin: 5, hair: 1, hat: 'bucket' });
  assert.equal(saveLook(look, new Set(['bucket']), s), true);
  const back = loadLook(s);
  assert.deepEqual(back.look, look);
  assert.deepEqual([...back.unlocked], ['bucket']);
  assert.equal(JSON.parse(s.getItem(LOOK_KEY)).v, 1);

  s.setItem(LOOK_KEY, '{not json');
  assert.deepEqual(loadLook(s).look, DEFAULT_LOOK);
  assert.deepEqual(loadLook(fakeStorage()).look, DEFAULT_LOOK);
  assert.deepEqual(loadLook({ getItem() { throw new Error('blocked'); } }).look, DEFAULT_LOOK);
  assert.deepEqual(loadLook(null).look, DEFAULT_LOOK);
  assert.equal(saveLook(look, new Set(), { setItem() { throw new Error('full'); } }), false);

  s.setItem(LOOK_KEY, JSON.stringify({ v: 1, shirt: 2, hat: 'beanie', unlocked: [] }));
  assert.deepEqual(loadLook(s).look, { ...DEFAULT_LOOK, shirt: 2, hat: 'straw' }, 'locked hat falls back');
  s.setItem(LOOK_KEY, JSON.stringify({ v: 1, hat: 'flower', unlocked: ['flower', 'crown', 3, 'flower'] }));
  const r = loadLook(s);
  assert.equal(r.look.hat, 'flower');
  assert.deepEqual([...r.unlocked], ['flower']);
});

test('hat unlocks follow logbook achievements', () => {
  const u = new Set();
  assert.deepEqual(noteAchievements(u, ['fish10']), ['bucket']);
  assert.deepEqual(noteAchievements(u, ['fish10']), []);
  assert.equal(hatAvailable('straw', new Set()), true);
  assert.equal(hatAvailable('none', new Set()), true);
  assert.equal(hatAvailable('beanie', u), false);
  noteAchievements(u, ['tiles25', 'floor1']);
  assert.equal(hatAvailable('beanie', u), true);
  assert.equal(hatAvailable('crown', u), false);
  for (const h of HATS) if (h.unlock !== null) assert.ok(ACHIEVEMENT_IDS.includes(h.unlock), h.id);
  assert.equal(new Set(HATS.map(h => h.id)).size, HATS.length);
});

test('peer look messages are validated and keyed', () => {
  assert.deepEqual(cleanLook(JSON.parse(JSON.stringify({ shirt: 99, hat: '<img>' })), PARTNER_DEFAULT), PARTNER_DEFAULT);
  const a = cleanLook({ shirt: 2, trousers: 3, skin: 4, hair: 5, hat: 'none' });
  assert.equal(lookKey(a), lookKey({ ...a }));
  for (const [k, v] of [['shirt', 3], ['trousers', 4], ['skin', 5], ['hair', 6], ['hat', 'flower']]) assert.notEqual(lookKey({ ...a, [k]: v }), lookKey(a), k);
});

// Build notes: also checks the 3D hooks (avatar hats, remote rebake, FP hands) in node with the vendored THREE.
test('3D hooks: default avatar unchanged, hats build, remote setLook rebakes once, hands recolour', async () => {
  const T = await import('../dist/vendor/three.module.js');
  const { createAvatar } = await import('../dist/avatar.js?build=v3-survival-ae77fa84ac2b');
  const { createRemoteAvatar } = await import('../dist/coop-avatar.js');
  const { createHands } = await import('../dist/hands.js?build=v3-survival-ae77fa84ac2b');
  const colours = g => { const out = []; g.traverse(o => { if (o.isMesh) out.push(o.name + ':' + o.material.color.getHexString()); }); return out.join(); };
  const a = createAvatar(T, '#efae55'), b = createAvatar(T, DEFAULT_LOOK);
  assert.equal(colours(a), colours(b), 'default look == old colour path');
  assert.equal(a.userData.look, null);
  assert.deepEqual(b.userData.look, DEFAULT_LOOK);
  for (const h of HATS) {
    const g = createAvatar(T, { hat: h.id }), hat = g.getObjectByName('hat');
    assert.equal(hat.children.length > 0, h.id !== 'none', h.id);
    let meshes = 0; hat.traverse(o => { if (o.isMesh) { meshes++; assert.ok(!o.material.transparent && o.material.emissive.getHex() === 0, h.id); } });
    assert.ok(meshes <= 9, h.id);
    g.userData.dispose();
  }
  const r = createRemoteAvatar(T, { name: 'Sis', look: PARTNER_DEFAULT });
  const pose = { x: 1, y: 0, z: 2, yaw: 0, pitch: 0, speed: 2, held: 'hook' };
  r.update(1 / 60, pose, 0);
  const draws = () => { let n = 0; r.group.traverse(o => { if (o.isMesh && !o.name.startsWith('held') && o.parent?.name !== 'held_hook' && !o.isSprite) n++; }); return n; };
  const before = draws();
  assert.equal(r.setLook(PARTNER_DEFAULT), false, 'same look: no rebuild');
  const plum = cleanLook({ shirt: 5, trousers: 1, skin: 5, hair: 1, hat: 'bucket' });
  const oldRes = new Set(); r.group.traverse(o => { if (o.isMesh && !o.isSprite && !o.name.startsWith('held') && o.parent?.name !== 'held_hook') { oldRes.add(o.geometry); oldRes.add(o.material); } });
  let freed = 0; for (const x of oldRes) x.addEventListener('dispose', () => freed++);
  assert.equal(r.setLook(plum), true);
  assert.equal(freed, oldRes.size, 'old baked body geometry/materials disposed on rebuild');
  assert.equal(r.setLook({ ...plum }), false);
  r.update(1 / 60, pose, 0.1);
  let heldVisible = 0; r.group.traverse(o => { if (o.name === 'held_hook' && o.visible) heldVisible++; });
  assert.equal(heldVisible, 1, 'held item re-mounted on the new hand');
  assert.ok(Math.abs(draws() - before) <= 1, 'still baked');
  r.dispose();
  const hands = createHands(T, {});
  const sleeve = () => { let c = null; hands.group.traverse(o => { if (o.isMesh && o.material.color.getHex() === new T.Color('#efae55').getHex()) c = o; }); return c; };
  assert.doesNotThrow(() => { hands.setLook(null); hands.setLook(); hands.setLook({ skin: 5 }); });
  hands.setLook(lookColors(DEFAULT_LOOK));
  assert.ok(sleeve(), 'sleeve takes the shirt colour');
  hands.dispose?.();
});

test('partner look gate: a flood of k:look rebuilds at most once per window, latest wins', () => {
  const g = createLookGate(300, PARTNER_DEFAULT);
  assert.equal(g.offer(cleanLook(PARTNER_DEFAULT), 0), null, 'same as current');
  const a = cleanLook({ shirt: 2 }), b = cleanLook({ shirt: 3 }), c = cleanLook({ shirt: 4 });
  assert.equal(g.offer(a, 1000), a);
  let applied = 0;
  for (let i = 0; i < 100; i++) if (g.offer(cleanLook({ shirt: i % 10 }), 1001 + i)) applied++;
  assert.equal(applied, 0, 'flood inside the window applies nothing');
  assert.equal(g.offer(b, 1200), null);
  assert.equal(g.offer(c, 1250), null);
  assert.equal(g.poll(1290), null, 'still inside the window');
  assert.equal(g.poll(1300), c, 'latest pending look released');
  assert.equal(g.poll(2000), null, 'nothing left');
  assert.equal(g.offer(cleanLook({ shirt: 5 }), 1400), null);
  assert.equal(g.offer(c, 1450), null, 'back to the current look cancels the pending one');
  assert.equal(g.poll(5000), null);
});
