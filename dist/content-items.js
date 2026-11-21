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
  research: item('research', 'Tinker\u2019s Desk', 'icon-research', false),
  motor:    item('motor',    'Little Motor',   'icon-repair', true),
  wheel:    item('wheel',    'Steering Wheel', 'icon-repair', true),
  bed:      item('bed',      'Bed',            'icon-leaf',   true),
  // paint (dist/paint.js): the brush is not a TOOL_KIND (no durability), pots are plain stacks, not decor
  brush:         item('brush',         'Paint Brush',   'icon-brush',         false, 1),
  paint_seafoam: item('paint_seafoam', 'Seafoam Paint', 'icon-paint-seafoam', false),
  paint_coral:   item('paint_coral',   'Coral Paint',   'icon-paint-coral',   false),
  paint_sunshell:item('paint_sunshell','Sunshell Paint','icon-paint-sunshell',false),
  paint_lagoon:  item('paint_lagoon',  'Lagoon Paint',  'icon-paint-lagoon',  false),
  paint_pebble:  item('paint_pebble',  'Pebble Paint',  'icon-paint-pebble',  false),
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
});

// Placeable decor added by content modules (models come from content.decorModel()).
export const CONTENT_DECOR = Object.freeze(['research', 'bed', 'motor', 'wheel']);
export const CONTENT_BLOCK_RADIUS = Object.freeze({ research: .5, bed: .55, motor: .45, wheel: .4 });
