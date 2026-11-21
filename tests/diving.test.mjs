// Unit tests for the diving pure parts: DiveBody, stepOxygen (and seafloor helpers when present).
// Run: node --test tests/diving.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { DIVE, DiveBody, stepOxygen } = await import(new URL('diving.js', base));

const ENV = { waterY: -0.24, floorY: -11, tiles: [], deckY: 0.2 };
const run = (body, secs, input, env = ENV) => {
  const evs = [];
  for (let t = 0; t < secs; t += 1 / 60) { const ev = body.step(1 / 60, input, env); evs.push(ev); if (ev.surfaced) break; }
  return evs;
};

test('DiveBody: holding down descends and never surfaces', () => {
  const b = new DiveBody({ x: 10, y: -0.3, z: 0 });
  const evs = run(b, 2, { down: true, yaw: 0, pitch: 0 });
  assert.ok(b.y < -2, `y ${b.y}`);
  assert.ok(evs.every(e => !e.surfaced));
});

test('DiveBody: forward follows the look direction including pitch', () => {
  const b = new DiveBody({ x: 10, y: -4, z: 0 });
  run(b, 1, { forward: 1, yaw: 0, pitch: -0.6 });
  assert.ok(b.z < -1, `moved forward (-z): ${b.z}`);
  assert.ok(b.y < -4.5, `pitched down: ${b.y}`);
  assert.ok(Math.abs(b.x - 10) < 1e-6);
});

test('DiveBody: keeps the eye EYE_FLOOR_CLEAR above the seafloor', () => {
  const b = new DiveBody({ x: 10, y: -5, z: 0 });
  const env = { ...ENV, floorY: -6 };
  const evs = run(b, 3, { down: true, fast: true }, env);
  assert.ok(Math.abs(b.y - (-6 + DIVE.EYE_FLOOR_CLEAR)) < 1e-9, `y ${b.y}`);
  assert.ok(evs.some(e => e.hitFloor));
  assert.ok(b.vy >= 0);
});

test('DiveBody: raft underside clamps the eye while inside a tile (with margin)', () => {
  const env = { ...ENV, tiles: [[0, 0], [1, 0]] };
  for (const x of [0, 2, 3.2]) { // centre, second tile, inside the 0.25 m margin
    const b = new DiveBody({ x, y: -2, z: 0 });
    const evs = run(b, 3, { up: true }, env);
    assert.ok(evs.every(e => !e.surfaced), `no surfacing under raft at x=${x}`);
    assert.ok(b.y <= env.deckY - DIVE.RAFT_CLEAR + 1e-9, `y ${b.y} at x=${x}`);
  }
  const out = new DiveBody({ x: 3.4, y: -2, z: 0 });
  assert.ok(run(out, 3, { up: true }, env).some(e => e.surfaced), 'surfaces just outside the margin');
});

test('DiveBody: swimming up exits at the surface; no exit during entry grace', () => {
  const b = new DiveBody({ x: 10, y: -3, z: 0 });
  const evs = run(b, 5, { up: true });
  assert.ok(evs.at(-1).surfaced);
  assert.ok(b.y >= ENV.waterY - DIVE.SURFACE_EXIT - 1e-9);
  const g = new DiveBody({ x: 10, y: -0.3, z: 0, vy: 1 });
  g.grace = DIVE.ENTRY_GRACE;
  assert.equal(g.step(1 / 60, { up: true }, ENV).surfaced, false);
  // buoyancy alone eventually brings an idle diver back up
  const idle = new DiveBody({ x: 10, y: -0.5, z: 0 });
  assert.ok(run(idle, 10, {}).at(-1).surfaced);
});

test('DiveBody: empty oxygen forces a rising ascent ignoring down input', () => {
  const b = new DiveBody({ x: 10, y: -8, z: 0, oxygen: 0.0002 });
  b.step(1 / 60, { down: true }, ENV);
  assert.equal(b.rising, true);
  run(b, 1, { down: true });
  assert.ok(b.vy > 2.5 && b.vy <= DIVE.RISE_SPEED + 1e-9, `vy ${b.vy}`);
  const evs = run(b, 6, { down: true });
  assert.ok(evs.at(-1).surfaced);
  assert.equal(b.rising, false);
});

test('DiveBody: out of air under a 2x2 raft drifts to open water and surfaces', () => {
  const env = { ...ENV, tiles: [[0, 0], [1, 0], [0, 1], [1, 1]] };
  for (const [x, z] of [[1, 1], [0, 0], [2.5, 1]]) {
    const b = new DiveBody({ x, y: -3, z, oxygen: 0 });
    const evs = run(b, 15, {}, env);
    assert.ok(evs.at(-1).surfaced, `surfaced from (${x},${z}) at ${b.x.toFixed(2)},${b.z.toFixed(2)}`);
    assert.ok(evs.length / 60 < 15);
  }
});

test('DiveBody: combined swim speed capped at FAST; no buoyancy while gathering', () => {
  const b = new DiveBody({ x: 10, y: -6, z: 0 });
  run(b, 3, { forward: 1, strafe: 1, pitch: 0.7, up: true, fast: true });
  assert.ok(Math.hypot(b.vx, b.vy, b.vz) <= DIVE.FAST + 1e-6);
  const g = new DiveBody({ x: 10, y: -6, z: 0 });
  run(g, 2, { gather: true });
  assert.ok(Math.abs(g.y + 6) < 1e-9, `y ${g.y}`);
});

