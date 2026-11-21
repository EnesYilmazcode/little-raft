#!/usr/bin/env node
// Little Raft progression balance simulator (node, no deps).
//
// A scripted greedy player plays N simulated minutes in 1 s steps against the REAL
// economy modules: dist/items.js (ITEMS, rollBarrel, PROGRESSION_PLAN, FUEL_VALUE,
// wearPerUse, repairCost), dist/progression.js (Progression, craft), dist/smelter.js
// (StationModel) and dist/inventory-state.js (Bag). Income constants (SPAWN_TABLE,
// LOOT, FLOOR_COST, CHARGE_MS, drift, net radius/clock, item count) are parsed from
// dist/game.js and the hook constants from dist/hook-physics.js, so retuning those
// files changes the sim without editing it.
//
// Usage:
//   node tools/sim-progression.mjs [--seed 1] [--runs 200] [--skill 1] [--minutes 120]
//        [--dist path/to/dist] [--strict] [--nearest-only] [--overhead 7] [--json]
//
//   --runs N      run seeds seed..seed+N-1 and report p10 / median / p90
//   --skill S     1 = attentive player; scales per-cast overhead (--overhead 7 s / S) and aim
//   --overhead S  human time per cast at skill 1 (7 s calibrates to ~4.5-5 hooked items/min)
//   --dist DIR    module directory (default ../dist); use a patched copy to try numbers
//   --strict      craft goals strictly in PROGRESSION_PLAN order (no look-ahead)
//   --nearest-only  always hook the nearest item, even if it cannot fit (default: skip debris
//                 that cannot fit or is already >= --plenty (40) in the bag, skip barrels when no slot is free)
//
// Known gap handled here: the shipped Bag (inventory-state.js) only knows the 15 legacy
// kinds, so new kinds (clay, nail, brick...) would be rejected. If that is still the case
// the sim loads the same Bag source with ITEM_INFO / TOOL_KINDS taken from items.js
// (infoTable(), TOOL_IDS); stacking, slot and atomic-add logic stay the real code.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const OPT = {
  seed: Number(flag('seed', 1)),
  runs: Number(flag('runs', 1)),
  skill: Number(flag('skill', 1)),
  minutes: Number(flag('minutes', 120)),
  overhead: Number(flag('overhead', 7)),
  strict: !!flag('strict', false),
  nearestOnly: !!flag('nearest-only', false),
  json: !!flag('json', false),
  plenty: Number(flag('plenty', 40)),
  dist: resolve(flag('dist', resolve(dirname(fileURLToPath(import.meta.url)), '../dist'))),
};

// ---------------------------------------------------------------- real modules
const distURL = (f) => pathToFileURL(resolve(OPT.dist, f)).href;
const itemsMod = await import(distURL('items.js'));
const { ITEMS, ITEM_IDS, PROGRESSION_PLAN, rollBarrel, wearPerUse, repairCost, fuelValue } = itemsMod;
const { Progression, craft } = await import(distURL('progression.js'));
const { StationModel } = await import(distURL('smelter.js'));
let { Bag } = await import(distURL('inventory-state.js'));
let BAG_SHIM = false;
if (new Bag().add('clay', 1) > 0) {
  BAG_SHIM = true;
  let src = readFileSync(resolve(OPT.dist, 'inventory-state.js'), 'utf8');
  const head = `import { infoTable as __info, TOOL_IDS as __tools } from ${JSON.stringify(distURL('items.js'))};\n`;
  src = src.replace(/const TOOL_KINDS = new Set\([^)]*\);/, 'const TOOL_KINDS = new Set(__tools);');
  src = src.replace(/export const ITEM_INFO = Object\.freeze\(\{[\s\S]*?\n\}\);/, 'export const ITEM_INFO = __info();');
  ({ Bag } = await import('data:text/javascript,' + encodeURIComponent(head + src)));
  if (new Bag().add('clay', 1) > 0) throw new Error('Bag shim failed');
}

