# Visiting trader barge: research

Goal: a small, cozy trading barge drifts up to the raft now and then, stays a few minutes and swaps surplus goods for Bright Shells, and shells for rare goods, a decor plan and one rare cosmetic. The trader is Pim, a sea otter who naps on the cargo. There is no combat, no prices that go up, and nothing you can lose. Every name here is original.

## Genre conventions
- Trading posts sit on fixed islands. You sell bulk goods for a currency and buy rare items, blueprints or cosmetics. The stock rotates, rare rows are limited, and the currency matters for the mid and late game.
- What players like: a reason to keep surplus and a place to get rare materials. What they dislike: having to travel to a post, fixed prices that encourage farming, and a currency that is useless outside the shop.
- Our version is the opposite of travel: **the shop comes to you**. It visits like an island (`islands.js`) and parks close to the raft like a signal cache (`signal.js`). One visit is about 4 minutes, so it feels like an event, not a menu.

## What exists (checked in this tree)
- **The raft never moves.** `sailing-world.js:3` says "the world drifts past it instead". Scenery gets moved through `sailing.addDrifter` (`game.js:428`), but content modules have no handle on sailing: `contentCtx` (`game.js:387-395`) has no sailing. Content islands ignore sailing entirely. `islands.js:185-230` runs its own clock and a z-path (`pathAt`; `ISLAND.APPROACH 25 / DOCK 180 / DEPART 30 / WARN 30`, `islands-layout.js:5-20`) at `x = side*off` from `dockOffset()` (`islands-layout.js:146`). That means islands always dock on the **±x** side.
- **Signal caches** (`signal.js:57-95`) spawn at a range, glide toward `raftCentre()`, and park within `DECK_GAP` of the nearest tile (`deckGap()` at :96). That is the parking rule we want.
- **Item ids that exist now:**
  - Base: wood, leaf, plastic, scrap, rope, fish, sand, clay, stone, metalore, seed (`inventory-state.js:18-48`).
  - `items.js`: copperore, seaweed, nail, brick, metalingot, copperingot, glass, cookedfish.
  - `content-items.js:9-38`: ingot, glass, brick (kiln); puffegg, feather (animals); the decor pack kinds.
  - `ingot` (kiln) and `metalingot` (items.js) are two different kinds. The trade list avoids both.
- **Not in this tree:** bees and honey (`bees.js`, `honey`/`wax`/`flowerseed`) are only on `origin/claude/loop-features-202611210648` and were not merged into raft-master. Paint and dyes exist only as a research doc (`paint-research.md:20-33`, planned ids `paint_<colour>`). Those offers stay **conditional**: the core drops any offer whose kinds are missing from `ITEM_INFO`, so they switch on by themselves when those lanes land.
- **Unlocks:** `storage-research.js` `learnedFrom` (:45) auto-learns a CONTENT recipe once every cost kind is seen. `STARTER` is at :12 (**merge conflict right now**, :12 vs :17). Catalogue ids are exempt through `setOwnedElsewhere` (`game.js:423`).
- **UI precedent:** `storage-research-ui.js` uses `<dialog id="lrStorage" class="lr-sr">` with a wood panel, `sv-slot` buttons, a lazy `import()` (`storage-research.js:305`), and `releaseLock` before opening / `requestLock` on close (:253). It uses `iconSVG, slotSig, paintSlot, itemName`, which `survival-ui.js:1107` exports. `uiBlocked()` already counts any `dialog[open]` (`game.js:327`).

## Our take: currency plus barter in one shape
Every offer is `{give:{kind:n}, get:{kind:n}, stock}`. **Bright Shell** (`shell`, a bag item, stack 20) is just another kind in `give`/`get`, so selling, buying and direct barter all go through one code path.
- **Why shells live in the bag and not in a wallet:** each co-op player has their own shells for free, they save in the bag snapshot, they fit in chests, there is no new HUD, and the dialog shows a count. The cost: an old build that loads a bag with `shell` starts a fresh bag. That is the same accepted rule as every content kind (`content-items.js:4`).
- **Shell sinks:** buy rows, plus the Shell Wreath recipe below. Shells never decay.

