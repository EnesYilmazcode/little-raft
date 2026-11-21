# Fishing Bait: research notes

Craftable bait for the rod. One bait is used up per **landed** fish. It shortens the wait for a bite and
makes rare fish more likely. It stays friendly: a fish that escapes or a cancelled cast never costs bait,
and nothing is ever lost. Line numbers are for branch `claude/loop-features-202611210953`.

## 1. Raft's bait (inspiration only)
- Raft has three tiers: Simple, Advanced and Expert. In Raft the player cannot craft bait. It is bought at
  trading posts (Simple costs 1 Trash Cube), and the higher tiers unlock as trading-post reputation rises.
- To bait the hook, the player holds the rod and right-clicks to put bait on the line. A baited line is
  the only way to catch that tier's rare fish (Simple: Glowshrimp, Netnibbler, Sharp Charp. Advanced:
  Foamspitter, Pufferlisk, Trap Snapper. Expert: Lionfish, Lunarfish, Pentapus and others). Which rare fish
  bites is random. The sources do not give exact bite times.
- What we take from it: tiers, right-click loading, and bait that pushes the odds toward rarer fish. We do
  **not** take the trader-only supply, the reputation gating or the bait-only species. Our bait is crafted
  from items we already have, and every species can still be caught without bait.
- Sources: pcgamer.com/raft-how-to-get-bait-fishing-rod, bisecthosting.com/blog/raft-fishing-bait-stats-location-crafting-recipe-trader, gamertweak.com/fishing-bait-raft

## 2. How fishing works today
**Pure state machine:** `dist/fishing-v2.js`
- `FISHING_TUNING` (`:15-21`): `wait: [4, 9]` s, `nibbleCount`, `biteWindow 1.1`.
- `new FishingSession({ rand, night })` (`:25`).
- `_startWait(sec)` (`:34`). The first wait is `_range(F.wait) * (1 - 0.3*charge)` (`:80`).
- After a missed bite: `biteDelay(rand, species) * 0.6` (`:95`).
- The species is rolled at the bite: `_bite()` calls `rollCatch(this.rand, {charge, night})` (`:42-45`).
- `debugForceBite` (`:64-71`).
- Plan: add a `bait` option here. It scales `_startWait` and is passed into `rollCatch`.

**Click rules:** `dist/fishing-rules.js`
- `releaseShouldFire`, `castInput` and `castPrompt` (`:1-22`) are for the legacy hook-style rod cast in
  game.js. They have nothing to do with bait.

**Rod model:** `dist/fishing-tool.js`
- The procedural bamboo rod. `userData.float` and `leader` (`:16-18`) are hidden while the line is out.
- Optional visual: tint the float or add a tiny bead when bait is loaded. Not needed.

**Species table:** `dist/fish-species.js`
- `RARITY` weights (`:16-21`): common 60, uncommon 28, rare 10, legendary 2.
- 8 `SPECIES` (`:26-51`): pomfret, herring and tilapia (common); mackerel and catfish (uncommon, catfish
  at night); salmon and tuna (rare, tuna by day); sunscale (legendary, day).
- `weightOf` (`:63-68`): rare and legendary get `*(1+0.5*charge)`, and a time-of-day mismatch gets `*0.3`.
- `rollCatch` (`:78-87`) always makes exactly **three** `rand()` draws: one for the species, two for the
  size. `biteDelay` (`:89-92`).
- **Note:** `night` is always passed as `false` (`fishing-cooking.js:261,267,461`), so catfish is always
  down-weighted. `game.js:471` already exposes `night: () => content?.night?.()`. Fixing this is out of
  scope, but it is cheap to do at the same time.

**Journal:** `dist/fish-journal.js`
- `Journal` is pure. `recordCatch({species,cm,stars})` (`:46-55`) returns `{isNew,isRecord,basketed}`.
  `snapshot()` (`:86-90`) returns `{species, dishes, basket}`.
- The constructor sanitises old or junk saves (`:29-44`), so a new optional field is safe if it gets the
  same cleaning.

**Glue:** `dist/fishing-cooking.js`
- `pointerDown` and `pointerUp` (`:263-278`) create the `FishingSession` and cast. `onFishEvent` is at
  `:304-313`.
