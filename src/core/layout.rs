use serde::Serialize;

use super::{noise, rng::Rng};

const PI: f32 = std::f32::consts::PI;
const HALF_PI: f32 = std::f32::consts::FRAC_PI_2;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub min_x: f32,
    pub max_x: f32,
    pub min_z: f32,
    pub max_z: f32,
}
#[derive(Clone, Serialize)]
pub struct BoxDef {
    pub x: f32,
    pub z: f32,
    pub w: f32,
    pub d: f32,
    pub h: f32,
}
#[derive(Clone, Serialize)]
pub struct Lane {
    pub id: usize,
    pub axis: &'static str,
    pub dir: i32,
    pub offset: f32,
    pub speed: f32,
}
#[derive(Clone, Serialize)]
pub struct Road {
    pub axis: &'static str,
    pub width: f32,
    pub length: f32,
    pub lanes: Vec<Lane>,
}
#[derive(Clone, Serialize)]
pub struct Crosswalk {
    pub x: f32,
    pub z: f32,
    pub w: f32,
    pub d: f32,
    pub axis: &'static str,
}
#[derive(Clone, Serialize)]
pub struct Window {
    pub lit: f32,
    pub seed: u32,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Building {
    pub id: usize,
    pub x: f32,
    pub z: f32,
    pub w: f32,
    pub d: f32,
    pub h: f32,
    pub rot_y: f32,
    pub color_index: u32,
    pub windows: Window,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skyline {
    pub id: usize,
    pub x: f32,
    pub z: f32,
    pub w: f32,
    pub d: f32,
    pub h: f32,
    pub color_index: u32,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sign {
    pub id: usize,
    pub kind: &'static str,
    pub text: &'static str,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
    pub h: f32,
    pub rot_y: f32,
    pub color_index: u32,
    pub font: &'static str,
    pub building_id: usize,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lamp {
    pub id: usize,
    pub x: f32,
    pub z: f32,
    pub h: f32,
    pub arm_yaw: f32,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Signal {
    pub id: usize,
    pub x: f32,
    pub z: f32,
    pub rot_y: f32,
    pub axis: &'static str,
    pub for_pedestrian: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prop {
    pub id: usize,
    pub kind: &'static str,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub rot_y: f32,
    pub s: f32,
    pub color_index: u32,
}
#[derive(Clone, Serialize)]
pub struct Water {
    pub x0: f32,
    pub z0: f32,
    pub x1: f32,
    pub z1: f32,
    pub level: f32,
    pub cols: usize,
    pub rows: usize,
}
#[derive(Clone, Serialize)]
pub struct Layout {
    pub seed: u32,
    pub bounds: Bounds,
    pub roads: Vec<Road>,
    pub sidewalks: Vec<BoxDef>,
    pub crosswalks: Vec<Crosswalk>,
    pub quays: Vec<BoxDef>,
    pub buildings: Vec<Building>,
    pub skyline: Vec<Skyline>,
    pub signs: Vec<Sign>,
    pub lamps: Vec<Lamp>,
    pub signals: Vec<Signal>,
    pub props: Vec<Prop>,
    pub water: Water,
}

fn boxdef(x: f32, z: f32, w: f32, d: f32, h: f32) -> BoxDef {
    BoxDef { x, z, w, d, h }
}
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Adds the three long street-front parcels and one cross-street parcel for a quadrant.
fn add_quadrant(buildings: &mut Vec<Building>, rng: &mut Rng, seed: u32, sx: f32, sz: f32) {
    for row in 0..3 {
        let w = rng.range(10.0, 16.5);
        let d = rng.range(9.0, 13.5);
        // Its inner face is 15.5m from the center, leaving the 14m road/sidewalk corridor.
        let x = sx * (15.5 + w * 0.5);
        let z = sz * (23.0 + row as f32 * 19.0 + rng.range(-1.2, 1.2));
        let skyline = noise::fbm2(x * 0.055, z * 0.055, seed);
        let id = buildings.len();
        buildings.push(Building {
            id,
            x,
            z,
            w,
            d,
            h: lerp(10.0, 46.0, skyline),
            rot_y: [0.0, HALF_PI, PI, PI + HALF_PI][(rng.next_u32() % 4) as usize],
            color_index: rng.next_u32() % 4,
            windows: Window {
                lit: rng.range(0.45, 0.95),
                seed: rng.next_u32(),
            },
        });
    }
    let w = rng.range(10.0, 16.5);
    let d = rng.range(9.0, 13.5);
    let x = sx * (45.0 + rng.range(-2.0, 2.0));
    let z = sz * (15.5 + d * 0.5);
    let skyline = noise::fbm2(x * 0.055, z * 0.055, seed);
    let id = buildings.len();
    buildings.push(Building {
        id,
        x,
        z,
        w,
        d,
        h: lerp(10.0, 46.0, skyline),
        rot_y: [0.0, HALF_PI, PI, PI + HALF_PI][(rng.next_u32() % 4) as usize],
        color_index: rng.next_u32() % 4,
        windows: Window {
            lit: rng.range(0.45, 0.95),
            seed: rng.next_u32(),
        },
    });
}

/// The facade nearest the street; signs are offset from this plane so they never z-fight.
fn street_facade(b: &Building) -> (f32, f32, f32) {
    if b.x.abs() < b.z.abs() {
        let outward = if b.x < 0.0 { 1.0 } else { -1.0 };
        (
            b.x + outward * (b.w * 0.5 + 0.42),
            b.z,
            if outward > 0.0 { HALF_PI } else { -HALF_PI },
        )
    } else {
        let outward = if b.z < 0.0 { 1.0 } else { -1.0 };
        (
            b.x,
            b.z + outward * (b.d * 0.5 + 0.42),
            if outward > 0.0 { 0.0 } else { PI },
        )
    }
}

pub fn generate(seed: u32) -> Layout {
    let mut rng = Rng::new(seed);
    let mut lanes = Vec::new();
    for (i, (&offset, &speed)) in [2.5, 7.5, -2.5, -7.5]
        .iter()
        .zip([8.5, 11.0, 8.5, 11.0].iter())
        .enumerate()
    {
        lanes.push(Lane {
            id: i,
            axis: "ns",
            dir: if i < 2 { 1 } else { -1 },
            offset,
            speed,
        });
    }
    let mut ew_lanes = Vec::new();
    for (i, (&offset, &speed)) in [2.0, 6.0, -2.0, -6.0]
        .iter()
        .zip([8.0, 10.0, 8.0, 10.0].iter())
        .enumerate()
    {
        ew_lanes.push(Lane {
            id: i + 4,
            axis: "ew",
            dir: if i < 2 { 1 } else { -1 },
            offset,
            speed,
        });
    }
    let roads = vec![
        Road {
            axis: "ns",
            width: 20.0,
            length: 144.0,
            lanes,
        },
        Road {
            axis: "ew",
            width: 16.0,
            length: 144.0,
            lanes: ew_lanes,
        },
    ];

    let mut sidewalks = Vec::new();
    for side in [-1.0, 1.0] {
        for half in [-1.0, 1.0] {
            sidewalks.push(boxdef(side * 12.0, half * 43.0, 4.0, 58.0, 0.22));
            sidewalks.push(boxdef(half * 43.0, side * 10.0, 58.0, 4.0, 0.22));
        }
    }
    let crosswalks = vec![
        Crosswalk {
            x: 0.0,
            z: 11.5,
            w: 20.0,
            d: 4.0,
            axis: "ew",
        },
        Crosswalk {
            x: 0.0,
            z: -11.5,
            w: 20.0,
            d: 4.0,
            axis: "ew",
        },
        Crosswalk {
            x: 11.5,
            z: 0.0,
            w: 4.0,
            d: 16.0,
            axis: "ns",
        },
        Crosswalk {
            x: -11.5,
            z: 0.0,
            w: 4.0,
            d: 16.0,
            axis: "ns",
        },
    ];
    let quays = vec![
        boxdef(17.4, 45.0, 1.2, 46.0, 1.1),
        boxdef(43.0, 21.4, 50.0, 1.2, 1.1),
    ];

    let mut buildings = Vec::new();
    // NW, NE, SW: SE remains entirely water.
    for (sx, sz) in [(-1.0, -1.0), (1.0, -1.0), (-1.0, 1.0)] {
        add_quadrant(&mut buildings, &mut rng, seed, sx, sz);
    }

    let texts = [
        "霓虹", "拉面", "夜市", "電玩", "当铺", "HOTEL", "NOODLE", "BAR", "24H", "NEON", "CYBER",
        "未来", "酒場", "KTV",
    ];
    let kinds = ["horizontal", "vertical", "rooftop", "blade"];
    let fonts = ["sans", "serif", "mono", "display"];
    let mut signs = Vec::new();
    for b in &buildings {
        for n in 0..if b.id < 8 { 2 } else { 1 } {
            let id = signs.len();
            let kind = kinds[id % kinds.len()];
            let (mut x, mut z, rot_y) = street_facade(b);
            // Vertical cabinets deliberately sit at a facade corner rather than
            // floating in the middle of a wall.
            if kind == "vertical" {
                if rot_y.abs() == HALF_PI {
                    z += if id % 2 == 0 { b.d * 0.42 } else { -b.d * 0.42 };
                } else {
                    x += if id % 2 == 0 { b.w * 0.42 } else { -b.w * 0.42 };
                }
            }
            let (w, h, y) = match kind {
                "vertical" => (
                    rng.range(1.6, 2.4),
                    rng.range(4.0, 8.0),
                    rng.range(4.0, 14.0).min(b.h - 0.5),
                ),
                "rooftop" => (
                    rng.range(8.0, 14.0),
                    rng.range(1.6, 3.0),
                    b.h + rng.range(0.5, 2.5),
                ),
                "blade" => (
                    rng.range(2.0, 3.2),
                    rng.range(2.2, 4.2),
                    rng.range(4.0, 9.0).min(b.h - 0.5),
                ),
                _ => (
                    rng.range(5.0, 10.0),
                    rng.range(1.4, 2.2),
                    rng.range(4.0, 9.0).min(b.h - 0.5),
                ),
            };
            signs.push(Sign {
                id,
                kind,
                text: texts[(id + n) % texts.len()],
                x,
                y,
                z,
                w,
                h,
                rot_y,
                color_index: (id % 4) as u32,
                font: fonts[(id + n) % fonts.len()],
                building_id: b.id,
            });
        }
    }

    let mut lamps = Vec::new();
    for side in [-1.0, 1.0] {
        for &t in &[-63.0, -47.0, -31.0, 21.0, 37.0, 53.0, 67.0] {
            let id = lamps.len();
            lamps.push(Lamp {
                id,
                x: side * 12.6,
                z: t,
                h: rng.range(5.5, 7.0),
                arm_yaw: if side > 0.0 { PI } else { 0.0 },
            });
            let id = lamps.len();
            lamps.push(Lamp {
                id,
                x: t,
                z: side * 10.6,
                h: rng.range(5.5, 7.0),
                arm_yaw: if side > 0.0 { -HALF_PI } else { HALF_PI },
            });
        }
    }

    let mut signals = Vec::new();
    for &(x, z, axis, yaw) in &[
        (-12.5, -10.5, "ns", 0.0),
        (12.5, -10.5, "ew", HALF_PI),
        (-12.5, 10.5, "ew", -HALF_PI),
        (12.5, 10.5, "ns", PI),
    ] {
        let id = signals.len();
        signals.push(Signal {
            id,
            x,
            z,
            rot_y: yaw,
            axis,
            for_pedestrian: false,
        });
        let id = signals.len();
        signals.push(Signal {
            id,
            x,
            z,
            rot_y: yaw,
            axis,
            for_pedestrian: true,
        });
    }

    let roof_kinds = ["ac", "vent", "antenna", "pipe", "neonStrip"];
    let mut props = Vec::new();
    for b in &buildings {
        for n in 0..2 {
            let id = props.len();
            props.push(Prop {
                id,
                kind: roof_kinds[(id + n) % roof_kinds.len()],
                x: b.x + rng.range(-b.w * 0.28, b.w * 0.28),
                y: b.h + rng.range(0.15, 0.65),
                z: b.z + rng.range(-b.d * 0.28, b.d * 0.28),
                rot_y: (rng.next_u32() % 4) as f32 * HALF_PI,
                s: 1.0,
                color_index: (id % 4) as u32,
            });
        }
    }
    let street_props = [
        "planter", "bench", "hydrant", "vending", "planter", "bench", "hydrant", "vending",
    ];
    for (i, &kind) in street_props.iter().enumerate() {
        let id = props.len();
        let t = [-55.0, -39.0, -23.0, 24.0, 39.0, 55.0, -31.0, 47.0][i];
        let (x, z) = if i % 2 == 0 {
            (if i < 4 { -11.7 } else { 11.7 }, t)
        } else {
            (t, if i < 4 { -9.7 } else { 9.7 })
        };
        props.push(Prop {
            id,
            kind,
            x,
            y: 0.22,
            z,
            rot_y: 0.0,
            s: 1.0,
            color_index: (id % 4) as u32,
        });
    }
    for &(kind, x, z, yaw) in &[
        ("boat", 29.0, 37.0, 0.2),
        ("boat", 47.0, 51.0, -0.3),
        ("boat", 61.0, 31.0, HALF_PI),
        ("mooring", 22.0, 30.0, 0.0),
        ("mooring", 63.0, 61.0, 0.0),
    ] {
        let id = props.len();
        props.push(Prop {
            id,
            kind,
            x,
            y: -0.4,
            z,
            rot_y: yaw,
            s: 1.0,
            color_index: (id % 4) as u32,
        });
    }

    let mut skyline = Vec::new();
    for i in 0..24 {
        let side = i % 4;
        let t = -70.0 + (i / 4) as f32 * 28.0;
        let (x, z) = match side {
            0 => (-84.0, t),
            1 => (84.0, t),
            2 => (t, -84.0),
            _ => (t, 84.0),
        };
        skyline.push(Skyline {
            id: i,
            x,
            z,
            w: rng.range(10.0, 20.0),
            d: rng.range(10.0, 20.0),
            h: rng.range(30.0, 90.0),
            color_index: (i % 4) as u32,
        });
    }

    Layout {
        seed,
        bounds: Bounds {
            min_x: -72.0,
            max_x: 72.0,
            min_z: -72.0,
            max_z: 72.0,
        },
        roads,
        sidewalks,
        crosswalks,
        quays,
        buildings,
        skyline,
        signs,
        lamps,
        signals,
        props,
        water: Water {
            x0: 18.0,
            z0: 22.0,
            x1: 68.0,
            z1: 68.0,
            level: -0.4,
            cols: 64,
            rows: 64,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn overlaps(a: &Building, b: &Building, pad: f32) -> bool {
        (a.x - b.x).abs() < (a.w + b.w) * 0.5 + pad && (a.z - b.z).abs() < (a.d + b.d) * 0.5 + pad
    }
    fn in_canal(x: f32, z: f32) -> bool {
        (18.0..=68.0).contains(&x) && (22.0..=68.0).contains(&z)
    }

    #[test]
    fn deterministic_layout_json() {
        assert_eq!(
            serde_json::to_string(&generate(91)).unwrap(),
            serde_json::to_string(&generate(91)).unwrap()
        );
    }
    #[test]
    fn ids_are_array_indices() {
        let l = generate(8);
        for (i, b) in l.buildings.iter().enumerate() {
            assert_eq!(b.id, i);
        }
        for (i, s) in l.signs.iter().enumerate() {
            assert_eq!(s.id, i);
        }
        for (i, x) in l.lamps.iter().enumerate() {
            assert_eq!(x.id, i);
        }
        for (i, x) in l.signals.iter().enumerate() {
            assert_eq!(x.id, i);
        }
        for (i, x) in l.props.iter().enumerate() {
            assert_eq!(x.id, i);
        }
    }
    #[test]
    fn buildings_have_clear_alleys_and_avoid_forbidden_land() {
        let l = generate(17);
        for (i, a) in l.buildings.iter().enumerate() {
            assert!(a.x - a.w * 0.5 >= 14.0 || a.x + a.w * 0.5 <= -14.0);
            assert!(a.z - a.d * 0.5 >= 14.0 || a.z + a.d * 0.5 <= -14.0);
            assert!(!(a.x + a.w * 0.5 > 18.0 && a.z + a.d * 0.5 > 22.0));
            for b in &l.buildings[i + 1..] {
                assert!(!overlaps(a, b, 0.5));
            }
        }
    }
    #[test]
    fn signs_are_real_facade_signs_inside_world() {
        let l = generate(33);
        for s in &l.signs {
            let b = &l.buildings[s.building_id];
            assert!(s.x.abs() <= 72.0 && s.z.abs() <= 72.0);
            let outside_x = (s.x - b.x).abs() >= b.w * 0.5 + 0.2;
            let outside_z = (s.z - b.z).abs() >= b.d * 0.5 + 0.2;
            assert!(outside_x || outside_z);
        }
    }
    #[test]
    fn street_furniture_and_water_are_separated() {
        let l = generate(4);
        for p in &l.props {
            if p.kind != "boat" && p.kind != "mooring" {
                assert!(!in_canal(p.x, p.z));
            }
        }
        assert_eq!(l.props.iter().filter(|p| p.kind == "boat").count(), 3);
    }
    #[test]
    fn lamps_signals_and_quadrants_are_complete() {
        let l = generate(12);
        assert_eq!(l.lamps.len(), 28);
        assert_eq!(l.signals.len(), 8);
        assert_eq!(l.signals.iter().filter(|s| s.for_pedestrian).count(), 4);
        assert_eq!(
            l.buildings
                .iter()
                .filter(|b| b.x < 0.0 && b.z < 0.0)
                .count(),
            4
        );
        assert_eq!(
            l.buildings
                .iter()
                .filter(|b| b.x > 0.0 && b.z < 0.0)
                .count(),
            4
        );
        assert_eq!(
            l.buildings
                .iter()
                .filter(|b| b.x < 0.0 && b.z > 0.0)
                .count(),
            4
        );
    }
    #[test]
    fn crossings_quays_and_lanes_match_contract() {
        let l = generate(1);
        assert_eq!(l.crosswalks.len(), 4);
        assert_eq!(l.quays.len(), 2);
        assert_eq!(
            l.roads[0]
                .lanes
                .iter()
                .map(|x| x.offset)
                .collect::<Vec<_>>(),
            vec![2.5, 7.5, -2.5, -7.5]
        );
        assert_eq!(
            l.roads[1]
                .lanes
                .iter()
                .map(|x| x.offset)
                .collect::<Vec<_>>(),
            vec![2.0, 6.0, -2.0, -6.0]
        );
    }
    #[test]
    fn sign_vocabulary_and_ranges_are_valid() {
        let l = generate(6);
        assert!((14..=24).contains(&l.signs.len()));
        for s in &l.signs {
            assert!(["horizontal", "vertical", "rooftop", "blade"].contains(&s.kind));
            assert!((2..=8).contains(&s.text.chars().count()));
        }
    }
}
