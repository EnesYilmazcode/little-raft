# Music Box: research

A craftable wind-up Music Box decor for the raft. It is a small wooden box with shell inlay and an open lid, and
inside it a brass cylinder turns against a comb. E starts or stops it. Right-click, or a second E within 1 s, moves
to the next of 5 original tunes. The tunes are composed in code from a seed, the sound is synthesised, and both
co-op players hear the same bar.

## 1. How other games handle music players

- **Survival-craft and cozy games.** Raft-likes have a placeable radio or record player that plays a few found
  tracks as positional decor, and other survival games use jukeboxes or phonographs. Farming and life sims have a
  jukebox or music box that swaps the area's track. The good ones stay quiet and duck under game sounds.
- **Common patterns.** Positional source with distance fade, cycle tracks, state persists, one source at a time,
  its own volume slider.
- **Our version (original).** There are no audio files and no existing melodies. Each of the 5 tunes comes from
  `seed -> mulberry32` and a scale (major pentatonic, or major for 1 or 2 of the tunes). A tune is 4 bars of 8 steps:
  melody = random walk on scale degrees (steps of 1 or 2 favoured, bars end on degree 0, 2 or 4); bass = root then
  fifth on beats 1 and 3, an octave or two lower; 84 to 112 BPM, so one loop is about 8 to 11 s.
- **Timbre.** A plucked comb tooth: a sine fundamental, plus about 0.3 of a partial near 3x and about 0.12 near 6.2x
  (slightly inharmonic like a real tine), with a 2 ms attack and an exponential decay of 0.6 to 1.4 s (higher notes
  decay faster). A tiny noise tick under 10 ms adds the "tink". All of this reuses the helpers already in audio.js.

## 2. How Little Raft hosts it

**Audio graph (`dist/audio.js`)**
- `createOceanAudio` (48) creates the context lazily in `resume()` (500-516) with `latencyHint:'interactive'`.
- Bus graph in `buildGraph()` (92-111): `effects` / `ambience` / `music` gains feed the `tone` low-pass (6500 Hz,
  97-98), then `master`, then the `limiter`, then the optional diving `output` (103).
- `BUSES` (30) already includes `music`. `level.music` defaults to 0.7 (50), and `busGain('music')` scales it by 0.6 (91).
- `setMusic` (531-537): pad and pluck bed, off by default; nothing in game.js turns it on (only `raftDebug.audio`, 2268).
- **Helpers** (182-239): `newVoice / finishVoice / startSource / gain / filter / env / osc / tone(v,t,type,f,peak,att,dec) / burst`.
  Voices clean up on `onended`, no DOM timers, `MAX_VOICES = 24` (33).
- **`MIN_GAP`** (34-38) only gates `play(event)` (558). `note()` (565-587) has its own rules:
  - a 50 ms gap per instrument (573) and at most 10 live instrument voices (575-577);
  - the steps are fixed `NOTE_HZ` D4 to F#5 (43);
  - it always schedules at `ctx.currentTime + 0.005` (582), so it **cannot schedule ahead**;
  - it plays on the effects bus (579).
- The existing `pluck` recipe (460-465) is the nearest timbre to what we want.
- **Needed: a new `box(hz, when, s)` export.**
  - Validate a finite `hz` from 80 to 2000 and `when` from `currentTime` to `currentTime + 1`, and clamp `s` to 0..1.
  - Route it to `graph.music` and tag it `v.box`. Cap live box voices at about 8 so effects never lose voices
    from the shared 24.
  - Return false when `!ready()` (539).
  - Also add a `get now()` returning `ctx.currentTime`, or null, so the module can schedule against it.
- **Ducking.** There is none today. Add a `duck` GainNode between `graph.music` and `tone`. In `play()` after 559,
  `setTargetAtTime(.45, now, .03)`, then back to 1 at `now + .25` (time constant 0.4). No timers needed.

**Settings (`dist/settings.js`)**
- The audio tab has `sound`, `volume`, `effects` and `ambience` (27-31). **There is no music slider.**
- game.js `applyVolume` (315) sets master, effects and ambience only. `onChange` (2469) calls `applyOptions` and
  `setAmbience`.
