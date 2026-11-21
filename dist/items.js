// Little Raft item catalogue: the single source of truth for every item, its
// recipe, how it unlocks, and the friendly economy numbers.
// Pure ES module: no imports, no DOM, no THREE, no timers. Everything exported is frozen.
//
// ---------------------------------------------------------------------------
// Schema of one ITEMS entry
// ---------------------------------------------------------------------------
// {
//   id:        string, same as the key and the Bag kind (saves contain these ids)
//   name:      display name
//   category:  'material' | 'refined' | 'tool' | 'station' | 'build' | 'food' | 'decor'
//   stack:     max stack size (tools 1)
//   icon:      symbol id in dist/icons.svg (legacy kinds) or 'icon-<kind>' (new kinds,
//              drawn by dist/item-svg.js ITEM_ICONS; those entries have placeholder:true)
//   iconTint:  optional css colour hint for placeholder art
//   placeholder: true when the icon is not a dedicated icons.svg symbol
//   tool:      true only for durability items (Bag keeps durability 0..100 percent)
//   durability: tools only: number of uses from 100% to 0% (wear per use = 100 / uses)
//   actsAs:    optional tool role ('hook' | 'fishingrod' | 'hammer' | 'spear'); see toolRole()
//   placeable: true when the item is put on a raft tile as a decor/station
//   recipe:    null (gathered) | {
//                cost:   {kind: n}  (station recipes have exactly one cost key = input)
//                count:  output amount per craft / per smelted input
//                station: null (hand craft) | 'smelter' | 'grill' | 'purifier'
//                time:   seconds per item (station only)
//                fuel:   fuel units per item (station only; see FUEL_VALUE)
//              }
//   unlock:    {type:'start'}                         known from the beginning
//            | {type:'discover', items:[kinds]}       once the player has ever held all of them
//            | {type:'research', items:[kinds]}       research each kind at the Research Table
//                                                     (researching never consumes the item)
//            | {type:'station', station:id}           once that station has been placed
//   tip:       one or two friendly sentences (tooltips)
// }
//
// Economy reference (game.js): 30 floating items drift past at .22 m/s (~3 min per
// item lane), SPAWN_TABLE is 3 wood : 3 plastic : 3 leaf : 1 scrap : 1 barrel.
// An attentive player hooks ~4-5 items/min, i.e. ~0.5 barrels/min (hook + nets; see
// docs/cloud/progression-sim.md). New raw materials only come from barrels, so BARREL_LOOT
// plus BARREL_PITY is tuned for ~43 barrels -> smelter (~66 min) and ~48 -> metal hook.

const STACK = 20;
const SLOT_COUNT = 28;   // mirrors inventory-state.js
const HOTBAR_SIZE = 8;   // mirrors inventory-state.js
const MAX_DURABILITY = 100;

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
};

const START = { type: 'start' };
const discover = (...items) => ({ type: 'discover', items });
const research = (...items) => ({ type: 'research', items });
const atStation = (station) => ({ type: 'station', station });
const hand = (cost, count = 1) => ({ cost, count, station: null });
const cook = (station, input, { count = 1, time, fuel }) => ({ cost: { [input]: 1 }, count, station, time, fuel });

function item(id, name, category, opts) {
  const {
    stack = STACK, icon = `icon-${id}`, placeholder = !opts.icon, iconTint, tool = false,
    durability, actsAs, placeable = false, recipe = null, unlock = START, tip,
  } = opts;
  const e = { id, name, category, stack: tool ? 1 : stack, icon, placeholder, tool, placeable, recipe, unlock, tip };
  if (iconTint) e.iconTint = iconTint;
  if (tool) e.durability = durability;
  if (actsAs) e.actsAs = actsAs;
  return e;
}

