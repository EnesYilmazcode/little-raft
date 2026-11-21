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

// Host verdict for a landed fish. fitBag: the bag copy fitted. basket: the catch is already in the
// fish basket (rod v2), which is the real store, so a full bag only skips the bag mirror.
export function fishOutcome(fitBag, basket) {
  if (fitBag) return { keep: true, kind: 'loot', text: 'You caught a fish!' };
  if (basket) return { keep: true, kind: 'notice', text: 'Bag full: the fish went in your basket' };
  return { keep: false, kind: 'full', text: 'Bag full: the fish swam away' };
}
