"""Headless check for the audio lab. Usage: python sandbox/audio/shoot.py [--out DIR] [case ...]
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
            'peak_dbfs': s['peakDb'], 'rms_dbfs': s['rmsDb'], 'LR_peak': s['LR'], 'corr': s['corr'],
            'dc': [c['dc'] for c in s['chans']], 'clipped': sum(c['clipped'] for c in s['chans']),
            'onset_ms': s['chans'][0]['onsetMs'], 'decay60_ms': s['chans'][0]['decay60Ms'], 'tail_db': s['chans'][0]['tailDb'],
            'warn': s['warn'],
            **({'windows': s['windows']} if s.get('windows') else {}),
        }
    if not only:
        report['play_js_cost'] = page.evaluate('lab.scheduleCost(60)')
    b.close()
srv.shutdown()
amb = [v['ms_per_audio_s'] for k, v in report['cases'].items() if k.startswith('ambience')]
report['summary'] = {
    'cases': len(report['cases']),
    'warnings': {k: v['warn'] for k, v in report['cases'].items() if v['warn']},
    'max_peak_dbfs': max((v['peak_dbfs'] for v in report['cases'].values()), default=None),
    'ambience_ms_per_audio_s': amb,
}
print(json.dumps(report, indent=1))
