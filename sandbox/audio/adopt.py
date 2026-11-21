"""Apply (or dry-run check) the audio adoption described in docs/tech/audio-ADOPT.md.

  python sandbox/audio/adopt.py --check        copy dist/ to a temp dir, apply, boot the game headless, verify audio
  python sandbox/audio/adopt.py --apply        apply to dist/ in place (run --check first)

Every edit is an exact old -> new string replacement that must match dist/game.js exactly once,
so this fails loudly instead of half-applying if game.js has drifted.
"""
import sys, re, json, math, shutil, tempfile, threading, functools, http.server, socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

EDITS = [
    # 1. import the engine next to the other dist modules (BUILD = the token game.js already uses)
    ("import { createSurvivalUI } from './survival-ui.js?build={BUILD}';\n",
     "import { createSurvivalUI } from './survival-ui.js?build={BUILD}';\n"
     "import { createOceanAudio } from './audio.js?build={BUILD}';\n"),
    # 2. one engine per mount; reuses the AudioContext handed over by a hot update (X.audio)
    ("  let sound = X ? X.sound !== false : true, audio = X?.audio ?? null;\n",
     "  let sound = X ? X.sound !== false : true, audio = X?.audio ?? null;\n"
     "  const sfx = createOceanAudio({context:audio, volume:options.volume});\n"
     "  if (sound && audio?.state === 'running') sfx.resume(); // hot update: context already unlocked, keep the ocean going\n"
     "  let reelSound = false, lastHookStage = null; const earDir = new T.Vector3();\n"),
    # 3. beep(f) -> sfxPlay(event, strength, pos?)
    ("  function beep(f = 500) {",
     "  function wakeAudio() { if (!sound || !(options?.volume > 0)) return; sfx.setVolume(options.volume); sfx.resume(); audio = sfx.context ?? audio; }\n"
     "  function sfxPlay(ev, s = 1, pos = null) { if (!sound || !(options?.volume > 0)) return; wakeAudio(); sfx.play(ev, s, pos); }\n"
     "  function beep(f = 500) {"),
    ("    beep(e.kind === 'build' ? 640 : e.kind === 'craft' ? 560 : e.kind === 'full' ? 220 : 440);\n",
     "    sfxPlay(e.kind === 'build' ? 'hammer' : e.kind === 'craft' ? 'craft' : e.kind === 'full' ? 'error' : e.kind === 'loot' ? 'collect' : 'ui');\n"),
    ("swing = .6; beep(500);", "swing = .6; sfxPlay('pickup');"),
    ("notice('Wait for a bite…', 2500); beep(280);", "notice('Wait for a bite…', 2500); sfxPlay('throw', .5);"),
    ("reeling = false; swing = 1; beep(230);", "reeling = false; swing = 1; lastHookStage = 'flying'; sfxPlay('throw', .35 + .65 * charge);"),
    ("    if (ev?.splashed) beep(180);\n", "    if (ev?.splashed) sfxPlay('splash', 1);\n"),
    ("if (caught.length > lastCaughtCount) beep(520 + caught.length * 30);",
     "if (caught.length > lastCaughtCount) sfxPlay('catch', Math.min(1, .7 + caught.length * .1), pos);"),
    ("    } else if (ev?.kind === 'returned') beep(300);\n", "    } else if (ev?.kind === 'returned') sfxPlay('return');\n"),
    # 4. hook lands in the water / ratchet while reeling (new cues, same frame code)
    ("    hookMesh.visible = true; hookMesh.position.copy(pos);\n    if (hook.stage === 'flying')",
     "    hookMesh.visible = true; hookMesh.position.copy(pos);\n"
     "    if (lastHookStage === 'flying' && hook.stage === 'floating') sfxPlay('splash', .55, pos);\n"
     "    lastHookStage = hook.stage;\n"
     "    const wantReel = sound && hook.stage === 'reeling'; if (wantReel !== reelSound) { reelSound = wantReel; sfx.setReel(wantReel, .6); }\n"
     "    if (hook.stage === 'flying')"),
    ("  function endHook() { hook = null;", "  function endHook() { if (reelSound) { reelSound = false; sfx.setReel(false); } hook = null;"),
    # fishing-rod bobber: splash when it lands, plip when a fish bites
    ("      if (f >= 1) { action({kind:'fish'}); fishWait = 0; endHook(); }\n",
     "      if (u >= 1 && (hook.t - dt) * 5 / hook.duration < 1) sfxPlay('splash', .4, pos);\n"
     "      if (hook.t > fishWait && hook.t - dt <= fishWait) sfxPlay('bite', 1, pos);\n"
     "      if (f >= 1) { action({kind:'fish'}); fishWait = 0; endHook(); }\n"),
    # 5. listener follows the camera every frame (PannerNode spatialisation)
    ("    updateAvatars(dt); updateCamera(dt);\n",
     "    updateAvatars(dt); updateCamera(dt);\n"
     "    if (sfx.context) { camera.getWorldDirection(earDir); sfx.setListener(camera.position.x, camera.position.y, camera.position.z, earDir.x, earDir.y, earDir.z); }\n"),
    # 6. first user gesture anywhere unlocks audio (autoplay policy); listener dies with the mount's AbortController
    ("  on(document, 'pointerlockerror', lockFailed);\n",
     "  on(document, 'pointerlockerror', lockFailed);\n"
     "  on(window, 'pointerdown', wakeAudio, {capture:true}); on(window, 'keydown', wakeAudio, {capture:true});\n"),
    # 7. settings volume + sound toggle
    ("settingsController = createSettings({onChange:next => { options = next;",
     "settingsController = createSettings({onChange:next => { options = next; sfx.setVolume(sound ? next.volume : 0);"),
    ("  setHandler($('#soundButton'), 'onclick', () => { sound = !sound; soundLabel(); });\n",
     "  setHandler($('#soundButton'), 'onclick', () => { sound = !sound; soundLabel(); sfx.setVolume(sound ? options.volume : 0); if (sound) sfxPlay('ui'); });\n"),
    # 8. hot update: hand the live context to the next build, free this build's nodes
    ("hook, castId, hookSlot, lastCaughtCount, fishWait, sound, audio, peer,",
     "hook, castId, hookSlot, lastCaughtCount, fishWait, sound, audio:sfx.context ?? audio, peer,"),
    ("    try { settingsController?.destroy(); } catch {}\n",
     "    try { settingsController?.destroy(); } catch {}\n"
     "    try { sfx.destroy(); } catch {}\n"),
]


