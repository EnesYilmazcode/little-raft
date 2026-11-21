# Spec: Pick up placed items (hammer X on decor)

Source: docs/features/decor-pickup-research.md (hook points, per-type state table). Cozy rules: a placed item comes back
whole (a full refund of the item), anything stored inside comes back too, and nothing is ever spilled or silently lost.
When the contents can't come back safely, we refuse with a gentle notice and leave the world as it was.
Pure rules go in the new `dist/decor-pickup.js`, which imports only `inventory-state.js`, `watering.js` and `rain.js`
constants, with no DOM or THREE. The game.js edits are small and tagged `[decor-pickup]`. Imports carry `?build=v3-survival-ae77fa84ac2b`.
There is no new item, no save schema change, no achievement and no gamepad binding (see section 9).

## 1. Player experience
- Hold the hammer and hold X. Building-piece removal is unchanged and **always wins**: if `grid.pick` hits a piece,
  the piece gets the red ghost and the chip reads "Release X to remove …", exactly as today.
- If no piece is targeted, the aimed decor gets a red see-through ghost of its own model, and the chip reads
  "Release X to pick up the Rain Barrel". If a local veto is known (section 4), the chip shows that text instead.
  With nothing aimed the chip stays "Point at a piece to remove".
- Releasing X sends `{kind:'undecor', x, z}`. On success everyone hears `place`, the item vanishes, and the actor's
  feed shows "+ 1 Crate · 4 Wood …" (`kind:'loot'`), with the build line "Picked up the Crate" for everyone.
- Foundations and deck tiles are never picked up. The fishing-cooking driftwood grill (key G) is not decor: out of v1.

## 2. dist/decor-pickup.js (pure, node-testable)
```js
export const UNDECOR_TEXT = Object.freeze({
  full:'Your bag is full', reach:'Move a little closer', hammer:'Hold your hammer to pick things up',
  ripe:'Harvest it first', water:'Take your water first', oldHost:'Your friend’s raft can’t pick items back up yet' });
export const tileKey = (x, z) => x + ',' + z;
export function decorAt(decor, x, z)          // -> index in decor or -1
export function coreUndecorBlock(world, d)    // -> veto string | null (core per-tile state only, section 4)
export function normLoot(list)                // -> clean [[kind, n, meta?]...]: drops bad kinds/n<1, floors n, merges plain duplicates
export function assembleLoot(d, ...lists)     // -> [[d.type, 1], ...normLoot(each list)]
export function tryLoot(bagSnapshot, loot)    // -> {ok, scratch:Bag|null}: adds every entry to new Bag(snapshot); ok=false if anything overflows
export function clearCoreTile(world, k)       // delete world.garden/purifiers/collectors/sprinklers[k]; returns true if any changed
export function targetFromAim(decor, hitKey, point) // hitKey from the ray hit's userData.tileKey, else round(point/2) tile; -> d | null
export const hostCanUndecor = state => !!state?.caps?.undecor; // guest side, reads the last host 'state'
```
- `meta` is the optional third element, passed to `Bag.add(kind, n, meta)`. Chest slots use it as `{durability}` so a
  worn hook stored in a crate comes back worn. `normLoot` keeps `meta` only if it is a plain object, and never merges entries that carry it.
- `tryLoot` must never touch the live bag. The host commits `scratch` with the existing `commit(bag, scratch)` (game.js:148).

