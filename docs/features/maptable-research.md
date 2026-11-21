# Map table + discovered-islands chart — research

Status: research only (no code changed). Line numbers are for `6ab9b24` (raft-master merge).

## 1. Genre patterns (general, in our own words)
- **Navigation station.** Survival-sailing games often have a table, desk or helm screen that shows a
  top-down chart of the area around the boat: your own marker with a heading arrow, landmarks you
  have already seen, and markers for points of interest.
- **Fog of war / "discovered" lists.** The chart starts empty and fills in as you travel. Islands you
  have spotted get an icon. Islands you have landed on or fully looted get a different look.
- **Player pins.** You can drop a few custom markers ("come back here", "nice reef") and sometimes
  name them.
- **Set a course.** Some games let you click on the chart to point the boat at a spot (an autopilot or
  helm link). Others keep the chart for reading only and leave steering to the wheel or sail.
- **Trail / wake line.** A dotted line of where you have been, so you can see how far you have come.

## 2. Our cozy take (original)
- **Map Table** (placeable station, 1 tile): a small driftwood table with a rolled chart and a brass
  pin cup. Craft it from planks + rope + 1 copper (fits the progression tier after binoculars).
- **E on the table** opens a parchment-style `<dialog>` with a 2D `<canvas>` chart, ink-on-paper look
  (cream paper, sepia ink, a soft compass rose, hand-drawn island blobs from `layoutFor(seed)`).
  - Centre = raft. A little raft glyph with a heading arrow (sail heading) plus a faint wind arrow.
  - **Discovered islands**: one inked blob per island seen. Each shows a cozy generated name from the
    seed (e.g. "Pebble Cay" from two word lists, so no names need to be stored) and a stamp:
    *spotted*, *visited* (someone stood on its sand) or *gathered* (all nodes used).
  - **Signal cache**: a dashed bearing line plus a "?" buoy when `world.signal.cache` exists. The
    blur scales with the antenna tier, the same as the HUD readout.
  - **Trail**: a dotted wake of where the raft has sailed (it fades with age).
  - **Pins**: tap or click to drop up to about 8 pins, with 4 doodle icons (star, fish, heart, flag).
    Tap a pin to remove it.
  - **Set course** (optional, nice to have): a button, then click the chart, and the host sets the shared
    sail heading to that bearing (the same action the R-steer sends). It only aims the sail. Wind
    still decides the speed, so nothing is automated beyond aiming.
- No pressure: nothing expires, the chart only grows, and pins are shared between co-op players.

## 3. Code anchors
### How the raft "moves" (the world scrolls; the raft stays at the origin)
- `dist/sailing-core.js:1-3`: "The world moves, the raft stays at the origin". The state lives in
  `world.sailing` with `{heading, windDir, vx, vz, wx, wz, gx, gz, raised, anchored}`
  (`DEFAULTS` at :29-32).
- **World position = `world.sailing.gx/gz`**. This is the seabed offset, i.e. the raft's
  displacement over ground. It is stepped at :162,166 (`dg = (v + current) * dt`) and wrapped into
  ±`GROUND_WRAP/2` = ±52 500 m (:24, :164-166). `wx/wz` is the water offset, used only by the ocean
  shader. With the anchor down, `dg = 0` (:144-145).
- Heading convention: direction = `(sin h, cos h)`, so h=0 points +z (:93-94, :203). North on the HUD
  compass is world **-z** (`dist/sailing-ui.js:60`). The chart should draw -z up, so it matches the badge.
- Steering: `applySailAction` `op:'heading'` (:179-181). The guest sends
  `ctx.action({kind:'sail',op:'heading',heading})` (`dist/sailing-world.js:244`). The host applies
  it locally (:240). `heading` is not in `LIMITED_OPS` (:11), so a single "set course" action is cheap.
