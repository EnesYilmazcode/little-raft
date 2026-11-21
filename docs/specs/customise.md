# Spec: character customisation ("Look")

Each player picks shirt / trousers / skin / hair colours and a hat. Stored per browser, shown on the
co-op partner's body and on the first-person sleeves/hands. Purely cosmetic. Research and anchors:
`docs/features/customise-research.md` (anchors re-checked for this spec).
**Not** in the world save, not in `world.ext`, not in the `cp` pose stream. `COOP_VERSION` stays 1.

## 1. `dist/look.js` (pure, no DOM/THREE; importable from node)
```js
export const LOOK_KEY = 'little-raft-look-v1';
export const PALETTE = { // [id, label, hex]; index 0 of shirt is today's local orange
  shirt:    [['sun','Sunny orange','#efae55'],['sky','Sky blue','#70a7e4'],['coral','Coral','#e8776a'],['leaf','Leaf green','#7fbf6a'],
             ['sea','Sea teal','#3f9e9a'],['plum','Plum','#9a6fb8'],['butter','Butter','#f2d873'],['rose','Rose','#ee9ec0'],
             ['navy','Navy','#33507e'],['cream','Cream','#f1e8d2']],
  trousers: [['denim','Denim','#2f4a6b'],['sand','Sand','#c9ad7f'],['moss','Moss','#5d7148'],['brick','Brick','#9a4f3c'],
             ['char','Charcoal','#3b3d44'],['ocean','Ocean','#3a77a8'],['white','Sail white','#e9e4d8'],['berry','Berry','#7d3d66']],
  skin:     [['s1','Tone 1','#f2c29b'],['s2','Tone 2','#f6d3b3'],['s3','Tone 3','#e2a97e'],['s4','Tone 4','#c98b5f'],
             ['s5','Tone 5','#a86c44'],['s6','Tone 6','#8a5536'],['s7','Tone 7','#6b3f27'],['s8','Tone 8','#4e2d1c']],
  hair:     [['brown','Brown','#6b4226'],['black','Black','#22201f'],['auburn','Auburn','#9a4a26'],['blond','Blond','#d9b45a'],
             ['ginger','Ginger','#c8662f'],['grey','Grey','#a7a29a'],['white','White','#ece6da'],['teal','Teal','#3e8f8a']],
};
export const HATS = [ // order = picker order; unlock = logbook achievement id (dist/logbook.js ACHIEVEMENTS) or null
  {id:'straw',  label:'Straw sunhat', unlock:null},
  {id:'none',   label:'No hat',       unlock:null},
  {id:'beanie', label:'Knit beanie',  unlock:'tiles25'},   // Floating Neighbourhood
  {id:'bucket', label:'Bucket hat',   unlock:'fish10'},    // Fish Whisperer
  {id:'flower', label:'Flower crown', unlock:'craft_palm'},// A Little Green
];
export const DEFAULT_LOOK = Object.freeze({shirt:0, trousers:0, skin:0, hair:0, hat:'straw'});
export const PARTNER_DEFAULT = Object.freeze({...DEFAULT_LOOK, shirt:1}); // today's #70a7e4 partner
export function cleanLook(x, base = DEFAULT_LOOK)   // -> new frozen {shirt,trousers,skin,hair,hat}
export function lookColors(look)                    // -> {shirt,trousers,skin,hair} hex strings (from cleaned look)
export function lookKey(look)                       // -> 'shirt.trousers.skin.hair.hat' string for change checks
export function loadLook(storage = globalThis.localStorage) // -> {look, unlocked:Set}; never throws
export function saveLook(look, unlocked, storage = globalThis.localStorage) // try/catch, returns bool
export function noteAchievements(unlocked, ids)     // adds hat ids whose unlock is in ids; returns array of NEW hat ids
export function hatAvailable(id, unlocked)          // unlock===null || unlocked.has(id)
```
- `cleanLook`: non-object / array -> copy of `base`. Each colour slot: `Number.isInteger(v) && v >= 0 &&
  v < PALETTE[slot].length`, else `base[slot]`. `hat`: string that is a known `HATS` id, else `base.hat`.
  Extra keys dropped. Does **not** enforce unlocks (partner may legitimately wear a hat we have not
  earned); the local UI and `loadLook` do: a locally stored locked hat falls back to `'straw'`.
- Storage JSON: `{v:1, shirt, trousers, skin, hair, hat, unlocked:['beanie',...]}`. Corrupt JSON,
  missing key, throwing accessor -> `{look:DEFAULT_LOOK, unlocked:new Set()}`. `unlocked` filtered to
  known hat ids, max 16 entries.
- Defaults equal today's colours exactly (shirt `#efae55`, shorts `#2f4a6b`, skin `#f2c29b`, hair
  `#6b4226`, straw hat), so players who never open the panel see no change.

