# Little Raft

A small original 3D cooperative raft sandbox. No hunger or damage: hook supplies, extend the raft, craft decorations and automatic collection nets, and fish.

Run `python -m http.server 8766 --directory dist`, then open http://localhost:8766. Serve over HTTPS for remote play. Built with Three.js 0.170.0 and PeerJS 1.5.4, vendored under `dist/vendor`. Their upstream MIT licenses apply. Google Fonts are optional; system fonts are the fallback.

## Playing together

Open the same hosted game on both computers. One player chooses Play together → Host our raft and shares the six-letter code. The second chooses Join raft. The host keeps their tab open. Materials, building, fishing, and the world are shared; each player has their own character and camera. The host's browser saves the raft. Guest worlds do not overwrite the guest's own save.

Online play uses PeerJS's public signaling broker and browser WebRTC data channels. Some networks require a TURN relay, which this small prototype does not provide. Errors and connection timeouts are shown in the room dialog. No chat, microphone, or camera access is used. This is a cooperative prototype for trusted players, without server-side anti-cheat.

## Controls

- Hold left mouse to charge, release to throw, then hold left mouse to reel.
- WASD / arrows: walk in first person; mouse: look.
- 1 / 2 / 3: hook / build / fish.
- Build: choose a recipe, then an adjacent cell (floor) or empty existing floor (decoration).
- Fish: click water and wait for a catch.
- Escape: release the cursor and open settings; Resume returns to play.

Supplies regenerate indefinitely. Nets automatically gather nearby supplies. Building consumes the shared stock. No paid services or keys are required to play solo.

## Desktop and live releases

Windows starts with `python desktop/launch.py` or the Little Raft desktop shortcut. The launcher serves the live `dist/` folder on port 41896 and opens the Electron app. The Mac app connects to the same Windows LAN server. Windows must remain awake and reachable for the Mac to load updates.

Active apps poll `/version.json` every six seconds. A changed compatible build stages its JavaScript and CSS, captures the current world and connection, then swaps engines without navigating the page. Failed mounts keep the previous engine. Desktop shell updates and incompatible network protocol changes require a later restart.

Worker checkouts under `.team/` and QA builds under `.qa/` are separate from the live feed. Publish an already tested candidate with `python publish_local.py <candidate-dist> --label <release>`. The publisher writes the manifest last; the server uses `RAFT_RELEASE_MODE=1` to advertise only committed releases. `check_live_feed.py` exercises a real automatic publication with two connected headless clients and checks connection, supplies, and raft preservation.

The currently published visual release has first-person controls, detailed deck/tools/hands, charged hook throws, durability, and pause settings. Hook-only spawning, personal inventory stacks, jumping/swimming, and fully ballistic multicatch are being integrated separately and are not yet part of that release.
