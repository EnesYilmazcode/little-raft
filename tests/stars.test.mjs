// Shooting-star nights (docs/specs/stars.md): pure core only. Run: node --test tests/stars.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
const STAMP = (/from '\.\/daynight\.js(\?[^']*)?'/.exec(src('stars-core.js')) ?? [])[1] ?? '';
const DN = await import(new URL('daynight.js' + STAMP, base));
const C = await import(new URL('stars-core.js' + STAMP, base));
const { EVENTS } = await import(new URL('audio.js', base));
const { ITEMS } = await import(new URL('items.js', base));
const { DAY_SECONDS, weatherAt } = DN;
const { SHOWER, GIFTS, isShowerNight, meteorAt, makeMeteor, headDir, aliveAt, makeAlive, checkWish, giftFor, cleanStars, serializeStars, defaultStars, copyStars, nextShowerIn, lastSlot } = C;

const SEEDS = [12345, 0xdeadbeef, 777];
const rainy = (seed, day) => [.70, .82, .95].some(f => weatherAt(seed, (day + f) * DAY_SECONDS, {}).weather === 'rain');
const clearShowerDay = (seed, from = 2) => { for (let d = from; d < 500; d++) if (isShowerNight(seed, d)) return d; throw new Error('no shower'); };

test('night choice: deterministic, day 0 never, day 1 unless rain, rain never, rate .2-.3', () => {
  for (const seed of SEEDS) {
    assert.equal(isShowerNight(seed, 0), false);
    assert.equal(isShowerNight(seed, -1), false);
    assert.equal(isShowerNight(seed, 1), !rainy(seed, 1));
    let n = 0;
    for (let d = 1; d <= 2000; d++) {
      const a = isShowerNight(seed, d), b = isShowerNight(seed, d);
      assert.equal(a, b);
      assert.equal(isShowerNight(seed + 1, d) !== null, true); // thrash the memo
      assert.equal(isShowerNight(seed, d), a);
      if (rainy(seed, d)) assert.equal(a, false, `rainy day ${d}`);
      if (a) n++;
    }
    const rate = n / 2000;
    assert.ok(rate >= .2 && rate <= .3, `rate ${rate} seed ${seed}`);
  }
  assert.equal(isShowerNight(5, 0, new Set([0])), true); // QA force
  const s = SEEDS[0], d = clearShowerDay(s);
  const nx = nextShowerIn(s, d - 1, 10);
  assert.equal(nx >= 1 && isShowerNight(s, d - 1 + nx), true);
});

test('schedule: deterministic, ordered, inside the window, life >= .6, unit vectors, elevation >= 12 deg', () => {
  const min12 = Math.sin(12 * Math.PI / 180) - 1e-9, min20 = Math.sin(20 * Math.PI / 180) - 1e-9;
  for (const seed of SEEDS) for (const day of [1, 7, 42, 999]) {
    let prev = -Infinity, ok = 0;
    for (let k = 0; k < SHOWER.SLOTS; k++) {
      const m = meteorAt(seed, day, k), m2 = meteorAt(seed, day, k);
      assert.deepEqual(m, m2);
      if (!m.ok) continue;
      ok++;
      assert.ok(m.t0 > prev); prev = m.t0;
      const ph = (m.t0 - day * DAY_SECONDS) / DAY_SECONDS;
      assert.ok(ph >= .70 && ph <= .95, `phase ${ph}`);
      assert.ok((m.t0 + m.life - day * DAY_SECONDS) / DAY_SECONDS <= .951);
      assert.ok(m.life >= .6 && m.life <= 1.1);
      for (const v of [m.a, m.b]) assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9);
      assert.ok(m.a.y >= min20 && m.b.y >= min12);
      assert.ok([0, 1, 2].includes(m.tint));
      const h = {}; const u = headDir(m, m.t0 + m.life / 2, h);
      assert.ok(Math.abs(u - .5) < 1e-9 && Math.abs(Math.hypot(h.x, h.y, h.z) - 1) < 1e-9 && h.y >= min12);
    }
    assert.ok(ok >= 60 && ok <= 75, `${ok} meteors`);
  }
  assert.equal(meteorAt(1, 1, 75).ok, false);
  assert.equal(meteorAt(1, 1, 1.5).ok, false);
});

