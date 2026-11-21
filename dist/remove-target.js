// Little Raft - hammer + X removal: one targeter and one rule set, shared by the prompt, the red
// ghost and the host's 'remove' / 'unpiece' actions (BUILD-1..6, CRAFT-4). Pure: no DOM, no THREE.
// Targets: {what:'piece', rec, t} | {what:'decor', x, z, type, rot, t} | {what:'floor', x, z, t}
// (decor and floor in tile cells; t = distance along the aim ray in metres).
import { floorRemoveBlock, DECOR_REACH, FLOOR_REACH } from './placement.js?build=v3-survival-ae77fa84ac2b';
import { BLOCK_TEXT, removePrompt } from './build-rules.js?build=v3-survival-ae77fa84ac2b';
import { playerInWay } from './coop-rules.js?build=v3-survival-ae77fa84ac2b';

// The nearest of the candidates (null / undefined entries and t = Infinity skipped), or null.
export function nearestTarget(...cands) {
  let best = null;
  for (const c of cands) if (c && Number.isFinite(c.t) && (!best || c.t < best.t)) best = c;
  return best;
}

// Display name of a target.
export const targetName = (t, nameOf = k => k) => !t ? '' : t.what === 'floor' ? 'floor' : t.what === 'piece' ? nameOf(t.rec.t, 'piece') : nameOf(t.type, 'decor');

// Why target can't be removed, as display text, or null when it can. ctx:
//   tiles, decor (world.decor, tile cells), decorM (the same in raft-local metres, placement.js shape), grid (BuildGrid or null),
//   players [actor pose, other pose] ({x, z} raft-local metres, entries may be null),
//   bodyRadius, slack (extra reach metres, guest pose lag), stationAt(x, z) -> {input, output} | null,
//   chestFull(x, z) -> bool, hasGrill(x, z) -> bool, nameOf(type) -> display name,
//   memo (optional {}): caches the support checks (O(pieces + tiles)) until the target or the world changes,
//   so the prompt can ask every frame; poses, reach and contents are always checked fresh.
export function removeWhy(t, ctx) {
  if (!t) return 'Nothing to remove';
  const {grid = null, players = [], slack = 0, memo = null} = ctx, me = players[0];
  const far = (x, z, reach) => !!me && Number.isFinite(me.x) && Number.isFinite(me.z) && Math.hypot(x * 2 - me.x, z * 2 - me.z) > reach + slack;
  const structural = () => {
    if (t.what === 'piece') return grid ? grid.canRemove(t.rec) || null : 'Nothing to remove';
    const why = floorRemoveBlock(ctx.tiles || [], ctx.decorM || [], t.x, t.z);
    if (why) return BLOCK_TEXT[why] ?? 'Can’t remove that';
    return grid?.canRemoveTile(t.x, t.z) ? 'Something rests on this' : null; // walls / pillars / stairs it holds up (BUILD-3)
  };
  const cached = () => {
    if (!memo) return structural();
    const tiles = ctx.tiles, decor = ctx.decor, ver = grid ? grid.version : -1;
    if (memo.what === t.what && memo.x === t.x && memo.z === t.z && memo.rec === t.rec && memo.ver === ver
      && memo.tiles === tiles && memo.tn === tiles?.length && memo.decor === decor && memo.dn === decor?.length) return memo.why;
    Object.assign(memo, {what:t.what, x:t.x, z:t.z, rec:t.rec, ver, tiles, tn:tiles?.length, decor, dn:decor?.length, why:structural()});
    return memo.why;
  };
  if (t.what === 'piece') return cached();
  if (t.what === 'decor') {
    if (!ctx.decor?.some(d => d && d.x === t.x && d.z === t.z)) return 'Nothing to remove';
    if (far(t.x, t.z, DECOR_REACH)) return BLOCK_TEXT.reach;
    if (t.type === 'crate' && ctx.chestFull?.(t.x, t.z)) return 'Empty the chest first'; // content storage: never destroy stored items
    const st = ctx.stationAt?.(t.x, t.z);
    if (st && (st.input || st.output)) return `Empty the ${ctx.nameOf?.(t.type) ?? t.type} first`; // smelter / grill contents would be lost
    return null;
  }
  if (t.what === 'floor') {
    const why = cached(); if (why) return why;
    if (ctx.hasGrill?.(t.x, t.z)) return BLOCK_TEXT.decor; // a cooking-lane grill stands on it
    const inWay = playerInWay([{x:t.x * 2, z:t.z * 2, hx:1, hz:1, rot:0}], players, ctx.bodyRadius ?? .25);
    if (inWay >= 0) return inWay === 0 ? BLOCK_TEXT.self : BLOCK_TEXT.brother; // never drop a player into the sea
    if (far(t.x, t.z, FLOOR_REACH)) return BLOCK_TEXT.reach;
    return null;
  }
  return 'Nothing to remove';
}

// The action that removes target (send only when removeWhy is null).
export function removeAction(t) {
  if (!t) return null;
  if (t.what === 'piece') { const p = t.rec; return {kind:'unpiece', t:p.t, i:p.i, j:p.j, l:p.l, r:p.r}; }
  return {kind:'remove', what:t.what, x:t.x, z:t.z};
}

export { removePrompt };
