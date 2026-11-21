// Round-5 regression tests for pointer lock (the cursor must never appear or escape during play).
// L1 (Esc held >600 ms after closing a panel), L2 (sign / rename first-use import), L3 (pad B/Y/Start closes
// any panel), L5 (Look from the pause menu returns to pause).
// Run: node --test tests/lock-r5.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const distDir = process.env.RAFT_DIST ? resolve(process.env.RAFT_DIST) : fileURLToPath(new URL('../dist/', import.meta.url));
const base = pathToFileURL(distDir + '/').href;
const read = f => readFileSync(resolve(distDir, f), 'utf8');
const gameSrc = read('game.js');
const rules = await import(new URL('lock-rules.js', base));

// ---------- tiny fake DOM (as in lock-fixes.test.mjs) ----------
class Target {
  constructor() { this.l = {}; }
  addEventListener(type, fn, opts = {}) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    (this.l[type] ||= []).push({ fn, capture });
    opts?.signal?.addEventListener?.('abort', () => { this.l[type] = this.l[type].filter(x => x.fn !== fn); });
  }
  removeEventListener() {}
  fire(type, ev = {}, phase) {
    const e = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...ev };
    for (const { fn, capture } of [...(this.l[type] || [])]) if (phase === undefined || phase === capture) fn(e);
    return e;
  }
  dispatchEvent(e) { this.fire(e.type, { detail: e.detail }); return true; }
}
class ClassList { constructor() { this.s = new Set(); } add(c) { this.s.add(c); } remove(c) { this.s.delete(c); } contains(c) { return this.s.has(c); } toggle(c, on) { (on ?? !this.s.has(c)) ? this.s.add(c) : this.s.delete(c); } }
class FakeDialog extends Target {
  constructor(id) { super(); this.id = id; this.open = false; this.dataset = {}; this.attrs = {}; }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; doc.fire('close', { target: this }, true); this.fire('close'); }
  setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; }
  dispatchEvent(e) { if (e.type === 'cancel') this.close(); return true; }
}
let doc;
function setupDom() {
  const options = new FakeDialog('options');
  const node = () => ({ hidden: true, dataset: {}, setAttribute() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [] });
  const panel = node();
  const form = { dataset: { raftSettings: '4' }, classList: new ClassList(), elements: {}, querySelector: s => (s === '.rs-panel' ? panel : null), querySelectorAll: () => [], addEventListener() {} };
  options.querySelector = s => (s === '[data-raft-settings]' ? form : null);
  options.contains = () => true;
  const dialogs = [options];
  const body = { classList: new ClassList(), appendChild() {} };
  doc = Object.assign(new Target(), {
    body, head: { appendChild() {} }, pointerLockElement: null, fullscreenElement: null,
    getElementById: id => (id === 'little-raft-settings-style' ? { textContent: '' } : dialogs.find(d => d.id === id) || null),
    createElement: () => ({}),
    querySelector: s => (s === 'dialog[open]' ? dialogs.find(d => d.open) || null : null),
    querySelectorAll: s => (s === 'dialog[open]' ? dialogs.filter(d => d.open) : []),
  });
  const win = Object.assign(new Target(), { localStorage: { getItem: () => null, setItem() {} } });
  globalThis.document = doc; globalThis.window = win; globalThis.HTMLDialogElement = FakeDialog;
  const addDialog = id => { const d = new FakeDialog(id); dialogs.push(d); return d; };
  return { options, body, win, addDialog };
}
const { createSettings } = await import(new URL('settings.js', base));

// ---------- L1 ----------
test('L1: the relock timeout does not end body.relock while it waits on a held Escape', () => {
  assert.equal(rules.relockPending({ elapsed: rules.RELOCK_TIMEOUT, escWaiting: true }), true);
  assert.equal(rules.relockPending({ elapsed: 5000, escWaiting: true }), true, 'however long it is held');
  assert.equal(rules.relockPending({ elapsed: rules.RELOCK_TIMEOUT, escWaiting: false }), false);
  // lock events still end it: the release relocks (locked) or is refused (error) / revoked (unlocked)
  assert.equal(rules.relockPending({ locked: true, escWaiting: true }), false);
  assert.equal(rules.relockPending({ event: 'error', escWaiting: true }), false);
  assert.equal(rules.relockPending({ event: 'unlocked', escWaiting: true }), false);
});

