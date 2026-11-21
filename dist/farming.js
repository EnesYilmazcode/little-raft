// Farming rules for palm planters. Pure ES module: no DOM, no THREE, no timers.
//
// Loop (after Raft's crop plots): place a Palm Planter and it holds a SEEDLING, dry.
// Fill a Filter Cup at the sea for a Cup of Fresh Water, pour it on the planter, and
// the plant grows through 4 stages, but only while the soil is wet. A mature palm is
// harvested with E for leaves and a seed; the empty planter takes that seed again.
//
// State lives on the palm decor entry as d.farm = {s, g, w, h}:
//   s stage (-1 empty, 0 seedling, 1 sprout, 2 young, 3 mature)
//   g seconds grown inside the current stage, w seconds of wet soil left, h harvest count.
// A palm decor entry with no farm field comes from an older save and loads as mature.

export const EMPTY = -1, SEEDLING = 0, MATURE = 3;
export const STAGE_NAMES = Object.freeze(['Seedling', 'Sprout', 'Young palm', 'Palm']);
export const STAGE_SECONDS = 50;   // per stage, so seedling to palm takes 2.5 wet minutes
export const WATER_SECONDS = 90;   // one cup keeps the soil wet this long (two cups to grow up)
export const HARVEST = Object.freeze({ leaf: 3, seed: 1 });
export const PLOT_TYPE = 'palm';

// Bag item and recipe definitions the integrator merges into inventory-state.js.
export const FARM_ITEMS = Object.freeze({
  seed:  Object.freeze({ kind: 'seed',  name: 'Palm Seed',            icon: 'icon-leaf',   maxStack: 20, tool: false, placeholder: true }),
  cup:   Object.freeze({ kind: 'cup',   name: 'Filter Cup',           icon: 'icon-scrap',  maxStack: 20, tool: false, placeholder: true }),
  water: Object.freeze({ kind: 'water', name: 'Cup of Fresh Water',   icon: 'icon-barrel', maxStack: 20, tool: false, placeholder: true }),
});
export const FARM_RECIPES = Object.freeze({ cup: Object.freeze({ plastic: 2, leaf: 1 }) });

const isNum = Number.isFinite;
const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const newPlant = () => ({ s: SEEDLING, g: 0, w: 0, h: 0 });
export const isPlot = (d) => !!d && d.type === PLOT_TYPE;
export const isWet = (p) => !!p && p.w > 0;

// Validates a saved or networked farm field. Missing (legacy planters) or broken means mature.
export function cleanPlant(v) {
  if (!v || typeof v !== 'object' || !Number.isInteger(v.s) || v.s < EMPTY || v.s > MATURE) return { s: MATURE, g: 0, w: 0, h: 0 };
  return {
    s: v.s,
    g: isNum(v.g) ? clampN(v.g, 0, STAGE_SECONDS) : 0,
    w: isNum(v.w) ? clampN(v.w, 0, WATER_SECONDS) : 0,
    h: Number.isInteger(v.h) && v.h >= 0 ? v.h : 0,
  };
}

// Ensures every palm decor entry carries a clean farm field (call after loading a world).
export function normalizeDecor(decor) {
  for (const d of decor) if (isPlot(d)) d.farm = cleanPlant(d.farm);
  return decor;
}

// Advances one plant by dt seconds. Mutates p. Returns true when its look changed
// (new stage or the soil just dried), so the view and co-op sync know to refresh.
export function tickPlant(p, dt) {
  if (!p || !(dt > 0) || p.s < SEEDLING || p.w <= 0) return false;
  if (p.s >= MATURE) { p.w = Math.max(0, p.w - dt); return p.w === 0; } // grown palms just let the soil dry
  const wet = Math.min(dt, p.w);
  p.w -= wet; p.g += wet;
  let changed = p.w <= 0;
  while (p.g >= STAGE_SECONDS && p.s < MATURE) { p.g -= STAGE_SECONDS; p.s++; changed = true; }
  if (p.s >= MATURE) p.g = 0;
  return changed;
}

// Host-side: grows every plot. Returns true when any plot changed look.
export function tickFarm(decor, dt) {
  let changed = false;
  for (const d of decor) if (isPlot(d) && d.farm && tickPlant(d.farm, dt)) changed = true;
  return changed;
}

// Fraction 0..1 of the whole seedling-to-palm growth, for prompts and model blending.
export function progress(p) {
  if (!p || p.s < SEEDLING) return 0;
  if (p.s >= MATURE) return 1;
  return (p.s * STAGE_SECONDS + p.g) / (MATURE * STAGE_SECONDS);
}

