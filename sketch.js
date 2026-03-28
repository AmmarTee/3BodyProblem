// ============================================================
//  THREE-BODY PROBLEM  –  p5.js cinematic simulation
//  Gravitational N-body (N=3) with Velocity-Verlet integration
// ============================================================

// --- Simulation constants ---
const G = 8;                 // gravitational constant (tuned for dynamic visuals)
const DT = 0.5;              // time-step per frame
const SOFTENING = 10;        // softening length to avoid singularities
const TRAIL_LEN = 600;       // max trail points per body
let speedMultiplier = 1;      // simulation speed (0.25x - 4x)
const SUB_STEPS = 12;        // integration sub-steps per frame for accuracy

// --- Visual knobs ---
const BODY_GLOW_LAYERS = 6;
const TRAIL_FADE = true;
const SHOW_GRID = true;
const SHOW_INFO = true;

// --- Bodies ---
let bodies = [];
let time = 0;
let paused = false;
let cam = { x: 0, y: 0, zoom: 1, targetZoom: 1 };

// --- Audio ---
let audioCtx = null;
let sfxEnabled = true;
let audioStarted = false;
let masterGain = null;
let ambientDrone = null;
let bodyOscillators = [];
let proximityGains = [];  // gain nodes for each pair
let proximityOscs = [];   // oscillators for each pair

// --- Recording ---
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

const BASE_FREQS = [55, 73.4, 98];  // base tones per body (A1, D2, G2)
const PAIR_FREQS = [36, 42, 30];     // sub-bass rumble per pair

// --- Presets ---
const PRESETS = [
  {
    name: "Figure-Eight",
    bodies: [
      { x: -120, y: 0, vx: 0, vy: -1.8, m: 120, col: [255, 100, 60] },
      { x: 120, y: 0, vx: 0, vy: 1.8, m: 120, col: [60, 160, 255] },
      { x: 0, y: 0, vx: 0, vy: 0, m: 120, col: [120, 255, 120] },
    ],
  },
  {
    name: "Lagrange Triangle",
    bodies: [
      { x: 0, y: -140, vx: 2.2, vy: 0.8, m: 150, col: [255, 200, 50] },
      { x: -121, y: 70, vx: -0.6, vy: -2.0, m: 150, col: [50, 200, 255] },
      { x: 121, y: 70, vx: -1.6, vy: 1.2, m: 150, col: [255, 80, 180] },
    ],
  },
  {
    name: "Chaotic Dance",
    bodies: [
      { x: -180, y: 50, vx: 0.5, vy: -1.5, m: 180, col: [255, 70, 70] },
      { x: 100, y: -130, vx: -1.2, vy: 0.7, m: 140, col: [70, 130, 255] },
      { x: 80, y: 140, vx: 0.7, vy: 0.8, m: 120, col: [100, 255, 180] },
    ],
  },
  {
    name: "Binary + Satellite",
    bodies: [
      { x: -80, y: 0, vx: 0, vy: -2.2, m: 200, col: [255, 160, 40] },
      { x: 80, y: 0, vx: 0, vy: 2.2, m: 200, col: [100, 180, 255] },
      { x: 280, y: 0, vx: 0, vy: 2.8, m: 30, col: [200, 200, 200] },
    ],
  },
  {
    name: "Slingshot",
    bodies: [
      { x: 0, y: 0, vx: 0, vy: 0, m: 300, col: [255, 220, 80] },
      { x: -220, y: -50, vx: 1.4, vy: 2.0, m: 80, col: [80, 200, 255] },
      { x: 180, y: 80, vx: -1.0, vy: -1.2, m: 60, col: [255, 100, 200] },
    ],
  },
];

let currentPreset = 0;

