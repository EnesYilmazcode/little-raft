// One raft, one save. Every per-save part (progression and stations, grills and journal, logbook "seen",
// onboarding notes, first-run hints, pinned recipe) lives inside the world save 'little-raft-v1' as
// world.parts[name], so a single guarded setItem writes the bag and the stations together, and the
// two-tab revision guard (planSave) covers all of it.
//
// Modules keep their key-based persistence code but read and write through `store.storage`, a
// Storage-like adapter that maps each legacy key onto its part (in memory). Only write() touches the
// real world key. Modules register {flush, load, reset}: flush() pushes their live state into the
// adapter right before a write, load() re-reads it after loadAll(), reset() starts a fresh raft.
// Profile keys (settings, sound, controls, name, prompts, debug flags) never pass through here.
import { planSave } from './session-rules.js';

export const SAVE_KEY = 'little-raft-v1';
// part name -> the localStorage key the part used before it moved into the world save
export const PARTS = Object.freeze({
  prog: 'littleRaft.progression.v1',
  fc: 'little-raft-fc-v1',
  logbook: 'little-raft-logbook-seen',
  hints: 'little-raft-hints',
  onboarding: 'little-raft-onboarding-v1',
  pin: 'little-raft-pinned-recipe',
});
const NAME_OF = Object.fromEntries(Object.entries(PARTS).map(([n, k]) => [k, n]));

const parse = (raw) => { if (typeof raw !== 'string' || !raw) return null; try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; } };

/** The parts stored in a world save string: {parts, legacy}. legacy: a raft saved before parts existed. */
export function partsOf(raw) {
  const v = parse(raw);
  if (!v) return { parts: null, legacy: false };
  if (!v.parts || typeof v.parts !== 'object') return { parts: null, legacy: true };
  const parts = {};
  for (const name of Object.keys(PARTS)) if (typeof v.parts[name] === 'string') parts[name] = v.parts[name];
  return { parts, legacy: false };
}

/**
 * storage: a Storage (or a function returning one; it may throw). key: the world save key.
 * Returns { storage, register, loadAll, flush, parts, write, reset, has }.
 */
export function createSaveStore({ storage, key = SAVE_KEY } = {}) {
  const real = () => { try { return typeof storage === 'function' ? storage() : storage ?? null; } catch { return null; } };
  const get = (k) => { try { return real()?.getItem(k) ?? null; } catch { return null; } };
  const del = (k) => { try { real()?.removeItem(k); } catch {} };
  const hooks = new Map(); // owner -> {flush, load, reset}
  let parts = {}, legacy = false, final = false;

  const dropLegacy = () => { for (const k of Object.values(PARTS)) del(k); };
  function adopt(raw) {
    const p = partsOf(raw);
    parts = p.parts ?? {}; legacy = p.legacy;
    if (legacy) { for (const [name, k] of Object.entries(PARTS)) { const s = get(k); if (s != null) parts[name] = s; } } // migrate once
    else if (!p.parts) dropLegacy(); // no raft saved: leftovers from an old build must never seed a new raft
  }
  adopt(get(key));

  const each = (fn) => { for (const h of [...hooks.values()]) { try { h[fn]?.(); } catch (e) { console.warn('[save-store]', fn, e); } } };

  const adapter = Object.freeze({
    getItem: (k) => (NAME_OF[k] ? parts[NAME_OF[k]] ?? null : get(k)),
    setItem: (k, v) => { if (NAME_OF[k]) parts[NAME_OF[k]] = String(v); else real()?.setItem(k, String(v)); },
    removeItem: (k) => { if (NAME_OF[k]) delete parts[NAME_OF[k]]; else del(k); },
  });

  return {
    storage: adapter,
    /** Owner hooks {flush, load, reset}. Re-registering an owner replaces it (hot reload); the returned function only undoes its own entry. */
    register(owner, h) {
      const entry = { ...h }, prev = hooks.get(owner);
      hooks.set(owner, entry);
      return () => { if (hooks.get(owner) !== entry) return; if (prev) hooks.set(owner, prev); else hooks.delete(owner); }; // a failed hot-swap mount hands back to the old engine
    },
    /** Adopt the parts of a world save string (Continue from another tab's save, a guest going home), then let every module re-read. */
    loadAll(raw) { adopt(raw); each('load'); },
    flush() { each('flush'); },
    /** Every part as it would be written now. */
    parts() { each('flush'); return { ...parts }; },
    /**
     * The one guarded write. world: the world object to save. baseRev: the revision this tab last loaded or wrote.
     * -> {ok, rev} on success; {ok:false, rev:baseRev} when another tab saved newer (caller stops saving);
     *    {ok:false, final:true} after reset({final}) (the page is wiping and reloading). Storage errors throw.
     */
    write(world, baseRev) {
      if (final) return { ok: false, final: true, rev: baseRev };
      const s = real(); if (!s) throw new Error('storage unavailable');
      const plan = planSave(s.getItem(key), baseRev);
      if (!plan.ok) return { ok: false, rev: baseRev, stored: plan.stored };
      each('flush');
      s.setItem(key, JSON.stringify({ ...world, parts: { ...parts }, rev: plan.rev, savedAt: Date.now() }));
      if (legacy) { legacy = false; dropLegacy(); }
      return { ok: true, rev: plan.rev };
    },
    /** New game: every part starts over and every module resets its live state. final: also delete the save and refuse later writes. */
    reset({ final: last = false } = {}) {
      parts = {}; legacy = false;
      each('reset');
      parts = {}; // a reset hook may have flushed its old state into the adapter
      dropLegacy();
      if (last) { final = true; del(key); }
    },
    has: () => get(key) != null,
    get legacy() { return legacy; },
  };
}

// The page's store, shared by game.js (any hot-swapped build) and onboarding.js.
const GLOBAL = Symbol.for('littleRaft.saveStore');
export function getSaveStore() {
  return (globalThis[GLOBAL] ??= createSaveStore({ storage: () => globalThis.localStorage, key: SAVE_KEY }));
}

export default getSaveStore;