// ---------------------------------------------------------------------------
// Catalogue (order = display order: materials, refined, tools, food, build, stations)
// ---------------------------------------------------------------------------
const LIST = [
  // ----- raw materials (floating debris + barrels) -----
  item('wood', 'Plank', 'material', { icon: 'icon-wood', placeholder: false,
    tip: 'Sturdy driftwood planks: the backbone of every raft. They also make great fuel.' }),
  item('leaf', 'Palm Leaf', 'material', { icon: 'icon-leaf', placeholder: false,
    tip: 'Soft green palm fronds. Twist two together for rope, or toss one on a fire.' }),
  item('plastic', 'Plastic', 'material', { icon: 'icon-scrap', placeholder: true, iconTint: '#7cc4e0',
    tip: 'A bobbing bit of plastic. Tidy the ocean and turn it into hooks and floors!' }),
  item('scrap', 'Scrap', 'material', { icon: 'icon-scrap', placeholder: false,
    tip: 'Rusty little metal bits. Handy for nails, lanterns and fixing your hook.' }),
  item('sand', 'Sand', 'material', { iconTint: '#e8d39a', unlock: START,
    tip: 'A pouch of fine beach sand from a barrel. The smelter melts it into glass.' }),
  item('clay', 'Clay', 'material', { iconTint: '#c07a52',
    tip: 'Squishy river clay. Fire it on the grill to make bricks.' }),
  item('stone', 'Stone', 'material', { iconTint: '#9aa3a8',
    tip: 'A smooth, heavy pebble. A few of these hold a smelter together.' }),
  item('copperore', 'Copper Ore', 'material', { iconTint: '#d98a4e',
    tip: 'A rock with shiny orange streaks. Smelt it into a copper ingot.' }),
  item('metalore', 'Metal Ore', 'material', { iconTint: '#8d96a3',
    tip: 'A chunky grey rock full of metal. The smelter turns it into ingots.' }),
  item('seaweed', 'Seaweed', 'material', { iconTint: '#4f9a5c',
    tip: 'Slippery seaweed tangled in a barrel. Dried out, it burns slow and gentle as fuel.' }),
  // [bees] flower seed (bushes, barrels), honey and beeswax (beehive harvest), see dist/bees.js
  item('flowerseed', 'Flower Seed', 'material', { iconTint: '#ff7aa2',
    tip: 'A tiny seed from an island bush. Plant it in a flower box.' }),
  item('honey', 'Honey', 'material', { iconTint: '#f2b134',
    tip: 'Sweet, golden and sticky.' }),
  item('wax', 'Beeswax', 'material', { iconTint: '#f3e2a4',
    tip: 'Soft beeswax from the comb. Good for candles.' }),
  item('fish', 'Fish', 'food', { icon: 'icon-fish', placeholder: false,
    tip: 'A shiny catch from your fishing rod. Edible raw, but salty: grill it to fill up properly.' }),
  item('sharkmeat', 'Raw Shark Meat', 'food', { iconTint: '#d97a7a',
    tip: 'A thick slab cut from a shark you fought off for good. Four come from every shark.' }),
  item('sharkhead', 'Shark Head', 'material', { iconTint: '#7f8f99', stack: 5,
    tip: 'A grim trophy from a beaten shark. Proof that your raft bites back.' }),

  // ----- refined (hand crafted or station) -----
  item('rope', 'Rope', 'refined', { icon: 'icon-net', placeholder: true, iconTint: '#d9c38c',
    recipe: hand({ leaf: 2 }), unlock: START,
    tip: 'Two palm leaves twisted into rope. You will want lots of this.' }),
  item('nail', 'Nail', 'refined', { iconTint: '#b7bcc2',
    recipe: hand({ scrap: 2 }, 3), unlock: discover('scrap'),
    tip: 'Hammered from scrap, three at a time. Nets and tables need a few.' }),
  item('brick', 'Brick', 'refined', { iconTint: '#b5533c',
    recipe: cook('grill', 'clay', { time: 20, fuel: 0.5 }), unlock: atStation('grill'),
    tip: 'Clay fired on the grill until it is warm and solid. Stack them into a smelter.' }),
  item('metalingot', 'Metal Ingot', 'refined', { iconTint: '#a9b4c2',
    recipe: cook('smelter', 'metalore', { time: 30, fuel: 1 }), unlock: atStation('smelter'),
    tip: 'A gleaming bar of metal, fresh from the smelter. Bolts, hinges and better hooks await.' }),
  item('copperingot', 'Copper Ingot', 'refined', { iconTint: '#d98a4e',
    recipe: cook('smelter', 'copperore', { time: 30, fuel: 1 }), unlock: atStation('smelter'),
    tip: 'A warm orange copper bar. Perfect for fine gadgets like binoculars.' }),
  item('glass', 'Glass', 'refined', { iconTint: '#bfe6ef',
    recipe: cook('smelter', 'sand', { time: 25, fuel: 1 }), unlock: atStation('smelter'),
    tip: 'Sand melted into a clear little pane. Look through it and the sea sparkles.' }),
  item('bolt', 'Bolt', 'refined', { iconTint: '#8d96a3',
    recipe: hand({ metalingot: 1, scrap: 1 }, 2), unlock: research('metalingot'),
    tip: 'Two sturdy bolts from one ingot. They hold the fancy stuff together.' }),
  item('hinge', 'Hinge', 'refined', { iconTint: '#c3c9d1',
    recipe: hand({ metalingot: 1, nail: 2 }, 2), unlock: research('metalingot', 'nail'),
    tip: 'A tiny hinge that swings just right. Binoculars fold up thanks to these.' }),

  // ----- tools -----
  item('hook', 'Hook', 'tool', { icon: 'icon-hook', placeholder: false, tool: true, durability: 50,
    recipe: hand({ wood: 1, plastic: 2 }), unlock: START,
    tip: 'Throw it, reel it, grab the goodies. Gets tired after about 50 catches; R fixes it up.' }),
  item('metalhook', 'Metal Hook', 'tool', { icon: 'icon-hook', placeholder: true, iconTint: '#a9b4c2',
    tool: true, durability: 150, actsAs: 'hook',
    recipe: hand({ metalingot: 6, bolt: 2, rope: 2, wood: 2 }), unlock: research('metalingot', 'bolt'),
    tip: 'A shiny metal hook that lasts three times longer. Your arm will thank you.' }),
  item('hammer', 'Hammer', 'tool', { icon: 'icon-hammer', placeholder: false, tool: true, durability: 120,
    recipe: hand({ wood: 4, rope: 2 }), unlock: START,
    tip: 'Builds new floor tiles (2 planks + 2 plastic each). Make room for friends!' }),
  item('fishingrod', 'Fishing Rod', 'tool', { icon: 'icon-hook', placeholder: true, iconTint: '#c69860',
    tool: true, durability: 40,
    recipe: hand({ wood: 6, rope: 8 }), unlock: discover('rope'),
    tip: 'Cast, wait for a nibble, and reel in a fish. Good for about 40 catches between repairs.' }),
  item('spear', 'Wooden Spear', 'tool', { iconTint: '#bb8650', tool: true, durability: 20,
    recipe: hand({ wood: 8, rope: 3 }), unlock: discover('rope'),
    tip: 'A long pole with a sharp lashed tip. Click to jab at things in the water; wears only when it lands.' }),
  item('metalspear', 'Metal Spear', 'tool', { iconTint: '#9fb1bf', tool: true, durability: 40, actsAs: 'spear',
    recipe: hand({ wood: 6, rope: 2, metalingot: 2, bolt: 1 }), unlock: research('metalingot', 'bolt'),
    tip: 'A heavy metal point on a sturdy shaft. Twice the bite of the wooden one and lasts twice as long.' }),
  item('binoculars', 'Binoculars', 'tool', { iconTint: '#5d6b78', stack: 1,
    recipe: hand({ glass: 2, copperingot: 1, hinge: 2, bolt: 1 }), unlock: research('glass', 'copperingot'),
    tip: 'Hold them to spot the nearest barrel: bearing and distance. They never wear out.' }),
  // [instruments] held instruments (dist/instruments.js): no durability, no world state
  item('drum', 'Tide Drum', 'tool', { iconTint: '#b0805a', stack: 1, recipe: hand({ wood: 3, leaf: 2, rope: 1 }), unlock: discover('rope'),
    tip: 'A palm-leaf hand drum. Click to thump; look up or down to change the note.' }),
  item('pipes', 'Reed Pipes', 'tool', { iconTint: '#8fc3c9', stack: 1, recipe: hand({ plastic: 3, rope: 1 }), unlock: discover('rope', 'plastic'),
    tip: 'Breathy little tubes tied in a row. Look up for high notes, down for low ones.' }),
  item('bells', 'Bell Bars', 'tool', { iconTint: '#c9b26a', stack: 1, recipe: hand({ wood: 2, scrap: 3, nail: 2 }), unlock: research('nail'),
    tip: 'Scrap-metal bars on a little frame. They ring bright and fade out softly.' }),

  // ----- food -----
  item('cookedfish', 'Grilled Fish', 'food', { iconTint: '#e0a060', stack: 10,
    recipe: cook('grill', 'fish', { time: 15, fuel: 0.5 }), unlock: atStation('grill'),
    tip: 'A cosy, smoky meal. Click with it in hand to eat (+35 food).' }),
  item('honeyfish', 'Honey Glazed Fish', 'food', { iconTint: '#e8a83a', stack: 10, // [bees]
    recipe: hand({ cookedfish: 1, honey: 1 }), unlock: discover('honey'),
    tip: 'Grilled fish with a honey glaze. The seagull is very jealous.' }),
  item('cookedsharkmeat', 'Grilled Shark Meat', 'food', { iconTint: '#c7764a', stack: 10,
    recipe: cook('grill', 'sharkmeat', { time: 20, fuel: 0.5 }), unlock: atStation('grill'),
    tip: 'A thick, smoky steak. Click with it in hand to eat (+30 food).' }),

  // ----- build / decor (placeable on raft tiles) -----
  item('bench', 'Bench', 'decor', { icon: 'icon-repair', placeholder: true, placeable: true,
    recipe: hand({ wood: 3 }), unlock: START,
    tip: 'A comfy spot to sit and watch the waves roll by.' }),
  item('palm', 'Palm Planter', 'decor', { icon: 'icon-palm', placeholder: false, placeable: true,
    recipe: hand({ wood: 2, leaf: 3 }), unlock: START,
    tip: 'A little potted palm. Every raft deserves some green.' }),
  // [bees] flower box, beehive and beeswax candle (models in dist/bees-model.js)
  item('flowerbox', 'Flower Box', 'decor', { placeable: true, iconTint: '#ff7aa2',
    recipe: hand({ wood: 2, flowerseed: 1 }), unlock: discover('flowerseed'),
    tip: 'A box of bright blooms. Bees love it.' }),
  item('beehive', 'Beehive', 'decor', { placeable: true, iconTint: '#d9a441',
    recipe: hand({ wood: 4, rope: 2, leaf: 2 }), unlock: discover('flowerseed'),
    tip: 'A cosy hive. Put flower boxes close by and the bees make honeycomb.' }),
  item('candle', 'Beeswax Candle', 'decor', { placeable: true, iconTint: '#ffd27a',
    recipe: hand({ wax: 2, rope: 1 }), unlock: discover('wax'),
    tip: 'A little jar candle that glows warmly at night.' }),
  item('sail', 'Sail', 'build', { icon: 'icon-sail', placeholder: false, placeable: true,
    recipe: hand({ wood: 4, rope: 3, leaf: 3 }), unlock: discover('rope', 'plastic'),
    tip: 'Catch the breeze and look the part of a proper sea captain.' }),
  item('lantern', 'Lantern', 'decor', { icon: 'icon-lantern', placeholder: false, placeable: true,
    recipe: hand({ wood: 2, scrap: 2 }), unlock: discover('scrap'),
    tip: 'A warm glow for quiet evenings on the water.' }),
  item('crate', 'Crate', 'build', { icon: 'icon-barrel', placeholder: true, placeable: true,
    recipe: hand({ wood: 4, scrap: 1 }), unlock: discover('scrap'),
    tip: 'A sturdy wooden crate. Looks great stacked by the edge.' }),
  item('net', 'Collection Net', 'build', { icon: 'icon-net', placeholder: false, placeable: true,
    recipe: hand({ wood: 3, rope: 3, nail: 2 }), unlock: discover('nail'),
    tip: 'Place it near the edge and it scoops up passing debris (even barrels!) for you.' }),

  // ----- stations -----
  item('researchtable', 'Research Table', 'station', { iconTint: '#c69860', stack: 5, placeable: true,
    recipe: hand({ wood: 10, nail: 4, rope: 2 }), unlock: discover('nail'),
    tip: 'Show it something new and learn what you can make. Your items stay safe in your bag.' }),
  item('grill', 'Simple Grill', 'station', { iconTint: '#6b5a4c', stack: 5, placeable: true,
    recipe: hand({ wood: 6, scrap: 1, rope: 3 }), unlock: discover('fish'),
    tip: 'Grills fish into snacks and fires clay into bricks. Feed it planks or leaves.' }),
  item('smelter', 'Smelter', 'station', { iconTint: '#b5533c', stack: 5, placeable: true,
    recipe: hand({ wood: 6, brick: 10, stone: 7, nail: 6 }), unlock: research('clay', 'stone'),
    tip: 'A toasty brick furnace. Melts ore into ingots and sand into glass, one at a time.' }),
];

