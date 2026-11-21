# Spec: Drying Rack (sun-dried snacks)

Source: docs/features/drying-rack-research.md. Cosy rules: no fuel, nothing spoils, burns or is lost, and a raw item can always be taken back down.
New files: `dist/drying-rack-core.js` (pure), `dist/drying-rack.js` (content module), `dist/drying-rack-model.js` (THREE), `tests/drying-rack.test.mjs`.
Edits: dist/vitals.js, dist/content-items.js, dist/content.js, dist/craft-book.js, dist/live.js. **No game.js edit.** One builder.

## 1. Items, recipe, decor (dist/content-items.js)
Insert before `});` at content-items.js:73, with the `item(kind, name, icon, placeholder, max)` helper (:7), all `placeholder:true` (skips the icons.svg/SPRITES
check; ITEM_ICONS art in item-svg.js is optional polish): `dryrack` / Drying Rack / `icon-dryrack` (max 20) · `driedfish` / Dried Fish / `icon-driedfish` (max 30) ·
`kelpcrisp` / Kelp Crisps / `icon-kelpcrisp` (30) · `driedberries` / Dried Berries / `icon-driedberries` (30) · `sharkjerky` / Shark Jerky / `icon-sharkjerky` (30).
Id check: none exist in items.js, ITEM_INFO, RECIPES, DECOR_TYPES or any spec (grepped). **Do not add the snacks to items.js** (tests/progression.test.mjs:180-203).
Recipe, before `});` at :131: `dryrack: recipe('dryrack', 'Drying Rack', 1, { wood: 4, rope: 3, leaf: 2 }),` (early game; research-gated like the cookpot,
learned once wood, rope and leaf are studied, storage-research.js:40). Append `'dryrack'` to `CONTENT_DECOR` (:134) and `dryrack: .4` to `CONTENT_BLOCK_RADIUS` (:135).
game.js:86 DECOR_TYPES and :220 cleanWorld then accept the decor; inventory-state.js:33/:57 register the kinds for saves and co-op.

## 2. Food rows (dist/vitals.js)
Append to the static `FOOD` table after the `milk` row (vitals.js:43). **Never call `addFood` and never import vitals.js from the module** (juicer.js:6: a
stamp-less copy gets a second FOOD table). Rows: `driedfish {food:10, water:0}`, `kelpcrisp {food:5, water:0}`, `driedberries {food:6, water:1}`,
`sharkjerky {food:12, water:0}`, each tagged `// [dryrack]`. None end in `cup`, so `isDrink` (:101) is false and click-to-eat (game.js:726, :1361-1366) works unchanged.
Trade-off: raw fish is 12.5/-10 and raw shark 10/-5; drying removes the salt penalty and gives a 30-stack, the grill still wins on food.

