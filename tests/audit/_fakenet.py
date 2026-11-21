"""Fake PeerJS transport for audit tests: two headless pages, Python pumps per-page outboxes."""
import os, json, threading, functools, http.server, socketserver
from pathlib import Path

FAKE_PEER_JS = r"""
(() => {
  class Em { constructor(){ this._h = {}; }
    on(e, f){ (this._h[e] ??= []).push(f); return this; }
    off(e, f){ const l = this._h[e]; if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); } return this; }
    removeListener(e, f){ return this.off(e, f); }
    emit(e, ...a){ for (const f of (this._h[e] || []).slice()) f(...a); } }
  const net = window.__fakeNet = {outbox:[], conns:new Map(), peers:[], log:[], sent:[], recv:[]};
  let n = 0;
  class Conn extends Em {
    constructor(cid, peer){ super(); this.cid = cid; this.peer = peer; this.open = false; net.conns.set(cid, this); }
    send(d){ if (!this.open) return; const s = JSON.stringify(d); net.sent.push({cid:this.cid, s}); net.outbox.push({op:'data', cid:this.cid, data:s}); }
    close(){ if (!this.open && this._closed) return; this._closed = true; const was = this.open; this.open = false; net.outbox.push({op:'close', cid:this.cid}); if (was) this.emit('close'); }
  }
  class Peer extends Em {
    constructor(id){ super(); this.id = id || ('anon-' + Math.random().toString(36).slice(2, 8)); this.open = false; this.destroyed = false; this.disconnected = false;
      net.peers.push(this); net.outbox.push({op:'peer', id:this.id}); }
    connect(rid){ const cid = this.id + '>' + rid + '#' + (n++); const c = new Conn(cid, rid); net.outbox.push({op:'connect', from:this.id, to:rid, cid}); return c; }
    destroy(){ if (this.destroyed) return; this.destroyed = true; for (const c of net.conns.values()) if (c.open) c.close(); net.outbox.push({op:'unpeer', id:this.id}); }
    reconnect(){}
  }
  net.deliver = m => {
    if (m.op === 'peerOpen') { const p = net.peers.find(p => p.id === m.id && !p.destroyed); if (p) { p.open = true; p.emit('open', p.id); } }
    else if (m.op === 'incoming') { const p = net.peers.find(p => p.id === m.to && !p.destroyed); if (!p) return false; const c = new Conn(m.cid, m.from); p.emit('connection', c); }
    else if (m.op === 'open') { const c = net.conns.get(m.cid); if (c && !c._closed) { c.open = true; c.emit('open'); } }
    else if (m.op === 'data') { const c = net.conns.get(m.cid); if (c && c.open) { net.recv.push(m.data); c.emit('data', JSON.parse(m.data)); } }
    else if (m.op === 'close') { const c = net.conns.get(m.cid); if (c && !c._closed) { c._closed = true; const was = c.open; c.open = false; if (was) c.emit('close'); } }
    else if (m.op === 'peerError') { const p = net.peers.find(p => p.id === m.id && !p.destroyed); if (p) p.emit('error', {type:m.type}); }
    return true;
  };
  // Inject a raw message as if it arrived from the remote side on the current open conn.
  net.inject = data => { for (const c of net.conns.values()) if (c.open) { c.emit('data', data); return true; } return false; };
  net.take = () => net.outbox.splice(0);
  // Single-page helpers: act as the remote side without a second page.
  net.fakeIncoming = (from = 'fake-guest-' + (n++)) => { const p = net.peers.find(p => !p.destroyed && p.open); const cid = from + '>' + p.id + '#' + (n++); const c = new Conn(cid, from); p.emit('connection', c); if (!c._closed) { c.open = true; c.emit('open'); } return cid; };
  net.remoteSend = (cid, data) => { const c = net.conns.get(cid); if (!c || !c.open) return false; c.emit('data', JSON.parse(JSON.stringify(data))); return true; };
  net.remoteClose = cid => { const c = net.conns.get(cid); if (c && !c._closed) { c._closed = true; const was = c.open; c.open = false; if (was) c.emit('close'); } };
  net.sentOn = cid => net.sent.filter(x => x.cid === cid).map(x => JSON.parse(x.s));
  net.isOpen = cid => !!net.conns.get(cid)?.open;
  window.Peer = Peer;
})();
"""

def serve(dist=None):
    dist = Path(dist or os.environ.get('RAFT_DIST') or Path(__file__).resolve().parents[2] / 'dist').resolve()
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(dist)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'

def launch(p):
    return p.chromium.launch(executable_path=os.environ.get('RAFT_CHROMIUM', '/opt/pw-browsers/chromium'), headless=True,
                             args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])

