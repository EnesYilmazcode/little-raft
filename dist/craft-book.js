// Little Raft crafting book: pure helpers behind the crafting panel (no DOM, no THREE, no timers).
// Category grouping, item descriptions, needed-vs-owned rows, the hold-to-craft repeat schedule
// and tooltip anchoring maths all live here so they can be unit-tested in node.

// Tabs, in display order. `icon` is a symbol id in icons.svg.
export const CATEGORIES = Object.freeze([
  Object.freeze({ id: 'tools',     name: 'Tools',     icon: 'hammer' }),
  Object.freeze({ id: 'materials', name: 'Materials', icon: 'wood' }),
  Object.freeze({ id: 'survival',  name: 'Survival',  icon: 'net' }),
  Object.freeze({ id: 'building',  name: 'Building',  icon: 'floor' }),
]);

// Recipe output kind -> category id. Unknown kinds fall back by shape (see categoryOf).
const CATEGORY_OF = Object.freeze({
  hook: 'tools', hammer: 'tools', fishingrod: 'tools',
  rope: 'materials',
  net: 'survival', palm: 'survival', lantern: 'survival',
  sail: 'building', bench: 'building', crate: 'building',
  // progression catalogue (items.js)
  metalhook: 'tools', binoculars: 'tools', spear: 'tools', metalspear: 'tools', finder: 'tools', spade: 'tools',
  drum: 'tools', pipes: 'tools', bells: 'tools', // [instruments]
  camera: 'tools', photoframe: 'survival', // [camera]
  nail: 'materials', bolt: 'materials', hinge: 'materials',
  flowerbox: 'survival', beehive: 'survival', candle: 'survival', honeyfish: 'survival', // [bees]
  juicer: 'survival', berrycup: 'survival', coconutcup: 'survival', mixcup: 'survival', // [juicer]
  perch: 'survival', // [gull]
  shelf: 'survival', trophystand: 'survival', // [display]
  turbine: 'survival', battery: 'survival', stringlights: 'survival', lamppost: 'survival', // [power]
  fishtrap: 'survival', // [fishtrap]

  taskboard: 'survival', // [tasks]
  skyrocket: 'survival', // [fireworks]
  scarecrow: 'survival', // [scarecrow]
  glidepost: 'building', glidestep: 'building', glidehandle: 'tools', // [zipline] (no 'decor' tab exists)
  watertank: 'survival', waterpipe: 'survival', // [pipes]
  rainbarrel: 'survival', sprinkler: 'survival', // [rain-sprinkler]
  researchtable: 'building', grill: 'building', smelter: 'building', maptable: 'building',
  rug: 'building', pennant: 'building', fern: 'building', chime: 'building', hammock: 'building', pots: 'building', sign: 'building', // decor pack
  kiln: 'building', glasslamp: 'survival', sinker: 'survival', // kiln
  nestbox: 'survival', cushion: 'building', // raft animals
  // content (engine, sleep, paint)
  motor: 'building', wheel: 'building', bed: 'building', brush: 'tools',
  paint_seafoam: 'materials', paint_coral: 'materials', paint_sunshell: 'materials', paint_lagoon: 'materials', paint_pebble: 'materials',
  cup: 'survival', purifier: 'survival', // water: scoop the sea, purify it
  fins: 'tools', airjug: 'tools', goggles: 'tools', scraper: 'tools',
  cookpot: 'building', bowl: 'survival',
  refiner: 'building', fueltank: 'building', biofuel: 'materials', // [biofuel]
  shellwreath: 'building',
  cup: 'survival', purifier: 'survival', // water gear sits with the rain barrel and sprinkler
  research: 'building', antenna: 'building', receiver: 'building',
});

