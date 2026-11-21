# Onboarding and first hour (cloud lane)

Branch: `claude/raft-onboarding`. Goal: a new player learns to hook, craft, build, fish and plant **without any text in the centre of the screen**.

Supporting documents:
- [onboarding-research.md](onboarding-research.md): how Raft and similar games teach players.
- [onboarding-design.md](onboarding-design.md): the UX spec. Thresholds and chapter 3 order were tuned after the playtest; `STEPS` in `dist/onboarding.js` is the source of truth.
- [onboarding-audit.md](onboarding-audit.md): every centred or blocking piece of text in the codebase, with a replacement proposal.

## What was built

| Piece | Where | What it does |
|---|---|---|
| Title screen | `dist/onboarding.js` + `onboarding.css` | Logo top-left and a left-aligned menu bottom-left, over the existing slow orbit camera. **Continue** only appears when save `little-raft-v1` exists, with a `9 tiles · 2 fish` sub-line. **New Game** asks inline "Start over? Click again" for 4 s (no modal), wipes the save and onboarding progress, then reloads. **Play together** and **Settings** reuse the existing buttons. Arrow-key navigation, visible focus. `#solo`, `#welcomeCrew` and `#loadError` keep working. |
| Notes tracker | `dist/onboarding.js` | Top-right checklist in 3 chapters: *First Ten Minutes*, *Make Yourself at Home*, *A Home on the Water*. At most 3 active steps, with progress counts (`34/80°`, `2/6`) and key-glyph hints that name the real hotbar slot ("Press [6] to hold your hammer"). Finished steps get a check, a strike-through and a `✓` line in the feed. **N** collapses it. When everything is done it shrinks to a small "Notes" tab. While the bag is open it floats above the bag in the side gutter. |
| Prompt slot | `dist/prompts.js` + `prompts.css` | Key prompt just bottom-right of the crosshair (+34/+26 px), shown only when something is actionable: `E Pick up plank`, `HOLD [LMB] Reel in`, `LMB Build floor` with a cost line, `Aim at the raft edge`, `HOLD Space Climb aboard`, `Waiting for a bite…`, `LMB Place palm planter`. The throw prompt teaches for the first 5 throws, then hides. The charge bar and the "click to look" hint moved into the same column. |
| Event feed | `dist/prompts.js` | Bottom-left, up to 4 lines that fade after about 4 s. It takes over every game notice (`+ 2 wood`, `Crafted Rope`, `You caught a fish!`) that used to sit centred under the crosshair. Text is set with `textContent`, so guest text can't inject HTML. |

Owner's acceptance check: during normal play nothing sits in the screen centre except the crosshair.

## Step list

**Chapter 1, First Ten Minutes**
- look, walk, throw, reel
- wood, leaves, plastic, bag, rope, hammer, floor
- swim: optional, appears only while you are in the water

**Chapter 2, Make Yourself at Home**
- grow3, grab, barrel
- palm-craft, plant (the palm planter is our "plant" until farming lands)
- lantern
- repair: optional, appears when the hook is at 50% or below

**Chapter 3, A Home on the Water**
- wood gather, rope8, rod
- fish1, fish3
- sail, seat (bench), crate, home (16 tiles)

How completion works:
- Completion is checked **only** from `window.raftDebug.state`, polled every 250 ms, against a baseline taken when the step appeared.
- Returning players silently skip steps they have already done (for example, owning a hammer).
- When a guest joins or leaves a hosted world, every step takes a fresh baseline instead of auto-completing.

## Hooks into existing files (all small and commented)

1. `dist/game.js`, end of `mount()`: two lines that publish the scene, camera and debug API for add-on modules:
   ```js
   // onboarding/prompts hook (docs/cloud/onboarding.md): lets dist/prompts.js raycast with the live camera.
   try { window.raftMount = {T, scene, camera, debug:debugApi}; window.dispatchEvent(new CustomEvent('raft:mount', {detail:window.raftMount})); } catch {}
   ```
2. `dist/index.html`: links `prompts.css` and `onboarding.css` after `graphics.css`, and adds `<script type="module">` tags for `prompts.js` and `onboarding.js` after `live.js`. Both are marked `<!-- onboarding lane -->`.
3. `package.json`: `npm test` now also runs `tests/prompts.test.mjs` and `tests/onboarding.test.mjs`.

Nothing else in existing files was changed. Our CSS takes over the game's elements like this:
- `#contextPrompt` is hidden, and its notices are mirrored into the feed by a MutationObserver.
- `#chargeMeter` and `#resumeHint` are restyled with `body #id … !important`.

The modules boot once and survive `live.js` hot-swaps: they always read the latest `raftMount` / `raftDebug`, and objects registered from an old scene are ignored.

## API for other lanes

