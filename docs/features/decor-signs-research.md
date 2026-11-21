# Decoration pack and writable signs: research

## Genre conventions (raft and survival builders)
- **Rugs and mats** lie flat on the floor and soften the plank grid. You can walk over them, and they are the cheapest "my home" marker.
- **Flags and pennants** are a pole with cloth that moves in the wind. They show where the wind blows and give the raft a silhouette from a distance.
- **Hanging plants, baskets and wind chimes** hang from a beam or post. They sway, and chimes often make a soft sound.
- **Paintings and trophies** mount on walls, so they need a wall anchor.
- **Beds, hammocks and bedrolls** are often the respawn or sleep point. Here they are purely cozy, because the game has no needs.
- **Flower pots and shelves** are small clutter, usually free-placed on any surface.
- **Signs** are a plank on a post or a wall plaque. E opens a text box with 1–4 short lines. The text renders on the board in a handwritten or stencil font, and other players see it once it is saved. Most games limit the length and filter control characters.
- **Rotation**: almost every builder turns decor in 90° (or finer) steps while placing it, often with R or the scroll wheel.

## Current engine facts (what limits us)
- Decor is `world.decor = [{type,x,z}]`, one item per 2×2 m deck tile on the ground deck only. Placement is rejected if the tile already has decor or a grill (`dist/game.js:654-664`, host check `:772-779`). `cleanWorld` keeps only `type,x,z` (`:152-157`), so any extra field such as a rotation is dropped. Rotation must live in module state.
- **Decor has no rotation.** `rebuildRaft()` places every model at `(x*2, .22, z*2)` with no y-rotation (`:427-436`). Building pieces do have R rotation (`dist/building.js:140`), but only for pieces.
- **Decor cannot be removed.** No action splices `world.decor`, so a placed sign stays where it is.
- `rebuildRaft()` rebuilds every decor mesh on each build. `disposeGeometry` (`:299`) disposes the geometry, material and `material.map` of each removed mesh. A module therefore has to hand out cheap shared instances (pattern in `dist/storage-research-model.js:1-6`) and must expect its sign texture to be `dispose()`d. Three.js re-uploads a disposed texture on the next render, so caching the texture is still correct.
- `content.decorModel(type)` gets only the type (`dist/content.js:58`, call at `game.js:428`). A per-tile sign texture and rotation need the tile, which is the reason for the one game.js edit below.
- Every new non-starter recipe is gated by research automatically: it unlocks once all its ingredient kinds have been researched (`dist/storage-research.js:11,34-40`). Clay recipes therefore pull in the diving loop for free.
- The E key goes to `content.interact(aim)` after item pickup and sailing (`game.js:844`). The game keydown handler ignores events from input, textarea and select elements and while a `dialog[open]` exists (`:1168-1169`, `dist/input.js:12-16`). A `<dialog>` with text inputs therefore needs no extra key plumbing. **Do not** close it on E, which `storage-research-ui.js:253` does, because players will type "E".
- `coop-fx.js:10` has a hardcoded `DECOR` set that sets the ghost footprint size. New types fall back to the full-tile ghost, which is fine. Optionally append the new types there.
- **One per tile** costs a whole 2×2 m tile for one tiny pot or chime, which feels wasteful. Mitigation: design every small item as a tile-scale vignette (a trio of pots, a chime on its own post with a bench-height crossbar) so it reads as a "corner". Wall paintings are **out of scope** because decor cannot attach to building-piece walls; a free-standing easel would be the substitute later.

## Our pick: six original decorations plus the Signboard
Every model is built **once** as one merged, vertex-coloured BufferGeometry per material (copy `buildResearchTable`), and `instance()` returns a Group that shares the geometry and materials. Budget: 1–2 draw calls per item, and animation only by rotating one child mesh in `update(dt)` with no per-frame allocations.

| id | Name | Look (first person) | Draws | Block r | Cost |
|---|---|---|---|---|---|
| `rug` | Woven Deck Mat | 1.6 m oval of braided leaf rings in green and tan bands, 2 cm thick, not walk-blocking | 1 | 0 | leaf 4, rope 2 |
| `pennant` | Wind Pennant | 2.4 m pole with a two-colour swallowtail flag that turns to `world.sailing.windDir` (idle sine when absent) | 2 (pole, flag) | .1 | wood 2, leaf 2, rope 1 |
| `fern` | Hanging Fern Post | post and arm with a woven basket of drooping fronds at eye height that sways gently | 2 | .12 | wood 2, rope 2, leaf 3 |
| `chime` | Shell Chime | short gallows post with 5 scrap tubes and shell discs; swings, with an optional soft `audio.play('chime')` tink every few seconds | 2 | .12 | wood 1, scrap 2, rope 2 |
| `hammock` | Rope Hammock | two posts with a sagging net-pattern sling and a leaf pillow across the tile diagonal | 1 | .45 | wood 4, rope 4, leaf 2 |
| `pots` | Clay Pot Trio | three terracotta pots of different heights with flowers (reuse the clay palette in `crafts.js:322`) | 1 | .3 | clay 3, leaf 2 |
| `sign` | Signboard | 0.9×0.5 m plank board on a 1.2 m post plus a text plane on its face | 2 (+1 text) | .1 | wood 3, rope 1 |

Balance check: bench is wood 3, lantern wood 2 + scrap 2, net wood 3 + rope 3, sail wood 4 + rope 3 + leaf 3. Every new item costs 5–10 base units. The hammock is the priciest because it is the largest, the mat is the cheapest because it is flat, and the pots are the only clay sink so far (they reward diving). Icons: reuse existing ones (`icon-leaf`, `icon-net`, `icon-palm`, `icon-sail`, `icon-repair`). A new `icon-sign` symbol is optional, and if added it must go into `icons.svg` and `SPRITES` in `survival-ui.js`.