test('aliveAt is O(1) and matches a brute-force scan; never more than 3', () => {
  let r = 0x1234;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  const list = makeAlive(), m = makeMeteor();
  let seen = 0;
  for (const seed of SEEDS) {
    const day = clearShowerDay(seed);
    for (let i = 0; i < 5000; i++) {
      const clock = day * DAY_SECONDS + (i % 5 === 0 ? rnd() * DAY_SECONDS : 830 + rnd() * 320);
      aliveAt(seed, clock, list);
      assert.ok(list.n <= 3);
      const want = [];
      for (let k = 0; k < SHOWER.SLOTS; k++) { meteorAt(seed, day, k, m); if (m.ok && clock >= m.t0 && clock < m.t0 + m.life) want.push(k); }
      const got = list.m.slice(0, list.n).map(x => x.k);
      assert.deepEqual(got, want, `clock ${clock}`);
      seen += got.length;
    }
    // not a shower night: nothing
    for (let d = 2; d < 50; d++) if (!isShowerNight(seed, d)) { assert.equal(aliveAt(seed, d * DAY_SECONDS + 900, list).n, 0); break; }
  }
  assert.ok(seen > 1000);
});

test('checkWish: slack, night, types, repeats, cap 5, new day reset, independent caps', () => {
  const seed = SEEDS[0], day = clearShowerDay(seed);
  const ks = []; for (let k = 0; k < SHOWER.SLOTS && ks.length < 8; k++) if (meteorAt(seed, day, k).ok) ks.push(k);
  const m = meteorAt(seed, day, ks[0]);
  const s = defaultStars();
  assert.equal(checkWish(s, 'host', seed, m.t0 - 2, { day, k: ks[0] }).ok, true);
  assert.equal(checkWish(s, 'host', seed, m.t0 + m.life + 2, { day, k: ks[0] }).ok, true);
  assert.equal(checkWish(s, 'host', seed, m.t0 - 2.01, { day, k: ks[0] }).why, 'time');
  assert.equal(checkWish(s, 'host', seed, m.t0 + m.life + 2.01, { day, k: ks[0] }).why, 'time');
  assert.equal(checkWish(s, 'host', seed, m.t0, { day: String(day), k: ks[0] }).why, 'bad');
  assert.equal(checkWish(s, 'host', seed, m.t0, { day, k: 1.5 }).why, 'bad');
  assert.equal(checkWish(s, 'host', seed, m.t0, null).why, 'bad');
  let off = 2; while (isShowerNight(seed, off)) off++;
  const mo = meteorAt(seed, off, 3);
  assert.equal(checkWish(s, 'host', seed, mo.t0, { day: off, k: 3 }).why, 'night');
  let rd = 2; while (!rainy(seed, rd)) rd++;
  assert.equal(checkWish(s, 'host', seed, meteorAt(seed, rd, 3).t0, { day: rd, k: 3 }).why, 'night');
  // grant five, refuse the sixth and a repeat
  for (let i = 0; i < 5; i++) {
    const mi = meteorAt(seed, day, ks[i]);
    const r = checkWish(s, 'host', seed, mi.t0, { day, k: ks[i] });
    assert.equal(r.ok, true); s.night.host.push(ks[i]);
  }
  assert.equal(s.night.day, day);
  assert.equal(checkWish(s, 'host', seed, meteorAt(seed, day, ks[0]).t0, { day, k: ks[0] }).why, 'repeat');
  assert.equal(checkWish(s, 'host', seed, meteorAt(seed, day, ks[5]).t0, { day, k: ks[5] }).why, 'cap');
  // the guest has their own cap
  assert.equal(checkWish(s, 'guest', seed, meteorAt(seed, day, ks[0]).t0, { day, k: ks[0] }).ok, true);
  // a new night resets
  const day2 = clearShowerDay(seed, day + 1), m2 = meteorAt(seed, day2, ks[0]);
  const r2 = m2.ok ? checkWish(s, 'host', seed, m2.t0, { day: day2, k: ks[0] }) : null;
  if (r2) { assert.equal(r2.ok, true); assert.equal(s.night.day, day2); assert.deepEqual(s.night.host, []); }
  // a gap slot is refused
  let gap = -1; for (let k = 0; k < SHOWER.SLOTS; k++) if (!meteorAt(seed, day, k).ok) { gap = k; break; }
  if (gap >= 0) assert.equal(checkWish(defaultStars(), 'host', seed, day * DAY_SECONDS + 840 + gap * 4, { day, k: gap }).why, 'gap');
  assert.ok(lastSlot(seed, day) >= ks[ks.length - 1]);
});

test('giftFor: deterministic, in the pool, host and guest differ across a sample', () => {
  const pool = GIFTS.map(g => g[0]);
  for (const id of pool) assert.ok(ITEMS[id], `items.js has ${id}`);
  let diff = 0; const hist = {};
  for (let day = 1; day < 40; day++) for (let k = 0; k < 75; k += 5) {
    const h = giftFor(7, day, k, 'host'), g = giftFor(7, day, k, 'guest');
    assert.equal(giftFor(7, day, k, 'host'), h);
    assert.ok(pool.includes(h) && pool.includes(g));
    if (h !== g) diff++;
    hist[h] = (hist[h] || 0) + 1;
  }
  assert.ok(diff > 100);
  assert.ok(hist.flowerseed > hist.skyrocket);
});