- Add `music: {tab:'audio', label:'Music', type:'range', ..., def:0.7}` after 31 and `sfx.setBus('music', options.music ?? .7)`
  in `applyVolume`. `validateSettings` fills new `SPEC` keys with defaults, so old prefs are fine.

**How instruments.js plays notes**
- `host.note(i, n, s)` (5, 145, 161) goes to game.js `note` (314) and then `sfx.note`.
- Network messages are rate-gated (`rateGate` / `windowGate`, 41-59).
- `distanceGain(d)` (62-66) is a linear falloff over `HEAR_RANGE = 30` with a 0.15 floor. Reuse its shape, but
  with no floor: 1 within 1.5 m, falling to 0 at about 14 m.
- **Pooled sprites** (69, 109-130, 166-181): `FX_MAX = 6`, faded ones reused from `free`, no per-frame allocation.
  Copy this for 2 to 3 note glyphs rising from a playing box (`glyphTexture`, 71-95).
- **Content ctx gap.** `contentCtx` (game.js:441-457) exposes `play` (446), `note` (453), `camera` and `world`,
  but not `sfx`. Add `get audio() { return sfx; }`, or a narrow `box: (hz, when, s) => sfx.box?.(hz, when, s)`
  plus `audioNow: () => sfx.now ?? null`, with a `// [musicbox]` tag.

**Content registry (`dist/content.js`)**
- The module shape and hooks are documented at 7-49 and in `docs/features/content-hooks.md`.
- Import the module and add `createMusicBox` to `FEATURES` (91).
- Hooks to use: `name:'musicbox'`, `serialize` / `load` (13-14), `action` (15, host only), `interact` (16, E),
  `prompt` (17), `alt` (25, right-click), `decorModel` (19), `update` (9), `afterUndecor` (40), `dispose`.
- `alt` is reached from game.js:1842 only when the held item is not the hammer, because the hammer's right-click
  opens the build wheel (1841). Because of that, the "second E within 1 s" path matters.
- E routing: `interact()` at game.js:1373-1390 reaches `content.interact` at 1387, after pickups, sails, watering
  and building hatches.

**Items (`dist/items.js`)**
- Add `item('musicbox', 'Music Box', 'decor', {placeable:true, iconTint:'#b4824b', recipe:hand({wood:3, nail:1,
  shell:2, scrap:1}), unlock:discover('shell'), tip:...})` next to the `[display]` / `[camera]` decor (253-262).
  Pick a cost that uses `shell` (content-items.js:55) and `nail`.
- Add `musicbox: 0.2` to `BLOCK_RADII` (315-330).
- `PLACEABLE_IDS` makes it placeable on its own (game.js:49, 80).
- game.js:635 falls through to `content?.decorModel(d.type, d)`, so the model comes from the module, as photo-frame
  does at 219-223.
- Use items.js, not content-items.js. content-items.js is the older `CONTENT_DECOR` path (143-144).

**Icon and craft book**
- `dist/item-svg.js`: add `musicbox:` to `ITEM_ICONS` (10) with the palette in lines 2-3 (wood `#bb8650`, cream
  shell inlay, amber `#ffbd66` crank, open lid with a comb). Examples: `shelf` (464), `photoframe` (199).
- `dist/craft-book.js`: `musicbox: 'survival'` in `CATEGORY_OF` (14-56, next to `shelf` at 27), and `ITEM_TEXT` (57)
  `{desc:'A shell-inlaid box with a tiny turning cylinder.', use:'E to play; right-click or E twice: next tune.'}`.

**Pickup (`docs/specs/decor-pickup.md`, game.js:1273-1288)**
- Leave it out of `NO_UNDECOR` (content.js:94): it stores no items. No `beforeUndecor` veto; pickup just stops it.
- Add `afterUndecor(d)`: for `musicbox`, delete `st.b[key]` and `rev++` (pattern: bees.js:190, kiln.js:198).
- Also prune by decor tiles in `serialize` / `load`, like photo-frame.js `cleanFrames(data, decor)` (22-37).

