# Custom raft flag: research

## Genre conventions (flags, banners, emblem pickers)
- **Survival sandboxes** use banners as a "this is mine" marker. Minecraft's loom layers patterns (stripes, cross, border, halves, a few emblems) in dye colours onto a banner. Valheim's banners are crafted in fixed dye colours. Both show the result on the cloth in the world, and every player sees it.
- **Pirate and sailing games** treat the ship flag as identity. In Sea of Thieves you pick a flag from a set of ready-made emblem designs and do not paint it yourself. Its flags flap in the wind and read from far away.
- **Cozy games** let you design one. Animal Crossing: New Horizons has an island flag you set from a custom pixel design, and it waves on a pole in the plaza.
- **What works**: a few layered parts (background, pattern, emblem) are enough to give every player a design of their own. The editor shows a live preview. Colours come from a small palette, not free RGB, so every result looks good. Players get a free pixel editor only when the game is built around it.
- **Our take (original)**: a craftable **Flagpole** decor. Press E to open a small designer with a background colour, one pattern (plain, stripes, halves, cross, border, diagonal), one of 8 simple original emblems (shell, fish, star, gull, palm, anchor, sun, wave) and an emblem colour. The cloth waves with the sailing wind's direction and strength, and both co-op players see the same design.

## How Little Raft hosts it
**Closest template: the Signboard in `dist/decor-pack.js`.** It is a per-tile design with a cached `CanvasTexture`, a lazy DOM dialog and a host-authoritative action, and the flag should copy it almost line for line. A separate content module, `name:'flags'`, keeps its save slice independent.

**Registry.**
- Add `createFlags` to the imports and the `FEATURES` array in `dist/content.js:33-47`.
- The module shape is documented at `content.js:7-31`.
- The hooks it uses are `decorModel(type, d)`, `interact(aim)`, `prompt(aim)`, `action(a, actor)`, `serialize()`, `load(data, from)`, `update(dt)`, `debug` and `dispose()`.
- A throwing module is disabled (`content.js:72-73`), so a flag bug cannot crash the game.
- Because the registry already exists, game.js needs no edits.

**Item registration**, following the decor-pack precedent rather than `items.js`:
- `dist/content-items.js`: an item at `:13-20` (for example `flagpole: item('flagpole','Flagpole','icon-flag',true)`), a recipe at `:44-52` (around wood 4, rope 2, leaf 2; the pennant costs wood 2, leaf 2, rope 1), plus `CONTENT_DECOR` and `CONTENT_BLOCK_RADIUS` at `:78-79` (radius about .1).
- game.js spreads these into `DECOR_TYPES` and `BLOCK_RADIUS` (`game.js:75,84`). Research gating is automatic: the recipe unlocks once all its ingredients are researched (storage-research).
- `items.js` (`:195-203`, `BLOCK_RADII` at `:240-244`) is the newer catalogue that bees use. Either path works, but do not register the item in both.
- **Icon**: an SVG body (48×48 viewBox, outline `#153e49`) in `dist/item-svg.js` `ITEM_ICONS` (`:10`, key `flagpole`), which `survival-ui.js:100` merges into `CUSTOM`. The sign icon at `survival-ui.js:94-97` is a nearby example. Do not add it to `SPRITES` (`survival-ui.js:21-23`) unless a symbol is added to `icons.svg`.
- **Craft book**: `dist/craft-book.js:26` `CATEGORY_OF` gets `flagpole:'building'`, and `ITEM_TEXT` near `:104-109` gets its desc/use text.
- **Ghost**: add `'flagpole'` to the `DECOR` set in `dist/coop-fx.js:10` (optional).
- **Preload**: add the static-imported files (`flags.js`, `flags-core.js`, `flags-model.js`) to `PRELOAD` in `dist/live.js:16-36`, which `tests/live-preload.test.mjs` enforces. The lazy `flags-ui.js` must stay out of it. Every import keeps the `?build=v3-survival-ae77fa84ac2b` suffix (`tests/module-specifiers.test.mjs`).

**Models and rebuild.**
- `rebuildRaft()` (`game.js:607-613`) calls `content.decorModel(d.type, d)`, sets position `(x*2,.22,z*2)`, and overrides `rotation.y` with `d.rot` when it is set (placement rotation, `cleanWorld` `game.js:205-206`).
- Each rebuild calls `disposeGeometry` (`game.js:385`).
- It skips geometry with `userData.shared` and materials with `userData.shared`, and otherwise disposes the material and its `.map`.
- Mark the shared pole geometry, cloth geometry and the cached cloth materials as shared.
- Decor-pack does the same with no-op `dispose` overrides (`decor-pack.js:48`, `decor-pack-models.js:35`).
- Build the pole once as merged vertex-coloured geometry (`buildDecorPack`, `decor-pack-models.js:180-213`) and hand out cheap instances.

