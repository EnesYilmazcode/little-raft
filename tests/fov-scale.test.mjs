// First-person scale: default FOV frames like Raft, and old saved settings migrate safely.
// Run: node --test tests/fov-scale.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { validateSettings, migrateSettings, SETTINGS_DEFAULTS: D } = await import(new URL('settings.js', base));

// Fraction of screen height from the bottom edge to a 2.2 m wall top, eye 1.6 m, level look, d metres away.
const wallTop = (vfov, d) => 0.5 + 0.5 * (0.6 / d) / Math.tan(vfov * Math.PI / 360);

test('default FOV is 60 deg vertical, the hands projection, and frames a wall like Raft', () => {
  assert.equal(D.fov, 60);
  // Raft estimate: 1.5 m foundation, about 90 deg horizontal (59 vertical) at 16:9.
  assert.ok(Math.abs(wallTop(D.fov, 1.5) - wallTop(59, 1.5)) < 0.01);
  assert.ok(wallTop(D.fov, 2) > wallTop(75, 2) + 0.05);
});

test('FOV range keeps every old stored value and adds Raft-like narrow values', () => {
  for (const v of [50, 60, 75, 90, 100]) assert.equal(validateSettings({ fov: v }).fov, v);
  assert.equal(validateSettings({ fov: 40 }).fov, 50);
  assert.equal(validateSettings({ fov: 120 }).fov, 100);
});

test('the old implicit default (75, no fovRev) migrates once; real choices stay', () => {
  assert.equal(validateSettings(migrateSettings({ fov: 75, sensitivity: 1.4 })).fov, 60);
  assert.equal(validateSettings(migrateSettings({ fov: 75, sensitivity: 1.4 })).sensitivity, 1.4);
  assert.equal(validateSettings(migrateSettings({ fov: 85 })).fov, 85);
  assert.equal(validateSettings(migrateSettings({ fov: 75, fovRev: 2 })).fov, 75); // chosen after the change
  assert.equal(migrateSettings(null), null);
  assert.equal(validateSettings(migrateSettings({ fov: 'x' })).fov, 60);
});
