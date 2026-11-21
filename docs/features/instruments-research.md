# Playable instruments: research notes

Goal: craft small original instruments, hold one, click to play notes; a co-op friend hears them from where
you stand. Proposed set (original names and art): **Tide Drum** (a hand drum with a palm-leaf head), **Reed Pipes**
(a row of plastic or reed tubes, breathy) and **Bell Bars** (scrap-metal bars on a wooden frame, a bright chime).
Line numbers are as of branch `claude/loop-features-202611210648`.

## Recommendation: held items, not placeable decor
- Make them **held, non-durability "tool" items**, the same shape as `binoculars` (`dist/items.js:143`): `category:'tool'`,
  `tool:false`, `stack:1`. Then there is no wear, no repair cost (`tests/progression.test.mjs:113-116` needs
  `repairCost` only when `tool:true`) and no durability bar.
- Held means **no world state**: nothing goes into `world.decor`, the save, `BLOCK_RADII` (`items.js:191`), collision,
  the host action path or save migration. Playing is purely local, plus one transient co-op message.
- Placeable decor would need all of that, plus an E-interact prompt and a host `applyAction` round trip for each note.
  It could come later as a "music stand" that uses the same audio module.

## Item data and crafting (exact hooks)
- `dist/items.js:128-145` is the tools block of `LIST`. Add entries with `item(id, name, 'tool', {stack:1, iconTint, recipe: hand({...}), unlock, tip})`.
  `placeholder` defaults to true when there is no `icon` opt, so the icon is `icon-<id>`.
  Schema docs: `items.js:9-34`. `infoTable()` (`:362`) and `recipeTable()` (`:372`) feed the entries automatically into
  `ITEM_INFO` (`inventory-state.js:50`) and `RECIPES` (`inventory-state.js:83`). Nothing needs registering by hand.
- Only existing materials are available (there is no bamboo or shell item): wood, leaf, plastic, scrap, rope, nail, sand, clay,
  stone, glass, metalingot, copperingot, bolt, hinge. Suggested recipes and unlock types (`items.js:46-49` helpers):
  - Tide Drum: `hand({wood:3, leaf:2, rope:1})`, `discover('rope')`. An early, cosy unlock.
  - Reed Pipes: `hand({plastic:3, rope:1})`, `discover('rope','plastic')`.
  - Bell Bars: `hand({wood:2, scrap:3, nail:2})`, `research('nail')` at the Research Table, which teaches the gating.