// ---------------------------------------------------------------- constants from game.js / hook-physics.js
const gameSrc = readFileSync(resolve(OPT.dist, 'game.js'), 'utf8');
const hookSrc = readFileSync(resolve(OPT.dist, 'hook-physics.js'), 'utf8');
const lit = (src, name, def) => {
  const m = src.match(new RegExp(`(?:const|,)\\s*${name}\\s*=\\s*(?:Object\\.freeze\\()?([\\[{][^;]*?[\\]}])\\)?;`));
  if (!m) return def;
  try { return Function(`return (${m[1]});`)(); } catch { return def; }
};
const num = (src, name, def) => {
  const m = src.match(new RegExp(`\\b${name}\\s*=\\s*([0-9.]+)`));
  return m ? Number(m[1]) : def;
};
const G = {
  SPAWN_TABLE: lit(gameSrc, 'SPAWN_TABLE', ['wood', 'wood', 'wood', 'plastic', 'plastic', 'plastic', 'leaf', 'leaf', 'leaf', 'scrap', 'barrel']),
  LOOT: lit(gameSrc, 'LOOT', { wood: { wood: 2 }, leaf: { leaf: 1 }, scrap: { scrap: 1 }, plastic: { plastic: 1 } }),
  FLOOR_COST: lit(gameSrc, 'FLOOR_COST', { wood: 2, plastic: 2 }),
  CHARGE_MS: num(gameSrc, 'CHARGE_MS', 900),
  MIN_CHARGE: num(gameSrc, 'MIN_CHARGE', 0.15),
  ITEM_COUNT: Number((gameSrc.match(/for \(let i = 0; i < (\d+); i\+\+\) world\.items\.push\(makeItem/) || [])[1] || 30),
  DRIFT: Number((gameSrc.match(/it\.z \+= dt \* ([0-9.]+)/) || [])[1] || 0.22),
  NET_RADIUS: Number((gameSrc.match(/net\.z \* 2\) < ([0-9.]+)/) || [])[1] || 4),
  NET_CLOCK: Number((gameSrc.match(/netClock > ([0-9.]+)/) || [])[1] || 0.8),
  FISH_WAIT_MIN: 3, FISH_WAIT_RANGE: 2, FISH_REEL: 0.8, // fishWait = 3 + rand*2; duration = wait + .8
  BASE_SPEED: num(hookSrc, 'BASE_SPEED', 7),
  CHARGE_SPEED: num(hookSrc, 'CHARGE_SPEED', 11),
  REEL_SPEED: num(hookSrc, 'REEL_SPEED', 8),
  CATCH_RADIUS: num(hookSrc, 'CATCH_RADIUS', 1),
  MAX_CAUGHT: num(hookSrc, 'MAX_CAUGHT', 8),
  GRAVITY: num(hookSrc, 'GRAVITY', 9.8),
};
// Barrel loot: game.js still has the fixed LOOT.barrel; the progression lane replaces it with rollBarrel().

// ---------------------------------------------------------------- helpers
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const isRaw = (k) => !ITEMS[k].recipe;
const isStationKind = (k) => ITEMS[k].category === 'station';
const TOOL_HOOKS = ['metalhook', 'hook'];
const T = { craft: 2, place: 3, station: 3, research: 3, repair: 2, floor: 2 }; // seconds of UI/walking per action

// Goals in PROGRESSION_PLAN order (plus the floor tiles, research step and late decor).
// made: counts crafted/smelted; placed: counts placed on the raft.
const GOALS = [
  { key: 'rope', make: { rope: 1 } },
  { key: 'hammer', make: { hammer: 1 } },
  { key: 'floor', floors: 3 },
  { key: 'bench', place: { bench: 1 } },
  { key: 'palm', place: { palm: 1 } },
  { key: 'nail', make: { nail: 1 } },
  { key: 'fishingrod', make: { fishingrod: 1 } },
  { key: 'sail', place: { sail: 1 } },
  { key: 'researchtable', place: { researchtable: 1 } },
  { key: 'grill', place: { grill: 1 } },
  { key: 'cookedfish', make: { cookedfish: 1 } },
  { key: 'net', place: { net: 2 } },
  { key: 'brick', make: { brick: 1 } },
  { key: 'smelter', place: { smelter: 1 } },
  { key: 'metalingot', make: { metalingot: 1 } },
  { key: 'bolt', make: { bolt: 1 } },
  { key: 'hinge', make: { hinge: 1 } },
  { key: 'metalhook', make: { metalhook: 1 } },
  { key: 'glass', make: { glass: 1 } },
  { key: 'copperingot', make: { copperingot: 1 } },
  { key: 'binoculars', make: { binoculars: 1 } },
  { key: 'lantern', place: { lantern: 1 }, late: true },
  { key: 'crate', place: { crate: 1 }, late: true },
  { key: 'net4', place: { net: 4 }, late: true },
];
// Late goals still need what binoculars need, so the look-ahead treats them as lowest priority.

