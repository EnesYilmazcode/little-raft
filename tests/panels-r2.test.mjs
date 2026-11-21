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

// ---------------------------------------------------------------- UX3-4 recipe list room, scroll cue, frozen order

test('UX3-4: recipe rows sort only when the bag opens, never while it is open', async () => {
  const { recipeOrder } = await import(new URL('craft-book.js', base));
  const row = (id, cat, state, short = 0) => ({ id, cat, state, rows: short ? [{ enough: false, short }] : [] });
  // Hammer was ready, the player crafted it, now it is missing: the frozen order keeps it in place.
  const views = [row('hook', 'tools', 'ready'), row('hammer', 'tools', 'missing', 2), row('drum', 'tools', 'ready'), row('plank', 'mats', 'ready')];
  assert.deepEqual(recipeOrder(views, ['tools', 'mats']).map(v => v.id), ['hook', 'hammer', 'drum', 'plank'], 'frozen while open');
  assert.deepEqual(recipeOrder(views, ['tools', 'mats'], { resort: true }).map(v => v.id), ['hook', 'drum', 'hammer', 'plank'], 'craftable first on open');
  const ui = src('survival-ui.js');
  assert.doesNotMatch(ui, /sortCraftableFirst\(/, 'survival-ui never re-sorts on its own');
  assert.match(ui, /function open\(\)[\s\S]{0,600}resortOnPaint = true;[\s\S]{0,80}buildRecipes\(\)/, 'open() asks for one sort');
  assert.match(ui, /recipeOrder\(recipeEls, .*\{ resort: resortOnPaint \}\);\s*resortOnPaint = false;/, 'and the flag clears after it');
});

test('UX3-4: the detail card leaves the list the whole column, and hidden rows show a fade cue', async () => {
  const { moreBelow } = await import(new URL('craft-book.js', base));
  assert.equal(moreBelow(600, 0, 400), true);
  assert.equal(moreBelow(600, 200, 400), false, 'scrolled to the bottom');
  assert.equal(moreBelow(400, 0, 400), false, 'everything fits');
  const ui = src('survival-ui.js');
  assert.match(ui, /\.sv-rlist\.sv-more\{[^}]*mask-image:linear-gradient/);
  assert.match(ui, /wideBag\?\.matches \? dlg\.querySelector\('\.sv-bag'\)/, 'wide layout docks the detail card under the backpack');
  assert.doesNotMatch(ui, /sv-hint\{[^}]*width:\$\{HB \* 62/, 'hint width follows the slot size, so the bag fits 900px');
});

// ---------------------------------------------------------------- UX3-5 no icon pop-in

test('UX3-5: bag icons are rendered before play starts, and a provider swap never blanks a slot', async () => {
  const icons = await import(new URL('item-icons.js', base));
  assert.equal(typeof icons.renderIconsNow, 'function');
  assert.deepEqual(icons.renderIconsNow([]), []);
  assert.doesNotThrow(() => icons.renderIconsNow(['wood', 'scrap'])); // no WebGL in node: flat sprites, no throw
  const fn = () => null;
  icons.setModelProvider(fn);
  assert.doesNotThrow(() => icons.setModelProvider(fn), 'same provider again is a no-op');
  const itemSrc = src('item-icons.js');
  const swap = itemSrc.slice(itemSrc.indexOf('export function setModelProvider'));
  assert.doesNotMatch(swap.slice(0, swap.indexOf('\n}')), /cache\.clear\(\)/, 'old icons stay until the new ones are ready');
  assert.match(swap, /if \(next === provider\) return;/);
  const ui = src('survival-ui.js'), game = src('game.js');
  assert.match(ui, /primeIcons\(\) \{[\s\S]{0,300}renderIconsNow\(kinds\)/, 'survival UI primes the bag kinds');
  assert.match(game, /function start\(\) \{[\s\S]{0,300}survivalUI\?\.primeIcons\?\.\(\);[^\n]*\n\s*running = true;/, 'before the first play frame');
});

// ---------------------------------------------------------------- UX3-6 one name per material

const RAW = /(?<!palm[ -])\b(wood|leaf|leaves)\b/i; // raw kind ids; the bag says Plank and Palm Leaf

test('UX3-6: amountText uses the bag name, plural-aware', async () => {
  const I = await import(new URL('items.js', base));
  assert.equal(I.ITEMS.wood.name, 'Plank');
  assert.equal(I.amountText('wood', 2), '2 planks');
  assert.equal(I.amountText('wood', 1), '1 plank');
  assert.equal(I.amountText('leaf', 3), '3 palm leaves');
  assert.equal(I.amountText('plastic', 2), '2 plastic');
  assert.equal(I.amountText('scrap', 1), '1 scrap');
  assert.equal(I.amountText('metalore', 2), '2 metal ore');
});

test('UX3-6: notes, prompts, item text and the guide never show the raw ids wood or leaf', async () => {
  const O = await import(new URL('onboarding.js', base));
  const P = await import(new URL('prompts.js', base));
  const C = await import(new URL('craft-book.js', base));
  const S = { running: true, role: 'solo', tiles: 9, stock: { hook: 1 }, ownedTools: ['hook'], inventory: { slots: [{ kind: 'hammer', count: 1 }], selectedIndex: 0 } };
  for (const step of O.STEPS) {
    assert.doesNotMatch(String(step.title ?? ''), RAW, `step ${step.id} title`);
    assert.doesNotMatch(O.hintOf(step, S), RAW, `step ${step.id} hint`);
  }
  for (const type of ['wood', 'leaf', 'plastic', 'scrap', 'barrel']) {
    assert.doesNotMatch(P.statePrompt({ running: true, pickup: { id: 1, type } }, { throws: 99 }).label, RAW, `pickup ${type}`);
  }
  assert.doesNotMatch(P.costText({ wood: 2, leaf: 2, plastic: 2 }), RAW);
  assert.doesNotMatch(P.missingText({}, { wood: 2, leaf: 1 }), RAW);
  for (const [id, t] of Object.entries(C.ITEM_TEXT)) {
    assert.doesNotMatch(`${t.desc ?? ''} ${t.use ?? ''}`, RAW, `ITEM_TEXT.${id}`);
  }
  const guide = src('game.js').match(/guide\.innerHTML = ([\s\S]*?);\n/)[1] + src('index.html').match(/<ul class="guide">[\s\S]*?<\/ul>/)[0];
  assert.doesNotMatch(guide, RAW, 'How to play');
});
