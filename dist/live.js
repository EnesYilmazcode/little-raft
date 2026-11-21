// Little Raft live loader: boots the engine and hot-swaps new builds without reloading the page.
// Load as: <script type="module" src="live.js"></script> (needs import.meta.url).
// Contract: game.js exports mount(transfer|null) -> { capture(), dispose(), pause?(), resume?() }.

import { buildFromUrl, liveDecision } from './session-rules.js?build=v3-survival-ae77fa84ac2b';

const BASE = import.meta.url;
const POLL_MS = 6000;
const MAX_BACKOFF_MS = 60000;
const FAILED_RETRY_MS = 60000;
const CSS_TIMEOUT_MS = 15000;
const CSS_FILES = ['style.css', 'graphics.css'];
// game.js' static import graph, spelled exactly as the modules import each other (a modulepreload only helps when
// its URL equals the import's URL, ?build= stamp included; publish_local.py restamps these quoted specifiers in step).
// Preloading them all at once flattens the import waterfall. tests/live-preload.test.mjs keeps this list equal to
// the real graph; a stale entry only costs a wasted request, a missing one just loads late via the normal import.
const PRELOAD = [
  './audio.js?build=v3-survival-ae77fa84ac2b', './avatar.js?build=v3-survival-ae77fa84ac2b',
  './bottle.js?build=v3-survival-ae77fa84ac2b', './build-menu.js?build=v3-survival-ae77fa84ac2b',
  './build-radial.js', './build-rules.js?build=v3-survival-ae77fa84ac2b',
  './building-models.js?build=v3-survival-ae77fa84ac2b', './building-pieces.js?build=v3-survival-ae77fa84ac2b',
  './building.js?build=v3-survival-ae77fa84ac2b', './content-items.js?build=v3-survival-ae77fa84ac2b',
  './content.js?build=v3-survival-ae77fa84ac2b', './controls-tab.js', './controls.js', './cooking.js',
  './coop-avatar.js', './coop-delta.js', './coop-feed.js', './coop-fx.js', './coop-interp.js', './coop-loopback.js',
  './coop-rules.js?build=v3-survival-ae77fa84ac2b', './coop.js?build=v3-survival-ae77fa84ac2b',
  './craft-book.js?build=v3-survival-ae77fa84ac2b', './crafts.js?build=v3-survival-ae77fa84ac2b',
  './daynight.js?build=v3-survival-ae77fa84ac2b', './debris.js?build=v3-survival-ae77fa84ac2b',
  './deck.js?build=v3-survival-ae77fa84ac2b', './diving-ui.js', './diving.js?build=v3-survival-ae77fa84ac2b',
  './fish-journal.js', './fish-models.js', './fish-species.js', './fishing-cooking.js',
  './fishing-rules.js?build=v3-survival-ae77fa84ac2b', './fishing-tool.js?build=v3-survival-ae77fa84ac2b',
  './fishing-v2.js', './hammer.js?build=v3-survival-ae77fa84ac2b', './hands.js?build=v3-survival-ae77fa84ac2b',
  './held-items.js?build=v3-survival-ae77fa84ac2b', './hook-physics.js?build=v3-survival-ae77fa84ac2b',
  './hook.js?build=v3-survival-ae77fa84ac2b', './input-map.js', './input.js',
  './inventory-state.js?build=v3-survival-ae77fa84ac2b', './islands-layout.js', './islands-models.js',
  './islands.js?build=v3-survival-ae77fa84ac2b', './item-batches.js?build=v3-survival-ae77fa84ac2b', './item-icons.js?build=v3-survival-ae77fa84ac2b', './item-svg.js',
  './item-tooltips.js', './items.js', './logbook-ui.js?build=v3-survival-ae77fa84ac2b',
  './logbook.js?build=v3-survival-ae77fa84ac2b', './materials.js?build=v3-survival-ae77fa84ac2b',
  './merge-geo.js?build=v3-survival-ae77fa84ac2b', './models.js?build=v3-survival-ae77fa84ac2b', './move-feel.js',
  './ocean.js?build=v3-survival-ae77fa84ac2b', './pickup-feed.js?build=v3-survival-ae77fa84ac2b',
  './placement.js?build=v3-survival-ae77fa84ac2b', './plastic.js?build=v3-survival-ae77fa84ac2b',
  './player-physics.js?build=v3-survival-ae77fa84ac2b', './progression-hooks.js', './progression.js',
  './purifier-model.js?build=v3-survival-ae77fa84ac2b', './quality.js?build=v3-survival-ae77fa84ac2b',
  './sailing-core.js?build=v3-survival-ae77fa84ac2b', './sailing-ui.js',
  './sailing-world.js?build=v3-survival-ae77fa84ac2b', './seafloor.js?build=v3-survival-ae77fa84ac2b',
  './session-rules.js?build=v3-survival-ae77fa84ac2b', './settings.js?build=v3-survival-ae77fa84ac2b',
  './signal-models.js?build=v3-survival-ae77fa84ac2b', './signal.js?build=v3-survival-ae77fa84ac2b',
  './smelter-model.js', './smelter-ui.js', './smelter.js', './storage-research-model.js',
  './storage-research.js?build=v3-survival-ae77fa84ac2b', './survival-ui.js?build=v3-survival-ae77fa84ac2b',
  './texgen/bark.js', './texgen/cloth.js', './texgen/foam.js', './texgen/leaf.js', './texgen/noise.js',
  './texgen/plank.js', './texgen/planks.js', './texgen/plastic.js', './texgen/rock.js', './texgen/rope.js',
  './texgen/sand.js', './texgen/scrap.js', './textures.js', './underwater-fx.js', './vendor/three.module.js',
  './watering.js?build=v3-survival-ae77fa84ac2b', './wildlife-models.js',
  './wildlife.js?build=v3-survival-ae77fa84ac2b', './wood.js?build=v3-survival-ae77fa84ac2b',
  './bees-model.js?build=v3-survival-ae77fa84ac2b', './bees.js?build=v3-survival-ae77fa84ac2b', './hud.js?build=v3-survival-ae77fa84ac2b', './input-rules.js?build=v3-survival-ae77fa84ac2b',
  './instrument-models.js?build=v3-survival-ae77fa84ac2b', './instruments.js?build=v3-survival-ae77fa84ac2b', './lock-rules.js?build=v3-survival-ae77fa84ac2b', './rain-model.js?build=v3-survival-ae77fa84ac2b',
  './rain.js?build=v3-survival-ae77fa84ac2b', './scenery-islands.js?build=v3-survival-ae77fa84ac2b', './sky.js?build=v3-survival-ae77fa84ac2b',
];

