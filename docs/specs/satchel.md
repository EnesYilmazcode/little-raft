# Woven Satchel: spec

Research: [docs/features/satchel-research.md](../features/satchel-research.md) (option a). Plain ES modules, no new deps.
Line refs are against the current checkout and give the place to edit; re-grep before you edit.

## 1. Summary

- Craft a **Woven Satchel** (`satchel`, stack 1, `tool:false`, no durability).
- **Wear it** in either of two ways: LMB while it is the held hotbar item, or the **Wear Satchel** button in the bag dialog.
  - The item is consumed and the bag gets `back:'satchel'`.
  - The bag grows **in place** from 28 to 40 slots (`SATCHEL_SLOTS = 12`). That makes 30 non-hotbar slots, 3 rows of 10.
- **Take it off** with the **Take off Satchel** button in the bag dialog.
  - Items in slots 28-39 are packed into free base slots and the satchel item goes back into the bag.
  - If anything would not fit, the whole action is refused. Items are never destroyed.
- One satchel per bag. Dive gear still works from any slot, satchel slots included (`count()` already loops every slot).
- Co-op: the host is authoritative and the guest's bag grows on the host. The feature is advertised with `HOST_CAPS.satchel`.

## 2. Item and recipe (dist/items.js)

Add the item after `glidehandle` (L205), in the same style as the instruments (L190):

```js
item('satchel', 'Woven Satchel', 'tool', { iconTint: '#a8763e', stack: 1,
  recipe: hand({ cloth: 3, rope: 4 }), unlock: discover('cloth', 'rope'),
  tip: 'A roomy woven bag. Click while holding it to wear it: 12 more bag slots.' }),
```

**FALLBACK (use only if the Loom / `cloth` kind is NOT merged when this lands; never ship both lines):**
`recipe: hand({ rope: 6, leaf: 8 }), unlock: discover('rope')`. Note the fallback in the PR so the Loom lane can switch it to
the cloth line later. The recipe is made by hand (no station). If the Loom lane decides it is made at the Loom, change only the
`recipe` line.

Also in items.js:
- Next to the mirror constants (L46-47), add `export const SATCHEL_SLOTS = 12;`. tests/items-hotbar.test.mjs keeps it equal to inventory-state.
- **`migrateSnapshot` (L641):**
  - Read `const worn = snap.back === 'satchel'` and `const n = SLOT_COUNT + (worn ? SATCHEL_SLOTS : 0)`.
  - Use `n` in three places: the `slots` allocation (L646), the `i < SLOT_COUNT` split (L673) and the overflow loop (L691).
  - Return `{ slots, selected, ...(worn ? { back: 'satchel' } : {}) }`.
  - Any other `back` value (from a future build) counts as no satchel, and the bag is squeezed into 28 slots as today.

## 3. Bag (dist/inventory-state.js)

**Constants and helpers**
- Add `export const SATCHEL_SLOTS = 12;` after L7, and `export const bagLength = back => SLOT_COUNT + (back === 'satchel' ? SATCHEL_SLOTS : 0);`.
- Add `export const isBagLength = n => n === SLOT_COUNT || n === SLOT_COUNT + SATCHEL_SLOTS;`. cookpot, kiln and storage use it.
- `emptySlots(n = SLOT_COUNT)` (L155).

**Instance state**
- Add an instance field `back = null` (`null | 'satchel'`).
- Equip and unequip bump `version`. Nothing else changes `back`.

**Constructor (L169)**
- `snapshot.back` must be `undefined`, `null` or `'satchel'`. Any other value throws `TypeError`.
- `slots.length` must equal `bagLength(back)`, so a 40-slot bag without the flag throws, and so does a 28-slot bag with it.
- Fix the error message and the validate loop (L180-188) to use that length.

**`salvage` (L218)**
- With `back === 'satchel'`, build a 40-slot bag and read up to 40 slots.
- Without the flag, read slots 0..27 as today. Then `add()` each slot above 27 (keeping durability and id, through `makeSlot` meta), so the overflow merges into the base slots instead of being dropped.

**Loops that use the constant**
- `add` (L270), `remove` (L288), `move` (L308 `isIndex(i, this.slots.length)`) and `craft` commit (L411) loop `this.slots.length`.
- `snapshot()` (L358) returns `{ slots, selected, ...(this.back ? { back: this.back } : {}) }`.
- `new Bag(bag.snapshot())` scratch copies therefore keep both the length and the flag. That covers game.js `commit` L162 and `spend` L166, progression.js:194, trader-core.js:170 and tasks.js:142, so they need no edit.

