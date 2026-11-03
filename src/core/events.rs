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
        // Frequent enough that a two-minute visit sees several eggs.
        let next = rng.range(20., 40.);
        Self {
            rng,
            events: Vec::with_capacity(2),
            next,
        }
    }
    fn start(&mut self) {
        // One at a time: overlapping eggs read as visual noise, not as a treat.
        if !self.events.is_empty() {
            return;
        }
        let kind = (self.rng.next_u32() % 4) as u8;
        let duration = [9., 2.4, 0.9, 1.6][kind as usize];
        let z = match kind {
            0 => self.rng.range(-8., 10.),
            1 => self.rng.range(-5., 5.),
            2 => 0.,
            _ => self.rng.range(-40., -10.),
        };
        let y = match kind {
            0 => self.rng.range(24., 30.),
            1 => 0.,
            2 => 0.,
            _ => self.rng.range(30., 40.),
        };
        self.events.push(Event {
            kind,
            age: 0.,
            duration,
            seed: self.rng.next_u32(),
            z,
            y,
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
            self.next = self.rng.range(20., 40.);
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
                        // The cat only crosses the crossroads; sky events sweep wider.
                        let span = if e.kind == 1 { 9. } else { 55. };
                        e.dir * (-span + 2. * span * p)
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
            assert!(e.active() <= 1);
            let v: serde_json::Value = serde_json::from_str(&e.json()).unwrap();
            for x in v["events"].as_array().unwrap() {
                let y = x["y"].as_f64().unwrap();
                let px = x["x"].as_f64().unwrap();
                match x["kind"].as_str().unwrap() {
                    // Sky events must stay high enough to clear the towers...
                    "ufo" => assert!((23. ..=31.).contains(&y)),
                    "shootingStar" => assert!((29. ..=41.).contains(&y)),
                    // ...and the cat must stay on the crossroads.
                    "cat" => {
                        assert!(px.abs() <= 9.01, "cat wandered to {px}");
                        assert!(y.abs() < 0.01);
                    }
                    _ => {}
                }
            }
        }
    }

    #[test]
    fn cat_crosses_the_crossroads_at_a_believable_speed() {
        let mut e = Events::new(11);
        // Force a cat: kind 1, then read the JSON over its whole life.
        e.events.push(Event {
            kind: 1,
            age: 0.,
            duration: 2.4,
            seed: 7,
            z: 1.,
            y: 0.,
            dir: 1.,
            announced: false,
        });
        let start: f64 = {
            let v: serde_json::Value = serde_json::from_str(&e.json()).unwrap();
            v["events"][0]["x"].as_f64().unwrap()
        };
        e.advance(2.4);
        let end: f64 = {
            let v: serde_json::Value = serde_json::from_str(&e.json()).unwrap();
            v["events"][0]["x"].as_f64().unwrap()
        };
        let distance = (end - start).abs();
        assert!((12. ..=25.).contains(&distance), "cat crossed {distance}m");
        let speed = distance / 2.4;
        assert!(speed < 9., "cat ran at {speed} m/s");
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
            assert!((20. ..=40.).contains(&e.next));
            let n = e.next;
            e.advance(n);
        }
    }
}
