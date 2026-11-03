use super::rng::Rng;
pub struct Particles {
    pub rain: Vec<f32>,
    pub snow: Vec<f32>,
    rain_speed: Vec<f32>,
    snow_speed: Vec<f32>,
    rng: Rng,
    time: f32,
}
impl Particles {
    pub fn new(seed: u32) -> Self {
        let mut rng = Rng::new(seed);
        let mut rain = Vec::with_capacity(2200 * 6);
        let mut snow = Vec::with_capacity(1200 * 4);
        let mut rain_speed = Vec::with_capacity(2200);
        let mut snow_speed = Vec::with_capacity(1200);
        for _ in 0..2200 {
            let x = rng.range(-69.8, 69.8);
            let y = rng.range(1.6, 32.);
            let z = rng.range(-69.8, 69.8);
            let l = rng.range(0.6, 1.6);
            rain.extend_from_slice(&[x, y, z, x + 0.12, y - l, z + 0.06]);
            rain_speed.push(rng.range(18., 28.));
        }
        for _ in 0..1200 {
            snow.extend_from_slice(&[
                rng.range(-70., 70.),
                rng.range(0., 32.),
                rng.range(-70., 70.),
                rng.range(0.06, 0.18),
            ]);
            snow_speed.push(rng.range(0.8, 2.));
        }
        Self {
            rain,
            snow,
            rain_speed,
            snow_speed,
            rng,
            time: 0.,
        }
    }
    pub fn advance(&mut self, dt: f32, _rain: f32, _snow: f32) {
        if !dt.is_finite() || dt <= 0. {
            return;
        }
        self.time = (self.time + dt).rem_euclid(10000.);
        for (i, p) in self.rain.chunks_exact_mut(6).enumerate() {
            let len = p[1] - p[4];
            p[1] -= self.rain_speed[i] * dt;
            p[0] = (p[0] + 0.7 * dt + 69.8).rem_euclid(139.6) - 69.8;
            p[2] = (p[2] + 0.3 * dt + 69.8).rem_euclid(139.6) - 69.8;
            if p[1] < len {
                p[1] = 32.;
                p[0] = self.rng.range(-69.8, 69.8);
                p[2] = self.rng.range(-69.8, 69.8);
            }
            p[3] = p[0] + 0.12;
            p[4] = p[1] - len;
            p[5] = p[2] + 0.06;
        }
        for (i, p) in self.snow.chunks_exact_mut(4).enumerate() {
            p[1] -= self.snow_speed[i] * dt;
            p[0] = (p[0] + (self.time + i as f32).sin() * 0.35 * dt + 70.).rem_euclid(140.) - 70.;
            p[2] = (p[2] + 0.12 * dt + 70.).rem_euclid(140.) - 70.;
            if p[1] < 0. {
                p[1] = 32.;
                p[0] = self.rng.range(-70., 70.);
                p[2] = self.rng.range(-70., 70.);
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deterministic() {
        let mut a = Particles::new(11);
        let mut b = Particles::new(11);
        for _ in 0..100 {
            a.advance(0.1, 1., 1.);
            b.advance(0.1, 1., 1.);
        }
        assert_eq!(a.rain, b.rain);
        assert_eq!(a.snow, b.snow);
    }
    #[test]
    fn bounds_and_sizes() {
        let mut a = Particles::new(9);
        for _ in 0..100 {
            a.advance(0.1, 1., 1.);
        }
        for p in a.rain.chunks_exact(6) {
            for i in [0, 2, 3, 5] {
                assert!(p[i].abs() <= 70.);
            }
            assert!((0. ..=32.).contains(&p[1]) && (0. ..=32.).contains(&p[4]));
            assert!((0.599..=1.601).contains(&(p[1] - p[4])));
        }
        for p in a.snow.chunks_exact(4) {
            assert!(
                p[0].abs() <= 70.
                    && p[2].abs() <= 70.
                    && (0. ..=32.).contains(&p[1])
                    && (0.06..=0.18).contains(&p[3])
            );
        }
    }
}
