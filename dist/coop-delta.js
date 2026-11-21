// coop-delta.js - pure per-message-type delta compression for a reliable, ordered channel.
// Wire: keyframe {type:'Δ', k, s, f:<full msg>} or delta {type:'Δ', k, s, b:<base seq>, p:<patch>}.
//
// Patch format (compact JSON, sized for PeerJS binarypack):
//   undefined / absent        -> unchanged
//   primitive or null         -> replace with that value
//   array                     -> replace with that array
//   {$r: v}                   -> replace with v (any object, incl. ones with '$' keys)
//   {$a: {i: patch}, $o: [..]} -> keyed array: $a patches prev elements by prev index; $o (omitted when the
//                                 order is unchanged) lists the new order: n = prev[n], [n, len] = run
//                                 prev[n..n+len-1], object = newly inserted element (full value)
//   {key: patch, $d: [keys]}  -> object field patch, $d = removed keys

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === null || typeof v !== 'object') ? v : JSON.parse(JSON.stringify(v));
const hasDollar = o => Object.keys(o).some(k => k[0] === '$');

function eq(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !eq(a[k], b[k])) return false;
  return true;
}

// Key field shared by every element ('token' string, else 'id' string/number), unique; null if not keyable.
function keyField(arr) {
  for (const f of ['token', 'id']) {
    const seen = new Set();
    let ok = arr.length > 0;
    for (const el of arr) {
      const v = isObj(el) ? el[f] : undefined;
      if (!(typeof v === 'string' || (f === 'id' && typeof v === 'number')) || seen.has(v)) { ok = false; break; }
      seen.add(v);
    }
    if (ok) return f;
  }
  return null;
}

function diffKeyed(prev, next, f) {
  const at = new Map(prev.map((el, i) => [el[f], i]));
  const p = {}, order = [];
  let same = prev.length === next.length, changed = false;
  next.forEach((el, j) => {
    const i = at.get(el[f]);
    if (i === undefined) { order.push(el); same = false; changed = true; return; }
    const d = diff(prev[i], el);
    if (d !== undefined) { p[i] = d; changed = true; }
    if (i !== j) same = false;
    order.push(i);
  });
  if (!same) changed = true;
  if (!changed) return undefined;
  const patch = {$a: p};
  if (!same) { // run-length compress consecutive prev indices
    const o = [];
    for (let j = 0; j < order.length;) {
      const v = order[j];
      if (typeof v !== 'number') { o.push(v); j++; continue; }
      let len = 1;
      while (order[j + len] === v + len) len++;
      o.push(len > 1 ? [v, len] : v); j += len;
    }
    patch.$o = o;
  }
  return JSON.stringify(patch).length < JSON.stringify(next).length ? patch : next;
}

// -> patch, or undefined when prev and next are deep-equal.
export function diff(prev, next) {
  if (prev === next) return undefined;
  if (Array.isArray(next)) {
    if (Array.isArray(prev)) {
      const f = prev.length && next.length ? keyField(prev) : null;
      if (f && keyField(next) === f) return diffKeyed(prev, next, f);
      return eq(prev, next) ? undefined : next;
    }
    return next;
  }
  if (isObj(next)) {
    if (!isObj(prev) || hasDollar(prev) || hasDollar(next)) return eq(prev, next) ? undefined : {$r: next};
    const p = {}, del = [];
    let n = 0;
    for (const k of Object.keys(next)) {
      const d = Object.prototype.hasOwnProperty.call(prev, k) ? diff(prev[k], next[k]) : (next[k] !== null && typeof next[k] === 'object' && !Array.isArray(next[k]) ? {$r: next[k]} : next[k]);
      if (d !== undefined) { p[k] = d; n++; }
    }
    for (const k of Object.keys(prev)) if (!Object.prototype.hasOwnProperty.call(next, k)) del.push(k);
    if (del.length) { p.$d = del; n++; }
    return n ? p : undefined;
  }
  return next; // primitive / null (prev !== next here)
}

// -> new value; never mutates prev (unchanged subtrees may be shared with prev).
export function applyPatch(prev, patch) {
  if (patch === undefined) return prev;
  if (patch === null || typeof patch !== 'object') return patch;
  if (Array.isArray(patch)) return clone(patch);
  if ('$r' in patch) return clone(patch.$r);
  if ('$a' in patch) {
    const p = patch.$a, out = [];
    const take = i => out.push(p[i] !== undefined ? applyPatch(prev[i], p[i]) : prev[i]);
    if (!patch.$o) prev.forEach((_, i) => take(i));
    else for (const o of patch.$o) {
      if (typeof o === 'number') take(o);
      else if (Array.isArray(o)) for (let i = o[0]; i < o[0] + o[1]; i++) take(i);
      else out.push(clone(o));
    }
    return out;
  }
  const out = {...prev};
  for (const k of patch.$d || []) delete out[k];
  for (const k of Object.keys(patch)) if (k !== '$d') out[k] = applyPatch(prev[k], patch[k]);
  return out;
}

// Deep copy rounding finite non-integer numbers to `digits` decimals (shrinks patches + JSON size).
export function quantize(v, digits = 3) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Number.isInteger(v)) return v;
    const m = 10 ** digits;
    return Math.round(v * m) / m || 0; // no -0
  }
  if (Array.isArray(v)) return v.map(x => quantize(x, digits));
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = quantize(v[k], digits); return o; }
  return v;
}

export class DeltaEncoder {
  constructor({keyframeEvery = 50} = {}) { this.keyframeEvery = keyframeEvery; this.reset(); }
  reset() { this.st = new Map(); }
  // Next encode of k (or of every type when k is omitted) is a keyframe.
  forceKeyframe(k) {
    if (k === undefined) for (const st of this.st.values()) st.force = true;
    else if (this.st.has(k)) this.st.get(k).force = true;
  }
  // opts.owned = true: msg is a fresh JSON-safe object the caller hands over and never mutates again,
  // so the defensive deep copy is skipped (the encoder keeps it as the next diff base).
  encode(msg, {owned = false} = {}) {
    const k = msg.type, cur = owned ? msg : clone(msg); // own copy: callers mutate their objects
    let st = this.st.get(k);
    if (!st) this.st.set(k, st = {seq: 0, last: undefined, since: 0, force: true});
    const s = ++st.seq, last = st.last;
    st.last = cur;
    if (st.force || ++st.since >= this.keyframeEvery) {
      st.force = false; st.since = 0;
      return {type: 'Δ', k, s, f: cur};
    }
    const wire = {type: 'Δ', k, s, b: s - 1};
    const p = diff(last, cur);
    if (p !== undefined) wire.p = p;
    return wire;
  }
}

export class DeltaDecoder {
  constructor() { this.reset(); }
  reset() { this.st = new Map(); }
  // -> full message (fresh copy, caller may keep/mutate) | null on gap / unknown base (request a keyframe).
  decode(wire) {
    if (!wire || wire.type !== 'Δ') return wire ?? null;
    if ('f' in wire) {
      this.st.set(wire.k, {seq: wire.s, val: clone(wire.f)});
      return clone(wire.f);
    }
    const st = this.st.get(wire.k);
    if (!st || st.seq !== wire.b) { this.st.delete(wire.k); return null; }
    st.val = applyPatch(st.val, wire.p);
    st.seq = wire.s;
    return clone(st.val);
  }
}