// What each item is and what it is good for (shown in hover tooltips and the detail card).
export const ITEM_TEXT = Object.freeze({
  wood:       { desc: 'Driftwood planks fished from the sea.', use: 'Raft floors, tools and almost every build.' },
  leaf:       { desc: 'A tough, fibrous palm frond.', use: 'Twist into rope; thatch for sails and planters.' },
  plastic:    { desc: 'An old floating jug, still watertight.', use: 'Hooks and new raft floors (with the hammer).' },
  scrap:      { desc: 'Bent bits of salvaged metal.', use: 'Lanterns, crates and hook repairs.' },
  rope:       { desc: 'Palm fibre twisted into a sturdy cord.', use: 'Binds hammers, rods, nets and sails.' },
  fish:       { desc: 'A fresh catch from the open water.', use: 'Proof of a good day out on the waves.' },
  hook:       { desc: 'A scrap hook on a rope. Throw it at floating supplies.', use: 'Pulls in floating wood, leaves, plastic and barrels.' },
  hammer:     { desc: 'A rope-bound building hammer.', use: 'Adds raft floor tiles (2 plank + 2 plastic each).' },
  fishingrod: { desc: 'A bamboo rod with a float and line.', use: 'Cast into the sea and wait for a bite to catch fish.' },
  sail:       { desc: 'A tall mast with a woven sail.', use: 'Decorates the raft; place it on a floor tile.' },
  palm:       { desc: 'A clay pot with a small palm tree.', use: 'A bit of island on your raft; place on a tile.' },
  lantern:    { desc: 'A post lantern with a warm glow.', use: 'Lights the raft at night; place on a tile.' },
  net:        { desc: 'A rope net stretched over the water.', use: 'Catches nearby floating supplies for you.' },
  bench:      { desc: 'A simple plank bench.', use: 'Somewhere to sit; place it on a floor tile.' },
  crate:      { desc: 'A nailed wooden crate.', use: 'Decorates the raft; place it on a floor tile.' },
  sand:       { desc: 'Fine sand from barrels and the seafloor.', use: 'Melt it into glass in the smelter.' },
  stone:      { desc: 'A smooth, heavy stone.', use: 'Part of the smelter; sturdier builds and island tools.' },
  research:   { desc: 'A tinker\u2019s desk for studying finds.', use: 'Place it, then study parts to learn signal and water gear.' },
  motor:      { desc: 'A little outboard motor that burns leaves, wood, plastic or biofuel.', use: 'Place it, fuel it, and it pushes the raft along.' },
  wheel:      { desc: 'A rope-lashed steering wheel.', use: 'Place it, then grab it to steer the raft.' },
  bed:        { desc: 'A plank bed with a leaf mattress.', use: 'Lie down at night to sleep until morning.' },
  brush:      { desc: 'A paint brush with stiff bristles.', use: 'Click walls, floors or deck to paint; right click picks a colour.' },
  paint_seafoam:  { desc: 'A pot of soft seafoam green paint.', use: 'One pot paints one piece with the brush.' },
  paint_coral:    { desc: 'A pot of warm coral paint.', use: 'One pot paints one piece with the brush.' },
  paint_sunshell: { desc: 'A pot of sunny shell-yellow paint.', use: 'One pot paints one piece with the brush.' },
  paint_lagoon:   { desc: 'A pot of deep lagoon blue paint.', use: 'One pot paints one piece with the brush.' },
  paint_pebble:   { desc: 'A pot of pebble grey paint.', use: 'One pot paints one piece with the brush.' },
  clay:       { desc: 'Sticky clay from barrels and the seafloor.', use: 'Fire it into bricks on a grill.' },
  metalore:   { desc: 'A lump of ore from barrels and the seafloor.', use: 'Smelt it into metal ingots.' },
  receiver:   { desc: 'A crackling radio receiver.', use: 'Place one, add antennas, and follow the signal.' },
  antenna:    { desc: 'A rope-braced antenna mast.', use: 'Strengthens the receiver signal; place on a tile.' },
  cup:        { desc: 'An empty plastic cup.', use: 'Click the sea to scoop water.' },
  saltcup:    { desc: 'A cup of salty sea water.', use: 'Pour it into a water purifier.' },
  freshcup:   { desc: 'A cup of clean fresh water.', use: 'Water a palm planter.' },
  seed:       { desc: 'A palm seed.', use: 'Plant it in an empty palm planter.' },
  rainbarrel: { desc: 'A tub with a leaf funnel that catches the rain.', use: 'Fills by itself in the rain. Hold an empty cup and press E.' },
  sprinkler:  { desc: 'A little spinning head with its own tank.', use: 'Waters nearby palm planters for you. Fill it with fresh water, or put it next to a rain barrel.' },
  water:      { desc: 'A filtered cup of fresh water.', use: 'Water a palm planter.' },
  purifier:   { desc: 'A small still that boils off the salt.', use: 'Turns sea water into fresh water.' },
  // progression catalogue (items.js; its tooltips also show the item's own tip)
  copperore:  { desc: 'Green-flecked ore from a lucky barrel.', use: 'Smelt it into copper ingots.' },
  seaweed:    { desc: 'A slippery strand of seaweed.', use: 'Quick fuel for the grill and smelter.' },
  nail:       { desc: 'A handful of bent scrap nails.', use: 'Research tables, smelters and sturdier builds.' },
  brick:      { desc: 'A clay brick fired on the grill.', use: 'The walls of a smelter.' },
  metalingot: { desc: 'A bar of smelted metal.', use: 'Metal hooks, bolts and hinges.' },
  copperingot:{ desc: 'A bar of warm copper.', use: 'Fine parts for advanced gear.' },
  glass:      { desc: 'A pane of glass melted from sand.', use: 'Lenses for binoculars.' },
  bolt:       { desc: 'A threaded metal bolt.', use: 'Strong joints for advanced builds.' },
  hinge:      { desc: 'A small metal hinge.', use: 'Lids, doors and folding parts.' },
  metalhook:  { desc: 'A heavy metal hook that lasts much longer.', use: 'Throw it like the hook; wears far slower.' },
  spear:      { desc: 'A driftwood pole with a lashed flint point.', use: 'Click to jab: 5 damage, wears only when it lands.' },
  metalspear: { desc: 'A sturdy shaft with a steel point.', use: 'Click to jab: 10 damage, lasts twice as long.' },
  binoculars: { desc: 'Glass lenses in a copper tube.', use: 'Hold to spot barrels and islands far away.' },
  drum:       { desc: 'A wooden hand drum with a palm-leaf head.', use: 'Click to play; look up or down to change the note.' }, // [instruments]
  pipes:      { desc: 'Plastic reed tubes tied in a row.', use: 'Click to play soft breathy notes with your friend.' }, // [instruments]
  bells:      { desc: 'Brass-bright scrap bars on a small frame.', use: 'Click to ring a note that fades out softly.' }, // [instruments]
  camera:     { desc: 'A little box camera with a glass lens.', use: 'Click to snap photos; P opens your album.' }, // [camera]
  photoframe: { desc: 'A driftwood frame with a glass front.', use: 'Place it, then press E to show a photo.' }, // [camera]
  cookedfish: { desc: 'A fish grilled golden.', use: 'A hearty snack.' },
  flowerseed: { desc: 'A tiny seed from an island bush.', use: 'Plant it in a flower box.' }, // [bees]
  flowerbox:  { desc: 'A planter full of bright blooms.', use: 'Place near a beehive; bees love it.' }, // [bees]
  beehive:    { desc: 'A cosy straw hive of friendly bees.', use: 'Place by flower boxes; collect honeycomb with E.' }, // [bees]
  honey:      { desc: 'Sweet, golden and sticky.', use: 'Glaze a grilled fish.' }, // [bees]
  wax:        { desc: 'Soft beeswax from the comb.', use: 'Make beeswax candles.' }, // [bees]
  candle:     { desc: 'A little jar candle.', use: 'Glows warmly at night; place on a tile.' }, // [bees]
  taskboard:  { desc: 'A little notice board with three paper notes.', use: 'Place it, then press E to see the crew tasks.' }, // [tasks]
  honeyfish:  { desc: 'Grilled fish with a honey glaze.', use: 'A sweet treat.' }, // [bees]
  berries:    { desc: 'Tart little island berries.', use: 'Blend in a juicer, or eat as a snack.' }, // [juicer]
  coconut:    { desc: 'A hairy brown coconut.', use: 'Blend in a juicer, or eat as a snack.' }, // [juicer]
  juicer:     { desc: 'A hand-crank fruit juicer.', use: 'Press E with a cup of fresh water and 2 fruit.' }, // [juicer]
  berrycup:   { desc: 'A pink berry smoothie in a cup.', use: 'Drink it for water and a little food; keep the cup.' }, // [juicer]
  coconutcup: { desc: 'A cool coconut smoothie in a cup.', use: 'Drink it for lots of water; keep the cup.' }, // [juicer]
  mixcup:     { desc: 'Berries and coconut, blended.', use: 'Drink it for water and food; keep the cup.' }, // [juicer]
  perch:      { desc: 'A tall perch with a woven tray.', use: 'Offer grilled fish to a visiting gull; it may move in.' }, // [gull]
  finder:     { desc: 'A driftwood wand with a brass coil.', use: 'Hold it on island sand: it ticks faster near buried bundles.' },
  spade:      { desc: 'A little wooden spade with a metal blade.', use: 'E on island sand digs up bundles (or a pinch of sand).' },
  maptable:   { desc: 'A little driftwood chart table with brass fittings.', use: 'Place it, press E: see charted islands, drop pins, set a course.' },
  rug:        { desc: 'A woven mat of leaves and rope.', use: 'Place it on a deck tile; E turns it.' },
  pennant:    { desc: 'A little flag that flutters in the wind.', use: 'Place it on the raft; it shows which way the wind blows.' },
  fern:       { desc: 'A post with a hanging fern basket.', use: 'Place it on the raft for some green.' },
  chime:      { desc: 'Metal tubes that tinkle in the breeze.', use: 'Place it on the raft; E turns it.' },
  hammock:    { desc: 'A rope hammock between two posts.', use: 'Place it on the raft for a cosy corner.' },
  pots:       { desc: 'Three clay pots with little flowers.', use: 'Place it on the raft; E turns it.' },
  sign:       { desc: 'A wooden board you can write on.', use: 'Place it, then press E to write up to three lines.' },
  kiln:       { desc: 'A stone and clay kiln with a wood fire.', use: 'Place it, load ore, sand or clay and some wood; collect ingots, glass and bricks.' },
  glasslamp:  { desc: 'A lantern with clear glass panes.', use: 'Place it for a warm light on the raft.' },
  sinker:     { desc: 'A small metal weight for the hook line.', use: 'Keep it in your bag: the hook wears half as fast.' },
  puffegg:    { desc: 'A speckled egg from a puffhen.', use: 'Make an Egg Lantern.' },
  feather:    { desc: 'A soft puffhen feather.', use: 'Stuff a Feather Cushion.' },
  nestbox:    { desc: 'A cosy box of straw for puffhens.', use: 'Place it on the raft and a puffhen may come to stay.' },
  cushion:    { desc: 'A plump cushion stuffed with feathers.', use: 'Place it on the raft for a soft seat.' },
  cookedsharkmeat: { desc: 'A shark steak grilled through.', use: 'A filling meal (+30 food).' },
  sharkmeat:  { desc: 'A raw slab of shark meat.', use: 'Grill it for a proper meal; four come from every shark.' },
  sharkhead:  { desc: 'The head of a shark you beat.', use: 'A trophy, and proof the raft is safe for a while.' },
  shelf:      { desc: 'A little wooden display shelf.', use: 'Shows 3 items; E to put or take.' }, // [display]
  trophystand: { desc: 'A small pedestal with a brass plaque.', use: 'Shows 1 item or a fish trophy.' }, // [display]
  turbine:    { desc: 'A little three-blade wind turbine on a mast.', use: 'Place next to a battery; it charges in the wind.' }, // [power]
  battery:    { desc: 'A sturdy box that stores wind power.', use: 'Powers lights within 3 tiles at night. Check it with E.' }, // [power]
  stringlights: { desc: 'A post with a wire of warm little bulbs.', use: 'Glows at night near a charged battery.' }, // [power]
  lamppost:   { desc: 'A tall lamp with a glass head.', use: 'Lights the deck at night near a charged battery.' }, // [power]
  fishtrap:   { desc: 'A woven fish basket on a little arm.', use: 'Place on an edge tile. Seaweed bait helps. Collect with E.' }, // [fishtrap]
  skyrocket:  { desc: 'A little sky rocket on a stand.', use: 'Place on a tile, then press E to launch it.' }, // [fireworks]
  scarecrow:  { desc: 'A driftwood post in a leaf skirt and a bucket hat.', use: 'Place it near palm planters; gulls will not peck within about two tiles.' }, // [scarecrow]
  glidepost:  { desc: 'A tall mast with a grooved wheel on top.', use: 'Hold a Glide Handle and press E on two posts to string a line.' }, // [zipline]
  glidestep:  { desc: 'A shorter glide post.', use: 'Run a line down to it from a tall post for a speedy glide.' }, // [zipline]
  glidehandle: { desc: 'A wooden T-bar with a little wheel.', use: 'E links posts or hooks you on a line; Space lets go.' }, // [zipline]
  watertank: { desc: 'A wooden tank with copper hoops and a little glass window.', use: 'Press E with a fresh cup to pour it in, or with an empty cup to fill it. Pipes carry the water.' }, // [pipes]
  waterpipe: { desc: 'Copper pipe on little wooden cleats.', use: 'Lay a line from the tank. Rain barrels next to it fill the tank; palms and sprinklers drink.' }, // [pipes]
  researchtable: { desc: 'A table for showing off new finds.', use: 'Place it and research items to unlock recipes.' },
  grill:      { desc: 'A simple grill with a fire box.', use: 'Cooks fish and fires clay; feed it planks or leaves.' },
  smelter:    { desc: 'A brick furnace.', use: 'Melts ore into ingots and sand into glass.' },
  fins:       { desc: 'Webbed fins stitched with puff feathers.', use: 'Works from your bag: swim 30% faster underwater.' },
  airjug:     { desc: 'A sealed jug of fresh air.', use: 'Works from your bag: a dive lasts 75 s instead of 45 s.' },
  goggles:    { desc: 'Goggles with seaglass lenses.', use: 'Works from your bag: see much further underwater.' },
  scraper:    { desc: 'A flat metal scraper for the seafloor.', use: 'Works from your bag: gather sand, clay and ore faster.' },
  cookpot:    { desc: 'A squat clay pot on three stones.', use: 'Add 3 ingredients and wood; cooks 2 servings into bowls.' },
  bowl:       { desc: 'A little carved bowl.', use: 'Collect a meal from the Cooking Pot.' },
  meal_chowder:  { desc: 'Fish and seaweed simmered in fresh water.', use: 'Eat it: Swift Fins, swim 35% faster for 3 min.' },
  meal_omelette: { desc: 'A fluffy omelette of puff eggs and palm leaf.', use: 'Eat it: Springy Step, walk and jump 15% better for 3 min.' },
  meal_broth:    { desc: 'A clear, salty kelp broth.', use: 'Eat it: Deep Breath, dives last 60% longer for 3 min.' },
  meal_fishbowl: { desc: 'Grilled fish on palm leaf with toasted seeds.', use: 'Eat it: Steady Reel, reel 30% faster for 3 min.' },
  meal_custard:  { desc: 'A sweet, wobbly custard.', use: 'Eat it: Night Owl, nights look brighter for 4 min.' },
  meal_stew:     { desc: 'A hearty stew of fish, egg and seaweed.', use: 'Eat it: Cosy Glow, a little better at everything for 5 min.' },
  shell:      { desc: 'A bright, sun-bleached shell.', use: 'Pim takes these as coin at his trading barge.' },
  shellwreath:{ desc: 'A rope wreath set with bright shells.', use: 'Decorates the raft; place it on a tile.' },
  refiner:    { desc: 'A copper still that cooks scraps into fuel, no fire needed.', use: 'Load leaves, seaweed, seeds, fruit or raw fish; a jug every 30 s.' }, // [biofuel]
  fueltank:   { desc: 'A green drum that holds 8 Biofuel Jugs.', use: 'Place it next to a Little Motor; it tops up running motors.' }, // [biofuel]
  biofuel:    { desc: 'A jug of amber biofuel from the refiner.', use: 'Fuel a Little Motor (+150 s) or pour it into a Fuel Tank.' }, // [biofuel]
  glassfloat: { desc: 'A blue glass float in a rope net.', use: 'A rare keepsake from Pim; place it on a tile.' },

  // [recycler] floating junk + Sorting Tub
  oldboot:    { desc: 'A soggy old boot fished from the sea.', use: 'Sort it in a Sorting Tub for 2 plastic.' },
  tincan:     { desc: 'A dented tin can fished from the sea.', use: 'Sort it in a Sorting Tub for 2 scrap.' },
  seajar:     { desc: 'A cloudy glass jar fished from the sea.', use: 'Sort it in a Sorting Tub for 2 sand.' },
  recycler:   { desc: 'A hand-cranked sorting tub.', use: 'Turns junk into scrap, plastic and sand. No fuel.' },
});

