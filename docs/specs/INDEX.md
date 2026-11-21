# Feature specs

Implementable specs for builders. One line per spec.

- [notes-achievements.md](notes-achievements.md): message bottles (12 notes), 15 achievements, the L-key raft logbook (dist/logbook.js, logbook-ui.js, bottle.js)
- [receiver-navigation.md](receiver-navigation.md): receiver + up to 3 antennas detect a drifting signal cache; HUD bearing pill, edge marker, cache loot (dist/signal.js, signal-models.js)
- [purifier-watering.md](purifier-watering.md): cups (cup/saltcup/freshcup), placeable Water Purifier (15 s), watering and harvesting Palm Planters (90 s, 3 growth stages); world.garden/world.purifiers (dist/watering.js, purifier-model.js)
- [sleep.md](sleep.md): craftable Bed decor; sleep at dusk/night with fade, skip to morning via host-only daynight.skipTo; co-op needs both in bed (dist/sleep.js, sleep-model.js)
- [engine.md](engine.md): Little Motor (E toggle, leaf/wood/plastic fuel, diminishing push along the shared heading, cap 2.0 m/s) + Steering Wheel as an extra hold-R steering target; world.ext.engine, opts.push in stepSailing (dist/engine.js, engine-models.js)
- [paint.md](paint.md): Paint Brush (stack-1 item) + 5 soft paint pots (4 per craft, 1 per piece/tile) and free Driftwood scrape; click paints, right click cycles colour; instanced setColorAt tint for pieces, cached wood materials for deck tiles; world.ext.paint {v,rev,m} (dist/paint.js, brush-model.js)
- [customise.md](customise.md): "Look" dialog (pause menu + welcome card) for shirt/trousers/skin/hair swatches and 5 hats unlocked by logbook achievements; localStorage little-raft-look-v1, co-op hello look + k:'look' event, remote rebake, hands.setLook (dist/look.js, look-ui.js)
