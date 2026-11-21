import * as T from './vendor/three.module.js';

// Avatars come from ./avatar.js (owned separately). Loaded defensively so a missing or
// broken module never stops the game; a tiny built-in avatar is used instead.
let createAvatarImpl = null;
try {
  const mod = await import('./avatar.js');
  createAvatarImpl = typeof mod.createAvatar === 'function' ? mod.createAvatar : (typeof mod.default === 'function' ? mod.default : null);
} catch (e) { console.warn('avatar.js unavailable, using fallback avatar', e); }

export function mount(transfer=null) {
let raf=0,paused=false,disposed=false;const abort=new AbortController(),emitters=[];
function listen(target,type,fn,options={}){target?.addEventListener(type,fn,{...options,signal:abort.signal});}
function trackOn(target,type,fn){target.on(type,fn);emitters.push([target,type,fn]);return target;}
const $ = s => document.querySelector(s), canvas = $('#world');
const RECIPES = [
  {id:'floor', name:'Raft floor', icon:'▦', cost:{wood:2}},
  {id:'sail', name:'Little sail', icon:'⛵', cost:{wood:4, leaf:3}},
  {id:'palm', name:'Palm pot', icon:'🌴', cost:{wood:2, leaf:3}},
  {id:'lantern', name:'Lantern', icon:'🏮', cost:{wood:1, scrap:2}},
  {id:'net', name:'Catch net', icon:'▤', cost:{wood:3, leaf:2}},
];
const SAVE = 'little-raft-v1';
const FLOOR_Y = .2, EYE_HEIGHT = 1.8, BODY_RADIUS = .3, WALK_SPEED = 2.6;
const LOOK_SENSITIVITY = .0022, DRAG_SENSITIVITY = .005, PITCH_LIMIT = 1.35;
const HOOK_REACH = 32, FISH_REACH = 26, PENDING_MS = 2500;
const NEIGHBOURS = [[1,0],[-1,0],[0,1],[0,-1]];

function newWorld() { return {tiles:Array.from({length:9}, (_, i) => [i % 3 - 1, Math.floor(i / 3) - 1]), decor:[], stock:{wood:5, leaf:3, scrap:1}, fish:0, collected:0, items:[]}; }
let world = newWorld(), saveAvailable = true;
try { const v = JSON.parse(localStorage.getItem(SAVE)); if (v?.tiles?.length && v.stock && v.decor && v.tiles.length <= 400) world = {...newWorld(), ...v, items:[]}; } catch { saveAvailable = false; }

let scene, camera, renderer, water, raft, itemsGroup, ghost, rope, hookMesh, friend, player, seaPositions;
let viewmodel, viewmodelHead, handTip;
let running = false, tool = 'hook', recipe = 'floor', elapsed = 0, last = performance.now();
let yaw = 0, pitch = -.12, walking = false, walkPhase = 0, swing = 0;
const pointer = new T.Vector2(), ray = new T.Raycaster(), plane = new T.Plane(new T.Vector3(0, 1, 0), -.22);
let hover = null, mouse = {x:0, y:0, inside:false};
let me = {x:0, z:1.2}, other = null, keys = {}, hook = null, fishWait = 0, sound = true, audio;
const pending = new Map(); // item token -> expiry time; hides items we already reeled in while the host confirms
let peer = null, conn = null, role = 'solo', networkReady = false, netClock = 0, saveClock = 0, networkTick = 0, room = '', joinTimer;
let ownWorldBackup = null; // a guest's own raft, restored when they leave the host's world
const lockSupported = typeof canvas.requestPointerLock === 'function';
let lockFallback = !lockSupported, pendingClick = null, down = null, uiSignature = '';

const hasTile = (x, z) => world.tiles.some(t => t[0] === x && t[1] === z);
const isLocked = () => document.pointerLockElement === canvas;
const dialogOpen = () => !!document.querySelector('dialog[open]');
const newToken = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

// ---------- Small mesh helpers ----------
const materialCache = new Map();
function mat(color) { if (!materialCache.has(color)) materialCache.set(color, new T.MeshStandardMaterial({color, roughness:.85, metalness:0})); return materialCache.get(color); }
function box(w, h, d, c, x = 0, y = 0, z = 0, parent) { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent?.add(m); return m; }
function cylinder(rt, rb, h, c, x, y, z, parent, n = 8) { const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, n), mat(c)); m.position.set(x, y, z); m.castShadow = true; parent?.add(m); return m; }
function sphere(r, c, x, y, z, parent) { const m = new T.Mesh(new T.IcosahedronGeometry(r, 1), mat(c)); m.position.set(x, y, z); parent?.add(m); return m; }
function disposeGeometry(o) { o.traverse(c => c.geometry?.dispose()); }