## 2. Hats: builders inside `dist/avatar.js`
`const HAT_BUILD = {straw(T,hat,add,geo,M){...}, none(){}, beanie(...), bucket(...), flower(...)}`,
replacing the inline block at `avatar.js:140-148` (the `hat` group stays; builders only add children).
- `straw`: today's brim/crown/band verbatim (`M.straw` flatShading + `M.band`).
- `beanie`: half sphere (r 0.2, `M.band`-like knit colour = shirt x0.8) + small ball on top + rolled
  cuff torus; plain material (vertex-colour bake path).
- `bucket`: cylinder crown (0.17/0.19, h 0.12) + sloped brim (cone frustum 0.27->0.2, h 0.05) in
  trousers colour x1.1; plain.
- `flower`: thin torus (0.17, tube 0.018) in leaf green + 6 small spheres (petal colours from a fixed
  3-colour set) around it; plain. Hair cap shows (no brim).
All own art, low poly (<=16 segments), plain or flatShading only so `bakeAvatar` keeps ~8 draw calls.

## 3. Hooks into existing files (exact)
- **`avatar.js:12`** `createAvatar(T, colorOrLook)`: `typeof === 'string'` (or null/undefined) keeps
  today's path (shirt = that colour, rest default, straw). An object goes through `cleanLook` +
  `lookColors`; sets `M.shirt`, `M.shorts` (trousers), `M.skin`, `M.hair`, band = shirt x0.72, then
  `HAT_BUILD[look.hat]`. Store `root.userData.look = cleaned`. Import `look.js` with the same
  `?build=` query as other modules. No `setLook` on the avatar (rebuild is cheap and used once).
- **`game.js:388`** `player = makeAvatar(lookState.look)` (local look); `friend` keeps `'#70a7e4'`.
  `makeAvatar` passes the value through unchanged; `fallbackAvatar` uses `lookColors(look).shirt` when
  given an object. On local change: dispose and replace `player` (same position, `scene.add`).
- **`hands.js`** API (`:407-424`) gains `setLook({skin, shirt})` (hex strings): `skin.color.set(skin)
  .multiplyScalar(0.82)` (keeps the darker FP shading), `skinPalm` = skin x0.78, `nail` = skin lerp
  white 0.25, `crease` = skin x0.55, `sleeveMat` = shirt, `cuffMat` = shirt x0.75. No rebuild. Called
  after `createHands` (`game.js:433`) and on every local change. Defaults: before first call the old
  hard-coded colours remain (tests/screens unaffected until game.js calls it; game.js always does).
- **`coop.js`**: `readLook()` beside `readName` (`:33`) = `loadLook().look`. Both hello sends (`:104`
  reply and `:214`) add `look:readLook()`. In `onEvent` hello branch and a new branch
  `m.k === 'look'`: `applyPeerLook(m.look)`. `applyPeerLook(x)`: `const l = cleanLook(x,
  PARTNER_DEFAULT); if (lookKey(l) === peerLookKey) return; peerLook = l; avatar.setLook(l)`. Hello
  without `look` (old peer) -> `PARTNER_DEFAULT`. Ignore `look` objects whose `JSON.stringify` length >
  200. New export on the hub: `sendLook()` -> `event('look', {look:readLook()})` if `peer && conn?.open`.
  `capture()` (`:243`) adds `peerLook`; constructor seeds `peerLook = cleanLook(saved?.peerLook,
  PARTNER_DEFAULT)` and builds the avatar with it (`:42`) so hot swaps do not flash.
- **`coop-avatar.js`**: `createRemoteAvatar(T, {color, name, look})` (`look` wins over `color`).
  Make `body`, `P`, `baked` `let`. New `setLook(look)`: if `lookKey` equals the current key, return;
  else build `nb = createAvatar(T, look)`, copy `body.position/rotation/scale`, `group.remove(body)`,
  `body.userData.dispose(); baked.dispose()`, `group.add(nb)`, `body = nb; P = nb.userData.parts;
  baked = bakeAvatar(T, nb)`; update `dot` to the shirt hex and call `setName(lastName)` to redraw the
  tag. `update()` must read `P`/`body` through the `let` bindings (no captured copies). Held-item cache
  (`cache`, `cur`) is re-parented: clear `cur` so the next `update` re-mounts on the new hand pivot.
  Return `setLook` from the factory (`:254`).