- Scenery drifters: `addDrifter` (`sailing-world.js:90-95`) stores the seabed-absolute base. They are
  shown at `wrap(base - g, WRAP=150)` (:97-101). The 12 decorative scenery islands are made at
  `dist/game.js:398` (about 65-90 m out). Because they wrap every 300 m they are **not unique places**.
  Don't chart them, or chart them only as a repeating "reef" texture.
- The guest's displayed offsets `disp.*` are smoothed toward the host (`sailing-world.js:277-288`).
  `world.sailing` itself reaches the guest in host state (`game.js:1214`).
- `sailing.debug()` (`sailing-world.js:328`). `info.speed`/`travelDir` (:258-261, :271-272) can drive
  the raft arrow.

### Loot islands (the "discoverable" ones)
- `dist/islands-layout.js:5-22` `ISLAND` timeline: the first island arrives at 90 s, then one every
  150-240 s of calm. Approach 25 s, docked 180 s (extended up to 600 s while someone is near), depart
  30 s. **Only one island exists at a time** (`st.isl`). There is no history, no name and no id
  other than its uint32 `seed`.
- `layoutFor(seed)` (:78-108) is a pure function: R 6-9 m, rotation, `dockZ`, nodes. It gives us a
  stable blob shape and name for each seed for free.
- `pathAt` (:118-138): the island's z is **raft-relative and scripted**. `place()` puts it at
  `(side*off, path.z)` (`dist/islands.js:161-177`) and ignores sailing (no `gx` use in islands.js).
  So an island does not stay at a fixed world point. Chart it at the docking spot:
  `(gx + side*off, gz + dockZ)` sampled when its phase first becomes `docked`.
- Save/net slice `world.ext.islands = {v, clock, next, isl:{seed, born, dock, side, off, used[]}}`:
  `serialize` :266-278, `load` :280-300, validator `clean` (`islands-layout.js:163-182`).
  Guests learn about islands only through this ext slice (about 8 Hz). A guest's map module can watch
  `ctx.world.ext.islands.isl.seed` change, but the **host** must record discoveries.
- "Visited" = `sandState.onSand` (`islands.js:50`, set in `standOnSand`, `islands-layout.js:227`).
  This is local to each player. A guest sends an action to mark one visited, or the host checks
  `near(ctx.other)` (`islands.js:222`).
  "Gathered" = `isl.used[k] === nodes[k].max` for all k (`applyGather` `islands-layout.js:194`).
- Spawn notice text: `islands.js:190`.

### Signal cache
- `dist/signal.js:57-92` `signalTick`: `world.signal = {cooldown, cache:{id, token, x, z, phase, near}}`.
  `x/z` are **raft-frame** coords clamped to ±78 (`LIMIT`, :5, :72), and the cache drifts toward the
  raft (:84-87). Bearing uses `atan2(dx, -dz)`, so north is -z (:134). That matches the HUD.
- `signalReadout(signal, me, antennas, elapsed)` (:126-141) already gives a wobbled heading and
  distance text for each tier. Reuse it so the chart is never more precise than the HUD.
- game.js wiring: imports :31, readout :571, `cleanSignal` in `cleanWorld` :185.

### Binoculars / receiver HUD
- `dist/progression-hooks.js:239-261` `updateHud()`: a plain fixed `div#binocularsHud` (z-index 30,
  `pointer-events:none`). The receiver and antenna are core `DECOR_TYPES` (`game.js:61`).

### Dialog UIs to copy
- `dist/logbook-ui.js`: wood-frame `<dialog>` with injected `<style id>` (:5-6, CSS :17-59). Phone
  rules are at `@media (max-width:520px)` (:59). `open()` calls `onPause`, `exitPointerLock`, then
  `showModal` (:163-171). `cancel`/`close` handlers resume (:182-183). Wheel `stopPropagation` (:201).
  The hotkey is blocked while another `dialog[open]` is showing (:203-212).
