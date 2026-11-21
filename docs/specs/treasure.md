# Spec: Sandy Secrets (Seashell Finder, Little Spade, buried bundles)
Research: docs/features/treasure-research.md. Anchors checked @ `97cdd29`. coop-avatar.js is also edited by customise.md: merge, do not overwrite.
A held **Seashell Finder** beeps faster as you get near a buried bundle on the visiting island. A held
**Little Spade** digs it up with E. Every island hides 1 or 2 bundles. Each one is dug once, and they all
go away when the island leaves. Host-authoritative, saved in `world.ext.treasure`, and no game.js logic
beyond three one-line hooks.

## Files
| File | What |
|---|---|
| `dist/treasure-rules.js` (new, pure, no THREE/DOM) | `TREASURE` constants, `spotsFor`, `lootForSpot`, `beepInterval`, `warmth`, `DEFAULTS`, `clean`, `nearestSpot`, `applyDig`, `applyRepair` |
| `dist/treasure.js` (new) | `createTreasure(ctx)`, content module `name:'treasure'`: state, mounds, HUD, beeps, prompt provider, actions, debug |
| `dist/treasure-models.js` (new) | `createSpade(T)`, `createFinder(T)` (hammer.js style), `createMoundKit(T)` (cached geos/mats) |
| `dist/islands.js` | export `islandNow()` (read-only accessor, below). No change to `layoutFor` or its RNG draws |
| `dist/content.js` | import `createTreasure` with the same `?build=` token as the others; append it to `FEATURES` **after** `createIslands` |
| `dist/items.js` | items `finder` and `spade`, `REPAIRS.spade` |
| `dist/item-svg.js` | `ITEM_ICONS.finder`, `ITEM_ICONS.spade` (48x48, house palette) |
| `dist/craft-book.js` | `CATEGORY_OF` finder/spade `'tools'`, plus `ITEM_TEXT` desc/use for both (tests/survival.test.mjs:536 needs these for every kind) |
| `dist/held-items.js`, `dist/coop-avatar.js` | held models for both tools |
| `dist/audio.js` | recipes `detect` and `chime` |
| `dist/game.js` | 3 marked `// [treasure-hook]` lines (ctx.play, spade repair, nothing else) |
| `tests/treasure.test.mjs` (new), `tests/progression.test.mjs:174` | tests; TOOL_IDS list gains `'spade'` |

## islands.js accessor
Module scope: `let live = null; export function islandNow() { return live ? live() : null; }`.
In `createIslands` build one cached object `now = {seed, cx, cz, gy, R, rot, phase, onSand, hover, groundAt}`
and set `live = mine` where `mine()` returns `null` when `!shown || !st.isl || !layout`. Otherwise it
refreshes the fields from `st.isl.seed`, `cx/cz/gy` (as set by `place()`, so the sink is included), `layout.R/rot`, `path.phase`,
`sandState.onSand`, `hoverNode` and the existing `groundAt`, then returns `now`. `dispose` sets `if (live === mine) live = null`.
Callers must not mutate or keep the object. **Import pitfall:** treasure.js must import
`'./islands.js?build=v3-survival-ae77fa84ac2b'` (the exact specifier content.js uses), or the browser loads a
second module instance and `islandNow()` stays null. A test asserts this string (see Tests). maptable.md's `peek('islands')`
returns serialized state only, but treasure needs the live `gy`, `groundAt` and `onSand`, so it uses this accessor. Both can coexist.

## Items (dist/items.js, tools section after binoculars)
```js
item('finder', 'Seashell Finder', 'tool', { iconTint: '#c99560', stack: 1,
  recipe: hand({ scrap: 4, wood: 2, rope: 2 }), unlock: discover('sand', 'scrap'),
  tip: 'A driftwood wand with a brass coil. It ticks faster near buried bundles. Never wears out.' }),
item('spade', 'Little Spade', 'tool', { iconTint: '#bb8650', tool: true, durability: 60,
  recipe: hand({ wood: 3, scrap: 2 }), unlock: discover('sand'),
  tip: 'Press E on island sand to dig. Finds bundles, or at least a handful of sand. R fixes it.' }),
```
`REPAIRS.spade = { wood: 2, scrap: 1 }`. Both are reachable early: sand is in `BARREL_LOOT`. The finder is
`tool:false` like the binoculars (it never wears, so it has no durability and stays out of TOOL_IDS). The spade is in TOOL_IDS,
so `inventory-state.js` TOOL_KINDS gives it durability automatically. `wearPerUse('spade')` = 100/60.

