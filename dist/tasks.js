// Crew tasks: three small cozy tasks per in-game day, shared by the crew (see docs/specs/tasks.md).
// Content module 'tasks'. Slice: world.ext.tasks, host-authoritative; guests read it from the host state
// and send 'tasks.claim' actions. Counting happens on the host through observe(ev, actor) calls that
// game.js (and a few lanes) make after a successful action. Rules live in dist/tasks-rules.js.
import { DAY_SECONDS, BY_ID, cleanTasks, observeTasks, rollTasks, claimTasks, taskView, allDone, completeTask, bundleText, bitOf } from './tasks-rules.js?build=v3-survival-ae77fa84ac2b';
import { createTaskBoard } from './tasks-model.js?build=v3-survival-ae77fa84ac2b';

export const REACH = 2.6;
export const TEXT = Object.freeze({ fresh: 'A fresh day, fresh tasks!', full: 'Your bag is full' });

export function createTasks(ctx) {
  const T = ctx.T;
  const seed0 = (Math.random() * 4294967296) >>> 0;
  let needOverride = null;
  const scratch = T ? new T.Vector3() : null;
  const decor = () => (Array.isArray(ctx.world?.decor) ? ctx.world.decor : []);
  const isGuest = () => ctx.role === 'guest';

  // Plain booleans for task `need` flags, computed by the host at pick time.
  function needs() {
    const w = ctx.world, d = decor();
    const bags = [];
    for (const a of ['host', 'guest']) { try { const b = ctx.actorBag?.(a); if (b && typeof b.count === 'function') bags.push(b); } catch {} }
    const has = k => bags.some(b => b.count(k) > 0);
    let grill = d.some(x => x && x.type === 'grill');
    if (!grill) { try { grill = !!ctx.hasGrill?.(); } catch {} }
    const out = {
      net: d.some(x => x && x.type === 'net'), rod: has('fishingrod'), grill, hammer: has('hammer'),
      palm: !!(w?.garden && typeof w.garden === 'object' && Object.keys(w.garden).length),
      notesLeft: !Array.isArray(w?.notes) || w.notes.length < 12,
    };
    return needOverride ? { ...out, ...needOverride } : out;
  }

  let st = cleanTasks(undefined, needs(), seed0);
  let lastSrc = null, rev = 0, netSig = null, hostHas = true, viewCache = null, viewKey = '';

  const emit = (e, to) => { try { ctx.emit?.(e, to); } catch {} };
  function roll(k) {
    if (!rollTasks(st, k, needs())) return false;
    rev++; emit({ kind: 'notice', text: TEXT.fresh }, 'all');
    return true;
  }
  function celebrate(fin, wasAll) {
    if (!fin.length) return;
    rev++;
    for (const i of fin) emit({ kind: 'notice', text: `Task done: ${BY_ID[st.ids[i]].label}` }, 'all');
    if (!wasAll && allDone(st)) emit({ kind: 'achievement', text: `Crew tasks done! Streak ${st.streak}` }, 'all');
  }
  function observe(ev) {
    if (isGuest()) return;
    const wasAll = allDone(st), before = st.prog[0] + st.prog[1] + st.prog[2];
    const fin = observeTasks(st, ev);
    if (st.prog[0] + st.prog[1] + st.prog[2] !== before) rev++; // partial progress refreshes the view too
    celebrate(fin, wasAll);
  }

  // Host clock: advance by day deltas from daynight, or by play time when daynight is off.
  function tick(dt) {
    let src = null; try { src = ctx.dayIndex?.() ?? null; } catch { src = null; }
    if (Number.isInteger(src)) {
      if (lastSrc !== null && src > lastSrc) roll(src - lastSrc);
      lastSrc = src; // a backwards jump (daynight restore / wrap) just resyncs
      return;
    }
    lastSrc = null;
    if (!ctx.running) return;
    st.playT += dt > 0 && Number.isFinite(dt) ? dt : 0;
    if (st.playT >= DAY_SECONDS) { const k = Math.floor(st.playT / DAY_SECONDS); st.playT -= k * DAY_SECONDS; roll(k); }
  }

  // Nearest task board along the view ray (or camera forward), within reach.
  function target(aim) {
    const p = ctx.physics, cam = ctx.camera, d = decor(); if (!p || !cam || !d.length) return null;
    let dx, dy, dz;
    if (aim && aim.dir) { dx = aim.dir.x; dy = aim.dir.y; dz = aim.dir.z; }
    else if (scratch) { cam.getWorldDirection(scratch); dx = scratch.x; dy = scratch.y; dz = scratch.z; }
    else return null;
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    let best = null, bestScore = Infinity;
    for (const b of d) {
      if (!b || b.type !== 'taskboard') continue;
      const cx = b.x * 2, cz = b.z * 2;
      if (Math.hypot(p.x - cx, p.z - cz) > REACH) continue;
      const cy = (ctx.raft?.position.y ?? 0) + .85;
      const vx = cx - ox, vy = cy - oy, vz = cz - oz, along = vx * dx + vy * dy + vz * dz;
      if (along <= 0) continue;
      const ex = vx - dx * along, ey = vy - dy * along, ez = vz - dz * along, off = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (off > .9) continue;
      const score = off + along * .05;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  function view() {
    if (isGuest() && !hostHas) return null;
    const bit = isGuest() ? 2 : 1, key = rev + '|' + bit;
    if (viewCache && key === viewKey) return viewCache;
    viewKey = key; viewCache = taskView(st, bit);
    return viewCache;
  }

  function promptList() {
    const v = view(); if (!v) return null;
    const out = [{ key: 'E', label: 'Crew tasks' }];
    if (v.claimable) out.push({ label: `${v.claimable} to claim`, muted: true });
    return out;
  }
  function providerPrompt(pctx) {
    const s = pctx?.state;
    if (!s || s.pickup || s.swimming || (s.role === 'guest' && !s.networkReady)) return null;
    if (!target(null)) return null;
    return promptList();
  }
  let unprompt = null, promptTries = 0;
  function registerPrompt() {
    if (unprompt || promptTries > 600) return;
    promptTries++;
    try { unprompt = globalThis.window?.raftPrompts?.provide?.({ id: 'tasks', priority: 1, prompt: providerPrompt }) ?? null; } catch { unprompt = null; }
  }

  function load(data, from) {
    if (from === 'net') {
      if (data === undefined) { if (hostHas) { hostHas = false; netSig = null; rev++; } return; }
      let sig; try { sig = JSON.stringify(data); } catch { return; }
      if (sig === netSig) return;
      netSig = sig; hostHas = true;
      st = cleanTasks(data, null, 0); rev++;
      return;
    }
    netSig = null; hostHas = true; lastSrc = null;
    st = cleanTasks(data, needs(), seed0); rev++;
  }

  function addAllTo(bag) {
    return bundle => {
      if (!bag || typeof bag.snapshot !== 'function') return false;
      const s = new bag.constructor(bag.snapshot());
      for (const [k, c] of Object.entries(bundle)) if (s.add(k, c) > 0) return false;
      for (let i = 0; i < s.slots.length; i++) bag.slots[i] = s.slots[i];
      if (typeof bag.version === 'number') bag.version++;
      return true;
    };
  }

  return {
    name: 'tasks',
    load,
    serialize: () => st,
    update(dt) {
      registerPrompt();
      if (isGuest()) return;
      tick(dt);
    },
    observe,
    view,
    prompt(aim) {
      if (!target(aim)) return null;
      const l = promptList(); if (!l) return null;
      return '<kbd>E</kbd>Crew tasks' + (l[1] ? ' · ' + l[1].label : '');
    },
    interact(aim) {
      if (!target(aim)) return false;
      try { document.dispatchEvent(new CustomEvent('littleraft:open-logbook', { detail: { tab: 'tasks' } })); } catch {}
      return true;
    },
    action(a, actor, bag) {
      if (!a || typeof a.kind !== 'string' || !a.kind.startsWith('tasks.')) return false;
      if (isGuest() || a.kind !== 'tasks.claim') return true;
      const r = claimTasks(st, a, actor, addAllTo(bag));
      if (r.ok) { rev++; emit({ kind: 'loot', text: '+ ' + bundleText(r.loot), loot: r.loot }, actor); }
      else if (r.reason === 'full') emit({ kind: 'full', text: TEXT.full }, actor);
      return true;
    },
    decorModel(type) { return T && type === 'taskboard' ? createTaskBoard(T) : null; },
    debug: {
      state: () => JSON.parse(JSON.stringify(st)),
      view: () => view(),
      needs: () => needs(),
      observe: ev => observe(ev),
      nextDay(k = 1) { if (isGuest()) return false; return roll(k); },
      complete(i) { if (isGuest()) return false; const wasAll = allDone(st); if (!completeTask(st, i)) return false; celebrate([i], wasAll); return true; },
      setNeeds(obj) { needOverride = obj && typeof obj === 'object' ? { ...obj } : null; return needs(); },
      setPlayT(sec) { if (!isGuest() && Number.isFinite(sec)) { st.playT = Math.max(0, Math.min(DAY_SECONDS - 0.001, sec)); } return st.playT; },
      claim: i => ctx.action?.({ kind: 'tasks.claim', i }),
      target: aim => target(aim),
      bit: () => bitOf(ctx.role),
    },
    dispose() { try { unprompt?.(); } catch {} unprompt = null; },
  };
}

export default createTasks;
