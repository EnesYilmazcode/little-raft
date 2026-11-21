// Little Raft - building pieces glue: hammer build wheel, instanced piece rendering, ghost, actions, collision hooks.
// game.js owns the world/bags/network; this module only turns them into pieces. See docs/cloud/building-pieces.md.
// Usage (game.js): const building = createBuilding(T, scene); building.sync(world) after world/tiles change;
//   building.update(raft, aim, origin, active, bag, yaw) every frame; building.preStep/postStep around physics.update.
import { BuildGrid, PIECES, PIECE_ORDER, LEVEL_H, cleanPieces } from './building-pieces.js?build=v3-survival-ae77fa84ac2b';
import { createPieceGeometry, createPieceMaterial } from './building-models.js?build=v3-survival-ae77fa84ac2b';
import { createBuildMenu } from './build-menu.js?build=v3-survival-ae77fa84ac2b';
import { Bag } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';

export { cleanPieces };
const FLOOR_Y = .2, REACH = 7, GHOST_OK = '#9dffc0', GHOST_BAD = '#ff8a73';
const STORED = PIECE_ORDER.filter(id => PIECES[id].slot !== 'tile');

export function createBuilding(T, scene) {
  const grid = new BuildGrid(), group = new T.Group(), material = createPieceMaterial(T);
  // Instanced casters get their own depth material so three's shared one does not flip `instancing` per shadow pass.
  const depthMat = new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});
  const geos = {}, meshes = {};
  group.name = 'buildingPieces'; scene.add(group);
  for (const id of STORED) geos[id] = createPieceGeometry(T, id);

  const ghostMat = new T.MeshBasicMaterial({color:GHOST_OK, transparent:true, opacity:.45, depthWrite:false});
  const ghost = new T.Mesh(geos.wall, ghostMat); ghost.visible = false; ghost.renderOrder = 2; group.add(ghost);
  const dummy = new T.Object3D(), aimOut = {}, origin = new T.Vector3();
  let rot = 0, version = -1, removing = false, removeTarget = null, chipText = '';
  let remRec = null, remVer = -1, remText = '';
  let curBag = null; // the local bag of the last update(); afford() is one function, not a per-frame closure
  const afford = cost => { if (!curBag) return true; for (const k in cost) if (curBag.count(k) < cost[k]) return false; return true; };
  const okColor = new T.Color(GHOST_OK), badColor = new T.Color(GHOST_BAD);
  const WHITE = new T.Color(1, 1, 1), tmp = new T.Color(), tintCount = {};
  let tintOf = null; // content hook (paint): p -> T.Color instance tint or null (white = untinted)

  const menu = createBuildMenu({pieces:PIECE_ORDER.map(id => ({id, name:PIECES[id].name, cost:PIECES[id].cost})), onPick:() => { rot = 0; }});
  menu.setAfford(afford);

  // Instance placement in raft-local space (the group follows the raft transform every frame).
  function place(o, p) {
    const s = PIECES[p.t].slot, y = FLOOR_Y + p.l * LEVEL_H;
    if (s === 'edge') o.position.set(p.r ? p.i * 2 - 1 : p.i * 2, y, p.r ? p.j * 2 : p.j * 2 - 1);
    else if (s === 'corner') o.position.set(p.i * 2 - 1, y, p.j * 2 - 1);
    else o.position.set(p.i * 2, y, p.j * 2);
    o.rotation.set(0, s === 'edge' ? (p.r ? Math.PI / 2 : 0) : s === 'corner' ? 0 : p.r * Math.PI / 2, 0);
  }
  function rebuild() {
    const counts = {};
    for (const p of grid.list) counts[p.t] = (counts[p.t] || 0) + 1;
    for (const id of STORED) {
      const n = counts[id] || 0; let m = meshes[id];
      if (m && m.instanceMatrix.count < n) { group.remove(m); m.dispose(); m = null; }
      if (!m && n) {
        m = new T.InstancedMesh(geos[id], material, Math.max(16, 1 << Math.ceil(Math.log2(n))));
        m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = depthMat; m.name = 'piece-' + id; group.add(m);
      }
      meshes[id] = m; if (m) m.count = 0;
    }
    for (const p of grid.list) { const m = meshes[p.t]; place(dummy, p); dummy.updateMatrix(); m.setColorAt(m.count, tintOf?.(p) || WHITE); m.setMatrixAt(m.count++, dummy.matrix); }
    for (const id of STORED) { const m = meshes[id]; if (m) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); } }
    version = grid.version;
  }

  // Engine world -> grid. Cheap when nothing changed (tiles count + pieces identity).
  // Tiles: identity too (a guest's new host world / restored own raft can have the same tile count but other cells).
  let lastTiles = -1, lastTilesRef = null, lastPieces = null;
  function sync(world) {
    if (world.tiles !== lastTilesRef || world.tiles.length !== lastTiles) { grid.setTiles(world.tiles); lastTilesRef = world.tiles; lastTiles = world.tiles.length; }
    if (world.pieces !== lastPieces) { world.pieces = grid.load(Array.isArray(world.pieces) ? world.pieces : []); lastPieces = world.pieces; }
    if (grid.version !== version) rebuild();
  }

  const yawDir = yaw => { const fx = -Math.sin(yaw), fz = -Math.cos(yaw); return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 0 : 2); };
  const piece = () => menu.selected;
  const freePiece = () => piece() !== 'foundation';

  // Per frame. aim = engine aim ({dir}) or null; active = hammer held and nothing else going on.
  function update(raft, aim, camPos, active, bag, yaw, deckY) {
    group.position.copy(raft.position); group.quaternion.copy(raft.quaternion);
    curBag = bag;
    menu.setVisible(active);
    if (!active) { removing = false; if (menu.isOpen) menu.close(false); } // hammer put away / UI opened: no stuck wheel or X mode
    ghost.visible = false; removeTarget = null;
    let text = '';
    if (active && aim?.dir && !menu.isOpen) {
      origin.copy(camPos);
      const d = aim.dir;
      if (removing) {
        removeTarget = grid.pick(origin.x, origin.y, origin.z, d.x, d.y, d.z, deckY, REACH);
        if (removeTarget) {
          showGhost(removeTarget, badColor);
          if (removeTarget !== remRec || grid.version !== remVer) { // canRemove re-validates every piece: once per target/change, not per frame
            remRec = removeTarget; remVer = grid.version;
            remText = grid.canRemove(removeTarget) || 'Release X to remove ' + PIECES[removeTarget.t].name.toLowerCase();
          }
          text = remText;
        }
        else text = 'Point at a piece to remove';
      } else if (freePiece()) {
        const r = grid.aim(origin.x, origin.y, origin.z, d.x, d.y, d.z, piece(), (yawDir(yaw) + rot) % 4, deckY, REACH, aimOut);
        if (r) { showGhost(r, r.ok && afford(PIECES[r.t].cost) ? okColor : badColor); text = r.ok ? (afford(PIECES[r.t].cost) ? '' : 'Not enough materials') : r.reason; }
      }
    }
    if (text !== chipText) { chipText = text; menu.setChip(text); }
  }
  // Paint (content hook): instance colours only; the shared material colour is never touched.
  function retint() {
    if (grid.version !== version) { rebuild(); return; }
    for (const id of STORED) tintCount[id] = 0;
    for (const p of grid.list) { const m = meshes[p.t]; if (m) m.setColorAt(tintCount[p.t]++, tintOf?.(p) || WHITE); }
    for (const id of STORED) { const m = meshes[id]; if (m?.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  function setTint(fn) { tintOf = typeof fn === 'function' ? fn : null; retint(); }
  function preview(p, hex) { showGhost(p, tmp.set(hex)); }
  function showGhost(p, color) {
    ghost.geometry = geos[p.t]; place(ghost, p); ghost.scale.setScalar(1.015); ghostMat.color.copy(color); ghost.visible = true;
  }

  // Click with the hammer: returns an engine action or null (foundation stays with the engine's own flow).
  function use() {
    if (!freePiece() || !ghost.visible || !aimOut.ok) return null;
    return {kind:'piece', t:aimOut.t, i:aimOut.i, j:aimOut.j, l:aimOut.l, r:aimOut.r};
  }
  function removeAction() {
    const p = removeTarget; removing = false;
    return p ? {kind:'unpiece', t:p.t, i:p.i, j:p.j, l:p.l, r:p.r} : null;
  }

  // Host-authoritative: validate, charge or refund the actor's bag, mutate world.pieces. Returns {ok, text}.
  function apply(a, bag, world) {
    sync(world);
    const p = {t:a.t, i:a.i, j:a.j, l:a.l, r:a.r}, def = typeof p.t === 'string' && Object.hasOwn(PIECES, p.t) ? PIECES[p.t] : null;
    if (!def || def.slot === 'tile' || ![p.i, p.j, p.l, p.r].every(Number.isInteger)) return {ok:false, text:''};
    if (bag.count('hammer') < 1) return {ok:false, text:'Craft a hammer first'};
    const scratch = new Bag(bag.snapshot());
    if (a.kind === 'piece') {
      const why = grid.canPlace(p); if (why) return {ok:false, text:why};
      for (const k in def.cost) if (!scratch.remove(k, def.cost[k])) return {ok:false, text:def.name + ' needs ' + costText(def.cost)};
      grid.place(p);
    } else {
      const found = grid.find(p); if (!found || found.t !== p.t) return {ok:false, text:''}; // refund what is really there (halfwall slot != door refund)
      const why = grid.canRemove(found); if (why) return {ok:false, text:why};
      for (const k in def.cost) if (scratch.add(k, def.cost[k]) > 0) return {ok:false, text:'Your bag is full'};
      grid.remove(found);
    }
    for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
    world.pieces = lastPieces = grid.list.map(q => ({t:q.t, i:q.i, j:q.j, l:q.l, r:q.r}));
    rebuild();
    return {ok:true, text:a.kind === 'piece' ? def.name + ' built' : def.name + ' removed (materials back)'};
  }
  const costText = c => Object.entries(c).map(([k, n]) => n + ' ' + k).join(' + ');

  // Input from game.js. Returns true when the event was consumed.
  function key(code, down, hammer, repeat = false) {
    if (!hammer) { removing = false; return false; }
    if (code === 'KeyR' && down && freePiece()) { if (!repeat) rot = (rot + 1) % 4; return true; } // foundation: R stays hook repair
    if (code === 'Escape' && down && menu.isOpen) { menu.close(false); return true; }
    if (code === 'KeyQ' && down) { menu.isOpen ? menu.close(true) : menu.open(); return true; }
    if (code === 'KeyX') { if (down) removing = true; return true; }
    return false;
  }

  const blur = new AbortController(); // a lost keyup (alt-tab while holding X) must not leave remove mode stuck on
  addEventListener('blur', () => { removing = false; }, {signal:blur.signal});

  function dispose() {
    blur.abort(); menu.dispose(); scene.remove(group);
    for (const id of STORED) { meshes[id]?.dispose(); geos[id].dispose(); }
    ghostMat.dispose(); material.map?.dispose(); material.dispose(); depthMat.dispose();
  }

  return {grid, menu, group, sync, update, use, removeAction, apply, key, dispose, setTint, retint, preview, // setTint/retint/preview: content hook (paint)
    get removing() { return removing; }, get piece() { return piece(); }, get rotation() { return rot; },
    preStep:(phys, deckY) => grid.preStep(phys, deckY), postStep:(phys, deckY) => grid.postStep(phys, deckY)};
}
