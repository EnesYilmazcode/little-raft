// Round 2 regression tests for saves across tabs, hot-swap globals and co-op hook claims.
// Run: node --test tests/net-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const S = await import(new URL('session-rules.js', base));
const src = name => readFileSync(new URL(name, base), 'utf8');
const raw = rev => JSON.stringify({rev, tiles:[]});

test('NET-1: a tab on the title is not save-blocked by another tab, but a playing tab is', () => {
  assert.equal(S.storageBlocks({running:false, role:'solo', newRaw:raw(13), baseRev:5}), false);
  assert.equal(S.storageBlocks({running:true, role:'solo', newRaw:raw(13), baseRev:5}), true);
  assert.equal(S.storageBlocks({running:true, role:'host', newRaw:raw(13), baseRev:5}), true);
  assert.equal(S.storageBlocks({running:true, role:'guest', newRaw:raw(13), baseRev:5}), false);
  assert.equal(S.storageBlocks({running:true, role:'solo', newRaw:raw(5), baseRev:5}), false);
});

test('NET-1: leaving the title adopts a newer stored save; New game writes over it', () => {
  assert.equal(S.adoptOnStart({running:false, role:'solo', storedRev:13, saveRev:5}), true);
  assert.equal(S.adoptOnStart({running:false, role:'host', storedRev:13, saveRev:5}), true);
  assert.equal(S.adoptOnStart({running:false, role:'guest', storedRev:13, saveRev:5}), false);
  assert.equal(S.adoptOnStart({running:true, role:'solo', storedRev:13, saveRev:5}), false);
  assert.equal(S.adoptOnStart({running:false, role:'solo', storedRev:5, saveRev:5}), false);
  // New game takes the stored rev as its base, so its first save is allowed and is newer than tab A's.
  const rev = S.newGameBaseRev(13, 5);
  const plan = S.planSave(raw(13), rev);
  assert.equal(plan.ok, true); assert.equal(plan.rev, 14);
  assert.equal(S.newGameBaseRev(0, 0), 0);
});

