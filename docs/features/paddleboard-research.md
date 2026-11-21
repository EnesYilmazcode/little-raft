# Paddleboard: research

Research note for a small personal boat. Line numbers are from the round-4 tree (claude/loop-features-202611210814) and
move as other lanes edit; the anchor text next to each is the reliable reference.

## (a) Genre conventions (general mechanics, nothing borrowed)

- **Small personal boat** in raft/ocean survival games: a mid-game craft (planks + floats + rope), placed on the water from the deck edge. It is faster than swimming but slower than a powered boat. It carries one rider, sometimes with a small storage slot.
- **Board, mount, ride.** You press E on the boat to board it. W/S paddle, the mouse looks/steers, Space or E gets off. You can always look around freely. The camera rocks with the swell. Rhythmic paddle strokes give a pulsing speed and splash sounds.
- **Docking.** You get off next to the base and climb straight onto the deck. The boat stays tied up there with a short rope and you pick it up again with E. A boat left out at sea either stays put or drifts back. Cozy games never lose it.
- **Range.** A soft limit, such as a current that pushes back or a "too far from home" warning, keeps the boat near the base, so the world can stay small.
- **Multiplayer.** Other players see the boat under the rider. Only one person rides it at a time, and the host owns its position once it is moored.

## (b) Our design: the "Driftboard"

- Item `paddleboard` "Driftboard" (maxStack 1). Recipe `{ wood: 6, plastic: 3, rope: 2 }`. The paddle comes with it and there is no separate tool. It is crafted at the Tinker's Desk/craft book like the bed.
- **Launch:** hold the item and left click (`content.use(aim,'paddleboard')`) while aiming at water within 3 m of a deck tile edge, or press E at the deck edge. This sends host action `paddleboard.launch {x,z,h}`. The host removes the item and adds a board, tied at the nearest edge slot.
- **Board states:** `tied` (snugs against a raft edge, short rope drawn), `adrift` (left at sea; it drifts gently back toward the raft at 0.4 m/s and auto-ties within 1.5 m of the hull), `ridden` (follows its rider).
- **Stow:** press E on a tied board while standing on the deck to get "Pick up Driftboard". The item goes back to the bag and the board is removed. If the bag is full, the board stays put.
- Cap: 4 boards per world. Each player normally has one. A board has no owner field; whoever stands near it can use it.

## (c) Controls (while riding)

| Input | Effect |
|---|---|
| Mouse | Look freely. The board's heading eases toward the look yaw while paddling (turn rate 1.6 rad/s). |
| W / S | Paddle forward / back-paddle (brake, and slow reverse 1 m/s). |
| A / D | Slow sideways sculling (0.8 m/s) for lining up at a dock. |
| Shift | Power strokes (top speed 4.6 vs 3.6 m/s). No stamina cost, because there is no hunger or damage. |
| E | Near the raft (≤1.2 m from a tile): step onto the deck and the board auto-ties. Elsewhere: hop into the water. |
| Space | Hop off into the water (swim). The board is left `adrift` and comes home by itself. |
| Hook / rod | Allowed (it is fun to hook debris from the board). Build/hammer is blocked with "Step onto the raft to build". |

