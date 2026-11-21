# Power research: Wind Turbine, Battery, String Lights

Research only, no code yet. Line numbers are for the `claude/loop-features-202611210735` checkout.

## 1. What exists today

- **No power concept anywhere.** `grep -i battery|power|charge` finds nothing in `purifier-model.js`, `signal.js`, `signal-models.js` or `storage-research-model.js`, and `battery` appears in no file under `dist/`. This is greenfield.
- **No `userData.pool` per-lantern option.** It does not exist. The only per-lantern input daynight reads is the `lanternGlow` mesh's bounding-sphere centre, which is where the pool light goes. `bees-model.js:163-166` moves that centre on purpose so the candle's pool sits at lantern-foot height. A per-light "powered" flag is new work (see 4).
- **No `promptFromHtml` or `game-aim` helpers.** Content prompts are plain HTML strings returned from `prompt(aim)`, and `game.js:566` shows them. `aim` is `frameAim` (`{dir,...}`). `bees.js:116-136` is the ray-pick pattern to copy.

## 2. daynight.js hook points

| What | Where |
|---|---|
| Weather table `W_WIND = [0.15, 0.7, 0.5]` (calm, breezy, rain), blended over 25 s | `daynight.js:86-91` |
| `weatherAt(seed, clock, out)`: pure, so every peer computes the same weather from the synced `{clock, seed}` | `:93-103` |
| Live state `W = {weather, weatherNext, blend, rain, wind, cloud}` and `L = {sunHeight, nightFactor, light}` | `:286-287` |
| Public getters, only `get wind()` and `get rain()`. There is **no `nightFactor` getter**; `debug.state()` allocates | `:654` |
| Lantern names: `LANTERN_PARTS = ['lanternGlow','flame','lanternGlass','candle']`, `LANTERN_MULT = [2.4,1.6,1.6,2.0]` | `:242-243` |
| `MAX_LANTERNS = 64`, `MAX_PARTS = 256`, shared by lanterns and candles | `:244` |
| `POOL_PEAK = 5`, `POOL_RANGE = 8` | `:250` |
| Pool `PointLight`s: `POOL_LIGHTS = 4`, capped per graphics setting `{low:1, medium:2, high:4}`, `castShadow=false`, added to the scene lazily on the first lantern and **never removed** (removing one recompiles shaders) | `:9-11, :369-393` |
| Signature counts `decor.type === 'lantern' \|\| 'candle'` | `:401-406` |
| Scan matches `g.name === 'craft_lantern' \|\| 'craft_candle'` (hardcoded) | `:413` |
| Emissive write `base*(1+(mult-1)*nf)`, **skipped while `nf === lastNf`** | `:550` |
| Rank the 4 nearest every 0.5 s, then pool intensity `nf<0.15 ? 0 : 5*smooth` | `:438-449, :551-561` |
| `content.rain()` bridge from the registry; there is no `wind()` twin | `content.js:61` |

Separately, sailing has its own `windStr`/`windDir` (`sailing-core.js:30`). Use the daynight `wind`, as the brief asks,
because it is deterministic and already synced. Note that the two winds can disagree.

## 3. How placeables are defined, placed and saved

- **Catalogue:** add `item('turbine'|'battery'|'stringlights'|'lamppost', ..., 'decor', {placeable:true, recipe:hand({...}), unlock:...})` next to the `[bees]` block at `items.js:176-185`, and add radii to `BLOCK_RADII` at `items.js:218-222`. `PLACEABLE_IDS` (`:215`) then feeds `DECOR_TYPES` (`game.js:63`) and `BLOCK_RADIUS` (`game.js:71`) automatically, so game.js needs no edit for types.
- **Decor record:** `{type, x, z, rot?}`. Exactly **one decor per tile**: `cleanWorld` drops duplicates (`game.js:172-178`) and `decorBlock` returns `'occupied'` (`build-rules.js:32`). So "battery on the same tile" as the turbine is impossible. Use adjacency instead (Chebyshev 1, like `flowersNear`/`FLOWER_RANGE` at `bees.js:46-50`).
- **Placement:** generic, at `game.js:884-892` (the bag decrements and `world.decor.push`), then `rebuildRaft()` (`game.js:497-520`) asks `prog.modelFor ?? ... ?? content.decorModel(type)` (`:502`). The model is placed at `(x*2, .22, z*2)`, `rotation.y = rot`. Ghost previews use the same chain (`:393`). Name model groups `craft_<type>`, as `bees-model.js:52/124/149` do.
- **Content module shape:** `content.js:7-23` plus the registry at `:31`. The bees module (`bees.js:102-255`) is the template:
  - a pure top half with exported `clean*`/`tick*` functions for tests
  - a host tick that runs only for whole seconds (`:191-200`)
  - `serialize` cached on `r` (`:181-185`), net `load` that skips an unchanged `{r, s}` (`:167-179`)
  - an `action` prefix check plus a host reach check against `ctx.other`/`ctx.physics` (`:217-226`)
  - a `debug.place/fastForward` (`:234-252`) and `decorModel` (`:227-233`)
