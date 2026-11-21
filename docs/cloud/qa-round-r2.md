# Visual QA, round r2: decor pickup, Flagpole and flag designer, sitting

Date: 2026-11-21. Branch `claude/loop-features-202611210847-r2`, shipped `dist/` (nothing in `dist/` was changed).
Rig: headless Chrome with SwiftShader, `?fixedres`, 1280x720 at scale 1 (the phone shot is 390x844). Scenes were driven with
`raftDebug` (`undecor`, `content.flags`, `content.sit`, `content.decorpack`) plus real input: X held and released with the hammer, Tab, and E.
Scripts (scratchpad): `qa2_shots.py`, `qa2_wind.py`, `qa2_inv.py`. Baseline run: `python shoot.py dist <scratchpad>/qa2-base`.
- **Console:** no page errors in any run, the baseline included. The only warnings were the usual SwiftShader ones (`KHR_parallel_shader_compile`, `GPU stall due to ReadPixels`).
- **Shots:** key shots, JPEG at 82 quality and under 120 KB each, are in `docs/cloud/shots/r2/`.

## Shots

| Shot | What | Verdict |
|---|---|---|
| a1 `a1-ghost-crate` | Hold X with the hammer on a crate that has 3 wood inside | **Pass, with notes.** The red tint and the chip "Release X to pick up the Crate" are clear and readable. The tint covers the real crate, so it reads as a solid salmon crate, not see-through. A stale feed line on the left ("Point at an empty space beside the raft") contradicts the action. |
| a2 `a2-ghost-bench` | Same, on a bench | **Pass.** Red bench, chip "Release X to pick up the Bench". The bench sits on the deck with no floating. |
| b1 `b1-feed-crate` | After release | **Pass.** The feed shows "Picked up the Crate", "+1 Crate" (with icon) and "+3 Plank", and the hotbar gains the items. The feed says "Plank" while the build card says "wood" (older naming split). |
| b2 `b2-feed-bench` | After release | **Pass.** "Picked up the Bench", "+1 Bench", and the bench icon lands in slot 5. |
| c1 `c1-flags-deck` | Two flagpoles with different designs (coral and cream stripes with a shell; lagoon border with an anchor), seen from the deck | **Pass.** Good scale (taller than the pennant, without dwarfing the raft) and a tidy plinth, knob and halyard. Both cloths fly the same way. The left one is close to edge-on from this view, which is correct for this wind. The cozy low-poly style matches. |
| c2 `c2-flag-closeup` | Close-up under the coral flag | **Pass.** The wave shader reads well. The "E Design flag" prompt is clear. The cream shell on cream stripes is hard to see (the player's own colour choice, see issue 7). |
| d0 `d0-flag-prompt` | Aiming at the pole | **Pass.** "E Design flag". |
| d1 `d1-flag-dialog` | Flag designer at 1280x720 | **Pass.** Warm wood panel, a live preview, labelled rows, selection rings that are easy to see, emblem tiles tinted with the background colour, and a green Save button with focus. Nothing is clipped. |
| d2 `d2-flag-dialog-phone` | Flag designer at 390x844 | **Pass, with notes.** The dialog fits (366x728, no horizontal scroll, page `scrollWidth` 390). The 8-swatch rows wrap 7+1, the patterns 5+1 and the emblems 7+2, which leaves single orphans. "Pattern colour" is hidden because the pattern is Plain, which is intended (`flags-ui.js:117`). |
| e1 `e1-seated-bench` | Seated on a bench, first person | **Pass, with notes.** The eye height is lower and the prompt "Sitting / WASD/Space/E Get up" is readable. The frame shows only sea: no deck, knees or bench, so nothing tells you that you are sitting. |
| e2 `e2-seated-cushion` | Seated on a cushion | **Pass.** The lower eye height reads well (deck in frame, the bench looms large). |
| e3 `e3-cushion-model` | The cushion model on the deck | **Pass.** A small pink pillow with tassels, in the cozy style. It is quite small and flat from standing height, but acceptable. |
| f1 `f1-partner-seated` | Co-op guest seated, seen from behind | **Pass.** The avatar sits on the bench facing the sea, with the "Brother" tag. |
| f2 `f2-partner-seated-side` | Co-op guest seated, side view | **Fail (cozy polish).** The legs stick straight out level and the feet hover about 0.4 m above the deck, because the avatar has no knee joint. The spec lists this as a known gap. At this distance the "Brother" nameplate also overlaps the top banner. |
| g1 `g1-inventory` | Inventory with a Flagpole in slot 5 | **Pass.** The Flagpole icon (pole, gold knob, yellow flag, navy shell) is readable at hotbar size. |
| g2 `g2-inventory-flagpole` | Building tab, Flagpole recipe selected | **Pass, with notes.** The row, description ("Place it, then press E to design your flag."), cost of Plank 4, Rope 2 and Palm Leaf 2, and the icon are all right. The locked row still says "Ready to craft x2" next to the lock and "Study Plank + Rope + Palm Leaf". This is older behaviour: Bed does the same. |
| h1, h2 `h1-pennant-vs-flag`, `h2-…-deck` | Wind Pennant (decor pack) beside a Flagpole | **Fail.** The two cloths fly in different directions (see issue 1). |
| h3 `h3-looking-downwind` | Looking downwind | **Fail.** The flag runs away from the camera (downwind), while the pennant sticks out sideways across the wind. |
| h4 `h4-across-wind` | Looking across the wind | **Fail.** The flag is broadside, the full cloth width toward the camera, while the pennant beside it is nearly edge-on, which means 90 degrees apart. |

## Ranked issues

1. **High: the Wind Pennant flies 90 degrees off the wind (confirmed).**
   - **Evidence:** world-space direction of each cloth's local +X, from `matrixWorld` via `window.raftMount.scene`, with `windDir = 0.6`, so the downwind vector is (0.565, 0.825).
     - **Flagpole:** tip (0.556, 0.831), bearing 0.59 rad, which matches the wind.
     - **Pennant:** tip (0.768, -0.640) and (0.910, -0.415). Its bearing over 2 s was 2.27, 2.44, 2.47, 2.35 and 1.95, a mean of about 2.2, which is the wind plus pi/2 with sway on top.
     - **Visible in:** h3 and h4.
   - **Cause:** the pennant cloth runs along local +X (`decor-pack-models.js:97-98`, quads from x=0 to x=.9). Yaw `a` maps +X to world (cos a, -sin a), so the downwind yaw is `windDir - PI/2`. `flags.js:198` and `sailing-world.js:142-143` both use that; `decor-pack.js:173` does not.
   - **Fix (`dist/decor-pack.js:173`):**
     `sw.rotation.y = wd - Math.PI / 2 - a.g.rotation.y + amp * Math.sin(t * (4 + 4 * ws) + ph);`
   - **Test:** add a regression test that checks the pennant swing's world +X against `(sin wd, cos wd)`, with a dot product above 0.9 when ws is low.
2. **Medium: the seated partner's legs stick straight out and the feet float (f2).** The spec calls this a known gap. It is the most visible flaw in co-op sitting.
   - **Fix (`dist/coop-avatar.js`):** split each leg into thigh and shin, putting the shin in a child group pivoted at the knee (about 0.45 m down the leg). In the sit block (around :247), set `shin.rotation.x = lerp(0, +1.45, A.sit)` so the shins hang vertically.
   - **Cheaper fix:** fade in a pre-bent shin mesh while `A.sit > .5`.
3. **Medium: no seated cue in first person on a bench (e1).** The view is sea only, with no deck, knees or bench, so sitting looks like standing a little lower.
   - **Fix (`dist/sitting.js`, sit-down handler):** when the seat is entered, ease the pitch to about -0.22 rad (only if the current pitch is above that), so the deck edge and bench front come into view.
   - **Optional:** show a simple knees and lap mesh in front of the camera while seated.
4. **Low: the pickup ghost reads as a solid recoloured item, not a red see-through ghost (a1, a2).** `game.js:1611` shows the ghost over the real model, so the tint looks like the item was painted salmon. That could be confused with the paint feature.
   - **Fix (`dist/game.js:1611`):** hide the real decor group (`decorGroups` entry with matching `tileKey`) while `undecorEx.d` is shown, and restore it when the ghost clears.
   - **Alternative:** give the ghost a stronger red (#e04a3a) with the opacity around .55, so the deck shows through.
5. **Low: conflicting hints while picking up (a1).** The feed line "Point at an empty space beside the raft" from building mode stays on screen next to "Release X to pick up the Crate". The build card header still reads "Foundation 2 wood 2 plastic" in red, which is older behaviour also seen when removing pieces.
   - **Fix (`dist/building.js:94`):** while `removeExtra?.d` is set, call `menu.setTitle?.(name)` (or hide the cost row) so the card names the item being picked up.
   - **Fix (feed):** drop or expire the stale build hint once X is held.
6. **Low: the partner nameplate overlaps the top banner up close (f2).** The "Brother" tag sits at the very top under the "Click the ocean…" banner.
   - **Fix (`dist/coop-avatar.js`, tag update ~:265):** fade the tag out when the camera is closer than about 2.5 m, or clamp its screen y below 70 px.
7. **Low: the emblem disappears when its colour matches the pattern colour (c2).** Here it was cream on cream stripes.
   - **Fix (`dist/flags-model.js` painter):** stroke the emblem with a 2 px outline of the background colour, or darker if it is the same, so it always reads.
   - **Alternative (`flags-ui.js`):** nudge Random away from matching emblem and pattern colours.
8. **Low: phone dialog rows leave orphans (d2).**
   - **Fix (`dist/flags-ui.js` CSS):** under `@media (max-width:420px)`, use `#lr-flag .flag-row .sw{width:36px;height:36px}` with gap 6px so all 8 swatches fit on one row (8x36 + 7x6 = 330 px, against a ~334 px content width), or lay the rows out with `grid-template-columns:repeat(4,1fr)` for an even 4+4.
9. **Low (older behaviour): locked recipes still say "Ready to craft x2" (g2).** The rows show a lock and "Study …" but keep the green ready line, and Bed does the same.
   - **Fix (`dist/craft-book.js` row renderer):** when the recipe is gated, replace the ready and count line with the study hint.
10. **Low (test helper only): `content.sit.sit()` called by the guest can fail on the first try.**
    - **What happened:** in two runs, the guest's first `sit(0,1,0)` right after teleporting left it unseated after 1.5 s. A retry worked, probably because the host checks reach against the lagged `ctx.other`.
    - **Impact:** a real player walks to the bench, so only scripts are affected.
    - **Fix:** after `stand()`/teleport in the debug `sit`, wait one pose send before sending `sit.down`.

## Pennant direction: yes, it is a bug

The decor-pack Wind Pennant points about 90 degrees from downwind, while the Flagpole (and the sail's own pennant) point downwind.
- **Evidence:** measured bearings of about 2.2 rad against a wind of 0.6 rad, versus 0.59 to 0.66 rad for the flag (issue 1), plus shots h3 and h4.
- **Fix:** a one-line change at `dist/decor-pack.js:173`, adding `- Math.PI / 2`.
