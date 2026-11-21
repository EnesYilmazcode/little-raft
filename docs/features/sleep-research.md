# Bed and sleep: research

Research note; next step is a spec in `docs/specs/sleep.md`. Little Raft has no hunger, thirst or damage, so sleep can only be a
comfort and time-skip feature, never a survival requirement.

## (a) How the genre does it, and our take

Common patterns in survival / raft / sandbox games (general mechanics, no names or art borrowed):

- **Craftable bed.** A mid-early recipe (wood + soft material such as leaves/cloth). Usually a
  placeable object one or two tiles big. Some games have a cheap "bedroll" tier and a nicer bed.
- **Sleep only at night (or late evening).** Using the bed in daytime is refused with a short line
  ("You can only sleep at night" / "You're not tired yet").
- **Skip to morning.** Screen fades to black, the clock jumps to dawn, screen fades back. Nothing
  is simulated during the skip in most games; a few fast-forward growth or cooking timers.
- **Multiplayer.** Either *all* players must be in bed, or a percentage threshold. While waiting,
  sleepers see "Waiting for others (1/2)". Leaving the bed cancels. A player who is not in bed is
  never teleported or forced to sleep.
- **Respawn / side effects.** Beds often set respawn and drain hunger or heal. Not needed here.
- **Comfort perks.** Some cozy games give a "well rested" buff (move speed, XP, stamina) for a few
  minutes after a full sleep.

**Little Raft take (original, cozy):**

1. **Bed** decor item, recipe e.g. `{ wood: 4, leaf: 3 }` (leaf = palm bundles; optional
   `plastic: 1` as a pillow). One tile, low blocking radius, built from simple boxes in our own
   look (plank frame, leaf mattress, rolled blanket). Name: "Bed" (or "Hammock Bed").
2. **E on a bed**: during dusk/night (phase >= ~0.66 or < ~0.02) you lie down: camera settles low
   over the pillow, movement and hook are disabled, prompt reads "Sleeping... E to get up".
   During the day: notice "Not sleepy yet. Come back after sunset" (no lie-down), or optionally
   allow a short "nap" that does nothing but rest the camera. Keep it simple: refuse.
3. **Solo**: after ~1.5 s in bed, fade out (~1 s), host jumps the clock to the next morning
   (`MORNING` = 0.10 of the next day), fade in, notice "Good morning!".
4. **Co-op**: the skip happens only when every connected player is in bed (2 players max here:
   host + one guest). The one in bed sees "Waiting for your brother to lie down (1/2)". The other
   gets a gentle notice "Your brother is sleeping. Lie down in a bed to skip the night". Getting
   up cancels. Two beds are needed for two sleepers (one sleeper per bed tile).
5. **Well rested (optional perk)**: after a skip, each sleeper gets ~3 minutes of +10% walk/swim
   speed and maybe a slightly shorter paddle cooldown. Purely cosmetic-ish, never needed. Shown
   as a small notice only. Can be cut from v1 without loss.
6. **No penalties**: nothing drains, nothing is lost, the skip never happens by itself.

## (b) Code anchors in this repo

**Day phase storage and advance (`dist/daynight.js`)**
- Constants: `DAY_SECONDS = 1200` (:6), `MORNING = 0.10` (:15), `phaseAt(clock)` (:23).
  Night curve in `lightAt` (:34-42): `nightFactor` ramps 0.62->0.72 and back 0.92->1.02, so
  "night" for sleep gating is roughly phase >= 0.66 or < 0.02 (docs/features/daynight.md:29 says
  dusk 0.62-0.70, night 0.70-0.94, dawn 0.94-1).
- State is `clock` (seconds, monotonic, wraps at `MAX_CLOCK`) + weather `seed` (:259-262).
- Host advances `clock += dt` in `update()` unless `frozen` (:523-532); guests drift toward the
  host target with `driftStep` (:158).