// ============================================================
//  Body class
// ============================================================
class Body {
  constructor(x, y, vx, vy, mass, col) {
    this.pos = createVector(x, y);
    this.vel = createVector(vx, vy);
    this.acc = createVector(0, 0);
    this.mass = mass;
    this.col = col;
    this.radius = map(mass, 30, 300, 6, 22);
    this.trail = [];
  }

  applyForce(force) {
    let f = p5.Vector.div(force, this.mass);
    this.acc.add(f);
  }

  // Velocity-Verlet integration (half-step)
  integratePosition(dt) {
    // x(t+dt) = x(t) + v(t)*dt + 0.5*a(t)*dt^2
    this.pos.add(p5.Vector.mult(this.vel, dt));
    this.pos.add(p5.Vector.mult(this.acc, 0.5 * dt * dt));
  }

  integrateVelocity(oldAcc, dt) {
    // v(t+dt) = v(t) + 0.5*(a(t) + a(t+dt))*dt
    let avgAcc = p5.Vector.add(oldAcc, this.acc);
    avgAcc.mult(0.5 * dt);
    this.vel.add(avgAcc);
  }

  storeTrail() {
    this.trail.push(this.pos.copy());
    if (this.trail.length > TRAIL_LEN) this.trail.shift();
  }

  draw() {
    // --- Glow layers ---
    noStroke();
    for (let i = BODY_GLOW_LAYERS; i >= 1; i--) {
      let t = i / BODY_GLOW_LAYERS;
      let r = this.radius + i * (this.radius * 0.8);
      let alpha = lerp(50, 3, t);
      fill(this.col[0], this.col[1], this.col[2], alpha);
      ellipse(this.pos.x, this.pos.y, r * 2, r * 2);
    }

    // --- Core ---
    fill(255, 255, 255, 230);
    ellipse(this.pos.x, this.pos.y, this.radius * 1.1, this.radius * 1.1);
    fill(this.col[0], this.col[1], this.col[2], 200);
    ellipse(this.pos.x, this.pos.y, this.radius * 2, this.radius * 2);

    // --- Bright center ---
    fill(255, 255, 255, 180);
    ellipse(this.pos.x, this.pos.y, this.radius * 0.6, this.radius * 0.6);
  }

  drawTrail() {
    noFill();
    let len = this.trail.length;
    if (len < 2) return;

    for (let i = 1; i < len; i++) {
      let t = i / len;
      let alpha = t * 180;
      let weight = t * 3.5;
      stroke(this.col[0], this.col[1], this.col[2], alpha);
      strokeWeight(weight);
      line(this.trail[i - 1].x, this.trail[i - 1].y, this.trail[i].x, this.trail[i].y);
    }
  }
}

// ============================================================
//  Physics
// ============================================================
function computeAccelerations() {
  for (let b of bodies) b.acc.set(0, 0);

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      let a = bodies[i];
      let b = bodies[j];
      let dir = p5.Vector.sub(b.pos, a.pos);
      let distSq = dir.magSq() + SOFTENING * SOFTENING;
      let dist = sqrt(distSq);
      let forceMag = (G * a.mass * b.mass) / distSq;
      dir.normalize();
      dir.mult(forceMag);
      a.applyForce(dir);
      b.applyForce(p5.Vector.mult(dir, -1));
    }
  }
}

function simulate() {
  let dt = DT / SUB_STEPS;
  for (let s = 0; s < SUB_STEPS; s++) {
    // Store old accelerations
    let oldAccs = bodies.map((b) => b.acc.copy());

    // Update positions using current velocity + acceleration
    for (let b of bodies) b.integratePosition(dt);

    // Compute new accelerations at new positions
    computeAccelerations();

    // Update velocities using average of old and new acceleration
    for (let i = 0; i < bodies.length; i++) {
      bodies[i].integrateVelocity(oldAccs[i], dt);
    }
  }

  // Store trail once per frame
  for (let b of bodies) b.storeTrail();
  time += DT;
}