export const ITEMS = deepFreeze(Object.fromEntries(LIST.map((e) => [e.id, e])));
export const ITEM_IDS = Object.freeze(LIST.map((e) => e.id));
export const TOOL_IDS = Object.freeze(ITEM_IDS.filter((id) => ITEMS[id].tool));
export const STATION_IDS = Object.freeze(ITEM_IDS.filter((id) => ITEMS[id].category === 'station'));
export const PLACEABLE_IDS = Object.freeze(ITEM_IDS.filter((id) => ITEMS[id].placeable));

/** Collision radius (metres) of each placed item; 0 = walk-through (net lies flat). */
export const BLOCK_RADII = deepFreeze({
  palm: 0.42, crate: 0.55, bench: 0.45, sail: 0.14, lantern: 0.12, net: 0,
  smelter: 0.5, researchtable: 0.55, grill: 0.45,
  flowerbox: 0.3, beehive: 0.35, candle: 0.1, // [bees]
});

/** Damage one landed spear thrust deals (spear lane; see docs/loop/research/fidelity-r1-shark.md). */
export const SPEAR_DAMAGE = deepFreeze({ spear: 5, metalspear: 10 });

/** Fuel units per item put into a station. Plastic is never burned (friendly seas). */
export const FUEL_VALUE = deepFreeze({ wood: 1, leaf: 0.5, seaweed: 0.5 });

