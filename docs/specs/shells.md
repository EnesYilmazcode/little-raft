# Seashell collecting + Shell Book: spec

Research: `docs/features/shells-research.md` (anchors re-checked on this branch). Original names and
art only. Friendly: no timers, no loss. The 12 book shells are book entries, never bag items.

## Player experience
- On an island beach, 2-4 soft glints ("shell sparkles") sit in the wet sand band. Walk up, the prompt
  reads `E Pick up shell`, press E: a chime and a toast. First find of a kind: "New shell! Button Cockle
  is in the Shell Book". A kind already in the book: "+1 Bright Shell (Button Cockle again)".
- While diving, gathering a seafloor sand node sometimes turns up a shell too (toast only, no mesh).
- Logbook (L) gains a "Shells n/12" tab: 12 cards, grey silhouettes for unknown kinds, filled and named
  with rarity chip, one-line note, find count and "first found on day N by Host/Guest" once found.
  Three set rows under the grid show progress and the gift they paid.
- Sparkles reset when a new island arrives; the book is the crew's, shared in co-op, kept in the save.

## Shell table (ids are save keys; never rename)
| id | name | rarity | where | weight bonus |
|---|---|---|---|---|
| button | Button Cockle | common | beach | |
| sunfan | Sunfan Scallop | common | beach | |
| tiddly | Tiddly Whelk | common | beach, sea | |
| pebble | Pebble Limpet | common | sea | |
| ribbon | Ribbon Auger | uncommon | beach | |
| moonsnail | Moon Snail | uncommon | beach | x2 at night (`peer('daynight').night > 0.5`) |
| piggy | Piggy Cowrie | uncommon | sea | |
| butterfly | Butterfly Pair | uncommon | beach | |
| crown | Coral Crown | rare | sea, only node y < -6 | |
| lantern | Lantern Nautilus | rare | sea | |
| starry | Starry Sand Dollar | rare | beach | x3 while `peer('daynight').storm > 0` or `.rain > 0.3` |
| pearl | Pearl Heart | legendary | beach, sea | |
Notes are the research table's lines verbatim. Rarity weights 60/28/10/2 split evenly inside each
tier among kinds valid for the place (copy the fish table shape, `fish-species.js:15-20`).

## Rules (pure, `dist/shells-rules.js`, node-tested)
- `SHELLS` frozen list `{id, name, rarity, where:['beach'|'sea'], note, svg}`; `SETS` frozen:
  `tidepool` (button, tiddly, pebble, piggy) -> 3 shell; `sunny` (sunfan, ribbon, butterfly,
  moonsnail) -> 4 shell + 1 glass; `deep` (crown, lantern, starry) -> 6 shell; `full` (all 12) ->
  1 `shellwreath` (existing decor item; no new item kinds).
- `sparklesFor(seed)`: copy `treasure-rules.js:26-50`: own stream `rng((seed ^ SHELLS_K) >>> 0)`,
  `want = 2 + floor(r()*3)`, `u` in `[SHORE_U - 0.15, SHORE_U]`, `y >= 0.05`, >= 2.2 m from nodes,
  >= 3 m from each other and from `spotsFor(seed)` dig spots; frozen, cached (<= 64 seeds).
- `rollKind(seed, key, place, cond)`: deterministic `hash3(seed, key, condBits)` -> kind; `cond =
  {night, storm, deep}`. Host rolls at take time (conditions are host-side live values).
- `DEFAULTS() = {v:1, seed:null, taken:[], paid:0, sea:{day:-1, n:0}, book:{}, sets:[]}`;
  `book[id] = {n, day, by:'host'|'guest'}`. `clean(data)` drops unknown ids/sets, clamps n to 1..9999,
  sizes `taken` to the seed's spot count, tolerates any junk (undefined -> defaults).
- `applyTake(st, a, actor, pos, bag, cond, day)` -> `{ok, reason, kind, isNew, pay:{}, sets:[]}`.
  Reasons: `stale` (a.seed !== st.seed), `none` (bad spot), `taken`, `reach` (horizontal > 2.0 m),
  `full` (payout does not fit; nothing changes). Works on a scratch Bag, commits only on ok.
- `applySeaFind(st, node, actor, bag, day)`: chance `hash3(node.id, day, SEA_K) < 0.15`, only for
  node.type `sand`; max 3 sea finds per game day (`sea`), `place='sea'`, `deep = node.y < -6`.
