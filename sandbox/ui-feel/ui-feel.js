// Little Raft "game feel" layer for the DOM HUD.
// Drop-in module: copy to dist/ui-feel.js. No imports, injects its own <style id="ui-feel-style">.
//
// What it adds on top of dist/survival-ui.js (which it never edits):
//   - pickup: item icons fly from the crosshair (or a given point) into the slot that received them; the slot
//     keeps showing its old count (and, if it was empty, no icon) until the icon lands, then bumps
//   - hotbar: a sliding selection cursor + icon hop and paint-time count bumps, ONLY when the hotbar has no
//     cursor of its own (survival-ui sv3 ships .sv-cursor and sv-bumpA/B: then ui-feel leaves both to it)
//   - toasts (optional, `toasts:false` turns them off): pooled stack with merging ("Wood +2" -> "Wood +6")
//   - stat bars: transform-only fill with a delayed lag trail on damage and a lead ghost on heal
//   - crosshair: hover / charge ring / hit markers, built inside the existing #crosshair
//   - inventory dialog open/close and button press states (pure CSS, see CSS below)
//
// Rules: anything that MOVES (fly, bounce, slide, shake, fill, trail) animates transform/opacity only.
// Exceptions, all on small boxes and on discrete state changes rather than continuous motion:
// stroke-dashoffset on the 40px charge arc; box-shadow/background/filter transitions on hover/press of
// slots, recipes and buttons and on the reticle ring/dot; the inventory ::backdrop background-color fade.
// Layout is read only in ResizeObserver callbacks or once per explicit action, never in a per-frame path;
// nodes are pooled; prefers-reduced-motion swaps every movement for a short fade.
// Every public method is guarded: it logs and returns false instead of throwing into the caller.

const INST_KEY = '__littleRaftUIFeel';
const BACK = 'cubic-bezier(.34,1.56,.64,1)';
const OUT = 'cubic-bezier(.22,1,.36,1)';
const IN_OUT = 'cubic-bezier(.65,0,.35,1)';
const PSEUDO = typeof KeyframeEffect !== 'undefined' && 'pseudoElement' in KeyframeEffect.prototype;

