// Content registry: islands, map table, wildlife, storage/research, day/night.
// game.js creates ONE registry (createContent) and calls it from a few marked "content hook" lines.
// Each feature is a module in its own file exporting a factory `(ctx) => mod`. To add one, import it
// and append it to FEATURES below. Every hook is optional on the module; a module that throws is
// logged once and disabled, so content can never take the core game down.
//
// Module shape (all optional):
//   name                      string, used for save/net keys and raftDebug.content[name]
//   update(dt)                per frame, after items/hook updates. No allocations.
//   afterMove(physics, dt)    after player physics (islands: stand on sand)
//   serialize()               -> JSON-safe data. Host saves it in world.ext[name] and sends it in state.
//   load(data, from)          from: 'save' | 'net' | 'restore'. data may be undefined (old save).
//   action(a, actor, bag)     host only. Return true if a.kind was handled. Guests reach it via ctx.action().
//   interact(aim)             E key. Return true if consumed (before the inventory opens).
//   prompt(aim)               -> context prompt HTML (escaped by the module) or null
//   craftLocked(recipe, actor)-> reason string if the recipe is locked, else null
//   decorModel(type, d)       -> THREE.Object3D for a CONTENT_DECOR type, or null (d = the world.decor entry, read-only)
//   placeBlock(kind, x, z)    -> BLOCK_TEXT reason a decor kind can't go on that tile, else null // [fishtrap]
//   sailPush(sailing, out)    write an extra water-relative push (m/s) into out.x/out.z; return true if non-zero.
//                             Host and guest must compute it from synced data (engine: motors).
//   steerTargets()            -> array of raft-local {x,z} extra hold-R steering grab points (engine: wheels)
//   use(aim, kind)            left click with a bag item `kind` that no engine tool handles. Return true if consumed.
//   alt(aim, kind)            right click while holding `kind`. Return true if consumed (paint: brush colour).
//   afterRebuild()            after rebuildRaft() recreated the deck/decor meshes (paint: re-tint planks)
//   tileTint(x, z, base)      plank colour for deck tile x,z (base = the plank's own colour) or null (paint)
//   diveMods(m)               multiply m.swim/oxy/fog/gather in place (local player, per frame, no allocations; docs/specs/diving-gear.md)
//   link(env)                 optional: env.wind() / env.night() live daynight getters // [power]
//   ride(dt, physics, inp)    local player, every frame (not while diving). Return true to skip PlayerPhysics (driftboard; zipline)
//   riding()                  -> true while ride() owns the player
//   debug                     object exposed as raftDebug.content[name] (QA helpers)
//   observe(ev, actor)        host only: game events after success ({kind:'craft'|'collect'|'fish'|'build'|
//                             'bottle'|'cook'|'water'|'harvest'|'gather'|'repair', ...}). Never from net/effects.
//   dispose()
//
// ctx (live getters, set up by game.js): T, scene, camera, raft, ocean, sun, hemi, clouds, world, role,
// running, physics, elapsed, options, localBag(), actorBag(actor), action(a), emit(e, to), notice(s),
// esc(s), mat(color), rebuildRaft(), deckY(), uiOpen(), building (piece grid/tint, may be null early), brush (held
// brush model), woodMat(hex) (cached procedural wood material), aim() (this frame's aim {point, dir} or null),
// observe(ev, actor), dayIndex(), hasGrill() ([tasks]).

