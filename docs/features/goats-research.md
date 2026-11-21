# Raft goats: research note (the second raft animal)

Scope: add a small, friendly milk animal next to the Puffhen. The goat never gets hungry, never leaves and never dies, and nothing does damage.
Working name: **Bramblegoat**, a stubby, round goat about 0.55 m tall with a cream coat, a toffee-coloured saddle patch, two nub horns, floppy ears and a tiny beard.
Line numbers below refer to the current tree.

## 1. How Raft's goats work (WebSearch, Raft wikis and a Steam thread; short)
- **Capture.** Goats live on islands. You net one with the Net Launcher, then carry it to the raft. Llamas and Cluckers work the same way.
- **Feeding.** A goat eats from a watered Grass Plot. If it has not eaten, it gives no milk. A goat gets "hungry" a few minutes after its last meal and then stops making milk.
  The sources disagree on how long: the wiki says 8 min, and patch history says 3 min, later raised to 6.
- **Milking.** Use an empty Bucket on the goat to get a Bucket of Milk. The cooldown is 2 min on the current wiki and 5 min on an older revision.
- **Milk use.** You drink it (the bucket comes back) or cook with it (the bucket is used up).
- **What we take.** Bucket milking with a cooldown, greens as feed, and milk as both a drink and an ingredient. **What we drop.** Nets, carrying, hunger stopping
  production, and the grass-plot requirement. This matches the Puffhen rules in docs/features/raft-animals-research.md §2.
- Sources: raft.fandom.com/wiki/Goat, raft.fandom.com/wiki/Bucket_of_Milk, raft.fandom.com/wiki/Livestock, gameranx.com Raft livestock guide,
  steamcommunity.com/app/648800/discussions/0/5051317596390984959.

## 2. The Puffhen system to extend (what exists)
- **Files.** dist/animals-core.js is pure: no DOM, no THREE, no Math.random. dist/animals.js holds `createAnimals(ctx)`, which is in `FEATURES` in dist/content.js:27.
  dist/animals-models.js has merged vertex-coloured geometry. dist/animals-ui.js is the rename `<dialog>`. tests/animals.test.mjs has 11 node:test cases.
- **Save.** The save lives at `world.ext.animals = {v:1, r, t, next, list:[{id:'pN', kind:'puffhen', name, seed, home:[x,z], born, hearts, content, prod, eggs, feather, bondAt, featherAt}], lures:[{home,at}]}`.
  `cleanAnimals` (animals-core.js:48) validates it. It **drops any entry whose `kind !== 'puffhen'`** (line 60), so a build that does not know goats loses them silently.
  It caps list plus lures at `MAX_ANIMALS = 4` and prunes homes that are not a `nestbox` in decor (line 55). The registry saves and syncs this through
  `content.serialize()` and `load(d,'save'|'net'|'restore')` (content.js:83-84). `cleanExt` caps all of ext at 200 000 chars.
- **Deterministic wander, no positions sent.** The host advances `st.t` only while `ctx.running`, and only the host runs `tick()`. Guests run a local clock and snap to
  `d.t` when the drift is over 2 s. Each animal does `beat = floor((clock-born)/BEAT)`, and `plan(seed, beat, graph, dist, homeIdx)` replays from the last
  `HOME_EVERY` boundary, so there is no stored path. The graph comes from synced `tiles`/`decor`/`pieces` plus `ctx.hasGrill` (`buildGraph`, core:95).
  Decor cells other than `nestbox` are not nodes (core:110). `homeDist` limits the walk to `RANGE = 3` cells, through free cells only. `serialize` is cached by `r`
  (or every 5 s), and `born` and `t` are rounded to 0.1 s so guests stay in phase. Hearts, squish and pick are local only.
- **Actions.** The prefix is `animals.` (animals.js:338). Guests return true and the host validates. Ids must be ≤ 8 chars, tiles must be ints with |v| ≤ 25, and reach is REACH+1.5 from
  the host-computed pose. Bag changes use scratch-then-commit. Toasts are plain text, because game.js escapes them.
