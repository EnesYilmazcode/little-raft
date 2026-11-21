// Seashells + crew Shell Book: pure rules, book HTML and a stub-ctx module run.
// Run: node --test tests/shells.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const dist = fileURLToPath(base);
const BUILD = '?build=v3-survival-ae77fa84ac2b';
const T = await import(new URL('vendor/three.module.js', base));
const R = await import(new URL('shells-rules.js' + BUILD, base));
const B = await import(new URL('shells-book.js' + BUILD, base));
const L = await import(new URL('islands-layout.js' + BUILD, base));
const TR = await import(new URL('treasure-rules.js' + BUILD, base));
const I = await import(new URL('islands.js' + BUILD, base));
const { createShells } = await import(new URL('shells.js' + BUILD, base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { ITEM_TEXT } = await import(new URL('craft-book.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC } = await import(new URL('player-physics.js', base));
const { SHELLS, SETS, PAY_CAP, SHELL_CFG, sparklesFor, rollKind, weightsFor, clean, DEFAULTS, applyTake, applySeaFind, bookView, strHash } = R;
const { layoutFor, SHORE_U, groundHeight, shape, hash3 } = L;

const SEEDS = Array.from({ length: 400 }, (_, i) => (i * 2654435761 + 17) >>> 0);
const bagWith = (slots = []) => { const s = new Array(SLOT_COUNT).fill(null); slots.forEach((v, i) => { s[i] = v; }); return new Bag({ slots: s, selected: 0 }); };
const fullBag = () => bagWith(Array.from({ length: SLOT_COUNT }, () => ({ kind: 'stone', count: 20 })));
const byId = id => SHELLS.find(s => s.id === id);
const at = (seed, k) => sparklesFor(seed)[k];
const stFor = seed => { const s = DEFAULTS(); s.seed = seed; s.taken = sparklesFor(seed).map(() => 0); return s; };
const take = (st, k, bag, actor = 'host', cond = {}) => applyTake(st, { kind: 'shells.take', seed: st.seed, spot: k }, actor, { x: at(st.seed, k).x, z: at(st.seed, k).z }, bag, cond, 3);
const seedWith = pred => SEEDS.find(pred);

// ---------------------------------------------------------------- table
test('table: 12 frozen shells with the spec rarities and places; sets cover the book', () => {
  assert.equal(SHELLS.length, 12);
  assert.ok(Object.isFrozen(SHELLS) && Object.isFrozen(SHELLS[0]) && Object.isFrozen(SETS));
  assert.deepEqual(SHELLS.map(s => s.id), ['button', 'sunfan', 'tiddly', 'pebble', 'ribbon', 'moonsnail', 'piggy', 'butterfly', 'crown', 'lantern', 'starry', 'pearl']);
  const tiers = {}; for (const s of SHELLS) tiers[s.rarity] = (tiers[s.rarity] || 0) + 1;
  assert.deepEqual(tiers, { common: 4, uncommon: 4, rare: 3, legendary: 1 });
  for (const s of SHELLS) assert.ok(s.note && s.name && s.where.length, s.id);
  assert.deepEqual(SETS.find(s => s.id === 'full').gift, [['shellwreath', 1]]);
  assert.equal(SETS.find(s => s.id === 'full').ids.length, 12);
});

// ---------------------------------------------------------------- sparkles
test('sparklesFor: deterministic, cached, 2-4 spots in the wet band clear of nodes, dig spots and each other', () => {
  assert.equal(sparklesFor(1234), sparklesFor(1234), 'same frozen ref');
  assert.ok(Object.isFrozen(sparklesFor(1234)) && Object.isFrozen(sparklesFor(1234)[0]));
  const before = JSON.stringify(layoutFor(77)); sparklesFor(77);
  assert.equal(JSON.stringify(layoutFor(77)), before, 'layoutFor untouched');
  const counts = {};
  for (const seed of SEEDS) {
    const lay = layoutFor(seed), sp = sparklesFor(seed), dig = TR.spotsFor(seed);
    assert.ok(sp.length >= 2 && sp.length <= 4, `seed ${seed}: ${sp.length}`);
    counts[sp.length] = (counts[sp.length] || 0) + 1;
    for (const s of sp) {
      const a = Math.atan2(s.z, s.x), u = Math.hypot(s.x, s.z) / (lay.R * shape(a - lay.rot));
      assert.ok(u >= SHORE_U - SHELL_CFG.BAND - 1e-9 && u <= SHORE_U + 1e-9, `band u=${u}`);
      assert.ok(s.y >= SHELL_CFG.MIN_Y, 'above the waves');
      assert.ok(Math.abs(groundHeight(Math.hypot(s.x, s.z), lay.R, a - lay.rot) - s.y) < 1e-9);
      for (const n of lay.nodes) assert.ok(Math.hypot(n.x - s.x, n.z - s.z) >= SHELL_CFG.NODE_GAP_MIN, 'clear of nodes');
      for (const d of dig) assert.ok(Math.hypot(d.x - s.x, d.z - s.z) >= SHELL_CFG.SPOT_GAP_MIN, 'clear of dig spots');
      for (const o of sp) if (o !== s) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) >= SHELL_CFG.SPOT_GAP_MIN, 'apart');
    }
  }
  assert.ok(counts[2] && counts[3] && counts[4], JSON.stringify(counts));
  // most islands keep the full spec gaps (relaxed only on small, crowded ones)
  let strict = 0, all = 0;
  for (const seed of SEEDS) for (const s of sparklesFor(seed)) { all++; if (layoutFor(seed).nodes.every(n => Math.hypot(n.x - s.x, n.z - s.z) >= SHELL_CFG.NODE_GAP)) strict++; }
  assert.ok(strict / all > 0.85, `strict ${strict}/${all}`);
});

// ---------------------------------------------------------------- kind roll
test('rollKind: deterministic; beach never sea-only; crown only deep; night and storm bias', () => {
  assert.equal(rollKind(5, 1, 'beach'), rollKind(5, 1, 'beach'));
  const tally = (place, cond, n = 6000) => { const c = {}; for (let k = 0; k < n; k++) { const id = rollKind((k * 7919) >>> 0, k, place, cond); c[id] = (c[id] || 0) + 1; } return c; };
  const beach = tally('beach', {});
  for (const id of Object.keys(beach)) assert.ok(byId(id).where.includes('beach'), `beach gave ${id}`);
  assert.ok(!beach.crown && !beach.pebble && !beach.piggy && !beach.lantern);
  const sea = tally('sea', {}), deep = tally('sea', { deep: true });
  for (const id of Object.keys(sea)) assert.ok(byId(id).where.includes('sea'), `sea gave ${id}`);
  assert.ok(!sea.crown, 'no crown in shallow water');
  assert.ok(deep.crown > 0, 'crown when deep');
  const night = tally('beach', { night: true }), storm = tally('beach', { storm: true });
  assert.ok(night.moonsnail > beach.moonsnail * 1.5, `night ${night.moonsnail} vs ${beach.moonsnail}`);
  assert.ok(storm.starry > beach.starry * 2, `storm ${storm.starry} vs ${beach.starry}`);
  // tier weights split evenly: commons ~60% on the beach
  const w = weightsFor('beach', {}); const tot = w.reduce((s, [, x]) => s + x, 0);
  const common = w.filter(([id]) => byId(id).rarity === 'common').reduce((s, [, x]) => s + x, 0);
  assert.equal(Math.round(common / tot * 100), 60);
});

// ---------------------------------------------------------------- clean
test('clean: undefined -> defaults; junk and unknown ids dropped; taken resized; never aliases', () => {
  assert.deepEqual(clean(undefined), DEFAULTS());
  for (const junk of [null, 7, 'x', [], { seed: -1 }, { seed: 1.5 }, { book: 'no' }, { book: [] }, { sets: 'full' }]) assert.doesNotThrow(() => clean(junk));
  const n = sparklesFor(1234).length;
  const c = clean({ v: 1, seed: 1234, taken: [1, 'x', true, 1, 1, 1, 1], paid: 99, book: { button: { n: 0, day: 2, by: 'guest' }, nope: { n: 3 }, pearl: { n: 1e9, day: -3 }, crown: 'x' }, sets: ['tidepool', 'bogus', 'tidepool'], sea: { day: 4, n: 99 } });
  assert.equal(c.taken.length, n);
  assert.equal(c.taken[0], 1); assert.equal(c.taken[1], 0);
  assert.equal(c.paid, 0, 'out of range paid -> 0');
  assert.deepEqual(c.book.button, { n: 1, day: 2, by: 'guest' });
  assert.deepEqual(c.book.pearl, { n: 9999, day: 0, by: 'host' });
  assert.ok(!('nope' in c.book) && !('crown' in c.book));
  assert.deepEqual(c.sets, ['tidepool']);
  assert.deepEqual(c.sea, { day: 4, n: 0, p: 0 });
  // old shape without v / sea still keeps the book
  assert.deepEqual(clean({ book: { sunfan: { n: 2, day: 1, by: 'host' } } }).book, { sunfan: { n: 2, day: 1, by: 'host' } });
  const src = { v: 1, seed: 1234, taken: [0], book: { button: { n: 1, day: 0, by: 'host' } }, sets: [] };
  const out = clean(src); out.book.button.n = 50; out.taken[0] = 1;
  assert.equal(src.book.button.n, 1); assert.equal(src.taken[0], 0);
});

// ---------------------------------------------------------------- take
test('applyTake: refusals leave state and bag unchanged', () => {
  const seed = 1234, st = stFor(seed), bag = bagWith();
  const snap = () => JSON.stringify([st, bag.snapshot()]);
  const s0 = at(seed, 0), before = snap();
  assert.equal(applyTake(st, { kind: 'shells.take', seed: seed + 1, spot: 0 }, 'host', s0, bag).reason, 'stale');
  assert.equal(applyTake(st, { kind: 'shells.take', seed, spot: 9 }, 'host', s0, bag).reason, 'none');
  assert.equal(applyTake(st, { kind: 'shells.take', seed, spot: -1 }, 'host', s0, bag).reason, 'none');
  assert.equal(applyTake(st, { kind: 'shells.take', seed, spot: 0 }, 'host', { x: s0.x + 2.2, z: s0.z }, bag).reason, 'reach');
  assert.equal(applyTake(st, { kind: 'shells.take', seed, spot: 0 }, 'host', null, bag).reason, 'reach');
  assert.equal(snap(), before);
  // guest slack: 2.2 m is fine for the guest (the host sees an older pose)
  assert.equal(applyTake(st, { kind: 'shells.take', seed, spot: 0 }, 'guest', { x: s0.x + 2.2, z: s0.z }, bag).ok, true);
  assert.equal(take(st, 0, bag).reason, 'taken');
  // full: a repeat payout that does not fit changes nothing
  const st2 = stFor(seed), kind = rollKind(seed, 0, 'beach', {});
  st2.book[kind] = { n: 1, day: 0, by: 'host' };
  const fb = fullBag(), b2 = JSON.stringify([st2, fb.snapshot()]);
  assert.equal(take(st2, 0, fb).reason, 'full');
  assert.equal(JSON.stringify([st2, fb.snapshot()]), b2);
});

test('applyTake: first find pays 0, repeats pay by rarity, PAY_CAP per seed and reset by a new seed', () => {
  const seed = seedWith(s => sparklesFor(s).length === 4), st = stFor(seed), bag = bagWith();
  const r = take(st, 0, bag);
  assert.equal(r.ok, true); assert.equal(r.isNew, true); assert.deepEqual(r.pay, {}); assert.equal(bag.count('shell'), 0);
  assert.deepEqual(st.book[r.kind], { n: 1, day: 3, by: 'host' });
  assert.equal(st.taken[0], 1);
  // fill the book so every take is a repeat
  for (const s of SHELLS) st.book[s.id] ||= { n: 1, day: 0, by: 'host' };
  st.sets = SETS.map(s => s.id);
  const pays = [];
  for (let k = 1; k < 4; k++) { const x = take(st, k, bag); assert.equal(x.ok, true); assert.equal(x.isNew, false); pays.push(x.paid); assert.ok(x.paid <= R.RARITY[byId(x.kind).rarity].pay); }
  // the first take after a full book pays its whole rarity price unless the cap cuts it
  assert.ok(st.paid <= PAY_CAP && st.paid === pays.reduce((a, b) => a + b, 0));
  assert.equal(bag.count('shell'), st.paid);
  // cap: drive paid to the cap with fresh seeds sharing st, then a new seed resets it
  st.paid = PAY_CAP;
  const seed2 = SEEDS.find(s => s !== seed); st.seed = seed2; st.taken = sparklesFor(seed2).map(() => 0);
  st.paid = PAY_CAP; // still capped (module resets paid only on a seed change)
  const capped = take(st, 0, bag);
  assert.equal(capped.ok, true); assert.equal(capped.paid, 0); assert.equal(capped.capped, true);
  assert.ok(st.book[capped.kind].n >= 2, 'still counted in the book');
  assert.equal(st.paid, PAY_CAP);
  st.paid = 0; // what the module does on a new island
  const fresh = take(st, 1, bag);
  assert.equal(fresh.paid, R.RARITY[byId(fresh.kind).rarity].pay);
});

test('applyTake: set gifts once, wait when the bag is full, full book pays one wreath', () => {
  const seed = 1234, bag = bagWith();
  const st = stFor(seed), kind = rollKind(seed, 0, 'beach', {});
  const set = SETS.find(s => s.ids.includes(kind) && s.id !== 'full');
  for (const id of set.ids) if (id !== kind) st.book[id] = { n: 1, day: 0, by: 'host' };
  const r = take(st, 0, bag);
  assert.deepEqual(r.sets, [set.id]);
  for (const [k, n] of set.gift) assert.equal(bag.count(k), n, k);
  assert.deepEqual(st.sets, [set.id]);
  // waits: full bag on a first find, the set is not marked
  const st2 = stFor(seed); for (const id of set.ids) if (id !== kind) st2.book[id] = { n: 1, day: 0, by: 'host' };
  const fb = fullBag();
  const w = take(st2, 0, fb);
  assert.equal(w.ok, true); assert.deepEqual(w.sets, []); assert.deepEqual(st2.sets, []);
  assert.ok(st2.book[kind], 'the find still counts');
  fb.slots[5] = null; fb.slots[6] = null;
  const k2 = sparklesFor(seed).findIndex((_, i) => i > 0);
  const w2 = take(st2, k2, fb);
  assert.equal(w2.ok, true); assert.ok(w2.sets.includes(set.id), 'gift paid on the next successful take');
  // full book -> wreath
  const st3 = stFor(seed); for (const s of SHELLS) if (s.id !== kind) st3.book[s.id] = { n: 1, day: 0, by: 'host' };
  st3.sets = ['tidepool', 'sunny', 'deep'];
  const b3 = bagWith();
  const r3 = take(st3, 0, b3);
  assert.deepEqual(r3.sets, ['full']); assert.equal(b3.count('shellwreath'), 1);
  const again = take(st3, 1, b3);
  assert.deepEqual(again.sets, [], 'gifts are one-time');
});

// ---------------------------------------------------------------- sea
test('applySeaFind: only sand, 15% deterministic, 3 per day, crown only deep', () => {
  const st = DEFAULTS(), bag = bagWith();
  assert.equal(applySeaFind(st, { id: '1,2', type: 'clay', y: -8 }, 'host', bag, 0, { force: true }), null);
  let hits = 0;
  for (let i = 0; i < 4000; i++) if (hash3(strHash(`${i},7`), 2, R.SEA_K) < 0.15) hits++;
  assert.ok(hits > 480 && hits < 720, `chance ${hits}/4000`);
  const ids = []; for (let i = 0; ids.length < 5; i++) if (hash3(strHash(`${i},7`), 2, R.SEA_K) < 0.15) ids.push(`${i},7`);
  const miss = (() => { for (let i = 0; ; i++) if (!(hash3(strHash(`${i},9`), 2, R.SEA_K) < 0.15)) return `${i},9`; })();
  assert.equal(applySeaFind(st, { id: miss, type: 'sand', y: -3 }, 'host', bag, 2), null);
  const got = ids.map(id => applySeaFind(st, { id, type: 'sand', y: -3 }, 'guest', bag, 2));
  assert.equal(got.filter(Boolean).length, 3, '3 per day');
  for (const r of got.slice(0, 3)) { assert.equal(r.ok, true); assert.ok(byId(r.kind).where.includes('sea')); assert.notEqual(r.kind, 'crown'); }
  assert.deepEqual(applySeaFind(stFor(1), { id: ids[0], type: 'sand', y: -3 }, 'host', bag, 2)?.kind, got[0].kind, 'deterministic kind');
  assert.equal(st.sea.n, 3);
  assert.ok(applySeaFind(st, { id: ids[3], type: 'sand', y: -3 }, 'host', bag, 3, { force: true }), 'new day resets');
  assert.deepEqual(st.sea, { day: 3, n: 1, p: 0 });
  // deep finds may give a crown, shallow never
  let crown = 0;
  for (let i = 0; i < 3000; i++) { const s = DEFAULTS(); const r = applySeaFind(s, { id: `${i},1`, type: 'sand', y: -8 }, 'host', bagWith(), 0, { force: true }); if (r.kind === 'crown') crown++; }
  assert.ok(crown > 0);
  // daily payout cap of 3 with no island in view
  const sd = DEFAULTS(); for (const s of SHELLS) sd.book[s.id] = { n: 1, day: 0, by: 'host' }; sd.sets = SETS.map(s => s.id);
  const pb = bagWith(); for (let i = 0; i < 3; i++) applySeaFind(sd, { id: `${i},5`, type: 'sand', y: -8 }, 'host', pb, 9, { force: true });
  assert.ok(pb.count('shell') <= 3 && pb.count('shell') >= 1, `paid ${pb.count('shell')}`);
});

// ---------------------------------------------------------------- book view + html
test('bookView + shellsBookHTML: badge, silhouettes, set rows, escaped text', () => {
  const st = DEFAULTS(); st.book.button = { n: 3, day: 1, by: 'guest' }; st.book.pearl = { n: 1, day: 0, by: 'host' }; st.sets = [];
  const v = bookView(st);
  assert.equal(v.badge, '2/12'); assert.equal(v.cards.length, 12); assert.equal(v.sets.length, 4);
  const sig1 = v.sig; st.book = { ...st.book, button: { n: 4, day: 1, by: 'guest' } };
  assert.notEqual(bookView(st).sig, sig1);
  const html = B.shellsBookHTML(v);
  assert.equal((html.match(/class="sb-card/g) || []).length, 12);
  assert.equal((html.match(/sb-unknown/g) || []).length, 10);
  assert.match(html, /Button Cockle/); assert.match(html, /First found on day 2 by Guest/);
  assert.match(html, /Tidepool Set<\/b> 1\/4 · gift: 3 Bright Shells/);
  assert.doesNotMatch(html, /Sunfan Scallop/, 'unknown names hidden');
  assert.match(html, /Found while diving/);
  const v2 = bookView({ ...st, sets: ['tidepool'] });
  assert.match(B.shellsBookHTML(v2), /Gift received/);
  for (const s of SHELLS) { assert.match(B.shellSvg(s.id, true), /^<svg[^>]*viewBox="0 0 48 48"/); assert.match(B.shellSvg(s.id, false), /currentColor/); }
  assert.doesNotThrow(() => B.shellsBookHTML(null));
});

// ---------------------------------------------------------------- wiring
test('wiring: FEATURES order, observe hook, PRELOAD, craft-book text, build specifiers', () => {
  const con = readFileSync(resolve(dist, 'content.js'), 'utf8'), game = readFileSync(resolve(dist, 'game.js'), 'utf8'), live = readFileSync(resolve(dist, 'live.js'), 'utf8');
  const feats = con.match(/const FEATURES = \[([^\]]+)\]/)[1].split(',').map(s => s.trim());
  assert.equal(feats.indexOf('createShells'), feats.indexOf('createTreasure') + 1);
  assert.match(game, /content\?\.observe\(\{kind:'divegather', type:n\.type, id:n\.id, y:n\.y\}, actor\); \/\/ \[shells\]/);
  for (const f of ['shells-rules.js', 'shells-book.js', 'shells.js']) assert.ok(live.includes(`'${f}'`), f);
  assert.match(ITEM_TEXT?.shell?.how ?? readFileSync(resolve(dist, 'craft-book.js'), 'utf8'), /shell sparkles on island beaches/);
  const tok = con.match(/'\.\/islands\.js(\?build=[^']+)'/)[1];
  assert.ok(readFileSync(resolve(dist, 'shells.js'), 'utf8').includes(`'./islands.js${tok}'`), 'same islands instance');
});

// ---------------------------------------------------------------- module with a stub ctx
function stubWorld(role = 'solo') {
  const physics = new PlayerPhysics({ x: 0, y: 0.2 + PC.EYE_OFFSET, z: 0 });
  const emits = [];
  const bag = bagWith(), guestBag = bagWith();
  const dn = { night: 0, storm: 0, rain: 0 };
  const sit = { seated: () => false };
  const peer = name => (name === 'daynight' ? dn : name === 'sit' ? sit : null);
  const ctx = {
    T, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1, 0.05, 200),
    ocean: { mesh: { position: { y: -0.24 } }, getHeight: () => -0.24 },
    world: { tiles: [[0, 0]] }, role, running: true, physics, other: null, sent: [],
    localBag: () => bag, actorBag: a => (a === 'guest' ? guestBag : bag), uiOpen: () => false, dayIndex: () => 4,
    emit: (e, to) => emits.push({ e, to }),
    action: a => { ctx.sent.push(a); if (ctx.role === 'guest') return true; isl.action(a, 'host', bag) || sh.action(a, 'host', bag); return true; },
  };
  const isl = I.createIslands(ctx), sh = createShells(ctx, peer);
  return { ctx, isl, sh, bag, guestBag, physics, emits, dn, sit, dispose() { sh.dispose(); isl.dispose(); } };
}

test('module: host seeding, prompt + E take, toasts, serialize cache, logbook tab, new island resets', () => {
  const w = stubWorld();
  w.isl.debug.spawnNear(1234, 30); w.isl.update(0); w.sh.update(1 / 60);
  const st = w.sh.debug.state();
  assert.equal(st.seed, 1234); assert.deepEqual(st.taken, sparklesFor(1234).map(() => 0));
  assert.equal(w.sh.serialize(), w.sh.serialize(), 'cached serialize object');
  const meshes = []; w.ctx.scene.getObjectByName('shells').traverse(o => { if (o.isMesh || o.isPoints) meshes.push(o); });
  assert.equal(meshes.length, 2, 'one InstancedMesh + one Points');
  const s = sparklesFor(1234)[0], r = Math.hypot(s.x, s.z);
  assert.equal(w.isl.debug.teleportAshore(s.x - s.x / r * 1.0, s.z - s.z / r * 1.0), true);
  w.sh.update(0);
  assert.equal(w.sh.prompt(), '<kbd>E</kbd> Pick up shell');
  // other E owners win: spade held, seated
  w.bag.slots[0] = { kind: 'spade', count: 1, durability: 100 }; w.bag.select(0);
  assert.equal(w.sh.prompt(), null); assert.equal(w.sh.interact(), false);
  w.bag.slots[0] = null;
  w.sit.seated = () => true; assert.equal(w.sh.interact(), false); w.sit.seated = () => false;
  const ser0 = w.sh.serialize();
  assert.equal(w.sh.interact(), true);
  assert.equal(w.sh.debug.state().taken[0], 1);
  assert.notEqual(w.sh.serialize(), ser0, 'serialize rebuilt after a change');
  const kind = Object.keys(w.sh.debug.state().book)[0];
  assert.ok(w.emits.some(x => x.e.text === `New shell! ${byId(kind).name} is in the Shell Book`));
  assert.equal(w.sh.prompt(), null, 'taken sparkle no longer prompts');
  // logbook tab
  const tabs = []; w.sh.logbookTabs(tabs);
  assert.equal(tabs.length, 1); assert.equal(tabs[0].id, 'shells'); assert.equal(tabs[0].label, 'Shells');
  const v = tabs[0].view(); assert.equal(v.badge, '1/12'); assert.equal(tabs[0].view(), v, 'view cached until a change');
  assert.match(tabs[0].render(v), /sb-grid/);
  // day stored for the find
  assert.equal(w.sh.debug.state().book[kind].day, 4);
  // dive find through observe
  w.sh.debug.forceSea(true);
  w.sh.observe({ kind: 'divegather', type: 'sand', id: '10,10', y: -8 }, 'guest');
  w.sh.debug.forceSea(false);
  assert.equal(w.sh.debug.state().sea.n, 1);
  w.sh.observe({ kind: 'gather' }, 'host');
  // new island resets sparkles and paid, keeps the book
  const book = w.sh.debug.state().book;
  w.isl.debug.spawnNear(999, 30); w.isl.update(0); w.sh.update(1 / 60);
  const st2 = w.sh.debug.state();
  assert.equal(st2.seed, 999); assert.ok(st2.taken.every(t => t === 0)); assert.equal(st2.paid, 0);
  assert.deepEqual(st2.book, book);
  // save round trip
  const saved = JSON.parse(JSON.stringify(w.sh.serialize()));
  const w2 = stubWorld(); w2.sh.load(saved, 'save');
  assert.deepEqual(w2.sh.debug.state().book, book);
  w2.sh.load(undefined, 'save'); assert.deepEqual(w2.sh.debug.state().book, {});
  w2.dispose(); w.dispose();
});

test('module: guest sends shells.take, host pays the guest bag at the guest pose; net loads stay cheap', () => {
  const h = stubWorld('host');
  h.isl.debug.spawnNear(1234, 30); h.isl.update(0); h.sh.update(1 / 60);
  const now = I.islandNow(), s = sparklesFor(1234)[1];
  const hostBefore = JSON.stringify(h.bag.snapshot());
  h.isl.debug.teleportAshore(s.x, s.z); // host stands on it: must not count for the guest
  h.ctx.other = { x: now.cx + s.x + 6, z: now.cz + s.z };
  assert.equal(h.sh.action({ kind: 'shells.take', seed: 1234, spot: 1 }, 'guest', h.guestBag), true);
  assert.equal(h.sh.debug.state().taken[1], 0);
  assert.deepEqual(h.emits.at(-1), { e: { kind: 'notice', text: 'Get a little closer' }, to: 'guest' });
  h.ctx.other = { x: now.cx + s.x + 1.2, z: now.cz + s.z };
  h.sh.action({ kind: 'shells.take', seed: 1234, spot: 1 }, 'guest', h.guestBag);
  const hs = h.sh.debug.state();
  assert.equal(hs.taken[1], 1);
  assert.equal(Object.values(hs.book)[0].by, 'guest');
  assert.ok(h.emits.some(x => x.to === 'guest' && /^New shell!/.test(x.e.text)));
  assert.equal(JSON.stringify(h.bag.snapshot()), hostBefore, 'host bag untouched');
  // double take refused
  h.sh.action({ kind: 'shells.take', seed: 1234, spot: 1 }, 'guest', h.guestBag);
  assert.equal(h.emits.at(-1).e.text, 'Someone already picked that one up');
  assert.equal(h.sh.action({ kind: 'shells.take', seed: 4321, spot: 0 }, 'guest', h.guestBag), true);
  assert.equal(h.emits.at(-1).e.text, 'The island drifted off');
  h.dispose();

  // guest: never seeds itself, sends the action, follows host state; same net data does not resync meshes
  const g = stubWorld('host'); // islands only spawn on the host; then this world turns guest
  g.isl.debug.spawnNear(1234, 30); g.isl.update(0); g.ctx.role = 'guest';
  const slice = JSON.parse(JSON.stringify(hs));
  g.sh.load(slice, 'net'); g.sh.update(1 / 60);
  assert.equal(g.sh.debug.state().seed, 1234);
  const syncs = g.sh.debug.syncs();
  for (let i = 0; i < 20; i++) { g.sh.load(JSON.parse(JSON.stringify(slice)), 'net'); g.sh.update(1 / 60); }
  assert.equal(g.sh.debug.syncs(), syncs, 'unchanged net loads do not touch the sparkle meshes');
  assert.equal(g.sh.action({ kind: 'shells.take', seed: 1234, spot: 0 }, 'guest', g.bag), true);
  assert.equal(g.sh.debug.state().taken[0], 0, 'guest action handler never mutates');
  const s0 = sparklesFor(1234)[0], r0 = Math.hypot(s0.x, s0.z);
  g.isl.debug.teleportAshore(s0.x - s0.x / r0, s0.z - s0.z / r0); g.sh.update(0);
  assert.equal(g.sh.interact(), true);
  assert.deepEqual(g.ctx.sent.at(-1), { kind: 'shells.take', seed: 1234, spot: 0 });
  assert.equal(g.sh.prompt(), null, 'pressed sparkle hides while the host answers');
  g.sh.load({ ...slice, taken: slice.taken.map((t, i) => (i === 0 ? 1 : t)) }, 'net');
  assert.equal(g.sh.debug.state().taken[0], 1);
  assert.ok(g.sh.debug.syncs() > syncs);
  g.dispose();
});

test('content registry: logbookTabs fan-out includes the shells tab', async () => {
  const { createContent } = await import(new URL('content.js' + BUILD, base));
  const fake = name => () => ({ name, logbookTabs: out => out.push({ id: name, label: name, view: () => ({ sig: 1, html: '' }) }) });
  const c = createContent({}, [fake('aaa'), () => createShells({ T, scene: null, role: 'solo', running: false, localBag: () => null }, () => null)]);
  const list = c.logbookTabs();
  assert.deepEqual(list.map(t => t.id), ['aaa', 'shells']);
  assert.equal(list.find(t => t.id === 'shells').view().badge, '0/12');
  c.dispose();
});

test('module: a host take that fails (bag full) does not hide the sparkle', () => {
  const w = stubWorld();
  w.isl.debug.spawnNear(1234, 30); w.isl.update(0); w.sh.update(1 / 60);
  w.sh.debug.fill();
  for (let i = 0; i < w.bag.slots.length; i++) w.bag.slots[i] = { kind: 'stone', count: 20 };
  const s = sparklesFor(1234)[0], r = Math.hypot(s.x, s.z);
  assert.equal(w.isl.debug.teleportAshore(s.x - s.x / r * 1.0, s.z - s.z / r * 1.0), true);
  w.sh.update(0);
  assert.equal(w.sh.interact(), true);
  assert.equal(w.emits.at(-1).e.kind, 'full');
  assert.equal(w.sh.debug.state().taken[0], 0);
  assert.equal(w.sh.prompt(), '<kbd>E</kbd> Pick up shell', 'still there to take once there is room');
  w.dispose();
});
