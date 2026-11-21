# Content fleet: islands, wildlife, storage and research, day and night

Branch `claude/raft-content`, built on top of `main` (main is merged in). Four friendly content
features, each in its own files and plugged into the engine through one small registry.
Nothing in them hurts the player.

| Feature | Files | Design and as-built doc | Tests |
|---|---|---|---|
| Islands | `dist/islands.js`, `islands-layout.js`, `islands-models.js` | [features/islands.md](../features/islands.md) | `tests/islands.test.mjs` (31) |
| Wildlife | `dist/wildlife.js`, `wildlife-models.js` | [features/wildlife.md](../features/wildlife.md) | `tests/wildlife.test.mjs` (24) |
| Storage and research | `dist/storage-research.js`, `storage-research-ui.js`, `storage-research-model.js` | [features/storage-research.md](../features/storage-research.md) | `tests/storage-research.test.mjs` (25) |
| Day, night and weather | `dist/daynight.js` | [features/daynight.md](../features/daynight.md) | `tests/daynight.test.mjs` (21) |
| Registry | `dist/content.js`, `dist/content-items.js` | [features/content-hooks.md](../features/content-hooks.md) | `tests/content.test.mjs` (3) |

On the merged branch, `npm test` passes all 539 tests across every fleet's test files.

## What was built

- **Islands.** About every 3 to 4 minutes a small island drifts in. The first one comes 90 s after a new world starts. It docks 10 to 14 m from the raft for about 3 minutes, and it waits while someone is still on it, up to 10 minutes. Then it drifts away, with a friendly heads-up before it goes.
  - Each island's layout comes from its seed: a sand dome, a turquoise lagoon ring that rides the ocean's waves, and curved palms, berry bushes, rocks and sand mounds. All of these are instanced.
  - Press E on a node to gather: a palm gives wood and leaves, plus a seed on its 3rd use. A bush gives leaves and maybe a seed. A rock gives stone and a sand mound gives sand.
  - Spent nodes look spent: palms turn straw-yellow, droop and lose their coconuts, and rocks shrink and darken.
  - You can walk on the sand, and there is hysteresis at the shoreline so the player does not flip between walking and swimming. The island never carries you away when it leaves.
  - Gathering is checked on the host (seed, node, reach, cooldown) and the loot is added all-or-nothing.
  - 6 to 8 draw calls while an island is visible, 0 while none is.
- **Wildlife.** Everything here is scenery. All of it follows from one clock, shared host to guest as a single number `{t}` that the guest eases toward.
  - 3 to 6 gulls glide, bank and flap. They land on free tiles or on decor tops with their wings tucked and hop around. They take off if either player comes within 3 m, and they never perch next to a player.
  - Two schools of fish silhouettes swim just under the surface.
  - A dolphin, or now and then a sea turtle, makes laps 9 to 14 m out. The dolphin leaps and porpoises so it never reads as a shark.
  - Rafts of any size push the animals' paths outward so they never cross the deck.
  - +3 draw calls, +4 while the dolphin or turtle is on screen.
- **Storage and research.**
  - A placed Crate is now a 12-slot chest. Click to move a stack, Shift+click to move half, and "Put all" leaves the hotbar alone.
  - The **Tinker’s Desk** (item `research`, 6 wood + 2 scrap, with a desk model full of little details) teaches recipes. You study one of each ingredient kind, and a recipe is learned once all its ingredients are studied.
  - Locked recipes show under a heading in the craft list, with a lock badge and a "Study X" hint.
  - Old saves with progress keep every recipe. Only brand-new worlds start with the locked tree.
  - Every action is host-authoritative and atomic, items are conserved, and a guest aboard an older host gets a friendly notice.
  - On `main`, the table was renamed from "Research Table" so it does not clash with the progression system's own Research Table. The `setOwnedElsewhere()` hook makes the desk only gate recipes that the progression catalogue does not own.
- **Day, night and weather.**
  - A 20-minute day: peach sunrise, sage day, coral dusk and a cosy, readable blue night.
  - One horizon colour drives the background, the fog and the ocean's sky uniform, so the horizon has no seam.
  - Weather is calm, breezy or rain, and comes from a seeded schedule so co-op only needs `{clock, seed}`. Rain is one shader-animated `LineSegments`.
  - Stars and a moon come out at night.
  - Lanterns glow amber at night. A small pool of point lights (1, 2 or 4 by graphics setting) is added only once the first lantern exists and follows the nearest lanterns. The light count never changes by time of day, so shaders are not recompiled.
  - `?daynight=off` gives a true no-op.
  - +0 draw calls by day, +2 at night, +1 in rain.

