# Spec: decoration pack and writable signs

Source: docs/features/decor-signs-research.md. One builder. Seven placeable decor items (six cozy pieces and a Signboard) can all be turned in quarter steps, and the sign carries up to 3 short lines of text.
New files: `dist/decor-pack.js` (content module), `dist/decor-pack-models.js` (THREE models and the sign canvas painter), `dist/signs-core.js` (pure), `dist/signs-ui.js` (dialog, lazy-loaded), `tests/signs.test.mjs`, `tests/decor-pack.test.mjs`.
Imports inside these files have no `?build=` suffix, like storage-research.js. There is one content module, `name:'decorpack'` (it owns models, animation, rotation and sign text). It shares no state with other modules.

## 1. Items, recipes, decor (dist/content-items.js, append only)
These ids are free in ITEM_INFO, RECIPES and CONTENT_ITEMS, and they avoid the parallel ids kiln/glass/ingot/brick/glasslamp/sinker/coop/nest/egg/feather. Every item is `placeholder:true` and reuses an existing sprite.

| kind | name | icon | cost | block r |
|---|---|---|---|---|
| `rug` | Woven Deck Mat | icon-leaf | leaf 4, rope 2 | (none) |
| `pennant` | Wind Pennant | icon-sail | wood 2, leaf 2, rope 1 | .1 |
| `fern` | Hanging Fern Post | icon-palm | wood 2, rope 2, leaf 3 | .12 |
| `chime` | Shell Chime | icon-lantern | wood 1, scrap 2, rope 2 | .12 |
| `hammock` | Rope Hammock | icon-net | wood 4, rope 4, leaf 2 | .45 |
| `pots` | Clay Pot Trio | icon-palm | clay 3, leaf 2 | .3 |
| `sign` | Signboard | icon-repair | wood 3, rope 1 | .1 |

- Add 7 `item(...)` lines to `CONTENT_ITEMS` and 7 `recipe(id, name, 1, cost)` lines to `CONTENT_RECIPES`. Append `'rug','pennant','fern','chime','hammock','pots','sign'` to `CONTENT_DECOR`, and the six radii to `CONTENT_BLOCK_RADIUS` (rug has none, so you can walk on it).
  Other builders edit the same arrays, so re-read each array right before you edit it and append inside it.
- `dist/coop-fx.js:10`: append the 7 ids to the `DECOR` set (ghost footprint). This one-line edit is optional.

## 2. Research gating (no code change in storage-research.js)
- **No new starter recipes.** `STARTER` stays `rope, hook, hammer, crate, research`. Every pack recipe unlocks automatically once all of its cost kinds have been researched (`learnedFrom`).
- A fresh player can reach most of the pack: collect wood, leaf and scrap from the drift; craft Rope (starter) and a Research Table (starter); then research
  wood + rope, which unlocks **Signboard**, with bench, net and fishingrod. Leaf + rope unlocks the **Woven Deck Mat**. Wood + leaf + rope unlocks the
  **Pennant, Fern Post and Hammock** too. Adding scrap unlocks the **Shell Chime**. The **Clay Pot Trio** needs clay, which comes from diving, so it is the late reward.
- Progressed saves: the `learned` list is recomputed from `seen` on load, so a world that has already researched wood, leaf, rope and scrap gets 6 of the 7 at once. Clay becomes a new researchable kind.
- **Existing tests change**, because recipes join the tree by cost. In `tests/storage-research.test.mjs`, the `learnedFrom` asserts at lines ~276–280 and the emit list at ~297
  gain the new ids or names. Do not hard-code the new ids. Add a helper at the top, `const PACK = new Set(['rug','pennant','fern','chime','hammock','pots','sign']); const base = a => a.filter(id => !PACK.has(id));`,
  wrap those `learnedFrom(...)` results in `base(...)`, and filter `'New recipe: Signboard!'` out of the emit list. Other designers' recipes may need the same filter, so coordinate with them.

