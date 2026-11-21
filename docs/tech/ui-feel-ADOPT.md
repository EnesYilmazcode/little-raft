# Adopting ui-feel in dist/

Checked against the current `dist/` on `claude/raft-tech` (merged main **8d21618**): `dist/game.js` 2284 lines
(`HOTBAR = 10`), `dist/survival-ui.js` 1309 lines, `dist/live.js` 382 lines, build token
`v3-survival-ae77fa84ac2b`. Line numbers are from that version. Every block below is applied literally by
`sandbox/ui-feel/realgame.py`, which fails if any `-`/context text does not occur exactly once, or if
`dist/game.js` is not the 2284-line base named here (re-check this doc first, then bump the number). The anchors
were also re-checked against main 912d941 (round 5, which landed while this was written): all 11 blocks match
there too, since none of them touches a line round 5 changed.

## What ships and what does not (retarget decisions)

Main grew its own HUD feedback after ui-feel was written. ui-feel now adds only what main does not have, and
never draws a second version of something main already draws:

| Feature | Main today (8d21618) | ui-feel in the game |
|---|---|---|
| Text feedback for loot / craft / notices | `pickup-feed.js` (bottom-left rows with 3D icons, merging, `notice()` routes into it), `prompts.js` `#lrFeed`, `coop-feed.js` | **Off** (`toasts:false`). The pickup feed stays the one text feed, unchanged, with its tests. No `#uf-toasts` popover is created. |
| Hotbar selection cursor + name tag | survival-ui `.sv-cursor` + `.sv-label` on the 10-slot bar | **Off** automatically (`hotbarCursor:'auto'` sees `.sv-cursor`). |
| Slot bump when a count grows | survival-ui `sv-bumpA/B` on paint | Kept as main's. ui-feel only **delays** it for a slot an icon is flying to (see next row). |
| Loot flying into the slot | none | **On**: icons pop out of the reticle and fly to the slot (or the bar's top edge when the item went to the backpack). The slot keeps its old count, and an empty slot stays blank, until the icon lands; then main's bump plays plus a gold ring. The icon is the slot's own 3D art, else `iconURL(kind)` (the same cached 3D render the pickup feed uses), else `iconSVG(kind)` while that render is pending: never empty. |
| Reticle dot, hover growth | `graphics.css:328-330`: a 4 px soft dot; `#crosshair.usable` grows it to 8 px over interactables (`updateContext`, game.js:746) | **Main's, untouched.** ui-feel runs with `reticle:'markers'`: it does not add `.uf-xh`, does not resize, restyle or replace the dot, and has no per-frame hook. |
| Throw charge | `#chargeMeter`, a 28 px conic ring around the reticle (`graphics.css:315`, `updateCharge`) | **Main's, untouched.** ui-feel's charge arc is not used in the game and `#chargeMeter` is not hidden. |
| Hit markers | none | **On**, the one reticle feature main lacks: four short ticks around the dot, `gold` on a loot pickup / hook catch, cream `hit` on **your own** build, red `deny` on bag full, plus a 240 ms pop (or shake for deny) of main's dot through the independent `scale`/`translate` properties (main's `transform:translate(-50%,-50%)` centring is never written). |
| Inventory open / close motion, press states | instant open, hover colours | **On** (pure CSS). Press states skip a slot that is being dragged (`.sv-dragging`, `.sv-src`, `.sv-over`). |
| Recipe flash on craft | none | **On** (`crafted(kind)` finds the row by `data-recipe` or `data-tip-kind`). |
| Health / food / water bars | `vitals-ui.js` `#lrVitals`, bottom-left: `.25s` fill transition, `lv-low` pulse, damage flash + vignette | **Main's, not wired** (see §3). |

