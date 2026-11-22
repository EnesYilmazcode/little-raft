# Research: a third raft animal that gives wool

Status: research only (no code). Builds on docs/specs/raft-animals.md and docs/specs/goats.md. Line numbers are for the current tree.

## 1. The reference loop (generic mechanics, in our own words)
- A grazing animal lives on a separate island/shore, not in the sea. The player lures it home by holding its favourite food; it follows.
- Once on the raft it needs a little floor space and gets hungry over time. Fed, it periodically grows a coat of wool.
- When the coat is ready the player uses a crafted shearing tool on it: one wool per shear, then the coat regrows on a timer.
- A hungry animal stops producing (the cozy rule for Little Raft: never hungry, never harmed; feeding only speeds regrowth).
- Wool is a soft crafting material: rugs, beds/blankets, cloth-like items, and sometimes an alternative to fibre/rope.
- Visual state matters: the animal looks fluffy when ready and trimmed right after shearing, so players read it at a glance.

## 2. How the Bramblegoat was added (the pattern to copy)
**Core table (dist/animals-core.js).**
- `MAX_SLOTS = 6` sizes the module arrays (:12); goat timers `MILK_BASE 300, MILK_CONTENT 120, MILK_CAP 1, GOAT_BEAT 9, GOAT_HOP_T 2.4, ARRIVE_GOAT_T 4` (:13); `GOAT_NAMES` (:14).
- `SPECIES` deep-frozen (:15-19): `{prefix:'g', home:'goatpen', code:2, cap:2, label, plural, names, foods:['leaf','seaweed'], lure:[['seaweed',3],['leaf',4]], lureMin:30, lureMax:50, beat, hopT}`.
- `HOME_CODE {nestbox:1, goatpen:2}` (:20) feeds `buildGraph` (home cells are walk nodes with `box=code`). `ID_RE` per kind (:23).
- **Not table-driven yet.** Many places branch binary `kind === 'goat' ? goat : puffhen`, which silently turns any third kind into a hen:
  `cleanAnimals` per-count `{puffhen, goat}` (:69), goat entry shape (:81-89), lure kind (:105); `gone()` checks `id[0]==='g'` (:274);
  `labelOf` (:275); `tick` per-kind production (:289-295) and lure spawn shape (:309-314); `lure()` texts (:330-339);
  `feed()` texts (:344-353); `pet()` hen feather branch (:361). `milk()` (:392-407) is the template for a species-only harvest action.
- Arrival: `edgeStart(tileKeys, hx, hz)` (:258-269) gives the deterministic wade-in start cell; render does the 4 s wade (`ARRIVE_GOAT_T`).
- Lure flow: `lure()` (:328-340) charges `S.lure` food, pushes `{home, at: t + lureMin..lureMax, kind:'goat'}`; `tick` spawns when `t >= at` and under cap (:305-319), two rng calls (name, seed).

**Module (dist/animals.js).**
- Imports (:9-11); goat consts `GOAT_R/CY, PEN_R/CY, GOAT_LIFT, GOAT_CAP` (:21); `goatShown` sized by `GOAT_CAP` (:41).
- `rehome` assigns per-species instance index `inst[i]` and accepts a home only when `graph.box[h] === SPECIES[kind].code` (:85-92).
- Two extra InstancedMeshes (body + head) sharing `birdMat` (:132-137); per-slot species switch in render (:157-161); `renderGoat` (:200-242).
- Visibility per species (:289-292); arrival toast to `'all'` (:302).
- Picking: goat sphere + `goatpen` decor sphere, pen-in-front-of-goat aim rule (:332-347).
- Held helpers `heldFood/heldPail/lureFood` read `SPECIES` (:352-354); `goatPrompt`/`penPrompt` (:357-371); interact sends `animals.milk` (:403-412); rename dialog gets `SPECIES[kind].label` (:433).
- Host `action()` (:453-487): prefix `animals.`, guests return true early (:455); lure tile check hard-codes `nestbox`/`goatpen` (:463, :467); verb `milk` (:468-473); `full` maps for collect/milk (:485).
- `serialize()` (:494-503): hen entries keep their exact key order; goats `{id, kind:'goat', name, seed, home, born, hearts, content, prod, milk, bondAt}`; hen lures have no `kind` key, goat lures `kind:'goat'`.
- `load()` (:509-519): net path cleans without decor pruning, local path prunes by `ctx.world.decor`.
- Debug `spawn(x,z,kind)` (:533-547), `spawnGoat` (:567), `milkNow` (:568); `decorModel('goatpen')` (:596); dispose list (:604).

