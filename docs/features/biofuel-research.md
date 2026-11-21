# Biofuel Refiner + Fuel Tank: research

Read-only survey for the Biofuel Refiner (organic items -> Biofuel Jug, no fuel) and the Fuel Tank (stores jugs,
auto-tops-up adjacent Little Motors). Paths are under `dist/` unless noted.

## 1. Engine today (engine.js, engine-models.js)
- `ENGINE` engine.js:9-17: `FUEL: { leaf: 20, wood: 45, plastic: 60 }` (seconds per item) :13, `FUEL_CAP: 300` :14,
  `MAX_ENTRIES: 64`, `REACH: 2.6`, `OP_GAP: 250`, `MAX_TICK: 1`.
- `NAMES` engine.js:31 (`leaf/wood/plastic`) is used in `'No ' + NAMES[a.item]` :154 and prompt labels :248, :310.
  **Adding a fuel kind needs a NAMES entry too**, or the texts read "No undefined".
- Slice `world.ext.engine = { v:1, motors: { "x,z": { on, fuel } } }` :4; validator `cleanEngine` :34-52 keeps only
  `v`/`motors` (any extra field such as `tanks` is dropped), fuel clamped to `[0, FUEL_CAP]`, 1 decimal.
- `burn(slice, decor, dt, anchored)` :104-118: host only, 1 s/s per running motor, not while anchored; called from
  `update` :280-283 (`ctx.role !== 'guest'`, after `prune()` :220-226 which deletes entries without a motor decor).
- Fuel action `applyEngineAction` :130-158, op `fuel {x,z,item}`: lookup with hasOwnProperty on `ENGINE.FUEL` :149
  (so `toString` is refused), refuses at `cur >= FUEL_CAP - 1` :152, removes exactly 1 item :154, clamps :156.
  Client side: `interact` :294-301 sends fuel when the held kind is in `ENGINE.FUEL`; `promptRows` :238-251 (prompts.js
  provider, id 'engine', priority 1) and HTML `prompt` :302-312 both read `ENGINE.FUEL[held]` generically.
- `slot()` :122-127 creates an entry (cap 64). `serialize: () => st` :263 (live object, no revision counter);
  `load(data)` :264 just re-cleans, every net snapshot. `debug.fuel(x,z,sec)` :333-337 is the only external setter.
- engine-models.js: `buildMotor`/`buildWheel` only (shared geometry, `instance()`); nothing fuel-related.
- => Biofuel in motors = one line `FUEL.biofuel: 150` (+ `NAMES.biofuel`). 150 s = half the 300 s cap, ~3x wood.

## 2. Timed-station pattern to copy (kiln / cookpot)
- kiln-core.js is pure: `KILN` consts :5, `blank()` :26 `{r,q,t,h,f,o,n}`, `cleanEntry` :30-45, `cleanSlice(data,
  decorAt)` :48-66 (KEY_RE, |x|,|z|<=25, MAX 100, drops tiles without the decor), `sliceOf` :69-76 (`{v:1, r, k}`,
  idle entries omitted), `step` :93-103 (dt clamped to MAX_DT 1), `stepAll` :106-116, `applyKilnAction` :132-174
  (validate -> scratch Bag copy -> commit, every success `st.r++`, refusals change nothing).
- kiln.js module: host `update` steps + 1 s prune of orphan keys :99-114; `load` :55-64 skips unchanged net state by
  `r` (`-2` = host without slice); cached `serialize` by `r` :50-54; HTML `prompt` cached :116-133; actions
  `'kiln.load'|'kiln.fuel'|'kiln.take'` :145-151 emit `loot`/`build`/`notice`/`full`; `decorModel` :193-198.
- cookpot-core.js same shape (`POT` :5, `INGREDIENTS` :6 already lists `fish, seaweed, leaf, seed`), actions `pot.*`.
- Refiner = kiln minus the firebox: queue of organic items -> progress timer -> tray of `biofuel` (cap N), `take` action.

