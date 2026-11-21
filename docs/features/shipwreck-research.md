# Sunken shipwreck dive sites: research

Every so often a small, broken ship drifts in under the raft's course, the way islands do. Its hull rests 6 to 12 m down on the seafloor, with a few crates and barrels, a captain's chest, swaying kelp and a little school of fish. Players dive down and hold E to open the containers. It is a cozy feature: no hazards, no damage, no timer pressure beyond the normal oxygen bar.

## Genre conventions (underwater POIs)
- **A cue on the surface.** Divers can't see the floor from above (our ocean is opaque from above), so wreck games mark the spot with bubbles, flotsam or circling birds. We add a ring of floating planks and a bubble column above the site, plus a chat notice.
- **A few hand-made variants, not pure noise.** A handful of seeded silhouettes means each visit reads like a landmark, and the crate placements stay sensible.
- **One hero container.** Every site has a guaranteed "captain's chest" with the rare drop, and lore often hides there too (a log page or note). Normal crates hold common materials.
- **Containers change when opened.** The lid pops open or the barrel tips, so a player can see what they have already looted without needing a UI. Each container can be opened once per site.
- **Ambient life.** Kelp, fish and caustic light make the site feel calm and alive. Cozy dive games skip predators entirely, and so do we.
- **Oxygen sets the pacing.** A site should take about two or three breaths to clear. Base oxygen is 45 s (`dist/diving.js:20`). At 2.4 m/s a 15 to 20 m trip takes about 8 s each way, which leaves about 25 s per dive at the wreck. The Breath Jug and fins stretch that out.

## Our design
- The site is a module `dist/wreck.js` (`createWreck(ctx)`), with pure rules in `dist/wreck-core.js`, tests in `tests/wreck.test.mjs` and the model in `dist/wreck-model.js`. Saved state goes in `world.ext.wreck`.
- The site sits at lateral offset `off` = 12 to 18 m on the side away from any docked island (`islandNow()`, `islands.js:41`), and at `z = dockZ` (about -4 to 4). That stays well inside the 50 m dive leash (`diving.js:22` MAX_DISTANCE) and the 9 to 20 m seafloor cap ramp (`seafloor.js:76-79`).
- **Depth.** The host samples the seafloor at a few seeded candidate spots (angle or offset jitter) and keeps the first one where the floor is between -12 and -6. If none fits, it reschedules 60 s later. The host stores `y` in state, so guests never re-derive it. The seafloor is world-fixed noise and does not scroll while sailing (`sailing-world.js:3`: the raft never moves; islands and the content modules use their own z-paths). A wreck that rests while docked is therefore consistent with the floor under it.
- **Sand bed.** The wreck brings a merged, low sand-and-debris skirt (radius about 6 m) whose vertices are dropped onto `floorAt()` once per spawn. That hides the seam between the hull and the noise floor. The hull is not solid: divers swim through it, which is cozy and saves us collision work.

## Schedule (reuse the islands clock and phase pattern)
`islands-layout.js` `pathAt` (`:118`), `nextDelay` (`:140`) and `clean` (`:163`) are the template. The wreck gets its own constants and its own `wreckPathAt`, because `pathAt` is hard-wired to `ISLAND.*`:

| const | value | note |
|---|---|---|
| FIRST | 420 s | after the first island (90 s) and the trader, so the early game isn't crowded |
| CALM_MIN/MAX | 480–720 s | seeded from `hash3(seed, 91, 7)` |
| APPROACH | 20 s | glides from z = -60 to dockZ. It is unseen past fog far (30 m, `underwater-fx.js:17`), so it needs no rise or sink animation |
| DOCK / DOCK_CAP | 240 / 600 s | extended by 30 s while any diver is within 25 m (the islands rule at `islands.js:228`) |
| DEPART | 20 s | to z = +60, then `next = clock + nextDelay` |
| WARN | 30 s | the notice "The wreck is drifting out of reach" |

The clock advances only while `ctx.running`. Guests slew their clock toward the host's, the same way the islands module does (its slew at `islands.js` update lines ~200-212). Notices are sent with `ctx.emit({kind:'notice'}, 'all')`: "Bubbles are rising nearby: something rests on the seafloor!"

