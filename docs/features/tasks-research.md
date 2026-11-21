# Daily crew tasks: research

Feature: a "crew tasks" board that offers 3 small cozy tasks per in-game day, shared by the whole crew in
co-op, paying out small item rewards. All anchors below are against the tree at 7294e26 (branch
`claude/loop-features-202611210749`) and are file:line.

## (a) Genre patterns and our take

**Common patterns in survival/cozy sandboxes (general mechanics only):**
- *Daily/rotating objectives*: a short list that refreshes on a clock (real-time daily or in-game day).
  Good ones are small, finishable in one session, and use verbs the player already does.
- *Bounty/notice boards*: a physical board in the world you walk up to; makes the feature diegetic and
  gives a reason to go back to base. Often a "pin up / take down" metaphor.
- *Rewards*: small, frequent and immediately useful (materials, a seed, a cosmetic) beat rare big ones.
  Avoid currencies that create a second economy.
- *Streaks*: a counter for consecutive days completed. Punitive streaks (lose everything if you miss a day)
  cause anxiety; cozy games soften them (streak pauses, or "best streak" kept forever).
- *Co-op shared progress*: one shared list, any crew member's action advances it, everyone gets the
  completion toast. Rewards either go to the finisher or are split to each bag.

**Little Raft take: "Crew Tasks"**
- Lives in two places: a placeable **Task Board** decor (CONTENT_DECOR, crafted cheaply: e.g. 3 plank + 1
  leaf) where E opens the list, and an always-available **"Tasks" tab in the logbook** (L key), so nobody
  is locked out before building one. The board is flavour plus a prompt, never a gate.
- **3 tasks per in-game day**, picked deterministically: `pick(seed, dayIndex)` with a hash like
  daynight's `hash01(seed, index, salt)` (dist/daynight.js:46). Same seed+day gives the same tasks on host
  and guest, so only progress needs syncing. Pick from 3 difficulty buckets (easy/medium/varied) and
  never repeat a task kind within a day; skip tasks whose prerequisite is missing (no "cook" before a
  grill exists; swap in "build a grill" instead).
- Task pool (all verbs that already exist): hook 10 planks (wood from collect), hook 3 barrels, catch 2
  fish, cook something (take a cooked fish off a grill), craft a rope, craft anything 3 times, water a
  palm planter, harvest a palm, place a decoration, add 2 floor tiles, gather on an island (visit),
  read a message in a bottle (only if notes remain).
- Rewards: small item bundles per task (2 plank, 1 rope, 1 seed, 2 scrap, 1 cooked fish), plus a tiny
  bonus bundle when all 3 are done. Rewards are added to the finisher's bag; if full, they wait on the
  board ("Claim") rather than being lost.
- **Streak**: "days with all 3 done in a row". Missing a day never removes rewards; the streak simply
  restarts and `best` is kept. Copy is gentle: "A fresh day, fresh tasks!", never "you failed".
- Never punishing: no timers in real seconds, no penalty, tasks can't expire mid-progress in the visible
  sense (finishing late in the day still counts until the day index flips).

## (b) Code anchors (current tree)

**Content module plumbing**
- Registry + module shape: dist/content.js:1-23; `FEATURES` list dist/content.js:31 (append `createTasks`).
  Note only islands, wildlife, storage, daynight, bees are registered there; logbook/signal/watering are
  wired directly in game.js instead.
- ctx (getters incl. world, role, other, physics, emit, action, notice, actorBag): dist/game.js:375-383.
- Content hooks: init load dist/game.js:416, save dist/game.js:1067, hostState ext dist/game.js:1267,
  guest 'net' load dist/game.js:1577, restore dist/game.js:1491, action tail dist/game.js:951,
  interact dist/game.js:984, prompt dist/game.js:589, update dist/game.js:1284, debug dist/game.js:1721.
- Decor: `DECOR_TYPES`/`BLOCK_RADIUS` spread CONTENT_DECOR at dist/game.js:68,76; decorModel at
  dist/game.js:525 (and ghost preview dist/game.js:400). Items in dist/content-items.js, but the craft
  catalogue/unlocks now live in dist/items.js (progression; `prog.apply` intercepts locked crafts at
  dist/progression-hooks.js:109-114). Put the Task Board recipe in items.js with `unlock: START`.

**How the logbook observes events (the model to copy)**
- Host-only `award(ev)` dist/game.js:817-823 (returns early on guest), calls pure `evaluate(world, bags, ev)`
  dist/logbook.js:75-106 which reads world counters (`world.fish`, `world.collected`, tiles, decor) or the
  event kind (`craft` with `crafted`, `repair`). Announces with `emit({kind:'achievement'}, 'all')`.
- Call sites in `applyAction` (dist/game.js:861): craft dist/game.js:869-877 (`award({kind:'craft', crafted})`
  at 876), collect dist/game.js:878-895 (`loot` object computed at 882, `a.net` for nets, award at 893),
  build floor/decor dist/game.js:896-920 (award at 919), fish dist/game.js:936-940 (`world.fish++` at 939),
  repair dist/game.js:942-949, bottle note dist/game.js:809-816.
- There is **no generic event bus** for content modules. Recommended minimal engine change: one new optional
  content hook `observe(ev, actor)` in content.js, called next to each `award(...)` with richer data
  (`{kind:'collect', loot, type}`, `{kind:'craft', crafted, count}`, `{kind:'build', recipe}`,
  `{kind:'fish'}`), plus at the spots below. Do not parse `emit()` effect text (dist/game.js:796-808):
  net pickups emit nothing and texts change.