def apply(dist: Path):
    game = dist / 'game.js'
    src = game.read_text(encoding='utf-8')
    m = re.search(r"\./survival-ui\.js\?build=([^'\"]+)'", src)
    if not m:
        raise SystemExit('cannot find the ?build= token on the survival-ui import in game.js')
    build = m[1]
    for old, new in EDITS:
        old, new = old.replace('{BUILD}', build), new.replace('{BUILD}', build)
        n = src.count(old)
        if n != 1:
            raise SystemExit(f'edit anchor matched {n} times (expected 1):\n{old}')
        src = src.replace(old, new)
    if 'beep(' in src.replace('function beep(', ''):
        raise SystemExit('a beep() call site was not converted')
    # beep() is now unused: drop the whole line
    src = re.sub(r"\n  function beep\(f = 500\) \{[^\n]*\n", "\n", src)
    game.write_text(src, encoding='utf-8')
    eng = (HERE / 'audio.js').read_text(encoding='utf-8').replace("'./audio-worklet.js'", f"'./audio-worklet.js?build={build}'")
    (dist / 'audio.js').write_text(eng, encoding='utf-8')
    shutil.copyfile(HERE / 'audio-worklet.js', dist / 'audio-worklet.js')
    return build


def republish(dist: Path, build: str):
    """What publish_local.py does to a release, on the temp copy: stamp every './name.js' literal
    (the worklet URL in audio.js included) with the new ?build= and bump version.json, which live.js polls."""
    for f in dist.glob('*.js'):
        t = f.read_text(encoding='utf-8')
        t = re.sub(r"""(['"])(\./[a-z][a-z0-9-]*\.js)(?:\?[^'"]*)?\1""",
                   lambda m: m[1] + m[2] + '?build=' + build + m[1] if (dist / m[2][2:]).exists() else m[0], t)
        f.write_text(t, encoding='utf-8')
    (dist / 'version.json').write_text(json.dumps({'build': build, 'protocol': 1}), encoding='utf-8')


