"""AUDIT UI-5 (browser): on the title screen the welcome overlay (z-index 5, rgba(6,13,20,.86) gradient,
graphics.css ~259) is stacked above the header (z-index 2, style.css:2), so the cream 'LITTLE RAFT' brand
renders nearly black. Measures pixels: the brightest pixel inside the brand box must be clearly light.
Exit 1 on bug. Usage: python tests/audit/ui5_title_brand_hidden.py"""
import os, sys, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import serve, launch

url, srv = serve()
with launch() as (b, pg):
    pg.goto(url); pg.wait_for_function('!!window.raftDebug', timeout=60000); pg.wait_for_timeout(1000)
    box = pg.evaluate("(()=>{const r=document.querySelector('header .brand').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()")
    png = pg.screenshot(clip=box)
    # Brightest pixel, computed in-page from the PNG to avoid a Pillow dependency.
    peak = pg.evaluate("""async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data; let m = 0; for (let i = 0; i < d.length; i += 4) m = Math.max(m, .2126*d[i] + .7152*d[i+1] + .0722*d[i+2]); return m; }""",
      __import__('base64').b64encode(png).decode())
srv.shutdown()
print('brand box', box, 'peak luma', round(peak))
if peak < 150:
    print(f'FAIL: title brand is covered by the welcome overlay (brightest brand pixel luma {peak:.0f}/255, cream text is ~230)'); sys.exit(1)
print('PASS')
