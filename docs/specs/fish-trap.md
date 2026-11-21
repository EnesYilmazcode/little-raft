# Spec: Fish Trap

Source: docs/features/fish-trap-research.md. Cozy rules: the trap never breaks, fish never spoil or swim off, nothing is lost.
A woven basket hangs off an edge tile into the sea. Every few minutes it catches a fish from the existing species table, and seaweed bait makes it faster and luckier. E takes out everything inside.
Logic goes in the new content module `dist/fish-trap.js` (pure helpers plus `createFishTrap(ctx)`, name `'fishtrap'`). Models go in the new `dist/fish-trap-model.js`, which is given THREE and imports nothing.
Import new modules with `?build=v3-survival-ae77fa84ac2b`. fish-trap.js imports `rollCatch, speciesById, starsFor` from `./fish-species.js` (pure).
**Prompt path (checked):** `content.prompt(aim)` HTML is stored as `aimHtml` (`game.js:568`). `promptFromHtml` (`prompts.js:50`) draws it through the `game-aim` (key) and `game-aim-status` (muted) providers (`game.js:1795-1796`). Text without a `<kbd>` shows as a muted status line, and none of it reaches `#contextPrompt` or the feed. The trap only returns HTML from `prompt()` and needs no provider of its own.

## 1. Item and recipe (dist/items.js)
- Add after the candle row (`items.js:185`, tag `[fishtrap]`): `item('fishtrap', 'Fish Trap', 'decor', { placeable: true, iconTint: '#b98a4e', recipe: hand({ wood: 3, rope: 3, leaf: 2 }), unlock: discover('fish'), tip: 'A woven basket that hangs off the raft edge. Fish swim in while you relax.' })`.
- `BLOCK_RADII` (`items.js:221`): `fishtrap: 0.2` (only the post stands on the deck).
- craft-book.js: add `fishtrap: 'survival'` at `:23`, and in ITEM_TEXT after `:83` add `fishtrap: { desc: 'A woven fish basket on a little arm.', use: 'Place on an edge tile. Seaweed bait helps. Collect with E.' }`.
- item-svg.js: add an original `fishtrap` icon body after the `[bees]` block (`:215+`): a wicker basket with a crosshatch, a funnel mouth, a rope loop and a small fish tail at the mouth.
- Seaweed (`items.js:97`, barrels at `:301`) is the bait. No new material.

## 2. Edge rule
- `export function isEdgeTile(tiles, x, z)` returns true when `(x,z)` is a raft tile and at least one of its 4 neighbours is not a tile.
- `export function openSide(tiles, x, z, rot = 0)` returns `[dx,dz]` or null. Prefer the side the player's `rot` faces (`[round(sin rot), round(cos rot)]`) when it is open. Otherwise use the first open side in the order `[0,1],[1,0],[0,-1],[-1,0]`.
- New content hook `placeBlock(kind, x, z)` returns a reason string or null. The trap returns `'edge'` for `kind === 'fishtrap' && !isEdgeTile(ctx.world.tiles, x, z)`.
- build-rules.js `BLOCK_TEXT` (`:8-12`): add `edge: 'Fish traps hang on an edge tile, next to open water'`, so `placementFor` keeps the blocked ghost instead of returning null (`game.js:753`).
- If floor is later built on the open side, the trap stays where it is and idles (section 4). Prefer idle over delete.

## 3. Bait
- E on a trap with no fish and `b === 0` while the player has seaweed sends `fishtrap.bait`. The host removes 1 seaweed from the actor's bag and sets `b = BAIT_PER` (5 catches).
- While baited: a catch needs `BAIT_SEC` and rolls with `charge: .8`. Unbaited: `CATCH_SEC` and `charge: .3` (rare/legendary weights x1.15 vs x1.4, `fish-species.js:65`). Each baited catch uses one charge.

