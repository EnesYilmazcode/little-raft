# Co-op lane (`claude/raft-coop`)

The goal of this lane was to make playing with your brother feel good: smooth movement, a living avatar, pings, emotes, his rope and building preview, and reconnecting without losing anything.
Everything new lives in `dist/coop*.js`. `dist/game.js` only gets one-line hooks marked `// coop:`. Every hook calls `coop?.…`, so if the co-op layer fails to load the game runs exactly as before.
No new npm dependencies.

## What you get in game

| Feature | How it works | Module |
|---|---|---|
| Smooth remote movement | Snapshot buffer with an adaptive interpolation delay (≈ interval·1.2 + 2·jitter, clamped to 50–350 ms). The clock offset is the minimum one-way latency, so jitter cannot shift it. Position uses monotone Catmull-Rom, yaw takes the shortest arc. Extrapolation fades out over 250 ms, then holds; errors are blended out over about 100 ms, and jumps over 4 m snap. `sample()` allocates nothing. | `coop-interp.js` |
| Remote avatar | Sailor from `avatar.js`, merged to 8 meshes (was 36). Has a walk cycle, swim bob, head pitch, and holds what he is really holding (13 low-poly held models, 846 tris). Shows the charge pull-back, an overhand throw and reel cranking. | `coop-avatar.js` |
| Name tag | Canvas sprite in a rounded pill. Keeps a constant on-screen size and fades out between 40 and 50 m. The name comes from `localStorage['little-raft-name']`, default "Brother", and is sent in `hello`. | `coop-avatar.js` |
| Pings | **Middle click** puts a "look here" marker: a bobbing diamond, a beam and an expanding ring. Mine are orange, his are blue. Each lasts 5 s, max 3 per player. On a floating item it marks the item; in the water it falls back to the sea surface. | `coop-fx.js`, `coop.js` |
| Emotes | **Z** waves, **X** points (pointing also places a ping). Both show on the avatar for 1.6 s and as a feed line. | `coop-avatar.js`, `coop.js` |
| His hook and throw | Low-poly hook (286 tris) on a sagging rope from his hand. The rope arcs while flying, sags onto the waves while floating, and goes taut while reeling. The fishing bobber works too. | `coop-fx.js` |
| Shared build preview | His hammer/decor ghost on the tile he is aiming at: blue with a pulsing outline, red when he can't afford it. | `coop-fx.js` |
| Bottom-left feed | Joined/left/reconnect messages, pings and emotes appear bottom-left above the hotbar instead of in the centre of the screen. They fade after 6 s, max 5 lines. | `coop-feed.js` |
| Reconnect | See below. | `coop.js` + hooks |
| Bandwidth budget | Pose `cp` at 15 Hz while moving and 4 Hz idle; the first still frame goes out on the 15 Hz tick so the avatar doesn't overshoot. Host `state` is delta-coded per type, with floating items throttled to 2 Hz unless something is added or removed. | `coop-delta.js`, `coop.js` |

### Wire protocol

Coop messages are used only after both sides send `hello`. An older client without the co-op layer gets the original messages unchanged.

- `{type:'coop', k:'hello', v, id, name, re?}`: capability and identity. Each side answers every hello that is not itself a reply, so a hot-swapped hub re-handshakes.
- `{type:'coop', k:'ping'|'emote'|'kf'}`
- `{type:'Δ', k, s, b, p}` / `{type:'Δ', k, s, f}`: delta or keyframe. Arrays keyed by `token` diff per element.

On a sequence gap the decoder returns null. The hub then asks once for a keyframe (`kf`), with no request storms.
The legacy guest `move` message is replaced by `cp`. On the host, `cp` is decoded back into a `move`, so `game.js` keeps its `other` pose and liveness clock. The guest rebuilds the host's `state.other` from the `cp` stream.

Measured in the e2e run (two clients, loopback):

| Direction | Rate |
|---|---|
| host → guest | **≈ 3.0 KB/s** (`Δ:state` 2.5 KB/s + `Δ:cp` 0.5 KB/s) |
| guest → host | **≈ 1.1 KB/s** |

A full host state is ~3.3–4.5 KB; a delta tick is ~130–250 B.

### Reconnect without losing items

The guest's bag always lives on the host, as `guestBag`, saved in the host's world. A guest who was aboard and loses the channel (close without `leaving`, or 3 s of silence) does **not** fall back to their own raft. Instead:

1. The feed says "Connection lost. Reconnecting…" and the label reads RECONNECTING….
2. `coopRejoin()` in game.js creates a new Peer and dials the same room. The host's world, the guest's bag and the guest's position stay on screen.
3. The connection carries `metadata.coopId`. The host accepts it as a rejoin even if it still thinks the old connection is open (`isRejoin`).
4. The first state after a rejoin does not respawn the player. The feed says "Reconnected. Your bag is safe."
5. An attempt in flight gets 12 s. A failed dial redials with backoff of 0.5–4 s. After 30 s the guest goes back to their own raft as before.
6. Rejoin state survives a live hot swap (`capture().coop`).

