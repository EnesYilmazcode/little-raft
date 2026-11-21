// UI feel sandbox: write-only DOM HUD over a Three.js scene.
// Rules shown here: reads happen once on resize, writes are batched into the
// frame, motion is transform/opacity only, nodes are pooled, never rebuilt.
import * as THREE from '../../dist/vendor/three.module.js';

// ---------- frame-batched DOM writes ----------
const writes = [];
let writeCount = 0;
const queue = fn => { writes.push(fn); };
function flushWrites() {
  for (let i = 0; i < writes.length; i++) writes[i]();
  writeCount += writes.length;
  writes.length = 0;
}

// ---------- background scene (cheap) ----------
const canvas = document.getElementById('world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6cc4d6);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.position.set(0, 1.6, 4);
scene.add(new THREE.HemisphereLight(0xffffff, 0x2a6a80, 2));
const sea = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: 0x2f8fb0 }));
sea.rotation.x = -Math.PI / 2;
scene.add(sea);
const raft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 1.6), new THREE.MeshLambertMaterial({ color: 0x8a5f35 }));
raft.position.y = 0.1;
scene.add(raft);

// ---------- hotbar ----------
const ITEMS = [
  ['H', 'Hook', 1], ['P', 'Plank', 14], ['L', 'Plastic', 6], ['S', 'Scrap', 3],
  ['R', 'Rope', 0], ['', '', 0], ['N', 'Net', 1], ['F', 'Rod', 1],
];
const hotbar = document.getElementById('hotbar');
const cursor = document.getElementById('hbCursor');
const slots = ITEMS.map(([ico, name, n], i) => {
  const el = document.createElement('div');
  el.className = 'slot';
  el.title = name;
  el.innerHTML = `<kbd>${i + 1}</kbd><span class="ico">${ico}</span><b>${n > 1 ? n : ''}</b>`;
  hotbar.appendChild(el);
  return { el, ico: el.querySelector('.ico'), count: el.querySelector('b'), n };
});

let slotX = [];          // cached once per resize: the only layout read
let selected = 0;
function measure() {
  slotX = slots.map(s => s.el.offsetLeft - 6); // 6 = hotbar padding, cursor sits at left:6px
}
function select(i) {
  i = (i + slots.length) % slots.length;
  if (i === selected) return;
  const prev = slots[selected];
  selected = i;
  const cur = slots[i];
  queue(() => {
    prev.el.classList.remove('sel');
    cur.el.classList.add('sel');
    cursor.style.transform = `translate3d(${slotX[i]}px,-3px,0)`;
    // WAAPI restarts the pop without the offsetWidth reflow hack.
    cur.ico.animate([{ transform: 'scale(.78)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  });
}
slots[0].el.classList.add('sel');

addEventListener('keydown', e => {
  const k = e.key.charCodeAt(0) - 49;
  if (e.key.length === 1 && k >= 0 && k < slots.length) select(k);
});
let wheelAcc = 0;
addEventListener('wheel', e => {
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) >= 50) { select(selected + Math.sign(wheelAcc)); wheelAcc = 0; }
}, { passive: true });

// ---------- toast feed: 5 pooled rows, merge repeats ----------
const feed = document.getElementById('feed');
const ROW = 34, MAX = 5, LIFE = 2800, MERGE = 1500;
const pool = [];
const active = [];       // index 0 = newest (bottom)
for (let i = 0; i < MAX + 1; i++) {
  const li = document.createElement('li');
  li.innerHTML = '<span class="t"></span><span class="n"></span>';
  feed.appendChild(li);
  pool.push({ li, t: li.firstChild, n: li.lastChild, kind: '', count: 0, born: 0, dying: false, gen: 0 });
}
function placeAll() {
  active.forEach((row, i) => {
    if (!row.dying) row.li.style.transform = `translate3d(0,${-i * ROW}px,0)`;
  });
}
function toast(kind, now = performance.now()) {
  const hit = active.find(r => r.kind === kind && !r.dying && now - r.born < MERGE);
  if (hit) {
    hit.count++; hit.born = now;
    queue(() => {
      hit.n.textContent = `x${hit.count}`;
      hit.n.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }],
        { duration: 180, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    });
    return;
  }
  if (active.length >= MAX) expire(active[active.length - 1]);
  const row = pool.pop() || active.pop();
  row.kind = kind; row.count = 1; row.born = now; row.dying = false; row.gen++;
  active.unshift(row);
  queue(() => {
    row.t.textContent = `+ ${kind}`;
    row.n.textContent = '';
    row.li.classList.remove('out');
    row.li.style.transition = 'none';
    row.li.style.transform = 'translate3d(40px,0,0)';
    placeAll();                                   // older rows slide up
    row.li.style.transform = 'translate3d(40px,0,0)';
    // Next frame: re-enable transition and slide in. No forced reflow.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      row.li.style.transition = '';
      row.li.classList.add('on');
      if (!row.dying) row.li.style.transform = `translate3d(0,${-active.indexOf(row) * ROW}px,0)`;
    }));
  });
}
function expire(row) {
  if (row.dying) return;
  row.dying = true;
  const gen = ++row.gen;
  queue(() => { row.li.classList.add('out'); row.li.classList.remove('on'); });
  setTimeout(() => {
    if (row.gen !== gen || !row.dying) return;   // row was recycled meanwhile
    const i = active.indexOf(row);
    if (i >= 0) active.splice(i, 1);
    pool.push(row);
    queue(placeAll);
  }, 230);
}

// ---------- stats ----------
const stats = document.getElementById('stats');
let frames = 0, acc = 0, worst = 0, statClock = 0;
window.__ui = { select, toast, get selected() { return selected; }, get writes() { return writeCount; }, frameMs: 0, worstMs: 0 };

// ---------- loop ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  measure();
  queue(() => { cursor.style.transform = `translate3d(${slotX[selected]}px,-3px,0)`; });
}
addEventListener('resize', resize);
resize();

let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = now - last; last = now;
  frames++; acc += dt; worst = Math.max(worst, dt);
  for (let i = active.length - 1; i >= 0; i--) if (now - active[i].born > LIFE) expire(active[i]);
  raft.position.y = 0.1 + Math.sin(now / 700) * 0.04;
  raft.rotation.z = Math.sin(now / 900) * 0.03;
  flushWrites();
  renderer.render(scene, camera);
  if (now - statClock > 500) {            // DOM text at 2 Hz, not 60
    const avg = acc / frames;
    window.__ui.frameMs = avg; window.__ui.worstMs = worst;
    const txt = `frame ${avg.toFixed(1)} ms  worst ${worst.toFixed(1)}\nwrites ${writeCount}  feed ${active.length}`;
    stats.textContent = txt;
    frames = 0; acc = 0; worst = 0; statClock = now;
  }
});

// ?demo=1 spams input so the cost of the HUD is visible in the stats line.
if (new URLSearchParams(location.search).has('demo')) {
  const kinds = ['Plank', 'Plank', 'Plastic', 'Scrap', 'Plank', 'Leaf', 'Rope'];
  let k = 0;
  setInterval(() => select(selected + 1), 140);
  setInterval(() => toast(kinds[k++ % kinds.length]), 260);
}
