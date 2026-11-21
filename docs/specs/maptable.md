# Map Table + discovered-islands chart (spec)

Research: `docs/features/maptable-research.md` (anchors re-checked at `47300f5`). Files: `dist/maptable.js` (content module `name:'maptable'`, pure helpers exported), `dist/maptable-ui.js`
(lazy dialog), `dist/maptable-model.js` (mesh), `tests/maptable.test.mjs`. Small edits: `dist/items.js`,
`dist/content.js`. No game.js edits. No new deps. All names/art are original.

## 1. Item, recipe and placement route: `dist/items.js` (progression catalogue)
The craft list (`survival-ui.js:126 recipeList()`) shows every `RECIPES` row, and `RECIPES` merges both
`CONTENT_RECIPES` and `recipeTable()` from items.js (`inventory-state.js:77,83`), so either route is visible.
Choose **items.js** because: copper ingot (the brass fittings) exists only there; `recipeGate`
(`progression-hooks.js:231`) gives the normal "next goal" greying and tooltips; `PLACEABLE_IDS` and
`BLOCK_RADII` already feed `DECOR_TYPES`/`BLOCK_RADIUS` (`game.js:61,69`); and newer stations (smelter, grill,
research table) all live there. A CONTENT_RECIPES row would instead be gated by the older Tinker's Desk
(`storage-research.js:48`), which is a second unlock system for one item.
- Add in the `build / decor` block (after `net`, `items.js:169`):
  `item('maptable', 'Map Table', 'decor', { iconTint: '#c9a46a', stack: 5, placeable: true,
   recipe: hand({ wood: 6, rope: 3, nail: 2, copperingot: 1 }), unlock: research('copperingot'),
   tip: 'A little chart table. It remembers the islands you meet and points the sail where you like.' })`.
- Category **'decor'**, not 'station': `STATIONS` (`progression-hooks.js:21`) and `prog.interact` must not grab it.
- `BLOCK_RADII.maptable = 0.5` (test `progression.test.mjs:120,123` requires the pair).
- Model: `prog.modelFor`/`createCraft`/`createSignalModel` return null for unknown types, so `game.js:389,496` fall
  through to `content.decorModel('maptable')` (placed model and ghost).
- E: `content.interact` runs before `prog.interact` (`game.js:942,944`), so the module's `interact` opens the chart.

## 2. content.js edits
- `import { createMapTable } from './maptable.js?build=v3-survival-ae77fa84ac2b';` and append it to
  `FEATURES` **after** `createIslands`.
- Sibling peek (host `world.ext` is only refreshed at save/capture, `game.js:1023`, so it is stale for live
  island state): in `createContent` build `const peek = name => { const m = mods.find(x => x.name === name && !x.dead);
  return m ? call(m, 'serialize') : undefined; };` before the loop and call `make(ctx, { peek })`. Existing
  factories ignore the 2nd arg. islands `serialize` is cheap (cached objects, `islands.js:266-278`); read, never keep.

## 3. State `world.ext.maptable` (host-authoritative)
```
{ v:1, rev:int, seq:int,
  isl:[{s:uint32 seed, x:int, z:int, f:0..3}]   // f bit1 = visited, bit2 = gathered; cap 40, oldest dropped
  pins:[{n:int id, x:int, z:int, i:0..3}]        // i: 0 star, 1 fish, 2 heart, 3 flag; cap 8
  trail:[x0,z0,x1,z1,...] }                      // ints, cap 120 points (240 numbers)
```
Coordinates are seabed metres = `world.sailing.gx/gz` frame (gx grows as the raft moves along
`(sin h, cos h)`, `sailing-core.js:162-166`). Draw `wrapAxis(p - g, HG)` with `HG = SAIL.GROUND_WRAP/2`.
`seq` is the next pin id; `rev` increments on every change.

