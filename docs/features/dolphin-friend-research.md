# Dolphin friend: research note

Feature: toss raw fish to the wild dolphin that already visits the raft. After a few fish it becomes the raft's friend:
it plays near the raft, swims beside a player in the water, comes when called with a conch and now and then pushes
floating debris toward the deck. It can be named and patted. No damage, never leaves, never needs feeding.
Line numbers are for the tree on branch `claude/loop-features-202611210911` (content.js was being merged while this was written; re-grep before editing).

## 1. Genre conventions (companion animals)
- **Earn trust with food, in steps.** Feed several times, with a visible meter (hearts or a bar). The step where it
  "chooses you" is a short moment (a notice, a jump, a name prompt).
- **It never goes away and never needs upkeep.** Cozy games skip hunger and loyalty decay: once bonded, it stays bonded.
- **Small help, never essential.** Companions fetch small loot, point to points of interest or give a small buff
  while close. Anything that matters to progress stays the player's job.
- **Readable states.** Idle play, follow, "look over here" and "come when called" each need their own silhouette or
  motion. A whistle or call item is a common convenience.
- **A name gives attachment.** Players can rename it, and the name shows in prompts and notices.

## 2. Our design (cozy, original)
| Genre idea | Little Raft version |
|---|---|
| Tame with food | Hold **Fish** (raw), aim at a visiting dolphin, press E (toss). 3 fish, 8 s apart. Hearts pop over it |
| Bonding moment | 3rd fish: notice "`Name` wants to stay with your raft!" plus a big leap, then the name dialog opens |
| Companion idle | Loops close to the raft (r 6–9 m) with the wildlife leap/porpoise rhythm. A chirp on each leap |
| Follow | **Escort**: it swims 1.8 m beside a swimmer or Driftboard rider within 25 m of the raft |
| Buff | While escorted and within 4 m: swim speed ×1.15 (stacks with fins and the cookpot buff) |
| Whistle | **Conch Call** item (2 Bright Shell + 1 rope). Left click calls it to you for 20 s (30 s cooldown) |
| Fetch | About every 2 min it noses one nearby floating item toward the raft (12 s push) |
| Point the way | Stretch: if a signal cache is out (`world.signal.cache`), one beat in five it swims out 14 m toward it and leaps 3 times |
| Petting | E near it (≤ 4 m, in the water or at the deck edge): pat, ♥ +1 (60 s cooldown, max 10). Otherwise E = Name |

## 3. Befriending flow
1. A wild visit is any wildlife circler slot where `kind === 'dolphin'` (`wildlife.js:229-241` `circlerVisit`, about 70%
   of 180 s slots, so one every ~4 min). The friend module reads the live pose with
   `ctx.content.mods.find(m => m.name === 'wildlife').circler` (getter `wildlife.js:574`; `ctx.content` is at `game.js:431`;
   the shark reads it the same way, `game.js:482`, `:490`). That gives the wildlife module's own clock, so no copy is needed.
2. Prompt (`prompt(aim)`): a ray-sphere test against the circler pose (r 1.6 m, reach 18 m). The prompt reads "E Toss fish ·
   ♥ n/3" while holding `fish`, or "A dolphin! Bring a fish" otherwise. E goes through `interact()`, not a left click,
   because a left click with fish eats it (`game.js:1256-1259` runs `isEdible` before `content.use` at `:1279`).
3. The guest calls `ctx.action({kind:'dolphin.toss'})` and the host validates it. The host's wildlife circler must be a dolphin,
   with the actor's `ctx.physics`/`ctx.other` within 18 m + 2 m slack and `tossAt + 8 <= t`. The host takes 1 fish from
   the `actorBag`, sets `pts++` and `pops++` (every client shows hearts on a pops change, copying gull `seenPops`).
4. When `pts === 3` it sets `friend = true`, a default name from `DOLPHIN_NAMES` (seeded), and `seed` = host rnd. The
   rename dialog opens for the actor (an emit `{kind:'dolphin.named?'}` or a local check when `friend` flips).
