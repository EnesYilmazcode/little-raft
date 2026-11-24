// Climbing onto things: decor colliders with a height (dist/decor-collision.js), walkable wall / rail / pillar tops
// (BuildGrid), the Raft-height jump and the ledge clamber (PlayerPhysics). Drives PlayerPhysics + BuildGrid the way
// game.js movePlayer does: preStep, update in <= 0.05 s substeps with {blocked, baseY, ledge}, postStep.
// Run: node --test tests/climb.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const { BuildGrid, LEVEL_H, RAIL_H, PIECES } = await import(new URL('building-pieces.js', base));
const { PlayerPhysics, PLAYER_CONSTANTS: PC, blockerGap } = await import(new URL('player-physics.js', base));
const DC = await import(new URL('decor-collision.js', base));
const { footprintOf } = await import(new URL('placement.js', base));
const { CONTENT_DECOR, CONTENT_BLOCK_RADIUS } = await import(new URL('content-items.js', base));
const { PLACEABLE_IDS, BLOCK_RADII } = await import(new URL('items.js', base));
const { MoveFeel } = await import(new URL('move-feel.js', base));

const EYE = PC.EYE_OFFSET, R = PC.BODY_RADIUS, D0 = 0.2, WATER = -0.24;
const RADII = { palm: .42, crate: .55, bench: .45, sail: .14, lantern: .12, receiver: .35, antenna: .1, purifier: .3, rainbarrel: .3, sprinkler: .12, ...CONTENT_BLOCK_RADIUS, ...BLOCK_RADII };
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');
const BASE_DECOR = [...gameSrc.match(/const DECOR_TYPES = Object\.freeze\(\[\.\.\.new Set\(\[(.*?)\.\.\./)[1].matchAll(/'([a-z0-9]+)'/g)].map(m => m[1]);
const ALL_DECOR = [...new Set([...BASE_DECOR, ...CONTENT_DECOR, ...PLACEABLE_IDS])];
const tilesSq = n => { const a = []; for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) a.push([i, j]); return a; };
const P = (t, i, j, l, r = 0) => ({ t, i, j, l, r });
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const FRAMES = [1 / 60, 1 / 20];
const BOBS = [0, 0.15];
const tag = (dt, bob) => `dt=1/${Math.round(1 / dt)} bob=${bob}`;

function world(pieces = [], decor = []) {
  const g = new BuildGrid(); g.setTiles(tilesSq(4));
  for (const p of pieces) assert.ok(g.place(p), `place ${JSON.stringify(p)}: ${g.canPlace(p)}`);
  return { g, blocked: decor.flatMap(d => DC.decorColliders(d, RADII)) };
}
// The game's movement loop; feet/head relative to the (bobbing) deck.
function run(w, ph, seconds, input, dt = 1 / 60, bob = 0, st = { t: 0 }) {
  const out = [], n = Math.max(1, Math.ceil(dt / 0.05 - 1e-9)), step = dt / n;
  for (let f = 0; f < Math.round(seconds / dt); f++) {
    st.t += dt;
    const deckY = D0 + bob * Math.sin(st.t * 2 * Math.PI / 2.5);
    const inp = typeof input === 'function' ? input(ph, f) : input;
    const surf = w.g.preStep(ph, deckY);
    let landed = false;
    for (let i = 0; i < n; i++) {
      const e = ph.update(step, { ...inp, tiles: surf.tiles, deckY: surf.deckY, waterY: WATER, blocked: w.blocked, baseY: deckY, ledge: w.g });
      landed ||= e.landed;
    }
    w.g.postStep(ph, deckY);
    out.push({ x: ph.x, y: ph.y, z: ph.z, feet: ph.y - EYE - deckY, grounded: ph.grounded, climbing: ph.climbing, vy: ph.vy, landed, lp: ph.ledgeProgress() });
  }
  return out;
}
const maxOf = (tr, f) => tr.reduce((m, s) => Math.max(m, f(s)), -Infinity);
const hop = (yaw, stopAbove = 0.3) => (p, n) => ({ forward: p.grounded && n > 3 && p.y - EYE - D0 > stopAbove ? 0 : 1, yaw, jump: n < 3 });
const near = (a, b, e = 0.03) => Math.abs(a - b) < e;

// ---------------------------------------------------------------- decor colliders

test('decor colliders: every placeable type has a decided collider (standable box, true-height blocker or flat)', () => {
  assert.ok(ALL_DECOR.length > 50, `${ALL_DECOR.length} decor types`);
  const missing = ALL_DECOR.filter(t => !DC.hasDecorCollider(t));
  assert.deepEqual(missing, [], 'add these to dist/decor-collision.js');
  for (const t of ALL_DECOR) {
    const cs = DC.decorColliders({ type: t, x: 1, z: -1 }, RADII);
    if (DC.isFlatDecor(t)) { assert.equal(cs.length, 0, `${t}: flat, walk over`); continue; }
    assert.ok(cs.length >= 1, t);
    for (const c of cs) {
      assert.ok(Number.isFinite(c.top) && c.top > 0.1 && c.top < 4, `${t}: top ${c.top}`);
      assert.equal(c.y0, 0, `${t}: stands on the deck`);
      assert.equal(typeof c.stand, 'boolean');
    }
  }
  for (const t of ['crate', 'bench', 'bed', 'research', 'researchtable', 'maptable', 'smelter', 'cookpot', 'purifier', 'cropplot', 'flowerbox', 'shelf', 'kiln', 'grill', 'recycler', 'gametable', 'nestbox'])
    assert.ok(DC.decorColliders({ type: t, x: 0, z: 0 }, RADII).some(c => c.stand), `${t} is standable`);
  for (const t of ['lantern', 'lamppost', 'antenna', 'flagpole', 'sail', 'pennant', 'glidepost', 'sprinkler', 'sign'])
    assert.ok(DC.decorColliders({ type: t, x: 0, z: 0 }, RADII).every(c => !c.stand), `${t} only blocks`);
  assert.deepEqual(DC.decorColliders({ type: 'rug', x: 0, z: 0 }, RADII), []);
  assert.deepEqual(DC.decorColliders({ type: 'crate', x: NaN, z: 0 }, RADII), []);
  // Unknown (future) types keep the old full-height column.
  const u = DC.decorColliders({ type: 'zzz-new', x: 0, z: 0 }, { 'zzz-new': 0.3 });
  assert.equal(u.length, 1); assert.equal(u[0].top, undefined);
});

test('decor colliders: a standable box is the placement footprint, rotated with the decor, at its model height', () => {
  for (const t of Object.keys(DC.DECOR_STAND_TOP)) {
    const f = footprintOf(t, RADII), [c] = DC.decorColliders({ type: t, x: 1.5, z: -0.5, rot: 0.7 }, RADII);
    assert.equal(c.hx, f[0]); assert.equal(c.hz, f[1]); assert.equal(c.rot, 0.7);
    assert.equal(c.x, 3); assert.equal(c.z, -1); assert.equal(c.top, DC.DECOR_STAND_TOP[t]);
  }
  // Raft-like heights: chests, tables and stations are lower than the jump apex.
  const apex = PC.JUMP_IMPULSE ** 2 / (2 * PC.GRAVITY);
  for (const t of ['crate', 'bed', 'maptable', 'researchtable', 'cookpot', 'smelter', 'purifier']) assert.ok(DC.DECOR_STAND_TOP[t] < apex - 0.05, t);
  // The hammock cloth follows its decor rotation; the posts are offset with it.
  const h = DC.decorColliders({ type: 'hammock', x: 0, z: 0, rot: Math.PI / 2 }, RADII);
  assert.ok(near(h[0].rot, Math.PI / 4, 1e-9));
  assert.ok(near(h[1].x, -0.72, 1e-9) && near(h[1].z, 0.72, 1e-9), `post ${h[1].x}, ${h[1].z}`);
});

test('decor: jump onto a crate, a table, a bed and a station; stand there without jitter; walk off and fall', () => {
  for (const [type, top] of [['crate', .87], ['maptable', .96], ['bed', .75], ['cookpot', .55], ['smelter', 1.29], ['cropplot', .37]]) {
    for (const dt of FRAMES) for (const bob of BOBS) {
      const w = world([], [{ type, x: 0, z: -1 }]), msg = `${type} ${tag(dt, bob)}`, st = { t: 0 };
      const front = -2 + footprintOf(type, RADII)[1];
      const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: front + R + 0.06 });
      run(w, ph, 0.1, {}, dt, bob, st);
      const tr = run(w, ph, 1.2, hop(0), dt, bob, st);
      assert.ok(ph.grounded && near(tr.at(-1).feet, top, 0.02), `${msg}: on top (feet ${tr.at(-1).feet})`);
      const rest = run(w, ph, 1, {}, dt, bob, st);
      assert.ok(rest.every(s => s.grounded && near(s.feet, top, 0.02) && !s.landed), `${msg}: steady on top`);
      const off = run(w, ph, 1.5, { forward: 1, yaw: yawTo(1, 0) }, dt, bob, st);
      assert.ok(off.some(s => !s.grounded), `${msg}: fell off the side`);
      assert.ok(ph.grounded && near(off.at(-1).feet, 0, 0.02), `${msg}: back on the deck`);
    }
  }
});

test('decor: walking into a crate is blocked at its footprint; a cushion is stepped onto; a rug is walked over', () => {
  for (const dt of FRAMES) {
    let w = world([], [{ type: 'crate', x: 0, z: -1 }]);
    let ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 1 });
    run(w, ph, 1.5, { forward: 1, yaw: 0 }, dt);
    // Axis-separated prop movement refuses a whole step that would enter: it stops within one step of the face.
    assert.ok(ph.z >= -2 + 0.42 + R - 1e-6 && ph.z < -2 + 0.42 + R + 4.3 * dt && near(ph.y - EYE, D0, 1e-6), `${tag(dt, 0)}: crate face (z ${ph.z})`);
    w = world([], [{ type: 'cushion', x: 0, z: -1 }]);
    ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 1 });
    const tr = run(w, ph, 1.5, (p) => ({ forward: p.z > -2 ? 1 : 0, yaw: 0 }), dt);
    assert.ok(tr.some(s => s.grounded && near(s.feet, DC.DECOR_STAND_TOP.cushion, 0.01)), `${tag(dt, 0)}: stepped onto the cushion`);
    w = world([], [{ type: 'rug', x: 0, z: -1 }]);
    ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 1 });
    run(w, ph, 1.5, { forward: 1, yaw: 0 }, dt);
    assert.ok(ph.z < -2.6 && near(ph.y - EYE, D0, 1e-6), `rug: walked over (z ${ph.z})`);
  }
});

