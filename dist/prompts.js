// Little Raft interaction prompts: a key cap + action word centred under the crosshair (#lrPrompt)
// plus a right-side event/pickup feed (#lrFeed) that takes over game.js's centred #contextPrompt notices.
// API (window.raftPrompts): register({id, object?, test?, range, priority, prompt}) -> unregister,
//   provide({id, priority, prompt}) -> unregister, current(), refresh(), feed(text).
// prompt(ctx, hit) returns {key:'E', label:'Pick up', hold?, muted?} | up to 2 of them | null.
// ctx = {state, camera, T, scene}. Highest priority wins; raycast beats provider at equal priority; nearest hit next.

const SAMPLE_MS = 100, FEED_MAX = 4, FEED_MS = 4000, DUP_MS = 600;
const PICK_NAMES = {wood:'plank', leaf:'leaves', plastic:'plastic jug', scrap:'scrap', barrel:'barrel'};
const DECOR_NAMES = {sail:'sail', palm:'palm planter', lantern:'lantern', net:'net', bench:'bench', crate:'crate'};
const FLOOR_COST = {wood:2, plastic:2};

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
// "+2 Plank, +1 Leaves" -> [{n:'+2', text:'Plank', icon:'wood'}, ...]; anything else -> null (plain line).
const ICON_WORDS = [[/\b(plank|planks|wood)\b/, 'wood'], [/\b(leaf|leaves|palm leaf|thatch)\b/, 'leaf'], [/\bscrap\b/, 'scrap'], [/\bbarrel/, 'barrel'],
  [/\b(fish|\w+fish|mackerel|herring|tuna|salmon|pomfret)\b/, 'fish'], [/\b(bottle|jug)\b/, 'bottle'], [/\bhook\b/, 'hook'], [/\bhammer\b/, 'hammer'], [/\bcup\b/, 'cup']];
export function iconFor(text) { const t = String(text ?? '').toLowerCase(); for (const [re, id] of ICON_WORDS) if (re.test(t)) return id; return null; }
export function parseLoot(text) {
  const parts = formatFeed(text).split(/\s*,\s*/), out = [];
  for (const part of parts) { const m = /^\+(\d{1,4})\s*[×x]?\s+(.+)$/.exec(part); if (!m) return null; out.push({n:'+' + m[1], text:m[2], icon:iconFor(m[2])}); }
  return out.length ? out : null;
}
export function shouldPost(last, text, now) { return !(last && last.text === text && now - last.at < DUP_MS); }
const missing = (stock, cost) => Object.entries(cost).filter(([k, n]) => (stock?.[k] ?? 0) < n).map(([k, n]) => `${n - (stock?.[k] ?? 0)} ${k}`);
// Built-in, state-derived prompts (replicates + extends game.js updateContext).
export function statePrompt(s) {
  if (!s || !s.running) return null;
  if (s.role === 'guest' && !s.networkReady) return {label:'Waiting for your brother’s raft…', muted:true};
  if (s.pickup) return {key:'E', label:'Pick up ' + (PICK_NAMES[s.pickup.type] ?? 'supply')};
  const held = s.heldKind, stage = s.hookStage, pitch = s.me?.pitch ?? 0;
  if (held === 'hook') {
    if (stage === 'flying' || stage === 'floating' || stage === 'reeling') return {key:'LMB', hold:true, label:s.hookCaughtItems?.length ? 'Reel in catch' : 'Reel in'};
    if (stage === 'idle' && pitch > -0.5) return {key:'LMB', hold:true, label:'Throw'};
    return null;
  }
  if (held === 'hammer' && s.build?.hover) {
    if (s.build.affordable) return {key:'LMB', label:'Build floor'};
    const m = missing(s.stock, FLOOR_COST); return {label:'Needs ' + (m.length ? m : ['2 wood', '2 plastic']).join(' · '), muted:true};
  }
  if (held === 'fishingrod') return stage === 'idle' && !s.fishWait ? {key:'LMB', label:'Cast line'} : null; // no reel action while fishing
  if (DECOR_NAMES[held] && s.tool === 'place' && s.build?.hover) return {key:'LMB', label:'Place ' + DECOR_NAMES[held]};
  return null;
}