**New methods.** Both are pure and atomic, and both return `{ok:true}` or `{ok:false, reason}`.
- `equipSatchel(from)`:
  - Refuse with `'bad'` unless `isIndex(from, this.slots.length)` and `slots[from]?.kind === 'satchel'`.
  - Refuse with `'worn'` if `this.back` is already set.
  - Otherwise set `slots[from] = null` and `this.back = 'satchel'`, then `for (k<12) this.slots.push(null)` (same array object), then `version++`.
- `unequipSatchel()`:
  - Refuse with `'none'` if there is no flag.
  - On a 28-slot scratch array that is a copy of `slots[0..27]`, place each extra slot 28→39 in turn:
    - Stackables first top up base stacks of the same kind, up to maxStack.
    - The rest go to the first empty base slot as a copy that keeps `durability` and `id`.
  - Then put `{kind:'satchel', count:1}` into the first empty base slot.
  - If any step leaves something unplaced, return `{ok:false, reason:'full', need}` and change nothing. `need` is the number of extra base slots still required, which is at least 1.
  - On success:
    - Copy the scratch values into `slots[0..27]`.
    - Set `this.slots.length = SLOT_COUNT` (in place) and `this.back = null`.
    - Bump `version`.
  - `selectedIndex` is always a hotbar index, so it is unaffected.

## 4. Other bag consumers

- **cookpot-core.js:174 and kiln-core.js:136:** replace `bag.slots.length !== 28` with `!isBagLength(bag.slots.length)` (import from inventory-state).
- **storage-research.js:**
  - L204 uses `!isBagLength(bag.slots.length)`.
  - Put/take bounds (L214, L231 including the L231 tuple `srcN/dstN`) and the commit loop (L248) use `const N = bag.slots.length`.
  - The 28-slot `BLANK` in `cleanSlot` (L62) stays as it is.
- **storage-research-ui.js:**
  - The bag strip is built for `HOTBAR_SIZE..bag.slots.length` (L147).
  - The shadow arrays (L187) are sized 40 (the max).
  - The paint loops (L198, L208, L211, L216, L357) use `bag.slots.length`.
  - Rebuild the strip when the length changes. Label slots 28+ as "Satchel slot N".
- **game.js:** `snapBag` (L160), `validSnapshot` (L161), `bagsFromWorld` (L181), save cleaning (L237) and the hot-swap `bags` (L272, L2472) all go through `migrateSnapshot`, then `new Bag`, then `salvage`. They need no edit once §2 and §3 land.

## 5. Actions (engine-level, dist/game.js)

Handle these in `applyAction` (L1223), right after `moveSlot` (L1232). The host runs them on `actorBag(actor)`:

| kind | payload | host does | notice to actor (bottom-left feed via `emit`) |
|---|---|---|---|
| `satchel.equip` | `{from:int}` | if `bag.slots[from]` is not a satchel, use the first satchel slot instead; `bag.equipSatchel(i)` | ok: `Satchel on: 12 more slots` (kind `craft`, sound `craft`); `worn`: `You're already wearing a satchel`; no satchel: `You have no satchel` |
| `satchel.unequip` | `{}` | `bag.unequipSatchel()` | ok: `Satchel packed away`; `full`: `Make room in your bag first (need N free slots)` (kind `full`); `none`: ignored |

- Reject non-integer `from` silently.
- The guest **does not predict** either action. Its `remoteBag` changes size when the next acked `state` arrives (L2149-2152, `snapBag(data.bag)` keeps the flag through migrateSnapshot).
- **Local entry points** (one helper each, `equipSatchel(i)` / `unequipSatchel()`, beside `moveSlot` at L1397):
  - When `guestWaiting()`, show `Wait for your raft to connect`.
  - When a guest is connected and `hostCaps?.satchel !== 1`, show `notice('Your friend’s raft doesn’t have satchels yet')` and send nothing.
  - Otherwise `action(...)`.
- **LMB:** in `useSelected` (L1443), before `content?.use` (L1451), add `if (kind === 'satchel') { equipSatchel(localBag().selectedIndex); swing = .4; return; }`.
- **Caps:**
  - `HOST_CAPS = Object.freeze({undecor:1, satchel:1})` (L1796).
  - `hostState()` (L1799) adds `hb:hostBag.back === 'satchel' ? 1 : 0`, which the optional avatar tint in §8 uses.