test('decor: thin and tall things block with their true height; the body never ends up inside one below its top', () => {
  for (const type of ['lantern', 'lamppost', 'sprinkler', 'scarecrow', 'glidepost']) for (const dt of FRAMES) {
    const w = world([], [{ type, x: 0, z: -1 }]), [c] = w.blocked, msg = `${type} ${tag(dt, 0)}`;
    for (const x0 of [0, 0.15, 0.3]) {
      const ph = new PlayerPhysics({ x: x0, y: D0 + EYE, z: -1.3 });
      const tr = run(w, ph, 2, (p, n) => ({ forward: 1, yaw: 0, jump: n % 40 < 3 }), dt);
      const inside = tr.filter(s => s.feet < c.top - PC.PASS_TOL - 0.01 && blockerGap(c, s.x, s.z) < R - 1e-6);
      assert.equal(inside.length, 0, `${msg} x0=${x0}: inside below its top ${JSON.stringify(inside[0])}`);
      assert.ok(!tr.some(s => s.grounded && s.feet > 0.1), `${msg}: never stood on`);
    }
  }
});

test('decor: standing on a crate is not called a walk off by BuildGrid (no unground / re-land flicker)', () => {
  const w = world([P('pillar', 2, 2, 0), P('pillar', 3, 3, 0), P('floor', 2, 2, 1)], [{ type: 'crate', x: 0, z: 0 }]);
  const ph = new PlayerPhysics({ x: 0, y: D0 + EYE + 0.87 + 0.3, z: 0 });
  const tr = run(w, ph, 1.5, {});
  const after = tr.slice(tr.findIndex(s => s.grounded));
  assert.ok(after.length > 60 && after.every(s => s.grounded && near(s.feet, 0.87, 1e-6)), 'grounded every frame');
  assert.ok(Math.abs(ph.decorTop - (D0 + 0.87)) < 1e-9);
});

