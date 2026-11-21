# Visiting trader barge (Pim's Barge): spec

Source: docs/features/trader-research.md, cut down for ONE builder. Pim, a sea otter, brings a small barge alongside the raft:
the first visit comes ~4 min into a world, then one every 10-14 min, and each visit lasts ~4 min. He swaps surplus goods for
**Bright Shells**, and shells for rare goods, the **Shell Wreath plan** and the rare **Glass Float**. There is no combat, no price
creep, and nothing can be lost. Integration: the content registry plus ONE engine line (§9). All names and strings are original.

## 1. Scope
- **In**: the visit cycle (host clock, per world), a fixed-size seeded offer list, the `shell` item, the trade dialog, the `glassfloat`
  decor (trade only) and the `shellwreath` decor (recipe gated by a plan), the barge model, and debug helpers.
- **Out**: honey/paint rows (the runtime filter switches them on later), the daynight lantern hookup, material fades, sail lean, and
  Pim animations beyond a bob.

## 2. Ids
Checked against this tree, the kiln, animals and decor pack, the diving gear (`fins/airjug/goggles/scraper/oxygen`) and the cooking
pot (`cookpot/bowl/*stew/*chowder/*broth/*omelette/*custard/smokybowl`). None clash.

Items `shell` "Bright Shell" (stack 20), `shellwreath` "Shell Wreath" (decor), `glassfloat` "Glass Float" (decor; no recipe).
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
export const POOL = Object.freeze([...]);           // frozen offer defs, table below
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
Offer def: `{id, give:{kind:n}, get:{kind:n}, plan?:'shellwreath', stock, fixed?:true, rare?:true}`.

Rows as `id: give -> get (stock)`.
- **Fixed**: `fish`: fish 3 -> shell 2 (4); `ore`: shell 4 -> metalore 2 (2); `plan`: shell 6 -> plan shellwreath (1).
- **Pool**: `egg`: puffegg 2 -> shell 2 (3); `feather`: feather 3 -> shell 2 (3); `brick`: brick 4 -> shell 3 (2);
  `glass`: glass 2 -> shell 3 (2); `grill`: cookedfish 2 -> shell 3 (2); `copper`: shell 3 -> copperore 1 (1);
  `seeds`: shell 2 -> seed 2 (3); `clay`: scrap 4 + rope 2 -> clay 3 (1).
- **Rare**: `float`: shell 10 -> glassfloat 1 (1).

**offersFor**: drop each def whose give or get kinds fail `has` (the plan row needs only `shell`). Then `r = rng(seed)`, and the
first draw decides the rare row: `rare = r() < RARE_CHANCE`. Take the fixed rows in table order, Fisher-Yates the pool rows with `r`,
and fill to OFFERS rows. If `rare` is set and `float` survived, it takes the last slot. The list is shorter only when the filter
leaves too few. The result is a pure function of (seed, has), so saves hold only stock; trader.js memoises it per seed.

**pathAt** (t = clock - born, dock = DOCK + hold): approach while `t < APPROACH` (u = t/APPROACH; negative t gives u 0). Docked
until `APPROACH + dock`, with `left = APPROACH + dock - t`. Then depart for DEPART seconds, then gone.

**parkAt**: take the bow row (the min tile z). x is the mean of `t[0]*2` over that row, and z = `minZ*2 - 1 - GAP - HALF_BEAM`.
With no valid tiles it returns `{x:0, z:-3-GAP-HALF_BEAM}`. Tested invariant: `deckGap(tiles, x, z + HALF_BEAM) <= GAP + 1e-6`.

**Slice** `world.ext.trader`: `{v:1, r, clock, next, plans:[...], visit:{seed, born, hold, stock:[int]} | null}`.
**cleanTrader**:
- A non-object or `v !== 1` gives the defaults `{v:1, r:0, clock:0, next:FIRST, plans:[], visit:null}`, so old saves get a first
  visit 4 min in.
- `clock` is clamped to 0..MAX_CLOCK, `next` to clock..clock+GAP_MAX (NaN becomes clock+FIRST), and `r` to an int >= 0.
- `plans` keeps only unique TRADER_PLANS ids.
- `visit` is null if the seed is not a uint32. `born` must be finite and <= clock, else clock. `hold` is clamped 0..HOLD_MAX.
- `stock[i]` is an int clamped 0..offers[i].stock, padded or cut to `offersFor(seed, has).length`. A visit already gone becomes null.

