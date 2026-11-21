# Feature specs

Implementable specs for builders. One line per spec.

- [notes-achievements.md](notes-achievements.md): message bottles (12 notes), 15 achievements, the L-key raft logbook (dist/logbook.js, logbook-ui.js, bottle.js)
- [receiver-navigation.md](receiver-navigation.md): receiver + up to 3 antennas detect a drifting signal cache; HUD bearing pill, edge marker, cache loot (dist/signal.js, signal-models.js)
- [purifier-watering.md](purifier-watering.md): cups (cup/saltcup/freshcup), placeable Water Purifier (15 s), watering and harvesting Palm Planters (90 s, 3 growth stages); world.garden/world.purifiers (dist/watering.js, purifier-model.js)
- [sleep.md](sleep.md): craftable Bed decor; sleep at dusk/night with fade, skip to morning via host-only daynight.skipTo; co-op needs both in bed (dist/sleep.js, sleep-model.js)
- [engine.md](engine.md): Little Motor (E toggle, leaf/wood/plastic fuel, diminishing push along the shared heading, cap 2.0 m/s) + Steering Wheel as an extra hold-R steering target; world.ext.engine, opts.push in stepSailing (dist/engine.js, engine-models.js)
