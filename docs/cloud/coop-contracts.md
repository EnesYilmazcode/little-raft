# Co-op lane: module contracts (shared brief for builders)

All co-op code lives in `dist/coop*.js` (vanilla ES modules, no deps, Three.js passed in as `T`).
Import siblings with plain relative paths (`./coop-interp.js`) — no `?build=` suffix needed.
`dist/coop.js` (the hub, owned by the lead) wires everything into `game.js` through a handful of
one-line hooks marked `// coop:`. Builders must NOT edit `game.js` or any non-coop file.

Coordinates: world space, metres. Raft tiles are 2 m; tile (x,z) centre = (x*2, deckY, z*2).
Avatar feet at y=0 of its group; eye at 1.6 m (`EYE_OFFSET`). Yaw: camera yaw, avatar faces yaw+PI.
Held kinds: `'hook' | 'hammer' | 'fishingrod' | 'wood' | 'leaf' | 'scrap' | 'plastic' | 'sail' | 'palm' |
'lantern' | 'net' | 'bench' | 'crate' | null`.
Hook stages (from HookCast): `'flying' | 'floating' | 'reeling' | 'done'`; plus `'fishing'` for the rod bobber.

## coop-interp.js  (pure, node-testable)
```js
export class SnapshotBuffer {
  constructor({delayMs=100, minDelayMs=50, maxDelayMs=350, maxExtrapolateMs=250, snapDistance=4, size=32}={})
  push(snap, recvMs)        // snap = {t:senderMs, x,y,z,yaw,pitch, ...anything}; ignores stale/dup t; returns bool
  sample(nowMs, out={})     // -> out | null. out: {x,y,z,yaw,pitch,vx,vz,speed, extrapolating:bool, teleported:bool,
                            //    hook:{x,y,z}|null (Catmull-Rom of snap.hook when consecutive snaps have it), latest:snap}
  reset()
  get stats()               // {delayMs, jitterMs, offsetMs, count, intervalMs}
}
export const lerpAngle = (a, b, t) => ...   // shortest-arc
```
Clock: estimate offset = recvMs - snap.t, take a low-percentile/min-ish smoothed value so jitter does not
shift it; render time = nowMs - offset - delay. Adaptive delay ≈ clamp(interval*1.2 + 2*jitter).
Interpolate with cubic Hermite/Catmull-Rom on position (linear fallback), shortest-arc yaw. Out of data:
extrapolate with last velocity up to maxExtrapolateMs, then hold. A jump > snapDistance between
consecutive snaps sets `teleported` and snaps instead of sliding. Must handle reordering, duplicates,
long gaps (idle sender sends at ~4 Hz), clock offset of any size, and sender restart (t jumps backwards
a lot → auto-reset).

## coop-delta.js  (pure, node-testable)
Wire envelope `{type:'Δ', k:<inner type>, s:<seq>, b:<base seq>, p:<patch>}` or keyframe
`{type:'Δ', k, s, f:<full message>}`. Channel is reliable+ordered, so base = previous seq per `k`.
```js
export function diff(prev, next)   // -> patch or undefined when equal. Objects recurse; deleted keys -> {$del:[...]}?;
                                    //   arrays of objects that all have a string `token` (or `id`) key are diffed by key;
                                    //   other arrays replaced whole when changed. Must round-trip exactly.
export function applyPatch(prev, patch) // -> new value (does not mutate prev)
export function quantize(v, digits=3)  // deep copy rounding finite non-integer numbers
export class DeltaEncoder { constructor({keyframeEvery=50}={}); encode(msg) /* msg.type is k */ ; reset(); forceKeyframe(k?) }
export class DeltaDecoder { decode(wire) /* -> full msg | null (null = gap, caller must ask for keyframe) */; reset() }
```