test('L1: closing the inventory with Esc held for 2 s keeps the cursor hidden until the release', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { body, win, addDialog } = setupDom();
  body.classList.add('playing');
  win.raftShell = { relockWaiting: true, escapeBuild: () => false };
  const s = createSettings({});
  const inv = addDialog('inventory'); inv.showModal();
  win.raftEscape(); // the held Escape closes it
  assert.equal(inv.open, false);
  for (const ms of [100, 500, 700, 1200, 2000]) { t.mock.timers.tick(ms); assert.equal(body.classList.contains('relock'), true, `held ${ms}`); }
  win.raftShell.relockWaiting = false; // released: game.js relocks now
  doc.pointerLockElement = {}; doc.fire('pointerlockchange');
  assert.equal(body.classList.contains('relock'), false);
  s.destroy();
});

test('L1: after the release a relock that never comes still shows the hint (timeout re-armed, not dropped)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { body, win, addDialog } = setupDom();
  body.classList.add('playing');
  win.raftShell = { relockWaiting: true };
  const s = createSettings({});
  const d = addDialog('lrStorage'); d.showModal(); d.close();
  t.mock.timers.tick(1500);
  assert.equal(body.classList.contains('relock'), true);
  win.raftShell.relockWaiting = false;
  t.mock.timers.tick(rules.RELOCK_TIMEOUT);
  assert.equal(body.classList.contains('relock'), false);
  // control: a quick tap (nothing waiting) ends after RELOCK_TIMEOUT as before
  const d2 = addDialog('logbook'); d2.showModal(); d2.close();
  t.mock.timers.tick(rules.RELOCK_TIMEOUT);
  assert.equal(body.classList.contains('relock'), false);
  s.destroy();
});

test('L1: game.js exposes relockWaiting on raftShell (held Esc with a deferred relock)', () => {
  const shell = gameSrc.slice(gameSrc.indexOf('const shellApi = {'), gameSrc.indexOf('window.raftShell = shellApi'));
  assert.match(shell, /get relockWaiting\(\) \{ return running && escHeld && relockOnEscUp; \}/);
  assert.match(read('settings.js'), /window\.raftShell\?\.relockWaiting/);
});

// ---------- L2 ----------
function el(tag = 'div') {
  const e = Object.assign(new Target(), { tagName: tag.toUpperCase(), children: [], dataset: {}, attrs: {}, style: {}, open: false, value: '' });
  e.append = (...c) => { e.children.push(...c); };
  e.setAttribute = (k, v) => { e.attrs[k] = v; }; e.removeAttribute = k => { delete e.attrs[k]; if (k === 'open') e.open = false; };
  e.remove = () => {}; e.focus = () => {}; e.select = () => {};
  e.showModal = () => { e.open = true; }; e.close = () => { if (e.open) { e.open = false; e.fire('close'); } };
  return e;
}
function setupSignDom({ fail = false } = {}) {
  const made = [];
  globalThis.document = { head: el('head'), body: el('body'), pointerLockElement: null, getElementById: () => null,
    createElement: tag => { if (fail) throw new Error('no DOM'); const e = el(tag); made.push(e); return e; } };
  return made;
}
async function signCase({ uiOpenAtLoad = false, fail = false } = {}) {
  const made = setupSignDom({ fail });
  const T = await import(new URL('vendor/three.module.js', base));
  const { createDecorPack } = await import(new URL(`decor-pack.js?r5=${Math.random()}`, base));
  let busy = false, released = 0;
  const world = { tiles: [[0, 0]], decor: [{ type: 'sign', x: 0, z: 0 }], ext: {} };
  const ctx = { T, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, other: null, camera: { position: { x: 0, y: 0.8, z: 1.5 } }, raft: new T.Group(), elapsed: 0,
    localBag: () => null, actorBag: () => null, emit() {}, notice() {}, action() {}, rebuildRaft() {}, requestLock() {},
    releaseLock: () => { released++; }, esc: s => String(s), uiOpen: () => busy };
  const mod = createDecorPack(ctx);
  const origError = console.error; console.error = () => {};
  try {
    assert.equal(mod.interact({ dir: { x: 0, y: 0, z: -1 } }), true); // E on the sign
    assert.equal(released, 0, 'no release before the dialog module has loaded');
    busy = uiOpenAtLoad;
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); // let the dynamic import settle
  } finally { console.error = origError; }
  const dlg = made.find(e => e.tagName === 'DIALOG');
  return { released, opened: !!dlg?.open };
}

