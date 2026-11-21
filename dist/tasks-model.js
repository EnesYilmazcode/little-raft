// Task Board model (see docs/specs/tasks.md): a ~0.9 m wooden notice board on two legs with 3 paper notes.
// Given THREE, imports nothing. Local origin = centre of the floor tile top; the board faces +z.

export function createTaskBoard(T) {
  const g = new T.Group(); g.name = 'craft_taskboard';
  const wood = new T.MeshStandardMaterial({ color: '#a8794a', roughness: .85 });
  const dark = new T.MeshStandardMaterial({ color: '#6e4a2c', roughness: .9 });
  const cork = new T.MeshStandardMaterial({ color: '#c9a26b', roughness: 1 });
  const paper = new T.MeshStandardMaterial({ color: '#f6ecd2', emissive: '#f6ecd2', emissiveIntensity: .18, roughness: .95 }); // reads as paper even in the board's shade
  const pin = new T.MeshStandardMaterial({ color: '#d9573f', roughness: .5 });
  const ink = new T.MeshStandardMaterial({ color: '#7c6a52', roughness: 1 });
  const add = (geo, mat, x, y, z, rz = 0, name = '') => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.z = rz; if (name) m.name = name; m.castShadow = true; g.add(m); return m; };
  // legs and feet
  for (const s of [-1, 1]) {
    add(new T.BoxGeometry(.07, .92, .07), wood, s * .36, .46, 0, 0, 'leg');
    add(new T.BoxGeometry(.1, .05, .34), dark, s * .36, .025, 0, 0, 'foot');
  }
  // frame and cork panel
  add(new T.BoxGeometry(.82, .54, .04), dark, 0, .64, 0, 0, 'frame');
  add(new T.BoxGeometry(.74, .46, .02), cork, 0, .64, .021, 0, 'cork');
  // little roof plank
  add(new T.BoxGeometry(.92, .05, .16), wood, 0, .935, .02, 0, 'roof');
  // three notes, each with a pin and two ink lines
  const notes = [[-.23, .66, .06], [0, .62, -.04], [.23, .67, .05]];
  notes.forEach(([x, y, r], i) => {
    add(new T.BoxGeometry(.18, .24, .006), paper, x, y, .035, r, 'note' + i);
    add(new T.SphereGeometry(.016, 8, 6), pin, x + Math.sin(-r) * .1, y + .1, .045, 0, 'pin' + i);
    for (const dy of [.02, -.04]) add(new T.BoxGeometry(.12, .012, .004), ink, x - Math.sin(r) * dy, y + dy, .04, r, 'ink');
  });
  return g;
}

export default createTaskBoard;
