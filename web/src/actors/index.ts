import * as THREE from 'three';
import type { RenderContext } from '../ctx';
import type { AppState } from '../state';
import type { Layout, SimEvent, ThemePalette } from '../types';
import { CAR, PED, type SimBridge } from '../wasm/sim';

export interface ActorsHandle {
  root: THREE.Group;
  rebuild(layout: Layout): void;
  setTheme(theme: ThemePalette): void;
  update(dt: number, state: AppState, sim: SimBridge): void;
  dispose(): void;
}

const CAR_STRIDE = 8;
const PED_STRIDE = 7;
const KIND_COUNT = 4;
const CAR_SPECS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [.94, .42, 1.76, .62, .42, .78], [1.0, .48, 1.82, .7, .46, .83],
  [1.12, .64, 2.12, .76, .55, .95], [1.35, .72, 2.7, .88, .62, 1.22],
];
const WHEEL_POS: ReadonlyArray<readonly [number, number]> = [[-.68, -1.15], [-.68, 1.15], [.68, -1.15], [.68, 1.15]];
// Temporary development-only preview for the bootstrap WASM, which has no actors yet.
// Remove when the Rust simulation supplies populated car/ped buffers.
const EMPTY_SIM_PREVIEW = import.meta.env.DEV;
const PREVIEW_CARS = new Float32Array([
  2.5, 0.1, -38, 0, .72, 0, 0, 0,  7.5, 0.1, -12, 0, .34, 1, 1, 1,
  -2.5, 0.1, 28, Math.PI, .88, 0, 2, 2,  -6, 0.1, 9, -Math.PI / 2, .55, 0, 3, 3,
]);
const PREVIEW_PEDS = new Float32Array([
  12.8, .22, -23, 0, .2, 1, 0, -12.8, .22, -9, Math.PI, .7, 0, 1,
  12.8, .22, 18, 0, .45, 1, 2, -12.8, .22, 32, Math.PI, .9, 0, 0,
]);

interface CarMeshes { body: THREE.InstancedMesh; cabin: THREE.InstancedMesh; wheels: THREE.InstancedMesh; }

function inWater(layout: Layout, x: number, z: number): boolean {
  const w = layout.water;
  return x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1;
}