## 3. Two tiny anchored engine edits (rotation needs the tile)
- `dist/game.js` (rebuildRaft, line ~428): `content?.decorModel(d.type) ?? createSignalModel` → `content?.decorModel(d.type, d) ?? createSignalModel`.
- `dist/content.js`: `decorModel: type => first('decorModel', type),` → `decorModel: (type, d) => first('decorModel', type, d),`. In the header comment, change `decorModel(type)` to `decorModel(type, d)` (d = the world.decor entry, read-only).
- Append `createDecorPack` to `FEATURES` directly after `createStorage`, with `import { createDecorPack } from './decor-pack.js';`.
- Why this is safe: rebuildRaft only sets `position`, so the `rotation.y` that the module sets survives. Older modules ignore the 2nd argument. createCraft, createPurifier and createSignalModel return null for these types, so nothing else claims them.

## 4. Models: dist/decor-pack-models.js
`export function buildDecorPack(T)` returns `{ TYPES, instance(type), stats(), dispose(), textPlane, paintSign }`.
- It copies the `add()` and merge helpers from `storage-research-model.js` (baked transform, vertex colour, ±jitter, uv removed), with an extra scale `sx,sy,sz` argument.
  Each type's geometry is built lazily **once**. Origin = tile top centre (the game places it at y=.22), the front faces **+Z**, and the footprint stays inside ±.9 m.
- Materials (shared, 2 in total): `body = MeshStandardMaterial({vertexColors:true, roughness:.85, metalness:0})` and `cloth = same + side:DoubleSide`.
  Every shared geometry, material and texture has `dispose = noop`, so rebuildRaft's `disposeGeometry` (game.js:299) cannot free them. The real `dispose()` calls `T.BufferGeometry.prototype.dispose` and the matching prototype disposes.
- `instance(type)` returns a `Group` named `decor_<type>`, with `userData.decorType`. Meshes set `castShadow` and `receiveShadow` to true. An animated part is a child Mesh stored in `group.userData.swing`.

| type | static mesh (body) | 2nd mesh | draws |
|---|---|---|---|
| rug | 4 stacked discs `Cylinder(r,r,h,24)` scaled z .7: r .8/.62/.44/.26, h .012/.016/.02/.024, colours #6f9a4e/#c9a96b/#7fae5a/#d8bb7c; 12 tassels box .04×.01×.08 on the r .82 ellipse | none | 1 |
| pennant | base box .3×.06×.3 #7a5a3a; pole `Cylinder(.035,.045,2.4,8)` y 1.23 #8a6a45; knob `Icosahedron(.05,0)` y 2.45 #d9b25a | `swing` = flag: hand-built BufferGeometry, origin on the pole axis, extending +X. Upper band quad (0,2.32)(.9,2.32)(.62,2.14)(0,2.14) #d9583c; lower band (0,2.14)(.62,2.14)(.9,1.96)(0,1.96) #f3d37c; z=0, non-indexed, computeVertexNormals; `cloth` material | 2 |
| fern | base box .4×.05×.4 at x −.45; post `Cylinder(.05,.06,2,8)` at (−.45,1.02,0); arm box .72×.05×.05 at (−.12,1.97,0); 45° brace box .3×.04×.04 | `swing` at pivot (.2,1.95,0), geometry in pivot space: 3 cords box .01×.35×.01 fanned; basket `Cylinder(.2,.14,.18,10)` y −.45 #b08a55; soil disc #5b3d26; 7 fronds `Cone(.07,.6,3)` at y −.38, ry=i·2π/7, rz≈2.3 (drooping), alternating #4f8f45/#6cab55 | 2 |
| chime | 2 posts `Cylinder(.04,.045,1.3,8)` at x ±.35 (y .65); crossbar box .8×.05×.06 at y 1.3; 2 feet box .12×.04×.3 | `swing` at pivot (0,1.27,0): 3 cords; disc `Cylinder(.16,.16,.03,10)` y −.12 #c9b48a; 5 tubes `Cylinder(.015,.015,L,6)` with L=.28+.035i on the r .1 ring at y −.14−L/2, #b8c2c4; 5 shells `Icosahedron(.035,0)` scaled y .4 below the tubes #f3e4d0; clapper sphere .03 at the centre | 2 |
| hammock | 2 posts `Cylinder(.05,.06,1.15,8)` at (−.72,·,−.72) and (.72,·,.72); the sling is 10 box segments .22×.02×.7 on a diagonal curve y=.95−.42·sin(πs), each pitched to the curve tangent, the whole set at ry=π/4, alternating #eadcae/#c9a96b (net look); 2 end ropes; leaf pillow box .4×.1×.24 #7fae5a at the s=.12 end | none | 1 |
| pots | pots `Cylinder(rt,rb,h,12)`: (.2,.14,.32) at (−.35,·,.1), (.16,.11,.24) at (.25,·,.25), (.24,.17,.44) at (.05,·,−.3) #b8653d, plus rim (r+.02, h .04) #d59a72 and soil disc #5b3d26; per pot 3 stems box .015×.25×.015 #5f9e4f, 3 blooms `Icosahedron(.05,0)` #f2c14e/#e86f8a/#fff4e0, 2 leaf cones | none | 1 |
| sign | base box .32×.06×.32; post `Cylinder(.05,.06,1.4,8)` at (0,.7,−.06) #7a5a3a; board = 3 planks box .9×.16×.045 at y .93/1.09/1.25, z 0 (#b4824b/#a97d4c/#b98a55); 2 back battens .05×.48×.02 at z −.033 | `text` mesh (see §6), `userData.text`, `visible=false` when blank | 1 (+1) |

