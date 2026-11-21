# Spec: Spyglass (held zoom + far-look label)
Research: docs/features/spyglass-research.md. Anchors checked @ `fe25b0f`. Mark every edit in an existing file `// [spyglass]`.
A cheap early **Spyglass** (brass and wood) and the existing **Binoculars** zoom the view while **Aim** is held
(RMB / pad LT, rebindable). A round lens vignette fades in, the crosshair clutter goes away, and a small label
under the crosshair names the best thing in a ~4 degree cone: an island (name + distance), a signal cache, a
bottle, a barrel or other floating debris. Purely local: no world state, no `serialize`, no `action`, nothing saved or sent.

## Files
| File | What |
|---|---|
| `dist/spyglass.js` (new) | pure exports (below, node-importable: no DOM/THREE at module scope) + `createSpyglass(ctx)` content module `name:'spyglass'` |
| `dist/spyglass-model.js` (new) | `createSpyglassModel(T)` held telescope (MODEL-STYLE handheld tool: grip at origin, tube toward +Y; see Model) |
| `dist/content.js` | import `createSpyglass` (same `?build=` token); append to `FEATURES` (:47) **last**; new hook `zoom()` next to `alt` (:92); header comment gains `zoom()` |
| `dist/game.js` | 5 one-line `// [spyglass]` hooks (below) |
| `dist/items.js` | item `spyglass` right after `binoculars` (:162) |
| `dist/craft-book.js` | `CATEGORY_OF.spyglass = 'tools'` (:20); `ITEM_TEXT.spyglass` after binoculars (:88) |
| `dist/item-svg.js` | `ITEM_ICONS.spyglass` after binoculars (:167), 48x48, house outline `O` |
| `dist/held-items.js` | `HOLD.spyglass` (:38-54), `SIZE` not needed (fitted branch), model branch next to finder (:250) |
| `dist/progression-hooks.js` | `updateHud()` (:253): also hide `#binocularsHud` while `globalThis.raftSpyglass?.zoomed` is true |
| `dist/coop.js`, `dist/coop-avatar.js` | **yes (trivial):** append `'spyglass'` to `HELD` (:28, index 21); `spyglass(g, K)` remote model + `TOOL_TILT.spyglass: 1.3` (:127) |
| `docs/features/content-hooks.md` | rows for `zoom()` and the game.js lines |
| `tests/spyglass.test.mjs` (new), `tests/survival.test.mjs:542` | tests; tools order gains `'spyglass'` after `'binoculars'` |

## Item (items.js, after :162)
```js
item('spyglass', 'Spyglass', 'tool', { iconTint: '#c9a15a', stack: 1,
  recipe: hand({ wood: 3, rope: 1, plastic: 2, scrap: 1 }), unlock: discover('rope', 'plastic', 'scrap'),
  tip: 'A little brass-and-wood telescope. Hold right click to look far away. Never wears out.' }),
```
Glass is smelter/kiln tier (`glass` = `cook('smelter','sand')`, items.js:129), so it is **not** used; the "lens" is
polished plastic. `wood` is the plank kind (`plank` is only an alias, items.js:265). No `tool:true` and no
`durability`, so it never wears and `TOOL_IDS` (tests/progression.test.mjs:174) is unchanged, exactly like binoculars.
craft-book: `spyglass: { desc: 'A brass-ringed tube with a clear lens.', use: 'Hold right click to zoom in and name far things.' }`.
Also update binoculars `use` (:88) to `'Hold right click to zoom in; also points to the nearest barrel.'`.