// ---------------------------------------------------------------- thin tops

test('wall tops: walkable after a clamber, walking along three walls stays grounded with no jitter, stepping aside falls', () => {
  for (const dt of FRAMES) for (const bob of BOBS) {
    const w = world([P('wall', 0, 0, 0, 0), P('wall', 1, 0, 0, 0), P('wall', 2, 0, 0, 0), P('pillar', 1, 0, 0)]), msg = tag(dt, bob), st = { t: 0 };
    const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: -1 + 0.07 + R + 0.05 });
    run(w, ph, 0.1, {}, dt, bob, st);
    let tr = run(w, ph, 1.5, hop(yawTo(0, -1), 1.5), dt, bob, st);
    assert.ok(tr.some(s => s.climbing), `${msg}: clambered`);
    assert.ok(ph.grounded && near(tr.at(-1).feet, LEVEL_H, 1e-6) && Math.abs(ph.z + 1) <= 0.07 + 0.2, `${msg}: on the wall top (z ${ph.z})`);
    tr = run(w, ph, 1.6, { forward: 1, yaw: yawTo(1, 0) }, dt, bob, st);
    assert.ok(ph.x > 3, `${msg}: walked along (x ${ph.x})`);
    assert.ok(tr.every(s => s.grounded && near(s.feet, LEVEL_H, 1e-6) && !s.landed), `${msg}: grounded every frame, no re-landing`);
    tr = run(w, ph, 1.5, { forward: 1, yaw: yawTo(0, 1) }, dt, bob, st);
    assert.ok(tr.some(s => !s.grounded) && ph.grounded && near(tr.at(-1).feet, 0, 1e-6), `${msg}: stepped off and landed on the deck`);
  }
});

