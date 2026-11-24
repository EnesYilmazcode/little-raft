# HUD lane hand-offs

Screens audited at 1536x864 and 1920x1080: `hud-before-*.png` / `hud-after-*.png` in this folder.
These gaps sit in files the HUD lane does not own.

## Crafting fleet (survival-ui.js)

1. Hotbar slots are beige wooden tiles in a wooden frame (`.tools.sv-hotbar>button.sv-slot`, lines ~204-241).
   Raft: dark translucent squares (about `rgba(0,0,0,.45)`), thin light border `rgba(255,255,255,.35)`,
   small gap, no frame around the row. Compare `hud-after-prompt-crate-1920.png`.
2. Selected slot: Raft draws a brighter, thicker off-white border (`#f2f2f2`, 2 to 3px); no `scale(1.06)`.
3. Slot number labels (`.sv-num`, "1".."0" in the top-left corner) are not drawn in Raft. Hide them in play;
   keys 1-0 still work.
4. Stack count: keep white, bottom-right, with a dark shadow so it reads on the dark slot.
5. Durability: thin bar along the bottom edge is right; on a dark slot it can stay green to red.
6. The vitals (now dark, icon-only bars, vitals-ui.js) and the Notes plate (onboarding.css) use the
   palette above, so the beige hotbar is the one surface that still looks off.

## Other lanes

- sailing-ui.js: compass chip "No sail, craft one" (written with an em dash in the UI) is text under the compass.
  Suggest an icon (sail glyph, crossed or dimmed) or drop the chip; the Notes tracker already says "Raise a sail".
- fishing-cooking.js: bottom-left "Fish 0/8 · J" chip uses an emoji and text. Suggest a small fish icon + count only,
  or show it only in the fish journal.
- build-menu.js (removal lane may already be editing it): the hammer chip near the hotbar carries a text
  key legend ("Q / Right-click pieces · R rotate · X remove"). Raft shows only the piece cost (icons + have/need),
  bottom right. Suggest dropping the legend line once the Notes / help cover it, and moving the chip off the
  hotbar's left edge.
- fishing-v2.js / progression-hooks.js / diving-ui.js gather label still sit in the old side column at
  `calc(50% + 34px)`; the key prompt is now centred under the crosshair. They do not overlap, but a later
  pass could centre them under the prompt for consistency.
