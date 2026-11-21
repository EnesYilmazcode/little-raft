# Collection net

Code: `dist/nets.js` (rules, model, view), hooks in `dist/game.js` tagged `[nets]`. Tests: `tests/net.test.mjs`.

- **Cost**: 6 planks (wood) + 8 rope + 2 nails (`items.js`, mirrored in `inventory-state.js`).
- **Placement**: hold the net and aim at open water beside a tile edge (or at a tile near its edge). The ghost
  hangs off that side, facing outward. A net is `{x, z, d, items}`: the tile it hangs from, the side `d`
  (index into `NET_DIRS`: +x, -x, +z, -z) and its contents. It is not a tile: nobody stands on it, and no
  foundation can be built on the water cell it covers ("A collection net hangs there"). One net per water cell.
- **Catching**: each host drift step tests the segment from the old to the new position against the net's
  axis-aligned 1.8 m x 1.05 m rectangle. A hit with room puts the piece into `items` (it rests in the net,
  visible) and the debris slot respawns upstream. Capacity 10; a full net lets debris float past.
  Planks, leaves, scrap, plastic and barrels are caught; the signal cache and message bottles never.
  Items on a hook are skipped (they do not drift).
- **Emptying**: E while aiming at a net within 2.2 m sends `{kind:'emptyNet', x, z, d}` through `action()`.
  The host rolls each piece's loot (`LOOT`, barrels via `rollBarrel`) into the actor's bag, one piece at a
  time and all-or-nothing per piece; whatever does not fit stays in the net. The prompt reads
  "Empty net (n)" (from the `game-context` prompt provider).
- **Shark**: when the shark tears off a foundation, the nets hanging from it sink with it, catch and all
  (`removeTile` in dist/shark.js). The shark bites from a side without a net when the tile has one.
- **Co-op**: the host snapshot carries `world.nets`; the guest rebuilds the net view when it changes.
- **Old saves**: a net used to be deck decor that pulled debris within 4 m into the host's bag every 0.8 s.
  On load each old deck net moves to the nearest free edge spot (closest edge midpoint to its old tile).
  If the raft has no free edge spot left, it stays as inert deck decor.
- **Model**: wood frame + floats in one merged vertex-coloured mesh, rope netting in a second (two draw
  calls per net, shared geometry, no shadow casting).
