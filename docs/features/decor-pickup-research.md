# Pick up placed items (decor) - research

Goal: holding the hammer and pressing X should take back a placed item, not only building pieces. The
crafted item and anything stored in it go back to the bag. Line refs are for the current raft-master
(`dist/`, build `v3-survival-ae77fa84ac2b`).

## 1. How real Raft does it (brief)

- Hammer remove mode (hold X) works on building pieces and on placeables (storage, grills, purifiers,
  plots and so on). Our RAFT-REFERENCE.md:83 notes that building pieces give back "about half" the cost
  [recall, not verified].
- Storage: per a 2021 Steam thread, removing a storage does not lose its contents. The storage and its
  items go into the inventory, and whatever does not fit is thrown on the deck in front of the player.
  [community source, current version not verified]
- Early builds simply deleted what the hammer removed, and the developer said refunds would come later
  (itch.io devlog comments).
- Our version (our own design): a placeable is a crafted bag item, so we give back **the item itself**
  (a full refund). We are gentler about contents: **refuse when the contents would be lost or not fit**,
  and never spill items onto the deck. Pets and sleeping players also block removal.

## 2. Current Little Raft

**Pieces remove today.** `building.key()` sets `removing` while X is down (dist/building.js:150-155, plus a
blur reset at :159). `update()` picks a piece with `grid.pick` and shows the shared red ghost (:83-93).
On keyup, game.js:1741 calls `building.removeAction()` (building.js:119-122), which sends `{kind:'unpiece',…}`.
The host then runs `building.apply` (building.js:125-146, routed at game.js:1141-1145), which refunds the full
`def.cost` into a scratch Bag and refuses with "Your bag is full". `building.removing` is exposed at :168.
The X branch runs whether or not a free piece is selected. Foundations (`slot:'tile'`) are not removable.
X also works under the controls lane, because game.js:1730 runs before the `controls` early return. There is
no gamepad binding for remove.

**Decor placement.** Decor types: `DECOR_TYPES` (game.js:75) = the base list + `CONTENT_DECOR`
(content-items.js:78) + `PLACEABLE_IDS` (items.js:237). Click → `placementFor` (game.js:973-988, uses
`decorBlock` from build-rules.js:37 for one decor per tile) → `useSelected` (game.js:1256-1261) →
action `{kind:'build', recipe, x, z, rot?}`. The host branch (game.js:1113-1139) checks reach (`BUILD_REACH`
+ `GUEST_REACH_SLACK`), `decorBlock`, `fc.hasGrill` and the player overlap, consumes one `a.recipe` from the
selected slot or the bag, then pushes `{type,x,z,rot?}` and calls `rebuildRaft()` (606-630), `fitShadow` and
`emit build`. The guest receives the decor through `state.world.decor`, and `cleanWorld` keeps only
`{type,x,z,rot}` (game.js:201-207). **Every decor type has a bag item of the same id** (checked against
ITEM_INFO), so the refund is always `{[d.type]:1}`. maxStack is 20, or 5 for the station items.

**Existing removal precedent.** When the shark breaks a tile, `removeTile` (shark.js:70-83) drops the tile's
decor, garden, purifier, tileHp and pieces. game.js:491 `onBroke` then calls `fc.dropTile` and the storage
module's `dropTile` (storage-research.js:384). That path destroys the contents. Ours must return them.

**Decor meshes and picking.** In `rebuildRaft`, each decor is a child of `raft` at `(x*2,.22,z*2)`. Only
watering types get `userData.tileKey` (game.js:613), and `pickWateringDecor` (919-930) ray-casts those.
A red see-through model is available for any type through `ghosts.show(kind, x, y, z, rot, ok=false, t)`
(created at game.js:449, used at :1562).

## 3. Per-tile state keyed by decor tile ("x,z")

