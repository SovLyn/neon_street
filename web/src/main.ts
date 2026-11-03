import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './styles.css';
import { createStore, type AppState } from './state';
import { getTheme } from './theme/palettes';
import { readUrlState, writeUrlState } from './url';
import type { BaseContext, RenderContext } from './ctx';
import { loadSim, type SimBridge } from './wasm/sim';
import { createScene, type SceneHandle } from './scene';
import { createActors, type ActorsHandle } from './actors';
import { createFx, REFLECTION_EXCLUDE_LAYER, type FxHandle } from './fx';
import { mountUI, type UiHandle } from './ui';
import type { Layout, ThemePalette } from './types';

interface NeonDebug {
  ready: boolean;
  frame: number;
  wasmBytes: number;
  layoutSeed: number;
  state(): AppState;
  set(patch: Partial<AppState>): void;
  sim(): {
    timeOfDay: number;
    cars: number;
    peds: number;
    signFlashSum: number;
    lampOn: number;
    waterSum: number;
    env: number[];
  };
  setSeed(seed: number): void;
  clickSign(i: number): void;
  clickLamp(i: number): void;
  clickWater(x: number, z: number): void;
  sample(): { calls: number; triangles: number; meanLuma: number; uniqueColors: number };
  shot(): string;
  pickAt(x: number, y: number): string | null;
  setCamera(px: number, py: number, pz: number, tx: number, ty: number, tz: number): void;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  signScreen(index: number): { x: number; y: number } | null;
}

declare global {
  interface Window {
    __neon?: NeonDebug;
  }
}

