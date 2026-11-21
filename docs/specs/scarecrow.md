# Spec: Scarecrow and peckish gulls

Source: docs/features/scarecrow-research.md. Cozy rules: nothing is eaten, lost or rolled back, nobody is hurt, and there is no timer to beat.
Now and then a gull lands on the rim of a watered, still-growing Palm Planter and pecks. While it pecks, that planter's growth **pauses** (it never goes backwards).
Walk up to it or press E to shoo it. A craftable Scarecrow keeps planters within 4.5 m free of gulls, and gulls like to sit on its hat instead.
Planters are the live `dist/watering.js` garden (`world.garden["x,z"] = {water, grow}`), **not** `farming.js`.
New files: `dist/scarecrow.js` (pure helpers plus the `createScarecrow(ctx, peer)` content module), `dist/scarecrow-model.js` (gets THREE, imports nothing), `tests/scarecrow.test.mjs`.
Import new modules with `?build=v3-survival-ae77fa84ac2b`. Tag every hook line `// [scarecrow]`.

## 1. Item and recipe (dist/items.js)
| id | name | category | stack | recipe | unlock |
|---|---|---|---|---|---|
| `scarecrow` | Scarecrow | decor, `placeable:true` | default | `hand({wood:3, leaf:4, rope:2, plastic:1})` | `discover('rope')` |
- Put the row after `candle` (`items.js:185`), with `iconTint:'#c9a46a'`. Tip: "A friendly driftwood scarecrow. Gulls leave nearby planters alone and sit on its hat instead."
- `BLOCK_RADII` (`items.js:218-222`): add `scarecrow: 0.25`. `DECOR_TYPES` and `BLOCK_RADIUS` (`game.js:68,76`) pick it up through `PLACEABLE_IDS`/`BLOCK_RADII`, so game.js needs no edit for that.
- `dist/craft-book.js:23` category `scarecrow:'survival'`. Add an ITEM_TEXT row near `:79`: `{desc:'A driftwood post in a leaf skirt and a bucket hat.', use:'Place it near palm planters; gulls will not peck within about two tiles.'}`.
- Icon: draw it inline in `item-svg.js` ITEM_ICONS as the bees lane did (a post, a crossbar, a hat and a skirt).

## 2. Pure API in dist/scarecrow.js (no DOM, no Date, no Math.random)
```js
export const SCARECROW_RADIUS = 4.5, PALM_GULLS = 3, PALM_CHANCE = 0.25, PECK_MAX = 8, COOLDOWN = 90, REACH = 3, HOST_SLACK = 2;
export const PALM_RIM = 0.5, RIM_OFFSET = 0.3, HAT_TOP = 1.75;   // local heights above DECOR_Y; rim offset in metres
export const OLD_HOST = 'Your friend’s gulls are not peckish yet';
export function protectedPalms(decor)         // -> Set of "x,z" palm keys with hypot(dx*2, dz*2) <= SCARECROW_RADIUS to any scarecrow
export function rimSpot(tx, tz)               // -> {dx, dz}: RIM_OFFSET at angle ((tx*7 + tz*13) mod 8, made non-negative) * PI/4
export function canPeck(garden, key, decor)   // -> true only if decor has >= 2 palms, garden[key] exists, water === 1, 0 <= grow < 90
export function pickPecks(st, onPalm, garden, decor, now)  // host 1 Hz; mutates st; -> Set of pecked keys (size 0 or 1)
export function cleanNet(v)                   // -> {v:1, p:[<=1 valid key]} or null on junk
```
- **Host peck state** `st = {cur:null|{i, key, since}, cool:{key: until}}` lives only in memory. It is never saved.
- `pickPecks` rules, in order:
  1. If `cur` is set and gull `cur.i` is still in `onPalm` on `cur.key`, and `now - since < PECK_MAX`, and `canPeck` holds, keep it.
  2. Otherwise end it: set `cool[cur.key] = now + COOLDOWN` and `cur = null`.
  3. If nothing is pecking now, take the first entry of `onPalm` (in gull-index order) whose key passes `canPeck` and has `!(cool[key] > now)`, then set `cur`.
  4. Drop `cool` entries that have passed.
