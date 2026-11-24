// Little Raft - building pieces glue: hammer build wheel, instanced piece rendering, ghost, actions, collision hooks.
// game.js owns the world/bags/network; this module only turns them into pieces. See docs/cloud/building-pieces.md.
// Usage (game.js): const building = createBuilding(T, scene); building.sync(world) after world/tiles change;
//   building.update(raft, aim, origin, active, bag, yaw) every frame; building.preStep/postStep around physics.update.
// Removal: hammer + hold X, release on a piece / placed item / foundation tile; or the axe: hold click on a piece or
//   foundation (building.chopStart / chop / chopStop). The host runs build-remove.js (applyTile for foundations).
import { BuildGrid, PIECES, PIECE_ORDER, LEVEL_H, STATEFUL, cleanPieces, toRec } from './building-pieces.js?build=v3-survival-ae77fa84ac2b';
import { createPieceGeometry, createPieceMaterial } from './building-models.js?build=v3-survival-ae77fa84ac2b';
import { createBuildMenu } from './build-menu.js?build=v3-survival-ae77fa84ac2b';
import { Bag, ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { removePiece, removeFoundation, tileRemoveWhy } from './build-remove.js?build=v3-survival-ae77fa84ac2b';
import { createBuildHint } from './build-hint.js?build=v3-survival-ae77fa84ac2b';

export { cleanPieces };
const FLOOR_Y = .2, REACH = 7, GHOST_OK = '#9dffc0', GHOST_BAD = '#ff8a73', GHOST_REMOVE = '#ff3b2a';
const CHOP_S = 1.1; // axe: seconds of held click to take a piece apart (releasing or looking away resets)
const STORED = PIECE_ORDER.filter(id => PIECES[id].slot !== 'tile');
const VARIANTS = ['hatchOpen', 'gateOpen'], KINDS = STORED.concat(VARIANTS); // open stateful pieces: own instanced mesh
const meshKey = p => p.o ? p.t + 'Open' : p.t;
const REACH_E = 2.5; // E toggles a hatch / gate within this reach

export function createBuilding(T, scene) {
  const grid = new BuildGrid(), group = new T.Group(), material = createPieceMaterial(T);
  const geos = {}, meshes = {};
  group.name = 'buildingPieces'; scene.add(group);
  for (const id of STORED) geos[id] = createPieceGeometry(T, id);
  for (const k of VARIANTS) geos[k] = createPieceGeometry(T, k.slice(0, -4), true);

  const ghostMat = new T.MeshBasicMaterial({color:GHOST_OK, transparent:true, opacity:.45, depthWrite:false});
  const ghost = new T.Mesh(geos.wall, ghostMat); ghost.visible = false; ghost.renderOrder = 2; group.add(ghost);
  const tileGeo = new T.BoxGeometry(2, .16, 2), tileGhost = new T.Mesh(tileGeo, ghostMat); // foundation removal highlight
  tileGhost.visible = false; tileGhost.renderOrder = 2; group.add(tileGhost);
  const dummy = new T.Object3D(), aimOut = {}, origin = new T.Vector3();
  let rot = 0, version = -1, removing = false, removeTarget = null, chipText = '';
  let remRec = null, remVer = -1, remText = '';
  let tileHit = false; const tileOut = {x:0, z:0}; // the foundation tile under the removal ray (when no piece / decor is nearer)
  let remTx = NaN, remTz = NaN, remTv = -1, remTd = null, remTn = -1, remTileText = ''; // cached tile reason per target / world change
  let lastWorld = null; // the world of the last sync(): tiles / decor / nets for the foundation removal reason
  let chopHeld = false, chopT = 0, chopRec = null, chopTx = NaN, chopTz = NaN, chopWhy = '', axeOn = false, hammerOn = false; // axe dismantle
  const hint = createBuildHint();
  let removeExtraFn = null, removeExtra = null; // [undecor] game.js decor target when no piece is aimed: {text, action, d, deny?}
  let placeCheckFn = null; // free placement: game.js veto for an otherwise valid slot (a placed item in the way) -> reason text or ''
  let curBag = null; // the local bag of the last update(); afford() is one function, not a per-frame closure
  const afford = cost => { if (!curBag) return true; for (const k in cost) if (curBag.count(k) < cost[k]) return false; return true; };
  const okColor = new T.Color(GHOST_OK), badColor = new T.Color(GHOST_BAD), removeColor = new T.Color(GHOST_REMOVE);
  const WHITE = new T.Color(1, 1, 1), tmp = new T.Color(), tintCount = {};
  let tintOf = null; // content hook (paint): p -> T.Color instance tint or null (white = untinted)

  const menu = createBuildMenu({pieces:PIECE_ORDER.map(id => ({id, name:PIECES[id].name, cost:PIECES[id].cost})), onPick:() => { rot = 0; },
    countOf:k => (curBag ? curBag.count(k) : 0), nameOf:k => ITEM_INFO[k]?.name});
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
    for (const p of grid.list) { const k = meshKey(p); counts[k] = (counts[k] || 0) + 1; }
    for (const id of KINDS) {
      const n = counts[id] || 0; let m = meshes[id];
      if (m && m.instanceMatrix.count < n) { group.remove(m); m.dispose(); m = null; }
      if (!m && n) {
        m = new T.InstancedMesh(geos[id], material, Math.max(16, 1 << Math.ceil(Math.log2(n))));
        m.castShadow = true; m.receiveShadow = true; m.name = 'piece-' + id; group.add(m);
      }
      meshes[id] = m; if (m) m.count = 0;
    }
    for (const p of grid.list) { const m = meshes[meshKey(p)]; place(dummy, p); dummy.updateMatrix(); m.setColorAt(m.count, tintOf?.(p) || WHITE); m.setMatrixAt(m.count++, dummy.matrix); }
    for (const id of KINDS) { const m = meshes[id]; if (m) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); } }
    version = grid.version;
  }

  // Engine world -> grid. Cheap when nothing changed (tiles count + pieces identity).
  // Tiles: identity too (a guest's new host world / restored own raft can have the same tile count but other cells).
  let lastTiles = -1, lastTilesRef = null, lastPieces = null;
  function sync(world) {
    lastWorld = world;
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
    if (active) menu.refresh(); // cost lines follow the bag (only repaints when a count changed)
    if (!active) { removing = false; if (menu.isOpen) menu.close(false); } // hammer put away / UI opened: no stuck wheel or X mode
    ghost.visible = false; tileGhost.visible = false; removeTarget = null; removeExtra = null; tileHit = false; // [undecor]
    let text = '';
    if (active && aim?.dir && !menu.isOpen) {
      origin.copy(camPos);
      const d = aim.dir;
      if (removing) {
        const hit = resolve(origin, d, deckY, true);
        if (hit === 'piece') { showGhost(removeTarget, removeColor); text = pieceWhy(removeTarget) || 'Release X to remove ' + PIECES[removeTarget.t].name.toLowerCase(); }
        else if (hit === 'decor') text = removeExtra.text; // [undecor]
        else if (hit === 'tile') { showTileGhost(tileOut.x, tileOut.z, removeColor); text = tileWhy(tileOut.x, tileOut.z) || 'Release X to remove foundation'; }
        else text = 'Point at a piece or foundation to remove';
      } else if (freePiece()) {
        const r = grid.aim(origin.x, origin.y, origin.z, d.x, d.y, d.z, piece(), (yawDir(yaw) + rot) % 4, deckY, REACH, aimOut);
        if (r && r.ok && placeCheckFn) { const why = placeCheckFn(r); if (why) { r.ok = false; r.reason = why; } } // red ghost, and use() refuses it
        if (r) { showGhost(r, r.ok && afford(PIECES[r.t].cost) ? okColor : badColor); text = r.ok ? (afford(PIECES[r.t].cost) ? '' : 'Not enough materials') : r.reason; }
      }
    }
    if (text !== chipText) { chipText = text; menu.setChip(text); }
    hammerOn = active; renderHint(removing && text && !text.startsWith('Release') && !text.startsWith('Point') ? text : '');
  }
  function renderHint(why) {
    hint.set(hammerOn ? (removing ? 'removing' : 'hammer') : axeOn ? (chopHeld ? 'chopping' : 'axe') : '', hammerOn ? why : chopWhy);
  }

  // ---------- removal targets (hammer X and axe) ----------
  // What a removal ray from o along unit d hits first: 'piece' (removeTarget), 'decor' (removeExtra, hammer only:
  // game.js items), 'tile' (tileOut: a foundation) or null. Runs only while X is held or the axe is chopping.
  function resolve(o, d, deckY, withDecor) {
    removeTarget = null; removeExtra = null; tileHit = false;
    let tDeck = Infinity;
    if (d.y < -1e-6) {
      const t = (deckY - o.y) / d.y;
      if (t >= 0 && t <= REACH) { const tx = Math.round((o.x + d.x * t) / 2), tz = Math.round((o.z + d.z * t) / 2); if (grid._tile(tx, tz)) { tDeck = t; tileOut.x = tx; tileOut.z = tz; } }
    }
    const rec = grid.pick(o.x, o.y, o.z, d.x, d.y, d.z, deckY, REACH);
    if (rec && (tDeck === Infinity || grid.hitDist(o.x, o.y, o.z, d.x, d.y, d.z, deckY, REACH) <= tDeck + .05)) { removeTarget = rec; return 'piece'; }
    if (withDecor && removeExtraFn) { removeExtra = removeExtraFn(o, d); if (removeExtra) return 'decor'; } // [undecor]
    if (tDeck < Infinity) { tileHit = true; return 'tile'; }
    return null;
  }
  // canRemove re-validates every piece: once per target / grid change, not per frame.
  function pieceWhy(rec) {
    if (rec !== remRec || grid.version !== remVer) { remRec = rec; remVer = grid.version; remText = grid.canRemove(rec); }
    return remText;
  }
  function tileWhy(x, z) {
    const w = lastWorld, dn = Array.isArray(w?.decor) ? w.decor.length : 0;
    if (x !== remTx || z !== remTz || grid.version !== remTv || w?.decor !== remTd || dn !== remTn) {
      remTx = x; remTz = z; remTv = grid.version; remTd = w?.decor; remTn = dn; remTileText = tileRemoveWhy(grid, w, x, z);
    }
    return remTileText;
  }
  function showTileGhost(x, z, color) {
    tileGhost.position.set(x * 2, FLOOR_Y - .08, z * 2); tileGhost.scale.setScalar(1.02); ghostMat.color.copy(color); tileGhost.visible = true;
  }

  // ---------- axe: hold click on a piece or foundation to take it apart ----------
  // Use-down with the axe. True when a piece or foundation is under the crosshair (the click is ours, not a palm chop).
  function chopStart(aim, camPos, deckY) {
    const d = aim?.dir; if (!d || !camPos || menu.isOpen) return false;
    const hit = resolve(camPos, d, deckY, false), rec = removeTarget, tile = tileHit; removeTarget = null; tileHit = false;
    if (!hit) return false;
    chopHeld = true; chopT = 0; chopRec = hit === 'piece' ? rec : null;
    chopTx = tile ? tileOut.x : NaN; chopTz = tile ? tileOut.z : NaN; chopWhy = '';
    return true;
  }
  function chopStop() { if (!chopHeld && chopT === 0) return; chopHeld = false; chopT = 0; chopWhy = ''; hint.ring(-1); renderHint(''); }
  // Every frame (after update). axeHeld: the axe is in hand and play is not blocked. Returns an action when done.
  function chop(axeHeld, aim, camPos, deckY, dt) {
    if (axeHeld !== axeOn) { axeOn = axeHeld; renderHint(''); }
    if (!chopHeld) return null; // the common case: nothing to do, no ray
    const d = aim?.dir;
    if (!axeHeld || !d || !camPos) { chopStop(); return null; }
    const hit = resolve(camPos, d, deckY, false), rec = removeTarget, tile = tileHit; removeTarget = null; tileHit = false;
    const same = hit === 'piece' ? rec === chopRec : hit === 'tile' && tileOut.x === chopTx && tileOut.z === chopTz;
    if (!same) { chopT = 0; chopRec = hit === 'piece' ? rec : null; chopTx = tile ? tileOut.x : NaN; chopTz = tile ? tileOut.z : NaN; } // looking away restarts
    if (!hit) { chopWhy = ''; hint.ring(-1); renderHint(''); return null; }
    if (hit === 'piece') showGhost(rec, removeColor); else showTileGhost(tileOut.x, tileOut.z, removeColor);
    chopWhy = hit === 'piece' ? pieceWhy(rec) : tileWhy(tileOut.x, tileOut.z);
    if (chopWhy) { chopT = 0; hint.ring(-1); renderHint(chopWhy); return null; } // blocked: say why, no fill
    chopT += Math.min(Math.max(dt, 0), .25); // real frame time: a slow frame rate must not make the hold longer
    hint.ring(chopT / CHOP_S); renderHint('');
    if (chopT < CHOP_S) return null;
    const a = hit === 'piece' ? {kind:'unpiece', t:rec.t, i:rec.i, j:rec.j, l:rec.l, r:rec.r, tool:'axe'} : {kind:'untile', x:tileOut.x, z:tileOut.z, tool:'axe'};
    chopHeld = false; chopT = 0; hint.ring(-1); renderHint(''); // one piece per hold, like a hammer release
    return a;
  }
  // Paint (content hook): instance colours only; the shared material colour is never touched.
  function retint() {
    if (grid.version !== version) { rebuild(); return; }
    for (const id of KINDS) tintCount[id] = 0;
    for (const p of grid.list) { const k = meshKey(p), m = meshes[k]; if (m) m.setColorAt(tintCount[k]++, tintOf?.(p) || WHITE); }
    for (const id of KINDS) { const m = meshes[id]; if (m?.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  function setTint(fn) { tintOf = typeof fn === 'function' ? fn : null; retint(); }
  function preview(p, hex) { showGhost(p, tmp.set(hex)); }
  function showGhost(p, color) {
    ghost.geometry = geos[meshKey(p)] || geos[p.t]; place(ghost, p); ghost.scale.setScalar(1.015); ghostMat.color.copy(color); ghost.visible = true;
  }

  // Click with the hammer: returns an engine action or null (foundation stays with the engine's own flow).
  function use() {
    if (!freePiece() || !ghost.visible || !aimOut.ok) return null;
    return {kind:'piece', t:aimOut.t, i:aimOut.i, j:aimOut.j, l:aimOut.l, r:aimOut.r};
  }
  function removeAction() {
    const p = removeTarget, ex = removeExtra, tile = tileHit; removing = false; removeExtra = null; tileHit = false; renderHint(''); // [undecor]
    if (p) return {kind:'unpiece', t:p.t, i:p.i, j:p.j, l:p.l, r:p.r};
    if (ex) { if (!ex.action) ex.deny?.(); return ex.action ?? null; } // [undecor] e.g. an old host: say why on release, send nothing
    return tile ? {kind:'untile', x:tileOut.x, z:tileOut.z} : null;
  }

  // Host-authoritative: validate, charge or refund the actor's bag, mutate world.pieces. Returns {ok, text}.
  function apply(a, bag, world) {
    sync(world);
    const p = {t:a.t, i:a.i, j:a.j, l:a.l, r:a.r}, def = typeof p.t === 'string' && Object.hasOwn(PIECES, p.t) ? PIECES[p.t] : null;
    if (!def || def.slot === 'tile' || ![p.i, p.j, p.l, p.r].every(Number.isInteger)) return {ok:false, text:''};
    if (a.kind !== 'piece') { // unpiece: hammer or axe, full refund (build-remove.js)
      const r = removePiece(grid, a, bag, Bag); if (!r.ok) return r;
      world.pieces = lastPieces = grid.list.map(toRec); rebuild();
      return r;
    }
    if (bag.count('hammer') < 1) return {ok:false, text:'Craft a hammer first'};
    const scratch = new Bag(bag.snapshot());
    const why = grid.canPlace(p); if (why) return {ok:false, text:why};
    for (const k in def.cost) if (!scratch.remove(k, def.cost[k])) return {ok:false, text:def.name + ' needs ' + costText(def.cost)};
    grid.place(p);
    for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
    world.pieces = lastPieces = grid.list.map(toRec);
    rebuild();
    return {ok:true, text:def.name + ' built'};
  }
  // Host-authoritative foundation removal ({kind:'untile', x, z, tool?}). The caller rebuilds the raft on ok.
  function applyTile(a, bag, world) {
    sync(world);
    const r = removeFoundation(grid, a, bag, world, Bag);
    if (r.ok) sync(world); // tiles changed (pieces never depend on a removable tile)
    return r;
  }

  // ---------- E toggle (hatch / gate) ----------
  // The nearest piece under the aim within REACH_E, if it is a stateful one (no toggling through a wall).
  function target(camPos, aim, deckY) {
    const d = aim?.dir; if (!d || !camPos || menu.isOpen || removing) return null;
    const rec = grid.pick(camPos.x, camPos.y, camPos.z, d.x, d.y, d.z, deckY, REACH_E);
    return rec && STATEFUL[rec.t] ? rec : null;
  }
  const PROMPTS = {hatch:['<kbd>E</kbd>Open hatch', '<kbd>E</kbd>Close hatch'], gate:['<kbd>E</kbd>Open gate', '<kbd>E</kbd>Close gate']};
  const promptOf = r => (r && STATEFUL[r.t] ? PROMPTS[r.t][r.o ? 1 : 0] : null); // static markup, no user text
  function prompt(camPos, aim, deckY) { return promptOf(target(camPos, aim, deckY)); }
  function interact(camPos, aim, deckY) { const r = target(camPos, aim, deckY); return r ? {kind:'piecetoggle', t:r.t, i:r.i, j:r.j, l:r.l, r:r.r, o:r.o === 1 ? 1 : 0} : null; } // o: the state the actor saw
  // Host-authoritative toggle. pose = the actor's body, bodies = everyone who could be in the way.
  const TOGGLE_GAP = 150; let lastToggle = -Infinity; // ms between accepted toggles (any piece, either player)
  function toggle(a, world, pose, bodies, deckY) {
    sync(world);
    if (!a || typeof a.t !== 'string' || !STATEFUL[a.t] || ![a.i, a.j, a.l, a.r].every(Number.isInteger)) return {ok:false, text:''};
    const rec = grid.find(a);
    if (!rec || rec.t !== a.t) return {ok:false, text:''};
    if ((a.o === 0 || a.o === 1) && (rec.o === 1 ? 1 : 0) !== a.o) return {ok:false, text:''}; // stale (a double press in flight): no flip back
    const now = performance.now(); if (now - lastToggle < TOGGLE_GAP) return {ok:false, text:''}; // a spammed piecetoggle: no rebuild + pieces resend per message
    const s = PIECES[rec.t].slot, cy = deckY + rec.l * LEVEL_H;
    const cx = s === 'edge' ? (rec.r ? rec.i * 2 - 1 : rec.i * 2) : rec.i * 2, cz = s === 'edge' ? (rec.r ? rec.j * 2 : rec.j * 2 - 1) : rec.j * 2;
    const far = REACH_E + 1.5;
    if (!pose || !(Math.hypot(pose.x - cx, pose.z - cz) <= far) || !(Math.abs(pose.y - cy) <= far)) return {ok:false, text:''};
    if (rec.o === 1) for (const b of bodies || []) if (b && grid.occupied(rec, b.x, b.y, b.z, deckY)) return {ok:false, text:'Someone is in the way'};
    grid.toggle(rec); lastToggle = now;
    world.pieces = lastPieces = grid.list.map(toRec);
    rebuild();
    return {ok:true, text:(rec.t === 'hatch' ? 'Hatch ' : 'Gate ') + (rec.o ? 'opened' : 'closed')};
  }
  const costText = c => Object.entries(c).map(([k, n]) => n + ' ' + k).join(' + ');

  // Input from game.js. Returns true when the event was consumed.
  function key(code, down, hammer, repeat = false) {
    if (!hammer) { removing = false; return false; }
    if (code === 'KeyR' && down && PIECES[piece()]?.slot === 'cell') { if (!repeat) rot = (rot + 1) % 4; return true; } // only floor/stairs/roof rotate; else R stays sail grab / hook repair
    if (code === 'Escape' && down && menu.isOpen) { menu.close(false); return true; }
    if (code === 'KeyQ' && down) { if (!repeat) menu.isOpen ? menu.close(true) : menu.open(); return true; } // auto-repeat must not re-toggle (each close commits)
    if (code === 'KeyX') { if (down) removing = true; return true; }
    return false;
  }

  const blur = new AbortController(); // a lost keyup (alt-tab while holding X) must not leave remove mode stuck on
  addEventListener('blur', () => { removing = false; removeExtra = null; chopStop(); }, {signal:blur.signal}); // [undecor] removeExtra
  addEventListener('pointerup', e => { if (e.button === 0) chopStop(); }, {signal:blur.signal}); // axe: releasing the click resets the fill

  function dispose() {
    blur.abort(); menu.dispose(); hint.dispose(); scene.remove(group); tileGeo.dispose();
    for (const id of KINDS) { meshes[id]?.dispose(); geos[id].dispose(); }
    ghostMat.dispose(); material.map?.dispose(); material.dispose();
  }

  return {grid, menu, group, sync, update, use, removeAction, apply, applyTile, chopStart, chop, chopStop, key, dispose, setTint, retint, preview, // setTint/retint/preview: content hook (paint)
    target, prompt, promptOf, interact, toggle, climb:(...a) => grid.climb(...a),
    setRemoveExtra(fn) { removeExtraFn = typeof fn === 'function' ? fn : null; }, get removeExtra() { return removeExtra; }, // [undecor]
    setPlaceCheck(fn) { placeCheckFn = typeof fn === 'function' ? fn : null; }, // free placement
    get removing() { return removing; }, get chopping() { return chopHeld; }, get chopProgress() { return chopT / CHOP_S; }, get piece() { return piece(); }, get rotation() { return rot; },
    preStep:(phys, deckY, c) => grid.preStep(phys, deckY, c), postStep:(phys, deckY) => grid.postStep(phys, deckY)};
}
