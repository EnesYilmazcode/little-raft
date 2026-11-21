# Visiting trader barge (Pim's Barge): spec
Source: docs/features/trader-research.md, cut down for ONE builder. Pim, a sea otter, brings a small barge alongside the raft:
the first visit comes ~4 min into a world, then one every 10-14 min, and each visit lasts ~4 min. He swaps surplus goods for
**Bright Shells**, and shells for rare goods, the **Shell Wreath plan** and the rare **Glass Float**. There is no combat, no price
creep, and nothing can be lost. Integration: the content registry plus ONE engine line (§9). All names and strings are original.

## 1. Scope
- **In**: the visit cycle (host clock, per world), a fixed-size seeded offer list, the `shell` item, the trade dialog, the `glassfloat`
  decor (trade only), the `shellwreath` decor (recipe gated by a plan), the barge model, and debug helpers.
- **Out**: honey/paint rows (the runtime filter switches them on later), the daynight lantern hookup, fades, sail lean, extra Pim animation.

## 2. Ids
Checked against this tree, the kiln, animals and decor pack, the diving gear (`fins/airjug/goggles/scraper/oxygen`) and the cooking
pot (`cookpot/bowl/*stew/*chowder/*broth/*omelette/*custard/smokybowl`). None clash. Items `shell` "Bright Shell" (stack 20), `shellwreath` "Shell Wreath" (decor), `glassfloat` "Glass Float" (decor; no recipe).
Recipe and plan id `shellwreath` {shell:3, rope:2, leaf:2} -> 1. Module/ext/debug name `trader`; action `trader.trade`.
Icons `icon-shell`, `icon-wreath`, `icon-float`. Dialog `<dialog id="lrTrader" class="lr-tr">`, CSS prefix `lr-tr`.
Offers use only existing kinds: fish, cookedfish, puffegg, feather, brick, glass, metalore, copperore, seed, scrap, rope, clay.
The kiln outputs `metalingot`/`glass`/`brick` (items.js); there is no `ingot`, and no ingot is traded.

## 3. dist/trader-core.js (pure: no imports, no DOM, THREE, Date or Math.random)
```js
export const TRADER = Object.freeze({ FIRST: 240, GAP_MIN: 600, GAP_MAX: 840, APPROACH: 25, DOCK: 240, HOLD_MAX: 240,
  DEPART: 20, WARN: 30, NEAR: 6, LANE: 22, RISE: 4, GAP: 1.0, HALF_BEAM: .9, REACH: 4, GUEST_SLACK: 1, CLOSE_DIST: 5,
  OFFERS: 6, RARE_CHANCE: .4, MAX_CLOCK: 1e9 });
export const TRADER_PLANS = Object.freeze(['shellwreath']);
export const POOL = Object.freeze([...]);           // frozen offer defs, rows below
export function rng(seed)                           // mulberry32: uint32 -> () => [0,1)
export function offersFor(seed, has, pool = POOL)   // frozen array, length <= OFFERS; has(kind)->bool, default () => true
export function nextDelay(seed)                     // GAP_MIN + rng(seed ^ 0x9e37)() * (GAP_MAX - GAP_MIN)
export function pathAt(t, hold, out)                // out = {phase:'approach'|'docked'|'depart'|'gone', u:0..1, left:s}; no alloc
export function parkAt(tiles, out)                  // out = {x, z}: barge centre in raft-local metres (tile*2); no alloc
export function deckGap(tiles, x, z)                // copy of signal.js deckGap (Infinity -> 0)
export function cleanTrader(v, has)                 // fresh valid slice, never throws
export function tradeCheck(st, a, bag, has, name)   // {ok:true, offer} | {ok:false, reason, text}
export function applyTrade(st, a, bag, has, name)   // atomic; {ok, reason?, text, offer?}
```
Offer def: `{id, give:{kind:n}, get:{kind:n}, plan?:'shellwreath', stock, fixed?:true, rare?:true}`. Rows below as `id: give -> get (stock)`.
- **Fixed**: `fish`: fish 3 -> shell 2 (4); `ore`: shell 4 -> metalore 2 (2); `plan`: shell 6 -> plan shellwreath (1).
- **Pool**: `egg`: puffegg 2 -> shell 2 (3); `feather`: feather 3 -> shell 2 (3); `brick`: brick 4 -> shell 3 (2);
  `glass`: glass 2 -> shell 3 (2); `grill`: cookedfish 2 -> shell 3 (2); `copper`: shell 3 -> copperore 1 (1);
  `seeds`: shell 2 -> seed 2 (3); `clay`: scrap 4 + rope 2 -> clay 3 (1).
