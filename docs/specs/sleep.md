# Spec: bed + sleep through the night

Source: `docs/features/sleep-research.md`. The skip never happens by itself.

> **Raft fidelity update (round 3, `docs/loop/research/fidelity-r3-seagull-bed-fuel.md`)** supersedes the
> "cozy, no penalties" parts below:
> - Recipe: 6 wood + 10 leaf + 4 plastic + 3 nail (learned at the table once plastic and nails are seen).
> - Each skip costs the sleepers 20 food + 20 water and heals 40 HP (`vitals.js applySleep`). Each client
>   applies it to its own local vitals: the host at the skip, a guest when the net copy's `skips` bumps while
>   it was in bed.
> - Respawn point: the slice gains `spawn:{host:[x,z]|null, guest:[x,z]|null}`, set by the host on any
>   `sleep.lie` that passes the bed + reach checks (even if then refused for daytime or a taken bed), kept
>   across saves, cleared when the bed is removed. `respawnSpot()` gives the get-up spot beside it; game.js
>   wakes a fainted player there with `BED_RESPAWN` (25 hp / 50 food / 50 water), else at the raft centre
>   with `RESPAWN`.
New: `dist/sleep.js` (content module `name:'sleep'`), `dist/sleep-model.js`, `tests/sleep.test.mjs`.

## Rules
- Sleep is allowed when `phase >= 0.66 || phase < 0.02` (dusk + night). Otherwise refuse.
- `?daynight=off` (or the localStorage `day` opt-out): always refuse with "Too bright to sleep".
- E on a free bed in reach (3.2 m, same ray test as `storage-research.js:274-294`) lies you down.
  One sleeper per bed. E again (or any UI opening) gets you up.
- Players: `'host'` and, when `ctx.other` is non-null, `'guest'`. **All in bed** =
  `in.host && (!ctx.other || in.guest)`. No auto-skip for a lone host while a guest is connected
  (old-build guests included): the host sees "1/2" and can always get up with E. Never blocks.
- All in bed for 1.0 s -> fade out 1.2 s -> at full black the host skips to `MORNING` (0.10) ->
  hold 0.4 s -> everyone is put out of bed beside it -> fade in 1.2 s -> notice "Good morning!".
  Getting up (or the guest leaving) during the 1.0 s hold or fade-out cancels and fades back in.
- Not fast-forwarded: palm growth, purifiers, cooking, sailing drift (they tick in real seconds).
- **Well rested: dropped for v1.** There is no speed hook: scaling `physics.vx/vz` in
  `afterMove` compounds through PlayerPhysics acceleration (`player-physics.js:129-130`), and
  extra displacement skips collision. Follow-up: a `speedMul` arg in `PlayerPhysics.update`.

## Data
Slice `world.ext.sleep`, host-authoritative, sent ~8x/s:
```
{ v:1, in:{ host:[x,z]|null, guest:[x,z]|null }, fade:0|1, skips:int>=0 }
```
- `cleanSleep(d)`: junk -> `{v:1,in:{host:null,guest:null},fade:0,skips:0}`; tiles must be integer
  pairs; `skips` integer 0..1e9.
- `load(d,'save'|'restore')`: keeps only `skips`; `in` and `fade` are always reset (never start in
  bed after a reload). `load(undefined)` = defaults. `load(d,'net')` (guest): compare primitives
  with the last copy; return early if unchanged; no allocation beyond `cleanSleep` on change.
- Runtime only (host): `hold` timer, `fadeT`, `phase` of the sequence: `'idle'|'hold'|'out'|'black'`.

## Files and hook lines
1. `dist/daynight.js`
   - Export pure `skipClock(clock, toPhase)`: `cur = phaseAt(clock)`, `day = floor(clock/DAY_SECONDS)
     + (cur >= toPhase ? 1 : 0)`, return `day*DAY_SECONDS + toPhase*DAY_SECONDS`.
   - Export live mirror `export const DAYNIGHT_LIVE = { phase: MORNING, optOut: false, ready: false };`
     In `update()` after the clock step (:523-532): `DAYNIGHT_LIVE.phase = optOut ? PINNED_DAY :
     phaseAt(clock); DAYNIGHT_LIVE.optOut = optOut; DAYNIGHT_LIVE.ready = true;` (no allocation).
     `dispose()`: `DAYNIGHT_LIVE.ready = false`.
   - Add `action(a, actor)` to the returned object (:602): handles only `a.kind === 'daynight.skipTo'`;
     returns true for that kind always; applies only if `actor === 'host'`, `!optOut`, `ctx.role !==
     'guest'`, `a.phase` finite in [0,1), and the current phase is sleepable (guards double skips).
     Then `clock = skipClock(clock, a.phase)`. Guests snap via existing `load` (:540, > SNAP_SECONDS).
