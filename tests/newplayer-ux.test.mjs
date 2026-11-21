// New-player UX fixes: title menu after quit, Tinker's Desk header, Plank/Foundation copy, lock reasons,
// settings controls list, build wheel label, How to play size, logbook from pause, HUD chips.
// Run: node --test tests/newplayer-ux.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(new URL(f, base), 'utf8');
const O = await import(new URL('onboarding.js', base));
const { Progression } = await import(new URL('progression.js', base));
const { studyHead } = await import(new URL('storage-research-ui.js', base));
const { KEYMAP } = await import(new URL('settings.js', base));
const { DEFAULT_BINDINGS } = await import(new URL('input-map.js', base));
const { notesHTML } = await import(new URL('logbook-ui.js', base));
const { NOTE_COUNT } = await import(new URL('logbook.js', base));
const { ITEM_TEXT } = await import(new URL('craft-book.js', base));

test('title menu is rebuilt from the save whenever the title is shown again', () => {
  const s = src('onboarding.js');
  assert.match(s, /function renderMenu\(/);
  assert.match(s, /store\.get\(SAVE_KEY\)[^\n]*saveSummary/); // Continue + summary come from the current save
  assert.match(s, /new MutationObserver\([\s\S]{0,200}renderMenu\(\)[\s\S]{0,200}observe\(welcome, \{attributes:true, attributeFilter:\['hidden'\]\}\)/);
});

test('Tinker\'s Desk header is one line that names what to study', () => {
  assert.equal(studyHead(['Plastic']), 'Study Plastic at a Tinker’s Desk to unlock');
  assert.equal(studyHead(['Rope', 'Scrap']), 'Study Rope and Scrap at a Tinker’s Desk to unlock');
  assert.equal(studyHead([]), 'Study at a Tinker’s Desk to unlock');
  const css = src('storage-research-ui.js').match(/\.sv-recipe\.lr-sr-first::before\{[^}]*\}/)[0];
  assert.match(css, /content:attr\(data-sr-head\)/);
  assert.match(css, /white-space:nowrap/);
  assert.match(css, /right:2px/); // spans the row width instead of shrinking to one word per line
  assert.doesNotMatch(css, /text-transform:uppercase/);
});

test('copy says Plank and Foundation, not wood and floor tile', () => {
  for (const s of O.STEPS) {
    const hint = typeof s.hint === 'function' ? s.hint({}) : s.hint;
    assert.doesNotMatch(`${s.title} ${hint}`, /\bwood\b|floor tile/i, s.id);
  }
  assert.equal(O.STEPS.find(s => s.id === 'floor').title, 'Build a foundation');
  assert.match(src('build-menu.js'), /MAT_NAME = \{ wood: 'plank'/i);
  assert.match(ITEM_TEXT.hammer.use, /Foundation/);
  assert.doesNotMatch(ITEM_TEXT.hammer.use, /wood|floor/);
  const guide = src('game.js').match(/const guide = \$\('#help \.guide'\);[\s\S]*?const note/)[0];
  assert.doesNotMatch(guide, /\d wood|raft floors/);
  assert.match(guide, /Hammer builds Foundations \(2 Plank, 2 Plastic each\)/);
});

test('lock reasons say Craft for things made in the bag', () => {
  const p = new Progression();
  assert.equal(p.whyLocked('fishingrod'), 'Craft Rope first');
  assert.equal(p.whyLocked('lantern'), 'Find Scrap first');
  assert.equal(p.whyLocked('sail'), 'Craft Rope and find Plastic first');
});

test('settings controls list matches the real bindings', () => {
  const map = Object.fromEntries(KEYMAP.map(([k, v]) => [v, k]));
  assert.equal(map['Interact / open bag'], 'E');
  assert.equal(map['Rotate piece / repair hook'], 'R');
  assert.equal(map['Build wheel'], 'Q or Right-click');
  assert.equal(map['Remove piece'], 'X');
  assert.equal(map['Fish journal'], 'J');
  assert.equal(map['Fine rotate'], 'Shift+wheel');
  assert.ok(DEFAULT_BINDINGS.interact.keys.includes('KeyE'));
  assert.ok(DEFAULT_BINDINGS.rotate.keys.includes('KeyR'));
  assert.ok(DEFAULT_BINDINGS.crouch.keys.includes('KeyC') && map['Crouch / dive down'] === 'C');
  assert.match(src('building.js'), /code === 'KeyQ'/);
  assert.match(src('building.js'), /code === 'KeyX'/);
  assert.match(src('fishing-cooking.js'), /e\.code === 'KeyJ'/);
});

test('build wheel names the hovered piece and hides the aim prompt while open', () => {
  const s = src('build-menu.js');
  assert.match(s, /class="bm-tag"/);
  assert.match(s, /function placeTag\(\)[\s\S]{0,200}tag\.textContent = list\[hot\]\.name/);
  assert.match(s, /body\.bm-wheel-up #lrPrompt[^{]*\{visibility:hidden\}/);
  assert.match(s, /open\(\) \{[\s\S]{0,300}classList\.add\('bm-wheel-up'\)/);
  assert.match(s, /close\(confirm = true\) \{[\s\S]{0,300}classList\.remove\('bm-wheel-up'\)/);
});

test('How to play fits a short window and the logbook returns to pause', () => {
  assert.match(src('game.js'), /#help\{[^}]*max-height:calc\(100vh - 32px\)[^}]*overflow:auto/);
  const st = src('settings.js');
  assert.match(st, /act === 'logbook'[\s\S]{0,300}returnToPause = lb; lb\.dataset\.fromPause = '1'/);
  assert.match(src('logbook-ui.js'), /if \(!dlg\.dataset\.fromPause\) safe\(onResume\)/);
});

test('logbook shows one hint instead of a row per missing note', () => {
  const empty = notesHTML([]);
  assert.equal((empty.match(/<li/g) || []).length, 1);
  assert.match(empty, /Hook floating bottles to find notes/);
  assert.doesNotMatch(empty, /Still adrift/);
  const some = notesHTML([0, 2], 2);
  assert.equal((some.match(/<li/g) || []).length, 3);
  assert.match(some, new RegExp(`${NOTE_COUNT - 2} still adrift`));
  assert.equal((notesHTML([...Array(NOTE_COUNT).keys()]).match(/lb-missing/g) || []).length, 0);
});

test('HUD chips: no sail chip waits for a sail to be makeable; fish chip is short', () => {
  assert.match(src('sailing-ui.js'), /m === 'none' && info\.sailKnown === false/);
  assert.match(src('sailing-world.js'), /info\.sailKnown = !!ctx\.sailKnown\(\)/);
  assert.match(src('game.js'), /const sailKnown = \(\) =>[^\n]*isUnlocked\?\.\('sail'\)[^\n]*'rope'/);
  assert.match(src('fishing-cooking.js'), /`🎣 Fish \$\{n\}\/\$\{SPECIES\.length\} · J`/);
  const fresh = new Progression();
  assert.equal(fresh.isUnlocked('sail'), false); // a new player does not see "craft one" yet
  fresh.noteItems(['rope', 'plastic']);
  assert.equal(fresh.isUnlocked('sail'), true);
});
