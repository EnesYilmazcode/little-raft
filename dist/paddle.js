// Paddle tool (Raft: a crafted paddle pushes the raft from its edge). Rules are pure and unit-tested
// (tests/paddle.test.mjs); attachPaddle() is the small game.js glue (no THREE, no DOM beyond the prompt provider).
// One LMB stroke while standing on an edge tile sends the shared sail action {kind:'sail', op:'paddle', angle},
// so a guest's stroke goes through the host like every other sail op (sailing-core.js applies the impulse).
import { wearPerUse, toolRole } from './items.js';

export const PADDLE = Object.freeze({
  COOLDOWN: 0.85,    // seconds between strokes (a little over SAIL.PADDLE_COOLDOWN so a lagged stroke is never dropped)
  STROKE_TIME: 0.6,  // seconds of the visible stroke
  TILE: 2,           // raft tile size (metres)
  SPLASH_OUT: 1.3,   // metres in front of the player where the blade hits the water
});

export const isPaddle = (kind) => toolRole(kind) === 'paddle';

/** True when a stroke may start: lastAt is the time (s) of the previous stroke or -Infinity. */
export const canStroke = (now, lastAt) => !(now - lastAt < PADDLE.COOLDOWN - 1e-6);

/** Compass angle (sin a, cos a) of the camera's look direction for a YXZ camera yaw (yaw 0 looks along -z). */
export function strokeAngle(yaw) {
  if (!Number.isFinite(yaw)) return NaN;
  const a = yaw + Math.PI;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** True when world point (x,z) is on a raft tile that has at least one open side. No allocations. */
export function onEdgeTile(tiles, x, z) {
  if (!Array.isArray(tiles) || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  const tx = Math.round(x / PADDLE.TILE), tz = Math.round(z / PADDLE.TILE);
  let here = false, sides = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]; if (!t) continue;
    const dx = t[0] - tx, dz = t[1] - tz;
    if (dx === 0 && dz === 0) here = true;
    else if ((dx === 0 && (dz === 1 || dz === -1)) || (dz === 0 && (dx === 1 || dx === -1))) sides++;
  }
  return here && sides < 4;
}

/** One stroke of wear on a bag slot (mutates slot.durability, 0..100). Returns {before, after, broke} or null. */
export function wearPaddleSlot(slot) {
  if (!slot || !isPaddle(slot.kind)) return null;
  const before = Math.min(100, Math.max(0, Number.isFinite(slot.durability) ? slot.durability : 100));
  const after = Math.max(0, before - wearPerUse(slot.kind));
  slot.durability = after < 1e-9 ? 0 : after;
  return { before, after: slot.durability, broke: before > 0 && slot.durability === 0 };
}

/** Why a stroke can't happen now ('' when it can). s = {durability, swimming, onEdge, anchored}. */
export function strokeBlock(s) {
  if (!s) return 'none';
  if (!(s.durability > 0)) return 'worn';
  if (s.swimming || !s.onEdge) return 'edge';
  if (s.anchored) return 'anchored';
  return '';
}
const PROMPTS = Object.freeze({
  '': Object.freeze({ key: 'LMB', label: 'Paddle' }),
  edge: Object.freeze({ label: 'Stand at the edge to paddle', muted: true }),
  anchored: Object.freeze({ label: 'Raise the anchor to paddle', muted: true }),
  worn: Object.freeze({ label: 'This paddle is worn out', muted: true }),
});
/** Crosshair prompt (prompts.js provider format) for a held paddle. */
export const paddlePrompt = (s) => PROMPTS[strokeBlock(s)] ?? null;

/**
 * Game glue. ctx (getters): localBag(), physics(), tiles(), yaw(), elapsed(), anchored(), action(a), notice(t),
 * splash(x, z, strength) (at the water surface), sound(name), other(), sailReady(), sailApply(a, actor), emit(e, to).
 */