- `serialize()` -> `{ v:1, clock, seed }` (:547-550); `cleanDayNight` validates (:147-153).
- `load(data, from)` (:534-545): for `'net'` it **snaps** when `|d.clock - clock| > SNAP_SECONDS`
  (5 s, :14; line :540), so a host-side jump of a whole night reaches guests within one state message
  (~0.12 s) with no extra protocol. `'save'`/`'restore'` set the clock directly.
- Debug setter: `debug.setPhase(p)` (:571-578) on the host rewrites `clock` to the same day at
  phase `p`; on a guest it only pins visuals. `debug.freeze()` (:585), `debug.state()` (:591).
- The module has **no `action()`** and returns only `{ name, update, serialize, load, dispose,
  debug, wind }` (:602). Weather is a pure function of `(seed, clock)` (`weatherAt` :92), so a
  skip also jumps the weather segment (a hard cut is fine under a black fade).
- **Cross-module access**: content modules do not see each other (`createContent`,
  `dist/content.js:37-61`, passes only `ctx`). Cleanest hook for a sleep module: add a host-only
  `action` to daynight, e.g. `{kind:'daynight.skipTo', phase}` that sets
  `clock = (floor(clock/DAY)+ (phase<=cur?1:0))*DAY + phase*DAY` (next morning). The sleep module
  on the host calls `ctx.action(...)`; on the host `action()` applies immediately
  (`dist/game.js:669-675` -> `applyAction` -> `content.action`, game.js tail hook). Alternative:
  put sleep logic inside daynight.js itself (it already owns lanterns), avoiding a new channel.

**Decor placement and models**
- `CONTENT_DECOR` / `CONTENT_BLOCK_RADIUS` in `dist/content-items.js:24-25`; items in
  `CONTENT_ITEMS` (:9-14) and recipes in `CONTENT_RECIPES` (:19-21), merged into ITEM_INFO /
  RECIPES by `inventory-state.js` (content hook lines). Bench is the nearest analogue
  (`inventory-state.js:30,67`).
- `game.js:44` `DECOR_TYPES = [..., ...CONTENT_DECOR]`; `game.js:52` `BLOCK_RADIUS`.
- Save validation `game.js:153-157`: decor is `{type, x, z}` only (integer tile, one decor per
  tile, **no rotation field**), so a bed's orientation must be fixed or derived (e.g. from
  neighbouring tiles) at model time.
- Placement: `game.js:772-782` (host spends the item, pushes decor, `rebuildRaft()`, emits
  "Bed placed"). Validity in `placementFor` (:656/:663).
- Model: `rebuildRaft()` `game.js:428` tries `createCraft(T,type)` (`dist/crafts.js:10-12`,
  builders map: sail, palm, lantern, net, bench `buildBench` ~:592, crate) then
  `content.decorModel(type)`; positioned at `(x*2, .22, z*2)` (:429). Example module model:
  `storage-research.js:388-392` (cached builder + `.instance()`).

**Interact / prompt / action pattern** (`dist/storage-research.js`)
- `target(aim)` (:274-294): scans `ctx.world.decor` within `REACH` (3.2 m, :10) along the camera
  ray; reuse it for beds.
- `interact(aim)` (:378-382), `prompt(aim)` (:383-387, returns `'<kbd>E</kbd>...'` HTML),
  `action(a, actor, bag)` (:369-373, claims `a.kind` prefix `storage.`).
- Host feedback via `ctx.emit({kind:'notice', text}, actor | 'all')` (`game.js:676-679`).
- Engine order: `game.js:834-846` `interact()` -> pickup, sailing, then `content.interact`;
  prompt at `game.js:490`.

**Co-op players on host**
- Only two players: `'host'` and `'guest'` (`actorBag`, `game.js:279`). A guest is present when
  `ctx.other` is non-null (`contentCtx` getter `game.js:331`; cleared on leave/timeout
  `game.js:1069,1291,1326`). `storage-research.js:270` uses `ctx.other` as the guest pose.
