// Crate labels, Stash to nearby crates, Sort (docs/specs/crate-labels.md). Pure rules: no DOM, no THREE.
// The cozy rules: an item is never lost or duplicated, a tool keeps its wear, the hotbar is never touched,
// and a refusal changes nothing (callers work on copies; see storage-research.js applyStorageAction).
import { ITEM_INFO, HOTBAR_SIZE } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { ITEMS } from './items.js?build=v3-survival-ae77fa84ac2b';

export const STASH_R = 6;              // metres, raft-local, actor to tile centre (x*2, z*2)
export const LABEL_MAX = 16;           // code points
export const CATEGORY_ORDER = Object.freeze(['tool', 'material', 'refined', 'food', 'build', 'station', 'decor', 'other']);
export const LABEL_TEXT = Object.freeze({ nothingNear: 'No crates nearby with matching items', badLabel: 'That label won’t fit',
  oldHost: 'Your friend’s raft can’t label or stash yet' });

const CHEST_SLOTS = 12; // same as storage-research.js CHEST_SLOTS (not imported: that module imports this one)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const maxStack = k => ITEM_INFO[k]?.maxStack ?? 1;
const nameOf = k => ITEM_INFO[k]?.name ?? String(k);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// ------------------------------------------------------------------ labels

/** Clean free text: NFC, whitespace runs to one space, no control/format/private chars, at most LABEL_MAX code points. */
export function cleanText(raw) {
  if (raw === null || raw === undefined) return '';
  let s;
  try { s = String(raw).normalize('NFC'); } catch { return ''; }
  s = s.replace(/\s+/gu, ' ').replace(/\p{C}/gu, '').replace(/\s+/gu, ' ').trim();
  return [...s].slice(0, LABEL_MAX).join('').trim();
}
/** -> {k} | {t} | null. A known kind wins over text; anything else is null. */
export function cleanLabel(raw, isKind) {
  if (!isObj(raw)) return null;
  if (typeof raw.k === 'string' && isKind(raw.k)) return { k: raw.k };
  if (typeof raw.t === 'string') { const t = cleanText(raw.t); if (t !== '') return { t }; }
  return null;
}
/** -> {"x,z": label}: valid tile keys only (|x|,|z| <= 25), at most `max` entries. */
export function cleanLabels(raw, isKind, max) {
  const out = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const key of Object.keys(raw)) {
    if (n >= max) break;
    const m = /^(-?\d{1,2}),(-?\d{1,2})$/.exec(key); if (!m) continue;
    const x = +m[1], z = +m[2]; if (Math.abs(x) > 25 || Math.abs(z) > 25) continue;
    const l = cleanLabel(raw[key], isKind); if (!l) continue;
    const k = x + ',' + z; if (hasOwn(out, k)) continue;
    out[k] = l; n++;
  }
  return out;
}
export const labelKey = l => l ? (l.k ? 'k:' + l.k : 't:' + l.t) : '';      // texture cache key
export const sameLabel = (a, b) => labelKey(a) === labelKey(b);
export function labelName(l, names = nameOf) {
  if (!l) return '';
  if (l.k) return names(l.k);
  return typeof l.t === 'string' ? l.t : '';
}

// ------------------------------------------------------------------ kinds and categories

export function categoryOf(kind) {
  const c = ITEMS[kind]?.category;
  if (c && CATEGORY_ORDER.includes(c)) return c;
  if (ITEM_INFO[kind]?.tool) return 'tool';
  return 'other';
}
const byName = (a, b) => nameOf(a).localeCompare(nameOf(b), 'en') || (a < b ? -1 : a > b ? 1 : 0);
/** -> [{category, kinds}] in CATEGORY_ORDER, kinds sorted by name, empty groups dropped. */
export function groupedKinds(kinds) {
  const groups = new Map(CATEGORY_ORDER.map(c => [c, []]));
  for (const k of new Set(kinds)) groups.get(categoryOf(k)).push(k);
  const out = [];
  for (const c of CATEGORY_ORDER) { const ks = groups.get(c); if (ks.length) out.push({ category: c, kinds: ks.sort(byName) }); }
  return out;
}
/** The picker "Seen" row: kinds in the bag, in any crate, or studied. Known kinds only, sorted by name. */
export function seenKinds(bagSlots, chests, seen) {
  const out = new Set();
  const add = k => { if (typeof k === 'string' && hasOwn(ITEM_INFO, k)) out.add(k); };
  if (Array.isArray(bagSlots)) for (const s of bagSlots) if (s) add(s.kind);
  if (isObj(chests)) for (const key of Object.keys(chests)) { const c = chests[key]; if (Array.isArray(c)) for (const s of c) if (s) add(s.kind); }
  if (Array.isArray(seen)) for (const k of seen) add(k);
  return [...out].sort(byName);
}

// ------------------------------------------------------------------ sort

export const mergeable = (a, b) => !!a && !!b && a.kind === b.kind && maxStack(a.kind) > 1 && a.durability === undefined
  && b.durability === undefined && a.id === undefined && b.id === undefined;
