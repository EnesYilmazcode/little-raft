// Dolphin friend (docs/specs/dolphin.md). Toss 3 raw fish to the visiting wild dolphin and it stays as the raft's
// named friend: it loops and leaps near the raft, swims beside a swimmer or Driftboard rider, comes when the Conch
// Call is blown, now and then noses floating debris toward the deck and swims out to point at a signal cache or a
// docked wreck. No damage, no upkeep, it never leaves. Slice: world.ext.dolphin, host-authoritative, actions 'dolphin.*'.
// Poses are closed form in (seed, t) plus the synced esc / callWho / nudge; rules live in dolphin-core.js.
import {
  FISH_NEED, TOSS_REACH, PAT_REACH, HOST_SLACK, BLEND, BOOST, BOOST_R, OLD_HOST,
  emptyState, cleanDolphin, defaultName, toss, pat, rename, call, calling, behaviour, pickEscort, pickNudge, stepNudge,
  nudgeAbort, nextNudgeAt, newPose, loopPose, showPose, pointPose, followPose, nudgePose, lerpAngle, SHOW_LEAP,
} from './dolphin-core.js?build=v3-survival-ae77fa84ac2b';
import { dolphinMotion, raftExtent } from './wildlife.js?build=v3-survival-ae77fa84ac2b';
import { dolphinGeometry } from './wildlife-models.js?build=v3-survival-ae77fa84ac2b';
import { heartGeometry } from './animals-models.js?build=v3-survival-ae77fa84ac2b';
import { raftCentre } from './signal.js?build=v3-survival-ae77fa84ac2b';

const T_MAX = 1e9, CACHE_EVERY = 5, HEART_T = 1.2, PICK_R = 1.6, FRIEND_PICK = 12, TAG_NEAR = 20, CHIRP_NEAR = 30, SPRING_K = 3;
const fin = v => typeof v === 'number' && Number.isFinite(v);
const r1 = v => Math.round(v * 10) / 10;
const smooth = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const SPRING = { call: true, escort: true, nudge: true };
const copyPose = (a, b) => { a.x = b.x; a.y = b.y; a.z = b.z; a.heading = b.heading; a.pitch = b.pitch; a.roll = b.roll; return a; };

