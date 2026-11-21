// Co-op HUD feed: a small bottom-left stack of friendly one-line notices (join/leave/ping/emote/warn).
// Sits above the hotbar's height on the left so it never overlaps the bottom-centre hotbar.
const KINDS = {info:'#8fd3e8', join:'#7ee08a', leave:'#f0a868', ping:'#ffd75e', emote:'#e79ef0', warn:'#ff7a6b'};
const MAX = 5, LIFE = 6000, FADE = 600;

const CSS = `
#coopFeed{position:fixed;left:20px;bottom:132px;z-index:3;display:flex;flex-direction:column;align-items:flex-start;gap:5px;
  max-width:min(320px,calc(50vw - 40px));pointer-events:none;font:600 13px/1.3 system-ui,-apple-system,'Segoe UI',sans-serif}
#coopFeed .cf-line{display:flex;align-items:center;gap:8px;max-width:100%;padding:6px 12px 6px 10px;border-radius:999px;
  background:#081624e0;color:#f6ecd6;box-shadow:0 2px 10px #0006;
  opacity:0;transform:translateY(6px);transition:opacity .25s,transform .25s}
#coopFeed .cf-line.cf-in{opacity:1;transform:none}
#coopFeed .cf-line.cf-out{opacity:0;transition:opacity ${FADE}ms}
#coopFeed .cf-dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;box-shadow:0 0 6px currentColor}
#coopFeed .cf-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 1px #0008}
@media(max-width:760px){#coopFeed{left:12px;bottom:184px;font-size:12px;max-width:calc(100vw - 180px)}}
@media(prefers-reduced-motion:reduce){#coopFeed .cf-line{transition:none}}`;

export function createFeed({doc = document} = {}) {
  let style = doc.getElementById('coopFeedStyle');
  if (!style) { style = doc.createElement('style'); style.id = 'coopFeedStyle'; style.textContent = CSS; doc.head.appendChild(style); }
  let box = doc.getElementById('coopFeed');
  if (!box) { box = doc.createElement('div'); box.id = 'coopFeed'; box.setAttribute('aria-live', 'polite'); doc.body.appendChild(box); }
  const timers = new Set();
  const win = doc.defaultView ?? globalThis;
  const later = (fn, ms) => { const t = win.setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  let disposed = false;

  // The pickup feed (style.css #pickupFeed) stacks above this one: publish our height as --coop-feed-h.
  const root = doc.documentElement;
  function sync() {
    const h = !disposed && box.childElementCount ? Math.ceil(box.offsetHeight || 0) + 6 : 0;
    try { if (h) root.style.setProperty('--coop-feed-h', h + 'px'); else root.style.removeProperty('--coop-feed-h'); } catch {}
  }
  function remove(line) { if (line.isConnected) line.remove(); sync(); }
  function fadeOut(line) {
    if (!line.isConnected || line.classList.contains('cf-out')) return;
    line.classList.add('cf-out'); later(() => remove(line), FADE);
  }

  function push(text, kind = 'info') {
    if (disposed) return;
    const line = doc.createElement('div'); line.className = 'cf-line cf-' + (KINDS[kind] ? kind : 'info');
    const dot = doc.createElement('i'); dot.className = 'cf-dot';
    dot.style.background = dot.style.color = KINDS[kind] ?? KINDS.info;
    const span = doc.createElement('span'); span.className = 'cf-text'; span.textContent = String(text ?? '');
    line.append(dot, span); box.appendChild(line);
    const live = [...box.children].filter(l => !l.classList.contains('cf-out'));
    for (let i = 0; i < live.length - MAX; i++) remove(live[i]);
    sync();
    win.requestAnimationFrame?.(() => line.classList.add('cf-in')) ?? line.classList.add('cf-in');
    later(() => fadeOut(line), LIFE);
  }

  function dispose() {
    disposed = true;
    for (const t of timers) win.clearTimeout(t); timers.clear();
    box.remove(); style.remove(); sync();
  }
  return {push, dispose};
}
