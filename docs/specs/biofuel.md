# Biofuel Refiner + Fuel Tank: spec

Research: `docs/features/biofuel-research.md` (option B). Anchors are for this branch; paths under `dist/`.
Goal: a **Biofuel Refiner** turns raw organic scraps into **Biofuel Jugs** (no wood, no fire), and a **Fuel Tank** stores
jugs and tops up running Little Motors next to it. Cozy: nothing spoils, nothing is wasted, nothing breaks.
Ownership: new `biofuel.js` owns refiners and tanks (`world.ext.biofuel`); motor fuel stays only in `ext.engine`.

## 1. Rules (decided)
- **Refiner** (`refiner` decor). Hold an organic item, E loads one batch (`need` items) = 1 jug queued. Queue cap 6.
  Batches refine one at a time, **30 s per jug** whatever the input; finished jugs land in a tray (cap 4). While the tray
  is full the timer waits (nothing lost). E with no organic held and jugs in the tray takes **all** jugs (all-or-nothing).
- **Organic inputs** `ORGANIC` (items per jug): `leaf 3, seaweed 2, seed 3, berries 2, coconut 1, fish 1, sharkmeat 1`.
  Cooked food, cups and meals are refused ("That does not go in the refiner"). Loading mixes kinds freely (one output).
- **Biofuel Jug** (`biofuel`, stack 10): a motor fuel. Held + E on a motor = hand fuel exactly like wood (engine rules).
- **Fuel Tank** (`fueltank` decor): holds **8 jugs**. Holding jugs, E pours in `min(held count, 8 - k)` jugs
  (refused only when full: "The tank is full"). Not holding jugs and k > 0, E takes **all** k jugs, or nothing with
  "Your bag is full" if they do not all fit (checked on a scratch Bag copy).
- **Auto top-up** (host, once per second): for each tank with k > 0 (sorted keys), for each motor with
  `max(|dx|,|dz|) <= 1` (Chebyshev, power.js:71) that is **on** and has `fuel <= FUEL_CAP - 150`
  (sorted `motorKeys`), call `engine.pour(x, z, 150)`; if it returns 150, `k--`. At most one jug per motor per second.
  Never pours into off motors (parked fuel cannot be taken back out), never toggles motors, no notices per pour.
  Anchored rafts still pour (burn is paused there, so this rarely happens). A jug is never split or wasted.

## 2. Items (`content-items.js`)
- `CONTENT_ITEMS` after the cookpot block :51-57 (before `});` :58), placeholder icons (no icons.svg work):
  `refiner: item('refiner','Biofuel Refiner','icon-kiln')`, `fueltank: item('fueltank','Fuel Tank','icon-cup')`,
  `biofuel: item('biofuel','Biofuel Jug','icon-cup', true, 10)`.
- `CONTENT_RECIPES` after `bowl` :101: `refiner: recipe('refiner','Biofuel Refiner',1,{copperingot:2, glass:1, scrap:2})`,
  `fueltank: recipe('fueltank','Fuel Tank',1,{scrap:4, metalingot:1, rope:1})`. **No recipe for `biofuel`.**
- Gating: like every content recipe, research `learnedFrom` (storage-research.js:40) unlocks each once all its cost kinds
  were seen, so the refiner follows the smelter (copper) and glass; the tank follows the first metal ingot. No `unlock`/`tip`.
- `CONTENT_DECOR` :105 add `'refiner','fueltank'`; `CONTENT_BLOCK_RADIUS` :106 add `refiner: .45, fueltank: .38`.
- Never `category:'station'` in items.js (progression would hijack model + panel, research sec. 3).

## 3. Engine changes (`engine.js`, minimal; existing behaviour byte-identical)
- :13 `FUEL: Object.freeze({ leaf: 20, wood: 45, plastic: 60, biofuel: 150 })`. :31 `NAMES` add `biofuel: 'biofuel'`
  (texts become "+150 s fuel", "No biofuel in your bag", prompt "Add biofuel (+150 s)"). Hand fuel keeps the engine
  rules (refused at >= 299, overflow clamped); the tank is the waste-free path.