## 3. Hook contract (content.js + progression-hooks.js)
Document this in the content.js header block (`:7-26`), after `tileTint`:
```
//   beforeUndecor(d, actor)   host only. d = the world.decor entry {type,x,z,rot?} (read-only), actor 'host'|'guest'.
//                             -> veto string (shown as a notice to the actor) when this module's state on d's tile
//                             is busy, else null. Must not mutate anything. Called for every decor type: ignore
//                             types you don't own.
//   undecorLoot(d)            host only. -> array of [kind, n] or [kind, n, meta] that this module stores on d's tile
//                             (contents, NOT the item itself: the host adds {d.type:1}). [] or null when nothing.
//                             Must not mutate. Called only after every beforeUndecor returned null.
//   afterUndecor(d, actor)    host only, after the bag is committed and d is spliced out of world.decor.
//                             Delete this module's slice key for d's tile, bump its rev so guests resync, close any
//                             open UI for that tile. Must not throw. No return value.
```
Registry (content.js, beside `craftLocked` at `:95`):
```js
beforeUndecor: (d, actor) => first('beforeUndecor', d, actor),
undecorLoot: d => { const out = []; for (const m of mods) { const r = call(m, 'undecorLoot', d); if (Array.isArray(r)) out.push(...r); } return out; },
afterUndecor: (d, actor) => { for (const m of mods) call(m, 'afterUndecor', d, actor); },
```
Because `call` catches throws and disables the module, a broken module can't block pickup. A module that is disabled
mid-pickup just contributes nothing. **Progression** (not a content module; `attachProgression` return at
progression-hooks.js:368) gets the same three names with the same signatures: `beforeUndecor(d, actor)`,
`undecorLoot(d)`, `afterUndecor(d, actor)`. They cover `smelter`, `grill` and any `STATIONS` type with a StationModel.
**For the other features this round:** `flags` answers with `afterUndecor` only (delete `f[key]`, `r++`; the design
is lost like sign text, plain refund). `sit` answers `beforeUndecor` with "Someone is sitting there" while
`in.host` or `in.guest` points at d's tile, and with `afterUndecor` it clears any stale seat on that tile.

## 4. Busy rules (who answers, exact texts)
| Type | Answered by | Veto (text) | Loot | afterUndecor |
|---|---|---|---|---|
| crate | storage | none | every non-null chest slot `[kind, count, {durability}?]` | `delete chests[k]`, `bump()`, close the chest UI if it shows k |
| smelter, grill | prog | `progress>0` or (input and fuel>0): "It's still cooking" | input + output slots | `stations.delete(k)`, `panel.close()` if open on k |
| kiln | kiln | `burning(e)` (h===1): "The kiln is still firing" | queue `[r,q]` + tray `[o,n]` | delete `k[key]`, rev++ |
| palm | core | `plantStage(garden[k])===2`: `ripe` | none | core deletes `garden[k]` |
| purifier | core | `purifiers[k].ready`: `water` | none | core deletes `purifiers[k]` |
| rainbarrel, sprinkler | core | none (rain water is free) | none | core deletes `collectors/sprinklers[k]` |
| beehive | bees | `c>0`: "Collect the honey first" | none | delete `h[k]`, rev++ |
| motor | engine | `on`: "Switch the motor off first" | none (fuel seconds are lost, fine) | delete `motors[k]`, rev++ |
| wheel | engine | none | none | none (steer targets are rebuilt from decor; if a held R-grab survives, release it here) |
| bed | sleep | `in.host` or `in.guest` on k: "Someone is in that bed" | none | clear stale `in[r]` on k |
| nestbox | animals | a hen with `home` on k, or a lure on k: "Your puffhen lives here" | none | none (prune finds nothing) |
| sign + decor pack | decorpack | none | none | delete `t[k]`, `rot[k]`, rescan |
| flagpole | flags | none | none | delete `f[k]`, `r++` |
| bench, cushion, … seats | sit | someone seated on k: "Someone is sitting there" | none | clear stale seat |
| everything else | none | none | none | none |
- Station loot: the StationModel `snapshot()` shape gives `input:{kind,count}` and `output:{kind,count}`. Fuel units are
  not items and are lost silently when the station is idle, which is a cozy enough cost. Refuse while it is mid-cook, so a half-cooked fish is never thrown away.
- The palm is refused only when ripe. Growth stage 0 or 1 is dropped and the entry deleted, so a re-placed planter starts fresh.
- Order on the host: `content.beforeUndecor` → `prog.beforeUndecor` → `coreUndecorBlock`; the first string wins.

