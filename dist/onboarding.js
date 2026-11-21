// Little Raft onboarding: top-right "Notes" objective tracker + left-aligned title menu. No centred text, ever.
// API (window.raftOnboarding): register({chapter, title?, after?, steps}), complete(id), reset(), state().
// Step: {id, title, hint (string or S -> string), done(S, base, ctx) -> bool, count?(S, base, ctx) -> [n, of], start?(S) -> base, needs?:[ids],
//        optional?:bool (never blocks its chapter), show?(S) -> bool (visibility gate), every?:bool (shown in any chapter)}.
// count may add a unit: [n, of, '°']. ctx = {S0, gained(k), yawTravel, walked (path metres), prev, mem, silent}. Completion reads only window.raftDebug.hud (a light live view; .state if absent), polled 250 ms.
export const SAVE_KEY = 'little-raft-v1', KEY = 'little-raft-onboarding-v1', AUTOSTART = 'little-raft-autostart';
const POLL_MS = 250, MAX_ROWS = 3, DIM_MS = 20000, HOLD_MS = 2000, ASIDE_MIN = 190, GUTTER = 8;

const num = v => (Number.isFinite(v) ? v : 0);
const arr = v => (Array.isArray(v) ? v : []);
const inv = (S, k) => num(S?.stock?.[k]);
const owns = (S, k) => arr(S.ownedTools).includes(k);
const placed = (S, t) => arr(S.decor).some(d => d?.type === t);
const decorCount = (S, t) => arr(S.decor).filter(d => d?.type === t).length;
const MATS = ['wood', 'leaf', 'scrap', 'plastic'];
// A guest playing in the host's world: world counters (collected, fish, tiles, decor) are the host's, not ours.
export const hostWorld = S => S?.role === 'guest' && !!S.networkReady;
const placedNow = (S, b, c, t) => (c.hostWorld ? decorCount(S, t) > num(b?.decor?.[t]) : placed(S, t));
const fishSince = (S, b, c) => (c.hostWorld ? c.gained('fish') : num(S.fish) - num(b.fish));
const handGrab = (S, c, type) => !!(c.prev?.pickup && c.prev.hookStage === 'idle' && num(S.collected) > num(c.prev.collected)
  && (type ? c.prev.pickup.type === type : MATS.some(k => inv(S, k) > inv(c.prev, k))));
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const FRESH = Object.freeze({tiles:4, fish:0, collected:0, stock:{}, me:null, hookHealth:100});
const played = (S, c) => c.silent && num(S.collected) > 0; // returning players skip the very first lessons
// Gather count = the most ever seen of max(gained since the step showed, held now): what you already carry counts, and
// spending never lowers it. or: a later milestone that proves the step.
const most = (c, v) => (c.mem.hi = Math.max(num(c.mem.hi), v));
const gainStep = (id, title, hint, k, n, needs, or) => ({id, title, hint, needs, count:(S, b, c) => [most(c, Math.max(c.gained(k), inv(S, k))), n],
  ...(or && {done:(S, b, c) => most(c, Math.max(c.gained(k), inv(S, k))) >= n || or(S)})});
const hasHammer = S => owns(S, 'hammer'), hasRod = S => owns(S, 'fishingrod');
// Hotbar key for an item: 'Press [6] to hold your hammer, then ' ('' when it is already in hand, null when not in the bag).
const slotOf = (S, k) => arr(S?.inventory?.slots).findIndex(x => x?.kind === k);
const hold = (S, k, what) => { const i = slotOf(S, k); return i < 0 ? null : i === S.selectedIndex ? '' : i >= 10 ? `[Tab], drag ${what} to the hotbar, then ` : `Press [${(i + 1) % 10}] to hold ${what}, then `; };
const use = (S, k, what, rest, fallback) => { const h = hold(S, k, what); return h === null ? fallback : h ? h + rest : rest[0].toUpperCase() + rest.slice(1); };
const LOOK = 1.4, WALK = 4; // rad of yaw sweep (~80°), metres walked

