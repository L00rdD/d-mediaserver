// The resin printer in 3D, for the printer card (printer.js) and its full view
// (printer.html). Not the part's real geometry (the cloud does not give it): a
// Photon Mono M7 drawn to scale (plate 223 × 126 mm), its build plate at the height
// of the layer being printed, and the part hanging under it, cut out of the slicer's
// picture (/printer.jpg) at its real height and shown only above the vat's film,
// so it comes out of the resin layer after layer as on the machine. The view turns
// on its own; a drag turns it, the wheel or a pinch zooms.

// ---- pure helpers (tested in printer/card.test.cjs) ----

// Makes the slicer picture's background transparent (the colour of its top-left
// pixel, give or take `tol`) and returns the box around what is left, or null.
export function keyOut(px, w, h, tol = 24) {
  const bg = [px[0], px[1], px[2]];
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const d = Math.abs(px[o] - bg[0]) + Math.abs(px[o + 1] - bg[1]) + Math.abs(px[o + 2] - bg[2]);
    px[o + 3] = d < tol ? 0 : Math.min(255, ((d - tol) * 255) / tol);
    if (px[o + 3] === 0) continue;
    const x = i % w, y = (i - x) / w;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Height of the build plate above the film, in mm, for a status of printer.json
export function plateHeight(job, top = 200) {
  if (!job || !job.active || !job.layer) return top;
  return job.layer * (job.layer_mm || 0.05);
}

// Size of the part in mm: its height from the slice, its width from the picture
export function partSize(job, box) {
  const h = (job && job.height_mm) || 100;
  return { h, w: Math.min(223, (h * box.w) / box.h) };
}

// Height the camera looks at: the part coming out of the resin, under the plate
export function focus(plate) {
  return clamp(plate * 0.5 + 25, 40, 120);
}

// Camera on a sphere around the printer: azimuth, elevation (radians), distance
export function orbit(a, e, r, target = [0, 105, 0]) {
  return [target[0] + r * Math.cos(e) * Math.sin(a), target[1] + r * Math.sin(e), target[2] + r * Math.cos(e) * Math.cos(a)];
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- the scene (needs WebGL) ----

export async function mountPrinter(canvas, opts = {}) {
  const T = await import("./vendor/three-r186.min.js");
  const accent = opts.accent || "#6fe3ff";
  const scene = new T.Scene();
  const ctx = {
    canvas,
    renderer: renderer(T, canvas, opts.background, scene),
    scene,
    camera: new T.PerspectiveCamera(32, 1, 5, 5000),
    view: { a: 0.7, e: 0.34, r: opts.distance || 980, idle: 0, dragged: false },
    machine: null, part: null, job: null, plate: plateHeight(null), last: performance.now(),
  };
  lights(T, scene, accent);
  ctx.machine = build(T, scene, accent);
  ctx.part = partMesh(T, scene, opts.onPicture);
  if (opts.interactive !== false) controls(canvas, ctx.view);
  const frame = (now) => canvas.isConnected && (tick(ctx, now), requestAnimationFrame(frame));
  requestAnimationFrame(frame);

  return {
    update(p) {
      ctx.job = (p && p.job) || null;
      ctx.part.picture(ctx.job, T);
    },
    // true right after a drag, so that the card's link does not open on it
    dragged: () => ctx.view.dragged,
  };
}

function renderer(T, canvas, background, scene) {
  const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: !background });
  r.localClippingEnabled = true;
  r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  if (background) scene.background = new T.Color(background);
  return r;
}

// One frame: the view turns on its own after 3 s without a touch, the plate eases
// to the layer being printed
function tick(ctx, now) {
  const dt = Math.min(0.1, (now - ctx.last) / 1000);
  const view = ctx.view;
  ctx.last = now;
  view.idle += dt;
  if (view.idle > 3) view.a += dt * 0.18;
  ctx.plate += (plateHeight(ctx.job) - ctx.plate) * Math.min(1, dt * 2);
  ctx.machine.setPlate(ctx.plate);
  ctx.machine.pulse(now / 1000, ctx.job && ctx.job.active);
  ctx.part.place(ctx.plate, view.a);
  fit(ctx.renderer, ctx.camera, ctx.canvas);
  const y = focus(ctx.plate);
  ctx.camera.position.set(...orbit(view.a, view.e, view.r, [0, y, 0]));
  ctx.camera.lookAt(0, y, 0);
  if (visible(ctx.canvas)) ctx.renderer.render(ctx.scene, ctx.camera);
}

const visible = (canvas) => !document.hidden && canvas.offsetParent !== null;

