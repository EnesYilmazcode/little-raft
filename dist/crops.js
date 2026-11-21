// Small Crop Plot: beets and potatoes (Raft's small crop plot, our own art and code).
//
// Loop: craft a Small Crop Plot (6 planks + 4 rope) and place it like any decor. It has 3 slots in a
// row. Hold a Beet or a Potato and click an empty slot: the crop is its own seed. Pour a Cup of
// Fresh Water on a slot (click while aiming at it): that one slot is wet for WATER_SECONDS and the
// crop only grows while its slot is wet. A ripe crop is harvested with E and gives YIELD crops
// (2: planting one is net positive), the slot empties.
// Real Raft growth times: beet 50 s, potato 300 s. One cup ripens a beet; a potato needs two cups.
//
// State lives on the decor entry: d.crop = [{c, g, w}, x3] where
//   c crop kind ('' empty, 'beet', 'potato'), g whole seconds grown, w whole seconds of wet soil left.
// Host-authoritative: the host ticks growth and applies 'crops.*' actions (guests reach it through
// ctx.action, like waterPlant). The top half of this file is pure (no DOM, no THREE, no clocks).
import { swapOne } from './watering.js?build=v3-survival-ae77fa84ac2b';
import { sprinkleOther } from './rain.js?build=v3-survival-ae77fa84ac2b';
import { createCropPlot, cropKit, SLOT_X, SOIL_Y } from './crops-model.js?build=v3-survival-ae77fa84ac2b';

export const PLOT_TYPE = 'cropplot', SLOTS = 3;
export const CROPS = Object.freeze({
  beet: Object.freeze({ name: 'Beet', plural: 'beets', grow: 50 }),
  potato: Object.freeze({ name: 'Potato', plural: 'potatoes', grow: 300 }),
});
export const CROP_KINDS = Object.freeze(Object.keys(CROPS));
export const YIELD = 2, WATER_SECONDS = 150, MAX_TICK = 60, REACH = 3, HOST_SLACK = 2, RAIN_WET = .2; // RAIN_WET: same 'raining' cut as game.js
export const SPROUT = 0, LEAFY = 1, RIPE = 2; // visual stages
export const STAGE_NAMES = Object.freeze(['Sprout', 'Growing', 'Ripe']);
export const TEXT = Object.freeze({
  notarget: 'Point at a crop plot', taken: 'Something is already growing there', noseed: 'You need a beet or a potato',
  empty: 'Plant a beet or potato first', ripe: 'It is ripe: harvest it with E', wet: 'The soil is still wet',
  nocup: 'You need a cup of fresh water', full: 'Your bag is full', notripe: 'Still growing', nothing: 'Nothing to harvest',
});

const isInt = Number.isInteger;
const isCrop = (c) => typeof c === 'string' && Object.prototype.hasOwnProperty.call(CROPS, c);
const clampInt = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);
export const isPlot = (d) => !!d && d.type === PLOT_TYPE;
export const emptySlot = () => ({ c: '', g: 0, w: 0 });

/** One validated slot. Junk -> empty; unknown crops dropped; g/w clamped to whole seconds. */
export function cleanSlot(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !isCrop(v.c)) return emptySlot();
  const g = clampInt(v.g, 0, CROPS[v.c].grow);
  return { c: v.c, g, w: g >= CROPS[v.c].grow ? 0 : clampInt(v.w, 0, WATER_SECONDS) };
}
/** Validated d.crop field (always SLOTS slots). Old saves (no field) load as an empty plot. */
export function cleanCrop(v) {
  const out = [];
  for (let i = 0; i < SLOTS; i++) out.push(cleanSlot(Array.isArray(v) ? v[i] : null));
  return out;
}
/** Cleans every crop plot in a decor list in place; other decor loses any stray crop field. */
export function normalizeDecor(decor) {
  if (Array.isArray(decor)) for (const d of decor) { if (isPlot(d)) d.crop = cleanCrop(d.crop); else if (d && 'crop' in d) delete d.crop; }
  return decor;
}
/** JSON.stringify replacer that hides crop state, so growth ticks are not mistaken for a rebuilt raft. */
export const withoutCrops = (k, v) => (k === 'crop' ? undefined : v);

