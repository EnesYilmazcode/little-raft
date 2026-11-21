import * as T from './vendor/three.module.js';
import { createAvatar } from './avatar.js?build=v3-survival-ae77fa84ac2b';
import { createOcean } from './ocean.js?build=v3-survival-ae77fa84ac2b';
import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b';
import { createWoodMaterial } from './wood.js?build=v3-survival-ae77fa84ac2b';
import { HookCast, WATER_Y } from './hook-physics.js?build=v3-survival-ae77fa84ac2b';
import { createSettings } from './settings.js?build=v3-survival-ae77fa84ac2b';
import { createFloor } from './deck.js?build=v3-survival-ae77fa84ac2b';
import { createDebris } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { createHands } from './hands.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { Bag, ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { PlayerPhysics } from './player-physics.js?build=v3-survival-ae77fa84ac2b';
import { floorBlock, decorBlock, inReach, BUILD_REACH, GUEST_REACH_SLACK, BLOCK_TEXT } from './build-rules.js?build=v3-survival-ae77fa84ac2b';
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b';
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createSurvivalUI } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
import { lootFits, pickNetItem, createGuestHeld, cleanHeldTokens, decorBlockers, repairHookSlot } from './coop-rules.js?build=v3-survival-ae77fa84ac2b';
import { PROTOCOL, HEARTBEAT_MS, peerStale, wallTick, saveRevision, planSave } from './session-rules.js?build=v3-survival-ae77fa84ac2b';
export { PROTOCOL }; // live.js reads the running engine's protocol from here
import { createItemIcons } from './item-icons.js?build=v3-survival-ae77fa84ac2b';
import { releaseShouldFire, castInput, castPrompt } from './fishing-rules.js?build=v3-survival-ae77fa84ac2b';
import { createOceanAudio } from './audio.js?build=v3-survival-ae77fa84ac2b';
import { createNoticeQueue, loadSoundPref, saveSoundPref, dragLookScale, loadHints, saveHints, nextHint, NOTICE_MS } from './hud.js?build=v3-survival-ae77fa84ac2b';
import { lockFailureVerdict, shouldRequestLock, shouldRelockAfterClose } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';

// Module entry has no side effects beyond the imports above. Call mount(transfer) to run the game.
// mount() returns {capture, pause, resume, dispose}; capture() output can be passed to a new mount().
//
// Ownership: every player owns a Bag (personal inventory). The raft, decor, floating debris and
// fish counter are shared. The host is authoritative: it keeps hostBag (its own) and guestBag
// (the brother's, persisted in the save) and applies every action against the actor's bag.

// ---------- Immutable configuration ----------
const DECOR_TYPES = Object.freeze(['sail', 'palm', 'lantern', 'net', 'bench', 'crate']); // placeable bag items
const ITEM_TYPES = Object.freeze(['wood', 'leaf', 'scrap', 'barrel', 'plastic']);         // floating debris kinds
const ITEM_NAMES = Object.freeze({wood:'plank', leaf:'bundle of leaves', scrap:'piece of scrap', barrel:'barrel', plastic:'plastic jug'});
const SPAWN_TABLE = Object.freeze(['wood', 'wood', 'wood', 'plastic', 'plastic', 'plastic', 'leaf', 'leaf', 'leaf', 'scrap', 'barrel']);
const LOOT = Object.freeze({wood:{wood:2}, leaf:{leaf:1}, scrap:{scrap:1}, plastic:{plastic:1}, barrel:{wood:3, leaf:2, scrap:1, plastic:1}});
const STOCK_KEYS = Object.freeze(['wood', 'leaf', 'scrap', 'plastic']); // legacy world.stock (derived)
const FLOOR_COST = Object.freeze({wood:2, plastic:2});
const REPAIR_COST = Object.freeze({wood:2, scrap:1});
const BLOCK_RADIUS = Object.freeze({palm:.42, crate:.55, bench:.45, sail:.14, lantern:.12});
const SAVE = 'little-raft-v1';
const FLOOR_Y = .2, EYE_OFFSET = 1.6, HOTBAR = 8, PICKUP_REACH = 2.5;
const LOOK_SENSITIVITY = .0022, DRAG_SENSITIVITY = .005, PITCH_LIMIT = 1.35;
const FISH_REACH = 26, PENDING_MS = 2500, JOIN_TIMEOUT = 15000, ACK_TIMEOUT = 2000;
const CHARGE_MS = 900, MIN_CHARGE = .15, WEAR_PER_CATCH = 2, MAX_HEALTH = 100;
const ROPE_SEGMENTS = 16, ITEM_FLOAT = .05, CAMERA_ROLL = .2;
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TIMBER = new Set(['#bb8a53','#c69860','#ad7c4a','#5e4029','#9c7649', '#c8995f', '#d3a368', '#8c6745', '#d5a265', '#a97d4c', '#b4824b', '#906f48', '#725942', '#756a49', '#ad8153']);
const STYLE_ID = 'little-raft-engine-style';
const HUD_CSS = `
body.playing header,body.playing #hud .inventory,body.playing #hud .goal,body.playing #toast,
body.playing #hud .controls,body.playing #recipes,body.playing #aimHint,body.playing [data-quick-recipe]{display:none!important}
#contextPrompt{position:fixed;left:50%;bottom:132px;transform:translateX(-50%);padding:3px 10px;border-radius:8px;
  background:rgba(8,22,36,.55);color:#f6ecd6;font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;pointer-events:none;z-index:30;white-space:nowrap}
#contextPrompt[hidden]{display:none}
#contextPrompt kbd{display:inline-block;min-width:1.4em;margin-right:6px;padding:0 4px;border:1px solid rgba(246,236,214,.6);border-radius:4px;font:inherit;text-align:center}
#noticeStack{position:fixed;inset:auto auto 104px 16px;margin:0;padding:0;border:0;background:none;overflow:visible;width:auto;height:auto;
  max-width:max(200px,min(340px,calc(50vw - 175px)));display:flex;flex-direction:column;align-items:flex-start;gap:4px;pointer-events:none;z-index:31}
#noticeStack[hidden],#noticeStack[popover]:not(:popover-open){display:none}
#noticeStack div{padding:5px 11px;border-radius:6px;background:rgba(8,22,36,.82);color:#f6ecd6;box-shadow:0 0 0 1px rgba(201,164,107,.45);
  font:600 13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
#noticeStack div.hint{color:#ffd98f}
@media(max-width:760px){#contextPrompt{bottom:96px}#noticeStack{bottom:150px;left:12px}}
`;

