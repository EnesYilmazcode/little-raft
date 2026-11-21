# Spec: Cooking Pot and cosy meals (one builder)

Source: docs/features/cooking-pot-research.md. Cosy rules: no hunger, nothing burns, spoils or is lost, an idle pot never uses wood. A meal gives
ONE timed buff that makes swimming, diving, walking, fishing or night sailing a bit nicer. Eating is never required. Later: Honey Tea once bees.js merges.
New files: `dist/cookpot-core.js` (pure), `dist/cookpot.js` (content module), `dist/cookpot-model.js` (THREE), `tests/cookpot.test.mjs`.
Edits (small, anchored, append-only; other builders edit the same files at the same time, so re-read right before each Edit):
content.js, content-items.js, craft-book.js, icons.svg, survival-ui.js, and three one-line engine exports (§7). **No game.js edit.**
Dive swim/oxygen buffs use the shared `diveMods(m)` hook from docs/specs/diving-gear.md §2 (no separate DIVE_BUFF).

## 1. Items (append a `// cooking pot (cookpot.js)` block at the end of CONTENT_ITEMS)
Ids were checked against ITEM_INFO, items.js ITEMS/LEGACY_ALIASES, CONTENT_ITEMS, diving gear (fins/airjug/goggles/scraper), the trader
(shell/glassfloat) and the decor pack (`pots` is the Clay Pot Trio, a different id). Meals use a `meal_` prefix. Write the meal rows out
(`maxStack: 10`); the pot and bowl use `item()`:
```js
  cookpot: item('cookpot', 'Cooking Pot', 'icon-cookpot', false), bowl: item('bowl', 'Driftwood Bowl', 'icon-bowl', false),
  meal_chowder:  Object.freeze({ kind: 'meal_chowder',  name: 'Tide Chowder',    icon: 'icon-meal', maxStack: 10, tool: false, placeholder: false }),
  // same shape: meal_omelette 'Puff Omelette', meal_broth 'Kelp Broth', meal_fishbowl 'Smoky Fish Bowl', meal_custard 'Coconut Custard', meal_stew 'Captain\u2019s Stew'
```
## 2. Recipes and research gating (append to CONTENT_RECIPES; CONTENT_DECOR; CONTENT_BLOCK_RADIUS)
- `cookpot: recipe('cookpot', 'Cooking Pot', 1, { clay: 3, stone: 2, scrap: 1 }),` and `bowl: recipe('bowl', 'Driftwood Bowl', 2, { wood: 1 }),` (2 bowls).
- Append `'cookpot'` to CONTENT_DECOR and `cookpot: .35` to CONTENT_BLOCK_RADIUS (append to the end of each, after any other builder's entries).
- Meals are NOT in RECIPES. The pot makes them, so they are never research-gated and never show in the craft list.
- **Reachability.** Do not add either recipe to STARTER. The pot costs exactly the kinds the Seaside Kiln needs (stone, clay, scrap), so
  `learnedFrom` teaches the pot together with the kiln and no new study is needed. The bowl unlocks after studying wood (already researchable,
  because wood is a cost kind of many locked recipes). The ingredients exist in normal play: fish (hook/rod), cookedfish (grill),
  seaweed (barrels), leaf, seed (island palms/bushes, planters), puffegg (Nest Box, STARTER), freshcup (purifier). Puff Omelette (egg, egg,
  leaf) is the earliest meal. Old saves: legacy worlds get everything via `ingredientKinds()`, and a save that has studied stone+clay+scrap learns
  the pot on load (storage-research `load()` re-runs `learnedFrom`). Guard test §9.10.
- craft-book.js: append `cookpot: 'building', bowl: 'survival',` at the end of `CATEGORY_OF`. Append to the end of `ITEM_TEXT` (after the
  last entry, whoever added it): `cookpot` "A squat clay pot on three stones." / "Add 3 ingredients and wood; cooks 2 servings into bowls.",
  `bowl` "A little carved bowl." / "Collect a meal from the Cooking Pot.", and one row per meal: desc = short line, use = the buff text from §3.

## 3. Pure core: dist/cookpot-core.js (no imports, DOM, THREE, Date or Math.random; kiln-core pattern)
```js
export const POT = Object.freeze({ SLOTS:3, SERVE:2, TRAY:6, FUEL_MAX:4, COOK:20, MAX_DT:1, REACH:3.2, MAX_POTS:100, BUFF_MAX:300 });
export const INGREDIENTS = Object.freeze(['fish','cookedfish','seaweed','leaf','seed','puffegg','freshcup']);
export const RECIPES = Object.freeze({ // key = sorted ingredients joined by '+'; value = meal id
  'fish+freshcup+seaweed':'meal_chowder', 'leaf+puffegg+puffegg':'meal_omelette', 'freshcup+seaweed+seaweed':'meal_broth',
  'cookedfish+leaf+seed':'meal_fishbowl', 'freshcup+puffegg+seed':'meal_custard', 'cookedfish+puffegg+seaweed':'meal_stew' });
export const MEALS = Object.freeze({ // buff fields: neutral 1, night 0|1; secs = buff length
  meal_chowder:  { name:'Tide Chowder',    buff:'Swift Fins',   secs:180, swim:1.35 },
  meal_omelette: { name:'Puff Omelette',   buff:'Springy Step', secs:180, walk:1.15, jump:1.15 },
  meal_broth:    { name:'Kelp Broth',      buff:'Deep Breath',  secs:180, oxy:1.6 },
  meal_fishbowl: { name:'Smoky Fish Bowl', buff:'Steady Reel',  secs:180, reel:1.3 },
  meal_custard:  { name:'Coconut Custard', buff:'Night Owl',    secs:240, night:1 },
  meal_stew:     { name:'Captain’s Stew', buff:'Cosy Glow', secs:300, swim:1.1, walk:1.1, oxy:1.25, reel:1.1 } }); // freeze each
export const MEAL_IDS = Object.freeze(Object.keys(MEALS));
export const POT_ACTIONS = Object.freeze(['pot.add','pot.fuel','pot.take','pot.back','pot.eat']);
export const NAMES   // ingredient kind -> lower-case name ('fish','grilled fish','seaweed','palm leaf','palm seed','puff egg','fresh water')
export const keyOf = (x, z) => x + ',' + z; export const TEXT /* refusal texts, below */;
export function blank()                 // {i:[], f:0, h:0, t:0, c:null, o:null, n:0}
export function match(list)             // 3 kinds in any order -> meal id | null (copy, sort, join; never mutates)
export function cleanEntry(raw)         // -> entry | null (invalid, or idle and empty)
export function cleanBuff(raw)          // {m,s} -> {m,s} | null (m in MEAL_IDS, s finite, clamped to 0..min(BUFF_MAX, MEALS[m].secs))
export function cleanSlice(data, decorAt, keepGuest = true) // -> {k, b:{host,guest}, r, br}; never throws
export function sliceOf(st)             // -> {v:1, r, br, k, b} JSON copy; t to 0.1, b.*.s rounded up to whole seconds
export function step(e, dt)             // -> 1 when a cook finished, else 0. No allocations.
export function stepAll(st, dt, onDone) // pots; onDone(key, e) on finish; -> true if anything visible changed
export function tickBuffs(b, dt)        // s -= dt (clamped dt); entry -> null at 0; -> true when one expired
export function buffMods(entry, out)    // writes out.swim/walk/jump/oxy/reel (1 when absent), out.night (0|1); returns out
export function applyPotAction(st, a, actor, bag, env) // -> {ok, reason?, text, meal?}
```
**Entry:** `i` ingredient kinds in insert order (0..3, all in INGREDIENTS); `f` fuel charges 0..4 (1 wood = 1 cook); `h` 1 while cooking;
`t` seconds into the cook 0..COOK; `c` meal id being cooked (non-null iff h===1); `o` meal id waiting; `n` servings 0..TRAY.
**step:** clamp dt to 0..MAX_DT (NaN → 0). If `h===0 && i.length===3 && f>0`, let `m = match(i)`; start only if `m && (n===0 || o===m) &&
n+SERVE <= TRAY`: `f--, h=1, c=m, t=0` (the only place fuel is spent). If `h===1`: `t += dt`; at `t >= COOK`: `i.length=0, h=0, t=0, o=c, c=null,
n += SERVE`, return 1. A matched pot with no fuel or a full tray just waits; an unmatched set never cooks.
**cleanEntry:** non-object → null; `i` array of ≤3 known kinds (else `[]`); `f` int 0..4 (else 0); `o` in MEAL_IDS with `n` int 1..6, else
`o=null,n=0`; `h===1` only when `i.length===3`, `c === match(i)` and `n+SERVE <= TRAY` (else h=0, c=null, t=0); `t` finite clamped 0..COOK.
Idle (`i` empty, f 0, n 0) → null. **cleanSlice:** kiln rules for keys (`/^(-?\d{1,2}),(-?\d{1,2})$/`, |x|,|z| ≤ 25, MAX_POTS, `decorAt` must
return `'cookpot'` when given); `r`, `br` ints ≥ 0 (else 0); `b = {host: cleanBuff(d.b?.host), guest: keepGuest ? cleanBuff(d.b?.guest) : null}`.
**applyPotAction:** `a = {kind, x, z, item?}`; `env = {decorAt, pos}` (kiln contract). Checks in order: `bad` (unknown kind; bag not 28 slots; actor not
'host'|'guest'). `pot.eat` skips the pot checks: `item` must be in MEAL_IDS (`bad`), `bag.count(item) ≥ 1` (`nomeal`). On a scratch
`new bag.constructor(bag.snapshot())`: remove 1 meal (selected slot first), add 1 `bowl` (if the bowl does not fit, still eat: the bowl is
optional, nothing important is lost). Commit, set `st.b[actor] = {m:item, s:MEALS[item].secs}` (replaces any buff, restarts the timer), `st.br++`.
Every other kind: x/z int within ±25 (`bad`) → `missing` (`decorAt !== 'cookpot'`) → `reach` (`hypot(p.x-x*2, p.z-z*2) > REACH`).
- **add** (`item` in INGREDIENTS): `busy` if `h===1`; `full` if `i.length===3`; `nothing` if count < 1. On a scratch: remove 1 (selected slot first);
  for `freshcup` also `add('cup', 1)` (refuse `bagfull` if the cup does not fit). Commit, `i.push(item)`. Text: 3 in and matched → `${name} is ready
  to simmer`, plus ` · add wood` when f===0; 3 in, unmatched → TEXT.norecipe; else `Added ${NAMES[item]} · ${i.length}/3`.
- **fuel:** `nowood` / `fuelfull` (f+1 > FUEL_MAX). Remove 1 wood (selected slot first, kiln code), `f++`.
- **take:** `empty` if n===0; `nobowl` if `bag.count('bowl') < 1`. Scratch: remove 1 bowl, add 1 `o` (`bagfull` if it does not fit). `n--` (o=null at 0).
- **back:** `busy` if h===1; `empty` if `i` is empty. Pops the LAST ingredient. If it is `freshcup`, the scratch must `remove('cup',1)` (`nocup`)
  before `add('freshcup',1)`; otherwise `add(kind,1)`. `bagfull` if it does not fit. This keeps cups exact (no free cups).
Check everything first; a refusal changes nothing; every pot success does `st.r++`, eat does `st.br++`. Delete idle entries.
TEXT: reach 'Step a little closer' · missing 'That spot has no cooking pot' · busy 'The pot is simmering' · full 'The pot holds 3 things. Take one
back with an empty hand' · norecipe 'No recipe yet. Take one back with an empty hand' · nowood 'You need wood for the fire' · fuelfull 'The fire
is stoked' · empty 'Nothing in the pot' · nobowl 'You need a bowl' · nocup 'Bring an empty cup to scoop the water back' · bagfull 'Your bag is
full' · nomeal 'Hold a meal to eat' · bad 'That does not work here'. Success: fuel `Fire stoked · ${f} cooks of fuel`, take `+ 1 ${name}`, eat `Tummy full of ${name}: ${buff}`.
## 4. Content module: dist/cookpot.js, `createCookpot(ctx)`, name `'cookpot'`
- content.js: `import { createCookpot } from './cookpot.js?build=v3-survival-ae77fa84ac2b';` and append `createCookpot` as the **LAST** FEATURES
  entry (after diving gear and the trader). Last means chests/animals/kilns aimed at still win E, and `update` runs after daynight.
- **Engine imports must use the SAME specifier as their other importer**, or they load a second module instance and the buff does nothing:
  `import { MOVE_MUL } from './player-physics.js?build=v3-survival-ae77fa84ac2b';` `import { HOOK_MUL } from './hook-physics.js?build=v3-survival-ae77fa84ac2b';`
  (both as in game.js:7/:14) and `import { FISHING_TUNING } from './fishing-v2.js';` (no suffix, as in fishing-cooking.js:11). Test §9.9.
- State `st = {k, b:{host,guest}, r, br}`. `serialize()`: cache `sliceOf(st)` keyed on `r`, `br` and `ceil(b.host.s)*1000+ceil(b.guest.s)`.
- `load(data, from)`: `'net'` (guest): if `data.r !== netR` re-clean pots (no decorAt); if `data.br !== netBr` OR the whole-second `s` of
  `b.guest` differs by > 2 from the local copy, adopt `b` (so the guest timer resyncs without per-frame traffic). `'save'`: `cleanSlice(data, decorAt,
  false)` (a past guest's buff is not kept). `'restore'`: `cleanSlice(data, decorAt)` (restoreOwnRaft brings back the own `b.host`). Undefined → empty.
- `update(dt)` (no allocations): host: `stepAll` (`st.r++` on change; onDone emits loot `"The pot is ready: 2 ${name}"` to all), prune pots
  whose tile lost its decor every 1 s (kiln code), `tickBuffs(st.b, dt)` (`st.br++` on expiry). Guest: `tickBuffs` on its copy (cosmetic; the host
  copy is authoritative). Both: `me = ctx.role === 'guest' ? st.b.guest : st.b.host; buffMods(me, mods)`; then write knobs (§7):
  `MOVE_MUL.walk = mods.walk; MOVE_MUL.swim = mods.swim; MOVE_MUL.jump = min(mods.jump, 1.15); HOOK_MUL.reel = mods.reel;
  FISHING_TUNING.reelTime = REEL_BASE / mods.reel` (`REEL_BASE = FISHING_TUNING.reelTime` read once at module load, 3.5).
  Night floor when `mods.night`: `if (r = ctx.renderer) r.toneMappingExposure = Math.max(r.toneMappingExposure, 1.0); if (h = ctx.hemi)
  h.intensity = Math.max(h.intensity, 1.25)`. daynight rewrites both every frame, so this never accumulates; with `?daynight=off` (1.0 / 1.8) it is a no-op.
  On the local buff's expiry: toast `"${buff} wore off"` via `ctx.notice`. Then visuals + HUD chip.
- `diveMods(m) { if (mods.swim !== 1) m.swim *= mods.swim; if (mods.oxy !== 1) m.oxy *= mods.oxy; }` (diving-gear §2: multiply, never assign;
  fins 1.3 × chowder 1.35 = 1.755, diving.js clamps to 2). Surface swim goes through `MOVE_MUL.swim`; underwater swim through diveMods.
- `interact(aim)`: (1) a pot target (kiln `target()` copy, type `'cookpot'`): held INGREDIENT → `pot.add`; held `wood` → `pot.fuel`; held meal → eat;
  else `n>0` → `pot.take`; else `i.length && h===0` → `pot.back`; else notice "Add 3 ingredients and some wood". (2) No pot, held kind in MEAL_IDS →
  `ctx.action({kind:'pot.eat', item})`. (3) Otherwise return false (E still opens the inventory; Tab/I always does). Guest before its first net state:
  notice 'Wait for your raft to connect' (animals.js:292 pattern).
- `prompt(aim)`: pot: `<kbd>E</kbd>${verb} · ${status}` (verbs: `Add ${name}`, `Add wood`, `Take ${meal}` / `Take ${meal} (need a bowl)`, `Take back
  ${name}`; status: `${i.length}/3` + matched meal name or 'no recipe', `simmering ${pct}%`, `fuel ${f}`, `${n} ready`). Meal held (no pot):
  `<kbd>E</kbd>Eat ${name} · ${buff} ${mm:ss}`. Escape via `ctx.esc`; cache like kiln `prompt` (key, r, sel, pct).
- `action(a, actor, bag)`: handle `a.kind.startsWith('pot.')`; emit 'loot' on take, 'build' on add/fuel/back, 'loot' on eat, 'full'/'notice' on refusals.
- **HUD chip** (lazy DOM, skipped without `document`): one `<div class="cpBuff">` + one `<style id="cookpotStyle">`. `position:fixed;left:16px;
  bottom:96px;z-index:3;pointer-events:none;display:none;align-items:center;gap:6px;padding:3px 9px 3px 4px;border-radius:14px;
  background:rgba(9,20,30,.72);color:#fff2cc;font:600 12px system-ui`. Content: icon-meal `<svg>` (20px, SPRITE_URL as survival-ui.js:16-19)
  + `<span>` `${buff} m:ss`. Set `display:flex` while the local buff runs. Update the span's textContent only when the whole second changes.
  `title` = meal name. `@media(max-width:760px){.cpBuff{bottom:84px}}`.
- `dispose()`: remove the DOM; reset `MOVE_MUL.walk/swim/jump = 1`, `HOOK_MUL.reel = 1`, `FISHING_TUNING.reelTime = REEL_BASE`; dispose the model.
- `debug` (raftDebug.content.cookpot): `state()`, `spawn(x,z)`, `give(kind,n)`, `fill(x,z,entry)`, `finish(x,z)`, `run(sec)` (kiln copies, host only),
  `feed(meal, actor='host')` (host only: sets `b[actor]`, `br++`), `buff()` → copy of the local entry + current `mods`, `clear()`.
## 5. Model: dist/cookpot-model.js, `buildCookpot(T)` → `{instance(), steam(time, on), dispose()}` (≤ 5 draw calls per pot)
Copy kiln-model.js `mergeParts`/`painter`/`shareable`. Draw calls: (1) **body**: three grey stones + squat terracotta pot (lathe, r .26, h .3)
+ rim, vertex colours, merged; (2) **lid**: a darker disc with a knob, bobs `y += .012*sin(t*7)` while simmering; (3) **glow**: ember plane under the
pot (emissive 0xff6a1a, kiln glow recipe), visible while `h===1`; (4) **steam**: one merged geometry of 3 small low-poly spheres
(MeshBasicMaterial white, transparent, opacity .35, depthWrite false), drifting up and fading on a looped 2.4 s phase, visible while cooking or
`n>0`; (5) **stew**: a flat disc inside the rim, visible when `n>0`, tinted by meal (`material.color` on a shared per-meal material map: 6
materials made once). No lights. `g.name = 'cookpot_station'`, `g.userData.cookpot = {lid, glow, steam, stew}`; rescan/apply like kiln.js.
## 6. Icons
icons.svg: append `icon-cookpot` (terracotta pot on stones, lid, two steam curls), `icon-bowl` (empty brown bowl, rim highlight), `icon-meal`
(the bowl with warm orange stew and one steam curl), palette stroke `#153e49` width 2, round joins, viewBox 0 0 48 48. survival-ui.js: append
`'cookpot', 'bowl', 'meal'` to SPRITES (meal rows already name `icon-meal`, so SPRITE_FOR is not needed).
## 7. Engine knobs (exact lines; defaults keep today's behaviour bit-for-bit)
- **dist/player-physics.js**, after the `PLAYER_CONSTANTS` freeze (line ~7-20):
  `export const MOVE_MUL = { walk: 1, swim: 1, jump: 1 }; // live multipliers for local buffs (cookpot.js); 1 = neutral`
  Line 134: `if (this.swimming) { speed = C.SWIM_SPEED * MOVE_MUL.swim; rate = C.WATER_ACCEL; }`
  Line 135: `else if (this.grounded) { speed = (sprint ? C.SPRINT_SPEED : C.WALK_SPEED) * MOVE_MUL.walk; rate = C.GROUND_ACCEL; }`
  Line 136: `else { speed = (sprint ? C.SPRINT_SPEED : C.WALK_SPEED) * MOVE_MUL.walk; rate = C.AIR_ACCEL; }`
  Lines 154 and 178: `this.vy = C.JUMP_IMPULSE * MOVE_MUL.jump;` (rest of each line unchanged).
- **dist/hook-physics.js**, after line 61 (`const REEL_SPEED = 8;`): `export const HOOK_MUL = { reel: 1 }; // live reel multiplier (cookpot.js)`.
  Line 269: `const k = Math.min(1, (REEL_SPEED * HOOK_MUL.reel * h) / d);`.
- **fishing-v2.js: no edit** (FISHING_TUNING is a plain mutable object read live at :112). **diving.js: no cookpot edit**: underwater swim/oxygen
  come from `diveMods` (diving-gear §2-3). If `content.diveMods` has not landed yet, still implement `diveMods`; it is simply not called until then.
## 8. Co-op and saves
Host-authoritative: every pot change and every eat is an action (`ctx.action`); guests never mutate `st`. Buffs live in the host slice
`b:{host,guest}`; only the host's tick is authoritative. Each client applies ONLY its own entry to its OWN local physics/hook/fishing/dive
(the host never simulates guest movement), so buffs never leak. Net cost: `r`/`br` change only on actions and expiry; `s` is whole seconds.
Save: `world.ext.cookpot = {v:1, r, br, k:{'x,z':{i,f,h,t,c,o,n}}, b}`. Old saves → `load(undefined)` → empty pots, no buffs. Unknown kinds, bad
numbers, oversize buffs and pots on tiles without a cookpot are cleaned. An older build ignores the slice and drops unknown kinds (as for every item).
## 9. Tests: tests/cookpot.test.mjs (node:test, kiln.test.mjs harness: Bag, SLOT_COUNT, fake env)
1. `match` ignores order, never mutates, returns null for 2 or 4 items and unknown sets; every RECIPES key is sorted and maps to a MEAL_ID.
2. add: 3 max (`full`), `busy` while cooking, `nothing` without the kind; freshcup swaps to `cup` in the bag (cup count +1).
3. fuel/step: no fuel → never starts; 1 wood = 1 cook; idle pot keeps fuel; unmatched set never cooks; 20 s → n=2, i=[]; tray 6 cap blocks a 4th cook;
   a different meal waits while `o` differs.
4. take: `nobowl`, bowl → meal, `bagfull` leaves everything unchanged; back pops the last item; freshcup back needs a cup (`nocup`) and swaps it.
5. Nothing lost: for each success/refusal, total item count in bag+pot (cups and water counted together) is conserved, except fuel and eat.
6. eat: meal → bowl, sets `b[actor]`, replaces an old buff and restarts `s`; a full bag still eats; `bad` for a non-meal; guest eat touches only `b.guest`.
7. `tickBuffs` expires at 0 and returns true once; `buffMods(null)` gives all 1 and night 0; stew gives its 4 fields.
8. Malformed saves: garbage/arrays/NaN/huge `s`/unknown meal/bad keys/>100 pots → clean output, never throws; `keepGuest=false` drops `b.guest`;
   `cleanSlice(sliceOf(st))` round-trips.
9. Module with a fake ctx: `serialize` cache; guest `load('net')` adopts `b`; `diveMods` multiplies a pre-set `{swim:1.3}` to 1.3*1.35; `update` sets
   MOVE_MUL/HOOK_MUL/reelTime and `dispose` resets them; source check: cookpot.js import specifiers for player-physics/hook-physics equal
   game.js's (readFileSync + regex), fishing-v2 equals fishing-cooking.js's.
10. Data/reachability: ids in CONTENT_ITEMS/ITEM_INFO (meals maxStack 10), no clash with items.js ITEMS/LEGACY_ALIASES; `cookpot` in CONTENT_DECOR;
    every cost kind of `cookpot`/`bowl` is in `ingredientKinds()`; `learnedFrom(['stone','clay','scrap'])` includes `'cookpot'`; meals not in RECIPES.
Run all of `npm test`, `shoot.py` (errors []), and `node tests/coop-e2e.mjs` (test 4 is a known failure). Browser QA: `raftDebug.content.cookpot
.spawn(1,0)`, give egg×2 + leaf + wood, E×4, `run(20)`, take with a bowl, eat → chip shows "Springy Step 3:00" and `buff().mods.walk === 1.15`.