const state = {
  engine: null,
  build: null,
  protocol: null,
  updating: false,
  lastError: null,
  failedBuild: null,
  failedAt: 0,
  retryCount: 0,
  nextSessionBuild: null,
  pollTimer: 0,
  pollDelay: POLL_MS,
  lastCheckAt: 0,
  stopped: false,
};

// ---------- status UI (own CSS, independent of game CSS) ----------
function injectStyle() {
  if (document.getElementById('raftLiveStyle')) return;
  const s = document.createElement('style');
  s.id = 'raftLiveStyle';
  s.textContent = `
#updateStatus{position:fixed;left:50%;bottom:18px;transform:translate(-50%,12px);z-index:2147483000;
max-width:min(92vw,420px);padding:9px 16px;border-radius:10px;background:#14213d;color:#fdf6e3;
border:1px solid rgba(253,246,227,.35);box-shadow:0 6px 20px rgba(0,0,0,.28);
font:500 13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.01em;text-align:center;
pointer-events:none;opacity:0;transition:opacity .25s ease,transform .25s ease}
#updateStatus.show{opacity:1;transform:translate(-50%,0)}
#raftLiveError{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;
background:rgba(20,33,61,.55);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#raftLiveError section{max-width:min(92vw,440px);padding:22px 24px;border-radius:14px;background:#fdf6e3;color:#14213d;
box-shadow:0 12px 40px rgba(0,0,0,.35)}
#raftLiveError h2{margin:0 0 8px;font-size:19px}
#raftLiveError p{margin:0 0 10px}
#raftLiveError code{display:block;max-height:7em;overflow:auto;padding:8px;border-radius:6px;background:#efe6cf;
font:12px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
#raftLiveError button{margin-top:12px;padding:8px 16px;border:0;border-radius:8px;background:#14213d;color:#fdf6e3;
font:600 14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer}
@media (prefers-reduced-motion:reduce){#updateStatus{transition:none}}`;
  (document.head || document.documentElement).appendChild(s);
}

