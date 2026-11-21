import * as T from '../../dist/vendor/three.module.js';
import { createHook } from '../../dist/hook.js';
import { createHammer } from '../../dist/hammer.js';
import { createFishingTool } from '../../dist/fishing-tool.js';
import { createPlastic } from '../../dist/plastic.js';
import { createCraft } from '../../dist/crafts.js';
import { createIconBaker, createSideRendererBaker } from './icon-baker.js';

// Icon pose per kind: tools lie on the diagonal (Raft / Minecraft convention), placeables in 3/4 view.
const ITEMS = [
  ['hook', () => createHook(T), { yaw: -70, pitch: 10, roll: -35 }],
  ['hammer', () => createHammer(T), { yaw: -60, pitch: 15, roll: -40 }],
  ['fishingrod', () => createFishingTool(T), { yaw: -20, pitch: 10, roll: -45 }],
  ['plastic', () => createPlastic(T), { yaw: -30, pitch: 15 }],
  ['sail', () => createCraft(T, 'sail'), { yaw: -40, pitch: 15 }],
  ['palm', () => createCraft(T, 'palm'), { yaw: -35, pitch: 20 }],
  ['lantern', () => createCraft(T, 'lantern'), { yaw: -30, pitch: 15 }],
  ['net', () => createCraft(T, 'net'), { yaw: -35, pitch: 45 }],
  ['bench', () => createCraft(T, 'bench'), { yaw: -35, pitch: 25 }],
  ['crate', () => createCraft(T, 'crate'), { yaw: -35, pitch: 25 }],
];

// Stand-in for the game renderer, configured like dist/game.js.
const canvas = document.getElementById('game');
const renderer = new T.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.shadowMap.enabled = true; renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.setClearColor(0x5aa9c9);
const gameScene = new T.Scene(), gameCam = new T.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, .1, 50);
gameScene.add(new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshNormalMaterial())); gameCam.position.set(1.5, 1.2, 2); gameCam.lookAt(0, 0, 0);

const report = { a: {}, b: {}, errors: [] };
const slot = (row, kind, url, ms) => {
  const d = document.createElement('figure');
  d.innerHTML = `<div class="slot"><img alt="" src="${url}"></div><figcaption>${kind}<br><small>${ms.toFixed(1)} ms</small></figcaption>`;
  document.getElementById(row).appendChild(d);
};

async function run() {
  const tA = performance.now();
  const baker = createIconBaker(T, renderer, { size: 96 });
  report.a.setupMs = performance.now() - tA;
  for (const [kind, make, pose] of ITEMS) {
    const e = await baker.bake(kind, make(), pose);
    report.a[kind] = e.ms; slot('rowA', kind, e.url, e.ms.total);
  }
  report.a.totalMs = performance.now() - tA;
  // the game frame after baking must look untouched (state restored)
  renderer.render(gameScene, gameCam);
  // hotbar mock using the cached URLs at 48 CSS px
  const bar = document.getElementById('hotbar');
  for (const k of ['hook', 'hammer', 'fishingrod', 'plastic', 'sail', 'lantern', 'net', 'crate'])
    bar.insertAdjacentHTML('beforeend', `<div class="hb"><img alt="" src="${baker.get(k).url}"></div>`);
  // 2D canvas consumer via ImageBitmap (no PNG decode)
  const c2 = document.getElementById('bitmaps').getContext('2d');
  ITEMS.forEach(([k], i) => c2.drawImage(baker.get(k).bitmap, (i % 5) * 64, Math.floor(i / 5) * 64, 64, 64));

  const tB = performance.now();
  const side = createSideRendererBaker(T, { size: 96 });
  report.b.setupMs = performance.now() - tB;
  for (const [kind, make, pose] of ITEMS) {
    const e = await side.bake(kind, make(), pose);
    report.b[kind] = e.ms; slot('rowB', kind, e.url, e.ms.total);
  }
  report.b.totalMs = performance.now() - tB;
  side.dispose();
  report.done = true;
}
run().catch(e => { report.errors.push(String(e.stack || e)); report.done = true; });
window.__iconReport = report;