/** Repair costs (restore a tool to 100%). Hook keeps the legacy 2 wood + 1 scrap. */
const REPAIRS = deepFreeze({
  hook: { wood: 2, scrap: 1 },
  metalhook: { scrap: 2, nail: 2 },
  hammer: { wood: 2, rope: 1 },
  fishingrod: { wood: 1, rope: 2 },
  spear: { wood: 2, rope: 1 },
  metalspear: { metalingot: 1, rope: 1 },
});

/** Alternate / older names that may appear in saves or network messages. */
export const LEGACY_ALIASES = deepFreeze({
  plank: 'wood', planks: 'wood', driftwood: 'wood',
  palmleaf: 'leaf', palm_leaf: 'leaf', leaves: 'leaf',
  plasticjug: 'plastic', jug: 'plastic',
  scrapmetal: 'scrap', metal_scrap: 'scrap',
  rod: 'fishingrod', fishing_rod: 'fishingrod',
  plastichook: 'hook', plastic_hook: 'hook',
  scraphook: 'metalhook', scrap_hook: 'metalhook', metal_hook: 'metalhook',
  rawfish: 'fish', raw_fish: 'fish',
  cooked_fish: 'cookedfish', grilledfish: 'cookedfish', grilled_fish: 'cookedfish',
  nails: 'nail', bolts: 'bolt', hinges: 'hinge',
  ingot: 'metalingot', metal_ingot: 'metalingot', copper_ingot: 'copperingot',
  metal_ore: 'metalore', ore: 'metalore', copper_ore: 'copperore', copper: 'copperore',
  drybrick: 'brick', dry_brick: 'brick', bricks: 'brick',
  research_table: 'researchtable', 'research-table': 'researchtable',
  simplegrill: 'grill', simple_grill: 'grill', furnace: 'smelter',
  collectionnet: 'net', collection_net: 'net', planter: 'palm',
});

