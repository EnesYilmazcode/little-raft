// Regression tests for round-5 tool fixes (TOOL-1..6): R repairs any worn tool, hold R steers before rotating,
// a held instrument yields to E prompts, a cup at a busy station does not drink, the seafloor follows sailing,
// and an on-but-dry motor says "Turn off".
// Run: node --test tests/r5-tools.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const T = await import(new URL('vendor/three.module.js', base));
const { repairHookSlot } = await import(new URL('coop-rules.js', base));
const { repairCost, toolRole } = await import(new URL('items.js', base));
const { pickPrompt } = await import(new URL('prompts.js', base));
const I = await import(new URL('instruments.js', base));
const SF = await import(new URL('seafloor.js', base));
const { Bag, SLOT_COUNT } = await import(new URL('inventory-state.js', base));
const { createEngine } = await import(new URL('engine.js', base));
const { defaultSailing, SAIL } = await import(new URL('sailing-core.js', base));
const gameSrc = readFileSync(fileURLToPath(new URL('game.js', base)), 'utf8');

const PICK = { costOf: repairCost, roleOf: toolRole };
const tool = (kind, d) => ({ kind, count: 1, durability: d });

// ---------- TOOL-1 ----------
test('TOOL-1: R repairs the selected worn tool (metal hook, spear), else a worn hook-role tool', () => {
  const slots = [tool('hook', 90), tool('metalhook', 5), tool('spear', 0), tool('metalspear', 30), null];
  assert.equal(repairHookSlot(slots, 1, 100, PICK), 1, 'selected metal hook');
  assert.equal(repairHookSlot(slots, 2, 100, PICK), 2, 'selected spear');
  assert.equal(repairHookSlot(slots, 3, 100, PICK), 3, 'selected metal spear');
  assert.equal(repairHookSlot([tool('metalhook', 5)], 0, 100, PICK), 0, 'only a metal hook');
  // nothing repairable selected: the most worn hook-role tool (metal hook counts)
  assert.equal(repairHookSlot([tool('hook', 90), tool('metalhook', 20), { kind: 'wood', count: 3 }], 2, 100, PICK), 1);
  // a full selected spear falls back to a worn hook; with no worn hook the spear itself ("in great shape")
  assert.equal(repairHookSlot([tool('hook', 40), tool('spear', 100)], 1, 100, PICK), 0);
  assert.equal(repairHookSlot([tool('hook', 100), tool('spear', 100)], 1, 100, PICK), 1);
  assert.equal(repairHookSlot([{ kind: 'wood', count: 1 }], 0, 100, PICK), -1, 'no tool');
  assert.equal(repairHookSlot([tool('spear', 0)], 0, 100, PICK), 0, 'spear alone');
});

test('TOOL-1: legacy call (no options) keeps the hook-only rule', () => {
  assert.equal(repairHookSlot([tool('metalhook', 5)], 0, 100), -1);
  assert.equal(repairHookSlot([tool('hook', 10), tool('hook', 90)], 1, 100), 1);
});

test('TOOL-1: host charges the repaired kind and names it; the client sends only its selected slot', () => {
  assert.match(gameSrc, /repairHookSlot\(bag\.slots, a\.slot, MAX_HEALTH, REPAIR_PICK\)/);
  assert.match(gameSrc, /const cost = repairCost\(bag\.slots\[i\]\.kind\) \?\? REPAIR_COST/);
  assert.match(gameSrc, /text:name \+ ' repaired!'/);
  assert.match(gameSrc, /'No worn tool to repair'/);
  assert.match(gameSrc, /action\(\{kind:'repair', slot:bag\.selectedIndex\}\)/);
  assert.deepEqual(repairCost('metalhook'), { scrap: 2, nail: 2 });
});