**CanvasTexture and caching.** Precedent: `decor-pack.js:31-63`. It keeps a `Map<designKey,{tex,mat}>`, uses `SRGBColorSpace` and anisotropy 4, overrides dispose with a no-op, and `prune()` frees entries no pole uses any more. Other uses are `coop-avatar.js:153`, `instruments.js:92`, `models.js:37` and `wood.js:49`. For the flag:
- Key the cache by the compact design, for example `"b.p.pc.e.ec"`. Two poles with the same design share one texture.
- Use a 128×64 canvas, about 43 KB with mips. 24 distinct designs come to about 1 MB.
- Draw emblems from **SVG path strings** with `new Path2D(d)`. The same strings then drive the canvas texture, the dialog preview (inline `<svg>`) and the item icon: one source of art.
- Use a canvas fallback like `makeCanvas()` (`decor-pack.js:31-37`), returning no texture in node tests.

**Wind.**
- `world.sailing` holds `windDir` (rad) and `windStr` (0.3..1.2), from `sailing-core.js:31,62-66`.
- The host sends it in every state message (`game.js:1567`), so guests see the same wind with no extra sync.
- `sailing-world.js:23,284` mirrors it into `info` for the HUD.
- The raft group never yaws: the world moves past it (`game.js:446`).
- A decor flag therefore turns by `windDir - group.rotation.y`, exactly as the pennant does at `decor-pack.js:166-174` (`amp = .08 + .35*ws*ws`).
- The sail's own pennant (`sailing-world.js:180-183`) also subtracts the heading, because sail groups rotate.
- Fall back to `windDir 0` and `windStr .3` when `world.sailing` is missing.

**Cloth wave, two options:**
1. **Vertex shader (recommended).** Use `MeshLambertMaterial({map, side:DoubleSide})` with `onBeforeCompile` injecting at `#include <begin_vertex>`. The offset is `z += amp * u * sin(k*u - w*t + phase)`, where u is the distance from the pole (0 at the hoist, so that edge stays pinned). Precedent: `coop-avatar.js:322-328` with `customProgramCacheKey`. Each design has its own material, but all of them point at **one shared uniforms object** (`uTime`, `uStr`), so `update()` writes two floats per frame no matter how many poles there are. Derive the per-pole phase from the position in `modelMatrix` in the shader so there is no per-pole uniform. Use a `PlaneGeometry(1.1,.7,10,4)` translated so x starts at 0. Vertex normals stay flat, which is acceptable for a Lambert cloth. An opaque material avoids the `forceSinglePass` lint (`tests/perf-lint.test.mjs`).
2. **CPU per-frame vertex update.** Each pole needs its own geometry: 55 verts, an `attributes.position.needsUpdate` upload, and `computeVertexNormals` every frame. That is cheap at 1-5 poles but grows linearly, and the geometry cannot be shared. Use it only if the shader option fights the material cache.

In both options the whole cloth pivot also yaws downwind, as the pennant `swing` child does (`decor-pack-models.js:198`).

**Dialog pattern (copy `dist/signs-ui.js`).** It uses one `<dialog>` that is lazy-imported (`decor-pack.js:106-115`) and created by DOM API only, with no `innerHTML` from data, and an id-guarded CSS `<style>`.
- `interact()` checks `ctx.uiOpen()` (`decor-pack.js:203`), then calls `ctx.releaseLock()` (`game.js:429`, which does `clearInput` and exits pointer lock) and `showModal()`.
- Focus moves on a `setTimeout(0)` so the triggering E keydown does not land in the dialog (`signs-ui.js:61-63`).
- Close calls `ctx.requestLock()` only `if (ctx.running)` (`signs-ui.js:66-70`). `cancel` is `preventDefault` followed by `close` (`:72`). The dialog stops keydown propagation except Escape (`:73`) and stops wheel propagation (`:74`). A backdrop click closes it (`:75`).
- **The game blocks input by itself**: `uiBlocked()` is `dialog[open]` or the open inventory (`game.js:354-355`), and `keyDecision` (`input-rules.js:5-7`, used at `game.js:1728`) makes keys record but not act. The action map does the same with `isBlocked`, and fields are matched by `input.js:12,22`. The maptable dialog (`maptable-ui.js:317-326`) refuses to open while another `dialog[open]` exists. Pointer-lock behaviour is covered by `tests/pointer-lock.test.mjs` and `tests/lock-r2.test.mjs`.
- **Controls**: swatch radio buttons (8 colours, about 40px so they work on touch), a pattern row, an emblem grid with inline SVG, and a live preview. The buttons are Save, Cancel and Random. Save sends **one** action. Clicks never go over the network.
- **Palette**: 8 fixed colours, for example the paint palette at `paint.js:8-14` plus white, navy and charcoal, stored as indices.

