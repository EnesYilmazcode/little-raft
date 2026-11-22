# Aquarium: research

A glass fish tank decor (`aquarium`, recipe glass + wood). E while holding a raw `fish` puts a live fish in (max 4).
E with an empty hand lets one go back, and it returns as a `fish` item. Fish swim slowly using the species models.
Line numbers are from branch `claude/loop-features-202611211004`.

## 1. Species and models
- `fish-species.js:26` `SPECIES` has 8 frozen entries: pomfret, herring, tilapia, mackerel, catfish, salmon, tuna, sunscale.
  Each entry has `{id,name,rarity,minCm,maxCm,look}`. `speciesById(id)` (`:59`) returns null for junk. `starsFor` is at `:72`.
- `fish-models.js:490` `createFishModel(T, id, {cm, state:'raw', lod})` builds the nose at +X with length = cm/100 m.
  `userData.tail` is the wag pivot. Geometry is cached per (species, lod, state) (`:62`) and materials module-wide (`:63`).
  `userData.dispose()` only detaches the model (`:523`). `wiggle(g, t, amt)` (`:543`) only touches the tail and body
  rotation.y, and it carries its own random phase per model (`:525`), so fish in a tank wag out of step. lod 1 is under
  600 tris. Use lod 0 for tank fish (4 x N tanks).
- **The `?build=` rule has changed.** Older research said "import fish-models without ?build=", but that is now wrong.
  `tests/live-preload.test.mjs:47-52` requires every static import in game.js' graph to use
  `./x.js?build=v3-survival-ae77fa84ac2b`. display.js:9 and fishing-cooking.js:16 both do this, so there is one
  module instance and one cache. The new module must use the same specifier.
- `fish-journal.js` holds per-player LOCAL data (localStorage `little-raft-fc-v1`, `fishing-cooking.js:18,195`).
  It provides `speciesSeen()` (`:83`), `entry(id).bestCm` (`:84`) and `basket[{species,cm,stars,state}]` (`:10`).
  You can reach it at runtime through `globalThis.raftFC.journal`, which display.js:190-195 reads defensively.

## 2. Bag fish carry NO species (confirmed)
- A bag slot is `{kind,count,durability?,id?}` (`inventory-state.js:121-125`), so there is no free metadata.
  `fish` (`inventory-state.js:23`, `items.js:118`) and `cookedfish` (`items.js:211`) are the only fish kinds.
  `rawfish`/`raw_fish`/`grilled_fish` are only aliases (`items.js:404-405`). There are no per-species kinds.
- Catches: `game.js:1346-1350` adds a plain `fish`. The species goes only to the local journal basket
  (`fishing-cooking.js:290`). The fish trap adds plain `fish` too (`fish-trap.js:141`). The link between the two is
  loose: `fc:cook` removes one bag `fish` if there is one (`fishing-cooking.js:159`).
- **Species rule (recommended):** the client picks the species and puts it in the action, and the host validates it
  with `speciesById` and clamps cm (copy `display.js:31 cleanTrophy`). Pick order: the newest raw basket fish, then
  the `speciesSeen()` entry after the species last added, then `'pomfret'`. Take cm from that basket item, or from
  `entry(id).bestCm` / `minCm`. Do **not** touch the journal basket (it is local and the host cannot see it). The
  aquarium consumes one bag `fish` and releases one bag `fish`, so the counts always balance and nothing is duped
  (cosmetic, the same model as the trophy at `display.js:148-157`).

## 3. Display shelf: what to copy (dist/display.js)
- Pure top half: `cleanDisplay` (`:40`) validates, keeps orphans, uses `MAX_TILES`, KEY_RE `:20`. The rest are
  atomic `put`/`take` on a scratch Bag (`:85-136`, `commit` `:79`), the `expect` stale guards (`:92-94,:128`)
  and `fail(reason)`.
- Module: `scanGroups` (`:196`) finds `g.name === 'craft_shelf'` children of `ctx.raft` and rescans when the child
  count or first child changes. `target(aim)` (`:213`) is a ray-to-anchor test, REACH 2.6. `plan(t)` (`:400`)
  returns `{html, act|notice}` and is shared by `prompt` and `interact`. `action` (`:430`) checks the
  `display.` prefix and reach against `ctx.other` (guest) or `ctx.physics` with HOST_SLACK 2, then emits
  `loot`/`build`/`notice`. A stale result bumps `st.r`.
- **Disposal trap:** `rebuildRaft` (`game.js:648-650`) runs `disposeGeometry` (`game.js:417`) on every raft child.
  It skips only geometry and materials with `userData.shared`. Fish-model geometry and materials come from the
  cache without the flag, so call `markShared(fish)` (`display.js:169`, used at `:331`) on every tank fish, or the
  shared cache gets disposed on each build. Tank glass and frame from your own model file can stay unflagged
  (fresh per build).
- Net and save: `load` (`:375`) ignores 'net' data whose `r`/`s` are unchanged. `data===undefined` from 'net'
  means an old host (`hostHasDisplay=false`). `serialize` (`:390`) is cached by `st.r`. The session id is `:176`.

