// Paint + brush for building pieces and deck tiles (see docs/specs/paint.md).
// Whole-piece colour only. Slice: world.ext.paint = {v:1, rev, m}, m: key -> colour idx 1..5.
// Host-authoritative action {kind:'paint', k, c}. Pots are plain bag items (paint_<id>), one per paint.
// The top half of this file is pure (no DOM, no THREE) and exported for tests; THREE comes only through ctx.T.
import { PIECES } from './building-pieces.js?build=v3-survival-ae77fa84ac2b';

const pal = (id, name, hex) => Object.freeze({ id, name, hex });
export const PALETTE = Object.freeze([
  pal('driftwood', 'Driftwood', null), // scrape back to raw wood: free, needs no pot
  pal('seafoam', 'Seafoam', '#9fd3c1'),
  pal('coral', 'Coral', '#e9a08c'),
  pal('sunshell', 'Sunshell', '#f1d78d'),
  pal('lagoon', 'Lagoon', '#86b3d6'),
  pal('pebble', 'Pebble', '#c9c3b8'),
]);
export const PAINT_KINDS = Object.freeze(PALETTE.slice(1).map(p => 'paint_' + p.id));
export const MAX_ENTRIES = 1000, MAX_REV = 1e9, REACH = 7;
export const RAW_WOOD = '#c69860', PLANK_AVG = '#ba8a54', TILE_MIX = .8, TINT_CAP = 8; // cap 8 (spec said 4): blue needs ~7.5x over the plank average
export const PIECE_RE = /^(floor|wall|halfwall|window|door|pillar|stairs|roof):(-?\d{1,2}),(-?\d{1,2}),([0-5]),([0-3])$/;
export const TILE_RE = /^(-?\d{1,4}),(-?\d{1,4})$/;
const PIECE_TYPES = Object.assign(Object.create(null), { floor: 1, wall: 1, halfwall: 1, window: 1, door: 1, pillar: 1, stairs: 1, roof: 1 });
const MAX_IJ = 26;

export const pieceKeyOf = p => p.t + ':' + p.i + ',' + p.j + ',' + p.l + ',' + p.r;
export const tileKeyOf = (x, z) => x + ',' + z;

/** 'piece' | 'tile' | null for a stored key. */
export function keyType(k) {
  if (typeof k !== 'string') return null;
  const m = PIECE_RE.exec(k);
  if (m) return PIECE_TYPES[m[1]] === 1 && Math.abs(+m[2]) <= MAX_IJ && Math.abs(+m[3]) <= MAX_IJ ? 'piece' : null;
  return TILE_RE.test(k) ? 'tile' : null;
}
const isColour = c => Number.isInteger(c) && c >= 1 && c < PALETTE.length;
const blank = () => ({ v: 1, rev: 0, m: Object.create(null) });

/** Validated copy of a slice. Never throws; junk -> {v:1, rev:0, m:{}} (null-prototype map). */
export function cleanPaint(raw) {
  const out = blank();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw.rev;
  out.rev = typeof r === 'number' && Number.isFinite(r) ? Math.min(MAX_REV, Math.max(0, Math.floor(r))) : 0;
  const m = raw.m;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return out;
  let n = 0;
  for (const k of Object.keys(m)) {
    if (n >= MAX_ENTRIES) break;
    if (!keyType(k) || !isColour(m[k])) continue;
    out.m[k] = m[k]; n++;
  }
  return out;
}

/** Drop entries whose piece or tile no longer exists. Returns the removed count (caller bumps rev). */
export function prunePaint(state, pieces, tiles) {
  const live = new Set();
  if (Array.isArray(pieces)) for (const p of pieces) if (p && typeof p === 'object') live.add(pieceKeyOf(p));
  if (Array.isArray(tiles)) for (const t of tiles) if (Array.isArray(t)) live.add(tileKeyOf(t[0], t[1]));
  let n = 0;
  for (const k in state.m) if (!live.has(k)) { delete state.m[k]; n++; }
  return n;
}

/** Next colour in 1..5 order then 0 (Driftwood), skipping colours with no pots. No pots at all -> 0. */
export function nextColour(cur, counts) {
  const N = PALETTE.length;
  let c = Number.isInteger(cur) && cur >= 0 && cur < N ? cur : 0;
  for (let s = 0; s < N; s++) {
    c = (c + 1) % N;
    if (c === 0 || (counts?.['paint_' + PALETTE[c].id] ?? 0) > 0) return c;
  }
  return 0;
}

