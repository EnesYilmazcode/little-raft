# Fish Trap: research notes

Passive fishing: a woven trap hangs off a raft edge tile, optionally baited, and every few minutes
catches a fish from the existing species table. E collects it. Line numbers are for the current branch.

## 1. Species, catch rules, bag and journal
- `dist/fish-species.js:26-51` SPECIES (8: pomfret, herring, tilapia, mackerel, catfish, salmon, tuna,
  sunscale), RARITY weights 60/28/10/2 (`:16`). `rollCatch(rand, {charge, night})` (`:78-87`) is pure with
  injected rand and returns `{species, cm, stars}`. `charge` 0..1 multiplies rare/legendary weight by
  `1 + .5*charge` (`:65`); time mismatch x0.3 (`:66`). Reuse this directly, do not write a new table.
- `night` is always `false` today (`fishing-cooking.js:261,448`). daynight exposes only `wind`/`rain`
  getters (`daynight.js:654`); `content.js:183` shows how to read a sibling module (`rain()`).
- Rod catch path (client side): `fishing-cooking.js:275-296 onCatch` calls `journal.recordCatch(c)`
  (local, `fish-journal.js:46-54`, also puts a raw fish in the basket, BASKET_MAX 40), then
  `host.action({kind:'fish'})`. Host `game.js:913-917` requires a fishingrod, does `bag.add('fish',1)`,
  `world.fish++`, emits `{kind:'loot', loot:{fish:1}}`, `award({kind:'fish'})`.
- The journal is per player in localStorage `little-raft-fc-v1` (`fishing-cooking.js:17,189-192`), saved
  every 3 s when `dirty` (`:424-425`). The fc api exposes `journal` and `save` (`:456-462`) but content
  modules cannot reach `fc`: ctx has no journal getter (`game.js:368-376`).
- Bait: **no bait item exists** (grep `bait`/`lure` finds nothing). Candidates already in the bag:
  `seaweed` (barrel material, `items.js:97`), `leaf`, `honey`. Seaweed is the friendliest fit.

## 2. Decor / placeables
- Item: add `item('fishtrap', 'Fish Trap', 'decor', {placeable:true, iconTint, recipe:hand({...}),
  unlock:discover(...), tip})` in `items.js` next to the `[bees]` block (`:176-185`); radius in
  `BLOCK_RADII` (`:218-222`). `PLACEABLE_IDS` (`:215`) feeds `DECOR_TYPES` automatically (`game.js:63`)
  and `BLOCK_RADII` feeds `BLOCK_RADIUS` (`game.js:71`). ITEM_INFO picks items.js entries up.
  Also touched for bees: `craft-book.js:23,78-79` (tab + desc), `item-svg.js:215+` (icon).
- Decor is ONE per integer tile: `{type, x, z, rot?}` with x,z tile cells (`build-rules.js:29-34`
  decorBlock, `game.js:171-177` cleanWorld, `game.js:885-892` build action). `placement.js` metre
  footprints are only used for ghosts/rotation (`game.js:51`); `normaliseDecor` is unused there.
- **No edge rule exists.** The net ("place near the edge") and sails sit on any tile; the net only
  scoops items near it (`game.js:1261`, `coop-rules.js:16`). Edge validation would need hooks at
  `game.js:749` (placementFor), `:758` (placementCandidates) and `:885` (build action).
- Model: `rebuildRaft()` puts content models at `(d.x*2, .22, d.z*2)` with `rotation.y = d.rot`
  (`game.js:502-503`) via `content.decorModel(type)` - type only, not the entry, so the model cannot
  know its open side at build time. Bees name their root `craft_beehive` and re-find groups with a cheap
  scan of `raft.children` (`bees.js:138-149`); the trap can do the same and offset an inner child
  toward the open side (or use `d.rot` when that side is open).

## 3. Content module pattern (bees.js as template)
- Register: import + append to FEATURES (`content.js:151-153`). Hooks: serialize/load/update/prompt/
  interact/action/decorModel/debug/dispose (`content.js:129-141`).
- Pure top half exported for tests: `cleanBees(v, decor)` (`bees.js:26-43`), `tickBees` integer-second
  host tick clamped to MAX_TICK (`:53-75`), atomic `harvest` via scratch Bag copy (`:85-98`).
- Host tick in `update(dt)`: paint always, tick only when `ctx.running && role !== 'guest'`, 1 Hz clock
  (`:191-200`). Notice on full via `ctx.emit({kind:'notice'}, 'all')`.
- Target: view-ray vs decor within REACH 2.6 m (`:116-136`). For a trap, aim at the overhang point
  (tile centre + 1.1 m toward water, y about deck - .1), not the tile centre.
- Action: `interact` -> `ctx.action({kind:'bees.harvest', x, z})`; host `action(a, actor, bag)` checks
  prefix, ints, pose reach (`ctx.other` for the guest, REACH + HOST_SLACK), emits loot/full (`:217-226`).