5. Naming copies gull exactly: lazy `import('./animals-ui.js')` with
   `createAnimalsUI(ctx, {title:'Name your dolphin', kind:'dolphin.name', label:'Dolphin name', domId:'lrDolphin'})`
   (`animals-ui.js:18`, gull usage `gull.js:536-547`). The host checks it with `cleanName` (`animals-core.js:38`, NAME_MAX 14).

## 4. Behaviours (4 cheap ones plus 1 stretch)
- **Play loop (default):** a closed-form orbit `a = a0 + dir*w*t`, radius `7 + 1.5 sin(0.07t)` plus `pushOut(raftExtent)`
  (`wildlife.js:21`, `:42-50`). The vertical motion reuses the dolphin rhythm: export `dolphinMotion` (`wildlife.js:255-266`,
  currently private) or copy its 10 lines. Every 4th beat is a "show": 3 leaps in a row on a tight 5 m arc in front of the deck.
- **Escort:** mode `esc` = 'host'|'guest'|'' is decided **by the host** once per second (who is `swimming`, or on a board
  (`paddleboard.riding()` `paddleboard.js:401` for the local player, and the guest's flag is sent in its `move`; or just
  "pose more than 3 m off any tile and below the deck height"), within 25 m. The host stores it in the slice (`r++` on change). Each client
  then aims at its own view of that player (`ctx.physics` or `ctx.other`, like gull `followTarget` `gull.js:355-365`),
  offset 1.8 m to the right and 0.5 m ahead, with an allocation-free critically damped spring (k 3/s). Leaps every 3 s.
- **Conch call:** `use(aim,'conch')` (`game.js:1279`, conch is not edible) sends `{kind:'dolphin.call'}`. The host sets
  `callAt = t, callWho = actor` and escort is forced to that player for 20 s, even on deck (it waits 2 m off the
  nearest edge). A local `ctx.play('splash')` plays at once, then a notice "`Name` is on the way".
- **Debris nudge (host-side world change):** every `NUDGE_EVERY = 120 s` (seeded jitter), the host picks the nearest
  `world.items` entry at 8–25 m from the raft centre (`raftCentre`, `signal.js:47`). It skips `type 'cache'`,
  `'bottle'` and tokens held by a hook (the game does not expose `heldTokens`, so skip any item within 1 m of either
  player's hook, or accept the rare tug-of-war). It sets `nudge = {tok, at}`. For 12 s `update()` on the host moves
  that item `0.6 m/s` toward the raft centre (`it.x/it.z += …`) and stops once it is within `r + 3` m.
  The base drift in `updateItems` (`game.js:1491-1506`) still adds on top. Positions reach the guest for free: `hostState()`
  sends `items:world.items` every 120 ms (`game.js:1583`, `:1631`), and the guest dead-reckons and eases meshes within 3 m (`:1506`, `:1513`).
  The dolphin pose during a nudge = the item's synced x/z + 0.9 m on the far side from the raft (same on both clients).
- **Point the way (stretch):** pure function of the synced `world.signal.cache` (`signal.js:23-34`, sent in hostState).
  A 'point' beat swims to `raft + 14 m * dir(cache)`, leaps 3× and swims back. `islandNow()` (`islands.js:41`) could point at an island.

Mode per beat: `BEAT = 12 s`, `modeAt(seed, t)` hashed like gull `modeAt` (`gull.js:98-103`). Priority: call > nudge >
escort > point > show > loop. A switch blends over 1.5 s (gull `BLEND`) by lerping the old and new pose.

## 5. Motion approach
- Rendering: one `Mesh(dolphinGeometry(T))` (`wildlife-models.js:93-94`, exported) with its own Lambert vertexColors
  material tinted `#d8ecff` and scale 0.92, so the friend reads apart from wild visitors. 3 heart meshes from
  `heartGeometry` (`animals-models.js:87`). Pose: `matrix.compose` with `matrixAutoUpdate=false`, like `updateCircler`
  (`wildlife.js:514-522`; raft frame == world XZ because the raft group sits at the origin, `game.js` init). Water height comes from `ocean.getHeight`.
- Everything except the escort spring is closed-form in (seed, t), so there is **no position stream**. The spring only
  smooths the follow target locally (cosmetic). Host validation of pats uses a 2 m slack (gull `HOST_SLACK`).
- The wild dolphin keeps visiting after befriending. Optionally hide it while the friend is out (then skip `dolphin` slots in
  `updateCircler` through a flag on the wildlife module). Not needed for v1.
- Chirp: there is no audio event yet (`audio.js:23-24` EVENTS). Use `ctx.note` (instruments synth, `game.js:431`) for 2 quick high notes,
  or add a `'chirp'` event in audio.js (small edit). Play it locally on a leap start when within 30 m.

## 6. Swim boost hook
- Surface swim speed = `SWIM_SPEED * MOVE_MUL.swim` (`player-physics.js:41`, `:146`). The cookpot **overwrites**
  `MOVE_MUL.swim` every update (`cookpot.js:173`). `movePlayer` (`game.js:1601`) runs before `content.update` (`:1611`),
  so a module after cookpot in FEATURES could do `MOVE_MUL.swim *= 1.15` in update. The FEATURES comment says
  "cookpot stays last", so the cleaner fix is a 1-line change in cookpot: `MOVE_MUL.swim = mods.swim * swimBonus()`. The bonus comes from an exported
  mutable `SWIM_BONUS = {friend:1}` in `player-physics.js` or the dolphin module.
- Underwater: add `diveMods(m) { if (boost) m.swim *= 1.15; }` (hook `content.js:85`, `:113`; diving clamps 0.5–2 at `diving.js:194-195`).
- Driftboard: speed comes from `BOARD.CRUISE` (frozen, `paddleboard-core.js:7-21`, `stepRide :194`). A boost would
  need a mutable multiplier in `stepRide`, so leave it for later. v1 gives board riders the escort visuals only.

## 7. Co-op sync
- Slice `world.ext.dolphin`, host-authoritative, actions `dolphin.toss|pat|name|call`. Host `serialize()` sends
  `{v,r,t,seed,pts,tossAt,friend,name,hearts,patAt,callAt,callWho,esc,nudge,pops}`, cached by `r` (gull `:580-589`).
- Clock: host `st.t += dt` while `ctx.running`; guest `clock += dt`, and `snap()` eases 15% per message with a hard snap past 2 s
  (`gull.js:590-594`). The befriending check uses the **wildlife** clock (its own host-offset sync, `wildlife.js:546-560`).
- Guests never touch `world.items`. Only the host moves the nudged item. A guest on an old host gets the `OLD_HOST` text
  (`gull.js:15`, `hostHasGull` pattern).

## 8. Save
- `cleanDolphin(v)`: junk → defaults, ints clamped, `tossAt/patAt/callAt` clamped to `<= t` (gull `:65-86`),
  `name` via `cleanName`, a friend without a name gets a default, `nudge` dropped on load (a transient effect), and `callWho` must be in {'host','guest'}.
  Old saves call `load(undefined)` → defaults (not befriended).
- Conch item: `CONTENT_ITEMS`/`CONTENT_RECIPES` in `content-items.js` (~:47, :111, near `shell`), icon `icon-conch` in
  `icons.svg` plus `SPRITES` in `survival-ui.js`.

## 9. Integration points
- New `dist/dolphin-core.js` (pure: clean, toss, pat, rename, call, modeAt, pose(st, t, follow, item, out), pickNudge(items, centre)).
- New `dist/dolphin.js` `createDolphin(ctx)` (render, prompt, interact, use, action, update, serialize, load, debug: `befriend()`, `advance(s)`, `call()`, `nudgeNow()`).
- `dist/content.js:27` import plus FEATURES (`:58`), before `createCookpot`. `content-items.js` conch. A 1-line cookpot/MOVE_MUL change (§6).
- Optional `export` of `dolphinMotion` in `wildlife.js:255`. Tests: `tests/dolphin.test.mjs` (clean, 3-fish bond, cooldowns, nudge pick skips cache/bottle, pose determinism).

## 10. Risks
- The nudge fights the hook or the net (`pickNetItem`, `game.js` ~1642), so skip items within 3 m of a net decor or a hook. Keep it slow.
- Two dolphins on screen (wild plus friend) can confuse players. Tint plus name prompt; the hide flag is an option.
- Escort poses differ slightly between clients (each follows its own view of the player). This is cosmetic only, and actions use slack.
