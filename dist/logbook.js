// Little Raft logbook: message-in-a-bottle notes and achievements.
// Pure logic, no DOM and no THREE, so it runs under node:test.

export const NOTES = Object.freeze([
  "To whoever finds this: hello! I'm a drifter too. If your raft creaks at night, that's just it getting comfy. — P.",
  "Tip from the Lantern Fleet: tie one ribbon to your mast for every friend you meet. Mine looks like a birthday cake now.",
  "Today a turtle napped on my raft for three hours. I didn't move once. Best day of the month.",
  "The gulls deliver mail if you ask nicely and pay in crumbs. They do not deliver it to the right person. Sorry if this was meant for someone else.",
  "Recipe for sea soup: one rainy afternoon, two old songs, a lot of patience. Serves everyone who drifts by.",
  "If you see a raft with a teapot-shaped sail, wave! That's Grandmother Ottilie. She has never once run out of biscuits.",
  "I counted the stars last night and got a different number every time. I think they move around to keep it interesting.",
  "Nobody owns the sea, but the sea lets you borrow a little piece of it. Look after yours. — the Lantern Fleet",
  "Found a barrel full of buttons. No idea why. Sewed them onto everything. I am very shiny now.",
  "The fish here are polite. If you thank them, they splash. I'm almost sure it's a 'you're welcome'.",
  "Once a year all the drifters tie their rafts together and dance until the planks squeak. You're invited. You were always invited.",
  "This is the last bottle I'm sending. Now that you've read them all, write one of your own. Someone out there is waiting for a hello. — P., and everyone",
]);
export const NOTE_COUNT = 12;
export const BOTTLE_CHANCE = 1 / 25;
export const CRAFT_KINDS = Object.freeze(['sail', 'palm', 'lantern', 'net', 'bench', 'crate']);

const CRAFT_META = {
  sail: ['Catch the Wind', 'sail'], palm: ['A Little Green', 'palm'], lantern: ['Night Light', 'lantern'],
  net: ['Lazy Fisher', 'net'], bench: ['Take a Seat', 'hammer'], crate: ['Tidy Captain', 'barrel'],
};
const a = (id, name, desc, icon) => Object.freeze({ id, name, desc, icon });
export const ACHIEVEMENTS = Object.freeze([
  a('floor1', 'Room to Wiggle', 'Add your first new floor tile.', 'floor'),
  a('tiles25', 'Floating Neighbourhood', 'Grow the raft to 25 tiles.', 'floor'),
  a('fish1', 'Splash Hello', 'Catch your first fish.', 'fish'),
  a('fish10', 'Fish Whisperer', 'Catch 10 fish.', 'fish'),
  a('supplies100', 'Beachcomber', 'Fish 100 supplies out of the sea.', 'barrel'),
  ...CRAFT_KINDS.map(k => a('craft_' + k, CRAFT_META[k][0], `Craft a ${k}.`, CRAFT_META[k][1])),
  a('firework1', 'Sky Sparkle', 'Launch your first sky rocket.', 'compass'), // [fireworks]
  a('homestead', 'Home Sweet Raft', 'Have all six decorations on deck at once.', 'compass'),
  a('sit1', 'Sit a While', 'Sit down for 30 seconds.', 'compass'), // [sit]
  a('repair1', 'Good as New', 'Repair a worn hook.', 'repair'),
  a('note1', 'Message Received', 'Find a message in a bottle.', 'bottle'),
  a('notes_all', 'Pen Pals', 'Read all 12 messages.', 'bottle'),
  a('wish1', 'Wish Upon a Star', 'Make a wish on a falling star.', 'compass'), // [stars]
  a('wish10', 'Stargazer', 'Make 10 wishes on falling stars.', 'compass'), // [stars]
]);
export const ACHIEVEMENT_IDS = Object.freeze(ACHIEVEMENTS.map(x => x.id));

export function cleanProgress(v) {
  const src = v && typeof v === 'object' ? v : {};
  const notes = [], achievements = [];
  if (Array.isArray(src.notes)) {
    for (const n of src.notes) {
      if (notes.length >= NOTE_COUNT) break;
      if (Number.isInteger(n) && n >= 0 && n < NOTE_COUNT && !notes.includes(n)) notes.push(n);
    }
  }
  if (Array.isArray(src.achievements)) {
    for (const id of src.achievements) {
      if (typeof id === 'string' && ACHIEVEMENT_IDS.includes(id) && !achievements.includes(id)) achievements.push(id);
    }
  }
  return { notes, achievements };
}

export function nextNote(notes) {
  const have = cleanProgress({ notes }).notes;
  for (let i = 0; i < NOTE_COUNT; i++) if (!have.includes(i)) return i;
  return -1;
}

export function shouldSpawnBottle(world, id, r = Math.random()) {
  if (cleanProgress(world).notes.length >= NOTE_COUNT) return false;
  const items = world && Array.isArray(world.items) ? world.items : [];
  if (items.some(it => it && it.type === 'bottle' && it.id !== id)) return false;
  return r < BOTTLE_CHANCE;
}

const num = v => (Number.isFinite(v) ? v : 0);

export function evaluate(world, bags, event) {
  const w = world && typeof world === 'object' ? world : {};
  const ev = event && typeof event === 'object' ? event : {};
  const have = cleanProgress(w);
  const tiles = Array.isArray(w.tiles) ? w.tiles.length : 0;
  const decor = new Set(Array.isArray(w.decor) ? w.decor.map(d => d && d.type) : []);
  const bagList = (Array.isArray(bags) ? bags : []).filter(b => b && typeof b.count === 'function');
  const inBag = k => bagList.some(b => { try { return b.count(k) > 0; } catch { return false; } });
  const notes = have.notes.length;
  const holds = id => {
    switch (id) {
      case 'floor1': return tiles >= 10;
      case 'tiles25': return tiles >= 25;
      case 'fish1': return num(w.fish) >= 1;
      case 'fish10': return num(w.fish) >= 10;
      case 'supplies100': return num(w.collected) >= 100;
      case 'firework1': return ev.kind === 'firework'; // [fireworks]
      case 'homestead': return CRAFT_KINDS.every(k => decor.has(k));
      case 'repair1': return ev.kind === 'repair';
      case 'sit1': return ev.kind === 'sit'; // [sit]
      case 'note1': return notes >= 1;
      case 'notes_all': return notes === NOTE_COUNT;
      case 'wish1': return ev.kind === 'wish'; // [stars]
      case 'wish10': return ev.kind === 'wish' && num(ev.n) >= 10; // [stars]
    }
    if (id.startsWith('craft_')) {
      const k = id.slice(6);
      if (ev.kind === 'craft') return ev.crafted === k;
      if (ev.kind === 'retro') return decor.has(k) || inBag(k);
    }
    return false;
  };
  return ACHIEVEMENT_IDS.filter(id => !have.achievements.includes(id) && holds(id));
}

export function achievementName(id) {
  const hit = ACHIEVEMENTS.find(x => x.id === id);
  return hit ? hit.name : id;
}

export default { NOTES, NOTE_COUNT, BOTTLE_CHANCE, CRAFT_KINDS, ACHIEVEMENTS, ACHIEVEMENT_IDS, cleanProgress, nextNote, shouldSpawnBottle, evaluate, achievementName };
