// Crafting UX round 3: icon framing, research-locked rows, recipe search, newly craftable recipes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const CB = await import(new URL('craft-book.js', base));
const src = name => readFileSync(new URL(name, base), 'utf8');

// A thin stick from (x0, y0) to (x1, y1), sampled densely, with a little width.
function stick(x0, y0, x1, y1, w = 0.02, n = 40) {
  const pts = [], dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l * w, ny = dx / l * w;
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(x0 + dx * t + nx, y0 + dy * t + ny, x0 + dx * t - nx, y0 + dy * t - ny); }
  return pts;
}
const rot = (pts, a) => { const c = Math.cos(a), s = Math.sin(a), out = []; for (let i = 0; i < pts.length; i += 2) out.push(pts[i] * c - pts[i + 1] * s, pts[i] * s + pts[i + 1] * c); return out; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('R3-1: a long item is rolled onto the up-right diagonal and framed tightly', () => {
  const pts = stick(-1, 0, 1, 0); // horizontal
  const f = CB.fitIconFrame(pts, { pad: 0.1 });
  assert.ok(f.aspect > 10);
  assert.ok(near(Math.abs(f.roll), Math.PI / 4, 0.06), 'rolled by 45 degrees: ' + f.roll);
  const r = rot(pts, f.roll);
  for (let i = 0; i < r.length; i += 2) {
    assert.ok(Math.abs(r[i] - f.cx) <= f.half && Math.abs(r[i + 1] - f.cy) <= f.half, 'every point inside the frame');
  }
  // On the diagonal the stick spans ~2 / sqrt(2) per axis, so the frame is about that plus padding.
  assert.ok(f.half < (2 / Math.SQRT2) * 0.5 * 1.1 + 0.05, 'tight: ' + f.half);
});

test('R3-1: the end that already pointed up-right stays up-right; an explicit axis wins', () => {
  // Upright stick with a heavy head at the top: rolling clockwise keeps the head on top (right).
  const head = [], pts = stick(0, -1, 0, 1);
  for (let i = 0; i < 30; i++) head.push(-0.3 + i * 0.02, 1);
  const f = CB.fitIconFrame(pts.concat(head), { axis: Math.PI / 2 });
  assert.ok(near(f.roll, -Math.PI / 4, 1e-9), 'vertical axis rolls -45 degrees, not +135: ' + f.roll);
  const top = rot([0, 1], f.roll);
  assert.ok(top[0] > 0 && top[1] > 0, 'head ends up in the upper-right quadrant');
  // A stick already on the diagonal is left alone.
  assert.ok(near(CB.fitIconFrame(stick(-1, -1, 1, 1)).roll, 0, 0.06));
  // diag = 0: level (a fish).
  assert.ok(near(CB.fitIconFrame(stick(-1, -1, 1, 1), { diag: 0 }).roll, -Math.PI / 4, 0.06));
});

test('R3-1: compact items are not rolled; long = Infinity turns rolling off; empty input is null', () => {
  const square = [-1, -1, 1, -1, 1, 1, -1, 1];
  const f = CB.fitIconFrame(square, { pad: 0 });
  assert.equal(f.roll, 0);
  assert.ok(near(f.half, 1) && near(f.cx, 0) && near(f.cy, 0));
  assert.equal(CB.fitIconFrame(stick(-1, 0, 1, 0), { long: Infinity }).roll, 0);
  assert.equal(CB.fitIconFrame([]), null);
  assert.equal(CB.fitIconFrame(null), null);
  // Off-centre points: the frame is centred on them.
  const g = CB.fitIconFrame([2, 3, 4, 5], { pad: 0, long: Infinity });
  assert.ok(near(g.cx, 3) && near(g.cy, 4) && near(g.half, 1));
});

test('R3-1: icon renderer uses the fit, a rim light, a halo and thicker thin tools', () => {
  const s = src('item-icons.js');
  assert.match(s, /fitIconFrame\(silhouettePoints\(pivot\)/);
  assert.match(s, /rimLight/);
  assert.match(s, /shadowBlur/);
  assert.match(s, /THICK = \{[^}]*fishingrod/);
  assert.match(s, /case 'receiver'/, 'the receiver has a 3D icon (it had no drawing)');
});

test('R3-2: unlockInfo turns a gate into a one-line requirement and a how-to', () => {
  assert.equal(CB.unlockInfo(null), null);
  assert.equal(CB.unlockInfo({ hidden: true }), null);
  assert.equal(CB.unlockInfo({ locked: false, reason: 'x' }), null);
  const r = CB.unlockInfo({ locked: true, reason: 'Research Glass and Nails at a Research Table' });
  assert.equal(r.line, 'Unlock: Research Glass and Nails at a Research Table');
  assert.match(r.how, /^Place a Research Table on your raft, press E on it and research Glass and Nails/);
  const b = CB.unlockInfo({ locked: true, reason: 'Build a Smelter' });
  assert.equal(b.line, 'Unlock: Build a Smelter');
  assert.match(b.how, /^Build a Smelter and place it on your raft/);
  const f = CB.unlockInfo({ locked: true, reason: 'Find Metal Ore first' });
  assert.match(f.how, /^Pick up Metal Ore once/);
  const o = CB.unlockInfo({ locked: true, reason: 'Use an Oven' });
  assert.deepEqual(o, { line: 'Unlock: Use an Oven', how: 'Use an Oven.' });
  assert.equal(CB.unlockInfo({ locked: true }).line, 'Unlock: not learned yet');
  assert.equal(CB.unlockInfo({ locked: true, reason: 'Build an Anvil' }).how.startsWith('Build an Anvil'), true);
});

test('R3-2: gated recipes sort after every other state', () => {
  const ids = CB.sortByCraftable([{ id: 'a', state: 'gated' }, { id: 'b', state: 'missing' }, { id: 'c', state: 'ready' }, { id: 'd', state: 'full' }]);
  assert.deepEqual(ids, ['c', 'd', 'b', 'a']);
});

const R = (id, name, out, reqs) => ({ id, name, out: { kind: out, count: 1 }, reqs: reqs.map(k => ({ kind: k, count: 1 })) });
const NAMES = { wood: 'Wood', rope: 'Rope', leaf: 'Palm Leaf', scrap: 'Scrap', hammer: 'Hammer', fishingrod: 'Fishing Rod', sail: 'Sail' };
const nameOf = k => NAMES[k] || k;
const BOOK = [
  { id: 'hammer', cat: 'tools', recipe: R('hammer', 'Hammer', 'hammer', ['wood', 'rope']) },
  { id: 'fishingrod', cat: 'tools', recipe: R('fishingrod', 'Fishing Rod', 'fishingrod', ['wood', 'rope', 'scrap']) },
  { id: 'rope', cat: 'materials', recipe: R('rope', 'Rope', 'rope', ['leaf']) },
  { id: 'sail', cat: 'building', recipe: R('sail', 'Sail', 'sail', ['wood', 'leaf', 'rope']) },
];

test('R3-3: search matches names and ingredients across every tab, case-insensitive, all words', () => {
  assert.deepEqual(CB.searchTerms('  Fish  ROD '), ['fish', 'rod']);
  assert.deepEqual(CB.searchTerms(''), []);
  assert.equal(CB.matchRecipe(BOOK[1].recipe, 'rod', nameOf), true);
  assert.equal(CB.matchRecipe(BOOK[1].recipe, 'fish scrap', nameOf), true, 'name + ingredient');
  assert.equal(CB.matchRecipe(BOOK[1].recipe, 'fish leaf', nameOf), false, 'every word must match');
  assert.equal(CB.matchRecipe(BOOK[0].recipe, '', nameOf), true, 'empty query matches');
  const m = CB.searchMatches(BOOK, 'palm', nameOf);
  assert.deepEqual([...m.ids].sort(), ['rope', 'sail'], 'ingredient name "Palm Leaf"');
  assert.equal(m.perCat.get('materials'), 1); assert.equal(m.perCat.get('building'), 1); assert.equal(m.perCat.get('tools'), undefined);
  const all = CB.searchMatches(BOOK, 'WOOD', nameOf);
  assert.deepEqual([...all.ids], ['hammer', 'fishingrod', 'sail']);
  assert.equal(CB.searchMatches(BOOK, 'zzz', nameOf).ids.size, 0);
});

test('R3-3: Esc in the search field clears text first, then passes through', () => {
  assert.equal(CB.searchEscape('rope'), 'clear');
  assert.equal(CB.searchEscape(''), 'pass');
  assert.equal(CB.searchEscape(undefined), 'pass');
  // The field stops the key only when it has text; pointer-lock code is not touched by it.
  const s = src('survival-ui.js');
  assert.match(s, /if \(searchEscape\(qEl\.value\) === 'clear'\) \{ e\.preventDefault\(\); e\.stopPropagation\(\);/);
  assert.doesNotMatch(s.slice(s.indexOf("qEl.addEventListener('keydown'"), s.indexOf("qClear.addEventListener")), /exitLock|requestPointerLock|pointerLock/);
});

test('R3-4: readyTransitions: quiet first check, crossings, first-time only once', () => {
  let t = CB.readyTransitions(null, new Set(['rope']));
  assert.deepEqual(t.crossed, []); assert.deepEqual(t.first, []);
  assert.deepEqual([...t.seen], ['rope'], 'ready at load counts as seen');
  t = CB.readyTransitions(new Set(['rope']), new Set(['rope', 'hammer']), t.seen);
  assert.deepEqual(t.crossed, ['hammer']); assert.deepEqual(t.first, ['hammer']);
  // hammer drops out (crafted), comes back: a crossing, but not a first time.
  const seen = t.seen;
  t = CB.readyTransitions(new Set(['rope']), new Set(['rope', 'hammer']), seen);
  assert.deepEqual(t.crossed, ['hammer']); assert.deepEqual(t.first, []);
  // seen is not mutated in place.
  const before = new Set(['a']);
  CB.readyTransitions(new Set(), new Set(['b']), before);
  assert.deepEqual([...before], ['a']);
  assert.equal(CB.readyNotice('Sail'), 'Ready to craft: Sail');
});

test('R3-4: survival UI wires the pulse, the tracker flash and the notice', () => {
  const s = src('survival-ui.js');
  assert.match(s, /safe\(onNotice, readyNotice\(r\.name\)\)/);
  assert.match(s, /sv-pulse/);
  assert.match(s, /sv-justready/);
  assert.match(src('game.js'), /onNotice:guard\(text => notice\(text, 2600\)\)/);
});

// ---- UX review round 3 (UX3-5/6/7) ----
test('UX3-6: instruments have a Music tab; the sail sits with the tools and says it steers', () => {
  assert.ok(CB.CATEGORIES.some(c => c.id === 'music'));
  for (const k of ['drum', 'pipes', 'bells']) assert.equal(CB.categoryOf(k), 'music', k);
  assert.equal(CB.categoryOf('sail'), 'tools');
  assert.doesNotMatch(CB.ITEM_TEXT.sail.use, /Decorates/);
  assert.match(CB.ITEM_TEXT.sail.use, /steer/);
});

test('UX3-6: Tab toggles the bag closed, except inside a slot grid', () => {
  assert.equal(CB.bagKeyAction('Tab', true), 'close');
  assert.equal(CB.bagKeyAction('Tab', true, true), null);
  assert.equal(CB.bagKeyAction('Tab', false), 'open');
  assert.match(src('survival-ui.js'), /bagKeyAction\(e\.code, isOpen, !!e\.target\?\.closest\?\.\('#inventory \.sv-grid, #inventory \.sv-hotrow'\)\)/);
});

test('UX3-6: rows do not re-sort under the pointer; icons swap once when the model source changes', () => {
  const s = src('survival-ui.js');
  assert.match(s, /if \(craftHover \|\| hold\) sortPending = true; else sortRows\(\);/);
  assert.match(s, /pointerleave', \(\) => \{ craftHover = false; if \(sortPending && !hold\) sortRows\(\); \}/);
  const ic = src('item-icons.js');
  assert.doesNotMatch(ic.slice(ic.indexOf('export function setModelProvider')), /cache\.clear\(\)/, 'old icons stay until re-rendered');
});

test('UX3-5: player-facing names say plank, source tags are short, chips and card share have/need', () => {
  assert.match(CB.ITEM_TEXT.hammer.use, /2 planks/);
  for (const [k, v] of Object.entries(CB.ITEM_SOURCE)) assert.ok(v.tag.length <= 12, `${k} tag "${v.tag}" fits without cutting`);
  const s = src('survival-ui.js');
  assert.match(s, /e\.amt\.textContent = chipLabel\(row\)/);
  assert.match(s, /<span>have \/ need<\/span>/);
  const t = src('item-tooltips.js');
  assert.match(t, /\.sv-recipe\.sv-pick'\)\) return null/, 'no tooltip on the row the card describes');
  assert.match(t, /closest\?\.\('#inventory \.sv-craft'\)/, 'crafting tooltips sit beside the column');
  assert.match(t, /unlockInfo\(/);
});

test('UX3-7: the Craft button carries one count; the key legend is a caption below', () => {
  assert.equal(CB.craftCaption(10), 'Hold to make more · Shift makes all (10)');
  assert.equal(CB.craftCaption(1), '');
  assert.equal(CB.craftCaption(5, true), '', 'tools are one at a time');
  assert.equal(CB.craftCaption(NaN), '');
  const s = src('survival-ui.js');
  assert.doesNotMatch(s, /sv-chint|sv-cmax|hold · shift = all/);
  assert.match(s, /D\.count\.textContent = n > 0 \? '×' \+ n : ''/);
});