## Pure rules (treasure-rules.js)
`TREASURE = {K: 0x5EA5E11, LOOT_K: 0x7EA5B0, MAX_SPOTS: 2, U_MIN: 0.2, U_MAX: 0.65, MIN_Y: 0.3, NODE_GAP: 1.2,
SPOT_GAP: 2.5, DIG_REACH: 2.0, RANGE: 9, LOCK: 1.0, COOLDOWN: 0.6, IV_MIN: 0.12, IV_MAX: 1.2}`.
- `spotsFor(seed)`: frozen, cached like `layoutFor` (Map, cleared past 64). `r = rng((seed ^ K) >>> 0)`, `lay = layoutFor(seed)`.
  `want = 1 + (r() < 0.5 ? 1 : 0)`. For each spot, up to 60 tries: `a = r()*2π`, `u = U_MIN + (U_MAX-U_MIN)*sqrt(r())`,
  `rad = u*R*shape(a-rot)`, `x = cos a*rad`, `z = sin a*rad`, `y = groundHeight(rad, R, a-rot)`. Accept when
  `y >= MIN_Y` (dry), every node is at least NODE_GAP away and other spots are at least SPOT_GAP away. Items are `{i, x, z, y, kind}` in
  island-local metres. `kind = r() < 0.15 ? 'keepsake' : 'bundle'`. The loop always consumes its draws, so the result is deterministic.
- `lootForSpot(seed, i, kind)`: `r = rng((seed ^ LOOT_K ^ Math.imul(i + 1, 0x9E3779B1)) >>> 0)`. It makes two picks
  (same kinds add up) from `[rope 2 w3, nail 3 w3, glass 1 w2, copperore 1-2 w2, metalore 1-2 w2, clay 2 w2, seaweed 2 w2]`.
  A `keepsake` also adds 1 `copperingot` or 1 `metalingot` (50/50). All loot comes from existing items and returns `[[kind, n], ...]`.
  This is pacing-safe: about 4-8 items per island, roughly one barrel's worth. Bottle/notes hook: **not in this round** (granting a note
  needs a game.js hook into `world.notes`). Note it in the module header as a follow-up.
- `beepInterval(d)`: `Infinity` if `!(d < RANGE)`; `0` (lock) if `d <= LOCK`; otherwise
  `IV_MIN + (IV_MAX-IV_MIN) * ((d-LOCK)/(RANGE-LOCK))**1.4`. It rises strictly with d. `closeness(d) = 1 - clamp01((d-LOCK)/(RANGE-LOCK))`.
- `warmth(d)`: `>=RANGE` 'Quiet sand…', `>6` 'Warm…', `>3` 'Warmer…', `>LOCK` 'Very warm!', else 'Right here! Dig with the spade'.
  `null` d (no undug spot or no island) gives 'Nothing buried nearby'.
- `DEFAULTS = () => ({v:1, seed:null, dug:[]})`. `clean(data)`: never throws. `v!==1` or junk gives defaults. `seed` is a u32 or null.
  `dug` is an array of length ≤ MAX_SPOTS with each entry `1` if truthy-1, else 0. A null seed forces `dug:[]`.
- `nearestSpot(spots, dug, lx, lz, reach)`: the index of the closest undug spot within reach in island-local coords, or -1. No allocation.
- `applyDig(st, a, actor, pos, bag)`: `st = {seed, cx, cz, clock, cool:{host,guest}, dug, spots, groundAt}`.
  The checks run in order and each returns `{ok:false, reason}`: `kind` (≠'treasure.dig'), `none` (no island),
  `stale` (`a.seed !== st.seed`), `spot` (`a.spot` not an int in [-1, spots.length)), `dug`, `reach` (pos not finite, not on
  sand `!(st.groundAt(pos.x,pos.z) === …finite)`, or a spot farther than `DIG_REACH (+ISLAND.GUEST_SLACK for the guest)`),
  `cooldown`, `bag`, `tool` (the selected slot `bag.slots[bag.selectedIndex]` is not a spade), `worn` (durability ≤ 0), `full`.
  Loot is `lootForSpot` for a spot, or `[['sand',1]]` for `spot:-1`. Use the scratch-bag all-or-nothing add from
  `islands-layout.js:213`. On success it wears the selected slot by `wearPerUse('spade')` (min 0), sets `dug[spot]=1`, sets the cooldown and
  returns `{ok:true, loot, spot, kind}`.