/**
 * Target timeline (minutes of play) the simulator compares against.
 * `ids` lists the items whose first craft/place marks the goal.
 */
export const PROGRESSION_PLAN = deepFreeze([
  { minute: 0, goal: 'Hook the first planks, leaves and plastic', ids: ['hook'] },
  { minute: 2, goal: 'Twist rope from palm leaves', ids: ['rope'] },
  { minute: 4, goal: 'Craft a hammer and add the first floor tiles', ids: ['hammer'] },
  { minute: 6, goal: 'A bench and a palm planter make it home', ids: ['bench', 'palm'] },
  { minute: 8, goal: 'Turn scrap into nails; lantern and crate unlock', ids: ['nail'] },
  { minute: 12, goal: 'Craft a fishing rod and catch a fish', ids: ['fishingrod'] },
  { minute: 16, goal: 'Raise a sail', ids: ['sail'] },
  { minute: 20, goal: 'Build the Research Table', ids: ['researchtable'] },
  { minute: 24, goal: 'Place a grill and grill a fish for the seagull', ids: ['grill', 'cookedfish'] },
  { minute: 27, goal: 'Put out collection nets to catch more barrels', ids: ['net'] },
  { minute: 30, goal: 'Find clay and stone in barrels; fire the first bricks', ids: ['brick'] },
  { minute: 35, goal: 'Research clay and stone to learn the smelter', ids: [] },
  { minute: 70, goal: 'Build and fuel the smelter', ids: ['smelter'] },
  { minute: 72, goal: 'Smelt the first metal ingot', ids: ['metalingot'] },
  { minute: 75, goal: 'Research the ingot; craft bolts and hinges', ids: ['bolt', 'hinge'] },
  { minute: 85, goal: 'Craft the Metal Hook (3x longer lasting)', ids: ['metalhook'] },
  { minute: 100, goal: 'Melt sand into glass and smelt copper', ids: ['glass', 'copperingot'] },
  { minute: 110, goal: 'Craft binoculars and go barrel spotting', ids: ['binoculars'] },
  { minute: 120, goal: 'A cosy, well-equipped raft', ids: [] },
]);

