# Receiver, antennas and signal navigation — research

Status: research only (no code changed). Scope: the raft stays still in this build, so the
"navigation" is about finding things in the sea and pulling them in, not about steering.

## 1. How the genre does it (general patterns, described in our own words)
- **Receiver + antennas as a station.** Raft survival games often have a radio/radar box that
  only works once a few antennas are built and spread out on the deck. Each antenna adds range
  or precision; the box shows dots for points of interest on a round screen.
- **Power.** The usual design spends batteries or fuel on the receiver, so a player has to keep
  it charged. This is upkeep pressure: when the battery runs out, the screen goes dark.
- **Map / radar UI.** Common forms: (a) a radar disc with blips and a sweep, (b) a compass strip
  with a bearing tick, (c) a 3D marker in the world with a distance label (as in the beacons
  of underwater survival games), (d) map pins. Most games pair a diegetic device with a light
  HUD marker so players don't have to keep looking at the device.
- **Reward.** The signal leads to something rarer than the usual debris: a crate, a wreck, an
  island, or a story clue. The fun is "something is out there" plus a clear direction.

## 2. Our cozy version
- **No batteries.** The receiver runs on its own (a small solar fin as decoration). No upkeep,
  nothing gets used up. Antennas improve the signal and never wear out.
- **The cache comes to you.** The raft can't move, so a found signal cache (a bright drifting
  buoy with a little flag) slowly drifts toward the raft. Players watch it come closer, then
  hook it for a big haul. Waiting is the payoff, so no timer pressure: it never sinks or leaves.
- **One cache at a time.** Keep it easy to read: either "listening…" (cooldown), or one active
  signal with a bearing and distance.
- **The readout gets sharper with antennas (0–3):**
  | antennas | detect range | bearing shown | distance shown | screen marker | drift speed |
  |---|---|---|---|---|---|
  | 0 | 45 | ±25° wobble | "far / near" | no | 0.30 u/s |
  | 1 | 60 | ±10° | rounded to 10 m | when < 40 m | 0.35 |
  | 2 | 70 | exact | rounded to 5 m | always | 0.40 |
  | 3 (cap) | 75 | exact | exact | always + light beam on buoy | 0.45 |
  Cleaned coordinates must stay below `|x|,|z| < 80` (game.js:136), so spawn at 45–75 units
  from the raft centre, clamped. At 0.4 u/s a 60-unit trip takes about 2.5 min. Debris drifts at 0.22.
- **Cooldown between caches:** 150 s with 0–1 antennas, 120 s with 2, 90 s with 3. The first
  cache appears 20 s after the receiver is placed.
- **Hookable when** the cache is within 22 units (hook range is 16–32, game.js:1107). It then
  stops drifting about 6 units off the raft edge, so it never runs into the deck.
- **Costs (fit current economy, LOOT barrel ≈ 7 items):**
  - Receiver (placeable decor, 1 per raft): wood 3, scrap 4, plastic 3, rope 2.
  - Antenna (placeable decor, max 3 counted): wood 2, scrap 1, rope 1. To count, it must be
    at least 2 tiles from the receiver. This keeps the "spread them out" idea in a gentle form.
- **Cache loot (atomic, like barrels):** wood 6, plastic 4, scrap 3, rope 2. With 3 antennas, add
  a 25% bonus roll of +1 fish or +2 leaf. If the bag is full, the cache stays where it is (same
  rule as other debris) and a toast says "Your bag is full". Nets must not collect caches.
- **UI:** a small HUD pill "SIGNAL ▲ NE · 48 m" (arrow rotates relative to the camera yaw),
  shown only when the raft has a receiver. A screen-edge marker comes from projecting the cache
  position with `camera` and placing a CSS dot that is clamped to the screen edge. A rising
  ping sound plays at detection and a soft chime when the cache becomes hookable. A real compass
  icon already exists: `icons.svg#icon-compass` (icons.svg:307, currently empty, so it needs a drawing).

