// Raft logbook view: bottled notes and achievements in a wood-panel dialog, plus unlock toasts.
// createLogbookUI({getProgress, onPause, onResume, tasks}) -> {open, close, toggle, update, celebrate, destroy, isOpen}
// tasks (optional, [tasks]): {view: () => taskView object | null, claim: id => void}; null view hides the Tasks tab.
import { exitLock } from './lock-rules.js?build=v3-survival-ae77fa84ac2b';
import { NOTES, NOTE_COUNT, ACHIEVEMENTS, cleanProgress } from './logbook.js?build=v3-survival-ae77fa84ac2b';

const INST_KEY = '__littleRaftLogbookUI';
const STYLE_ID = 'little-raft-logbook-style';
const SEEN_KEY = 'little-raft-logbook-seen';
const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const BUILD = (() => { try { return new URL(import.meta.url).searchParams.get('build') || 'dev'; } catch { return 'dev'; } })();
const SPRITE_URL = (() => {
  try { const u = new URL('icons.svg', import.meta.url); u.search = '?build=' + encodeURIComponent(BUILD); return u.href; }
  catch { return 'icons.svg'; }
})();
const icon = (id, cls = 'lb-icon') => `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><use href="${SPRITE_URL}#icon-${id}"></use></svg>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const WOOD = 'repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a)';
const CSS = `
#logbook.lb{padding:0;margin:auto;border:0;background:transparent;box-shadow:none;color:#fff2cc;width:min(640px,calc(100vw - 32px));max-height:88dvh;overflow:visible;font:500 14px/1.45 ${FONT}}
#logbook.lb::backdrop{background:rgba(12,9,5,.42);-webkit-backdrop-filter:none;backdrop-filter:none}
#logbook .lb-wrap{display:flex;flex-direction:column;gap:10px;padding:12px;max-height:88dvh;box-sizing:border-box;border-radius:6px;outline:none;
  background:${WOOD};border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#logbook .lb-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.lb h2{font:700 20px/1.2 ${FONT};margin:0;color:#fff2cc;letter-spacing:0;text-shadow:0 1px 0 #3e2a17}
