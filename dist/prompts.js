// Little Raft interaction prompts: a small key prompt just bottom-right of the crosshair (#lrPrompt)
// plus a bottom-left event feed (#lrFeed) that takes over game.js's centred #contextPrompt notices.
// API (window.raftPrompts): register({id, object?, test?, range, priority, prompt}) -> unregister,
//   provide({id, priority, prompt}) -> unregister, current(), refresh(), feed(text).
// prompt(ctx, hit) returns {key:'E', label:'Pick up', hold?, muted?} | up to 2 of them | null.
// ctx = {state (full raftDebug.state, built lazily on first read), camera, T, scene}. Highest priority wins; raycast beats provider at equal priority; nearest hit next.

const SAMPLE_MS = 100, FEED_MAX = 4, FEED_MS = 4000, DUP_MS = 600;
const PICK_NAMES = {wood:'plank', leaf:'leaves', plastic:'plastic jug', scrap:'scrap', barrel:'barrel'};
const DECOR_NAMES = {sail:'sail', palm:'palm planter', lantern:'lantern', net:'net', bench:'bench', crate:'crate'};
const FLOOR_COST = {wood:2, plastic:2};
const SLOT_X = 34, SLOT_Y = 26; // prompt offset from the aim point (keep in sync with #lrPrompt in prompts.css)
const STORE_KEY = 'little-raft-prompts-v1';
export const THROW_TEACH = 5; // tool prompts teach, then get out of the way (Raft-style)
const CLIMB_REACH = 1.25; // player-physics: tile-edge distance - BODY_RADIUS(.25) <= CLAMBER_REACH(.8); a little slack while swimming in
const TILE = 2, HALF = TILE / 2;

