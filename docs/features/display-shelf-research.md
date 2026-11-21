# Display Shelf and Trophy Stand: research

Display Shelf (3 slots) and Trophy Stand (1 slot). E puts the held item in the aimed slot, and E on a filled slot
takes it back. Line numbers are from this branch.

## 1. Item models: how they are built and what they cost
- `held-items.js:138` `buildItemModel(T, kind, factory?)` returns a **fresh** Group that is centred and scaled by
  `fit()` (`:46`, one Box3 pass). Without `factory`, every call makes new geometry and materials. Tools,
  wood/leaf/scrap/plastic/rope/fish/cup/seeds and `DECOR_KINDS` (`:18`) have hand-made meshes. Instruments come from
  `instrument-models.js`. Any other kind gets a cloth bundle. With `factory` (for example `models.js getModel`),
  left-hand placeables and kinds missing from `HOLD` use the models.js art, and `root.userData.shared = true` is set.
  Cost is small (about 5 to 40 meshes), but there is no per-kind cache in the no-factory path.
- `models.js:623-629` `getModel(kind)` clones a cached template. The clone shares geometry and module-wide materials,
  and **neither is flagged `userData.shared`**. `MODEL_ALIASES` is at `:605`.
- `item-icons.js` is a **2D** pipeline. It uses a dedicated low-power WebGL renderer, renders each kind once to a 128
  px PNG data URL, caches it, and releases the context after 2.5 s. It cannot place a model in the world, but
  `getItemIcon(kind)` could serve as a sprite fallback.
- `fish-models.js:490` `createFishModel(T, species, {cm, state, lod})` caches geometry per (species, lod, state) and
  shares materials. `userData.dispose()` only detaches. It is imported as `'./fish-models.js'` **without** `?build=`
  (`fishing-cooking.js:15`, `fish-journal.js`). A new module must use the same specifier, or it loads a second module
  instance with a second cache.

**Disposal trap.** `rebuildRaft()` (`game.js:497`) calls `disposeGeometry` (`game.js:339`) on every raft child. That
function skips only geometry and materials that have `userData.shared`. Display meshes made from `getModel` or
fish-model caches would therefore have their shared GPU buffers disposed on every build. Three re-uploads them, but
you get a hitch, and materials recompile. **Rule:** keep a per-kind template cache in the module, clone it per slot,
and set `userData.shared = true` on the template's geometries and materials. Fresh `buildItemModel(T, kind)` models
without a factory are also safe to let `rebuildRaft` dispose.

## 2. Decor: definition, placement, save
- Item entry: `items.js` `LIST`, like the bees items (`:176-185`), with `category:'decor', placeable:true`.
  `PLACEABLE_IDS` (`:215`) feeds `game.js:63 DECOR_TYPES`, and `items.js:218 BLOCK_RADII` feeds `game.js:71`.
- **The grid is tile-based, not free.** `placement.js` has free placement code (`decorCheck`, `normaliseDecor`), but
  `game.js:51` imports only `createGhosts`, `wrapRot` and the rotation steps. The game uses `build-rules.js
  decorBlock` (one decor per integer tile). The stored shape is `{type, x, z, rot?}` with integer tiles, centred at
  `(x*2, .22, z*2)`. R / shift+wheel gives `rot` (`game.js:1358,1375`). It is validated in `cleanWorld`
  (`game.js:174`) and placed in `applyAction` 'build' (`game.js:884-897`).
- Model: `rebuildRaft` `game.js:502` tries `prog.modelFor`, then `createCraft`, then `content.decorModel(type)`.
  `decorModel` receives **only the type** and not `d`, so slot contents cannot be built there. Instead, copy
  `bees.js:138 scanHives`: find `g.name === 'craft_shelf'` children of `ctx.raft` (rescan when the child count or
  first child changes) and attach item models under each group. They inherit `rot` and the raft sway. Re-attach after
  every rebuild.
- Content module: append `createDisplay` to `content.js:31 FEATURES` (import at `:29`). Hooks are `prompt(aim)`
  (`game.js:566`), `interact(aim)` (`game.js:961`, after pickup and sailing, before fc, prog and watering), `action(a,
  actor, bag)` (`game.js:928`), and `update(dt)`. `promptFromHtml` / `game-aim` do **not exist** in this tree. The aim
  is `currentAim()` = `{point, item, dir, decor}` (`game.js:674`). Prompts are HTML strings that the module escapes
  with `ctx.esc`. Slot picking: put the slot centres in world space through the shelf group's `matrixWorld` and choose
  the one nearest the ray (`aim.dir`, from the camera), within about 2.6 m. Bees uses the same ray-offset test
  (`bees.js:116-136`).

## 3. Safe storage pattern (copy it from storage-research.js)
- `cleanSlot` (`:64`) runs any raw slot through the Bag's own rules (kind, count, maxStack, durability). Unknown or
  bad slots become null. `moveStack` (`:151`) moves tools as whole slot objects, so durability and id are kept.
  `applyStorageAction` (`:199-252`) works on copies of the chest and the bag, checks the decor type at the key, reach
  (`ctx.other` for a guest, which is refused if null), `expect:{kind,count}` (for stale clicks) and the slice size,
  and then commits everything together and bumps `r`.
