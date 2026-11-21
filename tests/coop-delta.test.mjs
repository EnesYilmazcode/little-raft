// Tests for dist/coop-delta.js. Run: node --test tests/coop-delta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
const { diff, applyPatch, quantize, DeltaEncoder, DeltaDecoder } = await import(new URL('../dist/coop-delta.js', import.meta.url));

// mulberry32 seeded PRNG
const prng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const wire = v => JSON.parse(JSON.stringify(v)); // simulate the channel
const rt = (a, b) => { const p = diff(a, b); const out = applyPatch(wire(a), p === undefined ? undefined : wire(p)); assert.deepEqual(out, b); return p; };

function randVal(r, depth = 0) {
  const t = r();
  if (depth > 3 || t < .35) { const u = r(); return u < .2 ? null : u < .35 ? r() < .5 : u < .7 ? Math.round(r() * 2000 - 1000) / 10 : u < .85 ? 'k' + Math.floor(r() * 9) : '$x'; }
  if (t < .55) return Array.from({length: Math.floor(r() * 4)}, () => randVal(r, depth + 1));
  if (t < .75) return Array.from({length: Math.floor(r() * 5)}, (_, i) => ({token: 't' + Math.floor(r() * 8) + '_' + i, v: randVal(r, depth + 1)}));
  const o = {}; for (let i = Math.floor(r() * 4); i--;) o[(r() < .05 ? '$' : 'k') + Math.floor(r() * 6)] = randVal(r, depth + 1); return o;
}
function mutate(r, v, depth = 0) {
  const t = r();
  if (t < .12 || depth > 4) return randVal(r, depth); // type change / replace
  if (Array.isArray(v)) {
    const a = v.slice(); const op = r();
    if (op < .2 && a.length) a.splice(Math.floor(r() * a.length), 1);
    else if (op < .4) a.splice(Math.floor(r() * (a.length + 1)), 0, r() < .7 ? {token: 'n' + Math.floor(r() * 1e6), v: randVal(r, 3)} : randVal(r, 3));
    else if (op < .55 && a.length > 1) { const i = Math.floor(r() * a.length), j = Math.floor(r() * a.length); [a[i], a[j]] = [a[j], a[i]]; }
    else if (a.length) { const i = Math.floor(r() * a.length); a[i] = isObj(a[i]) ? {...a[i], v: mutate(r, a[i].v, depth + 1)} : mutate(r, a[i], depth + 1); }
    return a;
  }
  if (isObj(v)) {
    const o = {...v}, ks = Object.keys(o), op = r();
    if (op < .25 && ks.length) delete o[ks[Math.floor(r() * ks.length)]];
    else if (op < .45) o['k' + Math.floor(r() * 9)] = randVal(r, depth + 1);
    else if (ks.length) { const k = ks[Math.floor(r() * ks.length)]; o[k] = mutate(r, o[k], depth + 1); }
    return o;
  }
  return randVal(r, depth);
}
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

test('fuzz round-trip: 2000 random JSON mutations', () => {
  const r = prng(1234);
  let v = {a: randVal(r), items: randVal(r)};
  for (let i = 0; i < 2000; i++) { const n = mutate(r, v); rt(v, n); assert.equal(diff(n, wire(n)), undefined); v = n; }
});

test('fuzz through encoder/decoder over a JSON channel', () => {
  const r = prng(99), enc = new DeltaEncoder({keyframeEvery: 37}), dec = new DeltaDecoder();
  let v = {type: 'x', d: randVal(r)};
  for (let i = 0; i < 2000; i++) { v = {type: 'x', d: mutate(r, v.d)}; assert.deepEqual(dec.decode(wire(enc.encode(v))), v); }
});

test('type changes, null, deleted keys, nested arrays', () => {
  rt({a: 1}, [1]); rt([1], {a: 1}); rt(5, {x: 1}); rt({x: 1}, 5); rt(null, {a: null}); rt({a: null}, null);
  rt({a: 1, b: 2, c: {d: 3}}, {a: 1, c: {}}); rt([[1, 2], [3]], [[1, 2], [3, 4]]); rt({$r: 1}, {$r: 2}); rt({a: {$d: 1}}, {a: {$d: 2}});
  rt({a: [1]}, {a: {b: [2]}}); rt('s', 's2'); rt({a: 1}, {a: '1'});
  assert.equal(diff({a: [1, {b: null}]}, {a: [1, {b: null}]}), undefined);
});

test('keyed array: insert, remove, reorder, field patch', () => {
  const items = Array.from({length: 10}, (_, i) => ({id: i, token: 'tok' + i, x: i, z: 0 - i || 0}));
  const p1 = rt(items, items.map((it, i) => i === 3 ? {...it, x: 99} : it));
  assert.deepEqual(p1, {$a: {3: {x: 99}}});
  rt(items, [...items.slice(0, 4), ...items.slice(5)]); // remove
  rt(items, [...items.slice(0, 2), {id: 77, token: 'new', x: 1, z: 2}, ...items.slice(2)]); // insert
  rt(items, items.slice().reverse()); // reorder
  rt(items, [items[9], ...items.slice(1, 9).map(it => ({...it, z: it.z - .5})), items[0]]);
  const spliced = [...items.slice(0, 3), ...items.slice(4), {id: 3, token: 'fresh', x: 5, z: 5}]; // game collect pattern
  const p = rt(items, spliced); assert.ok(JSON.stringify(p).length < 80, JSON.stringify(p));
  const byId = [{id: 'a', v: 1}, {id: 'b', v: 2}]; assert.deepEqual(rt(byId, [{id: 'b', v: 3}, {id: 'a', v: 1}]), {$a: {1: {v: 3}}, $o: [1, 0]});
  rt([{token: 'a'}, {token: 'a'}], [{token: 'a', q: 1}]); // duplicate keys -> whole replace
  rt([{token: 'a'}], [{token: 'a'}, 3]); rt([], [{token: 'a'}]); rt([{token: 'a'}], []);
});

