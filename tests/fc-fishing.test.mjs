// Unit tests for the pure FishingSession state machine (dist/fishing-v2.js).
// Run: node --test tests/fc-fishing.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { FishingSession, FISHING_TUNING } = await import(new URL('fishing-v2.js', base));
const { SPECIES } = await import(new URL('fish-species.js', base));

const seeded = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const DT = 1 / 30;
function cast(seed, charge = 0.5) {
  const s = new FishingSession({ rand: seeded(seed) });
  assert.equal(s.startCharge(), true); assert.equal(s.stage, 'charging');
  s.update(FISHING_TUNING.chargeMs / 1000 * charge);
  const d = s.releaseCast(); assert.equal(s.stage, 'flying');
  assert.ok(d >= FISHING_TUNING.minCast && d <= FISHING_TUNING.maxCast);
  return s;
}
function runUntil(s, pred, max = 60, each) {
  const evs = [];
  for (let t = 0; t < max; t += DT) { const e = s.update(DT); if (e) evs.push(e); each?.(s); if (pred(s, e)) return evs; }
  return evs;
}
function finite(s) { for (const k of ['charge', 'castDistance', 'progress', 'tension', 'stageT']) assert.ok(Number.isFinite(s[k]), k); }

test('happy path charge -> fly -> wait -> bite -> reel -> caught -> done', () => {
  const s = cast(1);
  let evs = runUntil(s, (x) => x.stage === 'bite');
  assert.equal(evs[0].kind, 'landed'); assert.equal(evs.at(-1).kind, 'bite');
  assert.ok(evs.filter((e) => e.kind === 'nibble').length <= 2);
  assert.ok(s.catch && typeof s.catch.species === 'string' && s.catch.cm > 0);
  assert.equal(s.press(), true); assert.equal(s.stage, 'reeling');
  evs = runUntil(s, (x) => x.stage !== 'reeling', 120, (x) => {
    if (x.holding && x.tension > 0.6) x.release(); else if (!x.holding && x.tension < 0.2) x.press();
  });
  assert.equal(s.stage, 'caught'); assert.equal(evs.at(-1).kind, 'caught'); assert.equal(evs.at(-1).catch, s.catch);
  evs = runUntil(s, (x) => x.stage === 'done', 5);
  assert.equal(evs.at(-1).kind, 'done'); finite(s);
});

test('early strike while waiting escapes with reason early', () => {
  const s = cast(2);
  runUntil(s, (x) => x.stage === 'waiting');
  s.update(0.5); assert.equal(s.press(), true);
  const e = s.update(DT);
  assert.deepEqual(e, { kind: 'escaped', reason: 'early' }); assert.equal(s.stage, 'escaped');
});

test('missing two bite windows: missed then escaped', () => {
  const s = cast(3);
  const evs = runUntil(s, (x) => x.stage === 'escaped', 120);
  const kinds = evs.map((e) => e.kind);
  assert.equal(kinds.filter((k) => k === 'bite').length, 2);
  assert.ok(kinds.indexOf('missed') > kinds.indexOf('bite'));
  assert.deepEqual(evs.at(-1), { kind: 'escaped', reason: 'missed' });
});

test('holding forever snaps the line', () => {
  const s = cast(4); s.debugForceBite('tuna'); assert.equal(s.update(DT).kind, 'bite');
  s.press(); assert.equal(s.stage, 'reeling');
  const evs = runUntil(s, (x) => x.stage !== 'reeling', 60);
  assert.deepEqual(evs.at(-1), { kind: 'escaped', reason: 'snapped' });
});

test('cancel and invalid calls are safe', () => {
  const s = new FishingSession({ rand: () => NaN });
  assert.equal(s.releaseCast(), 0); s.release(); assert.equal(s.update(NaN), null);
  s.startCharge(); for (let i = 0; i < 10; i++) s.update(0.25); assert.equal(s.charge, 1); s.release(); assert.equal(s.stage, 'flying');
  s.cancel(); assert.equal(s.stage, 'done'); assert.equal(s.update(1), null); finite(s);
});

test('deterministic for the same seed', () => {
  const trace = (seed) => { const s = cast(seed, 0.8); return runUntil(s, (x) => x.stage === 'escaped', 120).map((e) => e.kind + s.stageT.toFixed(3)).join(); };
  assert.equal(trace(9), trace(9));
});

test('casual policy success rates per species', () => {
  const rates = {};
  for (const sp of SPECIES) {
    let ok = 0;
    for (let i = 0; i < 300; i++) {
      const s = cast(i * 7 + 1); s.debugForceBite(sp.id); s.update(DT); s.press();
      const evs = runUntil(s, (x) => x.stage !== 'reeling', 120, (x) => {
        if (x.holding && x.tension > 0.75) x.release(); else if (!x.holding && x.tension < 0.35) x.press();
        assert.ok(Number.isFinite(x.progress) && Number.isFinite(x.tension));
      });
      if (evs.at(-1)?.kind === 'caught') ok++;
    }
    rates[sp.id] = ok / 300;
    const min = sp.rarity === 'common' ? 0.75 : sp.rarity === 'legendary' ? 0.45 : 0.5;
    assert.ok(rates[sp.id] >= min, `${sp.id} ${rates[sp.id]}`);
  }
  console.log('casual success', rates);
});