- **Rare**: `float`: shell 10 -> glassfloat 1 (1).
**offersFor**: drop each def whose give or get kinds fail `has` (the plan row needs only `shell`). Then `r = rng(seed)`, and the
first draw decides the rare row: `rare = r() < RARE_CHANCE`. Take the fixed rows in listed order, Fisher-Yates the pool rows with `r`,
and fill to OFFERS rows. If `rare` is set and `float` survived, it takes the last slot. The list is shorter only when the filter
leaves too few. The result is a pure function of (seed, has), so saves hold only stock; trader.js memoises it per seed.
**pathAt** (t = clock - born, dock = DOCK + hold): approach while `t < APPROACH` (u = t/APPROACH; negative t gives u 0). Docked
until `APPROACH + dock`, with `left = APPROACH + dock - t`. Then depart for DEPART seconds, then gone.
**parkAt**: take the bow row (the min tile z). x is the mean of `t[0]*2` over that row, and z = `minZ*2 - 1 - GAP - HALF_BEAM`.
With no valid tiles it returns `{x:0, z:-3-GAP-HALF_BEAM}`. Tested invariant: `deckGap(tiles, x, z + HALF_BEAM) <= GAP + 1e-6`.
**Slice** `world.ext.trader`: `{v:1, r, clock, next, plans:[...], visit:{seed, born, hold, stock:[int]} | null}`. **cleanTrader**:
- A non-object or `v !== 1` gives the defaults `{v:1, r:0, clock:0, next:FIRST, plans:[], visit:null}`, so old saves get a first visit 4 min in.
- `clock` is clamped 0..MAX_CLOCK; `next` clock..clock+GAP_MAX (NaN gives clock+FIRST); `r` must be an int >= 0.
- `plans` keeps unique TRADER_PLANS ids.
- `visit` is null on a non-uint32 seed. `born` must be finite and <= clock, else clock. `hold` is clamped 0..HOLD_MAX.
- `stock[i]` is an int clamped 0..offers[i].stock, padded or cut to `offersFor(seed,has).length`. A visit already gone becomes null.
**tradeCheck** (`a = {kind:'trader.trade', offer:int, visit:uint32}`) checks in this order and returns `{reason, text}`:
`closed` "Pim isn't here right now" (no visit or not docked) -> `stale` "Pim has new stock, take another look" (`a.visit !== seed`)
-> `bad` (index) -> `soldout` "Sold out" -> `known` "You already have this plan" -> `missing` "Need N more <name>" -> `full` "Bag full".
**applyTrade** is atomic. On `s = new bag.constructor(bag.snapshot())` it removes every give kind, then adds every get kind; any
leftover means `full`. Only after both steps succeed does it copy `s.slots[i]` into `bag.slots[i]` (the same array), then
`bag.version++`, `stock[i]--`, `st.r++`, and push the plan. Core takes `name(kind)` to stay import-free; trader.js passes `itemName`.

## 4. dist/trader.js: `createTrader(ctx)`
Returns `{name:'trader', update, serialize, load, action, interact, prompt, craftLocked, decorModel, debug, dispose}`.
`has = k => Object.prototype.hasOwnProperty.call(ITEM_INFO, k)`, importing ITEM_INFO from `./inventory-state.js` (as decor-pack.js does).
**Host clock** (`role !== 'guest'`, ticks only while `ctx.running`):
- No visit and `clock >= next`: spawn with seed `Math.random()*2**32>>>0`, born = clock, default stock, `r++`, and notify 'all'
  "A little trading barge is bobbing this way!".
- Docked: `hold += dt` while `left <= WARN+1`, `hold < HOLD_MAX`, and either the host dialog is open or the host or `ctx.other` is
  within NEAR of the stall. This does not bump r.
- At WARN, notify once: "Pim is getting ready to cast off".
- Gone: visit = null, next = clock + nextDelay(seed), `r++`.
**Guest**: ticks its own clock, and never spawns or ends a visit.
- `load('net')` always eases clock, hold and next: a slew at 2/s toward the host when the seed matches and |err| <= 1, otherwise a
  snap (islands.js).