export const isRipe = (s) => !!s && isCrop(s.c) && s.g >= CROPS[s.c].grow;
export function stageOf(s) {
  if (!s || !isCrop(s.c)) return -1;
  const f = s.g / CROPS[s.c].grow;
  return f >= 1 ? RIPE : f >= .4 ? LEAFY : SPROUT;
}
export const progress = (s) => (s && isCrop(s.c) ? Math.min(1, s.g / CROPS[s.c].grow) : 0);

/** Host tick in whole seconds (n floored, clamped 0..MAX_TICK). Returns the number of slots that ripened. */
export function tickCrops(decor, dt) {
  const n = clampInt(dt, 0, MAX_TICK);
  let ripened = 0;
  if (!n || !Array.isArray(decor)) return 0;
  for (const d of decor) {
    if (!isPlot(d) || !Array.isArray(d.crop)) continue;
    for (const s of d.crop) {
      if (!s || !isCrop(s.c) || s.w <= 0) continue;
      const grow = CROPS[s.c].grow;
      if (s.g >= grow) { s.w = 0; continue; }
      const k = Math.min(n, s.w, grow - s.g);
      s.g += k; s.w -= k;
      if (s.g >= grow) { s.w = 0; ripened++; }
    }
  }
  return ripened;
}

// A slot that wants water: planted, not ripe, soil at most half wet (the same rule as a hand-poured cup).
const thirsty = (s) => !!s && isCrop(s.c) && !isRipe(s) && s.w < WATER_SECONDS / 2;
const plotThirsty = (d) => isPlot(d) && Array.isArray(d.crop) && d.crop.some(thirsty);

/**
 * Host, once per second before tickCrops: rain (0..1, above RAIN_WET) soaks every planted slot, like Raft's
 * rain; each sprinkler with water (rain.js: own tank, else a neighbouring barrel) soaks one thirsty crop plot
 * on the 8 tiles around it for one unit. world = {decor, sprinklers, collectors}. -> {rain, sprinkled: plot keys}.
 */
export function soakCrops(world, rain) {
  const out = { rain: 0, sprinkled: [] };
  const decor = Array.isArray(world?.decor) ? world.decor : null; if (!decor) return out;
  let plots = null;
  for (const d of decor) if (isPlot(d)) (plots ??= new Map()).set(`${d.x},${d.z}`, d);
  if (!plots) return out;
  if (Number.isFinite(rain) && rain > RAIN_WET) {
    for (const d of plots.values()) if (Array.isArray(d.crop)) for (const s of d.crop) if (s && isCrop(s.c) && !isRipe(s) && s.w < WATER_SECONDS) { s.w = WATER_SECONDS; out.rain++; }
    return out; // every slot is wet: sprinklers keep their water
  }
  out.sprinkled = sprinkleOther(world, keys => keys.find(k => plotThirsty(plots.get(k))) ?? null, (k) => {
    for (const s of plots.get(k).crop) if (thirsty(s)) s.w = WATER_SECONDS;
  });
  return out;
}

const plotAt = (decor, x, z) => { if (Array.isArray(decor)) for (const d of decor) if (isPlot(d) && d.x === x && d.z === z) return d; return null; };
const fail = (reason) => ({ ok: false, reason, text: TEXT[reason] });
function commit(bag, s) { for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = s.slots[i]; if (typeof bag.version === 'number') bag.version++; }
// Takes one `kind`, preferring the selected slot so the held stack shrinks.
function takeOne(bag, kind) {
  const sel = bag.slots[bag.selectedIndex];
  if (sel && sel.kind === kind) { sel.count--; if (sel.count <= 0) bag.slots[bag.selectedIndex] = null; return true; }
  return bag.remove(kind, 1);
}