- New pure export after `slot()` :122-127: `pourFuel(slice, decor, x, z, sec)` -> accepted seconds. Returns 0 unless
  `okXZ`, `hasMotor` (:120), `fin(sec) && sec > 0`, `slot()` non-null and `fuel + sec <= FUEL_CAP`; else adds, rounds
  to 0.1 and returns `sec`. Does not check `on` (biofuel.js does, via peek).
- Module method next to `serialize` :263: `pour(x, z, sec) { return ctx.role === 'guest' ? 0 : pourFuel(st, decor(), x, z, sec); }`.
  `debug.fuel` :333-337 unchanged.

## 4. `biofuel-core.js` (new, pure: no imports, DOM, THREE, Date, Math.random)
- `BIO = {QUEUE:6, TRAY:4, SECS:30, TANK:8, MAX_DT:1, REACH:3.2, MAX_REFINERS:100, MAX_TANKS:64, RANGE:1, JUG_SEC:150}`,
  `ORGANIC` (sec. 1), `BIO_ACTIONS = ['bio.load','bio.take','bio.fill','bio.empty']`, `keyOf`, `NAMES`, `TEXT`.
- Slice `world.ext.biofuel = { v:1, r, s, f: {"x,z": {q, t, n}}, k: {"x,z": jugs} }`; f = refiners (q 0..6 queued,
  t 0..SECS progress, n 0..4 tray), k = tanks (1..8; empty tanks omitted). `cleanSlice(data, decorAt)` like
  kiln-core.js:48-66: KEY_RE, |x|,|z| <= 25, ints clamped, t finite clamp, caps in **sorted** key order, drops keys whose
  decor is not refiner/fueltank (decorAt omitted on net loads), idle refiners `{0,0,0}` omitted; never throws.
  `r` int >= 0 (else 0), `s` string <= 12 chars (else '').
- `step(e, dt)`: dt clamped `[0, MAX_DT]`; if q > 0 and n < TRAY: t += dt; on t >= SECS: q--, n++, t -= SECS (t = 0 if q = 0).
  Returns true if q/n changed. `stepAll(st, dt)` -> any change. `progress(e)` = t / SECS (0 when q = 0).
- `applyBioAction(st, a, actor, bag, env)` -> `{ok, reason, text, n}`, kiln-style (kiln-core.js:132-174): validate kind,
  ints, 28-slot bag, `env.decorAt` type (`refiner` for load/take, `fueltank` for fill/empty), reach via `env.pos`; mutate a
  scratch `new bag.constructor(bag.snapshot())`, commit only on success; **every success `st.r++`, refusals change nothing**.
  - `bio.load {x,z,item}`: ORGANIC item, have >= need ("Need 2 more seaweed"), q < QUEUE ("The refiner is full").
    Text `Loaded 3 leaf · 2 jugs queued`.
  - `bio.take {x,z}`: n > 0 ("Nothing ready yet"), `scratch.add('biofuel', n)` must leave 0 ("Your bag is full"). `+ 2 Biofuel Jug`.
  - `bio.fill {x,z}`: bag has biofuel ("Hold a Biofuel Jug"), k < TANK; moves min(count, TANK - k). `Poured 3 jugs · 5/8`.
  - `bio.empty {x,z}`: k > 0 ("The tank is empty"), all-or-nothing add as take. `+ 5 Biofuel Jug`.
- `topUp(st, decor, motors, pour)`: pure order of sec. 1; `motors` = engine slice (read only), `pour(x,z,sec)` callback.
  Returns jugs used; `st.r++` if > 0. Deleted tank entry when k hits 0.

