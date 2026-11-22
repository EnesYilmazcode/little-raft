# Held items audit

Which first-person held mesh each inventory item id shows: `buildItemModel` in `dist/held-items.js` (via `createHands` in `dist/hands.js`, factory = `models.js getModel`), before and after the held-items lane. Generated from the model builders themselves (geometry fingerprints).

- Item ids: 148
- Before: 103 ids fell back to the same generic cloth bundle; the metal hook also showed the plastic hook in game (it is played as a hook). Distinct held meshes: 46.
- After: 148 distinct held meshes for 148 ids; no id uses the bundle. `tests/held-items-distinct.test.mjs` fails if two ids share one.

Hand: R = right fist grip, L = small copy on the left fist while the right hand points (placeables).

| id | icon | hand | before | after |
|---|---|---|---|---|
| `wood` | icon-wood | R | debris.js plank | debris.js plank |
| `leaf` | icon-leaf | R | debris.js leaf | debris.js leaf |
| `plastic` | icon-scrap | R | plastic.js jug | plastic.js jug |
| `scrap` | icon-scrap | R | debris.js scrap | debris.js scrap |
| `rope` | icon-net | R | own rope coil | own rope coil |
| `fish` | icon-fish | R | own fish | own fish |
| `hook` | icon-hook | R | hook.js plastic hook | hook.js plastic hook |
| `hammer` | icon-hammer | R | hammer.js | hammer.js |
| `fishingrod` | icon-hook | R | fishing-tool.js rod | fishing-tool.js rod |
| `sail` | icon-sail | L point | models.js sail (world prop) | models.js sail (world prop) |
| `palm` | icon-palm | L point | models.js palm (world prop) | models.js palm (world prop) |
| `lantern` | icon-lantern | L point | models.js lantern (world prop) | models.js lantern (world prop) |
| `net` | icon-net | L point | models.js net (world prop) | models.js net (world prop) |
| `bench` | icon-repair | L point | models.js bench (world prop) | models.js bench (world prop) |
| `crate` | icon-barrel | L point | models.js crate (world prop) | models.js crate (world prop) |
| `sand` | icon-sand | R | generic cloth bundle (SHARED) | icon-models.js sand |
| `stone` | icon-stone | R | generic cloth bundle (SHARED) | icon-models.js stone |
| `seed` | icon-leaf | L | models.js seed (world prop) | models.js seed (world prop) |
| `rug` | icon-leaf | L point | generic cloth bundle (SHARED) | decor-pack-models.js rug (world model) |
| `pennant` | icon-sail | L point | generic cloth bundle (SHARED) | decor-pack-models.js pennant (world model) |
| `fern` | icon-palm | L point | generic cloth bundle (SHARED) | decor-pack-models.js fern post (world model) |
| `chime` | icon-lantern | L point | generic cloth bundle (SHARED) | decor-pack-models.js chime (world model) |
| `hammock` | icon-net | L point | generic cloth bundle (SHARED) | decor-pack-models.js hammock (world model) |
| `pots` | icon-palm | L point | generic cloth bundle (SHARED) | decor-pack-models.js pot trio (world model) |
| `sign` | icon-repair | L point | generic cloth bundle (SHARED) | decor-pack-models.js signboard (world model) |
| `kiln` | icon-kiln | L point | generic cloth bundle (SHARED) | kiln-model.js kiln (world model) |
| `glasslamp` | icon-lantern | L point | generic cloth bundle (SHARED) | kiln-model.js glass lantern (world model) |
| `sinker` | icon-ingot | R | generic cloth bundle (SHARED) | new: lead sinker + ring |
| `stormshard` | icon-stormshard | R | generic cloth bundle (SHARED) | new: storm shard cluster on base |
| `stormrod` | icon-stormrod | L point | generic cloth bundle (SHARED) | storm-model.js lightning rod (world model) |
| `stormlamp` | icon-stormlamp | L point | generic cloth bundle (SHARED) | storm-model.js storm lantern (world model) |
| `stormglass` | icon-stormglass | L point | generic cloth bundle (SHARED) | storm-model.js storm glass (world model) |
| `puffegg` | icon-egg | R | generic cloth bundle (SHARED) | new: speckled egg |
| `feather` | icon-feather | R | generic cloth bundle (SHARED) | new: cream feather, orange barbs |
| `nestbox` | icon-nest | L point | generic cloth bundle (SHARED) | animals-models.js nest box (world model) |
| `cushion` | icon-cushion | L point | generic cloth bundle (SHARED) | animals-models.js cushion (world model) |
| `goatpen` | icon-hay | L point | generic cloth bundle (SHARED) | animals-models.js hay corner (world model) |
| `bucket` | icon-pail | R | generic cloth bundle (SHARED) | new: wooden pail, hoops, rope bail |
| `milk` | icon-milk | R | generic cloth bundle (SHARED) | new: pail filled with milk + drip |
| `research` | icon-research | L point | generic cloth bundle (SHARED) | storage-research-model.js desk (world model) |
| `motor` | icon-motor | L point | generic cloth bundle (SHARED) | engine-models.js motor (world model) |
| `wheel` | icon-wheel | L point | generic cloth bundle (SHARED) | engine-models.js wheel (world model) |
| `bed` | icon-bed | L point | generic cloth bundle (SHARED) | sleep-model.js bed (world model) |
| `brush` | icon-brush | R | brush-model.js | brush-model.js |
| `paint_seafoam` | icon-paint-seafoam | R | generic cloth bundle (SHARED) | new: seafoam paint pot |
| `paint_coral` | icon-paint-coral | R | generic cloth bundle (SHARED) | new: coral paint pot |
| `paint_sunshell` | icon-paint-sunshell | R | generic cloth bundle (SHARED) | new: sunshell paint pot |
| `paint_lagoon` | icon-paint-lagoon | R | generic cloth bundle (SHARED) | new: lagoon paint pot |
| `paint_pebble` | icon-paint-pebble | R | generic cloth bundle (SHARED) | new: pebble paint pot |
| `fins` | icon-fins | R | generic cloth bundle (SHARED) | new: two teal fins |
| `airjug` | icon-airjug | R | generic cloth bundle (SHARED) | new: cream jug, cork, rope handle |
| `goggles` | icon-goggles | R | generic cloth bundle (SHARED) | new: teal goggles, strap |
| `scraper` | icon-scraper | R | generic cloth bundle (SHARED) | new: metal scraper, wood handle |
| `shell` | icon-shell | R | generic cloth bundle (SHARED) | new: scallop shell |
| `shellwreath` | icon-wreath | L point | generic cloth bundle (SHARED) | trader-model.js wreath (world model) |
| `glassfloat` | icon-float | L point | generic cloth bundle (SHARED) | trader-model.js glass float (world model) |
| `cookpot` | icon-cookpot | L point | generic cloth bundle (SHARED) | cookpot-model.js pot (world model) |
| `bowl` | icon-bowl | R | generic cloth bundle (SHARED) | new: driftwood bowl |
| `courseflag` | icon-buoyflag | L point | generic cloth bundle (SHARED) | buoycourse-model.js start flag (world model) |
| `scoreboard` | icon-scoreboard | L point | generic cloth bundle (SHARED) | buoycourse-model.js scoreboard (world model) |
| `gametable` | icon-gametable | L point | generic cloth bundle (SHARED) | gametable-model.js table (world model) |
| `meal_chowder` | icon-meal | R | generic cloth bundle (SHARED) | new: bowl of cream chowder |
| `meal_omelette` | icon-meal | R | generic cloth bundle (SHARED) | new: bowl of omelette |
| `meal_broth` | icon-meal | R | generic cloth bundle (SHARED) | new: bowl of kelp broth |
| `meal_fishbowl` | icon-meal | R | generic cloth bundle (SHARED) | new: bowl of smoky fish |
| `meal_custard` | icon-meal | R | generic cloth bundle (SHARED) | new: bowl of custard |
| `meal_stew` | icon-meal | R | generic cloth bundle (SHARED) | new: bowl of stew |
| `driftboard` | icon-driftboard | L | generic cloth bundle (SHARED) | new: board with teal stripes |
| `flagpole` | icon-flag | L point | generic cloth bundle (SHARED) | flags-model.js pole + icon-coloured flag (world model) |
| `clay` | icon-clay | R | generic cloth bundle (SHARED) | icon-models.js clay |
| `metalore` | icon-metalore | R | generic cloth bundle (SHARED) | icon-models.js metalore |
| `sharkmeat` | icon-sharkmeat | R | generic cloth bundle (SHARED) | new: raw steak, grey skin |
| `sharkhead` | icon-sharkhead | R | generic cloth bundle (SHARED) | new: shark head, teeth |
| `receiver` | icon-receiver | L point | generic cloth bundle (SHARED) | signal-models.js receiver (world model) |
| `antenna` | icon-antenna | L point | generic cloth bundle (SHARED) | signal-models.js antenna (world model) |
| `cup` | icon-cup | R | models.js cup (world prop) | models.js cup (world prop) |
| `saltcup` | icon-saltcup | R | generic cloth bundle (SHARED) | icon-models.js saltcup |
| `freshcup` | icon-freshcup | R | generic cloth bundle (SHARED) | icon-models.js freshcup |
| `purifier` | icon-purifier | L point | generic cloth bundle (SHARED) | purifier-model.js (world model) |
| `rainbarrel` | icon-rainbarrel | L point | generic cloth bundle (SHARED) | rain-model.js barrel (world model) |
| `sprinkler` | icon-sprinkler | L point | generic cloth bundle (SHARED) | rain-model.js sprinkler (world model) |
| `water` | icon-freshcup | R | models.js water (world prop) | models.js water (world prop) |
| `oldboot` | icon-oldboot | R | models.js oldboot (world prop) | models.js oldboot (world prop) |
| `tincan` | icon-tincan | R | models.js tincan (world prop) | models.js tincan (world prop) |
| `seajar` | icon-seajar | R | models.js seajar (world prop) | models.js seajar (world prop) |
| `copperore` | icon-copperore | R | generic cloth bundle (SHARED) | icon-models.js copperore |
| `seaweed` | icon-seaweed | R | generic cloth bundle (SHARED) | icon-models.js seaweed |
| `flowerseed` | icon-flowerseed | R | generic cloth bundle (SHARED) | icon-models.js flowerseed |
| `honey` | icon-honey | R | generic cloth bundle (SHARED) | icon-models.js honey |
| `wax` | icon-wax | R | generic cloth bundle (SHARED) | icon-models.js wax |
| `berries` | icon-berries | R | generic cloth bundle (SHARED) | new: red berry cluster + leaf |
| `beet` | icon-beet | R | models.js beet (world prop) | models.js beet (world prop) |
| `potato` | icon-potato | R | models.js potato (world prop) | models.js potato (world prop) |
| `nail` | icon-nail | R | models.js nail (world prop) | models.js nail (world prop) |
| `brick` | icon-brick | R | generic cloth bundle (SHARED) | icon-models.js brick |
| `metalingot` | icon-metalingot | R | generic cloth bundle (SHARED) | icon-models.js metalingot |
| `copperingot` | icon-copperingot | R | generic cloth bundle (SHARED) | icon-models.js copperingot |
| `glass` | icon-glass | R | generic cloth bundle (SHARED) | icon-models.js glass |
| `bolt` | icon-bolt | R | generic cloth bundle (SHARED) | icon-models.js bolt |
| `hinge` | icon-hinge | R | generic cloth bundle (SHARED) | icon-models.js hinge |
| `metalhook` | icon-hook | R | generic cloth bundle (SHARED) | icon-models.js metal grapple (was the plastic hook in game) |
| `spear` | icon-spear | R | spear-model.js (wood) | spear-model.js (wood) |
| `metalspear` | icon-metalspear | R | spear-model.js (metal) | spear-model.js (metal) |
| `paddle` | icon-paddle | R | paddle-model.js | paddle-model.js |
| `axe` | icon-axe | R | axe-model.js | axe-model.js |
| `binoculars` | icon-binoculars | R | generic cloth bundle (SHARED) | icon-models.js binoculars |
| `spyglass` | icon-spyglass | R | spyglass-model.js | spyglass-model.js |
| `drum` | icon-drum | R | instrument-models.js drum | instrument-models.js drum |
| `pipes` | icon-pipes | R | instrument-models.js pipes | instrument-models.js pipes |
| `bells` | icon-bells | R | instrument-models.js bells | instrument-models.js bells |
| `finder` | icon-finder | R | treasure-models.js finder | treasure-models.js finder |
| `spade` | icon-spade | R | treasure-models.js spade | treasure-models.js spade |
| `camera` | icon-camera | R | camera-models.js camera | camera-models.js camera |
| `glidehandle` | icon-glidehandle | R | zipline-model.js handle | zipline-model.js handle |
| `coconut` | icon-coconut | R | models.js coconut (world prop) | models.js coconut (world prop) |
| `cookedfish` | icon-cookedfish | R | generic cloth bundle (SHARED) | icon-models.js cookedfish |
| `cookedbeet` | icon-cookedbeet | R | generic cloth bundle (SHARED) | new: seared beet |
| `cookedpotato` | icon-cookedpotato | R | generic cloth bundle (SHARED) | new: baked potato + butter |
| `honeyfish` | icon-honeyfish | R | generic cloth bundle (SHARED) | icon-models.js honeyfish |
| `berrycup` | icon-berrycup | R | generic cloth bundle (SHARED) | new: berry juice glass + pink straw |
| `coconutcup` | icon-coconutcup | R | generic cloth bundle (SHARED) | new: coconut milk glass + teal straw |
| `mixcup` | icon-mixcup | R | generic cloth bundle (SHARED) | new: mixed juice glass + amber straw |
| `cookedsharkmeat` | icon-cookedsharkmeat | R | generic cloth bundle (SHARED) | new: seared steak, grill marks |
| `cropplot` | icon-cropplot | L point | generic cloth bundle (SHARED) | crops-model.js plot (world model) |
| `flowerbox` | icon-flowerbox | L point | bees-model.js flower box | bees-model.js flower box |
| `beehive` | icon-beehive | L point | bees-model.js hive | bees-model.js hive |
| `candle` | icon-candle | L point | bees-model.js candle | bees-model.js candle |
| `perch` | icon-perch | L point | generic cloth bundle (SHARED) | gull-models.js perch (world model) |
| `juicer` | icon-juicer | L point | generic cloth bundle (SHARED) | juicer-model.js (world model) |
| `turbine` | icon-turbine | L point | generic cloth bundle (SHARED) | power-model.js turbine (world model) |
| `battery` | icon-battery | L point | generic cloth bundle (SHARED) | power-model.js battery (world model) |
| `stringlights` | icon-stringlights | L point | generic cloth bundle (SHARED) | power-model.js string lights (world model) |
| `lamppost` | icon-lamppost | L point | generic cloth bundle (SHARED) | power-model.js lamp post (world model) |
| `fishtrap` | icon-fishtrap | L point | generic cloth bundle (SHARED) | fish-trap-model.js (world model) |
| `shelf` | icon-shelf | L point | generic cloth bundle (SHARED) | display-model.js shelf (world model) |
| `trophystand` | icon-trophystand | L point | generic cloth bundle (SHARED) | display-model.js trophy stand (world model) |
| `taskboard` | icon-taskboard | L point | generic cloth bundle (SHARED) | tasks-model.js board (world model) |
| `photoframe` | icon-photoframe | L point | generic cloth bundle (SHARED) | camera-models.js frame (world model) |
| `skyrocket` | icon-skyrocket | L point | fireworks-model.js rocket | fireworks-model.js rocket |
| `scarecrow` | icon-scarecrow | L point | scarecrow-model.js | scarecrow-model.js |
| `maptable` | icon-maptable | L point | generic cloth bundle (SHARED) | maptable-model.js (world model) |
| `glidepost` | icon-glidepost | L point | zipline-model.js post (3.4 m) | zipline-model.js post (3.4 m) |
| `glidestep` | icon-glidestep | L point | zipline-model.js post (2.4 m) | zipline-model.js post (2.4 m) |
| `armor` | icon-armor | R | generic cloth bundle (SHARED) | new: breastplate, straps, belt |
| `researchtable` | icon-researchtable | L point | generic cloth bundle (SHARED) | smelter-model.js research table (world model) |
| `grill` | icon-grill | L point | generic cloth bundle (SHARED) | smelter-model.js grill (world model) |
| `smelter` | icon-smelter | L point | generic cloth bundle (SHARED) | smelter-model.js smelter (world model) |
| `recycler` | icon-recycler | L point | generic cloth bundle (SHARED) | recycler-model.js (world model) |

