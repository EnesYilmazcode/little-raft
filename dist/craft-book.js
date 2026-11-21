// Little Raft crafting book: pure helpers behind the crafting panel (no DOM, no THREE, no timers).
// Category grouping, item descriptions, needed-vs-owned rows, the hold-to-craft repeat schedule
// and tooltip anchoring maths all live here so they can be unit-tested in node.

// Tabs, in display order. `icon` is a symbol id in icons.svg.
export const CATEGORIES = Object.freeze([
  Object.freeze({ id: 'tools',     name: 'Tools',     icon: 'hammer' }),
  Object.freeze({ id: 'materials', name: 'Materials', icon: 'wood' }),
  Object.freeze({ id: 'survival',  name: 'Survival',  icon: 'net' }),
  Object.freeze({ id: 'building',  name: 'Building',  icon: 'floor' }),
  Object.freeze({ id: 'music',     name: 'Music',     icon: 'drum' }), // icon: the drum's item drawing
]);

// Recipe output kind -> category id. Unknown kinds fall back by shape (see categoryOf).
const CATEGORY_OF = Object.freeze({
  hook: 'tools', hammer: 'tools', fishingrod: 'tools', sail: 'tools', // the sail is how you steer
  rope: 'materials',
  net: 'survival', palm: 'survival', lantern: 'survival',
  bench: 'building', crate: 'building',
  // progression catalogue (items.js)
  metalhook: 'tools', binoculars: 'tools',
  drum: 'music', pipes: 'music', bells: 'music', // [instruments]
  nail: 'materials', bolt: 'materials', hinge: 'materials',
  flowerbox: 'survival', beehive: 'survival', candle: 'survival', honeyfish: 'survival', // [bees]
  rainbarrel: 'survival', sprinkler: 'survival', // [rain-sprinkler]
  cup: 'survival', purifier: 'survival', // water: scoop the sea, purify it
  researchtable: 'building', grill: 'building', smelter: 'building',
});

