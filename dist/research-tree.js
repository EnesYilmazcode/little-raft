// The one research tree (Raft's Research Table model): which recipes are known from the start, which
// need research, and which retired recipes are no longer offered.
// Pure data + one catalogue builder. No DOM, no THREE.
//
// How research works (progression.js + progression-hooks.js):
//   - Place a Research Table, hold a material, press Research: one of it is used up and that material
//     counts as researched for good.
//   - A blueprint is learned as soon as every material in its research set has been researched.
//   - items.js keeps the unlock of its own entries (field `unlock`); this file holds the unlocks of the
//     recipes that live outside items.js (content-items.js and inventory-state.js) and the retired list.
//
// The research set of a recipe is its cost materials, as in Raft, unless SET_OVERRIDES says otherwise
// (sources: docs/loop/raft-progression.md, tags [S]).
import { ITEMS } from './items.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_INFO, RECIPES } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';

const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const START = Object.freeze({ type: 'start' });
const research = (...items) => Object.freeze({ type: 'research', items: Object.freeze(items) });
const RETIRED = Object.freeze({ type: 'retired' });

// The old content research station ('research', the Tinker's Desk) is now just another Research Table:
// a placed desk counts as one, and desk items in a bag load as Research Tables (items.js LOAD_RENAMES).
export const TABLE = 'researchtable';
export const TABLE_ALIASES = Object.freeze(['research']);
export const isTable = (type) => type === TABLE || TABLE_ALIASES.includes(type);

// Recipes outside items.js that everyone knows from minute one (water: Raft's Empty Cup and Simple Purifier).
const START_EXTRA = Object.freeze(['cup', 'purifier']);

// Research sets that differ from "every cost material" (Raft research sets, adapted to our materials).
// Receiver and antenna keep their inventory-state.js costs, but are navigation gear: like Raft's
// circuit-board items they wait for copper and metal parts.
const SET_OVERRIDES = Object.freeze({
  receiver: research('plastic', 'hinge', 'copperingot'),
  antenna: research('scrap', 'bolt', 'copperingot'),
});

// Recipes with no Raft equivalent, or a duplicate of a real one. Their items still load from saves and
// placed ones still work and render; only the recipe is gone from the craft list and the host refuses it.
export const RETIRED_RECIPES = Object.freeze([
  'research', // Tinker's Desk: merged into the Research Table
  'kiln', 'glasslamp', 'sinker', // the smelter already does this
  'stormrod', 'stormlamp', 'stormglass',
  'pennant', 'chime', 'hammock', 'cushion',
  'brickplanter', 'egglamp', // alternate recipes for planters and lanterns
  'goggles', 'scraper',
  'coursekit', 'scoreboard', 'gametable', 'driftboard',
  'spyglass', 'camera', 'photoframe', 'maptable', 'taskboard',
  'honeyfish', 'candle', 'perch', 'fishtrap',
]);
const RETIRED_SET = new Set(RETIRED_RECIPES);
export const isRetired = (id) => RETIRED_SET.has(id);

// Blueprints the Research Table lists first while still locked: Raft's tier-1 goals, then the stage order
// (bricks and smelter, metal parts, navigation). Everything else follows, nearest first.
export const FEATURED = Object.freeze(['net', 'bed', 'sail', 'smelter', 'bolt', 'hinge', 'receiver', 'antenna', 'motor', 'wheel']);

const costSet = (cost) => research(...Object.keys(cost || {}));

/** Unlock rule for a recipe id that is not an items.js entry. */
export function extraUnlock(id) {
  if (RETIRED_SET.has(id)) return RETIRED;
  if (START_EXTRA.includes(id)) return START;
  if (hasOwn(SET_OVERRIDES, id)) return SET_OVERRIDES[id];
  if (id === 'shellwreath') return START; // island trading-post plan: trader.js keeps its own lock
  return costSet(RECIPES[id]?.cost);
}

// The catalogue Progression runs on: every items.js entry, plus every other bag kind and recipe
// (cups, purifier, bed, motor, paints, ...) in the same shape. Retired recipes get {type:'retired'}.
function buildCatalog() {
  const out = {};
  for (const [id, it] of Object.entries(ITEMS)) out[id] = RETIRED_SET.has(id) ? Object.freeze({ ...it, unlock: RETIRED }) : it;
  for (const [kind, info] of Object.entries(ITEM_INFO)) {
    if (hasOwn(out, kind)) continue;
    out[kind] = { id: kind, name: info.name, category: 'extra', recipe: null, unlock: START };
  }
  for (const [id, r] of Object.entries(RECIPES)) {
    if (hasOwn(ITEMS, id)) continue;
    const base = out[id] || { id, name: r.name, category: 'extra' };
    out[id] = { ...base, recipe: Object.freeze({ cost: r.cost, count: r.output.count, station: null }), unlock: extraUnlock(id) };
  }
  for (const k of Object.keys(out)) Object.freeze(out[k]);
  return Object.freeze(out);
}
export const CATALOG = buildCatalog();

/** Hand recipe ids a fresh game can craft (given the materials). */
export const startRecipes = () => Object.keys(RECIPES).filter((id) => CATALOG[id]?.unlock?.type === 'start');