All four keep their geometry and materials cached. The repeated things use InstancedMesh. None of them allocate per frame in `update`, and every one of them restores shared engine state in `dispose()`.

## Hooks into game.js

Every hook is a single line marked `// content hook`. Run `grep -n "content hook" dist/game.js` to list them.

| Where in `dist/game.js` | Line | Purpose |
|---|---|---|
| imports | `createContent, cleanExt` from `content.js`; `CONTENT_DECOR, CONTENT_BLOCK_RADIUS` from `content-items.js` | registry and the placeable desk |
| `DECOR_TYPES`, `BLOCK_RADIUS` | `...CONTENT_DECOR`, `...CONTENT_BLOCK_RADIUS` | the desk is placeable decor and blocks walking |
| `cleanWorld` / `copyWorld` | `ext: cleanExt(v.ext)` | keeps `world.ext.<feature>` through validation (save, transfer, network) |
| engine state | `hemi`, `clouds`, `content` variables | lights and clouds handed to day/night |
| `contentCtx` | live getters (scene, camera, raft, ocean, sun, hemi, clouds, world, role, physics, bags, `action`, `emit`, `notice` and more) | the engine view modules get |
| `init()` | `content = createContent(contentCtx); content.load(world.ext, 'save')` | start the modules |
| `rebuildRaft()` | `content.decorModel(type)` fallback | desk model |
| `applyAction()` craft | `content.craftLocked(recipe, actor)` | research gating |
| `applyAction()` tail | `content.action(a, actor, bag)` | host-authoritative `islands.gather` and `storage.*` |
| `interact()` | `content.interact(aim)` | E on a chest, the desk or an island node |
| `updateContext()` | `content.prompt(aim)` | context prompt |
| `movePlayer()` | `content.afterMove(physics, dt)` | stand on island sand |
| `frame()` | `content.update(dt)` | animation |
| `syncWorldInventories()` | `world.ext = content.serialize()` | save |
| `hostState()` | `ext: content.serialize()` | co-op, host to guest |
| guest `state` handler / `restoreOwnRaft()` | `content.load(ext, 'net' / 'restore')` | apply host state, or the guest's own raft after a visit |
| `raftDebug` | `get content()` | per-module QA helpers (`raftDebug.content.islands.spawnNear()` and so on) |
| `disposeScene()` | `content.dispose()` | cleanup |

Other shared-file lines, each marked `// content hook`:
- `dist/inventory-state.js` spreads `CONTENT_ITEMS` and `CONTENT_RECIPES` (sand, stone, seed, research).
- `dist/survival-ui.js` exports its icon and slot painters for the storage panels and adds `research` to `SPRITES`.
- `dist/icons.svg` gains `icon-research`.
- The `main` integrator added one `[progression-hook]` line (`setOwnedElsewhere`).

**Saves.** Feature data lives in `world.ext.<name>`. An old save has no `ext`, so every module starts from its defaults; old progressed worlds keep all their recipes. Older builds drop `ext` without error. If a module throws, the registry disables it and calls its `dispose()` once, which restores fog, lights and materials.

**Co-op.** The host sends `ext` in every state message, about 8 per second. Each module's `serialize()` is cheap. Each `load(data, 'net')` is idempotent and eases clocks instead of snapping them: islands at 4/s, wildlife at 0.5 s/s, day/night at no more than ±10 % speed. Guests change state only through `ctx.action()`, and the host validates every field.

## How it was made

A fleet of 22 subagents worked in parallel git worktrees, one branch per feature (`claude/raft-content-<name>`):
- **Designers (4).** They rewrote the earlier fleet's design docs for the hook API. raft.wiki.gg cannot be reached from the sandbox (401 or DNS block), so the Raft facts come from search snippets, fandom and Steam threads, and each doc cites them.
- **Builders (4).** Each implemented one feature, with tests and screenshots.
- **Reviewers (4).** Fresh agents reviewed each diff without seeing the builder's conclusions.
- **Visual QA (5).** Four took feature screenshots, read them and critiqued them; one did the merged build.
- **Integration fixer (1).** It fixed the issues the merged QA found.
- **Fixers (4, two rounds each).** They fixed every verified review finding, then the QA findings, with regression tests that fail on the old code.

