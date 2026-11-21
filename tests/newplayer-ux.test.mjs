// New-player UX fixes: Tinker's Desk header, lock reasons, build wheel label, How to play size, logbook from pause, HUD chips.
// Run: node --test tests/newplayer-ux.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(new URL(f, base), 'utf8');
const { Progression } = await import(new URL('progression.js', base));
const { studyHead } = await import(new URL('storage-research-ui.js', base));
const { notesHTML, NOTE_TIPS } = await import(new URL('logbook-ui.js', base));
const { NOTE_COUNT } = await import(new URL('logbook.js', base));

test('Tinker\'s Desk header is one line that names what to study', () => {
  assert.equal(studyHead(['Plastic']), 'Study Plastic at a Tinker’s Desk to unlock');
  assert.equal(studyHead(['Rope', 'Scrap']), 'Study Rope and Scrap at a Tinker’s Desk to unlock');
  assert.equal(studyHead([]), 'Study at a Tinker’s Desk to unlock');
  const css = src('storage-research-ui.js').match(/\.sv-recipe\.lr-sr-first::after\{[^}]*\}/)[0]; // ::after: survival-ui owns ::before (ready bar)
  assert.match(css, /content:attr\(data-sr-head\)/);
  assert.match(css, /white-space:nowrap/);
  assert.match(css, /right:2px/); // spans the row width instead of shrinking to one word per line
  assert.doesNotMatch(css, /text-transform:uppercase/);
});

test('lock reasons say Craft for things made in the bag', () => {
  const p = new Progression();
  assert.equal(p.whyLocked('fishingrod'), 'Craft Rope first');
  assert.equal(p.whyLocked('lantern'), 'Find Scrap first');
  assert.equal(p.whyLocked('sail'), 'Find Palm Leaf and Scrap first'); // sail: 10 planks, 20 leaves, 3 scrap (loop-fidelity-0804)
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

test('logbook shows a found count and a few hints instead of a row per missing note', () => {
  const empty = notesHTML([]);
  assert.equal((empty.match(/<li/g) || []).length, 1 + NOTE_TIPS.length, 'the n/12 line and the tips');
  assert.match(empty, new RegExp(`0/${NOTE_COUNT}`));
  assert.doesNotMatch(empty, /Still adrift|lb-missing/);
  const some = notesHTML([0, 2], 2);
  assert.equal((some.match(/<li/g) || []).length, 4, 'count, two notes, one "still drifting" line');
  assert.match(some, new RegExp(`${NOTE_COUNT - 2} more notes still drifting`));
  assert.equal((notesHTML([...Array(NOTE_COUNT).keys()]).match(/lb-tip/g) || []).length, 0);
});

test('HUD chips: no sail chip waits for a sail to be makeable; fish chip is short', () => {
  assert.match(src('sailing-ui.js'), /m === 'none' && info\.sailKnown === false/);
  assert.match(src('sailing-world.js'), /info\.sailKnown = !!ctx\.sailKnown\(\)/);
  assert.match(src('game.js'), /const sailKnown = \(\) =>[^\n]*isUnlocked\?\.\('sail'\)[^\n]*'scrap'/);
  assert.match(src('fishing-cooking.js'), /`Fish \$\{n\}\/\$\{SPECIES\.length\}<kbd>J<\/kbd>journal`/); // short, J as a key cap (shared palette)
  const fresh = new Progression();
  assert.equal(fresh.isUnlocked('sail'), false); // a new player does not see "craft one" yet
  fresh.noteItems(['leaf', 'scrap']);
  assert.equal(fresh.isUnlocked('sail'), true);
});
