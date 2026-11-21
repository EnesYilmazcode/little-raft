// Little Raft co-op hub. Wires the coop-* modules into game.js through a few `// coop:` hooks.
//
//   createCoop(ctx, saved?) -> { encode, decode, update, feed, meta, isRejoin, lost, retry, rejoined, capture, dispose }
//
// ctx (getters into game.js, see coopContext() there):
//   T, scene, camera, canvas, ocean, friend, role(), conn(), ready(), blocked(), local(), aim(), deckY(),
//   reconnect() (new Peer + connect to the same room, keep world/bag on screen), giveUp() (old behaviour: back to own raft)
//
// Wire protocol (only once the other side said `hello`; older clients keep the legacy messages untouched):
//   {type:'coop', k:'hello', v, id, name}      capability + identity (id lets the host accept a rejoin)
//   {type:'coop', k:'ping', p:[x,y,z]}         'look here' marker (middle click)
//   {type:'coop', k:'emote', e:'wave'|'point'}
//   {type:'coop', k:'kf', kk}                  decoder lost its baseline: please send a keyframe of type kk
//   {type:'Δ', ...}                            delta-encoded 'cp' pose snapshots (15 Hz moving / 4 Hz idle) and
//                                              host 'state' (items throttled to 2 Hz unless the set changes)
// The legacy guest 'move' message is replaced by 'cp' (decoded back into a 'move' for game.js on the host).
import './coop-loopback.js';
import { SnapshotBuffer } from './coop-interp.js';
import { DeltaEncoder, DeltaDecoder, quantize } from './coop-delta.js';
import { createRemoteAvatar } from './coop-avatar.js';
import { createPings, createRemoteRope, createRemoteGhost } from './coop-fx.js';
import { createFeed } from './coop-feed.js';

export const COOP_VERSION = 1;
const HELD = [null, 'hook', 'hammer', 'fishingrod', 'wood', 'leaf', 'scrap', 'plastic', 'sail', 'palm', 'lantern', 'net', 'bench', 'crate'];
const STAGES = ['flying', 'floating', 'reeling', 'done', 'fishing'];
const SEND_MS = 1000 / 15, IDLE_MS = 250, ITEMS_MS = 500;
const SILENCE_MS = 3000, RECONNECT_WINDOW_MS = 30000, ATTEMPT_MS = 12000; // an attempt in flight gets 12 s (ICE can be slow)
const EMOTE_KEYS = {KeyZ:'wave', KeyX:'point'}, EMOTE_S = 1.6, PING_RANGE = 60;
const FEED_RE = /joined|left|disconnected|reconnect|aboard/i;
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const coopId = (globalThis.__littleRaftCoopId ??= Math.random().toString(36).slice(2, 10)); // per tab, survives hot swaps
const readName = () => { try { return (localStorage.getItem('little-raft-name') || '').trim().slice(0, 16) || 'Brother'; } catch { return 'Brother'; } };

