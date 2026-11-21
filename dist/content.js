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
//   ride(physics, dt, input)  takes over player motion this frame; return true to skip physics.update (sit, zipline)
//   seated()                  -> true while the local player sits
//   serialize()               -> JSON-safe data. Host saves it in world.ext[name] and sends it in state.
//   load(data, from)          from: 'save' | 'net' | 'restore'. data may be undefined (old save).
//   action(a, actor, bag)     host only. Return true if a.kind was handled. Guests reach it via ctx.action().
//   interact(aim)             E key. Return true if consumed (before the inventory opens).
//   prompt(aim)               -> context prompt HTML (escaped by the module) or null
//   craftLocked(recipe, actor)-> reason string if the recipe is locked, else null
//   decorModel(type, d)       -> THREE.Object3D for a CONTENT_DECOR type, or null (d = the world.decor entry, read-only)
//   sailPush(sailing, out)    write an extra water-relative push (m/s) into out.x/out.z; return true if non-zero.
//                             Host and guest must compute it from synced data (engine: motors).
//   steerTargets()            -> array of raft-local {x,z} extra hold-R steering grab points (engine: wheels)
//   use(aim, kind)            left click with a bag item `kind` that no engine tool handles. Return true if consumed.
//   alt(aim, kind)            right click while holding `kind`. Return true if consumed (paint: brush colour).
//   afterRebuild()            after rebuildRaft() recreated the deck/decor meshes (paint: re-tint planks)
//   tileTint(x, z, base)      plank colour for deck tile x,z (base = the plank's own colour) or null (paint)
//   beforeUndecor(d, actor)   [undecor] host only. d = the world.decor entry {type,x,z,rot?} (read-only), actor 'host'|'guest'.
//                             -> veto string (shown as a notice to the actor) when this module's state on d's tile
//                             is busy, else null. Must not mutate anything. Called for every decor type: ignore
//                             types you don't own.
//   undecorLoot(d)            [undecor] host only. -> array of [kind, n] or [kind, n, meta] that this module stores on d's tile
//                             (contents, NOT the item itself: the host adds {d.type:1}). [] or null when nothing.
//                             Must not mutate. Called only after every beforeUndecor returned null.
//   afterUndecor(d, actor)    [undecor] host only, after the bag is committed and d is spliced out of world.decor.
//                             Delete this module's slice key for d's tile, bump its rev so guests resync, close any
//                             open UI for that tile. Must not throw. No return value.
//   debug                     object exposed as raftDebug.content[name] (QA helpers)
//   dispose()
//
// ctx (live getters, set up by game.js): T, scene, camera, raft, ocean, sun, hemi, clouds, world, role,
// running, physics, elapsed, options, localBag(), actorBag(actor), action(a), emit(e, to), notice(s),
// esc(s), mat(color), rebuildRaft(), deckY(), uiOpen(), building (piece grid/tint, may be null early), brush (held
// brush model), woodMat(hex) (cached procedural wood material), aim() (this frame's aim {point, dir} or null).

import { createIslands } from './islands.js?build=v3-survival-ae77fa84ac2b';
import { createWildlife } from './wildlife.js?build=v3-survival-ae77fa84ac2b';
import { createStorage } from './storage-research.js?build=v3-survival-ae77fa84ac2b';
import { createDecorPack } from './decor-pack.js?build=v3-survival-ae77fa84ac2b';
import { createDayNight } from './daynight.js?build=v3-survival-ae77fa84ac2b';
import { createEngine } from './engine.js?build=v3-survival-ae77fa84ac2b';
import { createSleep } from './sleep.js?build=v3-survival-ae77fa84ac2b';
import { createSitting } from './sitting.js?build=v3-survival-ae77fa84ac2b'; // [sit]
import { createPaint } from './paint.js?build=v3-survival-ae77fa84ac2b'; // content hook (paint)
import { createKiln } from './kiln.js?build=v3-survival-ae77fa84ac2b';
import { createAnimals } from './animals.js?build=v3-survival-ae77fa84ac2b';
import { createBees } from './bees.js?build=v3-survival-ae77fa84ac2b'; // [bees]
import { createTreasure } from './treasure.js?build=v3-survival-ae77fa84ac2b';
import { createMapTable } from './maptable.js?build=v3-survival-ae77fa84ac2b';
import { createFlags } from './flags.js?build=v3-survival-ae77fa84ac2b'; // [flags]

