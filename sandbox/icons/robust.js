// Failure paths of the merged dist/item-icons.js (run by robust.py on a patched temp tree).
// Two module copies (different query) stand in for a live.js hot swap: build A, then build B.
const B = 'v3-survival-ae77fa84ac2b';
const R = window.__robust = { done: false, cases: {}, errors: [] };
addEventListener('error', e => R.errors.push(String(e.message)));
const gls = [];
const gc = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (t, ...a) { const c = gc.call(this, t, ...a); if (/webgl/.test(t) && c && !gls.includes(c)) gls.push(c); return c; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const isPng = u => typeof u === 'string' && u.startsWith('data:image/png;base64,') && u.length > 500;

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
  Bm.setModelProvider(k => getModel(k));   // the new engine's UI mounts: B owns the queue from here
  const t = performance.now();
  const aLate = await Promise.all(['lantern', 'fish', 'wood', 'rope', 'scrap'].map(k => A.loadItemIcon(k)));
  R.aLateNulls = aLate.filter(u => u === null).length;
  R.aStopMs = +(performance.now() - t).toFixed(0);
  R.cases.oldCopyStops = R.aLateNulls === 5 && A.getItemIcon('hook') === hookBefore;
  const bIcons = await Promise.all(['lantern', 'fish', 'hammer'].map(k => Bm.loadItemIcon(k)));
  R.cases.newCopyRenders = bIcons.every(isPng);
  await wait(3200);
  R.liveContextsAfterRelease = gls.filter(c => !c.isContextLost()).length;
  R.cases.contextsReleased = R.liveContextsAfterRelease === 0;
  R.ok = Object.values(R.cases).every(Boolean);
  R.done = true;
}
run().catch(e => { R.errors.push(String(e && e.stack || e)); R.done = true; });