## coop-avatar.js
```js
export function createRemoteAvatar(T, {color='#70a7e4', name='Brother'}={}) -> {
  group,                      // THREE.Group, feet at 0, add to scene (world space)
  update(dt, s, time),        // s = {x,y,z,yaw,pitch,speed,swimming,grounded, held, charge(0..1), reeling, hookOut,
                              //       stage, emote:{kind:'wave'|'point', age:seconds}|null, throwAge(seconds since cast|null)}
  handWorld(outVec3),         // world position of the held item's tip / rope attach point
  setName(str), dispose()
}
```
Built on `createAvatar` from `./avatar.js` (parts in `userData.parts`: head,leftArm,rightArm,leftLeg,rightLeg).
Walk cycle from speed; head pitch follows `pitch`; right hand holds a small model of `held` (hook via
`createHook` from `./hook.js`; others simple low-poly own art); charge = arm pulled back, throw = fast
overhand swing, reeling = cranking; emotes override arms (wave: right arm up waving 1.6 s; point: arm
straight toward look dir 1.6 s). Floating name tag: canvas-texture Sprite above the head, rounded pill,
`sizeAttenuation` off-ish so it stays readable (constant screen size, clamp), depthTest on but render
on top of water, fades beyond 40 m.

## coop-fx.js  (pings, remote rope, remote ghost)
```js
export function createPings(T, scene) -> { add({x,y,z, mine:bool, label?}), update(dt, time, camera), dispose() }
  // 'look here' marker: bobbing diamond + soft vertical beam + expanding ring on the water/deck, colour by owner,
  // lives 5 s, max 3 per owner (oldest replaced). Constant-ish screen size.
export function createRemoteRope(T, scene) -> { update(dt, hand:Vector3, hook:{x,y,z,stage}|null, ocean, time), dispose() }
  // remote hook rope: own hook mesh (createHook from ./hook.js, scale .5) + sagging rope line from hand to hook;
  // taut while reeling, slack with sag + water clamp (ocean.getHeight(x,z)) while floating, arc while flying.
export function createRemoteGhost(T, scene) -> { update(ghost:{x,z,kind,ok}|null, deckY, time), dispose() }
  // brother's build preview on tile (x,z): translucent blue box 1.9x.13x1.9 for floors (or small footprint marker
  // for decor kinds), pulsing outline; red tint when ok===false. Hidden when null.
```

## coop-feed.js
```js
export function createFeed({doc=document}={}) -> { push(text, kind='info'|'join'|'leave'|'ping'|'emote'|'warn'), dispose() }
```
Bottom-left HUD feed (own `<style id="coopFeedStyle">`, container `#coopFeed`, pointer-events none, above the
hotbar's left edge, max 5 lines, newest at bottom, each line fades out after ~6 s, small coloured dot per kind,
text via textContent only). Must not overlap the hotbar (game hotbar is bottom-centre).

## coop-loopback.js  (test transport)
Installs a fake `globalThis.Peer` (PeerJS-compatible subset) when the page URL has `?loopback` (or
`localStorage['little-raft-loopback']==='1'`). Backed by `BroadcastChannel('little-raft-loopback')` so two
pages in the same browser context can connect. Must be loaded as a classic side-effect before game code
uses `Peer`: the hub imports it first (`import './coop-loopback.js'`), and it replaces `globalThis.Peer`
only when the flag is present.
Subset: `new Peer(id?)`, `.id .open .destroyed .disconnected`, `.on/.off/.removeListener(ev, fn)` for
`open|connection|error|disconnected|close`, `.connect(id, {reliable, metadata}) -> DataConnection`,
`.reconnect() .destroy()`. DataConnection: `.open .peer .metadata .on/.off('open'|'data'|'close'|'error')`,
`.send(obj)` (structured-clone semantics: JSON round trip), `.close()`. Unknown target → peer emits
`error` `{type:'peer-unavailable'}` after ~300 ms. Delivery async, ordered.
Chaos + stats on `window.coopChaos` (per page, applies to messages this page SENDS):
`{latency:0, jitter:0, loss:0 /* reliable channel: a "lost" packet is retransmitted -> extra delay of
~3*latency+50ms and head-of-line blocks later ones */, drop() /* close both ends abruptly, no 'leaving' */,
blackhole(ms) /* silently discard everything both ways for ms, then resume */, bytes:{sent:{}, recv:{}} /* by msg.type, JSON length */}`.

## Hub (lead) – coop.js
`createCoop(ctx)` with ctx getters into game.js; sends `cp` pose snapshots (15 Hz moving, 4 Hz idle,
delta-encoded), coop events `{type:'coop', k:'hello'|'ping'|'emote'|'kf', ...}`, delta-encodes the host
`state` message (items throttled), feeds join/leave into coop-feed, drives remote avatar/rope/ghost/pings,
and handles guest auto-reconnect.
