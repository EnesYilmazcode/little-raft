# Co-op netcode research (pose snapshots over PeerJS)

Context: 2 peers, host authoritative, 10–20 Hz pose snapshots, PeerJS DataChannel.

## 1. Interpolation delay
- Render remote entities in the past. Valve defaults to `cl_interp 0.1` s at 20 Hz, i.e. 2 snapshot intervals, so a single lost update does not cause a stall [Valve]. Gambetta uses one interval as the minimum [Gambetta]. At 10 Hz with loss, Gaffer needs ~350 ms [Gaffer-SI].
- **Use:** `delay = 2 × sendInterval + 2 × jitter`, clamped to [100, 300] ms (100 ms at 20 Hz, 200 ms at 10 Hz before jitter). Measure jitter as an EWMA (α≈0.1) of |arrival-interval − sendInterval|.
- Adapt slowly: change playback rate by ±1–5 % (time-stretch) and do not jump. Grow fast on underrun and shrink slowly (for example −1 ms/s). Overwatch and Rocket League both adjust buffer size from measured loss/jitter instead of using fixed values [Ford GDC17; Cone GDC18].

## 2. Clock offset
- Ping/pong: `offset = tHost − (t0 + t1)/2`. Keep the last 16 samples. Use the **median offset of the 4 lowest-RTT samples**, because low RTT means a symmetric path and the least queueing error. Use `performance.now()` and never `Date.now()`.
- Sample at 1 Hz (5 Hz for the first 2 s). Slew the estimate (≤ 1 ms per frame). Step it only when the error is > 50 ms.
- In addition, stamp every snapshot with the host tick and drive interpolation from that tick timeline, so a small offset error only moves the delay.

## 3. Hermite vs linear
- At ≤ 20 Hz, linear interpolation shows corners on curved motion. Cubic Hermite using the sent velocity (tangents `v·Δt`) is smooth and C¹, and Gaffer recommends it for low rates [Gaffer-SI]. **Use Hermite for position.** Fall back to linear if |v| is implausible (teleports, respawn flag). Use shortest-arc lerp for yaw. Sending velocity costs about 3×16 bits.

## 4. Extrapolation and recovery
- Valve caps extrapolation at 0.25 s (`cl_extrapolate_amount`) [Valve]. **Use:** extrapolate with the last velocity for ≤ 150–250 ms, decaying the velocity to zero, then freeze.
- When data resumes, do not snap. Keep a visual error offset `err = oldRender − newTruth` and decay it exponentially (τ≈100 ms, ~90 % gone in 250 ms). Snap only when error > ~2 m or on a teleport flag.

## 5. Delta compression on reliable+ordered
- Gaffer delta-encodes against the **last acked** snapshot because packets can be lost [Gaffer-SC]. On a reliable ordered channel every message arrives in order, so you can delta against the previous *sent* snapshot without acks. The cost is head-of-line blocking: one lost SCTP packet holds back every later snapshot for ≥ 1 RTT, which causes bursty arrivals and a larger interp buffer.
- PeerJS `reliable:false` sets `ordered:false` but, as far as I recall the 1.x source, it does **not** set `maxRetransmits`. That would make it unordered but still reliable. This could not be checked here (no network); confirm in `node_modules/peerjs` before relying on it.
- **Recommendation:** keep the PeerJS reliable channel for events and state. Add a second pose channel on the underlying `RTCPeerConnection` with `{negotiated:true, id:2, ordered:false, maxRetransmits:0}` on both peers. Send full (non-delta) quantised poses on it, which are small for 2 players, and drop any snapshot older than the newest one received. Keep delta coding for the reliable channel only. If you skip the second channel, a reliable channel at 20 Hz is acceptable; just budget +1 RTT of jitter.

## 6. Quantisation
- Gaffer uses 1/512 m (~2 mm) for bounded position and smallest-three quaternions at 9 bits per component [Gaffer-SC].
- **Use:** position int16 at 1 cm (±327 m; use 1/512 m if the world is ≤ ±64 m). Yaw uint16 (0.0055°); 12 bits (0.09°) is also fine. Velocity int16 at 1 cm/s. Add a 16-bit wrapping tick. Pose packet: about 16–20 bytes per entity.

## 7. Reconnect
- A transient drop (`iceConnectionState` = `disconnected`) often recovers by itself in 5–10 s. On `failed`, do an ICE restart (`pc.restartIce()`); it keeps the existing connection object. PeerJS does not expose ICE restart, so in practice open a **new DataConnection**. `peer.reconnect()` only reconnects to the signalling server.
- The host issues a random session token at join. The client keeps it in `sessionStorage`. The host keeps the player slot and state for a grace period (**60 s**), with the avatar frozen or AI-held. On rejoin, the client sends `hello{token, lastTick}` and the host replies with a full snapshot (never a delta), then resumes. Remember the host's peer ID so a reload can redial.

## Sources
- Valve, "Source Multiplayer Networking" (developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)
- Glenn Fiedler, "Snapshot Interpolation" and "Snapshot Compression", gafferongames.com (2014)
- Gabriel Gambetta, "Fast-Paced Multiplayer: Entity Interpolation" (gabrielgambetta.com)
- Tim Ford, "Overwatch Gameplay Architecture and Netcode", GDC 2017
- Jared Cone, "It IS Rocket Science! The Physics of Rocket League Detailed", GDC 2018
- W3C WebRTC 1.0: RTCDataChannelInit (`ordered`, `maxRetransmits`, `negotiated`), `restartIce()`
