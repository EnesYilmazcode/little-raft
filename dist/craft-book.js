// Little Raft crafting book: pure helpers behind the crafting panel (no DOM, no THREE, no timers).
// Category grouping, item descriptions, needed-vs-owned rows, the hold-to-craft repeat schedule
// and tooltip anchoring maths all live here so they can be unit-tested in node.

// Tabs, in display order. `icon` is a symbol id in icons.svg.
export const CATEGORIES = Object.freeze([
  Object.freeze({ id: 'tools',     name: 'Tools',     icon: 'hammer' }),
  Object.freeze({ id: 'materials', name: 'Materials', icon: 'wood' }),
  Object.freeze({ id: 'survival',  name: 'Survival',  icon: 'net' }),
  Object.freeze({ id: 'building',  name: 'Building',  icon: 'floor' }),
]);

// Recipe output kind -> category id. Unknown kinds fall back by shape (see categoryOf).
const CATEGORY_OF = Object.freeze({
  hook: 'tools', hammer: 'tools', fishingrod: 'tools',
  rope: 'materials',
  net: 'survival', palm: 'survival', lantern: 'survival', cup: 'survival',
  sail: 'building', bench: 'building', crate: 'building',
  // progression catalogue (items.js)
  metalhook: 'tools', binoculars: 'tools',
  drum: 'tools', pipes: 'tools', bells: 'tools', // [instruments]
  nail: 'materials', bolt: 'materials', hinge: 'materials',
  flowerbox: 'survival', beehive: 'survival', candle: 'survival', honeyfish: 'survival', // [bees]
  rainbarrel: 'survival', sprinkler: 'survival', // [rain-sprinkler]
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
  hammer:     { desc: 'A rope-bound building hammer.', use: 'Adds raft floor tiles (2 wood + 2 plastic each).' },
  fishingrod: { desc: 'A bamboo rod with a float and line.', use: 'Cast into the sea and wait for a bite to catch fish.' },
  sail:       { desc: 'A tall mast with a woven sail.', use: 'Decorates the raft; place it on a floor tile.' },
  palm:       { desc: 'A clay planter for a palm seed.', use: 'Place it on the raft, plant a seed, water it and grow leaves.' },
  lantern:    { desc: 'A post lantern with a warm glow.', use: 'Lights the raft at night; place on a tile.' },
  net:        { desc: 'A rope net stretched over the water.', use: 'Catches nearby floating supplies for you.' },
  bench:      { desc: 'A simple plank bench.', use: 'Somewhere to sit; place it on a floor tile.' },
  crate:      { desc: 'A nailed wooden crate.', use: 'Decorates the raft; place it on a floor tile.' },
  sand:       { desc: 'Fine sand from barrels and the seafloor.', use: 'Melt it into glass in the smelter.' },
  stone:      { desc: 'A smooth, heavy stone.', use: 'Part of the smelter; sturdier builds and island tools.' },
  seed:       { desc: 'A palm seed washed up on an island.', use: 'Plant it in a palm planter.' },
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
  researchtable: { desc: 'A table for showing off new finds.', use: 'Place it and research items to unlock recipes.' },
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
 * Tab / I open it from play. While open, I / E close it and Tab is left to move focus.
 * E never opens here: in play it is the pick-up key and the game opens the bag itself.
 */
export function bagKeyAction(code, isOpen) {
  if (isOpen) return code === 'KeyI' || code === 'KeyE' ? 'close' : null;
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
const STATE_RANK = Object.freeze({ ready: 0, full: 1, missing: 2 });

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
// `tag` is the short text beside a missing ingredient; `how` is the tooltip line.
export const ITEM_SOURCE = Object.freeze({
  wood:    Object.freeze({ tag: 'found floating', how: 'Hook floating planks. Barrels hold more.' }),
  leaf:    Object.freeze({ tag: 'floating, palm', how: 'Hook floating leaf bundles, or harvest a grown palm.' }),
  plastic: Object.freeze({ tag: 'found floating', how: 'Hook floating plastic jugs. Barrels hold some too.' }),
  scrap:   Object.freeze({ tag: 'found floating', how: 'Hook floating scrap. Barrels hold some too.' }),
  seed:    Object.freeze({ tag: 'barrels, palm', how: 'Hook floating barrels, or harvest a grown palm.' }),
  fish:    Object.freeze({ tag: 'fishing rod', how: 'Cast the Fishing Rod into the sea and wait for a bite.' }),
  water:   Object.freeze({ tag: 'fill a cup', how: 'Fill a Filter Cup at the sea.' }),
  // Lane items (progression, diving, islands, watering, cooking): gathered or made at a station, not in the hand-craft list.
  sand:      Object.freeze({ tag: 'barrels, seafloor', how: 'Open floating barrels, dive to the seafloor, or scoop it on an island.' }),
  clay:      Object.freeze({ tag: 'barrels, seafloor', how: 'Open floating barrels, or dive and dig it from the seafloor.' }),
  metalore:  Object.freeze({ tag: 'barrels, seafloor', how: 'Open floating barrels, or dive and mine it from the seafloor.' }),
  stone:     Object.freeze({ tag: 'barrels, islands', how: 'Open floating barrels, or gather rocks on an island.' }),
  copperore: Object.freeze({ tag: 'barrels', how: 'A lucky find in floating barrels.' }),
  seaweed:   Object.freeze({ tag: 'barrels', how: 'Found tangled in floating barrels.' }),
  saltcup:   Object.freeze({ tag: 'fill a cup', how: 'Click the sea while holding an empty cup.' }),
  freshcup:  Object.freeze({ tag: 'purifier', how: 'Pour sea water into a water purifier and take the fresh cup.' }),
  brick:     Object.freeze({ tag: 'grill', how: 'Fire clay on a grill.' }),
  metalingot:  Object.freeze({ tag: 'smelter', how: 'Smelt metal ore in the smelter.' }),
  copperingot: Object.freeze({ tag: 'smelter', how: 'Smelt copper ore in the smelter.' }),
  glass:     Object.freeze({ tag: 'smelter', how: 'Melt sand in the smelter.' }),
  cookedfish:  Object.freeze({ tag: 'grill', how: 'Grill a fish on the grill.' }),
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

/** Craft button hint: how many a hold would make right now ('' when one or none). */
export function holdHint(times, cap = HOLD.max) {
  const n = Math.min(Number.isFinite(times) ? Math.floor(times) : cap, cap);
  return n > 1 ? `hold: up to ${n}` : '';
}

/**
 * Craft button text while a hold is running ('Crafting 2 / 4') and just after it ends ('Crafted 4').
 * `out` = items each craft makes, so a nail recipe (x3) reads 'Crafted 12' after 4 crafts.
 */
export function holdLabel(done, cap, holding = true, out = 1) {
  const d = Math.max(0, Math.floor(Number(done) || 0));
  const per = Math.max(1, Math.floor(Number(out) || 1));
  if (!holding) return d > 0 ? `Crafted ${d * per}` : '';
  const c = Math.max(d, Math.floor(Number(cap) || 0));
  return c > 1 ? `Crafting ${d} / ${c}` : 'Crafting';
}

// ---- tooltip facts ----
/**
 * Hand recipes (RECIPES-like: {id, name, output:{kind,count}, cost}) plus station and catalogue
 * recipes (ITEMS-like: {id, name, recipe:{cost, count, station}}) as one normalised list
 * ({id, name, out:{kind,count}, reqs, station}). A hand recipe wins over a catalogue one with the same id.
 */
export function catalogueRecipes(recipes, items) {
  const out = [], seen = new Set();
  const reqsOf = cost => Object.entries(cost || {}).map(([kind, count]) => ({ kind, count: Number(count) || 0 }));
  for (const [key, r] of Object.entries(recipes || {})) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id ?? key);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(r.name ?? id), out: { kind: r.output?.kind ?? id, count: r.output?.count ?? 1 }, reqs: reqsOf(r.cost), station: null });
  }
  for (const [key, it] of Object.entries(items || {})) {
    const r = it && it.recipe;
    if (!r || typeof r !== 'object') continue;
    const id = String(it.id ?? key);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(it.name ?? id), out: { kind: id, count: r.count ?? 1 }, reqs: reqsOf(r.cost), station: r.station ?? null });
  }
  return out;
}

