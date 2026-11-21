# Spec: Aquarium (Fish Tank)

Source: docs/features/aquarium-research.md. Cozy rules: cosmetic, nothing lost, no feeding, no death. One builder, **no game.js edits**.
A glass tank decor. E while holding a raw `fish` puts a live fish in (max 4), and E with an empty hand lets the newest one out as a plain `fish`.
Fish show as their journal species and swim slowly. Logic goes in `dist/aquarium.js` (pure top half plus `createAquarium(ctx)`). The model goes in `dist/aquarium-model.js` (it is given THREE and imports nothing).
Every new import uses `?build=v3-survival-ae77fa84ac2b` (`tests/live-preload.test.mjs:47-52`), and that includes `fish-models.js` and `fish-species.js` (same as `display.js:8-9`, one cache).

## 1. Item and wiring (all hooks tagged `[aquarium]`)
- `dist/items.js` after the photoframe row (`:283-284`):
  `item('aquarium', 'Fish Tank', 'decor', { placeable: true, iconTint: '#7fc4d4', recipe: hand({ glass: 3, wood: 4 }), unlock: research('glass', 'nail'), tip: 'A little glass tank. Hold a fish and press E to let it swim.' })`.
  The unlock is the photo frame's. Glass comes from the kiln (`kiln-core.js:8`) or the smelter (`items.js:146`).
- `BLOCK_RADII` (`items.js:341-357`): add `aquarium: 0.4, // [aquarium]` after `photoframe`. `PLACEABLE_IDS` (`:338`) then feeds `DECOR_TYPES`/`BLOCK_RADIUS` in game.js on its own.
- `dist/item-svg.js` after the `[display]` block (`:506`): an inline `aquarium` icon (no `icon` key), a wood-rimmed glass box with a pale-blue water band, a small orange fish, two bubbles and a sand strip.
- `dist/craft-book.js`: add `aquarium: 'survival'` to the `[display]` category line (`:27`), and an ITEM_TEXT row after `trophystand` (`:172`):
  `aquarium: { desc: 'A wood-framed glass tank with sand and a little plant.', use: 'Hold a raw fish and press E to add it (up to 4); E with an empty hand lets one out.' }`.
- `dist/content.js`: after `:86` add `import { createAquarium } from './aquarium.js?build=v3-survival-ae77fa84ac2b'; // [aquarium]`. In FEATURES (`:95`) insert `createAquarium` **directly before `createCookpot`** (cookpot stays last) and add `[aquarium]` to the comment. Do **not** add it to `NO_UNDECOR` (`:98`).
- `dist/live.js` PRELOAD (`:17`, first row): add `'aquarium-model.js', 'aquarium.js' /* [aquarium] */`.

## 2. State: `world.ext.aquarium`
```js
{ v:1, s:'ab12cd34', r:5, t:{ "2,-1":[{sp:'salmon', cm:61.4}, {sp:'pomfret', cm:28}], "0,3":[{sp:'tuna', cm:80}] } }
```
- Keys match `/^-?\d{1,3},-?\d{1,3}$/` (copy `display.js:22`), at most `MAX_TILES` 400. Arrays are cut to `CAP` 4, empty arrays are deleted.
- Each entry goes through `cleanFish(e)`, a copy of `cleanTrophy` (`display.js:32`) on `{sp,cm}`: `speciesById(sp)` must exist, and `cm` is clamped to `[minCm,maxCm]` and rounded to 0.1. Bad entries are dropped.
- **Orphans are kept** (a key with no tank is saved and hidden). `cleanAquarium` never prunes against decor. `s` is a session id made as in `display.js:176`.

