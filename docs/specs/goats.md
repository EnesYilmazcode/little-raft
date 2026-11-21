# Spec: raft goats (the Bramblegoat)

Source: docs/features/goats-research.md. Builds on docs/specs/raft-animals.md (read it first; everything not named here stays as it is).
Cozy rules hold: a goat never gets hungry, never leaves, never dies and does no damage. Feeding only speeds milk up. Line numbers refer to the current tree.

## 1. Ids and files
New kinds: `goatpen` (decor, "Hay Corner"), `bucket` ("Wooden Pail"), `milk` ("Pail of Milk"). Recipes: `goatpen`, `bucket`. Icons: `icon-hay`, `icon-pail`, `icon-milk`.
Goat ids `g1..g999999`. Ext key stays `animals` (`v:1`), action prefix stays `animals.`, one new verb `animals.milk`. `bucket` the look.js hat id is a separate namespace.
`milk` is kept stable for the parallel Cooking Pot spec (it may take milk as an ingredient; that spec decides whether the pail comes back).
No new module and no new npm deps. Files touched (all small, append-style hooks):

| File | Change |
|---|---|
| dist/animals-core.js | `SPECIES` table, species-aware clean/lure/tick/feed/pet, new `milk()`, `milkPeriod()`, `edgeStart()`, `pose(..., ht)` (section 3) |
| dist/animals.js | per-slot species, goat meshes, picking, prompts, `animals.milk`, serialize shape, debug (section 4) |
| dist/animals-models.js | `goatBodyGeometry`, `goatHeadGeometry`, `goatPenModel` (section 6) |
| dist/animals-ui.js | `open(id, name, label)`: heading `Name your ${label}` (lines 25-26, 48), set via `textContent` and `aria-label` |
| dist/content-items.js | items after line 29, recipes after line 65, `CONTENT_DECOR` (78) + `'goatpen'`, `CONTENT_BLOCK_RADIUS` (79) + `goatpen:.4` |
| dist/vitals.js | `FOOD` (26-33) + `milk:{food:10, water:25, returns:'bucket', drink:true}`; `eatLabel` (85): `const drink = e.drink \|\| (!e.food && e.water !== 0) \|\| kind.endsWith('cup');` |
| dist/game.js | 720: `FOOD[k].food > 0 && !FOOD[k].drink ? 'Eating…' : 'Drinking…'` (the only game.js edit) |
| dist/survival-ui.js | `SPRITES` (22-23) + `'hay','pail','milk'`; `SPRITE_FOR` (41) + `goatpen:'hay', bucket:'pail', milk:'milk'` |
| dist/icons.svg | three `<symbol viewBox="0 0 48 48">` after `icon-nest` (527), original art: hay pile in a slatted corner; wooden pail with rope handle; same pail with a cream milk top and a drip |
| dist/craft-book.js | category (28) `goatpen:'survival', bucket:'survival'`; desc (113-115) for goatpen/bucket/milk; how (347) `milk: {tag:'goat', how:'Place a Hay Corner; a goat moves in. Hold a Wooden Pail and press E on it.'}` |
| tests/goats.test.mjs | new (section 9). tests/animals.test.mjs stays unchanged and green |

`FOOD.milk` goes straight into the vitals table (not `addFood` at import time) so the eat path, tips and tests see it whatever the load order.
The `eat` host path (game.js:1170-1174) already removes the milk and gives the pail back, refusing with "No room for the empty cup" only when it cannot fit (it always fits after the removal of a single pail).

## 2. Items, recipes, gating (dist/content-items.js)
- `goatpen: item('goatpen','Hay Corner','icon-hay',false)`, `bucket: item('bucket','Wooden Pail','icon-pail',false,5)`, `milk: item('milk','Pail of Milk','icon-milk',false,5)`.
- `goatpen: recipe('goatpen','Hay Corner',1,{wood:4, leaf:3, rope:1})`, `bucket: recipe('bucket','Wooden Pail',1,{wood:3, rope:1})`. Kind names checked: `wood` (inventory-state.js:18), `rope` (:22), `leaf`, `seaweed` (items.js:81, 97).
- No `STARTER` edit: both unlock via `learnedFrom` once wood, leaf and rope are studied (early game). Legacy progressed worlds learn them automatically (storage-research.js:127).
- Pail is not a `cup`: no cup lane (fillCup, purifier, planters, rain barrel) ever sees `bucket` or `milk`.

