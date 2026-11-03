import * as THREE from 'three';
import type { AppState } from '../state';
import type { ThemePalette } from '../types';
import { ENV, type SimBridge } from '../wasm/sim';
import { rainFragmentShader, rainVertexShader, snowFragmentShader, snowVertexShader } from './shaders';

const RAIN_DROPS = 2200;
const SNOW_FLAKES = 1200;
const SPLASHES = 64;

/** GPU-friendly precipitation driven directly from the two WASM packed buffers. */
export class Precipitation {
  readonly root = new THREE.Group();

  private readonly rainPositions = new Float32Array(RAIN_DROPS * 2 * 3);
  private readonly snowPositions = new Float32Array(SNOW_FLAKES * 3);
  private readonly snowSizes = new Float32Array(SNOW_FLAKES);
  private readonly rainGeometry = new THREE.BufferGeometry();
  private readonly snowGeometry = new THREE.BufferGeometry();
  private readonly rainMaterial: THREE.ShaderMaterial;
  private readonly snowMaterial: THREE.ShaderMaterial;
  private readonly rain: THREE.LineSegments;
  private readonly snow: THREE.Points;
  private readonly splashGeometry: THREE.RingGeometry;
  private readonly splashMaterial: THREE.MeshBasicMaterial;
  private readonly splashes: THREE.InstancedMesh;
  private readonly splashMatrix = new THREE.Matrix4();
  private readonly rainColor = new THREE.Color();
  private readonly snowColor = new THREE.Color();
  private splashPhase = 0;

