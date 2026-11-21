# Adopting ui-feel in dist/

Checked against the current `dist/` at branch point `claude/raft-tech` (745f663): `dist/game.js` 1208 lines,
`dist/survival-ui.js` 652 lines, build token `v3-survival-ae77fa84ac2b`. Line numbers below are from that
version. Search for the quoted code if they have moved.

Summary: add one file, export one function from survival-ui, and add about 15 lines to game.js. No CSS file
changes are required. `ui-feel.js` injects `<style id="ui-feel-style">` itself, the same way survival-ui
injects `#survival-style`, so `live.js` hot swaps keep working without editing `CSS_FILES`.

## 1. Add the module

```
cp sandbox/ui-feel/ui-feel.js dist/ui-feel.js
```

Copy it unchanged. It has no imports and only targets selectors that dist already has (`.tools.sv-hotbar`,
`.sv-slot`, `.sv-art`, `.sv-count`, `#inventory.sv-inv`, `.sv-recipe`, `#crosshair`, `.primary`,
`.secondary`, `.header-right button`, `#repairButton`, `#copyRoom`, `.close`).

## 2. dist/survival-ui.js: export the icon renderer

Line 78:

```diff
-function iconSVG(kind) {
+export function iconSVG(kind) {
```

The flying pickup icons and toast icons then use the same art as the slots, including the hand-drawn
`plastic` and `rope` fallbacks. Nothing else in survival-ui changes. ui-feel watches `.tools` and `#inventory`
with MutationObservers. It picks up selection changes from `.sv-sel` and count changes from `.sv-count` and
`.sv-empty`, so `paintHotbar`, `paintSlot` and `render` keep working as they are.

## 3. dist/game.js

### 3a. Imports (line 17)

```diff
-import { createSurvivalUI } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
+import { createSurvivalUI, iconSVG } from './survival-ui.js?build=v3-survival-ae77fa84ac2b';
+import { createUIFeel } from './ui-feel.js?build=v3-survival-ae77fa84ac2b';
```

Use the same `?build=` token as every other import. The release script rewrites all of them together.

### 3b. State (line 184)

```diff
-  let survivalUI = null, settingsController = null, options = ...
+  let survivalUI = null, uiFeel = null, settingsController = null, options = ...
```

### 3c. Create it after the survival UI (after the `createSurvivalUI({...});` call that ends at line 1191)

```js
    try { uiFeel = createUIFeel({ getBag: () => localBag(), iconHTML: iconSVG, hotbarSize: HOTBAR }); }
    catch (e) { uiFeel = null; console.error('ui-feel failed', e); } // purely cosmetic: never block the game
```

This call must come **after** `createSurvivalUI`, because that is what creates `dialog#inventory` and fills
`.tools` with `.sv-slot` buttons. `getBag` is used for one thing: choosing which hotbar slot a picked-up
item lands in, before survival-ui repaints on the next frame.

### 3d. Dispose (line 1172)

```diff
     try { survivalUI?.destroy?.(); } catch {}
+    try { uiFeel?.destroy(); } catch {}
```

On a live hot swap, the new `createUIFeel` destroys the previous instance first, through
`window.__littleRaftUIFeel`. That is the same pattern survival-ui uses. The old engine's later `dispose()`
is then a no-op.

### 3e. Feedback events: `effect(e)` (lines 526-531)

```diff
   function effect(e) {
     if (!e || typeof e !== 'object') return;
     if (Array.isArray(e.tokens)) for (const t of e.tokens) if (typeof t === 'string') pending.delete(t);
-    if (typeof e.text === 'string' && e.text) notice(e.text.slice(0, 90));
+    const felt = uiFeel && feelEffect(e);
+    if (typeof e.text === 'string' && e.text && !felt) notice(e.text.slice(0, 90));
     beep(e.kind === 'build' ? 640 : e.kind === 'craft' ? 560 : e.kind === 'full' ? 220 : 440);
   }
+  // Loot / craft / build / full go to the toast stack (and fly into the hotbar); 'notice' stays under the crosshair.
+  function feelEffect(e) {
+    const name = k => ITEM_INFO[k]?.name ?? k;
+    if (e.kind === 'loot' && e.loot && typeof e.loot === 'object') {
+      const items = Object.entries(e.loot).filter(([k, n]) => ITEM_INFO[k] && n > 0).map(([kind, count]) => ({kind, count}));
+      uiFeel.pickup(items);
+      uiFeel.crosshair.hit('gold');
+      for (const it of items) uiFeel.toast(name(it.kind), {kind:'loot', icon:iconSVG(it.kind), amount:it.count, key:'loot:' + it.kind});
+      return true;
+    }
+    if (e.kind === 'craft') { uiFeel.crafted(e.recipe); uiFeel.toast(e.text, {kind:'craft', icon:ITEM_INFO[e.recipe] ? iconSVG(e.recipe) : ''}); return true; }
+    if (e.kind === 'build') { uiFeel.crosshair.hit('hit'); uiFeel.toast(e.text, {kind:'build'}); return true; }
+    if (e.kind === 'full') { uiFeel.crosshair.hit('deny'); uiFeel.toast(e.text, {kind:'full'}); return true; }
+    return false;
+  }
```

`effect()` already runs on whichever machine owns the actor, both on the host and on a guest through the
`data.type === 'effect'` branch at line 1033. The feel therefore shows for the player who did the action.
`build` is emitted to `'all'`, so both brothers get that toast.

### 3f. Put the loot on the events (`applyAction`)

Line 562 (supply collected):

