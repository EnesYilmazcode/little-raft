# Diving gear: research

Status: research only, no code changed. The base is the diving lane (`dist/diving.js`, `seafloor.js`, `underwater-fx.js`,
`diving-ui.js`, spec in `docs/cloud/diving-spec.md`), the kiln (`ingot` Metal Bar, `glass` Glass Pane) and puffhen `feather`.

## What exists today (verified)
- There is no equipment system. `grep -i "equip|gear"` over `dist/` finds only tooltip text (`craft-book.js:45,62`) and a
  progression goal name (`items.js:250`). `docs/cloud/progression-design.md` has no gear tier (only "Cosy, well-equipped raft", line 160).
- The Bag (`inventory-state.js:157`) is a flat array that must be exactly `SLOT_COUNT = 28` long (`inventory-state.js:6`,
  enforced at `:178`). The first `HOTBAR_SIZE` slots are the hotbar. There is no slot type and no "worn" flag.
- A precedent already exists. The kiln's **Line Sinker** works while it is anywhere in the bag:
  `bag.count('sinker') > 0` at `game.js:851` (inside a merge conflict block right now). Diving gear can use the same "carry it to use it" rule.
- Oxygen, swimming and gathering all happen on the local client (`diving.move` runs on the local `physics`; only the
  `gather` action goes to the host, `game.js:926`). So gear effects are naturally **per player** and never need host sync.

## Genre conventions (survival raft games)
- Fins: faster swimming. Air tank: a longer dive, usually built in tiers. Goggles or a mask: clearer, brighter water.
  A backpack: more slots. A headlamp: deep or dark water. Gear sits in separate equipment slots on a paper-doll panel.
- Gear usually wears down, breaks, and has to be re-crafted. Tanks are refilled at a station.
- **Our cozy take:** gear never breaks and needs no refills, and you can always dive without it. Gear only makes a dive
  longer, faster or clearer. No new HUD. No backpack, because more slots would change `SLOT_COUNT` (see below).

## Gear set (original names; recipes use existing ids only)
| id | Name | Recipe (`CONTENT_RECIPES`) | Effect |
|---|---|---|---|
| `fins` | Puff-Feather Fins | `feather: 3, plastic: 2, rope: 1` | swim speed x1.3 (normal and Shift) |
| `airjug` | Breath Jug | `plastic: 3, ingot: 1, rope: 1` | oxygen lasts 45 s -> 75 s |
| `goggles` | Seaglass Goggles | `glass: 2, rope: 1, leaf: 1` | water fog 30 m -> 46 m, lighter vignette |
| `scraper` | Tide Scraper | `ingot: 1, scrap: 2, wood: 1` | gather time x0.6, so metal ore takes 0.84 s instead of 1.4 s |

- Each one is `item(id, name, icon, false)` with `maxStack: 1` (write it out like `cup`, because the `item()` helper hard-codes
  `S`). Holding extra copies does nothing. The effects do not grow with count.
- None of the four is a tool (`tool:false`), so it has no durability and `TOOL_KINDS` stays the same.
- Recipe costs: 6-7 materials each. They need the kiln and puffhens, so gear comes in the mid game.
- Icons: add `icon-fins`, `icon-airjug`, `icon-goggles` and `icon-scraper` to `dist/icons.svg` and to `SPRITES` in
  `dist/survival-ui.js`. Add a desc/use line for each in `craft-book.js`, e.g. "Works while it is in your bag."

## How to equip it: options
**A. Counts while it is anywhere in the bag (recommended).**
- No UI change and no new snapshot shape. Same rule as the Line Sinker, so players already know it.
- The tooltip and craft-book line say "Works from your bag". When you dive, a small icon row next to the O2 pill shows what is active.
- Cost: gear takes up a bag slot. With 28 slots that is fine.
- Back-compat: the new kinds go into `CONTENT_ITEMS`, and `registerBagKinds` (`items.js:401`) keeps them through
  `migrateSnapshot`. An *older* build drops unknown kinds when it loads (`resolveKind` returns null, `items.js:410`), and
  a pre-migrate build rejects the whole bag (`content-items.js:4`). Every new item has this risk; it is not specific to gear.

**B. A dedicated gear row (4 extra slots).**
- Changes `SLOT_COUNT` from 28 to 32. `Bag` throws on any other length (`inventory-state.js:178`). On load that is caught by
  `snapBag` -> `Bag.salvage` (`game.js:131`), which still loses data.
- In co-op between mixed builds, every host `state.bag` snapshot fails validation.
- Old saves would need a migration. `migrateSnapshot` sends slot indexes >= SLOT_COUNT to overflow (`items.js:446`).
- It also needs new drag/drop rules in `survival-ui.js`, plus "only gear goes here" checks in the host move action.
- Rejected for now. A **worn list in the module's own state** (`world.ext.divegear = {host:[...], guest:[...]}`)
  avoids touching the Bag, but it is still a second inventory, with more UI and more sync. Keep it as a later option.

