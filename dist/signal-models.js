// Procedural models for the receiver, antenna and floating signal cache.
// Each model owns its materials (the engine's disposeGeometry frees them). Origin = deck / water level.

export function createSignalModel(T, type) {
  if (type !== 'receiver' && type !== 'antenna' && type !== 'cache') return null;
  const g = new T.Group();
  const std = (color, extra = {}) => new T.MeshStandardMaterial({color, roughness:.8, metalness:0, ...extra});
  const add = (geo, material, x = 0, y = 0, z = 0) => {
    const m = new T.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  if (type === 'receiver') {
    add(new T.BoxGeometry(.7, .35, .5), std('#8c6745'), 0, .175, 0);
    add(new T.BoxGeometry(.5, .22, .02), std('#1f4a52', {emissive:'#2f8f86', emissiveIntensity:.4}), 0, .2, .26);
    add(new T.SphereGeometry(.04, 10, 8), std('#ffbd66'), .27, .2, .26);
    add(new T.CylinderGeometry(.02, .02, .6, 8), std('#c0c6c8'), -.3, .65, -.2);
    const fin = add(new T.BoxGeometry(.4, .02, .25), std('#2e5f8a'), .1, .42, -.05); fin.rotation.x = -.5;
  } else if (type === 'antenna') {
    const wood = std('#906f48'), metal = std('#c0c6c8');
    add(new T.BoxGeometry(.3, .08, .3), wood, 0, .04, 0);
    add(new T.CylinderGeometry(.035, .05, 2.2, 8), wood, 0, 1.1, 0);
    [[1.7, .6], [1.9, .45], [2.1, .3]].forEach(([y, w]) => add(new T.BoxGeometry(w, .03, .03), metal, 0, y, 0));
    add(new T.SphereGeometry(.06, 10, 8), std('#ff8a5c', {emissive:'#ff8a5c', emissiveIntensity:.6}), 0, 2.25, 0);
  } else {
    const red = std('#e0523f');
    add(new T.CylinderGeometry(.45, .38, .5, 16), std('#f2a33a'), 0, .1, 0);
    add(new T.CylinderGeometry(.46, .46, .1, 16), std('#fff3cf'), 0, .15, 0);
    add(new T.ConeGeometry(.2, .3, 12), red, 0, .5, 0);
    add(new T.CylinderGeometry(.02, .02, 1, 6), std('#725942'), 0, 1, 0);
    const flag = add(new T.PlaneGeometry(.35, .22), std('#e0523f', {side:T.DoubleSide}), .18, 1.35, 0); flag.castShadow = true;
    const beam = new T.Mesh(new T.CylinderGeometry(.12, .12, 8, 16, 1, true),
      new T.MeshBasicMaterial({color:'#fff0b0', transparent:true, opacity:.25, depthWrite:false, side:T.DoubleSide, forceSinglePass:true}));
    beam.position.y = 4.5; beam.visible = false; beam.castShadow = false; beam.name = 'signalBeam';
    beam.raycast = () => {}; // light only: never a pick/aim target
    g.add(beam); g.userData.beam = beam;
  }
  g.name = 'signal-' + type;
  return g;
}