// What each item is and what it is good for (shown in hover tooltips and the detail card).
export const ITEM_TEXT = Object.freeze({
  wood:       { desc: 'Driftwood planks fished from the sea.', use: 'Raft floors, tools and almost every build.' },
  leaf:       { desc: 'A tough, fibrous palm frond.', use: 'Twist into rope; thatch for sails and planters.' },
  plastic:    { desc: 'An old floating jug, still watertight.', use: 'Hooks and new raft floors (with the hammer).' },
  scrap:      { desc: 'Bent bits of salvaged metal.', use: 'Lanterns, crates and hook repairs.' },
  rope:       { desc: 'Palm fibre twisted into a sturdy cord.', use: 'Binds hammers, rods, nets and sails.' },
  fish:       { desc: 'A fresh catch from the open water.', use: 'Proof of a good day out on the waves.' },
  hook:       { desc: 'A scrap hook on a rope. Throw it at floating supplies.', use: 'Pulls in floating wood, leaves, plastic and barrels.' },
  hammer:     { desc: 'A rope-bound building hammer.', use: 'Adds raft floor tiles (2 planks + 2 plastic each).' },
  fishingrod: { desc: 'A bamboo rod with a float and line.', use: 'Cast into the sea and wait for a bite to catch fish.' },
  sail:       { desc: 'A tall mast with a woven sail that catches the wind.', use: 'Place it on a floor tile, then hold R beside it to steer and sail the raft.' },
  palm:       { desc: 'A clay pot with a small palm tree.', use: 'A bit of island on your raft; place on a tile.' },
  lantern:    { desc: 'A post lantern with a warm glow.', use: 'Lights the raft at night; place on a tile.' },
  net:        { desc: 'A rope net stretched over the water.', use: 'Catches nearby floating supplies for you.' },
  bench:      { desc: 'A simple plank bench.', use: 'Somewhere to sit; place it on a floor tile.' },
  crate:      { desc: 'A nailed wooden crate.', use: 'Decorates the raft; place it on a floor tile.' },
  sand:       { desc: 'Fine sand from barrels and the seafloor.', use: 'Melt it into glass in the smelter.' },
  stone:      { desc: 'A smooth, heavy stone.', use: 'Part of the smelter; sturdier builds and island tools.' },
  research:   { desc: 'A tinker\u2019s desk for studying finds.', use: 'Place it, then study parts to learn signal and water gear.' },
  clay:       { desc: 'Sticky clay from barrels and the seafloor.', use: 'Fire it into bricks on a grill.' },
  metalore:   { desc: 'A lump of ore from barrels and the seafloor.', use: 'Smelt it into metal ingots.' },
  receiver:   { desc: 'A crackling radio receiver.', use: 'Place one, add antennas, and follow the signal.' },
  antenna:    { desc: 'A rope-braced antenna mast.', use: 'Strengthens the receiver signal; place on a tile.' },
  cup:        { desc: 'An empty plastic cup.', use: 'Click the sea to scoop water.' },
  saltcup:    { desc: 'A cup of salty sea water.', use: 'Pour it into a water purifier.' },
  freshcup:   { desc: 'A cup of clean fresh water.', use: 'Water a palm planter.' },
  seed:       { desc: 'A palm seed.', use: 'Plant it in an empty palm planter.' },
  rainbarrel: { desc: 'A tub with a leaf funnel that catches the rain.', use: 'Fills by itself in the rain. Hold an empty cup and press E.' },
  sprinkler:  { desc: 'A little spinning head with its own tank.', use: 'Waters nearby palm planters for you. Fill it with fresh water, or put it next to a rain barrel.' },
  water:      { desc: 'A filtered cup of fresh water.', use: 'Water a palm planter.' },
  purifier:   { desc: 'A small still that boils off the salt.', use: 'Turns sea water into fresh water.' },
  // progression catalogue (items.js; its tooltips also show the item's own tip)
  copperore:  { desc: 'Green-flecked ore from a lucky barrel.', use: 'Smelt it into copper ingots.' },
  seaweed:    { desc: 'A slippery strand of seaweed.', use: 'Quick fuel for the grill and smelter.' },
  nail:       { desc: 'A handful of bent scrap nails.', use: 'Research tables, smelters and sturdier builds.' },
  brick:      { desc: 'A clay brick fired on the grill.', use: 'The walls of a smelter.' },
  metalingot: { desc: 'A bar of smelted metal.', use: 'Metal hooks, bolts and hinges.' },
  copperingot:{ desc: 'A bar of warm copper.', use: 'Fine parts for advanced gear.' },
  glass:      { desc: 'A pane of glass melted from sand.', use: 'Lenses for binoculars.' },
  bolt:       { desc: 'A threaded metal bolt.', use: 'Strong joints for advanced builds.' },
  hinge:      { desc: 'A small metal hinge.', use: 'Lids, doors and folding parts.' },
  metalhook:  { desc: 'A heavy metal hook that lasts much longer.', use: 'Throw it like the hook; wears far slower.' },
  binoculars: { desc: 'Glass lenses in a copper tube.', use: 'Hold to spot barrels and islands far away.' },
  drum:       { desc: 'A wooden hand drum with a palm-leaf head.', use: 'Click to play; look up or down to change the note.' }, // [instruments]
  pipes:      { desc: 'Plastic reed tubes tied in a row.', use: 'Click to play soft breathy notes with your friend.' }, // [instruments]
  bells:      { desc: 'Brass-bright scrap bars on a small frame.', use: 'Click to ring a note that fades out softly.' }, // [instruments]
  cookedfish: { desc: 'A fish grilled golden.', use: 'A hearty snack.' },
  flowerseed: { desc: 'A tiny seed from an island bush.', use: 'Plant it in a flower box.' }, // [bees]
  flowerbox:  { desc: 'A planter full of bright blooms.', use: 'Place near a beehive; bees love it.' }, // [bees]
  beehive:    { desc: 'A cosy straw hive of friendly bees.', use: 'Place by flower boxes; collect honeycomb with E.' }, // [bees]
  honey:      { desc: 'Sweet, golden and sticky.', use: 'Glaze a grilled fish.' }, // [bees]
  wax:        { desc: 'Soft beeswax from the comb.', use: 'Make beeswax candles.' }, // [bees]
  candle:     { desc: 'A little jar candle.', use: 'Glows warmly at night; place on a tile.' }, // [bees]
  honeyfish:  { desc: 'Grilled fish with a honey glaze.', use: 'A sweet treat.' }, // [bees]
  researchtable: { desc: 'A table for showing off new finds (not the Tinker\u2019s Desk).', use: 'Place it and research ore, metal and other finds to unlock the smelter, metal tools and instruments.' },
  grill:      { desc: 'A simple grill with a fire box.', use: 'Cooks fish and fires clay; feed it planks or leaves.' },
  smelter:    { desc: 'A brick furnace.', use: 'Melts ore into ingots and sand into glass.' },
});