## Layout generation (seeded, few variants)
`layoutFor(seed)` uses mulberry32 `rng` (`islands-layout.js:33`). It is cached and frozen, and coordinates are site-local metres:
- **variant** (`seed % 3`). `keel` is an upright split hull, 9 m long. `listing` is rolled 35°, with the hold open to one side. `bow` is a bow half plus scattered stern ribs.
- **yaw** is 0 to 2π. **dockZ** is -4 to 4. **slots** are picked from the variant's fixed slot list, with jitter of ±0.3 m and a random yaw: crates 3 to 4 and barrels 1 to 2 (out of 6 crate spots and 3 barrel spots per variant). There is always exactly one chest, at the variant's cabin or stern slot. The cap is 7 containers.
- **kelp** is 10 to 16 tufts, rejected if within 0.8 m of a container. **fish** are 6 to 8, on one orbit (radius 3 to 5 m, height 1.5 to 3 m above the bed).

## Loot (existing ids only; deterministic per (seed, slot), so re-opening can't re-roll)
| container | rolls | table (weight) |
|---|---|---|
| crate | 2 | wood 2-3 (4), scrap 2-3 (4), rope 1-2 (3), nail 2-3 (3), plastic 1-2 (2), glass 1 (1), metalingot 1 (1) |
| barrel | 1 + plastic 1 | rope 2 (3), seaweed 2 (2), clay 2 (2), copperore 1 (1), cup 1 (1) |
| chest | fixed + 1 | shell 3-5 (trader currency) plus: a **logbook note** if `nextNote(world.notes) >= 0`, otherwise glassfloat (4, existing decor) / metalingot 2 (3) / copperingot 1 (2) / shellwreath 1 (1) |

Ids are checked in `inventory-state.js:17-55`, `content-items.js:9-55` and `items.js` (nail, glass, seaweed, copperore, metalingot, copperingot). An optional new decor item would be a "Ship's Bell" (`shipbell`, CONTENT_ITEMS + CONTENT_DECOR + `decorModel`), but it is not needed for v1.

**Notes in the chest.** `ctx.world` is live on the host, so the host can copy `collectBottle` (`game.js:1032-1038`): `n = nextNote(world.notes)`, push it, then `emit({kind:'note', note:n, text:'A captain’s note! (k/12) · L to read'}, 'all')`. `world.notes` already syncs in hostState (`game.js:1581`), and `logbookUI.celebrate` fires on `kind:'note'` (`game.js:1027`). The `note1`/`notes_all` achievements are picked up by the next `award()` call. If we want them to fire immediately, we'd need a `ctx.award(ev)` getter, which is one line in contentCtx.

## Interaction (hold E underwater, progress ring like gather)
- **The blocker.** `game.js:1232` `interact()` returns while diving, so `content.interact` never runs underwater. Diving owns E through `lastInput.gather` (`game.js:1391`).
- **The fix: an extra-targets hook in diving.** `createDiving({... getTargets})` (`diving.js:162`). In `updateGather` (`diving.js:245-270`), after the `seafloor.nodesNear` loop, it calls `getTargets(p.x, p.y, p.z, REACH + 0.5, list)`, where `list` is a reused array of `{id, x, y, z, secs, label, done(id)}`. Each target is scored with the same cone and distance rule. Completing a target calls `target.done(id)` instead of `onGather`, and the label comes from `target.label` (`diving.js:307`). That reuses the ring and label (`diving-ui.js:7`), the `mods.gather` scraper bonus, the needRelease and pending logic, and highlighting. Highlighting uses `done`'s sibling `hover(id|null)`, so the module tints its instance.
- **Hold times.** The registry gets an aggregator, `diveTargets(x,y,z,r,out)` in `content.js` (next to `diveMods`, `:105`). Game.js passes `getTargets: (x,y,z,r,o) => content?.diveTargets?.(x,y,z,r,o)` at both `createDiving` calls (`game.js:477`, `:481`). A crate takes 1.2 s and the chest 1.6 s. The labels are "Hold E · Open crate", "Open barrel" and "Open captain's chest".
- **The action.** It is `ctx.action({kind:'wreck.open', seed, slot})`. It can't use `'gather'`, because `game.js:1168-1170` returns on a `nodeById` miss before `content.action`. The host `applyOpen` checks that the seed matches, the slot is in range and still closed, and the 3D distance to the actor (`ctx.physics` / `ctx.other`) is within 2.8 + 1.5 m (guest slack). It then does an atomic bag add through a scratch Bag (the `islands-layout.js:204-232` pattern), and on 'full' it emits "Your bag is full" and leaves the slot closed. On success it sets the opened bit and emits `{kind:'loot', loot}` to the actor.
- **Surface prompt.** A `prompt(aim)` from the raft is optional: when the bubble marker is in view, it can show the muted hint "Dive (C) to explore the wreck".

