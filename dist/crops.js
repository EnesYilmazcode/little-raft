// Crop plots: Small (beets, potatoes) and Medium (watermelon, pineapple). Raft's crop plots, our own art and code.
//
// Loop: craft a Small Crop Plot (6 planks + 4 rope) and place it like any decor. It has 3 slots in a
// row. Hold a Beet or a Potato and click an empty slot: the crop is its own seed. Pour a Cup of
// Fresh Water on a slot (click while aiming at it): that one slot is wet for WATER_SECONDS and the
// crop only grows while its slot is wet. A ripe crop is harvested with E and gives YIELD crops
// (2: planting one is net positive), the slot empties.
// Real Raft growth times: beet 50 s, potato 300 s. One cup ripens a beet; a potato needs two cups.
// [fruit] Medium Crop Plot (8 planks + 4 scrap, PLOTS.cropplot2): 2 big slots for watermelon (480 s) and
// pineapple (360 s) planted from Watermelon / Pineapple Seeds (island fruit patches); a cup keeps its deeper
// soil wet 240 s (two cups per fruit). A harvest gives 1 fruit and, 2 times in 3, the seed back (Raft 66.7%).
// It takes beets and potatoes too. Gulls peck growing plots like palm planters (scarecrow.js): growth pauses.
//
// State lives on the decor entry: d.crop = [{c, g, w}, x slots] where
//   c crop kind ('' empty, 'beet', 'potato', 'watermelon', 'pineapple'), g whole seconds grown, w whole seconds of wet soil left.
// Host-authoritative: the host ticks growth and applies 'crops.*' actions (guests reach it through
// ctx.action, like waterPlant). The top half of this file is pure (no DOM, no THREE, no clocks).
import { swapOne } from './watering.js?build=v3-survival-ae77fa84ac2b';
import { createCropPlot, createMediumPlot, cropKit, SLOT_X, SLOT_X2, SOIL_Y } from './crops-model.js?build=v3-survival-ae77fa84ac2b';

// [fruit] Plot types. The Medium Crop Plot (8 planks + 4 scrap) has 2 big slots for watermelon and pineapple
// (Raft's medium plot) and also takes beets and potatoes; its deeper soil stays wet longer (water seconds).
export const PLOT_TYPE = 'cropplot', SLOTS = 3; // the small plot (old callers)
export const PLOTS = Object.freeze({
  cropplot: Object.freeze({ name: 'Small Crop Plot', slots: 3, slotX: SLOT_X, water: 150, crops: Object.freeze(['beet', 'potato']) }),
  cropplot2: Object.freeze({ name: 'Medium Crop Plot', slots: 2, slotX: SLOT_X2, water: 240, crops: Object.freeze(['watermelon', 'pineapple', 'beet', 'potato']) }),
});
export const PLOT_TYPES = Object.freeze(Object.keys(PLOTS));
// seed: the bag item planted; yield: crops per harvest; seedBack: odds of a seed coming back too (Raft 66.7%).
export const SEED_BACK = 2 / 3;
export const CROPS = Object.freeze({
  beet: Object.freeze({ name: 'Beet', plural: 'beets', grow: 50, seed: 'beet', seedName: 'beet', yield: 2, seedBack: 0 }),
  potato: Object.freeze({ name: 'Potato', plural: 'potatoes', grow: 300, seed: 'potato', seedName: 'potato', yield: 2, seedBack: 0 }),
  watermelon: Object.freeze({ name: 'Watermelon', plural: 'watermelons', grow: 480, seed: 'melonseed', seedName: 'watermelon seed', yield: 1, seedBack: SEED_BACK }), // [fruit] ~8 min
  pineapple: Object.freeze({ name: 'Pineapple', plural: 'pineapples', grow: 360, seed: 'pineseed', seedName: 'pineapple seed', yield: 1, seedBack: SEED_BACK }), // [fruit] ~6 min
});
export const CROP_KINDS = Object.freeze(Object.keys(CROPS));
/** Bag item -> the crop it plants ('beet' -> 'beet', 'melonseed' -> 'watermelon'). */
export const SEED_OF = Object.freeze(Object.fromEntries(CROP_KINDS.map(k => [CROPS[k].seed, k])));
export const YIELD = 2, WATER_SECONDS = 150, MAX_TICK = 60, REACH = 3, HOST_SLACK = 2;
export const SPROUT = 0, LEAFY = 1, RIPE = 2; // visual stages
export const STAGE_NAMES = Object.freeze(['Sprout', 'Growing', 'Ripe']);
export const TEXT = Object.freeze({
  notarget: 'Point at a crop plot', taken: 'Something is already growing there', noseed: 'You need a beet or a potato',
  empty: 'Plant a beet or potato first', ripe: 'It is ripe: harvest it with E', wet: 'The soil is still wet',
  nocup: 'You need a cup of fresh water', full: 'Your bag is full', notripe: 'Still growing', nothing: 'Nothing to harvest',
  toosmall: 'Watermelons and pineapples need a Medium Crop Plot', shoo: 'Shoo the gull',
});

