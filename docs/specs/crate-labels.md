# Spec: Crate labels, Stash to nearby crates, Sort

Source: docs/features/crate-labels-research.md (hook points, risks). It extends the Crate chest in
`storage-research.js` (docs/features/storage-research.md). The cozy rules are that an item is never lost or duplicated,
a tool keeps its wear, the hotbar is never touched, and a refusal changes nothing. Pure rules go in the new
`dist/crate-labels.js`, which has no DOM and no THREE and imports only `inventory-state.js` and `items.js`. Plaque
drawing goes in the new `dist/crate-labels-plaque.js` (THREE plus canvas). Edits outside these files are small and
tagged `[crate-labels]`. Imports carry `?build=v3-survival-ae77fa84ac2b`. There is no new item, no achievement and no
gamepad binding.

## 1. Player experience
- **Label**: the crate UI chest header gets a **Label** chip. Clicking it opens a picker inside the chest panel with:
  (a) a text field (`maxlength=16`, placeholder "Name this crate"), with a Save button or Enter;
  (b) **Seen**: kind tiles for every kind in the local bag, in any crate on the raft, or in `st.seen`, sorted by name;
  (c) **All items**: a collapsed `<details>` with every `ITEM_INFO` kind, grouped by category (section 2 order);
  (d) **Clear label**. Picking a tile sends `{k}`, Save sends `{t}`, and Clear sends `null`.
- A labelled crate shows a small wooden plaque nailed to its front. An icon label shows the item picture and a name
  label shows the text. The UI title reads the label ("Fish crate" for `{k:'fish'}`, the text itself for `{t}`), and the
  header icon becomes `iconSVG(k)` for an icon label. The prompt reads `<kbd>E</kbd>Open crate · Fish` (text through
  `ctx.esc`).
- **Stash**: there is a **Stash nearby** button next to *Put all in crate*, and the **F** key works with no UI open
  (rebindable as "Stash to nearby crates" in Controls). Every *backpack* stack (slots `HOTBAR_SIZE..27`) whose kind is
  already in a crate within **6 m**, or whose kind is the icon label of such a crate, moves into those crates. The actor
  sees the notice "Stashed 23 items into 3 crates" (singular forms "1 item", "1 crate"). With no match, the notice is
  "No crates nearby with matching items". Stash keeps going when one crate fills; what is left stays in the bag.
- **Sort**: a **Sort** button in the chest header merges mergeable partial stacks and orders the crate by category, then
  name, then kind. Empty slots go to the end. An already sorted crate is a silent no-op.

## 2. dist/crate-labels.js (pure, node-testable)
```js
export const STASH_R = 6;              // metres, raft-local, actor to tile centre (x*2, z*2)
export const LABEL_MAX = 16;           // code points
export const CATEGORY_ORDER = Object.freeze(['tool','material','refined','food','build','station','decor','other']);
export const LABEL_TEXT = Object.freeze({ nothingNear:'No crates nearby with matching items', badLabel:'That label won’t fit',
  oldHost:'Your friend’s raft can’t label or stash yet' });
export function cleanText(raw)          // -> string|'' : String(raw).normalize('NFC'), drop \p{C} (control/format/private), collapse \s+ to ' ',
                                        //    trim, cut to LABEL_MAX code points ([...s].slice), trim again
export function cleanLabel(raw, isKind) // -> {k}|{t}|null : {k} only if isKind(k); {t} only if cleanText(t) !== ''; anything else null
export function cleanLabels(raw, isKind, max) // -> {"x,z": label} : key regex /^(-?\d{1,2}),(-?\d{1,2})$/, |x|,|z|<=25, at most max entries
export const labelKey = l => l ? (l.k ? 'k:' + l.k : 't:' + l.t) : '';      // texture cache key
export const sameLabel = (a, b) => labelKey(a) === labelKey(b);
export function labelName(l, nameOf)    // -> 'Fish' | 'Ropes' | ''
export function categoryOf(kind)        // ITEMS[kind]?.category, a tool flag in ITEM_INFO -> 'tool', else 'other'
export function groupedKinds(kinds)     // -> [{category, kinds:[...]}] in CATEGORY_ORDER, kinds by name, empty groups dropped
export function seenKinds(bagSlots, chests, seen) // -> sorted unique kinds (picker "Seen" row)
export const mergeable = (a, b) => !!a && !!b && a.kind === b.kind && maxStack(a.kind) > 1 && a.durability === undefined
  && b.durability === undefined && a.id === undefined && b.id === undefined;
export function sortChest(chest)        // -> {slots, changed} : a NEW array of the SAME slot objects (merged ones mutated in a copy)
export function stashTargets(crates, chests, labels, pos, r = STASH_R) // crates: [{x,z}] crate decor -> [{key, d}] within r, by d then key
export function planStash(bagSlots, chests, targets, labels, move) // mutates COPIES in place -> {moved, crates:Set<key>, changed:Set<key>}
export function stashableKinds(bagSlots, chests, targets, labels) // -> Set of backpack kinds with some target (UI enable, no copies)
```
- **sortChest**: (1) copy the slot objects (`{...s}`); (2) for each slot in index order, fold later `mergeable` slots into
  it, up to `maxStack`, and empty the source when it reaches 0; (3) stable sort of the non-null slots by
  `CATEGORY_ORDER.indexOf(categoryOf)`, then `nameOf` (`localeCompare(_, 'en')`), then kind, then count descending, with
  ties kept in original index order; (4) pad to `CHEST_SLOTS` with null. `changed` is true when any slot differs from
  the input by `kind/count/durability/id` per index. Tool slots (`maxStack 1`) and slots that carry `durability` or `id`
  are never merged or split. They only change position, with their fields copied 1:1.