- `textPlane` = one shared `PlaneGeometry(.82,.42)`. `stats()` returns `{built:[types], meshes:{type:count}}` for tests.
- `paintSign(g2d, lines, w=256, h=128)` uses only the canvas 2D API, so it can be tested with a fake. Steps:
  1. Fill #c39a63, then draw 3 faint grain lines in #a97d4c.
  2. Set the font to `600 ${px}px "Trebuchet MS", system-ui, sans-serif` and start px at 30. While `px>14` and the widest `measureText(line).width>236`, decrease px by 2.
  3. Use ink #3b2a1a, `textAlign='center'` and `textBaseline='middle'`. Line pitch is px·1.15, the block is centred vertically, and the lines are drawn with `fillText` (inert: no HTML involved).

## 5. Pure core: dist/signs-core.js (no DOM, no THREE, no imports)
```js
export const PACK = Object.freeze(['rug','pennant','fern','chime','hammock','pots','sign']);
export const MAX_LINES = 3, LINE_MAX = 18, MAX_SIGNS = 32, MAX_ROT = 400, REACH = 3.2, HOST_SLACK = .8;
export const keyOf = (x, z) => x + ',' + z;
export function cleanLines(v)          // see below
export function linesKey(lines)        // lines.join('\n')  ('' = blank)
export function faceRot(dx, dz)        // ((Math.round(Math.atan2(dx, dz) / (Math.PI / 2)) % 4) + 4) % 4; non-finite -> 0
export function cleanSlice(data, decor) // -> {r, s, t, rot}
export function applyDecorAction(st, a, actor, env) // env {decorAt(x,z)->type|null, pos(actor)->{x,z}|null}; -> {ok, reason?, key?}
```
- `cleanLines(v)`: if `v` is not an array, return `[]`. Take at most the first 3 entries. For each, `String(e ?? '')`, then `.normalize('NFC')`, then remove `/[\p{Cc}\p{Cf}  ]/gu`,
  replace `/\s+/g` with `' '`, and `trim()`. Cap with `Array.from(s).slice(0,18).join('')`, so code points are never split. Then pop trailing `''` entries.
  It never throws: a `String()` that throws (a hostile toString) gives `''`.
