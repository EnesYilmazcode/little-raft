# Raft fidelity research, round 1: survival stats

The wiki hosts were DNS-blocked, so these numbers come from search summaries of raft.fandom.com (Hunger, Thirst, Player, Sustenance) and raft.wiki.fextralife.com. Lines marked [G] are our own tuning.

## Rates (Normal)
- Health 100, hunger 100, thirst 100. A new game starts full.
- Hunger drains 0.09/s (empty in about 18.5 min). Thirst drains 0.11/s (empty in about 15 min).
- Sprinting or swimming drains about x1.5 [G].
- Each bar at 0 costs 0.75 HP/s, and the two stack.
- Health regenerates 0.25 HP/s while hunger > 0 and thirst > 0, with no regen for 3 s after taking damage [G].
- Raft also has a bonus segment that only dishes and juices fill. We skip it for now.

## Food and drink (hunger / thirst)
- Raw mackerel +15 / -10; cooked mackerel +35 / 0. Raw pomfret +12.5 / -10; cooked pomfret +20 / 0.
- Raw potato +10; cooked potato +15. Raw beet +10. Coconut +5 / +20.
- Cup of fresh water 0 / +40, and it gives the empty cup back. Cup of salt water 0 / -5.
- Grill cook time is per item: 40 s pomfret, 60 s mackerel.

## Death
- On Normal solo you respawn on the raft with full stats and lose the inventory. Easy keeps the inventory.
- Ours: respawn at the raft centre with 100 health and 75 hunger/thirst [G]. The hotbar and the hook are kept, so the player can never get stuck [G].

## HUD
- Three bars stay in the lower left: health (heart, green/red), hunger (orange), thirst (blue droplet).
- A bar pulses red below 10%. At 0 there is a red vignette while damage ticks, plus a red flash on each hit [G].
- To eat or drink, select the item and press LMB. It takes about 1 s, with a gulp or munch sound [G].