## Code knobs (current values, file:line)
| Effect | Knob | Where |
|---|---|---|
| Oxygen duration | `DIVE.OXY_SECONDS: 45` | `diving.js:20`, used in `stepOxygen` `diving.js:57` (drain and refill) |
| Dive start threshold | `oxygen >= 0.3` | `diving.js:203` |
| Low-air warning | `oxygen < 0.25` | `diving.js:289` |
| Swim speed | `DIVE.SPEED 2.4`, `DIVE.FAST 3.4` | `diving.js:20`, read at `diving.js:113` |
| Speed cap | `if (m > DIVE.FAST)` | `diving.js:119` (fins must scale this too, or Shift gains nothing) |
| Gather time | `DIVE.GATHER_SECONDS 1.0`, `GATHER_SLOW.metalore 1.4` | `diving.js:21`, applied at `diving.js:259` |
| Fog distance | `FOG_NEAR = 1, FOG_FAR = 30` | `underwater-fx.js:17`; per frame `fog.far = FOG_FAR - k*10` at `:174` |
| Ceiling fade | `uFar = fog.far * 0.7` | `underwater-fx.js:179` (follows fog.far automatically) |
| Vignette | `vig * (0.45 + 0.12*uLow)` | `underwater-fx.js:58` (overlay shader `OV_FS`) |
| Host reach check | `DIVE.REACH + 1.5` | `game.js:929` (no gear changes reach, so this stays) |

`DIVE` is frozen, so gear cannot patch it from outside. Small hooks are needed instead.

## Minimal hooks
1. Pure core `dist/diving-gear-core.js`, with no imports:
   `GEAR = {fins:{speed:1.3}, airjug:{oxy:75/45}, goggles:{fog:46/30, vig:0.6}, scraper:{gather:0.6}}` and
   `gearMods(countFn, out)`, which fills a reused `{speed, oxy, fog, vig, gather, ids}` object (all 1, ids empty, with no gear).
   Test it in `tests/diving-gear.test.mjs`: values, no allocation, a count above 1 has no extra effect, a missing bag gives the defaults.
2. `diving.js`:
   - New option `createDiving({..., getGear = () => null})`.
   - `stepOxygen(o, dt, underwater, secs = DIVE.OXY_SECONDS)` (keeps the old signature).
   - `DiveBody.step` reads `env.speedMul` and `env.oxyMul` (default 1): line 104 `stepOxygen(..., DIVE.OXY_SECONDS*oxyMul)`,
     line 113 `speed *= speedMul`, line 119 cap `DIVE.FAST*speedMul`.
   - `move()` sets `env.speedMul` and `env.oxyMul` from `getGear()` at line 208. `update()` line 286 passes the same seconds.
   - `updateGather` line 259 divides by `gather`.
   - `fxState.fogMul` and `fxState.vigMul` are set at line 291.
   - About 10 changed lines; defaults keep today's behaviour, so existing diving tests still pass.
3. `underwater-fx.js`:
   - `update(dt, {..., fogMul = 1, vigMul = 1})`.
   - `fog.far = (FOG_FAR - k*10) * fogMul` (`:174`).
   - New uniform `uVig` in `OV_FS` that multiplies the `vig` term at `:57-58`.
4. `game.js`, one anchored edit at line 429 (`// diving gear hook`):
   `getGear: () => gearMods(k => localBag().count(k), gearScratch)`.
   Without a registry hook this is the one unavoidable touch, because diving is not a content module.
5. Content registry, everything else: `dist/diving-gear.js` with `createDivingGear(ctx)` appended to `FEATURES`. It holds:
   - The items and recipes in `content-items.js`.
   - Gear icon chips next to the O2 pill, shown on the `raft:underwater` window event (no change in `diving-ui.js`).
   - The goggles mask overlay, the avatar trinkets, and `debug.mods()` for QA.
   - It needs no `serialize`, `load` or `action`: the gear lives in the Bag, so it saves and syncs like any other item.

## Wearing visuals
- **Goggles (first person):** a thin DOM mask frame (`pointer-events:none`, two rounded lenses, a soft dark rim) that fades in
  while `underwater` is true, plus the lighter shader vignette. No 3D viewmodel, so `hands.js` stays the same.
  Optional: a faint warm tint (`uTint` lerp) so the water looks "clearer" and not darker.
- **Fins:** two small fin blades at the bottom edge of the screen that flap with forward input while diving. Use a CSS
  transform keyed to `|vx,vz|` from `raftDebug.state.dive`, not a mesh.
- **Breath Jug:** the O2 pill bubble icon gets a little jug badge. Bubbles stay the same.

## Co-op
- Effects are per player, read from that player's own bag (`localBag()`, `game.js:332`). The host bag is used on the host.
  The guest uses `remoteBag`, which the host syncs in `state.bag`. No new messages, and nothing to cheat, because gear only changes local feel.
- Avatar gear (optional, phase 2): add `gear: ['goggles', ...]` to `pose()` (`game.js:1268`). Older peers ignore the unknown field.
  On the remote avatar, attach a goggles strap mesh to the head pivot and fins to the legs. They have to be added *after*
  `coop-avatar.js` bakes its meshes (`:266`), as separate children toggled by `visible`.
  The guest cannot see the host's bag, which is why the gear list goes in the pose.
- Host check is unchanged: `gather` still checks `DIVE.REACH + 1.5`. A faster scraper sends a few more gather actions,
  but they are rate-limited by `pending`, `REGROW` and `gatheredIds`.

## Save
- Gear items live in the Bag snapshot, so there are no new save keys. Old saves load unchanged: they have no gear, so every multiplier is 1.
- Dive state `capture()` (`diving.js:322`) stores `oxygen` as a 0..1 fraction (plus `regrow`), so a save made with the jug loads fine without it.
- QA: `npm test` (core tests); `shoot.py` with a seeded bag holding all four; check `raftDebug.content.divegear.mods()`, a timed dive after `swimAt`, `raftDebug.state.dive.gather`.