const sameFields = (a, b) => (!a && !b) || (!!a && !!b && a.kind === b.kind && a.count === b.count && a.durability === b.durability && a.id === b.id);

/** -> {slots, changed}: merged partial stacks, ordered by category, name, kind, count desc; empties last. Input untouched. */
export function sortChest(chest) {
  const src = Array.isArray(chest) ? chest : [];
  const c = [];
  for (let i = 0; i < CHEST_SLOTS; i++) c.push(src[i] ? { ...src[i] } : null);
  for (let i = 0; i < c.length; i++) {
    const a = c[i]; if (!a) continue;
    const max = maxStack(a.kind);
    for (let j = i + 1; j < c.length && a.count < max; j++) {
      const b = c[j]; if (!mergeable(a, b)) continue;
      const put = Math.min(max - a.count, b.count); a.count += put; b.count -= put;
      if (b.count <= 0) c[j] = null;
    }
  }
  const items = [];
  for (let i = 0; i < c.length; i++) if (c[i]) items.push({ s: c[i], i, cat: CATEGORY_ORDER.indexOf(categoryOf(c[i].kind)), name: nameOf(c[i].kind) });
  items.sort((a, b) => a.cat - b.cat || a.name.localeCompare(b.name, 'en') || (a.s.kind < b.s.kind ? -1 : a.s.kind > b.s.kind ? 1 : 0)
    || b.s.count - a.s.count || a.i - b.i);
  const slots = new Array(CHEST_SLOTS).fill(null);
  items.forEach((e, i) => { slots[i] = e.s; });
  let changed = false;
  for (let i = 0; i < CHEST_SLOTS; i++) if (!sameFields(slots[i], src[i] ?? null)) { changed = true; break; }
  return { slots, changed };
}

// ------------------------------------------------------------------ stash

/** crates: [{x,z}] crate decor -> [{key, d}] within r of pos, nearest first, then by key. */
export function stashTargets(crates, chests, labels, pos, r = STASH_R) {
  const out = [];
  if (!Array.isArray(crates) || !pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return out;
  const keys = new Set();
  for (const c of crates) {
    if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.z)) continue;
    const key = c.x + ',' + c.z; if (keys.has(key)) continue;
    const d = Math.hypot(pos.x - c.x * 2, pos.z - c.z * 2);
    if (d <= r) { keys.add(key); out.push({ key, d }); }
  }
  out.sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}
const holds = (chest, kind) => { if (!chest) return false; for (let i = 0; i < chest.length; i++) if (chest[i] && chest[i].kind === kind) return true; return false; };
// Target keys for one kind: crates labelled with it first, then crates holding it, each nearest first, no duplicates.
function targetsFor(kind, chests, targets, labels) {
  const out = [];
  for (const t of targets) if (labels?.[t.key]?.k === kind) out.push(t.key);
  for (const t of targets) if (!out.includes(t.key) && holds(chests[t.key], kind)) out.push(t.key);
  return out;
}
/**
 * Move every backpack stack (HOTBAR_SIZE..) into the target crates for its kind. Mutates `bagSlots` and `chests`
 * (the caller's COPIES). `move` is storage-research.js moveStack. -> {moved, crates:Set<key>, changed:Set<key>}.
 * A labelled empty crate may get a fresh array even when nothing lands in it: commit only keys in `changed`.
 */
export function planStash(bagSlots, chests, targets, labels, move) {
  let moved = 0;
  const crates = new Set(), changed = new Set();
  for (let i = HOTBAR_SIZE; i < bagSlots.length; i++) {
    const s = bagSlots[i]; if (!s) continue;
    const list = targetsFor(s.kind, chests, targets, labels);
    for (let j = 0; j < list.length && bagSlots[i]; j++) {
      const key = list[j];
      const n = move(bagSlots, i, chests[key] ??= new Array(CHEST_SLOTS).fill(null), null, null);
      if (n > 0) { moved += n; crates.add(key); changed.add(key); }
    }
  }
  return { moved, crates, changed };
}
const roomFor = (chest, kind) => {
  if (!chest) return true;
  const max = maxStack(kind);
  for (let i = 0; i < chest.length; i++) { const c = chest[i]; if (!c || (max > 1 && c.kind === kind && c.count < max)) return true; }
  return false;
};
/** Backpack kinds that some target would take right now (UI enable; reads only, no copies). */
export function stashableKinds(bagSlots, chests, targets, labels) {
  const out = new Set();
  if (!Array.isArray(bagSlots) || !targets?.length) return out;
  for (let i = HOTBAR_SIZE; i < bagSlots.length; i++) {
    const s = bagSlots[i]; if (!s || out.has(s.kind)) continue;
    for (const t of targets) {
      const c = chests?.[t.key];
      if ((labels?.[t.key]?.k === s.kind || holds(c, s.kind)) && roomFor(c, s.kind)) { out.add(s.kind); break; }
    }
  }
  return out;
}