const TOOLISH = new Set(['hook', 'hammer', 'fishingrod', 'rod', 'axe', 'spear']);

export function categoryOf(kind, info = null) {
  const k = String(kind ?? '');
  if (Object.prototype.hasOwnProperty.call(CATEGORY_OF, k)) return CATEGORY_OF[k];
  if ((info && info.tool) || TOOLISH.has(k)) return 'tools';
  return 'building';
}

/**
 * Group normalised recipes ({id, out:{kind}}) into tabs.
 * Returns only non-empty categories, in CATEGORIES order; recipe order is preserved.
 * @param {Array} recipes  @param {object} [infoMap] ITEM_INFO-like map (for the tool flag)
 */
export function groupRecipes(recipes, infoMap = null) {
  const buckets = new Map(CATEGORIES.map(c => [c.id, []]));
  for (const r of recipes || []) {
    if (!r) continue;
    const kind = r.out?.kind ?? r.id;
    buckets.get(categoryOf(kind, infoMap && infoMap[kind]))?.push(r);
  }
  return CATEGORIES.filter(c => buckets.get(c.id).length).map(c => ({ ...c, recipes: buckets.get(c.id) }));
}

/** Needed-vs-owned rows for a recipe's requirement list ({kind, count}). */
export function ingredientRows(reqs, countOf) {
  return (reqs || []).map(q => {
    const need = Math.max(0, Number(q.count) || 0);
    let have = 0;
    try { have = Math.max(0, Number(countOf(q.kind)) || 0); } catch { have = 0; }
    return { kind: q.kind, need, have, enough: have >= need, short: Math.max(0, need - have) };
  });
}

