# Spec: Beehive, Flower Box, honey and wax

Source: docs/features/beehive-research.md. Cozy rules: the bees are friendly and never sting, nothing wilts, nothing is ever lost.
Place Flower Boxes, put a Beehive next to them, and the hive slowly fills with honeycomb. E collects Honey and Beeswax.
Logic goes in the new content module `dist/bees.js` (pure helpers plus the `createBees(ctx)` factory). Models go in the new `dist/bees-model.js` (it is given THREE and imports nothing).
New modules are imported with `?build=v3-survival-ae77fa84ac2b`. game.js gets **no edits**: everything goes through items.js, the content hooks and one daynight hook.

## 1. Items and recipes (dist/items.js, the single catalogue)
| id | name | category | stack | recipe | unlock |
|---|---|---|---|---|---|
| `flowerseed` | Flower Seed | material | 20 | `null` (gathered) | START |
| `flowerbox` | Flower Box | decor, `placeable:true` | default | `hand({wood:2, flowerseed:1})` | `discover('flowerseed')` |
| `beehive` | Beehive | decor, `placeable:true` | default | `hand({wood:4, rope:2, leaf:2})` | `discover('flowerseed')` |
| `honey` | Honey | material | 20 | `null` (gathered) | START |
| `wax` | Beeswax | material | 20 | `null` (gathered) | START |
| `candle` | Beeswax Candle | decor, `placeable:true` | default | `hand({wax:2, rope:1})` | `discover('wax')` |
| `honeyfish` | Honey Glazed Fish | food | 10 | `hand({cookedfish:1, honey:1})` | `discover('honey')` |
- Place the materials after the existing raw materials, `honeyfish` right after `cookedfish` (`items.js:150`), and the three decor items after `palm` (`items.js:157`).
- Tips (each >10 chars, friendly): seed "A tiny seed from an island bush. Plant it in a flower box."; flowerbox "A box of bright blooms. Bees love it."; beehive "A cosy hive. Put flower boxes close by and the bees make honeycomb."; honey "Sweet, golden and sticky."; wax "Soft beeswax from the comb. Good for candles."; candle "A little jar candle that glows warmly at night."; honeyfish "Grilled fish with a honey glaze. The seagull is very jealous."
- `honeyfish` is a hand recipe because station recipes take exactly one input (`tests/progression.test.mjs:142`).
- `BLOCK_RADII` (`items.js:191-194`): add `flowerbox:0.3, beehive:0.35, candle:0.1`. `DECOR_TYPES`/`BLOCK_RADIUS` in game.js pick them up through `PLACEABLE_IDS`/`BLOCK_RADII` with no game.js edit.
- Icons: add seven original `<symbol viewBox="0 0 48 48">` to dist/icons.svg (`icon-flowerseed` teardrop seed with a sprout, `icon-flowerbox` planter with three blooms, `icon-beehive` dome skep with a door, `icon-honey` jar with a dripper, `icon-wax` pale hexagon block, `icon-candle` jar with flame, `icon-honeyfish` fish with a gold drizzle) and pass `icon:'icon-…'`. If time runs out, leave `icon` out so `placeholder` is true.
- Held pose: none. New kinds use the generic fallback in held-items.js.

## 2. Gating
Flower Seed in the bag unlocks the Flower Box and the Beehive (existing discover toasts). The first harvest gives honey and wax, which unlock the Honey Glazed Fish and the Candle. Nothing needs the Tinker's Desk.

## 3. Flower seed sources
- **Island bushes** (`islands-layout.js:186`): `const h = hash3(seed, node, used); return h < 0.2 ? [['leaf',1],['flowerseed',1]] : h < 0.5 ? [['leaf',1],['seed',1]] : [['leaf',1]];`.
  Do not add a `NODE_KINDS` entry (it shifts node indices and saved `used[]`). The rate of "any seed" stays at 0.5, so `tests/islands.test.mjs:122-129` passes unchanged (it counts `length - 1`).
  Add to that test: `flowers = count of lootFor('bush', s, 0, 0) containing 'flowerseed'` over 400 seeds, `assert.ok(flowers > 40 && flowers < 130)`.