## Hooks in `dist/game.js` (all marked `// coop:`)

| Where | Hook |
|---|---|
| imports | `import { createCoop } from './coop.js?…'` |
| state | `let coop = null` |
| `toast()` | `if (coop?.feed(s)) return;`: connection news goes to the feed |
| `send()` | `data = coop.encode(data)`: may return null (dropped `move`) |
| `frame()` | `coop?.update(dt, elapsed)` after `updateAvatars`; the 8 s guest timeout asks `coop?.lost()` first |
| `bindPeer` | `metadata:coop?.meta()` on connect; room-full check skips `coop?.isRejoin(c)`; dial error asks `coop?.retry()` |
| `bindConn` | `data = coop.decode(data)` (null = consumed); first state after a rejoin skips the respawn (`coop?.rejoined()`); guest `close` asks `coop?.lost()` |
| networking | `coopRejoin()` and `coopContext()`: a read-only window plus the redial function |
| adopt (hot swap) | skips the join timeout while `X.coop.rejoin` |
| `capture()` / `dispose()` / mount | `coop:coop?.capture()`, `coop?.dispose()`, `createCoop(coopContext(), X?.coop)` in a try/catch |

## Files

- `dist/coop.js`: hub, wire protocol, input (middle click, Z/X), reconnect, `window.coopDebug` (stats, remote, peer, rejoin)
- `dist/coop-interp.js`: `SnapshotBuffer`, `lerpAngle`
- `dist/coop-delta.js`: `diff`, `applyPatch`, `quantize`, `DeltaEncoder` (`encode(msg, {owned})`), `DeltaDecoder`
- `dist/coop-avatar.js`: `createRemoteAvatar`
- `dist/coop-fx.js`: `createPings`, `createRemoteRope`, `createRemoteGhost`
- `dist/coop-feed.js`: `createFeed`
- `dist/coop-loopback.js`: fake PeerJS over `BroadcastChannel`, enabled by `?loopback` (or `localStorage['little-raft-loopback']='1'`). It is inert otherwise. It adds `window.coopChaos`: latency, jitter (never reorders), loss as head-of-line retransmit delay, `drop()`, `blackhole(ms)`, `disconnect()`, and per-type byte stats.
- `docs/cloud/coop-contracts.md`: module contracts. `docs/cloud/coop-research.md`: netcode research notes.

## Tests

- `npm test` now also runs `tests/coop-delta.test.mjs` (fuzzed round trips, keyed arrays, gaps and keyframes, size < 25 %, owned encode) and `tests/coop-interp.test.mjs` (jitter smoothness, reorder/dup, clock offsets, extrapolation cap, teleport, idle gaps, sender restart, yaw wrap, hook). 41/41 pass.
- `node tests/coop-e2e.mjs`: two headless clients in one Chromium context over the loopback, joining through the real UI. The PeerJS broker is blocked in the sandbox, which is why the loopback exists. The test skips WebGL draws for speed; set `COOP_E2E_DRAW=1` to draw. Latest run: all pass.

| Check | Result |
|---|---|
| Connect | ✔ |
| Join message lands in the feed, not the centre | ✔ |
| Remote tracking error after settling | 0.003 m |
| Circle walk at 80 ± 40 ms | max per-frame jump 0.046 m, 0 backward steps, 0 stalls |
| Ping (also from water) | ✔ |
| Wave | ✔ |
| Hook on the wire and rope visible | ✔ |
| Bandwidth | within budget |
| Reconnect after `drop()` | 0.2 s, same bag, 0 m moved |
| Reconnect after `blackhole(6 s)` | back at 6.2 s, same bag |
| Host leaves | guest solo in 0.1 s |
| Page errors | 0 |

Reviews done in this lane:
- **Network chaos review:** found and fixed hello after hot swap, redials killing slow attempts, and a hot swap during rejoin hitting the join timeout. Also fixed kf storms and the reconnect label.
- **Perf review:** avatar draws 36→8 meshes, flying hook 8.8k→286 tris, interp `sample()` allocates nothing, no encoder copy for owned messages, pose snapshot built only when due.

## Screenshots (`docs/cloud/shots/coop/`)

Module previews: `avatar-poses.png`, `fx-preview.png`, `feed-preview.png`. Two-client shots: `e2e-host.png`, `e2e-guest.png`, plus the visual-QA set listed below.

## Known limits / next steps

- Pose rides the reliable ordered channel, so loss causes head-of-line delay. The interp buffer absorbs it, but an unordered second DataChannel for `cp` (research note §5) would be better on real lossy links.
- After the host leaves, `#networkStatus` still says "Connected!…" (pre-existing text in the `leaving` path).
- The 8.3 Hz host state tick is game.js's own; only its encoding was changed.
