"""Apply (or dry-run check) the audio adoption described in docs/tech/audio-ADOPT.md, against the CURRENT dist/.

  python sandbox/audio/adopt.py --check        copy dist/ to a temp dir, apply, boot the game headless, verify audio
  python sandbox/audio/adopt.py --apply        apply to dist/ in place (run --check first)

dist/game.js already imports createOceanAudio from './audio.js?build=...' and drives it (play/tick/setBus/
resume/destroy, X.audio hand-over on hot updates), so the engine is a file swap: sandbox/audio/audio.js
replaces dist/audio.js (worklet URL stamped with the same ?build=) and audio-worklet.js is added. The three
game.js edits below are optional extras (sailing state to tick(), the spatial listener, station/grill
sounds); every one is an exact old -> new replacement that must match exactly once, so this fails loudly
instead of half-applying if game.js has drifted.

--check runs, on a temp copy served over http (live.js polls version.json there):
  boot -> solo -> first gesture -> engine checks (one context, worklet module carries ?build=, ocean playing,
  limiter routed into diving's output low-pass, every EVENT schedules, underwater event, sailing edges)
  failed hot update (game.js mount() throws after it has taken the ocean over) -> ocean level must hold and
  the old engine must own the ocean again
  good hot update -> one context, the ocean handed over (no second worklet node, no module load), level
  holds, the new engine re-routes into the new diving module's low-pass
"""
import sys, re, json, math, time, shutil, tempfile, threading, functools, http.server, socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
# --engine PATH checks another audio.js build (e.g. the round-2 engine) through the same steps
ENGINE = Path(sys.argv[sys.argv.index('--engine') + 1]).resolve() if '--engine' in sys.argv else HERE / 'audio.js'

# anchors that must already be there (the engine relies on them; nothing is changed)
REQUIRE = [
    "import { createOceanAudio } from './audio.js?build={BUILD}';\n",
    "  const sfx = createOceanAudio({context:X?.audio ?? null, volume:sound ? options.volume : 0, output:ctx => diving?.audioOut(ctx) ?? null}); // diving lane hook: muffled underwater\n",
    "  if (X?.audio) sfx.resume(); // hot swap: the old context is already unlocked\n",
    "hook, castId, hookSlot, lastCaughtCount, fishWait, sound, audio:sfx.context, peer,",
    "    pause(); disposed = true; ac.abort(); sfx.destroy(); offIconReady?.();\n",
]