const STYLE = `
:root{--uf-cream:#fff2cc;--uf-gold:#ffe3a6;--uf-amber:#ffbd66;--uf-wood:#3a2716;--uf-wood-lt:#c9a66b;--uf-ink:#24170c;
  --uf-teal:#9fe0d6;--uf-red:#e06a4a;--uf-green:#8fd36a;--uf-back:${BACK};--uf-out:${OUT};
  --uf-font:var(--ui-font,"Bahnschrift","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif)}
#uf-layer{position:fixed;inset:0;pointer-events:none;z-index:6;contain:strict}
#uf-layer>*{position:absolute;left:0;top:0}

/* ---- hotbar cursor (slides between cached slot positions) ---- */
.uf-cursor{width:var(--uf-cw,64px);height:var(--uf-ch,64px);opacity:0;transition:transform .22s var(--uf-back),opacity .15s;will-change:transform}
.uf-cursor.on{opacity:1}
.uf-cursor>i{position:absolute;inset:0;border-radius:5px;
  box-shadow:inset 0 0 0 2px var(--uf-gold),inset 0 0 0 3px #3e2a1799,0 0 0 1px #3e2a17,0 0 12px 1px #ffd58a88}
.uf-cursor>i::before,.uf-cursor>i::after{content:"";position:absolute;left:50%;width:10px;height:5px;margin-left:-5px;background:var(--uf-gold);
  clip-path:polygon(0 0,100% 0,50% 100%);filter:drop-shadow(0 1px 0 #3e2a17)}
.uf-cursor>i::before{top:-7px}
.uf-cursor>i::after{bottom:-7px;transform:scaleY(-1)}
.tools.sv-hotbar.uf-has-cursor>button.sv-slot.sv-sel{box-shadow:inset 0 0 0 1px #ffe3a655,0 0 0 1px #3e2a17}
.tools.sv-hotbar .sv-count{transform-origin:100% 100%}
/* Everything WAAPI animates carries a static 2D identity transform: a transform appearing/disappearing changes the
   containing block and costs a layout; a 2D one does not promote a layer (the animation promotes while it runs). */
.sv-slot .sv-art,.sv-slot .sv-count,.uf-fly,.uf-ring>i,.uf-cursor>i,.uf-x-hit,.uf-toast>.uf-tn,.uf-stat>.uf-si,
#inventory .sv-recipe .sv-rart{transform:translate(0)}

/* ---- a slot waiting for its flying icon: show the old count (and no icon if it was empty) until it lands ---- */
.sv-slot.uf-wait .sv-count[data-uf-old]{visibility:hidden}
.sv-slot.uf-wait .sv-count[data-uf-old]::after{content:attr(data-uf-old);visibility:visible;position:absolute;right:0;bottom:0}
.sv-slot.uf-wait.uf-fresh .sv-art{opacity:0}
.sv-slot.uf-wait.sv-bumpA .sv-art,.sv-slot.uf-wait.sv-bumpB .sv-art{animation:none}

/* ---- slot landing ring / flash ---- */
.uf-ring{width:var(--uf-cw,64px);height:var(--uf-ch,64px)}
.uf-ring>i{position:absolute;inset:0;opacity:0;border-radius:6px;box-shadow:0 0 0 2px var(--uf-gold),0 0 14px 2px #ffd58acc,inset 0 0 14px #ffe3a688}

/* ---- flying pickup icon ---- */
.uf-fly{width:44px;height:44px;margin:-22px 0 0 -22px;opacity:0}
.uf-fly>.uf-art{position:absolute;inset:0;display:block;filter:drop-shadow(0 2px 2px #0009) drop-shadow(0 0 6px #fff2cc66)}
.uf-fly>.uf-art>svg,.uf-fly>.uf-art>img{display:block;width:100%;height:100%;object-fit:contain;scale:none;filter:none}
.uf-fly.uf-gen>.uf-art{filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 5px #fff2cc) drop-shadow(0 2px 3px #000b)}
.uf-fly>b{position:absolute;left:34px;top:-4px;font:800 15px/1 var(--uf-font);color:var(--uf-gold);
  text-shadow:0 1px 0 #3e2a17,0 0 3px #000,0 0 6px #000a;white-space:nowrap}

/* ---- toast stack ---- */
#uf-toasts{position:fixed;inset:auto 20px 132px auto;width:230px;height:0;margin:0;padding:0;border:0;background:none;overflow:visible;color:inherit;pointer-events:none;z-index:5}
#uf-toasts::backdrop{display:none}
.uf-toast{position:absolute;right:0;bottom:0;display:flex;align-items:center;gap:8px;height:34px;min-width:180px;max-width:230px;padding:0 12px 0 8px;
  border-radius:5px;background:linear-gradient(90deg,#1a2226f2,#0e1417e6);color:#f4efe2;
  box-shadow:inset 0 0 0 1px #ffffff1c,0 4px 10px #0006;
  font:600 13px/1 var(--uf-font);white-space:nowrap;opacity:0}
.uf-toast::before{content:"";position:absolute;left:0;top:5px;bottom:5px;width:3px;border-radius:0 2px 2px 0;background:var(--uf-acc,var(--uf-wood-lt))}
.uf-toast>.uf-ti{flex:none;width:24px;height:24px;display:grid;place-items:center;filter:drop-shadow(0 1px 1px #0008)}
.uf-toast>.uf-ti svg{width:24px;height:24px;display:block}
.uf-toast>.uf-ti:empty{width:6px}
.uf-toast>.uf-tt{overflow:hidden;text-overflow:ellipsis}
.uf-toast>.uf-tg{position:absolute;inset:0;border-radius:inherit;opacity:0;background:linear-gradient(90deg,#ffe3a640,#ffe3a610);box-shadow:inset 0 0 0 1px #ffe3a6}
.uf-toast>.uf-tn{margin-left:auto;padding-left:10px;color:var(--uf-gold);font-weight:800;font-variant-numeric:tabular-nums;display:inline-block}
.uf-toast[data-kind=loot]{--uf-acc:var(--uf-amber)}
.uf-toast[data-kind=craft]{--uf-acc:var(--uf-gold)}
.uf-toast[data-kind=craft]>.uf-tt{color:var(--uf-gold)}
.uf-toast[data-kind=build]{--uf-acc:var(--uf-teal)}
.uf-toast[data-kind=full],.uf-toast[data-kind=warn]{--uf-acc:var(--uf-red)}
.uf-toast[data-kind=full]>.uf-tt,.uf-toast[data-kind=warn]>.uf-tt{color:#ffc2ad}

/* ---- stat bars ---- */
.uf-stats{position:fixed;right:20px;bottom:22px;display:grid;gap:7px;padding:9px 11px 10px;border-radius:6px;z-index:2;pointer-events:none;
  background:linear-gradient(180deg,#1a2226e6,#0e1417ee);box-shadow:inset 0 0 0 1px #ffffff17,0 4px 12px #0005}
.uf-stat{display:grid;grid-template-columns:20px 150px;align-items:center;gap:8px}
.uf-stat>.uf-si{width:20px;height:20px;display:grid;place-items:center;color:var(--uf-tone);filter:drop-shadow(0 1px 0 #000a)}
.uf-stat>.uf-si svg{width:18px;height:18px;display:block}
.uf-track{position:relative;height:10px;border-radius:2px;overflow:hidden;background:#140c06;
  box-shadow:inset 0 1px 2px #000c,0 0 0 1px #c9a66b55;contain:strict}
.uf-track>i{position:absolute;inset:0;transform-origin:0 50%}
.uf-track>.uf-trail{background:#ffd9a0}
.uf-track.uf-up>.uf-trail{background:#d9f7b4;opacity:.75}
.uf-track>.uf-fill{background:linear-gradient(180deg,color-mix(in srgb,var(--uf-tone) 70%,#fff) 0 30%,var(--uf-tone) 30% 70%,color-mix(in srgb,var(--uf-tone) 70%,#000) 70%)}
.uf-track>.uf-flash{background:#fff;opacity:0}
.uf-track::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(90deg,transparent 0 calc(10% - 1px),#140c06cc calc(10% - 1px) 10%)}
.uf-stat[data-tone=health]{--uf-tone:#e2644a}
.uf-stat[data-tone=food]{--uf-tone:#f0a848}
.uf-stat[data-tone=water]{--uf-tone:#5fc3dc}
.uf-stat[data-tone=hook]{--uf-tone:#8fd36a}
.uf-stat.uf-low>.uf-track>.uf-fill{animation:uf-low 1s ease-in-out infinite alternate}
.uf-stat.uf-low>.uf-si{animation:uf-low 1s ease-in-out infinite alternate}
@keyframes uf-low{to{opacity:.45}}

/* ---- crosshair (built inside the existing #crosshair) ---- */
#crosshair.uf-xh{width:40px;height:40px;margin:0;border:0;border-radius:0;background:none!important;filter:none;opacity:1;transform:translate(-50%,-50%)}
#crosshair.uf-xh::before,#crosshair.uf-xh::after{display:none}
#crosshair.uf-xh>i:not(.uf-x){display:none}
/* dist/style.css styles every "#crosshair i" as an 8px dot: reset it for our parts */
#crosshair.uf-xh>.uf-x{display:block;position:absolute;left:50%;top:50%;margin:0;padding:0;background:none;box-shadow:none;border:0;border-radius:0;pointer-events:none}
#crosshair.uf-xh>.uf-x-ring{width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
  box-shadow:inset 0 0 0 1.5px #fff8e8d9,0 0 0 1px #0004,inset 0 0 0 2.5px #0003;
  transition:transform .16s var(--uf-back),box-shadow .12s}
#crosshair.uf-xh>.uf-x-dot{width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:#fff8e8;box-shadow:0 0 0 1px #0006;
  transition:transform .16s var(--uf-back),background .12s}
#crosshair.uf-xh>.uf-x-arc{width:40px;height:40px;margin:-20px 0 0 -20px;overflow:visible;opacity:0;transition:opacity .1s}
.uf-x-arc circle{fill:none;stroke-width:3}
.uf-x-arc .bg{stroke:#0005}
.uf-x-arc .fg{stroke:var(--uf-amber);stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:100;transform:rotate(-90deg);transform-origin:20px 20px}
#crosshair.uf-xh>.uf-x-hit{width:34px;height:34px;margin:-17px 0 0 -17px;opacity:0}
.uf-x-hit>b{position:absolute;left:50%;top:50%;width:2px;height:8px;margin:-4px 0 0 -1px;border-radius:1px;background:var(--uf-cream);box-shadow:0 0 0 1px #0007}
.uf-x-hit>b:nth-child(1){transform:rotate(45deg) translateY(-14px)}
.uf-x-hit>b:nth-child(2){transform:rotate(135deg) translateY(-14px)}
.uf-x-hit>b:nth-child(3){transform:rotate(225deg) translateY(-14px)}
.uf-x-hit>b:nth-child(4){transform:rotate(315deg) translateY(-14px)}
.uf-x-hit.gold>b{background:var(--uf-gold)}
.uf-x-hit.deny>b{background:var(--uf-red)}
#crosshair.uf-hover>.uf-x-ring{transform:scale(1.32);box-shadow:inset 0 0 0 2px var(--uf-gold),0 0 0 1px #3e2a1799,0 0 8px #ffd58a99}
#crosshair.uf-hover>.uf-x-dot{transform:scale(1.5);background:var(--uf-gold)}
#crosshair.uf-charging>.uf-x-arc{opacity:1}
#crosshair.uf-charging>.uf-x-ring{transform:scale(.82)}
#crosshair.uf-full .uf-x-arc .fg{stroke:var(--uf-gold);filter:drop-shadow(0 0 3px #ffd58a)}

/* ---- inventory dialog open/close (CSS only; display/overlay allow-discrete keeps it in the top layer while it fades) ---- */
#inventory.sv-inv{opacity:1;transform:none;
  transition:opacity .16s ease-out,transform .22s var(--uf-back),overlay .16s allow-discrete,display .16s allow-discrete}
#inventory.sv-inv:not([open]){opacity:0;transform:translateY(10px) scale(.97);transition-duration:.12s,.12s,.12s,.12s;transition-timing-function:ease-in}
#inventory.sv-inv::backdrop{transition:background-color .18s,overlay .18s allow-discrete,display .18s allow-discrete}
#inventory.sv-inv:not([open])::backdrop{background-color:transparent}
#inventory.sv-inv .sv-craft,#inventory.sv-inv .sv-bag{transition:transform .26s var(--uf-out),opacity .2s}
@starting-style{
  #inventory.sv-inv[open]{opacity:0;transform:translateY(14px) scale(.96)}
  #inventory.sv-inv[open]::backdrop{background-color:transparent}
  #inventory.sv-inv[open] .sv-craft{transform:translateX(-14px);opacity:0}
  #inventory.sv-inv[open] .sv-bag{transform:translateX(14px);opacity:0}
}

/* ---- press states ---- */
.tools.sv-hotbar>button.sv-slot,#inventory.sv-inv button.sv-slot{transition:transform .18s var(--uf-back),box-shadow .08s,background .08s}
.tools.sv-hotbar>button.sv-slot:active,#inventory.sv-inv button.sv-slot:active:not(.sv-dragging,.sv-src,.sv-over){transform:translateY(2px) scale(.88);filter:brightness(.7);transition-duration:.05s;
  box-shadow:inset 0 0 0 2px #ffe3a6b0,inset 0 5px 10px #000c,0 0 0 1px #0009}
#inventory .sv-recipe{position:relative;transition:transform .16s var(--uf-back),background .08s,box-shadow .08s}
#inventory .sv-recipe::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;box-shadow:inset 0 0 0 2px #ffe3a6,0 0 16px #ffd58aaa;background:#ffe3a61a}
#inventory .sv-recipe .sv-rart{transition:transform .18s var(--uf-back)}
#inventory .sv-recipe:hover:not(:disabled) .sv-rart{transform:scale(1.08) rotate(-3deg)}
#inventory .sv-recipe:active:not(:disabled){transform:translateY(1px) scale(.98);filter:brightness(.85);box-shadow:inset 0 0 0 1px #ffe3a6,inset 0 2px 6px #000a;transition-duration:.04s}
#inventory .sv-craftbtn{transition:transform .14s var(--uf-back),filter .1s}
#inventory .sv-craftbtn:active:not([aria-disabled="true"]){transform:translateY(1px) scale(.98);filter:brightness(.9);transition-duration:.04s}
.primary,.secondary,.header-right button,#repairButton,#copyRoom,.close{transition:transform .14s var(--uf-back),filter .1s,box-shadow .1s}
.primary:active{transform:translateY(2px);filter:brightness(.95);box-shadow:0 0 0 1px #6f4a1c,inset 0 1px 0 rgba(255,245,215,.5),0 1px 0 #6f4a1c,0 3px 8px rgba(0,0,0,.3);transition-duration:.04s}
.secondary:active,.header-right button:active,#repairButton:active,#copyRoom:active{transform:translateY(1px) scale(.98);filter:brightness(.9);transition-duration:.04s}
.close:active{transform:scale(.88);transition-duration:.04s}

/* ---- reduced motion: the JS mirrors this with html.uf-rm ---- */
html.uf-rm .uf-cursor,html.uf-rm .uf-x-ring,html.uf-rm .uf-x-dot{transition-duration:0s}
html.uf-rm #inventory.sv-inv,html.uf-rm #inventory.sv-inv:not([open]){transform:none;transition-property:opacity,overlay,display;transition-duration:.1s}
html.uf-rm #inventory.sv-inv .sv-craft,html.uf-rm #inventory.sv-inv .sv-bag{transition:none}
html.uf-rm .tools.sv-hotbar>button.sv-slot:active,html.uf-rm #inventory.sv-inv button.sv-slot:active,html.uf-rm #inventory .sv-recipe:active:not(:disabled),html.uf-rm #inventory .sv-craftbtn:active{transform:none}
html.uf-rm #inventory .sv-recipe:hover:not(:disabled) .sv-rart{transform:none}
html.uf-rm .uf-stat.uf-low>.uf-track>.uf-fill,html.uf-rm .uf-stat.uf-low>.uf-si{animation:none}
@starting-style{html.uf-rm #inventory.sv-inv[open]{transform:none}html.uf-rm #inventory.sv-inv[open] .sv-craft,html.uf-rm #inventory.sv-inv[open] .sv-bag{transform:none;opacity:1}}

/* Toast placement is chosen in JS (phone width, or where an open modal dialog leaves room):
   uf-top = top centre, newest on top; uf-bot = bottom centre, newest at the bottom; neither = bottom right. */
#uf-toasts.uf-top{inset:calc(env(safe-area-inset-top,0px) + var(--uf-ty,12px)) auto auto 50%;width:0}
#uf-toasts.uf-bot{inset:auto auto var(--uf-ty,12px) 50%;width:0}
#uf-toasts:is(.uf-top,.uf-bot)>.uf-toast{left:0;right:auto;translate:-50% 0;height:30px;min-width:0;width:min(64vw,250px);max-width:none;
  padding:0 11px 0 7px;gap:6px;border-radius:6px;font-size:12px}
#uf-toasts.uf-top>.uf-toast{top:0;bottom:auto}
#uf-toasts:is(.uf-top,.uf-bot)>.uf-toast>.uf-ti,#uf-toasts:is(.uf-top,.uf-bot)>.uf-toast>.uf-ti svg{width:20px;height:20px}
#uf-toasts:is(.uf-top,.uf-bot)>.uf-toast>.uf-tn{padding-left:8px}
@media(max-width:760px){
  /* phone: the stats become one strip sitting on the hotbar */
  .uf-stats{left:var(--uf-hbx,10px);right:auto;width:var(--uf-hbw,auto);top:auto;bottom:calc(var(--uf-hbt,84px) + 12px);box-sizing:border-box;
    grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:10px;padding:5px 9px;border-radius:6px}
  .uf-stat{grid-template-columns:14px minmax(0,1fr);gap:5px}
  .uf-stat>.uf-si{width:14px;height:14px}
  .uf-stat>.uf-si svg{width:14px;height:14px}
  .uf-track{height:7px}
}
`;

