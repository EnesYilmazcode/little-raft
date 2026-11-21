// Regression tests for the pause menu / settings round-2 fixes (MEN2-1..5).
// Run: node --test tests/menus.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = (name) => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
const { validateSettings, SETTINGS_DEFAULTS: D } = await import(new URL('settings.js', base));
const { createOceanAudio } = await import(new URL('audio.js', base));

// Minimal Web Audio stand-in: records gain nodes and their scheduled values.
function fakeContext() {
  const param = (v = 0) => ({ value: v, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime(x) { this.value = x; }, exponentialRampToValueAtTime() {} });
  const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra });
  const gains = [];
  const ctx = {
    state: 'running', currentTime: 0, sampleRate: 8000, destination: node(),
    createGain() { const g = node({ gain: param(1) }); gains.push(g); return g; },
    createBiquadFilter: () => node({ frequency: param(), Q: param(), gain: param(), type: '' }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createOscillator: () => node({ frequency: param(), type: '', start() {}, stop() {} }),
    createBufferSource: () => node({ buffer: null, loop: false, playbackRate: param(1), start() {}, stop() {} }),
    createBuffer: (_c, len) => ({ getChannelData: () => new Float32Array(len) }),
    resume: () => Promise.resolve(),
  };
  return { ctx, gains };
}

test('MEN2-1: setAmbience drives the surf level and is clamped', async () => {
  const { ctx, gains } = fakeContext();
  const a = createOceanAudio({ context: ctx, volume: 0.5, ambience: 0.7 });
  assert.equal(typeof a.setAmbience, 'function');
  await a.resume();
  const level = gains.find((g) => g.gain.value === 0.7);
  assert.ok(level, 'surf passes a gain set to the ambience level');
  assert.equal(a.setAmbience(0), 0);
  assert.equal(level.gain.value, 0);
  assert.equal(a.setAmbience(5), 1);
  assert.equal(level.gain.value, 1);
  a.destroy();
});

test('MEN2-1: game.js forwards the ambience setting to audio at startup and on change', () => {
  const g = src('game.js');
  assert.match(g, /createOceanAudio\(\{[^}]*ambience:options\.ambience/);
  assert.match(g, /onChange:next => \{[^\n]*setAmbience\(next\.ambience\)/);
});

test('MEN2-2: title-screen menu hides Resume / Save-and-quit, and quitToTitle is a no-op on the title', () => {
  const s = src('settings.js');
  assert.match(s, /\[data-act="resume"\],\[data-act="quit"\]'\)\) b\.hidden = !inGame/);
  assert.match(s, /button\[hidden\]\{display:none\}/);
  assert.match(s, /act === 'quit'\) \{\s*if \(!gameActive\(\)\) return;/);
  assert.match(src('game.js'), /function quitToTitle\(\) \{\s*if \(!running\) return;/);
});

test('MEN2-3: desktop shell Escape uses the settings escape routing (panel collapses first)', () => {
  const g = src('game.js');
  assert.match(g, /if \(settingsController\) return settingsController\.escape\(\);/);
  assert.doesNotMatch(g, /settingsController\?\.isOpen\) \{ settingsController\.close\(\)/);
  assert.match(src('settings.js'), /\n\s+escape, \/\/ one Escape step/);
});

test('MEN2-4: default render scale matches the default (medium) preset', () => {
  assert.equal(D.graphics, 'medium');
  assert.equal(D.renderScale, 0.85);
  assert.match(src('settings.js'), /def: PRESETS\.medium\.renderScale/);
  assert.equal(validateSettings(null).renderScale, 0.85);
});

test('MEN2-5: Audio tab has a Sound toggle shared with #soundButton', () => {
  assert.equal(D.sound, true);
  assert.equal(validateSettings({ sound: false }).sound, false);
  assert.equal(validateSettings({ sound: 'off' }).sound, true);
  assert.match(src('settings.js'), /sound: \{ tab: 'audio', label: 'Sound', type: 'toggle'/);
  const g = src('game.js');
  assert.match(g, /createSettings\(\{initial:\{sound\}/);
  assert.match(g, /if \(next\.sound !== sound\) setSound\(next\.sound\)/);
  assert.match(g, /setSound\(!sound\); settingsController\?\.set\(\{sound\}\)/);
  assert.match(g, /function setSound\(on\) \{[^\n]*saveSoundPref\(window\.localStorage, sound\)/);
});
