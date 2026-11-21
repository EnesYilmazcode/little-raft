// AUDIT INV-1: Bag.fromCounts silently discards legacy (v2) stock that does not fit in the 28-slot bag.
// v2 stock was uncapped (nets auto-collect forever), so long-running v2 rafts lose supplies on upgrade.
// Contract for the fix: every unit is either in the bag or reported in bag.migrationOverflow[kind].
// Run: node --test tests/audit/inv1_legacy_migration_overflow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href
  : new URL('../../dist/', import.meta.url).href;
const { Bag } = await import(new URL('inventory-state.js', base));

test('INV-1: fromCounts keeps or reports every legacy supply that exceeds bag capacity', () => {
  const legacy = { wood: 500, leaf: 60, scrap: 30 }; // realistic v2 kinds (v2 had no plastic)
  const bag = Bag.fromCounts(legacy, { tools: ['hook', 'hammer'] });
  const overflow = bag.migrationOverflow ?? {};
  for (const [k, n] of Object.entries(legacy)) {
    assert.equal(bag.count(k) + (overflow[k] ?? 0), n, `${k}: kept ${bag.count(k)} of ${n}, rest discarded without trace`);
  }
});

test('INV-1: migration does not starve later kinds (scrap/leaf) when wood alone fills the bag', () => {
  const bag = Bag.fromCounts({ wood: 600, leaf: 120, scrap: 40 }, { tools: ['hook', 'hammer'] });
  assert.ok(bag.count('leaf') > 0, 'all leaf lost: wood consumed every free slot');
  assert.ok(bag.count('scrap') > 0, 'all scrap lost: wood consumed every free slot');
});
