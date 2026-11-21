// Unit tests for the writable signs / decoration pack logic (pure core + module with a fake ctx).
// Run: node --test tests/signs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const { PACK, MAX_SIGNS, MAX_ROT, cleanLines, linesKey, faceRot, cleanSlice, applyDecorAction } = await import(new URL('signs-core.js', base));
const { createDecorPack } = await import(new URL('decor-pack.js', base));

const env = (decor, pos = { x: 0, z: 0 }) => ({ decorAt: (x, z) => decor.find(d => d.x === x && d.z === z)?.type ?? null, pos: a => (typeof pos === 'function' ? pos(a) : pos) });
const fresh = () => cleanSlice(undefined);

// ---------------------------------------------------------------- cleanLines
test('cleanLines: shapes, controls, bidi, length caps, NFC, trailing blanks', () => {
  for (const v of [undefined, null, {}, 'abc', 5]) assert.deepEqual(cleanLines(v), []);
  assert.deepEqual(cleanLines(['a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c']);
  assert.deepEqual(cleanLines(['a\u0000b\u0007c', 'x\n\ny\tz']), ['abc', 'xyz']);
  assert.deepEqual(cleanLines(['  lots   of   space  ']), ['lots of space']);
  assert.deepEqual(cleanLines(['\u202Eevil\u2066', 'zero\u200Bwidth\uFEFF', 'line\u2028sep']), ['evil', 'zerowidth', 'linesep']);
  assert.equal(cleanLines(['x'.repeat(30)])[0].length, 18);
  const emoji = cleanLines(['😀'.repeat(20)])[0];
  assert.equal(Array.from(emoji).length, 18);
  assert.equal(emoji, '😀'.repeat(18)); // no lone surrogate
  assert.equal(cleanLines(['e\u0301'])[0], '\u00E9');
  assert.deepEqual(cleanLines(['top', '', 'bottom']), ['top', '', 'bottom']);
  assert.deepEqual(cleanLines(['top', '', '   ']), ['top']);
  assert.deepEqual(cleanLines([42, null, { toString() { throw new Error('no'); } }]), ['42']);
  assert.deepEqual(cleanLines(['a\uD800b', '\uDC00x']), ['ab', 'x']); // lone surrogates stripped
  assert.equal(cleanLines(['z'.repeat(1e6)])[0], 'z'.repeat(18));
  assert.deepEqual(cleanLines([1.5, true, undefined]), ['1.5', 'true']);
  assert.equal(linesKey(['a', 'b']), 'a\nb');
  assert.equal(linesKey([]), '');
});

test('faceRot: quarter turns toward (dx, dz)', () => {
  assert.equal(faceRot(0, 1), 0);
  assert.equal(faceRot(1, 0), 1);
  assert.equal(faceRot(0, -1), 2);
  assert.equal(faceRot(-1, 0), 3);
  assert.equal(faceRot(NaN, 1), 0);
  assert.equal(faceRot(Infinity, 1), 0);
  assert.equal(faceRot(1, .9), 1);
});

// ---------------------------------------------------------------- cleanSlice
test('cleanSlice: junk becomes empty; bad entries drop; decor prunes; caps; stable round trip', () => {
  for (const j of [undefined, null, 4, 'x', [], [1]]) assert.deepEqual(cleanSlice(j), { r: 0, s: null, t: {}, rot: {} });
  const c = cleanSlice({ r: -1, s: 'x'.repeat(30), t: { 'a,b': ['hi'], '1,2': ['ok'], '3,3': [], '4,4': ['', ''], '1000,1': ['far'] }, rot: { '0,0': 4, '0,1': 1.5, '0,2': 3, 'zz': 1, '0,3': -1 } });
  assert.equal(c.r, 0); assert.equal(c.s, null);
  assert.deepEqual(c.t, { '1,2': ['ok'] });
  assert.deepEqual(c.rot, { '0,2': 3 });
  const decor = [{ type: 'sign', x: 0, z: 0 }, { type: 'crate', x: 1, z: 0 }, { type: 'pennant', x: 2, z: 0 }];
  const p = cleanSlice({ r: 3, s: 'abc', t: { '0,0': ['A'], '1,0': ['B'], '2,0': ['C'], '9,9': ['D'] }, rot: { '0,0': 1, '1,0': 2, '2,0': 3, '9,9': 1 } }, decor);
  assert.deepEqual(p.t, { '0,0': ['A'] });
  assert.deepEqual(p.rot, { '0,0': 1, '2,0': 3 });
  assert.equal(p.r, 3); assert.equal(p.s, 'abc');
  const many = { t: {}, rot: {} };
  for (let i = 0; i < 50; i++) many.t[`${i},0`] = ['x' + i];
  for (let i = 0; i < 500; i++) many.rot[`${i % 100},${Math.floor(i / 100)}`] = i & 3;
  const capped = cleanSlice(many);
  assert.equal(Object.keys(capped.t).length, MAX_SIGNS);
  assert.equal(Object.keys(capped.rot).length, MAX_ROT);
  const once = cleanSlice(JSON.parse(JSON.stringify(capped)));
  assert.equal(JSON.stringify(cleanSlice(JSON.parse(JSON.stringify(once)))), JSON.stringify(once));
});

// ---------------------------------------------------------------- applyDecorAction
test('applyDecorAction: write, refusals leave state unchanged, blank deletes, same, turn cycles, guest pose', () => {
  const decor = [{ type: 'sign', x: 0, z: 0 }, { type: 'pennant', x: 1, z: 0 }, { type: 'crate', x: 0, z: 1 }];
  const st = fresh();
  let r = applyDecorAction(st, { kind: 'decor.write', x: 0, z: 0, lines: ['Hello', 'raft'] }, 'host', env(decor));
  assert.equal(r.ok, true); assert.equal(st.r, 1); assert.deepEqual(st.t['0,0'], ['Hello', 'raft']);
  const before = JSON.stringify(st);
  assert.equal(applyDecorAction(st, { kind: 'decor.write', x: 0, z: 0, lines: ['x'] }, 'host', env(decor, { x: 9, z: 0 })).reason, 'far');
  assert.equal(applyDecorAction(st, { kind: 'decor.write', x: 0, z: 0, lines: ['x'] }, 'host', env(decor, null)).reason, 'far');
  assert.equal(applyDecorAction(st, { kind: 'decor.write', x: 1, z: 0, lines: ['x'] }, 'host', env(decor)).reason, 'notarget');
  assert.equal(applyDecorAction(st, { kind: 'decor.turn', x: 0, z: 1 }, 'host', env(decor)).reason, 'notarget');
  assert.equal(applyDecorAction(st, { kind: 'decor.turn', x: .5, z: 0 }, 'host', env(decor)).reason, 'notarget');
  assert.equal(applyDecorAction(st, { kind: 'decor.nope', x: 0, z: 0 }, 'host', env(decor)).ok, false);
  assert.equal(JSON.stringify(st), before);
  r = applyDecorAction(st, { kind: 'decor.write', x: 0, z: 0, lines: [' Hello ', 'raft', ''] }, 'host', env(decor));
  assert.equal(r.ok, true); assert.equal(r.same, true); assert.equal(JSON.stringify(st), before);
  r = applyDecorAction(st, { kind: 'decor.write', x: 0, z: 0, lines: ['', ' '] }, 'host', env(decor));
  assert.equal(r.ok, true); assert.equal('0,0' in st.t, false); assert.equal(st.r, 2);
  // full
  const full = fresh(); const signs = [];
  for (let i = 0; i < MAX_SIGNS + 1; i++) signs.push({ type: 'sign', x: i % 5, z: Math.floor(i / 5) });
  for (let i = 0; i < MAX_SIGNS; i++) assert.equal(applyDecorAction(full, { kind: 'decor.write', x: signs[i].x, z: signs[i].z, lines: ['s' + i] }, 'host', env(signs, { x: signs[i].x * 2, z: signs[i].z * 2 })).ok, true);
  const fb = JSON.stringify(full), last = signs[MAX_SIGNS];
  assert.equal(applyDecorAction(full, { kind: 'decor.write', x: last.x, z: last.z, lines: ['no room'] }, 'host', env(signs, { x: last.x * 2, z: last.z * 2 })).reason, 'full');
  assert.equal(JSON.stringify(full), fb);
  assert.equal(applyDecorAction(full, { kind: 'decor.write', x: 0, z: 0, lines: ['rewrite ok'] }, 'host', env(signs)).ok, true); // existing key still writable
  // turn cycles
  const seq = [];
  for (let i = 0; i < 4; i++) { applyDecorAction(st, { kind: 'decor.turn', x: 1, z: 0 }, 'host', env(decor)); seq.push(st.rot['1,0']); }
  assert.deepEqual(seq, [1, 2, 3, 0]);
  // guest pose
  const pos = a => (a === 'guest' ? { x: 20, z: 20 } : { x: 0, z: 0 });
  assert.equal(applyDecorAction(st, { kind: 'decor.turn', x: 1, z: 0 }, 'guest', env(decor, pos)).reason, 'far');
  assert.equal(applyDecorAction(st, { kind: 'decor.turn', x: 1, z: 0 }, 'host', env(decor, pos)).ok, true);
});

// ---------------------------------------------------------------- module
const freshWorld = () => ({ tiles: Array.from({ length: 9 }, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]), decor: [], ext: {} });
function makeCtx(world, role = 'solo') {
  const emits = [], actions = [], bags = { host: new Bag(), guest: new Bag() };
  const raft = new T.Group();
  const ctx = { T, world, role, running: true, physics: { x: 0, z: 0 }, other: null, camera: null, raft, elapsed: 0,
    localBag: () => bags.host, actorBag: a => bags[a], emit: (e, to) => emits.push({ e, to }), notice() {}, releaseLock() {}, requestLock() {},
    esc: s => String(s).replace(/[&<>"']/g, ''), uiOpen: () => false };
  ctx.rebuildRaft = () => { for (const c of [...raft.children]) raft.remove(c); for (const d of world.decor) { const g = mod.decorModel(d.type, d); if (g) { g.position.set(d.x * 2, .22, d.z * 2); raft.add(g); } } };
  ctx.action = a => { actions.push(a); if (role !== 'guest') mod.action(a, 'host', bags.host); };
  const mod = createDecorPack(ctx);
  return { ctx, mod, emits, actions, raft };
}

test('module: action writes, serialize caches by r, net no-op, empty load, emits', () => {
  const w = freshWorld(); w.decor.push({ type: 'sign', x: 0, z: 0 });
  const { mod, emits } = makeCtx(w);
  assert.equal(mod.name, 'decorpack');
  assert.equal(mod.action({ kind: 'storage.put' }, 'host'), false);
  assert.equal(mod.action({ kind: 'decor.write', x: 0, z: 0, lines: ['Ahoy'] }, 'host'), true);
  assert.deepEqual(mod.serialize().t, { '0,0': ['Ahoy'] });
  assert.deepEqual(emits.map(e => [e.e.kind, e.e.text, e.to]), [['build', 'Sign painted!', 'host']]);
  const s1 = mod.serialize(); assert.equal(mod.serialize(), s1);
  mod.action({ kind: 'decor.write', x: 0, z: 0, lines: ['Ahoy'] }, 'host'); // same: nothing emitted, r unchanged
  assert.equal(emits.length, 1); assert.equal(mod.serialize(), s1);
  mod.action({ kind: 'decor.write', x: 0, z: 0, lines: [] }, 'host');
  assert.equal(emits[1].e.text, 'Sign wiped clean');
  w.decor[0].x = 5; // gone
  mod.action({ kind: 'decor.write', x: 0, z: 0, lines: ['x'] }, 'host');
  assert.equal(emits.length, 2); // notarget says nothing
  w.decor[0].x = 0; const far = makeCtx(w); far.ctx.physics = { x: 30, z: 0 };
  far.mod.action({ kind: 'decor.turn', x: 0, z: 0 }, 'host');
  assert.deepEqual(far.emits.map(e => [e.e.kind, e.e.text]), [['notice', 'Step a little closer']]);
  // net
  const g = makeCtx(freshWorld(), 'guest');
  g.mod.load({ v: 1, r: 4, s: 'host1', t: { '0,0': ['hi'] }, rot: { '0,0': 2 } }, 'net');
  const n1 = g.mod.serialize();
  g.mod.load({ v: 1, r: 4, s: 'host1', t: { '0,0': ['changed but same r'] }, rot: {} }, 'net');
  assert.equal(g.mod.serialize(), n1);
  g.mod.load({ v: 1, r: 5, s: 'host1', t: {}, rot: {} }, 'net');
  assert.deepEqual(g.mod.serialize().t, {});
  // save
  mod.load(undefined, 'save');
  const e = mod.serialize(); assert.deepEqual(e.t, {}); assert.deepEqual(e.rot, {}); assert.equal(e.v, 1);
  mod.load({ v: 1, r: 7, s: 'old', t: { '0,0': ['kept'], '1,1': ['no sign here'] }, rot: { '0,0': 3 } }, 'save');
  const l = mod.serialize(); assert.deepEqual(l.t, { '0,0': ['kept'] }); assert.equal(l.r, 8); assert.notEqual(l.s, 'old');
});

test('module: guest interact only calls ctx.action and never mutates', () => {
  const w = freshWorld(); w.decor.push({ type: 'pennant', x: 0, z: 1 });
  const { ctx, mod, actions, raft } = makeCtx(w, 'guest');
  ctx.camera = new T.PerspectiveCamera(); ctx.camera.position.set(0, 1.6, 0); ctx.camera.lookAt(0, .8, 2);
  ctx.rebuildRaft();
  const before = JSON.stringify(mod.serialize());
  assert.equal(mod.interact(null), true);
  assert.deepEqual(actions, [{ kind: 'decor.turn', x: 0, z: 1 }]);
  mod.update(.016); // dirty scan: guests never assign rotations
  assert.equal(JSON.stringify(mod.serialize()), before);
  assert.match(mod.prompt(null), /Turn Wind Pennant/);
  assert.equal(raft.children.length, 1);
});

test('module: host update faces a new tile toward the player, updates the live group in place', () => {
  const w = freshWorld(); w.decor.push({ type: 'sign', x: 1, z: 0 });
  const { ctx, mod, raft } = makeCtx(w);
  ctx.physics = { x: 6, z: 0 }; // +X of the tile
  ctx.rebuildRaft();
  const g = raft.children[0];
  assert.equal(g.rotation.y, 0);
  mod.update(.016);
  assert.equal(mod.serialize().rot['1,0'], 1);
  assert.ok(Math.abs(g.rotation.y - Math.PI / 2) < 1e-9);
  mod.action({ kind: 'decor.turn', x: 1, z: 0 }, 'host');
  assert.equal(raft.children[0], g); // no rebuild
  assert.ok(Math.abs(g.rotation.y - Math.PI) < 1e-9);
  // removing the tile drops its keys on the next scan
  mod.action({ kind: 'decor.write', x: 1, z: 0, lines: ['bye'] }, 'host');
  w.decor.length = 0; ctx.rebuildRaft(); mod.update(.016);
  assert.deepEqual(mod.serialize().rot, {}); assert.deepEqual(mod.serialize().t, {});
  assert.ok(PACK.includes('sign'));
});

test('research gating: pack recipes join the tree by cost, none are starters', async () => {
  const SR = await import(new URL('storage-research.js', base));
  for (const id of PACK) assert.ok(!SR.STARTER.includes(id));
  assert.ok(SR.learnedFrom(['wood', 'rope']).includes('sign'));
  assert.ok(SR.learnedFrom(['leaf', 'rope']).includes('rug'));
  const wlr = SR.learnedFrom(['wood', 'leaf', 'rope']);
  for (const id of ['pennant', 'fern', 'hammock']) assert.ok(wlr.includes(id));
  assert.ok(!wlr.includes('chime') && !wlr.includes('pots'));
  assert.ok(SR.learnedFrom(['wood', 'scrap', 'rope']).includes('chime'));
  assert.ok(SR.learnedFrom(['clay', 'leaf']).includes('pots'));
});