// ---------- pure helpers (tested in node) ----------
export function normalizePrompt(p) {
  const list = (Array.isArray(p) ? p : p ? [p] : []).filter(x => x && typeof x.label === 'string' && x.label.trim());
  const out = list.slice(0, 2).map(x => {
    let key = x.key == null ? '' : String(x.key).trim(), hold = !!x.hold;
    if (/^hold\s+/i.test(key)) { hold = true; key = key.replace(/^hold\s+/i, ''); }
    return {key:key.slice(0, 12), label:x.label.trim().slice(0, 48), hold, muted:!!x.muted};
  });
  return out.length ? out : null;
}
// candidates: [{prompts, priority, ray:bool, distance?, order?}] -> winning prompt list or null
export function pickPrompt(candidates) {
  let best = null;
  for (const c of candidates || []) {
    const prompts = normalizePrompt(c?.prompts); if (!prompts) continue;
    const pr = Number(c.priority) || 0, d = Number.isFinite(c.distance) ? c.distance : Infinity;
    if (!best || pr > best.pr || (pr === best.pr && (c.ray && !best.ray || (!!c.ray === best.ray && d < best.d)))) best = {pr, ray:!!c.ray, d, prompts};
  }
  return best ? best.prompts : null;
}
export const signature = list => (list ? list.map(p => `${p.hold ? 'H' : ''}${p.key}|${p.label}|${p.muted ? 1 : 0}`).join('~') : '');
export function formatFeed(text) { return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 90); }
// Is a #contextPrompt text a notice worth feeding (vs a persistent prompt we already render)?
export function isNotice(text, hasKbd) {
  const t = formatFeed(text);
  // "Floor needs" doubles as game.js's hover prompt; the muted "Needs …" prompt already covers it.
  return !!t && !hasKbd && !/^(Hold click to reel|Waiting for your brother|Floor needs)/i.test(t);
}
// Converts a game.js/content-module prompt string ('<kbd>E</kbd>Label', escaped HTML) into prompt rows:
// a leading <kbd> becomes the key ('Click' -> the LMB glyph); text without a key becomes a muted status line.
const ENT = {amp:'&', lt:'<', gt:'>', quot:'"', '#39':"'", apos:"'", nbsp:' '};
const unescapeHtml = s => s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENT[e]);
export function promptFromHtml(html) {
  const src = String(html ?? ''); if (!src.trim()) return null;
  const m = /^\s*<kbd>([^<]*)<\/kbd>/i.exec(src);
  const label = unescapeHtml((m ? src.slice(m[0].length) : src).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  if (!label) return null;
  if (!m) return {label, muted:true};
  let key = unescapeHtml(m[1]).trim(); if (/^(left\s*)?click$/i.test(key)) key = 'LMB'; else if (/^right\s*click$/i.test(key)) key = 'RMB';
  return key ? {key, label} : {label, muted:true};
}
export function shouldPost(last, text, now) { return !(last && last.text === text && now - last.at < DUP_MS); }
const have = (stock, k) => { const n = Number(stock?.[k]); return Number.isFinite(n) && n > 0 ? n : 0; };
export const costText = cost => Object.entries(cost).map(([k, n]) => `${n} ${k}`).join(' · ');
export const missingText = (stock, cost) => Object.entries(cost).filter(([k, n]) => have(stock, k) < n).map(([k, n]) => `${n - have(stock, k)} ${k}`).join(' · ');
// Horizontal distance (m) from (x, z) to the nearest raft tile's edge; 0 when over a tile, Infinity with no tiles.
export function raftDistance(x, z, tiles) {
  let best = Infinity; if (!Number.isFinite(x) || !Number.isFinite(z)) return best;
  for (const t of Array.isArray(tiles) ? tiles : []) {
    if (!Array.isArray(t) || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) continue;
    const dx = Math.max(0, Math.abs(x - t[0] * TILE) - HALF), dz = Math.max(0, Math.abs(z - t[1] * TILE) - HALF);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}
// Counts hook throws: a hook leaving 'idle' for 'flying' (not a rod cast, which shows as 'fishing').
export const isThrow = (prev, stage) => stage === 'flying' && prev !== 'flying';
// Built-in, state-derived prompts (replicates + extends game.js updateContext). opt.throws hides the hook's Throw tip once learned.
export function statePrompt(s, opt = {}) {
  if (!s || !s.running) return null;
  if (s.role === 'guest' && !s.networkReady) return {label:'Waiting for your brother’s raft…', muted:true};
  if (s.pickup) return {key:'E', label:'Pick up ' + (PICK_NAMES[s.pickup.type] ?? 'supply')};
  if (s.swimming && !s.physics?.climbing) { // physics: hold jump near a tile edge to clamber
    const d = raftDistance(s.me?.x, s.me?.z, s.tileList);
    if (d <= CLIMB_REACH) return {key:'Space', hold:true, label:'Climb aboard'};
    if (Number.isFinite(d)) return {label:'Swim to the raft edge', muted:true};
  }
  const held = s.heldKind, stage = s.hookStage, pitch = s.me?.pitch ?? 0;
  if (held === 'hook') {
    if (stage === 'flying' || stage === 'floating' || stage === 'reeling') return {key:'LMB', hold:true, label:s.hookCaughtItems?.length ? 'Reel in catch' : 'Reel in'};
    if (stage === 'idle' && pitch > -0.5 && !((opt.throws ?? 0) >= THROW_TEACH)) return {key:'LMB', hold:true, label:'Throw'};
    return null;
  }
  if (held === 'hammer') {
    if (!s.build?.hover) return {label:'Aim at the raft edge', muted:true};
    if (s.build.affordable) return [{key:'LMB', label:'Build floor'}, {label:costText(FLOOR_COST), muted:true}];
    const m = missingText(s.stock, FLOOR_COST);
    return [{label:'Needs ' + costText(FLOOR_COST), muted:true}, ...(m && m !== costText(FLOOR_COST) ? [{label:'Missing ' + m, muted:true}] : [])];
  }
  if (held === 'fishingrod') {
    if (stage === 'fishing' || s.fishWait) return {label:'Waiting for a bite…', muted:true}; // bites land automatically (game.js fishWait)
    return stage === 'idle' ? {key:'LMB', label:'Cast line'} : null;
  }
  if (held && s.tool === 'place') return placePrompt(s);
  return null;
}
// Place mode: the placement row always shows; an aim prompt (game.js aimHtml, e.g. storage's "E Open crate") stacks under it,
// because game.js mutes its own game-aim providers while a placeable is held.
export function placePrompt(s) {
  const name = DECOR_NAMES[s.heldKind] ?? String(s.heldKind).replace(/[-_]+/g, ' ');
  const place = s.build?.hover && s.build.hover.blocked !== 'nofloor' ? {key:'LMB', label:'Place ' + name} : {label:'Aim at the raft floor', muted:true}; // nofloor: red ghost just off the deck
  const aim = s.aimPrompt ? promptFromHtml(s.aimPrompt) : null;
  return aim ? [place, aim] : place;
}

// ---------- DOM layer ----------
const MOUSE = side => `<svg class="lr-mouse" viewBox="0 0 12 16" width="11" height="15" aria-hidden="true"><rect x=".75" y=".75" width="10.5" height="14.5" rx="5.25" fill="none" stroke="currentColor" stroke-width="1.5"/>${side === 'L' ? '<path d="M6 1.5A4.5 4.5 0 0 0 1.5 6v1H6z"/>' : '<path d="M6 1.5A4.5 4.5 0 0 1 10.5 6v1H6z"/>'}<path d="M6 1v6" stroke="currentColor" stroke-width="1"/></svg>`;

function createPrompts(win, doc) {
  const rays = new Map(), providers = new Map(); let order = 0, shown = null, sig = null, visible = false, lastFeed = null;
  let promptEl = null, feedEl = null, ctxEl = null, observer = null, ray = null, rayT = null, aimAt = null, placed = '';
  let throws = 0, lastStage; // undefined until the first sample, so a restored in-flight hook is not counted
  let mouse = null; win.addEventListener('pointermove', e => { mouse = {x:e.clientX, y:e.clientY}; }, {passive:true, capture:true});
  win.addEventListener('pointerout', e => { if (!e.relatedTarget) mouse = null; }, {passive:true, capture:true});
  const safe = (f, fb = null) => { try { return f(); } catch { return fb; } };
  const mount = () => safe(() => win.raftMount) || null;
  safe(() => { const n = JSON.parse(win.localStorage.getItem(STORE_KEY) || '{}')?.throws; if (Number.isFinite(n) && n > 0) throws = Math.floor(n); });
  function ensureEls() {
    if (!promptEl || !promptEl.isConnected) {
      promptEl = doc.getElementById('lrPrompt') || doc.createElement('div');
      promptEl.id = 'lrPrompt'; promptEl.setAttribute('aria-hidden', 'true'); if (!promptEl.isConnected) doc.body.appendChild(promptEl);
    }
    if (!feedEl || !feedEl.isConnected) {
      feedEl = doc.getElementById('lrFeed') || doc.createElement('div');
      feedEl.id = 'lrFeed'; feedEl.setAttribute('role', 'status'); feedEl.setAttribute('aria-live', 'polite'); if (!feedEl.isConnected) doc.body.appendChild(feedEl);
    }
    const c = doc.getElementById('contextPrompt');
    if (c && c !== ctxEl) { // game.js (re)created it: re-attach
      safe(() => observer?.disconnect()); ctxEl = c; let lastText = '';
      observer = new win.MutationObserver(() => safe(() => {
        const t = formatFeed(ctxEl.textContent);
        if (t !== lastText) { lastText = t; if (!ctxEl.hidden && isNotice(t, !!ctxEl.querySelector('kbd'))) feed(t); }
      }));
      observer.observe(ctxEl, {childList:true, characterData:true, subtree:true, attributes:true, attributeFilter:['hidden']});
    }
  }
  function feed(text) {
    return safe(() => {
      const t = formatFeed(text), now = Date.now(); if (!t || !shouldPost(lastFeed, t, now)) return false;
      lastFeed = {text:t, at:now}; ensureEls();
      const line = doc.createElement('div'); line.className = 'lr-line'; line.textContent = t; // untrusted: textContent only
      feedEl.appendChild(line); while (feedEl.children.length > FEED_MAX) feedEl.firstElementChild.remove();
      win.setTimeout(() => line.classList.add('lr-out'), FEED_MS); win.setTimeout(() => line.remove(), FEED_MS + 450);
      return true;
    }, false);
  }
  function render(list) {
    promptEl.textContent = '';
    for (const p of list) {
      const row = doc.createElement('div'); row.className = 'lr-row' + (p.muted ? ' lr-muted' : '');
      if (p.hold) { const h = doc.createElement('span'); h.className = 'lr-hold'; h.textContent = 'Hold'; row.appendChild(h); }
      if (/^[LR]MB$/i.test(p.key)) { const m = doc.createElement('span'); m.className = 'lr-glyph'; m.innerHTML = MOUSE(p.key[0].toUpperCase()); row.appendChild(m); } // static SVG only
      else if (p.key) { const k = doc.createElement('kbd'); k.className = 'lr-key'; k.textContent = p.key; row.appendChild(k); }
      const l = doc.createElement('span'); l.className = 'lr-label'; l.textContent = p.label; row.appendChild(l);
      promptEl.appendChild(row);
    }
  }
  function rayHits(ctx) {
    const out = [], {T, camera} = ctx; if (!rays.size || !T || !camera) return out;
    if (rayT !== T) { ray = new T.Raycaster(); rayT = T; }
    ray.setFromCamera(new T.Vector2(aimAt ? aimAt.x / win.innerWidth * 2 - 1 : 0, aimAt ? 1 - aimAt.y / win.innerHeight * 2 : 0), camera);
    for (const r of rays.values()) safe(() => {
      let d = null;
      if (r.test) d = r.test(ray.ray, ctx);
      else if (r.object) {
        let o = r.object; while (o.parent) o = o.parent; if (ctx.scene && o !== ctx.scene) return; // stale: left behind by a live reload
        const h = ray.intersectObject(r.object, true)[0]; d = h ? h.distance : null; }
      if (!Number.isFinite(d) || d > r.range) return;
      out.push({prompts:r.prompt(ctx, {distance:d}), priority:r.priority, ray:true, distance:d, order:r.order});
    });
    return out;
  }
  function tick() {
    safe(() => {
      if (!doc.body) return; ensureEls();
      const m = mount(), debug = safe(() => win.raftDebug) || m?.debug;
      // debug.hud is a cheap live view with the keys statePrompt reads; the full .state snapshot (deep copies, grows
      // with the raft) is built only if a registered prompt reads ctx.state, or when an older game.js has no .hud.
      const hud = safe(() => debug?.hud) || null;
      let full = hud ? undefined : safe(() => debug?.state);
      const state = hud || full;
      const ctx = {get state() { if (full === undefined) full = safe(() => debug?.state); return full; }, camera:m?.camera ?? null, T:m?.T ?? null, scene:m?.scene ?? null};
      const stage = state?.hookStage ?? null;
      if (state?.running && lastStage !== undefined && isThrow(lastStage, stage) && throws < 1e6) { throws++; safe(() => win.localStorage.setItem(STORE_KEY, JSON.stringify({throws}))); }
      lastStage = stage;
      const blocked = !!doc.querySelector('dialog[open]') || !!state?.inventoryOpen;
      // Unlocked (resume hint up) shows nothing; drag-to-look fallback aims at the cursor, so the prompt follows it.
      const fallback = !!state?.lockFallback && !state?.pointerLocked; aimAt = fallback ? mouse : null;
      const show = !!state?.running && !state.disposed && (state.pointerLocked || (fallback && !!mouse)) && doc.body.classList.contains('playing') && !blocked;
      const pos = aimAt ? `left:${Math.round(aimAt.x + SLOT_X)}px;top:${Math.round(aimAt.y + SLOT_Y)}px` : '';
      if (pos !== placed) { placed = pos; promptEl.style.cssText = pos; }
      let list = null;
      if (show) {
        const cands = rayHits(ctx);
        for (const p of providers.values()) safe(() => cands.push({prompts:p.prompt(ctx), priority:p.priority, ray:false, order:p.order}));
        cands.push({prompts:statePrompt(state, {throws}), priority:0, ray:false}); // built-ins lose ties to registered providers
        list = pickPrompt(cands);
      }
      shown = list; const s = signature(list);
      if (s !== sig) { sig = s; if (list) render(list); }
      const vis = !!list; if (vis !== visible) { visible = vis; promptEl.classList.toggle('lr-on', vis); }
    });
  }
  const add = (map, o, extra) => {
    if (!o || typeof o.prompt !== 'function') throw new TypeError('raftPrompts: prompt(ctx) function required');
    const id = String(o.id ?? 'p' + order), rec = {priority:Number(o.priority) || 0, prompt:o.prompt, order:order++, ...extra(o)};
    map.set(id, rec); return () => { if (map.get(id) === rec) map.delete(id); };
  };
  const api = Object.freeze({
    register: o => add(rays, o, x => ({object:x.object ?? null, test:typeof x.test === 'function' ? x.test : null, range:Number.isFinite(x.range) ? x.range : 3})),
    provide: o => add(providers, o, () => ({})),
    current: () => (shown ? shown.map(p => ({...p})) : null),
    refresh: tick,
    feed,
  });
  win.setInterval(tick, SAMPLE_MS);
  return api;
}

let api = null;
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    if (window.raftPrompts) api = window.raftPrompts; // live reload: keep the first instance
    else { api = createPrompts(window, document); Object.defineProperty(window, 'raftPrompts', {value:api, configurable:true}); }
  } catch (e) { try { console.warn('[prompts] disabled:', e); } catch {} }
}
export const raftPrompts = api;
export default api;
