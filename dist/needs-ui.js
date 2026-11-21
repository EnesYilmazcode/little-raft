// Little Raft survival HUD: health / hunger / thirst bars (lower left), hurt vignette and the death card.
// Nothing happens on import. createNeedsHUD() -> {update(needs, visible), death(cause), alive(), dispose()}.
// update() runs every frame but only writes the DOM when a rounded value, a flag or the visibility changes.
const STYLE_ID = 'little-raft-needs-style';
const LOW = 20;
const CSS = `
#needsHud{position:fixed;left:22px;bottom:18px;z-index:4;display:flex;flex-direction:column;gap:5px;pointer-events:none;user-select:none}
#needsHud[hidden],#needsDeath[hidden]{display:none}
#needsHud .nd-bar{display:flex;align-items:center;gap:7px;padding:3px 9px 3px 5px;border-radius:999px;background:rgba(8,22,36,.5);
  box-shadow:inset 0 0 0 1px rgba(246,236,214,.18)}
#needsHud svg{width:16px;height:16px;flex:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))}
#needsHud .nd-track{position:relative;width:132px;height:7px;border-radius:4px;background:rgba(0,0,0,.38);overflow:hidden}
#needsHud .nd-track i{position:absolute;inset:0;transform-origin:0 50%;border-radius:4px;background:var(--nd);transition:transform .25s linear}
#needsHud .nd-health{--nd:linear-gradient(#f2706a,#cf3f3a)}
#needsHud .nd-hunger{--nd:linear-gradient(#f3c063,#d98c2c)}
#needsHud .nd-thirst{--nd:linear-gradient(#78cdf0,#2f8fc4)}
#needsHud .nd-bar.nd-low{animation:ndPulse 1s ease-in-out infinite}
#needsHud .nd-bar.nd-low svg{animation:ndBeat 1s ease-in-out infinite}
@keyframes ndPulse{50%{background:rgba(150,28,24,.66);box-shadow:inset 0 0 0 1px rgba(255,140,120,.55)}}
@keyframes ndBeat{50%{transform:scale(1.18)}}
#needsHurt{position:fixed;inset:0;z-index:3;pointer-events:none;opacity:0;
  background:radial-gradient(ellipse at center,rgba(150,0,0,0) 55%,rgba(170,12,8,.5) 88%,rgba(120,0,0,.75) 100%)}
#needsHurt.nd-on{animation:ndHurt .6s ease-out}
@keyframes ndHurt{0%{opacity:1}100%{opacity:0}}
#needsDeath{position:fixed;inset:0;z-index:60;display:grid;place-items:center;pointer-events:none;
  background:radial-gradient(ellipse at center,rgba(6,24,38,.55),rgba(4,12,22,.86));animation:ndFade .6s ease-out}
#needsDeath .nd-card{max-width:min(420px,calc(100vw - 48px));padding:22px 28px;text-align:center;color:#f6ecd6;
  font:500 15px/1.45 var(--ui-font,'DM Sans',system-ui,sans-serif);text-shadow:0 1px 2px rgba(0,0,0,.6)}
#needsDeath h2{margin:0 0 8px;font:700 26px/1.2 'Outfit',var(--ui-font,system-ui,sans-serif);letter-spacing:.02em;color:#ffd79a}
#needsDeath p{margin:0 0 14px}
#needsDeath small{opacity:.75;letter-spacing:.08em;text-transform:uppercase;font-size:11px}
@keyframes ndFade{from{opacity:0}}
body.lr-dead #lrPrompt,body.lr-dead #crosshair,body.lr-dead #spearHit{visibility:hidden}
body.lr-needs #pickupFeed{bottom:134px!important}
body.lr-needs #fcChip{bottom:100px!important}
@media(max-width:760px){#needsHud{left:16px;bottom:14px}#needsHud .nd-track{width:96px}}
@media(prefers-reduced-motion:reduce){#needsHud .nd-bar.nd-low,#needsHud .nd-bar.nd-low svg{animation:none}#needsHud .nd-bar.nd-low{background:rgba(150,28,24,.62)}}
`;
// Original icons: a heart, a little fish-on-a-plate, a water drop.
const ICONS = {
  health: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.2 2.3 8.6A3.4 3.4 0 0 1 8 4.1a3.4 3.4 0 0 1 5.7 4.5Z" fill="#f2706a" stroke="#7d1d1a" stroke-width="1.1" stroke-linejoin="round"/><path d="M4.4 6.2a1.6 1.6 0 0 1 1.8-1" stroke="#ffd2cc" stroke-width="1" fill="none" stroke-linecap="round"/></svg>',
  hunger: '<svg viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="11.6" rx="6.6" ry="2.2" fill="#f6ecd6" stroke="#6b4a24" stroke-width="1"/><path d="M3.6 8.2c1.6-2.4 4.6-2.6 6.6-.6l2.3-1.5-.5 2.6.5 2.6-2.3-1.5c-2 2-5 1.8-6.6-.6Z" fill="#f3c063" stroke="#6b4a24" stroke-width="1" stroke-linejoin="round"/><circle cx="5.4" cy="8.1" r=".7" fill="#6b4a24"/></svg>',
  thirst: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6C6.2 4.6 3.6 7.2 3.6 10a4.4 4.4 0 0 0 8.8 0c0-2.8-2.6-5.4-4.4-8.4Z" fill="#78cdf0" stroke="#174f6e" stroke-width="1.1" stroke-linejoin="round"/><path d="M5.9 10.2a2.2 2.2 0 0 0 1.7 2.1" stroke="#e6f7ff" stroke-width="1" fill="none" stroke-linecap="round"/></svg>',
};
const LINES = {
  hunger: ['Lost to the waves', 'Your stomach gave up a little before you did.'],
  thirst: ['Lost to the waves', 'All that water, and not a drop to drink.'],
  shark: ['Lost to the waves', 'Something with too many teeth got the last word.'],
  hurt: ['Lost to the waves', 'You drifted off into a long, salty daydream.'],
};
const KEYS = ['health', 'hunger', 'thirst'];

