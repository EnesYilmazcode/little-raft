// hud.js - small pure helpers for the in-play HUD: the edge notice stack, the persisted
// sound on/off preference, drag-look scaling and the first-run hint chain.
// No DOM access here so the logic can be tested in node.

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

// First-run hints, shown one at a time and only until the player has done each thing once.
export const HINT_KEY = 'little-raft-hints';
export const HINTS = Object.freeze([
  {id:'throw', text:'Hold click to charge, release to throw at floating supplies', when:c => c.heldKind === 'hook' && !c.castOut},
  {id:'bag', text:'Press Tab or E to open your bag and craft', when:c => c.hasLoot},
  {id:'slots', text:'Press 1–9 or 0 to choose what you hold', when:() => true},
]);
export function loadHints(storage) {
  try { const v = JSON.parse(storage?.getItem(HINT_KEY) ?? '[]'); return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []); } catch { return new Set(); }
}
export function saveHints(storage, done) {
  try { storage?.setItem(HINT_KEY, JSON.stringify([...done])); return true; } catch { return false; }
}
// The first unfinished hint, if its condition holds now. Later hints wait for earlier ones.
export function nextHint(done, ctx) {
  const h = HINTS.find(x => !done.has(x.id));
  return h && h.when(ctx || {}) ? h : null;
}