- `applyRepair(bag)`: if the selected slot is a spade below 100 and the bag holds `repairCost('spade')`, it spends that, sets the durability to 100 and returns `{ok}`.
  Otherwise it returns a reason (`tool`, `fine`, `cost`). The spend is also all-or-nothing on a scratch bag.

## Module (treasure.js)
State `st = DEFAULTS()`, cached `out = {v:1, seed:null, dug:[]}` for `serialize()` (copy the values into it, as islands does).
- `update(dt)`: `now = islandNow()`. **Host** (`ctx.role !== 'guest'`): `seed = now ? now.seed : null`. If
  `seed !== st.seed`, set `st.seed = seed` and `st.dug = seed == null ? [] : spotsFor(seed).map(() => 0)`, then `syncMounds()`.
  **Both**: set `group.visible = !!now`. If visible, `group.position.set(now.cx, now.gy, now.cz)`. Then run the pop animation, beep and HUD.
- `load(data, from)`: `c = clean(data)`. Only when `c.seed !== st.seed` or a `dug` entry differs do we copy it in and call
  `syncMounds(from === 'net')`, which pops a chest only for a 0→1 change seen live. Saves and restores never pop. With `load(undefined)`
  the host's next update re-seeds from the live island, which is how old saves default.
- `action(a, actor, bag)`: handles `kind.startsWith('treasure.')`. Guests return true. `pos = actor==='guest' ? ctx.other : ctx.physics`.
  `treasure.dig` builds `st` from `islandNow()` (cx/cz/groundAt) and `spotsFor`, then calls `applyDig`. On ok it runs `syncMounds(true)` and
  `ctx.emit({kind:'loot', text, loot:{k:n}, sound:'chime'}, actor)`, with text 'You dug up a little bundle! +…' or
  '+1 Sand' for an empty dig. Replies by reason: `stale` 'The island drifted off', `reach` 'Get a little closer', `worn`
  'Your spade is worn out. R fixes it (2 Plank, 1 Scrap)', `full` → `{kind:'full', text:'Your bag is full'}`. Cooldown stays quiet.
  `treasure.repair` calls `applyRepair` and emits `{kind:'build', text:'Spade repaired!', sound:'repair'}` or a notice.
- `interact(aim)`: true (consumes E) only when the held kind is `'spade'`, `now && now.onSand && now.hover < 0` and the local
  player is not swimming. Local cooldown `COOLDOWN`. Sends
  `ctx.action({kind:'treasure.dig', seed:now.seed, spot:nearestSpot(spots, st.dug, px-cx, pz-cz, DIG_REACH)})` and starts a local
  0.4 s sand puff (the reusable `puff` mesh at the feet, scale up and fade). Islands' own `interact` runs first (FEATURES order), so
  aiming at a palm or rock still gathers.