// ---------- DOM layer ----------
const ICON_URL = (() => { try { return new URL('icons.svg', import.meta.url).href; } catch { return 'icons.svg'; } })();
const MOUSE = side => `<svg class="lr-mouse" viewBox="0 0 12 16" width="11" height="15" aria-hidden="true"><rect x=".75" y=".75" width="10.5" height="14.5" rx="5.25" fill="none" stroke="currentColor" stroke-width="1.5"/>${side === 'L' ? '<path d="M6 1.5A4.5 4.5 0 0 0 1.5 6v1H6z"/>' : '<path d="M6 1.5A4.5 4.5 0 0 1 10.5 6v1H6z"/>'}<path d="M6 1v6" stroke="currentColor" stroke-width="1"/></svg>`;

function createPrompts(win, doc) {
  const rays = new Map(), providers = new Map(); let order = 0, shown = null, sig = null, visible = false, lastFeed = null;
  let promptEl = null, feedEl = null, ctxEl = null, observer = null, ray = null, rayT = null, aimAt = null, placed = '';
  let mouse = null; win.addEventListener('pointermove', e => { mouse = {x:e.clientX, y:e.clientY}; }, {passive:true, capture:true});
  win.addEventListener('pointerout', e => { if (!e.relatedTarget) mouse = null; }, {passive:true, capture:true});
  const safe = (f, fb = null) => { try { return f(); } catch { return fb; } };
  const mount = () => safe(() => win.raftMount) || null;
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
      const loot = parseLoot(t), check = /^✓\s*/.test(t);
      for (const item of loot || [{text:check ? t.replace(/^✓\s*/, '') : t}]) {
        const line = doc.createElement('div'); line.className = 'lr-line' + (loot ? ' lr-loot' : check ? ' lr-done' : '');
        if (item.icon) line.insertAdjacentHTML('beforeend', `<svg class="lr-ficon" viewBox="0 0 48 48" aria-hidden="true"><use href="${ICON_URL}#icon-${item.icon}"></use></svg>`); // static ids only
        if (item.n || check) { const b = doc.createElement('b'); b.className = 'lr-n'; b.textContent = item.n || '✓'; line.appendChild(b); }
        const l = doc.createElement('span'); l.className = 'lr-ftext'; l.textContent = item.text; line.appendChild(l); // untrusted: textContent only
        feedEl.appendChild(line); while (feedEl.children.length > FEED_MAX) feedEl.firstElementChild.remove();
        win.setTimeout(() => line.classList.add('lr-out'), FEED_MS); win.setTimeout(() => line.remove(), FEED_MS + 450);
      }
      return true;
    }, false);
  }
  function render(list) {
    promptEl.textContent = '';
    for (const p of list) {
      const row = doc.createElement('div'); row.className = 'lr-row' + (p.muted ? ' lr-muted' : '');
      if (/^[LR]MB$/i.test(p.key)) { const k = doc.createElement('kbd'); k.className = 'lr-key lr-glyph'; k.innerHTML = MOUSE(p.key[0].toUpperCase()); row.appendChild(k); } // static SVG only
      else if (p.key) { const k = doc.createElement('kbd'); k.className = 'lr-key' + (p.key.length > 1 ? ' lr-wide' : ''); k.textContent = p.key; row.appendChild(k); }
      const l = doc.createElement('span'); l.className = 'lr-label';
      if (p.hold) { const h = doc.createElement('span'); h.className = 'lr-hold'; h.textContent = 'Hold to '; l.appendChild(h); }
      l.appendChild(doc.createTextNode(p.label)); row.appendChild(l);
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
      const m = mount(), debug = safe(() => win.raftDebug) || m?.debug, state = safe(() => debug?.state);
      const ctx = {state, camera:m?.camera ?? null, T:m?.T ?? null, scene:m?.scene ?? null};
      const blocked = !!doc.querySelector('dialog[open]') || !!state?.inventoryOpen;
      // Unlocked (resume hint up) shows nothing; drag-to-look fallback aims at the cursor, so the prompt follows it.
      const fallback = !!state?.lockFallback && !state?.pointerLocked; aimAt = fallback ? mouse : null;
      const show = !!state?.running && !state.disposed && (state.pointerLocked || (fallback && !!mouse)) && doc.body.classList.contains('playing') && !blocked;
      const pos = aimAt ? `left:${Math.round(aimAt.x)}px;top:${Math.round(aimAt.y + 20)}px` : '';
      if (pos !== placed) { placed = pos; promptEl.style.cssText = pos; }
      let list = null;
      if (show) {
        const cands = rayHits(ctx);
        for (const p of providers.values()) safe(() => cands.push({prompts:p.prompt(ctx), priority:p.priority, ray:false, order:p.order}));
        cands.push({prompts:statePrompt(state), priority:0, ray:false}); // built-ins lose ties to registered providers
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
