# Raft scale reference

Real Raft (Redbeet Interactive, 1.0) numbers next to Little Raft, as of branch claude/raft-feedback-all.

Status key:
- confirmed: a developer post or several community sources agree
- reported: one community source (mod page default, wiki), not checked against game files
- estimated: derived by me (method given)

Research note: this session could not open steamcommunity.com, raft.wiki.gg or pcgamingwiki.com directly (network blocked).
Facts from those sites come from search result snippets only. Anything marked estimated should be checked in game with
the 1.5 m foundation as a ruler before we tune to it.

## Key numbers

| Quantity | Ours (file:line) | Raft | Status | Ours / Raft |
|---|---|---|---|---|
| Foundation tile size | 2.0 m (dist/player-physics.js:18 TILE_SIZE; building-pieces uses 2*i) | 1.5 m | confirmed (dev post, 2020) | 1.33 |
| Full wall / storey height | 2.2 m (dist/building-pieces.js:6 LEVEL_H) | about 2.2 m (range 2.0 to 2.4) | estimated: a wall reads about 1.4 to 1.6 foundations tall in screenshots | about 1.0 |
| Wall height / tile width | 1.10 | about 1.45 | estimated | 0.76 |
| Half wall | 1.1 m (dist/building-pieces.js:20) | about 1.1 m (a wall cut in half horizontally) | shape confirmed (wiki), height estimated | about 1.0 |
| Pillar | 2.2 m, 0.22 m square (dist/building-pieces.js:12, :23) | one storey tall | estimated | about 1.0 |
| Railing (visual) | 0.95 m (dist/building-pieces.js:37 RAIL_H) | about 1.0 m, waist height | estimated (about 2/3 of a foundation) | 0.95 |
| Railing collision | 3.5 m guard box (dist/building-pieces.js:42 RAIL_GUARD) | its own mesh, standable | estimated | 3.5 |
| Doorway height | 1.95 m (dist/building-pieces.js:12 DOOR_H) | a little above head height | estimated | about 1.0 |
| Roof rise | 1.0 m over one tile (dist/building-pieces.js:12 ROOF_RISE) | about 0.75 m over one tile | estimated | about 1.3 |
| Stairs | one cell, rise 2.2 m over 2 m run, about 48 deg (dist/building-pieces.js:24) | one foundation, rise one storey over 1.5 m, about 55 deg | estimated | slope 0.87 |
| Player capsule height | 1.75 m (EYE 1.6 + HEAD 0.15, dist/building-pieces.js:13) | about 1.8 m (Unity CharacterController, human sized) | estimated | 0.97 |
| Body radius | 0.25 m (dist/player-physics.js:17) | about 0.3 to 0.4 m | estimated | about 0.7 |
| Eye / camera height | 1.6 m (dist/player-physics.js:16 EYE_OFFSET) | about 1.6 to 1.7 m | estimated (eye line well above a half wall, below a doorway top) | about 1.0 |
| Crouch eye drop | 0.55 m (dist/move-feel.js:14) | about 0.5 to 0.7 m | estimated | about 1.0 |
| Step up | 0.55 m (dist/building-pieces.js:13 STEP_UP) | about 0.3 to 0.5 m | estimated (usual Unity stepOffset) | about 1.3 |
| Jump impulse | 9.89 m/s (dist/player-physics.js:13) | 7 m/s (jumpSpeed) | reported (mod default) | 1.41 |
| Gravity | 20 up / 30 down (dist/player-physics.js:14-15) | 20, one value | reported (two mod pages agree) | 1.0 / 1.5 |
| Jump apex, standing | 2.445 m | about 1.23 m (7^2 / 40) | derived from reported values | 1.99 |
| Jump apex, running | same as standing | same as standing, only more distance | estimated | 1.99 |
| Walk speed | 2.6 m/s (dist/player-physics.js:8) | 3 m/s (normalSpeed) | reported | 0.87 |
| Sprint speed | 4.3 m/s (dist/player-physics.js:9) | 5 to 6 m/s | reported (sources disagree) | about 0.78 |
| Swim speed | 2.1 m/s (dist/player-physics.js:10) | about 2 to 3 m/s | reported (sources disagree) | about 0.85 |
| Ladder climb | 2 m/s (dist/move-feel.js:31) | about 2 to 3 m/s | estimated | about 0.8 |
| Camera FOV default | 75 deg vertical (dist/settings.js:22; dist/game.js:479 creates at 70, :1708 applies options.fov) | not confirmed; about 60 deg vertical (about 90 horizontal at 16:9) | estimated | 1.25 |
| Camera FOV range | 60 to 100 vertical (dist/settings.js:22) | 50 to 90 (PCGamingWiki says vertical) | reported | wider |

