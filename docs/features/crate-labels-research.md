# Crate labels, Stash to nearby crates, Sort: research

This feature adds three things to the existing Crate chest (`docs/features/storage-research.md`): a painted
**label plaque** on the crate, a **Stash** button and key, and a **Sort** button. Line numbers are from this branch. The
plan stays inside `storage-research*.js`. The only optional core edit is a key binding.

## 1. Reference games and our take

None of the wiki pages were reachable from this sandbox (see the note in storage-research.md). The points below are from
memory, so recheck them by hand before quoting any of them.
- **Raft**: storage boxes come in small and large sizes, with roughly 20 and 50 slots. There is no built-in label. Players
  place Wooden Signs (free text) next to or on top of their storage walls, and they group boxes by material. Mods such as
  "storage labels" or "item frame" add an item picture to the box front. The common complaint is walking a box wall to put
  loot away after a trip.
- **Terraria**: the inventory has a *Quick Stack to Nearby Chests* button. It moves every non-hotbar item whose kind
  already sits in a chest in range, and it leaves favourites alone. Chests also have *Deposit All*, *Loot All*, *Restock*,
  *Sort* and *Rename*, and players hang Item Frames on chests as icons.
- **Stardew Valley**: the chest UI has an *Add to existing stacks* button and a sort button, and chests can be
  colour-tinted. Mods (Convenient Chests, Chests Anywhere) add stashing to nearby chests and name labels.
- **Valheim**: vanilla has *Take all* and *Place stacks* in the open chest. Quick-stack-to-nearby, sort and name signs
  come from mods (Quick Stack Store Sort Trash), and players put item signs above chests.
- **Grounded / Core Keeper**: storage signs with an item-icon picker, and a quick-stack-nearby key.

**Our take (original).**
(a) **Label**: a crate gets either an item icon (any kind the player has seen; see §3) or a short name of up to 12
characters. It is painted on a small wooden plaque nailed to the crate front, so you can see it on the raft. The crate
prompt also reads it: `E Open crate · Fish`.
(b) **Stash**: a button in the crate UI and a key used with no UI open (proposed **F**, which no module uses today; `grep
"'KeyF'" dist` finds nothing). It moves every *backpack* stack (slots `HOTBAR_SIZE..27`, never the hotbar) whose kind
already exists in any crate within **6 m** into those crates. The feed then says "Stashed 23 items in 3 crates". Hold-E is
not proposed because `interact()` fires on the E keydown (`game.js:1909`) and would open the crate first.
(c) **Sort**: sorts the open crate. It merges partial stacks, then orders slots by category, name, then count descending.

## 2. Where it hooks in

**State and actions (storage-research.js)**
- `CHEST_SLOTS = 12` and `REACH = 3.2` are at `:8-10`. Add `STASH_R = 6`. Tile centres are at `x*2, z*2` in raft-local
  metres, the same frame as `ctx.physics` and `ctx.other` (`:210`, `:274`).
- `cleanSlot` (`:64`) validates through `Bag`. `cleanChest` is at `:68`. `cleanSlice` (`:78-99`) drops unknown fields, so
  a `labels` field must be added there, in `stateFrom` (`:118`), in `sliceOf` (`:136`) and in `sliceChars` (`:186`, which
  feeds the size check).
- `moveStack` (`:151-173`) moves items and never creates them. A whole slot moves as the same object, so tool `durability`
  and `id` survive. `putAll` (`:175`) is already the backpack-only loop that Stash needs, so reuse it per target chest.
- `applyStorageAction` (`:199-252`) has a verb whitelist at `:203`, the decor and reach gate at `:206-210`, and works on
  copies (`:226-228`). It commits at `:248-250` with one `st.r++`. New verbs `stash`, `sort` and `label` slot in here.
  Stash takes many keys, so it needs its own branch (see §3).
- The `REFUSALS` table is at `:254`. `run()` (`:322`) emits notices to the actor through `ctx.emit`.
- `dropKey` (`:276`) returns early when the tile has no chest. A label lives on an empty crate too, so it must also delete
  `labels[k]`. It is called from `dropTile` (`:385`, shark tear, `game.js:522`) and from `afterUndecor` (`:391`).
  `undecorLoot` (`:386-390`) needs no change because a label is not an item.
