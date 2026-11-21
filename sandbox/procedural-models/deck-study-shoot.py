"""Headless check of the procedural-model sandbox. Run from the repo root:
    python sandbox/procedural-models/deck-study-shoot.py
Serves the repo root, renders each variant, writes PNGs + stats.json next to this file."""
import json, pathlib, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent / "shots"
OUT.mkdir(exist_ok=True)
VARIANTS = [
    ("a_deck", "mode=a"), ("b_deck", "mode=b"), ("c_deck", "mode=c"),
    ("a_close", "mode=a&view=close"), ("b_close", "mode=b&view=close"), ("b_close_noao", "mode=b&ao=0&view=close"), ("c_close", "mode=c&view=close"),
    ("b_chunk", "mode=b&chunk=1"), ("b_lod_far", "mode=b&lod=1&view=far"), ("a_far", "mode=a&view=far"),
]

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
Handler.log_message = lambda *a: None
srv = socketserver.TCPServer(("127.0.0.1", 0), Handler)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

results = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1000, "height": 620})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    for name, qs in VARIANTS:
        pg.goto(f"http://127.0.0.1:{port}/sandbox/procedural-models/deck-study.html?{qs}")
        pg.wait_for_function("window.__ready === true", timeout=120000)
        results[name] = pg.evaluate("window.__stats")
        pg.screenshot(path=str(OUT / f"deck_{name}.png"))
        print(name, json.dumps(results[name]))
    b.close()
srv.shutdown()
(OUT / "deck-study-stats.json").write_text(json.dumps(results, indent=1))
print("errors:", errs or "none")
