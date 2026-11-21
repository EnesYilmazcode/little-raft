# Adopting ui-feel in dist/

Checked against the current `dist/` on `claude/raft-tech` (3c62305, = main): `dist/game.js` 1780 lines,
`dist/survival-ui.js` 1071 lines (sv3), build token `v3-survival-ae77fa84ac2b`. Line numbers are from that
version; every block below is applied literally by `sandbox/ui-feel/realgame.py`, which fails if any `-`/context
text does not occur exactly once.

## What ships and what does not (retarget decisions)

Main grew its own HUD feedback since ui-feel was written. ui-feel now only adds what main does not have, and
never draws a second version of something main already draws:

| Feature | Main today | ui-feel in the game |
|---|---|---|
| Text feedback for loot / craft / notices | `pickup-feed.js` (bottom-left rows with 3D icons, merging, `notice()` routes into it), `prompts.js` `#lrFeed`, `coop-feed.js` | **Off** (`toasts:false`). The pickup feed stays the one text feed, unchanged, with its tests. No `#uf-toasts` popover is created. |
| Hotbar selection cursor + name tag | survival-ui sv3 `.sv-cursor` + `.sv-label` | **Off** automatically (`hotbarCursor:'auto'` sees `.sv-cursor`). |
| Slot bump when a count grows | survival-ui `sv-bumpA/B` on paint | Kept as main's. ui-feel only **delays** it for a slot an icon is flying to (see next row). |
| Loot flying into the slot | none | **On**: icons pop out of the reticle and fly to the slot (or the bar's top edge when the item went to the backpack). The slot keeps its old count, and an empty slot stays blank, until the icon lands; then main's bump plays plus a gold ring. |
| Reticle hover / charge arc / hit markers | static ring (graphics.css) + `#chargeMeter` bar beside the prompt | **On**: hover grows the ring, charge draws an arc, `gold` on a catch / pickup, `hit` on **your own** build, `deny` on bag full. |
| Inventory open / close motion, press states | instant open, hover colours | **On** (pure CSS). Press states skip a slot that is being dragged (`.sv-dragging`, `.sv-src`, `.sv-over`). |
| Recipe flash on craft | none | **On** (`crafted(kind)` finds the row by `data-recipe` or `data-tip-kind`). |
| Stat bars | game has no health/hunger/thirst | Available (`statBar`), not wired. |

Nothing is removed from main: `pickupFeed.add/note` still run for every effect exactly as before, so
`tests/survival.test.mjs` (pickup-feed cases) and `raftDebug.state.feed` are untouched.

## 1. Add the module

<!-- copy: sandbox/ui-feel/ui-feel.js -> ui-feel.js -->
```
cp sandbox/ui-feel/ui-feel.js dist/ui-feel.js
```

No imports. It injects `<style id="ui-feel-style">` itself (removed again by `destroy()`), so `live.js` hot swaps
need no `CSS_FILES` edit. It adds `#uf-layer` (fly icons, rings; `position:fixed`, `z-index:6`,
`pointer-events:none`) and builds four `.uf-x` parts inside `#crosshair`. With `toasts:false` it adds no
popover and no `<dialog>`, so `dialogOpen()` / `uiBlocked()` / Escape handling are unaffected.

`survival-ui.js` needs no change: it already exports `iconSVG` (line 1071).

## 2. dist/game.js

### 2a. Imports (line 47)

<!-- apply: game.js -->
```diff
-import { createSurvivalUI } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
+import { createSurvivalUI, iconSVG } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
+import { createUIFeel } from './ui-feel.js?build=v3-survival-ae77fa84ac2b';
```

Same `?build=` token as every other import; the release script rewrites them together. `getItemIcon` is
already imported (line 51).

### 2b. State (line 242)

<!-- apply: game.js -->
```diff
-  let survivalUI = null, settingsController = null, options = {...SETTINGS_DEFAULTS};
+  let survivalUI = null, uiFeel = null, feelFailed = false, settingsController = null, options = {...SETTINGS_DEFAULTS};
```

### 2c. Create it after the survival UI (line 1757)

<!-- apply: game.js -->
```diff
     prog.installUI(); // [progression-hook]
+    try { uiFeel = createUIFeel({getBag:() => localBag(), hotbarSize:HOTBAR, toasts:false, // ui-feel: docs/tech/ui-feel-ADOPT.md
+      iconHTML:k => { const u = getItemIcon(k); return u ? `<img src="${u}" alt="">` : iconSVG(k); }}); }
+    catch (e) { uiFeel = null; console.error('ui-feel failed', e); } // purely cosmetic: never block the game
```

It must come after `createSurvivalUI` (which fills `.tools` and creates `dialog#inventory`). `getBag` is only
used to choose the slot a picked-up item lands in before survival-ui repaints. A flying icon uses the slot's own
art (the 3D icon the bar shows); `iconHTML` is the fallback for an item that is not in the bar yet.

### 2d. Dispose (line 1728)

<!-- apply: game.js -->
```diff
     try { survivalUI?.destroy?.(); } catch {}
+    try { uiFeel?.destroy(); } catch {} uiFeel = null;
```

A live hot swap also works without this: a new `createUIFeel` destroys the previous instance through
`window.__littleRaftUIFeel` (the survival-ui pattern).

### 2e. Effects: `effect(e)` (line 768) and a guarded `feelEffect` (before `collectBottle`, line 774)

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

### 2f. Name the builder on the build effects that go to both players

`build` is emitted to `'all'` for a floor/decor placement (line 877) and a building piece (line 883). Without an
owner the partner's reticle would flash a hit marker for your build. Add `by:actor` (additive: an older peer
ignores it, and an effect without `by` never marks):

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

