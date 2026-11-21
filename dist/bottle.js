// Message in a bottle: small glass bottle with a cork and a rolled note inside.
// createBottle(T) -> THREE.Group named 'bottle' (~0.42 long along X, centred on origin). No textures.
// Drawn as two meshes: the glass, and the cork + note + twine (per-vertex material values, see merge-geo.js).
import { mergeChildMeshes, mergeChildMeshesPBR } from './merge-geo.js?build=v3-survival-ae77fa84ac2b';
export function createBottle(T) {
  const root = new T.Group();
  root.name = 'bottle';
  const mat = o => new T.MeshStandardMaterial(Object.assign({ roughness: 0.7, metalness: 0 }, o));
  const glass = mat({ color: '#9fd6d0', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false });
  const cork = mat({ color: '#bb8a53', roughness: 0.9 });
  const paper = mat({ color: '#f3e6c4', roughness: 0.85 });
  const twine = mat({ color: '#c8995f', roughness: 0.95 });

  // Built along +Y, then the whole thing is laid along X. Total length 0.42 (y -0.21..0.21).
  const inner = new T.Group();
  const prof = [
    [0.0, -0.21], [0.062, -0.21], [0.074, -0.2], [0.078, -0.18], [0.078, 0.02],
    [0.072, 0.05], [0.05, 0.085], [0.032, 0.105], [0.028, 0.12],
  ].map(([r, y]) => new T.Vector2(r, y));
  const body = new T.Mesh(new T.LatheGeometry(prof, 28), glass);
  body.renderOrder = 2;
  inner.add(body);

  const neck = new T.Mesh(new T.CylinderGeometry(0.026, 0.028, 0.055, 20, 1, true), glass);
  neck.position.y = 0.1475;
  neck.renderOrder = 2;
  inner.add(neck);
  const lip = new T.Mesh(new T.TorusGeometry(0.027, 0.006, 8, 20), glass);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.175;
  inner.add(lip);

  const corkMesh = new T.Mesh(new T.CylinderGeometry(0.025, 0.021, 0.05, 16), cork);
  corkMesh.position.y = 0.185;
  inner.add(corkMesh);

  const roll = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.2, 16), paper);
  roll.position.y = -0.07;
  inner.add(roll);
  const band = new T.Mesh(new T.CylinderGeometry(0.0325, 0.0325, 0.014, 16), twine);
  band.position.y = -0.07;
  inner.add(band);

  inner.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  mergeChildMeshesPBR(T, inner); // opaque cork, paper, twine
  mergeChildMeshes(T, inner);    // glass body, neck, lip (one material; renderOrder 2 from the body)
  inner.rotation.z = -Math.PI / 2; // +Y -> +X
  root.add(inner);
  return root;
}

export default createBottle;
