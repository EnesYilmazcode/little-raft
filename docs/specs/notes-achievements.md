# Spec: message bottles (notes) and achievements

Source: `docs/features/notes-achievements-research.md` (note texts and achievement table are taken from it word for word). Build exactly this. New files: `dist/logbook.js` (pure logic), `dist/logbook-ui.js` (DOM view), `dist/bottle.js` (model), `tests/logbook.test.mjs`. Small hooks only in `dist/game.js`, `dist/settings.js`, `dist/icons.svg`, `dist/index.html`. Import new modules with `?build=v3-survival-ae77fa84ac2b`. The receiver lane adds a `'cache'` debris type and `world.signal` in the same functions. Every hook below is its own line or its own `if`. Never merge it with theirs, and never rely on their code being there.

## 1. Pure module `dist/logbook.js` (no DOM, no THREE)
```js
export const NOTES = Object.freeze([...12 strings, research §"The 12 notes", without the leading numbers]);
export const NOTE_COUNT = 12;
export const BOTTLE_CHANCE = 1 / 25;
export const CRAFT_KINDS = Object.freeze(['sail','palm','lantern','net','bench','crate']); // == game DECOR_TYPES
export const ACHIEVEMENTS = Object.freeze([{id, name, desc, icon}, ...15]);     // frozen entries, in table order
export const ACHIEVEMENT_IDS = Object.freeze(ACHIEVEMENTS.map(a => a.id));
export function cleanProgress(v)            // -> {notes:int[], achievements:string[]} (always new arrays)
export function nextNote(notes)             // -> lowest int 0..11 not in notes, or -1 when all 12 are found
export function shouldSpawnBottle(world, id, r = Math.random())  // -> boolean
export function evaluate(world, bags, event) // -> string[] of newly unlocked ids, in table order
export function achievementName(id)          // -> name, or the id itself if unknown
```
- `cleanProgress(v)`: `v` may be anything. `notes` keeps, in their original order, the entries of `v.notes` that are integers 0..11, with duplicates dropped and at most 12 kept. `achievements` keeps strings from `v.achievements` that are in `ACHIEVEMENT_IDS`, unique, in their original order. A missing or bad field becomes `[]`.
- `shouldSpawnBottle(world, id, r)`: true only if `cleanProgress(world).notes.length < 12`, and no entry in `world.items` with `type === 'bottle'` has `it.id !== id` (the item being replaced does not count), and `r < BOTTLE_CHANCE`.
- `evaluate(world, bags, event)`: never mutates. `bags` is an array of bag-likes with `count(kind)` (null entries are skipped). `event = {kind, crafted?}`, where kind is one of `'build'|'craft'|'collect'|'fish'|'repair'|'note'|'retro'`. It returns every id whose condition holds and which is not already in `world.achievements`:

| id | name | desc (shown on the card, locked or not) | icon | condition |
|---|---|---|---|---|
| floor1 | Room to Wiggle | Add your first new floor tile. | floor | `tiles.length >= 10` |
| tiles25 | Floating Neighbourhood | Grow the raft to 25 tiles. | floor | `tiles.length >= 25` |
| fish1 | Splash Hello | Catch your first fish. | fish | `fish >= 1` |
| fish10 | Fish Whisperer | Catch 10 fish. | fish | `fish >= 10` |
| supplies100 | Beachcomber | Fish 100 supplies out of the sea. | barrel | `collected >= 100` |
| craft_X (×6, in CRAFT_KINDS order) | Catch the Wind / A Little Green / Night Light / Lazy Fisher / Take a Seat / Tidy Captain | Craft a sail / palm / lantern / net / bench / crate. | sail / palm / lantern / net / hammer / barrel | `event.kind==='craft' && event.crafted===X`; or `event.kind==='retro'` and X is in `world.decor` or `bag.count(X) > 0` for some bag |
| homestead | Home Sweet Raft | Have all six decorations on deck at once. | compass | every CRAFT_KINDS type is in `world.decor` |
| repair1 | Good as New | Repair a worn hook. | repair | `event.kind==='repair'` only |
| note1 | Message Received | Find a message in a bottle. | bottle | `notes.length >= 1` |
| notes_all | Pen Pals | Read all 12 messages. | bottle | `notes.length === 12` |