- `prompt()`: returns `<kbd>E</kbd> Dig` under the same conditions (for #contextPrompt parity, which is hidden).
- **raftPrompts provider** (registered in the factory when `window.raftPrompts` exists, unregistered in `dispose`):
  `provide({id:'treasure', priority:1, prompt(c)})`. It returns null when `!s?.running || s.pickup || (s.role==='guest' && !s.networkReady) ||
  s.swimming || s.heldKind !== 'spade'` or there is no island / not on sand / a node is hovered. If worn: `{label:'Spade worn out · R fixes it', muted:true}`.
  Near an undug spot: `{key:'E', label:'Dig here!'}`. Otherwise: `{key:'E', label:'Dig in the sand'}`.
- **Beeps** (local only, never emitted): while the held kind is `'finder'` and an island is shown, `d` is the world distance from `ctx.physics` to the nearest
  undug spot. `iv = beepInterval(d)`. Accumulator `acc += dt`: when `iv > 0 && acc >= iv`, set `acc = 0`, call `ctx.play?.('detect', closeness(d))`
  and `pulse = 1`. When `iv === 0`, play `chime` every 1.2 s. When the finder is not held, set `acc = 0`. No timers.
- **HUD** `#treasureHud`, created lazily with the same cssText as `#binocularsHud` (progression-hooks.js:246) but at `top:12%` and `display:flex;gap:8px;align-items:center`.
  It holds an inline 22px SVG ring (track circle plus an arc `stroke-dasharray` = closeness × circumference, colour `#ffbd66`), a centre dot
  whose `transform: scale(1 + .5*pulse)` decays (`pulse *= 0.85^(dt*60)`), and the `warmth(d)` text. Write the text, dasharray and transform
  only when their rounded values change. Hide it when the finder is not held or the game is not running.
- **Mounds** (`createMoundKit`, ≤ 7 meshes total): per spot (2 max) a `hole` (dark sand `CircleGeometry` r .32, rotated flat, 2 cm up)
  and a `mound` (half `SphereGeometry` scaled .45×.14×.45, sand colour `#e9c98a`, offset .5 m toward the island centre). Both are hidden
  until dug. One shared `chest` (a box .28×.18×.2 plus a lid .3×.05×.22, wood `#bb8650`, a brass band via a separate tiny box is optional)
  rises 0.35 m over 0.5 s at the popped spot, holds 1 s, then shrinks away. There is also one `puff`. Everything sits in its own `group` in `ctx.scene`
  at the island-local `(x, y, z)` of each spot. `y` comes from `spotsFor`, so it sinks with `gy`. `dispose` removes the group and disposes the kit.
- `debug` (`raftDebug.content.treasure`): `spots()` (world coords plus dug), `kit()` (host: adds a finder and a spade to the local bag
  and selects the spade), `select(kind)`, `standAt(i, off=1.2)` (calls `raftDebug.content.islands.teleportAshore` with spot local x+off, z),
  `dig(i)` (sends the action), `state()` ({seed, dug, d, iv, hud text}).

## game.js hooks (`// [treasure-hook]`)
1. contentCtx (game.js:368): add `play: (ev, s) => play(ev, s),` (local sound, no network).
2. `repair()` (game.js:930): `const sel = bag.slots[bag.selectedIndex]; if (sel?.kind === 'spade') { action({kind:'treasure.repair'}); return; }`
   before the hook call. The host 'repair' branch is untouched, and `treasure.repair` reaches `content.action` at :910.
3. None for E: `content.interact` (:940) already runs after the pickup check, so a pickup wins.

## Audio (audio.js)
Add `'detect', 'chime'` to `EVENTS` and `MIN_GAP` (`detect: 0.05, chime: 0.5`). Recipes:
`detect(v,t,s){ const f = 700 + 500*s; tone(v,t,'sine',f,(.05+.04*s),.002,.05); tone(v,t,'triangle',f*2,.015*s,.001,.03); }`
`chime(v,t,s){ tone(v,t,'sine',880,.09*s,.002,.4); tone(v,t+.07,'sine',1318.5,.06*s,.002,.35); tone(v,t+.14,'sine',1760,.04*s,.002,.3); }`
tests/survival.test.mjs:1050-1066 plays every EVENTS entry against a mock, so both recipes must use only `tone`/`burst`.

## Held models
`treasure-models.js`, deterministic, handle along +Y with the butt at -Y, re-centred on its bounds, `userData.grip` Vector3 and `userData.size`.
Spade: shaft cylinder, D-grip torus, blade (flattened box with a bevel), collar, rope wrap, 5 meshes, ~0.7 m.
Finder: wand cylinder, brass coil torus at +Y (rotated flat), bead sphere (emissive `#ffbd66`, intensity follows closeness via
`userData.bead`, optional), grip wrap, 4 meshes, ~0.6 m. `held-items.js`: import both and add `HOLD.spade = {hand:'right', pose:'grip', rx:.2, rz:.35}`,
`HOLD.finder = {hand:'right', pose:'grip', rx:-.5, rz:.25}`, plus a branch next to hammer that scales by 0.55 (the size must stay < 1 m,
tests/viewmodel.test.mjs:15). `coop-avatar.js` `BUILD.spade` (shaft, blade, grip, 3 parts) and `BUILD.finder` (wand, coil torus, 2 parts)
using `part/Cyl/Box`, returning the tip.

## Tests (tests/treasure.test.mjs, imports via `base` like islands.test.mjs)
1. `spotsFor`: the same seed gives a deep-equal result and the same frozen ref. Across 200 seeds there are 1-2 spots, `u ≤ U_MAX`, `y ≥ MIN_Y`, ≥ NODE_GAP from each
   `layoutFor(seed).nodes`, ≥ SPOT_GAP apart, and `groundHeight` at the spot equals `y`. `layoutFor` output is unchanged (it does not call `spotsFor`).
2. `beepInterval`: Infinity at RANGE+, 0 at ≤ LOCK, strictly increasing over 1.1…8.9, within [IV_MIN, IV_MAX]. `warmth` bands. `closeness` in [0,1].
3. `applyDig`: ok path (loot in the bag, dug flag set, spade worn by 100/60), and each reason: stale seed, bad spot, already dug,
   out of reach (host 2.0 vs guest 3.0), off sand (groundAt NaN), cooldown, no spade selected, worn 0%, full bag (bag unchanged).
   An empty dig (`spot:-1`) gives 1 sand. `applyRepair` spends 2 wood + 1 scrap and refuses when fine or short.
4. `clean`: undefined, junk, a wrong v, a non-u32 seed, oversize dug and a null seed with dug all give valid output. The output never aliases the input.
5. Items: `finder` is stack 1, `tool:false`, no durability, `wearPerUse` 0. `spade` is a tool with durability 60 and `repairCost` set. Both
   have `ITEM_ICONS` entries and `ITEM_TEXT` desc/use. `lootForSpot` kinds are all `ITEMS` ids and it is deterministic.
6. Wiring: `readFileSync('dist/treasure.js')` includes `"./islands.js?build="` with the same token as content.js, and content.js
   lists `createTreasure` after `createIslands`. Integration with stub ctx (as islands.test.mjs): `spawnNear(1234)` then `islandNow().seed === 1234`, and
   treasure's host `update` sets `st.seed` and `dug`. `debug.clear()` resets to `{seed:null, dug:[]}`.

## QA screenshots (copy scratchpad shoot.py, add steps)
`I = raftDebug.content.islands, R = raftDebug.content.treasure`. `I.spawnNear(1234, 30)` (docked) → `R.kit()` → `R.standAt(0, 2.5)`,
then turn toward the spot with `raftDebug.aim(-0.5, yaw)` (yaw from the spot vector) → `R.select('finder')`, wait 1 s. Shots:
(1) `treasure-finder.png`: finder in hand, HUD 'Warmer…' ring. (2) `standAt(0, 0.5)`: 'Right here!' full ring. (3) `R.select('spade')`
and the prompt 'Dig here!' visible. (4) `R.dig(0)`, wait 0.3 s: chest pop and mound. (5) after 2 s: mound and hole left, loot rows in the
feed. Check `R.state().dug[0] === 1`, the bag gained the loot, and the spade durability is < 100. Also check `renderInfo` mesh count +≤ 9
and no console errors. Co-op: run `tests/coop-e2e.mjs` style and check the guest's `dug` matches within 0.5 s.

## Build notes
Deviations from the spec above, as built:
- `clean(data)` sizes `dug` to `spotsFor(seed).length` (always ≤ MAX_SPOTS), not just "≤ MAX_SPOTS", so a slice never has flags for
  spots that do not exist. Entries are 1 only for `1` or `true`.
- The finder distance is horizontal (feet to the buried spot), so LOCK = 1 m is reachable while standing.
- A successful bundle dig emits two effects: a `notice` "You dug up a little bundle!" (sound `chime`) and the `loot` rows
  (sound `collect`). game.js `effect()` shows only feed rows when `loot` is set, so the text alone would be invisible.
  An empty dig emits only the loot row (`+1 Sand`, sound `chime`). Extra replies: `dug` → "Someone already dug here", `none` → "The island drifted off".
- The raftPrompts provider registers lazily from `update()` too, in case `window.raftPrompts` appears after the content registry starts.
- The HUD hides via `style.display`, not `hidden`: the inline `display:flex` would override the `hidden` attribute.
- No brass band on the chest (7 meshes: 2 holes, 2 mounds, chest box + lid, puff). The mound is a low-poly, flat-shaded half sphere
  (scale .38×.16×.38, `#dcb877`) so it reads as a heap; the spec's `.45×.14×.45` smooth one looked like a flat disc.
- `userData.bead` exists on the finder model, but nothing drives its glow yet: treasure.js cannot reach the hands' model.
- `HOLD.finder.rx` is -1.1 (not -0.5), with the coil tilted in the model, so it leans forward over the sand.
- `coop.js` `HELD` gains `'spade', 'finder'` (appended, so older peers read them as null) so the partner sees them in hand.
- Debug adds `chestUp()`; the islands `now` object also carries `phase`.