- Economy: a first find pays nothing; a repeat pays 1 shell (rare 2, legendary 3). Repeat payouts
  count into `paid`, capped at `PAY_CAP = 5` per island seed (reset with the seed); past the cap the
  take still counts in the book (n++) and toasts "Your pockets are full of shells for this island".
  Sea repeats share the cap of the island in view, or a daily cap of 3 when there is none.
  Set gifts are one-time (`sets[]`), outside the cap, paid to the finder's bag (if full, the gift
  waits: `sets` is not marked and pays on the next successful take).
- `bookView(st)` -> `{sig, badge:'n/12', cards:[...12], sets:[...]}`; `sig` = ids+counts+sets joined.

## Module (`dist/shells.js`, name `shells`, FEATURES right after `createTreasure`)
- Slice `world.ext.shells`. `serialize()` returns a cached object, rebuilt only on change.
- `load(data, from)`: `clean`, then compare `seed`/`taken` sig; touch sparkle instances only then.
  Book sig change only marks the tab dirty. Cheap on `'net'` (8x/s).
- `update(dt)`: host: when `islandNow().seed` differs from `st.seed` (incl. island gone -> null), set
  seed, `taken = spots.map(()=>0)`, `paid = 0`. Both roles: place sparkles in island space
  (`islandNow()` cx/cz/rot, `groundAt`), import islands with content.js's exact specifier (one
  instance, like `treasure.js:6`).
- Visuals: one `InstancedMesh` (max 4) of a tiny pale shell plus one additive `Points` glint that
  twinkles (shared material, no per-frame allocation); taken spots scale to 0; hidden with no island.
- `interact()` claims E only when: running, not swimming/diving, not `peer('sit')?.seated?.()`, not
  riding (`peer('paddleboard')?.riding?.()`), held item is not `spade`, `ctx.uiOpen()` false, and an
  untaken sparkle is within 1.6 m horizontal of the player. Islands' node aim and treasure dig come
  earlier in FEATURES, so they keep E when they claim it. Sends `ctx.action({kind:'shells.take',
  seed, spot})`.
- `prompt()` returns `<kbd>E</kbd> Pick up shell` under the same conditions. Content prompts already
  reach `#lrPrompt` via the `content` provider (`game.js:777-780`), so no own provider is needed;
  if QA finds it hidden, add `raftPrompts.provide({id:'shells', priority:1})` that returns null on
  `s.pickup`, swimming, `s.heldKind === 'spade'` or guest not ready (copy `treasure.js:118-131`).
- `action(a, actor, bag)`: `shells.take` -> `applyTake` with host's own view of the actor position
  (`ctx.physics` / the guest pose game.js uses, same as treasure). Emits to the actor: `loot` (pay),
  `notice` ("New shell! ..."), `full`, `stale` -> "The island drifted off", `reach` -> "Get a little
  closer".
- `observe(ev, actor)`: on `{kind:'divegather', type, id, y}` -> `applySeaFind` with
  `ctx.actorBag(actor)`; emits the same toasts. Never from `'net'`.
- `logbookTabs(out)`: `out.push({id:'shells', label:'Shells', view:() => bookView(st), render:shellsBookHTML})`.
- `debug`: `{state, sparkles(), spawnAt(i), take(i), give(id), fill(), reset()}` for QA.
- `dispose()`: remove meshes, materials, geometry.

## Seafloor hook (one line, `dist/game.js` dive gather, after `commit(...)` at ~:1344)
`content?.observe({kind:'divegather', type:n.type, id:n.id, y:n.y}, actor); // [shells]`
Also add `'divegather'` to the observe kinds comment in `content.js:49-50`.

## Generic logbook extra tabs hook (`dist/logbook-ui.js`; shells builder implements, stars reuses)
- Matches the minimal API `docs/specs/stars.md` (Logbook) expects. New `createLogbookUI` option
  `tabs:{list:() => Array<{id, label, view, render?, act?}>}` (absent -> nothing changes);
  `game.js:2553` passes `tabs:{list:() => content?.logbookTabs?.() ?? []}`.
- `content.js` accessor next to `tasksView`: `logbookTabs()` clears a reused array and calls each live
  module's `logbookTabs(out)` hook in FEATURES order (a hook may also return an array), try/catch each.
- Tab contract: `id` matches `/^[a-z][a-z0-9-]{0,15}$/`, not `notes|ach|tasks`, first wins on dupes,
  max 4. `label` string. `view()` -> `null` (tab hidden) or `{sig, html}` (+ optional `badge`). Optional extension
  `render(v)` -> HTML string used instead of `v.html` (module escapes its own text). Optional `act(name, el)` is
  called for clicks on `[data-lb-act]` inside that panel.