// ============================================================
//  Camera – smooth follow center of mass
// ============================================================
function updateCamera() {
  let cx = 0, cy = 0, totalMass = 0;
  for (let b of bodies) {
    cx += b.pos.x * b.mass;
    cy += b.pos.y * b.mass;
    totalMass += b.mass;
  }
  cx /= totalMass;
  cy /= totalMass;

  cam.x = lerp(cam.x, cx, 0.03);
  cam.y = lerp(cam.y, cy, 0.03);

  // Auto-zoom to keep all bodies visible
  let maxDist = 0;
  for (let b of bodies) {
    let d = dist(b.pos.x, b.pos.y, cx, cy);
    if (d > maxDist) maxDist = d;
  }
  let desiredZoom = min(width, height) / (maxDist * 3.5 + 200);
  desiredZoom = constrain(desiredZoom, 0.15, 3.0);
  cam.targetZoom = desiredZoom;
  cam.zoom = lerp(cam.zoom, cam.targetZoom, 0.02);
}

// ============================================================
//  UI Drawing
// ============================================================
function drawGrid() {
  let gridSize = 100;
  let alpha = 25;
  stroke(255, alpha);
  strokeWeight(0.5);

  let halfW = (width / 2) / cam.zoom;
  let halfH = (height / 2) / cam.zoom;
  let startX = floor((cam.x - halfW) / gridSize) * gridSize;
  let endX = ceil((cam.x + halfW) / gridSize) * gridSize;
  let startY = floor((cam.y - halfH) / gridSize) * gridSize;
  let endY = ceil((cam.y + halfH) / gridSize) * gridSize;

  for (let x = startX; x <= endX; x += gridSize) {
    line(x, startY, x, endY);
  }
  for (let y = startY; y <= endY; y += gridSize) {
    line(startX, y, endX, y);
  }
}

function drawGravityField() {
  // Subtle gravitational field lines (just connecting bodies faintly)
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      let a = bodies[i];
      let b = bodies[j];
      let d = dist(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
      let alpha = map(d, 0, 600, 40, 0);
      alpha = constrain(alpha, 0, 40);
      if (alpha > 2) {
        stroke(255, 255, 255, alpha);
        strokeWeight(0.8);
        drawingContext.setLineDash([4, 8]);
        line(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
        drawingContext.setLineDash([]);
      }
    }
  }
}

function drawHUD() {
  // Reset transform for HUD
  resetMatrix();

  // Title
  fill(255, 255, 255, 200);
  noStroke();
  textFont("monospace");
  textSize(22);
  textAlign(LEFT, TOP);
  text("THREE-BODY PROBLEM", 30, 25);

  // Preset name
  textSize(14);
  fill(255, 255, 255, 120);
  text(`Preset: ${PRESETS[currentPreset].name}`, 30, 55);

  // Time
  textSize(13);
  fill(255, 255, 255, 100);
  text(`t = ${time.toFixed(1)}`, 30, 78);

  // Body info
  let yOff = 110;
  for (let i = 0; i < bodies.length; i++) {
    let b = bodies[i];
    fill(b.col[0], b.col[1], b.col[2], 200);
    ellipse(45, yOff + 7, 10, 10);
    fill(255, 255, 255, 150);
    textSize(12);
    text(
      `m=${b.mass.toFixed(0)}  v=${b.vel.mag().toFixed(2)}  (${b.pos.x.toFixed(0)}, ${b.pos.y.toFixed(0)})`,
      58,
      yOff
    );
    yOff += 22;
  }

  // Total energy
  let KE = 0, PE = 0;
  for (let b of bodies) KE += 0.5 * b.mass * b.vel.magSq();
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      let d = p5.Vector.dist(bodies[i].pos, bodies[j].pos);
      d = max(d, SOFTENING);
      PE -= (G * bodies[i].mass * bodies[j].mass) / d;
    }
  }
  fill(255, 255, 255, 80);
  textSize(11);
  text(`Energy: ${(KE + PE).toFixed(1)}  (KE: ${KE.toFixed(1)}  PE: ${PE.toFixed(1)})`, 30, yOff + 10);

  // Buttons drawn separately
  drawButtons();

  // Recording indicator
  if (isRecording) {
    textAlign(RIGHT, TOP);
    let pulse = 200 + Math.sin(frameCount * 0.1) * 55;
    fill(255, 40, 40, pulse);
    noStroke();
    ellipse(width - 35, 30, 14, 14);
    fill(255, 255, 255, 180);
    textSize(13);
    text("REC", width - 48, 22);
  }

  if (paused) {
    textAlign(CENTER, CENTER);
    textSize(28);
    fill(255, 255, 255, 150);
    text("PAUSED", width / 2, height / 2);
  }
}