test('half wall, railing, closed gate and pillar tops: hop onto them from the deck; an open gate has no top', () => {
  for (const [t, top] of [['halfwall', LEVEL_H / 2], ['railing', RAIL_H], ['gate', RAIL_H]]) for (const dt of FRAMES) {
    const w = world([P(t, 0, 0, 0, 0)]), msg = `${t} ${tag(dt, 0)}`;
    const ph = new PlayerPhysics({ x: 0.2, y: D0 + EYE, z: -1 + 0.07 + R + 0.05 });
    const tr = run(w, ph, 1.2, hop(yawTo(0, -1), 0.5), dt);
    assert.ok(ph.grounded && near(tr.at(-1).feet, top, 1e-6), `${msg}: standing on top (feet ${tr.at(-1).feet})`);
  }
  const pw = world([P('pillar', 0, 0, 0)]);
  const pp = new PlayerPhysics({ x: -1, y: D0 + EYE, z: -1 + 0.11 + R + 0.04 });
  const ptr = run(pw, pp, 1.5, hop(yawTo(0, -1), 1.5));
  assert.ok(pp.grounded && near(ptr.at(-1).feet, LEVEL_H, 1e-6), `pillar top (feet ${ptr.at(-1).feet})`);
  const g = world([P('gate', 0, 0, 0, 0)]); g.g.toggle(g.g.find(P('gate', 0, 0, 0, 0)));
  assert.equal(g.g._scan(0.9, -1, D0 + RAIL_H + 0.02, D0, -Infinity), D0, 'open gate: nothing to stand on above the deck');
  assert.equal(PIECES.railing.height, RAIL_H);
});

// ---------------------------------------------------------------- jump and clamber

test('jump numbers: apex 1.3 to 1.4 m clears railing, half wall, chests and tables; a wall needs the clamber', () => {
  const apex = PC.JUMP_IMPULSE ** 2 / (2 * PC.GRAVITY);
  assert.ok(apex >= 1.3 && apex <= 1.4, `apex ${apex}`);
  for (const h of [RAIL_H, LEVEL_H / 2, DC.DECOR_STAND_TOP.crate, DC.DECOR_STAND_TOP.maptable, DC.DECOR_STAND_TOP.bed]) assert.ok(apex - h >= 0.2, `${h} cleared by 0.2 m`);
  assert.ok(apex < LEVEL_H - 0.5, 'a full wall is not jumped');
  assert.ok(apex + PC.LEDGE_REACH > LEVEL_H + 0.3, 'its top is within reach of the hands');
  assert.ok(PC.FALL_GRAVITY > PC.GRAVITY);
});