Prompts: aiming at a tied or adrift board shows `<kbd>E</kbd>Board the Driftboard`. On the deck, the tied board also
shows `· hold E to pick up` (hold matches sleep's HOLD=1 s). While riding, a muted hint reads
`Paddle W · E Step aboard / Hop off`.

## (d) Physics approach: kinematic and riding on the wave height

- The board does **not** run PlayerPhysics while ridden. It works like the zipline ride: a module hook returns `true`, so `physics.update` is skipped. It writes `physics.x/y/z/vx/vz` itself, sets `vy=0`, `swimming=false` and `grounded=false`. Setting `grounded=false` matters: game.js only plays footsteps and walk bob when grounded (`walking = physics.grounded && speed > .4`, game.js:1273), and it applies raft roll to the camera only when grounded (game.js:1311).
- **Stroke model** (pure, `dist/paddleboard-core.js` + `tests/paddleboard.test.mjs`): each stroke lasts 0.55 s, or 0.42 s with Shift, and alternates sides. Thrust per stroke is shaped by `sin(pi*u)`, and drag is `v *= exp(-0.9*dt)`. At a steady W you cruise at about 3.6 m/s, compared with SWIM_SPEED 2.1 (player-physics.js:10) and the raft's sail cap of 2.0 m/s (sailing-core.js TARGET_CAP). Heading uses `angDiff` easing. Velocity is mostly along the heading, with a little lateral slip (`lat *= exp(-4*dt)`), so turns glide.
- **Height:** `y = ocean.getHeight(x,z) + 0.1` for the deck of the board. getHeight already includes sailing's `uFlow` offset (ocean.js:308), so this is correct in the raft frame. Pitch and roll come from `ocean.sample(x,z,out,undefined,1.2)` slopes × 0.7, damped like `updateRaft` (game.js ~1297). The eye is board deck + 1.5. Camera bob comes only from y. Scale the wave term by `options.cameraMotion` (blend toward a low-passed height) for motion-sensitive players.
- **Frame:** the raft never moves in x/z, and the world (water, scenery, debris) slides past instead (sailing-world.js:3). The board lives in raft coordinates like a swimmer, so it keeps pace with a sailing raft for free. Docked islands (`islands.js`, side·off with off 8–60, R 6–9) and the trader barge (`trader-core.js` LANE 22) are also in raft coordinates.
- **Collisions:** push the board circle (r 0.45 around the rider, plus a 1.2 m capsule along the heading for the hull) out of tile squares, the same math as `_pushOutOfTiles` (player-physics.js ~265), so the board slides along the raft side. Reduce the velocity into the hull. Decor props (blockList) can be ignored because they sit on the deck.
- **Beaching:** put `createPaddleboard` **after** `createIslands` in FEATURES. islands.afterMove runs `standOnSand` (islands.js:263) and can set `grounded=true` on sand. In our afterMove, if we are riding and `physics.grounded` became true, end the ride ("You hop onto the sand"). The board stays `adrift` at the shore.
- **Tether (soft):** past 38 m from the nearest tile, a gentle push home ramps up (up to 2 m/s), with the notice "The current tugs you back toward the raft". Hard clamp at 45 m. This must stay under PlayerPhysics `MAX_RAFT_DISTANCE 50` (player-physics.js:38; `_safety` teleports to the deck at line 197 the moment physics runs again) and diving `MAX_DISTANCE 50`. Docked islands sit a `gap` from the raft edge, and signal caches park within STOP_GAP 6 (signal.js:5), so everything you need is inside 38 m once it has arrived.
- **No allocations per frame:** reuse sample and out objects, as in islands.js and sleep.js.

## (e) Mount / dismount

- **Mount** (E on board, ≤2.5 m, not swimming-underwater, not diving, UI closed): send `paddleboard.ride {id}`. The host checks reach (pose slack 1 m, as in islands GUEST_SLACK), checks the board is free, and sets `rider` to the actor. The client starts riding as soon as the slice confirms it. The host starts at once. A guest predicts for up to 0.5 s and cancels if it is refused. Swimmers can mount from the water too, by pressing E on the board.
- **Dismount:** `paddleboard.leave {id,x,z,h,mode}` where mode is `'deck'`, `'swim'` or `'sand'`. The host clamps x/z to 45 m and finite values and stores the board. On `'deck'` it ties the board at the nearest edge slot. Locally:
  - deck: place the player inside the nearest tile edge (the clamber target logic, player-physics.js `_beginClimb`), with `grounded=true`;
  - swim: `swimming=true`, `y = waterY + 0.45`;
  - follow the zipline dismount hygiene: copy `_prevJump = jump` and set `_jumpBuffer = 0` so the Space that got you off does not also jump.
- **Auto-end:** if `ctx.physics` is replaced (respawn, restore, swimAt), the ride ends. Compare with the rider's physics object, like diving.js:205 and zipline `R.phys`. Opening the UI does not end the ride; it just stops input. When sleep's afterMove snaps the player to a bed (sleep.js:283), it also ends the ride.

## (f) Co-op visibility

- The pose stream (coop.js `snapshot`, line 125) carries only x,y,z,yaw,pitch plus the swimming, grounded and reeling flags. Riders send `grounded:false, swimming:false`, so the remote avatar uses its "air" pose (coop-avatar.js ~159, legs bent: lL -0.45, rL 0.25). That reads as a braced stance on a board, so the protocol needs **no change**.
- The **board mesh** under the other player is drawn by our module from `slice.boards[i].rider`. Each client draws every board. A board ridden by the peer follows `ctx.other` (x,z,yaw, about 8–15 Hz), smoothed with `damp(…, 10, dt)`, and its y comes from local getHeight. The avatar is interpolated (coop-interp), so the smoothing keeps the board within a few cm of the feet. If that looks off, a later option is to expose the avatar's `friend.position` via ctx (game.js already uses it for instruments, ~490).
- Tied and adrift boards come from host `serialize()`, sent about 8 times a second. The host simulates adrift homing, and guests ease toward it. A ridden board's position is owned by its rider. The host copies `ctx.other` into the slice for the guest's board, so a late joiner sees it.

## (g) Save

`world.ext.paddleboard = { v:1, boards:[{ id, x, z, h, s:'tied'|'adrift', r:null|'host'|'guest' }] }`. The board items
themselves live in the bags. `load(data,'save')` clears `r`, because players respawn on the deck, and turns a ridden
board into an adrift one. Validation: at most 4 boards, finite values, |x|,|z| ≤ 45, h wrapped into ±π, unknown
values for `s` become 'adrift', and duplicate ids are dropped. Old saves get `load(undefined)`, which means no boards.

## (h) Model (≤3 draw calls, `dist/paddleboard-model.js`)

1. **Hull:** one merged geometry (merge-geo.js) of a rounded plank board 2.6×0.7×0.1 m, with a raised nose, two plastic float pontoons and a woven deck pad, coloured with vertex colours on one MeshStandardMaterial.
2. **Paddle:** a shaft and blade, attached to the board when idle or riding. The local view shows it via the held-item hand pose if that is cheap; otherwise it stays on the deck.
3. **Tie rope:** one short line from the nose to the tile edge, visible only when tied. It shares the rope material. The held/bag icon is `icon-paddleboard` in icons.svg + SPRITES (survival-ui.js).

## (i) Integration points

- `dist/content.js` FEATURES (line ~38): append `createPaddleboard` after createIslands (anywhere after it). Add the `ride` / `riding` registry entries **identical to the zipline branch** (origin/claude/loop-features-202611210753-zfs content.js:64: `ride: (dt,p,inp) => !!first('ride',dt,p,inp), riding: () => !!first('riding')`), so the two features merge into one hook. If zipline lands first, reuse its hook.
- `dist/game.js movePlayer` (line 1251): zipline adds `const ride = !dive && !!content?.ride?.(dt, physics, rideIn)` and `if (!dive && !ride) for (...)` around line 1262. Paddleboard needs `rideIn` to also carry `strafe`, `sprint`, `yaw`, `pitch` and `interact`. There is no yaw getter on contentCtx (game.js:397). Without that edit we would have to read `ctx.camera.rotation.y`, which is one frame stale. That one-line `rideIn` extension is the only game.js edit.
- `content.afterMove(physics, dt)` (game.js:1269) handles beach detection and tether notices. `content.update(dt)` handles meshes for tied, adrift and peer-ridden boards. `interact`/`prompt`/`use`/`action`/`serialize`/`load` are as described above.
- Optional: the `riding` flag in coop `local()` (zipline adds `riding:` at game.js:1787) is not required for us.
- `dist/content-items.js`: CONTENT_ITEMS `paddleboard` and a CONTENT_RECIPES entry. It is not a CONTENT_DECOR: it floats in the sea, not on a tile.
