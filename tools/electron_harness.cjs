// Test entry for the Little Raft desktop shell. Runs an unmodified copy of desktop/main.cjs
// with an isolated userData dir and a controllable window, so checks never touch the real app.
//   LR_MAIN        absolute path to the copied main.cjs (its config.json sets the origin)
//   LR_USER_DATA   throwaway userData dir (also isolates the single-instance lock)
//   LR_WINDOW      hidden (default) | offscreen | show
// Control channel: one JSON command per stdin line, {id, op, ...}; replies {reply: id, ok, value|error} on stdout.
//   eval {code}           webContents.executeJavaScript(code) without a user gesture
//   key {key, mods?}      real keyDown/char/keyUp through webContents.sendInputEvent
//   click {x, y}          real mouseMove/mouseDown/mouseUp through sendInputEvent (a trusted gesture)
//   move {x, y}           mouseMove
//   focus                 show + focus the window and its webContents
//   capture               PNG of the page, base64
//   status                window/app liveness
const Module = require('node:module');
const electron = require('electron');
const { app } = electron;

const userData = process.env.LR_USER_DATA;
if (!userData || !process.env.LR_MAIN) { console.error('LR_MAIN and LR_USER_DATA are required'); process.exit(2); }
const mode = process.env.LR_WINDOW || 'hidden';

const setPath = app.setPath.bind(app);
app.setPath = (name, p) => setPath(name, name === 'userData' ? userData : p);

const log = (event, extra = {}) => process.stdout.write(JSON.stringify({ harness: event, t: Date.now(), ...extra }) + '\n');

class HarnessWindow extends electron.BrowserWindow {
  constructor(opts = {}) {
    const o = { ...opts };
    if (mode === 'hidden') o.show = false;
    if (mode === 'offscreen') { o.x = -6000; o.y = -6000; }
    super(o);
    wins.push(this);
    this.on('closed', () => log('window-closed'));
    log('window-created', { mode, show: o.show !== false, webPreferences: opts.webPreferences || {} });
    this.on('focus', () => log('focus'));
    this.on('blur', () => log('blur'));
    this.on('enter-full-screen', () => log('enter-full-screen'));
    this.on('leave-full-screen', () => log('leave-full-screen'));
    const wc = this.webContents;
    wc.on('did-navigate', (_e, url) => log('did-navigate', { url }));
    wc.on('did-navigate-in-page', (_e, url) => log('did-navigate-in-page', { url }));
    wc.on('render-process-gone', (_e, d) => log('render-process-gone', d));
    wc.on('console-message', (e, level, message) => {
      const lv = e.level ?? level, m = e.message ?? message;
      if (lv === 'error' || lv === 3) log('console-error', { message: String(m).slice(0, 300) });
    });
  }
}
const wins = [];
const shim = new Proxy(electron, { get: (t, k) => (k === 'BrowserWindow' ? HarnessWindow : t[k]) });
const load = Module._load;
Module._load = function (request, ...rest) { return request === 'electron' ? shim : load.call(this, request, ...rest); };

// Record what the real shell's permission handlers decide.
const patched = new WeakSet(), seen = new Set();
const once = (event, extra) => { const k = JSON.stringify([event, extra]); if (!seen.has(k)) { seen.add(k); log(event, extra); } };
app.on('web-contents-created', (_e, wc) => {
  const s = wc.session;
  if (patched.has(s)) return; patched.add(s);
  for (const name of ['setPermissionRequestHandler', 'setPermissionCheckHandler']) {
    const orig = s[name].bind(s);
    s[name] = (fn) => orig(fn && ((...a) => {
      if (name === 'setPermissionRequestHandler') {
        const [w, perm, cb, details] = a;
        return fn(w, perm, (ok) => { once('permission-request', { perm, ok }); cb(ok); }, details);
      }
      const r = fn(...a); once('permission-check', { perm: a[1], ok: r }); return r;
    }));
  }
});
app.on('before-quit', () => log('before-quit'));
app.on('will-quit', () => log('will-quit'));
app.on('child-process-gone', (_e, d) => log('child-process-gone', d));
app.on('ready', () => log('ready', { electron: process.versions.electron, chrome: process.versions.chrome }));

const win = () => wins.find((w) => !w.isDestroyed());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ops = {
  async eval({ code }) { return win().webContents.executeJavaScript(code, false); },
  async key({ key, mods = [] }) {
    const wc = win().webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods });
    if (key.length === 1) wc.sendInputEvent({ type: 'char', keyCode: key, modifiers: mods });
    await sleep(60);
    wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods });
    return true;
  },
  async move({ x, y }) { win().webContents.sendInputEvent({ type: 'mouseMove', x, y }); return true; },
  async click({ x, y }) {
    const wc = win().webContents;
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(30);
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    return true;
  },
  async capture() { return (await win().webContents.capturePage()).toPNG().toString('base64'); },
  async focus() { const w = win(); w.show(); w.focus(); w.webContents.focus(); return true; },
  async status() {
    const w = win();
    return { windows: wins.filter((x) => !x.isDestroyed()).length, visible: !!w && w.isVisible(), focused: !!w && w.isFocused(),
      crashed: !!w && w.webContents.isCrashed(), url: w ? w.webContents.getURL() : null, bounds: w ? w.getContentBounds() : null };
  },
};
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }
    const reply = (o) => process.stdout.write(JSON.stringify({ reply: cmd.id, ...o }) + '\n');
    Promise.resolve().then(() => { if (!ops[cmd.op]) throw new Error('unknown op ' + cmd.op); if (cmd.op !== 'status' && !win()) throw new Error('no window'); return ops[cmd.op](cmd); })
      .then((value) => reply({ ok: true, value: value === undefined ? null : value }), (e) => reply({ ok: false, error: String(e && e.stack || e) }));
  }
});

require(process.env.LR_MAIN);