import { createIslands } from './islands.js?build=v3-survival-ae77fa84ac2b';
import { createWildlife } from './wildlife.js?build=v3-survival-ae77fa84ac2b';
import { createStorage } from './storage-research.js?build=v3-survival-ae77fa84ac2b';
import { createDecorPack } from './decor-pack.js?build=v3-survival-ae77fa84ac2b';
import { createDayNight } from './daynight.js?build=v3-survival-ae77fa84ac2b';
import { createEngine } from './engine.js?build=v3-survival-ae77fa84ac2b';
import { createSleep } from './sleep.js?build=v3-survival-ae77fa84ac2b';
import { createPaint } from './paint.js?build=v3-survival-ae77fa84ac2b'; // content hook (paint)
import { createKiln } from './kiln.js?build=v3-survival-ae77fa84ac2b';
import { createAnimals } from './animals.js?build=v3-survival-ae77fa84ac2b';
import { createBees } from './bees.js?build=v3-survival-ae77fa84ac2b'; // [bees]
import { createTreasure } from './treasure.js?build=v3-survival-ae77fa84ac2b';
import { createMapTable } from './maptable.js?build=v3-survival-ae77fa84ac2b';
import { createGull } from './gull.js?build=v3-survival-ae77fa84ac2b'; // [gull]
import { createJuicer } from './juicer.js?build=v3-survival-ae77fa84ac2b'; // [juicer]
import { createDivingGear } from './diving-gear.js?build=v3-survival-ae77fa84ac2b';
import { createTrader } from './trader.js?build=v3-survival-ae77fa84ac2b';
import { createGameTable } from './gametable.js?build=v3-survival-ae77fa84ac2b'; // game table
import { createPaddleboard } from './paddleboard.js?build=v3-survival-ae77fa84ac2b'; // [paddleboard]
import { createBuoyCourse } from './buoycourse.js?build=v3-survival-ae77fa84ac2b'; // [buoycourse]
import { createCookpot } from './cookpot.js?build=v3-survival-ae77fa84ac2b';
import { createDisplay } from './display.js?build=v3-survival-ae77fa84ac2b'; // [display]
import { createPower } from './power.js?build=v3-survival-ae77fa84ac2b'; // [power]
import { createFishTrap } from './fish-trap.js?build=v3-survival-ae77fa84ac2b'; // [fishtrap]
import { createPhotoFrame } from './photo-frame.js?build=v3-survival-ae77fa84ac2b'; // [camera] photo frame decor
import { createTasks } from './tasks.js?build=v3-survival-ae77fa84ac2b'; // [tasks]

const FEATURES = [createIslands, createTreasure, createMapTable, createWildlife, createStorage, createDecorPack, createDayNight, createSleep, createEngine, createPaint, createKiln, createAnimals, createBees, createPower, createJuicer, createGull, createFishTrap, createDisplay, createTasks, createPhotoFrame, createDivingGear, createTrader, createGameTable, createBuoyCourse, createPaddleboard, createCookpot]; // round 4: game table, buoy course, paddleboard (buoycourse before paddleboard so its aimed E/prompts win while riding); // [bees] + createBees; [power] after bees; [fishtrap] [display] [tasks] [camera]; round 3 diving gear, trader, cookpot (cookpot stays last); [juicer] + createJuicer [gull] + createGull
const EXT_MAX = 200000; // chars of JSON per world.ext, guards saves and the network

export function cleanExt(v) { // used by game.js cleanWorld(); modules validate their own slice
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  try { const s = JSON.stringify(v); return s.length <= EXT_MAX ? JSON.parse(s) : {}; } catch { return {}; }
}

// content hook: module prompts are HTML ("<kbd>E</kbd>Open crate"); main's #lrPrompt (prompts.js) wants
// {key, label}. Converts one prompt; text without a <kbd> becomes a muted hint. Single-entry cache, since
// the same string comes back every sample while the player keeps aiming at one thing.
const ENT = {amp:'&', lt:'<', gt:'>', quot:'"', '#39':"'", apos:"'", nbsp:' '};
const plain = s => s.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENT[e]).replace(/\s+/g, ' ').trim();
let lastHtml = null, lastParts = null;
export function promptParts(html) {
  if (typeof html !== 'string' || !html) return null;
  if (html === lastHtml) return lastParts;
  const m = /^\s*<kbd>([^<]*)<\/kbd>([\s\S]*)$/i.exec(html), key = m ? plain(m[1]) : '', label = plain(m ? m[2] : html);
  lastHtml = html; lastParts = label ? (key ? {key, label} : {label, muted:true}) : null;
  return lastParts;
}

