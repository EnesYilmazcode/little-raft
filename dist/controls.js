// Little Raft - controls glue. Wires input.js (keyboard/mouse/gamepad action map) and move-feel.js
// (accel ramp, footstep bob, crouch, landing dip) into game.js through a handful of callbacks, so
// game.js only needs tiny hooks (search "controls lane" there). rotate (and buildPick when g.buildPick is missing)
// is also emitted as a window 'little-raft-action' CustomEvent,
// footfalls as 'little-raft-footstep', so other lanes can listen without touching this file.
import { ActionMap } from './input-map.js?build=v3-survival-ae77fa84ac2b';
import { createInput } from './input.js?build=v3-survival-ae77fa84ac2b';
import { MoveFeel } from './move-feel.js?build=v3-survival-ae77fa84ac2b';
import { createBuildRadial } from './build-radial.js?build=v3-survival-ae77fa84ac2b';

const BUILD_PIECES = [
  {id:'floor', label:'Floor'}, {id:'sail', label:'Sail'}, {id:'palm', label:'Palm'},
  {id:'lantern', label:'Lantern'}, {id:'net', label:'Net'}, {id:'bench', label:'Bench'}, {id:'crate', label:'Crate'},
];

const STOP_BRAKE = 8; // 1/s, added to physics' ground rate of 14 when no move input

function storage() { try { return globalThis.localStorage ?? null; } catch { return null; } }
const emit = (type, detail) => { try { globalThis.dispatchEvent?.(new CustomEvent(type, {detail})); } catch {} };

