# Little Raft: on-screen text audit (centre and blocking UI)

Scope: `dist/` at HEAD `3a16a82` (build `v3-survival-ae77fa84ac2b`). Read only, nothing in the repo was changed.
Positions come from the final cascade: `style.css` is overridden by `graphics.css`, and both are overridden by the injected `HUD_CSS` (game.js:44-52), `survival-ui.js` CSS, `settings.js` CSS and `live.js` CSS.

Key facts:
- **Every in-play message ends up in one centred line.** `notice()` (game.js:394), `toast()` while running (game.js:396) and every `emit({text})` (handled by `effect()`, game.js:529) write to `#contextPrompt`. `#contextPrompt` is at `left:50%; top:calc(50%+26px)`, centred directly under the crosshair. It is also the slot for the real context prompts (`E Pick up`, reel). Any notice overrides the pickup prompt for 1.8–3 s (priority order in `updateContext`, game.js:400-412).
- Once `body.playing` is set, `HUD_CSS` (game.js:46-47) and graphics.css:383 apply `display:none!important` to `header`, `.inventory`, `.goal`, `#durability`, `#toast`, `.controls`, `#recipes` and `#aimHint`. During play only the hotbar, the crosshair, `#contextPrompt`, `#resumeHint`, `#chargeMeter` and the modals are visible. **There is no objective tracker in play** (`.goal/#goalText` is hidden, and game.js never writes to it).
- `dist/prompts.js`, `prompts.css`, `onboarding.js` and `onboarding.css` exist as **empty** placeholders and are already linked from index.html:2/15. They are the natural home for the new feed, prompt slot and tracker. `window.raftMount` (game.js:1196) exposes the scene and camera to them.

## Inventory table

