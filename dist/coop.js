// Little Raft co-op facade. game.js calls createCoop() synchronously at mount; the real hub (coop-hub.js and
// its coop-* modules, ~65 KB) is fetched with a dynamic import() so it stays off the startup path.
//
//   createCoop(ctx, saved?) -> same API as coop-hub.js: { encode, decode, update, feed, meta, isRejoin, lost, retry,
//                              rejoined, capture, dispose } (+ ready() -> Promise<hub|null>)
//
// The hub loads at once when there is a live session to keep (hot swap mid-co-op), as soon as game.js has a
// role or connection, and otherwise when the browser is idle after mount. Until it is ready every call answers
// like the hub does before any hello was exchanged: messages pass through, nothing is a rejoin or to retry.
// Peers only send delta ('Δ') traffic after our hello and repeat their own hello every second, so dropping
// 'coop'/'Δ' messages that arrive before the hub is ready loses nothing.
import './coop-loopback.js?build=v3-survival-ae77fa84ac2b'; // installs the ?loopback fake Peer before the first Host/Join click

export const COOP_VERSION = 1;
const IDLE_TIMEOUT_MS = 3000;
const coopId = () => (globalThis.__littleRaftCoopId ??= Math.random().toString(36).slice(2, 10)); // same per-tab id as the hub

export function createCoop(ctx, saved = null) {
  let hub = null, loading = null, disposed = false, idle = null;
  const cancelIdle = () => { try { idle?.(); } catch {} idle = null; };
  function load() {
    if (loading || disposed) return loading ?? Promise.resolve(null);
    cancelIdle();
    loading = import('./coop-hub.js?build=v3-survival-ae77fa84ac2b').then(m => {
      if (disposed) return null;
      hub = m.createCoop(ctx, saved);
      return hub;
    }).catch(e => { console.warn('co-op layer unavailable', e); return null; });
    return loading;
  }
  const active = () => { try { return !!(saved?.aboard || saved?.rejoin) || ctx.role() !== 'solo' || !!ctx.conn(); } catch { return true; } };
  if (active()) load();
  else if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(() => { idle = null; load(); }, {timeout:IDLE_TIMEOUT_MS}); idle = () => cancelIdleCallback(id); }
  else { const id = setTimeout(() => { idle = null; load(); }, 1000); idle = () => clearTimeout(id); }

  return {
    encode: m => hub ? hub.encode(m) : m,
    decode: m => hub ? hub.decode(m) : (m && typeof m === 'object' && (m.type === 'coop' || m.type === 'Δ') ? null : m),
    update(dt, time) { if (hub) hub.update(dt, time); else if (!loading && active()) load(); },
    feed: text => hub ? hub.feed(text) : false,
    lost: () => hub ? hub.lost() : false,
    retry: () => hub ? hub.retry() : false,
    rejoined: () => hub ? hub.rejoined() : false,
    meta: () => hub ? hub.meta() : {coopId:coopId()},
    isRejoin: c => hub ? hub.isRejoin(c) : false,
    capture: () => hub ? hub.capture() : saved, // a not-yet-applied rejoin state survives another hot swap
    ready: () => load(),
    dispose() { disposed = true; cancelIdle(); try { hub?.dispose(); } catch {} hub = null; },
  };
}