State conditions (tiles, fish, collected, decor, notes) are checked on every event, so a missed hook catches up on the next one. Missing world fields count as 0 or empty.

## 2. World fields (game.js)
- Add `import { cleanProgress, nextNote, shouldSpawnBottle, evaluate, achievementName, NOTE_COUNT } from './logbook.js?build=…'`.
- `newWorld()`: append `notes:[], achievements:[]` to the returned object.
- `cleanWorld()`: compute `const progress = cleanProgress(v);` before the return, and add `notes:progress.notes, achievements:progress.achievements` to the returned object.
- `cleanWorld()` items filter: change only the type test to `(ITEM_TYPES.includes(it.type) || it.type === 'bottle')`. If the receiver lane has already turned this test into a shared allow-list, add `'bottle'` to that list instead. Do NOT add `'bottle'` to `ITEM_TYPES`, `SPAWN_TABLE` or `LOOT`.
- `copyWorld()`: add `notes:Array.isArray(w.notes) ? w.notes.slice() : [], achievements:Array.isArray(w.achievements) ? w.achievements.slice() : []`.
- `hostState()`: add `notes:world.notes, achievements:world.achievements` inside `world:{…}`.
- `ITEM_NAMES`: add `bottle:'message in a bottle'`, which the context prompt uses ("Pick up message in a bottle").
- `save()` needs no change, because `{...world}` already carries both arrays.

## 3. Bottle debris
- `makeItem(id)`: turn the one-line `return {…}` into `const it = {…}; …; return it;`, or reuse the receiver lane's version if it already did this. Add one line just before `return it`: `if (role !== 'guest' && SPAWN_TABLE.includes(it.type) && shouldSpawnBottle(world, id)) it.type = 'bottle';`. The `SPAWN_TABLE.includes` test means a cache roll is never overwritten. When the bottle drifts past, the respawn `Object.assign(it, makeItem(it.id))` replaces it, and a new one can appear later, so no note is ever missable.
- `dist/bottle.js`: `export function createBottle(T)` returns a `THREE.Group` named `'bottle'`, about 0.42 long, lying along X and centred on the origin. Parts: a glass body (LatheGeometry; `MeshStandardMaterial({color:'#9fd6d0', roughness:.15, metalness:0, transparent:true, opacity:.55})`), a neck, a cork (`#bb8a53`, roughness .9), a rolled-paper cylinder inside (`#f3e6c4`), and a thin twine band (`#c8995f`). Use its own materials, as `plastic.js` does. `disposeGeometry` already frees non-cached materials. Export a default too. No textures.
- `itemModel(item)`: first line `if (item.type === 'bottle') { const g = new T.Group(), b = createBottle(T); b.position.y = .04; b.rotation.y = (item.id % 7) * .9; g.add(b); return g; }`. The bob and spin come from the existing `updateItems` rotation code.
- `applyAction` `'collect'`: insert on its own line, right after the `findIndex … if (i < 0) return;` line: `if (world.items[i].type === 'bottle') { collectBottle(i, a, bag, actor); return; }`. Define next to `wearHook`:
```js
function collectBottle(i, a, bag, actor) { // no bag space needed; does not count toward world.collected
  world.items.splice(i, 1); world.items.push(makeItem(a.id)); syncItems();
  if (typeof a.cast === 'string' && a.cast && wornCasts[actor] !== a.cast) { wornCasts[actor] = a.cast; wearHook(bag, a.slot, actor); }
  const n = nextNote(world.notes);
  if (n < 0) { emit({kind:'notice', text:'An empty bottle. Someone out there says hi!'}, actor); return; }
  world.notes.push(n);
  emit({kind:'note', note:n, text:`Message in a bottle! (${world.notes.length}/${NOTE_COUNT}) · L to read`}, 'all');
  award({kind:'note'});
}
```
- Nets: no change. The net loop calls `collect` with `net:true`. Bottles go through `collectBottle`, so a bag-full check never blocks them and the `'all'` toast still fires.
- Guests never spawn bottles. They render them from `hostState`.