- **Render.** Three draw calls: `InstancedMesh(puffhenGeometry, 4)`, eggs `InstancedMesh(12)` and one heart Mesh. Unused instances get a zero matrix, and with no animals
  the module skips all upkeep (spec §Implementation notes, "Idle frames").
- **Prompts.** `prompt(aim)` returns HTML like `<kbd>E</kbd>Pet Biscuit ♥ 3`. game.js:730 turns it into a `raftPrompts` row through `promptParts`
  (content.js:41). The module never calls `raftPrompts` itself.

### Recommendation: put goats inside the animals module, with a species field
Reasons: the graph, wander, clock, cache, reach checks, rename dialog, debug helpers and the guest flow are all species-agnostic, and they are about 80% of the work. A second module
would need its own copy of the graph and clock, and the two modules could not see each other's animals, so a hen and a goat could share a tile. It would also
need another `ext` key and duplicate `hasGrill` and grill-signature polling. Plan:
- **Species table in core.** `SPECIES = {puffhen:{home:'nestbox', prefix:'p', cap:4, ...}, goat:{home:'goatpen', prefix:'g', cap:2, ...}}`. `cleanAnimals` accepts
  `kind in SPECIES` and checks the id against that species' prefix (`/^g\d{1,6}$/`). It prunes against that species' home decor. A missing `kind` still means drop, as it does today.
  Keep `v:1`. The new fields are optional with defaults, so a hen entry from an old save loads byte-for-byte the same.
- **Caps.** Keep the hen cap at 4 and add a goat cap of 2, with a total of 6. `MAX_ANIMALS` is used to size the preallocated arrays (animals.js:31-35). Make it the total
  and add per-species checks in `lure`/`tick`. The `cap` prompt text must name the species.
