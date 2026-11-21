// Regression tests for the pointer-lock fixes: the cursor must never escape or appear during play.
// E0 (desktop Esc in locked play), LOCK-1 (any panel close hides the cursor until relock), LOCK-2 (Esc on the build
// wheel), LOCK-3 (alt-tab relock), LOCK-4/5 (drag-look keeps its cursor and has no click-to-lock hint).
// Run: node --test tests/lock-fixes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const distDir = process.env.RAFT_DIST ? resolve(process.env.RAFT_DIST) : fileURLToPath(new URL('../dist/', import.meta.url));
const base = pathToFileURL(distDir + '/').href;
const read = f => readFileSync(resolve(distDir, f), 'utf8');
const mainSrc = readFileSync(fileURLToPath(new URL('../desktop/main.cjs', import.meta.url)), 'utf8');
const { lockedAtBlur, refocusAction, escapeIsForBuild, shouldMarkRelock } = await import(new URL('lock-rules.js', base));

// ---------- pure rules ----------
test('LOCK-2: Escape belongs to the build wheel while it is open or just closed by this press losing the lock', () => {
  assert.equal(escapeIsForBuild({ running: true, blocked: false, wheelOpen: true, now: 0 }), true);
  assert.equal(escapeIsForBuild({ running: true, blocked: false, wheelOpen: false, now: 5300, closedByLockAt: 5000 }), true);
  assert.equal(escapeIsForBuild({ running: true, blocked: false, wheelOpen: false, now: 7000, closedByLockAt: 5000 }), false); // stale: pause
  assert.equal(escapeIsForBuild({ running: true, blocked: false, wheelOpen: false, now: 7000 }), false); // never opened: pause
  assert.equal(escapeIsForBuild({ running: true, blocked: true, wheelOpen: true, now: 0 }), false); // a menu is up: it gets Esc
  assert.equal(escapeIsForBuild({ running: false, blocked: false, wheelOpen: true, now: 0 }), false);
});

test('LOCK-3: alt-tab remembers a lock held at blur, including one Chromium dropped just before blur', () => {
  assert.equal(lockedAtBlur({ running: true, locked: true, now: 1000 }), true);
  assert.equal(lockedAtBlur({ running: true, locked: false, now: 1000, lockLostAt: 900 }), true);
  assert.equal(lockedAtBlur({ running: true, locked: false, now: 1000, lockLostAt: 200 }), false); // paused / unlocked long ago
  assert.equal(lockedAtBlur({ running: false, locked: true, now: 1000 }), false);
});

test('LOCK-3: refocus relocks only if play was locked at blur and no menu is up', () => {
  const ok = { lockedAtBlur: true, focused: true, running: true, blocked: false, locked: false };
  assert.equal(refocusAction(ok), 'relock');
  assert.equal(refocusAction({ ...ok, lockedAtBlur: false }), 'wait');
  assert.equal(refocusAction({ ...ok, focused: false }), 'wait'); // keep it for the real focus
  assert.equal(refocusAction({ ...ok, blocked: true }), 'done'); // pause/inventory open: never steal the cursor
  assert.equal(refocusAction({ ...ok, locked: true }), 'done');
  assert.equal(refocusAction({ ...ok, running: false }), 'done');
});

test('LOCK-1/LOCK-4: body.relock after a close, never in drag-look or with another menu open', () => {
  const ok = { playing: true, fallback: false, locked: false, dialogOpen: false };
  assert.equal(shouldMarkRelock(ok), true);
  assert.equal(shouldMarkRelock({ ...ok, fallback: true }), false);
  assert.equal(shouldMarkRelock({ ...ok, dialogOpen: true }), false);
  assert.equal(shouldMarkRelock({ ...ok, locked: true }), false);
  assert.equal(shouldMarkRelock({ ...ok, playing: false }), false);
});

