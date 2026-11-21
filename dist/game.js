import * as T from './vendor/three.module.js';
import { createAvatar } from './avatar.js?build=v3-survival-ae77fa84ac2b';
import { createOceanAudio } from './audio.js?build=v3-survival-ae77fa84ac2b';
import { createSky } from './sky.js?build=v3-survival-ae77fa84ac2b';
import { createOcean } from './ocean.js?build=v3-survival-ae77fa84ac2b';
import { createHook } from './hook.js?build=v3-survival-ae77fa84ac2b';
import { createWoodMaterial } from './wood.js?build=v3-survival-ae77fa84ac2b';
import { HookCast, WATER_Y, catchLoot, holdForFullBag, throwOrigin } from './hook-physics.js?build=v3-survival-ae77fa84ac2b';
import { createSettings, SETTINGS_DEFAULTS } from './settings.js?build=v3-survival-ae77fa84ac2b';
import { createRaftMesh, createFloor } from './deck.js?build=v3-survival-ae77fa84ac2b';
import { createDebris, createItemBatch } from './debris.js?build=v3-survival-ae77fa84ac2b';
import { createHands, isPlaceable } from './hands.js?build=v3-survival-ae77fa84ac2b';
import { createCraft } from './crafts.js?build=v3-survival-ae77fa84ac2b';
import { Bag, ITEM_INFO, RECIPES } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { PlayerPhysics, PLAYER_CONSTANTS } from './player-physics.js?build=v3-survival-ae77fa84ac2b';
import { floorBlock, decorBlock, inReach, BUILD_REACH, GUEST_REACH_SLACK, BLOCK_TEXT } from './build-rules.js?build=v3-survival-ae77fa84ac2b';
import { createHammer } from './hammer.js?build=v3-survival-ae77fa84ac2b';
import { createFishingTool } from './fishing-tool.js?build=v3-survival-ae77fa84ac2b';
import { createContent, cleanExt, promptParts } from './content.js?build=v3-survival-ae77fa84ac2b'; // content hook (islands, wildlife, storage, day/night)
import { CONTENT_DECOR, CONTENT_BLOCK_RADIUS } from './content-items.js?build=v3-survival-ae77fa84ac2b'; // content hook
import { createBuilding, cleanPieces } from './building.js?build=v3-survival-ae77fa84ac2b'; // building-pieces lane hook (docs/cloud/building-pieces.md)
import { PIECES, PIECE_ORDER } from './building-pieces.js?build=v3-survival-ae77fa84ac2b'; // controls lane: pad build radial lists the hammer's pieces
import { createControls } from './controls.js?build=v3-survival-ae77fa84ac2b'; // controls lane: input map, gamepad, movement feel (docs/cloud/controls.md)
import { createSailing } from './sailing-world.js?build=v3-survival-ae77fa84ac2b'; // [sailing] see docs/cloud/sailing.md
import { cleanSailing } from './sailing-core.js?build=v3-survival-ae77fa84ac2b'; // [sailing]
import { createCoop } from './coop.js?build=v3-survival-ae77fa84ac2b'; // coop: co-op layer (docs/cloud/coop.md)
import { createDiving, DIVE } from './diving.js?build=v3-survival-ae77fa84ac2b'; // diving lane hook (docs/cloud/diving.md)
import { nodeById, NODE_LOOT } from './seafloor.js?build=v3-survival-ae77fa84ac2b'; // diving lane hook
import { createFishingCooking } from './fishing-cooking.js?build=v3-survival-ae77fa84ac2b'; // [fishing-cooking] lane hook, see docs/cloud/fishing-cooking.md
import { createInstruments } from './instruments.js?build=v3-survival-ae77fa84ac2b'; // [instruments] held drum / pipes / bells (docs/specs/instruments.md)
import { cleanProgress, nextNote, shouldSpawnBottle, evaluate, achievementName, NOTE_COUNT } from './logbook.js?build=v3-survival-ae77fa84ac2b';
import { createLogbookUI } from './logbook-ui.js?build=v3-survival-ae77fa84ac2b';
import { loadLook, saveLook, lookColors, noteAchievements, HATS as LOOK_HATS } from './look.js?build=v3-survival-ae77fa84ac2b'; // [look] character customisation (docs/specs/customise.md)
import { createLookUI } from './look-ui.js?build=v3-survival-ae77fa84ac2b'; // [look]
import { createBottle } from './bottle.js?build=v3-survival-ae77fa84ac2b';
import { cleanSignal, countAntennas, signalTick, onCacheCollected, cacheLoot, signalReadout, edgePoint } from './signal.js?build=v3-survival-ae77fa84ac2b';
import { createSignalModel } from './signal-models.js?build=v3-survival-ae77fa84ac2b';
import { cleanWatering, copyWatering, plantStage, tick as tickWatering, tileKey, fillCup, loadPurifier, takeWater, water as waterPlant, harvest as harvestPlant, fuelPurifier, purifierFuel, clockText, FUEL_CAP, WATER_ACTIONS, FILL_REACH, USE_REACH, HOST_SLACK, PURIFY_SECONDS } from './watering.js?build=v3-survival-ae77fa84ac2b';
import { createPurifier, paintPurifier, preparePlanter, paintPlanter } from './purifier-model.js?build=v3-survival-ae77fa84ac2b';
import { cleanRain, copyRain, tickRain, takeRain, fillSprinkler, rainTarget, RAIN_ACTIONS } from './rain.js?build=v3-survival-ae77fa84ac2b'; import { createRainBarrel, paintRainBarrel, createSprinkler, paintSprinkler } from './rain-model.js?build=v3-survival-ae77fa84ac2b'; // rain-sprinkler (docs/specs/rain-sprinkler.md)
import { lootFits, pickNetItem, createGuestHeld, cleanHeldTokens, hookableItems, decorBlockers, playerInWay, repairHookSlot } from './coop-rules.js?build=v3-survival-ae77fa84ac2b';
import { PROTOCOL, HEARTBEAT_MS, peerStale, wallTick, saveRevision, planSave, storageBlocks, adoptOnStart, newGameBaseRev, titleSaveNote, restoreGlobal, guestLeavePlan, LIVE_STATUS_EVENT } from './session-rules.js?build=v3-survival-ae77fa84ac2b';
export { PROTOCOL }; // live.js reads the running engine's protocol from here
import { releaseShouldFire, castInput, castPrompt } from './fishing-rules.js?build=v3-survival-ae77fa84ac2b';
import { createQuality } from './quality.js?build=v3-survival-ae77fa84ac2b';
const PIN_QUALITY = /[?&]pinQuality\b/.test(globalThis.location?.search || ''); // perf probes hold quality at the preset's top level
import { ITEMS as PROG_ITEMS, PLACEABLE_IDS, BLOCK_RADII, rollBarrel, wearPerUse, toolRole, repairCost, migrateSnapshot } from './items.js?build=v3-survival-ae77fa84ac2b'; // [progression-hook]
import { attachProgression } from './progression-hooks.js?build=v3-survival-ae77fa84ac2b'; // [progression-hook]
import { attachSpearRepair } from './spear-repair-hooks.js?build=v3-survival-ae77fa84ac2b'; // [spear-repair]
import { attachPaddle } from './paddle.js?build=v3-survival-ae77fa84ac2b'; // [paddle] LMB at the raft edge sends the 'paddle' sail op
import { DEBRIS, debrisSpeed, stepDebrisBudget, spendDebris } from './debris-budget.js?build=v3-survival-ae77fa84ac2b'; // [debris-budget] flotsam follows raft motion
import { newVitals, tickVitals, damage as damageVitals, consume as consumeVitals, cleanVitals, saveVitals, isEdible, isDrink /* [juicer] */, eatLabel, FOOD, SPRINT_MULT, EAT_SECONDS, RESPAWN } from './vitals.js?build=v3-survival-ae77fa84ac2b'; // [vitals] hunger, thirst, health
import { createVitalsUI } from './vitals-ui.js?build=v3-survival-ae77fa84ac2b'; // [vitals] HUD bars, damage vignette, faint overlay
import { setOwnedElsewhere } from './storage-research.js?build=v3-survival-ae77fa84ac2b'; // [progression-hook] content Research Table teaches only non-catalogue recipes
import * as ART from './materials.js?build=v3-survival-ae77fa84ac2b'; // art lane hook (docs/cloud/art.md), active only with ?art
import { createPlastic } from './plastic.js?build=v3-survival-ae77fa84ac2b';
import { createSurvivalUI, iconSVG } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
import { pickupFeed } from './pickup-feed.js?build=v3-survival-ae77fa84ac2b';
import { createGhosts, wrapRot, wheelDelta, ROT_STEP, FINE_STEP } from './placement.js?build=v3-survival-ae77fa84ac2b'; // ghost preview + decor rotation (tile grid stays in build-rules.js)
import { getModel } from './models.js?build=v3-survival-ae77fa84ac2b';
import { iconURL, onIconReady, setIconRenderer } from './item-icons.js?build=v3-survival-ae77fa84ac2b';
import { loadSoundPref, saveSoundPref, dragLookScale, loadHints, saveHints, nextHint, resetHints, feedPlacement, hintsFromState } from './hud.js?build=v3-survival-ae77fa84ac2b'; // loop-ux: saved sound toggle, drag-look sensitivity, first-run hints
import { lockFailureVerdict, shouldRequestLock, shouldRelockAfterClose, escReleasePlan, dragLook } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';
import { keyDecision, createLookFilter, splitSteps, wheelForGame } from './input-rules.js?build=v3-survival-ae77fa84ac2b';
import { createShark, cleanShark, cleanTileHp, lootable, SHARK, SHARK_LOOT } from './shark.js?build=v3-survival-ae77fa84ac2b'; // shark lane (dist/shark.js)
import { createWaterEffects } from './waterfx.js?build=v3-survival-ae77fa84ac2b'; // shark lane: bite splashes
import { createIsland } from './scenery-islands.js?build=v3-survival-ae77fa84ac2b'; // decorative distant islands (islands.js is the content lane's dockable islands)

// Module entry has no side effects beyond the imports above. Call mount(transfer) to run the game.
// mount() returns {capture, pause, resume, dispose}; capture() output can be passed to a new mount().
//
// Ownership: every player owns a Bag (personal inventory). The raft, decor, floating debris and
// fish counter are shared. The host is authoritative: it keeps hostBag (its own) and guestBag
// (the brother's, persisted in the save) and applies every action against the actor's bag.

