# Character customisation: research

Feature: let each player choose how their sailor looks (shirt / trousers / skin / hair colours and a hat),
keep it per browser, show it on the co-op partner's body, and match the first-person hands to it.

## (a) Genre patterns and an original cozy take

Common patterns in survival / sandbox / co-op games:
- **Pick at start**: a character or outfit picker before the first spawn, often skippable ("random").
- **Change any time**: a wardrobe/mirror/menu entry so the choice is never permanent.
- **Colour swatches**, not free RGB pickers: a curated palette of 8-12 per slot keeps every combination
  pleasant and keeps the network payload tiny (an index, not a colour string).
- **Hats as unlockables**: cosmetics earned from milestones; purely visual, never gameplay power.
- **Co-op visibility**: your look is shown to the other player (name tag dot often tinted by shirt colour).
- **First-person consistency**: sleeves and skin of the viewmodel match the chosen body.

Original cozy take for Little Raft ("Look" panel, wording our own):
- Slots: **shirt**, **trousers** (the shorts), **skin**, **hair**, **hat**. Each colour slot is an index
  into a small fixed palette (shirt 10, trousers 8, skin 8 warm-to-deep tones, hair 8).
- Hats (5-6, all low-poly, own art): straw sunhat (default, today's hat), knitted beanie, sailor cap,
  bucket hat, flower crown, "no hat". Optional hat tint = shirt band colour, as today (`bandColor`).
- **Unlocks from the logbook** (`dist/logbook.js:27-38` ACHIEVEMENTS): e.g. `fish10` -> bucket hat,
  `craft_palm` -> flower crown, `notes_all` -> sailor cap, `tiles25` -> beanie. Straw and none always
  available. Because `world.achievements` belongs to the host world (a guest sees the host's list,
  `game.js:1214`), keep a local "ever unlocked" set in localStorage and union it whenever the logbook
  evaluates; the guest keeps hats it has seen unlocked on any raft. A locked hat shows as a silhouette
  with its achievement name as hint (no stress, no timers).
- "Shuffle" button picks a random palette combo; a small live 3D preview (or a front-facing swatch card)
  sits in the panel.
- First-person: sleeve = shirt colour (darkened cuff), hands/forearm = skin colour.
- Name tag dot (`coop-avatar.js:128`) uses the partner's shirt colour instead of the fixed blue.

## (b) Code anchors

### Third-person body: `dist/avatar.js`
- `createAvatar(T, color)` at `avatar.js:12`; only one input today: shirt colour (`:25`), band =
  shirt x0.72 (`:26`).
- Material table `M` at `avatar.js:29-44`: `skin` `#f2c29b`, `shirt`, `stripe`, `shorts` `#2f4a6b`,
  `shoe`, `hair` `#6b4226`, `straw` (flatShading), `band`, `pack`. All per-avatar, so recolouring is a
  `M.x.color.set(...)` on the local avatar.
- Mesh mapping: shirt torso `:58`, shorts `:62` + legs `:74`, skin neck/legs/arms/hands `:64,:75,:96-97`,
  sleeves use `M.shirt` `:94`, face/ears/nose `:111,:119,:122`, hair cap `:114`.
- Hat is a rigid sub-group on the head, `avatar.js:140-148` (`hat` group: brim, crown, band). New hats
  plug in here as a `HATS = {straw(g,M), beanie(g,M), ...}` builder table, same pattern as held-item
  `BUILD` (`:178-211`). Suggested signature change, backward compatible:
  `createAvatar(T, colorOrLook)` - a string keeps the old behaviour, an object `{shirt,trousers,skin,hair,hat}`.
- Local avatar instances: `game.js:388` (`player = makeAvatar('#efae55'); friend = makeAvatar('#70a7e4')`),
  `makeAvatar` `game.js:425-429`, fallback `game.js:419-424`. `player` is hidden in first person
  (`game.js:1115`) but visible on the title/paused view, so it should get the local look too.
- Legacy `friend` (`game.js:1116-1123`) is the fallback partner body for peers without the co-op hub;
  co-op hides it (`coop.js:144`).

### Remote body: `dist/coop-avatar.js`
- `createRemoteAvatar(T, {color, name})` at `coop-avatar.js:19`; built at `coop.js:42` with a fixed
  `'#70a7e4'`.
- **Baked**: `bakeAvatar` (`coop-avatar.js:264-330`) merges the 36 meshes into ~8 meshes with colours
  copied into a per-vertex `color` attribute (`:309`). So `material.color.set` does NOT work on the remote
  avatar; a look change needs either (1) rebuild body + bake, or (2) rewrite the vertex colour
  attribute in place. Option 2 needs a per-vertex "slot" tag recorded at bake time (which source
  material each vertex came from); then recolour = loop over vertices, `needsUpdate = true`. A hat
  change changes geometry, so it needs a rebake of the head pivot at least (or simply rebuild all).
- Straw is flat-shaded, so it is merged per material, not into the shared vertex-colour mesh
  (`PLAIN` test `:261`); new hats should either be plain (vertex-colour path) or flatShading like straw.
- Name tag dot colour: `coop-avatar.js:128` (`dot` from the constructor colour, captured once); add a
  `setColor`/`setLook` that redraws via `setName` (`:129-140`).
- `dispose()` at `:243-252` frees body + baked; reuse for rebuild.

### First-person hands: `dist/hands.js`
- Own materials `hands.js:41-46`: `skin 0xc89068`, `skinPalm`, `nail`, `crease`, `sleeveMat 0x52705e`
  (green!), `cuffMat 0x3e5648`. Note: today the FP sleeve is green while the body shirt is orange
  (`#efae55`) and the skin tones differ (`#f2c29b` vs `0xc89068`) - customisation fixes this mismatch.
- Sleeve/cuff meshes `hands.js:164-165`; skin used across fingers/thumbs `:87-130`, forearm `:163`.
- Public API returned at `hands.js:407-424` (`setHeld`, `setPose`, ...): add
  `setLook({skin, shirt})` that does `skin.color.set`, `skinPalm/nail/crease` derived (multiplyScalar),
  `sleeveMat.color.set(shirt)`, `cuffMat` = shirt x0.75. Cheap, no rebuild. The hands keep their own
  slightly darker, emissive-tinted skin shading (`emissive: 0x1c0e06`) - derive from the chosen tone
  rather than copying it verbatim. Created at `game.js:433`.

### Co-op messages: `dist/coop.js`, `dist/coop-delta.js`
- Protocol header `coop.js:9-16`; `COOP_VERSION = 1` (`coop.js:25`).
- Hello sent at `coop.js:214` (`{v, id, name}`) and answered at `coop.js:104` (`re:1`). Receiver
  `onEvent` `coop.js:100-111` reads only `v, id, name`, so **unknown fields are ignored** by old peers.
- Best place for the look: add `look` to both hello sends (`:104`, `:214`) **and** a dedicated
  `{type:'coop', k:'look', look}` event sent whenever the player changes it mid-session (hello is only
  sent once per connection). Old peers drop unknown `k` values silently (`onEvent` has no else branch).
- Validate in `onEvent`: `cleanLook(m.look)` - each slot an integer in `[0, palette.length)`, hat a
  known id string; anything else -> default for that slot. Never pass raw strings to `THREE.Color`.
- Do NOT put look into the `cp` pose stream (`coop.js:124-138`, 15 Hz delta-encoded via `coop-delta.js`
  `DeltaEncoder`); it is static and would only add keyframe bytes. Do NOT put it in world/ext either: it
  is per-player, per-browser, not part of the host save.
- The name read pattern `readName` (`coop.js:33`) is the model for `readLook()` (try/catch localStorage).
- `peerName` survives reconnect via `saved?.peerName` (`coop.js:52`); store `peerLook` the same way in
  `capture()` so hot swaps / rejoins do not flash the default look.

### Menus where a "Look" panel can live
- Pause menu built in `dist/settings.js` `markup()` `:129-146`: nav buttons with `data-act`
  (`resume/settings/help/crew/logbook/quit`) and a tabbed `.rs-panel`; tabs list `TABS` at `settings.js:29`.
  Option A: a "Look" tab in `TABS` with swatch rows (needs a new control type beside range/toggle/select,
  `control()` `:116-127`). Option B (cleaner): a separate `data-act="look"` button that opens an own
  dialog module (`dist/look-ui.js`), like the logbook button is wired to `logbook-ui.js`
  (`game.js:1758`). Bump `data-raft-settings` (`settings.js:145,160`) if the markup changes.
- Title / welcome card `index.html:12` (`#welcome`, "Let's set sail" / "Play with my brother"): a small
  "Change look" secondary button fits under the two primary buttons for pick-at-start.
- Onboarding (`dist/onboarding.js`): `window.raftOnboarding.register({chapter, steps})` (`:2`, `:80`)
  could add an optional "Make it yours" step in ch2 ("Make Yourself at Home", `:37`) - optional, never
  blocking.

### localStorage keys in use
- `little-raft-settings` (`settings.js:7`, validated by `validateSettings` `:33`).
- `little-raft-name` (`coop.js:33`, read-only there).
- `little-raft-v1` save, `little-raft-onboarding-v1`, `little-raft-autostart` (`onboarding.js:6`).
- `little-raft.daynight` (daynight module).
- Proposal: `little-raft-look-v1` = `{shirt, trousers, skin, hair, hat, unlocked:[hatIds]}`, separate
  from settings so `validateSettings` and its tests stay untouched.

## (c) Risks

- **Old peers without look**: hello lacks `look` -> partner shows the default look (current blue shirt
  `#70a7e4`, straw hat). New -> old: old client ignores the field and still shows its fixed blue avatar;
  no version bump needed (`COOP_VERSION` stays 1). Keep defaults identical to today so nothing changes
  for players who never open the panel.
- **Bad data**: peer-supplied values are untrusted. Index-based palette + `cleanLook()` clamp; reject
  non-integers, NaN, out-of-range, unknown hat ids, oversized objects. Same for localStorage (corrupt
  JSON -> defaults). Unit-test `cleanLook` in `tests/customise.test.mjs` like `validateSettings`.
- **Perf of rebuilding**: remote avatar is baked (`coop-avatar.js:264`); rebuilding is ~36 geometries +
  merge, fine once per change but must never run per frame or per pose message. Only apply when
  `JSON.stringify(cleanLook(x)) !== lastLookKey`. Throttle look events (e.g. send on panel close, or
  debounce 300 ms) so dragging through swatches does not spam rebakes on the partner side. Dispose old
  geometry/materials on rebuild (`dispose()` `:243`) to avoid GPU leaks.
- **Rebuild keeps state**: replacing the remote body must keep `group` (scene parent, position,
  name tag, held-item cache) and re-fetch `body.userData.parts`, since `update()` animates those pivots;
  simplest is to swap only the inner `body` + `baked` and keep the outer group.
- **Unlock semantics in co-op**: achievements are host-world data; a guest unlocking via the host's
  world is generous and fine for a cozy game, but must be stored locally, not in the host save.
- **Shadows/draw calls**: new hats should stay within the baked mesh classes (plain or flatShading)
  so draw calls stay ~8 for the remote avatar.
- **Hot reload / build query**: `game.js` imports with `?build=...` (`game.js:2`); new modules must
  follow the same pattern or they load twice.
- **Accessibility**: swatches need text labels (`aria-label="Shirt: sea blue"`) and keyboard focus;
  the panel must route Esc like the other dialogs (`settings.js:3`, Escape routing).