// ---------- Scene ----------
function init() {
  scene = new T.Scene(); scene.background = new T.Color('#99dfe1'); scene.fog = new T.Fog('#99dfe1', 52, 135);
  camera = new T.PerspectiveCamera(48, innerWidth / innerHeight, .05, 200); camera.rotation.order = 'YXZ'; scene.add(camera);
  renderer = transfer?.renderer || new T.WebGLRenderer({canvas, antialias:true}); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  scene.add(new T.HemisphereLight('#e5fff6', '#477d84', 2.4));
  const sun = new T.DirectionalLight('#fff2cb', 3.1); sun.position.set(-15, 28, 12); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, {left:-25, right:25, top:25, bottom:-25}); sun.shadow.bias = -.001; scene.add(sun);
  const geo = new T.PlaneGeometry(280, 280, 105, 105); geo.rotateX(-Math.PI / 2); seaPositions = geo.attributes.position;
  water = new T.Mesh(geo, new T.MeshStandardMaterial({color:'#168fa9', roughness:.32, metalness:.18, flatShading:true})); water.position.y = -.24; water.receiveShadow = true; scene.add(water);
  raft = new T.Group(); scene.add(raft); itemsGroup = new T.Group(); scene.add(itemsGroup);
  player = makeAvatar('#efae55'); friend = makeAvatar('#70a7e4'); friend.visible = false; raft.add(player, friend);
  ghost = new T.Mesh(new T.BoxGeometry(1.9, .13, 1.9), new T.MeshBasicMaterial({color:'#b6ffd0', transparent:true, opacity:.55, depthWrite:false})); ghost.visible = false; scene.add(ghost);
  rope = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({color:'#ffdf9c'})); rope.visible = false; rope.frustumCulled = false; scene.add(rope);
  hookMesh = new T.Mesh(new T.TorusGeometry(.16, .045, 5, 10, Math.PI * 1.65), mat('#cddcdf')); hookMesh.visible = false; scene.add(hookMesh);
  buildViewmodel();
  for (let i = 0; i < 12; i++) { const g = new T.Group(), a = i * 2.4, d = 65 + Math.random() * 25; g.position.set(Math.sin(a) * d, -.1, Math.cos(a) * d); cylinder(3, 5, .8, '#e6d7a3', 0, 0, 0, g); sphere(3.4, '#4f9b72', 0, 1.4, 0, g); palm(g, 0, 1, 0, 1.4); scene.add(g); }
  for (let i = 0; i < 24; i++) { const g = new T.Group(); for (let j = 0; j < 3; j++) sphere(1.3 + j * .35, '#e7f9eb', j * 1.4, Math.sin(j) * .5, 0, g); g.position.set((Math.random() - .5) * 170, 17 + Math.random() * 8, (Math.random() - .5) * 170); g.scale.y = .5; scene.add(g); }
  // Bright little foam flecks make the ocean readable without textures.
  for (let i = 0; i < 130; i++) { const m = new T.Mesh(new T.PlaneGeometry(.3 + Math.random() * .9, .045), new T.MeshBasicMaterial({color:'#8cdbdc', transparent:true, opacity:.48})); m.rotation.x = -Math.PI / 2; m.position.set((Math.random() - .5) * 110, .02, (Math.random() - .5) * 110); scene.add(m); }
  rebuildRaft(); if(!world.items.length)for (let i = 0; i < 30; i++) world.items.push(makeItem(i)); syncItems(); updateHUD(); setTool(tool); animate();
}

function fallbackAvatar(color) {
  const g = new T.Group();
  cylinder(.21, .25, .58, color, 0, .64, 0, g); sphere(.23, '#f2c69b', 0, 1.14, 0, g); cylinder(.28, .28, .07, '#f7e7b5', 0, 1.32, 0, g); cylinder(.17, .19, .16, '#f7e7b5', 0, 1.4, 0, g);
  box(.13, .22, .15, '#314d53', -.13, .25, 0, g); box(.13, .22, .15, '#314d53', .13, .25, 0, g); box(.07, .07, .04, '#213d40', -.085, 1.16, .2, g); box(.07, .07, .04, '#213d40', .085, 1.16, .2, g);
  return g;
}
function makeAvatar(color) {
  try {
    const g = createAvatarImpl?.(T, color);
    if (g?.isObject3D) { g.traverse(c => { if (c.isMesh) c.castShadow = true; }); return g; }
  } catch (e) { console.warn('createAvatar failed, using fallback avatar', e); }
  return fallbackAvatar(color);
}