## Pure exports (spyglass.js)
```js
export const SPY = Object.freeze({ ZOOM: { spyglass: 3, binoculars: 4.5 }, EASE_S: 0.18, CONE_DEG: 2,  // half-angle: 4 deg cone
  STICKY_DEG: 0.75, ISLAND_BIAS_DEG: 1, ITEM_RANGE: 200, ISLAND_RANGE: 1200, LABEL_AT: 0.5, HIDE_VM_AT: 0.6, VIGNETTE_STEPS: 20 });
export const ITEM_LABEL = Object.freeze({ cache: 'Signal cache', bottle: 'Message in a bottle', barrel: 'Barrel',
  wood: 'Plank', plastic: 'Plastic jug', scrap: 'Scrap', leaf: 'Leaves' });   // copy of game.js:77, capitalised
zoomFor(kind)            // SPY.ZOOM[kind] || 0  (0 = this kind cannot zoom)
easeStep(t, dt, on)      // t in [0,1]; moves by dt/EASE_S toward on?1:0, clamped; NaN/neg dt -> t unchanged
zoomAt(t, Z)             // Z<=1 -> 1; else 1 + (Z-1) * s, s = t*t*(3-2t) (smoothstep)
angleTo(fx,fy,fz, dx,dy,dz) // degrees between unit forward f and (unnormalised) d; d==0 -> 180
pick(px,py,pz, fx,fy,fz, items, isl, seaY, prevKey, out) // -> out or null, no allocation
labelText(out)           // 'Mossy Cay · 140 m' | 'Barrel · 85 m'; islands via distText, items `${Math.round(d)} m`
```
`pick` rules: items from `items` (`world.items`, `{type,x,z,token}`, y = `seaY`; it already contains the signal cache
as type `cache`, so `world.signal.cache` is not scanned twice); skip unknown types and `d > ITEM_RANGE` or `d < 1`;
score = angle. Island `isl` (`islandNow()` shape `{seed,cx,gy,cz,R}` or null): centre `(cx, gy, cz)`, distance to
shore `ds = max(0, d - R)`, skip if `d > ISLAND_RANGE` or the player is inside `R`; score = `max(0, angle -
deg(asin(min(1, R/d)))) + ISLAND_BIAS_DEG` (debris in front of an island wins). Keep the lowest score `<= CONE_DEG`.
Stickiness: if `prevKey` is still a candidate with score `<= CONE_DEG + STICKY_DEG` and the best beats it by less than
`STICKY_DEG`, keep `prevKey`. `out = {key, kind, seed, d}`: key is `token` for items, `'isl:' + seed` for islands;
kind is the item type or `'island'`; `d` is horizontal (island: `ds`). Future slot: a `trader` candidate (nothing exists yet).

## Module (createSpyglass)
State (all scalars, made once): `t` (ease 0..1), `Z` (target zoom of the held kind), `cur` (current zoom), `forced`
(debug kind or null), `fwd` = one reused `T.Vector3`, `hit` = one reused `out` object, `lastKey`, `lastBucket`, `nameSeed`,
`nameStr`, `rmbDrag` (fallback flag), DOM refs. `globalThis.raftSpyglass = { zoomed:false }` (one object, flag flipped).
- `gate()` (cheap, used by `zoom()` and `update`): returns the zoomable kind or null. Null when `!ctx.running`,
  `ctx.uiOpen()`, `ctx.physics?.swimming`, camera y < `ctx.ocean?.mesh.position.y ?? 0` (diving pass), `document.hidden`,
  or kind (`ctx.localBag()?.selected?.kind`) has `zoomFor(kind) === 0`. `forced` replaces the kind check.
- `held()`: `forced || (locked && raftControls?.input.down('aim')) || (dragLook && rmbDrag)`, where `locked =
  !!document.pointerLockElement` and `dragLook = document.body.classList.contains('drag-look')`. Fallback for drag-look /
  no controls lane: canvas `pointerdown` button 2 sets `rmbDrag`, window `pointerup` button 2 and `blur` clear it
  (one `AbortController`, aborted in `dispose`). Pad LT `reelDown` (game.js:1761) is harmless: no cast with a spyglass.
- `update(dt)`: `k = gate()`. If `!k` -> **snap** `t = 0` (item switch, menu, lock loss through `held()`, blur via
  `controls.clear()`), `cur = 1`, then `restore()` once and return (no work when idle). Else `Z = zoomFor(k)`,
  `t = easeStep(t, dt, held())` (eases out over 0.18 s on a normal release), `cur = zoomAt(t, Z)`, `applyDom(t, k)`.
  When `t >= LABEL_AT`: `ctx.camera.getWorldDirection(fwd)`, `pick(...)` with `ctx.world.items`, `islandNow()`
  (import from `./islands.js?build=...`, same specifier as content.js), sea y; then `writeLabel(hit)`.
- `zoom()`: `gate() ? cur : 1` (snaps to 1 the same frame a menu opens, even before `update`).
- `prompt(aim)`: `<kbd>RMB</kbd>Hold to look` (key text from `raftControls?.map` label for `aim` if available, else RMB)
  when the held kind zooms and `t === 0`; else null. Last in FEATURES, so any other content prompt wins.
