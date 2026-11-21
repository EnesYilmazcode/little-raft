// Mock HUD: the REAL dist/survival-ui.js + dist/inventory-state.js Bag, with ui-feel.js layered on top,
// wired the same way docs/tech/ui-feel-ADOPT.md wires dist/game.js. No three.js: the world is a static frame.
import { createSurvivalUI } from '../../dist/survival-ui.js?build=v3-survival-ae77fa84ac2b';
import { Bag, ITEM_INFO } from '../../dist/inventory-state.js?build=v3-survival-ae77fa84ac2b';
import { createUIFeel } from './ui-feel.js';

const q = new URLSearchParams(location.search);
const SPRITE = new URL('../../dist/icons.svg?build=v3-survival-ae77fa84ac2b', import.meta.url).href;
const LOOT = { wood: { wood: 2 }, leaf: { leaf: 1 }, scrap: { scrap: 1 }, plastic: { plastic: 1 }, barrel: { wood: 3, leaf: 2, scrap: 1, plastic: 1 } };
const NAMES = { wood: 'Wood', leaf: 'Palm Leaf', scrap: 'Scrap', plastic: 'Plastic', rope: 'Rope' };
const CHARGE_MS = 900;

// ---------- bag + real survival UI ----------
const bag = new Bag();
bag.slots[0].durability = 72;
bag.add('wood', 12); bag.add('plastic', 6); bag.add('leaf', 5); bag.add('hammer', 1); bag.add('rope', 4); bag.add('scrap', 2);
const ui = createSurvivalUI({
  getBag: () => bag,
  onSelect: i => { bag.select(i); ui.update(); },
  onMove: (f, t, n) => { bag.move(f, t, n); ui.update(); return true; },
  onCraft: id => craft(id),
  onPause() {}, onResume() {},
});

// Sprite-based icon; survival-ui's own iconSVG is used in dist (see ADOPT: export it).
const iconHTML = kind => {
  const id = ITEM_INFO[kind]?.placeholder ? null : ITEM_INFO[kind]?.icon;
  return id ? `<svg class="sv-icon" viewBox="0 0 48 48"><use href="${SPRITE}#${id}"></use></svg>` : null;
};

// ---------- feel layer ----------
// ?nofeel=1: same mock without the feel layer (cost baseline).
const noop = () => {};
const feel = q.has('nofeel')
  ? { pickup: noop, toast: noop, crafted: noop, iconFor: () => '', setReducedMotion: noop, reducedMotion: false,
      crosshair: { hover: noop, charge: noop, hit: noop }, statBar: (c, o) => ({ value: o.value, set(v) { this.value = v; } }) }
  : createUIFeel({ getBag: () => bag, iconHTML, reducedMotion: q.has('rm') ? true : 'auto' });
const statsEl = document.getElementById('stats');
const stats = {
  health: feel.statBar(statsEl, { tone: 'health', label: 'Health', value: .86 }),
  food: feel.statBar(statsEl, { tone: 'food', label: 'Hunger', value: .64 }),
  water: feel.statBar(statsEl, { tone: 'water', label: 'Thirst', value: .41 }),
};
ui.update();

// ---------- game-ish actions (what game.js effect()/frame() would call) ----------
function select(i) { bag.select(((i % 8) + 8) % 8); ui.update(); }
function pickup(type = 'wood', from) {
  const loot = LOOT[type]; if (!loot) return;
  for (const [k, n] of Object.entries(loot)) bag.add(k, n);
  ui.update();
  const items = Object.entries(loot).map(([kind, count]) => ({ kind, count }));
  feel.pickup(items, from);
  feel.crosshair.hit('gold');
  for (const it of items) feel.toast(NAMES[it.kind] || it.kind, { kind: 'loot', icon: feel.iconFor(it.kind) || '', amount: it.count, key: 'loot:' + it.kind });
}
function craft(id) {
  const r = bag.craft(id);
  if (r.ok) { feel.crafted(id); feel.toast('Crafted ' + (ITEM_INFO[r.crafted.kind]?.name ?? id), { kind: 'craft', icon: feel.iconFor(r.crafted.kind) || '' }); }
  else if (r.reason === 'full') feel.toast('Your bag is full', { kind: 'full' });
  else feel.toast('Need ' + r.missing.map(m => `${m.count} more ${ITEM_INFO[m.kind]?.name.toLowerCase()}`).join(' and '), { kind: 'warn' });
  ui.update();
}
let hover = false;
const prompt = document.getElementById('contextPrompt');
function setHover(on) {
  hover = !!on; feel.crosshair.hover(hover);
  prompt.innerHTML = hover ? '<kbd>E</kbd>Pick up plank' : ''; prompt.hidden = !hover;
}
let chargeStart = 0;
function chargeTick(now) {
  if (!chargeStart) return;
  feel.crosshair.charge(Math.min(1, (now - chargeStart) / CHARGE_MS));
  requestAnimationFrame(chargeTick);
}
function beginCharge() { if (chargeStart) return; chargeStart = performance.now(); requestAnimationFrame(chargeTick); }
function releaseCharge() { if (!chargeStart) return; chargeStart = 0; feel.crosshair.charge(null); feel.crosshair.hit('hit'); }
function hurt(stat = 'health', amt = .22) { stats[stat].set(stats[stat].value - amt); }
function heal(stat = 'health', amt = .3) { stats[stat].set(stats[stat].value + amt); }

