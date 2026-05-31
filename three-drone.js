/* ============ AEGLOS — WebGL drone (Three.js) ============ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const canvas = document.getElementById('droneCanvas');
const loadEl = document.getElementById('droneLoad');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---- renderer ---- */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(0, 0, 6);
camera.lookAt(0, 0, 0);

/* ---- environment for PBR metal / carbon ---- */
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

/* ---- lights (dramatic: hard warm key, low cool fill, strong ember rim) ---- */
const KEY_BASE = 3.0, RIM_BASE = 1.8;
const key = new THREE.DirectionalLight(0xffe2c2, KEY_BASE);
key.position.set(5, 7, 4);
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fc0ff, 0.45);
fill.position.set(-6, 1.5, -2);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xff8a3d, RIM_BASE);   // ember accent rim
rim.position.set(-3, 4, -6);
scene.add(rim);
const hemi = new THREE.HemisphereLight(0xffd9b0, 0x0a0806, 0.38);
scene.add(hemi);
const flashLight = new THREE.DirectionalLight(0xfff0dd, 0);   // lightning strike
flashLight.position.set(3, 6, -4);
scene.add(flashLight);

/* ---- craft group ---- */
const craft = new THREE.Group();
scene.add(craft);
let baseScale = 1, ready = false;
const propPivots = [];
const DEBUG_PROPS = false;

/* ---- keyframes: flight choreography across scroll ---- */
const KF = [
  { p: 0.00, x:  0.95, y:  0.06, pitch: -0.40, yaw:  0.60, roll:  0.02, s: 1.02 },
  { p: 0.22, x:  0.98, y:  0.16, pitch: -0.20, yaw: -0.50, roll:  0.24, s: 0.92 },
  { p: 0.48, x: -1.02, y:  0.00, pitch: -0.12, yaw:  0.82, roll: -0.20, s: 1.02 },
  { p: 0.72, x:  0.96, y:  0.14, pitch: -0.30, yaw: -0.34, roll:  0.36, s: 0.92 },
  { p: 1.00, x:  0.00, y: -0.06, pitch: -0.46, yaw:  0.12, roll:  0.00, s: 1.10 },
];
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
function sampleKF(p) {
  let i = 0;
  while (i < KF.length - 1 && p > KF[i + 1].p) i++;
  const a = KF[i], b = KF[Math.min(i + 1, KF.length - 1)];
  const span = (b.p - a.p) || 1;
  const t = smooth(Math.max(0, Math.min(1, (p - a.p) / span)));
  return {
    x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t),
    pitch: lerp(a.pitch, b.pitch, t),
    yaw: lerp(a.yaw, b.yaw, t),
    roll: lerp(a.roll, b.roll, t),
    s: lerp(a.s, b.s, t),
  };
}

/* ---- load model (meshopt-compressed) ---- */
new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('models/x650.glb', (gltf) => {
  const model = gltf.scene;

  // center + orient so the flat (thinnest) axis points up (Y)
  let box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const min = Math.min(size.x, size.y, size.z);
  if (min === size.z) model.rotation.x = -Math.PI / 2;       // Z-up CAD → Y-up
  else if (min === size.x) model.rotation.z = Math.PI / 2;

  // recenter after reorienting
  const pivot = new THREE.Group();
  pivot.add(model);
  box = new THREE.Box3().setFromObject(pivot);
  const c = box.getCenter(new THREE.Vector3());
  model.position.sub(c);

  // scale so horizontal span ≈ 2.3 world units
  box = new THREE.Box3().setFromObject(pivot);
  const s2 = box.getSize(new THREE.Vector3());
  baseScale = 2.3 / Math.max(s2.x, s2.z);

  craft.add(pivot);
  craft.updateMatrixWorld(true);

  /* ---- detect propellers & reparent onto spin pivots ---- */
  detectProps(pivot);

  ready = true;
  if (loadEl) { loadEl.classList.add('gone'); setTimeout(() => loadEl.remove(), 700); }
}, undefined, (err) => {
  console.error('GLB load failed', err);
  if (loadEl) loadEl.firstChild.nextSibling
    ? (loadEl.childNodes[1].nodeValue = 'AIRFRAME UNAVAILABLE')
    : (loadEl.textContent = 'AIRFRAME UNAVAILABLE');
});

/* ---- propeller detection ----
   Props sit in the upper region of the airframe and far from the
   vertical axis. We grab top-region meshes beyond a radius, cluster
   them into 4 quadrants, and reparent each cluster onto a Y-spin pivot. */
