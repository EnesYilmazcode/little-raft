# Spec: Juicer and fruit smoothies

Source: docs/features/juicer-research.md. Cozy rules: nothing spoils, nothing is lost, a failed blend changes nothing.
Pick **Island Berries** from island bushes and get a **Coconut** with every ripe palm planter harvest. Place a **Juicer**, then press E on it with a
Cup of Fresh Water and 2 fruit in the bag to get a smoothie cup straight away. Drinking a smoothie gives water and a little food, and you get the empty cup back.
Logic goes in the new content module `dist/juicer.js` (pure helpers plus `createJuicer(ctx)`). The model goes in the new `dist/juicer-model.js` (it is given THREE and imports nothing).
**Build-query import rule:** every new or edited import carries `?build=v3-survival-ae77fa84ac2b` exactly (`tests/module-specifiers.test.mjs`). An unstamped
`vitals.js` import would load a second copy of the module with its own FOOD table, so juicer.js must never import vitals.js. It reads nothing from it.

## 1. Items (dist/items.js) and FOOD rows (dist/vitals.js:26-33)
| id | name | category | stack | recipe | unlock | FOOD row |
|---|---|---|---|---|---|---|
| `berries` | Island Berries | material | 20 | `null` (bushes) | START | `{food:4, water:2}` |
| `coconut` | Coconut | material | 20 | `null` (planter) | START | `{food:6, water:8}` |
| `berrycup` | Berry Smoothie | food | 5 | `null` (juicer) | START | `{food:10, water:35, returns:'cup'}` |
| `coconutcup` | Coconut Smoothie | food | 5 | `null` (juicer) | START | `{food:6, water:45, returns:'cup'}` |
| `mixcup` | Island Smoothie | food | 5 | `null` (juicer) | START | `{food:14, water:38, returns:'cup'}` |
| `juicer` | Juicer | **decor**, `placeable:true` | default | `hand({wood:4, scrap:2, rope:1})` | `discover('berries')` | none |
| `honeyfish` | (exists, items.js:181) | food | 10 | unchanged | unchanged | **`{food:45, water:0}`** (fixes the bug) |
- **Bug fix:** `honeyfish` is a food item with no FOOD row, so `isEdible('honeyfish')` is false and it cannot be eaten. Add the row above.
- The smoothie ids end in `cup`, so `eatLabel` reads "Drink (+10 food, +35 water)". Stack 5 matches the cups (`inventory-state.js:43-45`), so 5 cups never turn into more.
- Raw fruit is a weak snack on purpose. 2 raw fruit ≈ 10 food / 10 water; blended it is 6-14 food / 35-45 water and the cup comes back. A smoothie adds **no new water**
  beyond the freshcup it uses (+0 to +5), so the purifier loop stays the only real water source.
- Placement: fruit rows after `wax` (`items.js:104`), smoothies after `honeyfish` (`:183`), juicer after `candle` (`:204`), tag `// [juicer]`.
  `BLOCK_RADII` (`:240-244`): add `juicer: 0.3`. `DECOR_TYPES`/`BLOCK_RADIUS` pick it up with no edit. **Not `category:'station'`**: that would make
  `progression-hooks.js:32,88` adopt it and open the smelter slot panel on E.
- Tips (>10 chars): berries "Tart little berries from an island bush."; coconut "A hairy brown coconut from your palm planter."; berrycup "A pink berry smoothie. Drink it, keep the cup.";
  coconutcup "Cool, milky coconut. Very refreshing."; mixcup "Berries and coconut together. The best of both."; juicer "A hand-crank juicer. Bring a cup of fresh water and two fruit."
- Icons: leave `icon` out (placeholder), draw six bodies in `item-svg.js` ITEM_ICONS (`:10`), like the bees kinds: berry cluster, coconut half, three cups with a pink/cream/coral fill
  and a straw, and the juicer. No icons.svg or `survival-ui.js:22` SPRITES edit.

