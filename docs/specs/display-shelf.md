# Spec: Display Shelf and Trophy Stand

Source: docs/features/display-shelf-research.md. Cozy rules: purely cosmetic, nothing is ever lost, no damage or hunger.
A Display Shelf shows 3 bag items and a Trophy Stand shows 1. E puts the held item in the aimed slot, and E on a filled slot takes it back.
The stand can also hold a cosmetic trophy of any fish species in the player's journal, with a tiny name plaque.
Logic goes in the new content module `dist/display.js` (pure helpers plus `createDisplay(ctx)`). Models go in the new `dist/display-model.js` (it is given THREE and imports nothing).
New modules are imported with `?build=v3-survival-ae77fa84ac2b`. **No game.js edits.** One builder.

**Correction to the research (verified in this tree):** the prompt path exists. `content.prompt(frameAim)` → `aimHtml` (`game.js:568`) → `promptFromHtml` (`prompts.js:50`) → the providers `game-aim` (priority 2, keyed rows) and `game-aim-status` (priority 0, muted rows) at `game.js:1795-1796`.
So return `<kbd>E</kbd>Label` for an action and plain text for a muted status line. Escape every dynamic name with `ctx.esc`.

## 1. Items and recipes (dist/items.js)
| id | name | category | recipe | unlock | radius |
|---|---|---|---|---|---|
| `shelf` | Display Shelf | decor, `placeable:true` | `hand({wood:4, nail:2})` | `discover('nail')` | `0.45` |
| `trophystand` | Trophy Stand | decor, `placeable:true` | `hand({wood:3, scrap:1})` | `discover('fish')` | `0.25` |
- Add the rows after the `[bees]` candle row (`items.js:185`), with `iconTint` `#b4824b` / `#c9a24a`.
- Tips: shelf "A little shelf for showing off your favourite finds."; stand "A small pedestal for one treasure, or a trophy of your best catch."
- `BLOCK_RADII` (`items.js:221`): add the line `shelf: 0.45, trophystand: 0.25, // [display]`. `DECOR_TYPES`/`BLOCK_RADIUS` pick these up through `PLACEABLE_IDS` (`game.js:64,72`).
- Icons: add inline bodies to `item-svg.js` `ITEM_ICONS` after the `[bees]` block (`:215-262`): a plank shelf with three objects, and a pedestal with a fish. Do not add an `icon` key (same as bees).
- craft-book.js: `:23` categories `shelf:'survival', trophystand:'survival'`, and two `ITEM_TEXT` rows after `:82` ("Shows 3 items; E to put or take."; "Shows 1 item or a fish trophy.").
- Held pose: none (generic fallback).

## 2. State: `world.ext.display`
```js
{ v:1, s:'ab12cd34', r:7,
  d:{ "3,-1":[{kind:'scrap',count:1}, null, {kind:'hook',count:1,durability:64}],   // slot arrays, length 1..3
      "0,2":[{kind:'rope',count:1}] },
  t:{ "1,2":{species:'pomfret', cm:41.2} } }                                         // stand trophies (cosmetic)
```
- `SLOTS = {shelf:3, trophystand:1}`. Every stored item has `count` 1, and a tool keeps its whole slot object (durability, id).
- Keys must match `/^-?\d{1,3},-?\d{1,3}$/` and round-trip through `tileKey`. There are at most `MAX_TILES` (400) keys in `d` and in `t`. Arrays are cut to 3, slots go through `cleanSlot` (`storage-research.js:64`, imported with the same `?build=` specifier as `content.js:27`), and all-null arrays are deleted.
- A stand holds an item **or** a trophy, never both. If junk data has both, keep the item and drop the trophy (dropping the trophy loses nothing).
- **Orphan rule:** data at a key with no matching decor, or slots past the type's count (shelf data under a stand), is **kept, saved and hidden**. It shows again when a matching decor is on that tile. `cleanDisplay` never prunes against decor.
- Trophy: `speciesById(species)` must exist, and `cm` is clamped to `[minCm, maxCm]` and rounded to 0.1.
- Size: 400 × 3 small slots is about 40k chars, inside `EXT_MAX` 200k (`content.js:32`).