- `dist/storage-research-ui.js`: lazy-imported UI (`storage-research.js:302`). `open()` calls
  `ctx.releaseLock?.()` first (:313-316). The dialog is `#lrStorage` with `max-width:96vw` (:16).
  `openInfo()` is used for QA (:357). `ac.abort()` on dispose (:360).
- game.js: `uiBlocked = dialogOpen() || survivalUI.isOpen` (:305), so any open `<dialog>` already pauses
  input. `releaseLock`/`requestLock` (:371, :610, :641).

### Content hooks / placement / prompts
- `dist/content.js:7-23` module shape, `FEATURES` at :30. `EXT_MAX` 200 000 chars **for the whole
  ext** (:31). Docs: `docs/features/content-hooks.md`.
- Placeable: there are two systems. The progression catalogue `dist/items.js` (`placeable: true` stations
  :173-179, rendered by `prog.modelFor`, `game.js:496`) and the content `CONTENT_DECOR`
  (`content-items.js:24`, `content.decorModel`). The newer stations (research table, grill,
  smelter) use items.js. Put the map table there too and handle E in the content module's
  `interact`.
- Prompts: `dist/prompts.js:3-6`. Use `raftPrompts.provide({id, priority, prompt})` and return null
  when a pickup or connecting prompt is showing (`statePrompt` :63-66). Nothing calls `provide` yet,
  so this is the first one. `#contextPrompt` is hidden (`prompts.css`), so `content.prompt()` alone shows nothing.

## 4. Proposed state (host-authoritative, `world.ext.maptable`)
```
{ v:1, isl:[{s:seed, x, z, f:0|1|2}] (cap 40, oldest dropped), pins:[{x, z, i}] (cap 8),
  trail:[x0,z0,x1,z1,...] (rounded to integer metres, cap 120 points, a new point every >=25 m) }
```
Coordinates are seabed (`gx/gz`-frame) metres. The chart draws `p - (gx,gz)` around the raft.
Wrap at ±52.5 km never matters in practice, but use `wrapAxis(p - g, HG)` anyway.
Actions: `{kind:'map', op:'pin', x, z, i}`, `{op:'unpin', k}`, and set course reuses `{kind:'sail', op:'heading'}`.

## 5. Risks
- **Save/net size**: ext is sent in full about 8x/s. 120 trail points × ~10 chars + 40 islands ≈ 2 KB.
  Fine under `EXT_MAX`, but keep `serialize()` cached and return the same object unless something
  changed. Decimate the trail (drop every other point when full) so it is never unbounded.
- **load('net') cost**: redraw the canvas only while the dialog is open and the data revision changed.
  Never build meshes from the data.
- **Co-op**: only the host appends islands and trail (the guest's `gx` is smoothed, not authoritative).
  Guests send pin actions. Validate x/z as finite and clamped, i as an int, and cap the pin count. "Visited"
  needs the guest's position, so use `near(ctx.other)` on the host or a validated `{op:'visit'}`.
  During a raft visit (`restoreOwnRaft`, `content.load(...,'restore')`) the guest gets its own chart back.
- **Old saves**: `load(undefined)` gives an empty chart. Islands met before the feature existed are
  simply not on it. The current `st.isl` can be added on the first tick.
- **Frames**: the signal cache is in the raft frame (not seabed), and loot islands ride with the raft. Draw
  the cache relative to the raft and do not store it. Islands are stored once at the dock sample.
- **Phone layout**: canvas sized `min(92vw, 70dvh)` square, `devicePixelRatio` capped at 2, pointer
  events (not mouse) for pins, 44 px buttons, and island names drawn only when zoom allows (or listed under
  the canvas at `max-width:520px`).
- **Set course** while someone holds R-steer: the host's steer continues from the new heading
  (`sailing-world.js:322-325`). That is acceptable, but show a notice.
- **Originality**: parchment/ink art and generated names are ours. Don't reuse any commercial game's names.
