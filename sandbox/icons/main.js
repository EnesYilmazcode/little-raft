import * as T from '../../dist/vendor/three.module.js';
import { createWoodMaterial } from '../../dist/wood.js';
import { createCraft } from '../../dist/crafts.js';
import { ITEM_INFO } from '../../dist/inventory-state.js';
import { bakeIconAtlas, readIconCache } from './icon-atlas.js';
import { makeIconItems, bakeItemIcons } from './item-models.js';

const q = new URLSearchParams(location.search);
const MODE = q.get('mode') || 'sheet';
const SIZE = Number(q.get('size')) || 96;
document.body.classList.add(MODE === 'ui' ? 'ui' : 'sheet');
const report = { mode: MODE, dpr: devicePixelRatio, errors: [] };
window.__iconReport = report;

// ---- stand-in for the game renderer, configured like dist/game.js init() ----
const canvas = document.getElementById('game');
const renderer = new T.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
const scene = new T.Scene(); scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
scene.add(new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8));
const sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); sun.castShadow = true; scene.add(sun);
const sea = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: '#2f7f80', roughness: .35 }));
sea.rotation.x = -Math.PI / 2; sea.receiveShadow = true; scene.add(sea);
const cam = new T.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, .05, 200); cam.position.set(0, 2.2, 6); cam.lookAt(0, 1, 0);

// game.js `mat()` + TIMBER set: the shared material cache debris models draw from
const TIMBER = new Set(['#bb8a53', '#c69860', '#ad7c4a', '#5e4029', '#9c7649', '#c8995f', '#d3a368', '#8c6745', '#d5a265', '#a97d4c', '#b4824b', '#906f48', '#725942', '#756a49', '#ad8153']);
const materialCache = new Map();
function mat(color) {
  if (!materialCache.has(color)) materialCache.set(color, TIMBER.has(color) ? createWoodMaterial(T, color) : new T.MeshStandardMaterial({ color, roughness: .85, metalness: 0 }));
  return materialCache.get(color);
}
const raft = new T.Group(); scene.add(raft);
for (const [k, x] of [['sail', -1.8], ['palm', 0], ['crate', 1.8]]) { const g = createCraft(T, k); g.position.set(x, 0.2, 0); raft.add(g); }
const deck = new T.Mesh(new T.BoxGeometry(6, .2, 2.2), mat('#bb8a53')); deck.position.y = .1; deck.receiveShadow = true; raft.add(deck);

// frame loop: the "game" keeps rendering while icons bake, so hitches show up in frame times
const frames = []; let last = performance.now(), loop = true, tag = 'pre';
function tick() {
  if (!loop) return;
  const now = performance.now(); frames.push([tag, now - last]); last = now;
  raft.rotation.y = Math.sin(now / 900) * .1;
  renderer.render(scene, cam);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
const frameStats = t => { const f = frames.filter(x => x[0] === t).map(x => x[1]); if (!f.length) return null; return { n: f.length, avgMs: +(f.reduce((a, b) => a + b, 0) / f.length).toFixed(1), worstMs: +Math.max(...f).toFixed(1) }; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const infoSnap = () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length });

const KINDS = Object.keys(ITEM_INFO);
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; };
const svgFor = k => `<svg viewBox="0 0 48 48"><use href="../../dist/icons.svg#${ITEM_INFO[k].icon}"></use></svg>`;

async function bake() {
  await wait(300); tag = 'steady';
  await wait(700);
  report.infoBeforeBake = infoSnap();
  tag = 'bake';
  const items = makeIconItems(T, mat).filter(it => KINDS.includes(it.kind));
  const bakeOpts = { size: SIZE };
  if (q.has('unify')) bakeOpts.unify = q.get('unify') !== '0';
  if (q.has('env')) bakeOpts.env = q.get('env') !== '0';
  if (q.has('precompile')) bakeOpts.precompile = q.get('precompile') !== '0';
  report.bakeOpts = bakeOpts;
  const res = await bakeIconAtlas(T, renderer, items, bakeOpts);
  tag = 'post';
  await wait(600);
  report.stats = res.stats;
  report.frames = { steady: frameStats('steady'), duringBake: frameStats('bake'), afterBake: frameStats('post'), bakeFrameList: frames.filter(x => x[0] === 'bake').map(x => Math.round(x[1])) };
  report.infoAfterBake = infoSnap();
  // engine entry point + cache round trip: first call bakes and stores, second is a cache hit
  try { localStorage.clear(); } catch {}
  await bakeItemIcons(T, renderer, mat, 'sandbox', KINDS);
  const tc = performance.now(); const urls = await bakeItemIcons(T, renderer, mat, 'sandbox', KINDS);
  report.cacheHitMs = +(performance.now() - tc).toFixed(2); report.cacheHit = !!readIconCache('sandbox');
  res.blobUrls = urls;
  return res;
}