And the hook repair (line 907, actor only):

<!-- apply: game.js -->
```diff
-      bag.slots[i].durability = MAX_HEALTH; emit({kind:'build', text:'Hook repaired!', sound:'repair'}, actor);
+      bag.slots[i].durability = MAX_HEALTH; emit({kind:'build', text:'Hook repaired!', sound:'repair', by:actor}, actor);
```

The signal-cache `build` (line 850) goes to the *other* player and has no `by`, so it shows in their feed with no
marker, as intended.

### 2g. Reticle state every frame (line 1249), gated like `survivalUI.update`

<!-- apply: game.js -->
```diff
     refreshPointerUI(); updateCharge(); updateContext(dialog); updateSignalHud();
+    if (uiFeel && !feelFailed) { try { uiFeel.crosshair.hover(!!pickTarget || !!hover); uiFeel.crosshair.charge(charging && running ? chargeValue() : null); } catch (e) { feelFailed = true; console.error('ui-feel update failed', e); } }
```

Both calls return early when nothing changed (hover toggles a class only on a change; charge writes
`stroke-dashoffset` only while charging), so idle frames do no DOM writes. A throw turns the per-frame call off
for the session (`feelFailed`) and never skips `renderer.render`.

### 2h. Gold marker on a catch (line 1184, `updateHook`)

<!-- apply: game.js -->
```diff
-    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) play('catch'); lastCaughtCount = caught.length; }
+    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) { play('catch'); uiFeel?.crosshair.hit('gold'); } lastCaughtCount = caught.length; }
```

(`crosshair.hit` is guarded inside the module and returns false on error.)

## 3. Optional: retire the throw-power bar

The charge arc around the reticle replaces `#chargeMeter`, which `prompts.css` now parks under the key prompt.
To hide it while ui-feel is attached, append to `dist/prompts.css`:

<!-- append: prompts.css -->
```css
html:has(#crosshair.uf-xh) #chargeMeter{display:none!important}
```

The selector outranks prompts.css's `body #chargeMeter` rules and stops applying if ui-feel is destroyed.

## 4. Optional: stat bars

The game has no health, hunger or thirst. When it does:

```js
const statsEl = Object.assign(document.createElement('div'), {className:'uf-stats'}); document.body.append(statsEl);
const hp = uiFeel.statBar(statsEl, {tone:'health', label:'Health', value:1}); // tones: health | food | water | hook
hp.set(player.health / MAX_HEALTH); // per frame or on change; a no-op when the value did not move
```

The panel sits bottom-right (the pickup feed owns bottom-left). Add `body:not(.playing) .uf-stats{display:none}`.

## Standalone toasts (not used by the game)

`createUIFeel({toasts:true})` (the default) adds the `#uf-toasts` stack for hosts without a feed. It is a
`popover="manual"` in the top layer and is re-shown after every `fullscreenchange` and every `<dialog>` that
opens, so it stays above a fullscreen `<html>` and above modal backdrops. While a modal dialog is open it moves
where the dialog leaves room: beside it when the right gap fits the 230 px column, otherwise into the larger of
the top/bottom gaps, capped at the 1-2 rows that fit. The sandbox shows it with `?toasts=1`.

## Verify

0. `python sandbox/ui-feel/realgame.py` copies `dist/` to a temp folder, applies every block above (each must
   match exactly once), boots the game, lands a real pickup (hook catch, or the same `collect` action through a
   scratch-only QA hook), freezes the fly mid-air, crafts through the real buttons, opens the inventory at
   1280 and 1024 px, enters fullscreen through Pause > Graphics, checks the build marker for the partner vs
   yourself and the guards, and writes `sandbox/ui-feel/shots/rg-*.png` plus JSON.
1. `python sandbox/ui-feel/shoot.py` prints `"errors": []`.
2. Tests: `node --test tests/*.test.mjs` with `RAFT_DIST=<patched copy>` (realgame.py `--keep` prints it) and
   without; the results must match.
3. In the game: hook a barrel. Icons pop out of the reticle and fly into their slots; each slot keeps its old
   count until its icon lands, then bumps. The bottom-left feed shows `+3 Plank` etc. as before. Hold click:
   an amber arc fills around the reticle. Point at a supply: the reticle grows and turns gold. Tab: the panel
   pops in; craft rope and the recipe row flashes. Turn on "Emulate prefers-reduced-motion: reduce": fades only.
