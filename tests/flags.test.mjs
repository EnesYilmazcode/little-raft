// Unit tests for the raft flag (pure core, painter with fakes, content module with a fake ctx).
// Run: node --test tests/flags.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const core = await import(new URL('flags-core.js', base));
const { PALETTE, PATTERNS, EMBLEMS, EMBLEM_PATHS, RANGES, DEFAULT, MAX_FLAGS, keyOf, designKey, cleanDesign, cleanSlice, pruneSlice, applyFlagAction } = core;
const { paintFlag, buildFlagModel } = await import(new URL('flags-model.js', base));
const { createFlags, OLD_HOST } = await import(new URL('flags.js', base));

const env = (decor, pos = { x: 0, z: 0 }) => ({ decorAt: (x, z) => decor.find(d => d.x === x && d.z === z)?.type ?? null, pos: a => (typeof pos === 'function' ? pos(a) : pos) });
const fresh = () => cleanSlice(undefined);
const pole = (x, z) => ({ type: 'flagpole', x, z });

// ---------------------------------------------------------------- cleanDesign
test('cleanDesign lenient: per-index defaults, non-array -> DEFAULT, fresh array, input untouched', () => {
  assert.deepEqual(cleanDesign([0, 5, 7, 8, 7]), [0, 5, 7, 8, 7]);
  const bad = [99, -1, 2.5, 'x', null];
  assert.deepEqual(cleanDesign(bad), DEFAULT.slice(0, 2).concat([DEFAULT[2], DEFAULT[3], DEFAULT[4]]));
  assert.deepEqual(cleanDesign([3, 99, 2, -4, 6]), [3, DEFAULT[1], 2, DEFAULT[3], 6]);
  assert.deepEqual(cleanDesign([4]), [4, DEFAULT[1], DEFAULT[2], DEFAULT[3], DEFAULT[4]]);
  for (const v of [undefined, null, {}, 'abc', 5]) assert.deepEqual(cleanDesign(v), [...DEFAULT]);
  const inp = [1, 2, 3, 4, 5], out = cleanDesign(inp);
  assert.notEqual(out, inp); assert.deepEqual(inp, [1, 2, 3, 4, 5]);
  assert.notEqual(cleanDesign(undefined), DEFAULT);
  assert.ok(!Object.isFrozen(cleanDesign(undefined)));
});

test('cleanDesign strict: floats, negatives, out of range, wrong length and strings -> null', () => {
  assert.deepEqual(cleanDesign([1, 0, 5, 1, 5], true), [1, 0, 5, 1, 5]);
  for (const v of [[1.5, 0, 5, 1, 5], [-1, 0, 5, 1, 5], [8, 0, 5, 1, 5], [1, 6, 5, 1, 5], [1, 0, 5, 9, 5], [1, 0, 5, 1], [1, 0, 5, 1, 5, 0],
    ['1', 0, 5, 1, 5], 'abcde', undefined, null, {}, [1, 0, 5, 1, NaN]]) assert.equal(cleanDesign(v, true), null, JSON.stringify(v));
  assert.deepEqual(RANGES, [8, 6, 8, 9, 8]);
});

// ---------------------------------------------------------------- cleanSlice / pruneSlice
test('cleanSlice: bad keys, canonical keys, cap, decor pruning, undefined, JSON round trip', () => {
  assert.deepEqual(cleanSlice(undefined), { r: 0, s: null, f: {} });
  const s = cleanSlice({ r: 4, s: 'abc', f: { '01,2': [0, 1, 2, 3, 4], 'nope': [1, 1, 1, 1, 1], '1,2,3': [1], '-3,4': [99, 1, 1, 1, 1], '5000,1': [1, 1, 1, 1, 1] } });
  assert.equal(s.r, 4); assert.equal(s.s, 'abc');
  assert.deepEqual(s.f, { '1,2': [0, 1, 2, 3, 4], '-3,4': [DEFAULT[0], 1, 1, 1, 1] });
  assert.deepEqual(cleanSlice({ r: -1, s: 'x'.repeat(17), f: [] }), { r: 0, s: null, f: {} });
  const many = {}; for (let i = 0; i < 40; i++) many[keyOf(i, 0)] = [1, 1, 1, 1, 1];
  assert.equal(Object.keys(cleanSlice({ f: many }).f).length, MAX_FLAGS);
  const pruned = cleanSlice({ f: { '0,0': [2, 2, 2, 2, 2], '1,0': [3, 3, 3, 3, 3], '2,0': [1, 1, 1, 1, 1] } }, [pole(0, 0), { type: 'sign', x: 1, z: 0 }]);
  assert.deepEqual(Object.keys(pruned.f), ['0,0']);
  const again = cleanSlice(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again, s);
});