/**
 * Host-side crop action on decor. a = {kind:'crops.plant'|'crops.water'|'crops.harvest', x, z, slot, crop?}.
 * Mutates the plot and bag. Returns {ok, reason?, text, kind?, loot?}.
 */
export function applyCrop(decor, bag, a) {
  if (!a || typeof a.kind !== 'string' || !isInt(a.x) || !isInt(a.z) || !isInt(a.slot) || a.slot < 0 || a.slot >= SLOTS) return fail('notarget');
  const d = plotAt(decor, a.x, a.z); if (!d) return fail('notarget');
  d.crop = cleanCrop(d.crop);
  const s = d.crop[a.slot];
  if (a.kind === 'crops.plant') {
    if (s.c) return fail('taken');
    const crop = isCrop(a.crop) ? a.crop : CROP_KINDS.find(k => bag.count(k) > 0);
    if (!crop || bag.count(crop) < 1 || !takeOne(bag, crop)) return fail('noseed');
    s.c = crop; s.g = 0; s.w = 0; // empty slots hold no water
    return { ok: true, kind: 'build', text: `${CROPS[crop].name} planted. Water it with fresh water` };
  }
  if (a.kind === 'crops.water') {
    if (!s.c) return fail('empty');
    if (isRipe(s)) return fail('ripe');
    if (s.w >= WATER_SECONDS / 2) return fail('wet');
    if (bag.count('freshcup') < 1) return fail('nocup');
    if (!swapOne(bag, 'freshcup', 'cup')) return fail('full');
    s.w = WATER_SECONDS;
    return { ok: true, kind: 'build', text: `Watered the ${CROPS[s.c].name.toLowerCase()}. It grows while the soil is wet` };
  }
  if (a.kind === 'crops.harvest') {
    if (!s.c) return fail('nothing');
    if (!isRipe(s)) return fail('notripe');
    const scratch = new bag.constructor(bag.snapshot());
    if (scratch.add(s.c, YIELD) !== 0) return fail('full');
    commit(bag, scratch);
    const crop = s.c; d.crop[a.slot] = emptySlot();
    return { ok: true, kind: 'loot', text: `+ ${YIELD} ${CROPS[crop].plural}`, loot: { [crop]: YIELD } };
  }
  return fail('notarget');
}

/** Prompt HTML-free text for one slot and the held kind; second value says the key ('Click' | 'E' | null). */
export function slotPrompt(s, held) {
  if (!s || !isCrop(s.c)) return isCrop(held) ? ['Click', `Plant ${CROPS[held].name.toLowerCase()}`] : [null, 'Empty slot: plant a beet or potato'];
  const name = CROPS[s.c].name;
  if (isRipe(s)) return ['E', `Harvest ${name.toLowerCase()}`];
  const pct = Math.floor(progress(s) * 100);
  if (held === 'freshcup' && s.w < WATER_SECONDS / 2) return ['Click', `Water the ${name.toLowerCase()} (${pct}%)`];
  if (s.w > 0) return [null, `${name} ${pct}%: growing`];
  return [null, `${name} ${pct}%: dry soil, needs fresh water`];
}

/** Slot index (0..SLOTS-1) under a point given in raft metres, for a plot at tile (x, z) with rotation rot. */
export function slotAt(d, px, pz) {
  const dx = px - d.x * 2, dz = pz - d.z * 2, r = d.rot || 0;
  const lx = dx * Math.cos(r) - dz * Math.sin(r); // plot-local x (three.js: local +x maps to (cos r, 0, -sin r))
  return Math.max(0, Math.min(SLOTS - 1, Math.round(lx / SLOT_X) + 1));
}

// ------------------------------------------------------------------ the content module

