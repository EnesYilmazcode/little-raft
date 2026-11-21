# Feature specs

Implementable specs for builders. One line per spec.

- [notes-achievements.md](notes-achievements.md): message bottles (12 notes), 15 achievements, the L-key raft logbook (dist/logbook.js, logbook-ui.js, bottle.js)
- [receiver-navigation.md](receiver-navigation.md): receiver + up to 3 antennas detect a drifting signal cache; HUD bearing pill, edge marker, cache loot (dist/signal.js, signal-models.js)
- [purifier-watering.md](purifier-watering.md): cups (cup/saltcup/freshcup), placeable Water Purifier (15 s), watering and harvesting Palm Planters (90 s, 3 growth stages); world.garden/world.purifiers (dist/watering.js, purifier-model.js)
- [kiln.md](kiln.md): Seaside Kiln (research-gated: stone+clay+scrap) smelts metal ore/sand/clay into Metal Bar/Glass Pane/Fired Brick with wood fuel; Glass Lantern, Glass Cups, Brick Planters, Line Sinker; world.ext.kiln (dist/kiln.js, kiln-core.js, kiln-model.js)
- [raft-animals.md](raft-animals.md): Puffhen v1: Nest Box (starter) lure, seeded host-clock wander (no positions sent), feed/pet/collect/rename, eggs and feathers, Egg Lantern and Feather Cushion; world.ext.animals (dist/animals.js, animals-core.js, animals-models.js, animals-ui.js)