## 4. Host award hook
Define near `applyAction`:
```js
function award(ev, quiet = false) {
  if (role === 'guest') return [];
  const ids = evaluate(world, [hostBag, guestBag], ev); if (!ids.length) return ids;
  world.achievements.push(...ids);
  if (!quiet) for (const id of ids) emit({kind:'achievement', id, text:'Achievement: ' + achievementName(id)}, 'all');
  return ids;
}
```
Each call below is one added statement, placed just before that branch's existing `return`:
- `craft`: `if (r.ok) award({kind:'craft', crafted:r.crafted.kind});`
- `collect` (normal loot path): `award({kind:'collect'});`
- `build`: after the `rebuildRaft(); emit(...)` line, `award({kind:'build'});`
- `fish`: after `world.fish++` and its emit, `award({kind:'fish'});`. Split the one-liner at the `;`.
- `repair`: after `durability = MAX_HEALTH` and its emit, `award({kind:'repair'});`.
- **Retroactive unlock:** add a `retroAward()` helper: `const ids = award({kind:'retro'}, true); if (ids.length) notice(ids.length === 1 ? 'Achievement: ' + achievementName(ids[0]) : `Logbook: ${ids.length} achievements from your voyage so far`, 3200);`. Call it (a) once in the mount `try` after `survivalUI` is created, when `role !== 'guest'`, which covers a fresh load, a v2/v3 save and a hot-swap from an older engine, and (b) at the end of `restoreOwnRaft()`. A second run returns `[]`, so remounting is a no-op.

## 5. Effects and graceful degradation
- New effect kinds: `'note'` `{kind, note, text}` and `'achievement'` `{kind, id, text}`. Keep every text at 90 characters or less. Older peers fall through `effect()` to `notice(text)` plus a 440 Hz beep, which is exactly the fallback we want, so never send an effect without `text`.
- In `effect()`, add one line before the `beep(...)` line: `if (e.kind === 'note' || e.kind === 'achievement') logbookUI?.celebrate?.(e);`. The beep stays at the default frequency, which avoids another edit to the shared ternary.
- Old hosts send no `notes` or `achievements` and never spawn bottles. A new guest's `cleanWorld` turns that into `[]`. Old guests drop `bottle` items and the new fields, so they see nothing and nothing breaks.

