// Raft logbook view: bottled notes, achievements and crew tasks in a left-edge side panel (a dialog for focus/Esc), plus unlock toasts.
// createLogbookUI({getProgress, onPause, onResume, tasks}) -> {open, close, toggle, update, celebrate, destroy, isOpen}
// tasks (optional, [tasks]): {view: () => taskView object | null, claim: id => void}; null view hides the Tasks tab.
import { exitLock } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';
import { NOTES, NOTE_COUNT, ACHIEVEMENTS, cleanProgress } from './logbook.js?build=v3-survival-ae77fa84ac2b';

const INST_KEY = '__littleRaftLogbookUI';
const STYLE_ID = 'little-raft-logbook-style';
const SEEN_KEY = 'little-raft-logbook-seen';
const FONT = "var(--ui-font,'Segoe UI',system-ui,-apple-system,sans-serif)"; // shared HUD font (graphics.css)
const BUILD = (() => { try { return new URL(import.meta.url).searchParams.get('build') || 'dev'; } catch { return 'dev'; } })();
const SPRITE_URL = (() => {
  try { const u = new URL('icons.svg', import.meta.url); u.search = '?build=' + encodeURIComponent(BUILD); return u.href; }
  catch { return 'icons.svg'; }
})();
const icon = (id, cls = 'lb-icon') => `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="${SPRITE_URL}#icon-${id}"></use></svg>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// A side panel at the left edge (like the pause rail), never a centred modal over play. Shared slate palette and
// --ui-font from graphics.css; the unlock toast sits at the top-left edge, clear of the compass/sail badge column.
const CSS = `
#logbook.lb{position:fixed;inset:0 auto 0 0;padding:0;margin:0;border:0;border-radius:0;background:transparent;box-shadow:none;color:var(--cream,#f4efe2);
  width:min(400px,calc(100vw - 24px));height:100dvh;max-width:none;max-height:none;overflow:visible;font:500 14px/1.45 ${FONT}}