- **planStash**: for each backpack slot `i` from `HOTBAR_SIZE` to 27, in index order, compute the slot's target list: crates
  labelled `{k: kind}` first, then crates holding `kind`, both nearest first with no duplicates. For each target in turn,
  call `move(bagSlots, i, chests[key] ??= new Array(CHEST_SLOTS).fill(null), null, null)` (that is,
  `storage-research.js moveStack`, injected to avoid a circular import) until the slot is empty or the targets are used
  up. Add the moved count to `moved`, and add the key to `crates` when its moved count is > 0. A labelled but empty crate
  gets a fresh array only when something lands in it, so check `changed` before committing. Slots `0..HOTBAR_SIZE-1` are
  never read for moving.

## 3. State, actions and save (storage-research.js)
- **Slice**: `ext.storage = {v:2, chests, seen, learned, r, s, legacy?, labels?}`, with `labels = {"x,z": {k}|{t}}`.
  Edit `sliceOf` (`:136-142`) to write `v:2` and `labels` as a copy, only when the map is non-empty. Edit `cleanSlice`
  (`:78-99`) to add `labels: cleanLabels(d.labels, isKind, MAX_CHESTS)` and `v: isInt(d.v) ? d.v : 0`. Edit `stateFrom`
  (`:118-134`) to add `st.labels = c.labels` on every branch. On a `'save'` load, `createStorage.load` (`:365`) also
  drops labels where `decorAt(x,z) !== 'crate'`. Net state is trusted after the clean step.
- **sliceChars** (`:186-190`): change it to `sliceChars(st, changes, labels = st.labels)`. `changes` is
  `{key: chest|null}`, and the old `(st, key, chest)` form is kept by a `typeof changes === 'string'` shim so
  `put/putAll` (`:245-246`) stay unchanged. It writes `v:2` and adds `labels` when the map is non-empty, matching
  `sliceOf` byte for byte. The rule stays "refuse `tooBig` only if over `MAX_SLICE_CHARS` *and* growing".
- **applyStorageAction** (`:199-252`): widen the verb whitelist (`:203`) to
  `['put','take','putAll','research','stash','sort','label']`. Insert a **stash branch** right after the bag check
  (`:204`), before the x/z check (`:205`), because stash has no tile:
  `p = env.pos(actor)`, and refuse `reach` if it is missing or not finite, for host and guest alike. Then
  `targets = stashTargets(env.crates(), …)`, copy the bag and **every** target chest (`copySlot`), run `planStash`, and
  refuse `nothingNear` when `moved === 0`. Size check: `after = sliceChars(st, changedCopies)` against
  `sliceChars(st, originals)`. Commit the bag the same way as `:248`, set every changed chest, run one `st.r++`, and return
  `{ok, moved, crates: crates.size}`.
  **sort** uses the normal crate gate (`:206-210`). With no chest, or `!changed`, it returns `{ok:true, moved:0}`
  with **no** `r++`. Otherwise it sets `st.chests[key] = slots` and runs `r++`. **label** uses the same gate. It reads
  `l = a.label === null ? null : cleanLabel(a.label, isKind)` and refuses `badLabel` for a non-null input that cleans to
  null. When the label is equal it returns ok with no bump. Otherwise it sets or deletes `st.labels[key]`, checks
  `tooBig` with `sliceChars(st, {}, nextLabels)`, and runs `r++`.
