# Woven Satchel: research

Feature: a **Woven Satchel** that gives the player extra bag slots, inspired by Raft's Backpack. It is
crafted partly from Woven Cloth (`cloth`, from the Loom, which is being designed at the same time).
This note is research only. It contains no code.

## 1. Raft reference (WebSearch, wiki sources)

- The Backpack is **equipment**. It goes in one of the player's equipment slots, and only one can be
  worn at a time. Raft added it in Update 9 with **+5 slots** and raised that to **+10** in Update 12.
  A community guide also mentions a "Big Backpack" with +15, but no other source confirms it.
- In Raft you research it, then craft it from leather, rope and wool.
- What happens to the items in the extra slots when you take the Backpack off: no reliable source
  turned up. **We set our own rule: items are never destroyed** (see section 3).
- Sources: https://raft.gamepedia.com/Backpack?oldid=5660 , https://raft.fandom.com/wiki/Backpack?diff=21802

## 2. How the bag works today

**dist/inventory-state.js**
- `STACK_SIZE = 20` (L5), `SLOT_COUNT = 28` (L6), `HOTBAR_SIZE = 10` (L7). That gives 10 hotbar
  slots and 18 backpack slots.
- `emptySlots()` (L155) always allocates `SLOT_COUNT` slots.
- The `Bag` constructor (L169) **throws if `snapshot.slots.length !== SLOT_COUNT`** (L180). It only
  accepts `selected` in `0..HOTBAR_SIZE-1`.
- `Bag.salvage` (L218) is the lenient loader. It reads only slots `0..SLOT_COUNT-1`, so it would
  silently drop anything stored above index 27.
- `add` (L270), `remove` (L288), `move` (L308, through `isIndex(i, SLOT_COUNT)`) and `craft`
  (L411, where commit loops to `SLOT_COUNT`) all loop over the constant, not over `this.slots.length`.
- `snapshot()` (L358) returns `{slots, selected}`. It has no other fields today.
- `Bag.version` (L163) is the counter that tells observers the bag changed.

**dist/items.js**
- Holds a mirror copy, `SLOT_COUNT = 28` / `HOTBAR_SIZE = 10` (L46-47). `tests/items-hotbar.test.mjs`
  checks that the two copies stay equal.
- `migrateSnapshot` (L641) **truncates to `SLOT_COUNT`**. Slots at index 28 and above go into
  `overflow`, which is merged into free base slots; whatever still does not fit is dropped (L701).
- `game.js snapBag` runs `migrateSnapshot` before `new Bag`. Today that means a 40-slot snapshot
  would be squeezed down to 28. The same squeeze is useful for older builds, as section 3 explains.

**dist/game.js**
- `snapBag` (L160) runs `migrateSnapshot`, then `new Bag`, then falls back to `Bag.salvage`.
  `validSnapshot` is at L161.
- `commit(bag, scratch)` (L162) copies over `bag.slots.length`. It is safe only if the scratch bag
  has the same length.
- `spend` is at L166. The same scratch-and-commit pattern appears in progression.js:194,
  trader-core.js:170 and tasks.js:142.
- `bagsFromWorld` (L181) reads `w.hostInventory` / `w.guestInventory`, which the save cleaner
  produces at L237.
- `normaliseBackup` (L257): while you visit someone else's raft, your own bags sit in
  `ownWorldBackup`.
- Hot-swap transfer v3 carries `bags:{host,guest,remote}` (L272, L2472).
- Co-op works as follows:
  - **The host is authoritative.** `actorBag = actor => actor==='guest' ? guestBag : hostBag` (L392).
  - `localBag()` (L391) returns `remoteBag` for a connected guest.
  - Guests send actions. `applyAction` (L1223) handles `selectSlot` and `moveSlot` (L1232) on
    `actorBag(actor)`.
  - The guest also predicts the result locally (L1399).
  - The host sends `{type:'state', caps:HOST_CAPS, bag:guestBag.snapshot()}` (L1799). The guest
    keeps it as `remoteBag = snapBag(data.bag)` once acked (L2149-2152).
  - `HOST_CAPS = {undecor:1}` (L1796) is the existing switch for feature detection. Guests do not
    send caps.
  - The `guestBag` lives in the **host's** world save, so a satchel equipped on your own raft does
    not come with you when you visit someone else's raft. This matches how all bag contents work today.