## 6. View `dist/logbook-ui.js`
`export function createLogbookUI({getProgress, onPause, onResume})` returns `{open, close, toggle, update, celebrate(e), destroy, get isOpen}`. `getProgress()` returns `{notes, achievements}` (game.js passes `() => world`). Use a single-instance key `window.__littleRaftLogbookUI`, injected style id `little-raft-logbook-style`, and AbortController cleanup. This mirrors survival-ui. Reuse an existing `#logbook` node on hot-swap.
- Markup: `<dialog id="logbook" class="lb" aria-labelledby="lb-title">` > `.lb-wrap` > a header (`<h2 id="lb-title">Raft logbook</h2>` and a close button with `icon-close`), a `role="tablist"` holding 2 `role="tab"` buttons ("Notes n/12", "Achievements n/15", `aria-selected`, roving arrow keys), and 2 `role="tabpanel"` sections.
- Notes tab: an `<ol>` of 12 rows in index order. A found row shows a "No. k" label and the note text in a paper card. An unfound row shows a muted "Still adrift…". If any note is found, the newest-found row (last entry of `notes`) gets a `.lb-new` dot while `notes.length` > the per-viewer `localStorage['little-raft-logbook-seen']` (int). Opening the Notes tab writes the current length to that key. Wrap every storage call in try/catch.
- Achievements tab: a grid of 15 cards. Each card has an icon (`<svg viewBox="0 0 48 48"><use href="icons.svg?build=…#icon-…">`), the name and the desc. Locked cards add `.lb-locked` and a "Locked" label. Never hide a condition.
- `open()`: return early if already open. Call `onPause`, `exitPointerLock` if locked, `showModal()` (falling back to the `open` attribute), render, and focus the active tab. `close()`: close the dialog, then `onResume`. The dialog's `cancel` event (Escape) runs `preventDefault()` and then `close()`. Because a dialog is open, game.js `dialogOpen()` blocks input with no other change, and settings.js `otherDialogOpen()` leaves Escape alone.
- `update()` (called every frame): if the dialog is open, re-render only when the signature `notes.join()+'|'+achievements.join()` changes. This keeps guests live.
- `celebrate(e)`: shows a corner card `#lb-toast` (`role="status" aria-live="polite"`, top 16px, right 16px, about 3s, at most one queued card at a time) with the bottle or trophy icon and `e.text`. It stays visible while `body.playing` is set, because it lives outside `#hud`, and has `pointer-events:none`.
- Key L: a capture-phase `document` keydown, written like survival-ui L616–625. Ignore `repeat`, Ctrl/Alt/Meta and editable targets. If the logbook is open, `close()`. Otherwise open only when `document.body.classList.contains('playing') || document.pointerLockElement`, and no other `dialog[open]` exists. Call `preventDefault` and `stopPropagation` only when it acts. J stays free for the fish journal.
- Pause-menu button: in settings.js `markup()` `.rs-actions`, add `<button type="button" data-act="logbook">Raft logbook</button>` after "Play together". In the click handler, add a new `if (act === 'logbook') { close(false); document.dispatchEvent(new CustomEvent('littleraft:open-logbook')); return; }` before the help/crew branch. logbook-ui listens for that event and calls `open()`. settings.js does not import logbook-ui.
- game.js wiring: add `let logbookUI = null`. In the mount `try`, after `survivalUI`, add `logbookUI = createLogbookUI({getProgress:() => world, onPause:guard(clearInput), onResume:guard(() => requestLock())});`. Call `logbookUI?.update?.()` in `frame()` inside a try/catch next to the survivalUI update. Call `try { logbookUI?.destroy?.(); } catch {}` in `dispose()`.
- `index.html` `#help` guide: add `<li><kbd>L</kbd><span><b>Logbook.</b> Read your bottled messages and achievements.</span></li>`.
- `icons.svg`: add `<symbol id="icon-bottle" viewBox="0 0 48 48">`. It is an original drawing: a tilted bottle with a cork and a rolled note, using the existing palette (stroke `#153e49` 2px, glass `#9fd6d0`, cork `#ffbd66`, paper `#fff2cc`).