- `env` gains `crates: () => world.decor.filter(d => d.type === 'crate')` (in `run()`, `:323`). Tests pass a stub.
- **REFUSALS** (`:254`): add `nothingNear` and `badLabel` from `LABEL_TEXT`. **run()** (`:322-330`): on an ok stash,
  emit `{kind:'notice', text:\`Stashed ${n} item(s) into ${m} crate(s)\`}` to the actor. Do not use `kind:'loot'`, which
  prints "+N".
- **dropKey** (`:276`): change it to
  `k => { if (ctx.role==='guest') return false; const had = !!st.chests[k] || !!st.labels[k]; delete st.chests[k]; delete st.labels[k]; if (had) bump(); return had; }`.
  This lets a label on an empty crate be cleared by `dropTile` (`:385`) and `afterUndecor` (`:391`).
- **Old host gating**: in `load()` net branch (`:355-362`), set `hostV2 = !!data && data.v >= 2`. Add
  `const oldLabels = () => ctx.role === 'guest' && !hostV2`. On an old host the UI hides the Label/Sort/Stash controls,
  and F shows the `oldHost` notice. A new host with an old guest is fine because unknown fields are ignored.
- **Guest actions**: the guest sends `ctx.action({kind:'storage.stash'})`, `{kind:'storage.sort',x,z}` and
  `{kind:'storage.label',x,z,label}`. The host routes them (`game.js:1334`) with `actorBag('guest')` and `posOf('guest')`
  (`:274`), and the bag syncs back through the seq/ack path. There is no client prediction: the UI repaints on `api.rev`.
- **api** (`:333-352`): add `labelAt(x,z)`, `labelName(l)`, `canLabels: () => !oldLabels()`, `seenKinds()` and
  `stashable()` (the bool from `stashableKinds` at the local pose). **prompt()** (`:401-405`): for a crate with a label,
  append `' · ' + ctx.esc(labelName(l))`.

## 4. Plaque (dist/crate-labels-plaque.js)
`export function createPlaques(T, { iconURL, onIconReady, svgFor, nameOf })` returns `{ sync(raft, labels), dispose() }`.
- **Geometry**: one shared `PlaneGeometry(.34,.22)` and one shared backing box `(.36,.24,.015)` in wood tone, both with
  `userData.shared = true`, so `disposeGeometry` (`game.js:402`) skips them. The mesh group is named `crateLabel` and
  placed at local `(0, .44, .425)` (front +z, proud of the brace at `z=.41`, crafts.js `:624`). It turns with `d.rot`.
- **Textures**: `Map<labelKey, {mat, cv, ready}>` with LRU at **24** entries. Before eviction, an entry is touched by
  every `sync`, and an entry whose material is on a live plaque is never evicted (same as `display.js plaqueMat`,
  `:287-308`). Each entry is a 128×80 canvas with a plank fill, a darker border and two nail dots.
  An icon label draws `iconURL(k)` into an `Image`. If that is null, it draws a `data:image/svg+xml` Image of
  `<svg viewBox="0 0 48 48">${ITEM_ICONS[k]}</svg>` (item-svg.js `:10`). If neither is available, it draws the
  name's initials. A name label uses a fitted font from 28 px down to 14 px, with up to two lines. Set
  `tex.needsUpdate = true` after every async draw. `onIconReady` repaints the icon entries that are waiting (blob URLs
  are revoked on re-render, `item-icons.js:348`, so keep the drawn canvas).
- **sync(raft, labels)**: for every child with `name === 'craft_crate'` and `userData.tileKey`, add or update the
  `crateLabel` child when a label exists, and remove the child when it does not. It never calls `rebuildRaft`. Hooks:
  the storage module's new `afterRebuild()` calls `plaques?.sync(ctx.raft, st.labels)` (content.js `:151` already
  loops it), and `update()` calls it when `labelsSig` (a `JSON.stringify(st.labels)` taken on each `ver` change) differs.
  The plaque module is loaded lazily the same way as `loadUI` (`:301`), only when `T` and `document` exist.

## 5. UI (storage-research-ui.js)
- Chest header (`:155`): `<span>In the crate</span>` becomes the label chip, `<button class="lr-sr-btn lr-sr-labelbtn">`
  ("Label" or the label name), plus a `<button class="lr-sr-btn lr-sr-sort">Sort</button>`. Below the grid there is a
  hidden `<div class="lr-sr-picker">` with the input, Seen tiles (`data-label-kind`), All-items `<details>` and Clear.
