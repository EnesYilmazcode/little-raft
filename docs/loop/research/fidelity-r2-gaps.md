# Raft fidelity research, round 2: gap list against raft-master

The wiki hosts were DNS-blocked, so these numbers come from search summaries of raft.fandom, gamepedia, gameranx, mejoress, segmentnext and Steam guides.

## Farming
- Raft has a Small Crop Plot (6 planks + 4 rope, 3 slots) and a Medium Crop Plot (8 planks + 4 scrap, 2 slots). We have only a 1-slot palm planter.
- Raft crops: beet takes about 50 s and yields 2 beets, and a beet is its own seed. Potato takes about 5 min. Seeds come from barrels and islands. We have no beet, no potato, and no seed drops.
- In Raft, harvesting gives seeds back. Our palm harvest gives 2 leaves and sometimes 1 wood.
- In Raft, seagulls raid crops every 4 min, and a scarecrow (5 planks, 3 leaves, 3 nails, 3 plastic; 3 HP; about 6 m range) protects them. Our gulls are scenery.

## Collection net
- Raft: the net is placed on the raft edge and catches debris that drifts into it. It holds 10 items, which you empty by hand. Cost: 6 planks + 8 rope + 2 nails.
- Ours: decor that pulls anything within 4 m straight into the host's bag every 0.8 s, with no capacity. Cost: 3 wood + 3 rope + 2 nails.

## Shark counter
- Raft: Foundation Armor costs 1 metal ingot + 2 nails, and the shark ignores an armored tile. Ours: none. The tileArmor contract exists in shark.js.

## Starting raft and costs
- Starting raft: Raft 2x2, ours 3x3. Both start with only a hook.
- Plastic hook: Raft 40 uses with no repair (you craft a new one). Ours: 50 uses, R repairs it, and range is 16-32 m depending on wear.
- Sail: Raft 10 planks + 20 leaves + 3 scrap. Ours: 4 wood + 3 rope + 3 leaves.
- Simple purifier: Raft 6 planks + 6 leaves + 4 plastic, burns planks, about 30-60 s per cup. Ours: 2 wood + 2 scrap + 1 plastic, 15 s, no fuel.
- Empty cup: Raft 4 plastic. Ours: 1.
- Paddle and anchor: crafted items in Raft. Ours are free actions.
- Simple bed (sleep and respawn point): missing.

## Round 2 picks
1. Crop plots with beet and potato.
2. A Raft-style collection net.
3. Foundation armor plus a 2x2 start and Raft costs.