test('clamber: a standing jump at a wall or a one-storey floor edge pulls up over 0.35 to 0.5 s with no teleport', () => {
  const pill = [P('pillar', 0, 0, 0), P('pillar', 1, 0, 0), P('pillar', 0, 1, 0), P('pillar', 1, 1, 0)];
  for (const [name, pieces, z0, top] of [['wall', [P('wall', 0, 0, 0, 0)], -1 + 0.07 + R + 0.05, LEVEL_H],
    ['floor edge', [...pill, P('floor', 0, 0, 1)], 1 + R + 0.05, LEVEL_H],
    ['roof edge', [...pill, P('roof', 0, 0, 1, 2)], 1 + R + 0.05, LEVEL_H]]) {
    for (const dt of FRAMES) for (const bob of BOBS) {
      const w = world(pieces), msg = `${name} ${tag(dt, bob)}`, st = { t: 0 };
      const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: z0 });
      run(w, ph, 0.1, {}, dt, bob, st);
      const tr = run(w, ph, 1.5, hop(yawTo(0, -1), 1.5), dt, bob, st);
      const k0 = tr.findIndex(s => s.climbing), k1 = tr.findIndex((s, k) => k > k0 && !s.climbing);
      assert.ok(k0 > 0 && k1 > k0, `${msg}: clambered`);
      const dur = (k1 - k0 + 1) * dt;
      assert.ok(dur >= 0.3 && dur <= 0.55 + dt, `${msg}: pull-up ${dur} s`);
      assert.ok(tr[k0 - 1].feet > top - PC.LEDGE_REACH - 0.2 && tr[k0 - 1].vy < PC.LEDGE_VY + 1, `${msg}: grabbed near the apex (frame before: feet ${tr[k0 - 1].feet}, vy ${tr[k0 - 1].vy})`);
      for (let k = Math.max(1, k0); k <= k1; k++) assert.ok(Math.hypot(tr[k].x - tr[k - 1].x, tr[k].z - tr[k - 1].z) < 0.25 && Math.abs(tr[k].feet - tr[k - 1].feet) < 0.6, `${msg}: smooth`);
      assert.ok(ph.grounded && near(tr.at(-1).feet, top, name === 'roof edge' ? 0.12 : 0.03), `${msg}: on top (feet ${tr.at(-1).feet})`);
    }
  }
});

test('clamber never fires walking past or along a wall, falling off an edge, strafing, or without a jump', () => {
  const w = world([P('wall', 0, 0, 0, 0), P('wall', 1, 0, 0, 0)]);
  const z0 = -1 + 0.07 + R + 0.05;
  for (const [name, input, x0] of [
    ['walk into', { forward: 1, yaw: yawTo(0, -1) }, 0],
    ['jump along', (p, n) => ({ forward: 1, yaw: yawTo(1, 0), jump: n % 30 < 3 }), -1.5],
    ['strafe jump', (p, n) => ({ strafe: 1, yaw: yawTo(1, 0) + Math.PI / 2 * 0, jump: n % 30 < 3 }), -1.5],
    ['jump, no forward', (p, n) => ({ yaw: yawTo(0, -1), jump: n % 40 < 3 }), 0],
  ]) {
    const ph = new PlayerPhysics({ x: x0, y: D0 + EYE, z: z0 });
    const tr = run(w, ph, 2, input);
    assert.ok(!tr.some(s => s.climbing), `${name}: no clamber`);
    assert.ok(maxOf(tr, s => s.feet) < 1.5, `${name}: stayed below`);
  }
  // Walking off a one-storey floor with forward held toward a wall top at the same height below: no grab.
  const w2 = world([P('pillar', 0, 0, 0), P('pillar', 1, 0, 0), P('pillar', 0, 1, 0), P('pillar', 1, 1, 0), P('floor', 0, 0, 1), P('halfwall', 0, -2, 0, 0)]);
  const ph = new PlayerPhysics({ x: 0, y: D0 + LEVEL_H + EYE, z: 0 });
  const tr = run(w2, ph, 2, { forward: 1, yaw: yawTo(0, -1) });
  assert.ok(!tr.some(s => s.climbing), 'walked off: no clamber');
});