const isInt = Number.isInteger;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isCrop = (c) => typeof c === 'string' && hasOwn(CROPS, c);
const clampInt = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo);
export const isPlot = (d) => !!d && typeof d.type === 'string' && hasOwn(PLOTS, d.type);
export const plotOf = (type) => (typeof type === 'string' && hasOwn(PLOTS, type) ? PLOTS[type] : PLOTS.cropplot);
export const isSeed = (kind) => typeof kind === 'string' && hasOwn(SEED_OF, kind);
export const allows = (type, crop) => isCrop(crop) && plotOf(type).crops.includes(crop);
export const emptySlot = () => ({ c: '', g: 0, w: 0 });

/** One validated slot for a plot `type`. Junk -> empty; unknown or not-allowed crops dropped; g/w clamped to whole seconds. */
export function cleanSlot(v, type = PLOT_TYPE) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !allows(type, v.c)) return emptySlot();
  const g = clampInt(v.g, 0, CROPS[v.c].grow);
  return { c: v.c, g, w: g >= CROPS[v.c].grow ? 0 : clampInt(v.w, 0, plotOf(type).water) };
}
/** Validated d.crop field (always the type's slot count). Old saves (no field) load as an empty plot. */
export function cleanCrop(v, type = PLOT_TYPE) {
  const out = [], n = plotOf(type).slots;
  for (let i = 0; i < n; i++) out.push(cleanSlot(Array.isArray(v) ? v[i] : null, type));
  return out;
}
/** Cleans every crop plot in a decor list in place; other decor loses any stray crop field. */
export function normalizeDecor(decor) {
  if (Array.isArray(decor)) for (const d of decor) { if (isPlot(d)) d.crop = cleanCrop(d.crop, d.type); else if (d && 'crop' in d) delete d.crop; }
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
/** [scarecrow] True while some slot of plot d is wet and still growing: what a peckish gull goes for. */
export function plotGrowing(d) {
  if (!isPlot(d) || !Array.isArray(d.crop)) return false;
  for (const s of d.crop) if (s && isCrop(s.c) && s.w > 0 && s.g < CROPS[s.c].grow) return true;
  return false;
}

/** Host tick in whole seconds (n floored, clamped 0..MAX_TICK). skip: optional Set of "x,z" plot keys a gull is
 * pecking (their growth pauses, the water stays). Returns the number of slots that ripened. */
export function tickCrops(decor, dt, skip) {
  const n = clampInt(dt, 0, MAX_TICK);
  let ripened = 0;
  if (!n || !Array.isArray(decor)) return 0;
  const sk = skip && typeof skip.has === 'function' && skip.size > 0 ? skip : null;
  for (const d of decor) {
    if (!isPlot(d) || !Array.isArray(d.crop)) continue;
    if (sk && sk.has(d.x + ',' + d.z)) continue;
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

const plotAt = (decor, x, z) => { if (Array.isArray(decor)) for (const d of decor) if (isPlot(d) && d.x === x && d.z === z) return d; return null; };
const fail = (reason, text = TEXT[reason]) => ({ ok: false, reason, text });
function commit(bag, s) { for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = s.slots[i]; if (typeof bag.version === 'number') bag.version++; }
// Takes one `kind`, preferring the selected slot so the held stack shrinks.
function takeOne(bag, kind) {
  const sel = bag.slots[bag.selectedIndex];
  if (sel && sel.kind === kind) { sel.count--; if (sel.count <= 0) bag.slots[bag.selectedIndex] = null; return true; }
  return bag.remove(kind, 1);
}
/** What one harvest of a ripe `crop` gives: {kind: n}. rand() < seedBack also returns a seed (fruit crops). */
export function harvestLoot(crop, rand = Math.random) {
  const c = isCrop(crop) ? CROPS[crop] : null; if (!c) return {};
  const out = { [crop]: c.yield };
  if (c.seedBack > 0) { const r = Number(rand()); if (Number.isFinite(r) && r < c.seedBack) out[c.seed] = (out[c.seed] || 0) + 1; }
  return out;
}

/**
 * Host-side crop action on decor. a = {kind:'crops.plant'|'crops.water'|'crops.harvest', x, z, slot, crop?}.
 * crop (plant) is a crop kind or the held seed item ('melonseed'). rand: the seed-back roll (tests pass one).
 * Mutates the plot and bag. Returns {ok, reason?, text, kind?, loot?}.
 */
export function applyCrop(decor, bag, a, rand = Math.random) {
  if (!a || typeof a.kind !== 'string' || !isInt(a.x) || !isInt(a.z) || !isInt(a.slot) || a.slot < 0) return fail('notarget');
  const d = plotAt(decor, a.x, a.z); if (!d) return fail('notarget');
  const P = plotOf(d.type); if (a.slot >= P.slots) return fail('notarget');
  d.crop = cleanCrop(d.crop, d.type);
  const s = d.crop[a.slot];
  if (a.kind === 'crops.plant') {
    if (s.c) return fail('taken');
    const want = isCrop(a.crop) ? a.crop : isSeed(a.crop) ? SEED_OF[a.crop] : null;
    if (want && !allows(d.type, want)) return fail('toosmall');
    const crop = want ?? P.crops.find(k => bag.count(CROPS[k].seed) > 0);
    if (!crop) return fail('noseed', d.type === PLOT_TYPE ? TEXT.noseed : 'You need a seed: watermelon, pineapple, beet or potato');
    const seed = CROPS[crop].seed;
    if (bag.count(seed) < 1 || !takeOne(bag, seed)) return fail('noseed', crop === 'beet' || crop === 'potato' ? TEXT.noseed : `You need a ${CROPS[crop].seedName}`);
    s.c = crop; s.g = 0; s.w = 0; // empty slots hold no water
    return { ok: true, kind: 'build', text: `${CROPS[crop].name} planted. Water it with fresh water` };
  }
  if (a.kind === 'crops.water') {
    if (!s.c) return fail('empty');
    if (isRipe(s)) return fail('ripe');
    if (s.w >= P.water / 2) return fail('wet');
    if (bag.count('freshcup') < 1) return fail('nocup');
    if (!swapOne(bag, 'freshcup', 'cup')) return fail('full');
    s.w = P.water;
    return { ok: true, kind: 'build', text: `Watered the ${CROPS[s.c].name.toLowerCase()}. It grows while the soil is wet` };
  }
  if (a.kind === 'crops.harvest') {
    if (!s.c) return fail('nothing');
    if (!isRipe(s)) return fail('notripe');
    const loot = harvestLoot(s.c, rand), scratch = new bag.constructor(bag.snapshot());
    for (const k of Object.keys(loot)) if (scratch.add(k, loot[k]) !== 0) return fail('full');
    commit(bag, scratch);
    const c = CROPS[s.c], seedToo = c.seedBack > 0 && loot[c.seed] > 0; d.crop[a.slot] = emptySlot();
    const text = `+ ${c.yield} ${c.yield === 1 ? c.name.toLowerCase() : c.plural}` + (seedToo ? ` · + 1 ${c.seedName}` : '');
    return { ok: true, kind: 'loot', text, loot };
  }
  return fail('notarget');
}

/** Prompt HTML-free text for one slot, the held kind and the plot type; first value is the key ('Click' | 'E' | null). */
export function slotPrompt(s, held, type = PLOT_TYPE) {
  const P = plotOf(type);
  if (!s || !isCrop(s.c)) {
    const want = isSeed(held) ? SEED_OF[held] : null;
    if (want) return allows(type, want) ? ['Click', `Plant ${CROPS[want].name.toLowerCase()}`] : [null, TEXT.toosmall];
    return [null, type === 'cropplot2' ? 'Empty slot: plant a watermelon or pineapple seed' : 'Empty slot: plant a beet or potato'];
  }
  const name = CROPS[s.c].name;
  if (isRipe(s)) return ['E', `Harvest ${name.toLowerCase()}`];
  const pct = Math.floor(progress(s) * 100);
  if (held === 'freshcup' && s.w < P.water / 2) return ['Click', `Water the ${name.toLowerCase()} (${pct}%)`];
  if (s.w > 0) return [null, `${name} ${pct}%: growing`];
  return [null, `${name} ${pct}%: dry soil, needs fresh water`];
}

/** Slot centre along the plot-local x axis. */
export const slotX = (type, i) => { const P = plotOf(type); return P.slotX * (i - (P.slots - 1) / 2); };
/** Slot index under a point given in raft metres, for a plot at tile (x, z) with rotation rot. */
export function slotAt(d, px, pz) {
  const P = plotOf(d.type), n = P.slots;
  const dx = px - d.x * 2, dz = pz - d.z * 2, r = d.rot || 0;
  const lx = dx * Math.cos(r) - dz * Math.sin(r); // plot-local x (three.js: local +x maps to (cos r, 0, -sin r))
  return Math.max(0, Math.min(n - 1, Math.round(lx / P.slotX + (n - 1) / 2)));
}

// ------------------------------------------------------------------ the content module

export function createCrops(ctx, peer) {
  const T = ctx.T;
  let clock = 0;
  // [scarecrow] gull pecks: the scarecrow module owns them (host set / guest net set); growth pauses on a pecked plot.
  // Looked up once (peer() allocates a closure per call and the prompt asks every frame); dropped if it dies.
  let crowMod, crowLooked = false;
  const crow = () => {
    if (crowMod && crowMod.dead) { crowMod = null; return null; }
    if (!crowLooked) { crowLooked = true; crowMod = typeof peer === 'function' ? peer('scarecrow') : null; }
    return crowMod;
  };
  const pecking = (key) => { const m = crow(); return !!m && typeof m.isPecked === 'function' && m.isPecked(key); };
  const plots = []; // craft_cropplot / craft_cropplot2 groups in ctx.raft; g.userData.cropDecor is the decor entry
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
      if (q > 1.1 * 1.1 || q >= bd) continue;
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
  const said = { d: null, tile: '', slot: -1, c: '', pct: -1, wet: -1, held: null, pecked: false, key: null, text: '' };
  const tileOf = (d) => { if (said.d !== d) { said.d = d; said.tile = d.x + ',' + d.z; said.slot = -1; } return said.tile; }; // key string built once per aimed plot
  function describe(t) {
    const s = slotOf(t), held = heldKind(), half = plotOf(t.d.type).water / 2, pct = isCrop(s.c) ? Math.floor(progress(s) * 100) : -1, wet = s.w >= half ? 2 : s.w > 0 ? 1 : 0;
    const pecked = pecking(tileOf(t.d));
    if (said.slot !== t.slot || said.c !== s.c || said.pct !== pct || said.wet !== wet || said.held !== held || said.pecked !== pecked) {
      const [key, text] = pecked ? ['E', TEXT.shoo] : slotPrompt(s, held, t.d.type);
      said.slot = t.slot; said.c = s.c; said.pct = pct; said.wet = wet; said.held = held; said.pecked = pecked; said.key = key; said.text = text;
      said.html = key ? `<kbd>${key}</kbd>${ctx.esc ? ctx.esc(text) : text}` : null;
    }
    return said;
  }

  // What a left click with `kind` does at the aimed slot: an action, a notice, or null (not ours).
  function useFor(kind, aim) {
    if (!isSeed(kind) && kind !== 'freshcup') return null;
    const t = target(aim); if (!t) return null;
    const s = slotOf(t), at = { x: t.d.x, z: t.d.z, slot: t.slot };
    if (isSeed(kind)) {
      if (s.c) return { notice: isRipe(s) ? TEXT.ripe : TEXT.taken };
      if (!allows(t.d.type, SEED_OF[kind])) return { notice: TEXT.toosmall };
      return { a: { kind: 'crops.plant', ...at, crop: SEED_OF[kind] } };
    }
    if (!s.c) return { notice: t.d.type === PLOT_TYPE ? TEXT.empty : 'Plant a seed first' };
    if (isRipe(s)) return { notice: TEXT.ripe };
    if (s.w >= plotOf(t.d.type).water / 2) return { notice: TEXT.wet };
    return { a: { kind: 'crops.water', ...at } };
  }

  function scanPlots() {
    const raft = ctx.raft; if (!raft) { plots.length = 0; return; }
    const kids = raft.children, list = decor();
    if (raft === scanRaft && kids.length === scanLen && kids[0] === scanFirst && list === scanDecor && list.length === scanDecorLen) return;
    scanRaft = raft; scanLen = kids.length; scanFirst = kids[0]; scanDecor = list; scanDecorLen = list.length;
    plots.length = 0;
    for (let i = 0; i < kids.length; i++) {
      const g = kids[i]; if (g.name !== 'craft_cropplot' && g.name !== 'craft_cropplot2') continue;
      const x = Math.round(g.position.x / 2), z = Math.round(g.position.z / 2), d = plotAt(list, x, z);
      if (!d || 'craft_' + d.type !== g.name) continue;
      if (!g.userData.cropSlots) attachPlants(g, d.type);
      g.userData.cropDecor = d; plots.push(g);
    }
  }
  // Per slot: one hidden mesh per (crop, stage) plus a wet-soil disc, all sharing the kit.
  function attachPlants(g, type) {
    kit ??= cropKit(T);
    const slots = [], n = plotOf(type).slots, big = type !== PLOT_TYPE;
    for (let i = 0; i < n; i++) {
      const root = new T.Group(); root.position.set(slotX(type, i), SOIL_Y, 0); root.rotation.y = big ? i * Math.PI + .3 : i * 2.1; g.add(root);
      if (big) root.scale.setScalar(1.25); // [fruit] room to sprawl in the big slots
      const wet = new T.Mesh(big ? kit.wetGeo2 : kit.wetGeo, kit.wetMat); if (big) wet.scale.setScalar(.8); wet.rotation.y = -root.rotation.y; wet.visible = false; root.add(wet);
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
      for (let j = 0; j < slots.length; j++) {
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
    update(dt) {
      if (T) paint();
      if (!unprovide) providePrompt();
      if (!ctx.running || ctx.role === 'guest') return;
      clock += dt > 0 ? dt : 0;
      if (clock >= 1) {
        const n = Math.floor(clock); clock -= n;
        const m = crow(), skip = m && m.pecked instanceof Set ? m.pecked : null; // [scarecrow] host set of pecked keys
        if (tickCrops(ctx.world?.decor, n, skip) > 0) ctx.emit?.({ kind: 'notice', text: 'A crop is ripe' }, 'all');
      }
    },
    claims(kind, aim) { return (isSeed(kind) || kind === 'freshcup') && !!target(aim); }, // no allocation: called per frame
    use(aim, kind) { // same order as paint.js (content.js use(aim, kind))
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
      const s = slotOf(t), m = crow();
      if (m && typeof m.shoo === 'function' && pecking(tileOf(t.d))) { m.shoo(t.d.x, t.d.z); return true; } // [scarecrow] E shoos the gull first
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
    decorModel(type) { return !T ? null : type === PLOT_TYPE ? createCropPlot(T) : type === 'cropplot2' ? createMediumPlot(T) : null; },
    debug: {
      plots: () => decor().filter(isPlot).map(d => ({ type: d.type, x: d.x, z: d.z, rot: d.rot || 0, crop: cleanCrop(d.crop, d.type) })),
      target: (aim) => { const t = target(aim); return t ? { x: t.d.x, z: t.d.z, slot: t.slot } : null; },
      shown: () => plots.map(g => g.userData.cropSlots.map(v => (v.shown ?? '') + (v.wetShown ? '+wet' : ''))),
      /** Host QA: put a crop plot on a free raft tile. */
      place(x, z, rot = 0, type = PLOT_TYPE) {
        const w = ctx.world;
        if (ctx.role === 'guest' || !isInt(x) || !isInt(z) || !w || !PLOTS[type]) return false;
        if (!w.tiles?.some(t => t[0] === x && t[1] === z) || decor().some(d => d.x === x && d.z === z)) return false;
        w.decor.push({ type, x, z, ...(rot ? { rot } : {}), crop: cleanCrop(null, type) }); ctx.rebuildRaft?.(); return true;
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
      /** Host QA: set a slot's state directly (no bag), e.g. ripen('cropplot2' plot at 0,1) for screenshots. */
      setSlot(x, z, slot, c, g = 0, w = 0) { const d = plotAt(decor(), x, z); if (!d || ctx.role === 'guest') return false; d.crop = cleanCrop(d.crop, d.type); const v = cleanSlot({ c, g, w }, d.type); if (!isInt(slot) || slot < 0 || slot >= d.crop.length) return false; d.crop[slot] = v; return true; },
    },
    dispose() {
      plots.length = 0; try { unprovide?.(); } catch {} unprovide = null;
      if (kit) { for (const g of Object.values(kit.geos)) g.dispose(); kit.wetGeo.dispose(); kit.wetGeo2.dispose(); kit.plantMat.dispose(); kit.wetMat.dispose(); kit = null; }
    },
  };
}