let statusHideTimer = 0;
function showStatus(text, ms) {
  injectStyle();
  let el = document.getElementById('updateStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'updateStatus';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = text;
  // force reflow so the transition replays
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(statusHideTimer);
  if (ms > 0) statusHideTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function showFatal(err) {
  injectStyle();
  let card = document.getElementById('raftLiveError');
  if (!card) {
    card = document.createElement('div');
    card.id = 'raftLiveError';
    card.setAttribute('role', 'alert');
    card.innerHTML = '<section><h2>The ocean could not load</h2>' +
      '<p>Little Raft failed to start in this browser. Your saved raft is safe.</p>' +
      '<code></code><button type="button">Try again</button></section>';
    document.body.appendChild(card);
    card.querySelector('button').addEventListener('click', () => {
      card.remove();
      boot();
    });
  }
  card.querySelector('code').textContent = String((err && (err.stack || err.message)) || err);
}

// ---------- helpers ----------
function errText(e) { return (e && e.message) ? e.message : String(e); }

async function fetchManifest() {
  const url = new URL('./version.json', BASE);
  url.searchParams.set('t', Date.now().toString(36));
  const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) throw new Error('version.json HTTP ' + res.status);
  const m = await res.json();
  if (!m || typeof m.build !== 'string' || !m.build) throw new Error('version.json missing build');
  return { build: m.build, protocol: Number(m.protocol) || 0 };
}

function moduleUrl(build, retry) {
  const url = new URL('./game.js?build=v3-survival-ae77fa84ac2b', BASE);
  if (build) url.searchParams.set('build', build);
  // A failed module record stays cached per URL; give retries a fresh URL.
  if (retry) url.searchParams.set('retry', String(retry));
  return url.href;
}

function validEngine(e) {
  return e && typeof e.capture === 'function' && typeof e.dispose === 'function';
}

function engineProtocol(mod) {
  return mod && Number.isFinite(mod.PROTOCOL) ? mod.PROTOCOL : null;
}

async function importGame(build, retry) {
  const mod = await import(moduleUrl(build, retry));
  if (!mod || typeof mod.mount !== 'function') throw new Error('game.js does not export mount()');
  return mod;
}

function preloadGraph() {
  if (typeof document === 'undefined') return;
  const head = document.head || document.documentElement;
  const have = new Set([...document.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.href));
  for (const spec of PRELOAD) {
    const href = new URL(spec, BASE).href;
    if (have.has(href)) continue;
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = href;
    head.appendChild(link);
  }
}

// ---------- staged CSS ----------
function cssName(link) {
  try {
    const p = new URL(link.href, document.baseURI).pathname;
    return CSS_FILES.find((f) => p.endsWith('/' + f) || p === f) || null;
  } catch { return null; }
}

function currentCssLinks() {
  const out = {};
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) {
    if (l.dataset.liveStaged === '1') continue;
    const n = cssName(l);
    if (n) (out[n] = out[n] || []).push(l);
  }
  return out;
}

function stageCss(build) {
  const existing = currentCssLinks();
  const staged = [];
  const loads = CSS_FILES.map((name) => new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.media = 'print'; // download without applying
    link.dataset.liveStaged = '1';
    const url = new URL('./' + name, BASE);
    url.searchParams.set('build', build);
    link.href = url.href;
    const t = setTimeout(() => reject(new Error(name + ' load timeout')), CSS_TIMEOUT_MS);
    link.onload = () => { clearTimeout(t); resolve(); };
    link.onerror = () => { clearTimeout(t); reject(new Error(name + ' failed to load')); };
    const olds = existing[name];
    const anchor = olds && olds[olds.length - 1];
    if (anchor && anchor.parentNode) anchor.after(link);
    else document.head.appendChild(link);
    staged.push({ name, link, olds: olds || [] });
  }));
  return {
    ready: Promise.all(loads),
    activate() { for (const s of staged) s.link.media = 'all'; },
    commit() {
      for (const s of staged) {
        for (const o of s.olds) o.remove();
        delete s.link.dataset.liveStaged;
      }
    },
    abort() { for (const s of staged) s.link.remove(); },
  };
}

// ---------- boot ----------
// The build baked into moduleUrl() (publish_local.py rewrites it in step with version.json).
const BAKED_BUILD = new URL(moduleUrl(null)).searchParams.get('build');

async function boot() {
  const retry = state.retryCount ? state.retryCount : 0;
  // Start fetching game.js and its import graph while version.json is in flight.
  const early = importGame(null, retry);
  preloadGraph(); // fetch the whole static graph in parallel instead of level by level
  early.catch(() => {}); // only awaited if the manifest agrees (or is unavailable)
  let manifest = null;
  try {
    manifest = await fetchManifest();
  } catch (e) {
    console.warn('[raftLive] version.json unavailable, booting unversioned game.js', e);
  }
  const build = manifest ? manifest.build : null;
  try {
    const mod = await (!build || build === BAKED_BUILD ? early : importGame(build, retry));
    const engine = mod.mount(null);
    if (!validEngine(engine)) throw new Error('mount() did not return { capture, dispose }');
    state.engine = engine;
    // Know what is running without trusting a later manifest: the build stamped into the game.js URL
    // and the protocol the engine itself exports. Unknown stays null (never hot-swapped across).
    state.build = build || buildFromUrl(moduleUrl(null));
    state.protocol = engineProtocol(mod) ?? (manifest ? manifest.protocol : null);
    state.lastError = null;
  } catch (e) {
    state.retryCount++;
    state.lastError = 'boot: ' + errText(e);
    console.error('[raftLive] Little Raft failed to start', e);
    showFatal(e);
  }
  schedule(POLL_MS);
}