- Revision skip: if `data.r === netR`, stop there. Otherwise `st = cleanTrader(data, has)`, `netR = r`, and the UI is dirty.
  A host without the slice gives `netR = -2` and no visit.
- `'save'` and `'restore'` snap and set `netR = -1`; restore brings back the guest's own slice.
**serialize()**: reuses the cached `out` and `outVisit` objects and writes scalars every call. Plans and stock are copied into reused
arrays only when `st.r` changed, so there is no steady-state allocation.
**Motion (raft-local frame)**: the raft never moves in x/z (sailing moves the world), so raft-local metres equal scene x/z.
- The barge is a SCENE child: not a raft child (no raft pitch, and rebuildRaft never touches it), and not an addDrifter
  ("Pim keeps pace with you").
- Re-run `parkAt` only when the tiles ref or length changes; the shown park eases toward it at <= 1 m/s.
- Approach: `x = parkX + LANE*(1-easeOut(u))`, gliding in from +x and rising from y -1.2 over RISE s.
- Depart: `x = parkX - LANE*easeIn(u)`, sinking over the last RISE s, then hidden when gone.
- `y = deckY - .22 + (ocean.getHeight(x,z) - base)*.6`; roll and pitch come from ±1 m samples, using scratch variables only.
- Pim bobs `sin(elapsed*2)*.03`, and the pennant sways.
**Stall point**: centre + (0, .9, +HALF_BEAM). Reach is a horizontal distance <= REACH (+GUEST_SLACK for the guest). Positions come
from `ctx.physics` for the host and `ctx.other` for the guest, like kiln.js posOf.
**action(a, actor, bag)** (`trader.*`, host only):
- Out of reach: fail with `far`, "Get a bit closer to Pim". Otherwise run applyTrade.
- ok: `{kind:'loot', text:'+ 2 Bright Shell'}` to the actor. The plan and the float also notify 'all': "Shell Wreath plan
  learned!" / "Pim hands over a Glass Float".
- Fail: `{kind: reason==='full'?'full':'notice', text}`. Always return true.
**craftLocked(id)**: `'shellwreath'` without the plan returns 'Buy the plan from Pim’s barge', otherwise null.
**interact / prompt**: the target is the kiln.js aim ray passing within 1.6 m of the stall (along > 0), with the player within REACH+4.
Docked+in reach: `<kbd>E</kbd>Trade with Pim (m:ss)`, E opens the dialog. Docked+too far: "Swim a little closer to Pim".
Approach: "Pim is still tying up…" (interact returns true, does nothing). Depart/gone: null / false. Prompts are static plus digits (ctx.esc anything dynamic).
**UI open**: `ctx.releaseLock()`, then a lazy `import('./trader-ui.js')` (the storage loadUI pattern). A failure sets uiFailed, so
there is no per-frame retry. After the await, open only if `!disposed && !ctx.uiOpen()` and the barge is still docked and in reach.
While open, `update` calls `ui.tick()`, and closes the dialog if the phase leaves docked, the seed changes, or the player is more
than CLOSE_DIST+REACH away.
**dispose()**: `disposed = true`, `ui?.dispose()`, remove the group, and free the barge and decor geometry.

