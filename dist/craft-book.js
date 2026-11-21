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
  net: 'survival', palm: 'survival', lantern: 'survival',
  sail: 'building', bench: 'building', crate: 'building',
  // progression catalogue (items.js)
  metalhook: 'tools', binoculars: 'tools',
  drum: 'tools', pipes: 'tools', bells: 'tools', // [instruments]
  nail: 'materials', bolt: 'materials', hinge: 'materials',
  flowerbox: 'survival', beehive: 'survival', candle: 'survival', honeyfish: 'survival', // [bees]
  shelf: 'survival', trophystand: 'survival', // [display]
  turbine: 'survival', battery: 'survival', stringlights: 'survival', lamppost: 'survival', // [power]
  fishtrap: 'survival', // [fishtrap]
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
  palm:       { desc: 'A clay pot with a small palm tree.', use: 'A bit of island on your raft; place on a tile.' },
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
  shelf:      { desc: 'A little wooden display shelf.', use: 'Shows 3 items; E to put or take.' }, // [display]
  trophystand: { desc: 'A small pedestal with a brass plaque.', use: 'Shows 1 item or a fish trophy.' }, // [display]
  turbine:    { desc: 'A little three-blade wind turbine on a mast.', use: 'Place next to a battery; it charges in the wind.' }, // [power]
  battery:    { desc: 'A sturdy box that stores wind power.', use: 'Powers lights within 3 tiles at night. Check it with E.' }, // [power]
  stringlights: { desc: 'A post with a wire of warm little bulbs.', use: 'Glows at night near a charged battery.' }, // [power]
  lamppost:   { desc: 'A tall lamp with a glass head.', use: 'Lights the deck at night near a charged battery.' }, // [power]
  fishtrap:   { desc: 'A woven fish basket on a little arm.', use: 'Place on an edge tile. Seaweed bait helps. Collect with E.' }, // [fishtrap]
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