- Prompt label (`islands.js:29`): bush becomes `'Pick from bush: leaves, maybe a seed or a flower'`.
- **Barrels** (`items.js:264-276`): insert `{ kind: 'flowerseed', min: 1, max: 1, weight: 6, pool: 'treasure' }` right before the treasure `scrap` row (`:275`).
  Clay stays first and scrap stays last, so `rollBarrel(()=>0)` / `rollBarrel(()=>1)` at `progression.test.mjs:282-283` are unchanged. Treasure total becomes 102: update the rate numbers in the comment at `items.js:250-258` (about .06 flower seed per barrel).
  The reachability test (`progression.test.mjs:179-198`) seeds `have` from `BARREL_LOOT`, so `flowerseed` is reachable with no edit there. The pity test (`:306`) is unaffected because `flowerseed` is not a pity kind.

## 4. State: `world.ext.bees`
`{v:1, s, r, h:{"x,z":{c, t}}}`. `s` is a session id (as storage-research), `r` a revision counter. Keys are tile ints matching `/^-?\d+,-?\d+$/`.
- `c` integer 0..`COMB_MAX` (3), whole combs ready. `t` integer 0..`COMB_WORK-1`, work into the next comb. A missing entry is an empty hive `{c:0,t:0}`; an all-zero entry is deleted.
- An entry is kept only if `world.decor` has a `beehive` at that tile. Pruned in `cleanBees` on every load and every tick. At most 400 entries (the tile cap), so the slice stays tiny inside the 200k `EXT_MAX`.
- Flower count is derived, never stored: `flowersNear(decor, x, z)` counts `flowerbox` decor with `max(|dx|,|dz|) <= FLOWER_RANGE` (2 tiles).

**Fill rule** (one whole second at a time): `f = min(flowersNear, FLOWER_CAP)`. If `c >= COMB_MAX` or `f === 0`, nothing happens. Else `t += f`; when `t >= COMB_WORK`, `c += 1` and `t -= COMB_WORK`; at `c === COMB_MAX` set `t = 0`.
Numbers: `COMB_WORK = 360`, `FLOWER_CAP = 3`, `COMB_MAX = 3`, `MAX_TICK = 60`. One comb takes 2 min with 3 flowers, 3 min with 2, 6 min with 1. A full hive (3 combs) takes 6 min at best.
**Harvest yield:** per comb `HONEY = 1`, `WAX = 1`. After harvest `c = 0`, `t` is kept.

## 5. Pure API in dist/bees.js (no DOM, no Date, no Math.random in the helpers)
```js
export const COMB_WORK = 360, COMB_MAX = 3, FLOWER_CAP = 3, FLOWER_RANGE = 2, MAX_TICK = 60, REACH = 2.6, HOST_SLACK = 2;
export const OLD_HOST = 'Your friend’s raft doesn’t have bees yet';
export function cleanBees(v, decor)           // -> {v:1, s, r, h}; junk/undefined/array -> defaults; drops bad keys, clamps c/t to ints in range, prunes non-hive tiles
export function flowersNear(decor, x, z)      // -> int
export function tickBees(st, decor, dt)       // dt floored, clamped 0..MAX_TICK, applied 1 s at a time; mutates st.h; bumps st.r if anything changed
                                              // -> {filled:[keys whose c went up], full:[keys that just reached COMB_MAX]}
export function hiveInfo(st, decor, x, z)     // -> {c, t, flowers} or null when no hive at that tile
export function harvest(st, decor, key, bag)  // -> {ok:true, kind:'loot', text} | {ok:false, reason:'notarget'|'empty'|'full', text}
```
`harvest` is atomic: `s = new bag.constructor(bag.snapshot())`, `s.add('honey', c) === 0 && s.add('wax', c) === 0`, then copy `s.slots` into `bag.slots`. A failure changes nothing and the comb stays.
Texts: ok `"+ N honey · N beeswax"`, full `"Your bag is full"`, empty `"No honeycomb yet"`, notarget `"Nothing to collect"`.