EDITS = [
    # 1. one reusable tick-state object (no per-frame allocation) and a scratch vector for the listener
    ("  let sailing = null; const scenery = [], sailFlow = {x:0, z:0}, aimNdc = {x:0, y:0}; // [sailing]\n",
     "  let sailing = null; const scenery = [], sailFlow = {x:0, z:0}, aimNdc = {x:0, y:0}; // [sailing]\n"
     "  const sfxSt = {swimming:false, sail:null, flow:sailFlow}, earDir = new T.Vector3(); // [audio] tick state + listener scratch\n"),
    # 2. tick(): sailing state (wind level, luff loop while the sail is up, sail/anchor toggles, hull speed).
    #    Diving needs no edit: the engine listens to diving.js's 'raft:underwater' event.
    ("    ocean.update(elapsed, camera); sfx.tick(dt, {swimming:physics.swimming});\n",
     "    ocean.update(elapsed, camera); sfxSt.swimming = physics.swimming; sfxSt.sail = sailing ? world.sailing : null; sfx.tick(dt, sfxSt); // [audio]\n"),
    # 3. the PannerNode listener follows the camera (spatial station / sail sounds, ambient gulls)
    ("    updateAvatars(dt); updateCamera(dt); if (running) diving?.update(dt, elapsed); // diving lane hook\n",
     "    updateAvatars(dt); updateCamera(dt); if (running) diving?.update(dt, elapsed); // diving lane hook\n"
     "    if (sfx.context) { camera.getWorldDirection(earDir); sfx.setListener(camera.position.x, camera.position.y, camera.position.z, earDir.x, earDir.y, earDir.z); } // [audio]\n"),
    # 4. smelter / grill / driftwood-grill sounds, only once the host has accepted the action. The host's
    #    applyAction() fingerprints what the action would change (the actor's bag for prog:*, the grill's
    #    slots for fc:cook) before the hook runs, and if it changed, emits a {kind:'sfx'} effect to the actor:
    #    played locally for the host, sent to a guest (a rejected or unconnected action stays silent).
    ("  function applyAction(a, actor = 'host') {\n",
     "  function stationCue(a, actor) { // [audio] station + cooking cue, emitted to the actor once the action took\n"
     "    try {\n"
     "      let ev, x, z, sig;\n"
     "      if (a.kind === 'fc:cook') { const g = fc?.grills?.get(a.id); if (!g) return null; ev = 'sizzle'; x = g.st.x; z = g.st.z; sig = () => g.st.slots.filter(Boolean).length; }\n"
     "      else if (a.kind === 'prog:fuel' || a.kind === 'prog:insert' || a.kind === 'prog:take') {\n"
     "        [x, z] = String(a.key).split(',').map(Number); const d = world.decor.find(o => o.x === x && o.z === z); if (!d) return null;\n"
     "        ev = a.kind === 'prog:fuel' ? 'stoke' : a.kind === 'prog:take' ? (d.type === 'smelter' ? 'ingot' : 'grab') : d.type === 'smelter' ? 'clank' : 'sizzle';\n"
     "        const bag = actorBag(actor); sig = () => JSON.stringify(bag.snapshot());\n"
     "      } else return null;\n"
     "      const before = sig();\n"
     "      return () => { try { if (sig() !== before) emit({kind:'sfx', sound:ev, x:x * 2, z:z * 2}, actor); } catch {} };\n"
     "    } catch { return null; }\n"
     "  }\n"
     "  function applyAction(a, actor = 'host') {\n"),
    ("    if (prog?.apply(a, actor)) return; // [progression-hook] locked crafts + 'prog:*' actions\n",
     "    const cue = stationCue(a, actor); // [audio]\n"
     "    if (prog?.apply(a, actor)) { cue?.(); return; } // [progression-hook] locked crafts + 'prog:*' actions\n"),
    ("emit:text => emit({kind:'notice', text}, actor)}); return; } // [fishing-cooking]\n",
     "emit:text => emit({kind:'notice', text}, actor)}); cue?.(); return; } // [fishing-cooking] [audio] cue\n"),
    # the cue on both roles: spatial at the station's tile, nothing else (no notice, no fallback 'deny')
    ("    if (prog?.effect(e)) return; // [progression-hook]\n",
     "    if (prog?.effect(e)) return; // [progression-hook]\n"
     "    if (e.kind === 'sfx') { if (typeof e.sound === 'string') sfx.play(e.sound, 1, Number.isFinite(e.x) && Number.isFinite(e.z) ? {x:e.x, y:.6, z:e.z} : undefined); return; } // [audio] stationCue\n"),
]


def build_token(src):
    m = re.search(r"from '\./audio\.js\?build=([^'\"]+)'", src)
    if not m:
        raise SystemExit("cannot find the ./audio.js?build= import in game.js")
    return m[1]


def apply(dist: Path, edits=True):
    game = dist / 'game.js'
    src = game.read_text(encoding='utf-8')
    build = build_token(src)
    for a in REQUIRE:
        a = a.replace('{BUILD}', build)
        n = src.count(a)
        if n != 1:
            raise SystemExit(f'required anchor matched {n} times (expected 1):\n{a}')
    if edits:
        for old, new in EDITS:
            n = src.count(old)
            if n != 1:
                raise SystemExit(f'edit anchor matched {n} times (expected 1):\n{old}')
            src = src.replace(old, new)
        game.write_text(src, encoding='utf-8')
    eng = ENGINE.read_text(encoding='utf-8')
    if eng.count("'./audio-worklet.js'") != 1:
        raise SystemExit("engine: the './audio-worklet.js' literal must appear exactly once")
    (dist / 'audio.js').write_text(eng.replace("'./audio-worklet.js'", f"'./audio-worklet.js?build={build}'"), encoding='utf-8')
    shutil.copyfile(HERE / 'audio-worklet.js', dist / 'audio-worklet.js')
    return build


