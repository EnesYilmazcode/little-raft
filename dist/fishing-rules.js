// Small pure rules for click release and rod casts (shared by game.js and tests).

// A drag-look press records what it started: {tool, used, moved}. `used` means the press already did
// something (began a hook charge, reeled, or reeled in a rod cast). The release acts only for a plain
// click that did nothing yet, with the same tool still selected.
export function releaseShouldFire(down, heldNow) {
  return !!down && !down.moved && !down.used && down.tool != null && down.tool === heldNow;
}

// What a click or a slot change does to a rod cast that is out.
// 'none': no rod cast. 'catch': the fish is biting and the click reels it in. 'cancel': reel in empty.
export function castInput(cast, fishWait, source = 'click') {
  if (!cast?.fishing) return 'none';
  if (source === 'click' && cast.t > fishWait) return 'catch';
  return 'cancel';
}

// The prompt shown while the line is out.
export function castPrompt(cast, fishWait) {
  if (!cast?.fishing) return '';
  return cast.t > fishWait ? 'A bite! Click to reel in' : 'Waiting for a bite… click to reel in';
}

// Fishing rod wear (Raft: a wooden rod lasts 10 catches). Which slot a catch wears: the selected slot when it
// holds a rod, else the first rod in the bag; -1 when there is none.
export function rodSlot(slots, prefer) {
  if (!Array.isArray(slots)) return -1;
  if (Number.isInteger(prefer) && slots[prefer]?.kind === 'fishingrod') return prefer;
  for (let i = 0; i < slots.length; i++) if (slots[i]?.kind === 'fishingrod') return i;
  return -1;
}

// One catch of wear on a rod slot (mutates slot.durability, 0..100). Returns {before, after, broke} or null.
export function wearRod(slot, wear) {
  if (!slot || slot.kind !== 'fishingrod' || !(wear > 0)) return null;
  const before = Math.min(100, Math.max(0, Number.isFinite(slot.durability) ? slot.durability : 100));
  const after = Math.max(0, before - wear);
  slot.durability = after < 1e-9 ? 0 : after;
  return { before, after: slot.durability, broke: slot.durability === 0 }; // a rod already at 0 (old save) snaps on its next catch too
}
