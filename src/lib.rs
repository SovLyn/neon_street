//! WASM boundary for the NEON STREET simulation.
//!
//! This file is deliberately thin: it owns the wasm-bindgen handle, translates
//! between the TypeScript-facing buffers (see `docs/CONTRACT.md` §2–3) and the
//! pure-Rust simulation modules in `src/core`.

use wasm_bindgen::prelude::*;

#[path = "core/rng.rs"]
mod rng;
#[path = "core/noise.rs"]
mod noise;
#[path = "core/layout.rs"]
mod layout;
#[path = "core/clock.rs"]
mod clock;
#[path = "core/traffic.rs"]
mod traffic;
#[path = "core/crowd.rs"]
mod crowd;
#[path = "core/water.rs"]
mod water;
#[path = "core/particles.rs"]
mod particles;
#[path = "core/events.rs"]
mod events;

const SIGN_FLASH_DECAY: f32 = 2.8;
const SIGN_GLITCH_DECAY: f32 = 1.9;
const RAIN_SMOOTHING: f32 = 2.4;

#[wasm_bindgen]
pub struct Sim {
    seed: u32,
    layout: layout::Layout,
    layout_json: String,
    clock: clock::Clock,
    traffic: traffic::Traffic,
    crowd: crowd::Crowd,
    water: water::Water,
    particles: particles::Particles,
    events: events::Events,
    rain_target: f32,
    rain: f32,
    snow_target: f32,
    snow: f32,
    fog_target: f32,
    fog: f32,
    elapsed: f32,
    env: Vec<f32>,
    signals: Vec<f32>,
    signs: Vec<f32>,
    lamps: Vec<f32>,
    lamp_on: Vec<f32>,
}

fn lane_configs(world: &layout::Layout) -> Vec<traffic::LaneConfig> {
    let mut lanes = Vec::with_capacity(8);
    for road in &world.roads {
        for lane in &road.lanes {
            lanes.push(traffic::LaneConfig {
                axis_ns: lane.axis == "ns",
                dir: lane.dir as f32,
                offset: lane.offset,
                speed: lane.speed,
            });
        }
    }
    lanes
}

impl Sim {
    fn build(seed: u32) -> Sim {
        let world = layout::generate(seed);
        let layout_json = serde_json::to_string(&world).unwrap_or_else(|_| String::from("{}"));
        let signals_len = world.signals.len() * 3;
        let signs_len = world.signs.len() * 2;
        let lamps_len = world.lamps.len();
        let lanes = lane_configs(&world);

        Sim {
            seed,
            clock: clock::Clock::new(20.0),
            traffic: traffic::Traffic::new(seed, &lanes),
            crowd: crowd::Crowd::new(seed),
            water: water::Water::new(),
            particles: particles::Particles::new(seed),
            events: events::Events::new(seed),
            layout: world,
            layout_json,
            rain_target: 0.0,
            rain: 0.0,
            snow_target: 0.0,
            snow: 0.0,
            fog_target: 0.0,
            fog: 0.0,
            elapsed: 0.0,
            env: vec![20.0, 0.0, 0.0, 1.0, 0.6, 1.0, 0.0, 0.0],
            signals: vec![0.0; signals_len],
            signs: vec![0.0; signs_len],
            lamps: vec![1.0; lamps_len * 2],
            lamp_on: vec![1.0; lamps_len],
        }
    }

    fn refresh_signals(&mut self) {
        let state = clock::signal_state(self.elapsed);
        self.signals.clear();
        for signal in &self.layout.signals {
            let ns = signal.axis == "ns";
            let (red, amber, green) = if signal.for_pedestrian {
                // Pedestrians walk while the traffic they cross is stopped.
                let traffic_green = if ns { state.ns_green } else { state.ew_green };
                let traffic_amber = if ns { state.ns_yellow } else { state.ew_yellow };
                if !traffic_green && !traffic_amber {
                    (0.0, 0.0, 1.0)
                } else {
                    (1.0, 0.0, 0.0)
                }
            } else if ns {
                if state.ns_green {
                    (0.0, 0.0, 1.0)
                } else if state.ns_yellow {
                    (0.0, 1.0, 0.0)
                } else {
                    (1.0, 0.0, 0.0)
                }
            } else if state.ew_green {
                (0.0, 0.0, 1.0)
            } else if state.ew_yellow {
                (0.0, 1.0, 0.0)
            } else {
                (1.0, 0.0, 0.0)
            };
            self.signals.extend_from_slice(&[red, amber, green]);
        }
    }

    fn refresh_env(&mut self) {
        let next = self.clock.env(self.rain, self.snow, self.fog);
        self.env.copy_from_slice(&next);
    }
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> Sim {
        console_error_panic_hook::set_once();
        let mut sim = Sim::build(seed);
        sim.refresh_signals();
        sim.refresh_env();
        sim
    }

    pub fn reseed(&mut self, seed: u32) {
        let hour = self.clock.hour;
        let auto = self.clock.auto;
        let speed = self.clock.speed;
        let mut next = Sim::build(seed);
        next.clock.hour = hour;
        next.clock.auto = auto;
        next.clock.speed = speed;
        next.rain = self.rain;
        next.rain_target = self.rain_target;
        next.snow = self.snow;
        next.snow_target = self.snow_target;
        next.fog = self.fog;
        next.fog_target = self.fog_target;
        next.refresh_signals();
        next.refresh_env();
        *self = next;
    }

    pub fn seed(&self) -> u32 {
        self.seed
    }