- **Save:** `world.ext[name]` goes through `cleanExt` (200 000 chars cap, `content.js:32-38`), is written at `game.js:1043` and sent in `hostState` at `game.js:1234`. Prune entries whose decor is gone, as `cleanBees(v, decor)` does (`bees.js:26-43`).

## 4. Proposed design and state

**Power is derived, not stored.** Only the battery charge is state:

```
world.ext.power = { v:1, s:<session>, r:<rev int>, b:{ "x,z": { e:<int 0..CAP> } } }   // batteries only
```

- Host tick, 1 Hz (copy `bees.js:191-200`). For each battery, `turbines = count of turbines Chebyshev<=1`. Then `e += round(turbines * wind * GAIN)`, and at night (`nightFactor > .15`) `e -= lightsServed * DRAIN`, clamped. Bump `r` only when an integer `e` changes, so the net `load` early-out keeps working.
- **Served lights:** a String Light or Lamp Post is lit when some battery with `e > 0` sits within `LIGHT_RANGE` (Chebyshev 3). Peers compute it from `decor` plus `b`. It is never sent as a list.
- **Turbine spin:** purely local on every peer, `blade.rotation.z += wind * SPIN * dt`. No net traffic, since weather is deterministic. Scan the `craft_turbine` groups the way `bees.js:138-149` does.
- **Prompts:** battery `Battery · 62% · charging (breezy)`; light `String Lights · no power nearby`. Use the `OLD_HOST` guard text `Your friend’s raft doesn’t have power yet` (pattern `bees.js:9,112,203,211`; `storage-research.js:14,319`).
- **Needed bridges** (small, marked `// [power]`):
  1. `daynight.js:654`: add `get night() { return L.nightFactor; }`.
  2. `content.js`: modules cannot see each other. Add a `wind()`/`night()` pair next to `rain()` (`:61`) and hand it to modules, e.g. `for (const m of mods) m.link?.(api)` after the module creation loop at `:42-44`. Do **not** spread `ctx`: its getters are live and spreading freezes them. With `?daynight=off` (`createDayNightOff`, `:264-272`) neither getter exists. Fall back to wind `0.15` and night `0`.
  3. `daynight.js:404,413`: also accept `stringlights`/`lamppost` (signature) and `craft_stringlights`/`craft_lamppost` (scan).
  4. Per-light power gate: during the scan, cache `g.userData.power` (an object the power module owns, `{lit:0|1}`). Then in the rank step (`:438-449`), skip a `lit===0` entry. In the emissive write (`:550`), multiply by `lit` and **force `lastNf = -1` when any `lit` flips**, otherwise the skip at `:550` leaves the bulbs glowing. An unlit light also falls back to its model's day emissive, which matches today's restore path (`restoreParts`, `:408`).

## 5. Research and recipe gating

- Unlocks come from `items.js` (`START`/`discover`/`research`/`atStation`, `items.js:53-58`; schema `:28-32`). Progression enforces them on host craft (`progression-hooks.js:109-113`). `storage-research.js:28-31` (`setOwnedElsewhere`) leaves catalogue items alone, so **no `craftLocked` is needed**.
- Suggested costs:
  - Turbine `hand({wood:4, metalingot:2, bolt:2, rope:2})`, `research('metalingot','bolt')`
  - Battery `hand({copperingot:2, metalingot:1, plastic:2})`, `research('copperingot')`
  - String Lights `hand({glass:2, copperingot:1, rope:2})`, `research('glass','copperingot')` (same gate as binoculars, `items.js:151`)
  - Lamp Post `hand({wood:3, glass:1, copperingot:1, nail:2})`