class FakeNet:
    """Routes fake PeerJS traffic between pages. pages: list of Page."""
    def __init__(self, pages):
        self.pages = pages; self.owner = {}; self.cidpages = {}; self.drop = set(); self.paused = False; self.hold = []
    def pump(self, rounds=1):
        for _ in range(rounds):
            for pg in self.pages:
                if pg.is_closed(): continue
                try: msgs = pg.evaluate('window.__fakeNet ? __fakeNet.take() : []')
                except Exception as e:
                    if os.environ.get('FAKENET_DEBUG'): print('take failed', str(e)[:300])
                    continue
                for m in msgs: self.route(pg, m)
    def route(self, src, m):
        op = m['op']
        if os.environ.get('FAKENET_DEBUG'): print('route', op, m.get('cid') or m.get('id'))
        if op == 'peer':
            self.owner[m['id']] = src; self._d(src, {'op': 'peerOpen', 'id': m['id']})
        elif op == 'unpeer':
            if self.owner.get(m['id']) is src: self.owner.pop(m['id'], None)
        elif op == 'connect':
            dst = self.owner.get(m['to'])
            if not dst or dst.is_closed():
                self._d(src, {'op': 'peerError', 'id': m['from'], 'type': 'peer-unavailable'}); return
            self.cidpages[m['cid']] = (src, dst)
            self._d(dst, {'op': 'incoming', 'from': m['from'], 'to': m['to'], 'cid': m['cid']})
            self._d(dst, {'op': 'open', 'cid': m['cid']}); self._d(src, {'op': 'open', 'cid': m['cid']})
        elif op in ('data', 'close'):
            pair = self.cidpages.get(m['cid'])
            if not pair: return
            dst = pair[1] if pair[0] is src else pair[0]
            if op == 'data' and self.paused: self.hold.append((dst, m)); return
            self._d(dst, m)
    def flush_hold(self):
        h, self.hold = self.hold, []
        for dst, m in h: self._d(dst, m)
    def _d(self, pg, m):
        if pg.is_closed(): return
        try: pg.evaluate('m => __fakeNet.deliver(m)', m)
        except Exception as e:
            if os.environ.get('FAKENET_DEBUG'): print('deliver failed', m.get('op'), str(e)[:300])
    def wait(self, page, expr, timeout=30000, step=60):
        import time
        t0 = time.time()
        while time.time() - t0 < timeout / 1000:
            self.pump()
            try:
                if page.evaluate(expr): return True
            except Exception: pass
            page.wait_for_timeout(step)
        raise TimeoutError('timeout waiting for ' + expr)
    def run(self, ms, step=60):
        import time
        t0 = time.time()
        while (time.time() - t0) * 1000 < ms:
            self.pump(); self.pages[0].wait_for_timeout(step)

def new_page(browser, url, saved=None):
    ctx = browser.new_context(viewport={'width': int(os.environ.get('FAKENET_W', 480)), 'height': int(os.environ.get('FAKENET_H', 320))})
    ctx.add_init_script("HTMLCanvasElement.prototype.requestPointerLock=function(){return Promise.reject(new Error('QA fallback'))};")
    ctx.add_init_script(FAKE_PEER_JS)
    ctx.add_init_script('try{localStorage.setItem("little-raft-settings",JSON.stringify({graphics:"low",volume:0}))}catch(e){}')
    if saved is not None:
        ctx.add_init_script('localStorage.setItem("little-raft-v1",' + json.dumps(json.dumps(saved)) + ');')
    ctx.route('**/vendor/peerjs.min.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body='/* stubbed */'))
    pg = ctx.new_page(); pg._errors = []
    pg.on('pageerror', lambda e: pg._errors.append(str(e)))
    pg.on("console", lambda m: m.type in ("error","warning") and pg._errors.append(m.text[:200]))
    pg.goto(url)
    try: pg.wait_for_function("!!window.raftDebug", timeout=60000)
    except Exception: raise RuntimeError("load failed: " + repr(pg._errors))
    return pg

def connect(net, host, guest):
    host.evaluate("document.querySelector('#host').click()")
    net.wait(host, 'document.querySelector("#roomCode").textContent.length===6')
    code = host.locator('#roomCode').inner_text()
    guest.evaluate("c => { document.querySelector('#roomInput').value = c; document.querySelector('#joinForm').requestSubmit(); }", code)
    net.wait(guest, 'raftDebug.state.networkReady')
    net.wait(host, '!!raftDebug.state.other')
    return code

S = lambda pg: pg.evaluate('raftDebug.state')