## 6. Content module `createBees(ctx)` (name `'bees'`)
- `load(data, from)`: `'save'`/`'restore'` → `st = cleanBees(data, ctx.world.decor)`, new `s`, `r++`. `'net'` → return early when `data?.r === netR && data?.s === netS`, or when `data === undefined && netUndef`. Set `hostHasBees = data !== undefined` (the OLD_HOST guard, as `storage-research.js:348-357`).
- `serialize()`: cached by `r` (pattern `storage-research.js:363-367`).
- `update(dt)`: every client: run the visuals (section 7). Host tick only when `ctx.running && ctx.role !== 'guest'` (solo is `'solo'`): `clock += dt; if (clock >= 1) { const n = Math.floor(clock); clock -= n; const r = tickBees(st, ctx.world.decor, n); if (r.full.length) ctx.emit({kind:'notice', text:'A beehive is full of honeycomb'}, 'all'); }`. No allocation per frame beyond the 1 Hz tick.
- `target(aim)`: the nearest `beehive` decor within `REACH` of the player along the view ray, copied from `storage-research.js:274-290` with the type check changed. Returns `{x, z, key}` or null.
- `prompt(aim)` (static text, no `esc` needed):
  - old host (guest and `!hostHasBees`) → `OLD_HOST`
  - `c > 0` → `<kbd>E</kbd>Collect honeycomb (c)`; at `c === 3` add ` · full`
  - `c === 0`, flowers 0 → `Beehive: bees need a flower box nearby`
  - `c === 0`, flowers ≥ 1 → `Bees are busy… N%`, with `N = floor(t / COMB_WORK * 100)`
- `interact(aim)`: no target → false. Old host → `ctx.notice(OLD_HOST, 2400)`, true. `c === 0` → `ctx.notice('No honeycomb yet')`, true. Else `ctx.action({kind:'bees.harvest', x, z})`, true.
- `action(a, actor, bag)`: claim kinds starting with `'bees.'`. For `bees.harvest`: `x`,`z` must be ints; pose is `actor === 'guest' ? ctx.other : ctx.physics`; reject if `hypot(x*2 - pose.x, z*2 - pose.z) > REACH + HOST_SLACK`. Then `harvest(...)`, `ctx.emit({kind: r.ok ? 'loot' : (r.reason === 'full' ? 'full' : 'notice'), text: r.text}, actor)`, `st.r++`.
- `decorModel(type)`: `beehive` → `createHive(T)`, `flowerbox` → `createFlowerBox(T)`, `candle` → `createCandle(T)`, else null. createCraft/createSignalModel/prog.modelFor all return null for these types, so the existing chain at `game.js:496` and the ghost at `game.js:389` reach it.
- `debug`: `{state: () => JSON.parse(JSON.stringify(st)), hives: () => [...]}` for QA aiming.