// ---------- update check / swap ----------
async function check() {
  if (state.updating) return { status: 'busy', build: state.build };
  state.lastCheckAt = Date.now();
  let manifest;
  try {
    manifest = await fetchManifest();
  } catch (e) {
    // Silent: network hiccups must not disturb play.
    state.pollDelay = Math.min(state.pollDelay * 2, MAX_BACKOFF_MS);
    return { status: 'network-error', error: errText(e), build: state.build };
  }
  state.pollDelay = POLL_MS;

  const decision = liveDecision({ build: state.build, protocol: state.protocol }, manifest, !!state.engine);
  if (decision === 'current') return { status: 'current', build: state.build };
  if (decision === 'next-session') {
    if (state.nextSessionBuild !== manifest.build) {
      state.nextSessionBuild = manifest.build;
      showStatus('An update is ready for your next session', 9000);
    }
    return { status: 'next-session', build: state.build, available: manifest.build };
  }

  if (manifest.build === state.failedBuild && Date.now() - state.failedAt < FAILED_RETRY_MS) {
    return { status: 'failed-recently', build: state.build, available: manifest.build };
  }

  return swap(manifest);
}

async function swap(manifest) {
  state.updating = true;
  const retry = manifest.build === state.failedBuild ? ++state.retryCount : 0;
  const old = state.engine;
  let css = null;
  let paused = false;
  try {
    // 1. Load new code and CSS while the old engine keeps running.
    const modP = importGame(manifest.build, retry);
    css = stageCss(manifest.build);
    const [mod] = await Promise.all([modP, css.ready]);
    if (state.stopped) throw new Error('page hidden during update');

    // 2. Synchronous handoff (no frame can run in between).
    let transfer = null;
    if (old) {
      transfer = old.capture();
      if (typeof old.pause === 'function') { old.pause(); paused = true; }
    }
    css.activate();
    const next = mod.mount(transfer);
    if (!validEngine(next)) throw new Error('mount() did not return { capture, dispose }');

    // 3. Commit.
    css.commit();
    state.engine = next;
    state.build = manifest.build;
    if (!old) state.protocol = engineProtocol(mod) ?? manifest.protocol; // recovering from a failed boot
    state.failedBuild = null;
    state.lastError = null;
    if (old) {
      try { old.dispose(); } catch (e) { console.error('[raftLive] old engine dispose failed', e); }
      showStatus('Ocean updated. Keep playing.', 3500);
    } else {
      document.getElementById('raftLiveError')?.remove();
    }
    return { status: 'updated', build: state.build };
  } catch (e) {
    if (css) css.abort(); // old <link>s were never removed
    if (paused && typeof old.resume === 'function') {
      try { old.resume(); } catch (re) { console.error('[raftLive] resume failed', re); }
    }
    state.failedBuild = manifest.build;
    state.failedAt = Date.now();
    state.lastError = manifest.build + ': ' + errText(e);
    console.error('[raftLive] update to ' + manifest.build + ' failed; keeping ' + state.build, e);
    if (old) showStatus('Update paused — still playing this version', 6000);
    return { status: 'failed', build: state.build, available: manifest.build, error: state.lastError };
  } finally {
    state.updating = false;
  }
}

// ---------- polling ----------
function schedule(ms) {
  clearTimeout(state.pollTimer);
  if (state.stopped) return;
  state.pollTimer = setTimeout(tick, ms);
}

async function tick() {
  if (!document.hidden) {
    try { await check(); } catch (e) { console.error('[raftLive] check failed', e); }
  }
  schedule(state.pollDelay);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - state.lastCheckAt >= POLL_MS) schedule(0);
});
// bfcache: stop polling while frozen, resume on restore. Engine is left untouched.
window.addEventListener('pagehide', (ev) => {
  if (ev.persisted) { state.stopped = true; clearTimeout(state.pollTimer); }
});
window.addEventListener('pageshow', (ev) => {
  if (ev.persisted) { state.stopped = false; schedule(0); }
});

// ---------- QA API ----------
const api = {};
Object.defineProperties(api, {
  build: { get: () => state.build || 'unversioned', enumerable: true },
  protocol: { get: () => state.protocol, enumerable: true },
  updating: { get: () => state.updating, enumerable: true },
  lastError: { get: () => state.lastError, enumerable: true },
  check: { value: () => check(), enumerable: true },
});
Object.freeze(api);
Object.defineProperty(window, 'raftLive', { value: api, writable: false, configurable: false, enumerable: false });

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
