# Diving lane: diving and underwater

A lean take on Raft-style diving with our own art. When oxygen runs out you
float back up, and if you are under the raft you drift out to open water first.
You also drown (3.5 HP/s of health) until you reach the surface.

Branch: `claude/raft-diving`. Interface spec: [diving-spec.md](diving-spec.md).

## What you can do

| Action | Key |
| --- | --- |
| Dive (while swimming at the surface) / swim down | **C** (not Ctrl, because Ctrl+W closes the tab) |
| Swim up / surface | **Space** |
| Swim where you look (pitch included) | **W A S D** |
| Swim faster | **Shift** |
| Gather the seafloor resource under the crosshair | **hold E**: 1.0 s, or 1.4 s for metal ore |

- **Oxygen:** 33 s underwater, like Raft (16.5 s while hunger or thirst is empty).
  It refills gradually, about 6x faster, at the surface. The bar sits bottom-centre, just above the
  hotbar. It only shows underwater or while refilling, and fades out once full.
  Below 25 % it pulses amber, not red. At 0 the diver rises at 3 m/s and the
  caption "Out of breath, floating up" appears, and you take 3.5 HP/s of drowning
  damage (game.js `hurtPlayer(hp, 'drown')` on the vitals bars, paid in 0.5 s chunks
  so the hurt vignette pulses) until you surface. The Breath Jug multiplies the base
  33 s (to 55 s); the starving half stacks on top. There are no game modes yet, so
  drowning always applies. Passing out underwater ends the dive on respawn with
  full lungs (`diving.reset()`).
- **Seafloor:** a procedural patch about 10–13 m deep under the raft. It rises
  smoothly toward the decorative islands, up to -0.9 m within r+40 m of each one.
  It has sand with vertex-colour patches, rocks with moss tops and swaying kelp
  tufts.
- **Resources:** each grid cell of 4 m has about a 22 % chance of a node, placed
  deterministically so host and guest see the same ones. Gathered nodes grow back
  after 120 s. The targeted node is slightly enlarged and pulses.
  - Sand: a gold pile with a ring, shells and pebbles. Gives `sand`.
  - Clay: an orange-brown lump. Gives `clay`.
  - Scrap: bent grey plates with a rusty edge and a painted stripe. Gives `scrap`.
  - Metal ore: a dark rock with ice-blue crystals. Gives `metalore`.
- **Underwater look:** this is one cheap overlay shader plus small extras, with no
  render targets or post passes.
  - **Fog:** depth-tinted teal fog, from `#2f9a98` at the surface to `#12505c` at
    10 m. The existing `THREE.Fog` is changed in place and restored exactly.
  - **Surface from below:** rippling, with a soft bright window overhead. Things
    above water still draw over it, so the raft hull and floating debris are
    visible from below. The raft also casts a dark silhouette onto it.
  - **Overlay:** one fullscreen-triangle shader with a tint gradient, vignette and
    faint moving light shafts.
  - **Caustics:** animated light lines on the floor, rocks, kelp and nodes, added
    through `onBeforeCompile`.
  - **Bubbles:** a single `THREE.Points` of up to 120 points. Breath bubbles rise
    from just below the eye; there is a burst when you go under and more when
    oxygen is low.
  - **Hidden underwater:** clouds, distant islands and the ocean mesh.
- **Sound:** `beep()` in game.js now goes through `diving.audioOut(ctx)`, a
  lowpass filter that drops to about 600 Hz underwater.

## Files (all new, except the small hooks listed below)

