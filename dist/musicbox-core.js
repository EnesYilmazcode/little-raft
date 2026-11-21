// [musicbox] Pure half of the wind-up Music Box (docs/specs/musicbox.md §3, §6). No DOM, no THREE, no Date, no Math.random.
// Tunes are composed from fixed seeds with mulberry32 (integer math, identical on every engine), so host and guest compute
// the same notes; the bar position comes from the shared daynight clock. The slice helpers validate world.ext.musicbox.

export const TUNE_COUNT = 5, HEAR_FULL = 1.5, HEAR_MAX = 14, SWITCH_HYST = 1, LOOKAHEAD = 0.15, DRIFT_MAX = 0.12, JUMP_MAX = 0.25, BOX_CAP = 16;
export const SCALES = Object.freeze({ pent: Object.freeze([0, 2, 4, 7, 9]), major: Object.freeze([0, 2, 4, 5, 7, 9, 11]) });
export const TUNES = Object.freeze([ // seeds are fixed forever; changing one changes a saved box's tune
  { name: 'Driftwood Lullaby', seed: 0x5eed0001, scale: 'pent',  root: 62, bpm: 84,  bars: 8,  meter: 6 }, // D, 3/4 waltz
  { name: 'Lantern Tide',      seed: 0x5eed0002, scale: 'pent',  root: 65, bpm: 96,  bars: 12, meter: 8 }, // F
  { name: "Gull's Nap",        seed: 0x5eed0003, scale: 'major', root: 67, bpm: 88,  bars: 12, meter: 8 }, // G (12 bars: 16 at 88 bpm is a 43.6 s loop, over the 40 s cap)
  { name: 'Sunwarm Planks',    seed: 0x5eed0004, scale: 'pent',  root: 64, bpm: 108, bars: 16, meter: 8 }, // E
  { name: 'Shell Song',        seed: 0x5eed0005, scale: 'major', root: 63, bpm: 100, bars: 12, meter: 6 }, // Eb, 3/4
].map(Object.freeze));

const PROGS = [[0, 7, 9, 5], [0, 5, 0, 7], [0, 9, 5, 7], [0, 5, 7, 0]];
const IDX_MAX = 9;                                          // octave-extended scale-degree index range 0..9
const STEPS = [-3, -2, -1, 0, 1, 2, 3], WEIGHTS = [0.05, 0.15, 0.3, 0.05, 0.3, 0.15, 0.05];
const W_SUM = WEIGHTS.reduce((a, b) => a + b, 0);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midiHz = m => 440 * 2 ** ((m - 69) / 12);
const round2 = v => Math.round(v * 100) / 100;
const mod = (a, n) => ((a % n) + n) % n;