**Prompts.** Register what you want a prompt for, e.g. farming crops, storage or islands:
```js
const off = window.raftPrompts.register({
  id:'crop', object:cropMesh, range:3, priority:1,
  prompt: (ctx, hit) => [{key:'E', label:'Harvest'}, {key:'RMB', label:'Water', muted:true}],
});
window.raftPrompts.provide({id:'held-seed', prompt: ({state}) => state.heldKind === 'seed' ? {key:'LMB', label:'Plant'} : null});
window.raftPrompts.feed('+ 3 potato');   // bottom-left event line
```
- Which prompt wins: highest priority, then raycast hits over providers, then the nearest hit.
- Keys `LMB` and `RMB` draw a mouse glyph. `key:'Hold LMB'` (or `hold:true`) adds HOLD.
- Register specific objects. Raycasting the whole scene hits the hands.

**Onboarding.** Add steps to the tracker; they slot into the chapter after `after`:
```js
window.raftOnboarding.register({chapter:'ch2', after:'plant', steps:[
  {id:'seed', title:'Plant a seed', hint:'Hold a seed, [LMB] on a planter', done:(S, base) => (S.stock?.crop ?? 0) > 0},
]});
window.raftOnboarding.complete('seed');   // or tick a step from your own code
```
Step fields:
- `{id, title, hint (string or S => string), done?(S, base, ctx), count?(S, base, ctx) -> [n, of, unit?], start?(S), needs?, optional?, show?(S)}`
- `ctx` provides `gained(kind)`, `yawTravel`, `walked`, `S0` and `prev`.

## Storage keys
- `little-raft-onboarding-v1`: done steps and collapsed state.
- `little-raft-prompts-v1`: throw count, used for teach-then-hide.
- `little-raft-autostart` (sessionStorage): New Game handoff across the reload.

All storage access is wrapped in try/catch, and everything works with storage blocked.

## How it was made (fleet)

Lead plus 11 subagents:
- researcher, centred-text auditor, UX designer
- prompts builder, onboarding builder
- adversarial reviewers for prompts (4 bugs fixed) and for onboarding (8 bugs fixed, plus keeping the tracker readable over the bag)
- visual QA (6 polish fixes)
- a fresh player who played headless from zero through chapter 2 into chapter 3 using real mouse and keyboard input and reported 11 confusions
- two fix builders that acted on that playtest
- a final screenshot pass

## Tests
- `npm test`: survival + prompts + onboarding, 45 tests, all passing. They cover:
  - the prompt resolver, feed dedupe/escaping, the throw teach count, build cost and missing text, raft distance
  - the step table, `evaluate()` on fresh, partial and garbage state, returning players, guest world swaps, `register()` insertion, dynamic hints and gather counts that include held items
- Headless browser: `python shoot.py dist <outdir>` (in this sandbox, a copy with the `channel` argument removed). The lane's scripted runs drove:
  - the title with and without a save, New Game confirm, wipe and reload
  - real-input look and walk, the bag, a hammer seeded from a save, swimming
  - a full fresh playthrough

  None of these runs logged a page error.

## Screenshots

`docs/cloud/shots/onboarding/`:

| File | Shows |
|---|---|
| `01-title.png` | Title screen, no save |
| `02-title-continue.png` | Title screen with Continue |
| `03-title-new-game-confirm.png` | New Game inline confirm |
| `04-tracker-bright-sky.png` | Notes tracker over bright sky |
| `05-tracker-looking-down.png` | Notes tracker over dark water |
| `06-prompt-throw-charging.png` | Throw prompt and charge bar |
| `07-feed.png` | Event feed |
| `08-tracker-collapsed.png` | Tracker collapsed with N |
| `09-bag-with-notes.png` | Notes beside the bag |
| `10-paused.png` | Pause menu |
| `11-phone-title.png` | Phone title screen |
| `12-phone-ingame.png` | Phone in-game |
| `13-prompt-build-cost.png` | Build floor prompt with cost |
| `14-prompt-climb.png` | Climb aboard prompt |
| `15-tracker-counts.png` | Tracker progress counts |

## Known gaps / proposals for other lanes
- The pause/settings dialog (`settings.js`) and the bag help line (`survival-ui.js`) are still centred modals. The audit proposes left-aligned panels that match the title menu.
- `live.js` shows `#updateStatus` at the bottom centre; it should post to `raftPrompts.feed` instead. `#raftLiveError` is a centred card.
- Naming is inconsistent: the pickup prompt says "plank" but the loot line says "+ 2 wood" (`ITEM_NAMES` in game.js vs `ITEM_INFO`).
- Playtest notes for other owners:
  - the fishing rod's hotbar icon looks almost the same as the hook's
  - the palm planter has no held model
  - recipe counts like "Rope 6/2" are ambiguous
  - throws fall short unless you aim above the target (the tracker now tells players to aim above far debris)
- For a guest, the tile-count steps also count tiles the host adds to the shared raft.
- There is no camera ease from the title into first person: game.js hides `#welcome` straight away.
