# Kiln (smelter station): research note

Scope: a cozy "turn ore, sand and clay into something" station. Today diving gives `sand`, `clay`
and `metalore` (seafloor.js:24-29, weights .35/.25/.22 scrap/.18), and islands give `sand`, `stone`
and `seed` (islands-layout.js:177-180). Only the Research Table eats any of them. Line numbers refer to
the tree at commit 980b412.

## 1. Genre conventions (general patterns)
- **Station from stone or clay.** The first smelter is a squat stone-and-clay furnace, built after a
  research step. It sits on the deck like any other placeable.
- **Fuel.** Planks or logs go in a fuel slot. Each unit burns for a fixed time or a fixed number of
  batches. A visible fire, smoke and an ember glow show that it is running. When the fuel runs out the
  station pauses.
- **Batch timing.** You put in one input. It cooks for about 10-40 s of real time, then the output sits
  in a tray until you pick it up. Higher tiers are faster or take more per load.
- **Outputs.** Ore becomes an ingot (often 1 ore to 1 ingot, sometimes 2 to 1), sand becomes glass,
  and clay becomes brick. Later tiers make alloys (two ingots) for top-end gear.
- **What they unlock.** Ingots go into sturdier tools (metal hook or axe), the parts of a receiver,
  engines and anchors. Glass goes into bottles and canteens, lamp housings, windows and purifier
  upgrades. Bricks go into smelter upgrades, chimneys, fireplaces and planters.
- **Feedback.** Glowing coals, a door that glows orange, a "ding" when the batch is done, and the
  output shown on the tray.

## 2. Our cozy version ("Seaside Kiln")
| Genre mechanic | Little Raft |
|---|---|
| Burn or fail states | **None.** Outputs never spoil. When the fuel runs out the kiln pauses and keeps its progress. |
| Plank fuel | `wood` only. 1 wood = 2 batches. It holds up to 4 wood (8 batches). |
| Many slots | One input queue (up to 6 batches of one recipe) and one output tray (up to 10). |
| Tiers and alloys | Dropped for v1. |
| Research | The kiln and everything made from ingots, glass or brick is gated by the existing Research Table. This needs no new code, see §5. |

Interaction: E on the kiln (`interact(aim)`). With a smeltable item selected, E loads one batch.
With wood selected, E adds fuel. Otherwise E collects the tray. No new UI panel is needed for v1.
The prompt shows something like `Kiln · glass 2/4 · fuel 3 · 1 ready`.

## 3. Station and outputs (recommended numbers)
| Kind | Name | How | Batch time | Notes |
|---|---|---|---|---|
| `kiln` | Seaside Kiln | craft: **stone 6, clay 4, scrap 1** | — | Decor that blocks walking (radius .45) |
| `ingot` | Metal Bar | 2 metalore → 1 | 18 s | Ore is the rarest node (18 %) and slow to gather (1.4 s) |
| `glass` | Glass Pane | 2 sand → 1 | 12 s | Sand comes from both islands and the seafloor |
| `brick` | Fired Brick | 1 clay → 1 | 10 s | Clay is common underwater |

Fuel works the same for every recipe: 0.5 wood per batch, because 1 wood covers 2 batches.
For comparison, the grill gets 45 s of fire per wood (cooking.js:25). The kiln reaches the same cost
per second without a timer that drains while idle. Fuel is only spent when a batch starts, so an
idle kiln never wastes wood. All three outputs stack to 20 and are not tools.

## 4. New recipes that consume the outputs (small, coherent set)
| Recipe id | Output | Cost | Why it matters in this build |
|---|---|---|---|
| `glasslamp` | Glass Lantern (decor) | glass 2, ingot 1, wood 1 | A brighter night light. The model's group is named `craft_lantern` and has a `lanternGlow` mesh, so daynight.js:375-398 lights it and adds it to the light pool with **no edit to daynight**. Give it a higher base emissive than the wood lantern. |
| `glasscups` | **3 × `cup`** | glass 1 | A second, plastic-free source of cups for the purifier and watering loop (watering.js). This is a recipe whose `output.kind` (`cup`) differs from its id. Bag.craft (inventory-state.js:346-361) and survival-ui `outOf` (survival-ui.js:101-106) already support that. The cup's maxStack of 5 caps a craft when the bag has no room, and Bag reports `full`. |
| `brickplanter` | **2 × `palm`** | brick 3, leaf 2 | Planters stay type `palm`, so watering, growth and harvest work as they are. This one is cheaper per planter than wood 2 + leaf 3 and turns clay into more leaves and wood. |
| `sinker` | Line Sinker | ingot 1, stone 1 | A passive item. While it is in the bag, a catch wears the hook by **1 instead of 2**, which doubles the time between repairs. This is the "sturdy metal hook" without a new tool kind. It needs the one-line game.js edit in §5. |

