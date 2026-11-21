"""Headless check for the audio lab. Usage: python sandbox/audio/shoot.py [--out DIR] [--bench | case ...]
Serves the repo root, renders every case in sandbox/audio/render-lab.js through OfflineAudioContext
(48 kHz stereo, volume 1 = worst case level), writes <case>.wav + <case>.png (waveform + spectrogram)
and prints JSON: render ms per second of audio, peak/RMS dBFS, DC, tail, warnings, play() JS cost.
Timings are relative only (headless, SwiftShader box)."""
import sys, json, base64, threading, functools, http.server, socketserver
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
args = sys.argv[1:]
out = Path(__file__).parent / 'shots'
if '--out' in args:
    i = args.index('--out'); out = Path(args[i + 1]); del args[i:i + 2]
out = out.resolve()
only = set(args)
out.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(root)))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
report = {'errors': [], 'cases': {}, 'play_js_cost': None}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
                          args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1100, 'height': 900})
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.on('console', lambda m: m.type in ('error', 'warning') and report['errors'].append(m.text[:400]))
    page.goto(f'http://127.0.0.1:{port}/sandbox/audio/index.html')
    page.wait_for_function('window.lab && window.lab.ready', timeout=20000)
    names = page.evaluate('lab.cases')
    if '--bench' in only:
        # interleaved repeats so box contention hits every engine equally; min and median ms per audio second
        report['bench'] = page.evaluate('''async () => {
          const { renderCase } = await import('./render-lab.js');
          const names = ['ambience-calm', 'ambience-fallback', 'ambience-rough', 'stress-24', 'hammer', 'splash'], ms = {};
          for (let i = 0; i < 7; i++) for (const n of names) (ms[n] ||= []).push((await renderCase(n, { repeats: 1 })).msPerSec);
          const out = {}; for (const n of names) { const a = ms[n].sort((x, y) => x - y); out[n] = { min: +a[0].toFixed(1), median: +a[a.length >> 1].toFixed(1) }; }
          return out;
        }''')
        only = {'--none--'}
    for name in names:
        if only and name not in only:
            continue
        r = page.evaluate('n => lab.render(n)', name)
        (out / f'{name}.wav').write_bytes(base64.b64decode(r.pop('wav')))
        (out / f'{name}.png').write_bytes(base64.b64decode(r.pop('png').split(',', 1)[1]))
        s = r['stats']
        report['cases'][name] = {
            'seconds': r['seconds'], 'render_ms': round(r['ms'], 1), 'ms_per_audio_s': round(r['msPerSec'], 2),
            'setup_ms': round(r['setupMs'], 1), 'engine': r['engine'],
            'peak_dbfs': s['peakDb'], 'rms_dbfs': s['rmsDb'], 'loud_max': s.get('loudMax'), 'LR_peak': s['LR'], 'corr': s['corr'],
            'dc': [c['dc'] for c in s['chans']], 'clipped': sum(c['clipped'] for c in s['chans']),
            'onset_ms': s['chans'][0]['onsetMs'], 'decay60_ms': s['chans'][0]['decay60Ms'], 'tail_db': s['chans'][0]['tailDb'],
            'warn': s['warn'],
            **({'windows': s['windows']} if s.get('windows') else {}),
        }
    if not only:
        report['play_js_cost'] = page.evaluate('lab.scheduleCost(60)')
        # realtime smoke: real AudioContext, worklet load, play()/reel/spatial, destroy + re-create on the same context
        page.click('#start')
        page.wait_for_function("document.querySelector('#start').textContent !== 'Start audio'", timeout=10000)
        page.wait_for_timeout(1500)
        report['realtime'] = page.evaluate('''async () => {
          const { createOceanAudio, EVENTS } = await import('./audio.js');
          const a = createOceanAudio({ volume: 0.5 });
          const ok = await a.resume();
          await new Promise(r => setTimeout(r, 600));
          a.setListener(0, 1.6, 0, 0, 0, -1); a.setOcean({ swell: 0.8, wind: 0.6 });
          const played = {}; for (const ev of EVENTS) played[ev] = a.play(ev, 1, ev === 'gull' ? { x: 10, y: 8, z: -10 } : null);
          const reel = a.setReel(true, 0.5); await new Promise(r => setTimeout(r, 300)); a.setReel(false);
          const s1 = a.stats(), ctx = a.context, t0 = ctx.currentTime;
          await new Promise(r => setTimeout(r, 1500));
          const s2 = a.stats();
          a.destroy();
          const b = createOceanAudio({ context: ctx, workletUrl: new URL('./audio-worklet.js?build=hot2', location.href).href }); /* new build query: module re-evaluated, registerProcessor must not break it */ const ok2 = await b.resume(); await new Promise(r => setTimeout(r, 400));
          const s3 = b.stats(); b.destroy();
          return { resumed: ok, state: ctx.state, sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, clockAdvanced: +(ctx.currentTime - t0).toFixed(2),
                   played, reel, afterPlay: s1, after1500ms: s2, hotSwap: { resumed: ok2, sameContext: b.context === ctx, stats: s3 },
                   legacyPlayResult: createOceanAudio().play('ui') };
        }''')
    b.close()
srv.shutdown()
amb = [v['ms_per_audio_s'] for k, v in report['cases'].items() if k.startswith('ambience')]
report['summary'] = {
    'cases': len(report['cases']),
    'warnings': {k: v['warn'] for k, v in report['cases'].items() if v['warn']},
    'max_peak_dbfs': max((v['peak_dbfs'] for v in report['cases'].values()), default=None),
    'ambience_ms_per_audio_s': amb,
}
(out / 'report.json').write_text(json.dumps(report, indent=1))
print(json.dumps(report, indent=1))