FAIL_ANCHOR = "    init();\n"
FAIL_INJECT = "    init(); if (X) throw new Error('adopt --check: injected mount failure after the ocean takeover');\n"


def republish(dist: Path, build: str, fail=False, base=None):
    """What publish_local.py does to a release, on the temp copy: stamp every './name.js' literal (the
    worklet URL in audio.js included) with the new ?build= and bump version.json, which live.js polls.
    fail=True publishes a game.js whose mount() throws after sfx.resume() has taken the ocean over;
    base = {file: text} restores the files of the last good build first."""
    if base:
        for name, text in base.items():
            (dist / name).write_text(text, encoding='utf-8')
    for f in dist.glob('*.js'):
        t = f.read_text(encoding='utf-8')
        t = re.sub(r"""(['"])(\./[a-z][a-z0-9-]*\.js)(?:\?[^'"]*)?\1""",
                   lambda m: m[1] + m[2] + '?build=' + build + m[1] if (dist / m[2][2:]).exists() else m[0], t)
        if fail and f.name == 'game.js':
            if t.count(FAIL_ANCHOR) != 1:
                raise SystemExit('cannot inject the failing mount: init() anchor not unique')
            t = t.replace(FAIL_ANCHOR, FAIL_INJECT)
        f.write_text(t, encoding='utf-8')
    (dist / 'version.json').write_text(json.dumps({'build': build, 'protocol': json.loads(PROTO)['protocol']}), encoding='utf-8')


PROTO = '{"protocol": 1}'

# Test probe: counts contexts, worklet nodes and modules, and taps everything that reaches ctx.destination
# with a recorder worklet (audio thread, so its timing is exact) that posts the output RMS every 20 ms.
# mounts: ctx time of each engine's buildGraph() (its limiter); disposed: when a limiter is disconnected.
PROBE = """
  window.__aud = { modules: [], worklets: 0, oscillators: 0, panners: 0, contexts: 0, ctxs: [], level: [], mounts: [], disposed: [], engineContexts: 0 };
  const A = window.__aud, B = BaseAudioContext.prototype;
  const wrap = (k, key) => { const f = B[k]; B[k] = function (...a) { A[key]++; return f.apply(this, a); }; };
  wrap('createOscillator', 'oscillators'); wrap('createPanner', 'panners');
  const dc = B.createDynamicsCompressor;
  // the engine's context is the one with limiters (onboarding.js keeps a separate context for its chime)
  B.createDynamicsCompressor = function (...a) { A.mounts.push(this.currentTime); if (!this.__engine) { this.__engine = true; A.engineContexts++; } return dc.apply(this, a); };
  const dn = AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect = function (...a) {
    if (this instanceof DynamicsCompressorNode && !a.length) A.disposed.push(this.context.currentTime);
    if (a[0] instanceof AudioDestinationNode && this.context.__recNode) { try { dn.call(this, this.context.__recNode); } catch (_) {} }  // re-routed: drop the tap too
    return dn.apply(this, a);
  };
  const add = AudioWorklet.prototype.addModule;
  AudioWorklet.prototype.addModule = function (u, ...r) { A.modules.push(String(u)); return add.call(this, u, ...r); };
  const W = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends W { constructor(...a) { super(...a); A.worklets++; } };
  const C = window.AudioContext;
  window.AudioContext = class extends C { constructor(...a) { super(...a); A.contexts++; A.ctxs.push(this); } };
  const REC = `registerProcessor('probe-rec', class extends AudioWorkletProcessor {
    constructor() { super(); this.s = 0; this.n = 0; }
    process(ins) {
      const i = ins[0];
      if (i && i.length) { for (const ch of i) for (let k = 0; k < ch.length; k++) this.s += ch[k] * ch[k]; this.n += i[0].length * i.length; }
      else { this.n += 256; this.e = (this.e || 0) + 1; }
      if (this.n >= sampleRate / 25) { this.port.postMessage([currentTime, 10 * Math.log10(this.s / this.n + 1e-12), this.e || 0]); this.s = 0; this.n = 0; this.e = 0; }
      return true;
    } });`;
  const conn = AudioNode.prototype.connect;
  // tap everything that feeds the speakers: ctx.destination directly, or a node that itself feeds it
  // (diving's output low-pass): record at the destination input by tapping the low-pass's output
  AudioNode.prototype.connect = function (d, ...r) {
    if (d instanceof AudioDestinationNode && d.context.__engine && !(this instanceof AudioWorkletNode && this.__probe)) {
      const ctx = d.context, src = this;
      if (!ctx.__rec) ctx.__rec = add.call(ctx.audioWorklet, URL.createObjectURL(new Blob([REC], { type: 'text/javascript' }))).then(() => {
        const n = new W(ctx, 'probe-rec', { numberOfInputs: 1, numberOfOutputs: 1 }); n.__probe = true;
        const z = ctx.createGain(); z.gain.value = 0; conn.call(n, z); conn.call(z, ctx.destination);   // always pulled
        n.port.onmessage = (e) => { if (A.level.length < 30000) A.level.push(e.data); };
        ctx.__recNode = n;
        return n;
      });
      if (ctx.__recNode) conn.call(src, ctx.__recNode);
      else ctx.__rec.then((n) => { try { conn.call(src, n); } catch (_) {} });
    }
    return conn.call(this, d, ...r);
  };
"""


