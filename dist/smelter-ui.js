// Little Raft cooking-station panel (smelter, grill, ...). Pure view: reads the StationModel and
// the Bag, and routes every change through the callbacks. Styled to match survival-ui.js.
const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SPRITE_URL = (() => { try { return new URL('icons.svg', import.meta.url).href; } catch { return 'icons.svg'; } })();
const SPRITES = new Set(['hook', 'floor', 'fish', 'wood', 'leaf', 'scrap', 'barrel', 'sail', 'palm', 'lantern', 'net', 'repair', 'hammer', 'compass']);
let ICONS = {};
const iconsReady = import('./item-icons.js').then(m => { ICONS = m.ITEM_ICONS || m.default || {}; }).catch(() => {});

const CSS = `
#stationPanel.st-dlg{padding:0;margin:auto;border:0;background:transparent;box-shadow:none;width:max-content;max-width:96vw;color:#fff2cc;font:500 14px/1.35 ${FONT};overflow:visible}
#stationPanel.st-dlg::backdrop{background:rgba(12,9,5,.42);backdrop-filter:none}
#stationPanel .st-wrap{position:relative;padding:12px;border-radius:6px;outline:none;
  background:repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a);border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#stationPanel .st-head{display:flex;align-items:center;justify-content:space-between;margin:-2px 2px 10px}
#stationPanel h2{margin:0;font:800 19px/1.1 ${FONT};color:#2a1b0e;letter-spacing:.3px;text-shadow:0 1px 0 #e7cd98}
#stationPanel .st-x{width:30px;height:30px;padding:0;border:0;border-radius:4px;background:#3a2716;color:#fff2cc;font:700 18px/1 ${FONT};cursor:pointer;transform:none}
#stationPanel .st-x:hover{background:#5d4129}
#stationPanel .st-body{display:flex;gap:12px;align-items:stretch}
#stationPanel .st-bag,#stationPanel .st-main{background:#3a2716eb;border-radius:4px;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544;padding:10px}
#stationPanel .st-bag{user-select:none;-webkit-user-select:none;width:190px;max-height:300px;overflow:auto;box-sizing:border-box;scrollbar-color:#b48d55 #2a1b0e}
#stationPanel .st-sub{margin:0 0 6px;font:700 11px/1 ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:#d9c9a6}
#stationPanel .st-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
#stationPanel .st-none{margin:0 0 12px;font-size:12px;color:#bfae8a}
#stationPanel .st-chip{position:relative;width:48px;height:48px;padding:0;border:0;border-radius:3px;cursor:pointer;transform:none;background:linear-gradient(180deg,#5a3f28,#3d2a19);box-shadow:inset 0 0 0 1px #d4b07a55,inset 0 2px 6px #0006}
#stationPanel .st-chip:hover:not(:disabled){box-shadow:inset 0 0 0 1px #ffe3a6,0 0 8px #ffbd6655}
#stationPanel .st-chip:disabled{opacity:.4;cursor:not-allowed}
#stationPanel .st-chip .st-ic{position:absolute;inset:7px}
#stationPanel .st-n{position:absolute;right:3px;bottom:2px;font:700 13px/1 ${FONT};color:#fff2cc;text-shadow:0 1px 0 #000,0 0 3px #000}
#stationPanel .st-ic svg{display:block;width:100%;height:100%;filter:drop-shadow(0 1px 1px #0008)}
#stationPanel .st-main{display:flex;flex-direction:column;gap:10px;width:370px;box-sizing:border-box}
#stationPanel .st-row{display:grid;grid-template-columns:72px 1fr 72px;gap:10px;align-items:center}
#stationPanel .st-col{display:flex;flex-direction:column;align-items:center;gap:6px}
#stationPanel .st-slot{position:relative;width:60px;height:60px;border-radius:4px;background:#24170c;box-shadow:inset 0 0 0 2px #6b4a2b,inset 0 3px 8px #000a}
#stationPanel .st-slot .st-ic{position:absolute;inset:9px}
#stationPanel .st-slot.st-ready{box-shadow:inset 0 0 0 2px #ffbd66,0 0 12px #ffbd6688}
#stationPanel .st-lbl{font:700 10px/1 ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:#d9c9a6}
#stationPanel .st-btn{min-width:60px;white-space:nowrap;padding:5px 8px;border:0;border-radius:3px;cursor:pointer;transform:none;background:linear-gradient(#ffcf7d,#e9a24a);color:#2a1b0e;font:800 12px/1 ${FONT};box-shadow:0 2px 0 #8a5a26}
#stationPanel .st-btn.st-ghost{background:#5d4129;color:#f3e4c2;box-shadow:0 2px 0 #24170c;font-weight:700}
#stationPanel .st-btn:disabled{opacity:.35;cursor:default}
#stationPanel .st-mid{display:flex;flex-direction:column;gap:6px}
#stationPanel .st-bar{height:12px;border-radius:6px;background:#24170c;box-shadow:inset 0 0 0 1px #6b4a2b;overflow:hidden}
#stationPanel .st-bar>i{display:block;height:100%;width:0;border-radius:6px;transition:width .15s linear}
#stationPanel .st-prog>i{background:linear-gradient(90deg,#ffbd66,#fff2cc)}
#stationPanel .st-fuel{height:7px;width:60px}
#stationPanel .st-fuel>i{background:linear-gradient(90deg,#e0603a,#ffbd66)}
#stationPanel .st-cap{font:600 12px/1.3 ${FONT};color:#eadcbe;text-align:center;white-space:nowrap;min-height:16px;font-variant-numeric:tabular-nums}
#stationPanel .st-flame{width:42px;height:42px;filter:grayscale(1) brightness(.5);transition:filter .3s}
#stationPanel .st-on .st-flame{filter:drop-shadow(0 0 6px #ffbd66aa);animation:st-fl .5s ease-in-out infinite alternate;transform-origin:50% 90%}
@keyframes st-fl{from{transform:scale(1,1)}to{transform:scale(.92,1.09)}}
#stationPanel .st-hint{margin:0;padding:7px 9px;border-radius:3px;background:#24170caa;font:600 13px/1.3 ${FONT};color:#d9c9a6;text-align:center}
#stationPanel .st-hint.st-warn{color:#ffcf9a;box-shadow:inset 0 0 0 1px #ffbd6655}
@media(max-width:620px){#stationPanel .st-body{flex-direction:column}#stationPanel .st-bag{width:auto;max-height:160px}#stationPanel .st-main{width:auto}}
@media(prefers-reduced-motion:reduce){#stationPanel .st-on .st-flame{animation:none}}`;
const FLAME = `<svg class="st-flame" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4C27 13 37 18 37 30A13 13 0 0 1 11 30C11 22 16 19 18 12C20 17 22 18 23 19C25 14 25 9 24 4Z" fill="#e0603a" stroke="#153e49" stroke-width="2" stroke-linejoin="round"/><path d="M24 22C26 27 31 29 31 34A7 7 0 0 1 17 34C17 30 20 29 21 25C22 27 23 27 24 22Z" fill="#ffd27a"/></svg>`;