## 2. Fruit sources (no NODE_KINDS or barrel change)
- **Bushes** (`islands-layout.js:186`), keeping the pinned per-pick counts: only the plain-leaf branch splits, so each result keeps its length and the seed and flower rates stay as they are:
  `h < 0.2 ? [['leaf',1],['flowerseed',1]] : h < 0.5 ? [['leaf',1],['seed',1]] : h < 0.75 ? [['leaf',1]] : [['berries',2]]`. That is 2 berries on ~25% of picks.
  Label at `islands.js:29`: `'Pick from bush: leaves, maybe a seed, a flower or berries'`.
- **Palm planter** (`watering.js:7`): `HARVEST = Object.freeze({leaf:2, coconut:1})`. Texts at `:15`: `harvest:'+ 2 palm leaf · 1 coconut'`, `harvestBonus:'+ 2 palm leaf · 1 coconut · 1 wood'`.
  The harvest stays atomic through `trade()` (`:137`). The ripe model already shows coconuts (`purifier-model.js:89`).

## 3. Blends (pure, in dist/juicer.js; no DOM, no Date, no Math.random)
```js
export const REACH = 2.6, HOST_SLACK = 2, SPIN_SECONDS = 0.9;
export const OLD_HOST = 'Your friend’s raft doesn’t have a juicer yet';
export const MIXES = Object.freeze({ berry:{take:{berries:2}, out:'berrycup'}, coconut:{take:{coconut:2}, out:'coconutcup'},
                                     mixed:{take:{berries:1, coconut:1}, out:'mixcup'} });
export const JAR_COLOR = Object.freeze({ berry:0xc2335a, coconut:0xf1e8d6, mixed:0xe9835f });
export function pickMix(count, held)   // count(kind)->int; held = selected kind. -> mix id or null
export function blend(bag, mix)        // -> {ok:true, out, text} | {ok:false, reason:'nocup'|'nofruit'|'full'|'bad', text}
export function cleanJuicer(v, decor)  // -> {v:1, s, r, j:{"x,z":{m, n}}}; junk -> defaults; bad keys/mix ids dropped; n int 0..9999; non-juicer tiles pruned
```
- `pickMix`: needs `count('freshcup') >= 1`, else null. If you hold `berries` → `berry` when you have ≥2, else `mixed`. If you hold `coconut` → `coconut` when you have ≥2, else `mixed`.
  Otherwise the first mix you can afford, in the order `mixed`, `berry`, `coconut`. So holding one fruit picks that flavour, and the default is the mixed one.
- `blend` is all-or-nothing: `s = new bag.constructor(bag.snapshot())`; `s.remove('freshcup',1)` and each `take` (refuse `nocup`/`nofruit` before touching it), then `s.add(out,1) === 0`
  or `full`; on success copy `s.slots` into `bag.slots`. `full` only when no slot empties and none can take the cup (e.g. freshcup ×2, berries ×3, rest full).
  Texts: ok `'+ 1 Berry Smoothie'` (item name), nocup `'You need a cup of fresh water'`, nofruit `'You need 2 fruit'`, full `'Your bag is full'`, bad `'Nothing to blend'`.
- Slice `world.ext.juicer`: `{v:1, s, r, j}`. `j[key] = {m: last mix id, n: blend count mod 10000}`. It is only for show (the jar colour and the spin), but it is saved and synced
  so every viewer sees the same jar. At most 400 entries (the tile cap), so it stays tiny inside `EXT_MAX`. A missing entry means an empty jar.