## 7. Models (dist/bees-model.js) and visuals
- `createHive(T)`: Group `craft_beehive`, origin at the floor top, about 0.6 x 0.6 x 0.8. A wooden stand (box .55 x .08 x .55, #9c7649) on four short legs; a straw skep of 4 stacked tapering cylinders (#d9a441 / #c58f32 alternate, flat shading); a dark door arch (#3b2a1a) at the front; a small pitched roof board. Three `comb0..comb2` meshes: hexagon-prism slabs (CylinderGeometry with 6 radial segments, r .07, h .03) in honey #f2b134, emissive #7a4a00 .25, set into a window strip on the front. `comb i` is visible when `i < c`. A `bees` Group of 3 tiny meshes (body sphere r .025 #f5c542 with a dark stripe, two white wing planes), hidden by default.
- `createFlowerBox(T)`: Group `craft_flowerbox`, a planter box .7 x .22 x .35 (#a0704a) with dark soil top, and 6 blooms: thin green stems plus a 5-petal disc (small flattened spheres) with a yellow centre, colours #ff7aa2, #ffd35a, #9b7bff, #ff9f45, #6fd3ff, #ffffff. Static, no per-frame work.
- `createCandle(T)`: Group `craft_candle`, about .2 tall: a glass jar (open cylinder, transparent, `userData.glass = true`), a cream wax cylinder named `candle` (emissive #ffb35a .15), a cone named `flame` (emissive #ffcc66 .8), and a small sphere `lanternGlow` above the wick (emissive #ffd27a .5, transparent .6). All three named meshes are **direct children** of the group, as daynight expects.
- `paintHive(g, c, active, elapsed, near)`: comb visibility with a `g.userData.sig = c` early return; bees visible only when `active && near`. Each bee orbits the skep: angle `elapsed*1.6 + i*2.1`, radius `.35 + .05*sin(elapsed*3+i)`, y `.55 + .1*sin(elapsed*2.3+i)`.
- Hive lookup: bees.js keeps a `Map<key, group>`, rebuilt only when `ctx.raft.children.length` or `children[0]` changes (daynight's `scanRaft` pattern, `daynight.js:400`). Key = `tileKey(round(g.position.x/2), round(g.position.z/2))` for groups named `craft_beehive`.
- Per frame: for each hive, `near = camera distance² < 64` (8 m); `active = flowers > 0 && c < COMB_MAX` (guests compute flowers from their synced decor). Old host: paint every hive as `c = 0`, no bees.
- **Candle night glow** (dist/daynight.js, two lines): `:404` `if (decor[i]?.type === 'lantern' || decor[i]?.type === 'candle') n++;` and `:413` `if (g.name !== 'craft_lantern' && g.name !== 'craft_candle') continue;`. The `lanternGlow`/`flame`/`candle` names already match `LANTERN_PARTS` (`:242`), and `lanternGlow` gives the light anchor, so candles join the lantern light pool and brighten at night.

## 8. Hook lines
- `dist/items.js:150` honeyfish; seed/honey/wax rows with the other materials, the 3 decor rows after `:157`; `:192` radii; `:275` barrel row; `:250-258` comment.
- `dist/islands-layout.js:186` bush third outcome. `dist/islands.js:29` bush label.
- `dist/content.js:28` add `import { createBees } from './bees.js?build=v3-survival-ae77fa84ac2b';` beside the other imports, and append `createBees` to `FEATURES` (`:30`).
- `dist/daynight.js:404` and `:413` (section 7).
- `dist/icons.svg` seven symbols. New files: `dist/bees.js`, `dist/bees-model.js`, `tests/bees.test.mjs`.

## 9. Co-op and backward compatibility
- Host-authoritative: only the host ticks and validates. Guests get `ext.bees` through `hostState` (`game.js:1214`, about 8 Hz) and decor through the normal snapshot. A guest's E sends `bees.harvest`; loot lands in the guest's bag on the host.
- **OLD_HOST guard:** a new guest aboard an old host gets `ext.bees === undefined`: it shows empty combs, no bees, prompt `OLD_HOST`, and never sends `bees.harvest`. An old host would drop the decor anyway.
- An old guest on a new host skips the unknown decor (cleanWorld filter) and the ext slice. Unknown bag kinds: `migrateSnapshot` (`items.js:426`) drops them. Mixed-version co-op is unsupported; say so in the PR.
- **Old save** has no `ext.bees`: `cleanBees(undefined)` gives defaults. New kinds and decor are additive. An old build loading a new save drops hives, boxes, candles and honey/wax/seed: accepted, as for earlier lanes.
- Decor cannot be removed (only building pieces can), so a hive is permanent. Hive removal is out of scope.

## 10. tests/bees.test.mjs (node:test, assert/strict, `RAFT_DIST` base URL, `bagWith` helper as watering.test.mjs)
1. `cleanBees`: undefined, null, array, string → defaults. Bad keys, floats, negatives, `c > 3`, `t >= 360` are dropped or clamped. Entries on tiles without a beehive (including a flowerbox tile) are pruned.
2. `flowersNear`: Chebyshev range 2 counts boxes at (2,2) and not at (3,0); other decor types are ignored.
3. Fill: 0 flowers → no change after 600 s. 3 flowers → `c=1` after 120 ticks of 1 s, not after 119. 1 flower → 360 s. 5 flowers fill at the capped rate. `c` stops at 3 with `t = 0`; `full` lists the key exactly once.
4. `dt` 0.9 counts 0; `dt` 1e6 is clamped to 60. Removing the hive from decor prunes its entry on the next tick.
5. Harvest: `c=2` → +2 honey, +2 wax, `c=0`, `t` kept. A full bag → `full`, bag snapshot and `c` unchanged. `c=0` → `empty`. No hive → `notarget`.
6. Module: `action` rejects non-int tiles and out-of-reach actors (bag and state unchanged); `load(sameData,'net')` twice is a no-op (state object identity kept); `load(undefined,'net')` sets the OLD_HOST prompt.
7. Determinism: two identical worlds with the same tick sequence end up `deepEqual`.
8. Models with the vendored THREE: `createHive` has `comb0..2` and `bees`; `paintHive(g,2,…)` shows two combs; `createCandle` has direct children `candle`, `flame`, `lanternGlow`; sizes fit 0.7 x 0.9 x 0.7.
9. items: `flowerbox`/`beehive`/`candle` craft from their costs, `honeyfish` from `{cookedfish:1, honey:1}`; `new Bag` accepts a snapshot holding all seven kinds.
Also: islands flower rate assertion (section 3); a daynight test that a `craft_candle` group's `lanternGlow` gets the night multiplier, alongside `tests/daynight.test.mjs:337`.
Run `npm test` and shoot.py. The `errors` list must be empty.