function hash(n: number): number {
  return ((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

/** Dynamic, exclusively-instanced street life. */
export function createActors(ctx: RenderContext): ActorsHandle {
  const root = new THREE.Group();
  root.name = 'actors';
  let layout = ctx.layout;
  let palette = ctx.theme;
  let carCapacity = 0;
  let pedCapacity = 0;
  let cars: CarMeshes[] = [];
  let carLights: THREE.InstancedMesh | null = null;
  let trails: THREE.InstancedMesh | null = null;
  let pedBodies: THREE.InstancedMesh | null = null;
  let pedHeads: THREE.InstancedMesh | null = null;
  let umbrellas: THREE.InstancedMesh | null = null;
  let previous = new Float32Array(0);
  let trailLife = new Float32Array(0);

  const bodyMaterials: THREE.MeshStandardMaterial[] = [];
  const carColor = new THREE.Color();
  const trimColor = new THREE.Color();
  const warm = new THREE.Color();
  const red = new THREE.Color();
  const umbrellaColor = new THREE.Color();
  const silhouetteColor = new THREE.Color();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();

  const emissiveMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: .94,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true, side: THREE.DoubleSide,
  });
  const trailMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: .72,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: true, side: THREE.DoubleSide,
  });
  const pedMaterial = new THREE.MeshStandardMaterial({ color: 0x11131b, roughness: .86, metalness: .12 });
  const umbrellaMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .42, metalness: .2, emissive: 0x111111, emissiveIntensity: .45 });

  const ufo = makeUfo();
  const cat = makeCat();
  const shootingStar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    color: palette.accent2, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  }));
  shootingStar.visible = false;
  root.add(ufo, cat, shootingStar);

  /** instanceColor exists only after the first setColorAt call. */
  function touchColor(mesh: THREE.InstancedMesh): void {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function compose(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
    position.set(x, y, z); rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw); scale.set(sx, sy, sz);
    return matrix.compose(position, rotation, scale);
  }

  function addCarMesh(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    root.add(mesh);
    return mesh;
  }

  function allocate(nextCars: number, nextPeds: number): void {
    if (nextCars !== carCapacity) {
      cars.forEach((set) => { root.remove(set.body, set.cabin, set.wheels); disposeObject(set.body); disposeObject(set.cabin); disposeObject(set.wheels); });
      if (carLights) { root.remove(carLights); disposeObject(carLights); }
      if (trails) { root.remove(trails); disposeObject(trails); }
      cars = []; bodyMaterials.length = 0;
      carCapacity = nextCars;
      previous = new Float32Array(nextCars * 3);
      trailLife = new Float32Array(nextCars);
      const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
      const cabinGeo = new THREE.BoxGeometry(1, 1, 1);
      const wheelGeo = new THREE.BoxGeometry(1, 1, 1);
      for (let kind = 0; kind < KIND_COUNT; kind += 1) {
        const body = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .34, metalness: .62 });
        bodyMaterials.push(body);
        cars.push({ body: addCarMesh(bodyGeo, body, nextCars), cabin: addCarMesh(cabinGeo, new THREE.MeshStandardMaterial({ color: 0x111725, roughness: .2, metalness: .75 }), nextCars), wheels: addCarMesh(wheelGeo, new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: .9 }), nextCars * 4) });
      }
      carLights = addCarMesh(new THREE.PlaneGeometry(1, 1), emissiveMaterial, nextCars * 4);
      trails = addCarMesh(new THREE.PlaneGeometry(1, 1), trailMaterial, nextCars);
    }
    if (nextPeds !== pedCapacity) {
      for (const mesh of [pedBodies, pedHeads, umbrellas]) if (mesh) { root.remove(mesh); disposeObject(mesh); }
      pedCapacity = nextPeds;
      pedBodies = addCarMesh(new THREE.CapsuleGeometry(.32, .82, 3, 6), pedMaterial, nextPeds);
      pedHeads = addCarMesh(new THREE.IcosahedronGeometry(.24, 1), pedMaterial, nextPeds);
      umbrellas = addCarMesh(new THREE.ConeGeometry(.68, .28, 8, 1, true), umbrellaMaterial, nextPeds);
    }
    setTheme(palette);
  }

  function setTheme(next: ThemePalette): void {
    palette = next;
    warm.set('#fff1cd'); red.set('#ff2548'); trimColor.set(palette.buildingTrim); umbrellaColor.set(palette.neon[2]);
    silhouetteColor.set(palette.buildingBase).lerp(new THREE.Color(palette.accent2), .12);
    pedMaterial.color.copy(silhouetteColor); pedMaterial.emissive.copy(new THREE.Color(palette.accent)).multiplyScalar(.12);
    umbrellaMaterial.emissive.copy(umbrellaColor).multiplyScalar(.18);
    (shootingStar.material as THREE.MeshBasicMaterial).color.set(palette.accent2);
    bodyMaterials.forEach((material) => material.emissive.set(palette.accent).multiplyScalar(.035));
  }

  function updateCars(data: Float32Array, dt: number): void {
    if (!carLights || !trails) return;
    // Keep matrices densely packed per vehicle kind.
    const lightCount = data.length / CAR_STRIDE;
    for (let kind = 0; kind < KIND_COUNT; kind += 1) {
      const set = cars[kind]; let used = 0; let wheelUsed = 0;
      for (let i = 0; i < lightCount; i += 1) {
        const o = i * CAR_STRIDE;
        if (Math.max(0, Math.min(KIND_COUNT - 1, data[o + CAR.kind] | 0)) !== kind) continue;
        const x = data[o + CAR.x]; const y = data[o + CAR.y]; const z = data[o + CAR.z];
        if (inWater(layout, x, z)) continue;
        const yaw = data[o + CAR.rotY]; const type = CAR_SPECS[kind];
        set.body.setMatrixAt(used, compose(x, y + type[1] * .5, z, yaw, type[0], type[1], type[2]));
        set.cabin.setMatrixAt(used, compose(x, y + type[1] + type[4] * .36, z - .08, yaw, type[3], type[4], type[5]));
        carColor.set(palette.neon[(i + kind) % 4]).lerp(trimColor, .26);
        set.body.setColorAt(used, carColor);
        const cy = Math.cos(yaw); const sy = Math.sin(yaw);
        for (const wheel of WHEEL_POS) set.wheels.setMatrixAt(wheelUsed++, compose(x + cy * wheel[0] + sy * wheel[1], y + .16, z - sy * wheel[0] + cy * wheel[1], yaw, .2, .28, .38));
        used += 1;
      }
      set.body.count = used; set.cabin.count = used; set.wheels.count = wheelUsed;
      set.body.instanceMatrix.needsUpdate = true; touchColor(set.body); set.cabin.instanceMatrix.needsUpdate = true; set.wheels.instanceMatrix.needsUpdate = true;
    }
    let lightsUsed = 0; let trailsUsed = 0;
    for (let i = 0; i < lightCount; i += 1) {
      const o = i * CAR_STRIDE; const x = data[o + CAR.x]; const y = data[o + CAR.y]; const z = data[o + CAR.z];
      if (inWater(layout, x, z)) { trailLife[i] = 0; continue; }
      const yaw = data[o + CAR.rotY]; const speed = Math.max(0, Math.min(1, data[o + CAR.speedNorm])); const braking = data[o + CAR.brake] > .5;
      const fx = Math.sin(yaw); const fz = Math.cos(yaw); const rx = Math.cos(yaw); const rz = -Math.sin(yaw);
      for (const front of [true, false]) {
        const dir = front ? 1 : -1; const color = front ? warm : red; const intensity = front ? .8 + speed * .4 : braking ? 2.3 : .75;
        for (const side of [-1, 1]) {
          carLights.setMatrixAt(lightsUsed, compose(x + fx * dir * 1.8 + rx * side * .58, y + .45, z + fz * dir * 1.8 + rz * side * .58, yaw, .22 * intensity, .13 * intensity, 1));
          carLights.setColorAt(lightsUsed++, color);
        }
      }
      const px = previous[i * 3]; const pz = previous[i * 3 + 2];
      const moved = Math.hypot(x - px, z - pz);
      trailLife[i] = Math.max(0, trailLife[i] - dt * (statePaused ? .35 : 1.9));
      if (speed > .42 && moved > .002) trailLife[i] = Math.min(1, trailLife[i] + dt * (braking ? 4 : 1.5));
      if (trailLife[i] > .02) {
        const len = (1.5 + speed * 7 + (braking ? 5 : 0)) * trailLife[i];
        trails.setMatrixAt(trailsUsed, compose(x - fx * (2 + len * .5), y + .38, z - fz * (2 + len * .5), yaw, .36, .1 * trailLife[i], len));
        trails.setColorAt(trailsUsed++, red);
      }
      previous[i * 3] = x; previous[i * 3 + 1] = y; previous[i * 3 + 2] = z;
    }
    carLights.count = lightsUsed; carLights.instanceMatrix.needsUpdate = true; touchColor(carLights);
    trails.count = trailsUsed; trails.instanceMatrix.needsUpdate = true; touchColor(trails);
  }

  let statePaused = false;
  function updatePeds(data: Float32Array): void {
    if (!pedBodies || !pedHeads || !umbrellas) return;
    let used = 0; let umbrellaUsed = 0;
    for (let i = 0; i < data.length / PED_STRIDE; i += 1) {
      const o = i * PED_STRIDE; const x = data[o + PED.x]; const y = data[o + PED.y]; const z = data[o + PED.z];
      if (inWater(layout, x, z)) continue;
      const phase = data[o + PED.walkPhase] * Math.PI * 2; const width = .82 + hash(i) * .22; const height = .9 + hash(i + 41) * .2;
      const bob = Math.sin(phase) * .045; const yaw = data[o + PED.rotY] + Math.sin(phase) * .045;
      pedBodies.setMatrixAt(used, compose(x, y + .64 * height + bob, z, yaw, width, height, width));
      pedHeads.setMatrixAt(used, compose(x, y + 1.4 * height + bob, z, yaw, width, height, width));
      if (data[o + PED.umbrella] > .5) {
        umbrellas.setMatrixAt(umbrellaUsed, compose(x, y + 1.83 * height, z, yaw, width, height, width));
        umbrellas.setColorAt(umbrellaUsed++, umbrellaColor);
      }
      used += 1;
    }
    pedBodies.count = used; pedHeads.count = used; umbrellas.count = umbrellaUsed;
    pedBodies.instanceMatrix.needsUpdate = true; pedHeads.instanceMatrix.needsUpdate = true; umbrellas.instanceMatrix.needsUpdate = true; if (umbrellaUsed) touchColor(umbrellas);
  }

  function updateEvents(events: SimEvent[]): void {
    let ufoEvent: SimEvent | undefined; let catEvent: SimEvent | undefined; let starEvent: SimEvent | undefined;
    for (const event of events) { if (event.kind === 'ufo') ufoEvent = event; else if (event.kind === 'cat') catEvent = event; else if (event.kind === 'shootingStar') starEvent = event; }
    ufo.visible = !!ufoEvent; cat.visible = !!catEvent; shootingStar.visible = !!starEvent;
    if (ufoEvent) { ufo.position.set(ufoEvent.x, Math.max(33, ufoEvent.y), ufoEvent.z); ufo.rotation.y += .045; ufo.children[1].rotation.y -= .13; }
    if (catEvent) { cat.position.set(catEvent.x, .14, catEvent.z); cat.rotation.y = Math.atan2(catEvent.dx, catEvent.dz); animateCat(cat, catEvent.p); }
    if (starEvent) { shootingStar.position.set(starEvent.x, starEvent.y, starEvent.z); shootingStar.rotation.z = -Math.atan2(starEvent.dz, starEvent.dx); shootingStar.scale.set(9, .1, 1); }
  }

  function rebuild(nextLayout: Layout): void {
    layout = nextLayout;
    const carCount = ctx.sim.cars.length / CAR_STRIDE || (EMPTY_SIM_PREVIEW ? PREVIEW_CARS.length / CAR_STRIDE : 0);
    const pedCount = ctx.sim.peds.length / PED_STRIDE || (EMPTY_SIM_PREVIEW ? PREVIEW_PEDS.length / PED_STRIDE : 0);
    allocate(carCount, pedCount);
  }

  rebuild(layout);
  return {
    root,
    rebuild,
    setTheme,
    update(dt, state, sim) {
      statePaused = state.paused;
      const carData = sim.cars.length ? sim.cars : (EMPTY_SIM_PREVIEW ? PREVIEW_CARS : sim.cars);
      const pedData = sim.peds.length ? sim.peds : (EMPTY_SIM_PREVIEW ? PREVIEW_PEDS : sim.peds);
      const carCount = carData.length / CAR_STRIDE; const pedCount = pedData.length / PED_STRIDE;
      if (carCount !== carCapacity || pedCount !== pedCapacity) allocate(carCount, pedCount);
      updateCars(carData, Math.min(.05, Math.max(0, dt)));
      updatePeds(pedData);
      updateEvents(sim.events().events);
    },
    dispose() { disposeObject(root); root.removeFromParent(); },
  };
}

