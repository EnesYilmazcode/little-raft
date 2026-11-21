# Little Raft: onboarding research (no centre-screen text)

Sources: web search (standard mode) plus my own knowledge of the games. The web turned up mostly
guides and wikis, not developer postmortems, so treat any claimed design intent as inferred.
Items marked (K) come from my knowledge only, not from a source I checked.

## 1. Concrete patterns by game

| Game | Pattern | Takeaway for Little Raft |
|---|---|---|
| Raft | You start on a 2x2 raft holding only a plastic hook. Debris drifts past continuously, so the world itself acts as the tutorial. Interaction prompts are small text near the crosshair. The hotbar sits at the bottom centre. (K) | Start with the hook already in hand and debris already floating toward the raft. Players figure out throwing before they read anything. |
| Raft | The Building Hammer is the first major unlock and turns planks into raft growth. Guides tell players to spend 15-30 minutes just learning to build. | Make the hammer the first-hour payoff, not a first-minute task. |
| Minecraft (Java) | Tutorial toasts appear in the top-right ("Move: W A S D", "Punch a tree", "Open your inventory"). Each one closes itself when the player does the action. (K) | This is the closest model for us: corner cards that complete themselves and never sit in the centre. |
| Minecraft | Advancement toasts appear top-right with a header colour by type. Recipe-unlock toasts appear when you pick up a related item, and the recipe book shows only what you can make. Players complain the toasts repeat and cover the HUD. | Pop a "New recipe" card the first time an ingredient lands in the bag. Show it once per save and keep it short. |
| Grounded | A quest list sits in the upper-left. Open tasks have a "!" and finished ones a check. Tutorial tasks carry a "tutorial" tag. BURG.L tutorial quests unlock mechanics one at a time. | Use the same structure for a corner tracker: icon, verb, item and count. Strike each task through when done. |
| Valheim | Hugin the raven pops in at each new milestone with a short hint, and past hints can be re-read in the inventory. Players call him naggy and unskippable, but he does fade out over time. | Hints should be triggered by events, rare, re-readable in the bag, and fade out. Never block the view. |
| Subnautica | The opening is almost silent. The PDA gives one objective (survive), a "press Tab" prompt, and a few tool hints ("Break limestone"). The scan/blueprint loop does the teaching. Subnautica 2 drew complaints for reading like a tutorial. | Less text keeps the wonder. Teach through the recipe list growing as you collect things. |
| Sea of Thieves | Prompts are attached to the object ("E Pick up") rather than fixed to the screen. The HUD is minimal. The Maiden Voyage teaches in an optional space. (K) | Anchor prompts to the debris or the crosshair, and offer to skip all hints. |
| Stranded Deep | Almost no guidance. The wristwatch holds status, and crafting is found by experiment. Players often feel lost. (K) | This is what happens with zero guidance. A friendly game needs a little more than this. |

## 2. Corner tracker ("Notes" card)

- **Position:** top-left, 24px inset. That keeps the top-right free for "New recipe" or "Unlocked" toasts and the bottom-centre free for the hotbar.
- **Width:** about 260px. Show at most 3 lines at a time: the current step plus 1-2 upcoming ones in grey. Never show the whole list.
- **Row format:** `[item icon] Verb noun  2/4`
  - `Hook some planks  0/4`
  - `Craft rope  0/1` (with a small "Tab" key glyph inline)
- **Completion:** a check mark, a soft chime, a 0.4s strike-through, then the row slides up and the next row fades in. Celebrate each step quietly and never with a modal.
- **Tone:** second person, warm, 3-6 words, verb first. No exclamation spam and no lore. Examples: "Grab that barrel", "Plant a palm", "Catch your first fish".
- **Header:** a tiny label such as "Raft Notes" or a notebook icon. It collapses to the icon alone after 8s without progress, or when the player is fishing or building.
- **Controls:** a toggle key (`J` or `N`) plus a Settings option "Hints: On / Minimal / Off".
  - "Minimal" shows the key prompts only.
  - "Off" also hides the tracker.
- **Persistence:** save step progress per save. If the player does a step early (say, crafts the hammer before being asked), that step completes silently. Never ask for something already done.
- **Re-reading:** keep a "Notes" tab in the bag listing finished steps and tips, as Valheim does with Hugin.

## 3. Contextual key prompts (near the crosshair)

- **Placement:**
  - Default: just below and right of the crosshair, about 28-40px down and 16px right, left-aligned. That is close enough to read without the eyes moving, but never on top of the target.
  - World-anchored alternative: the prompt floats above the targeted debris and is clamped on screen.
- **Format:** `[E] Pick up Plank`
  - The key cap is a rounded square (6px radius), 1px light border, dark translucent fill, bold 13-14px glyph.
  - The action label is regular weight, 14px, with a soft text shadow and no panel.
  - Hold actions show a radial fill ring around the key cap.
  - Mouse actions get a mouse icon with the button highlighted (LMB/RMB), not the letters "LMB".