| File | Lines | What it holds |
| --- | --- | --- |
| `dist/diving.js` | ~310 | Controller. Constants in `DIVE`. `DiveBody` and `stepOxygen` are pure (no THREE or DOM). `createDiving` returns `move, update, render, warm, audioOut, onChange, markGathered, cancel, capture, state, dispose` |
| `dist/seafloor.js` | ~410 | Pure helpers `seafloorHeight`, `nodeAt`, `nodeById`, `NODE_LOOT`. `createSeafloor` builds the floor patch, rocks, kelp, node meshes and caustics |
| `dist/underwater-fx.js` | ~240 | Fog, surface from below, raft shadow, overlay shader, bubbles, shader pre-warm |
| `dist/diving-ui.js` | ~130 | Oxygen meter and gather ring (DOM with its own `<style id="divingStyle">`) |
| `tests/diving.test.mjs` | ~165 | node:test coverage of DiveBody, stepOxygen and the seafloor helpers |
| `tests/dive_shots.py` | ~45 | Headless screenshot run: surface, dive, floor, gather, under raft, surfacing |

## Hooks into existing files

All hooks are marked with a `// diving lane hook` comment.

- **`dist/game.js`**
  - **Imports:** `createDiving, DIVE` and `nodeById, NODE_LOOT`.
  - **Globals:** `diving`, `islands`, `aboveWater`, `gatheredIds`.
  - **`init()`:**
    - The decorative island and cloud loops push into `islands` and `aboveWater`.
    - `createDiving({..., restore: X?.dive, hideAbove: aboveWater, getTiles, getDeckY, onGather: id => action({kind:'gather', id})})`, then `diving.warm(renderer)`.
  - **`movePlayer`:** `diving.move(dt, physics, {forward, strafe, yaw, pitch, up, down, fast, gather})`. When it returns true, `physics.update` is skipped. This is needed because PlayerPhysics lifts anyone below the deck onto it.
  - **`frame()`:** `diving.update(dt, elapsed)` runs after `updateCamera`, and `diving.render(renderer)` runs after the main render.
  - **`applyAction`:** new `{kind:'gather', id}` case. The host validates the id with `nodeById`, checks the diver is within reach, refuses already-gathered nodes and adds the loot atomically. It then broadcasts `{kind:'gathered', id}` so every client hides the node.
  - **`effect()`:** handles `gathered`.
  - **`interact()`:** ignored while diving, because E is used for gathering.
  - **`beep()`:** routed through `diving.audioOut(audio)`.
  - **`validPose()`:** the y floor is lowered from -10 to -16, so guests on the seafloor keep a valid pose.
  - **`capture()`:** includes `dive` (oxygen and regrow timers) for hot swaps.
  - **`disposeScene()`:** calls `diving.dispose()` first.
  - **`raftDebug`:** `state.dive`, plus the test helpers `swimAt(x, z, pitch, yaw)`, `aim(pitch, yaw)` and `aimAtNode()`.
- **`dist/inventory-state.js`:** three new item kinds, `sand`, `clay` and `metalore`. They are placeholders with no sprite yet, so the inventory shows its lettered fallback icon.
- **`package.json`:** `npm test` also runs `tests/diving.test.mjs`.

### Hooks for other lanes

- **Audio:** route any sound through `diving.audioOut(ctx)` instead of
  `ctx.destination` to get the underwater muffle. You can also listen for
  `window` `raft:underwater` events (`detail: {underwater, depth, mount}`), or use
  `diving.onChange(fn)`.
- **Islands:** push `{x, z, r}` into `islands` before `createDiving` and the
  seafloor rises toward them. If islands come within reach of the raft, the
  diving area there becomes a shallow reef.
- **Things hidden underwater:** push any above-water-only Object3D into
  `aboveWater`.
- **Raft shadow:** the raft shadow reads `world.tiles`. Replace the array or
  change its length when tiles change.

## Tests

- `npm test` runs the survival suite plus the diving suite. All of it passes.
- Headless screenshots:
  `CHROME_PATH=/opt/pw-browsers/chromium python3 tests/dive_shots.py dist <outdir>`.
  `CHROME_PATH` is optional. Software GL runs at about 7 fps, so game time is
  slowed and the waits in the script allow for that. The run prints JSON with the
  dive state for each shot. The last run reached the floor, gathered a scrap node
  (`stock.scrap` went to 1), swam up under the raft and surfaced, with no page
  errors.

