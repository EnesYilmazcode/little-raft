"""Apply (or dry-run check) the audio adoption described in docs/tech/audio-ADOPT.md.

  python sandbox/audio/adopt.py --check        copy dist/ to a temp dir, apply, boot the game headless, verify audio
  python sandbox/audio/adopt.py --apply        apply to dist/ in place (run --check first)

Every edit is an exact old -> new string replacement that must match dist/game.js exactly once,
so this fails loudly instead of half-applying if game.js has drifted.
"""
import sys, re, json, shutil, tempfile, threading, functools, http.server, socketserver
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


def check():
    from playwright.sync_api import sync_playwright
    tmp = Path(tempfile.mkdtemp(prefix='raft-audio-adopt-'))
    dist = tmp / 'dist'
    shutil.copytree(ROOT / 'dist', dist)
    build = apply(dist)

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(dist)))
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    rep = {'build': build, 'errors': [], 'console': []}
    probe = """
      window.__aud = { modules: [], worklets: 0, oscillators: 0, panners: 0, contexts: 0 };
      const A = window.__aud, B = BaseAudioContext.prototype;
      const wrap = (k, key) => { const f = B[k]; B[k] = function (...a) { A[key]++; return f.apply(this, a); }; };
      wrap('createOscillator', 'oscillators'); wrap('createPanner', 'panners');
      const add = AudioWorklet.prototype.addModule;
      AudioWorklet.prototype.addModule = function (u, ...r) { A.modules.push(String(u)); return add.call(this, u, ...r); };
      const W = window.AudioWorkletNode; window.AudioWorkletNode = class extends W { constructor(...a) { super(...a); A.worklets++; } };
      const C = window.AudioContext; window.AudioContext = class extends C { constructor(...a) { super(...a); A.contexts++; } };
    """
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
                              args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = b.new_page(viewport={'width': 1100, 'height': 700})
        page.add_init_script(probe)
        page.on('pageerror', lambda e: rep['errors'].append(str(e)))
        page.on('console', lambda m: m.type in ('error', 'warning') and rep['console'].append(m.text[:300]))
        page.goto(f'http://127.0.0.1:{port}/')
        page.wait_for_function('!!window.raftDebug', timeout=30000)
        page.locator('#solo').click(no_wait_after=True)
        page.wait_for_function('raftDebug.state.running', timeout=30000)
        page.mouse.click(550, 350)                       # user gesture -> wakeAudio()
        page.keyboard.press('KeyR')                      # repair -> emit() effect -> sfxPlay(...)
        page.wait_for_timeout(2500)
        rep['audio'] = page.evaluate('window.__aud')
        rep['ok'] = (not rep['errors'] and rep['audio']['contexts'] == 1 and rep['audio']['worklets'] >= 1
                     and any('audio-worklet.js' in u for u in rep['audio']['modules']) and rep['audio']['oscillators'] > 0)
        b.close()
    srv.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print(json.dumps(rep, indent=1))
    return rep['ok']


if __name__ == '__main__':
    if '--apply' in sys.argv:
        print('applied, build token', apply(ROOT / 'dist'))
    else:
        sys.exit(0 if check() else 1)
