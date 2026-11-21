# Scarecrow and peckish gulls: research

Goal: gulls sometimes land on a watered palm planter and peck at it, which pauses its growth for a moment.
Walking up or pressing E shoos them. A craftable Scarecrow keeps planters near it gull-free. Nothing is ever
destroyed, and the player is never hurt. Line numbers are for the branch as checked out.

## 1. What Raft does (reference only)

- Seagulls are Raft's crop pest. One circles, then dives at a planted crop plot, roughly every 4 minutes. If nobody
  stops it in about 15 s, it eats the crop and the plot is empty again. Walking up to it (about 2.25 m) or hitting it
  scares it off. Sources: raft.fandom.com/wiki/Seagulls and gameskinny's crop-defence guide, as already cited in
  `docs/features/wildlife.md:9-14`. raft.wiki.gg was unreachable on earlier passes.
- A Scarecrow is a placeable you craft from planks, rope and a few other parts. Within about 3.5 m it draws the gull's
  attack onto itself instead of the crops. Players use it to cover a block of plots.
- What we keep: gulls are drawn to plants, you can shoo them, and a scarecrow protects an area. What we drop: crops
  being eaten or lost, hitting birds, and any timer the player has to beat.

## 2. Our original, friendly version

- **Peckish gull.** Now and then a gull that would perch picks a *watered, still-growing* palm planter. It lands on
  the pot rim and pecks for 6 to 15 s (the existing visit length). While it pecks, that planter's growth pauses.
  It never removes progress, never pulls a plant back a stage, and never touches dry, empty or ripe planters. The worst
  case is a palm that ripens a few seconds later.
  (Optional, softer still: the gull leaves a "feather" leaf or a Seagull Feather decor drop as a thank-you. Defer to v2.)
- **Shoo.** Walking within `SCARE_RADIUS` (3 m) already makes a perched gull leave (`wildlife.js:7`, `spooks()` :340).
  Add E on a pecked planter: the prompt becomes `<kbd>E</kbd>Shoo the gull`, and a soft "Shoo!" toast plays. There is
  no penalty for ignoring it.
- **Scarecrow (decor `scarecrow`).** Our own design: a bleached driftwood post with a crossbar, a skirt of palm
  leaves, a floppy bucket hat, two rag strips on the arms that flap in the wind (a vertex sway in `update`), and a
  painted-on shell smile. Recipe idea: `{wood: 3, leaf: 4, rope: 2, plastic: 1}`, unlocked by `discover('rope')`
  or once a palm planter has been placed. Effect: planters whose tile centre is within `SCARECROW_RADIUS = 4.5` m
  (about 2 tiles, so a 5x5 block) are never picked for a peck. Gulls that would have come are welcome to land on
  the scarecrow's hat instead (`PERCH_TOP.scarecrow ≈ 1.75`). That is a cute nod to Raft's "draws the attack", and
  it does no harm.
- **Cosmetics (later).** The hat colour could take the paint palette (`docs/specs/paint.md` §1; paint is specced but
  `dist/paint.js` does not exist yet). Store it as an optional `d.hat` idx on the decor entry only if `cleanWorld`
  learns to keep it. Today it keeps only `type,x,z,rot` (`game.js:181`). Simpler for v1: a fixed look, with paint
  added once paint lands.

## 3. How the code hosts it

**Farming that is live.** Planters use `dist/watering.js`, not `dist/farming.js`. `farming.js` / `farming-view.js`
(`d.farm = {s,g,w,h}`, `tickPlant` :56, `tickFarm` :68) are not imported by game.js (only tests and inventory-state
item defs), so do not build on them. The live state is `world.garden["x,z"] = {water:0|1, grow:0..90}`
(validated by `cleanGardenEntry`, `watering.js:29`). The stage is `plantStage()` :85 (45 s and 90 s thresholds). `tick(world, dt)` :96 adds
`s` to `grow` only when `water === 1 && grow < 90`, and clears water on ripening. The host calls it once a second at
`game.js:1297` (`tickWatering(world, 1)`), inside `if (running && role !== 'guest')` at `game.js:1288`.
`world.garden` syncs to the guest as a top-level key in `hostState()` (`game.js:1267`).

**Gulls today** (`dist/wildlife.js`):
- `perchesFrom(tiles, decor)` :65. A tile with *no* decor is a deck perch (y .2). A decor tile is a perch only if
  its type is in `PERCH_TOP` (:17: sail, crate, bench). **Palm planters are not perches today**, and neither would a
  scarecrow be. The list is sorted by tile, and gulls index into it.
- `gullVisit(seed, i, slot, n, v)` :100 is pure. Each gull has a 40 s slot (`GULL_SLOT`), a 72 % chance of a visit,
  a start at 4 to 14 s and a stay of 6 to 15 s. The perch is `(floor(rnd(c,0)*n) + i) % n`, so gulls in one slot take
  consecutive indices. Everything is keyed from `WILDLIFE_SEED` :7, gull i and slot.
- `gullPerch(i, t, slot, nG)` :378 latches the perch when the visit begins. If the scheduled perch is taken by
  another gull, or a player is within `AVOID_RADIUS` 3.5 m (`perchFree` :348), it walks to the next free one.
- `updateGulls` :400. When the layout changes and the latched key vanishes or changes height, the gull takes off
  (:408-411). A perched gull is spooked by `ctx.physics` or `ctx.other` (:417-420), and this sets the *local*
  `scareAt[i]`.
- Clock: the host sends `ext.wildlife = {t}` (`serialize` :510), and the guest slews toward it (`load` :515, `slew` :487).