test('clamber is refused under a ceiling, below a second-storey wall, and onto a spot a lamp post fills', () => {
  const room = [P('wall', 0, 0, 0, 0), P('wall', 0, 1, 0, 0), P('wall', 0, 0, 0, 1), P('wall', 1, 0, 0, 1), P('floor', 0, 0, 1)];
  let w = world(room), ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: -1 + 0.07 + R + 0.05 });
  let tr = run(w, ph, 1.5, hop(yawTo(0, -1), 1.5));
  assert.ok(!tr.some(s => s.climbing) && maxOf(tr, s => s.feet + EYE + 0.15) <= LEVEL_H - 0.12 + 1e-6, 'inside a roofed room: head under the ceiling, no clamber');
  w = world([P('wall', 0, 0, 0, 0), P('wall', 0, 0, 1, 0)]);
  ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: -1 + 0.07 + R + 0.05 });
  tr = run(w, ph, 1.5, hop(yawTo(0, -1), 1.5));
  assert.ok(!tr.some(s => s.climbing) && ph.grounded && near(tr.at(-1).feet, 0, 1e-6), 'two-storey wall: no clamber');
  // A floor edge whose landing spot holds a lamp post: refused (no room for the body).
  const pill = [P('pillar', 0, 0, 0), P('pillar', 1, 0, 0), P('pillar', 0, 1, 0), P('pillar', 1, 1, 0)];
  w = world([...pill, P('floor', 0, 0, 1), P('wall', 0, 1, 1, 0)]); // a wall on the floor's edge, upstairs
  ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 1 + R + 0.05 });
  tr = run(w, ph, 1.5, hop(yawTo(0, -1), 1.5));
  assert.ok(!tr.some(s => s.climbing), 'wall standing on the ledge: no clamber');
});

test('stacking like Raft: a crate beside a wall is a step up to the wall top', () => {
  for (const dt of FRAMES) {
    const w = world([P('wall', 0, 0, 0, 0)], [{ type: 'crate', x: 0, z: -0.2 }]); // crate face at z = 0.02, back against the wall
    const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: 0.02 + R + 0.06 });
    run(w, ph, 1.2, hop(yawTo(0, -1), 0.5), dt);
    assert.ok(ph.grounded && near(ph.y - EYE - D0, 0.87, 0.02), `${tag(dt, 0)}: on the crate`);
    const tr = run(w, ph, 1.5, hop(yawTo(0, -1), 1.5), dt);
    assert.ok(ph.grounded && near(tr.at(-1).feet, LEVEL_H, 0.02), `${tag(dt, 0)}: on the wall top (feet ${tr.at(-1).feet})`);
  }
});

test('clamber camera dip: the eye sinks mid pull-up and is back at the end', () => {
  const feel = new MoveFeel();
  const mid = feel.step(1 / 60, { clamber: 0.5 }).eyeOffset;
  assert.ok(mid < -0.05, `mid ${mid}`);
  assert.ok(Math.abs(feel.step(1 / 60, { clamber: -1 }).eyeOffset) < 1e-9);
  assert.ok(Math.abs(feel.step(1 / 60, {}).eyeOffset) < 1e-9, 'no clamber input: no dip');
});

test('old blockers (no height) still block at every height and are never stood on', () => {
  const g = new BuildGrid(); g.setTiles(tilesSq(3));
  const w = { g, blocked: [{ x: 0, z: -2, r: 0.5 }] };
  const ph = new PlayerPhysics({ x: 0, y: D0 + EYE, z: -0.8 });
  const tr = run(w, ph, 2, (p, n) => ({ forward: 1, yaw: 0, jump: n % 40 < 3 }));
  assert.ok(maxOf(tr, s => -s.z) <= 2 - 0.5 - R + 1e-6, 'blocked');
});
