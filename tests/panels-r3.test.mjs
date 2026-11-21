// Panels round 3: edge-only notices (no centred popups during play), one feed, one tutorial, aligned build chip.
// Run: node --test tests/panels-r3.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = (f) => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
const H = await import(new URL('hud.js', base));
const { chipLeft } = await import(new URL('build-menu.js', base));
const { NOTE_TIPS } = await import(new URL('logbook-ui.js', base));
const { MAX_ROWS } = await import(new URL('pickup-feed.js', base));
const { catchLine } = await import(new URL('fishing-cooking.js', base));

// The CSS rule body for a selector (first match) inside a source file.
function rule(file, sel) {
  const s = src(file), i = s.indexOf(sel + '{');
  assert.ok(i >= 0, `${sel} rule in ${file}`);
  return s.slice(i, s.indexOf('}', i));
}
const centred = (css) => /top:\s*(50%|18%)/.test(css) || /translate\(-50%,\s*-50%\)/.test(css) || /left:\s*50%/.test(css);

test('PAN3-3: the binoculars readout docks in the bottom-left stack, not centred, shared font', () => {
  const ph = src('progression-hooks.js');
  assert.doesNotMatch(ph, /binocularsHud[\s\S]{0,300}left:50%/);
  assert.match(ph, /getElementById\('noticeStack'\)[\s\S]{0,80}prepend\(hud\)/);
  const css = src('game.js').match(/\n#binocularsHud\{position:fixed[^}]*\}/)?.[0] ?? '';
  assert.match(src('game.js'), /#noticeStack>#binocularsHud\{position:static/);
  assert.ok(!centred(css), css);
  assert.match(css, /left:22px/);
  assert.match(css, /var\(--ui-font/);
  assert.match(src('game.js'), /bn && bn\.parentNode !== el\) el\.prepend\(bn\)/, 'game.js adopts it into #noticeStack');
});

test('UX3-8: the logbook is a left-edge side panel in the shared palette, not a centred modal', () => {
  const css = rule('logbook-ui.js', '#logbook.lb');
  assert.ok(!centred(css), css);
  assert.match(css, /inset:0 auto 0 0/);
  assert.match(css, /margin:0/);
  assert.doesNotMatch(src('logbook-ui.js'), /#b48d55|Still adrift/);
  assert.match(src('logbook-ui.js'), /const FONT = "var\(--ui-font/);
  assert.ok(NOTE_TIPS.length >= 2 && NOTE_TIPS.length <= 4, 'a few hint rows instead of 12 placeholders');
  assert.match(src('logbook-ui.js'), /\$\{p\.notes\.length\}\/\$\{NOTE_COUNT\}/, 'compact n/12 found');
  // its toast no longer sits on the compass / sail badge column at the top right
  const toast = rule('logbook-ui.js', '#lb-toast');
  assert.match(toast, /left:16px/); assert.doesNotMatch(toast, /right:16px/);
});

test('PAN3-2/UX3-2: one feed: no #lrFeed, raftPrompts.feed forwards to the pickup feed, ticks stay in the checklist', () => {
  for (const f of ['prompts.js', 'prompts.css', 'game.js']) assert.doesNotMatch(src(f), /lrFeed/, f);
  const pj = src('prompts.js');
  assert.doesNotMatch(pj, /MutationObserver/, 'no #contextPrompt observer re-posting hover prompts');
  assert.match(pj, /raftPickupFeed[\s\S]{0,80}\.note\(t\)/);
  assert.match(src('game.js'), /window\.raftPickupFeed = pickupFeed/);
  const ob = src('onboarding.js');
  assert.doesNotMatch(ob, /feed\(`✓/, 'step ticks are not posted as floating lines');
  assert.match(src('onboarding.css'), /\.ob-row\.ob-done\{animation:obTick/);
});

test('PAN3-1/UX3-3: feed rows are capped to the stack width with an ellipsis, 3 rows, hidden over panels', () => {
  const css = src('style.css');
  assert.match(rule('style.css', '.pf-row'), /max-width:100%/);
  assert.match(css, /\.pf-row>b,\.pf-row>span\{min-width:0;overflow:hidden;text-overflow:ellipsis\}/);
  assert.match(src('game.js'), /#noticeStack>#pickupFeed\{[^}]*max-width:100%/);
  assert.equal(MAX_ROWS, 3);
  assert.match(src('game.js'), /#noticeStack\.ns-panel>#pickupFeed/);
  assert.match(src('game.js'), /classList\.toggle\('ns-panel', !!dialog\)/);
});

test('PAN3-4: one notice per catch, no cream toast, chip in the shared palette', () => {
  const fc = src('fishing-cooking.js');
  assert.doesNotMatch(fc, /fcToast|toast\(/);
  assert.doesNotMatch(fc, /#f1e7d0|system-ui,sans-serif;\s*\n?color:#fffdf4/);
  assert.match(rule('fishing-cooking.js', '#fcChip'), /var\(--ui-font[\s\S]*var\(--plate-hud/);
  const sp = { name: 'Pomfret', rarity: 'common' };
  assert.equal(catchLine(sp, { cm: 26 }, 2, { isNew: true, basketed: true }), 'New species! Pomfret · 26.0 cm ★★☆');
  assert.equal(catchLine(sp, { cm: 26 }, 2, { basketed: true }), 'Pomfret · 26.0 cm ★★☆');
  assert.match(catchLine(sp, { cm: 30 }, 3, { isRecord: true, basketed: false }, { bestCm: 26 }), /^New record! .*\(was 26\.0\) · basket full$/);
});

test('PAN3-5: the build chip follows the measured hotbar and clears the lifted notice stack', () => {
  const bm = src('build-menu.js');
  assert.doesNotMatch(bm, /253px/);
  assert.match(bm, /\.tools\.sv-hotbar/);
  // 1280: stack beside the hotbar -> chip on the hotbar's left edge
  assert.equal(chipLeft({ hotbarLeft: 353, stackRight: 0, vw: 1280, chipW: 294 }), 353);
  // 900: stack (22 + 328 max) above the hotbar at 163 -> chip moves right of it
  assert.equal(chipLeft({ hotbarLeft: 163, stackRight: 350, vw: 900, chipW: 294 }), 358);
  // never off screen
  assert.ok(chipLeft({ hotbarLeft: 100, stackRight: 700, vw: 800, chipW: 300 }) + 300 <= 800 - 16);
});

test('PAN3-6/UX3-1: the hint chain defers to the onboarding tracker and follows its progress', () => {
  assert.match(H.HINTS.find((h) => h.id === 'slots').text, /1–9 or 0/);
  const done = new Set();
  // tracker active: nothing it teaches is repeated, and later hints wait
  assert.equal(H.nextHint(done, { heldKind: 'hook', tracker: true }), null);
  for (const id of ['look', 'walk', 'throw']) { done.add(id); assert.equal(H.nextHint(done, { heldKind: 'hook', hasLoot: true, tracker: true }), null, id); }
  done.add('bag');
  assert.equal(H.nextHint(done, { tracker: true })?.id, 'slots', 'only the hotbar hint is the chain\'s own');
  // no tracker (older builds): the chain still teaches everything
  assert.equal(H.nextHint(new Set(), { heldKind: 'hook' })?.id, 'look');
  // a continued save: the tracker's finished steps are copied in, so the chain never restarts at "look"
  const saved = new Set();
  assert.equal(H.syncHintsFromTracker(saved, ['look', 'walk', 'throw', 'reel', 'wood']), true);
  assert.ok(saved.has('look') && saved.has('walk') && saved.has('throw') && !saved.has('reel'));
  assert.equal(H.syncHintsFromTracker(saved, ['look']), false);
  assert.match(src('game.js'), /syncHintsFromTracker\(hintsDone, st\.done\)/);
  assert.match(src('game.js'), /hintDone\('look'\); \/\/ switching tools/);
});

test('UX3-4: small windows get a narrow, current-step-only tracker and a matching pin card', () => {
  const css = src('onboarding.css'), i = css.indexOf('@media (max-width:1000px)');
  assert.ok(i >= 0);
  const block = css.slice(i, css.indexOf('}\n', css.indexOf('#craftPin', i)) + 1);
  assert.match(block, /\.ob-notes\{width:200px/);
  assert.match(block, /\.ob-row:not\(\.ob-done\)~\.ob-row:not\(\.ob-done\)\{display:none\}/);
  assert.match(block, /#craftPin\{width:200px/);
});

test('station panels: E and Tab close smelter and research, shared font', () => {
  assert.match(src('smelter-ui.js'), /e\.code === 'KeyE' \|\| e\.code === 'Tab'[\s\S]{0,80}close\(\)/);
  assert.match(src('progression-hooks.js'), /e\.code === 'KeyE' \|\| e\.code === 'Tab'[\s\S]{0,80}research\.close\(\)/);
  for (const f of ['smelter-ui.js', 'build-menu.js', 'logbook-ui.js']) assert.match(src(f), /const FONT = "var\(--ui-font/, f);
  assert.doesNotMatch(src('progression-hooks.js'), /#b48d55/);
  assert.doesNotMatch(src('fish-journal.js'), /#5a3d22|Georgia/);
  assert.doesNotMatch(src('sailing-ui.js'), /rgba\(43,30,18/);
});