## 3. Pure core: dist/drying-rack-core.js (no imports, DOM, THREE, Date or Math.random)
```js
export const RACK = Object.freeze({ HOOKS:4, DRY_SECS:150, MAX_DT:1, REACH:3.2, MAX_RACKS:100, RAIN_STOP:.2 });
export const DRY = Object.freeze({ fish:{out:'driedfish', mul:1}, seaweed:{out:'kelpcrisp', mul:.8}, berries:{out:'driedberries', mul:.8}, sharkmeat:{out:'sharkjerky', mul:1.5} });
export const INPUTS = Object.freeze(Object.keys(DRY)), OUTPUTS = Object.freeze(INPUTS.map(k => DRY[k].out));
export const RACK_ACTIONS = Object.freeze(['rack.hang', 'rack.take']);
export const NAMES = Object.freeze({ fish:'fish', seaweed:'seaweed', berries:'berries', sharkmeat:'shark meat', driedfish:'Dried Fish', kelpcrisp:'Kelp Crisps', driedberries:'Dried Berries', sharkjerky:'Shark Jerky' });
export const keyOf = (x, z) => x + ',' + z;
export const secsOf = kind => RACK.DRY_SECS * DRY[kind].mul;      // fish 150, seaweed/berries 120, sharkmeat 225 at rate 1
export function dryRate(rain, wind, night)   // 0 when rain >= .2, else (.3 + .7*(1-night)) * (.8 + .6*wind); non-finite inputs -> 0,.15,0
export function rateLabel(rain, wind, night) // 'paused (rain)' | 'slow (night)' (night > .5) | 'breezy' (wind > .45) | 'drying'
export function cleanEntry(raw)              // -> {h:[hook|null x4]} | null when no hooks
export function cleanSlice(data, decorAt)    // -> {k, r}; decorAt optional, drops non-'dryrack' tiles
export function sliceOf(st)                  // -> {v:1, r, k} deep copy, t rounded to 0.1, empty entries omitted
export function progress(hook)               // 0..1 (1 for a done hook, 0 for null)
export function stepAll(st, dt, rate, onDone) // -> true when any hook's whole percent changed or finished
export function applyRackAction(st, a, actor, bag, env) // -> {ok, reason?, text, n?}
```
**Hook:** `{i:input, t:secs}` while drying, `{o:output}` when done. **cleanEntry:** non-object or `h` not an array → null; take the first 4 elements; a hook with `i`
in INPUTS gets `t` finite clamped to `0..secsOf(i)` (else 0) and becomes `{o:DRY[i].out}` when `t >= secsOf(i)`; `o` in OUTPUTS stays; anything else → null.
Pad to 4. All null → null. **cleanSlice:** keys match `/^(-?\d{1,2}),(-?\d{1,2})$/` with |x|,|z| ≤ 25, at most MAX_RACKS, `r` integer ≥ 0 (else 0); never throws.
**stepAll:** clamp dt to 0..MAX_DT (NaN → 0) and rate to 0..2 (NaN → 0); return false at once when `dt*rate === 0`. for..in over `st.k`, plain loop over hooks,
no allocation: `before = floor(t/secs*100)`, `t += dt*rate`; on `t >= secs` replace the hook with `{o}` (the only allocation, once per finish) and call
`onDone(key, e)` if no `i` hook is left on that rack; changed when finished or `floor(t/secs*100) !== before`. The caller does `st.r++` on true: at most ~1 bump per
1.2 s per hook at the fastest rate.
**applyRackAction:** `a = {kind, x, z, item?}`, `env = {decorAt(x,z), pos(actor)}` (kiln contract). Common checks in order: `bad` (unknown kind, x/z not an
integer within ±25, bag without `slots`/`count` or `slots.length` not 28 or 40 (the satchel; kiln-core.js:136 checks only 28)) → `missing` (`decorAt !== 'dryrack'`) → `reach` (`hypot(p.x-x*2, p.z-z*2) > REACH`, null pos → reach).
- **hang** (`item` in INPUTS, else `bad`): `nothing` if `bag.count(item) < 1`; `full` if all 4 hooks are used. Success: `scratch = new bag.constructor(bag.snapshot())`,
  `scratch.remove(item, 1)` (selected slot first), commit `scratch.slots` into `bag.slots`, put `{i:item, t:0}` on the first null hook.
- **take**: if any done hooks, take only those; otherwise take the drying hooks back as their raw input (progress lost, nothing consumed). `empty` if no hooks.
  Add each taken hook's kind to the scratch bag one by one, stopping at the first that does not fit; none fit → `bagfull`. Commit, null the taken hooks,
  delete the key when all 4 are null. `n` = items moved; a partial take leaves the rest hung.

All checks happen before any change; a refusal changes nothing; every success does `st.r++`.
TEXT: bad 'That didn’t work' · missing 'That spot has no drying rack' · reach 'Step a little closer' · nothing 'You have none to hang' · full 'All 4 hooks are full' ·
empty 'Nothing on the rack' · bagfull 'Your bag is full'. Success: hang `Hung up ${name} · ${used}/4` · take `+ ${n} ${name}` (name of the first kind, `+ n snacks` if mixed).

