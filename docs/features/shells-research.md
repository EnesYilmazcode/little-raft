# Seashell collecting + Shell Book: research

Feature (round loop-features-202611210952): ~12 original shell kinds found with E on island beach
sparkles and on the seafloor while diving; each first find fills an entry in a Shell Book (silhouette,
rarity, one-line note); small set rewards; duplicates become Bright Shells. Anchors are file:line in the
current tree (branch based on raft-master 92cd4ea).

## Where shells live today (build on this, do not duplicate)

- `shell` = "Bright Shell", a plain bag stack (max 20): `dist/content-items.js:55`; recipe use in
  `content-items.js:128` (Shell Wreath = 3 shell + 2 rope + 2 leaf), wreath is decor (`:142` CONTENT_DECOR).
- Only source today is Pim's barge: `dist/trader-core.js:12-25` (fish/eggs/feathers/brick/glass/grilled
  fish -> shells; shells -> ore, seeds, copper, the wreath plan (6), Glass Float (10)). Wreath gated by
  `trader.js:263` craftLocked. Craft-book copy: `dist/craft-book.js:200` (desc) and `:483` ("Trade fish or
  puff eggs to Pim") - must gain "or comb island beaches" once beaches drop shells.
- Icon: `icon-shell` symbol in `dist/icons.svg:709`, allow-listed in `dist/survival-ui.js:25,40`.
- Tests pin it: `tests/trader.test.mjs:181-182` (kind exists, name 'Bright Shell', maxStack 20).
- Name clash: the treasure tool is already called "Seashell Finder" (`dist/items.js:196`,
  `treasure.js:1-4`) but it finds buried bundles, not shells. Island sand mounds already show decorative
  shells (`islands-models.js:198-206`), seafloor sand nodes have "shell/pebble specks" (`seafloor.js:233`).
- Decision: the 12 collectible kinds are NOT bag items. A find goes straight into the book; a repeat
  find (or a set reward) pays out `shell` (Bright Shells). That feeds Pim and the wreath, adds zero item
  kinds (no icons/allow-list/old-build bag rejection, `content-items.js:4`), and keeps saves small.

## (a) Genre patterns

- Collectible sets with silhouettes: a grid of greyed shapes, filled in on first find (fish journals,
  bug/fossil museums in cozy life sims). The empty outline is the goal-setting hook.
- Beachcombing: low-effort, visible glints on the shore that refresh per visit; short walk, E, small
  reward. Works because it is ambient, not a grind; spots must be readable (sparkle + soft chime).
- Rarity tiers with clear odds (common/uncommon/rare/legendary) plus conditional finds (night, after a
  storm, deep water) give "come back later" reasons without timers.
- Museum/collection book: per-entry flavour line, find count, "first found on day N", a progress
  counter on the tab ("Shells 5/12"), and a toast "New shell! Added to your Shell Book".
- Set rewards: completing a themed row grants a one-time gift; the full book grants a keepsake.
- Duplicates should never feel wasted: convert to the common currency.

### Original cozy take: 12 shells (own names, own art: simple 2D SVG silhouettes + small 3D sparkles)

| id | name | silhouette | rarity | where | note (one line) |
|---|---|---|---|---|---|
| button | Button Cockle | round fan, 7 ribs | common | beach | "Small enough to sew on a coat. Someone probably has." |
| sunfan | Sunfan Scallop | wide fan, wavy rim | common | beach | "Holds the morning light like a cupped hand." |
| tiddly | Tiddly Whelk | short spiral cone | common | beach/sea | "Hums faintly if you hold it to your ear and wait." |
| pebble | Pebble Limpet | low dome, no spiral | common | sea | "Sat on one rock for years and saw everything." |
| ribbon | Ribbon Auger | long thin spike | uncommon | beach | "A pencil the sea forgot to sharpen." |
| moonsnail | Moon Snail | fat round coil | uncommon | beach, night x2 | "Only peeks out once the lanterns are lit." |
| piggy | Piggy Cowrie | glossy egg, slit belly | uncommon | sea | "Smooth as a pocket stone, warm as a teacup." |
| butterfly | Butterfly Pair | two joined wings | uncommon | beach | "Two halves that refused to drift apart." |
| crown | Coral Crown | spiky crown spiral | rare | sea (deep, y < -6) | "Worn by a very small and very proud crab." |
| lantern | Lantern Nautilus | chambered coil | rare | sea | "Each room is a year; it kept them all." |
| starry | Starry Sand Dollar | flat disc, 5-petal star | rare | beach, after storm x3 | "Spends its pocket money on nothing at all." |
| pearl | Pearl Heart | heart-shaped clam + pearl | legendary | beach or sea | "Found by whoever needed a little luck today." |

Rarity weights can reuse the fish table shape (`dist/fish-species.js:15-20`: 60/28/10/2) and its colours.
Sets (one-time gift, host pays to the finder's bag, else to the crew via the next E):
- Tidepool Set (button, tiddly, pebble, piggy) -> 3 Bright Shells.
- Sunny Beach Set (sunfan, ribbon, butterfly, moonsnail) -> 4 Bright Shells + 1 glass.
- Deep Wonders Set (crown, lantern, starry) -> 6 Bright Shells (= the wreath plan price).
- Full book (all 12) -> a decor keepsake, e.g. a "Shell Shelf Garland" or a free wreath; keep it a
  single CONTENT_DECOR item if added (see test constraints), or reuse `shellwreath` (1 free wreath).
Duplicates: +1 Bright Shell each (rare +2, legendary +3); cap per island (e.g. 3 sparkles) keeps Pim's
economy intact (3 fish -> 2 shells today, so ~3-5 shells per island visit is in line).

## (b) Code anchors (current tree)

Islands (beach finds):
- `dist/islands.js:40-42` `islandNow()` live accessor {seed, cx, cz, gy, R, rot, phase, onSand, groundAt}
  (filled at `islands.js:454-462`); import with the same specifier as content.js (one instance,
  see `treasure.js:6`).
- Gather nodes: kinds/max `dist/islands-layout.js:25-26`, `layoutFor` `:88`, `lootFor` `:205-212`
  (sand node gives only sand), host check `applyGather` `:217`, `standOnSand` `:261`, `SHORE_U` `:79`
  (shoreline radius fraction). Host gather path `islands.js:313-333` emits loot and
  `ctx.observe({kind:'gather', loot}, actor)` at `:323`.
- Best prior art for spots: treasure. `dist/treasure-rules.js:26-50` `spotsFor(seed)` derives spots from
  the island seed with its own RNG stream (`seed ^ K`), avoids nodes, caches; save slice
  `world.ext.treasure = {v, seed, dug[]}` (`treasure.js:1-4,185-200`), resets when the island seed
  changes (`treasure.js:139-142`). Shells should copy this: `sparklesFor(seed)` = 2-4 spots in a wet
  beach band (u ~ SHORE_U-0.15 .. SHORE_U), per-spot kind rolled by hash, slice `{v, seed, taken[]}`.
- Prompt provider pattern (content prompt text is hidden): `treasure.js:118-131` raftPrompts.provide,
  step aside on `s.pickup`, swimming, guest not ready. Interact order is FEATURES order
  (`content.js:94`, first module whose interact returns true, `content.js:148`): put shells after islands
  and treasure, and only claim E when a sparkle is within ~1.5 m and the crosshair is not on a node
  (`islands.js:354-366` pickNode).
Diving / seafloor:
- `dist/seafloor.js:24-25` NODE_TYPES/NODE_LOOT, deterministic `nodeAt`/`nodeById` `:97-111`.
- Host gather: `dist/game.js:1338-1345` (validates id + distance, NODE_LOOT, broadcasts `nodeTaken`).
  It does NOT call `content.observe` (unlike fish `:1351`). E underwater goes to diving, not content
  (`game.js:1422`). So a seafloor find needs a one-line `[shells]` hook after commit at `:1344`:
  `content?.observe({kind:'divegather', type:n.type, id:n.id, y:n.y}, actor)`; the shells module rolls
  a deterministic chance (hash of id + regrow epoch) on sand nodes, ~15%, deep-only for crown.
  Alternative with no game.js change: own sparkle meshes on the floor via `seafloorHeight` + own E, but
  E is swallowed while diving, so the hook is the clean route. Diving entry/state: `diving.js:180,358`.
Fish journal (prior art for the book):
- `dist/fish-journal.js:28-90` pure `Journal` (sanitising ctor, recordCatch -> {isNew}, snapshot), SVG
  art `fishSvg` `:106`, panel with tabs and grid of cards `:153-222` (unknown = '???' greyed card, rarity
  chip `:187-189`). Saved per player in localStorage (`fishing-cooking.js:8,50,195`), not world.
Logbook UI (where the book tab goes):
- `dist/logbook-ui.js:86-96` markup: tabs Notes, Achievements, Tasks (Tasks hidden unless a view
  exists). Markup guard `:108`; tab switch `select()` `:200-212` is hard-coded to notes/ach/tasks;
  Tasks wiring via option `tasks.view` (`:156-185`) <- `game.js:2553` <- `content.tasksView()`
  `content.js:174`. A Shells tab copies that: add `shells:{view}` option + `content.shellsView()`.
  The shooting-star wish counter wants the logbook too this round: agree one generic
  `extraTabs` mechanism or land one tab per commit to avoid conflicts in the same markup/select lines.
- Achievements are world-level (`logbook.js:25-40`, `world.achievements`); a "First Shell" /
  "Shell Book complete" achievement is optional and needs logbook.js + evaluate changes.
Content hooks: module shape `content.js:7-55` (serialize/load/action/interact/prompt/observe/debug);
observe kinds documented at `:49-50` (add 'divegather'). Tasks could count finds (`tasks-rules.js:32`
'gather' pattern) - optional.
Items/test constraints: new bag kinds need icons + `survival-ui.js:25` allow-list
(`tests/item-icons.test.mjs:1-28`) - avoided by not adding kinds. New dist modules must use the
`?build=` stamp (`tests/module-specifiers.test.mjs`) and be added to `dist/live.js` PRELOAD
(`tests/live-preload.test.mjs:38-43`). Keep `shell` name/stack (`tests/trader.test.mjs:181-182`).
Display shelf (`dist/display.js:1-12`) can already show a Bright Shell; showing a specific book shell
would need per-slot meta - out of scope.

Co-op:
- Recommend a SHARED crew book in `world.ext.shells = {v, seed, taken[], book:{id:{n, day, by}}, sets[]}`
  (host-authoritative, synced ~8x/s). Fits "collect together", matches world achievements, survives
  in the host save. Fish journal is per player, but it lives outside the world; a per-player book
  would need per-actor slices and guest saves - more risk, no gain for a 2-player raft.
- Actions: guest sends `{kind:'shells.take', seed, spot}`; host validates seed == current island,
  spot not taken, distance (treasure's `applyDig` pattern, `treasure-rules.js`), then records the
  entry, pays duplicates/set gifts into the actor's bag (`bag` arg), emits a loot/notice to the actor.
- `load(data,'net')` must be cheap: compare seed/taken/book sig, only touch sparkle meshes when
  `taken` changed; rebuild the book panel only when open and the sig changed.

## (c) Risks

- Economy: duplicate payouts inflate Bright Shells and trivialise Pim (wreath plan 6, float 10). Cap
  sparkles per island (2-4) and seafloor chance; no payout for a first find.
- Naming confusion with "Seashell Finder" (treasure tool). Copy must say "shell sparkles" and maybe let
  the finder not react to them; or rename nothing and explain in craft-book.
- E conflicts: sand nodes, treasure dig (spade), sitting, paddleboard all use E on islands; shells must
  only claim E near a sparkle and not when holding the spade over a dig spot.
- Logbook-ui is hard-coded for three tabs; two features adding tabs this round will collide.
- game.js hook for diving finds touches a hot, shared file; keep it one marked `[shells]` line.
- Saves: `load(undefined)` -> empty book; unknown shell ids dropped; book survives island changes while
  `taken[]` resets per seed. Old builds ignore `world.ext.shells`.
- Perf: sparkles = 1 InstancedMesh (max 4) + additive points; no per-frame allocation; hide when the
  island is gone. Underwater finds need no new meshes (toast only).
- Originality: names/notes above are original; do not reuse commercial-game item names or art.