// ------------------------------------------------------------------ composer
function composeTune(def) {
  const rng = mulberry32(def.seed), scale = SCALES[def.scale], ns = scale.length;
  const { root, bars, meter } = def, step = 60 / def.bpm / 2, bar = meter * step, mid = meter === 8 ? 4 : 3;
  const semi = i => 12 * Math.floor(i / ns) + scale[i % ns];          // index -> semitones above root
  const prog = PROGS[Math.floor(rng() * PROGS.length)];
  const chordOf = b => (b === bars - 1 ? 0 : prog[b % 4]);
  const chordHas = (c, pc) => { const third = c === 9 ? 3 : 4; return pc === c % 12 || pc === (c + third) % 12 || pc === (c + 7) % 12; };
  const tonics = []; for (let i = 0; i <= IDX_MAX; i++) if (semi(i) % 12 === 0) tonics.push(i);
  const reflect = i => (i < 0 ? -i : i > IDX_MAX ? 2 * IDX_MAX - i : i);
  const walkStep = () => { let r = rng() * W_SUM; for (let k = 0; k < STEPS.length; k++) { r -= WEIGHTS[k]; if (r < 0) return STEPS[k]; } return 0; };
  const nearest = (i, ok) => { let best = i, bd = Infinity; for (let j = 0; j <= IDX_MAX; j++) if (ok(j)) { const d = Math.abs(j - i); if (d < bd) { bd = d; best = j; } } return best; };
  const toTonic = i => nearest(i, j => tonics.includes(j));
  const rhythm = holdP => { // -> array of sounding step offsets within a bar
    const out = []; let hold = false;
    for (let s = 0; s < meter; s++) {
      const p = s === 0 ? 1 : s % 2 === 0 ? 0.7 : 0.4, r = rng(), h = rng(); // two draws per step, always, in a fixed order
      if (hold && s !== 0) { hold = false; continue; }
      hold = false;
      if (s === 0 || r < p) { out.push(s); hold = h < holdP; }
    }
    return out;
  };
  // one bar of a walk starting from idx; returns {cells:[{s, i}], idx}
  const walkBar = (b, idx, holdP, endTonic, fixFirst = false) => {
    const steps = rhythm(holdP), cells = [];
    for (const s of steps) { if (!(fixFirst && s === 0)) idx = reflect(idx + walkStep()); cells.push({ s, i: idx }); }
    const last = cells[cells.length - 1];
    last.i = endTonic ? toTonic(last.i) : nearest(last.i, j => chordHas(chordOf(b), semi(j) % 12));
    return { cells, idx: last.i };
  };
  const phrase = (b0, start, holdP) => { const out = []; let idx = start; for (let k = 0; k < 4; k++) { const r = walkBar(b0 + k, idx, holdP, false, k === 0); out.push(r.cells); idx = r.idx; } return out; };
  const startA = rng() < 0.5 ? 2 : 4;
  const A = phrase(0, startA, 0.2);                                    // the phrase opens on index 2 or 4
  const copy = ph => ph.map(cells => cells.map(c => ({ s: c.s, i: c.i })));
  const lastIdx = cells => cells[cells.length - 1].i;
  const plan = bars === 8 ? ['A', "A''"] : bars === 12 ? ['A', 'B', "A''"] : ['A', "A'", 'B', "A''"];
  const melody = [];                                                   // per bar: cells
  for (let p = 0; p < plan.length; p++) {
    const b0 = p * 4, kind = plan[p];
    if (kind === 'A') { melody.push(...A); continue; }
    if (kind === 'B') { melody.push(...phrase(b0, Math.min(IDX_MAX, startA + 2), 0.1)); continue; }
    const ph = copy(A);
    if (kind === "A'") ph[3] = walkBar(b0 + 3, lastIdx(ph[2]), 0.2, true).cells;
    else { // A'': cadence, the walk falls to the tonic on beat 1 of the loop's final bar
      const from = lastIdx(ph[2]); let t = tonics[0];
      for (const j of tonics) if (j <= from) t = j;
      ph[3] = [{ s: 0, i: t }];
      if (rng() < 0.5 && meter === 8) ph[3].push({ s: mid, i: t });
    }
    melody.push(...ph);
  }
  const notes = [];
  for (let b = 0; b < bars; b++) {
    const c = chordOf(b), t0 = b * meter;
    notes.push({ k: t0, m: root - 12 + c, g: 0.5, bass: true });
    notes.push({ k: t0 + mid, m: root - 12 + c + 7, g: 0.5, bass: true });
    for (const cell of melody[b]) notes.push({ k: t0 + cell.s, m: root + semi(cell.i), g: cell.s === 0 ? 0.9 : cell.s % 2 === 0 ? 0.75 : 0.6, bass: false });
  }
  const mel = new Set(notes.filter(n => !n.bass).map(n => n.k * 128 + n.m));
  for (let j = notes.length - 1; j >= 0; j--) if (notes[j].bass && mel.has(notes[j].k * 128 + notes[j].m)) notes.splice(j, 1); // a unison with the melody: one tine, not two
  notes.sort((a, b) => a.k - b.k || (a.bass === b.bass ? a.m - b.m : a.bass ? -1 : 1));
  const frozen = Object.freeze(notes.map(n => Object.freeze({ t: n.k * step, m: n.m, hz: midiHz(n.m), g: n.g, bass: n.bass })));
  return Object.freeze({ name: def.name, step, bar, bars, meter, root, scale: def.scale, loop: bars * bar, notes: frozen });
}

const MEMO = [];
export function compose(i) {
  if (!Number.isInteger(i) || i < 0 || i >= TUNE_COUNT) i = 0;
  return MEMO[i] ?? (MEMO[i] = composeTune(TUNES[i]));
}

// ------------------------------------------------------------------ timing
export function phaseAt(clock, s, loop) {
  if (!Number.isFinite(clock) || !Number.isFinite(s) || !Number.isFinite(loop) || loop <= 0) return 0;
  return ((clock - s) % loop + loop) % loop;
}