## Co-op
The host owns the clock, the site and `opened`. Guests receive it in `hostState` ext (about 8/s), and `load(data, 'net')` only re-tints when `opened` changes, so there are no mesh rebuilds. Both players dive locally, and diving is per-client, so both can loot at the same time. A guest that opens a crate the host already opened gets "Already empty", and its pending entry expires (`DIVE.PENDING` 1.5 s).

## Save
`world.ext.wreck = {v:1, clock, next, site:{seed, born, dock, side, off, y, opened:int bitmask (7 bits)}}`. `clean()` mirrors `islands-layout.js:163`: it clamps clock, born and dock, drops a site whose phase is 'gone' or whose seed is invalid, and masks `opened &= 127`. Old saves get `load(undefined)`, which gives the defaults (first wreck at 420 s). `serialize()` returns a cached object.

## Model budget (at most 8 draw calls, merged, no shadows)
Everything uses vertex-coloured MeshStandardMaterial (`merge-geo.js:7` `mergeGeometries`), with `castShadow = false`. The group is visible only while the camera is below the surface + 0.25 m, the same gate diving uses for the floor (`diving.js:300-303`), so the site costs zero draw calls on the surface.

| # | mesh | notes |
|---|---|---|
| 1 | hull (variant) | planks, ribs, broken mast, rudder: one merged geometry per variant, built lazily |
| 2 | bed + debris | sand skirt, scattered planks, an anchor, two rocks |
| 3 | crates closed | InstancedMesh(4); hover = `setColorAt` brighten (no highlight copy) |
| 4 | barrels closed | InstancedMesh(2) |
| 5 | opened crates | InstancedMesh(4), lid-off crate geo; a barrel "opens" by tipping (matrix change in mesh 4, no extra call) |
| 6 | captain's chest | single Mesh, body + lid merged as closed geo; on open swap to a pre-built open geo (`mesh.geometry = openGeo`, same material) |
| 7 | kelp | an InstancedMesh(16) with seafloor's sway shader. That needs `addCaustics` exported from `seafloor.js:159` (an additive export), or a copy of its 8-line sway snippet |
| 8 | fish | an InstancedMesh(8) on one orbit, matrices written per frame (no allocations) |

The surface marker (floating planks plus a bubble column) adds 1 to 2 calls, and only on the surface, while the underwater group is hidden. Underwater peak = 8. Triangles total < 6k.

## Integration points
- `dist/content.js:58`: append `createWreck` before `createCookpot`. Near `:105`, add a `diveTargets` aggregator next to `diveMods`.
- `dist/diving.js:162`: add the `getTargets` option. `:245-270`: the extra targets loop and `done`. `:307`: the per-target label.
- `dist/game.js:477`, `:481`: pass `getTargets`. `:420` contentCtx: add `floorAt:(x,z)=>diving?.seafloor?.heightAt(x,z) ?? NaN`, plus `seafloorUniforms` for shared caustic time and fade.
- `dist/seafloor.js:91` `seafloorHeight`, `:159` `addCaustics` (export), `:409` `heightAt`. `dist/underwater-fx.js:17` FOG_FAR = 30.
- `dist/islands-layout.js:33` rng, `:44` hash3, `:118` pathAt, `:146` dockOffset, `:163` clean. `dist/islands.js:41` islandNow (same `?build=` specifier as content.js).
- `dist/logbook.js` `nextNote`, `NOTE_COUNT`. `dist/game.js:1032` collectBottle pattern. `dist/wildlife.js:4,8` is the fish-school instancing pattern.
- QA `debug`: `spawnNear(seed)`, `phase()`, `skip(s)`, `teleportDiver(slot)`, `openAll()`, `slots()`.
