// Bloatfish model + particle material (THREE passed in as T, never imported).
// createBloatfishGeometry(T): one merged, vertex-coloured BufferGeometry (body, spines, fins, eyes, lips),
// facing +Z, about 0.64 m long at rest. createPufferPoints(T, n): pooled soft-sprite points (bubbles and
// poison puffs) in one draw call, sized in metres, with scene fog.
import { mergeGeometries } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';

const R = 0.32;

function paint(T, g, fn) {
  g.deleteAttribute('uv');
  const pos = g.attributes.position, n = g.attributes.normal, col = new Float32Array(pos.count * 3), c = new T.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(c, pos.getX(i), pos.getY(i), pos.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new T.BufferAttribute(col, 3));
  return g;
}
const flat = (hex) => (c) => c.set(hex);

export function createBloatfishGeometry(T) {
  const parts = [];
  const back = new T.Color('#b7a24e'), belly = new T.Color('#f1e7c6'), spot = new T.Color('#5d5426'), band = new T.Color('#e0b84c');
  // Body: olive-gold back with dark freckles, a warm yellow band, pale belly. Slightly egg-shaped.
  const body = new T.SphereGeometry(R, 18, 12); body.scale(0.92, 0.86, 1);
  paint(T, body, (c, x, y, z, nx, ny, nz) => {
    const k = Math.min(1, Math.max(0, (ny + 0.15) * 1.6));
    c.copy(belly).lerp(back, k);
    if (Math.abs(ny + 0.05) < 0.12) c.lerp(band, 0.55);
    const s = Math.sin(nx * 23.1 + nz * 7.3) * Math.sin(ny * 19.7 - nz * 13.9) * Math.sin(nx * 5.1 - ny * 11.3 + nz * 17.7);
    if (ny > -0.05 && s > 0.18) c.lerp(spot, 0.8);
  });
  parts.push(body);
  // Spines on a Fibonacci sphere, skipping the face and the tail root.
  const up = new T.Vector3(0, 1, 0), dir = new T.Vector3(), q = new T.Quaternion();
  const N = 46;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) * 2 / N, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    dir.set(Math.cos(a) * r, y, Math.sin(a) * r);
    if (dir.z > 0.72 || dir.z < -0.85) continue;
    const sp = new T.ConeGeometry(0.022, 0.1, 4); sp.translate(0, 0.05, 0);
    q.setFromUnitVectors(up, dir); sp.applyQuaternion(q);
    sp.translate(dir.x * R * 0.9, dir.y * R * 0.84, dir.z * R * 0.97);
    paint(T, sp, (c, x, y2, z) => { const t = Math.hypot(x, y2, z) - R * 0.88; c.set(t > 0.06 ? '#f4eed8' : '#6e5f2c'); });
    parts.push(sp);
  }
  // Tail fan and the little side fins: soft orange.
  const tail = new T.ConeGeometry(0.15, 0.2, 6); tail.scale(1, 1, 0.22); tail.rotateX(-Math.PI / 2); tail.rotateZ(Math.PI / 2); tail.translate(0, 0.01, -R - 0.08);
  parts.push(paint(T, tail, flat('#e2893b')));
  for (const s of [-1, 1]) {
    const fin = new T.SphereGeometry(0.075, 8, 6); fin.scale(0.25, 0.8, 1.3); fin.rotateY(s * 0.5); fin.translate(s * R * 0.9, -0.03, 0.06);
    parts.push(paint(T, fin, flat('#e89a48')));
    const top = new T.SphereGeometry(0.06, 6, 5); top.scale(0.2, 0.9, 1.4); top.translate(0, R * 0.86, -0.15);
    if (s > 0) parts.push(paint(T, top, flat('#d47a33')));
    // Big round eyes high on the head, dark pupils looking forward.
    const eye = new T.SphereGeometry(0.068, 10, 8); eye.translate(s * 0.15, 0.1, R * 0.8);
    parts.push(paint(T, eye, flat('#fbf8ee')));
    const pupil = new T.SphereGeometry(0.038, 8, 6); pupil.translate(s * 0.165, 0.11, R * 0.8 + 0.042);
    parts.push(paint(T, pupil, flat('#14110c')));
  }
  // Pouty lips.
  const lips = new T.TorusGeometry(0.045, 0.02, 6, 10); lips.translate(0, -0.06, R * 0.98);
  parts.push(paint(T, lips, flat('#c86a52')));
  const g = mergeGeometries(T, parts);
  for (const p of parts) p.dispose();
  return g;
}

const VS = `attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor; varying float vRing;
#include <fog_pars_vertex>
void main(){
  vColor = aColor; vRing = aSize < 0.25 ? 1.0 : 0.0;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize > 0.0 ? clamp(aSize * uScale / max(-mvPosition.z, 0.05), 1.0, 512.0) : 0.0;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = `varying vec4 vColor; varying float vRing;
#include <fog_pars_fragment>
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p);
  if (d > 1.0) discard;
  float soft = (1.0 - d) * (1.0 - d);
  float ring = smoothstep(0.45, 0.8, d) * (1.0 - smoothstep(0.85, 1.0, d)) + 0.6 * smoothstep(0.2, 0.0, length(p - vec2(-0.35, 0.35)));
  float a = vColor.a * mix(soft, ring, vRing);
  gl_FragColor = vec4(vColor.rgb, a);
  #include <fog_fragment>
}`;

/** n pooled points: write position (island-relative), aColor (rgba) and aSize (metres; 0 = hidden). */
export function createPufferPoints(T, n) {
  const geo = new T.BufferGeometry();
  const pos = new T.BufferAttribute(new Float32Array(n * 3), 3), col = new T.BufferAttribute(new Float32Array(n * 4), 4), size = new T.BufferAttribute(new Float32Array(n), 1);
  for (const a of [pos, col, size]) a.setUsage(T.DynamicDrawUsage);
  geo.setAttribute('position', pos); geo.setAttribute('aColor', col); geo.setAttribute('aSize', size);
  const mat = new T.ShaderMaterial({
    uniforms: T.UniformsUtils.merge([T.UniformsLib.fog, { uScale: { value: 400 } }]),
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, fog: true,
  });
  const points = new T.Points(geo, mat);
  points.frustumCulled = false; points.renderOrder = 2; points.name = 'bloatfishFx';
  return { points, pos, col, size, geo, mat };
}
