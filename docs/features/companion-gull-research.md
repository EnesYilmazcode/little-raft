# Companion gull: research note

Feature: place a **Perch** decor, offer treats with E, and after a few treats a visiting gull moves in. It rests on the
perch, flies short loops, sometimes follows a player, brings small finds (wood/plastic/rope) to a tray on the perch, and
can be named. No damage. Line numbers are for the tree on branch `claude/loop-features-202611210831`.

## 1. Existing seagulls (`dist/wildlife.js`, `dist/wildlife-models.js`)
- Scenery only, nothing is saved. Every pose is a closed-form plan of a shared clock `t` (`wildlife.js:3`). `GULL_MAX = 6`,
  `GULL_SLOT = 40` s visit slots (`:8-9`). Sky circle = `gullSky()` (`:95-103`), visit schedule = `gullVisit()` (`:107`), cached per (seed, slot, n).
- Perches: `perchesFrom(tiles, decor)` (`:69-86`): free tiles plus `PERCH_TOP = {sail, crate, bench}` (`:17`). A tile holding any
  other decor is **not** a perch, so a new `perch` decor is automatically never used by wild gulls (good: no contention).
- `gullPlan()` (`:152-198`) gives state circle/descend/perched/leave, yaw/pitch/roll, `flap` and `fold`; `setWing()` (`:404-414`)
  turns (flap, fold) into a wing matrix with one Euler compose + one multiply. Bodies/wings are 2 InstancedMeshes (`:343-347`).
- Legs tuck via a per-instance `tuck` attribute in an `onBeforeCompile` shader on `gullMat` (`:328-336`); the geometry carries
  `legW` (`wildlife-models.js:65-68`). Geometry helpers are exported: `gullBodyGeometry`, `gullWingGeometry`, `GULL_SHOULDER`, `GULL_HIP` (`:50-74`).
- Clock: `now() = ctx.elapsed + offset` (`:376`). Host `serialize()` sends `{t}` (`:549-553`, only when role is `'host'`); guest
  `load(…,'net')` sets a target offset and `slew()` eases at 0.5 s/s, hard snap past 10 s (`:526-530`, `:554-562`). So co-op agrees.
- Gulls spook when a player walks within `SCARE_RADIUS = 3` (`:10`, `:456`). The companion must not spook.

## 2. Raft animals (`dist/animals.js`, `animals-core.js`, `animals-models.js`, `animals-ui.js`) – the template to copy
- Slice `world.ext.animals`, host-authoritative, actions `animals.*` (`animals.js:1-4`). Host advances `st.t` only while
  `ctx.running` (`:203-209`); guest `clock += dt` then `snap()` slews 15%/msg, hard snap past 2 s (`:367-371`). Wander is a
  closed-form plan of (clock, seed, born, layout), so **no positions are sent**.
- Rendering: InstancedMesh + preallocated scratch (`:28-34`), `toWorld()` through `raft.matrixWorld`, `raftQuat()` (`:139-146`). Zero-scale matrix hides slots.
- Picking: ray-sphere `sphere()` / `pick()` (`:235-259`) with `REACH = 3.2` (`animals-core.js:8`).
- Prompt per hit (`:264-283`), interact (`:287-304`), feed with held kind (`heldFood`, `:260`). Host `action()` validates verb,
  id, distance via `near(actor,…)` using `ctx.physics` / `ctx.other` (`:318-350`). Emits `{kind:'build'|'notice'|'loot'}`.
- Naming: `cleanName()` (`animals-core.js:38-43`, NFC, strips Cc/Cf, `NAME_MAX = 14`), `NAMES` default list (`:9`),
  `rename()` (`:326-331`). Dialog `animals-ui.js` is lazy-imported (`animals.js:306-316`) but hard-codes the title
  "Name your Puffhen" and `kind:'animals.name'` (`animals-ui.js:24`, `:35`). Escaping is done in `promptFor` with `esc()`.
- Prune when the home decor goes (`pruneHomes`, `:118-130`); serialize cache keyed on `st.r` + 5 s (`:355-366`).