/** '#rrggbb' mix of two hex colours in sRGB, t = share of b. */
export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  let out = 0;
  for (const s of [16, 8, 0]) out |= Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t) << s;
  return '#' + out.toString(16).padStart(6, '0');
}

const bump = state => { state.rev = state.rev >= MAX_REV ? 1 : state.rev + 1; };
const exists = (k, type, world) => {
  if (type === 'tile') return Array.isArray(world?.tiles) && world.tiles.some(t => Array.isArray(t) && tileKeyOf(t[0], t[1]) === k);
  return Array.isArray(world?.pieces) && world.pieces.some(p => p && pieceKeyOf(p) === k);
};

/** Host rules for {kind:'paint', k, c}. Mutates state and charges bag on success. Returns {ok, text}. */
export function applyPaint(state, a, bag, world) {
  if (!bag || bag.count('brush') < 1) return { ok: false, text: 'Make a paint brush first' };
  const k = a?.k, type = keyType(k);
  if (!type || !exists(k, type, world)) return { ok: false, text: '' };
  const c = a.c;
  if (!Number.isInteger(c) || c < 0 || c >= PALETTE.length) return { ok: false, text: '' };
  const has = Object.hasOwn(state.m, k), name = PALETTE[c].name;
  if (has ? state.m[k] === c : c === 0) return { ok: false, text: 'Already ' + name };
  // Cap before charging, so a refused paint never eats a pot.
  if (c > 0 && !has && Object.keys(state.m).length >= MAX_ENTRIES) return { ok: false, text: 'That’s a lot of paint!' };
  if (c > 0 && !bag.remove('paint_' + PALETTE[c].id, 1)) return { ok: false, text: 'Out of ' + name + ' paint' };
  if (c === 0) delete state.m[k]; else state.m[k] = c;
  bump(state);
  return { ok: true, text: c === 0 ? 'Scraped back to raw wood' : 'Painted ' + name };
}

// ------------------------------------------------------------------ content module

