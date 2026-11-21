// Display Shelf (3 slots) and Trophy Stand (1 slot or a cosmetic fish trophy). See docs/specs/display-shelf.md.
// E puts the held item in the aimed slot; E on a filled slot takes it back. Purely cosmetic: nothing is ever lost.
// Slice: world.ext.display, host-authoritative, actions 'display.*'. The top half of this file is pure
// (no DOM, no Date, no Math.random) and exported for tests.
import { cleanSlot, moveStack } from './storage-research.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { ITEMS } from './items.js';
import { speciesById } from './fish-species.js';
import { createFishModel } from './fish-models.js'; // no ?build=: one fish geometry cache with fishing-cooking.js
import { buildItemModel } from './held-items.js?build=v3-survival-ae77fa84ac2b';
import { getModel } from './models.js?build=v3-survival-ae77fa84ac2b';
import { createShelf, createTrophyStand } from './display-model.js?build=v3-survival-ae77fa84ac2b';

export const SLOTS = Object.freeze({ shelf: 3, trophystand: 1 });
export const REACH = 2.6, HOST_SLACK = 2, MAX_MODELS = 48, MESH_CAP = 40, TROPHY_LEN = 0.4, MAX_TILES = 400;
export const OLD_HOST = 'Your friend’s raft doesn’t have display shelves yet';
export const TEXT = Object.freeze({ stale: 'That spot just changed, try again', full: 'Your bag is full', busy: 'Something is already there',
  empty: 'Hold an item to display it', fill: 'Empty the shelf first', notarget: 'Nothing to display on', bad: 'That can’t go on display' });
export const TROPHY_DOWN = 'Trophy taken down. Your journal keeps the record.';
export const SHELF_SIZE = 0.30, STAND_SIZE = 0.34;

const KEY_RE = /^-?\d{1,3},-?\d{1,3}$/;
const isInt = Number.isInteger;
export const tileKey = (x, z) => x + ',' + z;
const isKey = k => typeof k === 'string' && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const nameOf = k => ITEM_INFO[k]?.name ?? ITEMS[k]?.name ?? String(k);
const fail = reason => ({ ok: false, reason, text: TEXT[reason] });
const round1 = v => Math.round(v * 10) / 10;

/** {species, cm} with cm clamped to the species range, or null. */
export function cleanTrophy(e) {
  if (!isObj(e)) return null;
  const sp = speciesById(e.species); if (!sp) return null;
  if (typeof e.cm !== 'number' || !Number.isFinite(e.cm)) return null;
  return { species: sp.id, cm: round1(Math.min(sp.maxCm, Math.max(sp.minCm, e.cm))) };
}
const oneOf = raw => { const c = cleanSlot(raw); if (c && c.count !== 1) c.count = 1; return c; };

/** Validated slice. Never throws. Orphan data (no matching decor) is kept: it shows again when the decor returns. */
export function cleanDisplay(v) {
  const out = { v: 1, s: '', r: 0, d: {}, t: {} };
  if (!isObj(v)) return out;
  if (typeof v.s === 'string' && v.s.length <= 32) out.s = v.s;
  if (isInt(v.r) && v.r >= 0 && v.r < Number.MAX_SAFE_INTEGER) out.r = v.r;
  if (isObj(v.d)) {
    let n = 0;
    for (const k of Object.keys(v.d)) {
      if (n >= MAX_TILES) break;
      if (!isKey(k) || !Array.isArray(v.d[k])) continue;
      const arr = v.d[k].slice(0, 3).map(oneOf);
      if (!arr.some(Boolean)) continue;
      out.d[k] = arr; n++;
    }
  }
  if (isObj(v.t)) {
    let n = 0;
    for (const k of Object.keys(v.t)) {
      if (n >= MAX_TILES) break;
      if (!isKey(k)) continue;
      const tr = cleanTrophy(v.t[k]); if (!tr) continue;
      if (out.d[k]?.[0]) continue; // a stand holds an item or a trophy: keep the item, drop the (cosmetic) trophy
      out.t[k] = tr; n++;
    }
  }
  return out;
}

/** 'shelf' | 'trophystand' | null for the decor on that tile. */
export function displayAt(decor, x, z) {
  if (Array.isArray(decor)) for (const d of decor) if (d && d.x === x && d.z === z && hasOwnSlots(d.type)) return d.type;
  return null;
}
const hasOwnSlots = t => t === 'shelf' || t === 'trophystand';

