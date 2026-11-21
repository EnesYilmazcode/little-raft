# Spec: Little Camera + photo album (+ Photo Frame decor)

Research: docs/features/camera-research.md. Original art/text only. Anchors checked at 09c78ae; re-grep before editing.

## Player story
Craft a **Little Camera** after you learn glass. Hold it, click: white flash, shutter click, and a 256x144 snapshot
goes into your **album** (key **P**, or "Photo album" in the pause menu): browse, view large, download, delete. A **Photo Frame** hangs your favourite shot on the raft; your crewmate
sees it too. Photos stay in this browser and are never part of the save or world state.

## Files
| file | role |
|---|---|
| dist/photo-store.js (new) | pure storage logic + backends (IndexedDB, localStorage, memory). No THREE, node-testable |
| dist/camera.js (new) | held-camera runtime `createCamera(T, host)`: use(), capture, flash, cooldown, prompt provider, net photo cache |
| dist/photo-album-ui.js (new) | `<dialog id="photoAlbum">`, grid / large view / delete / download / pick mode (logbook-ui pattern) |
| dist/camera-models.js (new) | `buildCameraModel(T)` held model, `buildFrameModel(T)` decor model (own procedural art) |
| dist/photo-frame.js (new) | content module `name:'photoframe'` (FEATURES): frame state in world.ext.photoframe, textures |
| items.js, item-svg.js, craft-book.js, held-items.js, audio.js, game.js, content.js, settings.js | small hooks below, tagged `// [camera]` |

## Items (dist/items.js, after the `[instruments]` block, tag `// [camera]`)
- `item('camera', 'Little Camera', 'tool', { iconTint: '#e07a5f', stack: 1, recipe: hand({ glass: 1, plastic: 2, scrap: 2, rope: 1 }), unlock: research('glass'), tip: 'Click to snap a photo. Press P to open your album.' })`
  Copies binoculars (items.js:150): category 'tool', `stack: 1`, NO `tool:true` (so no durability, no wear).
- `item('photoframe', 'Photo Frame', 'decor', { placeable: true, iconTint: '#c69860', recipe: hand({ wood: 3, glass: 1, nail: 1 }), unlock: research('glass', 'nail'), tip: 'Hang a favourite photo on your raft. Press E on it to choose one.' })`
- `BLOCK_RADII`: `photoframe: 0.15` (items.js:218 block). Glass exists (items.js:125); if a builder finds `research('glass','nail')` invalid in tests, use `research('glass')`.
- item-svg.js: `camera` (rounded body, big lens circle, small flash square, strap) and `photoframe` (wood frame,
  tiny sea/sun sketch inside), same stroke style `O` as binoculars (item-svg.js:132).
- craft-book.js: CATEGORY map `camera: 'tools', photoframe: 'survival'` (or the decor group bees use, craft-book.js:23);
  ITEM_TEXT (tests/survival.test.mjs:545 requires desc + use for every item):
  `camera: { desc: 'A little box camera with a glass lens.', use: 'Click to snap photos; P opens your album.' }`,
  `photoframe: { desc: 'A driftwood frame with a glass front.', use: 'Place it, then press E to show a photo.' }`.

## Held model (dist/camera-models.js + held-items.js)
- `buildCameraModel(T)`: ~0.14 x 0.09 x 0.07 group, origin at the grip (right side); body box (cream plastic),
  lens cylinder (dark, glass ring `0xbfe6ef`), flash window, shutter button, rope strap loop. <= 8 meshes, own
  materials, `userData.gripFrac` like instrument-models.js. hammer.js-style header comment (size, axes, meshes).
- held-items.js: import it; in `buildItemModel` add `if (!root && kind === 'camera') root = fit(T, buildCameraModel(T), SIZE.camera, ...)`
  next to the `[instruments]` line (held-items.js:192); `SIZE.camera = 0.16`;
  `HOLD.camera = { hand: 'right', pose: 'grip', rx: 0.1, ry: Math.PI }` (lens faces forward, tune in QA).