## 6. Bag dialog UI (dist/survival-ui.js)

**Dynamic slot count**
- Drop the fixed `TOTAL` (L11) and use `MAX = SLOT_COUNT + SATCHEL_SLOTS` for the shadow typed arrays (L548).
- Everywhere else use `n = slots.length`:
  - `shadowSame` L553/555: return false when the length differs from the last `n`.
  - `paintInventory` L1014.
  - The sigs loops L1106-1108.
- `mountDialog` (L408-411) builds the bag grid through a new `gridHTML(n)` helper.
- **Rebuild only the grid:**
  - In the render path (after `readSnap`, L1102), if `slots.length` differs from the number of `.sv-grid` cells plus `HB`, replace `.sv-grid` innerHTML, re-index `invEls` (L528 loop, moved into a `indexSlots()` helper), cancel any picked or dragged stack (`src = null`, `held.hidden = true`) and `invalidate()`.
  - Event handlers are delegated on `dlg` (L1177-1273), so they keep working.
  - Arrow keys use rects (`arrowNeighbor`), so they adapt.
- Satchel cells (index ≥ 28) get class `sv-sat`. Labels read `Satchel slot ${i - 27}` and the aria-label reads "Satchel slot N" (L1016).
- The `sv-sat` style is a woven tint: `background:repeating-linear-gradient(45deg,#cdb383 0 4px,#c2a674 4px 8px)`, keeping the normal hover/sel/over/deny rules.

**Back control**
- Change the bag header (L430 `<h3 class="sv-h">Backpack</h3>`) into `<div class="sv-bhead"><h3 class="sv-h">Backpack</h3><button type="button" class="sv-backbtn" hidden></button></div>`.
- `.sv-bhead` is a flex row with `justify-content:space-between` and the same width as `.sv-hint` (L250).
- The button uses the `.sv-pinbtn` look (small 11px pill), so it adds no height.
- New optional factory option: `satchel:{ view:() => ({worn, have, able}), equip:() => r, unequip:() => r }`.
  - Shown as **Wear Satchel** when `!worn && have && able`.
  - Shown as **Take off Satchel** when `worn` (also needs `able`).
  - Hidden otherwise, including when the option is absent (old callers and tests).
  - Repaint the button on every inventory paint, which is cheap with a string compare.
  - Add a dialog class `sv-worn` while worn.
- **game.js** (createSurvivalUI, L2542) passes:
  - `view:() => { const b = localBag(); return { worn: b.back === 'satchel', have: b.count('satchel') > 0, able: role !== 'guest' || hostCaps?.satchel === 1 }; }`
  - `equip:guard(() => equipSatchel(localBag().slots.findIndex(s => s?.kind === 'satchel')))`
  - `unequip:guard(unequipSatchel)`
- **Pre-check:** before sending an unequip, the UI calls a pure helper `unequipNeed(slots)` exported from inventory-state.js (the same placement logic as `unequipSatchel` on a copy). If it reports `need > 0`, the UI does not send the action. It shows the same "Make room…" text in `.sv-hint` (role=status) and a `notice()`.

**Layout at 1280x720**
- The panel values are `--ph = min(600, 94vh-36) = 600px` and `--s = 56px`, `--g = 6px` (L221).
- The third bag row adds 62px to `.sv-bag` in the right column (L229), which is `justify-content:flex-end`. The detail panel above it loses that height.
- Add `@media(max-height:760px){#inventory.sv-worn{--s:52px}}`. That brings the net growth down to about +46px.
- The builder must check with a 1280x720 screenshot that the detail panel's Craft button is not clipped, using a long recipe (e.g. raft-pieces) while the satchel is worn.
- If it is still clipped, also clamp `.sv-hint` to 2 lines in `.sv-worn` (`-webkit-line-clamp:2`).

**Layout at 640x360**
- The `(max-height:520px)` rule (L352) stacks the dialog into one scrolling column with `--s:44px`.
- The extra row adds 49px inside the scroller (`.sv-wrap` `max-height:94vh; overflow:auto`).
- Grid width is 10×44 + 9×5 = 485px, which fits.
- The button sits in the bag header, so it scrolls with the bag. Check that both the recipe list (`max-height:40vh`) and the hotrow can still be reached by scrolling.
- At ≤560px wide (L356) `--s` shrinks further and nothing else changes.

