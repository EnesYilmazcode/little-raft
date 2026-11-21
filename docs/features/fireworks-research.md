# Fireworks research

Goal: a friendly way to celebrate on the raft at night. You craft a small firework, set it on a deck tile, press E,
it whistles up, pops into coloured sparks and lights the sky for a moment. No damage, no fire, nothing is lost but the rocket.
Line numbers below are from branch `claude/loop-features-202611210749`.

## 1. Fireworks in other games (reference only, we make our own take)
- **Raft (Redbeet Interactive).** We could not confirm, from sources we can cite, that Raft has a craftable, placeable
  firework. Its decoration items are cosmetic and placed on the raft, and it has seasonal or celebration cosmetics. Raft
  also has a **flare gun**, which is a signalling tool and not a celebration item. Do not copy any Raft name, model, icon or recipe.
- **Minecraft.** You craft a firework rocket from paper, gunpowder and an optional firework star. Dye in the star sets the
  burst colour. This is the clearest precedent for "a colour ingredient sets the burst colour", which matches our paint pots.
- **Stardew Valley (1.6).** Red, purple and green fireworks are placed on the ground and launch after a short fuse.
  Each one is used up, and each colour is its own item.
- **Animal Crossing: New Horizons.** August has Sunday firework shows. There are hand-held sparklers and a firework
  "custom design" show. The tone is purely celebratory and shared with visitors.
- **Sea of Thieves.** Firework crates hold rockets that you hold and launch. They are a social, emote-like signal, and every
  crew nearby sees them.
- **What they share:** each firework is used up, a colour choice is part of crafting, a short fuse gives a moment of
  anticipation, the fireworks look best at night, and everyone nearby sees the same show.

## 2. Our original take (proposal)
- **Sky Rocket** (`skyrocket`, decor, stack 20). It is a paper-and-plastic tube on a little stick stand, with a rope fuse.
  Recipe idea: `hand({ plastic:1, scrap:1, rope:1 }, 2)`, which makes 2 rockets, unlocked with `discover('rope','scrap')`.
  Place it on a tile like a candle. Press **E** while aiming at it to light it. The fuse fizzes for 1.2 s, then the rocket
  rises about 18 m over 1.1 s, bursts into about 120 sparks, fades over 1.8 s, and pops.
- **Deck Fountain** (`fountain`, optional v2). It sits on the deck and sprays a cone of sparks 1.5 m high for 6 s, and it
  never leaves the deck. It uses the same particle pool with a different emitter.
- **Colour.** The spec `docs/specs/paint.md` defines `PALETTE` (seafoam `#9fd3c1`, coral `#e9a08c`, sunshell `#f1d78d`,
  lagoon `#86b3d6`, pebble `#c9c3b8`) and items `paint_<id>`. **`dist/paint.js` does not exist on this branch yet.** Recommendation:
  - v1: the rocket stores an optional colour index on its decor entry. With no paint, the burst is a cheerful mix of the five
    palette colours, boosted to be bright and saturated at night. Never import `paint.js`. Copy the five hexes, as audio.js does with `NOTE_HZ`.
  - v2, once paint lands: hold a paint pot and click a placed rocket to tint it (one pot), and the rocket burst then uses that one colour.
    However, `cleanWorld` keeps only `type,x,z,rot` on decor entries (see the rain spec, section 3, and game.js:179), so a
    tint has to live in `world.ext.fireworks = {c:{"x,z":idx}}`, not on the decor entry.
- **Achievement idea.** Add `firework1` "Sky Sparkle" ("Launch your first sky rocket") to `ACHIEVEMENTS` (logbook.js:27),
  add a `case 'firework1': return ev.kind === 'firework';` to `evaluate()` (logbook.js:73), and have the host call `award({kind:'firework'})`.
  `cleanProgress` filters ids against `ACHIEVEMENT_IDS` (logbook.js:52), so old builds just drop the id.

## 3. How the code can host it
**Recommended shape: a content module** `dist/fireworks.js` (with a pure top half for tests), plus `dist/fireworks-model.js`
(THREE only, given `T`). It is modelled on `dist/bees.js`, which is the closest template: placeable decor from the items.js
catalogue, `decorModel`, `interact`, `prompt`, a host `action` with a reach check, and `debug.place`.

