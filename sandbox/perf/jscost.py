"""Main-thread costs outside renderer.render, measured in the running game (live clock, 1280x720, SwiftShader).
Usage: python sandbox/perf/jscost.py [--dist DIR] [--big] [--pose spawn|sailing]
Reports:
  stateMs        one read of window.raftDebug.state (the big diagnostic getter; prompts.js reads it every 100 ms,
                 onboarding.js every 250 ms)
  promptsTickMs  one raftPrompts.refresh() (prompts.js tick: raftDebug.state + raycasts + DOM)
  frameLogicMs   game frame() minus renderer.render, median over 40 frames (probe.js logicMs)
  uploads        bytes per frame sent with bufferSubData/bufferData, by the dist function that sent them
Times are wall clock on a loaded box: compare rows of one run, not runs."""
import argparse, json, sys, threading, http.server, socketserver, functools
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]
ap = argparse.ArgumentParser(); ap.add_argument('--dist', default=str(ROOT / 'dist')); ap.add_argument('--big', action='store_true'); ap.add_argument('--pose', default='spawn')
a = ap.parse_args()
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *x): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(Path(a.dist).resolve())))
threading.Thread(target=srv.serve_forever, daemon=True).start()
UPLOADS = r"""(() => {
  const U = window.__uploads = { on: false, frames: 0, by: {} };
  const site = () => { const st = new Error().stack.split('\n').slice(2); const f = st.find(l => /\/(?!vendor)[\w-]+\.js/.test(l) && !/three\.module/.test(l)) || st[st.length - 1] || ''; const m = f.match(/at (\S+).*\/([\w-]+\.js)[^:]*:(\d+)/); return m ? `${m[1]} ${m[2]}:${m[3]}` : f.trim().slice(0, 80); };
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) for (const fn of ['bufferSubData', 'bufferData']) {
    const o = C.prototype[fn]; C.prototype[fn] = function (t, d, ...r) { if (U.on) { const n = typeof d === 'number' ? d : (d?.byteLength ?? 0); const k = fn + ' ' + site(); U.by[k] = (U.by[k] || 0) + n; } return o.call(this, t, d, ...r); };
  }
  const raf = requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => { if (U.on) U.frames++; cb(t); });
})()"""
save = None
if a.big:
    decor = [{'type': t, 'x': x, 'z': z} for (t, x, z) in [('sail', 0, 2), ('palm', -2, -2), ('lantern', 2, -2), ('net', 3, 3), ('bench', -3, 1), ('crate', 2, 1),
             ('crate', -1, 3), ('lantern', -3, -3), ('palm', 3, -1), ('bench', 1, -3), ('net', -3, 3), ('sail', -2, 0)]]
    save = {'tiles': [[x, z] for x in range(-3, 4) for z in range(-3, 4)], 'decor': decor, 'stock': {}, 'fish': 0, 'collected': 0}
    if a.pose == 'sailing': save['sailing'] = {'raised': True, 'heading': 0.6, 'windDir': 0.6, 'windTarget': 0.6, 'windStr': 1, 'windStrTarget': 1}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 720})
    if save: ctx.add_init_script("try { localStorage.setItem('little-raft-v1', %s) } catch (e) {}" % json.dumps(json.dumps(save)))
    ctx.add_init_script(UPLOADS); ctx.add_init_script('window.__perfFreezeAt = undefined;'); ctx.add_init_script((HERE / 'probe.js').read_text())
    pg = ctx.new_page(); pg.set_default_timeout(300000)
    pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/index.html'); pg.wait_for_function("!!window.raftDebug && !!document.querySelector('#solo') && !document.querySelector('#solo').disabled")
    pg.evaluate("document.querySelector('#solo').click()"); pg.wait_for_function('raftDebug.state.running')
    pg.evaluate("__perf.install(new URL('vendor/three.module.js', location.href).href)")
    pg.wait_for_timeout(4000)
    out = pg.evaluate("""async () => {
      const t = f => { f(); const t0 = performance.now(); for (let i = 0; i < 40; i++) f(); return +((performance.now() - t0) / 40).toFixed(3); };
      const r = { stateMs: t(() => raftDebug.state), promptsTickMs: window.raftPrompts ? t(() => raftPrompts.refresh()) : null,
        renderInfoMs: t(() => raftDebug.renderInfo) };
      __uploads.on = true; const m = await __perf.measure(20, 3); __uploads.on = false;
      r.frameLogicMs = m.logicMs; r.submitMs = m.submitMs; r.frames = __uploads.frames;
      r.uploadsKBperFrame = Object.fromEntries(Object.entries(__uploads.by).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, +(v / 1024 / __uploads.frames).toFixed(1)]));
      return r; }""")
    out['pointerLocked'] = pg.evaluate('raftDebug.state.pointerLocked')
    # CDP sampling profile of the live game (4 s): main-thread self time by function
    cdp = ctx.new_cdp_session(pg); cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 200}); cdp.send('Profiler.start')
    pg.wait_for_timeout(4000); prof = cdp.send('Profiler.stop')['profile']
    nodes = {n['id']: n for n in prof['nodes']}; self_ms = {}
    for sid, dt in zip(prof['samples'][1:], prof['timeDeltas'][1:]):
        cf = nodes[sid]['callFrame']; k = f"{cf['functionName'] or '(anon)'} {Path(cf['url'].split('?')[0]).name}:{cf['lineNumber'] + 1}" if cf['url'] else cf['functionName'] or '(native)'
        self_ms[k] = self_ms.get(k, 0) + dt / 1000
    out['cdpSelfMs4s'] = {k: round(v, 1) for k, v in sorted(self_ms.items(), key=lambda kv: -kv[1])[:15]}
    print(json.dumps(out, indent=1))
    b.close()
srv.shutdown()
