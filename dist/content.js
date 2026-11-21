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
//   prompt(aim)               -> context prompt HTML (escaped by the module) or null
//   craftLocked(recipe, actor)-> reason string if the recipe is locked, else null
//   decorModel(type, d)       -> THREE.Object3D for a CONTENT_DECOR type, or null (d = the world.decor entry, read-only)
//   debug                     object exposed as raftDebug.content[name] (QA helpers)
//   dispose()
//
// ctx (live getters, set up by game.js): T, scene, camera, raft, ocean, sun, hemi, clouds, world, role,
// running, physics, elapsed, options, localBag(), actorBag(actor), action(a), emit(e, to), notice(s),
// esc(s), mat(color), rebuildRaft(), deckY(), uiOpen().

import { createIslands } from './islands.js';
import { createWildlife } from './wildlife.js';
import { createStorage } from './storage-research.js';
import { createDecorPack } from './decor-pack.js';
import { createDayNight } from './daynight.js';
import { createKiln } from './kiln.js';
import { createAnimals } from './animals.js';

const FEATURES = [createIslands, createWildlife, createStorage, createDecorPack, createDayNight, createKiln, createAnimals];
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
  const off = m => { if (!m.dead) { m.dead = true; console.error('content module disabled:', m.name); } };
  const call = (m, fn, ...a) => { if (m.dead || typeof m[fn] !== 'function') return undefined; try { return m[fn](...a); } catch (e) { console.error(`content ${m.name}.${fn} failed`, e); off(m); return undefined; } };
  const first = (fn, ...a) => { for (const m of mods) { const r = call(m, fn, ...a); if (r) return r; } return null; };
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
    prompt: aim => first('prompt', aim),
    craftLocked: (recipe, actor) => first('craftLocked', recipe, actor),
    decorModel: (type, d) => first('decorModel', type, d),
    dispose() { for (const m of mods) call(m, 'dispose'); },
  };
}
