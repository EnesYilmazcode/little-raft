# Spyglass research (held zoom tool)

Feature: a craftable Spyglass. Hold right mouse (pad LT) to zoom in, with a soft vignette. While zoomed, a
label names what is under the crosshair far away: island name + distance, signal cache, barrels/bottles.
Friendly, local only, no world state. Line numbers are for `dist/` as of this note.

## 1. Raft's binoculars (reference)
- Web research was mostly blocked. `raft.fandom.com` does not resolve in this sandbox (it would have to be allowed in
  the session's network settings), and WebSearch only returned pages for other games. The one Raft source was a Steam
  thread (steamcommunity.com/app/648800/discussions/0/3153076242547870493, 2021). In it, players say the zoom is small,
  the view is masked heavily, and **render distance is not increased**. A reply mentions mouse-wheel zoom.
- From memory (not checked): in Raft you research the binoculars and then craft them. They are a held item: you hold
  RMB to look through them and get a lens mask. They show no markers or labels and take no damage. I do not have
  exact recipe numbers.
- So the label overlay is our own friendly addition. Keep Raft's idea of a modest zoom. Our camera far plane is 200 m
  and the fog runs 60-260 m (game.js:435-436), so zooming in cannot show anything past about 200 m.

## 2. IMPORTANT: a Binoculars item already exists
- `dist/items.js:160-162`: the `binoculars` item is a tool with stack 1 and no durability. Recipe: `hand({glass:2,
  copperingot:1, hinge:2, bolt:1})`, unlocked by `research('glass','copperingot')`. Its tip says it spots the
  nearest barrel. It also appears at craft-book.js:20 and :88, item-svg.js:167, and the goal at items.js:305.
  tests/survival.test.mjs:542 checks the order of the tools group, so a new recipe must be added to that list too.
- `dist/progression-hooks.js:252-276`, `updateHud()`: shows the `#binocularsHud` text "Barrel N m ahead-left" at
  `top:18%` while `toolRole(kind)==='binoculars'`. It scans `world.items` without allocating.
- The binoculars have **no held model** (they fall back in held-items.js), they are **not in the co-op `HELD` list**
  (coop.js:27-28), and they do not zoom.
- Decision for the planner: (a) add a new early `spyglass` item (glass needs a smelter, so it could be
  `wood 3, plastic 2, scrap 1`, or `glass 1, wood 2, rope 1` with `discover('glass')`). Make it zoom 2.5x, and let the
  binoculars zoom too (3.5x) and keep their barrel HUD. Or (b) add zoom to the binoculars only. I recommend (a), with
  one module that is active when `kind` is `spyglass` or `binoculars`. Hide `#binocularsHud` while zoomed so the two
  texts never overlap.
- To add the item, copy the `finder` pattern: items.js:170 (item), held-items.js:38 (`HOLD`), :60 (`SIZE`), :250-251
  (model branch, or a new `spyglass-model.js`), item-svg.js icon, craft-book.js:20 and its desc. Append to
  coop.js:28 `HELD` (append only), coop-avatar.js:72-127 (remote model and `TOOL_TILT`), and the tests' tools list.

## 3. Hooks to reuse
**content.js** (registry, :7-31 has the module shape). Add `createSpyglass` to the imports and to `FEATURES` (:47).
- `use(aim, kind)` :91 (left click, from game.js:1269 `useSelected`). `alt(aim, kind)` :92 (right click, from
  game.js:1670). The first module that returns true wins. paint.js:226/:238 return false unless the kind is `brush`.
- `update(dt)` :84 is called at game.js:1597, **after** `updateCamera` (:1588) and before render (:1628).
- `prompt(aim)` :90 returns `<kbd>RMB</kbd>Hold to look`. promptParts (:61) turns it into `#lrPrompt`
  (prompts.js `raftPrompts`).
- ctx (game.js:420-431): `camera`, `world`, `physics`, `options` (fov, sensitivity, cameraMotion), `localBag()`,
  `uiOpen()`, `aim()` (frameAim), `running`, `ocean`, `other`, `play`, `notice`, `esc`. There is no `heldKind`: read
  `ctx.localBag()?.selected?.kind` like treasure.js:75 and progression-hooks.js:254 do. The `{peek}` second arg
  (content.js:75) reads sibling serialize().
- `docs/features/content-hooks.md` lists every hook line. Add new ones there.

**Camera / FOV / viewmodel (game.js)**
- :1427 `updateCamera`: `const fov = running ? options.fov : 48; if (camera.fov !== fov) {...updateProjectionMatrix()}`.
  This runs **every frame**, so it already restores the FOV. If a module sets `camera.fov` in `update()`, it fights
  this line (two projection updates per frame), and `hands.update` gets the wrong `hp.fov` (:1451).
  Recommended hook: add `zoom()` to content.js (first module wins, default 1) and use
  `options.fov / (content?.zoom() || 1)` at :1427. Then the FOV snaps back as soon as the module reports 1.
- Viewmodel: hands.js:85 `VM_TAN` (60 deg). hands.js:428 scales `root` by `tan(fov/2)/VM_TAN` from `params.fov`, so
  the hands keep their size at any FOV **if** hp.fov is the real zoomed FOV (the hook above gives that). The depth-clear
  pass is game.js:546-558 (renderOrder 999/1000), and it does not depend on FOV.
- Suggested look: lift the spyglass to the eye (`hands.setPose`, :1440-1441, decided once per frame) and hide the
  viewmodel while fully zoomed (Raft's lens mask covers it). Add a `viewmodelHidden` flag next to :1442, or use
  `hands.setHeld(null)`, but the swap animation makes that noisy.

**Sensitivity**
- Every path goes through `look(dx, dy, k)` at game.js:871. Callers: the controls lane at :1754 (`look(dx,dy,1)`,
  already scaled in input.js:268 `MOUSE_LOOK*sens()` and the pad at :190), legacy locked mouse at :1666, and drag-look
  at :1692. Scale `k` by `1/zoom` inside `look()` (one line), or pass `sensitivity:() => options.sensitivity/zoom` at
  :1753 (that misses the pad). `look()` is the single choke point.
- settings.js:17 `sensitivity` is 0.2-3 (default 1). :19 `fov` is 60-100 (default 75). Add a zoomed-sensitivity
  setting later only if playtests ask for it.

**Input (RMB / LT)**
- input-map.js:48 `aim: b(['Mouse2'], ['Pad6'])`, rebindable, labelled "Aim / reel". The input.js:97-101 mousedown
  only fires while locked. mouseup always fires. While `isBlocked()`, `st.down` is false (input.js:236), so opening a
  menu releases the zoom by itself.
- Best "is held" test: `globalThis.raftControls?.input.down('aim')` (controls.js:116). It covers mouse and pad and
  respects rebinding. There is no content hook for RMB *release*. A fallback for when `controls` is null (game.js:1763)
  or for drag-look mode: listen to canvas `pointerdown`/window `pointerup` button 2 in the module, with an
  AbortController in `dispose()`.
- Pad LT also fires `reelDown/reelUp` (controls.js:72-75 → game.js:1761). That only sets `reeling` when `castOut()`,
  so it is harmless with a spyglass in hand.

**Targets for labels**
- Islands: `islandNow()` from islands.js:41 must be imported with the same `?build=` specifier, or you load a second
  instance whose accessor stays null (:36-37). It returns `{seed, cx, cz, gy, R, phase, ...}`, cached, so do not keep
  it. The name comes from `islandName(seed)` (maptable.js:29) and the distance from `distText(d)` (maptable.js:120,
  "40 m" / "1.2 km"). An island only exists in the scene from z=-60 to +60 (islands-layout.js:10). Charted far islands
  are in `peek('maptable').isl` (ground coords). An optional "off-screen bearing" label could use `courseTo`/`compassPoint`
  (:114-116).
- Signal cache: `ctx.world.signal?.cache` `{token,x,z}` (signal.js:24-32), which is also mirrored in `world.items` as
  type `cache`. Existing marker code is game.js:790-808 (`project()` :2013, `edgePoint` signal.js:144).
- Floating items: `ctx.world.items` `{type,x,z,token}`. Types are in game.js:76 (`wood, leaf, scrap, barrel, plastic,
  cache`, plus `bottle`). Names are in game.js:77 `ITEM_NAMES` (not exported, so copy the 3 names you need). Positions
  are kept within |x|,|z| < 80 (:211), so all items sit within about 113 m. Meshes bob slightly. The y is about
  `ITEM_FLOAT` 0.05.
- Trader barge: **does not exist** (no `trader`/`barge` in dist). Leave a target slot for a future `peek('trader')`.
- Picking: use a cone test, not raycasts. For each candidate, take the angle between the camera forward and the
  direction to it, and keep the smallest angle under about 3 deg / zoom, within 200 m. That is cheap: under about 60
  candidates and no Raycaster allocation. Islands use a sphere (cx, gy, cz, R).

## 4. Right-click today, and conflicts
- game.js:1669: hammer + RMB opens the build wheel (closed on window pointerup :1694). :1670: any other held kind calls
  `content.alt(pickCenter()|currentAim(), heldKind())`. Only paint (brush) consumes it today. RMB with the rod, hook,
  spear or other items does nothing (the left button is the tool, :1671).
- So RMB is free for the spyglass/binoculars. There is no conflict with the hammer (other kind), the rod (other kind)
  or the pad build radial (Pad12, controls.js:41; the radial blocks look while open, :62-66).
- `heldKind()` (game.js:362) returns `fishingrod`/`hook` while a cast is out. The spyglass cannot be "held" then, which
  is fine.
- The canvas `contextmenu` is already prevented (:1709).

## 5. Risks
- FOV restore: use the per-frame :1427 hook, and make the module return zoom 1 when any of these hold: not running,
  `ctx.uiOpen()`, kind not spyglass, `aim` not down, `!document.pointerLockElement && !lockFallback`, swimming or
  diving (diving.js renders its own pass), or the module is `dead`. Then item switch, menu open, pointer-lock loss,
  tab blur (game.js:872 `clearInput` → `controls.clear()`) and module failure all restore the FOV with no extra code.
  Ease the zoom in about 0.15 s and snap it out on block.
- Sensitivity: scale by 1/zoom in `look()`. Otherwise 3x zoom feels three times too twitchy. Clamp pitch as usual.
- Camera motion: footstep bob, roll and shark shake (:1429-1435) are magnified by the zoom. Multiply the bob/roll by
  about 1/zoom (or 0.3) while zoomed. Reduced motion already uses `options.cameraMotion`.
- Vignette: one fixed `div` with a CSS `radial-gradient` (see vitals-ui.js:75 `#lrVitalsVignette` for the
  pattern), `pointer-events:none`, created lazily, with `opacity` toggled through a class. Do not rebuild DOM each
  frame. The label is one `div` whose text is written only when it changes (treasure.js:93-100 and
  progression-hooks.js:258 pattern). It must not overlap `#binocularsHud` (top 18%), `#treasureHud` (12%) or
  `#lrPrompt`.
- Viewmodel: if hp.fov is not the zoomed FOV, the hands look magnified about 3x. Use the hook, not a module-side
  `camera.fov` write.
- Fog/far: anything past 200 m is clipped no matter the zoom. Do not promise to see further. Labels can still name
  objects inside the fog (that is the fun).
- Co-op: purely local. No `action`, no `serialize`, nothing emitted. The partner sees the spyglass in hand only if the
  kind is appended to coop.js:28 `HELD` and has a coop-avatar model. A raised pose would need a new wire field, so
  skip it in v1.
- Perf: `update()` must not allocate. Use reused Vector3s, compute the camera forward once, run a plain for-loop over
  `world.items`, cache the label string and keep the `islandName` result per seed. Do no work at all when not zoomed.
- Tests: add a node test for the pure pick (cone pick, `zoomFor(kind)`, label text) and update the tools-order
  assertion (tests/survival.test.mjs:542). Expose `raftDebug.content.spyglass` (`zoom()`, `target()`) for QA.
