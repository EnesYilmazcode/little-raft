// [camera] Little Camera held model + Photo Frame decor model (own procedural art). Imports nothing; THREE is T.
// buildCameraModel(T): ~0.14 (x) x 0.09 (y) x 0.07 (z) m group. Axes: lens looks down -z (away from the player
//   once held), +y up, +x right. Origin at the grip on the right end of the body. 7 meshes, own materials:
//   body (cream plastic), top plate, lens barrel, lens glass, flash window, shutter button, rope strap loop.
//   userData.gripFrac like instrument-models.js (fraction of the fitted size, from the centre).
// buildFrameModel(T): an upright 0.5 x 0.4 m driftwood frame on a little A-stand, base at y = 0, picture facing +z.
//   Inner plane is named 'photoPlane' (MeshBasicMaterial, placeholder painting until a photo is chosen).
//   Group name 'craft_photoframe'; userData.placeholder = the shared placeholder texture (never dispose it).

function std(T, color, o = {}) { return new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0 }, o)); }
function add(g, mesh, name, x = 0, y = 0, z = 0) { mesh.name = name; mesh.position.set(x, y, z); g.add(mesh); return mesh; }

export function buildCameraModel(T) {
  const g = new T.Group(); g.name = 'littleCamera';
  const cream = std(T, 0xf2e6c8, { roughness: 0.55 }), coral = std(T, 0xe07a5f, { roughness: 0.5 }), dark = std(T, 0x2b3a40, { roughness: 0.45 });
  const glass = std(T, 0xbfe6ef, { roughness: 0.08, metalness: 0.3, emissive: 0x1c4a55, emissiveIntensity: 0.35 });
  const rope = std(T, 0xc9a46a, { roughness: 0.85 });
  // body spans x -0.13..0 (grip end at x = 0), y -0.04..0.04
  add(g, new T.Mesh(new T.BoxGeometry(0.13, 0.075, 0.06), cream), 'camBody', -0.065, 0, 0);
  add(g, new T.Mesh(new T.BoxGeometry(0.13, 0.014, 0.062), coral), 'camTop', -0.065, 0.044, 0);
  const barrel = add(g, new T.Mesh(new T.CylinderGeometry(0.026, 0.028, 0.03, 16), dark), 'camLens', -0.07, -0.003, -0.044);
  barrel.rotation.x = Math.PI / 2;
  const lens = add(g, new T.Mesh(new T.CircleGeometry(0.019, 16), glass), 'camGlass', -0.07, -0.003, -0.0595);
  lens.rotation.y = Math.PI;                         // faces -z
  add(g, new T.Mesh(new T.BoxGeometry(0.026, 0.016, 0.004), std(T, 0xfffbe8, { emissive: 0xfff2cc, emissiveIntensity: 0.4 })), 'camFlash', -0.112, 0.022, -0.031);
  add(g, new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.008, 10), coral), 'camShutter', -0.022, 0.055, 0.008);
  const strap = add(g, new T.Mesh(new T.TorusGeometry(0.018, 0.003, 5, 14), rope), 'camStrap', 0.006, 0.02, 0);
  strap.rotation.y = Math.PI / 2;
  g.userData.gripFrac = [0.36, -0.1, 0.05];          // right end of the body, where the fist closes
  return g;
}

let placeholderTex = null;
/** Shared 128x72 painted placeholder (sun, sea line, seagull). Drawn once per page; null without a canvas. */
export function placeholderTexture(T) {
  if (placeholderTex) return placeholderTex;
  let c = null;
  try { if (typeof document !== 'undefined') c = document.createElement('canvas'); else if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(128, 72); } catch { c = null; }
  const x = c?.getContext?.('2d');
  if (!x) return null;
  c.width = 128; c.height = 72;
  const sky = x.createLinearGradient(0, 0, 0, 44); sky.addColorStop(0, '#9fd6e8'); sky.addColorStop(1, '#fbe3b8');
  x.fillStyle = sky; x.fillRect(0, 0, 128, 44);
  x.fillStyle = '#ffbd66'; x.beginPath(); x.arc(92, 34, 11, 0, Math.PI * 2); x.fill();
  const sea = x.createLinearGradient(0, 44, 0, 72); sea.addColorStop(0, '#3b9fb0'); sea.addColorStop(1, '#1f6f86');
  x.fillStyle = sea; x.fillRect(0, 44, 128, 28);
  x.strokeStyle = '#d9f2f2'; x.lineWidth = 1.5; x.lineCap = 'round';
  for (const [a, b, y] of [[10, 34, 52], [46, 70, 58], [84, 112, 54], [20, 40, 65]]) { x.beginPath(); x.moveTo(a, y); x.quadraticCurveTo((a + b) / 2, y - 2, b, y); x.stroke(); }
  x.strokeStyle = '#153e49'; x.lineWidth = 2;        // seagull: two soft arcs
  x.beginPath(); x.moveTo(30, 22); x.quadraticCurveTo(36, 15, 41, 21); x.quadraticCurveTo(46, 15, 52, 22); x.stroke();
  x.lineWidth = 1.5; x.beginPath(); x.moveTo(62, 14); x.quadraticCurveTo(65, 10, 68, 13); x.quadraticCurveTo(71, 10, 74, 14); x.stroke();
  const t = new T.CanvasTexture(c);
  if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
  t.userData = { shared: true };
  placeholderTex = t;
  return t;
}

export function buildFrameModel(T) {
  const g = new T.Group(); g.name = 'craft_photoframe';
  const wood = std(T, 0xb88a56, { roughness: 0.8 }), dark = std(T, 0x8a6440, { roughness: 0.85 });
  const W = 0.5, H = 0.4, B = 0.045, D = 0.04, y0 = 0.42;   // outer size, border, depth, picture centre height
  const bar = (w, h, x, y) => add(g, new T.Mesh(new T.BoxGeometry(w, h, D), wood), 'frameBar', x, y0 + y, 0);
  bar(W, B, 0, H / 2 - B / 2); bar(W, B, 0, -H / 2 + B / 2);
  bar(B, H - 2 * B, -W / 2 + B / 2, 0); bar(B, H - 2 * B, W / 2 - B / 2, 0);
  add(g, new T.Mesh(new T.BoxGeometry(W - 2 * B, H - 2 * B, 0.01), dark), 'frameBack', 0, y0, -0.012);
  const tex = placeholderTexture(T);
  const pm = new T.MeshBasicMaterial({ color: 0xffffff, map: tex, toneMapped: false });
  const plane = add(g, new T.Mesh(new T.PlaneGeometry(W - 2 * B - 0.01, (W - 2 * B - 0.01) * 9 / 16), pm), 'photoPlane', 0, y0, 0.004);
  plane.userData.placeholder = tex;
  // A-stand: two front legs and one back prop, so it stands on any tile
  for (const s of [-1, 1]) { const l = add(g, new T.Mesh(new T.BoxGeometry(0.035, 0.44, 0.035), dark), 'frameLeg', s * 0.17, 0.2, 0.01); l.rotation.z = s * 0.08; }
  const prop = add(g, new T.Mesh(new T.BoxGeometry(0.03, 0.46, 0.03), dark), 'frameProp', 0, 0.21, -0.12); prop.rotation.x = -0.45;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = o.name !== 'photoPlane'; } });
  g.userData.placeholder = tex;
  return g;
}
