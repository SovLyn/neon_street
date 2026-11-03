import * as THREE from 'three';
import type { Layout, ThemePalette } from './types';
import type { SimBridge } from './wasm/sim';
import type { Store } from './state';

/** Planar reflection controller produced by the FX module (see docs/CONTRACT.md §6.3). */
export interface ReflectionController {
  texture: THREE.Texture;
  textureMatrix: THREE.Matrix4;
  render(): void;
  resize(width: number, height: number): void;
  setEnabled(on: boolean): void;
  dispose(): void;
}

/** Everything a rendering module may rely on. `reflection` is injected by FX. */
export interface RenderContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sim: SimBridge;
  store: Store;
  layout: Layout;
  theme: ThemePalette;
  reflection: ReflectionController;
}

export type BaseContext = Omit<RenderContext, 'reflection'>;
