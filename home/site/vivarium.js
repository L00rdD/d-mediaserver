// The hub's Hogwarts look in WebGL: inside Newt Scamander's case.
//
// One canvas fixed behind the page (<canvas class="gl">). On the first visit of the tab session
// (<html class="intro">) it first shows the case itself: leather and brass on a dark floor; it
// rattles, its clasps spring, the lid opens on the black inside where a light rises from the
// depths, and the camera dives in.
//
// Then, as in the films, each part of the page is a different world inside the case: every
// <section data-universe="..."> of the page has its own, and scrolling from one section to the
// next crosses into the next world through a ring of magic. The worlds are real photographed
// places (Poly Haven HDRIs, CC0, projected on the ground so things can stand on it) with
// Poly Haven models (CC0), and their creatures are real models (Sketchfab, CC-BY), animated:
//   night      the media apps under the Milky Way (Jellyfin calls Fawkes close)
//   cave       the Niffler's den, the Niffler on its gold (the trading bot)
//   forest     the Bowtruckle's tree, Pickett on his stump (Sapling Sunrise)
//   mist       pines in the mist, a hippogriff that rears up when you come (Bifrost)
// Fawkes, Dumbledore's phoenix, goes with you through every world; Hedwig flies across now and then.
//   shed       Newt's shed, an owl under the rafters (Errol)
// Coming near an element with data-creature="phoenix|niffler|bowtruckle|hippogriff|owl" wakes its
// creature up. Assets load as their world comes near; a creature not there yet is simply absent.
// Reduced motion: no intro, a still picture redrawn on scroll. Without WebGL: <html class="no-gl">.
import * as T from "./vendor/three.min.js";

const root = document.documentElement;
const canvas = document.querySelector("canvas.gl");
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const small = () => innerWidth < 700;

const finishIntro = () => {
  if (!root.classList.contains("intro")) return;
  root.classList.remove("intro");
  root.classList.add("intro-done");
  window.Magic?.release();
};

let renderer;
try {
  renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  if (!renderer.capabilities.isWebGL2) throw new Error("WebGL 2 needed");
} catch (e) {
  console.warn("vivarium: no WebGL", e);
  root.classList.add("no-gl");
  finishIntro();
  throw e;
}
root.classList.add("gl");
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = T.SRGBColorSpace;

// ---------------------------------------------------------------- small tools
let seed = 7;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = (a, b) => a + rnd() * (b - a);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIn = (t) => Math.pow(clamp(t, 0, 1), 2.4);
const lerp = (a, b, k) => a + (b - a) * k;
const TAU = Math.PI * 2;