/** How many times the materials on hand cover the recipe (ignores bag space). */
export function craftableTimes(rows) {
  if (!rows || !rows.length) return Infinity;
  let n = Infinity;
  for (const r of rows) n = Math.min(n, r.need > 0 ? Math.floor(r.have / r.need) : Infinity);
  return n;
}

/** How many crafts of `id` in a row succeed with this bag's materials AND space, up to cap.
 *  Simulated on a copy (consuming ingredients can free slots). null if the bag cannot be copied. */
export function fittingTimes(bag, id, cap = 99) {
  let scratch;
  try { scratch = new bag.constructor(bag.snapshot()); } catch { return null; }
  if (typeof scratch.craft !== 'function') return null;
  let n = 0;
  try { while (n < cap && scratch.craft(id)?.ok) n++; } catch { return null; }
  return n;
}

/** 'ready' | 'missing' | 'full' given the rows and an optional Bag.canCraft() result. */
export function recipeState(rows, check = null) {
  if (rows.some(r => !r.enough)) return 'missing';
  if (check && check.full) return 'full';
  if (check && check.ok === false) return 'missing';
  return 'ready';
}

/** Recipes (normalised) that consume `kind`, by name. */
export function usedIn(kind, recipes) {
  const out = [];
  for (const r of recipes || []) if (r && (r.reqs || []).some(q => q.kind === kind)) out.push(r.name);
  return out;
}

