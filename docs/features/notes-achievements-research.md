# Message bottles, raft logbook and achievements: research

Status: research only, no code changed. Grounded in `dist/game.js` (applyAction ~L539, cleanWorld ~L117, makeItem L370, hostState ~L814), `dist/survival-ui.js`, `dist/settings.js` and `dist/index.html`.

## Genre conventions, and how they fit a cozy game
- **Collectible notes/logs.** Notes are short (2 to 4 sentences), found by exploring, and kept in a journal you can reread. Good ones build a gentle picture over many finds and leave gaps for the player to fill. Players expect: a counter (`7 / 12`), unfound entries shown as locked placeholders, a read-in-order option, and a quiet "new" marker.
- **Achievements.** Players expect a mix of milestones you hit anyway (first floor), light goals (25 tiles) and collection goals (all notes). They show icon, name and a one-line description. Locked entries show their condition, so the player knows what to aim for. A short toast appears on unlock.
- **Cozy fit (do):** no fail states, no timers, no missable or "hard mode" achievements, nothing about speed or streaks. Text stays warm and second-person, with small jokes. Rarity is fine but bottles must never be lost forever. **Avoid:** grind counters over ~100, achievements for idling or for staying away, loud full-screen popups, and dark or lonely lore. The sea is friendly and other drifters are kind.
- **Originality:** the drifters, the Lantern Fleet and the gull post below are new to this game. No names or text are borrowed from the commercial game "Raft" or any other game.

## The 12 notes (shown in order: the next bottle always carries the lowest unfound note)
1. "To whoever finds this: hello! I'm a drifter too. If your raft creaks at night, that's just it getting comfy. — P."
2. "Tip from the Lantern Fleet: tie one ribbon to your mast for every friend you meet. Mine looks like a birthday cake now."
3. "Today a turtle napped on my raft for three hours. I didn't move once. Best day of the month."
4. "The gulls deliver mail if you ask nicely and pay in crumbs. They do not deliver it to the right person. Sorry if this was meant for someone else."
5. "Recipe for sea soup: one rainy afternoon, two old songs, a lot of patience. Serves everyone who drifts by."
6. "If you see a raft with a teapot-shaped sail, wave! That's Grandmother Ottilie. She has never once run out of biscuits."
7. "I counted the stars last night and got a different number every time. I think they move around to keep it interesting."
8. "Nobody owns the sea, but the sea lets you borrow a little piece of it. Look after yours. — the Lantern Fleet"
9. "Found a barrel full of buttons. No idea why. Sewed them onto everything. I am very shiny now."
10. "The fish here are polite. If you thank them, they splash. I'm almost sure it's a 'you're welcome'."
11. "Once a year all the drifters tie their rafts together and dance until the planks squeak. You're invited. You were always invited."
12. "This is the last bottle I'm sending. Now that you've read them all, write one of your own. Someone out there is waiting for a hello. — P., and everyone"

## Achievements (15). Evaluated on the host only
Store unlocked ids in `world.achievements` (string array) and found note indices in `world.notes` (int array). Bags are per player, but the raft is shared, so in co-op an achievement belongs to the raft and the toast goes to `'all'`. "Retro" means it is derived from saved state on load (see Save compatibility).

| id | Name | Trigger (exact) | Retro |
|---|---|---|---|
| floor1 | Room to Wiggle | `build` with `recipe==='floor'` succeeds, so `world.tiles.length >= 10` (the starter raft has 9) | tiles |
| tiles25 | Floating Neighbourhood | `world.tiles.length >= 25` after a floor build | tiles |
| fish1 | Splash Hello | `fish` succeeds (`world.fish++`), so `world.fish >= 1` | fish |
| fish10 | Fish Whisperer | `world.fish >= 10` | fish |
| supplies100 | Beachcomber | `collect` succeeds (`world.collected++`), so `world.collected >= 100`. Bottles do not count | collected |
| craft_sail | Catch the Wind | `craft` with `r.ok && r.crafted.kind==='sail'` | decor/bag |
| craft_palm | A Little Green | same check, `'palm'` | decor/bag |
| craft_lantern | Night Light | same check, `'lantern'` | decor/bag |
| craft_net | Lazy Fisher | same check, `'net'` | decor/bag |
| craft_bench | Take a Seat | same check, `'bench'` | decor/bag |
| craft_crate | Tidy Captain | same check, `'crate'` | decor/bag |
| homestead | Home Sweet Raft | `world.decor` holds all 6 `DECOR_TYPES` at once (checked after a decor `build`) | decor |
| repair1 | Good as New | `repair` succeeds (the branch that sets `durability = MAX_HEALTH`) | none |
| note1 | Message Received | first bottle collected, so `world.notes.length >= 1` | none |
| notes_all | Pen Pals | `world.notes.length === 12` | none |