/**
 * Barrel loot: BARREL_ROLLS.basic picks from the 'basic' pool (min..max each)
 * plus BARREL_ROLLS.treasure picks from the 'treasure' pool (always 1 of the
 * kind, so mid-game materials trickle in steadily with low variance).
 * Picks of the same kind add up. Plain weighted odds per barrel (treasure total 102): ~5.3
 * basics plus clay .18, stone .12, metal ore .10, sand .12, seaweed .08 (x1.5), copper ore
 * .06, flower seed .06, scrap .29. With the caller's luck state (BARREL_PITY) the mid-game kinds come at
 * least every 5-13 barrels (a few more when two are overdue at once), so the real rates are
 * clay .24, stone .19, metal ore .18, sand .14, copper ore .09, seaweed .05 (x1.5).
 */
export const BARREL_ROLLS = deepFreeze({ basic: 3, treasure: 1 });
export const BARREL_LOOT = deepFreeze([
  { kind: 'wood', min: 2, max: 3, weight: 30, pool: 'basic' },
  { kind: 'leaf', min: 1, max: 3, weight: 22, pool: 'basic' },
  { kind: 'plastic', min: 1, max: 2, weight: 22, pool: 'basic' },
  { kind: 'scrap', min: 1, max: 2, weight: 16, pool: 'basic' },
  { kind: 'clay', min: 1, max: 1, weight: 18, pool: 'treasure' },
  { kind: 'stone', min: 1, max: 1, weight: 12, pool: 'treasure' },
  { kind: 'metalore', min: 1, max: 1, weight: 10, pool: 'treasure' },
  { kind: 'sand', min: 1, max: 1, weight: 12, pool: 'treasure' },
  { kind: 'seaweed', min: 1, max: 2, weight: 8, pool: 'treasure' },
  { kind: 'copperore', min: 1, max: 1, weight: 6, pool: 'treasure' },
  { kind: 'flowerseed', min: 1, max: 1, weight: 6, pool: 'treasure' }, // [bees]
  { kind: 'scrap', min: 1, max: 1, weight: 30, pool: 'treasure' },
]);
const POOLS = Object.freeze(Object.fromEntries(['basic', 'treasure'].map((p) => {
  const rows = BARREL_LOOT.filter((e) => e.pool === p);
  return [p, Object.freeze({ rows, total: rows.reduce((s, e) => s + e.weight, 0) })];
})));

const hasOwn = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const unit = (rand) => {
  const r = Number(typeof rand === 'function' ? rand() : Math.random());
  return Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999999) : 0;
};

function pickFrom(pool, rand, out) {
  let pick = unit(rand) * pool.total, e = pool.rows[pool.rows.length - 1];
  for (const c of pool.rows) { if (pick < c.weight) { e = c; break; } pick -= c.weight; }
  out[e.kind] = (out[e.kind] || 0) + e.min + Math.floor(unit(rand) * (e.max - e.min + 1));
}

/**
 * Bad-luck protection for the treasure pick: after BARREL_PITY[kind] barrels in a row
 * without `kind`, the next treasure pick is that kind. Kinds not listed are never forced.
 */
export const BARREL_PITY = deepFreeze({ clay: 4, stone: 5, metalore: 5, sand: 8, copperore: 12 });
const PITY_KINDS = Object.keys(BARREL_PITY);
const TREASURE_ROW = Object.freeze(Object.fromEntries(POOLS.treasure.rows.map((e) => [e.kind, e])));