const STAT_ICONS = {
  health: '<svg viewBox="0 0 24 24"><path fill="currentColor" stroke="#2a1b0e" stroke-width="1.6" d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
  food: '<svg viewBox="0 0 24 24"><path fill="currentColor" stroke="#2a1b0e" stroke-width="1.6" stroke-linejoin="round" d="M3 12c3-4.5 8-5.5 12.5-2.5L20 6.5v11l-4.5-3C11 17.5 6 16.5 3 12z"/><circle cx="7.4" cy="11.3" r="1.1" fill="#2a1b0e"/></svg>',
  water: '<svg viewBox="0 0 24 24"><path fill="currentColor" stroke="#2a1b0e" stroke-width="1.6" d="M12 3.2S5.8 10.4 5.8 14.6a6.2 6.2 0 0 0 12.4 0C18.2 10.4 12 3.2 12 3.2z"/><path d="M9.2 14.4a3 3 0 0 0 2.6 3" fill="none" stroke="#fff8" stroke-width="1.5" stroke-linecap="round"/></svg>',
  hook: '<svg viewBox="0 0 24 24"><path fill="none" stroke="#2a1b0e" stroke-width="4.4" stroke-linecap="round" d="M14 3v9.5a5 5 0 0 1-10 0V11"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M14 3v9.5a5 5 0 0 1-10 0V11"/></svg>',
};