## 3. Pure API (dist/display.js; no DOM, Date or random in the helpers)
```js
export const SLOTS, REACH = 2.6, HOST_SLACK = 2, MAX_MODELS = 48, MESH_CAP = 40, TROPHY_LEN = 0.4;
export const OLD_HOST = 'Your friend’s raft doesn’t have display shelves yet';
export const TEXT = {stale:'That spot just changed, try again', full:'Your bag is full', busy:'Something is already there', empty:'Hold an item to display it', fill:'Empty the shelf first'};
export function cleanDisplay(v)                       // -> {v:1,s,r,d,t}; undefined/null/array/string -> defaults; never throws
export function displayAt(decor, x, z)                // -> 'shelf' | 'trophystand' | null
export function put(st, decor, a, bag)                // a = {x,z,i,from,expect:{have:kind, slot:null}}
export function take(st, decor, a, bag)               // a = {x,z,i,expect:{slot:kind} | {trophy:species}}
export function mount(st, decor, a)                   // a = {x,z,species,cm,expect:{trophy:species|null}}
export function refundDisplay(st, key, bag)           // future decor removal (§8)
// each returns {ok:true, text, loot?} | {ok:false, reason:'notarget'|'stale'|'busy'|'full'|'bad', text}
```
- All three are **atomic**. They work on `scratch = new bag.constructor(bag.snapshot())` and a copy of the slot array, check everything, then commit: copy `scratch.slots` into `bag.slots`, `bag.version++`, write the slot, `st.r++`. A failure changes nothing.
- `put` checks: the decor type at the tile, `0 <= i < SLOTS[type]`, the target slot is null and there is no trophy (else `busy`), `from` is an int slot index, and `bag.slots[from]?.kind === expect.have` (else `stale`). It moves 1: a tool's whole slot, or `{kind, count:1}` from a stack.
- `take` checks that the slot kind equals `expect.slot` (else `stale`). Then `moveStack([item], 0, scratch.slots)` (`storage-research.js:151`, which keeps durability and id). If the source is still non-null afterwards, return `full` and leave the item on the shelf. A `{trophy}` expect instead deletes `t[key]`. It refunds nothing: "Trophy taken down. Your journal keeps the record."
- `mount` checks that the type is `trophystand`, slot 0 is empty, the species is valid, and `t[key]?.species ?? null` equals `expect.trophy`. It sets `{species, cm}`. The fish is not consumed and the bag is untouched.
- Texts: put ok `"<Name> on display"`; take ok `"+1 <Name>"` with `loot:{[kind]:1}`; mount ok `"<Species> trophy mounted"`.