const TOOLISH = new Set(['hook', 'hammer', 'fishingrod', 'rod', 'axe', 'spear']);

export function categoryOf(kind, info = null) {
  const k = String(kind ?? '');
  if (Object.prototype.hasOwnProperty.call(CATEGORY_OF, k)) return CATEGORY_OF[k];
  if ((info && info.tool) || TOOLISH.has(k)) return 'tools';
  return 'building';
}

/**
 * Group normalised recipes ({id, out:{kind}}) into tabs.
 * Returns only non-empty categories, in CATEGORIES order; recipe order is preserved.
 * @param {Array} recipes  @param {object} [infoMap] ITEM_INFO-like map (for the tool flag)
 */
export function groupRecipes(recipes, infoMap = null) {
  const buckets = new Map(CATEGORIES.map(c => [c.id, []]));
  for (const r of recipes || []) {
    if (!r) continue;
    const kind = r.out?.kind ?? r.id;
    buckets.get(categoryOf(kind, infoMap && infoMap[kind]))?.push(r);
  }
  return CATEGORIES.filter(c => buckets.get(c.id).length).map(c => ({ ...c, recipes: buckets.get(c.id) }));
}

/** Needed-vs-owned rows for a recipe's requirement list ({kind, count}). */
export function ingredientRows(reqs, countOf) {
  return (reqs || []).map(q => {
    const need = Math.max(0, Number(q.count) || 0);
    let have = 0;
    try { have = Math.max(0, Number(countOf(q.kind)) || 0); } catch { have = 0; }
    return { kind: q.kind, need, have, enough: have >= need, short: Math.max(0, need - have) };
  });
}

/** How many times the materials on hand cover the recipe (ignores bag space). */
export function craftableTimes(rows) {
  if (!rows || !rows.length) return Infinity;
  let n = Infinity;
  for (const r of rows) n = Math.min(n, r.need > 0 ? Math.floor(r.have / r.need) : Infinity);
  return n;
}

/** How many crafts of `id` in a row succeed with this bag's materials AND space, up to cap.
 *  Simulated on a copy (consuming ingredients can free slots). null if the bag cannot be copied. */
export function fittingTimes(bag, id, cap = 99) {
  let scratch;
  try { scratch = new bag.constructor(bag.snapshot()); } catch { return null; }
  if (typeof scratch.craft !== 'function') return null;
  let n = 0;
  try { while (n < cap && scratch.craft(id)?.ok) n++; } catch { return null; }
  return n;
}

/** 'ready' | 'missing' | 'full' given the rows and an optional Bag.canCraft() result. */
export function recipeState(rows, check = null) {
  if (rows.some(r => !r.enough)) return 'missing';
  if (check && check.full) return 'full';
  if (check && check.ok === false) return 'missing';
  return 'ready';
}

/** Recipes (normalised) that consume `kind`, by name. */
export function usedIn(kind, recipes) {
  const out = [];
  for (const r of recipes || []) if (r && (r.reqs || []).some(q => q.kind === kind)) out.push(r.name);
  return out;
}

/** "owned / needed" label for an ingredient row. */
export const amountLabel = row => `${row.have} / ${row.need}`;

// ---- hold-to-craft schedule ----
// A press crafts one immediately. Keep holding: the 2nd craft lands after HOLD.first ms, then each
// interval shrinks by HOLD.decay down to HOLD.min ms.
export const HOLD = Object.freeze({ first: 450, decay: 0.78, min: 90, max: 99 });

/** Milliseconds to wait after the `done`-th craft (done >= 1) before the next one. */
export function holdDelay(done) {
  const n = Math.max(1, Math.floor(Number(done) || 1));
  return Math.max(HOLD.min, Math.round(HOLD.first * Math.pow(HOLD.decay, n - 1)));
}

/** Times (ms from press) at which crafts fire while held, for the first `count` crafts. */
export function holdSchedule(count) {
  const out = [];
  let t = 0;
  for (let i = 0; i < count; i++) { out.push(t); t += holdDelay(i + 1); }
  return out;
}