- `buildFrameModel(T)`: upright 0.5 x 0.4 frame on a little A-stand, inner plane named `photoPlane`
  (MeshBasicMaterial, placeholder texture: painted sun, sea line and seagull drawn on a 128x72 canvas once).

## Snapping (dist/camera.js, wired like instruments)
game.js hooks (all `// [camera]`):
1. import `createCamera` next to the instruments import (game.js:29); `let camTool = null;` beside `let instruments` (game.js:248).
2. create/dispose next to instruments (game.js:408, 1813); pass getters (`hands:() => hands`) if not built yet:
   `camTool = createCamera(T, {scene, camera, renderer, hands:() => hands, ghosts:() => ghosts, quality, diving:() => diving, sfx, notice, send, netReady:() => networkReady, role:() => role, running:() => running})`.
3. useSelected (game.js:996): `if (camTool?.use(kind)) { swing = .3; return; } // [camera]` right after the instruments line.
4. frame(): `camTool?.update(dt)` next to instruments.update (game.js:1287), same try/catch-dispose shape.
5. net (game.js:1552): `if (data.type === 'photo') { if (isHost) lastGuestMessage = performance.now(); camTool?.onNet(data); return; } // [camera]`.
6. raftDebug: `get camera() { return camTool?.debug ?? null; }` next to progression (game.js:1733).

`use(kind)`: returns false unless `kind === 'camera'`. Returns true (consumes the click) otherwise; if
`now - lastShot < 0.6 s` or a capture is in flight, it does nothing more. Else `capture()`.

`capture()` - synchronous part (all in the click task; the WebGL canvas has no preserveDrawingBuffer, game.js:389):
1. save + hide: `hands.group.visible`, `camera.getObjectByName('viewmodelDepthClear').visible`, `ghosts.hide()`.
2. `renderer.render(scene, camera); diving()?.render(renderer)`.
3. `ctx2d.drawImage(renderer.domElement, sx, sy, sw, sh, 0, 0, 256, 144)` with a center 16:9 crop of the drawing
   buffer (reuse one 256x144 canvas). Pattern: item-icons.js:168-191.
4. restore visibility in `finally`; `quality.reset()` (game.js:1784 usage) so the double render is not read as a slow frame.
5. flash: one reused fixed div `#cameraFlash` (white, pointer-events none, z above HUD) opacity .9 -> 0 over 180 ms
   (CSS transition; respects prefers-reduced-motion: opacity .4); `sfx.play('shutter')`.
Async: `canvas.toBlob(cb, 'image/jpeg', .75)` (re-encode at .6 if > 20 KB), then `store.add({id: newId(), at: Date.now(), day, blob})` -> notice "Photo saved (n/24). P opens your album."
`day` = `raftDebug?.content?.daynight?.day` if finite. Any error: console.warn + notice "The camera jammed. Try again.", never throw.

Prompt: `raftPrompts.provide({id:'camera', priority:1, prompt})` (instruments.js:183-193 shape): when
`state.heldKind === 'camera'` and not `pickup`/`swimming`/guest-waiting -> `[{key:'LMB', label:'Snap'}, {key:'P', label:'Album', muted:true}]`, else null.

## Audio (dist/audio.js)
Add `'shutter'` to EVENTS (audio.js:23) and `shutter: 0.25` to MIN_GAP (audio.js:31). Recipe: 25 ms bandpassed
noise tick (~3 kHz) + 15 ms second tick at +60 ms + soft triangle whirr 220 -> 160 Hz over 120 ms, gain <= .25, on the
effects bus via the `osc()` helper (audio.js:207). Check any audio test that enumerates EVENTS still passes.