## 4. Prompts (important)
- `promptFromHtml` and a `game-aim` provider **do not exist** in this tree (grep: no hits).
- `content.prompt(aim)` HTML goes to `#contextPrompt` (`game.js:566,573`), but `prompts.css:2` hides
  it (`display:none!important`). prompts.js only feeds non-`<kbd>` text to the bottom-left feed
  (`prompts.js:41-45,108-115`). So bees' `<kbd>E</kbd>Collect` line is invisible, and its changing
  "Bees are busy… N%" text is pushed into the feed on every change.
- Working pattern: `window.raftPrompts.provide({id, priority:1, prompt})` returning
  `{key:'E', label}` (`prompts.js:192`, used by `instruments.js:183-193`, unregister in dispose).
  Step aside when `state.pickup`, `state.swimming` or guest not ready (`instruments.js:186`).
- Note `content.prompt` non-null also blocks the fc grill prompt (`game.js:566-567` order).

## 5. Co-op, OLD_HOST, saves
- Host saves `world.ext = content.serialize()` (`game.js:1043`) and sends `ext` ~8/s in every state
  (`game.js:1234`); guest `content.load(ext, 'net')` (`:1526`), restore (`:1440`). Bees cache
  serialize by revision `r` + session `s`, and skip unchanged net loads (`bees.js:167-185`).
- OLD_HOST: if the host's ext has no slice (`data === undefined` on net) the host build predates the
  feature: prompt/interact show a friendly line and never send the action (`bees.js:9,112,171,203,211`).
- Guest journal: `emit(e, 'guest')` sends `{type:'effect', e}` and the guest runs `effect(e)`
  (`game.js:773-785`): loot rows/notice only. A catch needs a new small hook there to record
  `{species, cm, stars}` in the collector's journal.
- Back-compat: old save -> `load(undefined)` -> defaults (`content-hooks.md`). cleanExt caps 200k chars
  (`content.js:154-159`). Old builds drop unknown decor types and reject unknown bag kinds (fresh bag,
  `content-items.js:4`) - same accepted risk as bees.

## 6. Proposed state shape
`world.ext.fishtrap = {v:1, s:session, r:rev, seed:uint32, t:{"x,z": {f:[{sp,cm,st}...], w:secs, b:bait}}}`
- `f` caught fish waiting (cap 3, like COMB_MAX), `w` progress seconds, `b` bait charges left (0..5).
- CATCH_SEC 240 unbaited / 150 baited; bait also passes `charge:.8` to rollCatch (else .3).
- Deterministic host RNG: mulberry32 from `seed`, stepped only on the host; tests stay reproducible.
- cleanTrap prunes keys without a `fishtrap` decor, clamps ints, validates species via `speciesById`
  and cm via species range (like `fishing-cooking.js:33-37 cleanFish`).
- Actions: `trap.collect {x,z}` (all fish or none fit: `bag.add('fish', n)` on scratch bag, then
  emit `{kind:'loot', loot:{fish:n}, trapFish:[...]}`), `trap.bait {x,z}` (remove 1 seaweed, b += 5).

## 7. Risks
1. Prompt visibility (section 4): must use raftPrompts.provide, or the trap is undiscoverable.
2. Journal is local and outside the content ctx: needs a ctx getter or an fc api like
   `recordCatch(c)` that also sets `dirty` (calling `fc.journal.recordCatch` alone skips the save flag).
3. Edge rule needs game.js placement hooks; without them, a trap on an inner tile (or a tile later
   surrounded by new floor) must simply idle with a "needs open water" prompt. Prefer idle-not-delete.
4. The `fish` action needs a fishingrod (`game.js:914`); the trap must add fish itself in its action.
   `award({kind:'fish'})` is not in ctx, so trap catches do not count toward fish achievements.
5. Basket full (40): recordCatch returns `basketed:false`; bag fish still arrive, show the soft toast.
6. Overhang mesh below deck height moves with the raft group; check it does not clip `createRaftMesh`
   edges and that diving/swimming collision ignores it (BLOCK_RADII small, e.g. .2).

## 8. Recommendation
New `dist/fish-trap.js` content module (pure top half + module) and `dist/fish-trap-model.js`,
cloned from bees: item in `items.js` (wood 3, rope 4, leaf 2; `discover('fish')`), craft-book + icon.
Edge-only placement via three one-line hooks (`game.js:749,758,885`) using a pure `isEdgeTile(tiles,x,z)`
exported from the module, plus idle when no longer on an edge. Bait = seaweed. Prompt via
`raftPrompts.provide` (keep `prompt()` kbd-only so nothing spams the feed). Journal via one
`effect()` hook (`game.js:777`) calling a new `fc.recordCatch(c)`. Tests `tests/fish-trap.test.mjs` in
the bees style: clean junk, tick timing/cap/bait, deterministic seed, atomic collect, action reach +
OLD_HOST, model name/size, item recipe + bag round-trip, edge rule.