- `alt()` not used (RMB is consumed by nothing else for these kinds, game.js:1670). No `serialize`/`load`/`action`.
- `dispose()`: abort listeners, `restore()`, remove the two divs and the `<style>`, delete `globalThis.raftSpyglass`.

## DOM / CSS (created lazily on first zoom, never rebuilt)
One `<style id="lrSpyStyle">` appended to `head`:
```css
#lrSpyVignette{position:fixed;inset:0;pointer-events:none;z-index:2;opacity:0;display:none;
  background:radial-gradient(circle at 50% 50%,transparent 0 33vmin,rgba(6,14,20,.55) 39vmin,rgba(4,10,14,.97) 45vmin)}
#lrSpyVignette:after{content:'';position:absolute;left:50%;top:50%;width:78vmin;height:78vmin;margin:-39vmin 0 0 -39vmin;
  border-radius:50%;box-shadow:inset 0 0 5vmin rgba(0,0,0,.5),0 0 0 2px rgba(201,161,90,.35)}
#lrSpyLabel{position:fixed;left:50%;top:calc(50% + 30px);transform:translateX(-50%);padding:3px 10px;border-radius:8px;
  background:rgba(8,22,36,.6);color:#f6ecd6;font:700 14px/1.3 system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:4}
body.lr-spy #lrPrompt,body.lr-spy #binocularsHud,body.lr-spy #treasureHud,body.lr-spy #chargeMeter{visibility:hidden!important}
body.lr-spy #crosshair:before{opacity:0}
body.lr-spy #crosshair i{width:4px;height:4px;margin:-2px 0 0 -2px}
```
`#lrSpyVignette` sits under the crosshair (z 3); the label is 30 px under it, clear of `#treasureHud` (top 12%),
`#binocularsHud` (top 18%) and `#lrPrompt` (hidden). `applyDom`: quantise `q = round(t * VIGNETTE_STEPS)`; only on
change write `style.opacity = q / 20` and `display`; toggle `body.lr-spy` and `raftSpyglass.zoomed` only when
`t >= LABEL_AT` flips. `writeLabel`: bucket = items `round(d)`, islands `round(d/10)`; build the string with
`labelText` **only** when `key` or bucket changed; set `textContent` then; `hidden = !hit`. Island name is
`islandName(seed)` (maptable.js:29) cached in `nameSeed/nameStr`. `restore()`: opacity 0, display none, label hidden,
`lastKey = null`, class removed, flag false (guarded so it runs once per zoom).

## game.js hooks (each one line or a token edit)
1. `let viewZoom = 1;` beside `lockFallback` (:321).
2. `updateCamera` :1427: `viewZoom = running ? content?.zoom() ?? 1 : 1; const damp = 1 / viewZoom; const fov = running ? options.fov / viewZoom : 48;` (existing `!==` test keeps
   `updateProjectionMatrix` to easing frames only).
3. :1429-1431: multiply `bob`, `cf?.x`, `cf?.z`, the grounded raft roll and `cf?.roll` by `damp`; :1435 shake `k *= damp`.
4. after `hands.update(hp)` (:1452): `if (viewZoom > 1.6) hands.group.visible = false;` (`hands.update` resets it
   every frame, so un-zoom restores it; hp.fov is already the zoomed FOV so the viewmodel never magnifies).
5. `look()` :871: `k /= viewZoom;` first (covers controls lane :1754, legacy mouse :1666, drag-look :1692, pad).
content.js: `zoom() { const z = first('zoom'); return Number.isFinite(z) && z >= 1 && z <= 8 ? z : 1; }`.
progression-hooks.js:255: `const show = ... && !globalThis.raftSpyglass?.zoomed;` (binocular barrel text hides while zoomed).