// ---------- desktop shell (source) ----------
test('E0: a keyUp Escape with no keyDown (Chromium spent it leaving the lock) runs raftEscape with a gesture', () => {
  const hook = mainSrc.slice(mainSrc.indexOf("on('before-input-event'"), mainSrc.indexOf("win.on('blur'"));
  assert.match(hook, /\}else if\(escDown\)\{[\s\S]*released\(\)',true\)[\s\S]*\}else\{[\s\S]*executeJavaScript\('window\.raftEscape&&window\.raftEscape\(\)',true\)/);
  assert.match(hook, /event\.preventDefault\(\)/); // the page never sees a raw Escape while claimed
});

test('LOCK-3: the desktop shell asks the page to relock, with a gesture, when the window regains focus', () => {
  assert.match(mainSrc, /win\.on\('focus',[\s\S]*?setTimeout\([\s\S]*?isFocused\(\)[\s\S]*?executeJavaScript\('window\.raftShell&&window\.raftShell\.refocus&&window\.raftShell\.refocus\(\)',true\)/);
  assert.match(mainSrc, /win\.on\('blur',\(\)=>\{escDown=false;clearTimeout\(refocusTimer\);\}\)/);
});

// ---------- game.js (source) ----------
const gameSrc = read('game.js');
test('game.js exposes refocus/escapeBuild to the shell and settings, and records wheel closes on lock loss', () => {
  assert.match(gameSrc, /refocus:guard\(\(\) => refocus\(\)\)/);
  assert.match(gameSrc, /escapeBuild:guard\(\(\) => escapeBuild\(\)\)/);
  assert.match(gameSrc, /building\.menu\.close\(false\); buildClosedByLockAt = performance\.now\(\);/);
  assert.match(gameSrc, /on\(window, 'focus', \(\) => \{[^\n]*if \(!shellRefocuses\(\)\) refocus\(\); \}\)/);
  assert.match(gameSrc, /on\(document, 'visibilitychange', \(\) => \{ if \(!document\.hidden && windowFocused\(\) && !shellRefocuses\(\)\) refocus\(\); \}\)/);
  // The desktop shell's gestured refocus must not be raced by a gestureless request from the page.
  assert.match(gameSrc, /const shellRefocuses = \(\) => \{ try \{ return !!window\.raftDesktop; \}/);
});

test('LOCK-4/5: drag-look marks the body and never shows the click-to-lock hint', () => {
  assert.match(gameSrc, /b\.toggle\('lock-fallback', running && lockFallback\)/);
  assert.match(gameSrc, /resume\.hidden = !\(running && !locked && lockSupported && !lockFallback && !dialog\)/);
  assert.match(read('style.css'), /body\.playing:not\(\.locked\):not\(\.lock-fallback\) #resumeHint/);
  const css = read('settings.js');
  assert.match(css, /body\.playing\.relock:not\(\.lock-fallback\) #world\{cursor:none\}/);
  assert.doesNotMatch(css, /^body\.relock #world/m);
});

// ---------- settings.js with a tiny fake DOM ----------
class Target {
  constructor() { this.l = {}; }
  addEventListener(type, fn, opts = {}) {
    const capture = typeof opts === 'boolean' ? opts : !!opts.capture;
    (this.l[type] ||= []).push({ fn, capture });
    opts?.signal?.addEventListener?.('abort', () => { this.l[type] = this.l[type].filter(x => x.fn !== fn); });
  }
  removeEventListener() {}
  fire(type, ev = {}, phase) {
    const e = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...ev };
    for (const { fn, capture } of [...(this.l[type] || [])]) if (phase === undefined || phase === capture) fn(e);
    return e;
  }
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
  // raft-master bumped the settings markup version to 4 (Change look button) and toggles form.classList for the title menu; match it.
  const form = { dataset: { raftSettings: '4' }, classList: new ClassList(), elements: {}, querySelector: s => (s === '.rs-panel' ? panel : null), querySelectorAll: () => [], addEventListener() {} };
  options.querySelector = s => (s === '[data-raft-settings]' ? form : null);
  options.contains = () => false;
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
const key = (win, type, extra = {}) => { win.fire(type, { key: 'Escape', repeat: false, ...extra }, true); };

test('E0/LOCK-2 (desktop): raftEscape with the wheel just closed by the lock loss relocks instead of pausing', () => {
  const { options, body, win } = setupDom();
  body.classList.add('playing');
  let paused = 0, escBuild = 0;
  win.raftShell = { escapeBuild: () => { escBuild++; return true; } };
  const s = createSettings({ onPause: () => paused++ });
  win.raftEscape();
  assert.equal(escBuild, 1); assert.equal(options.open, false); assert.equal(paused, 0);
  assert.equal(body.classList.contains('relock'), true); // no cursor while the lock comes back
  // With no wheel involved the same keyUp-only Escape pauses (E0's intended behaviour).
  win.raftShell.escapeBuild = () => false;
  win.raftEscape();
  assert.equal(options.open, true); assert.equal(paused, 1);
  s.destroy();
});

test('LOCK-2 (browser): the keyup fallback closes the wheel instead of opening pause', () => {
  const { options, body, win } = setupDom();
  body.classList.add('playing');
  win.raftShell = { escapeBuild: () => true };
  const s = createSettings({});
  doc.fire('pointerlockchange'); // the swallowed keydown left the lock
  key(win, 'keyup');
  assert.equal(options.open, false);
  assert.equal(body.classList.contains('relock'), true);
  win.raftShell.escapeBuild = () => false; // control: no wheel, the same press pauses
  doc.fire('pointerlockchange'); key(win, 'keyup');
  assert.equal(options.open, true);
  s.destroy();
});

test('LOCK-1: closing any panel during play hides the cursor immediately until the lock returns', () => {
  for (const id of ['logbook', 'fishJournal', 'crew', 'help', 'lrStorage', 'stationPanel', 'researchPanel', 'inventory']) {
    const { body, addDialog } = setupDom();
    body.classList.add('playing');
    const s = createSettings({});
    const d = addDialog(id); d.showModal();
    d.close();
    assert.equal(body.classList.contains('relock'), true, id);
    doc.pointerLockElement = {}; doc.fire('pointerlockchange');
    assert.equal(body.classList.contains('relock'), false, id);
    s.destroy();
  }
});

test('LOCK-1: Esc from the inventory still closes it without opening pause', () => {
  const { options, body, win, addDialog } = setupDom();
  body.classList.add('playing');
  win.raftShell = { escapeBuild: () => { throw new Error('must not be asked while a panel is open'); } };
  const s = createSettings({});
  const inv = addDialog('inventory'); inv.showModal();
  win.raftEscape(); // desktop path
  assert.equal(inv.open, false); assert.equal(options.open, false);
  assert.equal(body.classList.contains('relock'), true);
  s.destroy();
});

test('LOCK-4: in drag-look a panel closing leaves the cursor visible', () => {
  const { body, addDialog } = setupDom();
  body.classList.add('playing'); body.classList.add('lock-fallback');
  const s = createSettings({});
  const d = addDialog('logbook'); d.showModal(); d.close();
  assert.equal(body.classList.contains('relock'), false);
  s.destroy();
});