- So "all in bed" on host = `hostInBed && (!ctx.other || guestInBed)`. Guest sends
  `{kind:'sleep.lie', x, z}` / `{kind:'sleep.up'}` via `ctx.action`; host tracks who is in which
  bed in runtime state, publishes it through `serialize()` (e.g. `{v:1, in:{host:[x,z]|null,
  guest:...}}`) so the guest UI can show "1/2". If the guest drops (`ctx.other` -> null), clear
  its bed slot.

**Locking player and camera**
- Movement: `movePlayer(dt, input)` `game.js:914`, called `movePlayer(dt, running && !dialog)`
  at `game.js:1072` where `dialog = uiBlocked()` (`game.js:274`: open `<dialog>` or survival UI).
  `ctx.uiOpen()` exposes it. There is **no generic "seated" lock**; sailing steering
  (`sailing-world.js:228-309`) only overrides heading, not movement.
- Options for v1 without core edits: (1) every frame in `afterMove(physics, dt)` (content hook,
  `game.js:924`) pin `physics.x/z/y` to the bed pose and zero `vx/vz/vy` (islands already moves
  the player there); (2) a tiny game.js hook `content.busy()` that turns `input` off. Look
  (yaw/pitch, `game.js:568`) stays free, which is fine and cozy. Camera height comes from
  `physics.y` (`game.js:956`), so lowering `physics.y` to just above the mattress gives a
  "lying down" view; restore on get-up.

**Fade overlay**
- No existing black-fade element. Closest: `underwater-fx.js` fullscreen tint overlay (:1-2) and
  DOM-injected UI in `diving-ui.js:48-60` (style tag + divs). A sleep fade should be a module-
  owned fixed `<div>` (`pointer-events:none`, opacity transition ~0.8 s), created lazily, removed
  in `dispose()`; respect `prefers-reduced-motion` with a quicker cross-fade.

## (c) Risks

- **Save compat**: new `world.ext.sleep` is optional; `load(undefined)` = nobody in bed. In-bed
  state should be runtime only (never saved), so a reload never starts in bed. Old builds drop
  unknown decor (`game.js:154`) and reset bags containing unknown kinds (content-items.js:4),
  so loading a new save in an old build loses beds: acceptable and already true for `research`.
- **Co-op**: guest on an older build joining a new host drops the `bed` decor from its view and
  never sends sleep actions; host must not wait forever. Rule: if the guest has not sent a
  sleep action / its build lacks the module, treat it as "not sleeping" and show the host
  "Waiting for your brother" (no auto-skip). Clock jump arrives via existing ext snap
  (`daynight.js:540`), but guests also need the fade: drive it from the replicated sleep state
  (e.g. a `skips` counter that increments on each skip) instead of an emit, so a dropped
  message cannot leave a guest's screen black. Guard against double skips (only skip when the
  current phase is night; after the jump it is morning, so a repeat request no-ops).
- **Things the skip does not fast-forward**: watering/palm growth ticks in real seconds
  (`game.js:1090`), sailing drift, cooking timers. Fine for cozy; state it in the spec.
- **Pointer lock**: lying down must not release pointer lock (no dialog). If any UI is opened
  while in bed, get up. Fade div must be `pointer-events:none` so clicks still re-lock.
- **Phone / no-lock mode**: there are no touch controls in `dist/` (no touchstart handlers);
  the fallback is mouse drag mode (`lockFallback`, `game.js:246`). E still works there via
  `currentAim()` (`game.js:595-599`), so beds work as long as the prompt and get-up key are E.
- **Opt-out of day/night** (`?daynight=off`, `daynight.js:251-256`): phase is pinned at day, so
  beds should say "It is always day here" instead of skipping.
- **Blocking**: a bed with `BLOCK_RADIUS ~.5` must not trap the player when getting up; place
  them back at the tile edge facing open floor.
- **Tests**: follow `tests/storage-research.test.mjs` / `tests/daynight.test.mjs` stub-ctx style:
  lie/up actions, all-in-bed check with and without `ctx.other`, skip lands on next morning,
  daytime refusal, `load(undefined)` and garbage data.
