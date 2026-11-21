# Shark Bait research

Goal: a craftable snack you drop in the water so the shark goes off to eat it and leaves the raft (and swimmers)
alone for a while. Line numbers are from branch `claude/loop-features-202611210949`.

## 1. The mechanic in Raft (reference only, we make our own take)
- **Recipe flavour.** A few raw fish bundled together with rope. It is an early-game crafted consumable, so it is cheap.
  (From memory: about two raw fish and one rope. We could not check the exact counts against a source we can cite.)
- **Deployment.** You put it on the hotbar, hold it and left-click to **throw** it into the sea. It floats where it lands.
  The shark leaves the raft, swims to the bait and nibbles at it. While it eats, it does not bite foundations or players.
- **Duration.** The distraction lasts a limited time, roughly a minute or two (not verified). Then the bait is gone and
  the shark goes back to normal behaviour. Its next attack comes on the usual schedule.
- **Stacking.** The item stacks in the bag like other crafted items. As far as we know, throwing several does not add
  their durations together: the shark eats one bait at a time. The usual tactic is to throw bait just before
  you swim or dive, or to buy time for repairs. It is a tool for avoiding danger, not a weapon.
- **What we keep:** a cheap consumable, one snack at a time, a visible float, and a shark that is visibly busy. We add no
  new danger, and an item is never wasted for nothing.

## 2. Little Raft's shark today
**Pure sim (`dist/shark.js`).**
- Constants are at shark.js:20-26: `ATTACK_EVERY 300` s, `BITE_EVERY 2`, `BITE_DMG 20`, `REPEL 15`, `HUNT_RANGE 25`, `HUNT_LOSE 32`,
  `PLAYER_BITE 30`, `RESPAWN 180`, `FLEE_TIME 6` and `RING_MARGIN 6`.
- The states are `circle`, `approach`, `bite`, `flee`, `hunt` and `dead` (shark.js:28).
- `createSharkState` (shark.js:107) holds the runtime fields `timer`, `hasTarget`/`tx,tz,nx,nz`, `prey`, `lunge`, `stateT` and others.
- `step(s, dt, world, env)` (shark.js:202) is the whole brain:
  - Dead: it floats, then respawns after looting (209-229).
  - Not fleeing or hunting: any swimmer within 25 m switches it to `hunt` (231-234).
  - `circle`: it follows the ring and counts `timer` down, then calls `startAttack` (236-241).
  - `approach`: it swims in three legs to the bite spot (242-256).
  - `bite`: it calls `damageTile` every 2 s, gives one `warn`, and flees when the tile breaks (257-270).
  - `hunt`: it lunges for 30 damage every 3.5 s and drops the swimmer beyond 32 m (271-278).
  - `flee`: it swims out for 6 s (279-284).
  - `under` (286) makes it dive under the deck.
- `env` carries `preys`, `ringR`, `rnd` and `hooks{bite,broke,hurt,warn,respawn}` (comment at 200-201). This is the natural place to pass a lure in.
- `endAttack` (shark.js:136) resets `timer = ATTACK_EVERY`. `flee()` (137) calls it.
- `hit()` (shark.js:152) flees after 15 damage in one attack.
- **Save:** `cleanShark` (shark.js:122) and `saveShark` (shark.js:130) write `{v:1, hp, timer, dead, looted, respawn}`. Unknown keys are dropped.
- **Co-op pose:** `STATE_CODE` (shark.js:309) runs from `circle:0` to `gone:6`.
  - `net()` (shark.js:440) packs the 7-number pose `[x,z,heading,code,depth,anim,hp]`.
  - `applyNet` (shark.js:447) needs `length >= 7` and **clamps `code` to 0..6**. Extra trailing numbers are ignored by old guests.
- **View:** `showPose` (shark.js:368) pitches the head up for code `bite` and sways for `bite`/`hunt` with `anim`.
  - The host maps `sim.state` to a code in `update()` (shark.js:395). A new sim state must map to an existing code there.

**Engine wiring (`dist/game.js`).**
- The import is at game.js:69. `initShark()` (game.js:528-545) builds the host object.
  - `preys` gives slot 0 = local, slot 1 = the guest, and only on the host.
  - `onBite`/`onBroke`/`onWarn` emit `{kind:'shark', ...}` to `'all'`. `onHurt` sends the bite to the guest.
  - `sendHit` sends the guest action `shark:hit`.
  - Precedent for reaching a content module: `onBroke` calls `content.mods.find(m => m.name === 'storage')?.dropTile` (game.js:539).
- `update(dt, elapsed, running)` runs each frame (game.js:1835). Only host and solo simulate: `isGuest()` at shark.js:389, branch at 394.
- Host actions:
  - `shark:loot` (game.js:1368-1376) checks distance and the bag, then makes an all-or-nothing scratch Bag and commits it.
  - `shark:hit` (game.js:1377-1381) is rate-limited to 250 ms per actor and allows up to 6 m.