**State, save, co-op.** The slice is `world.ext.flags = {v:1, r, s, f:{"x,z":[bg,pat,patCol,emb,embCol]}}`, small integers only, about 30 B per pole.
- `serialize()` is cached by revision `r` (`decor-pack.js:118-125`) because ext is sent about 8 times a second.
- `load(data,'net')` short-circuits on an unchanged `r`/`s` (`:126-137`). Save and restore loads clean the data and prune keys whose tile is no longer a flagpole.
- A **pure `flags-core.js`** handles validation: `cleanDesign` clamps each index to its range, `cleanSlice` validates the whole slice, and `applyFlagAction` handles the action. Copy `signs-core.js` (`REACH 3.2`, `HOST_SLACK`, `:83,103`) and unit-test it in node like `tests/signs.test.mjs`.
- Guests call `ctx.action({kind:'flag.set',x,z,d:[...]})`. The host `action()` checks the tile type and reach, cleans the design, bumps `r` and calls `ctx.emit({kind:'build',text:'Flag raised!'})` (`decor-pack.js:193-201`). Guests never mutate their state locally.
- **Old host** (a guest joins a host whose build has no flags module): `ext.flags` arrives `undefined`. Copy the bees guard: `hostHasBees` and `oldHost()` (`bees.js:106,112`) are set in `load('net')` (`bees.js:171`). The prompt then becomes "Host's game is older" and E shows a notice (`bees.js:203,211`). `sleep.js:83,98,212` uses the same pattern.
- **Old saves**: `load(undefined)` gives an empty slice. A pole with no entry draws the default design (for example sand background, plain, shell, navy), so it never looks blank.

## Risks
- **Dialog focus versus game keys.** The dialog has no text fields, so nothing types into it, but E, WASD and the digit keys must not act while it is open. `uiBlocked()` covers that. Still stop keydown propagation as signs-ui does, and never close on E. If digits pick swatches, handle them on the dialog. Do not open over another `dialog[open]`. Re-lock only while running.
- **Texture memory.** One texture per distinct design, pruned when unused, and freed with the real `Texture.prototype.dispose` on prune and in `dispose()` (`decor-pack.js:58,251`). Cap the number of poles (for example 24 entries, `MAX_SIGNS` is 32 at `signs-core.js:6`). A refusal notice as in `REFUSALS`.
- **Per-frame cost.** The shader option writes two shared uniforms and one `rotation.y` per pole per frame, with no allocations: iterate a plain array as `anim` does (`decor-pack.js:169`). The CPU option costs O(poles × verts) plus GPU uploads. Optionally pause the wave beyond about 40 m or when hidden (`bees.js:153` near check).
- **Multiple flagpoles.** *Per-pole, keyed by tile* is recommended. It matches signs and paint, it allows a "home" flag and a "fishing spot" flag, and pruning follows `world.decor` removals (the shark breaks decor at `shark.js:77`, handled by a rescan like `decor-pack.js:140-164`). A single raft-wide design is simpler, but every pole is then identical, a pole you pick up again has nothing to keep, and it would later need migrating. A middle ground: the dialog opens pre-filled with the **last design you saved**, so a matching fleet takes one click.
- **Rebuild churn.** `rebuildRaft` recreates every decor instance. Re-attach materials from the cache in `decorModel` and never call `rebuildRaft` for a design change: swap `mesh.material` in place (`applyText`, `decor-pack.js:52-57`).
- **Save compat.** A new ext slice is safe, because old builds drop unknown ext keys. A **new item kind** is not: an old build resets a bag snapshot that holds an unknown kind (`content-items.js:4`). That is an accepted, existing trade-off for every content item; mention it in the release notes. Keep the design format versioned (`v:1`) and index-based so the palette and emblem list can grow by appending.
- **Tests**: node tests for `flags-core` (clamping, reach, cap, prune, old-host undefined). Add a `raftDebug.content.flags` debug object (`place`, `set`, `open`, `close`, `isOpen`, `texCount`, `state`) for e2e screenshots, following `decor-pack.js:229-247`.