/** Number of crafts a hold of `ms` milliseconds produces (>= 1 once pressed), capped by `cap`. */
export function craftsForHold(ms, cap = HOLD.max) {
  let n = 1, t = holdDelay(1);
  while (t <= ms && n < cap) { n++; t += holdDelay(n); }
  return Math.min(n, Math.max(0, cap));
}

// ---- tooltip anchoring ----
/**
 * Place a tooltip of size w x h beside an anchor rect {left, top, right, bottom} inside a
 * vw x vh viewport. Prefers the right side, then left, then below, then above; always clamped.
 * @returns {{x:number, y:number, side:'right'|'left'|'below'|'above'}}
 */
export function anchorTip(rect, w, h, vw, vh, gap = 8, pad = 6) {
  const clampV = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const yAligned = clampV(rect.top, pad, vh - h - pad);
  const xAligned = clampV(rect.left, pad, vw - w - pad);
  if (rect.right + gap + w <= vw - pad) return { x: rect.right + gap, y: yAligned, side: 'right' };
  if (rect.left - gap - w >= pad) return { x: rect.left - gap - w, y: yAligned, side: 'left' };
  if (rect.bottom + gap + h <= vh - pad) return { x: xAligned, y: rect.bottom + gap, side: 'below' };
  return { x: xAligned, y: clampV(rect.top - gap - h, pad, vh - h - pad), side: 'above' };
}

// ---- bag open/close and keyboard ----
/** A backdrop click closes the bag only when the press both started and ended on the backdrop. */
export const backdropCloses = (downOnBackdrop, upOnBackdrop) => !!downOnBackdrop && !!upOnBackdrop;

/**
 * What a key press does to the bag: 'open', 'close' or null (leave it alone).
 * Tab / I open it from play. While open, I / E close it, and so does Tab (it toggles), unless focus is
 * inside a slot grid (`inGrid`), where Tab keeps moving focus between slots.
 * E never opens here: in play it is the pick-up key and the game opens the bag itself.
 */
export function bagKeyAction(code, isOpen, inGrid = false) {
  if (isOpen) return code === 'KeyI' || code === 'KeyE' || (code === 'Tab' && !inGrid) ? 'close' : null;
  return code === 'Tab' || code === 'KeyI' ? 'open' : null;
}

const ARROWS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
/**
 * Arrow-key focus move across laid-out buttons. rects[i] = {left, top, width, height} (null = skip).
 * Returns the index of the nearest rect whose centre lies within 45° of the arrow's direction, or -1.
 */
