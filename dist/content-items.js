// Content-fleet item kinds and recipes (islands, storage/research).
// Pure data, no imports. inventory-state.js merges these into ITEM_INFO / RECIPES,
// and game.js adds CONTENT_DECOR to its placeable decor types.
// Old builds reject unknown kinds in a bag snapshot and start a fresh bag; new builds load old saves fine.

const S = 20; // STACK_SIZE (kept literal so this file stays import-free)
const item = (kind, name, icon, placeholder = true) => Object.freeze({ kind, name, icon, maxStack: S, tool: false, placeholder });

export const CONTENT_ITEMS = Object.freeze({
  sand:     item('sand',     'Sand',           'icon-scrap', true),
  stone:    item('stone',    'Stone',          'icon-scrap', true),
  seed:     item('seed',     'Palm Seed',      'icon-leaf',  true),
  research: item('research', 'Tinker\u2019s Desk', 'icon-research', false),
});

// Same shape as recipe() in inventory-state.js.
const recipe = (id, name, count, cost) => Object.freeze({ id, name, output: Object.freeze({ kind: id, count }), cost: Object.freeze(cost) });

export const CONTENT_RECIPES = Object.freeze({
  research: recipe('research', 'Tinker\u2019s Desk', 1, { wood: 6, scrap: 2 }),
});

// Placeable decor added by content modules (models come from content.decorModel()).
export const CONTENT_DECOR = Object.freeze(['research']);
export const CONTENT_BLOCK_RADIUS = Object.freeze({ research: .5 });