- Backpack header (`:159`): add `<button class="lr-sr-btn lr-sr-stash">Stash nearby</button>`. Update the hint at
  `:163` to read "Stash nearby fills crates that already hold that item (6 m). Your hotbar stays put."
- `open()` (`:286-287`): the title and icon come from `api.labelAt` (section 1). `paintChest()` (`:204-213`): set
  `sort.disabled` when the chest is empty or holds one slot, set `stash.disabled = !api.stashable()`, and hide all three
  when `!api.canLabels()`.
- The click router (`:329-351`), modelled on the putAll branch (`:336`): `lr-sr-stash` sends `{kind:'storage.stash'}`,
  `lr-sr-sort` sends `storage.sort`, `data-label-kind` and Clear send `storage.label` and close the picker.
- The text input calls `e.stopPropagation()` on keydown and keyup (as `signs-ui.js:61,73`), so E/F/Tab typed into it do
  not close the dialog. Enter saves and Escape closes the picker only. The E-close handler at `:310` skips
  `INPUT` targets.

## 6. Key (rebindable)
- `input-map.js`: add `{ id:'stash', label:'Stash to nearby crates', group:'Actions', kind:'button' }` after
  `rotate` in `ACTIONS` (`:14-32`), and `stash: b(['KeyF'])` in `DEFAULT_BINDINGS` (`:39-57`). No pad binding.
- `controls.js onAction` (`:37-42`): add `else if (id === 'stash') emit('little-raft-action', {id});`. It is already
  blocked while a UI is open (`isBlocked`).
- `game.js` legacy keydown (no controls, `:1909`): add
  `if (e.code === 'KeyF' && !e.repeat && running && !uiBlocked()) dispatchEvent(new CustomEvent('little-raft-action',{detail:{id:'stash'}}));`.
- storage module: `addEventListener('little-raft-action', onKey)` when `typeof window` exists, and remove it in
  `dispose()`. `onKey` requires `detail.id === 'stash'`, `ctx.running` and `!ctx.uiOpen()`. On an old host it shows the
  notice. Otherwise it calls `ctx.action({kind:'storage.stash'})`.

## 7. Tests (tests/crate-labels.test.mjs, `node --test`, RAFT_DIST-aware base like storage-research.test.mjs)
1. **Conservation property**: a seeded PRNG runs 300 cases. Each case has a random bag (hotbar and backpack), 1–5 crates
   at random tiles with random contents and labels, and a random pose. Run `applyStorageAction` stash. The multiset of
   `(kind, count, durability, id)` over bag plus all chests is equal before and after (sum the counts per
   kind/durability/id key). This also holds on a refusal, which must leave the state deep-equal.
2. **Hotbar untouched**: slots `0..HOTBAR_SIZE-1` are the same objects (`===`) after stash, even when a crate holds the kind.
3. **Durability preserved**: a worn hook (durability 40) in the backpack plus a hook in a crate nearby stashes as the same
   object with `durability === 40`. A sort of a crate with two worn hooks keeps both, unmerged.
4. **Range and labels**: a crate at 6.1 m is ignored. An empty crate labelled `{k:'wood'}` receives wood, and a labelled
   crate wins over a nearer unlabelled one. A full first target overflows into the next one. No match gives `nothingNear`.
5. **Atomic size**: pad `st` until a stash grows the slice past `MAX_SLICE_CHARS`. The result is `tooBig`, bag and chests
   are deep-equal to before, and `r` is unchanged. `sliceChars(st,{})` equals `JSON.stringify(sliceOf(st)).length`
   (with legacy, labels).
6. **Sort**: the output is a permutation of the input slots up to merges, and the total per key is equal. It is stable for
   equal keys, runs category before name, and leaves empty slots last. Sorting a sorted crate gives `changed=false`
   and no `r` bump. Sort never merges a slot that has `id`/`durability`, or kinds with `maxStack 1`.
7. **Label clean**: control characters are stripped, "  a\n b " becomes "a b", 20 emoji are cut to 16 code points,
   whitespace-only input gives null, an unknown kind gives null, a bad key is dropped, input over `MAX_CHESTS` is
   capped, and `{k,t}` keeps `k`. `storage.label` refuses `badLabel`.
8. **Save and drop**: a round trip `sliceOf → cleanSlice → stateFrom` keeps labels. An empty label map omits the field.
   On load, a label on a non-crate tile is dropped. `dropTile` on an empty labelled crate deletes the label and bumps `r`.
9. **Old-host gating**: `createStorage` as guest, with `load({v:1, chests:{}, seen:[], learned:[], r:1, s:'x'}, 'net')`,
   gives `api.canLabels() === false`. With `v:2` it is true. An old v1 slice (no `labels`) loads with `labels = {}`.
