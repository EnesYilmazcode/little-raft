// Sunken shipwreck dive sites (docs/specs/shipwreck.md). Every 8-12 min a small broken ship rests 6-12 m down
// beside the raft for about 4 minutes, marked by floating planks and a bubble column. Divers hold E (the normal
// gather ring, via content.diveTargets) to open crates, barrels and a captain's chest that may hold a logbook
// note. Host-authoritative action 'wreck.open'; slice world.ext.shipwreck. Pure rules: shipwreck-core.js.
import {
  SW, MAX_SLOTS, SLOT_CENTRE, layoutFor, pathAt, nextDelay, dockZFor, raftEdge, offsetFor, candidates,
  fillSlotPos, fullMask, lootFor, applyOpen, clean, DEFAULTS,
} from './shipwreck-core.js?build=v3-survival-ae77fa84ac2b';
import { createShipwreckModel } from './shipwreck-model.js?build=v3-survival-ae77fa84ac2b';
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b'; // same specifier as content.js: one shared instance
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { nextNote, NOTE_COUNT } from './logbook.js?build=v3-survival-ae77fa84ac2b';

const SLEW_SNAP = 1, SLEW_RATE = 4; // guest clock, the islands rules
const SPAWN = 'Bubbles are rising nearby: something rests on the seafloor!';
const THIN = 'The bubbles are thinning: the wreck will soon be lost to the currents';
const CLEARED = 'Wreck cleared! Nothing left but kelp and fish.';
const HINT = 'Bubbles below: dive (C) to explore the wreck';
const LABEL = { crate: 'Hold E · Open crate', barrel: 'Hold E · Open barrel', chest: "Hold E · Open captain's chest" };
const fin = v => typeof v === 'number' && Number.isFinite(v);
const known = id => !!ITEM_INFO[id];
const itemName = k => (ITEM_INFO[k] && ITEM_INFO[k].name) || k;

// Read-only view of the live site for sibling modules (dolphin friend). Import with the content.js ?build=
// specifier. One cached object (do not keep or mutate it) or null.
let live = null;
export function shipwreckNow() { return live ? live() : null; }

