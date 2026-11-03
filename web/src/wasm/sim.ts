import init, { Sim } from '../../pkg/neon_street.js';
import wasmUrl from '../../pkg/neon_street_bg.wasm?url';
import type { EventsJson, Layout } from '../types';

/** Offsets into the `env` buffer (stride 8). */
export const ENV = {
  hour: 0,
  sunElev: 1,
  dayFactor: 2,
  nightFactor: 3,
  windowLit: 4,
  neonBoost: 5,
  wetness: 6,
  precipFog: 7,
} as const;

/** Offsets into the `cars` buffer (stride 8). */
export const CAR = {
  x: 0,
  y: 1,
  z: 2,
  rotY: 3,
  speedNorm: 4,
  brake: 5,
  laneId: 6,
  kind: 7,
} as const;

/** Offsets into the `peds` buffer (stride 7). */
export const PED = {
  x: 0,
  y: 1,
  z: 2,
  rotY: 3,
  walkPhase: 4,
  umbrella: 5,
  kind: 6,
} as const;

/**
 * Thin, typed façade over the wasm module. All dynamic data is copied into
 * reusable Float32Arrays so callers can hold onto a stable view for a frame.
 */
export class SimBridge {
  readonly wasmBytes: number;
  private readonly sim: Sim;
  private readonly memory: WebAssembly.Memory;
  private readonly cache = new Map<string, Float32Array>();
  private layoutCache: Layout | null = null;

  constructor(sim: Sim, memory: WebAssembly.Memory, wasmBytes: number) {
    this.sim = sim;
    this.memory = memory;
    this.wasmBytes = wasmBytes;
  }

  get seed(): number {
    return this.sim.seed();
  }

  get timeOfDay(): number {
    return this.sim.time_of_day();
  }

  get rain(): number {
    return this.sim.rain();
  }

  get snow(): number {
    return this.sim.snow();
  }

  get fog(): number {
    return this.sim.fog();
  }

  get elapsed(): number {
    return this.sim.elapsed();
  }

  reseed(seed: number): void {
    this.sim.reseed(seed >>> 0);
    this.layoutCache = null;
  }

  layout(): Layout {
    if (!this.layoutCache) {
      this.layoutCache = JSON.parse(this.sim.layout_json()) as Layout;
    }
    return this.layoutCache;
  }

  setTimeOfDay(hours: number): void {
    this.sim.set_time_of_day(hours);
  }

  setAutoCycle(on: boolean): void {
    this.sim.set_auto_cycle(on);
  }

  setAutoCycleSpeed(hoursPerSecond: number): void {
    this.sim.set_auto_cycle_speed(hoursPerSecond);
  }

  setRain(v: number): void {
    this.sim.set_rain(v);
  }

  setSnow(v: number): void {
    this.sim.set_snow(v);
  }

  setFog(v: number): void {
    this.sim.set_fog(v);
  }

  advance(dt: number): void {
    this.sim.advance(dt);
  }

  flashSign(index: number): void {
    this.sim.flash_sign(index);
  }

  toggleLamp(index: number): void {
    this.sim.toggle_lamp(index);
  }

  addRipple(x: number, z: number, strength: number): void {
    this.sim.add_ripple(x, z, strength);
  }

  triggerEvent(): void {
    this.sim.trigger_event();
  }

  get env(): Float32Array {
    return this.buffer('env', this.sim.env_ptr(), this.sim.env_len());
  }

  get cars(): Float32Array {
    return this.buffer('cars', this.sim.cars_ptr(), this.sim.cars_len());
  }

  get peds(): Float32Array {
    return this.buffer('peds', this.sim.peds_ptr(), this.sim.peds_len());
  }

  get signals(): Float32Array {
    return this.buffer('signals', this.sim.signals_ptr(), this.sim.signals_len());
  }

  get signs(): Float32Array {
    return this.buffer('signs', this.sim.signs_ptr(), this.sim.signs_len());
  }

  get lamps(): Float32Array {
    return this.buffer('lamps', this.sim.lamps_ptr(), this.sim.lamps_len());
  }

  get water(): Float32Array {
    return this.buffer('water', this.sim.water_ptr(), this.sim.water_len());
  }

  /** rain streaks, stride 6: x1,y1,z1,x2,y2,z2 */
  get rainSegments(): Float32Array {
    return this.buffer('rain', this.sim.rain_ptr(), this.sim.rain_len());
  }

  /** snow flakes, stride 4: x,y,z,size */
  get snowFlakes(): Float32Array {
    return this.buffer('snow', this.sim.snow_ptr(), this.sim.snow_len());
  }

  events(): EventsJson {
    try {
      return JSON.parse(this.sim.events_json()) as EventsJson;
    } catch {
      return { events: [] };
    }
  }

  private buffer(key: string, ptr: number, len: number): Float32Array {
    let out = this.cache.get(key);
    if (!out || out.length !== len) {
      out = new Float32Array(len);
      this.cache.set(key, out);
    }
    if (len > 0) {
      // Re-create the view every call: wasm memory can grow and detach the buffer.
      out.set(new Float32Array(this.memory.buffer, ptr, len));
    }
    return out;
  }
}

export async function loadSim(seed: number): Promise<SimBridge> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`failed to fetch wasm: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const output = await init({ module_or_path: bytes });
  const memory = output.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error('wasm module did not export linear memory');
  }
  return new SimBridge(new Sim(seed >>> 0), memory, bytes.byteLength);
}
