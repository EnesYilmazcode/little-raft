// Seaglass Canteen model (docs/specs/canteen.md): a flattened sea-glass flask with a neck, a cork and
// a rope strap round the rim. Given THREE, imports nothing. About 0.19 x 0.23 x 0.07 before fitting.
// No fill mesh: the hotbar bar shows how many sips are left.

export function createCanteenModel(T) {
  const g = new T.Group();
  g.name = 'held_canteen';
  const mat = (color, o = {}) => new T.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, flatShading: true, ...o });
  const glass = mat('#8fd8f2', { roughness: 0.15, transparent: true, opacity: 0.85 });
  glass.userData.glass = true;
  const add = (geo, m, pos, rot) => {
    const mesh = new T.Mesh(geo, m);
    mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.castShadow = false; mesh.receiveShadow = false;
    g.add(mesh);
    return mesh;
  };
  const body = add(new T.CylinderGeometry(0.08, 0.08, 0.06, 10), glass, [0, 0, 0], [Math.PI / 2, 0, 0]); // round face looks forward
  body.name = 'canteen_body'; body.userData.glass = true;
  add(new T.CircleGeometry(0.045, 10), mat('#d6f4fb', { transparent: true, opacity: 0.7 }), [-0.018, 0.02, 0.0305]); // pale glint on the face
  add(new T.CylinderGeometry(0.022, 0.026, 0.04, 8), mat('#4f93b8'), [0, 0.095, 0]).name = 'canteen_neck';
  add(new T.CylinderGeometry(0.02, 0.017, 0.025, 8), mat('#c69860', { roughness: 0.9 }), [0, 0.125, 0]).name = 'canteen_cork';
  add(new T.TorusGeometry(0.085, 0.008, 5, 18), mat('#b0805a', { roughness: 0.95 }), [0, 0, 0]).name = 'canteen_strap';
  return g;
}