export function arrowNeighbor(rects, from, code) {
  const d = ARROWS[code], a = rects[from];
  if (!d || !a) return -1;
  const cx = r => r.left + r.width / 2, cy = r => r.top + r.height / 2;
  const ax = cx(a), ay = cy(a), tol = Math.min(a.width, a.height) / 4;
  let best = -1, bestScore = Infinity;
  rects.forEach((r, i) => {
    if (!r || i === from) return;
    const dx = cx(r) - ax, dy = cy(r) - ay;
    const along = dx * d[0] + dy * d[1], across = Math.abs(dx * d[1] - dy * d[0]);
    if (along <= tol || across > along) return; // only within a 45° cone
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/**
 * Why a held stack of `kind` cannot go onto target slot t, or '' when it can.
 * max = stack limit of the held kind (1 = does not stack).
 */
export function placeRefusal(kind, t, max) {
  if (!t || !t.kind || !(t.count > 0)) return '';
  if (t.kind !== kind) return 'Different item there';
  if (!(max > 1)) return 'Doesn’t stack';
  if (t.count >= max) return 'That stack is full';
  return '';
}

// ---- recipe order ----
// Inside a tab, recipes you can make right now come first, then ones blocked only by bag space,
// then the rest, closest-to-done first (fewest ingredients short, then fewest units short).
// The sort is stable, so recipes keep their book order within each group.
const STATE_RANK = Object.freeze({ ready: 0, full: 1, missing: 2, gated: 3 }); // gated = research / station lock

/** views: [{state, rows}] (rows from ingredientRows). Returns a new, sorted array. */
export function sortCraftableFirst(views) {
  const key = v => {
    let kinds = 0, units = 0;
    for (const r of v?.rows || []) if (!r.enough) { kinds++; units += r.short; }
    return [STATE_RANK[v?.state] ?? 3, kinds, units];
  };
  return (views || []).map((v, i) => ({ v, i, k: key(v) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map(x => x.v);
}

// ---- where items come from ----
// `tag` is the short text beside a missing ingredient (one or two short words, never cut off);
// `how` is the full tooltip line.
export const ITEM_SOURCE = Object.freeze({
  flowerseed: Object.freeze({ tag: 'islands', how: 'Pick bushes on islands; some drop flower seeds.' }),
  honey:   Object.freeze({ tag: 'beehive', how: 'Put a beehive near flower boxes, then press E on it to collect honeycomb.' }),
  wax:     Object.freeze({ tag: 'beehive', how: 'Collected with honey from a full beehive (E).' }),
  wood:    Object.freeze({ tag: 'floating', how: 'Hook floating planks. Barrels hold more.' }),
  leaf:    Object.freeze({ tag: 'floating', how: 'Hook floating leaf bundles, or harvest a grown palm.' }),
  plastic: Object.freeze({ tag: 'floating', how: 'Hook floating plastic jugs. Barrels hold some too.' }),
  scrap:   Object.freeze({ tag: 'floating', how: 'Hook floating scrap. Barrels hold some too.' }),
  seed:    Object.freeze({ tag: 'barrels', how: 'Hook floating barrels, or harvest a grown palm.' }),
  fish:    Object.freeze({ tag: 'fishing rod', how: 'Cast the Fishing Rod into the sea and wait for a bite.' }),
  water:   Object.freeze({ tag: 'fill a cup', how: 'Scoop sea water with a Cup, then purify it.' }),
  // raft-master materials (items.js): barrels, islands, the seafloor and the stations
  sand:        Object.freeze({ tag: 'barrels', how: 'Hook floating barrels, scoop it on an island or dive for it.' }),
  clay:        Object.freeze({ tag: 'barrels', how: 'Hook floating barrels or dive to the seafloor.' }),
  stone:       Object.freeze({ tag: 'barrels', how: 'Hook floating barrels or gather rocks on an island.' }),
  metalore:    Object.freeze({ tag: 'barrels', how: 'Hook floating barrels or dive to the seafloor.' }),
  copperore:   Object.freeze({ tag: 'barrels', how: 'Hook floating barrels; copper ore is rare.' }),
  seaweed:     Object.freeze({ tag: 'barrels', how: 'Hook floating barrels.' }),
  brick:       Object.freeze({ tag: 'grill', how: 'Fire clay on a grill.' }),
  metalingot:  Object.freeze({ tag: 'smelter', how: 'Smelt metal ore in a smelter.' }),
  copperingot: Object.freeze({ tag: 'smelter', how: 'Smelt copper ore in a smelter.' }),
  glass:       Object.freeze({ tag: 'smelter', how: 'Melt sand in a smelter.' }),
  saltcup:     Object.freeze({ tag: 'fill a cup', how: 'Hold an empty cup and click the sea.' }),
  freshcup:    Object.freeze({ tag: 'purifier', how: 'Pour sea water into a purifier and wait.' }),
  cookedfish:  Object.freeze({ tag: 'grill', how: 'Cook a fish on a grill.' }),
});

/**
 * Where to get `kind`: {tag, how, recipe}. `recipe` is the id of a recipe that makes it, or null.
 * Gathered items use ITEM_SOURCE; crafted ones describe their own recipe. Otherwise null.
 * @param {string} kind @param {Array} recipes normalised recipes @param {(k:string)=>string} [nameOf]
 */
export function sourceOf(kind, recipes, nameOf = k => k) {
  const made = (recipes || []).find(r => r && (r.out?.kind ?? r.id) === kind) || null;
  const known = ITEM_SOURCE[kind];
  if (known) return { tag: known.tag, how: known.how, recipe: made ? made.id : null };
  if (!made) return null;
  const cost = (made.reqs || []).map(q => `${q.count} ${nameOf(q.kind)}`).join(' + ');
  return { tag: 'craft it', how: cost ? `Craft it from ${cost}.` : 'Craft it.', recipe: made.id };
}

// ---- pinned recipe tracker (HUD edge) ----
export const PIN_KEY = 'little-raft-pinned-recipe';

/** The pinned recipe id from storage, or null when unset, not in validIds, or storage throws. */
export function loadPin(storage, validIds = null) {
  let v = null;
  try { v = storage?.getItem(PIN_KEY) ?? null; } catch { return null; }
  if (typeof v !== 'string' || !v) return null;
  if (validIds && !validIds.includes(v)) return null;
  return v;
}
/** Store the pinned recipe id, or clear it with null. Returns false when storage refuses. */
export function savePin(storage, id) {
  try {
    if (!storage) return false;
    if (id) storage.setItem(PIN_KEY, String(id)); else storage.removeItem(PIN_KEY);
    return true;
  } catch { return false; }
}

/**
 * What the HUD tracker shows for a normalised recipe: its owned/needed rows, state, how many
 * crafts the materials cover, and how many ingredient lines are complete.
 * `check` is an optional Bag.canCraft() result. Returns null without a recipe.
 */
export function trackerView(recipe, countOf, check = null) {
  if (!recipe) return null;
  const rows = ingredientRows(recipe.reqs, countOf);
  const times = craftableTimes(rows);
  return {
    id: recipe.id, name: recipe.name, kind: recipe.out?.kind ?? recipe.id, rows,
    state: recipeState(rows, check), times: Number.isFinite(times) ? times : 0,
    met: rows.filter(r => r.enough).length, total: rows.length,
  };
}

/** Caption under the Craft button: how hold and Shift work, with what Shift would make ('' for one-at-a-time items). */
export function craftCaption(max, one = false) {
  const n = Math.max(0, Math.floor(Number(max) || 0));
  return !one && n > 1 ? `Hold to make more · Shift makes all (${n})` : '';
}

/** Craft button hint: how many a hold would make right now ('' when one or none). */
export function holdHint(times, cap = HOLD.max) {
  const n = Math.min(Number.isFinite(times) ? Math.floor(times) : cap, cap);
  return n > 1 ? `hold: up to ${n}` : '';
}

// ---- recipe list ordering, compact amounts, craft counts ----

/**
 * Display order for one tab: craftable first, then "no room", then locked. Stable: recipes with the
 * same state keep their original order. items = [{id, state}]; returns the ids in display order.
 */
export function sortByCraftable(items) {
  return (items || [])
    .map((it, i) => ({ id: it.id, rank: STATE_RANK[it.state] ?? 2, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(x => x.id);
}

/** Short "owned/needed" for the inline ingredient chips in the recipe list (owned capped at 999+). */
export const chipLabel = row => `${row.have > 999 ? '999+' : row.have}/${row.need}`;

/** Most crafts one press can make: what the materials cover, capped by `cap` (0 when none). */
export function maxCraftable(times, cap = HOLD.max) {
  const c = Math.max(0, Math.floor(Number(cap) || 0));
  const t = Number.isFinite(times) ? Math.max(0, Math.floor(times)) : c;
  return Math.min(t, c);
}

/** Crafts a single click makes: everything it can with Shift held, else one (0 when not craftable). */
export const clickCrafts = (times, shift) => { const m = maxCraftable(times); return m <= 0 ? 0 : shift ? m : 1; };

/** Plain-words amount for the detail card and tracker: "have 40 · need 1". */
export const haveNeedLabel = row => `have ${row.have} · need ${row.need}`;

/** Tools and other non-stacking outputs are made one per press: no hold-repeat, no Shift-all. */
export const singleCraft = info => !!info && (!!info.tool || Number(info.maxStack) === 1);

/** Crafts one press may make for an output (1 for single-craft items, else maxCraftable). */
export function pressCap(times, info, cap = HOLD.max) {
  const m = maxCraftable(times, cap);
  return singleCraft(info) ? Math.min(1, m) : m;
}

/**
 * Recipe the bag opens on: the first ready recipe whose output the player has none of, else the
 * first ready one, else the first listed. items = [{id, cat, state, owned}] in display order.
 * @returns {{id, cat}|null}
 */
export function openingPick(items) {
  const list = items || [];
  const hit = list.find(x => x.state === 'ready' && !(x.owned > 0)) || list.find(x => x.state === 'ready') || list[0];
  return hit ? { id: hit.id, cat: hit.cat } : null;
}

/** Recipe id that makes `kind` (for jumping from a missing ingredient to its recipe), or null. */
export function recipeFor(kind, recipes) {
  for (const r of recipes || []) if (r && (r.out?.kind ?? r.id) === kind) return r.id;
  return null;
}

/**
 * What a backdrop click or Esc does while the bag is open: with a picked-up stack in hand it only
 * puts the stack back ('drop'); with empty hands it closes the bag ('close').
 */
export const dismissAction = holding => (holding ? 'drop' : 'close');

/** Centre of a slot rect: where a stack picked up with the keyboard is drawn (no pointer to follow). */
export const slotCentre = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// ---- pinned recipe tracker ----
/** A saved pin is kept only when it names a recipe that still exists. */
export function cleanPin(id, recipeIds) {
  if (typeof id !== 'string' || !id) return null;
  return (recipeIds || []).includes(id) ? id : null;
}

/** Tracker model for a pinned recipe: per-ingredient rows plus whether the materials cover it now. */
export function trackerModel(reqs, countOf) {
  const rows = ingredientRows(reqs, countOf);
  return { rows, ready: rows.every(r => r.enough), times: craftableTimes(rows) };
}

/**
 * Top offset for a widget docked at the right edge, below whatever already sits there.
 * rects = visible fixed boxes {left, top, right, bottom}; the widget spans [vw - right - width, vw - right].
 * Only boxes that overlap that column and start in the top band (above `band` px) push it down.
 */
export function dockTop(rects, vw, width, { right = 14, top = 14, gap = 8, band = 200 } = {}) {
  const x0 = vw - right - width, x1 = vw - right;
  let y = top;
  for (const r of rects || []) {
    if (!r || !(r.bottom > r.top) || !(r.right > r.left)) continue;
    if (r.right <= x0 || r.left >= x1 || r.top >= band) continue;
    y = Math.max(y, r.bottom + gap);
  }
  return y;
}

// ---- post-craft slot highlight ----
/**
 * Slot indices where `kind` arrived or grew between two slot arrays (bag snapshots),
 * i.e. where a freshly crafted item went, so that slot can flash.
 */
export function gainedSlots(before, after, kind) {
  const out = [];
  const n = Math.max(before?.length || 0, after?.length || 0);
  for (let i = 0; i < n; i++) {
    const a = after?.[i];
    if (!a || a.kind !== kind || !(a.count > 0)) continue;
    const b = before?.[i];
    if (!b || b.kind !== kind || a.count > (b.count || 0)) out.push(i);
  }
  return out;
}

// ---- item icon framing (item-icons.js) ----
/**
 * Frame a projected item silhouette for a square icon. pts = flat [x0, y0, x1, y1, ...] in camera
 * space (y up). Long items (extent along the main axis >= `long` x the extent across it) are rolled about the view
 * axis so their main axis runs along the lower-left -> upper-right diagonal, keeping whichever end
 * already pointed up-right. Returns {roll, cx, cy, half, aspect}: rotate the points by `roll`
 * (counter-clockwise, radians), then the square [cx - half, cx + half] x [cy - half, cy + half] holds
 * them with `pad` (fraction of the half size) to spare. `axis` (radians) overrides the main-axis
 * search. null for no points.
 */
export function fitIconFrame(pts, { pad = 0.1, long = 1.8, diag = Math.PI / 4, axis } = {}) {
  const n = Math.floor((pts?.length || 0) / 2);
  if (!n) return null;
  const ext = a => {
    const c = Math.cos(a), s = Math.sin(a);
    let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pts[2 * i], y = pts[2 * i + 1], u = x * c + y * s, v = -x * s + y * c;
      if (u < lo) lo = u; if (u > hi) hi = u; if (v < lo2) lo2 = v; if (v > hi2) hi2 = v;
    }
    return [hi - lo, hi2 - lo2];
  };
  // Main axis: the direction across which the silhouette is narrowest (a hammer's handle, not its
  // vertex-heavy head), searched in 3 degree steps.
  // A caller that knows the item's axis (its model's long side, projected) passes it as `axis`.
  let theta = 0, best = Infinity;
  if (Number.isFinite(axis)) theta = axis;
  else for (let k = 0; k < 60; k++) {
    const a = k * Math.PI / 60, [, w] = ext(a);
    if (w < best - 1e-12) { best = w; theta = a; }
  }
  const [along, across] = ext(theta);
  const aspect = along / Math.max(across, 1e-9);
  let roll = 0;
  if (aspect >= long) {
    // The axis is undirected: of theta and theta + PI, take the one nearer the up-right diagonal.
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    const r1 = wrap(diag - theta), r2 = wrap(diag - theta - Math.PI);
    roll = Math.abs(r1) <= Math.abs(r2) ? r1 : r2;
  }
  const c = Math.cos(roll), s = Math.sin(roll);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[2 * i], y = pts[2 * i + 1], u = x * c - y * s, v = x * s + y * c;
    if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
  }
  const half = Math.max(x1 - x0, y1 - y0, 1e-6) * 0.5 * (1 + Math.max(0, pad));
  return { roll, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, half, aspect };
}

// ---- research-gated recipes ----
const article = s => (/^(an?|the) /i.test(s) ? s : (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s);
/**
 * What a locked recipe shows, from a recipeGate() result ({locked, reason}): `line` is the one-line
 * requirement for the row and card ("Unlock: Research Glass at a Research Table"), `how` the tooltip
 * sentence saying what to do. null when the gate does not lock the recipe.
 */
export function unlockInfo(gate) {
  if (!gate || !gate.locked) return null;
  const reason = String(gate.reason || '').trim().replace(/\.$/, '');
  if (!reason) return { line: 'Unlock: not learned yet', how: 'Keep exploring: new finds and research teach new recipes.' };
  let how = reason + '.', m;
  if ((m = /^Research (.+) at (?:an? )?(.+)$/i.exec(reason))) how = `Place ${article(m[2])} on your raft, press E on it and research ${m[1]}. The recipe unlocks right away.`;
  else if ((m = /^Build (?:an? )?(.+)$/i.exec(reason))) how = `Build ${article(m[1])} and place it on your raft. The recipe unlocks once it stands.`;
  else if ((m = /^Find (.+?)(?: first)?$/i.exec(reason))) how = `Pick up ${m[1]} once (hook it from the sea, open barrels or dive). The recipe is learned as soon as you hold it.`;
  return { line: 'Unlock: ' + reason, how };
}

// ---- recipe search ----
/** Lower-cased search words; '' or only spaces gives []. */
export const searchTerms = q => String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Does a normalised recipe match the search? Every word must appear in the recipe name, its output
 * item's name or an ingredient's name (case-insensitive). An empty query matches everything.
 */
export function matchRecipe(recipe, query, nameOf = k => k) {
  const words = Array.isArray(query) ? query : searchTerms(query);
  if (!words.length) return true;
  if (!recipe) return false;
  const hay = [recipe.name, nameOf(recipe.out?.kind ?? recipe.id), ...(recipe.reqs || []).map(q => nameOf(q.kind))]
    .map(s => String(s ?? '').toLowerCase()).join('\n');
  return words.every(w => hay.includes(w));
}

/** Search matches across all tabs: {ids: Set of matching recipe ids, perCat: Map cat -> count}. items = [{id, cat, recipe}]. */
export function searchMatches(items, query, nameOf = k => k) {
  const words = searchTerms(query), ids = new Set(), perCat = new Map();
  for (const it of items || []) {
    if (!it || !matchRecipe(it.recipe, words, nameOf)) continue;
    ids.add(it.id); perCat.set(it.cat, (perCat.get(it.cat) || 0) + 1);
  }
  return { ids, perCat };
}

/**
 * What Esc does in the search field: with text it only clears the field ('clear'; the key must not
 * reach the dialog), when empty it is left to the normal Esc handling ('pass').
 */
export const searchEscape = value => (String(value ?? '') ? 'clear' : 'pass');

// ---- newly craftable recipes ----
/**
 * Compare the recipes ready now with the previous check. prev = Set of ids ready last time, or null on
 * the first check (nothing counts as new then, so loading a save is quiet). seen = ids that have been
 * ready before this session. Returns {crossed, first, seen}: crossed = ids that just became ready,
 * first = those of them ready for the first time, seen = the updated seen set (a new Set).
 */
export function readyTransitions(prev, now, seen = new Set()) {
  const next = new Set(seen), crossed = [], first = [];
  for (const id of now || []) {
    if (prev && !prev.has(id)) { crossed.push(id); if (!next.has(id)) first.push(id); }
    next.add(id);
  }
  return { crossed, first, seen: next };
}

/** Edge notice for a pinned recipe that just became craftable. */
export const readyNotice = name => `Ready to craft: ${name}`;