#logbook .lb-close{width:32px;height:32px;min-width:32px;padding:0;display:grid;place-items:center;background:transparent;border:0;border-radius:4px;color:#fff2cc;cursor:pointer;box-shadow:none}
#logbook .lb-close:hover{transform:none;background:#00000022}
#logbook .lb-close svg{width:22px;height:22px}
#logbook .lb-close:focus-visible{outline:2px solid #ffe3a6;outline-offset:1px}
#logbook .lb-tabs{display:flex;gap:6px}
.lb [role=tab]{background:linear-gradient(180deg,#5a3f28e8,#3d2a19e8);box-shadow:inset 0 0 0 1px #d4b07a55;border:0;border-radius:4px;padding:8px 14px;color:#fff2cc;font:600 14px/1.2 ${FONT};cursor:pointer;transform:none}
.lb [role=tab]:hover{transform:none;filter:brightness(1.08)}
.lb [role=tab][aria-selected=true]{background:linear-gradient(180deg,#b3925acc,#8a6a3ccc);box-shadow:inset 0 0 0 2px #ffe3a6}
.lb [role=tab]:focus-visible{outline:2px solid #ffe3a6;outline-offset:1px}
.lb [role=tabpanel]{background:#3a2716eb;border-radius:4px;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544;padding:10px;overflow:auto;overscroll-behavior:contain;scrollbar-color:#b48d55 #2a1b0e;min-height:0;flex:1}
.lb [role=tabpanel][hidden]{display:none}
.lb-notes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.lb-note{background:#f3e6c4;color:#3e2a17;border-radius:3px;padding:10px 12px;box-shadow:0 2px 0 #24170c;font-style:italic}
.lb-note .lb-no{display:inline-block;font:600 12px/1.2 ${FONT};font-variant:small-caps;letter-spacing:.04em;color:#8a663a;font-style:normal;margin-bottom:3px}
.lb-note p{margin:0;color:inherit;font-size:14px;line-height:1.45}
.lb-note.lb-missing{background:transparent;border:1px dashed #b48d5566;box-shadow:none;color:#d6b67e99;font-style:normal}
.lb-note.lb-missing .lb-no{color:#d6b67e99}
.lb-new::after{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:#ffbd66;margin-left:6px;vertical-align:middle}
.lb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.lb-card{display:flex;gap:10px;align-items:flex-start;padding:8px;background:linear-gradient(180deg,#664730e8,#46301ce8);border-radius:4px;box-shadow:inset 0 0 0 1px #d4b07a44}
.lb-card .lb-icon{width:36px;height:36px;flex:none}
.lb-card b{display:block;font:600 14px/1.25 ${FONT};color:#fff2cc}
.lb-card span{display:block;font-size:12px;line-height:1.35;color:#e8d3a8}
.lb-card em{display:inline-block;margin-top:3px;font:600 11px/1 ${FONT};font-style:normal;text-transform:uppercase;letter-spacing:.06em;color:#d6b67e}
.lb-card.lb-locked{opacity:.5}
.lb-card.lb-locked .lb-icon{filter:grayscale(1)}
#lb-toast{position:fixed;top:16px;right:16px;z-index:40;max-width:calc(100vw - 32px);box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:8px 12px;
  background:linear-gradient(180deg,#664730f2,#46301cf2);border:2px solid #3e2a17;border-radius:4px;box-shadow:0 0 0 2px #d6b67e,0 8px 24px #0008;
  color:#fff2cc;font:600 14px/1.35 ${FONT};pointer-events:none;opacity:0;transform:translateY(-6px);transition:opacity .2s,transform .2s}
#lb-toast.lb-show{opacity:1;transform:none}
#lb-toast[hidden]{display:none}
#lb-toast .lb-icon{width:32px;height:32px;flex:none}
@media (prefers-reduced-motion:reduce){#lb-toast{transition:none;transform:none}}
@media (max-width:760px){#lb-toast{top:52px}} /* clear the centred signal readout pill */
.lb-tk-head{margin:0 0 8px;font:600 12px/1.3 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:#d6b67e}
.lb-tk-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.lb-tk{padding:8px 10px;background:linear-gradient(180deg,#664730e8,#46301ce8);border-radius:4px;box-shadow:inset 0 0 0 1px #d4b07a44}
.lb-tk.lb-tk-done{box-shadow:inset 0 0 0 2px #ffcf7d99}
.lb-tk-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.lb-tk-top b{font:600 14px/1.3 ${FONT};color:#fff2cc}
.lb-tk-top span{font:600 13px/1 ${FONT};color:#e8d3a8;font-variant-numeric:tabular-nums;white-space:nowrap}
.lb-tk-bar{height:8px;margin:6px 0;border-radius:4px;background:#24170c;box-shadow:inset 0 0 0 1px #b48d5544;overflow:hidden}
.lb-tk-bar i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,#c58f32,#ffcf7d);transition:width .3s}
.lb-tk-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:#e8d3a8}
.lb-tk-foot em{font:600 11px/1 ${FONT};font-style:normal;text-transform:uppercase;letter-spacing:.06em;color:#d6b67e}
.lb button.lb-claim{min-height:30px;padding:5px 12px;border:0;border-radius:3px;background:linear-gradient(#ffcf7d,#e9a24a);color:#2a1b0e;font:800 12px/1 ${FONT};cursor:pointer;box-shadow:0 2px 0 #8a5a26;transform:none}
.lb button.lb-claim:disabled{opacity:.35;cursor:default;box-shadow:none}
.lb button.lb-claim:focus-visible{outline:2px solid #ffe3a6;outline-offset:1px}
.lb-tk.lb-tk-extra{background:#2a1b0ecc}
.lb-tk-streak{margin:10px 0 0;font-size:13px;color:#e8d3a8;text-align:center}
@media (max-width:520px){.lb [role=tab]{flex:1}.lb-grid{grid-template-columns:1fr}.lb [role=tabpanel]{padding:8px}}
`;

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
  const taskTab = tabs.find(t => t.dataset.tab === 'tasks');
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
    let rows = '';
    for (let i = 0; i < NOTE_COUNT; i++) {
      const found = p.notes.includes(i);
      rows += found
        ? `<li class="lb-note"><span class="lb-no${i === newest ? ' lb-new' : ''}">No. ${i + 1}</span><p>${esc(NOTES[i])}</p></li>`
        : `<li class="lb-note lb-missing"><span class="lb-no">No. ${i + 1}</span><p>Still adrift…</p></li>`;
    }
    list.innerHTML = rows;
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
    safe(onResume);
  }
  const toggle = () => (isOpen ? close() : open());

  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }, opt);
  dlg.addEventListener('close', () => { if (isOpen) { isOpen = false; seenBase = null; safe(onResume); } }, opt);
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