Notes:
- Jump apex = v^2 / (2 g). Ours: 9.89^2 / 40 = 2.445 m. Raft: 7^2 / 40 = 1.225 m. Raft physics is frame rate dependent
  (players cap to 30 FPS to make hard jumps), so the real apex varies a little.
- 75 deg vertical at 16:9 is about 107 deg horizontal. 90 deg horizontal is about 59 deg vertical.

## What the player can stand on

Raft (jump about 1.2 m plus step offset):

| Target | Height | Raft | Status |
|---|---|---|---|
| Half wall top | about 1.1 m | jump onto, stand | estimated (fits jump apex) |
| Railing / fence top | about 1.0 m | jump onto, stand or balance | estimated |
| Storage chest | about 0.6 to 0.9 m | jump onto, stand | confirmed (tips thread: wall plus chest on that square, jump up using both) |
| Table, stove, grill, purifier, research table, smelter | about 0.8 to 1.0 m | jump onto, stand | estimated (solid colliders) |
| Crop plot / planter | about 0.3 to 0.5 m | step or hop onto, stand | estimated |
| Bed | about 0.5 m | hop onto, stand | estimated |
| Roof | storey top | stand, reach from above or by stairs | estimated |
| Stairs | ramp | walk up | confirmed |
| Ladder | one storey | climb; cannot share a wall slot | confirmed (official tweet: ladder counts as a wall piece) |
| Full wall top | about 2.2 m | cannot jump onto from the floor; needs a chest or other step | confirmed by the chest trick |
| Rugs, wall hangings, lights, small decor | flat or high | nothing to stand on | estimated |
| Raft edge from water | | auto climb when swimming into it, blocked by walls or barricades | confirmed (AppGamer answer) |

Raft has no land ledge clamber; you jump and land on tops. Climbing out of water is the only auto clamber.

Ours (dist/building-pieces.js, dist/player-physics.js, dist/coop-rules.js:42, dist/game.js:96 and :666):

| Target | Ours |
|---|---|
| Floor one storey up (2.2 m) | jump onto (apex 2.445 m) |
| Full wall top | jump onto |
| Half wall top | jump onto |
| Railing / gate | blocked by a 3.5 m guard box |
| Stairs, ladder, roof | walk, climb, walk |
| All placed decor and stations (chests, beds, research, cookpot, benches, tables, etc.) | blocked: 2D circles or boxes of infinite height, never standable |

## First person framing

Eye 1.6 m, looking level, wall 2.2 m tall. Fraction of screen height from the bottom edge up to the wall top:

| Distance to wall | Ours (2 m tile, 75 deg vertical) | Raft estimate (1.5 m tile, about 60 deg vertical) |
|---|---|---|
| half a tile (1.0 m ours, 0.75 m Raft) | 0.89 | past the top edge |
| one tile (2.0 m ours, 1.5 m Raft) | 0.70 | 0.86 |
| one and a half tiles (3.0 m ours, 2.25 m Raft) | 0.63 | 0.74 |

Method: top = 0.5 + 0.5 * ((wall - eye) / d) / tan(vfov / 2). One tile away, a Raft wall fills most of the screen with its
base out of view; ours sits lower and smaller because the tile is wider and the FOV is wider.

Foundation: our 2 m tile is a third wider than Raft's 1.5 m under the same 1.6 m eye, so the deck reads roomier and walls
read squatter. Raft hands sit in the lower right fifth of the screen (estimated from gameplay footage); ours undo FOV
scaling (dist/hands.js:537) so their screen size stays fixed.

## Sources

- https://steamcommunity.com/app/648800/discussions/0/2257934448611363858
- https://www.raftmodding.com/mods/mrwydra-settings
- https://www.raftmodding.com/mods/player-speed-changer
- https://www.raftmodding.com/mods/custommovingspeed
- https://github.com/KenjieDec/CustomMovingSpeed
- https://fearlessrevolution.com/viewtopic.php?p=47979
- https://www.pcgamingwiki.com/wiki/Raft
- https://steamcommunity.com/app/648800/discussions/0/1694922345927047831/
- https://steamcommunity.com/app/648800/discussions/0/1694922980033939107/
- https://steamcommunity.com/app/648800/discussions/0/6364229748855107452/
- https://twitter.com/RaftSurvivaGame/status/1000711881101926405
- https://www.appgamer.com/raft-original-survival-game/answers/2355-how-to-jump-to-raft-when-you-fall
- https://raft.fandom.com/wiki/Solid_Half_Wooden_Wall
- https://raft.gamepedia.com/Half_Wooden_Wall
- https://docs.unity3d.com/Manual/class-CharacterController.html