// ---------------------------------------------------------------- one run
function simulate(seed) {
  const rand = mulberry32(seed);
  const skill = OPT.skill;
  const H = OPT.overhead / skill;
  const bag = new Bag();
  const prog = new Progression();
  const stations = {}; // id -> StationModel
  const tiles = [];
  for (let i = 0; i < 9; i++) tiles.push([(i % 3) - 1, Math.floor(i / 3) - 1]);
  const tileSet = new Set(tiles.map(([x, z]) => `${x},${z}`));
  const hasTile = (x, z) => tileSet.has(`${x},${z}`);
  const decor = []; // {type, x, z}
  const decorAt = new Set();
  const made = {}, placed = {}, firstMade = {}, unlockedAt = {}, researchedAt = {};
  const spill = {}; let spillEvents = 0, barrelsLost = 0;
  let floorsBuilt = 0, firstFloor = null;
  let caughtItems = 0, barrels = 0, netItems = 0, netBarrels = 0, casts = 0, fishCaught = 0, repairs = {};
  let hookIdle = 0, idle = 0, fullSeconds = 0;
  const dry = []; let dryStart = null, dryWhy = '';
  const stalls = []; let stallKey = null, stallStart = 0, stallGoal = null;
  let t = 0;

  const note = () => {
    prog.noteItems(bag);
    for (const id of ITEM_IDS) if (unlockedAt[id] == null && ITEMS[id].unlock.type !== 'start' && prog.isUnlocked(id)) unlockedAt[id] = t;
  };
  const gained = {}; const barrelsAt = {}; // barrelsAt[goal] = barrels opened when the goal finished
  const markMade = (k, n) => { made[k] = (made[k] || 0) + n; firstMade[k] ??= t; };

  // ---- world: floating items, same rules as game.js makeItem / updateItems
  let tok = 0;
  const bounds = () => {
    let minZ = Infinity, maxZ = -Infinity, maxX = 0;
    for (const [x, z] of tiles) { minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); maxX = Math.max(maxX, Math.abs(x)); }
    return { minZ, maxZ, maxX };
  };
  let B = bounds();
  const makeItem = () => {
    const edge = B.minZ * 2 - 1, spread = Math.max(11, B.maxX * 2 + 6);
    return { tok: ++tok, type: G.SPAWN_TABLE[Math.floor(rand() * G.SPAWN_TABLE.length)],
      x: (rand() - 0.5) * spread * 2, z: edge - 3 - rand() * 17, phase: rand() * 6, held: false };
  };
  const items = [];
  for (let i = 0; i < G.ITEM_COUNT; i++) items.push(makeItem());
  const respawn = (it) => Object.assign(it, makeItem());

  const lootOf = (type) => (type === 'barrel' ? rollBarrel(rand) : G.LOOT[type]);
  // atomic collect exactly as game.js: everything fits or nothing changes
  const collect = (it, viaNet) => {
    const loot = lootOf(it.type);
    const scratch = new Bag(bag.snapshot());
    for (const [k, n] of Object.entries(loot)) {
      if (scratch.add(k, n) > 0) {
        if (!viaNet) { spillEvents++; for (const [k2, n2] of Object.entries(loot)) spill[k2] = (spill[k2] || 0) + n2; if (it.type === 'barrel') barrelsLost++; }
        it.held = false;
        return false;
      }
    }
    for (let i = 0; i < bag.slots.length; i++) bag.slots[i] = scratch.slots[i];
    for (const [k, n] of Object.entries(loot)) gained[k] = (gained[k] || 0) + n;
    if (it.type === 'barrel') { if (viaNet) netBarrels++; else barrels++; }
    if (viaNet) netItems++; else caughtItems++;
    respawn(it);
    note();
    return true;
  };
  const freeSlots = () => bag.slots.filter((s) => !s).length;
  const fits = (loot) => { const s = new Bag(bag.snapshot()); return Object.entries(loot).every(([k, n]) => s.add(k, n) === 0); };

  // ---- tools
  const toolSlot = (kind) => bag.slots.find((s) => s && s.kind === kind) || null;
  const wear = (kind) => { const s = toolSlot(kind); if (s) s.durability = Math.max(0, s.durability - wearPerUse(kind)); };
  const tryRepair = (kind, below) => {
    const s = toolSlot(kind); const cost = repairCost(kind);
    if (!s || !cost || s.durability > below) return false;
    if (!Object.entries(cost).every(([k, n]) => bag.count(k) >= n)) return false;
    for (const [k, n] of Object.entries(cost)) bag.remove(k, n);
    s.durability = 100; repairs[kind] = (repairs[kind] || 0) + 1;
    return true;
  };

  // ---- planning: expand a requirement into raw needs, given availability
  const stationPending = () => {
    const p = {};
    for (const st of Object.values(stations)) {
      if (st.output) p[st.output.kind] = (p[st.output.kind] || 0) + st.output.count;
      if (st.input) { const r = st.recipeFor(st.input.kind); if (r) p[r.kind] = (p[r.kind] || 0) + Math.floor(st.input.count / r.in) * r.count; }
    }
    return p;
  };
  function expand(kind, n, ctx) {
    const take = Math.min(ctx.avail[kind] || 0, n);
    if (take > 0) { ctx.avail[kind] -= take; ctx.took[kind] = (ctx.took[kind] || 0) + take; n -= take; }
    if (n <= 0) return;
    const pend = Math.min(ctx.pending[kind] || 0, n);
    if (pend > 0) { ctx.pending[kind] -= pend; ctx.wait = true; n -= pend; }
    if (n <= 0) return;
    const it = ITEMS[kind];
    if (!it.recipe) { ctx.raw[kind] = (ctx.raw[kind] || 0) + n; return; }
    if (!prog.isUnlocked(kind)) {
      ctx.locked = true;
      for (const m of prog.missingFor(kind)) {
        if (m.type === 'station') { if (!placed[m.kind]) ctx.needStation[m.kind] = true; }
        else if (m.type === 'research' && !placed.researchtable) ctx.needStation.researchtable = true;
        if (m.type !== 'station' && bag.count(m.kind) === 0 && !ctx.seen.has(m.kind)) { ctx.seen.add(m.kind); expand(m.kind, 1, ctx); }
      }
    }
    const r = it.recipe;
    if (r.station) {
      if (!placed[r.station]) ctx.needStation[r.station] = true;
      ctx.stationNeed[kind] = (ctx.stationNeed[kind] || 0) + n;
      ctx.fuel += r.fuel * n;
      const [input] = Object.keys(r.cost);
      expand(input, Math.ceil(n / r.count) * r.cost[input], ctx);
      return;
    }
    const crafts = Math.ceil(n / r.count);
    for (const [k, c] of Object.entries(r.cost)) expand(k, c * crafts, ctx);
  }
  const goalDone = (g) => {
    if (g.floors) return floorsBuilt >= g.floors;
    if (g.make) return Object.entries(g.make).every(([k, n]) => (made[k] || 0) >= n);
    return Object.entries(g.place).every(([k, n]) => (placed[k] || 0) >= n);
  };
  const goalNeeds = (g) => {
    const need = {};
    if (g.floors) {
      const left = g.floors - floorsBuilt;
      for (const [k, n] of Object.entries(G.FLOOR_COST)) need[k] = n * left;
      if (!bag.count('hammer')) need.hammer = 1;
    } else if (g.make) {
      for (const [k, n] of Object.entries(g.make)) need[k] = n - (made[k] || 0);
    } else {
      for (const [k, n] of Object.entries(g.place)) {
        const inBag = bag.count(k);
        need[k] = n - (placed[k] || 0); // bag copies are taken from avail by expand
        void inBag;
      }
    }
    return need;
  };
  // Plan every open goal in order; earlier goals reserve what they use.
  function plan() {
    const counts = bag.counts();
    const avail = { ...counts };
    const pending = stationPending();
    const out = [];
    const stationNeed = {}; let fuel = 0;
    for (const g of GOALS) {
      if (goalDone(g)) continue;
      const ctx = { avail, pending, took: {}, raw: {}, stationNeed: {}, needStation: {}, locked: false, wait: false, fuel: 0, seen: new Set() };
      for (const [k, n] of Object.entries(goalNeeds(g))) if (n > 0) expand(k, n, ctx);
      // made-goals for station products count as "waiting" while the station works
      const ready = !Object.keys(ctx.raw).length && !ctx.locked && !Object.keys(ctx.stationNeed).length && !ctx.wait && !Object.keys(ctx.needStation).length;
      out.push({ g, ctx, ready });
      if (!g.late) { for (const [k, n] of Object.entries(ctx.stationNeed)) stationNeed[k] = (stationNeed[k] || 0) + n; fuel += ctx.fuel; }
    }
    const reserved = {};
    for (const k of Object.keys(counts)) reserved[k] = counts[k] - (avail[k] || 0);
    return { list: out, stationNeed, fuel, reserved, counts };
  }

  // craft `n` of kind into the bag, crafting sub-parts first (only called when plan says ready)
  let busy = 0;
  function makeHand(kind, n) {
    const r = ITEMS[kind].recipe;
    while (bag.count(kind) < n) {
      if (!r || r.station) return false;
      for (const [k, c] of Object.entries(r.cost)) if (bag.count(k) < c && !makeHand(k, c)) return false;
      const res = craft(bag, kind, prog);
      if (!res.ok) return false;
      busy += T.craft; markMade(kind, res.crafted.count); note();
    }
    return true;
  }
  // tile for a placeable: nets on the front row, everything else as far back as possible
  function freeTile(kind) {
    const free = tiles.filter(([x, z]) => !decorAt.has(`${x},${z}`) && !(x === 0 && z === B.minZ));
    if (!free.length) return null;
    free.sort(kind === 'net' ? (a, b) => a[1] - b[1] || Math.abs(a[0]) - Math.abs(b[0]) : (a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]));
    return free[0];
  }
  function place(kind) {
    const tile = freeTile(kind);
    if (!tile) return false;
    if (!bag.remove(kind, 1)) return false;
    decor.push({ type: kind, x: tile[0], z: tile[1] }); decorAt.add(`${tile[0]},${tile[1]}`);
    placed[kind] = (placed[kind] || 0) + 1;
    if (isStationKind(kind)) {
      for (const id of prog.notePlaced(kind)) unlockedAt[id] ??= t;
      if (kind !== 'researchtable') stations[kind] = new StationModel(kind);
    }
    busy += T.place;
    return true;
  }
  // grow the raft one tile: ring order around the centre, must touch an existing tile
  function buildFloor() {
    const hs = toolSlot('hammer');
    if (!hs || hs.durability <= 0) return false;
    if (!Object.entries(G.FLOOR_COST).every(([k, n]) => bag.count(k) >= n)) return false;
    let best = null, bd = Infinity;
    for (const [x, z] of tiles) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (hasTile(nx, nz)) continue;
      const d = Math.max(Math.abs(nx), Math.abs(nz)) * 10 + Math.hypot(nx, nz) + (nz > 0 ? 0.1 : 0);
      if (d < bd) { bd = d; best = [nx, nz]; }
    }
    if (!best) return false;
    for (const [k, n] of Object.entries(G.FLOOR_COST)) bag.remove(k, n);
    tiles.push(best); tileSet.add(`${best[0]},${best[1]}`); B = bounds();
    wear('hammer'); floorsBuilt++; firstFloor ??= t; busy += T.floor;
    return true;
  }
  // feed a station: inputs the plan asks for, fuel from leaves/seaweed first, then spare wood
  function tendStation(id, P) {
    const st = stations[id]; if (!st) return false;
    let acted = false;
    if (st.output) {
      const o = st.output; const left = bag.add(o.kind, o.count);
      if (left < o.count) { st.output = left > 0 ? { kind: o.kind, count: left } : null; markMade(o.kind, o.count - left); acted = true; note(); }
    }
    for (const [prod, need] of Object.entries(P.stationNeed)) {
      const r = ITEMS[prod].recipe; if (r.station !== id) continue;
      const [input] = Object.keys(r.cost);
      const pend = stationPending()[prod] || 0;
      const want = Math.min(bag.count(input), need - pend);
      if (want > 0 && st.accepts(input)) { const n = st.insert(input, want); if (n) { bag.remove(input, n); acted = true; } }
    }
    // spare fish -> grilled fish (cosy) when the grill is otherwise idle
    if (id === 'grill' && !st.input && bag.count('fish') > 1) { const n = st.insert('fish', bag.count('fish') - 1); if (n) { bag.remove('fish', n); acted = true; } }
    if (st.input) {
      const r = st.recipe;
      const needFuel = r.fuel * st.input.count - st.fuelUnits;
      if (needFuel > 0) {
        for (const f of ['seaweed', 'leaf', 'wood']) {
          let spare = bag.count(f) - (P.reserved[f] || 0);
          if (f === 'wood' && spare <= 0 && st.fuelUnits <= 0 && bag.count('leaf') + bag.count('seaweed') === 0) spare = bag.count('wood');
          const want = Math.min(spare, Math.ceil((r.fuel * st.input.count - st.fuelUnits) / fuelValue(f)));
          if (want > 0) { const n = st.addFuel(f, want); if (n) { bag.remove(f, n); acted = true; } }
          if (st.fuelUnits >= r.fuel * st.input.count - 1e-9) break;
        }
      }
    }
    if (acted) busy += T.station;
    return acted;
  }

  // ---- one decision when the player is free; returns true if it did management work
  let lastFish = -1e9;
  function manage() {
    busy = 0;
    // repairs first (cheap)
    for (const k of ['hook', 'metalhook']) if (tryRepair(k, 20)) busy += T.repair;
    if (tryRepair('hammer', 5)) busy += T.repair;
    if (tryRepair('fishingrod', 5)) busy += T.repair;
    // research anything researchable we hold
    if (placed.researchtable) {
      for (const k of prog.researchable()) {
        if (bag.count(k) > 0 && prog.research(k, { has: bag }).ok) {
          researchedAt[k] = t; busy += T.research;
          for (const id of prog.available()) unlockedAt[id] ??= t;
        }
      }
    }
    let P = plan();
    for (const id of Object.keys(stations)) tendStation(id, P);
    // goals: the first one, plus look-ahead to later ready goals unless --strict
    P = plan();
    for (const { g, ready } of P.list) {
      if (ready) {
        let ok = true;
        if (g.floors) { while (floorsBuilt < g.floors && buildFloor()); }
        else if (g.make) { for (const [k, n] of Object.entries(g.make)) ok = makeHand(k, bag.count(k) + n - (made[k] || 0)) && ok; }
        else for (const [k, n] of Object.entries(g.place)) {
          while ((placed[k] || 0) < n) {
            if (!bag.count(k) && !makeHand(k, 1)) { ok = false; break; }
            if (!place(k)) { if (!buildFloor()) { ok = false; break; } }
          }
        }
        if (ok) break; // one goal per decision keeps the reservation fresh
      }
      if (OPT.strict) break;
      if (g.late && !goalDone(GOALS.find((x) => x.key === 'binoculars'))) break;
    }
    // surplus sinks: floors with spare wood+plastic, leaves -> rope stock, scrap -> nail stock
    P = plan();
    const spare = (k) => bag.count(k) - (P.reserved[k] || 0);
    const tight = freeSlots() <= 3;
    let floors = 0;
    while (floors < 3 && spare('wood') >= G.FLOOR_COST.wood + (tight ? 0 : 4) && spare('plastic') >= G.FLOOR_COST.plastic && tiles.length < 400 && buildFloor()) floors++;
    if (spare('leaf') >= (tight ? 2 : 8) && bag.count('rope') < (tight ? 40 : 12)) { const res = craft(bag, 'rope', prog); if (res.ok) { busy += T.craft; markMade('rope', 1); } }
    if (prog.isUnlocked('nail') && spare('scrap') >= 8 && bag.count('nail') < 12) { const res = craft(bag, 'nail', prog); if (res.ok) { busy += T.craft; markMade('nail', 3); } }
    if (tight) { // burn spare leaves / seaweed in any station with fuel room
      for (const st of Object.values(stations)) for (const f of ['leaf', 'seaweed']) {
        const n = st.addFuel(f, Math.max(0, spare(f))); if (n) { bag.remove(f, n); busy += 1; }
      }
    }
    note();
    return { P, busy };
  }

  // ---- hook / fish cycles
  let cycle = null; // {end, items:[], kind:'hook'|'fish'}
  const player = () => ({ x: 0, z: B.minZ * 2 });
  function startHook() {
    const hk = TOOL_HOOKS.map(toolSlot).find(Boolean);
    if (!hk) return false;
    const range = 16 + hk.durability * 0.16;
    const p = player();
    let best = null, bd = Infinity;
    const free = freeSlots();
    for (const it of items) {
      if (it.held) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d > range || d < 1.5) continue;
      if (!OPT.nearestOnly) { // a sensible player skips what cannot fit or is already plentiful
        if (it.type === 'barrel' ? free === 0 : (!fits(G.LOOT[it.type]) || bag.count(it.type) >= OPT.plenty)) continue;
      }
      if (d < bd) { bd = d; best = it; }
    }
    if (!best) return false;
    const d = bd;
    const v = Math.sqrt(G.GRAVITY * d);
    const charge = clamp((v - G.BASE_SPEED) / G.CHARGE_SPEED, G.MIN_CHARGE, 1);
    const speed = G.BASE_SPEED + charge * G.CHARGE_SPEED;
    const tFlight = (2 * speed * Math.SQRT1_2) / G.GRAVITY;
    const tReel = d / G.REEL_SPEED + 0.5;
    const pHit = clamp(0.95 - 0.012 * d, 0.35, 0.95) ** (1 / skill);
    const hit = rand() < pHit;
    const caught = [];
    if (hit) caught.push(best);
    // reel sweep: anything within CATCH_RADIUS of the line hook -> hand comes along
    const ax = best.x, az = best.z, bx = p.x, bz = p.z, l2 = (bx - ax) ** 2 + (bz - az) ** 2;
    for (const it of items) {
      if (it === best || it.held || caught.length >= G.MAX_CAUGHT) continue;
      const u = clamp(((it.x - ax) * (bx - ax) + (it.z - az) * (bz - az)) / l2, 0, 1);
      if (Math.hypot(ax + (bx - ax) * u - it.x, az + (bz - az) * u - it.z) < G.CATCH_RADIUS) caught.push(it);
    }
    for (const it of caught) it.held = true;
    casts++;
    cycle = { kind: 'hook', end: t + 1.0 + charge * G.CHARGE_MS / 1000 + tFlight + tReel + H, items: caught, tool: hk.kind };
    return true;
  }
  function startFish() {
    const rod = toolSlot('fishingrod');
    if (!rod || rod.durability <= 0) return false;
    cycle = { kind: 'fish', end: t + 2 + G.FISH_WAIT_MIN + rand() * G.FISH_WAIT_RANGE + G.FISH_REEL + H / 2, items: [] };
    lastFish = t;
    return true;
  }
  function finishCycle() {
    if (cycle.kind === 'fish') {
      if (bag.add('fish', 1) === 0) { fishCaught++; wear('fishingrod'); note(); }
      else { spillEvents++; spill.fish = (spill.fish || 0) + 1; }
    } else {
      let any = false;
      for (const it of cycle.items) if (collect(it, false)) any = true;
      if (any) wear(cycle.tool);
    }
    cycle = null;
  }

  // ---- main loop
  const END = OPT.minutes * 60;
  let netAcc = 0, freeAt = 0, lastPlan = null, fullAt = null; const early = {};
  for (t = 0; t < END; t++) {
    // world drift (1 s)
    for (const it of items) {
      if (it.held) continue;
      it.z += G.DRIFT; it.x += Math.sin(t * 0.13 + it.phase) * 0.04;
      const end = B.maxZ * 2 + 24, side = B.maxX * 2 + 24;
      if (it.z > end || Math.abs(it.x) > side || hasTile(Math.round(it.x / 2), Math.round(it.z / 2))) respawn(it);
    }
    // nets
    netAcc += 1;
    while (netAcc > G.NET_CLOCK) {
      netAcc -= G.NET_CLOCK;
      for (const n of decor) {
        if (n.type !== 'net') continue;
        const it = items.find((i) => !i.held && Math.hypot(i.x - n.x * 2, i.z - n.z * 2) < G.NET_RADIUS);
        if (it) collect(it, true);
      }
    }
    for (const st of Object.values(stations)) for (const ev of st.tick(1)) if (ev.type === 'done') { firstMade[ev.kind] ??= t + 1; }
    if (cycle && t >= cycle.end) finishCycle();
    if (!cycle && t >= freeAt) {
      const { P, busy: b } = manage();
      lastPlan = P;
      if (b > 0) freeAt = t + b;
      else {
        const wantFish = toolSlot('fishingrod') && (
          (bag.count('fish') === 0 && !made.cookedfish && t - lastFish > 20) ||
          (bag.count('fish') + bag.count('cookedfish') < 3 && t - lastFish > 240));
        if (!(wantFish && startFish()) && !startHook()) hookIdle++;
      }
    }
    if (freeSlots() === 0) fullSeconds++;
    for (const g of GOALS) if (barrelsAt[g.key] == null && goalDone(g)) barrelsAt[g.key] = barrels + netBarrels;
    if (t === 30 * 60 - 1) { early.items = caughtItems; early.barrels = barrels + netBarrels; }
    if (fullAt == null && freeSlots() === 0) fullAt = t;
    if (process.env.SIM_TRACE && t % Number(process.env.SIM_TRACE) === 0) console.log(`t=${t / 60}m barrels=${barrels}+${netBarrels} free=${freeSlots()} tiles=${tiles.length} gained=${JSON.stringify(gained)} goal=${lastPlan?.list.find((x) => !goalDone(x.g))?.g.key}`);
    // stall tracking on the first open goal
    const P = lastPlan;
    if (P) {
      const first = P.list.find((x) => !goalDone(x.g));
      const raw = first ? Object.keys(first.ctx.raw).sort() : [];
      const open = P.list.filter((x) => !x.g.late);
      const isIdle = open.length && open.every((x) => !x.ready && Object.keys(x.ctx.raw).length);
      if (isIdle) { idle++; if (dryStart == null) { dryStart = t; dryWhy = Object.keys(first.ctx.raw).sort().join('+') + `(${first.g.key})`; } }
      else if (dryStart != null) { if (t - dryStart >= 300) dry.push({ why: dryWhy, from: dryStart / 60, min: (t - dryStart) / 60 }); dryStart = null; }
      const key = raw.length === 1 ? raw[0] : null;
      if (key !== stallKey) {
  if (stallKey && t - stallStart >= 300) stalls.push({ kind: stallKey, goal: stallGoal, from: stallStart / 60, min: (t - stallStart) / 60 });
        stallKey = key; stallStart = t; stallGoal = first?.g.key;
      }
    }
  }
  if (dryStart != null && t - dryStart >= 300) dry.push({ why: dryWhy, from: dryStart / 60, min: (t - dryStart) / 60 });
  if (stallKey && t - stallStart >= 300) stalls.push({ kind: stallKey, goal: stallGoal, from: stallStart / 60, min: (t - stallStart) / 60 });

  const minutes = (s) => (s === undefined || s === null ? null : s / 60);
  const fm = {}; for (const k of Object.keys(firstMade)) fm[k] = minutes(firstMade[k]);
  const ul = {}; for (const k of Object.keys(unlockedAt)) ul[k] = minutes(unlockedAt[k]);
  const hookedMin = OPT.minutes;
  return {
    seed, firstMade: fm, barrelsAt, gained, unlocked: ul, firstFloor: minutes(firstFloor), placed,
    goalsDone: GOALS.filter(goalDone).map((g) => g.key),
    inventory: Object.fromEntries(Object.entries(bag.counts()).filter(([, n]) => n > 0)),
    slotsUsed: 28 - freeSlots(), tiles: tiles.length, spill, spillEvents, barrelsLost, fullMin: fullSeconds / 60,
    idleMin: idle / 60, dry, dryMaxMin: dry.reduce((m, d) => Math.max(m, d.min), 0), hookIdleMin: hookIdle / 60, stalls, repairs, fishCaught,
    firstFullMin: minutes(fullAt),
    rates: { early30ItemsPerMin: early.items / 30, early30BarrelsPerMin: early.barrels / 30, hookedPerMin: caughtItems / hookedMin, castsPerMin: casts / hookedMin, barrelsHooked: barrels, barrelsNet: netBarrels, netItems, barrelsPerMin: (barrels + netBarrels) / hookedMin },
  };
}

