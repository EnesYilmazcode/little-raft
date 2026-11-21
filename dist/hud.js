// hud.js - small pure helpers for the in-play HUD: the edge notice stack, the persisted
// sound on/off preference, drag-look scaling and the first-run hint chain.
// No DOM access here so the logic can be tested in node.

import { HOTBAR_SIZE } from './inventory-state.js?build=v3-survival-ae77fa84ac2b';

export const NOTICE_MS = 2800, NOTICE_MAX = 3;

// A short stack of notices. Repeating a line refreshes it instead of stacking a copy.
export function createNoticeQueue({max = NOTICE_MAX, ms = NOTICE_MS} = {}) {
  let items = []; // {text, until}
  return {
    push(text, now, life = ms) {
      const t = String(text ?? '').slice(0, 90); if (!t) return;
      const until = now + (Number.isFinite(life) && life > 0 ? life : ms);
      items = items.filter(n => n.text !== t);
      items.push({text:t, until});
      if (items.length > max) items = items.slice(items.length - max);
    },
    lines(now) { items = items.filter(n => n.until > now); return items.map(n => n.text); },
    clear() { items = []; },
  };
}

// Sound on/off lives under its own key: settings.js validate() drops unknown keys.
export const SOUND_KEY = 'little-raft-sound';
export function loadSoundPref(storage, fallback = true) {
  try { const v = storage?.getItem(SOUND_KEY); return v === 'off' ? false : v === 'on' ? true : fallback; } catch { return fallback; }
}
export function saveSoundPref(storage, on) {
  try { storage?.setItem(SOUND_KEY, on ? 'on' : 'off'); return true; } catch { return false; }
}

// Drag-to-look uses the same sensitivity multiplier as pointer-locked look.
export function dragLookScale(base, sensitivity) {
  return base * (Number.isFinite(sensitivity) && sensitivity > 0 ? sensitivity : 1);
}

// Shared wording for keys and prompts. Settings, the help guide and the hints all use these strings
// (tests/ux-layout.test.mjs checks the sources), and the bag footer in survival-ui.js says "E, I or Esc closes".
export const BAG_OPEN_KEYS = 'Tab, I or E', BAG_CLOSE_KEYS = 'Tab, E, I or Esc';
export const REEL_PROMPT = 'Hold click to reel in';

// First-run hints, shown one at a time and only until the player has done each thing once.
// Look and walk come first, then throwing, then the bag and the hotbar.
export const HINT_KEY = 'little-raft-hints';
export const LOOK_DONE_RAD = 1.2, WALK_DONE_S = 1; // about a second of looking around / walking
export const HINTS = Object.freeze([
  {id:'look', text:'Move the mouse to look around', when:() => true},
  {id:'walk', text:'Press W A S D to walk', when:() => true},
  {id:'throw', text:'Hold click to charge, release to throw at floating supplies', when:c => c.heldKind === 'hook' && !c.castOut},
  {id:'bag', text:`Press ${BAG_OPEN_KEYS} to open your bag and craft`, when:c => c.hasLoot},
  {id:'slots', text:`Press 1–${Math.min(HOTBAR_SIZE, 9)}${HOTBAR_SIZE >= 10 ? ' or 0' : ''} (or scroll) to choose what you hold`, when:() => true},
  // Loot -> rope -> hammer -> first floor. Each is also marked done from bag/world state (hintsFromState),
  // so a player who already has rope or a hammer, or has built, never gets stuck on an earlier step.
  {id:'rope', text:'Open your bag (Tab) → Materials → craft Rope from palm leaves', when:c => c.hasLeaf},
  {id:'hammer', text:'Craft a Hammer in Tools: 4 wood, 2 rope', when:() => true},
  {id:'build', text:'With the Hammer, click the water beside the raft to add floor', when:c => c.heldKind === 'hammer'},
]);
// Hint ids already satisfied by what the player owns or has built (c: {hasRope, hasHammer, built}).
export function hintsFromState(c) {
  const out = [];
  if (c?.hasRope || c?.hasHammer) out.push('rope');
  if (c?.hasHammer) out.push('hammer');
  if (c?.built) out.push('build');
  return out;
}
// A save from before the look/walk hints already threw a hook: it has nothing left to learn there.
export function loadHints(storage) {
  let done;
  try { const v = JSON.parse(storage?.getItem(HINT_KEY) ?? '[]'); done = new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []); } catch { done = new Set(); }
  if (done.has('throw')) { done.add('look'); done.add('walk'); }
  return done;
}
export function saveHints(storage, done) {
  try { storage?.setItem(HINT_KEY, JSON.stringify([...done])); return true; } catch { return false; }
}
// New game starts a new save, so the hint chain starts over too (in place: the engine keeps one Set).
export function resetHints(storage, done) { done.clear(); return saveHints(storage, done); }
// The first unfinished hint, if its condition holds now. Later hints wait for earlier ones.
export function nextHint(done, ctx) {
  const h = HINTS.find(x => !done.has(x.id));
  return h && h.when(ctx || {}) ? h : null;
}

// Where the bottom-left feed lives while a panel is open. The bag and the pause rail each have a lane
// for it inside the panel, so rows never paint over panel controls; reading dialogs (help, crew) leave
// the transient rows under their backdrop. 'hud' is the normal corner during play.
export function feedPlacement({inventoryOpen = false, optionsOpen = false, dialog = false} = {}) {
  if (inventoryOpen) return 'inventory';
  if (optionsOpen) return 'options';
  return dialog ? 'hidden' : 'hud';
}