**Persistence and co-op**
- The slice is `world.ext.musicbox = {v:1, r, b:{"x,z":{on:0|1, t:0..4, s:<start clock>}}}`, capped at about 16
  boxes and well under `EXT_MAX = 200000` (content.js:95). Old saves get `load(undefined)` and fall back to defaults.
- The host serialises `ext` in every state message, about 8 per second (content-hooks.md "Co-op"). Cache
  `serialize` on `rev` the way photo-frame.js:169-176 does.
- Guest E or right-click goes through `ctx.action({kind:'musicbox:set', key, on, t})`, the same as photoframe
  (180) and fireworks (243). The host validates the tile, updates `st`, sets `s = clock` and bumps `rev`.
- **Shared clock: use `STORM_LIVE.clock`** (daynight.js:34, written every frame at 686).
  - storm.js:5 and 133 already read it.
  - The host advances it, and the guest follows with `driftStep` (188-198), snapping past `SNAP_SECONDS = 5` (16).
    animals.js uses the same idea (`snap`, 522-526).
  - The bar position is `(clock - s) mod loopLen`. Store `s` in **daynight clock seconds**, not wall time, so a save
    reloads in phase and the guest needs no extra messages.
- **Clock jumps** (sleep's `skipClock`, 25, or a snap): if `|clock - expected| > 0.25 s`, re-anchor at the next bar.

## 3. Risks and mitigations

- **Drift and jitter.** game.js clamps frame `dt` to 0.05 (1750), so below 20 fps the game clock runs slower than
  real time. Fix this by scheduling in **AudioContext time**:
  - In `update()`, schedule every step whose time falls in `[now, now + 0.15 s]`, so the tempo stays steady.
  - Use the shared clock only to place the anchor (`ctxAnchor = ctx.now - phase`). Re-check it about once per loop,
    and re-anchor at a bar line if the error is over about 120 ms.
  - Never use `setTimeout`.
- **Hidden tab.** rAF stops, so no new notes are queued; at most 0.15 s already scheduled plays out. On
  `visible` (game.js:1944-1946) re-anchor and skip missed steps. A suspended context makes `ready()` (539) false.
- **CPU.** One note is about 4 nodes and 3 oscillators; 4 to 8 steps/s with tails of 1.4 s or less means about 8
  live box voices. The `v.box` cap protects effects in `MAX_VOICES`; preallocate step arrays per tune.
- **Several music boxes.** Only the **nearest audible box** plays locally. If you want two, cap it at 2, but they
  would clash out of phase. All boxes that are on keep their state and their spinning-cylinder animation, and the
  others are silent. Use a hysteresis of about 1 m so the source doesn't flip back and forth between two boxes.
- **Autoplay policy.** Already handled: pointerdown and keydown call `sfx.resume()` (game.js:1897-1898), `setSound`
  resumes (1978), a hot swap reuses the context (316), and E itself is a gesture. A box saved as on stays silent
  until the first input, then joins in phase.
- **Volume.** With master 0.5 the music bus comes out at 0.42. Keep box peaks around 0.12 to 0.18, and test it
  with the diving low-pass `output` (103) and the 6.5 kHz `tone`.
- **Save compatibility.** A new `ext` key is ignored by older builds, because `cleanWorld` keeps `ext` and an older
  module set doesn't read `musicbox`. An old build does reject the unknown `musicbox` kind in a bag snapshot
  (content-items.js:4), which is the same trade-off every new item has.
- **Old host or new guest.** An old host's `action()` ignores `musicbox:set` (content.js:142); show a gentle notice
  when no slice arrives. The guest can't craft or place the box there anyway (unknown recipe).
- **Stop and next-tune race.** Instant toggling makes a double-E stop then restart; instead send `{on:1, t:t+1}`
  when a second E lands within 1 s (delay the local stop by 1 s). The host applies the last action.
- **Copyright.** The melodies come only from seeded walks. Add a test that checks no two tunes share their first
  8 steps, and keep a list of seeds in the spec.