- `prompt()` is at `:401-405` (append the label name). The `api` passed to the UI is at `:333-352` (add `labelAt(x,z)`).
  `target()` (`:279`) is the aim-ray pattern, and the stash-range scan has the same shape.
- `decorModel` (`:406`) only serves `research`. The crate model comes from `createCraft` earlier in the chain
  (`game.js:635`), so the plaque cannot come from `decorModel` (see "Plaque model" below).

**UI (storage-research-ui.js)**
- The dialog markup is at `:149-176`. The backpack header with the *Put all in crate* button is at `:159`, and the hint is
  at `:163`. Add **Stash nearby** next to it and **Sort** plus a **Label** chip in the chest header (`:155`).
- `paintChest` (`:204-213`) sets the putAll `disabled` state, and `canMerge` is at `:214`. Stash is enabled when some
  backpack kind is present in a crate in range. The click router (`:328-351`) sends `storage.*` with `api.send`. The
  putAll branch at `:336` is the template. E closes the dialog (`:310`). The header icon uses `iconSVG` (`:286`).
- The label picker can be a small grid in the same dialog. A text input must stop key propagation, as signs-ui does
  (`signs-ui.js:61,73`), so typing "e" does not close the dialog.

**Plaque model**
- The crate is `crafts.js:607-644` (`buildCrate`), built fresh on every `rebuildRaft` (`game.js:629-650`). The front face
  is +z: planks at `z=±0.385` (0.03 thick, outer face about 0.40) and nails at 0.402. A diagonal brace runs across the
  front at `z=0.41` (`:624`), and rope handles are on ±x. Put a plane of about 0.34×0.22 at local `(0, 0.44, 0.425)` so it
  sits proud of the brace. The group carries `d.rot` (`game.js:636`), so the plaque turns with the crate.
- Attach the plaque in `afterRebuild()` (`content.js:27`, called at `game.js:648`). Find crate groups among
  `ctx.raft.children` by `name === 'craft_crate'` and `userData.tileKey` (`game.js:636`, format `x,z`). For a label
  change, update the existing group in place and never call `rebuildRaft`, following decor-pack (`decor-pack.js:4-5`,
  `apply()` `:66-75`). `display.js scanGroups()` (`:196-210`) is a cheap re-scan guard.
- Disposal trap: `disposeGeometry` (`game.js:402`) frees everything not flagged `userData.shared`. Share one plaque
  geometry and the materials, flagged `shared` (`display.js:302`), or apply decor-pack's `dispose = noop` trick
  (`decor-pack.js:48`).

**Icon onto the plaque**
- `item-icons.js` renders each kind once to a 128 px canvas, then caches a blob or data URL (`:22`, `:274-283`).
  `iconURL(kind)` (`:326`) returns the URL synchronously, or null while it renders. `onIconReady` (`:346`) fires when it
  is done. The internal canvas is not exported, so load the URL into an `Image` and `drawImage` it onto a plaque canvas
  (wood board plus the icon), then set `tex.needsUpdate = true`.
- Blob URLs get revoked when `setModelProvider` re-renders (`:348-352`), so draw once, keep the canvas, and repaint on
  `onIconReady`. On the title screen, or without WebGL, `iconURL` gives null. The fallback is the inline SVG body from
  `item-svg.js` (`ITEM_ICONS`, `:10`), which is self-contained per the rule at `:4`. Load it as a `data:image/svg+xml`
  Image. Do not use the `icons.svg` `<use href>` sprites (`survival-ui.js:147`): SVG drawn as an image cannot reach the
  external sprite. Last resort: initials text, like the blank tile at `survival-ui.js:145`.
- For a name label, paint like `display.js plaqueMat` (`:287-308`): fit the font size, use a 128×32 canvas, and evict LRU
  entries at 24 without disposing a visible texture. decor-pack's text cache is `decor-pack.js:38-61` (`textFor`,
  `prune`).

**Co-op, feed and keys**
- Guests call `ctx.action(a)`, which goes to `game.js:1111-1116` and then `applyAction` (`:1188`). The host routes it
  through `content.action(a, actor, actorBag(actor))` (`:1334`). The host commits the guest bag, and its snapshot syncs
  back through the seq/ack path (`:2073`, `:2088`). The chest and label state syncs through the slice `r/s` check in
  `load()` (`storage-research.js:354-362`).
