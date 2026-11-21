// Round-2 regression tests for pointer lock and Escape (cursor must never escape during play).
// Run: node --test tests/lock-r2.test.mjs   (browser repro: python tests/e2e/esc-relock.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const rules = await import(new URL('lock-rules.js', base));

test('LOCK-1: a browser Escape keyup while running is preventDefaulted and defers the relock', () => {
  assert.deepEqual(rules.escReleasePlan({ running: true, pending: true }), { preventDefault: true, relock: 'defer' });
  assert.deepEqual(rules.escReleasePlan({ running: true, pending: false }), { preventDefault: true, relock: null });
});

test('LOCK-1: the desktop shell release relocks synchronously (keeps its user gesture)', () => {
  assert.deepEqual(rules.escReleasePlan({ running: true, pending: true, fromShell: true }), { preventDefault: false, relock: 'now' });
});

test('LOCK-1: Escape keyups on the title screen are left alone', () => {
  assert.equal(rules.escReleasePlan({ running: false, pending: false }).preventDefault, false);
});

test('LOCK-2: body.relock ends on lock loss, lock error and after the timeout', () => {
  assert.equal(rules.relockPending({ elapsed: 0 }), true);
  assert.equal(rules.relockPending({ elapsed: 300 }), true);
  assert.equal(rules.relockPending({ event: 'unlocked', elapsed: 50 }), false, 'granted then revoked');
  assert.equal(rules.relockPending({ event: 'error', elapsed: 50 }), false, 'refused');
  assert.equal(rules.relockPending({ elapsed: rules.RELOCK_TIMEOUT }), false, 'timed out');
  assert.equal(rules.relockPending({ locked: true }), false, 'lock arrived');
  assert.ok(rules.RELOCK_TIMEOUT >= 400 && rules.RELOCK_TIMEOUT <= 1000);
});

test('LOCK-3: holding the Escape that ended the lock for 2.4 s still opens pause on release', () => {
  const g = rules.createEscGate();
  g.lockLost(0); // Chrome swallowed the first keydown to exit the lock
  for (let t = 500; t <= 2400; t += 80) g.keydown(t, { repeat: true });
  assert.equal(g.keyupOpensPause(2400), true);
  const quick = rules.createEscGate(); quick.lockLost(0);
  assert.equal(quick.keyupOpensPause(120), true);
});

test('LOCK-3: repeats with no recent lock loss do not invent one', () => {
  const g = rules.createEscGate();
  for (let t = 0; t <= 2400; t += 80) g.keydown(t, { repeat: true });
  assert.equal(g.keyupOpensPause(2400), false);
});

test('LOCK-3: an unhandled keyup while the page still holds the lock pauses (lock loss reported late)', () => {
  const g = rules.createEscGate();
  for (let t = 0; t <= 2400; t += 80) g.keydown(t, { repeat: true });
  assert.equal(g.keyupOpensPause(2400, { locked: true }), true);
  const unlocked = rules.createEscGate();
  assert.equal(unlocked.keyupOpensPause(2400, { locked: false }), false, 'no lock and no recent loss');
});

test('LOCK-3: holding Esc after it closed the inventory still never pauses', () => {
  const g = rules.createEscGate();
  g.lockLost(0, { selfCaused: true });
  g.keydown(200, { handled: true });
  for (let t = 230; t < 2600; t += 33) g.keydown(t, { repeat: true });
  assert.equal(g.keyupOpensPause(2600, { locked: true }), false, 'handled press never pauses, even after a relock');
});

test('LOCK-4: drag-look applies while running without a usable lock', () => {
  assert.equal(rules.dragLook({ running: true, fallback: true }), true);
  assert.equal(rules.dragLook({ running: true, supported: false }), true);
  assert.equal(rules.dragLook({ running: true }), false);
  assert.equal(rules.dragLook({ running: false, fallback: true }), false);
});

test('LOCK-4: the relock CSS never hides the cursor or hint in drag-look', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('settings.js', base), 'utf8');
  const rules = css.split('\n').filter(l => /^body\.relock/.test(l));
  assert.ok(rules.length >= 2);
  for (const r of rules) assert.match(r, /^body\.relock:not\(\.drag-look\) /, r);
});
