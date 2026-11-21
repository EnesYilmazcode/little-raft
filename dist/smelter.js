// Pure cooking-station model (smelter, grill, ...). No DOM, no timers.
// Each item of a recipe takes recipe.time seconds and burns recipe.fuel fuel
// units spread evenly over that time. Progress pauses (never resets) when fuel
// runs out or the output slot cannot take the result.
import { ITEMS, FUEL_VALUE } from './items.js?build=v3-survival-ae77fa84ac2b';

export const FUEL_CAP = 10;
const EPS = 1e-9;

const posInt = (n) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

export class StationModel {
  constructor(stationId, snapshot = null, opts = {}) {
    this.stationId = String(stationId);
    this.items = opts.items || ITEMS;
    this.fuelValue = opts.fuelValue || FUEL_VALUE;
    this.fuelCap = opts.fuelCap ?? FUEL_CAP;
    this.input = null;
    this.output = null;
    this.fuelUnits = 0;
    this.progress = 0; // seconds into the current item
    this._stall = null;
    this.restore(snapshot);
  }

  stackOf(kind) { return Math.max(1, posInt(this.items[kind]?.stack) || 1); }

  // { kind: outputKind, recipe } for an input kind, or null.
  recipeFor(kind) {
    for (const id of Object.keys(this.items)) {
      const r = this.items[id]?.recipe;
      if (!r || r.station !== this.stationId || !r.cost) continue;
      const keys = Object.keys(r.cost);
      if (keys.length === 1 && keys[0] === kind) {
        return { kind: id, in: posInt(r.cost[kind]) || 1, count: posInt(r.count) || 1,
          time: Math.max(EPS, Number(r.time) || 1), fuel: Math.max(0, Number(r.fuel) || 0) };
      }
    }
    return null;
  }

  accepts(kind) {
    return !!this.recipeFor(kind) && (!this.input || this.input.kind === kind);
  }

  insert(kind, count) {
    count = posInt(count);
    if (!count || !this.accepts(kind)) return 0;
    const have = this.input ? this.input.count : 0;
    const n = Math.min(count, this.stackOf(kind) - have);
    if (n <= 0) return 0;
    this.input = { kind, count: have + n };
    return n;
  }

  isFuel(kind) { return Number(this.fuelValue[kind]) > 0; }

  addFuel(kind, count) {
    count = posInt(count);
    if (!count || !this.isFuel(kind)) return 0;
    const v = Number(this.fuelValue[kind]);
    const n = Math.min(count, Math.floor((this.fuelCap - this.fuelUnits + EPS) / v));
    if (n <= 0) return 0;
    this.fuelUnits = Math.min(this.fuelCap, this.fuelUnits + n * v);
    return n;
  }

  takeOutput() { const o = this.output; this.output = null; return o; }

  takeInput() {
    const i = this.input;
    this.input = null;
    this.progress = 0;
    return i;
  }

  get recipe() { return this.input ? this.recipeFor(this.input.kind) : null; }

  _room(r) {
    const o = this.output;
    return !o || (o.kind === r.kind && o.count + r.count <= this.stackOf(r.kind));
  }

  // Why cooking cannot proceed: null (it can), 'idle', 'blocked', 'starved'.
  _reason() {
    const r = this.recipe;
    if (!r || this.input.count < r.in) return 'idle';
    if (!this._room(r)) return 'blocked';
    if (r.fuel > 0 && this.fuelUnits <= EPS) return 'starved';
    return null;
  }

  get cooking() { return this._reason() === null; }

  get fraction() {
    const r = this.recipe;
    return r ? Math.min(1, Math.max(0, this.progress / r.time)) : 0;
  }

  tick(dt) {
    const events = [];
    let left = Number.isFinite(dt) && dt > 0 ? dt : 0;
    let reason = this._reason();
    while (left > EPS && reason === null) {
      const r = this.recipe;
      const rate = r.fuel / r.time; // fuel units per second
      const toDone = r.time - this.progress;
      const toEmpty = rate > 0 ? this.fuelUnits / rate : Infinity;
      const step = Math.min(left, toDone, toEmpty);
      left -= step;
      this.progress += step;
      this.fuelUnits = step === toEmpty ? 0 : Math.max(0, this.fuelUnits - rate * step);
      if (this.fuelUnits < EPS) this.fuelUnits = 0;
      if (step === toDone || this.progress >= r.time - EPS) {
        this.progress = 0;
        this.input.count -= r.in;
        if (this.input.count <= 0) this.input = null;
        this.output = { kind: r.kind, count: (this.output ? this.output.count : 0) + r.count };
        const last = events[events.length - 1];
        if (last && last.type === 'done' && last.kind === r.kind) last.count += r.count;
        else events.push({ type: 'done', kind: r.kind, count: r.count });
      }
      reason = this._reason();
    }
    if (reason !== this._stall && (reason === 'starved' || reason === 'blocked')) events.push({ type: reason });
    this._stall = reason;
    return events;
  }

  snapshot() {
    return {
      station: this.stationId,
      input: this.input && { ...this.input },
      output: this.output && { ...this.output },
      fuel: this.fuelUnits,
      progress: this.progress,
    };
  }

  restore(snap) {
    this.input = this.output = null;
    this.fuelUnits = this.progress = 0;
    if (!snap || typeof snap !== 'object') return;
    const stack = (s, ok) => {
      if (!s || typeof s !== 'object' || typeof s.kind !== 'string' || !Object.hasOwn(this.items, s.kind) || !ok(s.kind)) return null;
      const count = Math.min(posInt(s.count), this.stackOf(s.kind));
      return count > 0 ? { kind: s.kind, count } : null;
    };
    this.input = stack(snap.input, (k) => !!this.recipeFor(k));
    this.output = stack(snap.output, (k) => this.items[k]?.recipe?.station === this.stationId);
    const f = Number(snap.fuel);
    this.fuelUnits = Number.isFinite(f) ? Math.min(this.fuelCap, Math.max(0, f)) : 0;
    const r = this.recipe, p = Number(snap.progress);
    this.progress = r && Number.isFinite(p) ? Math.min(r.time, Math.max(0, p)) : 0;
  }
}