export function createPaint(ctx) {
  const T = ctx.T, base = new T.Color(PLANK_AVG);
  const PIECE_TINT = PALETTE.map(p => {
    if (!p.hex) return null;
    const c = new T.Color(p.hex);
    c.setRGB(Math.min(TINT_CAP, c.r / base.r), Math.min(TINT_CAP, c.g / base.g), Math.min(TINT_CAP, c.b / base.b));
    return c;
  });
  const PREVIEW = PALETTE.map(p => new T.Color(p.hex ?? '#ffffff')); // ghost colours, so update() never parses a hex string
  let state = blank(), netRev = -1, colour = 0, tipShown = -1;
  let seenPieces = null, seenTiles = null, seenTilesN = -1, tintBuilding = null;
  let target = null, targetAim = null;
  const tgt = { key: '', name: '', rec: null };
  const woodHex = new Set();

  const tintOf = p => PIECE_TINT[state.m[pieceKeyOf(p)]] ?? null;
  const hexOf = c => PALETTE[c]?.hex ?? null;
  const swatchOf = c => hexOf(c) ?? RAW_WOOD;
  const potsOf = (bag, c) => (c > 0 ? bag.count('paint_' + PALETTE[c].id) : Infinity);
  const heldKind = () => { const b = ctx.localBag(); return b?.slots[b.selectedIndex]?.kind ?? null; };
  const holding = () => ctx.running && !ctx.uiOpen() && heldKind() === 'brush';

  // The deck is one merged mesh (deck.createRaftMesh), so painted tiles are baked in by tileTint() during
  // rebuildRaft(); here we only ask for a rebuild when the set of painted tiles changed.
  let tileSig = '';
  const tileSigOf = () => { let s = ''; for (const k in state.m) if (!k.includes(':')) s += k + '=' + state.m[k] + ';'; return s; };
  function tileTint(x, z, baseHex) {
    const c = state.m[tileKeyOf(x, z)]; if (!c || !PALETTE[c]?.hex) return null;
    const hex = mixHex(baseHex, PALETTE[c].hex, TILE_MIX); woodHex.add(hex); return hex;
  }
  function tintTiles(rebuilt) {
    const sig = tileSigOf(); if (sig === tileSig) return;
    tileSig = sig; if (!rebuilt && ctx.raft && ctx.rebuildRaft) ctx.rebuildRaft();
  }
  function applyTint(rebuilt = false) {
    const b = ctx.building;
    if (b) { if (b !== tintBuilding) { tintBuilding = b; b.setTint(tintOf); } else b.retint(); }
    tintTiles(rebuilt);
  }
  function setTip() {
    const tip = ctx.brush?.userData.tip; if (!tip) return;
    tip.material.color.set(swatchOf(colour)); tipShown = colour;
  }
  function prune() {
    const w = ctx.world;
    seenPieces = w.pieces; seenTiles = w.tiles; seenTilesN = Array.isArray(w.tiles) ? w.tiles.length : -1;
    const n = prunePaint(state, w.pieces, w.tiles);
    if (n) bump(state);
    return n;
  }

  function findTarget(aim) {
    if (!aim?.dir || !ctx.camera) return null;
    const cam = ctx.camera.position, d = aim.dir, b = ctx.building;
    const p = b?.grid.pick(cam.x, cam.y, cam.z, d.x, d.y, d.z, ctx.deckY(), REACH);
    if (p) { tgt.key = pieceKeyOf(p); tgt.name = PIECES[p.t].name.toLowerCase(); tgt.rec = p; return tgt; }
    const pt = aim.point; if (!pt || pt.distanceTo?.(cam) > REACH) return null;
    const x = Math.round(pt.x / 2), z = Math.round(pt.z / 2), tiles = ctx.world.tiles;
    let hit = false; for (const t of tiles) if (t[0] === x && t[1] === z) { hit = true; break; } // no per-frame closure
    if (!hit) return null;
    tgt.key = tileKeyOf(x, z); tgt.name = 'deck'; tgt.rec = null; return tgt;
  }
  const targetFor = aim => { if (aim !== targetAim) { targetAim = aim; target = findTarget(aim); } return target; };

  function cycle(notice) {
    colour = nextColour(colour, ctx.localBag().counts());
    setTip();
    if (notice) { const n = potsOf(ctx.localBag(), colour); ctx.notice('Brush: ' + PALETTE[colour].name + (n === Infinity ? ' (free, back to raw wood)' : ' (' + n + ' left)')); }
  }

  // The visible key prompt is prompts.js (#contextPrompt is hidden by prompts.css), so also feed it plain text.
  let unprovide = null;
  const label = () => { const n = potsOf(ctx.localBag(), colour); return PALETTE[colour].name + (n === Infinity ? '' : ' (' + n + ')'); };
  function provide() {
    const P = globalThis.raftPrompts; if (unprovide || typeof P?.provide !== 'function') return;
    unprovide = P.provide({ id: 'paint', priority: 1, prompt: pc => {
      if (!holding()) return null;
      const s = pc?.hud || pc?.state; // hud: cheap live view with these keys. Yield to the built-in pickup / waiting prompts (priority 0), which this provider would otherwise hide
      if (s?.pickup || (s?.role === 'guest' && !s.networkReady)) return null;
      return target ? [{ key: 'LMB', label: 'Paint ' + target.name + ' · ' + label() }, { key: 'RMB', label: 'Colour', muted: true }]
        : [{ label: 'Brush: ' + label(), muted: true }, { key: 'RMB', label: 'Colour', muted: true }];
    } });
  }

  const mod = {
    name: 'paint',
    serialize: () => state,
    load(d, from) {
      if (from === 'net') {
        const r = d && typeof d === 'object' && Number.isInteger(d.rev) ? d.rev : 0;
        if (r === netRev) return;
        state = cleanPaint(d); netRev = r; applyTint();
        return;
      }
      state = cleanPaint(d);
      if (ctx.role !== 'guest') prune();
      netRev = -1; applyTint();
    },
    update() {
      const w = ctx.world;
      if (ctx.role !== 'guest' && (w.pieces !== seenPieces || w.tiles !== seenTiles || (Array.isArray(w.tiles) && w.tiles.length !== seenTilesN))) {
        if (prune()) applyTint();
      }
      if (tipShown !== colour) setTip();
      if (!unprovide) provide();
      if (!holding()) { targetAim = null; target = null; return; }
      const t = targetFor(ctx.aim?.() ?? null);
      if (t?.rec && ctx.building) ctx.building.preview(t.rec, PREVIEW[colour]);
    },
    afterRebuild() { applyTint(true); },
    tileTint,
    action(a, actor, bag) {
      if (a?.kind !== 'paint') return false;
      const r = applyPaint(state, a, bag, ctx.world);
      if (r.ok) applyTint();
      if (r.text) ctx.emit({ kind: 'notice', text: r.text }, actor);
      return true;
    },
    use(aim, kind) {
      if (kind !== 'brush') return false;
      if (potsOf(ctx.localBag(), colour) < 1) {
        const was = PALETTE[colour].name; cycle(false);
        ctx.notice('Out of ' + was + ' paint · brush now ' + PALETTE[colour].name);
        return true;
      }
      const t = findTarget(aim); targetAim = null;
      if (t) ctx.action({ kind: 'paint', k: t.key, c: colour });
      else ctx.notice('Point the brush at a wall, floor or deck');
      return true;
    },
    alt(aim, kind) {
      if (kind !== 'brush') return false;
      cycle(true);
      return true;
    },
    prompt(aim) {
      if (!holding()) return null;
      const n = potsOf(ctx.localBag(), colour), name = ctx.esc(PALETTE[colour].name), count = n === Infinity ? 'free' : String(n);
      const sw = `<span class="swatch" style="display:inline-block;width:.8em;height:.8em;border-radius:50%;vertical-align:-.08em;margin:0 .3em;border:1px solid rgba(0,0,0,.35);background:${swatchOf(colour)}"></span>`;
      const t = targetFor(aim);
      if (t) return `<kbd>Click</kbd> Paint ${ctx.esc(t.name)} ${sw}${name} (${count}) · <kbd>Right click</kbd> Colour`;
      return `Brush: ${sw}${name} (${count}) · <kbd>Right click</kbd> Colour`;
    },
    dispose() { try { unprovide?.(); } catch {} unprovide = null; },
    debug: {
      state: () => ({ v: state.v, rev: state.rev, m: { ...state.m } }),
      get colour() { return colour; },
      setColour(i) { if (Number.isInteger(i) && i >= 0 && i < PALETTE.length) { colour = i; setTip(); } return colour; },
      tint: key => hexOf(state.m[key]),
      materials: () => woodHex.size,
      grant() {
        if (ctx.role === 'guest') return false;
        const b = ctx.localBag(); b.add('brush', 1); for (const k of PAINT_KINDS) b.add(k, 4); return true;
      },
      paint(key, c) {
        if (ctx.role === 'guest') return false;
        const r = applyPaint(state, { kind: 'paint', k: key, c }, ctx.localBag(), ctx.world);
        if (r.ok) applyTint();
        return r.ok;
      },
      demo() {
        if (ctx.role === 'guest' || !ctx.building) return null;
        const w = ctx.world;
        w.pieces = [
          { t: 'wall', i: 0, j: 0, l: 0, r: 0 }, { t: 'wall', i: 0, j: 1, l: 0, r: 0 }, { t: 'wall', i: 0, j: 0, l: 0, r: 1 }, { t: 'wall', i: 1, j: 0, l: 0, r: 1 },
          { t: 'pillar', i: 0, j: 0, l: 0, r: 0 }, { t: 'pillar', i: 1, j: 0, l: 0, r: 0 }, { t: 'pillar', i: 0, j: 1, l: 0, r: 0 }, { t: 'pillar', i: 1, j: 1, l: 0, r: 0 },
          { t: 'floor', i: 0, j: 0, l: 1, r: 0 }, { t: 'roof', i: 1, j: 0, l: 1, r: 1 },
        ];
        ctx.building.sync(w);
        const keys = [];
        w.pieces.forEach((p, n) => { const k = pieceKeyOf(p); state.m[k] = 1 + n % 5; keys.push(k); });
        w.tiles.filter(t => t[0] !== 0 || t[1] !== 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5).forEach((t, n) => { const k = tileKeyOf(t[0], t[1]); state.m[k] = 1 + n; keys.push(k); });
        prune(); bump(state); applyTint();
        return keys;
      },
      dropPiece(key) {
        if (ctx.role === 'guest' || !ctx.building) return false;
        const w = ctx.world, before = w.pieces.length;
        w.pieces = w.pieces.filter(p => pieceKeyOf(p) !== key);
        ctx.building.sync(w);
        return w.pieces.length < before;
      },
    },
  };
  return mod;
}