- At most one pecking gull per raft. A visit pecks for at most 8 s, and a planter then rests for 90 s. With one planter, the worst case is under 8 % slower. On average it is well under 5 %, because only about 1 in 4 visits of gulls 0 to 2 picks a planter.
- **Onboarding:** a raft with only one palm planter is never pecked. That keeps the first planter safe.

## 3. Wildlife changes (dist/wildlife.js)
Both clients agree, because every rule here depends only on seed, `t`, tiles and decor.
- `import { protectedPalms, rimSpot, PALM_RIM, HAT_TOP, PALM_GULLS, PALM_CHANCE } from './scarecrow.js?build=…'` (scarecrow.js never imports wildlife.js, so there is no cycle).
- `PERCH_TOP` (`:17`): add `scarecrow: HAT_TOP`.
- `perchesFrom(tiles, decor)` (`:65`): every pushed perch gets `kind` (`'deck'` or the decor type). A `palm` tile becomes a perch at `x = tx*2 + rim.dx`, `y = DECOR_Y + PALM_RIM`, `z = tz*2 + rim.dz` (with `rim = rimSpot(tx,tz)`, `kind:'palm'`), **unless** its key is in `protectedPalms(decor)`. In that case it is still no perch, as today.
- `gullVisit` (`:99`): add `v.palm = i < PALM_GULLS && rnd(s, 5) < PALM_CHANCE`. Use a new stream index, so the existing fields do not change.
- `gullPerch` (`:378`) latch loop: when `!V.palm` or `i >= PALM_GULLS`, skip perches with `kind === 'palm'`. When `V.palm`, first scan from `V.perch` for the first free `palm` perch. If none is free, fall back to the normal non-palm loop. Copy `kind` into `L.kind`. Gulls 3 to 5 (medium and high settings only) therefore never sit on a palm, and the planter visit looks the same on every quality setting.
- Folded-wing clamp: a palm perch is low (y about .72), so check the `FOLD_H` downstroke (`:167-174`) against the perch `py` and not the deck, so wingtips do not clip the pot.
- New (non-debug) module members:
  - `mod.onPalm(out)` clears `out` and pushes `{i, key}` for each gull `i < nG` whose `last.gs[i] === 'perched'` and whose latched or forced perch has `kind === 'palm'`. It allocates nothing beyond the reused objects.
  - `mod.shoo(key)` makes every gull that is descending to or perched on `key` take off, using the same code path as the layout-change scare (`:408-411`). It sets `awayX/awayZ` from the local player. It returns true if one left.
  - `mod.pecking` is a Set, set by the scarecrow module. A perched gull whose key is in it adds a head-bob pitch `0.35 * max(0, sin(t*9 + i))` in `updateGulls`.

## 4. Content module `createScarecrow(ctx, peer)` (name `'scarecrow'`)
- `dist/content.js`:
  - `:30` import it.
  - `:31` append `createScarecrow` to `FEATURES`, after `createWildlife`.
  - `:42` change to `make(ctx, peer)`, with `const peer = name => mods.find(m => m.name === name && !m.dead) ?? null;` defined above the loop. Older makers ignore the second argument.
  - Add two API members beside `rain()` (`:61`):
    - `pecked()` returns the scarecrow mod's `pecked` Set, or null.
    - `palmPrompt(aim, base)` returns that mod's `palmPrompt(aim, base)`, or null.
- `update(dt)`, on every client:
  - Animate the models (section 5).
  - Set `wild.pecking = view` for `wild = peer('wildlife')`. `view` is the host's own set, or for a guest the set rebuilt from the last `ext.scarecrow.p`.
- `update(dt)`, on the host only (`ctx.running && ctx.role !== 'guest'`): `clock += dt`. Once per whole second:
  - `wild.onPalm(buf)`
  - `pecked = pickPecks(st, buf, ctx.world.garden, ctx.world.decor, clock)`
  - If `pecked` changed, bump `r`.
  - No notices, no sounds and no allocation per frame beyond the 1 Hz tick.
