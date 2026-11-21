// Authoritative per-player inventory ("bag") for the raft survival game.
// Pure ES module: no DOM, no THREE, no timers, no randomness.

export const STACK_SIZE = 20;
export const SLOT_COUNT = 28;
export const HOTBAR_SIZE = 10;
export const TOOL_DURABILITY = 100;

const TOOL_KINDS = new Set(['hook', 'hammer', 'fishingrod']);

// icon = symbol id in dist/icons.svg. placeholder:true means the icon is
// borrowed from a related item until a dedicated asset exists.
export const ITEM_INFO = Object.freeze({
  wood:       Object.freeze({ kind: 'wood',       name: 'Wood',         icon: 'icon-wood',    maxStack: STACK_SIZE, tool: false, placeholder: false }),
  leaf:       Object.freeze({ kind: 'leaf',       name: 'Palm Leaf',    icon: 'icon-leaf',    maxStack: STACK_SIZE, tool: false, placeholder: false }),
  plastic:    Object.freeze({ kind: 'plastic',    name: 'Plastic',      icon: 'icon-scrap',   maxStack: STACK_SIZE, tool: false, placeholder: true }),
  scrap:      Object.freeze({ kind: 'scrap',      name: 'Scrap',        icon: 'icon-scrap',   maxStack: STACK_SIZE, tool: false, placeholder: false }),
  rope:       Object.freeze({ kind: 'rope',       name: 'Rope',         icon: 'icon-net',     maxStack: STACK_SIZE, tool: false, placeholder: true }),
  fish:       Object.freeze({ kind: 'fish',       name: 'Fish',         icon: 'icon-fish',    maxStack: STACK_SIZE, tool: false, placeholder: false }),
  hook:       Object.freeze({ kind: 'hook',       name: 'Hook',         icon: 'icon-hook',    maxStack: 1,          tool: true,  placeholder: false }),
  hammer:     Object.freeze({ kind: 'hammer',     name: 'Hammer',       icon: 'icon-hammer',  maxStack: 1,          tool: true,  placeholder: false }),
  fishingrod: Object.freeze({ kind: 'fishingrod', name: 'Fishing Rod',  icon: 'icon-hook',    maxStack: 1,          tool: true,  placeholder: true }),
  sail:       Object.freeze({ kind: 'sail',       name: 'Sail',         icon: 'icon-sail',    maxStack: STACK_SIZE, tool: false, placeholder: false }),
  palm:       Object.freeze({ kind: 'palm',       name: 'Palm Planter', icon: 'icon-palm',    maxStack: STACK_SIZE, tool: false, placeholder: false }),
  lantern:    Object.freeze({ kind: 'lantern',    name: 'Lantern',      icon: 'icon-lantern', maxStack: STACK_SIZE, tool: false, placeholder: false }),
  net:        Object.freeze({ kind: 'net',        name: 'Net',          icon: 'icon-net',     maxStack: STACK_SIZE, tool: false, placeholder: false }),
  bench:      Object.freeze({ kind: 'bench',      name: 'Bench',        icon: 'icon-repair',  maxStack: STACK_SIZE, tool: false, placeholder: true }),
  crate:      Object.freeze({ kind: 'crate',      name: 'Crate',        icon: 'icon-barrel',  maxStack: STACK_SIZE, tool: false, placeholder: true }),
  // farming (definitions mirror FARM_ITEMS in farming.js)
  seed:       Object.freeze({ kind: 'seed',       name: 'Palm Seed',    icon: 'icon-leaf',    maxStack: STACK_SIZE, tool: false, placeholder: true }),
  cup:        Object.freeze({ kind: 'cup',        name: 'Filter Cup',   icon: 'icon-scrap',   maxStack: STACK_SIZE, tool: false, placeholder: true }),
  water:      Object.freeze({ kind: 'water',      name: 'Cup of Fresh Water', icon: 'icon-barrel', maxStack: STACK_SIZE, tool: false, placeholder: true }),
});

export const ITEM_KINDS = Object.freeze(Object.keys(ITEM_INFO));

function recipe(id, name, count, cost) {
  return Object.freeze({
    id,
    name,
    output: Object.freeze({ kind: id, count }),
    cost: Object.freeze(cost),
  });
}

