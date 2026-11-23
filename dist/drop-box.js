// Dropped item boxes, content module. Slice: world.ext.dropbox (host-authoritative, saved and sent in state).
// Q drops one of the held item, Ctrl+Q the whole stack ('dropbox.drop'); E on a box takes what fits
// ('dropbox.take'), shown in the bottom-left pickup feed. Pure rules live in drop-box-core.js.
import { DROP, emptySlice, cleanSlice, serializeSlice, landing, takeFromSlot, dropInto, takeInto, stepBox } from './drop-box-core.js?build=v3-survival-ae77fa84ac2b';
import { getModel } from './models.js?build=v3-survival-ae77fa84ac2b';
import { islandNow } from './islands.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';

const ACTIONS = ['dropbox.drop', 'dropbox.take'];
const SCALE = .5, HALF = .17, RAD = .34, DECK = .22, FLOAT = -.1, DRY = .05;
const OLD_HOST = 'Your friend’s raft can’t take dropped items yet';
const NO_FLOW = Object.freeze({ x: 0, z: 0, b: .22 });
const fin = v => typeof v === 'number' && Number.isFinite(v);

export function createDropBox(ctx) {
  const T = ctx.T;
  let slice = emptySlice(), hostOld = false, clock = 0, group = null, frame = 0, takeAt = -1;
  const meshes = new Map(); // id -> {g, x, z, y, rx, rz, seen}
  const v = new T.Vector3(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), S = { h: 0, sx: 0, sz: 0 }, land = { x: 0, z: 0 };
  const isl = { x: NaN, z: NaN };
  const host = () => ctx.role !== 'guest';
  const tiles = () => (Array.isArray(ctx.world?.tiles) ? ctx.world.tiles : []);
  const ground = (x, z) => { const i = islandNow(); try { return i ? i.groundAt(x, z) : NaN; } catch { return NaN; } };
  const env = { tiles: null, ground, water: () => DRY, carryX: 0, carryZ: 0, clock: 0 };
  const notice = s => { try { ctx.notice(s); } catch {} };
  const tell = (e, actor) => { try { ctx.emit(e, actor); } catch {} };
  const posOf = actor => (actor === 'guest' ? ctx.other ?? null : ctx.physics ?? null);
  const find = id => { for (const b of slice.boxes) if (b.id === id) return b; return null; };

  // ------------------------------------------------------------------ local input
  function drop(all) {
    if (!ctx.running || ctx.uiOpen?.()) return false;
    const p = ctx.physics, bag = ctx.localBag?.();
    if (!p || !bag) return false; // game.js dropHeld() already refuses under water, passed out and with the build wheel open
    const i = bag.selectedIndex, s = bag.slots?.[i];
    if (!s) return true; // empty hand: nothing to drop
    if (!host() && hostOld) { notice(OLD_HOST); return true; }
    const d = ctx.camera?.getWorldDirection(v);
    ctx.action({ kind: 'dropbox.drop', slot: i, item: s.kind, all: !!all, fx: d ? d.x : 0, fz: d ? d.z : -1 });
    return true;
  }

  // Ray from the camera along aim.dir against each box's sphere.
  function aimBox(aim) {
    const cam = ctx.camera; if (!aim?.dir || !cam || !slice.boxes.length) return null;
    const o = cam.position, d = aim.dir;
    let best = null, bt = DROP.REACH;
    for (const b of slice.boxes) {
      const e = meshes.get(b.id); if (!e || b.f > 0) continue;
      const p = e.g.position, wx = p.x - o.x, wy = p.y + HALF - o.y, wz = p.z - o.z;
      const t = wx * d.x + wy * d.y + wz * d.z; if (t < 0 || t > bt) continue;
      const cx = wx - d.x * t, cy = wy - d.y * t, cz = wz - d.z * t;
      if (cx * cx + cy * cy + cz * cz > RAD * RAD) continue;
      bt = t; best = b;
    }
    return best;
  }
  function interact(aim) {
    if (ctx.uiOpen?.()) return false;
    const b = aimBox(aim); if (!b) return false;
    if (clock - takeAt < .4) return true; // one request per press while the host answers
    takeAt = clock;
    ctx.action({ kind: 'dropbox.take', id: b.id });
    return true;
  }
  function prompt(aim) {
    const b = aimBox(aim); if (!b) return null;
    const one = b.items.length === 1 ? b.items[0] : null, name = one ? ITEM_INFO[one.kind]?.name : null;
    return '<kbd>E</kbd>' + (name ? `Pick up ${one.count > 1 ? one.count + ' ' : ''}${ctx.esc ? ctx.esc(name) : name}` : 'Pick up box');
  }

  // ------------------------------------------------------------------ host actions
  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || !ACTIONS.includes(a.kind)) return false;
    if (!host()) return true;
    const p = posOf(actor);
    if (!p || !fin(p.x) || !fin(p.z)) return true;
    if (a.kind === 'dropbox.drop') {
      if (!bag || !fin(a.fx) || !fin(a.fz)) return true;
      landing(p.x, p.z, a.fx, a.fz, land);
      const stack = takeFromSlot(bag, a.slot, !!a.all, typeof a.item === 'string' ? a.item : undefined);
      if (!stack) return true;
      const l = Math.hypot(a.fx, a.fz) || 1, hy = fin(p.y) ? p.y - .45 : (ctx.deckY?.() ?? 0) + 1.2;
      const box = dropInto(slice, stack, land.x, land.z, { tiles: tiles(), ground: ground(land.x, land.z), water: DRY,
        origin: [p.x + a.fx / l * .35, hy, p.z + a.fz / l * .35], r: Math.random() * Math.PI * 2 });
      if (!box) { // the sea is full of boxes: give it back
        const meta = {}; if (stack.durability !== undefined) meta.durability = stack.durability; if (stack.id !== undefined) meta.id = stack.id;
        bag.add(stack.kind, stack.count, meta);
        tell({ kind: 'notice', text: 'Too many boxes adrift already' }, actor); return true;
      }
      tell({ kind: 'notice', sound: 'throw' }, actor);
      return true;
    }
    // dropbox.take
    const b = Number.isInteger(a.id) ? find(a.id) : null;
    if (!b || !bag) return true;
    if (Math.hypot(p.x - b.x, p.z - b.z) > DROP.REACH + 1 + (actor === 'guest' ? DROP.GUEST_SLACK : 0)) return true;
    const r = takeInto(bag, b);
    if (r.empty) slice.boxes.splice(slice.boxes.indexOf(b), 1);
    if (!r.taken) { tell({ kind: 'full', text: 'Your bag is full' }, actor); return true; }
    tell({ kind: 'loot', loot: r.loot, sound: 'collect' }, actor);
    return true;
  }

  // ------------------------------------------------------------------ per frame
  function meshFor(b) {
    let e = meshes.get(b.id);
    if (e) return e;
    if (!group) { group = new T.Group(); group.name = 'dropBoxes'; ctx.scene?.add(group); }
    const g = getModel('crate') ?? new T.Group(); // shared cached geometry and materials: never disposed here
    g.scale.setScalar(SCALE);
    group.add(g);
    e = { g, x: b.x, z: b.z, y: NaN, rx: 0, rz: 0, seen: 0 };
    meshes.set(b.id, e);
    return e;
  }
  function update(dt) {
    if (!(dt >= 0)) dt = 0;
    clock += dt; frame++;
    const i = islandNow();
    env.carryX = env.carryZ = 0;
    if (i && fin(i.cx)) { if (isl.x === isl.x) { env.carryX = i.cx - isl.x; env.carryZ = i.cz - isl.z; } isl.x = i.cx; isl.z = i.cz; } else isl.x = NaN;
    env.tiles = tiles(); env.clock = clock;
    const flow = ctx.sailFlow ?? NO_FLOW, boxes = slice.boxes;
    for (let k = boxes.length - 1; k >= 0; k--) if (stepBox(boxes[k], dt, flow, env) && host()) boxes.splice(k, 1); // a guest waits for the host to drop it
    if (!boxes.length && !meshes.size) return;
    const raft = ctx.raft, ocean = ctx.ocean, k6 = Math.min(1, dt * 6), k3 = Math.min(1, dt * 3);
    let raftReady = false;
    for (const b of boxes) {
      const e = meshFor(b), g = e.g; e.seen = frame;
      if (host() || Math.hypot(e.x - b.x, e.z - b.z) > 3) { e.x = b.x; e.z = b.z; } else { e.x += (b.x - e.x) * k6; e.z += (b.z - e.z) * k6; }
      let y, onRaft = b.s === 'raft' && raft;
      if (onRaft) {
        if (!raftReady) { raft.updateWorldMatrix(true, false); raftReady = true; }
        v.set(e.x, DECK, e.z); raft.localToWorld(v); y = v.y;
      } else if (b.s === 'land') y = b.y;
      else if (ocean?.sample) { ocean.sample(e.x, e.z, S); y = S.h + FLOAT; } else y = FLOAT;
      if (b.f > 0 && b.o) { // the throw arc: from the hand to where it lands
        const t = 1 - b.f / DROP.FLY, o = b.o;
        g.position.set(o[0] + (e.x - o[0]) * t, o[1] + (y - o[1]) * t + Math.sin(Math.PI * t) * .45, o[2] + (e.z - o[2]) * t);
        g.rotation.set(t * 1.4, b.r + t * 2, 0); e.y = y; continue;
      }
      if (onRaft) {
        g.position.copy(v); q.setFromAxisAngle(up, b.r); g.quaternion.copy(raft.quaternion).multiply(q);
      } else if (b.s === 'land') {
        g.position.set(e.x, y, e.z); g.rotation.set(0, b.r, 0);
      } else { // floats: bob with the waves and lean with the slope
        e.rx += (-S.sz * 1.1 + Math.sin(clock * 1.3 + b.id) * .05 - e.rx) * k3;
        e.rz += (S.sx * 1.1 + Math.sin(clock + b.id) * .05 - e.rz) * k3;
        g.position.set(e.x, y + Math.sin(clock * 1.7 + b.id) * .02, e.z); g.rotation.set(e.rx, b.r + clock * .05, e.rz);
      }
      e.y = y;
    }
    if (meshes.size > boxes.length) for (const [id, e] of meshes) if (e.seen !== frame) { e.g.removeFromParent(); meshes.delete(id); }
  }

  // ------------------------------------------------------------------ save / net
  const serialize = () => serializeSlice(slice);
  function load(data, from) {
    slice = cleanSlice(data);
    hostOld = from === 'net' && data === undefined; // an older host never sends the slice
  }

  // ------------------------------------------------------------------ debug (raftDebug.content.dropbox)
  const debug = {
    state: () => ({ hostOld, boxes: slice.boxes.map(b => ({ ...b, items: b.items.map(s => ({ ...s })) })) }),
    drop: all => drop(all),
    take: id => { const b = id === undefined ? slice.boxes[0] : find(id); if (!b) return false; takeAt = -1; return ctx.action({ kind: 'dropbox.take', id: b.id }) !== false; },
    age: sec => { for (const b of slice.boxes) if (b.s === 'sea') b.age += +sec || 0; },
    meshes: () => [...meshes].map(([id, e]) => ({ id, x: e.g.position.x, y: e.g.position.y, z: e.g.position.z })),
  };

  function dispose() {
    for (const e of meshes.values()) e.g.removeFromParent();
    meshes.clear(); group?.removeFromParent(); group = null;
  }

  return { name: 'dropbox', update, serialize, load, action, interact, prompt, drop, debug, dispose };
}