10. input.test.mjs keeps passing (`stash` has a default and there are no conflicts). Add one assertion:
    `m.actionFor('KeyF')` deep-equals `['stash']`.

## 8. QA helper (`raftDebug.content.storage`, host only, returns plain data)
- `labelDemo()`: it picks the 3 nearest free deck tiles within 5 m of the player, then pushes three `crate` decor entries
  and runs `ctx.rebuildRaft()`. A is labelled `{k:'wood'}` and empty. B holds plastic ×3, unlabelled. C is labelled
  `{t:'Fishing gear'}` and holds a hook with durability 40. The host bag backpack gets wood ×12, plastic ×7, a worn hook
  (durability 55) and rope ×5 (no target, so it stays). Hotbar slot 0 gets wood ×3 (it stays). Returns
  `{crates:[{x,z,label}], bag}`.
- `stash()` runs `run({kind:'storage.stash'}, 'host', ctx.localBag())` and returns the result. `label(x,z,l)` and
  `sort(x,z)` do the same. `plaques()` returns `[{key, labelKey, ready}]` for the screenshot checks.
- Screenshots: after `labelDemo()`, take one of the 3 plaques, then one of the notice "Stashed 20 items into 3 crates"
  after `stash()`, then one of C opened (header "Fishing gear").

## Build notes
- **Files**: new `dist/crate-labels.js` (pure rules), `dist/crate-labels-plaque.js` (THREE + canvas plaques),
  `tests/crate-labels.test.mjs` (11 tests, sections 1–10). Tagged `[crate-labels]` hooks in `storage-research.js`
  (slice v2 + labels, `sliceChars(st, changes, labels)` with the old-form shim, `stash/sort/label` verbs, `stashAction`,
  REFUSALS, notice, `dropKey`, net `hostV2` gating, api, prompt, `afterRebuild`, lazy plaques, F listener, debug QA
  helpers), `storage-research-ui.js` (Label chip + picker, Sort, Stash nearby, hint, input key isolation),
  `input-map.js` (`stash` action, `KeyF`, no pad), `controls.js` (emit), `game.js` (legacy F keydown, one line),
  `live.js` (PRELOAD gains `crate-labels.js`, now in the static import graph), `tests/input.test.mjs` (one assertion).
- **Deviations / choices**:
  - `cleanText` folds every `\s` run to one space *before* dropping `\p{C}`, so "a\nb" reads "a b" rather than "ab".
    All spec cases hold.
  - `cleanLabel` with an unknown `k` but a good `t` returns `{t}` (a known `k` still wins over `t`).
  - `sortChest` copies every slot first (spec step 1), so the stored chest is never mutated before commit.
  - Stash copies the actor's bag, so a moved tool is an equal copy in the crate, not the identical JS object;
    durability/id travel 1:1 and the hotbar slots stay the identical objects (`===`).
  - `stashableKinds` also checks that a target has room (empty slot or a partial stack of that kind), so the
    Stash nearby button is disabled when every matching crate is full. The action itself still answers `nothingNear`.
  - The prompt label goes through `ctx.esc`, with a local escape as a fallback for stub contexts.
  - Plaque materials get a faint emissive (map as `emissiveMap`, 0.22) so the label stays readable in the crate's
    shadowed front. `plaques(true)` also returns each canvas as a data URL for QA.
  - Opening the picker selects the existing name, so typing replaces it. The Seen row scrolls after two rows.
  - `debug.canLabels()` exposes the gating flag to tests (the UI `api` is internal).
- **QA (headless Chrome, swiftshader)**: `labelDemo()` placed A (wood icon), B (plastic) and C ("Fishing gear") crates.
  Plaques showed on A and C. F gave "Stashed 20 items into 3 crates", item totals were equal before and after (wood 15,
  plastic 10, rope 5, hooks @40 and @55), and rope ×5 plus hotbar wood ×3 stayed in the bag. Typing "Fish e f" in the
  picker did not close or stash. Esc closed only the picker, and Enter, a tile and Clear each relabelled. No console errors.
  Item icons render slowly under swiftshader (about 1 s each), so an icon plaque shows initials until `onIconReady` fires.
- **Known gaps**: the guest path (`storage.stash` via `ctx.action`, `posOf('guest')`) is covered only by unit tests
  plus the existing generic routing, with no two-browser smoke. Stash shows no per-kind "−N" feed rows, only the notice.
  There is no gamepad binding (as specced).