// Foundation/floor building is NOT a craft item: the engine charges
// 2 wood + 2 plastic per floor tile when the hammer is used.
export const RECIPES = Object.freeze({
  rope:       recipe('rope',       'Rope',         1, { leaf: 2 }),
  hook:       recipe('hook',       'Hook',         1, { wood: 1, plastic: 2 }),
  hammer:     recipe('hammer',     'Hammer',       1, { wood: 4, rope: 2 }),
  fishingrod: recipe('fishingrod', 'Fishing Rod',  1, { wood: 6, rope: 8 }),
  sail:       recipe('sail',       'Sail',         1, { wood: 4, rope: 3, leaf: 3 }),
  palm:       recipe('palm',       'Palm Planter', 1, { wood: 2, leaf: 3 }),
  lantern:    recipe('lantern',    'Lantern',      1, { wood: 2, scrap: 2 }),
  net:        recipe('net',        'Net',          1, { wood: 3, rope: 3 }),
  bench:      recipe('bench',      'Bench',        1, { wood: 3 }),
  crate:      recipe('crate',      'Crate',        1, { wood: 4, scrap: 1 }),
  cup:        recipe('cup',        'Filter Cup',   1, { plastic: 2, leaf: 1 }), // farming
});

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isKind = (k) => typeof k === 'string' && hasOwn(ITEM_INFO, k);
const isTool = (k) => TOOL_KINDS.has(k);
const maxStackOf = (k) => ITEM_INFO[k].maxStack;
const isIndex = (i, n) => Number.isInteger(i) && i >= 0 && i < n;

/** Convert anything to a non-negative safe integer (floor); junk -> 0. */
function toCount(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER);
}

function clampDurability(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return TOOL_DURABILITY;
  return Math.min(TOOL_DURABILITY, Math.max(0, n));
}

function copySlot(s) {
  if (!s) return null;
  const out = { kind: s.kind, count: s.count };
  if (s.durability !== undefined) out.durability = s.durability;
  if (s.id !== undefined) out.id = s.id;
  return out;
}

function makeSlot(kind, count, metadata) {
  const s = { kind, count };
  if (isTool(kind)) s.durability = clampDurability(metadata && metadata.durability);
  if (metadata && typeof metadata.id === 'string' && metadata.id) s.id = metadata.id;
  return s;
}

/** Validate + normalize one snapshot slot. Throws TypeError on bad data. */
function validateSlot(raw, i) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`Bag: slot ${i} must be an object or null`);
  }
  const { kind, count, durability, id } = raw;
  if (!isKind(kind)) throw new TypeError(`Bag: slot ${i} has unknown kind ${String(kind)}`);
  if (!Number.isInteger(count) || count < 1 || count > maxStackOf(kind)) {
    throw new TypeError(`Bag: slot ${i} count must be an integer 1..${maxStackOf(kind)}`);
  }
  const s = { kind, count };
  if (isTool(kind)) {
    if (durability === undefined) s.durability = TOOL_DURABILITY;
    else if (typeof durability !== 'number' || !Number.isFinite(durability) || durability < 0 || durability > TOOL_DURABILITY) {
      throw new TypeError(`Bag: slot ${i} durability must be a number 0..${TOOL_DURABILITY}`);
    } else s.durability = durability;
  } else if (durability !== undefined) {
    throw new TypeError(`Bag: slot ${i} kind ${kind} cannot have durability`);
  }
  if (id !== undefined) {
    if (typeof id !== 'string' || !id) throw new TypeError(`Bag: slot ${i} id must be a non-empty string`);
    s.id = id;
  }
  return s;
}

function emptySlots() {
  return new Array(SLOT_COUNT).fill(null);
}

export class Bag {
  /**
   * @param {{slots:Array, selected:number}|null} snapshot
   * Throws TypeError if a provided snapshot is malformed.
   */
  constructor(snapshot = null) {
    if (snapshot === null || snapshot === undefined) {
      this.slots = emptySlots();
      this.slots[0] = { kind: 'hook', count: 1, durability: TOOL_DURABILITY };
      this.selectedIndex = 0;
      return;
    }
    if (typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new TypeError('Bag: snapshot must be a plain object');
    }
    const { slots, selected } = snapshot;
    if (!Array.isArray(slots) || slots.length !== SLOT_COUNT) {
      throw new TypeError(`Bag: snapshot.slots must be an array of length ${SLOT_COUNT}`);
    }
    if (!isIndex(selected, HOTBAR_SIZE)) {
      throw new TypeError(`Bag: snapshot.selected must be an integer 0..${HOTBAR_SIZE - 1}`);
    }
    const out = new Array(SLOT_COUNT);
    for (let i = 0; i < SLOT_COUNT; i++) out[i] = validateSlot(slots[i], i);
    this.slots = out;
    this.selectedIndex = selected;
  }

