// Seaglass Canteen (docs/specs/canteen.md). Pure rules: no DOM, no THREE, no clocks or randomness.
// The fill is the tool durability (0..100, 25 per sip), so saves, co-op bags and chests keep it as is.
// Never import vitals.js here (an unstamped copy would carry its own FOOD table).
import { BARREL_CAP } from './rain.js?build=v3-survival-ae77fa84ac2b';
import { tileKey } from './watering.js?build=v3-survival-ae77fa84ac2b';

export const SIP = 25, MAX = 100, SIPS = 4;
export const OLD_HOST = 'Your friend’s raft doesn’t have canteens yet';
export const EMPTY = 'Empty: fill at a purifier or rain barrel';
export { BARREL_CAP };

const TEXT = Object.freeze({
  notarget:'Nothing to fill from', notready:'Still purifying', empty:'The rain barrel is empty', full:'Your canteen is full',
  nocanteen:'Hold your canteen to fill it', none:'You have no canteen', notpour:'Drop a cup of fresh water on the canteen', bagfull:'No room for the empty cup',
});
const fail = (reason, text = TEXT[reason]) => ({ok:false, reason, text});
const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const decorType = (world, key) => {
  if (!Array.isArray(world?.decor)) return null;
  for (const d of world.decor) if (d && (d.type === 'purifier' || d.type === 'rainbarrel') && tileKey(d.x, d.z) === key) return d.type;
  return null;
};
const level = (d) => { const n = Number(d); return Number.isFinite(n) ? Math.max(0, Math.min(MAX, n)) : 0; };

export const sipsOf = slot => slot?.kind === 'canteen' ? Math.max(0, Math.min(SIPS, Math.round((Number(slot.durability) || 0) / SIP))) : 0;

/** Fill level after adding `sips` sips to `d` (clamped 0..MAX; a non-finite d counts as 0). */
export function fillAmount(d, sips = 1) { return Math.min(MAX, level(d) + sips * SIP); }

/** Drink one sip: the selected canteen, else the first canteen with a sip. Mutates the slot in place. */
export function sipFrom(bag) {
  const sel = bag.slots[bag.selectedIndex];
  let index = -1;
  if (sel?.kind === 'canteen') {
    if (sipsOf(sel) < 1) return fail('empty', EMPTY);
    index = bag.selectedIndex;
  } else {
    index = bag.slots.findIndex(s => s?.kind === 'canteen' && sipsOf(s) >= 1);
    if (index < 0) return fail('none');
  }
  const s = bag.slots[index];
  s.durability = Math.max(0, level(s.durability) - SIP);
  return {ok:true, index};
}

/** Fill the selected canteen by one sip from the purifier / rain barrel at `key`. */
export function fillFrom(world, key, bag) {
  const type = decorType(world, key);
  if (!type) return fail('notarget');
  const s = bag.slots[bag.selectedIndex];
  if (s?.kind !== 'canteen') return fail('nocanteen');
  if (level(s.durability) >= MAX) return fail('full');
  if (type === 'purifier') {
    if (!isPlain(world.purifiers) || !world.purifiers[key]?.ready) return fail('notready');
    s.durability = fillAmount(s.durability, 1);
    delete world.purifiers[key];
  } else {
    const e = isPlain(world.collectors) ? world.collectors[key] : null;
    if (!e || !(e.w >= 1)) return fail('empty');
    s.durability = fillAmount(s.durability, 1);
    e.w -= 1;
    if (!(e.w || e.f || e.s)) delete world.collectors[key]; // same as rain.js tidy
  }
  return {ok:true, kind:'loot', text:`+ 1 sip (${sipsOf(s)}/${SIPS})`};
}

/** True when slot `from` holds fresh water and slot `to` a canteen with room. */
export function isPour(bag, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
  const a = bag?.slots?.[from], b = bag?.slots?.[to];
  return a?.kind === 'freshcup' && b?.kind === 'canteen' && level(b.durability) < MAX;
}

/** Pour one fresh cup into the canteen; the empty cup stays in the bag. All or nothing. */
export function pourCup(bag, from, to) {
  if (!isPour(bag, from, to)) return fail('notpour');
  const s = new bag.constructor(bag.snapshot()), cup = s.slots[from];
  if (cup.count <= 1) s.slots[from] = {kind:'cup', count:1};
  else { cup.count -= 1; if (s.add('cup', 1) !== 0) return fail('full', TEXT.bagfull); }
  const c = s.slots[to];
  c.durability = fillAmount(c.durability, 1);
  for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = s.slots[i];
  return {ok:true, text:`Poured into the canteen (${sipsOf(c)}/${SIPS})`};
}

/** Prompt + actions while holding a canteen at a purifier / barrel. d = {key, type, x, z}. Null = let the cup prompts show.
 * Called every frame: the last answer is reused while nothing changed, so aiming allocates nothing. */
const last = {x:NaN, z:NaN, n:-1, busy:false, out:null};
const PROMPTS = Array.from({length:SIPS + 1}, (_, n) => `<kbd>E</kbd>Fill canteen (${n}/${SIPS})`);
const BUSY = Array.from({length:SIPS + 1}, (_, n) => `Purifying… (canteen ${n}/${SIPS})`);
export function canteenTarget(world, d, slot) {
  if (slot?.kind !== 'canteen' || !d || (d.type !== 'purifier' && d.type !== 'rainbarrel')) return null;
  if (level(slot.durability) >= MAX) return null;
  const key = d.key ?? tileKey(d.x, d.z), n = sipsOf(slot);
  let busy = false;
  if (d.type === 'purifier') {
    const e = world?.purifiers?.[key];
    if (!e) return null;
    busy = !e.ready;
  } else if (!(world?.collectors?.[key]?.w >= 1)) return null;
  if (last.out && last.x === d.x && last.z === d.z && last.n === n && last.busy === busy) return last.out;
  const act = busy ? null : {kind:'canteenFill', x:d.x, z:d.z};
  last.x = d.x; last.z = d.z; last.n = n; last.busy = busy;
  last.out = ({prompt:busy ? BUSY[n] : PROMPTS[n], click:act, e:act, why:busy ? BUSY[n] : null});
  return last.out;
}