// What a use (left click) or interact (E) on this plot should do with the held item.
// Returns 'plant' | 'water' | 'harvest' | null.
export function plotAction(p, heldKind, interact = false) {
  if (!p) return null;
  if (p.s >= MATURE) return interact ? 'harvest' : null;
  if (p.s === EMPTY) return heldKind === 'seed' ? 'plant' : null;
  if (heldKind === 'water' && p.w < WATER_SECONDS * .5) return 'water';
  return null;
}

// One-line hint for the crosshair prompt (plain text; the caller escapes it).
export function promptFor(p, heldKind) {
  if (!p) return '';
  if (p.s === EMPTY) return heldKind === 'seed' ? 'Click to plant a palm seed' : 'Empty planter: plant a Palm Seed';
  if (p.s >= MATURE) return 'E  Harvest the palm';
  const name = STAGE_NAMES[p.s], pct = Math.round(progress(p) * 100);
  if (p.w > 0) return heldKind === 'water' && p.w < WATER_SECONDS * .5 ? `${name} ${pct}%: click to water` : `${name} ${pct}%: growing`;
  return heldKind === 'water' ? `${name} ${pct}%: click to water` : `${name} ${pct}%: dry soil, needs fresh water`;
}

// Gives every item in loot to bag atomically (all or nothing). bag is a Bag.
function giveAll(bag, loot) {
  const scratch = new bag.constructor(bag.snapshot());
  for (const [k, n] of Object.entries(loot)) if (scratch.add(k, n) > 0) return false;
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
  return true;
}
// Takes one of kind, preferring the selected slot so the held stack shrinks.
function takeOne(bag, kind) {
  const sel = bag.slots[bag.selectedIndex];
  if (sel?.kind === kind) { sel.count--; if (sel.count <= 0) bag.slots[bag.selectedIndex] = null; return true; }
  return bag.remove(kind, 1);
}

// Host-authoritative farm action. a = {kind:'farm', op, x, z}; op is plant | water | harvest | fill.
// Mutates world.decor and bag. Returns {ok, text, effect, changed} where effect is the emit kind
// ('build' | 'loot' | 'notice' | 'full') and changed means the plot's look changed.
export function applyFarmAction(world, bag, a) {
  const fail = (text, effect = 'notice') => ({ ok: false, text, effect, changed: false });
  if (!a || typeof a.op !== 'string') return fail('');
  if (a.op === 'fill') { // the cup's leaf filter turns a scoop of sea into fresh water
    if (bag.count('cup') < 1) return fail('Craft a Filter Cup first');
    const scratch = new bag.constructor(bag.snapshot());
    if (!takeOne(scratch, 'cup') || scratch.add('water', 1) > 0) return fail('Your bag is full', 'full');
    for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
    return { ok: true, text: 'Filled a cup with fresh water', effect: 'loot', changed: false };
  }
  if (!Number.isInteger(a.x) || !Number.isInteger(a.z)) return fail('');
  const d = world.decor.find((e) => isPlot(e) && e.x === a.x && e.z === a.z);
  if (!d) return fail('Point at a palm planter');
  const p = d.farm = d.farm ? cleanPlant(d.farm) : cleanPlant(null);
  if (a.op === 'plant') {
    if (p.s !== EMPTY) return fail('Something is already growing here');
    if (!takeOne(bag, 'seed')) return fail('You need a Palm Seed');
    p.s = SEEDLING; p.g = 0; // keeps any water already in the soil
    return { ok: true, text: 'Seedling planted. Water it with fresh water', effect: 'build', changed: true };
  }
  if (a.op === 'water') {
    if (p.s === EMPTY) return fail('Plant a seed first');
    if (p.w >= WATER_SECONDS * .5) return fail('The soil is still wet');
    const scratch = new bag.constructor(bag.snapshot());
    if (!takeOne(scratch, 'water')) return fail('Fill a Filter Cup at the sea first');
    if (scratch.add('cup', 1) > 0) return fail('Your bag is full', 'full');
    for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
    const wasDry = p.w <= 0; p.w = WATER_SECONDS;
    return { ok: true, text: p.s >= MATURE ? 'Watered the palm' : 'Watered! It will grow while the soil is wet', effect: 'build', changed: wasDry };
  }
  if (a.op === 'harvest') {
    if (p.s < MATURE) return fail(p.s === EMPTY ? 'Nothing to harvest' : 'Not ready yet');
    if (!giveAll(bag, HARVEST)) return fail('Your bag is full', 'full');
    p.s = EMPTY; p.g = 0; p.h++;
    return { ok: true, text: '+ 3 palm leaves · 1 palm seed', effect: 'loot', changed: true };
  }
  return fail('');
}

// Stable string of what the plots look like (stage + wet), for cheap change checks.
export function farmSignature(decor) {
  let s = '';
  for (const d of decor) if (isPlot(d)) s += `${d.x},${d.z}:${d.farm ? d.farm.s : MATURE}${d.farm && d.farm.w > 0 ? 'w' : 'd'};`;
  return s;
}