**Save format.** `world.ext.animals = {v:1, r, t, next, list, lures}` stays v1; goats are additive entries, unknown `kind` dropped silently by old builds.
**Co-op.** No positions sent; guests render from `d.list` + synced clock + tiles/decor. One new verb (`animals.milk {id}`), host validates id (≤ 8 chars), reach (`REACH + 1.5`, :446-450), bag; result arrives in the next state.
**Items/data.** dist/content-items.js items (:35-37), recipes (:111-112), `CONTENT_DECOR` + `goatpen` and `CONTENT_BLOCK_RADIUS goatpen:.4` (:143-144);
dist/craft-book.js categories (:42), descs (:164-166), how-to-get `milk:{tag:'goat'}` (:473); dist/survival-ui.js `SPRITES` (:26), `SPRITE_FOR` (:41); dist/icons.svg symbols.
**UI.** dist/animals-ui.js `open(id, name, species)` (:51) sets the "Name your X" heading; no other UI change.
**Models.** dist/animals-models.js `goatBodyGeometry` (:151), `goatHeadGeometry` (:167), `goatPenModel` (:187), merged vertex-coloured, origin at feet, nose +z.
**Tests.** tests/goats.test.mjs, 15 tests (:26-357): frozen table and `MAX_SLOTS === 6` (:31), clean/caps/lures, home pruning, graph, edgeStart, tick timing,
lure/feed/pet/milk, items/vitals, module stub ctx (guest no-op, reach, prompts), models (tri budget), picking, prompt length ≤ 48 chars, removed-home cleanup.
tests/animals.test.mjs stayed unchanged and green: the same must hold for both old files.

## 3. What wool could make (friendly, useful)
Existing soft/cosy items: `rug` Woven Deck Mat `{leaf:4, rope:2}` (content-items.js:90), `hammock` `{wood:4, rope:4, leaf:2}` (:94), `cushion` Feather Cushion `{feather:3, leaf:2}` (:109),
`bed` Simple Bed `{leaf:10, wood:6, plastic:4, nail:3}` (:115). Rope is `{leaf:2}` (items.js:131-133) and is in ~40 recipes, so rope is the biggest sink.
Recommended, small set:
1. **Wool Rope** (alt recipe, id `woolrope`, output `rope` ×2, cost `{wool:1}`): same pattern as `egglamp` (output kind differs from id, :110). Saves leaves; no new kind for rope consumers.
2. **Tuft Rug** (`tuftrug` decor, `{wool:3, rope:1}`): a round soft rug in the creature's colours; E turns it like `rug` (craft-book.js:140). Pure decor.
3. **Cosy Blanket** (`blanket`, `{wool:4, leaf:1}`): decor that drapes over a placed bed/hammock look, or a simple placeable folded blanket. If a gameplay hook is wanted, keep it gentle
   (e.g. bed sleep tip text only), avoid touching sleep balance in v1.
4. Optional later: wool as alternative stuffing for the Feather Cushion (`woolcushion` id, output `cushion`, `{wool:2, leaf:1}`), so goats/hens/new-animal players all reach cushions.
Avoid a dye system and clothing in v1 (look.js hats are a separate namespace; the `bucket` hat id clash already exists there).

