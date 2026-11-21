# Spec: Tidy Tide (junk debris + Sorting Tub)

Research: [../features/recycler-research.md](../features/recycler-research.md). Anchors re-checked on
`claude/loop-features-202611210749`; line numbers drift, grep the quoted names before editing.

## Player story
Now and then a soggy **Old Boot**, a dented **Tin Can** or a cloudy **Sea Jar** drifts past. Hook it
(or let a net catch it) and it lands in your bag as an item. Once you have made nails you can build a
**Sorting Tub**: drop junk in, the little crank turns by itself, and out come useful materials. No fuel,
no RNG, no fail state. Copy celebrates tidying: "The sea looks a little cleaner."

## Decisions
- Ids: `oldboot`, `tincan`, `seajar`. Never `bottle` (logbook message bottle), never `can`
  (`MODEL_ALIASES.can = 'wateringCan'`), never `junk` (grep noise). Station id `recycler`, name "Sorting Tub".
- Fixed yields, **no bonus roll** (StationModel has one output kind per input; a second "bonus" output
  would need a second slot. A deterministic "lost sock" every Nth boot is left for later):
  `tincan -> 2 scrap (12 s)`, `oldboot -> 2 plastic (10 s)`, `seajar -> 2 sand (10 s)`. All fuel 0.
- Spawn rate: junk is ~1 in 11 spawns overall, split evenly (≈1/33 each). SPAWN_TABLE is untouched;
  `makeItem` re-rolls instead (below), so wood/plastic/leaf/scrap/barrel ratios stay the same.
- Unlock: Sorting Tub = `discover('nail')`, recipe `hand({ wood: 6, rope: 2, nail: 3 })`. Nails come after
  first scrap (`nail` unlock = `discover('scrap')`), so junk cannot shortcut the first nails/lantern/crate;
  junk hooked before that just waits in the bag (stack 20). Junk items themselves are `unlock: START`.
- Sand from jars still needs the smelter for glass; scrap from tins is ~+0.06 scrap per hooked item, a
  mild boost for mid-game nails/bolts. Boots give plastic, already plentiful.

## Data (dist/items.js)
- Three `item(..., 'material', { stack: 20, unlock: START, iconTint, tip })` rows after `sand`:
  - `oldboot` "Old Boot" #6b4f3a: "A soggy boot with a sturdy rubber sole. A Sorting Tub turns it into plastic."
  - `tincan` "Tin Can" #9aa4a8: "A dented tin with no label. A Sorting Tub flattens it into scrap."
  - `seajar` "Sea Jar" #9fd0c8: "A cloudy glass jar. A Sorting Tub crushes it into sand."
- Station row (after smelter): `item('recycler', 'Sorting Tub', 'station', { iconTint:'#7fa7a0', stack:5,
  placeable:true, recipe: hand({wood:6, rope:2, nail:3}), unlock: discover('nail'), tip:'A hand-cranked
  tub that sorts junk into scrap, plastic and sand. No fuel needed.' })`.
- `BLOCK_RADII.recycler = 0.45` (append, keep `// [recycler]` tag).
- `export const RECYCLE_YIELDS = deepFreeze({ tincan:{kind:'scrap', count:2, time:12}, oldboot:{kind:'plastic',
  count:2, time:10}, seajar:{kind:'sand', count:2, time:10} });`
- `export const JUNK_IDS = Object.freeze(Object.keys(RECYCLE_YIELDS));`
- `export function stationExtraRecipes(stationId)` -> for `'recycler'` a frozen map
  `{ inputKind: {kind, in:1, count, time, fuel:0} }`; otherwise `null`. Also teach `stationRecipeFor`
  nothing (it stays ITEMS-only; tests rely on it). Update the schema comment (`station:` list).
- Do not give scrap/plastic/sand a recipe: they stay gathered, so `recipeTable`, `discover` and
  ITEM_SOURCE semantics are unchanged.

## StationModel (dist/smelter.js)
- Constructor: `this.recipes = opts.recipes ?? stationExtraRecipes(this.stationId)` (null for existing
  stations, so their behaviour is byte-identical; the injected-fixture tests keep passing).
- `recipeFor(kind)`: current ITEMS scan first; if none and `this.recipes?.[kind]`, return a copy of it.
- `restore`: output check becomes `items[k]?.recipe?.station === stationId || this._yields(k)` where
  `_yields(k)` = some extra recipe outputs `k`. Input check already goes through `recipeFor`.
- `get usesFuel()`: false when `this.recipes` is set and no ITEMS recipe targets this station; else true.
  `addFuel` returns 0 when `!usesFuel` (wood is not swallowed by the tub). `tick` already never starves
  fuel-0 recipes (`_reason` checks `r.fuel > 0`).
- Snapshot shape unchanged (`{station,input,output,fuel,progress}`), so saves and `prog:sync` just work.