**tradeCheck** (`a = {kind:'trader.trade', offer:int, visit:uint32}`) checks in this order, and each failure returns `{reason, text}`:
- `closed` "Pim isn't here right now": no visit, or not docked.
- `stale` "Pim has new stock, take another look": `a.visit !== seed`.
- `bad`: an invalid index.
- `soldout` "Sold out".
- `known` "You already have this plan".
- `missing` "Need N more <name>": the first missing kind.
- `full` "Bag full".

**applyTrade** is atomic. On `s = new bag.constructor(bag.snapshot())` it removes every give kind, then adds every get kind; any
leftover means `full`. Only after both steps succeed does it copy `s.slots[i]` into `bag.slots[i]` (the same array), then
`bag.version++`, `stock[i]--`, `st.r++`, and push the plan. Core takes `name(kind)` to stay import-free; trader.js passes `itemName`.

## 4. dist/trader.js: `createTrader(ctx)`
Returns `{name:'trader', update, serialize, load, action, interact, prompt, craftLocked, decorModel, debug, dispose}`.
`has = k => Object.prototype.hasOwnProperty.call(ITEM_INFO, k)`, importing ITEM_INFO from `./inventory-state.js` (as decor-pack.js does).

**Host clock** (`role !== 'guest'`; it ticks only while `ctx.running`):
- With no visit, once `clock >= next` it spawns: seed `Math.random()*2**32>>>0`, born = clock, default stock, `r++`, and a notice to
  'all': "A little trading barge is bobbing this way!".
- While docked, `hold += dt` when `left <= WARN+1`, `hold < HOLD_MAX`, and either the host dialog is open or the host or
  `ctx.other` is within NEAR of the stall. This does not bump `r`.
- At WARN it sends one notice: "Pim is getting ready to cast off".
- When gone: visit = null, next = clock + nextDelay(seed), `r++`.

**Guest**: ticks its own clock, and never spawns or ends a visit.
- On `load('net')`: if `data.r === netR`, it only eases clock, hold and next. That easing slews toward the host clock at 2/s when the
  seed matches and `|err| <= 1`, and snaps otherwise (as in islands.js).
- If `r` differs: `st = cleanTrader(data, has)`, `netR = r`, and the UI is marked dirty.
- A host build without the slice sends undefined: `netR = -2` and no visit.
- `'save'` and `'restore'` snap and set `netR = -1`; restore brings back the guest's own slice.

**serialize()** reuses cached `out` and `outVisit` objects. It writes the scalars every call, and copies plans and stock into reused
arrays only when `st.r` changed. No allocation in steady state.

**Motion (raft-local frame)**: the raft never moves in x/z (sailing moves the world), so raft-local metres equal scene x/z.
- The barge group is a SCENE child, not a raft child: it does not pitch with the raft, rebuildRaft leaves it alone, and it is not
  an `addDrifter` ("Pim keeps pace with you").
- `parkAt` runs again only when the tiles ref or length changes. The shown park eases toward it at <= 1 m/s.
- Approach: `x = parkX + LANE*(1-easeOut(u))`, gliding in from +x along its long axis; it rises from y -1.2 over the first RISE s.
- Depart: `x = parkX - LANE*easeIn(u)`; it sinks over the last RISE s and is hidden when gone.
- `y = deckY - .22 + (ocean.getHeight(x,z) - base)*.6`. Roll and pitch come from samples ±1 m away, in scratch variables only.
- Pim bobs `sin(elapsed*2)*.03`, and the pennant sways.

**Stall point**: centre + (0, .9, +HALF_BEAM). Reach is a horizontal distance <= REACH (+GUEST_SLACK for the guest). Positions come
from `ctx.physics` for the host and `ctx.other` for the guest, like kiln.js posOf.

