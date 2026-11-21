# Friendly storms + Lightning Rod: research

A squall now and then. The sky darkens, rain gets heavier, the waves rise a little, and lightning flashes
with thunder a moment later. Nothing is ever hurt or broken. Bolts hit the open sea or a placed
**Lightning Rod**, and a strike on a rod leaves a **Storm Shard** (a small glassy fulgurite). Shards go
into a couple of recipes, such as the blue-glowing **Storm Lantern**. Everything here is original.

## 1. Raft reference (short)

- WebSearch ran twice (2026-11-21). Neither search found a Raft source on storm frequency, storm length
  or the lightning rod. The results were Minecraft, Stardew Valley, Don't Starve and Arc Raiders.
  `docs/features/daynight.md:20` already calls Raft storms *unverified* ("rough waves, dark sea, lightning").
- From memory, not checked: in Raft, storms are a rare weather state with dark sky, heavy rain, bigger
  swells and lightning. Players craft a metal Lightning Rod and place it on the raft, where it pulls
  strikes near the raft toward itself. No numbers were confirmed, so the numbers below are our own.
- What other games do: a rod nearby takes the strike instead (Minecraft, Stardew). Stardew rods turn
  strikes into a resource, which is the loop we want. "Fulgurite" is the real name for glass made where
  lightning hits sand (Arc Raiders uses it as a loot item).
- Ours keeps the mood and the rod-to-reward loop. We drop strike damage, fire, power loss and any
  survival pressure, the same way `daynight.md:24` already drops "storm damage".

## 2. What already exists to reuse

**Weather is already deterministic and host-seeded (`dist/daynight.js`).**
- `WEATHERS = ['calm','breezy','rain']` (l.8). Segments run 180 to 360 s: `SEGMENT_STEP = 270` and
  `SEGMENT_JITTER = 90` (l.13-14). `segmentStart` (l.79) and `segmentIndexAt` (l.90) find the segment.
- `hash01(seed, index, salt)` (l.59) is a uint32 hash. Salts 1 (jitter) and 2 (weather) are taken, so
  **salt 3 is free for the storm roll**. `rawWeather` and `weatherIndex` (l.71-77) give .5/.3/.2 shares
  and never put rain right after rain. `tests/daynight.test.mjs:69-71` asserts those shares.
- `weatherAt(seed, clock, out)` (l.106) returns weather, weatherNext, blend (a 25 s `BLEND_SECONDS`
  smoothstep) and the rain, wind and cloud values from `weatherParams` (l.100, tables `W_RAIN`, `W_WIND`,
  `W_CLOUD` at l.99).
- **Sync:** weather is a pure function of `(seed, clock)` (header l.3). `serialize()` (l.661) sends only
  `{v:1, clock, seed}`. A guest's `load(d,'net')` (l.644-655) moves its clock toward the host's
  (`driftStep`) and snaps when the gap is over 5 s or the seed changes. The host owns the clock, and
  `action('daynight.skipTo')` is host-only (l.666). So the storm schedule is host-driven already.
- **Sky tint:** `refreshSky()` (l.489-558) runs only every `SKY_STEP = 0.1` s of clock, or when
  `skyDirty` is set. It writes `scene.background`, fog colour and near/far (`60-44*wet`, `260-180*wet`),
  the sun and hemi intensity, `renderer.toneMappingExposure`, the ocean colour uniforms, cloud colour
  and scale (`grow`), the star and moon alpha, and the rain uniforms. `paletteAt` and `rainBlend`
  (l.139-146) pull colours toward grey-green. **Any storm darkening has to go in here** as an extra
  term such as `storm` 0..1, because daynight rewrites these values absolutely. A separate module that
  multiplied them every frame would compound between refreshes.
- **Rain:** a shader `LineSegments` (l.366-384). `uRain` culls streaks by `aIdx > uRain` (l.236), so
  rain density is capped at the 1.0 that full rain already uses. A heavier storm needs a higher streak
  count or a slant/speed boost through `uWind`, not `uRain` above 1. The `debug.setWeather(w)` pin
  (l.704) is the QA hook to copy for `setStorm`.
- Getters `wind` and `rain` (l.728). `content.rain()` (`content.js`) gives other code the live rain value.
- Opt-out: `createDayNightOff` (l.280), used with `?daynight=off`. The storm module must then stay calm.
- `DAYNIGHT_LIVE` (l.32) is the pattern for a module-level live object (sleep.js reads it). A
  `STORM_LIVE {level, flash}` written by storm.js and read by daynight's per-frame `applyVisuals`
  could carry the flash without a cross-module call.