## Floating junk (dist/game.js)
- `ITEM_TYPES` += `'oldboot','tincan','seajar'` (keeps them through `cleanWorld` on load and guest sync).
- `const JUNK_TYPES = Object.freeze(['oldboot','tincan','seajar']), JUNK_CHANCE = 1 / 11;`
- `makeItem`: after the bottle line, `if (it.type !== 'bottle' && Math.random() < JUNK_CHANCE) it.type =
  JUNK_TYPES[Math.floor(Math.random() * 3)];` (bottle odds unchanged; on guests `makeItem` output is
  overwritten by host items anyway).
- `LOOT` += `oldboot:{oldboot:1}, tincan:{tincan:1}, seajar:{seajar:1}`. Collect, nets (`lootFits(..., LOOT[type])`),
  bag-full and the "+ 1 tin can" toast need nothing else. `itemName` reads ITEM_INFO, so names resolve.
- `itemModel`: before the `createDebris` line (which **throws** on unknown types, debris.js `TYPES`):
  `if (JUNK_TYPES.includes(item.type)) { const g = new T.Group(), m = getModel(item.type); if (m) {
  m.rotation.y = (item.id % 7) * .9; m.position.y = .03; g.add(m); } return singlePass(g); }`

## Models
- **models.js builders** `oldboot`, `tincan`, `seajar` in `B` (original, cute, low-poly, palette `C`, flat
  shading, ~0.3 m long, float-sized like `plastic`):
  - oldboot: rbox sole in dark rubber, lathe/box upper in faded brown cloth, 3 lace loops (cyl), slight tilt,
    a tiny cheerful seaweed strand tucked in the top.
  - tincan: 10-seg cylinder in metal with two rim rings, one dent (vertex push), a pale teal label band
    with a peeled corner, lying on its side.
  - seajar: lathe jar in translucent-looking pale sea-green (opaque material, lighter top), cork lid,
    a few frosted speckles via vertex colours.
  These also give icon renders and held fallbacks (`models.test` "every item has a model or fallback").