export function createDolphin(ctx, opts = {}) {
  const peek = typeof opts.peek === 'function' ? opts.peek : () => undefined;
  const T = ctx.T;
  let st = emptyState();
  let clock = 0, acc = 0, gotNet = false, netR = -1, hostHasDolphin = true, seenPops = -1;
  let cache = null, cacheR = -1, cacheAt = -1e9;
  let ui = null, uiLoading = null, disposed = false, wreckNow = null;
  // rendering
  let built = false, mesh = null, mat = null, hearts = null, heartMat = null, tag = null, tagTex = null, tagCanvas = null, tagName = null;
  let v3 = null, q4 = null, eul = null, sc3 = null, camR = null, wildMesh = null;
  let heartAge = HEART_T;
  const heartAt = { x: 0, y: 0, z: 0, on: false };
  // pose
  const pose = newPose(), tgt = newPose(), oldP = newPose(), from = newPose(), wild = newPose();
  const world3 = { x: 0, y: 0, z: 0, vis: false };
  let mode = '', prevMode = '', switchAt = -1e9, posed = false;
  let pinT = null; // QA: freeze the friend's pose clock for screenshots
  let sx = 0, sz = 0, svx = 0, svz = 0, lastLp = -1, chirpIn = -1, chirpS = 0, boostOn = false;
  // geometry caches
  let tilesRef = null, tilesLen = -1, ext = 0, centre = { x: 0, z: 0, r: 1 };
  const nets = [], players = [null, null], point = { x: 0, z: 0 }, cands = [{ who: 'host', x: 0, z: 0, inWater: false }, { who: 'guest', x: 0, z: 0, inWater: false }];
  let netCount = 0, decorRef = null, decorLen = -1;
  const ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
  const hit = { type: null };

  const isHost = () => ctx.role !== 'guest';
  const mine = () => (isHost() ? 'host' : 'guest');
  const oldHost = () => ctx.role === 'guest' && !hostHasDolphin;
  const now = () => (isHost() ? st.t : clock);
  const bump = () => { st.r++; };
  const emit = (e, to) => { try { ctx.emit?.(e, to); } catch (err) { console.warn('dolphin emit failed', err); } };
  const esc = s => (ctx.esc ? ctx.esc(s) : String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const friendName = () => st.name || 'Your dolphin';
  const wildlife = () => { const ms = ctx.content?.mods; if (!Array.isArray(ms)) return null; for (let i = 0; i < ms.length; i++) if (ms[i].name === 'wildlife' && !ms[i].dead) return ms[i]; return null; };
  const wildCircler = () => { const c = wildlife()?.circler; return c && c.kind === 'dolphin' ? c : null; };
  const waterH = (x, z) => (ctx.ocean && typeof ctx.ocean.getHeight === 'function' ? ctx.ocean.getHeight(x, z) : -0.24);
  const heldFish = () => ctx.localBag?.()?.selected?.kind === 'fish';

  // The wreck point is optional: shipwreck.js may be missing or disabled.
  try { import('./shipwreck.js?build=v3-survival-ae77fa84ac2b').then(m => { wreckNow = typeof m.shipwreckNow === 'function' ? m.shipwreckNow : null; }).catch(() => {}); } catch { /* no dynamic import */ }

  function refreshLayout() {
    const w = ctx.world; if (!w) return;
    const tl = Array.isArray(w.tiles) ? w.tiles.length : 0;
    if (w.tiles !== tilesRef || tl !== tilesLen) { tilesRef = w.tiles; tilesLen = tl; ext = raftExtent(w.tiles); centre = raftCentre(w.tiles); }
    const dl = Array.isArray(w.decor) ? w.decor.length : 0;
    if (w.decor !== decorRef || dl !== decorLen) {
      decorRef = w.decor; decorLen = dl; netCount = 0;
      if (Array.isArray(w.decor)) for (const d of w.decor) if (d && d.type === 'net' && fin(d.x) && fin(d.z)) {
        if (nets.length <= netCount) nets.push({ x: 0, z: 0 });
        nets[netCount].x = d.x * 2; nets[netCount].z = d.z * 2; netCount++;
      }
      nets.length = netCount;
    }
  }
  function hasPoint() { // a docked wreck beats the signal cache
    const w = wreckNow ? wreckNow() : null;
    if (w && w.phase === 'docked' && !w.cleared && fin(w.x) && fin(w.z) && ctx.content?.mods?.some(m => m.name === 'shipwreck' && !m.dead)) { point.x = w.x; point.z = w.z; return true; }
    const c = ctx.world?.signal?.cache;
    if (c && fin(c.x) && fin(c.z)) { point.x = c.x; point.z = c.z; return true; }
    return false;
  }
  function findItem(tok) {
    const items = ctx.world?.items; if (!Array.isArray(items) || !tok) return null;
    for (let i = 0; i < items.length; i++) if (items[i] && items[i].token === tok) return items[i];
    return null;
  }
  function boardOf(who) {
    const pb = peek('paddleboard'), b = pb && Array.isArray(pb.boards) ? pb.boards : null;
    if (b) for (let i = 0; i < b.length; i++) if (b[i] && b[i].r === who && fin(b[i].x) && fin(b[i].z)) return b[i];
    return null;
  }
  // The followed player: {x, z, yaw} via `out`, or false.
  const fol = { x: 0, z: 0, yaw: 0 };
  function followed(who) {
    if (!who) return false;
    if (who === mine()) {
      const p = ctx.physics; if (!p || !fin(p.x) || !fin(p.z)) return false;
      fol.x = p.x; fol.z = p.z; const y = ctx.camera?.rotation?.y; fol.yaw = fin(y) ? y : 0; return true;
    }
    const o = ctx.other; if (!o || !fin(o.x) || !fin(o.z)) return false;
    fol.x = o.x; fol.z = o.z; fol.yaw = fin(o.yaw) ? o.yaw : 0; return true;
  }

  // ------------------------------------------------------------------ pose

  function closedPose(m, t, out) { // loop / show / point
    if (m === 'show') return showPose(st.seed, t, ext, out);
    if (m === 'point' && hasPoint()) return pointPose(st.seed, t, centre, point, out, ext);
    return loopPose(st.seed, t, ext, out);
  }
  function springTo(tx, tz, dt) {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(0.05, left); left -= h;
      svx += (SPRING_K * SPRING_K * (tx - sx) - 2 * SPRING_K * svx) * h; sx += svx * h;
      svz += (SPRING_K * SPRING_K * (tz - sz) - 2 * SPRING_K * svz) * h; sz += svz * h;
    }
  }
  function computePose(t, dt) {
    const hp = hasPoint();
    let m = behaviour(st, t, hp);
    const who = m === 'call' ? calling(st, t) : m === 'escort' ? st.esc : '';
    const it = m === 'nudge' ? findItem(st.nudge?.tok) : null;
    if ((who && !followed(who)) || (m === 'nudge' && !it)) m = 'loop';
    if (t < switchAt) switchAt = t - BLEND; // clock jumped back: no blend
    if (m !== mode) {
      if (posed) copyPose(from, pose); else closedPose(m, t, from);
      prevMode = mode || m; mode = m; switchAt = posed ? t : t - BLEND;
      if (SPRING[m]) { sx = from.x; sz = from.z; svx = 0; svz = 0; }
    }
    if (pinT !== null) switchAt = t - BLEND; // pinned (QA): no endless blend
    if (SPRING[m]) {
      if (m === 'nudge') nudgePose(it, centre, tgt, t);
      else { followPose(fol, fol.yaw, tgt); dolphinMotion(t, tgt); }
      springTo(tgt.x, tgt.z, dt);
      tgt.x = sx; tgt.z = sz;
    } else closedPose(m, t, tgt);
    const u = t - switchAt;
    if (u < BLEND) {
      const s = smooth(u / BLEND), o = SPRING[prevMode] ? from : closedPose(prevMode, t, oldP);
      pose.x = o.x + (tgt.x - o.x) * s; pose.z = o.z + (tgt.z - o.z) * s; pose.y = o.y + (tgt.y - o.y) * s;
      pose.heading = lerpAngle(o.heading, tgt.heading, s); pose.pitch = o.pitch + (tgt.pitch - o.pitch) * s; pose.roll = o.roll + (tgt.roll - o.roll) * s;
    } else copyPose(pose, tgt);
    posed = true;
    // leap chirps: the motion phase wraps at a leap start
    const per = m === 'show' ? SHOW_LEAP : m === 'nudge' ? 0 : 3;
    const lp = per ? (t % per) / per : -1;
    if (lp >= 0 && lastLp >= 0 && lp < lastLp - 0.5) chirp();
    lastLp = lp;
    // swim boost: escorting or answering me, close by
    let b = false;
    if (who && who === mine() && (m === 'escort' || m === 'call')) { const p = ctx.physics; b = !!p && fin(p.x) && Math.hypot(p.x - pose.x, p.z - pose.z) <= BOOST_R; }
    boostOn = b;
  }
  function chirp() {
    const cam = ctx.camera?.position; if (!cam || typeof ctx.note !== 'function') return;
    const d = Math.hypot(cam.x - pose.x, cam.z - pose.z);
    if (d >= CHIRP_NEAR) return;
    chirpS = 0.35 * (1 - d / CHIRP_NEAR);
    try { ctx.note('pipes', 6, chirpS); } catch { /* audio is optional */ }
    chirpIn = 0.09;
  }

  // ------------------------------------------------------------------ rendering

  function build() {
    v3 = new T.Vector3(); q4 = new T.Quaternion(); eul = new T.Euler(0, 0, 0, 'YXZ'); sc3 = new T.Vector3(0.92, 0.92, 0.92); camR = new T.Vector3();
    mat = new T.MeshLambertMaterial({ vertexColors: true, color: 0xd8ecff });
    mesh = new T.Mesh(dolphinGeometry(T), mat); mesh.name = 'dolphinFriend'; mesh.matrixAutoUpdate = false; mesh.visible = false;
    ctx.scene.add(mesh);
    heartMat = new T.MeshBasicMaterial({ color: 0xff7d9c, transparent: true, opacity: 0, depthWrite: false });
    const hg = heartGeometry(T);
    hearts = [0, 1, 2].map(i => { const h = new T.Mesh(hg, heartMat); h.name = 'dolphinHeart' + i; h.visible = false; h.renderOrder = 3; ctx.scene.add(h); return h; });
    if (typeof document !== 'undefined') {
      tagCanvas = document.createElement('canvas'); tagCanvas.width = 256; tagCanvas.height = 64;
      tagTex = new T.CanvasTexture(tagCanvas); if (T.SRGBColorSpace) tagTex.colorSpace = T.SRGBColorSpace;
      tag = new T.Sprite(new T.SpriteMaterial({ map: tagTex, depthTest: true, transparent: true }));
      tag.name = 'dolphinTag'; tag.scale.set(1.6, 0.4, 1); tag.visible = false; tag.renderOrder = 4;
      ctx.scene.add(tag);
    }
    built = true;
  }
  function drawTag(name) {
    tagName = name;
    if (!tagCanvas) return;
    const g = tagCanvas.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, 256, 64);
    g.font = 'bold 28px system-ui, sans-serif';
    const w = Math.min(248, Math.max(80, g.measureText(name).width + 36)), x0 = (256 - w) / 2;
    g.fillStyle = '#ffffffcc'; g.beginPath();
    if (g.roundRect) g.roundRect(x0, 8, w, 48, 24); else g.rect(x0, 8, w, 48);
    g.fill();
    g.fillStyle = '#1d3440'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 128, 33, 232);
    tagTex.needsUpdate = true;
  }
  function render(dt) {
    const show = st.friend && !oldHost();
    if (!wildMesh && ctx.scene) wildMesh = ctx.scene.getObjectByName('wildlife')?.getObjectByName('dolphin') ?? null;
    if (wildMesh && show) wildMesh.visible = false; // the visitor is your friend now: one dolphin, not two
    mesh.visible = show; world3.vis = show;
    if (show) {
      const h = waterH(pose.x, pose.z);
      world3.x = pose.x; world3.y = h + pose.y; world3.z = pose.z;
      v3.set(pose.x, world3.y, pose.z); eul.set(pose.pitch, pose.heading, pose.roll, 'YXZ'); q4.setFromEuler(eul);
      mesh.matrix.compose(v3, q4, sc3); mesh.matrixWorldNeedsUpdate = true;
      if (tag) {
        if (tagName !== st.name) drawTag(st.name);
        const cam = ctx.camera?.position;
        const near = !!cam && Math.hypot(cam.x - pose.x, cam.y - world3.y, cam.z - pose.z) <= TAG_NEAR;
        tag.visible = near;
        if (near) tag.position.set(pose.x, Math.max(world3.y, h) + 1.1, pose.z);
      }
    } else if (tag) tag.visible = false;
    renderHearts(dt);
  }
  function renderHearts(dt) {
    if (heartAge >= HEART_T) { if (hearts[0].visible) for (const h of hearts) h.visible = false; heartAge = HEART_T; return; }
    heartAge += dt;
    if (world3.vis) { heartAt.x = world3.x; heartAt.y = world3.y; heartAt.z = world3.z; }
    const k = Math.min(1, heartAge / HEART_T), cam = ctx.camera;
    if (cam) camR.set(1, 0, 0).applyQuaternion(cam.quaternion); else camR.set(1, 0, 0);
    heartMat.opacity = k < 0.7 ? 0.95 : 0.95 * Math.max(0, 1 - (k - 0.7) / 0.3);
    for (let i = 0; i < 3; i++) {
      const h = hearts[i], x = (i - 1) * 0.3 * k;
      h.visible = true;
      h.position.set(heartAt.x + camR.x * x, heartAt.y + 0.6 + 0.8 * k + (i === 1 ? 0.08 : 0), heartAt.z + camR.z * x);
      if (cam) h.quaternion.copy(cam.quaternion);
      h.scale.setScalar(1.2 + 0.5 * Math.min(1, k * 4));
    }
  }
  function burst() {
    heartAge = 0;
    if (st.friend && posed) { heartAt.x = pose.x; heartAt.y = waterH(pose.x, pose.z) + pose.y; heartAt.z = pose.z; return; }
    const c = wildCircler(); // befriending: hearts over the wild dolphin
    if (c) { heartAt.x = c.x; heartAt.y = waterH(c.x, c.z) + Math.max(0, c.y); heartAt.z = c.z; }
  }

  // ------------------------------------------------------------------ host tick

  function hostTick() {
    if (!st.friend) return;
    const t = st.t, p = ctx.physics, o = ctx.other;
    const hb = boardOf('host'), gb = boardOf('guest');
    cands[0].inWater = !!(p && (p.swimming || hb)); cands[0].x = hb ? hb.x : p?.x; cands[0].z = hb ? hb.z : p?.z;
    cands[1].inWater = !!(o && (o.swimming || gb)); cands[1].x = gb ? gb.x : o?.x; cands[1].z = gb ? gb.z : o?.z;
    const e = pickEscort(cands, centre, st.esc);
    if (e !== st.esc) { st.esc = e; bump(); }
    if (!st.nudge && t >= st.nextNudge) {
      const b = behaviour(st, t, false);
      if (b !== 'call' && b !== 'escort') {
        players[0] = p ?? null; players[1] = o ?? null;
        const it = pickNudge(ctx.world?.items, centre, players, nets, ctx.heldTokens?.() ?? null);
        if (it) st.nudge = { tok: it.token, at: t };
        st.nextNudge = nextNudgeAt(st.seed, t, st.r);
        bump();
        return it ? it.token : null;
      }
    }
    return null;
  }
  function hostNudge(dt) {
    if (!st.nudge) return;
    const it = findItem(st.nudge.tok);
    players[0] = ctx.physics ?? null; players[1] = ctx.other ?? null;
    const held = ctx.heldTokens?.();
    if (nudgeAbort(st, it, st.t, players, nets) || (held && held.has?.(st.nudge.tok)) || !stepNudge(it, centre, dt)) { st.nudge = null; bump(); }
  }

  function update(dt) {
    if (disposed) return;
    const d = fin(dt) && dt > 0 ? Math.min(dt, 1) : 0;
    refreshLayout();
    if (isHost()) {
      if (ctx.running) {
        st.t = Math.min(T_MAX, st.t + d);
        acc += d;
        while (acc >= 1) { acc -= 1; hostTick(); }
        if (st.friend) hostNudge(d);
      }
      clock = st.t;
    } else clock += d;
    if (chirpIn >= 0) { chirpIn -= d; if (chirpIn < 0) { try { ctx.note?.('pipes', 7, chirpS); } catch { /* optional */ } } }
    if (seenPops >= 0 && st.pops > seenPops) burst();
    seenPops = st.pops;
    if (st.friend && !oldHost()) computePose(pinT ?? now(), d); else { boostOn = false; posed = false; mode = ''; }
    if (!built) {
      if (!T || !ctx.scene) return;
      if (!st.friend && heartAge >= HEART_T) return; // cheap until there is something to draw
      build();
    }
    render(d);
  }

  // ------------------------------------------------------------------ picking

  function camRay(aim) {
    const cam = ctx.camera; if (!cam) return false;
    if (T && v3 && typeof cam.getWorldPosition === 'function') { cam.getWorldPosition(v3); ray.ox = v3.x; ray.oy = v3.y; ray.oz = v3.z; }
    else if (cam.position) { ray.ox = cam.position.x; ray.oy = cam.position.y; ray.oz = cam.position.z; }
    else return false;
    if (aim && aim.dir && fin(aim.dir.x)) { ray.dx = aim.dir.x; ray.dy = aim.dir.y; ray.dz = aim.dir.z; }
    else if (T && typeof cam.getWorldDirection === 'function') { const v = v3 || new T.Vector3(); cam.getWorldDirection(v); ray.dx = v.x; ray.dy = v.y; ray.dz = v.z; }
    else return false;
    const l = Math.hypot(ray.dx, ray.dy, ray.dz); if (!(l > 0)) return false;
    ray.dx /= l; ray.dy /= l; ray.dz /= l;
    return true;
  }
  function sphere(cx, cy, cz, r, best) {
    const ox = ray.ox - cx, oy = ray.oy - cy, oz = ray.oz - cz;
    const b = ox * ray.dx + oy * ray.dy + oz * ray.dz, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
    if (disc < 0) return Infinity;
    let t = -b - Math.sqrt(disc);
    if (t < 0) { if (c > 0) return Infinity; t = 0; }
    return t < best ? t : Infinity;
  }
  function pick(aim) {
    hit.type = null;
    if (!camRay(aim)) return null;
    if (st.friend) {
      if (posed && sphere(pose.x, waterH(pose.x, pose.z) + pose.y, pose.z, PICK_R, FRIEND_PICK) < Infinity) hit.type = 'friend';
    } else {
      const c = wildCircler();
      if (c) { copyPose(wild, c); if (sphere(c.x, waterH(c.x, c.z) + c.y, c.z, PICK_R, TOSS_REACH) < Infinity) hit.type = 'wild'; }
    }
    return hit.type ? hit : null;
  }
  const patNear = () => { const p = ctx.physics; return !!p && fin(p.x) && Math.hypot(p.x - pose.x, p.z - pose.z) <= PAT_REACH; };

  function prompt(aim) {
    const h = pick(aim); if (!h) return null;
    if (oldHost()) return OLD_HOST;
    if (h.type === 'wild') return heldFish() ? `<kbd>E</kbd>Toss a fish · ♥ ${st.pts}/${FISH_NEED}` : 'A dolphin! Bring it a raw fish';
    return patNear() ? `<kbd>E</kbd>Pat ${esc(friendName())}` : `<kbd>E</kbd>Rename ${esc(friendName())}`;
  }
  function interact(aim) {
    const h = pick(aim); if (!h) return false;
    if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
    if (ctx.role === 'guest' && !gotNet) { ctx.notice?.('Wait for your raft to connect'); return true; }
    if (h.type === 'wild') { if (heldFish()) ctx.action({ kind: 'dolphin.toss' }); else ctx.notice?.('A dolphin! Bring it a raw fish'); return true; }
    if (patNear()) ctx.action({ kind: 'dolphin.pat' }); else openRename();
    return true;
  }
  function use(aim, kind) {
    if (kind !== 'conch') return false;
    if (oldHost()) { ctx.notice?.(OLD_HOST, 2400); return true; }
    if (!st.friend) { ctx.notice?.('No dolphin friend yet'); return true; }
    ctx.play?.('splash', 0.5);
    ctx.action({ kind: 'dolphin.call' });
    return true;
  }

  function loadUI() {
    if (ui || uiLoading || typeof document === 'undefined') return uiLoading;
    uiLoading = import('./animals-ui.js?build=v3-survival-ae77fa84ac2b')
      .then(m => { if (disposed) return null; ui = m.createAnimalsUI(ctx, { title: 'Name your dolphin', kind: 'dolphin.name', label: 'Dolphin name', domId: 'lrDolphin' }); return ui; })
      .catch(e => { console.error('dolphin ui failed', e); uiLoading = null; return null; });
    return uiLoading;
  }
  function openRename() {
    if (!st.friend) return false;
    const go = u => u && u.open('dolphin', st.name);
    if (ui) go(ui); else loadUI()?.then(go);
    return true;
  }
  function onBond() { openRename(); } // this client gave the 3rd fish: name it (the host's bond notice reaches everyone)

  // ------------------------------------------------------------------ actions (host)

  function poseOf(actor) {
    const p = actor === 'guest' ? ctx.other : ctx.physics;
    return p && fin(p.x) && fin(p.z) ? p : null;
  }
  function near(actor, x, z, r) {
    const p = poseOf(actor);
    if (!p) return actor !== 'guest';
    return Math.hypot(p.x - x, p.z - z) <= r;
  }
  const fail = (actor, text) => { if (text) emit({ kind: 'notice', text }, actor); return true; };

  function action(a, actor, bag) {
    if (!a || typeof a.kind !== 'string' || a.kind.slice(0, 8) !== 'dolphin.') return false;
    if (!isHost()) return true;
    const verb = a.kind.slice(8), t = st.t, who = actor === 'guest' ? 'guest' : 'host';
    if (verb === 'toss') {
      const c = wildCircler();
      const ok = !!c && near(who, c.x, c.z, TOSS_REACH + HOST_SLACK);
      if (!st.friend && !ok) return fail(who, c ? 'Step a little closer to the dolphin' : 'The dolphin swam off');
      const res = toss(st, bag, t, ok);
      if (!res.ok) return fail(who, res.text);
      if (res.bonded) {
        st.seed = (Math.random() * 2 ** 32) >>> 0; st.name = defaultName(st.seed); st.by = who; st.nextNudge = t + 60;
        bump();
        emit({ kind: 'notice', text: `${st.name} wants to stay with your raft!`, sound: 'catch' }, 'all');
        if (who === 'host') openRename();
        return true;
      }
      bump(); emit({ kind: 'notice', text: res.text, sound: 'collect' }, who);
      return true;
    }
    if (verb === 'pat') {
      if (!st.friend) return true;
      if (!posed) computePose(t, 0);
      if (!near(who, pose.x, pose.z, PAT_REACH + HOST_SLACK)) return fail(who, 'Swim a little closer');
      const res = pat(st, t);
      if (res.heart) bump();
      emit({ kind: 'notice', text: res.heart ? `${friendName()} loves that ♥ ${st.hearts}` : `${friendName()} clicks happily`, sound: 'collect' }, who);
      return true;
    }
    if (verb === 'name') {
      if (!st.friend || typeof a.name !== 'string' || a.name.length > 64) return true;
      const res = rename(st, a.name);
      if (!res.ok) return fail(who, res.text);
      bump(); emit({ kind: 'notice', text: res.text, sound: 'collect' }, 'all');
      return true;
    }
    if (verb === 'call') {
      const res = call(st, who, t);
      if (!res.ok) return fail(who, res.text);
      bump(); emit({ kind: 'notice', text: `${friendName()} is on the way`, sound: 'collect' }, who);
      return true;
    }
    return true; // unknown dolphin.* verbs are consumed
  }

  // ------------------------------------------------------------------ save / net

  function serialize() {
    if (!isHost()) return undefined;
    if (!cache || cacheR !== st.r || st.t - cacheAt >= CACHE_EVERY || st.t < cacheAt) {
      cache = { v: 1, r: st.r, t: r1(st.t), seed: st.seed, pts: st.pts, tossAt: r1(st.tossAt), by: st.by, friend: st.friend, name: st.name, hearts: st.hearts,
        patAt: r1(st.patAt), callAt: r1(st.callAt), callWho: st.callWho, esc: st.esc, nudge: st.nudge ? { tok: st.nudge.tok, at: r1(st.nudge.at) } : null,
        nextNudge: r1(st.nextNudge), pops: st.pops };
      cacheR = st.r; cacheAt = st.t;
    }
    cache.t = r1(st.t);
    return cache;
  }
  function snap(data, first) {
    if (!data || typeof data !== 'object' || !fin(data.t) || Math.abs(data.t) > T_MAX) return;
    if (first || Math.abs(data.t - clock) > 2) clock = data.t;
    else clock += (data.t - clock) * 0.15;
  }
  let seenFriend = false;
  function load(data, from) {
    if (from === 'net') {
      const first = !gotNet; gotNet = true;
      hostHasDolphin = data !== undefined;
      if (data && typeof data === 'object' && data.r === netR && !first) { snap(data); return; }
      const wasFriend = st.friend;
      st = cleanDolphin(data);
      const n = data && typeof data === 'object' ? data.nudge : null; // synced transient: the guest draws the nudge too
      if (n && typeof n === 'object' && typeof n.tok === 'string' && n.tok.length <= 80 && fin(n.at)) st.nudge = { tok: n.tok, at: n.at };
      netR = data && typeof data === 'object' ? data.r : -1;
      if (first) { seenPops = st.pops; seenFriend = st.friend; }
      snap(data, first);
      if (!first && !wasFriend && st.friend && st.by === mine()) onBond();
      seenFriend = st.friend;
      return;
    }
    st = cleanDolphin(data);
    clock = st.t; acc = 0; netR = -1; gotNet = false; hostHasDolphin = true; cache = null; seenPops = st.pops; seenFriend = st.friend; posed = false; mode = '';
  }

  // ------------------------------------------------------------------ QA helpers

  const debug = {
    state: () => JSON.parse(JSON.stringify(st)),
    get clock() { return now(); },
    mode: () => (st.friend ? behaviour(st, now(), hasPoint()) : null),
    shown: () => mode,
    pose: () => ({ ...pose, world: { ...world3 } }),
    spawnWild: () => ctx.content?.debug?.wildlife?.summonCircler?.('dolphin') ?? null,
    wild: () => { const c = wildCircler(); return c ? { x: c.x, y: c.y, z: c.z } : null; },
    befriend(name) {
      if (!isHost()) return false;
      st.pts = FISH_NEED; st.friend = true; st.hearts = Math.max(1, st.hearts);
      if (!st.seed) st.seed = (Math.random() * 2 ** 32) >>> 0;
      const n = typeof name === 'string' ? rename(st, name) : null;
      if (!n || !n.ok) st.name = st.name || defaultName(st.seed);
      st.by = mine(); if (st.nextNudge < st.t) st.nextNudge = st.t + 60;
      bump(); return true;
    },
    advance(sec = 1) {
      if (!isHost() || !fin(sec)) return false;
      st.t = Math.min(T_MAX, Math.max(0, st.t + sec)); hostTick(); bump(); return st.t;
    },
    call: () => ctx.action({ kind: 'dolphin.call' }),
    nudgeNow() { if (!isHost()) return null; st.nextNudge = st.t; return hostTick(); },
    boost: () => boostOn,
    /** QA: draw the friend at clock t (null releases). Rules and the host tick keep running. */
    pin(t) { pinT = fin(t) ? t : null; return pinT; },
    pick(aim) { const h = pick(aim); return h ? { type: h.type, prompt: prompt(aim) } : null; },
    openRename: () => openRename(),
    closeRename() { ui?.close(); },
    burst,
  };

  return {
    name: 'dolphin',
    update,
    serialize,
    load,
    action,
    interact,
    prompt,
    use,
    craftLocked(recipe) { return recipe === 'conch' && !st.friend ? 'Befriend a dolphin first' : null; },
    diveMods(m) { if (boostOn) m.swim *= BOOST; },
    debug,
    dispose() {
      disposed = true; ui?.destroy(); ui = null;
      if (wildMesh) wildMesh = null;
      if (!built) return;
      mesh.removeFromParent(); mesh.geometry.dispose(); mat.dispose();
      for (const h of hearts) h.removeFromParent();
      hearts[0].geometry.dispose(); heartMat.dispose();
      if (tag) { tag.removeFromParent(); tag.material.dispose(); tagTex.dispose(); }
      built = false; mesh = null; tag = null;
    },
  };
}