**action(a, actor, bag)** handles `trader.*` on the host only:
- Out of reach it fails with `far`, "Get a bit closer to Pim"; otherwise it runs applyTrade.
- ok: `{kind:'loot', text:'+ 2 Bright Shell'}` goes to the actor. The plan and the float also send a notice to 'all':
  "Shell Wreath plan learned!" / "Pim hands over a Glass Float".
- Fail: `{kind: reason==='full' ? 'full' : 'notice', text}` to the actor. Always return true.

**craftLocked(id)**: `'shellwreath'` not in plans returns 'Buy the plan from Pim’s barge'; otherwise null.

**interact / prompt**: the target is the kiln.js aim ray passing within 1.6 m of the stall (along > 0), with the player within REACH+4.

- **Docked and in reach**: prompt `<kbd>E</kbd>Trade with Pim (m:ss)`, and E opens the dialog.
- **Docked but too far**: prompt "Swim a little closer to Pim".
- **Approach**: prompt "Pim is still tying up…"; interact returns true and does nothing.
- **Depart / gone**: prompt null, interact false.

Prompt text is static plus digits; anything dynamic goes through `ctx.esc`.

**UI open**: `ctx.releaseLock()`, then a lazy `import('./trader-ui.js')` (the storage-research.js loadUI pattern); a failure sets
`uiFailed`, so there is no per-frame retry. After the await, open only if `!disposed && !ctx.uiOpen()` and the barge is still docked
and in reach. `update` calls `ui.tick()` while open, and closes the dialog when the phase is no longer docked, the seed changes, or
the player is more than CLOSE_DIST+REACH away.

**dispose()**: `disposed = true`, `ui?.dispose()`, remove the group, and free the barge and decor geometry for real.

## 5. dist/trader-model.js (copy kiln-model.js mergeParts/painter/shareable)
`buildBarge(T)` returns `{group, pim, pennant, dispose}`, built lazily on the first visit, in **5 draw calls**:
1. Hull, deck, crates, mast and counter: one merged vertex-colour mesh, about 4 m (x) × 1.8 m. The only shadow caster.
2. Awning and sail: cloth, DoubleSide, no shadow.
3. Pim: one merged mesh.
4. Emissive `lanternGlow`.
5. Pennant: a plane.