const POOLS = new WeakMap(); // out array -> reused {n, dt} cells: allocation-free once warm
function cell(out, k) {
  let pool = POOLS.get(out); if (!pool) { pool = []; POOLS.set(out, pool); }
  return pool[k] ?? (pool[k] = { n: null, dt: 0 });
}
function lowerBound(notes, t) { let lo = 0, hi = notes.length; while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].t < t) lo = m + 1; else hi = m; } return lo; }
/** Fills out with {n, dt}: the notes whose t is in [p0, p0 + dur) modulo the loop (wrap handled); returns out.length. */
export function windowNotes(tune, p0, dur, out) {
  out.length = 0;
  const notes = tune?.notes, loop = tune?.loop;
  if (!notes || !(loop > 0) || !Number.isFinite(p0) || !(dur > 0)) return 0;
  if (dur > loop) dur = loop;
  p0 = mod(p0, loop);
  const end = p0 + dur;
  let k = 0;
  for (let j = lowerBound(notes, p0); j < notes.length && notes[j].t < end; j++) { const c = cell(out, k++); c.n = notes[j]; c.dt = notes[j].t - p0; out.push(c); }
  if (end > loop) {
    const e2 = end - loop, off = loop - p0;
    for (let j = 0; j < notes.length && notes[j].t < e2 && notes[j].t < p0; j++) { const c = cell(out, k++); c.n = notes[j]; c.dt = off + notes[j].t; out.push(c); }
  }
  return out.length;
}

export function boxGain(d) {
  if (typeof d !== 'number' || !Number.isFinite(d)) return 0;
  if (d <= HEAR_FULL) return 1;
  if (d >= HEAR_MAX) return 0;
  const k = (HEAR_MAX - d) / (HEAR_MAX - HEAR_FULL);
  return k * k;
}

// ------------------------------------------------------------------ slice
const KEY_RE = /^-?\d+,-?\d+$/;
export const tileKey = (x, z) => x + ',' + z;
export const isKey = k => typeof k === 'string' && k.length <= 24 && KEY_RE.test(k) && (() => { const [x, z] = k.split(',').map(Number); return tileKey(x, z) === k; })();
export function boxKeys(decor) {
  const out = new Set();
  if (Array.isArray(decor)) for (const d of decor) if (d && d.type === 'musicbox' && Number.isInteger(d.x) && Number.isInteger(d.z)) out.add(tileKey(d.x, d.z));
  return out;
}
const plain = o => !!o && typeof o === 'object' && !Array.isArray(o);

/** Validated slice {v:1, r, b}. decor given -> entries without a musicbox on that tile are dropped. */
export function cleanBoxes(data, decor) {
  const out = { v: 1, r: 0, b: {} };
  if (!plain(data)) return out;
  out.r = Number.isInteger(data.r) && data.r >= 0 ? data.r : 0;
  const b = plain(data.b) ? data.b : {};
  const have = decor === undefined || decor === null ? null : boxKeys(decor);
  let n = 0;
  for (const k of Object.keys(b)) {
    if (n >= BOX_CAP) break;
    if (k === '__proto__' || !isKey(k) || (have && !have.has(k))) continue;
    const e = b[k];
    if (!plain(e)) continue;
    const s = Number.isFinite(e.s) && e.s > 0 ? round2(e.s) : 0;
    out.b[k] = { on: e.on === 1 ? 1 : 0, t: Number.isInteger(e.t) && e.t >= 0 && e.t < TUNE_COUNT ? e.t : 0, s };
    n++;
  }
  return out;
}

/** Host rule for {kind:'musicbox:set', key, on, t}: mutates st; returns true when it changed. */
export function applySet(st, decor, a, clock) {
  if (!st || !plain(st.b) || !plain(a) || !isKey(a.key) || a.key === '__proto__' || !boxKeys(decor).has(a.key)) return false;
  if (a.on !== 0 && a.on !== 1) return false;
  if (!Number.isInteger(a.t) || a.t < 0 || a.t >= TUNE_COUNT) return false;
  const prev = Object.prototype.hasOwnProperty.call(st.b, a.key) ? st.b[a.key] : null;
  if (!prev && Object.keys(st.b).length >= BOX_CAP) return false;
  const c = Number.isFinite(clock) && clock > 0 ? round2(clock) : 0;
  let s = prev ? prev.s : 0;
  if (a.on === 1 && (!prev || prev.on !== 1 || prev.t !== a.t)) s = c;
  if (prev && prev.on === a.on && prev.t === a.t && prev.s === s) return false;
  st.b[a.key] = { on: a.on, t: a.t, s };
  return true;
}
