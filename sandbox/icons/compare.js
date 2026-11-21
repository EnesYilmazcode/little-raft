// Side-by-side cost/look harness for the three icon pipelines, run by shoot.py on a temp tree:
//   v=main    dist/item-icons.main.js  (main's lazy idle renderer, unchanged copy)
//   v=fleet   sandbox/icons/item-models.js bakeItemIcons (game-renderer atlas baker, 15 legacy kinds)
//   v=merged  dist/item-icons.js        (sandbox/icons/item-icons.js dropped in by adopt_patch.py)
// A small game-like scene renders every rAF so the worst frame during the bake is measured.
// window.__cmp = { done, v, kinds, urls: {kind: url|null}, totalMs, worstFrameMs, avgFrameMs, links, ... }
import * as T from '../../dist/vendor/three.module.js';
import { ITEM_IDS } from '../../dist/items.js';

const Q = new URLSearchParams(location.search), V = Q.get('v') || 'main', B = 'v3-survival-ae77fa84ac2b';

// count GL program links per context (main/merged use a private renderer we cannot read info from)
const R = window.__cmp = { done: false, v: V, errors: [] };
addEventListener('error', e => R.errors.push(String(e.message)));
let links = 0;
for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
  if (!C) continue; const L = C.prototype.linkProgram;
  C.prototype.linkProgram = function (p) { links++; return L.call(this, p); };
  const S = C.prototype.shaderSource;
  C.prototype.shaderSource = function (sh, src) {
    if (/gl_FragColor|pc_fragColor/.test(src) && Q.get('defs')) (R.defs ||= []).push(src.split('\n').filter(l => /^#define (USE_|DOUBLE|FLAT|ALPHA|TONE|OPAQUE|PREMULT)/.test(l)).join(' '));
    return S.call(this, sh, src);
  };
}
let contexts = 0;
const gc = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (t, ...a) { if (/webgl/.test(t)) contexts++; return gc.call(this, t, ...a); };

// game-like foreground scene
const canvas = document.createElement('canvas'); document.body.appendChild(canvas);
const renderer = new T.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(480, 270, false); renderer.toneMapping = T.ACESFilmicToneMapping;
const scene = new T.Scene(), cam = new T.PerspectiveCamera(60, 16 / 9, 0.1, 100); cam.position.set(0, 2, 6); cam.lookAt(0, 0, 0);
scene.add(new T.HemisphereLight(0xffffff, 0x334455, 2));
const sea = new T.Mesh(new T.PlaneGeometry(40, 40, 32, 32), new T.MeshStandardMaterial({ color: 0x2a7fa0, roughness: 0.3 })); sea.rotation.x = -Math.PI / 2; scene.add(sea);
for (let i = 0; i < 12; i++) { const b = new T.Mesh(new T.BoxGeometry(1, 0.2, 1), new T.MeshStandardMaterial({ color: 0xc48c55 })); b.position.set((i % 4) - 1.5, 0.1, Math.floor(i / 4) - 1); scene.add(b); }
const frames = []; let last = 0, measuring = false;
function loop(t) { if (measuring && last) frames.push(t - last); last = t; renderer.render(scene, cam); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  await wait(400);
  const kinds = [...ITEM_IDS];
  R.kinds = kinds;
  const links0 = links, ctx0 = contexts;
  measuring = true; frames.length = 0;
  const t0 = performance.now();
  let urls = {};
  if (V === 'fleet') {
    const { bakeItemIcons } = await import('./item-models.js');
    const mats = new Map(), mat = c => { let m = mats.get(c); if (!m) mats.set(c, m = new T.MeshStandardMaterial({ color: c, roughness: 0.85 })); return m; };
    const res = await bakeItemIcons(T, renderer, mat, Q.get('cache') ? B : 'dev', kinds);
    // blob URLs -> data URLs so shoot.py can carry them to the sheet page
    for (const k of kinds) {
      const u = res?.[k];
      urls[k] = u ? await fetch(u).then(r => r.blob()).then(b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); })) : null;
    }
  } else {
    const m = await import(`../../dist/item-icons${V === 'main' ? '.main' : ''}.js?build=${B}`);
    const { getModel } = await import(`../../dist/models.js?build=${B}`);
    m.setModelProvider(k => getModel(k));
    const per = {};
    const got = await Promise.all(kinds.map(k => m.loadItemIcon(k).then(u => { per[k] = +(performance.now() - t0).toFixed(0); return u; })));
    kinds.forEach((k, i) => { urls[k] = got[i]; });
    R.readyAtMs = per;
    R.syncHitMs = (() => { const t = performance.now(); for (const k of kinds) m.getItemIcon(k); return +(performance.now() - t).toFixed(2); })();
  }
  R.totalMs = +(performance.now() - t0).toFixed(0);
  await wait(3000);   // main/merged release their private context after 2.5 s
  measuring = false;
  R.urls = urls;
  R.rendered = kinds.filter(k => urls[k]).length;
  R.urlBytes = Object.values(urls).reduce((a, u) => a + (u ? u.length : 0), 0);
  R.links = links - links0; R.defsOut = R.defs; R.contexts = contexts - ctx0;
  R.worstFrameMs = +Math.max(0, ...frames).toFixed(0);
  R.avgFrameMs = +(frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)).toFixed(1);
  R.framesOver100 = frames.filter(f => f > 100).length;
  R.gameInfo = { programs: renderer.info.programs?.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
  R.ls = Object.keys(localStorage).filter(k => k.startsWith('littleRaft.icons')).map(k => [k, localStorage.getItem(k).length]);
  R.done = true;
}
run().catch(e => { R.errors.push(String(e && e.stack || e)); R.done = true; });