## 7. Old saves, older builds, co-op edges

- **Old saves:** 28 slots and no `back`, so they load at base size. No migration is needed.
- **Older build reading a worn bag:**
  - Its `migrateSnapshot` squeezes 40 slots into 28 and merges what fits. Items that do not fit are dropped, and the satchel is lost because that build ignores the flag.
  - This is accepted, since builds rarely go backwards. Put a one-line note in the PR.
- **New guest on an old host:**
  - There are no caps, so the button is hidden and LMB shows the "doesn't have satchels yet" notice.
  - The old host also does not know the recipe or kind.
- **Old guest on a new host whose guest bag is worn:**
  - The old guest's `snapBag` squeezes the 40-slot bag for display only. The host keeps the true bag.
  - A misaligned `moveSlot` is refused or corrected by the next state. This is harmless.
- **Visiting:** your worn satchel stays with your own world. While you are away, `ownWorldBackup` (L257) keeps `back` because the snapshot carries it.

## 8. Avatar tint (optional, only if trivial)

- In dist/coop-avatar.js, `createRemoteAvatar` gets `setBack(on)`, which finds `root.getObjectByName('backpack')` (avatar.js L198):
  - scale `1.25, 1.2, 1.35`
  - material colour `#a8763e`
  - cache the original values for off
- The host calls `setBack(guestBag.back === 'satchel')`. The guest calls `setBack(data.hb === 1)`.
- Skip this section if it needs more than about 15 lines.

## 9. Tests

**New tests/satchel.test.mjs** (node:test, imports dist modules like the others; never hard-code 28, use `SLOT_COUNT`/`SATCHEL_SLOTS`):
1. `equipSatchel` removes the item, sets `back`, grows the bag to 40 on the **same array object**, and bumps `version`.
2. A second equip returns `'worn'`. A `from` pointing at a non-satchel slot or out of range returns `'bad'` and leaves the bag unchanged.
3. `add` fills slots 28-39 once the base slots are full, and `count`/`remove`/`move(5, 39)` reach them.
4. `craft` with a full 40-slot bag: the commit writes all 40 slots, and the result in slot 39 survives.
5. Unequip with room packs the extras (stack merge plus a tool with durability and id kept), puts the satchel back, and leaves length 28 with `back` null.
6. Unequip without room returns `full` with the right `need`, and the snapshot is deep-equal before and after. `unequipNeed` agrees.
7. The snapshot round-trip keeps `back`, and `new Bag(snapshot())` has 40 slots.
8. `migrateSnapshot` keeps 40 slots with the flag. An unknown `back` value squeezes into 28.
9. The constructor accepts 40 slots with the flag and a 28-slot old save. It throws for 40 without the flag, 28 with the flag, and `back:'x'`.
10. `salvage` of 40 slots without the flag merges the overflow into free base slots.
11. `isBagLength`: true for 28 and 40, false for 29 and 39.
12. `applyPotAction` and `applyKilnAction` accept a 40-slot bag. A storage-research put from slot 35 and a take into slot 39 both work.
13. Source check of survival-ui.js: no `TOTAL` loop bound, `sv-sat`/`Satchel slot` present, `satchel.equip`/`satchel.unequip` in game.js, and `HOST_CAPS` contains `satchel`.
14. Host flow (the loopback harness used by other co-op tests, if available): a guest `satchel.equip` grows `guestBag`, not `hostBag`.

**Existing tests to update:**
- **tests/survival.test.mjs:**
  - The malformed list (L268): keep the 27-slot case, and add 29, 40-unflagged and 28-flagged cases.
  - Add 40 flagged as valid.
  - The length asserts at L37/L977/L1016 stay on `SLOT_COUNT`, since the bags are unflagged.
- **tests/items-hotbar.test.mjs** (L4-8): import and assert `SATCHEL_SLOTS` equal in both modules. Add a `migrateSnapshot` flag case.
- **tests/storage-research.test.mjs:** the fuzz (L251) uses `bag.slots.length`. Add a 40-slot case.
- **tests/cookpot.test.mjs and tests/kiln.test.mjs:** add a case where a 40-slot bag is accepted.
- **tests/progression.test.mjs** (L36/L470): check the snapshot-length assumptions, which still hold because the bags are unflagged.
- **Item catalogue or recipe count tests** (e.g. craft-r2, items tests): bump the counts for the new item if they pin them.