## 4. Slot aiming (which slot the crosshair picks)
- The model gives every slot an anchor: an empty `Object3D` named `slot0..slot2` that is a direct child of `craft_shelf` / `craft_trophystand`. Its position is the centre of the slot's top surface.
- `target(aim)`: the ray origin is `ctx.camera.position` and the direction is `aim?.dir` (fallback `camera.getWorldDirection`). For each scanned group whose horizontal distance to `ctx.physics` is `<= REACH`, and each anchor `j < SLOTS[type]`, take `anchor.getWorldPosition(v)`, lift it by `+0.12` (the item's middle) and compute the ray offset as in `bees.js:128-131`.
  Accept `along > 0`, and `off <= 0.24` on a shelf (slots are 0.42 apart, so neighbours never both pass) or `off <= 0.4` on a stand. Score is `off + along*0.05`, lowest wins.
  Returns `{x, z, i, type, key}` or null. Using `matrixWorld` handles `rot` and raft sway. The tile comes from `round(g.position.x/2)`, `round(g.position.z/2)`.
- Groups come from `scanGroups()`, a copy of `bees.js:138-148` that matches both names. It reuses scratch vectors and allocates nothing per frame.
- If nothing is aimed, `prompt` returns null and `interact` returns false, so other E users still work (pickup and sailing already come first, `game.js:955-962`).

## 5. Module `createDisplay(ctx)` (name `'display'`)
- `held()` = `ctx.localBag()?.selected` (a copy) and `from = bag.selectedIndex`. `journal()` = `globalThis.raftFC?.journal` (try/catch). `seen()` = `journal()?.speciesSeen() ?? []`. The fish lane's own module instance is used, and no fish module is imported for data.
- **Prompts** for the aimed slot, in order:
  1. old host → `OLD_HOST` (muted)
  2. item in slot → `<kbd>E</kbd>Take <Name>`
  3. stand with trophy: held `fish` and `seen().length > 1` → `<kbd>E</kbd>Swap trophy: <Next>`; else `<kbd>E</kbd>Take down <Species> trophy`
  4. empty stand, held `fish` or empty hand, and `seen()` not empty → `<kbd>E</kbd>Mount trophy: <Species> · <cm> cm` (the next species is the one after the current trophy in `seen()` order, else the first; cm is `entry(id).bestCm`)
  5. empty slot, held item → `<kbd>E</kbd>Display <Name>`
  6. empty slot, empty hand → `Display shelf: hold an item to show it off` (muted)
- `interact(aim)`: no target → false. Old host → `ctx.notice(OLD_HOST, 2400)`, true. Case 6 → `ctx.notice(TEXT.empty)`, true. Otherwise send the matching action with `expect` built from what was drawn: `display.take {x,z,i,expect:{slot:kind}}` or `{expect:{trophy}}`, `display.mount {x,z,species,cm,expect:{trophy:cur|null}}`, or `display.put {x,z,i,from,expect:{have:kind, slot:null}}`. Return true.
- `action(a, actor, bag)`: claim every `display.*` kind and return true for all of them. Check that `x,z,i` are ints. Reach: `pose = actor === 'guest' ? ctx.other : ctx.physics`, refuse if `hypot(x*2-pose.x, z*2-pose.z) > REACH + HOST_SLACK` (as `bees.js:221`). Call the pure op, then emit to `actor`: put/mount ok `{kind:'build', text, sound:'place'}`; take ok `{kind:'loot', text, loot}` (trophy take-down: `{kind:'notice', text}`); failure `{kind: reason === 'full' ? 'full' : 'notice', text}`.
  A `stale` failure also bumps `st.r` so the guest repaints at once.
- `load(data, from)` / `serialize()`: copy bees exactly (`bees.js:165-185`). On `'net'`, skip when `r` and `s` are unchanged or when it is undefined twice in a row. `hostHasDisplay = data !== undefined`. serialize is cached by `r`. Set `dirty = true` after every load and every successful op.
- `update()`: `scanGroups()`. If the raft changed or `dirty`, run `paint()`. Otherwise do nothing: no per-frame work and no allocation.
- `decorModel(type)`: `shelf` → `createShelf(T)`, `trophystand` → `createTrophyStand(T)`, else null. This also feeds the placement ghost (`game.js:395`) and `rebuildRaft` (`game.js:504`).
- `debug`: `{state, target, slots: () => [...], place(type,x,z), templates: () => cache.size}`.

## 6. Models (dist/display-model.js) and the item template cache
- `createShelf(T)`: Group `craft_shelf`, origin at the floor top, about 1.3 × 0.75 × 0.45. It has two side boards, a top plank at y .62 and a lower plank at .25 (warm wood #b4824b / #906f48), and a tiny rail lip. The static parts are merged into one vertex-coloured mesh (own tiny merge, as bees-model.js). Anchors `slot0..2` sit at x −.42 / 0 / .42, y .66.
- `createTrophyStand(T)`: Group `craft_trophystand`, a 0.4 × 0.7 × 0.4 pedestal with a darker cap. Anchor `slot0` is at y .74. `plaque` is a 0.22 × 0.06 brass plate (#c9a24a) on the front face at y .45, z .205, a direct child. A `peg` (thin cylinder) above the cap is the trophy holder.
- **Templates** (in display.js): `Map<kind, Object3D>` that lives as long as the module. On a miss, `buildItemModel(T, kind, getModel)` (held-items.js and models.js with the same `?build=` specifiers as `hands.js:18` and `game.js:53`).
  Count its meshes. If there are more than `MESH_CAP`, use a shared tinted 0.18 m box (`ITEMS[kind].iconTint`) instead. Wrap it in a Group, scale it so the largest box dimension is 0.30 on a shelf and 0.34 on a stand, and sit it on y 0.
  Then traverse it and set `userData.shared = true` on **every geometry and material**. `disposeGeometry` (`game.js:341`) skips those, so `rebuildRaft` never frees cached buffers.
- Per slot: `template.clone()` (it shares the geometry and materials), named `display_item`, added under the anchor. After a rebuild the clones are gone with the old group, and `paint()` re-attaches them on the next rescan.
- **Trophy fish:** `createFishModel(T, species, {cm, lod:1})` from `'./fish-models.js'` with **no** `?build=`, the same specifier as `fishing-cooking.js:15`, so there is one cache. Traverse it and flag its cached geometry and materials as `shared`. Scale it so the length is `TROPHY_LEN` (`group.scale = TROPHY_LEN / userData.length`) and mount it on its side on the peg, turned 90° and tilted 10°. It is static (no `wiggle`).
- **Plaque:** in a browser only (`typeof document`), a 128×32 `CanvasTexture` with `"<Species> · <cm> cm"` (dark serif on brass) on a front plane. The material is cached by text (at most 24 entries, oldest disposed first) and marked shared. Without a canvas, the brass plate stays blank.
- **Budget:** at most `MAX_MODELS` (48) slot models are attached. On each paint, groups are ordered by distance to the player, and slots past the budget stay empty (the prompt still works). Every item is at most 40 meshes, so the worst case is about 2k meshes, and usually far fewer.
- `dispose()`: detach all clones and clear the maps. Do not dispose shared templates that came from models.js or fish-models.js. Dispose plaque textures.

## 7. Co-op and OLD_HOST
- Host-authoritative. A guest's E sends `display.*` through `ctx.action`. The host validates it against the guest's bag (`actor === 'guest'`), and the guest's bag comes back in the state message. `ext.display` arrives through `content.load(w.ext,'net')` (`game.js:1528`).
- `expect` makes stale clicks safe. For example, if both players take the same slot, the second one gets `stale` and nothing is duplicated.
- **OLD_HOST:** a new guest on an old host gets `ext.display === undefined`. Prompts show `OLD_HOST`, no action is ever sent, and shelves are painted empty. An old host drops the decor anyway.
- An old guest on a new host skips the unknown decor and the slice. The guest's journal stays local, which is why trophies are cosmetic copies whose `cm` is clamped but not verified. Mixed-version co-op is unsupported; mention it in the PR.

## 8. Save compatibility and the future-removal refund rule
- An old save has no slice, so `cleanDisplay(undefined)` gives empty defaults. New kinds and decor are additive.
- An old build loading a new save drops the shelf and stand decor and the bag kinds. `ext.display` survives through `cleanExt`. Displayed items are existing kinds, and they come back hidden (orphan rule) until a shelf is placed on that tile again.
- **Refund rule:** decor cannot be removed today (the hammer removes only pieces, `building.js:108`). Any future decor removal must call `refundDisplay(st, key, bag)` in the **same host action**. It puts every stored slot (including orphan slots past the type count) into one scratch bag. If all of them fit, it commits, deletes `d[key]` and `t[key]`, and returns ok. Otherwise it returns `{ok:false, reason:'full', text:TEXT.fill}`, and the removal must be refused. Trophies refund nothing. Ship and test the helper now, but do not wire it up.

## 9. Hook lines
- `dist/items.js:185` two rows, `:221` radii. `dist/content.js:29` `import { createDisplay } from './display.js?build=v3-survival-ae77fa84ac2b'; // [display]`, `:31` append `createDisplay` to `FEATURES`.
- `dist/craft-book.js:23`, `:82`. `dist/item-svg.js` after `:262`, two icons. All hooks are tagged `[display]`.
- New files: `dist/display.js`, `dist/display-model.js`, `tests/display.test.mjs`.

## 10. tests/display.test.mjs (node:test, `RAFT_DIST` base, `bagWith` as in `bees.test.mjs:15-19`)
1. `cleanDisplay`: undefined, null, array or string gives defaults. Bad keys, over-long arrays and bad slots are dropped or cut. Stack counts are forced to 1. Orphan keys (no decor) are **kept**. A bad species or out-of-range `cm` is dropped or clamped. Item plus trophy on one key keeps the item.
2. `put`: the stack goes down by 1 and the slot is filled. A tool keeps durability. A filled slot gives `busy`. A wrong `expect.have` gives `stale`. `i >= SLOTS[type]` and a non-display tile give `notarget`. Every failure leaves the bag snapshot and state `deepEqual` to before.
3. `take`: the item goes back, and tool durability survives a put/take round trip. A full bag gives `full` with the item still on the shelf and the bag unchanged. A wrong `expect.slot` gives `stale`.
4. `mount`/take-down: valid species and `cm` clamping; refused when the stand holds an item, on a shelf, or with a stale `expect.trophy`; the bag is untouched both ways.
5. `refundDisplay`: all slots fit → bag gains them and the key is gone; does not fit → `fill`, nothing changes.
6. Module (stub ctx): every `display.*` returns true; out-of-reach or non-int actions change nothing; `load(same,'net')` twice keeps identity; `load(undefined,'net')` gives `OLD_HOST` from `prompt` and `interact` sends no action; `serialize` is cached by `r`.
7. Aiming with the vendored THREE: a shelf at a rotated `rot` under a moved raft, the camera aimed at each anchor picks `i` 0, 1, 2, and an aim 0.5 m to the side picks null.
8. Templates: two slots of one kind share geometry; after a `disposeGeometry` copy (it skips `userData.shared`) the template geometry is not disposed; a fish trophy's geometry is flagged shared; at most `MAX_MODELS` `display_item` nodes are attached for 30 full shelves.
9. Models: `createShelf` has direct children `slot0..2`, `createTrophyStand` has `slot0` and `plaque`; sizes fit 1.4 × 0.8 × 0.5. items: both craft from their costs; `new Bag` accepts both kinds.
Run `npm test` and shoot.py. The `errors` list must be empty.

## Build notes
- **Files.** New: `dist/display.js` (pure helpers + `createDisplay`), `dist/display-model.js` (`createShelf`, `createTrophyStand`), `tests/display.test.mjs` (12 tests). Hooks, all tagged `[display]`: two rows + a `BLOCK_RADII` line in `items.js`, the import and `FEATURES.push(createDisplay)` in `content.js` (pushed last, after the fish trap, so it never shadows another module's E), categories + two `ITEM_TEXT` rows in `craft-book.js`, two inline icons in `item-svg.js` after the `[bees]` block. No game.js edits.
- **Pure API as specified**, plus `cleanTrophy`, `tileKey`, `nameOf`, `MAX_TILES`, `TROPHY_DOWN` and two extra `TEXT` keys (`notarget`, `bad`) so every failure has a text. `put`/`take`/`refundDisplay` all work on `new bag.constructor(bag.snapshot())` and commit slots + `bag.version++` + `st.r++` together; tests check every failure leaves the bag snapshot and state byte-equal. Names come from `ITEM_INFO`, so wood reads "Plank" (its bag name).
- **Models.** Shelf 1.3 × 0.78 × 0.45 (books and a jar on the lower plank so an empty shelf looks dressed), anchors `slot0..2` at x −.42/0/.42, y .66. Stand: 0.4 column with 0.44 plinth/cap, top .74, brass `plaque` at y .45 z .205, `peg` 0.05 tall and hidden unless a trophy is mounted (keeps the model under 0.8 m tall).
- **Templates.** `Map<kind>` normalised to 0.30 m (×0.34/0.30 on a stand). A model much taller than wide (hammer, rod) is laid on its side. Every template and trophy-fish geometry/material gets `userData.shared = true`; the test runs a copy of game.js `disposeGeometry` and checks no template geometry is disposed. Per-anchor `userData.dispKind` / per-group `dispTrophy` mean a repaint only touches slots whose content changed; after `rebuildRaft` the fresh groups have no marks, so the next scan re-attaches everything.
- **Repaint triggers.** `update()` repaints only when `scanGroups()` sees a raft change or `dirty` is set (any load that changed state, any successful op, a stale bump). A guest's unchanged `'net'` load returns before setting `dirty`, so the 8 Hz state stream costs nothing.
- **Plaque** text: 128×32 canvas, "Salmon · 65 cm", auto-shrinking font, material cache of 24 (oldest disposed).
- **debug.slots()** also returns `at` (world position of each slot's aim point) for QA scripts.
- **QA.** `npm test`: 601/601 pass (art.test's atlas timing check flaked once under parallel load and passed on rerun). `shoot.py` reported `errors: []`. Close-up script `scratchpad/r2/display/display_shot.py` places a shelf and a stand, walks into reach and uses the real E path: hammer, plank and cup into slots 0–2 ("E Display Hammer/Plank/Cup"), `raftFC.forceCatch('salmon')`, then an empty-hand E on the stand ("E Mount trophy: Salmon · 65 cm"). `#lrPrompt` showed an E row at every step.
- **Mixed-version co-op is unsupported** (an old guest drops the decor and the slice; trophies are cosmetic copies from each player's local journal). Mention it in the PR.
