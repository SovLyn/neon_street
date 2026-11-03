use super::rng::Rng;
use serde::Serialize;
#[derive(Serialize)]
pub struct EventJson {
    kind: &'static str,
    p: f32,
    x: f32,
    y: f32,
    z: f32,
    dx: f32,
    dz: f32,
    seed: u32,
}
struct Event {
    kind: u8,
    age: f32,
    duration: f32,
    seed: u32,
    z: f32,
    y: f32,
    dir: f32,
    announced: bool,
}
pub struct Events {
    rng: Rng,
    events: Vec<Event>,
    next: f32,
}
impl Events {
    pub fn new(seed: u32) -> Self {
        let mut rng = Rng::new(seed);
        let next = rng.range(45., 120.);
        Self {
            rng,
            events: Vec::with_capacity(2),
            next,
        }
    }
    fn start(&mut self) {
        if self.events.len() >= 2 {
            return;
        }
        let kind = (self.rng.next_u32() % 4) as u8;
        let duration = [9., 4., 0.9, 2.5][kind as usize];
        self.events.push(Event {
            kind,
            age: 0.,
            duration,
            seed: self.rng.next_u32(),
            z: self.rng.range(-12., 12.),
            y: self.rng.range(34., 48.),
            dir: if self.rng.chance(0.5) { 1. } else { -1. },
            announced: false,
        });
    }
    pub fn advance(&mut self, dt: f32) -> bool {
        let dt = if dt.is_finite() { dt.max(0.) } else { 0. };
        for e in &mut self.events {
            e.age += dt;
        }
        self.events.retain(|e| e.age < e.duration || !e.announced);
        self.next -= dt;
        if self.next <= 0. {
            self.start();
            self.next = self.rng.range(45., 120.);
        }
        let mut flash = false;
        for e in &mut self.events {
            if !e.announced {
                if e.kind == 2 {
                    flash = true;
                }
                e.announced = true;
            }
        }
        flash
    }
    pub fn trigger(&mut self) {
        self.start();
    }
    pub fn json(&self) -> String {
        let events: Vec<EventJson> = self
            .events
            .iter()
            .map(|e| {
                let p = (e.age / e.duration).clamp(0., 1.);
                EventJson {
                    kind: ["ufo", "cat", "flash", "shootingStar"][e.kind as usize],
                    p,
                    x: if e.kind == 2 {
                        0.
                    } else {
                        e.dir * (-65. + 130. * p)
                    },
                    y: if e.kind == 1 {
                        0.
                    } else if e.kind == 2 {
                        0.
                    } else {
                        e.y
                    },
                    z: e.z,
                    dx: e.dir,
                    dz: 0.,
                    seed: e.seed,
                }
            })
            .collect();
        serde_json::to_string(&serde_json::json!({"events":events}))
            .unwrap_or_else(|_| String::from("{\"events\":[]}"))
    }
    pub fn active(&self) -> usize {
        self.events.len()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cap_and_altitude() {
        let mut e = Events::new(4);
        for _ in 0..1000 {
            e.trigger();
            e.advance(0.1);
            assert!(e.active() <= 2);
            let v: serde_json::Value = serde_json::from_str(&e.json()).unwrap();
            for x in v["events"].as_array().unwrap() {
                if x["kind"] == "ufo" || x["kind"] == "shootingStar" {
                    assert!(x["y"].as_f64().unwrap() > 32.);
                }
            }
        }
    }
    #[test]
    fn flash_once() {
        let mut e = Events::new(5);
        e.events.push(Event {
            kind: 2,
            age: 0.,
            duration: 0.9,
            seed: 0,
            z: 0.,
            y: 0.,
            dir: 1.,
            announced: false,
        });
        assert!(e.advance(0.1));
        assert!(!e.advance(0.1));
    }
    #[test]
    fn schedule_range() {
        let mut e = Events::new(1);
        for _ in 0..100 {
            assert!((45. ..=120.).contains(&e.next));
            let n = e.next;
            e.advance(n);
        }
    }
}