**dist/survival-ui.js**
- `HB = HOTBAR_SIZE` and `TOTAL = SLOT_COUNT` are fixed when the module loads (L10-11).
- `mountDialog` (L408) rebuilds the grid only when the version tag or the number of
  `.sv-slot[data-index]` elements changes. It makes the bag slots `HB..TOTAL-1` plus a hotbar row.
- The grid has `repeat(${HB}, var(--s))` columns, so it is **10 wide** (L232). Today 18 bag slots
  fill 2 rows (10 + 8).
- The fast-path shadow arrays are sized `TOTAL` (L548). `shadowSame` returns false whenever the
  length is not `TOTAL` (L553).
- `paintInventory` loops over `TOTAL` (L1014). Slot labels read "Backpack slot N".
- Layout:
  - At 1280x720: `--s:min(56px, ...)` and `--ph:min(600px, 94vh-36px)`. Crafting is on the left;
    the detail panel sits above the backpack on the right.
  - At 640x360: the `max-height:520px` rule stacks everything into one scrolling column with
    `--s:44px`, and `max-width:560px` sets `--s:min(36px, ...)`.

**dist/diving-gear*.js**
- There is **no equipment slot system**. Gear "works while it is in your bag": `gearMask(count)`
  in diving-gear-core.js L13, and diving-gear.js L69/L100 poll `ctx.localBag().count(k)`.
- dist/armor.js is foundation armor for raft tiles, not something the player wears.
- dist/avatar.js L196-203 already draws a **backpack mesh** (`'backpack'`) on every avatar. It
  could be shown or tinted when a satchel is worn, but that is optional.

**Hard-coded 28 and code that depends on `SLOT_COUNT`**
- `cookpot-core.js:174` and `kiln-core.js:136` reject any bag where `slots.length !== 28`.
  **A bigger bag would silently break the Cook Pot and the Kiln.**
- storage-research.js:
  - The action rejects `bag.slots.length !== SLOT_COUNT` (L204).
  - It uses `SLOT_COUNT` for the `put`/`take` index bounds (L214, L231) and for the commit loop (L248).
  - `cleanSlot` uses a 28-slot `BLANK` (L62). That one is fine.
- storage-research-ui.js renders slots `HOTBAR_SIZE..SLOT_COUNT` (L147, L187-216, L357).
- About 25 other modules loop over `bag.slots.length`. Those adapt to a bigger bag on their own.

## 3. Design options

**(a) Equipment flag that grows the bag (recommended).** Equipping is an action, `equipSatchel {from}`.
It removes the satchel item from slot `from` and sets `bag.back = 'satchel'`. The bag then grows
**in place** by `SATCHEL_SLOTS` (pushing onto the same array keeps outside references valid).
- Unequipping is the only way the extra space can go away, so there is exactly one place to guard.
- `snapshot()` adds `back:'satchel'` and returns the longer `slots`. The constructor and `salvage`
  accept a length of `SLOT_COUNT` without the flag, or `SLOT_COUNT + SATCHEL_SLOTS` with it.
  Any other length throws, as today.
- The flag has to survive the trip through `migrateSnapshot` (items.js).

**(b) A satchel anywhere in the bag unlocks the slots.** This would reuse the diving-gear pattern,
but there are far too many ways for the item to leave the bag:
- crafting ingredient (`remove`)
- `storage.put` / `putAll` into a crate
- trader
- decor placement
- `remove` through scratch-and-commit in other modules

Each of these would need an "extra slots occupied" guard. Missing one would truncate or destroy
items. **Rejected.**

**(c) Placed or worn toggle.** Variant of (a) with a world prop. It adds world state for no gain. Rejected.

**Recommended rules for (a)**
- **Slot count:** `SATCHEL_SLOTS = 12`. That makes 18 + 12 = 30 bag slots, exactly 3 rows of 10 in
  the existing grid. Raft's +10 would leave a ragged row. If we stay faithful to Raft, the count is 10.
- **Unequip** (`unequipSatchel`):
  1. Move the items from the extra slots into free base slots.
  2. If anything does not fit, refuse with "Make room in your bag first". Nothing changes and
     nothing is ever destroyed.
  3. The satchel itself also needs a free base slot.
  4. Do the whole thing on a scratch copy and commit only if every step worked.
- **Equipping** is done with E or a click on the satchel item, or from a small "Back" slot next to
  the bag grid. A second satchel cannot be equipped (the button is refused or hidden).
