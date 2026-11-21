// Content registry: islands, wildlife, storage/research, day/night.
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
//   use(kind, aim)            left click holding `kind`, before eating/placing. Return true if consumed.
//   claims(kind, aim)         true when use(kind, aim) would consume the click (hides the eat/drink tip)
//   prompt(aim)               -> context prompt HTML (escaped by the module) or null
//   craftLocked(recipe, actor)-> reason string if the recipe is locked, else null
//   decorModel(type)          -> THREE.Object3D for a CONTENT_DECOR type, or null
//   bindRain(fn)              called once at start with fn() -> live 0..1 rain
//   debug                     object exposed as raftDebug.content[name] (QA helpers)
//   dispose()
//
// ctx (live getters, set up by game.js): T, scene, camera, raft, ocean, sun, hemi, clouds, world, role,
// running, physics, elapsed, options, localBag(), actorBag(actor), action(a), emit(e, to), notice(s),
// esc(s), mat(color), rebuildRaft(), deckY(), uiOpen().

import { createIslands } from './islands.js?build=v3-survival-ae77fa84ac2b';
import { createWildlife } from './wildlife.js?build=v3-survival-ae77fa84ac2b';
import { createStorage } from './storage-research.js?build=v3-survival-ae77fa84ac2b';
import { createDayNight } from './daynight.js?build=v3-survival-ae77fa84ac2b';
import { createBees } from './bees.js?build=v3-survival-ae77fa84ac2b'; // [bees]
import { createCrops } from './crops.js?build=v3-survival-ae77fa84ac2b'; // [crops]

const FEATURES = [createIslands, createWildlife, createStorage, createDayNight, createBees, createCrops]; // [bees] + createBees, [crops] + createCrops
const EXT_MAX = 200000; // chars of JSON per world.ext, guards saves and the network

export function cleanExt(v) { // used by game.js cleanWorld(); modules validate their own slice
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  try { const s = JSON.stringify(v); return s.length <= EXT_MAX ? JSON.parse(s) : {}; } catch { return {}; }
}

export function createContent(ctx, features = FEATURES) {
  const mods = [];
  for (const make of features) {
    try { const m = make(ctx); if (m) mods.push(m); } catch (e) { console.error('content module failed to start', e); }
  }
  // A failing module is disabled and disposed once, so shared engine state (fog, lights…) is restored.
  const off = m => { if (m.dead) return; m.dead = true; console.error('content module disabled:', m.name); try { m.dispose?.(); } catch (e) { console.error(`content ${m.name}.dispose failed`, e); } };
  const call = (m, fn, ...a) => { if (m.dead || typeof m[fn] !== 'function') return undefined; try { return m[fn](...a); } catch (e) { console.error(`content ${m.name}.${fn} failed`, e); off(m); return undefined; } };
  const first = (fn, ...a) => { for (const m of mods) { const r = call(m, fn, ...a); if (r) return r; } return null; };
  const rain = () => { const m = mods.find(m => m.name === 'daynight' && !m.dead); const r = m?.rain; return Number.isFinite(r) ? r : 0; }; // rain-sprinkler: live 0..1 rain
  for (const m of mods) call(m, 'bindRain', rain); // [crops] rain waters crop plots
  const debug = {};
  for (const m of mods) if (m.name && m.debug) debug[m.name] = m.debug;
  return {
    mods, debug,
    update(dt) { for (const m of mods) call(m, 'update', dt); },
    afterMove(physics, dt) { for (const m of mods) call(m, 'afterMove', physics, dt); },
    serialize() { const out = {}; for (const m of mods) { const d = call(m, 'serialize'); if (d !== undefined && m.name) out[m.name] = d; } return out; },
    load(ext, from) { const e = ext && typeof ext === 'object' ? ext : {}; for (const m of mods) call(m, 'load', e[m.name], from); },
    action(a, actor, bag) { for (const m of mods) if (call(m, 'action', a, actor, bag)) return true; return false; },
    interact: aim => !!first('interact', aim),
    use: (kind, aim) => !!first('use', kind, aim),
    claims: (kind, aim) => !!first('claims', kind, aim),
    prompt: aim => first('prompt', aim),
    craftLocked: (recipe, actor) => first('craftLocked', recipe, actor),
    decorModel: type => first('decorModel', type),
    rain, // rain-sprinkler: live 0..1 rain
    dispose() { for (const m of mods) call(m, 'dispose'); },
  };
}
