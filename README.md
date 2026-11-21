# Little Raft

A small original 3D cooperative raft sandbox. No hunger or damage: hook supplies, extend the raft, craft decorations and automatic collection nets, and fish.

Run `python -m http.server 8766 --directory dist`, then open http://localhost:8766. Serve over HTTPS for remote play. Built with Three.js 0.170.0 and PeerJS 1.5.4, vendored under `dist/vendor`. Their upstream MIT licenses apply. Google Fonts are optional; system fonts are the fallback.

## Playing together

Open the same hosted game on both computers. One player chooses Play together → Host our raft and shares the six-letter code. The second chooses Join raft. The host keeps their tab open. Materials, building, fishing, and the world are shared; each player has their own character and camera. The host's browser saves the raft. Guest worlds do not overwrite the guest's own save.

Online play uses PeerJS's public signaling broker and browser WebRTC data channels. Some networks require a TURN relay, which this small prototype does not provide. Errors and connection timeouts are shown in the room dialog. No chat, microphone, or camera access is used. This is a cooperative prototype for trusted players, without server-side anti-cheat.

## Controls

- Click supplies: automatically throw and reel the hook.
- WASD / arrows: move; drag: orbit; scroll: zoom.
- 1 / 2 / 3: hook / build / fish.
- Build: choose a recipe, then an adjacent cell (floor) or empty existing floor (decoration).
- Fish: click water and wait for a catch.

Supplies regenerate indefinitely. Nets automatically gather nearby supplies. Building consumes the shared stock. No paid services or keys are required to play solo.