Review rounds caught, among other things:
- shoreline walk/swim flip-flop with splash beeps (islands)
- being carried 50 m out on a departing island (islands)
- co-op scares and perches that disagreed between players (wildlife)
- a dolphin that read as a shark (wildlife)
- lanterns dimming on every rebuild at night (day/night)
- a 110° shadow jump at sunset (day/night)
- point lights costing fragment time all day (day/night)
- a UI load retrying every frame (storage)
- a rope dead-end in the research tree (storage)

## Screenshots

All are in `docs/cloud/shots/content/` (the repo ignores `*.png` except under `docs/cloud/shots/`).

| | |
|---|---|
| Islands | `islands-approach.png`, `islands-gather-prompt.png`, `islands-after-gather.png` |
| Wildlife | `wildlife-gull.png`, `wildlife-fish.png`, `wildlife-dolphin.png`, `wildlife-turtle.png` |
| Storage and research | `storage-world.png`, `storage-chest.png`, `storage-research.png`, `storage-research-800x600.png`, `storage-recipes-locked.png` |
| Day and night | `daynight-morning.png`, `daynight-dusk.png`, `daynight-night.png`, `daynight-rain.png` |
| Merged build | `merged-spawn.png`, `merged-island.png` (island, dolphin, gull, lantern), `merged-island-dusk.png`, `merged-night.png`, `merged-desk.png`, `merged-rain.png`, `merged-prompt-island.png`, `merged-prompt-crate.png` |

## Merging with main

While this fleet worked, an integrator merged earlier snapshots of the content branches into
`main`. `claude/raft-content` merges `main` back in (commit "Merge main into raft-content"). That merge resolved these conflicts:
- **The table's name.** `main` renamed the desk "Tinker’s Desk" to keep it apart from its own progression Research Table. We kept that name, with the new `icon-research`.
- **`icons.svg` and the `SPRITES` list.** Both sides added symbols, so we kept both sets.
- **The sun target offset in `daynight.js`.** We kept main's shadow-fitted target and our `MOON_I`.
- **Tests on both sides.** We kept both sets of tests.

The final merged QA, run in one session with all four features and main's progression, found two integration bugs. Both are fixed:
- **Content "E" prompts never showed.** `main` hides `#contextPrompt` and replaced it with `#lrPrompt`. `content.js` now exports `promptParts()`, and `game.js` registers one `raftPrompts.provide({id:'content'})`, so crates, the desk and island nodes show "E Gather palm…" in main's style. Main's Research Table prompt had the same bug and is fixed the same way in `progression-hooks.js`.
- **E opened main's Research Table by distance alone.** That happened even when you were looking at the sky or a crate. Station E is now aim-aware (`aimMiss()`, 0.8 m).

Draw calls in the merged build (software GL, medium): 149 at spawn and by day, 150 in rain, 134 at night on a furnished deck, 117 to 175 near an island. There were no page errors.

## Needs a decision

**Two research stations.** Our Tinker’s Desk and main's progression Research Table now sit side by side. They look alike and follow different rules:
- **When you get it.** The desk is craftable from the start. The Research Table is a minute-20 goal.
- **What studying costs.** The desk uses up one item per study. The Research Table keeps the item.
- **Which recipes.** With `setOwnedElsewhere`, the desk gates only recipes outside main's catalogue.

A player chasing the "Build the Research Table" goal may build the desk instead. There are three options:
1. Retire the desk's gating in favour of main's table, keeping the crate chests.
2. Have main's Research Table open the desk's study panel.
3. Keep both, but make them agree on consuming items and clearly separate their names and looks.

This fleet did not choose, because it is a product call.

## Known issues

- The ocean shader is opaque, so fish are silhouettes at the surface and there is no visible seafloor under islands. The lagoon ring stands in for shallow water.
- The sky is one flat colour (dist/sky.js is unused), so dusk is an even wash rather than a gradient.
- Sand, stone and seed use placeholder icons.
- Main's 12 plain green horizon islands sit behind the detailed drifting island and look different from it.
- Main still posts a distance-based "E: use the …" feed line when you walk up to a station. It is harmless, but it repeats the new prompt.
- A green decorative horizon hill can sit behind a docked island.
- Co-op was verified with unit tests (two-module host/guest simulations with jitter, drops and duplicates). The sandbox has no PeerJS signalling, so no live two-browser session was run.