## 3. Content module pattern
- Register: import + append to `FEATURES` (`dist/content.js:43`, `:47`). Hook list and contract: `content.js:6-27`, `docs/features/content-hooks.md`.
- `bees.js` is the compact model: pure exported rules on top (`cleanBees`, `tickBees`, `harvest` atomic via scratch Bag,
  `bees.js:24-98`), module below. `OLD_HOST` string (`:9`), `hostHasBees = data !== undefined` on net load (`:167-176`), prompt/interact
  return OLD_HOST for a guest on an old host (`:203`, `:211`). Same in `storage-research.js:14`, `:319`, `:357`.
- Decor item: new placeable items go in `items.js` LIST with `placeable:true` (bees: `items.js:194-202`) plus `BLOCK_RADII` (`:240-244`),
  then `PLACEABLE_IDS` feeds `DECOR_TYPES` (`game.js:74`, `:82`). Model via module `decorModel(type)` (`game.js:591`). Also add
  craft-book category + text (`craft-book.js:23-28`, `:96-117`) and an icon in `item-svg.js` (`:279+`). `tests/progression.test.mjs:100-160`
  enforces complete entries and a radius for every placeable.
- Research: recipes outside `STARTER` (`storage-research.js:11`) unlock once all cost kinds were seen (`learnedFrom`, `:40`).

## 4. Prompts on screen
- `game.js:706-723` `updateContext()`: `contextHtml` is reset per frame and fed to `window.raftPrompts` (provider `id:'content'`,
  priority 1, `promptParts()` from `content.js:58-66`). `promptFromHtml` does **not** exist; `promptParts` is the converter.
- **Risk:** the chain checks `eatTip` (`game.js:715`) *before* `content.prompt` (`:717`). Holding **cookedfish** (edible,
  `vitals.js:28`) sets eatTip, so the content prompt is never asked and "LMB Eat" shows instead of "E Offer fish". E itself
  still reaches `content.interact` (`game.js:1143`, before `fc`/`prog`), so it works, but is invisible. `honeyfish`
  (Honey Glazed Fish, `items.js:181`, tip already says "The seagull is very jealous") is **not** in `FOOD`, so it has no eatTip.
  Fix (1 line): in `updateContext`, try `content.prompt(frameAim)` before the eatTip branch when it starts with `<kbd>E`.
- No honey biscuit item exists. Treats: `cookedfish` (`items.js:178`), `honeyfish` (`:181`, favourite: counts double), optionally raw `fish`.

## 5. Vitals
`dist/vitals.js`: `FOOD` table (`:26-33`), `isEdible`. Treats are just `bag.remove(kind, 1)` on the host; no vitals change, no
`hurtPlayer`. Nothing to integrate; just do not call `consume()`.

## 6. Proposed state: `world.ext.gull` (host-authoritative)
```
{ v:1, r, t,                   // revision, host gull clock (s)
  home:[x,z] | null,           // perch tile it lives on (null: not moved in / perch gone)
  treats:0..3, treatAt,        // progress before moving in; cooldown 15 s between treats
  moved:bool, name:'', seed,   // seed: uint32 from Math.random on move-in
  hearts:0..10, finds:[k..],   // tray, max 3, kinds from ['wood','plastic','rope']
  findAt, follow:'host'|'guest'|'' , followUntil }
```
Validate like `cleanAnimals` (ints/clamps, `cleanName`, `home` must be a `perch` decor tile else null). Actions:
`gull.treat{x,z,food}`, `gull.collect{x,z}` (atomic scratch-Bag like `bees.harvest`), `gull.name{name}`, `gull.pet`.
Distance check with `near(actor,…)` as in animals. Host tick in whole seconds: `findAt` timer (e.g. 180–300 s, rnd seeded) adds one find
to the tray if < 3; emit `{kind:'notice', text:'<name> brought you a plank!'}` to 'all'. Bump `r` on every change.

## 7. Animation (cheap, no per-frame allocation)
- Own module mesh: one `Mesh(gullBodyGeometry)` + two `Mesh(gullWingGeometry)` (or one InstancedMesh count 2). Copy the leg shader
  with a **uniform** `tuck` instead of the instanced attribute (the wildlife material needs `tuck` as an attribute and is not exported).
  Copy `setWing` math (`wildlife.js:404-414`); preallocate Vector3/Quaternion/Matrix4/Euler in `build()`.
