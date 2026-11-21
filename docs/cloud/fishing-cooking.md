# Lane: Fishing & Cooking

Raft-style rod fishing and grill cooking for Little Raft, done the friendly way. There is no hunger, so food
is a collection: a fish journal with species and size records, a cookbook of dishes, and a basket of your catch.
All art is original and procedural, with no textures and no new npm dependencies.

## Playing it

| Input | What it does |
|---|---|
| Hold the rod (craft a **Fishing Rod**), hold click, release | **Charged cast.** Longer charge throws farther (4–18 m) and slightly improves rare odds. |
| Wait | The bobber rides the real waves. A fish may **nibble** (small dips) first. Clicking now is too early and the fish swims off. |
| Bobber **dunks** + splash + beep | **Bite.** Click within about 1.1 s. Miss once and the fish comes back; miss twice and it leaves. |
| Hold click while reeling | **Reel minigame.** Progress fills while you hold. The fish pulls in bursts and tension rises. Ease off when the bar goes red, or the line slips. Nothing is lost; you just recast. |
| Catch | The fish is shown **in hand** for about 2 s, with a caption (`Mackerel · 31.4 cm ★★☆`) and a toast (`New species!` / `New record!`). |
| **G** looking at a free raft tile | **Place a grill** (4 wood + 2 scrap, max 6, not on decor). |
| **E** at a grill | Context action in priority order: take a finished dish → add wood → grill your newest raw fish → status. |
| **J** | **Fisher's notebook**: Fish / Cookbook / Basket tabs, with a "n / 8 species" progress line. |

There are eight species: Herring, Pomfret and Tilapia (common), Mackerel and Catfish (uncommon), Salmon and
Tuna (rare), and the original legendary **Golden Sunscale**. Each has a size range, star grade, fight
strength, bite timing, a time of day it prefers (flavour for now, since there is no day/night cycle) and its
own procedural model.

Grilling: 1 wood gives 45 s of fire (up to 4 wood). Cook time is about 22 s plus a little more for bigger
fish. There are 2 slots per grill, with visible flames and pooled smoke. Food left on for 20 s after it is
done becomes a funny "Charred X" journal entry; nothing is wasted or harmful. The fire only burns fuel while
something is cooking, plus 10 s of idle afterwards.

## Files (all new)

| File | Role |
|---|---|
| `dist/fish-species.js` | Pure. Species table, rarity, `rollCatch`, `biteDelay`, `dishName`. |
| `dist/fishing-v2.js` | Pure `FishingSession` state machine (charge → fly → wait → nibble → bite → reel → caught/escaped) plus `createFishingV2` visuals: bobber, sagging line, splash rings, reel/charge HUD. |
| `dist/fish-models.js` | Procedural low-poly fish (loft along X), raw/cooked/burnt states, tail wiggle, geometry/material cache. |
| `dist/cooking.js` | Pure `GrillState` (fuel, slots, cook/burn timers, snapshots) plus `createGrillModel` and `createSmoke` (one `THREE.Points`, pooled). |
| `dist/fish-journal.js` | Pure `Journal` (species records, dishes, basket) plus the `<dialog id="fcJournal">` notebook panel. |
| `dist/fishing-cooking.js` | Glue: input, grills on the raft, prompts, toasts/chip, save/load, co-op, `window.raftFC` debug handle. |
| `tests/fc-*.test.mjs` | Node tests for all of the above (`npm test`). |

## Hooks into existing files

Every line in `dist/game.js` is tagged `// [fishing-cooking]` (`grep -n "\[fishing-cooking\]" dist/game.js`):

1. `import { createFishingCooking } from './fishing-cooking.js'`
2. `let fc = null` next to the other engine state.
3. `init()` creates it after `buildViewmodels()` inside try/catch, so a lane failure never blocks the game.
4. `fcHost()` is the adapter object: scene, raft, ocean, camera, signal, rodModel, role/netReady/send/action,
   notice/beep, selectedKind, aim, rodTip, player, hasTile/decorAt, bagCount, running, uiBlocked, busy.
5. `frame()` calls `fc.update(dt, elapsed)` after `updateHook`. If it throws, fc is disposed and the old
   fishing comes back.
6. `updateCamera()` takes the rod-hands `reeling` pose from `fc.rodReeling`.
7. `updateContext()` uses `fc.prompt` as the crosshair hint (static markup built by the lane).
8. `interact()` (E): `fc.interact()` first, otherwise the inventory opens as before.
9. `applyAction()`: actions of kind `fc:*` go to `fc.applyAction(a, actor, bagApi)`, so the host stays
   authoritative over the bag.
10. Canvas `pointerdown` (both the locked and the lockFallback path) and `pointerup`: `fc.pointerDown()` and
    `fc.pointerUp()` consume the event only while the fishing rod is held.
11. PeerJS `data`: messages of `{type:'fc'}` go to `fc.onNet(msg, from)`.
12. `capture()` calls `fc.capture()`, which flushes the lane save before a hot swap. `dispose()` calls
    `fc.dispose()`.

13. `placementFor()` and the decor `build` action in `applyAction()` also refuse tiles with a grill (`fc.hasGrill(x, z)`).
14. The canvas `pointerdown` lockFallback path captures the pointer, so releasing off the canvas still ends a reel.