Rejected for v1: a new tool kind `metalhook`. It needs TOOL_KINDS (inventory-state.js:12), `hookIndex`
(game.js:108-112), range and wear changes, and new save shapes. Also rejected: a brick floor piece, because
PIECES (building-pieces.js:15-27) and the models in building-models.js are outside the registry. That
piece is a good phase 2 item: `brickfloor` {brick: 2}, same slot as `floor`. An ingot-based hook repair
was also rejected, because R already costs 2 wood + 1 scrap (game.js:51), which is cheaper.

## 5. Integration points (content registry first)
- **Module:** `dist/kiln.js` exporting `createKiln(ctx)`. Import it at content.js:25-28 and append it
  to `FEATURES` (content.js:30). Put the pure logic in `dist/kiln-core.js` (`KilnState`, modelled on
  `GrillState` in cooking.js:7-130, with clean/snapshot/step and no allocations) and the tests in
  `tests/kiln.test.mjs`.
- **Items:** add `kiln`, `ingot`, `glass`, `brick`, `glasslamp`, `sinker` to `CONTENT_ITEMS`
  (content-items.js:9). Add the recipes `kiln`, `glasslamp`, `glasscups`, `brickplanter`, `sinker` to
  `CONTENT_RECIPES` (content-items.js:19). `glasscups` and `brickplanter` are hand-written objects
  `{id, name, output:{kind:'cup'|'palm', count}, cost}`, not the `recipe()` helper. Note that inventory-state.js
  spreads CONTENT_ITEMS *before* the diving block (line 33), so any duplicate kind is overridden by that block.
- **Decor:** `CONTENT_DECOR` gets `'kiln', 'glasslamp'`, and `CONTENT_BLOCK_RADIUS` gets
  `{kiln: .45, glasslamp: .12}` (content-items.js:24-25). game.js:44/52 spread both. The models come from
  `decorModel(type)` (game.js:428). Keep the models in `dist/kiln-model.js`.
- **Research gating:** this works automatically. `lockedRecipes` and `researchableKinds`
  (storage-research.js:26-52) derive from RECIPES. The kiln unlocks once stone, clay and scrap have
  been fed to the table. Ingot, glass and brick recipes unlock after the player feeds one bar, pane or
  brick. Do not add the kiln to STARTER (storage-research.js:11), because the table is the progression.
  The `craftLocked` hook is game.js:738.
- **Actions (host-authoritative):** `kiln.load {x,z,slot}`, `kiln.fuel {x,z}`, `kiln.take {x,z}` go through
  `action(a, actor, bag)` (game.js:814). Validate that `decorAt(x,z) === 'kiln'` and the actor's reach (copy
  `decorAt` and `posOf` from storage-research.js:247). Make every change atomically on the bag, as spend() does (game.js:103).
- **Timing:** `update(dt)` advances the batches on the host only. Guests just render the snapshot.
  Clamp dt (≤ 1 s) so a tab that was in the background does not finish everything at once. Keep it
  generous anyway: no fail state.
- **Sinker (only game.js touch):** in `wearHook` (game.js:726) use
  `Math.max(0, before - (bag.count('sinker') > 0 ? 1 : WEAR_PER_CATCH))` and update the "R repairs" toast text if needed.
- **Icons:** add `icon-ingot`, `icon-glass`, `icon-brick`, `icon-kiln` to icons.svg and to SPRITES
  (survival-ui.js:19). You can map `sinker` to `ingot` and `glasslamp` to `lantern` in SPRITE_FOR
  (survival-ui.js:21) to start with.

## 6. Save and co-op
- State slice `world.ext.kiln = {v:1, k:{"x,z": {r:'glass'|'ingot'|'brick'|null, q:0..6, t:secs, f:0..8, out:{kind,n}}}}`.
  `load(undefined)` gives `{}`. `load` drops entries with an unknown recipe, NaN values or counts out
  of range. It also drops entries whose tile is no longer kiln decor, after each load and on rebuild,
  using the same decorAt check.
- Store fuel as batch charges (an integer), not seconds, which makes cleaning and display trivial.
- `serialize()` is sent about 8 times a second in `hostState` (game.js:1062). Keep it small: round `t`
  to 0.1 s and leave out idle empty kilns. `load(d,'net')` updates the visuals only (the glow on/off
  and the tray item) when the data changed.
- Guests send `ctx.action({kind:'kiln.*', ...})` and never change the kiln locally. Outputs go into
  the actor's own bag (`bag` argument), so in co-op, whoever collects the tray gets the items.
- Old builds: `ext.kiln` is dropped by cleanWorld, and bags that hold new kinds are rejected (as the
  header of content-items.js already accepts). New builds load old saves with no kilns.

## 7. QA hooks (`raftDebug.content.kiln`)
`state()`, `finish(x,z)` (completes the current queue immediately), `give(kind,n)`, `spawn(x,z)`, so tests do not
have to wait out the slow frames of swiftshader.