- **dist/recycler-model.js** (new file; avoids the kiln lane's smelter-model.js edits):
  `createRecyclerModel(T)` -> Group `recycler`: round wooden tub of staves + 2 rope hoops, a small side
  axle box, crank arm + knob named **`recyclerCrank`** (pivot at axle), three tiny bins at the rim
  (rust, plastic-blue, sand) and an output pile named **`recyclerPile`**. No node named `glow`
  (`setSmelterGlow` is then a no-op). ~1.0 m footprint, top at ~0.8 m, ≤ 60 meshes merged per material.

## Progression wiring (dist/progression-hooks.js)
- Import `createRecyclerModel`, `JUNK_IDS`. `MODELS.recycler = createRecyclerModel`.
- `COOKERS` = recipe stations **plus** every id with `stationExtraRecipes(id)` (so `syncStations` builds a
  StationModel, `modelFor` registers the group, E-key `stationNear` and `prog:*` actions work).
- Tick loop: after the glow line, `const crank = g.getObjectByName('recyclerCrank'); if (crank && st?.cooking)
  crank.rotation.z += dt * 4;` and `recyclerPile.visible = !!st?.output` (same as the `ingot` line).
- Pass `copy` to `createStationPanel` (below). Optional: on host `prog:take` from a recycler emit a
  `{kind:'loot', text:'The sea looks a little cleaner.'}` once per take.

## Panel (dist/smelter-ui.js)
- New opt `copy = {}` keyed by stationId: `{ input, none, busy, idle, nothing }`. Recycler copy:
  input "To sort", none "No junk in your bag to sort.", busy "Sorting", idle "Pick some junk from your
  bag to sort.", nothing "Nothing here to sort."
- In `update()`: `const c = copy[st.stationId] || {}`; use `c.x ?? <current text>` for each string, so
  smelter/grill copy is unchanged. When `st.usesFuel === false`: add class `st-nofuel` to `dlg` (CSS hides
  `.st-fire`, the "Fuel" sub-heading and `[data-role=fuel]`), skip the fuel hint. Re-set the "To cook"
  heading per station (it is static HTML today; keep a ref `el.inSub`).

## Craft book, icons, text
- `craft-book.js ITEM_TEXT`: oldboot {desc:'A soggy old boot fished from the sea.', use:'Sort it in a Sorting
  Tub for 2 plastic.'}, tincan {...'for 2 scrap.'}, seajar {...'for 2 sand.'}, recycler {desc:'A hand-cranked
  sorting tub.', use:'Turns junk into scrap, plastic and sand. No fuel.'}.
- `ITEM_SOURCE`: the three junk kinds `{tag:'found floating', how:'Hook it as it drifts by. Nets catch it too.'}`;
  add `how` mentions on scrap/plastic/sand: "...or sort junk in a Sorting Tub." (keep tags; craft-ux checks shape).
- `item-svg.js ITEM_ICONS`: 48x48 bodies for oldboot, tincan, seajar, recycler (navy #153e49 outline like
  the rest), and drop `placeholder` by passing `icon:` in the item rows once icons exist.

## Save compatibility
- New build, old save: no junk anywhere; new spawns appear as items respawn. Progression snapshot loads as is.
- Old build, new save: `cleanWorld` drops junk from `world.items` (no crash, but that build then floats
  fewer than 30 items until reload, since it only refills an empty list); `DECOR_TYPES` drops a placed
  `recycler` decor (tile frees up); old Bag validation drops unknown kinds (junk in bags is lost);
  `syncStations` ignores the unknown station and the next save drops its snapshot. All safe, no throw.
- `StationModel.restore` drops snapshot kinds it does not know, so a tub snapshot survives only on new builds.

## Co-op
- Junk rides `world.items` (host-authoritative, `syncItems()`); guests need ITEM_TYPES + the itemModel branch
  or `createDebris` throws in their item pass. Tub contents are host StationModels synced by `prog:sync`
  (~0.3 s); guest `stationView` constructs `new StationModel(snap.station, snap)` and gets the yields via the
  constructor default, so no extra wiring. Guest crank animates from the mirrored `cooking` flag.

## Tests
- **tests/recycler.test.mjs** (new): ids exist, material/START, stack 20, tips > 10 chars; RECYCLE_YIELDS and
  JUNK_IDS frozen and match the three ids; every yield output is an existing gathered item; `new
  StationModel('recycler')` accepts each junk, rejects wood/fish; ticking 12 s turns 1 tincan into 2 scrap
  with fuelUnits 0 and `usesFuel === false`; `addFuel('wood')` returns 0; snapshot -> restore keeps scrap
  output and input progress; a smelter StationModel still has `usesFuel` true and no tincan recipe; bad
  snapshot kinds dropped. Source-greps on game.js: ITEM_TYPES and LOOT list the three, itemModel has the
  junk branch before `createDebris`, JUNK_CHANCE ≈ 1/11. models.js `hasModel` for the three ids;
  `createRecyclerModel` (stub T from models.test) has `recyclerCrank` and `recyclerPile` and no `glow`.
- **tests/progression.test.mjs**: `STATIONS_WITH_RECIPES` add 'recycler' (harmless, future-proof);
  reachability `have` += `...JUNK_IDS` (raw floating sources).
- **BLOCK_RADII** placeable test, **survival/craft-ux** ITEM_TEXT + ITEM_SOURCE: satisfied by the rows above.
- `npm test` green before commit.

## QA plan
1. `npm test`. 2. Screenshot run (`shoot.py`) + a probe via `window.raftDebug`: spawn one of each junk near
the raft, confirm models float and look cute, not grim. 3. Hook a tin can: toast "+ 1 tin can", bag shows icon.
4. Craft nails, check Sorting Tub unlock toast, place it, E opens "Sorting Tub" panel with "To sort", no flame
or fuel row. 5. Insert 3 tins: crank turns, 36 s later 6 scrap; take; crank stops. 6. Reload: tub contents
persist. 7. Co-op (host+guest tabs): guest sees junk, hooks it, uses the tub, sees crank turn. 8. Smelter
and grill panels unchanged (copy, flame, fuel). 9. Phone width: panel without fuel column has no gaps.

## Build notes
Built as specced, with these deviations:
- **Icons keep `placeholder: true`.** The spec said to drop `placeholder` by passing `icon:` in the item rows.
  That would be wrong here: `placeholder: true` is what makes survival-ui use the inline `ITEM_ICONS` drawing,
  and `placeholder: false` requires a symbol in `icons.svg` (progression.test checks this). So the rows use
  the default `icon-<id>` like sand and smelter do, and the new drawings in `item-svg.js` show up.
- `ITEM_NAMES` in game.js also gets `oldboot/tincan/seajar`, so the pickup prompt reads "Pick up tin can"
  and not "supply".
- Panel copy `nothing` ("Nothing here to sort.") needs a station type when the station is gone, so the panel
  remembers the last opened station type (`lastType`).
- Take toast: the host emits `{kind:'loot', text:'The sea looks a little cleaner.'}` on every recycler take
  (it shows as a notice, since it has no `loot` map).
- `tests/models.test.mjs` BUDGET gets entries for the three junk models (that test needs a budget for every builder).
- The tub crank turns about its local z, with the axle on the tub's +z side. The output pile sits on the
  tile's front-left corner and is hidden until there is output.
- The models.test stub mentioned in the spec does not exist (it uses real three), so recycler.test uses real three too.
- The progression reachability test uses `...(I.JUNK_IDS ?? [])`, so `RAFT_DIST` runs against older dist builds still load.