- Gating runs in `progression.js:37` (`Progression._met`, `:55-61`). `progression-hooks.js:230` `recipeGate` shows the
  three nearest goals greyed out and hides the rest. `storage-research.js` (Tinker's Desk) ignores catalogue ids because of
  `setOwnedElsewhere` (`game.js:400`), so do not add instruments to `content-items.js`.
- Craft book: `craft-book.js:13` `CATEGORY_OF` maps an id to a tab. Add `drum/pipes/bells: 'tools'`. Without it, `tool:false`
  falls through to 'building' (`:76-80`). Add `ITEM_TEXT` rows (`:26`).
- Icons: add SVG drawings to `item-svg.js:10` `ITEM_ICONS`, keyed by kind (merged in at `survival-ui.js:66`).
- Tests that guard the catalogue: `tests/progression.test.mjs:100` (completeness: tip > 10 chars, icon prefix, category in
  the set at `:20`), `:126` (every reference is real), `:186-198` (every item reachable) and `:202` (INFO keys = ITEM_IDS).
  `progression-core.test.mjs:38-39` lists which items start unlocked, so do not use `START` unless you update it.

## Held model and hands
- `held-items.js:21` `TOOL_KINDS` and `:23` `HOLD` give the pose per kind (`hand`, `pose`, `rx/ry/rz`). `:39` `SIZE`.
  `buildItemModel` (`:117`) falls back to a cloth bundle for unknown kinds, so add a branch that builds procedural instrument
  meshes (call `fit(T, model, size, gripFn)`, `:42`). Suggested HOLD: drum `{hand:'left', pose:'grip'}` (held against the
  hip), pipes `{hand:'right', pose:'grip', rx:-1.2}` (raised to the mouth), bells `{hand:'left', pose:'grip'}`.
- Do **not** add instruments to `PLACEABLE_KINDS` (`held-items.js:19`). That switches on the pointing pose
  (`game.js:1105`) and placement.
- Per-hit animation: `useSelected` already sets `swing = 1` for tools. `swing` decays (`game.js:1101`) and goes to
  `hands.update({casting:swing})` (`game.js:1109`, consumed at `hands.js:288,327-332`), which gives a cheap "strike" bob.
- `tests/viewmodel.test.mjs:19` builds a model for every `ITEM_KINDS` entry (it must fit within 1 m and have a grip), so new kinds are covered automatically.

## Input
- Left click while locked: `game.js:1289-1299` calls `useSelected(pickCenter())` for any non-hook kind. Gamepad RT:
  `controls.js:69` calls `useDown` (`game.js:1369`), which reaches the same function. Mouse does not double-fire, because
  input.js only uses mouse for look and bindings, and `useDown` is pad-only. **Hook point:** at the top of `useSelected`
  (`game.js:950`), add `if (instruments?.use(kind)) return;`, placed before the hammer branch. The hook must come after
  the `guestWaiting` check, because a guest's local playing is harmless but should match the other tools.
- Note choice: **camera pitch** (`pitch`, clamped to plus or minus `PITCH_LIMIT` 1.35, `game.js:72,642`) maps to 8 steps of a
  pentatonic scale. Look up for higher notes. It works on mouse and pad and needs no new bindings. The free keys are taken
  (Digit1-0 for the hotbar, wheel for the hotbar, Z/X for co-op emotes `coop.js:28`, R for rotate/repair, Q for drop),
  so avoid per-note keys. Optional extra: RMB (`aim`, `Mouse2`) for a second articulation (drum rim, a short chord). Today
  RMB is only special for the hammer (`game.js:1290`).
- `input-map.js:14` `ACTIONS`: no new action is needed. If one is wanted later, append it (rebinding persists by id).

## Audio (dist/audio.js)
- `createOceanAudio` (`audio.js:39`) has a private graph: buses effects/ambience/music lead into a tone low-pass, then master,
  then a limiter (`:76-95`). `play(ev, s)` (`:477`) accepts only names from the `recipes` table, and has **no pitch argument**. It applies
  `MIN_GAP` per event (`:28`) and `MAX_VOICES` 24 (`:27`).
- **Hook:** add a small public method, for example `note(instr, step, s=1)`, that runs a recipe per instrument on `graph.effects` through
  `voice()` (`:422`). Use a per-instrument minimum gap of about 0.05 s. Use the same D pentatonic as the music bed (`SCALE`, `:34`;
  for example D4 E4 F#4 A4 B4 D5 E5 F#5) so the instruments sit in key with the pad. Build the synthesis from the existing
  helpers `tone/burst/noise/env` (`:183-225`):
  drum = a sine with a pitch drop plus a low-passed noise slap; pipes = a triangle or sine with slow vibrato plus band-passed
  breath noise; bells = sine partials at about 1, 2.76 and 5.4 with a fast decay.
- Volume: settings `volume` and `effects` (`settings.js:21-22`) reach `applyVolume` (`game.js:260`). Using the effects bus
  respects both, and the diving underwater low-pass (`output`, `audio.js:87`) applies for free. There is no music slider
  (the music bus is always 0.7), so do not use the music bus.
- `game.js:259` `const play = (ev, s) => sfx.play(ev, s);`. Expose `sfx.note` to the instrument module the same way.
  Hot reload hands the `AudioContext` over (`X.audio`), so the module must keep no audio nodes of its own.
- The audio test pattern is in `tests/survival.test.mjs`, which imports audio.js with a fake context. Test that `note()` never
  throws and returns false with no context.

## Co-op event path (transient, non-authoritative)
- The transport is a single reliable PeerJS DataConnection between two players (the room is full at 2, `game.js:1448`), so no relay
  is needed. `send(data)` (`game.js:753`) runs `coop.encode`, which passes unknown types through unchanged (`coop.js:72-83`;
  only `move` and `state` are rewritten).
- Receive: `game.js:1476-1479` runs `coop.decode`, which returns non-`coop`, non-`Δ` messages as they are (`coop.js:85-97`). The
  **precedent is the fishing-cooking lane**: `if (data.type === 'fc') {...; fc?.onNet(data, from); return;}` at `game.js:1479`,
  placed before the host/guest split, with transient `catchFx` (`fishing-cooking.js:287,184`). **Hook:** add
  `if (data.type === 'inst') { if (isHost) lastGuestMessage = performance.now(); instruments?.onNet(data); return; }`
  right after line 1479.
- Message: `{type:'inst', i:'drum'|'pipes'|'bells', n:0..7, v:0..1 (strength)}`. Position is not needed, because the
  receiver uses `friend.position` (the remote avatar group, interpolated by coop.js) for distance attenuation, for example
  `gain = clamp(1 - d/30)`. The listener is the camera.
- Validate on receive (enum `i`, integer `n` in range, finite `v`). Rate-limit both on send (at most about 12/s) and on
  receive (drop over 16/s). Older builds ignore `type:'inst'` silently: the host branch handles only action/move, and the guest
  falls through all `if`s.
- Alternative: a coop.js event `{type:'coop', k:'note'}` handled in `onEvent` (`coop.js:98-110`, like `emote`). It
  needs a new `ctx.onNote` callback in `coopContext` (`game.js:1537`) and only works after `hello`. The fc-style path is simpler.
- Remote visuals: coop.js `HELD` (`coop.js:25`) is a fixed index enum for the held kind in the pose stream (`:120,131`).
  **Append** the instrument ids at the end. Reordering breaks old peers, while appending is safe because unknown indices give `null`.
  Then `coop-avatar.js:96-110` `BUILD[kind]` needs tiny models, otherwise nothing shows in the friend's hand. Also add
  `TOOL_TILT` (`:97`). The optional friend feed line "Brother plays the drum" via `coop.feed` only matches connection words
  (`coop.js:30 FEED_RE`). Use `notice()` (`game.js:543`) at most once per session, or skip it.

## Prompts
- `prompts.js` has a public provider API: `window.raftPrompts.provide({id, priority, prompt})` (`prompts.js:3-6,192`), with
  `prompt(ctx)` returning `{key:'LMB', label:'Play'}`. The instrument module can register it with no edit to prompts.js. The state is in
  `ctx.state.heldKind` (`game.js:1626`). The built-in `statePrompt` (`prompts.js:63-90`) shows how tool tips teach and then hide
  (`THROW_TEACH`). Suggest two prompts: `LMB Play` and a muted "Look up/down to change note" until about 10 notes have been played.
- The legacy `#contextPrompt` (`game.js:553-568`) has a `content?.prompt(frameAim)` slot. Not needed.

## Proposed module layout
- `dist/instruments.js`: the pure top half is exported for tests (`INSTRUMENTS` table `{id, voice, steps}`,
  `noteFor(pitch, steps)`, `cleanNoteMsg(m)`, `rateGate()`, `distanceGain(d)`). The bottom half is
  `createInstruments(host)` with a `host` adapter like `fcHost()` (`game.js:412`): `{selectedKind, pitch(), send, netReady, role,
  note:(i,n,s)=>sfx.note(i,n,s), friendPos(), camera, notice, setSwing()}`. It returns `{use(kind), onNet(m), dispose()}`.
- Wire it in `game.js` next to `fc` (`:240,396,1730`), with lines tagged `// [instruments]`.
- `tests/instruments.test.mjs`: `node:test` plus `assert/strict`, importing via the `RAFT_DIST` base URL idiom
  (`tests/signal.test.mjs:1-8`). Cover the pitch-to-note mapping, message validation (junk, `__proto__`, NaN), rate limits,
  and the item entries (via `ITEMS`).

## Risks
- `game.js` is 1780 lines with many lanes. Keep the hooks to one line each (useSelected, data handler, adapter, dispose).
- `audio.js` `play()` gating: do not route notes through `play()`, because `MIN_GAP` per event name would swallow fast
  drumming, and there is no pitch. Add `note()` instead. A 24-voice cap with long bell tails: keep the decays at 1.5 s or less.
- Coop `HELD` enum ordering (append only). Old peers show nothing in the friend's hand, which is acceptable.
- `tests/progression.test.mjs` reachability and completeness checks fail if a tip or icon prefix is missing, or if an unlock references an
  unreachable item. `START` unlocks also change `progression-core.test.mjs:38` expectations.
- `binoculars` is matched by `toolRole(kind) === 'binoculars'` (`progression-hooks.js:242`). Do not set `actsAs` on instruments,
  because the test at `:121` allows only hook/fishingrod/hammer.
- Spam: there is no damage or hunger, so the only cost of spam is noise. A rate limit on both ends plus distance falloff is enough.
  Respect `sound` off (`game.js:257`), which works automatically via master 0.
- Imports in game.js use the `?build=v3-survival-...` cache-buster on most modules. Follow the neighbouring line's style.
