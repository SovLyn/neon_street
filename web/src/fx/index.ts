import type { BaseContext, ReflectionController } from '../ctx';
import type { AppState } from '../state';
import type { Layout, ThemePalette } from '../types';
import type { SimBridge } from '../wasm/sim';
import { NeonComposer } from './composer';
import { Precipitation } from './precipitation';
import { PlanarReflection } from './reflection';

export interface FxHandle {
  reflection: ReflectionController;
  rebuild(layout: Layout): void;
  setTheme(theme: ThemePalette): void;
  update(dt: number, state: AppState, sim: SimBridge): void;
  render(dt: number): void;
  resize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}

/**
 * Owns every post-process render call. Scene and actor modules only contribute
 * objects; this module performs one optional mirror scene render followed by
 * one composer render per animation frame.
 */
export function createFx(ctx: BaseContext): FxHandle {
  const reflection = new PlanarReflection(ctx.renderer, ctx.scene, ctx.camera);
  const composer = new NeonComposer(ctx.renderer, ctx.scene, ctx.camera, ctx.theme);
  const precipitation = new Precipitation();
  precipitation.setTheme(ctx.theme);
  ctx.scene.add(precipitation.root);

  let currentState: AppState = ctx.store.get();
  let disposed = false;

  return {
    reflection,
    rebuild(_layout: Layout): void {
      // Precipitation geometry has fixed WASM contract capacities; no layout-owned resources.
    },
    setTheme(theme: ThemePalette): void {
      composer.setTheme(theme);
      precipitation.setTheme(theme);
    },
    update(dt: number, state: AppState, sim: SimBridge): void {
      if (disposed) return;
      currentState = state;
      composer.update(dt, state);
      precipitation.update(dt, state, sim, ctx.camera);
    },
    render(dt: number): void {
      if (disposed) return;
      reflection.setEnabled(currentState.reflections);
      reflection.render();
      composer.render(dt);
    },
    resize(width: number, height: number, pixelRatio: number): void {
      if (disposed) return;
      reflection.resize(width, height);
      composer.resize(width, height, pixelRatio);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ctx.scene.remove(precipitation.root);
      precipitation.dispose();
      composer.dispose();
      reflection.dispose();
    },
  };
}

export { REFLECTION_EXCLUDE_LAYER } from './reflection';