| Decor type | Where state lives | Live prune if the decor vanishes? | Undecor rule |
|---|---|---|---|
| crate | `ext.storage.chests[k]`, 12 slots (storage-research.js:80-100) | no (only `dropTile`) | return all slots + crate atomically, else refuse "Bag full" |
| research / researchtable | storage `seen/learned` (global), prog research | n/a | plain refund (knowledge stays) |
| smelter, grill (items.js stations) | prog `stations` Map StationModel {input, output, fuel, progress} (progression-hooks.js:85-99, smelter.js:130-138); saved in localStorage, not world | yes, `syncStations` deletes the station | return input+output items; fuel units and progress are lost → refuse while it is cooking (progress>0), or warn |
| kiln | `ext.kiln.k[k]` queue/tray/fuel (kiln-core.js:48-66) | yes, 1 s prune (kiln.js:103-110) | return queue + tray items; refuse while it is firing |
| palm | `world.garden[k]` {water,grow} (watering.js:64-75) | yes, 1 s `tick` prune | refuse if ripe ("Harvest it first"), else drop the entry. Delete it explicitly so a re-placed planter does not inherit growth |
| purifier | `world.purifiers[k]` {t,ready} | yes, 1 s | refuse if ready ("Take your water first"), else drop |
| rainbarrel / sprinkler | `world.collectors[k]` {w,f} / `world.sprinklers[k]` {w,s} (rain.js:62-66) | yes, every `tickRain` | refuse while w>=1 (cups are free fresh water, so this is optional) or just drop |
| beehive | `ext.bees.h[k]` {c comb,t} (bees.js:26-43) | yes, `tickBees` (:57) | refuse while c>0 ("Collect the honey first") |
| flowerbox | none (only counted by `flowersNear`) | n/a | plain |
| motor | `ext.engine.motors[k]` {on,fuel} (engine.js:4, 220-226) | yes, on decor ref/len change | refuse while on; leftover fuel is seconds, not items → lost (fine, or refuse when fuel>0) |
| wheel | `steerTargets` only | n/a | release steering if it is being held |
| sign (+ rug/pennant/fern/chime/hammock/pots) | `ext.decorpack.t[k]` text, `rot[k]` (signs-core.js:2, decor-pack.js:140-163) | yes, `rescan` on decor change (host) | plain; sign text is lost (fine, a clean board is cozy) |
| bed | `ext.sleep.in[role]` = [x,z] (sleep.js:145) | yes, every host step | refuse while anyone is in it |
| nestbox | `ext.animals` hen home / lure (animals-core.js:55-81, animals.js:96-107) | yes, `pruneHomes`: **the hen leaves for good** | refuse while a hen or lure lives there ("Your puffhen lives here") |
| sail | counted live (sailing-world.js:87-91); `world.sailing.raised` stays | n/a | plain; release the R-steer grab. The anchor is not decor: it is auto-placed on a tile (sailing-world.js:150-153) and is never removed |
| receiver / antenna | derived each frame by `countAntennas` (game.js:791) | n/a | plain; the signal tier drops |
| lantern, candle, glasslamp | daynight `lanternSignature` (daynight.js:419-424) | auto | plain |
| net, bench, maptable, chime, cushion | none per tile (maptable slice is global) | n/a | plain |

Not decor: the fishing-cooking driftwood grill (key G, cost-built, `fc` grills in localStorage,
fishing-cooking.js:68, 101, 469). Leave it out of v1. It could later answer the same hook with a
`{wood:4, scrap:2}` refund.

## 4. Proposed design hooks

**Client (game.js + building.js).**
- building.js: `createBuilding` gets `setRemoveExtra(fn)`. In the `removing` branch of `update()` (:83-93),
  when `grid.pick` misses (or the decor hit is closer), call `fn(origin, dir)`. It returns `{text, action}`
  or null. building keeps it as `removeExtra`, sets the chip text, and `removeAction()` returns
  `removeExtra.action` when there is no piece target. game.js:1741 stays unchanged.
