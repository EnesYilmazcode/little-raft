// Little Raft progression integration: the ONE object game.js talks to (attachProgression(ctx)).
// Owns per-actor Progression (host + guest), cooking stations (StationModel per placed smelter/grill,
// keyed "x,z"), the research dialog, the station panel, item tooltips, the binoculars HUD and
// persistence in localStorage 'littleRaft.progression.v1'.
//
// Authority: the host (or solo player) runs everything. A guest's progression and the station
// contents live on the host (saved in the host's progression slot 'guest', like guestBag); the
// guest only renders the snapshots the host sends ({kind:'prog:sync'} effects) and sends
// 'prog:*' actions. Limits: guest progression is tied to the host's save (a guest starts fresh on
// another host's raft), and guest station/research views lag by one sync (~0.3 s).
import { exitLock } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';
import { ITEMS, FUEL_VALUE, toolRole, stationExtraRecipes } from './items.js?build=v3-survival-ae77fa84ac2b';
import { Progression } from './progression.js?build=v3-survival-ae77fa84ac2b';
import { StationModel } from './smelter.js?build=v3-survival-ae77fa84ac2b';
import { createStationPanel } from './smelter-ui.js?build=v3-survival-ae77fa84ac2b';
import { createSmelterModel, createResearchTableModel, createGrillModel, setSmelterGlow } from './smelter-model.js?build=v3-survival-ae77fa84ac2b';
import { installItemTooltips } from './item-tooltips.js?build=v3-survival-ae77fa84ac2b';
import { createRecyclerModel } from './recycler-model.js?build=v3-survival-ae77fa84ac2b'; // [recycler]

export const PROGRESSION_KEY = 'littleRaft.progression.v1';
const REACH = 2.2, NOTE_EVERY = 0.5, SAVE_EVERY = 2, SYNC_EVERY = 0.3;
const AIM_R = 0.8, AIM_LIFT = 0.5; // content hook: E needs the aim ray within 0.8 m of the station centre (deck + 0.5 m)
// Distance (m) from a station centre (sx, deck + AIM_LIFT, sz) to the aim ray, Infinity when the ray misses the deck
// (sky) or the station is behind the player. aim = {point: deck-plane hit, dir: unit view dir}, me = {x, z}.
export function aimMiss(aim, sx, sz, me) {
  const p = aim?.point, d = aim?.dir; if (!p || !d) return Infinity;
  const wx = sx - p.x, wy = AIM_LIFT, wz = sz - p.z, t = wx * d.x + wy * d.y + wz * d.z; // t < 0: towards the eye
  const reach = me ? Math.hypot(p.x - me.x, p.z - me.z) / (Math.hypot(d.x, d.z) || 1e-6) : Infinity;
  if (t > AIM_R || t < -reach - AIM_R) return Infinity;
  const cx = wy * d.z - wz * d.y, cy = wz * d.x - wx * d.z, cz = wx * d.y - wy * d.x;
  return Math.hypot(cx, cy, cz);
}
const COOKERS = new Set([...Object.values(ITEMS).map((it) => it.recipe?.station).filter(Boolean),
  ...Object.keys(ITEMS).filter((id) => stationExtraRecipes(id))]); // [recycler] + fuel-free stations