# Test probe: counts contexts, worklet nodes and modules, and taps everything that reaches ctx.destination
# with a recorder worklet (audio thread, so its timing is exact) that posts the output RMS every 20 ms.
PROBE = """
  window.__aud = { modules: [], worklets: 0, oscillators: 0, panners: 0, contexts: 0, ctxs: [], level: [] };
  const A = window.__aud, B = BaseAudioContext.prototype;
  const wrap = (k, key) => { const f = B[k]; B[k] = function (...a) { A[key]++; return f.apply(this, a); }; };
  wrap('createOscillator', 'oscillators'); wrap('createPanner', 'panners');
  A.mounts = [];                                 // ctx time of each engine's buildGraph() (its limiter)
  const dc = B.createDynamicsCompressor;
  B.createDynamicsCompressor = function (...a) { A.mounts.push(this.currentTime); return dc.apply(this, a); };
  A.disposed = [];                               // ctx time each engine's limiter is disconnected (end of destroy)
  const dn = AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect = function (...a) { if (this instanceof DynamicsCompressorNode) A.disposed.push(this.context.currentTime); return dn.apply(this, a); };
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
  AudioNode.prototype.connect = function (d, ...r) {
    if (d instanceof AudioDestinationNode) {
      const ctx = d.context, src = this;
      if (!ctx.__rec) ctx.__rec = add.call(ctx.audioWorklet, URL.createObjectURL(new Blob([REC], { type: 'text/javascript' }))).then(() => {
        const n = new W(ctx, 'probe-rec', { numberOfInputs: 1, numberOfOutputs: 1 });
        const z = ctx.createGain(); z.gain.value = 0; conn.call(n, z); conn.call(z, ctx.destination);   // always pulled
        n.port.onmessage = (e) => { if (A.level.length < 20000) A.level.push(e.data); };
        ctx.__recNode = n;
        return n;
      });
      // once the recorder exists, tap synchronously: a .then() would wait for the main thread, which is
      // busy for seconds inside a hot-update mount(), and the new engine would be missed until then
      if (ctx.__recNode) conn.call(src, ctx.__recNode);
      else ctx.__rec.then((n) => { try { conn.call(src, n); } catch (_) {} });
    }
    return conn.call(this, d, ...r);
  };
"""