## 3. Pure core: dist/animals-core.js (still no imports, no DOM, no Math.random)
```js
export const MAX_ANIMALS = 4;            // unchanged meaning: the Puffhen cap (kept for old callers/tests)
export const MAX_SLOTS = 6;              // all species; sizes the module's preallocated arrays
export const MILK_BASE = 300, MILK_CONTENT = 120, MILK_CAP = 1, GOAT_BEAT = 9, GOAT_HOP_T = 2.4, ARRIVE_GOAT_T = 4;
export const GOAT_NAMES = Object.freeze(['Bramble','Nutmeg','Tansy','Barley','Hazel','Mallow','Thistle','Pudding','Juniper','Oats','Fennel','Clove']);
export const SPECIES = Object.freeze({
  puffhen: {prefix:'p', home:'nestbox', code:1, cap:4, label:'Puffhen',     plural:'Puffhens',     names:NAMES,      foods:['seed','leaf'],     lure:[['seed',1],['leaf',3]],     lureMin:20, lureMax:40, beat:BEAT,      hopT:HOP_T},
  goat:    {prefix:'g', home:'goatpen', code:2, cap:2, label:'Bramblegoat', plural:'Bramblegoats', names:GOAT_NAMES, foods:['leaf','seaweed'], lure:[['seaweed',3],['leaf',4]], lureMin:30, lureMax:50, beat:GOAT_BEAT, hopT:GOAT_HOP_T},
});  // deep-freeze the inner objects/arrays too
export const HOME_CODE = {nestbox:1, goatpen:2};
export const milkPeriod = a => (a.content > 0 ? MILK_CONTENT : MILK_BASE) * (1 - HEART_CUT * a.hearts);   // 120 s fed, 300 s otherwise, -3%/heart
export function milk(state, id, bag)          // host; section 3 Actions
export function edgeStart(tileKeys, hx, hz)   // -> [x, z] first off-raft cell from home, for the wade-in
```
- **cleanAnimals (48-85).** Replace the `kind !== 'puffhen'` test (60) with `const S = SPECIES[e.kind]` (own-property check) and `new RegExp('^'+S.prefix+'\\d{1,6}$')` (precompile two regexes).
  An unknown or missing kind is still dropped silently. Replace the `>= MAX_ANIMALS` break (59) with a per-species count: skip when `count[kind] >= S.cap`. Build home sets per type
  from decor (55): `homes = Map("x,z" -> type)` for `nestbox|goatpen`; drop an entry whose home type is not `S.home`. Home keys stay unique across species (a hen and a goat never share a tile).
  Puffhen entries are built exactly as today (68-72). Goat entries: `{id, kind:'goat', name, seed, home, born, hearts, content, prod: num(e.prod,0,MILK_BASE,0), milk: int(e.milk,0,MILK_CAP,0), bondAt}`.
  `next` covers both prefixes (`+e.id.slice(1)`). **Lures** gain an optional `kind`: absent or `'puffhen'` → hen lure written back as `{home, at}` (no key, byte-identical);
  `'goat'` → `{home, at, kind:'goat'}`. Unknown lure kinds are dropped. Cap is per species (residents + lures ≤ cap), `at` clamps to `t..t+S.lureMax`, default `t+S.lureMin`.
- **buildGraph (95-123).** Line 110: keep a cell when `type === undefined || HOME_CODE[type]`; line 112: `box = HOME_CODE[type] ?? 0` (nestbox stays 1, goatpen is 2).
  homeDist, plan and the free-cell rules already treat any non-zero `box` as "not walkable through", so hens never cross pens and goats never cross nest boxes.
