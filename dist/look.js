// Character customisation ("Look") data: palettes, hats, validation and per-browser storage.
// Pure module (no DOM, no THREE), importable from node. Spec: docs/specs/customise.md.
// A look is {shirt, trousers, skin, hair, hat}: colour slots are palette indices, hat is a HATS id.
// Never part of the world save or world.ext; co-op peers exchange it in hello / 'look' events.
export const LOOK_KEY = 'little-raft-look-v1';
export const PALETTE = Object.freeze({ // [id, label, hex]; index 0 of each slot is today's look
  shirt: [['sun', 'Sunny orange', '#efae55'], ['sky', 'Sky blue', '#70a7e4'], ['coral', 'Coral', '#e8776a'], ['leaf', 'Leaf green', '#7fbf6a'],
    ['sea', 'Sea teal', '#3f9e9a'], ['plum', 'Plum', '#9a6fb8'], ['butter', 'Butter', '#f2d873'], ['rose', 'Rose', '#ee9ec0'],
    ['navy', 'Navy', '#33507e'], ['cream', 'Cream', '#f1e8d2']],
  trousers: [['denim', 'Denim', '#2f4a6b'], ['sand', 'Sand', '#c9ad7f'], ['moss', 'Moss', '#5d7148'], ['brick', 'Brick', '#9a4f3c'],
    ['char', 'Charcoal', '#3b3d44'], ['ocean', 'Ocean', '#3a77a8'], ['white', 'Sail white', '#e9e4d8'], ['berry', 'Berry', '#7d3d66']],
  skin: [['s1', 'Tone 1', '#f2c29b'], ['s2', 'Tone 2', '#f6d3b3'], ['s3', 'Tone 3', '#e2a97e'], ['s4', 'Tone 4', '#c98b5f'],
    ['s5', 'Tone 5', '#a86c44'], ['s6', 'Tone 6', '#8a5536'], ['s7', 'Tone 7', '#6b3f27'], ['s8', 'Tone 8', '#4e2d1c']],
  hair: [['brown', 'Brown', '#6b4226'], ['black', 'Black', '#22201f'], ['auburn', 'Auburn', '#9a4a26'], ['blond', 'Blond', '#d9b45a'],
    ['ginger', 'Ginger', '#c8662f'], ['grey', 'Grey', '#a7a29a'], ['white', 'White', '#ece6da'], ['teal', 'Teal', '#3e8f8a']],
});
export const SLOTS = Object.freeze(['shirt', 'trousers', 'skin', 'hair']);
export const HATS = Object.freeze([ // picker order; unlock = logbook achievement id (dist/logbook.js ACHIEVEMENTS) or null
  { id: 'straw', label: 'Straw sunhat', unlock: null },
  { id: 'none', label: 'No hat', unlock: null },
  { id: 'beanie', label: 'Knit beanie', unlock: 'tiles25' },    // Floating Neighbourhood
  { id: 'bucket', label: 'Bucket hat', unlock: 'fish10' },      // Fish Whisperer
  { id: 'flower', label: 'Flower crown', unlock: 'craft_palm' }, // A Little Green
]);
const HAT_IDS = HATS.map(h => h.id);
export const DEFAULT_LOOK = Object.freeze({ shirt: 0, trousers: 0, skin: 0, hair: 0, hat: 'straw' });
export const PARTNER_DEFAULT = Object.freeze({ ...DEFAULT_LOOK, shirt: 1 }); // today's #70a7e4 partner

const okIndex = (slot, v) => Number.isInteger(v) && v >= 0 && v < PALETTE[slot].length;

export function cleanLook(x, base = DEFAULT_LOOK) {
  const src = x && typeof x === 'object' && !Array.isArray(x) ? x : {};
  const out = {};
  for (const s of SLOTS) out[s] = okIndex(s, src[s]) ? src[s] : base[s];
  out.hat = typeof src.hat === 'string' && HAT_IDS.includes(src.hat) ? src.hat : base.hat;
  return Object.freeze(out);
}

export function lookColors(look) {
  const l = cleanLook(look);
  return { shirt: PALETTE.shirt[l.shirt][2], trousers: PALETTE.trousers[l.trousers][2], skin: PALETTE.skin[l.skin][2], hair: PALETTE.hair[l.hair][2] };
}

export function lookKey(look) {
  const l = cleanLook(look);
  return [l.shirt, l.trousers, l.skin, l.hair, l.hat].join('.');
}

export function hatAvailable(id, unlocked) {
  const h = HATS.find(x => x.id === id);
  if (!h) return false;
  return h.unlock === null || !!(unlocked && unlocked.has && unlocked.has(id));
}

export function loadLook(storage = globalThis.localStorage) {
  const fallback = () => ({ look: DEFAULT_LOOK, unlocked: new Set() });
  try {
    const raw = storage?.getItem(LOOK_KEY);
    if (typeof raw !== 'string' || !raw) return fallback();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fallback();
    const unlocked = new Set();
    if (Array.isArray(data.unlocked)) for (const id of data.unlocked) {
      if (unlocked.size >= 16) break;
      if (typeof id === 'string' && HAT_IDS.includes(id)) unlocked.add(id);
    }
    let look = cleanLook(data);
    if (!hatAvailable(look.hat, unlocked)) look = Object.freeze({ ...look, hat: 'straw' });
    return { look, unlocked };
  } catch { return fallback(); }
}

export function saveLook(look, unlocked, storage = globalThis.localStorage) {
  try {
    const l = cleanLook(look);
    const u = [...(unlocked || [])].filter(id => HAT_IDS.includes(id)).slice(0, 16);
    storage.setItem(LOOK_KEY, JSON.stringify({ v: 1, ...l, unlocked: u }));
    return true;
  } catch { return false; }
}

export function noteAchievements(unlocked, ids) {
  const got = new Set(Array.isArray(ids) ? ids : []), fresh = [];
  for (const h of HATS) if (h.unlock && got.has(h.unlock) && !unlocked.has(h.id)) { unlocked.add(h.id); fresh.push(h.id); }
  return fresh;
}
