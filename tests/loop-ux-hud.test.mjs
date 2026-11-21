// HUD loop-UX regressions: crosshair prompt during fishing-v2 + #contextPrompt prompts, no centred panels in play,
// one bottom-left feed stack, help text, single-shot toasts with a FIFO queue.
// Run: node --test tests/loop-ux-hud.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.RAFT_DIST ? pathToFileURL(resolve(process.env.RAFT_DIST) + '/').href : new URL('../dist/', import.meta.url).href;
const src = f => readFileSync(fileURLToPath(new URL(f, base)), 'utf8');
// prompts.js boots its DOM layer only when window+document exist: import it before any fake DOM below.
const P = await import(new URL('prompts.js', base));

// ---------------------------------------------------------------- E1 crosshair prompt
const rod = {running:true, role:'host', networkReady:true, hookStage:'idle', heldKind:'fishingrod', me:{pitch:-0.2}, stock:{}, build:{}};
const one = (s, opt) => P.normalizePrompt(P.statePrompt(s, opt))?.[0] ?? null;

test('E1 rod prompt follows the fishing-v2 session, not game.js hookStage', () => {
  assert.equal(one(rod, {fcStage:'idle'}).label, 'Cast line');
  assert.deepEqual(one(rod, {fcStage:'bite'}), {key:'LMB', label:'Strike!', hold:false, muted:false});
  assert.deepEqual(one(rod, {fcStage:'reeling'}), {key:'LMB', label:'Reel in', hold:true, muted:false});
  for (const st of ['flying', 'waiting', 'nibble']) assert.deepEqual(one(rod, {fcStage:st}), {key:'', label:'Waiting for a bite…', hold:false, muted:true}, st);
  assert.equal(P.statePrompt(rod, {fcStage:'charging'}), null); // the cast-power bar speaks for itself
  assert.equal(one(rod, {fcStage:'done'}).label, 'Cast line');
});

const ctxEl = (html, hidden = false) => { // tiny #contextPrompt stand-in: '<kbd>E</kbd>Label' markup
  const m = /^<kbd>([^<]*)<\/kbd>(.*)$/.exec(html);
  return {hidden, textContent:m ? m[1] + m[2] : html, querySelector:q => (q === 'kbd' && m ? {textContent:m[1]} : null)};
};

test('E1 #contextPrompt markup surfaces in #lrPrompt as {key,label}', () => {
  assert.deepEqual(P.contextPromptOf(ctxEl('<kbd>E</kbd>Take fresh water')), {key:'E', label:'Take fresh water'});
  assert.deepEqual(P.contextPromptOf(ctxEl('<kbd>E</kbd> Add wood · grill')), {key:'E', label:'Add wood · grill'});
  assert.deepEqual(P.contextPromptOf(ctxEl('<kbd>Click</kbd> Strike!')), {key:'LMB', label:'Strike!'});
  assert.deepEqual(P.contextPromptOf(ctxEl('Purifying… 12s')), {label:'Purifying… 12s', muted:true});
  assert.equal(P.contextPromptOf(ctxEl('<kbd>E</kbd>Harvest palm', true)), null);
  assert.equal(P.contextPromptOf(ctxEl('')), null);
  assert.equal(P.contextPromptOf(ctxEl('Floor needs 1 wood')), null); // the hammer prompt covers it
  assert.equal(P.contextPromptOf(null), null);
  assert.ok(P.hasKey({key:'E', label:'x'})); assert.ok(!P.hasKey({label:'x', muted:true})); assert.ok(!P.hasKey(null));
});

test('E1 keyed #contextPrompt beats the built-in prompt; key-less status is a muted fallback', () => {
  // mirrors the tick() candidate order: keyed ctx > keyed state > key-less ctx > key-less state
  const pick = (sp, cp) => P.pickPrompt([P.hasKey(cp) && cp, P.hasKey(sp) && sp, !P.hasKey(cp) && cp, !P.hasKey(sp) && sp]
    .filter(Boolean).map(p => ({prompts:p, priority:0, ray:false})));
  const cast = P.statePrompt(rod, {fcStage:'idle'});
  assert.equal(pick(cast, P.contextPromptOf(ctxEl('<kbd>E</kbd>Add wood')))[0].label, 'Add wood');
  assert.equal(pick(cast, P.contextPromptOf(ctxEl('Purifying… 9s')))[0].label, 'Cast line');
  assert.equal(pick(P.statePrompt(rod, {fcStage:'waiting'}), P.contextPromptOf(ctxEl('Waiting for a bite… (click early and it’ll spook)')))[0].label,
    'Waiting for a bite… (click early and it’ll spook)'); // not cut off
  const hammer = {...rod, heldKind:'hammer', build:{hover:{x:1, z:0, blocked:'reach'}, affordable:true}};
  assert.equal(P.statePrompt(hammer), null); // blocked: game.js's BLOCK_TEXT explains why
  assert.deepEqual(pick(P.statePrompt(hammer), P.contextPromptOf(ctxEl('Too far away: step closer'))), [{key:'', label:'Too far away: step closer', hold:false, muted:true}]);
});

test('E1 state prompts are never posted to the event feed as news', () => {
  const s = src('prompts.js');
  assert.ok(!/MutationObserver/.test(s), 'no #contextPrompt observer feeding #lrFeed');
  assert.match(s, /raftFC\?\.session\?\.stage/);
});
