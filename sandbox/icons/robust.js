// Failure paths of the merged dist/item-icons.js (run by robust.py on a patched temp tree).
// Two module copies (different query) stand in for a live.js hot swap: build A, then build B.
const B = 'v3-survival-ae77fa84ac2b';
const R = window.__robust = { done: false, cases: {}, errors: [] };
addEventListener('error', e => R.errors.push(String(e.message)));
const gls = [];
const gc = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (t, ...a) { const c = gc.call(this, t, ...a); if (/webgl/.test(t) && c && !gls.includes(c)) gls.push(c); return c; };
const wait = ms => new Promise(r => setTimeout(r, ms));
// Icons are blob: object URLs now (toBlob encode, as on main); data URLs only under window.__det or without toBlob.
const isPng = u => typeof u === 'string' && (u.startsWith('blob:') || (u.startsWith('data:image/png;base64,') && u.length > 500));

async function run() {
  const { getModel } = await import(`../../dist/models.js?build=${B}`);
  const T = await import('../../dist/vendor/three.module.js');
  const A = await import(`../../dist/item-icons.js?build=${B}&copy=A`);
  const seen = []; A.onIconReady(k => seen.push(k));
  // provider that throws for plastic, returns an empty group for bench, else models.js
  A.setModelProvider(k => { if (k === 'plastic') throw new Error('boom'); if (k === 'bench') return new T.Group(); return getModel(k); });
  const [plastic, bench, sand, hook] = await Promise.all(['plastic', 'bench', 'sand', 'hook'].map(k => A.loadItemIcon(k)));
  R.cases.providerThrowsFallsBack = isPng(plastic);
  R.cases.emptyModelIsNull = bench === null;
  R.cases.noModelIsNull = sand === null;
  R.cases.ownModelPng = isPng(hook);
  R.cases.listenersFiredForRendered = seen.includes('plastic') && seen.includes('hook') && !seen.includes('bench');
  // context loss: kill the live icon context, then ask for more kinds; they must still render
  const ctx = gls[gls.length - 1];
  A.warmIcons(['crate']);
  ctx.getExtension('WEBGL_lose_context')?.loseContext();
  const [crate, net] = await Promise.all([A.loadItemIcon('crate'), A.loadItemIcon('net')]);
  R.cases.contextLossRecovered = isPng(crate) && isPng(net);
  R.contextsAfterLoss = gls.length;
  // provider swap: own-model kinds (hook, net) keep their URL, provider kinds re-render
  const hookBefore = A.getItemIcon('hook');
  A.setModelProvider(k => getModel(k));
  R.cases.providerSwapKeepsOwn = A.getItemIcon('hook') === hookBefore && A.getItemIcon('net') === net;
  R.cases.providerSwapRequeuesProvider = A.getItemIcon('bench') === null;
  const bench2 = await A.loadItemIcon('bench');
  R.cases.providerSwapRenders = isPng(bench2);
  // hot swap: copy B takes over; A stops rendering new kinds (null) but keeps what it has
  const Bm = await import(`../../dist/item-icons.js?build=${B}&copy=B`);   // importing alone claims nothing
  A.warmIcons(['lantern', 'fish', 'wood', 'rope', 'scrap']);
  const offB = Bm.onIconReady(() => {});   // the new engine's UI subscribes and sets its provider
  Bm.setModelProvider(k => getModel(k));   // B owns the queue from here (A's engine is disposed next)
  const t = performance.now();
  const aLate = await Promise.all(['lantern', 'fish', 'wood', 'rope', 'scrap'].map(k => A.loadItemIcon(k)));
  R.aLateNulls = aLate.filter(u => u === null).length;
  R.aStopMs = +(performance.now() - t).toFixed(0);
  R.cases.oldCopyStops = R.aLateNulls === 5 && A.getItemIcon('hook') === hookBefore;
  const bIcons = await Promise.all(['lantern', 'fish', 'hammer'].map(k => Bm.loadItemIcon(k)));
  R.cases.newCopyRenders = bIcons.every(isPng);
  // failed hot swap: copy C's mount() claims, subscribes, queues, then throws; its dispose() drops the
  // listener and live.js keeps B's engine. B must own the queue again; C must not render.
  const glsBeforeC = gls.length;
  const C = await import(`../../dist/item-icons.js?build=${B}&copy=C`);
  const offC = C.onIconReady(() => {});
  C.setModelProvider(k => getModel(k));
  C.warmIcons(['wood', 'rope', 'scrap', 'crate']);
  R.cases.failedSwapNewOwns = Bm.getItemIcon('wood') === null && Bm.getItemIcon('rope') === null;   // C owns while mounting
  offC();                                   // mount() failed: C's engine is disposed
  const bAfter = await Promise.all(['wood', 'rope', 'scrap'].map(k => Bm.loadItemIcon(k)));
  R.cases.failedSwapOldRenders = bAfter.every(isPng);
  await wait(200);
  R.cases.failedSwapDeadCopyIdle = C.getItemIcon('crate') === null && gls.length - glsBeforeC <= 1;
  offB();
  await wait(61500);   // RELEASE_MS is 60 s (main's value: the hotbar bake and the warm-all pass share one context)
  R.liveContextsAfterRelease = gls.filter(c => !c.isContextLost()).length;
  R.cases.contextsReleased = R.liveContextsAfterRelease === 0;
  // shared renderer (main's setIconRenderer, game.js:438): icons draw into a render target of the host's
  // context, no 128 px context is created, and the host's render state comes back unchanged
  const D = await import(`../../dist/item-icons.js?build=${B}&copy=D`);
  const glsBeforeD = gls.length;
  const hostCanvas = document.createElement('canvas'); hostCanvas.width = 320; hostCanvas.height = 200;
  const host = new T.WebGLRenderer({ canvas: hostCanvas });
  host.toneMapping = T.NeutralToneMapping; host.toneMappingExposure = 0.8; host.setClearColor(0x336699, 1);
  const offD = D.onIconReady(() => {});
  D.setIconRenderer(host);
  D.setModelProvider(k => getModel(k));
  const dIcons = await Promise.all(['hook', 'crate', 'cup', 'sand'].map(k => D.loadItemIcon(k)));
  const cc = new T.Color();
  R.hostState = { rt: host.getRenderTarget(), tm: host.toneMapping, exp: host.toneMappingExposure, clear: host.getClearColor(cc).getHex(), alpha: host.getClearAlpha(), shadow: host.shadowMap.enabled };
  R.cases.hostRendererRenders = isPng(dIcons[0]) && isPng(dIcons[1]) && isPng(dIcons[2]) && dIcons[3] === null;
  R.cases.hostRendererNoExtraContext = gls.length - glsBeforeD === 1;   // only the host's own context
  R.cases.hostStateRestored = R.hostState.rt === null && R.hostState.tm === T.NeutralToneMapping && R.hostState.exp === 0.8 && R.hostState.clear === 0x336699 && R.hostState.alpha === 1;
  offD(); host.dispose(); host.forceContextLoss();
  R.ok = Object.values(R.cases).every(Boolean);
  R.done = true;
}
run().catch(e => { R.errors.push(String(e && e.stack || e)); R.done = true; });
