// Fish species table + catch rolls for the fishing & cooking lane.
// Pure ES module: no DOM, no THREE. Randomness is always injected (rand() -> [0,1)).
// API:
//   RARITY                         rarity id -> { label, weight, color }
//   SPECIES                        frozen array of species (see shape below)
//   speciesById(id)                -> species | null
//   rollCatch(rand, {charge, night}) -> { species, cm, stars }
//   biteDelay(rand, speciesId)     -> seconds within species.bite
//   DISHES                         { cooked:'Grilled', burnt:'Charred' } dish name prefixes
//   dishName(speciesId, state)     -> 'Grilled Pomfret' | 'Charred Pomfret'
// Species: { id, name, rarity, minCm, maxCm, fight 0..1, bite:[min,max]s, time:'any'|'day'|'night',
//            look:{ shape, body, belly, fin, stripes?, bars?, spots?, finlets?, whiskers? }, blurb, dish }

const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };

export const RARITY = deepFreeze({
  common:    { label: 'Common',    weight: 60, color: '#cfd8cf' },
  uncommon:  { label: 'Uncommon',  weight: 28, color: '#7fd3a0' },
  rare:      { label: 'Rare',      weight: 10, color: '#6fb6ff' },
  legendary: { label: 'Legendary', weight: 2,  color: '#ffc857' },
});

const sp = (id, name, rarity, minCm, maxCm, fight, bite, time, look, blurb) =>
  ({ id, name, rarity, minCm, maxCm, fight, bite, time, look, blurb, dish: `Grilled ${name}` });

export const SPECIES = deepFreeze([
  sp('pomfret', 'Pomfret', 'common', 18, 34, 0.35, [3, 7], 'any',
    { shape: 'disc', body: '#b9c4cc', belly: '#eef2f4', fin: '#8e9ba6' },
    'A round little plate of a fish that seems to wander into every bucket.'),
  sp('herring', 'Herring', 'common', 15, 30, 0.25, [2, 6], 'any',
    { shape: 'torpedo', body: '#4f7fa8', belly: '#e3edf3', fin: '#6d93b3' },
    'Travels in glittering crowds; one always lags behind for your hook.'),
  sp('tilapia', 'Tilapia', 'common', 20, 40, 0.4, [3, 8], 'day',
    { shape: 'deep', body: '#7c8f74', belly: '#d9dfc8', fin: '#5f7262', bars: '#55664f' },
    'Sunbathes near floating driftwood and grumbles when disturbed.'),
  sp('mackerel', 'Mackerel', 'uncommon', 25, 45, 0.55, [3, 8], 'any',
    { shape: 'torpedo', body: '#2f7f7a', belly: '#e8f0ee', fin: '#3d6866', stripes: '#123c3d' },
    'Wears its tiger-striped coat like it is late for something important.'),
  sp('catfish', 'Catfish', 'uncommon', 35, 70, 0.6, [5, 11], 'night',
    { shape: 'long', body: '#5b5148', belly: '#b9ac98', fin: '#463d36', whiskers: '#2f2823' },
    'Its whiskers twitch at the smell of supper long after sunset.'),
  sp('salmon', 'Salmon', 'rare', 45, 85, 0.7, [5, 12], 'any',
    { shape: 'torpedo', body: '#9aa7b0', belly: '#f2b6a6', fin: '#7d8a93', spots: '#2d3540' },
    'Pink-cheeked wanderer, always a little homesick for a river.'),
  sp('tuna', 'Tuna', 'rare', 60, 120, 0.85, [6, 13], 'day',
    { shape: 'torpedo', body: '#1f3d6b', belly: '#d6dde6', fin: '#28456f', finlets: '#f2c53d' },
    'A muscular blue sprinter with tiny golden finlets like a crown.'),
  sp('sunscale', 'Golden Sunscale', 'legendary', 40, 75, 0.95, [8, 16], 'day',
    { shape: 'deep', body: '#f0b429', belly: '#fff1c1', fin: '#e07a1f', spots: '#fff7d6' },
    'Sailors say it swallowed a sliver of sunset and never gave it back.'),
]);

const BY_ID = new Map(SPECIES.map((s) => [s.id, s]));

export function speciesById(id) {
  return (typeof id === 'string' && BY_ID.get(id)) || null;
}

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);
const r01 = (rand) => { const v = Number(rand()); return Number.isFinite(v) ? Math.min(0.999999, Math.max(0, v)) : 0.5; };

/** Per-species weight: rarity weight split across its species; time-of-day mismatch x0.3; charge boosts rare. */
function weightOf(s, charge, night, perRarity, boost = null) {
  let w = RARITY[s.rarity].weight / perRarity[s.rarity];
  if (s.rarity === 'rare' || s.rarity === 'legendary') w *= 1 + 0.5 * charge;
  if ((s.time === 'night' && !night) || (s.time === 'day' && night)) w *= 0.3;
  const m = Number(boost?.[s.rarity]); if (m > 0 && Number.isFinite(m)) w *= m; // [bait] rarity multiplier
  return w;
}

const PER_RARITY = SPECIES.reduce((m, s) => ((m[s.rarity] = (m[s.rarity] || 0) + 1), m), {});

export function starsFor(species, cm) {
  const span = species.maxCm - species.minCm;
  const f = span > 0 ? (cm - species.minCm) / span : 0;
  return f >= 0.85 ? 3 : f >= 0.5 ? 2 : 1;
}

export function rollCatch(rand = Math.random, { charge = 0.5, night = false, boost = null } = {}) { // [bait] boost {rarity: x}
  const c = clamp01(Number(charge));
  const ws = SPECIES.map((s) => weightOf(s, c, !!night, PER_RARITY, boost));
  let pick = r01(rand) * ws.reduce((a, b) => a + b, 0);
  let species = SPECIES[SPECIES.length - 1];
  for (let i = 0; i < SPECIES.length; i++) { pick -= ws[i]; if (pick < 0) { species = SPECIES[i]; break; } }
  const t = (r01(rand) + r01(rand)) / 2; // triangular: biased toward the middle
  const cm = Math.round((species.minCm + (species.maxCm - species.minCm) * t) * 10) / 10;
  return { species: species.id, cm, stars: starsFor(species, cm) };
}

export function biteDelay(rand = Math.random, speciesId) {
  const [lo, hi] = (speciesById(speciesId) || SPECIES[0]).bite;
  return lo + (hi - lo) * r01(rand);
}

export const DISHES = Object.freeze({ cooked: 'Grilled', burnt: 'Charred' });

export function dishName(speciesId, state = 'cooked') {
  const s = speciesById(speciesId);
  const name = s ? s.name : 'Fish';
  return `${state === 'burnt' ? DISHES.burnt : DISHES.cooked} ${name}`;
}