## 4. Module: dist/drying-rack.js, `createDryingRack(ctx)`, name `'dryrack'`
Mirror kiln.js. Copy `decorAt`/`posOf` (kiln.js:20-21) and the ray `target(aim)` (kiln.js:26) filtered to `'dryrack'`. **State:** `st = {k:{}, r:0}`.
**Weather:** `bindRain(fn)` stores `rainFn` (content.js:135); `link(env)` stores `env` (content.js:139-140). Each update: `rate = dryRate(rainFn?.() ?? 0,
env?.wind() ?? .15, env?.night() ?? 0)`. With `?daynight=off` this is the calm rate (~0.89 day; 150 s fish ≈ 2.8 min; breezy day 1.22; night 0.27).
**serialize()** always returns an object: cached `sliceOf(st)`, rebuilt only when `st.r` changes, so guests can detect the feature.
**load(data, from):** `'net'`: `gotNet = true; hostHas = data !== undefined` (juicer.js:177 pattern), return early if `data?.r === netR`, else `st = cleanSlice(data)`
(no pruning), `dirty = true`. `'save'`/`'restore'`: `st = cleanSlice(data, decorAt)`. `undefined` → `{k:{}, r:0}`.
**update(dt):** host only (`ctx.role !== 'guest'`): `if (stepAll(st, dt, rate, onDone)) st.r++`; onDone emits `{kind:'notice', text:'The drying rack is done: N
snacks ready'}` to 'all'; 1 s prune of keys whose `decorAt !== 'dryrack'` (kiln.js:99-114). Then visuals (§5). Allocation-free outside onDone and rescans.
**action(a, actor, bag):** false unless `a.kind` starts with `'rack.'`; run applyRackAction and return true. Emit to the actor `{kind:'loot', text}` on take, `{kind:'build',
text}` on hang, `{kind: reason==='bagfull' ? 'full' : 'notice', text}` on refusals (kiln.js:145).
**interact(aim):** no target → false (never claims E elsewhere, so the cookpot keeps its meal-eat). Guest with `!gotNet` → notice 'Wait for your raft to connect';
guest with `!hostHas` → `ctx.notice(OLD_HOST, 2400)` where `export const OLD_HOST = 'Your friend’s raft doesn’t have a drying rack yet'`. Else `sel` in INPUTS
and a free hook → `rack.hang {x, z, item:sel}`; else the entry has any hook → `rack.take {x, z}`; else `ctx.notice('Hold fish, seaweed, berries or shark meat to hang it')`.
Return true in all these cases; a guest never mutates `st`.
**prompt(aim):** null without a target; OLD_HOST text for an old host. **Every prompt starts with `<kbd>E</kbd>`** (game.js:786, else a held fish shows "Click Eat").
Verb: `Hang ${name}` (raw held, hook free) · `Take ${n} ${out}` (done hooks) · `Take down ${n} ${name}` (only drying hooks) · `Drying Rack`. Status joined with ` · `:
`${used}/4`, the lowest drying pct `63%`, then `rateLabel(...)` while anything dries, or `${d} ready`. Escape via `ctx.esc`; cache by (key, st.r, sel, pct, label).
**Undecor** (kiln.js:193-198; do **not** add to NO_UNDECOR, content.js:98): `beforeUndecor` → null (never vetoes); `undecorLoot(d)` → array of `[kind, n]` (content.js:39), raw input for
drying hooks and output for done ones, merged by kind; `afterUndecor(d)` deletes the key and bumps `st.r`. Nothing is lost.
**decorModel(type):** 'dryrack' → `model ??= buildDryingRack(T)`, `dirty = true`, `model.instance()`; else null. **dispose()** → `model?.dispose()`.
**debug** (`raftDebug.content.dryrack`, mutators host only, false for a guest): `state()` (slice + `rate`, `label`), `spawn(x=0,z=0)` (decor + `rebuildRaft()`),
`give(kind, n=10)`, `hang(x, z, kind)`, `finish(x, z)` (all drying hooks done, bump r), `run(sec, rate=1)` (1-s steps), `clear()`.

