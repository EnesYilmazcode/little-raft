"""Failure-path checks for icon-atlas.js (headless). Usage: python sandbox/icons/robust.py
1. make() throws mid-bake       -> rejects; renderer state restored; no GPU leak
2. render throws inside a tile  -> same
3. cancel after 2 tiles         -> null; no cache key; state restored; no leak
4. orphan: a newer build's key appears during the bake -> this bake does not delete it or write its own
5. stale key from an older build present at bake start -> removed when the new key is written
6. corrupt cache entries (missing kind, non-PNG value, array) -> readIconCache null -> rebake
Prints JSON with pass per case."""
import sys, json, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[2]
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/'
JS = r"""async () => {
  const T = await import('/dist/vendor/three.module.js');
  const A = await import('/sandbox/icons/icon-atlas.js');
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; document.body.append(c);
  const r = new T.WebGLRenderer({ canvas: c }); r.autoClear = true; r.shadowMap.enabled = true;
  const scene = new T.Scene(); scene.add(new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial())); scene.add(new T.DirectionalLight());
  const cam = new T.PerspectiveCamera(); cam.position.z = 3; r.render(scene, cam);
  const snap = () => ({ autoClear: r.autoClear, rt: r.getRenderTarget(), shadow: r.shadowMap.enabled, autoReset: r.info.autoReset,
    clear: r.getClearColor(new T.Color()).getHexString() + '/' + r.getClearAlpha(), geo: r.info.memory.geometries, tex: r.info.memory.textures });
  const base = snap();
  const same = s => JSON.stringify(s) === JSON.stringify(base);
  const box = () => new T.Mesh(new T.BoxGeometry(0.5, 0.5, 0.5), new T.MeshStandardMaterial({ color: '#c96' }));
  const items = (n, f = {}) => Array.from({ length: n }, (_, i) => ({ kind: 'k' + i, pose: {}, make: f[i] || box }));
  const out = {};
  const key = b => 'littleRaft.icons.' + A.ICON_ATLAS_VERSION + '.' + b;
  const clearLS = () => { for (const k of Object.keys(localStorage)) if (k.startsWith('littleRaft.icons.')) localStorage.removeItem(k); };
  // 1
  clearLS();
  try { await A.bakeIconAtlas(T, r, items(5, { 2: () => { throw new Error('boom make'); } }), { size: 32, cacheKey: 'b1' }); out.makeThrows = { pass: false, why: 'resolved' }; }
  catch (e) { r.render(scene, cam); const s = snap(); out.makeThrows = { pass: same(s) && !localStorage.getItem(key('b1')), err: String(e.message), state: s }; }
  // 2
  const bad = () => { const m = box(); m.onBeforeRender = () => { throw new Error('boom render'); }; return m; };
  try { await A.bakeIconAtlas(T, r, items(5, { 3: bad }), { size: 32 }); out.renderThrows = { pass: false, why: 'resolved' }; }
  catch (e) { r.render(scene, cam); const s = snap(); out.renderThrows = { pass: same(s), err: String(e.message), state: s }; }
  // 3
  clearLS(); let tiles = 0;
  const res3 = await A.bakeIconAtlas(T, r, items(6), { size: 32, cacheKey: 'b3', onTile: () => tiles++, isCancelled: () => tiles >= 2 });
  r.render(scene, cam);
  out.cancel = { pass: res3 === null && tiles === 2 && !localStorage.getItem(key('b3')) && same(snap()), tiles, state: snap() };
  // 4
  clearLS(); let n4 = 0;
  const res4 = await A.bakeIconAtlas(T, r, items(4), { size: 32, cacheKey: 'old', onTile: () => { if (++n4 === 2) localStorage.setItem(key('new'), '{"urls":{}}'); } });
  out.orphan = { pass: res4.stats.cached === false && !!localStorage.getItem(key('new')) && !localStorage.getItem(key('old')), cached: res4.stats.cached, keys: Object.keys(localStorage).filter(k => k.startsWith('littleRaft.icons.')) };
  // 5
  clearLS(); localStorage.setItem(key('older'), '{}'); localStorage.setItem('littleRaft.icons.ia3.x', '{}');
  const res5 = await A.bakeIconAtlas(T, r, items(3), { size: 32, cacheKey: 'cur' });
  const k5 = Object.keys(localStorage).filter(k => k.startsWith('littleRaft.icons.'));
  out.staleRemoved = { pass: res5.stats.cached === true && k5.length === 1 && k5[0] === key('cur'), keys: k5 };
  // 6
  const good = JSON.parse(localStorage.getItem(key('cur')));
  const kinds = ['k0', 'k1', 'k2'];
  const variants = {
    ok: good,
    missingKind: { ...good, urls: { k0: good.urls.k0, k1: good.urls.k1 } },
    notPng: { ...good, urls: { ...good.urls, k1: 'javascript:alert(1)' } },
    urlsArray: { ...good, urls: [good.urls.k0] },
    truncated: null,
  };
  const r6 = {};
  for (const [n, v] of Object.entries(variants)) {
    localStorage.setItem(key('cur'), v === null ? '{"urls":{"k0":"data:image/png;base64,' : JSON.stringify(v));
    r6[n] = !!A.readIconCache('cur', kinds);
  }
  localStorage.setItem(key('cur'), JSON.stringify(variants.missingKind));
  const rebake = await A.bakeIconAtlas(T, r, items(3), { size: 32, cacheKey: 'cur' });
  out.corrupt = { pass: r6.ok && !r6.missingKind && !r6.notPng && !r6.urlsArray && !r6.truncated && !rebake.fromCache && rebake.stats.cached, reads: r6 };
  out.allPass = Object.values(out).every(v => v.pass);
  return out;
}"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', headless=True,
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(); page.goto(base + 'sandbox/')   # plain same-origin page (directory listing), no sandbox app running
    res = page.evaluate(JS); b.close()
srv.shutdown()
print(json.dumps(res, indent=1))
sys.exit(0 if res.get('allPass') else 1)