## 3. Pure API (dist/aquarium.js; no DOM, Date or random)
```js
export const CAP = 4, REACH = 2.6, HOST_SLACK = 2, MAX_FISH = 48, ANIM_R = 10, MAX_TILES = 400;
export const OLD_HOST = 'Your friend’s raft doesn’t have fish tanks yet';
export const TEXT = { stale:'That tank just changed, try again', full:'Your bag is full', tankfull:'The tank is full (4 fish)',
  cooked:'Only live fish can swim', empty:'Hold a raw fish to add it', notarget:'No tank there', bad:'That fish can’t go in' };
export function cleanAquarium(v)            // -> {v:1,s,r,t}; never throws
export function cleanFish(e)                // -> {sp,cm} | null
export function tankAt(decor, x, z)         // -> true when decor has type 'aquarium' at (x,z)
export function add(st, decor, a, bag)      // a = {x,z,from,species,cm,expect:{have:'fish', n}}
export function release(st, decor, a, bag)  // a = {x,z,expect:{n, sp}}
export function undecorLootFor(st, d)       // -> [['fish', n]] or []
// each op returns {ok:true, text, loot?} | {ok:false, reason:'notarget'|'stale'|'full'|'tankfull'|'bad', text}
```
- **All or nothing.** Each op works on `scratch = new bag.constructor(bag.snapshot())` and a copy of the array, checks everything, then commits: copy `scratch.slots` into `bag.slots`, `bag.version++`, write `t[key]`, `st.r++` (copy `commit`, `display.js:84`). A failure changes neither the bag nor the state.
- `add` checks: `tankAt`; `from` is an int slot and `bag.slots[from]?.kind === 'fish'` (else `stale`; a `cookedfish` there gives `bad`/`TEXT.cooked`); the current length equals `expect.n` (else `stale`); length `< CAP` (else `tankfull`); `cleanFish({sp:species,cm})` is not null (else `bad`). It removes exactly 1 `fish` from `from` and pushes `{sp,cm}`. Text: `"<Species> is swimming in the tank"`.
- `release` checks: the length equals `expect.n` and the last entry's `sp === expect.sp` (else `stale`). It pops the last fish (LIFO) and adds 1 plain `fish` to scratch. If it does not fit, it returns `full` and the fish stays. Text: `"+1 Raw Fish (<Species> let out)"`, `loot:{fish:1}`.
- **Species is a cosmetic 1:1 swap.** Only plain `fish` goes in and comes out, so the bag counts balance and nothing can be duped. A spoofed species is only a look, and `cleanFish` still clamps it.

## 4. Client species choice (module, not pure)
- `journal()` = `globalThis.raftFC?.journal` in try/catch (as `display.js:190-195`). The client picks the species, in this order:
  1. the newest `basket` entry with `state === 'raw'` (cm from it);
  2. else the `speciesSeen()` id after `lastAdded` (a module variable, set on send), wrapping around; cm = `entry(id).bestCm`;
  3. else `'pomfret'` at `speciesById('pomfret').minCm`.
- The basket is never touched (it is local and the host cannot see it). The host validates everything in `add`.

## 5. Module `createAquarium(ctx)` (name `'aquarium'`)
- `scanGroups()` copies `display.js:196`: it finds `ctx.raft` children named `craft_aquarium` and rescans when the child count or first child changes. `target(aim)` copies `display.js:213`, using one anchor `aim` (tank centre). It accepts `off <= 0.5`, REACH 2.6, and returns `{x,z,key}`.
- `plan(t)` -> `{html, act | notice}` is shared by `prompt` and `interact`. **Every actionable row starts with `<kbd>E</kbd>`**, so it beats the "Click Eat" tip for a held raw fish (`game.js:786`). Names go through `ctx.esc`.
  1. old host -> `OLD_HOST` (muted; E shows it as a 2400 ms notice and sends nothing)
  2. hand `fish`, count < 4 -> `<kbd>E</kbd>Add <Species> to the tank`
  3. hand `fish`, count 4 -> `<kbd>E</kbd>Tank is full (4 fish)` (notice `TEXT.tankfull`, no action)
  4. hand `cookedfish` -> `<kbd>E</kbd>Only live fish can swim` (notice only)
  5. empty hand, fish in -> `<kbd>E</kbd>Let the <Species> out` (the last entry)
  6. empty tank, empty or other hand -> `Fish tank: hold a raw fish to add it` (muted, E gives `TEXT.empty`)
  7. other item, fish in -> `Fish tank: <n>/4 fish` (muted)