test('DiveBody: horizontal distance clamped to MAX_DISTANCE from origin', () => {
  const b = new DiveBody({ x: 49.5, y: -4, z: 0 });
  run(b, 3, { forward: 1, yaw: -Math.PI / 2, fast: true }); // yaw -pi/2 faces +x
  assert.ok(Math.hypot(b.x, b.z) <= DIVE.MAX_DISTANCE + 1e-9);
  assert.ok(b.x > 49.9);
});

test('DiveBody: leash is relative to the nearest raft tile, not the origin', () => {
  const env = { ...ENV, tiles: [[25, 0]] }; // tile centre x=50, footprint 49..51
  const b = new DiveBody({ x: 60, y: -4, z: 0 });
  b.step(1 / 60, {}, env);
  assert.ok(Math.abs(b.x - 60) < 0.1, `no jump: x ${b.x}`);
  const far = new DiveBody({ x: 100, y: -4, z: 0 });
  run(far, 3, { forward: 1, yaw: -Math.PI / 2, fast: true }, env);
  assert.ok(far.x <= 51 + DIVE.MAX_DISTANCE + 1e-9 && far.x > 100.9, `x ${far.x}`);
});

test('DiveBody: survives junk input and env', () => {
  const b = new DiveBody({ x: NaN, y: undefined, z: 'x' });
  b.step(NaN, null, {});
  b.step(1 / 60, { forward: Infinity, yaw: NaN }, { tiles: [null, [1], 'x'] });
  assert.ok([b.x, b.y, b.z, b.vx, b.vy, b.vz].every(Number.isFinite));
});

test('stepOxygen: drains over OXY_SECONDS, refills faster, clamps', () => {
  let o = 1, empty = false;
  for (let t = 0; t < DIVE.OXY_SECONDS - 0.5; t += 0.5) ({ oxygen: o, empty } = stepOxygen(o, 0.5, true));
  assert.ok(o > 0 && o < 0.05 && !empty, `o ${o}`);
  ({ oxygen: o, empty } = stepOxygen(o, 2, true));
  assert.equal(o, 0); assert.equal(empty, true);
  const r = stepOxygen(0, DIVE.OXY_SECONDS / DIVE.REFILL_RATE / 2, false);
  assert.ok(Math.abs(r.oxygen - 0.5) < 1e-9);
  assert.equal(stepOxygen(0.9, 100, false).oxygen, 1);
  assert.equal(stepOxygen(NaN, NaN, true).oxygen, 1);
});

const seafloorPath = fileURLToPath(new URL('seafloor.js', base));
test('seafloor helpers', { skip: !existsSync(seafloorPath) && 'dist/seafloor.js missing' }, async () => {
  const { FLOOR, seafloorHeight, nodeById, nodeAt } = await import(new URL('seafloor.js', base));
  const islands = [{ x: 70, z: 0, r: 5 }];
  for (let i = 0; i < 400; i++) {
    const x = (i * 37.3 % 200) - 100, z = (i * 71.9 % 200) - 100;
    const h = seafloorHeight(x, z, islands);
    assert.ok(Number.isFinite(h) && h <= FLOOR.SHALLOWEST + 1e-9, `h ${h}`);
    assert.equal(h, seafloorHeight(x, z, islands), 'deterministic');
    if (Math.hypot(x, z) < 9) assert.ok(h <= FLOOR.MIN_DEPTH_UNDER_RAFT + 1e-9, `under raft ${h}`);
  }
  assert.ok(seafloorHeight(70, 0, islands) > seafloorHeight(70, 0, []), 'islands shallower');
  assert.ok(seafloorHeight(72, 3, islands) > seafloorHeight(30, -30, islands));
  for (const junk of [null, undefined, '', 'a,b', '1', '1,2,3', '1.5,2', 'NaN,1', {}, 12, '1e400,0', ' 1,2']) {
    assert.equal(nodeById(junk, islands), null, `junk ${String(junk)}`);
  }
  for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) {
    const n = nodeAt(cx, cz, islands);
    if (n) assert.deepEqual(nodeById(n.id, islands), n);
  }
});

test('seafloor builder: isGathered/highlight API and analytic normals', { skip: !existsSync(seafloorPath) && 'dist/seafloor.js missing' }, async () => {
  const T = await import(new URL('vendor/three.module.js', base));
  const { createSeafloor } = await import(new URL('seafloor.js', base));
  const floor = createSeafloor(T, { islands: [{ x: 70, z: 0, r: 5 }] });
  const cam = { position: { x: 20, y: -5, z: 10 } };
  floor.update(0.016, cam, 1);
  const n = floor.nodesNear(20, -10, 10, 30)[0];
  assert.ok(n, 'a node near the camera');
  const hl = () => floor.group.children.filter((o) => o.name.startsWith('SeafloorHighlight') && o.visible);
  floor.highlight(n.id);
  assert.equal(hl().length, 1);
  assert.equal(hl()[0].name, `SeafloorHighlight_${n.type}`);
  floor.highlight(null);
  assert.equal(hl().length, 0);
  assert.equal(floor.isGathered(n.id), false);
  floor.setGathered(n.id);
  assert.equal(floor.isGathered(n.id), true);
  const nor = floor.group.getObjectByName('SeafloorPatch').geometry.attributes.normal;
  for (let i = 0; i < nor.count; i += 7) assert.ok(Math.abs(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i)) - 1) < 1e-4 && nor.getY(i) > 0);
  floor.dispose();
});