test('quantize rounds non-integers only, deep copy', () => {
  const src = {a: 1.23456, b: [2, -0.00049, {c: 3.0005}], d: 'x', e: null, f: 7};
  const q = quantize(src);
  assert.deepEqual(q, {a: 1.235, b: [2, 0, {c: 3.001}], d: 'x', e: null, f: 7});
  assert.notEqual(q.b, src.b); assert.deepEqual(quantize(1.26, 1), 1.3);
});

test('gap -> null, then keyframe recovery', () => {
  const enc = new DeltaEncoder(), dec = new DeltaDecoder();
  const m = i => ({type: 'cp', x: i, y: 1});
  assert.deepEqual(dec.decode(wire(enc.encode(m(0)))), m(0));
  assert.deepEqual(dec.decode(wire(enc.encode(m(1)))), m(1));
  enc.encode(m(2)); // lost
  assert.equal(dec.decode(wire(enc.encode(m(3)))), null);
  assert.equal(dec.decode(wire(enc.encode(m(4)))), null); // stays broken until keyframe
  enc.forceKeyframe('cp');
  const kf = enc.encode(m(5)); assert.ok('f' in kf);
  assert.deepEqual(dec.decode(wire(kf)), m(5));
  assert.deepEqual(dec.decode(wire(enc.encode(m(6)))), m(6));
  assert.equal(new DeltaDecoder().decode(wire(enc.encode(m(7)))), null); // unknown base
  enc.forceKeyframe(); assert.ok('f' in enc.encode(m(8)));
  assert.deepEqual(dec.decode({type: 'coop', k: 'ping'}), {type: 'coop', k: 'ping'}); // non-Δ pass-through
});

test('keyframe on first send per type and every keyframeEvery', () => {
  const enc = new DeltaEncoder({keyframeEvery: 5});
  const kinds = Array.from({length: 11}, (_, i) => 'f' in enc.encode({type: 'a', i}));
  assert.deepEqual(kinds, [true, false, false, false, false, true, false, false, false, false, true]);
  assert.ok('f' in enc.encode({type: 'b'}));
  enc.reset(); assert.ok('f' in enc.encode({type: 'a', i: 0}));
});

test('mutation isolation: encoder copies input, decoder output is fresh', () => {
  const enc = new DeltaEncoder(), dec = new DeltaDecoder();
  const msg = {type: 's', list: [{token: 'a', x: 1}], o: {v: 1}};
  dec.decode(wire(enc.encode(msg)));
  msg.list[0].x = 2; msg.o.v = 2; // caller mutates in place
  const out = dec.decode(wire(enc.encode(msg)));
  assert.deepEqual(out, msg);
  out.list[0].x = 999; out.o.v = 999; out.extra = 1; // caller mutates decoded value
  msg.o.v = 3;
  assert.deepEqual(dec.decode(wire(enc.encode(msg))), msg);
  const a = {q: {r: [1]}}, p = diff(a, {q: {r: [2]}, z: {y: 1}}), b = applyPatch(a, p);
  assert.deepEqual(a, {q: {r: [1]}}); b.z.y = 5; assert.deepEqual(p.z, {$r: {y: 1}});
});

test('size: realistic hostState with 2 item moves per tick < 25% of full JSON', () => {
  const r = prng(7), q = n => Math.round(n * 1000) / 1000;
  const tiles = []; for (let x = -2; x <= 2; x++) for (let z = -2; z <= 1; z++) tiles.push([x, z]);
  const world = {tiles, decor: [{type: 'net', x: 2, z: -2}, {type: 'chest', x: 0, z: 1}, {type: 'campfire', x: -1, z: 0}],
    stock: {wood: 12, leaf: 7, scrap: 3, plastic: 5}, fish: 2, collected: 41, hookHealth: 0.72,
    items: Array.from({length: 30}, (_, id) => ({id, token: Math.floor(r() * 2 ** 32).toString(36) + Math.floor(r() * 2 ** 32).toString(36), type: ['wood', 'leaf', 'plastic', 'scrap', 'barrel'][id % 5], x: q(r() * 40 - 20), z: q(-10 - r() * 20), phase: q(r() * 6)}))};
  const bag = {slots: Array.from({length: 20}, (_, i) => i < 6 ? {kind: ['hook', 'wood', 'leaf', 'plastic', 'scrap', 'hammer'][i], count: i + 1} : null), selected: 0};
  const state = () => ({type: 'state', v: 3, ack: 17, bag, other: {x: 1.25, y: 0.5, z: -0.75, yaw: 1.571, swimming: false}, world});
  const enc = new DeltaEncoder(), dec = new DeltaDecoder();
  let full = 0, sent = 0;
  for (let tick = 0; tick < 49; tick++) {
    for (let k = 0; k < 2; k++) { const it = world.items[Math.floor(r() * 30)]; it.x = q(it.x + r() - .5); it.z = q(it.z + r() * .3); }
    const msg = state(), w = enc.encode(msg);
    assert.deepEqual(dec.decode(wire(w)), wire(msg));
    full += JSON.stringify(msg).length; if (tick) sent += JSON.stringify(w).length;
  }
  const ratio = sent / (full * 48 / 49);
  console.log(`full ≈ ${Math.round(full / 49)} B/tick, delta ≈ ${Math.round(sent / 48)} B/tick, ratio ${(ratio * 100).toFixed(1)}%`);
  assert.ok(ratio < .25, `ratio ${ratio}`);
});