// ---------- Immutable configuration ----------
const DECOR_TYPES = Object.freeze([...new Set(['sail', 'palm', 'lantern', 'net', 'bench', 'crate', 'receiver', 'antenna', 'purifier', 'rainbarrel', 'sprinkler', ...CONTENT_DECOR, ...PLACEABLE_IDS])]); // [progression-hook] + PLACEABLE_IDS; // content hook: + CONTENT_DECOR // placeable bag items
const ITEM_TYPES = Object.freeze(['wood', 'leaf', 'scrap', 'barrel', 'plastic', 'cache']); // floating debris kinds ('cache' = signal cache, never spawned by SPAWN_TABLE)
const ITEM_NAMES = Object.freeze({wood:'plank', leaf:'bundle of leaves', scrap:'piece of scrap', barrel:'barrel', plastic:'plastic jug', cache:'signal cache', bottle:'message in a bottle'});
const SPAWN_TABLE = Object.freeze(['wood', 'wood', 'wood', 'plastic', 'plastic', 'plastic', 'leaf', 'leaf', 'leaf', 'scrap', 'barrel']);
const LOOT = Object.freeze({wood:{wood:2}, leaf:{leaf:1}, scrap:{scrap:1}, plastic:{plastic:1}, barrel:{wood:3, leaf:2, scrap:1, plastic:1}, cache:{wood:6, plastic:4, scrap:3, rope:2}});
const STOCK_KEYS = Object.freeze(['wood', 'leaf', 'scrap', 'plastic']); // legacy world.stock (derived)
const START_TILES = 9; // newWorld() raft size (3x3); more tiles means the player has built a floor
const FLOOR_COST = Object.freeze({wood:2, plastic:2});
const REPAIR_COST = Object.freeze({wood:2, scrap:1});
const BLOCK_RADIUS = Object.freeze({palm:.42, crate:.55, bench:.45, sail:.14, lantern:.12, receiver:.35, antenna:.1, purifier:.3, rainbarrel:.3, sprinkler:.12, ...CONTENT_BLOCK_RADIUS, ...BLOCK_RADII}); // content hook, [progression-hook]
const SAVE = 'little-raft-v1';
const SAVE_STATUS = "Solo and hosted rafts save automatically. Joining uses the host's world."; // #saveStatus default
const THROW_LOFT = .12, FLOOR_Y = .2, EYE_OFFSET = 1.6, HOTBAR = 10, PICKUP_REACH = 2.5;
const LOOK_SENSITIVITY = .0022, DRAG_SENSITIVITY = .005, PITCH_LIMIT = 1.35;
const FISH_REACH = 26, PENDING_MS = 2500, JOIN_TIMEOUT = 15000, ACK_TIMEOUT = 2000;
const CHARGE_MS = 900, MIN_CHARGE = .15, WEAR_PER_CATCH = 2, MAX_HEALTH = 100;
const ROPE_SEGMENTS = 16, ITEM_FLOAT = .05, CAMERA_ROLL = .2;
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SUN_OFFSET = Object.freeze([-15, 28, 12]), SHADOW_MARGIN = 4, SHADOW_MIN = 8, SHADOW_MAX = 25; // sun light offset from its target; shadow box half-size limits (m)
const TIMBER = new Set(['#bb8a53','#c69860','#ad7c4a','#5e4029','#9c7649', '#c8995f', '#d3a368', '#8c6745', '#d5a265', '#a97d4c', '#b4824b', '#906f48', '#725942', '#756a49', '#ad8153']);
const STYLE_ID = 'little-raft-engine-style';
const HUD_CSS = `
body.playing header,body.playing #hud .inventory,body.playing #hud .goal,body.playing #toast,
body.playing #hud .controls,body.playing #recipes,body.playing #aimHint,body.playing [data-quick-recipe]{display:none!important}
#contextPrompt{position:fixed;left:50%;bottom:132px;transform:translateX(-50%);padding:3px 10px;border-radius:8px;
  background:rgba(8,22,36,.55);color:#f6ecd6;font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;pointer-events:none;z-index:30;white-space:nowrap}
#contextPrompt[hidden]{display:none}
#contextPrompt kbd{display:inline-block;min-width:1.4em;margin-right:6px;padding:0 4px;border:1px solid rgba(246,236,214,.6);border-radius:4px;font:inherit;text-align:center}
/* The pickup feed is a manual popover so notices stay visible above the open bag or pause menu; it keeps style.css's place. */
#pickupFeed[popover]{top:auto;right:auto;margin:0;padding:0;border:0;background:none;overflow:visible;width:auto;height:auto;max-width:none;max-height:none;color:#f6ecd6}
#pickupFeed .pf-hint{white-space:normal;max-width:max(180px,min(340px,calc(50vw - 300px)));line-height:1.3}#pickupFeed .pf-hint span{color:#ffd98f}
#signalReadout{position:fixed;top:14px;left:50%;transform:translateX(-50%);padding:4px 12px;border-radius:999px;
  background:rgba(8,22,36,.55);color:#f6ecd6;font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.05em;
  pointer-events:none;z-index:30;white-space:nowrap}
#signalReadout .sig-arrow{display:inline-block;margin-right:6px}
#signalMarker{position:fixed;left:0;top:0;width:14px;height:14px;margin:-9px 0 0 -9px;border-radius:50%;background:#ffbd66;
  border:2px solid #fff3cf;box-shadow:0 0 8px rgba(255,189,102,.7);pointer-events:none;z-index:29}
#signalMarker.edge{opacity:.7}
#signalReadout[hidden],#signalMarker[hidden]{display:none}
/* Rows wrap inside the gutter left of the hotbar (its left edge is 50vw - 253px); below 1000px wide that gutter is too narrow, so the feed lifts above the hotbar. */
#pickupFeed .pf-row{max-width:max(200px,calc(50vw - 287px));white-space:normal;line-height:1.25}
@media(max-width:1000px){#pickupFeed[popover]{inset:auto auto calc(182px + var(--coop-feed-h, 0px)) 10px}#pickupFeed .pf-row{max-width:calc(50vw - 120px)}}
.feed-lane{display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden;pointer-events:none;-webkit-mask-image:linear-gradient(transparent,#000 22px);mask-image:linear-gradient(transparent,#000 22px)}
#inventory .sv-bag>.feed-lane{flex:1 1 0;min-height:88px;align-self:stretch}
/* Pause rail: the lane fills the space under "Esc Back"; an equal spacer on top keeps the menu centred. */
#options .rs-menu::before,#options .rs-menu>.feed-lane{content:"";flex:1 1 0;min-height:0;margin:0;padding:0}
#options .rs-menu>.feed-lane{margin-top:18px;padding:0 16px 16px 0}#options .rs-menu::before{margin-bottom:18px;padding-bottom:16px}
#pickupFeed.docked{position:static;inset:auto;z-index:auto;max-width:100%}
#pickupFeed.docked .pf-row{max-width:100%;white-space:normal;line-height:1.25}
@media(max-width:760px){#contextPrompt{bottom:96px}#pickupFeed[popover]{inset:auto auto calc(232px + var(--coop-feed-h, 0px)) 10px}#options .rs-menu::before,#options .rs-menu>.feed-lane{display:none}}
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
  const engineStack = k => (Object.prototype.hasOwnProperty.call(ITEM_INFO, k) ? ITEM_INFO[k].maxStack : 0); // keeps cups/purifier (outside items.js) across reloads
  const snapBag = s => { if (!s || typeof s !== 'object') return null; let m = s; try { m = migrateSnapshot(s, engineStack) ?? s; } catch {} try { return new Bag(m); } catch { return Bag.salvage(m); } }; // [progression-hook] migrate (engine kinds kept); one bad slot never wipes a bag
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
    if (isInt(prefer) && toolRole(bag.slots[prefer]?.kind) === 'hook') return prefer; // [progression-hook]
    if (toolRole(bag.slots[bag.selectedIndex]?.kind) === 'hook') return bag.selectedIndex; // [progression-hook]
    return bag.slots.findIndex(s => toolRole(s?.kind) === 'hook'); // [progression-hook]
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
    return {tiles:Array.from({length:9}, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]), decor:[], stock:{wood:0, leaf:0, scrap:0, plastic:0}, fish:0, collected:0, hookHealth:MAX_HEALTH, items:[], hostInventory:fresh, guestInventory:new Bag().snapshot(), signal:null, notes:[], achievements:[], garden:{}, purifiers:{}, collectors:{}, sprinklers:{}, pieces:[], tileHp:{}, shark:cleanShark(null)};
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
      const rot = Number.isFinite(d.rot) ? Math.round(wrapRot(d.rot) * 1000) / 1000 : 0; // placement rotation (R / shift+wheel while placing)
      used.add(k); decor.push(rot ? {type:d.type, x:d.x, z:d.z, rot} : {type:d.type, x:d.x, z:d.z});
    }
    const count = n => (isInt(n) && n >= 0 ? n : 0);
    const items = [];
    if (withItems && Array.isArray(v.items)) for (const it of v.items.slice(0, 80)) {
      if (it && isInt(it.id) && typeof it.token === 'string' && it.token.length < 80 && (ITEM_TYPES.includes(it.type) || it.type === 'bottle') && Number.isFinite(it.x) && Number.isFinite(it.z) && Math.abs(it.x) < 80 && Math.abs(it.z) < 80)
        items.push({id:it.id, token:it.token, type:it.type, x:it.x, z:it.z, phase:Number.isFinite(it.phase) ? it.phase : 0});
    }
    const progress = cleanProgress(v);
    return {tiles, decor, stock, fish:count(v.fish), collected:count(v.collected), hookHealth:Number.isFinite(v.hookHealth) ? clamp(Math.round(v.hookHealth), 0, MAX_HEALTH) : MAX_HEALTH, items,
      hostInventory:validSnapshot(v.hostInventory), guestInventory:validSnapshot(v.guestInventory), signal:cleanSignal(v.signal), ext:cleanExt(v.ext), pieces:cleanPieces(v.pieces, tiles), sailing:cleanSailing(v.sailing), // content + building-pieces + sailing hooks
      notes:progress.notes, achievements:progress.achievements, vitals:v.vitals ? cleanVitals(v.vitals) : null, // [vitals] old saves: null -> start full
      tileHp:cleanTileHp(v.tileHp, tiles), shark:cleanShark(v.shark), // shark lane: foundation HP + saved shark (old saves: full HP, fresh 300 s timer)
      ...cleanWatering(v, decor, {seedMissing:true}), ...cleanRain(v, decor)};
  }
  function copyWorld(w) { // isolation from the previous engine's live object (rollback safety)
    return {...w, tiles:w.tiles.map(t => [t[0], t[1]]), decor:Array.isArray(w.decor) ? w.decor.map(d => ({...d})) : [], items:Array.isArray(w.items) ? w.items.map(i => ({...i})) : [], stock:{...(w.stock || {})}, pieces:Array.isArray(w.pieces) ? w.pieces.map(p => ({...p})) : [],
      fish:isInt(w.fish) ? w.fish : 0, collected:isInt(w.collected) ? w.collected : 0, signal:cleanSignal(w.signal), ext:cleanExt(w.ext), sailing:cleanSailing(w.sailing), // content + sailing hooks
      ...cleanProgress(w), // fresh, validated notes/achievements arrays
      tileHp:cleanTileHp(w.tileHp, w.tiles), shark:cleanShark(w.shark), // shark lane
      ...copyWatering(w), ...copyRain(w)};
  }
  const liveWorld = w => cleanWorld(w, true) ?? copyWorld(w);
  function validPose(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || Math.abs(p.x) >= 120 || Math.abs(p.z) >= 120) return null;
    const y = Number.isFinite(p.y) && p.y >= -16 && p.y <= 30 ? p.y : null; // diving: below the surface
    return {x:p.x, y, z:p.z, yaw:Number.isFinite(p.yaw) ? p.yaw : 0, pitch:Number.isFinite(p.pitch) ? p.pitch : 0, swimming:!!p.swimming, held:typeof p.held === 'string' ? p.held.slice(0, 16) : null};
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
  // [vitals] The local player's own hunger/thirst/health. Solo/host persist it in world.vitals; a guest keeps
  // its own in memory (and in its own save once back home). Never sent over the network.
  const vitals = newVitals(X?.vitals ?? world.vitals);
  let vitalsUI = null, eating = null, fainted = Number.isFinite(X?.fainted) ? X.fainted : -1, exertion = 1; // eating {item, slot, t}; fainted: seconds into the faint, -1 = awake
  const vitalsOpts = {mult:1};
  let building = null, sentPieces = null; // building-pieces lane hook (sentPieces: last pieces array sent to the guest)
  let scene = null, camera = null, renderer = null, quality = null, ocean = null, sky = null, raft, itemsGroup, ghosts, rope, ropeAttr, hookMesh, bobber, friend, player, sun;
  let hemi = null, clouds = [], content = null; // content hook: lights/clouds handed to content modules
  let hands = null, offIconReady = null, clothMat; // one hands controller swaps the held item model per hotbar kind
  const modelOf = k => { try { return getModel(k); } catch (e) { console.warn('model failed', k, e); return null; } };
  let fc = null; // [fishing-cooking] rod fishing v2 + grills + journal (dist/fishing-cooking.js)
  let instruments = null; // [instruments]
  let logbookUI = null;
  let lookUI = null, lookState = loadLook(), seenAch = -1, seenAchList = null; // [look] per-browser look + hat unlocks (never in the world save)
  let survivalUI = null, settingsController = null, options = {...SETTINGS_DEFAULTS};
  let running = !!X?.running;
  let elapsed = Number.isFinite(X?.elapsed) ? X.elapsed : 0, last = performance.now();
  let yaw = Number.isFinite(X?.yaw) ? X.yaw : 0, pitch = Number.isFinite(X?.pitch) ? X.pitch : 0;
  let walking = false, walkPhase = Number.isFinite(X?.walkPhase) ? X.walkPhase : 0, swing = 0;
  const pointer = new T.Vector2(), ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), -.22);
  let ghostHold = null; // just-placed spot: the ghost stays hidden there until the aim moves off it
  let hover = null, mouse = {x:0, y:0, inside:false}, frameAim = null, pickTarget = null;
  const raftPose = {y:X?.raftPose?.y ?? 0, rx:X?.raftPose?.rx ?? 0, rz:X?.raftPose?.rz ?? 0};
  let physics = makePhysics(X);
  let other = X?.other ? validPose(X.other) : null;
  let keys = X?.keys && typeof X.keys === 'object' ? {...X.keys} : {};
  const lookFilter = createLookFilter(); // drops pointer-lock spikes without cutting real flicks short
  let hook = X?.hook && (X.hook.fishing || typeof X.hook.update === 'function') ? X.hook : null;
  let castId = typeof X?.castId === 'string' ? X.castId : newToken();
  let hookSlot = isInt(X?.hookSlot) ? X.hookSlot : -1;
  let fishWait = Number.isFinite(X?.fishWait) ? X.fishWait : 0;
  let sound = X ? X.sound !== false : loadSoundPref(window.localStorage); // loop-ux: sound on/off survives reloads
  const sfx = createOceanAudio({context:X?.audio ?? null, volume:sound ? options.volume : 0, output:ctx => diving?.audioOut(ctx) ?? null}); // diving lane hook: muffled underwater
  const play = (ev, s) => sfx.play(ev, s);
  const note = (i, n, s) => sfx.note?.(i, n, s) ?? false; // [instruments]
  const applyVolume = () => { sfx.setVolume(sound ? options.volume : 0); sfx.setBus('effects', options.effects ?? 1); sfx.setBus('ambience', options.ambience ?? .7); };
  if (X?.audio) sfx.resume(); // hot swap: the old context is already unlocked
  let charging = X?.charging && Number.isFinite(X.charging.start) ? {...X.charging} : null, reeling = !!X?.reeling && !!hook, hookFull = false; // hookFull: the catch will not fit, so the reel stops short
  let lastCaughtCount = isInt(X?.lastCaughtCount) ? X.lastCaughtCount : (hook?.caughtItems?.length ?? (hook?.caught ? 1 : 0));
  const pending = new Map(X?.pending instanceof Map ? X.pending : []); // item token -> expiry; hides supplies we reeled in while the host confirms
  const guestHeld = createGuestHeld(); // host only: tokens on the guest's hook, from its move messages
  let hostHeld = new Set(); // guest only: tokens on the host's hook, from its state messages
  const wornCasts = {host:X?.wornCasts?.host ?? null, guest:X?.wornCasts?.guest ?? null}; // one wear per successful throw
  let seq = isInt(X?.seq) ? X.seq : 0, lastSeqSent = Number.isFinite(X?.lastSeqSent) ? X.lastSeqSent : 0, guestAck = isInt(X?.guestAck) ? X.guestAck : 0;
  let lastHostMessage = X?.lastHostMessage || performance.now(), lastGuestMessage = X?.lastGuestMessage || performance.now();
  let joinTimer = 0, joinDeadline = Number.isFinite(X?.joinDeadline) ? X.joinDeadline : 0;
  let waterClock = 0, waterAim = null; const wateringGroups = new Map(); // tileKey -> palm/purifier group
  let netClock = 0, lastSaveAt = performance.now(), lastNetSendAt = 0, toastTimer = 0, wheelAcc = 0, peerHidden = !!X?.peerHidden, heartbeat = 0;
  let noticeText = '', noticeUntil = 0, noticeCache = null, contextCache = null, uiFailed = false; let fishShown = null;
  const hintsDone = X?.hintsDone instanceof Set ? X.hintsDone : freshSave ? new Set() : loadHints(window.localStorage); // loop-ux: first-run hint chain, once per save
  const bindings = []; // [emitter, event, fn] registered by THIS mount on PeerJS objects
  const lockSupported = !!canvas && typeof canvas.requestPointerLock === 'function';
  let lockFallback = !lockSupported || !!X?.lockFallback, down = X?.down ? {...X.down} : null, uiSignature = -1;
  const chargeMeter = $('#chargeMeter'); // thin ring around the crosshair, filled by --c
  let crossUsable = false, lastDraw = 0;
  let blockList = [];
  let controls = null; // controls lane: set in the Input section
  const debrisBank = {budget:0}; // [debris-budget] whole items allowed to respawn upstream
  let sailing = null; const scenery = [], sailFlow = {x:0, z:0, b:.22}, aimNdc = {x:0, y:0}; // [sailing]
  function getAimNdc() { // [sailing] same aim point as currentAim(): screen centre when locked, else the drag-mode mouse
    if (isLocked()) { aimNdc.x = 0; aimNdc.y = 0; return aimNdc; }
    if (!lockFallback || !mouse.inside) return null;
    const r = canvas.getBoundingClientRect(); aimNdc.x = (mouse.x - r.left) / r.width * 2 - 1; aimNdc.y = -(mouse.y - r.top) / r.height * 2 + 1; return aimNdc;
  }
  let coop = null; // coop: hub from coop.js, created after init(); every use is optional (coop?.)
  let prog = null; // [progression-hook]
  // shark lane (dist/shark.js): host/solo simulate, the guest shows the host's pose. shark.trySpear(origin, dir, reach, dmg) -> boolean
  let shark = null, sharkFx = null, wildlifeMod = null, shakeAmp = 0; const sharkHitAt = {host:0, guest:0};
  let paddle = null; // [paddle] dist/paddle.js glue
  let spearRep = null; // [spear-repair] spear viewmodels/thrust + hammer foundation repair (dist/spear-repair-hooks.js)

  function makePhysics(src) {
    const deck = raftPose.y + FLOOR_Y + EYE_OFFSET;
    const p = src?.physics;
    if (p && [p.x, p.y, p.z].every(Number.isFinite)) return new PlayerPhysics(p);
    if (src?.me && Number.isFinite(src.me.x) && Number.isFinite(src.me.z)) return new PlayerPhysics({x:src.me.x, y:Number.isFinite(src.me.y) ? src.me.y : deck, z:src.me.z});
    const n = world.tiles.length, cx = world.tiles.reduce((a, t) => a + t[0], 0) * 2 / n, cz = world.tiles.reduce((a, t) => a + t[1], 0) * 2 / n;
    const s = spawnPoint(cx, cz + 1); return new PlayerPhysics({x:s.x, y:deck, z:s.z}); // middle of the raft, a step back
  }
  function spawnPoint(x, z) {
    // Runs during state setup too, so it must not use the later-declared helpers.
    if (world.tiles.some(t => Math.abs(x - t[0] * 2) <= 1 && Math.abs(z - t[1] * 2) <= 1)) return {x, z};
    const t = world.tiles.find(t => t[0] === 0 && t[1] === 0) ?? world.tiles[0]; return {x:t[0] * 2, z:t[1] * 2};
  }

  function hasTile(x, z) { const ts = world.tiles; for (let i = 0; i < ts.length; i++) if (ts[i][0] === x && ts[i][1] === z) return true; return false; }
  const isLocked = () => !!canvas && document.pointerLockElement === canvas;
  const dialogOpen = () => !!document.querySelector('dialog[open]');
  const uiBlocked = () => dialogOpen() || !!survivalUI?.isOpen;
  const castOut = () => (hook && !hook.fishing ? hook : null);
  const guestWaiting = () => role === 'guest' && !networkReady;
  const chargeValue = () => (charging ? clamp((performance.now() - charging.start) / CHARGE_MS, MIN_CHARGE, 1) : 0);
  const localBag = () => (role === 'guest' && networkReady && remoteBag ? remoteBag : hostBag);
  const actorBag = actor => (actor === 'guest' ? guestBag : hostBag);
  const selectedKind = () => toolRole(localBag().slots[localBag().selectedIndex]?.kind ?? null); // [progression-hook] metalhook acts as 'hook'
  const heldKind = () => (hook?.fishing ? 'fishingrod' : hook ? 'hook' : selectedKind());
  const caughtList = h => (Array.isArray(h?.caughtItems) ? h.caughtItems : h?.caught ? [h.caught] : []);
  const deckY = () => (raft ? raft.position.y : raftPose.y) + FLOOR_Y;
  const heldSet = new Set(); // reused every frame: tokens our cast hook is carrying
  function heldTokens() { heldSet.clear(); const h = castOut(); if (h) for (const c of caughtList(h)) heldSet.add(c.token); return heldSet; }

  // ---------- Small mesh helpers ----------
  const materialCache = new Map();
  let diving = null, diveWarmed = false, diveWarmAt = 0, playFrames = 0; const islands = [], aboveWater = [], gatheredIds = new Set(); // gatheredIds: host-side guard against re-gathering; // diving lane hook
  function mat(color) {
    if (!materialCache.has(color)) {
      let m = ART.artEnabled() ? ART.materialForColor(T, color) : null; // art lane hook
      if (!m && TIMBER.has(color)) { try { m = createWoodMaterial(T, color); } catch (e) { console.warn('wood material failed', e); } }
      materialCache.set(color, m ?? new T.MeshStandardMaterial({color, roughness:.85, metalness:0}));
    }
    return materialCache.get(color);
  }
  function box(w, h, d, c, x = 0, y = 0, z = 0, parent) { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent?.add(m); return m; }
  function cylinder(rt, rb, h, c, x, y, z, parent, n = 8) { const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, n), mat(c)); m.position.set(x, y, z); m.castShadow = true; parent?.add(m); return m; }
  function sphere(r, c, x, y, z, parent) { const m = new T.Mesh(new T.IcosahedronGeometry(r, 1), mat(c)); m.position.set(x, y, z); parent?.add(m); return m; }
  // three r170 draws transparent DoubleSide materials as two passes and flips material.side (a full program-parameter
  // rebuild) around each; these thin, depth-tested parts look the same in one pass.
  function singlePass(o) { o.traverse(c => { for (const m of [].concat(c.material || [])) if (m.transparent && m.side === T.DoubleSide) m.forceSinglePass = true; }); return o; }
  function disposeGeometry(o) { const cached = new Set(materialCache.values()), materials = new Set(); o.traverse(c => { if (!c.geometry?.userData.shared) c.geometry?.dispose(); for (const m of [].concat(c.material || [])) if (!cached.has(m) && m !== clothMat && !m.userData.shared) materials.add(m); }); for (const m of materials) { m.map?.dispose(); m.dispose(); } }
  function woodMat(hex) { // content hook (paint): tinted plank materials, cached forever (disposeGeometry skips them)
    const k = 'wood:' + hex;
    if (!materialCache.has(k)) { let m = null; try { m = createWoodMaterial(T, hex); } catch (e) { console.warn('wood material failed', e); } materialCache.set(k, m ?? new T.MeshStandardMaterial({color:hex, roughness:.85, metalness:0})); }
    return materialCache.get(k);
  }

  // ---------- DOM adoption (stable nodes shared across hot swaps) ----------
  function prepareDom() {
    let style = document.getElementById(STYLE_ID);
    if (!style) { style = document.createElement('style'); style.id = STYLE_ID; document.head.appendChild(style); }
    if (style.textContent !== HUD_CSS) style.textContent = HUD_CSS;
    if (!document.getElementById('contextPrompt')) { const el = document.createElement('div'); el.id = 'contextPrompt'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.hidden = true; document.body.appendChild(el); }
    if (!document.getElementById('signalReadout')) { const el = document.createElement('div'); el.id = 'signalReadout'; el.setAttribute('role', 'status'); el.hidden = true; document.body.appendChild(el); }
    if (!document.getElementById('signalMarker')) { const el = document.createElement('div'); el.id = 'signalMarker'; el.hidden = true; document.body.appendChild(el); }
    document.querySelectorAll('[data-quick-recipe]').forEach(b => b.remove()); // old pseudo-inventory buttons
    document.body.classList.remove('build');
    const recipes = $('#recipes'); if (recipes) { recipes.hidden = true; recipes.innerHTML = ''; }
    const controls = $('.controls'); if (controls) controls.innerHTML = '<span><kbd>W A S D</kbd> Walk</span><span><kbd>Space</kbd> Jump</span><span><kbd>1–0</kbd> Hotbar</span><span><kbd>E</kbd> Pick up / bag</span><span><kbd>Esc</kbd> Menu</span><span id="fishCount"></span>';
    const guide = $('#help .guide');
    if (guide) guide.innerHTML = '<li><kbd>Mouse</kbd><span><b>Look around.</b> Click the sea to capture your mouse.</span></li>'
      + '<li><kbd>W A S D</kbd><span><b>Walk</b>, hold <kbd>Shift</kbd> to run, <kbd>Space</kbd> to jump. Fell in? Swim to the raft and hold <kbd>Space</kbd> to climb aboard.</span></li>'
      + '<li><kbd>1–0</kbd><span><b>Hotbar.</b> Number keys or the mouse wheel choose a slot. Click uses what you are holding.</span></li>'
      + '<li><kbd>Hook</kbd><span><b>Throw.</b> Hold click to power up, aim higher to throw farther, release. Hold again to reel in everything it touches.</span></li>'
      + '<li><kbd>E</kbd><span><b>Pick up</b> a supply right beside you, or open your bag to craft. <kbd>Tab</kbd> / <kbd>I</kbd> open the bag too; <kbd>E</kbd>, <kbd>I</kbd> or <kbd>Esc</kbd> close it. Inside, <kbd>Tab</kbd> and the arrow keys move between slots.</span></li>'
      + '<li><kbd>E</kbd><span><b>Sail.</b> Look at a sail and press E to raise or lower it; hold <kbd>R</kbd> and turn to steer it. The pennant shows the wind. E at the anchor post stops the raft.</span></li>' // [sailing]
      + '<li><kbd>Craft</kbd><span><b>Make tools.</b> A Hammer builds raft floors (2 wood, 2 plastic each). A Fishing Rod catches fish. Crafted decorations are placed one at a time.</span></li>'
      + '<li><kbd>X</kbd><span><b>Remove</b> the floor or piece you aim at while holding the Hammer. You get about half its materials back.</span></li>'
      + '<li><kbd>R</kbd><span><b>Rotate</b> the piece you are placing (<kbd>Shift</kbd> + wheel turns it finely), or <b>repair</b> a worn hook for 2 wood and 1 scrap.</span></li>'
      + '<li><kbd>Esc</kbd><span><b>Menu.</b> Settings, Play together and this guide.</span></li>';
    const note = $('#help .guide-note'); if (note) note.textContent = 'Everyone has their own bag; the raft and the sea are shared. Nothing can hurt you, and your raft never sinks. Mouse won\'t lock? Drag the ocean to look instead.';
  }

  // ---------- Scene ----------
  // content hook: live view of the engine for content modules (see dist/content.js)
  const contentCtx = {
    T, get scene() { return scene; }, get camera() { return camera; }, get raft() { return raft; }, get ocean() { return ocean; },
    get sun() { return sun; }, get hemi() { return hemi; }, get clouds() { return clouds; }, get renderer() { return renderer; },
    get world() { return world; }, get role() { return role; }, get running() { return running; }, get physics() { return physics; },
    get elapsed() { return elapsed; }, get options() { return options; }, get other() { return other; },
    get sailing() { return sailing; }, // [islands] seabed offset + grounding blocker (sailing-world.js); may be null
    localBag: () => localBag(), actorBag: a => actorBag(a), action: a => action(a), emit: (e, to) => emit(e, to), notice: (s, ms) => notice(s, ms),
    play: (ev, s) => play(ev, s), // [treasure-hook] local sound only (finder beeps), never sent
    esc: s => esc(s), mat: c => mat(c), rebuildRaft: () => rebuildRaft(), deckY: () => deckY(), uiOpen: () => uiBlocked(), hasGrill: (x, z) => !!fc?.hasGrill(x, z),
    get building() { return building; }, get brush() { return hands?.itemModel('brush') ?? null; }, woodMat: c => woodMat(c), aim: () => frameAim, // content hook (paint)
    openInventory: () => openInventory(), releaseLock: () => { clearInput(); releaseLock(); }, requestLock: () => requestLock(),
    hurtPlayer: (n, cause) => hurtPlayer(n, cause), get vitals() { return vitals; }, // [vitals] damage the LOCAL player; vitals is read-only for modules
    play: (ev, v) => play(ev, v), // [axe] local one-shot sound (islands: the chop thunk)
  };
  function init() {
    const assetBuild = new URL(import.meta.url).searchParams.get('build') || 'dev'; document.querySelectorAll('use[href*="icons.svg"]').forEach(el => el.setAttribute('href', 'icons.svg?build=' + assetBuild + '#' + el.getAttribute('href').split('#')[1]));
    prepareDom();
    scene = new T.Scene(); sky = createSky(T, {sunDirection:new T.Vector3(-15, 28, 12)}); scene.add(sky.group); scene.background = sky.horizonColor.clone(); scene.fog = new T.Fog(sky.horizonColor.clone(), 60, 260);
    camera = new T.PerspectiveCamera(running ? 70 : 48, innerWidth / innerHeight, .05, 200); camera.rotation.order = 'YXZ'; scene.add(camera);
    renderer = X?.renderer && X.renderer.domElement === canvas ? X.renderer : new T.WebGLRenderer({canvas, antialias:devicePixelRatio < 1.5}); // dense screens get their smoothing from pixels, not MSAA
    try { setIconRenderer(renderer); } catch {} // item icons share this WebGL context
    renderer.setSize(innerWidth, innerHeight);
    renderer.info.autoReset = false; renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
    hemi = new T.HemisphereLight('#bfe6ff', '#2f6f7a', 1.0); scene.add(hemi); // content hook: kept for day/night; blue sky fill from above, teal sea bounce from below
    sun = new T.DirectionalLight('#ffeccb', 3.0); sun.position.set(...SUN_OFFSET); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0004; sun.shadow.normalBias = .03; sun.shadow.radius = 3; scene.add(sun, sun.target); // shadow box is fitted to the raft each frame
    quality = createQuality({sun, preset:options.graphics, onChange:() => { applyUserGraphics(); warmBeforeShadowsOff(); }}); applyUserGraphics(); // owns the level (shadow map size, sun.castShadow); applyUserGraphics sets the pixel ratio once, with the render scale
    ocean = createOcean(T, {sunDirection:sun.position.clone(), skyColor:'#a6e9f2', fadeNear:28, fadeFar:190}); ocean.mesh.renderOrder = 10; scene.add(ocean.mesh); ocean.update(elapsed); // renderOrder: after other opaques so early-Z skips covered sea pixels (viewmodels stay at 1000)
    if (ART.artEnabled()) ART.applyLighting(scene, renderer, ART.LIGHTING, {ocean, T}); // art lane hook
    raft = new T.Group(); raft.position.y = raftPose.y; raft.rotation.set(raftPose.rx, 0, raftPose.rz); scene.add(raft);
    itemsGroup = new T.Group(); scene.add(itemsGroup); ocean.trackFoam(itemsGroup);
    player = makeAvatar(lookState.look); friend = makeAvatar('#70a7e4'); friend.visible = false; scene.add(player, friend); // world space, not raft-parented
    ghosts = createGhosts(T, scene, raft, {floor:m => createFloor(T, 0, m), craft:k => { try { return prog?.modelFor(k, {type:k}) ?? (k === 'rainbarrel' ? createRainBarrel(T) : k === 'sprinkler' ? createSprinkler(T) : k === 'purifier' ? createPurifier(T) : createCraft(T, k) ?? createSignalModel(T, k) ?? content?.decorModel(k) ?? null); } catch { return null; } }}); // see-through real models, red when blocked
    const ropeGeo = new T.BufferGeometry(); ropeAttr = new T.BufferAttribute(new Float32Array((ROPE_SEGMENTS + 1) * 3), 3); ropeAttr.setUsage(T.DynamicDrawUsage); ropeGeo.setAttribute('position', ropeAttr);
    rope = new T.Line(ropeGeo, new T.LineBasicMaterial({color:'#e9d39a'})); rope.visible = false; rope.frustumCulled = false; scene.add(rope);
    hookMesh = createHook(T); hookMesh.scale.setScalar(.5); hookMesh.visible = false; scene.add(hookMesh);
    bobber = createFishingTool(T).userData.float; bobber.removeFromParent(); bobber.position.set(0, 0, 0); bobber.scale.setScalar(3.5); bobber.visible = false; scene.add(bobber); // own materials, normal render order
    clothMat = new T.MeshStandardMaterial({color:'#fff3cf', side:T.DoubleSide, roughness:1});
    buildViewmodels();
    try { fc = createFishingCooking(T, fcHost()); } catch (e) { console.error('fishing-cooking failed', e); fc = null; } // [fishing-cooking]
    try { instruments?.dispose(); instruments = createInstruments(T, instHost()); } catch (e) { console.error('instruments failed', e); instruments = null; } // [instruments]
    islands.length = 0; aboveWater.length = 0; // diving lane hook: seafloor rises toward islands; these groups hide underwater
    // A few islands at varied distances [angle, distance, radius]; draws 12 rand() values so later world seeding is unchanged.
    const isl = [[3.6, 62, 11], [2.55, 96, 15], [.75, 80, 9], [-1.75, 112, 13]];
    for (let i = 0; i < 12; i++) { const j = rand(); if (i < isl.length) { const [a, d, r] = isl[i], rr = r * (.9 + j * .2), g = createIsland(T, {seed:i + 1, radius:rr}); g.position.set(Math.sin(a) * d, 0, Math.cos(a) * d); g.rotation.y = j * 6.28; islands.push({x:g.position.x, z:g.position.z, r:rr * .6}); aboveWater.push(g); scene.add(g); scenery.push([g, rr * .7]); } } // [sailing] islands drift past; diving: seafloor rises toward these (createIsland merges its own meshes)
    // Clouds are wisps in the sky dome (sky.js); the old puffy cloud groups are gone, so content's day/night gets clouds = [].
    aboveWater.push(sky.group); // diving lane hook: no sky dome underwater
    setOwnedElsewhere(id => Object.prototype.hasOwnProperty.call(PROG_ITEMS, id) || id === 'shellwreath'); // [progression-hook] items.js unlocks own the catalogue + trader plan gates shellwreath
    content = createContent(contentCtx); content.load(world.ext, 'save'); // content hook
    try { vitalsUI = createVitalsUI(); } catch (e) { console.warn('vitals HUD unavailable', e); vitalsUI = null; } // [vitals]
    building = createBuilding(T, scene); // building-pieces lane hook
    // [sailing] raft velocity, sail, anchor, wind HUD; the world moves past the raft (sailing-world.js)
    try { sailing = createSailing(T, {scene, raft, ocean, camera, getWorld:() => world, getRole:() => role, getPhysics:() => physics, getYaw:() => yaw, isRunning:() => running,
      action:a => action(a), notice, canInput:() => running && !uiBlocked() && !guestWaiting(), getAimNdc, isBusy:() => !!hook || !!charging,
      getPush:(s, o) => { content?.sailPush(s, o); }, steerTargets:() => content?.steerTargets() ?? null}); /* engine: motor push + wheel grab points */ for (const [g, r] of scenery) sailing.addDrifter(g, r); } catch (e) { console.error('sailing failed', e); sailing = null; }
    try { diving = createDiving({T, scene, camera, ocean, islands, restore:X?.dive, hideAbove:aboveWater, getTiles:() => world.tiles, getDeckY:deckY, onGather:id => action({kind:'gather', id}), getMods:out => content?.diveMods?.(out), getVitals:() => vitals, onDrown:(n, first) => { if (hurtPlayer(n, 'drown') > 0 && first) notice('Out of air! You are drowning', 2000); }}); diveWarmed = false; } catch (e) { diving = null; console.warn('diving disabled', e); } // diving lane hook
    initShark(); // shark lane
    rebuildRaft(); fitShadow();
    if (!world.items.length && role !== 'guest') for (let i = 0; i < DEBRIS.POOL; i++) world.items.push(makeItem(i));
    syncItems(); singlePass(scene); refreshPointerUI(true);
  }

  // ---------- Shark (shark lane, dist/shark.js) ----------
  function initShark() {
    wildlifeMod = content?.mods?.find(m => m.name === 'wildlife') ?? null;
    try {
      sharkFx = createWaterEffects(T); scene.add(sharkFx.group);
      shark = createShark(T, {scene, ocean, raft:() => raft, world:() => world, role:() => role, waterFx:sharkFx,
        preys:out => { // swimmers the shark may hunt: [0] = us, [1] = the guest (host only)
          out[0].x = physics.x; out[0].z = physics.z; out[0].swimming = running && physics.swimming;
          const o = other; out[1].swimming = !!(o && o.swimming && networkReady && role === 'host'); if (o) { out[1].x = o.x; out[1].z = o.z; }
        },
        circler:() => wildlifeMod?.circler ?? null,
        onBite:(x, z) => emit({kind:'shark', fx:'bite', x, z}, 'all'),
        onBroke:(x, z) => { fc?.dropTile?.(x, z); content?.mods?.find(m => m.name === 'storage')?.dropTile?.(x, z); rebuildRaft(); fitShadow(); emit({kind:'shark', fx:'broke', x, z, text:'The shark tore a foundation off the raft!'}, 'all'); },
        onHurt:(i, n) => { if (i === 0) hurtLocal(n); else emit({kind:'shark', hurt:n}, 'guest'); },
        onWarn:() => emit({kind:'shark', text:'The shark is biting the raft!'}, 'all'),
        sendHit:dmg => action({kind:'shark:hit', dmg}),
      }, world.shark);
    } catch (e) { console.error('shark failed', e); shark = null; }
  }
  function hurtLocal(n) {
    shakeAmp = Math.max(shakeAmp, .2); beep(140); notice('The shark bit you!', 1400);
    if (typeof hurtPlayer === 'function') hurtPlayer(n, 'shark'); else window.raftDebug?.hurt?.(n, 'shark');
  }
  function sharkEffect(e) { // host and guest: cues for a bite, a broken tile or a bite on the guest
    if (typeof e.text === 'string' && e.text) notice(e.text.slice(0, 90), 2600);
    if (Number.isFinite(e.hurt) && e.hurt > 0 && role === 'guest') hurtLocal(Math.min(e.hurt, 100));
    if (!isInt(e.x) || !isInt(e.z) || !shark) return;
    const v = shark.view, d = Math.hypot(physics.x - e.x * 2, physics.z - e.z * 2), near = clamp(1 - d / 14, .25, 1);
    shark.markBite(e.x, e.z); shark.fx('bite', v.x + Math.sin(v.heading) * 1.3, v.z + Math.cos(v.heading) * 1.3);
    shakeAmp = Math.max(shakeAmp, (e.fx === 'broke' ? .16 : .08) * near);
    if (raft) { raft.rotation.x += (Math.random() - .5) * .03; raft.rotation.z += (Math.random() - .5) * .03; } // the whole raft jolts; updateRaft eases it back
    beep(e.fx === 'broke' ? 90 : 120);
  }
  const canHarvestShark = () => !!shark && running && !diving?.state.diving && shark.canHarvest(physics.x, physics.z);

  // [fishing-cooking] adapter: the lane module only sees the engine through these functions.
  function instHost() { return {scene, camera, pitch:() => pitch, send, netReady:() => networkReady, note, friendPos:() => (other && friend ? friend.position : null)}; } // [instruments] coop.js hides `friend` but it still tracks the peer
  function fcHost() {
    return {scene, raft, ocean, camera, signal, get rodModel() { return hands?.itemModel('fishingrod') ?? null; }, role:() => role, netReady:() => networkReady, send, action, notice, beep,
      selectedKind, aim:() => currentAim(), rodTip:() => handPos, player:() => ({x:physics.x, y:physics.y, z:physics.z, yaw}),
      hasTile, decorAt:(x, z) => world.decor.some(d => d.x === x && d.z === z), bagCount:k => localBag().count(k),
      running:() => running, uiBlocked, resume:() => requestLock(), busy:() => !!hook || !!fishWait || !!charging};
  }
  function fallbackAvatar(color) {
    if (color && typeof color === 'object') color = lookColors(color).shirt; // [look]
    const g = new T.Group();
    cylinder(.21, .25, .58, color, 0, .64, 0, g); sphere(.23, '#f2c69b', 0, 1.14, 0, g); cylinder(.28, .28, .07, '#f7e7b5', 0, 1.32, 0, g); cylinder(.17, .19, .16, '#f7e7b5', 0, 1.4, 0, g);
    box(.13, .22, .15, '#314d53', -.13, .25, 0, g); box(.13, .22, .15, '#314d53', .13, .25, 0, g);
    return g;
  }
  // [look] local look changed in the Look dialog: save, recolour the FP hands, rebuild the third-person body.
  function applyLook(look) {
    lookState = {look, unlocked:lookState.unlocked}; saveLook(look, lookState.unlocked);
    hands?.setLook?.(lookColors(look));
    if (!scene || !player) return;
    const old = player, next = makeAvatar(look);
    next.position.copy(old.position); next.rotation.copy(old.rotation); next.visible = old.visible;
    scene.remove(old); try { old.userData.dispose?.(); } catch {}
    player = next; scene.add(next);
  }
  function makeAvatar(color) {
    try { const g = createAvatar(T, color); if (g?.isObject3D) { g.traverse(c => { if (c.isMesh) c.castShadow = true; }); return g; } }
    catch (e) { console.warn('createAvatar failed, using fallback avatar', e); }
    return fallbackAvatar(color);
  }

  // First-person viewmodel: one hands controller that swaps the held item model per hotbar kind.
  function buildViewmodels() {
    hands = createHands(T, {modelFactory:modelOf}); hands.preload(['hook']); // 3D models from models.js, built-ins as fallback
    hands.setLook?.(lookColors(lookState.look)); // [look] sleeves = shirt, hands = skin tone
    spearRep = attachSpearRepair({T, camera:() => camera, raft:() => raft, world:() => world, physics:() => physics, other:() => other, localBag, role:() => role, elapsed:() => elapsed, shark:() => shark, action, emit, notice, beep, setSwing:v => { swing = v; }}); // [spear-repair] spear models live in held-items.js; this adds the jab, thrust and repair
    paddle = attachPaddle({localBag, physics:() => physics, other:() => other, tiles:() => world.tiles, yaw:() => yaw, elapsed:() => elapsed, anchored:() => !!world.sailing?.anchored,
      action, notice, emit, sound:n => play(n, 1), splash:(x, z, k) => sharkFx?.splash(x, ocean.getHeight(x, z), z, k),
      sailReady:() => !!sailing?.paddleReady(), sailApply:(a, actor) => sailing?.apply(a, actor)}); // [paddle]
    // Viewmodels draw last (transparent queue, renderOrder 1000) after a camera-owned marker clears depth, so the
    // world never clips them while fingers and tools still depth-sort correctly against each other.
    const depthClear = new T.Mesh(new T.PlaneGeometry(1e-4, 1e-4), new T.MeshBasicMaterial({colorWrite:false, depthWrite:false, depthTest:false, transparent:true}));
    depthClear.name = 'viewmodelDepthClear'; depthClear.frustumCulled = false; depthClear.castShadow = false; depthClear.receiveShadow = false;
    depthClear.renderOrder = 999; depthClear.position.set(0, 0, -.1);
    depthClear.onBeforeRender = (r, _s, cam) => { if (cam !== camera) return; r.state?.buffers?.depth?.setMask?.(true); r.clearDepth(); };
    camera.add(depthClear);
    camera.add(hands.group);
  }

  // Fits the sun's shadow box to the raft (plus a margin for props, avatars and nearby supplies). Call after tiles change.
  // The box never grows past the old fixed ±25 m, so texels are never coarser than before.
  function fitShadow() {
    if (!sun || !world.tiles.length) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of world.tiles) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const cx = (x0 + x1), cz = (z0 + z1), r = clamp(Math.hypot(x1 - x0 + 1, z1 - z0 + 1) + SHADOW_MARGIN, SHADOW_MIN, SHADOW_MAX); // tiles are 2 m: centre = sum, half-diagonal = hypot(span + 1)
    sun.target.position.set(cx, 0, cz); sun.position.set(cx + SUN_OFFSET[0], SUN_OFFSET[1], cz + SUN_OFFSET[2]);
    const d = Math.hypot(...SUN_OFFSET), cam = sun.shadow.camera;
    Object.assign(cam, {left:-r, right:r, top:r, bottom:-r, near:Math.max(.5, d - r - 6), far:d + r + 6}); cam.updateProjectionMatrix();
  }
  // Compile every scene program up front (hidden viewmodels, hook, rope, ghost) so the first frame after #solo doesn't.
  // compile() walks the scene graph, so all viewmodels are attached just for the synchronous part of the call.
  function warmShaders() {
    if (typeof renderer.compileAsync !== 'function') return;
    hands?.preload(['hammer', 'fishingrod', 'spear', 'paddle', 'axe']);
    try { renderer.compileAsync(scene, camera).catch(e => console.warn('shader warm-up failed', e)); }
    catch (e) { console.warn('shader warm-up failed', e); }
  }
  // Also build the no-shadow variant (adaptive floor / Shadows off), else that switch relinks every lit program mid-game.
  // Warm it only when the scaler is one step from turning shadows off, so fast machines never pay for the extra programs.
  let noShadowWarmed = false;
  function warmBeforeShadowsOff() {
    if (noShadowWarmed || !quality) return;
    const L = quality.levels, i = quality.level;
    if (L[i]?.shadows && L[i + 1] && !L[i + 1].shadows) { noShadowWarmed = true; warmNoShadow(); }
  }
  function warmNoShadow() {
    if (!sun?.castShadow || typeof renderer?.compileAsync !== 'function') return;
    sun.castShadow = false;
    try { renderer.compileAsync(scene, camera).catch(() => {}); } catch {}
    sun.castShadow = true;
  }
  // Held models and build ghosts for every kind in the bag are built ahead and their shaders compiled
  // (ghosts are shown for the call: renderer.compile skips hidden meshes), so the first switch never links programs mid-play.
  const warmedKinds = new Set();
  function warmKinds() {
    if (!hands || !ghosts || typeof renderer?.compileAsync !== 'function') return;
    const slots = localBag().slots; let fresh = false;
    for (let i = 0; i < slots.length; i++) {
      const k = slots[i]?.kind; if (!k || warmedKinds.has(k)) continue;
      warmedKinds.add(k); fresh = true; hands.preload([k]);
      if (k === 'hammer') ghosts.preload(['floor']); else if (DECOR_TYPES.includes(k)) ghosts.preload([k]);
    }
    if (fresh) { try { ghosts.warm(() => renderer.compileAsync(scene, camera).catch(() => {})); } catch (e) { console.warn('shader warm-up failed', e); } }
  }
  function palm(parent, x, y, z, s = 1) {
    const g = new T.Group(); g.position.set(x, y, z); g.scale.setScalar(s); cylinder(.09, .17, 1.6, '#ad8153', 0, .8, 0, g);
    for (let i = 0; i < 7; i++) { const l = new T.Mesh(new T.ConeGeometry(.28, 1.5, 4), mat(i % 2 ? '#519b55' : '#72ae59')); l.rotation.z = 1.2; l.rotation.y = i * Math.PI * 2 / 7; l.position.set(Math.sin(i * Math.PI * 2 / 7) * .5, 1.65, Math.cos(i * Math.PI * 2 / 7) * .5); g.add(l); }
    parent.add(g);
  }
  function rebuildRaft() {
    ocean.setRaftTiles(world.tiles);
    for (const c of [...raft.children]) { raft.remove(c); disposeGeometry(c); }
    wateringGroups.clear();
    raft.add(createRaftMesh(T, world.tiles.map(([x, z]) => ({index:x * 719 + z * 311, x:x * 2, z:z * 2})), mat, content ? (t, c) => content.tileTint(t.x / 2, t.z / 2, c) : null, woodMat)); // content hook (paint): painted deck tiles
    for (const d of world.decor) {
      let detailed = null; try { detailed = prog?.modelFor(d.type, d) ?? (d.type === 'rainbarrel' ? createRainBarrel(T) : d.type === 'sprinkler' ? createSprinkler(T) : d.type === 'purifier' ? createPurifier(T) : createCraft(T, d.type) ?? createSignalModel(T, d.type) ?? content?.decorModel(d.type, d) ?? null); } catch (e) { console.warn('craft model failed', e); } // content hook: decorModel, [progression-hook] station models
      if (detailed) { detailed.position.set(d.x * 2, .22, d.z * 2); if (d.rot) detailed.rotation.y = d.rot; raft.add(detailed); if (d.type === 'palm' || d.type === 'purifier' || d.type === 'rainbarrel' || d.type === 'sprinkler') { if (d.type === 'palm') preparePlanter(T, detailed); detailed.userData.tileKey = tileKey(d.x, d.z); wateringGroups.set(detailed.userData.tileKey, detailed); } continue; } // decor-pack models keep their own quarter-turn unless placement rotated them
      const g = new T.Group(); g.position.set(d.x * 2, .22, d.z * 2); g.rotation.y = d.rot || 0;
      if (d.type === 'sail') { cylinder(.065, .08, 3.8, '#906f48', 0, 1.9, 0, g); box(2.5, .07, .07, '#906f48', 0, 3.2, 0, g); const s = new T.Mesh(new T.PlaneGeometry(2.35, 2.1), clothMat); s.position.set(0, 2.15, .06); g.add(s); }
      if (d.type === 'palm') { cylinder(.38, .28, .5, '#db8764', 0, .25, 0, g); palm(g, 0, .5, 0); }
      if (d.type === 'lantern') { cylinder(.055, .075, 1.8, '#725942', 0, .9, 0, g); box(.32, .42, .32, '#ffe197', .43, 1.5, 0, g); }
      if (d.type === 'net') { for (let k = 0; k < 6; k++) { box(.025, .05, 1.7, '#ebe1bd', -.8 + k * .32, .05, 0, g); box(1.7, .05, .025, '#ebe1bd', 0, .05, -.8 + k * .32, g); } }
      if (d.type === 'bench') { box(1.4, .08, .42, '#b4824b', 0, .45, 0, g); for (const a of [-.6, .6]) box(.08, .45, .38, '#906f48', a, .22, 0, g); }
      if (d.type === 'crate') { box(.8, .8, .8, '#a97d4c', 0, .4, 0, g); }
      raft.add(g);
    }
    blockList = world.decor.flatMap(d => decorBlockers(d, BLOCK_RADIUS));
    building?.sync(world); // building-pieces lane hook
    content?.afterRebuild(); // content hook (paint): re-tint the new deck planks
    sailing?.onRaftBuilt(); // [sailing] re-find sail models
  }

  // ---------- Floating supplies ----------
  function makeItem(id) { const edge = Math.min(...world.tiles.map(t => t[1])) * 2 - 1, spread = Math.max(11, Math.max(...world.tiles.map(t => Math.abs(t[0]))) * 2 + 6); const it = {id, token:newToken(), type:SPAWN_TABLE[Math.floor(Math.random() * SPAWN_TABLE.length)], x:(Math.random() - .5) * spread * 2, z:edge - 3 - Math.random() * 17, phase:Math.random() * 6};
    if (role !== 'guest' && SPAWN_TABLE.includes(it.type) && shouldSpawnBottle(world, id)) it.type = 'bottle';
    return it;
  }
  function itemModel(item) {
    if (item.type === 'cache') return createSignalModel(T, 'cache');
    if (item.type === 'bottle') { const g = new T.Group(), b = createBottle(T); b.position.y = .04; b.rotation.y = (item.id % 7) * .9; g.add(b); return singlePass(g); }
    if (item.type !== 'plastic') { const d = createDebris(T, item.type, mat, {seed:item.id, pool:4}); if (ART.artEnabled() && item.type === 'scrap') d.traverse(o => { if (o.isMesh && o.material.vertexColors) { o.material.dispose(); o.material = mat('#8e9aa2'); } }); /* art lane hook */ return singlePass(d); } // pooled geometry, drawn instanced by the item batch
    const g = new T.Group(), jug = createPlastic(T); if (ART.artEnabled()) { const b = jug.getObjectByName('jugBody'); if (b) { b.material.dispose(); b.material = mat('#f2f0e6'); } } /* art lane hook */ singlePass(jug); jug.rotation.set(Math.PI / 2, 0, .4 + (item.id % 5) * .5); jug.position.y = .05; jug.scale.setScalar(.85); g.add(jug); return g;
  }
  // Meshes are keyed by token, not id: a respawned item keeps its id but may change type.
  const itemMeshes = new Map();
  function syncItems() {
    if (!itemsGroup) return;
    if (!itemsGroup.userData.batch) itemsGroup.add(itemsGroup.userData.batch = createItemBatch(T)); // one instanced draw per item variant
    const live = new Set(world.items.map(x => x.token));
    for (const [token, m] of itemMeshes) if (!live.has(token)) { itemsGroup.remove(m); disposeGeometry(m); itemMeshes.delete(token); }
    for (const token of pending.keys()) if (!live.has(token)) pending.delete(token);
    for (const item of world.items) {
      if (itemMeshes.has(item.token)) continue;
      const g = itemModel(item); g.userData.token = item.token; singlePass(g);
      g.traverse(o => { o.castShadow = false; }); // the ocean takes no shadows, so floating supplies skip the shadow pass
      g.position.set(item.x, ITEM_FLOAT, item.z);
      itemsGroup.add(g); itemMeshes.set(item.token, g);
    }
  }
  const isPending = it => (pending.get(it.token) ?? 0) > performance.now();

  // ---------- Feedback: pickups and notes go to the bottom-left feed, never the screen centre ----------
  const setText = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
  function setStatus(s) { setText('#networkStatus', s); }
  function feedSprite(k) { try { const t = document.createElement('template'); t.innerHTML = iconSVG(k); return t.content.firstElementChild; } catch { return null; } } // same flat sprite the hotbar shows until (or instead of) a 3D icon
  function notice(s, ms = 1800) { if (s == null || s === '') return; noticeText = String(s).slice(0, 90); noticeUntil = performance.now() + Math.min(ms, 400); pickupFeed.note(noticeText); } // bottom-left feed, never the screen centre
  function toast(s) {
    if (coop?.feed(s)) return; // coop: connection news goes to the bottom-left feed
    if (running) { notice(s, 2400); return; }
    const el = $('#toast'); if (!el) return; el.textContent = s; el.classList.add('show');
    toastTimer = cancelTimer(toastTimer); toastTimer = later(() => { toastTimer = 0; el.classList.remove('show'); }, 2600);
  }
  // Old tone API (fishing-cooking lane, logbook): routed to the procedural sound recipes in audio.js.
  function beep(f = 500) { play(f >= 850 ? 'bite' : f >= 600 ? 'catch' : f >= 420 ? 'collect' : f >= 260 ? 'ui' : f >= 200 ? 'throw' : 'splash', .8); }
  // ---------- [vitals] hunger, thirst, health ----------
  function gulp(munch) { beep(munch ? 240 : 330); later(() => beep(munch ? 200 : 280), 130); }
  // Game-internal damage hook for other systems (sharks, falls…). Hurts the LOCAL player only; on a host, a hit on the
  // guest must be sent to the guest (e.g. as an effect) and applied there with its own hurtPlayer. Returns HP lost.
  function hurtPlayer(n, cause = 'hit') {
    if (!running || fainted >= 0) return 0;
    const lost = damageVitals(vitals, Number(n), String(cause ?? 'hit'));
    if (lost > 0) vitalsUI?.flash();
    return lost;
  }
  const eatKind = () => { const k = localBag().slots[localBag().selectedIndex]?.kind ?? null; return isEdible(k) ? k : null; };
  function startEat(kind) {
    if (eating || fainted >= 0) return;
    if (guestWaiting()) { notice('Wait for your raft to connect'); return; }
    eating = {item:kind, slot:localBag().selectedIndex, t:0}; beep(420);
  }
  function updateVitals(dt, dialog) {
    if (!running) { eating = null; return; }
    if (fainted >= 0) { // passed out: a short dark beat, then wake up on the raft
      fainted += dt; vitalsUI?.faint(true);
      if (fainted >= 2.6) {
        fainted = -1; const c = cleanVitals(RESPAWN); vitals.hp = c.hp; vitals.food = c.food; vitals.water = c.water; vitals.hurtAt = -Infinity; vitals.starving = false;
        diving?.cancel(); const s = spawnPoint(0, 0); physics = new PlayerPhysics({x:s.x, y:deckY() + EYE_OFFSET, z:s.z}); pitch = -.28; // fresh physics: dry, grounded, not diving
        vitalsUI?.faint(false); notice('You wake up on the raft, hungry and thirsty', 3200);
      }
      return;
    }
    if (eating) {
      const bag = localBag();
      if (dialog) eating = null; // a menu opened mid-bite: cancel, the item stays in the bag
      else if (bag.selectedIndex !== eating.slot || bag.slots[eating.slot]?.kind !== eating.item) eating = null; // switched slot or item gone
      else if ((eating.t += dt) >= EAT_SECONDS) { const item = eating.item; eating = null; action({kind:'eat', item}); }
    }
    if (role === 'solo' && dialog && dialogOpen()) return; // the solo pause menu stops the clock
    vitalsOpts.mult = exertion; tickVitals(vitals, dt, vitalsOpts);
    if (vitals.hp <= 0) { fainted = 0; eating = null; charging = null; reeling = false; if (hook) { fishWait = 0; endHook(); } clearInput(); } // drop the line: it must not stay out from the old spot
  }
  // Crosshair prompts (dist/prompts.js provider): eat/drink, else the cup/purifier/planter prompt (game.js markup).
  const tipCache = new Map(), eatTips = new Map(), EATING_TIP = {key:'', label:'…', muted:true};
  let eatTip = null, promptOff = null;
  function tipFor(html) {
    let t = tipCache.get(html); if (t) return t;
    const m = /^<kbd>([^<]*)<\/kbd>(.*)$/.exec(html), txt = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    t = m ? {key:m[1] === 'Click' ? 'LMB' : m[1], label:txt(m[2])} : {label:txt(html), muted:true};
    if (tipCache.size > 200) tipCache.clear(); tipCache.set(html, t); return t;
  }
  function updateEatTip(dialog) {
    const k = running && !dialog && fainted < 0 && !hook && !fishWait && !pickTarget && !waterAim?.click ? eatKind() : null;
    if (!k) { eatTip = null; return; }
    if (eating) { EATING_TIP.label = isDrink(k) ? 'Drinking…' : 'Eating…' /* [juicer] */; eatTip = EATING_TIP; return; }
    eatTip = eatTips.get(k); if (!eatTip) { eatTip = {key:'LMB', label:eatLabel(k)}; eatTips.set(k, eatTip); }
  }
  const PURIFIER_STATUS = /^(Purifying|Purifier:|Fire is full)/;
  function promptTip() { // watering hints only when actionable or while holding a cup (never hides the hook's "Throw")
    if (eatTip) return eatTip;
    const p = waterAim?.prompt; return p && (p.startsWith('<kbd>') || CUP_KINDS.includes(selectedKind()) || PURIFIER_STATUS.test(p)) ? tipFor(p) : null; // purifier status: a muted prompt (prompts.js keeps it out of the feed)
  }
  let contextHtml = null, contentPromptOff = null; // content hook: contextHtml also feeds main's #lrPrompt via raftPrompts
  function updateContext(dialog) {
    let html = ''; contextHtml = null; // content hook: cleared each frame so a stale content prompt never lingers
    if (!contentPromptOff && window.raftPrompts) contentPromptOff = window.raftPrompts.provide({id:'content', priority:1, prompt:() => promptParts(contextHtml)}); // content hook: #contextPrompt is hidden by prompts.css
    const bt = running && !dialog ? building?.target(camera.position, frameAim, deckY()) ?? null : null; // [buildpack] hatch / gate under the aim (once per frame)
    if (running && !dialog) {
      if (guestWaiting()) html = 'Waiting for your brother’s raft…';
      else if (pickTarget) html = `<kbd>E</kbd>Pick up ${esc(ITEM_NAMES[pickTarget.type] ?? 'supply')}`;
      else if (canHarvestShark()) html = '<kbd>E</kbd>Harvest the shark'; // shark lane
      else if (hover?.blocked) html = esc(BLOCK_TEXT[hover.blocked]);
      else if (eatTip && !(contextHtml = content?.prompt(frameAim) ?? null)?.startsWith('<kbd>E</kbd>')) { contextHtml = null; html = '<kbd>Click</kbd>' + esc(eatTip.label); } // [vitals] kbd markup: a prompt, not a feed notice [juicer] an E content prompt wins
      else if (waterAim?.prompt) html = waterAim.prompt;
      else if (!contextHtml && bt && (contextHtml = building.promptOf(bt))) html = contextHtml; // [buildpack] Open / Close hatch or gate
      else if (contextHtml ||(contextHtml = content?.prompt(frameAim) ?? null)) html = contextHtml; // content hook [juicer] reuse when set above
      else if (fc?.prompt) html = fc.prompt; // [fishing-cooking] trusted static markup from the lane module
      else if (hover && heldKind() === 'hammer' && !canAfford(localBag(), FLOOR_COST)) html = 'Floor needs ' + esc(missingText(localBag(), FLOOR_COST));
      else if (hook?.fishing) html = esc(castPrompt(hook, fishWait));
      else if (hookFull && castOut()) html = 'Bag full: free a slot to reel it in';
      else if (castOut() && castOut().stage === 'floating') html = caughtList(castOut()).length ? 'Hold click to reel it in' : 'Hold click to reel';
    }
    const usable = !!(running && !dialog && (pickTarget || waterAim?.click || waterAim?.e || bt)); // [buildpack] bt
    if (usable !== crossUsable) { crossUsable = usable; $('#crosshair')?.classList.toggle('usable', usable); } // dot grows over interactables
    if (html === contextCache) return; contextCache = html;
    const el = $('#contextPrompt'); if (!el) return; el.innerHTML = html; el.hidden = !html;
  }
  function hintDone(id) { if (hintsDone.has(id)) return; hintsDone.add(id); saveHints(window.localStorage, hintsDone); }
  // A lane inside the open bag or pause rail that the feed docks into, so its rows never cover panel controls.
  function feedLane(place) {
    const host = place === 'inventory' ? $('#inventory .sv-bag') : place === 'options' ? $('#options .rs-menu') : null;
    if (!host) return null;
    let lane = host.querySelector(':scope>.feed-lane');
    if (!lane) { lane = document.createElement('div'); lane.className = 'feed-lane'; host.appendChild(lane); }
    return lane;
  }
  // First-run hints sit at the top of the bottom-left pickup feed. While the bag or pause menu is open the
  // feed moves into that panel's lane; for other dialogs it stays hidden under their backdrop.
  function updateNotices(dialog) {
    if (survivalUI?.isOpen) hintDone('bag');
    const bag = localBag(), has = k => { try { return bag.count(k) > 0; } catch { return false; } };
    for (const id of hintsFromState({hasRope:has('rope'), hasHammer:has('hammer'), built:(world?.tiles?.length ?? 0) > START_TILES})) hintDone(id);
    const hint = running && !dialog && !guestWaiting() ? nextHint(hintsDone, {heldKind:heldKind(), castOut:!!hook, hasLoot:hintsDone.has('loot'), hasLeaf:has('leaf')}) : null;
    const place = feedPlacement({inventoryOpen:!!survivalUI?.isOpen, optionsOpen:!!$('#options')?.open, dialog:!!dialog});
    const sig = (hint?.id ?? '') + '|' + place;
    if (sig === noticeCache) return; noticeCache = sig;
    let el = $('#pickupFeed');
    if (!el) { el = document.createElement('div'); el.id = 'pickupFeed'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    let row = el.querySelector(':scope>.pf-hint');
    if (hint) {
      if (!row) { row = document.createElement('div'); row.className = 'pf-row pf-note pf-hint'; row.append(document.createElement('i'), document.createElement('span')); }
      row.lastChild.textContent = hint.text; if (el.firstChild !== row) el.prepend(row);
    } else row?.remove();
    const lane = feedLane(place);
    if (lane) { // docked: an ordinary in-flow box inside the panel, not a top-layer popover over it
      try { if (el.matches(':popover-open')) el.hidePopover(); } catch {}
      el.removeAttribute('popover'); el.classList.add('docked');
      if (el.parentNode !== lane) lane.appendChild(el);
      return;
    }
    el.classList.remove('docked');
    if (el.parentNode !== document.body) document.body.appendChild(el);
    if (typeof el.showPopover !== 'function') return;
    if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
    try { if (el.matches(':popover-open')) el.hidePopover(); if (place === 'hud') el.showPopover(); } catch {} // re-show so it sits above the HUD
  }
  let lastReadout = null, signalHtml = null, markerCss = null;
  function updateSignalHud() { // receiver pill + cache marker (see signal.js)
    const n = countAntennas(world.decor), r = signalReadout(world.signal, {x:physics.x, z:physics.z, yaw}, n, elapsed); lastReadout = r;
    const el = document.getElementById('signalReadout'), mk = document.getElementById('signalMarker');
    if (el) {
      const show = !!(running && r); if (el.hidden === show) el.hidden = !show;
      const html = show ? `<span class="sig-arrow" style="transform:rotate(${r.listening ? 0 : Math.round(r.arrow)}deg)">${r.listening ? '◌' : '↑'}</span>` + esc(r.label) : '';
      if (html !== signalHtml) { signalHtml = html; el.innerHTML = html; }
    }
    const c = world.signal?.cache, m = c ? itemMeshes.get(c.token) : null;
    if (m?.userData.beam) m.userData.beam.visible = !!r?.beam;
    if (!mk) return;
    const showMarker = !!(running && r?.marker && c && !uiBlocked());
    if (mk.hidden === showMarker) mk.hidden = !showMarker;
    if (!showMarker) return;
    const p = m ? m.position : {x:c.x, y:ITEM_FLOAT + .6, z:c.z}, s = project(p.x, p.y, p.z); if (!s) return;
    const e = edgePoint(s.x, s.y, s.inFront, innerWidth, innerHeight);
    const css = `translate(${Math.round(e.x)}px,${Math.round(e.y)}px)` + (e.edge ? ' e' : ''); if (css === markerCss && mk.style.transform) return; markerCss = css; // write only on change
    mk.style.transform = css.replace(' e', ''); mk.classList.toggle('edge', e.edge);
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  function updateCharge() {
    if (!chargeMeter) return;
    const show = !!charging && running;
    if (chargeMeter.hidden === show) chargeMeter.hidden = !show;
    const w = show ? chargeValue().toFixed(3) : '';
    if (show && w !== chargeWidth) chargeMeter.style.setProperty('--c', chargeWidth = w); // only write the DOM on change
  }
  // Body classes, crosshair and resume hint follow running and pointer-lock state.
  function refreshPointerUI(force = false) {
    const locked = isLocked(), dialog = uiBlocked();
    const signature = (running ? 1 : 0) | (locked ? 2 : 0) | (dialog ? 4 : 0) | (lockFallback ? 8 : 0);
    if (!force && signature === uiSignature) return; uiSignature = signature;
    const b = document.body.classList;
    b.toggle('pointer-locked', locked); b.toggle('locked', locked); b.toggle('first-person', running); b.toggle('playing', running);
    b.toggle('drag-look', dragLook({running, supported:lockSupported, fallback:lockFallback}));
    const crosshair = $('#crosshair'); if (crosshair) crosshair.hidden = !(running && locked);
    const resume = $('#resumeHint'); if (resume) resume.hidden = !(running && !locked && lockSupported && !dialog);
  }

  // ---------- Pointer lock ----------
  let lockPromisePending = false, lockHasPromise = false, lockFailures = 0, lockNoGesture = false;
  const windowFocused = () => { try { return document.hasFocus(); } catch { return true; } };
  // Always ask (no navigator.userActivation pre-gate): after the page itself released the lock (inventory,
  // crafting, crew) Chrome relocks without a gesture. Refusals are handled in lockFailed (lock-rules.js).
  // While Escape is still held (it just closed a panel), Chrome may treat the held key as the user leaving
  // the new lock, so the relock waits for the release (no gesture needed: the page released the lock itself).
  let escHeld = false, relockOnEscUp = false;
  // A browser keyup defers (escReleasePlan): Chrome can revoke a lock granted inside the Escape keyup itself, so the relock runs
  // just after it. The desktop shell's released() stays synchronous to keep its executeJavaScript user gesture.
  function escReleased(fromShell = false) {
    const plan = escReleasePlan({running, pending:relockOnEscUp, fromShell});
    escHeld = relockOnEscUp = false;
    if (plan.relock === 'defer') setTimeout(guard(requestLock), 0); else if (plan.relock === 'now') requestLock();
    return plan;
  }
  function requestLock() {
    if (!shouldRequestLock({running, supported:lockSupported, blocked:uiBlocked()}) || isLocked()) return;
    if (escHeld) { relockOnEscUp = true; return; }
    // Without a user gesture (e.g. Esc closing the inventory) browsers still relock when the page itself released the
    // lock. If they refuse, stay in click-to-look quietly: the next click retries, and it never counts as unsupported.
    lockNoGesture = !!navigator.userActivation && !navigator.userActivation.isActive;
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
    if (lockNoGesture) { lockNoGesture = false; refreshPointerUI(true); return; } // a gestureless retry may be refused
    const isEvent = typeof Event !== 'undefined' && err instanceof Event;
    if (isEvent && (lockPromisePending || lockHasPromise)) { refreshPointerUI(true); return; } // the promise rejection carries the real reason
    const verdict = lockFailureVerdict({supported:lockSupported, err:isEvent ? null : err, focused:windowFocused(), failures:lockFailures});
    lockFailures = verdict.failures;
    if (!verdict.fallback) { refreshPointerUI(true); return; }
    const wasFallback = lockFallback; lockFallback = true; refreshPointerUI(true);
    if (!wasFallback && running) notice('Mouse lock unavailable: drag to look, click to use', 3000);
  }
  function releaseLock() { if (isLocked()) document.exitPointerLock?.(); }
  function look(dx, dy, k) { yaw -= dx * k; pitch = clamp(pitch - (options.invertY ? -dy : dy) * k, -PITCH_LIMIT, PITCH_LIMIT); }
  function clearInput() { keys = {}; charging = null; reeling = false; down = null; lookFilter.reset(); controls?.clear(); fc?.releaseInput(); } // controls lane: also release the input layer
  // A panel opening keeps held keys (keyup still arrives); only window blur really loses keyups. The controls lane drops its own while blocked.
  function pauseInput() { charging = null; reeling = false; down = null; lookFilter.reset(); }

  // ---------- Aiming ----------
  const hits = [], aimScratch = {point:null, item:null, dir:new T.Vector3(), at:new T.Vector3()};
  // `out` (per-frame aim only) reuses its vectors; event callers get a fresh result they may keep.
  function itemByToken(token) { const its = world.items; for (let i = 0; i < its.length; i++) if (its[i].token === token) return its[i]; return undefined; }
  function pickNdc(nx, ny, out = null) {
    pointer.set(nx, ny); ray.setFromCamera(pointer, camera);
    plane.constant = -deckY() - .02;
    const held = allHeldTokens(); // ours and, on the host, the guest's hook
    let item = null;
    hits.length = 0;
    for (const hit of ray.intersectObjects(itemsGroup.children, true, hits)) {
      let o = hit.object; while (o && !o.userData.token) o = o.parent;
      const found = o && itemByToken(o.userData.token);
      if (found && !isPending(found) && !held.has(found.token)) { item = found; break; }
    }
    if (!item) { // small forgiveness for hand pickup only; throws never use this
      let best = Infinity;
      for (const it of world.items) {
        if (isPending(it) || held.has(it.token)) continue; const m = itemMeshes.get(it.token); if (!m) continue;
        const along = tmpV.copy(m.position).sub(ray.ray.origin).dot(ray.ray.direction);
        if (along > 0 && along < 5 && along < best && ray.ray.distanceSqToPoint(m.position) < .2) { best = along; item = it; }
      }
    }
    hits.length = 0;
    if (out) { out.point = ray.ray.intersectPlane(plane, out.at); out.item = item; out.dir.copy(ray.ray.direction); out.decor = pickWateringDecor(out.point); return out; }
    const point = ray.ray.intersectPlane(plane, new T.Vector3());
    return {point, item, dir:ray.ray.direction.clone(), decor:pickWateringDecor(point)};
  }
  function pickScreen(x, y, out) { const r = canvas.getBoundingClientRect(); return pickNdc((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1, out); }
  const pickCenter = out => pickNdc(0, 0, out);
  function currentAim(out) {
    if (isLocked()) return pickCenter(out);
    if (lockFallback && mouse.inside) return pickScreen(mouse.x, mouse.y, out);
    return null;
  }
  function pickupFrom(aim) {
    const it = aim?.item; if (!it) return null;
    const m = itemMeshes.get(it.token), p = m ? m.position : it;
    return Math.hypot(p.x - physics.x, p.z - physics.z) <= PICKUP_REACH ? it : null;
  }
  // ---------- Watering (cups, purifier, palm planters) ----------
  const WATER_WHY = {cup:'Point at the sea to scoop water', saltcup:'Pour it into a water purifier', freshcup:'Point at a palm planter'};
  const CUP_KINDS = ['cup', 'saltcup', 'freshcup'];
  const FUEL_NAMES = {wood:'plank', leaf:'palm leaf', seaweed:'seaweed'};
  function pickWateringDecor(point) {
    if (wateringGroups.size) {
      for (const hit of ray.intersectObjects([...wateringGroups.values()], true)) {
        if (hit.distance > 6) break;
        let o = hit.object; while (o && !o.userData.tileKey) o = o.parent;
        const d = o && world.decor.find(d => tileKey(d.x, d.z) === o.userData.tileKey);
        if (d) return {key:tileKey(d.x, d.z), type:d.type, x:d.x, z:d.z};
      }
    }
    if (!point) return null;
    const x = Math.round(point.x / 2), z = Math.round(point.z / 2), d = world.decor.find(d => d.x === x && d.z === z && (d.type === 'palm' || d.type === 'purifier' || d.type === 'rainbarrel' || d.type === 'sprinkler'));
    return d ? {key:tileKey(x, z), type:d.type, x, z} : null;
  }
  function wateringTarget(aim) {
    if (!aim) return null;
    const kind = selectedKind(), cupHeld = CUP_KINDS.includes(kind), d = aim.decor;
    if (d && Math.hypot(d.x * 2 - physics.x, d.z * 2 - physics.z) <= USE_REACH) {
      if (d.type === 'rainbarrel' || d.type === 'sprinkler') return rainTarget(world, d, kind, (content?.rain() ?? 0) > .2); // rain-sprinkler
      const at = {x:d.x, z:d.z}, none = {prompt:'', click:null, e:null, why:null};
      if (d.type === 'purifier') {
        const e = world.purifiers?.[d.key], cupIn = !!e && e.cup !== 0, fuel = e?.fuel ?? 0, burn = purifierFuel(kind);
        if (cupIn && e.ready) return {prompt:'<kbd>E</kbd>Take fresh water', click:cupHeld ? {kind:'takeWater', ...at} : null, e:{kind:'takeWater', ...at}, why:null};
        if (burn) { // plank / palm leaf in hand: feed the fire (Raft: 1 plank = 50 s)
          const name = FUEL_NAMES[kind] ?? kind;
          if (fuel + burn > FUEL_CAP) { const t = `Fire is full (fuel ${clockText(fuel)})`; return {...none, prompt:t, why:t}; }
          return {prompt:`<kbd>E</kbd>Add ${esc(name)} (fuel ${clockText(fuel)})`, click:null, e:{kind:'fuelPurifier', item:kind, ...at}, why:null};
        }
        if (!cupIn) return kind === 'saltcup' ? {prompt:'<kbd>E</kbd>Pour in sea water', click:{kind:'loadPurifier', ...at}, e:{kind:'loadPurifier', ...at}, why:null}
          : {...none, prompt:fuel ? `Purifier: needs a cup of sea water (fuel ${clockText(fuel)})` : 'Purifier: needs sea water and a plank', why:'Purifier: needs a cup of sea water'};
        const t = fuel > 0 ? `Purifying… ${clockText(PURIFY_SECONDS - e.t)} (fuel ${clockText(fuel)})` : 'Purifier: needs fuel (hold a plank)';
        return {...none, prompt:t, why:t};
      }
      const g = world.garden?.[d.key], stage = plantStage(g);
      if (stage === 2) return {prompt:'<kbd>E</kbd>Harvest palm', click:cupHeld ? {kind:'harvestPlant', ...at} : null, e:{kind:'harvestPlant', ...at}, why:null};
      if (g?.water === 1) return {...none, prompt:'Growing… (watered)', why:'Growing… (watered)'};
      if (kind === 'freshcup') return {prompt:'<kbd>Click</kbd>Water the planter', click:{kind:'waterPlant', ...at}, e:{kind:'waterPlant', ...at}, why:null};
      const t = kind === 'saltcup' ? 'Plants want fresh water' : 'Palm planter: needs fresh water';
      return {...none, prompt:t, why:t};
    }
    const p = aim.point;
    if (kind === 'cup' && p && !hasTile(Math.round(p.x / 2), Math.round(p.z / 2))) {
      if (Math.hypot(p.x - physics.x, p.z - physics.z) > FILL_REACH) return {prompt:'', click:null, e:null, why:'Try a spot a little closer'};
      return {prompt:'<kbd>Click</kbd>Scoop sea water', click:{kind:'fillCup', x:p.x, z:p.z}, e:null, why:null};
    }
    return null;
  }
  const rainFrustum = new T.Frustum(), rainMat = new T.Matrix4(), rainSphere = new T.Sphere(new T.Vector3(), 1.2); // rain-sprinkler: spray only in view
  function updateWateringVisuals() {
    let raining = false;
    if (camera && (world.collectors || world.sprinklers)) { raining = (content?.rain() ?? 0) > .2; camera.updateMatrixWorld(); rainFrustum.setFromProjectionMatrix(rainMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)); }
    for (const [k, g] of wateringGroups) {
      if (g.userData.craftType === 'rainbarrel') { paintRainBarrel(g, world.collectors?.[k], raining, elapsed); continue; } // rain-sprinkler
      if (g.userData.craftType === 'sprinkler') { g.getWorldPosition(rainSphere.center); paintSprinkler(g, world.sprinklers?.[k], elapsed, !!camera && rainFrustum.intersectsSphere(rainSphere)); continue; } // rain-sprinkler
      if (g.userData.craftType === 'purifier') paintPurifier(g, world.purifiers?.[k], elapsed);
      else paintPlanter(g, plantStage(world.garden?.[k]), world.garden?.[k]?.water === 1);
    }
  }
  // Returns null when the cell is not a build spot at all, else {x, z, blocked} with `blocked` ('bound' | 'cap' | 'reach' |
  // 'nofloor') when refused, null when it can be built. Runs every frame, so it fills one reused result (read it right away).
  const placed = {x:0, z:0, blocked:null};
  function placementFor(kind, p) {
    if (!p) return null; const x = Math.round(p.x / 2), z = Math.round(p.z / 2);
    let why;
    if (kind === 'hammer') why = floorBlock(world.tiles, x, z);
    else if (DECOR_TYPES.includes(kind)) { if (fc?.hasGrill(x, z)) return null; why = decorBlock(world.tiles, world.decor, x, z); } // [fishing-cooking] grill tiles
    else return null;
    if (why === 'nofloor' && !nearDeck(x, z)) return null; // just off the deck edge still shows a red ghost instead of nothing
    if (why && !BLOCK_TEXT[why]) return null;
    if (!why && !inReach(physics.x, physics.z, x, z)) why = 'reach';
    if (!why && kind !== 'hammer') { // never drop a prop on a player
      const inWay = playerInWay(decorBlockers({type:kind, x, z, rot:placeRot}, BLOCK_RADIUS), [physics, other], PLAYER_CONSTANTS.BODY_RADIUS + .05);
      if (inWay >= 0) why = inWay === 0 ? 'self' : 'brother';
    }
    placed.x = x; placed.z = z; placed.blocked = why || null; return placed;
  }
  function nearDeck(x, z) { for (const [a, b] of NEIGHBOURS) if (hasTile(x + a, z + b)) return true; return false; }
  function placementCandidates(kind) {
    const out = [], ok = (x, z) => inReach(physics.x, physics.z, x, z);
    if (kind === 'hammer') { const seen = new Set(); for (const [tx, tz] of world.tiles) for (const [a, b] of NEIGHBOURS) { const x = tx + a, z = tz + b, k = x + ',' + z; if (!seen.has(k) && !floorBlock(world.tiles, x, z) && ok(x, z)) { seen.add(k); out.push({x, z}); } } }
    else if (DECOR_TYPES.includes(kind)) for (const [x, z] of world.tiles) if (!decorBlock(world.tiles, world.decor, x, z) && !fc?.hasGrill(x, z) && ok(x, z)) out.push({x, z});
    return out;
  }
  let placeRot = 0, pointing = false; // decor placement rotation (radians) and the pointing-hand pose
  function rotatePlacement(step) { placeRot = Math.round(wrapRot(placeRot + step) * 1000) / 1000; play('ui', .6); }

  // ---------- Actions (host is authoritative; actor = 'host' | 'guest') ----------
  function send(data) { if (coop) data = coop.encode(data); if (data && conn?.open) { try { conn.send(data); } catch {} } } // coop: delta-encode
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
    if (e.kind === 'ate') { if (fainted < 0 && consumeVitals(vitals, e.item)) gulp(!isDrink(e.item)); return; } // [vitals] [juicer] isDrink
    if (e.kind === 'shark') { sharkEffect(e); return; } // shark lane
    if (prog?.effect(e)) return; // [progression-hook]
    if (e.loot && typeof e.loot === 'object') { for (const [k, n] of Object.entries(e.loot)) if (ITEM_INFO[k] && isInt(n) && n > 0) pickupFeed.add(k, n); } // pickup feed rows with icons
    else if (typeof e.text === 'string' && e.text) notice(e.text.slice(0, 90));
    if (e.kind === 'note' || e.kind === 'achievement') logbookUI?.celebrate?.(e);
    play(typeof e.sound === 'string' ? e.sound : e.kind === 'signal' || e.kind === 'note' || e.kind === 'achievement' ? 'catch' : e.kind === 'build' ? 'build' : e.kind === 'craft' ? 'craft' : e.kind === 'loot' ? 'collect' : 'deny', e.kind === 'notice' ? .6 : 1);
    if (e.kind === 'loot') hintDone('loot');
    if (e.kind === 'build') hintDone('build');
  }
  function collectBottle(i, a, bag, actor) { // no bag space needed; does not count toward world.collected
    const n = nextNote(world.notes); if (n >= 0) world.notes.push(n); // before makeItem: the 12th note must not respawn a (now empty) bottle
    world.items.splice(i, 1); world.items.push(makeItem(a.id)); syncItems();
    if (typeof a.cast === 'string' && a.cast && wornCasts[actor] !== a.cast) { wornCasts[actor] = a.cast; wearHook(bag, a.slot, actor); }
    if (n < 0) { emit({kind:'notice', text:'An empty bottle. Someone out there says hi!'}, actor); return; }
    emit({kind:'note', note:n, text:`Message in a bottle! (${world.notes.length}/${NOTE_COUNT}) · L to read`}, 'all');
    award({kind:'note'});
  }
  function award(ev, quiet = false) {
    if (role === 'guest') return [];
    const ids = evaluate(world, [hostBag, guestBag], ev); if (!ids.length) return ids;
    world.achievements.push(...ids);
    if (!quiet) for (const id of ids) emit({kind:'achievement', id, text:'Achievement: ' + achievementName(id)}, 'all');
    return ids;
  }
  function retroAward() {
    const ids = award({kind:'retro'}, true);
    if (ids.length) notice(ids.length === 1 ? 'Achievement: ' + achievementName(ids[0]) : `Logbook: ${ids.length} achievements from your voyage so far`, 3200);
  }
  // Host-side validation for cup / purifier / planter actions (logic in watering.js).
  function applyWatering(a, actor, bag) {
    const p = actor === 'guest' ? other : physics; if (!p) return;
    let r;
    if (a.kind === 'fillCup') {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || Math.abs(a.x) >= 120 || Math.abs(a.z) >= 120) return;
      if (hasTile(Math.round(a.x / 2), Math.round(a.z / 2)) || Math.hypot(a.x - p.x, a.z - p.z) > FILL_REACH + HOST_SLACK) return;
      r = fillCup(world, bag);
    } else {
      if (!isInt(a.x) || !isInt(a.z) || Math.hypot(a.x * 2 - p.x, a.z * 2 - p.z) > USE_REACH + HOST_SLACK) return;
      const key = tileKey(a.x, a.z);
      r = a.kind === 'loadPurifier' ? loadPurifier(world, key, bag) : a.kind === 'takeWater' ? takeWater(world, key, bag)
        : a.kind === 'fuelPurifier' ? fuelPurifier(world, key, bag, typeof a.item === 'string' ? a.item : '')
        : a.kind === 'waterPlant' ? waterPlant(world, key, bag) : harvestPlant(world, key, bag, rand);
    }
    emit({kind:r.ok ? r.kind : (r.reason === 'full' ? 'full' : 'notice'), text:r.text}, actor);
  }
  function applyRain(a, actor, bag) { // rain-sprinkler: host-side validation (logic in rain.js)
    const p = actor === 'guest' ? other : physics; if (!p) return;
    if (!isInt(a.x) || !isInt(a.z) || Math.hypot(a.x * 2 - p.x, a.z * 2 - p.z) > USE_REACH + HOST_SLACK) return;
    const key = tileKey(a.x, a.z), r = a.kind === 'takeRain' ? takeRain(world, key, bag) : fillSprinkler(world, key, bag);
    emit({kind:r.ok ? r.kind : (r.reason === 'full' ? 'full' : 'notice'), text:r.text}, actor);
  }
  function nodeTaken(id, to) { // diving lane hook: own message type so older clients simply ignore it
    if (to !== 'guest') diving?.markGathered(id);
    if (to !== 'host') send({type:'gathered', id});
  }
  function wearHook(bag, slot, actor) {
    const i = hookIndex(bag, slot); if (i < 0) return;
    const s = bag.slots[i], before = clamp(s.durability ?? MAX_HEALTH, 0, MAX_HEALTH);
    s.durability = Math.max(0, before - (wearPerUse(s.kind) || WEAR_PER_CATCH) * (bag.count('sinker') > 0 ? .5 : 1)); // [progression-hook]; kiln: a Line Sinker in the bag halves hook wear
    if (before > 0 && s.durability === 0) emit({kind:'notice', text:'Hook worn out: shorter throws. R to repair'}, actor);
    else if (before > 25 && s.durability <= 25) emit({kind:'notice', text:'Hook getting worn. R repairs: ' + Object.entries(repairCost(s.kind) ?? REPAIR_COST).map(([k, n]) => n + ' ' + itemName(k)).join(', ')}, actor); // [progression-hook]
  }
  function applyAction(a, actor = 'host') {
    if (!a || typeof a !== 'object' || role === 'guest') return;
    if (prog?.apply(a, actor)) return; // [progression-hook] locked crafts + 'prog:*' actions
    const bag = actorBag(actor);
    if (spearRep?.apply(a, actor, bag)) return; // [spear-repair] 'spearHit' / 'repairTile'
    if (typeof a.kind === 'string' && a.kind.startsWith('fc:')) { fc?.applyAction(a, actor, {count:k => bag.count(k), remove:(k, n) => bag.remove(k, n), add:(k, n) => bag.add(k, n), emit:text => emit({kind:'notice', text}, actor)}); return; } // [fishing-cooking]
    if (a.kind === 'selectSlot') { bag.select(a.index); return; }
    if (paddle?.apply(a, actor, bag)) return; // [paddle] validates the stroker, applies the sail op, wears the paddle
    if (a.kind === 'sail') { const t = sailing?.apply(a, actor); if (t) emit({kind:'notice', text:t}, actor); return; } // [sailing]
    if (a.kind === 'moveSlot') { bag.move(a.from, a.to, a.amount ?? undefined); return; }
    if (a.kind === 'craft') {
      const locked = content?.craftLocked(a.recipe, actor); if (locked) { emit({kind:'notice', text:String(locked)}, actor); return; } // content hook
      const r = bag.craft(a.recipe);
      if (r.ok) emit({kind:'craft', text:`Crafted ${ITEM_INFO[r.crafted.kind]?.name ?? r.crafted.kind}`, loot:{[r.crafted.kind]:r.crafted.count}}, actor);
      else if (r.reason === 'full') emit({kind:'full', text:'Your bag is full'}, actor);
      else if (r.reason === 'missing') emit({kind:'notice', text:'Need ' + r.missing.map(m => `${m.count} more ${itemName(m.kind)}`).join(' and ')}, actor);
      if (r.ok) award({kind:'craft', crafted:r.crafted.kind});
      return;
    }
    if (a.kind === 'collect') {
      const i = world.items.findIndex(it => it.id === a.id && it.token === a.token); if (i < 0) return; // token guard: each supply counts once
      if (world.items[i].type === 'bottle') { collectBottle(i, a, bag, actor); return; }
      const it = world.items[i]; if (it.type === 'cache' && a.net) return; // nets never take the signal cache
      const isCache = it.type === 'cache', loot = isCache ? cacheLoot(countAntennas(world.decor), Math.random) : it.type === 'barrel' ? rollBarrel(Math.random, prog?.barrelLuck) : LOOT[it.type]; if (!loot) return; // [progression-hook] barrel table
      if (actor === 'guest' && !a.net && ownHeldTokens().has(it.token)) return; // on the host's hook: the host claimed it first
      const scratch = new Bag(bag.snapshot());
      for (const [k, n] of Object.entries(loot)) if (scratch.add(k, n) > 0) { // atomic: all loot fits or nothing changes
        if (!a.net) emit({kind:'full', text:'Your bag is full', tokens:[it.token]}, actor);
        return;
      }
      commit(bag, scratch);
      world.collected++; world.items.splice(i, 1); if (isCache) onCacheCollected(world); else world.items.push(makeItem(a.id)); syncItems();
      if (typeof a.cast === 'string' && a.cast && wornCasts[actor] !== a.cast) { wornCasts[actor] = a.cast; wearHook(bag, a.slot, actor); }
      if (isCache) emit({kind:'build', text:'Signal cache recovered!'}, actor === 'host' ? 'guest' : 'host');
      if (!a.net) emit({kind:'loot', text:(isCache ? 'Signal cache! + ' : '+ ') + Object.entries(loot).map(([k, n]) => `${n} ${itemName(k)}`).join(' · '), loot}, actor);
      award({kind:'collect'});
      return;
    }
    if (a.kind === 'build') {
      let placedText = null;
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
        if (decorBlock(world.tiles, world.decor, a.x, a.z)) return; if (fc?.hasGrill(a.x, a.z)) return; // [fishing-cooking] grill tiles
        const inWay = playerInWay(decorBlockers({type:a.recipe, x:a.x, z:a.z, rot:a.rot}, BLOCK_RADIUS), [physics, other], PLAYER_CONSTANTS.BODY_RADIUS); // host pose, guest pose
        if (inWay >= 0) { emit({kind:'notice', text:BLOCK_TEXT[(inWay === 0) === (actor === 'host') ? 'self' : 'brother']}, actor); return; }
        if (a.recipe === 'receiver' && world.decor.some(d => d.type === 'receiver')) { emit({kind:'notice', text:'Your raft already has a receiver'}, actor); return; }
        const sel = bag.slots[bag.selectedIndex];
        if (sel?.kind === a.recipe) { sel.count--; if (sel.count <= 0) bag.slots[bag.selectedIndex] = null; }
        else if (!bag.remove(a.recipe, 1)) { emit({kind:'notice', text:`Craft a ${itemName(a.recipe)} first`}, actor); return; }
        const antennasBefore = countAntennas(world.decor);
        const rot = Number.isFinite(a.rot) ? Math.round(wrapRot(a.rot) * 1000) / 1000 : 0;
        world.decor.push(rot ? {type:a.recipe, x:a.x, z:a.z, rot} : {type:a.recipe, x:a.x, z:a.z});
        if (a.recipe === 'antenna') { const n = countAntennas(world.decor); placedText = n > antennasBefore ? `Antenna placed · signal ${n}/3` : antennasBefore >= 3 ? 'Antenna placed' : 'Antenna placed (put it 2+ tiles from the receiver)'; }
      } else return;
      rebuildRaft(); fitShadow(); emit({kind:'build', text:placedText ?? (a.recipe === 'floor' ? 'A little more room!' : `${ITEM_INFO[a.recipe].name} placed`), sound:a.recipe === 'floor' ? 'build' : 'place'}, 'all');
      award({kind:'build'});
      return;
    }
    if (a.kind === 'piecetoggle' && building) { const r = building.toggle(a, world, actor === 'guest' ? other : physics, [physics, other], deckY()); if (r.ok) emit({kind:'build', text:r.text, sound:'place'}, 'all'); else if (r.text) emit({kind:'notice', text:r.text}, actor); return; } // [buildpack] host opens / closes a hatch or gate
    if ((a.kind === 'piece' || a.kind === 'unpiece') && building) { // building-pieces lane hook
      const r = building.apply(a, bag, world);
      if (r.ok) emit({kind:'build', text:r.text}, 'all'); else if (r.text) emit({kind:'notice', text:r.text}, actor);
      return;
    }
    if (a.kind === 'gather') { // diving lane hook: seafloor node, validated by id + diver distance
      const n = nodeById(a.id, islands), p = actor === 'guest' ? other : physics; if (!n || !p || p.y == null) return;
      if (gatheredIds.has(n.id) || diving?.seafloor?.isGathered?.(n.id)) { nodeTaken(n.id, actor); return; } // tell a stale client it is gone
      if (Math.hypot(n.x - p.x, n.y - p.y, n.z - p.z) > DIVE.REACH + 1.5) return;
      const scratch = new Bag(bag.snapshot()), loot = NODE_LOOT[n.type];
      for (const [k, c] of Object.entries(loot)) if (scratch.add(k, c) > 0) { emit({kind:'full', text:'Your bag is full'}, actor); return; }
      commit(bag, scratch); gatheredIds.add(n.id); later(() => gatheredIds.delete(n.id), DIVE.REGROW * 1000); nodeTaken(n.id, 'all');
      emit({kind:'loot', text:'+ ' + Object.entries(loot).map(([k, c]) => `${c} ${itemName(k)}`).join(' · ')}, actor); return;
    }
    if (a.kind === 'fish') {
      if (bag.count('fishingrod') < 1) return;
      if (bag.add('fish', 1) > 0) { emit({kind:'full', text:'Bag full: the fish swam away'}, actor); return; }
      world.fish++; emit({kind:'loot', text:'You caught a fish!', loot:{fish:1}}, actor);
      award({kind:'fish'}); return;
    }
    if (a.kind === 'repair') {
      const i = repairHookSlot(bag.slots, a.slot, MAX_HEALTH);
      if (i < 0) { emit({kind:'notice', text:'No hook to repair'}, actor); return; }
      if ((bag.slots[i].durability ?? MAX_HEALTH) >= MAX_HEALTH) { emit({kind:'notice', text:'Your hook is in great shape'}, actor); return; }
      const cost = repairCost(bag.slots[i].kind) ?? REPAIR_COST; // [progression-hook]
      if (!spend(bag, cost)) { emit({kind:'notice', text:'Repair needs ' + missingText(bag, cost)}, actor); return; }
      bag.slots[i].durability = MAX_HEALTH; emit({kind:'build', text:'Hook repaired!', sound:'repair'}, actor);
      award({kind:'repair'}); return;
    }
    if (a.kind === 'eat') { // [vitals] host removes the item (and gives the cup back); the eater applies the bars on 'ate'
      const k = a.item; if (!isEdible(k) || bag.count(k) < 1) return;
      const s = new Bag(bag.snapshot()); if (!s.remove(k, 1)) return;
      const back = FOOD[k].returns; if (back && s.add(back, 1) > 0) { emit({kind:'full', text:'No room for the empty cup'}, actor); return; }
      commit(bag, s); emit({kind:'ate', item:k}, actor); return;
    }
    if (a.kind === 'shark:loot') { // shark lane: harvest the floating body (E)
      const p = actor === 'guest' ? other : physics;
      if (!shark || !p || !lootable(shark.sim) || shark.distanceTo(p.x, p.z) > SHARK.HARVEST_REACH + (actor === 'guest' ? 1.5 : .01)) return;
      const scratch = new Bag(bag.snapshot());
      for (const [k, n] of Object.entries(SHARK_LOOT)) if (scratch.add(k, n) > 0) { emit({kind:'full', text:'Your bag is full'}, actor); return; }
      commit(bag, scratch); shark.harvest();
      emit({kind:'loot', text:'+ ' + Object.entries(SHARK_LOOT).map(([k, n]) => `${n} ${itemName(k)}`).join(' · ')}, actor);
      return;
    }
    if (a.kind === 'shark:hit') { // shark lane: a guest's spear hit (the host's own hits go straight to the sim)
      const p = actor === 'guest' ? other : physics, now = performance.now();
      if (!shark || !p || !Number.isFinite(a.dmg) || now - sharkHitAt[actor] < 250 || shark.distanceTo(p.x, p.z) > 6) return;
      sharkHitAt[actor] = now; shark.applyHit(a.dmg); return;
    }
    if (content?.action(a, actor, bag)) return; // content hook: module actions (chest, research, gather…)
    if (WATER_ACTIONS.includes(a.kind)) { applyWatering(a, actor, bag); return; }
    if (RAIN_ACTIONS.includes(a.kind)) { applyRain(a, actor, bag); return; } // rain-sprinkler
    // 'wear' (legacy clients wore the hook on every throw) is ignored: wear now happens only on a successful catch.
  }

  // Inventory UI and hotbar. The guest predicts locally; the host snapshot (acked by seq) is canonical.
  function selectSlot(i) {
    if (!isInt(i) || i < 0 || i >= HOTBAR) return;
    const bag = localBag(); if (bag.selectedIndex === i) return;
    charging = null; hover = null; play('ui', .5); if (hintsDone.has('bag')) hintDone('slots');
    if (!reelCast('slot') && hook && !hook.fishing) { hook.cancel?.(); endHook(); } // switching away retracts the hook; its catch stays in the sea
    if (role === 'guest') { if (!networkReady) return; bag.select(i); action({kind:'selectSlot', index:i}); }
    else action({kind:'selectSlot', index:i});
  }
  function moveSlot(from, to, amount) {
    const a = {kind:'moveSlot', from, to}; if (isInt(amount)) a.amount = amount;
    if (role === 'guest') { if (!networkReady) return; localBag().move(from, to, a.amount); }
    action(a);
  }
  function craft(recipe) { if (typeof recipe === 'string') action({kind:'craft', recipe}); }
  function repair() { if (!running) return; const bag = localBag();
    const sel = bag.slots[bag.selectedIndex]; if (sel?.kind === 'spade') { action({kind:'treasure.repair'}); return; } // [treasure-hook] R on a held spade
    action({kind:'repair', slot:repairHookSlot(bag.slots, bag.selectedIndex, MAX_HEALTH)}); }
  // Pad build radial pick: hold the hammer (from the hotbar) and select that piece on the building wheel.
  function pickBuildPiece(id) {
    if (!running || !building || !Object.hasOwn(PIECES, id)) return;
    const slots = localBag().slots, i = selectedKind() === 'hammer' ? localBag().selectedIndex : slots.findIndex((s, k) => k < HOTBAR && toolRole(s?.kind ?? null) === 'hammer');
    if (i < 0) { notice('Put a hammer on your hotbar to build'); return; }
    selectSlot(i); building.menu.setSelected(id); notice(PIECES[id].name + ' selected', 1200);
  }
  function openInventory() { if (!running || !survivalUI) return; pauseInput(); releaseLock(); survivalUI.open?.(); play('open'); hintDone('bag'); }
  function interact() {
    if (!running || uiBlocked() || diving?.state.diving) return; // diving lane hook: E gathers underwater
    if (!pickupFrom(currentAim()) && sailing?.interact()) return; // [sailing] E on a sail / anchor (pick-up wins)
    const target = pickupFrom(currentAim());
    if (target) {
      if (guestWaiting()) { notice('Wait for your raft to connect'); return; }
      pending.set(target.token, performance.now() + PENDING_MS); swing = .6;
      action({kind:'collect', id:target.id, token:target.token});
      return;
    }
    if (canHarvestShark()) { if (guestWaiting()) { notice('Wait for your raft to connect'); return; } swing = .6; action({kind:'shark:loot'}); return; } // shark lane
    const w = wateringTarget(currentAim()); if (w?.e) { if (guestWaiting()) { notice('Wait for your raft to connect'); return; } action(w.e); swing = .6; return; } // same order as the updateContext prompt: water action beats content / grill
    const pt = building?.interact(camera.position, currentAim(), deckY()); if (pt) { if (guestWaiting()) { notice('Wait for your raft to connect'); return; } swing = .4; action(pt); return; } // [buildpack] E opens / closes a hatch or gate
    if (content?.interact(currentAim())) return; // content hook: chest, research table, island nodes
    if (fc?.interact()) return; // [fishing-cooking] grill
    if (prog?.interact(currentAim())) return; // [progression-hook] smelter / grill / research table in reach
    openInventory();
  }

  // Left click uses the selected bag item. The hook uses charge/throw/reel below.
  function useSelected(aim) {
    if (!running || hook || fishWait || eating || fainted >= 0) return;
    if (guestWaiting()) { notice('Wait for your raft to connect'); return; }
    const kind = selectedKind(), bag = localBag(), p = aim?.point ?? null;
    if (instruments?.use(kind)) { swing = .7; return; } // [instruments]
    if (kind === 'paddle' && paddle?.use()) return; // [paddle] stroke at the raft edge
    if (kind === 'spear' ? spearRep?.use() : kind === 'hammer' && spearRep?.useHammer()) return; // [spear-repair] thrust / repair a damaged tile
    if (isEdible(kind)) { // [vitals] a fresh cup on a planter still waters it, a salt cup at a purifier still loads it
      const w = CUP_KINDS.includes(kind) ? wateringTarget(aim) : null;
      if (w?.click) { swing = 1; action(w.click); } else startEat(kind);
      return;
    }
    if (kind === 'hammer' && building && building.piece !== 'foundation') { // building-pieces lane hook
      if (building.removing) return;
      const a = building.use(); if (a) { swing = 1; action(a); } else notice('Point at a green spot'); return;
    }
    if (kind === 'hammer' || DECOR_TYPES.includes(kind)) {
      const v = placementFor(kind, p);
      if (!v) { notice(kind === 'hammer' ? 'Point at an empty space beside the raft' : 'Point at an empty raft floor'); return; }
      if (v.blocked) { notice(BLOCK_TEXT[v.blocked]); return; }
      if (kind === 'hammer' && !canAfford(bag, FLOOR_COST)) { notice('Floor needs ' + missingText(bag, FLOOR_COST)); return; }
      swing = 1; ghostHold = {kind, x:v.x, z:v.z, rot:kind === 'hammer' ? 0 : placeRot}; action({kind:'build', recipe:kind === 'hammer' ? 'floor' : kind, x:v.x, z:v.z, ...(kind !== 'hammer' && placeRot ? {rot:placeRot} : {})}); return;
    }
    if (kind === 'fishingrod') {
      if (!p || hasTile(Math.round(p.x / 2), Math.round(p.z / 2))) { notice('Point at the water to fish'); return; }
      if (Math.hypot(p.x - physics.x, p.z - physics.z) > FISH_REACH) { notice('Try a spot a little closer'); return; }
      fishWait = 3 + Math.random() * 2; hook = {end:new T.Vector3(p.x, .1, p.z), t:0, duration:fishWait + .8, fishing:true};
      swing = 1; noticeUntil = 0; play('throw', .5); // the context prompt shows the wait
    }
    if (content?.use(aim, kind)) { swing = 1; return; } // content hook (paint brush)
    if (kind === 'cup' || kind === 'saltcup' || kind === 'freshcup') { const w = wateringTarget(aim); if (w?.click) { swing = 1; action(w.click); } else notice(w?.why ?? WATER_WHY[kind]); return; }
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
    if (toolRole(slot?.kind) !== 'hook') return; // [progression-hook] metalhook throws too
    const durability = clamp(slot.durability ?? MAX_HEALTH, 0, MAX_HEALTH), maxRange = 16 + durability * .16;
    const direction = (aim?.dir ?? camera.getWorldDirection(new T.Vector3())).clone();
    direction.y += THROW_LOFT; direction.normalize(); // a little loft so a level throw carries
    hook = new HookCast(T, {origin:throwOrigin(handPos, new T.Vector3()), direction, maxRange, charge, deck:deckAt});
    castId = newToken(); hookSlot = idx; lastCaughtCount = 0; reeling = false; swing = 1; play('throw', charge); hintDone('throw');
    if (durability <= 0) notice('Worn hook: shorter throws. R to repair');
  }

  function start() {
    if (adoptOnStart({running, role, storedRev:storedRev(), saveRev})) adoptStoredSave();
    running = true; const w = $('#welcome'); if (w) w.hidden = true; const h = $('#hud'); if (h) h.hidden = false;
    if (!saveAvailable) setText('#saveStatus', 'Browser storage is unavailable. This session will not be saved.');
    refreshPointerUI(true);
  }
  // Settings: the quality scaler (quality.js) owns pixel ratio and shadows; the user's render scale and shadow
  // switch are applied on top of whatever level it picks.
  function applyUserGraphics() {
    if (!renderer || !quality) return;
    const l = quality.levels[quality.level], sc = clamp(options.renderScale ?? 1, .5, 1);
    const pr = l ? Math.max(.5, l.pixelRatio * sc) : null;
    if (pr != null && renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr); // each call resizes the canvas and its MSAA buffers
    if (sun) sun.castShadow = options.shadows !== false && !!l?.shadows;
  }
  function applyOptions(next) {
    options = next; applyVolume(); soundLabel(); // loop-ux: label notes a 0% volume
    if (quality && quality.info.preset !== next.graphics) quality.setCap(next.graphics);
    applyUserGraphics();
  }
  // Pause menu "quit to title": save, leave any crew, show the title. The world stays loaded for Continue.
  function quitToTitle() {
    save(); if (role !== 'solo') closeConnection();
    hook = null; fishWait = 0; clearInput(); releaseLock();
    running = false; const w = $('#welcome'); if (w) w.hidden = false; const h = $('#hud'); if (h) h.hidden = true;
    refreshTitle(); refreshPointerUI(true);
  }
  // Fresh raft: only the hook, starting tiles, new drift. Wipes the solo save.
  function newGame() {
    if (role !== 'solo') closeConnection();
    resetHints(window.localStorage, hintsDone); // first-run hints are once per save, and this is a fresh one
    const w = newWorld(), b = bagsFromWorld(w);
    loadRaft({world:w, host:b.host.snapshot(), guest:b.guest.snapshot(), physics:null}); yaw = 0; pitch = -.28; // lanes reload from the fresh world too
    saveRev = newGameBaseRev(storedRev(), saveRev); unblockSave(); // the player chose to overwrite the stored save
    save(); start();
  }
  const hasSave = () => { try { return !!localStorage.getItem(SAVE); } catch { return false; } };
  function refreshTitle() { // Continue only when a save exists; New game asks twice before wiping one
    const cont = $('#solo'), fresh = $('#newGame'), saved = hasSave();
    if (cont) cont.hidden = !saved;
    if (fresh) { fresh.textContent = saved ? 'New game' : "Let's set sail"; fresh.className = saved ? 'secondary' : 'primary'; delete fresh.dataset.confirm; }
    const note = $('#titleSaveStatus'), text = titleSaveNote({available:saveAvailable, blocked:saveBlocked, storedRev:storedRev(), saveRev});
    if (note) { note.textContent = text; note.hidden = !text; }
  }
  function syncWorldInventories() { // only for the world this client owns (solo / host)
    world.hostInventory = hostBag.snapshot(); world.guestInventory = guestBag.snapshot();
    world.stock = legacyStock(hostBag); world.hookHealth = hookDurability(hostBag);
    world.vitals = saveVitals(vitals); // [vitals]
    if (content) world.ext = content.serialize(); // content hook
    if (shark) world.shark = shark.save(); // shark lane
  }
  function blockSave() {
    if (saveBlocked) return; saveBlocked = true;
    setText('#saveStatus', 'This raft was saved in another tab. This tab stopped saving so it will not overwrite it. Reload to continue from that save.');
    notice('Saved in another tab. This tab stopped saving', 3200);
  }
  function unblockSave() { if (!saveBlocked) return; saveBlocked = false; setText('#saveStatus', SAVE_STATUS); }
  // Leaving the title for play while another tab has saved since: continue from that newer save, not our stale copy.
  function adoptStoredSave() { loadRaft(savedOwnRaft()); saveRev = storedRev(); unblockSave(); }
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
  let swimStroke = 0; // swim stroke sound timer
  const held = (a, b) => !!(keys[a] || (b && keys[b]));
  const moveInput = {forward:0, strafe:0, yaw:0, jump:false, sprint:false, tiles:null, deckY:0, waterY:0, blocked:null}; // reused every frame
  const steps = {n:0, step:0}; // splitSteps fills this every frame (no allocation)
  function movePlayer(frameDt, input) {
    splitSteps(frameDt, .05, .25, steps); // real frame time in equal steps; a long stall must not teleport the player
    const dt = steps.n * steps.step, laneDt = Math.min(dt, .05); // lane hooks keep the old capped frame step
    const ci = controls?.movement(laneDt, running && input, physics); // controls lane: polls input, applies look, shapes movement
    if (!running) { walking = false; return; }
    const fwd = ci ? ci.forward : input ? held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown') : 0, side = ci ? ci.strafe : input ? held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft') : 0;
    const climb = building && !diving?.state.diving ? building.climb(controls?.feel ?? null, physics, deckY(), {forward:fwd, jump:ci ? ci.jump : input && held('Space'), yaw}, dt) : undefined; // [buildpack] ladder (MoveFeel)
    const surf = building ? building.preStep(physics, deckY(), climb) : null; // building-pieces lane hook [buildpack] climb
    const dive = diving?.move(laneDt, physics, {forward:fwd, strafe:side, yaw, pitch, up:ci ? ci.jump : input && held('Space'), down:ci ? !!ci.crouch : input && held('KeyC'), fast:ci ? ci.sprint : input && held('ShiftLeft', 'ShiftRight'), gather:input && (controls ? controls.input.down('interact') : held('KeyE'))}); // diving lane hook
    if (dive && !diveWarmed) warmDive(); // first dive before the idle warm-up ran: compile now, before its first underwater frame
    // Real frame time in equal substeps (<= .05 s) so walking speed holds at low fps. Jump stays held on every
    // substep: PlayerPhysics fires the impulse only on the press edge, i.e. the first substep, never again.
    let ev = null;
    if (!dive) for (let i = 0; i < steps.n; i++) {
      const e = physics.update(steps.step, {forward:fwd, strafe:side, yaw, jump:ci ? ci.jump : input && held('Space'), sprint:ci ? ci.sprint : input && held('ShiftLeft', 'ShiftRight'),
        tiles:surf ? surf.tiles : world.tiles, deckY:surf ? surf.deckY : deckY(), waterY:ocean.getHeight(physics.x, physics.z), blocked:blockList});
      if (e) { if (!ev) ev = e; else for (const k in e) if (e[k] === true) ev[k] = true; } // keep one-shot flags (splashed, landed) from any substep
    }
    controls?.afterMove(laneDt, physics, ev); // controls lane: footstep bob, crouch, landing dip
    building?.postStep(physics, deckY()); // building-pieces lane hook
    content?.afterMove(physics, laneDt); // content hook: e.g. stand on island sand
    const speed = Math.hypot(physics.vx, physics.vz);
    const wasGrounded = physics.grounded, stepFrom = Math.floor(walkPhase / Math.PI);
    exertion = dive || physics.swimming || (speed > 1 && (ci ? ci.sprint : input && held('ShiftLeft', 'ShiftRight'))) ? SPRINT_MULT : 1; // [vitals]
    walking = physics.grounded && speed > .4; if (walking) walkPhase += dt * 9 * Math.min(1.6, speed / 2.6);
    if (walking && Math.floor(walkPhase / Math.PI) !== stepFrom) play('step', clamp(speed / 4, .45, 1));
    if (physics.swimming && speed > .5) { swimStroke += dt; if (swimStroke > .75) { swimStroke = 0; play('swim', .7); } }
    if (ev?.splashed) play('splash'); else if (ev?.landed && !wasGrounded) play('land', .7);
    else if (wasGrounded && !physics.grounded && physics.vy > 1) play('jump', .8);
    if (![physics.x, physics.y, physics.z].every(Number.isFinite)) { const s = spawnPoint(0, 0); physics = new PlayerPhysics({x:s.x, y:deckY() + EYE_OFFSET, z:s.z}); }
  }

  // ---------- Frame ----------
  let chargeWidth = '', hookStage = '';
  const TITLE_FOCUS = new T.Vector3(-5, 0, 2), vmParams = {dt:0, time:0, charge:0, reeling:false, casting:0, walking:false, hasHookOut:false, motion:0};
  const fishPos = new T.Vector3(), hookPos = new T.Vector3(), fishRope = Array.from({length:ROPE_SEGMENTS + 1}, () => new T.Vector3()), freeItems = [], ropeScratch = [];
  const handParams = {dt:0, time:0, charge:0, reeling:false, casting:0, paddle:0, walking:false, hasHookOut:false, motion:0, yaw:0, pitch:0};
  const handPos = new T.Vector3(physics.x, physics.y, physics.z), tmpV = new T.Vector3(), friendTarget = new T.Vector3(), oceanSample = {h:0, sx:0, sz:0};
  const hookParams = {hand:handPos, items:freeItems, reeling:false, time:0}; // freeItems is already filtered for pending items
  // Hook physics floats at a flat WATER_Y; map heights near the water onto the visible waves.
  const deckAt = (x, z) => (hasTile(Math.round(x / 2), Math.round(z / 2)) ? deckY() + .06 : null);
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
    const s = ocean.sample(0, 0, oceanSample, undefined, 2.2), h = s.h - ocean.mesh.position.y;
    const ky = Math.min(1, dt * 2), kr = Math.min(1, dt * 1.5);
    raft.position.y += (h * .3 - raft.position.y) * ky;
    raft.rotation.x += (-s.sz * .35 - raft.rotation.x) * kr;
    raft.rotation.z += (s.sx * .35 + Math.sin(elapsed * .7) * .003 - raft.rotation.z) * kr;
  }
  function updateCamera(dt) {
    const fov = running ? options.fov : 48; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    if (running) {
      const cf = controls?.camera(yaw); // controls lane: replaces the old sine bob with footstep bob + crouch + landing dip
      const bob = cf ? cf.y : walking ? Math.sin(walkPhase) * .025 * options.cameraMotion : 0;
      camera.position.set(physics.x + (cf?.x ?? 0), physics.y + bob, physics.z + (cf?.z ?? 0));
      camera.rotation.set(pitch, yaw, (physics.grounded ? raft.rotation.z * CAMERA_ROLL * options.cameraMotion : 0) + (cf?.roll ?? 0), 'YXZ');
      if (eating) { const k = Math.sin(Math.min(1, eating.t / EAT_SECONDS) * Math.PI); camera.rotation.x -= k * .09; camera.position.y -= k * .035; } // [vitals] hand-to-mouth nod
      if (shakeAmp > .002) { const k = shakeAmp * (.4 + options.cameraMotion); camera.position.x += (Math.random() - .5) * k; camera.position.y += (Math.random() - .5) * k; camera.rotation.z += (Math.random() - .5) * k * .3; shakeAmp *= Math.exp(-dt * 7); } else shakeAmp = 0; // shark lane: bite shake
    } else { // gentle cinematic view for the welcome screen
      const focus = TITLE_FOCUS, d = 23, cy = .68 + Math.sin(elapsed * .05) * .12, cp = .77;
      camera.position.set(focus.x + Math.sin(cy) * d * Math.cos(cp), d * Math.sin(cp), focus.z + Math.cos(cy) * d * Math.cos(cp)); camera.lookAt(focus);
    }
    swing = Math.max(0, swing - dt * 3);
    const kind = heldKind(), motion = options.cameraMotion;
    const ch = charging ? clamp((performance.now() - charging.start) / CHARGE_MS, 0, 1) : 0;
    const vmKind = running ? spearRep?.viewmodelFor(kind) ?? kind : null; // [spear-repair] spear vs metal spear model
    hands.setHeld(vmKind);
    const paddleStroke = paddle?.update(dt) ?? 0; // [paddle] 1 -> 0 over a stroke
    const jab = spearRep?.updateViewmodel(hands, vmKind, dt) ?? false; // [spear-repair] lunge + spear slide; no hook-cast swing while jabbing
    pointing = running && isPlaceable(kind);           // the one place the pointing-finger pose is decided
    hands.setPose(pointing ? 'point' : null);
    const rod = kind === 'fishingrod' ? hands.itemModel('fishingrod') : null, out = !!hook?.fishing;
    if (rod?.userData.float) { rod.userData.float.visible = !out; rod.userData.leader.visible = !out; }
    const hp = handParams; // reused each frame (hands.update only reads it)
    hp.dt = dt; hp.time = elapsed; hp.charge = ch; hp.reeling = rod ? (fc ? fc.rodReeling : out && hook.t > fishWait) : reeling && !!castOut(); hp.casting = jab ? 0 : swing; // [fishing-cooking] rod reel pose from the lane
    hp.paddle = vmKind === 'paddle' ? paddleStroke : 0; // [paddle]
    hp.walking = walking; hp.hasHookOut = !!castOut(); hp.motion = motion; hp.yaw = yaw; hp.pitch = pitch; hp.fov = camera.fov;
    hands.update(hp);
    hands.ropeAnchor().getWorldPosition(handPos); // updates the anchor's parent chain (camera included); render refreshes the rest
  }
  function updateAvatars(dt) {
    player.position.set(physics.x, physics.y - EYE_OFFSET, physics.z); player.rotation.y = yaw + Math.PI;
    player.visible = !running; // in first person we never see our own head or body
    friend.visible = !!other;
    if (other) {
      friendTarget.set(other.x, other.y !== null ? other.y - EYE_OFFSET : deckY(), other.z);
      const before = tmpV.copy(friend.position);
      friend.rotation.y = (other.yaw ?? 0) + Math.PI;
      if (friend.position.distanceTo(friendTarget) > 3) friend.position.copy(friendTarget); else friend.position.lerp(friendTarget, Math.min(1, dt * 12));
      friend.userData.setHeld?.(other.held);
      friend.userData.animate?.(dt, {speed:Math.min(6, Math.hypot(friend.position.x - before.x, friend.position.z - before.z) / dt), swimming:other.swimming, pitch:other.pitch});
    }
  }
  // Reused sets: callers read them synchronously and never keep them (hostState copies).
  const ownHeldSet = new Set(), guestHeldSet = new Set(), allHeldSet = new Set();
  function ownHeldTokens() { ownHeldSet.clear(); const h = castOut(); if (h) for (const c of caughtList(h)) ownHeldSet.add(c.token); return ownHeldSet; }
  function guestHeldTokens() { guestHeldSet.clear(); for (const t of guestHeld.tokens(performance.now())) guestHeldSet.add(t); return guestHeldSet; }
  const otherHeldTokens = () => (role === 'guest' ? hostHeld : guestHeldTokens());
  function allHeldTokens() {
    allHeldSet.clear(); for (const t of ownHeldTokens()) allHeldSet.add(t); for (const t of otherHeldTokens()) allHeldSet.add(t);
    return allHeldSet;
  }
  function updateItems(dt) {
    const heldTokens = allHeldTokens();
    if (sailing) sailing.itemFlow(sailFlow); // [sailing]
    if (role !== 'guest') {
      let respawned = false, maxZ = -Infinity, maxX = -Infinity;
      for (const t of world.tiles) { if (t[1] > maxZ) maxZ = t[1]; const ax = Math.abs(t[0]); if (ax > maxX) maxX = ax; }
      const end = maxZ * 2 + 24, side = maxX * 2 + 24;
      debrisBank.budget = stepDebrisBudget(debrisBank.budget, dt, debrisSpeed(sailFlow.x, sailFlow.z, sailFlow.b)); // [debris-budget]
      for (const it of world.items) {
        if (it.type === 'cache') continue; // the signal cache drifts in signalTick, never respawns
        if (heldTokens.has(it.token)) continue; // a hook (ours or the guest's) holds it; don't let it drift away or respawn
        it.z += dt * sailFlow.b; it.x += Math.sin(elapsed * .13 + it.phase) * dt * .04;
        it.x += sailFlow.x * dt; it.z += sailFlow.z * dt; // [sailing] water flows past a sailing/anchored raft
        const bumped = hasTile(Math.round(it.x / 2), Math.round(it.z / 2)); // [debris-budget] a bump always clears the deck (spending budget if any)
        const gone = !bumped && (sailing ? sailing.outOfRange(it) : it.z > end || Math.abs(it.x) > side);
        if (bumped) spendDebris(debrisBank);
        if (bumped || (gone && spendDebris(debrisBank))) { Object.assign(it, makeItem(it.id)); sailing?.respawned(it); respawned = true; } // [sailing] flow-aware despawn replaces the +z box; [debris-budget] out of range waits for the budget
      }
      if (respawned) syncItems();
    } else for (const it of world.items) if (!heldTokens.has(it.token)) { it.x += sailFlow.x * dt; it.z += (sailFlow.z + sailFlow.b) * dt; } // [sailing] guest dead-reckons debris between host snapshots
    for (const it of world.items) {
      const m = itemMeshes.get(it.token); if (!m) continue;
      m.visible = !isPending(it); m.scale.setScalar(1);
      const u = m.userData;
      if (role === 'guest' && u.sx !== undefined && Math.hypot(it.x - u.sx, it.z - u.sz) < 3) { const k = Math.min(1, dt * 8); u.sx += (it.x - u.sx) * k; u.sz += (it.z - u.sz) * k; }
      else { u.sx = it.x; u.sz = it.z; }
      const s = ocean.sample(u.sx, u.sz, oceanSample);
      m.position.set(u.sx, s.h + ITEM_FLOAT, u.sz);
      m.rotation.set(-s.sz * 1.2 + Math.sin(elapsed * 1.3 + it.phase) * .04, it.phase + elapsed * .08, s.sx * 1.2 + Math.sin(elapsed + it.phase) * .05);
    }
  }
  function endHook() { hook = null; lastCaughtCount = 0; reeling = false; hookFull = false; rope.visible = false; hookMesh.visible = false; if (bobber) bobber.visible = false; }
  // A click or slot change while the rod line is out reels it in: a fish only if it is biting on a click.
  function reelCast(source) {
    const r = castInput(hook, fishWait, source); if (r === 'none') return false;
    if (r === 'catch') action({kind:'fish'});
    fishWait = 0; endHook(); return true;
  }
  function updateHook(dt) {
    if (!hook) { rope.visible = false; hookMesh.visible = false; if (bobber) bobber.visible = false; return; }
    if (hook.stage === 'floating' && hook.base) { hook.base.x += sailFlow.x * dt; hook.base.z += sailFlow.z * dt; } // [sailing] a floating hook drifts with the water
    if (hook.fishing) { // simple bobber animation, separate from HookCast
      hook.t += dt; const f = hook.t / hook.duration, u = Math.min(1, f * 5);
      const pos = fishPos.copy(handPos).lerp(hook.end, u);
      if (u >= 1) pos.y = ocean.getHeight(pos.x, pos.z) + .05 + Math.sin(elapsed * 5) * .03 - (hook.t > fishWait ? .12 : 0); else pos.y += Math.sin(u * Math.PI) * 1.2;
      for (let i = 0; i <= ROPE_SEGMENTS; i++) fishRope[i].copy(handPos).lerp(pos, i / ROPE_SEGMENTS);
      setRope(fishRope); hookMesh.visible = false; bobber.visible = true; bobber.position.copy(pos);
      if (f >= 1) { if (selectedKind() === 'fishingrod') action({kind:'fish'}); fishWait = 0; endHook(); }
      return;
    }
    hookFull = holdForFullBag(hook, c => lootFits(localBag(), catchLoot(c, LOOT))); // full bag: keep the catch on the hook in the water
    // Each side skips the other's catch, but never lets go of what its own hook already holds.
    const ev = hook.update(dt, {hand:handPos, items:hookableItems(world.items, {isPending, otherHeld:otherHeldTokens(), ownHeld:ownHeldTokens()}), reeling:reeling && !hookFull, time:elapsed});
    const hp = hook.position, pos = hookPos.set(hp.x, hook.onDeck ? hp.y : surfaceY(hp.x, hp.z, hp.y), hp.z); // on the planks it rests at deck height
    hookMesh.visible = true; hookMesh.position.copy(pos); bobber.visible = false;
    if (hook.stage === 'flying') hookMesh.rotation.set(-hook.flightT * Math.PI * 2, yaw, 0);
    else if (hook.stage === 'reeling') hookMesh.rotation.set(-.6, yaw, 0);
    else hookMesh.rotation.set(0, yaw, 1.1);
    const pts = hook.ropePoints(handPos, ROPE_SEGMENTS, ropeScratch);
    for (let i = 1; i < pts.length; i++) pts[i].y = surfaceY(pts[i].x, pts[i].z, pts[i].y);
    pts[pts.length - 1].copy(pos); setRope(pts);
    const caught = caughtList(hook);
    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) play('catch'); lastCaughtCount = caught.length; }
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
    } else if (ev?.kind === 'returned') play('catch', .35);
    if (hook.stage === 'floating' && hookStage === 'flying') play('splash', .8);
    if (hook.stage === 'reeling') play('reel', .7);
    hookStage = hook.stage;
    if (hook.stage === 'done') endHook();
  }
  function updateGhost() {
    const kind = heldKind();
    const pieces = kind === 'hammer' && !hook && building && building.piece !== 'foundation'; // building-pieces lane hook
    building?.update(raft, frameAim, camera.position, running && kind === 'hammer' && !hook && !uiBlocked(), localBag(), yaw, deckY());
    spearRep?.updateAim(hook ? null : kind, frameAim); spearRep?.tick(); // [spear-repair]
    hover = frameAim && (kind === 'hammer' || DECOR_TYPES.includes(kind)) && !hook && !pieces && !building?.removing ? placementFor(kind, frameAim.point) : null;
    const floor = kind === 'hammer';
    if (!hover || ghostHold && (ghostHold.kind !== kind || ghostHold.rot !== (floor ? 0 : placeRot) || hover.x !== ghostHold.x || hover.z !== ghostHold.z)) ghostHold = null; // keep the ghost off the piece just placed until the aim moves
    if (!hover || ghostHold) { ghosts.hide(); return; }
    ghosts.show(floor ? 'floor' : kind, hover.x * 2, floor ? .015 : .22, hover.z * 2, floor ? 0 : placeRot, !hover.blocked && !(floor && !canAfford(localBag(), FLOOR_COST)), elapsed);
  }
  function hostState() {
    const c = guestBag.counts();
    return {type:'state', v:3, ack:guestAck, bag:guestBag.snapshot(), other:pose(), held:[...ownHeldTokens()],
      world:{tiles:world.tiles, decor:world.decor, stock:{wood:c.wood, leaf:c.leaf, scrap:c.scrap, plastic:c.plastic}, fish:world.fish, collected:world.collected, hookHealth:hookDurability(guestBag), items:world.items, ext:content ? content.serialize() : world.ext, sailing:world.sailing, signal:world.signal, notes:world.notes, achievements:world.achievements, garden:world.garden, purifiers:world.purifiers, collectors:world.collectors, sprinklers:world.sprinklers, tileHp:world.tileHp, ...(world.pieces !== sentPieces ? {pieces:(sentPieces = world.pieces)} : {})}, ...(shark ? {shark:shark.net().slice()} : {})}; // content hook: ext; shark lane: tileHp + compact shark pose
  }
  const signalOpts = {token:newToken, held:null}; // reused per frame; signalTick reads it synchronously only
  const pose = () => ({x:physics.x, y:physics.y, z:physics.z, yaw, pitch, swimming:physics.swimming, held:heldKind()});
  // Diving shaders (ceiling, bubbles, overlay) compile synchronously: 0-200 ms on software GL. Done at idle time once
  // gameplay frames are on screen instead of during mount; movePlayer() compiles them on the spot if a dive comes first.
  function warmDive() { if (diveWarmed || disposed || !diving) return; diveWarmed = true; diving.warm(renderer); }
  function scheduleDiveWarm() {
    if (diveWarmAt || diveWarmed) return;
    if (typeof requestIdleCallback === 'function') diveWarmAt = requestIdleCallback(() => { diveWarmAt = 0; warmDive(); }, {timeout:3000});
    else diveWarmAt = later(() => { diveWarmAt = 0; warmDive(); }, 400);
  }
  function frame() {
    const now = performance.now(), rawMs = now - last, realDt = rawMs / 1000, dt = Math.min(realDt, .05); last = now; elapsed += dt;
    if (running && !diveWarmed && ++playFrames > 2) scheduleDiveWarm();
    const dialog = uiBlocked();
    if (running && !dialog && !document.hidden && !PIN_QUALITY) quality.tick(rawMs);
    checkPeerStale(now);
    ocean.update(elapsed, camera); sfx.tick(dt, {swimming:physics.swimming});
    updateRaft(dt); if (sailing) sailing.update(dt, elapsed); // [sailing]
    movePlayer(realDt, running && !dialog && fainted < 0); // player substeps the real frame time
    updateAvatars(dt); updateCamera(dt); if (running) diving?.update(dt, elapsed); // diving lane hook
    coop?.update(dt, elapsed); // coop: interpolated remote avatar, rope, ghost, pings, pose stream, reconnect
    frameAim = running && !dialog ? currentAim(aimScratch) : null;
    pickTarget = pickupFrom(frameAim);
    waterAim = pickTarget ? null : wateringTarget(frameAim);
    updateVitals(dt, dialog); updateEatTip(dialog); // [vitals]
    if (vitalsUI) { vitalsUI.update(vitals, running && !disposed && fainted < 0); }
    if (!promptOff && window.raftPrompts?.provide) { try { promptOff = window.raftPrompts.provide({id:'game-context', priority:0, prompt:promptTip}); } catch { promptOff = () => {}; } } // [vitals] eat/drink + watering prompts
    updateItems(dt); updateWateringVisuals(); updateHook(dt); updateGhost();
    content?.update(dt); // content hook
    if (shark) { try { shark.update(dt, elapsed, running); } catch (e) { console.error('shark update failed', e); try { shark.dispose(); } catch {} shark = null; } } // shark lane
    sky?.follow(ocean.uniforms, scene.background); sky?.update(elapsed, camera); // sky dome tracks day/night's horizon, zenith and sun
    if (fc) { try { fc.update(dt, elapsed); } catch (e) { console.error('fishing-cooking update failed', e); try { fc.dispose(); } catch {} fc = null; } } // [fishing-cooking]
    if (instruments) { try { instruments.update(dt); } catch (e) { console.error('instruments update failed', e); try { instruments.dispose(); } catch {} instruments = null; } } // [instruments]
    if (running && role !== 'guest') {
      signalOpts.held = heldTokens(); // our hook only, as before
      const itemCount = world.items.length, sigEvents = signalTick(world, dt, signalOpts);
      for (const e of sigEvents) emit({kind:'signal', text:e.kind === 'detected' ? 'A signal! Something is drifting your way' : 'The signal cache is close: hook it in!'}, 'all');
      if (sigEvents.length || world.items.length !== itemCount) syncItems();
      netClock += dt;
      if (netClock > .8) { // nets gather into the host's bag (trusted shared machine) and never consume when full
        netClock = 0; const heldTokens = allHeldTokens(), fits = it => it.type !== 'cache' && lootFits(actorBag('host'), LOOT[it.type]);
        for (const net of world.decor.filter(d => d.type === 'net')) { const it = pickNetItem(world.items, net, {held:heldTokens, isPending, fits}); if (it) applyAction({kind:'collect', id:it.id, token:it.token, net:true}, 'host'); }
      }
      waterClock += dt; if (waterClock >= 1) { waterClock -= 1; const r = tickWatering(world, 1); tickRain(world, 1, content?.rain() ?? 0); if (r.ripe.length && performance.now() >= noticeUntil) emit({kind:'notice', text:'A palm is ready to harvest'}, 'all'); }
    }
    if (running) { const t = wallTick(now, lastSaveAt, 3000); lastSaveAt = t.next; if (t.due) save(); } // wall clock: dt is capped
    if (conn?.open) { const t = wallTick(now, lastNetSendAt, 120); lastNetSendAt = t.next; if (t.due) send(role === 'host' ? hostState() : {type:'move', me:pose(), held:caughtList(castOut()).map(c => c.token)}); }
    try { prog?.tick(dt); } catch (e) { console.error('progression tick failed', e); } // [progression-hook]
    if (survivalUI && !uiFailed) { try { survivalUI.update?.(); } catch (e) { uiFailed = true; console.error('survival UI update failed', e); } }
    try { logbookUI?.update?.(); } catch (e) { console.error('logbook update failed', e); logbookUI = null; }
    const achList = Array.isArray(world.achievements) ? world.achievements : [];
    if (achList.length !== seenAch || achList !== seenAchList) { seenAch = achList.length; seenAchList = achList; const n = noteAchievements(lookState.unlocked, achList); if (n.length) { saveLook(lookState.look, lookState.unlocked); lookUI?.refresh(); notice('New hat for your Look: ' + n.map(id => LOOK_HATS.find(h => h.id === id)?.label ?? id).join(', ')); } } // [look] hat unlocks (host or guest view of the list)
    refreshPointerUI(); updateCharge(); updateContext(dialog); updateSignalHud(); updateNotices(dialog); warmKinds();
    if (world.fish !== fishShown) { const el = $('#fishCount'); if (el) { el.textContent = world.fish + ' fish caught'; fishShown = world.fish; } }
    // Behind a blurred pause/settings backdrop the world only redraws at ~10 fps (the inventory has no blur).
    const veiled = dialog && !!document.querySelector('dialog[open]:not(#inventory)');
    if (veiled && now - lastDraw < 100) return;
    lastDraw = now;
    renderer.info.reset(); renderer.render(scene, camera); diving?.render(renderer); // perf: manual info reset counts the shadow pass too; diving lane hook
  }
  // Peer liveness. rAF stops in hidden tabs, so a timer keeps the channel warm and each side says when it is
  // hidden; a hidden peer is never timed out (the data channel's 'close' still ends the session).
  function checkPeerStale(now) {
    if (role === 'guest' && networkReady && peerStale(now, lastHostMessage, peerHidden) && !coop?.lost()) { closeConnection(); // coop: try to rejoin first
      toast('Host disconnected. You are back on your own raft.'); }
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
    lookFilter.reset({dropFirst:isLocked()}); // the first move after lock is often a bogus jump
    if (isLocked()) { lockFallback = false; lockFailures = 0; lockNoGesture = false; }
    else { if (charging && charging.x === null) charging = null; reeling = false; if (!lockFallback) fc?.releaseInput(); } // [fishing-cooking] its pointerup may never come
    if (!isLocked() && !lockFallback && building?.menu.isOpen) building.menu.close(false); // building-pieces lane hook
    down = null; refreshPointerUI(true);
  });
  on(document, 'pointerlockerror', lockFailed);
  on(document, 'mousemove', e => {
    if (building?.menu.isOpen) { if (isLocked()) building.menu.move(e.movementX, e.movementY); else building.menu.hoverAt(e.clientX, e.clientY); return; } // building-pieces lane hook
    if (controls || !isLocked() || uiBlocked()) return; // controls lane: input.js owns mouse look
    const [dx, dy] = lookFilter.filter(e.movementX, e.movementY);
    look(dx, dy, LOOK_SENSITIVITY * options.sensitivity);
  });
  on(canvas, 'pointerdown', e => {
    if (e.button === 2 && running && building && heldKind() === 'hammer' && !uiBlocked()) { building.menu.open(); return; } // building-pieces lane hook
    if (e.button === 2 && running && !uiBlocked() && content?.alt(isLocked() ? pickCenter() : currentAim(), heldKind())) return; // content hook (paint: brush colour)
    if (!running || !scene || e.button !== 0 || uiBlocked()) return;
    if (building?.menu.isOpen) { building.menu.close(isLocked()); return; } // building-pieces lane hook (unlocked: a click off the wheel cancels)
    if (controls?.radialOpen) return; // controls lane: a click while the build radial is open picks a piece, not the tool
    if (isLocked()) {
      if (fc?.pointerDown()) return; // [fishing-cooking]
      if (reelCast('click')) return;
      if (castOut()) reeling = true;
      else if (!hook && !fishWait) { if (selectedKind() === 'hook') beginCharge(null); else useSelected(pickCenter()); }
      return;
    }
    if (lockFallback && fc?.pointerDown()) { try { canvas.setPointerCapture(e.pointerId); } catch {} return; } // [fishing-cooking] capture so a release off-canvas still ends the reel hold
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
  on(window, 'pointerup', e => { if (e.button === 2 && building?.menu.isOpen) building.menu.close(true); }); // building-pieces lane hook
  on(canvas, 'pointerup', e => {
    if (e.button !== 0) return;
    reeling = false;
    if (fc?.pointerUp()) { down = null; return; } // [fishing-cooking]
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
  on(window, 'wheel', e => { // window, not canvas: in drag-look the hotbar sits over the canvas and must scroll slots too
    if (!running || uiBlocked() || (!isLocked() && !lockFallback) || !wheelForGame(e.target)) return;
    e.preventDefault();
    const fine = e.shiftKey || e.ctrlKey || e.altKey; // modifier+wheel fine-rotates a held placeable and never changes slot
    if (controls && isLocked() && !fine) return; // controls lane: input.js steps the hotbar while locked (was double-stepping)
    wheelAcc += wheelDelta(e);
    if (Math.abs(wheelAcc) < 40) return;
    const step = wheelAcc > 0 ? 1 : -1; wheelAcc = 0;
    if (fine) { if (DECOR_TYPES.includes(heldKind())) rotatePlacement(step * FINE_STEP); return; }
    selectSlot((localBag().selectedIndex + step + HOTBAR) % HOTBAR);
  }, {passive:false});
  on($('#resumeHint'), 'click', () => requestLock());

  // audio unlocks on the first gesture; every menu button gets the same soft click
  on(window, 'pointerdown', () => { sfx.resume(); }, {capture:true});
  on(window, 'keydown', () => { sfx.resume(); }, {capture:true});
  on(document, 'click', e => { if (e.target?.closest?.('button, [role=button], .slot')) play('ui', .8); });
  on(window, 'keydown', e => {
    const kd = keyDecision({inField:!!e.target?.matches?.('input, textarea, select'), blocked:uiBlocked()});
    if (!kd.act) { if (kd.record && !controls) keys[e.code] = true; return; } // held keys survive a panel; movePlayer gets input=false meanwhile
    if (running && building?.key(e.code, true, heldKind() === 'hammer', e.repeat)) { e.stopImmediatePropagation(); if (e.code === 'KeyX' || e.code === 'KeyR') e.preventDefault(); return; } // building-pieces lane hook
    if (controls) { if (running && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault(); return; } // controls lane: actions come from the action map
    keys[e.code] = true;
    const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
    if (m && running) selectSlot((+m[1] + 9) % 10); // 1..9 then 0 = slot 10
    if (e.code === 'KeyE' && !e.repeat) interact();
    if (e.code === 'KeyR' && !e.repeat) { if (running && DECOR_TYPES.includes(heldKind())) rotatePlacement(e.shiftKey ? FINE_STEP : e.altKey ? -ROT_STEP : ROT_STEP); else if (!sailing?.grab()) repair(); } // [sailing] hold R at a sail to steer; R turns a held decoration (Shift+R in 15 degree steps, Alt+R back)
    if (running && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
  });
  on(window, 'keyup', e => {
    keys[e.code] = false; if (e.code === 'KeyR') sailing?.release(); // [sailing]
    if (e.code === 'KeyX' && building?.removing) { const a = building.removeAction(); if (a && running) { swing = 1; action(a); } } // building-pieces lane hook
  });
  on(window, LIVE_STATUS_EVENT, e => { if (!running || !e.detail?.text) return; notice(e.detail.text); e.preventDefault(); }); // live.js update notices -> feed
  on(window, 'keydown', e => { if (e.key === 'Escape' && !e.repeat) { escHeld = true; relockOnEscUp = false; } }, {capture:true});
  // preventDefault: an unhandled Escape keyup makes Chrome drop the lock it just granted (LOCK-1).
  on(window, 'keyup', e => { if (e.key === 'Escape' && escReleased().preventDefault) e.preventDefault(); }, {capture:true});
  on(window, 'pointerdown', () => { escHeld = relockOnEscUp = false; }, {capture:true}); // a click relocks on its own
  // Focus loss (alt-tab): drop held input and show the hint at the top edge; one click on return relocks.
  on(window, 'blur', () => { clearInput(); escHeld = relockOnEscUp = false; document.body.classList.toggle('away', running); refreshPointerUI(true); }); on(window, 'blur', () => sailing?.release()); // [sailing]
  on(window, 'focus', () => { document.body.classList.remove('away'); refreshPointerUI(true); });
  // controls lane: one input layer for keyboard/mouse/gamepad; falls back to the legacy handlers above if it fails to start.
  try {
    controls = createControls({canvas, isBlocked:() => !running || uiBlocked(), sensitivity:() => options.sensitivity, motion:() => options.cameraMotion / .35,
      look:(dx, dy) => { if (!building?.menu.isOpen) look(dx, dy, 1); }, hotbarSize:HOTBAR, // building wheel steals mouse look while open
      slot:() => localBag().selectedIndex, selectSlot:i => running && selectSlot(i),
      interact, inventory:openInventory, repair:back => { if (running && DECOR_TYPES.includes(heldKind())) rotatePlacement(back ? -ROT_STEP : ROT_STEP); else if (!sailing?.grab()) repair(); }, release:() => sailing?.release(), // [sailing] hold R at a sail to steer; R turns a held decoration
      pause:() => settingsController?.open(),
      buildPieces:() => PIECE_ORDER.map(id => ({id, label:PIECES[id].name})), buildPick:pickBuildPiece, // pad build radial = the hammer's wheel
      menuBack:() => { if (!running) return; if (survivalUI?.isOpen) survivalUI.close(); else if (settingsController?.isOpen) settingsController.close(); }, // pad Y/Start/B: same close + relock as the keyboard
      useDown:() => { if (fc?.pointerDown()) return; if (reelCast('click')) return; if (castOut()) reeling = true; else if (!hook && !fishWait) { if (selectedKind() === 'hook') beginCharge(null); else useSelected(pickCenter()); } },
      useUp:() => { reeling = false; if (fc?.pointerUp()) return; if (charging) releaseCharge(pickCenter()); }, useCancel:() => { reeling = false; if (charging?.x === null) charging = null; fc?.releaseInput(); }, reelDown:() => { if (castOut()) reeling = true; }, reelUp:() => { reeling = false; }});
    signal.addEventListener('abort', () => controls?.dispose());
  } catch (e) { console.error('controls lane failed to start', e); controls = null; }
  on(document, 'visibilitychange', () => { quality?.reset(); });
  on(window, 'beforeunload', () => { save(); send({type:'leaving'}); try { conn?.close(); peer?.destroy(); } catch {} });
  on(document, 'visibilitychange', () => {
    send({type:document.hidden ? 'hidden' : 'visible'}); lastNetSendAt = performance.now();
    if (document.hidden && running) save(); // a hidden tab may be discarded without beforeunload
  });
  on(window, 'pagehide', () => { if (running) save(); });
  on(window, 'storage', e => { // another tab wrote our save key
    if (e.key !== SAVE) return;
    if (storageBlocks({running, role, newRaw:e.newValue, baseRev:saveRev})) blockSave();
    else if (!running) refreshTitle(); // on the title: Continue will adopt the newer save
  });
  on(window, 'resize', () => { if (!camera) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // DOM property handlers: a newer mount simply overwrites these; a failed mount restores the previous ones.
  const propertyHandlers = [];
  const setHandler = (el, prop, fn) => { if (el) { const previous = el[prop], next = guard(fn); propertyHandlers.push([el, prop, previous, next]); el[prop] = next; } };
  function openDialog(id) { releaseLock(); const d = $('#' + id); if (d && !d.open) d.showModal(); }
  setHandler($('#solo'), 'onclick', () => { start(); requestLock(); });
  setHandler($('#newGame'), 'onclick', e => {
    const b = e.currentTarget;
    if (hasSave() && !b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Start over? Click again'; return; }
    newGame(); requestLock(); refreshTitle();
  });
  if (!running) refreshTitle();
  setHandler($('#crewButton'), 'onclick', () => openDialog('crew'));
  setHandler($('#welcomeCrew'), 'onclick', () => openDialog('crew'));
  setHandler($('#welcomeLook'), 'onclick', () => lookUI?.open()); // [look]
  setHandler($('#helpButton'), 'onclick', () => settingsController?.open());
  document.querySelectorAll('[data-close]').forEach(b => setHandler(b, 'onclick', () => $('#' + b.dataset.close)?.close()));
  // Crew/Help closed during play go back to locked play; opened from the pause menu, settings.js reopens it instead.
  for (const id of ['crew', 'help']) on($('#' + id), 'close', e => {
    if (shouldRelockAfterClose({running, locked:isLocked(), blocked:uiBlocked(), returnToPause:!!e.target?.dataset?.fromPause})) requestLock();
  });
  const soundLabel = () => setText('#soundButton', 'Sound: ' + (!sound ? 'off' : options.volume > 0 ? 'on' : 'on (volume is 0%)'));
  setHandler($('#soundButton'), 'onclick', () => { sound = !sound; saveSoundPref(window.localStorage, sound); applyVolume(); soundLabel(); if (sound) sfx.resume(); });
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
    const plan = guestLeavePlan(storedRev(), saveRev); // another tab (e.g. the host in this browser) saved since we joined: never restore over it
    const b = (plan.useBackup ? normaliseBackup(ownWorldBackup) : null) ?? savedOwnRaft(); ownWorldBackup = null; remoteBag = null;
    loadRaft(b);
    if (plan.block) blockSave(); // keep our old rev: that tab keeps saving; Continue from the title adopts its save
  }
  function loadRaft(b) { // b: {world, host, guest, physics|null}
    hook = null; fishWait = 0; charging = null; reeling = false; lastCaughtCount = 0; pending.clear();
    world = b.world; hostBag = snapBag(b.host) ?? new Bag(); guestBag = snapBag(b.guest) ?? new Bag();
    if (b.physics) physics = new PlayerPhysics(b.physics); else { const s = spawnPoint(0, 1.2); physics = new PlayerPhysics({x:s.x, y:deckY() + EYE_OFFSET, z:s.z}); }
    if (!world.items.length) for (let i = 0; i < DEBRIS.POOL; i++) world.items.push(makeItem(i));
    content?.load(world.ext, 'restore'); // content hook
    shark?.clearNet(); shark?.load(world.shark); // shark lane: our own shark again
    if (scene) { syncItems(); rebuildRaft(); fitShadow(); }
    queueMicrotask(guard(retroAward)); // callers set role = 'solo' right after this returns
  }
  function closeConnection() {
    joinTimer = cancelTimer(joinTimer); joinDeadline = 0; networkReady = false; peerHidden = false;
    const oldConn = conn, oldPeer = peer; conn = null; peer = null; other = null; hostHeld = new Set();
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
      } else if (!conn) bindConn(p.connect('little-raft-' + room, {reliable:true, metadata:coop?.meta()}), false); // coop: identity for rejoin
    });
    if (isHost) listen(p, 'connection', c => {
      if (peer !== p) return;
      if (conn?.open && !coop?.isRejoin(c)) { c.on('open', () => c.close()); return; } // room is full (coop: unless the same brother is rejoining)
      if (conn && conn !== c) { const old = conn; unbindTarget(old); try { old.close(); } catch {} }
      bindConn(c, true);
    });
    listen(p, 'error', e => {
      if (peer !== p) return;
      const type = e?.type ?? 'error';
      if (isHost && !p.open && !conn) { closeConnection(); setStatus('Could not open room: ' + type + '. Solo play still works.'); }
      else if (!isHost && !networkReady && coop?.retry()) setStatus('Reconnecting to your brother…'); // coop: keep trying
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
        lastGuestMessage = performance.now(); guestAck = 0; wornCasts.guest = null; peerHidden = false; sentPieces = null;
        networkReady = true; setStatus('Connected! Your brother is aboard.'); setConnectionLabel(`TWO ABOARD · ${room.toUpperCase()}`);
        $('#crew')?.close(); start(); notice('Your brother joined the raft!'); send(hostState());
      } else setStatus('Connected. Loading your brother’s raft…'); // ready only after the first valid state
    });
    listen(c, 'data', data => {
      if (conn !== c || !data || typeof data !== 'object') return;
      if (coop) { data = coop.decode(data); if (!data) return; } // coop: delta decode + coop events
      if (data.type === 'fc') { if (isHost) lastGuestMessage = performance.now(); fc?.onNet(data, isHost ? 'guest' : 'host'); return; } // [fishing-cooking]
      if (data.type === 'inst') { if (isHost) lastGuestMessage = performance.now(); instruments?.onNet(data); return; } // [instruments]
      if (data.type === 'hidden' || data.type === 'visible') peerHidden = data.type === 'hidden';
      if (data.type === 'leaving') { if (isHost) { const old = conn; conn = null; unbindTarget(old); old.close(); other = null; networkReady = false; setConnectionLabel('BROTHER LEFT · ROOM OPEN'); } else closeConnection(); toast('Your brother left the raft.'); return; }
      if (isHost) {
        lastGuestMessage = performance.now();
        if (data.type === 'action' && data.a && typeof data.a === 'object') { applyAction(data.a, 'guest'); if (isInt(data.a.seq) && data.a.seq > guestAck) guestAck = data.a.seq; }
        if (data.type === 'move') { other = validPose(data.me) ?? other; guestHeld.note(cleanHeldTokens(data.held), performance.now()); }
        return;
      }
      if (data.type === 'gathered' && typeof data.id === 'string') { diving?.markGathered(data.id.slice(0, 16)); return; } // diving lane hook
      if (data.type === 'ping' || data.type === 'hidden' || data.type === 'visible') { lastHostMessage = performance.now(); return; }
      if (data.type === 'state') {
        lastHostMessage = performance.now();
        const w = cleanWorld(data.world, true); if (!w) return;
        const first = !networkReady;
        if (!Array.isArray(data.world.pieces) && !first) w.pieces = world.pieces; // building-pieces lane hook: host omits unchanged pieces
        const changed = first || JSON.stringify([world.tiles, world.decor]) !== JSON.stringify([w.tiles, w.decor]), piecesChanged = w.pieces !== world.pieces;
        world = w; other = validPose(data.other); hostHeld = new Set(cleanHeldTokens(data.held));
        if (data.bag) { // canonical bag once the host has applied all of our sent actions
          const acked = first || !isInt(data.ack) || data.ack >= seq || performance.now() - lastSeqSent > ACK_TIMEOUT;
          if (acked) { const b = snapBag(data.bag); if (b) remoteBag = b; }
          remoteBag ??= new Bag(); // never fall back to showing our own raft's bag while aboard
        } else { // older host without personal bags: mirror its shared stock
          const b = Bag.fromCounts(w.stock, {tools:['hook', 'hammer', 'fishingrod']}); if (remoteBag) b.select(remoteBag.selectedIndex); remoteBag = b;
        }
        content?.load(w.ext, 'net'); // content hook
        shark?.applyNet(data.shark); // shark lane: older hosts send none, so no shark is shown
        syncItems(); if (changed && scene) { rebuildRaft(); fitShadow(); } else if (piecesChanged && scene) building?.sync(world); // building-pieces lane hook
        if (first) {
          networkReady = true; joinTimer = cancelTimer(joinTimer); joinDeadline = 0;
          setStatus('Connected! You are aboard your brother’s raft.'); setConnectionLabel(`TWO ABOARD · ${room.toUpperCase()}`);
          const back = !!coop?.rejoined(); // coop: a rejoin keeps our place on the raft
          if (!back) { const s = spawnPoint(1.2, 0); physics = new PlayerPhysics({x:s.x, y:deckY() + EYE_OFFSET, z:s.z}); }
          $('#crew')?.close(); start(); if (!back) toast('You joined your brother’s raft!');
        }
      }
      if (data.type === 'effect') effect(data.e);
    });
    listen(c, 'close', () => {
      if (conn !== c) return;
      unbindTarget(c); conn = null; networkReady = false; other = null; peerHidden = false;
      if (isHost) { setConnectionLabel('BROTHER LEFT · ROOM OPEN'); toast('Your brother left. Your raft is still here.'); return; }
      if (coop?.lost()) return; // coop: dropped, not left: coop.js redials the same room
      joinTimer = cancelTimer(joinTimer); joinDeadline = 0;
      const p = peer; peer = null; unlisten(bindings.splice(0)); try { p?.destroy(); } catch {}
      restoreOwnRaft(); role = 'solo'; setConnectionLabel('DISCONNECTED');
      setStatus('Host disconnected. Rejoin when their tab is open.'); notice('Host disconnected. You are back on your own raft.');
    });
    listen(c, 'error', () => { if (conn === c) setStatus('Connection failed. Check the code and try again.'); });
  }
  // coop: guest reconnect keeps the host's world, our bag and our position on screen while a new peer dials the room.
  function coopRejoin() {
    const oc = conn, op = peer; conn = null; peer = null; networkReady = false; other = null;
    unlisten(bindings.splice(0)); try { oc?.close(); } catch {} try { op?.destroy(); } catch {}
    if (role !== 'guest' || typeof globalThis.Peer !== 'function') return;
    setStatus('Reconnecting to your brother…'); setConnectionLabel('RECONNECTING…');
    try { peer = new globalThis.Peer(); bindPeer(peer, false); } catch {}
  }
  // coop: read-only window into the engine for coop.js
  const coopContext = () => ({T, scene, camera, canvas, ocean, friend,
    role:() => role, conn:() => conn, ready:() => networkReady, blocked:() => !running || uiBlocked(), aim:() => frameAim, deckY,
    local:() => { const k = heldKind(); return {x:physics.x, y:physics.y, z:physics.z, yaw, pitch, swimming:physics.swimming, grounded:physics.grounded, held:k, charge:charging ? chargeValue() : 0, reeling:reeling && !!castOut(),
      hook:hookMesh.visible && hook ? {stage:hook.fishing ? 'fishing' : hook.stage, ...(hook.fishing ? {x:hookMesh.position.x, y:.05, z:hookMesh.position.z} : {x:hook.position.x, y:hook.position.y, z:hook.position.z})} : null, // physics height; remote maps it onto waves
      ghost:hover ? {x:hover.x, z:hover.z, kind:k, ok:k !== 'hammer' || canAfford(localBag(), FLOOR_COST)} : null}; },
    look:() => lookState.look, // [look] coop.js sends the in-memory look (localStorage may be blocked)
    reconnect:coopRejoin, giveUp:() => { closeConnection(); setStatus('Host disconnected. Rejoin when their tab is open.'); }});
  // PeerJS (~93 KB) is only fetched on the first host/join; solo play never loads it. Shared across hot-swapped engines.
  function loadPeer() {
    if (typeof globalThis.Peer === 'function') return Promise.resolve(globalThis.Peer);
    return globalThis.__littleRaftPeerJs ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('./vendor/peerjs.min.js', import.meta.url).href;
      s.onload = () => typeof globalThis.Peer === 'function' ? resolve(globalThis.Peer) : reject(new Error('PeerJS missing'));
      s.onerror = () => { s.remove(); reject(new Error('PeerJS failed to load')); };
      document.head.appendChild(s);
    }).catch(e => { globalThis.__littleRaftPeerJs = null; throw e; }); // allow a retry on the next click
  }
  let netAttempt = 0; // the latest host/join click wins while PeerJS is loading
  setHandler($('#host'), 'onclick', async () => {
    if (role === 'host' && peer && !peer.destroyed) { setStatus('Your room is open. Share the code below.'); return; }
    const attempt = ++netAttempt;
    closeConnection();
    setStatus('Opening your room…');
    let Peer; try { Peer = await loadPeer(); } catch { Peer = null; }
    if (disposed || attempt !== netAttempt) return;
    if (!Peer) { setStatus('Online play is unavailable. Solo play still works.'); return; }
    closeConnection();
    role = 'host'; room = Array.from(crypto.getRandomValues(new Uint8Array(6)), v => 'abcdefghjkmnpqrstuvwxyz'[v % 22]).join('');
    try { peer = new Peer('little-raft-' + room); bindPeer(peer, true); }
    catch { closeConnection(); setStatus('Online play is unavailable. Solo play still works.'); }
  });
  setHandler($('#joinForm'), 'onsubmit', async e => {
    e.preventDefault(); const code = ($('#roomInput')?.value ?? '').trim().toLowerCase();
    if (!/^[a-z]{6}$/.test(code)) return setStatus('Enter the six letters from your brother’s screen.');
    const attempt = ++netAttempt;
    closeConnection();
    setStatus('Finding your brother’s raft…');
    let Peer; try { Peer = await loadPeer(); } catch { Peer = null; }
    if (disposed || attempt !== netAttempt) return;
    if (!Peer) { setStatus('Online play is unavailable. Try solo for now.'); return; }
    closeConnection();
    if (storedRev() <= saveRev) save(); // role is still solo here: persist our own raft, unless another tab saved newer
    ownWorldBackup = {world, host:hostBag.snapshot(), guest:guestBag.snapshot(), physics:physics.capture()};
    role = 'guest'; room = code; hook = null; fishWait = 0; charging = null; reeling = false; remoteBag = null; seq = 0; lastSeqSent = 0;
    try {
      peer = new Peer(); bindPeer(peer, false);
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
    if (role === 'guest' && !networkReady && !X.coop?.rejoin) { // coop: a rejoin has its own window
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
    return {x:r.left + (v.x + 1) / 2 * r.width, y:r.top + (1 - v.y) / 2 * r.height, visible:inFront && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, inFront};
  }
  const worldPos = o => { if (!o) return null; const p = o.getWorldPosition(new T.Vector3()); return {x:p.x, y:p.y, z:p.z, visible:o.visible}; };
  // raftDebug.hud: a light live view for the timer-driven HUD readers (onboarding 4 Hz, prompts 10 Hz), holding only
  // the keys they read from .state. No deep copies: arrays are the live world/bag lists (read only); bag counts and
  // ownedTools are rebuilt at most once per rendered frame (or every 100 ms while rAF is idle). Objects handed out are
  // never mutated after the fact, so a reader may keep them (onboarding keeps the last pickup).
  let hudAt = -1, hudBuilt = 0, hudBag = null, hudStock = null, hudOwned = null, hudInv = null, hudPick = null, hudPickSrc = null, hudPickType = null;
  const hudModeOf = kind => (kind === 'hammer' ? 'build' : kind === 'fishingrod' ? 'fish' : kind === 'hook' ? 'hook' : DECOR_TYPES.includes(kind) ? 'place' : 'none');
  const hudCounts = () => {
    const bag = localBag(), now = performance.now();
    if (bag !== hudBag || hudAt !== last || now - hudBuilt > 100) {
      hudBag = bag; hudAt = last; hudBuilt = now; hudStock = bag.counts();
      hudOwned = []; if (hudStock.hook > 0) hudOwned.push('hook'); if (hudStock.hammer > 0) hudOwned.push('hammer'); if (hudStock.fishingrod > 0) hudOwned.push('fishingrod');
    }
    return hudStock;
  };
  const hudAffords = () => { const bag = localBag(); for (const k in FLOOR_COST) if (bag.count(k) < FLOOR_COST[k]) return false; return true; };
  const hudPhysics = {get climbing() { return !!physics.climbing; }};
  const hudMe = {get x() { return physics.x; }, get y() { return physics.y; }, get z() { return physics.z; }, get yaw() { return yaw; }, get pitch() { return pitch; }};
  const hudBuild = {get hover() { return hover || null; }, get affordable() { const m = hudModeOf(heldKind()); return m === 'build' ? hudAffords() : m === 'place'; }};
  const hudView = Object.freeze({
    get running() { return running; }, get disposed() { return disposed; }, get role() { return role; }, get networkReady() { return networkReady; },
    get pointerLocked() { return isLocked(); }, get lockFallback() { return lockFallback; }, get inventoryOpen() { return !!survivalUI?.isOpen; },
    get heldKind() { return heldKind(); }, get tool() { return hudModeOf(heldKind()); }, get fishWait() { return fishWait; },
    get hookStage() { return hook ? (hook.fishing ? 'fishing' : hook.stage) : 'idle'; },
    get hookCaughtItems() { return caughtList(castOut()); },
    get hookHealth() { return hookDurability(localBag()); },
    get pickup() {
      if (!pickTarget) return null;
      if (pickTarget !== hudPickSrc || pickTarget.type !== hudPickType) { hudPickSrc = pickTarget; hudPickType = pickTarget.type; hudPick = Object.freeze({type:hudPickType}); }
      return hudPick;
    },
    get stock() { return hudCounts(); }, get ownedTools() { hudCounts(); return hudOwned; },
    get inventory() { const bag = localBag(); if (hudInv?.bag !== bag) hudInv = {bag, get slots() { return this.bag.slots; }}; return hudInv; },
    get selectedIndex() { return localBag().selectedIndex; },
    get tiles() { return world.tiles.length; }, get tileList() { return world.tiles; }, get decor() { return world.decor; },
    get fish() { return world.fish; }, get collected() { return world.collected; },
    get swimming() { return physics.swimming; }, get grounded() { return physics.grounded; }, get physics() { return hudPhysics; },
    get me() { return hudMe; }, get build() { return hudBuild; },
  });
  // shark lane: QA helpers (forceAttack/kill/hit act on the host or solo simulation only)
  const sharkDebug = Object.freeze({
    get state() { return shark ? (role === 'guest' ? ['circle', 'approach', 'bite', 'flee', 'hunt', 'dead', 'gone'][shark.view.code] : shark.sim.state) : null; },
    get hp() { return shark ? (role === 'guest' ? shark.view.hp : shark.sim.hp) : null; },
    get timer() { return shark && role !== 'guest' ? shark.sim.timer : null; },
    get target() { const s = shark?.sim; return s?.hasTarget ? {x:s.tx, z:s.tz, nx:s.nx, nz:s.nz} : null; },
    get looted() { return !!shark?.sim.looted; }, get respawn() { return shark?.sim.respawn ?? null; },
    get tileHp() { return {...(world.tileHp || {})}; },
    get pose() { const v = shark?.view; return v ? {x:v.x, z:v.z, heading:v.heading, visible:shark.visible, y:shark.visible ? ocean.getHeight(v.x, v.z) + v.depth : null} : null; },
    get canHarvest() { return canHarvestShark(); },
    forceAttack() { return role !== 'guest' && !!shark?.forceAttack(); },
    kill() { if (role !== 'guest') shark?.kill(); return shark?.sim.state ?? null; },
    hit(n = 5) { return role !== 'guest' && !!shark?.applyHit(+n); },
    setTimer(t) { if (shark && role !== 'guest' && Number.isFinite(+t)) shark.sim.timer = Math.max(0, +t); return shark?.sim.timer ?? null; },
    trySpear(reach = 2.8, dmg = 5) { if (!shark || !camera) return false; const d = camera.getWorldDirection(new T.Vector3()); return shark.trySpear(camera.position, d, reach, dmg); },
    harvest() { interact(); return shark?.sim.looted ?? null; },
    setTileHp(x, z, hp) { if (role === 'guest' || !hasTile(x, z) || !Number.isFinite(+hp)) return false; world.tileHp ??= {}; if (+hp >= SHARK.TILE_HP) delete world.tileHp[x + ',' + z]; else world.tileHp[x + ',' + z] = clamp(Math.round(+hp), 1, SHARK.TILE_HP - 1); return true; },
  });
  const debugApi = Object.freeze({
    get hud() { return hudView; },
    get renderInfo() {
      if (!renderer) return null;
      const i = renderer.info, c = {meshes:0, visible:0, lights:0, shadowCasters:0};
      scene?.traverse(o => { if (o.isMesh || o.isLine || o.isPoints) { c.meshes++; if (o.visible) c.visible++; if (o.castShadow) c.shadowCasters++; } if (o.isLight) c.lights++; });
      return {calls:i.render.calls, triangles:i.render.triangles, lines:i.render.lines, points:i.render.points, geometries:i.memory.geometries, textures:i.memory.textures, programs:i.programs?.length ?? null, pixelRatio:renderer.getPixelRatio(), shadows:renderer.shadowMap.enabled && !!sun?.castShadow, quality:quality ? {level:quality.level, levels:quality.levels.length, preset:quality.info.preset, pixelRatio:quality.info.pixelRatio, shadowMapSize:quality.info.shadowMapSize, ema:quality.info.ema} : null, ...c};
    },
    audio:sfx, // volume buses (setBus/getBus master|effects|ambience|music) and setMusic for the menus
    get state() {
      const hc = castOut(), bag = localBag(), counts = bag.counts(), kind = heldKind();
      const mode = kind === 'hammer' ? 'build' : kind === 'fishingrod' ? 'fish' : kind === 'hook' ? 'hook' : DECOR_TYPES.includes(kind) ? 'place' : 'none';
      return {
        running, tool:mode, recipe:kind === 'hammer' ? 'floor' : DECOR_TYPES.includes(kind) ? kind : null, role, networkReady, pointerLocked:isLocked(), lockSupported, lockFallback, active, disposed,
        tiles:world.tiles.length, tileList:world.tiles.map(t => [...t]), decor:world.decor.map(d => ({...d})),
        stock:counts, fish:world.fish, collected:world.collected, items:world.items.length,
        inventory:bag.snapshot(), selectedItem:bag.selected, selectedIndex:bag.selectedIndex, heldKind:kind, viewmodel:hands ? {...hands.state, lag:[...(hands.state.lag ?? [])]} : null,
        ownedTools:['hook', 'hammer', 'fishingrod'].filter(k => counts[k] > 0), inventoryOpen:!!survivalUI?.isOpen,
        notes:[...world.notes], achievements:[...world.achievements], logbookOpen:!!logbookUI?.isOpen,
        physics:physics.capture(), grounded:physics.grounded, swimming:physics.swimming,
        hook:hook ? (hook.fishing ? {fishing:true, id:null, t:hook.t, duration:hook.duration} : {fishing:false, id:hc.caught?.id ?? null, stage:hc.stage, x:hc.position.x, y:hc.position.y, z:hc.position.z, tension:hc.tension, distance:hc.distance, caughtCount:caughtList(hc).length}) : null,
        fishWait, hookStage:hook ? (hook.fishing ? 'fishing' : hook.stage) : 'idle', hookCaught:hc?.caught ? {...hc.caught} : null, hookCaughtItems:caughtList(hc).map(c => ({...c})),
        hookHealth:hookDurability(bag), hookRange:16 + hookDurability(bag) * .16, charge:chargeValue(), charging:!!charging, reeling,
        build:{active:mode === 'build' || mode === 'place', recipe:kind, rot:placeRot, pointing, ghost:!!ghosts?.visible, hover:hover ? {...hover} : null, candidates:scene ? placementCandidates(kind).length : 0, affordable:mode === 'build' ? canAfford(bag, FLOOR_COST) : mode === 'place'},
        pieces:{list:(world.pieces || []).map(p => ({...p})), piece:building?.piece ?? null, rotation:building?.rotation ?? 0, removing:!!building?.removing}, // building-pieces lane hook
        pickup:pickTarget ? {id:pickTarget.id, token:pickTarget.token, type:pickTarget.type} : null, feed:pickupFeed.rows,
        me:{x:physics.x, y:physics.y, z:physics.z, yaw, pitch}, other:other ? {...other} : null,
        avatars:{local:worldPos(player), remote:worldPos(friend)},
        camera:camera ? {x:camera.position.x, y:camera.position.y, z:camera.position.z, yaw, pitch, roll:camera.rotation.z, fov:camera.fov} : null,
        raft:raft ? {y:raft.position.y, pitch:raft.rotation.x, roll:raft.rotation.z} : null,
        sailing:sailing ? sailing.debug() : null, // [sailing]
        hand:{x:handPos.x, y:handPos.y, z:handPos.z}, hover:hover ? {...hover} : null,
        dive:diving?.state ?? null, // diving lane hook
        rain:{...copyRain(world), rain:content?.rain() ?? 0}, // rain-sprinkler
        watering:{...copyWatering(world), target:waterAim ? {prompt:waterAim.prompt, click:waterAim.click?.kind ?? null, e:waterAim.e?.kind ?? null} : null},
        signal:world.signal ? cleanSignal(world.signal) : null, antennas:countAntennas(world.decor), signalReadout:lastReadout ? {...lastReadout} : null,
      };
    },
    get content() { return content?.debug ?? {}; }, // content hook: per-module QA helpers
    // [vitals] test/QA helpers. hurt(n, cause) is the same hook other systems use in-game (contentCtx.hurtPlayer).
    get vitals() { return {hp:vitals.hp, food:vitals.food, water:vitals.water, starving:vitals.starving, fainted:fainted >= 0, eating:eating ? eating.item : null, exertion}; },
    hurt(n, cause = 'debug') { return hurtPlayer(n, cause); },
    setVitals(o) {
      if (!o || typeof o !== 'object') return null;
      for (const k of ['hp', 'food', 'water']) if (Number.isFinite(o[k])) vitals[k] = clamp(o[k], 0, 100);
      return {hp:vitals.hp, food:vitals.food, water:vitals.water};
    },
    project,
    aimAtNode(r = 6) { // diving lane hook: test helper, look at the nearest seafloor node
      const n = diving?.seafloor?.nodesNear?.(physics.x, physics.y, physics.z, r)?.sort((a, b) => Math.hypot(a.x - physics.x, a.y - physics.y, a.z - physics.z) - Math.hypot(b.x - physics.x, b.y - physics.y, b.z - physics.z))[0];
      if (!n) return null; const dx = n.x - physics.x, dy = n.y + .2 - physics.y, dz = n.z - physics.z;
      yaw = Math.atan2(-dx, -dz); pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -PITCH_LIMIT, PITCH_LIMIT); return {...n};
    },
    aim(p, w = yaw) { if (Number.isFinite(+p) && Number.isFinite(+w)) { pitch = clamp(+p, -PITCH_LIMIT, PITCH_LIMIT); yaw = +w; } }, // diving lane hook: test helper
    swimAt(x, z, p = pitch, w = yaw) { if (![+x, +z, +p, +w].every(Number.isFinite)) return; physics = new PlayerPhysics({x:+x, y:ocean.getHeight(+x, +z) + .45, z:+z, swimming:true}); pitch = clamp(+p, -PITCH_LIMIT, PITCH_LIMIT); yaw = +w; }, // diving lane hook: test helper
    get logbook() {
      return {notes:[...world.notes], nextNote:nextNote(world.notes), achievements:[...world.achievements], totals:{notes:12, achievements:15}, bottleAfloat:world.items.some(i => i.type === 'bottle')};
    },
    get progression() { return prog?.debug ?? null; }, // [progression-hook]
    look:() => ({look:{...lookState.look}, unlocked:[...lookState.unlocked], open:!!lookUI?.isOpen}), // [look]
    give(kind, n = 1) { return spearRep?.give(kind, n) ?? -1; }, // [spear-repair] test helper: add items to the local (host/solo) bag
    setTileHp(x, z, hp) { spearRep?.setTileHp(x, z, hp); }, // [spear-repair] test helper
    spearTestHit() { return spearRep?.testHit() ?? false; }, // [spear-repair] test helper: fake a landed thrust
    spearPose(p) { spearRep?.pinPoke(p); }, // [spear-repair] test helper: freeze the jab for screenshots
    get spear() { return spearRep?.debug() ?? null; }, // [spear-repair]
    paddlePose(p) { paddle?.pin(p); }, // [paddle] test helper: freeze the stroke for screenshots
    get shark() { return sharkDebug; }, // shark lane
    get targets() {
      return world.items.map(it => {
        const m = itemMeshes.get(it.token), p = m ? m.position : {x:it.x, y:ITEM_FLOAT, z:it.z};
        return {id:it.id, token:it.token, type:it.type, x:p.x, y:p.y, z:p.z, distance:Math.hypot(it.x - physics.x, it.z - physics.z), pending:isPending(it), screen:project(p.x, p.y, p.z)};
      });
    },
    get wateringTargets() {
      return world.decor.filter(d => d.type === 'palm' || d.type === 'purifier' || d.type === 'rainbarrel' || d.type === 'sprinkler').map(d => {
        const k = tileKey(d.x, d.z), g = d.type === 'palm' ? world.garden?.[k] : null, pu = d.type === 'purifier' ? world.purifiers?.[k] : null;
        const rn = d.type === 'rainbarrel' ? (world.collectors?.[k] ?? {w:0}) : d.type === 'sprinkler' ? (world.sprinklers?.[k] ?? {w:0, s:0}) : null; // rain-sprinkler
        return {key:k, type:d.type, x:d.x, z:d.z, stage:d.type === 'palm' ? plantStage(g) : null, water:d.type === 'palm' ? (g?.water ?? 0) : null,
          t:d.type === 'purifier' ? (pu?.t ?? null) : null, ready:d.type === 'purifier' ? (pu?.ready ?? null) : null, fuel:d.type === 'purifier' ? (pu?.fuel ?? 0) : null, cup:d.type === 'purifier' ? (pu ? (pu.cup === 0 ? 0 : 1) : 0) : null, w:rn ? rn.w : null, s:d.type === 'sprinkler' ? rn.s : null,
          distance:Math.hypot(d.x * 2 - physics.x, d.z * 2 - physics.z), screen:project(d.x * 2, .9, d.z * 2)};
      });
    },
    get placements() {
      if (!raft) return [];
      const y = raft.position.y + .22;
      return placementCandidates(heldKind()).map(({x, z}) => ({x, z, world:{x:x * 2, y, z:z * 2}, screen:project(x * 2, y, z * 2)}));
    },
  });
  const previousDebug = Object.getOwnPropertyDescriptor(window, 'raftDebug'); // restored if this mount fails
  // Desktop shell hook (desktop/main.cjs). The shell claims Escape and runs window.raftEscape() (settings.js) with a
  // user gesture; hold() first marks the key as held so a relock waits for released(), sent on the key's release.
  const shellApi = {
    hold:guard(() => { escHeld = true; relockOnEscUp = false; }),
    released:guard(() => { escReleased(true); }),
  };
  const previousShell = Object.getOwnPropertyDescriptor(window, 'raftShell'), previousEscape = Object.getOwnPropertyDescriptor(window, 'raftEscape');
  window.raftShell = shellApi;
  window.raftDebug = debugApi;

  // ---------- Lifecycle ----------
  function capture() {
    if (role !== 'guest') syncWorldInventories();
    try { fc?.capture(); } catch {} // [fishing-cooking] flushes its own save before a hot swap
    return {
      version:3, world, bags:{host:hostBag.snapshot(), guest:guestBag.snapshot(), remote:remoteBag ? remoteBag.snapshot() : null},
      physics:physics.capture(), me:{x:physics.x, y:physics.y, z:physics.z}, other:other ? {...other} : null, yaw, pitch, running, elapsed, walkPhase,
      vitals:saveVitals(vitals), fainted, // [vitals]
      hook, castId, hookSlot, lastCaughtCount, fishWait, sound, audio:sfx.context, hintsDone, peer, conn, role, networkReady, room, ownWorldBackup, pending:new Map(pending),
      dive:diving?.capture?.() ?? null, // diving lane hook
      wornCasts:{...wornCasts}, seq, lastSeqSent, guestAck,
      joinDeadline:joinTimer ? joinDeadline : 0, saveAvailable, lockFallback, keys:{...keys},
      charging:charging ? {...charging} : null, reeling, down:down ? {...down} : null,
      bindings:bindings.slice(), renderer, lastHostMessage, lastGuestMessage, peerHidden, saveRev, saveBlocked, coop:coop?.capture(), // coop: rejoin state
      raftPose:raft ? {y:raft.position.y, rx:raft.rotation.x, rz:raft.rotation.z} : {...raftPose},
    };
  }
  function pause() { active = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
  function resume() {
    if (disposed || active || !scene) return;
    active = true; last = performance.now(); quality?.reset(); rafId = requestAnimationFrame(animate);
  }
  function disposeScene() {
    if (!scene) return;
    try { building?.dispose(); } catch {} building = null; // building-pieces lane hook
    if (diveWarmAt && typeof cancelIdleCallback === 'function') { try { cancelIdleCallback(diveWarmAt); } catch {} } diveWarmAt = 0; // a later() fallback is cleared with the other timers
    try { diving?.dispose(); } catch {} diving = null; // diving lane hook
    try { sky?.dispose(); } catch {} sky = null; // frees the sky noise texture on hot swap
    try { shark?.dispose(); } catch {} shark = null; try { sharkFx?.dispose(); } catch {} sharkFx = null; // shark lane
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
    try { content?.dispose(); contentPromptOff?.(); } catch {} content = null; contentPromptOff = null; // content hook
    try { ocean?.dispose(); } catch {}
    materialCache.clear(); itemMeshes.clear(); scene.clear();
    scene = null; // renderer, canvas, AudioContext, peer and conn are left untouched
  }
  function dispose() {
    if (disposed) return;
    pause(); disposed = true; ac.abort(); sfx.destroy(); offIconReady?.();
    try { coop?.dispose(); } catch {} coop = null; // coop
    try { settingsController?.destroy(); } catch {}
    try { survivalUI?.destroy?.(); } catch {}
    try { sailing?.dispose(); } catch {} // [sailing]
    try { fc?.dispose(); } catch {} fc = null; // [fishing-cooking]
    try { instruments?.dispose(); } catch {} instruments = null; // [instruments]
    for (const id of ['signalReadout', 'signalMarker']) { const el = document.getElementById(id); if (el) el.hidden = true; }
    try { logbookUI?.destroy?.(); } catch {}
    try { lookUI?.destroy?.(); } catch {} lookUI = null; // [look]
    try { prog?.dispose(); } catch {} // [progression-hook]
    try { paddle?.dispose(); } catch {} paddle = null; // [paddle]
    try { spearRep?.dispose(); } catch {} spearRep = null; // [spear-repair]
    try { vitalsUI?.dispose(); } catch {} vitalsUI = null; try { promptOff?.(); } catch {} promptOff = null; // [vitals]
    for (const id of timers) clearTimeout(id); timers.clear(); clearInterval(heartbeat);
    unlisten(bindings.splice(0));
    try { if (window.raftDebug === debugApi) delete window.raftDebug; } catch {}
    try { if (window.raftShell === shellApi) delete window.raftShell; } catch {}
    disposeScene();
  }

  const optionsDialog = document.getElementById('options'), previousSettingsOwner = optionsDialog?.dataset.owner;
  try {
    if (!canvas) throw new Error('#world canvas missing');
    prog = attachProgression({T, role:() => role, ready:() => networkReady, running:() => running, world:() => world, bag:actorBag, localBag, action, emit, notice, pose:() => ({x:physics.x, z:physics.z, yaw}), aim:() => frameAim, resume:() => requestLock(), pause:clearInput}); // [progression-hook]
    init();
    try { coop = createCoop(coopContext(), X?.coop); } catch (e) { console.warn('co-op layer unavailable', e); coop = null; } // coop
    settingsController = createSettings({onChange:next => { applyOptions(next); soundLabel(); }, onPause:pauseInput, onResume:() => { quality?.reset(); requestLock(); }, onQuit:guard(quitToTitle)});
    survivalUI = createSurvivalUI({
      getBag:() => localBag(),
      onSelect:guard(i => selectSlot(i)),
      onMove:guard((from, to, amount) => moveSlot(from, to, amount)),
      onCraft:guard(id => craft(id)),
      onResume:guard(() => { play('close'); requestLock(); }),
      onPause:guard(pauseInput),
      getModel:modelOf, // 3D icons rendered from models.js
      recipeGate:id => prog?.recipeGate(id) ?? (id === 'shellwreath' && content?.craftLocked(id) ? {locked:true, reason:String(content.craftLocked(id))} : null), // [progression-hook] + content hook: trader plan greys the wreath row
    });
    prog.installUI(); // [progression-hook]
    logbookUI = createLogbookUI({getProgress:() => world, onPause:guard(pauseInput), onResume:guard(() => requestLock())});
    try { lookUI = createLookUI({getState:() => lookState, onChange:guard(applyLook), onSend:guard(() => coop?.sendLook?.()), onPause:guard(pauseInput), onResume:guard(() => { if (running) requestLock(); })}); } catch (e) { console.error('look UI failed', e); lookUI = null; } // [look]
    if (role !== 'guest') retroAward();
    pickupFeed.setIconProvider(k => iconURL(k) || feedSprite(k)); offIconReady = onIconReady(k => pickupFeed.refresh(k)); // feed rows show the same 3D icons as the hotbar; sprite while a render is pending
    if (running) { const w = $('#welcome'); if (w) w.hidden = true; const h = $('#hud'); if (h) h.hidden = false; }
    if ($('#toast')?.classList.contains('show')) toastTimer = later(() => { toastTimer = 0; $('#toast')?.classList.remove('show'); }, 2600);
    warmShaders(); // after settings: the saved graphics preset decides the light/shadow program variants
    active = true; last = performance.now(); rafId = requestAnimationFrame(animate);
    // onboarding/prompts hook (docs/cloud/onboarding.md): lets dist/prompts.js raycast with the live camera.
    try { window.raftMount = {T, scene, camera, debug:debugApi}; window.dispatchEvent(new CustomEvent('raft:mount', {detail:window.raftMount})); } catch {}
  } catch (e) {
    console.error(e); dispose();
    try { if (previousDebug && !Object.getOwnPropertyDescriptor(window, 'raftDebug')) Object.defineProperty(window, 'raftDebug', previousDebug); } catch {}
    restoreGlobal(window, 'raftShell', previousShell, shellApi); // the old engine keeps its desktop shell hooks
    if (previousEscape && window.raftEscape !== previousEscape.value) restoreGlobal(window, 'raftEscape', previousEscape, window.raftEscape); // and its Escape
    for (const [el, prop, previous, next] of propertyHandlers) if (el[prop] === next) el[prop] = previous;
    const od = document.getElementById('options'); if (od && previousSettingsOwner !== undefined) od.dataset.owner = previousSettingsOwner; // hand Escape back to the old engine's settings
    setText('#loadError', 'The 3D ocean could not start. Try a current Chrome, Edge, or Safari browser with WebGL enabled.');
    if (!X) { const solo = $('#solo'); if (solo) solo.disabled = true; }
    throw e;
  }

  return {capture, pause, resume, dispose};
}

export default mount;