const FEATURES = [createIslands, createTreasure, createMapTable, createWildlife, createStorage, createDecorPack, createDayNight, createSleep, createSitting, createEngine, createPaint, createKiln, createAnimals, createBees, createFlags]; // [bees] + createBees, [flags] + createFlags, [sit] + createSitting
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
  // Sibling peek: a module may read another's live serialize() (e.g. the map table reads islands). Read, never keep.
  const peek = name => { const m = mods.find(x => x.name === name && !x.dead); return m ? call(m, 'serialize') : undefined; };
  for (const make of features) {
    try { const m = make(ctx, { peek }); if (m) mods.push(m); } catch (e) { console.error('content module failed to start', e); }
  }
  const first = (fn, ...a) => { for (const m of mods) { const r = call(m, fn, ...a); if (r) return r; } return null; };
  const seatedMod = () => { for (const m of mods) if (!m.dead && typeof m.seated === 'function' && call(m, 'seated')) return m; return null; }; // [sit]
  const debug = {};
  for (const m of mods) if (m.name && m.debug) debug[m.name] = m.debug;
  return {
    mods, debug,
    update(dt) { for (const m of mods) call(m, 'update', dt); },
    afterMove(physics, dt) { for (const m of mods) call(m, 'afterMove', physics, dt); },
    serialize() { const out = {}; for (const m of mods) { const d = call(m, 'serialize'); if (d !== undefined && m.name) out[m.name] = d; } return out; },
    load(ext, from) { const e = ext && typeof ext === 'object' ? ext : {}; for (const m of mods) call(m, 'load', e[m.name], from); },
    action(a, actor, bag) { for (const m of mods) if (call(m, 'action', a, actor, bag)) return true; return false; },
    interact: aim => { const m = seatedMod(); return !!(m && call(m, 'interact', aim)) || !!first('interact', aim); }, // [sit] a seated module gets E first (stand up)
    ride: (p, dt, i) => !!first('ride', p, dt, i), // content hook (sit, zipline): first module to take over motion wins
    seated: () => !!first('seated'), // [sit]
    prompt: aim => { const m = seatedMod(); return (m && call(m, 'prompt', aim)) || first('prompt', aim); }, // [sit] a seated module's prompt wins (E gets you up)
    use: (aim, kind) => !!first('use', aim, kind), // content hook (paint)
    alt: (aim, kind) => !!first('alt', aim, kind), // content hook (paint)
    afterRebuild() { for (const m of mods) call(m, 'afterRebuild'); }, // content hook (paint)
    tileTint: (x, z, base) => first('tileTint', x, z, base), // content hook (paint): plank hex for a painted deck tile, else null
    craftLocked: (recipe, actor) => first('craftLocked', recipe, actor),
    beforeUndecor: (d, actor) => first('beforeUndecor', d, actor), // [undecor]
    undecorLoot: d => { const out = []; for (const m of mods) { const r = call(m, 'undecorLoot', d); if (Array.isArray(r)) out.push(...r); } return out; }, // [undecor]
    afterUndecor: (d, actor) => { for (const m of mods) call(m, 'afterUndecor', d, actor); }, // [undecor]
    decorModel: (type, d) => first('decorModel', type, d),
    sailPush: (s, out) => !!first('sailPush', s, out),
    steerTargets: () => first('steerTargets'),
    rain() { const m = mods.find(m => m.name === 'daynight' && !m.dead); const r = m?.rain; return Number.isFinite(r) ? r : 0; }, // rain-sprinkler: live 0..1 rain
    dispose() { for (const m of mods) call(m, 'dispose'); },
  };
}
