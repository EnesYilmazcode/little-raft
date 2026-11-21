# Treasure research: metal detector, shovel, buried chests on islands

Research for round feature (1). Line numbers: branch `claude/loop-features-202611210703` @ `abf9a77`.

## (a) Genre patterns

What sandbox and survival games usually do with a detector, a shovel and buried loot:

- **Detector as a held tool.** Beep rate (sometimes pitch) rises near a hidden spot, ending in a
  steady tone or "lock" chime on top of it; some add a needle or LEDs. Short range (5-15 m), a
  forward cone or a plain radius (friendlier).
- **Shovel as a second tool.** Dig at the spot (click/hold): a hole, then a chest pops up with loot.
  Empty digs give nothing or sand. Shovels wear like other tools.
- **Spots are seeded per island or chunk**: 1-3 on dry sand, clear of trees/rocks; loot table plus a rare pool.
- **Respawn rules.** Either the spots are found once per island seed (a "dug" flag is saved), or new
  ones show up when a new island arrives. Islands here are temporary (they dock about 3 min and then
  sink), so a spot belongs to the visiting island and is gone when the island leaves.
- **Co-op.** The server owns spots and "dug" flags, beeps are client-side, and the digger gets the loot.

### Original cozy take for Little Raft ("Sandy Secrets")

- **Seashell Finder** (detector): a small driftwood wand with a brass coil and a glass bead that
  glows warmer as you get close. It never wears out, like the binoculars. It goes *tik… tik.. tik.
  tiktik* and plays a soft marimba chime when you are within about 1 m. A HUD line like the
  binoculars one reads "Something sparkly, close by" or "Warm… warmer…". No numbers.
- **Little Spade** (shovel): a wooden spade. You dig by pressing E on sand while holding it. One dig
  takes about 0.6 s with a little sand puff. Digging on empty sand gives 1 sand (so it is never
  wasted) and wears the spade a little. Durability is about 60 digs, with a repair cost.
- **Buried bundles, not "treasure chests"**: a little tied crate or a bottle of keepsakes. They hold
  mid-game materials (copper ore, metal ore, glass, rope, nails) plus a small chance of a keepsake
  decor item (shell wind-chime, glass float). No combat, no traps, no "empty chest" trolling.
- **One to two spots per island**, seeded from the island seed, placed on dry sand away from nodes.
  They are dug once per visit, and the whole spot goes away when the island leaves (the island seed
  changes). For later: "Finds" could feed the logbook or achievements, and the map table (feature 3)
  could mark islands that still have a spot.

## (b) Code anchors

**Islands (all in a content module, no game.js edits).**
- `dist/islands.js:37` `createIslands(ctx)`. State `st = {v, clock, next, isl}` (:39), where
  `isl = {seed, born, dock, side, off, used[]}`. `spawn()` :185 picks a random u32 seed (debug
  `spawnNear(seed)` :411). Despawn: `update` :217 sets `st.isl = null` when `pathAt` reports
  `'gone'`, then `nextDelay(seed)`. The warning goes out at :224.
- Island centre: `cx = side*off`, `cz = pathAt(clock-born, dock, layout.dockZ).z` (:308, the same
  in `action`). `groundAt(x,z)` :178 gives world y of the sand or NaN, and `standOnSand` runs at
  :263. `sandState.onSand` is local only and exposed by `debug.state()` :449.
- Save and net: `serialize` :266 (cached objects, cheap at 8 Hz), `load(data, from)` :280 (guest
  slews the clock, rebuilds only when the seed changes :289). Host action `islands.gather` :301 uses
  `pos = actor==='guest' ? ctx.other : ctx.physics` (:304) for the reach check.
- Prompt and E: `prompt(aim)` :383, `interact(aim)` :392, which returns false when no node is under
  the crosshair.
- Pure logic in `dist/islands-layout.js`: `ISLAND` constants :5 (REACH 3.5, DOCK 180,
  GUEST_SLACK), `rng(seed)` :33, `hash3` :44, `groundHeight`/`SHORE_U` :55/:69. `layoutFor(seed)`
  :78 gives frozen `{seed, R, rot, dockZ, gap, nodes[]}` with nodes within 0.7 R on dry sand.
  `clean` :163, `lootFor` :184, `applyGather` :194 (scratch-bag "all or nothing" add pattern,
  per-actor cooldown), `standOnSand` :227.