- **pose (208-230).** New optional last arg `ht = HOP_T` replaces `HOP_T` inside; `lift` uses `(graph.box[c] ? 1 : 0)` (lines 212, 226) so code 2 still means 1. Callers without `ht` behave as now.
- **edgeStart.** `tileKeys` is a `Set("x,z")` of deck tiles. For d in the fixed order `+x,-x,+z,-z`, step from home until the cell is not in the set (≤ 25 steps); pick the
  smallest step count, first in order on ties. Returns that first outside cell. Deterministic, so host and guests animate the same wade-in.
- **tick (242-269).** Branch on kind. Puffhen: unchanged. Goat: `content = max(0, content-d)`; if `milk < MILK_CAP` then `prod += d`, and at `prod >= milkPeriod(a)`: `milk = 1, prod = 0`,
  push the id to a new `RES.ready` (no rng call); else `prod = milkPeriod(a)` (held). Lures: spawn only while that species' residents < cap; a goat spawn uses `GOAT_NAMES` and
  the same two rng calls (name, seed): `{id:'g'+next++, kind:'goat', name, seed, home, born:t, hearts:0, content:0, prod:0, milk:0, bondAt:-1e9}`. Returns `{laid, arrived, ready}`.
- **Actions.** `lure(state, x, z, bag, t, rng, kind = 'puffhen')`: same checks with `S.cap`, `S.lure` and `S.lureMin/lureMax`; pushes `{home, at}` plus `kind:'goat'` for goats.
  Texts per species: cap `The raft has 2 Bramblegoats`, nofood `Needs 3 Seaweed or 4 Leaves`, ok `You set out some greens… listen for a bleat` (kind `build`).
  `feed`: foods from `SPECIES[a.kind].foods` (bad: `That is not ${label} food`); goat ok text `${name} munches happily · content`. `pet`: unchanged for hens; a goat gets the heart
  and cooldown only (no feather branch). `notarget` texts become `That ${label} wandered off` (hens keep `That Puffhen wandered off`). `rename`: unchanged.
  **milk(state, id, bag)**, in this order: no animal → `notarget`; `kind !== 'goat'` → `bad` "Only goats give milk"; `milk < 1` → `notyet` `${name} has no milk yet · soon`;
  `count(bag,'bucket') < 1` → `nopail` "Hold a Wooden Pail to milk"; swap one pail for one milk inline (copy of `swapOne`, dist/watering.js:127-134: a selected single pail becomes milk in the
  same slot, otherwise scratch-then-commit remove+add) — fails → `full` "Your bag is full". On success `milk = 0, prod = 0` and return
  `{ok:true, kind:'loot', text:`+1 Pail of Milk · thank you, ${name}`}`. A failure changes nothing.

## 4. Module: dist/animals.js
- **Imports/consts (5-17).** Import `MAX_SLOTS, SPECIES, milk, milkPeriod, edgeStart, GOAT_BEAT`. Add `GOAT_R = .34, GOAT_CY = .3, PEN_R = .45, PEN_CY = .3, GOAT_LIFT = .03`, `FOOD_NAME.seaweed = 'Seaweed'`.
- **Slots (30-35).** Every per-animal array sized `MAX_SLOTS`. New `inst = Int8Array(MAX_SLOTS)`: instance index inside its species mesh (k-th hen / k-th goat in `st.list` order),
  filled in `rehome()` (71-79). `rehome` accepts a home only when `graph.box[h] === SPECIES[a.kind].code`. Eggs (`renderEggs`, 173-186) index by `inst[i]*3 + j` and skip goats.
- **build (111-122).** Add `goats = InstancedMesh(goatBodyGeometry(T), birdMat, 2)` and `goatHeads = InstancedMesh(goatHeadGeometry(T), birdMat, 2)`, same setup as line 116.
  Draw calls: 3 → 5, and only while goats exist (`goats.visible = goatHeads.visible = anyGoat`). The idle fast path (214) also covers "no animals at all".
- **Render.** Split `renderBirds` into a per-slot species switch; hens are untouched. Goat beat = `GOAT_BEAT`, `pose(..., GOAT_HOP_T)`, y = `FLOOR_Y + GOAT_LIFT*lift`. See section 5 for motion.
  Store last positions in `lastPos` as today. Unused goat instances get the zero matrix.