**Why defer on the reticle.** Main chose a deliberately minimal Raft-style dot with a single conic charge ring,
and both already answer "can I use this?" and "how hard will I throw?". ui-feel's ring + dot + arc would replace
that design with a busier one for no new information, and (round 2) its 40 px box picked up main's dot
`box-shadow` as a grey square. The only thing main's reticle does not say is "that landed": the hit markers.
The standalone sandbox still shows the full reticle (`reticle:'full'`, the default), and `#crosshair.uf-xh` now
resets main's `box-shadow`, `background`, `filter`, `transition` and `.usable` size, so even the full mode draws
no square on this dist.

Nothing is removed from main: `pickupFeed.add/note` still run for every effect exactly as before, so
`tests/survival.test.mjs` (pickup-feed cases) and `raftDebug.state.feed` are untouched.

## 1. Add the module

<!-- copy: sandbox/ui-feel/ui-feel.js -> ui-feel.js -->
```
cp sandbox/ui-feel/ui-feel.js dist/ui-feel.js
```

No imports. It injects `<style id="ui-feel-style">` itself (removed again by `destroy()`), so `live.js` needs no
`CSS_FILES` edit. It adds `#uf-layer` (fly icons, rings; `position:fixed`, `z-index:6`, `pointer-events:none`)
and, with `reticle:'markers'`, one `.uf-x-hit` element inside `#crosshair` (shown over main's
`#crosshair>*{display:none}` by a more specific rule). With `toasts:false` it adds no popover and no
`<dialog>`, so `dialogOpen()` / `uiBlocked()` / Escape handling are unaffected.

## 2. dist/live.js: preload it

`tests/live-preload.test.mjs` requires `PRELOAD` to equal game.js' static import graph. Add the module on its
own line (alphabetical position, and a line round 5 did not touch):

<!-- apply: live.js -->
```diff
+  'ui-feel.js',
   'vitals-ui.js', 'vitals.js', 'waterfx.js', 'watering.js', 'wildlife-models.js', 'wildlife.js', 'wood.js',
```

## 3. dist/game.js

### 3a. Import (line 55)

`iconSVG` (survival-ui) and `iconURL` (item-icons, line 59) are already imported; only `createUIFeel` is new:

<!-- apply: game.js -->
```diff
 import { createSurvivalUI, iconSVG } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
+import { createUIFeel } from './ui-feel.js?build=v3-survival-ae77fa84ac2b';
```

Same `?build=` token as every other import; the release script rewrites them together.

### 3b. State (line 283)

<!-- apply: game.js -->
```diff
-  let survivalUI = null, settingsController = null, options = {...SETTINGS_DEFAULTS};
+  let survivalUI = null, uiFeel = null, settingsController = null, options = {...SETTINGS_DEFAULTS};
```

### 3c. Create it after the survival UI (line 2258)

<!-- apply: game.js -->
```diff
     prog.installUI(); // [progression-hook]
+    try { uiFeel = createUIFeel({getBag:() => localBag(), hotbarSize:HOTBAR, toasts:false, reticle:'markers', // ui-feel: docs/tech/ui-feel-ADOPT.md
+      iconHTML:k => { const u = iconURL(k); return u ? `<img src="${u}" alt="">` : iconSVG(k); }}); }
+    catch (e) { uiFeel = null; console.error('ui-feel failed', e); } // purely cosmetic: never block the game
```