## 5. Host action (game.js `applyAction`, right after the `piece/unpiece` branch at `:1141-1145`)
```
if (a.kind === 'undecor') {                                   // [decor-pickup]
  if (!isInt(a.x) || !isInt(a.z)) return; const i = decorAt(world.decor, a.x, a.z); if (i < 0) return; // second remover: silent
  reach test copied from 'build' (:1116) with BLOCK_TEXT.reach; if (bag.count('hammer') < 1) notice UNDECOR_TEXT.hammer
  const d = world.decor[i]; veto = content?.beforeUndecor(d, actor) || prog?.beforeUndecor?.(d, actor) || coreUndecorBlock(world, d)
  if (veto) { emit({kind:'notice', text:veto}, actor); return; }
  loot = assembleLoot(d, content?.undecorLoot(d), prog?.undecorLoot?.(d)); r = tryLoot(bag.snapshot(), loot)
  if (!r.ok) { emit({kind:'full', text:UNDECOR_TEXT.full}, actor); return; }      // world unchanged
  commit(bag, r.scratch); world.decor.splice(i, 1); clearCoreTile(world, tileKey(d.x, d.z));
  content?.afterUndecor(d, actor); prog?.afterUndecor?.(d, actor);
  rebuildRaft(); fitShadow();
  emit({kind:'build', text:`Picked up the ${ITEM_INFO[d.type].name}`, sound:'place'}, 'all');
  emit({kind:'loot', text:'+ ' + loot summary (itemName), loot:{kind:n,...}}, actor); return;
}
```
- `splice` changes `decor.length`, so the existing ref/len prunes (kiln, engine, sleep, animals, rain, watering) still
  run as a safety net. The explicit `afterUndecor` cleanup is what keeps them from racing.
- No `award(...)`. Sail and wheel have no veto: if a hold-R grab points at a removed target, the builder makes sure
  the grab is released (engine `afterUndecor` or the existing per-frame target refresh) and records which one in Build notes.

## 6. Client (building.js + game.js)
- building.js `createBuilding`: add `setRemoveExtra(fn)`. In the `removing` branch of `update()` (`:83-93`), when
  `grid.pick` returns null, call `ex = fn(origin, d)` and keep it as `removeExtra`. Set `text = ex?.text ?? 'Point at a piece to remove'`.
  `removeAction()` (`:119-122`) returns the unpiece action if `p`, else `removeExtra?.action ?? null`, and always clears
  `removeExtra`. `active=false` and blur also clear it. game.js:1741 stays unchanged.
- game.js `rebuildRaft` (`:606-630`): tag **every** decor group with `userData.tileKey = tileKey(d.x, d.z)`. Watering
  already uses this tag, so nothing changes for it.
- game.js `decorRemoveTarget(origin, dir)`, passed through `building.setRemoveExtra` once at setup: ray-cast raft decor
  children within `BUILD_REACH`, then use `targetFromAim(world.decor, hit?.userData.tileKey, frameAim?.point)`.
  - It returns `{text, action:{kind:'undecor', x, z}, d}`.
  - `text` is the guest's `UNDECOR_TEXT.oldHost` when `role==='guest' && !hostCanUndecor(lastHostState)`, and then `action` is null.
  - Otherwise `text` is `coreUndecorBlock(world, d)` (the guest has the synced core maps), or "Release X to pick up the " + name.
  - Module vetoes are host-only, so they show as the notice after release. That is fine.
- game.js `updateGhost` (`:1553`): when `building.removing` and `removeExtra?.d` is set, call
  `ghosts.show(d.type, d.x*2, .22, d.z*2, d.rot||0, false, elapsed)`, else keep today's flow. building.js exposes `get removeExtra()`.
- Guest: no prediction. The bag and decor come from the next host `state`. Releasing X on a stale target is harmless.

