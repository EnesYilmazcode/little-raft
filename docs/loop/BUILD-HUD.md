# Build removal and HUD (branch claude/raft-build-hud)

## Why walls "could not be removed"

- Hammer X on walls and other building pieces worked all along: same session, after a reload, from an old save
  (pieces without `r`) and as a coop guest.
- Foundation tiles (the planks players build most) had no removal at all. Merge e46d6d6 dropped `removePiece` and the
  `'remove'` host branch that bdb46aa had added, so `floorRemoveBlock` / `refundOf` in placement.js became dead code.
- Nothing on screen said X removes things, so players never found it.
- Raft players also reach for the axe (in Raft you hold left click with the axe to dismantle), and the axe did nothing.
- Repro: `check_removal.py`. Before: 18/23 pass. Fails were the hammer corner hint, foundation removal on the host,
  the axe hint, axe hold on a wall, and guest foundation removal. After this branch and the review fixes: 26/26
  (three steps added: a grill tile refuses hammer X, axe hold on the deck removes nothing, a guest is refused on a
  tile someone stands on).

## What changed

Removal
- dist/build-remove.js: pure rules for pieces (`unpiece`) and foundation tiles (`untile`), host-authoritative,
  full refund into the actor's bag, all or nothing (a full bag refuses).
- dist/build-hint.js: corner key-cap hint while a removal tool is held ("X Remove" with the hammer,
  "Hold click Dismantle" with the axe) and a thin fill ring around the crosshair while the axe works.
- Axe hold-click (1.1 s) dismantles building pieces. The host checks the tool and reach.
- `untile` host action in game.js (reach checked, raft rebuilt on success).

Review fixes
1. A grill on a tile (fishing-cooking.js grills, not in world.decor) now blocks removing that tile:
   "Clear what stands on this floor first". Passed in as `hasGrill`.
2. An armored foundation refunds its Foundation Armor item (`armor`, made from 1 metal ingot + 2 nails) along with
   the planks. If the bag cannot hold it all, nothing is removed.
3. The axe dismantles building pieces only (walls, floors, stairs, pillars and so on), never foundation tiles.
   When the axe ray hits the deck or a placed item first, there is no highlight and no ring, and the click goes to
   palm chopping. A worn-out axe (durability 0) does not dismantle (same rule as island chopping); the host refuses
   it too ("This axe is worn out"). Foundations come off with hammer X only.
4. HOST_CAPS gains `untile` and `axeRemove`. A new guest on an old host gets a notice
   ("Your friend's raft can't take that apart yet") on hammer X over a tile instead of silence, and the axe
   dismantle path is not offered.
5. Oxygen row: while it shows, `html.dive-o2` lifts the pickup feed (and the #coopFeed fallback) clear of it.
   Checked by DOM rects while diving with a feed entry at 1536x864, 1920x1080, 1050x700, 900x700 and 760x700:
   no overlaps. Before: oxygen vs pickup feed at 900 wide, oxygen vs #coopFeed at 1536 and 1920.
6. A tile where the host or the guest stands is refused: "Someone is standing there" (host `untile` branch and the
   local chip).
- Minor: the dive gather label is centred under the crosshair ring like the new prompt. At 760 px wide and below
  the corner hint sits above the hotbar instead of under the Notes tracker.

HUD
- Vitals as Raft-style icon bars bottom-left: thirst, hunger, health. Oxygen is a fourth row while diving.
- The key prompt is centred under the crosshair; coaching lines without a key are hidden.
- Notes tracker and pickup feed on a neutral dark plate.
- The first-run hint chain no longer repeats what the Notes say.
- The ghost box under the pause rail is gone.

Screenshots (docs/loop/build-hud/)
- HUD: `hud-before-*.png` and `hud-after-*.png` (title, idle-fresh, idle-save, hammer, hammer-down, prompt-crate,
  pickup-feed, low-vitals, death, swimming, underwater, underwater-diving, pause, settings, settings-graphics) at
  1536 and 1920.
- Removal: `before-hammer-held.png`, `before-hammer-x-on-wall.png`, `before-hammer-x-on-foundation.png`,
  `after-hammer-held.png`, `after-hammer-x-on-wall.png`, `after-hammer-x-on-foundation.png`, `after-axe-held.png`,
  `after-axe-dismantling.png`.
- Integrated branch: `integrated-hammer-*.png`, `integrated-hammer-xheld-*.png`, `integrated-axe-*.png` (1536, 1920).
- Review fixes: `hud-after-dive-o2-feed-1536.png`, `-1920.png`, `-900.png` (diving with a feed entry),
  `hud-after-axe-hint-760.png`.

## Reference

docs/loop/raft-hud-reference.md. The web fetch of the Raft wiki and Steam pages was blocked, so many items there are
tagged recalled or unverified.

## Remaining gaps

- Hotbar: beige wood slots and slot numbers (crafting fleet, survival-ui.js).
- Compass chip text in sailing-ui.js still has an em dash ("No sail ... craft one").
- Fish chip text in fishing-cooking.js ("Fish 0/8 · J").
- Build chip in build-menu.js: text key legend and warm brown style.
- Side readouts (fishing reel, binoculars) still in the old side column at `calc(50% + 34px)`. The dive label moved.
- Pickup feed stays bottom-left (Raft shows pickups on the right).
- Notes tracker is text heavy.
- The axe does not lose durability when dismantling.
- Full refund vs Raft's 50%: a decision for the player.
- Damaged tiles also refund in full (left as is on purpose).

## Hand-offs for the crafting fleet

- survival-ui.js ~204-241 hotbar: dark translucent slots `rgba(0,0,0,.45)` with a thin `rgba(255,255,255,.35)` border,
  no wood frame. Selected slot: thicker `#f2f2f2` border, no `scale(1.06)`. Hide `.sv-num`. Keep the white count
  bottom-right.
- Axe durability wear on dismantle (inventory-state.js owns wear).
- More detail: docs/loop/build-hud/handoffs.md.

## Tests and perf

- `npm test`: 1504 pass, 0 fail.
- Browser checks:

| check | result |
| --- | --- |
| check_settings, check_held_items, check_island_arrival, check_paddle | pass |
| check_removal | pass, 26/26 |
| check_game, check_hook, check_multiplayer, check_connection, check_survival, check_upgrade | fail, identically on base origin/claude/raft-feedback-all |
| check_live_feed | skipped (it rewrites dist/version.json) |

- Frame time (shoot.py, swiftshader, so noise is large): 3 runs each, 120 frames: branch avg 101.5 ms (106.6, 98.3, 99.4) vs base avg 107.7 ms (107.3, 113.9, 101.9); worst frame about 250 ms on both. No regression; no page errors on either.