## 5. `biofuel.js` (new content module, name `'biofuel'`, shape of kiln.js)
- State: `session = Math.random().toString(36).slice(2,10)`, `st = cleanSlice(undefined)`, `st.s = session`.
- `serialize()`: cached `sliceOf(st)` by `st.r` (kiln.js:50-54). `load(data, from)`: `'net'` skips when `data.r === netR &&
  data.s === netS`, sets `hostHas = data !== undefined` (juicer.js:174-180); `'save'/'restore'`: `cleanSlice(data, decorAt)`,
  `st.s = session; st.r++`, `hostHas = true`.
- `update(dt)` host (`ctx.role !== 'guest'`) only: `stepAll` (r++ on change); a 1 s clock that prunes orphan keys (kiln.js:99-114)
  and runs `topUp(st, decor, peer.peek('engine')?.motors ?? {}, (x,z,s) => peer('engine')?.pour?.(x,z,s) ?? 0)`,
  wrapped in try/catch (peer calls are not guarded by content.js). Only while `ctx.running`. Every role: `visuals(dt)`.
- `interact(aim)`: `target(aim)` copy of kiln.js nearest-decor ray test for `refiner` (centre y .7) / `fueltank` (y .5).
  Refiner: ORGANIC held -> `bio.load`; else n > 0 -> `bio.take`; else notice "Hold leaves, seaweed, fish or fruit to refine".
  Tank: biofuel held -> `bio.fill`; else k > 0 -> `bio.empty`; else notice "Hold Biofuel Jugs to fill the tank". Returns true.
- `action(a, actor, bag)`: `a.kind` startsWith `'bio.'`; `bag ?? ctx.actorBag(actor)`; emits `loot` (take/empty), `build`
  (load/fill), `full` (bagfull) or `notice` to the actor (kiln.js:145-151).
- `prompt(aim)`: HTML only, cached by key/r/selected/percent (kiln.js:116-133), `ctx.esc` on text:
  `<kbd>E</kbd>Load 3 leaf · 2 queued 40% · 1 ready` | `<kbd>E</kbd>Take 3 Biofuel Jugs` | `Biofuel Refiner · hold leaves or fish`;
  tank `<kbd>E</kbd>Pour in 3 jugs · 5/8` | `<kbd>E</kbd>Take 5 jugs · 5/8 · feeds motors next to it` | `Fuel Tank · empty`.
- **OLD_HOST** `'Your friend’s raft doesn’t have a biofuel refiner yet'`: guest with `!hostHas` gets it as prompt and as
  `ctx.notice(OLD_HOST, 2400)` on E, and sends nothing (juicer.js:12, :211, :218).
- `decorModel(type)` for `refiner`/`fueltank` (sets `dirty`); `dispose()`; `debug`: `state()`, `place(type,x,z)` (copy engine
  debug.place, host), `jugs(x,z,n)` (host, sets tank k), `fast(sec)` (host, adds t to all refiners), `clear()`.

## 6. `biofuel-model.js` (new, THREE passed in, painter/mergeParts pattern of kiln-model.js, shared geometry, `instance()`)
- `buildRefiner(T)` (group name `'bio_refiner'`, `userData.bio = {bulb, liquid, bubbles[3], jugs[4]}`): merged static part:
  wood plinth .8x.08x.6, copper pot cylinder r .22 h .35 `#c77a45` with a squashed sphere dome and a cap knob, a bent copper
  pipe (3 short cylinders) to a side stand. Separate meshes: glass bulb sphere r .14 (`transparent`, opacity .35, `#cfe8e4`)
  on the stand at y .55; amber liquid sphere inside (`#d9a73a`, scale.y = .15 + .85 * progress); 3 bubble spheres r .015;
  4 tiny jug boxes .08x.12x.08 on the plinth edge, `visible = i < n`. ~6 meshes + merged base.
- `buildTank(T)` (`'bio_tank'`, `userData.bio = {level, cap}`): merged drum cylinder r .3 h .75 `#5f8a6b`, two darker rims,
  a top cap and a short hose stub; level window dark box .07x.5 on the +z face, amber `level` box inside (scale.y = k/8,
  bottom-anchored). 2 meshes + merged base.
