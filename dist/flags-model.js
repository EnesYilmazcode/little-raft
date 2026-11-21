// Raft flag models: one shared merged pole (vertex colours), one shared cloth plane, a shader-waved cloth
// material factory, and the flag canvas painter. See docs/specs/raft-flag.md section 4.
// Imports only the pure flags-core.js data (palette + emblem paths), so the painter has one source of art.
// Local origin = tile top centre (the game places it at y = .22); the model faces +Z; the cloth runs along +X
// from the hoist and its pivot yaws downwind like the Wind Pennant's swing.
// Shared geometry/material dispose() calls are no-ops so game.js rebuildRaft() cannot free them; dispose() below frees them.
import { PALETTE, PATTERNS, EMBLEMS, EMBLEM_PATHS } from './flags-core.js?build=v3-survival-ae77fa84ac2b';

// Cloth wave, injected after <begin_vertex>. Hoist (x=0) stays pinned; the per-pole phase comes from the
// model matrix so no per-pole uniform is needed. Weak wind droops the fly end.
const WAVE = `#include <begin_vertex>
float fu = clamp(position.x / 1.2, 0.0, 1.0);
vec3 fo = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float fph = fo.x * 0.7 + fo.z * 1.3;
float famp = 0.04 + 0.14 * uStr * uStr;
transformed.z += famp * fu * sin(7.0 * fu - uTime * (4.0 + 5.0 * uStr) + fph);
transformed.y -= 0.06 * fu * fu * (1.2 - uStr);
`;

/**
 * Paint a flag design with the canvas 2D API only (+ a Path2D constructor), so it is testable with fakes.
 * Canvas x = 0 is the hoist (pole side). d = [bg, pat, patCol, emb, embCol] (already cleaned).
 */
export function paintFlag(g, d, w = 128, h = 64, P2D = globalThis.Path2D) {
  const [bg, pat, pc, emb, ec] = d;
  const u = h / 64;
  g.globalAlpha = 1;
  g.fillStyle = PALETTE[bg] ?? PALETTE[1];
  g.fillRect(0, 0, w, h);
  g.fillStyle = PALETTE[pc] ?? PALETTE[5];
  switch (PATTERNS[pat]) {
    case 'stripes': { const b = h / 5; g.fillRect(0, b, w, b); g.fillRect(0, 3 * b, w, b); break; }
    case 'halves': g.fillRect(0, 0, w / 2, h); break;
    case 'cross': { const t = 10 * u; g.fillRect(0, (h - t) / 2, w, t); g.fillRect((w - t) / 2, 0, t, h); break; }
    case 'border': { const t = 6 * u; g.fillRect(0, 0, w, t); g.fillRect(0, h - t, w, t); g.fillRect(0, t, t, h - 2 * t); g.fillRect(w - t, t, t, h - 2 * t); break; }
    case 'diagonal': g.beginPath(); g.moveTo(0, h); g.lineTo(w, 0); g.lineTo(w, h); g.closePath(); g.fill(); break;
    default: break; // plain
  }
  const path = emb > 0 ? EMBLEM_PATHS[EMBLEMS[emb]] : null;
  if (path && typeof P2D === 'function') {
    const k = .75 * h / 64;
    g.save();
    g.translate((w - 64 * k) / 2, (h - 64 * k) / 2);
    g.scale(k, k);
    g.fillStyle = PALETTE[ec] ?? PALETTE[5];
    g.fill(new P2D(path));
    g.restore();
  }
  // hem at the hoist: a thin darker line where the cloth wraps the halyard
  g.globalAlpha = .28; g.fillStyle = '#153e49'; g.fillRect(0, 0, Math.max(1, u), h); g.globalAlpha = 1;
}

export function buildFlagModel(T) {
  const noop = () => {};
  const realGeo = T.BufferGeometry.prototype.dispose, realMat = T.Material.prototype.dispose;
  const shared = x => { x.dispose = noop; x.userData.shared = true; return x; };
  const uniforms = { uTime: { value: 0 }, uStr: { value: .3 } };

  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), p = new T.Vector3(), sc = new T.Vector3();
  let seed = 29;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function add(parts, geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    e.set(rx, ry, rz); q.setFromEuler(e); p.set(x, y, z); sc.set(1, 1, 1); m4.compose(p, q, sc); g.applyMatrix4(m4);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new T.Color(hex).multiplyScalar(1 + (rnd() - .5) * .1);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  }
  function merge(parts) {
    let total = 0; for (const g of parts) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
      o += g.attributes.position.count; g.dispose();
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return geo;
  }

  // ---- pole (taller and stouter than the 2.4 m pennant, with a plinth, cleat and halyard)
  const parts = [];
  add(parts, new T.BoxGeometry(.4, .08, .4), 0x6b4c30, 0, .04, 0);
  for (const [x, z] of [[-.16, -.16], [.16, -.16], [-.16, .16], [.16, .16]]) add(parts, new T.CylinderGeometry(.025, .025, .05, 6), 0x4e3620, x, .1, z);
  add(parts, new T.CylinderGeometry(.035, .05, 3.3, 8), 0x8a6a45, 0, 1.73, 0);
  add(parts, new T.IcosahedronGeometry(.07, 1), 0xd9b25a, 0, 3.42, 0);
  add(parts, new T.BoxGeometry(.12, .03, .03), 0x6b4c30, 0, .9, .05);
  add(parts, new T.BoxGeometry(.012, 2.4, .012), 0xeadcae, .045, 2.1, 0);
  const poleGeo = shared(merge(parts));
  const poleMat = shared(new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0 })); poleMat.name = 'flagPole';

  // ---- cloth: x 0..1.2 from the hoist, top edge at y 0 (hangs from the pivot at the masthead)
  const clothGeo = shared(new T.PlaneGeometry(1.2, .6, 12, 4).translate(.6, -.3, 0));

  function waveMaterial(map) {
    const mat = new T.MeshLambertMaterial({ map: map ?? null, side: T.DoubleSide });
    mat.name = 'flagCloth';
    if (map) { mat.emissive.set(0xffffff); mat.emissiveMap = map; mat.emissiveIntensity = .2; } // the lee side stays readable
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uStr = uniforms.uStr;
      sh.vertexShader = 'uniform float uTime; uniform float uStr;\n' + sh.vertexShader.replace('#include <begin_vertex>', WAVE);
    };
    mat.customProgramCacheKey = () => 'raftFlagWave';
    return mat;
  }

  let instances = 0;
  return {
    uniforms, clothGeo, waveMaterial,
    instance() {
      const g = new T.Group(); g.name = 'decor_flagpole'; g.userData.decorType = 'flagpole';
      const pole = new T.Mesh(poleGeo, poleMat); pole.castShadow = true; pole.receiveShadow = true; pole.name = 'pole';
      const pivot = new T.Group(); pivot.name = 'flagPivot'; pivot.position.set(0, 3.3, 0);
      const cloth = new T.Mesh(clothGeo, poleMat); cloth.name = 'cloth'; cloth.castShadow = false; cloth.receiveShadow = true;
      cloth.position.x = .05; // just off the mast, on the halyard
      pivot.add(cloth); g.add(pole, pivot);
      g.userData.pivot = pivot; g.userData.cloth = cloth;
      instances++;
      return g;
    },
    stats() { return { instances, poleVerts: poleGeo.attributes.position.count, clothVerts: clothGeo.attributes.position.count }; },
    dispose() {
      realGeo.call(poleGeo); realGeo.call(clothGeo); realMat.call(poleMat); // cloth materials belong to flags.js' texture cache
    },
  };
}
