import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { AppState } from '../state';
import type { ThemePalette } from '../types';
import { screenFxShader } from './shaders';

/** Lightweight fixed pass stack: scene -> bloom -> optional screen treatment -> output. */
export class NeonComposer {
  readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly screenFx: ShaderPass;
  private readonly resolution: THREE.Vector2;
  private time = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, theme: ThemePalette) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), theme.bloom.strength, theme.bloom.radius, theme.bloom.threshold);
    this.composer.addPass(this.bloom);

    this.screenFx = new ShaderPass(screenFxShader);
    this.screenFx.enabled = true;
    this.resolution = this.screenFx.uniforms.resolution.value as THREE.Vector2;
    this.composer.addPass(this.screenFx);
    this.composer.addPass(new OutputPass());
    this.setTheme(theme);
  }

  update(dt: number, state: AppState): void {
    this.time += dt;
    this.bloom.enabled = state.bloom;
    this.screenFx.enabled = state.chromatic || state.grain;
    this.screenFx.uniforms.time.value = this.time;
    this.screenFx.uniforms.chromaticStrength.value = state.chromatic ? 1 : 0;
    this.screenFx.uniforms.grainAmount.value = state.grain ? 1 : 0;
  }

  setTheme(theme: ThemePalette): void {
    this.bloom.strength = theme.bloom.strength;
    this.bloom.radius = theme.bloom.radius;
    this.bloom.threshold = theme.bloom.threshold;
    (this.screenFx.uniforms.vignetteTint.value as THREE.Color).set(theme.fogColor);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    const ratio = Math.min(2, Math.max(0.5, pixelRatio));
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    this.resolution.set(Math.max(1, width * ratio), Math.max(1, height * ratio));
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