addEventListener('keydown', e => {
  if (e.repeat) return;
  const n = +e.key;
  if (n >= 1 && n <= 8) return select(n - 1);
  const k = e.key.toLowerCase();
  if (k === 'e') pickup(['wood', 'leaf', 'plastic', 'scrap'][Math.floor(Math.random() * 4)]);
  else if (k === 'b') pickup('barrel');
  else if (k === 'f') setHover(!hover);
  else if (k === 'x') feel.crosshair.hit('deny');
  else if (k === 'h') hurt('health', .1 + Math.random() * .25);
  else if (k === 'j') heal('health', .25);
  else if (k === 'k') hurt('food', .08);
  else if (k === 'm') feel.setReducedMotion(!feel.reducedMotion);
});
let wheelAcc = 0;
addEventListener('wheel', e => { wheelAcc += e.deltaY; if (Math.abs(wheelAcc) >= 50) { select(bag.selectedIndex + Math.sign(wheelAcc)); wheelAcc = 0; } }, { passive: true });
const world = document.getElementById('world');
world.addEventListener('pointerdown', e => { if (e.button === 0) beginCharge(); });
addEventListener('pointerup', releaseCharge);

// ---------- naive reference implementations (for the cost comparison only) ----------
// Width-animated bars + DOM-inserted toasts with top transitions + reflow-restarted pops: the patterns ui-feel avoids.
const naive = (() => {
  let box = null, bars = [], list = null;
  function mount() {
    if (box) return;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:20px;top:20px;width:170px;padding:8px;background:#3a2716e6;z-index:8';
    box.innerHTML = '<div class="nb"></div><div class="nb"></div><div class="nb"></div><ol style="position:relative;height:200px;margin:8px 0 0;padding:0;list-style:none"></ol>';
    document.body.append(box);
    bars = [...box.querySelectorAll('.nb')].map(d => {
      d.style.cssText = 'height:10px;margin:4px 0;background:#140c06;position:relative';
      d.innerHTML = '<i style="position:absolute;left:0;top:0;bottom:0;width:80%;background:#fff0d0;transition:width .5s .4s"></i><i style="position:absolute;left:0;top:0;bottom:0;width:80%;background:#e2644a;transition:width .1s"></i>';
      return [...d.children];
    });
    list = box.querySelector('ol');
  }
  return {
    mount,
    bar(i, v) { const [t, f] = bars[i]; t.style.width = f.style.width = (v * 100).toFixed(1) + '%'; void f.offsetWidth; },
    toast(text) {
      const li = document.createElement('li');
      li.textContent = text;
      li.style.cssText = 'position:absolute;left:0;right:0;height:30px;background:#2a1b0e;color:#fff2cc;transition:top .2s,opacity .2s;top:200px';
      list.prepend(li);
      [...list.children].forEach((c, i) => { c.style.top = (170 - i * 34) + 'px'; });
      while (list.children.length > 5) list.lastChild.remove();
    },
    pop(i) {
      const s = document.querySelectorAll('.tools .sv-slot .sv-art')[i]; if (!s) return;
      s.style.animation = 'none'; void s.offsetWidth; s.style.animation = 'uf-low .3s 2 alternate';
    },
    unmount() { box?.remove(); box = null; },
  };
})();

// ---------- harness hooks for shoot.py ----------
const raf = () => new Promise(r => requestAnimationFrame(r));
async function frames(n, each) { for (let i = 0; i < n; i++) { each?.(i); await raf(); } }
const scenarios = {
  idle: () => frames(120),
  select: () => frames(120, i => { if (i % 3 === 0) select(bag.selectedIndex + 1); }),
  pickup: () => frames(120, i => { if (i % 10 === 0) pickup(['wood', 'barrel', 'leaf', 'plastic'][(i / 10) % 4]); }),
  toast: () => frames(120, i => { if (i % 4 === 0) feel.toast(['Wood', 'Palm Leaf', 'Hook getting worn', 'Crafted Rope'][(i / 4) % 4], { kind: ['loot', 'loot', 'warn', 'craft'][(i / 4) % 4], amount: (i / 4) % 4 < 2 ? 2 : 0 }); }),
  stats: () => frames(120, i => { if (i % 6 === 0) { const s = Object.values(stats)[(i / 6) % 3]; s.set(s.value > .3 ? s.value - .15 : .95); } }),
  crosshair: () => frames(120, i => {
    feel.crosshair.charge(i % 60 < 45 ? (i % 60) / 45 : null);
    if (i % 60 === 45) feel.crosshair.hit('hit');
    if (i % 20 === 0) setHover(!hover);
  }),
  inventory: async () => { for (let k = 0; k < 4; k++) { ui.open(); await frames(16); ui.close(); await frames(14); } },
  'naive-stats': async () => { naive.mount(); await frames(120, i => { if (i % 6 === 0) naive.bar((i / 6) % 3, (i % 24) / 30 + .1); }); naive.unmount(); },
  'naive-toast': async () => { naive.mount(); await frames(120, i => { if (i % 4 === 0) naive.toast('Wood +2'); }); naive.unmount(); },
  'naive-select': () => frames(120, i => { if (i % 3 === 0) naive.pop((i / 3) % 8); }),
};

window.feelDemo = {
  bag, ui, feel, stats, select, pickup, craft, setHover, beginCharge, releaseCharge, hurt, heal,
  scenarios: Object.keys(scenarios),
  // Pause every running animation (WAAPI, CSS transitions and CSS animations) at `ms` after its start.
  freeze(ms) { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms; } return document.getAnimations().length; },
  async run(name) {
    const deltas = []; let last = performance.now(), on = true;
    const tick = t => { if (!on) return; deltas.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const t0 = performance.now();
    await scenarios[name]();
    await frames(30); // let tails finish inside the window
    on = false;
    deltas.shift();
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    return { ms: performance.now() - t0, frames: deltas.length, avgFrame: +avg.toFixed(2), worstFrame: +Math.max(...deltas).toFixed(2) };
  },
};
document.documentElement.dataset.ready = '1';
