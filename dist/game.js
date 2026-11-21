import * as T from './vendor/three.module.js';
import { createAvatar } from './avatar.js?build=7af539255eb2';
import { createOcean } from './ocean.js?build=ee7b7091cb95';
import { createHook } from './hook.js?build=3aba5f23ef8a';
import { createWoodMaterial } from './wood.js?build=dfc51ca0cf2c';
import { HookCast, WATER_Y } from './hook-physics.js?build=38a181a923a6';
import { createSettings } from './settings.js?build=5c583deb15db';
import { createFloor } from './deck.js?build=3e95222a4eac';
import { createDebris } from './debris.js?build=69916ac35025';
import { createHands } from './hands.js?build=f5c56add2b31';
import { createCraft } from './crafts.js?build=82efd1a03941';

// Module entry has no side effects beyond the imports above. Call mount(transfer) to run the game.
// mount() returns {capture, pause, resume, dispose}; capture() output can be passed to a new mount().

// ---------- Immutable configuration ----------
const RECIPES = Object.freeze([
  {id:'floor', name:'Raft floor', cost:{wood:2}},
  {id:'sail', name:'Little sail', cost:{wood:4, leaf:3}},
  {id:'palm', name:'Palm pot', cost:{wood:2, leaf:3}},
  {id:'lantern', name:'Lantern', cost:{wood:1, scrap:2}},
  {id:'net', name:'Catch net', cost:{wood:3, leaf:2}},
]);
const DECOR_TYPES = Object.freeze(['sail', 'palm', 'lantern', 'net']);
const ITEM_TYPES = Object.freeze(['wood', 'leaf', 'scrap', 'barrel']);
const ITEM_NAMES = Object.freeze({wood:'plank', leaf:'bundle of leaves', scrap:'piece of scrap', barrel:'barrel'});
const STOCK_KEYS = Object.freeze(['wood', 'leaf', 'scrap']);
const TOOLS = Object.freeze(['hook', 'build', 'fish']);
const SAVE = 'little-raft-v1';
const FLOOR_Y = .2, EYE_HEIGHT = 1.8, BODY_RADIUS = .3, WALK_SPEED = 2.6;
const LOOK_SENSITIVITY = .0022, DRAG_SENSITIVITY = .005, PITCH_LIMIT = 1.35;
const FISH_REACH = 26, PENDING_MS = 2500, JOIN_TIMEOUT = 15000;
const CHARGE_MS = 900, MIN_CHARGE = .15, WEAR_PER_CAST = 2, MAX_HEALTH = 100;
const REPAIR_COST = Object.freeze({wood:2, scrap:1});
const ROPE_SEGMENTS = 16, ITEM_FLOAT = .05, CAMERA_ROLL = .2;
const VIEW = Object.freeze({x:.3, y:-.27, z:-.62, rx:-.12, ry:-.3, rz:.08, scale:.3});
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TIMBER = new Set(['#bb8a53','#c69860','#ad7c4a','#5e4029','#9c7649', '#c8995f', '#d3a368', '#8c6745', '#d5a265', '#a97d4c', '#b4824b', '#906f48', '#725942', '#756a49', '#ad8153']);