## 3. Integration points (dist/game.js unless noted)
- L27 `DECOR_TYPES`: add `'receiver','antenna'`. L35 `BLOCK_RADIUS`: receiver ~.35, antenna ~.1.
- L28/30/31 `ITEM_TYPES` / `SPAWN_TABLE` / `LOOT`: add `'cache'` to ITEM_TYPES and LOOT only.
  Do **not** add it to SPAWN_TABLE, because `makeItem` (L370) must never randomly roll a cache.
- L112 `newWorld()`: add `signal:null`. L117 `cleanWorld()`: validate `signal`
  `{token:string<80, x, z finite |·|<80, phase, cooldown>=0, found:bool}` or `null`. L142
  `copyWorld()`: deep-copy `signal` (the top-level spread only makes a shallow copy).
- L370 `makeItem` / L748 `updateItems()` respawn loop: skip `type==='cache'` (otherwise the
  `end/side` bounds or the tile check replace it with normal debris). Cache drift should be
  computed toward the raft centre, not the +z current.
- L371 `itemModel()`: add a cache branch. `createDebris` throws for unknown types
  (dist/debris.js:10,348). The model could be a new `createCraft`-style buoy in a new module.
- L551 `collect` action: works as-is through `LOOT.cache`. After the splice it must **not**
  `push(makeItem(a.id))` for caches. Clear `world.signal` and start the cooldown instead.
- L838-840 nets loop: exclude `type==='cache'`.
- L820 `frame()`, host-only block (~L834): call `signalTick(world, dt)` from a new pure module
  `dist/signal.js` (spawn, drift, cooldown, antenna counting, readout precision). Test it in
  `tests/signal.test.mjs`.
- L351 `rebuildRaft()`: models for receiver/antenna (dist/crafts.js `createCraft`).
- L259 `prepareDom()` + L45 `HUD_CSS`: create `#signalReadout` and `#signalMarker` the same way
  `#contextPrompt` is created (stable nodes reused across hot swaps). Hide them when not running.
- L814 `hostState()`: add `signal:world.signal`. L1012-1025 guest state handler already
  replaces `world` with `cleanWorld(...,true)`, so the readout works as soon as cleanWorld keeps `signal`.
- L674 `save()`: writes `items:[]`, so a cache living in `items` is lost on reload. Persist
  `world.signal` and re-insert the cache item from it on load/mount.
- L1095-1110 `raftDebug.state`: expose `signal` and the readout (`bearing, distance, antennas`).
- dist/inventory-state.js L13 `ITEM_INFO` + L44 `RECIPES`: add `receiver`, `antenna`
  (placeable, maxStack 99). `cache` is not a bag item. dist/survival-ui.js picks the recipes up
  from RECIPES.

## 4. Co-op
- The host owns everything: it spawns the cache, decides drift and cooldown, and counts antennas
  from the shared `world.decor`. Guests only render. The bearing and distance are worked out
  locally from `world.signal` and each player's own camera, so both players see correct arrows.
- Hooking uses the current `collect` action with its token guard (L552). The first player to
  reel the cache in gets it, and it counts only once. Broadcast an `emit(..., 'all')` toast
  "Signal cache recovered!".
- **Old guest + new host:** old `cleanWorld` drops `signal` and filters `ITEM_TYPES` (L136), so
  the cache is invisible and can't be hooked for them. That is safe. It also drops `receiver`/`antenna`
  decor (L129) from what they render. Risk: if the *guest's* bag contains a receiver/antenna,
  the old `snapBag` → `validateSlot` (inventory-state.js:98) throws on the unknown kind and the
  old guest can't sync its bag. Acceptable if versions are expected to match. Otherwise only
  let the host keep these kinds or show a version notice.
- **New guest + old host:** `signal` is missing → defaults to `null` → no readout. Fine.

## 5. Save compatibility
- New fields are optional (`signal` defaults to `null`). Old saves load unchanged.
- Downgrading (old build + new save) quietly drops receiver/antenna decor. Bag slots holding
  them fail `validSnapshot` (L73) → that inventory is reset. Worth a note in the patch notes.

## 6. Open questions for the builder
- Should the cache ride the shared `items` array (gets hook physics for free, recommended) or
  get its own mesh plus a custom hook check? Riding `items` is less code.
- Is a light beam on the buoy enough without a screen marker when there are 0 antennas? It may be cozier
  that way.