`export function cleanMap(d)` (never throws, fresh object): defaults `{v:1,rev:0,seq:1,isl:[],pins:[],trail:[]}`
if `!d || d.v !== 1`. `isl`: array items with `Number.isInteger(s) && s>=0 && s<2**32`, finite x/z clamped to ±HG and
rounded, `f` int 0..3 else 0; dedupe by seed (last wins), keep last 40. `pins`: int `n>=0` unique, finite x/z clamped
+ rounded, `i` int 0..3 else 0, keep last 8. `seq = max(int seq, max n + 1)`. `trail`: array, drop non-finite pairs,
round, clamp, keep last 240 numbers (even length). `rev` int >= 0 else 0. Old saves: `load(undefined)` → empty chart.

## 4. Host logic (`update(dt)`, role !== 'guest', running)
Sample at 2 Hz (accumulator, no allocations in the hot path).
- **Trail**: `g = world.sailing`. If trail empty, push `round(gx), round(gz)`. Else if
  `hypot(wrapAxis(gx-lastX,HG), wrapAxis(gz-lastZ,HG)) >= TRAIL_STEP (25)` push. `export function pushTrail(t, x, z)`:
  when length would exceed 240, first decimate `t = t.filter((_, k) => (k >> 1) % 2 === 0)` (keeps pairs 0,2,4..;
  older trail gets sparser), then push; always ends with the newest point; returns true if changed.
- **Discovery**: `i = peek('islands')?.isl`; if present compute `lay = layoutFor(i.seed)`,
  `p = pathAt(clock - i.born, i.dock, lay.dockZ)` (`islands-layout.js:118`) with `clock = peek.clock`.
  On phase `'docked'` (or any non-'gone' phase for an island already present at first tick) and seed not yet in
  `isl`: `recordIsland(st, seed, round(gx + i.side*i.off), round(gz + lay.dockZ))` (cap 40, drop oldest).
  While non-gone: visited if `ctx.physics` or `ctx.other` (host-side guest pose) is within `lay.R*ISLAND.RIM + 1`
  of `(i.side*i.off, p.z)` → `f |= 1`; gathered if every `i.used[k] >= lay.nodes[k].max` → `f |= 2`. Notice once on
  record: `Charted ${islandName(seed)}`.
- Every change: `rev++`, mark `dirty` (serialize cache invalid). Never touch meshes from data.
- Module `debug` (`raftDebug.content.maptable`, host only for writes): `{state(), addIsland(seed, x, z, f), pin(x, z, i),
  trail(points), open(), close(), course(n)}`.

## 5. Actions (`action(a, actor)`, host only, `a.kind === 'map'`)
- `{op:'pin', x, z, i}`: x/z finite; `|wrapAxis(x - gx, HG)|` and z likewise `<= PIN_RANGE (12000)`; `i` int 0..3;
  refuse if 8 pins (`emit notice 'The chart holds 8 pins. Tap one to lift it.'` to actor); per-actor cooldown .25 s.
  Push `{n: seq++, x:round, z:round, i}`.
- `{op:'unpin', n}`: int; remove matching id (missing id is a no-op, still returns true).
- Other op / bad data → return true (ignored). Host and guest both call `ctx.action` (`game.js:754-759`).
- **Set course** reuses `ctx.action({kind:'sail', op:'heading', heading:h})` (`sailing-core.js:179`,
  routed by `game.js:826`). `export function courseTo(gx, gz, tx, tz)` returns
  `{heading: atan2(dx, dz), bearing: ((atan2(dx, -dz)*180/π) + 360) % 360, dist: hypot(dx, dz)}` with
  `dx = wrapAxis(tx-gx,HG), dz = wrapAxis(tz-gz,HG)`. `heading` follows the sail convention (0 = +z,
  π/2 = +x); `bearing` follows the HUD/signal convention (0 = north = -z, 90 = east = +x, `signal.js:134`).
  Notice: `Course set: NE · 340 m (wind still decides the speed)`. If the anchor is down add `Anchor is down`.

## 6. serialize / load
- `serialize()`: return the cached object; rebuild (fresh arrays) only when `dirty`. Worst case ≈ 3.6 KB (`EXT_MAX` 200 k).
  - `load(data, from)`: `'net'` → if `data?.rev === st.rev && data?.v === 1` return (cheap path, ~8 Hz); else
  `st = cleanMap(data)`, `viewRev++`. `'save'`/`'restore'` → always `cleanMap` (raft visit restores own chart).