- `serialize()`: when `ctx.role === 'host'`, return `{v:1, p:[...pecked]}`, cached by `r`. Otherwise return `undefined`, so solo saves never carry `ext.scarecrow`.
- `load(data, from)`:
  - `'net'`: `hostHasScarecrow = data !== undefined`, and `netP = cleanNet(data)?.p ?? []`.
  - `'save'`/`'restore'`: reset `st`.
- `target(aim)`: the nearest `palm` within `REACH` of the player along the view ray. Copy it from `bees.js` `target` with the type check and `cy = raft.y + .5` changed. It returns `{x, z, key}` or null.
- `palmPrompt(aim, base)`: when the target key is pecked (in the host set, or in `netP` on a guest), return `<kbd>E</kbd>Shoo the gull · ` followed by `base` with its leading `<kbd>…</kbd>` stripped, or the plain stage text. Otherwise return null. A guest with `!hostHasScarecrow` always gets null.
- `interact(aim)`: return **true only** when the aimed palm is pecked. Otherwise return false, so harvest, water and every other E fall through (`game.js:984` runs before the watering E at `:987`). On a shoo:
  - call `wild.shoo(key)` locally, so the shoo feels instant;
  - call `ctx.notice('Shoo!', 1200)`;
  - call `ctx.action({kind:'scarecrow.shoo', x, z})`.
  - A ripe palm is never pecked, so `<kbd>E</kbd>Harvest palm` is never shadowed.
- `action(a, actor)`: claim kinds that start with `'scarecrow.'`.
  - `x` and `z` must be ints.
  - Take `pose = actor === 'guest' ? ctx.other : ctx.physics`, and reject the action when `hypot(x*2 - pose.x, z*2 - pose.z) > REACH + HOST_SLACK`.
  - On the host: `wild.shoo(key)`. If `st.cur?.key === key`, set `cool[key] = clock + COOLDOWN`, `cur = null` and `r++`.
  - Return true even when nothing was pecking, because the gull may already have left.
- Walking near still spooks through the existing `SCARE_RADIUS` 3 m `spooks()` check on both clients. The host's next 1 Hz pass sees the gull gone and ends the peck.
- `decorModel(type)`: `scarecrow` returns `createScarecrow3D(T)`, and every other type returns null. The chain at `game.js:525` and the ghost at `:400` already reach `content?.decorModel`.

