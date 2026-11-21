// DOM lifecycle of the fishing & cooking glue under a tiny fake document (own process: HAS_DOC is fixed at import).
// Run: node --test tests/fc-dom.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parent = null; this.id = ''; this.style = {}; this.hidden = false; this.textContent = '';
    const cl = new Set(); this.classList = { add: (c) => cl.add(c), remove: (c) => cl.delete(c), toggle: (c, on) => (on ? cl.add(c) : cl.delete(c)) };
  }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(_) { this.children = []; for (let i = 0; i < 3; i++) { const c = this.appendChild(new El('div')); c.appendChild(new El('i')); } } // reel HUD shape
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  setAttribute() {}
}
const head = new El('head'), body = new El('body');
const all = (e, out = []) => { out.push(e); e.children.forEach((c) => all(c, out)); return out; };
globalThis.document = { head, body, createElement: (t) => new El(t), getElementById: (id) => [...all(head), ...all(body)].find((e) => e.id === id) || null };
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) } });
globalThis.window ??= {};

const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { createFishingCooking } = await import(new URL('fishing-cooking.js', base));

function host() {
  const scene = new T.Scene(), raft = new T.Group(); scene.add(raft);
  return { scene, raft, camera: new T.PerspectiveCamera(), ocean: { getHeight: () => 0 }, signal: new AbortController().signal, rodModel: new T.Group(),
    role: () => 'solo', netReady: () => false, send() {}, action: () => true, notice() {}, beep() {}, selectedKind: () => 'hammer', aim: () => null,
    rodTip: () => null, player: () => ({ x: 0, y: 0, z: 0 }), hasTile: () => true, decorAt: () => false, bagCount: () => 0,
    running: () => true, uiBlocked: () => false, busy: () => false };
}

test('hot swap (new mount before old dispose) keeps the shared styles for the new engine', () => {
  const a = createFishingCooking(T, host());
  assert.ok(document.getElementById('fc-style-glue') && document.getElementById('fc-style-reel'));
  const b = createFishingCooking(T, host()); // live.js: next = mount(transfer) ...
  a.dispose();                                // ... then old.dispose()
  assert.ok(document.getElementById('fc-style-glue'), 'chip/toast css kept');
  assert.ok(document.getElementById('fc-style-reel'), 'reel HUD css kept (else the HUD shows unstyled)');
  assert.ok(document.getElementById('fcChip') && document.getElementById('fcReelHud'));
  b.dispose();
  assert.equal(document.getElementById('fcChip'), null);
  assert.equal(document.getElementById('fcReelHud'), null);
  assert.equal(document.getElementById('fc-style-reel'), null, 'last engine out cleans up');
});