## 4. Decor/content module pattern
- Item: add `item('aquarium','Fish Tank','decor',{placeable:true, iconTint, recipe:hand({glass:4, wood:4, nail:2}),
  unlock:research('glass','nail'), tip})` to `items.js` LIST (`:80`, near shelf `:275` / photoframe `:283`). Use
  items.js and not content-items.js: `PLACEABLE_IDS` (`:338`) feeds `game.js:86 DECOR_TYPES` and `BLOCK_RADII`
  (`items.js:341`) feeds `game.js:96`. Add `aquarium: 0.4`. content-items.js `CONTENT_DECOR`/`CONTENT_BLOCK_RADIUS`
  (`:134-135`) is the older kiln-era path, and newer decor (juicer, shelf, fishtrap) uses items.js.
- Glass: one kind, `glass`, from the Seaside Kiln (`kiln-core.js:8`, sand x2 -> glass, 12 s) and also the smelter
  (`items.js:146`). The photo frame recipe at `items.js:283` (`research('glass','nail')`) is the precedent.
- Also add: an SVG icon in `item-svg.js` (shelf at `:486-498`), `craft-book.js` category (`:27`) and ITEM_TEXT
  (`:171`). Several tests iterate ITEM_ICONS/ITEM_TEXT (axe, camera, craft-* tests).
- Module: `dist/aquarium.js` (logic) + `dist/aquarium-model.js` (tank). Import with `?build=` in content.js next to
  `:83` and append `createAquarium` to FEATURES (`:95`) **before `createCookpot`**. Cookpot stays last by
  convention (comment on `:95`; no test enforces it). Add both files to `live.js` PRELOAD (`:16-36`), or
  live-preload.test fails. The model group name is `craft_aquarium`, with fish anchors as named children. `decorModel(type)` is reached via
  `game.js:654` (prog.modelFor -> createCraft -> content.decorModel), so the type must be unknown to the first two (it is).
- Undecor: implement `undecorLoot(d)` -> `[['fish', n]]` and `afterUndecor(d)` (delete key, `r++`), like
  `bees.js:211-212`. Do not add the type to `content.js:98 NO_UNDECOR`. `game.js:1324-1329` already checks that the loot fits the bag.

## 5. Prompt / E path
- `game.js:786`: while holding raw `fish` (edible) the eat tip "LMB Eat" wins **unless** the content prompt starts
  with `<kbd>E</kbd>`, so every aquarium prompt must start with `<kbd>E</kbd>`. `game.js:789` handles the normal path.
  `promptParts` is at `content.js:109`.
- E: `game.js:1435 content.interact(currentAim())` runs after pickups, sails, nets, watering and building, and
  before fc/prog. Modules are tried in FEATURES order (`first()`). Display comes earlier, but its `target()` only
  matches shelf/stand anchors, so it does not collide.
- Plan: if the hand holds `fish` and count < 4, show "E Add {Species} to the tank". If the hand is empty and the
  tank has fish, show "E Let the {Species} out" (the last fish). If it holds something else, show a muted hint.
  `cookedfish` is refused ("Only live fish can swim").

## 6. State, co-op, save
- Slice `world.ext.aquarium = {v:1, s, r, t:{"x,z":[{sp,cm}, ...<=4]}}`, with MAX_TILES 400 and orphans kept.
  Actions: `aquarium.add {x,z,from,species,cm,expect:{have:'fish',n}}` and `aquarium.release {x,z,expect:{n,sp}}`.
  For a guest the host uses `ctx.other` for reach and `ctx.actorBag`/the passed `bag`.
- OLD_HOST: `const OLD_HOST = 'Your friend’s raft doesn’t have fish tanks yet'`. Set it when 'net' load gets
  `undefined` and use it as both the prompt and the notice (copy `juicer.js:12,177,211,218`).
- Old saves have no `ext.aquarium`, so they load an empty tank. Older builds drop the unknown decor type in `cleanWorld`
  (`game.js:208`) and the ext slice survives via `cleanExt`. Keep `serialize()` cached, since it is sent at about 8 Hz.

## 7. Perf
- Max 4 fish x lod 0 per tank, about 2 meshes each (body + tail; glow only on sunscale). The total budget is
  MAX_FISH 48 nearest (copy `display.js:347 paint` budget).
- Only animate in `update(dt)` tanks within about 10 m of `ctx.physics` (check the distance every 0.5 s, not every
  frame). Far tanks show static fish. Swim = a slow lissajous inside the box (`sin(t*w+phase)` on x/z, small y bob,
  heading from velocity) + `wiggle(g, t, .4)`. Allocate nothing in update and reuse vectors.
- Glass: one transparent MeshStandard/Physical (opacity about .25, `depthWrite:false`, no shadow) shared per module and
  flagged shared. Set `castShadow=false` on fish inside, and use a single water-tint box.

## Risks
- Glass transparency sorting with fish inside: render the water/glass after the fish (`renderOrder`).
- Species is client-chosen, so a guest could spoof it. It is cosmetic only; clamp it on the host.
- Release order (LIFO) has to match the `expect` guard. Use a stale bump for a double-tap.

## Recommendation
Build it as a display.js clone with one slice, pure add/release, and lod-0 shared fish models flagged shared.
Species comes from the local journal and is validated on the host. Fish trade 1:1 with plain bag `fish`. Undecor
returns the fish. Ship it in 3 files: `aquarium.js`, `aquarium-model.js`, and tests in `tests/aquarium.test.mjs`.
