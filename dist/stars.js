// Shooting-star nights ("Wishing Nights", docs/specs/stars.md). On about one clear night in three a gentle meteor
// shower crosses the sky; look at a falling star and press E for a small cozy gift. The sky is a pure function of
// the daynight {seed, clock}, so every peer draws the same meteors. Only the wish goes through the host
// (world.ext.stars). No fail state: refused wishes are silent and nothing is ever lost.
import { DAY_SECONDS } from './daynight.js?build=v3-survival-ae77fa84ac2b';
import {
  SHOWER, NOTICE_PHASE, isShowerNight, nextShowerIn, makeAlive, headDir, aliveAt, meteorAt, makeMeteor, lastSlot,
  giftFor, checkWish, cleanStars, defaultStars, serializeStars, copyStars,
} from './stars-core.js?build=v3-survival-ae77fa84ac2b';
import { createMeteorMesh } from './stars-model.js?build=v3-survival-ae77fa84ac2b';
import { ITEM_INFO } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';

export const AIM_DEG = 5, REACH = 4, PENDING_S = 3, FLASH_S = 0.3;
const NOTICE = 'The sky feels sparkly tonight. Stay up and look for falling stars!';
const COS_AIM = Math.cos(AIM_DEG * Math.PI / 180);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isInt = v => Number.isInteger(v);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createStars(ctx, peer = () => null) {
  const T = ctx.T;
  let st = defaultStars();
  let hostV1 = false;              // guest: the host sent a v:1 stars slice (old hosts never do)
  let ser = null, serDirty = true;
  const force = new Set();         // QA: forced shower nights (host, in memory only)
  const alive = makeAlive();
  const head = { x: 0, y: 1, z: 0 };
  let kit = null, kitScene = null, v3 = null;
  // per-slot flare keyed by k for the current day; local press flash and pending wishes
  const flare = new Float32Array(SHOWER.SLOTS), flash = new Float32Array(SHOWER.SLOTS), pendAt = new Float64Array(SHOWER.SLOTS).fill(-1);
  let flareDay = -1, aimK = -1, aimDay = -1, time = 0;
  let prevClock = NaN, lastNoticeDay = -1, lastSeed = NaN, lastClock = NaN, fadeLine = -1;

  const me = () => (ctx.role === 'guest' ? 'guest' : 'host');
  const host = () => ctx.role !== 'guest';
  const dn = () => { const d = peer('daynight'); return d && Number.isFinite(d.clock) && Number.isFinite(d.seed) ? d : null; };
  const ready = () => host() || hostV1;
  const tonight = (day) => (st.night.day === day ? st.night[me()] : null);
  const madeTonight = day => tonight(day)?.length ?? 0;

  function hide() { if (kit) kit.mesh.visible = false; aimK = -1; }
  function attach() {
    const scene = ctx.scene; if (!T || !scene) return null;
    if (!kit) { kit = createMeteorMesh(T); v3 = new T.Vector3(); }
    if (kitScene !== scene) { kitScene?.remove(kit.mesh); scene.add(kit.mesh); kitScene = scene; }
    return kit;
  }
  function underwater(cam) { const oc = ctx.ocean; return !!(cam && typeof oc?.getHeight === 'function' && cam.position.y < oc.getHeight(cam.position.x, cam.position.z) - 0.05); }
  function aimDir() {
    const d = ctx.aim?.()?.dir;
    if (d && Number.isFinite(d.x)) return d;
    const cam = ctx.camera; if (!cam || !v3) return null;
    return cam.getWorldDirection(v3);
  }

  function update(dt) {
    time += dt > 0 && dt < 1 ? dt : 0;
    const d = dn();
    if (!d) { hide(); prevClock = NaN; return; }
    const clock = d.clock, seed = d.seed, day = Math.floor(clock / DAY_SECONDS);
    lastSeed = seed; lastClock = clock;
    if (day !== flareDay) { flare.fill(0); flash.fill(0); pendAt.fill(-1); flareDay = day; }
    // dusk notice: only a live crossing of .64 (no replay on load / sleep / clock jumps)
    const ph = clock / DAY_SECONDS - day, prevPh = prevClock / DAY_SECONDS - day;
    if (Number.isFinite(prevClock) && clock > prevClock && clock - prevClock < 3 && prevPh < NOTICE_PHASE && ph >= NOTICE_PHASE
      && lastNoticeDay !== day && isShowerNight(seed, day, force)) { lastNoticeDay = day; ctx.notice?.(NOTICE, 6000); }
    prevClock = clock;
    for (let k = 0; k < SHOWER.SLOTS; k++) {
      if (flash[k] > 0) flash[k] = Math.max(0, flash[k] - dt);
      if (pendAt[k] >= 0 && (time - pendAt[k] > PENDING_S || tonight(day)?.includes(k))) pendAt[k] = -1;
    }
    const cam = ctx.camera, sky = Number.isFinite(d.skyA) ? d.skyA : 0;
    aliveAt(seed, clock, alive, force);
    if (!alive.n || sky < 0.01 || underwater(cam) || !attach()) { hide(); return; }
    const U = kit.uniforms, dir = aimDir();
    const z = ctx.content?.zoom?.() || 1, cosAim = Math.cos(AIM_DEG / z * Math.PI / 180);
    let best = -1, bestDot = -2;
    for (let i = 0; i < 3; i++) {
      if (i >= alive.n) { U.uT.value[i].set(-1, 0, 0, 0); continue; }
      const m = alive.m[i], u = headDir(m, clock, head);
      U.uA.value[i].set(m.a.x, m.a.y, m.a.z); U.uB.value[i].set(m.b.x, m.b.y, m.b.z);
      const dot = dir ? dir.x * head.x + dir.y * head.y + dir.z * head.z : -2;
      if (sky > 0.15 && dot > cosAim && dot > bestDot) { best = i; bestDot = dot; }
      const fade = smooth(0, 0.12, u) * (1 - smooth(0.8, 1, u)) * (0.75 + 0.25 * smooth(0.12, 0.4, u));
      const k = m.k;
      U.uT.value[i].set(u, Math.max(fade, flash[k] > 0 ? 1 : 0), m.tint, flash[k] > 0 ? 3 : flare[k]);
    }
    for (let i = 0; i < alive.n; i++) { const k = alive.m[i].k, want = i === best ? 1 : 0; flare[k] += (want - flare[k]) * Math.min(1, dt * 10); }
    aimK = best >= 0 ? alive.m[best].k : -1; aimDay = day;
    U.uSky.value = sky; U.uPx.value = ctx.renderer?.getPixelRatio?.() ?? 1;
    kit.mesh.position.copy(cam.position);
    kit.mesh.visible = true;
  }

  // E is ours only while a meteor is aimed, nothing is in reach and the host speaks stars v1
  function nearTarget(aim) {
    if (!aim) return false;
    if (aim.item) return true;
    const p = aim.point, ph = ctx.physics;
    return !!(p && ph && Number.isFinite(p.x) && Math.hypot(p.x - ph.x, p.z - ph.z) < REACH);
  }
  function canWish(aim) {
    if (aimK < 0 || !ready() || ctx.uiOpen?.() || nearTarget(aim ?? ctx.aim?.())) return false;
    return true;
  }
  function prompt(aim) {
    if (!canWish(aim)) return null;
    if (pendAt[aimK] >= 0 || tonight(aimDay)?.includes(aimK)) return null;
    if (madeTonight(aimDay) >= SHOWER.CAP) return 'Five wishes tonight. Just enjoy the sky';
    return '<kbd>E</kbd>Make a wish';
  }
  function interact(aim) {
    if (!canWish(aim)) return false;
    const k = aimK, day = aimDay;
    if (pendAt[k] >= 0 || tonight(day)?.includes(k) || madeTonight(day) >= SHOWER.CAP) return false;
    pendAt[k] = time; flash[k] = FLASH_S;
    ctx.play?.('twinkle');
    ctx.action({ kind: 'stars.wish', day, k });
    return true;
  }

  // ---- host
  function action(a, actor, bag) {
    if (!a || a.kind !== 'stars.wish') return false;
    if (!host()) return true;
    const d = dn(); if (!d) return true;
    if (actor !== 'host' && actor !== 'guest') return true;
    const r = checkWish(st, actor, d.seed, d.clock, a, force);
    serDirty = true; // checkWish may have started a new night
    if (!r.ok) return true;
    const gift = giftFor(d.seed, a.day, a.k, actor);
    const b = ctx.actorBag?.(actor) ?? bag;
    if (!b || typeof b.add !== 'function') return true;
    if (b.add(gift, 1) !== 0) { ctx.emit?.({ kind: 'notice', text: 'Your bag is full; the star waits for you.' }, actor); return true; }
    st.night[actor].push(a.k);
    st.wishes[actor] = Math.min(1e6, st.wishes[actor] + 1);
    serDirty = true;
    const name = ITEM_INFO[gift]?.name ?? gift;
    ctx.emit?.({ kind: 'loot', text: `A wish came true: + 1 ${name}`, loot: { [gift]: 1 }, sound: 'twinkle', wish: 1 }, actor);
    ctx.award?.({ kind: 'wish', n: st.wishes[actor] });
    ctx.observe?.({ kind: 'wish' }, actor);
    const n = st.night[actor].length;
    if ((n >= SHOWER.CAP || a.k === lastSlot(d.seed, a.day)) && fadeLine !== a.day * 2 + (actor === 'guest' ? 1 : 0)) {
      fadeLine = a.day * 2 + (actor === 'guest' ? 1 : 0);
      ctx.emit?.({ kind: 'notice', text: `The shower fades. ${n} wish${n === 1 ? '' : 'es'} tonight.` }, actor);
    }
    return true;
  }
  // a wish's loot effect: a feed line before the item row (the generic path then adds "+1 <item>" and the sound)
  function effect(e) {
    if (e && e.kind === 'loot' && e.wish) ctx.notice?.('A wish came true!');
    return false;
  }

  // ---- save / net
  function serialize() {
    if (serDirty || !ser) { ser = serializeStars(st); serDirty = false; }
    return ser;
  }
  function sameAsRaw(d) { // allocation-free check of a raw net slice against the current state
    const w = d.wishes, n = d.night;
    if (!w || !n || w.host !== st.wishes.host || w.guest !== st.wishes.guest || n.day !== st.night.day) return false;
    for (const who of ['host', 'guest']) {
      const a = n[who], b = st.night[who];
      if (!Array.isArray(a) || a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    }
    return true;
  }
  function load(data, from) {
    if (from === 'net') {
      hostV1 = !!(data && typeof data === 'object' && data.v === 1);
      if (!hostV1 || sameAsRaw(data)) return;
      if (copyStars(st, cleanStars(data))) serDirty = true;
      return;
    }
    st = cleanStars(data); serDirty = true;
  }

  // ---- logbook tab ("Night Sky")
  let viewSig = '', viewOut = null, nextDay = NaN, nextSeed = NaN, nextIn = -1;
  function view() {
    const d = dn();
    const mine = st.wishes[me()];
    let day = -1, on = false, inDays = -1;
    if (d) {
      day = Math.floor(d.clock / DAY_SECONDS);
      on = isShowerNight(d.seed, day, force);
      if (!on) {
        if (day !== nextDay || d.seed !== nextSeed) { nextDay = day; nextSeed = d.seed; nextIn = nextShowerIn(d.seed, day, 10, force); }
        inDays = nextIn;
      }
    }
    const made = day >= 0 ? madeTonight(day) : 0;
    const sig = `${mine}|${day}|${on ? 1 : 0}|${inDays}|${made}`;
    if (sig === viewSig && viewOut) return viewOut;
    viewSig = sig;
    const tonightLine = !d ? 'The sky is resting.' : on ? 'Tonight: a shower is falling ✦' : inDays > 0 ? `Tonight: a quiet sky · next shower in ${inDays} day${inDays === 1 ? '' : 's'}` : 'Tonight: a quiet sky';
    const dots = Array.from({ length: SHOWER.CAP }, (_, i) => `<i class="ns-dot${i < made ? ' ns-on' : ''}"></i>`).join('');
    const html = `<style>.ns{display:flex;flex-direction:column;gap:10px}.ns-card{padding:10px 12px;background:linear-gradient(180deg,#26304ae8,#161c30e8);border-radius:4px;box-shadow:inset 0 0 0 1px #9fb4ff44;color:#eef2ff}`
      + `.ns-card b{display:block;font-size:22px;line-height:1.2}.ns-card span{font-size:13px;color:#c9d3f5}.ns-dots{display:flex;gap:6px;margin-top:6px}`
      + `.ns-dot{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1px #c9d3f588}.ns-dot.ns-on{background:#ffe9a8;box-shadow:0 0 6px #ffe9a8}.ns-tip{margin:0;font-size:13px;color:#e8d3a8}</style>`
      + `<div class="ns"><div class="ns-card"><span>Wishes made</span><b>${mine}</b></div>`
      + `<div class="ns-card"><span>${esc(tonightLine)}</span>${on ? `<div class="ns-dots" aria-label="${made} of ${SHOWER.CAP} wishes tonight">${dots}</div><span>${made}/${SHOWER.CAP} wishes tonight</span>` : ''}</div>`
      + `<p class="ns-tip">On a sparkly night, look up and press E when a falling star is under your crosshair. Each wish brings a small gift.</p></div>`;
    viewOut = { sig, html, badge: `✦${mine}` };
    return viewOut;
  }
  const tab = { id: 'stars', label: 'Night Sky', view };
  function logbookTabs(out) { out.push(tab); }

  function dispose() {
    if (kit) { kitScene?.remove(kit.mesh); kit.dispose(); kit = null; kitScene = null; }
  }

  const debug = {
    state() {
      const d = dn(); const day = d ? Math.floor(d.clock / DAY_SECONDS) : null;
      const ks = []; for (let i = 0; i < alive.n; i++) ks.push(alive.m[i].k);
      return { slice: serializeStars(st), night: d ? isShowerNight(d.seed, day, force) : false, day, alive: ks, aimed: aimK, visible: !!kit?.mesh.visible, hostV1, ready: ready() };
    },
    forceNight(day) { if (!host()) return false; const d = dn(); const v = day ?? (d ? Math.floor(d.clock / DAY_SECONDS) : null); if (!isInt(v)) return false; force.add(v); viewSig = ''; return true; },
    unforce() { force.clear(); viewSig = ''; return true; },
    // the next alive meteor k at the current clock (or -1)
    next() { const d = dn(); if (!d) return -1; const day = Math.floor(d.clock / DAY_SECONDS), m = makeMeteor(); for (let k = 0; k < SHOWER.SLOTS; k++) { meteorAt(d.seed, day, k, m); if (m.ok && m.t0 + m.life > d.clock) return k; } return -1; },
    meteor(k) { const d = dn(); if (!d) return null; const m = meteorAt(d.seed, Math.floor(d.clock / DAY_SECONDS), k); return m.ok ? m : null; },
    // point the camera at meteor k's head at u (0..1) of its life (uses raftDebug.aim)
    aimAt(k, u = 0.5) {
      const d = dn(); if (!d) return null;
      const m = meteorAt(d.seed, Math.floor(d.clock / DAY_SECONDS), k); if (!m.ok) return null;
      headDir(m, m.t0 + m.life * u, head);
      const pitch = Math.asin(head.y), yaw = Math.atan2(-head.x, -head.z);
      try { globalThis.raftDebug?.aim?.(pitch, yaw); } catch {}
      return { pitch, yaw, t: m.t0 + m.life * u };
    },
    wish(k) { const d = dn(); if (!d || !isInt(k)) return false; const day = Math.floor(d.clock / DAY_SECONDS); pendAt[k] = time; flash[k] = FLASH_S; ctx.play?.('twinkle'); ctx.action({ kind: 'stars.wish', day, k }); return true; },
    seed: () => lastSeed, clock: () => lastClock,
  };

  return { name: 'stars', update, serialize, load, action, effect, interact, prompt, logbookTabs, dispose, debug };
}