```diff
-      if (!a.net) emit({kind:'loot', text:'+ ' + Object.entries(loot).map(([k, n]) => `${n} ${itemName(k)}`).join(' · ')}, actor);
+      if (!a.net) emit({kind:'loot', loot, text:'+ ' + Object.entries(loot).map(([k, n]) => `${n} ${itemName(k)}`).join(' · ')}, actor);
```

Line 585 (fish):

```diff
-      world.fish++; emit({kind:'loot', text:'You caught a fish!'}, actor); return;
+      world.fish++; emit({kind:'loot', loot:{fish:1}, text:'You caught a fish!'}, actor); return;
```

Line 546 (craft):

```diff
-      if (r.ok) emit({kind:'craft', text:`Crafted ${ITEM_INFO[r.crafted.kind]?.name ?? r.crafted.kind}`}, actor);
+      if (r.ok) emit({kind:'craft', recipe:a.recipe, text:`Crafted ${ITEM_INFO[r.crafted.kind]?.name ?? r.crafted.kind}`}, actor);
```

The extra fields are additive. An older peer ignores them and still gets `text`.

### 3g. Crosshair state, every frame (line 841)

```diff
-    refreshPointerUI(); updateCharge(); updateContext(dialog);
+    refreshPointerUI(); updateCharge(); updateContext(dialog);
+    if (uiFeel) { uiFeel.crosshair.hover(!!pickTarget || !!hover); uiFeel.crosshair.charge(charging && running ? chargeValue() : null); }
```

Both calls return early when nothing changed: hover only toggles a class on a change, and charge only writes
`stroke-dashoffset` while charging. Idle frames do no DOM writes.

### 3h. Hit markers on a catch (line 792, `updateHook`)

```diff
-    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) beep(520 + caught.length * 30); lastCaughtCount = caught.length; }
+    if (caught.length !== lastCaughtCount) { if (caught.length > lastCaughtCount) { beep(520 + caught.length * 30); uiFeel?.crosshair.hit('gold'); } lastCaughtCount = caught.length; }
```

The following one is optional. For a refused placement (line 632), add `uiFeel?.crosshair.hit('deny');`
before the `notice(...)`.

### 3i. Optional: retire the throw-power bar

The charge arc around the reticle replaces `#chargeMeter`, the "THROW POWER" bar 44 px under the crosshair.
To hide that bar, add this line at the end of `dist/graphics.css`:

```css
html:has(#crosshair.uf-xh) #chargeMeter{display:none!important}
```

Or leave both. They do not overlap.

### 3j. Optional: stat bars

The game has no health, hunger or thirst yet, so there is nothing to wire today. When those stats land:

```js
const statsEl = Object.assign(document.createElement('div'), {className:'uf-stats'}); document.body.append(statsEl);
const hp = uiFeel.statBar(statsEl, {tone:'health', label:'Health', value:1});   // tones: health | food | water | hook
// each frame or on change (set() is a no-op when the value did not move):
hp.set(player.health / MAX_HEALTH);
```

You can try it now with the hook condition, which is hidden while playing because `#durability` is in
HUD_CSS's `display:none` list:
`uiFeel.statBar(statsEl, {tone:'hook', label:'Hook'})`, then each frame
`.set(hookDurability(localBag()) / MAX_HEALTH)`.

Add `body:not(.playing) .uf-stats{display:none}` to graphics.css so the panel hides on the welcome screen.

## What you get with no further code

- **Inventory open/close.** `#inventory.sv-inv` fades and scales in. The crafting and bag columns slide in
  from either side, and closing fades out over 120 ms. This is pure CSS (`@starting-style`, plus `overlay`
  and `display` with `allow-discrete`). The `open` attribute is removed immediately, so
  `dialogOpen()`/`uiBlocked()` and `requestLock()` in game.js behave exactly as before. Browsers without
  `@starting-style` (Chrome below 117, Safari below 17.4) open and close instantly, as they do today.
- **Press states.** Hotbar and bag slots, recipes, `.primary`, `.secondary`, the header buttons,
  `#repairButton`, `#copyRoom` and `.close` all press down.
- **Reduced motion.** `prefers-reduced-motion: reduce` sets `html.uf-rm`. Every movement then becomes a
  short fade or an instant change: no fly, no bounce, no slide, no shake, no pulse. To expose it as a game
  setting, call `uiFeel.setReducedMotion(true | false | 'auto')`.

## Verify

1. `python sandbox/ui-feel/shoot.py`. It should print `"errors": []`. Compare the PNGs in
   `sandbox/ui-feel/shots/` to the ones described in `docs/tech/ui-feel.md`.
2. In the game (serve the repo root and open `/dist/`), check each of these:
   - Press 1-8 or use the wheel. The gold cursor slides and the icon hops.
   - Hook a barrel. Four icons pop out of the reticle and fly to their slots, each slot bumps, and the
     right-hand stack shows `Wood +3`, `Palm Leaf +2` and so on. A second barrel merges into the same
     rows.
   - Hold click with the hook. An amber arc fills around the reticle and glows when full. Release it.
   - Point at a supply. The reticle grows and turns gold, and the `E` prompt still shows below it.
   - Press Tab. The panel pops in. Craft rope and the recipe flashes while the rope slot bumps. Press Tab
     again and the panel fades out, and the pointer re-locks on the next click.
   - Turn on DevTools > Rendering > "Emulate prefers-reduced-motion: reduce" and repeat. Nothing should
     move: you get fades only.
3. In DevTools Performance, record 10 s of play with pickups. In the bottom-up view, no "Layout" entry
   should come from `ui-feel.js`. The only layouts are the text changes in toast rows, a few tenths of a ms
   each.
4. `window.raftDebug` and the existing tests are unaffected. ui-feel adds no state to saves or to the
   network beyond the optional `loot`/`recipe` fields on effects.