`package.json`: `npm test` now also runs `tests/fc-*.test.mjs`.

The legacy "click and wait" rod code in `useSelected` is left in place. It only runs if the lane module
failed to start.

## Save and co-op

- The lane saves to its own localStorage key, `little-raft-fc-v1` (`{v:1, journal, grills}`), every 3 s
  when dirty, on capture, on dispose and on `beforeunload`. The main save format is untouched.
- The journal is personal: each player keeps theirs in their own browser. Grills belong to the host's world.
  While you visit as a guest, your own grills are stashed and restored when you leave.
- The host is authoritative. Guests send `fc:placeGrill | fc:fuel | fc:cook | fc:take` through the normal
  `action()` channel. The host validates them, spends from the actor's bag, and broadcasts grill snapshots
  (`{type:'fc', grills}`) every 0.5 s and on change. A guest's taken dish comes back as `{type:'fc', took}`.
  A catch adds the classic bag `fish` item through the existing `{kind:'fish'}` action and sends
  `{type:'fc', catchFx}` so the friend gets a "Your friend caught a Salmon!" notice.

## Tests

`npm test` runs `survival.test.mjs` plus `fc-species-journal`, `fc-fishing` (stage machine and simulated
casual reel success per species), `fc-cooking` (fuel, timing, burn, snapshots, models construct/dispose
headless) and `fc-glue` (grill placement and costs, the full cook flow, save/load, guest snapshots,
forced catch).

Current total: 67 tests, all passing. `tests/fc-dom.test.mjs` runs the glue against a fake DOM to check that
hot-swapping keeps the styles.

## Review passes

- **Adversarial review** fixed 9 bugs, each with a regression test:
  - A role-switch race let the host's grills overwrite your own saved grills.
  - A hot swap removed the new engine's styles.
  - `rebuildRaft()` disposed the lane's GPU resources. Grills now live in the scene and follow the raft pose.
  - A full basket destroyed a dish you took.
  - A dialog opened mid-reel left the button held and snapped the line.
  - Junk or orphaned saved grills loaded.
  - Off-range basket sizes were lost on the grill.
  - `capture()` returned the wrong grills while you were a guest.
  - A test printed the whole scene graph when it failed and ran out of memory.
- **Perf review:**
  - Grill geometry and materials are shared and refcounted. The flames are one `InstancedMesh`, so a lit
    grill takes 4 draw calls (was 9).
  - With 6 lit grills, lane draw calls went from 85 to 55 and shadow draws from 54 to 12.
  - There is no PointLight, the per-frame work allocates nothing, and nothing is saved to localStorage
    while idle.
- **Visual QA** (`qa_scenario.py`, screenshots read by the agent):
  - The bobber now scales with distance and has a red cap, and the line sags less.
  - The reel HUD moved below the prompt.
  - The journal header was being hidden by the game's `body.playing header` rule; fixed.
  - J now releases pointer lock so the journal tabs can be clicked.
  - The held fish moved off the rod, and fish lie flat on the grate.
- **Lead fix:** cooking also uses up the classic bag `fish` item, so the hotbar fish and the basket stay in
  step.

## Screenshots

`docs/cloud/shots/fishing-cooking/` (in-game shots are from `qa_scenario.py`; rerun with
`PW_CHROMIUM=/opt/pw-browsers/chromium python3 docs/cloud/shots/fishing-cooking/qa_scenario.py`):

| Shot | Shows |
|---|---|
| `01-charging.png` | Charging a cast |
| `02-bobber.png` | Bobber on the waves |
| `03-bite.png` | The bite dunk |
| `04-reeling.png` | Reel HUD with tension in the red |
| `05-caught.png` | Mackerel in hand, with caption and toasts |
| `06-grill-cooking.png` | Two fish on a lit grill, with smoke |
| `07-cooked-burnt.png` | A cooked and a charred fish, with the E prompt |
| `08-journal-fish.png` | Journal, Fish tab |
| `09-journal-cookbook.png` | Journal, Cookbook tab |
| `10-grill-prompt.png` | E prompt at a grill |
| `fish-models.png` | All species and states |
| `grill-model.png` | Grill model |

The repo's `.gitignore` ignores `*.png`, so these were force-added.

## Known limits / follow-ups

- **Co-op trust:** the basket is personal, so the host cannot verify a guest's `fc:cook` fish. A modded guest
  could grill fish it never caught (cosmetic only). `catchFx` notices are not rate limited.
- **Outside this lane:** the fishing-rod hotbar slot uses the hook icon (inventory UI), and the left hand still
  holds the hook's rope coil while you fish (rod viewmodel in game.js).
- The bobber is still only about 5–6 px at full range at 720p. Smoke over charred food is a fairly heavy dark
  column; that is intentional as a warning but could be toned down.

- There is no day/night cycle yet, so `night:false` is passed and time of day only shifts the odds.
- The lane modules are imported without the `?build=` cache-bust query, so a live hot update reloads
  `game.js` but reuses the cached lane modules until a full page reload.
- When a guest catches a fish, the host's generic "You caught a fish!" notice can replace the species caption
  under the crosshair. The `#fcToast` still shows the species.
