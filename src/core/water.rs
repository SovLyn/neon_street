//! Canal height field and bounded, short-lived interaction ripples.

const SIDE: usize = 64;
const MAX_RIPPLES: usize = 8;

struct Ripple {
    x: f32,
    z: f32,
    strength: f32,
    age: f32,
}

pub struct Water {
    pub heights: Vec<f32>,
    ripples: Vec<Ripple>,
    time: f32,
}

impl Water {
    pub fn new() -> Self {
        Self { heights: vec![0.0; SIDE * SIDE], ripples: Vec::new(), time: 0.0 }
    }

    pub fn add_ripple(&mut self, x: f32, z: f32, strength: f32) {
        if !x.is_finite() || !z.is_finite() || !strength.is_finite() {
            return;
        }
        if !(18.0..=68.0).contains(&x) || !(22.0..=68.0).contains(&z) {
            return;
        }
        if self.ripples.len() == MAX_RIPPLES {
            self.ripples.remove(0);
        }
        self.ripples.push(Ripple { x, z, strength: strength.clamp(-1.0, 1.0), age: 0.0 });
    }

    pub fn advance(&mut self, dt: f32) {
        if !dt.is_finite() || dt <= 0.0 { return; }
        self.time = (self.time + dt).rem_euclid(4096.0);
        for ripple in &mut self.ripples { ripple.age += dt; }
        self.ripples.retain(|r| r.age < 4.0);
        for z in 0..SIDE {
            for x in 0..SIDE {
                let wx = 18.0 + 50.0 * x as f32 / 63.0;
                let wz = 22.0 + 46.0 * z as f32 / 63.0;
                let mut h = 0.12 * (wx * 0.19 + wz * 0.11 - self.time * 1.4).sin()
                    + 0.07 * (wx * 0.08 - wz * 0.22 + self.time * 1.1).sin();
                for r in &self.ripples {
                    let dist = ((wx - r.x).powi(2) + (wz - r.z).powi(2)).sqrt();
                    let wave = dist - r.age * 8.0;
                    h += r.strength * (1.0 - r.age / 4.0) * (-wave.abs() * 0.45).exp() * (wave * 1.7).cos() * 0.4;
                }
                self.heights[z * SIDE + x] = h.clamp(-1.0, 1.0);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn water_ripples_are_bounded() {
        let mut water = Water::new();
        for _ in 0..20 { water.add_ripple(40.0, 40.0, 100.0); }
        water.advance(0.1);
        assert!(water.heights.iter().all(|h| (-1.0..=1.0).contains(h)));
        assert_eq!(water.ripples.len(), MAX_RIPPLES);
    }

    #[test]
    fn water_ripples_expire() {
        let mut water = Water::new();
        water.add_ripple(40.0, 40.0, 1.0);
        water.advance(4.0);
        assert!(water.ripples.is_empty());
    }

    #[test]
    fn water_rejects_invalid_inputs() {
        let mut water = Water::new();
        water.add_ripple(f32::NAN, 40.0, 1.0);
        water.add_ripple(0.0, 0.0, 1.0);
        assert!(water.ripples.is_empty());
        water.advance(f32::NAN);
        assert!(water.heights.iter().all(|h| h.is_finite()));
    }
}
