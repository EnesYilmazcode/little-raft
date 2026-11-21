# Engine-tech fleet brief (shared by all agents)

Game: Little Raft, an original first-person raft survival sandbox. Runtime is `dist/` (vanilla ES modules,
Three.js 0.170 vendored at `dist/vendor/three.module.js`, imported as `./vendor/three.module.js`).
No new npm deps, no CDNs. Sandboxes live in `sandbox/<topic>/` and import three via
`../../dist/vendor/three.module.js` (serve the repo root).

Topics: water, viewmodel, procedural-models, icons, perf, foliage, audio, ui-feel.
Each topic delivers:
- `sandbox/<topic>/index.html` + module(s): a working prototype of the best approach.
- `sandbox/<topic>/shoot.py`: headless check that writes PNGs to `sandbox/<topic>/shots/` and prints JSON with
  avg/worst frame ms and `renderer.info` (calls, triangles, geometries, textures, programs). Non-render topics
  (audio, ui-feel) report the equivalent cost (JS ms per frame / DOM cost, OfflineAudioContext render time).
- `docs/tech/<topic>.md`: research + decision. `docs/tech/<topic>-ADOPT.md`: exact steps to drop it into `dist/`
  (which files to add, which lines/functions in which `dist/*.js` to change, import lines with the
  `?build=` query convention used in dist/game.js, how to verify). Must be correct against the CURRENT dist code.

Headless Playwright (python): `from playwright.sync_api import sync_playwright`, launch with
`p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])`.
Do NOT run `playwright install`. SwiftShader timings are relative only. Always READ your screenshots (Read tool
on the PNG) and judge them honestly.

Git: commit small, plain messages (e.g. "water: add foam pass"), NO trailers / co-author lines.