/** "owned / needed" label for an ingredient row. */
export const amountLabel = row => `${row.have} / ${row.need}`;

/** Recipe tooltip line: owned/needed for every ingredient, e.g. "Have/need: 20/4 Wood · 0/2 Rope". */
export function haveNeedLine(rows, nameOf = k => k) {
  return (rows || []).length ? 'Have/need: ' + rows.map(x => `${x.have}/${x.need} ${nameOf(x.kind)}`).join(' · ') : '';
}

/** Slot tooltip stack size, worded so it can't be read as have/need: "stack 20/20". */
export function stackLabel(count, max) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return max > 0 ? `stack ${n}/${max}` : String(n);
}

// ---- hold-to-craft schedule ----
// A press crafts one immediately, and a plain click never makes more than that. Keep holding: the
// button fills for HOLD.first ms before the 2nd craft, then each interval shrinks by HOLD.decay
// down to HOLD.min ms.
export const HOLD = Object.freeze({ first: 800, decay: 0.7, min: 90, max: 99 });

/** Milliseconds to wait after the `done`-th craft (done >= 1) before the next one. */
export function holdDelay(done) {
  const n = Math.max(1, Math.floor(Number(done) || 1));
  return Math.max(HOLD.min, Math.round(HOLD.first * Math.pow(HOLD.decay, n - 1)));
}

/** Times (ms from press) at which crafts fire while held, for the first `count` crafts. */
export function holdSchedule(count) {
  const out = [];
  let t = 0;
  for (let i = 0; i < count; i++) { out.push(t); t += holdDelay(i + 1); }
  return out;
}

/** Number of crafts a hold of `ms` milliseconds produces (>= 1 once pressed), capped by `cap`. */
export function craftsForHold(ms, cap = HOLD.max) {
  let n = 1, t = holdDelay(1);
  while (t <= ms && n < cap) { n++; t += holdDelay(n); }
  return Math.min(n, Math.max(0, cap));
}

// ---- tooltip anchoring ----
const usableRect = r => !!r && [r.left, r.top, r.right, r.bottom].every(Number.isFinite) && (r.right - r.left > 0 || r.bottom - r.top > 0);
/**
 * Place a tooltip of size w x h beside an anchor rect {left, top, right, bottom} inside a
 * vw x vh viewport. Prefers the right side, then left, then below, then above; always clamped.
 * opts.beside: a column rect; the tooltip goes beside the whole column (row-aligned) instead of
 * just beside the anchor. opts.avoid: a rect it must not cover (the Craft button); the tooltip
 * slides above or below it when it can.
 * Returns null when the anchor has no box (hidden or detached), so callers hide the tooltip
 * instead of pinning it to the top-left corner.
 * @returns {{x:number, y:number, side:'right'|'left'|'below'|'above'}|null}
 */
export function anchorTip(rect, w, h, vw, vh, gap = 8, pad = 6, opts = null) {
  if (!usableRect(rect)) return null;
  const col = usableRect(opts?.beside) ? opts.beside : null;
  const L = col ? Math.min(col.left, rect.left) : rect.left, R = col ? Math.max(col.right, rect.right) : rect.right;
  const clampV = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const yAligned = clampV(rect.top, pad, vh - h - pad);
  const xAligned = clampV(rect.left, pad, vw - w - pad);
  let p;
  if (R + gap + w <= vw - pad) p = { x: R + gap, y: yAligned, side: 'right' };
  else if (L - gap - w >= pad) p = { x: L - gap - w, y: yAligned, side: 'left' };
  else if (rect.bottom + gap + h <= vh - pad) p = { x: xAligned, y: rect.bottom + gap, side: 'below' };
  else p = { x: xAligned, y: clampV(rect.top - gap - h, pad, vh - h - pad), side: 'above' };
  const a = usableRect(opts?.avoid) ? opts.avoid : null;
  if (a && p.x < a.right && p.x + w > a.left && p.y < a.bottom && p.y + h > a.top) {
    if (a.top - gap - h >= pad) p.y = a.top - gap - h;
    else if (a.bottom + gap + h <= vh - pad) p.y = a.bottom + gap;
  }
  return p;
}