## 3. Progression stations: avoid
- progression-hooks.js:35 `STATIONS` = every items.js `category:'station'`; :33-34 `COOKERS` (+ fuel-free
  `stationExtraRecipes`, e.g. recycler) get a StationModel, the slot panel and localStorage state
  (`littleRaft.progression.v1`, NOT world.ext). `modelFor` :325-330 is asked BEFORE `content.decorModel` (game.js:635).
- game.js:1334 `content?.interact` runs before `prog?.interact` :1336, but a 'station' item would still get a
  progression StationModel and panel. Precedent items.js:231 juicer: `'decor'` "not 'station' (no slot panel)".
- Alternative considered: refiner as a recycler-style progression station (items.js:300 + `EXTRA_RECIPES` :339-341,
  fuel 0). Rejected: its state lives in progression, out of reach of a content-module tank and of world saves.
- `FUEL_VALUE` items.js:350 (`wood/leaf/seaweed`) feeds smelter/grill; leave biofuel out (scope creep, panel copy).

## 4. Content module pattern + cross-module reads
- content.js:7-40 module shape; register by import + append to `FEATURES` :69. **cookpot must stay last**
  (tests/cookpot.test.mjs:327; cookpot `interact` :228-232 eats with no target). Put `createBiofuel` before it.
- Items: either content-items.js (`CONTENT_ITEMS` :9, `CONTENT_RECIPES`, `CONTENT_DECOR` :105, `CONTENT_BLOCK_RADIUS`
  :106; kiln/motor/cookpot style, no unlock/tip) or items.js `'decor'` + `BLOCK_RADII` (juicer/power style, needs
  `tip`, `unlock`, radius; tests/progression.test.mjs:100-166). Both flow into ITEM_INFO (inventory-state.js:33, :55)
  and DECOR_TYPES (game.js:78). Motor lives in content-items, so keep tank/refiner/jug there for symmetry.
- The jug is never crafted: needs `ITEM_SOURCE.biofuel` in craft-book.js (~:452 cookpot block), else
  tests/craft-ux.test.mjs:124-136 ("every item has a source") fails. Also `CATEGORY` + `INFO` desc in craft-book.js:38-45,
  :71 (motor desc "burns leaves, wood or plastic" should mention biofuel). Icons: placeholder:true avoids the
  icons.svg + survival-ui.js SPRITES allow-list (tests/item-icons.test.mjs:13); optional `ITEM_ICONS` in item-svg.js.
- Cross-module access: modules get `make(ctx, peer)`; content.js:97-99 `peer(name)` -> live module,
  `peer.peek(name)` -> its `serialize()` (read only; scarecrow.js:88-90 uses it). `link(env)` :106-108 only carries
  daynight `wind()/night()` (power.js:136-137, :220) - not useful here. Peer calls are NOT wrapped by content's
  try/catch-disable, so the caller should guard them.

## 5. Wiring options for the tank -> motor top-up
- A) **Tank inside engine.js**: `fueltank` decor + `tanks:{"x,z":n}` in ext.engine; topped up in the host `update`
  next to `burn`. Pros: one owner of motor fuel, no peer. Cons: cleanEngine/prune/test churn in a mature file,
  refiner still elsewhere, engine.test `cleanEngine` deepEquals `{v:1,motors:{}}` (:29-31) would need updating.
- B) **New biofuel.js owns refiner + tank**; engine gains `FUEL.biofuel`, `NAMES.biofuel` and one host-only mod method,
  e.g. `pour(x, z, sec) -> accepted` (or pure export `addFuel(slice, decor, x, z, sec)` used by it and debug.fuel).
  biofuel.js host update (1 s cadence): for each tank with jugs, each motor with `cheb(tank, motor) <= 1`
  (power.js:71 uses Chebyshev distance) and `fuel <= FUEL_CAP - FUEL.biofuel`, call `peer('engine')?.pour(...)`,
  decrement jugs when accepted. Never waste a jug; deterministic order = sorted motor keys (`motorKeys` :55).
