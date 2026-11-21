// [lbtabs] logbook extra tabs: a re-created logbook UI (live reload reuses the #logbook dialog) must not adopt
// the previous instance's extra tab buttons. Run: node --test tests/logbook-tabs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;

class El {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parent = null; this.id = '';
    this.style = {}; this.hidden = false; this.attrs = {}; this.dataset = {}; this._text = ''; this.className = ''; this.tabIndex = 0;
    const cl = new Set();
    this.classList = { add: (...c) => c.forEach(x => cl.add(x)), remove: (...c) => c.forEach(x => cl.delete(x)), contains: c => cl.has(c), toggle: (c, on = !cl.has(c)) => (on ? cl.add(c) : cl.delete(c), on) };
  }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return e === this.ownerDocument.body; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html ?? ''; }
  appendChild(c) { c.remove(); c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(c)); }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {} removeEventListener() {} focus() { this.focused = (this.focused ?? 0) + 1; } showModal() { this.open = true; } close() { this.open = false; }
  all(out = []) { for (const c of this.children) { out.push(c); c.all(out); } return out; }
  querySelector(sel) {
    if (sel[0] === '#') return this.all().find(e => e.id === sel.slice(1)) ?? null;
    return (this._stub ??= new Map()).get(sel) ?? (this._stub.set(sel, this.appendChild(new El('div', this.ownerDocument))), this._stub.get(sel));
  }
  querySelectorAll(sel) { return sel === '[role=tab]' ? this.all().filter(e => e.attrs.role === 'tab') : []; }
}
function fakeDoc() {
  const doc = {};
  doc.head = new El('head', doc); doc.body = new El('body', doc);
  doc.createElement = t => new El(t, doc);
  doc.getElementById = id => [doc.head, ...doc.head.all(), ...doc.body.all()].find(e => e.id === id) ?? null;
  doc.addEventListener = () => {};
  return doc;
}

test('a second logbook UI on the same dialog drops the old extra tabs and builds its own once', async () => {
  const doc = fakeDoc();
  globalThis.document = doc; globalThis.window = {};
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) } });
  // the built-in markup's three tab buttons and panels (the fake DOM does not parse innerHTML)
  const dlg = new El('dialog', doc); dlg.id = 'logbook'; doc.body.append(dlg);
  for (const id of ['notes', 'ach', 'tasks']) {
    const b = new El('button', doc); b.setAttribute('role', 'tab'); b.dataset.tab = id; dlg.append(b);
    const p = new El('section', doc); p.id = `lb-panel-${id}`; dlg.append(p);
  }
  const { createLogbookUI } = await import(new URL('logbook-ui.js', base));
  const entry = { id: 'stars', label: 'Night Sky', view: () => ({ sig: 1, html: '<p>sky</p>' }) };
  const make = () => createLogbookUI({ getProgress: () => ({ notes: [], achievements: [] }), tabs: { list: () => [entry] } });
  const starBtns = () => dlg.querySelectorAll('[role=tab]').filter(b => b.dataset.tab === 'stars');
  const a = make(); a.open('stars');
  assert.equal(starBtns().length, 1); assert.equal(starBtns()[0].hidden, false);
  const old = starBtns()[0], seen = old.focused ?? 0;
  const b = make(); // destroys a after building its own tab list
  assert.equal(starBtns().length, 0);
  b.open('stars');
  assert.equal(starBtns().length, 1);
  assert.notEqual(starBtns()[0], old);
  assert.equal(old.focused ?? 0, seen, 'the new UI must not track (or focus) the old instance\'s detached tab');
  assert.equal(doc.getElementById('lb-panel-stars').hidden, false);
  b.open('nope'); // unknown tab ids are ignored (already open: stays put)
  b.close(); b.open('nope'); // closed: falls back to notes
  assert.equal(doc.getElementById('lb-panel-stars').hidden, true);
  assert.equal(doc.getElementById('lb-panel-notes').hidden, false);
  b.destroy();
  assert.equal(starBtns().length, 0); assert.equal(doc.getElementById('lb-panel-stars'), null);
});