// The luck state's miss counters (created/sanitised in place), or null when luck is unusable.
function luckMisses(luck) {
  if (!luck || typeof luck !== 'object' || Object.isFrozen(luck)) return null;
  let m = luck.misses;
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.isFrozen(m)) { m = {}; try { luck.misses = m; } catch { return null; } }
  for (const k of PITY_KINDS) { const n = num(m[k]); m[k] = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1e6) : 0; }
  return m;
}

/**
 * Loot for one opened barrel, as {kind: n}. Deterministic for a given rand (and luck state).
 * luck: optional plain mutable object {misses: {kind: n}} owned by the caller (one per world).
 * Each roll counts, per BARREL_PITY kind, the barrels in a row that did not give it; when a
 * count reaches its limit the treasure pick is forced to that kind (the most overdue one first).
 * The only side effect is updating luck.misses; luck = null keeps the plain weighted roll.
 */
export function rollBarrel(rand = Math.random, luck = null) {
  const out = {};
  const misses = luckMisses(luck);
  for (let i = 0; i < BARREL_ROLLS.basic; i++) pickFrom(POOLS.basic, rand, out);
  for (let i = 0; i < BARREL_ROLLS.treasure; i++) {
    let forced = null, worst = 1;
    if (misses) for (const k of PITY_KINDS) { const due = misses[k] / BARREL_PITY[k]; if (due >= worst && (!forced || due > worst)) { forced = k; worst = due; } }
    if (forced) { const e = TREASURE_ROW[forced]; out[forced] = (out[forced] || 0) + e.min + Math.floor(unit(rand) * (e.max - e.min + 1)); }
    else pickFrom(POOLS.treasure, rand, out);
  }
  if (misses) for (const k of PITY_KINDS) misses[k] = out[k] > 0 ? 0 : misses[k] + 1;
  return out;
}

export function isItem(kind) { return typeof kind === 'string' && hasOwn(ITEMS, kind); }

/** Repair cost {kind:n} for a tool, or null when the item cannot be repaired. */
export function repairCost(kind) { return hasOwn(REPAIRS, kind) ? REPAIRS[kind] : null; }

/** Percent of durability (0..100 scale) one use removes; 0 for non-tools. */
export function wearPerUse(kind) {
  const it = isItem(kind) ? ITEMS[kind] : null;
  return it && it.tool && it.durability > 0 ? MAX_DURABILITY / it.durability : 0;
}

/** Gameplay role of a held item: metalhook -> 'hook'; otherwise the kind itself. */
export function toolRole(kind) {
  return isItem(kind) ? (ITEMS[kind].actsAs ?? kind) : kind;
}

/** Fuel units one item of `kind` gives a station (0 = not a fuel). */
export function fuelValue(kind) { return hasOwn(FUEL_VALUE, kind) ? FUEL_VALUE[kind] : 0; }

/** The station recipe (ITEMS entry) whose single input is `inputKind`, or null. */
export function stationRecipeFor(stationId, inputKind) {
  for (const id of ITEM_IDS) {
    const r = ITEMS[id].recipe;
    if (r && r.station === stationId && hasOwn(r.cost, inputKind)) return ITEMS[id];
  }
  return null;
}

/** ITEM_INFO-shaped table for every item (inventory-state.js / survival-ui.js). */
export function infoTable() {
  const out = {};
  for (const id of ITEM_IDS) {
    const it = ITEMS[id];
    const row = { kind: id, name: it.name, icon: it.icon, maxStack: it.stack, tool: it.tool, placeholder: it.placeholder };
    if (it.tool) row.maxDurability = MAX_DURABILITY;
    out[id] = Object.freeze(row);
  }
  return Object.freeze(out);
}

/** RECIPES-shaped table for every hand-craftable item (station == null). */
export function recipeTable() {
  const out = {};
  for (const id of ITEM_IDS) {
    const r = ITEMS[id].recipe;
    if (!r || r.station !== null) continue;
    out[id] = Object.freeze({
      id, name: ITEMS[id].name,
      output: Object.freeze({ kind: id, count: r.count }),
      cost: Object.freeze({ ...r.cost }),
    });
  }
  return Object.freeze(out);
}

// Number() that never throws (Symbols, objects with throwing valueOf, ...): junk -> NaN.
function num(v) {
  if (typeof v === 'number') return v;
  try { return Number(v); } catch { return NaN; }
}

function toCount(v) {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER) : 0;
}

