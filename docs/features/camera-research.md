# Camera + photo album: research

Round feature (3): snap small photos of the raft, keep them in a local album, optionally hang one on the
raft in a frame. Little Raft is an original game; nothing below copies names, art or text from any
commercial title. Anchors are file:line in the current tree (branch claude/loop-features-202611210749,
checked against 7294e26). Lines move fast: re-grep the quoted text before editing.

## (a) Genre patterns

- **Photo mode** (many open-world and cozy games): pause, free camera, filters, hide HUD, save a
  screenshot to disk. Powerful but heavy (free-fly camera, collision, UI for filters).
- **In-game camera item** (cozy life sims, exploration games): a held tool; aim, click, a shutter flash,
  the shot lands in an album. Diegetic, fits a first-person sandbox, cheap to build.
- **Album / scrapbook**: a grid of thumbnails, open one large, delete, sometimes captions/dates. Often
  doubles as a soft goal ("photograph 10 kinds of fish").
- **Framed photos as decor**: a placeable frame that shows a chosen shot, turning memories into raft
  decoration. Common in house-building games; the frame is the social payoff in co-op.

### Our cozy take: the Little Camera

- **Craftable held item** `camera` ("Little Camera"): category 'tool', stack 1, no durability
  (like binoculars), hand recipe e.g. glass 1 + plastic 2 + scrap 2, unlocked with glass research.
- **Click to snap**: a white shutter flash (DOM div fading 0.9 -> 0 in ~180 ms) plus a soft procedural
  click-whirr. Short cooldown (~0.6 s) so held clicks do not spam.
- **Clean capture**: hands viewmodel (and its depth-clear marker) and build ghosts are hidden for the one
  capture render; the DOM HUD is never in the canvas, so it does not need hiding for the image itself.
  The friend's avatar and pets stay in the shot (that is the point).
- **Storage**: a 256x144 JPEG (q ~0.75, ~8-15 KB) + `{id, at, day}` metadata. Cap 24 photos; at the cap
  the 25th asks to delete one (or drops the oldest with a notice). Prefer IndexedDB (`little-raft-photos`
  db), fall back to one localStorage key `little-raft-photos-v1`, fall back to memory-only.
- **Album dialog** (key P or from the inventory): grid of thumbnails, click to view large, Delete,
  Download PNG (re-encode the stored JPEG through a canvas, or just offer the JPEG; `a[download]`).
- **Optional Photo Frame decor** (`photoframe`, CONTENT_DECOR): E on a frame opens the album in "pick"
  mode; the chosen photo becomes a CanvasTexture on the frame's inner plane.
- **Co-op**: photos are per-browser, never in world state. The frame's world entry stores only
  `{type:'photoframe', photo:<id>, owner:'host'|'guest'}`. The owner sends the JPEG once as its own net
  message (`{type:'photo', id, data}`, like `type:'inst'` at game.js:1552), the partner caches it in
  memory (not in their album); until it arrives, or if the owner is offline, the frame shows a
  placeholder (a painted seagull sketch). Never put image bytes in world.ext (EXT_MAX 200000 chars,
  content.js:33, and the ~8x/s host state would resend it).

## (b) Code anchors

**Renderer / capture**
- dist/game.js:389 `new T.WebGLRenderer({canvas, antialias:devicePixelRatio < 1.5})`: no
  `preserveDrawingBuffer`, so the canvas is only readable in the same task right after a render. Do not
  turn it on (costs perf every frame on tilers/phones).
- dist/game.js:390-391 size, SRGB output, ACES tone mapping (a render target capture would have to repeat
  the output conversion; rendering to the canvas avoids that).
- dist/game.js:1270 `frame()`; dist/game.js:1310 `renderer.render(scene, camera); diving?.render(renderer)`
  (diving overlay draws after, dist/diving.js:12,320). Recommended capture: in the click handler (or at the
  end of frame on a `wantShot` flag) hide viewmodel, `renderer.render(scene, camera)` (+ diving render),
  then immediately `ctx2d.drawImage(renderer.domElement, sx, sy, sw, sh, 0, 0, 256, 144)` (center crop to
  16:9), restore, then `canvas2.toBlob(cb, 'image/jpeg', .75)` (async encode, off the main thread).
- Precedent: dist/item-icons.js:166-170 renders, copies the WebGL canvas to a 2D canvas with drawImage,
  and encodes later with toBlob (dist/item-icons.js:182-191). Copy that shape.
- Alternative: WebGLRenderTarget 256x144 + `renderer.readPixels` - needs a flip, manual sRGB/tone-map
  handling and a sync GPU stall; only worth it if the canvas path misbehaves.

**What to hide**
- dist/game.js:449-457 `buildViewmodels()`: `hands.group` and the `viewmodelDepthClear` mesh
  (renderOrder 999, clears depth in onBeforeRender, game.js:455) are camera children. Toggle
  `hands.group.visible`; the depth clear is harmless alone but can be hidden too.
- dist/game.js:1157 `hands.setHeld(running ? kind : null)` - the camera model would be the held mesh.
- Build ghosts: dist/game.js:1260 `ghosts.hide()`.
- dist/game.js:1168 local `player.visible = !running` (already hidden in first person).
- DOM HUD (only for the flash moment, not the image): index.html:5 `#crosshair`, index.html:9 `#hud`,
  `#contextPrompt` (game.js:90), `#signalReadout`/`#signalMarker` (game.js:94,98), `#binocularsHud`
  (progression-hooks.js:245), `#lrPrompt`/`#lrFeed` (prompts.css:3), `#pickupFeed` (style.css:21).

