// Fishing & cooking glue: rod fishing v2, driftwood grills, fisher's journal, save/load, co-op, debug handle.
// createFishingCooking(T, host) -> api. The host adapter (see fcHost() in game.js) is the only engine access:
//   scene, raft, ocean, camera, signal, rodModel, role(), netReady(), send(o), action(a), notice(s, ms?), beep(f),
//   selectedKind(), aim(), rodTip(), player(), hasTile(x,z), decorAt(x,z), bagCount(k), running(), uiBlocked(), busy()
// api: pointerDown() pointerUp() releaseInput() interact() update(dt,time) applyAction(a,actor,bag) onNet(msg,from)
//      prompt rodReeling capture() dispose()
// Keys: G places a grill (4 wood + 2 scrap) on the aimed raft tile, J toggles the journal.
// Save: localStorage 'little-raft-fc-v1' {v:1, journal, grills}. Grills are the player's own (host world); while a
// guest, own grills are stashed and the host's broadcast grills are shown instead.
// Debug: window.raftFC = { state, session, journal, grills, forceBite(id), forceCatch(id) }.
import { FishingSession, createFishingV2 } from './fishing-v2.js?build=v3-survival-ae77fa84ac2b';
import { Journal, createJournalPanel, BASKET_MAX } from './fish-journal.js?build=v3-survival-ae77fa84ac2b';
import { SPECIES, speciesById, dishName } from './fish-species.js?build=v3-survival-ae77fa84ac2b';
import { GrillState, COOK_TUNING, cookTime, createGrillModel, createSmoke } from './cooking.js?build=v3-survival-ae77fa84ac2b';
import { createFishModel, setFishState, wiggle } from './fish-models.js?build=v3-survival-ae77fa84ac2b';

export const FC_SAVE_KEY = 'little-raft-fc-v1';
export const MAX_GRILLS = 6, GRILL_REACH = 2.2, GRILL_COST = Object.freeze({ wood: 4, scrap: 2 });
const FUEL_CAP = COOK_TUNING.maxFuel * COOK_TUNING.fuelPerWood;
const HAS_DOC = typeof document !== 'undefined';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const isGuest = (r) => r === 'guest';
const ESCAPE_TEXT = { early: 'Too early — wait for the dunk', missed: 'It got away…', snapped: 'The line slipped — ease off when it goes red' };
const CSS = `#fcChip{position:fixed;left:12px;bottom:12px;z-index:3;pointer-events:none;font:600 12px/1 system-ui,sans-serif;
color:#fffdf4;background:#0d2a3a99;padding:5px 9px;border-radius:10px;text-shadow:0 1px 1px #0008}
@media(max-width:760px){#fcChip{bottom:80px}} /* narrow: the centred hotbar reaches the left edge, so sit above it */
#fcToast{position:fixed;left:28px;top:20px;z-index:5;pointer-events:none;display:grid;gap:6px;justify-items:start;text-align:left}
#fcToast div{font:600 14px/1.3 system-ui,sans-serif;color:#1a3245;background:#f1e7d0f0;border:1px solid #c9a46b;border-radius:10px;
padding:7px 14px;box-shadow:0 4px 14px #0005;animation:fcIn .25s ease-out;transition:opacity .4s}
#fcToast div.soft{background:#d7e8f2f0;border-color:#8fb4c9}#fcToast div.out{opacity:0}
@keyframes fcIn{from{transform:translateY(-14px);opacity:0}}`;

function cleanFish(f) {
  const sp = f && speciesById(f.species);
  if (!sp || typeof f.cm !== 'number' || !(f.cm >= sp.minCm - 0.05 && f.cm <= sp.maxCm + 0.05)) return null;
  return { species: sp.id, cm: Math.round(f.cm * 10) / 10 };
}

