// Round-6 survival regressions: fainting blocks input, solo pause stops the shark, spear wear/repair, shader warm-up vs dispose.
// Run: node --test tests/r6-surv.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const game = readFileSync(new URL('game.js', base), 'utf8');
const fnBody = (name, src = game) => {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' exists');
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1); }
  throw new Error('unbalanced ' + name);
};
const head = (src) => src.split("\n").slice(0, 3).join('\n');

test('V1: every input entry point refuses while passed out', () => {
  for (const name of ['beginCharge', 'releaseCharge', 'interact', 'openInventory', 'repair', 'selectSlot', 'pickBuildPiece']) {
    assert.match(head(fnBody(name)), /fainted >= 0/, name + ' checks fainted');
  }
  // releaseCharge still drops the charge before the check, so a press held into the faint never throws later
  assert.match(fnBody('releaseCharge'), /const c = charging; charging = null;\s*\n\s*if \(!c \|\| !running \|\| fainted >= 0/);
  const down = game.slice(game.indexOf("on(canvas, 'pointerdown'"), game.indexOf("on(canvas, 'pointermove'"));
  assert.match(down.split('\n')[1], /fainted >= 0\) return/, 'canvas pointerdown bails first (tool, wheel, fc)');
  assert.match(game, /useDown:\(\) => \{ if \(fainted >= 0\) return;/, 'pad / input-layer use bails');
  assert.match(game, /if \(running && fainted >= 0\) \{[^\n]*return; \}[^\n]*\n\s*if \(running && building\?\.key/, 'legacy keydown acts on nothing while passed out');
});

test('V1: waking clears any hook/charge and re-checks the pointer UI', () => {
  const v = fnBody('updateVitals');
  const wake = v.slice(v.indexOf('if (fainted >= 2.6)'), v.indexOf("notice('You wake up"));
  assert.match(wake, /charging = null/);
  assert.match(wake, /if \(hook\) \{ fishWait = 0; endHook\(\); \}/);
  assert.match(v, /You wake up on the raft[^\n]*refreshPointerUI\(true\)/);
  assert.match(v, /fainted = 0;[^\n]*building\.menu\.close\(false\)/, 'fainting closes the build wheel');
});

test('V2: the solo pause menu freezes the shark and its damage; host/guest never pause', () => {
  const f = fnBody('frame');
  assert.match(f, /soloPaused = role === 'solo' && dialog && dialogOpen\(\);/, 'computed once per frame, solo only');
  assert.match(f, /if \(shark && !soloPaused\) \{ try \{ shark\.update\(dt, elapsed, running\); \}/, 'shark.update skipped entirely (not dt=0 / inactive)');
  assert.ok(f.indexOf('soloPaused =') < f.indexOf('shark.update'), 'set before the shark runs');
  assert.match(head(fnBody('hurtPlayer')), /soloPaused\) return 0;/, 'no damage while solo paused');
  assert.match(fnBody('updateVitals'), /if \(soloPaused\) return;/, 'vitals clock uses the same flag');
  assert.equal((game.match(/soloPaused = /g) || []).length, 2, 'declaration + one per-frame writer');
});

const { attachSpearRepair } = await import(new URL('spear-repair-hooks.js', base));
const { Bag } = await import(new URL('inventory-state.js', base));
const { repairCost } = await import(new URL('items.js', base));
const V3 = class { constructor() { this.x = 0; this.y = 0; this.z = -1; } };
const camStub = { getWorldPosition: (v) => v, getWorldDirection: (v) => v };
function spearRig(role) {
  const sent = [], notes = [], bag = new Bag({ slots: new Array(28).fill(null), selected: 0 });
  bag.add('spear', 1); bag.select(bag.slots.findIndex((s) => s?.kind === 'spear'));
  const rep = attachSpearRepair({ T: { Vector3: V3 }, camera: () => camStub, localBag: () => bag, role: () => role, elapsed: () => 10,
    shark: () => ({ trySpear: () => true }), action: (a) => sent.push(a), emit: (e) => notes.push(e), notice() {}, beep() {} });
  return { rep, bag, sent, notes, i: bag.selectedIndex };
}

test('V4a: a guest never sends a standalone spearHit; the host ignores one from a guest', () => {
  const g = spearRig('guest');
  assert.equal(g.rep.use(), true);
  assert.deepEqual(g.sent.filter((a) => a.kind === 'spearHit'), [], 'guest wear rides on the accepted shark:hit');
  const h = spearRig('host'), i = h.i;
  assert.ok(h.rep.apply({ kind: 'spearHit', slot: i }, 'guest', h.bag), 'still consumed');
  assert.equal(h.bag.slots[i].durability, 100, 'a guest spearHit wears nothing');
  assert.ok(h.rep.apply({ kind: 'spearHit', slot: i }, 'host', h.bag));
  assert.ok(h.bag.slots[i].durability < 100, "the host's own hit wears its spear");
  const before = h.bag.slots[i].durability;
  assert.equal(h.rep.wearHit(h.bag, i, 'guest'), true);
  assert.ok(h.bag.slots[i].durability < before, 'wearHit wears the hitting slot');
  h.rep.dispose(); g.rep.dispose();
});

test('V4a: the host wears a guest spear only inside an accepted shark:hit', () => {
  const i = game.indexOf("if (a.kind === 'shark:hit')");
  const lines = game.slice(i, game.indexOf('\n    }', i)).split('\n');
  assert.match(lines[2], /\) return;$/, 'rejection returns before any wear');
  assert.match(lines[3], /shark\.applyHit\(a\.dmg\); spearRep\?\.wearHit\(bag, a\.slot, actor\);/);
  assert.match(game, /sendHit:dmg => action\(\{kind:'shark:hit', dmg, slot:localBag\(\)\.selectedIndex\}\)/, 'one combined action carries the slot');
});

test('V4b: R with a spear repairs that spear, not a hook elsewhere', () => {
  assert.ok(repairCost('spear') && repairCost('metalspear'), 'spears have repair costs');
  const r = fnBody('repair');
  assert.match(r, /const own = sel && PROG_ITEMS\[sel\.kind\]\?\.tool && !isHookSlot\(sel\);/);
  assert.match(r, /slot:own \? bag\.selectedIndex : repairHookSlot\(/);
  const i = game.indexOf("if (a.kind === 'repair') {");
  const block = game.slice(i, game.indexOf("if (a.kind === 'eat')", i));
  assert.ok(block.indexOf('PROG_ITEMS[sel.kind]?.tool') < block.indexOf('repairHookSlot('), 'held tool checked before the hook fallback');
  assert.match(block, /bag\.slots\[a\.slot\]\.durability = MAX_HEALTH/, 're-reads the slot after spend() replaced it');
});