test('pruneSlice drops removed poles only and does not bump r', () => {
  const st = cleanSlice({ r: 3, f: { '0,0': [2, 2, 2, 2, 2], '1,0': [3, 3, 3, 3, 3] } });
  const decor = [pole(0, 0), pole(1, 0)];
  assert.equal(pruneSlice(st, decor), 0);
  decor.splice(1, 1);
  assert.equal(pruneSlice(st, decor), 1);
  assert.deepEqual(Object.keys(st.f), ['0,0']); assert.equal(st.r, 3);
});

// ---------------------------------------------------------------- applyFlagAction
test('applyFlagAction: happy path and every refusal, no mutation on refusal', () => {
  const decor = [pole(0, 0), { type: 'sign', x: 1, z: 0 }];
  const st = fresh(), d = [2, 1, 0, 3, 5];
  const ok = applyFlagAction(st, { kind: 'flag.set', x: 0, z: 0, d }, 'host', env(decor));
  assert.equal(ok.ok, true); assert.equal(ok.key, '0,0'); assert.deepEqual(st.f['0,0'], d); assert.equal(st.r, 1);
  assert.notEqual(st.f['0,0'], d);
  const snap = JSON.stringify(st);
  const refuse = (a, pos, reason) => {
    const r = applyFlagAction(st, a, 'guest', env(decor, pos));
    assert.equal(r.ok, false, reason); assert.equal(r.reason, reason); assert.equal(JSON.stringify(st), snap, reason);
  };
  refuse({ kind: 'flag.nope', x: 0, z: 0, d }, undefined, 'bad');
  refuse({ kind: 'flag.set', x: 1, z: 0, d }, undefined, 'notarget');
  refuse({ kind: 'flag.set', x: 5, z: 5, d }, undefined, 'notarget');
  refuse({ kind: 'flag.set', x: .5, z: 0, d }, undefined, 'notarget');
  refuse({ kind: 'flag.set', x: 0, z: 0, d }, { x: 4.1, z: 0 }, 'far');
  refuse({ kind: 'flag.set', x: 0, z: 0, d }, null, 'far');
  refuse({ kind: 'flag.set', x: 0, z: 0, d: [1, 2, 3] }, undefined, 'bad');
  refuse({ kind: 'flag.set', x: 0, z: 0, d: [1, 0, 5, 1, 99] }, undefined, 'bad');
  const same = applyFlagAction(st, { kind: 'flag.set', x: 0, z: 0, d }, 'host', env(decor));
  assert.equal(same.ok, true); assert.equal(same.same, true); assert.equal(st.r, 1);
  // full: 24 entries, the 25th new key is refused, an existing key can still change
  const big = fresh(), poles = [];
  for (let i = 0; i < MAX_FLAGS + 1; i++) poles.push(pole(i, 0));
  for (let i = 0; i < MAX_FLAGS; i++) assert.equal(applyFlagAction(big, { kind: 'flag.set', x: i, z: 0, d }, 'host', env(poles, { x: i * 2, z: 0 })).ok, true);
  const before = JSON.stringify(big);
  const full = applyFlagAction(big, { kind: 'flag.set', x: MAX_FLAGS, z: 0, d }, 'host', env(poles, { x: MAX_FLAGS * 2, z: 0 }));
  assert.equal(full.reason, 'full'); assert.equal(JSON.stringify(big), before);
  assert.equal(applyFlagAction(big, { kind: 'flag.set', x: 0, z: 0, d: [0, 0, 0, 0, 0] }, 'host', env(poles)).ok, true);
});

// ---------------------------------------------------------------- content module
function fakeCtx(role = 'host') {
  const ctx = {
    role, T: null, world: { decor: [pole(0, 0)], tiles: [[0, 0]] }, physics: { x: 0, z: 0 }, other: { x: 0, z: 0 },
    camera: { position: { x: 0, y: 1.6, z: 3 } }, raft: { position: { y: 0 } }, elapsed: 0,
    emits: [], notices: [], actions: [],
    emit(e, to) { this.emits.push([e, to]); }, notice(s) { this.notices.push(s); }, action(a) { this.actions.push(a); },
    uiOpen: () => false, releaseLock() {}, rebuildRaft() {}, esc: s => s,
  };
  return ctx;
}