- `interact(aim)`: no target -> false. Otherwise it sends `aquarium.add {x,z,from:bag.selectedIndex,species,cm,expect:{have:'fish',n}}` or `aquarium.release {x,z,expect:{n,sp}}` through `ctx.action`, or shows the notice. Returns true.
- `action(a, actor, bag)`: claims every `aquarium.*` kind (returns true). Ints are checked. Reach is checked against `actor==='guest' ? ctx.other : ctx.physics` with `REACH + HOST_SLACK`. Then the pure op runs, and it emits: add ok `{kind:'build', text, sound:'place'}`, release ok `{kind:'loot', text, loot}`, a failure `{kind: reason==='full' ? 'full' : 'notice', text}`. A `stale` failure bumps `st.r` (double-tap safe).
- `load`/`serialize`: copy `display.js:374-395`. On `'net'`, skip when `r`/`s` are unchanged. `hostHasTank = data !== undefined`. `serialize` is cached by `r` (sent at about 8 Hz). Set `dirty` after any changing load or op.
- **Undecor:** `undecorLoot(d)` -> `d?.type === 'aquarium' ? undecorLootFor(st, d) : undefined`. `game.js:1326-1327` already refuses the pickup when the fish do not fit the bag. `afterUndecor(d)`: if `t[key]` exists, delete it, `st.r++`, `dirty = true` (as `bees.js:212`). With the hammer the tank comes back with its fish as plain `fish`.
- `decorModel(type)`: `'aquarium'` -> `createAquariumModel(T)` from the model file, else null (reached through `game.js:654`, so it also feeds the ghost).
- `debug`: `{state, target, fish: () => count of attached tank fish, place(x,z)}`.