- game.js: add `decorRemoveTarget(aim)`, which ray-casts raft decor children within `BUILD_REACH` (tag every
  decor group with `userData.tileKey` in `rebuildRaft`, game.js:612-621). It falls back to the
  `frameAim.point` tile. While removing, show `ghosts.show(d.type, d.x*2, .22, d.z*2, d.rot||0, false, elapsed)`
  in `updateGhost` (game.js:1558-1562). Hide it when nothing is targeted.
- Chip text: "Release X to pick up the Rain Barrel", or the local `undecorBlock` reason (shared pure function,
  see below) so the player sees the veto before releasing.

**Host action `{kind:'undecor', x, z}`.** Place it in `applyAction` next to the `piece/unpiece` branch
(game.js:1141), before `content?.action`:
1. `isInt(x,z)`. Find `d` at the tile. Check reach with the same `inReach(...BUILD_REACH + slack)` test as
   'build' (:1116), and that the actor holds a hammer (`bag.count('hammer')`, like building.js:130).
2. `veto = content.beforeUndecor(d, actor) || prog?.beforeUndecor(d) || coreUndecorBlock(world, d)`. Core
   covers palm, purifier and the rain types, and there is a `playerInWay`-style guard for beds. A string
   means refuse and emit a notice to the actor.
3. `loot = {[d.type]:1}` plus contents from `content.undecorLoot(d)` / `prog.undecorLoot(d)`. Chest and station
   slots are returned as slot objects so durability survives. Add everything to `new Bag(bag.snapshot())`.
   If anything does not fit, refuse with "Your bag is full" and leave the world unchanged. This is the same
   atomic pattern as 'collect' (:1100-1105) and building.apply.
4. Commit the bag, then `world.decor.splice(i, 1)`, which changes the length so ref/len-based prunes fire. Delete
   `garden/purifiers/collectors/sprinklers[k]`, then call `content.afterUndecor(d, actor)` and
   `prog?.afterUndecor(d)`, where modules clear their slice key and `bump()`/`st.r++` so guests resync.
   Then `rebuildRaft(); fitShadow(); emit({kind:'build', text:'Picked up the X', sound:'place', loot}, 'all'/actor)`.
5. content.js: add `beforeUndecor: (d, actor) => first('beforeUndecor', d, actor)` and
   `afterUndecor(d, a) { for (m of mods) call(m, 'afterUndecor', d, a) }`, documented in the header (:7-26).
   Module answers: storage (chest slots + clear key; generalise `dropTile`), kiln, bees, engine,
   sleep, animals, decorpack. prog needs its own pair because it is not a content module (game.js:1078).

**Saves.** There is no schema change. Removal only shrinks existing maps, and old saves load as before.

**Co-op.** The guest sends the action, the host validates, and the result reaches the guest in the next
`state` (decor diff → `rebuildRaft`, game.js:1903, 1913). Give the guest no prediction: the bag comes from the
acked host snapshot. Two players removing the same item: the second action finds no decor and is ignored.
A guest with a chest UI open on that tile: the storage `afterUndecor` should close it (as with paint/station
`panel.close`, progression-hooks.js:98).

**Old host.** An old host drops `undecor` silently: no module claims it, and the action falls past
game.js:1190. The new host adds a top-level `caps:{undecor:1}` to `hostState()` (game.js:1566). `cleanWorld`
would strip it inside `world`, so it must be top level. The guest shows "Your friend's raft can't pick
items back up yet" on X when the flag is absent, following the `OLD_HOST` pattern (bees.js:112,
storage-research.js:14). An old guest on a new host never sends it, so nothing changes for it.

**Tests.** Pure `undecorBlock` / `undecorLoot` per module with fixtures: a non-empty chest that fits or
does not fit, a ripe palm, a hive with comb, an occupied bed, a nestbox with a hen, a motor that is on, a
smelter that is mid-cook. Round trip: place → undecor → bag equals before.

Sources: [Steam: Raft discussion on removing storage](https://steamcommunity.com/app/648800/discussions/0/3044978436758829938),
[itch.io Raft devlog comments on hammer removal](https://itch.io/post/93538).