- **Goat-specific state.** Goat entries add `milk` (0/1, ready) and `milkAt`. They have no `eggs`/`feather`, and the core keeps `prod` for both species.
  `tick` branches on `SPECIES[a.kind]`. A suggested milk period is 300 s base, 120 s while content (close to Raft's 2-5 min), minus 3% per heart.
- **Wander.** Same graph. `buildGraph` treats both `nestbox` and `goatpen` as home cells (`box=1`), so a goat never walks through a nest box and a hen never walks through a pen.
  Goats could use a slower beat (BEAT 9, 1-2 hops, with no `|sin|` hop bob and a gentle walk sway instead). Add a `p.hop` multiplier per species and keep `plan` unchanged.
- **Getting a goat.** Use a home decor `goatpen` (a "Hay Corner": a low slatted corner fence with a hay pile, about 0.8 m). Lure it with 3 `seaweed` or 4 `leaf`,
  so a fresh player can do it with leaves. It arrives in 30-50 s by **wading up the raft edge** (a short climb animation) and does not fly in from the gulls.
- **Actions.** Reuse `animals.feed|pet|name|lure|collect` with species-aware tests. Add one new verb, `animals.milk {id}`.

## 3. Item kinds: feed, bucket, milk
- **Feed (all existing kinds).** `leaf` (Palm Leaf, inventory-state.js:19), `seaweed` (items.js:97, from barrels and treasure, and a fuel today),
  and `seed` (content-items.js:12). Suggested goat `FOODS`: `leaf`, `seaweed`. Hens keep `seed`/`leaf`. Farming and watering harvests give `leaf`
  (farming.js:18 `HARVEST {leaf:3, seed:1}`, watering.js:7 `{leaf:2}`), so a planter row is the cozy stand-in for Raft's grass plot. No new "hay" kind is needed.
- **Bucket.** No bucket kind exists. `cup` (inventory-state.js:43, stack 5, recipe `{plastic:1}` :85, glass cups content-items.js:58) is the water vessel,
  and `bucket` is only a cosmetic hat id in dist/look.js:22, which is a separate namespace, so there is no clash. Add a new kind **`bucket` "Wooden Pail"**
  (stack 5, recipe `{wood:3, rope:1}`, in `STARTER` or unlocked by seeing wood and rope). Do not reuse `cup`: its kind lanes (fillCup, purifier, planters) all swap `cup` and would
  start accepting milk logic. Milking uses the existing `swapOne(bag, 'bucket', 'milk')` from dist/watering.js:127, so a held single pail becomes milk in the same slot.
- **Milk.** New kind **`milk` "Pail of Milk"** (stack 5). Register it with `addFood('milk', {food:10, water:25, returns:'bucket'})` from dist/vitals.js:36. The `eat` host path
  (game.js:1170-1174) already removes the item, gives back `returns` and refuses when the bag is full. **Gotcha:** `eatLabel` (vitals.js:85) says "Drink" only when food is 0 or the kind ends in `cup`. So milk with food 10 would show
  "Eat (+10 food, +25 water)". Either add `|| kind === 'milk'` to that test (a one-line vitals edit) or accept "Eat".
- **Cooking.** A Cooking Pot is being designed in parallel. **Keep the kind name `milk` stable** and treat it as an ingredient there, as Raft does, with the pail used up
  or returned as that spec decides. Until the pot lands, optional hand recipes are possible: "Sweet Milk" `{milk:1, honey:1}` → food (honey from bees, items.js:102), or
  "Fish Chowder" `{milk:1, cookedfish:1}`. Better to leave these to the pot spec and avoid two sources of truth.
- **Kind registration.** Append `goatpen`, `bucket`, `milk` to `CONTENT_ITEMS`, add `goatpen` to `CONTENT_DECOR`/`CONTENT_BLOCK_RADIUS`, add recipes,
  and add icons (`icon-pail`, `icon-milk`, `icon-goatpen`, original art). Check every new id against the parallel Cooking Pot spec (`pot`, `stew`, ...) before freezing them.

## 4. Risks
- **Old saves.** An old save has no goats, and `load(undefined)` and hen-only data load unchanged. **Forward risk:** an older build that opens a goat save drops goat entries
  (core:60) and resets any bag that holds `bucket`/`milk` (content-items.js:4). This is the same accepted risk earlier kinds took. Tests: a hen-only v1 fixture round-trips identically,
  and an unknown species is dropped without throwing.
- **Co-op.** Only the host mutates. `milk` goes in the cached `serialize` list, and `r` bumps on milk ready and on milking. That adds about 2 entries of 120 B at most, well inside the 8 Hz budget.
  The guest wander stays deterministic because goats use the same graph and clock inputs. Milk readiness must come only from host state, and the guest shows a pail prompt from `d.list`.
  The `id ≤ 8` and reach checks cover `animals.milk`. A guest's E with a pail must not trigger a local `swapOne`.
- **Performance.** Add one `InstancedMesh(goatGeometry, 2)` (merged, vertex-coloured, sharing `birdMat`) plus an optional milk-pail glint, for +1 draw call.
  Keep zero allocations per frame, extend the scratch arrays to the new total, and keep the "no animals → skip everything" fast path. Goat geometry should stay under about 1.5k triangles.
- **Picking.** Goat spheres are larger (r about 0.35, centre +0.3 m). The nearest hit across both species wins. A goat on a tile next to a nest box can steal E, so test the nearest-hit order.
- **Prompts (`raftPrompts` through `promptParts`).** Holding a pail at a goat with milk ready shows `<kbd>E</kbd>Milk ${name}`. Without the pail but with milk ready it shows `${name} has milk · needs a Wooden Pail`.
  Not ready shows the pet or feed prompt with ` · milk soon`. With leaf or seaweed held it shows Feed. **Conflict:** the vitals `game-context` provider (game.js:1595, priority 0)
  shows an `LMB Drink` tip while milk is selected, and the content prompt (priority 1) wins, so that is fine. Do make sure E with `milk` held at a goat does not try to milk again.
- **Naming.** The dialog heading `Name your Puffhen` and strings like `That Puffhen wandered off` and `the raft has 4 Puffhens` are hard-coded (animals.js:281-282, 357).
  They need a species display name.
- **Tests to extend.** Add cases to tests/animals.test.mjs: species validation and caps, goat milk timing and cap, milk action (no pail, full bag, partial), the `buildGraph` home types,
  `addFood('milk')` returning a pail, and the stub-ctx guest no-op for `animals.milk`.