## Visit schedule (host clock, `ctx.running` only, the same as islands)
- **First visit** about 8 min into a fresh world. After that, every **12-18 min** (`nextDelay(seed)`). Saved, so a reload doesn't reset the timer.
- **Path phases:**
  - `approach` 30 s: it appears 45 m upstream (-z, where debris comes from), fades and rises in, and glides in.
  - `docked` **240 s**: it parks at the **-z bow**, `DECK_GAP <= 1.5 m` from the nearest tile, so you can reach it from the deck without swimming. Islands use ±x, so the two never overlap. `x` is the mean x of the bow-row tiles.
  - `depart` 20 s: it turns to -x and sails off, then sinks or fades.
  - Warn notice at 30 s left. While someone has the dialog open or stands within 6 m, it waits, capped at 480 s total (islands use `DOCK_CAP` 600).
- **Sailing:** the fiction is "Pim keeps pace with you". Because the raft is the origin, nothing changes when sailing. For looks only, the barge sail leans with `world.sailing.windDir`. `cleanSailing` state is in `ctx.world.sailing`.
- **Anchored or no tiles:** it still comes. With no tiles, it parks at `z = -3`, like the `deckGap` fallback.
- **Notices:** "A little trading barge is bobbing this way!" and "Pim is getting ready to cast off".

## Trade list (pool of 12 + 2 swap-ins; each visit rolls 7 from the seed: rows 1-3 and 8 always, plus 3 more)
| # | Give | Get | Stock/visit | Note |
|---|---|---|---|---|
| 1 | fish ×3 | shell ×2 | 4 | A fishing surplus sink |
| 2 | puffegg ×2 | shell ×2 | 3 | Animals lane; ~80-240 s per egg |
| 3 | feather ×3 | shell ×2 | 3 | Animals lane |
| 4 | brick ×4 | shell ×3 | 2 | Kiln: clay to brick, 10 s each |
| 5 | glass ×2 | shell ×3 | 2 | Kiln: 2 sand per pane, so 4 sand |
| 6 | cookedfish ×2 | shell ×3 | 2 | Grill lane |
| 7 | honey ×2 | shell ×3 | 2 | **Conditional** (bees lane) |
| 8 | shell ×4 | metalore ×2 | 2 | Normally barrel-only, so a real rare |
| 9 | shell ×3 | copperore ×1 | 1 | Toward binoculars |
| 10 | shell ×2 | seed ×2 | 3 | Palm seeds for planters |
| 11 | scrap ×4 + rope ×2 | clay ×3 | 1 | Direct barter, no shells |
| 12 | shell ×6 | **Shell Wreath plan** | 1 (once per world) | Decor blueprint, see below |
| 12b | shell ×10 | **glassfloat ×1** | 1, 40% of visits | Rare cosmetic |
| (dye) | shell ×2 | `paint_coral` ×2 | 2 | **Conditional** (paint lane). Swaps in for #11 when present |

**Balance:** 1 shell is about 1 minute of normal play. A full visit sells about 20 shells' worth. The plan plus the float cost 16, so the rare goods take 1-2 visits. Raw metal ore through the trader is roughly 2 per 4 min, slower than late-game barrels, so the smelter path is not broken. Stock is per visit. No price creep.

**New content kinds** (`content-items.js`):
- `shell` "Bright Shell": an icon only.
- `shellwreath` "Shell Wreath": decor, recipe `{shell:3, rope:2, leaf:2}`.
- `glassfloat` "Glass Float": decor, a blue glass ball in a rope net that glows softly at night. Trade only, no recipe.

## Plan (blueprint) gating
- Buying #12 pushes `'shellwreath'` into the world-shared `plans` list in the trader slice.
- The trader `craftLocked('shellwreath')` returns "Buy the plan from Pim's barge" until the plan is bought.
- Because `content.craftLocked` takes the first non-null answer and storage comes first in FEATURES, the storage lock would win with "Research it first". Fix it with one anchored edit at `game.js:423`: `setOwnedElsewhere(id => hasOwn(PROG_ITEMS, id) || TRADER_PLANS.includes(id))`.

## UI: E at the barge
- The pick target is a sphere about 2.2 m round the stall, with reach 4 m from the player. Prompt: `<kbd>E</kbd>Trade with Pim (2:10)`. While approaching, the prompt reads "Pim is still tying up…".
- `<dialog id="lrTrader" class="lr-tr">` lives in a lazy `trader-ui.js` and copies the `lr-sr` CSS look: the wood gradient `#b48d55→#8a663a`, a `#3e2a17` border, `lr-sr-panel` cards, and `sv-slot` icons through `iconSVG`/`paintSlot`.
- **Layout:**
  - Header: otter icon, the title "Pim's Barge", and a live "casts off in m:ss" line.
  - Two panels: "Pim would love" (sell rows) and "Pim has" (buy and barter rows).
  - Each row shows the give icons, an arrow, the get icons, stock pips, and a **Trade** button. The button is disabled with a reason: "Need 1 more Fish", "Sold out" or "Bag full".
  - Footer: "Your shells: N".