**Other event sites**
- Fish (rod v2 path also lands here): fishing-cooking `onCatch` -> `host.action({kind:'fish'})`
  dist/fishing-cooking.js:278 -> dist/game.js:936.
- Cook: grill take `fc:take` dist/fishing-cooking.js:159-164 (item.state 'cooked'/'burnt'); routed from
  dist/game.js:865 (bag adapter only, no observe). Progression grill output via `prog:take`
  dist/progression-hooks.js:129-133 (cookedfish recipe dist/items.js:162-163). Both need a hook.
- Water / harvest palm: `applyWatering` dist/game.js:829-843, `r.ok` with `a.kind === 'waterPlant'` or
  `'harvestPlant'`; logic dist/watering.js:176,188. (dist/farming.js seed planting is not wired: see risks.)
- Island visit: `islands.gather` host action dist/islands.js:301-317 (`r.ok` = visited and gathered);
  local-only `sandState.onSand` dist/islands.js:50,422 is per-client, not host-validated, so prefer gather.
- Signal cache / bottle: dist/game.js:889-891, 809-816.

**Day clock**
- dist/daynight.js:6 `DAY_SECONDS = 1200`; day index = `Math.floor(clock / DAY_SECONDS)`. Clock + seed are in
  `world.ext.daynight` (`serialize` dist/daynight.js:626-628). The module exposes only `wind`/`rain`
  getters (dist/daynight.js:680); add a `get clock()`/`get day()` there, or read
  `ctx.world.ext?.daynight?.clock` (but world.ext is only refreshed at save time, dist/game.js:1067).
  content.js already has a precedent accessor `rain()` (dist/content.js:61) - add `day()` the same way.
- Opt-out: `?daynight=off` or localStorage 'day' -> `createDayNightOff` dist/daynight.js:256-274, which
  keeps the clock **frozen** (no update). No `DAYNIGHT_LIVE` flag exists in the current tree.
- debug `setPhase` jumps inside the same day dist/daynight.js:649-656 (useful for QA: add `nextDay()`).

**UI**
- Logbook dialog + styling: dist/logbook-ui.js:19-26 (wood panel `#logbook.lb`, `lb-wrap`), tabs markup
  dist/logbook-ui.js:68-76 (add a third "Tasks" tab), `celebrate` toasts on `note`/`achievement` effects
  dist/game.js:806, opened with L dist/logbook-ui.js:205 or event `littleraft:open-logbook`
  dist/logbook-ui.js:214. Created at dist/game.js:1842 with `getProgress: () => world`.
- Prompts: `#contextPrompt` is hidden (dist/prompts.css:2), so content `prompt()` text is invisible.
  Register `window.raftPrompts.provide({id:'tasks', priority:1, prompt})` (API dist/prompts.js:3-6,192) and
  step aside like dist/instruments.js:183-193 (`st.pickup`, swimming, guest not ready).

**Co-op**
- Host-authoritative: `applyAction` returns on guest (dist/game.js:862); state incl. `ext` ~8x/s at
  dist/game.js:1267. Task progress lives in `world.ext.tasks` = `{v:1, day, done:[..], prog:[..],
  claimed:[..], streak, best}`; the guest only renders. Guest actions (claim) via `ctx.action({kind:'tasks.claim'})`
  handled in module `action()` (prefix like `islands.` dist/islands.js:302).

## (c) Risks

1. **Save compat**: `load(undefined)` -> fresh state for the current day; clamp counters, ignore unknown
   task ids (pool may change between builds), cap array sizes (EXT_MAX 200k, dist/content.js:32). Older
   builds drop `ext.tasks` harmlessly. Never retro-complete tasks from old counters.
2. **Double counting in co-op**: count only on the host inside `applyAction` paths (guest-side `fishing-cooking`
   `onCatch` also sends `{kind:'fish'}`, which is fine because the host applies it once). Never count from
   effects received over the net or from `load(...,'net')`. Collect is token-guarded (dist/game.js:879);
   nets (`a.net`) are legitimate pickups and should count. Guests must not predict completion locally.
3. **Day boundary with daynight off**: the clock is frozen, so the day never flips and tasks never rotate.
   Fallback: if daynight is opted out (no live clock), derive the day from the module's own accumulated
   host play time (`elapsed`/dt summed, saved in ext) using the same DAY_SECONDS. Also the guest's local
   opt-out must not matter: the host's day drives everything.
4. **Restore after a raft visit**: `load(ext, 'restore')` (dist/game.js:1491) - daynight resets its clock on
   restore (dist/daynight.js:607); tasks must keep `day` from their own slice, not recompute and wipe.
5. **Day jumps** (sleep/bed feature skipping time, debug setPhase): if `day` jumps by >1, just roll to the new
   day; streak continues only if the previous day was fully done (`day === last+1`), otherwise restart.
6. **Reward overflow**: full bag -> keep reward claimable; reward add must be atomic (copy the
   scratch-Bag pattern at dist/game.js:883-887).
7. **Prerequisite drift**: progression locks (dist/items.js unlocks) may make "craft a rope" impossible early;
   filter the pool by `prog.recipeGate`/unlocked state at pick time, with a deterministic fallback.
8. **Pre-existing bug noticed**: `farmPlot` is referenced but never defined at dist/game.js:1158; holding a
   `seed` (placeable per dist/held-items.js:20) would throw there. Avoid a "plant a seed" task until fixed.
9. Per-frame cost: `serialize()` runs ~8x/s; keep the slice tiny and `load('net')` must only re-render the
   DOM when a value changed.