| # | element/selector or function | file:line | text (examples) | where it shows (position, blocking?) | replacement proposal |
|---|---|---|---|---|---|
| 1 | `#contextPrompt` (injected div + HUD_CSS) | game.js:48-51 (css), 262 (create), 400-412 (`updateContext`) | `E Pick up plank`, `Hold click to reel it in`, `Floor needs 2 more wood`, `Waiting for your brother's raft…`, plus every notice | **Centre**, 26px under crosshair, `translateX(-50%)`, z30, non-blocking but covers aim point | **prompt slot**: move to bottom-right of crosshair (e.g. `left:calc(50%+18px); top:calc(50%+14px)`, left-aligned, no translate). Show it only for interactables or held-tool actions. Stop routing notices here |
| 2 | `notice(s, ms=1800)` | game.js:394 | all strings in section B | Feeds #1 (centre); 90-char cap; one message at a time, later ones overwrite earlier | Split into `feed(text, kind)` and `prompt(text)`; also see #3 |
| 3 | `toast(s)` | game.js:395-399 | network join/leave strings | While running it calls `notice(s,2400)`, so it shows in the centre; before start it shows `#toast` | **feed** |
| 4 | `emit({kind,text}) → effect()` | game.js:522-531 | loot, craft, build, full, notice kinds | Calls `notice()`, so it shows in the centre; also beeps by kind | **feed**, using `kind` to style (loot/build = normal, full/notice = warning) |
| 5 | `#toast` | index.html:9; style.css:2 (`top:25%`); graphics.css:196 (`top:18%`) | same as #3 | **Top-centre** pill, `left:50%` translate; hidden in play (game.js:46, graphics.css:383), so it can only appear on the title screen | **remove** (fold into feed) |
| 6 | `#aimHint` | index.html:9; style.css:2; graphics.css:189, 382, 384 | `Point the dot at a floating supply and click` | Bottom-centre (`bottom:112–172px`). `#hud` is hidden before play and `#aimHint` is `display:none` during play, so it is **never visible** (dead) | **remove** (first-run hint becomes a tracker objective) |
| 7 | `#resumeHint` | index.html:6; style.css:9-11 (`50%+34px`); graphics.css:226 (`top:calc(50%+56px)`), 370, 380; game.js:428, 901 | `**Click the ocean** to look around again` | **Centre** under reticle, uppercase pill, clickable. Shows when playing, not locked and no dialog | **prompt slot**: `[Click] Look around` at the bottom-right of the crosshair, or remove and let any canvas click relock |
| 8 | `#chargeMeter` | index.html:9; graphics.css:367-368; game.js:414-419 | `THROW POWER` | **Centre**, `top:calc(50%+44px)`, 158px bar with centred label, shows while charging | **prompt slot**: small bar next to crosshair (bottom-right), drop the label, or a ring around the crosshair |
| 9 | `#crosshair` | index.html:5; graphics.css:207-224, 385 | (none) | Centre | keep |
| 10 | `#welcome .overlay` / `.welcome-card` | index.html:11; style.css:2 (`.overlay` flex, `.welcome-card{margin-left:8vw}`), graphics.css:259-284; game.js:666, 719-722 (cinematic orbit cam) | `WELCOME ABOARD`, `Small raft. Endless possibilities.`, paragraph, pills `First-person raft / 1–2 players / No rush`, buttons `Let's set sail` / `Play with my brother`, save note | Full-screen, **blocking**. Card is left-aligned and vertically centred on desktop; ≤760px it is centred full width with a vertical gradient (style.css:20). Already over a slowly orbiting camera | **title menu** (left): `New Game` / `Continue` (needs a save check on `little-raft-v1`) / `Play together` / `Settings`. Remove pills and paragraph. Make the orbit a slow ocean pan. Keep it left-aligned on mobile too |
| 11 | `.welcome-caption` | index.html:11; style.css:2; graphics.css:284 | `LOOK • HOOK • BUILD` | Bottom-right, title screen only | **remove** |
| 12 | `#loadError` | index.html:11; game.js:1202 | `The 3D ocean could not start. Try a current Chrome, Edge, or Safari…` | Inside the welcome card (left), red | keep (under the title menu buttons) |
| 13 | `#raftLiveError` (`showFatal`) | live.js:40-49 (css), 73-90 | `The ocean could not load` / `Little Raft failed to start in this browser. Your saved raft is safe.` + stack + `Try again` | Full-screen **centred** card (flex centre), **blocking**, z max | **keep-modal**, but left-align it as a title-menu-style panel |
| 14 | `#updateStatus` (`showStatus`) | live.js:34-39, 55-71, 220, 264, 278 | `An update is ready for your next session`, `Ocean updated. Keep playing.`, `Update paused — still playing this version` | **Bottom-centre** (`bottom:18px`), over the hotbar, non-blocking | **feed** (bottom-left). Make `Ocean updated` silent or feed-only |
| 15 | `#options` pause/settings dialog | settings.js:41-62 (css), 72-89 (markup), opened on Esc/lock loss | `Paused`, `Resume`, `Enter/Exit fullscreen` (settings.js:150), `How to play`, `Play together`, slider labels | Native `showModal()`: **centred, blocking**, `h2{text-align:center}`, blurred backdrop | **keep-modal**, restyle as a left-aligned pause menu matching the title menu (left column, no centred heading) |
| 16 | `#help` dialog | index.html:13; guide rewritten at game.js:267-270; graphics.css:286-299 | `How to play`, key guide, `Sound: on/off`, `#saveStatus` | **Centred** modal, blocking | **keep-modal** (reached from pause). Move the storage warning out (#22) |
| 17 | `#crew` dialog + `#networkStatus` | index.html:12; game.js:393 `setStatus` | `Same ocean. Same raft.`, room code, status lines (section B, setStatus) | **Centred** modal, blocking | **keep-modal**. Status lines stay inside the dialog |
| 18 | `#inventory` dialog (survival UI) | survival-ui.js:138-140 (`margin:auto`), 196-224, 493 | `.sv-hint` `Click a stack to pick it up, then click a slot…` (centred text, :161), `.sv-why` `No room in inventory` (:338), `.sv-empty-list` `No recipes known.` (:311), `.sv-tip` tooltip (cursor-follow) | **Centred, blocking** modal (Tab/I/E) | **keep-modal**. Left-align `.sv-hint` or show it once and drop it. Craft failures stay inline here (see B) |
| 19 | `.goal` / `#goalText` / `#progress` | index.html:8; style.css:2; graphics.css:102, 376, 383; game.js:46 | `MAKE YOURSELF AT HOME` / `Hook a floating supply to get started` | Top-right, but **hidden in play** and never updated | **tracker**: reuse as the top-right objective notes, visible while playing |
| 20 | `header` / `#connection` | index.html:7; game.js:935, 957, 970, 999, 1005, 1028, 1038, 1041 | `YOUR OWN LITTLE OCEAN`, `ROOM ABCDEF`, `TWO ABOARD · ABCDEF`, `BROTHER LEFT · ROOM OPEN`, `DISCONNECTED` | Top bar; hidden in play | **tracker**: one small connection line under the objectives. On the title screen it can stay in the header |
| 21 | `#durability` / `#repairButton` / `.inventory` / `.controls` / `#recipes` | index.html:8-10; game.js:46-47, 266 | `HOOK CONDITION 100%`, `Repair R 2 wood · 1 scrap`, `SHARED SUPPLIES`, controls strip | Corners/bottom; all **hidden in play** (dead legacy HUD) | **remove** (durability already on the hotbar slot `.sv-dur`) |
| 22 | `#saveStatus` | index.html:13; game.js:667, 678 | `Browser storage is unavailable/full… This session will not be saved.` | Only inside the help dialog, so effectively unseen | **feed** (warn once at start) + **tracker** footnote |
| 23 | Hotbar `.tools.sv-hotbar` | survival-ui.js:117-137; style.css:2 `.bottom` | slot numbers/counts | Bottom-centre, not a message | keep |
| 24 | `updateContext` guest-wait line | game.js:404 | `Waiting for your brother's raft…` | Centre (#1), persistent while joining | **tracker** (status line) |

## B. Every string passed to notice() / toast() / emit({text}) / setStatus() / showStatus(), grouped by proposed destination

### Feed, bottom-left (events, pickups, results; stack 3–5, fade about 4 s)
| string | source |
|---|---|
| `+ 2 wood` (`'+ ' + n itemName` joined with ` · `; barrel gives `+ 3 wood · 2 palm leaf · 1 scrap · 1 plastic`) | emit loot game.js:562 |
| `You caught a fish!` | emit loot game.js:585 |
| `Crafted Hammer` (`Crafted ${name}`) | emit craft game.js:546 |
| `A little more room!` / `Sail placed` (`${name} placed`), sent to **all** | emit build game.js:579 |
| `Hook repaired!` | emit build game.js:592 |
| `Your bag is full` | emit full game.js:547, 556 |
| `Bag full: the fish swam away` | emit full game.js:584 |
| `Hook getting worn. R repairs: 2 wood, 1 scrap` | emit notice game.js:537 |
| `Hook worn out: shorter throws. R to repair` | emit notice game.js:536 |
| `No hook to repair` | emit notice game.js:589 |
| `Your hook is in great shape` | emit notice game.js:590 |
| `Repair needs 1 more scrap` (`'Repair needs ' + missingText`) | emit notice game.js:591 |
| `Craft a hammer first` | emit notice game.js:569 |
| `Craft a lantern first` (`Craft a ${item} first`) | emit notice game.js:576 |
| `Floor needs …` (host-side reject, race only) | emit notice game.js:570 |
| `Mouse lock unavailable: drag to look, click to use` | notice game.js:460 |
| `Your brother joined the raft!` | toast game.js:1000 |
| `Your brother left the raft.` | toast game.js:1005 |
| `You joined your brother's raft!` | toast game.js:1030 |
| `Your brother left. Your raft is still here.` | toast game.js:1038 |
| `Host disconnected. You are back on your own raft.` | toast game.js:823, 1042 |
| `An update is ready for your next session` / `Ocean updated. Keep playing.` / `Update paused — still playing this version` | showStatus live.js:220, 264, 278 |
| `Browser storage is unavailable/full…` (new: surface once) | setText #saveStatus game.js:667, 678 |

### Prompt slot, bottom-right of crosshair (only while aiming at or holding something actionable)
| string | source |
|---|---|
| `[E] Pick up plank` (uses `ITEM_NAMES`: plank / bundle of leaves / piece of scrap / barrel / plastic jug) | updateContext game.js:406 |
| `Hold click to reel` / `Hold click to reel it in` | updateContext game.js:408 |
| `Floor needs 2 more wood and 2 more plastic` (hover with hammer) | updateContext game.js:407; also notice game.js:633 |
| `Point at an empty space beside the raft` / `Point at an empty raft floor` (on click) | notice game.js:632 |
| `Point at the water to fish` | notice game.js:637 |
| `Try a spot a little closer` | notice game.js:638 |
| `Wait for a bite…` | notice game.js:640 |
| `Worn hook: shorter throws. R to repair` (on every throw, spammy) | notice game.js:662 |
| `Click the ocean to look around again` (#resumeHint) | index.html:6 |
| `THROW POWER` bar (#chargeMeter) | graphics.css:367 |

Better design for the click-failure lines: have the prompt slot show the valid action ahead of time (`[Click] Place floor`, `[Click] Cast`, `Too far`) and say nothing on a bad click. For 662, show `[R] Repair` in the slot while holding a worn hook.

### Tracker, top-right (persistent state and objectives)
| string | source |
|---|---|
| `Hook a floating supply to get started` (objective; new chain: hook supplies, craft hammer, build floor…) | #goalText index.html:8 |
| `Waiting for your brother's raft…` | updateContext game.js:404 |
| `Wait for your raft to connect` (guest acts before ready; make it the tracker line and drop the per-click repeat) | notice game.js:517, 617, 628, 645, 651 |
| Connection label `ROOM X` / `TWO ABOARD · X` / `BROTHER LEFT · ROOM OPEN` / `DISCONNECTED` | setConnectionLabel game.js:957-1041 |

### Keep in modal (in-dialog text; restyle the dialogs left-aligned, no new HUD)
| string | source |
|---|---|
| `Need 2 more wood` (craft failure, `'Need ' + …`): the inventory already shows `0/2` chips and `.sv-why`, so drop the notice or show it inline | emit notice game.js:548 |
| `No room in inventory`, `No recipes known.`, `.sv-hint` | survival-ui.js:338, 311, 220 |
| setStatus (crew dialog `#networkStatus`): `Connection timed out…`, `Room ready. Send this code to your brother.`, `Could not open room: X. Solo play still works.`, `Could not connect: X…`, `Connection hiccup: X.`, `Lost the matchmaking server. Reconnecting…`, `Connected! Your brother is aboard.`, `Connected. Loading your brother's raft…`, `Connected! You are aboard your brother's raft.`, `Host disconnected. Rejoin when their tab is open.`, `Connection failed. Check the code and try again.`, `Your room is open. Share the code below.`, `Online play is unavailable. Solo play still works.` / `…Try solo for now.`, `Opening your room…`, `Enter the six letters from your brother's screen.`, `Finding your brother's raft…`, `Code copied. Send it to your brother!`, `Select the room code and copy it manually.` | game.js:963-1069 |
| `The ocean could not load…` (#raftLiveError), `The 3D ocean could not start…` (#loadError) | live.js:80; game.js:1202 |

### Remove
`#toast` element, `#aimHint`, `.welcome-caption`, the dead hidden legacy HUD (`#durability`, `.inventory`, `.controls`, `#recipes`), and the welcome pills/paragraph.

## Notes and gotchas
- Naming is inconsistent: the pickup prompt says `plank` (ITEM_NAMES, game.js:29), but the loot line says `+ 2 wood` (ITEM_INFO names, inventory-state.js:14). Pick one before writing feed copy (the owner's example is `+2 plank`).
- Notices pre-empt the pickup prompt for 1.8–3 s (game.js:405 runs before 406). Splitting feed and prompt fixes a real usability bug.
- `emit(...,'all')` for builds means the guest also gets `A little more room!`. That is fine for the feed, so prefix it with who built it.
- The `effect()` beep pitch by kind (game.js:530) is a ready-made feed-styling key.
- A `Continue` button needs a save check (`localStorage['little-raft-v1']`, game.js:36). Today `#solo` always resumes the save, so `New Game` has no wipe path.

**Count: 24 UI elements in the table. Section B has 41 message rows: 23 feed, 10 prompt slot, 4 tracker and 4 keep-modal rows (the setStatus row alone holds 19 crew-dialog variants).**
