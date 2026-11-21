// HUD layout regression: the logbook toast stays one line above the sail compass badge.
// Run: node --test tests/hud-layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const rule = (css, sel) => { // the rule whose selector list is exactly `sel`
  const m = new RegExp('(^|[}\\n`])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{').exec(css); assert.ok(m, `rule ${sel}`);
  return css.slice(m.index, css.indexOf('}', m.index + m[0].length));
};

test('HUD-6: the logbook toast is one line that ends above the sail compass badge', () => {
  const t = rule(src('logbook-ui.js'), '#lb-toast');
  const top = +/top:(\d+)px/.exec(t)[1], h = +/max-height:(\d+)px/.exec(t)[1];
  const badge = +/top:(\d+)px/.exec(rule(src('sailing-ui.js'), '#sailBadge'))[1];
  assert.ok(top + h + 2 < badge, `${top}+${h} < ${badge}`); // +2: the toast's outer ring
  assert.match(t, /white-space:nowrap/); assert.match(t, /overflow:hidden/);
  assert.doesNotMatch(src('logbook-ui.js'), /#lb-toast\{top:52px\}/);
});