export function createNeedsHUD(doc = globalThis.document) {
  if (!doc?.body) return null;
  let style = doc.getElementById(STYLE_ID);
  if (!style) { style = doc.createElement('style'); style.id = STYLE_ID; doc.head.appendChild(style); }
  if (style.textContent !== CSS) style.textContent = CSS;
  // Stable nodes shared across hot swaps (like game.js's DOM adoption): adopted, never removed.
  const make = (id, html) => { let el = doc.getElementById(id); if (!el) { el = doc.createElement('div'); el.id = id; doc.body.appendChild(el); } if (html != null) el.innerHTML = html; return el; };
  const hud = make('needsHud', KEYS.map(k => `<div class="nd-bar nd-${k}" role="meter" aria-label="${k}" aria-valuemin="0" aria-valuemax="100">${ICONS[k]}<span class="nd-track"><i></i></span></div>`).join(''));
  const hurt = make('needsHurt'), death = make('needsDeath', '<div class="nd-card"><h2></h2><p></p><small>Waking up on your raft…</small></div>');
  const owner = String(Math.random()); hud.dataset.owner = owner; // live reload mounts the new engine before disposing the old one
  hud.hidden = true; death.hidden = true; hurt.setAttribute('aria-hidden', 'true');
  const bars = KEYS.map(k => hud.querySelector('.nd-' + k)), fills = bars.map(b => b.querySelector('i'));
  const shown = [-1, -1, -1], low = [false, false, false];
  let visible = false, hits = -1;

  function setBar(i, v) {
    const r = Math.round(v); if (r === shown[i]) return; shown[i] = r;
    fills[i].style.transform = `scaleX(${r / 100})`; bars[i].setAttribute('aria-valuenow', String(r));
    const l = r < LOW; if (l !== low[i]) { low[i] = l; bars[i].classList.toggle('nd-low', l); }
  }
  return {
    update(n, show) {
      show = !!(show && n?.active);
      if (show !== visible) { visible = show; hud.hidden = !show; doc.body.classList.toggle('lr-needs', show); }
      if (!n) return;
      if (hits < 0) hits = n.hits;
      if (n.hits !== hits) { hits = n.hits; if (show) { hurt.classList.remove('nd-on'); void hurt.offsetWidth; hurt.classList.add('nd-on'); } }
      if (!show) return;
      setBar(0, n.health); setBar(1, n.hunger); setBar(2, n.thirst);
    },
    death(cause) {
      const [h, p] = LINES[cause] ?? LINES.hurt;
      death.querySelector('h2').textContent = h; death.querySelector('p').textContent = p; death.hidden = false; doc.body.classList.add('lr-dead');
    },
    alive() { death.hidden = true; doc.body.classList.remove('lr-dead'); },
    dispose() {
      if (hud.dataset.owner !== owner) return; // a newer engine adopted these nodes
      doc.body.classList.remove('lr-needs', 'lr-dead'); hud.hidden = true; death.hidden = true;
    },
  };
}
