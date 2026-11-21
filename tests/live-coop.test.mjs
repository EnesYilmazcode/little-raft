// Regression tests for co-op liveness, save revisions and live-update decisions (dist/session-rules.js).
// Run: node --test tests/live-coop.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const R = await import(new URL('session-rules.js', base));
const src = name => readFileSync(new URL(name, base), 'utf8');

// ------------------------------------------------------------- LIVE-2

test('peerStale: a hidden peer is never timed out; a visible one only after the long timeout', () => {
  assert.ok(R.NET_STALE_MS >= 20000);
  assert.equal(R.peerStale(10_000, 0, false), false, 'a 10 s alt-tab no longer drops the session');
  assert.equal(R.peerStale(R.NET_STALE_MS + 1, 0, false), true);
  assert.equal(R.peerStale(10 * 60_000, 0, true), false, 'hidden peer: rely on the close event');
  assert.equal(R.peerStale(5000, 0, false, 4000), true);
});

test('wallTick: fires by elapsed wall-clock time, not by frame count', () => {
  // At 2 fps the capped dt (0.05 s) would need 60 frames = 30 s for a 3 s autosave; wall time needs 3 s.
  let last = 0, fired = 0;
  for (let now = 500; now <= 9000; now += 500) { const t = R.wallTick(now, last, 3000); last = t.next; if (t.due) fired++; }
  assert.equal(fired, 3);
  assert.deepEqual(R.wallTick(100, 0, 120), {due:false, next:0});
  assert.deepEqual(R.wallTick(120, 0, 120), {due:true, next:120});
});

test('game.js: heartbeat runs on a timer and peers announce hidden/visible', () => {
  const g = src('game.js');
  assert.match(g, /setInterval\(pulse, HEARTBEAT_MS\)/);
  assert.match(g, /clearInterval\(heartbeat\)/);
  assert.match(g, /type:document\.hidden \? 'hidden' : 'visible'/);
  assert.doesNotMatch(g, /> 8000/, 'old 8 s frame-only timeout is gone');
  assert.doesNotMatch(g, /saveClock \+= dt|networkTick \+= dt/, 'send/save timers do not count capped dt');
});

// ------------------------------------------------------------- LIVE-3

test('game.js: saves when the page is hidden or hidden for good', () => {
  const g = src('game.js');
  assert.match(g, /on\(document, 'visibilitychange'[\s\S]{0,200}document\.hidden && running\) save\(\)/);
  assert.match(g, /on\(window, 'pagehide', \(\) => \{ if \(running\) save\(\); \}\)/);
});

// ------------------------------------------------------------- LIVE-6

test('saveRevision: reads rev from a save; old or broken saves are 0', () => {
  assert.equal(R.saveRevision(JSON.stringify({tiles:[[0, 0]], rev:7})), 7);
  assert.equal(R.saveRevision(JSON.stringify({tiles:[[0, 0]]})), 0);
  assert.equal(R.saveRevision('{bad'), 0);
  assert.equal(R.saveRevision(null), 0);
  assert.equal(R.saveRevision(JSON.stringify({rev:-3})), 0);
});

test('planSave: never overwrites a newer save from another tab', () => {
  assert.deepEqual(R.planSave(null, 0), {ok:true, stored:0, rev:1});
  assert.deepEqual(R.planSave(JSON.stringify({rev:4}), 4), {ok:true, stored:4, rev:5});
  assert.equal(R.planSave(JSON.stringify({rev:5}), 4).ok, false, 'tab B (base 4) must not clobber tab A (rev 5)');
  assert.equal(R.planSave(JSON.stringify({tiles:[]}), 3).ok, true, 'legacy save without rev');
});

test('two tabs: the first to save wins, the other stops instead of overwriting', () => {
  const store = {v:JSON.stringify({rev:2})};
  const tab = () => ({base:R.saveRevision(store.v), blocked:false, save(world) {
    if (this.blocked) return false;
    const p = R.planSave(store.v, this.base); if (!p.ok) { this.blocked = true; return false; }
    store.v = JSON.stringify({world, rev:p.rev}); this.base = p.rev; return true;
  }});
  const a = tab(), b = tab();
  assert.equal(a.save('A1'), true); assert.equal(a.save('A2'), true);
  assert.equal(b.save('B-stale'), false); assert.equal(b.blocked, true);
  assert.equal(JSON.parse(store.v).world, 'A2');
});

test('game.js: guest join does not save over a newer save, and leaving does not restore a stale backup over it', () => {
  const g = src('game.js');
  assert.match(g, /if \(storedRev\(\) <= saveRev\) save\(\);/);
  assert.match(g, /const plan = guestLeavePlan\(storedRev\(\), saveRev\);[\s\S]{0,300}\(plan\.useBackup \? normaliseBackup\(ownWorldBackup\) : null\) \?\? savedOwnRaft\(\)/);
  assert.match(g, /on\(window, 'storage'/);
  assert.match(g, /rev:plan\.rev, savedAt:Date\.now\(\)/);
});

// ------------------------------------------------------------- LIVE-1

test('liveDecision: unknown or different protocol is next-session; the running build is current', () => {
  const run = {build:'v3-a', protocol:1};
  assert.equal(R.liveDecision(run, {build:'v3-a', protocol:2}), 'current');
  assert.equal(R.liveDecision(run, {build:'v4-b', protocol:1}), 'swap');
  assert.equal(R.liveDecision(run, {build:'v4-b', protocol:2}), 'next-session');
  assert.equal(R.liveDecision({build:'v3-a', protocol:null}, {build:'v4-b', protocol:1}), 'next-session', 'never adopt the manifest protocol');
  assert.equal(R.liveDecision({build:null, protocol:null}, {build:'v4-b', protocol:1}), 'next-session');
  assert.equal(R.liveDecision({build:null, protocol:null}, {build:'v4-b', protocol:1}, false), 'swap', 'failed boot: load whatever is current');
});

test('buildFromUrl: reads the stamped build from the game.js URL', () => {
  assert.equal(R.buildFromUrl('https://x/dist/game.js?build=v3-survival-ae77fa84ac2b'), 'v3-survival-ae77fa84ac2b');
  assert.equal(R.buildFromUrl('https://x/dist/game.js'), null);
  assert.equal(R.buildFromUrl('nonsense'), null);
});

test('live.js and game.js: boot build/protocol are known independently of a later manifest', () => {
  const l = src('live.js'), g = src('game.js');
  assert.doesNotMatch(l, /state\.protocol = manifest\.protocol; \/\/ unversioned boot/);
  assert.doesNotMatch(l, /if \(state\.protocol == null\) state\.protocol = manifest\.protocol/);
  assert.match(l, /buildFromUrl\(moduleUrl\(null\)\)/);
  assert.match(l, /engineProtocol\(mod\)/);
  assert.match(g, /export \{ PROTOCOL \}/);
  const manifest = JSON.parse(src('version.json'));
  assert.equal(R.PROTOCOL, manifest.protocol, 'session-rules PROTOCOL matches the published manifest');
});