export const CHAPTERS = [{id:'ch1', title:'First Ten Minutes'}, {id:'ch2', title:'Make Yourself at Home'}, {id:'ch3', title:'A Home on the Water'}];
export const STEPS = [
  {chapter:'ch1', id:'look', title:'Look out to sea', hint:'Move the [Mouse] to look around', done:(S, b, c) => c.yawTravel >= LOOK || played(S, c),
    count:(S, b, c) => [Math.round(c.yawTravel * 180 / Math.PI), Math.round(LOOK * 180 / Math.PI), '°']},
  {chapter:'ch1', id:'walk', title:'Stretch your legs', hint:'[W][A][S][D] to walk, [Space] hops', done:(S, b, c) => c.walked >= WALK || played(S, c),
    count:(S, b, c) => [Math.floor(c.walked), WALK, ' m']},
  {chapter:'ch1', id:'throw', title:'Toss your hook', hint:'Hold [LMB] to wind up, let go. Aim above far debris, it arcs', done:(S, b, c) => ['flying', 'floating', 'reeling'].includes(S.hookStage) || played(S, c)},
  {chapter:'ch1', id:'reel', title:'Reel in a treasure', hint:'Hold [LMB] while the hook floats', needs:['throw'],
    done:(S, b, c) => (c.hostWorld ? MATS.some(k => c.gained(k) > 0) : num(S.collected) - num(b.collected) >= 1)},
  {chapter:'ch1', ...gainStep('wood', 'Gather 6 planks', 'Planks and barrels give planks', 'wood', 6, ['reel'], hasHammer)},
  {chapter:'ch1', ...gainStep('leaves', 'Gather 4 palm leaves', 'Leafy bundles drift by now and then', 'leaf', 4, ['reel'], hasHammer)},
  {chapter:'ch1', id:'bag', title:'Peek in your bag', hint:'[Tab] opens your bag', needs:['reel'], done:S => S.inventoryOpen === true},
  {chapter:'ch1', ...gainStep('rope', 'Twist 2 rope', 'In your bag: Rope, 2 leaves each', 'rope', 2, ['bag', 'leaves'], hasHammer)},
  {chapter:'ch1', id:'swim', title:'Climb back aboard', hint:'Fell in? Hold [Space] at the edge to climb up', optional:true, every:true, show:S => S.swimming === true,
    done:(S, b, c) => { if (S.swimming) c.mem.wet = true; return !!c.mem.wet && !S.swimming && !!S.grounded; }},
  {chapter:'ch1', id:'hammer', title:'Make a hammer', hint:'Bag: 4 plank + 2 rope', needs:['rope', 'wood'], done:S => owns(S, 'hammer')},
  {chapter:'ch1', ...gainStep('plastic', 'Fish out 2 plastic', 'Hook the bobbing jugs', 'plastic', 2, ['hammer'])},
  {chapter:'ch1', id:'floor', title:'Build a floor tile', hint:S => '2 plank + 2 plastic. ' + use(S, 'hammer', 'your hammer', '[LMB] beside the raft', 'Hammer in hand, [LMB] beside the raft'), needs:['hammer'], done:(S, b) => num(S.tiles) - num(b.tiles) >= 1},
  {chapter:'ch2', id:'grow3', title:'Grow your raft by 3', hint:'Each tile: 2 plank + 2 plastic', count:(S, b) => [num(S.tiles) - num(b.tiles), 3]},
  {chapter:'ch2', id:'grab', title:'Grab one by hand', hint:'Wait for debris to drift close, then [E]',
    done:(S, b, c) => handGrab(S, c)},
  {chapter:'ch2', id:'barrel', title:'Hook a barrel', hint:'Barrels hold a bit of everything', done:(S, b, c) => arr(S.hookCaughtItems).some(i => i?.type === 'barrel') || handGrab(S, c, 'barrel')},
  {chapter:'ch2', id:'palm-craft', title:'Make a palm planter', hint:'Bag: 2 plank + 3 leaves', done:(S, b, c) => c.gained('palm') >= 1 || placedNow(S, b, c, 'palm')},
  {chapter:'ch2', id:'plant', title:'Plant your first palm', hint:S => use(S, 'palm', 'the planter', '[LMB] on the raft', 'Hold it, [LMB] on the raft'), done:(S, b, c) => placedNow(S, b, c, 'palm')},
  {chapter:'ch2', id:'lantern', title:'Hang a lantern', hint:S => use(S, 'lantern', 'the lantern', '[LMB] on the raft', 'Bag: 2 plank + 2 scrap, then place it'), done:(S, b, c) => placedNow(S, b, c, 'lantern')},
  {chapter:'ch2', id:'repair', title:'Mend your hook', hint:'[R] repairs: 2 plank + 1 scrap', optional:true, show:S => owns(S, 'hook') && Number.isFinite(S.hookHealth) && S.hookHealth <= 50,
    done:(S, b, c) => { if (num(S.hookHealth) < 100 && Number.isFinite(S.hookHealth)) c.mem.low = true; return !!c.mem.low && S.hookHealth === 100; }},
  // The rod (6 planks + 8 rope) comes after a short plank top-up; rope already twisted (or spent on the rod) counts.
  {chapter:'ch3', ...gainStep('rodwood', 'Gather 6 planks', 'For the rod. A bench is 3 planks', 'wood', 6, [], hasRod)},
  {chapter:'ch3', id:'rope8', title:'Twist 8 rope', hint:'16 leaves. Barrels give leaves too',
    count:(S, b, c) => [most(c, hasRod(S) ? 8 : inv(S, 'rope')), 8]},
  {chapter:'ch3', id:'rod', title:'Make a fishing rod', hint:'Bag: 6 plank + 8 rope', needs:['rodwood', 'rope8'], done:hasRod},
  {chapter:'ch3', id:'fish1', title:'Catch a fish', hint:S => use(S, 'fishingrod', 'the rod', '[LMB] at the water', 'Rod in hand, [LMB] at the water'), needs:['rod'],
    done:(S, b, c) => fishSince(S, b, c) >= 1},
  {chapter:'ch3', id:'fish3', title:'Catch two more', hint:'Cast and wait, the fish comes to you', needs:['fish1'],
    count:(S, b, c) => [fishSince(S, b, c) - (c.silent ? 1 : 0), 2]},
  {chapter:'ch3', id:'sail', title:'Raise a sail', hint:'Bag: 10 wood, 20 leaves, 3 scrap', needs:['rod'], done:(S, b, c) => placedNow(S, b, c, 'sail')},
  {chapter:'ch3', id:'seat', title:'Build a bench', hint:'Somewhere to watch the waves', done:(S, b, c) => placedNow(S, b, c, 'bench')},
  {chapter:'ch3', id:'crate', title:'Make a storage crate', hint:S => use(S, 'crate', 'the crate', '[LMB] on the raft', 'Bag: 4 plank + 1 scrap, then place it'), done:(S, b, c) => placedNow(S, b, c, 'crate')},
  {chapter:'ch3', id:'home', title:'Reach 16 tiles', hint:'A proper little home', count:S => [num(S.tiles), 16], done:(S, b, c) => !c.hostWorld && num(S.tiles) >= 16},
];