2. `dist/sleep.js` imports `{ DAYNIGHT_LIVE, MORNING } from './daynight.js?build=v3-survival-ae77fa84ac2b'`
   (the **exact** URL content.js uses, else it is a second module instance and the mirror is dead).
   `createSleep(ctx, opts={})`; `opts.day = () => ({phase, optOut, ready})` for tests, default reads
   `DAYNIGHT_LIVE`. Pure exports: `canSleep(day) -> null|reason`, `cleanSleep`, `allInBed(inn,
   guestPresent)`, `bedPose(x,z,deck)`, `getUpSpot(world,x,z)`, `SLEEP_START=.66`, `SLEEP_END=.02`,
   `HOLD=1`, `FADE=1.2`, `BLACK=.4`, `REACH=3.2`.
3. `dist/content.js`: `import { createSleep } from './sleep.js?build=v3-survival-ae77fa84ac2b';` and
   `FEATURES = [createIslands, createWildlife, createStorage, createDayNight, createSleep]`.
4. `dist/content-items.js`: `bed: item('bed', 'Bed', 'icon-leaf', true)` in CONTENT_ITEMS;
   `bed: recipe('bed', 'Bed', 1, { wood: 6, leaf: 4 })` in CONTENT_RECIPES;
   `CONTENT_DECOR = ['research', 'bed']`; `CONTENT_BLOCK_RADIUS = { research: .5, bed: .55 }`.
   Not in STARTER, so it is learned at the Research Table from wood + leaf (`learnedFrom`, storage :36).
   No game.js edits: placement (:772), DECOR_TYPES (:44), BLOCK_RADIUS (:52) pick it up.

## Module behaviour (`dist/sleep.js`)
- `action(a, actor)`: claims `a.kind` starting `sleep.`. Host only.
  - `{kind:'sleep.lie', x, z}`: refuse (emit notice to actor) unless decor at (x,z) is `bed`, actor
    pose (`ctx.physics` / `ctx.other`) within REACH of `(x*2,z*2)`, `canSleep` null, bed not held by
    the other actor. Then `in[actor] = [x,z]` (moving beds is allowed).
  - `{kind:'sleep.up'}`: `in[actor] = null`; cancels a running hold/out.
- Host `update(dt)`: if `!ctx.other` clear `in.guest`; if the bed tile lost its decor, clear that slot;
  run the sequence; at end of `'out'` call `ctx.action({kind:'daynight.skipTo', phase: MORNING})`,
  `skips++`, after BLACK clear `in`, `fade=0`, put the local player at `getUpSpot`.
- Local player lying = `slice.in[myRole]` set (`myRole` = `ctx.role==='guest' ? 'guest' : 'host'`).
  Guest lies only after the host confirms (one state tick, ~0.12 s). On becoming un-set, move to
  `getUpSpot`. `ctx.uiOpen()` while lying -> send `sleep.up`.
- `afterMove(physics)` while lying: `physics.x/z/y = bedPose` (`x*2, deckY()+.55, z*2-.55`, head
  at -z), `vx=vy=vz=0`, `grounded=true` (no landing events). Look stays free.
- `getUpSpot`: first of tiles (x+1,z), (x-1,z), (x,z+1), (x,z-1) that exist with no blocking decor,
  at that tile's centre; else `(x*2+.8, z*2)` (physics pushes out of the .55 radius).
- Fade: lazily created fixed `<div>` (`inset:0; background:#000; opacity:0; pointer-events:none;
  z-index` above HUD, below dialogs), opacity driven per frame from `fadeT/FADE` (no CSS transition;
  reduced motion: cut to FADE=.5). Host from its own timer; guest targets `slice.fade`, and if
  `fade` stays 1 for > 5 s, fades in anyway. Guest sees `skips` increase (not the first net load,
  which only sets the baseline) -> "Good morning!". Removed in `dispose()`.
- Old host (guest gets no `sleep` slice): E on a bed -> notice "Your brother’s raft doesn’t have beds yet".
- `decorModel('bed')`: cached builder from `sleep-model.js`, return `.instance()`.

## Prompt and notice texts
| situation | text |
|---|---|
| aim free bed, can sleep | `<kbd>E</kbd>Sleep` |
| aim bed, daytime (E -> same notice) | `Not sleepy yet. Come back after sunset` |
| aim bed, opt-out / day-night missing | `Too bright to sleep` |
| aim bed held by the other | `Your brother is in this bed` |
| lying, alone or both in | `Sleeping… <kbd>E</kbd>Get up` |
| lying, guest present not in bed | `Waiting for your brother (1/2) · <kbd>E</kbd>Get up` |
| other lay down, you are up (notice once) | `Your brother is sleeping. Lie down in a bed to skip the night` |
| wake (all sleepers) | `Good morning!` |
Placement notice comes from game.js ("Bed placed"). `prompt()` while lying ignores the aim.
`interact()` while lying always sends `sleep.up` (pickups in reach still win first, game.js:836).