## 7. Interact + prompt
- `target(aim)`: nearest `world.decor` with `type === 'maptable'` within `REACH 2.6` m of `ctx.physics`, in front of
  the camera (copy `storage-research.js:278-298` cone test, off `<= .85`).
- `interact(aim)`: if target → `ui.open()` (lazy `import('./maptable-ui.js')` like `storage-research.js:302`;
  first E while loading shows `notice('Unrolling the chart…')`), return true.
- `prompt(aim)`: `'<kbd>E</kbd>Read the chart'` (kept for the legacy path; `#contextPrompt` is hidden).
- `raftPrompts` provider, registered in the factory when `window.raftPrompts?.provide` exists (retry each
  `update` until registered), unregistered in `dispose`:
  `provide({id:'maptable', priority:1, prompt:(c) => (!c?.state?.running || c.state.pickup || (c.state.role === 'guest'
  && !c.state.networkReady) || ctx.uiOpen() || !target(null)) ? null : {key:'E', label:'Read the chart'}})`.
  It steps aside for pickup and connecting prompts (`prompts.js:63-66`).

## 8. Dialog `dist/maptable-ui.js` → `createMapTableUI(api)` → `{open, close, isOpen, update, dispose, debug}`
- `<dialog id="lrMap">`, style injected once (`<style id="little-raft-map-style">`), wood frame like
  `logbook-ui.js:17-59`, inner parchment: cream `#f3e6c4` paper, sepia ink `#5a4128`, soft vignette, dashed grid
  every scale/4, small compass rose with **N at top (-z up)** matching `sailing-ui.js:60`.
- `open()`: `api.releaseLock()` (`ctx.releaseLock`), `showModal()`, draw. `cancel`/`close` → `ctx.requestLock()`
  only if running. Block wheel (`stopPropagation`). AbortController for every listener; `dispose` aborts and
  removes the dialog. Do not open over another `dialog[open]`.
- Canvas: CSS size `min(92vw, 70dvh, 560px)` square; backing size × `min(devicePixelRatio, 2)`.
- Scale presets (chart half-width): `[150, 600, 2500, 10000]` m, default 600; `−`/`+` buttons (44 px) and a label
  `600 m`. Screen map: `sx = cx + dx*k`, `sy = cy + dz*k` (`k = R_px / scale`), dx/dz relative to `gx/gz`.
- Layers (in order): paper → trail (dotted, alpha fades oldest→newest 0.25→0.9) → islands (blob from
  `layoutFor(seed).R` and the shared `shape(θ)`, min 6 px radius; name label only when `scale <= 2500` or the
  island is selected; ticks: ✓ "visited", ★ "gathered") → signal wedge → pins (doodles) → raft glyph at centre
  rotated to `heading` (screen dir `(sin h, cos h)`), faint wind arrow from `windDir` → selection ring.
- **Signal wedge**: `r = signalReadout(world.signal, raftCentre(world.tiles), countAntennas(world.decor), ctx.elapsed)`
  (`signal.js:126`). If `r && !r.listening`: dashed wedge from centre at compass `r.heading` (canvas angle
  `θ = r.heading° → (sin θ, -cos θ)`), half-angle `TIERS[r.antennas].wobble + 6°`, length
  `max(40 px, r.distance*k)` capped at the edge; a "?" buoy at the tip only when `r.marker`; caption `r.label`.
  Never more precise than the HUD.
- Islands list under the canvas (scroll; always shown at `max-width:520px`, collapsible on desktop): name, ticks,
  bearing/distance via `courseTo`; tap selects.
- Pointer (pointer events, not mouse): tap within 16 css px of a pin → `unpin` (clears selection if it was that
  pin); else within 16 px of an island → select it; else (if < 8 pins) send `pin` with the 4-icon chooser's
  current icon and select the new pin (by position match once it arrives). Full → shake + notice.
- Buttons: icon chooser (4 × 44 px), `Set course` (disabled with no selection) → `courseTo` + sail action,
  `Close`. Empty chart text: "Sail a while. Islands you meet are inked here."