test('NET-1: game.js wires the title rules into the storage listener, start() and newGame()', () => {
  const g = src('game.js');
  assert.match(g, /storageBlocks\(\{running, role, newRaw:e\.newValue, baseRev:saveRev\}\)/);
  assert.match(g, /function start\(\) \{\s*if \(adoptOnStart\(/);
  assert.match(g, /saveRev = newGameBaseRev\(storedRev\(\), saveRev\); unblockSave\(\);[^\n]*\n\s*save\(\); start\(\);/);
});

test('Title save status: inline on the title card, never a popup', () => {
  assert.equal(S.titleSaveNote({}), '');
  assert.match(S.titleSaveNote({storedRev:13, saveRev:5}), /another tab/);
  assert.match(S.titleSaveNote({blocked:true, storedRev:5, saveRev:5}), /stopped saving/);
  assert.match(S.titleSaveNote({available:false}), /unavailable/);
  const html = src('index.html');
  const card = html.slice(html.indexOf('<section class="welcome-card">'), html.indexOf('</section>'));
  assert.match(card, /<small id="titleSaveStatus"[^>]*role="status"[^>]*hidden>/);
  const css = src('style.css');
  const rule = /\.title-save\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.ok(rule, '.title-save rule exists');
  assert.doesNotMatch(rule, /position:\s*(fixed|absolute)/);
  assert.match(src('game.js'), /titleSaveNote\(\{available:saveAvailable, blocked:saveBlocked, storedRev:storedRev\(\), saveRev\}\)/);
});

test('NET-2: restoreGlobal puts back what a failed mount replaced, never over a newer owner', () => {
  const oldShell = {hold(){}}, failed = {hold(){}}, newer = {hold(){}};
  const w = {raftShell:oldShell};
  const prev = Object.getOwnPropertyDescriptor(w, 'raftShell');
  w.raftShell = failed; delete w.raftShell; // the failed mount's dispose() deletes its own shellApi
  assert.equal(S.restoreGlobal(w, 'raftShell', prev, failed), true);
  assert.equal(w.raftShell, oldShell);
  w.raftShell = failed;
  assert.equal(S.restoreGlobal(w, 'raftShell', prev, failed), true);
  assert.equal(w.raftShell, oldShell);
  w.raftShell = newer;
  assert.equal(S.restoreGlobal(w, 'raftShell', prev, failed), false);
  assert.equal(w.raftShell, newer);
  const fresh = {raftEscape:() => {}};
  assert.equal(S.restoreGlobal(fresh, 'raftEscape', undefined, fresh.raftEscape), true);
  assert.equal('raftEscape' in fresh, false);
});

test('NET-2: the failed-mount path and settings.destroy() restore raftShell and raftEscape', () => {
  const g = src('game.js'), st = src('settings.js');
  const catchBlock = g.slice(g.indexOf('} catch (e) {\n    console.error(e); dispose();'));
  assert.match(catchBlock, /restoreGlobal\(window, 'raftShell', previousShell, shellApi\)/);
  assert.match(catchBlock, /restoreGlobal\(window, 'raftEscape', previousEscape/);
  assert.ok(g.indexOf("previousShell = Object.getOwnPropertyDescriptor(window, 'raftShell')") < g.indexOf('window.raftShell = shellApi'));
  assert.match(st, /destroy\(\) \{[^]*restoreGlobal\(window, 'raftEscape', previousEscape, raftEscape\)/);
});

const T = await import(new URL('vendor/three.module.js', base));
const { HookCast } = await import(new URL('hook-physics.js', base));
const { hookableItems, cleanHeldTokens } = await import(new URL('coop-rules.js', base));

test('NET-3: hookableItems skips the other player\'s catch but keeps our own', () => {
  const items = [{id:1, token:'a', x:0, z:-4}, {id:2, token:'b', x:0, z:-5}, {id:3, token:'c', x:0, z:-6}];
  const ids = l => l.map(it => it.token).join();
  assert.equal(ids(hookableItems(items, {otherHeld:new Set(['a', 'b']), ownHeld:new Set(['a'])})), 'a,c');
  assert.equal(ids(hookableItems(items, {isPending:it => it.token === 'c'})), 'a,b');
  assert.equal(ids(hookableItems(items)), 'a,b,c');
  assert.deepEqual(cleanHeldTokens(undefined), []); // older hosts send no held list
});

test('NET-3: the host keeps a plank on its hook even when the guest reports holding it too', () => {
  const cast = new HookCast(T, {origin:{x:0, y:1.45, z:0.6}, direction:{x:0, y:0, z:-1}, charge:0.5});
  for (let i = 0; i < 200 && cast.stage === 'flying'; i++) cast.update(1 / 60, {hand:{x:0, y:1.45, z:0.6}, items:[], time:i / 60});
  const plank = {id:7, token:'p7', type:'wood', x:cast.position.x, z:cast.position.z};
  cast.update(1 / 60, {hand:{x:0, y:1.45, z:0.6}, items:[plank], time:4});
  assert.deepEqual(cast.caughtItems.map(c => c.token), ['p7']);
  const own = new Set(cast.caughtItems.map(c => c.token)), guest = new Set(['p7']);
  cast.update(1 / 60, {hand:{x:0, y:1.45, z:0.6}, items:hookableItems([plank], {otherHeld:guest, ownHeld:own}), time:4.1});
  assert.deepEqual(cast.caughtItems.map(c => c.token), ['p7'], 'still on the host hook');
  cast.update(1 / 60, {hand:{x:0, y:1.45, z:0.6}, items:[plank].filter(it => !guest.has(it.token)), time:4.2}); // the old filter
  assert.deepEqual(cast.caughtItems, [], 'the old guest-only filter silently dropped it');
});

test('NET-3: host state carries its held tokens, the guest filters them, and a guest collect of them is refused', () => {
  const g = src('game.js');
  assert.match(g, /type:'state', v:3,[^\n]*held:\[\.\.\.ownHeldTokens\(\)\]/);
  assert.match(g, /hostHeld = new Set\(cleanHeldTokens\(data\.held\)\)/);
  assert.match(g, /otherHeldTokens = \(\) => \(role === 'guest' \? hostHeld :/);
  assert.match(g, /hook\.update\(dt, \{hand:handPos, items:hookableItems\(world\.items, \{isPending, otherHeld:otherHeldTokens\(\), ownHeld:ownHeldTokens\(\)\}\)/);
  assert.match(g, /if \(actor === 'guest' && !a\.net && ownHeldTokens\(\)\.has\(it\.token\)\) return;/);
});

test('NET-4: a guest leaving while the host tab saved newer stays blocked and keeps its old rev', () => {
  assert.deepEqual(S.guestLeavePlan(13, 5), {useBackup:false, block:true, saveRev:5});
  assert.deepEqual(S.guestLeavePlan(5, 5), {useBackup:true, block:false, saveRev:5});
  // With the old rev kept, this tab can never write over the host tab's save, so the host is never blocked by it.
  assert.equal(S.planSave(raw(14), S.guestLeavePlan(13, 5).saveRev).ok, false);
  const g = src('game.js'), body = g.slice(g.indexOf('function restoreOwnRaft()'), g.indexOf('function loadRaft('));
  assert.match(body, /guestLeavePlan\(storedRev\(\), saveRev\)/);
  assert.match(body, /if \(plan\.block\) blockSave\(\);/);
  assert.doesNotMatch(body, /saveBlocked = false|saveRev = storedRev\(\)/);
});

const H = await import(new URL('hud.js', base));

test('NET-5: New game resets the first-run hint chain and its stored copy', () => {
  const mem = {}, storage = {getItem:k => mem[k] ?? null, setItem:(k, v) => { mem[k] = v; }};
  const done = new Set(['throw', 'loot', 'bag', 'slots']); H.saveHints(storage, done);
  assert.equal(H.nextHint(done, {heldKind:'hook', castOut:false}), null);
  assert.equal(H.resetHints(storage, done), true);
  assert.equal(done.size, 0);
  assert.equal(H.loadHints(storage).size, 0);
  assert.equal(H.nextHint(done, {heldKind:'hook', castOut:false})?.id, 'throw');
  const g = src('game.js'), body = g.slice(g.indexOf('function newGame()'), g.indexOf('const hasSave'));
  assert.match(body, /saveStore\.reset\(\)/); // the save store's reset runs every part's reset, the hints included
  assert.match(g, /reset:\(\) => \{[^\n]*resetHints\(saveStore\.storage, hintsDone\)/);
});

// ---------- round 3: one save store for every per-save part (dist/save-store.js) ----------
const SS = await import(new URL('save-store.js', base));
const PH = await import(new URL('progression-hooks.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const OB = await import(new URL('onboarding.js', base));
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => m.delete(k) };
};
const emptyBag = () => new Bag({ slots: Array(SLOT_COUNT).fill(null), selected: 0 });
function progGame(store, { running = true, decor = [{ type: 'smelter', x: 0, z: 0 }] } = {}) {
  const world = { tiles: [[0, 0], [1, 0], [0, 1]], decor, items: [], collected: 1 };
  const bags = { host: emptyBag(), guest: emptyBag() };
  const ctx = { T: null, role: () => 'solo', ready: () => false, running: () => running, world: () => world, bag: a => bags[a],
    localBag: () => bags.host, action() {}, emit() {}, notice() {}, pose: () => ({ x: 50, z: 50, yaw: 0 }), storage: store.storage };
  return { world, bags, ctx };
}
// What game.js save() does: the world (with the bag) and every part in one guarded write.
const gameSave = (store, g, rev) => store.write({ tiles: g.world.tiles, decor: g.world.decor, hostInventory: g.bags.host.snapshot() }, rev);
const smelt = (p, g) => {
  g.bags.host.add('metalore', 3); g.bags.host.add('wood', 10);
  p.apply({ kind: 'prog:insert', key: '0,0', item: 'metalore', n: 3 }, 'host');
  p.apply({ kind: 'prog:fuel', key: '0,0', item: 'wood', n: 10 }, 'host');
};

test('r3 save store: parts ride inside the world save; part keys never touch real storage', () => {
  const real = memStorage(), store = SS.createSaveStore({ storage: real });
  store.storage.setItem(SS.PARTS.hints, '["throw"]');
  store.storage.setItem('little-raft-settings', '{"volume":1}'); // a profile key passes straight through
  assert.equal(real.getItem(SS.PARTS.hints), null, 'a part is never its own localStorage key');
  assert.equal(real.getItem('little-raft-settings'), '{"volume":1}');
  let flushed = 0; store.register('t', { flush: () => { flushed++; store.storage.setItem(SS.PARTS.pin, 'rope'); } });
  const r = store.write({ tiles: [[0, 0]] }, 0);
  assert.deepEqual(r, { ok: true, rev: 1 }); assert.equal(flushed, 1);
  const saved = JSON.parse(real.getItem(SS.SAVE_KEY));
  assert.equal(saved.rev, 1); assert.deepEqual(saved.parts, { hints: '["throw"]', pin: 'rope' });
  assert.deepEqual(SS.partsOf(real.getItem(SS.SAVE_KEY)).parts, { hints: '["throw"]', pin: 'rope' });
  // a failed hot-swap mount hands the hooks back to the old engine
  const off = store.register('t', { flush() {} }); off(); store.write({ tiles: [] }, 1); assert.equal(flushed, 2);
});

test('r3 NET-1: taking smelter output and closing the tab cannot duplicate it (bag and station share one write)', () => {
  const real = memStorage(), store = SS.createSaveStore({ storage: real });
  const g = progGame(store), p = PH.attachProgression(g.ctx);
  const unreg = store.register('game', { flush: () => p.save() });
  p.tick(0.016); smelt(p, g); p.debug.advance(400);
  assert.equal(p.debug.state().stations['0,0'].output?.count, 3);
  let rev = gameSave(store, g, 0).rev; // autosave: the ingots are in the smelter
  p.apply({ kind: 'prog:take', key: '0,0' }, 'host');
  assert.equal(g.bags.host.count('metalingot'), 3);
  rev = gameSave(store, g, rev).rev; // pagehide/beforeunload right after Take: one write, no 2 s progression clock
  p.dispose(); unreg();
  const saved = JSON.parse(real.getItem(SS.SAVE_KEY)), store2 = SS.createSaveStore({ storage: real }); // reload
  const g2 = progGame(store2), p2 = PH.attachProgression(g2.ctx); p2.tick(0.016);
  const out = p2.debug.state().stations['0,0'].output?.count ?? 0;
  assert.equal(new Bag(saved.hostInventory).count('metalingot') + out, 3, 'the ingots exist once: in the bag or the smelter, never both');
  p2.dispose();
  assert.equal(real.getItem(PH.PROGRESSION_KEY), null, 'progression never writes its own key');
});

test('r3 NET-2: a stale tab on the title neither cooks nor overwrites the playing tab', () => {
  const real = memStorage(), a = SS.createSaveStore({ storage: real });
  const ga = progGame(a), pa = PH.attachProgression(ga.ctx);
  a.register('game', { flush: () => pa.save() });
  pa.tick(0.016); smelt(pa, ga);
  let revA = gameSave(a, ga, 0).rev;
  // tab B opens on the title with this save
  const b = SS.createSaveStore({ storage: real }), gb = progGame(b, { running: false }), pb = PH.attachProgression(gb.ctx);
  b.register('game', { flush: () => pb.save() });
  const revB = JSON.parse(real.getItem(SS.SAVE_KEY)).rev;
  for (let i = 0; i < 200; i++) pb.tick(0.05);
  assert.equal(pb.debug.state().stations['0,0'].progress ?? 0, 0, 'no cooking while not running');
  pb.dispose(); // one node realm: hand the progression owner back to tab A (real tabs have one each)
  // tab A finishes and takes the ingots
  pa.debug.advance(400); pa.apply({ kind: 'prog:take', key: '0,0' }, 'host'); revA = gameSave(a, ga, revA).rev;
  const before = real.getItem(SS.SAVE_KEY);
  const r = gameSave(b, gb, revB); // B's beforeunload, or any other save path
  assert.equal(r.ok, false, 'B is refused by the revision guard'); assert.equal(real.getItem(SS.SAVE_KEY), before);
  const st = JSON.parse(JSON.parse(before).parts.prog).stations['0,0'];
  assert.equal(st.output ?? null, null); assert.equal(st.input ?? null, null);
  pa.dispose();
  const g = src('game.js'); // exactly one write path, through the store
  assert.match(g, /const r = saveStore\.write\(\{\.\.\.world, items:\[\]\}, saveRev\);/);
  assert.doesNotMatch(g, /localStorage\.setItem\(SAVE/);
  assert.match(src('progression-hooks.js'), /if \(ctx\.running\(\)\) for \(const st of stations\.values\(\)\)/);
});

test('r3 NET-3: New game resets every part; wipe() is the same reset and blocks later writes', () => {
  const real = memStorage(), store = SS.createSaveStore({ storage: real });
  const g = progGame(store), p = PH.attachProgression(g.ctx);
  store.register('game', { flush: () => p.save(), reset: () => p.reset() });
  p.tick(0.016); g.bags.host.add('metalore', 3); p.apply({ kind: 'prog:insert', key: '0,0', item: 'metalore', n: 3 }, 'host');
  p.progression('host').learned.add('metalingot');
  for (const n of ['fc', 'logbook', 'hints', 'onboarding', 'pin']) store.storage.setItem(SS.PARTS[n], n === 'logbook' ? '7' : '"x"');
  const rev = gameSave(store, g, 0).rev;
  store.reset();
  assert.equal(p.progression('host').isUnlocked('metalingot'), false, 'learned recipes do not carry over');
  for (const n of Object.keys(SS.PARTS)) if (n !== 'prog') assert.equal(store.storage.getItem(SS.PARTS[n]), null, n);
  p.tick(0.016);
  assert.equal(p.debug.state().stations['0,0'].input ?? null, null, 'a smelter on the same tile starts empty');
  gameSave(store, g, rev);
  assert.deepEqual(Object.keys(JSON.parse(real.getItem(SS.SAVE_KEY)).parts), ['prog']);
  p.dispose();
  // onboarding wipe(): reset({final}) deletes the save and refuses the beforeunload save that follows
  store.reset({ final: true });
  assert.equal(real.getItem(SS.SAVE_KEY), null);
  assert.equal(gameSave(store, g, 99).final, true); assert.equal(real.getItem(SS.SAVE_KEY), null);
  const ob = src('onboarding.js'), wipe = ob.slice(ob.indexOf('function wipe()'), ob.indexOf("menu.addEventListener('click'"));
  assert.match(wipe, /saves\.reset\(\{final:true\}\)/);
  const gm = src('game.js'), ng = gm.slice(gm.indexOf('function newGame()'), gm.indexOf('const hasSave'));
  assert.match(ng, /saveStore\.reset\(\);/);
});

test('r3 NET-3: legacy keys migrate once into an old save, and never seed a fresh raft', () => {
  const legacy = { [SS.PARTS.prog]: '{"v":1,"host":{}}', [SS.PARTS.logbook]: '4', [SS.PARTS.hints]: '["throw"]' };
  const real = memStorage({ [SS.SAVE_KEY]: JSON.stringify({ rev: 3, tiles: [] }), ...legacy }); // an old raft, no parts yet
  const store = SS.createSaveStore({ storage: real });
  assert.equal(store.legacy, true);
  assert.equal(store.storage.getItem(SS.PARTS.logbook), '4');
  assert.equal(store.write({ tiles: [] }, 3).ok, true);
  for (const k of Object.keys(legacy)) assert.equal(real.getItem(k), null, k);
  assert.deepEqual(JSON.parse(real.getItem(SS.SAVE_KEY)).parts, { prog: legacy[SS.PARTS.prog], logbook: '4', hints: '["throw"]' });
  const real2 = memStorage(legacy), fresh = SS.createSaveStore({ storage: real2 }); // leftovers, no world save: dropped
  assert.equal(fresh.storage.getItem(SS.PARTS.prog), null);
  for (const k of Object.keys(legacy)) assert.equal(real2.getItem(k), null, k);
});

test("r3 guest: a guest never writes; going home keeps its own parts; adopting a stored save loads that save's parts", () => {
  const real = memStorage(), store = SS.createSaveStore({ storage: real });
  store.storage.setItem(SS.PARTS.pin, 'own'); store.write({ tiles: [] }, 0);
  real.setItem(SS.SAVE_KEY, JSON.stringify({ rev: 9, tiles: [], parts: { pin: 'theirs' } })); // another tab saved
  let loads = 0; store.register('game', { load: () => loads++ });
  assert.equal(store.storage.getItem(SS.PARTS.pin), 'own', 'parts stay in memory until a save is adopted');
  store.loadAll(real.getItem(SS.SAVE_KEY));
  assert.equal(store.storage.getItem(SS.PARTS.pin), 'theirs'); assert.equal(loads, 1);
  const g = src('game.js');
  assert.match(g, /function save\(\) \{[^\n]*\n\s*if \(role === 'guest' \|\| disposed \|\| saveBlocked\) return;/);
  assert.match(g, /if \('raw' in b\) saveStore\.loadAll\(b\.raw\);/); // savedOwnRaft carries raw; an own-raft backup does not
  assert.doesNotMatch(g.slice(g.indexOf('function normaliseBackup'), g.indexOf('// ---------- Engine state')), /raw/);
});

test('r3 NET-4: the title menu is rebuilt from the stored save on every raft:title', () => {
  assert.doesNotMatch(OB.menuHTML({ hasSave: false }), /data-act="continue"/);
  const html = OB.menuHTML({ hasSave: true, summary: '9 tiles · 2 fish' });
  assert.match(html, /data-act="continue">Continue<small>9 tiles · 2 fish<\/small>/);
  assert.match(html, /data-act="new">New Game</);
  assert.match(OB.menuHTML({ hasSave: false, firstSail: true }), /data-act="new">Set sail</);
  const g = src('game.js'), rt = g.slice(g.indexOf('function refreshTitle()'), g.indexOf('function syncWorldInventories()'));
  assert.match(rt, /dispatchEvent\(new CustomEvent\('raft:title'/);
  const ob = src('onboarding.js');
  assert.match(ob, /document\.addEventListener\('raft:title', renderMenu\)/);
  assert.match(ob, /function renderMenu\(\) \{\s*const raw = store\.get\(SAVE_KEY\)/);
});

test('r3 fc: New game clears every grill but keeps the journal; reload adopts the stored part', async () => {
  const T = await import(new URL('vendor/three.module.js', base));
  const { createFishingCooking, FC_SAVE_KEY } = await import(new URL('fishing-cooking.js', base));
  globalThis.window ??= {};
  const real = memStorage(), store = SS.createSaveStore({ storage: real });
  const counts = { wood: 20, scrap: 6 };
  const bag = { count: k => counts[k] || 0, remove: (k, n) => ((counts[k] -= n), true), add: (k, n) => ((counts[k] = (counts[k] || 0) + n), 0), emit() {} };
  const scene = new T.Scene(), raft = new T.Group(); scene.add(raft);
  let fc = null;
  const h = { scene, raft, camera: new T.PerspectiveCamera(), ocean: { getHeight: () => 0, getSlope: () => ({ x: 0, z: 0 }) }, signal: new AbortController().signal,
    rodModel: new T.Group(), role: () => 'solo', netReady: () => false, send() {}, notice() {}, beep() {}, selectedKind: () => 'fishingrod',
    aim: () => null, rodTip: () => null, player: () => ({ x: 0, y: 0, z: 0, yaw: 0 }), hasTile: () => true, decorAt: () => false,
    bagCount: k => counts[k] || 0, running: () => true, uiBlocked: () => false, busy: () => false, storage: store.storage,
    action: a => { fc.applyAction(a, 'host', bag); return true; } };
  fc = createFishingCooking(T, h);
  h.action({ kind: 'fc:placeGrill', x: 0, z: 0 });
  assert.equal(fc.grills.size, 1);
  fc.save(); assert.equal(real.getItem(FC_SAVE_KEY), null, 'fc writes only into its part');
  store.storage.setItem(FC_SAVE_KEY, JSON.stringify({ v: 1, journal: {}, grills: [{ id: 'z', x: 1, z: 1 }] }));
  fc.reload(); assert.deepEqual([...fc.grills.keys()], ['z']);
  fc.journal.recordCatch({ species: 'salmon', cm: 60, stars: 2 });
  fc.reset({ keepJournal: true });
  assert.equal(fc.grills.size, 0);
  assert.ok(Object.keys(fc.journal.species).length > 0, 'journal kept');
  fc.dispose();
});