## 5. dist/trader-model.js (copy kiln-model.js mergeParts/painter/shareable)
`buildBarge(T)` returns `{group, pim, pennant, dispose}`. It is built lazily on the first visit and draws in **5 calls**:
(1) hull/deck/crates/mast/counter, one merged vertex-colour mesh ~4 m (x) × 1.8 m, the only shadow caster; (2) awning+sail cloth,
DoubleSide; (3) Pim; (4) emissive `lanternGlow`; (5) pennant plane.
Decor models share geometry and materials via `shareable()`: instance dispose is a no-op (rebuildRaft disposes removed children),
and the module dispose frees them. `instance()` returns a new Group, origin at the tile top (y .22).
- `buildShellWreath(T)`: 1 mesh, a rope torus with shell bumps, named `craft_shellwreath`.
- `buildGlassFloat(T)`: 2 meshes, a net on a stand plus a blue glass sphere (transparent .85, emissive #2a6f9a at .4),
  named `craft_glassfloat`.

## 6. dist/trader-ui.js: `createTraderUI(api)` -> `{open, close, tick, isOpen, dispose}`
`api = {offers(), stock(), visitSeed(), left(), bag(), plans(), trade(i), esc, requestLock}`.
- **Look**: one style tag, injected once, copying `lr-sr` (gradient `#b48d55→#8a663a`, border `#3e2a17`), with `sv-slot` icons via
  `iconSVG`/`paintSlot`.
- **Layout**: a header with `icon-shell`, "Pim's Barge" and "casts off in m:ss". Rows show give icons and counts → get icons
  (a plan shows the wreath icon and "Plan"), stock pips, and a Trade button. When disabled, the button text is the `tradeCheck`
  reason (no reach check). The footer reads "Your shells: N".
- **Escaping**: all text goes through textContent or `api.esc`.
- **Repaint**: only when `r|bag.version|left-seconds` changes.
- **Click**: `api.trade(i)`, which calls `ctx.action({kind:'trader.trade', offer:i, visit:seed})`, then blurs the button.
- **Keys don't leak**: the dialog keydown handler stops propagation of every key. E/Tab close it (`!e.repeat`, preventDefault).
  `cancel` (Esc) runs preventDefault and then close(). Wheel is stopped. On close, call requestLock if running.
- **dispose()**: one AbortController owns all listeners; abort it, close the dialog, and remove the node.

## 7. Content wiring (re-read each region right before the edit; append only)
- **content.js**: `import { createTrader } from './trader.js?build=v3-survival-ae77fa84ac2b';`, with `createTrader` at the END of FEATURES.
- **content-items.js**:
  - CONTENT_ITEMS: `shell: item('shell','Bright Shell','icon-shell',false)`, plus `shellwreath` ('icon-wreath') and `glassfloat` ('icon-float').
  - CONTENT_RECIPES: `shellwreath: recipe('shellwreath','Shell Wreath',1,{shell:3,rope:2,leaf:2})`.
  - CONTENT_DECOR: `'shellwreath','glassfloat'`. CONTENT_BLOCK_RADIUS: `shellwreath:.12, glassfloat:.2`.
- **icons.svg**: 3 symbols (viewBox 48, `#153e49` stroke): a fan shell, a shell ring, and a netted blue ball.
- **survival-ui.js**: SPRITES gets `'shell','wreath','float'`; SPRITE_FOR gets `shell:'shell', shellwreath:'wreath', glassfloat:'float'`.

## 8. Debug (`raftDebug.content.trader`; on a guest the writes return false)
- **Inspect**: `state()` (JSON copy + phase, left), `phase()`, `offers()`, `stock()`.
- **Time**: `summon(seed?, docked=true)` (docked: born = clock - APPROACH); `skip(sec)` (0..3600 s, phase logic once); `clear()`.
- **Play**: `give(kind,n)`; `trade(i)` (via `ctx.action` with the current seed); `aimAt()` (player 2 m from the stall, facing it);
  `open()` / `close()`.

## 9. Plan unlock: the one engine line (game.js, in place, no import)
Replace the line tagged `[progression-hook] items.js unlocks own the catalogue` with:
`setOwnedElsewhere(id => Object.prototype.hasOwnProperty.call(PROG_ITEMS, id) || id === 'shellwreath'); // ... + trader plan gates shellwreath`
- **Why**: storage-research comes earlier in FEATURES, so without this it answers craftLocked first ("Study it first").
- **Wart fixed (review)**: a second tiny game.js edit on the `recipeGate` line asks `content.craftLocked('shellwreath')`, so the craft list greys
  the wreath row ("Locked: Buy the plan from Pim’s barge") until the plan is bought.
- **If it can't stay one line**: drop the plan row, the recipe and craftLocked.

## 10. Co-op and save compat
- **Host authority**: the host owns the clock, seed, stock and plans. Guests only send `trader.trade`, paid from the actor's own bag.
- **Shared stock**: any change bumps `r` and the guest repaints. The seed and phase checks refuse stale clicks.
- **Old saves**, and hosts without the slice: `load(undefined)` gives the defaults (the slice stays under 1 KB).
- **Old builds**: a bag with `shell` starts fresh (the content-kind rule), and wreath/float decor is dropped by the decor cleaner.

## 11. tests/trader.test.mjs (node:test; core plus a Bag from inventory-state.js)
- offersFor is deterministic, varies by seed, has length OFFERS, and keeps fixed rows first. A `has` without puffegg/feather still
  fills to OFFERS, and a test-pool def with an unknown kind is dropped.
- The float row appears in 30-50% of 1000 seeds, always last.
- pathAt boundaries and hold; nextDelay range. parkAt gap <= GAP for 1x1, wide and L rafts, plus the no-tile fallback.
- applyTrade ok: shells in, fish out, stock-1, r+1, and `bag.slots` is the same array.
- Each failure (missing, full, soldout, stale, closed, bad) leaves the bag snapshot and the slice deep-equal. A repeated plan buy is `known`.
- cleanTrader never throws: undefined, junk, v2, a NaN clock, bad stock values or length, an unknown plan, a non-uint seed.
- The 3 kinds are in ITEM_INFO, the recipe is in RECIPES, and the decor ids are in CONTENT_DECOR.
QA: `npm test`; shoot.py `errors: []`. Browser: `summon(); aimAt(); open()`, screenshot; `give('fish',6); trade(0)` gives 2 shells; `skip(300)` departs and closes the dialog.
coop-e2e: the host summons, the guest trades, and the host stock drops.

## Implementation notes
Built as specified (dist/trader-core.js, trader.js, trader-model.js, trader-ui.js, tests/trader.test.mjs: 14 tests). Deviations and
choices where the spec was silent:
- **FEATURES order**: `createTrader` sits just before `createCookpot` (the coordinator keeps the cookpot last), not at the very end.
- **parkAt holes**: when the bow row has a gap under its mean x, x snaps to the bow tile nearest the mean, so the tested
  `deckGap <= GAP` invariant holds for every raft shape (the plain mean is kept whenever it lies over a bow tile).
- **cleanTrader**: a visit that is already gone also sets `next = clock + nextDelay(seed)` (so it does not respawn at once).
  Non-numeric stock entries become the offer's full stock; numeric ones are floored and clamped. `bad` uses the text
  "That trade isn’t on offer". `missing` lists every short kind joined with " and " using ITEM_INFO names ("Need 4 more Scrap").
- **offersFor** keeps a one-entry memo (seed, has, pool) inside the core; it is a pure cache.
- **UI api** adds `rev()`, `check(i)` (tradeCheck against the local bag, used for the disabled button text) and `running()`.
  After a Trade click the button blurs and focus returns to the dialog wrap, so E/Tab/Esc still reach the dialog handler.
- **Notices**: the plan and the float send only the 'all' notice (with a craft sound), not a second loot line to the actor; other
  trades send the actor's loot line. The arrival notice uses the 'catch' sound.
- **Reach**: the host reach check (`far`) runs only while docked; otherwise applyTrade answers `closed`. The stall is computed
  from the shown (eased) barge position on each side.
- **Guest net load**: clock and hold ease at 2/s (|err| <= 1 and same seed) else snap; `next` is a constant, so it is simply copied.
- **Debug**: `give(kind, n, who)` takes `who = 'guest'` on the host for co-op QA. `trade`, `aimAt`, `open`, `close` and the reads work
  on a guest; `summon/skip/clear/give` return false there. `clear()` drops the visit and sets `next = clock + FIRST`. `aimAt()` puts the
  player on the bow row 2 m from the docked stall and turns the camera through `raftDebug.aim`.
- **Models**: barge 5 draw calls (hull merged + shadow, cloth DoubleSide, Pim, lanternGlow, pennant); wreath 1 mesh; float 2 meshes.
  craft-book: `shellwreath` is in the Building tab; ITEM_TEXT rows for shell, shellwreath and glassfloat.
- **QA**: npm test green; shoot2.py errors []; Playwright flow (summon, approach, dock, E opens, real-click trades, plan + float,
  craft the wreath, place the float, skip closes the dialog); coop2.mjs only the known 3 and 6 fail; a loopback guest trade
  (E + click) moved the guest's fish to shells and dropped the host stock 4 -> 3, and the guest dialog closed when the host's visit ended.
- **Review**: the "wreath placement click failed" seen in QA was the script, not the game: while the pointer is locked a click acts at
  the crosshair, which still pointed at the tile the float had just taken. Aimed at a free tile, the wreath places. The dialog's
  per-frame tick() now compares numbers instead of building a signature string.
