// Unit tests for the HUD helpers: edge notice queue, sound preference, drag look, first-run hints.
// Run: node --test tests/hud.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const H = await import(new URL('hud.js', base));

function memoryStorage(fail = false) {
  const m = new Map();
  return {
    getItem: k => { if (fail) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (fail) throw new Error('blocked'); m.set(k, String(v)); },
    map: m,
  };
}

test('notices last about 2.8 s and expire', () => {
  const q = H.createNoticeQueue();
  q.push('Crafted Rope', 1000);
  assert.deepEqual(q.lines(1000), ['Crafted Rope']);
  assert.deepEqual(q.lines(1000 + H.NOTICE_MS - 1), ['Crafted Rope']);
  assert.deepEqual(q.lines(1000 + H.NOTICE_MS), []);
  assert.ok(H.NOTICE_MS >= 2500 && H.NOTICE_MS <= 3000);
});

test('notices stack a few lines, newest last, oldest dropped', () => {
  const q = H.createNoticeQueue({max:3});
  for (const [i, t] of ['a', 'b', 'c', 'd'].entries()) q.push(t, i);
  assert.deepEqual(q.lines(10), ['b', 'c', 'd']);
});

test('a repeated notice refreshes instead of duplicating', () => {
  const q = H.createNoticeQueue({ms:100});
  q.push('Your bag is full', 0); q.push('Crafted Rope', 10); q.push('Your bag is full', 50);
  assert.deepEqual(q.lines(60), ['Crafted Rope', 'Your bag is full']);
  assert.deepEqual(q.lines(120), ['Your bag is full']);
});

test('notice queue ignores empty text, clips long text and honours custom duration', () => {
  const q = H.createNoticeQueue();
  q.push('', 0); q.push(null, 0);
  assert.deepEqual(q.lines(0), []);
  q.push('x'.repeat(200), 0, 500);
  assert.equal(q.lines(0)[0].length, 90);
  assert.deepEqual(q.lines(500), []);
});

test('sound preference persists under its own key and survives blocked storage', () => {
  const s = memoryStorage();
  assert.equal(H.loadSoundPref(s), true);
  assert.equal(H.saveSoundPref(s, false), true);
  assert.equal(s.map.get(H.SOUND_KEY), 'off');
  assert.equal(H.loadSoundPref(s), false);
  H.saveSoundPref(s, true);
  assert.equal(H.loadSoundPref(s), true);
  assert.notEqual(H.SOUND_KEY, 'little-raft-settings');
  const blocked = memoryStorage(true);
  assert.equal(H.loadSoundPref(blocked), true);
  assert.equal(H.saveSoundPref(blocked, false), false);
  assert.equal(H.loadSoundPref(null), true);
});

test('drag look scales with the sensitivity setting', () => {
  assert.equal(H.dragLookScale(.005, 1), .005);
  assert.equal(H.dragLookScale(.005, 2), .01);
  assert.ok(Math.abs(H.dragLookScale(.005, .4) - .002) < 1e-12);
  assert.equal(H.dragLookScale(.005, NaN), .005);
  assert.equal(H.dragLookScale(.005, 0), .005);
});

test('first-run hints go throw -> bag -> slots and are stored once', () => {
  const s = memoryStorage(), done = H.loadHints(s);
  assert.equal(H.nextHint(done, {heldKind:'hook', castOut:false})?.id, 'throw');
  assert.equal(H.nextHint(done, {heldKind:'hook', castOut:true}), null);
  done.add('throw');
  assert.equal(H.nextHint(done, {heldKind:'hook', hasLoot:false}), null);
  assert.equal(H.nextHint(done, {heldKind:'hook', hasLoot:true})?.id, 'bag');
  done.add('bag');
  assert.equal(H.nextHint(done, {items:2})?.id, 'slots');
  done.add('slots'); H.saveHints(s, done);
  assert.equal(H.nextHint(H.loadHints(s), {heldKind:'hook', hasLoot:true}), null);
  assert.equal(H.loadHints(memoryStorage(true)).size, 0);
  s.setItem(H.HINT_KEY, '{bad json'); assert.equal(H.loadHints(s).size, 0);
});

test('game.js routes notices to the edge stack, not under the crosshair', async () => {
  const src = await readFile(new URL('game.js', base), 'utf8');
  assert.doesNotMatch(src, /#contextPrompt\{[^}]*top:calc\(50%/);
  // Integration routes notices to the bottom-left pickup feed (pickup-feed.js); it is raised as a popover over panels.
  assert.match(src, /function notice\([^)]*\) \{[^\n]*pickupFeed\.note\(/);
  assert.match(src, /#pickupFeed\[popover\]\{/);
  assert.match(src, /dragLookScale\(DRAG_SENSITIVITY, options\.sensitivity\)/);
  assert.match(src, /createOceanAudio\(/);
  // beep() survives only as the old tone API for lane hooks; it plays the audio.js recipes, never a raw oscillator.
  assert.match(src, /function beep\(f = 500\) \{ play\(/);
  assert.doesNotMatch(src, /createOscillator\(/);
  assert.doesNotMatch(src, /new AudioContext\(/);
  const css = await readFile(new URL('graphics.css', base), 'utf8');
  assert.doesNotMatch(css, /#resumeHint\{[^}]*top:calc\(50%/);
  assert.doesNotMatch(css, /#chargeMeter\{[^}]*top:calc\(50%/);
});