// ---------- pure logic (node-testable) ----------
export function insertSteps(steps, chapters, {chapter, title, after, steps:add} = {}) {
  if (!chapter || !Array.isArray(add)) throw new TypeError('register needs {chapter, steps:[]}');
  if (!chapters.some(c => c.id === chapter)) chapters.push({id:chapter, title:String(title || chapter)});
  const ids = new Set(steps.map(s => s.id));
  for (const s of add) {
    if (!s || typeof s.id !== 'string' || typeof s.title !== 'string') throw new TypeError('step needs id and title');
    if (ids.has(s.id)) throw new Error('duplicate onboarding step id: ' + s.id);
    ids.add(s.id);
  }
  let at = after ? steps.findIndex(s => s.id === after) : -1;
  if (at < 0) { at = -1; steps.forEach((s, i) => { if (s.chapter === chapter) at = i; }); if (at < 0) at = steps.length - 1; }
  steps.splice(at + 1, 0, ...add.map(s => ({...s, chapter})));
  return steps;
}
function decorCounts(S) {
  const out = {}, list = arr(S.decor);
  for (let i = 0; i < list.length; i++) { const t = list[i]?.type; if (typeof t === 'string') out[t] = (out[t] ?? 0) + 1; }
  return out;
}
const snap = S => ({tiles:num(S.tiles), fish:num(S.fish), collected:num(S.collected), hookHealth:num(S.hookHealth), decor:decorCounts(S),
  stock:{...(S.stock && typeof S.stock === 'object' ? S.stock : {})}, me:S.me ? {x:num(S.me.x), z:num(S.me.z), yaw:num(S.me.yaw)} : null});