**Is gull state deterministic?** Mostly. Schedule, path and perch index are pure functions of seed, `t`, tiles and
decor. Three things are local per client: (a) **gull count `nG` depends on the local graphics setting**
(:502, low 3 / medium 5 / high 6), and `perchFree` only checks gulls `j < nG`, so a low-graphics guest can latch a
different perch than a high-graphics host; (b) the scare `scareAt` comes from each client's view of both poses,
and the remote pose is interpolated and lags; (c) the guest clock is slewed, so it can lag by a fraction of a second.
That is fine for scenery, but **not good enough to change `world.garden` on both sides**. So:

**Nibble/pause must be host-authoritative.** Recommended shape:
1. Make planters (and scarecrows) perch targets: in `perchesFrom` add `palm` (pot rim, `PERCH_TOP.palm ≈ 0.5`;
   the pot is 0.5 m tall per `models.js:571`, base `DECOR_Y` .22) and `scarecrow` (hat top). Then drop from the list
   any `palm` within `SCARECROW_RADIUS` of a scarecrow. This rule depends only on decor, so both clients agree.
   Also drop planters that are dry, empty or ripe? No: that reads `world.garden`, which ticks every second and would
   rebuild perches constantly (`refreshPerches` :324 hashes only tiles and decor). Keep every planter as a perch and
   just *peck* only when the garden entry is growing; otherwise the gull simply sits on the rim.
2. Only gulls `i < 3` (present on every graphics setting) may take a `palm` perch. Gulls 3 to 5 skip palm keys in
   `gullPerch`, so the visit everyone sees is the same on all settings.
3. Host only, in the wildlife `update` (or a small `scarecrow` content module that reads it): once a second, collect
   the set `pecked` of palm keys that have a gull in state `'perched'`. Expose it as `mod.pecked` (a Set), the same
   way `content.rain()` reads `daynight` (`content.js:61`).
4. Pausing growth needs one line at the watering tick. Either pass a skip set,
   `tickWatering(world, 1, content?.pecked?.())` with `tick()` skipping those keys (`watering.js:103`, a backwards-safe
   optional third arg), or, with zero game.js edits, have the module undo it after the tick (`e.grow -= 1` for pecked,
   watered, non-ripe keys). The undo is fragile because of update order (content `update` runs at `game.js:1284`,
   before the tick at :1297). **Prefer the explicit skip arg.**
5. The guest sees the pause through the synced `garden` (the % in the prompt stops). No new net message is needed.
   For a "pecking" prompt on the guest, the host can put `ext.scarecrow = {p:["x,z",...]}` in `serialize()`.
6. **E to shoo:** `content.interact(aim)` runs *before* the watering E handler (`game.js:984` vs :987), so the module
   must return true **only** when the aimed palm (`aim.decor.type === 'palm'`) has a pecking gull. Otherwise harvest
   with E breaks. The guest sends `ctx.action({kind:'scarecrow.shoo', x, z})`, and the host's `action()` sets that gull's
   scare. Locally the guest also sets its own `scareAt` right away so the shoo feels instant. Walking up already
   works on both sides with no message.

**Decor plumbing.** Add `scarecrow` to `dist/items.js` as `category:'decor', placeable:true`. It then joins
`PLACEABLE_IDS` :215, then `DECOR_TYPES` (`game.js:68`). Add `scarecrow: 0.25` to `BLOCK_RADII` :218, which feeds
`BLOCK_RADIUS` at `game.js:76`. The bees lane is the template here (`items.js:176-182`, `:221`). For the model,
either `createCraft(T, 'scarecrow')` in `crafts.js` or `content.decorModel('scarecrow')` (`game.js:525`, and the ghost
at :400). An alternative is the content route: `CONTENT_DECOR` / `CONTENT_BLOCK_RADIUS` in `content-items.js`
(content-hooks.md table). Registering a new module means appending it to `FEATURES` (`content.js:31`).

## 4. Risks

- **Save compat.** `cleanWorld` drops decor whose type is not in `DECOR_TYPES` (`game.js:179`). A save opened in an
  older build silently loses its scarecrows. The tile frees up and the crafted item is not refunded. The bag is safe:
  `migrateSnapshot` drops unknown kinds (`items.js:455`) rather than resetting the bag. New builds load old saves
  unchanged (no scarecrow, no `ext.scarecrow`). Never store state on the decor entry except in a field
  `cleanWorld` keeps.
- **Perch list change ripples.** Adding `palm`/`scarecrow` to `perchesFrom` changes `n` and the indices for every
  raft with planters, so the gull schedule shifts for existing saves. That is harmless, but `tests/wildlife.test.mjs:21-36`
  asserts the perch set and needs updating. Changing perch heights under a latched gull already triggers a take-off.
- **Co-op determinism.** Keep the growth effect on the host only. Never let the guest compute pecks into `garden`.
  Mixed versions: an old host has no pecking (the guest must not show "Shoo" prompts unless `ext.scarecrow` is present,
  like bees' `hostHasBees` at `bees.js:112`). An old guest just sees gulls on pots.
- **Not stressful.** Pause only, and never subtract or regress a stage. Cap it: at most one pecking gull at a time
  per raft, and at most about 1 in 4 visits chooses a planter. A planter shooed or pecked in the last 60 s is skipped.
  Do not emit notices for pecks, and do not play alarming sound. Use a soft gull chirp at most, plus the prompt text.
  On average, an unattended planter should ripen less than 10 % slower. A single scarecrow fully protects a typical
  2x2 garden. Never peck during onboarding (the first planter) if `progression` says the goal is open.
- **Visual nits.** The palm fronds occupy the pot centre, so perch on the rim with an offset toward the gull's
  approach side. The pot is decor-sized, so clamp the wing downstroke (`FOLD_H` logic :167-174) with the higher `py`.