// ---------------------------------------------------------------- reporting
const planRows = PROGRESSION_PLAN.map((p) => ({ minute: p.minute, goal: p.goal, ids: p.ids }));
function milestone(run, row) {
  if (row.goal.startsWith('Research clay')) return run.unlocked.smelter ?? null;
  if (/floor/.test(row.goal) && row.ids.includes('hammer')) {
    const a = run.firstMade.hammer, b = run.firstFloor;
    return a == null || b == null ? null : Math.max(a, b);
  }
  if (!row.ids.length) return null;
  const vals = row.ids.map((id) => (ITEMS[id]?.placeable ? (run.placed[id] ? run.firstMade[id] : null) : run.firstMade[id]));
  if (row.ids.includes('hook')) return 0;
  return vals.some((v) => v == null) ? null : Math.max(...vals);
}
const q = (arr, p) => {
  const a = arr.map((v) => (v == null ? Infinity : v)).sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))] : null;
};
const f1 = (v) => (v == null ? '-' : v === Infinity ? 'never' : v.toFixed(1));

const runs = [];
for (let i = 0; i < OPT.runs; i++) runs.push(simulate(OPT.seed + i));

const table = planRows.map((row) => {
  const v = runs.map((r) => milestone(r, row));
  return { target: row.minute, goal: row.goal, p10: q(v, 0.1), median: q(v, 0.5), p90: q(v, 0.9), missed: v.filter((x) => x == null).length };
});