It must come after `createSurvivalUI` (which fills `.tools` and creates `dialog#inventory`). `getBag` picks the
slot a picked-up item lands in before survival-ui repaints. A flying icon uses the slot's own art (the 3D icon
the bar shows); `iconHTML` covers an item that is not in the bar yet (backpack-bound, first of its kind, a
guest's generic flight). `iconURL` is main's cached 3D icon (`null` while it renders, and it queues the render),
so the fallback is survival-ui's SVG for that kind. Round 2 called `getItemIcon` here, which game.js no longer
imports: the ReferenceError was swallowed and every such flight flew as a bare `+N`.

### 3d. Dispose (line 2224)

<!-- apply: game.js -->
```diff
     try { survivalUI?.destroy?.(); } catch {}
+    try { uiFeel?.destroy(); } catch {} uiFeel = null;
```

A live hot swap also works without this: a new `createUIFeel` destroys the previous instance through
`window.__littleRaftUIFeel` (the survival-ui pattern).

### 3e. Effects: `effect(e)` (line 1016) and a guarded `feelEffect` (before `collectBottle`, line 1024)

<!-- apply: game.js -->
```diff
     if (prog?.effect(e)) return; // [progression-hook]
+    if (uiFeel) feelEffect(e); // ui-feel: loot flies into the hotbar, reticle markers; the feed below is unchanged
```

<!-- apply: game.js -->
```diff
+  // ui-feel. Never throws into effect() (false on error); the pickup feed and the sound still run after it.
+  // The hit marker means "your action landed": a build effect only marks it for the player named in e.by.
+  function feelEffect(e) {
+    try {
+      if (e.kind === 'loot' && e.loot && typeof e.loot === 'object') {
+        const items = Object.entries(e.loot).filter(([k, n]) => ITEM_INFO[k] && isInt(n) && n > 0).map(([kind, count]) => ({kind, count}));
+        if (!items.length) return false;
+        uiFeel.pickup(items); uiFeel.crosshair.hit('gold'); return true;
+      }
+      if (e.kind === 'craft' && e.loot && typeof e.loot === 'object') return uiFeel.crafted(Object.keys(e.loot)[0]);
+      if (e.kind === 'build') { if (e.by !== (role === 'guest' ? 'guest' : 'host')) return false; uiFeel.crosshair.hit('hit'); return true; }
+      if (e.kind === 'full') { uiFeel.crosshair.hit('deny'); return true; }
+      return false;
+    } catch (err) { console.error('ui-feel effect failed', err); return false; }
+  }
   function collectBottle(i, a, bag, actor) { // no bag space needed; does not count toward world.collected
```

`effect()` runs on whichever machine the event is for: on the host directly, on a guest through the
`data.type === 'effect'` branch. Loot, craft and full are emitted to the actor only, so they mark the right
player as they are. `crafted()` takes only a string (anything else returns false) and looks it up with
`CSS.escape`, so a hostile `kind` from the network cannot throw out of `querySelector`. Every public ui-feel
method is also guarded inside the module (logs, returns false).

### 3f. Name the builder on the build effects that go to both players

`build` is emitted to `'all'` for a floor/decor placement (line 1137) and a building piece (line 1143). Without an
owner the partner's reticle would flash a hit marker for your build. Add `by:actor` (additive: an older peer
ignores it, `coop.encode` passes effects through untouched, and an effect without `by` never marks):

<!-- apply: game.js -->
```diff
-      rebuildRaft(); fitShadow(); emit({kind:'build', text:placedText ?? (a.recipe === 'floor' ? 'A little more room!' : `${ITEM_INFO[a.recipe].name} placed`), sound:a.recipe === 'floor' ? 'build' : 'place'}, 'all');
+      rebuildRaft(); fitShadow(); emit({kind:'build', text:placedText ?? (a.recipe === 'floor' ? 'A little more room!' : `${ITEM_INFO[a.recipe].name} placed`), sound:a.recipe === 'floor' ? 'build' : 'place', by:actor}, 'all');
```

<!-- apply: game.js -->
```diff
-      if (r.ok) emit({kind:'build', text:r.text}, 'all'); else if (r.text) emit({kind:'notice', text:r.text}, actor);
+      if (r.ok) emit({kind:'build', text:r.text, by:actor}, 'all'); else if (r.text) emit({kind:'notice', text:r.text}, actor);
```

And the hook repair (line 1167, actor only):

<!-- apply: game.js -->
```diff
-      bag.slots[i].durability = MAX_HEALTH; emit({kind:'build', text:'Hook repaired!', sound:'repair'}, actor);
+      bag.slots[i].durability = MAX_HEALTH; emit({kind:'build', text:'Hook repaired!', sound:'repair', by:actor}, actor);
```