export function createFishingCooking(T, host) {
  const { scene, raft, camera } = host;
  const signal = host.signal;
  let disposed = false, elapsed = 0, dirty = false;

  // ---------- load ----------
  let saved = null;
  try { const raw = store()?.getItem(FC_SAVE_KEY); if (raw) saved = JSON.parse(raw); } catch { saved = null; }
  const journal = new Journal(saved && saved.journal);

  // ---------- grills ----------
  const grillGroup = new T.Group(); grillGroup.name = 'fcGrills';
  const smoke = createSmoke(T, { max: 64 });
  scene?.add(smoke.points);
  const grills = new Map(); // id -> { st: GrillState, model, fish:[Group|null,...], smokeT }
  let stash = null, lastRole = host.role(), changed = false, netClock = 0, idSeq = 0;
  const tmp = new T.Vector3(), tmp2 = new T.Vector3();

  function addGrill(snap) {
    const st = new GrillState(snap);
    if (st.id == null) st.id = 'g' + Date.now().toString(36) + (idSeq++).toString(36);
    st.x = Math.round(st.x); st.z = Math.round(st.z);
    const model = createGrillModel(T);
    model.position.set(st.x * 2, 0.22, st.z * 2);
    grillGroup.add(model);
    const g = { st, model, fish: st.slots.map(() => null), smokeT: 0 };
    grills.set(st.id, g); syncFish(g); return g;
  }
  function removeGrill(g) {
    for (let i = 0; i < g.fish.length; i++) dropFish(g, i);
    grillGroup.remove(g.model); g.model.userData.dispose?.(); grills.delete(g.st.id);
  }
  function clearGrills() { for (const g of [...grills.values()]) removeGrill(g); }
  const snapshots = () => [...grills.values()].map((g) => g.st.snapshot());
  function loadGrills(list) { // own saved grills: sanitise first, then keep only those on an empty raft tile (one per tile)
    if (!Array.isArray(list)) return;
    for (const s of list) {
      if (grills.size >= MAX_GRILLS) break;
      if (!s || typeof s !== 'object') continue;
      const x = Math.round(Number(s.x)), z = Math.round(Number(s.z));
      if (Number.isFinite(x) && Number.isFinite(z) && host.hasTile(x, z) && !host.decorAt(x, z) && !grillAt(x, z)) addGrill(s);
    }
  }
  function dropFish(g, i) { const m = g.fish[i]; if (!m) return; g.model.remove(m); m.userData.dispose?.(); g.fish[i] = null; }
  function syncFish(g) {
    const pos = g.model.userData.slotPositions || [];
    g.st.slots.forEach((f, i) => {
      let m = g.fish[i];
      if (m && (!f || m.userData.speciesId !== f.species || m.userData.cm !== f.cm)) { dropFish(g, i); m = null; }
      if (!f) return;
      if (!m) {
        m = createFishModel(T, f.species, { cm: f.cm, state: f.state });
        m.userData.cm = f.cm;
        m.scale.setScalar(Math.min(1, 0.48 / (m.userData.length || f.cm / 100)));
        if (pos[i]) m.position.copy(pos[i]);
        m.position.y += 0.02; m.rotation.set(Math.PI / 2, Math.PI / 2 + (i ? 0.12 : -0.12), 0, 'YXZ'); // on its side across the grate, head away
        m.traverse((o) => { o.castShadow = false; }); // lies on the grate inside the box: shadow is invisible, skip the shadow draw
        g.model.add(m); g.fish[i] = m;
      } else if (m.userData.state !== f.state) setFishState(m, f.state);
    });
  }
  const grillAt = (x, z) => { for (const g of grills.values()) if (g.st.x === x && g.st.z === z) return g; return null; };
  // raft.matrixWorld is refreshed by the renderer every frame; localToWorld() would re-walk the parent chain per call.
  const worldOf = (g, out) => { out.set(g.st.x * 2, 0.22, g.st.z * 2); return raft ? out.applyMatrix4(raft.matrixWorld) : out; };
  loadGrills(saved && saved.grills);
  if (isGuest(lastRole)) { stash = snapshots(); clearGrills(); }
  // Grills live in the scene and copy the raft pose each frame: game.js rebuildRaft() removes AND disposes every
  // raft child on each build, which would free the grill + shared fish-cache GPU resources every time.
  const followRaft = () => { if (!raft) return; grillGroup.position.copy(raft.position); grillGroup.quaternion.copy(raft.quaternion); grillGroup.scale.copy(raft.scale); };
  followRaft(); (raft?.parent || scene)?.add(grillGroup);
  function syncRole() { // also run on net/save paths so a message arriving before the next frame sees the new role
    const role = host.role();
    if (role === lastRole) return role;
    if (isGuest(role)) { stash = snapshots(); clearGrills(); }
    else if (isGuest(lastRole)) { clearGrills(); loadGrills(stash); stash = null; }
    lastRole = role; markChanged(); return role;
  }
  const markChanged = () => { dirty = true; changed = true; };

  // ---------- local item delivery (cook/take results) ----------
  function receive(item) {
    const f = cleanFish(item); if (!f) return;
    const state = item.state === 'cooked' || item.state === 'burnt' ? item.state : 'raw';
    if (state !== 'raw') {
      const r = journal.recordDish(f.species, state);
      if (r && r.isNew) toast(`New dish! ${dishName(f.species, state)}`);
    }
    journal.addToBasket({ ...f, stars: item.stars || 1, state });
    dirty = true;
  }
  const give = (actor, item) => { if (actor === 'guest') host.send({ type: 'fc', took: item }); else receive(item); };

  // ---------- host-authoritative actions ----------
  function applyAction(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || isGuest(host.role())) return;
    const say = (t) => bag?.emit?.(t);
    if (a.kind === 'fc:placeGrill') {
      const x = Math.round(Number(a.x)), z = Math.round(Number(a.z));
      if (!Number.isFinite(x) || !Number.isFinite(z) || !host.hasTile(x, z) || host.decorAt(x, z) || grillAt(x, z)) return say('Grills go on an empty raft tile');
      if (grills.size >= MAX_GRILLS) return say(`That's plenty of grills (max ${MAX_GRILLS})`);
      if (bag.count('wood') < GRILL_COST.wood || bag.count('scrap') < GRILL_COST.scrap) return say('Need 4 wood and 2 scrap for a grill');
      if (!bag.remove('wood', GRILL_COST.wood)) return say('Need 4 wood and 2 scrap for a grill');
      if (!bag.remove('scrap', GRILL_COST.scrap)) { bag.add('wood', GRILL_COST.wood); return say('Need 4 wood and 2 scrap for a grill'); }
      addGrill({ x, z }); markChanged(); return say('Grill placed');
    }
    const g = grills.get(a.id); if (!g) return;
    const st = g.st;
    if (a.kind === 'fc:fuel') {
      if (st.fuel >= FUEL_CAP - 1e-6) return say('Fuel is full');
      if (bag.count('wood') < 1 || !bag.remove('wood', 1)) return say('Grill needs wood to light');
      const was = st.lit; st.addFuel(1); markChanged();
      return say(was ? `Added wood · fire ${Math.round(st.fuel)}s` : 'Fire lit');
    }
    if (a.kind === 'fc:cook') {
      const f = cleanFish(a.fish); if (!f) return;
      const slot = st.place(f);
      if (slot < 0) { give(actor, { ...f, state: 'raw' }); return say('The grill is full'); }
      if (bag?.count?.('fish') > 0) bag.remove('fish', 1); // the bag's classic fish item is the same catch: cooking uses it up
      syncFish(g); markChanged(); return say(`${speciesById(f.species).name} is on the grill`);
    }
    if (a.kind === 'fc:take') {
      let slot = Number.isInteger(a.slot) ? a.slot : st.slots.findIndex((s) => s && s.state !== 'raw');
      if (!st.slots[slot] || st.slots[slot].state === 'raw') return;
      const dish = st.slots[slot].state === 'cooked'; // a cooked dish is real food in the bag; a burnt one is journal-only
      if (dish && bag?.add && bag.add('cookedfish', 1) > 0) return say('Bag full: free a slot to take the fish'); // stays on the grill
      const item = st.take(slot); syncFish(g); markChanged();
      give(actor, item); return say(`Took ${dishName(item.species, item.state)}`);
    }
  }

  // ---------- network ----------
  function applySnapshots(list) {
    const seen = new Set();
    for (const s of list.slice(0, MAX_GRILLS)) {
      if (!s || s.id == null) continue;
      seen.add(s.id);
      const g = grills.get(s.id);
      if (g && g.st.x === Math.round(s.x) && g.st.z === Math.round(s.z)) { g.st = new GrillState(s); g.st.x = Math.round(g.st.x); g.st.z = Math.round(g.st.z); syncFish(g); }
      else { if (g) removeGrill(g); addGrill(s); }
    }
    for (const g of [...grills.values()]) if (!seen.has(g.st.id)) removeGrill(g);
  }
  function onNet(msg, from) {
    if (!msg || msg.type !== 'fc') return;
    syncRole();
    if (Array.isArray(msg.grills) && from === 'host' && isGuest(host.role())) applySnapshots(msg.grills);
    if (msg.took && from === 'host') receive(msg.took);
    if (msg.catchFx) { const sp = speciesById(msg.catchFx.species); if (sp) { host.notice(`Your friend caught a ${sp.name}!`); host.beep(520); } }
  }

  // ---------- save ----------
  let saveClock = 0;
  function save() {
    dirty = false; syncRole();
    try { store()?.setItem(FC_SAVE_KEY, JSON.stringify({ v: 1, journal: journal.snapshot(), grills: isGuest(host.role()) ? (stash || []) : snapshots() })); } catch {}
  }

  // ---------- DOM: chip, toast, journal ----------
  let chip = null, toastBox = null, chipN = -1, chipAt = -1e9, panel = null, ownStyle = null;
  const toasts = [];
  if (HAS_DOC) {
    if (!document.getElementById('fc-style-glue')) { ownStyle = document.createElement('style'); ownStyle.id = 'fc-style-glue'; ownStyle.textContent = CSS; document.head.appendChild(ownStyle); }
    chip = document.createElement('div'); chip.id = 'fcChip'; chip.setAttribute('aria-hidden', 'true'); document.body.appendChild(chip);
    toastBox = document.createElement('div'); toastBox.id = 'fcToast'; toastBox.setAttribute('role', 'status'); document.body.appendChild(toastBox);
  }
  function toast(text, soft = false) {
    if (!toastBox) return;
    while (toasts.length >= 2) toasts.shift().el.remove();
    const el = document.createElement('div'); el.textContent = text; if (soft) el.className = 'soft';
    toastBox.appendChild(el); toasts.push({ el, until: elapsed + 3 });
  }
  function updateDom() {
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i];
      if (elapsed > t.until + 0.45) { t.el.remove(); toasts.splice(i, 1); } else if (elapsed > t.until && !t.out) { t.out = true; t.el.classList.add('out'); }
    }
    if (!chip) return;
    const show = host.running();
    if (Math.abs(elapsed - chipAt) >= 0.5) { // speciesSeen() allocates: poll it at 2 Hz, not per frame
      chipAt = elapsed; const n = journal.speciesSeen().length;
      if (n !== chipN) { chipN = n; chip.textContent = `🎣 Fish ${n}/${SPECIES.length} · J`; }
    }
    if (chip.hidden === show) chip.hidden = !show;
  }
  function toggleJournal() {
    if (!HAS_DOC) return;
    panel ??= createJournalPanel({ getJournal: () => journal, onClose: () => { try { host.resume?.(); } catch {} } });
    if (!panel.isOpen) try { document.exitPointerLock?.(); } catch {} // free the cursor so the tabs can be clicked
    panel.toggle();
  }
  function placeGrillAtAim() {
    const p = host.aim()?.point; if (!p) return;
    tmp.copy(p); if (raft) raft.worldToLocal(tmp);
    const x = Math.round(tmp.x / 2), z = Math.round(tmp.z / 2);
    if (!host.hasTile(x, z) || host.decorAt(x, z) || grillAt(x, z)) return host.notice('Grills go on an empty raft tile');
    if (grills.size >= MAX_GRILLS) return host.notice(`That's plenty of grills (max ${MAX_GRILLS})`);
    if (host.bagCount('wood') < GRILL_COST.wood || host.bagCount('scrap') < GRILL_COST.scrap) return host.notice('Need 4 wood and 2 scrap for a grill');
    host.action({ kind: 'fc:placeGrill', x, z });
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || disposed || !host.running() || host.uiBlocked() || e.target?.matches?.('input, textarea, select, [contenteditable]')) return;
      if (e.code === 'KeyJ') toggleJournal();
      else if (e.code === 'KeyG') placeGrillAtAim();
    }, { signal });
    window.addEventListener('beforeunload', () => { if (!disposed) save(); }, { signal });
  }

  // ---------- fishing ----------
  const fx = createFishingV2(T, { scene, ocean: host.ocean });
  let session = null, downHeld = false;
  const origin = new T.Vector3(), castDir = new T.Vector3(0, 0, -1), tipV = new T.Vector3();
  const fxOpts = { tip: null, origin, dir: castDir, time: 0 }; // reused every frame (no per-frame object)
  const canFish = () => host.selectedKind() === 'fishingrod' && host.running() && !host.uiBlocked() && !host.busy();
  function clampToWater() { // push the landing point past raft tiles so the bobber lands in the water
    const pl = host.player(); origin.set(pl.x, pl.y, pl.z);
    const l = Math.hypot(castDir.x, castDir.z) || 1;
    for (let d = session.castDistance; d <= 24 && raft; d += 1) {
      tmp2.set(origin.x + castDir.x / l * d, raft.position.y, origin.z + castDir.z / l * d); raft.worldToLocal(tmp2);
      if (!host.hasTile(Math.round(tmp2.x / 2), Math.round(tmp2.z / 2))) { session.castDistance = d; return; }
    }
  }
  function pointerDown() {
    if (!canFish()) return false;
    // a click during the short caught/escaped linger recasts instead of being swallowed
    if (session && (session.stage === 'caught' || session.stage === 'escaped')) { session.cancel(); session = null; }
    session ??= new FishingSession({ night: false });
    session.press(); downHeld = true; return true;
  }
  function pointerUp() {
    if (!downHeld) return false;
    downHeld = false;
    if (!session) return true;
    const wasCharging = session.stage === 'charging';
    session.release();
    if (wasCharging && session.stage === 'flying') { camera.getWorldDirection(castDir); clampToWater(); }
    return true;
  }
  // Focus or pointer lock lost mid-press: the matching pointerup never arrives, so drop the hold here. A charging cast
  // is cancelled (a stale release would fire a full-power cast on the relock click); a reel hold just lets go.
  function releaseInput() {
    const was = downHeld; downHeld = false;
    if (session) { if (session.stage === 'charging') session.cancel(); else session.holding = false; }
    return was;
  }
  function cancelSession() { session?.cancel(); session = null; downHeld = false; } // game.js: the player passed out
  let held = null, heldT = 0;
  function dropHeld() { if (!held) return; held.parent?.remove(held); held.userData.dispose?.(); held = null; }
  function onCatch(c) {
    const sp = speciesById(c?.species); if (!sp) return;
    const prev = journal.entry(sp.id), res = journal.recordCatch(c);
    host.action({ kind: 'fish' });
    const stars = Math.max(1, Math.min(3, c.stars | 0 || 1));
    host.notice(`${sp.name} · ${c.cm.toFixed(1)} cm ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`, 2600);
    host.beep(sp.rarity === 'legendary' ? 880 : 660);
    if (sp.rarity === 'legendary') toast(`✦ Legendary! ${sp.name} ✦`);
    if (res.isNew) toast(`New species! ${sp.name} added to your journal`);
    else if (res.isRecord) toast(`New record! ${sp.name} ${c.cm.toFixed(1)} cm (was ${prev.bestCm.toFixed(1)})`);
    else if (sp.rarity !== 'legendary') toast(`Caught a ${sp.name} · ${c.cm.toFixed(1)} cm`);
    if (!res.basketed) toast('Basket full. Cook a few on a grill.', true);
    if (host.netReady() && host.role() !== 'solo') host.send({ type: 'fc', catchFx: { species: sp.id, cm: c.cm } });
    dropHeld();
    if (camera) {
      held = createFishModel(T, sp.id, { cm: c.cm, state: 'raw' });
      held.scale.setScalar(Math.min(1, 0.36 / (held.userData.length || c.cm / 100)));
      held.position.set(-0.1, -0.17, -0.6); held.rotation.set(0.15, 0.3, 0.45); // held up left of centre, clear of the rod
      held.traverse((o) => { o.renderOrder = 999; o.castShadow = false; }); // viewmodel: no shadow pass
      camera.add(held); heldT = 2.2;
    }
    dirty = true;
  }
  function onFishEvent(ev) {
    switch (ev.kind) {
      case 'landed': host.beep(620); break;
      case 'nibble': host.beep(900); break;
      case 'bite': host.beep(180); host.notice('Bite! Click!', 1100); break;
      case 'missed': host.notice('It nibbled and swam off… stay ready'); break;
      case 'caught': onCatch(ev.catch); break;
      case 'escaped': host.notice(ESCAPE_TEXT[ev.reason] || ESCAPE_TEXT.missed, 2200); if (ev.reason === 'snapped') toast('The line slipped. It got away!', true); break;
    }
  }

  // ---------- interaction / prompt ----------
  let near = null, nextAct = null, prompt = '', promptClock = 0;
  const rawIndex = () => { for (let i = journal.basket.length - 1; i >= 0; i--) if (journal.basket[i].state === 'raw') return i; return -1; };
  function computePrompt() {
    nextAct = null; near = null;
    if (!host.running()) return '';
    if (session && session.stage !== 'idle' && session.stage !== 'done') {
      const s = session.stage;
      return s === 'reeling' ? 'Hold to reel · let go when it turns red' : s === 'bite' ? '<kbd>Click</kbd> Strike!'
        : s === 'waiting' || s === 'nibble' ? 'Waiting for a bite… (click early and it’ll spook)' : '';
    }
    const pl = host.player(); let best = GRILL_REACH * GRILL_REACH;
    for (const g of grills.values()) { worldOf(g, tmp); const d = (tmp.x - pl.x) ** 2 + (tmp.z - pl.z) ** 2; if (d <= best) { best = d; near = g; } }
    if (!near) return '';
    const st = near.st, wood = host.bagCount('wood'), ri = rawIndex(), free = st.slots.indexOf(null);
    let status = '';
    st.slots.forEach((f) => {
      if (!f) return;
      const ct = cookTime(f);
      const s = f.state === 'burnt' ? 'charred' : f.state === 'cooked' ? (f.t > ct + 12 ? 'burning!' : 'ready!') : `cooking ${Math.max(1, Math.ceil(ct - f.t))}s`;
      if (!status || s === 'burning!' || s === 'ready!') status = s;
    });
    const tail = status ? ` · ${status}` : '';
    const done = st.slots.findIndex((f) => f && f.state !== 'raw');
    if (done >= 0 && journal.basket.length >= BASKET_MAX && journal.basket.every((b) => b.state === 'raw')) return 'Basket full of raw fish · cook some first' + tail;
    if (done >= 0) { nextAct = { kind: 'fc:take', id: st.id, slot: done }; return `<kbd>E</kbd> Take ${esc(dishName(st.slots[done].species, st.slots[done].state))}${tail}`; }
    if (!st.lit) {
      if (wood > 0) { nextAct = { kind: 'fc:fuel', id: st.id }; return `<kbd>E</kbd> Add fuel (wood)${tail}`; }
      return 'Grill needs wood to light' + tail;
    }
    if (free >= 0 && ri >= 0) {
      const f = journal.basket[ri]; nextAct = { kind: 'fc:cook', id: st.id, basket: ri };
      return `<kbd>E</kbd> Grill ${esc(speciesById(f.species).name)} (${f.cm.toFixed(1)} cm)${tail}`;
    }
    if (st.fuel < FUEL_CAP - COOK_TUNING.fuelPerWood * 0.5 && wood > 0) { nextAct = { kind: 'fc:fuel', id: st.id }; return `<kbd>E</kbd> Add fuel (wood) · ${Math.round(st.fuel)}s left${tail}`; }
    if (status) return `Grill${tail}`;
    if (free >= 0 && ri < 0) return 'Catch a fish to cook here';
    return st.fuel >= FUEL_CAP - COOK_TUNING.fuelPerWood ? 'Fire is roaring (full)' : `Grill · fire ${Math.round(st.fuel)}s`;
  }
  function interact() {
    if (!host.running() || host.uiBlocked()) return false;
    prompt = computePrompt(); promptClock = 0;
    const a = nextAct; if (!a) return false;
    if (a.kind === 'fc:cook') {
      const item = journal.takeFromBasket(a.basket); if (!item) return false;
      if (!host.action({ kind: 'fc:cook', id: a.id, fish: { species: item.species, cm: item.cm } })) journal.addToBasket(item);
      dirty = true;
    } else host.action(a);
    host.beep(500); prompt = computePrompt();
    return true;
  }

  // ---------- frame ----------
  function update(dt, time = elapsed + dt) {
    if (disposed) return;
    dt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0; elapsed = time;
    const role = syncRole();
    followRaft(); if (!grillGroup.parent) (raft?.parent || scene)?.add(grillGroup);
    // fishing
    if (session && (host.selectedKind() !== 'fishingrod' || !host.running())) { session.cancel(); downHeld = false; }
    else if (downHeld && host.uiBlocked()) { // a dialog took the pointer: its pointerup never reaches the canvas
      downHeld = false; if (session) { if (session.stage === 'charging') session.cancel(); else session.release(); }
    }
    if (session) { const ev = session.update(dt); if (ev) onFishEvent(ev); }
    const tip = host.rodTip(); if (tip) tipV.copy(tip);
    const pl = host.player(); origin.set(pl.x, pl.y, pl.z);
    fxOpts.tip = tip ? tipV : null; fxOpts.time = time;
    fx.update(dt, session, fxOpts);
    if (session && session.stage === 'done') session = null;
    const out = !!session && session.stage !== 'idle' && session.stage !== 'charging';
    const ud = host.rodModel?.userData;
    if (out && ud) { if (ud.float) ud.float.visible = false; if (ud.leader) ud.leader.visible = false; }
    if (held) { heldT -= dt; wiggle(held, time, 1.2); if (heldT <= 0) dropHeld(); }
    // grills
    const sim = !isGuest(role), cookDt = host.running() ? dt : 0; // title screen / paused: food and fuel hold, fire still flickers
    for (const g of grills.values()) {
      const st = g.st, evs = st.update(cookDt);
      if (evs.length) {
        syncFish(g);
        if (sim) {
          changed = true; dirty = true;
          worldOf(g, tmp); const close = Math.hypot(tmp.x - pl.x, tmp.z - pl.z) < 10;
          for (const e of evs) {
            const f = st.slots[e.slot];
            if (e.kind === 'cooked' && f && close) { host.notice(`${dishName(f.species, 'cooked')} is ready!`); host.beep(760); }
            else if (e.kind === 'burnt' && f && close) host.notice(`Oh no, ${speciesById(f.species)?.name ?? 'the fish'} got a bit charred`);
            else if (e.kind === 'out' && !e.idle && close) host.notice('The fire died down');
          }
        }
      }
      const burning = st.burning;
      g.model.userData.setFire?.(burning ? 0.35 + 0.65 * Math.min(1, st.fuel / FUEL_CAP) : 0);
      g.model.userData.update?.(dt, time);
      if (burning) {
        let dark = false, cooking = false;
        for (const f of st.slots) if (f) { cooking = true; if (f.state === 'burnt' || (f.state === 'cooked' && f.t > cookTime(f) + 12)) dark = true; }
        g.smokeT += dt * (dark ? 6 : cooking ? 3 : 1);
        if (g.smokeT >= 1) {
          g.smokeT -= Math.floor(g.smokeT);
          tmp.copy(g.model.userData.smokeAnchor || tmp.set(0, 0.6, 0)).add(g.model.position); // grillGroup mirrors the raft pose (followRaft)
          if (raft) tmp.applyMatrix4(raft.matrixWorld);
          smoke.emit(tmp.x, tmp.y, tmp.z, 1, dark);
        }
      }
    }
    smoke.update(dt);
    // network
    if (role === 'host' && host.netReady()) {
      netClock += dt;
      if (changed || netClock >= 0.5) { netClock = 0; changed = false; host.send({ type: 'fc', grills: snapshots() }); }
    } else changed = false;
    // prompt, dom, save
    promptClock -= dt;
    if (promptClock <= 0) { promptClock = 0.15; prompt = computePrompt(); }
    updateDom();
    saveClock += dt;
    if (saveClock >= 3) { saveClock = 0; if (dirty) save(); }
  }

  function dispose() {
    if (disposed) return;
    save(); disposed = true;
    session?.cancel(); session = null; dropHeld();
    for (const g of [...grills.values()]) removeGrill(g);
    grillGroup.parent?.remove(grillGroup);
    scene?.remove(smoke.points); smoke.dispose(); fx.dispose();
    panel?.destroy(); chip?.remove(); toastBox?.remove();
    if (HAS_DOC && !document.getElementById('fcChip')) document.getElementById('fc-style-glue')?.remove(); // hot swap: the new engine still uses it
    if (typeof window !== 'undefined' && window.raftFC === debug) delete window.raftFC;
  }

  // ---------- debug ----------
  const debug = {
    get state() {
      return { stage: session ? session.stage : 'idle', tension: session ? session.tension : 0, progress: session ? session.progress : 0,
        catch: session ? session.catch : null, grills: snapshots(), basket: journal.basket.map((b) => ({ ...b })), journalCount: journal.totalCaught };
    },
    get session() { return session; }, journal, grills,
    forceBite(id) {
      if (!session || session.stage === 'idle') { session = new FishingSession({ night: false }); session.startCharge(); session.release(); camera?.getWorldDirection(castDir); clampToWater(); }
      return session.debugForceBite(id);
    },
    forceCatch(id) { const sp = speciesById(id) || SPECIES[0]; onCatch({ species: sp.id, cm: Math.round((sp.minCm + sp.maxCm) * 5) / 10, stars: 2 }); return true; },
  };
  if (typeof window !== 'undefined') window.raftFC = debug;

  return {
    pointerDown, pointerUp, releaseInput, cancelSession, interact, update, applyAction, onNet, dispose,
    get prompt() { return prompt; },
    hasGrill: (x, z) => !!grillAt(x, z), // game.js keeps decor off grill tiles
    dropTile(x, z) { const g = grillAt(x, z); if (!g || isGuest(host.role())) return false; removeGrill(g); markChanged(); return true; }, // shark lane: a destroyed foundation takes its grill with it
    get rodReeling() { return !!session && session.stage === 'reeling' && session.holding; },
    resetWorld() { syncRole(); clearGrills(); stash = isGuest(lastRole) ? [] : null; journal.basket.length = 0; markChanged(); save(); }, // game.js newGame(): grills and basket belong to the old raft; species/cookbook stay
    capture() { save(); return { v: 1, journal: journal.snapshot(), grills: isGuest(lastRole) ? (stash || []) : snapshots() }; },
    // test/QA helpers
    journal, grills, save,
  };
}