#logbook.lb::backdrop{background:rgba(6,10,12,.3);-webkit-backdrop-filter:none;backdrop-filter:none}
#logbook .lb-wrap{display:flex;flex-direction:column;gap:12px;height:100%;padding:22px 20px 18px;box-sizing:border-box;outline:none;
  background:linear-gradient(180deg,#141b1ef2,#0b1012f7);box-shadow:inset -1px 0 0 var(--line,#ffffff17),18px 0 50px rgba(0,0,0,.3)}
#logbook .lb-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.lb h2{font:800 22px/1.2 ${FONT};margin:0;color:var(--cream-hi,#fff6e0);letter-spacing:-.2px}
#logbook .lb-close{width:32px;height:32px;min-width:32px;padding:0;display:grid;place-items:center;background:#ffffff0d;border:0;border-radius:6px;color:var(--cream,#f4efe2);cursor:pointer;box-shadow:none}
#logbook .lb-close:hover{transform:none;background:#ffffff22}
#logbook .lb-close svg{width:20px;height:20px}
#logbook .lb-close:focus-visible{outline:2px solid var(--cream-hi,#fff6e0);outline-offset:1px}
#logbook .lb-tabs{display:flex;gap:4px}
.lb [role=tab]{flex:1;background:#ffffff0b;box-shadow:inset 0 0 0 1px #ffffff12;border:0;border-radius:6px;padding:9px 10px;color:var(--cream-dim,#f4efe2b3);font:700 13px/1 ${FONT};cursor:pointer;transform:none}
.lb [role=tab]:hover{transform:none;color:var(--cream-hi,#fff6e0);background:#ffffff17}
.lb [role=tab][aria-selected=true]{color:var(--cream-hi,#fff6e0);background:linear-gradient(180deg,#46545ad0,#1c2529dc);box-shadow:inset 0 0 0 1px #fff6e0a8}
.lb [role=tab]:focus-visible{outline:2px solid var(--cream-hi,#fff6e0);outline-offset:1px}
.lb [role=tabpanel]{overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#ffffff52 transparent;min-height:0;flex:1;padding:2px 2px 0}
.lb [role=tabpanel][hidden]{display:none}
.lb-notes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.lb-note{background:#ffffff0a;color:var(--cream,#f4efe2);border-radius:6px;padding:10px 12px;box-shadow:inset 0 0 0 1px var(--line,#ffffff17);font-style:italic}
.lb-note .lb-no{display:inline-block;font:800 10px/1.2 ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:var(--amber,#ffc66e);font-style:normal;margin-bottom:4px}
.lb-note p{margin:0;color:inherit;font-size:14px;line-height:1.45}
.lb-sum{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:2px 2px 4px;font:800 10px/1.2 ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:var(--muted,#f4efe280)}
.lb-sum b{font:700 15px/1 ${FONT};letter-spacing:0;text-transform:none;color:var(--cream-hi,#fff6e0);font-variant-numeric:tabular-nums}
.lb-tip{display:flex;gap:9px;align-items:flex-start;padding:7px 10px;border-radius:6px;background:#ffffff06;color:var(--cream-dim,#f4efe2b3);font-size:13px;line-height:1.4}
.lb-tip::before{content:'';flex:none;width:6px;height:6px;margin-top:6px;transform:rotate(45deg);background:var(--amber,#ffc66e)}
.lb-new::after{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--amber,#ffc66e);margin-left:6px;vertical-align:middle}
.lb-grid{display:grid;grid-template-columns:1fr;gap:6px}
.lb-card{display:flex;gap:10px;align-items:center;padding:7px 9px;background:#ffffff0a;border-radius:6px;box-shadow:inset 0 0 0 1px var(--line,#ffffff17)}
.lb-card .lb-icon{width:32px;height:32px;flex:none}
.lb-card b{display:block;font:700 13px/1.25 ${FONT};color:var(--cream-hi,#fff6e0)}
.lb-card span{display:block;font-size:12px;line-height:1.35;color:var(--cream-dim,#f4efe2b3)}
.lb-card em{display:inline-block;margin-top:3px;font:800 10px/1 ${FONT};font-style:normal;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted,#f4efe280)}
.lb-card.lb-locked{opacity:.55}
.lb-card.lb-locked .lb-icon{filter:grayscale(1)}
/* One line, at most 40px tall, at the top-left edge: clear of the compass / sail badge column and the centred signal pill. */
#lb-toast{position:fixed;top:16px;left:16px;z-index:40;max-width:min(360px,calc(50vw - 130px));max-height:40px;overflow:hidden;white-space:nowrap;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:4px 12px 4px 8px;
  background:var(--plate-hud,rgba(16,22,25,.9));border-radius:8px;box-shadow:var(--frame,inset 0 0 0 1px #ffffff17,0 10px 28px rgba(0,0,0,.45));
  color:var(--cream,#f4efe2);font:600 14px/1.35 ${FONT};pointer-events:none;opacity:0;transform:translateY(-6px);transition:opacity .2s,transform .2s}
#lb-toast.lb-show{opacity:1;transform:none}
#lb-toast[hidden]{display:none}
#lb-toast .lb-icon{width:26px;height:26px;flex:none}#lb-toast span{min-width:0;overflow:hidden;text-overflow:ellipsis}
@media (prefers-reduced-motion:reduce){#lb-toast{transition:none;transform:none}}
/* [tasks] crew tasks tab, same slate cards as the notes */
.lb-tk-head{margin:0 0 8px;font:800 10px/1.3 ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:var(--muted,#f4efe280)}
.lb-tk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.lb-tk{padding:8px 10px;background:#ffffff0a;border-radius:6px;box-shadow:inset 0 0 0 1px var(--line,#ffffff17)}
.lb-tk.lb-tk-done{box-shadow:inset 0 0 0 1px var(--amber,#ffc66e),inset 3px 0 0 var(--amber,#ffc66e)}
.lb-tk-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.lb-tk-top b{font:700 13px/1.3 ${FONT};color:var(--cream-hi,#fff6e0)}
.lb-tk-top span{font:700 12px/1 ${FONT};color:var(--cream-dim,#f4efe2b3);font-variant-numeric:tabular-nums;white-space:nowrap}
.lb-tk-bar{height:6px;margin:6px 0;border-radius:3px;background:#00000059;box-shadow:inset 0 0 0 1px var(--line,#ffffff17);overflow:hidden}
.lb-tk-bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#c58f32,var(--amber,#ffc66e));transition:width .3s}
.lb-tk-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:var(--cream-dim,#f4efe2b3)}
.lb-tk-foot em{font:800 10px/1 ${FONT};font-style:normal;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted,#f4efe280)}
.lb button.lb-claim{min-height:28px;padding:5px 12px;border:0;border-radius:6px;background:linear-gradient(180deg,#ffd98f,#e9a24a);color:#2a1b0e;font:800 12px/1 ${FONT};cursor:pointer;box-shadow:none;transform:none}
.lb button.lb-claim:disabled{opacity:.35;cursor:default}
.lb button.lb-claim:focus-visible{outline:2px solid var(--cream-hi,#fff6e0);outline-offset:1px}
.lb-tk.lb-tk-extra{background:#ffffff05}
.lb-tk-streak{margin:10px 0 0;font-size:13px;color:var(--cream-dim,#f4efe2b3);text-align:center}
@media (max-width:520px){.lb [role=tabpanel]{padding:0}#logbook .lb-wrap{padding:16px 14px}}
`;

// Where the rest of the notes come from (shown instead of a wall of empty placeholders).
export const NOTE_TIPS = Object.freeze([
  'Bottles drift in with the other flotsam: hook one like a plank.',
  'About one piece of flotsam in 25 is a bottle. Keep fishing supplies out.',
  'Each bottle holds the next note in the series.',
]);

function ensureStyle() {
  let st = document.getElementById(STYLE_ID);
  if (!st) { st = document.createElement('style'); st.id = STYLE_ID; document.head.append(st); }
  if (st.textContent !== CSS) st.textContent = CSS;
}

const MARKUP = `<div class="lb-wrap" tabindex="-1">
  <div class="lb-head"><h2 id="lb-title">Raft logbook</h2>
    <button type="button" class="lb-close" aria-label="Close logbook">${icon('close', 'lb-x')}</button></div>
  <div class="lb-tabs" role="tablist" aria-label="Logbook sections">
    <button type="button" role="tab" id="lb-tab-notes" aria-controls="lb-panel-notes" data-tab="notes" aria-selected="true">Notes</button>
    <button type="button" role="tab" id="lb-tab-ach" aria-controls="lb-panel-ach" data-tab="ach" aria-selected="false" tabindex="-1">Achievements</button>
    <button type="button" role="tab" id="lb-tab-tasks" aria-controls="lb-panel-tasks" data-tab="tasks" aria-selected="false" tabindex="-1" hidden>Tasks</button>
  </div>
  <section role="tabpanel" id="lb-panel-notes" aria-labelledby="lb-tab-notes" tabindex="0"><ol class="lb-notes"></ol></section>
  <section role="tabpanel" id="lb-panel-ach" aria-labelledby="lb-tab-ach" tabindex="0" hidden><div class="lb-grid"></div></section>
  <section role="tabpanel" id="lb-panel-tasks" aria-labelledby="lb-tab-tasks" tabindex="0" hidden><div class="lb-tasks"></div></section>
</div>`;

function mountDialog() {
  let d = document.getElementById('logbook');
  if (!d || d.tagName !== 'DIALOG') {
    if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'logbook';
    document.body.append(d);
  }
  d.className = 'lb';
  d.setAttribute('aria-labelledby', 'lb-title');
  if (!d.querySelector('.lb-wrap [role=tablist]') || !d.querySelector('.lb-notes') || !d.querySelector('.lb-grid') || !d.querySelector('.lb-tasks')) d.innerHTML = MARKUP;
  return d;
}

function mountToast() {
  let t = document.getElementById('lb-toast');
  if (!t) { t = document.createElement('div'); t.id = 'lb-toast'; document.body.append(t); }
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.hidden = true; t.classList.remove('lb-show'); t.textContent = '';
  return t;
}

const readSeen = () => { try { const v = parseInt(localStorage.getItem(SEEN_KEY), 10); return Number.isFinite(v) ? v : 0; } catch { return 0; } };
const writeSeen = n => { try { localStorage.setItem(SEEN_KEY, String(n)); } catch {} };

// Found notes in order after a compact "n/12 found" line, then a few hints for the rest (never twelve identical placeholders).
export function notesHTML(found, newest = -1) {
  const p = { notes: found.filter(i => Number.isInteger(i) && i >= 0 && i < NOTE_COUNT) };
  let rows = `<li class="lb-sum">Notes found<b>${p.notes.length}/${NOTE_COUNT}</b></li>`;
  for (let i = 0; i < NOTE_COUNT; i++) if (p.notes.includes(i))
    rows += `<li class="lb-note"><span class="lb-no${i === newest ? ' lb-new' : ''}">No. ${i + 1}</span><p>${esc(NOTES[i])}</p></li>`;
  const left = NOTE_COUNT - p.notes.length;
  if (left > 0) rows += (p.notes.length ? [`${left} more note${left === 1 ? '' : 's'} still drifting out there.`] : NOTE_TIPS).map(t => `<li class="lb-tip">${esc(t)}</li>`).join('');
  return rows;
}

export function createLogbookUI({ getProgress, onPause, onResume, tasks } = {}) {
  const prev = window[INST_KEY];
  const ac = new AbortController();
  const opt = { signal: ac.signal };
  const safe = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (err) { console.warn('[logbook]', err); } };
  let alive = true, isOpen = false, tab = 'notes', lastSig = null, seenBase = null;
  let toastTimer = 0, hideTimer = 0, showing = false;
  const queued = []; // FIFO: rapid unlocks each get their turn
  const QUEUE_MAX = 8;

  ensureStyle();
  const dlg = mountDialog();
  const toast = mountToast();
  const wrap = dlg.querySelector('.lb-wrap');
  const tabs = [...dlg.querySelectorAll('[role=tab]')];
  const panels = { notes: dlg.querySelector('#lb-panel-notes'), ach: dlg.querySelector('#lb-panel-ach'), tasks: dlg.querySelector('#lb-panel-tasks') };
  const list = dlg.querySelector('.lb-notes');
  const grid = dlg.querySelector('.lb-grid');
  const taskBox = dlg.querySelector('.lb-tasks');
  const taskTab = tabs.find(t => t.dataset?.tab === 'tasks');
  let taskSig = null;

  // ---------- [tasks] crew tasks tab ----------
  const tasksView = () => { const v = safe(tasks?.view); return v && typeof v === 'object' && Array.isArray(v.rows) ? v : null; };
  const visibleTabs = () => tabs.filter(t => !t.hidden);
  const claimBtn = (id, can, label = 'Claim') => `<button type="button" class="lb-claim" data-claim="${esc(id)}"${can ? '' : ' disabled'}>${label}</button>`;
  function renderTasks(v = tasksView()) {
    taskSig = v ? v.sig : null;
    if (taskTab) taskTab.hidden = !v;
    if (!v) { taskBox.innerHTML = ''; if (tab === 'tasks') select('notes'); return; }
    if (taskTab) taskTab.textContent = `Tasks ${v.doneCount ?? v.rows.filter(r => r.done).length}/${v.rows.length}`;
    const row = r => {
      const pct = r.target > 0 ? Math.min(100, Math.round(r.n / r.target * 100)) : 0;
      const end = r.claimed ? '<em>Claimed</em>' : claimBtn(r.i, r.canClaim);
      return `<li class="lb-tk${r.done ? ' lb-tk-done' : ''}"><div class="lb-tk-top"><b>${esc(r.label)}</b><span>${r.n}/${r.target}</span></div>`
        + `<div class="lb-tk-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${r.target}" aria-valuenow="${r.n}" aria-label="${esc(r.label)}"><i style="width:${pct}%"></i></div>`
        + `<div class="lb-tk-foot"><span>Reward: ${esc(r.reward)}</span>${end}</div></li>`;
    };
    let html = `<p class="lb-tk-head">Day ${v.day} · fresh tasks each morning</p><ul class="lb-tk-list">`;
    html += v.rows.map((r, i) => row({ ...r, i })).join('');
    const b = v.bonus || {};
    html += `<li class="lb-tk lb-tk-extra${b.done ? ' lb-tk-done' : ''}"><div class="lb-tk-foot"><span>All three done: ${esc(b.reward || '')}</span>${b.claimed ? '<em>Claimed</em>' : claimBtn('bonus', !!b.canClaim)}</div></li>`;
    if (v.owed) html += `<li class="lb-tk lb-tk-extra"><div class="lb-tk-foot"><span>Left over from before: ${esc(v.owed)}</span>${claimBtn('owed', true)}</div></li>`;
    html += '</ul>';
    html += `<p class="lb-tk-streak">${v.streak > 0 ? `Streak ${v.streak} day${v.streak === 1 ? '' : 's'} · best ${v.best}` : 'Finish all three for a streak' + (v.best > 0 ? ` · best ${v.best}` : '')}</p>`;
    taskBox.innerHTML = html;
  }

  const progress = () => cleanProgress(safe(getProgress));
  const sigOf = p => p.notes.join() + '|' + p.achievements.join();

  function render() {
    const p = progress();
    lastSig = sigOf(p);
    tabs[0].textContent = `Notes ${p.notes.length}/${NOTE_COUNT}`;
    tabs[1].textContent = `Achievements ${p.achievements.length}/${ACHIEVEMENTS.length}`;
    const seen = seenBase == null ? readSeen() : seenBase;
    const newest = p.notes.length && p.notes.length > seen ? p.notes[p.notes.length - 1] : -1;
    list.innerHTML = notesHTML(p.notes, newest);
    grid.innerHTML = ACHIEVEMENTS.map(a => {
      const got = p.achievements.includes(a.id);
      return `<div class="lb-card${got ? '' : ' lb-locked'}">${icon(a.icon)}<div><b>${esc(a.name)}</b><span>${esc(a.desc)}</span>${got ? '' : '<em>Locked</em>'}</div></div>`;
    }).join('');
    if (isOpen && tab === 'notes' && seenBase != null) writeSeen(p.notes.length);
    renderTasks();
  }

  function select(name, focus = false) {
    tab = name === 'ach' ? 'ach' : name === 'tasks' && taskTab && !taskTab.hidden ? 'tasks' : 'notes';
    for (const t of tabs) {
      const on = t.dataset.tab === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      if (on && focus) { try { t.focus({ preventScroll: true }); } catch {} }
    }
    panels.notes.hidden = tab !== 'notes';
    panels.ach.hidden = tab !== 'ach';
    panels.tasks.hidden = tab !== 'tasks';
    if (tab === 'notes' && isOpen) {
      // Keep the dot for this opening, then remember it was seen.
      if (seenBase == null) seenBase = readSeen();
      writeSeen(progress().notes.length);
    }
  }

  function open(want) {
    if (!alive) return;
    if (isOpen) { if (want) select(want, true); return; }
    isOpen = true;
    seenBase = null;
    safe(onPause);
    exitLock(document); // marked page-initiated (lock-rules.js), so the game does not pause on it
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    renderTasks();
    select(want || tab, true);
    render();
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    seenBase = null;
    if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
    if (!dlg.dataset.fromPause) safe(onResume); // opened from the pause menu: settings.js reopens it instead
  }
  const toggle = () => (isOpen ? close() : open());

  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }, opt);
  dlg.addEventListener('close', () => { if (isOpen) { isOpen = false; seenBase = null; if (!dlg.dataset.fromPause && !document.getElementById('options')?.open) safe(onResume); } }, opt);
  dlg.addEventListener('click', e => {
    if (e.target?.closest?.('.lb-close')) { close(); return; }
    const c = e.target?.closest?.('[data-claim]');
    if (c && !c.disabled) { const id = c.dataset.claim; c.disabled = true; safe(tasks?.claim, /^\d$/.test(id) ? Number(id) : id); setTimeout(() => { if (alive && isOpen && c.isConnected) renderTasks(); }, 1500); return; } // update() redraws on a new view; this only re-arms a refused claim
    const t = e.target?.closest?.('[role=tab]');
    if (t) select(t.dataset.tab, true);
  }, opt);
  dlg.addEventListener('keydown', e => {
    const t = e.target?.closest?.('[role=tab]');
    if (!t) return;
    const vis = visibleTabs();
    let i = vis.indexOf(t);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') i = (i + 1) % vis.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (i + vis.length - 1) % vis.length;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = vis.length - 1;
    else return;
    e.preventDefault();
    select(vis[i].dataset.tab, true);
  }, opt);
  dlg.addEventListener('wheel', e => e.stopPropagation(), { ...opt, passive: true });

  document.addEventListener('keydown', e => {
    if (!alive || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code !== 'KeyL') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (isOpen) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!(document.body?.classList.contains('playing') || document.pointerLockElement)) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault(); e.stopPropagation();
    open();
  }, { ...opt, capture: true });
  document.addEventListener('littleraft:open-logbook', e => open(typeof e?.detail?.tab === 'string' ? e.detail.tab : undefined), opt); // [tasks] detail.tab

  // ---------- toast ----------
  function showToast(e) {
    showing = true;
    clearTimeout(hideTimer);
    toast.innerHTML = `${icon(e.kind === 'note' ? 'bottle' : 'compass')}<span></span>`;
    toast.querySelector('span').textContent = String(e.text || '');
    toast.hidden = false;
    requestAnimationFrame(() => { if (alive) toast.classList.add('lb-show'); });
    toastTimer = setTimeout(() => {
      toast.classList.remove('lb-show');
      hideTimer = setTimeout(() => {
        toast.hidden = true; showing = false;
        if (queued.length && alive) showToast(queued.shift());
      }, 220);
    }, 3000);
  }
  function celebrate(e) {
    if (!alive || !e || typeof e.text !== 'string' || !e.text) return;
    if (showing) { if (queued.length < QUEUE_MAX) queued.push(e); return; }
    showToast(e);
  }

  function update() {
    if (!alive || !isOpen) return;
    const p = progress();
    if (sigOf(p) !== lastSig) render();
    else { const v = tasksView(); if ((v ? v.sig : null) !== taskSig) renderTasks(v); }
  }

  const api = {
    open, close, toggle, update, celebrate,
    destroy() {
      if (!alive) return;
      alive = false;
      ac.abort();
      clearTimeout(toastTimer); clearTimeout(hideTimer);
      queued.length = 0; showing = false;
      toast.hidden = true; toast.classList.remove('lb-show');
      if (isOpen) { isOpen = false; if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } } }
      if (window[INST_KEY] === api) window[INST_KEY] = null;
    },
    get isOpen() { return isOpen; },
  };
  if (prev && prev !== api) { try { prev.destroy(); } catch {} }
  if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
  render();
  window[INST_KEY] = api;
  return api;
}

export default createLogbookUI;