The decor models share geometry and materials through `shareable()`. Instance dispose is a no-op (rebuildRaft disposes removed
children), and the module dispose frees them for real. `instance()` returns a new Group, origin at the tile top (y .22):
- `buildShellWreath(T)`: 1 mesh, a rope torus with shell bumps, named `craft_shellwreath`.
- `buildGlassFloat(T)`: 2 meshes, a net on a stand and a blue glass sphere (transparent .85, emissive #2a6f9a at .4), named `craft_glassfloat`.

## 6. dist/trader-ui.js: `createTraderUI(api)` -> `{open, close, tick, isOpen, dispose}`
`api = {offers(), stock(), visitSeed(), left(), bag(), plans(), trade(i), esc, requestLock}`.
- **Look**: one style tag injected once, copying the `lr-sr` look (gradient `#b48d55→#8a663a`, border `#3e2a17`), with `sv-slot`
  icons via survival-ui `iconSVG`/`paintSlot`.
- **Layout**: header with `icon-shell`, "Pim's Barge" and "casts off in m:ss". Each row is give icons and counts → get icons (a plan
  shows the wreath icon and "Plan"), stock pips, and a Trade button. A disabled button shows the `tradeCheck` reason text (reach is
  not checked here). Footer: "Your shells: N".
- **Escaping**: all text goes through textContent or `api.esc`.
- **Repaint**: only when `r|bag.version|left-seconds` changes.
- **Click**: `api.trade(i)` -> `ctx.action({kind:'trader.trade', offer:i, visit:seed})`, then blur the button so Space/Enter
  can't repeat it.
- **Keys don't leak**: the dialog keydown handler stops propagation of every key. E and Tab close it (`!e.repeat`, preventDefault).
  `cancel` (Esc) calls preventDefault and then close(). Wheel is stopped. On close, call requestLock if running.
- **dispose()**: one AbortController owns all listeners; abort it, close the dialog, and remove the node.

## 7. Content wiring (re-read each region right before the edit; append only)
- **content.js**: `import { createTrader } from './trader.js?build=v3-survival-ae77fa84ac2b';` and `createTrader` at the END of FEATURES.
- **content-items.js**:
  - CONTENT_ITEMS: `shell: item('shell','Bright Shell','icon-shell',false)`, plus `shellwreath`/'icon-wreath' and `glassfloat`/'icon-float'.
  - CONTENT_RECIPES: `shellwreath: recipe('shellwreath','Shell Wreath',1,{shell:3,rope:2,leaf:2})`.
  - CONTENT_DECOR: add `'shellwreath','glassfloat'`. CONTENT_BLOCK_RADIUS: `shellwreath:.12, glassfloat:.2`.
- **icons.svg**: 3 symbols (viewBox 48, `#153e49` stroke): a fan shell, a ring of shells, and a netted blue ball.
- **survival-ui.js**: SPRITES gets `'shell','wreath','float'`; SPRITE_FOR gets `shell:'shell', shellwreath:'wreath', glassfloat:'float'`.

## 8. Debug (`raftDebug.content.trader`; on a guest the writes return false)
- **Read**: `state()` (a JSON copy plus phase and left), `phase()`, `offers()`, `stock()`.
- **Time**: `summon(seed?, docked=true)` spawns now (docked: born = clock - APPROACH); `skip(sec)` advances the host clock by
  0..3600 s and runs the phase logic once; `clear()` sets visit null and next = clock + FIRST.
- **Play**: `give(kind,n)` adds to the local bag; `trade(i)` goes through `ctx.action` with the current seed; `aimAt()` puts the
  player 2 m from the stall, facing it; `open()` / `close()` drive the dialog.

## 9. Plan unlock: the one engine line
In game.js, replace the line tagged `[progression-hook] items.js unlocks own the catalogue` in place, with no import:
`setOwnedElsewhere(id => Object.prototype.hasOwnProperty.call(PROG_ITEMS, id) || id === 'shellwreath'); // ... + trader plan gates shellwreath`
- **Why**: storage-research comes earlier in FEATURES and would otherwise answer craftLocked first ("Study it first").
- **Accepted wart**: the craft list shows the wreath as unlocked before the plan is bought; crafting it then shows the plan notice.
- **If it can't stay one line**: drop the plan row, the recipe and craftLocked.

## 10. Co-op and save compat
- **Authority**: the host owns the clock, seed, stock and plans. Guests only send `trader.trade`, paid from the actor's own bag.
- **Shared stock**: any change bumps `r` and the guest repaints. Stale or late clicks are refused by the seed and phase checks.
- **Old saves, and hosts without the slice**: `load(undefined)` gives the defaults. The slice is under 1 KB.
- **Old builds**: a bag holding `shell` starts fresh (the content-kind rule), and placed wreath/float decor is dropped by the decor cleaner.

## 11. tests/trader.test.mjs (node:test; core plus a Bag from inventory-state.js)
1. offersFor: deterministic per seed, varies across seeds, length OFFERS, fixed rows first in order.
2. A `has` without puffegg/feather drops those rows and still fills to OFFERS; a test-pool def with an unknown kind is dropped.
3. The float row appears in 30-50% of 1000 seeds, always last.
4. pathAt boundaries, hold extends the dock, gone after DEPART; nextDelay stays in range.
5. parkAt: bow gap <= GAP for 1x1, wide and L-shaped rafts; the no-tile fallback.
6. applyTrade ok: shells in, fish out, stock-1, r+1, and `bag.slots` is the same array.
7. The failures missing, full, soldout, stale, closed and bad each leave the bag snapshot and the slice deep-equal.
8. Buying the plan pushes `shellwreath`; buying it again gives `known`.
9. cleanTrader never throws on undefined, junk, v2, a NaN clock, bad stock values or length, an unknown plan, or a non-uint seed.
10. The 3 kinds are in ITEM_INFO, the wreath recipe in RECIPES, and both decor ids in CONTENT_DECOR.

**QA**:
- `npm test`, and shoot.py `errors: []`.
- Browser: `summon(); aimAt(); open()`, then a screenshot; `give('fish',6); trade(0)` gives 2 shells; `skip(300)` departs and
  closes the dialog.
- coop-e2e: the host summons, the guest trades, and the host's stock drops.