export function createUIFeel({
  root = document,
  getBag = null,            // () => Bag-like {slots, selectedIndex}; resolves which slot an item lands in
  iconHTML = null,          // kind => '<svg ...>' (survival-ui's iconSVG); falls back to cloning the slot art
  hotbarSize = 8,
  reducedMotion = 'auto',   // 'auto' | true | false
  toasts = true,            // false: no toast stack at all (the host game has its own feed); toast() is then a no-op
  hotbarCursor = 'auto',    // 'auto': own selection cursor + paint bumps only if the hotbar has no .sv-cursor | true | false
} = {}) {
  const prev = window[INST_KEY];
  if (prev && typeof prev.destroy === 'function') { try { prev.destroy(); } catch (e) { console.error(e); } }

  const ac = new AbortController();
  const opt = { signal: ac.signal };
  let alive = true;

  // ---------- style + layer ----------
  let st = document.getElementById('ui-feel-style');
  if (!st) { st = document.createElement('style'); st.id = 'ui-feel-style'; document.head.append(st); }
  if (st.textContent !== STYLE) st.textContent = STYLE;

  const layer = document.getElementById('uf-layer') || Object.assign(document.createElement('div'), { id: 'uf-layer' });
  layer.setAttribute('aria-hidden', 'true');
  layer.textContent = '';
  document.body.append(layer);
  const cursor = el('div', 'uf-cursor', '<i></i>', layer);
  const cursorInner = cursor.firstChild;
  const ringPool = Array.from({ length: 4 }, () => el('div', 'uf-ring', '<i></i>', layer));
  const flyPool = Array.from({ length: 8 }, () => ({ node: el('div', 'uf-fly', '<i class="uf-art"></i><b></b>', layer), kind: null, anim: null }));
  flyPool.forEach(f => { f.art = f.node.firstChild; f.label = f.node.lastChild; });
  let ringNext = 0;

  // ---------- reduced motion ----------
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  let rm = false;
  function applyRM() {
    rm = reducedMotion === 'auto' ? mq.matches : !!reducedMotion;
    document.documentElement.classList.toggle('uf-rm', rm);
  }
  applyRM();
  mq.addEventListener?.('change', applyRM, opt);

  // ---------- geometry cache (the only layout reads) ----------
  let tools = null, hotEls = [], slotRects = [], toolsVisible = false, ownCursor = hotbarCursor === true;
  let selIndex = -1;
  let ro = null, mo = null;
  const counts = new WeakMap();
  const pendingLand = new Map(); // slot element -> pending fly count (suppresses MO bump until landing)

  function measure() {
    slotRects = hotEls.map(e => e.getBoundingClientRect());
    const r0 = slotRects[0];
    toolsVisible = !!r0 && r0.width > 0;
    if (r0) { layer.style.setProperty('--uf-cw', r0.width + 8 + 'px'); layer.style.setProperty('--uf-ch', r0.height + 8 + 'px'); }
    if (toolsVisible) { // hotbar box, used by the phone stat strip (written on resize only)
      const tb = tools.getBoundingClientRect(), ds = document.documentElement.style;
      ds.setProperty('--uf-hbx', tb.left.toFixed(1) + 'px'); ds.setProperty('--uf-hbw', tb.width.toFixed(1) + 'px');
      ds.setProperty('--uf-hbt', (innerHeight - tb.top).toFixed(1) + 'px');
    }
    placeCursor(false);
  }
  function placeCursor(animate) {
    const r = slotRects[selIndex];
    const on = ownCursor && toolsVisible && !!r;
    cursor.classList.toggle('on', on);
    if (!on) return;
    // Non-animated moves (resize, first show) drop the transform transition for one frame; no style flush needed.
    if (!animate) { cursor.style.transition = 'opacity .15s'; requestAnimationFrame(() => { cursor.style.transition = ''; }); }
    cursor.style.transform = `translate3d(${r.left - 4}px,${r.top - 4}px,0)`;
  }

  function readCount(slotEl) {
    const t = slotEl.querySelector('.sv-count')?.textContent || '';
    const n = parseInt(t, 10);
    return n > 0 ? n : slotEl.classList.contains('sv-empty') ? 0 : 1;
  }

  function attachHotbar(t = root.querySelector('.tools')) {
    if (!t) return false;
    const els = [...t.querySelectorAll(':scope>.sv-slot')];
    if (t === tools && els.length === hotEls.length && els.every((e, i) => e === hotEls[i])) return true;
    tools = t; hotEls = els;
    // survival-ui sv3 draws its own cursor + name tag and bumps slots on paint: do not double them.
    ownCursor = hotbarCursor === 'auto' ? !t.querySelector(':scope>.sv-cursor') : !!hotbarCursor;
    t.classList.toggle('uf-has-cursor', ownCursor);
    hotEls.forEach(e => counts.set(e, readCount(e)));
    selIndex = hotEls.findIndex(e => e.classList.contains('sv-sel'));
    ro?.disconnect();
    ro = new ResizeObserver(() => { if (alive) measure(); });
    ro.observe(t);
    mo?.disconnect();
    mo = new MutationObserver(onMutations);
    mo.observe(t, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    return true;
  }
  // Inventory dialog slots get the same count bumps (no ring: they are not in the cached hotbar rects).
  let invEl = null, mo2 = null;
  function attachInventory(d = document.getElementById('inventory')) {
    if (!d || d === invEl) return !!d;
    invEl = d;
    d.querySelectorAll('.sv-slot').forEach(e => counts.set(e, readCount(e)));
    mo2?.disconnect();
    mo2 = new MutationObserver(onMutations);
    mo2.observe(d, { subtree: true, childList: true, characterData: true });
    return true;
  }

  function onMutations(list) {
    if (!alive) return;
    let rebuilt = false, newSel = -1;
    const touched = new Set();
    for (const m of list) {
      if (m.target === tools && m.type === 'childList') { rebuilt = true; break; }
      const slot = m.target.nodeType === 1 ? m.target.closest?.('.sv-slot') : m.target.parentElement?.closest('.sv-slot');
      if (!slot) continue;
      if (m.type === 'attributes' && slot === m.target && slot.classList.contains('sv-sel')) newSel = hotEls.indexOf(slot);
      else if (m.type !== 'attributes' || m.attributeName === 'class') touched.add(slot);
    }
    if (rebuilt) { tools = null; attachHotbar(); measure(); return; }
    if (newSel >= 0 && newSel !== selIndex) select(newSel);
    for (const slot of touched) {
      const now = readCount(slot);
      if (!counts.has(slot)) { counts.set(slot, now); continue; } // first sighting (fresh DOM): record only
      const before = counts.get(slot);
      if (now === before) continue;
      counts.set(slot, now);
      if (pendingLand.get(slot)) continue; // the flying icon will bump it on arrival
      if (!ownCursor) continue; // survival-ui bumps its own slots on paint
      if (now > before) bumpSlot(slot, before === 0); else dipSlot(slot);
    }
  }

  // ---------- hotbar ----------
  function select(i) {
    if (!hotEls[i]) return;
    const from = selIndex; selIndex = i;
    placeCursor(!rm);
    if (rm || from === i || !ownCursor) return;
    const dir = from < 0 ? 0 : Math.sign(i - from);
    cursorInner.animate([
      { transform: `scale(1.08,.9) translateX(${dir * -3}px)` },
      { transform: 'scale(1)' },
    ], { duration: 260, easing: BACK, delay: 40 });
    const art = hotEls[i].querySelector('.sv-art');
    art?.animate([
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-7px) scale(1.22)', offset: .35 },
      { transform: 'translateY(1px) scale(.96)', offset: .7 },
      { transform: 'translateY(0) scale(1)' },
    ], { duration: 320, easing: 'ease-out' });
  }

  function bumpSlot(slot, fresh) {
    if (rm) { flashRing(slot, true); return; }
    const art = slot.querySelector('.sv-art'), cnt = slot.querySelector('.sv-count');
    art?.animate(fresh
      ? [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1.18)', opacity: 1, offset: .55 }, { transform: 'scale(1)' }]
      : [{ transform: 'scale(1)' }, { transform: 'scale(1.18) rotate(-4deg)', offset: .4 }, { transform: 'scale(1)' }],
    { duration: 300, easing: 'ease-out' });
    cnt?.animate([{ transform: 'scale(1.7)' }, { transform: 'scale(1)' }], { duration: 320, easing: BACK });
    flashRing(slot, false);
  }
  function dipSlot(slot) {
    if (rm) return;
    slot.querySelector('.sv-art')?.animate([{ transform: 'scale(.86)' }, { transform: 'scale(1)' }], { duration: 200, easing: OUT });
  }
  function flashRing(slot, quiet) {
    const i = hotEls.indexOf(slot), r = slotRects[i];
    if (!r || !toolsVisible) return;
    const ring = ringPool[ringNext++ % ringPool.length];
    ring.style.transform = `translate3d(${r.left - 4}px,${r.top - 4}px,0)`;
    ring.firstChild.animate(quiet
      ? [{ opacity: .9 }, { opacity: 0 }]
      : [{ opacity: 1, transform: 'scale(.92)' }, { opacity: 0, transform: 'scale(1.22)' }],
    { duration: quiet ? 360 : 420, easing: 'ease-out' });
  }

  // Recipe row celebrates a successful craft (the output slot bumps via the observer).
  // id: a recipe id, or the crafted item kind (matched against survival-ui's data-tip-kind). Strings only.
  function crafted(id) {
    if (typeof id !== 'string' || !id || !invEl) return false;
    const q = CSS.escape(id);
    const b = invEl.querySelector(`.sv-recipe[data-recipe="${q}"]`) || invEl.querySelector(`.sv-recipe[data-tip-kind="${q}"]`);
    if (!b) return false;
    if (PSEUDO) b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: rm ? 250 : 520, easing: 'ease-out', pseudoElement: '::after' });
    if (!rm) b.querySelector('.sv-rart')?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28) rotate(-6deg)', offset: .35 }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
    return true;
  }

  // ---------- pickup: icon flies into its slot ----------
  // The hotbar slot that just received `kind`: the stack whose count in the Bag differs from the last paint we
  // observed (Bag.add tops up the first non-full stack, then fills empties). The bag is authoritative before
  // survival-ui repaints. No such slot means the item went to the backpack, or (guest) the predicted bag does not
  // have it yet: the caller then flies to a generic hotbar target and the real slot bumps when it is painted.
  function targetSlotFor(kind) {
    const slots = safe(getBag)?.slots;
    if (!Array.isArray(slots)) return hotEls.find(e => (e.dataset.kind || e._svKind) === kind) || null; // no bag: DOM guess
    for (let i = 0; i < hotbarSize; i++) {
      const s = slots[i]; if (!s || s.kind !== kind || !hotEls[i]) continue;
      if (counts.has(hotEls[i]) && counts.get(hotEls[i]) !== s.count) return hotEls[i];
    }
    return null;
  }
  function slotOfKind(kind) {
    const slots = safe(getBag)?.slots;
    const i = Array.isArray(slots) ? slots.findIndex((s, i) => i < hotbarSize && s?.kind === kind) : -1;
    return i >= 0 ? hotEls[i] : hotEls.find(e => (e.dataset.kind || e._svKind) === kind) || null;
  }
  function artFor(kind, slot) {
    // The slot's own art first (same 3D icon the player sees in the bar), else the host's renderer.
    const a = slot?.querySelector('.sv-art');
    if (a && a.firstElementChild && (slot.dataset.kind || slot._svKind) === kind) return a.innerHTML;
    const h = safe(iconHTML, kind);
    return typeof h === 'string' ? h : '';
  }

  // items: [{kind, count}] ; from: {x, y} in CSS px (default: viewport center = crosshair)
  function hold(slot) { // keep the painted count (and an empty slot's blank) until the icon lands
    if (slot.classList.contains('uf-wait')) return;
    // The last count the observer saw is the one on screen (a repaint in this same task is not observed yet).
    const old = counts.has(slot) ? counts.get(slot) : readCount(slot);
    const cnt = slot.querySelector('.sv-count');
    if (cnt) cnt.dataset.ufOld = old > 1 ? String(old) : '';
    slot.classList.add('uf-wait');
    slot.classList.toggle('uf-fresh', old === 0);
  }
  function release(slot) {
    slot.classList.remove('uf-wait', 'uf-fresh');
    const cnt = slot.querySelector('.sv-count');
    if (cnt) delete cnt.dataset.ufOld;
  }
  function pickup(items, from = null) {
    if (!alive || !Array.isArray(items)) return false;
    const fx = from?.x ?? innerWidth / 2, fy = from?.y ?? innerHeight / 2;
    items.slice(0, flyPool.length).forEach((it, k) => {
      if (!it || !it.kind) return;
      const slot = targetSlotFor(it.kind);
      const r = slot ? slotRects[hotEls.indexOf(slot)] : null;
      if (rm || !toolsVisible) { if (slot) flashRing(slot, true); return; }
      const fly = flyPool.find(f => !f.anim) || flyPool[k % flyPool.length];
      fly.anim?.cancel();
      const art = artFor(it.kind, slot || slotOfKind(it.kind));
      if (fly.kind !== it.kind || fly.artHTML !== art) { fly.art.innerHTML = art; fly.kind = it.kind; fly.artHTML = art; }
      fly.node.classList.toggle('uf-gen', !r);
      fly.label.textContent = it.count > 1 ? '+' + it.count : '';
      // Destination: the slot centre, or (backpack / not in the bag yet) the middle of the hotbar's top edge,
      // where it shrinks into the bar. A slot that changes later bumps through the observer when it is painted.
      const first = slotRects[0], last = slotRects[slotRects.length - 1];
      const tx = r ? r.left + r.width / 2 : (first.left + last.right) / 2, ty = r ? r.top + r.height / 2 : first.top + 6;
      const n = Math.min(items.length, flyPool.length), spread = n > 3 ? 46 : 52; // 44px icons: fan wide enough not to overlap
      const sx = fx + (k - (n - 1) / 2) * spread, sy = fy - 8 - (n > 2 && k % 2 ? 14 : 0);
      const keys = arc(sx, sy, tx, ty, r ? .62 : .6);
      if (slot) { pendingLand.set(slot, (pendingLand.get(slot) || 0) + 1); hold(slot); }
      fly.anim = fly.node.animate(keys, { duration: 640, delay: k * 70, easing: 'linear', fill: 'backwards' });
      const a = fly.anim;
      const done = landed => {
        if (fly.anim !== a) return;
        fly.anim = null;
        if (slot) {
          const n = (pendingLand.get(slot) || 1) - 1;
          if (n > 0) pendingLand.set(slot, n); else { pendingLand.delete(slot); release(slot); }
          if (landed) { counts.set(slot, readCount(slot)); bumpSlot(slot, false); }
        }
      };
      a.onfinish = () => done(true);
      a.oncancel = () => done(false);
    });
    return true;
  }
  // Pop out of the crosshair, hang for a beat, then accelerate along a curve into the slot.
  function arc(sx, sy, tx, ty, endScale) {
    const out = [
      { transform: `translate3d(${sx}px,${sy}px,0) scale(.3)`, opacity: 0, offset: 0 },
      { transform: `translate3d(${sx}px,${sy - 26}px,0) scale(1.25)`, opacity: 1, offset: .16, easing: 'ease-out' },
      { transform: `translate3d(${sx}px,${sy - 32}px,0) scale(1.1)`, opacity: 1, offset: .3 },
    ];
    const cx = (sx + tx) / 2 + (tx - sx) * .15, cy = Math.min(sy, ty) - 60; // control point above the path
    const N = 7;
    for (let i = 1; i <= N; i++) {
      const u = i / N, t = u * u; // ease-in along the curve
      const x = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * tx;
      const y = (1 - t) * (1 - t) * (sy - 32) + 2 * (1 - t) * t * cy + t * t * ty;
      const s = 1.1 + (endScale - 1.1) * t;
      out.push({ transform: `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${s.toFixed(3)})`, opacity: i === N ? .0 : 1, offset: .3 + .7 * u });
    }
    out[out.length - 2].opacity = 1;
    return out;
  }

  // ---------- toasts ----------
  // Placement: desktop bottom right (newest at the bottom, 5 rows); phone (<=760px) top centre (newest on top,
  // 3 rows). While a modal dialog is open the stack goes where the dialog leaves room: beside it if the right
  // gap fits the 230px column, else the larger of the top/bottom gaps, capped at the rows that fit (1-2).
  const LIFE = 3200; // a row merges repeats for as long as it is on screen
  const narrowMQ = matchMedia('(max-width:760px)');
  let narrow = narrowMQ.matches, mode = 'br', rowCap = 5;
  const rowY = i => mode === 'top' ? i * 34 : mode === 'bot' ? -i * 34 : -i * 40;
  let stack = null;
  if (toasts) {
    stack = document.getElementById('uf-toasts') || Object.assign(document.createElement('div'), { id: 'uf-toasts' });
    stack.textContent = '';
    stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  // The stack lives in the top layer (popover=manual), so it can be raised above a modal dialog and its
  // ::backdrop, and above a fullscreen <html>. Top-layer order is the order shown, so it is re-shown after any
  // dialog opens and after every fullscreen change. Without popover support it stays at z-index 5.
  const canPop = !!stack && typeof stack.showPopover === 'function';
  if (canPop) { stack.popover = 'manual'; try { if (!stack.matches(':popover-open')) stack.showPopover(); } catch {} }
  function raiseToasts() {
    if (!canPop || !stack.isConnected) return;
    try { if (stack.matches(':popover-open')) stack.hidePopover(); stack.showPopover(); } catch {}
  }
  function openModal() {
    for (const d of document.querySelectorAll('dialog[open]')) { try { if (d.matches(':modal')) return d; } catch { return d; } }
    return null;
  }
  // One layout read per dialog open/close or viewport change; never per frame.
  function relayout() {
    if (!stack) return;
    let m = narrow ? 'top' : 'br', cap = narrow ? 3 : 5, ty = 12;
    const d = openModal();
    if (d) {
      const L = d.offsetLeft, T = d.offsetTop, R = innerWidth - L - d.offsetWidth, B = innerHeight - T - d.offsetHeight;
      if (narrow || R < 250) {
        const gap = Math.max(T, B);
        m = T >= B ? 'top' : 'bot';
        cap = Math.max(1, Math.min(2, Math.floor((gap - 4) / 34)));
        ty = Math.max(4, (gap - cap * 34 + 4) / 2);
      }
    }
    stack.classList.toggle('uf-top', m === 'top'); stack.classList.toggle('uf-bot', m === 'bot');
    stack.style.setProperty('--uf-ty', ty.toFixed(0) + 'px');
    if (m === mode && cap === rowCap) return;
    mode = m; rowCap = cap;
    while (shown.length > rowCap) expire(shown[shown.length - 1], true);
    shown.forEach(r => { r.slot = -1; }); restack(); // re-place without animating
  }
  const tpool = stack ? Array.from({ length: 6 }, () => {
    const n = el('div', 'uf-toast', '<i class="uf-tg"></i><i class="uf-ti"></i><span class="uf-tt"></span><b class="uf-tn"></b>', stack);
    return { n, tg: n.children[0], ti: n.children[1], tt: n.children[2], tn: n.children[3], key: '', amount: 0, born: 0, slot: -1, dying: false, gen: 0 };
  }) : [];
  const shown = []; // index 0 = newest
  let tickTimer = 0, mo3 = null;
  if (stack) {
    narrowMQ.addEventListener?.('change', () => { narrow = narrowMQ.matches; relayout(); }, opt);
    document.addEventListener('fullscreenchange', raiseToasts, opt);
    document.addEventListener('webkitfullscreenchange', raiseToasts, opt);
    // Any dialog opening or closing (inventory, pause/settings, crew, help, logbook...): re-place, then re-raise.
    mo3 = new MutationObserver(list => {
      if (!alive || !list.some(m => m.target.tagName === 'DIALOG')) return;
      relayout();
      if (list.some(m => m.target.tagName === 'DIALOG' && m.target.open)) raiseToasts();
    });
    mo3.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    relayout();
  }

  // toast(text, {kind:'loot'|'craft'|'build'|'full'|'warn'|'info', icon:'<svg>', amount:n, key:'merge-key'})
  function toast(text, o = {}) {
    if (!alive || !stack || !text) return false;
    const now = performance.now(), kind = o.kind || 'info', key = o.key ?? (kind + ':' + text);
    const amount = Number(o.amount) || 0;
    const hit = shown.find(r => r.key === key && !r.dying);
    if (hit) {
      hit.born = now;
      if (amount) {
        hit.amount += amount; hit.tn.textContent = '+' + hit.amount;
        if (!rm) hit.tn.animate([{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }], { duration: 260, easing: BACK });
      }
      if (!rm) hit.tg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out' });
      armTick();
      return true;
    }
    if (shown.length >= rowCap) expire(shown[shown.length - 1], true);
    const row = tpool.find(r => !shown.includes(r) && !r.dying) || tpool.find(r => !shown.includes(r));
    row.gen++; row.dying = false; row.key = key; row.amount = amount; row.born = now;
    row.n.dataset.kind = kind;
    row.ti.innerHTML = o.icon || '';
    row.tt.textContent = text;
    row.tn.textContent = amount ? '+' + amount : '';
    row.n.getAnimations().forEach(a => a.cancel());
    shown.unshift(row);
    restack();
    const g = row.gen;
    row.n.animate(rm
      ? [{ opacity: 0 }, { opacity: 1 }]
      : mode !== 'br'
        ? [{ opacity: 0, transform: `translate3d(0,${mode === 'top' ? -18 : 18}px,0) scale(.94)` }, { opacity: 1, transform: 'translate3d(0,2px,0)', offset: .7 }, { opacity: 1, transform: 'translate3d(0,0,0)' }]
        : [{ opacity: 0, transform: 'translate3d(24px,0,0) scale(.96)' }, { opacity: 1, transform: 'translate3d(-4px,0,0)', offset: .7 }, { opacity: 1, transform: 'translate3d(0,0,0)' }],
    { duration: rm ? 120 : 260, easing: OUT })
      .ready.then(() => { if (row.gen === g && !row.dying) row.born = performance.now(); }, () => {}); // life starts when it is on screen (stalled frames)
    armTick();
    return true;
  }
  function restack() {
    shown.forEach((r, i) => {
      const y = rowY(i);
      if (r.slot === i) return;
      const from = r.slot < 0 ? y : rowY(r.slot);
      r.slot = i;
      r.n.style.transform = `translate3d(0,${y}px,0)`;
      r.n.style.opacity = String(Math.max(.6, 1 - i * .1));
      if (!rm && from !== y) r.n.animate([{ transform: `translate3d(0,${from}px,0)` }, { transform: `translate3d(0,${y}px,0)` }], { duration: 200, easing: OUT, composite: 'replace' });
    });
  }
  function expire(row, fast) {
    if (row.dying) return;
    row.dying = true;
    const gen = row.gen, i = shown.indexOf(row);
    if (i >= 0) shown.splice(i, 1);
    const y = rowY(row.slot);
    const a = row.n.animate(rm ? [{ opacity: 0 }] : [{ opacity: 0, transform: mode !== 'br' ? `translate3d(0,${y + (mode === 'top' ? -12 : 12)}px,0)` : `translate3d(28px,${y}px,0)` }], { duration: fast ? 120 : 220, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => { if (row.gen !== gen) return; row.dying = false; row.slot = -1; row.n.style.opacity = '0'; a.cancel(); };
    restack();
  }
  function armTick() {
    if (tickTimer) return;
    tickTimer = setTimeout(function tick() {
      tickTimer = 0;
      if (!alive) return;
      const now = performance.now();
      for (let i = shown.length - 1; i >= 0; i--) if (now - shown[i].born > LIFE) expire(shown[i], false);
      if (shown.length) tickTimer = setTimeout(tick, 250);
    }, 250);
  }

  // ---------- stat bars ----------
  // statBar(container, {tone:'health'|'food'|'water'|'hook', label, value:0..1}) -> {set(v), get value()}
  function statBar(container, { tone = 'health', label = tone, value = 1 } = {}) {
    const wrap = el('div', 'uf-stat', `<i class="uf-si">${STAT_ICONS[tone] || ''}</i><div class="uf-track" role="meter" aria-valuemin="0" aria-valuemax="100"><i class="uf-trail"></i><i class="uf-fill"></i><i class="uf-flash"></i></div>`, container);
    wrap.dataset.tone = tone;
    const track = wrap.children[1], icon = wrap.children[0];
    const [trail, fill, flash] = track.children;
    track.setAttribute('aria-label', label);
    let v = clamp01(value), fillA = null, trailA = null, fillFrom = v, trailFrom = v;
    const sx = x => `scaleX(${x.toFixed(4)})`;
    fill.style.transform = trail.style.transform = sx(v);
    const now = (a, from, to) => {
      // Visual value of a running animation, from its eased progress (no style read).
      if (!a || a.playState !== 'running') return to;
      const p = a.effect.getComputedTiming().progress;
      return p == null ? from : from + (to - from) * p;
    };
    function set(nv) {
      nv = clamp01(nv);
      if (Math.abs(nv - v) < 1e-4) return;
      const curFill = now(fillA, fillFrom, v), curTrail = now(trailA, trailFrom, v);
      fillA?.cancel(); trailA?.cancel();
      const down = nv < v; v = nv;
      track.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      wrap.classList.toggle('uf-low', v <= .25);
      track.classList.toggle('uf-up', !down);
      fill.style.transform = trail.style.transform = sx(v);
      if (rm) { // no motion: fill jumps, trail fades
        fillA = trailA = null;
        trail.style.transform = sx(Math.max(curTrail, v));
        trailA = trail.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'ease-in' });
        trailA.onfinish = () => { trail.style.transform = sx(v); };
        trailFrom = v;
        return;
      }
      if (down) {
        fillFrom = curFill; trailFrom = Math.max(curTrail, curFill);
        fillA = fill.animate([{ transform: sx(fillFrom) }, { transform: sx(v) }], { duration: 110, easing: OUT });
        trailA = trail.animate([{ transform: sx(trailFrom) }, { transform: sx(v) }], { duration: 520, delay: 420, easing: IN_OUT, fill: 'backwards' });
        const big = trailFrom - v;
        flash.animate([{ opacity: Math.min(.8, .3 + big * 2) }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
        if (big > .12) icon.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px) rotate(-8deg)' }, { transform: 'translateX(3px) rotate(6deg)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 300 });
      } else {
        // heal: a pale lead ghost snaps ahead, the fill catches up
        trailFrom = curFill; fillFrom = curFill;
        trailA = trail.animate([{ transform: sx(curFill) }, { transform: sx(v) }], { duration: 140, easing: OUT });
        fillA = fill.animate([{ transform: sx(fillFrom) }, { transform: sx(v) }], { duration: 600, delay: 160, easing: IN_OUT, fill: 'backwards' });
        icon.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 320, easing: BACK });
      }
    }
    set(v); wrap.classList.toggle('uf-low', v <= .25);
    return { el: wrap, set(nv) { try { set(nv); return true; } catch (e) { console.error('ui-feel statBar failed', e); return false; } }, get value() { return v; } };
  }

  // ---------- crosshair ----------
  let xh = null, xhArc = null, xhHit = null, xhHover = false, xhCharge = -1, xhFull = false;
  function attachCrosshair(c = document.getElementById('crosshair')) {
    if (!c) return false;
    xh = c;
    c.classList.add('uf-xh');
    c.querySelectorAll(':scope>.uf-x').forEach(n => n.remove());
    c.insertAdjacentHTML('beforeend', '<i class="uf-x uf-x-ring"></i><i class="uf-x uf-x-dot"></i>' +
      '<svg class="uf-x uf-x-arc" viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="16"/><circle class="fg" cx="20" cy="20" r="16" pathLength="100"/></svg>' +
      '<i class="uf-x uf-x-hit"><b></b><b></b><b></b><b></b></i>');
    xhArc = c.querySelector('.uf-x-arc .fg');
    xhHit = c.querySelector('.uf-x-hit');
    return true;
  }
  const crosshairRaw = {
    hover(on) { on = !!on; if (!xh || on === xhHover) return; xhHover = on; xh.classList.toggle('uf-hover', on); },
    // v in 0..1 while charging, null/negative when not
    charge(v) {
      if (!xh) return;
      const c = v == null || v < 0 ? -1 : clamp01(v);
      if (c === xhCharge) return;
      if ((c < 0) !== (xhCharge < 0)) xh.classList.toggle('uf-charging', c >= 0);
      const full = c >= 1;
      if (full !== xhFull) {
        xhFull = full; xh.classList.toggle('uf-full', full);
        if (full && !rm) xh.querySelector('.uf-x-arc').animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 220, easing: BACK });
      }
      xhCharge = c;
      if (c >= 0) xhArc.style.strokeDashoffset = (100 - c * 100).toFixed(1);
    },
    // kind: 'hit' (cream) | 'gold' (catch / pickup) | 'deny' (red)
    hit(kind = 'hit') {
      if (!xh) return;
      xhHit.className = 'uf-x uf-x-hit ' + (kind === 'hit' ? '' : kind);
      xhHit.animate(rm
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 1, transform: 'scale(.55) rotate(0deg)' }, { opacity: 1, transform: 'scale(1.08) rotate(0deg)', offset: .35 }, { opacity: 0, transform: 'scale(1.25) rotate(0deg)' }],
      { duration: rm ? 200 : 300, easing: 'ease-out' });
      if (!rm) xh.querySelector('.uf-x-ring').animate(kind === 'deny'
        ? [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }]
        : [{ transform: 'scale(1.45)' }, { transform: 'scale(1)' }], { duration: 240, easing: kind === 'deny' ? 'linear' : BACK, composite: 'add' });
    },
  };

  // ---------- helpers ----------
  function el(tag, cls, html, parent) { const n = document.createElement(tag); n.className = cls; if (html) n.innerHTML = html; parent?.append(n); return n; }
  function clamp01(x) { return x > 1 ? 1 : x > 0 ? x : 0; }
  function safe(fn, ...a) { try { return fn?.(...a); } catch (e) { console.error(e); return null; } }

  // Public entry points never throw into the game loop: errors are logged and the call returns false.
  function guard(fn, name) {
    return (...a) => {
      if (!alive) return false;
      try { const r = fn(...a); return r === undefined ? true : r; }
      catch (e) { console.error('ui-feel ' + name + ' failed', e); return false; }
    };
  }
  const crosshair = {
    hover: guard(crosshairRaw.hover, 'crosshair.hover'),
    charge: guard(crosshairRaw.charge, 'crosshair.charge'),
    hit: guard(crosshairRaw.hit, 'crosshair.hit'),
  };

  addEventListener('resize', () => { if (alive) { measure(); relayout(); } }, opt);
  attachHotbar();
  attachInventory();
  attachCrosshair();

  const api = {
    attachHotbar: guard(attachHotbar, 'attachHotbar'), attachInventory: guard(attachInventory, 'attachInventory'),
    attachCrosshair: guard(attachCrosshair, 'attachCrosshair'), measure: guard(measure, 'measure'),
    select: guard(select, 'select'), pickup: guard(pickup, 'pickup'), crafted: guard(crafted, 'crafted'), toast: guard(toast, 'toast'),
    statBar, crosshair,
    iconFor: kind => { try { return artFor(kind, slotOfKind(kind)); } catch (e) { console.error(e); return ''; } },
    get reducedMotion() { return rm; },
    setReducedMotion: guard(v => { reducedMotion = v; applyRM(); }, 'setReducedMotion'),
    destroy() {
      if (!alive) return;
      alive = false; ac.abort(); ro?.disconnect(); mo?.disconnect(); mo2?.disconnect(); mo3?.disconnect();
      clearTimeout(tickTimer);
      try { if (canPop && stack.matches(':popover-open')) stack.hidePopover(); } catch {}
      for (const f of flyPool) f.anim?.cancel(); // releases held slots
      layer.remove(); stack?.remove(); st.remove();
      for (const k of ['--uf-hbx', '--uf-hbw', '--uf-hbt']) document.documentElement.style.removeProperty(k);
      tools?.classList.remove('uf-has-cursor');
      if (xh) { xh.classList.remove('uf-xh', 'uf-hover', 'uf-charging', 'uf-full'); xh.querySelectorAll(':scope>.uf-x').forEach(n => n.remove()); }
      document.documentElement.classList.remove('uf-rm');
      if (window[INST_KEY] === api) window[INST_KEY] = null;
    },
  };
  window[INST_KEY] = api;
  return api;
}

export default createUIFeel;
