// Content-fleet item kinds and recipes (islands, storage/research).
// Pure data, no imports. inventory-state.js merges these into ITEM_INFO / RECIPES,
// and game.js adds CONTENT_DECOR to its placeable decor types.
// Old builds reject unknown kinds in a bag snapshot and start a fresh bag; new builds load old saves fine.

const S = 20; // STACK_SIZE (kept literal so this file stays import-free)
const item = (kind, name, icon, placeholder = true, max = S) => Object.freeze({ kind, name, icon, maxStack: max, tool: false, placeholder });

export const CONTENT_ITEMS = Object.freeze({
  sand:     item('sand',     'Sand',           'icon-scrap', true),
  stone:    item('stone',    'Stone',          'icon-scrap', true),
  seed:     item('seed',     'Palm Seed',      'icon-leaf',  true),
  // decor pack (decor-pack.js)
  rug:      item('rug',      'Woven Deck Mat',    'icon-leaf',    true),
  pennant:  item('pennant',  'Wind Pennant',      'icon-sail',    true),
  fern:     item('fern',     'Hanging Fern Post', 'icon-palm',    true),
  chime:    item('chime',    'Shell Chime',       'icon-lantern', true),
  hammock:  item('hammock',  'Rope Hammock',      'icon-net',     true),
  pots:     item('pots',     'Clay Pot Trio',     'icon-palm',    true),
  sign:     item('sign',     'Signboard',         'icon-repair',  true),
  // seaside kiln (kiln.js)
  kiln:      item('kiln',      'Seaside Kiln',  'icon-kiln',    false),
  glasslamp: item('glasslamp', 'Glass Lantern', 'icon-lantern', true),
  sinker:    item('sinker',    'Line Sinker',   'icon-ingot',   true),
  // friendly storms (storm.js): shards only come from a Lightning Rod
  stormshard: item('stormshard', 'Storm Shard',   'icon-stormshard', false),
  stormrod:   item('stormrod',   'Lightning Rod', 'icon-stormrod',   false),
  stormlamp:  item('stormlamp',  'Storm Lantern', 'icon-stormlamp',  false),
  stormglass: item('stormglass', 'Storm Glass',   'icon-stormglass', false),
  // raft animals (animals.js)
  puffegg:  item('puffegg', 'Puff Egg',        'icon-egg',     false),
  feather:  item('feather', 'Puff Feather',    'icon-feather', false),
  nestbox:  item('nestbox', 'Nest Box',        'icon-nest',    false),
  cushion:  item('cushion', 'Feather Cushion', 'icon-cushion', false),
  goatpen:  item('goatpen', 'Hay Corner',      'icon-hay',     false),
  bucket:   item('bucket',  'Wooden Pail',     'icon-pail',    false, 5),
  milk:     item('milk',    'Pail of Milk',    'icon-milk',    false, 5),
  research: item('research', 'Tinker\u2019s Desk', 'icon-research', false),
  motor:    item('motor',    'Little Motor',   'icon-motor',  false),
  wheel:    item('wheel',    'Steering Wheel', 'icon-wheel',  false),
  bed:      item('bed',      'Simple Bed',     'icon-bed',    false), // [bed] Raft's Simple Bed; same 'bed' kind, so old saves keep their beds
  // paint (dist/paint.js): the brush is not a TOOL_KIND (no durability), pots are plain stacks, not decor
  brush:         item('brush',         'Paint Brush',   'icon-brush',         false, 1),
  paint_seafoam: item('paint_seafoam', 'Seafoam Paint', 'icon-paint-seafoam', false),
  paint_coral:   item('paint_coral',   'Coral Paint',   'icon-paint-coral',   false),
  paint_sunshell:item('paint_sunshell','Sunshell Paint','icon-paint-sunshell',false),
  paint_lagoon:  item('paint_lagoon',  'Lagoon Paint',  'icon-paint-lagoon',  false),
  paint_pebble:  item('paint_pebble',  'Pebble Paint',  'icon-paint-pebble',  false),
  // diving gear (diving-gear.js): works from the bag, never breaks, one per slot
  fins:    Object.freeze({ kind: 'fins',    name: 'Puff-Feather Fins', icon: 'icon-fins',    maxStack: 1, tool: false, placeholder: false }),
  airjug:  Object.freeze({ kind: 'airjug',  name: 'Breath Jug',        icon: 'icon-airjug',  maxStack: 1, tool: false, placeholder: false }),
  goggles: Object.freeze({ kind: 'goggles', name: 'Seaglass Goggles',  icon: 'icon-goggles', maxStack: 1, tool: false, placeholder: false }),
  scraper: Object.freeze({ kind: 'scraper', name: 'Tide Scraper',      icon: 'icon-scraper', maxStack: 1, tool: false, placeholder: false }),
  // island trading posts (trader.js); the Glass Float is trade-only (no recipe)
  shell:      item('shell',      'Bright Shell', 'icon-shell',  false),
  shellwreath: item('shellwreath', 'Shell Wreath', 'icon-wreath', false),
  glassfloat: item('glassfloat', 'Glass Float',  'icon-float',  false),
  // cooking pot (cookpot.js); meals come out of the pot, never the craft list
  cookpot: item('cookpot', 'Cooking Pot', 'icon-cookpot', false), bowl: item('bowl', 'Driftwood Bowl', 'icon-bowl', false),
  // buoy ring course (buoycourse.js)
  courseflag: item('courseflag', 'Start Flag', 'icon-buoyflag', false), scoreboard: item('scoreboard', 'Race Scoreboard', 'icon-scoreboard', false),
  // game table (gametable.js)
  gametable: item('gametable', 'Driftwood Game Table', 'icon-gametable', false),
  meal_chowder:  Object.freeze({ kind: 'meal_chowder',  name: 'Tide Chowder',    icon: 'icon-meal', maxStack: 10, tool: false, placeholder: false }),
  meal_omelette: Object.freeze({ kind: 'meal_omelette', name: 'Puff Omelette',   icon: 'icon-meal', maxStack: 10, tool: false, placeholder: false }),
  meal_broth:    Object.freeze({ kind: 'meal_broth',    name: 'Kelp Broth',      icon: 'icon-meal', maxStack: 10, tool: false, placeholder: false }),
  meal_fishbowl: Object.freeze({ kind: 'meal_fishbowl', name: 'Smoky Fish Bowl', icon: 'icon-meal', maxStack: 10, tool: false, placeholder: false }),
  meal_custard:  Object.freeze({ kind: 'meal_custard',  name: 'Coconut Custard', icon: 'icon-meal', maxStack: 10, tool: false, placeholder: false }),
  meal_stew:     Object.freeze({ kind: 'meal_stew',     name: 'Captain\u2019s Stew', icon: 'icon-meal', maxStack: 10, tool: false, placeholder: false }),
  // driftboard paddleboard (paddleboard.js): launched from the bag, never lost
  driftboard: Object.freeze({ kind: 'driftboard', name: 'Driftboard', icon: 'icon-driftboard', maxStack: 1, tool: false, placeholder: false }),
  flagpole: item('flagpole', 'Flagpole', 'icon-flag', true), // raft flag (flags.js); placeholder: no icon-flag sprite, item-svg.js draws it
});