export function attachPaddle(ctx) {
  let lastStroke = -Infinity, stroke = 0, pinned = -1, unprovide = null;
  const look = { durability: 0, swimming: false, onEdge: false, anchored: false }; // reused: no per-frame allocation
  const heldSlot = () => { const b = ctx.localBag(); const s = b?.slots[b.selectedIndex]; return s && isPaddle(s.kind) ? s : null; };
  function sample(slot) {
    const p = ctx.physics();
    look.durability = slot ? (Number.isFinite(slot.durability) ? slot.durability : 100) : 0;
    look.swimming = !!p?.swimming; look.onEdge = !!p && onEdgeTile(ctx.tiles(), p.x, p.z); look.anchored = !!ctx.anchored();
    return look;
  }

  /** LMB with a paddle held. Returns true when the click was ours. */
  function use() {
    const slot = heldSlot(); if (!slot) return false;
    const now = ctx.elapsed();
    if (!canStroke(now, lastStroke)) return true;
    const why = strokeBlock(sample(slot));
    if (why) { ctx.notice(PROMPTS[why].label); return true; }
    lastStroke = now; stroke = 1;
    const yaw = ctx.yaw(), p = ctx.physics(), b = ctx.localBag();
    ctx.action({ kind: 'sail', op: 'paddle', angle: strokeAngle(yaw), slot: b.selectedIndex });
    ctx.sound?.('swim');
    ctx.splash?.(p.x - Math.sin(yaw) * PADDLE.SPLASH_OUT, p.z - Math.cos(yaw) * PADDLE.SPLASH_OUT, 0.8);
    return true;
  }

  /** Host side of a paddle stroke: validates the actor, applies the sail op, wears the paddle. True when handled. */
  function apply(a, actor, bag) {
    if (!a || a.kind !== 'sail' || a.op !== 'paddle') return false;
    // The stroke must name the paddle slot it was made with (a paddle tucked in the backpack can't push), and a
    // bad angle is refused here: sailing-core would ignore it, but the paddle would still wear.
    if (!Number.isFinite(a.angle)) return true;
    const i = Number.isInteger(a.slot) && bag.slots[a.slot] && isPaddle(bag.slots[a.slot].kind) ? a.slot : -1;
    if (i < 0 || !(bag.slots[i].durability > 0)) return true;
    const who = actor === 'guest' ? ctx.other() : ctx.physics();
    if (!who || who.swimming || !onEdgeTile(ctx.tiles(), who.x, who.z)) return true;
    if (!ctx.sailReady()) return true; // anchored, or someone stroked a moment ago: no impulse, no wear
    ctx.sailApply(a, actor);
    const w = wearPaddleSlot(bag.slots[i]);
    if (w?.broke) { bag.slots[i] = null; ctx.emit({ kind: 'notice', text: 'Your paddle broke!' }, actor); }
    else if (w && w.before > 25 && w.after <= 25) ctx.emit({ kind: 'notice', text: 'Paddle getting worn: about ' + Math.round(w.after / Math.max(1e-9, wearPerUse(bag.slots[i].kind))) + ' strokes left' }, actor);
    if (w) bag.version++;
    return true;
  }

  /** 1 -> 0 over a stroke (hands.update({paddle})). Call once per frame. */
  function update(dt) {
    if (pinned >= 0) stroke = pinned;
    else if (stroke > 0) stroke = Math.max(0, stroke - (dt > 0 ? dt : 0) / PADDLE.STROKE_TIME);
    if (!unprovide) provide();
    return stroke;
  }
  function provide() { // prompts.js may load after us: retried from update() until it exists
    if (typeof window === 'undefined') return;
    try {
      const p = window.raftPrompts;
      if (p?.provide) unprovide = p.provide({ id: 'paddle', priority: 1, prompt: (c) => { const s = heldSlot(); return s && !c?.state?.pickup ? paddlePrompt(sample(s)) : null; } });
    } catch { /* prompts unavailable */ }
  }
  function dispose() { try { unprovide?.(); } catch { /* ignore */ } unprovide = null; }
  return { use, apply, update, dispose, get stroke() { return stroke; }, pin(v) { pinned = Number.isFinite(v) ? Math.min(1, v) : -1; } }; // pin(-1) / pin(NaN) releases
}