## 7. CSS (injected by logbook-ui; matches the survival-ui wood panel, not the pale style.css dialogs)
```
#logbook.lb{padding:0;margin:auto;border:0;background:transparent;box-shadow:none;color:#fff2cc;width:min(640px,calc(100vw - 32px));max-height:88dvh;overflow:visible;font:500 14px/1.45 'Segoe UI',system-ui,-apple-system,sans-serif}
#logbook.lb::backdrop{background:rgba(12,9,5,.42);backdrop-filter:none}
.lb-wrap: same wood gradient, 3px #3e2a17 border and 0 0 0 2px #d6b67e ring as `#inventory .sv-wrap`; padding 12px; flex column; gap 10px; max-height 88dvh
.lb h2{font:700 20px/1.2 inherit;margin:0;color:#fff2cc;letter-spacing:0}   close button: 32px square, transparent, #fff2cc icon
.lb [role=tab]: background linear-gradient(180deg,#5a3f28e8,#3d2a19e8); inset 1px #d4b07a55 ring; radius 4px; padding 8px 14px; color #fff2cc; no hover transform
.lb [role=tab][aria-selected=true]: background linear-gradient(180deg,#b3925acc,#8a6a3ccc); inset 2px #ffe3a6 ring; :focus-visible outline 2px #ffe3a6
.lb [role=tabpanel]: background #3a2716eb; inset ring like .sv-craft; padding 10px; overflow:auto; overscroll-behavior:contain; scrollbar-color #b48d55 #2a1b0e; min-height 0; flex 1
.lb-note: background #f3e6c4; color #3e2a17; radius 3px; padding 10px 12px; box-shadow 0 2px 0 #24170c; font-style italic; the "No. k" label is small caps #8a663a
.lb-note.lb-missing: background transparent; border 1px dashed #b48d5566; color #d6b67e99; not italic
.lb-new::after: 8px #ffbd66 dot, right of the label
.lb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.lb-card: flex row; gap 10px; padding 8px; background linear-gradient(180deg,#664730e8,#46301ce8); radius 4px; 36px icon; name 600 14px; desc 12px #e8d3a8
.lb-card.lb-locked: opacity .5 and icon filter grayscale(1); the desc stays readable
#lb-toast: fixed; top 16px; right 16px; z-index 40; max-width calc(100vw - 32px); wood-ring card like .lb-card; fades in over .2s; @media (prefers-reduced-motion:reduce) has no transition
@media (max-width:520px): tabs stretch to equal widths, .lb-grid becomes 1 column, the panel padding is 8px
```

## 8. raftDebug (read-only, matching the debugApi comment)
- In `state`: `notes:[...world.notes]`, `achievements:[...world.achievements]`, `logbookOpen:!!logbookUI?.isOpen`.
- A new getter `logbook`: `{notes:[...], nextNote:nextNote(world.notes), achievements:[...], totals:{notes:12, achievements:15}, bottleAfloat:world.items.some(i => i.type === 'bottle')}`.
- `targets[].type` already reports `'bottle'`. Add no mutating debug hooks.

## 9. Tests `tests/logbook.test.mjs` (node:test; import using the same `RAFT_DIST` base pattern as survival.test.mjs)
1. `NOTES.length === 12`, every note is a non-empty string ≤ 300 chars, `ACHIEVEMENTS.length === 15`, ids are unique and match the table order, and every entry has name, desc and icon.
2. `cleanProgress`: undefined/null/garbage returns empty arrays; it drops out-of-range, non-int and duplicate notes, keeps their order and caps at 12; it drops unknown and duplicate achievement ids; it returns new arrays, never the input's.
3. `nextNote`: `[]` gives 0, `[0,1,3]` gives 2, all 12 give -1, and garbage input gives 0.
4. `shouldSpawnBottle`: false when 12 notes are found; false when another item is a bottle; true when the only bottle has the same id (respawn); obeys `r` at `BOTTLE_CHANCE` (just below gives true, equal gives false).
5. `evaluate` state rules: tiles 9 gives nothing; tiles 10 gives floor1; tiles 25 gives floor1+tiles25; fish 10 gives fish1+fish10; collected 100 gives supplies100; already-unlocked ids are never returned; the input world is not mutated (deep-equal before and after).
6. Craft and repair rules: `{kind:'craft', crafted:'sail'}` gives craft_sail, `crafted:'hook'` gives nothing, `{kind:'repair'}` gives repair1, and `{kind:'build'}` never gives a craft_ or repair1 id.
7. Retro: decor holding all 6 types gives the 6 craft ids plus homestead; a bag-like `{count:k => k==='lantern'?1:0}` gives craft_lantern; null bags are tolerated; repair1 is never retroactive.
8. Notes: 1 note gives note1; 12 give notes_all; output follows the table order.
9. `achievementName('fish1') === 'Splash Hello'`, and an unknown id returns the id.
10. Round trip: `cleanProgress(JSON.parse(JSON.stringify(p)))` deep-equals `p` for a valid `p`.

Check that `npm test` passes and that the `shoot.py` `errors` list is empty. A screenshot with the logbook open (press L) should show both tabs.

## 10. Backward-compat rules
- Old saves have no `notes` or `achievements`, so they load as `[]`, and then the retro pass awards what the state implies. Saves stay key `little-raft-v1`. No migration is needed.
- If a player downgrades, an old build drops the new fields (accepted: progress is cosmetic). Bottles are never saved, because `save()` writes `items:[]`.
- Achievements and notes belong to the raft save. A guest never evaluates or writes them: `award` returns early for a guest. While a guest visits, it sees the host's logbook read-only. On `restoreOwnRaft` its own progress returns, followed by a retro pass.
- Hot-swap: both fields travel via `capture()` and then `liveWorld` (cleanWorld/copyWorld), with no extra transfer field. A previous engine's `#logbook` node and the instance key are reused or destroyed cleanly.
- Never throw on a bad peer payload. Every peer value passes through `cleanProgress`.