function ctxFor(rec, S, prev, silent) {
  const base = rec?.base ?? FRESH;
  return {S0:base, prev, silent, hostWorld:hostWorld(S), mem:rec?.mem ?? {}, yawTravel:silent ? 0 : rec?.yaw ?? 0, walked:silent ? 0 : rec?.walk ?? 0,
    gained:k => (silent ? inv(S, k) : num(rec?.gained[k]))};
}
function check(step, S, base, ctx) {
  try {
    const c = step.count?.(S, base, ctx);
    return step.done ? !!step.done(S, base, ctx) : Array.isArray(c) && num(c[0]) >= num(c[1]);
  } catch { return false; }
}
export function countOf(step, S, rec, prev) {
  try { const c = step.count?.(S, rec?.base ?? FRESH, ctxFor(rec, S, prev, false)); return c ? [Math.max(0, Math.min(num(c[0]), num(c[1]))), num(c[1]), ...(typeof c[2] === 'string' ? [c[2]] : [])] : null; } catch { return null; }
}
export const hintOf = (step, S) => { try { return String((typeof step.hint === 'function' ? step.hint(S ?? {}) : step.hint) ?? ''); } catch { return ''; } };
const chapterOrder = steps => [...new Set(steps.map(s => s.chapter))];
export function currentChapter(steps, done) {
  return chapterOrder(steps).find(ch => steps.some(s => s.chapter === ch && !s.optional && !done[s.id])) ?? null;
}
export function visibleSteps(steps, P, S) {
  const ch = currentChapter(steps, P.done), ids = new Set(steps.map(s => s.id));
  const gate = s => { try { return !s.show || P.track[s.id] || s.show(S); } catch { return false; } };
  const open = steps.filter(s => (s.chapter === ch || s.every) && !P.done[s.id] && arr(s.needs).every(n => P.done[n] || !ids.has(n)) && gate(s));
  return [...open.filter(s => s.show), ...open.filter(s => !s.show)].slice(0, MAX_ROWS); // gated (urgent) steps first
}
export const createProgress = (done = []) => ({done:Object.fromEntries(arr(done).filter(x => typeof x === 'string').map(id => [id, true])), track:{}, prev:null});

// One poll. Mutates P; returns {newly, silentDone, visible, chapter, counts, reset}. silent: returning-player pass vs fresh defaults.
export function evaluate(steps, P, rawS, {silent = false} = {}) {
  const S = rawS && typeof rawS === 'object' ? rawS : {}, prev = P.prev, newly = [], silentDone = [];
  P.done ??= {}; P.track ??= {};
  let reset = false, swapped = false;
  // World swapped (joined/left a host's world, or the counter went backwards): re-baseline and judge nothing this poll,
  // otherwise the jump in tiles/fish/collected/bag between the two worlds reads as progress.
  if (prev && (num(S.collected) < num(prev.collected) || !!prev.hostWorld !== hostWorld(S))) {
    P.track = {}; swapped = true;
    if (!prev.hostWorld && S.role === 'solo' && prev.role === 'solo' && num(S.tiles) <= 9 && !num(S.fish)) { P.done = {}; reset = true; }
  }
  if (silent) {
    const byId = new Map(steps.map(s => [s.id, s])), mark = id => { if (!P.done[id] && byId.has(id)) { P.done[id] = true; silentDone.push(id); arr(byId.get(id).needs).forEach(mark); } };
    for (const s of steps) if (check(s, S, FRESH, ctxFor(null, S, null, true))) mark(s.id);
  }
  const vis = visibleSteps(steps, P, S), keep = {}, now = snap(S); // one snapshot per poll, shared read-only by every step
  for (const s of swapped ? [] : vis) {
    const rec = P.track[s.id] ?? track(s, S, now);
    for (const k in now.stock) { const d = inv(now, k) - inv(rec.last, k); if (d > 0) rec.gained[k] = num(rec.gained[k]) + d; }
    if (now.me && rec.last.me) {
      rec.yaw += Math.abs(wrapPi(now.me.yaw - rec.last.me.yaw));
      const d = Math.hypot(now.me.x - rec.last.me.x, now.me.z - rec.last.me.z); if (d < 3) rec.walk += d; // >3 m in 250 ms: a teleport
    }
    rec.last = now; keep[s.id] = rec;
    if (check(s, S, rec.base, ctxFor(rec, S, prev, false))) { P.done[s.id] = true; newly.push(s.id); }
  }
  P.track = keep; P.prev = snapPrev(S, now);
  const after = visibleSteps(steps, P, S), counts = {}, hints = {};
  for (const s of after) { P.track[s.id] ??= track(s, S, now); counts[s.id] = countOf(s, S, P.track[s.id], P.prev); hints[s.id] = hintOf(s, S); }
  return {newly, silentDone, visible:after.map(s => s.id), chapter:currentChapter(steps, P.done), counts, hints, reset};
}
function track(s, S, now = snap(S)) { let base; try { base = s.start ? s.start(S) : null; } catch {} return {base:base ?? now, gained:{}, yaw:0, walk:0, mem:{}, last:now}; }
const snapPrev = (S, now = snap(S)) => ({...now, role:S.role, hostWorld:hostWorld(S), pickup:S.pickup ?? null, hookStage:S.hookStage});