// value noise in 3D, smooth enough for rock
const PERM = new Uint8Array(512);
{ const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(R(0, i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
const hash3 = (x, y, z) => PERM[(PERM[(PERM[x & 255] + y) & 255] + z) & 255] / 255;
const noise3 = (x, y, z) => {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  return lerp(lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v), lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w) * 2 - 1;
};
const fbm3 = (x, y, z, o = 4) => { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * noise3(x, y, z); x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; } return s; };

const GLSL_NOISE = /* glsl */ `
  float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
`;

// ---------------------------------------------------------------- the passage between worlds
// Renders the world we are in and, while crossing, the next one; a ring of magic opens from the
// middle of the screen, swallowing the old world in a swirl and unrolling the new one.
const QUAD_VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BLEND_FS = GLSL_NOISE + /* glsl */ `
  uniform sampler2D tA, tB; uniform float uK, uTime, uAspect; uniform vec3 uGradeA, uGradeB; varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5; c.x *= uAspect;
    float r = length(c);
    float n = fbm(vec3(c * 3.0, uTime * 0.3));
    float d = uK * 2.1 - 0.3 - (r + (n - 0.5) * 0.45);
    float m = smoothstep(0.0, 0.05, d);
    float sw = (1.0 - m) * uK * 2.5;
    float s = sin(sw * (1.2 - r)), co = cos(sw * (1.2 - r));
    vec2 ca = mat2(co, -s, s, co) * (c * (1.0 - uK * 0.35));
    vec2 cb = c * (1.25 - uK * 0.25);
    vec2 ua = vec2(ca.x / uAspect, ca.y) + 0.5, ub = vec2(cb.x / uAspect, cb.y) + 0.5;
    vec3 A = texture2D(tA, ua).rgb * uGradeA, B = texture2D(tB, ub).rgb * uGradeB;
    vec3 col = mix(A, B, m);
    float on = smoothstep(0.02, 0.3, uK) * smoothstep(1.0, 0.75, uK); // the ring grows in, and fades once through
    float rim = exp(-abs(d - 0.025) * 38.0) * on;
    col += rim * (vec3(0.6, 1.6, 2.1) * 1.1 + vec3(2.0, 1.5, 0.8) * 0.45 * n);
    col += on * (1.0 - m) * smoothstep(0.4, 0.0, abs(d)) * vec3(0.05, 0.12, 0.16);
    gl_FragColor = vec4(col, 1.0);
  }`;
class WorldsPass extends T.Pass {
  constructor() {
    super();
    const o = { type: T.HalfFloatType, samples: 4 };
    this.rtA = new T.WebGLRenderTarget(1, 1, o);
    this.rtB = new T.WebGLRenderTarget(1, 1, o);
    this.a = null; this.b = null; this.k = 0; this.time = 0;
    this.quad = new T.FullScreenQuad(new T.ShaderMaterial({
      uniforms: { tA: { value: null }, tB: { value: null }, uK: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uGradeA: { value: new T.Vector3(1, 1, 1) }, uGradeB: { value: new T.Vector3(1, 1, 1) } },
      vertexShader: QUAD_VS, fragmentShader: BLEND_FS,
    }));
  }
  setSize(w, h) { this.rtA.setSize(w, h); this.rtB.setSize(w, h); this.quad.material.uniforms.uAspect.value = w / h; }
  render(r, writeBuffer) {
    const u = this.quad.material.uniforms;
    const draw = (w, rt) => { r.setRenderTarget(rt); r.clear(); r.render(w.scene, w.camera); };
    const grade = (w, v) => v.copy(w.grade).multiplyScalar(w.ready * (1 + w.flash));
    draw(this.a, this.rtA);
    u.tA.value = this.rtA.texture;
    grade(this.a, u.uGradeA.value);
    const two = this.b && this.k > 0.002;
    if (two) { draw(this.b, this.rtB); grade(this.b, u.uGradeB.value); }
    u.tB.value = two ? this.rtB.texture : this.rtA.texture;
    u.uK.value = two ? this.k : 0;
    u.uTime.value = this.time;
    r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(r);
  }
}

let W = 1, H = 1, pr = 1, FOV = 50;
const composer = new T.EffectComposer(renderer);
const worldsPass = new WorldsPass();
composer.addPass(worldsPass);
const bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), 0.7, 0.55, 0.9);
composer.addPass(bloom);
composer.addPass(new T.OutputPass());
// the look of the films: teal shadows, amber highlights, grain, vignette; fade and flash for the intro
const grade = new T.ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 1 }, uFlash: { value: 0 }, uRes: { value: new T.Vector2(1, 1) } },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uFade, uFlash; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float ca = dot(d, d) * 0.006;
      vec3 c = vec3(texture2D(tDiffuse, vUv + d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ca).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * vec3(0.88, 1.0, 1.07), (1.0 - smoothstep(0.0, 0.45, l)) * 0.5);
      c = mix(c, c * vec3(1.07, 1.0, 0.9), smoothstep(0.45, 1.0, l) * 0.5);
      c *= 1.0 - smoothstep(0.35, 0.95, length(d * vec2(uRes.x / uRes.y, 1.0)) * 0.95) * 0.6;
      c += (h(vUv * uRes + fract(uTime * 7.0) * 100.0) - 0.5) * 0.04;
      c = mix(c, vec3(1.0, 0.96, 0.86), uFlash);
      gl_FragColor = vec4(c * uFade, 1.0);
    }`,
});
composer.addPass(grade);

// ---------------------------------------------------------------- particles shared by everything
// A point is a soft glow; size in world units; additive. Colours above 1 bloom.
const POINT_VS = /* glsl */ `
  attribute float aSize; attribute vec3 aColor; attribute float aAlpha;
  uniform float uPx; varying vec3 vColor; varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, aSize * length(modelViewMatrix[0].xyz) * uPx / -mv.z);
    vColor = aColor; vAlpha = aAlpha;
  }`;
const POINT_FS = /* glsl */ `
  uniform float uGain;
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d); a *= a;
    if (a * vAlpha < 0.003) discard;
    gl_FragColor = vec4(vColor * a * vAlpha * uGain, 1.0);
  }`;
const pxUniform = { value: 1 };
const pointMaterial = (extra = {}) => new T.ShaderMaterial({
  uniforms: { uPx: pxUniform, uGain: { value: 1 }, ...extra.uniforms },
  vertexShader: extra.vertexShader || POINT_VS,
  fragmentShader: extra.fragmentShader || POINT_FS,
  transparent: true, depthWrite: false, blending: extra.blending ?? T.AdditiveBlending,
});

// sparks: a pool of CPU particles for bursts, lightning, the case's fountain
class Sparks {
  constructor(n) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.g = new Float32Array(n); this.s0 = new Float32Array(n);
    this.i = 0;
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aColor", new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aSize", new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
    g.setAttribute("aAlpha", new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
    this.points = new T.Points(g, pointMaterial());
    this.points.frustumCulled = false;
  }
  emit(p, o = {}) {
    const k = this.i; this.i = (this.i + 1) % this.n;
    const sp = o.speed ?? 1, dir = o.dir;
    let vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1);
    if (dir) { vx = dir.x + rand(-1, 1) * (o.spread ?? 0.3); vy = dir.y + rand(-1, 1) * (o.spread ?? 0.3); vz = dir.z + rand(-1, 1) * (o.spread ?? 0.3); }
    const l = Math.hypot(vx, vy, vz) || 1, s = sp * rand(0.4, 1);
    this.pos.set([p.x, p.y, p.z], k * 3);
    this.vel.set([(vx / l) * s, (vy / l) * s, (vz / l) * s], k * 3);
    const c = o.color || [2.2, 1.6, 0.8];
    this.col.set(c, k * 3);
    this.life[k] = this.max[k] = (o.life ?? 1) * rand(0.6, 1);
    this.s0[k] = (o.size ?? 0.08) * rand(0.6, 1.2);
    this.g[k] = o.gravity ?? -0.5;
  }
  update(dt) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) { this.alpha[k] = 0; continue; }
      this.life[k] -= dt;
      const j = k * 3, f = 1 - 1.6 * dt;
      this.vel[j] *= f; this.vel[j + 1] = this.vel[j + 1] * f + this.g[k] * dt; this.vel[j + 2] *= f;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const t = Math.max(0, this.life[k] / this.max[k]);
      this.alpha[k] = Math.min(1, t * 1.5);
      this.size[k] = this.s0[k] * (0.4 + 0.6 * t);
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
  }
}

// builds point clouds: positions, colours, sizes, alphas and any extra attributes
class Cloud {
  constructor() { this.a = { position: [], aColor: [], aSize: [], aAlpha: [] }; this.extra = {}; }
  add(x, y, z, color, size, alpha, extra = {}) {
    this.a.position.push(x, y, z); this.a.aColor.push(...color); this.a.aSize.push(size); this.a.aAlpha.push(alpha);
    for (const k in extra) (this.extra[k] ||= []).push(...(Array.isArray(extra[k]) ? extra[k] : [extra[k]]));
  }
  line(p0, p1, n, color, size, alpha, extra, bend = [0, 0, 0]) {
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), b = Math.sin(t * Math.PI);
      this.add(lerp(p0[0], p1[0], t) + bend[0] * b, lerp(p0[1], p1[1], t) + bend[1] * b, lerp(p0[2], p1[2], t) + bend[2] * b, color, size, alpha, typeof extra === "function" ? extra(t) : extra);
    }
  }
  geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.a.position, 3));
    g.setAttribute("aColor", new T.Float32BufferAttribute(this.a.aColor, 3));
    g.setAttribute("aSize", new T.Float32BufferAttribute(this.a.aSize, 1));
    g.setAttribute("aAlpha", new T.Float32BufferAttribute(this.a.aAlpha, 1));
    const n = this.a.aSize.length;
    for (const k in this.extra) g.setAttribute(k, new T.Float32BufferAttribute(this.extra[k], this.extra[k].length / n));
    return g;
  }
}
const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const onSphere = () => { const u = rand(-1, 1), t = rand(0, TAU), s = Math.sqrt(1 - u * u); return [s * Math.cos(t), u, s * Math.sin(t)]; };

// ---------------------------------------------------------------- runes, for the circles
const runeTexture = (kind) => {
  const S = 1024, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.translate(S / 2, S / 2);
  g.strokeStyle = "#fff";
  g.lineCap = "round";
  const ring = (r, w, dash) => { g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); g.setLineDash([]); };
  const ticks = (r1, r2, n, w) => { g.lineWidth = w; g.beginPath(); for (let k = 0; k < n; k++) { const a = (k / n) * TAU, r = k % 4 ? r2 + (r1 - r2) * 0.5 : r2; g.moveTo(Math.sin(a) * r1, -Math.cos(a) * r1); g.lineTo(Math.sin(a) * r, -Math.cos(a) * r); } g.stroke(); };
  const runes = (r, n, h, off, w) => {
    const path = window.Magic?.runePath;
    if (!path) return;
    g.lineWidth = w;
    for (let k = 0; k < n; k++) {
      g.save(); g.rotate((k / n) * TAU); g.translate(0, -r);
      g.stroke(new Path2D(path(k * 7 + off, -0.3 * h, -0.5 * h, h)));
      g.restore();
    }
  };
  const poly = (r, n, w, rot = 0) => { g.lineWidth = w; g.beginPath(); for (let k = 0; k <= n; k++) { const a = rot + (k / n) * TAU; g[k ? "lineTo" : "moveTo"](Math.sin(a) * r, -Math.cos(a) * r); } g.stroke(); };
  if (kind === 0) { ring(500, 6); ring(480, 3); ticks(480, 455, 120, 3); runes(415, 32, 52, 0, 4); ring(360, 5); }
  else if (kind === 1) { ring(340, 3, [6, 22]); poly(330, 3, 3); poly(330, 3, 3, Math.PI); runes(270, 20, 44, 3, 4); ring(222, 4); }
  else { ring(200, 4, [60, 14, 6, 14]); ticks(200, 178, 48, 3); ring(120, 3); poly(118, 6, 2); }
  const tex = new T.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
};
let RUNE_TEX = null;
const runeTex = () => RUNE_TEX || (RUNE_TEX = [0, 1, 2].map(runeTexture));
const circleMaterial = (tex, color) => new T.ShaderMaterial({
  uniforms: { uTex: { value: tex }, uColor: { value: new T.Color(...color) }, uGlow: { value: 0.4 }, uRot: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uTex; uniform vec3 uColor; uniform float uGlow, uRot; varying vec2 vUv;
    void main() {
      vec2 p = vUv - 0.5; float c = cos(uRot), s = sin(uRot); p = mat2(c, -s, s, c) * p + 0.5;
      float a = texture2D(uTex, p).r, g = texture2D(uTex, p, 3.5).r;
      gl_FragColor = vec4(uColor * (a * 1.3 + g * 1.6) * uGlow, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
});

const MIST_FS = GLSL_NOISE + /* glsl */ `
  uniform float uTime, uAlpha; uniform vec3 uColA, uColB; varying vec2 vUv;
  void main() {
    vec2 p = vUv * vec2(3.0, 1.6);
    float n = fbm(vec3(p + vec2(uTime * 0.012, 0.0), uTime * 0.02));
    float m = fbm(vec3(p * 2.0 - vec2(uTime * 0.02, 0.0), 3.0));
    float a = smoothstep(0.35, 0.85, n) * (0.6 + 0.4 * m);
    a *= smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.6, vUv.y) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
    gl_FragColor = vec4(mix(uColA, uColB, m) * a * uAlpha, 1.0);
  }`;

// dust drifting in the light, fireflies everywhere
const motes = (n, area, opts) => {
  const c = new Cloud();
  for (let i = 0; i < n; i++) c.add(rand(-area[0], area[0]), rand(-area[1], area[1]), rand(-area[2], area[2]), opts.color(), rand(...opts.size), rand(...opts.alpha), { aRand: Math.random() });
  return new T.Points(c.geometry(), pointMaterial({
    uniforms: { uTime: { value: 0 }, uSpeed: { value: opts.speed } },
    vertexShader: /* glsl */ `
      attribute float aSize; attribute vec3 aColor; attribute float aAlpha; attribute float aRand;
      uniform float uPx, uTime, uSpeed; varying vec3 vColor; varying float vAlpha;
      void main() {
        float t = uTime * uSpeed;
        vec3 p = position + vec3(sin(t * (0.7 + aRand) + aRand * 40.0), sin(t * (0.5 + aRand * 0.7) + aRand * 23.0), cos(t * (0.6 + aRand * 0.5) + aRand * 11.0)) * (0.4 + aRand * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * length(modelViewMatrix[0].xyz) * uPx / -mv.z, 1.0, 14.0); // a mote never grows into a blot
        float b = max(0.0, sin(uTime * (0.6 + aRand * 1.4) + aRand * 50.0));
        vColor = aColor; vAlpha = aAlpha * mix(1.0, b * b * b, ${opts.blink ? "1.0" : "0.35"}) * smoothstep(1.5, 4.0, -mv.z); // none right in front of the lens
      }`,
  }));
};

// ================================================================ THE WORLDS
const texLoader = new T.TextureLoader();
const gltfLoader = new T.GLTFLoader();
const pmrem = new T.PMREMGenerator(renderer);
const models = {};
// Poly Haven models are folders of glTF; "creatures/x" is a single GLB (Sketchfab)
const model = (name) => (models[name] ||= gltfLoader.loadAsync(name.includes("/") ? `/assets/${name}.glb` : `/assets/models/${name}/${name}.gltf`).then((g) => g.scene));
const place = (w, name, pos, rotY = 0, scale = 1, then) => model(name).then((s) => {
  const o = s.clone();
  o.position.set(...pos);
  o.rotation.y = rotY;
  o.scale.setScalar(scale);
  w.scene.add(o);
  then?.(o);
  return o;
}).catch((e) => console.warn("vivarium: model", name, e));

const makeWorld = (name, def) => {
  const scene = new T.Scene();
  scene.background = new T.Color(0x05080f);
  const camera = new T.PerspectiveCamera(FOV, 1, 0.05, 500);
  const w = { name, def, scene, camera, grade: new T.Vector3(...def.grade), flash: 0, ready: 0, loaded: false, loading: false, excite: 0, target: 0, t: rand(0, 40), p: 0, sparks: new Sparks(500) };
  scene.add(w.sparks.points);
  def.build?.(w);
  return w;
};
const load = (w) => {
  if (w.loading || !w.def.hdri) return;
  w.loading = true;
  texLoader.loadAsync(`/assets/hdri/${w.def.hdri}.jpg`).then((tex) => {
    tex.mapping = T.EquirectangularReflectionMapping;
    tex.colorSpace = T.SRGBColorSpace;
    if (w.def.flat) { // tall trees close by bend when projected on the ground: the photo stays a backdrop
      w.scene.background = tex;
      w.scene.backgroundRotation.y = w.def.turn ?? 0;
    } else {
      const sky = new T.GroundedSkybox(tex, w.def.height ?? 2, w.def.radius ?? 80);
      sky.position.y = (w.def.height ?? 2) - 0.01;
      sky.rotation.y = w.def.turn ?? 0;
      w.scene.add(sky);
    }
    w.scene.environment = pmrem.fromEquirectangular(tex).texture;
    w.scene.environmentIntensity = w.def.env ?? 1;
    w.scene.environmentRotation.y = w.def.turn ?? 0;
    w.loaded = true;
  }).catch((e) => console.warn("vivarium: sky", w.name, e));
  w.def.load?.(w);
  if (w.def.creature) beast(w, w.def.creature);
};

const hit = new T.Vector3();
// a burst of sparks around a point of a world
const burst = (w, p, n, o = {}) => { for (let i = 0; i < n; i++) w.sparks.emit(p, { speed: 1.6, life: 1.2, size: 0.12, gravity: -0.3, color: i % 2 ? [0.8, 2.4, 3] : [2.6, 1.8, 0.8], ...o }); };

// ribbons of ancient magic in a box of a world: bright heads winding, their trails behind
const ribbons = (w, n, box) => {
  const TRAIL = 70, c = new Cloud();
  for (let k = 0; k < n; k++) for (let i = 0; i < TRAIL; i++) { const f = 1 - i / TRAIL; c.add(0, 0, 0, k % 3 ? [0.7, 2.2, 2.8] : [2.6, 1.8, 0.8], 0.02 + 0.08 * f * f, f * 0.9, {}); }
  const g = c.geometry();
  g.attributes.position.setUsage(T.DynamicDrawUsage);
  const pts = new T.Points(g, pointMaterial());
  pts.frustumCulled = false;
  w.scene.add(pts);
  const heads = Array.from({ length: n }, () => ({ p: new T.Vector3(rand(box[0], box[1]), rand(box[2], box[3]), rand(box[4], box[5])), a: rand(0, TAU), b: 0, sp: rand(1.2, 2), loop: 0, next: rand(2, 6), hist: [] }));
  return (dt, t) => {
    const pos = g.attributes.position.array;
    heads.forEach((s, k) => {
      s.next -= dt;
      if (s.loop > 0) { s.loop -= dt; s.a += 4 * dt; }
      else {
        s.a += Math.sin(t * 0.7 + k * 3) * 0.9 * dt;
        s.b = Math.sin(t * 0.5 + k) * 0.6;
        if (s.next < 0) { s.loop = TAU / 4; s.next = rand(4, 9); }
        const cx = (box[0] + box[1]) / 2, cy = (box[2] + box[3]) / 2;
        if (s.p.x < box[0] || s.p.x > box[1] || s.p.y < box[2] || s.p.y > box[3]) s.a = Math.atan2(cy - s.p.y, cx - s.p.x);
      }
      s.p.x += Math.cos(s.a) * Math.cos(s.b) * s.sp * dt;
      s.p.y += Math.sin(s.a) * Math.cos(s.b) * s.sp * dt;
      s.p.z = clamp(s.p.z + Math.sin(s.b) * s.sp * dt, box[4], box[5]);
      s.hist.unshift(s.p.clone());
      if (s.hist.length > TRAIL) s.hist.length = TRAIL;
      for (let i = 0; i < TRAIL; i++) { const h = s.hist[Math.min(i, s.hist.length - 1)]; pos.set([h.x, h.y, h.z], (k * TRAIL + i) * 3); }
      if (Math.random() < dt * 5) w.sparks.emit(s.p, { speed: 0.25, life: 1.2, size: 0.05, gravity: -0.12, color: k % 3 ? [0.7, 2.2, 2.8] : [2.6, 1.8, 0.8] });
    });
    g.attributes.position.needsUpdate = true;
  };
};

// fireflies, dust, spores: drifting motes around the camera of a world
const air = (w, n, center, size, opts) => {
  const m = motes(n, size, opts);
  m.position.set(...center);
  w.scene.add(m);
  return (t) => { m.material.uniforms.uTime.value = t; };
};

// a glowing mushroom cluster
const mushrooms = (w, x, z, n, hue) => {
  const cap = new T.MeshStandardMaterial({ color: hue, emissive: hue, emissiveIntensity: 3, roughness: 0.5 });
  const stem = new T.MeshStandardMaterial({ color: 0xb8c4c8, roughness: 0.8 });
  for (let k = 0; k < n; k++) {
    const h = rand(0.05, 0.22), r = rand(0.03, 0.09), px = x + rand(-0.4, 0.4), pz = z + rand(-0.4, 0.4);
    const s = new T.Mesh(new T.CylinderGeometry(r * 0.18, r * 0.25, h, 8), stem);
    s.position.set(px, h / 2, pz);
    const c = new T.Mesh(new T.SphereGeometry(r, 16, 8, 0, TAU, 0, Math.PI / 2), cap);
    c.position.set(px, h, pz);
    c.scale.y = 0.55;
    w.scene.add(s, c);
  }
  const l = new T.PointLight(hue, 4, 4, 1.8);
  l.position.set(x, 0.35, z);
  w.scene.add(l);
};

// a circle of runes lying on the ground
const groundCircle = (layers, color) => {
  const g = new T.Group();
  const tex = runeTex();
  g.userData.layers = layers.map(([k, size, speed]) => {
    const m = new T.Mesh(new T.PlaneGeometry(size, size), circleMaterial(tex[k], color));
    m.rotation.x = -Math.PI / 2;
    m.userData.speed = speed;
    g.add(m);
    return m;
  });
  return g;
};
const turnCircle = (g, dt, glow, fast) => { for (const c of g.userData.layers) { c.material.uniforms.uRot.value += dt * c.userData.speed * (1 + fast * 4); c.material.uniforms.uGlow.value = glow; } };

// ---- the creatures: real models (Sketchfab, CC-BY, see assets/README.md), animated when they come
// with animations. c = { dir, size (m, largest side), yaw (to face along +z) }
const creatureModel = (c) => gltfLoader.loadAsync(`/assets/creatures/${c.dir}.glb`).then((g) => {
  const o = g.scene;
  o.updateMatrixWorld(true);
  let box = new T.Box3().setFromObject(o);
  const sz = box.getSize(new T.Vector3());
  o.scale.multiplyScalar(c.size / Math.max(sz.x, sz.y, sz.z));
  o.updateMatrixWorld(true);
  box = new T.Box3().setFromObject(o);
  o.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const inner = new T.Group(); // turned so that the creature looks along +z
  inner.rotation.y = c.yaw || 0;
  inner.add(o);
  const holder = new T.Group();
  holder.add(inner);
  const tint = c.tint ? new T.Color(c.tint) : null;
  o.traverse((m) => {
    if (!m.isMesh) return;
    m.frustumCulled = false;
    if (m.material) { if (tint) { m.material = m.material.clone(); m.material.color?.multiply(tint); } m.material.envMapIntensity = c.env ?? 1; }
  });
  const it = { holder, mixer: null, actions: {}, current: null };
  if (g.animations.length) {
    it.mixer = new T.AnimationMixer(o);
    for (const a of g.animations) it.actions[a.name] = it.mixer.clipAction(a);
    const first = g.animations.find((a) => c.clip && a.name.toLowerCase().includes(c.clip)) || g.animations[0];
    it.current = it.actions[first.name].play();
  }
  return it;
});
// cross-fade to the animation whose name contains part
const playClip = (it, part, fade = 0.4) => {
  const name = Object.keys(it.actions).find((n) => n.toLowerCase().includes(part));
  const a = name && it.actions[name];
  if (!a || a === it.current) return;
  a.reset().play();
  it.current.crossFadeTo(a, fade, false);
  it.current = a;
};
const beast = (w, c) => creatureModel(c).then((it) => {
  w.scene.add(it.holder);
  w.beast = it.holder;
  w.mixer = it.mixer;
  w.it = it;
  w.def.placed?.(w);
}).catch((e) => console.warn("vivarium: creature", c.dir, e.message || e));

// a warm or cold light that follows a creature, and a circle of runes under it when it wakes
const halo = (w, color, power) => { w.glow = new T.PointLight(color, 0, 6, 1.6); w.scene.add(w.glow); w.glowPower = power; };
const circleUnder = (w, size) => { w.circle = groundCircle([[0, size, 0.05], [2, size * 0.55, -0.12]], [0.6, 1.6, 2.0]); w.circle.visible = false; w.scene.add(w.circle); };

const DEFS = {
  // the media world: the starry night (Jellyfin and the other apps); Fawkes is often about
  night: {
    hdri: "rogland_clear_night", height: 2, radius: 90, grade: [1.0, 1.0, 1.12], env: 0.6, turn: 0.3, free: 1,
    cam: [0, 1.5, 5.5], look: [0, 2.6, -6],
    build(w) {
      w.ribbons = ribbons(w, 4, [-7, 7, 0.6, 6, -9, -2]);
      w.air = air(w, 220, [0, 3, -4], [12, 4, 6], { color: () => (Math.random() < 0.4 ? [0.8, 2.6, 3.2] : [3.0, 2.2, 0.9]), size: [0.04, 0.09], alpha: [0.5, 1], speed: 0.35, blink: true });
    },
    tick(w, dt, t) { w.ribbons(dt, t); w.air(t); },
  },
  // the Niffler's den (the trading bot): a cave, the Niffler on its pile of gold
  cave: {
    hdri: "hikers_cave", height: 1.8, radius: 40, grade: [0.42, 0.48, 0.64], env: 0.5, turn: 3.67, free: 1,
    cam: [0, 1.3, 3.5], look: [0, 1.0, -6],
    creature: { dir: "niffler", size: 0.75, yaw: 0, env: 2.5 },
    build(w) {
      mushrooms(w, -1.8, -2.8, 9, 0x4fe0ff);
      mushrooms(w, -2.6, -5.5, 6, 0x9a6cff);
      halo(w, 0xffc060, 16);
      circleUnder(w, 1.6);
      // a cold light from behind, to draw its black fur out of the dark
      const rim = new T.SpotLight(0x9fd8ff, 30, 8, 0.5, 0.6, 1.5);
      rim.position.set(2.6, 2, -5);
      rim.target.position.set(1.3, 0.3, -2.4);
      w.scene.add(rim, rim.target);
      w.air = air(w, 200, [0, 1.2, -4], [6, 2, 3], { color: () => (Math.random() < 0.6 ? [0.6, 2.0, 3.0] : [2.6, 2.0, 0.8]), size: [0.02, 0.05], alpha: [0.3, 0.8], speed: 0.25, blink: true });
    },
    load(w) {
      place(w, "moon_rock_03", [-3, 0, -4.5], 0.3, 2.4);
      place(w, "creatures/coins", [1.75, 0, -2.3], 0.4, 1, (o) => { const b = new T.Box3().setFromObject(o), k = 0.5 / Math.max(...b.getSize(new T.Vector3()).toArray()); o.scale.setScalar(k); });
    },
    tick(w, dt, t) {
      w.air(t);
      if (!w.beast) return;
      const e = w.excite;
      // it sniffs about, and hops up when you come to see the gold
      w.beast.position.set(1.3, Math.abs(Math.sin(t * 9)) * 0.08 * e, -2.4);
      w.beast.rotation.y = -0.5 + Math.sin(t * 0.8) * 0.35 * (1 - e) + mouse.sx * 0.4;
      w.circle.visible = true;
      w.circle.position.set(1.3, 0.01, -2.4);
      turnCircle(w.circle, dt, 0.1 + e * 0.9, e);
      w.glow.position.set(0.8, 1.3, -1.4);
      w.glow.intensity = w.glowPower * (0.6 + e);
      if (Math.random() < dt * (3 + e * 12)) w.sparks.emit(new T.Vector3(1.9 + rand(-0.3, 0.3), 0.15, -3.1 + rand(-0.2, 0.2)), { dir: { x: 0, y: 1, z: 0 }, spread: 0.3, speed: 0.5, life: 1, size: 0.05, gravity: -0.2, color: [3, 2.2, 0.8] });
    },
    wake(w) { burst(w, new T.Vector3(1.8, 0.4, -3.1), 50, { speed: 2, size: 0.08, color: [3, 2.2, 0.8] }); },
  },
  // the Bowtruckle's tree (Sapling Sunrise): a mossy forest, Pickett on his stump
  forest: {
    hdri: "mossy_forest", height: 2, radius: 70, grade: [0.75, 0.88, 0.8], env: 0.9, turn: 0.7, free: -1,
    cam: [0, 1.4, 3.6], look: [0, 1.2, -6],
    creature: { dir: "bowtruckle", size: 0.95, yaw: 0, env: 1.4 },
    build(w) {
      halo(w, 0xd8ffb0, 8);
      w.air = air(w, 160, [0, 1.6, -4], [8, 2, 3], { color: () => (Math.random() < 0.5 ? [1.6, 2.6, 0.8] : [3.0, 2.2, 0.9]), size: [0.03, 0.07], alpha: [0.5, 1], speed: 0.3, blink: true });
    },
    load(w) {
      place(w, "rock_moss_set_01", [2.6, 0, -7], 0.4, 1);
      place(w, "fern_02", [-0.6, 0, -2.8], 2.2, 1.1);
      place(w, "fern_02", [-2.6, 0, -4.6], 4.0, 1.4);
      place(w, "moss_01", [-1.6, 0, -3.6], 0, 2);
      place(w, "tree_stump_01", [-1.2, 0, -2.6], 1.1, 0.9, (o) => { w.stumpTop = new T.Box3().setFromObject(o).max.y; w.def.placed?.(w); });
    },
    placed(w) { if (w.beast && w.stumpTop) w.beast.position.set(-1.2, w.stumpTop - 0.02, -2.6); },
    tick(w, dt, t) {
      w.air(t);
      if (!w.beast) return;
      const e = w.excite;
      w.beast.rotation.set(Math.sin(t * 2.2) * 0.04 * (1 + e * 3), 0.5 + mouse.sx * 0.5, Math.sin(t * 1.7) * 0.05 * (1 + e * 3));
      w.glow.position.set(-0.8, 1.4, -1.6);
      w.glow.intensity = w.glowPower * (0.5 + e);
    },
    wake(w) { if (w.beast) burst(w, w.beast.position.clone().add(new T.Vector3(0, 0.3, 0)), 30, { speed: 1.2, size: 0.05, color: [1.6, 2.6, 0.8] }); },
  },
  // the Hippogriff's forest (Bifrost): pines in the mist, a hippogriff standing there; come near and it
  // rears up, as Buckbeak does before he lets you close
  mist: {
    hdri: "misty_pines", flat: true, grade: [0.66, 0.7, 0.76], env: 0.8, turn: 3.9, free: 1,
    cam: [0, 1.4, 4], look: [0, 1.1, -6],
    creature: { dir: "hippogriff", size: 5.2, clip: "idle", env: 1.9 },
    build(w) {
      w.veils = [];
      for (const [z, a] of [[-2.5, 0.04], [-6, 0.06]]) {
        const v = new T.Mesh(new T.PlaneGeometry(26, 4), new T.ShaderMaterial({
          uniforms: { uTime: { value: rand(0, 50) }, uAlpha: { value: a }, uColA: { value: new T.Color(0.5, 0.56, 0.62) }, uColB: { value: new T.Color(0.7, 0.75, 0.8) } },
          vertexShader: QUAD_VS, fragmentShader: MIST_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending,
        }));
        v.position.set(0, 1.3, z);
        w.scene.add(v);
        w.veils.push(v);
      }
      halo(w, 0xdfe8ff, 10);
      w.air = air(w, 200, [0, 1.6, -4], [8, 2, 3], { color: () => [1.4, 1.5, 1.8], size: [0.02, 0.05], alpha: [0.2, 0.6], speed: 0.2 });
    },
    placed(w) { w.beast.position.set(2.2, 0, -3.6); },
    tick(w, dt, t) {
      w.air(t);
      for (const v of w.veils) v.material.uniforms.uTime.value += dt;
      if (!w.beast) return;
      w.beast.rotation.y = -0.7 + mouse.sx * 0.35;
      w.glow.position.set(1.2, 2.4, -2.6);
      w.glow.intensity = w.glowPower * (0.6 + w.excite * 0.8);
      if (w.target && w.it.current && !w.reared) { w.reared = true; playClip(w.it, "taunt", 0.3); }
      if (!w.target && w.reared) { w.reared = false; playClip(w.it, "idle", 0.6); }
    },
    wake(w) { if (w.beast) burst(w, w.beast.position.clone().add(new T.Vector3(0, 1.2, 0)), 30, { speed: 1.5, size: 0.08, color: [1.6, 1.7, 2.2] }); },
  },
  // Newt's shed (Errol): his table and lamp, and an owl flying under the rafters
  shed: {
    hdri: "hayloft", height: 1.7, radius: 30, grade: [0.55, 0.5, 0.45], env: 0.7, turn: 1.57, free: -1,
    cam: [0, 1.5, 2.4], look: [0, 1.3, -3],
    creature: { dir: "owl", size: 1.1, tint: 0xa08c78 }, // Errol: an old grey-brown owl
    build(w) {
      w.lamp = new T.PointLight(0xffc070, 0, 6, 1.5);
      w.scene.add(w.lamp);
      w.air = air(w, 260, [0, 1.4, -3], [4, 1.5, 2], { color: () => [1.8, 1.4, 0.8], size: [0.012, 0.03], alpha: [0.2, 0.6], speed: 0.15 });
    },
    load(w) {
      place(w, "WoodenTable_03", [-0.9, 0, -2.6], 0.1, 1, (table) => {
        const top = new T.Box3().setFromObject(table).max.y;
        place(w, "desk_lamp_arm_01", [-0.3, top, -2.8], -2.2, 1, () => { w.lamp.position.set(-0.5, top + 0.45, -2.5); w.lamp.intensity = 5; });
        place(w, "seeding_tray_01", [-1.3, top, -2.5], 0.3, 1);
      });
      place(w, "watering_can_metal_01", [-2.2, 0, -2.2], 1.2, 1);
      place(w, "wooden_bookshelf_worn", [-3.2, 0, -4.2], 0.5, 1);
    },
    tick(w, dt, t) {
      w.air(t);
      w.lamp.intensity = w.lamp.intensity ? 5 + Math.sin(t * 7) * 0.15 : 0;
      if (!w.beast) return;
      const e = w.excite, a = w.t * (0.5 + e * 0.2);
      const at = (k, out) => out.set(-1.2 + Math.cos(k) * (2.2 - e * 0.6), 2.4 + Math.sin(k * 2) * 0.3 - e * 0.4, -4.5 + Math.sin(k) * 1.6 + e * 1.5);
      at(a, w.beast.position);
      w.beast.lookAt(at(a + 0.05, hit));
      w.beast.rotateZ(Math.cos(a) * 0.3);
    },
  },
};
const CREATURE_WORLD = { phoenix: "night", niffler: "cave", bowtruckle: "forest", hippogriff: "mist", owl: "shed" };

const worlds = {};
for (const name in DEFS) worlds[name] = makeWorld(name, DEFS[name]);

// ================================================================ THE CASE (intro): its own scene and camera
const caseScene = new T.Scene();
const caseCam = new T.PerspectiveCamera(40, 1, 0.1, 100);
const caseSparks = new Sparks(700);
const caseWorld = { scene: caseScene, camera: caseCam, grade: new T.Vector3(1, 1, 1), ready: 1, flash: 0 };
let intro = null;
const leatherTexture = () => {
  const S = 512, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S);
  seed = 99;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm3(x / 40, y / 40, 1, 4), f = fbm3(x / 4, y / 4, 3, 2) * 0.5, scuff = Math.max(0, fbm3(x / 90, y / 90, 9, 3) - 0.2) * 1.6;
    const v = 1 + n * 0.35 + f * 0.25 + scuff * 0.4;
    const k = (y * S + x) * 4;
    img.data[k] = clamp(110 * v, 0, 255); img.data[k + 1] = clamp(68 * v, 0, 255); img.data[k + 2] = clamp(38 * v, 0, 255); img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // stitching along the edges
  g.strokeStyle = "rgba(214, 180, 130, 0.75)";
  g.lineWidth = 3;
  g.setLineDash([12, 9]);
  g.strokeRect(22, 22, S - 44, S - 44);
  // darker worn edges
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  gr.addColorStop(0, "rgba(0,0,0,0)");
  gr.addColorStop(1, "rgba(20,8,0,0.45)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
const buildCase = () => {
  caseScene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
  caseScene.environmentIntensity = 0.35;
  caseScene.background = new T.Color(0x040305);
  caseScene.fog = new T.Fog(0x040305, 9, 26);
  const leather = new T.MeshStandardMaterial({ map: leatherTexture(), roughness: 0.62, metalness: 0, bumpScale: 1.5 });
  leather.bumpMap = leather.map;
  const darkLeather = new T.MeshStandardMaterial({ color: 0x2e1a0c, roughness: 0.7 });
  const brass = new T.MeshStandardMaterial({ color: 0xc4934a, roughness: 0.38, metalness: 1 });
  const floor = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ color: 0x0e0a08, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  caseScene.add(floor);
  const spot = new T.SpotLight(0xffd6a0, 150, 30, 0.42, 0.6, 1.6);
  spot.position.set(2.5, 9, 5);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0004;
  caseScene.add(spot, spot.target);
  const back = new T.DirectionalLight(0x6fa8ff, 1.2);
  back.position.set(-6, 4, -8);
  caseScene.add(back, new T.AmbientLight(0x30261e, 0.6));

  const g = new T.Group();
  const W = 4.4, Hb = 1.15, Hl = 0.55, D = 2.6;
  const body = new T.Mesh(new T.RoundedBoxGeometry(W, Hb, D, 5, 0.16), leather);
  body.position.y = Hb / 2;
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const pivot = new T.Group();
  pivot.position.set(0, Hb, -D / 2);
  g.add(pivot);
  const lid = new T.Mesh(new T.RoundedBoxGeometry(W, Hl, D, 5, 0.16), leather);
  lid.position.set(0, Hl / 2, D / 2);
  lid.castShadow = true;
  pivot.add(lid);
  // the inside of the lid: black, like the inside of the case
  const lining = new T.Mesh(new T.PlaneGeometry(W - 0.26, D - 0.26), new T.MeshStandardMaterial({ color: 0x050405, roughness: 1 }));
  lining.rotation.x = Math.PI / 2;
  lining.position.set(0, 0.02, D / 2);
  pivot.add(lining);
  // brass corners
  const corner = new T.RoundedBoxGeometry(0.42, 0.42, 0.42, 3, 0.08);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cb = new T.Mesh(corner, brass);
    cb.position.set(sx * (W / 2 - 0.15), 0.16, sz * (D / 2 - 0.15));
    cb.castShadow = true;
    g.add(cb);
    const ct = new T.Mesh(corner, brass);
    ct.position.set(sx * (W / 2 - 0.15), Hl - 0.16, D / 2 + sz * (D / 2 - 0.15));
    pivot.add(ct);
  }
  // clasps on the front, over the seam
  const clasps = [];
  for (const sx of [-1, 1]) {
    const cp = new T.Group();
    cp.position.set(sx * 1.25, Hb - 0.2, D / 2 + 0.03);
    const plate = new T.Mesh(new T.RoundedBoxGeometry(0.42, 0.5, 0.09, 2, 0.03), brass);
    plate.position.y = 0.25;
    cp.add(plate);
    const latch = new T.Mesh(new T.BoxGeometry(0.16, 0.08, 0.06), darkLeather);
    latch.position.set(0, 0.08, 0.05);
    cp.add(latch);
    g.add(cp);
    clasps.push(cp);
  }
  // the handle on the front, hanging, with its brass fittings
  const handle = new T.Mesh(new T.TorusGeometry(0.42, 0.075, 12, 40, Math.PI), darkLeather);
  handle.rotation.set(Math.PI / 2 + 0.35, 0, 0);
  handle.position.set(0, Hb - 0.05, D / 2 + 0.06);
  g.add(handle);
  for (const sx of [-1, 1]) { const f = new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 0.12, 16), brass); f.rotation.x = Math.PI / 2; f.position.set(sx * 0.42, Hb - 0.05, D / 2 + 0.04); g.add(f); }
  // the dial on the lid: Muggle worthy
  const dc = document.createElement("canvas");
  dc.width = dc.height = 256;
  const dg = dc.getContext("2d");
  dg.fillStyle = "#1c120a"; dg.beginPath(); dg.arc(128, 128, 120, 0, TAU); dg.fill();
  dg.fillStyle = "#f3d48a"; dg.font = "600 30px Cinzel, serif"; dg.textAlign = "center";
  dg.fillText("MUGGLE", 128, 92); dg.fillText("WORTHY", 128, 196);
  const dialTex = new T.CanvasTexture(dc);
  dialTex.colorSpace = T.SRGBColorSpace;
  const dial = new T.Mesh(new T.CylinderGeometry(0.34, 0.36, 0.06, 40), [brass, new T.MeshStandardMaterial({ map: dialTex, roughness: 0.5 }), brass]);
  dial.position.set(1.35, Hl + 0.03, D / 2 + 0.55);
  pivot.add(dial);
  const lever = new T.Mesh(new T.BoxGeometry(0.04, 0.03, 0.26), brass);
  lever.geometry.translate(0, 0, 0.11);
  lever.position.set(1.35, Hl + 0.08, D / 2 + 0.55);
  lever.rotation.y = Math.PI * 0.85;
  pivot.add(lever);
  // the luggage tag
  const tc = document.createElement("canvas");
  tc.width = 256; tc.height = 128;
  const tg = tc.getContext("2d");
  tg.fillStyle = "#e6d3a6"; tg.fillRect(0, 0, 256, 128);
  tg.fillStyle = "#5a3a14"; tg.font = "600 40px Cinzel, serif"; tg.textAlign = "center"; tg.fillText("N.A.F.S.", 128, 80);
  const tagTex = new T.CanvasTexture(tc);
  tagTex.colorSpace = T.SRGBColorSpace;
  const tag = new T.Mesh(new T.PlaneGeometry(0.5, 0.25), new T.MeshStandardMaterial({ map: tagTex, color: 0x8a8070, roughness: 0.9, side: T.DoubleSide }));
  tag.position.set(0.55, Hb - 0.42, D / 2 + 0.1);
  tag.rotation.set(-0.15, 0.2, 0.25);
  g.add(tag);
  // what is inside: black, bottomless, with a light rising from the depths, and the top of the ladder
  const glow = new T.Mesh(new T.PlaneGeometry(W - 0.26, D - 0.26), new T.ShaderMaterial({
    uniforms: { uL: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uL, uTime; varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * vec2(1.7, 1.0);
        float r = length(p);
        float deep = pow(max(0.0, 1.0 - r * 1.6), 2.5);
        vec3 c = vec3(1.0, 0.82, 0.55) * deep * 3.2 + vec3(0.4, 1.2, 1.5) * pow(max(0.0, 1.0 - r * 2.4), 3.0) * 1.5;
        gl_FragColor = vec4(c * uL * (0.92 + 0.08 * sin(uTime * 7.0)), 1.0);
      }`,
  }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = Hb + 0.006;
  g.add(glow);
  const wood = new T.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.8 });
  const ladder = new T.Group();
  for (const sx of [-0.28, 0.28]) { const rail = new T.Mesh(new T.BoxGeometry(0.06, 1.3, 0.06), wood); rail.position.set(sx, 0, 0); ladder.add(rail); }
  for (let y = -0.5; y < 0.6; y += 0.28) { const rung = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.56, 8), wood); rung.rotation.z = Math.PI / 2; rung.position.y = y; ladder.add(rung); }
  ladder.position.set(-0.6, Hb + 0.05, -0.55);
  ladder.rotation.x = -0.28;
  ladder.visible = false;
  g.add(ladder);
  const inner = new T.PointLight(0xffd090, 0, 12, 1.5);
  inner.position.set(0, Hb + 0.6, 0);
  g.add(inner);
  const rayMat = new T.ShaderMaterial({
    uniforms: { uA: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uA; varying vec2 vUv; void main() { float a = pow(1.0 - vUv.y, 1.6) * smoothstep(0.5, 0.0, abs(vUv.x - 0.5)); gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * a * uA * 1.6, 1.0); }`,
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false,
  });
  const rays = new T.Group();
  for (let k = 0; k < 9; k++) {
    const r = new T.Mesh(new T.PlaneGeometry(rand(0.4, 1.1), 9), rayMat);
    r.geometry.translate(0, 4.5, 0);
    r.position.set(rand(-1.6, 1.6), Hb, rand(-0.8, 0.8));
    r.rotation.set(rand(-0.15, 0.15), rand(0, Math.PI), rand(-0.25, 0.25));
    rays.add(r);
  }
  rays.scale.y = 0.001;
  g.add(rays);
  caseScene.add(g);
  caseScene.add(caseSparks.points);
  return { g, pivot, clasps, lever, glow, ladder, inner, rays, rayMat, t: 0, done: false, D, Hb };
};

// ================================================================ FAWKES AND HEDWIG
// They are not of one world: they go with you. Fawkes, Dumbledore's phoenix, wanders about the free
// side of the screen (def.free: 1 right, -1 left), crossing over now and then; coming near Jellyfin
// calls him close. Hedwig flies across the screen now and then, and with every piece of news
// (window.Vivarium.hedwig()). Both live in camera space and move into the scene of the world shown.
const pals = { fawkes: null, hedwig: null };
creatureModel({ dir: "phoenix", size: 2.4 }).then((it) => {
  const light = new T.PointLight(0xff8a30, 14, 7, 1.6);
  light.position.y = 0.6;
  it.holder.add(light);
  pals.fawkes = { ...it, light, p: new T.Vector3(4, 1, -10), v: new T.Vector3(), target: new T.Vector3(4, 1, -10), next: 0 };
}).catch((e) => console.warn("vivarium: Fawkes", e.message || e));
creatureModel({ dir: "owl", size: 1, env: 2.2 }).then((it) => {
  // white feathers, matt, with a little light of their own so that she stays white even at night
  it.holder.traverse((m) => {
    if (!m.isMesh) return;
    m.material = m.material.clone();
    Object.assign(m.material, { metalness: 0, roughness: 0.85, emissive: new T.Color(0.55, 0.57, 0.62), emissiveMap: m.material.map, emissiveIntensity: 0.55 });
  });
  pals.hedwig = { ...it, t: -1 };
}).catch((e) => console.warn("vivarium: Hedwig", e.message || e));
const hedwig = () => {
  const h = pals.hedwig;
  if (!h || h.t >= 0 || (intro && !intro.done)) return false;
  Object.assign(h, { t: 0, dir: Math.random() < 0.5 ? 1 : -1, y: rand(0.35, 0.6), depth: rand(4.5, 6) });
  return true;
};
window.Vivarium = { hedwig };
let nextHedwig = rand(40, 70);
const into = (o, scene) => { if (o.parent !== scene) scene.add(o); };
const tmpV = new T.Vector3(), tmpD = new T.Vector3();
const stepPals = (w, dt) => {
  const cam = w.camera, th = Math.tan((cam.fov * Math.PI) / 360), asp = cam.aspect;
  const f = pals.fawkes;
  if (f) {
    into(f.holder, w.scene);
    const side = w.def.free ?? 1, called = worlds.night.excite > 0.5 && w === worlds.night;
    f.next -= dt;
    if (called) { const d = 6; f.target.set(side * 0.5 * d * th * asp, 0.15 * d * th, -d); }
    else if (f.next < 0 || f.p.distanceTo(f.target) < 0.8) {
      const d = rand(6, 13), hw = d * th * asp, hh = d * th;
      const cross = Math.random() < 0.18; // now and then over to the other side, or away out of sight
      f.target.set(cross ? -side * rand(0.3, 1.3) * hw : side * rand(0.3, 0.85) * hw, rand(-0.05, 0.7) * hh, -d);
      f.next = rand(4, 8);
    }
    tmpD.copy(f.target).sub(f.p).normalize().multiplyScalar(called ? 3.2 : 2.2);
    f.v.lerp(tmpD, Math.min(1, dt * 1.1));
    f.p.addScaledVector(f.v, dt);
    cam.updateMatrixWorld();
    f.holder.position.copy(cam.localToWorld(tmpV.copy(f.p)));
    const ahead = tmpD.copy(f.v).transformDirection(cam.matrixWorld).add(f.holder.position);
    f.holder.lookAt(ahead);
    f.mixer?.update(dt * (called ? 1.4 : 1));
    f.light.intensity = 14 * (0.85 + 0.15 * Math.sin(time * 9));
    if (Math.random() < dt * 16) w.sparks.emit(f.holder.position, { speed: 0.5, life: 1.3, size: 0.08, gravity: -0.3, color: Math.random() < 0.7 ? [3.0, 1.3, 0.35] : [3.0, 2.4, 1.0] });
  }
  const h = pals.hedwig;
  if (h) {
    nextHedwig -= dt;
    if (nextHedwig < 0) { hedwig(); nextHedwig = rand(80, 160); }
    if (h.t >= 0) {
      into(h.holder, w.scene);
      h.t += dt / 7;
      const k = h.t, d = h.depth, hw = d * th * asp, hh = d * th;
      const at = (q, out) => out.set(h.dir * (-1.4 + 2.8 * q) * hw, (h.y + Math.sin(q * Math.PI) * 0.12 - q * 0.1) * hh, -d - Math.sin(q * Math.PI) * 1.5);
      cam.updateMatrixWorld();
      h.holder.position.copy(cam.localToWorld(at(k, tmpV)));
      h.holder.lookAt(cam.localToWorld(at(k + 0.02, tmpD)));
      h.mixer?.update(dt);
      if (Math.random() < dt * 5) w.sparks.emit(h.holder.position, { speed: 0.3, life: 1.2, size: 0.05, gravity: -0.1, color: [2.2, 2.3, 2.6] });
      if (k > 1) { h.t = -1; h.holder.removeFromParent(); }
    }
  }
};

// ================================================================ the page: which world, how far across
let sections = [];
const layout = () => {
  sections = [...document.querySelectorAll("[data-universe]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, w: worlds[el.dataset.universe], top: r.top + scrollY, h: r.height };
  }).filter((s) => s.w && s.h);
};

const resize = () => {
  W = innerWidth;
  H = innerHeight;
  pr = Math.min(devicePixelRatio || 1, small() ? 1.25 : 1.5);
  FOV = W / H < 0.8 ? 68 : 50;
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);
  composer.setPixelRatio(pr);
  composer.setSize(W, H);
  bloom.resolution.set(W, H);
  for (const w of [...Object.values(worlds), caseWorld]) {
    if (!w) continue;
    w.camera.fov = w === caseWorld ? 40 : FOV;
    w.camera.aspect = W / H;
    w.camera.updateProjectionMatrix();
  }
  pxUniform.value = (H * pr) / (2 * Math.tan((FOV * Math.PI) / 360));
  grade.uniforms.uRes.value.set(W * pr, H * pr);
  layout();
};

// ================================================================ hover: the creatures wake up
for (const el of document.querySelectorAll("[data-creature]")) {
  const w = worlds[CREATURE_WORLD[el.dataset.creature]];
  if (!w) continue;
  const on = () => { if (w.target) return; w.target = 1; w.def.wake?.(w); };
  const off = () => { w.target = 0; };
  el.addEventListener("pointerenter", on);
  el.addEventListener("pointerleave", off);
  el.addEventListener("focusin", on);
  el.addEventListener("focusout", off);
}

// ================================================================ the loop
const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener("pointermove", (e) => { mouse.x = e.clientX / W - 0.5; mouse.y = e.clientY / H - 0.5; }, { passive: true });
let last = 0, time = 0, raf = 0, drop = 0;

const aim = (w, p) => {
  const d = w.def, c = w.camera;
  // scrolling through a section walks a little further into its world
  c.position.set(d.cam[0] - mouse.sx * 0.35, d.cam[1] - mouse.sy * 0.15 + p * 0.25 + drop, d.cam[2] - p * 1.6);
  c.lookAt(d.look[0] + mouse.sx * 0.8, d.look[1] - mouse.sy * 0.4 - p * 0.5 + drop * 0.6, d.look[2]);
  c.updateMatrixWorld();
};
const step = (w, dt, t) => {
  w.t += dt;
  w.excite += (w.target - w.excite) * Math.min(1, dt * 3);
  w.mixer?.update(dt * (1 + w.excite * 0.6));
  w.def.tick?.(w, dt, t);
  w.sparks.update(dt);
};

const render = (now) => {
  raf = still ? 0 : requestAnimationFrame(render);
  const tt = now / 1000;
  const dt = still ? 0 : Math.min(0.05, last ? tt - last : 0.016);
  last = tt;
  time += dt;
  grade.uniforms.uTime.value = time;
  worldsPass.time = time;
  mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 2);
  mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 2);

  if (intro && !intro.done) {
    stepIntro(dt);
    worldsPass.a = caseWorld;
    worldsPass.b = null;
    worldsPass.k = 0;
    composer.render(dt);
    return;
  }

  // which world are we in, and are we crossing into the next one?
  const c = scrollY + H * 0.5, band = H * 0.3;
  let ia = 0, ib = -1, k = 0;
  for (let i = 0; i < sections.length; i++) if (c >= sections[i].top) ia = i;
  for (let j = 1; j < sections.length; j++) {
    const b = sections[j].top;
    if (Math.abs(c - b) < band) { ia = j - 1; ib = j; k = smooth(-band, band, c - b); break; }
  }
  const sa = sections[ia], sb = ib >= 0 ? sections[ib] : null;
  if (!sa) { composer.render(dt); return; }
  // a world fades in once its sky has come; the worlds around load ahead
  for (const w of Object.values(worlds)) if (w.loaded && w.ready < 1) w.ready = Math.min(1, w.ready + Math.max(dt, 0.016) * 1.2);
  for (let i = Math.max(0, ia - 1); i <= Math.min(sections.length - 1, ia + 2); i++) load(sections[i].w);
  const prog = (s) => clamp((c - (s.top + s.h / 2)) / Math.max(H, s.h), -0.7, 0.7);
  aim(sa.w, prog(sa));
  step(sa.w, dt, time);
  if (sb && sb.w !== sa.w) { aim(sb.w, prog(sb)); step(sb.w, dt, time); }
  stepPals(sa.w, dt);
  worldsPass.a = sa.w;
  worldsPass.b = sb && sb.w !== sa.w ? sb.w : null;
  worldsPass.k = k;
  if (drop > 0) drop = Math.max(0, drop - dt * (drop * 1.8 + 0.3));
  if (grade.uniforms.uFlash.value > 0) grade.uniforms.uFlash.value = Math.max(0, grade.uniforms.uFlash.value - dt * 1.1);
  if (grade.uniforms.uFade.value < 1) grade.uniforms.uFade.value = Math.min(1, grade.uniforms.uFade.value + dt * 1.5);
  composer.render(dt);
};

// ---- the intro, step by step
const IN = { rattle: [0.6, 1.5], lever: 1.15, claspL: 1.5, claspR: 1.68, open: [1.85, 2.9], dive: [2.7, 3.65], end: 3.65 };
const stepIntro = (dt) => {
  const c = intro;
  c.t += dt;
  const t = c.t;
  grade.uniforms.uFade.value = smooth(0, 0.7, t);
  // the camera looks at the case from the front, a little above, drifting closer
  const dv = easeIn((t - IN.dive[0]) / (IN.dive[1] - IN.dive[0]));
  const cp = new T.Vector3(0, 4.3, 9.6).lerp(new T.Vector3(0, 2.9, 0.4), dv);
  cp.x += Math.sin(t * 0.4) * 0.3 * (1 - dv);
  caseCam.position.copy(cp);
  caseCam.lookAt(0, lerp(0.7, 0, dv), lerp(0, -0.2, dv));
  // it rattles: something inside wants out
  const r = t > IN.rattle[0] && t < IN.rattle[1] ? Math.sin(((t - IN.rattle[0]) / (IN.rattle[1] - IN.rattle[0])) * Math.PI) : 0;
  c.g.rotation.z = Math.sin(t * 47) * 0.025 * r;
  c.g.rotation.x = Math.sin(t * 31) * 0.012 * r;
  c.g.position.y = Math.abs(Math.sin(t * 23)) * 0.06 * r;
  if (r > 0.2 && Math.random() < dt * 30) caseSparks.emit(new T.Vector3(rand(-2, 2), c.Hb + 0.02, c.D / 2 + 0.02), { dir: { x: 0, y: 1, z: 0.4 }, speed: 1.4, life: 0.8, size: 0.06, gravity: -1, color: Math.random() < 0.5 ? [0.8, 2.4, 3] : [2.6, 1.8, 0.8] });
  // the dial turns from Muggle-worthy
  c.lever.rotation.y = Math.PI * 0.85 - ease((t - IN.lever) / 0.35) * Math.PI * 0.7;
  // the clasps spring open
  c.clasps.forEach((cp2, i) => {
    const k = (t - (i ? IN.claspR : IN.claspL)) / 0.22;
    cp2.rotation.x = k <= 0 ? 0 : Math.min(1.05, k) * 2.0 + Math.sin(Math.min(1, k) * Math.PI) * 0.3;
    if (k > 0 && !cp2.userData.popped) { cp2.userData.popped = true; for (let j = 0; j < 30; j++) caseSparks.emit(cp2.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 0.3, 0.1)), { speed: 2.5, life: 0.7, size: 0.06, gravity: -2, color: [2.6, 1.9, 0.9] }); }
  });
  // the lid opens on a blinding light
  const o = ease((t - IN.open[0]) / (IN.open[1] - IN.open[0]));
  c.pivot.rotation.x = -o * 1.95 + Math.sin(o * Math.PI) * 0.08;
  const L = smooth(IN.open[0], IN.open[0] + 0.6, t);
  c.glow.material.uniforms.uL.value = L;
  c.glow.material.uniforms.uTime.value = t;
  c.ladder.visible = o > 0.3;
  c.inner.intensity = 22 * L;
  c.rays.scale.y = 0.001 + L;
  c.rayMat.uniforms.uA.value = L * 0.45 * (0.8 + 0.2 * Math.sin(t * 9));
  if (L > 0) for (let j = 0; j < 3; j++) caseSparks.emit(new T.Vector3(rand(-1.9, 1.9), c.Hb, rand(-1, 1)), { dir: { x: 0, y: 1, z: 0 }, spread: 0.25, speed: 6, life: 1.6, size: 0.09, gravity: 0.5, color: Math.random() < 0.5 ? [0.8, 2.4, 3] : [3, 2.2, 1] });
  grade.uniforms.uFlash.value = smooth(IN.dive[1] - 0.5, IN.dive[1], t);
  caseSparks.update(dt);
  if (t >= IN.end) endIntro();
};
const endIntro = () => {
  if (!intro || intro.done) return;
  intro.done = true;
  renderer.shadowMap.enabled = false;
  drop = 6; // we come down into the first world from the opening above
  grade.uniforms.uFlash.value = 1;
  grade.uniforms.uFade.value = 1;
  finishIntro();
  requestAnimationFrame(() => resize());
};

// ================================================================ start
resize();
new ResizeObserver(() => { clearTimeout(resize.t); resize.t = setTimeout(resize, 120); }).observe(document.body);
document.fonts?.ready.then(() => layout());
load(worlds.night);
if (root.classList.contains("intro") && !still) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  intro = buildCase();
  grade.uniforms.uFade.value = 0;
  document.querySelector(".intro-skip")?.addEventListener("click", () => { if (intro && !intro.done) intro.t = Math.max(intro.t, IN.dive[1] - 0.4); });
} else {
  grade.uniforms.uFade.value = still ? 1 : 0;
  finishIntro();
}
root.classList.add("gl-ready");
if (still) {
  time = 14;
  for (const w of Object.values(worlds)) { w.t = 14; w.ready = 1; }
  const once = () => { if (!raf) raf = requestAnimationFrame((n) => { raf = 0; render(n); }); };
  render(0);
  addEventListener("scroll", once, { passive: true });
  addEventListener("resize", once);
  // redraw as the skies and models arrive
  const poll = setInterval(once, 700);
  setTimeout(() => clearInterval(poll), 20000);
} else {
  raf = requestAnimationFrame(render);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) { last = 0; raf = requestAnimationFrame(render); }
  });
}