## Storage (dist/photo-store.js)
```
export const PHOTO_CAP = 24, DB_NAME = 'little-raft-photos', LS_KEY = 'little-raft-photos-v1', MAX_DATA = 24000;
export const ID_RE = /^p[a-z0-9]{6,24}$/, DATA_PREFIX = 'data:image/jpeg;base64,';
export function newId(now, rnd) // 'p' + now.toString(36) + 4 base36 chars
export function canAdd(list, cap = PHOTO_CAP) // -> {ok:true} | {ok:false, reason:'full'}
export function cleanMeta(rec) // -> {id, at, day?} or null (bad id / non-finite at)
export function validPhotoData(s) // string, starts with DATA_PREFIX, length <= MAX_DATA, base64 tail /^[A-Za-z0-9+/]+=*$/
export function memoryBackend() / localBackend(storage) / idbBackend(indexedDB) // {kind, list(), put(rec), get(id), del(id)} all async
export async function openPhotoStore({backends, notice}) // tries each in order, first whose open/list succeeds
```
- Backend order: `idbBackend(globalThis.indexedDB)` (db `little-raft-photos` v1, object store `photos`, keyPath `id`,
  values `{id, at, day, blob}`) -> `localBackend(localStorage)` (one JSON key `little-raft-photos-v1`: array of
  `{id, at, day, data:<dataURL>}`) -> `memoryBackend()`. Falling to memory shows once: "Photos will only last until you
  close this tab." The photo key never touches `little-raft-v1` or world/ext.
- **Cap decision: refuse, never silently drop.** At 24 photos `add` returns `{ok:false, reason:'full'}`, the shot is
  discarded and the notice says "Album full (24). Press P to make room." (no silent loss of a memory).
- Store API: `list()` (meta sorted newest first), `add({id, at, day, blob})` (checks canAdd; localBackend converts to dataURL),
  `url(id)` -> object URL or dataURL (cached; revoke on delete), `dataURL(id)` (for the net share), `remove(id)`.
- QuotaExceededError / any put failure -> `{ok:false, reason:'quota'}` and notice "No room to keep more photos here."
  Every backend call is try/catch; a failing backend mid-session switches to memory for the rest of it.

## Album (dist/photo-album-ui.js)
`createPhotoAlbumUI({store, onPause, onResume, onPick})`, lazily built `<dialog id="photoAlbum">` like
logbook-ui.js:83-214: showModal with attribute fallback, `cancel` -> close, hot-reload instance guard, global key
**KeyP** (free today: input-map.js:40-59 and grep of `e.code ===`; recheck that recycler/crew-tasks did not take it)
which refuses while another dialog is open or `document.body` is not `.playing`, plus the event
`littleraft:open-album`. Wire in game.js next to createLogbookUI (game.js:1842) with `onPause:guard(pauseInput), onResume:guard(() => requestLock())`.
- Grid: 4 columns (3 under 520 px), `<img loading=lazy>` thumbs + date; header "Photo album n/24"; empty: "No photos yet. Craft a Little Camera and click to snap."
- Large view: click a thumb -> 768x432 max image, Prev/Next (arrow keys), **Download** (`a[download]="little-raft-<id>.jpg"`
  on the stored URL; on iOS open in a new tab), **Delete** (confirm on second click within 3 s), Back.
- Pick mode `open({pick:true, frameKey})`: title "Choose a photo for this frame", click a thumb -> `onPick(id)`; an
  "Empty frame" button -> `onPick(null)`.
- Pause menu: settings.js:145 add `<button type="button" data-act="album">Photo album</button>` after the logbook button
  and in the click handler (settings.js:369) `if (act === 'album') { close(false); document.dispatchEvent(new CustomEvent('littleraft:open-album')); return; }`.
- Help dialog line (dist/index.html:14 guide list): `<li><kbd>P</kbd><span><b>Album.</b> Your photos from the camera.</span></li>`.

