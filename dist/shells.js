// Seashells content module: every visiting island shows 2-4 shell sparkles on its wet sand. E picks one
// up; the first find of a kind fills the crew Shell Book (a logbook tab), repeats pay Bright Shells
// (capped per island), finished sets pay a one-time gift. Diving finds come from the [shells] observe
// line on seafloor sand gathers. Host-authoritative, saved in world.ext.shells. Spec: docs/specs/shells.md.
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b'; // same specifier as content.js: one shared instance
import {
  SHELL_CFG, sparklesFor, nearestSparkle, DEFAULTS, clean, applyTake, applySeaFind, bookView, shellById, SETS, SHELL_IDS,
} from './shells-rules.js?build=v3-survival-ae77fa84ac2b';
import { shellsBookHTML } from './shells-book.js?build=v3-survival-ae77fa84ac2b';

const MAX = SHELL_CFG.MAX_SPOTS;
const NAMES = { shell: 'Bright Shell', glass: 'Glass', shellwreath: 'Shell Wreath' };
const payText = pay => Object.entries(pay).map(([k, n]) => `+${n} ${NAMES[k] || k}${n > 1 && k === 'shell' ? 's' : ''}`).join(', ');

// Soft round glint (procedural, works without a document).
function glintTexture(T) {
  const N = 32, px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1, r = Math.hypot(dx, dy);
    const core = Math.max(0, 1 - r) ** 2.2, cross = Math.max(0, 1 - Math.abs(dx) * 9) * Math.max(0, 1 - Math.abs(dy)) + Math.max(0, 1 - Math.abs(dy) * 9) * Math.max(0, 1 - Math.abs(dx));
    const v = Math.min(1, core + 0.6 * cross), i = (y * N + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = 255; px[i + 3] = Math.round(v * 255);
  }
  const t = new T.DataTexture(px, N, N, T.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

export function createShells(ctx, peer) {
  const T = ctx.T;
  let st = DEFAULTS();
  let rev = 1, outRev = 0, out = null;            // serialize() cache
  let viewRev = 0, view = null;                   // bookView cache
  let dirty = true, syncs = 0, clock = 0;
  const pending = new Float32Array(MAX);          // guest/host local "just pressed" hold (s), hides a sparkle until the host answers

  // ---------- scene: 1 InstancedMesh (4 tiny shells) + 1 Points glint ----------
  const group = new T.Group(); group.name = 'shells'; group.visible = false;
  const geo = new T.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new T.MeshStandardMaterial({ color: 0xf6e0cc, roughness: 0.45, metalness: 0, emissive: 0x3a2a22 });
  const inst = new T.InstancedMesh(geo, mat, MAX); inst.name = 'shellsInst'; inst.frustumCulled = false; inst.count = MAX;
  const pGeo = new T.BufferGeometry();
  const pPos = new Float32Array(MAX * 3), pCol = new Float32Array(MAX * 3);
  pGeo.setAttribute('position', new T.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new T.BufferAttribute(pCol, 3));
  const tex = glintTexture(T);
  const pMat = new T.PointsMaterial({ map: tex, size: 0.6, sizeAttenuation: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending, vertexColors: true, color: 0xfff4d6 });
  const glint = new T.Points(pGeo, pMat); glint.name = 'shellsGlint'; glint.frustumCulled = false;
  group.add(inst, glint);
  if (ctx.scene) ctx.scene.add(group);
  const M = new T.Matrix4(), Q = new T.Quaternion(), S = new T.Vector3(), P = new T.Vector3(), E = new T.Euler();
  const zero = new T.Matrix4().makeScale(0, 0, 0);
  const vis = new Uint8Array(MAX);

  const authority = () => ctx.role !== 'guest';
  const spotsNow = () => (st.seed === null ? [] : sparklesFor(st.seed));
  const live = () => { const n = islandNow(); return n && st.seed !== null && n.seed === st.seed ? n : null; };
  const changed = () => { rev++; };

  // Lay out the sparkles of the current seed; taken/pending spots scale to 0. Only on a change.
  function syncSparkles() {
    const sp = spotsNow();
    for (let k = 0; k < MAX; k++) {
      const s = sp[k], on = !!s && !st.taken[k] && !(pending[k] > 0);
      vis[k] = on ? 1 : 0;
      if (!on) { inst.setMatrixAt(k, zero); pPos[k * 3] = pPos[k * 3 + 1] = pPos[k * 3 + 2] = 0; pCol[k * 3] = pCol[k * 3 + 1] = pCol[k * 3 + 2] = 0; continue; }
      E.set(-0.12, (k * 2.39 + (st.seed & 7)) % (Math.PI * 2), 0.08); Q.setFromEuler(E);
      S.set(0.13, 0.05, 0.11); P.set(s.x, s.y + 0.01, s.z);
      M.compose(P, Q, S); inst.setMatrixAt(k, M);
      pPos[k * 3] = s.x; pPos[k * 3 + 1] = s.y + 0.14; pPos[k * 3 + 2] = s.z;
    }
    inst.instanceMatrix.needsUpdate = true;
    pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
    dirty = false; syncs++;
  }

  // ---------- conditions / gating ----------
  const cond = () => {
    const dn = peer ? peer('daynight') : null, num = v => (Number.isFinite(v) ? v : 0);
    return { night: num(dn?.night) > 0.5, storm: num(dn?.storm) > 0 || num(dn?.rain) > 0.3 };
  };
  const day = () => { const d = typeof ctx.dayIndex === 'function' ? ctx.dayIndex() : null; return Number.isInteger(d) && d >= 0 ? d : 0; };
  const heldKind = () => { const b = ctx.localBag ? ctx.localBag() : null; const s = b && b.slots ? b.slots[b.selectedIndex] : null; return s ? s.kind : null; };
  const safe = fn => { try { return fn(); } catch { return false; } };
  function canPick() {
    if (!ctx.running) return false;
    const p = ctx.physics; if (!p || p.swimming || p.diving) return false;
    if (safe(() => peer && peer('sit')?.seated?.())) return false;
    if (safe(() => peer && peer('paddleboard')?.riding?.())) return false;
    if (heldKind() === 'spade') return false;
    if (typeof ctx.uiOpen === 'function' && safe(() => ctx.uiOpen())) return false;
    return true;
  }
  function nearHere() {
    const now = live(), p = ctx.physics; if (!now || !p) return -1;
    const sp = spotsNow();
    let best = -1, bd = SHELL_CFG.PICK * SHELL_CFG.PICK;
    for (let k = 0; k < sp.length; k++) {
      if (st.taken[k] || pending[k] > 0) continue;
      const d = (p.x - now.cx - sp[k].x) ** 2 + (p.z - now.cz - sp[k].z) ** 2;
      if (d <= bd) { bd = d; best = k; }
    }
    return best;
  }

  // ---------- module hooks ----------
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    clock += dt;
    const isl = islandNow();
    if (authority()) {
      const seed = isl ? isl.seed : null;
      if (seed !== st.seed) { st.seed = seed; st.taken = seed === null ? [] : sparklesFor(seed).map(() => 0); st.paid = 0; pending.fill(0); changed(); dirty = true; }
    }
    for (let k = 0; k < MAX; k++) if (pending[k] > 0) { pending[k] -= dt; if (pending[k] <= 0) dirty = true; }
    if (dirty) syncSparkles();
    const now = live();
    group.visible = !!now;
    if (!now) return;
    group.position.set(now.cx, now.gy, now.cz);
    // twinkle: brightness per glint from a few sines (no allocation)
    for (let k = 0; k < MAX; k++) {
      const b = vis[k] ? 0.35 + 0.65 * Math.max(0, Math.sin(clock * 2.3 + k * 1.9)) ** 3 + 0.15 * Math.sin(clock * 7.1 + k) : 0;
      pCol[k * 3] = pCol[k * 3 + 1] = pCol[k * 3 + 2] = b > 0 ? b : 0;
    }
    pGeo.attributes.color.needsUpdate = true;
  }

  function serialize() {
    if (outRev !== rev || !out) {
      const book = {}; for (const id of Object.keys(st.book)) { const e = st.book[id]; book[id] = { n: e.n, day: e.day, by: e.by }; }
      out = { v: 1, seed: st.seed, taken: st.taken.slice(), paid: st.paid, sea: { day: st.sea.day, n: st.sea.n, p: st.sea.p | 0 }, book, sets: st.sets.slice() };
      outRev = rev;
    }
    return out;
  }

  const bookSig = s => { let r = s.sets.join(','); for (const id of SHELL_IDS) { const e = s.book[id]; r += e ? `|${e.n}${e.by[0]}${e.day}` : '|'; } return r; };
  function load(data, from) {
    if (from === 'net' && data === out) return;
    const c = clean(data);
    const sameBook = bookSig(c) === bookSig(st);
    let sameSpots = c.seed === st.seed && c.taken.length === st.taken.length;
    if (sameSpots) for (let k = 0; k < c.taken.length; k++) if (c.taken[k] !== st.taken[k]) { sameSpots = false; break; }
    const samePay = c.paid === st.paid && c.sea.day === st.sea.day && c.sea.n === st.sea.n && c.sea.p === st.sea.p;
    if (sameBook && sameSpots && samePay) return;
    if (!sameSpots && c.seed !== st.seed) pending.fill(0);
    if (!sameSpots) for (let k = 0; k < c.taken.length; k++) if (c.taken[k]) pending[k] = 0;
    st = c; changed();
    if (!sameSpots) syncSparkles();
  }

  function emitResult(r, actor, place) {
    const sp = shellById(r.kind);
    if (r.isNew) ctx.emit({ kind: 'notice', text: `New shell! ${sp.name} is in the Shell Book`, sound: 'chime' }, actor);
    else if (r.paid > 0) ctx.emit({ kind: 'notice', text: `+${r.paid} Bright Shell${r.paid > 1 ? 's' : ''} (${sp.name} again)`, sound: 'chime' }, actor);
    else ctx.emit({ kind: 'notice', text: place === 'beach' || st.seed !== null ? `${sp.name} again · Your pockets are full of shells for this island` : `${sp.name} again · Your pockets are full of shells for today`, sound: 'chime' }, actor);
    for (const id of r.sets) { const s = SETS.find(x => x.id === id); if (s) ctx.emit({ kind: 'notice', text: `${s.name} complete! A gift for the crew`, sound: 'chime' }, actor); }
    if (Object.keys(r.pay).length) ctx.emit({ kind: 'loot', text: payText(r.pay), loot: { ...r.pay }, sound: 'collect' }, actor);
  }

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || a.kind.slice(0, 7) !== 'shells.') return false;
    if (!authority()) return true;
    if (a.kind === 'shells.take') {
      const now = live(), p = actor === 'guest' ? ctx.other : ctx.physics;
      const pos = now && p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x - now.cx, z: p.z - now.cz } : null;
      const r = now ? applyTake(st, a, actor, pos, bag, cond(), day()) : { ok: false, reason: 'stale' };
      if (r.ok) { changed(); syncSparkles(); emitResult(r, actor, 'beach'); }
      else if (r.reason === 'full') ctx.emit({ kind: 'full', text: 'Your bag is full' }, actor);
      else if (r.reason === 'stale') ctx.emit({ kind: 'notice', text: 'The island drifted off' }, actor);
      else if (r.reason === 'reach') ctx.emit({ kind: 'notice', text: 'Get a little closer' }, actor);
      else if (r.reason === 'taken') ctx.emit({ kind: 'notice', text: 'Someone already picked that one up' }, actor);
      if (!r.ok && Number.isInteger(a.spot) && a.spot >= 0 && a.spot < MAX && actor !== 'guest') { pending[a.spot] = 0; syncSparkles(); }
      return true;
    }
    return true;
  }

  let forceSea = false;
  function observe(ev, actor) {
    if (!ev || ev.kind !== 'divegather' || !authority()) return;
    const bag = typeof ctx.actorBag === 'function' ? ctx.actorBag(actor) : null;
    const r = applySeaFind(st, { id: ev.id, type: ev.type, y: ev.y }, actor, bag, day(), { cond: cond(), force: forceSea });
    if (!r) return;
    if (r.ok) { changed(); emitResult(r, actor, 'sea'); }
    else if (r.reason === 'full') ctx.emit({ kind: 'full', text: 'Your bag is full: a shell slipped away' }, actor);
  }

  function interact() {
    if (!canPick()) return false;
    const k = nearHere(); if (k < 0) return false;
    const sent = ctx.action({ kind: 'shells.take', seed: st.seed, spot: k });
    if (sent !== false && !st.taken[k]) { pending[k] = 1.5; syncSparkles(); }
    return true;
  }
  function prompt() {
    if (!canPick() || nearHere() < 0) return null;
    return '<kbd>E</kbd> Pick up shell';
  }

  // ---------- logbook tab ----------
  function viewNow() { if (viewRev !== rev || !view) { view = bookView(st); viewRev = rev; } return view; }
  const tab = { id: 'shells', label: 'Shells', view: viewNow, render: shellsBookHTML };
  function logbookTabs(list) { if (Array.isArray(list)) list.push(tab); }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    geo.dispose(); mat.dispose(); pGeo.dispose(); pMat.dispose(); tex.dispose(); inst.dispose?.();
  }

  // ---------- QA helpers (raftDebug.content.shells) ----------
  const debug = {
    state: () => JSON.parse(JSON.stringify(serialize())),
    sparkles() {
      const now = islandNow();
      return spotsNow().map((s, i) => ({ i, taken: st.taken[i] || 0, lx: s.x, lz: s.z, x: (now ? now.cx : 0) + s.x, y: (now ? now.gy : 0) + s.y, z: (now ? now.cz : 0) + s.z }));
    },
    // Stand `off` metres inland of sparkle i, facing it. Returns {ok, yaw} or false.
    spawnAt(i = 0, off = 1.0) {
      const s = spotsNow()[i], I = typeof window !== 'undefined' ? window.raftDebug?.content?.islands : null;
      if (!s || !I) return false;
      const r = Math.hypot(s.x, s.z) || 1, x = s.x - s.x / r * off, z = s.z - s.z / r * off;
      if (!I.teleportAshore(x, z)) return false;
      return { ok: true, yaw: Math.atan2(-s.x / r, -s.z / r) }; // forward = (-sin yaw, -cos yaw) points outward at the sparkle
    },
    take(i = 0) { return ctx.action({ kind: 'shells.take', seed: st.seed, spot: i }); },
    give(id) { if (!authority() || !shellById(id)) return false; const e = st.book[id]; st.book = { ...st.book, [id]: e ? { ...e, n: e.n + 1 } : { n: 1, day: day(), by: 'host' } }; changed(); return true; },
    fill(withSets = false) { if (!authority()) return false; for (const id of SHELL_IDS) if (!st.book[id]) debug.give(id); if (withSets) st.sets = SETS.map(s => s.id); changed(); return true; },
    forceSea(on = true) { forceSea = !!on; return forceSea; },
    seaFind(id = '3,4', y = -8, actor = 'host') { const f = forceSea; forceSea = true; try { observe({ kind: 'divegather', type: 'sand', id, y }, actor); } finally { forceSea = f; } return debug.state(); },
    reset() { if (!authority()) return false; const seed = st.seed; st = DEFAULTS(); st.seed = seed; st.taken = seed === null ? [] : sparklesFor(seed).map(() => 0); pending.fill(0); changed(); syncSparkles(); return debug.state(); },
    view: () => viewNow(),
    syncs: () => syncs, // QA/tests: sparkle layout rebuilds
  };

  syncSparkles();
  return { name: 'shells', update, serialize, load, action, observe, interact, prompt, logbookTabs, debug, dispose };
}