// A friendly wooden hook held in the right hand, attached to the camera.
function buildViewmodel() {
  viewmodel = new T.Group(); viewmodel.position.set(.34, -.36, -.7); viewmodel.rotation.set(-.3, .1, .2);
  const mitten = sphere(.085, '#f2c69b', 0, -.02, 0, viewmodel); mitten.scale.set(1, 1.25, 1);
  cylinder(.075, .075, .07, '#efae55', 0, -.13, 0, viewmodel, 12);                 // sleeve cuff
  cylinder(.024, .03, .62, '#a8774a', 0, .17, 0, viewmodel);                       // handle
  for (let i = 0; i < 3; i++) { const coil = new T.Mesh(new T.TorusGeometry(.045, .014, 5, 14), mat('#ffdf9c')); coil.rotation.x = Math.PI / 2; coil.position.y = .1 + i * .028; viewmodel.add(coil); }
  handTip = new T.Object3D(); handTip.position.y = .48; viewmodel.add(handTip);   // rope leaves from here
  viewmodelHead = new T.Group(); viewmodelHead.position.y = .48; viewmodel.add(viewmodelHead);
  cylinder(.014, .014, .07, '#cddcdf', 0, .035, 0, viewmodelHead);                  // shank
  const arc = Math.PI * 1.4, curve = new T.Mesh(new T.TorusGeometry(.08, .017, 6, 16, arc), mat('#cddcdf'));
  curve.position.set(.08, .07, 0); curve.rotation.z = Math.PI - arc; viewmodelHead.add(curve);
  const barb = new T.Mesh(new T.ConeGeometry(.025, .06, 6), mat('#cddcdf')); barb.position.set(.105, -.01, 0); viewmodelHead.add(barb);
  viewmodel.traverse(c => { if (c.isMesh) { c.castShadow = false; c.receiveShadow = false; } });
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
    const g = new T.Group(); g.position.set(x * 2, 0, z * 2);
    for (let k = 0; k < 4; k++) { box(.455, .24, 1.94, ['#bb8a53', '#c8995f', '#d3a368'][(i + k) % 3], -.735 + k * .49, .08, 0, g); for (const n of [-.72, .72]) box(.035, .012, .035, '#6f6254', -.735 + k * .49, .207, n, g); }
    box(1.8, .18, .17, '#8c6745', 0, -.08, -.72, g); box(1.8, .18, .17, '#8c6745', 0, -.08, .72, g); raft.add(g);
  });
  for (const d of world.decor) {
    const g = new T.Group(); g.position.set(d.x * 2, .22, d.z * 2);
    if (d.type === 'sail') { cylinder(.065, .08, 3.8, '#906f48', 0, 1.9, 0, g); box(2.5, .07, .07, '#906f48', 0, 3.2, 0, g); const sail = new T.Mesh(new T.PlaneGeometry(2.35, 2.1), new T.MeshStandardMaterial({color:'#fff3cf', side:T.DoubleSide, roughness:1})); sail.position.set(0, 2.15, .06); g.add(sail); box(.23, 2.1, .025, '#e79960', -.85, 2.15, .09, g); }
    if (d.type === 'palm') { cylinder(.38, .28, .5, '#db8764', 0, .25, 0, g); cylinder(.32, .32, .03, '#654f36', 0, .51, 0, g); palm(g, 0, .5, 0); }
    if (d.type === 'lantern') { cylinder(.055, .075, 1.8, '#725942', 0, .9, 0, g); box(.55, .07, .07, '#725942', .22, 1.8, 0, g); box(.32, .42, .32, '#ffe197', .43, 1.5, 0, g); box(.4, .06, .4, '#596a63', .43, 1.74, 0, g); const l = new T.PointLight('#ffd17c', 2, 4); l.position.set(.43, 1.5, 0); g.add(l); }
    if (d.type === 'net') { for (let k = 0; k < 6; k++) { box(.025, .05, 1.7, '#ebe1bd', -.8 + k * .32, .05, 0, g); box(1.7, .05, .025, '#ebe1bd', 0, .05, -.8 + k * .32, g); } for (const a of [-.88, .88]) box(.1, .1, 1.9, '#756a49', a, .05, 0, g); }
    raft.add(g);
  }
  updateHUD();
}

// ---------- Floating supplies ----------
function makeItem(id) { const a = Math.random() * Math.PI * 2, r = 9 + Math.random() * 17; return {id, token:newToken(), type:['wood', 'wood', 'leaf', 'scrap', 'barrel'][Math.floor(Math.random() * 5)], x:Math.sin(a) * r, z:Math.cos(a) * r, phase:Math.random() * 6}; }
// Meshes are keyed by token, not id: a respawned item keeps its id but may change type.
const itemMeshes = new Map();
function syncItems() {
  const live = new Set(world.items.map(x => x.token));
  for (const [token, m] of itemMeshes) if (!live.has(token)) { itemsGroup.remove(m); disposeGeometry(m); itemMeshes.delete(token); }
  for (const token of pending.keys()) if (!live.has(token)) pending.delete(token);
  for (const item of world.items) {
    if (itemMeshes.has(item.token)) continue;
    const g = new T.Group(); g.userData.token = item.token;
    if (item.type === 'wood') { box(.38, .14, 1.3, '#d5a265', 0, 0, 0, g); box(.035, .01, 1.1, '#a97d4c', .09, .075, 0, g); }
    if (item.type === 'leaf') { for (let i = 0; i < 3; i++) { const m = new T.Mesh(new T.OctahedronGeometry(.56, 0), mat('#83b85b')); m.scale.set(.45, .12, 1.4); m.rotation.y = i * .6; m.position.x = (i - 1) * .2; g.add(m); } }
    if (item.type === 'scrap') { box(.6, .17, .55, '#9ac5c9', 0, 0, 0, g); box(.15, .22, .2, '#658d97', .2, .15, .12, g); }
    if (item.type === 'barrel') { cylinder(.37, .37, .8, '#b4824b', 0, .18, 0, g); for (const y of [-.06, .42]) cylinder(.385, .385, .075, '#5c7980', 0, y, 0, g); }
    g.position.set(item.x, .12, item.z);
    itemsGroup.add(g); itemMeshes.set(item.token, g);
  }
}
const isPending = it => (pending.get(it.token) ?? 0) > performance.now();