- UI: tabs/panels for extras are created by JS after the Tasks tab (`lb-tab-<id>`, `lb-panel-<id>`,
  same ARIA as Tasks) and removed on `destroy()`; MARKUP and the mount guard stay as they are, so the
  Tasks tab is untouched. The list of extras is read on `open()` and on `update()` (only while open);
  a panel re-renders only when its `sig` changes. Tab text = `label + ' ' + badge`.
- `select(name)` becomes: known built-in or a visible extra id, else `notes`. Panel hide/show loops
  over all panels. Arrow/Home/End already use `visibleTabs()`. `littleraft:open-logbook` with
  `detail.tab:'shells'` opens it.
- A throwing `view`/`render` hides that tab only (logged once); other tabs keep working.

## Book tab (`dist/shells-book.js`, pure string builders)
- `shellSvg(id, known)`: inline 48x48 SVG per kind (fan with ribs, spiral cone, dome, spike, coil,
  egg with slit, two wings, crown, chambered coil, star disc, heart + pearl). Unknown: same path in
  `currentColor` at 25% opacity, no name ("???", hint "Found on beaches" / "Found while diving").
- `shellsBookHTML(v)`: `<div class="sb-grid">` of 12 `.sb-card` (rarity chip colours from fish
  journal), then `.sb-sets` rows "Tidepool Set 2/4 · gift: 3 Bright Shells" / "Gift received".
  Small scoped CSS injected once (`#shells-book-css`), works at 360 px (3 columns) up to 4 columns.

## Text updates
- `craft-book.js:483` `shell.how` -> "Pick up shell sparkles on island beaches, or trade fish or puff
  eggs to Pim at his trading barge." `:200` `use` stays. Keep `shell` name/stack
  (`tests/trader.test.mjs:181-182`).

## Co-op
- Shared crew book, host-owned in `world.ext.shells`; guests see it via the ~8x/s ext sync.
- Guest E -> `shells.take {seed, spot}`; host checks seed === current island, spot valid and untaken,
  distance from the host's copy of the guest pose, then pays the guest's bag. Old hosts ignore the
  action (nothing happens, no loss). Old builds ignore `world.ext.shells`.

## Files
New: `dist/shells-rules.js`, `dist/shells.js`, `dist/shells-book.js` (imports with
`?build=v3-survival-ae77fa84ac2b`, add all three to `dist/live.js` PRELOAD). Edited: `content.js`
(import, FEATURES, `logbookTabs`, observe comment), `game.js` (2 marked lines), `logbook-ui.js`
(extras), `craft-book.js` (one line).

## Tests (`tests/shells.test.mjs`)
- `sparklesFor`: deterministic, 2-4 spots, in band, clear of nodes and dig spots, cached.
- `rollKind`: deterministic; beach never gives sea-only kinds; crown only deep; night/storm bias.
- `clean`: undefined -> defaults; junk/unknown ids dropped; old-shape tolerant; `taken` resized.
- `applyTake`: stale/none/taken/reach/full reasons leave state and bag unchanged; first find pays 0;
  repeat pays by rarity; `PAY_CAP` honoured and reset by a new seed; set gifts once; full set wreath.
- `applySeaFind`: only sand, 15% deterministic, 3/day cap.
- Module with fake ctx: guest action path, `load(...,'net')` does not rebuild meshes when unchanged.
- Logbook: `tabs` option absent -> markup/tab list identical (Tasks still works); extras with bad ids,
  dupes or throwing views are skipped; sig-gated re-render; `select('shells')` and keyboard nav.
- `npm test` green incl. live-preload, module-specifiers, item-icons, trader.

## QA plan (screenshots via scratchpad `shoot.py`, `raftDebug.content.shells`)
1. Dock at an island: 2-4 sparkles visible on wet sand, day and night shots.
2. Walk to one: prompt shows; E -> toast "New shell!"; sparkle gone; logbook tab "Shells 1/12".
3. Stand on a sand node / hold spade / sit on a bench near a sparkle: their E wins, no shell taken.
4. `debug.fill()` then take repeats: Bright Shells added, stops paying after 5, toast says so.
5. Next island: sparkles reset, book kept; save/reload keeps book; old save loads empty book.
6. Dive and gather sand nodes (`debug` forced chance): sea kinds appear, crown only deep.
7. Co-op (tests/coop-e2e.mjs style): guest takes a sparkle, both books match, double-take refused.
8. Logbook at 360 px and desktop: 12 cards, silhouettes, sets; Tasks tab unchanged; arrow keys cycle.
