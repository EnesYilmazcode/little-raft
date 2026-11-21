// Shooting-star mesh (docs/specs/stars.md): one fixed-buffer Points, 3 slots x 24 vertices (head + fading tail).
// The vertex shader places each vertex on the sky sphere (radius 130 around the camera) from per-slot uniforms,
// so nothing is rebuilt per frame. uT[i] = (u head progress 0..1, fade, tint index, flare); u < 0 hides the slot.
export const SLOTS = 3, TAIL = 24, SKY_R = 130, TAIL_SPAN = 0.45;

const VS = /* glsl */`
attribute float aSlot;
attribute float aI;
uniform vec3 uA[3];
uniform vec3 uB[3];
uniform vec4 uT[3];
uniform float uSky;
uniform float uPx;
varying float vAlpha;
varying vec3 vColor;
void main() {
  int s = int(aSlot + 0.5);
  vec3 a = uA[0]; vec3 b = uB[0]; vec4 t = uT[0];
  if (s == 1) { a = uA[1]; b = uB[1]; t = uT[1]; }
  else if (s == 2) { a = uA[2]; b = uB[2]; t = uT[2]; }
  float f = aI / ${TAIL.toFixed(1)};
  float u = t.x - aI * ${(TAIL_SPAN / (TAIL - 1)).toFixed(5)};
  vec3 dir = normalize(mix(a, b, clamp(u, 0.0, 1.0)));
  float on = step(0.0, u) * step(0.0, t.x);
  float flare = t.w;
  vAlpha = min(1.0, on * pow(1.0 - f, 1.6) * t.y * uSky * (1.25 + 1.5 * flare));
  vColor = t.z < 0.5 ? vec3(1.0) : t.z < 1.5 ? vec3(1.0, 0.914, 0.659) : vec3(0.749, 0.961, 0.902);
  vColor = mix(vColor, vec3(1.0), 0.35 * (1.0 - f));
  vec4 mv = modelViewMatrix * vec4(dir * ${SKY_R.toFixed(1)}, 1.0);
  gl_PointSize = uPx * (2.6 + 4.5 * (1.0 - f) * (1.0 - f) + flare * 12.0 * step(f, 0.01));
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */`
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float g = smoothstep(0.5, 0.0, length(d));
  float a = vAlpha * g * g * (3.0 - 2.0 * g);
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

export function createMeteorMesh(T) {
  const n = SLOTS * TAIL;
  const pos = new Float32Array(n * 3), slot = new Float32Array(n), idx = new Float32Array(n);
  for (let s = 0; s < SLOTS; s++) for (let i = 0; i < TAIL; i++) { const j = s * TAIL + i; slot[j] = s; idx[j] = i; pos[j * 3 + 1] = SKY_R; }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('aSlot', new T.BufferAttribute(slot, 1));
  geo.setAttribute('aI', new T.BufferAttribute(idx, 1));
  const uniforms = {
    uA: { value: [new T.Vector3(0, 1, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 1, 0)] },
    uB: { value: [new T.Vector3(0, 1, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 1, 0)] },
    uT: { value: [new T.Vector4(-1, 0, 0, 0), new T.Vector4(-1, 0, 0, 0), new T.Vector4(-1, 0, 0, 0)] },
    uSky: { value: 0 }, uPx: { value: 1 },
  };
  const mat = new T.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: T.AdditiveBlending });
  const mesh = new T.Points(geo, mat);
  mesh.name = 'stars-meteors'; mesh.frustumCulled = false; mesh.renderOrder = -4; mesh.visible = false;
  return { mesh, uniforms, dispose() { geo.dispose(); mat.dispose(); } };
}