// Shared checks: the tile holds a display and `i` is one of its slots.
function where(decor, a, needSlot = true) {
  if (!a || !isInt(a.x) || !isInt(a.z)) return null;
  const type = displayAt(decor, a.x, a.z); if (!type) return null;
  if (needSlot && !(isInt(a.i) && a.i >= 0 && a.i < SLOTS[type])) return null;
  return { type, key: tileKey(a.x, a.z) };
}
const okBag = bag => !!bag && typeof bag.snapshot === 'function' && Array.isArray(bag.slots);
function commit(bag, scratch) {
  for (let i = 0; i < scratch.slots.length; i++) bag.slots[i] = scratch.slots[i];
  if (typeof bag.version === 'number') bag.version++;
}

/** Atomic: move one item (a tool's whole slot) from bag slot `from` into display slot `i`. */
export function put(st, decor, a, bag) {
  const w = where(decor, a); if (!w) return fail('notarget');
  const cur = st.d[w.key], arr = Array.isArray(cur) ? cur.slice() : [];
  if (arr[a.i] || (w.type === 'trophystand' && st.t[w.key])) return fail('busy');
  if (!okBag(bag) || !isInt(a.from) || a.from < 0 || a.from >= bag.slots.length) return fail('bad');
  const want = isObj(a.expect) ? a.expect.have : undefined;
  if (typeof want !== 'string' || bag.slots[a.from]?.kind !== want) return fail('stale');
  if (a.expect.slot !== null && a.expect.slot !== undefined) return fail('stale');
  const scratch = new bag.constructor(bag.snapshot());
  const s = scratch.slots[a.from];
  let item;
  if (s.count <= 1) { item = s; scratch.slots[a.from] = null; } else { item = { kind: s.kind, count: 1 }; s.count -= 1; }
  item = oneOf(item); if (!item) return fail('bad');
  while (arr.length <= a.i) arr.push(null);
  arr[a.i] = item;
  commit(bag, scratch);
  st.d[w.key] = arr; st.r++;
  return { ok: true, text: `${nameOf(item.kind)} on display` };
}

/** Atomic: a slot back into the bag (`expect:{slot:kind}`), or take a trophy down (`expect:{trophy:species}`). */
export function take(st, decor, a, bag) {
  const ex = a && isObj(a.expect) ? a.expect : null;
  if (ex && Object.prototype.hasOwnProperty.call(ex, 'trophy')) {
    const w = where(decor, a, false); if (!w || w.type !== 'trophystand') return fail('notarget');
    const tr = st.t[w.key]; if (!tr || tr.species !== ex.trophy) return fail('stale');
    delete st.t[w.key]; st.r++;
    return { ok: true, text: TROPHY_DOWN };
  }
  const w = where(decor, a); if (!w) return fail('notarget');
  const arr = Array.isArray(st.d[w.key]) ? st.d[w.key].slice() : [];
  const item = arr[a.i];
  if (!item || !ex || item.kind !== ex.slot) return fail('stale');
  if (!okBag(bag)) return fail('full');
  const scratch = new bag.constructor(bag.snapshot());
  const one = [{ ...item }];
  moveStack(one, 0, scratch.slots);
  if (one[0]) return fail('full');
  commit(bag, scratch);
  arr[a.i] = null;
  if (arr.some(Boolean)) st.d[w.key] = arr; else delete st.d[w.key];
  st.r++;
  return { ok: true, text: `+1 ${nameOf(item.kind)}`, loot: { [item.kind]: 1 } };
}

/** Cosmetic trophy on an empty stand (or swap one). The bag is never touched. */
export function mount(st, decor, a) {
  const w = where(decor, a, false); if (!w || w.type !== 'trophystand') return fail('notarget');
  if (st.d[w.key]?.[0]) return fail('busy');
  const tr = cleanTrophy(a); if (!tr) return fail('bad');
  const cur = st.t[w.key]?.species ?? null;
  if (!isObj(a.expect) || cur !== (a.expect.trophy ?? null)) return fail('stale');
  st.t[w.key] = tr; st.r++;
  return { ok: true, text: `${speciesById(tr.species).name} trophy mounted` };
}

