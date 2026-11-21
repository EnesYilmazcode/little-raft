# Headlamp (research)

Round loop-features-202611210949. Anchors are `dist/` files on the current tree (three.js r170,
dist/vendor/three.module.js:6). Earlier notes: docs/features/nightlight-research.md (headlamp was listed there
as a stretch goal: "same pool slot ... never a SpotLight").

## 1. How Raft's headlight works (generic mechanics, own words)

- A crafted piece of equipment, made at a workbench tier from metal, copper and a bit of electronics.
- Worn in a head equipment slot, separate from the hotbar, so both hands stay free for tools.
- When on, it throws a narrow forward cone that follows your view: useful on deck at night and in murky dives.
- Powered by batteries that drain while on; empty means dark until you swap or recharge. Has durability.
- Toggled with a key; other players see your beam.
- Takeaway for us: wearable, hands-free, follows the view, partner can see it. Batteries and wear are the chore
  part, and we drop them (section 4).

## 2. How Little Raft handles gear and lights today

### Gear is "works while it is in your bag"
- Diving gear has no equip slot: `GEAR_IDS ['fins','airjug','goggles','scraper']`, bit i = id i
  (diving-gear-core.js:4). `gearMask(count)` sets a bit when the bag count is > 0 (:13-22). `applyGear` multiplies
  DiveMods (:25-34).
- The runtime polls the bag every 0.25 s (diving-gear.js:57-58). It feeds `content.diveMods` (:61) and shows HUD
  chips while underwater (:41-47). It keeps no saved state ("gear lives in the Bag", :2), and guests get nothing
  from `debug.give` (:67).
- The items are content-fleet kinds with `maxStack: 1, tool: false` (content-items.js:50-52). Recipes:
  goggles `{glass 2, rope 1, leaf 1}` (content-items.js:123-125).
- armor.js is tile armor, not player armor. It lives in the sparse world field `world.tileArmor {"x,z":1}`, which
  `cleanTileArmor` cleans on load (armor.js:9-10, :27-37). Nothing in it is wearable, so it gives no equip-slot
  pattern to copy. The bag-presence model from diving gear is the house style.

### Co-op pose and held bits
- Pose flags: `1 swimming | 2 grounded | 4 reeling | 8 riding | 16 seated`. Old peers ignore unknown bits
  (coop.js:30-32). The sender is `poseFlags(l)` in `snapshot()` (coop.js:154), and the receiver is `readFlags`
  in `onPose` (coop.js:143).
- The held item is sent as `h`, an index into the append-only `HELD` list (coop.js:27-28, :155). The local pose
  comes from `coopContext().local` (game.js:2193).
- The remote avatar takes `s = {..., held, ...}` (coop-avatar.js:5). Held props are cached low-poly models with a
  shared emissive `glow` material (coop-avatar.js:41). It swaps them on `s.held` (:220-221). The name tag is a
  Sprite (:169-170). The avatar is built lazily on the first hello (coop.js:52-58).

### Lights: the lantern pool
- There is no held-lantern light. 'lantern' in HELD (coop.js:27) is only the decor prop in the hand. The
  nightlight spec proposed a Hand Lantern, but it is not on this tree.
- The pool has `POOL_LIGHTS = 4` and `POOL_CAP {low 1, medium 2, high 4}` (daynight.js:9-11), with
  `POOL_PEAK 2.8, POOL_RANGE 4.5` (:281). The 4 PointLights are built once with `castShadow=false` and
  decay 2 (:406-413).
- **The pool is only added to the scene once a lantern exists** (`poolWanted`, :487). After that the count
  changes only with the graphics preset (`sizePool`, :422-429). A light that is off gets intensity 0 and stays
  in the scene (:667).
- The nearest lit lanterns are ranked every 0.5 s (`rankLanterns`, :490-503; :660-661). Positions are
  raft-local, converted with `raft.localToWorld` (:668-669). Night intensity `poolI` is in :597, and the
  `state().poolLit` debug field in :775.
- Glow meshes are found by name: `LANTERN_PARTS ['lanternGlow','flame','lanternGlass','candle']` (:271). Power
  lamps reuse the pool (`noPool` for string lights, :481/:487; LOG.md:905 "No new PointLights").
- Perf history: idle pool lights at intensity 0 still cost every lit shader, so they now join the scene only
  when needed (LOG.md:45, :198). The grill's own PointLight still changes the light count
  (cooking.js:313, LOG.md:1196). It is the anti-pattern here.
- Warm-up: `warmShaders()` runs `compileAsync(scene, camera)` once after settings (game.js:625-630, :2560).
  `warmKinds()` compiles again whenever a new kind enters the bag (game.js:634-643, every frame at :1854).
  LOG.md:1173 says the warm-up also compiles the lantern-light variants. **I could not find that code on this
  tree** (grep compile/variant), so treat the pool's first attach as an unwarmed compile.
- quality.js:42-50 toggles shadows without changing the program key. The same rule applies here: never flip
  `castShadow` or `visible` on a light at runtime.
- The camera is in the scene (game.js:480), and hands are parented to it (game.js:609). A light child of the
  camera works.
- Underwater: underwater-fx.js darkens by depth fog (`depth/DEEP_AT`, :171) with no night term. The tree has no
  shipwreck files (`ls dist | grep -i wreck` is empty), so "dark dives" today means deep fog only. treasure.js
  is the nearest dive content.

## 3. Lighting without changing the light count

The three.js r170 program key includes `numPointLights` and `numSpotLights` (plus spot map and shadow counts).
Lights with `visible=false` are skipped when lights are counted. So adding or removing a SpotLight, or toggling
its `visible`, recompiles every lit material. Intensity 0 does not.