test('cleanStars: junk -> valid slice; round trip; copy in place', () => {
  const ok = s => {
    assert.equal(s.v, 1);
    for (const w of ['host', 'guest']) {
      assert.ok(Number.isInteger(s.wishes[w]) && s.wishes[w] >= 0 && s.wishes[w] <= 1e6);
      const l = s.night[w]; assert.ok(Array.isArray(l) && l.length <= 5 && new Set(l).size === l.length && l.every(k => Number.isInteger(k) && k >= 0 && k < 75));
    }
    assert.ok(Number.isInteger(s.night.day));
  };
  for (const x of [undefined, null, 5, 'x', [], { wishes: 'no' }, { wishes: { host: -4, guest: 2.7 } }, { wishes: { host: 1e9 } },
    { night: { day: 3, host: [1, 1, 2, 3, 4, 5, 6, 7], guest: [-1, 80, 'a', 2.5, 9] } }, { night: { day: 'x', host: [1] } }]) {
    const s = cleanStars(x); ok(s);
    assert.deepEqual(cleanStars(serializeStars(s)), s);
  }
  assert.deepEqual(cleanStars(undefined), defaultStars());
  assert.equal(cleanStars({ wishes: { host: 2.7 } }).wishes.host, 2);
  assert.deepEqual(cleanStars({ night: { day: 3, host: [1, 1, 2, 3, 4, 5, 6] } }).night.host, [1, 2, 3, 4, 5]);
  const a = defaultStars(), b = cleanStars({ wishes: { host: 3, guest: 1 }, night: { day: 4, host: [2], guest: [] } });
  const keep = a.night.host;
  assert.equal(copyStars(a, b), true); assert.equal(a.night.host, keep); assert.deepEqual(a, b);
  assert.equal(copyStars(a, b), false);
});

test('audio has a twinkle event; logbook has the wish achievements', async () => {
  assert.ok(EVENTS.includes('twinkle'));
  assert.match(src('audio.js'), /twinkle\(v, t, s\)/);
  const L = await import(new URL('logbook.js', base));
  assert.deepEqual(L.evaluate({}, [], { kind: 'wish', n: 1 }), ['wish1']);
  assert.deepEqual(L.evaluate({}, [], { kind: 'wish', n: 10 }), ['wish1', 'wish10']);
  assert.deepEqual(L.evaluate({ achievements: ['wish1'] }, [], { kind: 'wish', n: 9 }), []);
});

test('module: content FEATURES has stars right after storm; live PRELOAD lists the files', () => {
  assert.match(src('content.js'), /createStorm, createStars,/);
  for (const f of ['stars-core.js', 'stars-model.js', 'stars.js']) assert.ok(src('live.js').includes(`'${f}'`));
});

test('module: E steps aside while in bed or on a paddleboard, and wishes otherwise', async () => {
  const T = await import(new URL('vendor/three.module.js', base));
  const { createStars } = await import(new URL('stars.js' + STAMP, base));
  const seed = 4242, day = clearShowerDay(seed);
  let k = 0, m = makeMeteor(); while (!meteorAt(seed, day, k, m).ok) k++;
  const clock = m.t0 + m.life * 0.5, dir = { x: 0, y: 1, z: 0 }; headDir(m, clock, dir);
  const sent = [], bed = { in: { host: null, guest: null } }; let board = false;
  const ctx = { T, scene: new T.Scene(), camera: new T.PerspectiveCamera(), role: 'host', aim: () => ({ dir }), physics: { x: 0, z: 0 }, action: a => sent.push(a), play() {}, uiOpen: () => false };
  const mods = { daynight: { clock, seed, skyA: 1 }, sleep: { serialize: () => bed }, paddleboard: { riding: () => board } };
  const s = createStars(ctx, name => mods[name] ?? null);
  s.update(0.016);
  assert.equal(s.debug.state().aimed, k);
  bed.in.host = [0, 0];
  assert.equal(s.prompt({ dir }), null); assert.equal(s.interact({ dir }), false);
  bed.in.host = null; board = true;
  assert.equal(s.interact({ dir }), false);
  board = false;
  assert.match(s.prompt({ dir }), /Make a wish/);
  assert.equal(s.interact({ dir }), true);
  assert.deepEqual(sent, [{ kind: 'stars.wish', day, k }]);
  s.dispose();
});