export function createCrops(ctx) {
  const T = ctx.T;
  let clock = 0;
  const plots = []; // craft_cropplot groups in ctx.raft; g.userData.cropDecor is the decor entry
  let scanLen = -1, scanFirst = null, scanRaft = null, scanDecor = null, scanDecorLen = -1;
  const camPos = T ? new T.Vector3() : null, dirV = T ? new T.Vector3() : null;
  const hit = { d: null, slot: 0 };
  let lastAim = null, unprovide = null; // lastAim: game.js's reused per-frame aim object (from prompt())
  const tip = { key: '', label: '', muted: false };
  // Crosshair prompt (dist/prompts.js provider, sampled ~10x/s): plant / water / harvest, or the slot's growth.
  function crosshairPrompt(c) {
    const st = c?.state; if (!st || !st.running || st.pickup || st.swimming) return null;
    const t = target(lastAim); if (!t) return null;
    const { key, text } = describe(t);
    tip.key = key === 'Click' ? 'LMB' : key ?? ''; tip.label = text; tip.muted = !key;
    return tip;
  }
  function providePrompt() { // prompts.js may load after us: retried from update() until it exists
    if (unprovide || typeof window === 'undefined') return;
    try { const p = window.raftPrompts; if (p?.provide) unprovide = p.provide({ id: 'crops', priority: 1, prompt: crosshairPrompt }); } catch {}
  }
  let rainLevel = null; // content.js bindRain(): live 0..1 rain from the day/night module
  const rainNow = () => { try { const r = rainLevel?.(); return Number.isFinite(r) ? r : 0; } catch { return 0; } };
  let kit = null; // shared plant geometries + materials (never disposed by rebuildRaft)
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const heldKind = () => { const b = ctx.localBag?.(); const s = b?.slots?.[b.selectedIndex]; return s ? s.kind : null; };

  // The plot slot the view ray points at: the ray meets the soil plane, else the deck point.
  function target(aim) {
    const p = ctx.physics, cam = ctx.camera; if (!p || !cam) return null;
    const list = decor(); let any = false;
    for (let i = 0; i < list.length; i++) if (isPlot(list[i])) { any = true; break; }
    if (!any) return null;
    cam.getWorldPosition(camPos);
    if (aim && aim.dir) dirV.copy(aim.dir); else cam.getWorldDirection(dirV);
    let px, pz;
    const top = (ctx.raft?.position.y ?? 0) + .22 + SOIL_Y;
    if (dirV.y < -.05) { const t = (top - camPos.y) / dirV.y; px = camPos.x + dirV.x * t; pz = camPos.z + dirV.z * t; }
    else if (aim && aim.point) { px = aim.point.x; pz = aim.point.z; }
    else return null;
    let best = null, bd = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = list[i]; if (!isPlot(d)) continue;
      const cx = d.x * 2, cz = d.z * 2, q = (px - cx) ** 2 + (pz - cz) ** 2;
      if (q > 1.05 * 1.05 || q >= bd) continue;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      bd = q; best = d;
    }
    if (!best) return null;
    hit.d = best; hit.slot = slotAt(best, px, pz);
    return hit;
  }
  const EMPTY = Object.freeze(emptySlot());
  const slotOf = (t) => (Array.isArray(t.d.crop) && t.d.crop[t.slot] ? t.d.crop[t.slot] : EMPTY); // decor is cleaned on load and by every action
  // Prompt text for the aimed slot, rebuilt only when what it shows changes (prompt() runs every frame).
  const said = { d: null, slot: -1, c: '', pct: -1, wet: -1, held: null, key: null, text: '' };
  function describe(t) {
    const s = slotOf(t), held = heldKind(), pct = isCrop(s.c) ? Math.floor(progress(s) * 100) : -1, wet = s.w >= WATER_SECONDS / 2 ? 2 : s.w > 0 ? 1 : 0;
    if (said.d !== t.d || said.slot !== t.slot || said.c !== s.c || said.pct !== pct || said.wet !== wet || said.held !== held) {
      const [key, text] = slotPrompt(s, held);
      said.d = t.d; said.slot = t.slot; said.c = s.c; said.pct = pct; said.wet = wet; said.held = held; said.key = key; said.text = text;
      said.html = key ? `<kbd>${key}</kbd>${ctx.esc ? ctx.esc(text) : text}` : null;
    }
    return said;
  }

  // What a left click with `kind` does at the aimed slot: an action, a notice, or null (not ours).
  function useFor(kind, aim) {
    if (!isCrop(kind) && kind !== 'freshcup') return null;
    const t = target(aim); if (!t) return null;
    const s = slotOf(t), at = { x: t.d.x, z: t.d.z, slot: t.slot };
    if (isCrop(kind)) return s.c ? { notice: isRipe(s) ? TEXT.ripe : TEXT.taken } : { a: { kind: 'crops.plant', ...at, crop: kind } };
    if (!s.c) return { notice: TEXT.empty };
    if (isRipe(s)) return { notice: TEXT.ripe };
    if (s.w >= WATER_SECONDS / 2) return { notice: TEXT.wet };
    return { a: { kind: 'crops.water', ...at } };
  }

  function scanPlots() {
    const raft = ctx.raft; if (!raft) { plots.length = 0; return; }
    const kids = raft.children, list = decor();
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst && list === scanDecor && list.length === scanDecorLen) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0]; scanDecor = list; scanDecorLen = list.length;
    plots.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_cropplot') continue;
      const x = Math.round(g.position.x / 2), z = Math.round(g.position.z / 2), d = plotAt(list, x, z);
      if (!d) continue;
      if (!g.userData.cropSlots) attachPlants(g);
      g.userData.cropDecor = d; plots.push(g);
    }
  }
  // Per slot: one hidden mesh per (crop, stage) plus a wet-soil disc, all sharing the kit.
  function attachPlants(g) {
    kit ??= cropKit(T);
    const slots = [];
    for (let i = 0; i < SLOTS; i++) {
      const root = new T.Group(); root.position.set(SLOT_X * (i - 1), SOIL_Y, 0); root.rotation.y = i * 2.1; g.add(root);
      const wet = new T.Mesh(kit.wetGeo, kit.wetMat); wet.rotation.y = -i * 2.1; wet.visible = false; root.add(wet);
      const meshes = {};
      for (const key of Object.keys(kit.geos)) { const m = new T.Mesh(kit.geos[key], kit.plantMat); m.visible = false; m.castShadow = false; m.receiveShadow = true; root.add(m); meshes[key] = m; }
      slots.push({ wet, meshes, shown: null, wetShown: false });
    }
    g.userData.cropSlots = slots;
  }
  function paint() {
    scanPlots();
    for (let i = 0; i < plots.length; i++) {
      const g = plots[i], slots = g.userData.cropSlots, crop = g.userData.cropDecor.crop;
      for (let j = 0; j < SLOTS; j++) {
        const s = Array.isArray(crop) ? crop[j] : null, view = slots[j], st = stageOf(s);
        const key = st < 0 ? null : st === SPROUT ? 'sprout' : s.c + st; // 'beet1', 'potato2', ...
        if (key !== view.shown) { if (view.shown) view.meshes[view.shown].visible = false; if (key) view.meshes[key].visible = true; view.shown = key; }
        const wet = !!s && s.w > 0;
        if (wet !== view.wetShown) { view.wet.visible = wet; view.wetShown = wet; }
      }
    }
  }

  return {
    name: 'crops',
    bindRain(fn) { rainLevel = typeof fn === 'function' ? fn : null; },
    update(dt) {
      if (T) paint();
      if (!unprovide) providePrompt();
      if (!ctx.running || ctx.role === 'guest') return;
      clock += dt > 0 ? dt : 0;
      if (clock >= 1) {
        const n = Math.floor(clock); clock -= n;
        if (ctx.world) soakCrops(ctx.world, rainNow());
        if (tickCrops(ctx.world?.decor, n) > 0) ctx.emit?.({ kind: 'notice', text: 'A crop is ripe' }, 'all');
      }
    },
    claims(kind, aim) { return (isCrop(kind) || kind === 'freshcup') && !!target(aim); }, // no allocation: called per frame
    use(kind, aim) {
      const u = useFor(kind, aim); if (!u) return false;
      if (u.a) ctx.action(u.a); else ctx.notice?.(u.notice);
      return true;
    },
    // #contextPrompt (hidden under prompts.css; its plain-text lines would be fed as notices): actionable lines only.
    prompt(aim) {
      lastAim = aim;
      const t = target(aim); if (!t) return null;
      return describe(t).html;
    },
    interact(aim) {
      const t = target(aim); if (!t) return false;
      const s = slotOf(t);
      if (!isRipe(s)) { ctx.notice?.(s.c ? TEXT.notripe : TEXT.nothing); return true; }
      ctx.action({ kind: 'crops.harvest', x: t.d.x, z: t.d.z, slot: t.slot });
      return true;
    },
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('crops.')) return false;
      if (!isInt(a.x) || !isInt(a.z)) return true;
      const pose = actor === 'guest' ? ctx.other : ctx.physics;
      if (!pose || !Number.isFinite(pose.x) || !Number.isFinite(pose.z) || Math.hypot(a.x * 2 - pose.x, a.z * 2 - pose.z) > REACH + (actor === 'guest' ? HOST_SLACK : .01)) return true;
      const r = applyCrop(ctx.world?.decor, bag, a);
      ctx.emit?.(r.ok ? (r.loot ? { kind: 'loot', text: r.text, loot: r.loot } : { kind: 'build', text: r.text, sound: 'place' }) : { kind: r.reason === 'full' ? 'full' : 'notice', text: r.text }, actor);
      return true;
    },
    decorModel(type) { return T && type === PLOT_TYPE ? createCropPlot(T) : null; },
    debug: {
      plots: () => decor().filter(isPlot).map(d => ({ x: d.x, z: d.z, rot: d.rot || 0, crop: cleanCrop(d.crop) })),
      target: (aim) => { const t = target(aim); return t ? { x: t.d.x, z: t.d.z, slot: t.slot } : null; },
      shown: () => plots.map(g => g.userData.cropSlots.map(v => (v.shown ?? '') + (v.wetShown ? '+wet' : ''))),
      /** Host QA: put a crop plot on a free raft tile. */
      place(x, z, rot = 0) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !isInt(x) || !isInt(z) || !w) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type: PLOT_TYPE, x, z, ...(rot ? { rot } : {}), crop: cleanCrop(null) }); ctx.rebuildRaft?.(); return true;
      },
      /** Host QA: run the growth rule for `sec` seconds (in MAX_TICK chunks). */
      fastForward(sec = 60) {
        if (ctx.role === 'guest') return false;
        let left = Math.max(0, Math.floor(sec));
        while (left > 0) { const n = Math.min(MAX_TICK, left); tickCrops(ctx.world?.decor, n); left -= n; }
        return true;
      },
      /** Host QA: apply a crop action for the local player, skipping aim (op: plant | water | harvest). */
      act(op, x, z, slot, crop) { if (ctx.role === 'guest') return null; return applyCrop(ctx.world?.decor, ctx.localBag(), { kind: 'crops.' + op, x, z, slot, crop }); },
    },
    dispose() {
      plots.length = 0; try { unprovide?.(); } catch {} unprovide = null;
      if (kit) { for (const g of Object.values(kit.geos)) g.dispose(); kit.wetGeo.dispose(); kit.plantMat.dispose(); kit.wetMat.dispose(); kit = null; }
    },
  };
}