- `onCatch` (`:286-314`) records the catch in the journal locally, then calls `host.action({kind:'fish'})`.
  It also shows the notice and toasts.
- Prompt strings come from `computePrompt` (`:325-331`). game.js shows `fc.prompt` (`game.js:791`) and
  passes it to `raftPrompts` through the `game-context` provider (`game.js:1830`).
- `#fcChip` (`:26-28`, `:220`) shows "Fish n/8 · J" at the bottom left. It moves to the top on screens
  narrower than 900px.
- The journal and grills are saved under localStorage `little-raft-fc-v1` as `{v:1, journal, grills}`.

**Fish trap:** `dist/fish-trap.js`
- This is the only bait in the game today. Seaweed is used directly: `fishtrap.bait` (`:311-318`) does
  `bag.remove('seaweed', 1)` and gives `b = BAIT_PER = 5` catches.
- Baited traps fill faster: `BAIT_SEC 150` against `CATCH_SEC 240` (`:9`), so ×0.625.
- Baited traps are luckier: `rollCatch(..., {charge: e.b > 0 ? .8 : .3})` (`:113`).
- **Reuse these semantics:** our lowest tier gives the same "×~0.65 wait, small rare boost" feel, and
  seaweed keeps meaning "bait".
- Keep the trap on raw seaweed. Optionally, it could also accept the new bait items later.

**Co-op**
- Each client runs its own `FishingSession` and rolls the catch with `Math.random`. The guest rolls too.
- The journal is per player and local. The host only sees the generic `{kind:'fish'}` action.
- The host handler (`game.js:1347-1351`) needs a `fishingrod` in the actor's bag. It adds `fish` ×1 and
  `world.fish++`, emits loot, then runs `award({kind:'fish'})` and `content.observe`.
- `fc:*` actions (grills) are host-authoritative through `applyAction` (`game.js:1228`).
- A guest's `host.bagCount(k)` reads the host-synced bag (`remoteBag`, `game.js:2154`).

**Rod durability**
- `items.js:167-170` gives `fishingrod` `durability: 40` and repair costs `wood 1, rope 2` (`items.js:387`).
- The rod v2 path never wears it: the `fish` action has no wear call, and `wearHook` (`game.js:1216`)
  only runs on hook throws.
- So bait does not interact with wear. Do not add wear here.

**Where bait comes from: auto-use from the bag (recommended)**
- When a cast is released, pick the best bait tier the bag holds (`host.bagCount`) and freeze it on the
  session (`session.bait`).
- No slot UI and no new save state are needed, and it works the same with gamepad and touch.

**Right-click with the rod is free (optional)**
- `game.js:1901` handles only the hammer, and `game.js:1902` calls `content.alt(aim, heldKind())`. Only
  paint implements it (`paint.js:238`).
- The spyglass uses `'aim'` (Mouse2 / Pad6, `input-map.js:48`) only while the spyglass or binoculars are
  held (`spyglass.js:115,141`).
- Pad LT is "reel" (`controls.js:77`). It only does something while a hook cast is out.
- Option: add `fc?.alt?.()` next to line 1902 so right-click cycles "Best bait / Seaweed / Chum /
  Golden / No bait". Keep the choice in memory only. Auto-best remains the default.

## 3. Proposal

**Bait tiers.** New `items.js` entries: category `'material'`, stack 20, hand recipe.

| id | name | recipe → count | unlock | bite wait | rarity effect |
|---|---|---|---|---|---|
| `seaweedbait` | Seaweed Bait | seaweed 2 → 3 | discover('seaweed','fishingrod') | ×0.7 | uncommon ×1.3 |
| `chumbait` | Fish Chum | fish 1 + seaweed 1 → 3 | discover('fish') | ×0.55 | rare & legendary ×1.6 |
| `goldbait` | Golden Bait | puffegg 1 + honey 1 + fish 1 → 2 | discover('honey','puffegg') | ×0.5 | rare ×2, legendary ×3 |

- **Rules:** the wait multiplier applies to every `_startWait`. It is applied after the charge factor, and
  the result never goes below 1.5 s. The rarity multiplier is applied inside `weightOf`.
- **Keep the default path unchanged.** With `bait` undefined, everything behaves exactly as it does now,
  and `rollCatch` still makes three draws. Seeded tests (`fc-species-journal.test.mjs:35-71`) stay green.