- Redraw only while open, when `api.viewRev()` changed, the raft moved ≥ 0.5 px at the current scale, heading
  changed > 1°, or the signal wedge exists (4 Hz cap). `update(dt)` is a no-op while closed.
- `debug`: `{open, close, scale(i), draw(), hits(x, y)}`. Guests draw `st` + their `world.sailing` (`game.js:1214`).

## 9. Model `dist/maptable-model.js` → `createMapTableModel(T)` → Group
Origin = tile top centre (as `storage-research-model.js:6`), footprint ≈ 1.1 × 0.8, height ≈ 0.85. ≤ 8 meshes,
materials and geometries created once and shared by every instance: table top (box 1.1×.06×.8, driftwood
`#a27a4f`), 4 legs (one merged leg geometry or 4 meshes of one box), open chart sheet (box .8×.01×.55,
`#efe0bb`, small canvas-free ink cross baked as a second thin box `#6b4e2e`), rolled chart (cylinder r .045,
len .6, `#e8d6a8`, on the right edge), brass pin cup (cylinder r .05 h .07, `#c58b3b`). `castShadow` on top/legs; group name `maptable`.

## 10. Names
`export function islandName(seed)`: `A[floor(hash3(seed, 0x4d61, 1) * A.length)] + ' ' + B[floor(hash3(seed, 0x4d61, 2) * B.length)]`
(`hash3` from `islands-layout.js:44`, use the same specifier as islands.js).
A = Pebble, Mossy, Sunny, Clover, Biscuit, Honey, Pillow, Teacup, Puffin, Marigold, Seaglass, Sleepy, Butter,
Dandelion, Pocket, Whistle. B = Cay, Isle, Knoll, Nook, Haven, Bank, Holm, Atoll, Shoal, Landing, Rest, Hollow (nothing stored).

## 11. Tests `tests/maptable.test.mjs` (pattern of `tests/signal.test.mjs`, RAFT_DIST-aware base)
1. `cleanMap`: undefined/null/[]/v:2 → defaults; junk entries dropped; caps 40/8/240; dedupe seed; pin ids unique and
   `seq > max n`; clamps to ±HG; result JSON round-trips; never throws on hostile input (getters that throw, NaN).
2. `pushTrail`: spacing < 25 m ignored (wrap-aware across ±HG); filling past 120 points decimates, length ≤ 240,
   even, newest point last, first point kept.
3. Discovery via the factory with a fake ctx + `peek` stub: approach phase → nothing; docked → one entry at
   `(gx + side*off, gz + dockZ)`; same seed twice → one entry; player within R → `f&1`; all used → `f&2`; 41 seeds →
   40, oldest gone; guest role never appends.
4. `islandName`: same seed → same name, many seeds → ≥ 50 distinct names of 1000, only listed words.
5. Pin actions: pin adds with ids, 9th refused, bad x/z/i ignored, out of range refused, cooldown, unpin by id,
   unknown id no-op; `rev` bumps; `serialize()` returns the same object until a change.
6. `courseTo`: target +z → heading 0, bearing 180; +x → heading π/2, bearing 90; -z → |heading| π, bearing 0;
   across the wrap seam the short way; `stepSailing` direction `(sin h, cos h)` moves `gx/gz` toward the target.
7. `load(..,'net')` with equal rev is a no-op (same state object); items.js has `maptable` placeable + radius.

## 12. QA screenshots (scratch `shoot.py` copy with probe steps, `/usr/bin/python3.13`)
Setup: `raftDebug.progression.place('maptable')`, `raftDebug.content.islands.spawnNear(1234, 30)` then skip until
docked, `raftDebug.content.maptable` helpers to add 3 islands, 3 pins and a trail; open with `debug.open()`.
Shots: (a) desktop 1280×800 dialog at 600 m with raft, trail, islands + ticks, pins, signal wedge (receiver + 1
antenna placed); (b) desktop 10 km scale; (c) phone 390×844 dialog: canvas fits, list below, 44 px buttons,
no horizontal scroll; (d) the table model on the deck + prompt "E Read the chart". Check console clean, `npm test` green.