The signal-cache `build` (line 1108) goes to the *other* player and has no `by`, so it shows in their feed with
no marker, as intended. (Main 912d941 adds a hatch/gate `piecetoggle` build emit to `'all'` without `by`: it
correctly gets no marker on either side; add `by:actor` there too if a marker is wanted for it.)

### 3g. No per-frame hook

Round 2 added `uiFeel.crosshair.hover(...)` / `.charge(...)` after the context line (now line 1621,
`refreshPointerUI(); updateCharge(); updateContext(dialog); updateSignalHud(); updateNotices(dialog); warmKinds();`).
With `reticle:'markers'` both are no-ops (main's `.usable` and `#chargeMeter` do that job), so that line is
**not** edited and ui-feel has no code in the frame loop at all.

### 3h. Gold marker on a catch (line 1535, `updateHook`)

<!-- apply: game.js -->
```diff
-    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) play('catch'); lastCaughtCount = caught.length; }
+    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) { play('catch'); uiFeel?.crosshair.hit('gold'); } lastCaughtCount = caught.length; }
```

(`crosshair.hit` is guarded inside the module and returns false on error.)

## 4. Stat bars: not wired (main's vitals bars stay as they are)

Main now ships health / food / water in `vitals-ui.js` (`#lrVitals`, bottom-left above the feeds). It already has
the feel ui-feel's `statBar` was written for: a `.25s` transform fill, a pulsing `lv-low` row, a damage flash and
vignette, and DOM writes only on a rounded change. ui-feel's remaining extra is the delayed lag trail on damage.
Driving `#lrVitals` with it would mean inserting a trail node into another module's `.lv-track` and fighting its
`transition` on the same fill, which is not clean, so it is **not** adopted. If it is wanted later, it belongs in
`vitals-ui.js` itself (one extra `<i>` per track, transformed with a 420 ms delay on a drop). `uiFeel.statBar`
stays available for a host without bars, and the sandbox still demos it.

## Standalone toasts (not used by the game)

`createUIFeel({toasts:true})` (the default) adds the `#uf-toasts` stack for hosts without a feed. It is a
`popover="manual"` in the top layer and is re-shown after every `fullscreenchange` and every `<dialog>` that
opens, so it stays above a fullscreen `<html>` and above modal backdrops. While a modal dialog is open it moves
where the dialog leaves room: beside it when the right gap fits the 230 px column, otherwise into the larger of
the top/bottom gaps, capped at the 1-2 rows that fit. The sandbox shows it with `?toasts=1`.

## Verify

0. `python sandbox/ui-feel/realgame.py` copies `dist/` to a temp folder, applies every block above (each must
   match exactly once; game.js must be the base named at the top), boots the game, lands a real pickup (hook
   catch, or the same `collect` action through a scratch-only QA hook), freezes the fly mid-air and asserts every
   flying icon has non-empty art, crafts through the real buttons (topping the bag up with
   `raftDebug.give('leaf', 2)` if nothing is craftable, and failing if no recipe flashed), opens the inventory at
   1280 and 1024 px, checks main's reticle is untouched (4 px dot, `#chargeMeter` shown while charging, no
   `.uf-xh`), enters fullscreen through Pause > Graphics, checks the build marker for the partner vs yourself and
   the guards, writes `sandbox/ui-feel/shots/rg-*.png` plus JSON, and exits 1 if any check failed.
1. `python sandbox/ui-feel/shoot.py` prints `"errors": []`.
2. Tests: `node --test tests/*.test.mjs` with `RAFT_DIST=<patched copy>/dist` (realgame.py `--patch-only --keep`
   prints it) and without; the results must match (including `tests/live-preload.test.mjs`).
3. In the game: hook a barrel. Icons pop out of the reticle and fly into their slots; each slot keeps its old
   count until its icon lands, then bumps; four gold ticks flash around the dot. The bottom-left feed shows
   `+3 Plank` etc. as before. Hold click: main's conic ring fills. Point at a supply: main's dot grows. Tab: the
   panel pops in; craft rope and the recipe row flashes. Turn on "Emulate prefers-reduced-motion: reduce": fades only.