## Photo Frame v1 (dist/photo-frame.js, content module) - phase 2 if the round is short
- Register in content.js FEATURES (content.js:31) as `createPhotoFrame`; `decorModel('photoframe')` -> `buildFrameModel(T)`.
- State: `world.ext.photoframe = {v:1, f:{"x,z": {id, owner:'host'|'guest'}}}`. `cleanFrames(data, decor)`: drop
  non-object data, keys not `/^-?\d+,-?\d+$/`, bad `id` (ID_RE), bad owner; when `decor` is given also drop keys with no
  `photoframe` decor at that tile; cap 64 entries. `load(undefined)` -> empty (old saves fine). Frames with no entry
  show the placeholder. `serialize()` returns the cleaned object (host prunes removed frames).
- E on a frame (`interact(aim)`, nearest-frame ray test like bees.js:116-135): opens the album in pick mode
  (`document.dispatchEvent(new CustomEvent('littleraft:open-album', {detail:{pick:true, frameKey}}))`). onPick ->
  `ctx.action({kind:'photoframe:set', key, id})`. Host `action`: validate key has a frame, id null or ID_RE, set
  `{id, owner:actor}` (or delete), return true. Prompt provider `photoframe` priority 1: aimed frame -> `{key:'E', label:'Choose photo'}`, null if pickup shows.
- Textures: `update()` scans `ctx.raft.children` for objects with a `photoPlane` child (cached until decor/state
  `rev` changes, like bees scanHives) and matches them to tiles by position (x*2, z*2). For each frame: if owner is me,
  texture from `store.url(id)`; else from `camTool` net cache; else placeholder. One `T.Texture` per photo id
  (Image -> `colorSpace = SRGBColorSpace`), disposed when no frame uses it. `load(..,'net')` only compares a
  signature string and marks dirty; no mesh rebuilds.
- Sharing (camera.js): `{type:'photo', id, data}` sent by the owner (a) right after a set, (b) once after
  `netReady` turns true for every frame it owns; at most once per id per 10 s. A partner may ask with
  `{type:'photo', id, want:1}` when it sees an unknown foreign id (once per 15 s per id). `onNet(m)` accepts only
  `ID_RE.test(m.id)` and (`m.want === 1` or `validPhotoData(m.data)`); keeps <= 32 foreign photos in memory (LRU), never
  in the album or storage. A missing or offline owner -> placeholder forever, save untouched.

## Tests: tests/camera.test.mjs (node --test, no DOM; import photo-store.js, camera.js pure exports, photo-frame.js, items.js)
1. Storage fallback: `openPhotoStore` with a throwing idb fake -> local fake; local fake whose getItem throws -> memory,
   and the one-time memory notice fires once. Fake localStorage: put/list/del round trip, newest first.
2. Cap: 24 adds ok, 25th -> `{ok:false, reason:'full'}`, list length stays 24; after one remove, add works again.
   Quota: fake setItem throws `QuotaExceededError` -> `{ok:false, reason:'quota'}`, previous photos intact.
3. Meta: `cleanMeta` drops bad ids / NaN `at`; corrupt LS JSON -> empty list, no throw. `newId` matches ID_RE and is unique for 1000 calls.
4. Net validation: `validPhotoData` accepts a small real JPEG dataURL; rejects png prefix, length > MAX_DATA, non-string,
   bad base64 chars, `javascript:`; `onNet` ignores bad ids and bad data, caches good ones, LRU cap 32.
5. Frame state: `cleanFrames(undefined)` -> `{v:1, f:{}}`; drops bad keys/ids/owners and entries whose decor is gone; 64 cap;
   host `action('photoframe:set')` on a non-frame tile -> handled but no change; null id clears.
6. Item rules: `ITEMS.camera` stack 1, `tool` false, no `durability`, category 'tool', recipe has glass; `toolRole('camera') === 'camera'`;
   `photoframe` placeable with a BLOCK_RADII entry; both have craft-book ITEM_TEXT desc/use and an item-svg icon;
   `'shutter'` in audio EVENTS with a MIN_GAP.
7. Cooldown: a pure `shotGate(now, last, busy)` helper -> false inside 0.6 s or while busy.
Run the whole `npm test` too (progression, survival craft-book, content and audio tests enumerate items/events).

