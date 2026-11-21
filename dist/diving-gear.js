// Diving gear (content module 'divegear'): fins, breath jug, goggles and scraper work while they are
// in your bag. No saved state (gear lives in the Bag), no actions. diveMods() feeds the shared
// dive modifier hook (content.diveMods -> diving.js getMods). docs/specs/diving-gear.md
import { GEAR_IDS, gearMask, applyGear, blankMods, maskIds } from './diving-gear-core.js';

const BUILD = (() => { try { return new URL(import.meta.url).searchParams.get('build') || 'dev'; } catch { return 'dev'; } })();
const SPRITE_URL = (() => {
  try { const u = new URL('icons.svg', import.meta.url); u.search = '?build=' + encodeURIComponent(BUILD); return u.href; }
  catch { return 'icons.svg'; }
})();
const NAMES = Object.freeze({ fins: 'Puff-Feather Fins', airjug: 'Breath Jug', goggles: 'Seaglass Goggles', scraper: 'Tide Scraper' });
const GOGGLES_BIT = 1 << GEAR_IDS.indexOf('goggles');
const CSS = `.dgGear{position:fixed;left:50%;bottom:172px;transform:translateX(-50%);z-index:3;pointer-events:none;display:flex;gap:5px;opacity:0;transition:opacity .4s}
.dgGear.on{opacity:1}
.dgChip{width:22px;height:22px;border-radius:50%;background:rgba(9,20,30,.72);box-shadow:0 0 0 1px rgba(201,164,107,.45);display:flex;align-items:center;justify-content:center}
.dgChip svg{width:16px;height:16px}
.dgMask{position:fixed;inset:0;z-index:2;pointer-events:none;opacity:0;transition:opacity .4s;background:rgba(10,28,34,.5);-webkit-mask:radial-gradient(ellipse 25% 40% at 32% 50%,transparent 90%,#000 100%),radial-gradient(ellipse 25% 40% at 68% 50%,transparent 90%,#000 100%);mask:radial-gradient(ellipse 25% 40% at 32% 50%,transparent 90%,#000 100%),radial-gradient(ellipse 25% 40% at 68% 50%,transparent 90%,#000 100%);-webkit-mask-composite:source-in;mask-composite:intersect}
.dgMask.on{opacity:1}
@media(max-width:760px){.dgGear{bottom:152px}}
@media(prefers-reduced-motion:reduce){.dgGear,.dgMask{transition:none}}`;

export function createDivingGear(ctx) {
  let mask = 0, t = 0, underwater = false, shownMask = -1, shownUw = null, built = false;
  let style = null, bar = null, frame = null;
  const ids = [];
  const count = k => ctx.localBag?.()?.count(k) ?? 0;
  const onUw = e => { underwater = !!e?.detail?.underwater; };
  if (typeof window !== 'undefined') window.addEventListener('raft:underwater', onUw);

  function build() {
    built = true;
    if (typeof document === 'undefined' || !document.body) return;
    style = document.createElement('style'); style.id = 'divingGearStyle'; style.textContent = CSS;
    document.head.appendChild(style);
    bar = document.createElement('div'); bar.className = 'dgGear';
    frame = document.createElement('div'); frame.className = 'dgMask';
    document.body.appendChild(frame); document.body.appendChild(bar);
  }

  function refresh() {
    if (!bar) return;
    if (mask !== shownMask) {
      shownMask = mask;
      bar.innerHTML = maskIds(mask, ids).map(id =>
        `<span class="dgChip" title="${NAMES[id]}"><svg viewBox="0 0 48 48"><use href="${SPRITE_URL}#icon-${id}"></use></svg></span>`).join('');
    }
    bar.classList.toggle('on', underwater && mask !== 0);
    frame.classList.toggle('on', underwater && (mask & GOGGLES_BIT) !== 0);
    shownUw = underwater;
  }

  return {
    name: 'divegear',
    update(dt) {
      if (!built) build();
      t -= dt;
      if (t <= 0) { t = 0.25; try { mask = gearMask(count); } catch { mask = 0; } }
      if (mask !== shownMask || underwater !== shownUw) refresh();
    },
    diveMods(m) { if (mask) applyGear(mask, m); },
    debug: {
      mods: () => applyGear(mask, blankMods({})),
      worn: () => maskIds(mask, []),
      mask: () => mask,
      give() {
        if (ctx.role === 'guest') return 0;
        const b = ctx.localBag?.(); if (!b) return 0;
        let n = 0; for (const id of GEAR_IDS) n += 1 - b.add(id, 1);
        t = 0; return n;
      },
    },
    dispose() {
      if (typeof window !== 'undefined') window.removeEventListener('raft:underwater', onUw);
      bar?.remove(); frame?.remove(); style?.remove(); bar = frame = style = null;
    },
  };
}
