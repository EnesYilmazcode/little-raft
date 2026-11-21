# Night light: Hand Lantern + Firefly Jar (research)

Round loop-features-202611210855. All anchors are `dist/` files on the current tree (base 16aedaa).

## (a) Genre patterns

- **Flashlight with batteries** (survival sandboxes): a held tool with a cone light; batteries drain and are a
  chore. Darkness becomes a punishment. Not right for a no-damage, no-hunger game.
- **Headlamp / helmet lamp**: a wearable slot that lights where you look, so both hands stay free. Usually a
  SpotLight; often fuel or charge again.
- **Hand lantern / torch**: held in the off hand, a warm omni light around the player. Some games let you
  hang it on a hook. Reads cosy, matches our existing placed Lantern.
- **Glowing decor**: jars of bugs, glow mushrooms, paper lanterns. Pure mood, often caught at dusk with a net
  or bare hands; the catch itself is a small ritual.
- **Co-op**: in most games the partner's flashlight is visible to you; it is how you find each other at night.

### Cosy original take for Little Raft

1. **Hand Lantern** (held item, stack 1, `category: 'tool'`, no durability, no fuel; like Binoculars at
   items.js:160). Hold it in the hotbar at night: a warm pool lights the deck around you. By day it is just a
   prop (light off, glass still faintly lit). Recipe idea: `wood 1, scrap 2, rope 1` (cheaper than nothing,
   fits the "lantern" family). Left-fist carry like decor, but NOT placeable (do not add to PLACEABLE_KINDS).
2. **Headlamp toggle** (optional stretch): a one-off "Headband Lamp" you craft once; a key (e.g. `L`) toggles
   it and it works with any held item. Implement as the same pool slot positioned 0.35 m in front of the eye,
   never a SpotLight (see risks). Recommend shipping the Hand Lantern first, headlamp as a later toggle.
3. **Firefly Jar** (placeable decor, CONTENT_DECOR type `fireflyjar`). Two routes:
   - Catch: at dusk/night (DAYNIGHT_LIVE.phase, daynight.js:32) near an island (`islandNow()`, islands.js:41)
     a small swarm of emissive points hovers over the shore; press E while holding an empty Cup or Jar to
     catch fireflies -> `fireflyjar` item. No fail state, swarm refills.
   - Craft: `glass 1, leaf 1` + "fireflies" from the catch, or a plain recipe for players who skip islands.
   Placed, it glows green-gold with a soft bob of 5-8 tiny instanced dots inside the jar; it joins the lantern
   pool so it lights the deck at night.
4. **Co-op**: the partner's Hand Lantern glows on their avatar and lights the deck around them, derived
   locally from the synced `held` kind (no new net fields). Release the fireflies (E on a placed jar) is a
   nice shared moment: host spawns a short-lived swarm visual synced via ext.

## (b) Code anchors

### Night darkness and the lantern light pool (daynight.js)
- Constants: `POOL_LIGHTS = 4`, `POOL_CAP {low:1, medium:2, high:4}`, `poolCap()` daynight.js:9-11;
  `POOL_PEAK = 2.8, POOL_RANGE = 4.5` :265; night curve `lightAt()` :48-56 (`NIGHT_FLOOR .38` :7).
- Glow parts recognised by mesh name: `LANTERN_PARTS ['lanternGlow','flame','lanternGlass','candle']` and
  multipliers :256-257; `MAX_LANTERNS = 64` :259.
- **Pool construction** :386-410: 4 PointLights built once (`castShadow = false`, decay 2), but added to the
  scene only when the first lantern is found (`poolWanted`), and the count changes only with the graphics
  setting (`sizePool()` :402-410). Comment :386-388 states the rule: never change the light count over time,
  intensity 0 instead of removing. This is what avoids shader recompiles.
- Scan: `lanternSignature()` :419-430 counts decor `lantern`/`candle`; `scanLanterns()` :432-463 walks raft
  children named `craft_lantern` or `craft_candle` (:437) and places the pool at the `lanternGlow` mesh's
  bounding-sphere centre (:448-455), fallback +1.24 m (:456).
- Ranking: `rankLanterns()` :465-478, nearest N to the camera, every 0.5 s (:608-609).
- Per frame: night intensity `poolI` :557; pool positions/flicker :611-620 (raft-local -> world via
  `raft.localToWorld`). Emissive night boost :599-606. Debug `giveLantern/placeLantern/state().poolLit`
  :712-721. Cleanup :691.
- Shadows: one shadow light only, the sun/moon swap (:262-264, `SWAP_FADE`). Pool lights never cast shadows.

### Prior art for glow
- Beeswax candle: bees-model.js:148-175 names its meshes `candle`/`flame`/`lanternGlow` so daynight lights it;
  note the bounding-sphere centre lift :163-166 (a pool light at 0.14 m blew the floor out white). The candle
  group name `craft_candle` was added to the scan with `[bees]` tags (daynight.js:422, :437).