- This places power at about minute 100 or later (`PROGRESSION_PLAN`, `items.js:276`). Add a plan row `{minute:115, goal:'Light the raft with wind power', ids:['turbine','battery','stringlights']}`.

## 6. Co-op

- The host owns `b`. Guests `load(data,'net')` about 8 times a second, so return early on unchanged `r`/`s`. A guest on an old host gets `ext.power === undefined`: show the `OLD_HOST` prompt, render every light unlit and let turbines still spin (cosmetic).
- Battery charge is not player-actionable, so no `power.*` actions are needed in v1. If a "check" or "toggle" E action is added, route it through `ctx.action` and check reach against `ctx.other` for a guest (`bees.js:220-221`).
- Mixed versions: older builds reject unknown bag kinds and drop unknown decor (LOG.md "Known limits"), so this is the same limit as bees.

## 7. Perf constraints (docs/loop/LOG.md perf round 1, docs/features/daynight.md 5)

- **Lights: add zero PointLights.** The 1, 2 or 4 pool lights stay the only dynamic lights. Every light added to the scene costs per-fragment work in every lit material and recompiles every shader (LOG.md:45; daynight.md:330-349). String lights glow with **emissive only**. Give a Lamp Post a `lanternGlow` mesh so it can win a pool light by distance, inside the existing cap.
- **Shadow casters:** these went from 314 to 124 in perf round 1. Set `castShadow=false` on bulbs, wire, glass and blades. Only the turbine mast and the battery box should cast shadows. A spinning shadow-casting blade would make the shadow map change every frame.
- **Draw calls:** these went from 509 to 103. Bake each model into 1 to 3 merged meshes (`bake`/`merge-geo.js`, as in `bees-model.js:141`). String-light bulbs should be one merged emissive mesh plus one wire mesh, not one mesh per bulb. Blades should be one mesh (so the spin is one transform).
- **The 64-lantern cap is shared** by lanterns, candles and the new lights, in `raft.children` order. Past 64, a light just never brightens at night. This is acceptable but should be documented. Every emissive part of a new light must be named from `LANTERN_PARTS`, and at most 4 parts are counted per group.
- `update()` must not allocate: preallocate the turbine and light arrays and rescan only when `raft.children` changes (`bees.js:138-149`).

## 8. Risks

1. **Emissive-skip bug.** A power flip without an `nf` change is invisible unless `lastNf` is reset (`daynight.js:550`).
2. **Rank latency.** Pool picks refresh every 0.5 s, so an unpowered lamp keeps its pool light for up to 0.5 s. Force `rankClock = 1e9` on a flip.
3. **Night drain.** A rainy or calm night may empty the battery. That is intended (friendly, nothing is lost), but tune `CAP`/`DRAIN` so one breezy day plus a full battery lights about 6 bulbs through a night (about 400 s at `nf > .15`).
4. **daynight off.** With no night, lights never glow and charge just fills up. Say so in the prompt.
5. **One decor per tile.** The brief's "same tile" cannot happen. Adjacency only.
6. **Hardcoded names** in daynight (`:404,:413`) must stay in sync with the new model names. Add a test for that.

## 9. Recommendation

Build a new `dist/power.js` plus `dist/power-model.js` content module, cloned from the bees shape. Register it in `content.js:31` and add items in `items.js`.
Keep it small:
- battery charge in `world.ext.power`, with lit and spin state derived
- emissive-only String Lights, and a Lamp Post that reuses the pool via `lanternGlow`
- the three small daynight/content bridges in 4

Defer the receiver and purifier bonus. `world.purifiers` (`watering.js:109-114`, ticked at `game.js:1263`) and `signalTick` tiers
(`signal.js:6-11`) live outside `ext`, so powering them couples the module to core state. If wanted later, the least risky option is a
read-only `powered(x,z)` query that `tickWatering` multiplies its `s` by (for example 1.5x near a charged battery).