/** True when a box can anchor a tooltip: it is laid out (not hidden, not detached). */
export const anchorVisible = el => !!el && el.isConnected !== false && usableRect(el.getBoundingClientRect?.());

/**
 * One recipe gate for the crafting panel from the progression gate ({hidden} | {locked, reason} |
 * null) and a host-side lock reason (string | null, e.g. storage-research craftLocked: the host
 * refuses those crafts, so the panel must not offer them). Hidden wins, then the first lock.
 */
export function mergeGate(prog, lockReason) {
  if (prog && (prog.hidden || prog.locked)) return prog;
  if (lockReason) return { locked: true, reason: String(lockReason) };
  return prog || null;
}

// ---- bag open/close and keyboard ----
/** A backdrop click closes the bag only when the press both started and ended on the backdrop. */
export const backdropCloses = (downOnBackdrop, upOnBackdrop) => !!downOnBackdrop && !!upOnBackdrop;

/**
 * What a key press does to the bag: 'open', 'close' or null (leave it alone).
 * Tab / I open it from play. While open, I / E close it and Tab is left to move focus.
 * E never opens here: in play it is the pick-up key and the game opens the bag itself.
 */
export function bagKeyAction(code, isOpen) {
  if (isOpen) return code === 'Tab' || code === 'KeyI' || code === 'KeyE' ? 'close' : null; // Tab toggles the bag; arrows move focus
  return code === 'Tab' || code === 'KeyI' ? 'open' : null;
}

const ARROWS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
/**
 * Arrow-key focus move across laid-out buttons. rects[i] = {left, top, width, height} (null = skip).
 * Returns the index of the nearest rect whose centre lies within 45° of the arrow's direction, or -1.
 */
