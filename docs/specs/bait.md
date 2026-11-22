# Fishing Bait: spec

Three craftable bait tiers for the Fishing Rod. The best bait in the bag goes on the hook automatically when a cast is
released. Bait shortens the wait for a bite and makes rarer fish more likely. One bait is used up only when a fish is
**landed**: an escape, an early click, a slip or a cancel never costs bait. No damage, no wear. Research:
`docs/features/bait-research.md`. Line refs are for branch `claude/loop-features-202611210953`.

## 1. Items (`dist/items.js`, insert after `fishtrap`, line 273-274)
| id | name | category | stack | recipe (hand) | unlock | iconTint |
|---|---|---|---|---|---|---|
| `seaweedbait` | Seaweed Bait | `'material'` | 20 | `hand({ seaweed: 2 }, 3)` | `discover('seaweed', 'fishingrod')` | `#4f9a5c` |
| `chumbait` | Fish Chum | `'material'` | 20 | `hand({ fish: 1, seaweed: 1 }, 3)` | `discover('fish')` | `#b07a5a` |
| `goldbait` | Golden Bait | `'material'` | 20 | `hand({ honey: 1, fish: 1, seaweed: 1 }, 2)` | `discover('honey', 'fish')` | `#f2b134` |

- Kind names checked: `seaweed` (items.js:107), `fish` (:118) and `honey` (:112) are `ITEMS` entries.
- **Change from the research table: Golden Bait drops `puffegg`.** `puffegg` is a content kind (`content-items.js:31`),
  not an `ITEMS` key. `progression.test.mjs:126-138` asserts that every items.js recipe and unlock kind is in `ITEMS`,
  and the reachability test (`:190-204`) would never reach it. Seaweed takes its place.
- Tips (the `tip:` field):
  - Seaweed Bait: "A soggy little wad of seaweed. Hold your rod with some in the bag and the fish come sooner."
  - Fish Chum: "Chopped fish and seaweed. Rare fish can't resist it."
  - Golden Bait: "Honey-sweet and shiny. Even the Golden Sunscale takes a peek."
- No `icon` option, so each one is `placeholder: true` with icon `icon-<id>`. Draw all three in `item-svg.js` `ITEM_ICONS`
  next to `fishtrap` (:508): a green wad with a tiny hook, a small pail with pink bits, and a gold pellet with a sparkle.
- `craft-book.js:29`: add `seaweedbait: 'survival', chumbait: 'survival', goldbait: 'survival', // [bait]`.
- `craft-book.js` `ITEM_TEXT` (next to :177):
  - seaweedbait: desc "A soggy wad of seaweed bait.", use "Keep it in your bag: bites come sooner."
  - chumbait: desc "A pail of fish chum.", use "Faster bites and more rare fish."
  - goldbait: desc "Sweet golden bait.", use "The best bait: much faster bites, far more rare and legendary fish."
- Crafted items get their tooltip source from their recipe, so no `ITEM_SOURCE` rows are needed.
- The fish trap stays on raw seaweed (`fish-trap.js:311-318`), and its `rollCatch` call is unchanged.

## 2. Pure bait module: new `dist/bait.js` (no imports, frozen data)
```js
export const BAIT_ORDER = Object.freeze(['seaweedbait', 'chumbait', 'goldbait']); // low -> high
export const BAIT = deepFreeze({
  seaweedbait: { id: 'seaweedbait', name: 'Seaweed Bait', short: 'Seaweed', wait: 0.7,  boost: { uncommon: 1.3 } },
  chumbait:    { id: 'chumbait',    name: 'Fish Chum',    short: 'Chum',    wait: 0.55, boost: { rare: 1.6, legendary: 1.6 } },
  goldbait:    { id: 'goldbait',    name: 'Golden Bait',  short: 'Golden',  wait: 0.5,  boost: { rare: 2, legendary: 3 } },
});
export const BAIT_FLOOR = 1.5;               // seconds: bait never makes a wait shorter than this
export const PREFS = ['auto', ...BAIT_ORDER, 'none'];
isBait(id) -> bool                           // Object.hasOwn(BAIT, id)
baitWait(sec, id) -> sec                     // no bait: sec unchanged; else Math.min(sec, Math.max(BAIT_FLOOR, sec * wait))
pickBait(pref, count) -> id | null           // count(k) -> n. 'none' -> null; an owned tier pref -> that tier;
                                             // anything else (auto, or a tier you ran out of) -> best owned, else null
nextPref(pref, count) -> pref                // cycle: 'auto' -> each owned tier, low to high -> 'none' -> 'auto'.
                                             // A pref that is no longer in the list restarts the cycle from 'auto'.
baitLabel(pref, count) -> { text, dim }      // chip text, see section 5
```
- The `Math.min` keeps bait from ever being slower than no bait. Unbaited missed-bite waits can be as short as 1.2 s
  (herring 2 s × 0.6), and those stay as they are.