    pub fn layout_json(&self) -> String {
        self.layout_json.clone()
    }

    pub fn set_time_of_day(&mut self, hours: f32) {
        if !hours.is_finite() {
            return;
        }
        self.clock.hour = hours.rem_euclid(24.0);
        self.refresh_env();
    }

    pub fn time_of_day(&self) -> f32 {
        self.clock.hour
    }

    pub fn set_auto_cycle(&mut self, enabled: bool) {
        self.clock.auto = enabled;
    }

    pub fn set_auto_cycle_speed(&mut self, hours_per_second: f32) {
        if hours_per_second.is_finite() {
            self.clock.speed = hours_per_second.max(0.0);
        }
    }

    pub fn set_rain(&mut self, v: f32) {
        if v.is_finite() {
            self.rain_target = v.clamp(0.0, 1.0);
        }
    }

    pub fn set_snow(&mut self, v: f32) {
        if v.is_finite() {
            self.snow_target = v.clamp(0.0, 1.0);
        }
    }

    pub fn set_fog(&mut self, v: f32) {
        if v.is_finite() {
            self.fog_target = v.clamp(0.0, 1.0);
        }
    }

    pub fn rain(&self) -> f32 {
        self.rain
    }

    pub fn snow(&self) -> f32 {
        self.snow
    }

    pub fn fog(&self) -> f32 {
        self.fog
    }

    pub fn advance(&mut self, dt_sec: f32) {
        let dt = if dt_sec.is_finite() {
            dt_sec.clamp(0.0, 0.1)
        } else {
            0.0
        };
        self.elapsed = (self.elapsed + dt).rem_euclid(4096.0);

        let k = (dt * RAIN_SMOOTHING).min(1.0);
        self.rain += (self.rain_target - self.rain) * k;
        self.snow += (self.snow_target - self.snow) * k;
        self.fog += (self.fog_target - self.fog) * k;

        self.clock.advance(dt);
        let state = clock::signal_state(self.elapsed);

        self.traffic.advance(dt, state);
        self.crowd.advance(dt, self.rain, state);
        self.particles.advance(dt, self.rain, self.snow);
        self.water.advance(dt);

        if self.events.advance(dt) {
            for flash in self.signs.iter_mut().step_by(2) {
                *flash = 1.0;
            }
        }

        let flash_decay = SIGN_FLASH_DECAY * dt;
        let glitch_decay = SIGN_GLITCH_DECAY * dt;
        for pair in self.signs.chunks_exact_mut(2) {
            pair[0] = (pair[0] - flash_decay).max(0.0);
            pair[1] = (pair[1] - glitch_decay).max(0.0);
        }

        for (i, on) in self.lamp_on.iter().enumerate() {
            let dip = ((self.elapsed * 2.3 + i as f32 * 3.7).sin() * 0.5 + 0.5).powi(48);
            self.lamps[i * 2] = *on;
            self.lamps[i * 2 + 1] = 1.0 - dip * 0.82;
        }

        self.refresh_signals();
        self.refresh_env();
    }

    pub fn elapsed(&self) -> f32 {
        self.elapsed
    }

    pub fn flash_sign(&mut self, index: u32) {
        let i = index as usize;
        if i < self.layout.signs.len() {
            self.signs[i * 2] = 1.0;
            self.signs[i * 2 + 1] = 1.0;
        }
    }

    pub fn toggle_lamp(&mut self, index: u32) {
        let i = index as usize;
        if let Some(on) = self.lamp_on.get_mut(i) {
            *on = if *on > 0.5 { 0.0 } else { 1.0 };
        }
    }

    pub fn add_ripple(&mut self, x: f32, z: f32, strength: f32) {
        self.water.add_ripple(x, z, strength);
    }

    pub fn trigger_event(&mut self) {
        self.events.trigger();
    }

    pub fn env_ptr(&self) -> u32 {
        self.env.as_ptr() as u32
    }
    pub fn env_len(&self) -> usize {
        self.env.len()
    }
    pub fn cars_ptr(&self) -> u32 {
        self.traffic.cars.as_ptr() as u32
    }
    pub fn cars_len(&self) -> usize {
        self.traffic.cars.len()
    }
    pub fn peds_ptr(&self) -> u32 {
        self.crowd.peds.as_ptr() as u32
    }
    pub fn peds_len(&self) -> usize {
        self.crowd.peds.len()
    }
    pub fn signals_ptr(&self) -> u32 {
        self.signals.as_ptr() as u32
    }
    pub fn signals_len(&self) -> usize {
        self.signals.len()
    }
    pub fn signs_ptr(&self) -> u32 {
        self.signs.as_ptr() as u32
    }
    pub fn signs_len(&self) -> usize {
        self.signs.len()
    }
    pub fn lamps_ptr(&self) -> u32 {
        self.lamps.as_ptr() as u32
    }
    pub fn lamps_len(&self) -> usize {
        self.lamps.len()
    }
    pub fn water_ptr(&self) -> u32 {
        self.water.heights.as_ptr() as u32
    }
    pub fn water_len(&self) -> usize {
        self.water.heights.len()
    }
    pub fn rain_ptr(&self) -> u32 {
        self.particles.rain.as_ptr() as u32
    }
    pub fn rain_len(&self) -> usize {
        self.particles.rain.len()
    }
    pub fn snow_ptr(&self) -> u32 {
        self.particles.snow.as_ptr() as u32
    }
    pub fn snow_len(&self) -> usize {
        self.particles.snow.len()
    }
    pub fn events_json(&self) -> String {
        self.events.json()
    }
}