// ============================================================
//  Button UI
// ============================================================
const BTN_H = 28;
const BTN_GAP = 4;
const BTN_Y_OFF = 48;

function getButtons() {
  return [
    { label: paused ? "PLAY" : "PAUSE", action: () => { paused = !paused; }, w: 46 },
    { label: "RESET", action: () => { loadPreset(currentPreset); }, w: 44 },
    { label: "1", action: () => loadPreset(0), w: 24, hi: currentPreset === 0 },
    { label: "2", action: () => loadPreset(1), w: 24, hi: currentPreset === 1 },
    { label: "3", action: () => loadPreset(2), w: 24, hi: currentPreset === 2 },
    { label: "4", action: () => loadPreset(3), w: 24, hi: currentPreset === 3 },
    { label: "5", action: () => loadPreset(4), w: 24, hi: currentPreset === 4 },
    { label: "TRAIL", action: () => { showTrails = !showTrails; }, w: 42, hi: showTrails },
    { label: "GRID", action: () => { showGrid = !showGrid; }, w: 38, hi: showGrid },
    { label: "SFX", action: () => { sfxEnabled = !sfxEnabled; if (masterGain) masterGain.gain.value = sfxEnabled ? 0.35 : 0; }, w: 34, hi: sfxEnabled },
    { label: "-", action: () => { speedMultiplier = max(speedMultiplier / 2, 0.25); }, w: 24 },
    { label: `${speedMultiplier}x`, action: () => {}, w: 38 },
    { label: "+", action: () => { speedMultiplier = min(speedMultiplier * 2, 4); }, w: 24 },
    { label: isRecording ? "STOP" : "REC", action: () => { if (isRecording) stopRecording(); else startRecording(); }, w: 38, hi: isRecording },
  ];
}

function drawButtons() {
  resetMatrix();
  let btns = getButtons();
  let totalW = btns.reduce((s, b) => s + b.w + BTN_GAP, -BTN_GAP);
  let sx = (width - totalW) / 2;
  let y = height - BTN_Y_OFF;

  noStroke();
  fill(10, 12, 25, 190);
  rect(sx - 10, y - 6, totalW + 20, BTN_H + 12, 8);

  let x = sx;
  textFont("monospace");
  textSize(10);
  textAlign(CENTER, CENTER);

  for (let b of btns) {
    if (b.hi) {
      fill(255, 255, 255, 25);
      stroke(255, 255, 255, 60);
    } else {
      fill(255, 255, 255, 8);
      stroke(255, 255, 255, 25);
    }
    strokeWeight(1);
    rect(x, y, b.w, BTN_H, 4);

    noStroke();
    fill(255, 255, 255, b.hi ? 200 : 130);
    text(b.label, x + b.w / 2, y + BTN_H / 2);
    x += b.w + BTN_GAP;
  }
}