## QA plan (screenshots via the patched shoot.py; probes through window.raftDebug)
1. Give camera (`raftDebug` give helper), hold: viewmodel visible lower right, prompt "LMB Snap".
2. Click: flash visible ~0.2 s, shutter sound, notice "Photo saved (1/24)". Spam-click: at most ~1.6 shots/s.
3. Open album (P and pause-menu button): the thumb shows the sea/raft, NO hands, hammer ghost or HUD; not black.
   Test with renderScale 0.5 and quality low; and while diving (overlay included, no crash).
4. Large view, prev/next, download (file opens), delete (second click), counter updates. Reload: photos persist (IDB).
5. Private window / blocked storage: snaps still work, one memory notice. Fill to 24: 25th refused with notice.
6. Frame: place, E -> pick mode -> photo appears; reload keeps it; empty frame works; old save without
   world.ext.photoframe loads fine. Remove the frame: entry pruned.
7. Co-op (tests/coop-e2e.mjs style, two tabs): host frames a photo, guest sees placeholder then the photo within ~1 s;
   guest frames own photo, host sees it; guest leaves -> host frame shows placeholder; save never contains image data
   (`JSON.stringify(world).length` unchanged by ~KB-scale). Host state size unaffected.
8. Perf: frame-time spike for one snap < 2 normal frames; quality level does not drop after 10 snaps.

## Build notes
Built as specced except:
- `newId` adds 6 random base36 chars, not 4, so 1000 quick ids never clash (still matches ID_RE).
- The JPEG is re-encoded at .6 (then .45) when it is bigger than 17 KB, not 20 KB, so its data URL stays under MAX_DATA (24000 chars) and can be shared. Real 256x144 shots come out at about 7 KB at .75.
- `busy` lasts until the encode and store write finish, so a new shot can't start while one is still being saved. On a slow GPU this gap can be longer than the 0.6 s cooldown.
- `day` comes from `raftDebug.content.daynight.state().day`, because the daynight debug object has no `day` field. `quality` is passed to createCamera as a getter.
- `game.js prepareDom()` replaces `#help .guide` at mount, so the P line is in both places: index.html and game.js's guide list.
- Pick mode passes its callback in the open event (`detail.onPick`). game.js does not wire `onPick`. In the large view, Escape goes back to the grid; in the grid, it closes the album.
- Held camera: `HOLD.camera = {rx: .1, rz: -1}` (with `ry: Math.PI` the lens faced the player; without the tilt the body sat behind the hotbar) and `SIZE.camera = 0.13`.
- Review fixes: the flash holds full white for 70 ms, then fades over .32 s (one rAF of white was easy to miss). A save still in flight after 12 s (`STUCK_S`, hung storage) no longer locks the camera; its late finish can't unlock a newer shot. A partner's explicit `want` is answered under its own 3 s per-id gate, so a recent broadcast that the partner missed (reconnect) no longer delays it by 10-15 s. The frame module's serialize cache is keyed on the frame tiles, not the decor count.
- The frame prompt provider uses priority 2, so when you aim at a frame "E Choose/Change photo" shows instead of the camera's own Snap prompt.
- If the co-op link drops, the foreign photo cache is cleared and the partner's frames go back to the placeholder. camera.js exposes `photoNet.current` (`share`, `request`, `foreign`, `onPhoto`, `netReady`, `clearForeign`) to the frame module.
- `rebuildRaft()`'s disposeGeometry also disposes the frame textures. They are uploaded again on the next draw, and the frame module marks itself dirty when its rescan sees new groups.
- QA helpers: `raftDebug.camera` (shots, count, store kind, `snap()`, `list()`, `dataURL(id)`), `raftDebug.album`, and `raftDebug.content.photoframe` (`place`, `frames`, `textures`, `state`, `pick`).
- Verified in a two-tab loopback run (host IndexedDB, guest memory store): each side sees the other's framed photo, the save has no image data, and the guest's frame returns to the placeholder on the host when the guest leaves. Not yet verified: diving-overlay capture.