function makeUfo(): THREE.Group {
  const group = new THREE.Group(); group.visible = false;
  const metal = new THREE.MeshStandardMaterial({ color: 0x8c9cab, metalness: .9, roughness: .2 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x70f8ff, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false });
  const saucer = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 6), metal); saucer.scale.y = .26;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(.85, 10, 6), glow); dome.scale.y = .45; dome.position.y = .28;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, .08, 5, 20), glow); ring.rotation.x = Math.PI / 2;
  const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 20, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x86f7ff, transparent: true, opacity: .055, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); beam.position.y = -10; beam.rotation.x = Math.PI;
  group.add(saucer, ring, dome, beam); return group;
}

function makeCat(): THREE.Group {
  const group = new THREE.Group(); group.visible = false;
  const material = new THREE.MeshStandardMaterial({ color: 0x17131d, roughness: .75, emissive: 0x160812, emissiveIntensity: .35 });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(.28, 1), material); body.scale.set(1.6, .75, 2.2); body.position.y = .25;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(.18, 1), material); head.position.set(0, .35, .48);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(.035, .05, .55, 5), material); tail.position.set(0, .42, -.47); tail.rotation.x = -.8;
  group.add(body, head, tail); for (let i = 0; i < 4; i += 1) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.07, .25, .07), material); leg.position.set(i % 2 ? .18 : -.18, .1, i < 2 ? .25 : -.25); group.add(leg); } return group;
}

function animateCat(cat: THREE.Group, p: number): void {
  const phase = p * Math.PI * 18;
  for (let i = 3; i < cat.children.length; i += 1) cat.children[i].rotation.x = Math.sin(phase + i * Math.PI) * .65;
  cat.children[2].rotation.z = .35 + Math.sin(phase) * .18;
}