## 4. Content module `createJuicer(ctx)` (name `'juicer'`), modelled on bees.js
- `load(data, from)`: copy `bees.js:167-180`. On `'net'`, return early when `r`/`s` are unchanged; set `hostHas = data !== undefined`. On `'save'`/`'restore'`, use `cleanJuicer(data, decor)`, a new `s`, and `r++`.
- `serialize()`: cached by `r`. `update(dt)`: the host prunes with `cleanJuicer` once a second (only when `ctx.role !== 'guest'`). Every client paints (section 5).
- `target(aim)`: copy `bees.js:116-137` with `d.type !== 'juicer'` and `cy = raft.y + .5`. It returns `{x, z, key}` or null.
- `prompt(aim)`, static strings only:
  - old host (guest and `!hostHas`) → `OLD_HOST`
  - `m = pickMix(count, held)` → `<kbd>E</kbd>Blend a berry smoothie` / `…coconut smoothie` / `…island smoothie`
  - no freshcup → `Juicer: needs a cup of fresh water and 2 fruit`; a cup but not enough fruit → `Juicer: needs 2 fruit (berries or coconut)`
- `interact(aim)`: no target → false. Old host → `ctx.notice(OLD_HOST, 2400)`, true. No mix → `ctx.notice(<the hint text>)`, true. Else `ctx.action({kind:'juicer.blend', x, z, mix})`, true.
- `action(a, actor, bag)`: claim kinds that start with `'juicer.'`. For `juicer.blend`, `x` and `z` must be ints with a `juicer` decor at that tile, and `mix` must be an own key of `MIXES`.
  The pose is `actor === 'guest' ? ctx.other : ctx.physics`; reject when `hypot(x*2-pose.x, z*2-pose.z) > REACH + HOST_SLACK`. Any rejection returns true with the bag untouched.
  Then `r = blend(bag, a.mix)`. On ok, set `st.j[key] = {m:a.mix, n:(n+1)%10000}` and `st.r++`.
  Emit `{kind: r.ok ? 'loot' : r.reason === 'full' ? 'full' : 'notice', text:r.text, loot: r.ok ? {[r.out]:1} : undefined}` to the actor.
  The host checks everything again: what the client chose for `mix` is only a request.
- `decorModel(type)`: `juicer` → `createJuicerModel(T)`, else null. It is reached by the decor chain `game.js:591` and the ghost `:428`.
- `debug`: `{state, target, place(x,z)}`, as in bees.

