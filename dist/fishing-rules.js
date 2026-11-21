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