- C) Engine pulls via `peer.peek('biofuel')`: rejected, peek is read-only so the jug count could not be decremented.

## 6. Co-op, OLD_HOST, saves
- Guests: `ctx.action(a)` routes to host `content.action` (game.js:1282) with `actorBag`; guests never step timers
  or pour (mirror engine :280 / kiln :100). Net state = `content.serialize()` in every snapshot (game.js:1679);
  load paths `'save'` :482, `'restore'` :1947, `'net'` :2035.
- OLD_HOST: juicer.js:12, :98, :173-186 / power.js:12, :138, :191-197 - `hostHas = data !== undefined` on net load; a
  guest on an older host shows "Your friend's raft doesn't have a biofuel refiner yet" (prompt + 2400 ms notice) and
  sends nothing. Engine has no OLD_HOST: an old host's applyEngineAction says "Not fuel" for biofuel (harmless).
- Old builds: cleanWorld drops unknown decor types (game.js:208) and old Bags reject unknown kinds and start fresh
  (content-items.js:4) - same caveat as every new item. New build + old save: `load(undefined)` -> empty slice.
- Keep motor fuel in ext.engine (never duplicate it in ext.biofuel). Slice proposal:
  `world.ext.biofuel = { v:1, r, s, f: {"x,z": {q:[kinds<=6], t, n}}, k: {"x,z": jugs 0..8} }` (f = refiners,
  k = tanks), validated like kiln `cleanSlice` (decorAt type check, caps), `r` revision for net-skip and cache.

## 7. Tests to mirror
- tests/engine.test.mjs: registration :20-27, cleanEngine :29-57, applyEngineAction fuel :128-158 (exact leaf/wood/
  plastic numbers, "Not fuel", "Tank is full", bag untouched on refusal), fake ctx `makeCtx` :150-160, co-op push
  parity :203, prompt rows vs HTML :243, provider yields :259. Add: biofuel accepted (+150 s), NAMES text.
- tests/kiln.test.mjs / cookpot.test.mjs: pure core + fake-ctx module tests; cookpot :327 FEATURES-last check.
- tests/progression.test.mjs:100-166 if items go in items.js; tests/craft-ux.test.mjs:124 sources; item-icons :13.

## 8. Risks
- Refiner as items.js 'station' -> progression panel/model hijack (sec. 3). Use content decor.
- Top-up near the cap wastes fuel or spams: pour only below `FUEL_CAP - 150`, 1 s cadence, no notices per pour.
- Anchored raft: burn stops, tank should still top up (fine) but never toggles motors on.
- prune() in engine deletes entries for removed motors; tank must re-check `hasMotor` each pour (pour returns 0).
- Organic list overlap with cookpot INGREDIENTS / FUEL_VALUE is fine (different station), but keep raw `fish`,
  `seaweed`, `leaf`, `sharkmeat`, `berries`, `coconut`, `seed`; exclude cooked food and meals (cosy: no waste of
  cooked work). Engine already burns `leaf` directly; refining 3 leaves -> 1 jug (150 s) beats 3x20 s.
- Two E handlers: engine `target()` only matches motor/wheel, so tank/refiner targeting never collides.

## 9. Recommendation
Option B. New `biofuel-core.js` (pure: consts, ORGANIC table, clean/slice/step/apply for `bio.load|bio.take|
bio.fill`), `biofuel-model.js` (refiner vat + tank drum), `biofuel.js` module (kiln-style refiner, tank jugs, host
pour via `peer('engine').pour`, OLD_HOST, HTML prompt only). Engine: `FUEL.biofuel: 150`, `NAMES.biofuel`, `pour()`
host method (reuse `slot`, clamp, `hasMotor`). Items in content-items.js: `refiner`, `fueltank`, `biofuel`
(Biofuel Jug, stack 10); decor + radii; craft-book source/category/desc. Insert `createBiofuel` before createCookpot.