(The proposal's "10 tiles" equals the first floor, because 9 tiles are pre-placed. I used 25 tiles as the second step. 50 tiles is an optional extra.)

## Bottle mechanics (hooks only)
- Add `'bottle'` to the item-type validation in `cleanWorld` (keep `ITEM_TYPES`, which also controls debris, or use a separate allow-list), but **not** to `SPAWN_TABLE`. In `makeItem`, on the host only: if `world.notes.length < 12`, no bottle is afloat, and `Math.random() < 1/25`, set type `'bottle'`. That gives about 1 bottle per 25 supplies. The respawn at ~L755 (`Object.assign(it, makeItem(it.id))`) means a bottle that drifts past simply comes back later, so nothing is missable.
- Add `LOOT.bottle = {}`, plus a dedicated branch in `collect` before the bag logic (empty loot would toast `"+ "`). The branch pushes the next index into `world.notes`, does **not** do `world.collected++`, then does the normal splice/push(makeItem)/syncItems, and calls `emit({kind:'note', text:'A message in a bottle! (J to read)', note:i}, 'all')`. Nets (`a.net`) may collect bottles too, and the toast should still fire for them.
- Rendering: `itemModel()` (L370) currently passes unknown types to `createDebris`, which throws. Add a small `createBottle(T)` in a new `dist/bottle.js` (glass cylinder, cork, rolled paper) and give it a slow bob/spin.
- Co-op: an older guest's `cleanWorld` drops `'bottle'` items. The guest just doesn't see them and nothing breaks. An older host never spawns bottles. Effects with an unknown `kind` already fall through `effect()` as notice plus beep, so `kind:'achievement'` and `kind:'note'` are safe with old peers.

## Pure module (suggested `dist/logbook.js`, tested in `tests/logbook.test.mjs`)
`NOTES` (12 strings), `ACHIEVEMENTS` (`[{id,name,desc,icon}]`), `cleanProgress(v)` (returns `{notes:int[] unique 0..11, achievements:string[] filtered to known ids}`), `nextNote(notes)`, and `evaluate(world, bags, event?)`, which returns the newly unlocked ids. game.js calls `evaluate` at the end of `applyAction` for `collect`/`build`/`craft`/`fish`/`repair`, passing `{kind, crafted}` for craft and repair, which leave no world trace. For each new id it emits `{kind:'achievement', text:'Achievement: '+name}` to `'all'`.

## Save compatibility and co-op
- Add `notes:[]` and `achievements:[]` to `newWorld()`, `cleanWorld()` (via `cleanProgress`, with an empty default when missing), `copyWorld()` (copy the arrays) and `hostState()` (`world:{..., notes, achievements}`). The guest then gets them every 0.12s and can render the logbook read-only. `save()` already serialises `...world`.
- **Retroactive unlock.** After the host loads (and after a mount transfer), run `evaluate(world, [hostBag, guestBag], {retro:true})` once and add its ids silently, or with one combined toast like "3 achievements unlocked from your voyage so far". A save with 30 tiles gets `floor1` and `tiles25`, `fish>=1` gets `fish1`, `collected>=100` gets `supplies100`, and every decor type found in `world.decor` or in either bag counts as crafted. If all 6 types are in `world.decor` at once, that gives `homestead`. `repair1` and the note achievements cannot be inferred and stay locked.
- The guest never evaluates or writes progress. When a guest returns to its own raft (`savedOwnRaft`), its own world's progress applies again. Progress belongs to each raft save.
- Hot-swap: `world` already travels through `capture()`/`mount(transfer)`, so the new fields carry over once they are in `cleanWorld`/`copyWorld`.

## UI entry point
- **Key J** opens and closes the "Raft Logbook". It is unused: the bindings in use are WASD, the arrow keys, Space, E (`interact`), R (`repair`), Digit/Numpad 1 to 8, Tab/I (survival-ui L618) and Escape (settings.js). Because game.js's keydown returns early when `uiBlocked()`, the logbook module needs its own capture-phase keydown, like survival-ui L616 to 625: ignore inputs and modifier keys, and close on J when open. **Coordinate with the fishing-v2 "fish journal" lane** so it doesn't also take J. If it does, use L as the fallback, or host the fish journal as a third tab.
- Make it a native `<dialog id="logbook">`. `dialogOpen()` in game.js (L230) then blocks input automatically, and settings.js `otherDialogOpen()` (L163) leaves Escape to it. On open, call `document.exitPointerLock()`. On close, call the game's resume, as survival-ui's `onResume` does.
- Also add a pause-menu button: `<button type="button" data-act="logbook">Raft logbook</button>` in `markup()` `.rs-actions` (settings.js ~L80), handled the way `help`/`crew` are (`close(false)`, then open the logbook). Optionally add a `<kbd>J</kbd>` line to the `#help` guide in index.html.
- Layout: two tabs, **Notes** (`n / 12`; a list of found notes; unfound ones show as "Still adrift…"; the newest gets a dot until read, tracked per viewer in localStorage) and **Achievements** (`n / 15`; a grid; locked entries are dimmed and show their condition). Reuse the survival-ui panel look and the icon symbols in `icons.svg` (borrowing placeholders is fine).
- Toasts: the existing `notice()` line, which is quiet and under the crosshair, plus an optional small corner card (about 3s, `aria-live="polite"`) for achievements. Respect the `body.playing` HUD hiding rules.