// Bag kinds owned by other lanes (watering, signal, farming...) that live in ITEM_INFO but not in ITEMS.
// inventory-state.js registers them so save/load and co-op snapshots keep them instead of dropping them.
const EXTRA_KINDS = new Map();
export function registerBagKinds(info) {
  for (const [id, e] of Object.entries(info || {})) {
    if (hasOwn(ITEMS, id) || !e || typeof e !== 'object') continue;
    const stack = Math.max(1, Math.floor(num(e.maxStack)) || 1);
    EXTRA_KINDS.set(id, Object.freeze({ id, stack, tool: !!e.tool }));
  }
}
const known = (k) => isItem(k) || EXTRA_KINDS.has(k);

function resolveKind(kind) {
  if (typeof kind !== 'string') return null;
  if (known(kind)) return kind;
  const k = kind.trim().toLowerCase();
  if (known(k)) return k;
  return hasOwn(LEGACY_ALIASES, k) ? LEGACY_ALIASES[k] : null;
}

/**
 * Turn any older/foreign bag snapshot into one `new Bag(snap)` accepts:
 * aliases mapped, unknown kinds dropped, counts clamped to the new stack sizes
 * (overflow tops up matching stacks, then free slots; whatever still does not
 * fit is dropped), tool durability filled/clamped to 0..100, non-tool
 * durability removed, duplicate ids removed, `selected` kept when valid.
 * Non-object input returns null (new Bag(null) = fresh starter bag).
 * `extraStack(kind)` (optional) keeps non-catalogue kinds the engine still knows (cups, purifier…):
 * it returns their max stack (> 0) or 0/undefined to drop them.
 */
export function migrateSnapshot(snap, extraStack = null) {
  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return null;
  const src = Array.isArray(snap.slots) ? snap.slots : [];
  const slots = new Array(SLOT_COUNT).fill(null);
  const overflow = [];
  const ids = new Set();
  const extra = (k) => { if (typeof extraStack !== 'function' || typeof k !== 'string' || !k) return 0; let n; try { n = Math.floor(num(extraStack(k))); } catch { return 0; } return Number.isFinite(n) && n > 0 ? n : 0; };
  const stackOf = (k) => (isItem(k) ? ITEMS[k].stack : EXTRA_KINDS.has(k) ? EXTRA_KINDS.get(k).stack : extra(k));
  const durOf = (raw) => {
    const d = num(raw);
    return raw === undefined || raw === null || !Number.isFinite(d) ? MAX_DURABILITY : Math.min(MAX_DURABILITY, Math.max(0, d));
  };
  for (let i = 0; i < src.length; i++) {
    const raw = src[i];
    if (!raw || typeof raw !== 'object') continue;
    const kind = resolveKind(raw.kind) ?? (extra(raw.kind) ? raw.kind : null);
    let count = toCount(raw.count);
    if (!kind || count === 0) continue;
    const base = { kind };
    if (isItem(kind) ? ITEMS[kind].tool : EXTRA_KINDS.get(kind)?.tool) base.durability = durOf(raw.durability);
    if (typeof raw.id === 'string' && raw.id && !ids.has(raw.id)) { ids.add(raw.id); base.id = raw.id; }
    const put = Math.min(count, stackOf(kind));
    if (i < SLOT_COUNT) slots[i] = { ...base, count: put };
    else overflow.push({ ...base, count: put });
    count -= put;
    if (count > 0) {
      const { id: _drop, ...rest } = base;
      overflow.push({ ...rest, count });
    }
  }
  for (const o of overflow) {
    const max = stackOf(o.kind);
    let left = o.count;
    if (max > 1) {
      for (const s of slots) {
        if (left === 0) break;
        if (s && s.kind === o.kind && s.count < max) { const put = Math.min(max - s.count, left); s.count += put; left -= put; }
      }
    }
    let first = true;
    for (let i = 0; i < SLOT_COUNT && left > 0; i++) {
      if (slots[i]) continue;
      const put = Math.min(max, left);
      const s = { kind: o.kind, count: put };
      if (o.durability !== undefined) s.durability = o.durability;
      if (first && o.id !== undefined) s.id = o.id;
      first = false;
      slots[i] = s;
      left -= put;
    }
    // left > 0 here: bag is full, excess is dropped.
  }
  const sel = snap.selected;
  const selected = Number.isInteger(sel) && sel >= 0 && sel < HOTBAR_SIZE ? sel : 0;
  return { slots, selected };
}