function fit(renderer, camera, canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width === Math.round(w * renderer.getPixelRatio()) && camera.aspect === w / h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function lights(T, scene, accent) {
  scene.add(new T.HemisphereLight(0xdfe8ff, 0x10141c, 1.4));
  const key = new T.DirectionalLight(0xffffff, 2.2);
  key.position.set(300, 500, 400);
  scene.add(key);
  const rim = new T.DirectionalLight(new T.Color(accent), 1.6);
  rim.position.set(-400, 200, -300);
  scene.add(rim);
}

// The M7: base and screen, vat and resin, Z column, arm and build plate
function build(T, scene, accent) {
  const metal = new T.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.7, roughness: 0.35 });
  const dark = new T.MeshStandardMaterial({ color: 0x14171d, metalness: 0.3, roughness: 0.6 });
  const box = (w, h, d, mat, x, y, z) => {
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };
  box(280, 70, 220, dark, 0, -41, 0);
  box(200, 2, 1, new T.MeshBasicMaterial({ color: new T.Color(accent) }), 0, -60, 110.5);
  const screen = box(223, 1, 126, new T.MeshStandardMaterial({ color: 0x0a0a12, emissive: new T.Color(0x7a3cff), emissiveIntensity: 0 }), 0, -5.5, 0);
  vat(T, box, accent);
  box(44, 330, 40, metal, 0, 159, -125);
  const plate = new T.Group();
  plate.add(new T.Mesh(new T.BoxGeometry(223, 9, 126), new T.MeshStandardMaterial({ color: 0xb8bec8, metalness: 0.9, roughness: 0.25 })));
  const arm = new T.Mesh(new T.BoxGeometry(46, 14, 64), metal);
  arm.position.set(0, 11, -86);
  plate.add(arm);
  scene.add(plate);
  return {
    setPlate: (y) => plate.position.set(0, y + 4.5, 0),
    // the screen lights the layer for 2.2 s every ~6 s while printing
    pulse: (t, on) => { screen.material.emissiveIntensity = on && t % 6 < 2.2 ? 2.5 : 0; },
  };
}

function vat(T, box, accent) {
  const glass = new T.MeshStandardMaterial({ color: 0x1c2230, transparent: true, opacity: 0.55, metalness: 0.2, roughness: 0.3 });
  box(240, 40, 3, glass, 0, 15, 72);
  box(240, 40, 3, glass, 0, 15, -72);
  box(3, 40, 141, glass, 120, 15, 0);
  box(3, 40, 141, glass, -120, 15, 0);
  const resin = new T.MeshStandardMaterial({ color: new T.Color(accent).lerp(new T.Color(0x9aa3ad), 0.6), transparent: true, opacity: 0.32, depthWrite: false, roughness: 0.1 });
  box(236, 24, 140, resin, 0, 7, 0);
}

// The part: the slicer picture, upside down under the plate, cut at the film
function partMesh(T, scene, onPicture) {
  const material = new T.MeshStandardMaterial({ transparent: true, alphaTest: 0.1, side: T.DoubleSide, roughness: 0.6, clippingPlanes: [new T.Plane(new T.Vector3(0, 1, 0), 0)] });
  const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), material);
  mesh.visible = false;
  scene.add(mesh);
  let src = null;
  return {
    place(plate, azimuth) {
      mesh.position.set(0, plate - mesh.scale.y / 2, 0);
      mesh.rotation.y = azimuth;
    },
    picture(job, T) {
      const url = job && job.preview;
      if (url === src) return;
      src = url;
      mesh.visible = false;
      if (url) loadPart(T, url, job, mesh, onPicture);
    },
  };
}

// The picture without its background and cropped to the part: upside down on the
// plate, and upright for the page (onPicture), where the dimmed part then matches
function loadPart(T, url, job, mesh, onPicture) {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height);
    const box = keyOut(data.data, c.width, c.height);
    if (!box) return;
    g.putImageData(data, 0, 0);
    // cropped and upside down: the raft at the top, against the plate
    const out = document.createElement("canvas");
    out.width = box.w; out.height = box.h;
    const o = out.getContext("2d");
    o.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    if (onPicture) onPicture(url, out.toDataURL());
    o.clearRect(0, 0, box.w, box.h);
    o.translate(0, box.h);
    o.scale(1, -1);
    o.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    const tex = new T.CanvasTexture(out);
    tex.colorSpace = T.SRGBColorSpace;
    mesh.material.map?.dispose();
    mesh.material.map = tex;
    mesh.material.needsUpdate = true;
    const size = partSize(job, box);
    mesh.scale.set(size.w, size.h, 1);
    mesh.visible = true;
  };
  img.src = url;
}

// Drag to turn, wheel or pinch to zoom; any touch stops the turning for 3 s
function controls(canvas, view) {
  const pointers = new Map();
  let moved = 0, pinch = 0;
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    canvas.setPointerCapture(e.pointerId);
    moved = 0; pinch = 0; view.dragged = false;
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    view.idle = 0;
    if (pointers.size > 1) return zoomPinch(e, pointers, view, (d) => (pinch = d), () => pinch);
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    moved += Math.abs(dx) + Math.abs(dy);
    view.dragged = moved > 6;
    view.a -= dx * 0.008;
    view.e = clamp(view.e + dy * 0.006, 0.05, 1.4);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
  });
  const up = (e) => pointers.delete(e.pointerId);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    view.idle = 0;
    view.r = clamp(view.r * Math.exp(e.deltaY * 0.001), 300, 1800);
  }, { passive: false });
}

function zoomPinch(e, pointers, view, setLast, getLast) {
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  const [a, b] = [...pointers.values()];
  const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (getLast()) view.r = clamp((view.r * getLast()) / d, 300, 1800);
  setLast(d);
  view.dragged = true;
}