## 4. State `world.ext.fishtrap` and the tick
`{v:1, s, r, seed, t:{"x,z":{f:[{sp,cm,st}], w, b}}}`. `s` is the session id and `r` the revision (as bees). `seed` is the uint32 RNG state. Keys match `/^-?\d+,-?\d+$/`.
- `f` holds the waiting fish (0..`TRAP_MAX`=3). `sp` must pass `speciesById`. `cm` is clamped to the species' `minCm..maxCm` (1 decimal), and `st` is recomputed with `starsFor`. Bad fish are dropped.
- `w` is an int in 0..CATCH_SEC-1 (progress seconds). `b` is an int in 0..BAIT_PER. An all-empty entry is deleted. Entries without a `fishtrap` decor at that tile are pruned on load and on every tick. At most 400 entries.
- Constants: `CATCH_SEC = 240, BAIT_SEC = 150, TRAP_MAX = 3, BAIT_PER = 5, MAX_TICK = 60, REACH = 2.6, HOST_SLACK = 2, OVERHANG = 1.15`.
- **RNG:** `export function nextRand(st)` is mulberry32 on `st.seed`. It writes the advanced state back, so a save or restore continues the same sequence. It is stepped only on the host. `cleanTrap` keeps a valid uint32 seed, else uses `0x5eed7a9`. The module re-seeds a brand-new state (slice missing on `'save'`) with `(Math.random() * 2**32) >>> 0`. The helpers never call Math.random.
- **`tickTraps(st, tiles, decor, dt)`:** `n = clamp(floor(dt), 0, MAX_TICK)`. The outer loop runs n seconds. Inside, loop over the `fishtrap` decor **in decor order** (for determinism). Skip a trap that is not an edge tile. If `f.length >= TRAP_MAX`, set `w = 0` and skip. Else `w++`. When `w >= (b > 0 ? BAIT_SEC : CATCH_SEC)`: `w = 0`, `c = rollCatch(() => nextRand(st), {charge: b > 0 ? .8 : .3, night: false})`, push `{sp:c.species, cm:c.cm, st:c.stars}`, and `if (b > 0) b--`. Bump `st.r` on any change. Returns `{caught:[keys], full:[keys that just reached 3]}`.
- Timing: unbaited, one fish per 4 min (full after 12 min). Baited, one per 2.5 min. Bait runs out after 5 fish.
- `trapInfo(st, tiles, decor, x, z)` returns `{n, w, b, need, edge}`, or null when there is no trap at that tile.

## 5. Collect (all or nothing)
`collect(st, decor, key, bag)` returns `{ok:true, fish:[...], n, text}` or `{ok:false, reason:'notarget'|'empty'|'full', text}`.
- Make a scratch bag `s = new bag.constructor(bag.snapshot())`. Only when `s.add('fish', n) === 0` copy `s.slots` into `bag.slots`. Then return the fish list and set `f = []`. Keep `w` and `b`.
- If they do not all fit, nothing changes and every fish stays in the trap. Texts: ok `"+ N fish from the trap"`, full `"Your bag is full"`, empty `"No fish in the trap yet"`, notarget `"Nothing to collect"`.
- The module also does `ctx.world.fish = (ctx.world.fish | 0) + n` (the "N fish caught" HUD, synced in hostState `game.js:1236`). The trap does not call `award`, because it is not in ctx. Accepted.

## 6. Journal hook (host and guests)
- The host emits to the actor: `{kind:'loot', text, loot:{fish:n}, trapFish:[{species, cm, stars}...]}` (at most 3). `emit(e, actor)` (`game.js:775-778`) runs `effect` locally for the host or solo player and sends `{type:'effect'}` to a guest, so the journal entry lands in the collector's own journal.
- game.js `effect()`, a new line before `:782` (prog): `if (Array.isArray(e.trapFish)) fc?.recordTrapCatch?.(e.trapFish); // [fishtrap]`. The loot row still shows through the `:783` branch.
- fishing-cooking.js api (`:456-462`): add `recordTrapCatch(list)`. For each of the first 3 items it runs `journal.recordCatch({species, cm, stars})` (that does the cleaning), toasts `New species! X added to your journal` or a record, then sets `dirty = true` (so the 3 s save runs). If any catch has `basketed === false`, toast `Basket full. Cook a few on a grill.` once.