## Model (spyglass-model.js)
`createSpyglassModel(T)` returns a Group, `userData = {kind:'spyglass', grip:Vector3(0,0,0), size:{x,y,z}, height}`
(finder/spade pattern so held-items' fitted branch reads `grip`/`size`). Tube along +Y, ~0.34 m: wooden body
(`#6b4529` dark wood, vertex colours) r 0.024, a narrower draw tube r 0.019, brass rings at both ends + one mid
(`#c9a15a`, `#8a6a32` shade, flat-shaded metal), lens cap end slightly flared, eyepiece at -Y near the grip. Bevelled
cylinders, 2 merged meshes (wood + brass), <= 900 tris LOD 0. held-items: `HOLD.spyglass = {hand:'right', pose:'grip',
rx:-1.2, rz:0.2}`, branch `kind === 'spyglass'` with `s = 0.6`. coop-avatar `spyglass(g,K)`: 2 `Cyl` parts (K.woodDark
tube 0.3, K.glow ring), returns tip `[0,0.32,0]`. Binoculars keep their fallback model (out of scope).

## Edge cases
- Item switch / menu (`uiOpen`) / tab blur / lock loss / swimming / diving / module `dead`: `gate()` or `held()`
  false -> snap out next `zoom()` call; nothing to clean up in game.js (FOV is recomputed every frame).
- Hammer RMB opens the build wheel (:1669) - other kind, no conflict. Pad radial blocks look and input (controls.js:62).
- Title screen (`!running`): FOV 48 untouched. Guest: same code, local bag; nothing networked.
- `world.items` missing or not an array -> islands only. `islandNow()` null -> items only. Fog: labels may name
  things inside fog up to 200 m; nothing past the 200 m far plane becomes visible (do not promise it).
- Look sensitivity is `1/zoom`, pitch clamp unchanged. Reduced motion already scales bob; `damp` stacks.
- Zero allocation per frame: no closures, arrays, template strings unless the label bucket changed.

## Tests (tests/spyglass.test.mjs, node:test, import `spyglass.js` + `?build=` like treasure.test.mjs)
1. `zoomFor`: spyglass 3, binoculars 4.5, hammer/null/'__proto__' 0.
2. `easeStep`: 0 -> 1 in exactly `EASE_S` (9 steps of 0.02 = 1), clamped at 1, eases back to 0, dt NaN/-1 unchanged.
3. `zoomAt`: t 0 -> 1, t 1 -> Z, t .5 -> 1+(Z-1)/2, monotonic over 50 samples, Z<=1 -> 1.
4. `angleTo`: parallel 0, perpendicular 90, opposite 180, zero vector 180.
5. `pick`: barrel at 1.5 deg wins; barrel at 3 deg -> null; nearer-angle item beats closer-distance one; > 200 m skipped;
   island dead ahead returns `isl:<seed>` with `d = d - R`; barrel inside the island disc beats the island (bias);
   player inside R -> island skipped; stickiness keeps `prevKey` when the rival is better by < 0.75 deg, switches at > 0.75;
   returns the same `out` object (identity) and makes no new objects (call 1000x, `out` reused).
6. `labelText`: `'Barrel · 85 m'`, `'Signal cache · 60 m'`, island `islandName(7) + ' · 1.2 km'` for d 1200.
7. Items: `ITEMS.spyglass` stack 1, no durability, `!TOOL_IDS.includes('spyglass')`, recipe kinds all valid
   items, unlock is `discover`, no `glass` in recipe; `ITEM_ICONS.spyglass`, `ITEM_TEXT.spyglass`, `HELD` index 21.
8. Module smoke (fake ctx like treasure.test.mjs): `createSpyglass(ctx).zoom()` is 1 with bag kind 'hammer', and with
   `debug.force('spyglass', {snap:true})` is 3; `uiOpen()` true -> 1 at once; `serialize` undefined.

## QA helper + screenshots
`debug` (`raftDebug.content.spyglass`): `zoom()` -> `cur`; `t()`; `target()` -> `{key, kind, d, label}` (fresh object, QA only);
`force(kind|null, {snap})` (bypasses `held()` and the kind check, not `gate()`'s running/ui/swim checks; `snap` sets `t = 1`);
`equip(kind='spyglass')` -> gives nothing, selects the first bag slot holding `kind` via `ctx.action({kind:'selectSlot', index})`.
Verify (sandbox/spyglass/shoot.py, copy root shoot.py's server/launch preamble):
`raftDebug.give('spyglass')`, `raftDebug.content.spyglass.equip()`, `raftDebug.content.islands.spawnNear(1234)`,
`raftDebug.aim(0, raftDebug.content.islands.yawTo())`, shots: `01-held` (model in hand + RMB prompt), `force('spyglass',{snap:true})`
wait 300 ms -> `02-zoom-island` (vignette, label "<name> · N m", no prompt/ring, no hands), `force('binoculars',{snap:true})`
-> `03-bino`, `force(null)` wait 300 ms -> `04-restored` (FOV, hands, prompt back; assert
`raftDebug.content.spyglass.zoom() === 1`). Read every PNG. Also `npm test` (or `node --test tests/`) green.