- Glass Lantern: kiln-model.js:121-147 reuses the name `craft_lantern` so it is lit for free; clones the
  glass/glow materials per instance because daynight scales base emissive per material (:142).
- Grill: cooking.js:311-312 has an opt-in PointLight per grill, but no caller passes `{light:true}`
  (fishing-cooking.js:62) - a per-object light was deliberately avoided.
- Power chain: not on master (no power module in dist/); do not depend on it.

### quality.js
- There are no light-count limits here; it only steps pixel ratio and sun shadows (levels quality.js:31-36,
  presets :6-8, `sun.castShadow` toggle :76-85). The light budget lives in daynight `POOL_CAP` keyed by
  `ctx.options.graphics`. Renderer: PCFSoftShadowMap, ACES (game.js:440), hemi + sun (game.js:441-442).
  `raftDebug` perf exposes `programs` count (game.js:2087), handy for a recompile test.

### Held items and viewmodels
- `DECOR_KINDS`, `PLACEABLE_KINDS`, `TOOL_KINDS` held-items.js:21-25; `HOLD` table :32-53 (hand, pose, rot);
  `holdFor()` :54; `SIZE` :58; `buildItemModel()` :221 (factory fallback + generic bundle).
- hands.js: API header :1-19; left-fist decor holder :299-308; `mountFor()` builds/caches per kind :312-.
  A held lantern model needs its own emissive glass; give it its own material (hands merges by material,
  hands.js:56-75) and make daynight ignore it (it only scans raft children, so it already does).
- game.js: `heldKind()` :362 (via `toolRole`), viewmodel `hands.setHeld(vmKind)` :1448, content
  `use(aim, kind)` hook on left click :1274.
- items.js: schema :8-33; `tool` = durability items only (:17), stack forced to 1 for tools (:67); held
  "forever" tools like Binoculars/instruments/Finder use `category:'tool', stack:1` without `tool:true`
  (:160-172). Candle `decor` :202-204, Lantern :208-210, decor weights :241-243. Progression owns crafting UI.
- content-items.js: `CONTENT_DECOR` :78 (add `fireflyjar`), egglamp recipe precedent :62-65. game.js
  `DECOR_TYPES` merges CONTENT_DECOR and PLACEABLE_IDS :75.

### Avatars and co-op
- avatar.js `setHeld(kind)` :249-256 builds a third-person model per kind via `BUILD[kind]`.
- coop-avatar.js held models :31-135 (own low-poly), swap :204-206, held tip world pos :269.
- coop.js `HELD` :27-28 is the wire format, **append only** (index sent as `h`, :139, :151). A new
  `handlantern` kind must be appended or the partner sees nothing. Legacy pose path game.js:232/1575 sends
  `held` as a string (<=16 chars).
- Host state reaches guests ~8x/s; the light itself needs no sync: every peer derives it from the held kind.

### Content hooks and prompts
- content.js module shape :7-31 (`use`, `interact`, `prompt`, `decorModel`, `debug`), FEATURES list :47,
  sibling `peek` :75. `islandNow()` islands.js:36-41 (import with the same `?build=` specifier).
- Prompts: content prompts are already bridged into `#lrPrompt` via `raftPrompts.provide({id:'content'})`
  (game.js:732-735, `promptParts` content.js:55-67). A module prompt() is enough; add an own provider only for
  prompts not tied to aim (e.g. "Fireflies nearby").

## (c) Risks

- **Shader recompiles**: three.js bakes the number of point lights into every lit program. Adding/removing a
  PointLight, toggling `castShadow`, or adding a first SpotLight recompiles all materials (visible hitch,
  seconds on phones). Rule: no new Light objects. Feed the carried lantern, the partner's lantern and the
  jars into the existing daynight pool as extra candidates (e.g. a small `extraLights` registry exported from
  daynight.js, ranked with placed lanterns), and set `poolWanted = true` at module start or first night so the
  pool attaches once. Keep `castShadow = false`. Test: `programs` count unchanged when equipping at night.
- **Pool starvation**: on `low` there is 1 pool light. The carried lantern should win slot 0 while held
  (player-relative light matters most), placed lanterns get the rest; on low the deck lanterns then show only
  their emissive glow. Accept and document.
- **Phones**: fireflies as one `Points`/InstancedMesh with an unlit additive material (no lights), <=40 points,
  updated only when near an island at night; jars use emissive meshes, not lights of their own.
- **Viewmodel blowout**: the light at the hand would wash out the viewmodel and the first-person camera;
  place it ~0.4 m above/ahead of the hand and cap intensity below `POOL_PEAK`, like the candle lift.
- **Co-op**: forgetting the `HELD` append (coop.js:27) means guests never see the lantern; catching fireflies
  must be a host action (`ctx.action`), grant via actorBag; swarm state cheap in `load(...,'net')`.
- **Saves**: new item ids only; `load(undefined)` defaults; `?daynight=off` (`createDayNightOff` :280) must
  still work: no light at all, no errors.
- **Name clash**: do not reuse 'Raft' commercial names; "Hand Lantern"/"Firefly Jar" are generic.