**Rain barrel (`dist/rain.js`, `dist/rain-model.js`).** `tickRain(world, dt, rain)` (rain.js:104) is
host-only, called once a second from `game.js:1612` with `content.rain()`. `paintRainBarrel(g, entry,
raining, elapsed)` (rain-model.js:58) is the visual. A storm is a rain segment, so barrels fill with no
change. Clamp storm rain to 1 (`tickRain` clamps anyway) so collection rates do not change.

**Sky dome (`dist/sky.js`).** `createSky` (l.121) has `uCoverage` and `uCloudShade` uniforms (l.31-33),
and `follow(oceanUniforms, background)` (l.177) copies the daynight palette. A storm can push
`uCoverage` up and `uCloudShade` darker from the same `storm` term.

**Waves (`dist/ocean.js`).** Gerstner amplitudes are **baked as GLSL constants** from `WAVES` (l.11-16,
total amplitude .255, crests near y = .015 against a deck at .2). There is no amplitude uniform today.
The CPU mirror (`getHeight`, l.308, using the `W` and `AMP` Float64Arrays) has to scale by the same
amount. `docs/tech/water-ADOPT.md:114-117` already describes the fix: an `ocean.setAmp(a)` that scales
a `uAmp` uniform and the CPU table together ("never set uAmp alone"). It is not in `dist` yet. A
friendly squall should stay around `a = 1.3` (crests about y = .09, still under the deck). Ease the value
every frame, since it is a four-element loop.

**Audio (`dist/audio.js`).** There is no thunder or rain sound yet. Pieces to reuse:
- `makeNoise(seconds, brown)` (l.67). `graph.brown` is 2 s of looping brown noise and `graph.noise` is
  white (l.102).
- The helpers `burst`, `noise`, `tone`, `filter` and `env` (l.193-232), and the recipes table (l.257).
  The `lap` ambience one-shot (l.409) is the template for a low-passed brown rumble.
- `EVENTS` (l.23), `MIN_GAP` (l.31) and `MAX_VOICES = 24` (l.30). Buses are master, effects, ambience
  and music (l.27). `play()` (l.509) refuses names in `AMBIENT` and only plays effects-bus recipes.
- Modules reach audio only through `ctx.play(ev, s)` (game.js:426), which is a local sound and never
  sent. Thunder needs a new `'thunder'` recipe in `EVENTS` and `MIN_GAP` (gap of about 1.5 s,
  decay 3 s or less). Each client schedules its own thunder 0.6 to 3 s after its own flash. The
  ambience bus would suit thunder better, but `play()` would need a small `bus` option first.

**Content registry.** In `dist/content.js`, a module is a factory `(ctx, {peek})`. Add it to `FEATURES`
**after `createDayNight`** so it can `peek('daynight')` for `{clock, seed}`. A module that throws is
disabled. `docs/features/content-hooks.md` covers the backward-compatibility and co-op rules: about 8
state sends a second, so `serialize()` must be cheap and `load('net')` must not rebuild when nothing
changed. ctx gives `scene`, `camera`, `raft`, `ocean`, `hemi`, `renderer`, `world`, `role`, `emit`,
`play` and `rebuildRaft`. **ctx also exposes `hurtPlayer`. The storm module must never call it.**

**Items, recipes and decor.**
- `dist/content-items.js`: add `stormshard` to `CONTENT_ITEMS` with the `item(kind, name, icon, ...)`
  helper. Add recipes with `recipe(id, name, count, cost)` to `CONTENT_RECIPES`. Placeables go into
  `CONTENT_DECOR` and `CONTENT_BLOCK_RADIUS`, which `game.js:75,84` spreads into `DECOR_TYPES` and
  `BLOCK_RADIUS`. `inventory-state.js:33,82` spreads the items and recipes (the content hooks).
- `dist/items.js` is the catalogue for materials (`metalingot`, `copperingot` l.126, `glass` l.129,
  `metalore`). Suggested costs: Lightning Rod `{metalingot:2, copperingot:1, wood:2}`. Storm Lantern
  `{stormshard:2, glass:1, metalingot:1}`, a sibling of `glasslamp`. A second use could be a
  "Shard Chime" decor or a stormshard tint paint.
- Icons are `<symbol id="icon-...">` entries in `dist/icons.svg` (see `icon-kiln` l.478).

**Station template (`dist/kiln.js`).** Copy these parts:
- The slice is `world.ext.kiln`, with a revision counter `st.r` and a cached `serialize()` (l.50).
- `load()` skips a repeated net revision (l.55-64).
- `decorAt(x, z)` (l.20), and the one-second host prune of entries whose decor is gone (l.101-111).
- `rescan()` finds models by `g.name` among `raft.children` (l.67).
- `decorModel(type)` builds the model lazily and returns `instance()` (l.193).
- `debug.place` and `debug.give` (l.160-168) are the QA helpers.

