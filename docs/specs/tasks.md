# Spec: Crew Tasks (daily task board)

Three small cozy tasks per in-game day, shared by the whole crew, each paying a small item bundle that
every crew member claims for their own bag. Research: docs/features/tasks-research.md. Anchors checked at
09c78ae. Never punishing: no real-time timers, no penalties, nothing is lost.

## Files
- `dist/tasks-rules.js` (new, pure: no DOM/THREE/Date/Math.random): `DAY_SECONDS` (import from daynight.js),
  `POOL`, `hash01`, `pick`, `cleanTasks`, `observeTasks`, `rollTasks`, `claimTasks`, `taskView`.
- `dist/tasks.js` (new): content module `createTasks(ctx)`, name `'tasks'`; Task Board target/prompt/interact.
- `dist/tasks-model.js` (new): `createTaskBoard(T)`, a ~0.9 m wooden notice board on two legs with 3 paper notes.
- Edits: content.js, game.js, daynight.js, fishing-cooking.js, progression-hooks.js, islands.js, items.js,
  logbook-ui.js. Test: `tests/tasks.test.mjs`.

## Task pool (`POOL`, ids are save keys; never rename, only append)
| id | label | counts when (observe ev) | target | reward | need |
|---|---|---|---|---|---|
| planks | Hook 6 planks | collect: += loot.wood | 6 | leaf 2 | - |
| leaves | Gather 4 leaf bundles | collect: += loot.leaf | 4 | wood 2 | - |
| barrels | Open 2 barrels | collect, type 'barrel' | 2 | rope 1 | - |
| jugs | Fish out 2 plastic jugs | collect: += loot.plastic | 2 | wood 2 | - |
| net | Let a net catch 3 things | collect with net | 3 | scrap 2 | net |
| fish | Catch 2 fish | fish | 2 | leaf 2, wood 1 | rod |
| fish4 | Catch 4 fish | fish | 4 | rope 1, scrap 1 | rod |
| cook | Cook a tasty meal | cook | 1 | wood 2, leaf 1 | grill |
| craft3 | Craft 3 things | craft (any) | 3 | scrap 1, wood 1 | - |
| rope | Twist a rope | craft, item 'rope' | 1 | leaf 2 | - |
| floor | Add 2 floor tiles | build, recipe 'floor' | 2 | wood 2 | hammer |
| decor | Place a decoration | build, recipe !== 'floor' | 1 | plastic 1 | - |
| water | Water a palm | water | 1 | leaf 2 | palm |
| harvest | Harvest a palm | harvest | 1 | wood 2 | palm |
| island | Gather on an island | gather | 1 | rope 1 | - |
| bottle | Find a message in a bottle | bottle | 1 | scrap 2 | notesLeft |

No "plant a seed" task (farming is not wired). All-3 bonus: `BONUS = {rope:1, wood:2}`. `need` flags are
plain booleans the host computes at pick time: `net` (decor has 'net'), `rod` (any bag has fishingrod),
`grill` (decor has 'grill' or `fc.hasGrill` anywhere), `hammer` (any bag), `palm` (`world.garden` has an entry),
`notesLeft` (`world.notes.length < 12`).

