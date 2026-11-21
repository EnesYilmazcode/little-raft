# Feature specs

Implementable specs for builders. One line per spec.

- [notes-achievements.md](notes-achievements.md): message bottles (12 notes), 15 achievements, the L-key raft logbook (dist/logbook.js, logbook-ui.js, bottle.js)
- [receiver-navigation.md](receiver-navigation.md): receiver + up to 3 antennas detect a drifting signal cache; HUD bearing pill, edge marker, cache loot (dist/signal.js, signal-models.js)
- [purifier-watering.md](purifier-watering.md): cups (cup/saltcup/freshcup), placeable Water Purifier (15 s), watering and harvesting Palm Planters (90 s, 3 growth stages); world.garden/world.purifiers (dist/watering.js, purifier-model.js)
- [sleep.md](sleep.md): craftable Bed decor; sleep at dusk/night with fade, skip to morning via host-only daynight.skipTo; co-op needs both in bed (dist/sleep.js, sleep-model.js)
- [engine.md](engine.md): Little Motor (E toggle, leaf/wood/plastic fuel, diminishing push along the shared heading, cap 2.0 m/s) + Steering Wheel as an extra hold-R steering target; world.ext.engine, opts.push in stepSailing (dist/engine.js, engine-models.js)
- [paint.md](paint.md): Paint Brush (stack-1 item) + 5 soft paint pots (4 per craft, 1 per piece/tile) and free Driftwood scrape; click paints, right click cycles colour; instanced setColorAt tint for pieces, cached wood materials for deck tiles; world.ext.paint {v,rev,m} (dist/paint.js, brush-model.js)
- [instruments.md](instruments.md): held Tide Drum / Reed Pipes / Bell Bars (tool:false, stack 1); LMB/RT plays, camera pitch picks 1 of 8 D-pentatonic notes; audio.note() on the effects bus; transient co-op {type:'inst'} with falloff; no world state (dist/instruments.js, instrument-models.js)
- [rain-sprinkler.md](rain-sprinkler.md): Rain Barrel (fills in rain, 4 cups, E with empty cup -> freshcup) + Sprinkler (3-unit tank or adjacent barrel, auto-waters dry palms in 8 neighbours); world.collectors/world.sprinklers, daynight rain getter (dist/rain.js, rain-model.js)
- [beehive.md](beehive.md): Beehive + Flower Box + honey/wax; hive fills from flower boxes within 2 tiles, E collects honey and beeswax for a candle and honey glazed fish; flower seed from island bushes and barrels (dist/bees.js, bees-model.js)
- [fish-trap.md](fish-trap.md): Fish Trap decor on edge tiles only; woven basket catches a fish every 240 s (150 s with seaweed bait, 5 charges) via rollCatch on a seeded host RNG, max 3; E collects all-or-nothing into bag and journal; world.ext.fishtrap (dist/fish-trap.js, fish-trap-model.js)
- [power.md](power.md): Wind Turbine + Battery + String Lights + Lamp Post; turbines beside a battery charge it from daynight wind, lights within 3 tiles glow and drain it at night; world.ext.power charge only, lit derived per peer, emissive bulbs, Lamp Post shares pool lights (dist/power.js, power-model.js)