- `name` must equal `ITEMS[id].name`, which a test checks. bait.js has no imports, so fish-species and fishing-v2 can use it.

## 3. Catch effects
**`fish-species.js` `weightOf` (:63-68) and `rollCatch` (:78-87)**
- `rollCatch(rand, { charge, night, boost = null })` passes `boost` to `weightOf`.
- In `weightOf`, after the time-of-day line: `const m = Number(boost?.[s.rarity]); if (m > 0 && Number.isFinite(m)) w *= m;`
- **There are still exactly three `rand()` draws.** With `boost` null or missing, the weights are identical, so the seeded
  tests (`fc-species-journal.test.mjs:35-71`) and the fish trap do not change.

**`fishing-v2.js`**
- The constructor (:25) gets `this.bait = null`. Add `setBait(id) { this.bait = isBait(id) ? id : null; }`.
  Import `{ BAIT, isBait, baitWait }` from `./bait.js?build=v3-survival-ae77fa84ac2b`.
- `:80` becomes `this._startWait(baitWait(this._range(F.wait) * (1 - 0.3 * this.charge), this.bait))`. The bait factor is
  applied after the charge factor.
- `:95` becomes `this._startWait(baitWait(biteDelay(this.rand, this.catch.species) * 0.6, this.bait))`.
- `:43` and `:67` pass `boost: BAIT[this.bait]?.boost ?? null` to `rollCatch`.
- `baitWait` makes no draws, so with `bait` null every event and timing is the same as today.
- Daytime odds at charge 0.5 (recomputed from `RARITY`; the research table's Chum row was off):

  | Bait | Rare or better | Legendary | First wait at charge 0.5 |
  |---|---|---|---|
  | None | 16.1% | 2.7% | 3.4-7.65 s |
  | Seaweed | 15.2% | 2.5% | 2.4-5.4 s |
  | Chum | 23.5% | 3.9% | 1.9-4.2 s |
  | Golden | 29.4% | 6.8% | 1.7-3.8 s |

  Seaweed bait raises the uncommon share from 19.5% to 24%.

## 4. Glue (`dist/fishing-cooking.js`)
- State lives in memory only: `let baitPref = 'auto'`, and it resets to `'auto'` on every reload.
  `const count = (k) => host.bagCount(k)`.
- **Freeze at release.** In `pointerUp` (:276), inside `if (wasCharging && session.stage === 'flying')`, call
  `session.setBait(pickBait(baitPref, count))`. That is the only place bait is chosen.
  - A bag change during the wait cannot change the odds.
  - `debug.forceBite` (:461) stays unbaited.
- **Landing.** `onFishEvent` 'caught' (:317) becomes `onCatch(ev.catch, session?.bait ?? null)`.
- In `onCatch(c, bait = null)` (:288):
  - `:291` becomes `host.action(bait ? { kind: 'fish', bait } : { kind: 'fish' })`. The field is sent only when a bait was
    frozen, so unbaited traffic is byte-identical.
  - If `bait`, call `journal.recordBait(bait)` (counted locally on every landed baited catch).
  - The plain-catch toast at `:298` becomes `${BAIT[bait].name} worked! ${sp.name} · ${cm} cm` when
    `BAIT[bait]?.boost[sp.rarity] > 1`. Otherwise it stays `Caught a …`. No extra toast is added.
- **Right-click cycle.** Add `alt()` to the returned api (:468). The body is:
  `if (host.selectedKind() !== 'fishingrod' || !host.running() || host.uiBlocked()) return false;`
  then `baitPref = nextPref(baitPref, count); host.notice(text, 1600); host.beep(700); return true;`
  Notices: `Bait: Auto · Fish Chum ×7` (best owned), `Bait: Auto · none in your bag`, `Bait: Seaweed Bait ×12`,
  `Bait: off`; each gets ` (next cast)` appended while a line is out (stage not idle, charging or done).
- **Prompt** (`computePrompt` :331). For `waiting` or `nibble` with `session.bait`, the text is
  `` `Waiting for a bite… · ${esc(BAIT[session.bait].name)} (click early and it’ll spook)` ``. Unbaited text is unchanged,
  which `loop-ux-hud.test.mjs:52` checks. `fc.prompt` is a key-less context prompt and beats the key-less state prompt
  (prompts.js:223-224), so there is no new provider and no new centred element.

## 5. HUD bait chip
- Add `#fcBait` (a `<b aria-hidden="true">`) to the fc CSS (:23-31). Each frame in `updateDom` (:212), append it to
  `document.querySelector('.tools')` when it is not connected. If there is no `.tools` element (tests or the title
  screen), skip the chip.
- CSS: `position:absolute; left:calc(var(--px) + var(--s) / 2); bottom:calc(100% - 4px); z-index:3; pointer-events:none;
  transform:translateX(calc(var(--i,0) * (var(--s) + var(--g)) - 50%)); font:700 11px/1 system-ui; padding:3px 7px;
  border-radius:8px; color:#fffdf4; background:#2d5a3acc; white-space:nowrap`.
  - `.dim` sets the background to `#0d2a3a88` and opacity to .8.
  - The chip sits over the top edge of the rod's slot, below the `.sv-label` name tag (`bottom:100%+12px`).
- Visible only while `host.running()` and `host.selectedKind() === 'fishingrod'`. `--i` is `host.slot?.() ?? 0`. Add
  `slot:() => localBag().selectedIndex` to `fcHost()` (`game.js:565-568`).
- `baitLabel` text: `🪱 Fish Chum ×7` (the bait the next cast would use, or the frozen bait while a line is out);
  `No bait` (dim) for auto with nothing owned; `Bait off` (dim) for pref `none`.
- **Write only on change.** Cache the key `` `${text}|${dim}|${i}|${shown}` `` and touch `textContent`, `className`, `--i`
  and `hidden` only when that key changes. `dispose()` removes the element.

## 6. Input hooks (`dist/game.js`)
- Mouse: insert one line after `:1901` (the hammer wheel), before the `content.alt` line (:1902):
  `if (e.button === 2 && running && !uiBlocked() && heldKind() === 'fishingrod' && fc?.alt?.()) return; // [bait]`.
  The context menu is already suppressed (:1941), and the rod has no other right-click use.
- Pad: `reelDown` (:1999) becomes
  `reelDown:() => { if (castOut()) reeling = true; else if (heldKind() === 'fishingrod') fc?.alt?.(); }`.
  LT only matters while a hook cast is out.
- Touch has no cycle. Auto stays the default.

## 7. Host consumption (`game.js:1347-1351`)
```js
if (a.kind === 'fish') {
  if (bag.count('fishingrod') < 1) return;
  if (bag.add('fish', 1) > 0) { emit({kind:'full', text:'Bag full: the fish swam away'}, actor); return; } // no bait eaten
  if (isBait(a.bait) && bag.count(a.bait) > 0) bag.remove(a.bait, 1); // [bait] stale/missing bait: fish still granted
  world.fish++; ...unchanged
```
- Import `{ isBait }` from `./bait.js?build=v3-survival-ae77fa84ac2b` beside `:28`.
- Junk `a.bait` (not a string, an unknown id, `'fish'`) is ignored, so the field can never remove another kind.
- The rod check is unchanged, and there is no wear call.

## 8. Co-op flow
1. The guest releases a cast. `pickBait` reads `host.bagCount`, which is the host-synced `remoteBag` (`game.js:2154`),
   and the guest freezes the bait locally.
2. The guest rolls with its own `Math.random` and the boost. Rolls are never compared between peers.
3. On landing the guest sends `{kind:'fish', bait}`. The host checks the guest's rod, adds the fish, and removes 1 bait
   from the guest's bag. The bag sync then updates the guest's chip.
4. A host removal that arrives late, or a partner moving bait into a chest mid-wait, can give one free baited catch.
   That is friendly and accepted.
- Old host + new guest: `a.bait` is ignored, so bait is never used up (harmless). New host + old guest: no field, no change.
- The `catchFx` message (:304) is unchanged.

## 9. Journal and saves (`dist/fish-journal.js`)
- Constructor (:29-44): `this.baited = {}`. Read `s.baited` when `isObj` is true, keeping only `isBait(k)` keys with
  `int(v, 0, 1e9, 0) > 0`.
- `recordBait(id)`: when `isBait(id)`, `baited[id]++` and return true. `get baitedTotal()` sums the counts.
- `snapshot()` (:86-90) adds `baited: { ...this.baited }` **only when it is non-empty**. That keeps
  `fc-species-journal.test.mjs:141` (`{species,dishes,basket}`) green.
- Panel: `prog.textContent` (:210) appends ` · ${n} caught with bait` when `n > 0`.
- `FC_SAVE_KEY` stays `{v:1}`.
  - An old save loads with `baited` as `{}`.
  - An old build ignores the unknown `baited` field and drops it on its next save. That is fine.
- New bag kinds: like every items.js addition, an older build rejects a bag containing bait (`content-items.js:4`).
  New builds load old saves fine, and `migrateSnapshot` passes the kinds (`bag-roundtrip.test.mjs`).
- No new achievement this round. `logbook.test.mjs:22` stays at 17, and `award({kind:'fish'})` is unchanged.

## 10. Tests
**New `tests/bait.test.mjs`**
1. Each `BAIT_ORDER` id is in `ITEMS` (material, stack 20, hand recipe as in section 1, no `puffegg`), in `ITEM_INFO` and `RECIPES`, and `ITEMS[id].name === BAIT[id].name`.
2. `baitWait`: (6, null) → 6; (6, 'goldbait') → 3; (2, 'goldbait') → 1.5; (1.2, 'chumbait') → 1.2 (never slower); a junk id leaves it unchanged.
3. `pickBait`: auto picks gold > chum > seaweed; an owned tier pref wins; a pref for a tier you ran out of falls back to the best owned; 'none' and an empty bag → null.
4. `nextPref`: with chum and gold owned, auto → chumbait → goldbait → none → auto; with nothing owned, auto → none → auto; a stale pref restarts the cycle.
5. `rollCatch` with `boost` null deep-equals no option over 200 seeded rolls; it makes 3 rand() calls either way. The weight-derived shares match the section 3 table to ±0.5%.
6. `FishingSession`: the same seeded rand without bait gives today's event and time sequence; a `goldbait` session lands sooner, and its wait is ≥ 1.5 s.
7. Journal: `recordBait` counts and rejects junk ids; an old snapshot gives `baited` {}; an empty `baited` is left out of the snapshot; the round trip keeps the counts.
8. Glue (`fc-glue` host stub): the bait frozen at release is sent as `{kind:'fish', bait}`; an unbaited catch sends exactly `{kind:'fish'}`; bag changes mid-wait do not change `session.bait`; escape and cancel send nothing; `alt()` cycles and notices, and returns false without the rod; the waiting prompt has the bait name.
9. Host source check: `game.js` removes bait only after a successful `bag.add('fish', 1)`, and only through `isBait`.

**Existing tests to update or rerun**
- Update: `craft-ux.test.mjs:124-131,170-182` (`sourceOf`/`tipFacts` for every key: needs the recipes and `tip`), `survival.test.mjs:556` (`ITEM_TEXT` rows), the `craft-book.js:24-29` tab map, `progression.test.mjs` (recipe kinds, reachability, icons; this is why `puffegg` was dropped).
- Should not change, but run to confirm: `storage-research.test.mjs:283-290,479` (items.js recipes are `ownedElsewhere`, so `learnedFrom` lists stay the same), `item-icons.test.mjs` (the bait items are placeholders, not in `SPRITES`), `bag-roundtrip.test.mjs:12`.
- Rerun: `fc-fishing`, `fc-glue`, `fc-dom`, `fc-species-journal`, `fc-cooking`, `fishing`, `loop-ux-fishing`, `loop-ux-hud`, `fish-trap`, `prompts`, `content-prompts`, `logbook`.