// ---------- HUD ----------
function toast(s) { const el = $('#toast'); if (!el) return; el.textContent = s; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600); }
function beep(f = 500) { if (!sound) return; try { audio ??= new AudioContext(); audio.resume(); const o = audio.createOscillator(), g = audio.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f, audio.currentTime); o.frequency.exponentialRampToValueAtTime(f * 1.4, audio.currentTime + .12); g.gain.setValueAtTime(.06, audio.currentTime); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .22); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + .23); } catch {} }
function updateHUD() {
  for (const k of ['wood', 'leaf', 'scrap']) $('#' + k).textContent = world.stock[k];
  $('#fishCount').textContent = `${world.fish} fish caught`;
  const n = world.tiles.length; $('#progress').style.width = Math.min(100, (n - 9) / 7 * 100) + '%';
  $('#goalText').textContent = world.collected === 0 ? 'Hook a floating supply to get started' : n < 16 ? `Build your raft: ${n} / 16 floors` : 'A lovely little home. Keep creating!';
  $('#recipes').innerHTML = RECIPES.map(r => `<button data-recipe="${r.id}" class="${recipe === r.id ? 'active' : ''}" aria-pressed="${recipe === r.id}"><span>${r.icon}</span>${r.name}<small>${Object.entries(r.cost).map(([k, v]) => v + ' ' + k).join(' · ')}</small></button>`).join('');
}
function aimHintText() {
  const aiming = isLocked() ? 'Point the dot' : lockFallback ? 'Point' : 'Click the ocean to look around, then point';
  if (tool === 'build') return isLocked() ? 'Point the dot at a green space and click to build · E for recipes' : 'Pick a recipe, then click the ocean to aim';
  if (tool === 'fish') return `${aiming} at the sea and click, then wait for a bite`;
  return `${aiming} at a floating supply and click to hook it`;
}
function setTool(t) {
  const previous = tool; tool = t; hover = null; ghost.visible = false;
  document.body.classList.toggle('build', t === 'build'); $('#recipes').hidden = t !== 'build';
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('selected', b.dataset.tool === t));
  if (t === 'build' && previous !== 'build') releaseLock(); // free the cursor so recipes can be clicked
  refreshPointerUI(true);
}
// Crosshair, resume hint and aim text follow pointer-lock state. Elements are optional.
function refreshPointerUI(force = false) {
  const locked = isLocked(), dialog = dialogOpen();
  const signature = [running, locked, dialog, tool, lockFallback].join();
  if (!force && signature === uiSignature) return; uiSignature = signature;
  document.body.classList.toggle('pointer-locked', locked); document.body.classList.toggle('first-person', running);document.body.classList.toggle('playing',running);document.body.classList.toggle('locked',locked);
  const crosshair = $('#crosshair'); if (crosshair) crosshair.hidden = !(running && locked);
  const resume = $('#resumeHint'); if (resume) resume.hidden = !(running && !locked && lockSupported && !dialog);
  const aim = $('#aimHint'); if (aim) aim.textContent = aimHintText();
}

// ---------- Pointer lock ----------
function requestLock(click) {
  if (!running) return;
  if (!lockSupported) { if (click) cast(pickScreen(click.x, click.y)); return; }
  pendingClick = click ? {...click, t:performance.now()} : null;
  try { const p = canvas.requestPointerLock(); p?.catch?.(lockFailed); } catch { lockFailed(); }
}
// If pointer lock is refused (iframe, browser cooldown after Escape, tests), act on the click with the mouse ray.
function lockFailed() {
  lockFallback = true; const click = pendingClick; pendingClick = null; refreshPointerUI(true);
  if (click && running && performance.now() - click.t < 2000) cast(pickScreen(click.x, click.y));
}
function releaseLock() { if (isLocked()) document.exitPointerLock?.(); }
listen(document,'pointerlockchange', () => { if (isLocked()) { lockFallback = false; pendingClick = null; } down = null; refreshPointerUI(true); });
listen(document,'pointerlockerror', lockFailed);
function look(dx, dy, k) { yaw -= dx * k; pitch = T.MathUtils.clamp(pitch - dy * k, -PITCH_LIMIT, PITCH_LIMIT); }
listen(document,'mousemove', e => {
  if (!isLocked() || dialogOpen()) return;
  look(T.MathUtils.clamp(e.movementX, -200, 200), T.MathUtils.clamp(e.movementY, -200, 200), LOOK_SENSITIVITY);
});

// ---------- Aiming ----------
function pickNdc(nx, ny) {
  pointer.set(nx, ny); ray.setFromCamera(pointer, camera);
  let item = null;
  for (const hit of ray.intersectObjects(itemsGroup.children, true)) {
    let o = hit.object; while (o && !o.userData.token) o = o.parent;
    item = o && world.items.find(it => it.token === o.userData.token);
    if (item) break;
  }
  return {point:ray.ray.intersectPlane(plane, new T.Vector3()), item:item || null};
}
function pickScreen(x, y) { const r = canvas.getBoundingClientRect(); return pickNdc((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); }
const pickCenter = () => pickNdc(0, 0);
// Which ray drives aiming right now: centre when locked, mouse when lock is unavailable.
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

// ---------- Actions (host is authoritative) ----------
function send(data) { if (conn?.open) conn.send(data); }
function action(a) { if (role === 'guest') { if (!networkReady) return toast('Wait for your raft to connect'); send({type:'action', a}); } else applyAction(a); }
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
    if (!r || !Number.isInteger(a.x) || !Number.isInteger(a.z) || Math.abs(a.x) > 25 || Math.abs(a.z) > 25 || world.tiles.length >= 400) return;
    const valid = r.id === 'floor' ? !hasTile(a.x, a.z) && NEIGHBOURS.some(([x, z]) => hasTile(a.x + x, a.z + z)) : hasTile(a.x, a.z) && !world.decor.some(d => d.x === a.x && d.z === a.z);
    if (!valid) return;
    if (Object.entries(r.cost).some(([k, n]) => world.stock[k] < n)) { emit({kind:'notice', text:'Hook a few more supplies for that recipe'}); return; }
    for (const [k, n] of Object.entries(r.cost)) world.stock[k] -= n;
    r.id === 'floor' ? world.tiles.push([a.x, a.z]) : world.decor.push({type:r.id, x:a.x, z:a.z});
    rebuildRaft(); emit({kind:'build', text:r.id === 'floor' ? 'A little more room!' : `${r.name} crafted!`});
  } else if (a.kind === 'fish') { world.fish++; emit({kind:'loot', text:'You caught a fish! 🐟'}); }
  updateHUD();
}
function effect(e) { toast(e.text); beep(e.kind === 'build' ? 640 : 440); }
function emit(e) { effect(e); send({type:'effect', e}); }