## 6. Model (dist/aquarium-model.js) `createAquariumModel(T)`
- Group `craft_aquarium`, origin at the floor top, about 0.9 × 0.7 × 0.5. It has a low wooden base (0.12 tall) and four corner posts plus a top rim (wood #a8763f / #8a6136), merged into one vertex-coloured mesh with a tiny local merge (as display-model.js).
  Inside: a sand slab (#e8d3a0, y .12-.17), a little plant (3-4 tapered green blades, #4f9e5a), a pink spiral-ish shell (a squashed cone, #f0b6a8), and a water box (#7fc4d4, opacity .18).
- **Glass:** one module-level `MeshStandardMaterial({color:0xdff4f8, transparent:true, opacity:.25, roughness:.05, depthWrite:false})` with `userData.shared = true`, made once and reused by every tank. The four panes and the water box get `renderOrder = 2` and `castShadow = false`, so they draw after the fish (renderOrder 0).
- **Bubbles:** 3 small spheres (one shared geometry/material, flagged shared) named `bubble0..2`. They rise from the plant in a loop of about 3 s, in `update` only while animating.
- Direct children: `aim` (an Object3D at the tank centre) and `swim` (a Group, the fish parent, with its box half-extents in `userData.box = {x:.33,y:.16,z:.15}`, centre y .38).

## 7. Fish and animation
- Each fish is `createFishModel(T, sp, {cm, lod:0})`, scaled so its length is `min(0.18, cm/100 * 0.4)` (via `userData.length`), with `castShadow=false`. Then `markShared(fish)` (copy `display.js:169`) on every one, or `rebuildRaft`'s `disposeGeometry` (`game.js:417`) frees the shared fish cache.
- `paint()` (copy the budget in `display.js:352`): tanks are sorted by distance to the player, and at most `MAX_FISH` 48 fish are attached in all. A tank past the budget shows an empty tank (the prompt still works). It repaints only when the raft changed or `dirty` is set.
- `update(dt)`: every 0.5 s, mark tanks within `ANIM_R` 10 m of `ctx.physics` as near. Only near tanks swim: fish i uses `x = bx*.85*sin(t*w+φ)`, `z = bz*.7*sin(t*w*1.3+φ2)`, `y = .04*sin(t*.9+φ)`, with `w` 0.25-0.45 from a hash of key+i. The heading comes from the velocity (`atan2`), plus `wiggle(g, t, .4)` (`fish-models.js:543`). Bubbles also move only when near. Far tanks are static.
  Scratch vectors are reused, and nothing is allocated per frame.
- `dispose()` detaches fish and disposes only the glass and bubble materials made by this module.

## 8. Co-op and OLD_HOST
- Host-authoritative. A guest's E sends `aquarium.*`, the host validates it against `ctx.actorBag`/the passed `bag` and `ctx.other` for reach, and the guest's bag returns in the state message. The species is the guest's own local choice, clamped by the host.
- New guest, old host: `ext.aquarium === undefined` from `'net'` -> `OLD_HOST` for the prompt and the notice (copy `juicer.js:12,211,218`). No action is sent, and tanks paint empty.
- Old guest, new host: it drops the unknown decor and the slice. Mixed-version co-op is unsupported; say so in the PR.

## 9. Save compatibility
- An old save has no slice, so `cleanAquarium(undefined)` gives an empty default. An old build drops the decor in `cleanWorld` (`game.js:208`), and the slice survives through `cleanExt`. Fish come back hidden (orphan rule) when a tank is placed on that tile again.
- Size: 400 × 4 small entries is about 25k chars, under `EXT_MAX`.

## 10. tests/aquarium.test.mjs (node:test, `RAFT_DIST` base and `bagWith` as `bees.test.mjs:7,16-19`)
1. `cleanAquarium`: junk gives defaults; bad keys and species are dropped; cm is clamped; arrays are cut to 4; orphans are kept.
2. `add`: the fish count goes down by 1 and the tank gains `{sp,cm}`. A full tank gives `tankfull`, a wrong `expect.n`/`have` gives `stale`, `cookedfish` gives `bad`, a bad species gives `bad`, and a non-tank tile gives `notarget`. Every failure leaves the bag snapshot and state `deepEqual` to before.
3. `release`: it is LIFO, the bag gets +1 `fish`, and a full bag gives `full` with the fish still in. A wrong `expect.sp` gives `stale`. add then release balances the bag exactly.
4. Undecor: `undecorLoot` gives `[['fish',3]]` for 3 fish and `undefined` for other types. `afterUndecor` deletes the key and bumps `r`.
5. Module (stub ctx): every `aquarium.*` returns true. Out-of-reach or non-int actions change nothing. `load(same,'net')` keeps identity, `serialize` is cached by `r`, and `load(undefined,'net')` makes `OLD_HOST` the prompt with no action sent. Every action prompt starts with `<kbd>E</kbd>`.
6. Species pick: basket raw first, then the seen-cycle, then pomfret (a stub `globalThis.raftFC`).
7. Model: `createAquariumModel` has `aim` and `swim`, fits 1.0 × 0.8 × 0.6, and two tanks share one glass material with renderOrder 2. After a `disposeGeometry` copy that skips shared, fish geometry is not disposed. 15 full tanks attach at most 48 fish.
8. items: `aquarium` crafts from glass and wood, is in `PLACEABLE_IDS`, and has an icon and an ITEM_TEXT row. Run `npm test` and `shoot.py` (`errors: []`).

## 11. Files
New: `dist/aquarium.js`, `dist/aquarium-model.js`, `tests/aquarium.test.mjs`. Hooks: `dist/items.js:284` (row) and `:352` (radius), `dist/item-svg.js:506` (icon), `dist/craft-book.js:27` and `:172`, `dist/content.js:86` (import) and `:95` (FEATURES before cookpot), `dist/live.js:17` (PRELOAD).
