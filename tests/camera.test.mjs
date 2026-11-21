// Little Camera + photo album (docs/specs/camera.md): storage backends, cap, metadata, net validation, item rules, cooldown.
// Run: node --test tests/camera.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const S = await import(new URL('photo-store.js', base));
const C = await import(new URL('camera.js', base));
const { ITEMS, BLOCK_RADII, toolRole } = await import(new URL('items.js', base));
const { ITEM_TEXT } = await import(new URL('craft-book.js', base));
const { ITEM_ICONS } = await import(new URL('item-svg.js', base));
const { EVENTS } = await import(new URL('audio.js', base));

// A real (tiny) JPEG: 1x1 white baseline JPEG, base64.
const JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const JPEG = S.DATA_PREFIX + JPEG_B64;

function fakeStorage({ getThrows = false, setThrows = null } = {}) {
  const m = new Map();
  return {
    m,
    getItem(k) { if (getThrows) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (setThrows) { const e = new Error('full'); e.name = setThrows; throw e; } m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}
const throwingIdb = { open() { throw new Error('no idb here'); } };
let clock = 1700000000000;
const rec = (o = {}) => ({ id: S.newId(clock += 1000), at: clock, data: JPEG, ...o });

test('storage fallback: idb throws -> local; blocked local -> memory with one notice', async () => {
  const ls = fakeStorage();
  const notes = [];
  const a = await S.openPhotoStore({ backends: [S.idbBackend(throwingIdb), S.localBackend(ls), S.memoryBackend()], notice: s => notes.push(s) });
  assert.equal(a.kind, 'local');
  assert.equal(notes.length, 0);
  const b = await S.openPhotoStore({ backends: [() => S.idbBackend(undefined), S.localBackend(fakeStorage({ getThrows: true })), S.memoryBackend()], notice: s => notes.push(s) });
  assert.equal(b.kind, 'memory');
  assert.deepEqual(notes, [S.MEMORY_NOTICE]);
  assert.equal((await b.add(rec())).ok, true);
  assert.equal(notes.length, 1, 'memory notice only once');
});

test('local backend: put / list / get / del round trip, newest first, never touches the main save key', async () => {
  const ls = fakeStorage();
  ls.setItem('little-raft-v1', '{"save":1}');
  const st = await S.openPhotoStore({ backends: [S.localBackend(ls)] });
  const r1 = rec(), r2 = rec(), r3 = rec();
  for (const r of [r2, r1, r3]) assert.equal((await st.add(r)).ok, true);
  assert.deepEqual(st.list().map(m => m.id), [r3.id, r2.id, r1.id]);
  const again = await S.openPhotoStore({ backends: [S.localBackend(ls)] });
  assert.deepEqual(again.list().map(m => m.id), [r3.id, r2.id, r1.id], 'persisted');
  assert.equal(await again.dataURL(r2.id), JPEG);
  assert.equal(await again.url(r2.id), JPEG, 'local photos show as their data URL');
  assert.equal(await again.remove(r2.id), true);
  assert.deepEqual(again.list().map(m => m.id), [r3.id, r1.id]);
  assert.equal(JSON.parse(ls.getItem(S.LS_KEY)).length, 2);
  assert.equal(ls.getItem('little-raft-v1'), '{"save":1}');
});

test('cap: 24 photos, the 25th is refused (no silent drop), a removal makes room', async () => {
  const st = await S.openPhotoStore({ backends: [S.memoryBackend()] });
  const ids = [];
  for (let i = 0; i < S.PHOTO_CAP; i++) { const r = rec(); ids.push(r.id); assert.equal((await st.add(r)).ok, true); }
  assert.deepEqual(await st.add(rec()), { ok: false, reason: 'full' });
  assert.equal(st.list().length, 24);
  assert.deepEqual(S.canAdd(st.list()), { ok: false, reason: 'full' });
  await st.remove(ids[0]);
  assert.equal((await st.add(rec())).ok, true);
  assert.equal(st.count, 24);
});

test('quota: a full localStorage reports quota and keeps the earlier photos', async () => {
  const ls = fakeStorage();
  const st = await S.openPhotoStore({ backends: [S.localBackend(ls)], notice: () => {} });
  const first = rec();
  assert.equal((await st.add(first)).ok, true);
  const full = S.localBackend(Object.assign(ls, { setItem() { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } }));
  const st2 = await S.openPhotoStore({ backends: [full] });
  const notes = [];
  st2.notice = s => notes.push(s);
  assert.deepEqual(await st2.add(rec()), { ok: false, reason: 'quota' });
  assert.deepEqual(st2.list().map(m => m.id), [first.id]);
  assert.equal(await st2.dataURL(first.id), JPEG);
  assert.equal(notes.length, 1);
});

test('meta: cleanMeta drops bad ids and NaN times; corrupt JSON loads as empty; newId is valid and unique', async () => {
  assert.equal(S.cleanMeta({ id: 'bad', at: 1 }), null);
  assert.equal(S.cleanMeta({ id: 'pABCDEF1', at: 1 }), null, 'uppercase');
  assert.equal(S.cleanMeta({ id: 'p123456', at: NaN }), null);
  assert.equal(S.cleanMeta({ id: 'p123456', at: '5' }), null);
  assert.equal(S.cleanMeta(null), null);
  assert.deepEqual(S.cleanMeta({ id: 'p123456', at: 5, day: 3, blob: 'x' }), { id: 'p123456', at: 5, day: 3 });
  assert.deepEqual(S.cleanMeta({ id: 'p123456', at: 5, day: -1 }), { id: 'p123456', at: 5 });
  const ls = fakeStorage(); ls.setItem(S.LS_KEY, '{not json');
  const st = await S.openPhotoStore({ backends: [S.localBackend(ls)] });
  assert.equal(st.kind, 'local'); assert.deepEqual(st.list(), []);
  ls.setItem(S.LS_KEY, JSON.stringify([{ id: 'x', at: 1, data: JPEG }, { id: 'p1234567', at: 1, data: 'javascript:alert(1)' }, { id: 'p7654321', at: 2, data: JPEG }]));
  assert.deepEqual((await S.openPhotoStore({ backends: [S.localBackend(ls)] })).list().map(m => m.id), ['p7654321']);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) { const id = S.newId(); assert.match(id, S.ID_RE); seen.add(id); }
  assert.equal(seen.size, 1000);
  assert.match(S.newId(0, () => 0), S.ID_RE);
  assert.match(S.newId(Date.now(), () => 0.99999999), S.ID_RE);
});

test('net validation: validPhotoData and onNet accept only small JPEG data URLs; foreign cache is LRU 32', async () => {
  assert.equal(S.validPhotoData(JPEG), true);
  for (const bad of ['data:image/png;base64,' + JPEG_B64, S.DATA_PREFIX + 'A'.repeat(S.MAX_DATA), 42, null, {}, S.DATA_PREFIX + 'ab<script>cd==',
    'javascript:alert(1)', S.DATA_PREFIX + 'ab cd efgh', S.DATA_PREFIX]) assert.equal(S.validPhotoData(bad), false, String(bad).slice(0, 40));
  assert.equal(C.cleanPhotoMsg({ type: 'photo', id: 'p1234567', data: JPEG })?.data, JPEG);
  assert.deepEqual(C.cleanPhotoMsg({ type: 'photo', id: 'p1234567', want: 1 }), { id: 'p1234567', want: true });
  for (const bad of [null, [], { type: 'inst' }, { type: 'photo', id: '../x', data: JPEG }, { type: 'photo', id: 'p1234567', data: 'data:text/html,hi' }, { type: 'photo', id: 'p1234567', want: true }])
    assert.equal(C.cleanPhotoMsg(bad), null);
  const sent = [];
  const cam = C.createCamera({}, { netReady: () => true, send: m => sent.push(m), now: () => 0 });
  await cam.storeReady;
  const got = [];
  cam.onPhoto(id => got.push(id));
  assert.equal(cam.onNet({ type: 'photo', id: 'BAD', data: JPEG }), false);
  assert.equal(cam.onNet({ type: 'photo', id: 'p1234567', data: 'data:image/jpeg;base64,!!!!' }), false);
  assert.equal(cam.foreign('p1234567'), undefined);
  assert.equal(cam.onNet({ type: 'photo', id: 'p1234567', data: JPEG }), true);
  assert.equal(cam.foreign('p1234567'), JPEG);
  assert.deepEqual(got, ['p1234567']);
  for (let i = 0; i < 40; i++) cam.onNet({ type: 'photo', id: 'pz' + String(i).padStart(6, '0'), data: JPEG });
  assert.equal(cam.debug.foreign.length, C.FOREIGN_CAP);
  assert.equal(cam.foreign('p1234567'), undefined, 'oldest evicted');
  assert.equal(cam.foreign('pz000039'), JPEG);
  assert.equal(cam.request('pq123456'), true);
  assert.equal(cam.request('pq123456'), false, 'once per 15 s per id');
  assert.deepEqual(sent, [{ type: 'photo', id: 'pq123456', want: 1 }]);
  assert.equal(cam.use('hook'), false);
  cam.dispose();
  const lru = C.createForeignCache(2); lru.set('a', 1); lru.set('b', 2); lru.get('a'); lru.set('c', 3);
  assert.deepEqual(lru.keys(), ['a', 'c']);
});

test('item rules: camera is a wear-free tool, photo frame is placeable, both have text, icons and a shutter sound', () => {
  const c = ITEMS.camera;
  assert.equal(c.stack, 1); assert.equal(c.tool, false); assert.equal(c.durability, undefined); assert.equal(c.category, 'tool');
  assert.ok(c.recipe.cost.glass >= 1);
  assert.equal(toolRole('camera'), 'camera');
  const f = ITEMS.photoframe;
  assert.equal(f.placeable, true); assert.ok(BLOCK_RADII.photoframe > 0);
  for (const k of ['camera', 'photoframe']) { assert.ok(ITEM_TEXT[k]?.desc && ITEM_TEXT[k]?.use, k + ' text'); assert.ok(ITEM_ICONS[k], k + ' icon'); }
  assert.ok(EVENTS.includes('shutter'));
});

test('cooldown: shotGate blocks inside 0.6 s and while busy', () => {
  assert.equal(C.shotGate(10, -Infinity, false), true);
  assert.equal(C.shotGate(10, 9.5, false), false);
  assert.equal(C.shotGate(10, 9.35, false), true);
  assert.equal(C.shotGate(10, 0, true), false);
  assert.equal(C.shotGate(NaN, 0, false), false);
  assert.deepEqual(C.centerCrop(1920, 1080), { sx: 0, sy: 0, sw: 1920, sh: 1080 });
  assert.deepEqual(C.centerCrop(390, 844), { sx: 0, sy: 312, sw: 390, sh: 219 });
  assert.deepEqual(C.centerCrop(1000, 1000), { sx: 0, sy: 218, sw: 1000, sh: 562 });
});

test('frame state: cleanFrames validates keys, ids, owners and decor; host set / clear rules', async () => {
  const F = await import(new URL('photo-frame.js', base));
  assert.deepEqual(F.cleanFrames(undefined), { v: 1, f: {} });
  assert.deepEqual(F.cleanFrames([1, 2]), { v: 1, f: {} });
  const decor = [{ type: 'photoframe', x: 0, z: 1 }, { type: 'photoframe', x: -2, z: 3 }, { type: 'bench', x: 5, z: 5 }];
  const raw = { v: 1, f: {
    '0,1': { id: 'p1234567', owner: 'host' }, '-2,3': { id: 'p7654321', owner: 'guest' },
    '5,5': { id: 'p1111111', owner: 'host' }, '9,9': { id: 'p2222222', owner: 'host' },
    'x,1': { id: 'p3333333', owner: 'host' }, '01,1': { id: 'p3333333', owner: 'host' },
  } };
  assert.deepEqual(Object.keys(F.cleanFrames(raw, decor).f).sort(), ['-2,3', '0,1']);
  assert.equal(Object.keys(F.cleanFrames(raw).f).length, 4, 'no decor given: keys only checked for shape');
  const bad = { f: { '0,1': { id: 'BAD', owner: 'host' }, '-2,3': { id: 'p7654321', owner: 'pirate' } } };
  assert.deepEqual(F.cleanFrames(bad, decor).f, {});
  const many = { f: {} }, md = [];
  for (let i = 0; i < 80; i++) { many.f[i + ',0'] = { id: 'p' + String(i).padStart(7, '0'), owner: 'host' }; md.push({ type: 'photoframe', x: i, z: 0 }); }
  assert.equal(Object.keys(F.cleanFrames(many, md).f).length, F.FRAME_CAP);

  // module: host action on a non-frame tile is handled but changes nothing; null id clears
  const world = { tiles: [[0, 0], [0, 1]], decor: [{ type: 'photoframe', x: 0, z: 1 }], ext: {} };
  const mod = F.createPhotoFrame({ T: null, world, role: 'solo', raft: null });
  mod.load(undefined, 'save');
  assert.deepEqual(mod.serialize(), { v: 1, f: {} });
  assert.equal(mod.action({ kind: 'photoframe:set', key: '0,0', id: 'p1234567' }, 'host'), true);
  assert.deepEqual(mod.serialize().f, {});
  assert.equal(mod.action({ kind: 'photoframe:set', key: '0,1', id: 'p1234567' }, 'guest'), true);
  assert.deepEqual(mod.serialize().f, { '0,1': { id: 'p1234567', owner: 'guest' } });
  assert.equal(mod.action({ kind: 'photoframe:set', key: '0,1', id: 'javascript:1' }, 'host'), true);
  assert.equal(mod.serialize().f['0,1'].id, 'p1234567', 'bad id ignored');
  assert.equal(mod.action({ kind: 'other' }, 'host'), false);
  world.decor.length = 0;
  assert.deepEqual(mod.serialize().f, {}, 'removed frame is pruned');
  world.decor.push({ type: 'photoframe', x: 0, z: 1 });
  mod.action({ kind: 'photoframe:set', key: '0,1', id: 'p1234567' }, 'host');
  mod.action({ kind: 'photoframe:set', key: '0,1', id: null }, 'host');
  assert.deepEqual(mod.serialize().f, {});
  mod.load({ v: 1, f: { '0,1': { id: 'p7654321', owner: 'host' } } }, 'net');
  assert.equal(mod.serialize().f['0,1'].id, 'p7654321');
  assert.equal(JSON.stringify(mod.serialize()).includes('data:'), false, 'never image bytes in the save');
  mod.dispose();
});