## 7. Co-op and old hosts
- `hostState()` (`:1564`) adds a top-level `caps:{undecor:1}` beside `type/v/ack`. It is not inside `world`, because `cleanWorld` strips unknown keys there.
  The guest stores the last `caps` from `state` messages in `hostCaps`. It is never saved.
- Old host: `caps` is missing, so X on decor shows `UNDECOR_TEXT.oldHost` on the chip and as a `notice` on release, and nothing is sent.
- Old guest on a new host: it never sends `undecor` and ignores `caps`. Mixed-version co-op is unsupported; say so in the PR.
- Two removers: the second action finds no decor and returns silently. The storage `afterUndecor` closes a guest's chest
  UI on its next `load('net')`, when the key is gone (copy the station `panel.close` pattern).

## 8. Hook lines (file:function)
- New `dist/decor-pickup.js`. Add it to `PRELOAD` in `dist/live.js:16-36`, which `tests/live-preload.test.mjs` enforces.
- `dist/game.js`: import line; `rebuildRaft` (tag); `decorRemoveTarget` (new); the setup line `building.setRemoveExtra(...)`;
  `updateGhost` (ghost); `applyAction` (branch); `hostState` (caps); the guest `state` handler (`hostCaps = m.caps`);
  `debugApi` (`undecor`).
- `dist/building.js`: `createBuilding` (`setRemoveExtra`, `removeExtra` getter); `update`; `removeAction`; the blur reset.
- `dist/content.js`: header doc + the three registry functions.
- `dist/progression-hooks.js`: `attachProgression` adds `beforeUndecor/undecorLoot/afterUndecor` and returns them.
- Modules: `storage-research.js` `createStorage` (loot + after; refactor `dropTile` to share the delete);
  `kiln.js`, `bees.js`, `engine.js`, `sleep.js`, `animals.js`, `decor-pack.js` (rows in section 4). Every edit is tagged `[decor-pickup]`.