export function createCoop(ctx, saved = null) {
  const {T} = ctx;
  const now = () => performance.now();
  const feed = createFeed();
  const pings = createPings(T, ctx.scene);
  const rope = createRemoteRope(T, ctx.scene);
  const ghost = createRemoteGhost(T, ctx.scene);
  const avatar = createRemoteAvatar(T, {color:'#70a7e4', name:'Brother'});
  avatar.group.visible = false; ctx.scene.add(avatar.group);
  const buffer = new SnapshotBuffer();
  const enc = new DeltaEncoder(), dec = new DeltaDecoder();
  const hand = new T.Vector3(), sample = {}, kfAsked = new Set();
  const ac = new AbortController();
  let conn = null, peer = null;            // peer = their hello, once received on this connection
  let helloAt = -1e9, settled = false, lastSend = 0, lastSent = null, lastRecv = now(), lastItems = null, lastItemsAt = 0, itemKey = '';
  let lastHook = null, throwAt = -1, emote = null, lastPose = null, errors = 0, aboard = !!saved?.aboard; // aboard: guest had a live session
  let rejoin = saved?.rejoin ?? null;      // {since, attempt, next} while a guest is reconnecting
  let peerName = saved?.peerName ?? 'Brother'; avatar.setName(peerName);
  const stats = {sent:0, recv:0, bytesOut:0, bytesIn:0, since:now()};

  const sendRaw = m => { const c = ctx.conn(); if (!c?.open) return; try { c.send(m); stats.sent++; stats.bytesOut += JSON.stringify(m).length; } catch {} };
  const event = (k, extra) => sendRaw({type:'coop', k, ...extra});

  // A new DataConnection means a fresh session: drop baselines and announce ourselves.
  function track() {
    const c = ctx.conn();
    if (c === conn) return;
    if (!rejoin) aboard = false; // a brand-new join is not a rejoin
    conn = c; peer = null; helloAt = -1e9; kfAsked.clear(); enc.reset(); dec.reset(); buffer.reset(); lastSent = null; lastItems = null; itemKey = ''; lastRecv = now();
  }

  // ---------- outgoing (game.js send() hook) ----------
  function encode(m) {
    track();
    if (!peer || !m || typeof m !== 'object') return m;
    if (m.type === 'move') return null; // replaced by 'cp'
    if (m.type === 'state' && m.world) {
      const items = m.world.items, key = Array.isArray(items) ? items.map(i => i.token).join() : '';
      if (key === itemKey && now() - lastItemsAt < ITEMS_MS && lastItems) m = {...m, world:{...m.world, items:lastItems}};
      else { itemKey = key; lastItemsAt = now(); lastItems = quantize(items, 2); m = {...m, world:{...m.world, items:lastItems}}; }
      const {other, ...rest} = m; // the guest rebuilds `other` from our cp stream
      return enc.encode(quantize(rest, 3), {owned:true}); // quantize() already made a private copy
    }
    return m;
  }

  // ---------- incoming (game.js data hook) ----------
  function decode(m) {
    track();
    if (!m || typeof m !== 'object') return m;
    lastRecv = now(); stats.recv++; stats.bytesIn += JSON.stringify(m).length;
    if (m.type === 'coop') { onEvent(m); return null; }
    if (m.type !== 'Δ') return m;
    const full = dec.decode(m);
    if (!full) { if (!kfAsked.has(m.k)) { kfAsked.add(m.k); event('kf', {kk:m.k}); } return null; } // one request per gap
    kfAsked.delete(m.k);
    if (full.type === 'cp') return onPose(full);
    if (full.type === 'state') full.other = lastPose ? {...lastPose} : null;
    return full;
  }
  function onEvent(m) {
    if (m.k === 'hello') {
      peer = {v:m.v, id:String(m.id ?? '')};
      peerName = String(m.name ?? 'Brother').slice(0, 16) || 'Brother'; avatar.setName(peerName);
      if (!m.re) event('hello', {v:COOP_VERSION, id:coopId, name:readName(), re:1}); // answer every non-reply (a hot-swapped hub starts over)
    } else if (m.k === 'kf') enc.forceKeyframe(m.kk);
    else if (m.k === 'ping' && Array.isArray(m.p) && m.p.every(Number.isFinite)) {
      pings.add({x:m.p[0], y:m.p[1], z:m.p[2], mine:false, label:peerName});
      feed.push(peerName + ' says: look here!', 'ping');
    } else if (m.k === 'emote' && (m.e === 'wave' || m.e === 'point')) { emote = {kind:m.e, at:now()}; feed.push(peerName + (m.e === 'wave' ? ' waves!' : ' points.'), 'emote'); }
  }
  function onPose(cp) {
    const p = Array.isArray(cp.p) ? cp.p : null;
    if (!p || p.length < 5 || !p.every(Number.isFinite) || !Number.isFinite(cp.t)) return null;
    const k = Array.isArray(cp.k) ? cp.k : null, g = Array.isArray(cp.g) ? cp.g : null, f = cp.f | 0;
    buffer.push({t:cp.t, x:p[0], y:p[1], z:p[2], yaw:p[3], pitch:p[4],
      swimming:!!(f & 1), grounded:!!(f & 2), reeling:!!(f & 4), held:HELD[cp.h | 0] ?? null, charge:(cp.c | 0) / 100,
      hook:k ? {x:k[1], y:k[2], z:k[3]} : null, stage:k ? STAGES[k[0]] ?? null : null,
      ghost:g ? {x:g[0], z:g[1], kind:HELD[g[2]] ?? null, ok:!!g[3]} : null}, now());
    lastPose = {x:p[0], y:p[1], z:p[2], yaw:p[3], swimming:!!(f & 1)};
    return ctx.role() === 'host' ? {type:'move', me:lastPose} : null; // keeps game.js `other` and liveness working
  }

  // ---------- our pose stream ----------
  function snapshot(l) {
    const hook = l.hook ? [Math.max(0, STAGES.indexOf(l.hook.stage)), r2(l.hook.x), r2(l.hook.y), r2(l.hook.z)] : 0;
    const g = l.ghost ? [l.ghost.x, l.ghost.z, Math.max(0, HELD.indexOf(l.ghost.kind)), l.ghost.ok ? 1 : 0] : 0;
    return {type:'cp', p:[r2(l.x), r2(l.y), r2(l.z), r3(l.yaw), r2(l.pitch)], f:(l.swimming ? 1 : 0) | (l.grounded ? 2 : 0) | (l.reeling ? 4 : 0),
      h:Math.max(0, HELD.indexOf(l.held ?? null)), c:Math.round((l.charge || 0) * 100), k:hook, g};
  }
  function sendPose(t) {
    if (t - lastSend < SEND_MS) return; // cheap gate before building the snapshot
    const s = snapshot(ctx.local()), key = JSON.stringify(s), moving = key !== lastSent;
    // The first unchanged snap still goes out on the 15 Hz tick so the receiver sees the stop promptly (no overshoot).
    if (t - lastSend < (moving || !settled ? SEND_MS : IDLE_MS)) return;
    settled = !moving;
    lastSend = t; lastSent = key; s.t = Math.round(t);
    sendRaw(enc.encode(s, {owned:true}));
  }

  // ---------- remote rendering ----------
  function renderRemote(dt, t, time) {
    const s = peer && ctx.ready() ? buffer.sample(t, sample) : null;
    avatar.group.visible = !!s;
    if (s) ctx.friend.visible = false; // game.js' simple avatar stays the fallback for old clients
    if (!s) { rope.update(dt, hand, null, ctx.ocean, time); ghost.update(null, ctx.deckY(), time); return; }
    const L = s.latest ?? {};
    if (L.stage === 'flying' && lastHook !== 'flying') throwAt = t;
    lastHook = L.stage ?? null;
    const em = emote && (t - emote.at) / 1000 < EMOTE_S ? {kind:emote.kind, age:(t - emote.at) / 1000} : null;
    avatar.update(dt, {x:s.x, y:s.y - 1.6, z:s.z, yaw:s.yaw, pitch:s.pitch, speed:s.speed ?? 0, swimming:L.swimming, grounded:L.grounded,
      held:L.held, charge:L.charge, reeling:L.reeling, hookOut:!!L.hook, stage:L.stage, emote:em, throwAge:throwAt >= 0 ? (t - throwAt) / 1000 : null}, time, ctx.camera);
    avatar.handWorld(hand);
    if (s.hook) s.hook.stage = L.stage; // s.hook is the buffer's reusable sample object
    rope.update(dt, hand, s.hook, ctx.ocean, time);
    ghost.update(L.ghost, ctx.deckY(), time);
  }

  // ---------- reconnect (guest) ----------
  // Reconnect is owned here: lost() is called by game.js when the channel closes, when the host goes silent, or when
  // a dial fails. The first loss dials at once; a failed attempt redials with backoff; an attempt in flight gets ATTEMPT_MS.
  function lost() {
    if (ctx.role() !== 'guest' || !aboard) return false;
    const t = now();
    if (!rejoin) { rejoin = {since:t, attempt:0, next:t}; feed.push('Connection lost. Reconnecting…', 'warn'); }
    else rejoin.next = Math.min(rejoin.next, t + Math.min(4000, 500 * 2 ** rejoin.attempt)); // that attempt failed
    tickRejoin(t);
    return true;
  }
  const retry = () => lost() && !!rejoin; // dial error while not ready
  function rejoined() {
    if (!rejoin) return false;
    rejoin = null; feed.push('Reconnected. Your bag is safe.', 'join');
    return true;
  }
  function tickRejoin(t) {
    if (!rejoin) return;
    if (ctx.role() !== 'guest') { rejoin = null; aboard = false; return; }
    if (ctx.ready()) { rejoin = null; return; }
    if (t - rejoin.since > RECONNECT_WINDOW_MS) { rejoin = null; aboard = false; feed.push('Could not reach your brother. Back on your own raft.', 'leave'); ctx.giveUp(); return; }
    if (t >= rejoin.next) { rejoin.attempt++; rejoin.next = t + ATTEMPT_MS; ctx.reconnect(); }
  }

  // ---------- input: middle-click ping, Z/X emotes ----------
  function ping() {
    const a = ctx.aim(); if (!a) return;
    const it = a.item, p = it ? {x:it.x, y:ctx.deckY(), z:it.z} : a.point;
    if (!p || !Number.isFinite(p.x)) return;
    const l = ctx.local(), d = Math.hypot(p.x - l.x, p.z - l.z);
    if (d > PING_RANGE) return;
    pings.add({x:p.x, y:p.y, z:p.z, mine:true, label:'You'});
    if (peer) event('ping', {p:[r2(p.x), r2(p.y), r2(p.z)]});
  }
  ctx.canvas?.addEventListener('pointerdown', e => { if (e.button === 1 && !ctx.blocked()) { e.preventDefault(); ping(); } }, {signal:ac.signal});
  ctx.canvas?.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); }, {signal:ac.signal});
  addEventListener('keydown', e => {
    const kind = EMOTE_KEYS[e.code];
    if (!kind || e.repeat || ctx.blocked() || e.target?.matches?.('input, textarea, select')) return;
    if (kind === 'point') ping();
    if (peer) event('emote', {e:kind});
    feed.push(kind === 'wave' ? 'You wave.' : 'You point.', 'emote');
  }, {signal:ac.signal});

  // ---------- frame ----------
  function update(dt, time) {
    if (errors > 20) return;
    try {
      const t = now(); track();
      if (conn?.open && !peer && t - helloAt > 1000) { helloAt = t; event('hello', {v:COOP_VERSION, id:coopId, name:readName()}); }
      if (peer && conn?.open) sendPose(t);
      const role = ctx.role();
      if (role === 'guest' && ctx.ready()) aboard = true; else if (role === 'solo') aboard = false;
      if (peer && role === 'guest' && ctx.ready() && t - lastRecv > SILENCE_MS) lost(); // host went quiet
      tickRejoin(t);
      renderRemote(dt, t, time);
      pings.update(dt, time, ctx.camera);
    } catch (e) { if (++errors <= 3) console.error('coop update failed', e); }
  }

  // toast() hook: connection news goes to the bottom-left feed instead of the centre of the screen.
  function feedToast(text) {
    if (!FEED_RE.test(text)) return false;
    feed.push(text, /left|disconnected/i.test(text) ? 'leave' : 'join'); return true;
  }

  const debug = {
    get stats() { const s = (now() - stats.since) / 1000; return {...stats, outBps:stats.bytesOut / s, inBps:stats.bytesIn / s, interp:buffer.stats}; },
    get remote() { const p = avatar.group.position; return {x:p.x, y:p.y, z:p.z, visible:avatar.group.visible, name:peerName}; },
    get peer() { return peer ? {...peer} : null; }, get rejoin() { return rejoin ? {...rejoin} : null; },
  };
  globalThis.coopDebug = debug;

  return {
    encode, decode, update, feed:feedToast, lost, retry, rejoined,
    meta:() => ({coopId}),
    isRejoin:c => !!peer && c?.metadata?.coopId === peer.id,
    capture:() => ({rejoin, peerName, aboard}),
    dispose() {
      ac.abort();
      for (const x of [feed, pings, rope, ghost, avatar]) { try { x.dispose(); } catch {} }
      avatar.group.removeFromParent();
      if (globalThis.coopDebug === debug) delete globalThis.coopDebug;
    },
  };
}