- Clicks only call `ctx.action({kind:'trader.trade', offer:i, visit:seed})`. The panel repaints from serialized state (version counter), the same as storage. Esc or E closes it and then calls `requestLock`. It closes by itself on `depart`, or when you move more than 5 m away.

## Co-op
- **Host-authoritative:** the host owns the visit clock, the seed, `stock[]` and `plans`. Guests ease their clock like `islands.load` (slew under 1 s) and never change anything locally.
- **Each player trades from their own bag:** `action(a, actor, bag)` gets the actor's bag. The host checks phase `docked`, that `a.visit` matches the current seed (stale clicks are refused), reach (`ctx.physics` or `ctx.other`), `stock[i] > 0`, that the bag has the give items, and that the get items fit. It applies the trade atomically on a scratch copy, like `Bag.craft`.
- **Stock is shared.** There is one barge, so if your friend buys the float it is gone. The dialog shows that live. The host emits `loot` to the actor and a short `notice` to `'all'` for the plan and the float.
- A guest visiting another raft: `load(ext,'restore')` brings back the guest's own trader slice.

## Save: `world.ext.trader`
`{v:1, clock, next, visits, visit:{seed, born, stay, stock:[int×7]} | null, plans:['shellwreath']}`. Offers are a pure function of `seed`, so only stock is stored. `cleanTrader()` clamps numbers, cuts `stock` to the offer count, keeps only known plan ids, and returns defaults for junk or `undefined` (old saves). `serialize()` reuses a cached object, because it runs at about 8 Hz.

## Model (5 draw calls; up to 6 allowed)
1. Hull, deck, crates, mast and stall counter: one merged vertex-coloured mesh (`merge-geo.js` `mergeGeometries`). 2. Striped awning plus a small square sail: cloth, `DoubleSide`, no shadow. 3. Pim the otter: one merged mesh, animated alone (a bob, a wave when you are within 6 m, a nap pose while departing). 4. Lantern glass: emissive. Named `lanternGlow` so `daynight.js:242 LANTERN_PARTS` may pick it up; check that its traverse reaches content meshes. 5. Pennant: a tiny plane swayed in `update`.

Built once, lazily, with the same pattern as `kiln-model.js`. The barge bobs on `ocean.getHeight` with roll and pitch from two samples. `update(dt)` uses scratch vectors only, with no allocations.

## Integration (content registry)
- `dist/trader-core.js` (pure, no imports): `TRADER` constants, `OFFERS`, `offersFor(seed, has)`, `pathAt`, `parkAt(tiles)`, `applyTrade`, `cleanTrader`, `nextDelay`. Tests in `tests/trader.test.mjs` cover: deterministic offers, conditional rows dropped, atomic trade (missing / full / stock / stale visit), clean junk, schedule phases, and the bow park gap.
- `dist/trader.js` exports `createTrader(ctx)` → `{name:'trader', update, serialize, load, action, interact, prompt, craftLocked, decorModel, debug, dispose}`. `decorModel` covers `shellwreath` and `glassfloat`.
- `dist/trader-model.js` and the lazy `dist/trader-ui.js`.
- `content.js`: an import in the block at :25-37 (**conflict markers right now**) and `createTrader` appended to `FEATURES` (:40).
- `content-items.js`:
  - `shell`, `shellwreath` and `glassfloat` added to `CONTENT_ITEMS` (before :38).
  - The `shellwreath` recipe added to `CONTENT_RECIPES` (before :67).
  - Both decor ids added to `CONTENT_DECOR` (:70) and to `CONTENT_BLOCK_RADIUS` (:71, wreath .12, float .2).
- `icons.svg`: `icon-shell`, `icon-wreath`, `icon-float`. `survival-ui.js:22`: add them to `SPRITES`.
- `game.js:423`: the one-line `setOwnedElsewhere` extension above. This is the only engine edit.
- `debug`:
  - `spawnNow(seed)` and `skip(sec)`: fast-forward for swiftshader.
  - `phase()`, `stock()`, `aimAt()`, `give(kind, n)`.
  - `trade(i)` runs through the action path.