- Saving: `syncWorldInventories` writes `world.shark = shark.save()` (game.js:1551).
  - `cleanWorld`/`copyWorld` run `cleanShark` (game.js:239, 247), and the default world is built at game.js:205.
- Co-op: `hostState()` (game.js:1797-1800) sends `ext: content.serialize()` and `shark: shark.net().slice()`.
  - The guest applies `content.load(w.ext,'net')` and then `shark.applyNet(data.shark)` (game.js:2156-2157).
  - Back on its own raft, the guest calls `shark.clearNet(); shark.load(world.shark)` (game.js:2066).
- QA: `raftDebug.shark` (game.js:2306-2322) exposes `state`, `timer`, `setTimer`, `forceAttack` and more. Tests are in `tests/shark.test.mjs` (167 lines).
- The ring keeps clear of the dolphin/turtle lane through `circler()` (shark.js:339-346).

**Hooks, items, recipes.**
- Registry: `dist/content.js`, documented in `docs/features/content-hooks.md`.
  - Modules can implement `use(aim, kind)` (left click with an item no engine tool handles), `action(a, actor, bag)` (host),
    `serialize`/`load(data, 'save'|'net'|'restore')` (stored in `world.ext[name]` and sent about 8 times a second), `prompt`, `update` and `claims`.
  - `peer(name)` lets one module find another (content.js:127). There is **no** shark accessor in `contentCtx` (game.js:454-474).
- Left-click order is in `useSelected` (game.js:1443-1476): instruments, paddle, then spear/hammer/armor, then `content.use` (1451),
  then `isEdible` (1452), then decor placement (1461), then the fishing rod.
  - The fishing rod's water check is the model for "point at water": not a tile, and within `FISH_REACH = 26` (game.js:101, 1470).
  - Because `content.use` runs first, a bait kind must **not** be edible, or its click would be ambiguous. `fish` and `sharkmeat` are both foods (items.js:118-121).
- Items:
  - Catalogue entries `item(id, name, category, {recipe: hand({...}, n), unlock: discover(...)})` live in `dist/items.js`
    (helpers at items.js:56-73; `fishtrap` at 273 and `skyrocket` at 286 are recent precedents).
  - Each entry also needs a `CATEGORY_OF` line (craft-book.js:15-50, e.g. `fishtrap: 'survival'` at 31), a desc/use line (craft-book.js:~108-178),
    and an SVG icon in `ITEM_ICONS` (item-svg.js:10).
  - If it shows in the hand, add a held model through `MODEL_KINDS` (held-items.js:312).
  - Content-only kinds can go in `dist/content-items.js` instead. They are spread into ITEM_INFO/RECIPES at inventory-state.js:33, 83.
- Existing bait precedent:
  - The fish trap (`dist/fish-trap.js`) puts `world.ext.fishtrap` charges on a decor tile: `BAIT_PER 5`, `BAIT_SEC 150` (fish-trap.js:9).
  - The host action `fishtrap.bait` takes 1 seaweed and refuses double-baiting with a notice (fish-trap.js:311-317).
  - An old-host guard is `OLD_HOST` plus `oldHost()` (fish-trap.js:12, 164, 274, 285).
- Throwing: the hook is a ballistic `HookCast` from charge (game.js:1477-1497). It is tied to the `hook` tool role and too heavy to reuse here.
  The nets show how to place something "in the water beside the edge" (`netSpot`, game.js:1116).
- Hand-held host actions with reach checks follow the pattern of `fitArmor`/`repairTile` (spear-repair-hooks.js:123-160).

## 3. Integration points and risks
**Recommended split.** The lure lives in the shark sim, because the sim is pure, testable and already saved and synced.
The engine handles the item action next to `shark:loot`.
1. `shark.js` `step()` (202): read `env.lure` as `{x, z, t}`, with `t` = seconds left.
   - While `t > 0` and not dead, the sim enters a new state `snack`. Check this before the prey check at 231, so bait beats hunting.
   - In `snack` it steers to about 1.2 m from the lure, then nibbles with `anim` pulses.
   - `t` counts down **only while the shark is within about 3 m**. A dead shark leaves the bait floating, so nothing is wasted.
   - When `t` reaches 0, call `endAttack(s)` (136), which resets the timer to 300 s, then go to `circle`.
   - If it was mid-attack, drop the target (`hasTarget=false`).
   - `hit()` while snacking should behave as it does today (flee, then come back to the bait).
2. `createSharkState` (107), `cleanShark` (122) and `saveShark` (130): add `bait: {x, z, t}`, clamped with `t` ≤ 180 and |x|,|z| ≤ 200, and keep `v:1`.
   - **Save compat:** old saves have no `bait`, which means none. Old builds' `cleanShark` drops it, so the bait is lost and that is acceptable.