// Same shape as recipe() in inventory-state.js.
const recipe = (id, name, count, cost) => Object.freeze({ id, name, output: Object.freeze({ kind: id, count }), cost: Object.freeze(cost) });

export const CONTENT_RECIPES = Object.freeze({
  research: recipe('research', 'Tinker\u2019s Desk', 1, { wood: 6, scrap: 2 }),
  motor:    recipe('motor', 'Little Motor', 1, { wood: 6, scrap: 4, rope: 2 }),
  wheel:    recipe('wheel', 'Steering Wheel', 1, { wood: 5, rope: 2 }),
  bed:      recipe('bed', 'Bed', 1, { wood: 6, leaf: 4 }),
  brush:          recipe('brush', 'Paint Brush', 1, { wood: 2, rope: 1 }), // paint: one pot paints one piece, each recipe makes 4
  paint_seafoam:  recipe('paint_seafoam', 'Seafoam Paint', 4, { leaf: 1, sand: 1 }),
  paint_coral:    recipe('paint_coral', 'Coral Paint', 4, { clay: 2 }),
  paint_sunshell: recipe('paint_sunshell', 'Sunshell Paint', 4, { sand: 1, seed: 1 }),
  paint_lagoon:   recipe('paint_lagoon', 'Lagoon Paint', 4, { plastic: 1, leaf: 1 }),
  paint_pebble:   recipe('paint_pebble', 'Pebble Paint', 4, { stone: 1, clay: 1 }),
  // decor pack (decor-pack.js)
  rug:     recipe('rug',     'Woven Deck Mat',    1, { leaf: 4, rope: 2 }),
  pennant: recipe('pennant', 'Wind Pennant',      1, { wood: 2, leaf: 2, rope: 1 }),
  fern:    recipe('fern',    'Hanging Fern Post', 1, { wood: 2, rope: 2, leaf: 3 }),
  chime:   recipe('chime',   'Shell Chime',       1, { wood: 1, scrap: 2, rope: 2 }),
  hammock: recipe('hammock', 'Rope Hammock',      1, { wood: 4, rope: 4, leaf: 2 }),
  pots:    recipe('pots',    'Clay Pot Trio',     1, { clay: 3, leaf: 2 }),
  sign:    recipe('sign',    'Signboard',         1, { wood: 3, rope: 1 }),
  // seaside kiln (kiln.js); smelting itself happens in the kiln, not here
  kiln:         recipe('kiln',      'Seaside Kiln',  1, { stone: 4, clay: 4, scrap: 1 }),
  glasslamp:    recipe('glasslamp', 'Glass Lantern', 1, { glass: 2, metalingot: 1, wood: 1 }),
  sinker:       recipe('sinker',    'Line Sinker',   1, { metalingot: 1, stone: 1 }),
  // friendly storms (storm.js)
  stormrod:   recipe('stormrod',   'Lightning Rod', 1, { metalingot: 2, copperingot: 1, wood: 2 }),
  stormlamp:  recipe('stormlamp',  'Storm Lantern', 1, { stormshard: 2, glass: 1, metalingot: 1 }),
  stormglass: recipe('stormglass', 'Storm Glass',   1, { stormshard: 1, glass: 1 }),
  glasscups:    Object.freeze({ id: 'glasscups', name: 'Glass Cups', output: Object.freeze({ kind: 'cup', count: 3 }), cost: Object.freeze({ glass: 1 }) }),
  brickplanter: Object.freeze({ id: 'brickplanter', name: 'Brick Planters', output: Object.freeze({ kind: 'palm', count: 2 }), cost: Object.freeze({ brick: 3, leaf: 2 }) }),
  // raft animals (animals.js); the Egg Lantern is a lantern made with an egg instead of scrap
  nestbox: recipe('nestbox', 'Nest Box',        1, { wood: 3, leaf: 2, rope: 1 }),
  cushion: recipe('cushion', 'Feather Cushion', 1, { feather: 3, leaf: 2 }),
  egglamp: Object.freeze({ id: 'egglamp', name: 'Egg Lantern', output: Object.freeze({ kind: 'lantern', count: 1 }), cost: Object.freeze({ puffegg: 1, wood: 2 }) }),
  goatpen: recipe('goatpen', 'Hay Corner',      1, { wood: 4, leaf: 3, rope: 1 }),
  bucket:  recipe('bucket',  'Wooden Pail',     1, { wood: 3, rope: 1 }),
  motor:    recipe('motor', 'Little Motor', 1, { wood: 6, scrap: 4, rope: 2 }),
  wheel:    recipe('wheel', 'Steering Wheel', 1, { wood: 5, rope: 2 }),
  bed:      recipe('bed', 'Simple Bed', 1, { leaf: 10, wood: 6, plastic: 4, nail: 3 }), // [bed]
  brush:          recipe('brush', 'Paint Brush', 1, { wood: 2, rope: 1 }), // paint: one pot paints one piece, each recipe makes 4
  paint_seafoam:  recipe('paint_seafoam', 'Seafoam Paint', 4, { leaf: 1, sand: 1 }),
  paint_coral:    recipe('paint_coral', 'Coral Paint', 4, { clay: 2 }),
  paint_sunshell: recipe('paint_sunshell', 'Sunshell Paint', 4, { sand: 1, seed: 1 }),
  paint_lagoon:   recipe('paint_lagoon', 'Lagoon Paint', 4, { plastic: 1, leaf: 1 }),
  paint_pebble:   recipe('paint_pebble', 'Pebble Paint', 4, { stone: 1, clay: 1 }),
  // diving gear (diving-gear.js)
  fins:    recipe('fins',    'Puff-Feather Fins', 1, { feather: 3, plastic: 2, rope: 1 }),
  airjug:  recipe('airjug',  'Breath Jug',        1, { plastic: 3, metalingot: 1, rope: 1 }),
  goggles: recipe('goggles', 'Seaglass Goggles',  1, { glass: 2, rope: 1, leaf: 1 }),
  scraper: recipe('scraper', 'Tide Scraper',      1, { metalingot: 1, scrap: 2, wood: 1 }),
  // island trading posts (trader.js); gated by the Shell Wreath plan (trader craftLocked)
  shellwreath: recipe('shellwreath', 'Shell Wreath', 1, { shell: 3, rope: 2, leaf: 2 }),
  // cooking pot (cookpot.js)
  cookpot: recipe('cookpot', 'Cooking Pot', 1, { clay: 3, stone: 2, scrap: 1 }),
  bowl:    recipe('bowl', 'Driftwood Bowl', 2, { wood: 1 }),
  // buoy ring course (buoycourse.js); the kit makes the Start Flag
  coursekit: Object.freeze({ id: 'coursekit', name: 'Course Kit', output: Object.freeze({ kind: 'courseflag', count: 1 }), cost: Object.freeze({ plastic: 4, rope: 3, wood: 3 }) }),
  scoreboard: recipe('scoreboard', 'Race Scoreboard', 1, { wood: 3, scrap: 1 }),
  // game table (gametable.js)
  gametable: recipe('gametable', 'Driftwood Game Table', 1, { wood: 6, rope: 1, stone: 2 }),
  // driftboard paddleboard (paddleboard.js)
  driftboard: recipe('driftboard', 'Driftboard', 1, { wood: 6, plastic: 3, rope: 2 }),
  flagpole: recipe('flagpole', 'Flagpole', 1, { wood: 4, rope: 2, leaf: 2 }), // raft flag (flags.js)
});

// Placeable decor added by content modules (models come from content.decorModel()).
export const CONTENT_DECOR = Object.freeze(['research', 'bed', 'motor', 'wheel', 'rug', 'pennant', 'fern', 'chime', 'hammock', 'pots', 'sign', 'kiln', 'glasslamp', 'nestbox', 'cushion', 'cookpot', 'shellwreath', 'glassfloat', 'flagpole', 'gametable', 'courseflag', 'scoreboard', 'goatpen', 'stormrod', 'stormlamp', 'stormglass']);
export const CONTENT_BLOCK_RADIUS = Object.freeze({ research: .5, bed: .55, motor: .45, wheel: .4, pennant: .1, fern: .12, chime: .12, hammock: .45, pots: .3, sign: .1, kiln: .45, glasslamp: .12, nestbox: .35, cushion: .3, cookpot: .35, shellwreath: .12, glassfloat: .2, flagpole: .1, gametable: .45, courseflag: .15, scoreboard: .3, goatpen: .4, stormrod: .15, stormlamp: .12, stormglass: .1 });