- **Picking (243-260).** Goats use `GOAT_R` at `+GOAT_CY`; decor loop also tests `goatpen` spheres (`PEN_R` at deck `+PEN_CY`) → `hit.type = 'pen'`. Nearest hit across hens, goats, boxes and pens wins.
- **Held items.** `heldFood(a)` = selected kind if it is in `SPECIES[a.kind].foods`; `heldPail()` = selected kind is `'bucket'`; `lureFood(kind)` walks `SPECIES[kind].lure`.
- **promptFor (265-286)**, goat and pen rows (hens unchanged; names always through `esc`):

| Target, state | Prompt | E sends |
|---|---|---|
| goat, leaf/seaweed held, content < 300 | `<kbd>E</kbd>Feed ${name} (Seaweed)` / `(Palm Leaf)` | `animals.feed {id, food}` |
| goat, food held, content ≥ 300 | `${name} is full and happy` | nothing |
| goat, pail held, milk ready | `<kbd>E</kbd>Milk ${name}` | `animals.milk {id}` |
| goat, otherwise | `<kbd>E</kbd>Pet ${name} ♥ ${hearts}` + ` · has milk (hold a Wooden Pail)` if ready and no pail, else ` · milk soon` if pail held, else ` · content` if content > 0 | `animals.pet {id}` |
| pen, resident, pail held, milk ready | `<kbd>E</kbd>Milk ${name}` | `animals.milk {id}` |
| pen, resident | `<kbd>E</kbd>Rename ${name}` | opens dialog with label `Bramblegoat` |
| pen, lure pending | `Hay Corner · a Bramblegoat is on its way…` | consumes E |
| pen, goat cap reached | `Hay Corner · the raft has 2 Bramblegoats` | nothing |
| pen, no food | `Hay Corner · needs 3 Seaweed or 4 Leaves` | nothing |
| pen, empty | `<kbd>E</kbd>Set out greens to lure a Bramblegoat (3 seaweed)` / `(4 leaves)` | `animals.lure {x, z}` |

  Holding `milk` at a goat is "otherwise" (pet), never a second milking. The vitals LMB Drink tip (priority 0) coexists with these (content prompt priority 1).
- **interact (290-308).** As today, plus the milk rows. Local feel only: squish + heart on pet/feed/milk, and `eatAt[i] = local` on a feed for the head-bob.
- **action (337-364).** Lure/collect tile check (346) becomes `decorAt` must equal the home type for the verb: `lure` accepts `nestbox` (hen) or `goatpen` (goat, passes `kind`);
  `collect` stays `nestbox` only ("That spot has no nest box"). New `verb === 'milk'`: `idOk`, find animal, `birdPos` reach `REACH + 1.5` (as feed), `bag` required, then `milk(st, id, bag)`.
  Feed validation (357) uses `SPECIES[an.kind].foods`. Unknown verbs stay swallowed. `full` maps to effect kind `full`. Guests still return true at line 339 and never touch their bag.
- **step (218-225).** Arrival toast per species: goat `A Bramblegoat climbed aboard! Say hi to ${name}` to `'all'`. `res.ready` bumps `r` (no toast; the prompt shows it).
- **serialize (369-382).** Hen entries keep exactly today's key order. Goats: `{id, kind:'goat', name, seed, home, born:r1, hearts, content:round, prod:round, milk, bondAt}`.
  Lures map `kind` through only for goats. Payload grows by ≤ 2 × ~100 B.
- **pruneHomes (96-107)** works unchanged because `cleanAnimals` now prunes per home type. **decorModel (458-463):** `'goatpen'` → `goatPenModel(T)`. **dispose:** add both goat meshes.
- **Debug (404-448).** `spawn(x, z, kind = 'puffhen')` places `SPECIES[kind].home` decor; `spawnGoat(x, z)` shorthand; `give()` also adds 1 `bucket`; `milkNow()` sets every goat's `milk = 1` (host); `edge(id)`.