- **Unlocks** (`game.js`, beside `logbookUI?.update?.()` at `:1248`): `if (world.achievements.length
  !== seenAch) { seenAch = ...; const n = noteAchievements(lookState.unlocked, world.achievements); if
  (n.length) { saveLook(...); notice('New hat for your Look: ' + label) } }`. Runs for host and guest
  (guest sees the host's list via state sync, `game.js:1214`); unlocks stay in localStorage only.
- **Pause menu** (`settings.js:142`): add `<button type="button" data-act="look">Change look</button>`
  after "Raft logbook"; bump `data-raft-settings` to `"4"` (`:136` and the check at `:156`); handler
  beside `:357`: `close(false); document.dispatchEvent(new CustomEvent('littleraft:open-look'))`.
- **Welcome card** (`dist/index.html:12`): `<button class="secondary" id="welcomeLook">Change look</button>`
  after `#welcomeCrew`; `game.js` beside `:1392`: `setHandler($('#welcomeLook'), 'onclick', () => lookUI?.open())`.

## 4. `dist/look-ui.js`
`createLookUI({getState, onChange, onPause, onResume}) -> {open, close, isOpen, destroy, refresh}`;
singleton via `globalThis.__littleRaftLookUI` (destroy old on hot swap), style id
`little-raft-look-style`, `<dialog id="lookDialog" class="lk">` reusing the logbook wood-panel look
(copy the CSS idioms, own class prefix `lk-`). Listens for `littleraft:open-look`.
- Layout: header "Your look" + close X; left a **2D SVG preview** (chosen over a live 3D preview: no
  second WebGL context or render loop, crisp on phones, trivially recoloured). Front-facing chibi
  figure (~160x220 viewBox) built from simple shapes with `fill="var(--lk-shirt)"` etc.; one `<g>` per
  hat id, only the selected shown. Right: four swatch rows (Shirt, Trousers, Skin, Hair), hat row,
  then "Shuffle" (random palette indices, hat random among available) and "Done".
- Swatches: `<button role="radio" aria-checked aria-label="Shirt: Sky blue">` inside
  `role="radiogroup"`, 32px circles (40px hit area on touch), arrow keys move within a row. Hat tiles
  show a mini SVG; locked = greyscale, `opacity:.45`, `aria-disabled="true"`, lock icon, hint
  `title`/caption "Unlock: Fish Whisperer" (achievement name from `ACHIEVEMENTS`).
- Every click: update preview + `onChange(look)` immediately (game.js applies to hands/player and
  saves). The coop `sendLook()` is debounced 400 ms and also flushed on close, so dragging across
  swatches costs the partner at most one rebake per 400 ms.
- Pointer lock like logbook-ui (`:163-183`): open -> `onPause()`, `exitPointerLock()`, `showModal()`;
  Esc (`cancel`) -> close; close -> `onResume()`. In game.js: `onResume: guard(() => { if
  (running) requestLock(); })` so closing from the welcome card does not grab the mouse.
- Phone (<=520px): preview stacks above the rows at 140px height; dialog `width:min(560px,
  calc(100vw - 32px))`, `max-height:88dvh`, rows scroll inside.
- `raftDebug.look = () => ({look, unlocked:[...], open:isOpen})` for probes.

## 5. Tests: `tests/look.test.mjs` (node --test, imports `dist/look.js` only)
1. `cleanLook`: undefined/null/array/string -> DEFAULT_LOOK; `{shirt:3}` keeps 3, fills rest;
   `-1`, `10`, `2.5`, `NaN`, `'3'`, `Infinity` -> default; unknown hat `'crown'` -> base hat; extra
   keys dropped; base PARTNER_DEFAULT honoured; result frozen.
2. Defaults match today: `lookColors(DEFAULT_LOOK)` = `#efae55/#2f4a6b/#f2c29b/#6b4226`, hat straw;
   `lookColors(PARTNER_DEFAULT).shirt === '#70a7e4'`. Every palette hex matches `/^#[0-9a-f]{6}$/`.
3. Storage round trip with a fake `{getItem,setItem}` map: save -> load equal; corrupt JSON, missing
   key, throwing getItem -> defaults; stored locked hat -> `'straw'`; unknown unlocked ids filtered.
4. Unlocks: `noteAchievements(set, ['fish10'])` returns `['bucket']`, second call `[]`;
   `hatAvailable('straw'|'none', empty)` true, `'beanie'` false until `tiles25`; every `HATS.unlock`
   is a real id in `ACHIEVEMENT_IDS` (import `dist/logbook.js`).
5. Coop message validation: `cleanLook(JSON.parse(JSON.stringify({shirt:99, hat:'<img>'})),
   PARTNER_DEFAULT)` -> PARTNER_DEFAULT; `lookKey` stable for equal looks, differs on any slot change.
Also extend `tests/net-coop.test.mjs` only if its harness already exercises hello (optional).

## 6. QA screenshot plan (scratch copy of shoot.py, `raftDebug` steps)
1. Look dialog, desktop 1280x800: open from pause menu, a locked hat visible (fresh save).
2. Look dialog, phone 390x844: open from the welcome card; rows readable, no horizontal scroll.
3. Third-person avatar in two looks (title/paused view, `player` visible): default; then shirt plum,
   trousers sand, skin tone 6, hair black, bucket hat (unlock via `raftDebug` achievements).
4. First-person sleeves: in game with hook held, default vs. plum shirt / tone 6 skin.
5. Co-op (if `tests/coop-e2e.mjs` harness runs): guest changes look, host screenshot of partner.
Check `npm test` green and the console free of errors in every shot.