// ---------- TOOL-2 ----------
test('TOOL-2: keyboard and pad try sailing.grab() before rotating or repairing', () => {
  assert.match(gameSrc, /if \(running && e\.code === 'KeyR' && !e\.repeat && sailing\?\.grab\(\)\) \{ e\.stopImmediatePropagation\(\); e\.preventDefault\(\); return; \}[^\n]*\n\s*if \(running && building\?\.key\(/,
    'keydown: grab runs before the hammer piece rotate');
  assert.match(gameSrc, /repair:back => \{ if \(sailing\?\.grab\(\)\) return; if \(running && DECOR_TYPES/);
  assert.match(gameSrc, /if \(e\.code === 'KeyR' && !e\.repeat\) \{ if \(sailing\?\.grab\(\)\) return; if \(running && DECOR_TYPES/);
});

// ---------- TOOL-3 ----------
test('TOOL-3: the instrument prompt sits under station providers and steps aside for E targets', () => {
  assert.ok(I.INSTRUMENT_PRIORITY < 1 && I.INSTRUMENT_PRIORITY > 0.5);
  const inst = { prompts: [{ key: 'LMB', label: 'Play' }], priority: I.INSTRUMENT_PRIORITY, ray: false, order: 0 };
  const eng = { prompts: [{ key: 'E', label: 'Start motor' }], priority: 1, ray: false, order: 5 };
  assert.equal(pickPrompt([inst, eng])[0].label, 'Start motor');
  assert.equal(I.hasETarget({ watering: { target: { e: 'takeWater' } } }, null), true);
  assert.equal(I.hasETarget({}, ['E']), true);
  assert.equal(I.hasETarget({}, ['Click']), false, 'a click row is not an E target');
  assert.equal(I.hasETarget({ watering: { target: { e: null } } }, []), false);

  let provider = null;
  const prev = globalThis.window;
  globalThis.window = { raftPrompts: { provide(o) { provider = o; return () => {}; } } };
  try {
    const host = { scene: new T.Scene(), camera: new T.PerspectiveCamera(), pitch: () => 0, send() {}, netReady: () => true, note: () => true, friendPos: () => null, now: () => 0 };
    const ins = I.createInstruments(T, host);
    assert.equal(provider.priority, I.INSTRUMENT_PRIORITY);
    assert.equal(provider.prompt({ state: { heldKind: 'drum', role: 'solo' } })[0].label, 'Play');
    assert.equal(provider.prompt({ state: { heldKind: 'drum', role: 'solo', watering: { target: { e: 'takeWater' } } } }), null);
    ins.dispose();
  } finally { if (prev === undefined) delete globalThis.window; else globalThis.window = prev; }
});

// ---------- TOOL-4 ----------
test('TOOL-4: a cup aimed at a busy station shows why instead of drinking', () => {
  assert.match(gameSrc, /if \(w\?\.click\) \{ swing = 1; action\(w\.click\); \} else if \(w\?\.why\) notice\(w\.why\); else startEat\(kind\);/);
  assert.match(gameSrc, /if \(waterAim\?\.why && CUP_KINDS\.includes\(k\)\) \{ eatTip = null; return; \}/);
});

// ---------- TOOL-5 ----------
test('TOOL-5: default frame is unchanged; a ground frame shelves islands where they are displayed', () => {
  const isl = [{ x: Math.sin(.75) * 80, z: Math.cos(.75) * 80, r: 5.4 }];
  for (const [x, z] of [[3, 4], [40, 50], [-20, 7]]) {
    assert.equal(SF.seafloorHeight(x, z, isl, { gx: 0, gz: 0, wrap: SAIL.ISLAND_WRAP }), SF.seafloorHeight(x, z, isl));
  }
  // sail g: the island is displayed at wrap(b - g); the ground point under it is display + g
  const g = { gx: -57.4, gz: -20.6, wrap: SAIL.ISLAND_WRAP };
  const wrap = (v, W) => v - 2 * W * Math.floor((v + W) / (2 * W));
  const dx = wrap(isl[0].x - g.gx, g.wrap), dz = wrap(isl[0].z - g.gz, g.wrap);
  const under = SF.seafloorHeight(dx + g.gx, dz + g.gz, isl, g);
  assert.ok(under > -1.5, `shoal under the displayed island (${under})`);
  // a far-wrapped ground (a long voyage) still finds the shoal under the island image
  const far = { gx: 300 * 7 - 57.4, gz: -300 * 3 - 20.6, wrap: SAIL.ISLAND_WRAP };
  assert.ok(SF.seafloorHeight(dx + far.gx, dz + far.gz, isl, far) > -1.5);
  // the raft-deep cap follows the raft (scene origin), not the ground origin
  assert.ok(SF.seafloorHeight(g.gx, g.gz, isl, g) <= SF.FLOOR.MIN_DEPTH_UNDER_RAFT + 1e-9);
});

test('TOOL-5: the floor group, nodesNear and heightAt use the sailing ground frame; ids validate with that frame', () => {
  const isl = [{ x: 70, z: 0, r: 5 }];
  const ground = { gx: 0, gz: 0 };
  const floor = SF.createSeafloor(T, { islands: isl, ground: () => ground, wrap: SAIL.ISLAND_WRAP });
  const cam = { position: { x: 20, y: -5, z: 10 } };
  floor.update(0.016, cam, 1);
  const before = floor.nodesNear(20, -10, 10, 30);
  assert.ok(before.length, 'nodes near the camera');
  ground.gx = 12; ground.gz = -8; // the raft sailed +12, -8 m: the world moved past by -12, +8
  floor.update(0.016, cam, 1);
  assert.deepEqual([floor.group.position.x, floor.group.position.z], [-12, 8]);
  const n0 = before[0];
  const moved = floor.nodesNear(n0.x - 12, n0.y, n0.z + 8, 0.5).find(n => n.id === n0.id);
  assert.ok(moved, 'the same node, displaced with the ground');
  assert.ok(Math.abs(moved.x - (n0.x - 12)) < 1e-9 && Math.abs(moved.z - (n0.z + 8)) < 1e-9);
  // heightAt in scene space follows the ground too (away from the raft cap)
  const fixed = SF.seafloorHeight(40, 40, isl);
  assert.ok(Math.abs(floor.heightAt(40 - 12, 40 + 8) - fixed) < 1e-9);
  // host validation: nodeById with the floor's frame gives the ground node; minus g is the scene position
  const f = floor.frame, n = SF.nodeById(moved.id, isl, f);
  assert.ok(n && Math.abs(n.x - f.gx - moved.x) < 1e-9 && Math.abs(n.z - f.gz - moved.z) < 1e-9);
  assert.match(gameSrc, /nodeById\(a\.id, islands, f\)/);
  assert.match(gameSrc, /ground:\(\) => sailing\?\.ground \?\? null, wrap:sailing\?\.islandWrap \?\? 0/);
  floor.dispose();
});

// ---------- TOOL-6 ----------
test('TOOL-6: a motor left on with 0 fuel reads "Turn off · Out of fuel"; the wheel follows runningCount', () => {
  const bag = new Bag({ slots: new Array(SLOT_COUNT).fill(null), selected: 0 });
  const world = { tiles: [[0, 0], [1, 0], [0, 1]], decor: [{ type: 'motor', x: 1, z: 0 }, { type: 'wheel', x: 0, z: 1 }], sailing: defaultSailing(), ext: {} };
  const ctx = { T: null, world, role: 'solo', running: true, physics: { x: 0, z: 0 }, camera: { position: { x: 0, y: 1.6, z: 0 } }, raft: null,
    localBag: () => bag, actorBag: () => bag, emit() {}, rebuildRaft() {}, action() {} };
  const mod = createEngine(ctx);
  const at = (x, y, z) => { const v = [x, y - 1.6, z], l = Math.hypot(...v); return { dir: { x: v[0] / l, y: v[1] / l, z: v[2] / l } }; };
  const motor = at(2, .65, 0), wheel = at(0, 1.05, 2);
  mod.debug.set(1, 0, true); // on, 0 fuel: stays on (docs/specs/engine.md) but does not run
  assert.deepEqual(mod.promptRows(motor), [{ key: 'E', label: 'Turn off' }, { label: 'Out of fuel', muted: true }]);
  assert.match(mod.prompt(motor), /<kbd>E<\/kbd>Turn off · Out of fuel/);
  assert.equal(mod.promptRows(wheel)[0].label, 'Turn off motors · out of fuel');
  mod.debug.fuel(1, 0, 60);
  assert.deepEqual(mod.promptRows(motor)[0], { key: 'E', label: 'Stop motor' });
  assert.equal(mod.promptRows(wheel)[0].label, 'Stop motors');
  mod.debug.set(1, 0, false);
  assert.deepEqual(mod.promptRows(motor)[0], { key: 'E', label: 'Start motor' });
  assert.equal(mod.promptRows(wheel)[0].label, 'Start motors');
  mod.debug.fuel(1, 0, 0);
  assert.deepEqual(mod.promptRows(motor), [{ key: 'E', label: 'Start motor' }, { label: 'Needs fuel', muted: true }]);
});