## 5. Model (dist/scarecrow-model.js) and animation
- `createScarecrow3D(T)` returns a Group named `craft_scarecrow`, with its origin at the floor top. It is about 0.9 wide, 1.8 tall and 0.4 deep, and uses flat shading. All of it is our own design:
  - **Post:** a bleached driftwood post (a slightly bent box chain, #cdbb9a with a grey-brown tip #9e8e73), set into a small plank cross foot.
  - **Arms:** a crossbar at 1.25 m, about 0.85 long.
  - **Leaf skirt:** 8 tapered palm-leaf planes (#6fae4f / #5a9a40) hanging from 1.0 m to 0.45 m, tilted out by 15°.
  - **Head:** a burlap sack sphere (r .16, #d8c08e) with a painted-on shell smile (a thin arc of 5 small white discs) and two dark button eyes.
  - **Hat:** a floppy bucket hat (a slightly squashed cylinder crown on a wide thin brim, #e07a4f). It is taken from the plastic in the recipe, and its top sits at `HAT_TOP` (1.75).
  - **Rags:** two groups, `ragL` and `ragR`, each 2 thin rag strips (#8fb8d8, #e8d6a8) pivoting at the crossbar ends.
- Merge the static parts into one vertex-coloured mesh with a small local merge (as bees-model.js does). Keep only `ragL` and `ragR` separate.
- `swayRags(g, t, k)` sets `ragL.rotation.z = 0.25*k*sin(t*2.1)` and `ragR.rotation.z = -0.25*k*sin(t*2.1 + 1.3)`, and adds a small `.x` flutter at `t*5.3`.
  - `k = 1`, or `1.8` while rain is above 0.3. Read rain as `peer('daynight')?.rain`.
- Scarecrow groups are found with a `Map` of `craft_scarecrow` children, rebuilt only when `ctx.raft.children.length` or `children[0]` changes (the scan pattern in bees.js).
  - Sway a scarecrow only when the camera is within 20 m.

## 6. Small hooks in existing files (each one line, tagged `[scarecrow]`)
- `dist/watering.js:tick` (`:96`): `tick(world, dt, skip)`. Inside the garden loop (`:103`), add `if (skip && typeof skip.has === 'function' && skip.has(k)) continue;`. The third argument is optional, so every existing caller and test is unchanged. Purifiers ignore `skip`.
- `dist/game.js` host loop (`:1297`): `tickWatering(world, 1, content?.pecked?.() ?? null)`.
- `dist/game.js:updateContext` (`:588`): `else if (waterAim?.prompt) html = content?.palmPrompt?.(frameAim, waterAim.prompt) ?? waterAim.prompt;`.
- `dist/content.js`: the import, `FEATURES`, the `peer` argument, and `pecked()`/`palmPrompt()` (section 4).
- `dist/wildlife.js`: the import, `PERCH_TOP`, `perchesFrom`, `gullVisit`, `gullPerch`, `onPalm`/`shoo`/`pecking`, and the fold clamp (section 3).
- `dist/items.js`: the item row and the radius. `dist/craft-book.js`: the category and the text. `dist/item-svg.js`: the icon.

## 7. State, saves and co-op
- **`world.ext.scarecrow`** is net-only: `{v:1, p:["x,z"]}` (0 or 1 key). The host sends it through `hostState()` (`game.js:1264`) at about 8 Hz. It is never in a save, because `serialize` returns `undefined` unless the role is `'host'`. Even if a host save keeps it, `load('save')` ignores it.
- **Growth state is untouched.** The pause just skips seconds in `tick`, and the garden syncs to the guest as usual, so the % in the prompt stops on both sides. No garden field is added.
- **Old save:** no change and nothing to migrate. Planters become perches from the next layout hash.
- **New save in an old build:** `cleanWorld` drops the unknown `scarecrow` decor (`game.js:179`), and `migrateSnapshot` drops `scarecrow` bag items (`items.js:455`). This is accepted, as in earlier lanes.
- **Guest:** it never computes pecks into `garden`. Its E sends `scarecrow.shoo`. Its local `wild.shoo` is purely visual.
- **Old host / new guest:** `ext.scarecrow === undefined` → `hostHasScarecrow = false` (like `hostHasBees`, `bees.js:112`). No shoo prompt, no head-bob and no actions are sent. Gulls may still sit on pots, and walking up spooks them.
- **New host / old guest:** the old guest has no palm perches, so it sees no gull on that pot. The host's pause still shows through `garden`. This is harmless. Mixed-version co-op is unsupported: say so in the PR.
- Determinism caveat: the guest's slewed clock and `perchFree` player checks may differ slightly. Only the host's set drives growth and `p`.

## 8. Tests
**New `tests/scarecrow.test.mjs`** (node:test, `RAFT_DIST` base URL, vendored THREE, stub ctx as in bees.test.mjs):
1. `protectedPalms`: a palm at 2 tiles (4 m) is protected and one at (2,1) (4.47 m) is protected. One at (3,0) (6 m) is not. Other decor types are ignored.
2. `rimSpot` is deterministic. `hypot(dx,dz) === RIM_OFFSET` for negative and positive tiles.
3. `canPeck`: it is false for a dry, empty or ripe (grow 90) entry, a missing entry, or a raft with only one palm. It is true for water 1 and grow 30 with two palms.
4. `pickPecks`:
   - Two gulls on two palms give a set of size 1.
   - A peck ends at `PECK_MAX` and sets the cooldown, and the same key is refused until `now >= until`.
   - A gull that has left ends the peck.
   - `garden` is never mutated.
5. Pause: with `tick(world, 1, new Set([k]))` × 30, `grow` is unchanged and another palm grows by 30. `tick(world, 1)` with no skip behaves exactly as before. `grow` never decreases over 600 random pick/tick steps.
6. `cleanNet`: junk → null, more than one key → first valid only, bad keys dropped.
7. Module:
   - `interact` returns false for an aimed palm that is not pecked (harvest still works) and true for a pecked one.
   - `action` rejects non-int and out-of-reach input.
   - `serialize()` is `undefined` for `'solo'`.
   - `load(undefined,'net')` on a guest makes `palmPrompt` return null.
8. Wildlife integration (stub ctx, `createWildlife`):
   - Gulls 3 to 5 never latch a `palm` perch over 200 slots.
   - About 15 to 35 % of gull 0 to 2 visits land on a palm when palms exist.
   - A palm within 4.5 m of a scarecrow never appears in `perchesFrom`, and a scarecrow tile gives a perch at `y ≈ .22 + 1.75`.
9. Model: `craft_scarecrow` has `ragL`/`ragR`, its box fits 1 × 1.9 × 0.6, and `swayRags` changes rotation.
10. items: `scarecrow` crafts from its cost and `BLOCK_RADII.scarecrow === 0.25`.

**Update `tests/wildlife.test.mjs:21-36`:** palms are now perches. With the `DECOR` fixture, `p.length` becomes 9, `'0,1'` is present with `kind 'palm'`, `y ≈ .72` and an x/z rim offset, and the expected key list gains `'0,1'`. Add a case where adding a scarecrow at (0,0) drops `'0,1'` and makes `'0,0'` a hat perch. Check any `gullVisit` `deepEqual` for the new `palm` field.
Run `npm test` and shoot.py, and the `errors` list must be empty.

## 9. QA helper: `raftDebug.content.scarecrow`
- `state()` returns a JSON copy of `st`, plus `pecked` and `netP`.
- `scene({protect = false} = {})`, host only:
  - It places 2 palms on free tiles next to the player, with `garden = {water:1, grow:30}` each, and a scarecrow 3 tiles away. With `protect:true`, the scarecrow goes 1 tile from the first palm instead.
  - It calls `ctx.rebuildRaft()`, then `peer('wildlife').debug.landGull(0, {perch: <index of the first palm perch>, instant:true, stay:30})` and forces an immediate `pickPecks`.
  - It returns `{palms:[keys], scarecrow:key}`. Screenshot the pecking gull, the shoo prompt and the sway.
- `shoo()` acts as E on the pecked key. `fastForward(sec)` runs the host 1 Hz loop.

## Build notes
- Hook lines are tagged `// [scarecrow]` (game.js `tickWatering` line uses an inline `/* [scarecrow] */` because the line continues).
- `createScarecrow` sits right after `createWildlife` in `FEATURES`, as specced. `content.palmPrompt` wraps the call in try/catch and disables the module on a throw, like other content calls.
- Fold clamp (section 3): `gullPlan` already measures the downstroke from the perch `py` (`hh = out.y - out.py`), so a pot-rim perch needed no change there.
- `wildlife.debug.perches` now refreshes perches before it copies them, so `scarecrow.scene()` can find the new palm perch right after `rebuildRaft()`.
- `onPalm` reuses one `{i, key}` per gull. `shoo` also matches a latched perch only in the current slot.
- `scene()` adds missing raft tiles if the raft has no free spot. If no palm perch exists (`protect:true`), the gull lands on the scarecrow hat instead. The forced first `pickPecks` uses the landed gull directly, because wildlife has not drawn a frame yet. It also returns `perch` and `pecked` for QA.
- The model's leaf skirt and rags use `DoubleSide` on the shared vertex-coloured material, with 3 meshes per scarecrow. The `ragL`/`ragR` group refs are cached in `userData.rags`, so `swayRags` does no lookups.
- The planter that `palmPrompt` checks comes from its own ray pick, the same as bees `target`. It does not use the watering aim. On adjacent palms both normally pick the same pot.
- Mixed-version co-op is unsupported (an old guest sees no gull on the pot, and an old host means no pecks). Say so in the PR.