- `dist/islands-models.js`: cached geometries/materials built once per game (copy for a mound mesh).
- **Spot placement:** derive spots from `rng(seed ^ CONST)` in a new module. Do not add draws inside
  `layoutFor`, because that changes node layouts for existing seeds and breaks
  `tests/islands.test.mjs`. Keep spots at least 1.2 m from `layout.nodes` and at u <= 0.65.
- **No cross-module API:** the content registry (`dist/content.js:37`) gives modules only `ctx`.
  A treasure module cannot see the islands instance. Options: (1) put the treasure code inside
  `islands.js` (it already owns seed, centre, ground, save); (2) have `islands.js` export a small
  read-only accessor (`islandNow()` returning `{seed, cx, cz, gy, R, phase, layout}`) that a
  sibling `treasure.js` imports; (3) read `raftDebug.content.islands.phase()` (debug only, so not
  recommended). Option 2 keeps the files apart without a game.js edit. The new module is appended to
  `FEATURES` at `content.js:30` and should come after islands so it runs after islands' update.

**Item and recipe systems: use `dist/items.js` for both tools.**
- `dist/items.js` is the single catalogue. `item(id,name,category,opts)` :62, tools at :128-146.
  A tool with `tool:true` needs `durability` (uses), a `REPAIRS` entry (:200) and a `tip` longer than
  10 chars. A placeholder `icon-<id>` needs a drawing in `dist/item-svg.js` `ITEM_ICONS` :10. All of
  this is enforced by `tests/progression.test.mjs:100-160`, and :198 fails on unreachable items.
  `wearPerUse(kind)` :338 is 100/durability, and `toolRole` :344 reads `actsAs`, which only allows
  hook, fishingrod or hammer (test :120). The detector can copy binoculars (:143: `stack:1`,
  `tool:false`, never wears). The spade is `tool:true, durability:~60`.
- `dist/inventory-state.js`: `ITEM_INFO` :17 merges legacy rows, then `CONTENT_ITEMS` :33, then
  `infoTable()` :49 (items.js wins). `RECIPES` :66 merges the same way (`recipeTable()` :83).
  **`TOOL_KINDS` :12 is `hook/hammer/fishingrod + TOOL_IDS` from items.js**, so a content-items.js
  "tool" would get no durability. That is why the spade has to live in items.js.
- The crafting UI (`dist/survival-ui.js:127`) lists every `RECIPES` entry and the hotbar reads
  `ITEM_INFO`. The progression gate `recipeGate` (`progression-hooks.js:231`) only gates ITEMS ids
  and hides recipes that are far from unlocking. The host craft check is at `game.js:822`
  (`prog.apply`), then `content.craftLocked` :829. Suggested unlocks: spade
  `hand({wood:3, scrap:2})`, `discover('sand')`. Finder `hand({copperingot:1, glass:1, wood:2})`,
  `research('copperingot')`, or `discover('stone','scrap')` if it should come earlier, so treasure
  is not locked behind a 100-minute research path.
- Wear: game.js only wears hooks (`:816`, `wearPerUse`). The module must wear the spade itself in
  its host `action`: `slot.durability = Math.max(0, d - wearPerUse('spade'))`. **R repair only works
  on hooks**: `game.js:902` uses `repairHookSlot` (`coop-rules.js:55`, `kind === 'hook'`). Either
  keep the spade usable at 0% (slower dig plus a notice) or handle repair in the module.

**Held viewmodels.**
- `dist/hands.js:22` `createHands(T,{modelFactory})`. `game.js:433` passes `modelOf`, which calls
  `models.js:624 getModel`, and `:1104` calls `hands.setHeld(kind)`. `setPose('grip'|'point'…)`.
