// three.js for the vivarium's tests (vivarium-page.cjs points vivarium.js's import here): the real
// vendored three.js for the scenes, cameras and maths, with the GPU and the network left out. The
// renderer records what it draws; loaders answer at once with small stand-ins, or fail on demand.
import * as T from "../site/vendor/three-r186.min.js";

export * from "../site/vendor/three-r186.min.js";

// what the test sees and steers: the renderer, the files asked for, the ones that fail
export const hub = (globalThis.__three = { renderer: null, asked: [], fail: [], webgl2: true, ...globalThis.__three });

const fails = (url) => hub.fail.some((part) => url.includes(part));
const answer = (url, make) => {
  hub.asked.push(url);
  return fails(url) ? Promise.reject(new Error("404 " + url)) : Promise.resolve(make());
};

export class WebGLRenderer {
  constructor(options) {
    this.options = options;
    this.capabilities = { isWebGL2: hub.webgl2 };
    this.shadowMap = { enabled: false, type: null };
    this.drawn = []; // [scene, camera, target] of every render
    this.pixelRatio = 1;
    this.size = [1, 1];
    hub.renderer = this;
  }
  setPixelRatio(p) { this.pixelRatio = p; }
  setSize(w, h) { this.size = [w, h]; }
  setRenderTarget(target) { this.target = target; }
  clear() {}
  render(scene, camera) { this.drawn.push([scene, camera, this.target]); }
}

// The passes are real; rendering runs the first one (the worlds and their crossing), whose
// output the others only treat
export class EffectComposer {
  constructor(renderer) { this.renderer = renderer; this.passes = []; this.frames = 0; }
  addPass(pass) { this.passes.push(pass); }
  setPixelRatio(p) { this.pixelRatio = p; }
  setSize(w, h) { this.passes[0].setSize(w, h); }
  render() { this.frames++; this.passes[0].render(this.renderer, null); }
}

export class PMREMGenerator {
  fromEquirectangular(tex) { return { texture: Object.assign(new T.Texture(), { name: "env " + tex.name }) }; }
  fromScene() { return { texture: Object.assign(new T.Texture(), { name: "room" }) }; }
}

export class TextureLoader {
  loadAsync(url) { return answer(url, () => Object.assign(new T.Texture(), { name: url })); }
}

// a creature: a box, and the clips its model would have
const CLIPS = { phoenix: ["Fly"], niffler: ["Sniff", "Idle"], hippogriff: ["Idle_01", "Taunt"], bowtruckle: [] };
export class GLTFLoader {
  setMeshoptDecoder() { return this; }
  loadAsync(url) {
    return answer(url, () => {
      const scene = new T.Group();
      scene.add(new T.Mesh(new T.BoxGeometry(1, 0.6, 2), new T.MeshStandardMaterial({ color: 0x888888 })));
      scene.add(new T.Group());
      const kind = Object.keys(CLIPS).find((k) => url.includes(k));
      return { scene, animations: (CLIPS[kind] || []).map((name) => new T.AnimationClip(name, 1, [])) };
    });
  }
}