test('L2: a first-use sign releases the lock only once its dialog opens', async () => {
  assert.deepEqual(await signCase(), { released: 1, opened: true });
});
test('L2: a panel that opened during the sign import keeps it closed and the lock untouched', async () => {
  assert.deepEqual(await signCase({ uiOpenAtLoad: true }), { released: 0, opened: false });
});
test('L2: a failed sign UI load never leaves a released lock with no panel', async () => {
  assert.deepEqual(await signCase({ fail: true }), { released: 0, opened: false });
});
test('L2: decor-pack interact no longer releases before openSign; animal rename rechecks uiOpen after its import', () => {
  const decor = read('decor-pack.js');
  assert.doesNotMatch(decor, /releaseLock\?\.\(\); openSign\(/);
  assert.match(decor, /loadUI\(\)\?\.then\(u => \{ if \(u && !ctx\.uiOpen\?\.\(\)\) go\(u\); \}\)/);
  const animals = read('animals.js');
  const rename = animals.slice(animals.indexOf('function openRename'), animals.indexOf('function openRename') + 400);
  assert.match(rename, /loadUI\(\)\?\.then\(u => \{ if \(u && !ctx\.uiOpen\?\.\(\)\) go\(u\); \}\)/);
});

// ---------- L3 ----------
test('L3: pad menuBack falls through to the Esc path for any other open panel', () => {
  const cb = /menuBack:\(\) => \{([^\n]*)\}, \/\//.exec(gameSrc)?.[1] ?? '';
  assert.match(cb, /survivalUI\?\.isOpen\) survivalUI\.close\(\)/);
  assert.match(cb, /settingsController\?\.isOpen\) settingsController\.close\(\)/);
  assert.match(cb, /else if \(dialogOpen\(\)\) window\.raftEscape\?\.\(\)/); // never opens pause with nothing open
});

test('L3: that Esc path closes the topmost panel (crate, desk, research, map, journal, sign, crew, Look) and hides the cursor', () => {
  for (const id of ['lrStorage', 'stationPanel', 'researchPanel', 'mapTable', 'fishJournal', 'logbook', 'lr-sign', 'crew', 'lookDialog', 'lr-animal-name']) {
    const { options, body, win, addDialog } = setupDom();
    body.classList.add('playing');
    win.raftShell = { escapeBuild: () => { throw new Error('must not be asked while a panel is open'); } };
    const s = createSettings({});
    const d = addDialog(id); d.showModal();
    win.raftEscape();
    assert.equal(d.open, false, id); assert.equal(options.open, false, id);
    assert.equal(body.classList.contains('relock'), true, id);
    s.destroy();
  }
});

// ---------- L5 ----------
test('L5: Look opened from the pause menu returns to the pause menu, like the logbook', () => {
  const { options, body, addDialog } = setupDom();
  body.classList.add('playing');
  let paused = 0, resumed = 0;
  const s = createSettings({ onPause: () => paused++, onResume: () => resumed++ });
  s.open(); assert.equal(options.open, true);
  const look = addDialog('lookDialog');
  doc.addEventListener('littleraft:open-look', () => look.showModal());
  options.fire('click', { target: { closest: sel => (sel === 'button[data-act]' ? { dataset: { act: 'look' } } : null) } });
  assert.equal(options.open, false); assert.equal(look.open, true);
  assert.equal(look.dataset.fromPause, '1', 'look-ui and game.js skip the relock');
  look.close();
  assert.equal(options.open, true, 'back to pause'); assert.equal(resumed, 0); assert.equal(paused, 2);
  assert.equal(look.dataset.fromPause, undefined);
  s.destroy();
});

test('L5: look-ui skips onResume (requestLock) when it was opened from the pause menu', () => {
  const src = read('look-ui.js');
  assert.match(src, /const resumes = fromPause => !fromPause && !document\.getElementById\('options'\)\?\.open;/);
  const close = src.slice(src.indexOf('  function close() {'), src.indexOf("dlg.addEventListener('click'"));
  assert.ok(close.indexOf('const fromPause = !!dlg.dataset.fromPause') < close.indexOf('dlg.close()'), 'read before the close event clears it');
  assert.match(close, /if \(resumes\(fromPause\)\) safe\(onResume\);/);
  assert.match(close, /dlg\.addEventListener\('close', \(\) => \{ if \(isOpen\) \{ isOpen = false; flushSend\(\); if \(resumes\(!!dlg\.dataset\.fromPause\)\) safe\(onResume\); \} \}/);
});