def check():
    from playwright.sync_api import sync_playwright
    tmp = Path(tempfile.mkdtemp(prefix='raft-audio-adopt-'))
    dist = tmp / 'dist'
    shutil.copytree(ROOT / 'dist', dist)
    build = apply(dist)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
        def end_headers(self): self.send_header('Cache-Control', 'no-store'); super().end_headers()
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    rep = {'build': build, 'errors': [], 'console': []}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
                              args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = b.new_page(viewport={'width': 1100, 'height': 700})
        page.add_init_script(PROBE)
        page.on('pageerror', lambda e: rep['errors'].append(str(e)))
        page.on('console', lambda m: m.type in ('error', 'warning') and 'GL Driver' not in m.text and rep['console'].append(m.text[:300]))
        page.goto(f'http://127.0.0.1:{port}/')
        page.wait_for_function('!!window.raftDebug', timeout=30000)
        page.locator('#solo').click(no_wait_after=True)
        page.wait_for_function('raftDebug.state.running', timeout=30000)
        page.mouse.click(550, 350)                       # user gesture -> wakeAudio()
        page.keyboard.press('KeyR')                      # repair -> emit() effect -> sfxPlay(...)
        page.wait_for_timeout(5000)                      # past the 2.5 s first fade-in and the repair sound
        rep['audio'] = page.evaluate('({...window.__aud, ctxs: undefined, level: undefined})')
        # hot update: republish with a new token and let live.js's own 6 s poll swap builds (calling
        # raftLive.check() by hand can race that poll into a second, overlapping swap), then watch the
        # output level from the new mount until 3.5 s after the old build has been torn down
        republish(dist, 'hotcheck')
        page.wait_for_function('__aud.disposed.length >= 1', timeout=120000, polling=200)
        page.wait_for_timeout(3500)
        rep['swap'] = page.evaluate('raftLive.check()')       # now just reports the running build
        hs = page.evaluate('({modules: __aud.modules, worklets: __aud.worklets, contexts: __aud.contexts,'
                           ' states: __aud.ctxs.map(c => c.state), level: __aud.level, mounts: __aud.mounts, disposed: __aud.disposed})')
        b.close()
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    lv = hs.pop('level')
    # mounts[1]: the new build's engine is built inside mount(); disposed[0]: the old one's teardown ends
    t_swap = hs['mounts'][1] if len(hs['mounts']) >= 2 else float('inf')
    t_done = hs['disposed'][0]
    # 100 ms moving RMS (dB) over the 20 ms recorder blocks
    sm = []
    for i in range(len(lv)):
        w = lv[max(0, i - 4):i + 1]
        sm.append((w[-1][0], 10 * math.log10(sum(10 ** (x[1] / 10) for x in w) / len(w))))
    # The swell alone moves the ocean level by ~8 dB over a few seconds, so a drop-out is measured against
    # the trailing 1 s: dip = (median of the previous 1 s) - (this 100 ms window), worst case over the window
    # from the new mount, through the old build's dispose (the rest of mount() runs in between, which can
    # take seconds on this headless box), to 3.5 s after it.
    def worst_dip(t0, t1):
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
    worst = worst_dip(t_swap, t_done + 3.5)
    control = worst_dip(t_swap - 4, t_swap)          # same metric on the 4 s before the swap
    around = worst[1] if worst else t_done
    h = rep['hot_swap'] = {
        **hs, 'dispose_after_mount_s': round(t_done - t_swap, 2),
        'dip_db': worst and round(worst[0], 1), 'dip_at_s': worst and round(worst[1] - t_swap, 2),
        'level_at_dip_db': worst and round(worst[2], 1), 'dip_before_swap_db': control and round(control[0], 1),
        'min_level_db': round(min(v for t, v in sm if t_swap <= t < t_done + 3.5), 1),
        'empty_input_blocks': [round(x[0] - t_swap, 2) for x in lv if x[2] and t_swap <= x[0] < t_done + 3.5],
        'trace_at_dispose': [(round(t - t_done, 2), round(v, 1)) for t, v in sm if t_done - 0.3 <= t < t_done + 0.6][::2],
        'trace_at_dip': [(round(t - around, 2), round(v, 1)) for t, v in sm if around - 0.3 <= t < around + 0.3][::2],
    }
    a = rep['audio']
    rep['checks'] = {
        'no_errors': not rep['errors'],
        'one_context': a['contexts'] == 1,
        'worklet_built': a['worklets'] >= 1,
        'worklet_url_has_build': any(u.endswith('/audio-worklet.js?build=' + build) for u in a['modules']),
        'oscillators': a['oscillators'] > 0,
        'swap_updated': (rep['swap'] or {}).get('build') == 'hotcheck' and len(h['mounts']) == 2,
        'swap_one_context': h['contexts'] == 1 and h['states'] == ['running'],
        # the new build takes over the ocean node that is playing (no second ocean, no module load)
        'swap_ocean_handed_over': h['worklets'] == a['worklets'],
        'swap_no_stale_module': all('?build=' in u for u in h['modules']),
        # the ocean must not drop out across the swap: no 100 ms window more than 10 dB under the trailing
        # 1 s (the low-passed brown-noise bed alone dips 3-6 dB on that scale; the old hard stop was -80 dB
        # for seconds), and never near silence
        'swap_level_holds': h['dip_db'] is not None and h['dip_db'] <= 10 and h['min_level_db'] > -70,
    }
    rep['ok'] = all(rep['checks'].values())
    print(json.dumps(rep, indent=1))
    return rep['ok']


if __name__ == '__main__':
    if '--apply' in sys.argv:
        print('applied, build token', apply(ROOT / 'dist'))
    else:
        sys.exit(0 if check() else 1)