export function createContent(ctx, features = FEATURES) {
  const mods = [];
  // A failing module is disabled and disposed once, so shared engine state (fog, lights…) is restored.
  const off = m => { if (m.dead) return; m.dead = true; console.error('content module disabled:', m.name); try { m.dispose?.(); } catch (e) { console.error(`content ${m.name}.dispose failed`, e); } };
  const call = (m, fn, ...a) => { if (m.dead || typeof m[fn] !== 'function') return undefined; try { return m[fn](...a); } catch (e) { console.error(`content ${m.name}.${fn} failed`, e); off(m); return undefined; } };
  const call1 = (m, out) => { try { m.diveMods(out); } catch (e) { console.error(`content ${m.name}.diveMods failed`, e); off(m); } };
  // Sibling peek: a module may read another's live serialize() (e.g. the map table reads islands). Read, never keep.
  const peek = name => { const m = mods.find(x => x.name === name && !x.dead); return m ? call(m, 'serialize') : undefined; };
  for (const make of features) {
    try { const m = make(ctx, { peek }); if (m) mods.push(m); } catch (e) { console.error('content module failed to start', e); }
  }
  const first = (fn, ...a) => { for (const m of mods) { const r = call(m, fn, ...a); if (r) return r; } return null; };
  const debug = {};
  for (const m of mods) if (m.name && m.debug) debug[m.name] = m.debug;
  const dn = () => mods.find(m => m.name === 'daynight' && !m.dead), num = (v, d) => (Number.isFinite(v) ? v : d); // [power]
  const env = { wind: () => num(dn()?.wind, .15), night: () => num(dn()?.night, 0) }; // [power] live getters, never spread
  for (const m of mods) call(m, 'link', env); // [power] optional link(env) hook
  return {
    mods, debug,
    update(dt) { for (const m of mods) call(m, 'update', dt); },
    afterMove(physics, dt) { for (const m of mods) call(m, 'afterMove', physics, dt); },
    serialize() { const out = {}; for (const m of mods) { const d = call(m, 'serialize'); if (d !== undefined && m.name) out[m.name] = d; } return out; },
    load(ext, from) { const e = ext && typeof ext === 'object' ? ext : {}; for (const m of mods) call(m, 'load', e[m.name], from); },
    action(a, actor, bag) { for (const m of mods) if (call(m, 'action', a, actor, bag)) return true; return false; },
    observe(ev, actor) { for (const m of mods) call(m, 'observe', ev, actor); }, // [tasks] host-side game events
    interact: aim => !!first('interact', aim),
    prompt: aim => first('prompt', aim),
    ride: (dt, p, inp) => !!first('ride', dt, p, inp), riding: () => !!first('riding'), // [zipline] content hook: glide line ride (game.js movePlayer)
    use: (aim, kind) => !!first('use', aim, kind), // content hook (paint)
    alt: (aim, kind) => !!first('alt', aim, kind), // content hook (paint)
    afterRebuild() { for (const m of mods) call(m, 'afterRebuild'); }, // content hook (paint)
    tileTint: (x, z, base) => first('tileTint', x, z, base), // content hook (paint): plank hex for a painted deck tile, else null
    craftLocked: (recipe, actor) => first('craftLocked', recipe, actor),
    placeBlock: (kind, x, z) => first('placeBlock', kind, x, z), // [fishtrap] reason a decor can't go on (x, z), or null
    decorModel: (type, d) => first('decorModel', type, d),
    sailPush: (s, out) => !!first('sailPush', s, out),
    steerTargets: () => first('steerTargets'),
    rain() { const m = mods.find(m => m.name === 'daynight' && !m.dead); const r = m?.rain; return Number.isFinite(r) ? r : 0; }, // rain-sprinkler: live 0..1 rain
    wind: () => env.wind(), night: () => env.night(), // [power] live daynight wind / nightFactor (fallbacks .15 / 0)
    diveMods(out) { out.swim = out.oxy = out.fog = out.gather = 1; for (let i = 0; i < mods.length; i++) { const m = mods[i]; if (!m.dead && typeof m.diveMods === 'function') call1(m, out); } return out; }, // shared dive modifier hook (no per-frame rest-arg arrays)
    day() { const m = mods.find(m => m.name === 'daynight' && !m.dead); const d = m?.day; return Number.isInteger(d) ? d : null; }, // [tasks] in-game day index
    tasksView() { const m = mods.find(m => m.name === 'tasks' && !m.dead); if (!m) return null; try { return m.view?.() ?? null; } catch { return null; } }, // [tasks] logbook tab
    dispose() { for (const m of mods) call(m, 'dispose'); },
  };
}
