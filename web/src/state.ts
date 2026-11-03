import type { ThemeId } from './types';

/** Global application state. Single source of truth shared by UI, scene and FX. */
export interface AppState {
  seed: number;
  /** hours, 0..24 */
  timeOfDay: number;
  autoCycle: boolean;
  /** hours per real second */
  autoCycleSpeed: number;
  rain: number;
  snow: number;
  fog: number;
  themeId: ThemeId;
  paused: boolean;
  photoMode: boolean;
  bloom: boolean;
  chromatic: boolean;
  grain: boolean;
  reflections: boolean;
  /** Optional custom text painted onto the landmark sign (max 8 characters). */
  signText: string;
}

export const DEFAULT_STATE: AppState = {
  seed: 20240917,
  timeOfDay: 21.4,
  autoCycle: true,
  autoCycleSpeed: 0.28,
  rain: 0.62,
  snow: 0,
  fog: 0.42,
  themeId: 'synthwave',
  paused: false,
  photoMode: false,
  bloom: true,
  chromatic: true,
  grain: true,
  reflections: true,
  signText: '',
};

export type Listener = (state: AppState, prev: AppState) => void;

export interface Store {
  get(): AppState;
  set(patch: Partial<AppState>): void;
  subscribe(fn: Listener): () => void;
}

export function createStore(initial: Partial<AppState> = {}): Store {
  let state: AppState = { ...DEFAULT_STATE, ...initial };
  const listeners = new Set<Listener>();

  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const key of Object.keys(patch) as (keyof AppState)[]) {
        const value = patch[key];
        if (value !== undefined && value !== state[key]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      const prev = state;
      state = { ...state, ...patch };
      for (const fn of listeners) fn(state, prev);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
