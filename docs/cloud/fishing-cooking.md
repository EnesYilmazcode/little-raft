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

## Screenshots

`docs/cloud/shots/fishing-cooking/`: `fish-models.png` (all species and states), `grill-model.png`, and the
in-game scenario shots produced by `qa_scenario.py`.

## Known limits / follow-ups

- There is no day/night cycle yet, so `night:false` is passed and time of day only shifts the odds.
- The lane modules are imported without the `?build=` cache-bust query, so a live hot update reloads
  `game.js` but reuses the cached lane modules until a full page reload.
- When a guest catches a fish, the host's generic "You caught a fish!" notice can replace the species caption
  under the crosshair. The `#fcToast` still shows the species.