## Screenshots

These are in `docs/cloud/shots/diving/`, produced by `tests/dive_shots.py` on the final build:

- [01 surface swim](shots/diving/01-surface-swim.png): no oxygen bar above water.
- [02 just under](shots/diving/02-just-under.png): fog, caustics, raft and debris seen from below, oxygen bar.
- [03 looking up](shots/diving/03-looking-up.png): the surface from below with the bright window overhead.
- [04 near the floor](shots/diving/04-near-floor.png) and [05 floor forward](shots/diving/05-floor-forward.png): teal sand, caustic lines, kelp, rocks, nodes.
- [06 gathering](shots/diving/06-gathering.png): "Hold E · Scrap" ring filling. [07 after gather](shots/diving/07-after-gather.png): the node is gone and scrap is in the hotbar.
- [08 under the raft](shots/diving/08-under-raft-up.png): the raft hull overhead.
- [09 surfacing](shots/diving/09-surfacing.png): rising with the oxygen bar partly used.

## Reviews done

- **Research:** raft.wiki.gg was blocked by the network policy, so facts came
  from search snippets and guides. Raft's base oxygen is 33 s. Raft dives with
  Ctrl; we use C. Raft's resources sit on reefs near islands.
- **Design:** palette, node shapes, HUD placement and feel numbers, all applied.
- **Adversarial review, two passes.** Fixed:
  - duplicate loot on the host
  - guest pose dropped below -10
  - replacing the physics object mid-dive was ignored
  - a refused gather still hid the node
  - getting stuck under the raft with no oxygen
  - an fx failure leaving the underwater fog on
  - hot-swap state loss
- **Adversarial review, second pass.** Fixed:
  - an fx failure in render left the underwater look on
  - starting a dive near far tiles teleported you
  - an out-of-breath re-dive loop while holding C
  - a failed hot swap removed the old HUD
  - leftovers when building the controller partly failed
  - a ring flash with nothing gathered
  - an ambiguous mount id
  - nodes desyncing between host and guest: gathered nodes now use their own
    `{type:'gathered', id}` network message, which older clients ignore, and a
    stale request gets that message back
- **Performance:**
  - The seafloor is hidden and not updated above water, so draw calls above water match main.
  - Rebuilds take about 1.2 ms and happen on a 16 m recentre grid.
  - The island loop skips islands early.
  - Normals are computed analytically.
  - No per-frame allocations in the hot paths.
  - The underwater shaders are compiled ahead of the first dive.
- **Visual QA, two rounds of headless screenshots.** Fixed:
  - the raft was invisible from below
  - a horizon seam, caused by fog being mixed in before tone mapping
  - white dashes where the ocean mesh poked through the surface
  - an over-bright floor
  - unreadable sand nodes
  - oversized bubbles
  - a blown-out window overhead
  - the surface dropping out at yaw 45°
  - the gather ring sitting off the crosshair
- **Final polish:** a darker teal floor with visible caustics, and nodes scaled to
  about 0.5–0.9 m.

## Known limits

- **Above-water objects from just under the surface:** things above the water
  draw over the surface-from-below layer, so the raft's top and floating debris
  can be seen near the horizon. Real optics would hide them, but this keeps the
  raft readable, and the effect is mild.
- **Shallow reefs are out of reach:** the decorative islands are 65–90 m out, but
  the player is clamped to 50 m. Shallow reefs only become reachable when another
  lane makes islands reachable.
- **Gathering on a guest's screen:** when a guest gathers, their node only hides
  once the host confirms. During that time a 1.5 s pending guard stops repeat
  requests.
- **Crosshair offset:** the gather ring follows `#crosshair`. That element sits
  about 13 px off true centre because `style.css` (a -13px margin) and
  `graphics.css` (`translate(-50%,-50%)`) both shift it. This is outside this
  lane's files.
