"""Headless check of the low-poly prop gallery. Run from the repo root:
    python sandbox/procedural-models/shoot.py            # all views
    python sandbox/procedural-models/shoot.py grid_0     # one view by name
Serves the repo root, renders each gallery view, writes PNGs + stats.json to sandbox/procedural-models/shots/
and prints JSON (per-model tris/meshes/draw calls/build ms/frame ms, scene frame ms + renderer.info)."""
import json, sys, pathlib, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent / "shots"
OUT.mkdir(exist_ok=True)
VIEWS = [
    ("grid_0", "view=grid&page=0", (1560, 780)), ("grid_1", "view=grid&page=1", (1560, 780)),
    ("compare_0", "view=compare&page=0", (1560, 520)), ("compare_1", "view=compare&page=1", (1560, 520)),
    ("scene", "view=scene", (1600, 620)), ("fp", "view=fp", (1600, 900)),
    ("hero_0", "view=hero&names=lantern,crate,net", (1560, 1040)), ("hero_1", "view=hero&names=plank,scrap,bench", (1560, 1040)), ("stats", "view=stats", (600, 400)),
]
only = set(sys.argv[1:])

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
Handler.log_message = lambda *a: None
srv = socketserver.TCPServer(("127.0.0.1", 0), Handler)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

results, errs = {}, []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
                          args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    for name, qs, (w, h) in VIEWS:
        if only and name not in only:
            continue
        pg = b.new_page(viewport={"width": w, "height": h + 40})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.add_init_script("addEventListener('error', () => { window.__failed = true; })")
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(f"http://127.0.0.1:{port}/sandbox/procedural-models/index.html?{qs}", wait_until="commit")
        pg.wait_for_function("window.__ready === true || window.__failed === true", timeout=900000)
        results[name] = pg.evaluate("window.__stats")
        if name != "stats":
            pg.locator("#wrap").screenshot(path=str(OUT / f"{name}.png"))
        pg.close()
    b.close()
srv.shutdown()
prev = {}
if only and (OUT / "stats.json").exists():
    prev = json.loads((OUT / "stats.json").read_text())
prev.update(results)
(OUT / "stats.json").write_text(json.dumps(prev, indent=1))
print(json.dumps(results, indent=1))
print("errors:", errs or "none")