const STATIONS = new Set(Object.keys(ITEMS).filter((id) => ITEMS[id].category === 'station'));
const MODELS = { smelter: createSmelterModel, researchtable: createResearchTableModel, grill: createGrillModel, recycler: createRecyclerModel };
const nameOf = (k) => ITEMS[k]?.name ?? k;
const isHand = (id) => !!ITEMS[id]?.recipe && ITEMS[id].recipe.station == null;
const keyOf = (d) => d.x + ',' + d.z;
const joinAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const posInt = (n) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
// Hand recipes every pre-progression build offered; old raft saves keep them learned.
const LEGACY_RECIPES = ['rope', 'hook', 'hammer', 'fishingrod', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate'];
// [recycler] station panel wording; stations not listed keep the cooking copy.
const PANEL_COPY = Object.freeze({
  recycler: Object.freeze({ input: 'To sort', none: 'No junk in your bag to sort.', busy: 'Sorting', idle: 'Pick some junk from your bag to sort.', nothing: 'Nothing here to sort.' }),
});
// The live instance that may write PROGRESSION_KEY (hot reload mounts the new engine before disposing the old one).
const OWNER = Symbol.for('littleRaft.progression.owner');

function load() {
  try { const v = JSON.parse(localStorage.getItem(PROGRESSION_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/**
 * ctx: { T, role(), ready(), running(), world(), bag(actor), localBag(), action(a), emit(e, to),
 *        notice(text, ms), pose() -> {x, z, yaw}, resume(), pause() }
 */
export function attachProgression(ctx) {
  const prevOwner = globalThis[OWNER];
  try { prevOwner?.flush?.(); } catch {} // hot reload: the old engine's latest state, not its last autosave
  const saved = load();
  const progs = { host: new Progression(saved.host), guest: new Progression(saved.guest) };
  // Per-world barrel bad-luck counters; rollBarrel(rand, barrelLuck) mutates them in place.
  const barrelLuck = { misses: {} };
  if (saved.barrelLuck?.misses && typeof saved.barrelLuck.misses === 'object') {
    for (const [k, n] of Object.entries(saved.barrelLuck.misses)) if (Number.isFinite(n) && n > 0) barrelLuck.misses[k] = Math.floor(n);
  }
  const self = { flush: () => save() };
  globalThis[OWNER] = self;
  const stations = new Map(); // key -> StationModel (host only)
  const pendingStations = saved.stations && typeof saved.stations === 'object' ? { ...saved.stations } : {};
  const remote = { prog: null, stations: {}, views: new Map() }; // guest-side mirror of the host
  const models = new Map(); // key -> THREE.Group (glowing stations), pruned when detached
  const glow = new Map();
  let noteClock = NOTE_EVERY, saveClock = 0, syncClock = 0, time = 0, dirty = false, nearKey = null;
  let savedLuckSig = JSON.stringify(barrelLuck.misses);
  let panel = null, research = null, tooltips = null, hud = null, gateCache = null;

  const isRemote = () => ctx.role() === 'guest' && !!ctx.ready();
  const isHost = () => ctx.role() !== 'guest';
  const myProg = () => (isRemote() ? (remote.prog ??= new Progression()) : progs.host);
  const decor = () => (Array.isArray(ctx.world()?.decor) ? ctx.world().decor : []);
  const say = (text, actor) => ctx.emit({ kind: 'notice', text }, actor);
  const announce = (ids, actor) => {
    const names = ids.filter((id) => ITEMS[id]).map(nameOf);
    if (names.length) { ctx.emit({ kind: 'unlock', text: `New recipe${names.length > 1 ? 's' : ''}: ${joinAnd(names)}!` }, actor); gateCache = null; dirty = true; }
  };

  // ---------- host: stations follow the decor ----------
  function syncStations() {
    const live = new Set();
    for (const d of decor()) {
      if (!STATIONS.has(d.type)) continue;
      for (const actor of ['host', 'guest']) if (!progs[actor].stations.has(d.type)) announce(progs[actor].notePlaced(d.type), actor);
      if (!COOKERS.has(d.type)) continue;
      const key = keyOf(d); live.add(key);
      const cur = stations.get(key);
      if (cur && cur.stationId === d.type) continue;
      const snap = pendingStations[key]?.station === d.type ? pendingStations[key] : null;
      delete pendingStations[key];
      stations.set(key, new StationModel(d.type, snap)); dirty = true;
    }
    for (const key of [...stations.keys()]) if (!live.has(key)) { stations.delete(key); dirty = true; if (panel?.isOpen && panel.stationId === key) panel.close(); }
  }
  const stationSnaps = () => Object.fromEntries([...stations].map(([k, s]) => [k, s.snapshot()]));
  // [undecor] pick up a placed station: refuse mid-cook, return input + output; idle fuel units are not items.
  const stationOf = (d) => { if (!d || !COOKERS.has(d.type)) return null; const k = keyOf(d), s = stations.get(k); if (s) return s.stationId === d.type ? s : null; const p = pendingStations[k]; return p?.station === d.type ? new StationModel(d.type, p) : null; };
  function beforeUndecor(d) { const s = stationOf(d); return s && (s.progress > 0 || (s.input && s.fuelUnits > 0)) ? "It's still cooking" : null; }
  function undecorLoot(d) { const s = stationOf(d); if (!s) return null; const out = []; for (const x of [s.input, s.output]) if (x && x.count > 0) out.push([x.kind, x.count]); return out; }
  function afterUndecor(d) { if (!d || !COOKERS.has(d.type)) return; const k = keyOf(d); if (stations.delete(k)) dirty = true; if (k in pendingStations) { delete pendingStations[k]; dirty = true; } if (panel?.isOpen && panel.stationId === k) panel.close(); }

  function save() {
    if (!isHost() || globalThis[OWNER] !== self) return;
    dirty = false;
    try {
      localStorage.setItem(PROGRESSION_KEY, JSON.stringify({ v: 1, host: progs.host.snapshot(), guest: progs.guest.snapshot(), stations: { ...pendingStations, ...stationSnaps() }, barrelLuck }));
    } catch {}
  }

  // ---------- station view (host model or guest mirror) ----------
  function stationView(key) {
    if (!isRemote()) return stations.get(key) || null;
    const snap = remote.stations[key]; if (!snap) return null;
    let v = remote.views.get(key);
    if (!v || v._snap !== snap) { v = new StationModel(snap.station, snap); v._snap = snap; remote.views.set(key, v); }
    return v;
  }

  // ---------- host-side actions ----------
  function apply(a, actor) {
    if (a.kind === 'craft' && typeof a.recipe === 'string' && ITEMS[a.recipe]) {
      const p = progs[actor] ?? progs.host;
      if (p.isUnlocked(a.recipe)) return false;
      say(`${nameOf(a.recipe)} is locked: ${p.whyLocked(a.recipe)}`, actor); return true;
    }
    if (typeof a.kind !== 'string' || !a.kind.startsWith('prog:')) return false;
    const bag = ctx.bag(actor), p = progs[actor] ?? progs.host;
    if (a.kind === 'prog:research') {
      const r = p.research(String(a.item), { has: bag });
      if (r.ok) { ctx.emit({ kind: 'craft', text: `Researched ${nameOf(a.item)}` }, actor); announce(r.unlocked, actor); dirty = true; gateCache = null; }
      else say(r.reason, actor);
      return true;
    }
    const st = stations.get(String(a.key)); if (!st || !bag) return true;
    const item = String(a.item ?? ''), want = Math.min(posInt(a.n) || 1, bag.count(item));
    if (a.kind === 'prog:insert' || a.kind === 'prog:fuel') {
      if (want <= 0) return true;
      const got = a.kind === 'prog:insert' ? st.insert(item, want) : st.addFuel(item, want);
      if (got > 0) bag.remove(item, got);
    } else if (a.kind === 'prog:take' || a.kind === 'prog:takeInput') {
      const out = a.kind === 'prog:take' ? st.output : st.input; if (!out) return true;
      const left = bag.add(out.kind, out.count);
      if (left === out.count) { ctx.emit({ kind: 'full', text: 'Your bag is full' }, actor); return true; }
      if (a.kind === 'prog:take') {
        st.output = left > 0 ? { kind: out.kind, count: left } : null;
        if (ITEMS[out.kind]?.category === 'food') ctx.observe?.({ kind: 'cook', item: out.kind }, actor); // [tasks]
        if (st.stationId === 'recycler') ctx.emit({ kind: 'loot', text: 'The sea looks a little cleaner.' }, actor); // [recycler]
      } else { st.takeInput(); if (left > 0) st.input = { kind: out.kind, count: left }; }
    }
    dirty = true; syncClock = SYNC_EVERY; return true;
  }

  // ---------- guest-side effects ----------
  function effect(e) {
    if (e.kind !== 'prog:sync') return false;
    if (!isRemote()) return true; // host never adopts snapshots it did not make
    if (e.prog && typeof e.prog === 'object') { remote.prog = new Progression(e.prog); gateCache = null; }
    if (e.stations && typeof e.stations === 'object') remote.stations = e.stations;
    return true;
  }

  // ---------- UI ----------
  const act = (a) => { ctx.action(a); later(); };
  const later = () => setTimeout(() => { panel?.update(); renderResearch(true); }, isRemote() ? 350 : 0);
  function openStation(key) {
    panel ??= createStationPanel({
      getStation: (k) => stationView(k), getBag: () => ctx.localBag(), items: ITEMS, fuelValue: FUEL_VALUE, copy: PANEL_COPY,
      onInsert: (k, n) => act({ kind: 'prog:insert', key: panel.stationId, item: k, n }),
      onFuel: (k, n) => act({ kind: 'prog:fuel', key: panel.stationId, item: k, n }),
      onTake: () => act({ kind: 'prog:take', key: panel.stationId }),
      onTakeInput: () => act({ kind: 'prog:takeInput', key: panel.stationId }),
      onOpen: () => ctx.pause?.(), onClose: () => ctx.resume?.(),
    });
    panel.open(key);
  }

  const RCSS = `#researchPanel{padding:0;margin:auto;border:0;background:transparent;width:min(420px,94vw);color:#fff2cc;font:500 14px/1.35 'Segoe UI',system-ui,sans-serif}
#researchPanel::backdrop{background:rgba(12,9,5,.42)}
#researchPanel .rp-wrap{padding:12px;border-radius:6px;background:linear-gradient(#b48d55,#8a663a);border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a;outline:none}
#researchPanel .rp-head{display:flex;justify-content:space-between;align-items:center;margin:-2px 2px 10px}
#researchPanel h2{margin:0;font:800 19px/1.1 system-ui,sans-serif;font-family:inherit;color:#2a1b0e}
#researchPanel .rp-x{width:30px;height:30px;border:0;border-radius:4px;background:#3a2716;color:#fff2cc;font:700 18px/1 sans-serif;cursor:pointer}
#researchPanel section{background:#3a2716eb;border-radius:4px;padding:10px;margin-top:8px}
#researchPanel .rp-sub{margin:0 0 6px;font:700 11px/1 sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#d9c9a6}
#researchPanel .rp-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid #b48d5533}
#researchPanel .rp-row:first-of-type{border-top:0}
#researchPanel .rp-row small{display:block;color:#d9c9a6;font-size:12px}
#researchPanel button.rp-go{padding:5px 10px;border:0;border-radius:3px;background:linear-gradient(#ffcf7d,#e9a24a);color:#2a1b0e;font:800 12px/1 sans-serif;cursor:pointer;box-shadow:0 2px 0 #8a5a26}
#researchPanel button.rp-go:disabled{opacity:.4;cursor:default}
#researchPanel .rp-none{margin:0;color:#bfae8a;font-size:13px}`;
  let researchSig = '';
  function renderResearch(force) {
    if (!research?.open) return;
    const p = myProg(), bag = ctx.localBag();
    const list = p.researchable(), goals = p.nextGoals(3);
    const has = (k) => (bag?.count?.(k) ?? 0) > 0;
    const sig = JSON.stringify([list.map((k) => k + has(k)), goals.map((g) => g + p.whyLocked(g)), [...p.researched]]);
    if (!force && sig === researchSig) return;
    researchSig = sig;
    const rows = list.map((k) => `<div class="rp-row"><span>${esc(nameOf(k))}<small>${has(k) ? 'Your item stays in your bag' : 'Bring one in your bag'}</small></span>
      <button type="button" class="rp-go" data-research="${esc(k)}"${has(k) ? '' : ' disabled'}>Research</button></div>`).join('');
    const goalRows = goals.map((g) => `<div class="rp-row"><span>${esc(nameOf(g))}<small>${esc(p.whyLocked(g))}</small></span></div>`).join('');
    const done = [...p.researched].map(nameOf);
    research.querySelector('.rp-body').innerHTML =
      `<section><p class="rp-sub">Research</p>${rows || '<p class="rp-none">Nothing new to study. Find new things in barrels!</p>'}</section>`
      + `<section><p class="rp-sub">Next goals</p>${goalRows || '<p class="rp-none">You have learned everything!</p>'}</section>`
      + (done.length ? `<section><p class="rp-sub">Researched</p><p class="rp-none">${esc(done.join(', '))}</p></section>` : '');
  }
  function openResearch() {
    if (!research) {
      if (!document.getElementById('research-style')) { const st = document.createElement('style'); st.id = 'research-style'; st.textContent = RCSS; document.head.append(st); }
      research = document.createElement('dialog'); research.id = 'researchPanel';
      research.innerHTML = `<div class="rp-wrap" tabindex="-1"><div class="rp-head"><h2>${esc(nameOf('researchtable'))}</h2><button type="button" class="rp-x" aria-label="Close">×</button></div><div class="rp-body"></div></div>`;
      research.addEventListener('click', (e) => {
        if (e.target === research || e.target.closest('.rp-x')) { research.close(); return; }
        const b = e.target.closest('[data-research]'); if (b && !b.disabled) act({ kind: 'prog:research', item: b.dataset.research });
      });
      research.addEventListener('close', () => ctx.resume?.());
      document.body.append(research);
    }
    ctx.pause?.();
    exitLock(document); // marked page-initiated (lock-rules.js), so the game does not pause on it
    if (!research.open) { try { research.showModal(); } catch { research.setAttribute('open', ''); } }
    renderResearch(true);
  }

  // Nearest station (decor) within reach of the player; the aim point breaks ties.
  // aimed (content hook): also require the aim ray to pass near it, so E at the sky or a crate is not stolen.
  function stationNear(aim, aimed) {
    const me = ctx.pose(); let best = null, bestD = Infinity;
    for (const d of decor()) {
      if (!STATIONS.has(d.type)) continue;
      const dist = Math.hypot(d.x * 2 - me.x, d.z * 2 - me.z); if (dist > REACH) continue;
      if (aimed && aimMiss(aim, d.x * 2, d.z * 2, me) > AIM_R) continue; // content hook
      const score = aim?.point ? Math.hypot(d.x * 2 - aim.point.x, d.z * 2 - aim.point.z) : dist;
      if (score < bestD) { bestD = score; best = d; }
    }
    return best;
  }
  function interact(aim) {
    const d = stationNear(aim, !!aim); if (!d) return false; // content hook: aim-aware when game.js passes an aim
    if (d.type === 'researchtable') openResearch(); else openStation(keyOf(d));
    return true;
  }

  // Survival-UI recipe gate: unlocked -> null; the 3 nearest hand-recipe goals -> greyed with reason; rest hidden.
  function recipeGate(id) {
    if (!ITEMS[id]) return null;
    const p = myProg();
    if (p.isUnlocked(id)) return null;
    if (!gateCache || gateCache.p !== p) gateCache = { p, goals: new Set(p.nextGoals(99).filter(isHand).slice(0, 3)) };
    return gateCache.goals.has(id) ? { locked: true, reason: p.whyLocked(id) } : { hidden: true };
  }

  // ---------- binoculars HUD ----------
  function updateHud() {
    const kind = ctx.localBag()?.selected?.kind ?? null;
    const show = !!ctx.running() && toolRole(kind) === 'binoculars';
    if (!show) { if (hud) hud.hidden = true; return; }
    if (!hud) {
      hud = document.createElement('div'); hud.id = 'binocularsHud'; hud.setAttribute('role', 'status');
      hud.style.cssText = 'position:fixed;left:calc(50% + 34px);top:calc(50% + 2px);transform:none;color:#f6ecd6;opacity:.88;font:500 13px/1.25 var(--ui-font,system-ui,sans-serif);text-shadow:0 1px 2px rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.55);pointer-events:none;z-index:30;white-space:nowrap;text-align:left'; // muted line atop the crosshair-side prompt column, never a centred panel
      document.body.append(hud);
    }
    const me = ctx.pose(); let best = null, bd = Infinity;
    for (const it of ctx.world()?.items ?? []) if (it.type === 'barrel') { const dd = Math.hypot(it.x - me.x, it.z - me.z); if (dd < bd) { bd = dd; best = it; } }
    let text = 'No barrels in sight';
    if (best) {
      const vx = best.x - me.x, vz = best.z - me.z, s = Math.sin(me.yaw), c = Math.cos(me.yaw);
      const ahead = -vx * s - vz * c, side = vx * c - vz * s;
      const ang = Math.abs(Math.atan2(side, ahead)) * 180 / Math.PI, lr = side > 0 ? 'right' : 'left';
      const dir = ang < 15 ? 'ahead' : ang < 70 ? 'ahead-' + lr : ang < 110 ? lr : ang < 165 ? 'behind-' + lr : 'behind';
      text = `Barrel ${Math.round(bd)} m ${dir}`;
    }
    if (hud.textContent !== text) hud.textContent = text;
    hud.hidden = false;
  }

  // ---------- per frame ----------
  const nodeCache = new WeakMap(); // station group -> {glow, ingot, crank, pile}
  function tick(dt) {
    time += dt;
    if (isHost()) {
      syncStations();
      for (const st of stations.values()) { const was = st.cooking; if (was) dirty = true; st.tick(dt); }
      if ((noteClock += dt) >= NOTE_EVERY) {
        noteClock = 0;
        for (const actor of ['host', 'guest']) { const bag = ctx.bag(actor); if (bag) announce(progs[actor].noteItems(bag), actor); }
      }
      if ((saveClock += dt) >= SAVE_EVERY) {
        saveClock = 0;
        const luckSig = JSON.stringify(barrelLuck.misses); if (luckSig !== savedLuckSig) { savedLuckSig = luckSig; dirty = true; }
        if (dirty) save();
      }
      if (ctx.role() === 'host' && ctx.ready() && (syncClock += dt) >= SYNC_EVERY) {
        syncClock = 0; ctx.emit({ kind: 'prog:sync', prog: progs.guest.snapshot(), stations: stationSnaps() }, 'guest');
      }
    }
    for (const [key, g] of models) {
      if (!g.parent) { models.delete(key); glow.delete(key); continue; }
      const st = stationView(key), target = st?.cooking ? 1 : st && st.fuelUnits > 0 ? 0.25 : 0;
      const a = (glow.get(key) ?? 0) + (target - (glow.get(key) ?? 0)) * Math.min(1, dt * 2);
      let n = nodeCache.get(g); if (!n) nodeCache.set(g, n = { glow: g.getObjectByName('glow'), ingot: g.getObjectByName('ingot'), crank: g.getObjectByName('recyclerCrank'), pile: g.getObjectByName('recyclerPile') }); // looked up once, not per frame
      glow.set(key, a); if (n.glow) setSmelterGlow(g, a, time); // tub and research table have no glow node
      if (n.ingot) n.ingot.visible = !!st?.output;
      if (n.crank && st?.cooking) n.crank.rotation.z = (n.crank.rotation.z + dt * 4) % (Math.PI * 2); // [recycler]
      if (n.pile) n.pile.visible = !!st?.output;
    }
    if (panel?.isOpen) { if (!stationView(panel.stationId)) panel.close(); else panel.update(); }
    renderResearch(false);
    const near = ctx.running() ? stationNear(null) : null, nk = near ? keyOf(near) : null;
    if (nk !== nearKey) { nearKey = nk; if (near) ctx.notice(`E: use the ${nameOf(near.type)}`, 2200); }
    updateHud();
    if (!promptOff && typeof window !== 'undefined' && window.raftPrompts) promptOff = window.raftPrompts.provide({ id: 'station', prompt: stationPrompt }); // content hook
  }

  // ---------- models ----------
  function modelFor(type, d) {
    const make = MODELS[type]; if (!make) return null;
    const g = make(ctx.T);
    if (COOKERS.has(type) && d) models.set(keyOf(d), g);
    return g;
  }

  function installUI() {
    tooltips?.dispose();
    tooltips = installItemTooltips({ getBag: () => ctx.localBag(), getProgression: () => myProg(), items: ITEMS });
  }

  // ---------- debug (window.raftDebug.progression) ----------
  const debug = Object.freeze({
    grant(kind, n = 1) { if (!isHost() || !ITEMS[kind]) return 0; const left = ctx.bag('host').add(kind, n, ITEMS[kind].tool ? { durability: 100 } : {}); return n - left; },
    place(type) {
      const w = ctx.world(), me = ctx.pose();
      const free = w.tiles.filter(([x, z]) => !w.decor.some((d) => d.x === x && d.z === z))
        .sort((a, b) => Math.hypot(a[0] * 2 - me.x, a[1] * 2 - me.z) - Math.hypot(b[0] * 2 - me.x, b[1] * 2 - me.z));
      if (!free.length) return null;
      if (ctx.localBag().count(type) < 1) debug.grant(type, 1);
      const [x, z] = free[0]; ctx.action({ kind: 'build', recipe: type, x, z });
      return w.decor.some((d) => d.x === x && d.z === z && d.type === type) ? keyOf({ x, z }) : null;
    },
    interact: () => interact(null),
    open: (key) => openStation(key),
    advance(sec) { for (const st of stations.values()) st.tick(sec); panel?.update(); },
    state: () => ({ host: progs.host.snapshot(), guest: progs.guest.snapshot(), stations: isRemote() ? remote.stations : stationSnaps(),
      researchable: myProg().researchable(), nextGoals: myProg().nextGoals(3), panelOpen: !!panel?.isOpen, researchOpen: !!research?.open, hud: hud && !hud.hidden ? hud.textContent : null }),
  });

  function dispose() {
    save();
    self.flush = null;
    if (globalThis[OWNER] === self) globalThis[OWNER] = prevOwner;
    try { panel?.dispose(); } catch {}
    try { tooltips?.dispose(); } catch {}
    try { research?.remove(); hud?.remove(); } catch {}
    panel = research = tooltips = hud = null;
  }

  // First run on a pre-progression save: keep every recipe the old build offered (the
  // discover gates are not always in the bag any more), then persist so this happens once.
  if (!saved.host && isHost()) {
    const w = ctx.world();
    if (w && (w.collected > 0 || w.decor?.length > 0 || w.tiles?.length > 9)) {
      for (const p of Object.values(progs)) for (const id of LEGACY_RECIPES) if (ITEMS[id]) p.learned.add(id);
    }
    save();
  }

  // content hook: show "E Use the <station>" in main's #lrPrompt while aimed at one in reach (prompts.js samples at 10 Hz).
  // Registered lazily from tick(), since prompts.js may load after this module.
  let promptOff = null;
  const stationPrompt = () => { const d = ctx.running() && ctx.aim ? stationNear(ctx.aim(), true) : null; return d ? { key: 'E', label: 'Use the ' + nameOf(d.type) } : null; };
  const disposeAll = () => { try { promptOff?.(); } catch {} dispose(); }; // content hook

  return { apply, effect, tick, interact, modelFor, recipeGate, installUI, save, dispose: disposeAll, debug, barrelLuck, progression: (actor) => (actor ? progs[actor] : myProg()), beforeUndecor, undecorLoot, afterUndecor }; // [undecor] beforeUndecor/undecorLoot/afterUndecor
}

export default attachProgression;
