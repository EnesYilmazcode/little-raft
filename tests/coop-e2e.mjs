// Two-client co-op end-to-end test over the loopback transport (dist/coop-loopback.js, `?loopback`).
// Run: node tests/coop-e2e.mjs   (not part of npm test; needs Playwright + Chromium)
// Exit code 0 when every check passes; prints a JSON summary on stdout.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({chromium} = require('playwright')); } catch { ({chromium} = await import('playwright')); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'docs/cloud/shots/coop');
const TYPES = {'.js':'text/javascript', '.mjs':'text/javascript', '.html':'text/html', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json', '.ico':'image/x-icon', '.png':'image/png'};

const server = http.createServer((req, res) => {
  let u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(DIST, path.normalize(u));
  if (!f.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, {'content-type':TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control':'no-store'}); res.end(b);
  });
});

const VW = 960, VH = 540, CX = VW / 2, CY = VH / 2;
const results = [], errors = [], metrics = {};
const check = (name, pass, detail = {}) => { results.push({name, pass:!!pass, ...detail}); console.error((pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const st = p => p.evaluate(() => window.raftDebug.state);
const dbg = p => p.evaluate(() => { const d = window.coopDebug; return d ? {peer:d.peer, remote:d.remote, rejoin:d.rejoin, stats:d.stats} : null; });
const feedText = p => p.evaluate(() => [...document.querySelectorAll('#coopFeed .cf-line')].map(l => l.textContent));
const waitFor = (p, fn, arg, timeout = 15000) => p.waitForFunction(fn, arg, {timeout, polling:50}).then(() => true, () => false);

// Feed lines fade after ~6 s, so each page records every line ever pushed (read-only MutationObserver).
// Draw calls are skipped (window.__noDraw) except while taking screenshots: SwiftShader on a shared CI box
// renders this scene at 2-4 fps and blocks the main thread, which starves timers and the loopback handshake.
const INIT = `
for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
  if (!C) continue;
  for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
    const o = C.prototype[k]; if (o) C.prototype[k] = function (...a) { if (window.__noDraw) return; return o.apply(this, a); };
  }
}
window.__noDraw = ${process.env.COOP_E2E_DRAW ? 'false' : 'true'};
HTMLCanvasElement.prototype.requestPointerLock = function () { return Promise.reject(new Error('QA fallback')); };
try { localStorage.setItem('little-raft-settings', JSON.stringify({graphics:'low', volume:0})); } catch {}
window.__feedLog = []; window.__promptLog = [];
new MutationObserver(() => {
  for (const l of document.querySelectorAll('#coopFeed .cf-line')) if (!l.__seen) { l.__seen = 1; window.__feedLog.push(l.textContent); }
  const cp = document.getElementById('contextPrompt'); if (cp && !cp.hidden && cp.textContent && window.__promptLog.at(-1) !== cp.textContent) window.__promptLog.push(cp.textContent);
}).observe(document, {subtree:true, childList:true, characterData:true, attributes:true});
`;
const feedLog = p => p.evaluate(() => window.__feedLog.slice());

// Records raw guest->host wire traffic on the host page and decodes the delta stream with the game's own decoder.
async function tapWire(page) {
  await page.evaluate(async () => {
    const {DeltaDecoder} = await import('./coop-delta.js');
    const dec = new DeltaDecoder(); window.__wire = {cpHook:0, cp:0, last:null};
    const bc = new BroadcastChannel('little-raft-loopback');
    bc.onmessage = e => {
      const m = e.data; if (!m || m.t !== 'data') return;
      let d; try { d = JSON.parse(m.d); } catch { return; }
      if (d?.type !== 'Δ' || d.k !== 'cp') return;
      const full = dec.decode(d); if (!full) return;
      window.__wire.cp++; window.__wire.last = full;
      if (Array.isArray(full.k)) window.__wire.cpHook++;
    };
    window.__wireBc = bc;
  });
}

async function walk(page, keys, ms) { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k); }

async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/index.html?loopback`;
  const browser = await chromium.launch({args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  const ctx = await browser.newContext({viewport:{width:VW, height:VH}});
  await ctx.addInitScript(INIT);
  const host = await ctx.newPage(), guest = await ctx.newPage();
  for (const [name, p] of [['host', host], ['guest', guest]]) {
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
  }
  for (const p of [host, guest]) { await p.goto(base); await p.waitForFunction(() => !!window.raftDebug && !!window.coopChaos, null, {timeout:30000}); }

  // ---------- (1) connect through the UI ----------
  await host.click('#welcomeCrew'); await host.click('#host');
  await host.waitForFunction(() => document.querySelector('#roomCode').textContent.length === 6, null, {timeout:15000});
  const code = await host.locator('#roomCode').innerText();
  await guest.click('#welcomeCrew'); await guest.fill('#roomInput', code); await guest.click('#joinForm button');
  const ready = await waitFor(guest, () => window.raftDebug.state.networkReady, null, 20000) && await waitFor(host, () => !!window.raftDebug.state.other, null, 10000);
  const seen = ready && await waitFor(host, () => coopDebug.peer && coopDebug.remote.visible) && await waitFor(guest, () => coopDebug.peer && coopDebug.remote.visible);
  const [hd, gd] = [await dbg(host), await dbg(guest)];
  check('1 connect + see each other', ready && seen, {hostPeer:!!hd?.peer, guestPeer:!!gd?.peer, hostSees:hd?.remote.visible, guestSees:gd?.remote.visible, roles:[(await st(host)).role, (await st(guest)).role]});
  if (!ready) throw new Error('could not connect');
  for (const p of [host, guest]) { await p.mouse.click(CX, CY); await p.waitForTimeout(150); } // lock fails once -> mouse-ray fallback

  const fps = p => p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }));
  metrics.fps = {host:await fps(host), guest:await fps(guest)};
  console.error('fps', metrics.fps);

  // ---------- (3) join notice in the feed, not the centred prompt ----------
  await sleep(300);
  const hFeed = await feedLog(host), hPrompt = await host.evaluate(() => window.__promptLog.slice());
  const feedBox = await host.evaluate(() => { const r = document.getElementById('coopFeed')?.getBoundingClientRect(); return r ? {left:r.left, bottom:r.bottom, right:r.right} : null; });
  check('3 join in #coopFeed not #contextPrompt', hFeed.some(t => /brother joined/i.test(t)) && !hPrompt.some(t => /joined/i.test(t)) && feedBox && feedBox.left < 200 && feedBox.bottom > 400,
    {hostFeed:hFeed, hostPrompts:hPrompt, feedBox, guestFeed:await feedLog(guest), guestPrompts:await guest.evaluate(() => window.__promptLog.slice())});

  // ---------- (2a) guest walks, host's remote avatar converges ----------
  const g0 = (await st(guest)).me;
  await walk(guest, ['KeyW'], 700); await sleep(800);
  const g1 = (await st(guest)).me, r1 = (await dbg(host)).remote;
  const err = Math.hypot(r1.x - g1.x, r1.z - g1.z);
  check('2a remote avatar tracks guest (settled)', Math.hypot(g1.x - g0.x, g1.z - g0.z) > 0.5 && err < 0.3, {moved:+Math.hypot(g1.x - g0.x, g1.z - g0.z).toFixed(2), err:+err.toFixed(3), dy:+(r1.y - (g1.y - 1.6)).toFixed(2)});

  // ---------- (2b) jitter while walking in a circle under latency 80 / jitter 40 ----------
  await guest.evaluate(() => Object.assign(coopChaos, {latency:80, jitter:40}));
  await sleep(500);
  const samplesP = host.evaluate(() => new Promise(res => {
    const out = [], t0 = performance.now();
    const f = () => { const r = coopDebug.remote; out.push([performance.now() - t0, r.x, r.z]); if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(out); };
    requestAnimationFrame(f);
  }));
  const ring = [['KeyW'], ['KeyW', 'KeyD'], ['KeyD'], ['KeyS', 'KeyD'], ['KeyS'], ['KeyS', 'KeyA'], ['KeyA'], ['KeyW', 'KeyA']];
  const walking = (async () => { for (let i = 0; i < 9; i++) await walk(guest, ring[i % 8], 375); })();
  const samples = await samplesP; await walking;
  let maxJump = 0, back = 0, stalls = 0, frames = samples.length - 1, sumJump = 0, maxDt = 0;
  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i][1] - samples[i - 1][1], dz = samples[i][2] - samples[i - 1][2], d = Math.hypot(dx, dz);
    maxJump = Math.max(maxJump, d); sumJump += d; maxDt = Math.max(maxDt, samples[i][0] - samples[i - 1][0]);
    if (i > 1) {
      const px = samples[i - 1][1] - samples[i - 2][1], pz = samples[i - 1][2] - samples[i - 2][2], pd = Math.hypot(px, pz);
      if (pd > 1e-3 && d > 1e-3 && (dx * px + dz * pz) / (d * pd) < -0.5) back++;   // reversal between consecutive frames
      if (pd > 0.01 && d < 1e-4 && samples[i][0] < 2900) stalls++;                   // frozen frame while moving
    }
  }
  const meanJump = sumJump / Math.max(1, frames), interp = (await dbg(host)).stats.interp;
  metrics.jitter = {frames, maxFrameGapMs:+maxDt.toFixed(1), maxJumpM:+maxJump.toFixed(3), meanJumpM:+meanJump.toFixed(4), backwardSteps:back, stalls, interp};
  // A per-frame jump far above the mean is a visible pop; allow 4x mean (walk speed, uneven frames).
  check('2b smooth remote motion @80±40ms', frames > 30 && maxJump < Math.max(0.15, meanJump * 4) && back <= 2 && stalls <= 3, metrics.jitter);
  await guest.evaluate(() => Object.assign(coopChaos, {latency:0, jitter:0}));
  await sleep(800);

  // ---------- (4) middle-click ping ----------
  const pingBefore = (await feedLog(host)).filter(t => /look here/i.test(t)).length;
  await guest.mouse.move(CX, CY + 60); await guest.waitForTimeout(100);
  await guest.mouse.click(CX, CY + 60, {button:'middle'});
  const pinged = await waitFor(host, n => window.__feedLog.filter(t => /look here/i.test(t)).length > n, pingBefore, 3000);
  check('4 middle-click ping reaches host', pinged, {hostFeed:(await feedLog(host)).slice(-3), guestAimNull:await guest.evaluate(() => !window.raftDebug.state.running)});

  // ---------- (5) emote Z ----------
  await guest.keyboard.press('KeyZ');
  const waved = await waitFor(host, () => window.__feedLog.some(t => /waves/i.test(t)), null, 3000);
  check('5 emote Z -> host feed "waves"', waved, {guestFeed:(await feedLog(guest)).slice(-2)});

  // ---------- (6) hook throw -> remote rope ----------
  await tapWire(host);
  const slots = (await st(guest)).inventory;
  const hookIdx = await guest.evaluate(() => { const inv = window.raftDebug.state.inventory; const s = inv.slots ?? inv.items ?? inv; return Array.isArray(s) ? s.findIndex(x => (x?.kind ?? x?.type ?? x) === 'hook') : -1; });
  await guest.keyboard.press('Digit' + (hookIdx >= 0 && hookIdx < 8 ? hookIdx + 1 : 1)); await guest.waitForTimeout(150);
  await guest.mouse.move(CX, CY - 60); await guest.mouse.down(); await guest.waitForTimeout(700); await guest.mouse.up();
  const thrown = await waitFor(guest, () => window.raftDebug.state.hookStage !== 'idle', null, 2000);
  const wired = await waitFor(host, () => window.__wire.cpHook > 0, null, 3000);
  await host.waitForTimeout(300);
  const ropeInfo = await host.evaluate(() => ({cpHook:__wire.cpHook, lastK:__wire.last?.k, ropeAccessor:'rope' in coopDebug || 'hook' in coopDebug.remote}));
  check('6 hook throw -> host receives remote hook', thrown && wired, {guestStage:(await st(guest)).hookStage, held:(await st(guest)).heldKind, ...ropeInfo, note:ropeInfo.ropeAccessor ? '' : 'rope render not observable: no coopDebug accessor'});
  metrics.ropeAccessor = ropeInfo.ropeAccessor;

  // ---------- screenshots mid-session ----------
  await sleep(1500);
  await shoot(host, guest);

  // ---------- (7) bandwidth over 10 s of steady play ----------
  const snap = async p => p.evaluate(() => ({t:performance.now(), out:coopDebug.stats.bytesOut, in:coopDebug.stats.bytesIn,
    sent:Object.values(coopChaos.bytes.sent).reduce((a, b) => a + b, 0), recv:Object.values(coopChaos.bytes.recv).reduce((a, b) => a + b, 0), byType:JSON.parse(JSON.stringify(coopChaos.bytes.sent))}));
  const [h0, gg0] = [await snap(host), await snap(guest)];
  const play = (async () => { for (let i = 0; i < 25; i++) await walk(guest, ring[(i * 3) % 8], 400); })();
  await play;
  const [h1, gg1] = [await snap(host), await snap(guest)];
  const rate = (a, b, k) => (b[k] - a[k]) / ((b.t - a.t) / 1000);
  const byType = (a, b) => Object.fromEntries(Object.keys(b.byType).map(k => [k, Math.round((b.byType[k] - (a.byType[k] ?? 0)) / ((b.t - a.t) / 1000))]));
  const hd7 = await dbg(host), gd7 = await dbg(guest);
  metrics.bandwidth = {
    hostToGuestBps:Math.round(rate(h0, h1, 'sent')), guestToHostBps:Math.round(rate(gg0, gg1, 'sent')),
    guestRecvBps:Math.round(rate(gg0, gg1, 'recv')), hostRecvBps:Math.round(rate(h0, h1, 'recv')),
    hostByType:byType(h0, h1), guestByType:byType(gg0, gg1),
    coopDebug:{hostOutBps:Math.round(hd7.stats.outBps), hostInBps:Math.round(hd7.stats.inBps), guestOutBps:Math.round(gd7.stats.outBps), guestInBps:Math.round(gd7.stats.inBps)},
  };
  check('7 bandwidth host->guest <6KB/s, guest->host <2KB/s', metrics.bandwidth.hostToGuestBps < 6000 && metrics.bandwidth.guestToHostBps < 2000, metrics.bandwidth);

  // ---------- (8) reconnect: drop() and blackhole(6000) ----------
  await guest.keyboard.press('KeyE'); // pick something up if in reach (harmless otherwise)
  await sleep(1500);
  for (const [label, act] of [['drop', () => coopChaos.drop()], ['blackhole', () => coopChaos.blackhole(6000)]]) {
    const before = await st(guest);
    await guest.evaluate(() => { window.__feedLog.length = 0; });
    const t0 = Date.now();
    await guest.evaluate(act);
    const wentDown = await waitFor(guest, () => !window.raftDebug.state.networkReady || !!coopDebug.rejoin, null, 8000);
    const roleDuring = (await st(guest)).role;
    const back = wentDown && await waitFor(guest, () => window.raftDebug.state.networkReady && !coopDebug.rejoin, null, 10000 + (label === 'blackhole' ? 6000 : 0));
    const secs = (Date.now() - t0) / 1000;
    const after = await st(guest), fl = await feedLog(guest);
    const moved = Math.hypot(after.me.x - before.me.x, after.me.z - before.me.z);
    const sameInv = JSON.stringify(after.inventory) === JSON.stringify(before.inventory);
    const hostSees = back && await waitFor(host, () => coopDebug.remote.visible && !!window.raftDebug.state.other, null, 5000);
    const limit = label === 'blackhole' ? 16 : 10;
    check(`8 reconnect after ${label}`, wentDown && back && roleDuring === 'guest' && after.role === 'guest' && fl.some(t => /reconnecting/i.test(t)) && sameInv && moved < 1 && hostSees && secs <= limit,
      {wentDown, back, secs:+secs.toFixed(1), roleDuring, role:after.role, feed:fl, sameInv, moved:+moved.toFixed(2), hostSees, hostRole:(await st(host)).role});
    await sleep(1500);
  }

  // ---------- (9) host leaves for good ----------
  await guest.evaluate(() => { window.__feedLog.length = 0; });
  const t9 = Date.now();
  await host.close({runBeforeUnload:true});
  const solo = await waitFor(guest, () => window.raftDebug.state.role === 'solo', null, 40000);
  check('9 host leaves -> guest back to solo', solo, {secs:+((Date.now() - t9) / 1000).toFixed(1), feed:await feedLog(guest), status:await guest.locator('#networkStatus').innerText().catch(() => '')});

  await browser.close();
}

async function shoot(host, guest) {
  fs.mkdirSync(SHOTS, {recursive:true});
  // turn each camera towards the other player (drag-look in lock-fallback mode), then capture
  for (const [me, them] of [[guest, host], [host, guest]]) {
    for (let i = 0; i < 6; i++) {
      const s = await st(me), o = (await dbg(me)).remote;
      const want = Math.atan2(-(o.x - s.me.x), -(o.z - s.me.z)); // camera looks down -z at yaw 0
      let d = want - s.me.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const dp = -0.12 - s.me.pitch;
      if (Math.abs(d) < 0.03 && Math.abs(dp) < 0.03) break;
      const sens = 0.0035; // rough guess, refined by iterating
      await me.mouse.move(CX, CY); await me.mouse.down();
      await me.mouse.move(CX - Math.max(-400, Math.min(400, d / sens)), CY - Math.max(-200, Math.min(200, dp / sens)), {steps:8});
      await me.mouse.up(); await me.waitForTimeout(120);
    }
  }
  await sleep(400);
  for (const p of [host, guest]) await p.evaluate(() => { window.__noDraw = false; });
  for (const p of [host, guest]) await p.evaluate(() => new Promise(r => { let n = 0; const f = () => ++n >= 3 ? r() : requestAnimationFrame(f); requestAnimationFrame(f); }));
  await host.screenshot({path:path.join(SHOTS, 'e2e-host.png')});
  await guest.screenshot({path:path.join(SHOTS, 'e2e-guest.png')});
  for (const p of [host, guest]) await p.evaluate(v => { window.__noDraw = v; }, !process.env.COOP_E2E_DRAW);
}

let code = 1;
try { await main(); } catch (e) { errors.push('harness: ' + (e?.stack || e)); }
finally {
  server.close();
  check('no page errors', errors.length === 0, {errors});
  code = results.every(r => r.pass) ? 0 : 1;
  console.log(JSON.stringify({pass:code === 0, results:results.map(({name, pass, ...d}) => ({name, pass, ...d})), metrics}, null, 1));
  process.exit(code);
}