test('module: host action -> serialize -> guest load(net) gives the same f; refusal notices', () => {
  const hctx = fakeCtx('host'), host = createFlags(hctx);
  assert.equal(host.action({ kind: 'decor.write' }, 'host'), false);
  assert.equal(host.action({ kind: 'flag.set', x: 0, z: 0, d: [3, 2, 0, 6, 5] }, 'guest'), true);
  assert.deepEqual(hctx.emits.at(-1), [{ kind: 'build', text: 'Flag raised!' }, 'guest']);
  hctx.other = { x: 9, z: 0 };
  assert.equal(host.action({ kind: 'flag.set', x: 0, z: 0, d: [1, 1, 1, 1, 1] }, 'guest'), true);
  assert.deepEqual(hctx.emits.at(-1), [{ kind: 'notice', text: 'Step a little closer' }, 'guest']);
  assert.equal(host.action({ kind: 'flag.other' }, 'guest'), true);
  const data = JSON.parse(JSON.stringify(host.serialize()));
  assert.equal(data.v, 1); assert.deepEqual(data.f, { '0,0': [3, 2, 0, 6, 5] });
  assert.equal(host.serialize(), host.serialize(), 'cached by r');
  const gctx = fakeCtx('guest'), guest = createFlags(gctx);
  guest.load(data, 'net');
  assert.deepEqual(guest.debug.state().f, data.f);
  // guests never mutate locally
  guest.debug.set(0, 0, [0, 0, 0, 0, 0]);
  assert.equal(gctx.actions.length, 1); assert.deepEqual(guest.debug.state().f, data.f);
});

test('module: old host guard (ext.flags undefined) changes prompt and interact', () => {
  const gctx = fakeCtx('guest'), guest = createFlags(gctx);
  gctx.camera.position = { x: 0, y: 2, z: 2 };
  const aim = { dir: { x: 0, y: 0, z: -1 } };
  assert.equal(guest.prompt(aim), '<kbd>E</kbd>Design flag');
  guest.load(undefined, 'net');
  assert.equal(guest.prompt(aim), OLD_HOST);
  assert.equal(guest.interact(aim), true);
  assert.deepEqual(gctx.notices, [OLD_HOST]);
  guest.load({ v: 1, r: 1, s: 'h', f: {} }, 'net');
  assert.equal(guest.prompt(aim), '<kbd>E</kbd>Design flag');
  assert.equal(guest.prompt({ dir: { x: 0, y: 0, z: 1 } }), null, 'looking away');
});

test('module: removed pole drops its entry on serialize; old saves load; afterUndecor drops the design', () => {
  const ctx = fakeCtx('host'), m = createFlags(ctx);
  ctx.world.decor.push(pole(1, 0));
  m.action({ kind: 'flag.set', x: 0, z: 0, d: [2, 2, 2, 2, 2] }, 'host');
  m.action({ kind: 'flag.set', x: 1, z: 0, d: [4, 4, 4, 4, 4] }, 'host');
  assert.equal(Object.keys(m.serialize().f).length, 2);
  ctx.world.decor.splice(1, 1);
  const r0 = m.serialize().r;
  assert.deepEqual(Object.keys(m.serialize().f), ['0,0']);
  assert.ok(m.serialize().r > r0 - 1);
  ctx.world.decor.length = 0;
  m.afterUndecor({ type: 'flagpole', x: 0, z: 0 }, 'host');
  assert.deepEqual(m.serialize().f, {});
  assert.doesNotThrow(() => m.load(undefined));
  assert.deepEqual(m.serialize().f, {});
  // a save with an entry for a pole that still exists survives load('save')
  ctx.world.decor.push(pole(0, 0));
  m.load({ v: 1, r: 9, s: 'old', f: { '0,0': [0, 1, 2, 3, 4], '7,7': [1, 1, 1, 1, 1] } }, 'save');
  assert.deepEqual(m.serialize().f, { '0,0': [0, 1, 2, 3, 4] });
  assert.doesNotThrow(() => m.update(.016));
  m.dispose();
});

