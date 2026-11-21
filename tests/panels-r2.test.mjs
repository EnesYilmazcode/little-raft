// Regression tests for the panels findings UX3-2, UX3-4, UX3-5 and UX3-6 (round 3).
// Run: node --test tests/panels-r2.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = name => readFileSync(fileURLToPath(new URL(name, base)), 'utf8');

// ---------------------------------------------------------------- UX3-2 one right-hand side sheet

const sheetRule = () => {
  const css = src('graphics.css');
  const m = css.match(/dialog\.lr-sheet\{([^}]*)\}/);
  assert.ok(m, 'graphics.css defines dialog.lr-sheet');
  return { css, rule: m[1] };
};

test('UX3-2: the side sheet docks to the right edge, clears the crosshair and never blurs', () => {
  const { css, rule } = sheetRule();
  assert.match(rule, /position:fixed/);
  assert.match(rule, /inset:0 0 0 auto/, 'flush to the right edge, full height');
  assert.match(rule, /margin:0/, 'not centred');
  assert.match(rule, /width:min\([^;]*calc\(50vw - 40px\)\)/, 'never reaches the centre crosshair');
  const back = css.match(/dialog\.lr-sheet::backdrop\{([^}]*)\}/)?.[1] || '';
  assert.match(back, /(^|;)backdrop-filter:none/, 'no blur over the station');
  assert.match(css, /@media\(max-width:760px\)\{dialog\.lr-sheet[^{]*\{inset:auto 0 0 0/, 'bottom sheet on narrow screens');
});

test('UX3-2: station, research, logbook and notebook use the sheet and no ID rule overrides it', () => {
  const panels = [
    ['smelter-ui.js', 'stationPanel', /dlg\.className = '[^']*\blr-sheet\b/],
    ['progression-hooks.js', 'researchPanel', /research\.className = '[^']*\blr-sheet\b/],
    ['logbook-ui.js', 'logbook', /d\.className = '[^']*\blr-sheet\b/],
    ['fish-journal.js', 'fcJournal', /el\('dialog', '[^']*\blr-sheet\b/],
  ];
  for (const [file, id, uses] of panels) {
    const s = src(file);
    assert.match(s, uses, `${id} gets the lr-sheet class`);
    // Every rule that targets the dialog itself (not a child) must leave layout to the shared class.
    const own = [...s.matchAll(new RegExp(`#${id}(?:\\.[\\w-]+)*(?:::backdrop)?\\{([^}]*)\\}`, 'g'))].map(m => m[1]);
    for (const body of own) {
      assert.doesNotMatch(body, /(^|;)\s*(margin|width|max-width|max-height|position|inset|padding)\s*:/, `${id} keeps no layout rule: ${body}`);
      assert.doesNotMatch(body, /background:rgba/, `${id} keeps no backdrop of its own`);
    }
  }
});

test('UX3-2: How to play is a page inside the pause rail, not a centred dialog', () => {
  const html = src('index.html'), settings = src('settings.js'), game = src('game.js');
  assert.doesNotMatch(html, /<dialog id="help"/, '#help is no longer a dialog');
  assert.match(html, /<div id="help"[^>]*hidden/, 'the guide markup stays hidden until the pause menu adopts it');
  assert.match(settings, /data-panel="help"/, 'pause menu has a help page');
  assert.doesNotMatch(settings, /act === 'help' \|\| act === 'crew'/, 'help is not opened with showModal');
  assert.doesNotMatch(game, /\['crew', 'help'\]/);
});