- Feedback: `ctx.emit({kind:'notice', text:'Stashed 23 items in 3 crates'}, actor)`. Do not use `e.loot` (`game.js:1131`),
  because `pickupFeed.add` prints "+N Name" (`pickup-feed.js:87`), which reads as gained items. A per-kind "−N" row would
  need a new `pickupFeed` variant.
- Key: either a module-level `document` keydown like logbook (`logbook-ui.js:264-269`: ignore repeat, modifiers and text
  inputs, and require `ctx.running && !ctx.uiOpen()`), or a rebindable `stash` entry in `input-map.js DEFAULT_BINDINGS`
  (`:39-57`, plus the ACTIONS list). The second is the only core edit. Gamepad has no free button, so pad users use the
  UI.

## 3. Design notes and risks

- **Atomic multi-crate move (dup/loss)**: one host action `{kind:'storage.stash'}` with no x,z. The host takes the actor
  position (guest without a pose means refuse `reach`, as at `:209`). It gathers `crate` decor within `STASH_R` that has a
  chest and copies every chest plus the bag. Then, for each backpack slot whose kind is in some copy, it calls `moveStack`
  into those chests, nearest first, partial stacks first. It checks the total size once, commits all of it with one
  `st.r++` and returns `{moved, crates}`. Never chain per-crate `put` actions: a mid-chain refusal or a guest resend would
  split the state. Test invariant: the multiset of kind/count/durability over bag plus all chests is unchanged.
- **Size cap**: `sliceChars` (`:186`) takes a single key. Stash needs a variant that takes a map of changed chests. Keep
  the rule "refuse only if over `MAX_SLICE_CHARS` *and* growing" (`:246`).
- **Tool meta**: tools have `maxStack 1`, so `moveStack` moves the whole slot object. Durability is kept, and a split
  never happens (`:160`). Sort must not merge slots that carry `durability`/`id`, and it must order a permutation of the
  real slot objects instead of rebuilding `{kind,count}`.
- **Sort**: `storage.sort {x,z}` uses the same reach gate. There is no `expect`: the host sorts what it has. Use `items.js
  ITEMS[k].category` (`items.js:11,308`) and then the name for the order. It is a no-op when the crate is already sorted
  (no `r` bump, no resync).
- **Labels and save compatibility**: store them in `ext.storage.labels = {"x,z": {k:'fish'} | {t:'Ropes'}}`. `game.js
  cleanWorld` keeps `ext` as opaque JSON (`content.js:97-100`, 200k cap), so it is untouched. Validate in `cleanSlice`:
  the key regex as at `:85`, `isKind(k)`, and `t` trimmed to 12 characters with no control characters. Cap the count at
  `MAX_CHESTS`, and keep a label only when `decorAt` is a crate at load time. Old saves have no field and get `{}`. An old
  client that loads a new save drops the labels on its next save; that loss is acceptable. Serialize `labels` only when it
  is non-empty, so label-free slices stay byte-identical to today's.
- **Which icons a player can pick**: "seen" means kinds in any crate on the raft, kinds in the actor's bag, and `st.seen`
  (studied). The host validates only `isKind`, so the picker is a UI choice, not a security issue.
- **Guest and old host**: a new guest on an old host gets the `bad` refusal at `:203`, which has no `REFUSALS` text and so
  fails silently. Gate the buttons on a slice capability flag (`v: 2` in `sliceOf`, because `labels` may be absent),
  mirroring `oldHost()` (`:320`). An old guest on a new host ignores unknown fields.
- **Texture cache**: one 128 px RGBA texture is about 85 KB with mips. An LRU of 24 keeps that under 2 MB. Key it by label
  (`k:fish` / `t:Ropes`) so ten "Fish" crates share one material.
- **Other rafts and islands**: `world.decor` holds only the player's raft, and islands, wrecks and the trader have no
  crates. A raft-local radius therefore never reaches anything else. A player standing on an island is usually more than 6
  m from every crate and gets the notice "No crates nearby with matching items".
- **Prediction**: the UI does not predict. It repaints on `api.rev`, as Put all does today (`:336`). Stash with no UI open
  is fire-and-forget, plus the notice.

Tests: extend `tests/storage-research.test.mjs`. Cover the stash conservation invariant, the hotbar left untouched, tools
keeping durability, the size cap across crates, sort as a permutation, label clean and drop on undecor and dropTile, and
the old-save round trip.