## Picking
`pick(seed, day, needs)` -> 3 distinct ids. Score each POOL entry by `hash01(seed, day, index)` (same mixer as
daynight.js:46), sort ascending, take the first 3 whose `need` is absent or true. Always-ok entries guarantee
3. Pure and deterministic. The host stores the picked ids in state (so guests never pick, and a pool change
between builds cannot shift today's tasks); `cleanTasks` re-picks only when an id is unknown.

## State `world.ext.tasks`
`{v:1, seed, day, ids:[3], prog:[3], claimed:[3], bonus, streak, best, playT, owed:[{},{}]}`
- `seed`: uint32 picked once from Math.random in tasks.js (not rules); `day`: tasks' own monotonic counter.
- `prog[i]` 0..target; `claimed[i]` and `bonus` are bitmasks (1 host, 2 guest): each crew member claims
  their own copy. `owed[0|1]`: rewards done-but-unclaimed when the day rolled (host/guest), merged, cap 8 kinds.
- `streak`/`best`: consecutive days with all 3 done; `best` never drops. `playT`: fallback clock, 0..DAY_SECONDS.
- `cleanTasks(v, needs)`: non-object -> fresh (seed given, day 0, new pick); clamp ints, prog to target,
  masks to 0..3, owed to known item ids with counts 1..99. Never retro-completes from old counters.

## Day clock
- daynight.js module return (line 680): add `get day() { return Math.floor(clock / DAY_SECONDS); }`. The
  opt-out module (createDayNightOff, line 266) gets no getter. content.js next to `rain()` (line 61): add
  `day() { const m = live 'daynight'; const d = m?.day; return Number.isInteger(d) ? d : null; }`.
- Tasks advance by deltas, never by absolute value (daynight resets its clock on restore, daynight.js:607):
  runtime-only `lastSrc` (null after any load). Host `update(dt)`: `src = content.day()` via a ctx accessor
  (`contentCtx.dayIndex: () => content?.day() ?? null`). If src !== null: if lastSrc !== null and src > lastSrc,
  `rollTasks(st, src - lastSrc, needs)`; then `lastSrc = src` (a backwards jump just resyncs). If src === null
  (daynight off or frozen-off): `playT += dt` while running; when `playT >= DAY_SECONDS`, roll by
  `floor(playT / DAY_SECONDS)` and keep the remainder.
- `rollTasks(st, k)`: move each done task's unclaimed reward (and unclaimed bonus) into `owed` for each
  missing bit; if not all 3 done or `k > 1`, `streak = 0` (best kept); `day += k`; new `ids = pick(seed, day)`,
  prog/claimed/bonus reset. Sleep (skip to morning) is one day: k = 1. Toast `'A fresh day, fresh tasks!'`
  via `emit({kind:'notice'}, 'all')`, only when k >= 1 and not on load.
- When the 3rd task completes: `streak++`, `best = max`; emit `{kind:'achievement', text:'Crew tasks done! Streak N'}`
  to 'all' (reuses the logbook celebrate toast, game.js:806). Each single completion: notice `Task done: <label>`.

## Observe hook (host only)
content.js: document `observe(ev, actor)` in the header; registry `observe(ev, actor) { for (m) call(m, 'observe', ev, actor); }`.
game.js contentCtx (line 375-383): add `observe: (ev, actor) => content?.observe(ev, actor)` and `dayIndex`.
Call sites (all after success, same line as / next to the logbook `award`):
| site | line | event |
|---|---|---|
| craft | game.js:875 | `{kind:'craft', item:r.crafted.kind, count:r.crafted.count}` |
| collect (incl. `a.net`) | game.js:893 | `{kind:'collect', type:it.type, loot, net:!!a.net}` |
| bottle note | game.js:815 | `{kind:'bottle'}` (not the empty-bottle path at 813) |
| build floor/decor | game.js:919 | `{kind:'build', recipe:a.recipe}` |
| fish | game.js:940 | `{kind:'fish'}` |
| repair | game.js:949 | `{kind:'repair'}` (no task yet; future use) |
| water / harvest | game.js:840 after `r` | `if (r.ok && a.kind === 'waterPlant' \|\| 'harvestPlant') observe({kind:'water'\|'harvest'})` |
| grill take | fishing-cooking.js:162-163 | `if (item.state === 'cooked') host.observe?.({kind:'cook', item:'fish'}, actor)`; fcHost (game.js:430) adds `observe` |
| station take | progression-hooks.js:133 | after a take that moved >0: `ctx.observe?.({kind:'cook', item:out.kind}, actor)` only if `ITEMS[out.kind]?.category === 'food'`; attachProgression args (game.js:1827) add `observe` |
| island gather | islands.js:310 (`if (r.ok)`) | `ctx.observe?.({kind:'gather', loot:r.loot}, actor)` |
`observeTasks(st, ev)` (pure) adds to matching unfinished tasks, clamps to target, returns indices that just
finished. tasks.js `observe` returns early unless `ctx.role !== 'guest'`. Never count from `load(...,'net')`
or from effects.

## Claiming
- Action `{kind:'tasks.claim', i}` (i = 0..2, or 'bonus', or 'owed'), handled in `action(a, actor, bag)` for
  any `tasks.*` kind (return true; guests send via `ctx.action`). Host runs `claimTasks(st, a, actor, bag)`:
  validate i, task done (bonus: all 3 done), bit for actor (1 host / 2 guest) not set (owed: non-empty).
- All-or-nothing grant: copy game.js:883-887 (scratch `new Bag(bag.snapshot())`, add every kind, any
  leftover -> `emit({kind:'full', text:'Your bag is full'}, actor)` and nothing changes, stays claimable).
  The scratch-commit is done in tasks.js (rules get an `addAll(bundle) -> bool` callback so they stay pure).
  On success set bit / clear owed, `emit({kind:'loot', text:'+ 2 plank', loot}, actor)`.
- Solo plays as host (bit 1). A guest's claimed bits persist with the host save (one guest seat).

## Logbook "Tasks" tab (logbook-ui.js)
- `createLogbookUI` gets optional `tasks: {view: () => object|null, claim: id => void}`; game.js:1842 passes
  `view: () => content?.tasksView?.() ?? null` (content.js accessor like `rain()`, calls module `view(role)`)
  and `claim: id => action({kind:'tasks.claim', i:id})`.
- MARKUP (line 68-76): third tab `data-tab="tasks"` "Tasks" + `#lb-panel-tasks`; mountDialog check (line 88)
  also requires `.lb-tasks`; `select()` (line 146) accepts 'tasks'; panels map adds it. If `view()` is null
  the tab is hidden.
- `taskView(st, bit)` -> `{day, rows:[{label, n, target, done, reward:'2 plank', canClaim, claimed}], bonus:{done,
  canClaim, claimed}, owed:'1 rope' | '', streak, best, sig}`. Render rows (label, wood progress bar, "n/target",
  reward, Claim button) only when `sig` changes (checked in `update()` while open). Streak line:
  `Streak 2 days · best 5`; at 0: `Finish all three for a streak`. Header copy: `Day N · fresh tasks each morning`.
- `littleraft:open-logbook` (line 214) accepts `e.detail?.tab` to open on that tab. Tab label `Tasks 1/3`.

## Task Board decor (minimal route)
- items.js (decor block, line ~168): `item('taskboard', 'Task Board', 'decor', { placeable: true, iconTint:
  '#c9a26b', recipe: hand({ wood: 3, leaf: 1 }), unlock: START, tip: 'Pin up the crew tasks for the day.' })`.
  PLACEABLE_IDS feeds DECOR_TYPES (game.js:68), so no CONTENT_DECOR entry. Model: module `decorModel('taskboard')`
  -> createTaskBoard(T) (reached at game.js:400/525 after prog.modelFor returns null). Optional flavour only.
- `interact(aim)`: nearest 'taskboard' within REACH 2.6 along the view ray (copy bees.js:116-135); dispatch
  `littleraft:open-logbook` {tab:'tasks'} and return true. Works for guests too (read only).
- Prompt: `window.raftPrompts.provide({id:'tasks', priority:1, prompt})` returning
  `[{key:'E', label:'Crew tasks'}]` (plus `{label:'1 to claim', muted:true}` if something is claimable) when
  aiming at a board; returns null for `st.pickup`, `st.swimming`, guest `!st.networkReady` (copy
  instruments.js:183-193). Unregister in dispose. Content `prompt()` also returns the same text (hidden today).

## Module contract (tasks.js)
- `serialize()` returns the state object (host) as is: tiny (<400 chars). `load(d, from)`: 'save'/'restore'
  -> `cleanTasks`, `lastSrc = null`; 'net' -> only if `JSON` signature differs, store and bump a `rev` for
  the view (no DOM work here). Guests never mutate. `load(undefined)` -> fresh state.
- `debug`: `state()`, `observe(ev)`, `nextDay(k = 1)`, `complete(i)`, `setNeeds(obj)` for QA.
- Register in content.js FEATURES (append `createTasks`).

## Tests: tests/tasks.test.mjs (node --test, pure rules + module with a fake ctx)
1. pick: same (seed, day, needs) -> same 3 distinct ids; different days differ over 20 days; needs false
   never picks cook/water/harvest/net/bottle/fish/floor; always returns 3 known ids.
2. observeTasks: planks adds loot.wood, net flag required for 'net', 'craft' with item 'rope', build floor vs
   decor, cook/gather/bottle; clamps at target; returns finishing index once; unpicked events ignored.
3. Completion: 3rd finish increments streak and best once; further events change nothing.
4. Roll: k=1 after all done keeps streak; k=1 not done -> streak 0, best kept; k=2 -> streak 0; unclaimed
   rewards move to `owed` per missing bit; new ids == pick(seed, day+k).
5. Module clock: fake `dayIndex` 3 -> 3 (no roll), 3 -> 4 (roll), 4 -> 0 (restore reset: no roll, resync),
   0 -> 1 (roll); null source accumulates playT and rolls at DAY_SECONDS with remainder kept.
6. claimTasks: bad i, not done, already claimed by that bit -> no change; host and guest each claim once;
   bag that cannot fit the bundle -> nothing added, still claimable; bonus needs all 3; owed clears.
7. cleanTasks: undefined/garbage -> fresh v1; clamps; unknown id -> re-pick; masks/owed sanitised.
8. Guest: observe and update do nothing when role is 'guest'; `load(...,'net')` with same data is a no-op.
9. content.test.mjs still passes; registry `observe` swallows a throwing module.

## QA plan
- Unit: `npm test` green.
- Solo, daynight on: open L -> Tasks shows 3 tasks; do one (hook planks), bar fills, Claim adds items;
  fill the bag, Claim -> "Your bag is full", stays claimable. `raftDebug.content.tasks.nextDay()` and a
  daynight `setPhase` past midnight both roll once; toast appears; owed row shows leftovers.
- `?daynight=off`: tasks still roll via playT (debug can set playT near DAY_SECONDS).
- Save/reload mid-day: same ids/progress; old save without ext.tasks loads with fresh tasks, no errors.
- Craft and place a Task Board: E opens Tasks tab; prompt shows "E Crew tasks", steps aside for pickups.
- Co-op: guest actions (fish, collect, net) advance shared bars once (no double count); guest sees host
  progress within ~0.2 s; guest Claim lands in guest bag, host can still claim own copy.
- Screenshots: Tasks tab open (desktop + 390 px wide) and the board on deck, via the patched shoot.py.

## Build notes
- Built as specced. Files: dist/tasks-rules.js, dist/tasks.js, dist/tasks-model.js, tests/tasks.test.mjs (10 tests);
  hooks in content.js, game.js, daynight.js, fishing-cooking.js, progression-hooks.js, islands.js, logbook-ui.js,
  items.js, craft-book.js and item-svg.js are tagged `[tasks]`.
- `grill` need: fishing-cooking grills are not decor, so contentCtx also gets `hasGrill: () => fc.grills.size > 0`.
- A missing `needs` object counts every flag as false, so tasks with a need are never picked blind.
- `content.tasksView()` calls the module's `view()` with no argument; the module reads `ctx.role` itself.
- The view is cached by a `rev` counter. Partial progress bumps it too, not only finished tasks.
- Extra rules exports: `freshTasks`, `completeTask` (QA), `bundleText`, `bitOf`. `taskView` also returns
  `claimable` and `doneCount`, which the prompt ("1 to claim") and the tab label use.
- Extra debug helpers: `view()`, `needs()`, `setPlayT(sec)`, `claim(i)`, `target(aim)`, `bit()`.
- The fresh-day notice shows as a pickup-feed row (bottom left), the same place as all notices.
- daynight `setPhase` stays inside the current day. To test a real rollover, use `setPhase(.9996)` and wait a
  moment. `nextDay()` rolls at once.
- A guest seat that never joins still collects `owed` rewards in solo (bit 2). Each kind is capped at 99 and
  there are at most 8 kinds. A guest who joins later can claim them.
- Logbook Claim buttons disable on click until the next view arrives, so a guest cannot double-send.