Options:
1. **(Recommended) Borrow a pool PointLight.** Add an optional "player light" input to daynight, for example
   `ctx.headlamp?.() -> {on, x, y, z}` or a `content.night` hook. When on, it takes pool slot 0 ahead of the
   ranked lanterns. Do not place the light on the eye. Put it where the view ray hits the deck, island or
   seafloor, clamped to 1.5-4 m, and lift it 0.3 m. This gives a soft "you look, it lights" puddle, with no
   SpotLight and no new count. Use a cool white colour (`#fff1d6`), a smaller range (≈3.5) and a little less
   intensity than a lantern, with no flicker. Ease the position over about 80 ms so it does not jitter.
   - **Keep the count fixed.** Owning a headlamp (`gearMask` bit) must set `poolWanted` just as a lantern
     does. The pool then attaches when the item enters the bag. The `warmKinds()` compile that runs for the
     new kind (game.js:642) warms the pooled-light programs, but only if the attach happens before that
     compile. Pin this in a test: own headlamp → `poolOn > 0` before the first toggle.
   - On graphics 'low' (cap 1), the headlamp takes the only pool light while on, so lanterns fall back to
     emissive glow. That is acceptable, but say so in the spec.
   - Night gate: daynight already zeroes the pool below `nf < 0.15` (:597). Underwater, use a separate gate
     (depth > ~4 m) so deep dives light up by day as well.
2. A permanent SpotLight child of the camera at intensity 0. It is simple, but it adds a light to every lit
   shader all the time, which is the LOG.md:45 regression (−15%). Reject it.
3. No light at all: an additive cone mesh only. It is cheap but does not light the deck, so it fails the
   feature's purpose for the local player.

**Underwater bonus (no light):** while the lamp is on and underwater, add `fog ×1.25` through `diveMods`, the
same path the goggles use (diving-gear.js:61; underwater-fx fogMul). Multipliers stack.

**Partner's headlamp in co-op (no real light):**
- Add a new pose flag bit `32 = headlamp lit` in `poseFlags`/`readFlags` (coop.js:31-32). Old peers ignore
  unknown bits (:30), so old peers just see no beam. Nothing new goes in HELD, because the lamp is worn, not
  held.
- The remote avatar gets a small lamp on the head band: a `glow` sphere (reuse `K.glow`). Add an additive cone
  as well: an open `ConeGeometry(0.9, 4, 12, 1, true)` with `MeshBasicMaterial({transparent, opacity .12,
  blending Additive, depthWrite false, side DoubleSide, toneMapped false, fog true})`, pointed along yaw/pitch.
  An optional soft radial-gradient Sprite can mark the end-point puddle. That is 2-3 draw calls and no lights.
  The cooking.js:306 flame material is the template.
- Build the cone with the avatar (lazy) and set it visible on the first `compileAsync`. This follows the
  fireworks.js:103 pattern of "created visible so the warm-up compiles it", then hide it.
- Optional: a partner who wants their beam to light your deck could take the second pool slot when
  `cap ≥ 2`. Leave this out of v1.

## 4. Recommended original take: "Glowband"

- **Item:** `glowband`, "Glowband": a rope headband with a little seaglass bulb that glows warm-white. It is a
  content-fleet kind like the goggles, with `maxStack 1, tool:false`, and it works while in the bag. Add it to
  diving-gear `GEAR_IDS` **at the end** (bit 4), because the order is the bit format. Alternatively give it its
  own tiny module `headlamp.js` and reuse `gearMask`-style polling. A separate module is cleaner, because the
  lamp also works on deck.
- **Recipe** (hand craft, existing items): `{ glass: 1, copperingot: 1, rope: 2 }`. The glass makes the bulb,
  the copper the wire, the rope the band. It unlocks with `research('glass','copperingot')` like Binoculars and
  String Lights (items.js:183-185, :267-269). It costs less than Binoculars, so the player gets it around the
  first night dives.
- **Toggle key:** `F` ("lamp"). It is unbound (grep: E G I J L N P Q R X Z are taken; L is the logbook,
  logbook-ui.js:266). Add it to input-map.js ACTIONS (`headlamp`, group Actions) so it can be rebound and
  appears in the controls tab, and use a gamepad d-pad direction if one is free. A click sound and a feed line
  ("Glowband on") are enough feedback. When it is on but daylight hides it, it still glows faintly.
- **No battery (friendly).** The lamp never drains or breaks. power.js batteries are placed tiles with
  host-authoritative charge (power.js:2-9, :83), and tying a worn lamp to them adds a chore and a co-op sync
  path. For flavour text: "charged by sunshine, glows all night".
- **Auto-on option:** default to manual. Offer a setting "Glowband turns on at dusk and in deep water", off by
  default.
- **Save fields and backward compatibility:**
  - The item lives in the bag, so inventory snapshots already save it. Old saves have none, and that needs no
    migration.
  - The on/off state is a per-player preference: localStorage `little-raft-glowband` = '1'/'0' in
    try/catch, default on once owned. No world field and no `world.ext` slice, so the host has no authority
    or cleaner to write.
  - Co-op uses only pose bit 32, so old peers are unaffected and an old peer's avatar shows no beam. A guest's
  lamp is purely local plus that bit.
  - Craft-book entry (craft-book.js) and icon (`icon-glowband` in icons.svg/item-svg.js).
- **Tests:** a pure core (`headlampTarget(eye, dir, hitDist) -> clamped point`, `lampOn(owned, pref, nf,
  depth)`) under tests/. A daynight test that pool count is unchanged when toggling. Round-trip and
  old-peer-ignores-bit tests for flag 32. A recipe test.
- **Risks:** the first attach of the pool is not warmed if it happens after the kind's compile. On low
  graphics the lamp steals the only lantern light. Hit-point jitter on wave-tilted decks needs smoothing.