- `cleanSlice`: a non-object gives `{r:0,s:null,t:{},rot:{}}`. `r` is a non-negative int, otherwise 0. `s` is a string ≤16 chars, otherwise null.
  Keys must match `/^-?\d{1,3},-?\d{1,3}$/`. `rot` values must be ints 0..3, at most `MAX_ROT` keys. `t` values go through `cleanLines`, empty results are dropped, and at most `MAX_SIGNS` are kept.
  If `decor` is an array, drop `t` keys whose tile is not `sign` and `rot` keys whose tile is not a PACK type.
- `applyDecorAction` kinds:
  - **`decor.turn {x,z}`**: x and z must be ints and the tile a PACK type, otherwise `notarget`. The actor must be within `REACH+HOST_SLACK` of `(x*2, z*2)` (horizontal), otherwise `far`. Then `rot[k] = ((rot[k] ?? 0) + 1) & 3`.
  - **`decor.write {x,z,lines}`**: the tile must be `sign` (otherwise `notarget`) and in reach (`far`). Run `cleanLines(a.lines)`. Blank text deletes `t[k]`. Writing a new key when `MAX_SIGNS` entries already exist gives `full`. Identical text gives `{ok:true, same:true}`.
  - Every success bumps `st.r`. A failure changes nothing.

## 6. Module: dist/decor-pack.js `createDecorPack(ctx)`
State: `st = cleanSlice(undefined)`, `st.s = session` (random 8 chars, like storage). Locals: `models` (lazy `buildDecorPack(T)`), `live = new Map()` (key → group),
`anim = []` (flat array of `{g, swing, type, ph}`), `texts = new Map()` (linesKey → `{tex, mat}`), `dirty`, and the serialize cache `{cache, cacheR}`.
- **decorModel(type, d)**: return null unless the type is in PACK, T exists and d has int x and z. Then:
  1. `g = models.instance(type)`, `g.rotation.y = (st.rot[k] ?? 0) * Math.PI/2`, `g.userData.tileKey = k`, `live.set(k, g)`.
  2. If `g.userData.swing` exists, push it onto `anim` with `ph = d.x*1.7 + d.z*2.3`.
  3. For a sign, call `applyText(g, st.t[k])`.
  4. Set `dirty = true` and return g.
- **Text cache**: `textFor(lines)` returns the cached entry or builds one: a canvas (256×128 from `document.createElement`, else `OffscreenCanvas`, else null, in which case the text stays hidden), `paintSign`, then
  `tex = new T.CanvasTexture(canvas)` with `colorSpace = T.SRGBColorSpace`, `anisotropy = 4` and the default mipmaps, and `mat = new T.MeshLambertMaterial({map:tex})`. Set both `dispose` to noop.
  Because the material is not in game's materialCache, `disposeGeometry` calls `map.dispose()` and `mat.dispose()` on every rebuild. Those are no-ops now, so the cached texture and material survive.
  `applyText(g, lines)`: when blank, set `text.visible = false`. Otherwise set `text.material = textFor(lines).mat` and `visible = true`.
  `prune()`: free (real prototype dispose) every `texts` entry whose key no longer appears in any `st.t` value. It runs after every state change. **The tile's own group is updated in place; rebuildRaft is never called for text or rotation.**