def smooth(lv):
    """100 ms moving RMS (dB) over the 20 ms recorder blocks -> [(t, dB)]"""
    sm = []
    for i in range(len(lv)):
        w = lv[max(0, i - 4):i + 1]
        sm.append((w[-1][0], 10 * math.log10(sum(10 ** (x[1] / 10) for x in w) / len(w))))
    return sm


def worst_dip(sm, t0, t1):
    """The swell alone moves the ocean ~8 dB over a few seconds, so a drop-out is measured against the
    trailing 1 s: dip = median(previous 1 s) - this 100 ms window; the worst one in [t0, t1)."""
    worst = None
    for k, (t, v) in enumerate(sm):
        if not (t0 <= t < t1):
            continue
        prev = sorted(x for tt, x in sm[max(0, k - 60):k] if t - 1.0 <= tt < t - 0.1)
        if not prev:
            continue
        d = prev[len(prev) // 2] - v
        if worst is None or d > worst[0]:
            worst = (d, t, v)
    return worst


def window_report(sm, lv, t0, t1):
    w = worst_dip(sm, t0, t1)
    lo = [v for t, v in sm if t0 <= t < t1]
    return {'dip_db': w and round(w[0], 1), 'dip_at_s': w and round(w[1] - t0, 2), 'level_at_dip_db': w and round(w[2], 1),
            'min_level_db': round(min(lo), 1) if lo else None, 'median_level_db': round(sorted(lo)[len(lo) // 2], 1) if lo else None,
            'empty_input_blocks': [round(x[0] - t0, 2) for x in lv if x[2] and t0 <= x[0] < t1]}


def check():
    from playwright.sync_api import sync_playwright
    tmp = Path(tempfile.mkdtemp(prefix='raft-audio-adopt-'))
    dist = tmp / 'dist'
    shutil.copytree(ROOT / 'dist', dist)
    build = apply(dist)
    global PROTO
    PROTO = (dist / 'version.json').read_text(encoding='utf-8')
    good = {f.name: f.read_text(encoding='utf-8') for f in dist.glob('*.js')}

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
    srv.daemon_threads = True
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    rep = {'build': build, 'errors': [], 'console': []}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
                              args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = b.new_page(viewport={'width': 1280, 'height': 720})
        page.add_init_script(PROBE)
        page.on('pageerror', lambda e: rep['errors'].append(str(e)))
        page.on('console', lambda m: m.type in ('error', 'warning') and 'GL Driver' not in m.text and rep['console'].append(m.text[:300]))
        page.goto(f'http://127.0.0.1:{port}/')
        page.wait_for_function('!!window.raftDebug', timeout=60000)
        page.evaluate("document.querySelector('#solo').click()")   # the title card may still be animating in
        page.wait_for_function('raftDebug.state.running', timeout=60000)
        page.mouse.click(640, 360)                       # user gesture -> sfx.resume()
        page.keyboard.press('KeyR')                      # repair attempt -> emit() -> play(...)
        # the ocean worklet's module load can take well over 5 s on a loaded box: wait for it (up to 30 s),
        # then stay past the 2.5 s first fade-in
        t0 = time.monotonic()
        try: page.wait_for_function('raftDebug.audio.stats?.().worklet', timeout=30000, polling=200)
        except Exception: pass                        # reported as worklet_built = false below
        rep['worklet_wait_s'] = round(time.monotonic() - t0, 2)
        page.wait_for_timeout(3000)
        rep['boot'] = page.evaluate('''async () => {
          const a = raftDebug.audio, s0 = a.stats(); window.__ctx0 = a.context;
          const ev = (await import('./audio.js?build=' + %s)).EVENTS;
          const played = {}; let t = 0;
          for (const e of ev) { played[e] = a.play(e, .5); await new Promise(r => setTimeout(r, 120)); }
          // diving's event (what diving.js dispatches on the edge); the engine reads it on its next tick
          dispatchEvent(new CustomEvent('raft:underwater', { detail: { underwater: true, depth: 1, mount: 'check' } }));
          await new Promise(r => setTimeout(r, 400));
          const under = a.stats().underwater;
          dispatchEvent(new CustomEvent('raft:underwater', { detail: { underwater: false, depth: 0, mount: 'check' } }));
          await new Promise(r => setTimeout(r, 400));
          return { stats: s0, played, underwater_seen: under, after: a.stats(), buses: ['master', 'effects', 'ambience', 'music'].map(n => a.getBus?.(n) ?? null) };
        }''' % json.dumps(build))
        # station cue (edit 4): a smelter on the raft; 'Take' with an empty output is refused by the host
        # (silent), adding wood as fuel is accepted (one spatial 'stoke'), through the real station panel
        rep['station'] = page.evaluate('''async () => {
          const P = raftDebug.progression, a = raftDebug.audio, orig = a.play, heard = [];
          if (!P) return { skipped: 'no progression' };
          a.play = (ev, s, o) => { heard.push([ev, !!(o && Number.isFinite(o.x))]); return orig.call(a, ev, s, o); };
          try {
            const key = P.place('smelter'); if (!key) return { skipped: 'no free tile' };
            P.grant('wood', 3); P.open(key); await new Promise(r => setTimeout(r, 300));
            heard.length = 0;
            document.querySelector('.st-dlg [data-act=take]')?.click(); await new Promise(r => setTimeout(r, 300));
            const refused = heard.filter(h => h[0] !== 'ui').map(h => h[0]);
            heard.length = 0;
            document.querySelector('.st-dlg .st-chip[data-role=fuel][data-item-kind=wood]')?.click(); await new Promise(r => setTimeout(r, 300));
            const accepted = heard.filter(h => h[0] !== 'ui');
            document.querySelector('.st-dlg .st-x')?.click(); await new Promise(r => setTimeout(r, 200));
            return { key, refused, accepted };
          } finally { a.play = orig; }
        }''')
        rep['audio'] = page.evaluate('({...window.__aud, ctxs: undefined, level: undefined})')
        page.wait_for_timeout(1500)

        # ---- 1. failed hot update: mount() throws after sfx.resume() took the ocean over ----
        republish(dist, 'hotfail', fail=True)
        page.wait_for_function('__aud.disposed.length >= 1', timeout=120000, polling=200)
        page.wait_for_timeout(3500)
        f = page.evaluate('({live: {build: raftLive.build, lastError: raftLive.lastError}, stats: raftDebug.audio.stats(),'
                          ' mounts: __aud.mounts.slice(), disposed: __aud.disposed.slice(), worklets: __aud.worklets, modules: __aud.modules.slice()})')
        # ---- 2. good hot update ----
        republish(dist, 'hotcheck', base=good)
        page.wait_for_function('__aud.disposed.length >= 2', timeout=120000, polling=200)
        page.wait_for_timeout(3500)
        rep['swap'] = page.evaluate('raftLive.check()')       # now just reports the running build
        hs = page.evaluate('({modules: __aud.modules, worklets: __aud.worklets, contexts: __aud.contexts, engineContexts: __aud.engineContexts, stats: raftDebug.audio.stats(), sameContext: raftDebug.audio.context === __ctx0,'
                           ' states: __aud.ctxs.map(c => c.state), level: __aud.level, mounts: __aud.mounts, disposed: __aud.disposed})')
        b.close()
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    lv = hs.pop('level')
    sm = smooth(lv)
    # failed mount: from the failing build's buildGraph (mounts[1]) through its destroy (disposed[0]) + 3.5 s
    tf0, tf1 = f['mounts'][1] if len(f['mounts']) >= 2 else float('inf'), f['disposed'][0] + 3.5
    rep['failed_mount'] = {**f, **window_report(sm, lv, tf0, tf1), 'control_before': window_report(sm, lv, tf0 - 4, tf0)}
    # good swap: from the new build's buildGraph (mounts[2]) through the old build's destroy (disposed[1]) + 3.5 s
    ts0, ts1 = hs['mounts'][2] if len(hs['mounts']) >= 3 else float('inf'), hs['disposed'][1] + 3.5
    rep['hot_swap'] = {**hs, **window_report(sm, lv, ts0, ts1), 'control_before': window_report(sm, lv, ts0 - 4, ts0)}
    a, bt, fm, h = rep['audio'], rep['boot'], rep['failed_mount'], rep['hot_swap']
    holds = lambda r: r['dip_db'] is not None and r['dip_db'] <= 10 and r['min_level_db'] is not None and r['min_level_db'] > -70
    rep['checks'] = {
        'no_errors': not rep['errors'],
        'one_engine_context': a['engineContexts'] == 1,
        'worklet_built': a['worklets'] >= 1 and bt['stats'].get('worklet'),
        'worklet_url_has_build': any(u.endswith('/audio-worklet.js?build=' + build) for u in a['modules']),
        'routed_into_diving_lowpass': bt['stats'].get('routed'),
        'every_event_schedules': all(bt['played'].values()),
        'underwater_event_seen': bt['underwater_seen'] and not bt['after'].get('underwater'),
        'buses_default': bt['buses'][1:] == [1, 0.7, 0.7],
        # station sounds only after the host accepted the action, spatial at the station
        'station_cue_refused_silent': rep['station'].get('refused') == [],
        'station_cue_accepted_once': rep['station'].get('accepted') == [['stoke', True]],
        # failed mount: live.js kept the old build, the old engine owns the ocean again, the sea never dropped
        'failed_mount_kept_old': fm['live']['build'] == build and 'injected mount failure' in (fm['live']['lastError'] or ''),
        'failed_mount_ocean_back': fm['stats'].get('worklet') and fm['stats'].get('ambience') == 'worklet',
        'failed_mount_no_new_ocean': fm['worklets'] == a['worklets'],
        'failed_mount_level_holds': holds(fm),
        # good swap
        'swap_updated': (rep['swap'] or {}).get('build') == 'hotcheck' and len(h['mounts']) == 3,
        'swap_one_engine_context': h['engineContexts'] == 1 and h['sameContext'] and h['stats'].get('state') == 'running',
        'swap_ocean_handed_over': h['worklets'] == a['worklets'] and h['stats'].get('worklet'),
        'swap_no_stale_module': all('?build=' in u for u in h['modules']),
        'swap_level_holds': holds(h),
        'swap_rerouted_into_new_diving': h['stats'].get('routed'),
    }
    rep['ok'] = all(rep['checks'].values())
    print(json.dumps(rep, indent=1))
    return rep['ok']


if __name__ == '__main__':
    if '--apply' in sys.argv:
        print('applied, build token', apply(ROOT / 'dist'))
    else:
        sys.exit(0 if check() else 1)
