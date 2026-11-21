// Driftwood Game Table model (docs/specs/gametable.md §5). Geometry and materials are built ONCE and shared;
// instance() returns a Group named 'game_table' with 4 InstancedMeshes for the pieces and a rope grid for noughts.
// Local origin = centre of the floor tile top. Side 0 sits at local +z (board row 0 nearest +z).

function mergeParts(T, parts) {
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

function painter(T, seed0) {
  const parts = [];
  let seed = seed0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function add(geo, hex, x = 0, y = 0, z = 0, jitter = .05) {
    const g = geo.index ? geo.toNonIndexed() : geo; if (g !== geo) geo.dispose();
    g.translate(x, y, z);
    const n = g.attributes.position.count, col = new Float32Array(n * 3), base = new T.Color(hex), c = new T.Color();
    const tone = 1 + (rnd() - .5) * jitter * 2;
    for (let i = 0; i < n; i++) { c.copy(base).multiplyScalar(tone); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    parts.push(g);
  }
  return { parts, add };
}

function shareable(T, list) {
  const noop = () => {};
  for (const x of list) x.dispose = noop;
  const realGeo = T.BufferGeometry.prototype.dispose, realMat = T.Material.prototype.dispose;
  return () => { for (const x of list) (x.isMaterial ? realMat : realGeo).call(x); };
}

export const TOP_Y = .78, SQ = .08, CELL = .2;
const SHELL_H = .015, KNOT_H = .02, HOOP_H = .015;
export const squareXZ = (i, out) => { const r = i >> 2, c = 2 * (i & 3) + (1 - ((i >> 2) & 1)); out.x = (c - 3.5) * SQ; out.z = (3.5 - r) * SQ; return out; };
export const cellXZ = (k, out) => { out.x = ((k % 3) - 1) * CELL; out.z = (1 - Math.floor(k / 3)) * CELL; return out; };

export function buildGameTable(T) {
  const { parts, add } = painter(T, 23);
  add(new T.BoxGeometry(.9, .06, .9), 0xa98457, 0, TOP_Y - .03, 0, .03);                    // driftwood top
  add(new T.BoxGeometry(.94, .03, .04), 0x8f6d45, 0, TOP_Y - .07, .43, .04);                // apron rails
  add(new T.BoxGeometry(.94, .03, .04), 0x8f6d45, 0, TOP_Y - .07, -.43, .04);
  for (const [x, z] of [[-.38, -.38], [.38, -.38], [-.38, .38], [.38, .38]]) add(new T.BoxGeometry(.06, .76, .06), 0x8a6a44, x, .38 - .02, z, .06); // legs
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const dark = ((r + c) & 1) === 1;
    add(new T.BoxGeometry(SQ, .004, SQ), dark ? 0x4a3423 : 0xd8bf94, (c - 3.5) * SQ, TOP_Y + .002, (3.5 - r) * SQ, .03);
  }
  add(new T.BoxGeometry(.68, .003, .68), 0x6e4b2c, 0, TOP_Y + .0005, 0, .02); // border band under the inlay
  const tableGeo = mergeParts(T, parts);
  const tableMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0 }); tableMat.name = 'gtTable';

  // rope grid for noughts: 4 thin boxes
  const g = painter(T, 3);
  for (const v of [-CELL / 2, CELL / 2]) { g.add(new T.BoxGeometry(.012, .012, .6), 0xd9c08a, v, TOP_Y + .01, 0, .03); g.add(new T.BoxGeometry(.6, .012, .012), 0xd9c08a, 0, TOP_Y + .01, v, .03); }
  const gridGeo = mergeParts(T, g.parts);
  const gridMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: .95 }); gridMat.name = 'gtGrid';

  const shellGeo = new T.CylinderGeometry(.03, .03, SHELL_H, 14);
  const knotA = new T.BoxGeometry(.15, KNOT_H, .03).toNonIndexed(), knotB = knotA.clone();
  knotA.rotateY(Math.PI / 4); knotB.rotateY(-Math.PI / 4);
  for (const k of [knotA, knotB]) { k.setAttribute('color', new T.BufferAttribute(new Float32Array(k.attributes.position.count * 3).fill(1), 3)); k.deleteAttribute('uv'); }
  const knotGeo = mergeParts(T, [knotA, knotB]);
  const hoopGeo = new T.TorusGeometry(.06, .014, 8, 20); hoopGeo.rotateX(Math.PI / 2);
  const shellMat = new T.MeshStandardMaterial({ color: 0xf3e6cc, roughness: .5 }); shellMat.name = 'gtShell';
  const pebbleMat = new T.MeshStandardMaterial({ color: 0x59656b, roughness: .7 }); pebbleMat.name = 'gtPebble';
  const knotMat = new T.MeshStandardMaterial({ color: 0xc58a4a, roughness: .9 }); knotMat.name = 'gtKnot';
  const hoopMat = new T.MeshStandardMaterial({ color: 0x54a6a4, roughness: .6 }); hoopMat.name = 'gtHoop';
  const free = shareable(T, [tableGeo, tableMat, gridGeo, gridMat, shellGeo, knotGeo, hoopGeo, shellMat, pebbleMat, knotMat, hoopMat]);

  const m4 = new T.Matrix4(), xz = { x: 0, z: 0 }, from = { x: 0, z: 0 };
  const inst = (geo, mat, cap, name) => { const m = new T.InstancedMesh(geo, mat, cap); m.name = name; m.count = 0; m.visible = false; m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; return m; };
  const setAt = (mesh, idx, x, y, z) => { m4.makeTranslation(x, y, z); mesh.setMatrixAt(idx, m4); };

  /** Position pieces. u in [0,1]: the last moved piece eases from its `from` square (1 = settled). */
  function place(group, gm, u = 1) {
    const gt = group.userData.gt; if (!gt) return;
    let ns = 0, np = 0, nk = 0, nh = 0;
    gt.slideMesh = null; gt.slideIdx = -1; gt.slideKing = -1;
    const draughts = gm && gm.g === 'd', noughts = gm && gm.g === 'n';
    gt.grid.visible = !!noughts;
    if (draughts) {
      const b = gm.b, to = gm.last[1];
      for (let i = 0; i < 32; i++) {
        const ch = b[i]; if (ch === '.') continue;
        const shell = ch === 'a' || ch === 'A', mesh = shell ? gt.shell : gt.pebble;
        squareXZ(i, xz);
        const idx = shell ? ns++ : np++;
        setAt(mesh, idx, xz.x, TOP_Y + .004 + SHELL_H / 2, xz.z);
        let kIdx = -1;
        if (ch === 'A' || ch === 'B') { kIdx = shell ? ns++ : np++; setAt(mesh, kIdx, xz.x, TOP_Y + .004 + SHELL_H * 1.5 + .002, xz.z); }
        if (i === to) { gt.slideMesh = mesh; gt.slideIdx = idx; gt.slideKing = kIdx; }
      }
    } else if (noughts) {
      const b = gm.b, to = gm.last[1];
      for (let k = 0; k < 9; k++) {
        const ch = b[k]; if (ch === '.') continue;
        cellXZ(k, xz);
        const mesh = ch === 'x' ? gt.knot : gt.hoop, idx = ch === 'x' ? nk++ : nh++;
        setAt(mesh, idx, xz.x, TOP_Y + .004 + (ch === 'x' ? KNOT_H : HOOP_H) / 2, xz.z);
        if (k === to) { gt.slideMesh = mesh; gt.slideIdx = idx; }
      }
    }
    const fin = (m, n) => { m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; };
    fin(gt.shell, ns); fin(gt.pebble, np); fin(gt.knot, nk); fin(gt.hoop, nh);
    gt.from = gm ? gm.last[0] : -1; gt.to = gm ? gm.last[1] : -1; gt.g = gm ? gm.g : null;
    if (u < 1) slide(group, u);
  }
  /** Ease only the last moved piece (one or two matrix writes). */
  function slide(group, u) {
    const gt = group.userData.gt; if (!gt || !gt.slideMesh || gt.to < 0) return;
    const e = u >= 1 ? 1 : u <= 0 ? 0 : u * (2 - u);
    let x, z, lift;
    if (gt.g === 'd') { squareXZ(gt.to, xz); if (gt.from >= 0) squareXZ(gt.from, from); else { from.x = xz.x; from.z = xz.z; } lift = Math.sin(e * Math.PI) * .03; }
    else { cellXZ(gt.to, xz); from.x = xz.x; from.z = xz.z; lift = (1 - e) * .08; }
    x = from.x + (xz.x - from.x) * e; z = from.z + (xz.z - from.z) * e;
    const h = gt.g === 'd' ? SHELL_H : gt.slideMesh === gt.knot ? KNOT_H : HOOP_H;
    setAt(gt.slideMesh, gt.slideIdx, x, TOP_Y + .004 + h / 2 + lift, z);
    if (gt.slideKing >= 0) setAt(gt.slideMesh, gt.slideKing, x, TOP_Y + .004 + SHELL_H * 1.5 + .002 + lift, z);
    gt.slideMesh.instanceMatrix.needsUpdate = true;
  }

  return {
    instance() {
      const grp = new T.Group(); grp.name = 'game_table';
      const table = new T.Mesh(tableGeo, tableMat); table.name = 'gtTable'; table.castShadow = true; table.receiveShadow = true;
      const grid = new T.Mesh(gridGeo, gridMat); grid.name = 'gtGrid'; grid.visible = false;
      const shell = inst(shellGeo, shellMat, 24, 'gtShells'), pebble = inst(shellGeo, pebbleMat, 24, 'gtPebbles');
      const knot = inst(knotGeo, knotMat, 5, 'gtKnots'), hoop = inst(hoopGeo, hoopMat, 5, 'gtHoops');
      grp.add(table, grid, shell, pebble, knot, hoop);
      grp.userData.craftType = 'gametable'; grp.userData.height = TOP_Y + .02;
      grp.userData.gt = { shell, pebble, knot, hoop, grid, slideMesh: null, slideIdx: -1, slideKing: -1, from: -1, to: -1, g: null };
      return grp;
    },
    place, slide,
    dispose: free,
  };
}
