// Injected into the REAL game (dist/) before it loads (Playwright add_init_script, or paste in devtools).
// It does not modify dist files. It:
//  - wraps requestAnimationFrame so every frame callback is timed (total JS+render ms),
//  - captures the game's WebGLRenderer/scene/camera through Scene.onBeforeRender once three is loaded,
//  - wraps renderer.render so the render part is timed (with gl.finish() so GPU time is inside it) and
//    renderer.info is read INCLUDING the shadow pass (three resets info after shadowMap.render, so the stock
//    numbers hide shadow draw calls).
// window.__perf.measure(n) -> {frameMs, renderMs, logicMs, calls, callsMain, triangles, ...}
(() => {
  // Deterministic world: the game spawns floating items with Math.random. Seed it so every scenario sees the same sea.
  // three's generateUUID also calls Math.random (once per object/material/geometry), so a build that creates a
  // different number of objects (e.g. merged meshes) would shift the sequence: uuids get their own stream.
  if (!/[?&]noseed\b/.test(location.search)) {
    const mk = a => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const game = mk(12345), other = mk(999);
    Math.random = () => (/generateUUID/.test(new Error().stack) ? other() : game());
  }
  const px = new Uint8Array(4);
  const P = window.__perf = { frames: [], recording: false, finish: true, R: null, frame: 0 };
  const raf = window.requestAnimationFrame.bind(window);
  // Deterministic clock: the game reads performance.now() for dt, so it sees exactly 1/60 s per frame, and time stops
  // window.__perfFreezeAt frames after __perf.startClock() (called by shoot.py right after clicking Play; before that
  // time stands at 0). Every scenario then measures and screenshots the SAME scene state. The renderer still redraws
  // everything each frame, so frozen frames cost the same as live ones.
  const realNow = performance.now.bind(performance);
  let clock0 = null;
  P.startClock = () => { clock0 = P.frame; };
  if (window.__perfFreezeAt !== undefined) performance.now = () => (clock0 === null ? 0 : Math.min(P.frame - clock0, window.__perfFreezeAt) * 1000 / 60);
  let lastT = -1;
  window.requestAnimationFrame = cb => raf(t => {
    if (t !== lastT) { lastT = t; P.frame++; }
    if (!P.recording) return cb(t);
    const t0 = realNow(); P.cur = { render: 0, draws: 0, shadowDraws: 0, by: {} }; P.R?.renderer.info.reset();
    cb(t);
    const f = P.cur; f.total = realNow() - t0; f.t = t; P.frames.push(f); P.cur = null;
  });

  // Owner of a drawn object: the scene child (or camera child) it hangs under, by name where it has one.
  const ownerCache = new WeakMap();
  function owner(o) {
    let k = ownerCache.get(o); if (k) return k;
    const { scene, camera } = P.R; let p = o, path = [];
    while (p && p.parent && p.parent !== scene && p.parent !== camera) { path.push(p); p = p.parent; }
    const top = p;
    if (p?.parent === camera) k = 'viewmodels';
    else if (top === P.raft) k = 'raft:' + ((path.at(-1) ?? o).name || (path.at(-1) ?? o).type);
    else k = top?.name || (P.labels?.get(top)) || (top?.isMesh ? 'mesh:' + top.geometry.type : (top?.type || '?') + '#' + scene.children.indexOf(top));
    ownerCache.set(o, k); return k;
  }
  function wrap(r, scene, camera) {
    if (P.R) return;
    P.R = { renderer: r, scene, camera, gl: r.getContext() };
    const orig = r.render, rbd = r.renderBufferDirect;
    r.info.autoReset = false;
    // Every draw (main pass, shadow pass, extra passes such as diving's overlay) goes through renderBufferDirect.
    // Count them here per owner and pass; three's info counter is also read, reset at the start of each frame.
    r.renderBufferDirect = function (cam, sc, geo, mat, obj, group) {
      if (P.cur) {
        const pass = sc ? (sc === P.R.scene ? 'main' : 'extra') : 'shadow', k = owner(obj);
        P.cur.draws++; const e = P.cur.by[k] ??= { main: 0, shadow: 0, extra: 0 }; e[pass]++;
        if (pass === 'shadow') P.cur.shadowDraws++;
      }
      return rbd.call(this, cam, sc, geo, mat, obj, group);
    };
    r.render = function (s, c) {
      const t0 = realNow();
      orig.call(r, s, c);
      if (P.cur) P.cur.submit = (P.cur.submit || 0) + realNow() - t0; // JS + WebGL command encoding only
      if (P.recording && P.finish) { const gl = P.R.gl; gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } // 1px readback blocks until the GPU (SwiftShader) is done
      const dt = realNow() - t0;
      if (P.cur) { P.cur.render += dt; P.cur.calls = r.info.render.calls; P.cur.triangles = r.info.render.triangles; }
    };
    // main-pass-only numbers, as stock renderer.info would show
    P.mainOnly = () => { const sm = r.shadowMap.enabled; r.shadowMap.enabled = false; r.info.reset(); orig.call(r, scene, camera); const c = r.info.render.calls, t = r.info.render.triangles; r.shadowMap.enabled = sm; return { calls: c, triangles: t }; };
  }
  P.install = async (url = new URL('vendor/three.module.js', document.baseURI).href) => {
    const T = P.T = await import(url);
    const prev = T.Scene.prototype.onBeforeRender;
    T.Scene.prototype.onBeforeRender = function (r, s, c) { wrap(r, s, c); };
    await new Promise(res => { const w = () => (P.R ? res() : raf(w)); w(); });
    T.Scene.prototype.onBeforeRender = prev;
    return true;
  };

  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
  const avg = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
  P.measure = (n = 90, warm = 10) => new Promise(res => {
    P.frames = []; P.recording = true;
    const h0 = performance.memory?.usedJSHeapSize ?? 0;
    const tick = () => {
      if (P.frames.length < n + warm) return raf(tick);
      P.recording = false;
      const f = P.frames.slice(warm), r = P.R.renderer, info = r.info;
      const gaps = f.slice(1).map((x, i) => x.t - f[i].t);
      res({
        frames: f.length,
        frameMs: avg(f.map(x => x.total)), frameP95: q(f.map(x => x.total), 0.95), frameWorst: +Math.max(...f.map(x => x.total)).toFixed(2),
        renderMs: avg(f.map(x => x.render)), submitMs: q(f.map(x => x.submit || 0), 0.5), submitMin: +Math.min(...f.map(x => x.submit || 0)).toFixed(2), logicMs: avg(f.map(x => x.total - x.render)), logicP95: q(f.map(x => x.total - x.render), 0.95),
        rafGapMs: avg(gaps),
        calls: Math.round(avg(f.map(x => x.calls ?? 0))), draws: Math.round(avg(f.map(x => x.draws))), shadowDraws: Math.round(avg(f.map(x => x.shadowDraws))),
        byOwner: Object.fromEntries(Object.entries(f.at(-1).by).sort((a, b) => (b[1].main + b[1].shadow + b[1].extra) - (a[1].main + a[1].shadow + a[1].extra))),
        triangles: Math.round(avg(f.map(x => x.triangles ?? 0))),
        geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs.length,
        pixelRatio: r.getPixelRatio(), drawingBuffer: [r.domElement.width, r.domElement.height],
        heapDeltaKB: Math.round(((performance.memory?.usedJSHeapSize ?? 0) - h0) / 1024),
        shadow: r.shadowMap.enabled ? (r.shadowMap.autoUpdate ? 'every frame' : 'manual') : 'off',
      });
    };
    raf(tick);
  });

  // What is in the scene: draw-relevant objects grouped by the scene child that owns them.
  P.census = () => {
    const { scene, camera } = P.R, out = {}, mats = new Set(), geos = new Set(), tex = new Set();
    let meshes = 0, casters = 0, verts = 0;
    const label = o => o === camera ? 'camera(viewmodels)' : o.name || (o.isMesh ? o.geometry.type : o.type + '#' + scene.children.indexOf(o));
    for (const top of scene.children) {
      let n = 0, c = 0, v = 0; const tm = new Set();
      top.traverseVisible(o => {
        if (!(o.isMesh || o.isLine || o.isPoints)) return;
        n++; if (o.castShadow) c++;
        const vv = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count; v += vv;
        for (const m of [].concat(o.material)) { mats.add(m); tm.add(m); for (const k in m) if (m[k]?.isTexture) tex.add(m[k]); }
        geos.add(o.geometry);
      });
      if (!n) continue;
      let key = label(top);
      if (top.isGroup && !top.name) {
        const ch = top.children;
        if (ch.some(x => x.name === 'raft-floor' || x.name === 'raft-deck')) key = 'raft (deck tiles + decor)';
        else if (top === P.itemsGroup || ch.some(x => /^debris|plastic/i.test(x.name) || x.children?.some(y => /debris|jug|plastic/i.test(y.name)))) key = 'floating items';
        else if (ch.length === 3 && ch.every(x => x.isMesh && x.geometry.type === 'IcosahedronGeometry')) key = 'clouds';
        else if (ch.some(x => x.isGroup) && ch.some(x => x.geometry?.type === 'CylinderGeometry')) key = 'islands';
        else key = 'group';
      }
      const e = out[key] ??= { objects: 0, meshes: 0, casters: 0, verts: 0, materials: 0 };
      e.objects++; e.meshes += n; e.casters += c; e.verts += v; e.materials = Math.max(e.materials, tm.size);
      meshes += n; casters += c; verts += v;
    }
    return { meshes, casters, verts, materials: mats.size, geometries: geos.size, textures: tex.size, byOwner: out };
  };
  // Name the unnamed top-level groups the game builds so draw counts read by owner.
  P.label = () => {
    const { scene } = P.R, L = P.labels = new Map(); let ni = 0, nc = 0;
    for (const o of scene.children) {
      if (o.name) continue;
      if (o.getObjectByName('raft-floors')) { P.raft = o; L.set(o, 'raft'); continue; }
      if (o.isGroup && o.children.some(c => c.userData?.token)) { L.set(o, 'floating items'); continue; }
      if (o.isGroup && o.children.length && o.children.every(c => c.isMesh && !c.matrixAutoUpdate)) { L.set(o, o.position.y > 10 ? 'clouds (24, baked)' : 'old islands (12, baked)'); continue; }
      if (o.getObjectByName('SeafloorPatch')) { L.set(o, 'seafloor'); continue; }
      if (o.isGroup && o.children.length === 0) continue;
      const names = []; o.traverse(c => { if (c.name && names.length < 2) names.push(c.name); });
      L.set(o, (o.isLight ? 'light' : o.type) + (names.length ? ':' + names.join('/') : ''));
    }
    return [...scene.children].map(o => o.name || L.get(o) || o.type);
  };
  P.setFinish = v => { P.finish = v; };
  // Run the frozen clock for n more frames (setup steps such as diving need game time), then freeze again.
  P.advance = n => { window.__perfFreezeAt = (P.frame - clock0) + n; return new Promise(res => { const w = () => (P.frozen() ? res(P.frame) : raf(w)); w(); }); };
  P.frozen = () => window.__perfFreezeAt !== undefined && clock0 !== null && P.frame - clock0 >= window.__perfFreezeAt;
})();