- **Lines:** one prompt at a time, with a second line only for a true alternative (`[R] Rotate`).
- **When to show:**
  - Interact prompts only while a target is in range and under the crosshair (pick up, plant, open crate).
  - Tool prompts (`Hold [LMB] Throw`, `[LMB] Reel in`) only on the first 3 successful uses of that tool, then hide.
  - Build prompts (`[LMB] Place`, `[R] Rotate`, `[RMB] Cancel`) appear while the hammer is out. They shrink to the key caps alone after about 5 placements.
- **When to hide:**
  - With the bag or a menu open.
  - While the player is reeling, so only the charge or reel ring shows.
  - 0.15s after losing the target, with a fade so the prompt does not flicker.
- **Charge feedback:** the hook charge is a thin arc around the crosshair, not a bar and not text.
- **Rebinding:** glyphs always reflect the current binding, and gamepad glyphs swap in automatically.

## 4. Pacing

### First 10 minutes (each step completes itself; tracker in the corner)

| Time | Beat | Teaches |
|---|---|---|
| 0:00 | Spawn facing a plank drifting toward the raft, about 8m away. Prompt: `Hold [LMB] Throw`. | Hook |
| 0:30 | "Hook some planks 0/4". Spawn extra debris in front of the player, upwind. | Throw and reel |
| 1:30 | Leaves arrive. "Hook 2 leaves". A plank bumps the raft edge and shows `[E] Pick up`. | E pickup |
| 2:30 | "Open your bag [Tab]" then "Craft rope". Rope glows in the recipe list because it is craftable. | Crafting |
| 3:30 | "Craft a hammer" (4 wood, 2 rope). Plastic now appears in the debris mix. | Gathering mix |
| 5:00 | "Build a floor tile". A ghost tile glows at the raft edge with `[LMB] Place`. | Build |
| 6:30 | A barrel drifts past: "Grab that barrel" pays out a bundle, a small surprise. | Variety and reward |
| 8:00 | "Craft a palm planter" then "Plant a palm". | Plant |
| 10:00 | Fishing rod is listed as next but needs 8 rope. That is the first longer goal. | Goal setting |

### First hour

- **10-20 min:** fishing rod, then first fish, then a fishing tip (`Hold [LMB] Cast`, a bobber dip cue with a sound and no text).
- **20-35 min:** sail, lantern and crate. Each first craft pops a "New recipe" card in the top-right.
- **35-60 min:** net (passive gathering) and bench. The tracker hands off to soft goals ("Grow the raft to 12 tiles", "Catch 5 fish") and then goes quiet. After about 45 minutes, no more new hints.
- **Farming branch:** once that merges, the "Plant a palm" step becomes a short farming chain (plant, water, harvest). Keep it in the same tracker format.

## 5. Title screen

- **Camera:** a slow orbit or dolly around a small raft at golden hour, with gulls, debris drifting past and a gentle bob. The same scene loads straight into gameplay (Raft-style).
- **Menu:** left-aligned in the bottom-left third, so the raft stays visible on the right. No centred logo block over the raft; put a small logo top-left.
- **Buttons:** Continue (only when a save exists, listed first and focused by default), New Game, Settings, Quit.
  - Continue shows the save's day or time played in small grey text.
  - New Game asks for confirmation only if it would overwrite a save.
- **Transition:** from the title, the camera flies down into first-person, with no loading text in the centre (use a small corner spinner if needed).

## 6. Anti-patterns to avoid

1. Centred text boxes or modal "TUTORIAL" popups, in any form. Use the tracker and toasts.
2. Unskippable or nagging hints that repeat after the player has learned something (Valheim's Hugin complaint). Fire each hint once and remember it in the save.
3. Toasts that pile up and cover other UI (Minecraft complaint). Show at most 1 toast at a time, queue the rest, and show each for 4s.
4. Asking for steps the player already did, or blocking progress until the "right" order is followed.
5. Walls of tooltip text in the bag. Show recipe costs as icons and counts, with missing items in red.
6. Prompts that flicker as the crosshair passes over debris. Use hysteresis and fades.
7. Hard-coded "Press E" when the player has rebound the key.
8. Starving the player. In a no-danger game, the first 2 minutes must deliver obvious debris every few seconds.
9. Zero guidance (the Stranded Deep failure mode), or front-loading every system (the Subnautica 2 complaint).
10. Text for feedback that sound and animation can carry (bobber dip, hook splash, craft "pop").

## Sources
- https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/109 (Grounded tracker)
- https://grounded.fandom.com/wiki/Quests
- https://www.escapistmagazine.com/forced-tutorials-are-a-nuisance-and-valheims-hugin-needs-to-stop-squawking/
- https://minecraft.wiki/w/Toast_notification
- https://forums.unknownworlds.com/discussion/comment/2398333 and https://subnautica2.nolt.io/12787
- https://gamersdecide.com/articles/raft-beginner-guide and https://primagames.com/tips/raft-beginner-guide-tips-and-tricks-to-get-started
