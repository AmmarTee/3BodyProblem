// ============================================================
//  THREE-BODY PROBLEM  –  p5.js cinematic simulation
//  Gravitational N-body (N=3) with Velocity-Verlet integration
// ============================================================

// --- Simulation constants ---
const G = 2.5;               // gravitational constant (tuned for visuals)
const DT = 0.3;              // time-step per frame
const SOFTENING = 8;         // softening length to avoid singularities
const TRAIL_LEN = 600;       // max trail points per body
const SUB_STEPS = 6;         // integration sub-steps per frame for accuracy

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

// --- Presets ---
const PRESETS = [
  {
    name: "Figure-Eight",
    bodies: [
      { x: -120, y: 0, vx: 0, vy: -0.78, m: 120, col: [255, 100, 60] },
      { x: 120, y: 0, vx: 0, vy: 0.78, m: 120, col: [60, 160, 255] },
      { x: 0, y: 0, vx: 0, vy: 0, m: 120, col: [120, 255, 120] },
    ],
  },
  {
    name: "Lagrange Triangle",
    bodies: [
      { x: 0, y: -140, vx: 1.0, vy: 0.4, m: 150, col: [255, 200, 50] },
      { x: -121, y: 70, vx: -0.3, vy: -1.0, m: 150, col: [50, 200, 255] },
      { x: 121, y: 70, vx: -0.7, vy: 0.6, m: 150, col: [255, 80, 180] },
    ],
  },
  {
    name: "Chaotic Dance",
    bodies: [
      { x: -200, y: 50, vx: 0.2, vy: -0.6, m: 200, col: [255, 70, 70] },
      { x: 100, y: -150, vx: -0.5, vy: 0.3, m: 140, col: [70, 130, 255] },
      { x: 80, y: 160, vx: 0.3, vy: 0.3, m: 100, col: [100, 255, 180] },
    ],
  },
  {
    name: "Binary + Satellite",
    bodies: [
      { x: -80, y: 0, vx: 0, vy: -1.0, m: 200, col: [255, 160, 40] },
      { x: 80, y: 0, vx: 0, vy: 1.0, m: 200, col: [100, 180, 255] },
      { x: 300, y: 0, vx: 0, vy: 1.2, m: 30, col: [200, 200, 200] },
    ],
  },
  {
    name: "Slingshot",
    bodies: [
      { x: 0, y: 0, vx: 0, vy: 0, m: 300, col: [255, 220, 80] },
      { x: -250, y: -50, vx: 0.6, vy: 0.9, m: 80, col: [80, 200, 255] },
      { x: 200, y: 100, vx: -0.4, vy: -0.5, m: 60, col: [255, 100, 200] },
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

  // Controls
  let ctrlY = height - 100;
  fill(255, 255, 255, 60);
  textSize(11);
  textAlign(LEFT, BOTTOM);
  text("[SPACE] Pause/Resume", 30, ctrlY);
  text("[R] Reset current preset", 30, ctrlY + 18);
  text("[1-5] Switch preset", 30, ctrlY + 36);
  text("[T] Toggle trails", 30, ctrlY + 54);
  text("[G] Toggle grid", 30, ctrlY + 72);

  if (paused) {
    textAlign(CENTER, CENTER);
    textSize(28);
    fill(255, 255, 255, 150);
    text("PAUSED", width / 2, height / 2);
  }
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
}

function draw() {
  background(5, 5, 15);

  if (!paused) {
    simulate();
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
  if (key === " ") paused = !paused;
  if (key === "r" || key === "R") loadPreset(currentPreset);
  if (key === "t" || key === "T") showTrails = !showTrails;
  if (key === "g" || key === "G") showGrid = !showGrid;
  if (key >= "1" && key <= "5") loadPreset(int(key) - 1);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
