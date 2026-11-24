// Repro for the crafting panel flicker report (ghost copies of the bag while hovering a requirement chip).
//
// Usage: [LIVE_SWAP=1] [VIEWPORTS=1536x864@1,1920x1080@1] [TARGETS=chip,plus,row,chip+feed] [UI_SCALE=1.2] [FRAMES=90]
//        node tools/repro_craft_flicker.mjs [out_dir]
// Serves dist/, continues a seeded save, opens the bag, selects Palm Planter, rests the real mouse on a
// requirement chip (or the + button, or a recipe row) and samples the panel, detail pane, chip and
// tooltips on every requestAnimationFrame. A MutationObserver counts DOM writes in the dialog and
// records the panel x inside each mutation batch (a show+hide within one frame never reaches rAF).
// LIVE_SWAP=1 first hot-swaps the engine to a new build (raftLive), as a deploy mid-session does:
// that is what breaks the layout (item-tooltips.js dispose() removes the shared tooltip stylesheet).
// Prints JSON then one FLICKER/STABLE line per case; exit 1 on FLICKER, 2 on errors.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = process.argv[2] ? resolve(process.argv[2]) : null;
if (OUT) await mkdir(OUT, { recursive: true });
const FRAMES = +(process.env.FRAMES || 90);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };
// LIVE_SWAP=1 emulates a deploy arriving mid-session: version.json then names a new build, and any
// .js fetched with ?build=<new> has the baked build id rewritten, so the whole module graph is new
// (as publish_local.py produces), and raftLive hot-swaps the engine without a reload.
const BAKED = JSON.parse(await readFile(join(DIST, 'version.json'), 'utf8')).build;
let servedBuild = BAKED;
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!f.startsWith(DIST)) { res.writeHead(403).end(); return; }
  try {
    let b = await readFile(f);
    if (p === '/version.json') b = Buffer.from(JSON.stringify({ ...JSON.parse(b), build: servedBuild }));
    const want = u.searchParams.get('build');
    if (want && want !== BAKED && /\.(js|css)$/.test(p)) b = Buffer.from(String(b).split(BAKED).join(want));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(b);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${srv.address().port}/?fixedres`;

const slots = Array(28).fill(null);
slots[0] = { kind: 'hook', count: 1, durability: 100 };
slots[1] = { kind: 'wood', count: 20 }; slots[2] = { kind: 'wood', count: 20 }; slots[3] = { kind: 'wood', count: 10 };
slots[4] = { kind: 'leaf', count: 2 }; slots[5] = { kind: 'plastic', count: 6 }; slots[6] = { kind: 'rope', count: 1 };
const SAVE = { tiles: [-1, 0, 1].flatMap(z => [-1, 0, 1].map(x => [x, z])), decor: [], stock: {}, fish: 0, collected: 1,
  hostInventory: { slots, selected: 0 } };

// Runs in the page: samples rects every animation frame and counts DOM writes inside the dialog.
async function sampler(frames) {
  const q = s => document.querySelector(s);
  const pick = el => { if (!el || !el.isConnected) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const dlg = q('#inventory');
  let muts = 0; const mutTargets = {};
  // Also record the panel x inside each mutation batch: a show+hide inside one frame never reaches a rAF sample.
  const wrapXs = {}; let toggles = 0;
  const mo = new MutationObserver(list => { const w = q('#inventory .sv-wrap')?.getBoundingClientRect(); if (w) wrapXs[Math.round(w.x)] = (wrapXs[Math.round(w.x)] || 0) + 1;
    for (const m of list) { muts++; if (m.attributeName === 'hidden' && /it-tip|sv-tip/.test(String(m.target.className))) toggles++; const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    const key = (t?.className?.baseVal ?? t?.className ?? t?.tagName) + ':' + m.type + (m.attributeName ? ':' + m.attributeName : ''); mutTargets[key] = (mutTargets[key] || 0) + 1; } });
  mo.observe(dlg, { subtree: true, attributes: true, childList: true, characterData: true });
  const rows = [];
  for (let i = 0; i < frames; i++) {
    await new Promise(r => requestAnimationFrame(r));
    const hov = [...document.querySelectorAll(':hover')].pop();
    const tip = q('#inventory .sv-tip'), it = q('.it-tip');
    rows.push({ kids: [...dlg.children].map(c => (String(c.className) || c.tagName) + (c.hidden ? ':h' : '') + ':' + getComputedStyle(c).position).join(' '), wrap: pick(q('#inventory .sv-wrap')), craft: pick(q('#inventory .sv-craft')), side: pick(q('#inventory .sv-side')),
      detail: pick(q('#inventory .sv-detail')), lane: pick(q('#inventory .feed-lane')), feed: pick(q('#pickupFeed')), bag: pick(q('#inventory .sv-bag')), chip: pick(q('#inventory .sv-ing')),
      tip: tip && !tip.hidden && tip.offsetWidth ? pick(tip) : null, itTip: it && !it.hidden ? pick(it) : null,
      itPos: it ? getComputedStyle(it).position + (it.hidden ? ':hidden' : '') : null,
      vw: innerWidth, vh: innerHeight, hover: hov ? String(hov.className?.baseVal ?? hov.className) : null, muts });
  }
  mo.disconnect();
  return { rows, mutTargets, wrapXs, toggles, dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight };
}

function layoutInfo() {
  const q = s => document.querySelector(s);
  const cs = el => { const s = getComputedStyle(el); return { display: s.display, w: s.width, flex: s.flex, minW: s.minWidth, bg: s.backgroundColor }; };
  const r4 = el => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const wrap = q('#inventory .sv-wrap');
  const kids = el => [...el.children].map(c => ({ cls: String(c.className), hidden: c.hidden, rect: r4(c), ...cs(c) }));
  const de = document.documentElement;
  return { uiScale: getComputedStyle(de).getPropertyValue('--ui-scale').trim(), zoom: getComputedStyle(q('#inventory')).zoom,
    docScroll: [de.scrollWidth, de.clientWidth, de.scrollHeight, de.clientHeight, getComputedStyle(de).overflow, getComputedStyle(document.body).overflow],
    dialog: { rect: r4(q('#inventory')), ...cs(q('#inventory')), justify: getComputedStyle(q('#inventory')).justifyContent, kids: [...q('#inventory').children].map(c => [String(c.className) || c.tagName, c.hidden, r4(c), getComputedStyle(c).position]) }, wrap: { rect: r4(wrap), ...cs(wrap) }, wrapKids: kids(wrap), sideKids: kids(q('#inventory .sv-side')) };
}

async function runCase(browser, w, h, dpr, target) {
  const name = `${w}x${h}@${dpr} ${target}`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await ctx.addInitScript(`localStorage.setItem("little-raft-v1", ${JSON.stringify(JSON.stringify(SAVE))});`);
  // UI_SCALE=1.2 forces graphics.css --ui-scale (the zoom it applies above 1600x950) at any viewport.
  if (process.env.UI_SCALE) await ctx.addInitScript(`addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ':root{--ui-scale:${+process.env.UI_SCALE}!important}'; document.head.append(s); });`);
  await ctx.addInitScript('HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new Error("no lock"))};');
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL_); await page.waitForFunction('!!window.raftDebug', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.locator('.ob-item[data-act="continue"]:visible, #solo:visible').first().click(); // continue loads the seeded save
  await page.waitForFunction('raftDebug.state.running', null, { timeout: 20000 }); await page.waitForTimeout(600);
  let swap = null;
  if (process.env.LIVE_SWAP) {
    servedBuild = BAKED + '-swap' + Date.now().toString(36);
    swap = await page.evaluate(() => window.raftLive.check());
    await page.waitForTimeout(800);
  }
  await page.keyboard.press('Tab'); await page.waitForFunction('raftDebug.state.inventoryOpen', null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const found = await page.evaluate(() => {
    const vis = () => { const r = document.querySelector('#inventory .sv-recipe[data-recipe="palm"]'); return !!(r && !r.hidden && r.offsetParent); };
    if (vis()) return true;
    for (const t of document.querySelectorAll('#inventory .sv-tab')) { t.click(); if (vis()) return true; }
    return false;
  });
  const rec = found ? page.locator('#inventory .sv-recipe[data-recipe="palm"]') : page.locator('#inventory .sv-recipe:not([hidden])').first();
  // DOM click: once the layout is unstable a pointer click at a measured spot can land on another row.
  await rec.evaluate(el => { el.scrollIntoView({ block: 'nearest' }); el.click(); });
  await page.waitForTimeout(300);
  if (target === 'plus' && !(await page.locator('#inventory .sv-iplus:not([hidden])').count())) {
    // Palm Planter has no craftable missing ingredient with this bag: find any recipe that shows a +.
    await page.evaluate(() => {
      for (const t of document.querySelectorAll('#inventory .sv-tab')) { t.click();
        for (const r of document.querySelectorAll('#inventory .sv-recipe:not([hidden])')) { r.click(); if (document.querySelector('#inventory .sv-iplus:not([hidden])')) return r.dataset.recipe; } }
      return null;
    });
    await page.waitForTimeout(200);
  }
  const base = target.split('+')[0];
  const sel = { chip: '#inventory .sv-ing', plus: '#inventory .sv-iplus:not([hidden])', row: '#inventory .sv-recipe:not([hidden])' }[base];
  const loc = page.locator(sel).first();
  if (!(await loc.count())) { await ctx.close(); return { case: name, skipped: 'no element ' + sel }; }
  // Park the pointer on the empty backdrop first so no tooltip is open when the target is measured.
  await page.mouse.move(3, h - 3); await page.waitForTimeout(250);
  const b = await loc.boundingBox();
  // "+feed": pickup-feed rows arrive while the bag is open (as when nets or the hook collect debris); game.js docks the feed into the bag.
  if (target.endsWith('+feed')) await page.evaluate(() => { let n = 0; const f = window.raftPickupFeed;
    const t = setInterval(() => { if (++n > 12) return clearInterval(t); f.add(['wood', 'leaf', 'plastic'][n % 3], 1); if (n % 4 === 1) f.note('Your net caught some driftwood and a few palm leaves near the raft'); }, 250); });
  // Sampling starts before the pointer arrives, so the first frames show the settled layout.
  const sampling = page.evaluate(sampler, FRAMES);
  await page.waitForTimeout(100);
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const atPoint = await page.evaluate(([x, y]) => document.elementsFromPoint(x, y).slice(0, 4).map(e => e.tagName + '.' + String(e.className?.baseVal ?? e.className)), [cx, cy]);
  await page.mouse.move(cx - 20, cy); await page.mouse.move(cx, cy, { steps: 3 });
  // A resting hand still twitches: re-send the pointer at +-1px while sampling so the browser re-evaluates
  // hover after each layout shift (a desktop Chrome does this on its own; headless only on real input).
  let jitter = true;
  const jitterLoop = (async () => { let k = 0;
    while (jitter) { await page.mouse.move(cx + (k++ % 2), cy).catch(() => {}); await page.waitForTimeout(16).catch(() => {}); } })();
  const res = await sampling;
  // A burst of screenshots while the pointer still rests there: each one catches whichever half of the loop was painted.
  const burst = [];
  if (OUT) for (let k = 0; k < 6; k++) {
    const file = join(OUT, `flicker-${w}x${h}-dpr${dpr}-${target}-burst${k}.png`);
    await page.screenshot({ path: file });
    burst.push(await page.evaluate(() => Math.round(document.querySelector('#inventory .sv-wrap').getBoundingClientRect().x)));
  }
  jitter = false; await jitterLoop;
  // Freeze the "tooltip shown" half of the loop for a screenshot: park the real pointer on the backdrop
  // (so no boundary event undoes it) and send one synthetic pointerover to the target.
  let frozen = null;
  if (OUT) {
    await page.mouse.move(3, h - 3); await page.waitForTimeout(150);
    frozen = await page.evaluate(s => { const el = document.querySelector(s);
      el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 0, clientY: 0 }));
      const it = document.querySelector('.it-tip'), r = document.querySelector('#inventory .sv-wrap').getBoundingClientRect();
      return { panelX: Math.round(r.x), itTipPosition: it && getComputedStyle(it).position, itTipBox: it && [it.offsetLeft, it.offsetWidth] }; }, sel);
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(OUT, `flicker-${w}x${h}-dpr${dpr}-${target}-frozen.png`) });
  }
  const rows = res.rows;
  const distinct = k => [...new Set(rows.map(r => JSON.stringify(r[k])))];
  const keys = ['kids', 'itPos', 'wrap', 'craft', 'side', 'detail', 'lane', 'feed', 'bag', 'chip', 'tip', 'itTip', 'vw', 'vh', 'hover'];
  const d = Object.fromEntries(keys.map(k => [k, distinct(k)]));
  const togglesPerFrame = +(res.toggles / rows.length).toFixed(2);
  const inflow = rows.some(r => r.itPos && r.itPos.startsWith('static') && !r.itPos.endsWith(':hidden'));
  const unstable = (inflow ? ['tooltip-in-flow'] : []).concat(togglesPerFrame > 0.25 ? ['tooltip-toggles-every-frame'] : [], Object.keys(res.wrapXs).length > 1 ? ['panel-x-in-mutations'] : []).concat(['wrap', 'craft', 'detail', 'bag', 'chip', 'vw'].filter(k => d[k].length > 1));
  if (OUT) await page.screenshot({ path: join(OUT, `flicker-${w}x${h}-dpr${dpr}-${target}.png`) });
  const layout = await page.evaluate(layoutInfo);
  layout.tips = await page.evaluate(() => [...document.querySelectorAll('.it-tip')].map(t => ({ parent: t.parentElement?.id || t.parentElement?.tagName, hidden: t.hidden })));
  layout.styles = await page.evaluate(() => [...document.querySelectorAll('style[id]')].map(s => s.id).filter(id => /survival|tooltip/.test(id)));
  await ctx.close();
  const timeline = rows.map(r => (r.wrap ? r.wrap[0] : '-') + (r.itTip ? '+' : '')).join(' ');
  return { case: name, swap, frozen, burstPanelX: burst, atPoint, box: b, togglesPerFrame, panelXDuringMutations: res.wrapXs, timeline, recipe: found ? 'palm' : 'first', frames: rows.length, distinct: d, mutationsTotal: rows.at(-1).muts,
    mutTargets: res.mutTargets, layout, errors, verdict: unstable.length ? 'FLICKER' : 'STABLE', unstable };
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const cases = [];
// VIEWPORTS="1536x864@1,1229x691@1.25" overrides the default sweep.
const VIEWPORTS = (process.env.VIEWPORTS || '1536x864@1,1536x864@1.25,1920x1080@1').split(',').map(v => { const m = v.match(/(\d+)x(\d+)(?:@([\d.]+))?/); return [+m[1], +m[2], +(m[3] || 1)]; });
const TARGETS = (process.env.TARGETS || 'chip,plus,row,chip+feed').split(',');
for (const [w, h, dpr] of VIEWPORTS)
  for (const target of TARGETS) {
    try { cases.push(await runCase(browser, w, h, dpr, target)); }
    catch (e) { cases.push({ case: `${w}x${h}@${dpr} ${target}`, error: String(e).slice(0, 300) }); }
  }
await browser.close(); srv.close();
console.log(JSON.stringify(cases, null, 1));
for (const c of cases) console.log(c.case, c.verdict || (c.skipped ? 'SKIPPED ' + c.skipped : 'ERROR ' + c.error), (c.unstable || []).join(','),
  c.distinct ? `panel x per rAF ${c.distinct.wrap.map(v => JSON.parse(v)?.[0]).join('/')}; panel x inside mutations ${JSON.stringify(c.panelXDuringMutations)}; tooltip toggles/frame ${c.togglesPerFrame}` : '');
process.exit(cases.some(c => c.verdict === 'FLICKER') ? 1 : cases.some(c => c.error) ? 2 : 0);
