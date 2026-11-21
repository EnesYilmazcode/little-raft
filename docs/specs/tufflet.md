# Spec: the Tufflet (a third raft animal that gives wool)

Source: docs/features/wool-animal-research.md. Builds on docs/specs/raft-animals.md and docs/specs/goats.md (read both; everything not named here stays as it is).
Cozy rules hold: a Tufflet never gets hungry, never leaves on its own, never dies and does no damage. Feeding only speeds wool up. Shearing never hurts it and never wears out the shears.
Line numbers refer to the current tree. No new npm deps. tests/animals.test.mjs and tests/goats.test.mjs stay unchanged and green.

## 1. Ids and files
New kinds: `tuftnook` (decor, "Tuft Nook"), `shears` ("Shell Shears"), `wool` ("Tuft Wool"), `tuftrug` (decor, "Tuft Rug"), `blanket` (decor, "Cosy Blanket").
Recipes: `tuftnook`, `shears`, `woolrope` (alt rope, output `rope`), `tuftrug`, `blanket`. Icons: `icon-tuftnook`, `icon-shears`, `icon-wool`, `icon-tuftrug`, `icon-blanket`.
None of the ids exist anywhere in dist/ today (grep checked). Tufflet ids `t1..t999999`. Ext key stays `animals` (`v:1`), prefix `animals.`, one new verb `animals.shear`.

| File | Change |
|---|---|
| dist/animals-core.js | table-driven species (no more hen-or-goat branches), `tufflet` row, `MAX_TOTAL`, `HOME_TYPES`, `woolPeriod`, `shear()` (section 3) |
| dist/animals.js | slots sized `MAX_TOTAL`, per-species instance index, tufflet meshes/render/picking/prompts, `animals.shear`, table-driven serialize, nook veto, debug (section 4) |
| dist/tufflet-models.js | **new**: `tuffletBodyGeometry`, `tuffletFluffGeometry`, `tuftNookModel`, `tuftRugModel`, `blanketModel` (section 6) |
| dist/animals-models.js | one line at the end: `export { part, merge, ball, hash };` (helpers at :14, :31, :48, :49) so the new file reuses them |
| dist/content-items.js | items after :37, recipes after :112, `CONTENT_DECOR` (:143) + 3 ids, `CONTENT_BLOCK_RADIUS` (:144) + 2 radii |
| dist/craft-book.js | category (:42), desc (:164-166), how (:473) rows |
| dist/survival-ui.js | `SPRITES` (:26) + 5 ids; `SPRITE_FOR` (:41) + 5 rows |
| dist/icons.svg | five `<symbol viewBox="0 0 48 48">` after `icon-milk` ends (:590) |
| dist/live.js | `PRELOAD` (:17) + `'tufflet-models.js'` (tests/live-preload.test.mjs keeps it in step with the static imports) |
| tests/tufflets.test.mjs | **new** (section 9) |

## 2. Items, recipes, gating (dist/content-items.js)
- Items (after :37): `tuftnook: item('tuftnook','Tuft Nook','icon-tuftnook',false)`, `wool: item('wool','Tuft Wool','icon-wool',false)` (stack 20),
  `tuftrug: item('tuftrug','Tuft Rug','icon-tuftrug',false)`, `blanket: item('blanket','Cosy Blanket','icon-blanket',false)`,
  `shears: Object.freeze({kind:'shears', name:'Shell Shears', icon:'icon-shears', maxStack:1, tool:false, placeholder:false})` (no durability, like `fins` :50; not a TOOL_KIND).
- Recipes (after :112): `tuftnook: recipe('tuftnook','Tuft Nook',1,{wood:3, leaf:3, rope:2})`, `shears: recipe('shears','Shell Shears',1,{scrap:2, shell:1, rope:1})`,
  `woolrope: Object.freeze({id:'woolrope', name:'Wool Rope', output:Object.freeze({kind:'rope', count:2}), cost:Object.freeze({wool:1})})` (same pattern as `egglamp` :110),
  `tuftrug: recipe('tuftrug','Tuft Rug',1,{wool:3, rope:1})`, `blanket: recipe('blanket','Cosy Blanket',1,{wool:4, leaf:1})`.
