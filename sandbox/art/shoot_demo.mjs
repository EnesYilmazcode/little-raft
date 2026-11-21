// Headless screenshots of the material demo page (sandbox/art/index.html).
// Usage: node sandbox/art/shoot_demo.mjs <out_dir>
// Serves the repo root on a random port, writes demo.png, demo-flat.png, demo-atlas.png (1280x800),
// prints page errors / console errors and exits non-zero if there were any.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(process.argv[2] || 'demo-shots');
await mkdir(out, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.endsWith('/')) p += 'index.html';
  const file = join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/sandbox/art/`;

const errors = [], warnings = [];
const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let browser;
try { browser = await chromium.launch({ headless: true, args }); }
catch (e) { // fall back to the preinstalled binary when the playwright-managed one is missing
  if (!existsSync('/opt/pw-browsers/chromium')) throw e;
  browser = await chromium.launch({ headless: true, args, executablePath: '/opt/pw-browsers/chromium' });
}
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 600)); else if (m.type() === 'warning') warnings.push(m.text().slice(0, 300)); });
  page.on('requestfailed', r => errors.push('request failed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  for (const [name, q] of [['demo', ''], ['demo-flat', '?flat'], ['demo-atlas', '?atlas']]) {
    const t0 = Date.now();
    await page.goto(base + q);
    await page.waitForFunction('window.artDemoReady === true', null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(out, name + '.png') });
    console.log(`${name}.png  (${Date.now() - t0} ms)  stats: ${(await page.textContent('#stats')).replace(/\n\s*/g, ' | ')}`);
  }
} catch (e) { errors.push('script: ' + e.message); }
finally { await browser.close(); server.close(); }

if (warnings.length) console.log('warnings:\n  ' + [...new Set(warnings)].join('\n  '));
if (errors.length) { console.error('ERRORS:\n  ' + errors.join('\n  ')); code = 1; }
else console.log('ok, no page errors; shots in ' + out);
process.exit(code);