async function boot(): Promise<void> {
  const store = createStore(readUrlState());
  const initial = store.get();
  const theme = getTheme(initial.themeId);

  const sim = await loadSim(initial.seed);
  sim.setTimeOfDay(initial.timeOfDay);
  sim.setAutoCycle(initial.autoCycle);
  sim.setAutoCycleSpeed(initial.autoCycleSpeed);
  sim.setRain(initial.rain);
  sim.setSnow(initial.snow);
  sim.setFog(initial.fog);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = theme.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;
  // Aggregate render stats across the reflection pass, scene and composer.
  renderer.info.autoReset = false;
  document.getElementById('app')?.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 800);
  // Layer 1 holds reflective surfaces the planar-reflection pass must not see.
  camera.layers.enable(REFLECTION_EXCLUDE_LAYER);
  camera.position.set(48, 26, 62);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 10;
  controls.maxDistance = 190;
  controls.maxTargetRadius = 60;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.8;
  controls.screenSpacePanning = false;

  const base: BaseContext = {
    renderer,
    scene,
    camera,
    sim,
    store,
    layout: sim.layout(),
    theme,
  };
  const fx: FxHandle = createFx(base);
  const ctx: RenderContext = { ...base, reflection: fx.reflection };

  const sceneHandle: SceneHandle = createScene(ctx);
  const actors: ActorsHandle = createActors(ctx);
  scene.add(sceneHandle.root);
  scene.add(actors.root);

  const cameraHome = {
    position: sceneHandle.cameraHome.position.clone(),
    target: sceneHandle.cameraHome.target.clone(),
  };
  const resetCamera = (): void => {
    camera.position.copy(cameraHome.position);
    controls.target.copy(cameraHome.target);
    controls.update();
  };
  resetCamera();

  let ui: UiHandle | null = null;
  let debugRef: NeonDebug | null = null;

  function applyLayout(layout: Layout): void {
    ctx.layout = layout;
    sceneHandle.rebuild(layout);
    actors.rebuild(layout);
    fx.rebuild(layout);
    cameraHome.position.copy(sceneHandle.cameraHome.position);
    cameraHome.target.copy(sceneHandle.cameraHome.target);
    resetCamera();
    ui?.refresh();
  }

  function applyTheme(palette: ThemePalette): void {
    ctx.theme = palette;
    renderer.toneMappingExposure = palette.exposure;
    document.documentElement.style.setProperty('--accent', palette.accent);
    document.documentElement.style.setProperty('--accent-2', palette.accent2);
    sceneHandle.setTheme(palette);
    actors.setTheme(palette);
    fx.setTheme(palette);
    ui?.refresh();
  }

  function reseed(seed: number): void {
    const next = seed >>> 0;
    sim.reseed(next);
    store.set({ seed: next });
    applyLayout(sim.layout());
    if (debugRef) debugRef.layoutSeed = sim.seed;
  }

  function capturePng(): string {
    return renderer.domElement.toDataURL('image/png');
  }

  function downloadPng(): void {
    const url = capturePng();
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    link.href = url;
    link.download = `neon-street-${store.get().seed}-${stamp}.png`;
    link.click();
  }

  /* ---------------------------------------------------------------- picking */

  const raycaster = new THREE.Raycaster();
  // Reflective surfaces live on a dedicated layer, so picking must see every layer.
  raycaster.layers.enableAll();
  const ndc = new THREE.Vector2();
  const pointerDown = { x: 0, y: 0, t: 0, moved: 0 };

  function pick(clientX: number, clientY: number): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const { signs, lamps, water } = sceneHandle.pickables;

    const signHit = raycaster.intersectObjects(signs, true)[0];
    if (signHit) {
      const id = findOwnerId(signHit.object, 'signId');
      if (id !== null) return `sign:${id}`;
    }
    const lampHit = raycaster.intersectObjects(lamps, true)[0];
    if (lampHit) {
      const id = findOwnerId(lampHit.object, 'lampId');
      if (id !== null) return `lamp:${id}`;
    }
    const waterHit = raycaster.intersectObjects(water, true)[0];
    if (waterHit) return `water:${waterHit.point.x.toFixed(2)}:${waterHit.point.z.toFixed(2)}`;

    return null;
  }

  function findOwnerId(object: THREE.Object3D, key: 'signId' | 'lampId'): number | null {
    let node: THREE.Object3D | null = object;
    while (node) {
      const value = node.userData?.[key];
      if (typeof value === 'number') return value;
      node = node.parent;
    }
    return null;
  }

  function activate(hit: string | null): void {
    if (!hit) return;
    const [kind, a, b] = hit.split(':');
    if (kind === 'sign') {
      const id = Number(a);
      sim.flashSign(id);
      ui?.toast('招牌短路 · 闪烁中');
      flashScreen();
    } else if (kind === 'lamp') {
      sim.toggleLamp(Number(a));
      ui?.toast('路灯开关');
    } else if (kind === 'water') {
      const x = Number(a);
      const z = Number(b);
      sim.addRipple(x, z, 1);
      ui?.toast('涟漪扩散');
    }
  }

  let flashTimer = 0;
  function flashScreen(): void {
    flashTimer = 0.18;
  }

  renderer.domElement.addEventListener('pointerdown', (event) => {
    pointerDown.x = event.clientX;
    pointerDown.y = event.clientY;
    pointerDown.t = performance.now();
    pointerDown.moved = 0;
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (event.buttons === 0) return;
    pointerDown.moved = Math.max(
      pointerDown.moved,
      Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y),
    );
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (pointerDown.moved > 6) return;
    if (performance.now() - pointerDown.t > 600) return;
    activate(pick(event.clientX, event.clientY));
  });

  /* ------------------------------------------------------------------ loop */

  document.documentElement.dataset.theme = initial.themeId;
  store.subscribe((state, prev) => {
    if (state.themeId !== prev.themeId) {
      document.documentElement.dataset.theme = state.themeId;
      applyTheme(getTheme(state.themeId));
    }
    if (state.seed !== prev.seed && state.seed >>> 0 !== sim.seed) {
      reseed(state.seed);
    }
    if (state.photoMode !== prev.photoMode) {
      document.body.classList.toggle('photo-mode', state.photoMode);
    }
    scheduleUrlSync(state);
  });

  let frame = 0;
  let lastTime = performance.now();

  function step(dt: number): void {
    const state = store.get();
    renderer.info.reset();

    sim.setAutoCycle(state.autoCycle);
    sim.setAutoCycleSpeed(state.autoCycleSpeed);
    if (!state.autoCycle) sim.setTimeOfDay(state.timeOfDay);
    sim.setRain(state.rain);
    sim.setSnow(state.snow);
    sim.setFog(state.fog);

    if (!state.paused) sim.advance(dt);
    if (state.autoCycle && !state.paused) {
      const hours = sim.timeOfDay;
      if (Math.abs(hours - state.timeOfDay) > 0.002) store.set({ timeOfDay: hours });
    }

    sceneHandle.update(dt, state, sim);
    actors.update(dt, state, sim);
    fx.update(dt, state, sim);
    fx.render(dt);

    if (flashTimer > 0) {
      flashTimer = Math.max(0, flashTimer - dt);
      renderer.domElement.style.filter = `brightness(${1 + flashTimer * 1.4})`;
    } else if (renderer.domElement.style.filter) {
      renderer.domElement.style.filter = '';
    }

    controls.autoRotate = state.photoMode === false && state.paused === false && idle > 6;
    controls.autoRotateSpeed = 0.16;
    controls.update();
    frame += 1;
    debug.frame = frame;
  }

  function tick(now: number): void {
    requestAnimationFrame(tick);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    step(dt);
  }

  /* -------------------------------------------------------------- idle orbit */

  let idle = 0;
  const bumpIdle = (): void => {
    idle = 0;
  };
  for (const type of ['pointerdown', 'wheel', 'keydown'] as const) {
    window.addEventListener(type, bumpIdle, { passive: true });
  }
  setInterval(() => {
    idle += 1;
  }, 1000);

  /* ------------------------------------------------------------ ui + debug */

  ui = mountUI({
    store,
    sim,
    onReseed: reseed,
    onShare: () => {
      const url = writeUrlState(store.get());
      void navigator.clipboard?.writeText(url).catch(() => undefined);
      return url;
    },
    onCapture: async () => {
      downloadPng();
    },
    onCameraReset: resetCamera,
    onEvent: () => {
      sim.triggerEvent();
      ui?.toast('信号异常…');
    },
  });

  let urlTimer: number | null = null;
  function scheduleUrlSync(state: AppState): void {
    if (urlTimer !== null) window.clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      urlTimer = null;
      try {
        window.history.replaceState(null, '', writeUrlState(state));
      } catch {
        /* ignore: sandboxed contexts disallow history writes */
      }
    }, 400);
  }

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 64;
  sampleCanvas.height = 64;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  const debug: NeonDebug = {
    ready: false,
    frame: 0,
    wasmBytes: sim.wasmBytes,
    layoutSeed: sim.layout().seed,
    state: () => store.get(),
    set: (patch) => store.set(patch),
    sim: () => {
      const signs = sim.signs;
      let signFlashSum = 0;
      for (let i = 0; i < signs.length; i += 2) signFlashSum += signs[i];
      const lamps = sim.lamps;
      let lampOn = 0;
      for (let i = 0; i < lamps.length; i += 2) lampOn += lamps[i] > 0.5 ? 1 : 0;
      let waterSum = 0;
      for (const v of sim.water) waterSum += Math.abs(v);
      return {
        timeOfDay: sim.timeOfDay,
        cars: sim.cars.length / 8,
        peds: sim.peds.length / 7,
        signFlashSum,
        lampOn,
        waterSum,
        env: Array.from(sim.env),
      };
    },
    setSeed: (seed) => reseed(seed),
    clickSign: (i) => activate(`sign:${i}`),
    clickLamp: (i) => activate(`lamp:${i}`),
    clickWater: (x, z) => activate(`water:${x}:${z}`),
    sample: () => {
      const result = {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        meanLuma: 0,
        uniqueColors: 0,
      };
      if (!sampleCtx) return result;
      sampleCtx.drawImage(renderer.domElement, 0, 0, 64, 64);
      const { data } = sampleCtx.getImageData(0, 0, 64, 64);
      const seen = new Set<number>();
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        seen.add(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3));
      }
      result.meanLuma = sum / (data.length / 4);
      result.uniqueColors = seen.size;
      return result;
    },
    shot: () => capturePng(),
    pickAt: (x, y) => pick(x, y),
    scene,
    camera,
    signScreen: (index) => {
      const object = sceneHandle.pickables.signs[index];
      if (!object) return null;
      const point = object.getWorldPosition(new THREE.Vector3()).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: rect.left + (point.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-point.y * 0.5 + 0.5) * rect.height,
      };
    },
    setCamera: (px, py, pz, tx, ty, tz) => {
      camera.position.set(px, py, pz);
      controls.target.set(tx, ty, tz);
      cameraHome.position.set(px, py, pz);
      cameraHome.target.set(tx, ty, tz);
      controls.update();
    },
  };
  debugRef = debug;
  window.__neon = debug;

  /* ---------------------------------------------------------------- resize */

  const onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fx.resize(width, height, ratio);
  };
  window.addEventListener('resize', onResize);
  onResize();

  /* ----------------------------------------------------------------- start */

  requestAnimationFrame((now) => {
    lastTime = now;
    requestAnimationFrame(tick);
  });

  debug.ready = true;
  document.documentElement.dataset.ready = '1';
  document.getElementById('boot')?.classList.add('boot-done');
  setTimeout(() => document.getElementById('boot')?.remove(), 900);
}

function showBootError(error: unknown): void {
  const boot = document.getElementById('boot');
  const message = error instanceof Error ? `${error.message}` : String(error);
  if (boot) {
    boot.classList.remove('boot-done');
    boot.innerHTML = `<div class="boot-inner"><div class="boot-title">启动失败</div><div class="boot-sub">${escapeHtml(message)}</div><div class="boot-sub boot-hint">请检查 WebGL / wasm 支持后刷新</div></div>`;
  }
  console.error('[neon-street] boot failed', error);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;',
  );
}

boot().catch(showBootError);
