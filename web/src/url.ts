import { DEFAULT_STATE, type AppState } from './state';
import { THEME_IDS, THEMES } from './theme/palettes';
import type { ThemeId } from './types';

const BOOL_KEYS = ['bloom', 'chromatic', 'grain', 'reflections', 'auto'] as const;

function num(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const truthy = (raw: string | null, fallback: boolean): boolean => {
  if (raw === null) return fallback;
  return raw === '1' || raw === 'true' || raw === 'on';
};

/** Restore shareable state from the query string. Unknown/invalid values fall back to defaults. */
export function readUrlState(search: string = window.location.search): AppState {
  const params = new URLSearchParams(search);
  const themeRaw = params.get('theme') ?? '';
  const themeId: ThemeId =
    (THEME_IDS as string[]).includes(themeRaw) ? (themeRaw as ThemeId) : DEFAULT_STATE.themeId;

  return {
    ...DEFAULT_STATE,
    seed: Math.floor(num(params.get('seed'), DEFAULT_STATE.seed, 0, 0xffffffff)),
    timeOfDay: num(params.get('t'), DEFAULT_STATE.timeOfDay, 0, 23.999),
    rain: num(params.get('rain'), DEFAULT_STATE.rain, 0, 1),
    snow: num(params.get('snow'), DEFAULT_STATE.snow, 0, 1),
    fog: num(params.get('fog'), DEFAULT_STATE.fog, 0, 1),
    // A shared link pins the time unless it explicitly asks to keep cycling.
    autoCycle: params.has('auto') ? truthy(params.get('auto'), false) : !params.has('t') && DEFAULT_STATE.autoCycle,
    bloom: truthy(params.get('bloom'), DEFAULT_STATE.bloom),
    chromatic: truthy(params.get('chroma'), DEFAULT_STATE.chromatic),
    grain: truthy(params.get('grain'), DEFAULT_STATE.grain),
    reflections: truthy(params.get('refl'), DEFAULT_STATE.reflections),
    themeId,
    // never restore transient modes from a shared link
    photoMode: false,
    paused: false,
  };
}

function fmt(value: number, digits: number): string {
  return Number(value.toFixed(digits)).toString();
}

/** Encode the shareable subset of state into a full URL (query string included). */
export function writeUrlState(state: AppState): string {
  const params = new URLSearchParams();
  params.set('seed', String(state.seed >>> 0));
  params.set('t', fmt(state.timeOfDay, 2));
  params.set('rain', fmt(state.rain, 2));
  if (state.snow > 0.001) params.set('snow', fmt(state.snow, 2));
  params.set('fog', fmt(state.fog, 2));
  params.set('theme', state.themeId);
  params.set('auto', state.autoCycle ? '1' : '0');
  if (!state.bloom) params.set('bloom', '0');
  if (!state.chromatic) params.set('chroma', '0');
  if (!state.grain) params.set('grain', '0');
  if (!state.reflections) params.set('refl', '0');
  const url = new URL(window.location.href);
  url.search = params.toString();
  url.hash = '';
  return url.toString();
}

/** Validate a theme id coming from persisted storage / external input. */
export function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as string[]).includes(value) && value in THEMES;
}