## 5. Motion (all local render, from the synced clock; nothing new is sent)
- **Walk.** No hop. Per step fraction f: body bob `y += .015*|sin(2π*2f)|`, roll sway `sin(2π*2f)*.05`, head nods `.08*sin(2π*2f)`. Turn rate as hens (12 moving, 4 idle).
- **Idle** (`plan.idle`): 0 graze = head pitched down .55 rad with a chew bob `.12*sin(clock*10)` for 3 s of each beat; 1 ear-flick/tail-wag = small body roll `.06*sin(clock*7)`;
  2 look = head yaw `.7*sin(clock*1.1 + seed%7)`.
- **Eating head-bob.** For 2.5 s after a local feed (`eatAt`), graze pose overrides idle/walk. Head matrix = body matrix × neck offset `(0, .4, .17)` × head rotation (pitch, yaw).
- **Arrival (wade-in, `ARRIVE_GOAT_T = 4 s`).** Start point = `edgeStart(tileKeys, home)` (tileKeys rebuilt with the graph). 0-1.2 s: rise from y -.35 to `FLOOR_Y` at the edge with
  a shake (`sxz *= 1+.06*sin(clock*30)`), 1.2-4 s: walk straight to the pen centre with the walk bob. Then the wander starts. No flying in.
- **Squish on E:** goats use half the hen amplitude (`.12`).

## 6. Models: dist/animals-models.js (MODEL-STYLE: merged, vertex-coloured, `vertexMaterial`, origin at the feet, nose +z)
Palette: cream `0xf6ead2`, cream shade `0xe6d3b0`, toffee `0xc0803f`, toffee dark `0x94592c`, horn `0xd9c6a0`, hoof `0x5a4130`, nose pink `0xe8a7a0`, eye `0x22191a` + white glint.
- **goatBodyGeometry** (~0.55 m to the top of the head; body ≤ 900 tris): a round barrel body ball (0.2 × 0.17 × 0.27 at y .3), a toffee saddle patch ball flattened over the back
  (slightly offset, chunky), four short stubby leg cylinders (r .035, h .17) with dark hoof caps, a little up-flicked toffee tail cone, and a neck stub toward `(0, .4, .17)`.
- **goatHeadGeometry** (origin at the neck pivot; ≤ 600 tris): a rounded head ball (0.1 × 0.095 × 0.12) forward of the pivot, a cream muzzle ball with a pink nose, big dark eyes with glints,
  two floppy ear ovals angled down-out (toffee inside face colour), two **nub horns** (short blunt cones h .05, horn colour, never pointy) and a **tiny beard** (3 short cream-shade cones under the chin).
  Head top lands at ~0.55 m in the rest pose. Combined goat ≤ 1.5k triangles.
- **goatPenModel** "Hay Corner" (Group of 1 mesh, ≤ 3000 tris, ~0.8 m, footprint ≤ 1.7 × 1.7): an L of low slatted fence on the back (-z) and left (-x) edges of the tile — rounded
  dark-wood posts and two light-wood rails per side, rope lashings at the corner — plus a domed hay pile in the back-left corner (two squashed balls + 10 straw cones, straw/strawDk from the
  nest box) and a tiny wooden feed trough on the left rail. Front and right stay open so the goat stands at the tile centre. Name `decor_goatpen`.
Check with `python tools/model-sheet.py` per MODEL-STYLE ("Checking") at 200 px and 64 px: cream/toffee contrast must read; horns read as nubs.

## 7. Save, old saves and older builds
- `world.ext.animals` stays `{v:1, r, t, next, list, lures}`. Hen entries and hen lures serialize byte-for-byte as before. Goat entries/lures are additive.
- **Old save → new build:** no goats, `load(undefined)` and hen-only data load unchanged (test). Bags never had the new kinds.
- **Goat save → older build:** its `cleanAnimals` drops `kind:'goat'` entries silently (old core:60) and prunes goat lures (home not a nestbox); the `goatpen` decor is dropped by old
  `cleanWorld`; a bag holding `bucket`/`milk` resets (content-items.js:4). Hens survive. This is the same accepted forward risk earlier kinds took; note it in the changelog.