Shared fallbacks before: one generic bundle (`buildBundle`) for: `sand`, `stone`, `rug`, `pennant`, `fern`, `chime`, `hammock`, `pots`, `sign`, `kiln`, `glasslamp`, `sinker`, `stormshard`, `stormrod`, `stormlamp`, `stormglass`, `puffegg`, `feather`, `nestbox`, `cushion`, `goatpen`, `bucket`, `milk`, `research`, `motor`, `wheel`, `bed`, `paint_seafoam`, `paint_coral`, `paint_sunshell`, `paint_lagoon`, `paint_pebble`, `fins`, `airjug`, `goggles`, `scraper`, `shell`, `shellwreath`, `glassfloat`, `cookpot`, `bowl`, `courseflag`, `scoreboard`, `gametable`, `meal_chowder`, `meal_omelette`, `meal_broth`, `meal_fishbowl`, `meal_custard`, `meal_stew`, `driftboard`, `flagpole`, `clay`, `metalore`, `sharkmeat`, `sharkhead`, `receiver`, `antenna`, `saltcup`, `freshcup`, `purifier`, `rainbarrel`, `sprinkler`, `copperore`, `seaweed`, `flowerseed`, `honey`, `wax`, `berries`, `brick`, `metalingot`, `copperingot`, `glass`, `bolt`, `hinge`, `metalhook`, `binoculars`, `cookedfish`, `cookedbeet`, `cookedpotato`, `honeyfish`, `berrycup`, `coconutcup`, `mixcup`, `cookedsharkmeat`, `cropplot`, `perch`, `juicer`, `turbine`, `battery`, `stringlights`, `lamppost`, `fishtrap`, `shelf`, `trophystand`, `taskboard`, `photoframe`, `maptable`, `armor`, `researchtable`, `grill`, `smelter`, `recycler`.

## Notes

- Placeables that used to sit in the right fist as the bundle (stations, content decor, progression placeables) now ride the left fist like the crate and sail, and the right hand points where they go (`HELD_HOLD` in `dist/held-models.js`). `isPlaceable` is unchanged.
- World-model kits (decor pack, kiln, storm, engine, bed, trader, cookpot, buoy course, game table, flag) are built once per THREE instance inside `held-models.js` and marked shared, so `hands.js` clones their materials and never disposes their geometry.
- Hands: skin uses its own 128 px generated pore and crease texture (also the bump map), a warmer subsurface tint in shadow with a faint rim, nails on curled and tucked tips, and baked contact shading between fingers. All built once at `createHands`; `update()` is unchanged apart from the hook-kind check.
- Screenshots: `python check_held_items.py dist <out> [kind ...]` (headless Chrome, one fresh game per 9 kinds; `HELD_SCALE=2` for sharper close-ups).