- `dist/held-items.js:135` `buildItemModel`: tools in `TOOL_KINDS` (:21) get their own model
  (`createHammer` :154). Others use the factory or a generic bundle (binoculars has no model today).
  Add `HOLD.spade`/`HOLD.finder` (:23) and a builder in the style of `dist/hammer.js:13` (procedural
  root re-centred on its bounds, `userData.grip`, about 7 meshes, deterministic). A dig animation
  could reuse game.js's `swing` (cast pose), which a content module cannot set; the fallback is
  bobbing `hands.itemModel('spade')`. The co-op friend shows `other.held` (`coop-avatar.js:172`), so
  it needs a model there too (or it falls back to a bundle).

**Audio.**
- `dist/audio.js:476` `play(event, strength)` only plays fixed recipes (`EVENTS` :21, per-event
  `MIN_GAP` :29). `tone(v,t,type,freq,peak,attack,decay,toFreq)` :217 is the building block, and
  `ui` :376 is a 1250 Hz tick that works as a beep. For a pitch that climbs, add a `detect` recipe
  that takes strength as closeness (frequency e.g. `700 + 500*s`) plus a `chime`, and add both to
  `EVENTS`/`MIN_GAP`. **Content ctx has no audio** (`game.js:364-371`). Add one getter
  `play:(ev,s)=>play(ev,s)` (one-line content hook), or as a hack use
  `ctx.emit({kind:'x', sound:'ui'}, ...)`. `effect()` :772 plays `e.sound`, but `emit` to
  host/all also goes over the network, which would beep on the other machine. Beeps must stay local
  and be scheduled from `update(dt)` with an accumulator (no timers).

**Prompts and HUD.**
- `game.js:942`: `content.interact(currentAim())` runs before `prog.interact` and before the
  inventory opens. Digging is E, because content has no LMB hook (`useSelected` :950). Content
  `prompt()` feeds `#contextPrompt` (:560), which prompts.css hides. Also register
  `window.raftPrompts.provide({id:'treasure', priority:1, prompt})` (`dist/prompts.js:192`;
  `pickPrompt` :31 means higher priority wins). Return null when `ctx.state.pickup` is set or a
  gather or connecting prompt applies, and unregister in `dispose`. No module uses `provide` yet.
- Detector HUD: copy the binoculars HUD (`progression-hooks.js:239-262`; fixed div, set text on change).

**Co-op.**
- The host is authoritative: guest E calls `ctx.action({kind:'treasure.dig', seed, spot})`. The host
  checks the island seed, spot index, reach (`ctx.other` for the guest plus `GUEST_SLACK`), spade in
  the bag and cooldown, then adds loot with the scratch-bag pattern (`islands-layout.js:213`) and
  sends `ctx.emit({kind:'loot', text, loot}, actor)`. Mark `dug[spot]` in `world.ext.treasure =
  {v:1, seed, dug:[0,1]}`. A guest `load(...,'net')` compares seed and dug and only touches meshes
  on a change. Detector proximity is computed locally from the seeded layout, so nothing extra is
  sent over the network.

## (c) Risks

1. **Coupling to islands.** Without an accessor export, a second module duplicates the centre and
   ground math (`pathAt`, `groundAt`), which drifts from the real island. Keep it to one accessor in
   islands.js, or put the feature inside islands.js (already 455 lines).
2. **Seed reuse.** Changing `layoutFor` RNG draws reshapes every island. Use a separate rng stream.
3. **Item catalogue tests.** New items.js entries need a tip, an icon in item-svg, repair, a
   reachable unlock (all tested), plus a `craft-book.js` category (:20) and description.
4. **Save compatibility.** New kinds in a bag are fine for new builds, but old builds drop the bag
   (content-items.js header). `load(undefined)` must give `{seed:null, dug:[]}`, and a stale seed
   resets.
5. **No audio or LMB in content ctx**, and the content prompt is invisible: needs small game.js
   edits plus a raftPrompts provider. `play` returns false at volume 0, which is fine.
6. **Departure.** The island sinks while someone may be digging, so the host rejects a stale seed
   (reply "The island drifted off"). Dug holes have to go away with the island group.
7. **Pacing.** Treasure should not outpace barrels (`items.js` economy header, `BARREL_PITY`). Keep
   one or two spots per island at about every 4 to 6 min, small loot.
8. **Guest reach.** The host sees the guest pose about 0.12 s late. Use `ISLAND.GUEST_SLACK`.