export function arrowNeighbor(rects, from, code) {
  const d = ARROWS[code], a = rects[from];
  if (!d || !a) return -1;
  const cx = r => r.left + r.width / 2, cy = r => r.top + r.height / 2;
  const ax = cx(a), ay = cy(a), tol = Math.min(a.width, a.height) / 4;
  let best = -1, bestScore = Infinity;
  rects.forEach((r, i) => {
    if (!r || i === from) return;
    const dx = cx(r) - ax, dy = cy(r) - ay;
    const along = dx * d[0] + dy * d[1], across = Math.abs(dx * d[1] - dy * d[0]);
    if (along <= tol || across > along) return; // only within a 45° cone
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/**
 * Why a held stack of `kind` cannot go onto target slot t, or '' when it can.
 * max = stack limit of the held kind (1 = does not stack).
 */
export function placeRefusal(kind, t, max) {
  if (!t || !t.kind || !(t.count > 0)) return '';
  if (t.kind !== kind) return 'Different item there';
  if (!(max > 1)) return 'Doesn’t stack';
  if (t.count >= max) return 'That stack is full';
  return '';
}

// ---- recipe order ----
// Inside a tab, recipes you can make right now come first, then ones blocked only by bag space,
// then the rest, closest-to-done first (fewest ingredients short, then fewest units short).
// The sort is stable, so recipes keep their book order within each group.
const STATE_RANK = Object.freeze({ ready: 0, full: 1, missing: 2 });

/** views: [{state, rows}] (rows from ingredientRows). Returns a new, sorted array. */
export function sortCraftableFirst(views) {
  const key = v => {
    let kinds = 0, units = 0;
    for (const r of v?.rows || []) if (!r.enough) { kinds++; units += r.short; }
    return [STATE_RANK[v?.state] ?? 3, kinds, units];
  };
  return (views || []).map((v, i) => ({ v, i, k: key(v) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map(x => x.v);
}

// ---- where items come from ----
// `tag` is the short text beside a missing ingredient; `how` is the tooltip line.
export const ITEM_SOURCE = Object.freeze({
  flowerseed: Object.freeze({ tag: 'island bushes', how: 'Pick bushes on islands; some drop flower seeds.' }),
  honey:   Object.freeze({ tag: 'beehive', how: 'Put a beehive near flower boxes, then press E on it to collect honeycomb.' }),
  wax:     Object.freeze({ tag: 'beehive', how: 'Collected with honey from a full beehive (E).' }),
  berries:    Object.freeze({ tag: 'island bushes', how: 'Pick bushes on islands; some drop berries.' }), // [juicer]
  coconut:    Object.freeze({ tag: 'palm planter', how: 'Harvest a ripe palm planter.' }), // [juicer]
  berrycup:   Object.freeze({ tag: 'juicer', how: 'Press E on a juicer with a cup of fresh water and 2 fruit.' }), // [juicer]
  coconutcup: Object.freeze({ tag: 'juicer', how: 'Press E on a juicer with a cup of fresh water and 2 fruit.' }), // [juicer]
  mixcup:     Object.freeze({ tag: 'juicer', how: 'Press E on a juicer with a cup of fresh water and 2 fruit.' }), // [juicer]
  wood:    Object.freeze({ tag: 'found floating', how: 'Hook floating planks. Barrels hold more.' }),
  leaf:    Object.freeze({ tag: 'floating, palm', how: 'Hook floating leaf bundles, or harvest a grown palm.' }),
  plastic: Object.freeze({ tag: 'found floating', how: 'Hook floating plastic jugs. Barrels hold some too, or sort junk in a Sorting Tub.' }),
  scrap:   Object.freeze({ tag: 'found floating', how: 'Hook floating scrap. Barrels hold some too, or sort junk in a Sorting Tub.' }),
  seed:    Object.freeze({ tag: 'barrels, palm', how: 'Hook floating barrels, or harvest a grown palm.' }),
  fish:    Object.freeze({ tag: 'fishing rod', how: 'Cast the Fishing Rod into the sea and wait for a bite.' }),
  water:   Object.freeze({ tag: 'fill a cup', how: 'Fill a Filter Cup at the sea.' }),
  // raft-master materials (items.js): barrels, islands, the seafloor and the stations
  sand:        Object.freeze({ tag: 'barrels, islands', how: 'Hook floating barrels, scoop it on an island or dive for it, or sort junk in a Sorting Tub.' }),
  clay:        Object.freeze({ tag: 'barrels, seafloor', how: 'Hook floating barrels or dive to the seafloor.' }),
  stone:       Object.freeze({ tag: 'barrels, islands', how: 'Hook floating barrels or gather rocks on an island.' }),
  metalore:    Object.freeze({ tag: 'barrels, seafloor', how: 'Hook floating barrels or dive to the seafloor.' }),
  copperore:   Object.freeze({ tag: 'barrels', how: 'Hook floating barrels; copper ore is rare.' }),
  seaweed:     Object.freeze({ tag: 'barrels', how: 'Hook floating barrels.' }),
  brick:       Object.freeze({ tag: 'grill, kiln', how: 'Fire clay on a grill or in a Seaside Kiln.' }),
  metalingot:  Object.freeze({ tag: 'smelter, kiln', how: 'Smelt metal ore in a smelter or a Seaside Kiln.' }),
  copperingot: Object.freeze({ tag: 'smelter', how: 'Smelt copper ore in a smelter.' }),
  glass:       Object.freeze({ tag: 'smelter, kiln', how: 'Melt sand in a smelter or a Seaside Kiln.' }),
  saltcup:     Object.freeze({ tag: 'fill a cup', how: 'Hold an empty cup and click the sea.' }),
  freshcup:    Object.freeze({ tag: 'purifier', how: 'Pour sea water into a purifier and wait.' }),
  cookedfish:  Object.freeze({ tag: 'grill', how: 'Cook a fish on a grill.' }),
  // [bees] gathered from flower bushes and beehives
  flowerseed:  Object.freeze({ tag: 'bushes, barrels', how: 'Harvest bushes on islands, or open floating barrels.' }),
  honey:       Object.freeze({ tag: 'beehive', how: 'Press E at a full beehive placed near flower boxes.' }),
  wax:         Object.freeze({ tag: 'beehive', how: 'Collected with honey from a beehive (E).' }),
  // raft animals (animals.js)
  puffegg:     Object.freeze({ tag: 'puffhen', how: 'Place a Nest Box; a puffhen moves in and lays eggs. Press E on the nest to collect.' }),
  feather:     Object.freeze({ tag: 'puffhen', how: 'Sometimes left with the eggs in a puffhen nest box; collect with E.' }),
  // shark lane (shark.js): harvest the beaten shark with E
  sharkmeat:   Object.freeze({ tag: 'beaten shark', how: 'Fight off the shark with a spear, then press E on its body.' }),
  sharkhead:   Object.freeze({ tag: 'beaten shark', how: 'Harvested with the meat from a beaten shark (E).' }),
  cookedsharkmeat: Object.freeze({ tag: 'grill', how: 'Cook raw shark meat on a grill.' }),
  // Pim's trading barge (trader.js)
  shell:       Object.freeze({ tag: 'trader', how: 'Trade fish or puff eggs to Pim at his trading barge.' }),
  glassfloat:  Object.freeze({ tag: 'trader', how: 'A rare offer at Pim\u2019s trading barge; pay in Bright Shells.' }),
  // cooking pot (cookpot.js): meals are cooked, never crafted
  meal_chowder:  Object.freeze({ tag: 'cooking pot', how: 'Cooking Pot: fish + seaweed + fresh water; collect with a bowl.' }),
  meal_omelette: Object.freeze({ tag: 'cooking pot', how: 'Cooking Pot: 2 puff eggs + palm leaf; collect with a bowl.' }),
  meal_broth:    Object.freeze({ tag: 'cooking pot', how: 'Cooking Pot: 2 seaweed + fresh water; collect with a bowl.' }),
  meal_fishbowl: Object.freeze({ tag: 'cooking pot', how: 'Cooking Pot: cooked fish + palm leaf + seed; collect with a bowl.' }),
  meal_custard:  Object.freeze({ tag: 'cooking pot', how: 'Cooking Pot: puff egg + seed + fresh water; collect with a bowl.' }),
  meal_stew:     Object.freeze({ tag: 'cooking pot', how: 'Cooking Pot: cooked fish + puff egg + seaweed; collect with a bowl.' }),
  biofuel: Object.freeze({ tag: 'biofuel refiner', how: 'Biofuel Refiner: load leaves, seaweed, seeds, fruit or raw fish; collect the jugs.' }), // [biofuel]

  oldboot:     Object.freeze({ tag: 'found floating', how: 'Hook it as it drifts by. Nets catch it too.' }), // [recycler]
  tincan:      Object.freeze({ tag: 'found floating', how: 'Hook it as it drifts by. Nets catch it too.' }),
  seajar:      Object.freeze({ tag: 'found floating', how: 'Hook it as it drifts by. Nets catch it too.' }),
});

/**
 * Where to get `kind`: {tag, how, recipe}. `recipe` is the id of a recipe that makes it, or null.
 * Gathered items use ITEM_SOURCE; crafted ones describe their own recipe. Otherwise null.
 * @param {string} kind @param {Array} recipes normalised recipes @param {(k:string)=>string} [nameOf]
 */
export function sourceOf(kind, recipes, nameOf = k => k) {
  const made = (recipes || []).find(r => r && (r.out?.kind ?? r.id) === kind) || null;
  const known = ITEM_SOURCE[kind];
  if (known) return { tag: known.tag, how: known.how, recipe: made ? made.id : null };
  if (!made) return null;
  const cost = (made.reqs || []).map(q => `${q.count} ${nameOf(q.kind)}`).join(' + ');
  return { tag: 'craft it', how: cost ? `Craft it from ${cost}.` : 'Craft it.', recipe: made.id };
}

// ---- pinned recipe tracker (HUD edge) ----
export const PIN_KEY = 'little-raft-pinned-recipe';

/** The pinned recipe id from storage, or null when unset, not in validIds, or storage throws. */
export function loadPin(storage, validIds = null) {
  let v = null;
  try { v = storage?.getItem(PIN_KEY) ?? null; } catch { return null; }
  if (typeof v !== 'string' || !v) return null;
  if (validIds && !validIds.includes(v)) return null;
  return v;
}
/** Store the pinned recipe id, or clear it with null. Returns false when storage refuses. */
export function savePin(storage, id) {
  try {
    if (!storage) return false;
    if (id) storage.setItem(PIN_KEY, String(id)); else storage.removeItem(PIN_KEY);
    return true;
  } catch { return false; }
}

/**
 * What the HUD tracker shows for a normalised recipe: its owned/needed rows, state, how many
 * crafts the materials cover, and how many ingredient lines are complete.
 * `check` is an optional Bag.canCraft() result. Returns null without a recipe.
 */
export function trackerView(recipe, countOf, check = null) {
  if (!recipe) return null;
  const rows = ingredientRows(recipe.reqs, countOf);
  const times = craftableTimes(rows);
  return {
    id: recipe.id, name: recipe.name, kind: recipe.out?.kind ?? recipe.id, rows,
    state: recipeState(rows, check), times: Number.isFinite(times) ? times : 0,
    met: rows.filter(r => r.enough).length, total: rows.length,
  };
}

/** Craft button label. Right after a batch (`done` = { n, name }) it reports the success, even
 *  though the batch has usually used the materials up, instead of a grey 'Missing materials'. */
export function craftButtonText(state, done = null) {
  if (done && done.n > 0) return `Crafted ${done.n}${done.name ? ' ' + done.name : ''}`;
  return state === 'ready' ? 'Craft' : state === 'full' ? 'Bag is full' : 'Missing materials';
}

/** Craft button hint: how many a hold would make right now ('' when one or none). */
export function holdHint(times, cap = HOLD.max) {
  const n = Math.min(Number.isFinite(times) ? Math.floor(times) : cap, cap);
  return n > 1 ? `hold: up to ${n}` : '';
}

/**
 * Craft button text while a hold is running ('Crafting 2 / 4') and just after it ends ('Crafted 4').
 * `out` = items each craft makes, so a nail recipe (x3) reads 'Crafted 12' after 4 crafts.
 */
export function holdLabel(done, cap, holding = true, out = 1) {
  const d = Math.max(0, Math.floor(Number(done) || 0));
  const per = Math.max(1, Math.floor(Number(out) || 1));
  if (!holding) return d > 0 ? `Crafted ${d * per}` : '';
  const c = Math.max(d, Math.floor(Number(cap) || 0));
  return c > 1 ? `Crafting ${d} / ${c}` : 'Crafting';
}

// ---- tooltip facts ----
/**
 * Hand recipes (RECIPES-like: {id, name, output:{kind,count}, cost}) plus station and catalogue
 * recipes (ITEMS-like: {id, name, recipe:{cost, count, station}}) as one normalised list
 * ({id, name, out:{kind,count}, reqs, station}). A hand recipe wins over a catalogue one with the same id.
 */
export function catalogueRecipes(recipes, items) {
  const out = [], seen = new Set();
  const reqsOf = cost => Object.entries(cost || {}).map(([kind, count]) => ({ kind, count: Number(count) || 0 }));
  for (const [key, r] of Object.entries(recipes || {})) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id ?? key);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(r.name ?? id), out: { kind: r.output?.kind ?? id, count: r.output?.count ?? 1 }, reqs: reqsOf(r.cost), station: null });
  }
  for (const [key, it] of Object.entries(items || {})) {
    const r = it && it.recipe;
    if (!r || typeof r !== 'object') continue;
    const id = String(it.id ?? key);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(it.name ?? id), out: { kind: id, count: r.count ?? 1 }, reqs: reqsOf(r.cost), station: r.station ?? null });
  }
  return out;
}

