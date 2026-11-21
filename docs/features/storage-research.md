# Storage chests and the research table

Design for two Raft staples in Little Raft: a chest you put items into, and a
table that teaches you new recipes when you feed it materials. Both stay
friendly (nothing is lost for good, nothing punishes you) and lean (new files,
cached materials, no per-frame work). It plugs in through the content registry
(`dist/content.js`, `docs/features/content-hooks.md`) and needs **no edits to
`game.js`, `content.js` or `inventory-state.js`**.

## 1. What Raft does

raft.wiki.gg could not be reached again in this pass (Nov 2026: the sandbox
cannot resolve the host, and earlier passes got HTTP 401 and a "Blocked -
wiki.gg" page). The facts below come from search snippets and guide sites,
and each one is marked with its source. Recheck these pages by hand:
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
| Research Table, 14 planks + 2 scrap | **Research Table** (`research` item/decor, already in `content-items.js`), 6 wood + 2 scrap, known from the start | Same role, priced for our smaller economy. |
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
- Chest contents are never deleted. If a crate is missing at a key that has
  data (removed later, a bad save, a guest visiting), the data stays in the
  save but is hidden. Placing a crate on that tile again shows it.
- Old saves never lose recipes (section 4).

## 3. State: `world.ext.storage`

The module's slice is `world.ext.storage`. `serialize()` returns it and
`load(data, from)` restores it.

```js
{
  v: 1,
  chests: {                    // keyed by "x,z", the same tile key decor uses
    "1,-1": [slot|null, ... x12]   // slot = {kind, count, durability?}, the Bag slot shape
  },
  seen:    ["leaf", "wood"],   // researched ingredient kinds (sorted, unique)
  learned: ["bench", "palm"],  // learned recipe ids beyond STARTER (sorted, unique)
  legacy:  true,               // optional: set once when an old save was grandfathered
  r: 17                        // rev, a mutation counter (cheap change detection)
}
```

- **Research is shared per raft**, like tiles. Whatever anyone researches is
  learned by the whole crew, so there is no per-player bookkeeping. A guest
  sees the host raft's tree while visiting and gets their own back on
  `load(..., 'restore')`.
- **Slot validation uses `Bag`.** For each slot, the module builds a
  28-slot snapshot with that slot at index 0 (`{slots, selected:0}`), runs
  `new Bag(snap)` in a try/catch, and keeps `bag.slots[0]` (so tools get
  their default `durability`). Any slot that throws becomes `null`. Arrays are
  padded or trimmed to 12. Bag's own rules on kinds, counts, maxStack and
  durability are the only rules, so new item kinds from other fleets just
  work. This runs only in `load`, never per frame.
- **Size.** `cleanExt` caps each `world.ext` at 200,000 chars. The worst case
  is 400 crates, which fits in about 170k as plain JSON. `load` keeps at most
  400 chest keys and drops all-empty chests.
- **Cheap sync.** `serialize()` returns one cached object, rebuilt only when
  `r` changed. On the guest, `load(data, 'net')` returns early when `data.r`
  equals the last `r` it applied (and the object is the same shape), so there
  is no revalidation 8 times a second.
- **Model.** Crates already have a model in `crafts.js`. The research table
  model comes from `decorModel('research')`: a small desk built in
  `dist/storage-research-model.js` with one cached material. It runs only
  when `rebuildRaft()` runs.

### Recipe gating

`STARTER = ['rope','hook','hammer','crate','research']` is always learned.
Any other recipe in `RECIPES` is learned when its id is in `learned`. After
each research, `learned` is recomputed with one rule: a recipe becomes learned
once every key of its `cost` is in `seen`. So recipes that other fleets add
join the tree with no extra work.

`craftLocked(recipe, actor)` returns `"Research it first at a Research
Table"` when the recipe is locked, and `null` otherwise. It runs on the host,
through the craft hook that already exists.

## 4. Backward compatibility (critical)

| Situation | Behaviour |
|---|---|
| `load(undefined, 'save')` and the world is **progressed** | **Grandfathered**: `learned` = every current recipe id, `seen` = every ingredient kind, `legacy: true`. Nothing the player could craft yesterday is locked today. |
| `load(undefined, 'save')` and the world is **brand new** | The locked tree: `STARTER` only. |
| `load(undefined, 'net')` (an old host without this module) | Everything is treated as learned and the data is not saved. The old host allows all crafts anyway. |
| `load(garbage, *)` | Every field is validated separately. A bad `learned` array on a save also falls back to the progressed or new rule above. The module never throws. |
| Learned ids no longer in `RECIPES` | Kept and ignored, so a recipe that comes back is still learned. |
| An old client opens a new save | The old `cleanWorld` drops `ext`. This is accepted because releases only move forward. |

"Progressed" means any one of these is true for `ctx.world`:
`tiles.length > 9`, `decor.length > 0`, `collected > 0`, `fish > 0`, or a
kind in `hostInventory` or `guestInventory` that is any recipe's output other
than `hook`. This matches the `built` / `untouched` test in `bagsFromWorld`,
so a legacy world that `game.js` treats as touched is grandfathered too.
"Brand new" is the `newWorld()` shape: 9 tiles, no decor, nothing collected,
and only the starting hook. Once a world is saved with `ext.storage`, the
grandfather check never runs again.

**Orphan chests.** If a chest key has no `crate` in `world.decor`, its data is
kept and serialized but hidden: no prompt, no panel, and actions on it are
refused. Placing a crate on that tile shows the contents again.

## 5. Actions (host-authoritative, atomic)

Guests send these with `ctx.action(a)`. Solo and host players call the same
path directly, so there is one code path. `action(a, actor, bag)` handles
`a.kind` values that start with `storage.` and returns `true` for them, even
when it refuses the action. Every field is checked: integers in range, `x,z`
as a key that has a crate (or a `research` decor for research), and the actor
within reach. For reach, the host's position is the camera and the guest's
is `ctx.other`. If the position is unknown, reach is not enforced. Reach is
3.2 m to the tile centre.

| kind | fields | effect |
|---|---|---|
| `storage.put` | `x, z, from` (bag slot 0..27), `to?` (chest slot), `amount?`, `expect:{kind,count}` | Moves a stack from the bag into the chest. It merges into partial stacks first, then empty slots, or goes into `to` when that slot is empty or the same kind. |
| `storage.take` | `x, z, from` (chest slot 0..11), `to?` (bag slot), `amount?`, `expect:{kind,count}` | Moves a stack from the chest into the bag, with the same merge rules. Leftover stays in the chest. |
| `storage.putAll` | `x, z` | Puts every non-hotbar bag stack (slots 8..27) into the chest until it is full. |
| `storage.research` | `x, z` (the table), `slot` (bag), `expect:{kind}` | If the kind is still researchable, removes 1, adds the kind to `seen`, recomputes `learned`, and emits `{kind:'notice', text:'New recipe: Lantern!'}` to `'all'` for each new recipe. Otherwise it emits a friendly refusal ("That doesn't teach anything new") and takes nothing. |

**Atomic.** Each action runs fully inside one synchronous `action()` call.
The module checks everything first, then mutates the chest and the actor's
`bag.slots` together, then increments `r`. `expect` must match the source
slot exactly or the action is dropped. This stops two players who click the
same stack in the same tick from duplicating it. Items are moved, never
created: the item total across bag and chest is checked in tests. The
durability of a tool travels with its slot, and tools never stack.

The guest does not predict any of this. The next host state (about 0.12 s
later) carries both the bag and `ext.storage`.

## 6. UI

`dist/storage-research-ui.js` (DOM only) is created lazily by the module the
first time E is pressed on a chest or table. It builds one
`<dialog id="lrStorage" class="lr-sr">` and injects one `<style
id="lr-sr-style">`.

- **Opening.** `interact(aim)` picks the nearest `crate` or `research` decor
  within reach of `aim`, calls `ctx.releaseLock()`, and calls
  `dialog.showModal()`. An open `<dialog>` already makes the engine's
  `uiBlocked()` true, so movement, E and hotbar keys pause with no new hook.
  `prompt(aim)` returns "E: Open crate" or "E: Research table".
- **Closing.** Escape uses the dialog's native `cancel`, and there is also a
  close button and a backdrop click. On `close` the UI calls
  `ctx.requestLock()` when `ctx.running`. The panel also closes itself when
  the decor is gone or the player walks out of reach, checked in `update()`
  with no allocations.
- **Look.** It copies the survival-ui tokens: a wood frame (`#b48d55` to
  `#8a663a` gradient, `#3e2a17` border), dark inner panels (`#3a2716eb`), 52 px
  slots, the same font, `sv-short` red counts, and the same durability bar
  colours. It uses class names starting with `lr-sr-` and only nests the
  survival-ui slot markup (`.sv-slot > .sv-art/.sv-count/.sv-dur`).
- **Icons and slot painting.** One tiny documented hook in `survival-ui.js`:
  `export { iconSVG, slotSig, paintSlot, itemName }; // content hook
  (storage-research)`. The panel reuses `paintSlot`, which compares
  signatures, so an unchanged slot never touches the DOM. It repaints only
  when `r` or the bag snapshot signature changes. The UI imports
  `./survival-ui.js?build=<same build query>` (taken from its own
  `import.meta.url`) so it shares the engine's module instance.
- **Chest panel.** 12 chest slots sit above the 28 bag slots (hotbar row at
  the bottom). Click a stack to move all of it across, and Shift+click to
  move half. A "Put all" button stores everything outside the hotbar.
- **Research panel.** A drop row shows one tile for each researchable kind
  in the bag (click it to research). Below it are "Researched" chips and
  "Next up" rows: locked recipes with the kinds they still need greyed out.
- **Locked recipes in the craft list.** They are **shown greyed with a lock
  badge, not hidden**, so players can see what is coming. The module
  annotates the DOM, with no further survival-ui hook. When
  `#inventory[open]` turns true, or `r` changes while it is open (a boolean
  and integer check in `update()`), it sets `data-locked="1"` and a `title`
  ("Needs research: scrap") on each `.sv-recipe[data-recipe]` that is not
  learned, and appends one `.lr-sr-lock` badge. The CSS rule
  `#inventory .sv-recipe[data-locked]{filter:grayscale(1);opacity:.5;pointer-events:none}`
  works no matter how `paintRecipes` sets `disabled`. Even if a modified
  client bypasses it, `craftLocked` still refuses on the host.

## 7. Debug (`raftDebug.content.storage`)

| helper | does |
|---|---|
| `openChest(x, z)` | Places a crate there if the tile is free (debug only), then opens the chest panel. |
| `research(kind)` | Runs `storage.research` as the local actor, skipping the reach and item checks. Returns the newly learned ids. |
| `unlockAll()` | Learns every recipe and sees every kind. |
| `state()` | A deep copy of the slice, plus `{open, locked: [...ids]}`. |

## 8. Files and hooks

- `dist/storage-research.js`: `createStorage(ctx)` plus the exported pure
  helpers (`cleanSlice`, `isProgressed`, `learnedFrom`, `moveStack`,
  `putAll`, `applyStorageAction`). These need no DOM and no THREE, so they
  are testable in node.
- `dist/storage-research-ui.js`: the dialog and the craft-list annotation.
- `dist/storage-research-model.js`: the research table mesh.
- `tests/storage-research.test.mjs`
- Shared-file edit: **one export line** in `dist/survival-ui.js`, marked
  `// content hook`. Nothing in `game.js`, `content.js` or
  `inventory-state.js` changes.

## 9. Test plan

**Unit** (`node --test`, imports like `tests/survival.test.mjs`):

1. Slice validation: junk, `null`, arrays and bad slots become valid. Each
   slot is checked by Bag, tools gain durability, and arrays are padded or
   trimmed to 12. A JSON round trip is stable.
2. Grandfathering: `load(undefined,'save')` on a world with 10 tiles, one
   with decor, one with a crafted sail in the bag, or one with `collected > 0`
   learns every recipe. A `newWorld()`-shaped world gets `STARTER` only.
   `load(undefined,'net')` locks nothing.
3. Orphans: a chest key with no crate survives serialize and load. Actions on
   it are refused, and the interact prompt is null.
4. `put` and `take` merge into partial stacks first, a full target moves 0,
   amount and half work, and durability is kept.
5. `expect` mismatch, out-of-range slots, a non-integer `x`, a missing crate
   and an out-of-reach actor are all refused with no state change.
6. Conservation: 500 random put, take and putAll actions keep the total item
   count of bag plus chest.
7. Research: wood unlocks `bench`, then scrap unlocks `lantern`. A kind
   researched twice, or a non-ingredient like `hook`, is refused and the item
   is kept. A notice is emitted per new recipe.
8. `craftLocked` returns a reason for a locked recipe and `null` for
   `STARTER` and learned recipes.
9. `serialize()` returns the same object when `r` has not changed.

**Headless shots** (own playwright script, PW_CHROME): `chest-open.png` via
`openChest`, `research-open.png`, `recipes-locked.png` with greyed and badged
rows, and `recipes-unlocked.png` after `unlockAll()`. Also check for zero
console errors and that Escape closes the panel and the game resumes.

**Co-op** (two pages): the guest stores 5 wood and the host sees it after a
reload. Both players take the same stack at once and exactly one gets it. The
guest researches scrap, both players see the toast, and the guest can craft a
lantern.

**Old save fixture**: a 12-tile world with no `ext` keeps every recipe, and
its crates are empty chests.


## 10. What was built (Nov 2026)

Everything above is implemented through the content registry, with one shared-file line.

**Files**

- `dist/storage-research.js`: `createStorage(ctx)` plus the pure, exported helpers
  (`cleanSlot`, `cleanChest`, `cleanSlice`, `isProgressed`, `stateFrom`, `sliceOf`, `learnedFrom`,
  `researchableKinds`, `lockedRecipes`, `moveStack`, `putAll`, `applyStorageAction`). No DOM, no
  THREE in the logic, so node tests import it directly.
- `dist/storage-research-ui.js`: the `<dialog id="lrStorage">` and the craft-list lock badges. It
  is loaded with a dynamic `import()` the first frame the game runs, so node never loads it.
- `dist/storage-research-model.js`: the Research Table model.
- `tests/storage-research.test.mjs`: 19 tests (section 9's unit plan, plus the model cache).
- Shared-file edit: one line at the end of `dist/survival-ui.js`:
  `export { iconSVG, slotSig, paintSlot, itemName }; // content hook (storage-research)`.
  Nothing in `game.js`, `content.js` or `inventory-state.js` changed.

**Backward compatibility** follows section 4 exactly. `stateFrom(data, from, world)` holds the
rule: a missing or bad `learned` list on `'save'`/`'restore'` grandfathers a progressed world
(every current recipe learned, every ingredient seen, `legacy: true`), and a brand-new world gets
`STARTER` only. `'net'` with no slice locks nothing. `isProgressed` also treats a legacy
stock-only save (no `hostInventory`) as progressed unless it is the untouched 5/3/1 kit, which is
the same test `bagsFromWorld` uses.

**Additions to the slice.** `s` is a short random session id the host writes next to `r`. The
guest skips `load(data,'net')` only when both `r` and `s` match what it last applied, so a host
that reloads and replays the same `r` values with different data is still picked up.

**Actions** run through `applyStorageAction`, which checks everything first and then changes the
chest, the bag and `r` together. Refusals send one friendly notice to the actor ("Step a little
closer", "The crate is full", "Your bag is full", "That doesn't teach anything new"). A research
that completes no recipe yet tells the actor "Researched Rope! It helps with something new";
each new recipe goes to everyone as "New recipe: Net!".

**Model.** The table is a small scholar's desk: plank top, lower shelf with books and a seed jar,
an open book with a ribbon, ink pot and quill, a globe on a brass stand, a candle, a rolled map
and a spyglass, and a backboard with two blueprints and a note pinned on. It is one merged,
vertex-coloured `BufferGeometry` with one `MeshStandardMaterial`, plus a tiny emissive flame (a
second material whose `emissiveIntensity` flickers in `update()`, with no lights added). Both are
built once on the first `decorModel('research')`. Each call returns a new `Group` that shares them.
`rebuildRaft()` disposes the children it removes, so the shared geometry and material `dispose`
methods are no-ops, and the module's `dispose()` frees them for real.

**UI.**
- The crate panel: 12 chest slots (6 x 2) above the backpack (7 x 3) and the hotbar row, in the
  inventory's wood-frame style. Click moves a stack across, Shift+click moves half, and "Put all
  in crate" keeps the hotbar. E, Tab, Escape, the close button or a backdrop click closes it.
  It also closes when the crate is removed or you walk more than about 4 m away.
- The research panel: on the left, "Study an item" shows a tile for every kind the table still
  wants. Tiles for items you carry are clickable and say what they unlock ("Unlocks Lantern").
  Tiles for items you don't have are dimmed and say "Find one first". Below are "Studied" chips.
  On the right, "Recipes to discover" lists locked recipes with a lock badge, a tick on each
  ingredient already studied, and an "almost!" tag when only one is missing. When a recipe is
  learned, a glowing banner appears ("New recipe: Lantern! Find it in your craft list.").
- The craft list (Tab): locked recipes move to the bottom under the heading "Discover at a
  Research Table". They are dimmed and show a lock badge and "Study Scrap", and they can't be
  clicked. A recipe learned since the list was last open glows once. `craftLocked` still refuses
  on the host.

**Debug** (`raftDebug.content.storage`): `openChest(x,z)`, `openResearch(x,z)`,
`research(kind)`, `unlockAll()`, `lockAll()`, `fill(x,z,slots)`, `close()`, `state()`.

**Screenshots** are in `docs/cloud/shots/content/`: `storage-world.png` (table and crate on the
raft), `storage-chest.png`, `storage-research.png` and `storage-recipes-locked.png`.

**Not done / known issues**
- The two-page co-op check (section 9) was not run, because the headless sandbox has no PeerJS
  signalling. The guest path is covered by the unit tests: `ctx.action` dispatches it, `'net'`
  loads are idempotent, and the guest sees the `'all'` notices.
- Reach for actions uses the player's feet position (`ctx.physics`) for the host and `ctx.other`
  for the guest. It is not the camera, as section 5 says, though the two match on x/z.
- The UI module imports `survival-ui.js` without the `?build=` query, because content modules
  are loaded without it. That gives a second, side-effect-free instance that is used only for
  icon and slot painting.
- Recipes that other fleets add later are locked for grandfathered saves until their ingredients
  are studied. This is by design (`learned` was "every recipe at the time").
