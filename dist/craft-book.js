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

// ---- recipe list ordering, compact amounts, craft counts ----
const STATE_RANK = { ready: 0, full: 1, missing: 2 };

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