/**
 * The "where to get it" and "used in" lines for an item tooltip.
 * get: one sentence or null. uses: names of recipes that consume the item, at most `max`
 * entries (the last one becomes '+N more' when the list is longer).
 * @param {string} kind @param {Array} recipes normalised recipes @param {(k:string)=>string} [nameOf]
 */
export function tipFacts(kind, recipes, nameOf = k => k, max = 4) {
  const src = sourceOf(kind, recipes, nameOf);
  const all = [...new Set((recipes || []).filter(r => r && (r.reqs || []).some(q => q.kind === kind))
    .map(r => r.station ? `${r.name} (${nameOf(r.station)})` : r.name))];
  const m = Math.max(1, Math.floor(max));
  const uses = all.length > m ? [...all.slice(0, m - 1), `+${all.length - (m - 1)} more`] : all;
  let get = src ? src.how : null;
  const made = src && src.recipe ? (recipes || []).find(r => r && r.id === src.recipe) : null;
  if (made && made.station && !ITEM_SOURCE[kind]) {
    const cost = (made.reqs || []).map(q => `${q.count} ${nameOf(q.kind)}`).join(' + ');
    get = `Make it at the ${nameOf(made.station)}${cost ? ` from ${cost}` : ''}.`;
  }
  return { get, uses };
}