- **Crafting:** for example `satchel: {cloth: 4, rope: 3, leaf: 4}` at the Loom or by hand, whichever
  the Loom lane decides. maxStack is 1, and it is not a tool, so it has no durability.
- **Save compatibility:**
  - Old saves have 28 slots and no flag, so they load at base size. No migration is needed.
  - When an older build reads a 40-slot save, `new Bag` throws. `snapBag` has already run that
    build's `migrateSnapshot`, which packs the overflow into free base slots, so items survive when
    there is room.
  - In that case the satchel itself is lost, because the old build ignores the flag. This is
    acceptable, since builds rarely go backwards. Write it down.
- **Co-op:**
  - Equip and unequip are host-applied actions on `actorBag(actor)`. The guest learns the new size
    from the `bag` snapshot in `state`.
  - Add `HOST_CAPS.satchel = 1`. A new guest on an old host hides the equip control and shows
    `OLD_HOST`-style text.
  - The guest's local prediction for `moveSlot` already works on the bigger `remoteBag`.
  - An old host would reject `moveSlot` with an index of 28 or more (`isIndex`). That is harmless.
- **UI:**
  - The grid is built from `bag.slots.length` instead of `TOTAL`. Rebuild when the length changes;
    the `mountDialog` check at L408 already compares slot counts.
  - Extra slots get a woven tint and the label "Satchel slot N".
  - At 1280x720 the extra row costs about 62px of the right column inside the 600px panel, so the
    detail panel loses that height. Check that it still fits, or drop `--s` to 52px when equipped.
  - At 640x360 the column layout already scrolls. Check that the craft list and bag remain reachable.

## 4. Risks

1. **Cook Pot, Kiln and crates break with a bigger bag.** They check for exactly 28 slots (cookpot-core
   L174, kiln-core L136, storage-research L204). Change these to accept either legal length (an
   `isBagLength` helper exported from inventory-state).
2. **Bag methods loop over `SLOT_COUNT`.** All of them must use `this.slots.length`. If one is missed,
   the extra slots fill up but `remove` and `count` disagree, or `craft` commits only 28 slots.
3. **Scratch-and-commit pattern.** `new Bag(bag.snapshot())` must keep the flag and length, or `commit`
   copies `undefined` into slots 28-39.
4. **`migrateSnapshot` truncation** in the new build would squeeze an equipped bag back to 28 on every
   load and co-op sync. It must read `back`.
5. **Older builds** lose the satchel and any overflow that does not fit (see section 3).
6. **Phone height:** an extra row in the stacked layout at 640x360. **Desktop:** the 600px column at 1280x720.
7. **Fullness tests:** many tests fill `SLOT_COUNT` slots to make a "full bag". With the flag off they
   still pass. This is the main reason the base size stays 28 and the growth is opt-in per bag.

## 5. Tests to update or add

- **To update:**
  - `tests/survival.test.mjs`: the malformed-snapshot list at L268 (keep 27 as bad, add 29 and 40
    without the flag as bad, and 40 with the flag as good), plus the length asserts at L37/L977/L1016.
  - `tests/items-hotbar.test.mjs`: mirror the new constant and the `migrateSnapshot` flag.
  - `tests/storage-research.test.mjs`: the fuzz at L251 uses `SLOT_COUNT` bounds. Add a 40-slot case.
  - `tests/cookpot.test.mjs` and the kiln tests: add a case where a 40-slot bag is accepted.
  - `tests/progression.test.mjs` L36/L470: snapshot length assumptions.
  - Tests that build bags with a literal `Array(28)`: trader, spear-repair, armor, onboarding. These
    are fine as they are, but should not hard-code 28 in new tests.
- **To add:** `tests/satchel.test.mjs`
  - equip grows the bag to 40 and consumes the item
  - a second equip is refused
  - unequip compacts the extra slots into the base, refuses when they do not fit and changes nothing
  - snapshot round-trip keeps `back`
  - `snapBag`/`migrateSnapshot` keeps 40 slots
  - an old 28-slot save loads at base size
  - a 40-slot snapshot without the flag is rejected (strict) or salvaged into 28 (lenient) with
    overflow merged
  - host applies guest equip/unequip on `guestBag`
  - `add` fills the extra slots
  - `craft` commit with 40 slots
  - the survival-ui grid shows 30 bag cells when equipped, using the static source check the other
    UI tests use