if (OPT.json) {
  console.log(JSON.stringify({ opt: OPT, bagShim: BAG_SHIM, table, runs: OPT.runs === 1 ? runs : undefined }, null, 1));
  process.exit(0);
}

console.log(`Little Raft progression sim: ${OPT.runs} run(s) from seed ${OPT.seed}, skill ${OPT.skill}, ${OPT.minutes} min, dist=${OPT.dist}${OPT.strict ? ', strict order' : ''}`);
if (BAG_SHIM) console.log('NOTE: dist Bag does not know the new item kinds; using the same Bag code with ITEM_INFO from items.js infoTable().');
console.log('\nMilestone (PROGRESSION_PLAN)                              target   p10  median   p90  missed');
for (const r of table) console.log(`${r.goal.padEnd(56).slice(0, 56)} ${String(r.target).padStart(5)} ${f1(r.p10).padStart(6)} ${f1(r.median).padStart(6)} ${f1(r.p90).padStart(6)} ${String(r.missed).padStart(6)}`);

const med = (fn) => q(runs.map(fn), 0.5);
const p90 = (fn) => q(runs.map(fn), 0.9);
console.log('\nItem first-unlock / first-make (median min):');
const rows = ITEM_IDS.filter((id) => ITEMS[id].recipe).map((id) => `${id}: unlock ${f1(med((r) => (ITEMS[id].unlock.type === 'start' ? 0 : r.unlocked[id])))} make ${f1(med((r) => r.firstMade[id]))}`);
for (let i = 0; i < rows.length; i += 3) console.log('  ' + rows.slice(i, i + 3).map((s) => s.padEnd(40)).join(''));