- `CONTENT_DECOR` (:143) + `'tuftnook','tuftrug','blanket'`. `CONTENT_BLOCK_RADIUS` (:144) + `tuftnook:.35, blanket:.25`; `tuftrug` has none (flat, walk-over, like `rug`).
- Gating: no `STARTER` edit; all unlock through `learnedFrom` (storage-research.js:40-46) once their cost kinds are seen. `shears` needs a `shell` (Pim's barge, craft-book.js:483), so wool is mid-game.
- `woolrope` must come after the base rope recipe in `RECIPES` order (content recipes merge after items.js:131-133), so `sourceOf('rope')` (craft-book.js:503-510) still reads "Craft it from 2 Palm Leaf." (tests/craft-ux.test.mjs).
- Blanket and rug are pure decor: R turns them while placing (game.js:1970), no sleep or vitals change in v1.

## 3. Pure core: dist/animals-core.js (still no imports, no DOM, no Math.random)
```js
export const MAX_SLOTS = 6;   // unchanged value and meaning for old callers/tests (hens + goats, asserted at tests/goats.test.mjs:31)
export const MAX_TOTAL = 8;   // NEW: every species (4 + 2 + 2); sizes the module's preallocated arrays. A test asserts it equals the sum of caps.
export const WOOL_BASE = 360, WOOL_CONTENT = 150, WOOL_CAP = 2, TUFT_BEAT = 8, TUFT_HOP_T = 2.0, ARRIVE_TUFT_T = 4;
export const TUFT_NAMES = Object.freeze(['Puffin','Mochi','Thimble','Lumi','Wisp','Nougat','Bramling','Dewdrop','Fable','Pompom','Tumble','Marshmallow']); // all ≤ 14 chars
// SPECIES gains a third row and, on every row, the fields below (existing fields keep their values; :16-19):
//   stock: [[key, cap], ...] per-species counters in save order; prodMax; base, fed (production periods); tail: extra time keys after bondAt;
//   texts: busy, nofood, needs, lured, fedText, arrive, homeName (display name of the home decor)
puffhen: {..., stock:[['eggs',EGG_CAP],['feather',FEATHER_CAP]], prodMax:EGG_BASE, base:EGG_BASE, fed:EGG_CONTENT, tail:['featherAt'],
          busy:'This nest box already has a guest', nofood:'Needs 1 Palm Seed or 3 Leaves', needs:'You need a Palm Seed or a Leaf',
          lured:'You scatter seeds… listen for a chirp', fedText:'gobbles it up', arrive:'A Puffhen settled in! Say hi to ', homeName:'Nest Box'},
goat:    {..., stock:[['milk',MILK_CAP]], prodMax:MILK_BASE, base:MILK_BASE, fed:MILK_CONTENT, tail:[], busy:'This hay corner already has a guest',
          nofood:'Needs 3 Seaweed or 4 Leaves', needs:'You need Seaweed or a Leaf', lured:'You set out some greens… listen for a bleat',
          fedText:'munches happily', arrive:'A Bramblegoat climbed aboard! Say hi to ', homeName:'Hay Corner'},
tufflet: {prefix:'t', home:'tuftnook', code:3, cap:2, label:'Tufflet', plural:'Tufflets', names:TUFT_NAMES, foods:['seaweed','berries'],
          lure:[['berries',2],['seaweed',4]], lureMin:40, lureMax:60, beat:TUFT_BEAT, hopT:TUFT_HOP_T, stock:[['wool',WOOL_CAP]], prodMax:WOOL_BASE,
          base:WOOL_BASE, fed:WOOL_CONTENT, tail:[], busy:'This tuft nook already has a guest', nofood:'Needs 2 Island Berries or 4 Seaweed',
          needs:'You need Seaweed or Island Berries', lured:'You set out berries… listen for a soft trill', fedText:'nibbles it up',
          arrive:'A Tufflet paddled aboard! Say hi to ', homeName:'Tuft Nook'},
export const HOME_CODE = Object.freeze({nestbox:1, goatpen:2});       // unchanged (tests/goats.test.mjs:32); no longer read by the core
export const HOME_TYPES = deepFreeze(Object.fromEntries(Object.values(SPECIES).map(S => [S.home, S.code]))); // {nestbox:1, goatpen:2, tuftnook:3}
export const KIND_OF_HOME = deepFreeze(Object.fromEntries(Object.entries(SPECIES).map(([k, S]) => [S.home, k])));
export const woolPeriod = a => (a.content > 0 ? WOOL_CONTENT : WOOL_BASE) * (1 - HEART_CUT * a.hearts); // 360 s / 150 s fed, -3 %/heart
export const periodOf = a => { const S = SPECIES[a.kind]; return (a.content > 0 ? S.fed : S.base) * (1 - HEART_CUT * a.hearts); }; // eggPeriod/milkPeriod (:272-273) stay as exports
export function shear(state, id, bag)          // host; below
export function entryOf(kind, e, t)            // the one clean entry builder; below
```
- **Ids.** `ID_RE` (:23) built from the table: `Object.fromEntries(Object.entries(SPECIES).map(([k,S]) => [k, new RegExp('^'+S.prefix+'\\d{1,6}$')]))` (once). `KIND_OF_PREFIX = {p,g,t}` likewise.
- **entryOf(kind, e, t).** Builds keys in this exact order: `id, kind, name, seed, home, born, hearts, content, prod`, then each `stock` key (`int(e[k],0,cap,0)`), then `bondAt`,
  then each `tail` key (`num(e[k],FAR_PAST,t,FAR_PAST)`). `prod = num(e.prod,0,S.prodMax,0)`. Hens give `...prod, eggs, feather, bondAt, featherAt`, goats `...prod, milk, bondAt`
  (both exactly as :81-94 today), tufflets `...prod, wool, bondAt`. Replaces the two literals in `cleanAnimals` (:81-94) and the spawn literals in `tick` (:313-315; there `e = {}` with name/seed/home/born filled and `bondAt`/tail = FAR_PAST).
- **cleanAnimals (:61-110).** `per` (:69) = `Object.fromEntries(Object.keys(SPECIES).map(k => [k, 0]))`. Home map (:68) and buildGraph (:135, :137) read `HOME_TYPES` instead of `HOME_CODE`.
  Lures (:98-105): `kind` absent or `'puffhen'` → hen lure written `{home, at}` (no key, byte-identical); any other own SPECIES key → `{home, at, kind}`; unknown → dropped (as now).
- **Labels.** `gone(id)` (:274) = `` `That ${SPECIES[KIND_OF_PREFIX[id?.[0]]]?.label ?? 'Puffhen'} wandered off` `` (hen and goat texts unchanged). `labelOf` (:275) = `SPECIES[a?.kind]?.label ?? 'Puffhen'`.
- **tick (:284-320).** `if (a.kind === 'puffhen')` keeps the hen block (:295-303) verbatim (the only rng call per lay). Every other kind runs the generic stock path, which is today's goat
  code (:290-292) with `k = S.stock[0][0]`, `cap = S.stock[0][1]`: `if (a[k] < cap) { a.prod += d; if (a.prod >= periodOf(a)) { a[k]++; a.prod = 0; RES.ready.push(a.id); } } else a.prod = periodOf(a);`
  (goat: 0 → 1 = MILK_CAP, unchanged). A tufflet grows one tuft per period up to 2; a full coat holds prod. Lure spawn (:309): `kind = own(SPECIES, l.kind) ? l.kind : 'puffhen'`, id `S.prefix + next++`, same two rng calls.
- **lure (:328-340).** Drop `goat`; texts from `S.busy`, `S.nofood`, `S.lured`; `if (kind !== 'puffhen') lu.kind = kind`. Cap text stays `The raft has ${S.cap} ${S.plural}`.
- **feed (:342-354).** `needs = S.needs`, ok text `` `${a.name} ${S.fedText} · content` ``. **pet (:361):** `if (a.kind !== 'puffhen')` returns heart only (no feather) for goats and tufflets.
- **shear(state, id, bag)**, cloned from `milk` (:392-406), in order: no animal → `notarget` `gone(id)`; `kind !== 'tufflet'` → `bad` "Only Tufflets can be sheared";
  `!(a.wool >= 1)` → `notyet` `` `${a.name}'s fluff is still growing · soon` ``; `count(bag,'shears') < 1` → `noshears` "Hold Shell Shears to shear";
  scratch = `new bag.constructor(bag.snapshot())`, `n = a.wool - scratch.add('wool', a.wool)`; `n === 0` → `full` "Your bag is full"; else `commit`, `a.wool -= n; a.prod = 0`,
  return `{ok:true, kind:'loot', wool:n, text:`+${n} Tuft Wool · thank you, ${a.name}`}`. Shears are never removed. A failure changes nothing.

## 4. Module: dist/animals.js
- **Imports (:6-11).** Add `MAX_TOTAL, HOME_TYPES, KIND_OF_HOME, shear, TUFT_BEAT, TUFT_HOP_T, ARRIVE_TUFT_T`; import the five builders from `./tufflet-models.js` with the same `?build=` suffix as :11.
  Consts (:19-21): `FOOD_NAME_OF = {puffhen:FOOD_NAME, goat:GOAT_FOOD_NAME, tufflet:{seaweed:'Seaweed', berries:'Island Berries'}}`; `TUFT_R = .3, TUFT_CY = .22, NOOK_R = .4, NOOK_CY = .2, NOOK_LIFT = .06, TUFT_CAP = SPECIES.tufflet.cap`;
  `HEART_Y = {puffhen:.5, goat:.75, tufflet:.6}`; `FLUFF_CY = .24`.
- **Slots (:35-40).** Every `MAX_SLOTS` in this file (:35-40, :83, :153, :247, :293, :329) becomes `MAX_TOTAL`. Add `tuftShown = Uint8Array(TUFT_CAP)` next to :41 and `nk = Int8Array(4)` (per-code counter, no per-call alloc).
- **rehome (:81-95).** `nk.fill(0)` before the loop (replaces `let nh, ng` :82); `inst[i] = nk[SPECIES[a.kind].code]++` replaces :85. Wade-in start (:86) for `a.kind !== 'puffhen'` (goats and tufflets). Home check :92 unchanged (code 3 matches tufflets).
- **build (:127-140).** `tufts = InstancedMesh(tuffletBodyGeometry(T), birdMat, TUFT_CAP)` ('tufflets'), `tuftFluff = InstancedMesh(tuffletFluffGeometry(T), birdMat, TUFT_CAP)` ('tuffletFluff'); add both to the setup loop (:134) and `group.add` (:137).
  Draw calls +2, only while a tufflet exists (`tufts.visible = tuftFluff.visible = anyTuft` next to :292). The visibility loop (:290) sets `any[kind]` from a 3-flag scratch.
- **renderAnimals (:151-162).** Per-slot switch `puffhen → renderHen, goat → renderGoat, tufflet → renderTufflet`; zero unused tufflet instances like :160; `needsUpdate` both meshes.
  `renderEggs` (:249) skips `a.kind !== 'puffhen'` (today `=== 'goat'`, which would turn a tufflet into an egg index). `renderHeart` (:269) uses `HEART_Y[kind]`.
- **renderTufflet(i, a)** (cloned from `renderGoat` :200-243, one matrix pair, no head): arrival wade-in over `ARRIVE_TUFT_T` with `edgeX/edgeZ` (paddles up: 0-1.2 s rise from y -.3 with a shake, then waddle to the nook);
  wander `TUFT_BEAT`, `pose(..., TUFT_HOP_T)`, y = `FLOOR_Y + NOOK_LIFT * p.lift`. Section 5 motion. Body matrix `m4` → `tufts`; fluff matrix = `m4 × T(0,FLUFF_CY,0) × S(f) × T(0,-FLUFF_CY,0)`
  with `f = [.8, .9, 1][a.wool]` (trimmed reads at a glance; from synced `a.wool` only, so host and guests agree). Precompute the two translations once.
- **Picking (:325-350).** Tufflet sphere `TUFT_R` at `+TUFT_CY` → `hit.type = 'tuft'`; decor loop (:339) also tests `tuftnook` (`NOOK_R` at `+NOOK_CY`) → `'nook'`. The own-home rule (:336, :345-348)
  generalises to "a goat or tufflet in front of its own pen/nook keeps the aim" (`ownI` for `goat|tuft`, matched against `pen|nook`). Hens unchanged.
- **Held.** `heldShears = () => heldKind() === 'shears'`. `heldFood`/`lureFood` (:352-354) already read `SPECIES`.
- **Prompts** (new `tuftPrompt(a)` / `nookPrompt(h)` beside :357-372, routed in `promptFor` :373; names via `esc`; longest label ≤ 48 chars with a 14-char name and 10 hearts):

| Target, state | Prompt | E sends |
|---|---|---|
| tufflet, seaweed/berries held, content < 300 | `<kbd>E</kbd>Feed ${name} (Seaweed)` / `(Island Berries)` | `animals.feed {id, food}` |
| tufflet, food held, content ≥ 300 | `${name} is full and happy` | nothing |
| tufflet, shears held, wool ≥ 1 | `<kbd>E</kbd>Shear ${name} · ${wool} tuft` / `tufts` | `animals.shear {id}` |
| tufflet, otherwise | `<kbd>E</kbd>Pet ${name} ♥ ${hearts}` + ` · fluffy (hold shears)` if wool and no shears, else ` · fluff growing` if shears held, else ` · content` | `animals.pet {id}` |
| nook, resident, shears held, wool ≥ 1 | `<kbd>E</kbd>Shear ${name} · …` (as above) | `animals.shear {id}` |
| nook, resident | `<kbd>E</kbd>Rename ${name}` | dialog, label `Tufflet` (:433 already passes `SPECIES[kind].label`) |
| nook, lure pending / cap / no food | `Tuft Nook · a Tufflet is on its way…` / `Tuft Nook · the raft has 2 Tufflets` / `Tuft Nook · needs 2 Berries or 4 Seaweed` | nothing (pending consumes E) |
| nook, empty | `<kbd>E</kbd>Set out berries to lure a Tufflet (2 berries)` / `Set out seaweed to lure a Tufflet (4 seaweed)` | `animals.lure {x, z}` |

- **interact (:400-424).** `h.type === 'tuft'` joins the bird/goat branch (:403): feed, else `a.kind === 'tufflet' && heldShears() && a.wool` → `popAt; ctx.action({kind:'animals.shear', id})`, else pet.
  `h.type === 'nook'` mirrors the pen branch (:411-415) with shears/wool. Guest feel only (squish + heart); never a local mutation.
- **action (:453-487).** Lure/collect tile check (:462-463): `const sp = KIND_OF_HOME[type]`; `collect` still needs `nestbox`; `lure` needs any `sp` ("That spot has no nest box" text kept);
  :467 passes `sp` instead of the goat ternary. New `verb === 'shear'` block, a copy of `milk` (:468-473): `idOk` (≤ 8 chars), `findId` → `gone`, `near(actor, birdPos(...))` (`REACH + 1.5`, :446-450) → "Step a little closer",
  `bag` required, `res = shear(st, a.id, bag)`. :485 maps `full` to effect `full` for `collect|milk|shear`. Guests still return true at :455.
- **step (:302).** Toast `SPECIES[a.kind].arrive + a.name` to `'all'` (both old texts unchanged). `res.ready` already bumps `r` (:306).
- **serialize (:497-502).** Table-driven, same keys as `entryOf`: head (`born: r1`, `content/prod: round`), stock keys raw, `bondAt: max(-1e9, round)`, tail keys the same way.
  Lures: `l.kind ? {home, at: round, kind} : {home, at: round}`. Output for hens and goats is byte-identical to today (tested by key order and JSON equality).
- **beforeUndecor (:582-585).** Also veto `tuftnook` with a resident or lure: `'Your tufflet lives here'` (cozy "never leaves"; the nest box text and goat pens stay as they are).
- **decorModel (:592-597).** `tuftnook → tuftNookModel(T)`, `tuftrug → tuftRugModel(T)`, `blanket → blanketModel(T)`. **dispose (:604):** add `tufts, tuftFluff`.
- **Debug (:530-578).** `spawn(x, z, kind)`: `S = SPECIES[own kind] ?? puffhen`, lure pushed with `kind` when not a hen (:533-547); `spawnTufflet(x, z)`; `woolNow()` sets every tufflet `wool = WOOL_CAP, prod = 0` and bumps; `give()` also adds 1 `shears`.

## 5. Motion (local render from the synced clock; nothing new is sent)
- **Waddle** (no hop): per step fraction f, `w = sin(2π·2f)`: bob `y += .02·|w|`, side roll `w·.09`, yaw wiggle `w·.05`. Turn rate 12 moving, 4 idle.
- **Idle** (`plan.idle`): 0 loaf = sit (sy `.9`, sxz `1.06`) for 1-5 s of the beat; 1 fluff shake = roll `.18·sin(clock·22)` for the first .8 s of each 3 s; 2 look = yaw `.6·sin(clock·1.2 + seed%5)`.
- **Eating:** 2.5 s after a local feed (`eatAt`), small nod bob `sy *= 1 - .05·|sin(local·10)|`. **Squish on E:** amplitude `.18`. **Shear feel:** squish only; the coat shrinks when the host state arrives.

## 6. Models: dist/tufflet-models.js (MODEL-STYLE: merged, vertex-coloured, `vertexMaterial`, origin at the feet, nose +z; imports `part, merge, ball, hash` from animals-models.js)
Palette: wool lavender-grey `0xbfb6d6`, wool shade `0xa79fc4`, cream tips `0xf3ecdf`, face `0x8c7f98`, snout `0xb9a9b8`, nose `0x4a3a48`, feet `0x6b5a6e`, eye `0x22191a` + white glint.
- **tuffletBodyGeometry** (≤ 500 tris): the smooth seal-like face ball (0.11 × 0.1 × 0.1) at (0, .24, .15) with a blunt snout ball, dark nose, big eyes with glints, two droopy fluffy ear ovals,
  four stubby paddle feet (flattened balls, r .05) under a small hidden core. No neck.
- **tuffletFluffGeometry** (≤ 900 tris): a cloud of 9-11 chunky puff balls (r .07-.12, `hash` jitter, fixed) around (0, .24, -.02), lavender with cream tips (colour fn by y), leaving the face clear.
  Combined top ~0.45 m, total ≤ 1.4k tris.
- **tuftNookModel** (Group of 1 mesh, ≤ 2000 tris, ~0.3 m tall, footprint ≤ 1.2 × 1.2): a low round woven basket (squashed open cylinder, alternating light/dark weave bands), a driftwood rim torus,
  and a kelp-green pillow ball inside. Name `decor_tuftnook`.
- **tuftRugModel** (≤ 600 tris, 1.5 m round, h .03): concentric wool rings in lavender/cream with a puffy edge of 12 small balls. Name `decor_tuftrug`.
- **blanketModel** (≤ 800 tris, ~0.25 m): a folded stack of three soft slabs (rounded boxes) in lavender/cream stripes with a little rolled pillow on top. Name `decor_blanket`.
Check with `python tools/model-sheet.py` at 200 px and 64 px: trimmed (fluff .8) vs full must read; face must stay visible from the front.

## 7. UI, icons, craft book
- dist/animals-ui.js: no change (`open(id, name, species)` :51-53 already sets "Name your Tufflet").
- dist/icons.svg after :590, original art: `icon-tuftnook` round basket with a pillow; `icon-shears` two shell-shaped blades on a rope pivot; `icon-wool` a lavender puff tuft;
  `icon-tuftrug` a round ringed rug; `icon-blanket` a folded striped blanket. survival-ui.js `SPRITES` (:26) + `'tuftnook','shears','wool','tuftrug','blanket'`; `SPRITE_FOR` (:41) + identity rows.
- dist/craft-book.js: categories (:42) `tuftnook:'survival', shears:'tools', tuftrug:'building', blanket:'building'` (woolrope files under its output `rope`);
  descs (after :166) tuftnook "A woven basket bed with a kelp pillow." / "Place it on the raft and set out berries; a tufflet may come to stay.",
  shears "Little shears with shell blades." / "Hold them and press E on a fluffy tufflet.", wool "A soft lavender tuft." / "Twist it into rope, or make a Tuft Rug or a Cosy Blanket.",
  tuftrug "A round rug of soft wool." / "Place it on a deck tile.", blanket "A folded wool blanket." / "Place it on the raft for a cosy corner.";
  how (after :473) `wool: {tag:'tufflet', how:'Place a Tuft Nook; a tufflet moves in. Hold Shell Shears and press E when it is fluffy.'}`.

## 8. Save format and co-op
- `world.ext.animals` stays `{v:1, r, t, next, list, lures}`. Tufflet entry `{id, kind:'tufflet', name, seed, home, born, hearts, content, prod, wool, bondAt}`; lure `{home, at, kind:'tufflet'}`. ≤ 2 × ~100 B.
- **Old save → new build:** loads unchanged; hen/goat entries and lures serialize byte-for-byte as now. **Tufflet save → older build:** old `cleanAnimals` drops `kind:'tufflet'` (`speciesOf` :73) and its lures (:98-99);
  old `cleanWorld` drops the new decor and a bag with the new kinds resets (content-items.js:4); hens and goats survive. Same accepted forward risk as goats.
- **Co-op.** Host only mutates `st` and ticks. Guests render from `d.list` + synced clock + tiles/decor; wade-in and wander are closed form. Coat size comes only from host `a.wool`.
  Guest E with shears: local squish, `ctx.action({kind:'animals.shear', id})`; host validates id, reach (`ctx.other`), the guest's bag; wool lands in that bag and `wool:0` arrives with the next state.
  Two players shearing in one tick: the second gets `notyet`, no duplicate wool. Mixed-version co-op is unsupported; a new guest with an old host simply sees no tufflets.

## 9. Tests: tests/tufflets.test.mjs (node:test, same import/base/helpers as tests/goats.test.mjs:1-23)
1. SPECIES: tufflet row frozen; prefix `t`, home `tuftnook`, code 3, cap 2; `MAX_TOTAL === 8 ===` sum of caps; `MAX_SLOTS === 6`; `HOME_CODE` still `{nestbox:1, goatpen:2}`; `HOME_TYPES` has 3; `TUFT_NAMES` 12, each ≤ 14.
2. Round trips: hen-only and hen+goat fixtures deep-equal through `cleanAnimals` and JSON-equal through module `serialize` (key order checked); tufflet clamps (`wool` 0..2, `prod` 0..360); `t`-id with another kind dropped; 5+3+3 → 4+2+2; tufflet lures keep `kind`, hen lures have none; `next` covers `t`.
3. Home pruning across three types: a tufflet on a nestbox/goatpen tile dropped and vice versa; `buildGraph` gives `box === 3`; homeDist never crosses a nook.
4. tick: first tuft at 360 s unfed, 150 s content, 10 hearts → 105 s; second tuft; cap 2 holds prod; `ready` lists the id; hen lays use the same rng sequence as before; a tufflet lure arrives with a `t` id and a TUFT_NAMES name and never becomes a hen.
5. lure: berries ×2 first, then seaweed ×4, `nofood` with 1 berry, `busy`, cap text "The raft has 2 Tufflets"; hen and goat lure texts unchanged. feed: seaweed/berries ok, leaf → `bad`; pet: heart, no feather; `gone('t3')` names Tufflet.
6. shear: `notyet`, `noshears`, `bad` on a goat, success adds `wool` and resets prod, shears stay; full bag → `full`, nothing changes; partial fit takes what fits.
7. Items/recipes: five ITEM_INFO rows (shears stack 1), costs as section 2, `RECIPES.woolrope.output` `{kind:'rope', count:2}`, decor/radius rows, `sourceOf('rope')` still the leaf recipe, `learnedFrom` includes them.
8. Module stub ctx: guest `animals.shear` returns true and changes nothing; out of reach → "Step a little closer"; malformed ids swallowed; success bumps `r`; lure on a tuftnook spawns a tufflet lure; `beforeUndecor` vetoes an occupied nook;
   `decorModel` builds all three; prompts (shear, pet tail, nook rows) ≤ 48 chars; `tufflets`/`tuffletFluff` visible only with a tufflet; hen eggs keep their instances with a tufflet listed first.
9. Models: body + fluff merged, finite, colour attribute, top 0.4-0.5 m, ≤ 1.4k tris; nook/rug/blanket within budgets.
Also run `npm test`, shoot.py (`errors: []`), `node tests/coop-e2e.mjs`, and a Playwright pass: `debug.spawnTufflet()`, feed, `ff(150)`, craft shears, shear (coat shrinks), craft Wool Rope, guest shears once.