- **View-only animation** (every role, local clock, never synced): bubbles rise in the bulb and wrap while q > 0 and the tray
  is not full; liquid eases toward the target progress; tank level eases (rate 2/s) toward k/8, so a pour visibly drops it.
  Rescan `ctx.raft.children` when the child count changes (kiln.js:68-75); skip work when nothing is refining or easing.

## 7. Other files
- `content.js`: import `createBiofuel` from `./biofuel.js?build=v3-survival-ae77fa84ac2b` after :59; FEATURES :69 insert
  `createBiofuel` **immediately before `createCookpot`** (cookpot stays last, tests/cookpot.test.mjs:327).
- `craft-book.js`: CATEGORY :45 add `refiner: 'building', fueltank: 'building', biofuel: 'materials'`; INFO :71 motor desc
  "burns leaves, wood, plastic or biofuel"; INFO after :167 `refiner` / `fueltank` / `biofuel` desc+use; ITEM_SOURCE after the
  cookpot block :452-458: `biofuel: Object.freeze({ tag: 'biofuel refiner', how: 'Biofuel Refiner: load leaves, seaweed,
  seeds, fruit or raw fish; collect the jugs.' })` (craft-ux.test.mjs:124-136 needs it).
- `game.js`: nothing (decor via CONTENT_DECOR/decorModel, actions via content.action, E via content.interact, ext via serialize).

## 8. Co-op and saves
- Guest E -> `ctx.action({kind:'bio.fill',x,z})` -> host `applyBioAction` with the guest's `actorBag` -> notice to the guest ->
  snapshot carries `ext.biofuel` (net-skipped by r+s) and `ext.engine`. Guests never step, prune or pour.
- Old host: drops `bio.*` and unknown decor; new guest sees OLD_HOST. Old host + guest jug on a motor: "Not fuel" (harmless).
- Old save: `load(undefined)` -> empty slice. Old build + new save: refiner/fueltank decor dropped by `cleanWorld` (game.js:208),
  bags with `biofuel` start fresh (content-items.js:4 caveat, same as every new item). Slice tiny (<= 164 small entries).

## 9. Tests
- `tests/biofuel.test.mjs` (new): cleanSlice garbage/caps/sorted drop/decorAt filter/idle omitted; step timing (30 s per jug,
  tray-full stall, dt clamp); every action success + every refusal leaves bag and slice deep-equal (r unchanged); take/empty
  all-or-nothing with a nearly full bag; fill partial to cap; topUp: Chebyshev range, only `on` motors, threshold 150, sorted
  order, one jug per motor, pour returning 0 keeps the jug; fake-ctx module: host update pours via a fake engine peer,
  guest update never pours, net load skip by r+s, OLD_HOST prompt/notice, serialize round-trip; FEATURES order (biofuel before
  cookpot, cookpot last); ITEM_INFO has the three kinds, biofuel has no recipe and has a source.
- `tests/engine.test.mjs`: keep **all existing assertions unchanged** (leaf/wood/plastic numbers, texts, cleanEngine). Add:
  biofuel fuel gives "+150 s fuel", missing jug "No biofuel in your bag", prompt "Add biofuel (+150 s)"; `pourFuel` accepts
  at 150, refuses at 150.1 / no motor / NaN / sec <= 0 / 65th entry without touching the slice; `mod.pour` returns 0 on a guest.
- Re-run tests/storage-research.test.mjs exact learned lists and craft-ux/item-icons; update a list only if a new recipe joins it.

## 10. Files
New: `dist/biofuel-core.js`, `dist/biofuel.js`, `dist/biofuel-model.js`, `tests/biofuel.test.mjs`.
Edited: `dist/engine.js` (:13, :31, after :127, :263), `dist/content-items.js` (:57, :101, :105, :106), `dist/content.js` (:59, :69),
`dist/craft-book.js` (:45, :71, :167, :458), `tests/engine.test.mjs` (additions only).
