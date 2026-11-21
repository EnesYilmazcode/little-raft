// Little Raft onboarding: top-right "Notes" objective tracker + left-aligned title menu. No centred text, ever.
// API (window.raftOnboarding): register({chapter, title?, after?, steps}), complete(id), reset(), state().
// Step: {id, title, hint, done(S, base, ctx) -> bool, count?(S, base, ctx) -> [n, of], start?(S) -> base, needs?:[ids],
//        optional?:bool (never blocks its chapter), show?(S) -> bool (visibility gate)}.
// ctx = {S0, gained(k), yawTravel, walked, prev, mem, silent}. Completion reads only window.raftDebug.state (polled 250 ms).
export const SAVE_KEY = 'little-raft-v1', KEY = 'little-raft-onboarding-v1', AUTOSTART = 'little-raft-autostart';
const POLL_MS = 250, MAX_ROWS = 3, DIM_MS = 20000, HOLD_MS = 2000;

const num = v => (Number.isFinite(v) ? v : 0);
const arr = v => (Array.isArray(v) ? v : []);
const inv = (S, k) => num(S?.stock?.[k]);
const owns = (S, k) => arr(S.ownedTools).includes(k);
const placed = (S, t) => arr(S.decor).some(d => d?.type === t);
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));
const FRESH = Object.freeze({tiles:9, fish:0, collected:0, stock:{}, me:null, hookHealth:100});
const played = (S, c) => c.silent && num(S.collected) > 0; // returning players skip the very first lessons
const gainStep = (id, title, hint, k, n, needs) => ({id, title, hint, needs, count:(S, b, c) => [c.gained(k), n]});