export function createStationPanel({ getStation, getBag, items = {}, fuelValue = {}, onInsert, onFuel, onTake, onTakeInput, onOpen, onClose } = {}) {
  const safe = (fn, ...a) => { try { return fn?.(...a); } catch (e) { console.error(e); } };
  const name = k => items[k]?.name || String(k ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const plural = k => name(k).toLowerCase().replace(/([^s])$/, '$1s');
  const icon = k => {
    const body = ICONS[k];
    if (body) return `<svg viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
    const id = String(items[k]?.icon || '').replace(/^icon-/, '');
    if (SPRITES.has(id)) return `<svg viewBox="0 0 48 48" aria-hidden="true"><use href="${SPRITE_URL}#icon-${id}"></use></svg>`;
    return `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="9" width="34" height="30" rx="3" fill="${esc(items[k]?.iconTint || '#bb8650')}" stroke="#153e49" stroke-width="2"/><text x="24" y="30" text-anchor="middle" font-family="Segoe UI,system-ui,sans-serif" font-size="17" font-weight="800" fill="#fff2cc" stroke="#153e49" stroke-width=".7">${esc(name(k).replace(/\s+/g, '').slice(0, 2))}</text></svg>`;
  };
  if (!document.getElementById('station-style')) {
    const st = document.createElement('style'); st.id = 'station-style'; st.textContent = CSS; document.head.append(st);
  }
  let dlg = document.getElementById('stationPanel');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'stationPanel'; document.body.append(dlg); }
  dlg.className = 'st-dlg';
  dlg.innerHTML = `<div class="st-wrap" tabindex="-1">
    <div class="st-head"><h2></h2><button type="button" class="st-x" aria-label="Close">×</button></div>
    <div class="st-body">
      <section class="st-bag" aria-label="Your items"><p class="st-sub">To cook</p><div class="st-chips" data-role="input"></div>
        <p class="st-sub">Fuel</p><div class="st-chips" data-role="fuel"></div></section>
      <section class="st-main"><div class="st-row">
        <div class="st-col"><span class="st-lbl">In</span><div class="st-slot" data-slot="input"></div><button type="button" class="st-btn st-ghost" data-act="back">Take back</button></div>
        <div class="st-mid"><div class="st-col st-fire">${FLAME}<div class="st-bar st-fuel" title="Fuel"><i></i></div></div>
          <div class="st-bar st-prog"><i></i></div><div class="st-cap"></div></div>
        <div class="st-col"><span class="st-lbl">Out</span><div class="st-slot" data-slot="output"></div><button type="button" class="st-btn" data-act="take">Take</button></div>
      </div><p class="st-hint" aria-live="polite"></p></section>
    </div></div>`;
  const $ = s => dlg.querySelector(s);
  const el = { title: $('h2'), inChips: $('[data-role=input]'), fuelChips: $('[data-role=fuel]'), inSlot: $('[data-slot=input]'), outSlot: $('[data-slot=output]'),
    back: $('[data-act=back]'), take: $('[data-act=take]'), fire: $('.st-fire'), fuel: $('.st-fuel>i'), prog: $('.st-prog>i'), cap: $('.st-cap'), hint: $('.st-hint') };
  const last = {};
  const set = (key, v, fn) => { if (last[key] !== v) { last[key] = v; fn(v); } };
  let isOpen = false, sid = null;
  const ac = new AbortController(), opt = { signal: ac.signal };

  const station = () => { try { return getStation?.(sid) || null; } catch (e) { console.error(e); return null; } };
  function counts() {
    const out = {}; let bag; try { bag = getBag?.(); } catch {}
    let snap; try { snap = typeof bag?.snapshot === 'function' ? bag.snapshot() : bag; } catch {}
    for (const s of snap?.slots || []) if (s?.kind && s.count > 0) out[s.kind] = (out[s.kind] || 0) + s.count;
    return out;
  }
  const slotHTML = s => s && s.count > 0 ? `<i class="st-ic" data-item-kind="${esc(s.kind)}">${icon(s.kind)}</i>${s.count > 1 ? `<i class="st-n">${s.count}</i>` : ''}` : '';
  const chipHTML = (role, k, n, ok) => `<button type="button" class="st-chip" data-role="${role}" data-item-kind="${esc(k)}" aria-label="${esc(`${name(k)}, ${n}. Click adds 1, shift-click adds all`)}"${ok ? '' : ` disabled title="${role === 'fuel' ? 'The fire is full' : 'Finish or take back what is cooking first'}"`}><i class="st-ic">${icon(k)}</i><i class="st-n">${n}</i></button>`;

  function update() {
    if (!isOpen) return;
    const st = station();
    if (!st) { set('hint', 'Nothing here to cook with.', v => { el.hint.textContent = v; }); return; }
    const have = counts(), kinds = Object.keys(have);
    const fuelN = Number(st.fuelUnits ?? st.fuel) || 0, cap = Number(st.fuelCap) || 10;
    const inputs = kinds.filter(k => safe(() => st.recipeFor(k)));
    const fuels = kinds.filter(k => Number(fuelValue[k]) > 0);
    const inSig = inputs.map(k => `${k}:${have[k]}:${safe(() => st.accepts(k)) ? 1 : 0}`).join(',');
    const fuelSig = fuels.map(k => `${k}:${have[k]}:${fuelN + Number(fuelValue[k]) <= cap + 1e-9 ? 1 : 0}`).join(',');
    set('inChips', inSig, () => { el.inChips.innerHTML = inputs.map(k => chipHTML('input', k, have[k], safe(() => st.accepts(k)))).join('') || '<p class="st-none">Nothing in your bag cooks here yet.</p>'; });
    set('fuelChips', fuelSig, () => { el.fuelChips.innerHTML = fuels.map(k => chipHTML('fuel', k, have[k], fuelN + Number(fuelValue[k]) <= cap + 1e-9)).join('') || '<p class="st-none">No fuel. Planks burn well.</p>'; });
    const inp = st.input, out = st.output;
    set('in', inp ? `${inp.kind}:${inp.count}` : '', () => { el.inSlot.innerHTML = slotHTML(inp); el.back.disabled = !inp; });
    set('out', out ? `${out.kind}:${out.count}` : '', () => { el.outSlot.innerHTML = slotHTML(out); el.take.disabled = !out; el.outSlot.classList.toggle('st-ready', !!out); });
    const r = inp ? safe(() => st.recipeFor(inp.kind)) : null;
    const frac = Math.max(0, Math.min(1, Number(st.fraction ?? st.progress) || 0));
    const cooking = !!st.cooking;
    set('fuel', Math.round(fuelN / cap * 200), v => { el.fuel.style.width = v / 2 + '%'; el.fuel.parentNode.title = `Fuel ${Math.round(fuelN * 10) / 10} / ${cap}`; });
    set('prog', Math.round(frac * 400), v => { el.prog.style.width = v / 4 + '%'; });
    set('on', cooking, v => el.fire.classList.toggle('st-on', v));
    const secs = r ? Math.ceil(r.time * (cooking || frac > 0 ? 1 - frac : 1)) : 0;
    set('cap', r ? `${name(inp.kind)} → ${name(r.kind)} · ${secs} s` : '', v => { el.cap.textContent = v; });
    const blocked = r && out && (out.kind !== r.kind || out.count + (r.count || 1) > (Number(items[out.kind]?.stack) || 1));
    const fuelKind = fuels[0] || Object.keys(fuelValue)[0];
    const hint = blocked ? [`Take your ${plural(out.kind)} out to keep going.`, 1]
      : r && !cooking && r.fuel > 0 && fuelN <= 1e-9 ? [`Add ${fuelKind ? 'a ' + name(fuelKind).toLowerCase() : 'some fuel'} to keep the fire going.`, 1]
      : cooking ? [`Cooking ${name(r.kind).toLowerCase()}…${inp.count > 1 ? ` ${inp.count} queued.` : ''}`, 0]
      : out ? [`Your ${name(out.kind).toLowerCase()} is ready. Take it!`, 0]
      : ['Pick something from your bag to cook, then add fuel.', 0];
    set('hint', hint.join('|'), () => { el.hint.textContent = hint[0]; el.hint.classList.toggle('st-warn', !!hint[1]); });
  }

  function open(stationId) {
    if (stationId != null) sid = stationId;
    const st = station();
    el.title.textContent = name(st?.stationId ?? sid ?? 'station');
    for (const k in last) delete last[k];
    if (!isOpen) {
      isOpen = true;
      safe(onOpen, sid);
      if (document.pointerLockElement) { try { document.exitPointerLock(); } catch {} }
      if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
      try { $('.st-wrap').focus({ preventScroll: true }); } catch {}
    }
    update();
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
    safe(onClose, sid);
  }
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }, opt);
  dlg.addEventListener('close', () => { if (isOpen) { isOpen = false; safe(onClose, sid); } }, opt);
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('.st-x')) { close(); return; }
    const chip = e.target.closest('.st-chip');
    if (chip && !chip.disabled) {
      const k = chip.dataset.itemKind, n = e.shiftKey ? counts()[k] || 0 : 1;
      if (n > 0) safe(chip.dataset.role === 'fuel' ? onFuel : onInsert, k, n);
    } else if (e.target.closest('[data-act=take]')) safe(onTake);
    else if (e.target.closest('[data-act=back]')) safe(onTakeInput);
    update();
  }, opt);
  iconsReady.then(() => { for (const k in last) delete last[k]; update(); });
  dlg.addEventListener('wheel', e => e.stopPropagation(), { ...opt, passive: true });

  return {
    open, close, update,
    get isOpen() { return isOpen; },
    get stationId() { return sid; },
    dispose() { close(); ac.abort(); dlg.remove(); },
  };
}

export default createStationPanel;