/** For a future decor removal (none exists yet): every stored slot back into the bag, or refuse. Trophies refund nothing. */
export function refundDisplay(st, key, bag) {
  if (!isKey(key)) return fail('notarget');
  const items = Array.isArray(st.d[key]) ? st.d[key].filter(Boolean) : [];
  if (!items.length) {
    if (st.t[key] || st.d[key]) { delete st.t[key]; delete st.d[key]; st.r++; }
    return { ok: true, text: '', loot: {} };
  }
  if (!okBag(bag)) return { ok: false, reason: 'full', text: TEXT.fill };
  const scratch = new bag.constructor(bag.snapshot()), loot = {};
  for (const it of items) {
    const one = [{ ...it }];
    moveStack(one, 0, scratch.slots);
    if (one[0]) return { ok: false, reason: 'full', text: TEXT.fill };
    loot[it.kind] = (loot[it.kind] || 0) + 1;
  }
  commit(bag, scratch);
  delete st.d[key]; delete st.t[key]; st.r++;
  return { ok: true, text: 'Display emptied into your bag', loot };
}

// ------------------------------------------------------------------ the content module

const markShared = o => o.traverse(c => {
  if (c.geometry) c.geometry.userData.shared = true;
  for (const m of [].concat(c.material || [])) m.userData.shared = true;
});