- Mixed-version co-op is not supported (same as previous features); a new guest with an old host simply sees no goats.

## 8. Co-op flow
Host only mutates `st` and runs `tick`. Guests render goats from `d.list` + their own clock (snap/slew unchanged) and the synced tiles/decor/pieces/grills, so the wander and wade-in match.
Milk readiness comes only from host state: a guest's prompt reads `a.milk` from the last `d.list`. Guest E with a pail: local squish/heart, then `ctx.action({kind:'animals.milk', id})`;
the guest never calls a swap locally (`action` returns true early on guests). The host validates id, reach (`ctx.other`) and the guest's bag, swaps the pail in that bag,
bumps `r` and toasts the guest; the new bag and `milk:0` arrive with the next state. Two players milking the same goat in one tick: the second gets `notyet`, nothing lost.

## 9. Tests: tests/goats.test.mjs (node:test, same import/base pattern as tests/animals.test.mjs:3-13)
1. SPECIES: frozen; prefixes `p`/`g`; homes `nestbox`/`goatpen`; caps 4/2; `MAX_SLOTS === 6`; `MAX_ANIMALS === 4`.
2. cleanAnimals: a hen-only v1 fixture round-trips deep-equal (and module serialize JSON-equal); goat clamps (`milk` 0..1, `prod` 0..300); `g`-id with `kind:'puffhen'` and `p`-id goat dropped;
   unknown species dropped without throwing; per-species caps (5 hens + 3 goats → 4 + 2); goat lures keep `kind`, hen lures have no `kind` key; `next` covers `g` ids.
3. Home pruning: a goat on a nestbox tile and a hen on a goatpen tile are dropped; a hen and a goat never share a home.
4. buildGraph: goatpen is a node with `box === 2`; homeDist never crosses a pen or a box; `pose` `lift` is 0..1 on code-2 homes; `pose(..., GOAT_HOP_T)` continuous, no NaN.
5. edgeStart: shortest direction, tie order `+x,-x,+z,-z`, result is off-raft, deterministic.
6. tick: goat milk at 300 s unfed, 120 s content, 10 hearts → 84 s; milk caps at 1 and holds prod; `ready` lists the id; goats never touch eggs/feather; a goat lure arrives with a `g` id and a GOAT_NAMES name; the goat cap stops a third goat while hens still arrive.
7. lure goat: 3 seaweed first, then 4 leaf, `nofood` with 2 leaf, `busy`, `cap` text names Bramblegoats; hen lure behaviour unchanged.
8. feed goat: leaf and seaweed ok, seed → `bad`; full refuse; heart cooldown. pet goat: heart, no feather.
9. milk: `notyet`, `nopail`, a selected single pail becomes milk in the same slot, a pail stack of 2 with a full bag → `full` and no change, `bad` on a hen; success resets `milk`/`prod`.
10. Items/vitals: `ITEM_INFO.bucket/milk/goatpen` exist (stack 5/5/20); recipes cost `{wood:3, rope:1}` and `{wood:4, leaf:3, rope:1}`; `FOOD.milk.returns === 'bucket'`; `eatLabel('milk')` starts with `Drink`; `goatpen` in `CONTENT_DECOR`; `learnedFrom(['wood','rope','leaf'])` includes both recipes.
11. Module stub ctx: guest `animals.milk` returns true and changes neither state nor bag; host `animals.milk` out of reach → "Step a little closer"; host success bumps `r`; malformed milk actions (`id` 9 chars, non-string) swallowed; `decorModel('goatpen')` is an Object3D; prompt for a held pail at a ready goat is `<kbd>E</kbd>Milk …`, holding milk shows Pet.
12. Models: goat body + head merged, finite, colour attribute, combined bbox top 0.5-0.6 m, triangles ≤ 1500; `goatPenModel` builds.
Also run `npm test`, shoot.py (`errors: []`), `node tests/coop-e2e.mjs` (ignore test 4), and a Playwright pass: `debug.spawnGoat()`, `ff(120)` after a feed, craft a pail, milk, drink (pail returns), guest milks once.