- Modes by beat (`BEAT = 10 s`, `beat = floor(clock/BEAT)`, `mode = rnd(seed, beat)`): rest 60% (perched pose = `gullPlan` perched branch:
  hop every 2.3 s, folded wings), loop 30% (circle radius 3.5 m, height 2.5 m around the perch, `a = ph + w*u`), follow 10%
  (only if `follow` set). Blend take-off/landing over 1.5 s with `smooth()` like `gullBlend`; flap = burst sine, fold from height above perch.
- Everything in raft-local coords through `raft.matrixWorld` (as animals `toWorld`). Before move-in, a "visiting" gull lands on the
  perch on a seeded schedule (e.g. 45 s of every 90 s) so there is something to feed; between visits the prompt says "Wait for a gull".
- Follow: target = the chosen player's pose (`ctx.physics` if `follow === role-of-self`, else `ctx.other`) + shoulder offset; local
  exponential smoothing (state in plain numbers). Both clients see both poses, so they agree within latency; not exact, which is fine.
- Guest clock: copy `snap()` from `animals.js:367-371`. Find/tray rendering: up to 3 tiny meshes on the perch tray, toggled by `visible`.
- Picking: ray-sphere on the gull's last world pos and on the perch (like `animals.pick`).

## 8. Co-op and save compatibility
- Host sends `ext` in every state message (`game.js:1456`), ~8 Hz: cache `serialize()` on `r` (animals `:355-366`). Guest loads at `game.js:1787`;
  restore after a visit at `:1700`; save at `:1235`. Guest actions go through `ctx.action` → host `content.action` (`game.js:1107`).
- New guest on old host: `data === undefined` → `OLD_HOST = 'Your friend’s raft doesn’t have a gull perch yet'` (bees pattern).
- Old guest on new host / old build loading a new save: `cleanWorld` drops unknown decor types (`game.js:186`), so the perch is
  invisible and (old build re-save) lost; `ext.gull` survives through `cleanExt` but `home` is pruned on next load. Acceptable, same as bees.
- Old save on new build: `load(undefined)` → defaults. Unknown bag kind `perch` in an old build resets its bag (`content-items.js:4`), known risk.

## 9. Tests (style: `tests/bees.test.mjs`, `tests/animals.test.mjs`)
`node:test` + `assert/strict`, import from `RAFT_DIST` or `../dist/`, Bag from `inventory-state.js`. Cover: `cleanGull` junk/clamps/prune,
treat progression and cooldown, move-in, find tick cap 3 and kinds, atomic collect with full bag, rename via `cleanName`, OLD_HOST,
pose functions deterministic for the same clock (host vs guest), and `tests/progression.test.mjs` item completeness. Keep `?build=` stamps
on imports (`tests/module-specifiers.test.mjs`) and `forceSinglePass` on any transparent DoubleSide material (`tests/perf-lint.test.mjs`).

## 10. Risks
1. eatTip hides the treat prompt for cookedfish (section 4); needs the 1-line game.js reorder or honeyfish-only treats.
2. Rename UI is Puffhen-specific; parameterise `createAnimalsUI(ctx, {title, kind})` or a 40-line `gull-ui.js` copy.
3. Follow mode uses live poses, so host/guest can differ by a few cm; keep it short and slow.
4. Finds must stay rare (1 per 3–5 min, tray cap 3) so the economy (`items.js:34-40`) is not upset.
5. Perch removed: gull keeps `moved/name/hearts`, `home = null`, circles until a new perch is placed; tray kept in state.

## Recommendation
New `dist/gull.js` (pure rules + module, bees layout) + `dist/gull-models.js` (perch with tray), registered in `content.js:47`.
`perch` item in `items.js` (`{wood:3, rope:2, feather:1}` or `{wood:3, rope:2}`), radius 0.25. Treats: `honeyfish` (2 points) or `cookedfish`
(1 point), 3 points to move in. Reuse `gullBodyGeometry`/`gullWingGeometry`, `cleanName`, `rnd`, animals' clock snap and picking.
One small `game.js` edit for the prompt order. Single gull per raft keeps state tiny and draw calls at 3–4.