## 5. Model (dist/juicer-model.js) and view-only animation
- `createJuicerModel(T)`: Group `craft_juicer`, origin at the floor top, about 0.45 x 0.75 x 0.45, low-poly with flat shading. The static parts are merged into one vertex-coloured mesh
  (use bees-model's own little merge): a small stand (top .4 x .05 x .4 #9c7649 on four legs .32 tall #7d5a36), and a squat grey-tin body (cylinder r .1 h .14, 8 segments, #a9b4c2).
  On top sits a funnel hopper (an open cone, #8d97a3). A `crank` Group on the side holds an L arm (#5d6b78) and a round wooden knob (#c69860), pivoting on the x axis at the body centre.
  The `jar` is an open glass cylinder (r .07 h .12, `transparent` .35, `userData.glass = true`) under a spout. Inside it is `fill` (cylinder r .062, scaled y 0..1, `MeshLambertMaterial` coloured from `JAR_COLOR`).
  `splash` is a Group of 5 tiny droplet icosahedra (r .012), hidden by default.
- `paintJuicer(g, entry, spinT)`: `fill.visible = !!entry`, colour `JAR_COLOR[entry.m]`, with a `userData.sig = m` early return. While `0 < spinT < SPIN_SECONDS`: `crank.rotation.x = spinT * 14`,
  the `fill` scale y bobs `.8 + .2*sin(spinT*30)`, and `splash` is visible with each drop rising in a little arc above the jar (`y = .2 + sin(t*π)*.08`, spread by index). After that, `splash` is hidden.
- Who spins: juicer.js keeps `seen: Map<key, n>`. When a synced `n` differs from `seen` and the key was already seen, `spin[key] = 0`. A juicer seen for the first time does not spin.
  So host and guest both spin from the same synced data. There is no new effect kind, no sound (the loot feed plays its usual pickup cue) and nothing is saved.
  The group list is rebuilt only when `raft.children.length` or `children[0]` changes (`bees.js` / `daynight.js:400`). No per-frame allocation.

## 6. Drink cues and prompts (dist/game.js, 4 one-line edits, tag `// [juicer]`)
- vitals.js: `export const isDrink = kind => { const e = isEdible(kind) ? FOOD[kind] : null; return !!e && (!e.food && e.water !== 0 || !!e.returns || kind.endsWith('cup')); };`
  Have `eatLabel` (`:85`) use it. Add `isDrink` to the vitals import at `game.js:49`, keeping the same stamp.
- `game.js:699`: `EATING_TIP.label = isDrink(k) ? 'Drinking…' : 'Eating…';`. `game.js:936`: `gulp(!isDrink(e.item))`. Before this, smoothies said "Eating…" and played the munch sound.
- **Prompts through the current path.** Holding anything edible (a freshcup, berries) sets `eatTip`, and `game.js:716` then hides every content prompt, so the juicer's prompt would never show.
  Change `:716` to: `else if (eatTip && !(contextHtml = content?.prompt(frameAim) ?? null)?.startsWith('<kbd>E</kbd>')) { contextHtml = null; html = '<kbd>Click</kbd>' + esc(eatTip.label); }`.
  The next branch `:717` stays the same. When `contextHtml` is already set it is reused: change `:717` to `else if (contextHtml || (contextHtml = content?.prompt(frameAim) ?? null)) html = contextHtml;`.
  An E-actionable content prompt (a juicer, a bush, a hive) now wins over the click-to-eat hint. The hint still shows through `promptTip()` (`:703`). `#lrPrompt` gets it through the existing `raftPrompts` provider.
  E already goes to `content.interact` first (`game.js:1142`), so the E key needs no change.

## 7. Co-op, OLD_HOST and saves
- Host-authoritative: only the host runs `blend`, against the actor's bag. A guest's E sends `juicer.blend`, and the smoothie lands in the guest's bag on the host. Drinking uses the existing
  `eat` action (`game.js:1087-1091`): the host removes the smoothie, adds `FOOD[k].returns` (or refuses with "No room for the empty cup"), and emits `ate`, so the eater applies the bars. Both clients load the same FOOD literal.
- **OLD_HOST:** a new guest aboard an old host gets `ext.juicer === undefined` and sees `OLD_HOST`. It never sends `juicer.blend`, and every jar stays empty. An old host would drop the decor anyway.
- An old guest on a new host skips the unknown decor (cleanWorld) and the slice. `migrateSnapshot` drops unknown bag kinds. Mixed-version co-op is unsupported; say so in the PR.
- **Saves:** an old save has no `ext.juicer`, so `cleanJuicer(undefined)` gives defaults. Planters saved before watering existed are seeded ripe (`cleanWatering`), so each gives one free coconut, which is harmless.
  All new kinds, decor and the slice are additive. An old build loading a new save drops juicers, fruit and smoothies (accepted, as in earlier lanes). Decor cannot be removed, so a juicer is permanent.

## 8. Test edits
- `tests/watering.test.mjs:144`: `'+ 2 palm leaf · 1 coconut · 1 wood'`, and add `assert.equal(bag.count('coconut'), 1)`. `:148`: `'+ 2 palm leaf · 1 coconut'` plus a coconut count of 1.
  The full-bag case (`:150-153`) is unchanged.
- `tests/islands.test.mjs` after `:131`: `berries = count of lootFor('bush', s, 0, 0)` deepEqual `[['berries',2]]` over 400 seeds; `assert.ok(berries > 60 && berries < 140)`.
  Also assert that no bush result has both `berries` and a seed. The seed (`:128-129`) and flower (`:130-131`) asserts stay as they are.
- `tests/progression.test.mjs:181`: add `'berries'` to the start set (island bushes). After the bees line `:191`, add
  `if (have.has('palm') && !have.has('coconut')) { have.add('coconut'); changed = true; } // [juicer] planter harvest` and
  `if (have.has('juicer') && !have.has('berrycup')) { for (const k of ['berrycup','coconutcup','mixcup']) have.add(k); changed = true; } // [juicer] blend`.
  Also add `juicer` to the placeable loop at `:176`, and add `assert.ok(!STATION_IDS.includes('juicer'))`.
- `tests/craft-ux.test.mjs` after `:130`: `for (const k of ['berries','coconut','berrycup','coconutcup','mixcup']) assert.equal(CB.sourceOf(k, recipes).recipe, null, k)`, which also checks that each has an ITEM_SOURCE.
  The existing every-kind loop (`:129`) covers the rest, and `survival.test.mjs:555` covers ITEM_TEXT.
- `tests/vitals.test.mjs`: `isDrink` is true for `freshcup`, `berrycup`, `mixcup` and false for `cookedfish`, `honeyfish`, `berries`. `eatLabel('honeyfish') === 'Eat (+45 food)'`. Every `ITEMS` id with `category:'food'` is `isEdible` (this catches the honeyfish bug).
- New `tests/juicer.test.mjs` (node:test, `RAFT_DIST`, `bagWith` as in watering.test):
  1. `blend`: for each mix, 1 freshcup and the right fruit become 1 out cup. Missing cup → `nocup`, 1 fruit → `nofruit`, and the bag snapshot is unchanged each time. A full bag (freshcup ×2, berries ×3, every other slot scrap ×20) gives `full` and changes nothing.
  2. `pickMix` table: held berries with 1 berry and 1 coconut → `mixed`; 3 berries → `berry`; no cup → null; the default order is `mixed`, `berry`, `coconut`.
  3. `cleanJuicer`: junk → defaults; bad keys, unknown `m`, floats and non-juicer tiles are dropped.
  4. Module: `action` rejects a non-int tile, a tile without a juicer, an unknown or `__proto__` mix, and an out-of-reach guest, leaving the bag and `r` unchanged. A good blend bumps `j[key].n`.
     `load(undefined,'net')` gives the `OLD_HOST` prompt. `load(same,'net')` twice is a no-op. A first-seen entry does not spin, and a changed `n` does.
  5. Drinking: `consume(v,'mixcup')` returns `returns:'cup'`.
  6. Model with the vendored THREE: it has `crank`, `jar`, `fill` and `splash`. `paintJuicer(g,{m:'berry',n:1},.3)` shows the fill and the splash, and `paintJuicer(g,null,0)` hides them. It fits in 0.5 x 0.8 x 0.5.
  7. items: juicer is `decor`, placeable, and crafts from its cost. `new Bag` accepts a snapshot with all six new kinds.
- Run `npm test` and shoot.py. The `errors` list must be empty.

## 9. Files and hooks (tag every hook `// [juicer]`)
- New: `dist/juicer.js`, `dist/juicer-model.js`, `tests/juicer.test.mjs`.
- `dist/items.js:104` (fruit), `:183` (smoothies), `:204` (juicer), `:243` (radius). `dist/vitals.js:26-33` (5 rows plus honeyfish) and `:85` (`isDrink`).
- `dist/islands-layout.js:186`, `dist/islands.js:29`, `dist/watering.js:7,15`.
- `dist/content.js:43` `import { createJuicer } from './juicer.js?build=v3-survival-ae77fa84ac2b';` and append `createJuicer` to `FEATURES` at `:47`.
- `dist/game.js:49` (import `isDrink`), `:699`, `:716-717`, `:936`.
- `dist/craft-book.js:23` CATEGORY_OF (`juicer`, the three cups → `'survival'`). ITEM_TEXT after `:101`: six rows with `desc` and `use`, e.g. juicer use "Press E with a cup of fresh water and 2 fruit."
  ITEM_SOURCE after `:311`: berries `{tag:'island bushes', how:'Pick bushes on islands; some drop berries.'}`, coconut `{tag:'palm planter', how:'Harvest a ripe palm planter.'}`,
  each cup `{tag:'juicer', how:'Press E on a juicer with a cup of fresh water and 2 fruit.'}`. Also update the `leaf` row's palm text if needed. `dist/item-svg.js:10`: six icon bodies.