function buildSheet(res) {
  const root = document.getElementById('sheetRoot');
  root.append(el('h2', {}, `Baked icon sheet, native ${SIZE} px (atlas ${res.atlas.width}x${res.atlas.height})`));
  const row = el('div', { class: 'row', id: 'native' });
  for (const k of KINDS) row.append(el('figure', {}, `<div class="checker"><img alt="" src="${res.urls[k]}"></div><figcaption>${k}</figcaption>`));
  root.append(row);
  const strip = (id, cls, s, i, src) => {
    const d = el('div', { class: 'strip ' + cls, id, style: `--s:${s}px;--i:${i}px` });
    for (const k of KINDS) d.append(el('div', { class: 'cell' }, src(k)));
    return d;
  };
  const img = k => `<img alt="" src="${res.urls[k]}">`;
  root.append(el('h2', {}, 'In-slot sizes: hotbar 58 px slot (40 px art), bag 52 px, recipe 34 px, cost chip 18 px'));
  root.append(strip('s58', '', 58, 6, img));
  root.append(el('div', { style: 'height:6px' }));
  root.append(strip('s52', '', 52, 5, img));
  root.append(el('div', { style: 'height:6px' }));
  root.append(strip('s34', 'light', 40, 3, img));
  root.append(el('div', { style: 'height:6px' }));
  root.append(strip('s18', 'sea', 22, 2, img));
  root.append(el('h2', {}, 'Current SVG sprite (top) vs baked (bottom), 52 px slots'));
  const cmp = el('div', { id: 'compare' });
  cmp.append(strip('cmpSvg', '', 52, 8, svgFor)); cmp.append(el('div', { style: 'height:4px' })); cmp.append(strip('cmpBaked', '', 52, 5, img));
  root.append(cmp);
  root.append(el('h2', {}, 'Game canvas after baking (renderer state restored)'));
  root.append(canvas);
  root.append(el('pre', { id: 'stats' }, JSON.stringify({ ...report.stats, tiles: undefined }, null, 0).replace(/,"/g, ', "')));
}

// ---- UI mode: the real survival UI (patched copy of dist/survival-ui.js, see shoot.py) ----
function fakeBag() {
  const slots = new Array(28).fill(null);
  const put = (i, kind, count = 1, durability) => { slots[i] = { kind, count }; if (durability != null) slots[i].durability = durability; };
  put(0, 'hook', 1, 100); put(1, 'hammer', 1, 64); put(2, 'fishingrod', 1, 22); put(3, 'wood', 14); put(4, 'plastic', 7);
  put(5, 'rope', 3); put(6, 'fish', 2); put(7, 'lantern', 1);
  put(8, 'leaf', 9); put(9, 'scrap', 4); put(10, 'sail', 1); put(11, 'palm', 2); put(12, 'net', 1); put(13, 'bench', 1); put(14, 'crate', 3);
  put(15, 'wood', 20); put(16, 'leaf', 20); put(18, 'fish', 5);
  const count = k => slots.reduce((a, s) => a + (s && s.kind === k ? s.count : 0), 0);
  return { snapshot: () => ({ slots, selected: 1 }), count, canCraft: () => null };
}
async function buildUI(res) {
  const ui = await import('./_patched/survival-ui.js');
  const late = q.has('late');   // bag already open with SVG icons when the bake lands
  if (res && !q.has('svg') && !late) ui.setItemIcons(res.blobUrls);
  const bag = fakeBag();
  const api = ui.createSurvivalUI({ getBag: () => bag });
  api.update();
  if (q.get('open') !== '0') api.open();
  if (late) {
    await wait(300);
    const svgBefore = document.querySelectorAll('#inventory svg').length;
    ui.setItemIcons(res.blobUrls);   // no reopen, no extra update() call: setItemIcons repaints
    await wait(50);
    report.lateSwap = { svgBefore, svgAfter: document.querySelectorAll('#inventory svg').length,
      bakedImgs: document.querySelectorAll('#inventory img.sv-baked').length, stillOpen: api.isOpen };
  }
  await wait(400);
}

(async () => {
  try {
    const res = q.has('svg') && MODE === 'ui' ? null : await bake();
    if (MODE === 'ui') await buildUI(res);
    else buildSheet(res);
    await wait(300);
    loop = false; renderer.render(scene, cam);
  } catch (e) { report.errors.push(String(e.stack || e)); }
  report.done = true;
})();