// g: {canvas, isBlocked, sensitivity, motion, look(dx,dy), hotbarSize, slot(), selectSlot(i), interact(),
//     inventory(), repair(back), pause(), menuBack(id) (pad closes the open menu), useDown(), useUp(), useCancel(), reelDown(), reelUp(),
//     buildPieces? (list or () => list of {id,label}), buildPick?(id),
//     buildWheelOpen?() (hammer build wheel open: hotbar and interact are swallowed, movement still works)}
export function createControls(g) {
  const map = new ActionMap({storage:storage()});
  const feel = new MoveFeel({motionScale:1});
  let idle = true, radial = null, cursor = [0, 0], tabs = new Set(), fx = {bobY:0, bobX:0, roll:0, eyeOffset:0, footstep:false}, padUse = false, padReel = false;
  const call = (name, ...a) => { try { return g[name]?.(...a); } catch (e) { console.error('controls:', name, e); } };

  const onAction = (id, phase, info) => {
    if (info?.blocked) { // pad Y / Start / B while a menu is open: close it (never while a rebind is listening)
      if (![...tabs].some(t => t.capturing)) { call('menuBack', id); input.clear(); }
      return;
    }
    const pad = input.activeDevice === 'pad';
    if (phase === 'down') {
      if (id === 'interact') { if (!g.buildWheelOpen?.()) call('interact'); }
      else if (id === 'inventory') call('inventory');
      else if (id === 'pause' && pad) call('pause'); // Escape on the keyboard is owned by settings.js / pointer lock
      else if (id === 'rotate') { call('repair', input.shiftHeld()); emit('little-raft-action', {id}); } // game's R = repair today
      else if (id === 'buildMenu') openRadial();
      else if ((id === 'use' || id === 'aim') && pad) return; // pad triggers handled analog in frame()
    } else if (id === 'buildMenu') radial?.confirm();
    else if (id === 'rotate') call('release'); // let go of a steered sail on any device
  };
  const tabCapturing = () => { for (const t of tabs) if (t.capturing) return true; return false; }; // per frame: no array copy
  const input = createInput({element:g.canvas, map, onAction, sensitivity:g.sensitivity, blockedActions:['inventory', 'pause'],
    isBlocked:() => tabCapturing() || (!!g.isBlocked?.() && !radial?.isOpen)});

  function openRadial() {
    if (g.isBlocked?.()) return;
    const items = (typeof g.buildPieces === 'function' ? g.buildPieces() : g.buildPieces) ?? BUILD_PIECES;
    radial ??= createBuildRadial({items, onPick:it => g.buildPick ? call('buildPick', it?.id) : emit('little-raft-action', {id:'buildPick', piece:it?.id})});
    cursor = [0, 0]; radial.open();
  }

  // Call once per frame before physics. Returns the shaped input for physics.update().
  function movement(dt, active, physics) {
    if (radial?.isOpen && g.isBlocked?.()) radial.close(); // a dialog opened over the radial: cancel, never pick behind it
    input.update(dt);
    const {dx, dy} = input.lookDelta();
    if (radial?.isOpen) { // look input steers a virtual stick (works for right stick and locked mouse)
      input.hotbarStep(); input.hotbarSlot(); // drain: bumpers pressed while choosing must not fire on close
      const inv = map.settings[input.activeDevice === 'pad' ? 'padInvertY' : 'invertY'] ? -1 : 1; // radial is screen space (+y down)
      const c = cursor; c[0] += dx * 6; c[1] += dy * inv * 6; const l = Math.hypot(c[0], c[1]); if (l > 1) { c[0] /= l; c[1] /= l; }
      radial.update(c[0], c[1]); return {forward:0, strafe:0, sprint:false, jump:false}; }
    if (dx || dy) call('look', dx, dy);
    const step = input.hotbarStep(), slot = input.hotbarSlot(), n = g.hotbarSize ?? 8;
    // build wheel open: drained and dropped (a slot swap would put the hammer away and lose the wheel's choice)
    if (call('buildWheelOpen')) { /* swallow */ } else if (slot >= 0 && slot < n) call('selectSlot', slot);
    else if (step) call('selectSlot', (((call('slot') ?? 0) + step) % n + n) % n);
    // gamepad triggers: RT = use / charge-throw, LT = reel (mouse clicks stay with game.js)
    const t = input.triggers(), use = t.throw > .5, reel = t.reel > .5;
    // released by a dialog/pause or a pad disconnect (not the player): cancel the charge like a lost pointer lock does
    if (use !== padUse) { padUse = use; call(use ? 'useDown' : g.isBlocked?.() || input.activePad < 0 ? 'useCancel' : 'useUp'); }
    if (reel !== padReel) { padReel = reel; call(reel ? 'reelDown' : 'reelUp'); }
    const m = active ? input.move() : {forward:0, strafe:0};
    idle = Math.hypot(m.forward, m.strafe) < .05;
    const crouch = active && input.crouching();
    const shaped = feel.shapeInput(dt, {forward:m.forward, strafe:m.strafe, sprint:active && input.sprinting(), crouch,
      grounded:physics.grounded, swimming:physics.swimming});
    return {...shaped, jump:active && (input.down('jump') || input.pressed('jump')), crouch}; // pressed: a sub-frame tap still jumps / rises
  }
  // Call after physics.update(); ev is its return value.
  function afterMove(dt, physics, ev) {
    // Raft-style crisp stop: extra ground braking on top of physics' GROUND_ACCEL once the stick/keys are released.
    if (idle && physics.grounded && !physics.swimming) { const k = Math.exp(-STOP_BRAKE * Math.min(dt, .05)); physics.vx *= k; physics.vz *= k; }
    feel.setMotionScale(g.motion?.() ?? 1);
    fx = feel.step(dt, {speed:Math.hypot(physics.vx, physics.vz), grounded:physics.grounded, swimming:physics.swimming,
      vy:physics.vy, landed:!!ev?.landed, crouch:input.crouching(), onLadder:feel.isOnLadder()});
    if (fx.footstep) emit('little-raft-footstep', {side:fx.stepSide, sprint:input.sprinting(), crouch:input.crouching()});
    return fx;
  }
  // Camera offsets in metres/radians, yaw-relative: apply bobX along the camera's right vector.
  const camera = yaw => ({x:Math.cos(yaw) * fx.bobX, y:fx.bobY + fx.eyeOffset, z:-Math.sin(yaw) * fx.bobX, roll:fx.roll});

  const api = {map, input, feel, movement, afterMove, camera,
    get radialOpen() { return !!radial?.isOpen; },
    clear() { input.clear(); padUse = padReel = false; radial?.close(); },
    // controls-tab.js is only fetched the first time a menu mounts the tab. mountTab() returns a handle at once
    // (capturing/refresh/dispose work before the module arrives); handle.ready resolves to the real tab.
    mountTab(container, opts = {}) { // the handle's dispose() should be paired with api.unmountTab(handle); opts.hide: setting keys the host shows itself
      let tab = null, gone = false;
      const handle = {
        get element() { return tab?.element ?? null; },
    get capturing() { return tabCapturing(); }, // a controls tab is waiting for a key/button to bind
        get capturing() { return !!tab?.capturing; },
        refresh() { tab?.refresh(); },
        dispose() { gone = true; tab?.dispose?.(); tab = null; },
        ready: import('./controls-tab.js?build=v3-survival-ae77fa84ac2b').then(m => {
          if (gone) return null;
          tab = m.createControlsTab({map, input, hide:opts.hide}); tab.mount(container); return tab;
        }).catch(e => { console.error('controls: tab failed to load', e); return null; }),
      };
      tabs.add(handle); return handle; },
        cancel() { tab?.cancel?.(); },
    unmountTab(t) { tabs.delete(t); t?.dispose?.(); },
    dispose() { input.dispose(); radial?.dispose(); for (const t of tabs) t.dispose?.(); tabs.clear(); if (globalThis.raftControls === api) delete globalThis.raftControls; }};
  globalThis.raftControls = api; // menus lane: raftControls.mountTab(el); QA: raftControls.feel / .input
  return api;
}
