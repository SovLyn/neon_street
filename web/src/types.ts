/**
 * Shared type definitions. Single source of truth for the layout data produced
 * by Rust (`layout_json`) and for the theme palettes used by every TS module.
 * Mirrored by `src/core/*` on the Rust side — keep in sync with docs/CONTRACT.md.
 */

export type Axis = 'ns' | 'ew';
export type SignKind = 'horizontal' | 'vertical' | 'rooftop' | 'blade';
export type SignFont = 'sans' | 'serif' | 'mono' | 'display';
export type PropKind =
  | 'ac'
  | 'vent'
  | 'planter'
  | 'vending'
  | 'bench'
  | 'hydrant'
  | 'pipe'
  | 'antenna'
  | 'neonStrip'
  | 'boat'
  | 'mooring';

export interface BoxDef {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export interface LaneDef {
  id: number;
  axis: Axis;
  /** +1 travels toward +axis, -1 toward -axis */
  dir: 1 | -1;
  /** lateral offset from the road center line (right-hand traffic) */
  offset: number;
  /** base speed, m/s */
  speed: number;
}

export interface RoadDef {
  axis: Axis;
  width: number;
  length: number;
  lanes: LaneDef[];
}

export interface CrosswalkDef {
  x: number;
  z: number;
  w: number;
  d: number;
  axis: Axis;
}

export interface WindowDef {
  /** occupancy bias, multiplied with the time-driven lit ratio from env buffer */
  lit: number;
  seed: number;
}

export interface BuildingDef {
  id: number;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** radians, multiples of PI/2 */
  rotY: number;
  colorIndex: number;
  windows: WindowDef;
}

export interface SkylineDef {
  id: number;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  colorIndex: number;
}

export interface SignDef {
  id: number;
  kind: SignKind;
  text: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  rotY: number;
  colorIndex: number;
  font: SignFont;
  buildingId: number;
  /** Large, hand-placed landmark sign — rendered at higher texture resolution. */
  hero?: boolean;
}

export interface LampDef {
  id: number;
  x: number;
  z: number;
  h: number;
  /** yaw the lamp arm points to (radians) */
  armYaw: number;
}

export interface SignalDef {
  id: number;
  x: number;
  z: number;
  rotY: number;
  axis: Axis;
  forPedestrian: boolean;
}

export interface PropDef {
  id: number;
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rotY: number;
  s: number;
  colorIndex: number;
}

export interface WaterDef {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  level: number;
  cols: number;
  rows: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Layout {
  seed: number;
  bounds: Bounds;
  roads: RoadDef[];
  sidewalks: BoxDef[];
  crosswalks: CrosswalkDef[];
  quays: BoxDef[];
  buildings: BuildingDef[];
  skyline: SkylineDef[];
  signs: SignDef[];
  lamps: LampDef[];
  signals: SignalDef[];
  props: PropDef[];
  water: WaterDef;
}

/* ------------------------------------------------------------------ themes */

export type ThemeId = 'synthwave' | 'cyberpunk' | 'tokyo' | 'toxic' | 'sakura';

export interface BloomConfig {
  strength: number;
  radius: number;
  threshold: number;
}

export interface ThemePalette {
  id: ThemeId;
  name: string;
  nameZh: string;
  /** 4 neon colors, referenced by colorIndex % 4 */
  neon: [string, string, string, string];
  accent: string;
  accent2: string;
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fogColor: string;
  /** base fog density multiplier at fog slider = 1 */
  fogDensity: number;
  ground: string;
  asphalt: string;
  sidewalk: string;
  buildingBase: string;
  buildingTrim: string;
  windowWarm: string;
  windowCool: string;
  ambient: string;
  keyLight: string;
  fillLight: string;
  water: string;
  waterDeep: string;
  bloom: BloomConfig;
  exposure: number;
  saturate: number;
}

/* ------------------------------------------------------------------ events */

export type EventKind = 'ufo' | 'cat' | 'flash' | 'shootingStar';

export interface SimEvent {
  kind: EventKind;
  /** progress 0..1 */
  p: number;
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  seed: number;
}

export interface EventsJson {
  events: SimEvent[];
}