test('module with THREE: decorModel dresses the cloth, design swaps in place, cache pruned', () => {
  const ctx = fakeCtx('host'); ctx.T = T;
  const m = createFlags(ctx);
  const root = new T.Group();
  const g = m.decorModel('flagpole', pole(0, 0)); root.add(g);
  assert.equal(g.name, 'decor_flagpole');
  assert.equal(m.decorModel('sign', pole(0, 0)), null);
  const cloth = g.userData.cloth, mat0 = cloth.material;
  assert.equal(cloth.castShadow, false); assert.equal(cloth.receiveShadow, true);
  assert.ok(cloth.geometry.userData.shared && mat0.userData.shared);
  assert.equal(m.debug.texCount(), 1);
  m.action({ kind: 'flag.set', x: 0, z: 0, d: [4, 1, 0, 2, 0] }, 'host');
  assert.notEqual(cloth.material, mat0, 'swapped in place');
  assert.equal(m.debug.texCount(), 1, 'old material pruned');
  ctx.world.sailing = { windDir: 1, windStr: .9 }; ctx.elapsed = 2;
  m.update(.016);
  const w = m.debug.wind();
  assert.equal(w.uStr, .9); assert.equal(w.uTime, 2);
  assert.ok(Math.abs(w.yaw[0] - (1 - Math.PI / 2)) < .07);
  m.dispose();
});

// [review] wind blows toward (sin wd, cos wd) (sailing-core windVector): the cloth's +X must stream that way,
// whatever the placement rotation.
test('module with THREE: cloth streams downwind for any windDir and placement rotation', () => {
  const ctx = fakeCtx('host'); ctx.T = T;
  const m = createFlags(ctx), root = new T.Group(), v = new T.Vector3(), q = new T.Quaternion();
  const g = m.decorModel('flagpole', pole(0, 0)); root.add(g);
  for (const [wd, rot] of [[0, 0], [1, 0], [-2, Math.PI / 2], [2.5, -1.2]]) {
    g.rotation.y = rot; ctx.world.sailing = { windDir: wd, windStr: .5 }; ctx.elapsed = 0;
    g.userData.pivot.position.x = 0; m.update(.016); root.updateMatrixWorld(true);
    g.userData.cloth.getWorldQuaternion(q); v.set(1, 0, 0).applyQuaternion(q);
    assert.ok(v.x * Math.sin(wd) + v.z * Math.cos(wd) > .99, `wd ${wd} rot ${rot}: ${v.x.toFixed(2)},${v.z.toFixed(2)}`);
  }
  // aim at the cloth centre downwind of the masthead (not the mast): it targets the pole
  ctx.world.sailing = { windDir: 0, windStr: .5 }; ctx.camera.position = { x: 0, y: 3.22, z: 3 }; ctx.physics = { x: 0, z: 1 };
  assert.equal(m.prompt({ dir: { x: 0, y: 0, z: -1 } }), '<kbd>E</kbd>Design flag');
  ctx.camera.position = { x: .65, y: 3.22, z: 3 };
  assert.equal(m.prompt({ dir: { x: 0, y: 0, z: -1 } }), null, 'upwind/crosswind side has no cloth');
  m.dispose();
});

test('module: save load keeps r monotonic; dead poles release the DEFAULT cloth; real undecor flow', () => {
  const ctx = fakeCtx('host'); ctx.T = T;
  const m = createFlags(ctx), root = new T.Group();
  const r0 = m.serialize().r;
  m.load({ v: 1, r: Number.MAX_SAFE_INTEGER - 1, s: 'x', f: {} }, 'save');
  const r1 = m.serialize().r; assert.ok(r1 > r0 && Number.isSafeInteger(r1));
  m.action({ kind: 'flag.set', x: 0, z: 0, d: [2, 2, 2, 2, 2] }, 'host');
  assert.equal(m.serialize().r, r1 + 1, 'r++ still moves');
  // a pole with no entry draws DEFAULT; once it is gone the DEFAULT texture is freed on rescan
  ctx.world.decor.push(pole(1, 0));
  const g0 = m.decorModel('flagpole', pole(0, 0)), g1 = m.decorModel('flagpole', pole(1, 0)); root.add(g0, g1);
  m.update(.016); assert.equal(m.debug.texCount(), 2);
  ctx.world.decor.splice(1, 1); root.remove(g1); m.update(.016);
  assert.equal(m.debug.texCount(), 1, 'DEFAULT pruned with its pole');
  // game.js 'undecor' order: splice decor, afterUndecor, then rebuildRaft (old groups detached, new ones built)
  const rB = m.serialize().r, d = ctx.world.decor[0]; ctx.world.decor.splice(0, 1);
  m.afterUndecor(d, 'host');
  assert.deepEqual(m.serialize().f, {}); assert.equal(m.serialize().r, rB + 1);
  root.remove(g0); m.update(.016);
  assert.equal(m.debug.texCount(), 0, 'no cloth kept for a pole that is gone');
  m.dispose();
});