3. `update()` (shark.js:395): map `snack` to `STATE_CODE.bite` (2), or to `circle` (0). **Never add code 7.**
   Old guests clamp it to 6, which is "gone", and the shark would vanish (shark.js:449).
4. `net()` (440): append `[bx, bz, bt]` after index 6.
   - Old guests ignore the extra numbers.
   - New guests with an old host get length 7, so they show no float and set `hostHasBait = false`.
   - The ring buffer `pose` (shark.js:332) grows to 10. Keep it allocation-free.
5. `game.js` `applyAction` after `shark:hit` (1381): add `shark:bait {x, z}`.
   - Host checks: numbers are finite; the point is not a tile and not over the raft (`overRaft`-style check, not exported yet);
     it is within about 12 m of the actor (guest slack +1.5); the bag holds 1 bait; no bait is active.
   - Then remove the item, set `sim.bait`, and `emit({kind:'shark', text:'...'}, 'all')`. The `sharkEffect` text path (game.js:550) needs no protocol change.
6. `useSelected` (game.js:1443): add a branch for the bait kind **before** `content.use` (1451), modelled on the fishing-rod water check (1470).
   It shows the notice "Point at the water to drop it" and needs a guest old-host notice.
   `updateContext()` (~game.js:785) can add a prompt such as "Click to toss the snack".
7. View: one small float mesh inside `createShark` (pooled, no shadows), shown while `bait.t > 0` (host: sim; guest: pose 7-9).
8. Debug and tests: add `raftDebug.shark.bait` and `setBait(x, z, t)`. Add pure-sim cases to `tests/shark.test.mjs`:
   - snack blocks `startAttack`
   - `t` drains only near the lure
   - the timer is reset afterwards
   - hunt is suppressed
   - `cleanShark` handles junk bait

**Risks.**
- **Unknown bag kind on old builds.** content-items.js:4 says older builds reset a bag holding an unknown kind. The same risk exists for every new item; it is a known, accepted trade-off.
- **Mixed versions in co-op.**
  - Old host with a new guest: the guest's `shark:bait` action is ignored and the guest's predicted bag gets corrected by the next snapshot. Detect the old host by pose length and refuse locally.
  - New host with an old guest: the guest sees the shark swim off but no float. That is harmless.
- **Sailing.** The shark's frame is raft-local (tiles × 2 m around the origin), so a dropped float stays beside the raft while sailing. Either accept it as "tied on a line" (the recommendation) or let it drift away while sailing.
- **The circler lane.** The lure may sit inside the dolphin/turtle ring (`circler`, shark.js:339). To avoid overlap, clamp the bait point to at least 2 m off the raft and at most `ext + 10`.
- **Bite already in progress.** A `warn` notice has already fired. Add a friendly follow-up: "The shark swam off for a snack".
- **Stacking.** If a second toss were allowed while a bait is active, it would waste the item. Refuse it on the host with a notice, the way `fishtrap.bait` does (fish-trap.js:313).
- **Guest prediction.** Do not remove the item locally on the guest before the host confirms. The bag sync already handles this.

## 4. Recommended original take: "Snack Float"
- **Item:** `snackfloat` ("Snack Float"), category `'refined'` (not `food`, so it is never edible), stacks to 10, and sits on the Survival tab.
  - Tip text: *"A little seaweed parcel of fish tied to a cork. Toss it in the water and the shark will happily nibble it instead of your raft."*
- **Recipe:** `hand({ fish: 2, seaweed: 1, rope: 1 })`, which makes 1, unlocked by `discover('fish', 'seaweed')`.
  - No shark meat: feeding the shark shark is grim, and the friendly tone matters.
  - Seaweed already reads as "bait" from the fish trap.
- **Deployment UX:**
  - Hold the item and left-click the water within 12 m. It plops in with a small splash (`sharkFx.splash`) and shows a bobbing cork-and-parcel float.
  - All players get the notice "The shark swam off for a snack". The prompt while aiming at water reads "Click to toss a Snack Float".
  - Aiming at the deck gives "Point at the water to toss it". A second toss while one is active gives "The shark is still snacking". The item is kept in both cases.
- **Duration:**
  - 120 s of nibbling, counted only while the shark is at the float. A shark that is fleeing, dead or respawning simply arrives later.
  - When it finishes, the attack timer resets to the full 300 s, so one float buys about 7 calm minutes.
  - While snacking it ignores swimmers too, which makes the float a "safe swim" tool before diving.
  - Spear hits still work (it flees, then comes back to finish).
- **Stacking:** one active float at a time. The bag stack is only for carrying spares.
- **Cues:** head-up nibble pose (code `bite`) with small splashes every 2 s. There is no raft shake, because shake comes only from `sharkEffect` tile events.
  The float shrinks as `t` drains. A soft "gulp" plays at the end.
- **Optional achievement:** "Snack Time" for tossing the first float, via `award({kind:'snackfloat'})` (pattern in fireworks research §2).