## 9. Sound, gamepad, achievements
- Sound: `place` for the build event (the item's "clunk"). The loot line plays `collect` through the default `kind:'loot'` routing (game.js:1020). There is no new recipe.
- **Gamepad gap:** piece removal has no pad binding today, so pad players can't pick up decor either. A later controls lane
  should add one, for example hold B with the hammer (it feeds `building.key('KeyX', down)`). It is out of scope here; the PR says so.
- No achievement.

## 10. QA helper: `raftDebug.undecor`
`{ target() -> {type,x,z,text}|null, preview(x,z) -> forces removing+highlight on that tile until clear(), clear(), act(x,z) -> sends the action, caps -> host caps seen }`.
Screenshot: place a crate with 3 wood inside, call `raftDebug.undecor.preview(x,z)`, and capture the red crate ghost with the
chip "Release X to pick up the Crate". Then `act` it, and capture the bag showing the crate and 3 wood.

## 11. tests/decor-pickup.test.mjs (node:test, assert/strict, `RAFT_DIST` base URL, `bagWith` helper as watering.test.mjs)
1. `decorAt`/`targetFromAim`: the hit key wins over the aim point; a point maps to `round(p/2)`; an empty tile gives null.
2. `coreUndecorBlock`: ripe palm → `ripe`; palm at stage 1 → null; purifier ready → `water`; a full rain barrel → null; a crate → null.
3. `normLoot`/`assembleLoot`: the item is always first with 1; junk entries are dropped; plain duplicates merge; meta entries stay separate.
4. `tryLoot`: a chest with 12 slots that fits → ok, and the scratch holds the crate and every slot (durability kept).
   A full bag → ok=false, and the input snapshot is unchanged (deepEqual).
5. `clearCoreTile` removes only key k from the 4 maps and leaves the others alone.
6. Module fixtures through their factories or pure helpers: bees `c=2` veto; engine `on` veto, and fuel only → null;
   sleep occupied veto; animals hen home → veto, lure → veto; kiln `h=1` veto, idle tray `o:'glass',n:3` → loot `[['glass',3]]`;
   storage loot equals the slots and `afterUndecor` deletes the key and bumps `r`; prog station mid-cook → veto, idle → input+output loot.
7. Registry: `undecorLoot` concatenates across 2 stub modules; `beforeUndecor` returns the first string; a throwing module is skipped.
8. Round trip (pure): bag B, place a crate (remove 1), fill the chest from the bag, then assemble loot and tryLoot → counts equal B.
9. `hostCanUndecor({caps:{undecor:1}})` is true; `({})` and `undefined` are false.
Run `npm test` and shoot.py. The `errors` list must be empty.

## Build notes
- **Tag:** every hook line is tagged `// [undecor]` (the coordinator's tag for this lane) rather than `[decor-pickup]`; `grep -rn "\[undecor\]" dist` lists them all.
- **Files:** new `dist/decor-pickup.js` (pure; imports `inventory-state.js` and `watering.js` only, rain needs no veto) and
  `tests/decor-pickup.test.mjs` (10 tests, covering every item in section 11 plus a progression-station test). The hooks are in `dist/game.js`, `dist/building.js`, `dist/content.js`
  (header doc + registry), `dist/live.js` (PRELOAD), `dist/progression-hooks.js`, `dist/storage-research.js`, `dist/kiln.js`,
  `dist/bees.js`, `dist/engine.js`, `dist/sleep.js`, `dist/animals.js` and `dist/decor-pack.js`.
- **Kiln queue loot:** a queued batch took `SMELT[r].need` inputs when it was loaded, so the queue comes back as
  `[r, q * need]` (2 sand per glass batch), not `[r, q]`, so no ore or sand is lost. The tray comes back as `[o, n]`. Firebox fuel units are lost, the same as station fuel.
- **Storage:** chest slots keep `{durability}` (and `id` when present) as the meta. `dropTile` and `afterUndecor` share one
  `dropKey` delete. A guest's open chest UI already closes itself when the crate's decor vanishes (storage-research-ui.js `update`), and the host closes its own UI in `afterUndecor`.
- **Progression:** `beforeUndecor/undecorLoot` also read a station that is still only in `pendingStations` (loaded from
  localStorage, not yet synced by `tick`), so a fresh load can't skip the mid-cook check. `afterUndecor` deletes both the live and the pending entry and closes the panel.
- **Sail / wheel grab:** the host branch calls `sailing.release()` when a sail or wheel is picked up while the host is steering.
  On either peer, the existing per-frame `grabLost()` in sailing-world.js releases a grab once the last sail (or the last wheel) is gone.
  Steering isn't tied to one particular sail or wheel, so a grab can keep going while another one of the same kind is left.
- **Client targeting:** `rebuildRaft` tags every decor group with `userData.tileKey` and keeps them in `decorGroups`, so the
  ray never tests the deck mesh. `decorRemoveTarget` runs only while X is held. It reuses one hit array and one result
  object, and it builds the chip text and the action object only when the aimed tile or type changes. (Three's
  `intersectObjects` still makes its own hit records.) The chip shows `UNDECOR_TEXT.reach` when the tile is out of `BUILD_REACH` (the action is still sent, and the host answers with BLOCK_TEXT.reach).
- **Old host:** `building.removeAction()` calls `removeExtra.deny()` when there's no action, and the guest sees the oldHost notice. Nothing is sent.
- **Host caps:** `HOST_CAPS = {undecor:1}` sits beside `hostState()`. Other lanes should add their flags to that object instead of adding a second `caps` key.
- **QA:** `raftDebug.undecor.{target, preview, clear, act, caps}`. `preview` holds X while the hammer is in hand.
  Headless smoke: crate (3 wood inside) + lantern. Both show the red ghost and the "Release X to pick up the …" chip. Afterwards the bag gained 1 crate, 3 wood and 1 lantern, `world.decor` and the storage chests are empty, and there are no page errors.
- **Known gaps:** there's no gamepad binding (section 9). While X is held, other context prompts (for example "Open crate") still show. Mixed-version co-op (an old guest on a new host) is unsupported.