  constructor() {
    this.root.name = 'fx-precipitation';

    const rainPosition = new THREE.BufferAttribute(this.rainPositions, 3);
    rainPosition.setUsage(THREE.DynamicDrawUsage);
    this.rainGeometry.setAttribute('position', rainPosition);
    this.rainGeometry.setDrawRange(0, 0);
    this.rainMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: this.rainColor },
        opacity: { value: 0 },
        fogNear: { value: 32 },
        fogFar: { value: 130 },
      },
      vertexShader: rainVertexShader,
      fragmentShader: rainFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.LineSegments(this.rainGeometry, this.rainMaterial);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.root.add(this.rain);

    const snowPosition = new THREE.BufferAttribute(this.snowPositions, 3);
    snowPosition.setUsage(THREE.DynamicDrawUsage);
    const snowSize = new THREE.BufferAttribute(this.snowSizes, 1);
    snowSize.setUsage(THREE.DynamicDrawUsage);
    this.snowGeometry.setAttribute('position', snowPosition);
    this.snowGeometry.setAttribute('aSize', snowSize);
    this.snowGeometry.setDrawRange(0, 0);
    const sprite = createSnowSprite();
    this.snowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: sprite },
        color: { value: this.snowColor },
        opacity: { value: 0 },
        fogNear: { value: 32 },
        fogFar: { value: 130 },
      },
      vertexShader: snowVertexShader,
      fragmentShader: snowFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.snow = new THREE.Points(this.snowGeometry, this.snowMaterial);
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.root.add(this.snow);

    this.splashGeometry = new THREE.RingGeometry(0.78, 1, 16);
    this.splashGeometry.rotateX(-Math.PI / 2);
    this.splashMaterial = new THREE.MeshBasicMaterial({
      color: this.rainColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.splashes = new THREE.InstancedMesh(this.splashGeometry, this.splashMaterial, SPLASHES);
    this.splashes.name = 'rain-splashes';
    this.splashes.count = 0;
    this.splashes.frustumCulled = false;
    this.root.add(this.splashes);
  }

  update(dt: number, state: AppState, sim: SimBridge, camera: THREE.Camera): void {
    this.splashPhase += dt;
    const env = sim.env;
    const wetness = clamp01(env[ENV.wetness] ?? 0);
    const precipFog = clamp01(env[ENV.precipFog] ?? state.fog);
    const fogFar = Math.max(42, 190 - state.fog * 90 - precipFog * 45);
    const fogNear = fogFar * 0.32;
    this.setFog(fogNear, fogFar);

    const rainStrength = clamp01(state.rain);
    const rainData = sim.rainSegments;
    const rainVertices = copyRain(rainData, this.rainPositions);
    const rainOpacity = rainStrength * (0.2 + wetness * 0.8) * 0.52;
    this.rainGeometry.setDrawRange(0, rainVertices);
    (this.rainGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.rainMaterial.uniforms.opacity.value = rainOpacity;
    this.rain.visible = rainStrength > 0.002 && rainVertices > 0;

    const snowStrength = clamp01(state.snow);
    const snowCount = copySnow(sim.snowFlakes, this.snowPositions, this.snowSizes);
    this.snowGeometry.setDrawRange(0, snowCount);
    (this.snowGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.snowGeometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    this.snowMaterial.uniforms.opacity.value = snowStrength * 0.82;
    this.snow.visible = snowStrength > 0.002 && snowCount > 0;

    this.updateSplashes(rainStrength, wetness, camera);
  }

  setTheme(theme: ThemePalette): void {
    this.rainColor.set(theme.accent2).lerp(new THREE.Color(theme.windowCool), 0.35);
    this.snowColor.set(theme.neon[3]).lerp(new THREE.Color('#ffffff'), 0.65);
  }

  dispose(): void {
    this.rainGeometry.dispose();
    this.rainMaterial.dispose();
    this.snowGeometry.dispose();
    this.snowMaterial.uniforms.map.value.dispose();
    this.snowMaterial.dispose();
    this.splashGeometry.dispose();
    this.splashMaterial.dispose();
  }

  private setFog(near: number, far: number): void {
    this.rainMaterial.uniforms.fogNear.value = near;
    this.rainMaterial.uniforms.fogFar.value = far;
    this.snowMaterial.uniforms.fogNear.value = near;
    this.snowMaterial.uniforms.fogFar.value = far;
  }

  private updateSplashes(rainStrength: number, wetness: number, camera: THREE.Camera): void {
    const active = rainStrength > 0.55 && wetness > 0.2;
    const count = active ? Math.min(SPLASHES, Math.ceil(SPLASHES * rainStrength * wetness)) : 0;
    this.splashes.count = count;
    this.splashes.visible = count > 0;
    this.splashMaterial.opacity = active ? (rainStrength - 0.45) * wetness * 0.22 : 0;
    if (count === 0) return;

    const cameraX = camera.position.x;
    const cameraZ = camera.position.z;
    for (let i = 0; i < count; i += 1) {
      const phase = fract(this.splashPhase * 1.45 + i * 0.61803398875);
      const angle = i * 2.39996322973;
      const radius = 2.5 + (i % 9) * 1.65;
      const scale = 0.12 + phase * 0.65;
      this.splashMatrix.makeScale(scale, scale, scale);
      this.splashMatrix.setPosition(cameraX + Math.cos(angle) * radius, 0.025, cameraZ + Math.sin(angle) * radius);
      this.splashes.setMatrixAt(i, this.splashMatrix);
    }
    this.splashes.instanceMatrix.needsUpdate = true;
  }
}

function copyRain(source: Float32Array, target: Float32Array): number {
  const count = Math.min(RAIN_DROPS, Math.floor(source.length / 6));
  let nonZero = false;
  for (let i = 0; i < count; i += 1) {
    const sourceOffset = i * 6;
    const targetOffset = sourceOffset;
    for (let j = 0; j < 6; j += 1) {
      const value = source[sourceOffset + j];
      target[targetOffset + j] = value;
      nonZero ||= value !== 0;
    }
  }
  return nonZero ? count * 2 : 0;
}

function copySnow(source: Float32Array, positions: Float32Array, sizes: Float32Array): number {
  const count = Math.min(SNOW_FLAKES, Math.floor(source.length / 4));
  let nonZero = false;
  for (let i = 0; i < count; i += 1) {
    const sourceOffset = i * 4;
    const positionOffset = i * 3;
    positions[positionOffset] = source[sourceOffset];
    positions[positionOffset + 1] = source[sourceOffset + 1];
    positions[positionOffset + 2] = source[sourceOffset + 2];
    sizes[i] = source[sourceOffset + 3];
    nonZero ||= positions[positionOffset] !== 0 || positions[positionOffset + 1] !== 0 || positions[positionOffset + 2] !== 0;
  }
  return nonZero ? count : 0;
}

function createSnowSprite(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function fract(value: number): number {
  return value - Math.floor(value);
}
