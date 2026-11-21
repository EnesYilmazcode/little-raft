# Content hooks

All four content features (islands, wildlife, storage/research, day/night) plug into the engine
through one registry, `dist/content.js`. The engine creates it once in `init()` and calls it from
lines in `dist/game.js` marked `// content hook`. There are 31 of these lines, and `grep -n "content hook" dist/game.js` lists them.

| Hook in game.js | Calls | Purpose |
|---|---|---|
| imports | `createContent`, `cleanExt`, `CONTENT_DECOR`, `CONTENT_BLOCK_RADIUS` | registry and new decor types |
| `DECOR_TYPES`, `BLOCK_RADIUS` | `...CONTENT_DECOR`, `...CONTENT_BLOCK_RADIUS` | the research table is placeable and blocks walking |
| `cleanWorld` / `copyWorld` | `ext: cleanExt(v.ext)` | keeps `world.ext` (feature saves) through validation |
| `contentCtx` | getters for scene, camera, lights, clouds, world, bags, action/emit | the engine view given to modules |
| `init()` | `createContent(ctx)`, `content.load(world.ext, 'save')` | start modules and restore their state |
| `rebuildRaft()` | `content.decorModel(type)` | models for content decor |
| `applyAction()` craft | `content.craftLocked(recipe, actor)` | research gating |
| `applyAction()` tail | `content.action(a, actor, bag)` | host-authoritative module actions (guests send them with `action()`) |
| `interact()` | `content.interact(aim)` | E on a chest, table or island node |
| `updateContext()` | `content.prompt(aim)` | context prompt text |
| `movePlayer()` | `content.afterMove(physics, dt)` | stand on island sand |
| `frame()` | `content.update(dt)` | per-frame animation |
| `syncWorldInventories()` | `world.ext = content.serialize()` | save |
| `hostState()` | `ext: content.serialize()` | co-op sync, host to guest |
| guest `state` handler, `restoreOwnRaft()` | `content.load(ext, 'net' / 'restore')` | apply host state, or the guest's own raft after a visit |
| `disposeScene()` | `content.dispose()` | cleanup |
| `raftDebug.content` | each module's `debug` object | QA helpers for tests and screenshots |
| `useSelected()` | `content.use(aim, kind)` | left click with an item no engine tool handles (paint brush) |
| canvas `pointerdown` | `content.alt(aim, heldKind())` | right click while holding an item (brush colour) |
| `rebuildRaft()` | `content.afterRebuild()` | after deck/decor meshes are recreated (re-tint painted planks) |
| `contentCtx` | `building`, `brush`, `woodMat(hex)`, `aim()` | piece grid + tint hooks, held brush model, cached tinted wood, this frame's aim |
| `updateCamera()` (`// [spyglass]`) | `viewZoom = content.zoom()` | view zoom (spyglass/binoculars, first module wins, 1..8, default 1): FOV is `options.fov / viewZoom`, bob/roll/sway and bite shake scale by `1 / viewZoom`, the viewmodel hides while `viewZoom > 1.6` |
| `look()` (`// [spyglass]`) | `k /= viewZoom` | look speed follows the zoom on every path (controls lane, legacy mouse, drag-look, pad) |

Item kinds `sand`, `stone`, `seed`, `research` and the `research` recipe live in
`dist/content-items.js`. `inventory-state.js` spreads them into `ITEM_INFO` and `RECIPES` in two
lines marked `// content hook`.

**Spyglass zoom.** `zoom()` is the only spyglass hook: `dist/spyglass.js` returns its eased zoom while a
Spyglass or the Binoculars is held and Aim (RMB / pad LT) is down, and 1 the same frame a menu opens, the item
changes, the player swims or dives, or the tab is hidden. Nothing is saved or sent. `let viewZoom = 1` sits beside
`lockFallback`; `grep -n "\[spyglass\]" dist/game.js` lists the hook lines (five hooks, eight lines). `globalThis.raftSpyglass.zoomed` is
true while the lens is up (progression-hooks.js hides `#binocularsHud` then). Screenshots: `docs/cloud/shots/spyglass/`.

**Backward compatibility.** An old save has no `ext`, so every module gets `load(undefined)` and
uses its defaults. Older builds drop `ext`, because their `cleanWorld` ignores unknown keys.

**Co-op.** The host sends `ext` in every state message, about 8 per second, so `serialize()` must be cheap
and `load(data, 'net')` must not rebuild meshes unless the data changed.

**Prompts on screen.** Main hides `#contextPrompt` (prompts.css) and draws `#lrPrompt` from
`window.raftPrompts` providers. `updateContext()` clears `contextHtml` each frame and registers one
provider (`id:'content'`, priority 1) that converts the module HTML with `promptParts()` from
`content.js`: `<kbd>E</kbd>Open crate` becomes `{key:'E', label:'Open crate'}`; text without a
`<kbd>` shows as a muted hint. Modules keep returning HTML from `prompt(aim)`.

**Stations and E.** `progression-hooks.js` gets `ctx.aim` (game.js `frameAim`). Its E check
(`stationNear(aim, true)`) now also needs the aim ray within 0.8 m of the station centre
(`aimMiss()`), so E at the sky or at an out-of-reach crate opens the inventory instead of the
Research Table. The same check drives a `station` provider ("E Use the Research Table").
Screenshots: `docs/cloud/shots/content/merged-prompt-island.png`, `merged-prompt-crate.png`.