| Need | Hook (file:line) | Notes |
|---|---|---|
| Item and recipe | `dist/items.js` decor block near `candle` (:183) | `item('skyrocket','Sky Rocket','decor',{placeable:true, iconTint:'#e9a08c', recipe:hand({...},2), unlock:discover(...), tip})`. `PLACEABLE_IDS` (:215) feeds `DECOR_TYPES` (game.js:68) automatically. Add `skyrocket:.1` to `BLOCK_RADII` (:218). |
| Craft book | `dist/craft-book.js` `CATEGORY_OF` (:14), `ITEM_TEXT` (:29) | `skyrocket:'survival'` plus a desc/use line. Do not use content-items.js, because the Tinker's Desk ignores catalogue ids. |
| Icon | `dist/item-svg.js` `ITEM_ICONS` (:10) | An original 48x48 icon: a striped tube, a cone cap and a little star. |
| Register module | `dist/content.js:31` `FEATURES` | Append `createFireworks` **after** `createDayNight`, so its `update` runs after day/night has written the lights for this frame. |
| Model | module `decorModel(type)`, called from `rebuildRaft` (game.js:525) | `rebuildRaft` tries `prog?.modelFor` first, then `content?.decorModel`. The model origin is the deck top, the size is about 0.15 x 0.5 m, and it uses a few MeshStandardMaterials. |
| E to light | module `interact(aim)`, called from `interact()` (game.js:984) | Copy `target(aim)` from bees.js:116, matching `d.type==='skyrocket'`. It calls `ctx.action({kind:'fw.light', x, z})` and returns true. |
| Prompt | module `prompt(aim)`, called from `updateContext` (game.js:589) | `<kbd>E</kbd>Light the sky rocket`, and by day `… (best after dark)`. |
| Host action | module `action(a, actor, bag)`, called from `applyAction` (game.js:951) | Validate `a.kind==='fw.light'`, int x/z, a pose within reach (`actor==='guest' ? ctx.other : ctx.physics`), and that the decor at the tile is `skyrocket`. Then splice it from `ctx.world.decor`, call `ctx.rebuildRaft()`, and emit the launch to `'all'`. |
| Broadcast | `emit(e,'all')` (game.js:796) → `effect(e)` (game.js:800) on both peers | `effect` has no generic module hook. Unknown kinds fall through to `notice(e.text)` and `play('deny')` (game.js:807). Add one line after :803: `if (content?.effect?.(e)) return; // [fireworks]`, plus an `effect` fan-out in content.js (like `interact`). |
| Per-frame FX | module `update(dt)`, called from `frame()` (game.js:1284) | Particles run on the GPU. `update` writes only a few uniforms and the per-rocket state. |
| Night level | daynight returns getters `wind`/`rain` (daynight.js:680) | Add `get night() { return L.nightFactor; }` and a `content.night()` accessor next to `rain()` (content.js:61), using the same pattern. With `?daynight=off` it reads 0, so treat it as day. |
| Sound | `dist/audio.js` | `play()` only knows `EVENTS` (:23). Add a `fx(name, s)` with private `FX` recipes, or add `whistle`/`pop`/`crackle` to `EVENTS` + `MIN_GAP` (:31) + `recipes` (:250). The content ctx (game.js:375) has **no audio**, so add `play:(ev,s)=>play(ev,s)` to `contentCtx`. |
| Tests | `tests/bees.test.mjs`, `tests/instruments.test.mjs` | Copy their stub-host and `RAFT_DIST` idioms. |

**Why not a transient `{type:'inst'}`-style message?** instruments.js (:141-164) sends a peer-to-peer note with no world
state, and the receiver only plays it. A rocket is different: it is **consumed decor**, so the launch must go through the host
(`ctx.action`) and come back with `emit(...,'all')`. That way both peers see it exactly once and the decor removal syncs through `hostState().world.decor` (game.js:1266).
The instruments code is still the template for **receive-side hygiene**. Use a validator like `cleanNoteMsg` (instruments.js:24) for the
effect payload `{kind:'fw', x, z, c, s}` (x/z ints, `c` a colour index in 0..5, `s` a uint32 seed), and a `windowGate` (:51) such as 6 bursts/s, so a
flood cannot spawn unbounded FX. Use the same seed on both peers so the burst shapes match. Use the module's own LCG, never `Math.random`, in the pure half.

**Sound recipes (no assets).** They use the existing `tone`/`burst` helpers (audio.js:214-227) on `newVoice(graph.effects)`, so the
effects slider, mute and the underwater low-pass all apply.
- whistle: `tone('sine', 900, .08s, .02, 1.0, 2400)`, a rising glide, plus a quiet `burst('bandpass', 3000, 2, .03s, .02, .9)` hiss.
- pop: `burst('lowpass', 700, .8, .5s, .001, .12)` + `tone('sine', 110, .35s, .002, .25, 55)`. Keep it soft and round, never a bang.
- crackle: 6-10 tiny `burst('highpass', 4000-6000, 1, .04s, .001, .03)` staggered over .2-.9 s (like `drops()` at :243).
- Gotchas: the shared noise buffer is 1.5 s (audio.js:95), so any single noise segment longer than about 1.4 s plays from offset 0.
  Keep each burst short and repeat it instead. The master chain has a 6.5 kHz low-pass (:85), so a whistle above about 5 kHz dulls.
  Scale remote launches by distance with `distanceGain` (instruments.js:62) or something like it, with a longer range (about 80 m) because the burst is in the sky.