/**
 * The "where to get it" and "used in" lines for an item tooltip.
 * get: one sentence or null. uses: names of recipes that consume the item, at most `max`
 * entries (the last one becomes '+N more' when the list is longer).
 * @param {string} kind @param {Array} recipes normalised recipes @param {(k:string)=>string} [nameOf]
 */
export function tipFacts(kind, recipes, nameOf = k => k, max = 4) {
  const src = sourceOf(kind, recipes, nameOf);
  const all = [...new Set((recipes || []).filter(r => r && (r.reqs || []).some(q => q.kind === kind))
    .map(r => r.station ? `${r.name} (${nameOf(r.station)})` : r.name))];
  const m = Math.max(1, Math.floor(max));
  const uses = all.length > m ? [...all.slice(0, m - 1), `+${all.length - (m - 1)} more`] : all;
  let get = src ? src.how : null;
  const made = src && src.recipe ? (recipes || []).find(r => r && r.id === src.recipe) : null;
  if (made && made.station && !ITEM_SOURCE[kind]) {
    const cost = (made.reqs || []).map(q => `${q.count} ${nameOf(q.kind)}`).join(' + ');
    get = `Make it at the ${nameOf(made.station)}${cost ? ` from ${cost}` : ''}.`;
  }
  return { get, uses };
}