export function mount(transfer = null) {
  const X = transfer && typeof transfer === 'object' ? transfer : null;
  const $ = s => document.querySelector(s);
  const canvas = $('#world');
  const clamp = T.MathUtils.clamp;
  const ac = new AbortController(), signal = ac.signal;
  const timers = new Set();
  let disposed = false, active = false, rafId = 0;

  // ---------- Small utilities ----------
  const newToken = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  const isInt = Number.isInteger;
  function later(fn, ms) { const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms); timers.add(id); return id; }
  function cancelTimer(id) { if (id) { clearTimeout(id); timers.delete(id); } return 0; }
  const guard = fn => (...a) => (disposed ? undefined : fn(...a));
  let seed = 20240917; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  // ---------- Bags ----------
  const snapBag = s => { if (!s || typeof s !== 'object') return null; try { return new Bag(s); } catch { return null; } };
  const validSnapshot = s => snapBag(s)?.snapshot() ?? null;
  const commit = (bag, scratch) => { for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i]; };
  const canAfford = (bag, cost) => Object.entries(cost).every(([k, n]) => bag.count(k) >= n);
  const itemName = k => (ITEM_INFO[k]?.name ?? k).toLowerCase();
  const missingText = (bag, cost) => Object.entries(cost).filter(([k, n]) => bag.count(k) < n).map(([k, n]) => `${n - bag.count(k)} more ${itemName(k)}`).join(' and ');
  function spend(bag, cost) { // atomic
    const s = new Bag(bag.snapshot());
    for (const [k, n] of Object.entries(cost)) if (!s.remove(k, n)) return false;
    commit(bag, s); return true;
  }
  function hookIndex(bag, prefer) {
    if (isInt(prefer) && bag.slots[prefer]?.kind === 'hook') return prefer;
    if (bag.slots[bag.selectedIndex]?.kind === 'hook') return bag.selectedIndex;
    return bag.slots.findIndex(s => s?.kind === 'hook');
  }
  const hookDurability = (bag, prefer) => { const i = hookIndex(bag, prefer); return i < 0 ? 0 : clamp(bag.slots[i].durability ?? MAX_HEALTH, 0, MAX_HEALTH); };
  const legacyStock = bag => { const c = bag.counts(); return Object.fromEntries(STOCK_KEYS.map(k => [k, c[k] ?? 0])); };

  // Builds host/guest bags for a cleaned world. New saves carry snapshots; older saves only carry shared stock.
  function bagsFromWorld(w) {
    let host = snapBag(w.hostInventory);
    const guest = snapBag(w.guestInventory) ?? new Bag();
    if (!host) {
      const s = w.stock && typeof w.stock === 'object' ? w.stock : {};
      const n = k => (isInt(s[k]) && s[k] > 0 ? s[k] : 0);
      const built = w.tiles.length > 9 || w.decor.length > 0;
      // Only the untouched legacy starter kit (5 wood, 3 leaves, 1 scrap, nothing ever collected or built) is reset.
      const untouched = n('wood') === 5 && n('leaf') === 3 && n('scrap') === 1 && !n('plastic') && !(w.collected > 0) && !built;
      if (untouched) host = new Bag();
      else {
        host = Bag.fromCounts({wood:n('wood'), leaf:n('leaf'), scrap:n('scrap'), plastic:n('plastic')}, {tools:built ? ['hook', 'hammer'] : ['hook']});
        const hs = host.slots.find(x => x?.kind === 'hook');
        if (hs && Number.isFinite(w.hookHealth)) hs.durability = clamp(Math.round(w.hookHealth), 0, MAX_HEALTH);
      }
    }
    return {host, guest};
  }

  // ---------- World ----------
  function newWorld() {
    const fresh = new Bag().snapshot();
    return {tiles:Array.from({length:9}, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]), decor:[], stock:{wood:0, leaf:0, scrap:0, plastic:0}, fish:0, collected:0, hookHealth:MAX_HEALTH, items:[], hostInventory:fresh, guestInventory:new Bag().snapshot()};
  }
  // Validates a saved world or a host snapshot. Returns a fresh clean object or null.
  function cleanWorld(v, withItems = false) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.tiles) || !v.tiles.length || v.tiles.length > 400) return null;
    const tiles = [], seen = new Set();
    for (const t of v.tiles) {
      if (!Array.isArray(t) || !isInt(t[0]) || !isInt(t[1]) || Math.abs(t[0]) > 25 || Math.abs(t[1]) > 25) return null;
      const k = t[0] + ',' + t[1]; if (!seen.has(k)) { seen.add(k); tiles.push([t[0], t[1]]); }
    }
    const s = v.stock && typeof v.stock === 'object' ? v.stock : {};
    const stock = {};
    for (const k of STOCK_KEYS) { const n = s[k]; stock[k] = isInt(n) && n >= 0 && n <= 1e6 ? n : 0; }
    const decor = [], used = new Set();
    for (const d of Array.isArray(v.decor) ? v.decor : []) {
      if (!d || !DECOR_TYPES.includes(d.type) || !isInt(d.x) || !isInt(d.z)) continue;
      const k = d.x + ',' + d.z; if (!seen.has(k) || used.has(k)) continue;
      used.add(k); decor.push({type:d.type, x:d.x, z:d.z});
    }
    const count = n => (isInt(n) && n >= 0 ? n : 0);
    const items = [];
    if (withItems && Array.isArray(v.items)) for (const it of v.items.slice(0, 80)) {
      if (it && isInt(it.id) && typeof it.token === 'string' && it.token.length < 80 && ITEM_TYPES.includes(it.type) && Number.isFinite(it.x) && Number.isFinite(it.z) && Math.abs(it.x) < 80 && Math.abs(it.z) < 80)
        items.push({id:it.id, token:it.token, type:it.type, x:it.x, z:it.z, phase:Number.isFinite(it.phase) ? it.phase : 0});
    }
    return {tiles, decor, stock, fish:count(v.fish), collected:count(v.collected), hookHealth:Number.isFinite(v.hookHealth) ? clamp(Math.round(v.hookHealth), 0, MAX_HEALTH) : MAX_HEALTH, items,
      hostInventory:validSnapshot(v.hostInventory), guestInventory:validSnapshot(v.guestInventory)};
  }
  function copyWorld(w) { // isolation from the previous engine's live object (rollback safety)
    return {...w, tiles:w.tiles.map(t => [t[0], t[1]]), decor:Array.isArray(w.decor) ? w.decor.map(d => ({...d})) : [], items:Array.isArray(w.items) ? w.items.map(i => ({...i})) : [], stock:{...(w.stock || {})},
      fish:isInt(w.fish) ? w.fish : 0, collected:isInt(w.collected) ? w.collected : 0};
  }
  const liveWorld = w => cleanWorld(w, true) ?? copyWorld(w);
  function validPose(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) >= 120 || Math.abs(p.z) >= 120) return null;
    const y = Number.isFinite(p.y) && p.y >= -10 && p.y <= 30 ? p.y : null;
    return {x:p.x, y, z:p.z, yaw:Number.isFinite(p.yaw) ? p.yaw : 0, swimming:!!p.swimming};
  }
  // Own-raft backup while visiting as a guest. v2 stored a bare world; v3 stores {world, host, guest, physics}.
  function normaliseBackup(b) {
    if (!b || typeof b !== 'object') return null;
    if (Array.isArray(b.tiles)) { const w = liveWorld(b), bags = bagsFromWorld(w); return {world:w, host:bags.host.snapshot(), guest:bags.guest.snapshot(), physics:null}; }
    if (!b.world || !Array.isArray(b.world.tiles)) return null;
    const w = liveWorld(b.world), bags = bagsFromWorld(w);
    return {world:w, host:validSnapshot(b.host) ?? bags.host.snapshot(), guest:validSnapshot(b.guest) ?? bags.guest.snapshot(), physics:b.physics && typeof b.physics === 'object' ? {...b.physics} : null};
  }

  // ---------- Engine state (restored from transfer when hot-swapping) ----------
  let peer = X?.peer ?? null, conn = X?.conn ?? null, role = ['solo', 'host', 'guest'].includes(X?.role) ? X.role : 'solo';
  let networkReady = !!X?.networkReady, room = typeof X?.room === 'string' ? X.room : '';
  let world, hostBag = null, guestBag = null, remoteBag = null, saveAvailable = X ? X.saveAvailable !== false : true;
  let ownWorldBackup = normaliseBackup(X?.ownWorldBackup), freshSave = false;
  if (X?.world && Array.isArray(X.world.tiles)) {
    world = liveWorld(X.world);
    if (X.version >= 3 && X.bags) { hostBag = snapBag(X.bags.host); guestBag = snapBag(X.bags.guest); remoteBag = snapBag(X.bags.remote); }
    if (!hostBag || !guestBag) { // v2 transfer: no bags yet
      if (role === 'guest' && ownWorldBackup) {
        hostBag = new Bag(ownWorldBackup.host); guestBag = new Bag(ownWorldBackup.guest);
        remoteBag ??= bagsFromWorld(world).host;
      } else { const b = bagsFromWorld(world); hostBag ??= b.host; guestBag ??= b.guest; }
    }
  } else {
    world = newWorld();
    let raw = null;
    try { raw = localStorage.getItem(SAVE); } catch { saveAvailable = false; }
    if (raw) { try { const v = cleanWorld(JSON.parse(raw)); if (v) world = v; } catch {} }
    freshSave = !raw;
    const b = bagsFromWorld(world); hostBag = b.host; guestBag = b.guest;
  }
  // Revision of the save this tab last loaded or wrote. Another tab writing a newer one stops our autosave.
  const storedRev = () => { try { return saveRevision(localStorage.getItem(SAVE)); } catch { return 0; } };
  let saveRev = isInt(X?.saveRev) ? X.saveRev : storedRev();
  let saveBlocked = !!X?.saveBlocked;
  let scene = null, camera = null, renderer = null, ocean = null, raft, itemsGroup, ghost, rope, ropeAttr, hookMesh, bobber, friend, player, sun;
  let hookHands = null, hammerHands = null, rodHands = null, rodModel = null, rodTip = null, clothMat;
  const itemIcons = createItemIcons(T);
  let survivalUI = null, settingsController = null, options = {sensitivity:1, fov:75, cameraMotion:.35, volume:.5, graphics:'medium'};
  let running = !!X?.running;
  let elapsed = Number.isFinite(X?.elapsed) ? X.elapsed : 0, last = performance.now();
  let yaw = Number.isFinite(X?.yaw) ? X.yaw : 0, pitch = Number.isFinite(X?.pitch) ? X.pitch : -.28;
  let walking = false, walkPhase = Number.isFinite(X?.walkPhase) ? X.walkPhase : 0, swing = 0;
  const pointer = new T.Vector2(), ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), -.22);
  let hover = null, mouse = {x:0, y:0, inside:false}, frameAim = null, pickTarget = null;
  const raftPose = {y:X?.raftPose?.y ?? 0, rx:X?.raftPose?.rx ?? 0, rz:X?.raftPose?.rz ?? 0};
  let physics = makePhysics(X);
  let other = X?.other ? validPose(X.other) : null;
  let keys = X?.keys && typeof X.keys === 'object' ? {...X.keys} : {};
  let hook = X?.hook && (X.hook.fishing || typeof X.hook.update === 'function') ? X.hook : null;
  let castId = typeof X?.castId === 'string' ? X.castId : newToken();
  let hookSlot = isInt(X?.hookSlot) ? X.hookSlot : -1;
  let fishWait = Number.isFinite(X?.fishWait) ? X.fishWait : 0;
  let sound = X ? X.sound !== false : loadSoundPref(window.localStorage), audio = X?.audio ?? null, oceanAudio = null, swimClock = 0;
  let charging = X?.charging && Number.isFinite(X.charging.start) ? {...X.charging} : null, reeling = !!X?.reeling && !!hook;
  let lastCaughtCount = isInt(X?.lastCaughtCount) ? X.lastCaughtCount : (hook?.caughtItems?.length ?? (hook?.caught ? 1 : 0));
  const pending = new Map(X?.pending instanceof Map ? X.pending : []); // item token -> expiry; hides supplies we reeled in while the host confirms
  const guestHeld = createGuestHeld(); // host only: tokens on the guest's hook, from its move messages
  const wornCasts = {host:X?.wornCasts?.host ?? null, guest:X?.wornCasts?.guest ?? null}; // one wear per successful throw
  let seq = isInt(X?.seq) ? X.seq : 0, lastSeqSent = Number.isFinite(X?.lastSeqSent) ? X.lastSeqSent : 0, guestAck = isInt(X?.guestAck) ? X.guestAck : 0;
  let lastHostMessage = X?.lastHostMessage || performance.now(), lastGuestMessage = X?.lastGuestMessage || performance.now();
  let joinTimer = 0, joinDeadline = Number.isFinite(X?.joinDeadline) ? X.joinDeadline : 0;
  let netClock = 0, lastSaveAt = performance.now(), lastNetSendAt = 0, toastTimer = 0, wheelAcc = 0, peerHidden = !!X?.peerHidden, heartbeat = 0;
  let notices = createNoticeQueue(), noticeCache = null, contextCache = null, uiFailed = false; let fishShown = null;
  const hintsDone = X?.hintsDone instanceof Set ? X.hintsDone : freshSave ? new Set() : loadHints(window.localStorage); // first-run hint chain, once per save
  const bindings = []; // [emitter, event, fn] registered by THIS mount on PeerJS objects
  const lockSupported = !!canvas && typeof canvas.requestPointerLock === 'function';
  let lockFallback = !lockSupported || !!X?.lockFallback, down = X?.down ? {...X.down} : null, uiSignature = '';
  const chargeMeter = $('#chargeMeter'), chargeFill = chargeMeter?.querySelector('i');
  let blockList = [];

  function makePhysics(src) {
    const deck = raftPose.y + FLOOR_Y + EYE_OFFSET;
    const p = src?.physics;
    if (p && [p.x, p.y, p.z].every(Number.isFinite)) return new PlayerPhysics(p);
    if (src?.me && Number.isFinite(src.me.x) && Number.isFinite(src.me.z)) return new PlayerPhysics({x:src.me.x, y:Number.isFinite(src.me.y) ? src.me.y : deck, z:src.me.z});
    const s = spawnPoint(0, 1.2); return new PlayerPhysics({x:s.x, y:deck, z:s.z});
  }
  function spawnPoint(x, z) {
    // Runs during state setup too, so it must not use the later-declared helpers.
    if (world.tiles.some(t => Math.abs(x - t[0] * 2) <= .95 && Math.abs(z - t[1] * 2) <= .95)) return {x, z};
    const t = world.tiles.find(t => t[0] === 0 && t[1] === 0) ?? world.tiles[0]; return {x:t[0] * 2, z:t[1] * 2};
  }

  const hasTile = (x, z) => world.tiles.some(t => t[0] === x && t[1] === z);
  const isLocked = () => !!canvas && document.pointerLockElement === canvas;
  const dialogOpen = () => !!document.querySelector('dialog[open]');
  const uiBlocked = () => dialogOpen() || !!survivalUI?.isOpen;
  const castOut = () => (hook && !hook.fishing ? hook : null);
  const guestWaiting = () => role === 'guest' && !networkReady;
  const chargeValue = () => (charging ? clamp((performance.now() - charging.start) / CHARGE_MS, MIN_CHARGE, 1) : 0);
  const localBag = () => (role === 'guest' && networkReady && remoteBag ? remoteBag : hostBag);
  const actorBag = actor => (actor === 'guest' ? guestBag : hostBag);
  const selectedKind = () => localBag().slots[localBag().selectedIndex]?.kind ?? null;
  const heldKind = () => (hook?.fishing ? 'fishingrod' : hook ? 'hook' : selectedKind());
  const caughtList = h => (Array.isArray(h?.caughtItems) ? h.caughtItems : h?.caught ? [h.caught] : []);
  const deckY = () => (raft ? raft.position.y : raftPose.y) + FLOOR_Y;

  // ---------- Small mesh helpers ----------
  const materialCache = new Map();
  function mat(color) {
    if (!materialCache.has(color)) {
      let m = null;
      if (TIMBER.has(color)) { try { m = createWoodMaterial(T, color); } catch (e) { console.warn('wood material failed', e); } }
      materialCache.set(color, m ?? new T.MeshStandardMaterial({color, roughness:.85, metalness:0}));
    }
    return materialCache.get(color);
  }
  function box(w, h, d, c, x = 0, y = 0, z = 0, parent) { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent?.add(m); return m; }
  function cylinder(rt, rb, h, c, x, y, z, parent, n = 8) { const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, n), mat(c)); m.position.set(x, y, z); m.castShadow = true; parent?.add(m); return m; }
  function sphere(r, c, x, y, z, parent) { const m = new T.Mesh(new T.IcosahedronGeometry(r, 1), mat(c)); m.position.set(x, y, z); parent?.add(m); return m; }
  function disposeGeometry(o) { const cached = new Set(materialCache.values()), materials = new Set(); o.traverse(c => { c.geometry?.dispose(); for (const m of [].concat(c.material || [])) if (!cached.has(m) && m !== clothMat) materials.add(m); }); for (const m of materials) { m.map?.dispose(); m.dispose(); } }

  // ---------- DOM adoption (stable nodes shared across hot swaps) ----------
  function prepareDom() {
    let style = document.getElementById(STYLE_ID);
    if (!style) { style = document.createElement('style'); style.id = STYLE_ID; document.head.appendChild(style); }
    if (style.textContent !== HUD_CSS) style.textContent = HUD_CSS;
    if (!document.getElementById('contextPrompt')) { const el = document.createElement('div'); el.id = 'contextPrompt'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.hidden = true; document.body.appendChild(el); }
    document.querySelectorAll('[data-quick-recipe]').forEach(b => b.remove()); // old pseudo-inventory buttons
    document.body.classList.remove('build');
    const recipes = $('#recipes'); if (recipes) { recipes.hidden = true; recipes.innerHTML = ''; }
    const controls = $('.controls'); if (controls) controls.innerHTML = '<span><kbd>W A S D</kbd> Walk</span><span><kbd>Space</kbd> Jump</span><span><kbd>1–8</kbd> Hotbar</span><span><kbd>E</kbd> Pick up / bag</span><span><kbd>Esc</kbd> Menu</span><span id="fishCount"></span>';
    const guide = $('#help .guide');
    if (guide) guide.innerHTML = '<li><kbd>Mouse</kbd><span><b>Look around.</b> Click the sea to capture your mouse.</span></li>'
      + '<li><kbd>W A S D</kbd><span><b>Walk</b>, hold <kbd>Shift</kbd> to run, <kbd>Space</kbd> to jump. Fell in? Swim to the raft and hold <kbd>Space</kbd> to climb aboard.</span></li>'
      + '<li><kbd>1–8</kbd><span><b>Hotbar.</b> Number keys or the mouse wheel choose a slot. Click uses what you are holding.</span></li>'
      + '<li><kbd>Hook</kbd><span><b>Throw.</b> Hold click to power up, aim higher to throw farther, release. Hold again to reel in everything it touches.</span></li>'
      + '<li><kbd>E</kbd><span><b>Pick up</b> a supply right beside you, or open your bag to craft. <kbd>Tab</kbd> / <kbd>I</kbd> open the bag too; <kbd>E</kbd>, <kbd>I</kbd> or <kbd>Esc</kbd> close it. Inside, <kbd>Tab</kbd> and the arrow keys move between slots.</span></li>'
      + '<li><kbd>Craft</kbd><span><b>Make tools.</b> A Hammer builds raft floors (2 wood, 2 plastic each). A Fishing Rod catches fish. Crafted decorations are placed one at a time.</span></li>'
      + '<li><kbd>R</kbd><span><b>Repair</b> a worn hook for 2 wood and 1 scrap.</span></li>'
      + '<li><kbd>Esc</kbd><span><b>Menu.</b> Settings, Play together and this guide.</span></li>';
    const note = $('#help .guide-note'); if (note) note.textContent = 'Everyone has their own bag; the raft and the sea are shared. Nothing can hurt you, and your raft never sinks. Mouse won\'t lock? Drag the ocean to look instead.';
  }

  // ---------- Scene ----------
  function init() {
    const assetBuild = new URL(import.meta.url).searchParams.get('build') || 'dev'; document.querySelectorAll('use[href*="icons.svg"]').forEach(el => el.setAttribute('href', 'icons.svg?build=' + assetBuild + '#' + el.getAttribute('href').split('#')[1]));
    prepareDom();
    scene = new T.Scene(); scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
    camera = new T.PerspectiveCamera(running ? 70 : 48, innerWidth / innerHeight, .05, 200); camera.rotation.order = 'YXZ'; scene.add(camera);
    renderer = X?.renderer && X.renderer.domElement === canvas ? X.renderer : new T.WebGLRenderer({canvas, antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7)); renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    scene.add(new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8));
    sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, {left:-25, right:25, top:25, bottom:-25}); sun.shadow.bias = -.001; scene.add(sun);
    ocean = createOcean(T, {sunDirection:sun.position.clone(), skyColor:'#cbd2c0', fadeNear:28, fadeFar:125}); ocean.uniforms.uDeep.value.set('#14505a'); ocean.uniforms.uShallow.value.set('#3f8c88'); ocean.uniforms.uZenith.value.set('#a9c1c0'); ocean.mesh.receiveShadow = true; scene.add(ocean.mesh); ocean.update(elapsed);
    raft = new T.Group(); raft.position.y = raftPose.y; raft.rotation.set(raftPose.rx, 0, raftPose.rz); scene.add(raft);
    itemsGroup = new T.Group(); scene.add(itemsGroup);
    player = makeAvatar('#efae55'); friend = makeAvatar('#70a7e4'); friend.visible = false; scene.add(player, friend); // world space, not raft-parented
    ghost = new T.Mesh(new T.BoxGeometry(1.9, .13, 1.9), new T.MeshBasicMaterial({color:'#b6ffd0', transparent:true, opacity:.55, depthWrite:false})); ghost.visible = false; scene.add(ghost);
    const ropeGeo = new T.BufferGeometry(); ropeAttr = new T.BufferAttribute(new Float32Array((ROPE_SEGMENTS + 1) * 3), 3); ropeAttr.setUsage(T.DynamicDrawUsage); ropeGeo.setAttribute('position', ropeAttr);
    rope = new T.Line(ropeGeo, new T.LineBasicMaterial({color:'#e9d39a'})); rope.visible = false; rope.frustumCulled = false; scene.add(rope);
    hookMesh = createHook(T); hookMesh.scale.setScalar(.5); hookMesh.visible = false; scene.add(hookMesh);
    bobber = createFishingTool(T).userData.float; bobber.removeFromParent(); bobber.position.set(0, 0, 0); bobber.scale.setScalar(3.5); bobber.visible = false; scene.add(bobber); // own materials, normal render order
    clothMat = new T.MeshStandardMaterial({color:'#fff3cf', side:T.DoubleSide, roughness:1});
    buildViewmodels();
    for (let i = 0; i < 12; i++) { const g = new T.Group(), a = i * 2.4, d = 65 + rand() * 25; g.position.set(Math.sin(a) * d, -.1, Math.cos(a) * d); cylinder(3, 5, .8, '#e6d7a3', 0, 0, 0, g); sphere(3.4, '#4f9b72', 0, 1.4, 0, g); palm(g, 0, 1, 0, 1.4); scene.add(g); }
    for (let i = 0; i < 24; i++) { const g = new T.Group(); for (let j = 0; j < 3; j++) sphere(1.3 + j * .35, '#e7f9eb', j * 1.4, Math.sin(j) * .5, 0, g); g.position.set((rand() - .5) * 170, 17 + rand() * 8, (rand() - .5) * 170); g.scale.y = .5; scene.add(g); }
    rebuildRaft();
    if (!world.items.length && role !== 'guest') for (let i = 0; i < 30; i++) world.items.push(makeItem(i));
    syncItems(); refreshPointerUI(true);
  }

  function fallbackAvatar(color) {
    const g = new T.Group();
    cylinder(.21, .25, .58, color, 0, .64, 0, g); sphere(.23, '#f2c69b', 0, 1.14, 0, g); cylinder(.28, .28, .07, '#f7e7b5', 0, 1.32, 0, g); cylinder(.17, .19, .16, '#f7e7b5', 0, 1.4, 0, g);
    box(.13, .22, .15, '#314d53', -.13, .25, 0, g); box(.13, .22, .15, '#314d53', .13, .25, 0, g);
    return g;
  }
  function makeAvatar(color) {
    try { const g = createAvatar(T, color); if (g?.isObject3D) { g.traverse(c => { if (c.isMesh) c.castShadow = true; }); return g; } }
    catch (e) { console.warn('createAvatar failed, using fallback avatar', e); }
    return fallbackAvatar(color);
  }

  // First-person viewmodels: one hands controller per held tool; only the held one is shown.
  // createHands grips its tool at a fixed hook-handle point, so other tools are wrapped so their own grip lands there.
  function holdable(model, grip, {rx = 0, ry = 0, rz = 0, scale = 1} = {}) {
    const w = new T.Group(), p = new T.Group();
    p.position.set(.19, -.272, .11); p.rotation.set(rx, ry, rz); p.scale.setScalar(scale / .55);
    if (grip) model.position.copy(grip).negate();
    p.add(model); w.add(p); return w;
  }
  function buildViewmodels() {
    hookHands = createHands(T, createHook(T));
    const hammer = createHammer(T);
    hammerHands = createHands(T, holdable(hammer, hammer.userData.grip, {ry:Math.PI / 2, rz:.2, scale:.6}));
    rodModel = createFishingTool(T); rodTip = rodModel.userData.tipNode ?? rodModel;
    rodHands = createHands(T, holdable(rodModel, rodModel.userData.grip, {rx:-.15, rz:.6, scale:.55}));
    // Viewmodels draw last (transparent queue, renderOrder 1000) after a camera-owned marker clears depth, so the
    // world never clips them while fingers and tools still depth-sort correctly against each other.
    const depthClear = new T.Mesh(new T.PlaneGeometry(1e-4, 1e-4), new T.MeshBasicMaterial({colorWrite:false, depthWrite:false, depthTest:false, transparent:true}));
    depthClear.name = 'viewmodelDepthClear'; depthClear.frustumCulled = false; depthClear.castShadow = false; depthClear.receiveShadow = false;
    depthClear.renderOrder = 999; depthClear.position.set(0, 0, -.1);
    depthClear.onBeforeRender = (r, _s, cam) => { if (cam !== camera) return; r.state?.buffers?.depth?.setMask?.(true); r.clearDepth(); };
    camera.add(depthClear);
    for (const h of [hookHands, hammerHands, rodHands]) {
      h.group.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; c.renderOrder = 1000; c.frustumCulled = false; for (const m of [].concat(c.material)) { m.depthTest = true; m.depthWrite = true; if (!m.transparent) { m.transparent = true; m.opacity = m.opacity ?? 1; } m.needsUpdate = true; } } });
      h.group.visible = false; camera.add(h.group);
    }
  }

  function palm(parent, x, y, z, s = 1) {
    const g = new T.Group(); g.position.set(x, y, z); g.scale.setScalar(s); cylinder(.09, .17, 1.6, '#ad8153', 0, .8, 0, g);
    for (let i = 0; i < 7; i++) { const l = new T.Mesh(new T.ConeGeometry(.28, 1.5, 4), mat(i % 2 ? '#519b55' : '#72ae59')); l.rotation.z = 1.2; l.rotation.y = i * Math.PI * 2 / 7; l.position.set(Math.sin(i * Math.PI * 2 / 7) * .5, 1.65, Math.cos(i * Math.PI * 2 / 7) * .5); g.add(l); }
    parent.add(g);
  }
  function rebuildRaft() {
    for (const c of [...raft.children]) { raft.remove(c); disposeGeometry(c); }
    world.tiles.forEach(([x, z]) => { const g = createFloor(T, x * 719 + z * 311, mat); g.position.set(x * 2, 0, z * 2); raft.add(g); });
    for (const d of world.decor) {
      let detailed = null; try { detailed = createCraft(T, d.type); } catch (e) { console.warn('craft model failed', e); }
      if (detailed) { detailed.position.set(d.x * 2, .22, d.z * 2); raft.add(detailed); continue; }
      const g = new T.Group(); g.position.set(d.x * 2, .22, d.z * 2);
      if (d.type === 'sail') { cylinder(.065, .08, 3.8, '#906f48', 0, 1.9, 0, g); box(2.5, .07, .07, '#906f48', 0, 3.2, 0, g); const s = new T.Mesh(new T.PlaneGeometry(2.35, 2.1), clothMat); s.position.set(0, 2.15, .06); g.add(s); }
      if (d.type === 'palm') { cylinder(.38, .28, .5, '#db8764', 0, .25, 0, g); palm(g, 0, .5, 0); }
      if (d.type === 'lantern') { cylinder(.055, .075, 1.8, '#725942', 0, .9, 0, g); box(.32, .42, .32, '#ffe197', .43, 1.5, 0, g); }
      if (d.type === 'net') { for (let k = 0; k < 6; k++) { box(.025, .05, 1.7, '#ebe1bd', -.8 + k * .32, .05, 0, g); box(1.7, .05, .025, '#ebe1bd', 0, .05, -.8 + k * .32, g); } }
      if (d.type === 'bench') { box(1.4, .08, .42, '#b4824b', 0, .45, 0, g); for (const a of [-.6, .6]) box(.08, .45, .38, '#906f48', a, .22, 0, g); }
      if (d.type === 'crate') { box(.8, .8, .8, '#a97d4c', 0, .4, 0, g); }
      raft.add(g);
    }
    blockList = world.decor.flatMap(d => decorBlockers(d, BLOCK_RADIUS));
  }

  // ---------- Floating supplies ----------
  function makeItem(id) { const edge = Math.min(...world.tiles.map(t => t[1])) * 2 - 1, spread = Math.max(11, Math.max(...world.tiles.map(t => Math.abs(t[0]))) * 2 + 6); return {id, token:newToken(), type:SPAWN_TABLE[Math.floor(Math.random() * SPAWN_TABLE.length)], x:(Math.random() - .5) * spread * 2, z:edge - 3 - Math.random() * 17, phase:Math.random() * 6}; }
  function itemModel(item) {
    if (item.type !== 'plastic') return createDebris(T, item.type, mat, {seed:item.id});
    const g = new T.Group(), jug = createPlastic(T); jug.rotation.set(Math.PI / 2, 0, .4 + (item.id % 5) * .5); jug.position.y = .05; jug.scale.setScalar(.85); g.add(jug); return g;
  }
  // Meshes are keyed by token, not id: a respawned item keeps its id but may change type.
  const itemMeshes = new Map();
  function syncItems() {
    if (!itemsGroup) return;
    const live = new Set(world.items.map(x => x.token));
    for (const [token, m] of itemMeshes) if (!live.has(token)) { itemsGroup.remove(m); disposeGeometry(m); itemMeshes.delete(token); }
    for (const token of pending.keys()) if (!live.has(token)) pending.delete(token);
    for (const item of world.items) {
      if (itemMeshes.has(item.token)) continue;
      const g = itemModel(item); g.userData.token = item.token;
      g.position.set(item.x, ITEM_FLOAT, item.z);
      itemsGroup.add(g); itemMeshes.set(item.token, g);
    }
  }
  const isPending = it => (pending.get(it.token) ?? 0) > performance.now();

  // ---------- Feedback (notices stack at the screen edge; prompts sit just above the hotbar) ----------
  const setText = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
  function setStatus(s) { setText('#networkStatus', s); }
  function notice(s, ms = NOTICE_MS) { notices.push(s, performance.now(), ms); }
  function toast(s) {
    if (running) { notice(s, 3000); return; }
    const el = $('#toast'); if (!el) return; el.textContent = s; el.classList.add('show');
    toastTimer = cancelTimer(toastTimer); toastTimer = later(() => { toastTimer = 0; el.classList.remove('show'); }, 2600);
  }
  const audioVolume = () => (sound ? clamp(options?.volume ?? .5, 0, 1) : 0);
  function sfx(ev, strength = 1) { if (!audioVolume()) return; try { oceanAudio?.play(ev, strength); } catch {} }
  function updateContext(dialog) {
    let html = '';
    if (running && !dialog) {
      if (guestWaiting()) html = 'Waiting for your brother’s raft…';
      else if (pickTarget) html = `<kbd>E</kbd>Pick up ${esc(ITEM_NAMES[pickTarget.type] ?? 'supply')}`;
      else if (hover?.blocked) html = esc(BLOCK_TEXT[hover.blocked]);
      else if (hover && heldKind() === 'hammer' && !canAfford(localBag(), FLOOR_COST)) html = 'Floor needs ' + esc(missingText(localBag(), FLOOR_COST));
      else if (hook?.fishing) html = esc(castPrompt(hook, fishWait));
      else if (castOut() && castOut().stage === 'floating') html = caughtList(castOut()).length ? 'Hold click to reel it in' : 'Hold click to reel';
    }
    if (html === contextCache) return; contextCache = html;
    const el = $('#contextPrompt'); if (!el) return; el.innerHTML = html; el.hidden = !html;
  }
  function hintDone(id) { if (hintsDone.has(id)) return; hintsDone.add(id); saveHints(window.localStorage, hintsDone); }
  // Notices and hints stack at the left edge above the hotbar, and stay visible over the open bag.
  function updateNotices(dialog) {
    const now = performance.now(), lines = running ? notices.lines(now) : [];
    if (survivalUI?.isOpen) hintDone('bag');
    const hint = running && !dialog && !guestWaiting() ? nextHint(hintsDone, {heldKind:heldKind(), castOut:!!hook, hasLoot:hintsDone.has('loot')}) : null;
    const sig = lines.join('\n') + '|' + (hint?.id ?? '') + '|' + dialog;
    if (sig === noticeCache) return; noticeCache = sig;
    let el = $('#noticeStack');
    if (!el) { el = document.createElement('div'); el.id = 'noticeStack'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    const show = lines.length > 0 || !!hint, pop = typeof el.showPopover === 'function';
    if (pop && !el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
    el.innerHTML = lines.map(t => `<div>${esc(t)}</div>`).join('') + (hint ? `<div class="hint">${esc(hint.text)}</div>` : '');
    if (!pop) { el.hidden = !show; return; }
    try { if (el.matches(':popover-open')) el.hidePopover(); if (show) el.showPopover(); } catch {} // re-show so it sits above a modal dialog
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  function updateCharge() {
    if (!chargeMeter) return;
    const show = !!charging && running;
    if (chargeMeter.hidden === show) chargeMeter.hidden = !show;
    if (show && chargeFill) chargeFill.style.width = (chargeValue() * 100).toFixed(1) + '%';
  }
  const inShell = /\bElectron\//.test(navigator.userAgent); let shellPanel = null;
  // Body classes, crosshair and resume hint follow running and pointer-lock state.
  function refreshPointerUI(force = false) {
    const locked = isLocked(), dialog = uiBlocked();
    const signature = [running, locked, dialog, lockFallback].join();
    if (!force && signature === uiSignature) return; uiSignature = signature;
    const b = document.body.classList;
    b.toggle('pointer-locked', locked); b.toggle('locked', locked); b.toggle('first-person', running); b.toggle('playing', running);
    const crosshair = $('#crosshair'); if (crosshair) crosshair.hidden = !(running && locked);
    const resume = $('#resumeHint'); if (resume) resume.hidden = !(running && !locked && lockSupported && !dialog);
    if (inShell && dialog !== shellPanel) { shellPanel = dialog; console.info('[raft-shell] panel=' + dialog); } // desktop/main.cjs watches this
  }

  // ---------- Pointer lock ----------
  let lockPromisePending = false, lockHasPromise = false, lockFailures = 0;
  const windowFocused = () => { try { return document.hasFocus(); } catch { return true; } };
  // Always ask (no navigator.userActivation pre-gate): after the page itself released the lock (inventory,
  // crafting, crew) Chrome relocks without a gesture. Refusals are handled in lockFailed (lock-rules.js).
  // While Escape is still held (it just closed a panel), Chrome may treat the held key as the user leaving
  // the new lock, so the relock waits for the release (no gesture needed: the page released the lock itself).
  let escHeld = false, relockOnEscUp = false;
  function escReleased() { escHeld = false; if (relockOnEscUp) { relockOnEscUp = false; requestLock(); } }
  function requestLock() {
    if (!shouldRequestLock({running, supported:lockSupported, blocked:uiBlocked()}) || isLocked()) return;
    if (escHeld) { relockOnEscUp = true; return; }
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.then === 'function') { lockPromisePending = lockHasPromise = true; p.then(() => { lockPromisePending = false; lockFailures = 0; }, guard(err => { lockPromisePending = false; lockFailed(err); })); }
    } catch (err) { lockFailed(err); }
  }
  // Lock refused. Escape cooldown (SecurityError), unfocused window (WrongDocumentError) and missing gesture are
  // transient: the next click or focus retries. Only NotSupportedError, a missing API, or repeated refusals while
  // focused switch to drag-look. The click that asked for lock never acts.
  function lockFailed(err) {
    if (isLocked()) return;
    const isEvent = typeof Event !== 'undefined' && err instanceof Event;
    if (isEvent && (lockPromisePending || lockHasPromise)) { refreshPointerUI(true); return; } // the promise rejection carries the real reason
    const verdict = lockFailureVerdict({supported:lockSupported, err:isEvent ? null : err, focused:windowFocused(), failures:lockFailures});
    lockFailures = verdict.failures;
    if (!verdict.fallback) { refreshPointerUI(true); return; }
    const wasFallback = lockFallback; lockFallback = true; refreshPointerUI(true);
    if (!wasFallback && running) notice('Mouse lock unavailable: drag to look, click to use', 3000);
  }
  function releaseLock() { if (isLocked()) document.exitPointerLock?.(); }
  function look(dx, dy, k) { yaw -= dx * k; pitch = clamp(pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT); }
  function clearInput() { keys = {}; charging = null; reeling = false; down = null; }

  // ---------- Aiming ----------
  function pickNdc(nx, ny) {
    pointer.set(nx, ny); ray.setFromCamera(pointer, camera);
    plane.constant = -deckY() - .02;
    const held = allHeldTokens(); // ours and, on the host, the guest's hook
    let item = null;
    for (const hit of ray.intersectObjects(itemsGroup.children, true)) {
      let o = hit.object; while (o && !o.userData.token) o = o.parent;
      const found = o && world.items.find(it => it.token === o.userData.token);
      if (found && !isPending(found) && !held.has(found.token)) { item = found; break; }
    }
    if (!item) { // small forgiveness for hand pickup only; throws never use this
      let best = Infinity;
      for (const it of world.items) {
        if (isPending(it) || held.has(it.token)) continue; const m = itemMeshes.get(it.token); if (!m) continue;
        const along = m.position.clone().sub(ray.ray.origin).dot(ray.ray.direction);
        if (along > 0 && along < 5 && along < best && ray.ray.distanceSqToPoint(m.position) < .2) { best = along; item = it; }
      }
    }
    return {point:ray.ray.intersectPlane(plane, new T.Vector3()), item, dir:ray.ray.direction.clone()};
  }
  function pickScreen(x, y) { const r = canvas.getBoundingClientRect(); return pickNdc((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); }
  const pickCenter = () => pickNdc(0, 0);
  function currentAim() {
    if (isLocked()) return pickCenter();
    if (lockFallback && mouse.inside) return pickScreen(mouse.x, mouse.y);
    return null;
  }
  function pickupFrom(aim) {
    const it = aim?.item; if (!it) return null;
    const m = itemMeshes.get(it.token), p = m ? m.position : it;
    return Math.hypot(p.x - physics.x, p.z - physics.z) <= PICKUP_REACH ? it : null;
  }
  // Returns null when the cell is not a build spot at all, else {x, z} plus `blocked` ('bound' | 'cap' | 'reach') when refused.
  function placementFor(kind, p) {
    if (!p) return null; const x = Math.round(p.x / 2), z = Math.round(p.z / 2);
    let why;
    if (kind === 'hammer') why = floorBlock(world.tiles, x, z);
    else if (DECOR_TYPES.includes(kind)) why = decorBlock(world.tiles, world.decor, x, z);
    else return null;
    if (why && !BLOCK_TEXT[why]) return null;
    if (!why && !inReach(physics.x, physics.z, x, z)) why = 'reach';
    return why ? {x, z, blocked:why} : {x, z};
  }
  function placementCandidates(kind) {
    const out = [], ok = (x, z) => inReach(physics.x, physics.z, x, z);
    if (kind === 'hammer') { const seen = new Set(); for (const [tx, tz] of world.tiles) for (const [a, b] of NEIGHBOURS) { const x = tx + a, z = tz + b, k = x + ',' + z; if (!seen.has(k) && !floorBlock(world.tiles, x, z) && ok(x, z)) { seen.add(k); out.push({x, z}); } } }
    else if (DECOR_TYPES.includes(kind)) for (const [x, z] of world.tiles) if (!decorBlock(world.tiles, world.decor, x, z) && ok(x, z)) out.push({x, z});
    return out;
  }

  // ---------- Actions (host is authoritative; actor = 'host' | 'guest') ----------
  function send(data) { if (conn?.open) { try { conn.send(data); } catch {} } }
  function action(a) {
    if (role === 'guest') {
      if (!networkReady) { notice('Wait for your raft to connect'); return false; }
      a.seq = ++seq; lastSeqSent = performance.now(); send({type:'action', a}); return true;
    }
    applyAction(a, 'host'); return true;
  }
  function emit(e, to) { // to: 'host' | 'guest' | 'all'
    if (to !== 'guest') effect(e);
    if (to !== 'host') send({type:'effect', e});
  }
  function effect(e) {
    if (!e || typeof e !== 'object') return;
    if (Array.isArray(e.tokens)) for (const t of e.tokens) if (typeof t === 'string') pending.delete(t);
    if (typeof e.text === 'string' && e.text) notice(e.text.slice(0, 90));
    sfx(e.kind === 'build' ? 'build' : e.kind === 'repair' ? 'repair' : e.kind === 'craft' ? 'build' : e.kind === 'loot' ? 'collect' : 'ui', e.kind === 'craft' ? .6 : 1);
    if (e.kind === 'loot') hintDone('loot');
  }
  function wearHook(bag, slot, actor) {
    const i = hookIndex(bag, slot); if (i < 0) return;
    const s = bag.slots[i], before = clamp(s.durability ?? MAX_HEALTH, 0, MAX_HEALTH);
    s.durability = Math.max(0, before - WEAR_PER_CATCH);
    if (before > 0 && s.durability === 0) emit({kind:'notice', text:'Hook worn out: shorter throws. R to repair'}, actor);
    else if (before > 25 && s.durability <= 25) emit({kind:'notice', text:'Hook getting worn. R repairs: 2 wood, 1 scrap'}, actor);
  }
  function applyAction(a, actor = 'host') {
    if (!a || typeof a !== 'object' || role === 'guest') return;
    const bag = actorBag(actor);
    if (a.kind === 'selectSlot') { bag.select(a.index); return; }
    if (a.kind === 'moveSlot') { bag.move(a.from, a.to, a.amount ?? undefined); return; }
    if (a.kind === 'craft') {
      const r = bag.craft(a.recipe);
      if (r.ok) emit({kind:'craft', text:`Crafted ${ITEM_INFO[r.crafted.kind]?.name ?? r.crafted.kind}`}, actor);
      else if (r.reason === 'full') emit({kind:'full', text:'Your bag is full'}, actor);
      else if (r.reason === 'missing') emit({kind:'notice', text:'Need ' + r.missing.map(m => `${m.count} more ${itemName(m.kind)}`).join(' and ')}, actor);
      return;
    }
    if (a.kind === 'collect') {
      const i = world.items.findIndex(it => it.id === a.id && it.token === a.token); if (i < 0) return; // token guard: each supply counts once
      const it = world.items[i], loot = LOOT[it.type]; if (!loot) return;
      const scratch = new Bag(bag.snapshot());
      for (const [k, n] of Object.entries(loot)) if (scratch.add(k, n) > 0) { // atomic: all loot fits or nothing changes
        if (!a.net) emit({kind:'full', text:'Your bag is full', tokens:[it.token]}, actor);
        return;
      }
      commit(bag, scratch);
      world.collected++; world.items.splice(i, 1); world.items.push(makeItem(a.id)); syncItems();
      if (typeof a.cast === 'string' && a.cast && wornCasts[actor] !== a.cast) { wornCasts[actor] = a.cast; wearHook(bag, a.slot, actor); }
      if (!a.net) emit({kind:'loot', text:'+ ' + Object.entries(loot).map(([k, n]) => `${n} ${itemName(k)}`).join(' · ')}, actor);
      return;
    }
    if (a.kind === 'build') {
      if (!isInt(a.x) || !isInt(a.z)) return;
      const who = actor === 'guest' ? other : physics; // guest pose may be missing until its first move
      if (who && !inReach(who.x, who.z, a.x, a.z, BUILD_REACH + (actor === 'guest' ? GUEST_REACH_SLACK : .01))) { emit({kind:'notice', text:BLOCK_TEXT.reach}, actor); return; }
      if (a.recipe === 'floor') {
        const why = floorBlock(world.tiles, a.x, a.z);
        if (why) { if (BLOCK_TEXT[why]) emit({kind:'notice', text:BLOCK_TEXT[why]}, actor); return; }
        if (bag.count('hammer') < 1) { emit({kind:'notice', text:'Craft a hammer first'}, actor); return; }
        if (!spend(bag, FLOOR_COST)) { emit({kind:'notice', text:'Floor needs ' + missingText(bag, FLOOR_COST)}, actor); return; }
        world.tiles.push([a.x, a.z]);
      } else if (DECOR_TYPES.includes(a.recipe)) {
        if (decorBlock(world.tiles, world.decor, a.x, a.z)) return;
        const sel = bag.slots[bag.selectedIndex];
        if (sel?.kind === a.recipe) { sel.count--; if (sel.count <= 0) bag.slots[bag.selectedIndex] = null; }
        else if (!bag.remove(a.recipe, 1)) { emit({kind:'notice', text:`Craft a ${itemName(a.recipe)} first`}, actor); return; }
        world.decor.push({type:a.recipe, x:a.x, z:a.z});
      } else return;
      rebuildRaft(); emit({kind:'build', text:a.recipe === 'floor' ? 'A little more room!' : `${ITEM_INFO[a.recipe].name} placed`}, 'all');
      return;
    }
    if (a.kind === 'fish') {
      if (bag.count('fishingrod') < 1) return;
      if (bag.add('fish', 1) > 0) { emit({kind:'full', text:'Bag full: the fish swam away'}, actor); return; }
      world.fish++; emit({kind:'loot', text:'You caught a fish!'}, actor); return;
    }
    if (a.kind === 'repair') {
      const i = repairHookSlot(bag.slots, a.slot, MAX_HEALTH);
      if (i < 0) { emit({kind:'notice', text:'No hook to repair'}, actor); return; }
      if ((bag.slots[i].durability ?? MAX_HEALTH) >= MAX_HEALTH) { emit({kind:'notice', text:'Your hook is in great shape'}, actor); return; }
      if (!spend(bag, REPAIR_COST)) { emit({kind:'notice', text:'Repair needs ' + missingText(bag, REPAIR_COST)}, actor); return; }
      bag.slots[i].durability = MAX_HEALTH; emit({kind:'repair', text:'Hook repaired!'}, actor); return;
    }
    // 'wear' (legacy clients wore the hook on every throw) is ignored: wear now happens only on a successful catch.
  }

  // Inventory UI and hotbar. The guest predicts locally; the host snapshot (acked by seq) is canonical.
  function selectSlot(i) {
    if (!isInt(i) || i < 0 || i >= HOTBAR) return;
    const bag = localBag(); if (bag.selectedIndex === i) return;
    charging = null; hover = null; reelCast('slot'); if (hintsDone.has('bag')) hintDone('slots');
    if (role === 'guest') { if (!networkReady) return; bag.select(i); action({kind:'selectSlot', index:i}); }
    else action({kind:'selectSlot', index:i});
  }
  function moveSlot(from, to, amount) {
    const a = {kind:'moveSlot', from, to}; if (isInt(amount)) a.amount = amount;
    if (role === 'guest') { if (!networkReady) return; localBag().move(from, to, a.amount); }
    action(a);
  }
  function craft(recipe) { if (typeof recipe === 'string') action({kind:'craft', recipe}); }
  function repair() { if (!running) return; const bag = localBag(); action({kind:'repair', slot:repairHookSlot(bag.slots, bag.selectedIndex, MAX_HEALTH)}); }
  function openInventory() { if (!running || !survivalUI) return; clearInput(); releaseLock(); survivalUI.open?.(); hintDone('bag'); }
  function interact() {
    if (!running || uiBlocked()) return;
    const target = pickupFrom(currentAim());
    if (target) {
      if (guestWaiting()) { notice('Wait for your raft to connect'); return; }
      pending.set(target.token, performance.now() + PENDING_MS); swing = .6; sfx('collect', .7);
      action({kind:'collect', id:target.id, token:target.token});
      return;
    }
    openInventory();
  }

  // Left click uses the selected bag item. The hook uses charge/throw/reel below.
  function useSelected(aim) {
    if (!running || hook || fishWait) return;
    if (guestWaiting()) { notice('Wait for your raft to connect'); return; }
    const kind = selectedKind(), bag = localBag(), p = aim?.point ?? null;
    if (kind === 'hammer' || DECOR_TYPES.includes(kind)) {
      const v = placementFor(kind, p);
      if (!v) { notice(kind === 'hammer' ? 'Point at an empty space beside the raft' : 'Point at an empty raft floor'); return; }
      if (v.blocked) { notice(BLOCK_TEXT[v.blocked]); return; }
      if (kind === 'hammer' && !canAfford(bag, FLOOR_COST)) { notice('Floor needs ' + missingText(bag, FLOOR_COST)); return; }
      swing = 1; action({kind:'build', recipe:kind === 'hammer' ? 'floor' : kind, ...v}); return;
    }
    if (kind === 'fishingrod') {
      if (!p || hasTile(Math.round(p.x / 2), Math.round(p.z / 2))) { notice('Point at the water to fish'); return; }
      if (Math.hypot(p.x - physics.x, p.z - physics.z) > FISH_REACH) { notice('Try a spot a little closer'); return; }
      fishWait = 3 + Math.random() * 2; hook = {end:new T.Vector3(p.x, .1, p.z), t:0, duration:fishWait + .8, fishing:true};
      swing = 1; sfx('throw', .6); // the context prompt shows the wait
    }
  }
  function beginCharge(at) {
    if (!running || hook || fishWait || selectedKind() !== 'hook') return;
    if (guestWaiting()) { notice('Wait for your raft to connect'); return; }
    charging = {start:performance.now(), x:at?.x ?? null, y:at?.y ?? null};
  }
  function releaseCharge(aim) {
    const c = charging; charging = null;
    if (!c || !running || hook || selectedKind() !== 'hook') return;
    if (guestWaiting()) { notice('Wait for your raft to connect'); return; }
    throwHook(aim, clamp((performance.now() - c.start) / CHARGE_MS, MIN_CHARGE, 1));
  }
  // Ballistic: the camera ray is the throw direction. Aim up + charge decide the arc. Misses are real.
  function throwHook(aim, charge) {
    const bag = localBag(), idx = bag.selectedIndex, slot = bag.slots[idx];
    if (slot?.kind !== 'hook') return;
    const durability = clamp(slot.durability ?? MAX_HEALTH, 0, MAX_HEALTH), maxRange = 16 + durability * .16;
    const direction = aim?.dir ?? camera.getWorldDirection(new T.Vector3());
    const deckAt = (x, z) => (hasTile(Math.round(x / 2), Math.round(z / 2)) ? deckY() : null); // stop on the planks
    hook = new HookCast(T, {origin:handPos.clone(), direction, maxRange, charge, deckAt});
    castId = newToken(); hookSlot = idx; lastCaughtCount = 0; reeling = false; swing = 1; sfx('throw', .4 + .6 * charge); hintDone('throw');
    if (durability <= 0) notice('Worn hook: shorter throws. R to repair');
  }

  function start() {
    running = true; const w = $('#welcome'); if (w) w.hidden = true; const h = $('#hud'); if (h) h.hidden = false;
    if (!saveAvailable) setText('#saveStatus', 'Browser storage is unavailable. This session will not be saved.');
    refreshPointerUI(true);
  }
  function syncWorldInventories() { // only for the world this client owns (solo / host)
    world.hostInventory = hostBag.snapshot(); world.guestInventory = guestBag.snapshot();
    world.stock = legacyStock(hostBag); world.hookHealth = hookDurability(hostBag);
  }
  function blockSave() {
    if (saveBlocked) return; saveBlocked = true;
    setText('#saveStatus', 'This raft was saved in another tab. This tab stopped saving so it will not overwrite it. Reload to continue from that save.');
    notice('Saved in another tab. This tab stopped saving', 3200);
  }
  function save() {
    if (role === 'guest' || disposed || saveBlocked) return;
    syncWorldInventories();
    try {
      const plan = planSave(localStorage.getItem(SAVE), saveRev);
      if (!plan.ok) { blockSave(); return; }
      localStorage.setItem(SAVE, JSON.stringify({...world, items:[], rev:plan.rev, savedAt:Date.now()})); saveRev = plan.rev;
    }
    catch { saveAvailable = false; setText('#saveStatus', 'Browser storage is full or unavailable. This session will not be saved.'); }
  }

  // ---------- Movement ----------
  const held = (...codes) => codes.some(c => keys[c]);
  function movePlayer(dt, input) {
    if (!running) { walking = false; return; }
    const fwd = input ? held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown') : 0, side = input ? held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft') : 0;
    const jumpFrom = physics.grounded && input && held('Space');
    const ev = physics.update(dt, {forward:fwd, strafe:side, yaw, jump:input && held('Space'), sprint:input && held('ShiftLeft', 'ShiftRight'),
      tiles:world.tiles, deckY:deckY(), waterY:ocean.getHeight(physics.x, physics.z), blocked:blockList});
    const speed = Math.hypot(physics.vx, physics.vz);
    walking = physics.grounded && speed > .4; if (walking) walkPhase += dt * 9 * Math.min(1.6, speed / 2.6);
    if (ev?.splashed) sfx('splash');
    if (jumpFrom && !physics.grounded && !physics.swimming && physics.vy > 0) sfx('jump', .7);
    swimClock = physics.swimming && (fwd || side) ? swimClock - dt : 0;
    if (physics.swimming && (fwd || side) && swimClock <= 0) { swimClock = .75; sfx('swim', .7); }
    if (![physics.x, physics.y, physics.z].every(Number.isFinite)) { const s = spawnPoint(0, 0); physics = new PlayerPhysics({x:s.x, y:deckY() + EYE_OFFSET, z:s.z}); }
  }

  // ---------- Frame ----------
  const handPos = new T.Vector3(physics.x, physics.y, physics.z), tmpV = new T.Vector3(), friendTarget = new T.Vector3();
  // Hook physics floats at a flat WATER_Y; map heights near the water onto the visible waves.
  function surfaceY(x, z, y) {
    const k = clamp((y - WATER_Y) / .6, 0, 1), w = ocean.getHeight(x, z) + .04 + (y - WATER_Y);
    return w + (y - w) * k;
  }
  function setRope(points) {
    const arr = ropeAttr.array, n = Math.min(points.length, ROPE_SEGMENTS + 1);
    for (let i = 0; i < n; i++) { arr[i * 3] = points[i].x; arr[i * 3 + 1] = points[i].y; arr[i * 3 + 2] = points[i].z; }
    ropeAttr.needsUpdate = true; rope.geometry.setDrawRange(0, n); rope.visible = true;
  }
  function updateRaft(dt) {
    const base = ocean.mesh.position.y, h = ocean.getHeight(0, 0) - base, s = ocean.getSlope(0, 0, undefined, 2.2);
    const ky = Math.min(1, dt * 2), kr = Math.min(1, dt * 1.5);
    raft.position.y += (h * .3 - raft.position.y) * ky;
    raft.rotation.x += (-s.z * .35 - raft.rotation.x) * kr;
    raft.rotation.z += (s.x * .35 + Math.sin(elapsed * .7) * .003 - raft.rotation.z) * kr;
  }
  function updateCamera(dt) {
    const fov = running ? options.fov : 48; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    if (running) {
      const bob = walking ? Math.sin(walkPhase) * .025 * options.cameraMotion : 0;
      camera.position.set(physics.x, physics.y + bob, physics.z);
      camera.rotation.set(pitch, yaw, physics.grounded ? raft.rotation.z * CAMERA_ROLL * options.cameraMotion : 0, 'YXZ');
    } else { // gentle cinematic view for the welcome screen
      const focus = new T.Vector3(-5, 0, 2), d = 23, cy = .68 + Math.sin(elapsed * .05) * .12, cp = .77;
      camera.position.set(focus.x + Math.sin(cy) * d * Math.cos(cp), d * Math.sin(cp), focus.z + Math.cos(cy) * d * Math.cos(cp)); camera.lookAt(focus);
    }
    swing = Math.max(0, swing - dt * 3);
    const kind = heldKind(), motion = options.cameraMotion;
    const ch = charging ? clamp((performance.now() - charging.start) / CHARGE_MS, 0, 1) : 0;
    hookHands.group.visible = running && kind === 'hook';
    hammerHands.group.visible = running && kind === 'hammer';
    rodHands.group.visible = running && kind === 'fishingrod';
    if (hookHands.group.visible) hookHands.update({dt, time:elapsed, charge:ch, reeling:reeling && !!castOut(), casting:swing, walking, hasHookOut:!!castOut(), motion});
    if (hammerHands.group.visible) hammerHands.update({dt, time:elapsed, charge:0, reeling:false, casting:swing, walking, hasHookOut:false, motion});
    if (rodHands.group.visible) {
      const out = !!hook?.fishing; if (rodModel.userData.float) rodModel.userData.float.visible = !out; if (rodModel.userData.leader) rodModel.userData.leader.visible = !out;
      rodHands.update({dt, time:elapsed, charge:0, reeling:out && hook.t > fishWait, casting:swing, walking, hasHookOut:false, motion});
    }
    camera.updateMatrixWorld(true);
    (kind === 'fishingrod' ? rodTip : hookHands.handTip).getWorldPosition(handPos);
  }
  function updateAvatars(dt) {
    player.position.set(physics.x, physics.y - EYE_OFFSET, physics.z); player.rotation.y = yaw + Math.PI;
    player.visible = !running; // in first person we never see our own head or body
    friend.visible = !!other;
    if (other) {
      friendTarget.set(other.x, other.y !== null ? other.y - EYE_OFFSET : deckY(), other.z);
      if (friend.position.distanceTo(friendTarget) > 3) friend.position.copy(friendTarget); else friend.position.lerp(friendTarget, Math.min(1, dt * 12));
      friend.rotation.y = (other.yaw ?? 0) + Math.PI;
    }
  }
  const allHeldTokens = () => new Set([...caughtList(castOut()).map(c => c.token), ...(role === 'guest' ? [] : guestHeld.tokens(performance.now()))]);
  function updateItems(dt) {
    const heldTokens = allHeldTokens();
    if (role !== 'guest') {
      let respawned = false; const end = Math.max(...world.tiles.map(t => t[1])) * 2 + 24, side = Math.max(...world.tiles.map(t => Math.abs(t[0]))) * 2 + 24;
      for (const it of world.items) {
        if (heldTokens.has(it.token)) continue; // a hook (ours or the guest's) holds it; don't let it drift away or respawn
        it.z += dt * .22; it.x += Math.sin(elapsed * .13 + it.phase) * dt * .04;
        if (it.z > end || Math.abs(it.x) > side || hasTile(Math.round(it.x / 2), Math.round(it.z / 2))) { Object.assign(it, makeItem(it.id)); respawned = true; }
      }
      if (respawned) syncItems();
    }
    for (const it of world.items) {
      const m = itemMeshes.get(it.token); if (!m) continue;
      m.visible = !isPending(it); m.scale.setScalar(1);
      const u = m.userData;
      if (role === 'guest' && u.sx !== undefined && Math.hypot(it.x - u.sx, it.z - u.sz) < 3) { const k = Math.min(1, dt * 8); u.sx += (it.x - u.sx) * k; u.sz += (it.z - u.sz) * k; }
      else { u.sx = it.x; u.sz = it.z; }
      const s = ocean.getSlope(u.sx, u.sz);
      m.position.set(u.sx, ocean.getHeight(u.sx, u.sz) + ITEM_FLOAT, u.sz);
      m.rotation.set(-s.z * 1.2 + Math.sin(elapsed * 1.3 + it.phase) * .04, it.phase + elapsed * .08, s.x * 1.2 + Math.sin(elapsed + it.phase) * .05);
    }
  }
  function endHook() { hook = null; lastCaughtCount = 0; reeling = false; rope.visible = false; hookMesh.visible = false; if (bobber) bobber.visible = false; }
  // A click or slot change while the rod line is out reels it in: a fish only if it is biting on a click.
  function reelCast(source) {
    const r = castInput(hook, fishWait, source); if (r === 'none') return false;
    if (r === 'catch') action({kind:'fish'});
    fishWait = 0; endHook(); return true;
  }
  function updateHook(dt) {
    if (!hook) { rope.visible = false; hookMesh.visible = false; if (bobber) bobber.visible = false; return; }
    if (hook.fishing) { // simple bobber animation, separate from HookCast
      hook.t += dt; const f = hook.t / hook.duration, u = Math.min(1, f * 5);
      const pos = handPos.clone().lerp(hook.end, u);
      if (u >= 1) pos.y = ocean.getHeight(pos.x, pos.z) + .05 + Math.sin(elapsed * 5) * .03 - (hook.t > fishWait ? .12 : 0); else pos.y += Math.sin(u * Math.PI) * 1.2;
      const pts = []; for (let i = 0; i <= ROPE_SEGMENTS; i++) pts.push(handPos.clone().lerp(pos, i / ROPE_SEGMENTS));
      setRope(pts); hookMesh.visible = false; bobber.visible = true; bobber.position.copy(pos);
      if (f >= 1) { if (selectedKind() === 'fishingrod') action({kind:'fish'}); fishWait = 0; endHook(); }
      return;
    }
    const guestTokens = role === 'guest' ? null : new Set(guestHeld.tokens(performance.now())); // host skips the guest's catch
    const ev = hook.update(dt, {hand:handPos, items:world.items.filter(it => !isPending(it) && !guestTokens?.has(it.token)), reeling, time:elapsed});
    const hp = hook.position, pos = new T.Vector3(hp.x, surfaceY(hp.x, hp.z, hp.y), hp.z);
    hookMesh.visible = true; hookMesh.position.copy(pos); bobber.visible = false;
    if (hook.stage === 'flying') hookMesh.rotation.set(-hook.flightT * Math.PI * 2, yaw, 0);
    else if (hook.stage === 'reeling') hookMesh.rotation.set(-.6, yaw, 0);
    else hookMesh.rotation.set(0, yaw, 1.1);
    const pts = hook.ropePoints(handPos, ROPE_SEGMENTS);
    for (let i = 1; i < pts.length; i++) pts[i].y = surfaceY(pts[i].x, pts[i].z, pts[i].y);
    pts[pts.length - 1].copy(pos); setRope(pts);
    const caught = caughtList(hook);
    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) sfx('splash', .5); lastCaughtCount = caught.length; }
    for (let i = 0; i < caught.length; i++) { // visual only: the whole catch trails the hook as a bundle
      const m = itemMeshes.get(caught[i].token), cp = hook.caughtPosition(i, tmpV);
      if (m && cp) { m.position.set(cp.x, surfaceY(cp.x, cp.z, cp.y) - .02, cp.z); m.scale.setScalar(clamp(hook.distance / 2.5, .35, 1)); }
    }
    if (ev?.kind === 'collected') {
      const seen = new Set();
      for (const it of Array.isArray(ev.items) ? ev.items : [{id:ev.id, token:ev.token}]) {
        if (!it || typeof it.token !== 'string' || seen.has(it.token)) continue; seen.add(it.token);
        pending.set(it.token, performance.now() + PENDING_MS);
        action({kind:'collect', id:it.id, token:it.token, cast:castId, slot:hookSlot});
      }
    } else if (ev?.kind === 'returned') sfx('collect', .5);
    if (hook.stage === 'done') endHook();
  }
  function updateGhost() {
    const kind = heldKind();
    hover = frameAim && (kind === 'hammer' || DECOR_TYPES.includes(kind)) && !hook ? placementFor(kind, frameAim.point) : null;
    ghost.visible = !!hover; if (!hover) return;
    ghost.position.set(hover.x * 2, raft.position.y + .29, hover.z * 2);
    ghost.material.color.set(hover.blocked || (kind === 'hammer' && !canAfford(localBag(), FLOOR_COST)) ? '#ee8e75' : '#b6ffd0');
  }
  function hostState() {
    const c = guestBag.counts();
    return {type:'state', v:3, ack:guestAck, bag:guestBag.snapshot(), other:pose(),
      world:{tiles:world.tiles, decor:world.decor, stock:{wood:c.wood, leaf:c.leaf, scrap:c.scrap, plastic:c.plastic}, fish:world.fish, collected:world.collected, hookHealth:hookDurability(guestBag), items:world.items}};
  }
  const pose = () => ({x:physics.x, y:physics.y, z:physics.z, yaw, swimming:physics.swimming});
  function frame() {
    const now = performance.now(), dt = Math.min((now - last) / 1000, .05); last = now; elapsed += dt;
    const dialog = uiBlocked();
    checkPeerStale(now);
    ocean.update(elapsed, camera);
    updateRaft(dt); movePlayer(dt, running && !dialog);
    updateAvatars(dt); updateCamera(dt);
    frameAim = running && !dialog ? currentAim() : null;
    pickTarget = pickupFrom(frameAim);
    updateItems(dt); updateHook(dt); updateGhost();
    if (running && role !== 'guest') {
      netClock += dt;
      if (netClock > .8) { // nets gather into the host's bag (trusted shared machine) and never consume when full
        netClock = 0; const heldTokens = allHeldTokens(), fits = it => lootFits(actorBag('host'), LOOT[it.type]);
        for (const net of world.decor.filter(d => d.type === 'net')) { const it = pickNetItem(world.items, net, {held:heldTokens, isPending, fits}); if (it) applyAction({kind:'collect', id:it.id, token:it.token, net:true}, 'host'); }
      }
    }
    if (running) { const t = wallTick(now, lastSaveAt, 3000); lastSaveAt = t.next; if (t.due) save(); } // wall clock: dt is capped
    if (conn?.open) { const t = wallTick(now, lastNetSendAt, 120); lastNetSendAt = t.next; if (t.due) send(role === 'host' ? hostState() : {type:'move', me:pose(), held:caughtList(castOut()).map(c => c.token)}); }
    if (survivalUI && !uiFailed) { try { survivalUI.update?.(); } catch (e) { uiFailed = true; console.error('survival UI update failed', e); } }
    refreshPointerUI(); updateCharge(); updateContext(dialog); updateNotices(dialog);
    if (world.fish !== fishShown) { const el = $('#fishCount'); if (el) { el.textContent = world.fish + ' fish caught'; fishShown = world.fish; } }
    renderer.render(scene, camera);
  }
  // Peer liveness. rAF stops in hidden tabs, so a timer keeps the channel warm and each side says when it is
  // hidden; a hidden peer is never timed out (the data channel's 'close' still ends the session).
  function checkPeerStale(now) {
    if (role === 'guest' && networkReady && peerStale(now, lastHostMessage, peerHidden)) { closeConnection(); toast('Host disconnected. You are back on your own raft.'); }
    if (role === 'host' && conn?.open && peerStale(now, lastGuestMessage, peerHidden)) { const stale = conn; conn = null; unbindTarget(stale); stale.close(); other = null; networkReady = false; peerHidden = false; setConnectionLabel('BROTHER LEFT · ROOM OPEN'); }
  }
  function pulse() {
    if (disposed || !conn?.open) return;
    const now = performance.now();
    if (document.hidden) { // no frames here: keep the peer fed (the host's world still changes from guest actions)
      send(role === 'host' && networkReady ? hostState() : {type:'hidden'}); lastNetSendAt = now;
    } else if (now - lastNetSendAt > HEARTBEAT_MS) { send({type:'ping'}); lastNetSendAt = now; }
    checkPeerStale(now);
  }
  heartbeat = setInterval(pulse, HEARTBEAT_MS);
  function animate() {
    if (!active || disposed) return;
    rafId = requestAnimationFrame(animate);
    frame();
  }

  // ---------- Input ----------
  const on = (target, type, fn, opts = {}) => target?.addEventListener(type, guard(fn), {...opts, signal});
  on(document, 'pointerlockchange', () => {
    if (isLocked()) { lockFallback = false; lockFailures = 0; }
    else { if (charging && charging.x === null) charging = null; reeling = false; }
    down = null; refreshPointerUI(true);
  });
  on(document, 'pointerlockerror', lockFailed);
  on(document, 'mousemove', e => {
    if (!isLocked() || uiBlocked()) return;
    look(clamp(e.movementX, -200, 200), clamp(e.movementY, -200, 200), LOOK_SENSITIVITY * options.sensitivity);
  });
  on(canvas, 'pointerdown', e => {
    if (!running || !scene || e.button !== 0 || uiBlocked()) return;
    if (isLocked()) {
      if (reelCast('click')) return;
      if (castOut()) reeling = true;
      else if (!hook && !fishWait) { if (selectedKind() === 'hook') beginCharge(null); else useSelected(pickCenter()); }
      return;
    }
    down = {x:e.clientX, y:e.clientY, moved:false, tool:selectedKind(), used:false}; try { canvas.setPointerCapture(e.pointerId); } catch {}
    if (reelCast('click')) down.used = true;
    else if (castOut()) { reeling = true; down.used = true; } // hold to reel works without lock too
    else if (lockFallback && selectedKind() === 'hook' && !hook && !fishWait) { beginCharge({x:e.clientX, y:e.clientY}); down.used = !!charging; }
  });
  on(canvas, 'pointermove', e => {
    mouse = {x:e.clientX, y:e.clientY, inside:true};
    if (!down || isLocked()) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > 4) { down.moved = true; if (charging && charging.x !== null) charging = null; } // a drag is a look, not a throw
    if (down.moved) { look(dx, dy, dragLookScale(DRAG_SENSITIVITY, options.sensitivity)); down.x = e.clientX; down.y = e.clientY; }
  });
  on(canvas, 'pointerup', e => {
    if (e.button !== 0) return;
    reeling = false;
    if (isLocked()) { down = null; if (charging) releaseCharge(pickCenter()); return; }
    const press = down, wasClick = !!press && !press.moved; down = null;
    if (charging) { if (wasClick && charging.x !== null) releaseCharge(pickScreen(charging.x, charging.y)); else charging = null; return; }
    if (!wasClick || !running) return;
    // Only a plain click acts, with the tool it was pressed with (a slot switch mid-press does nothing).
    if (lockFallback) { if (!hook && selectedKind() !== 'hook' && releaseShouldFire(press, selectedKind())) useSelected(pickScreen(e.clientX, e.clientY)); return; }
    if (!uiBlocked()) requestLock(); // first click only locks; it never acts
  });
  on(canvas, 'pointerleave', () => { mouse.inside = false; });
  on(canvas, 'pointercancel', () => { down = null; reeling = false; if (charging && charging.x !== null) charging = null; });
  on(canvas, 'contextmenu', e => e.preventDefault());
  on(canvas, 'wheel', e => {
    if (!running || uiBlocked() || (!isLocked() && !lockFallback)) return;
    e.preventDefault();
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (Math.abs(wheelAcc) < 40) return;
    const step = wheelAcc > 0 ? 1 : -1; wheelAcc = 0;
    selectSlot((localBag().selectedIndex + step + HOTBAR) % HOTBAR);
  }, {passive:false});
  on($('#resumeHint'), 'click', () => requestLock());

  on(window, 'keydown', e => {
    if (e.target?.matches?.('input, textarea, select') || uiBlocked()) return;
    keys[e.code] = true;
    const m = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
    if (m && running) selectSlot(+m[1] - 1);
    if (e.code === 'KeyE' && !e.repeat) interact();
    if (e.code === 'KeyR' && !e.repeat) repair();
    if (running && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
  });
  on(window, 'keyup', e => { keys[e.code] = false; });
  on(window, 'keydown', e => { if (e.key === 'Escape' && !e.repeat) { escHeld = true; relockOnEscUp = false; } }, {capture:true});
  on(window, 'keyup', e => { if (e.key === 'Escape') escReleased(); }, {capture:true});
  on(window, 'pointerdown', () => { escHeld = relockOnEscUp = false; }, {capture:true}); // a click relocks on its own
  // Focus loss (alt-tab): drop held input and show the hint at the top edge; one click on return relocks.
  on(window, 'blur', () => { clearInput(); escHeld = relockOnEscUp = false; document.body.classList.toggle('away', running); refreshPointerUI(true); });
  on(window, 'focus', () => { document.body.classList.remove('away'); refreshPointerUI(true); });
  on(window, 'beforeunload', () => { save(); send({type:'leaving'}); try { conn?.close(); peer?.destroy(); } catch {} });
  on(document, 'visibilitychange', () => {
    send({type:document.hidden ? 'hidden' : 'visible'}); lastNetSendAt = performance.now();
    if (document.hidden && running) save(); // a hidden tab may be discarded without beforeunload
  });
  on(window, 'pagehide', () => { if (running) save(); });
  on(window, 'storage', e => { // another tab wrote our save key
    if (e.key !== SAVE || role === 'guest') return;
    if (saveRevision(e.newValue) > saveRev) blockSave();
  });
  on(window, 'resize', () => { if (!camera) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // DOM property handlers: a newer mount simply overwrites these; a failed mount restores the previous ones.
  const propertyHandlers = [];
  const setHandler = (el, prop, fn) => { if (el) { const previous = el[prop], next = guard(fn); propertyHandlers.push([el, prop, previous, next]); el[prop] = next; } };
  function openDialog(id) { releaseLock(); const d = $('#' + id); if (d && !d.open) d.showModal(); }
  setHandler($('#solo'), 'onclick', () => { start(); requestLock(); });
  setHandler($('#crewButton'), 'onclick', () => openDialog('crew'));
  setHandler($('#welcomeCrew'), 'onclick', () => openDialog('crew'));
  setHandler($('#helpButton'), 'onclick', () => settingsController?.open());
  document.querySelectorAll('[data-close]').forEach(b => setHandler(b, 'onclick', () => $('#' + b.dataset.close)?.close()));
  // Crew/Help closed during play go back to locked play; opened from the pause menu, settings.js reopens it instead.
  for (const id of ['crew', 'help']) on($('#' + id), 'close', e => {
    if (shouldRelockAfterClose({running, locked:isLocked(), blocked:uiBlocked(), returnToPause:!!e.target?.dataset?.fromPause})) requestLock();
  });
  const soundLabel = () => setText('#soundButton', 'Sound: ' + (!sound ? 'off' : options.volume > 0 ? 'on' : 'on (volume is 0%)'));
  setHandler($('#soundButton'), 'onclick', () => { sound = !sound; saveSoundPref(window.localStorage, sound); soundLabel(); oceanAudio?.setVolume(audioVolume()); if (sound) oceanAudio?.resume(); });
  soundLabel();

  // ---------- Networking (PeerJS, host authoritative) ----------
  function listen(target, ev, fn) { target.on(ev, fn); bindings.push([target, ev, fn]); }
  function unlisten(list) { for (const [t, ev, fn] of list) { try { (t.off ?? t.removeListener)?.call(t, ev, fn); } catch {} } }
  function unbindTarget(target) { for (let i = bindings.length - 1; i >= 0; i--) if (bindings[i][0] === target) unlisten(bindings.splice(i, 1)); }
  const setConnectionLabel = s => setText('#connection', s);
  // A guest plays in the host's world with a host-held bag; when they leave, put their own raft, bag and body back.
  function savedOwnRaft() { // no usable backup: never stay in (and later autosave) the host's world
    let w = null;
    try { const raw = localStorage.getItem(SAVE); if (raw) w = cleanWorld(JSON.parse(raw)); } catch {}
    w ??= newWorld(); const bags = bagsFromWorld(w);
    return {world:w, host:bags.host.snapshot(), guest:bags.guest.snapshot(), physics:null};
  }
  function restoreOwnRaft() {
    const newer = storedRev() > saveRev; // another tab (e.g. the host in this browser) saved since we joined: never restore over it
    const b = (newer ? null : normaliseBackup(ownWorldBackup)) ?? savedOwnRaft(); ownWorldBackup = null; remoteBag = null;
    if (newer) { saveRev = storedRev(); saveBlocked = false; }
    hook = null; fishWait = 0; charging = null; reeling = false; lastCaughtCount = 0; pending.clear();
    world = b.world; hostBag = snapBag(b.host) ?? new Bag(); guestBag = snapBag(b.guest) ?? new Bag();
    if (b.physics) physics = new PlayerPhysics(b.physics); else { const s = spawnPoint(0, 1.2); physics = new PlayerPhysics({x:s.x, y:deckY() + EYE_OFFSET, z:s.z}); }
    if (!world.items.length) for (let i = 0; i < 30; i++) world.items.push(makeItem(i));
    if (scene) { syncItems(); rebuildRaft(); }
  }
  function closeConnection() {
    joinTimer = cancelTimer(joinTimer); joinDeadline = 0; networkReady = false; peerHidden = false;
    const oldConn = conn, oldPeer = peer; conn = null; peer = null; other = null;
    unlisten(bindings.splice(0));
    try { oldConn?.close(); } catch {} try { oldPeer?.destroy(); } catch {}
    if (role === 'guest') restoreOwnRaft();
    role = 'solo'; setConnectionLabel('YOUR OWN LITTLE OCEAN'); const rd = $('#roomDisplay'); if (rd) rd.hidden = true;
  }
  function joinTimedOut() {
    joinTimer = 0;
    if (role !== 'guest' || networkReady) return;
    closeConnection();
    setStatus('Connection timed out. Check the room code. Your networks may block direct play.');
  }
  function bindPeer(p, isHost) {
    listen(p, 'open', () => {
      if (peer !== p) return;
      if (isHost) {
        setText('#roomCode', room.toUpperCase()); const rd = $('#roomDisplay'); if (rd) rd.hidden = false;
        if (!conn?.open) setConnectionLabel('ROOM ' + room.toUpperCase());
        setStatus('Room ready. Send this code to your brother.'); start();
      } else if (!conn) bindConn(p.connect('little-raft-' + room, {reliable:true}), false);
    });
    if (isHost) listen(p, 'connection', c => {
      if (peer !== p) return;
      if (conn?.open) { c.on('open', () => c.close()); return; } // room is full
      if (conn && conn !== c) { const old = conn; unbindTarget(old); try { old.close(); } catch {} }
      bindConn(c, true);
    });
    listen(p, 'error', e => {
      if (peer !== p) return;
      const type = e?.type ?? 'error';
      if (isHost && !p.open && !conn) { closeConnection(); setStatus('Could not open room: ' + type + '. Solo play still works.'); }
      else if (!isHost && !networkReady) { closeConnection(); setStatus('Could not connect: ' + type + '. Check the code and host’s tab.'); }
      else setStatus('Connection hiccup: ' + type + '.');
    });
    listen(p, 'disconnected', () => {
      if (peer !== p || p.destroyed) return;
      setStatus('Lost the matchmaking server. Reconnecting…');
      later(() => { if (peer === p && !p.destroyed && p.disconnected) { try { p.reconnect(); } catch {} } }, 1500);
    });
  }
  function bindConn(c, isHost) {
    conn = c;
    listen(c, 'open', () => {
      if (conn !== c) return;
      if (isHost) {
        lastGuestMessage = performance.now(); guestAck = 0; wornCasts.guest = null; peerHidden = false;
        networkReady = true; setStatus('Connected! Your brother is aboard.'); setConnectionLabel(`TWO ABOARD · ${room.toUpperCase()}`);
        $('#crew')?.close(); start(); toast('Your brother joined the raft!'); send(hostState());
      } else setStatus('Connected. Loading your brother’s raft…'); // ready only after the first valid state
    });
    listen(c, 'data', data => {
      if (conn !== c || !data || typeof data !== 'object') return;
      if (data.type === 'hidden' || data.type === 'visible') peerHidden = data.type === 'hidden';
      if (data.type === 'leaving') { if (isHost) { const old = conn; conn = null; unbindTarget(old); old.close(); other = null; networkReady = false; setConnectionLabel('BROTHER LEFT · ROOM OPEN'); } else closeConnection(); toast('Your brother left the raft.'); return; }
      if (isHost) {
        lastGuestMessage = performance.now();
        if (data.type === 'action' && data.a && typeof data.a === 'object') { applyAction(data.a, 'guest'); if (isInt(data.a.seq) && data.a.seq > guestAck) guestAck = data.a.seq; }
        if (data.type === 'move') { other = validPose(data.me) ?? other; guestHeld.note(cleanHeldTokens(data.held), performance.now()); }
        return;
      }
      if (data.type === 'ping' || data.type === 'hidden' || data.type === 'visible') { lastHostMessage = performance.now(); return; }
      if (data.type === 'state') {
        lastHostMessage = performance.now();
        const w = cleanWorld(data.world, true); if (!w) return;
        const first = !networkReady;
        const changed = first || JSON.stringify([world.tiles, world.decor]) !== JSON.stringify([w.tiles, w.decor]);
        world = w; other = validPose(data.other);
        if (data.bag) { // canonical bag once the host has applied all of our sent actions
          const acked = first || !isInt(data.ack) || data.ack >= seq || performance.now() - lastSeqSent > ACK_TIMEOUT;
          if (acked) { const b = snapBag(data.bag); if (b) remoteBag = b; }
          remoteBag ??= new Bag(); // never fall back to showing our own raft's bag while aboard
        } else { // older host without personal bags: mirror its shared stock
          const b = Bag.fromCounts(w.stock, {tools:['hook', 'hammer', 'fishingrod']}); if (remoteBag) b.select(remoteBag.selectedIndex); remoteBag = b;
        }
        syncItems(); if (changed && scene) rebuildRaft();
        if (first) {
          networkReady = true; joinTimer = cancelTimer(joinTimer); joinDeadline = 0;
          setStatus('Connected! You are aboard your brother’s raft.'); setConnectionLabel(`TWO ABOARD · ${room.toUpperCase()}`);
          const s = spawnPoint(1.2, 0); physics = new PlayerPhysics({x:s.x, y:deckY() + EYE_OFFSET, z:s.z});
          $('#crew')?.close(); start(); toast('You joined your brother’s raft!');
        }
      }
      if (data.type === 'effect') effect(data.e);
    });
    listen(c, 'close', () => {
      if (conn !== c) return;
      unbindTarget(c); conn = null; networkReady = false; other = null; peerHidden = false;
      if (isHost) { setConnectionLabel('BROTHER LEFT · ROOM OPEN'); toast('Your brother left. Your raft is still here.'); return; }
      joinTimer = cancelTimer(joinTimer); joinDeadline = 0;
      const p = peer; peer = null; unlisten(bindings.splice(0)); try { p?.destroy(); } catch {}
      restoreOwnRaft(); role = 'solo'; setConnectionLabel('DISCONNECTED');
      setStatus('Host disconnected. Rejoin when their tab is open.'); toast('Host disconnected. You are back on your own raft.');
    });
    listen(c, 'error', () => { if (conn === c) setStatus('Connection failed. Check the code and try again.'); });
  }
  setHandler($('#host'), 'onclick', () => {
    if (role === 'host' && peer && !peer.destroyed) { setStatus('Your room is open. Share the code below.'); return; }
    closeConnection();
    if (typeof globalThis.Peer !== 'function') { setStatus('Online play is unavailable. Solo play still works.'); return; }
    role = 'host'; room = Array.from(crypto.getRandomValues(new Uint8Array(6)), v => 'abcdefghjkmnpqrstuvwxyz'[v % 22]).join('');
    setStatus('Opening your room…');
    try { peer = new globalThis.Peer('little-raft-' + room); bindPeer(peer, true); }
    catch { closeConnection(); setStatus('Online play is unavailable. Solo play still works.'); }
  });
  setHandler($('#joinForm'), 'onsubmit', e => {
    e.preventDefault(); const code = ($('#roomInput')?.value ?? '').trim().toLowerCase();
    if (!/^[a-z]{6}$/.test(code)) return setStatus('Enter the six letters from your brother’s screen.');
    closeConnection();
    if (typeof globalThis.Peer !== 'function') { setStatus('Online play is unavailable. Try solo for now.'); return; }
    if (storedRev() <= saveRev) save(); // role is still solo here: persist our own raft, unless another tab saved newer
    ownWorldBackup = {world, host:hostBag.snapshot(), guest:guestBag.snapshot(), physics:physics.capture()};
    role = 'guest'; room = code; hook = null; fishWait = 0; charging = null; reeling = false; remoteBag = null; seq = 0; lastSeqSent = 0;
    setStatus('Finding your brother’s raft…');
    try {
      peer = new globalThis.Peer(); bindPeer(peer, false);
      joinDeadline = performance.now() + JOIN_TIMEOUT; joinTimer = later(joinTimedOut, JOIN_TIMEOUT); // stays until the first state
    } catch { closeConnection(); setStatus('Online play is unavailable. Try solo for now.'); }
  });
  setHandler($('#copyRoom'), 'onclick', async () => { try { await navigator.clipboard.writeText(room.toUpperCase()); setStatus('Code copied. Send it to your brother!'); } catch { setStatus('Select the room code and copy it manually.'); } });

  // Adopt the live PeerJS objects from the previous engine: attach our exact listeners. No reconnect.
  if (X) {
    // Old listeners remain until the successful swap calls old.dispose().
    if (peer && !peer.destroyed) {
      bindPeer(peer, role === 'host');
      if (peer.disconnected) { const p = peer; later(() => { if (peer === p && !p.destroyed && p.disconnected) { try { p.reconnect(); } catch {} } }, 1500); } // old engine's retry timer is disposed
    } else if (peer?.destroyed) peer = null;
    if (conn) bindConn(conn, role === 'host');
    if (role === 'guest' && !networkReady) {
      if (!peer && !conn) { role = 'guest'; closeConnection(); }
      else { const left = joinDeadline ? joinDeadline - performance.now() : JOIN_TIMEOUT; if (!joinDeadline) joinDeadline = performance.now() + left; joinTimer = later(joinTimedOut, Math.max(0, left)); }
    }
  }

  // ---------- Read-only diagnostics (no mutating hooks) ----------
  function project(x, y, z) {
    if (!camera) return null;
    camera.updateMatrixWorld();
    const v = new T.Vector3(+x, +y, +z), inFront = v.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
    v.project(camera); const r = canvas.getBoundingClientRect();
    return {x:r.left + (v.x + 1) / 2 * r.width, y:r.top + (1 - v.y) / 2 * r.height, visible:inFront && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1};
  }
  const worldPos = o => { if (!o) return null; const p = o.getWorldPosition(new T.Vector3()); return {x:p.x, y:p.y, z:p.z, visible:o.visible}; };
  const debugApi = Object.freeze({
    get state() {
      const hc = castOut(), bag = localBag(), counts = bag.counts(), kind = heldKind();
      const mode = kind === 'hammer' ? 'build' : kind === 'fishingrod' ? 'fish' : kind === 'hook' ? 'hook' : DECOR_TYPES.includes(kind) ? 'place' : 'none';
      return {
        running, tool:mode, recipe:kind === 'hammer' ? 'floor' : DECOR_TYPES.includes(kind) ? kind : null, role, networkReady, pointerLocked:isLocked(), lockSupported, lockFallback, active, disposed,
        tiles:world.tiles.length, tileList:world.tiles.map(t => [...t]), decor:world.decor.map(d => ({...d})),
        stock:counts, fish:world.fish, collected:world.collected, items:world.items.length,
        inventory:bag.snapshot(), selectedItem:bag.selected, selectedIndex:bag.selectedIndex, heldKind:kind,
        ownedTools:['hook', 'hammer', 'fishingrod'].filter(k => counts[k] > 0), inventoryOpen:!!survivalUI?.isOpen,
        physics:physics.capture(), grounded:physics.grounded, swimming:physics.swimming,
        hook:hook ? (hook.fishing ? {fishing:true, id:null, t:hook.t, duration:hook.duration} : {fishing:false, id:hc.caught?.id ?? null, stage:hc.stage, x:hc.position.x, y:hc.position.y, z:hc.position.z, tension:hc.tension, distance:hc.distance, caughtCount:caughtList(hc).length}) : null,
        fishWait, hookStage:hook ? (hook.fishing ? 'fishing' : hook.stage) : 'idle', hookCaught:hc?.caught ? {...hc.caught} : null, hookCaughtItems:caughtList(hc).map(c => ({...c})),
        hookHealth:hookDurability(bag), hookRange:16 + hookDurability(bag) * .16, charge:chargeValue(), charging:!!charging, reeling,
        build:{active:mode === 'build' || mode === 'place', recipe:kind, hover:hover ? {...hover} : null, candidates:scene ? placementCandidates(kind).length : 0, affordable:mode === 'build' ? canAfford(bag, FLOOR_COST) : mode === 'place'},
        pickup:pickTarget ? {id:pickTarget.id, token:pickTarget.token, type:pickTarget.type} : null,
        me:{x:physics.x, y:physics.y, z:physics.z, yaw, pitch}, other:other ? {...other} : null,
        avatars:{local:worldPos(player), remote:worldPos(friend)},
        camera:camera ? {x:camera.position.x, y:camera.position.y, z:camera.position.z, yaw, pitch, roll:camera.rotation.z, fov:camera.fov} : null,
        raft:raft ? {y:raft.position.y, pitch:raft.rotation.x, roll:raft.rotation.z} : null,
        hand:{x:handPos.x, y:handPos.y, z:handPos.z}, hover:hover ? {...hover} : null,
      };
    },
    project,
    get targets() {
      return world.items.map(it => {
        const m = itemMeshes.get(it.token), p = m ? m.position : {x:it.x, y:ITEM_FLOAT, z:it.z};
        return {id:it.id, token:it.token, type:it.type, x:p.x, y:p.y, z:p.z, distance:Math.hypot(it.x - physics.x, it.z - physics.z), pending:isPending(it), screen:project(p.x, p.y, p.z)};
      });
    },
    get placements() {
      if (!raft) return [];
      const y = raft.position.y + .22;
      return placementCandidates(heldKind()).map(({x, z}) => ({x, z, world:{x:x * 2, y, z:z * 2}, screen:project(x * 2, y, z * 2)}));
    },
  });
  const previousDebug = Object.getOwnPropertyDescriptor(window, 'raftDebug'); // restored if this mount fails
  // Desktop shell hook (desktop/main.cjs). panelOpen() lets the shell swallow Escape while a game panel is open;
  // escape() then closes the top panel and relocks, run via executeJavaScript(code, true) so it carries a gesture.
  const shellApi = {
    panelOpen:() => !disposed && !!(survivalUI?.isOpen || dialogOpen()),
    // held=true: the shell swallowed the Escape keydown and calls released() on its keyup (relock happens then).
    escape:guard((held = false) => {
      if (disposed) return false;
      if (held) { escHeld = true; relockOnEscUp = false; }
      if (survivalUI?.isOpen) { survivalUI.close(); return true; }
      if (settingsController?.isOpen) { settingsController.close(); return true; } // close(true) resumes and relocks
      const d = [...document.querySelectorAll('dialog[open]')].pop();
      if (!d) { if (running && settingsController) { settingsController.open(); return true; } return false; } // stale shell state: plain pause
      d.close(); // crew/help: back to the pause menu or to locked play (close listeners)
      if (!uiBlocked()) requestLock();
      return true;
    }),
    released:guard(() => escReleased()),
  };
  window.raftShell = shellApi;
  window.raftDebug = debugApi;

  // ---------- Lifecycle ----------
  function capture() {
    if (role !== 'guest') syncWorldInventories();
    return {
      version:3, world, bags:{host:hostBag.snapshot(), guest:guestBag.snapshot(), remote:remoteBag ? remoteBag.snapshot() : null},
      physics:physics.capture(), me:{x:physics.x, y:physics.y, z:physics.z}, other:other ? {...other} : null, yaw, pitch, running, elapsed, walkPhase,
      hook, castId, hookSlot, lastCaughtCount, fishWait, sound, audio:oceanAudio?.context ?? audio, hintsDone, peer, conn, role, networkReady, room, ownWorldBackup, pending:new Map(pending),
      wornCasts:{...wornCasts}, seq, lastSeqSent, guestAck,
      joinDeadline:joinTimer ? joinDeadline : 0, saveAvailable, lockFallback, keys:{...keys},
      charging:charging ? {...charging} : null, reeling, down:down ? {...down} : null,
      bindings:bindings.slice(), renderer, lastHostMessage, lastGuestMessage, peerHidden, saveRev, saveBlocked,
      raftPose:raft ? {y:raft.position.y, rx:raft.rotation.x, rz:raft.rotation.z} : {...raftPose},
    };
  }
  function pause() { active = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
  function resume() {
    if (disposed || active || !scene) return;
    active = true; last = performance.now(); rafId = requestAnimationFrame(animate);
  }
  function disposeScene() {
    if (!scene) return;
    const mats = new Set(), geos = new Set();
    scene.traverse(o => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) for (const m of [].concat(o.material)) mats.add(m);
      if (o.isLight && o.shadow?.dispose) o.shadow.dispose();
    });
    for (const m of materialCache.values()) mats.add(m);
    if (clothMat) mats.add(clothMat);
    for (const g of geos) { try { g.dispose(); } catch {} }
    for (const m of mats) { try { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); } catch {} }
    try { ocean?.dispose(); } catch {}
    materialCache.clear(); itemMeshes.clear(); scene.clear();
    scene = null; // renderer, canvas, AudioContext, peer and conn are left untouched
  }
  function dispose() {
    if (disposed) return;
    pause(); disposed = true; ac.abort();
    try { settingsController?.destroy(); } catch {}
    try { survivalUI?.destroy?.(); } catch {}
    try { oceanAudio?.destroy(); } catch {}
    for (const id of timers) clearTimeout(id); timers.clear(); clearInterval(heartbeat);
    unlisten(bindings.splice(0));
    try { if (window.raftDebug === debugApi) delete window.raftDebug; } catch {}
    try { if (window.raftShell === shellApi) delete window.raftShell; } catch {}
    disposeScene();
  }

  const optionsDialog = document.getElementById('options'), previousSettingsOwner = optionsDialog?.dataset.owner;
  try {
    if (!canvas) throw new Error('#world canvas missing');
    init();
    settingsController = createSettings({onChange:next => { options = next; oceanAudio?.setVolume(audioVolume()); soundLabel(); if (renderer) { renderer.setPixelRatio(Math.min(devicePixelRatio, next.graphics === 'high' ? 1.7 : next.graphics === 'low' ? 1 : 1.3)); renderer.shadowMap.enabled = next.graphics !== 'low'; } }, onPause:clearInput, onResume:() => requestLock()});
    oceanAudio = createOceanAudio({context:audio, volume:audioVolume()});
    if (audio && audio.state === 'running') oceanAudio.resume(); // hot reload: context already unlocked
    const wakeAudio = () => { if (sound && !disposed) oceanAudio?.resume(); }; // browsers need a user gesture first
    for (const t of ['pointerdown', 'keydown']) on(window, t, wakeAudio, {capture:true});
    survivalUI = createSurvivalUI({
      getBag:() => localBag(),
      onSelect:guard(i => selectSlot(i)),
      onMove:guard((from, to, amount) => moveSlot(from, to, amount)),
      onCraft:guard(id => craft(id)),
      onResume:guard(() => requestLock()),
      onPause:guard(clearInput),
      iconFor:kind => itemIcons.get(kind),
    });
    later(() => { try { itemIcons.prime(); } catch (e) { console.warn('item icons', e); } }, 1500); // render 3D recipe icons off the first-open path
    if (running) { const w = $('#welcome'); if (w) w.hidden = true; const h = $('#hud'); if (h) h.hidden = false; }
    if ($('#toast')?.classList.contains('show')) toastTimer = later(() => { toastTimer = 0; $('#toast')?.classList.remove('show'); }, 2600);
    active = true; last = performance.now(); rafId = requestAnimationFrame(animate);
  } catch (e) {
    console.error(e); dispose();
    try { if (previousDebug && !Object.getOwnPropertyDescriptor(window, 'raftDebug')) Object.defineProperty(window, 'raftDebug', previousDebug); } catch {}
    for (const [el, prop, previous, next] of propertyHandlers) if (el[prop] === next) el[prop] = previous;
    const od = document.getElementById('options'); if (od && previousSettingsOwner !== undefined) od.dataset.owner = previousSettingsOwner; // hand Escape back to the old engine's settings
    setText('#loadError', 'The 3D ocean could not start. Try a current Chrome, Edge, or Safari browser with WebGL enabled.');
    if (!X) { const solo = $('#solo'); if (solo) solo.disabled = true; }
    throw e;
  }

  return {capture, pause, resume, dispose};
}

export default mount;
