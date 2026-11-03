use super::clock::SignalState;
use super::rng::Rng;
use std::f32::consts::PI;
// Each walker follows a back-and-forth sidewalk route, crossing a road at its centre.
struct Ped {
    axis_ns: bool,
    fixed: f32,
    dir: f32,
    speed: f32,
    threshold: f32,
}
pub struct Crowd {
    pub peds: Vec<f32>,
    people: Vec<Ped>,
}
impl Crowd {
    pub fn new(seed: u32) -> Self {
        let mut rng = Rng::new(seed);
        let count = 24 + (rng.next_u32() % 17) as usize;
        let mut peds = Vec::with_capacity(count * 7);
        let mut people = Vec::with_capacity(count);
        for i in 0..count {
            let axis_ns = i % 2 == 0;
            let fixed = if axis_ns {
                if i % 4 == 0 {
                    12.7
                } else {
                    -12.7
                }
            } else if i % 4 == 1 {
                10.7
            } else {
                -10.7
            };
            let pos = if rng.chance(0.5) {
                rng.range(16., 68.)
            } else {
                rng.range(-68., -16.)
            };
            let dir = if rng.chance(0.5) { 1. } else { -1. };
            let (x, z, rot) = if axis_ns {
                (fixed, pos, if dir > 0. { 0. } else { PI })
            } else {
                (pos, fixed, if dir > 0. { PI / 2. } else { -PI / 2. })
            };
            peds.extend_from_slice(&[
                x,
                0.22,
                z,
                rot,
                rng.range(0., 2. * PI),
                0.,
                (rng.next_u32() % 3) as f32,
            ]);
            people.push(Ped {
                axis_ns,
                fixed,
                dir,
                speed: rng.range(1.1, 1.8),
                threshold: rng.f32(),
            });
        }
        Self { peds, people }
    }
    pub fn advance(&mut self, dt: f32, rain: f32, sig: SignalState) {
        if !dt.is_finite() || dt < 0. {
            return;
        }
        for (p, s) in self.peds.chunks_exact_mut(7).zip(&mut self.people) {
            p[5] = if s.threshold < rain.clamp(0., 1.) {
                1.
            } else {
                0.
            };
            let pos = if s.axis_ns { p[2] } else { p[0] };
            let green = if s.axis_ns {
                sig.ns_green
            } else {
                sig.ew_green
            };
            let edge = if s.axis_ns { 8. } else { 10. };
            let mut dist = s.speed * dt;
            let approach = pos * s.dir;
            if !green {
                if approach <= -edge {
                    dist = dist.min((-edge - approach).max(0.));
                } else if approach < edge {
                    dist = 0.;
                }
            }
            let mut next = pos + s.dir * dist;
            if next.abs() > 68. {
                next = next.clamp(-68., 68.);
                s.dir = -s.dir;
            }
            if s.axis_ns {
                p[0] = s.fixed;
                p[2] = next;
                p[3] = if s.dir > 0. { 0. } else { PI };
            } else {
                p[0] = next;
                p[2] = s.fixed;
                p[3] = if s.dir > 0. { PI / 2. } else { -PI / 2. };
            }
            let road = (edge - next.abs()).clamp(0., 1.);
            p[1] = 0.22 * (1. - road);
            p[4] = (p[4] + dist * 5.).rem_euclid(2. * PI);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::super::clock::signal_state;
    use super::*;
    #[test]
    fn safe_and_gated() {
        let mut c = Crowd::new(1);
        for i in 0..1200 {
            let sig = signal_state(i as f32 * 0.1);
            let old = c.peds.clone();
            c.advance(0.1, 0., sig);
            for (j, p) in c.peds.chunks_exact(7).enumerate() {
                assert!(p[0].abs() <= 70. && p[2].abs() <= 70. && !(p[0] > 18. && p[2] > 22.));
                let s = &c.people[j];
                let before = if s.axis_ns {
                    old[j * 7 + 2]
                } else {
                    old[j * 7]
                };
                let after = if s.axis_ns { p[2] } else { p[0] };
                let edge = if s.axis_ns { 8. } else { 10. };
                if !if s.axis_ns {
                    sig.ns_green
                } else {
                    sig.ew_green
                } && before.abs() < edge
                {
                    assert_eq!(before, after);
                }
            }
        }
    }
    #[test]
    fn umbrellas_follow_rain() {
        let mut c = Crowd::new(1);
        let sig = signal_state(0.);
        c.advance(0., 0., sig);
        assert_eq!(c.peds.chunks_exact(7).filter(|p| p[5] > 0.).count(), 0);
        c.advance(0., 1., sig);
        assert_eq!(
            c.peds.chunks_exact(7).filter(|p| p[5] > 0.).count(),
            c.people.len()
        );
    }
    #[test]
    fn deterministic_initial_state() {
        assert_eq!(Crowd::new(88).peds, Crowd::new(88).peds);
    }
}