  /** Migrate legacy count-based stock. Starts EMPTY (no free default hook). */
  static fromCounts(counts, { tools = ['hook'] } = {}) {
    const bag = new Bag({ slots: emptySlots(), selected: 0 });
    const src = counts && typeof counts === 'object' ? counts : {};
    const toolList = Array.isArray(tools) ? tools : [];
    // Tools first so they land on the hotbar. One instance per listed tool,
    // or the legacy count if larger; never both added together.
    for (const kind of TOOL_KINDS) {
      const listed = toolList.includes(kind) ? 1 : 0;
      const legacy = hasOwn(src, kind) ? toCount(src[kind]) : 0;
      const qty = Math.max(listed, legacy);
      if (qty > 0) bag.add(kind, qty);
    }
    for (const kind of ITEM_KINDS) {
      if (isTool(kind) || !hasOwn(src, kind)) continue;
      const qty = toCount(src[kind]);
      if (qty > 0) bag.add(kind, qty);
    }
    return bag;
  }

  /**
   * Lenient load for saves and hot-swap transfers: keeps every usable slot and
   * repairs or drops the rest (unknown kinds from other builds, over-cap stacks,
   * bad durability), so one bad slot never wipes the whole bag. Null if hopeless.
   */
  static salvage(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.slots)) return null;
    const bag = new Bag({ slots: emptySlots(), selected: 0 });
    for (let i = 0; i < SLOT_COUNT; i++) {
      const raw = snapshot.slots[i];
      if (!raw || typeof raw !== 'object' || !isKind(raw.kind)) continue;
      const count = Math.min(toCount(raw.count), maxStackOf(raw.kind));
      if (count > 0) bag.slots[i] = makeSlot(raw.kind, count, raw);
    }
    if (isIndex(snapshot.selected, HOTBAR_SIZE)) bag.selectedIndex = snapshot.selected;
    return bag;
  }

  get selected() {
    return copySlot(this.slots[this.selectedIndex]);
  }

  count(kind) {
    if (!isKind(kind)) return 0;
    let n = 0;
    for (const s of this.slots) if (s && s.kind === kind) n += s.count;
    return n;
  }

  counts() {
    const out = {};
    for (const k of ITEM_KINDS) out[k] = 0;
    for (const s of this.slots) if (s && isKind(s.kind)) out[s.kind] += s.count;
    return out;
  }

  /**
   * Add items: tops up existing stacks first, then fills empty slots (index
   * order). Returns the integer amount that did NOT fit (0 = all added).
   * Unknown kind -> nothing added, whole (sanitized) count returned.
   */
  add(kind, count, metadata = {}) {
    let left = toCount(count);
    if (left === 0) return 0;
    if (!isKind(kind)) return left;
    const max = maxStackOf(kind);
    let meta = metadata && typeof metadata === 'object' ? metadata : {};
    if (max > 1) {
      for (const s of this.slots) {
        if (left === 0) break;
        if (s && s.kind === kind && s.count < max) {
          const put = Math.min(max - s.count, left);
          s.count += put;
          left -= put;
        }
      }
    }
    for (let i = 0; i < SLOT_COUNT && left > 0; i++) {
      if (this.slots[i]) continue;
      const put = Math.min(max, left);
      // An explicit id is attached only to the first new slot (ids must stay unique).
      this.slots[i] = makeSlot(kind, put, meta);
      if (meta.id !== undefined) meta = { ...meta, id: undefined };
      left -= put;
    }
    return left;
  }

  /** Atomic: removes exactly `count` or changes nothing. Takes from the back first. */
  remove(kind, count) {
    if (!isKind(kind)) return false;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return false;
    if (this.count(kind) < count) return false;
    let left = count;
    for (let i = SLOT_COUNT - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.kind !== kind) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count === 0) this.slots[i] = null;
    }
    return true;
  }

  /**
   * Move/split/merge/swap between slots.
   * - amount omitted -> whole stack.
   * - empty target: move (or split off `amount`).
   * - same stackable kind: merge up to maxStack (partial merge ok).
   * - tools / different kind: swap whole stacks only (partial amount refused).
   */
  move(from, to, amount) {
    if (!isIndex(from, SLOT_COUNT) || !isIndex(to, SLOT_COUNT) || from === to) return false;
    const src = this.slots[from];
    if (!src) return false;
    let amt;
    if (amount === undefined || amount === null) amt = src.count;
    else {
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > src.count) return false;
      amt = amount;
    }
    const whole = amt === src.count;
    const dst = this.slots[to];

    if (!dst) {
      if (whole) {
        this.slots[to] = src;
        this.slots[from] = null;
      } else {
        this.slots[to] = { kind: src.kind, count: amt };
        src.count -= amt;
      }
      return true;
    }

    const max = maxStackOf(src.kind);
    if (dst.kind === src.kind && max > 1) {
      const space = max - dst.count;
      if (space <= 0) {
        if (!whole) return false;
        // Both full stacks of same kind: swapping is a no-op but harmless.
        this.slots[to] = src;
        this.slots[from] = dst;
        return true;
      }
      const put = Math.min(space, amt);
      dst.count += put;
      src.count -= put;
      if (src.count === 0) this.slots[from] = null;
      return true;
    }

    if (!whole) return false;
    this.slots[to] = src;
    this.slots[from] = dst;
    return true;
  }

  snapshot() {
    return { slots: this.slots.map(copySlot), selected: this.selectedIndex };
  }

  select(index) {
    if (!isIndex(index, HOTBAR_SIZE)) return false;
    this.selectedIndex = index;
    return true;
  }

  cycle(delta) {
    const d = typeof delta === 'number' && Number.isFinite(delta) ? Math.trunc(delta) : 0;
    this.selectedIndex = (((this.selectedIndex + d) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    return this.selectedIndex;
  }

  /** @returns {{ok:boolean, missing:{kind,count}[], full:boolean}} */
  canCraft(id) {
    const r = typeof id === 'string' && hasOwn(RECIPES, id) ? RECIPES[id] : null;
    if (!r) return { ok: false, missing: [], full: false };
    const missing = [];
    for (const [kind, need] of Object.entries(r.cost)) {
      const have = this.count(kind);
      if (have < need) missing.push({ kind, count: need - have });
    }
    // Capacity check on a scratch copy; consuming the cost may free a slot.
    const scratch = new Bag(this.snapshot());
    if (missing.length === 0) {
      for (const [kind, need] of Object.entries(r.cost)) scratch.remove(kind, need);
    }
    const full = scratch.add(r.output.kind, r.output.count) > 0;
    return { ok: missing.length === 0 && !full, missing, full };
  }

  /** Atomic craft. @returns {{ok:true, crafted:{kind,count}} | {ok:false, reason, missing?}} */
  craft(id) {
    const r = typeof id === 'string' && hasOwn(RECIPES, id) ? RECIPES[id] : null;
    if (!r) return { ok: false, reason: 'unknown-recipe' };
    const check = this.canCraft(id);
    if (check.missing.length) return { ok: false, reason: 'missing', missing: check.missing };
    if (check.full) return { ok: false, reason: 'full' };
    const scratch = new Bag(this.snapshot());
    for (const [kind, need] of Object.entries(r.cost)) {
      if (!scratch.remove(kind, need)) return { ok: false, reason: 'missing', missing: this.canCraft(id).missing };
    }
    if (scratch.add(r.output.kind, r.output.count, isTool(r.output.kind) ? { durability: TOOL_DURABILITY } : {}) > 0) {
      return { ok: false, reason: 'full' };
    }
    // Commit only after every step succeeded on the scratch copy.
    // Keep the same array object so external references to bag.slots stay valid.
    for (let i = 0; i < SLOT_COUNT; i++) this.slots[i] = scratch.slots[i];
    return { ok: true, crafted: { kind: r.output.kind, count: r.output.count } };
  }
}

export default Bag;