function cast(target) {
  if (!running || hook || fishWait) return;
  const p = target?.point ?? null;
  if (tool === 'build') {
    const v = placement(p); if (!v) return toast(recipe === 'floor' ? 'Point at an empty space beside the raft' : 'Point at an empty raft floor');
    swing = 1; action({kind:'build', recipe, ...v}); return;
  }
  if (tool === 'fish') {
    if (!p || hasTile(Math.round(p.x / 2), Math.round(p.z / 2))) return toast('Point at the water to fish');
    if (Math.hypot(p.x - me.x, p.z - me.z) > FISH_REACH) return toast('Try a spot a little closer');
    fishWait = 3 + Math.random() * 2; hook = {end:new T.Vector3(p.x, .1, p.z), t:0, duration:fishWait + .8, fishing:true};
    swing = 1; toast('Bobbing along… wait for a bite!'); beep(280); return;
  }
  let closest = target?.item && !isPending(target.item) ? target.item : null;
  if (!closest && p) {
    let best = Infinity;
    for (const it of world.items) {
      if (isPending(it)) continue;
      const d = Math.hypot(it.x - p.x, it.z - p.z), forgiving = 2.5 + Math.hypot(it.x - me.x, it.z - me.z) * .06;
      if (d < forgiving && d < best) { best = d; closest = it; }
    }
  }
  if (!closest) return toast('Aim at a floating plank, leaf, scrap, or barrel');
  if (Math.hypot(closest.x - me.x, closest.z - me.z) > HOOK_REACH) return toast('That one is a little too far away');
  hook = {end:new T.Vector3(closest.x, .15, closest.z), t:0, duration:1.4, id:closest.id, token:closest.token};
  swing = 1; beep(230);
}

function start() { running = true; $('#welcome').hidden = true; $('#hud').hidden = false; if (!saveAvailable) $('#saveStatus').textContent = 'Browser storage is unavailable. This session will not be saved.'; refreshPointerUI(true); }
function save() { if (role === 'guest') return; try { localStorage.setItem(SAVE, JSON.stringify({...world, items:[]})); } catch { saveAvailable = false; $('#saveStatus').textContent = 'Browser storage is full or unavailable. This session will not be saved.'; } }

// ---------- Movement ----------
// Keep the whole body (not just its centre) over a raft floor so nobody walks off the edge.
function onRaft(x, z) {
  for (const sx of [-BODY_RADIUS, BODY_RADIUS]) for (const sz of [-BODY_RADIUS, BODY_RADIUS]) if (!hasTile(Math.round((x + sx) / 2), Math.round((z + sz) / 2))) return false;
  return true;
}
function ensureOnRaft() { if (!onRaft(me.x, me.z)) { me.x = 0; me.z = 0; } }
const held = (...codes) => codes.some(c => keys[c]);
function movePlayer(dt) {
  const fwd = held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'), side = held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft');
  walking = !!(fwd || side); if (!walking) return;
  const step = WALK_SPEED * dt / Math.hypot(fwd, side), s = Math.sin(yaw), c = Math.cos(yaw);
  // Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
  const mx = (-s * fwd + c * side) * step, mz = (-c * fwd - s * side) * step;
  if (onRaft(me.x + mx, me.z)) me.x += mx;
  if (onRaft(me.x, me.z + mz)) me.z += mz;
  walkPhase += dt * 9;
}