export function mount(transfer = null) {
  const X = transfer && typeof transfer === 'object' ? transfer : null;
  const $ = s => document.querySelector(s);
  const canvas = $('#world');
  const clamp = T.MathUtils.clamp;
  const ac = new AbortController(), signal = ac.signal;
  const timers = new Set();
  let disposed = false, active = false, rafId = 0;

  // ---------- Small utilities ----------
  const newToken = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  const isInt = Number.isInteger;
  function later(fn, ms) { const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms); timers.add(id); return id; }
  function cancelTimer(id) { if (id) { clearTimeout(id); timers.delete(id); } return 0; }
  const guard = fn => (...a) => (disposed ? undefined : fn(...a));
  let seed = 20240917; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  function newWorld() { return {tiles:Array.from({length:9}, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]), decor:[], stock:{wood:5, leaf:3, scrap:1}, fish:0, collected:0, hookHealth:MAX_HEALTH, items:[]}; }
  // Validates a saved world or a host snapshot. Returns a fresh clean object or null.
  function cleanWorld(v, withItems = false) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.tiles) || !v.tiles.length || v.tiles.length > 400) return null;
    const tiles = [], seen = new Set();
    for (const t of v.tiles) {
      if (!Array.isArray(t) || !isInt(t[0]) || !isInt(t[1]) || Math.abs(t[0]) > 25 || Math.abs(t[1]) > 25) return null;
      const k = t[0] + ',' + t[1]; if (!seen.has(k)) { seen.add(k); tiles.push([t[0], t[1]]); }
    }
    const s = v.stock; if (!s || typeof s !== 'object') return null;
    const stock = {};
    for (const k of STOCK_KEYS) { const n = s[k]; if (!isInt(n) || n < 0 || n > 1e6) return null; stock[k] = n; }
    const decor = [], used = new Set();
    for (const d of Array.isArray(v.decor) ? v.decor : []) {
      if (!d || !DECOR_TYPES.includes(d.type) || !isInt(d.x) || !isInt(d.z)) continue;
      const k = d.x + ',' + d.z; if (!seen.has(k) || used.has(k)) continue;
      used.add(k); decor.push({type:d.type, x:d.x, z:d.z});
    }
    const count = n => (isInt(n) && n >= 0 ? n : 0);
    const items = [];
    if (withItems && Array.isArray(v.items)) for (const it of v.items.slice(0, 80)) {
      if (it && isInt(it.id) && typeof it.token === 'string' && it.token.length < 80 && ITEM_TYPES.includes(it.type) && Number.isFinite(it.x) && Number.isFinite(it.z) && Math.abs(it.x) < 80 && Math.abs(it.z) < 80)
        items.push({id:it.id, token:it.token, type:it.type, x:it.x, z:it.z, phase:Number.isFinite(it.phase) ? it.phase : 0});
    }
    return {tiles, decor, stock, fish:count(v.fish), collected:count(v.collected), hookHealth:Number.isFinite(v.hookHealth) ? clamp(Math.round(v.hookHealth), 0, MAX_HEALTH) : MAX_HEALTH, items};
  }
  const normaliseLive = w => { if (w && typeof w === 'object') { if (!Number.isFinite(w.hookHealth)) w.hookHealth = MAX_HEALTH; if (!Array.isArray(w.items)) w.items = []; } return w; };
  function validPose(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) < 55 && Math.abs(p.z) < 55 ? {x:p.x, z:p.z, yaw:Number.isFinite(p.yaw) ? p.yaw : 0} : null; }

  // ---------- Engine state (restored from transfer when hot-swapping) ----------
  let world, saveAvailable = X ? X.saveAvailable !== false : true;
  if (X?.world && Array.isArray(X.world.tiles)) world = normaliseLive(X.world);
  else {
    world = newWorld();
    let raw = null;
    try { raw = localStorage.getItem(SAVE); } catch { saveAvailable = false; }
    if (raw) { try { const v = cleanWorld(JSON.parse(raw)); if (v) world = v; } catch {} }
  }
  let scene = null, camera = null, renderer = null, ocean = null, raft, itemsGroup, ghost, rope, ropeAttr, hookMesh, friend, player, sun;
  let viewmodel, hookModel, handTip, clothMat,hands;
  let running = !!X?.running, tool = TOOLS.includes(X?.tool) ? X.tool : 'hook', recipe = RECIPES.some(r => r.id === X?.recipe) ? X.recipe : 'floor';
  let elapsed = Number.isFinite(X?.elapsed) ? X.elapsed : 0, last = performance.now();
  let yaw = Number.isFinite(X?.yaw) ? X.yaw : 0, pitch = Number.isFinite(X?.pitch) ? X.pitch : -.28;
  let settingsController=null, options={sensitivity:1,fov:75,cameraMotion:.35,volume:.5,graphics:'medium'};
  let walking = false, walkPhase = Number.isFinite(X?.walkPhase) ? X.walkPhase : 0, swing = 0;
  const pointer = new T.Vector2(), ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), -.22);
  let hover = null, mouse = {x:0, y:0, inside:false};
  let me = X?.me && Number.isFinite(X.me.x) && Number.isFinite(X.me.z) ? {x:X.me.x, z:X.me.z} : {x:0, z:1.2};
  let other = X?.other ? validPose(X.other) : null;
  let keys = X?.keys && typeof X.keys === 'object' ? {...X.keys} : {};
  let hook = X?.hook && (X.hook.fishing || typeof X.hook.update === 'function') ? X.hook : null;
  let fishWait = Number.isFinite(X?.fishWait) ? X.fishWait : 0;
  let sound = X ? X.sound !== false : true, audio = X?.audio ?? null;
  let charging = X?.charging && Number.isFinite(X.charging.start) ? {...X.charging} : null, reeling = !!X?.reeling && !!hook;
  let lastCaught = typeof X?.lastCaught === 'string' ? X.lastCaught : null;
  const pending = new Map(X?.pending instanceof Map ? X.pending : []); // item token -> expiry; hides supplies we reeled in while the host confirms
  let peer = X?.peer ?? null, conn = X?.conn ?? null, role = ['solo', 'host', 'guest'].includes(X?.role) ? X.role : 'solo';
  let networkReady = !!X?.networkReady, room = typeof X?.room === 'string' ? X.room : '';
  let lastHostMessage=X?.lastHostMessage||performance.now(),lastGuestMessage=X?.lastGuestMessage||performance.now();
  let ownWorldBackup = X?.ownWorldBackup ? normaliseLive(X.ownWorldBackup) : null; // a guest's own raft, restored when they leave
  let joinTimer = 0, joinDeadline = Number.isFinite(X?.joinDeadline) ? X.joinDeadline : 0;
  let netClock = 0, saveClock = 0, networkTick = 0, toastTimer = 0;
  const bindings = []; // [emitter, event, fn] registered by THIS mount on PeerJS objects
  const lockSupported = !!canvas && typeof canvas.requestPointerLock === 'function';
  let lockFallback = !lockSupported || !!X?.lockFallback, down = X?.down ? {...X.down} : null, uiSignature = '', hintCache = '';
  const raftPose = {y:X?.raftPose?.y ?? 0, rx:X?.raftPose?.rx ?? 0, rz:X?.raftPose?.rz ?? 0};
  const chargeMeter = $('#chargeMeter'), chargeFill = chargeMeter?.querySelector('i');
  let recipeSignature = '';

  const hasTile = (x, z) => world.tiles.some(t => t[0] === x && t[1] === z);
  const isLocked = () => !!canvas && document.pointerLockElement === canvas;
  const dialogOpen = () => !!document.querySelector('dialog[open]');
  const castOut = () => (hook && !hook.fishing ? hook : null);
  const guestWaiting = () => role === 'guest' && !networkReady;
  const chargeValue = () => (charging ? clamp((performance.now() - charging.start) / CHARGE_MS, MIN_CHARGE, 1) : 0);
  const hookHealth = () => clamp(Number.isFinite(world.hookHealth) ? world.hookHealth : MAX_HEALTH, 0, MAX_HEALTH);

  // ---------- Small mesh helpers ----------
  const materialCache = new Map();
  function mat(color) {
    if (!materialCache.has(color)) {
      let m = null;
      if (TIMBER.has(color)) { try { m = createWoodMaterial(T, color); } catch (e) { console.warn('wood material failed', e); } }
      materialCache.set(color, m ?? new T.MeshStandardMaterial({color, roughness:.85, metalness:0}));
    }
    return materialCache.get(color);
  }
  function box(w, h, d, c, x = 0, y = 0, z = 0, parent) { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent?.add(m); return m; }
  function cylinder(rt, rb, h, c, x, y, z, parent, n = 8) { const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, n), mat(c)); m.position.set(x, y, z); m.castShadow = true; parent?.add(m); return m; }
  function sphere(r, c, x, y, z, parent) { const m = new T.Mesh(new T.IcosahedronGeometry(r, 1), mat(c)); m.position.set(x, y, z); parent?.add(m); return m; }
  function disposeGeometry(o) { const cached=new Set(materialCache.values()),materials=new Set();o.traverse(c=>{c.geometry?.dispose();for(const m of [].concat(c.material||[]))if(!cached.has(m)&&m!==clothMat)materials.add(m);});for(const m of materials){m.map?.dispose();m.dispose();} }

  // ---------- Scene ----------
  function init() {
    const assetBuild=new URL(import.meta.url).searchParams.get('build')||'dev';document.querySelectorAll('use[href*="icons.svg"]').forEach(el=>el.setAttribute('href','icons.svg?build='+assetBuild+'#'+el.getAttribute('href').split('#')[1]));
    const toolbar=$('.tools');if(toolbar&&!toolbar.querySelector('[data-quick-recipe]'))for(const [i,r]of RECIPES.entries()){const b=document.createElement('button');b.dataset.quickRecipe=r.id;b.innerHTML=`<kbd>${i+4}</kbd><span>${icon(r.id)}</span><em>${r.name}</em>`;b.title=r.name+' · '+Object.entries(r.cost).map(([k,n])=>n+' '+k).join(', ');toolbar.append(b);}
    const controls=$('.controls');if(controls)controls.innerHTML='<span><kbd>W A S D</kbd> Walk</span><span><kbd>Hold</kbd> Throw / reel</span><span><kbd>E</kbd> Craft</span><span><kbd>Esc</kbd> Menu</span><span id="fishCount">0 fish caught</span>';
    const guide=$('#help .guide');if(guide)guide.innerHTML='<li><kbd>Mouse</kbd><span><b>Look around.</b> Click the sea to capture your mouse.</span></li><li><kbd>W A S D</kbd><span><b>Walk</b> around your raft.</span></li><li><kbd>1</kbd><span><b>Hook.</b> Hold to pull back. Release to throw. Hold again to reel.</span></li><li><kbd>4–8</kbd><span><b>Build.</b> Choose a craft, aim at a space, and click.</span></li><li><kbd>E</kbd><span><b>Crafting.</b> Open recipes and see their supply costs.</span></li><li><kbd>Esc</kbd><span><b>Pause.</b> Change settings, then Resume.</span></li>';
    scene = new T.Scene(); scene.background = new T.Color('#cbd2c0'); scene.fog = new T.Fog('#cbd2c0', 25, 125);
    camera = new T.PerspectiveCamera(running ? 70 : 48, innerWidth / innerHeight, .05, 200); camera.rotation.order = 'YXZ'; scene.add(camera);
    renderer = X?.renderer && X.renderer.domElement === canvas ? X.renderer : new T.WebGLRenderer({canvas, antialias:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7)); renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    scene.add(new T.HemisphereLight('#f2ead4', '#3d6b6a', 1.8));
    sun = new T.DirectionalLight('#fff0c7', 2.5); sun.position.set(-15, 28, 12); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, {left:-25, right:25, top:25, bottom:-25}); sun.shadow.bias = -.001; scene.add(sun);
    ocean = createOcean(T, {sunDirection:sun.position.clone(),skyColor:'#cbd2c0',fadeNear:28,fadeFar:125}); ocean.uniforms.uDeep.value.set('#14505a');ocean.uniforms.uShallow.value.set('#3f8c88');ocean.uniforms.uZenith.value.set('#a9c1c0');ocean.mesh.receiveShadow = true; scene.add(ocean.mesh); ocean.update(elapsed);
    raft = new T.Group(); raft.position.y = raftPose.y; raft.rotation.set(raftPose.rx, 0, raftPose.rz); scene.add(raft);
    itemsGroup = new T.Group(); scene.add(itemsGroup);
    player = makeAvatar('#efae55'); friend = makeAvatar('#70a7e4'); friend.visible = false; raft.add(player, friend);
    ghost = new T.Mesh(new T.BoxGeometry(1.9, .13, 1.9), new T.MeshBasicMaterial({color:'#b6ffd0', transparent:true, opacity:.55, depthWrite:false})); ghost.visible = false; scene.add(ghost);
    const ropeGeo = new T.BufferGeometry(); ropeAttr = new T.BufferAttribute(new Float32Array((ROPE_SEGMENTS + 1) * 3), 3); ropeAttr.setUsage(T.DynamicDrawUsage); ropeGeo.setAttribute('position', ropeAttr);
    rope = new T.Line(ropeGeo, new T.LineBasicMaterial({color:'#e9d39a'})); rope.visible = false; rope.frustumCulled = false; scene.add(rope);
    hookMesh = createHook(T); hookMesh.scale.setScalar(.5); hookMesh.visible = false; scene.add(hookMesh);
    clothMat = new T.MeshStandardMaterial({color:'#fff3cf', side:T.DoubleSide, roughness:1});
    buildViewmodel();
    for (let i = 0; i < 12; i++) { const g = new T.Group(), a = i * 2.4, d = 65 + rand() * 25; g.position.set(Math.sin(a) * d, -.1, Math.cos(a) * d); cylinder(3, 5, .8, '#e6d7a3', 0, 0, 0, g); sphere(3.4, '#4f9b72', 0, 1.4, 0, g); palm(g, 0, 1, 0, 1.4); scene.add(g); }
    for (let i = 0; i < 24; i++) { const g = new T.Group(); for (let j = 0; j < 3; j++) sphere(1.3 + j * .35, '#e7f9eb', j * 1.4, Math.sin(j) * .5, 0, g); g.position.set((rand() - .5) * 170, 17 + rand() * 8, (rand() - .5) * 170); g.scale.y = .5; scene.add(g); }
    rebuildRaft();
    if (!world.items.length && role !== 'guest') for (let i = 0; i < 30; i++) world.items.push(makeItem(i));
    syncItems(); ensureOnRaft(); updateHUD(); setTool(tool); refreshPointerUI(true);
  }

  function fallbackAvatar(color) {
    const g = new T.Group();
    cylinder(.21, .25, .58, color, 0, .64, 0, g); sphere(.23, '#f2c69b', 0, 1.14, 0, g); cylinder(.28, .28, .07, '#f7e7b5', 0, 1.32, 0, g); cylinder(.17, .19, .16, '#f7e7b5', 0, 1.4, 0, g);
    box(.13, .22, .15, '#314d53', -.13, .25, 0, g); box(.13, .22, .15, '#314d53', .13, .25, 0, g);
    return g;
  }
  function makeAvatar(color) {
    try { const g = createAvatar(T, color); if (g?.isObject3D) { g.traverse(c => { if (c.isMesh) c.castShadow = true; }); return g; } }
    catch (e) { console.warn('createAvatar failed, using fallback avatar', e); }
    return fallbackAvatar(color);
  }

  // First-person viewmodel: the scrap hook plus a simple hand and sleeve at the lower right.
  function buildViewmodel() {
    hookModel=createHook(T);hands=createHands(T,hookModel);viewmodel=hands.group;handTip=hands.handTip;
    viewmodel.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false;c.renderOrder=1000;for(const m of [].concat(c.material)){m.depthTest=false;m.depthWrite=false;} } });
    viewmodel.visible = false; camera.add(viewmodel);
  }

  function palm(parent, x, y, z, s = 1) {
    const g = new T.Group(); g.position.set(x, y, z); g.scale.setScalar(s); cylinder(.09, .17, 1.6, '#ad8153', 0, .8, 0, g);
    for (let i = 0; i < 7; i++) { const l = new T.Mesh(new T.ConeGeometry(.28, 1.5, 4), mat(i % 2 ? '#519b55' : '#72ae59')); l.rotation.z = 1.2; l.rotation.y = i * Math.PI * 2 / 7; l.position.set(Math.sin(i * Math.PI * 2 / 7) * .5, 1.65, Math.cos(i * Math.PI * 2 / 7) * .5); g.add(l); }
    parent.add(g);
  }
  function rebuildRaft() {
    for (const c of [...raft.children]) if (c !== player && c !== friend) { raft.remove(c); disposeGeometry(c); }
    world.tiles.forEach(([x, z], i) => {
      const g = createFloor(T, x*719+z*311, mat); g.position.set(x * 2, 0, z * 2);raft.add(g);
    });
    for (const d of world.decor) {
      const detailed=createCraft(T,d.type);if(detailed){detailed.position.set(d.x*2,.22,d.z*2);raft.add(detailed);continue;}
      const g = new T.Group(); g.position.set(d.x * 2, .22, d.z * 2);
      if (d.type === 'sail') { cylinder(.065, .08, 3.8, '#906f48', 0, 1.9, 0, g); box(2.5, .07, .07, '#906f48', 0, 3.2, 0, g); const s = new T.Mesh(new T.PlaneGeometry(2.35, 2.1), clothMat); s.position.set(0, 2.15, .06); g.add(s); box(.23, 2.1, .025, '#e79960', -.85, 2.15, .09, g); }
      if (d.type === 'palm') { cylinder(.38, .28, .5, '#db8764', 0, .25, 0, g); cylinder(.32, .32, .03, '#654f36', 0, .51, 0, g); palm(g, 0, .5, 0); }
      if (d.type === 'lantern') { cylinder(.055, .075, 1.8, '#725942', 0, .9, 0, g); box(.55, .07, .07, '#725942', .22, 1.8, 0, g); box(.32, .42, .32, '#ffe197', .43, 1.5, 0, g); box(.4, .06, .4, '#596a63', .43, 1.74, 0, g); const l = new T.PointLight('#ffd17c', 2, 4); l.position.set(.43, 1.5, 0); g.add(l); }
      if (d.type === 'net') { for (let k = 0; k < 6; k++) { box(.025, .05, 1.7, '#ebe1bd', -.8 + k * .32, .05, 0, g); box(1.7, .05, .025, '#ebe1bd', 0, .05, -.8 + k * .32, g); } for (const a of [-.88, .88]) box(.1, .1, 1.9, '#756a49', a, .05, 0, g); }
      raft.add(g);
    }
    updateHUD();
  }

  // ---------- Floating supplies ----------
  function makeItem(id) { const edge=Math.min(...world.tiles.map(t=>t[1]))*2-1,spread=Math.max(11,Math.max(...world.tiles.map(t=>Math.abs(t[0])))*2+6);return {id,token:newToken(),type:['wood','wood','leaf','scrap','barrel'][Math.floor(Math.random()*5)],x:(Math.random()-.5)*spread*2,z:edge-3-Math.random()*17,phase:Math.random()*6}; }
  // Meshes are keyed by token, not id: a respawned item keeps its id but may change type.
  const itemMeshes = new Map();
  function syncItems() {
    if (!itemsGroup) return;
    const live = new Set(world.items.map(x => x.token));
    for (const [token, m] of itemMeshes) if (!live.has(token)) { itemsGroup.remove(m); disposeGeometry(m); itemMeshes.delete(token); }
    for (const token of pending.keys()) if (!live.has(token)) pending.delete(token);
    for (const item of world.items) {
      if (itemMeshes.has(item.token)) continue;
      const g = createDebris(T,item.type,mat,{seed:item.id}); g.userData.token = item.token;
      g.position.set(item.x, ITEM_FLOAT, item.z);
      itemsGroup.add(g); itemMeshes.set(item.token, g);
    }
  }
  const isPending = it => (pending.get(it.token) ?? 0) > performance.now();

  // ---------- HUD ----------
  const setText = (sel, v) => { const el = $(sel); if (el) el.textContent = v; };
  function setStatus(s) { setText('#networkStatus', s); }
  function toast(s) {
    const el = $('#toast'); if (!el) return; el.textContent = s; el.classList.add('show');
    toastTimer = cancelTimer(toastTimer); toastTimer = later(() => { toastTimer = 0; el.classList.remove('show'); }, 2600);
  }
  function beep(f = 500) { if (!sound) return; try { audio ??= new AudioContext(); audio.resume(); const o = audio.createOscillator(), g = audio.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f, audio.currentTime); o.frequency.exponentialRampToValueAtTime(f * 1.4, audio.currentTime + .12); g.gain.setValueAtTime(.12*options.volume, audio.currentTime); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .22); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + .23); } catch {} }
  const icon = type => `<svg class="icon" viewBox="0 0 48 48" aria-hidden="true"><use href="icons.svg#icon-${type}"></use></svg>`;
  function updateHUD() {
    for (const k of STOCK_KEYS) setText('#' + k, world.stock[k]);
    setText('#fishCount', `${world.fish} fish caught`);
    const n = world.tiles.length, progress = $('#progress'); if (progress) progress.style.width = clamp((n - 9) / 7 * 100, 0, 100) + '%';
    setText('#goalText', world.collected === 0 ? 'Hook a floating supply to get started' : n < 16 ? `Build your raft: ${n} / 16 floors` : 'A lovely little home. Keep creating!');
    const recipes = $('#recipes');
    // Only rewrite recipe buttons when the selection changes, so clicks are never lost mid-press.
    const signature=recipe+STOCK_KEYS.map(k=>world.stock[k]).join(',');
    if (recipes && recipeSignature !== signature) {
      recipeSignature = signature;
      recipes.innerHTML = RECIPES.map(r => `<button data-recipe="${r.id}" class="${recipe === r.id ? 'active' : ''} ${Object.entries(r.cost).some(([k,n])=>world.stock[k]<n)?'unaffordable':''}" aria-pressed="${recipe === r.id}"><span>${icon(r.id)}</span>${r.name}<small>${Object.entries(r.cost).map(([k, v]) => v + ' ' + k).join(' · ')}</small></button>`).join('');
    }
    const h = Math.round(hookHealth());
    setText('#conditionValue', h + '%');
    const bar = $('#conditionBar'); if (bar) bar.style.width = h + '%';
    $('#durability')?.classList.toggle('low', h <= 25);
  }
  function idleHint() {
    const locked = isLocked(), worn = hookHealth() <= 0 ? ' · Worn hook: press R to repair' : '';
    if (tool === 'build') return locked ? 'Point the dot at a green space and click to build · E for recipes' : lockFallback ? 'Pick a recipe, then click a green space to build' : 'Pick a recipe, then click the ocean to aim';
    if (!locked && !lockFallback) return 'Click the ocean to look around';
    if (tool === 'fish') return (locked ? 'Point the dot at the sea and click' : 'Click the sea') + ', then wait for a bite';
    return (locked ? 'Hold click to charge, release to throw your hook' : 'Press and hold on the sea to charge, release to throw · drag to look') + worn;
  }
  function hintText() {
    if (!running) return '';
    if (guestWaiting()) return 'Waiting for your brother’s raft to load…';
    if (charging) return `Throw power ${Math.round(chargeValue() * 100)}% · release to throw`;
    if (hook?.fishing) return hook.t > fishWait ? 'A bite! Pulling it in…' : 'Bobbing along… wait for a bite';
    if (hook) {
      const what = hook.caught ? ITEM_NAMES[hook.caught.type] ?? 'supply' : null;
      if (hook.stage === 'flying') return 'Hook flying…';
      if (hook.stage === 'reeling') return what ? `Reeling in the ${what}… keep holding` : 'Reeling in… sweep the hook past a supply to snag it';
      return what ? `Hooked a ${what}! Hold click to reel it in` : 'Hook floating. Hold click to reel it in and snag supplies on the way';
    }
    return idleHint();
  }
  function updateHints() {
    const text = hintText();
    if (text !== hintCache) { hintCache = text; const aim = $('#aimHint'); if (aim) aim.textContent = text; }
    if (chargeMeter) {
      const show = !!charging && running;
      if (chargeMeter.hidden === show) chargeMeter.hidden = !show;
      if (show && chargeFill) chargeFill.style.width = (chargeValue() * 100).toFixed(1) + '%';
    }
  }
  function setTool(t) {
    if (!TOOLS.includes(t)) return;
    const previous = tool; tool = t; hover = null; if (ghost) ghost.visible = false;
    if (t !== previous) charging = null;
    document.body.classList.toggle('build', t === 'build'); const recipes = $('#recipes'); if (recipes) recipes.hidden = t !== 'build';
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('selected', b.dataset.tool === t));
    document.querySelectorAll('[data-quick-recipe]').forEach(b=>b.classList.toggle('selected',t==='build'&&b.dataset.quickRecipe===recipe));
    // Number keys keep the mouse captured. E explicitly frees it to choose recipes.
    refreshPointerUI(true);
  }
  // Body classes, crosshair and resume hint follow running and pointer-lock state.
  function refreshPointerUI(force = false) {
    const locked = isLocked(), dialog = dialogOpen();
    const signature = [running, locked, dialog, lockFallback].join();
    if (!force && signature === uiSignature) return; uiSignature = signature;
    const b = document.body.classList;
    b.toggle('pointer-locked', locked); b.toggle('locked', locked); b.toggle('first-person', running); b.toggle('playing', running);
    const crosshair = $('#crosshair'); if (crosshair) crosshair.hidden = !(running && locked);
    const resume = $('#resumeHint'); if (resume) resume.hidden = !(running && !locked && lockSupported && !dialog);
    hintCache = ''; // force the aim hint to refresh
  }

  // ---------- Pointer lock ----------
  function requestLock() {
    if (!running || !lockSupported) return;
    try { const p = canvas.requestPointerLock(); p?.catch?.(guard(lockFailed)); } catch { lockFailed(); }
  }
  // Lock refused (iframe, cooldown after Escape, tests): switch to drag-look. The click that asked for lock never casts.
  function lockFailed() {
    if (isLocked()) return;
    const wasFallback = lockFallback; lockFallback = true; refreshPointerUI(true);
    if (!wasFallback && running) toast('Mouse lock is unavailable here. Drag to look; press and release to use your tool.');
  }
  function releaseLock() { if (isLocked()) document.exitPointerLock?.(); }
  function look(dx, dy, k) { yaw -= dx * k; pitch = clamp(pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT); }

  // ---------- Aiming ----------
  function pickNdc(nx, ny) {
    pointer.set(nx, ny); ray.setFromCamera(pointer, camera);
    let item = null;
    for (const hit of ray.intersectObjects(itemsGroup.children, true)) {
      let o = hit.object; while (o && !o.userData.token) o = o.parent;
      const found = o && world.items.find(it => it.token === o.userData.token);
      if (found && !isPending(found)) { item = found; break; }
    }
    if(!item&&tool==='hook'){let best=Infinity;for(const it of world.items){if(isPending(it))continue;const m=itemMeshes.get(it.token);if(!m)continue;const along=m.position.clone().sub(ray.ray.origin).dot(ray.ray.direction),radius=.5+Math.max(0,along)*.02;if(along>0&&along<best&&ray.ray.distanceSqToPoint(m.position)<radius*radius){best=along;item=it;}}}
    return {point:ray.ray.intersectPlane(plane, new T.Vector3()), item, dir:ray.ray.direction.clone()};
  }
  function pickScreen(x, y) { const r = canvas.getBoundingClientRect(); return pickNdc((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); }
  const pickCenter = () => pickNdc(0, 0);
  function currentAim() {
    if (isLocked()) return pickCenter();
    if (lockFallback && mouse.inside) return pickScreen(mouse.x, mouse.y);
    return null;
  }
  function placement(p) {
    if (!p) return null; const x = Math.round(p.x / 2), z = Math.round(p.z / 2);
    if (recipe === 'floor') { if (hasTile(x, z) || !NEIGHBOURS.some(([a, b]) => hasTile(x + a, z + b))) return null; }
    else if (!hasTile(x, z) || world.decor.some(d => d.x === x && d.z === z)) return null;
    return {x, z};
  }
  function placementCandidates() {
    const out = [];
    if (recipe === 'floor') { const seen = new Set(); for (const [tx, tz] of world.tiles) for (const [a, b] of NEIGHBOURS) { const x = tx + a, z = tz + b, k = x + ',' + z; if (!seen.has(k) && !hasTile(x, z)) { seen.add(k); out.push({x, z}); } } }
    else for (const [x, z] of world.tiles) if (!world.decor.some(d => d.x === x && d.z === z)) out.push({x, z});
    return out;
  }
  // Throw target: a directly aimed supply, else the aimed water point, else straight ahead at max range.
  // HookCast still limits the distance by charge.
  function aimTarget(aim, origin, maxRange) {
    if (aim?.item) return new T.Vector3(aim.item.x, WATER_Y, aim.item.z);
    let dx = -Math.sin(yaw), dz = -Math.cos(yaw);
    const dir = aim?.dir, l = dir ? Math.hypot(dir.x, dir.z) : 0;
    if (l > 1e-3) { dx = dir.x / l; dz = dir.z / l; }
    let dist = maxRange;
    const p = aim?.point;
    if (p) { const ox = p.x - origin.x, oz = p.z - origin.z, d = Math.hypot(ox, oz); if (ox * dx + oz * dz > 0 && d < maxRange){if(!hasTile(Math.round(p.x/2),Math.round(p.z/2)))return new T.Vector3(p.x,WATER_Y,p.z);dist=d;} }
    dist = Math.max(dist, 3);
    while (dist < maxRange && hasTile(Math.round((origin.x + dx * dist) / 2), Math.round((origin.z + dz * dist) / 2))) dist += .5; // clear the raft edge
    return new T.Vector3(origin.x + dx * dist, WATER_Y, origin.z + dz * dist);
  }

  // ---------- Actions (host is authoritative) ----------
  function send(data) { if (conn?.open) { try { conn.send(data); } catch {} } }
  function action(a) {
    if (role === 'guest') { if (!networkReady) { toast('Wait for your raft to connect'); return false; } send({type:'action', a}); return true; }
    applyAction(a); return true;
  }
  function applyAction(a) {
    if (!a || typeof a !== 'object') return;
    if (a.kind === 'collect') {
      const i = world.items.findIndex(it => it.id === a.id && it.token === a.token); if (i < 0) return; // token guard: each supply counts once
      const it = world.items[i];
      if (it.type === 'barrel') { world.stock.wood += 3; world.stock.leaf += 2; world.stock.scrap++; } else world.stock[it.type] += it.type === 'wood' ? 2 : 1;
      world.collected++; world.items.splice(i, 1); world.items.push(makeItem(a.id)); syncItems();
      emit({kind:'loot', text:it.type === 'barrel' ? '+3 wood · +2 leaves · +1 scrap' : `+${it.type === 'wood' ? 2 : 1} ${it.type}`});
    } else if (a.kind === 'build') {
      const r = RECIPES.find(r => r.id === a.recipe);
      if (!r || !isInt(a.x) || !isInt(a.z) || Math.abs(a.x) > 25 || Math.abs(a.z) > 25 || world.tiles.length >= 400) return;
      const valid = r.id === 'floor' ? !hasTile(a.x, a.z) && NEIGHBOURS.some(([x, z]) => hasTile(a.x + x, a.z + z)) : hasTile(a.x, a.z) && !world.decor.some(d => d.x === a.x && d.z === a.z);
      if (!valid) return;
      if (Object.entries(r.cost).some(([k, n]) => world.stock[k] < n)) { emit({kind:'notice', text:'Hook a few more supplies for that recipe'}); return; }
      for (const [k, n] of Object.entries(r.cost)) world.stock[k] -= n;
      r.id === 'floor' ? world.tiles.push([a.x, a.z]) : world.decor.push({type:r.id, x:a.x, z:a.z});
      rebuildRaft(); emit({kind:'build', text:r.id === 'floor' ? 'A little more room!' : `${r.name} crafted!`});
    } else if (a.kind === 'fish') { world.fish++; emit({kind:'loot', text:'You caught a fish!'}); }
    else if (a.kind === 'wear') {
      const before = hookHealth(); world.hookHealth = Math.max(0, before - WEAR_PER_CAST);
      if (before > 0 && world.hookHealth === 0) emit({kind:'notice', text:'The hook is worn out. Throws are shorter until you repair it (R).'});
      else if (before > 25 && world.hookHealth <= 25) emit({kind:'notice', text:'The hook is getting worn. Press R to repair: 2 wood, 1 scrap.'});
    } else if (a.kind === 'repair') {
      if (hookHealth() >= MAX_HEALTH) { emit({kind:'notice', text:'The hook is already in great shape'}); return; }
      if (Object.entries(REPAIR_COST).some(([k, n]) => world.stock[k] < n)) { emit({kind:'notice', text:'Repairing needs 2 wood and 1 scrap'}); return; }
      for (const [k, n] of Object.entries(REPAIR_COST)) world.stock[k] -= n;
      world.hookHealth = MAX_HEALTH; emit({kind:'build', text:'Hook repaired, good as new!'});
    } else return;
    updateHUD();
  }
  function effect(e) { if (!e || typeof e.text !== 'string') return; toast(e.text.slice(0, 160)); beep(e.kind === 'build' ? 640 : 440); }
  function emit(e) { effect(e); send({type:'effect', e}); }
  function repair() { if (!running) return; action({kind:'repair'}); }

  // Build and fish tools act instantly; the hook uses charge/throw/reel below.
  function cast(target) {
    if (!running || hook || fishWait) return;
    if (guestWaiting()) return toast('Wait for your raft to connect');
    const p = target?.point ?? null;
    if (tool === 'build') {
      const v = placement(p); if (!v) return toast(recipe === 'floor' ? 'Point at an empty space beside the raft' : 'Point at an empty raft floor');
      const selected=RECIPES.find(r=>r.id===recipe),missing=Object.entries(selected.cost).filter(([k,n])=>world.stock[k]<n).map(([k,n])=>`${n-world.stock[k]} more ${k}`);
      if(missing.length)return toast('Need '+missing.join(' and '));
      swing = 1; action({kind:'build', recipe, ...v}); return;
    }
    if (tool === 'fish') {
      if (!p || hasTile(Math.round(p.x / 2), Math.round(p.z / 2))) return toast('Point at the water to fish');
      if (Math.hypot(p.x - me.x, p.z - me.z) > FISH_REACH) return toast('Try a spot a little closer');
      fishWait = 3 + Math.random() * 2; hook = {end:new T.Vector3(p.x, .1, p.z), t:0, duration:fishWait + .8, fishing:true};
      swing = 1; toast('Bobbing along… wait for a bite!'); beep(280);
    }
  }
  function beginCharge(at) {
    if (!running || hook || fishWait || tool !== 'hook') return;
    if (guestWaiting()) { toast('Wait for your raft to connect'); return; }
    charging = {start:performance.now(), x:at?.x ?? null, y:at?.y ?? null};
  }
  function releaseCharge(aim) {
    const c = charging; charging = null;
    if (!c || !running || hook || tool !== 'hook') return;
    if (guestWaiting()) { toast('Wait for your raft to connect'); return; }
    throwHook(aim, clamp((performance.now() - c.start) / CHARGE_MS, MIN_CHARGE, 1));
  }
  function throwHook(aim, charge) {
    const health = hookHealth(), maxRange = 16 + health * .16, origin = handPos.clone();
    hook = new HookCast(T, {origin, target:aimTarget(aim, origin, maxRange), maxRange, charge});
    lastCaught = null; reeling = false; swing = 1; beep(230);
    action({kind:'wear'});
    if (health <= 0) toast('Your hook is worn out, so throws are shorter. Press R to repair.');
  }

  function start() {
    running = true; const w = $('#welcome'); if (w) w.hidden = true; const h = $('#hud'); if (h) h.hidden = false;
    if (!saveAvailable) setText('#saveStatus', 'Browser storage is unavailable. This session will not be saved.');
    refreshPointerUI(true);
  }
  function save() {
    if (role === 'guest' || disposed) return;
    try { localStorage.setItem(SAVE, JSON.stringify({...world, items:[]})); }
    catch { saveAvailable = false; setText('#saveStatus', 'Browser storage is full or unavailable. This session will not be saved.'); }
  }

  // ---------- Movement ----------
  function onRaft(x, z) {
    for (const sx of [-BODY_RADIUS, BODY_RADIUS]) for (const sz of [-BODY_RADIUS, BODY_RADIUS]) if (!hasTile(Math.round((x + sx) / 2), Math.round((z + sz) / 2))) return false;
    return true;
  }
  function ensureOnRaft() {
    if (onRaft(me.x, me.z)) return;
    const t = hasTile(0, 0) ? [0, 0] : world.tiles[0]; me.x = t[0] * 2; me.z = t[1] * 2;
  }
  const held = (...codes) => codes.some(c => keys[c]);
  function movePlayer(dt) {
    const fwd = held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'), side = held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft');
    walking = !!(fwd || side); if (!walking) return;
    const step = WALK_SPEED * dt / Math.hypot(fwd, side), s = Math.sin(yaw), c = Math.cos(yaw);
    const mx = (-s * fwd + c * side) * step, mz = (-c * fwd - s * side) * step; // forward (-sin, -cos), right (cos, -sin)
    if (onRaft(me.x + mx, me.z)) me.x += mx;
    if (onRaft(me.x, me.z + mz)) me.z += mz;
    walkPhase += dt * 9;
  }

  // ---------- Frame ----------
  const handPos = new T.Vector3(me.x, EYE_HEIGHT, me.z);
  // Hook physics floats at a flat WATER_Y; map heights near the water onto the visible waves.
  function surfaceY(x, z, y) {
    const k = clamp((y - WATER_Y) / .6, 0, 1), w = ocean.getHeight(x, z) + .04 + (y - WATER_Y);
    return w + (y - w) * k;
  }
  function setRope(points) {
    const arr = ropeAttr.array, n = Math.min(points.length, ROPE_SEGMENTS + 1);
    for (let i = 0; i < n; i++) { arr[i * 3] = points[i].x; arr[i * 3 + 1] = points[i].y; arr[i * 3 + 2] = points[i].z; }
    ropeAttr.needsUpdate = true; rope.geometry.setDrawRange(0, n); rope.visible = true;
  }
  function updateRaft(dt) {
    const base = ocean.mesh.position.y, h = ocean.getHeight(0, 0) - base, s = ocean.getSlope(0, 0, undefined, 2.2);
    const ky = Math.min(1, dt * 2), kr = Math.min(1, dt * 1.5);
    raft.position.y += (h * .3 - raft.position.y) * ky;
    raft.rotation.x += (-s.z * .35 - raft.rotation.x) * kr;
    raft.rotation.z += (s.x * .35 + Math.sin(elapsed * .7) * .003 - raft.rotation.z) * kr;
  }
  function updateCamera(dt) {
    const fov = running ? options.fov : 48; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    if (running) {
      const bob = walking ? Math.sin(walkPhase) * .025 * options.cameraMotion : 0;
      camera.position.set(me.x, raft.position.y + EYE_HEIGHT + bob, me.z);
      camera.rotation.set(pitch, yaw, raft.rotation.z * CAMERA_ROLL * options.cameraMotion, 'YXZ');
    } else { // gentle cinematic view for the welcome screen
      const focus = new T.Vector3(-5, 0, 2), d = 23, cy = .68 + Math.sin(elapsed * .05) * .12, cp = .77;
      camera.position.set(focus.x + Math.sin(cy) * d * Math.cos(cp), d * Math.sin(cp), focus.z + Math.cos(cy) * d * Math.cos(cp)); camera.lookAt(focus);
    }
    swing = Math.max(0, swing - dt * 3);
    const ch = charging ? clamp((performance.now() - charging.start) / CHARGE_MS, 0, 1) : 0;
    viewmodel.visible = running;hands.update({dt,time:elapsed,charge:ch,reeling:reeling&&!!castOut(),casting:swing,walking,hasHookOut:!!hook,motion:options.cameraMotion});
    camera.updateMatrixWorld(true); handTip.getWorldPosition(handPos);
  }
  function updateAvatars(dt) {
    player.position.set(me.x, FLOOR_Y, me.z); player.rotation.y = yaw + Math.PI;
    player.visible = !running; // in first person we never see our own head or body
    friend.visible = !!other;
    if (other) {
      const target = new T.Vector3(other.x, FLOOR_Y, other.z);
      if (friend.position.distanceTo(target) > 3) friend.position.copy(target); else friend.position.lerp(target, Math.min(1, dt * 12));
      friend.rotation.y = (other.yaw ?? 0) + Math.PI;
    }
  }
  function updateItems(dt) {
    const caughtToken = castOut()?.caught?.token;
    if (role !== 'guest') {
      let respawned = false;const end=Math.max(...world.tiles.map(t=>t[1]))*2+24,side=Math.max(...world.tiles.map(t=>Math.abs(t[0])))*2+24;
      for (const it of world.items) {
        if (it.token === caughtToken) continue; // our hook holds it; don't let it drift away or respawn
        it.z += dt * .22; it.x += Math.sin(elapsed * .13 + it.phase) * dt * .04;
        if (it.z>end||Math.abs(it.x)>side||hasTile(Math.round(it.x / 2), Math.round(it.z / 2))) { Object.assign(it, makeItem(it.id)); respawned = true; }
      }
      if (respawned) syncItems();
    }
    for (const it of world.items) {
      const m = itemMeshes.get(it.token); if (!m) continue;
      m.visible = !isPending(it); m.scale.setScalar(1);
      const u = m.userData;
      if (role === 'guest' && u.sx !== undefined && Math.hypot(it.x - u.sx, it.z - u.sz) < 3) { const k = Math.min(1, dt * 8); u.sx += (it.x - u.sx) * k; u.sz += (it.z - u.sz) * k; }
      else { u.sx = it.x; u.sz = it.z; }
      const s = ocean.getSlope(u.sx, u.sz);
      m.position.set(u.sx, ocean.getHeight(u.sx, u.sz) + ITEM_FLOAT, u.sz);
      m.rotation.set(-s.z * 1.2 + Math.sin(elapsed * 1.3 + it.phase) * .04, it.phase + elapsed * .08, s.x * 1.2 + Math.sin(elapsed + it.phase) * .05);
    }
  }
  function updateHook(dt) {
    if (!hook) { rope.visible = false; hookMesh.visible = false; return; }
    if (hook.fishing) { // simple bobber animation, separate from HookCast
      hook.t += dt; const f = hook.t / hook.duration, u = Math.min(1, f * 5);
      const pos = handPos.clone().lerp(hook.end, u);
      if (u >= 1) pos.y = ocean.getHeight(pos.x, pos.z) + .05 + Math.sin(elapsed * 5) * .03 - (hook.t > fishWait ? .12 : 0); else pos.y += Math.sin(u * Math.PI) * 1.2;
      const pts = []; for (let i = 0; i <= ROPE_SEGMENTS; i++) pts.push(handPos.clone().lerp(pos, i / ROPE_SEGMENTS));
      setRope(pts); hookMesh.visible = true; hookMesh.position.copy(pos); hookMesh.rotation.set(0, yaw, 1.1);
      if (f >= 1) { action({kind:'fish'}); hook = null; fishWait = 0; rope.visible = false; hookMesh.visible = false; }
      return;
    }
    const ev = hook.update(dt, {hand:handPos, items:world.items.filter(it => !isPending(it)), reeling, time:elapsed});
    const hp = hook.position, pos = new T.Vector3(hp.x, surfaceY(hp.x, hp.z, hp.y), hp.z);
    hookMesh.visible = true; hookMesh.position.copy(pos);
    if (hook.stage === 'flying') hookMesh.rotation.set(-hook.flightT * Math.PI * 2, yaw, 0);
    else if (hook.stage === 'reeling') hookMesh.rotation.set(-.6, yaw, 0);
    else hookMesh.rotation.set(0, yaw, 1.1);
    const pts = hook.ropePoints(handPos, ROPE_SEGMENTS);
    for (let i = 1; i < pts.length; i++) pts[i].y = surfaceY(pts[i].x, pts[i].z, pts[i].y);
    pts[pts.length - 1].copy(pos); setRope(pts);
    const caughtToken = hook.caught?.token ?? null;
    if (caughtToken !== lastCaught) {
      if (caughtToken) { toast(`Snagged a ${ITEM_NAMES[hook.caught.type] ?? 'supply'}! Hold click to reel it in`); beep(520); }
      else if (lastCaught && !ev) toast('It slipped off the hook');
      lastCaught = caughtToken;
    }
    if (hook.caught) { // visual only: drag the caught supply along behind the hook
      const m = itemMeshes.get(hook.caught.token), cp = hook.caughtPosition();
      if (m && cp) { m.position.set(cp.x, surfaceY(cp.x, cp.z, cp.y) - .02, cp.z); m.scale.setScalar(clamp(hook.distance / 2.5, .35, 1)); }
    }
    if (ev?.kind === 'collected') { pending.set(ev.token, performance.now() + PENDING_MS); action({kind:'collect', id:ev.id, token:ev.token}); }
    else if (ev?.kind === 'returned') { toast('Nothing on the hook this time. Sweep it past a supply while reeling.'); beep(300); }
    if (hook.stage === 'done') { hook = null; lastCaught = null; reeling = false; rope.visible = false; hookMesh.visible = false; }
  }
  function updateGhost(dialog) {
    hover = running && tool === 'build' && !dialog ? placement(currentAim()?.point) : null;
    ghost.visible = !!hover; if (hover) ghost.position.set(hover.x * 2, raft.position.y + .29, hover.z * 2);
    if(hover){const r=RECIPES.find(r=>r.id===recipe);ghost.material.color.set(Object.entries(r.cost).some(([k,n])=>world.stock[k]<n)?'#ee8e75':'#b6ffd0');}
  }
  function frame() {
    const now = performance.now(), dt = Math.min((now - last) / 1000, .05); last = now; elapsed += dt;
    const dialog = dialogOpen();
    if(role==='guest'&&networkReady&&now-lastHostMessage>8000){closeConnection();toast('Host disconnected. You are back on your own raft.');}
    if(role==='host'&&conn?.open&&now-lastGuestMessage>8000){const stale=conn;conn=null;unbindTarget(stale);stale.close();other=null;networkReady=false;setConnectionLabel('BROTHER LEFT · ROOM OPEN');}
    ocean.update(elapsed, camera);
    if (running && !dialog) movePlayer(dt); else walking = false;
    updateRaft(dt); updateAvatars(dt); updateCamera(dt);
    updateItems(dt); updateHook(dt); updateGhost(dialog);
    if (running && role !== 'guest') {
      netClock += dt;
      if (netClock > .8) {
        netClock = 0; const caught = castOut()?.caught?.token;
        for (const net of world.decor.filter(d => d.type === 'net')) { const it = world.items.find(it => it.token !== caught && !isPending(it) && Math.hypot(it.x - net.x * 2, it.z - net.z * 2) < 4); if (it) applyAction({kind:'collect', id:it.id, token:it.token}); }
      }
    }
    if (running) { saveClock += dt; if (saveClock > 3) { saveClock = 0; save(); } }
    if (conn?.open) { networkTick += dt; if (networkTick > .12) { networkTick = 0; const pose = {x:me.x, z:me.z, yaw}; send(role === 'host' ? {type:'state', world, other:pose} : {type:'move', me:pose}); } }
    refreshPointerUI(); updateHints();
    renderer.render(scene, camera);
  }
  function animate() {
    if (!active || disposed) return;
    rafId = requestAnimationFrame(animate);
    frame();
  }

  // ---------- Input ----------
  const on = (target, type, fn, opts = {}) => target?.addEventListener(type, guard(fn), {...opts, signal});
  on(document, 'pointerlockchange', () => {
    if (isLocked()) lockFallback = false;
    else { if (charging && charging.x === null) charging = null; reeling = false; }
    down = null; refreshPointerUI(true);
  });
  on(document, 'pointerlockerror', lockFailed);
  on(document, 'mousemove', e => {
    if (!isLocked() || dialogOpen()) return;
    look(clamp(e.movementX, -200, 200), clamp(e.movementY, -200, 200), LOOK_SENSITIVITY*options.sensitivity);
  });
  on(canvas, 'pointerdown', e => {
    if (!running || !scene || e.button !== 0 || dialogOpen()) return;
    if (isLocked()) {
      if (castOut()) reeling = true;
      else if (!hook && !fishWait) { if (tool === 'hook') beginCharge(null); else cast(pickCenter()); }
      return;
    }
    down = {x:e.clientX, y:e.clientY, moved:false}; try { canvas.setPointerCapture(e.pointerId); } catch {}
    if (castOut()) reeling = true; // hold to reel works without lock too
    else if (lockFallback && tool === 'hook' && !hook && !fishWait) beginCharge({x:e.clientX, y:e.clientY});
  });
  on(canvas, 'pointermove', e => {
    mouse = {x:e.clientX, y:e.clientY, inside:true};
    if (!down || isLocked()) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > 4) { down.moved = true; if (charging && charging.x !== null) charging = null; } // a drag is a look, not a throw
    if (down.moved) { look(dx, dy, DRAG_SENSITIVITY); down.x = e.clientX; down.y = e.clientY; }
  });
  on(canvas, 'pointerup', e => {
    if (e.button !== 0) return;
    reeling = false;
    if (isLocked()) { down = null; if (charging) releaseCharge(pickCenter()); return; }
    const wasClick = !!down && !down.moved; down = null;
    if (charging) { if (wasClick && charging.x !== null) releaseCharge(pickScreen(charging.x, charging.y)); else charging = null; return; }
    if (!wasClick || !running) return;
    if (lockFallback) { if (!hook && tool !== 'hook') cast(pickScreen(e.clientX, e.clientY)); return; }
    if (!dialogOpen()) requestLock(); // first click only locks; it never casts
  });
  on(canvas, 'pointerleave', () => { mouse.inside = false; });
  on(canvas, 'pointercancel', () => { down = null; reeling = false; if (charging && charging.x !== null) charging = null; });
  on(canvas, 'contextmenu', e => e.preventDefault());
  on(canvas,'wheel',e=>{if(tool!=='build'||!isLocked())return;e.preventDefault();const i=RECIPES.findIndex(r=>r.id===recipe);recipe=RECIPES[(i+(e.deltaY>0?1:RECIPES.length-1))%RECIPES.length].id;updateHUD();},{passive:false});
  on($('.tools'),'click',e=>{const b=e.target.closest?.('[data-quick-recipe]');if(b){recipe=b.dataset.quickRecipe;setTool('build');updateHUD();}});
  on($('#resumeHint'), 'click', () => requestLock());

  function toggleCrafting() {
    if (!running) return;
    if (isLocked()) { setTool('build'); releaseLock(); }
    else if (tool === 'build') requestLock();
    else setTool('build');
  }
  on(window, 'keydown', e => {
    if (e.target?.matches?.('input, textarea') || dialogOpen()) return;
    keys[e.code] = true;
    const digit = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code) + 1 || ['Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code) + 1 || +(['1', '2', '3'].includes(e.key) && e.key);
    if (digit) setTool(TOOLS[digit - 1]);
    if(/^Digit[4-8]$/.test(e.code)){recipe=RECIPES[+e.code.slice(-1)-4].id;setTool('build');updateHUD();}
    if (e.code === 'KeyE' && !e.repeat) toggleCrafting();
    if (e.code === 'KeyR' && !e.repeat) repair();
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  on(window, 'keyup', e => { keys[e.code] = false; });
  on(window, 'blur', () => { keys = {}; reeling = false; charging = null; down = null; });
  on(window, 'beforeunload',()=>{save();send({type:'leaving'});try{conn?.close();peer?.destroy();}catch{}});
  on(window, 'resize', () => { if (!camera) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  // DOM property handlers: a newer mount simply overwrites these, so dispose never clears them.
  const propertyHandlers=[];
  const setHandler = (el, prop, fn) => { if (el) {const previous=el[prop],next=guard(fn);propertyHandlers.push([el,prop,previous,next]);el[prop]=next;} };
  function openDialog(id) { releaseLock(); const d = $('#' + id); if (d && !d.open) d.showModal(); }
  setHandler($('#solo'), 'onclick', () => { start(); requestLock(); });
  setHandler($('#crewButton'), 'onclick', () => openDialog('crew'));
  setHandler($('#welcomeCrew'), 'onclick', () => openDialog('crew'));
  setHandler($('#helpButton'), 'onclick', () => settingsController?.open());
  setHandler($('#repairButton'), 'onclick', repair);
  document.querySelectorAll('[data-close]').forEach(b => setHandler(b, 'onclick', () => $('#' + b.dataset.close)?.close()));
  document.querySelectorAll('[data-tool]').forEach(b => setHandler(b, 'onclick', () => setTool(b.dataset.tool)));
  setHandler($('#recipes'), 'onclick', e => { const b = e.target.closest?.('[data-recipe]'); if (b && RECIPES.some(r => r.id === b.dataset.recipe)) { recipe = b.dataset.recipe; updateHUD(); refreshPointerUI(true); } });
  const soundLabel = () => setText('#soundButton', 'Sound: ' + (sound ? 'on' : 'off'));
  setHandler($('#soundButton'), 'onclick', () => { sound = !sound; soundLabel(); });
  soundLabel();

  // ---------- Networking (PeerJS, host authoritative) ----------
  function listen(target, ev, fn) { target.on(ev, fn); bindings.push([target, ev, fn]); }
  function unlisten(list) { for (const [t, ev, fn] of list) { try { (t.off ?? t.removeListener)?.call(t, ev, fn); } catch {} } }
  function unbindTarget(target) { for (let i = bindings.length - 1; i >= 0; i--) if (bindings[i][0] === target) unlisten(bindings.splice(i, 1)); }
  const setConnectionLabel = s => setText('#connection', s);
  // A guest plays in the host's world; when they leave, put their own raft back so autosave never overwrites it.
  function restoreOwnRaft() {
    if (!ownWorldBackup) return;
    world = normaliseLive(ownWorldBackup); ownWorldBackup = null;
    if (!world.items.length) for (let i = 0; i < 30; i++) world.items.push(makeItem(i));
    hook = null; fishWait = 0; charging = null; reeling = false; lastCaught = null; pending.clear();
    if (scene) { syncItems(); rebuildRaft(); }
    updateHUD(); ensureOnRaft();
  }
  function closeConnection() {
    joinTimer = cancelTimer(joinTimer); joinDeadline = 0; networkReady = false;
    const oldConn = conn, oldPeer = peer; conn = null; peer = null; other = null;
    unlisten(bindings.splice(0));
    try { oldConn?.close(); } catch {} try { oldPeer?.destroy(); } catch {}
    if (role === 'guest') restoreOwnRaft();
    role = 'solo'; setConnectionLabel('YOUR OWN LITTLE OCEAN'); const rd = $('#roomDisplay'); if (rd) rd.hidden = true;
  }
  function joinTimedOut() {
    joinTimer = 0;
    if (role !== 'guest' || networkReady) return;
    closeConnection();
    setStatus('Connection timed out. Check the room code. Your networks may block direct play.');
  }
  function bindPeer(p, isHost) {
    listen(p, 'open', () => {
      if (peer !== p) return;
      if (isHost) {
        setText('#roomCode', room.toUpperCase()); const rd = $('#roomDisplay'); if (rd) rd.hidden = false;
        if (!conn?.open) setConnectionLabel('ROOM ' + room.toUpperCase());
        setStatus('Room ready. Send this code to your brother.'); start();
      } else if (!conn) bindConn(p.connect('little-raft-' + room, {reliable:true}), false);
    });
    if (isHost) listen(p, 'connection', c => {
      if (peer !== p) return;
      if (conn?.open) { c.on('open', () => c.close()); return; } // room is full
      if (conn && conn !== c) { const old = conn; unbindTarget(old); try { old.close(); } catch {} }
      bindConn(c, true);
    });
    listen(p, 'error', e => {
      if (peer !== p) return;
      const type = e?.type ?? 'error';
      if (isHost && !p.open && !conn) { closeConnection(); setStatus('Could not open room: ' + type + '. Solo play still works.'); }
      else if (!isHost && !networkReady) { closeConnection(); setStatus('Could not connect: ' + type + '. Check the code and host’s tab.'); }
      else setStatus('Connection hiccup: ' + type + '.');
    });
    listen(p, 'disconnected', () => {
      if (peer !== p || p.destroyed) return;
      setStatus('Lost the matchmaking server. Reconnecting…');
      later(() => { if (peer === p && !p.destroyed && p.disconnected) { try { p.reconnect(); } catch {} } }, 1500);
    });
  }
  function bindConn(c, isHost) {
    conn = c;
    listen(c, 'open', () => {
      if (conn !== c) return;
      if (isHost) {
        lastGuestMessage=performance.now();
        networkReady = true; setStatus('Connected! Your brother is aboard.'); setConnectionLabel(`TWO ABOARD · ${room.toUpperCase()}`);
        $('#crew')?.close(); start(); toast('Your brother joined the raft!'); send({type:'state', world, other:{x:me.x, z:me.z, yaw}});
      } else setStatus('Connected. Loading your brother’s raft…'); // ready only after the first valid state
    });
    listen(c, 'data', data => {
      if (conn !== c || !data || typeof data !== 'object') return;
      if(data.type==='leaving'){if(isHost){const old=conn;conn=null;unbindTarget(old);old.close();other=null;networkReady=false;setConnectionLabel('BROTHER LEFT · ROOM OPEN');}else closeConnection();toast('Your brother left the raft.');return;}
      if (isHost) {
        lastGuestMessage=performance.now();
        if (data.type === 'action') applyAction(data.a);
        if (data.type === 'move') other = validPose(data.me) ?? other;
        return;
      }
      if (data.type === 'state') {
        lastHostMessage=performance.now();
        const w = cleanWorld(data.world, true); if (!w) return;
        const first = !networkReady;
        const changed = first || JSON.stringify([world.tiles, world.decor]) !== JSON.stringify([w.tiles, w.decor]);
        world = w; other = validPose(data.other);
        syncItems(); if (changed) { rebuildRaft(); ensureOnRaft(); } updateHUD();
        if (first) {
          networkReady = true; joinTimer = cancelTimer(joinTimer); joinDeadline = 0;
          setStatus('Connected! You are aboard your brother’s raft.'); setConnectionLabel(`TWO ABOARD · ${room.toUpperCase()}`);
          me={x:1.2,z:0};ensureOnRaft();$('#crew')?.close(); start(); toast('You joined your brother’s raft!');
        }
      }
      if (data.type === 'effect') effect(data.e);
    });
    listen(c, 'close', () => {
      if (conn !== c) return;
      unbindTarget(c); conn = null; networkReady = false; other = null;
      if (isHost) { setConnectionLabel('BROTHER LEFT · ROOM OPEN'); toast('Your brother left. Your raft is still here.'); return; }
      joinTimer = cancelTimer(joinTimer); joinDeadline = 0;
      const p = peer; peer = null; unlisten(bindings.splice(0)); try { p?.destroy(); } catch {}
      restoreOwnRaft(); role = 'solo'; setConnectionLabel('DISCONNECTED');
      setStatus('Host disconnected. Rejoin when their tab is open.'); toast('Host disconnected. You are back on your own raft.');
    });
    listen(c, 'error', () => { if (conn === c) setStatus('Connection failed. Check the code and try again.'); });
  }
  setHandler($('#host'), 'onclick', () => {
    if (role === 'host' && peer && !peer.destroyed) { setStatus('Your room is open. Share the code below.'); return; }
    closeConnection();
    if (typeof globalThis.Peer !== 'function') { setStatus('Online play is unavailable. Solo play still works.'); return; }
    role = 'host'; room = Array.from(crypto.getRandomValues(new Uint8Array(6)), v => 'abcdefghjkmnpqrstuvwxyz'[v % 22]).join('');
    setStatus('Opening your room…');
    try { peer = new globalThis.Peer('little-raft-' + room); bindPeer(peer, true); }
    catch { closeConnection(); setStatus('Online play is unavailable. Solo play still works.'); }
  });
  setHandler($('#joinForm'), 'onsubmit', e => {
    e.preventDefault(); const code = ($('#roomInput')?.value ?? '').trim().toLowerCase();
    if (!/^[a-z]{6}$/.test(code)) return setStatus('Enter the six letters from your brother’s screen.');
    closeConnection();
    if (typeof globalThis.Peer !== 'function') { setStatus('Online play is unavailable. Try solo for now.'); return; }
    ownWorldBackup = world; role = 'guest'; room = code; hook = null; fishWait = 0; charging = null; reeling = false;
    setStatus('Finding your brother’s raft…');
    try {
      peer = new globalThis.Peer(); bindPeer(peer, false);
      joinDeadline = performance.now() + JOIN_TIMEOUT; joinTimer = later(joinTimedOut, JOIN_TIMEOUT); // stays until the first state
    } catch { closeConnection(); setStatus('Online play is unavailable. Try solo for now.'); }
  });
  setHandler($('#copyRoom'), 'onclick', async () => { try { await navigator.clipboard.writeText(room.toUpperCase()); setStatus('Code copied. Send it to your brother!'); } catch { setStatus('Select the room code and copy it manually.'); } });

  // Adopt the live PeerJS objects from the previous engine: detach its exact listeners, attach ours. No reconnect.
  if (X) {
    // Old listeners remain until the successful swap calls old.dispose().
    if (peer && !peer.destroyed) bindPeer(peer, role === 'host');
    else if (peer?.destroyed) peer = null;
    if (conn) bindConn(conn, role === 'host');
    if (role === 'guest' && !networkReady) {
      if (!peer && !conn) { role = 'guest'; closeConnection(); }
      else { const left = joinDeadline ? joinDeadline - performance.now() : JOIN_TIMEOUT; if (!joinDeadline) joinDeadline = performance.now() + left; joinTimer = later(joinTimedOut, Math.max(0, left)); }
    }
  }

  // ---------- Read-only diagnostics (no mutating hooks) ----------
  function project(x, y, z) {
    if (!camera) return null;
    camera.updateMatrixWorld();
    const v = new T.Vector3(+x, +y, +z), inFront = v.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
    v.project(camera); const r = canvas.getBoundingClientRect();
    return {x:r.left + (v.x + 1) / 2 * r.width, y:r.top + (1 - v.y) / 2 * r.height, visible:inFront && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1};
  }
  const worldPos = o => { if (!o) return null; const p = o.getWorldPosition(new T.Vector3()); return {x:p.x, y:p.y, z:p.z, visible:o.visible}; };
  const debugApi = Object.freeze({
    get state() {
      const hc = castOut();
      return {
        running, tool, recipe, role, networkReady, pointerLocked:isLocked(), lockSupported, lockFallback, active, disposed,
        tiles:world.tiles.length, tileList:world.tiles.map(t => [...t]), decor:world.decor.map(d => ({...d})),
        stock:{...world.stock}, fish:world.fish, collected:world.collected, items:world.items.length,
        hook:hook ? (hook.fishing ? {fishing:true, id:null, t:hook.t, duration:hook.duration} : {fishing:false, id:hc.caught?.id ?? null, stage:hc.stage, x:hc.position.x, y:hc.position.y, z:hc.position.z, tension:hc.tension, distance:hc.distance}) : null,
        fishWait, hookStage:hook ? (hook.fishing ? 'fishing' : hook.stage) : 'idle', hookCaught:hc?.caught ? {...hc.caught} : null,
        hookHealth:hookHealth(), hookRange:16 + hookHealth() * .16, charge:chargeValue(), charging:!!charging, reeling,
        build:{active:tool === 'build', recipe, hover:hover ? {...hover} : null, candidates:scene ? placementCandidates().length : 0},
        me:{x:me.x, z:me.z, yaw, pitch}, other:other ? {...other} : null,
        avatars:{local:worldPos(player), remote:worldPos(friend)},
        camera:camera ? {x:camera.position.x, y:camera.position.y, z:camera.position.z, yaw, pitch, roll:camera.rotation.z, fov:camera.fov} : null,
        raft:raft ? {y:raft.position.y, pitch:raft.rotation.x, roll:raft.rotation.z} : null,
        hand:{x:handPos.x, y:handPos.y, z:handPos.z}, hover:hover ? {...hover} : null,
      };
    },
    project,
    get targets() {
      return world.items.map(it => {
        const m = itemMeshes.get(it.token), p = m ? m.position : {x:it.x, y:ITEM_FLOAT, z:it.z};
        return {id:it.id, token:it.token, type:it.type, x:p.x, y:p.y, z:p.z, distance:Math.hypot(it.x - me.x, it.z - me.z), pending:isPending(it), screen:project(p.x, p.y, p.z)};
      });
    },
    get placements() {
      if (!raft) return [];
      const y = raft.position.y + .22;
      return placementCandidates().map(({x, z}) => ({x, z, world:{x:x * 2, y, z:z * 2}, screen:project(x * 2, y, z * 2)}));
    },
  });
  window.raftDebug = debugApi;

  // ---------- Lifecycle ----------
  function capture() {
    return {
      version:2, world, me:{...me}, other:other ? {...other} : null, yaw, pitch, running, tool, recipe, elapsed, walkPhase,
      hook, fishWait, sound, audio, peer, conn, role, networkReady, room, ownWorldBackup, pending:new Map(pending),
      joinDeadline:joinTimer ? joinDeadline : 0, saveAvailable, lockFallback, keys:{...keys},
      charging:charging ? {...charging} : null, reeling, down:down ? {...down} : null, lastCaught,
      bindings:bindings.slice(), renderer,lastHostMessage,lastGuestMessage,
      raftPose:raft ? {y:raft.position.y, rx:raft.rotation.x, rz:raft.rotation.z} : {...raftPose},
    };
  }
  function pause() { active = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
  function resume() {
    if (disposed || active || !scene) return;
    active = true; last = performance.now(); rafId = requestAnimationFrame(animate);
  }
  function disposeScene() {
    if (!scene) return;
    const mats = new Set(), geos = new Set();
    scene.traverse(o => {
      if (o.geometry) geos.add(o.geometry);
      if (o.material) for (const m of [].concat(o.material)) mats.add(m);
      if (o.isLight && o.shadow?.dispose) o.shadow.dispose();
    });
    for (const m of materialCache.values()) mats.add(m);
    if (clothMat) mats.add(clothMat);
    for (const g of geos) { try { g.dispose(); } catch {} }
    for (const m of mats) { try { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); } catch {} }
    try { ocean?.dispose(); } catch {}
    materialCache.clear(); itemMeshes.clear(); scene.clear();
    scene = null; // renderer, canvas, AudioContext, peer and conn are left untouched
  }
  function dispose() {
    if (disposed) return;
    pause(); disposed = true; ac.abort();
    settingsController?.destroy();
    for (const id of timers) clearTimeout(id); timers.clear();
    unlisten(bindings.splice(0));
    try { if (window.raftDebug === debugApi) delete window.raftDebug; } catch {}
    disposeScene();
  }

  try {
    if (!canvas) throw new Error('#world canvas missing');
    init();
    settingsController=createSettings({onChange:next=>{options=next;if(renderer){renderer.setPixelRatio(Math.min(devicePixelRatio,next.graphics==='high'?1.7:next.graphics==='low'?1:1.3));renderer.shadowMap.enabled=next.graphics!=='low';}sound=next.volume>0;},onPause:()=>{keys={};charging=null;reeling=false;down=null;},onResume:()=>requestLock()});
    if (running) { const w = $('#welcome'); if (w) w.hidden = true; const h = $('#hud'); if (h) h.hidden = false; }
    if ($('#toast')?.classList.contains('show')) toastTimer = later(() => { toastTimer = 0; $('#toast')?.classList.remove('show'); }, 2600);
    active = true; last = performance.now(); rafId = requestAnimationFrame(animate);
  } catch (e) {
    console.error(e);dispose();for(const [el,prop,previous,next]of propertyHandlers)if(el[prop]===next)el[prop]=previous;
    setText('#loadError', 'The 3D ocean could not start. Try a current Chrome, Edge, or Safari browser with WebGL enabled.');
    const solo = $('#solo'); if (solo) solo.disabled = true;
    throw e;
  }

  return {capture, pause, resume, dispose};
}

export default mount;