## 7. Model (dist/fish-trap-model.js) and visuals
- `createFishTrap(T)`: Group `craft_fishtrap` with its origin at the floor top (raft y .22). The water out the open side is local **+z**. Parts:
  - static, merged into one vertex-coloured mesh: a post (box .08 x .5 x .08, #8a6640) at z .6, and an arm (box .06 x .06 x .75, #9c7649) from z .55 to 1.3 at y .48.
  - `hang`, a Group pivoting at the arm tip (0, .48, OVERHANG + .1). Inside it: a rope (cylinder r .012, h .6, #d8c39a) down to the basket. The basket is centred at local y about -.62 from the pivot, so the rim sits just above the waterline and the lower half is submerged. Check this in shoot.py.
  - The basket weave: 4 stacked open bands (CylinderGeometry, tapering r .24 to .17, 10 radial segments, alternating #b98a4e / #93683a, flat shading), 8 thin vertical ribs (#7a5530), a funnel cone mouth on top (r .2 to .07, open-ended, double-sided) and a rim torus.
  - `fish`, a Group inside the basket, hidden by default: a dark silhouette (#24343d, opacity .85) made of a flattened sphere (scale .17 x .06 x .05), a tail cone and a tiny fin, visible through the weave gaps.
- `paintTrap(g, full, elapsed, phase)`: bob `hang.position.y = .48 + .025*sin(elapsed*1.4 + phase)`, `hang.rotation.x = .05*sin(elapsed*1.1 + phase)`, `hang.rotation.z = .04*sin(elapsed*.9 + phase*2)`. Set `fish.visible = full` (early return on `userData.sig`). When full, wiggle `fish.rotation.y = .25*sin(elapsed*5 + phase)`. No allocation.
- Facing: `decorModel(type)` sees only the type. So fish-trap.js scans `ctx.raft.children` for `craft_fishtrap` (the bees `scanHives` pattern, `bees.js:138-149`, rescanned when the children length or `children[0]` changes; rebuildRaft also runs after floor changes). On a rescan it sets `g.rotation.y = atan2(dx, dz)` from `openSide(tiles, x, z, d.rot)`. If no side is open it keeps `d.rot`.
- Per frame: paint only traps within 30 m of the camera. `phase = (x*7 + z*13) % 6.28`. Old host: all traps look empty. `full = n >= TRAP_MAX` from the synced state on guests.
- `decorModel('fishtrap')` returns `createFishTrap(T)`, which the ghost (`game.js:395`) and rebuildRaft (`game.js:504`) already reach.

## 8. Target and prompts
- `target(aim)`: copy bees `target` (`bees.js:118-136`), but aim at the overhang point `(x*2 + dx*OVERHANG, raft.y + .05, z*2 + dz*OVERHANG)` (open side), or the tile centre when no side is open. Reach is measured from the player to that point. Returns `{x, z, key}`.
- `prompt(aim)` (static strings, no user text):
  - old host: `OLD_HOST = 'Your friend’s raft doesn’t have fish traps yet'`
  - not on an edge: `Fish trap: it needs open water beside it`
  - `n > 0`: `<kbd>E</kbd>Collect fish (n)`, plus ` · full` at 3
  - `n === 0, b === 0`, with seaweed in `ctx.localBag()`: `<kbd>E</kbd>Bait with seaweed`
  - `n === 0, b === 0`, no seaweed: `Fish trap: waiting… N% · seaweed makes good bait`
  - `n === 0, b > 0`: `Fish trap (baited): waiting… N%`, where `N = floor(w / need * 100)`
- `interact(aim)`: no target returns false. Old host or not an edge: `ctx.notice(<that line>, 2400)`, true. `n > 0`: `ctx.action({kind:'fishtrap.collect', x, z})`. Bait case: `fishtrap.bait`. Else `ctx.notice('No fish in the trap yet')`. Every case except no target returns true.

## 9. Host actions, co-op, OLD_HOST
- `action(a, actor, bag)` claims kinds starting with `'fishtrap.'`. `x` and `z` must be ints with a trap there. The pose is `actor === 'guest' ? ctx.other : ctx.physics`, and the action is rejected if the pose is more than `REACH + HOST_SLACK` from the overhang point.
  - `collect`: emit the section 6 effect on ok. Otherwise emit `{kind: reason === 'full' ? 'full' : 'notice', text}`. `st.r++` on ok.
  - `bait`: `b > 0` gives notice `The trap is already baited`. `!bag.remove('seaweed', 1)` gives notice `You need seaweed for bait`. Else `b = BAIT_PER`, `st.r++`, emit `{kind:'notice', text:'Trap baited · 5 catches', sound:'collect'}`.
- `update(dt)`: visuals on every client. The host tick runs only when `ctx.running && ctx.role !== 'guest'`, on a 1 Hz clock (bees pattern). Any `full` emits `{kind:'notice', text:'A fish trap is full'}` to `'all'`.
- `load`/`serialize`: same as bees (`bees.js:167-185`). `'net'` skips unchanged `r`/`s`. `hostHasTrap = data !== undefined`. Serialize is cached by `r`. A guest never ticks and never rolls.
- **OLD_HOST:** a new guest on an old host gets `ext.fishtrap === undefined` and sees the OLD_HOST prompt and empty baskets. It never sends `fishtrap.*`. An old host would drop the decor anyway. Mixed-version co-op is unsupported (say so in the PR).

## 10. Save compatibility
An old save has no slice, so `cleanTrap(undefined)` gives defaults and a fresh seed. Everything is additive. An old build loading a new save drops the trap decor and the unknown `fishtrap` bag kind (same accepted risk as bees). The slice is tiny (3 fish x 400 entries is far below `EXT_MAX` 200k). The journal is unchanged in shape.

## 11. Files and hooks (tag `[fishtrap]`)
- New: `dist/fish-trap.js`, `dist/fish-trap-model.js`, `tests/fish-trap.test.mjs`.
- `dist/content.js`: import beside `:29` and append `createFishTrap` to FEATURES at `:31`. Add a registry hook `placeBlock: (kind, x, z) => first('placeBlock', kind, x, z),` after `:59` (`craftLocked`), and document it in the header list.
- `dist/build-rules.js:8-12`: add `BLOCK_TEXT.edge`.
- `dist/game.js` (4 one-line hooks):
  - `:751` `why = decorBlock(world.tiles, world.decor, x, z) || content?.placeBlock(kind, x, z) || null;`
  - `:758` add `&& !content?.placeBlock(kind, x, z)` to the decor candidate filter
  - `:886` after the grill check: `const eb = content?.placeBlock(a.recipe, a.x, a.z); if (eb) { emit({kind:'notice', text:BLOCK_TEXT[eb] ?? 'Can’t place that here'}, actor); return; }`
  - `:782` the trapFish journal line (section 6)
- `dist/fishing-cooking.js:456-462`: `recordTrapCatch`. `dist/items.js:185,221`, `dist/craft-book.js:23,83`, `dist/item-svg.js:215+`.

## 12. tests/fish-trap.test.mjs (node:test, `RAFT_DIST` base, `bagWith`/`fullBag` as bees.test.mjs)
1. `cleanTrap`: junk gives defaults. Bad keys, bad species, out-of-range cm, `f.length > 3`, floats and negatives are dropped or clamped, and stars are recomputed. Tiles without a `fishtrap` decor are pruned. An inner (non-edge) trap is kept.
2. `isEdgeTile` and `openSide`: a 3x3 raft has a centre that is not an edge, corners and sides that are. `openSide` honours `rot` when that side is open and falls back in the fixed order.
3. Tick: unbaited, the first fish comes at 240 s and not at 239. Baited at 150 s, `b` goes 5 to 4. After 5 baited catches the next one needs 240. The trap stops at 3 fish with `w = 0`, and `full` lists the key once. A non-edge trap stays unchanged after 1000 s. `dt` .9 counts as 0, and 1e6 is clamped to 60.
4. Determinism: same seed and the same tick sequence give `deepEqual` states. A serialize, clean and continue run equals an uninterrupted run. Every caught `sp` is in SPECIES.
5. Collect: 2 fish give +2 `fish` in the bag and `f = []` with `w`/`b` kept. A full bag gives `full`, and the bag snapshot and `f` are unchanged. Empty gives `empty`, and no trap gives `notarget`.
6. Module (stub ctx as bees): collect emits `loot` with `trapFish` to the actor and bumps `world.fish`. `bait` needs seaweed and removes exactly 1. Out-of-reach and non-int actions change nothing. `placeBlock('fishtrap')` returns `'edge'` on the centre and null on the rim, and null for other kinds. `load(same,'net')` twice is a no-op. `load(undefined,'net')` gives the OLD_HOST prompt and `interact` sends no action. Prompt strings: `promptFromHtml` gives key `E` for collect/bait and `muted` for the waiting line.
7. Model with the vendored THREE: it has `hang` and `fish`. `paintTrap(g, true, …)` shows the fish. The basket bottom is below local y -.3 and its centre has z > 1. The bounds fit 0.7 x 1.2 x 1.6.
8. Items: `fishtrap` crafts from `{wood:3, rope:3, leaf:2}` and a `Bag` accepts it. Add a test for `recordTrapCatch` on a fishing-cooking stub only if it is cheap. Otherwise check the `effect` line by hand in QA.
Run `npm test` and shoot.py (place a trap on the rim, fast-forward, collect), and the `errors` list must be empty. QA debug on `raftDebug.content.fishtrap`: `state()`, `place(x, z)`, `fastForward(sec)`, `fill(key)`.

## Build notes
- Built as specced: `dist/fish-trap.js` (pure helpers + `createFishTrap(ctx)`, name `fishtrap`), `dist/fish-trap-model.js` (`createFishTrap(T)`, `paintTrap`, `OVERHANG`), `tests/fish-trap.test.mjs` (10 tests, all of section 12 including a cheap items test; `recordTrapCatch` checked in the browser instead).
- Hooks, all tagged `[fishtrap]`: content.js import + `FEATURES.push(createFishTrap)` (a separate line, so the shared FEATURES line stays untouched) + `placeBlock` registry hook and header doc; build-rules.js `BLOCK_TEXT.edge`; game.js placementFor / placementCandidates / applyAction build branch / `effect()` trapFish line; fishing-cooking.js `recordTrapCatch`; items.js item + `BLOCK_RADII`; craft-book.js tab + text; item-svg.js icon (after `honeyfish`, end of the bees block).
- Basket height: the weave hangs a little lower than "about -.62": the basket centre is -.70 below the pivot (local y about -.22 under the deck top, which is roughly the waterline), the rim sits at local -.02 and the bottom at -.41. In the side-on water shot the rim is just above the waterline and the lower half is under water.
- `cleanTrap` also forces `w = 0` on a full (3 fish) entry, matching the tick rule. `debug.place(x, z, rot)` takes an optional rot; `debug.traps()` lists `trapInfo` per trap.
- `interact` on a trap with no decor entry notices "Nothing to collect"; baited-and-empty notices "No fish in the trap yet".
- `recordTrapCatch` keeps the existing `onCatch` toast style; the record toast reads the new best from `journal.entry` after recording.
- Reach: from the raft centre the overhang point of an edge tile is usually over 2.6 m away, so the player walks to the edge tile first (intended).
- Known overlap: on the default raft, the sailing anchor post stands near the -x edge, so a trap on that side sits beside it. They do not collide.
- QA: `npm test` passes (the only failure seen was the `art.test.mjs` atlas timing check under parallel load, which passes alone). `shoot.py` reports `errors: []`. The close-up script `scratchpad/r2/trap/trap_shot.py` places and fills a trap, walks to it, and reads `#lrPrompt` "E Collect fish (3) · full". E gives +3 fish and the journal goes to 3/8 with "New species!" toasts. The prompt then reads "E Bait with seaweed", E uses 1 seaweed, and after a 75 s fast-forward it reads "Fish trap (baited): waiting… 50%". The script also takes a side shot from the water.
- Mixed-version co-op is unsupported: a new guest on an old host sees the OLD_HOST prompt and never sends `fishtrap.*`.