export function createShipwreck(ctx) {
  const T = ctx.T;
  const host = () => ctx.role !== 'guest';
  const st = DEFAULTS();                       // {v, clock, next, site}
  let lay = null, slew = 0, warned = false, posFloorOk = false, hoverSlot = -1, built = false;
  const slotPos = new Float32Array(MAX_SLOTS * 3);
  const openSt = { site: null, clock: 0, lay: null, slotPos };
  const path = { phase: 'gone', left: 0, mz: 0 };
  const targets = [];                          // cached per site
  const cand = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
  const out = { v: 1, clock: 0, next: 0, site: null }, outSite = { seed: 0, born: 0, dock: 0, x: 0, z: 0, y: 0, opened: 0 };
  const floorAt = (x, z) => { try { const y = ctx.floorAt?.(x, z); return fin(y) ? y : NaN; } catch { return NaN; } };
  const waveAt = (x, z) => (ctx.ocean && typeof ctx.ocean.getHeight === 'function' ? ctx.ocean.getHeight(x, z) : -0.24);
  const emitAll = text => { try { ctx.emit({ kind: 'notice', text }, 'all'); } catch {} };

  const model = T ? createShipwreckModel(T) : null;
  if (model && ctx.scene) { ctx.scene.add(model.group); ctx.scene.add(model.marker); }

  // ---------- per-site derived data ----------
  function rebuild() {
    const s = st.site;
    lay = s ? layoutFor(s.seed) : null; openSt.lay = lay;
    hoverSlot = -1; targets.length = 0; built = false; posFloorOk = false;
    if (!s) { model?.clear(); return; }
    let ok = true;
    fillSlotPos(lay, s, (x, z) => { const y = floorAt(x, z); if (!fin(y)) ok = false; return y; }, slotPos);
    posFloorOk = ok;
    for (let k = 0; k < lay.slots.length; k++) {
      const kind = lay.slots[k].kind, kk = k, id = 'sw:' + s.seed + ':' + k;
      targets.push({ id, x: slotPos[k * 3], y: slotPos[k * 3 + 1] + SLOT_CENTRE, z: slotPos[k * 3 + 2], secs: kind === 'chest' ? 1.6 : 1.2, label: LABEL[kind],
        done: () => { if (st.site && st.site.seed === s.seed) ctx.action({ kind: 'wreck.open', seed: s.seed, slot: kk }); },
        hover: h => { hoverSlot = h === null || h === undefined ? -1 : kk; model?.hover(hoverSlot); } });
    }
    if (model) {
      try { model.build(lay, slotPos, s, floorAt); built = true; } catch (e) { console.error('shipwreck model failed', e); }
      for (let k = 0; k < lay.slots.length; k++) if ((s.opened >> k) & 1) model.setOpened(k, true);
    }
  }

  // ---------- host ----------
  function spawn(seed) {
    seed = Number.isInteger(seed) && seed >= 0 && seed < 4294967296 ? seed : (Math.random() * 4294967296) >>> 0;
    const isl = islandNow();
    const side = isl && isl.phase !== 'gone' ? (-Math.sign(isl.cx) || 1) : (seed & 1 ? 1 : -1);
    const off = offsetFor(raftEdge(ctx.world && ctx.world.tiles, side));
    candidates(seed, side, off, dockZFor(seed), cand);
    for (const [x, z] of cand) {
      const y = floorAt(x, z);
      if (fin(y) && y >= SW.FLOOR_MIN && y <= SW.FLOOR_MAX) {
        st.site = { seed, born: st.clock, dock: SW.DOCK, x, z, y, opened: 0 };
        warned = false; rebuild(); emitAll(SPAWN);
        return true;
      }
    }
    st.next = st.clock + SW.RETRY;
    return false;
  }
  const nearSite = p => !!p && fin(p.x) && fin(p.y) && fin(p.z) && (p.x - st.site.x) ** 2 + (p.y - st.site.y) ** 2 + (p.z - st.site.z) ** 2 < SW.NEAR * SW.NEAR;

  // ---------- per frame ----------
  function tick(dt) {
    if (!ctx.running) return;
    st.clock += dt;
    if (slew !== 0) {
      const k = Math.min(1, SLEW_RATE * dt), d = slew * k;
      st.clock += d; slew -= d;
      if (Math.abs(slew) < 1e-4) { st.clock += slew; slew = 0; }
    }
  }
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    tick(dt);
    let s = st.site;
    if (host()) {
      if (!s) { if (st.clock >= st.next) spawn(); }
      else {
        pathAt(st.clock - s.born, s.dock, s.z, path);
        if (path.phase === 'gone') { st.site = null; st.next = st.clock + nextDelay(s.seed); rebuild(); }
        else if (path.phase === 'docked') {
          if (path.left <= SW.WARN + 1 && s.dock < SW.DOCK_CAP && (nearSite(ctx.physics) || nearSite(ctx.other))) s.dock = Math.min(SW.DOCK_CAP, s.dock + dt);
          else if (path.left <= SW.WARN && !warned) { warned = true; emitAll(THIN); }
        }
      }
    }
    s = st.site;
    if (!s) { path.phase = 'gone'; if (model) model.group.visible = model.marker.visible = false; return; }
    if (!posFloorOk && fin(floorAt(s.x, s.z))) rebuild(); // diving came up after load: drop containers onto the real floor
    pathAt(st.clock - s.born, s.dock, s.z, path);
    if (!model || !built) return;
    const cam = ctx.camera, cp = cam && cam.position;
    const under = !!cp && cp.y < waveAt(cp.x, cp.z) + 0.25;
    model.group.visible = path.phase === 'docked' && under;
    model.marker.visible = path.phase !== 'gone' && !model.group.visible;
    const time = fin(ctx.elapsed) ? ctx.elapsed : 0;
    if (model.group.visible) model.update(time, dt);
    if (model.marker.visible) model.updateMarker(s.x, path.mz, waveAt, time);
  }

  // ---------- dive targets (every client, no allocations) ----------
  function diveTargets(x, y, z, r, list) {
    const s = st.site;
    if (!s || path.phase !== 'docked' || !((x - s.x) ** 2 + (z - s.z) ** 2 < 100)) return;
    const r2 = r * r;
    for (let k = 0; k < targets.length; k++) {
      if ((s.opened >> k) & 1) continue;
      const t = targets[k], dx = t.x - x, dy = t.y - y, dz = t.z - z;
      if (dx * dx + dy * dy + dz * dz <= r2) list.push(t);
    }
  }

  // ---------- host action ----------
  function action(a, actor, bag) {
    if (!a || a.kind !== 'wreck.open') return false;
    if (!host()) return true;
    const world = ctx.world, notes = world && Array.isArray(world.notes) ? world.notes : null;
    const hasNote = !!notes && nextNote(notes) >= 0;
    const pos = actor === 'guest' ? ctx.other : ctx.physics;
    openSt.site = st.site; openSt.clock = st.clock; openSt.lay = lay;
    const r = applyOpen(openSt, a, actor, pos, bag, hasNote, known);
    if (r.ok) {
      const loot = {};
      for (const [id, n] of r.loot) loot[id] = n;
      ctx.emit({ kind: 'loot', loot, text: r.loot.map(([k, n]) => `+${n} ${itemName(k)}`).join(', ') }, actor);
      if (r.note) {
        const n = nextNote(notes);
        if (n >= 0) {
          notes.push(n);
          ctx.emit({ kind: 'note', note: n, text: `A captain's note! (${notes.length}/${NOTE_COUNT}) · L to read` }, 'all');
          try { ctx.award?.({ kind: 'note' }); } catch (e) { console.error('shipwreck award failed', e); }
        }
      }
      model?.setOpened(a.slot, true);
      if (st.site.opened === fullMask(lay)) emitAll(CLEARED);
    } else if (r.reason === 'full') ctx.emit({ kind: 'full', text: 'Your bag is full' }, actor);
    else if (r.reason === 'opened') ctx.emit({ kind: 'notice', text: 'Already empty' }, actor);
    return true;
  }

  // ---------- save / net ----------
  function serialize() {
    out.clock = st.clock; out.next = st.next;
    const s = st.site;
    if (!s) out.site = null;
    else { outSite.seed = s.seed; outSite.born = s.born; outSite.dock = s.dock; outSite.x = s.x; outSite.z = s.z; outSite.y = s.y; outSite.opened = s.opened; out.site = outSite; }
    return out;
  }
  function load(data, from) {
    const c = clean(data);
    const err = c.clock - st.clock;
    if (from === 'net' && st.site && c.site && st.site.seed === c.site.seed && Math.abs(err) <= SLEW_SNAP) slew = err;
    else { st.clock = c.clock; slew = 0; }
    st.next = c.next;
    if (!c.site) { if (st.site) { st.site = null; rebuild(); } return; }
    if (!st.site || st.site.seed !== c.site.seed) { st.site = c.site; rebuild(); }
    else {
      const s = st.site;
      s.born = c.site.born; s.dock = c.site.dock;
      const was = s.opened; s.opened = c.site.opened;
      if (was !== s.opened && lay) for (let k = 0; k < lay.slots.length; k++) { const b = (s.opened >> k) & 1; if (((was >> k) & 1) !== b) model?.setOpened(k, !!b); }
    }
    const s = st.site;
    pathAt(st.clock - s.born, s.dock, s.z, path);
    warned = path.phase === 'depart' || (path.phase === 'docked' && path.left <= SW.WARN);
  }

  // ---------- surface hint ----------
  function prompt(aim) {
    const s = st.site, cp = ctx.camera && ctx.camera.position;
    if (!s || path.phase === 'gone' || !aim || !aim.point || !cp) return null;
    if (cp.y < waveAt(cp.x, cp.z) - 0.05) return null; // diving
    const dx = aim.point.x - s.x, dz = aim.point.z - path.mz;
    return dx * dx + dz * dz <= 16 ? HINT : null;
  }

  function dispose() {
    if (live === mine) live = null;
    model?.dispose();
  }

  // ---------- live accessor ----------
  const now = { seed: 0, x: 0, y: 0, z: 0, phase: 'gone', left: 0, cleared: false };
  function mine() {
    const s = st.site;
    if (!s || !lay) return null;
    now.seed = s.seed; now.x = s.x; now.y = s.y; now.z = path.mz; now.phase = path.phase; now.left = path.left;
    now.cleared = s.opened === fullMask(lay);
    return now;
  }
  live = mine;

  // ---------- QA (raftDebug.content.shipwreck) ----------
  const slotOf = k => (lay && Number.isInteger(k) && k >= 0 && k < lay.slots.length ? k : -1);
  const debug = {
    summon(seed) {
      if (!host()) return false;
      let s0 = Number.isInteger(seed) && seed >= 0 ? seed >>> 0 : (Math.random() * 4294967296) >>> 0;
      for (let i = 0; i < 12; i++) if (spawn((s0 + i * 7919) >>> 0)) return debug.phase();
      return false;
    },
    dock() { if (!host() || !st.site) return false; st.site.born = st.clock - SW.APPROACH; update(0); return debug.phase(); },
    skip(sec = 0) { if (host() && fin(sec) && sec > 0) st.clock += sec; update(0); return debug.phase(); },
    phase() {
      const s = st.site;
      if (!s) return { phase: 'calm', left: Math.max(0, st.next - st.clock), clock: st.clock, next: st.next, seed: null };
      const p = pathAt(st.clock - s.born, s.dock, s.z, {});
      return { phase: p.phase, left: p.left, clock: st.clock, next: st.next, seed: s.seed, variant: lay?.variant, mz: p.mz };
    },
    site() { const m = mine(); return m ? { ...m, opened: st.site.opened, slots: lay.slots.length } : null; },
    slots() {
      if (!st.site || !lay) return [];
      return lay.slots.map((s, k) => ({ k, kind: s.kind, x: slotPos[k * 3], y: slotPos[k * 3 + 1], z: slotPos[k * 3 + 2], open: !!((st.site.opened >> k) & 1) }));
    },
    teleportDiver(k = 0) {
      k = slotOf(k); if (k < 0 || !ctx.diving?.warp || !ctx.physics) return null;
      const x = slotPos[k * 3], y = slotPos[k * 3 + 1] + 1.2, z = slotPos[k * 3 + 2] + 1.8;
      ctx.diving.warp(ctx.physics, x, y, z);
      return { x, y, z, yaw: 0, pitch: Math.atan2(SLOT_CENTRE - 1.2, 1.8) };
    },
    warpTo(x, y, z) { if (![x, y, z].every(fin) || !ctx.diving?.warp || !ctx.physics) return false; return ctx.diving.warp(ctx.physics, x, y, z); }, // free QA warp (any client)
    open(k = 0) { k = slotOf(k); if (k < 0) return false; return ctx.action({ kind: 'wreck.open', seed: st.site.seed, slot: k }); },
    openAll() { if (!lay) return 0; let n = 0; for (let k = 0; k < lay.slots.length; k++) if (debug.open(k)) n++; return n; },
    loot(k = 0) {
      k = slotOf(k); if (k < 0) return null;
      const notes = ctx.world && Array.isArray(ctx.world.notes) ? ctx.world.notes : [];
      return lootFor(st.site.seed, k, lay.slots[k].kind, nextNote(notes) >= 0, known);
    },
    targets: () => targets.length, hover: () => hoverSlot,
  };

  return { name: 'shipwreck', update, serialize, load, action, diveTargets, prompt, debug, dispose };
}
