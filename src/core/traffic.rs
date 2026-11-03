use super::clock::SignalState;
use super::rng::Rng;
use std::f32::consts::PI;
pub struct LaneConfig {
    pub axis_ns: bool,
    pub dir: f32,
    pub offset: f32,
    pub speed: f32,
}
struct Lane {
    axis_ns: bool,
    dir: f32,
    offset: f32,
    speed: f32,
    start: usize,
    end: usize,
}
pub struct Traffic {
    pub cars: Vec<f32>,
    lanes: Vec<Lane>,
    next: Vec<f32>,
}
impl Traffic {
    pub fn new(seed: u32, lanes: &[LaneConfig]) -> Self {
        let mut rng = Rng::new(seed);
        let mut cars = Vec::new();
        let mut ls = Vec::new();
        for (id, l) in lanes.iter().enumerate() {
            let start = cars.len() / 8;
            let count = 4 + (rng.next_u32() % 4) as usize;
            let dir = if l.dir < 0. { -1. } else { 1. };
            let phase = rng.range(0., 144. / count as f32);
            for i in 0..count {
                let q = (-72. + phase + i as f32 * 144. / count as f32) * dir;
                let (x, z, rot) = if l.axis_ns {
                    (l.offset, q, if dir > 0. { 0. } else { PI })
                } else {
                    (q, l.offset, if dir > 0. { PI / 2. } else { -PI / 2. })
                };
                cars.extend_from_slice(&[
                    x,
                    0.,
                    z,
                    rot,
                    1.,
                    0.,
                    id as f32,
                    (rng.next_u32() % 5) as f32,
                ]);
            }
            ls.push(Lane {
                axis_ns: l.axis_ns,
                dir,
                offset: l.offset,
                speed: l.speed.max(0.),
                start,
                end: cars.len() / 8,
            });
        }
        let next = vec![0.; cars.len() / 8];
        Self {
            cars,
            lanes: ls,
            next,
        }
    }
    pub fn count(&self) -> usize {
        self.cars.len() / 8
    }
    pub fn advance(&mut self, dt: f32, sig: SignalState) {
        if !dt.is_finite() || dt <= 0. {
            return;
        } // Substeps preserve spacing even for large caller steps.
        let mut remaining = dt;
        while remaining > 0. {
            let step = remaining.min(0.05);
            remaining -= step;
            for lane in &self.lanes {
                for i in lane.start..lane.end {
                    let c = &self.cars[i * 8..i * 8 + 8];
                    let pos = if lane.axis_ns { c[2] } else { c[0] };
                    let q = pos * lane.dir;
                    let mut available: f32 = 144.;
                    for j in lane.start..lane.end {
                        if i == j {
                            continue;
                        }
                        let other = if lane.axis_ns {
                            self.cars[j * 8 + 2]
                        } else {
                            self.cars[j * 8]
                        };
                        let gap = (other * lane.dir - q).rem_euclid(144.);
                        available = available.min((gap - 3.2).max(0.));
                    }
                    let green = if lane.axis_ns {
                        sig.ns_green
                    } else {
                        sig.ew_green
                    };
                    if !green && q <= -14.5 {
                        available = available.min((-14.5 - q).max(0.));
                    }
                    let old = c[4] * lane.speed;
                    let target = lane.speed.min(old + 3.0 * step);
                    let travel = (target * step).min(available);
                    self.next[i] = travel;
                }
            }
            for lane in &self.lanes {
                for i in lane.start..lane.end {
                    let c = &mut self.cars[i * 8..i * 8 + 8];
                    let pos = if lane.axis_ns { c[2] } else { c[0] };
                    let new = (pos * lane.dir + self.next[i] + 72.).rem_euclid(144.) - 72.;
                    let speed = self.next[i] / step;
                    let old = c[4] * lane.speed;
                    c[5] = if speed + 0.01 < old {
                        ((old - speed) / 3.).clamp(0., 1.)
                    } else if speed < lane.speed * 0.1 {
                        1.
                    } else {
                        0.
                    };
                    c[4] = if lane.speed > 0. {
                        speed / lane.speed
                    } else {
                        0.
                    };
                    if lane.axis_ns {
                        c[0] = lane.offset;
                        c[2] = new * lane.dir;
                    } else {
                        c[0] = new * lane.dir;
                        c[2] = lane.offset;
                    }
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::super::clock::signal_state;
    use super::*;
    fn make() -> Traffic {
        Traffic::new(
            12,
            &[
                LaneConfig {
                    axis_ns: true,
                    dir: 1.,
                    offset: 2.5,
                    speed: 9.,
                },
                LaneConfig {
                    axis_ns: false,
                    dir: -1.,
                    offset: 2.,
                    speed: 8.,
                },
            ],
        )
    }
    #[test]
    fn spacing_bounds_and_lane_stability() {
        let mut t = make();
        let ids: Vec<f32> = t.cars.chunks_exact(8).map(|c| c[6]).collect();
        for k in 0..600 {
            t.advance(0.1, signal_state(k as f32 * 0.1));
            for (i, c) in t.cars.chunks_exact(8).enumerate() {
                assert!(c[0].abs() <= 72. && c[2].abs() <= 72.);
                assert_eq!(c[6], ids[i]);
                for d in t.cars.chunks_exact(8).skip(i + 1) {
                    if c[6] == d[6] {
                        let delta = if c[6] == 0. {
                            (c[2] - d[2]).abs()
                        } else {
                            (c[0] - d[0]).abs()
                        };
                        assert!(delta.min(144. - delta) >= 3.19);
                    }
                }
            }
        }
    }
    #[test]
    fn red_stop() {
        let mut t = make();
        let red = signal_state(21.);
        for _ in 0..1200 {
            t.advance(0.1, red);
        }
        assert!(t
            .cars
            .chunks_exact(8)
            .any(|c| c[6] == 0. && (c[2] + 14.5).abs() < 0.01 && c[4] < 0.01));
    }
}
