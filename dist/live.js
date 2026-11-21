// Little Raft live loader: boots the engine and hot-swaps new builds without reloading the page.
// Load as: <script type="module" src="live.js"></script> (needs import.meta.url).
// Contract: game.js exports mount(transfer|null) -> { capture(), dispose(), pause?(), resume?() }.

import { buildFromUrl, liveDecision, routeStatus } from './session-rules.js?build=v3-survival-ae77fa84ac2b';

const BASE = import.meta.url;
const POLL_MS = 6000;
const MAX_BACKOFF_MS = 60000;
const FAILED_RETRY_MS = 60000;
const CSS_TIMEOUT_MS = 15000;
const CSS_FILES = ['style.css', 'graphics.css'];
// Every module in game.js' static import graph (dynamic import() targets stay out). Preloading them all at once
// flattens the 6-level import waterfall. tests/live-preload.test.mjs keeps this list in step with the imports;
// a stale entry only costs a wasted request, a missing one just loads late via the normal import.
const PRELOAD = [
  'animals-core.js', 'animals-models.js', 'animals.js', 'audio.js', 'avatar.js', 'bake.js', 'bees-model.js',
  'bees.js', 'bottle.js', 'camera-models.js', 'camera.js' /* [camera] */, 'brush-model.js', 'build-menu.js', 'build-radial.js', 'build-rules.js',
  'building-models.js', 'building-pieces.js', 'building.js', 'content-items.js', 'content.js', 'controls.js',
  'cooking.js', 'cookpot-core.js', 'cookpot-model.js', 'cookpot.js', 'coop-avatar.js', 'coop-delta.js', 'coop-feed.js', 'coop-fx.js', 'coop-interp.js',
  'coop-loopback.js', 'coop-rules.js', 'coop.js', 'craft-book.js', 'crafts.js', 'daynight.js', 'debris.js',
  'deck.js', 'decor-pack-models.js', 'display-model.js', 'display.js' /* [display] */, 'decor-pack.js', 'decor-pickup.js', 'diving-gear-core.js', 'diving-gear.js', 'diving-ui.js', 'diving.js', 'engine-models.js', 'engine.js',
  'fireworks-model.js', 'fireworks.js' /* [fireworks] */, 'fish-journal.js', 'fish-models.js', 'fish-trap-model.js', 'fish-trap.js' /* [fishtrap] */, 'fish-species.js', 'fishing-cooking.js', 'fishing-rules.js',
  'fishing-tool.js', 'fishing-v2.js', 'flags-core.js', 'flags-model.js', 'flags.js', 'gull-models.js', 'gull.js' /* [gull] */, 'hammer.js', 'hands.js', 'held-items.js', 'hook-physics.js', 'hook.js',
  'hud.js', 'icon-models.js', 'input-map.js', 'input-rules.js', 'input.js', 'instrument-models.js', 'instruments.js',
  'inventory-state.js', 'islands-layout.js', 'islands-models.js', 'islands.js', 'item-icons.js', 'item-svg.js',
  'item-tooltips.js', 'items.js', 'juicer-model.js', 'juicer.js' /* [juicer] */, 'kiln-core.js', 'kiln-model.js', 'kiln.js', 'lock-rules.js', 'logbook-ui.js',
  'logbook.js', 'look-ui.js', 'look.js', 'maptable-model.js', 'maptable.js', 'materials.js', 'merge-geo.js',
  'models.js', 'move-feel.js', 'ocean.js', 'paint.js', 'pickup-feed.js', 'placement.js', 'plastic.js',
  'photo-album-ui.js', 'photo-frame.js', 'photo-store.js' /* [camera] */, 'player-physics.js', 'power-model.js', 'power.js' /* [power] */, 'progression-hooks.js', 'progression.js', 'purifier-model.js', 'quality.js', 'rain-model.js',
  'rain.js', 'recycler-model.js' /* [recycler] */, 'repair.js', 'sailing-core.js', 'sailing-ui.js', 'sailing-world.js', 'scenery-islands.js', 'buoycourse-core.js', 'buoycourse-model.js', 'buoycourse.js', 'gametable-core.js', 'gametable-model.js', 'gametable.js', 'paddleboard-core.js', 'paddleboard-model.js', 'paddleboard.js',
  'scarecrow-model.js', 'scarecrow.js' /* [scarecrow] */, 'seafloor.js', 'session-rules.js', 'settings.js', 'shark-model.js', 'shark.js', 'signal-models.js', 'signal.js',
  'signs-core.js', 'sitting-core.js', 'sitting.js', 'sky.js', 'sleep-model.js', 'sleep.js', 'smelter-model.js', 'smelter-ui.js', 'smelter.js',
  'spear-model.js', 'spear-repair-hooks.js', 'spear.js', 'storage-research-model.js', 'storage-research.js',
  'survival-ui.js', 'tasks-model.js', 'tasks-rules.js', 'tasks.js' /* [tasks] */, 'textures.js', 'trader-core.js', 'trader-model.js', 'trader.js', 'treasure-models.js', 'treasure-rules.js', 'treasure.js', 'underwater-fx.js',
  'vitals-ui.js', 'vitals.js', 'waterfx.js', 'watering.js', 'wildlife-models.js', 'wildlife.js', 'wood.js', 'zipline-model.js', 'zipline.js' /* [zipline] */,
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
#updateStatus{position:fixed;left:22px;bottom:26px;transform:translateY(12px);z-index:2147483000;
max-width:min(92vw,420px);padding:9px 16px;border-radius:10px;background:#14213d;color:#fdf6e3;
border:1px solid rgba(253,246,227,.35);box-shadow:0 6px 20px rgba(0,0,0,.28);
font:500 13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.01em;text-align:left;
pointer-events:none;opacity:0;transition:opacity .25s ease,transform .25s ease}
#updateStatus.show{opacity:1;transform:none}
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
  // A running engine shows it in its bottom-left feed; this own-CSS pill (same corner) is the pre-boot fallback.
  if (routeStatus(window, text)) { document.getElementById('updateStatus')?.classList.remove('show'); return; }
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

// Each <link rel=modulepreload> URL must equal the URL the import resolves to ('./x.js?build=<build>').
function preloadGraph(build) {
  if (!build || typeof document === 'undefined') return;
  const head = document.head || document.documentElement;
  for (const name of PRELOAD) {
    const url = new URL('./' + name, BASE);
    url.searchParams.set('build', build);
    if (document.querySelector('link[rel="modulepreload"][href="' + url.href + '"]')) continue;
    const link = document.createElement('link');
    link.rel = 'modulepreload';
    link.href = url.href;
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
  // Start fetching game.js and its whole import graph (in parallel) while version.json is in flight.
  preloadGraph(BAKED_BUILD);
  const early = importGame(null, retry);
  early.catch(() => {}); // only awaited if the manifest agrees (or is unavailable)
  let manifest = null;
  try {
    manifest = await fetchManifest();
  } catch (e) {
    console.warn('[raftLive] version.json unavailable, booting unversioned game.js', e);
  }
  const build = manifest ? manifest.build : null;
  try {
    if (build && build !== BAKED_BUILD) preloadGraph(build);
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
    preloadGraph(manifest.build);
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