## Model (`dist/sleep-model.js`)
Same pattern as `storage-research-model.js`: one merged vertex-coloured geometry, one material, shared,
dispose no-op, `instance()` returns a Group with **one mesh** (1 draw call). Origin = tile top centre.
- Frame: base box 1.15 x .22 x 1.9 at y .16 (warm plank `#9a6b43`), headboard 1.15 x .55 x .08 at
  z -.95, y .4; four stubby legs .1 x .08 x .1 at the corners.
- Mattress: 1.02 x .14 x 1.78 at y .34 (leaf green-beige `#c9c08a`).
- Pillow: .7 x .1 x .32 at y .45, z -.68 (off-white `#efe6d2`), slight x tilt.
- Blanket: 1.06 x .06 x 1.0 at y .43, z +.35 (soft teal `#3f8f8a`), folded lip box at its -z edge.
`userData.craftType='bed'`, `height=.95`. Fixed orientation (decor has no rotation field).

## Tests (`tests/sleep.test.mjs`, node only, stub ctx like storage-research.test.mjs)
1. `canSleep`: .70, .99, .66, .01 ok; .02, .3, .65 -> daytime reason; optOut or !ready -> "Too bright".
2. `skipClock`: from night phase .8 of day 3 -> day 4 at .10; from .01 of day 4 -> day 4 at .10; always
   > clock and phase .10 exactly.
3. daynight `action`: host skipTo at night moves clock; at day no-op; actor 'guest' no-op; returns true.
4. `cleanSleep`/`load`: undefined, null, strings, bad tiles, negative skips -> defaults; `load(d,'save')`
   with `in.host` set never leaves anyone in bed.
5. `sleep.lie`: refused off-bed, out of reach, daytime, bed taken by other; accepted otherwise.
6. `allInBed`: host only + no guest = true; host only + guest = false; both = true.
7. Sequence (drive `update(dt)` with stubbed `ctx.action` capturing calls): solo host lies at night ->
   after HOLD+FADE exactly one `daynight.skipTo` `{phase:.10}`, `skips` 1, `in` cleared, `fade` 0.
   `sleep.up` during hold cancels (no skipTo). Guest connected + not in bed -> no skipTo after 10 s.
   `ctx.other` -> null while guest in bed clears the slot and lets the host sleep.
8. Guest `load(...,'net')`: same data twice is a no-op; `fade:1` for 6 s without change -> opacity 0.
9. `getUpSpot` picks a free neighbour tile; falls back when surrounded.
10. Content items: `RECIPES.bed` cost `{wood:6, leaf:4}`; `bed` in CONTENT_DECOR; not in STARTER.

## QA screenshots (copy of scratchpad shoot.py, steps via `window.raftDebug`)
Expose `raftDebug.content.sleep = { give(n), place(x,z), lie(x,z), up(), state() }` (state = slice +
sequence + lying + opacity). Steps, each a screenshot:
1. `give(1); place(1,0)`; daytime `daynight.setPhase(.3)`; aim at bed: model + "Not sleepy yet" prompt.
2. `setPhase(.8)`, aim: `E Sleep` prompt at dusk with lanterns.
3. `lie(1,0)`: view from the pillow, "Sleeping…" prompt.
4. wait 1.6 s: mid-fade (opacity ~.5); 5. wait 2 s more: morning sky, "Good morning!", player beside bed,
   `daynight.state().phase ≈ .10`, `sleep.state().skips === 1`.
6. `?daynight=off` load: aim bed -> "Too bright to sleep".
7. Co-op (tests/coop-e2e.mjs harness or two pages): host lies -> host "1/2", guest notice; guest lies
   -> both fade, both wake at .10. Record `daynight.renderInfo().calls` with 0 vs 3 beds (+1 each).

## Builder deviations (v1 build)
- `bedPose` eye height is `deckY()+.8`, not `+.55`: at `.55` the eye sat inside the blanket's folded lip
  (blanket top is ~.48 above deck), so the view was a wall of cloth. Screenshot-checked.
- `DAYNIGHT_LIVE.phase` also honours a debug `pinPhase` (same expression as `daynight.debug.state()`), so a
  guest's QA pin and the sleep prompt agree. Hosts never pin, so the host gate is unchanged.
- `#contextPrompt` is hidden by prompts.css, so the module also registers a `raftPrompts.provide({id:'sleep',
  priority:1})` provider with plain labels (`E Sleep`, `Sleeping… · E Get up`, muted refusals). It reuses the
  last aim game.js passed to `prompt()`. Notices (`Good morning!`, brother asleep) go through `ctx.notice` and
  show in the prompts.js feed.
- `getUpSpot` treats any decor except `net` as blocking (game.js `BLOCK_RADIUS` is not importable).
- Extra QA helper `raftDebug.content.sleep.stand(x,z)` moves the local player (metres, raft frame).
- Lie refusal for a tile without a bed: "Find a bed to lie down"; out of reach: "Step a little closer".