- **Daytime odds at charge 0.5, from the weights above:**

  | Bait | Rare or better | Legendary |
  |---|---|---|
  | None | ≈16% | 2.7% |
  | Chum | ≈19% | 3.7% |
  | Golden | ≈30% | 6.8% |

  Seaweed bait mainly speeds things up.
- **Consumption, on catch only:** in `onCatch` the call becomes `host.action({kind:'fish', bait:id})`. The
  host does `bag.remove(id, 1)` when the actor has one. If it is missing (stale guest view), nothing
  happens and the fish is still granted.
  - A wait timeout, an early click, a snapped line or a cancel never consume bait.
  - A full bag still eats nothing: the fish is refused before the bait is removed.

**HUD**
- Add a small chip `🪱 Chum ×7` near the **rod's hotbar slot**: a badge on the `.sv-hotbar` slot
  (`survival-ui.js:898`), or next to `#fcChip`. Never in the screen centre.
- Show it only while the rod is held. When there is no bait, show a dim "No bait" chip.
- The reel HUD (`#fcReelHud`, off centre) stays as it is.
- Toast on a baited rare catch: "Golden Bait worked! Salmon".
- Prompt while waiting: "Waiting for a bite… (Fish Chum)".

**Journal and achievements**
- Add an optional `baited: {seaweedbait:n,...}` counter to the `Journal` snapshot. Sanitise it like
  `dishes`; old saves load as `{}`.
- Add a journal panel line "Caught with bait: n". Optionally store `bait` on basket items (cleaned and
  ignored by the grill).
- Optional achievement "Golden Hour" (legendary caught on Golden Bait), via `award({kind:'fish', bait})`.
  `logbook.test.mjs:22` asserts that `ACHIEVEMENTS.length === 17`, so that test must be bumped.
- Tasks could `observe({kind:'bait'})`.

## 4. Risks
- **Determinism and co-op.** Catch rolls are local `Math.random` and are never compared between peers, so
  bait does not need a shared seed. Two rules:
  - Never add `rand()` draws to `rollCatch`.
  - Freeze the bait when the cast is released, so that a bag change mid-wait cannot alter the odds.
- **Old peers.**
  - An old host ignores `a.bait`: the bait is never consumed, which is harmless and free.
  - An old guest never sends it.
  - The guest's boost reads its synced bag, and the host removes the bait authoritatively.
- **Old saves.**
  - New item kinds: `content-items.js:4` notes that older builds reject unknown kinds. Use `items.js` ids
    and check `migrateSnapshot` (`bag-roundtrip.test.mjs`).
  - The journal field is optional. `FC_SAVE_KEY` stays `v:1`.
- **Tests that enumerate items or recipes.** Each new item needs entries in all of these:
  - `craft-ux.test.mjs:130,153,180`: `ITEM_SOURCE` / `sourceOf` and `tipFacts` for every `ITEMS` key.
  - `survival.test.mjs:556`: `CB.ITEM_TEXT[k].desc/use` for every `ITEM_INFO` kind (`craft-book.js:130-177`).
  - `craft-book.js:24-29`: the tab category map.
  - `bag-roundtrip.test.mjs:12`.
  - `storage-research.test.mjs:22`: all `RECIPES`.
  - Icons: `item-svg.js` `ITEM_ICONS`, checked by `loop-ux-craft.test.mjs` and others. Add icons, or use
    `icon-fish` / tint placeholders.
  - Fishing tests to rerun: `fc-fishing`, `fc-glue`, `fc-dom`, `fishing`, `loop-ux-fishing`,
    `fish-trap`, `prompts`, `content-prompts`.
- **Prompts.**
  - The fc prompt is trusted static HTML, escaped through `esc()`, so bait names must go through it.
  - The `raftPrompts` provider at `game.js:1830` is priority 0, and content providers are priority 1, so
    keep the bait hint inside `fc.prompt` rather than adding a new provider.
  - Do not add a new centred element.
- **The cookpot already uses** `fish`, `seaweed` and `puffegg` (`cookpot-core.js:6-9`), and `honeyfish`
  uses honey. Bait competes for these inputs, which is fine at these small costs.