**Night lanterns.** daynight's lantern cache matches `craft_lantern` and `craft_candle` group names
(`lanternSignature`, scan around l.420-460), and the pool point lights are capped by graphics
(`POOL_CAP` l.10). The Storm Lantern should use an emissive blue mesh, not a light. If it is added to
that cache, it competes for the pool.

**Model style (`docs/MODEL-STYLE.md`).** Build with `rbox` bevels and vertex colours, one merged mesh
per material, chunky shapes, and placeables centred and standing on y = 0 inside 1.7 x 1.7. The rod is
a tall thin post (budget ~600 tris) with a copper tip, so pick a copper/cyan accent. The shard is a
small item (600 tris or fewer) in pale cyan glass, emissive about `#7fd8ff`.

## 3. Co-op sync and saves

- **Schedule from the shared seed, not from messages.** A storm is a rain segment `i` where
  `hash01(seed, i, 3) < STORM_P`, for example 0.35. That works out to about 7% of play time, roughly one
  storm an hour, each lasting 3 to 6 min. The calm, breezy and rain shares stay as they are, the
  existing tests still pass, and old worlds keep the same weather. Storm intensity ramps over the same
  25 s blend. Put `stormAt(seed, clock)` in daynight.js beside `weatherAt`, as a pure function with tests.
- **Strikes are deterministic too.** Inside a storm segment, strike `k` happens at
  `segStart + sum of gaps`, each gap being `hash01(seed, i*64+k, 4)` mapped to 6 to 18 s. Its spot comes
  from salts 5 and 6, a ring 25 to 80 m from the raft over open sea. Each client works out the same
  flash times from the synced clock, with no per-strike messages, and drift stays under the 5 s snap.
- **Rod strikes are host events.** Whether a bolt goes to a rod depends on world decor (for example
  `hash01(..., 7) < 0.5` when at least one `stormrod` exists, picking the rod by hash). The guest has the
  same decor, so it can draw the bolt locally. Only the **reward** goes through the host: it adds the
  shard to `world.ext.storm.rods[key] = {n}` (cap about 3, collected with E like `kiln.take`) and bumps
  `r`. Use a once-per-strike guard keyed by `(segment, k)` so a clock re-sync cannot pay out twice.
  An optional `emit({kind:'loot', ...}, 'all')` sends the toast.
- **Slice:** `world.ext.storm = {v:1, r, rods:{"x,z":{n}}, force?:until}`. It is small, and `force` is
  only for a debug or host-forced squall. Validate it like kiln's `cleanSlice`.
- **Saves:** an old save has no `ext.storm`, so `load(undefined)` leaves rods empty. The storm itself
  comes from the daynight seed, so old worlds get storms on their rain segments, which is harmless.
  Older builds drop the unknown `stormshard` and `stormrod` kinds (see the content-items.js header).

## 4. Performance, accessibility, conflicts

- **Flash:** do not add a new light per strike. Lift `hemi.intensity` and exposure for about 120 ms in
  daynight's per-frame `applyVisuals` (add to the base value cached in `refreshSky`, never multiply).
  Optionally use one reused non-shadow `PointLight` at the strike spot. Never `castShadow`, because that
  costs a shadow map. Use one pooled bolt mesh: a jagged strip of about 12 segments in a preallocated
  `BufferGeometry`, rewritten in place, `MeshBasicMaterial` with additive blending, `fog:false`, hidden
  between strikes. No per-frame allocation, and keep scratch vectors and colours in module scope.
- **Waves:** `setAmp` eases a scalar, so it is cheap. Check the rain streak count on graphics `low`.
- **Accessibility:** `dist/settings.js` SPEC (l.16-27) has `cameraMotion`, but no flash or
  reduced-motion option. Add a toggle `stormFlash` with def true (or a range from 0 to 1) on the graphics
  tab, read through `ctx.options`. When it is off, use a dim sky pulse at 25% or less with no bolt
  strobe. Also honour `prefers-reduced-motion`. Keep flashes at 3 per second or fewer (WCAG 2.3.1).
  At most one strike every 6 s makes this easy. Thunder follows the effects volume.
- **No damage:** no fire, no tile loss, and no `hurtPlayer`. Strikes never land within 15 m of the
  raft except on a rod, and never near a swimmer or island.
- **In-flight branches:** `origin/claude/loop-features-202611210735` adds `dist/power.js`,
  `power-model.js` and a battery system that is not merged. **Do not import it.** A later hook could be
  a rod strike that tops up an adjacent battery, done by sending a `power.*` action if that module
  exists, as an optional peek. Other edits to `daynight.js`, `ocean.js` (`setAmp`) or `audio.js` EVENTS
  on other branches will merge-conflict, so keep the edits there small and in one block each.