export function createDisplay(ctx) {
  const T = ctx.T;
  const session = Math.random().toString(36).slice(2, 10);
  let st = cleanDisplay(undefined); st.s = session;
  let cache = null, cacheSt = null, cacheR = -1, netR = -1, netS = null, netUndef = false, hostHasDisplay = true, dirty = true;
  const groups = []; // {g, type, x, z, key, anchors[], dist}
  let scanLen = -1, scanFirst = null, scanRaft = null;
  const v = T ? new T.Vector3() : null, dir = T ? new T.Vector3() : null;
  const templates = new Map();  // kind -> Object3D (geometry + materials flagged shared)
  const plaques = new Map();    // text -> material (CanvasTexture), oldest first
  let plaqueGeo = null;

  const oldHost = () => ctx.role === 'guest' && !hostHasDisplay;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const esc = s => (typeof ctx.esc === 'function' ? ctx.esc(String(s)) : String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`));
  const held = () => { const b = ctx.localBag?.(); return b ? { slot: b.selected, from: b.selectedIndex } : { slot: null, from: -1 }; };
  const journal = () => { try { return globalThis.raftFC?.journal ?? null; } catch { return null; } };
  const seen = () => { try { const s = journal()?.speciesSeen?.(); return Array.isArray(s) ? s : []; } catch { return []; } };
  const bestCm = id => { try { const e = journal()?.entry?.(id); return typeof e?.bestCm === 'number' ? e.bestCm : speciesById(id)?.minCm ?? 0; } catch { return speciesById(id)?.minCm ?? 0; } };
  const nextSpecies = cur => { const s = seen(); if (!s.length) return null; const i = s.indexOf(cur); return i >= 0 ? s[(i + 1) % s.length] : s[0]; };
  const spName = id => speciesById(id)?.name ?? String(id);

  function scanGroups() {
    const raft = ctx.raft; if (!raft) { const had = groups.length > 0; groups.length = 0; scanRaft = null; return had; }
    const kids = raft.children;
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst) return false;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0];
    groups.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i], type = g.name === 'craft_shelf' ? 'shelf' : g.name === 'craft_trophystand' ? 'trophystand' : null;
      if (!type) continue;
      const x = Math.round(g.position.x / 2), z = Math.round(g.position.z / 2), anchors = [];
      for (let j = 0; j < SLOTS[type]; j++) anchors.push(g.children.find(c => c.name === 'slot' + j) ?? null);
      groups.push({ g, type, x, z, key: tileKey(x, z), anchors, dist: 0 });
    }
    return true;
  }

  // The slot whose anchor is nearest the view ray, within reach.
  function target(aim) {
    const p = ctx.physics, cam = ctx.camera; if (!T || !p || !cam) return null;
    scanGroups(); if (!groups.length) return null;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (typeof cam.getWorldDirection === 'function') { cam.getWorldDirection(dir); dx = dir.x; dy = dir.y; dz = dir.z; }
    else return null;
    let best = null, bestI = -1, bestScore = Infinity;
    for (let k = 0; k < groups.length; k++) {
      const e = groups[k];
      e.g.getWorldPosition(v);
      if (Math.hypot(p.x - v.x, p.z - v.z) > REACH) continue;
      const lim = e.type === 'shelf' ? .24 : .4;
      for (let j = 0; j < e.anchors.length; j++) {
        const a = e.anchors[j]; if (!a) continue;
        a.getWorldPosition(v); v.y += .12;
        const vx = v.x - ox, vy = v.y - oy, vz = v.z - oz, along = vx * dx + vy * dy + vz * dz;
        if (along <= 0) continue;
        const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (off > lim) continue;
        const score = off + along * .05;
        if (score < bestScore) { bestScore = score; best = e; bestI = j; }
      }
    }
    return best ? { x: best.x, z: best.z, i: bestI, type: best.type, key: best.key } : null;
  }

  // ---------- models ----------
  function template(kind) {
    if (templates.has(kind)) return templates.get(kind);
    let model = null;
    try { model = buildItemModel(T, kind, getModel); } catch { model = null; }
    let meshes = 0;
    model?.traverse(c => { if (c.isMesh) meshes++; });
    if (!model || meshes === 0 || meshes > MESH_CAP) {
      model = new T.Mesh(new T.BoxGeometry(.18, .18, .18), new T.MeshStandardMaterial({ color: ITEMS[kind]?.iconTint ?? '#c9a24a', roughness: .8 }));
      model.userData.ownBox = true;
    }
    const inner = new T.Group(); inner.add(model);
    const box = new T.Box3().setFromObject(inner), size = box.getSize(new T.Vector3());
    if (size.y > 1.6 * Math.max(size.x, size.z)) { inner.rotation.z = Math.PI / 2; inner.updateMatrixWorld(true); box.setFromObject(inner); box.getSize(size); } // long tools lie down
    const s = SHELF_SIZE / Math.max(size.x, size.y, size.z, 1e-3);
    inner.scale.multiplyScalar(s); inner.updateMatrixWorld(true);
    box.setFromObject(inner);
    const c = box.getCenter(new T.Vector3());
    inner.position.set(-c.x, -box.min.y, -c.z);
    const tpl = new T.Group(); tpl.name = 'display_template:' + kind; tpl.add(inner);
    tpl.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    markShared(tpl);
    templates.set(kind, tpl);
    return tpl;
  }

  function plaqueMat(text) {
    if (plaques.has(text)) return plaques.get(text);
    if (typeof document === 'undefined') return null;
    let tex = null;
    try {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32;
      const c2 = cv.getContext('2d'); if (!c2) return null;
      c2.fillStyle = '#c9a24a'; c2.fillRect(0, 0, 128, 32);
      c2.strokeStyle = '#8a6a26'; c2.lineWidth = 2; c2.strokeRect(2, 2, 124, 28);
      c2.fillStyle = '#3a2a14'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      let px = 15; c2.font = `bold ${px}px Georgia, serif`;
      while (px > 8 && c2.measureText(text).width > 118) { px--; c2.font = `bold ${px}px Georgia, serif`; }
      c2.fillText(text, 64, 17);
      tex = new T.CanvasTexture(cv); if ('colorSpace' in tex && T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
    } catch { return null; }
    const m = new T.MeshStandardMaterial({ map: tex, roughness: .45, metalness: .3 }); m.userData.shared = true;
    plaques.set(text, m);
    if (plaques.size > 24) { const [k, old] = plaques.entries().next().value; plaques.delete(k); old.map?.dispose(); old.dispose(); }
    return m;
  }

  function setSlot(anchor, kind, type) {
    if (anchor.userData.dispKind === kind) return;
    for (let i = anchor.children.length - 1; i >= 0; i--) if (anchor.children[i].name === 'display_item') anchor.remove(anchor.children[i]);
    anchor.userData.dispKind = kind;
    if (!kind) return;
    const tpl = template(kind); if (!tpl) return;
    const c = tpl.clone(); c.name = 'display_item';
    c.scale.setScalar(type === 'trophystand' ? STAND_SIZE / SHELF_SIZE : 1);
    anchor.add(c);
  }

  function setTrophy(e, tr) {
    const g = e.g, anchor = e.anchors[0]; if (!anchor) return;
    const sig = tr ? tr.species + '|' + tr.cm : null;
    if (g.userData.dispTrophy === sig) return;
    g.userData.dispTrophy = sig;
    const old = anchor.getObjectByName('display_trophy'); if (old) anchor.remove(old);
    const plaque = g.getObjectByName('plaque'), peg = g.getObjectByName('peg');
    const oldText = plaque?.getObjectByName('plaqueText'); if (oldText) plaque.remove(oldText);
    if (peg) peg.visible = !!tr;
    if (!tr) return;
    try {
      const fish = createFishModel(T, tr.species, { cm: tr.cm, lod: 1 });
      markShared(fish);
      fish.scale.setScalar(TROPHY_LEN / (fish.userData.length || 1));
      fish.rotation.set(0, 0, 10 * Math.PI / 180); // on its side facing the front, nose tilted up 10 degrees
      const wrap = new T.Group(); wrap.name = 'display_trophy'; wrap.add(fish);
      wrap.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(fish), c = box.getCenter(new T.Vector3());
      fish.position.set(-c.x, .045 - box.min.y, -c.z); // belly resting on the peg top
      anchor.add(wrap);
    } catch (err) { console.warn('trophy model failed', err); }
    if (plaque) {
      const m = plaqueMat(`${spName(tr.species)} · ${tr.cm} cm`);
      if (m) {
        if (!plaqueGeo) { plaqueGeo = new T.PlaneGeometry(.21, .052); plaqueGeo.userData.shared = true; }
        const t = new T.Mesh(plaqueGeo, m); t.name = 'plaqueText'; t.position.z = .0055; plaque.add(t);
      }
    }
  }

  function paint() {
    dirty = false;
    if (!groups.length) return;
    const p = ctx.physics, old = oldHost();
    for (const e of groups) { if (p) { e.g.getWorldPosition(v); e.dist = Math.hypot(v.x - p.x, v.z - p.z); } else e.dist = 0; }
    const order = groups.slice().sort((a, b) => a.dist - b.dist);
    let budget = MAX_MODELS;
    for (const e of order) {
      const arr = old ? null : st.d[e.key], tr = old || e.type !== 'trophystand' ? null : st.t[e.key];
      for (let j = 0; j < e.anchors.length; j++) {
        const a = e.anchors[j]; if (!a) continue;
        const it = arr ? arr[j] : null, want = it && budget > 0 ? it.kind : null;
        if (want) budget--;
        setSlot(a, want, e.type);
      }
      const showTr = !!tr && !(arr && arr[0]) && budget > 0;
      if (showTr) budget--;
      setTrophy(e, showTr ? tr : null);
    }
  }

  // ---------- net / save ----------
  function load(data, from) {
    dirty = true;
    if (from === 'net') {
      if (data && typeof data === 'object' && data.r === netR && data.s === netS) return; // unchanged host state
      if (data === undefined && netUndef) return;
      netUndef = data === undefined; hostHasDisplay = data !== undefined;
      st = cleanDisplay(data);
      netR = data && typeof data === 'object' ? data.r : -1; netS = data && typeof data === 'object' ? data.s : null;
      return;
    }
    netR = -1; netS = null; netUndef = false; hostHasDisplay = true;
    st = cleanDisplay(data);
    st.s = session; st.r++;
  }

  function serialize() {
    if (cache && cacheSt === st && cacheR === st.r) return cache;
    cache = JSON.parse(JSON.stringify(st)); cacheSt = st; cacheR = st.r;
    return cache;
  }

  // What E does on the aimed slot: {html, muted} for the prompt and the action (or notice) to send.
  function plan(t) {
    if (oldHost()) return { html: OLD_HOST, notice: OLD_HOST, ms: 2400 };
    const slot = st.d[t.key]?.[t.i] ?? null;
    if (slot) return { html: `<kbd>E</kbd>Take ${esc(nameOf(slot.kind))}`, act: { kind: 'display.take', x: t.x, z: t.z, i: t.i, expect: { slot: slot.kind } } };
    const h = held(), hk = h.slot?.kind ?? null;
    if (t.type === 'trophystand') {
      const tr = st.t[t.key] ?? null;
      if (tr) {
        if (hk === 'fish' && seen().length > 1) {
          const nx = nextSpecies(tr.species), cm = bestCm(nx);
          return { html: `<kbd>E</kbd>Swap trophy: ${esc(spName(nx))}`, act: { kind: 'display.mount', x: t.x, z: t.z, species: nx, cm, expect: { trophy: tr.species } } };
        }
        return { html: `<kbd>E</kbd>Take down ${esc(spName(tr.species))} trophy`, act: { kind: 'display.take', x: t.x, z: t.z, i: 0, expect: { trophy: tr.species } } };
      }
      if ((hk === 'fish' || !hk) && seen().length) {
        const nx = nextSpecies(null), cm = bestCm(nx);
        return { html: `<kbd>E</kbd>Mount trophy: ${esc(spName(nx))} · ${esc(round1(cm))} cm`, act: { kind: 'display.mount', x: t.x, z: t.z, species: nx, cm, expect: { trophy: null } } };
      }
    }
    if (hk) return { html: `<kbd>E</kbd>Display ${esc(nameOf(hk))}`, act: { kind: 'display.put', x: t.x, z: t.z, i: t.i, from: h.from, expect: { have: hk, slot: null } } };
    return { html: 'Display shelf: hold an item to show it off', notice: TEXT.empty };
  }

  return {
    name: 'display',
    load,
    serialize,
    update() {
      if (!T) return;
      if (scanGroups() || dirty) paint();
    },
    prompt(aim) {
      const t = target(aim); if (!t) return null;
      return plan(t).html;
    },
    interact(aim) {
      const t = target(aim); if (!t) return false;
      const p = plan(t);
      if (p.act) ctx.action?.(p.act);
      else if (p.notice) ctx.notice?.(p.notice, p.ms);
      return true;
    },
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('display.')) return false;
      if (!isInt(a.x) || !isInt(a.z) || (a.kind !== 'display.mount' && !isInt(a.i))) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.x * 2 - pose.x, a.z * 2 - pose.z) > REACH + HOST_SLACK) return true;
      const d = decor();
      const r = a.kind === 'display.put' ? put(st, d, a, bag) : a.kind === 'display.take' ? take(st, d, a, bag) : a.kind === 'display.mount' ? mount(st, d, a) : null;
      if (!r) return true;
      if (r.ok) {
        dirty = true;
        ctx.emit?.(r.loot ? { kind: 'loot', text: r.text, loot: r.loot } : a.kind === 'display.take' ? { kind: 'notice', text: r.text } : { kind: 'build', text: r.text, sound: 'place' }, actor);
      } else {
        if (r.reason === 'stale') { st.r++; dirty = true; }
        ctx.emit?.({ kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
      }
      return true;
    },
    decorModel(type) {
      if (!T) return null;
      if (type === 'shelf') return createShelf(T);
      if (type === 'trophystand') return createTrophyStand(T);
      return null;
    },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      target: aim => target(aim),
      /** Every display on the raft with what each slot shows. */
      slots: () => { scanGroups(); return groups.map(e => ({ x: e.x, z: e.z, type: e.type, key: e.key,
        items: e.anchors.map(a => a?.userData.dispKind ?? null), trophy: e.g.userData.dispTrophy ?? null,
        at: T ? e.anchors.map(a => { if (!a) return null; const p = a.getWorldPosition(new T.Vector3()); return [p.x, p.y + .12, p.z]; }) : [] })); },
      /** Host QA: put a shelf / trophy stand on a free raft tile. */
      place(type, x, z) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !hasOwnSlots(type) || !isInt(x) || !isInt(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type, x, z }); ctx.rebuildRaft?.(); return true;
      },
      templates: () => templates.size,
    },
    dispose() {
      for (const e of groups) {
        for (const a of e.anchors) if (a) setSlot(a, null, e.type);
        setTrophy(e, null);
      }
      groups.length = 0; scanRaft = null;
      for (const tpl of templates.values()) tpl.traverse(o => { if (o.userData.ownBox) { o.geometry.dispose(); o.material.dispose(); } });
      templates.clear();
      for (const m of plaques.values()) { m.map?.dispose(); m.dispose(); }
      plaques.clear();
      plaqueGeo?.dispose(); plaqueGeo = null;
    },
  };
}