**Cheap particles.** Use one `T.Points` per **pool**, created once with a fixed `BufferGeometry` of N vertices. Per-vertex attributes are
`aDir` (vec3 unit), `aSpeed`, `aColor` (vec3), `aSlot` (the rocket slot index, float), and a `ShaderMaterial`
(additive blending, `depthWrite:false`, `transparent`, `fog:false`, `toneMapped:false`) the same as the stars (daynight.js:342).
- The uniforms are small arrays per slot: `uOrigin[S]` (vec3 burst point), `uAge[S]` (float, <0 means hidden). The vertex shader computes
  `p = origin + dir*speed*(1-exp(-2.5*age)) + vec3(0,-1.2*age*age,0)` for drag and gravity, and sets `gl_PointSize` from the distance, fading by age.
  The CPU writes only `S` vec3 and `S` float per frame, and **no attribute uploads after creation**.
- Recolouring a slot on launch means rewriting that slot's `aColor` range once (`addUpdateRange` + `needsUpdate`), which is the only upload. As an alternative,
  pass `uColor[S]` and keep a per-vertex brightness jitter, so nothing is uploaded at all.
- For the rising rocket and its trail, use one tiny shared mesh per slot (cone + emissive tip), pooled. You can skip the trail on `low`.
- Use `frustumCulled = false` (the bounds change) and `raycast = () => {}`. Keep everything out of `ctx.raft`, so `rebuildRaft`, lantern scans
  (`lanternSignature`, daynight.js:406) and bees' `scanHives` are not disturbed. Add it to `ctx.scene`.
- Budget by the graphics preset (`ctx.options.graphics`, as with `poolCap` at daynight.js:10): `low` 2 slots x 60 sparks, `medium` 3 x 120,
  `high` 4 x 160. That is at most 640 points, a single draw call, and well under the 1600 stars. When all slots are busy, recycle the oldest.

**"Lights the night sky briefly".** Do **not** add a PointLight per burst. Changing the light count recompiles every lit material
(see the pool comment at daynight.js:373 and `warmShaders` at game.js:508). The options are:
1. Bump `ctx.hemi.intensity` (and optionally lerp `hemi.color` toward the burst colour) by `+0.35*flash*night` after day/night
   has written it. Day/night rewrites hemi every frame (daynight.js:500-503), so there is no drift. With `?daynight=off` nothing rewrites it,
   so keep the base value and restore it yourself.
2. Optionally, a large additive sky-glow sprite at the burst point (the same pool, 1 quad per slot). This works on every preset and costs one draw call.
Keep the flash low (≤ 0.4 s attack, 0.8 s decay). Avoid any strobe: at most one flash peak per 0.5 s, whatever the number of rockets (accessibility).

## 4. Risks
- **Performance.** Points with additive blending fill-rate on big near sprites, so clamp `gl_PointSize` (max about 24 px at dpr 1). The quality
  ladder (quality.js:27) lowers the pixel ratio when frames are slow, which helps. No allocation in `update` (the content.js header rule).
  Lighting 20 rockets in a row is bounded by slots + `windowGate`. Measure `renderInfo()` (daynight.js:668) in QA.
- **Co-op.** A guest press sends `fw.light` through `ctx.action`, and only the host removes the decor, so a double press or both players pressing at once
  launches once (the second action finds no rocket). The guest should predict nothing (or show only a local fuse fizz) and wait for the effect.
  `effect` is the only path for the guest, and an old host ignores `fw.light`, so nothing happens and nothing is lost. An old peer receiving
  `{kind:'fw'}` shows `notice(e.text)` if text is set, so **omit `text`** (or keep it friendly, e.g. "Whee!"). The burst point is
  world space: rockets rise from `raft.localToWorld(tile)`, so they still sit correctly while sailing moves the raft.
- **Saves.** An unlit rocket is ordinary decor (`{type,x,z,rot}`), so it saves, syncs and validates through `cleanWorld` with no new code. An older build
  drops unknown decor types and resets a bag that holds `skyrocket`. This is the same known limitation as the rain and instruments specs, so say so in the PR. Lit
  rockets are transient: no save state, and a reload mid-flight just loses the show. There is **no decor pick-up** in the engine today (no
  `decor.splice` outside this feature), so lighting is the only way to remove a rocket. That is fine, and the prompt should say so.
- **Night gating.** Allow launches by day too (cozy: never refuse). By day just skip the hemi flash and halve the glow.
- **Input conflicts.** E is shared: `interact()` handles sailing, then pick-up, then `content.interact` (game.js:975-984). Keep the aim cone tight (bees uses 0.85 m).
  The rocket's small `BLOCK_RADII` keeps it from blocking walking.