## 4. Recommendation: the Tufflet
**Look (original, not a llama).** A small round sea-meadow creature: a cloud-shaped body of chunky wool puffs (lavender-grey `0xbfb6d6` with cream tips), a smooth short seal-like
face with a soft blunt snout, big dark eyes with glints, two droopy fluffy ears, four stubby paddle feet, no neck. ~0.45 m tall. "Trimmed" state = smaller body puffs (scale .8), so readiness reads at a glance.
It paddles up the raft edge (reuse `edgeStart` wade-in) and waddles with a side-to-side roll; idle = shakes its fluff, sits like a loaf, sneezes a tiny tuft.
**Home.** `tuftnook` "Tuft Nook": a low woven basket bed with a driftwood rim and a kelp pillow, `{wood:3, leaf:3, rope:2}`, `HOME_CODE 3`, `CONTENT_BLOCK_RADIUS .35`.
**Lure.** `[['berries',2],['seaweed',4]]`, lureMin 40, lureMax 60 (berries: items.js:116; seaweed :107). Foods `['seaweed','berries']`.
**Tool.** `shears` "Shell Shears" `{scrap:2, shell:1, rope:1}` (shell: content-items.js:55), stack 1, `tool:false` (no durability, like glidehandle). Shearing never consumes the tool.
**Production.** `WOOL_BASE 360, WOOL_CONTENT 150, WOOL_CAP 2` (two tufts may grow before you shear; one shear takes all that fits), hearts cut 3%/heart like the others. Item `wool` "Tuft Wool", stack 20.
**Caps/ids.** cap 2, prefix `t`, ids `t1..t999999`, `TUFT_NAMES` 12 original names. `MAX_SLOTS` 6 -> 8 (4 hens + 2 goats + 2 tufflets); one new verb `animals.shear {id}`. Draw calls +1-2 only while tufflets exist.
**Implementation order.** First make the core genuinely table-driven (per-kind count from `Object.keys(SPECIES)`, `gone/labelOf` via an id-prefix map, lure/feed texts in `SPECIES`, lure tile check
via `HOME_CODE`), with hens and goats byte-identical, then add the `tufflet` row and a `shear()` cloned from `milk()` (scratch-then-commit add of `wool`, `full` on no room, then `wool = 0, prod = 0`).

**Risks: save backward compatibility.**
- Hen and goat entries/lures must serialize byte-for-byte as today; keep the explicit per-kind serialize branches and add a third rather than a generic spread.
- Old build loading a tufflet save: its `cleanAnimals` drops unknown entry kinds (`speciesOf`, :73) and unknown lure kinds (:98-99), so tufflets vanish and hens/goats survive.
  `tuftnook`/`shears`/`wool` are dropped by old `cleanWorld`/bags (content-items.js:4): the same accepted forward risk goats took; changelog note.
- New build: the in-tick lure spawn (:309) and serialize lure map (animals.js:502) map any non-goat to hen; both must learn `tufflet` or a tufflet lure becomes a hen on a Tuft Nook.
- `next` must cover the `t` prefix; the existing `+e.id.slice(1)` works for any 1-char prefix.
- tests/goats.test.mjs:31 asserts `MAX_SLOTS === 6`; changing it to 8 breaks that test. Either edit that assertion (spec it explicitly) or add a separate `MAX_TOTAL`.

**Risks: co-op sync.**
- Guests must never mutate; `action()` already returns true on guests (:455). `animals.shear` must follow the milk path: idOk, find, reach, bag, host-only result.
- Two players shearing in one tick: second gets `notyet`, no duplicate wool (state-based, as milk).
- Mixed versions: an old guest renders a tufflet as nothing (dropped) or, if a binary branch leaks, as a hen in the wrong home. Mixed-version co-op is unsupported, but keep the net path's `cleanAnimals(d, null)` dropping unknown kinds.
- Per-species instance index `inst[i]` and `rehome` code checks (:85-92) must include code 3, or a tufflet steals a goat/hen instance.
- The "trimmed" look must come only from synced `a.wool` so host and guest agree.

**Tests to add** (tests/tufflets.test.mjs, same pattern as goats): table/caps/prefix, hen+goat fixtures round-trip unchanged, unknown-kind drop, home pruning across three types,
wool timing 360/150/hearts, cap 2 hold, lure order berries then seaweed, shear notyet/noshears/full/success, guest shear no-op, recipes/items, model tri budget, prompt ≤ 48 chars.