console.log('\nBarrels opened (hook+net) when goal done, median: ' + ['net', 'brick', 'smelter', 'metalingot', 'metalhook', 'copperingot', 'binoculars'].map((k) => `${k} ${f1(med((r) => r.barrelsAt[k]))}`).join(', '));
const rt = (k) => f1(med((r) => r.rates[k]));
console.log(`\nIncome: hooked items/min ${rt('hookedPerMin')}, casts/min ${rt('castsPerMin')}, barrels/min (hook+net) ${rt('barrelsPerMin')}, net items (median) ${f1(med((r) => r.rates.netItems))}, fish ${f1(med((r) => r.fishCaught))}`);
console.log(`First 30 min: hooked items/min ${rt('early30ItemsPerMin')}, barrels/min ${rt('early30BarrelsPerMin')}; bag first full at min ${f1(med((r) => r.firstFullMin))} (p10 ${f1(q(runs.map((r) => r.firstFullMin), 0.1))})`);
console.log(`Raft tiles (median) ${f1(med((r) => r.tiles))}; slots used at end ${f1(med((r) => r.slotsUsed))}/28 (p90 ${f1(p90((r) => r.slotsUsed))})`);
console.log(`Bag full: median ${f1(med((r) => r.fullMin))} min (p90 ${f1(p90((r) => r.fullMin))}); rejected catches median ${f1(med((r) => r.spillEvents))} (p90 ${f1(p90((r) => r.spillEvents))}), barrels lost median ${f1(med((r) => r.barrelsLost))}`);
console.log(`Idle (every open goal waiting on raw income): median ${f1(med((r) => r.idleMin))} min (p90 ${f1(p90((r) => r.idleMin))}); no item in reach: ${f1(med((r) => r.hookIdleMin))} min`);
const dryCount = {}; let dryRuns = 0;
for (const r of runs) { if (r.dry.length) dryRuns++; for (const d of r.dry) dryCount[d.why] = (dryCount[d.why] || 0) + 1; }
console.log(`Dry spells >5 min (nothing craftable, only gathering): ${runs.reduce((s, r) => s + r.dry.length, 0)} in ${dryRuns}/${runs.length} runs; longest per run median ${f1(med((r) => r.dryMaxMin))} min, p90 ${f1(p90((r) => r.dryMaxMin))}; waiting on: ${Object.entries(dryCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ')}`);
const stallCount = {}; let stallRuns = 0;
for (const r of runs) { if (r.stalls.length) stallRuns++; for (const s of r.stalls) { const k = `${s.kind}(${s.goal})`; stallCount[k] = (stallCount[k] || 0) + 1; } }
console.log(`Stalls >5 min on one material: ${runs.reduce((s, r) => s + r.stalls.length, 0)} total in ${stallRuns}/${runs.length} runs; by material(goal): ${Object.entries(stallCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
const longest = runs.flatMap((r) => r.stalls.map((s) => ({ ...s, seed: r.seed }))).sort((a, b) => b.min - a.min).slice(0, 5);
if (longest.length) console.log('  longest: ' + longest.map((s) => `${s.kind}/${s.goal} ${s.min.toFixed(1)}m @${s.from.toFixed(0)} (seed ${s.seed})`).join('; '));
if (OPT.runs === 1) {
  const r = runs[0];
  console.log('\nFinal inventory:', JSON.stringify(r.inventory));
  console.log('Spill (items not collected, bag full):', JSON.stringify(r.spill));
  console.log('Placed:', JSON.stringify(r.placed), 'repairs:', JSON.stringify(r.repairs));
  console.log('Stalls:', JSON.stringify(r.stalls));
} else {
  const inv = {};
  for (const r of runs) for (const [k, n] of Object.entries(r.inventory)) (inv[k] ||= []).push(n);
  console.log('Final inventory (median count over runs holding it): ' + Object.entries(inv).map(([k, a]) => `${k} ${q(a, 0.5)}`).join(', '));
  const sp = {};
  for (const r of runs) for (const [k, n] of Object.entries(r.spill)) sp[k] = (sp[k] || 0) + n;
  console.log('Spill totals over all runs: ' + (Object.entries(sp).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'));
}
