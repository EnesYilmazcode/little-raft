# Storage chests and the research table

Design for two Raft staples in Little Raft: a chest you put items into, and a
table that teaches you new recipes when you feed it materials. Both stay
friendly (nothing is lost for good, nothing punishes you) and lean (new files,
cached materials, no per-frame work, one small hook block in `game.js`).

## 1. What Raft does

raft.wiki.gg blocks automated fetches (HTTP 401 and a "Blocked - wiki.gg" page
on the API), so the facts below come from search snippets of the wiki's
mirror and from guide sites. Each is marked with where it came from. The
pages to recheck by hand are
<https://raft.wiki.gg/wiki/Research_Table> and
<https://raft.wiki.gg/wiki/Small_Storage>.

### Research Table

- Cost: 14 planks and 2 scrap. You get it from the start.
  ([ginx.tv](https://ginx.tv/en/raft/research-table-craft-unlock-items),
  [progameguides](https://progameguides.com/raft/how-to-research-items-in-raft))
- You stand at the table and press E. The panel has one input slot at the top
  and a list of locked recipes below it.
  ([primagames](https://primagames.com/tips/how-to-use-the-research-table-in-raft))
- You research ingredients, not recipes. Dropping an item into the slot marks
  that item kind as researched. A recipe can be learned once every one of its
  ingredients is researched. A "Learn" button then shows up, and clicking it
  adds the recipe to the crafting menu.
  ([primagames](https://primagames.com/tips/how-to-use-the-research-table-in-raft),
  [techraptor](https://techraptor.net/gaming/guides/raft-research-and-blueprints-guide))
- Researching uses up the item you put in, so you need a spare to craft with.
  ([segmentnext](https://segmentnext.com/raft-research))
- One ingredient can open several recipes at once. Researching leather and
  wool unlocks the leather helmet, body armor and greaves together.
  ([gamerempire](https://gamerempire.net/raft-how-to-use-the-research-table/))
- Some recipes come from blueprints found in the world instead. Picking one up
  teaches it right away and takes nothing.
  ([primagames blueprints](https://primagames.com/tips/how-to-use-blueprints-in-raft-blueprints-guide))
- Learning every table recipe earns the "Bookworm!" achievement. (Fandom
  [Research Table](https://raft.fandom.com/wiki/Research_Table?oldid=5371))

### Small Storage

- 8 slots, one of the first containers you can make. Guides list the cost as
  plastic, scrap and rope.
  ([segmentnext storage](https://segmentnext.com/raft-storage))
- Bigger tiers exist. Medium is the usual pick, and Large has 40 slots and
  needs titanium. A Steam thread compares "12 storages x 8 slots" with
  "4 storages x 40 slots".
  ([Steam discussion](https://steamcommunity.com/app/648800/discussions/0/3050611379019048164),
  [Steam discussion 2](https://steamcommunity.com/app/648800/discussions/2/2961639012581366839))
- You look at the box and press E. Your inventory and the box's slots open
  side by side, and you drag stacks between them.

## 2. Our version

| Raft | Little Raft | Why |
|---|---|---|
| Separate small, medium and large storage | One chest: the existing **Crate** decor gets 12 slots | `crate` is already craftable (4 wood, 1 scrap) and placeable, so we add no new item. 12 sits between Raft's small and medium tiers. |
| Drag stacks between panels | **Click a stack to send it across.** Shift+click sends half. A "Put all" button stores everything except the hotbar. | Works with mouse, touch and gamepad focus, and needs no drag code. |
| Research Table, 14 planks + 2 scrap | **Research Table**, 6 wood + 2 scrap, known from the start | Same role, priced for our smaller economy. |
| Research uses up the item | Uses up **1** of the item, once per kind | Same as Raft, and it only costs one of each kind ever. |
| "Learn" button per recipe | **Recipes learn themselves** once all their ingredients are researched. You get a toast ("New recipe: Lantern!") and a short glow on that recipe | One fewer click. You still see what each item you research opens up. |
| Blueprints | Out of scope (future: drift a bottle with a blueprint) | Keeps this change small. |

### Unlock tree

These are known from the start: `rope`, `hook`, `hammer`, `crate`,
`research`. Everything else unlocks from the ingredient kinds it uses (from
`RECIPES` in `inventory-state.js`).

| Research these | Unlocks |
|---|---|
| wood | bench |
| wood + leaf | palm planter |
| wood + scrap | lantern |
| wood + rope | fishing rod, net |
| wood + rope + leaf | sail |

We never write this table into the code. The rule is "a recipe is learnable
when every key in its `cost` is in `research.seen`". When another fleet adds a
recipe, it joins the tree on its own. A recipe that uses only starter-safe
kinds, or whose id is in `STARTER`, starts unlocked.

Items you can research are the ingredient kinds of every locked recipe:
`wood`, `leaf`, `scrap`, `rope`, and `plastic` once a recipe uses it. Tools
and placed goods are not ingredients, so the table turns them away with
"That doesn't teach anything new". Kinds already researched are turned away
too, and you keep the item.

### Friendly rules

- Research takes one item and nothing else. If no recipe needs that item, the
  table turns it away and you keep it.
- Chests never vanish. Today decor can't be removed. When removal arrives, a
  crate that still holds items can't be picked up ("Empty the crate first"),
  so nothing is ever destroyed.
- Old saves never lose recipes (see section 4). Any recipe whose output you
  already own, or have placed as decor, counts as learned.

## 3. Data model

All state lives in the existing `world` object, so it saves, loads and syncs
along with tiles and decor.

```js
world.storage = {            // keyed by the crate's tile, same key decor uses
  "1,-1": [slot|null, ... ×12],   // slot = {kind, count, durability?}; same shape as Bag slots
};
world.research = {
  v: 1,
  seen:    ["wood", "leaf"], // ingredient kinds already researched (sorted, unique)
  learned: ["bench", "palm"] // recipe ids learned beyond STARTER (sorted, unique)
};
```

- Each crate's chest is `world.storage[x + ',' + z]`. A crate without an entry
  is an empty chest. The entry is created on the first store.
- Entries whose tile has no crate are dropped by `cleanStorage` (guards
  against bad or hand-edited saves).
- Stack limits come from `ITEM_INFO[kind].maxStack`, so tools stack to 1 and
  keep their `durability`.
- Research is per raft, shared by the whole crew, the same way tiles are. Your
  brother learns what you learn while he's aboard.

### New item and recipe

```js
// dist/storage-research.js
export const EXTRA_ITEMS = { research: { kind:'research', name:'Research Table', icon:'icon-repair', maxStack:20, tool:false, placeholder:true } };
export const EXTRA_RECIPES = { research: { id:'research', name:'Research Table', output:{kind:'research', count:1}, cost:{wood:6, scrap:2} } };
export const EXTRA_DECOR = ['research'];
export const EXTRA_BLOCK = { research: .5 };
```

`ITEM_INFO` and `RECIPES` are frozen, so `inventory-state.js` has to spread
these in before `Object.freeze` (hook H1 below). This is a change to an
existing file, but it is two spread lines and the only way to add an item kind
without forking the Bag.

## 4. Save format and compatibility

Same `localStorage` key and the same `{...world, items: []}` blob, with two
new optional fields: `storage` and `research`.

| Situation | Behaviour |
|---|---|
| Old save, no `research` | **All recipes learned.** Players with a raft already keep everything. A "fresh" world (9 tiles, no decor, `collected == 0`) instead starts with `STARTER` only, so the tree still teaches new players. |
| Old save, no `storage` | `{}`: every existing crate is an empty chest. |
| New save opened by an old client | `cleanWorld` drops the unknown fields and items in chests are lost on that client. We accept this because releases only move forward. The fields are still present when a new client reopens the save, as long as the old client hasn't autosaved over it. |
| Learned ids no longer in `RECIPES` | Kept in the array and ignored, so a recipe that comes back later is still learned. |
| Bad entries (wrong kind, count ≤ 0, over maxStack, non-array) | Slot becomes `null`. Counts over the cap are clamped, never split into extra items. |

`cleanStorage(v.storage, tiles, decor)` and `cleanResearch(v.research, v)` run
inside `cleanWorld`, so host snapshots received by a guest are checked the
same way as saves.

### Co-op sync

- The host is in charge, as with everything else. New action kinds go through
  the existing `action()` → `applyAction(a, actor)` path:
  - `{kind:'chest', x, z, op:'put'|'take', slot, amount?, expect:{kind,count}}`
    moves one stack between the actor's bag and that chest. `expect` must
    match the current contents of the source slot or the action is dropped.
    This keeps two players clicking the same stack from duplicating it.
  - `{kind:'chestAll', x, z}` puts every non-hotbar bag stack into the chest.
  - `{kind:'research', slot, expect:{kind}}` checks that the actor stands
    within reach of a research table, takes 1 from that slot, adds the kind to
    `seen`, re-derives `learned`, and emits a toast to `'all'` for each new
    recipe.
- The guest does not predict chest or research changes. It shows a small
  "…" on the clicked slot until the next host state, which arrives about every
  0.12 s, and the canonical bag snapshot clears it.
- Bandwidth: `storage` rides along in the state message. The worst case is
  400 crates × 12 slots, but in practice it's a handful of crates. To keep
  messages small, the host sends `storage` only when `world.storageRev`
  changed since the last ack and otherwise sends `storageRev` alone. The guest
  keeps its last copy.
- Old host with a new guest: the state has no `research`, so the guest treats
  everything as learned. That matches what the old host allows.
- `craft` on the host gets one guard: if the recipe isn't learned, it emits
  "Research it first at a Research Table" and stops. The UI already blocks
  this, so the guard only catches modified clients and races.

## 5. API

### `dist/storage-research.js` (pure: no DOM, no THREE, safe in `node --test`)

```js
export const CHEST_SLOTS = 12;
export const STARTER = Object.freeze(['rope','hook','hammer','crate','research']);
export const EXTRA_ITEMS, EXTRA_RECIPES, EXTRA_DECOR, EXTRA_BLOCK;
export const tileKey = (x, z) => x + ',' + z;

export function cleanStorage(raw, tiles, decor) → {[key]: slot[]}
export function cleanResearch(raw, world) → {v:1, seen:string[], learned:string[]}
export function freshResearch() → {v:1, seen:[], learned:[]}
export function isLearned(research, recipeId) → boolean   // STARTER ∪ learned; null research → true
export function researchable(research, kind) → boolean    // an ingredient of some not-yet-learned recipe and not yet seen
export function feed(research, kind) → string[]           // mutates; returns newly learned ids (sorted)
export function lockedBy(research, recipeId) → string[]   // ingredient kinds still to research (for the UI hint)
export function chestOf(storage, x, z) → slot[]           // creates lazily
export function moveStack(fromSlots, i, toSlots, amount?) → number  // moved count; merges into partial stacks first, then empties; keeps durability
export function putAll(bagSlots, chestSlots, skip = 8) → number
export function chestEmpty(storage, x, z) → boolean
```

Every function checks its own input and never throws on junk. Moving into a
full chest leaves the leftover in the source slot.

### `dist/storage-research-ui.js` (DOM)

```js
export function createStorageResearchUI({ onChest, onChestAll, onResearch, getBag, getWorld, itemIcon, onClose })
  → { openChest(x, z), openResearch(), refresh(), decorateRecipes(rootEl), close(), isOpen() }
```

- One `<dialog id="lrChest">` and one `<dialog id="lrResearch">`, built once
  the first time they open and reused after that. Class names start with
  `lr-sr-`.
- The chest panel shows 12 chest slots above the 28 bag slots, using the same
  slot look as `survival-ui.js` (copied CSS tokens, not imported). Painting
  uses a per-slot signature like `paintRecipes`, so an unchanged slot never
  touches the DOM.
- The research panel has a drop row with one tile per researchable kind you
  carry (click to research), a "Researched" chip list, and "Next up" rows
  showing locked recipes with their still-needed kinds greyed.
- `decorateRecipes(rlist)` sets `data-locked="1"` and a `title` hint ("Needs
  research: scrap") on each `.sv-recipe` whose recipe isn't learned. One
  injected style rule, `.sv-recipe[data-locked]{filter:grayscale(1);opacity:.45;pointer-events:none}`,
  greys locked recipes without depending on `paintRecipes`' `disabled`
  logic. A `.sv-lock` badge is appended once per button. It runs when the
  inventory opens and whenever `research` changes. It doesn't watch the DOM.
- Esc closes the panel and returns pointer lock the same way the inventory
  does (`onClose`).

### `dist/research-table-model.js`

`createResearchTable(T) → THREE.Group`: a small desk with a book and a
magnifier, about 1 m tall, origin on the floor top like `createCraft`. It
merges into 2 meshes with vertex colors and uses one module-level cached
`MeshStandardMaterial` registered as shared. `rebuildRaft` disposes geometry,
so the model builds new geometry on each call, as `crafts.js` does. That only
happens on build events, never per frame.

## 6. Hooks into existing files

Every hook is wrapped in `// >>> storage-research` … `// <<< storage-research`.

| # | File | Change |
|---|---|---|
| H1 | `dist/inventory-state.js` | `import { EXTRA_ITEMS, EXTRA_RECIPES } from './storage-research.js'` and spread them into `ITEM_INFO` / `RECIPES` before freezing (each value wrapped in `Object.freeze` / `recipe()`). |
| H2 | `dist/game.js` top | Import the three modules, and use `DECOR_TYPES = [..., ...EXTRA_DECOR]` and `BLOCK_RADIUS` spread with `EXTRA_BLOCK`. |
| H3 | `dist/game.js` `cleanWorld` / `newWorld` / `copyWorld` | Add `storage: cleanStorage(v.storage, tiles, decor), research: cleanResearch(v.research, v)` to the returned object. `newWorld` uses `{}` and `freshResearch()`. |
| H4 | `dist/game.js` `applyAction` | At the top: `if (SR_ACTIONS.has(a.kind)) { srApply(a, actor, bag); return; }`, and a learned guard in `craft`. `srApply` lives in the new module as `applySR(world, a, bag, ctx)`, where ctx has `{emit, actor, near(x, z), itemName}`. |
| H5 | `dist/game.js` `interact` | Before `openInventory()`: `if (srUI && srInteract(currentAim())) return;`. A crate within `PICKUP_REACH` opens the chest, and a research decor opens the table. |
| H6 | `dist/game.js` `rebuildRaft` | `if (d.type === 'research') detailed = createResearchTable(T);` |
| H7 | `dist/game.js` `openInventory` / state receive | Call `srUI.decorateRecipes(...)` after opening and after a state that changed `research`. |
| H8 | `package.json` | Add `tests/storage-research.test.mjs` to `npm test`. |

H1 is the only hook outside `game.js`. If the inventory fleet objects, the
fallback is to drop the new item and let the existing **bench** act as the
research table. Then H1 and H6 go away, and the cost is a less Raft-like
name.

## 7. Test plan

### Unit (`tests/storage-research.test.mjs`, `node --test`, uses `RAFT_DIST` like `survival.test.mjs`)

1. `moveStack` merges into a partial stack before using an empty slot, and
   returns the right moved count.
2. `moveStack` into a full chest moves 0 and leaves the source unchanged.
3. `moveStack` keeps `durability` on tools and never stacks two tools.
4. Shift (half) moves `ceil(count / 2)`.
5. `putAll` skips hotbar slots 0–7 and stops when the chest fills, leaving the
   rest in the bag.
6. The total item count across bag + chest is the same before and after every
   move (property loop with 500 random moves).
7. `cleanStorage` drops keys with no crate, unknown kinds, NaN or negative
   counts, and non-array values. It clamps over-max counts and pads or trims
   to 12 slots.
8. `cleanResearch(undefined, oldWorld)` returns all recipes learned for a
   built world, and `STARTER` only for a fresh world.
9. `feed`: wood then scrap returns `['bench']` then `['lantern']`. Feeding a
   kind twice returns `[]`, and `researchable` turns it away.
10. `feed('hook')` is turned away (not an ingredient). `lockedBy('sail')`
    lists exactly the missing kinds.
11. `isLearned(null, id)` is true (old host compatibility).
12. JSON round trip: `cleanWorld(JSON.parse(JSON.stringify(world)))` keeps
    storage and research byte for byte.
13. `EXTRA_RECIPES.research` is craftable by `Bag`, and `ITEM_INFO.research`
    exists after H1.

### Headless (`python shoot.py dist .qa/storage-research`)

- `chest-open.png`: place a crate, press E, chest panel open with 3 stacks.
- `research-open.png`: research table placed, panel showing "Next up" rows.
- `recipes-locked.png`: inventory with lantern / sail greyed and lock badges.
- `recipes-unlocked.png`: same after feeding wood + rope.
- Check the console for zero errors, and check that the frame time is
  unchanged with the panels closed (no new per-frame work).

### Co-op (`check_multiplayer.py` style, two pages)

- Guest stores 5 wood in the host's crate. The host sees it, and after a
  reload the save still has it.
- Both players take the same stack in the same tick. Exactly one gets it, and
  the item total is conserved.
- Guest researches scrap. Both see the "New recipe: Lantern!" toast, and the
  guest can craft a lantern on its next state.
- Old save fixture (no `storage` / `research`) loads with all recipes and
  empty crates.

## 8. Files

- `dist/storage-research.js`: pure logic and constants
- `dist/storage-research-ui.js`: chest and research dialogs, recipe lock decoration
- `dist/research-table-model.js`: table mesh
- `tests/storage-research.test.mjs`
- Hooks H1–H8 above