function detectProps(pivot) {
  const full = new THREE.Box3().setFromObject(pivot);
  const C = full.getCenter(new THREE.Vector3());
  const H = full.getSize(new THREE.Vector3());
  const maxR = Math.max(H.x, H.z) / 2;

  const meshes = [];
  pivot.traverse((o) => { if (o.isMesh) meshes.push(o); });

  // gather outer-region meshes per quadrant, tagged with height
  const quads = { '++': [], '+-': [], '-+': [], '--': [] };
  const tmp = new THREE.Box3(), ctr = new THREE.Vector3();
  for (const m of meshes) {
    tmp.setFromObject(m); tmp.getCenter(ctr);
    const dx = ctr.x - C.x, dz = ctr.z - C.z;
    const r = Math.hypot(dx, dz);
    if (r < maxR * 0.40) continue;            // skip central frame/mast
    const key = (dx >= 0 ? '+' : '-') + (dz >= 0 ? '+' : '-');
    quads[key].push({ m, x: ctr.x, z: ctr.z, y: ctr.y });
  }

  const dbg = new THREE.MeshStandardMaterial({ color: 0xff3322, emissive: 0x551100, metalness: 0.2, roughness: 0.5 });
  for (const key of Object.keys(quads)) {
    const all = quads[key];
    if (!all.length) continue;
    // propellers are the TOPMOST parts at each corner — keep only the top slice
    const maxY = Math.max(...all.map((it) => it.y));
    const items = all.filter((it) => it.y > maxY - H.y * 0.10);
    if (!items.length) continue;
    // cluster centroid (rotation axis)
    let cx = 0, cz = 0, cy = 0;
    for (const it of items) { cx += it.x; cz += it.z; cy += it.y; }
    cx /= items.length; cz /= items.length; cy /= items.length;

    const spin = new THREE.Group();
    pivot.add(spin);
    spin.position.copy(pivot.worldToLocal(new THREE.Vector3(cx, cy, cz)));
    pivot.updateMatrixWorld(true);
    for (const it of items) {
      if (DEBUG_PROPS) it.m.material = dbg;
      spin.attach(it.m);
    }
    propPivots.push(spin);
  }
  console.log('[AEGLOS] prop clusters:', propPivots.length);
}

/* ---- resize ---- */
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

/* ---- render loop ---- */
const S = window.AEGLOS || { p: 0, vel: 0 };
const stormEl = document.getElementById('stormFlash');
let smoothScale = baseScale;
let propSpin = 0, propRate = 0;
let strikes = [], nextStrike = 3.5;

function flashEnvelope(t) {
  // sum of fast-decaying spikes; prune expired
  let v = 0;
  for (let i = strikes.length - 1; i >= 0; i--) {
    const dt = t - strikes[i].t0;
    if (dt < 0) continue;
    if (dt > 0.6) { strikes.splice(i, 1); continue; }
    v = Math.max(v, strikes[i].amp * Math.exp(-dt / 0.085));
  }
  return Math.min(1, v);
}

function frame(now) {
  const t = now / 1000;
  if (ready) {
    const k = sampleKF(S.p || 0);
    const idleYaw = reduce ? 0 : t * 0.16;
    const bob = reduce ? 0 : Math.sin(t * 1.1) * 0.05;
    const wob = reduce ? 0 : Math.sin(t * 0.8) * 0.02;

    craft.rotation.set(k.pitch, k.yaw + idleYaw, k.roll + wob);
    const halfW = Math.tan((camera.fov * Math.PI / 180) / 2) * camera.position.z * camera.aspect;
    craft.position.set(k.x * halfW * 0.42, k.y + bob, 0);

    const target = baseScale * k.s;
    smoothScale += (target - smoothScale) * 0.12;
    craft.scale.setScalar(smoothScale);

    if (!reduce) {
      const targetRate = 0.55 + Math.min(1.4, (S.vel || 0) * 0.04);
      propRate += (targetRate - propRate) * 0.06;
      propSpin += propRate;
      for (let i = 0; i < propPivots.length; i++) {
        propPivots[i].rotation.y = (i % 2 ? -propSpin : propSpin);
      }
    }
  }

  /* ---- lightning / storm flash (synced: scene + DOM) ---- */
  if (!reduce) {
    if (t > nextStrike) {
      strikes.push({ t0: t, amp: 0.85 + Math.random() * 0.15 });
      if (Math.random() < 0.6) strikes.push({ t0: t + 0.1 + Math.random() * 0.1, amp: 0.5 + Math.random() * 0.3 });
      nextStrike = t + 6 + Math.random() * 8;
    }
    const f = flashEnvelope(t);
    flashLight.intensity = f * 5.5;
    rim.intensity = RIM_BASE + f * 2.5;
    key.intensity = KEY_BASE + f * 1.2;
    if (stormEl) stormEl.style.opacity = (f * 0.6).toFixed(3);
  }

  renderer.render(scene, camera);
  window.__propY = propPivots[0] ? propPivots[0].rotation.y : null;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