function handleButtonClick(mx, my) {
  if (!audioStarted) initAudio();
  let btns = getButtons();
  let totalW = btns.reduce((s, b) => s + b.w + BTN_GAP, -BTN_GAP);
  let sx = (width - totalW) / 2;
  let y = height - BTN_Y_OFF;
  let x = sx;
  for (let b of btns) {
    if (mx >= x && mx <= x + b.w && my >= y && my <= y + BTN_H) {
      b.action();
      return true;
    }
    x += b.w + BTN_GAP;
  }
  return false;
}

// ============================================================
//  Recording (MediaRecorder API)
// ============================================================
function startRecording() {
  let stream = document.querySelector('canvas').captureStream(60);
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 8000000
  });
  recordedChunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    let blob = new Blob(recordedChunks, { type: 'video/webm' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = `3BodyProblem_${PRESETS[currentPreset].name.replace(/\s+/g, '_')}_${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };
  mediaRecorder.start();
  isRecording = true;
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
}

// ============================================================
//  Audio System (Web Audio API – procedural)
// ============================================================
function initAudio() {
  if (audioStarted) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioStarted = true;

  // Master volume
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.35;
  masterGain.connect(audioCtx.destination);

  // --- Ambient space drone (layered) ---
  ambientDrone = createDrone();

  // --- Per-body singing oscillators (velocity-mapped) ---
  bodyOscillators = [];
  for (let i = 0; i < 3; i++) {
    let osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = BASE_FREQS[i];
    let g = audioCtx.createGain();
    g.gain.value = 0;
    let filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    filter.Q.value = 3;
    osc.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    osc.start();
    bodyOscillators.push({ osc, gain: g, filter });
  }

  // --- Proximity rumble (one per body pair) ---
  proximityOscs = [];
  proximityGains = [];
  for (let p = 0; p < 3; p++) {
    let osc = audioCtx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = PAIR_FREQS[p];
    let g = audioCtx.createGain();
    g.gain.value = 0;
    let filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 120;
    filter.Q.value = 6;
    osc.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    osc.start();
    proximityOscs.push(osc);
    proximityGains.push(g);
  }
}

function createDrone() {
  // Layered ambient drone: two detuned saws through heavy LP filter + reverb-like delay
  let nodes = [];
  let droneGain = audioCtx.createGain();
  droneGain.gain.value = 0.08;

  let filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 180;
  filter.Q.value = 1;
  filter.connect(droneGain);
  droneGain.connect(masterGain);

  [32, 32.2, 48, 64.1].forEach((freq) => {
    let osc = audioCtx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.connect(filter);
    osc.start();
    nodes.push(osc);
  });

  // Slow LFO modulating drone filter cutoff
  let lfo = audioCtx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.07;
  let lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 60;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();

  return { nodes, filter, droneGain, lfo };
}

function updateAudio() {
  if (!audioStarted || !sfxEnabled || paused) return;
  let now = audioCtx.currentTime;

  // Per-body oscillator: pitch & volume from velocity
  for (let i = 0; i < Math.min(bodies.length, 3); i++) {
    let b = bodies[i];
    let speed = b.vel.mag();
    // Map speed to volume (0..1.5 -> 0..0.12)
    let vol = constrain(map(speed, 0, 1.5, 0, 0.12), 0, 0.12);
    bodyOscillators[i].gain.gain.linearRampToValueAtTime(vol, now + 0.05);
    // Slight pitch shift with speed
    let freq = BASE_FREQS[i] + speed * 30;
    bodyOscillators[i].osc.frequency.linearRampToValueAtTime(freq, now + 0.05);
    // Open filter with speed
    let cutoff = 200 + speed * 400;
    bodyOscillators[i].filter.frequency.linearRampToValueAtTime(cutoff, now + 0.05);
  }

  // Proximity rumble: louder when two bodies are closer
  let pairIdx = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (pairIdx >= 3) break;
      let d = p5.Vector.dist(bodies[i].pos, bodies[j].pos);
      // Close range = < 150px, far = > 500px
      let vol = constrain(map(d, 40, 400, 0.2, 0), 0, 0.2);
      proximityGains[pairIdx].gain.linearRampToValueAtTime(vol, now + 0.05);
      // Pitch rises as they get closer
      let freq = PAIR_FREQS[pairIdx] + constrain(map(d, 40, 400, 40, 0), 0, 40);
      proximityOscs[pairIdx].frequency.linearRampToValueAtTime(freq, now + 0.05);
      pairIdx++;
    }
  }
}

function playImpact() {
  // Short percussive "boom" on preset switch / reset
  if (!audioStarted || !sfxEnabled) return;
  let now = audioCtx.currentTime;
  let osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(80, now);
  osc.frequency.exponentialRampToValueAtTime(25, now + 0.4);
  let g = audioCtx.createGain();
  g.gain.setValueAtTime(0.3, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.5);

  // Noise burst layer
  let bufferSize = audioCtx.sampleRate * 0.15;
  let noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  let data = noiseBuffer.getChannelData(0);
  for (let s = 0; s < bufferSize; s++) data[s] = (Math.random() * 2 - 1) * 0.5;
  let noise = audioCtx.createBufferSource();
  noise.buffer = noiseBuffer;
  let nf = audioCtx.createBiquadFilter();
  nf.type = "lowpass";
  nf.frequency.value = 200;
  let ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.15, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  noise.connect(nf);
  nf.connect(ng);
  ng.connect(masterGain);
  noise.start(now);
  noise.stop(now + 0.2);
}

// ============================================================
//  Setup & Draw
// ============================================================
let showTrails = true;
let showGrid = true;

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  loadPreset(currentPreset);
}

function loadPreset(index) {
  currentPreset = index;
  let p = PRESETS[index];
  bodies = [];
  time = 0;

  for (let bd of p.bodies) {
    bodies.push(new Body(bd.x, bd.y, bd.vx, bd.vy, bd.m, bd.col));
  }

  // Initial acceleration computation
  computeAccelerations();

  // Reset camera
  cam.x = 0;
  cam.y = 0;
  cam.zoom = 1;
  cam.targetZoom = 1;

  // Impact sound on load
  playImpact();
}

function draw() {
  background(5, 5, 15);

  if (!paused) {
    for (let i = 0; i < speedMultiplier; i++) {
      simulate();
    }
    updateAudio();
  }

  updateCamera();

  // Apply camera transform
  translate(width / 2, height / 2);
  scale(cam.zoom);
  translate(-cam.x, -cam.y);

  // Background grid
  if (showGrid) drawGrid();

  // Gravity field lines
  drawGravityField();

  // Trails
  if (showTrails) {
    for (let b of bodies) b.drawTrail();
  }

  // Bodies
  for (let b of bodies) b.draw();

  // HUD (screen-space)
  drawHUD();
}

// ============================================================
//  Input
// ============================================================
function keyPressed() {
  // First interaction starts audio (browser autoplay policy)
  if (!audioStarted) initAudio();

  if (key === " ") paused = !paused;
  if (key === "r" || key === "R") loadPreset(currentPreset);
  if (key === "t" || key === "T") showTrails = !showTrails;
  if (key === "g" || key === "G") showGrid = !showGrid;
  if (key === "m" || key === "M") {
    sfxEnabled = !sfxEnabled;
    if (masterGain) masterGain.gain.value = sfxEnabled ? 0.35 : 0;
  }
  if (key === "=" || key === "+") speedMultiplier = min(speedMultiplier * 2, 4);
  if (key === "-" || key === "_") speedMultiplier = max(speedMultiplier / 2, 0.25);
  if (key === "v" || key === "V") {
    if (isRecording) stopRecording();
    else startRecording();
  }
  if (key >= "1" && key <= "5") loadPreset(int(key) - 1);
}

function mousePressed() {
  // Also start audio on mouse click (autoplay policy)
  if (!audioStarted) initAudio();
  handleButtonClick(mouseX, mouseY);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
