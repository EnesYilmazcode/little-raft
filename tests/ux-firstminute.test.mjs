// First-minute UX: unlock notes stay readable, look/walk hints defer to the Notes, early bag step, quieter HUD chips.
// Run: node --test tests/ux-firstminute.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(new URL(f, base), 'utf8');
const { clipWords } = await import(new URL('pickup-feed.js', base));
const { unlockText } = await import(new URL('progression-hooks.js', base));
const H = await import(new URL('hud.js', base));
const O = await import(new URL('onboarding.js', base));

test('unlock notes list at most three names, then a count and the craft key', () => {
  assert.equal(unlockText(['Bench']), 'New recipe: Bench!');
  assert.equal(unlockText(['A', 'B', 'C']), 'New recipes: A, B and C!');
  const t = unlockText(['Fishing Rod', 'Bench', 'Net', 'Small Crate', 'Lantern']);
  assert.equal(t, 'New recipes: Fishing Rod, Bench, Net +2 more · Tab to craft');
  assert.ok(t.length <= 90);
});

test('feed notes clip at a word boundary with an ellipsis', () => {
  assert.equal(clipWords('short', 90), 'short');
  const long = 'New recipes: Fishing Rod, Bench, Net, Lantern, Storage Crate, Palm Planter, Grill, Small Crate';
  const c = clipWords(long, 90);
  assert.ok(c.length <= 90 && c.endsWith('…'));
  assert.ok(long.startsWith(c.slice(0, -1)));
  assert.equal(long[c.length - 1], ' '); // the next char after the kept text is a space: no half words
  assert.equal(clipWords('x'.repeat(200), 90).length, 90);
});

test('look and walk hints stay quiet while the Notes teach chapter one', () => {
  const done = new Set();
  assert.equal(H.nextHint(done, { heldKind: 'hook' })?.id, 'look'); // no checklist: the hint chain teaches
  globalThis.raftOnboarding = { state: () => ({ chapter: 'ch1' }) };
  try {
    assert.equal(H.checklistTeaching(1e9), true);
    assert.equal(H.nextHint(done, { heldKind: 'hook' }), null);
    globalThis.raftOnboarding = { state: () => ({ chapter: 'ch2' }) };
    assert.equal(H.checklistTeaching(2e9), false);
  } finally { delete globalThis.raftOnboarding; H.checklistTeaching(3e9); }
});

test('the bag step shows in the first minute, right after look and walk', () => {
  const steps = O.STEPS.map(s => ({ ...s })), P = O.createProgress(['look', 'walk']);
  const S = { running: true, role: 'solo', tiles: 4, collected: 0, stock: { hook: 1 }, ownedTools: ['hook'], hookStage: 'idle', inventoryOpen: false, me: { x: 0, z: 0, yaw: 0 } };
  const r = O.evaluate(steps, P, S);
  assert.deepEqual(r.visible, ['throw', 'bag']);
  assert.match(r.hints.bag, /\[Tab\].*Rope/);
});

test('fish chip reads as a journal; no-sail chip also waits for a hammer or a built tile', () => {
  assert.match(src('fishing-cooking.js'), /Fish journal \$\{n\}/);
  assert.match(src('sailing-ui.js'), /ownedTools\.includes\('hammer'\)/);
  assert.match(src('sailing-ui.js'), /info\.sailKnown === false \|\| !builder\(\)/);
});
