use std::f32::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SignalState {
    pub ns_green: bool,
    pub ns_yellow: bool,
    pub ew_green: bool,
    pub ew_yellow: bool,
}
pub fn signal_state(elapsed: f32) -> SignalState {
    let t = if elapsed.is_finite() {
        elapsed.rem_euclid(46.0)
    } else {
        0.0
    };
    SignalState {
        ns_green: t < 18.0,
        ns_yellow: (18.0..21.0).contains(&t),
        ew_green: (23.0..41.0).contains(&t),
        ew_yellow: (41.0..44.0).contains(&t),
    }
}
pub struct Clock {
    pub hour: f32,
    pub auto: bool,
    pub speed: f32,
}
impl Clock {
    pub fn new(hour: f32) -> Self {
        Self {
            hour: if hour.is_finite() {
                hour.rem_euclid(24.0)
            } else {
                0.0
            },
            auto: false,
            speed: 0.01,
        }
    }
    pub fn advance(&mut self, dt: f32) {
        if self.auto && dt.is_finite() && dt > 0.0 && self.speed.is_finite() {
            self.hour = (self.hour + dt * self.speed).rem_euclid(24.0);
        }
    }
    pub fn env(&self, rain: f32, snow: f32, fog: f32) -> [f32; 8] {
        fn unit(x: f32) -> f32 {
            if x.is_finite() {
                x.clamp(0.0, 1.0)
            } else {
                0.0
            }
        }
        let hour = if self.hour.is_finite() {
            self.hour.rem_euclid(24.0)
        } else {
            0.0
        };
        let sun = ((hour - 6.0) * PI / 12.0).sin();
        let t = ((sun + 0.12) / 0.4).clamp(0.0, 1.0);
        let day = t * t * (3.0 - 2.0 * t);
        let night = 1.0 - day;
        let (r, s, f) = (unit(rain), unit(snow), unit(fog));
        [
            hour,
            sun,
            day,
            night,
            0.25 + 0.6 * night,
            (0.35 + 0.45 * night + 0.2 * r).clamp(0.0, 1.0),
            (r + 0.2 * s).clamp(0.0, 1.0),
            (0.4 * r + 0.3 * s + 0.7 * f).clamp(0.0, 1.0),
        ]
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signal_phases() {
        for (t, n, ny, e, ey) in [
            (0., true, false, false, false),
            (17.999, true, false, false, false),
            (18., false, true, false, false),
            (21., false, false, false, false),
            (23., false, false, true, false),
            (41., false, false, false, true),
            (44., false, false, false, false),
            (46., true, false, false, false),
        ] {
            assert_eq!(
                signal_state(t),
                SignalState {
                    ns_green: n,
                    ns_yellow: ny,
                    ew_green: e,
                    ew_yellow: ey
                }
            );
        }
    }
    #[test]
    fn environment_weather_and_night() {
        let noon = Clock::new(12.).env(0., 0., 0.);
        let night = Clock::new(22.).env(0., 0., 0.);
        let rain = Clock::new(22.).env(1., 0., 0.);
        assert!(night[4] > noon[4]);
        assert!(rain[6] > night[6] && rain[5] > night[5]);
    }
    #[test]
    fn clock_wraps() {
        let mut c = Clock::new(23.);
        c.auto = true;
        c.speed = 2.;
        c.advance(1.);
        assert_eq!(c.hour, 1.);
    }
}