test('model: geometry sizes and shader injection', () => {
  const md = buildFlagModel(T);
  const g = md.instance();
  assert.equal(g.userData.pivot.position.y, 3.3);
  md.clothGeo.computeBoundingBox();
  const bb = md.clothGeo.boundingBox;
  assert.ok(Math.abs(bb.min.x) < 1e-6 && Math.abs(bb.max.x - 1.2) < 1e-6 && Math.abs(bb.max.y) < 1e-6 && Math.abs(bb.min.y + .6) < 1e-6);
  const mat = md.waveMaterial(null), sh = { uniforms: {}, vertexShader: 'void main(){\n#include <begin_vertex>\n}' };
  mat.onBeforeCompile(sh);
  assert.equal(sh.uniforms.uTime, md.uniforms.uTime);
  assert.match(sh.vertexShader, /^uniform float uTime; uniform float uStr;/);
  assert.match(sh.vertexShader, /transformed\.z \+= famp/);
  assert.equal(mat.customProgramCacheKey(), 'raftFlagWave');
  assert.equal(mat.side, T.DoubleSide); assert.ok(!mat.transparent);
  md.dispose();
});

// ---------------------------------------------------------------- painter
function fakeG2d() {
  const calls = [];
  const g = new Proxy({ calls }, {
    get(t, k) { if (k in t) return t[k]; return (...a) => { calls.push([k, ...a]); }; },
    set(t, k, v) { calls.push(['set:' + String(k), v]); return true; },
  });
  return g;
}
class FakePath { static made = 0; constructor(d) { this.d = d; FakePath.made++; } }

test('paintFlag: background first, no Path2D for emblem 0, every pattern fills', () => {
  const g = fakeG2d();
  FakePath.made = 0;
  paintFlag(g, [3, 0, 5, 0, 5], 128, 64, FakePath);
  const firstFill = g.calls.findIndex(c => c[0] === 'fillRect');
  const styleBefore = g.calls.slice(0, firstFill).filter(c => c[0] === 'set:fillStyle').at(-1);
  assert.equal(styleBefore[1], PALETTE[3]);
  assert.deepEqual(g.calls[firstFill].slice(1), [0, 0, 128, 64]);
  assert.equal(FakePath.made, 0);
  for (let p = 1; p < PATTERNS.length; p++) {
    const gg = fakeG2d();
    paintFlag(gg, [0, p, 2, 0, 5], 128, 64, FakePath);
    const fills = gg.calls.filter(c => c[0] === 'fillRect' || c[0] === 'fill').length;
    assert.ok(fills >= 3, PATTERNS[p]); // background + pattern + hem
  }
  const ge = fakeG2d();
  paintFlag(ge, [0, 0, 2, 4, 6], 128, 64, FakePath);
  assert.equal(FakePath.made, 1);
  const fill = ge.calls.find(c => c[0] === 'fill');
  assert.equal(fill[1].d, EMBLEM_PATHS.gull);
});

test('EMBLEM_PATHS: 8 original paths, safe commands, bounded', () => {
  assert.deepEqual(Object.keys(EMBLEM_PATHS), EMBLEMS.slice(1));
  for (const [k, d] of Object.entries(EMBLEM_PATHS)) {
    assert.match(d, /^[MLHVCQZ0-9 .,\-]+$/i, k);
    assert.ok(d.length <= 600, k);
    for (const n of d.match(/-?\d+(\.\d+)?/g)) assert.ok(+n >= 6 && +n <= 58, `${k} ${n}`);
  }
  assert.equal(designKey([1, 0, 5, 1, 5]), '1.0.5.1.5');
});

test('paintFlag: the emblem gets an outline that differs from its own colour (QA r2: cream on cream stripes)', () => {
  for (const d of [[2, 1, 0, 1, 0], [0, 1, 2, 1, 0], [5, 0, 5, 6, 5]]) {
    const g = fakeG2d();
    paintFlag(g, d, 128, 64, FakePath);
    const i = g.calls.findIndex(c => c[0] === 'stroke'), f = g.calls.findIndex(c => c[0] === 'fill');
    assert.ok(i >= 0 && i < f, 'stroke under the fill');
    const stroke = g.calls.slice(0, i).filter(c => c[0] === 'set:strokeStyle').at(-1)[1];
    assert.notEqual(stroke, PALETTE[d[4]], JSON.stringify(d));
  }
});