## Writable sign
**Entry.** Aim at a sign within reach (copy the `target(aim)` ray scoring from `storage-research.js:252-270`). The prompt shows `<kbd>E</kbd>Write on sign` with the first line as a preview, escaped with `ctx.esc`. E calls `ctx.releaseLock()` and lazy-imports `dist/signs-ui.js`, which opens a `<dialog>` with three `<input maxlength=18>` fields and Save, Cancel and Turn buttons. Enter saves, Esc cancels and Tab moves between fields. The inputs are pre-filled with the current text. Typing is never sent until Save.

**Sanitise.** Put this in `dist/signs-core.js`, pure, with node tests. The host re-runs it on every guest action.
`cleanLines(v)` does this: if `v` is not an array, return `[]`. Take at most 3 entries and convert each with `String()`. Then `.normalize('NFC')`, strip `\p{Cc}\p{Cf}` (control and bidi-override characters) and `  `, collapse whitespace to single spaces and trim. Cap each line at 18 code points (`Array.from`, so emoji are never split) and drop trailing empty lines.
Escaping: the canvas `fillText` path is inert, and DOM inputs use `.value`. The only HTML sink is the prompt, which goes through `ctx.esc`. No profanity filter, as the brief says.

**Render.** Use one `CanvasTexture` per *distinct text*, held in a `Map<string, {tex, refs}>` keyed by `lines.join('\n')`.
- Canvas: 256×128, a warm plank-toned background drawn in the canvas itself, and dark ink in `600 30px "Trebuchet MS", system-ui, sans-serif`. Shrink the font to fit the widest line (`measureText`), centre the lines, `colorSpace = SRGBColorSpace`, anisotropy 4, mipmaps on.
- Material: `MeshLambertMaterial({map})` on a 0.82×0.42 plane 1 mm in front of the board, so it darkens with day/night. A blank sign shows no text plane at all.
- `decorModel` returns the board instance plus the cached text mesh for that tile.
- When text changes, update only that tile's group. Do not call `rebuildRaft`. Swap `mesh.material.map`, decrement the old entry's refs and `dispose()` it at 0. The module's `dispose()` frees everything.
- Cap at 32 signs per raft. Further edits are refused with a friendly notice.

**State, save and co-op.** The module is `name:'signs'` with `serialize() -> {r, t:{"x,z":[lines]}, rot:{"x,z":0..3}}`. The result is cached by revision `r`, as in storage-research, because `hostState` sends ext about 8 times a second (`game.js:1062`).
- `load(data, from)` runs `cleanLines` on every value and drops keys whose tile is not currently that decor type (cleans stale and malformed data). An old save gets `load(undefined)` and starts empty.
- `'net'` loads short-circuit when `r` is unchanged.
- Guests call `ctx.action({kind:'signs.write', x, z, lines})`. The host `action()` checks that the tile is a sign and the actor is within reach, cleans the text, writes it, bumps `r` and emits a short notice. Guests never mutate state locally; their dialog closes and the new text arrives in the next state message.
- Size: 32 × 3 × 18 code points is about 2 KB, far under `EXT_MAX` (`content.js:31`).

## Rotation (recommended, small)
- **State.** Keep a quarter-turn per tile in the same module state (`rot`). Any decor-pack type can use it, and the old six could later too.
- **Turning.** Players turn an item with E (or the dialog's Turn button for signs), which sends the host action `signs.turn {x,z}`; the host computes `rot = (rot + 1) & 3`.
- **Default facing.** When the host first sees a new pack tile without `rot` in `update()`, it faces the item toward the nearest player (`ctx.physics` or `ctx.other`), so a fresh sign reads correctly at once.
- **Applying it** needs the tile in `decorModel`. Make one anchored change at `game.js:428`, `content?.decorModel(d.type)` to `content?.decorModel(d.type, d)`, and pass `(type, d)` through in `content.js:58`. Modules then set `group.rotation.y = rot * Math.PI / 2`. Older modules ignore the second argument.
- **Fallback with zero game.js edits.** Find the group by `userData.tileKey` after the raft rebuild in `update()`. This is fragile, so it is not recommended.

## Integration checklist
1. `dist/content-items.js`: add the 7 entries to `CONTENT_ITEMS` (`:9-14`), 7 recipes to `CONTENT_RECIPES` (`:19-21`), 7 ids to `CONTENT_DECOR` (`:24`), and block radii to `CONTENT_BLOCK_RADIUS` (`:25`). The rug gets no radius. The game spreads these lists at `game.js:44,52` and `inventory-state.js:32,69`.
2. `dist/decor-pack.js` exports `createDecorPack(ctx)`, which handles `decorModel`, `update` (pennant, fern and chime sway) and `dispose`. Models go in `dist/decor-pack-models.js`.
3. `dist/signs.js` exports `createSigns(ctx)`, which handles `serialize`, `load`, `action`, `interact`, `prompt`, `decorModel('sign', d)`, `debug` (`write(x,z,lines)`, `texCount()`, `place(x,z)`) and `dispose`. It uses `signs-core.js` and `signs-ui.js`.
4. Append both factories to `FEATURES` (`content.js:30`) after `createStorage`. Storage has to keep E on crates first, and `first()` already gives each module its own decor types.
5. Tests: `tests/signs.test.mjs` covers `cleanLines` (control, bidi, length, emoji, non-array), `load` pruning and the host write validation.
6. Optional: append ids to the `coop-fx.js:10` `DECOR` set. The `homestead` achievement (`logbook.js:34,89`) stays tied to the original six.
