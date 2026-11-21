// Loopback test transport: a fake PeerJS (`globalThis.Peer`) over BroadcastChannel so two pages in one browser
// context can play co-op without a signalling server or WebRTC. Active only with `?loopback` in the URL or
// localStorage['little-raft-loopback']==='1'; otherwise this module touches nothing.
// Chaos + byte stats live on window.coopChaos and apply to messages this page SENDS.

const CHANNEL = 'little-raft-loopback';
const CLAIM_MS = 120, EXPIRE_MS = 3000; // generous: slow headless machines stall the main thread

function flagged() {
  try { if (new URLSearchParams(globalThis.location?.search ?? '').has('loopback')) return true; } catch {}
  try { return globalThis.localStorage?.getItem('little-raft-loopback') === '1'; } catch { return false; }
}

if (typeof BroadcastChannel === 'function' && flagged()) install();

function install() {
  const rid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  const now = () => performance.now();
  const peers = new Set(), all = new Set(); // open / not-yet-destroyed Peers on this page
  let holeUntil = 0;
  const holed = () => now() < holeUntil;

  const chaos = globalThis.coopChaos = {
    latency: 0, jitter: 0, loss: 0,
    bytes: {sent: {}, recv: {}},
    drop() { for (const p of all) for (const c of [...p._conns.values()]) c._abrupt(); },
    blackhole(ms) { holeUntil = Math.max(holeUntil, now() + (+ms || 0)); },
    disconnect() { for (const p of all) p.disconnect(); }, // simulate losing the signalling server
    reset() { this.latency = this.jitter = this.loss = 0; holeUntil = 0; this.bytes = {sent: {}, recv: {}}; },
  };
  function count(dir, d) {
    let k = d && typeof d === 'object' && typeof d.type === 'string' ? d.type : typeof d;
    if (k === 'Δ' && d.k != null) k = 'Δ:' + d.k;
    let n = 0; try { n = JSON.stringify(d)?.length ?? 0; } catch {}
    chaos.bytes[dir][k] = (chaos.bytes[dir][k] ?? 0) + n;
  }

  class Emitter {
    constructor() { this._ev = new Map(); }
    on(ev, fn) { if (!this._ev.has(ev)) this._ev.set(ev, []); this._ev.get(ev).push(fn); return this; }
    once(ev, fn) { const w = (...a) => { this.off(ev, w); fn(...a); }; w._fn = fn; return this.on(ev, w); }
    off(ev, fn) {
      const l = this._ev.get(ev); if (!l) return this;
      if (!fn) { this._ev.delete(ev); return this; }
      const i = l.findIndex(f => f === fn || f._fn === fn); if (i >= 0) l.splice(i, 1); return this;
    }
    removeListener(ev, fn) { return this.off(ev, fn); }
    removeAllListeners(ev) { ev ? this._ev.delete(ev) : this._ev.clear(); return this; }
    emit(ev, ...a) {
      for (const fn of [...(this._ev.get(ev) ?? [])]) { try { fn(...a); } catch (e) { console.error('[loopback]', ev, e); } }
      return true;
    }
  }
  const err = (type, message) => Object.assign(new Error(message), {type});

  class DataConnection extends Emitter {
    constructor(provider, peerId, cid, {metadata, reliable = true} = {}) {
      super();
      this.provider = provider; this.peer = peerId; this.connectionId = cid; this.label = cid;
      this.metadata = metadata; this.reliable = !!reliable; this.serialization = 'json'; this.type = 'data';
      this.open = false; this._q = []; this._timer = 0; this._last = 0;
    }
    send(d) {
      if (!this.open) { this.emit('error', err('not-open-yet', 'Connection is not open. You should listen for the `open` event before sending messages.')); return; }
      let json; try { json = JSON.stringify(d); } catch (e) { this.emit('error', err('message-too-big', String(e))); return; }
      if (json === undefined) return;
      count('sent', d);
      if (holed()) return;
      this._enqueue({t: 'data', d: json});
    }
    // Reliable + ordered: each packet's release time is >= the previous one, so jitter never reorders and a
    // "lost" (retransmitted) packet holds up everything behind it.
    _enqueue(msg) {
      const lat = Math.max(0, +chaos.latency || 0), jit = Math.max(0, +chaos.jitter || 0);
      let delay = lat + Math.random() * jit;
      if (Math.random() < (+chaos.loss || 0)) delay += 3 * lat + 50;
      const at = Math.max(now() + delay, this._last); this._last = at;
      if (delay <= 0 && !this._q.length) { this.provider._post({...msg, to: this.peer, from: this.provider.id, cid: this.connectionId}); return; }
      this._q.push({at, msg}); this._pump();
    }
    _pump() {
      if (this._timer || !this._q.length) return;
      this._timer = setTimeout(() => {
        this._timer = 0;
        while (this._q.length && this._q[0].at <= now() + 1) {
          const {msg} = this._q.shift();
          if (msg.t === 'data' && holed()) continue;
          this.provider._post({...msg, to: this.peer, from: this.provider.id, cid: this.connectionId});
        }
        this._pump();
      }, Math.max(0, this._q[0].at - now()));
    }
    _recv(json) {
      if (!this.open || holed()) return;
      let d; try { d = JSON.parse(json); } catch { return; }
      count('recv', d); this.emit('data', d);
    }
    _opened() { if (this.open || !this.provider) return; this.open = true; this.emit('open'); }
    _teardown() {
      clearTimeout(this._timer); this._timer = 0; this._q.length = 0;
      this.provider?._conns.delete(this.connectionId);
      const was = this.open; this.open = false; this.provider = null;
      if (was) this.emit('close'); // PeerJS emits 'close' only for a connection that had opened
    }
    close() { // graceful: already-sent data still flushes in order, then the remote hears 'close'
      const p = this.provider; if (!p) return;
      const {peer, connectionId: cid} = this, q = this._q.splice(0), t0 = now();
      const post = msg => p._post({...msg, to: peer, from: p.id, cid});
      for (const {at, msg} of q) setTimeout(() => { if (msg.t !== 'data' || !holed()) post(msg); }, at - t0);
      setTimeout(() => post({t: 'close'}), Math.max(this._last, t0 + Math.max(0, +chaos.latency || 0)) - t0);
      this._teardown();
    }
    _abrupt() { const p = this.provider; if (!p) return; p._post({t: 'close', to: this.peer, from: p.id, cid: this.connectionId}); this._teardown(); }
  }

  class Peer extends Emitter {
    constructor(id, options) {
      super();
      if (id && typeof id === 'object') { options = id; id = undefined; }
      this.options = options ?? {}; this.id = id ? String(id) : rid();
      this.open = false; this.destroyed = false; this.disconnected = false;
      this._conns = new Map(); this._pending = new Map(); this._claim = rid();
      this._bc = new BroadcastChannel(CHANNEL);
      this._bc.onmessage = e => this._onMsg(e.data);
      all.add(this);
      this._initialize();
    }
    get connections() { const o = {}; for (const c of this._conns.values()) (o[c.peer] ??= []).push(c); return o; }
    _post(m) { try { this._bc?.postMessage(m); } catch {} }
    _taken() { for (const p of peers) if (p !== this && p.id === this.id && !p.destroyed) return true; return false; }
    _initialize() { // ask the channel whether anyone already holds this id, then "open" like the server would
      this._claimed = false;
      this._post({t: 'who', id: this.id, claim: this._claim});
      setTimeout(() => {
        if (this.destroyed || this.disconnected) return;
        if (this._claimed || this._taken()) {
          this.emit('error', err('unavailable-id', `ID "${this.id}" is taken`)); this.destroy(); return;
        }
        this.open = true; peers.add(this); this.emit('open', this.id);
      }, CLAIM_MS);
    }
    _onMsg(m) {
      if (!m || this.destroyed) return;
      if (m.t === 'who') {
        if (m.id !== this.id || m.claim === this._claim) return;
        if (this.open) this._post({t: 'here', id: this.id, claim: m.claim});
        else if (m.claim < this._claim) this._claimed = true; // simultaneous claim: lowest token wins
        return;
      }
      if (m.t === 'here') { if (m.claim === this._claim) this._claimed = true; return; }
      if (m.t === 'bye') { for (const c of [...this._conns.values()]) if (c.peer === m.from) c._teardown(); return; }
      if (m.to !== this.id) return;
      if (m.t === 'req') { // data connections survive a signalling drop, but new ones need the "server"
        if (!this.open) return;
        this._post({t: 'seen', to: m.from, from: this.id, cid: m.cid}); // signalling reply: cancels EXPIRE
        const c = new DataConnection(this, m.from, m.cid, {metadata: m.metadata, reliable: m.reliable});
        this._conns.set(m.cid, c);
        this.emit('connection', c);
        c._enqueue({t: 'acc'});
        setTimeout(() => c._opened(), 0);
        return;
      }
      const c = this._conns.get(m.cid);
      if (m.t === 'seen') { clearTimeout(this._pending.get(m.cid)); this._pending.delete(m.cid); return; }
      if (!c || c.peer !== m.from) return;
      if (m.t === 'acc') c._opened();
      else if (m.t === 'data') c._recv(m.d);
      else if (m.t === 'close') c._teardown();
    }
    connect(peerId, {reliable = true, metadata, label} = {}) {
      if (this.disconnected || this.destroyed) {
        this.emit('error', err('disconnected', 'Cannot connect to new Peer after disconnecting from server.')); return;
      }
      const cid = 'dc_' + rid(), c = new DataConnection(this, String(peerId), cid, {reliable, metadata});
      if (label) c.label = label;
      this._conns.set(cid, c);
      const delay = Math.max(0, +chaos.latency || 0);
      setTimeout(() => this._post({t: 'req', to: c.peer, from: this.id, cid, metadata, reliable: c.reliable}), delay);
      this._pending.set(cid, setTimeout(() => { // like the server's EXPIRE: error on the peer, conn stays unopened
        this._pending.delete(cid);
        if (!c.open && !this.destroyed) { this._conns.delete(cid); c.provider = null; this.emit('error', err('peer-unavailable', `Could not connect to peer ${peerId}`)); }
      }, EXPIRE_MS + 2 * delay));
      return c;
    }
    disconnect() {
      if (this.disconnected) return;
      this.disconnected = true; this.open = false; peers.delete(this);
      this.emit('disconnected', this.id);
    }
    reconnect() {
      if (this.destroyed) throw new Error('This peer cannot reconnect to the server. It has already been destroyed.');
      if (!this.disconnected) return;
      this.disconnected = false; this._initialize();
    }
    destroy() {
      if (this.destroyed) return;
      this.disconnect();
      for (const c of [...this._conns.values()]) c._abrupt();
      for (const t of this._pending.values()) clearTimeout(t); this._pending.clear();
      this.destroyed = true; all.delete(this); this._post({t: 'bye', from: this.id});
      try { this._bc.close(); } catch {} this._bc = null;
      this.emit('close');
    }
  }
  globalThis.addEventListener?.('pagehide', () => { for (const p of all) p._post({t: 'bye', from: p.id}); });
  Peer.loopback = true;
  globalThis.Peer = Peer;
}