## 5. Model: dist/drying-rack-model.js
`buildDryingRack(T)` → `{instance(), setHook(group, i, kind, pct), sway(group, time, wind), dispose()}`; geometry and materials built once and shared.
Origin tile-top centre, footprint ~.9×.5, height ~1.1, the line along x. **5 meshes, only the frame casts a shadow.**
1. `rackFrame`: one merged vertex-coloured geometry (MeshStandardMaterial, roughness .9): two A-frames of 2 legs each (boxes .05×1.1×.05 tilted ±.3 rad, #8a6a45,
   jittered), a top ridge pole .9 long (#7a5b3a), a low cross brace per side, and the twine line: a thin cylinder r .008 from x -.42 to .42 at y .95 (#d9c79a).
2. `rackHook0..3`: one Group per hook at x = -.3, -.1, .1, .3, y .95 (the pivot), each holding one Mesh hanging below it (y -.12) with a tiny twine loop merged in.
   Geometry per kind (shared): fish = flattened ellipsoid .06×.2×.025; seaweed = 3 thin strips merged .08×.24; berries = a bunch of 5 spheres r .025;
   sharkmeat = box .07×.18×.03. Hidden when the hook is null.
**Colour change:** 4 shared materials per kind (16 total, no per-instance clones), a ramp from wet to dried; `setHook` picks step `min(3, floor(pct*4))` and 3 when done.
fish #9fb7c4 (silver-wet, slight metalness) → #b08a5a (golden-brown); seaweed #2f7a4a (glossy, roughness .35) → #4a5a2a (matte, roughness .95); berries
#c2335a → #6e2440 (smaller scale .85 when done); sharkmeat #d97a7a → #7a3f2e. Drying hooks are darker and glossier, done hooks matte.
**Sway:** `sway(group, time, wind)` sets per hook `rotation.z = (.04 + .22*wind) * sin(time*(1.6+.8*wind) + i*1.3)` and a small `rotation.x` at half amplitude.
**Visuals in update:** rescan when `dirty` or `ctx.raft.children.length` changed (preallocated array ≤100, groups named `'dryrack_station'`, keys
`keyOf(round(x/2), round(z/2))`). Apply `setHook` when `st.r !== shownR` or after a rescan. Sway only for racks within **12 m** of `ctx.camera` (preallocated Vector3,
`getWorldPosition`) that have a hook; far racks keep rotation 0. No sway work at all when no rack is near.

## 6. Wiring (exact hooks)
- `content.js:82`: add above it `import { createDryingRack } from './drying-rack.js?build=v3-survival-ae77fa84ac2b'; // [dryrack]`. The module's own imports
  (`./drying-rack-core.js`, `./drying-rack-model.js`) carry the same `?build=` stamp (tests/live-preload.test.mjs:47, module-specifiers.test.mjs:27).
- `content.js:95` FEATURES: `..., createSpyglass, createDryingRack, createCookpot]`, append `[dryrack] before cookpot` to the comment (cookpot stays last).
- `live.js:22` PRELOAD: add `'drying-rack-core.js', 'drying-rack-model.js', 'drying-rack.js'` after `'diving.js'` (tests/live-preload.test.mjs:38).
- `craft-book.js:50` CATEGORY_OF: `dryrack: 'building', driedfish: 'survival', kelpcrisp: 'survival', driedberries: 'survival', sharkjerky: 'survival'`.
- `craft-book.js:199` ITEM_TEXT (after meal_stew): `dryrack {desc:'A little A-frame of driftwood with a twine line.', use:'Hang fish, seaweed, berries or shark
  meat (E); they dry in the sun and wind, pause in rain.'}`, plus a desc/use for each snack (use: 'Eat it: +N food, no salt.') (tests/survival.test.mjs:555).
- `craft-book.js:491` ITEM_SOURCE: each snack `{tag:'drying rack', how:'Hang raw <fish|seaweed|berries|shark meat> on a Drying Rack (E); it dries in the sun.'}`
  (tests/craft-ux.test.mjs:124-131).

## 7. Co-op, saves, compatibility
- Host authority: only the host steps timers and applies `rack.*`; guests send `ctx.action` and render the slice. Items go to the acting player's bag.
- Simultaneous E: validated in order; the second take gets `empty`, the second hang `full`. No duplication.
- **OLD_HOST:** an old host sends no `ext.dryrack`, so `hostHas` is false and prompt and E show OLD_HOST. A new host with an old guest: the guest drops the decor
  and the unknown kinds (accepted, as with every content item).
- Saves: slice at `world.ext.dryrack` (`{v:1, r, k:{"x,z":{h:[...]}}}`), well under EXT_MAX 200k (content.js:99). Old saves → `load(undefined)` → empty rack.
  Old builds drop the decor (game.js:220) and the bag kinds (content-items.js:4). Visits reload the own slice with `'restore'`.

## 8. Tests: tests/drying-rack.test.mjs (node:test, real Bag from inventory-state.js)
1. Items: five kinds in CONTENT_ITEMS, none in items.js; `dryrack` in CONTENT_RECIPES, CONTENT_DECOR and CONTENT_BLOCK_RADIUS; snacks stack 30.
2. FOOD: the 4 rows exist, `isEdible` true, `isDrink` false; ITEM_TEXT and ITEM_SOURCE (tag 'drying rack') for each new kind.
3. dryRate: rain .2 → 0; calm day ≈ .89, breezy day ≈ 1.22, night ≈ .27 (±.01); NaN inputs fall back; rateLabel for each case.
4. cleanEntry/cleanSlice: garbage, NaN, bad kinds, >4 hooks, bad keys, ±26 dropped; `t >= secs` becomes done; decorAt prunes; MAX_RACKS; undefined → empty.
5. stepAll: rate 0 never changes or bumps; dt 1e6 adds ≤ 1 s; fish done after 150 1-s steps at rate 1, jerky after 225; true only on whole-percent changes
   (≤ 101 trues for one fish); onDone once when the last hook finishes.
6. hang: atomic bag change; `nothing`, `full` (5th item) leave the bag untouched. take: done-first; take-down returns raw; partial take into a nearly full bag;
   `bagfull` and `empty` change nothing.
7. Guards: `missing`, `reach` from 10 m, `bad` kind/coords/bag/item; every success bumps r.
8. sliceOf rounds t to 0.1, omits empty entries, survives a JSON round trip.
9. Module with a fake ctx (as tests/kiln.test.mjs): `serialize()` of an empty rack is an object; same-r net load no-op; guest update never steps; host emits on done;
   net `load(undefined)` → prompt and E give OLD_HOST; prompt always starts with `<kbd>E</kbd>`; undecorLoot returns raw and dried items; `kiln.*` actions → false;
   `decorModel('dryrack')` is a dryrack_station with ≤5 meshes, `decorModel('crate')` null.
10. Grep: FEATURES has `createDryingRack, createCookpot]`. Then `npm test`, shoot.py, `node tests/coop-e2e.mjs`.