- **apply(prevT, prevRot)**: after any state change (an action, or a net, save or restore load), for each key whose rot or text differs, update `live.get(k)` (rotation and/or applyText), then call `prune()`.
- **update(dt)** (no allocations):
  - `t = ctx.elapsed`, and wind is `s = ctx.world?.sailing`, `wd = Number.isFinite(s?.windDir) ? s.windDir : 0`, `ws = Number.isFinite(s?.windStr) ? s.windStr : .3`.
  - Indexed loop over `anim`:
    - pennant: `amp = .08 + .35*ws*ws`; `swing.rotation.y = wd - g.rotation.y + amp*Math.sin(t*(4+4*ws) + ph)`; `swing.rotation.x = .2*amp*Math.sin(t*5.1 + ph)`. The flag is built along +X and its world yaw equals windDir, the same convention as the sail pennant in `sailing-world.js:146`.
    - fern: `rotation.z = .05*Math.sin(t*1.1 + ph)` and `rotation.x = .03*Math.sin(t*.8 + ph)`.
    - chime: `rotation.z = .08*Math.sin(t*1.9 + ph) + .03*Math.sin(t*4.3 + ph)` and `rotation.x = .04*Math.sin(t*1.3 + ph)`. There is no sound, because audio `EVENTS` has no chime and ctx has no audio.
  - If `dirty` (only after a rebuild; allocation is fine here): set `dirty=false` and filter `anim` and `live` down to groups with `g.parent`.
    On the **host only**, for each PACK decor tile without `st.rot[k]`, set `st.rot[k] = faceRot(nearest.x - x*2, nearest.z - z*2)`, where nearest is `ctx.physics` or `ctx.other`, whichever is closer (rot 0 if there are none).
    Then drop the `rot` and `t` keys whose tile is no longer that type. If anything changed, bump r and call apply. A fresh item therefore faces the player who placed it (a guest's placement faces the guest).
- **serialize()**: return the cached `{v:1, r, s, t, rot}` (cache by r, as storage does; hostState sends ext about 8×/s). Size ≤ 32×3×18 code points + 400 rot entries, far under EXT_MAX.
- **load(data, from)**:
  - `'net'`: if `data?.r === netR && data?.s === netS`, return. Otherwise `st = cleanSlice(data)` without decor pruning, because the guest's decor may lag and the host is authoritative. Store netR and netS, then apply.
  - `'save'`/`'restore'`: `st = cleanSlice(data, ctx.world?.decor)`, `st.s = session`, `st.r++`, reset netR and netS, then apply.
  - `undefined` (old save or old host) gives an empty state, so pack items show at rot 0 and blank.
- **action(a, actor, bag)**: return false unless `a?.kind` starts with `'decor.'`. Otherwise run `applyDecorAction(st, a, actor, {decorAt, pos})` (copy `decorAt`/`posOf` from storage-research.js:246-247), apply, emit, and return true.
  Emits go to the actor: write success `{kind:'build', text: lines.length ? 'Sign painted!' : 'Sign wiped clean'}`. `same` emits nothing, and a turn emits nothing.
  Refusals send `{kind:'notice'}`: `far` 'Step a little closer', `full` 'This raft already has 32 written signs', `notarget` nothing.
- **target(aim)**: copy the ray scoring from storage-research.js:252-270, filtered to PACK types, with cy = raft.y + (rug .1 | sign 1.09 | others .8). The off limit is .85 (rug 1.0).
- **interact(aim)**: return false if `ctx.uiOpen()` or there is no target. For a sign, `ctx.releaseLock()` and `openSign(x,z)` (lazy `import('./signs-ui.js')`, cached promise, like storage `loadUI`). For anything else, `ctx.action({kind:'decor.turn', x, z})`. Return true in both cases.
  Guests take the same path, and `ctx.action` routes to the host. Guests never touch `st`.
- **prompt(aim)**: sign → `'<kbd>E</kbd>Write on sign'`, plus `' · “' + ctx.esc(first line) + '”'` when the sign has text. Others → `'<kbd>E</kbd>Turn ' + name` (ITEM_INFO name, e.g. "Turn Wind Pennant").
- **dispose()**: `ui?.destroy()`, really dispose every `texts` entry and `textPlane`, `models?.dispose()`, then clear the maps.

## 7. Dialog: dist/signs-ui.js `createSignUI(api)`
`api = {ctx, lines(x,z), send(a), maxLines, lineMax}`. Returns `{open(x,z), close(), isOpen, destroy()}`. One `<dialog id="lr-sign" class="lr-sign">` is appended to the body once, with inline CSS that uses
the warm palette of storage-research-ui. It contains `<form>` with a title "Signboard", 3 `<input type=text maxlength=18 autocomplete=off spellcheck=false aria-label="Line n">`, a hint
"Enter saves · Esc cancels", and buttons **Save** (`type=submit`), **Turn** (`type=button`, sends `decor.turn` and stays open) and **Cancel** (`type=button`).
- `open`: fill the inputs from `api.lines(x,z)` with `.value` (never innerHTML), then `showModal()`. Put focus on a `tabindex=-1` wrapper with `autofocus`, then **`setTimeout(() => { inputs[0].focus(); inputs[0].select(); }, 0)`**.
  This matters because the legacy game.js keydown path calls interact() inside the E keydown, and focusing an input synchronously would type the "e" into it.
- Form `submit`: call `preventDefault()`, then `api.send({kind:'decor.write', x, z, lines:inputs.map(i => i.value)})` and `close()`. The host cleans the text again. Nothing is sent while typing.
- Keys: **never close on E or Tab** (unlike storage-research-ui.js:253). `dlg.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); })`. Escape must still reach `settings.js:196`, which sees
  `otherDialogOpen()` and only suppresses its keyup pause fallback. The `cancel` event calls `preventDefault()` and then `close()`. On close, call `ctx.requestLock?.()` if `ctx.running`. A click on the backdrop closes the dialog. Wheel uses stopPropagation.
- Why no key leaks: game.js:1169 returns for input targets and while `dialog[open]` exists (uiBlocked). controls.js `isBlocked` uses the same uiBlocked. input.js:62 ignores fields and blocked state, and keyup is always honoured, so nothing sticks.
  logbook-ui.js:203 (capture) ignores INPUT targets and returns while another `dialog[open]` exists. survival-ui Tab/I ignores inputs and `canOpenNow()` fails with our dialog open. coop.js emotes and fishing-cooking J/G ignore inputs. stopPropagation covers buttons.

## 8. Co-op and backward compatibility
- The host is authoritative. Guests send `decor.turn` / `decor.write` and receive `ext.decorpack` in state. `load('net')` and `apply` update their groups without a rebuild. A guest's own rebuild (decor changed) re-reads `st` in decorModel.
- Old host + new guest: `load(undefined,'net')` gives blank signs at rot 0, and the old host ignores `decor.*` actions (harmless).
- New host + old guest: the old guest's `cleanWorld` drops unknown decor types, so it never sees them. Its bag rejects unknown kinds as today (content-items header).
- Old saves: `world.ext.decorpack` is missing, so the state starts empty. Malformed slices are cleaned (§5). Rotation and text never live on `world.decor` entries (cleanWorld keeps only type, x and z).
- The `homestead` achievement stays tied to the original six decor types.

## 9. Debug: `raftDebug.content.decorpack`
- `place(type, x=0, z=0)`: host only. Fails if the tile is missing or occupied. Pushes `{type,x,z}`, calls `ctx.rebuildRaft()` and returns true.
- `write(x, z, lines)` and `turn(x, z)`: run through `ctx.action`, so they also work as a guest.
- `open(x, z)` / `close()`: open or close the sign dialog. `state()` returns a JSON copy of the slice.
- `texCount()`: `texts.size`. `anim()`: `[{type, ry, rz}]` of the swing children. `models()`: `models?.stats()`. `faceAll()`: forces the dirty scan.

## 10. Tests
`tests/signs.test.mjs` (pure, node:test):
1. `cleanLines`: non-array/null/object → []; >3 entries → 3; controls `\u0000\u0007\n\t` stripped/collapsed; bidi `‮⁦` and zero-width `​﻿` removed; 30-char line → 18; `'😀'.repeat(20)` → 18 whole emoji (no lone surrogate); NFC (`'é'` → `'é'`); trailing blanks dropped but a middle blank kept; numbers and `{toString(){throw}}` handled.
2. `faceRot`: (0,1)=0, (1,0)=1, (0,−1)=2, (−1,0)=3, (NaN,1)=0.
3. `cleanSlice`: junk → empty; bad keys, rot 4, rot 1.5 and empty lines dropped; with decor, prunes `t` on non-sign tiles and `rot` on non-PACK tiles; caps at 32 signs and 400 rots; JSON round trip is stable.
4. `applyDecorAction`: write ok bumps r; far, notarget and full refuse with state unchanged (JSON compare); blank deletes; same text gives `same:true`; turn cycles 0→1→2→3→0; guest actor uses the `pos('guest')` pose.
5. Module with fake ctx (copy makeCtx from storage-research.test.mjs, T = vendor three): `action` writes and serialize reflects it; serialize returns the same object while r is unchanged; `load(sameR,'net')` is a no-op; `load(undefined,'save')` is empty; a guest-role module never mutates on interact (it only calls ctx.action); host update assigns faceRot for a new tile toward `ctx.physics`.
`tests/decor-pack.test.mjs` (models smoke):
- For each PACK type: `decorModel(type,{x:0,z:0})` returns a Group with ≤2 meshes (sign ≤3 including text). Two instances share geometry and material. Every position count > 0 and has a `color` attribute.
  Calling `.dispose()` on the shared geometry or material keeps its attributes. `rotation.y` follows `rot`. `decorModel('crate')` returns null. `paintSign` with a fake 2D context calls `fillText` once per line and shrinks px for 18 wide 'W's.
  `update(.016)` twice moves the pennant flag and stays alloc-free, by structure: no `new` or array literals in the loop. `dispose()` does not throw.
- Run `npm test`, the shoot.py screenshot (`errors: []`, with `raftDebug.content.decorpack.place` for each type and `write(…)`), and `node tests/coop-e2e.mjs`: the guest's write must show on the host, and the guest's turn must rotate on both.

## Implementation notes
Deviations from the text above, each forced or strictly additive:
- **Hammock orientation and footprint.** With three.js's convention, `ry = π/4` sends the sling's local +X to (.71, −.71), away from the posts at (−.72,−.72)/(.72,.72). The sling uses `ry = −π/4` so it hangs between the posts. A full-width (.7) sling at 45° pokes out to about ±.97 m at the corners. The segment width tapers from .7 in the middle to .44 at the ends (`.44 + .26·sin(πs)`), the end spreaders are .46 long, and the footprint stays inside ±.9 m (this is asserted in tests/decor-pack.test.mjs).
- **Pennant flag pivot.** The flag mesh sits at (0, 2.14, 0), with its geometry in pivot space (bands span ±.18 m). `rotation.y` still turns about the pole axis, and `rotation.x` now sways the flag about its own mid-height instead of the deck.
- **Removal rescan.** rebuildRaft only calls `decorModel` for tiles that still exist, so removing the last pack piece would never set `dirty`. `update()` also sets `dirty` when the `world.decor` array or its length changes (two comparisons, no allocation). Without this, stale `rot`/`t` keys and orphaned live groups would linger.
- **Reach with an unknown pose.** `applyDecorAction` refuses with `far` when `env.pos(actor)` is missing or non-finite, following the spec's "must be within". storage-research.js lets that case through.
- **Rotation cap.** A `decor.turn` on a new key once `MAX_ROT` keys exist returns `fullrot`, and nothing is emitted. The host's automatic face-the-player assignment also stops at `MAX_ROT`.
- **cleanLines.** The two separator characters in the §5 regex are U+2028/U+2029, written as `  `.
- **storage-research.test.mjs.** The coordinator asked for asserts that hold for every builder's content recipes, so the test filters against an allowlist of the original 15 recipe ids (`ORIG`, plus `ORIG_NAMES` for the emit list) rather than the decor-pack `PACK` set. The "Researched Rope!" single-emit check is skipped only when some later content recipe needs rope alone.
- **Extras.** `debug.isOpen()`. `ui.isOpen` is a getter. Nothing in icons.svg or survival-ui.js changed, because every pack item reuses an existing sprite.