- Orphan rule (`docs/features/storage-research.md` §2, §4): data at a key with no matching decor is kept, serialized
  and hidden. Placing the decor again shows it.
- Bag helpers: `Bag.add` returns the leftover (`inventory-state.js:250`). `Bag.remove` is atomic (`:279`).
  All-or-nothing in game.js: `scratch = new Bag(bag.snapshot())`, then `commit(bag, scratch)` (`game.js:119`) and
  `spend` (`:123`). bees.js `harvest` (`:85`) does the same with `bag.constructor` and bumps `bag.version`.

## 4. Proposed state: `world.ext.display`
```js
{ v:1, s:'session', r:7,
  d:{ "3,-1":[{kind:'scrap',count:1}, null, {kind:'hook',count:1,durability:64}],   // shelf: 3 slots
      "0,2":[{kind:'rope',count:1}] },                                              // stand: 1 slot
  t:{ "0,2":{species:'pomfret', cm:41.2} } }   // optional mounted journal trophy (cosmetic copy)
```
Each slot holds a count of 1. Actions: `display.put {x,z,i,from,expect}` takes 1 from bag slot `from` (a whole slot if
the item is a tool). `display.take {x,z,i,expect}` uses `scratch.add`, and a full bag gives `{kind:'full'}` with the
item staying on the shelf. The handler returns `true` for every `display.*` action. Reach is `REACH + HOST_SLACK` as
in `bees.js:217-225`. Cap `d` at `MAX_TILES` and drop keys that fail `/^-?\d{1,2},-?\d{1,2}$/`.

**Trophy.** The journal lives only in each player's localStorage (`fishing-cooking.js:47,191`, `little-raft-fc-v1`).
Bag `fish` has no species. The host therefore cannot verify a guest's record. Make the trophy a cosmetic mount and not
an item. "Mount best catch" sends `{species, cm}` from the local `journal.entry(id).bestCm`, and the host clamps `cm`
to `speciesById` min/max. Removing the mount costs and refunds nothing. Render it with `createFishModel` (shared
cache, mark it shared or keep it outside the dispose path). Scale it to the stand with `0.3 / userData.length`.

## 5. Co-op and OLD_HOST
The host sends `ext` in every state message (about 8/s, `game.js:1234`). The guest calls `content.load(ext,'net')`
(`game.js:1526`). Copy the bees pattern (`bees.js:167-185`). Skip the load when `r` and `s` are unchanged, and rebuild
slot meshes only when a slot's kind changes. `serialize()` returns a cached copy keyed on `r`. If the slice is
`undefined` from the host, an old host is assumed: `OLD_HOST = 'Your friend’s raft doesn’t have display shelves yet'`
is shown in both prompt and interact, and no action is sent. An old host also has no `shelf` in `DECOR_TYPES`, so it
drops the decor and the bag kind. A guest cannot place one there.

## 6. Removal by the hammer
**There is no decor removal path.** The hammer's X mode removes only building pieces (`building.js:108 removeAction`,
`:114-133 apply`, 'unpiece', "materials back"). No code ever splices `world.decor`. Shelf contents therefore cannot be
lost today. If decor removal is added later, it should go through `display.*` (or a hook the module answers). It
should refund all slots with one scratch bag and **refuse the removal** when they do not all fit ("Empty the shelf
first"). That way the shelf, its contents and the bag change together or not at all. Until then, the orphan rule is
the safety net.

## 7. Save backward compatibility
- Old save: no `ext.display`, so `load(undefined)` gives empty shelves. `cleanExt` keeps unknown slices (`content.js`
  `EXT_MAX` 200k chars). Keep the slice tiny (3 slots × 400 tiles is at most about 40k).
- Old build loading a new save: `cleanWorld` drops `shelf` decor (unknown type), but `ext.display` survives untouched.
  In the new build the contents come back hidden (orphan) until a shelf is placed on that tile again. Displayed items
  are existing kinds, so they load fine. A `shelf` item in a bag is dropped by an old build's `Bag.salvage`
  (`inventory-state.js:214`).

## 8. Risks
(1) Shared geometry or material disposal on `rebuildRaft` (§1). (2) A duplicate fish-model cache from a second import
specifier. (3) Mis-aiming on a rotated or swaying raft: use `matrixWorld`, not `d.x*2`. (4) E priority: pickup and
sail win first, so return false when not aimed. (5) Refuse a stale `expect` and repaint. A trophy `cm` cannot be
verified, so it stays cosmetic.

## 9. Recommendation
Build one content module, `dist/display.js` (pure top half plus module, like bees.js). Add items `shelf` (3 slots) and
`trophystand` (1 slot plus an optional journal mount) in `items.js`. Store `world.ext.display` as above, with atomic
`display.put/take` built from the storage-research copy-then-commit code. Attach the models by scanning `craft_shelf`
and `craft_trophystand` groups, using a module template cache with `userData.shared`. Factory-built models
(`buildItemModel(T, kind, getModel)`) look best. Keep the trophy cosmetic. Add no decor removal in this lane.