// ---------- Frame ----------
const handPos = new T.Vector3();
function updateCamera(dt) {
  const fov = running ? 70 : 48; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (running) {
    const bob = walking ? Math.sin(walkPhase) * .025 : 0;
    camera.position.set(me.x, raft.position.y + EYE_HEIGHT + bob, me.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  } else { // gentle cinematic view for the welcome screen
    const focus = new T.Vector3(-5, 0, 2), d = 23, cy = .68 + Math.sin(elapsed * .05) * .12, cp = .77;
    camera.position.set(focus.x + Math.sin(cy) * d * Math.cos(cp), d * Math.sin(cp), focus.z + Math.cos(cy) * d * Math.cos(cp)); camera.lookAt(focus);
  }
  swing = Math.max(0, swing - dt * 3);
  viewmodel.visible = running; viewmodelHead.visible = !hook;
  viewmodel.position.y = -.36 + (walking ? Math.abs(Math.sin(walkPhase)) * -.02 : Math.sin(elapsed * 1.5) * .005);
  viewmodel.rotation.x = -.3 - Math.sin(swing * Math.PI) * .7;
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
  if (role !== 'guest') {
    let respawned = false;
    for (const it of world.items) {
      it.z += dt * .22; it.x += Math.sin(elapsed * .13 + it.phase) * dt * .04;
      if (Math.hypot(it.x, it.z) > 29 || hasTile(Math.round(it.x / 2), Math.round(it.z / 2))) { Object.assign(it, makeItem(it.id)); respawned = true; }
    }
    if (respawned) syncItems();
  }
  for (const it of world.items) {
    const m = itemMeshes.get(it.token); if (!m) continue;
    m.visible = !isPending(it); m.scale.setScalar(1);
    m.position.set(it.x, .12 + Math.sin(elapsed * 1.6 + it.phase) * .1, it.z); m.rotation.y = it.phase + elapsed * .08; m.rotation.z = Math.sin(elapsed + it.phase) * .09;
  }
}
function updateHook(dt) {
  if (!hook) { rope.visible = false; hookMesh.visible = false; return; }
  hook.t += dt; const f = hook.t / hook.duration, u = hook.fishing ? Math.min(1, f * 5) : f < .5 ? f * 2 : 2 - f * 2;
  const pos = handPos.clone().lerp(hook.end, u);
  if (hook.fishing) { if (u >= 1) pos.y += Math.sin(elapsed * 5) * .03 - (hook.t > fishWait ? .12 : 0); else pos.y += Math.sin(u * Math.PI) * 1.2; }
  else pos.y += Math.sin(u * Math.PI) * 2;
  rope.geometry.setFromPoints([handPos.clone(), pos]); rope.visible = true; hookMesh.visible = true; hookMesh.position.copy(pos); hookMesh.rotation.y = yaw;
  if (!hook.fishing && f > .5) { const m = itemMeshes.get(hook.token); if (m && world.items.some(i => i.token === hook.token)) { m.position.copy(pos); m.scale.setScalar(Math.max(.25, Math.min(1, u * 4))); } }
  if (f >= 1) {
    if (hook.fishing) action({kind:'fish'});
    else { pending.set(hook.token, performance.now() + PENDING_MS); action({kind:'collect', id:hook.id, token:hook.token}); }
    hook = null; fishWait = 0;
  }
}
function updateGhost(dialog) {
  hover = running && tool === 'build' && !dialog ? placement(currentAim()?.point) : null;
  ghost.visible = !!hover; if (hover) ghost.position.set(hover.x * 2, raft.position.y + .29, hover.z * 2);
}
function animate() {
  if(paused||disposed)return;raf=requestAnimationFrame(animate);
  const now = performance.now(), dt = Math.min((now - last) / 1000, .05); last = now; elapsed += dt;
  const dialog = dialogOpen();
  if (running && !dialog) movePlayer(dt); else walking = false;
  raft.position.y = Math.sin(elapsed * .9) * .035; raft.rotation.z = Math.sin(elapsed * .7) * .004;
  updateAvatars(dt); updateCamera(dt);
  for (let i = 0; i < seaPositions.count; i++) { const x = seaPositions.getX(i), z = seaPositions.getZ(i); seaPositions.setY(i, Math.sin(x * .5 + elapsed * .8) * .09 + Math.sin(z * .6 + elapsed * .6) * .07); }
  seaPositions.needsUpdate = true;
  updateItems(dt); updateHook(dt); updateGhost(dialog);
  if (running && role !== 'guest') {
    netClock += dt;
    if (netClock > .8) { netClock = 0; for (const net of world.decor.filter(d => d.type === 'net')) { const it = world.items.find(it => Math.hypot(it.x - net.x * 2, it.z - net.z * 2) < 4); if (it) applyAction({kind:'collect', id:it.id, token:it.token}); } }
  }
  if (running) { saveClock += dt; if (saveClock > 3) { saveClock = 0; save(); } }
  if (conn?.open) { networkTick += dt; if (networkTick > .12) { networkTick = 0; const pose = {x:me.x, z:me.z, yaw}; send(role === 'host' ? {type:'state', world, other:pose} : {type:'move', me:pose}); } }
  refreshPointerUI();
  renderer.render(scene, camera);
}

// ---------- Input ----------
listen(canvas,'pointerdown', e => {
  if (!running) return;
  if (isLocked()) { if (e.button === 0) cast(pickCenter()); return; }
  down = {x:e.clientX, y:e.clientY, moved:false}; try { canvas.setPointerCapture(e.pointerId); } catch {}
});
listen(canvas,'pointermove', e => {
  mouse = {x:e.clientX, y:e.clientY, inside:true};
  if (!down || isLocked()) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  if (Math.hypot(dx, dy) > 4) down.moved = true;
  if (down.moved) { look(dx, dy, DRAG_SENSITIVITY); down.x = e.clientX; down.y = e.clientY; } // drag-look fallback
});
listen(canvas,'pointerup', e => {
  const wasClick = down && !down.moved; down = null;
  if (!wasClick || !running || isLocked() || e.button !== 0) return;
  requestLock({x:e.clientX, y:e.clientY}); // resumes look; casts with the mouse ray if lock is refused
});
listen(canvas,'pointerleave', () => { mouse.inside = false; });
listen(canvas,'pointercancel', () => down = null);
listen(canvas,'contextmenu', e => e.preventDefault());
listen($('#resumeHint'),'click', () => requestLock(null));

function toggleCrafting() {
  if (!running) return;
  if (isLocked()) { setTool('build'); releaseLock(); }
  else if (tool === 'build') requestLock(null);
  else setTool('build');
}
listen(window,'keydown', e => {
  if (e.target.matches?.('input, textarea') || dialogOpen()) return;
  keys[e.code] = true;
  const digit = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code) + 1 || ['Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code) + 1 || +(['1', '2', '3'].includes(e.key) && e.key);
  if (digit) setTool(['hook', 'build', 'fish'][digit - 1]);
  if (e.code === 'KeyE' && !e.repeat) toggleCrafting();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
listen(window,'keyup', e => { keys[e.code] = false; });
listen(window,'blur', () => { keys = {}; });
listen(window,'beforeunload', save);
listen(window,'resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

function openDialog(id) { releaseLock(); $('#' + id).showModal(); }
$('#solo').onclick = () => { start(); requestLock(null); };
$('#crewButton').onclick = $('#welcomeCrew').onclick = () => openDialog('crew');
$('#helpButton').onclick = () => openDialog('help');
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $('#' + b.dataset.close).close());
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('#recipes').onclick = e => { const b = e.target.closest('[data-recipe]'); if (b) { recipe = b.dataset.recipe; updateHUD(); refreshPointerUI(true); } };
$('#soundButton').onclick = () => { sound = !sound; $('#soundButton').textContent = 'Sound: ' + (sound ? 'on' : 'off'); };

// ---------- Networking (PeerJS, host authoritative) ----------
function status(s) { $('#networkStatus').textContent = s; }
function validPose(p) { return p && Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) < 55 && Math.abs(p.z) < 55 ? {x:p.x, z:p.z, yaw:Number.isFinite(p.yaw) ? p.yaw : 0} : null; }
// A guest plays in the host's world; when they leave, put their own raft back so autosave never overwrites it.
function restoreOwnRaft() {
  if (!ownWorldBackup) return;
  world = ownWorldBackup; ownWorldBackup = null; world.items ??= [];
  if (!world.items.length) if(!world.items.length)for (let i = 0; i < 30; i++) world.items.push(makeItem(i));
  hook = null; fishWait = 0; pending.clear(); syncItems(); rebuildRaft(); updateHUD(); ensureOnRaft();
}
function closeConnection() {
  clearTimeout(joinTimer); networkReady = false; const old = conn; conn = null; old?.close(); peer?.destroy(); peer = null; other = null;
  if (role === 'guest') restoreOwnRaft();
  role = 'solo'; $('#connection').textContent = 'YOUR OWN LITTLE OCEAN'; $('#roomDisplay').hidden = true;
}
function handleConnection(c, isHost) {
  conn = c;
  trackOn(c,'open', () => {
    if (conn !== c) return;
    clearTimeout(joinTimer); networkReady = true; status('Connected! Your brother is aboard.'); $('#connection').textContent = `TWO ABOARD · ${room.toUpperCase()}`;
    $('#crew').close(); start(); toast('Your brother joined the raft!'); if (isHost) send({type:'state', world, other:{x:me.x, z:me.z, yaw}});
  });
  trackOn(c,'data', data => {
    if (conn !== c || !data || typeof data !== 'object') return;
    if (isHost) {
      if (data.type === 'action') applyAction(data.a);
      if (data.type === 'move') other = validPose(data.me) ?? other;
    } else {
      if (data.type === 'state' && data.world?.tiles?.length && data.world?.stock) {
        const changed = JSON.stringify([world.tiles, world.decor]) !== JSON.stringify([data.world.tiles, data.world.decor]);
        world = data.world; world.items = Array.isArray(world.items) ? world.items : []; other = validPose(data.other);
        syncItems(); if (changed) { rebuildRaft(); ensureOnRaft(); } updateHUD();
      }
      if (data.type === 'effect' && data.e) effect(data.e);
    }
  });
  trackOn(c,'close', () => {
    if (conn !== c) return;
    networkReady = false; other = null;
    $('#connection').textContent = isHost ? 'BROTHER LEFT · ROOM OPEN' : 'DISCONNECTED';
    if (!isHost) {
      conn = null; restoreOwnRaft(); role = 'solo';
      status('Host disconnected. Rejoin when their tab is open.'); toast('Host disconnected. You are back on your own raft.');
    } else toast('Your brother left. Your raft is still here.');
  });
  trackOn(c,'error', () => status('Connection failed. Check the code and try again.'));
}
$('#host').onclick = () => {
  if (role === 'host' && peer && !peer.destroyed) { status('Your room is open. Share the code below.'); return; }
  closeConnection(); role = 'host';
  room = Array.from(crypto.getRandomValues(new Uint8Array(6)), v => 'abcdefghjkmnpqrstuvwxyz'[v % 22]).join('');
  status('Opening your room…');
  try {
    peer = new Peer('little-raft-' + room);
    trackOn(peer,'open', () => { $('#roomCode').textContent = room.toUpperCase(); $('#roomDisplay').hidden = false; $('#connection').textContent = 'ROOM ' + room.toUpperCase(); status('Room ready. Send this code to your brother.'); start(); });
    trackOn(peer,'connection', c => { if (conn?.open) { trackOn(c,'open', () => c.close()); return; } handleConnection(c, true); });
    trackOn(peer,'error', e => { status('Could not open room: ' + e.type + '. Solo play still works.'); });
  } catch { status('Online play is unavailable. Solo play still works.'); }
};
$('#joinForm').onsubmit = e => {
  e.preventDefault(); const code = $('#roomInput').value.trim().toLowerCase();
  if (!/^[a-z]{6}$/.test(code)) return status('Enter the six letters from your brother’s screen.');
  closeConnection(); ownWorldBackup = world; role = 'guest'; room = code; hook = null; fishWait = 0;
  status('Finding your brother’s raft…');
  try {
    peer = new Peer();
    trackOn(peer,'open', () => handleConnection(peer.connect('little-raft-' + room, {reliable:true}), false));
    trackOn(peer,'error', e => status('Could not connect: ' + e.type + '. Check the code and host’s tab.'));
    joinTimer = setTimeout(() => { if (!networkReady) status('Connection timed out. Check the room code. Your networks may block direct play.'); }, 15000);
  } catch { status('Online play is unavailable. Try solo for now.'); }
};
$('#copyRoom').onclick = async () => { try { await navigator.clipboard.writeText(room.toUpperCase()); status('Code copied. Send it to your brother!'); } catch { status('Select the room code and copy it manually.'); } };

if(transfer){world=transfer.world;me={...transfer.me};other=transfer.other;yaw=transfer.yaw;pitch=transfer.pitch;running=transfer.running;tool=transfer.tool;recipe=transfer.recipe;elapsed=transfer.elapsed;hook=transfer.hook;fishWait=transfer.fishWait;sound=transfer.sound;audio=transfer.audio;peer=transfer.peer;conn=transfer.conn;role=transfer.role;networkReady=transfer.networkReady;room=transfer.room;ownWorldBackup=transfer.ownWorldBackup;}
try { init(); } catch (e) { console.error(e); $('#loadError').textContent = 'The 3D ocean could not start. Try a current Chrome, Edge, or Safari browser with WebGL enabled.'; $('#solo').disabled = true; }

// ---------- Read-only diagnostics for local verification (no mutating hooks) ----------
function project(x, y, z) {
  if (!camera) return null;
  camera.updateMatrixWorld();
  const v = new T.Vector3(+x, +y, +z), inFront = v.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
  v.project(camera); const r = canvas.getBoundingClientRect();
  return {x:r.left + (v.x + 1) / 2 * r.width, y:r.top + (1 - v.y) / 2 * r.height, visible:inFront && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1};
}
const worldPos = o => { if (!o) return null; const p = o.getWorldPosition(new T.Vector3()); return {x:p.x, y:p.y, z:p.z, visible:o.visible}; };
window.raftDebug = Object.freeze({
  get state() {
    return {
      running, tool, recipe, role, networkReady, pointerLocked:isLocked(), lockSupported, lockFallback,
      tiles:world.tiles.length, tileList:world.tiles.map(t => [...t]), decor:world.decor.map(d => ({...d})),
      stock:{...world.stock}, fish:world.fish, collected:world.collected, items:world.items.length,
      hook:hook ? {fishing:!!hook.fishing, id:hook.id ?? null, t:hook.t, duration:hook.duration} : null, fishWait,
      me:{x:me.x, z:me.z, yaw, pitch}, other:other ? {...other} : null,
      avatars:{local:worldPos(player), remote:worldPos(friend)},
      camera:camera ? {x:camera.position.x, y:camera.position.y, z:camera.position.z, yaw, pitch, fov:camera.fov} : null,
      hand:{x:handPos.x, y:handPos.y, z:handPos.z}, hover:hover ? {...hover} : null,
    };
  },
  project,
  get targets() {
    return world.items.map(it => {
      const m = itemMeshes.get(it.token), p = m ? m.position : {x:it.x, y:.12, z:it.z};
      return {id:it.id, token:it.token, type:it.type, x:p.x, y:p.y, z:p.z, distance:Math.hypot(it.x - me.x, it.z - me.z), pending:isPending(it), screen:project(p.x, p.y, p.z)};
    });
  },
  get placements() {
    const y = (raft?.position.y ?? 0) + .22;
    return placementCandidates().map(({x, z}) => ({x, z, world:{x:x * 2, y, z:z * 2}, screen:project(x * 2, y, z * 2)}));
  },
});

return {
 capture(){return {world,me:{...me},other,yaw,pitch,running,tool,recipe,elapsed,hook,fishWait,sound,audio,peer,conn,role,networkReady,room,ownWorldBackup,pending,renderer};},
 pause(){paused=true;cancelAnimationFrame(raf);},
 resume(){if(disposed)return;paused=false;last=performance.now();animate();},
 dispose(){disposed=true;cancelAnimationFrame(raf);abort.abort();for(const [target,type,fn]of emitters)target.off(type,fn);clearTimeout(joinTimer);clearTimeout(toast.timer);scene.traverse(o=>{o.geometry?.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(m){m.map?.dispose();m.dispose();}}});}
};
}