export function saveSummary(raw) {
  try {
    const v = JSON.parse(raw), parts = [];
    if (Array.isArray(v?.tiles)) parts.push(`${v.tiles.length} tile${v.tiles.length === 1 ? '' : 's'}`);
    if (Number.isFinite(v?.fish)) parts.push(`${v.fish} fish`);
    return parts.join(' · ');
  } catch { return ''; }
}
export const hintHTML = s => String(s ?? '').replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`).replace(/\[([^\]]{1,8})\]/g, (m, k) => /^[LR]MB$/.test(k)
  ? `<kbd class="ob-key ob-mouse" aria-label="${k === 'LMB' ? 'left' : 'right'} mouse button"><svg viewBox="0 0 12 16" width="10" height="14" aria-hidden="true"><rect x=".6" y=".6" width="10.8" height="14.8" rx="5.4" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="${k === 'LMB' ? 'M6 .6A5.4 5.4 0 0 0 .6 6v1.2H6z' : 'M6 .6A5.4 5.4 0 0 1 11.4 6v1.2H6z'}" fill="#e9a640"/></svg></kbd>`
  : `<kbd class="ob-key">${k}</kbd>`);

// ---------- browser runtime ----------
// Touching window.localStorage itself can throw (blocked site data), so resolve it inside the try.
const area = session => (session ? window.sessionStorage : window.localStorage);
const store = {
  get(k, session) { try { return area(session).getItem(k); } catch { return null; } },
  set(k, v, session) { try { area(session).setItem(k, v); } catch {} },
  del(k, session) { try { area(session).removeItem(k); } catch {} },
};

function boot() {
  const $ = s => document.querySelector(s), chName = id => CHAPTERS.find(c => c.id === id)?.title ?? id;
  const titleOf = id => STEPS.find(s => s.id === id)?.title ?? id;
  let saved = {}; try { saved = JSON.parse(store.get(KEY)) || {}; } catch {}
  let P = createProgress(saved.done), collapsed = !!saved.collapsed, logOpen = false, wiping = false;
  let booted = false, silentRan = false, shownCh, holdUntil = 0, lastProgress = Date.now(), lastS = null;
  const persist = () => { if (!wiping) store.set(KEY, JSON.stringify({v:1, done:Object.keys(P.done), collapsed})); };
  const reduced = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ----- tracker -----
  const panel = document.createElement('aside');
  panel.id = 'obNotes'; panel.className = 'ob-notes'; panel.setAttribute('aria-label', 'Notes');
  panel.innerHTML = '<button type="button" class="ob-head" aria-expanded="true"><span class="ob-ch"></span><span class="ob-sum"></span><i class="ob-chev" aria-hidden="true"></i></button><ol class="ob-rows" aria-live="polite"></ol><div class="ob-log" hidden></div>';
  document.body.append(panel);
  // The bag opens modally in the top layer and would cover the Notes. A manual popover lives in the top layer too;
  // re-showing it after the bag opens stacks it above (other dialogs - pause, journal, logbook - stay on top of it). No popover support: stays a plain fixed panel.
  const lift = () => { try { if (panel.matches(':popover-open')) panel.hidePopover(); panel.showPopover(); } catch {} };
  if (typeof panel.showPopover === 'function') {
    panel.popover = 'manual'; lift();
    if (panel.matches?.(':popover-open')) {
      try { new MutationObserver(ms => { if (ms.some(m => m.target.id === 'inventory' && m.target.open)) { panel.style.animation = 'none'; lift(); } }) // no fade replay
        .observe(document.documentElement, {subtree:true, attributes:true, attributeFilter:['open']}); } catch {}
    }
  }
  const head = panel.querySelector('.ob-head'), rowsEl = panel.querySelector('.ob-rows'), logEl = panel.querySelector('.ob-log');
  const rows = new Map(); // id -> li
  function rowFor(id, animate) {
    const s = STEPS.find(x => x.id === id), li = document.createElement('li');
    li.className = 'ob-row' + (animate && !reduced() ? ' ob-in' : ''); li.dataset.id = id;
    li.innerHTML = `<i class="ob-box" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.4 5 8.8 9.6 3.4"/></svg></i><div class="ob-text"><b class="ob-title">${hintHTML(s.title)}</b><span class="ob-hint"></span></div><em class="ob-count"></em>`;
    const idx = STEPS.indexOf(s), before = [...rowsEl.children].find(r => STEPS.findIndex(x => x.id === r.dataset.id) > idx);
    rowsEl.insertBefore(li, before ?? null); rows.set(id, li);
    if (animate) setTimeout(() => li.classList.remove('ob-in'), 260);
    return li;
  }
  function tickRow(id) {
    const li = rows.get(id); if (!li || li.classList.contains('ob-done')) return;
    li.classList.add('ob-done'); li.setAttribute('aria-label', `Done: ${titleOf(id)}`);
    const t = reduced() ? 300 : 700;
    setTimeout(() => li.classList.add('ob-out'), t);
    setTimeout(() => { if (rows.get(id) === li) rows.delete(id); li.remove(); }, t + 220);
  }
  function chime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ac = chime.ac ??= new AC(), o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + .12);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.05, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .35);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + .4);
    } catch {}
  }
  const feed = t => { try { window.raftPrompts?.feed?.(t); } catch {} };
  // The tick re-renders 4x/s: write only values that changed (every write is a DOM mutation plus style work).
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  let logHTML = '';
  function renderHead(ch) {
    const all = ch === null, list = STEPS.filter(s => s.chapter === ch && !s.optional);
    panel.classList.toggle('ob-all', all);
    setText(head.querySelector('.ob-ch'), all ? 'Notes' : collapsed ? 'Notes' : chName(ch));
    setText(head.querySelector('.ob-sum'), all ? '' : `${collapsed ? '· ' : ''}${list.filter(s => P.done[s.id]).length}/${list.length}`);
    const open = String(all ? logOpen : !collapsed), hide = !(all && logOpen);
    panel.classList.toggle('ob-collapsed', !all && collapsed); panel.classList.toggle('ob-logopen', all && logOpen);
    if (head.getAttribute('aria-expanded') !== open) head.setAttribute('aria-expanded', open);
    if (logEl.hidden !== hide) logEl.hidden = hide;
    if (hide) logHTML = '';
    else {
      const html = [...new Set(STEPS.map(s => s.chapter))].map(c => `<section><h3>${hintHTML(chName(c))}</h3><ul>${STEPS.filter(s => s.chapter === c && (!s.optional || P.done[s.id])).map(s => `<li class="${P.done[s.id] ? 'ob-tick' : ''}">${hintHTML(s.title)}</li>`).join('')}</ul></section>`).join('');
      if (html !== logHTML) logEl.innerHTML = logHTML = html;
    }
  }
  function toggle() {
    if (panel.classList.contains('ob-all')) logOpen = !logOpen; else collapsed = !collapsed;
    lastProgress = Date.now(); panel.classList.remove('ob-dim'); persist(); renderHead(shownCh ?? null);
  }
  head.addEventListener('click', toggle);
  head.addEventListener('mousedown', e => e.preventDefault()); // never keep focus: Space (hop) / Enter would re-toggle it
  window.addEventListener('keydown', e => {
    if (e.code !== 'KeyN' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !document.body.classList.contains('playing')) return;
    if (e.target?.closest?.('input, textarea, select, [contenteditable]') || $('dialog[open]')) return;
    toggle();
  });

  function sync(r) {
    const now = Date.now(), animate = booted;
    if (r.reset) { rows.forEach(li => li.remove()); rows.clear(); shownCh = undefined; }
    if (r.chapter !== shownCh && shownCh !== undefined && animate && now >= holdUntil && !holdUntil) {
      if (shownCh) { feed(`Chapter ${CHAPTERS.findIndex(c => c.id === shownCh) + 1} complete: ${chName(shownCh)}`); panel.classList.add('ob-shimmer'); }
      holdUntil = now + (reduced() ? 600 : HOLD_MS);
    }
    if (now < holdUntil) return;
    if (holdUntil) { holdUntil = 0; panel.classList.remove('ob-shimmer'); }
    shownCh = r.chapter;
    const vis = new Set(r.visible);
    for (const [id, li] of rows) if (!vis.has(id) && !li.classList.contains('ob-done')) { li.remove(); rows.delete(id); }
    for (const id of r.visible) {
      const li = rows.get(id) ?? rowFor(id, animate), c = r.counts[id], h = r.hints[id] ?? '';
      setText(li.querySelector('.ob-count'), c ? `${c[0]}/${c[1]}${c[2] ?? ''}` : '');
      if (li.dataset.hint !== h) { li.dataset.hint = h; li.querySelector('.ob-hint').innerHTML = hintHTML(h); }
    }
    renderHead(shownCh);
  }
  function tick() {
    let S = null; try { const d = window.raftDebug; S = d?.hud ?? d?.state; } catch {} // hud: live view without .state's deep copies
    const playing = !!S?.running;
    if (!playing) return;
    lastS = S;
    const silent = !silentRan && !hostWorld(S), r = evaluate(STEPS, P, S, {silent}); // returning-player pass judges our own world only
    if (silent) silentRan = true;
    for (const id of r.newly) { tickRow(id); feed(`✓ ${titleOf(id)}`); }
    if (r.newly.length) { chime(); lastProgress = Date.now(); }
    if (r.newly.length || r.silentDone.length || r.reset) persist();
    if (r.reset) collapsed = false;
    sync(r); booted = true;
    panel.classList.toggle('ob-dim', Date.now() - lastProgress > DIM_MS && !panel.classList.contains('ob-all'));
    placeBag(!!S.inventoryOpen);
  }
  // Placement reads layout (forced sync reflow), so it runs once per bag open and again only when the window, the
  // Notes or the bag change size (ResizeObserver / resize mark it dirty), not on every tick.
  let placedOpen = null, placeDirty = true, bagEl = null;
  const markPlace = () => { placeDirty = true; };
  const sizeObs = typeof ResizeObserver === 'function' ? new ResizeObserver(markPlace) : null;
  sizeObs?.observe(panel); window.addEventListener('resize', markPlace);
  function placeBag(open) {
    if (open) {
      const el = $('#inventory .sv-wrap');
      if (el !== bagEl) { if (bagEl) sizeObs?.unobserve(bagEl); bagEl = el; if (el) sizeObs?.observe(el); placeDirty = true; }
      if (!sizeObs) placeDirty = true; // no observer: measure every tick as before
    }
    if (open === placedOpen && (!placeDirty || !open)) return;
    placedOpen = open; placeDirty = false;
    placeBesideBag(open && bagEl?.getBoundingClientRect());
  }
  // Bag open: if the Notes overlap it, move them (narrowed, >= ASIDE_MIN px) into the wider gutter beside the bag;
  // no gutter that wide (phones, small windows) -> .ob-covered hides them rather than peeking out over the bag.
  function placeBesideBag(bag) {
    const st = panel.style; let tx = 0, aside = false, covered = false;
    st.removeProperty('max-width'); // max-width is not transitioned, so the natural box is measurable right away
    if (bag && bag.width) {
      const r = parseFloat(getComputedStyle(panel).right) || 0, w = panel.offsetWidth, right = innerWidth - r, left = right - w;
      const top = panel.offsetTop, bottom = top + panel.offsetHeight;
      if (right > bag.left && left < bag.right && top < bag.bottom && bottom > bag.top) {
        const gapR = innerWidth - bag.right - 2 * GUTTER, gapL = bag.left - 2 * GUTTER, gap = Math.max(gapR, gapL);
        if (gap >= ASIDE_MIN) {
          const nw = Math.min(w, gap); st.maxWidth = `${nw}px`; aside = true;
          tx = gapR >= gapL ? (innerWidth - GUTTER) - right : GUTTER + nw - right; // translate the right edge into place
        } else covered = true;
      }
    }
    st.setProperty('--ob-shift', `${Math.round(tx)}px`);
    panel.classList.toggle('ob-aside', aside); panel.classList.toggle('ob-covered', covered);
  }
  setInterval(tick, POLL_MS);

  // ----- title screen -----
  const welcome = $('#welcome'), card = welcome?.querySelector('.welcome-card');
  if (welcome && card) {
    const raw = store.get(SAVE_KEY), auto = store.get(AUTOSTART, true) === '1';
    if (auto) store.del(AUTOSTART, true);
    const logo = document.createElement('div');
    logo.className = 'ob-logo';
    logo.innerHTML = '<h2 class="ob-logo-name"><svg class="ob-sail" viewBox="0 0 48 48" aria-hidden="true"><use href="icons.svg#icon-sail"></use></svg>Little Raft</h2><p class="ob-tag">A little ocean. A big adventure.</p>';
    const menu = document.createElement('nav');
    menu.className = 'ob-menu'; menu.setAttribute('aria-label', 'Main menu');
    const sub = raw != null ? saveSummary(raw) : '';
    menu.innerHTML = `${raw != null ? `<button type="button" class="ob-item" data-act="continue">Continue${sub ? `<small>${hintHTML(sub)}</small>` : ''}</button>` : ''}
      <button type="button" class="ob-item" data-act="new">${auto && raw == null ? 'Set sail' : 'New Game'}</button>
      <button type="button" class="ob-item" data-act="crew">Play together</button>
      ${$('#welcomeLook') ? '<button type="button" class="ob-item" data-act="look">Change look</button>' : ''}
      <button type="button" class="ob-item" data-act="settings">Settings</button>
      <small class="ob-savenote">Saves automatically in this browser</small>`;
    welcome.prepend(logo); card.prepend(menu); welcome.classList.add('ob-on'); document.body.classList.add('ob-title-ready');
    const items = () => [...menu.querySelectorAll('.ob-item')];
    const solo = () => $('#solo');
    const newBtn = menu.querySelector('[data-act="new"]'), newLabel = newBtn.textContent;
    let armed = 0;
    const disarm = () => { clearTimeout(armed); armed = 0; newBtn.textContent = newLabel; newBtn.classList.remove('ob-confirm'); };
    function wipe() {
      wiping = true;
      const clear = () => { store.del(SAVE_KEY); store.del(KEY); };
      clear(); addEventListener('beforeunload', clear); addEventListener('pagehide', clear); // game.js saves on beforeunload; run after it
      store.set(AUTOSTART, '1', true); location.reload();
    }
    menu.addEventListener('click', e => {
      const b = e.target.closest('.ob-item'); if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'continue') solo()?.click(); // synchronous: keeps the gesture for pointer lock
      else if (act === 'new') {
        if (store.get(SAVE_KEY) == null) { disarm(); P = createProgress(); persist(); solo()?.click(); }
        else if (armed) { disarm(); wipe(); }
        else { newBtn.textContent = 'Start over? Click again'; newBtn.classList.add('ob-confirm'); armed = setTimeout(disarm, 4000); }
      } else if (act === 'crew') $('#welcomeCrew')?.click();
      else if (act === 'look') $('#welcomeLook')?.click(); // [look] docs/specs/customise.md
      else if (act === 'settings') $('#helpButton')?.click();
    });
    menu.addEventListener('keydown', e => {
      const list = items().filter(b => !b.disabled), i = list.indexOf(document.activeElement);
      if (e.key === 'Escape' && armed) { disarm(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault(); list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    });
    newBtn.addEventListener('blur', () => { if (armed) setTimeout(() => { if (document.activeElement !== newBtn) disarm(); }, 0); });
    const addContinue = () => { // a game started in this page (then quit to title) saves after boot: offer Continue, never only New Game
      if (menu.querySelector('[data-act="continue"]')) return;
      const saved = store.get(SAVE_KEY); if (saved == null) return;
      const s = saveSummary(saved);
      menu.insertAdjacentHTML('afterbegin', `<button type="button" class="ob-item" data-act="continue">Continue${s ? `<small>${hintHTML(s)}</small>` : ''}</button>`);
      try { items()[0].focus({preventScroll:true}); } catch {} // Enter resumes, it never starts over
    };
    const syncDisabled = () => { addContinue(); const off = !!solo()?.disabled; for (const b of items()) if (b.dataset.act === 'continue' || b.dataset.act === 'new') b.disabled = off; };
    setInterval(syncDisabled, 500); syncDisabled();
    try { (items()[0])?.focus({preventScroll:true}); } catch {}
  }
  return {
    reset() { P = createProgress(); booted = false; silentRan = false; rows.forEach(li => li.remove()); rows.clear(); shownCh = undefined; holdUntil = 0; persist(); },
    complete(id) { if (!STEPS.some(s => s.id === id) || P.done[id]) return false; P.done[id] = true; tickRow(id); feed(`✓ ${titleOf(id)}`); persist(); lastProgress = Date.now(); return true; },
    state: () => ({done:Object.keys(P.done), visible:lastS ? visibleSteps(STEPS, P, lastS).map(s => s.id) : [], chapter:currentChapter(STEPS, P.done), collapsed, steps:STEPS.length}),
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.raftOnboarding) {
  let rt = null;
  window.raftOnboarding = {
    register: opts => { insertSteps(STEPS, CHAPTERS, opts); return true; },
    complete: id => rt?.complete(id) ?? false,
    reset: () => rt?.reset(),
    state: () => rt?.state() ?? null,
  };
  const go = () => { try { rt = boot(); } catch (e) { console.error('onboarding', e); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, {once:true}); else go();
}