**Held item / tools**
- Crafting UI uses the progression items: dist/items.js:64-67 `item()` (tool:true forces stack 1 and
  durability); dist/items.js:150-152 binoculars = category 'tool', `stack: 1`, no `tool:true`, no wear.
  The camera should copy binoculars. dist/items.js:373 `toolRole(kind)`.
- Item icon art: dist/item-svg.js:132 (binoculars SVG); craft-book blurbs dist/craft-book.js:20,72.
- Left-click dispatch: dist/game.js:991 `useSelected(aim)`; dist/game.js:996
  `if (instruments?.use(kind)) { swing = .7; return; }` - the camera hook goes right beside it
  (content modules have no use() hook, content.js:7-19, so either add one or a `[camera]` line here).
- Held-item HUD precedent: progression-hooks.js:239-250 (shows only while binoculars are selected).

**Audio**
- dist/audio.js:22 `EVENTS` (no shutter; 'ui' / 'craft' are closest), dist/audio.js:499 `play()`,
  dist/audio.js:207 `osc()` helper, MIN_GAP table dist/audio.js:31. Add a `shutter` recipe (short
  filtered noise tick + low triangle whirr) and its MIN_GAP, or reuse `play('ui')` as a v1.

**Dialog pattern**
- dist/logbook-ui.js:83 builds a `<dialog id="logbook">` lazily; :104 `createLogbookUI({getProgress,
  onPause, onResume})`; :169 showModal with attribute fallback; :182 `cancel` -> close; :203-210 global
  key (KeyL) that refuses when another dialog is open; :105/:261 hot-reload instance guard.
  Wired in game.js:1842 with `onPause:guard(pauseInput), onResume:guard(() => requestLock())`.
- game.js:1307 behind an open blurred dialog the world redraws at ~10 fps - fine for an album.

**Storage keys in use** (avoid collisions; the photo key must never share the main save)
- `little-raft-v1` (main save, game.js:77, onboarding.js:6), `little-raft-onboarding-v1`,
  `little-raft-autostart`, `little-raft-settings` (settings.js:9), `little-raft-sound`, `little-raft-hints`
  (hud.js:24,38), `little-raft-logbook-seen` (logbook-ui.js:7), `little-raft-pinned-recipe`
  (craft-book.js:312), `little-raft-fc-v1` (fishing-cooking.js:17), `littleRaft.progression.v1`
  (progression-hooks.js:18), `little-raft-prompts-v1` (prompts.js:13), `little-raft-name` (coop.js:34),
  `little-raft.daynight` (daynight.js:261). No IndexedDB use yet.
- Save writes are try/catch guarded (game.js:1078-1080); a quota error from photos in the same
  localStorage origin could make the MAIN save fail - another reason to prefer IndexedDB.

**Quality / resolution**
- No "fixedres" setting exists. dist/quality.js:6-8 presets (pixelRatio 1 / 1.3 / 1.5) and :29-34 the
  adaptive ladder (down to 0.85); dist/game.js:1046-1050 `applyUserGraphics()` applies
  `options.renderScale` (settings.js:21, 0.5-1). The drawing buffer can be as small as ~0.5x CSS size, so
  a 256x144 thumbnail is always safely downscaled; do not change pixel ratio for a shot (forces a
  reallocation hitch). The quality scaler might read the capture frame as a slow frame: call
  `quality.reset()` (used at game.js:1784) or skip its tick for that frame.

**Prompts**: content prompt() text is hidden by prompts.css; a frame's "E: choose photo" needs a
`raftPrompts.provide({...})` provider (prompts.js:4) that returns null while a pickup prompt shows.

## (c) Risks

- **Perf hitch**: the extra render roughly doubles one frame (shadows included). Mitigate: capture at
  most once per click with a cooldown, encode with async `toBlob`, never `toDataURL` on the main thread
  for the large image, no pixel-ratio change. Tell the quality scaler to ignore that frame.
- **Readback blank**: without preserveDrawingBuffer, drawImage after an await or in a later task gives a
  black image. Copy synchronously right after the capture render.
- **Storage quota**: 24 x ~15 KB is ~360 KB raw, ~480 KB as base64 in localStorage (5 MB origin total,
  shared with the main save). IndexedDB stores Blobs without base64. Handle QuotaExceededError: notice
  "Album is full" and keep the main save safe.
- **Private mode**: Safari private / blocked storage can throw on open or write; IndexedDB may be
  missing. Fall back to an in-memory album with a one-time notice ("Photos will not be kept after you
  close the tab"); never let a throw reach the game loop.
- **Phone / touch**: tap-to-use already maps to left click; small screens make the album grid 3 columns;
  download via `a[download]` is unreliable on iOS - open the image in a new tab as fallback. Lower-end
  GPUs feel the double render most.
- **Co-op**: image bytes over the data channel should be one message of < ~16 KB (a 256x144 JPEG fits;
  cap the encode at q .7 if larger, or chunk). Guests receive frames as placeholders until the owner's
  photo arrives; a guest-owned photo on a host save is gone when the guest leaves - keep a placeholder,
  never break the save. Frames must load from old saves without the `photo` field (placeholder).
- **Privacy**: photos never leave the browser except a frame image explicitly shared with the crew.