export const CHAPTERS = [{id:'ch1', title:'First Ten Minutes'}, {id:'ch2', title:'Make Yourself at Home'}, {id:'ch3', title:'A Home on the Water'}];
export const STEPS = [
  {chapter:'ch1', id:'look', title:'Look out to sea', hint:'Move the [Mouse] to look around', done:(S, b, c) => c.yawTravel >= 1.6 || played(S, c)},
  {chapter:'ch1', id:'walk', title:'Stretch your legs', hint:'[W][A][S][D] to walk, [Space] hops', done:(S, b, c) => c.walked >= 1.5 || played(S, c)},
  {chapter:'ch1', id:'throw', title:'Toss your hook', hint:'Hold [LMB] to wind up, let go to throw', done:(S, b, c) => ['flying', 'floating', 'reeling'].includes(S.hookStage) || played(S, c)},
  {chapter:'ch1', id:'reel', title:'Reel in a treasure', hint:'Hold [LMB] while the hook floats', needs:['throw'], done:(S, b) => num(S.collected) - num(b.collected) >= 1},
  {chapter:'ch1', ...gainStep('wood', 'Gather 6 wood', 'Planks and barrels give wood', 'wood', 6, ['reel'])},
  {chapter:'ch1', ...gainStep('leaves', 'Gather 4 palm leaves', 'Leafy bundles drift by now and then', 'leaf', 4, ['reel'])},
  {chapter:'ch1', id:'bag', title:'Peek in your bag', hint:'[Tab] opens your bag', needs:['reel'], done:S => S.inventoryOpen === true},
  {chapter:'ch1', ...gainStep('rope', 'Twist 2 rope', 'In your bag: Rope, 2 leaves each', 'rope', 2, ['bag', 'leaves'])},
  {chapter:'ch1', id:'hammer', title:'Make a hammer', hint:'Bag: 4 wood + 2 rope', needs:['rope', 'wood'], done:S => owns(S, 'hammer')},
  {chapter:'ch1', ...gainStep('plastic', 'Fish out 2 plastic', 'Hook the bobbing jugs', 'plastic', 2, ['hammer'])},
  {chapter:'ch1', id:'floor', title:'Add a floor tile', hint:'Hammer [1]–[8], aim beside the raft, [LMB]', needs:['hammer'], done:(S, b) => num(S.tiles) - num(b.tiles) >= 1},
  {chapter:'ch2', id:'grow3', title:'Grow your raft by 3', hint:'Each tile: 2 wood + 2 plastic', count:(S, b) => [num(S.tiles) - num(b.tiles), 3]},
  {chapter:'ch2', id:'grab', title:'Grab one by hand', hint:'Walk close, [E] picks it up',
    done:(S, b, c) => !!(c.prev?.pickup && c.prev.hookStage === 'idle' && num(S.collected) > num(c.prev.collected))},
  {chapter:'ch2', id:'barrel', title:'Hook a barrel', hint:'Barrels hold a bit of everything', done:(S, b, c) => arr(S.hookCaughtItems).some(i => i?.type === 'barrel')
    || (!!c.prev && [['wood', 3], ['leaf', 2], ['scrap', 1], ['plastic', 1]].every(([k, n]) => inv(S, k) - inv(c.prev, k) >= n))},
  {chapter:'ch2', id:'palm-craft', title:'Make a palm planter', hint:'Bag: 2 wood + 3 leaves', done:(S, b, c) => c.gained('palm') >= 1 || placed(S, 'palm')},
  {chapter:'ch2', id:'plant', title:'Plant your first palm', hint:'Hold it, aim at the deck, [LMB]', done:S => placed(S, 'palm')},
  {chapter:'ch2', id:'lantern', title:'Hang a lantern', hint:'Bag: 2 wood + 2 scrap, then place it', done:S => placed(S, 'lantern')},
  {chapter:'ch2', id:'repair', title:'Mend your hook', hint:'[R] repairs: 2 wood + 1 scrap', optional:true, show:S => Number.isFinite(S.hookHealth) && S.hookHealth <= 50,
    done:(S, b, c) => { if (num(S.hookHealth) < 100 && Number.isFinite(S.hookHealth)) c.mem.low = true; return !!c.mem.low && S.hookHealth === 100; }},
  {chapter:'ch3', id:'rope8', title:'Stock up on rope', hint:'A rod needs 8 rope (16 leaves)', done:S => inv(S, 'rope') >= 8 || owns(S, 'fishingrod'), count:S => [inv(S, 'rope'), 8]},
  {chapter:'ch3', id:'rod', title:'Make a fishing rod', hint:'Bag: 6 wood + 8 rope', done:S => owns(S, 'fishingrod')},
  {chapter:'ch3', id:'fish1', title:'Catch a fish', hint:'Rod in hand, aim at water, [LMB]', done:(S, b) => num(S.fish) - num(b.fish) >= 1},
  {chapter:'ch3', id:'fish3', title:'Catch two more', hint:'Patience. Watch the bobber dip', needs:['fish1'],
    count:(S, b, c) => [num(S.fish) - num(b.fish) - (c.silent ? 1 : 0), 2]},
  {chapter:'ch3', id:'sail', title:'Raise a sail', hint:'Bag: 4 wood, 3 rope, 3 leaves', done:S => placed(S, 'sail')},
  {chapter:'ch3', id:'seat', title:'Build a bench', hint:'Somewhere to watch the waves', done:S => placed(S, 'bench')},
  {chapter:'ch3', id:'crate', title:'Make a storage crate', hint:'Bag: 4 wood + 1 scrap', done:S => placed(S, 'crate')},
  {chapter:'ch3', id:'home', title:'Reach 16 tiles', hint:'A proper little home', count:S => [num(S.tiles), 16]},
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
const snap = S => ({tiles:num(S.tiles), fish:num(S.fish), collected:num(S.collected), hookHealth:num(S.hookHealth),
  stock:{...(S.stock && typeof S.stock === 'object' ? S.stock : {})}, me:S.me ? {x:num(S.me.x), z:num(S.me.z), yaw:num(S.me.yaw)} : null});
function ctxFor(rec, S, prev, silent) {
  const base = rec?.base ?? FRESH, me = S.me && base.me ? Math.hypot(num(S.me.x) - base.me.x, num(S.me.z) - base.me.z) : 0;
  return {S0:base, prev, silent, mem:rec?.mem ?? {}, yawTravel:silent ? 0 : rec?.yaw ?? 0, walked:silent ? 0 : me,
    gained:k => (silent ? inv(S, k) : num(rec?.gained[k]))};
}
function check(step, S, base, ctx) {
  try {
    const c = step.count?.(S, base, ctx);
    return step.done ? !!step.done(S, base, ctx) : Array.isArray(c) && num(c[0]) >= num(c[1]);
  } catch { return false; }
}
export function countOf(step, S, rec, prev) {
  try { const c = step.count?.(S, rec?.base ?? FRESH, ctxFor(rec, S, prev, false)); return c ? [Math.max(0, Math.min(num(c[0]), num(c[1]))), num(c[1])] : null; } catch { return null; }
}
const chapterOrder = steps => [...new Set(steps.map(s => s.chapter))];
export function currentChapter(steps, done) {
  return chapterOrder(steps).find(ch => steps.some(s => s.chapter === ch && !s.optional && !done[s.id])) ?? null;
}
export function visibleSteps(steps, P, S) {
  const ch = currentChapter(steps, P.done), ids = new Set(steps.map(s => s.id));
  const gate = s => { try { return !s.show || P.track[s.id] || s.show(S); } catch { return false; } };
  const open = steps.filter(s => s.chapter === ch && !P.done[s.id] && arr(s.needs).every(n => P.done[n] || !ids.has(n)) && gate(s));
  return [...open.filter(s => s.show), ...open.filter(s => !s.show)].slice(0, MAX_ROWS); // gated (urgent) steps first
}
export const createProgress = (done = []) => ({done:Object.fromEntries(arr(done).filter(x => typeof x === 'string').map(id => [id, true])), track:{}, prev:null});

// One poll. Mutates P; returns {newly, silentDone, visible, chapter, counts, reset}. silent: returning-player pass vs fresh defaults.
export function evaluate(steps, P, rawS, {silent = false} = {}) {
  const S = rawS && typeof rawS === 'object' ? rawS : {}, prev = P.prev, newly = [], silentDone = [];
  P.done ??= {}; P.track ??= {};
  let reset = false;
  if (prev && num(S.collected) < num(prev.collected)) { // world swapped (left a host, or New Game): re-baseline
    P.track = {};
    if (S.role === 'solo' && prev.role === 'solo' && num(S.tiles) <= 9 && !num(S.fish)) { P.done = {}; reset = true; }
  }
  if (silent) {
    const byId = new Map(steps.map(s => [s.id, s])), mark = id => { if (!P.done[id] && byId.has(id)) { P.done[id] = true; silentDone.push(id); arr(byId.get(id).needs).forEach(mark); } };
    for (const s of steps) if (check(s, S, FRESH, ctxFor(null, S, null, true))) mark(s.id);
  }
  const vis = visibleSteps(steps, P, S), keep = {};
  for (const s of vis) {
    const rec = P.track[s.id] ?? track(s, S), now = snap(S);
    for (const k of Object.keys(now.stock)) { const d = inv(now, k) - inv(rec.last, k); if (d > 0) rec.gained[k] = num(rec.gained[k]) + d; }
    if (now.me && rec.last.me) rec.yaw += Math.abs(wrapPi(now.me.yaw - rec.last.me.yaw));
    rec.last = now; keep[s.id] = rec;
    if (check(s, S, rec.base, ctxFor(rec, S, prev, false))) { P.done[s.id] = true; newly.push(s.id); }
  }
  P.track = keep; P.prev = snapPrev(S);
  const after = visibleSteps(steps, P, S), counts = {};
  for (const s of after) { P.track[s.id] ??= track(s, S); counts[s.id] = countOf(s, S, P.track[s.id], P.prev); }
  return {newly, silentDone, visible:after.map(s => s.id), chapter:currentChapter(steps, P.done), counts, reset};
}
function track(s, S) { let base; try { base = s.start ? s.start(S) : null; } catch {} return {base:base ?? snap(S), gained:{}, yaw:0, mem:{}, last:snap(S)}; }
const snapPrev = S => ({...snap(S), role:S.role, pickup:S.pickup ?? null, hookStage:S.hookStage});

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
const store = {
  get(k, s = localStorage) { try { return s.getItem(k); } catch { return null; } },
  set(k, v, s = localStorage) { try { s.setItem(k, v); } catch {} },
  del(k, s = localStorage) { try { s.removeItem(k); } catch {} },
};

function boot() {
  const $ = s => document.querySelector(s), chName = id => CHAPTERS.find(c => c.id === id)?.title ?? id;
  const titleOf = id => STEPS.find(s => s.id === id)?.title ?? id;
  let saved = {}; try { saved = JSON.parse(store.get(KEY)) || {}; } catch {}
  let P = createProgress(saved.done), collapsed = !!saved.collapsed, logOpen = false, wiping = false;
  let booted = false, shownCh, holdUntil = 0, lastProgress = Date.now(), lastS = null;
  const persist = () => { if (!wiping) store.set(KEY, JSON.stringify({v:1, done:Object.keys(P.done), collapsed})); };
  const reduced = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ----- tracker -----
  const panel = document.createElement('aside');
  panel.id = 'obNotes'; panel.className = 'ob-notes'; panel.setAttribute('aria-label', 'Notes');
  panel.innerHTML = '<button type="button" class="ob-head" aria-expanded="true"><span class="ob-ch"></span><span class="ob-sum"></span><i class="ob-chev" aria-hidden="true"></i></button><ol class="ob-rows" aria-live="polite"></ol><div class="ob-log" hidden></div>';
  document.body.append(panel);
  const head = panel.querySelector('.ob-head'), rowsEl = panel.querySelector('.ob-rows'), logEl = panel.querySelector('.ob-log');
  const rows = new Map(); // id -> li
  function rowFor(id, animate) {
    const s = STEPS.find(x => x.id === id), li = document.createElement('li');
    li.className = 'ob-row' + (animate && !reduced() ? ' ob-in' : ''); li.dataset.id = id;
    li.innerHTML = `<i class="ob-box" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.4 5 8.8 9.6 3.4"/></svg></i><div class="ob-text"><b class="ob-title">${hintHTML(s.title)}</b><span class="ob-hint">${hintHTML(s.hint)}</span></div><em class="ob-count"></em>`;
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
  function renderHead(ch) {
    const all = ch === null, list = STEPS.filter(s => s.chapter === ch && !s.optional);
    panel.classList.toggle('ob-all', all);
    head.querySelector('.ob-ch').textContent = all ? 'Notes' : collapsed ? 'Notes' : chName(ch);
    head.querySelector('.ob-sum').textContent = all ? '' : `${collapsed ? '· ' : ''}${list.filter(s => P.done[s.id]).length}/${list.length}`;
    const open = all ? logOpen : !collapsed;
    panel.classList.toggle('ob-collapsed', !all && collapsed); panel.classList.toggle('ob-logopen', all && logOpen);
    head.setAttribute('aria-expanded', String(open)); logEl.hidden = !(all && logOpen);
    if (all && logOpen) logEl.innerHTML = [...new Set(STEPS.map(s => s.chapter))].map(c => `<section><h3>${hintHTML(chName(c))}</h3><ul>${STEPS.filter(s => s.chapter === c && (!s.optional || P.done[s.id])).map(s => `<li class="${P.done[s.id] ? 'ob-tick' : ''}">${hintHTML(s.title)}</li>`).join('')}</ul></section>`).join('');
  }
  function toggle() {
    if (panel.classList.contains('ob-all')) logOpen = !logOpen; else collapsed = !collapsed;
    lastProgress = Date.now(); panel.classList.remove('ob-dim'); persist(); renderHead(shownCh ?? null);
  }
  head.addEventListener('click', toggle);
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
      const li = rows.get(id) ?? rowFor(id, animate), c = r.counts[id];
      li.querySelector('.ob-count').textContent = c ? `${c[0]}/${c[1]}` : '';
    }
    renderHead(shownCh);
  }
  function tick() {
    let S = null; try { S = window.raftDebug?.state; } catch {}
    const playing = !!S?.running;
    if (!playing) return;
    lastS = S;
    const silent = !booted, r = evaluate(STEPS, P, S, {silent});
    for (const id of r.newly) { tickRow(id); feed(`✓ ${titleOf(id)}`); }
    if (r.newly.length) { chime(); lastProgress = Date.now(); }
    if (r.newly.length || r.silentDone.length || r.reset) persist();
    if (r.reset) collapsed = false;
    sync(r); booted = true;
    panel.classList.toggle('ob-dim', Date.now() - lastProgress > DIM_MS && !panel.classList.contains('ob-all'));
    let shift = 0; // slide left of an open bag panel when they overlap
    const bag = S.inventoryOpen && $('#inventory .sv-wrap')?.getBoundingClientRect();
    if (bag && bag.width) { const right = innerWidth - parseFloat(getComputedStyle(panel).right || 0), left = right - panel.offsetWidth;
      if (right > bag.left && left < bag.right && bag.top < panel.offsetTop + panel.offsetHeight) shift = Math.max(0, right - bag.left + 8); if (left - shift < 8) shift = 0; }
    panel.style.setProperty('--ob-shift', `${-shift}px`);
  }
  setInterval(tick, POLL_MS);

  // ----- title screen -----
  const welcome = $('#welcome'), card = welcome?.querySelector('.welcome-card');
  if (welcome && card) {
    const raw = store.get(SAVE_KEY), auto = store.get(AUTOSTART, sessionStorage) === '1';
    if (auto) store.del(AUTOSTART, sessionStorage);
    const logo = document.createElement('div');
    logo.className = 'ob-logo';
    logo.innerHTML = '<h2 class="ob-logo-name"><svg class="ob-sail" viewBox="0 0 48 48" aria-hidden="true"><use href="icons.svg#icon-sail"></use></svg>Little Raft</h2><p class="ob-tag">A little ocean. A big adventure.</p>';
    const menu = document.createElement('nav');
    menu.className = 'ob-menu'; menu.setAttribute('aria-label', 'Main menu');
    const sub = raw != null ? saveSummary(raw) : '';
    menu.innerHTML = `${raw != null ? `<button type="button" class="ob-item" data-act="continue">Continue${sub ? `<small>${hintHTML(sub)}</small>` : ''}</button>` : ''}
      <button type="button" class="ob-item" data-act="new">${auto && raw == null ? 'Set sail' : 'New Game'}</button>
      <button type="button" class="ob-item" data-act="crew">Play together</button>
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
      store.set(AUTOSTART, '1', sessionStorage); location.reload();
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
      else if (act === 'settings') $('#helpButton')?.click();
    });
    menu.addEventListener('keydown', e => {
      const list = items().filter(b => !b.disabled), i = list.indexOf(document.activeElement);
      if (e.key === 'Escape' && armed) { disarm(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault(); list[(i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
    });
    newBtn.addEventListener('blur', () => { if (armed) setTimeout(() => { if (document.activeElement !== newBtn) disarm(); }, 0); });
    const syncDisabled = () => { const off = !!solo()?.disabled; for (const b of items()) if (b.dataset.act === 'continue' || b.dataset.act === 'new') b.disabled = off; };
    setInterval(syncDisabled, 500); syncDisabled();
    try { (items()[0])?.focus({preventScroll:true}); } catch {}
  }
  return {
    reset() { P = createProgress(); booted = false; rows.forEach(li => li.remove()); rows.clear(); shownCh = undefined; holdUntil = 0; persist(); },
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
