// Storage / research UI (DOM only): one <dialog id="lrStorage"> for the crate chest and the Research
// Table, plus lock badges on the inventory craft list. It reads state through the small `api` object
// from storage-research.js and changes nothing itself: every click becomes a ctx.action().
// update() runs per frame; it only compares numbers/strings and repaints on change.
import { iconSVG, slotSig, paintSlot, itemName } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
import { RECIPES, ITEM_INFO, SLOT_COUNT, HOTBAR_SIZE } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';

const CHEST = 12;
const FONT = "'Segoe UI',system-ui,-apple-system,sans-serif";
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slotInner = num => `${num ? `<i class="sv-num">${num}</i>` : ''}<i class="sv-art"></i><i class="sv-count"></i><i class="sv-dur" hidden><i></i></i>`;
const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="#ffcf9a" stroke="#2a1b0e" stroke-width="1.2"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="#ffcf9a" stroke-width="1.7"/><circle cx="8" cy="10.6" r="1.1" fill="#2a1b0e"/></svg>';
const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#9fe07a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const CSS = `
#lrStorage.lr-sr{padding:0;margin:min(10vh,72px) auto auto;border:0;border-radius:6px;background:transparent;box-shadow:none;color:#fff2cc;width:max-content;max-width:96vw;max-height:calc(100vh - min(10vh,72px) - 12px);overflow:visible;font:500 14px/1.35 ${FONT}}
#lrStorage.lr-sr::backdrop{background:rgba(12,9,5,.42);-webkit-backdrop-filter:none;backdrop-filter:none}
#lrStorage .lr-sr-wrap{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:6px;outline:none;max-height:calc(100vh - min(10vh,72px) - 18px);box-sizing:border-box;overflow:hidden;
  background:repeating-linear-gradient(90deg,#00000012 0 2px,transparent 2px 23px),linear-gradient(#b48d55,#8a663a);border:3px solid #3e2a17;box-shadow:0 0 0 2px #d6b67e,0 18px 50px #000a}
#lrStorage .lr-sr-head{display:flex;align-items:center;gap:10px;padding:2px 2px 0}
#lrStorage .lr-sr-hicon{display:grid;place-items:center;width:40px;height:40px;border-radius:4px;background:#3a2716eb;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544}
#lrStorage .lr-sr-hicon .sv-icon{width:30px;height:30px;filter:drop-shadow(0 1px 1px #0008)}
#lrStorage .lr-sr-title{margin:0;font:800 19px/1.1 ${FONT};letter-spacing:.2px;color:#2a1b0e;text-shadow:0 1px 0 #d6b67e88}
#lrStorage .lr-sr-sub{display:block;margin-top:2px;font:700 12px/1.2 ${FONT};color:#3e2a17cc}
#lrStorage .lr-sr-x{margin-left:auto;width:32px;height:32px;padding:0;border:0;border-radius:4px;background:#3a2716eb;color:#fff2cc;font:700 18px/1 ${FONT};box-shadow:inset 0 0 0 1px #d4b07a55;cursor:pointer;transform:none}
#lrStorage .lr-sr-x:hover{box-shadow:inset 0 0 0 1px #ffe3a6}
#lrStorage .lr-sr-head,#lrStorage .lr-sr-banner{flex:none}
#lrStorage .lr-sr-body{display:flex;gap:12px;align-items:stretch;flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-color:#b48d55 #2a1b0e}
#lrStorage[data-mode=crate] .lr-sr-body{flex-direction:column;align-items:center}
#lrStorage .lr-sr-panel{background:#3a2716eb;border-radius:4px;box-shadow:inset 0 0 0 2px #24170c,inset 0 0 0 3px #b48d5544;padding:10px 12px;box-sizing:border-box}
#lrStorage[data-mode=crate] .lr-sr-panel{width:100%;display:flex;flex-direction:column;align-items:center;gap:8px}
#lrStorage .lr-sr-label{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;margin:0 0 2px;font:800 11px/1 ${FONT};letter-spacing:1.4px;text-transform:uppercase;color:#d9c9a6}
#lrStorage .lr-sr-cgrid{display:grid;grid-template-columns:repeat(6,52px);gap:6px;padding:6px;border-radius:4px;background:#24170c88;box-shadow:inset 0 2px 6px #0007}
#lrStorage .lr-sr-grid{display:grid;grid-template-columns:repeat(7,52px);gap:6px}
#lrStorage .lr-sr-hotrow{display:grid;grid-template-columns:repeat(${HOTBAR_SIZE},52px);gap:6px}
#lrStorage .lr-sr-rope{width:100%;height:4px;border-radius:2px;background:repeating-linear-gradient(115deg,#c99560 0 3px,#6b4a2b 3px 5px);opacity:.85}
#lrStorage button.sv-slot{position:relative;display:block;width:52px;height:52px;margin:0;padding:0;border:0;border-radius:3px;background:linear-gradient(180deg,#5a3f28e8,#3d2a19e8);
  box-shadow:inset 0 0 0 1px #d4b07a55,inset 0 2px 6px #0006;color:#fff2cc;font:600 14px/1 ${FONT};cursor:pointer;transform:none;transition:box-shadow .08s,background .08s;outline:none}
#lrStorage button.sv-slot.sv-hot{background:linear-gradient(180deg,#664730e8,#46301ce8)}
#lrStorage .lr-sr-cgrid button.sv-slot{background:linear-gradient(180deg,#6b4a2ce8,#4a321de8)}
#lrStorage .sv-slot .sv-art{inset:8px}
#lrStorage button.sv-slot:hover:not(.sv-empty){box-shadow:inset 0 0 0 2px #ffe3a6,inset 0 2px 6px #0005}
#lrStorage button.sv-slot.sv-empty{cursor:default}
#lrStorage button.sv-slot:focus-visible{outline:2px solid #ffe3a6;outline-offset:1px}
#lrStorage button.sv-slot.lr-sr-pop{animation:lrSrPop .28s ease-out}
@keyframes lrSrPop{0%{box-shadow:inset 0 0 0 2px #9fe0d6,0 0 12px #9fe0d6aa}100%{box-shadow:inset 0 0 0 1px #d4b07a55,inset 0 2px 6px #0006}}
#lrStorage .lr-sr-btn{padding:6px 11px;border:0;border-radius:4px;background:linear-gradient(#7a5631,#5d4026);color:#fff2cc;font:700 12px/1 ${FONT};letter-spacing:.2px;text-transform:none;
  box-shadow:inset 0 0 0 1px #d4b07a77,0 1px 0 #0006;cursor:pointer;transform:none}
#lrStorage .lr-sr-btn:hover:not(:disabled){box-shadow:inset 0 0 0 1px #ffe3a6,0 1px 0 #0006;background:linear-gradient(#8a6338,#6a4a2b)}
#lrStorage .lr-sr-btn:disabled{opacity:.45;cursor:default}
#lrStorage .lr-sr-hint{margin:0;max-width:470px;font:500 12px/1.35 ${FONT};color:#d9c9a6;text-align:center}
#lrStorage .lr-sr-hint kbd{display:inline-block;padding:0 4px;border:1px solid #d9c9a688;border-radius:3px;font:inherit}
/* research */
#lrStorage .lr-sr-next{width:320px;max-height:min(470px,70vh);overflow:auto;overscroll-behavior:contain;scrollbar-color:#b48d55 #2a1b0e}
#lrStorage .lr-sr-study{width:300px;display:flex;flex-direction:column;gap:10px}
#lrStorage .lr-sr-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,96px));justify-content:center;gap:8px}
#lrStorage .lr-sr-tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;min-height:96px;padding:8px 4px 7px;border:0;border-radius:4px;
  background:linear-gradient(#5d4129,#4a3220);box-shadow:inset 0 0 0 1px #d4b07a44;color:#fff2cc;font:700 12px/1.15 ${FONT};text-transform:none;letter-spacing:0;cursor:pointer;transform:none}
#lrStorage .lr-sr-tile .sv-icon{width:38px;height:38px;filter:drop-shadow(0 1px 1px #0008)}
#lrStorage .lr-sr-tile small{font:600 11px/1.2 ${FONT};color:#d9c9a6;text-align:center}
#lrStorage .lr-sr-tile b{position:absolute;right:5px;top:4px;font:700 11px/1 ${FONT};color:#fff2cc;text-shadow:0 1px 0 #000}
#lrStorage .lr-sr-tile:hover:not(:disabled){background:linear-gradient(#7a5631,#5d4026);box-shadow:inset 0 0 0 2px #ffe3a6}
#lrStorage .lr-sr-tile.lr-sr-ready{box-shadow:inset 0 0 0 1px #ffbd66aa,0 0 8px #ffbd6644}
#lrStorage .lr-sr-tile:disabled{cursor:default;background:#2a1b0ecc;box-shadow:inset 0 0 0 1px #d4b07a22}
#lrStorage .lr-sr-tile:disabled .sv-icon{filter:grayscale(1) brightness(.75);opacity:.55}
#lrStorage .lr-sr-tile:disabled span{color:#cdbd9a99}
#lrStorage .lr-sr-chips{display:flex;flex-wrap:wrap;gap:5px}
#lrStorage .lr-sr-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 4px;border-radius:12px;background:#24170caa;box-shadow:inset 0 0 0 1px #d4b07a33;font:600 12px/1 ${FONT};color:#eadcbe}
#lrStorage .lr-sr-chip .sv-icon{width:18px;height:18px}
#lrStorage .lr-sr-chip svg:not(.sv-icon){width:14px;height:14px;margin-left:3px}
#lrStorage .lr-sr-chip.lr-sr-need{color:#cdbd9a;box-shadow:inset 0 0 0 1px #ffbd6655}
#lrStorage .lr-sr-chip.lr-sr-need .sv-icon{filter:grayscale(.7);opacity:.7}
#lrStorage .lr-sr-chip.lr-sr-have{color:#ffcf9a}
#lrStorage .lr-sr-empty{margin:4px 2px;color:#d9c9a6;font-size:13px}
#lrStorage .lr-sr-row{display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:center;margin:0 0 6px;padding:7px 9px;border-radius:4px;background:linear-gradient(#4a3220,#3d2a19);box-shadow:inset 0 0 0 1px #d4b07a33}
#lrStorage .lr-sr-row:last-child{margin-bottom:0}
#lrStorage .lr-sr-rart{position:relative;display:grid;place-items:center;width:44px;height:44px;border-radius:3px;background:#24170caa;box-shadow:inset 0 0 0 1px #d4b07a33}
#lrStorage .lr-sr-rart .sv-icon{width:34px;height:34px;filter:grayscale(.55) brightness(.9)}
#lrStorage .lr-sr-rart .lr-sr-lock{position:absolute;right:-5px;bottom:-5px}
#lrStorage .lr-sr-rname{display:block;margin-bottom:5px;font:700 14px/1.2 ${FONT};color:#fff2cc}
#lrStorage .lr-sr-row.lr-sr-close{box-shadow:inset 0 0 0 1px #ffbd6688}
#lrStorage .lr-sr-row.lr-sr-close .lr-sr-rname::after{content:'almost!';margin-left:7px;padding:1px 6px;border-radius:8px;background:#ffbd66;color:#2a1b0e;font:800 10px/1.4 ${FONT};vertical-align:2px}
#lrStorage .lr-sr-banner{display:none;align-items:center;min-height:42px;box-sizing:border-box;gap:8px;padding:8px 12px;border-radius:4px;background:linear-gradient(#ffe3a6,#ffbd66);color:#2a1b0e;font:800 14px/1.2 ${FONT};box-shadow:0 0 0 2px #3e2a17,0 0 18px #ffbd66aa}
#lrStorage[data-mode=research] .lr-sr-banner{display:flex;visibility:hidden} /* space kept so the panel does not jump */
#lrStorage .lr-sr-banner.show{display:flex;visibility:visible;animation:lrSrGlow 1.6s ease-out}
#lrStorage .lr-sr-banner.lr-sr-soft{background:linear-gradient(#5d4129,#4a3220);color:#fff2cc;font-weight:700;box-shadow:0 0 0 2px #3e2a17,inset 0 0 0 1px #ffbd6688;animation:none}
#lrStorage .lr-sr-done{grid-column:1/-1;margin:6px 2px 2px;font:800 16px/1.3 ${FONT};color:#ffcf9a}
#lrStorage[data-done] .lr-sr-rhint,#lrStorage[data-done] .lr-sr-slabel{display:none}
#lrStorage[data-done] .lr-sr-study{width:auto;min-width:300px}
#lrStorage[data-done] .lr-sr-tiles{display:block}
#lrStorage[data-done] .lr-sr-banner:not(.show){display:none}
#lrStorage .lr-sr-banner .sv-icon{width:26px;height:26px}
@keyframes lrSrGlow{0%{transform:scale(.96);box-shadow:0 0 0 2px #3e2a17,0 0 0 #ffbd6600}30%{transform:scale(1.02);box-shadow:0 0 0 2px #3e2a17,0 0 28px #ffe3a6}100%{transform:none;box-shadow:0 0 0 2px #3e2a17,0 0 18px #ffbd66aa}}
.lr-sr-lock{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#3e2a17;box-shadow:0 0 0 1.5px #ffcf9a,0 1px 3px #000a}
.lr-sr-lock svg{display:block;width:15px;height:15px}
/* craft list in #inventory */
#inventory .sv-rlist{display:flex;flex-direction:column}
#inventory .sv-recipe[data-locked]{order:1;pointer-events:none;cursor:default;opacity:1!important;background:linear-gradient(#3f2b1a,#33231a);box-shadow:inset 0 0 0 1px #d4b07a22}
#inventory .sv-recipe[data-locked] .sv-rart{position:relative}
#inventory .sv-recipe[data-locked] .sv-rart .sv-icon{filter:grayscale(1) brightness(.75);opacity:.6}
#inventory .sv-recipe[data-locked] .sv-rname{color:#d9c9a6}
#inventory .sv-recipe[data-locked] .sv-reqs{opacity:.5}
#inventory .sv-recipe[data-locked] .sv-why{display:none}
#inventory .sv-recipe .lr-sr-lock{position:absolute;right:-6px;bottom:-6px}
#inventory .sv-recipe .lr-sr-needs{display:block;margin-top:4px;font:700 12px/1.2 ${FONT};color:#ffcf9a}
#inventory .sv-recipe.lr-sr-first{position:relative;margin-top:30px}
#inventory .sv-recipe.lr-sr-first::before{content:'Discover at a Tinker\\2019s Desk';position:absolute;left:2px;top:-22px;width:max-content;white-space:nowrap;font:800 11px/1 ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:#d9c9a6}
#inventory .sv-recipe.lr-sr-fresh{animation:lrSrFresh 2.4s ease-out}
#inventory .lr-sr-more{display:block;width:100%;margin:0 0 8px;padding:6px 8px;border:0;border-radius:4px;background:#24170caa;box-shadow:inset 0 0 0 1px #ffbd6655;color:#ffcf9a;font:700 12px/1.2 ${FONT};text-align:left;letter-spacing:.2px;text-transform:none;cursor:pointer;transform:none}
#inventory .lr-sr-more:hover{box-shadow:inset 0 0 0 1px #ffe3a6}
#inventory .sv-recipe.lr-sr-beckon{animation:lrSrBeckon 2.6s ease-in-out infinite}
@keyframes lrSrBeckon{0%,100%{box-shadow:inset 0 0 0 1px #d4b07a44}50%{box-shadow:inset 0 0 0 1px #ffbd66,0 0 10px #ffbd6688}}
body.lr-sr-open .tools.sv-hotbar{visibility:hidden}
@keyframes lrSrFresh{0%,30%{box-shadow:inset 0 0 0 2px #ffe3a6,0 0 16px #ffbd66}100%{box-shadow:inset 0 0 0 1px #d4b07a44}}
@media(max-width:700px){#lrStorage .lr-sr-body{flex-direction:column}#lrStorage .lr-sr-next,#lrStorage .lr-sr-study{width:auto;max-height:none;overflow:visible}
  #lrStorage .lr-sr-tiles{grid-template-columns:repeat(auto-fill,minmax(84px,96px))}}
@media(max-width:700px),(max-height:600px){#lrStorage .lr-sr-cgrid{grid-template-columns:repeat(6,44px)}#lrStorage .lr-sr-grid{grid-template-columns:repeat(7,44px)}#lrStorage .lr-sr-hotrow{grid-template-columns:repeat(${HOTBAR_SIZE},44px)}
  #lrStorage button.sv-slot{width:44px;height:44px}#lrStorage .sv-slot .sv-art{inset:6px}}
@media(prefers-reduced-motion:reduce){#lrStorage *,#inventory .sv-recipe{animation:none!important;transition:none!important}}
`;

function ensureStyle() {
  let st = document.getElementById('lr-sr-style');
  if (!st) { st = document.createElement('style'); st.id = 'lr-sr-style'; document.head.append(st); }
  if (st.textContent !== CSS) st.textContent = CSS;
}

export function createStorageUI(api) {
  const ctx = api.ctx;
  ensureStyle();
  document.getElementById('lrStorage')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'lrStorage'; dlg.className = 'lr-sr';
  let chestSlots = '', bagSlots = '', hotSlots = '';
  for (let i = 0; i < CHEST; i++) chestSlots += `<button type="button" class="sv-slot" data-chest="${i}">${slotInner('')}</button>`;
  for (let i = HOTBAR_SIZE; i < SLOT_COUNT; i++) bagSlots += `<button type="button" class="sv-slot" data-bag="${i}">${slotInner('')}</button>`;
  for (let i = 0; i < HOTBAR_SIZE; i++) hotSlots += `<button type="button" class="sv-slot sv-hot" data-bag="${i}">${slotInner(i + 1)}</button>`;
  dlg.innerHTML = `<div class="lr-sr-wrap" tabindex="-1">
    <div class="lr-sr-head"><span class="lr-sr-hicon"></span><div><h2 class="lr-sr-title"></h2><span class="lr-sr-sub"></span></div>
      <button type="button" class="lr-sr-x" aria-label="Close">✕</button></div>
    <div class="lr-sr-banner" role="status"></div>
    <div class="lr-sr-body">
      <section class="lr-sr-panel lr-sr-chest" aria-label="Crate contents">
        <div class="lr-sr-label"><span>In the crate</span><span class="lr-sr-used"></span></div>
        <div class="lr-sr-cgrid">${chestSlots}</div>
      </section>
      <section class="lr-sr-panel lr-sr-bag" aria-label="Your bag">
        <div class="lr-sr-label"><span>Your backpack</span><button type="button" class="lr-sr-btn lr-sr-putall">Put all in crate</button></div>
        <div class="lr-sr-grid">${bagSlots}</div>
        <div class="lr-sr-rope" aria-hidden="true"></div>
        <div class="lr-sr-hotrow">${hotSlots}</div>
        <p class="lr-sr-hint">Click a stack to move it across. <kbd>Shift</kbd>+click moves half. Put all keeps your hotbar.</p>
      </section>
      <section class="lr-sr-panel lr-sr-study" aria-label="Study an item">
        <div class="lr-sr-label lr-sr-slabel"><span>Study an item</span></div>
        <div class="lr-sr-tiles"></div>
        <p class="lr-sr-hint lr-sr-rhint">Studying uses up one item. A recipe is learned once you have studied everything it needs.</p>
        <div class="lr-sr-label"><span>Studied</span></div>
        <div class="lr-sr-chips lr-sr-seen"></div>
      </section>
      <section class="lr-sr-panel lr-sr-next" aria-label="Recipes to discover">
        <div class="lr-sr-label"><span>Recipes to discover</span></div>
        <div class="lr-sr-list"></div>
      </section>
    </div></div>`;
  document.body.append(dlg);

  const $ = s => dlg.querySelector(s);
  const chestEls = [...dlg.querySelectorAll('[data-chest]')];
  const bagEls = []; dlg.querySelectorAll('[data-bag]').forEach(el => { bagEls[+el.dataset.bag] = el; });
  const head = { icon: $('.lr-sr-hicon'), title: $('.lr-sr-title'), sub: $('.lr-sr-sub'), used: $('.lr-sr-used'), banner: $('.lr-sr-banner'), putAll: $('.lr-sr-putall') };
  const panels = { chest: $('.lr-sr-chest'), bag: $('.lr-sr-bag'), study: $('.lr-sr-study'), next: $('.lr-sr-next') };
  const tilesEl = $('.lr-sr-tiles'), seenEl = $('.lr-sr-seen'), listEl = $('.lr-sr-list');

  let mode = null, tx = 0, tz = 0, isOpen = false, lastRev = -1, prevKnown = null, prevSeen = null, bannerTimer = 0;
  const prevKind = new Array(SLOT_COUNT).fill(null), prevCount = new Int32Array(SLOT_COUNT), prevDur = new Float64Array(SLOT_COUNT);
  let inv = null, invWasOpen = false, invRev = -1, invRow = null, invTable = false;
  let lockedRows = []; // craft-list rows we marked locked (aria-label is re-applied if survival-ui repaints it)
  const timers = new Set(); // craft-list glow timeouts
  const ac = new AbortController(), on = { signal: ac.signal };
  const LOCKED_LABEL = 'Locked — needs research';

  // ---------- painting ----------
  function bagChanged(bag) {
    const s = bag?.slots; if (!s) return false;
    let changed = false;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = s[i], k = x ? x.kind : null, c = x ? x.count : 0, d = x && x.durability !== undefined ? x.durability : -1;
      if (prevKind[i] !== k || prevCount[i] !== c || prevDur[i] !== d) { prevKind[i] = k; prevCount[i] = c; prevDur[i] = d; changed = true; }
    }
    return changed;
  }
  function paintChest() {
    const bag = api.bag(), chest = api.chestAt(tx, tz);
    let used = 0;
    for (let i = 0; i < CHEST; i++) { const s = chest ? chest[i] : null; if (s) used++; paintSlot(chestEls[i], s, slotSig(s), `Crate slot ${i + 1}`); }
    for (let i = 0; i < SLOT_COUNT; i++) { const s = bag?.slots[i] ?? null; paintSlot(bagEls[i], s, slotSig(s), i < HOTBAR_SIZE ? `Hotbar slot ${i + 1}` : `Backpack slot ${i - HOTBAR_SIZE + 1}`); }
    head.used.textContent = `${used} / ${CHEST}`;
    head.sub.textContent = used >= CHEST ? 'Full! Stack things up or place another crate' : used ? 'Your things stay safe here' : 'Empty and ready for your things';
    let any = false; if (bag) for (let i = HOTBAR_SIZE; i < SLOT_COUNT; i++) if (bag.slots[i]) { any = true; break; }
    head.putAll.disabled = !any || used >= CHEST && !canMerge(bag, chest);
  }
  function canMerge(bag, chest) {
    if (!chest) return true;
    for (let i = HOTBAR_SIZE; i < SLOT_COUNT; i++) { const s = bag.slots[i]; if (s && chest.some(c => c && c.kind === s.kind && c.count < (ITEM_INFO[s.kind]?.maxStack ?? 1))) return true; }
    return false;
  }
  function countIn(bag, kind) { let n = 0; if (bag) for (const s of bag.slots) if (s && s.kind === kind) n += s.count; return n; }
  // How to get one of `k`: a recipe output says what to craft it from, a raw material says find one.
  function getHint(k) {
    const r = Object.values(RECIPES).find(x => x.output.kind === k);
    if (!r) return { short: 'Find one first', long: 'Find some ' + itemName(k) + ' first' };
    const cost = Object.entries(r.cost).map(([c, n]) => `${n} ${itemName(c)}`).join(', ');
    return { short: `Craft one first (${cost})`, long: `Craft one first from ${cost}` };
  }
  function paintResearch() {
    const bag = api.bag(), st = api.state, seen = new Set(st.seen), want = api.researchable(), locked = api.locked();
    const total = Object.keys(RECIPES).length, known = total - locked.length;
    head.sub.textContent = locked.length ? `${known} of ${total} recipes known` : `All ${total} recipes known`;
    if (locked.length) delete dlg.dataset.done; else dlg.dataset.done = '1';
    panels.next.hidden = !locked.length;
    // study tiles: every kind the table wants, usable when it is in the bag; ones that unlock something first
    const tiles = want.map(k => {
      const opens = locked.filter(id => Object.keys(RECIPES[id].cost).every(c => seen.has(c) || c === k)).map(id => api.nameOf(id));
      const helps = locked.filter(id => k in RECIPES[id].cost).map(id => api.nameOf(id));
      return { k, have: countIn(bag, k), opens, helps };
    }).sort((a, b) => (b.opens.length > 0) - (a.opens.length > 0));
    tilesEl.innerHTML = !locked.length ? '<p class="lr-sr-done">Bookworm! You know every recipe.</p>'
      : tiles.length ? tiles.map(({ k, have, opens, helps }) => {
        const sub = opens.length ? 'Unlocks ' + opens.join(', ') : helps.length ? 'Helps: ' + helps.join(', ') : '';
        const get = getHint(k);
        return `<button type="button" class="lr-sr-tile${have && opens.length ? ' lr-sr-ready' : ''}" data-study="${esc(k)}"${have ? '' : ' disabled'} title="${esc(have ? 'Study one ' + itemName(k) : get.long)}">
        ${have ? `<b>${have}</b>` : ''}${iconSVG(k)}<span>${esc(itemName(k))}</span><small>${esc(have ? sub : get.short)}</small></button>`;
      }).join('') : '<p class="lr-sr-empty" style="grid-column:1/-1">Nothing left to study right now.</p>';
    seenEl.innerHTML = st.seen.length ? st.seen.map(k => `<span class="lr-sr-chip">${iconSVG(k)}${esc(itemName(k))}</span>`).join('') : '<p class="lr-sr-empty">Nothing yet. Pick an item above!</p>';
    listEl.innerHTML = locked.map(id => {
      const r = RECIPES[id], kinds = Object.keys(r.cost), missing = kinds.filter(k => !seen.has(k));
      const chips = kinds.map(k => seen.has(k) ? `<span class="lr-sr-chip">${CHECK}${esc(itemName(k))}</span>`
        : `<span class="lr-sr-chip lr-sr-need${countIn(bag, k) ? ' lr-sr-have' : ''}">${iconSVG(k)}${esc(itemName(k))}</span>`).join('');
      const almost = missing.length === 1 && kinds.length > 1; // at least one ingredient already studied
      return `<div class="lr-sr-row${almost ? ' lr-sr-close' : ''}"><span class="lr-sr-rart">${iconSVG(r.output.kind)}<span class="lr-sr-lock">${LOCK}</span></span>
        <span><span class="lr-sr-rname">${esc(r.name)}</span><span class="lr-sr-chips">${chips}</span></span></div>`;
    }).join('');
    // celebrate recipes learned while the table is open; a study that unlocks nothing gets a soft note
    const now = Object.keys(RECIPES).filter(id => !locked.includes(id));
    if (prevKnown) {
      const fresh = now.filter(id => !prevKnown.includes(id));
      const studied = prevSeen ? st.seen.filter(k => !prevSeen.includes(k)) : [];
      if (fresh.length) showBanner(`New recipe${fresh.length > 1 ? 's' : ''}: ${fresh.map(id => api.nameOf(id)).join(', ')}! Find ${fresh.length > 1 ? 'them' : 'it'} in your craft list.`, fresh[0]);
      else if (studied.length) {
        const k = studied[0], helps = locked.filter(id => k in RECIPES[id].cost).map(id => api.nameOf(id));
        showBanner(`Studied ${itemName(k)}.${helps.length ? ' One step closer to ' + helps.join(', ') + '.' : ''}`, null, k);
      }
    }
    prevKnown = now; prevSeen = st.seen.slice();
  }
  function showBanner(text, recipe, kind) {
    const icon = recipe ? iconSVG(RECIPES[recipe]?.output.kind ?? recipe) : kind ? iconSVG(kind) : '';
    head.banner.innerHTML = icon + `<span>${esc(text)}</span>`;
    head.banner.classList.toggle('lr-sr-soft', !recipe);
    head.banner.classList.remove('show'); void head.banner.offsetWidth; head.banner.classList.add('show');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => head.banner.classList.remove('show'), 6500);
  }
  function paint() {
    lastRev = api.rev; bagChanged(api.bag());
    if (mode === 'crate') paintChest(); else paintResearch();
  }

  // ---------- open / close ----------
  function open(type, x, z) {
    mode = type === 'research' ? 'research' : 'crate'; tx = x; tz = z;
    dlg.dataset.mode = mode;
    panels.chest.hidden = panels.bag.hidden = mode !== 'crate';
    panels.study.hidden = panels.next.hidden = mode !== 'research';
    head.icon.innerHTML = iconSVG(mode === 'crate' ? 'crate' : 'research');
    head.title.textContent = mode === 'crate' ? 'Crate' : 'Tinker\u2019s Desk';
    head.banner.classList.remove('show'); prevKnown = null; prevSeen = null;
    if (mode !== 'research') { panels.next.hidden = true; delete dlg.dataset.done; }
    for (const el of [...chestEls, ...bagEls]) el._svSig = undefined;
    paint();
    if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
    isOpen = true; document.body.classList.add('lr-sr-open');
    try { $('.lr-sr-wrap').focus({ preventScroll: true }); } catch {}
  }
  function close() { if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } } else onClosed(); }
  function onClosed() {
    if (!isOpen) return;
    isOpen = false; mode = null; document.body.classList.remove('lr-sr-open');
    if (ctx.running) ctx.requestLock?.();
  }
  dlg.addEventListener('close', onClosed, on);
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); }, on);
  dlg.addEventListener('keydown', e => { if ((e.code === 'KeyE' || e.code === 'Tab') && !e.repeat) { e.preventDefault(); e.stopPropagation(); close(); } }, on);
  dlg.addEventListener('wheel', e => e.stopPropagation(), { passive: true, signal: ac.signal });
  dlg.addEventListener('click', e => {
    if (e.target === dlg) { close(); return; }
    const t = e.target.closest?.('button'); if (!t) return;
    // A mouse click leaves focus on the button, and Space/Enter would then click it again. Hand focus back
    // to the panel after pointer clicks; keyboard activation (detail 0) keeps its focus.
    if (e.detail > 0) { t.blur(); try { $('.lr-sr-wrap').focus({ preventScroll: true }); } catch {} }
    if (t.classList.contains('lr-sr-x')) { close(); return; }
    if (t.classList.contains('lr-sr-putall')) { api.send({ kind: 'storage.putAll', x: tx, z: tz }); paint(); return; }
    if (t.dataset.study) { study(t.dataset.study); return; }
    const half = e.shiftKey;
    if (t.dataset.chest !== undefined) {
      const i = +t.dataset.chest, s = api.chestAt(tx, tz)?.[i]; if (!s) return;
      const a = { kind: 'storage.take', x: tx, z: tz, from: i, expect: { kind: s.kind, count: s.count } };
      if (half && s.count > 1) a.amount = Math.ceil(s.count / 2);
      api.send(a); pop(t); paint(); return;
    }
    if (t.dataset.bag !== undefined) {
      const i = +t.dataset.bag, s = api.bag()?.slots[i]; if (!s) return;
      const a = { kind: 'storage.put', x: tx, z: tz, from: i, expect: { kind: s.kind, count: s.count } };
      if (half && s.count > 1) a.amount = Math.ceil(s.count / 2);
      api.send(a); pop(t); paint();
    }
  }, on);
  dlg.addEventListener('contextmenu', e => { if (e.target.closest?.('.sv-slot')) e.preventDefault(); }, on);
  function pop(el) { el.classList.remove('lr-sr-pop'); void el.offsetWidth; el.classList.add('lr-sr-pop'); }
  function study(kind) {
    const bag = api.bag(); if (!bag) return;
    let slot = -1; // prefer a backpack stack, from the back, so the hotbar stays as it is
    for (let i = SLOT_COUNT - 1; i >= 0 && slot < 0; i--) if (bag.slots[i]?.kind === kind && i >= HOTBAR_SIZE) slot = i;
    for (let i = 0; i < HOTBAR_SIZE && slot < 0; i++) if (bag.slots[i]?.kind === kind) slot = i;
    if (slot < 0) return;
    api.send({ kind: 'storage.research', x: tx, z: tz, slot, expect: { kind } });
    paint();
  }

  // ---------- craft list annotation (#inventory) ----------
  const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  const setClass = (el, c, on) => { if (el.classList.contains(c) !== on) el.classList.toggle(c, on); };
  function annotate() {
    const rows = inv.querySelectorAll('.sv-recipe[data-recipe]'), seen = new Set(api.state.seen), fresh = api.takeFresh();
    const beckon = api.locked().length > 0 && !api.hasTable();
    let first = null;
    lockedRows = [];
    rows.forEach(el => {
      const id = el.dataset.recipe, r = RECIPES[id], locked = !!r && !api.isLearned(id);
      const body = el.querySelector('.sv-rbody'), art = el.querySelector('.sv-rart');
      let badge = el.querySelector('.lr-sr-lock'), needs = el.querySelector('.lr-sr-needs');
      setClass(el, 'lr-sr-beckon', beckon && id === 'research');
      if (!locked) {
        if (el.dataset.locked) unlockRow(el);
        setClass(el, 'lr-sr-first', false);
        badge?.remove(); needs?.remove();
        if (fresh.includes(id)) {
          el.classList.remove('lr-sr-fresh'); void el.offsetWidth; el.classList.add('lr-sr-fresh');
          const t = setTimeout(() => { timers.delete(t); el.classList.remove('lr-sr-fresh'); }, 2500); timers.add(t);
        }
        return;
      }
      const miss = Object.keys(r.cost).filter(k => !seen.has(k)).map(k => itemName(k));
      const text = miss.length ? 'Study ' + miss.join(' + ') : 'Study at a Tinker\u2019s Desk';
      if (!el.dataset.locked) { el.dataset.locked = '1'; el.dataset.srAria = el.getAttribute('aria-label') ?? ''; }
      setAttr(el, 'title', 'Needs research: ' + (miss.join(', ') || 'visit a Tinker\u2019s Desk'));
      setAttr(el, 'tabindex', '-1'); setAttr(el, 'aria-label', LOCKED_LABEL); lockedRows.push(el);
      setClass(el, 'lr-sr-first', !first); first ??= el;
      if (!badge && art) { badge = document.createElement('span'); badge.className = 'lr-sr-lock'; badge.innerHTML = LOCK; art.append(badge); }
      if (!needs && body) { needs = document.createElement('span'); needs.className = 'lr-sr-needs'; body.append(needs); }
      if (needs && needs.textContent !== text) needs.textContent = text;
    });
    // "N more recipes to discover" at the top of the craft list (outside .sv-rlist, which survival-ui owns)
    const list = inv.querySelector('.sv-rlist'), box = list?.parentElement;
    let more = box?.querySelector(':scope>.lr-sr-more');
    if (!lockedRows.length || !box) { more?.remove(); return; }
    if (!more) {
      more = document.createElement('button'); more.type = 'button'; more.className = 'lr-sr-more';
      more.addEventListener('click', () => { box.querySelector('.sv-recipe[data-locked]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
      box.insertBefore(more, list);
    }
    const n = lockedRows.length, label = `${n} more recipe${n > 1 ? 's' : ''} to discover ↓`;
    if (more.textContent !== label) more.textContent = label;
  }
  function unlockRow(el) {
    const aria = el.dataset.srAria;
    delete el.dataset.locked; delete el.dataset.srAria;
    el.removeAttribute('title'); el.removeAttribute('tabindex');
    if (aria) el.setAttribute('aria-label', aria); else el.removeAttribute('aria-label');
  }
  function unannotate() {
    const host = inv?.isConnected ? inv : document.getElementById('inventory'); if (!host) return;
    host.querySelectorAll('.sv-recipe').forEach(el => {
      if (el.dataset.locked) unlockRow(el);
      el.querySelector('.lr-sr-lock')?.remove(); el.querySelector('.lr-sr-needs')?.remove();
      el.classList.remove('lr-sr-first', 'lr-sr-fresh', 'lr-sr-beckon');
    });
    host.querySelectorAll('.lr-sr-more').forEach(el => el.remove());
    lockedRows = [];
  }

  // ---------- per frame ----------
  function update() {
    if (isOpen) {
      const want = mode === 'crate' ? 'crate' : 'research', p = ctx.physics;
      if (api.decorAt(tx, tz) !== want || (p && Math.hypot(p.x - tx * 2, p.z - tz * 2) > api.reach + .8)) { close(); }
      else if (api.rev !== lastRev || bagChanged(api.bag())) { lastRev = api.rev; if (mode === 'crate') paintChest(); else paintResearch(); }
    }
    if (!inv || !inv.isConnected) inv = document.getElementById('inventory');
    const invOpen = !!inv && inv.open;
    if (invOpen) { // re-annotate only when something it shows changed (or survival-ui rebuilt the rows)
      const row = inv.querySelector('.sv-recipe'), table = api.hasTable();
      if (!invWasOpen || invRev !== api.rev || invRow !== row || invTable !== table) { invRev = api.rev; invRow = row; invTable = table; annotate(); }
    }
    if (invOpen) for (let i = 0; i < lockedRows.length; i++) if (lockedRows[i].getAttribute('aria-label') !== LOCKED_LABEL) lockedRows[i].setAttribute('aria-label', LOCKED_LABEL);
    invWasOpen = invOpen;
  }

  return {
    open, close, update,
    openInfo: () => (isOpen ? { mode, x: tx, z: tz } : null),
    destroy() {
      clearTimeout(bannerTimer); for (const t of timers) clearTimeout(t); timers.clear();
      isOpen = false; mode = null; ac.abort(); document.body.classList.remove('lr-sr-open'); // no onClosed -> no requestLock while the game is disposing
      if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
      dlg.remove(); unannotate();
      document.getElementById('lr-sr-style')?.remove();
    },
  };
}
