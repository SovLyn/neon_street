use serde::Serialize;

use super::{noise, rng::Rng};

const PI: f32 = std::f32::consts::PI;
const HALF_PI: f32 = std::f32::consts::FRAC_PI_2;
const TAN_CAMERA_HALF_FOV: f32 = 0.4452287; // tan(24°) — matches the 48° FOV in web/src/main.ts

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
    pub hero: bool,
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

fn facade_normal(yaw: f32) -> (f32, f32) {
    if yaw == HALF_PI {
        (1.0, 0.0)
    } else if yaw == -HALF_PI {
        (-1.0, 0.0)
    } else if yaw == PI {
        (0.0, -1.0)
    } else {
        (0.0, 1.0)
    }
}

// Building meshes are rotated by the renderer, while street_facade describes
// the unrotated parcel. Use the rendered footprint for hero signs only.
fn hero_facade(b: &Building) -> (f32, f32, f32, f32) {
    let mut footprint = b.clone();
    if b.rot_y == HALF_PI || b.rot_y == PI + HALF_PI {
        std::mem::swap(&mut footprint.w, &mut footprint.d);
    }
    let (x, z, rot_y) = street_facade(&footprint);
    let width = if rot_y.abs() == HALF_PI {
        footprint.d
    } else {
        footprint.w
    };
    (x, z, rot_y, width)
}

// Include the renderer's 0.2m backing border and 0.14m-deep cabinet. On the
// same facade also reject projected overlap, even if the cabinets have
// different offsets from the wall.
fn sign_boards_overlap(a: &Sign, b: &Sign) -> bool {
    if (a.y - b.y).abs() >= (a.h + b.h) * 0.5 + 0.2 {
        return false;
    }
    if a.building_id == b.building_id {
        let distance = if a.rot_y.abs() == HALF_PI {
            (a.z - b.z).abs()
        } else {
            (a.x - b.x).abs()
        };
        return distance < (a.w + b.w) * 0.5 + 0.2;
    }
    let extents = |s: &Sign| {
        if s.rot_y.abs() == HALF_PI {
            (0.145, s.w * 0.5 + 0.1)
        } else {
            (s.w * 0.5 + 0.1, 0.145)
        }
    };
    let (ax, az) = extents(a);
    let (bx, bz) = extents(b);
    (a.x - b.x).abs() < ax + bx && (a.z - b.z).abs() < az + bz
}

// Check the whole sign against the requested camera (16:9) and sample its
// surface for occlusion by other rendered building footprints.
// Must match the default camera in web/src/scene/index.ts (cameraHome).
const HERO_CAMERA: [f32; 3] = [24.0, 7.0, 26.0];
const HERO_TARGET: [f32; 3] = [-6.0, 6.0, -10.0];

fn hero_visible_from_camera(sign: &Sign, buildings: &[Building]) -> bool {
    let camera = HERO_CAMERA;
    let (normal_x, normal_z) = facade_normal(sign.rot_y);
    if normal_x * (camera[0] - sign.x) + normal_z * (camera[2] - sign.z) <= 0.0 {
        return false;
    }
    let hx = HERO_TARGET[0] - camera[0];
    let hz = HERO_TARGET[2] - camera[2];
    let horizontal_len = (hx * hx + hz * hz).sqrt();
    let vy = HERO_TARGET[1] - camera[1];
    let direction_len = (horizontal_len * horizontal_len + vy * vy).sqrt();
    let forward = [hx / direction_len, vy / direction_len, hz / direction_len];
    let right = [-hz / horizontal_len, 0.0, hx / horizontal_len];
    let up = [
        -right[2] * forward[1],
        right[2] * forward[0] - right[0] * forward[2],
        right[0] * forward[1],
    ];
    for horizontal in [-0.5, 0.0, 0.5] {
        for vertical in [-0.5, 0.0, 0.5] {
            let point = [
                sign.x + normal_z * sign.w * horizontal,
                sign.y + sign.h * vertical,
                sign.z - normal_x * sign.w * horizontal,
            ];
            let ray = [
                point[0] - camera[0],
                point[1] - camera[1],
                point[2] - camera[2],
            ];
            let dot = |axis: [f32; 3]| ray[0] * axis[0] + ray[1] * axis[1] + ray[2] * axis[2];
            let depth = dot(forward);
            if depth <= 0.0 {
                return false;
            }
            let ndc_x = dot(right) / (depth * TAN_CAMERA_HALF_FOV * 16.0 / 9.0);
            let ndc_y = dot(up) / (depth * TAN_CAMERA_HALF_FOV);
            if ndc_x.abs() >= 0.96 || ndc_y.abs() >= 0.96 {
                return false;
            }
            for building in buildings.iter().filter(|b| b.id != sign.building_id) {
                let (w, d) = if building.rot_y == HALF_PI || building.rot_y == PI + HALF_PI {
                    (building.d, building.w)
                } else {
                    (building.w, building.d)
                };
                let min = [building.x - w * 0.5, 0.22, building.z - d * 0.5];
                let max = [
                    building.x + w * 0.5,
                    building.h + 0.22,
                    building.z + d * 0.5,
                ];
                let mut enter: f32 = 0.0;
                let mut exit: f32 = 1.0;
                for axis in 0..3 {
                    if ray[axis].abs() < 1e-6 {
                        if camera[axis] < min[axis] || camera[axis] > max[axis] {
                            exit = -1.0;
                            break;
                        }
                    } else {
                        let a = (min[axis] - camera[axis]) / ray[axis];
                        let b = (max[axis] - camera[axis]) / ray[axis];
                        enter = enter.max(a.min(b));
                        exit = exit.min(a.max(b));
                    }
                }
                if enter < exit {
                    return false;
                }
            }
        }
    }
    true
}

type HeroOption = Vec<(usize, Sign)>;

fn hero_options(
    signs: &[Sign],
    building_id: usize,
    indices: &[usize],
    candidates: &[Vec<Sign>],
) -> Vec<HeroOption> {
    let mut options = Vec::new();
    for (n, positions) in candidates.iter().enumerate() {
        for sign in positions {
            if signs.iter().all(|other| {
                other.building_id != building_id
                    || other.id == indices[n]
                    || !sign_boards_overlap(sign, other)
            }) {
                options.push(vec![(indices[n], sign.clone())]);
            }
        }
    }
    if candidates.len() == 2 {
        for a in &candidates[0] {
            for b in &candidates[1] {
                if !sign_boards_overlap(a, b) {
                    options.push(vec![(indices[0], a.clone()), (indices[1], b.clone())]);
                }
            }
        }
    }
    options
}

fn choose_heroes(
    groups: &[Vec<HeroOption>],
    group: usize,
    remaining: usize,
    pairs_left: usize,
    signs: &mut [Sign],
) -> bool {
    if remaining == 0 {
        return true;
    }
    if group == groups.len() || (groups.len() - group) * 2 < remaining {
        return false;
    }
    for option in &groups[group] {
        if option.len() > remaining
            || (option.len() == 2 && pairs_left == 0)
            || option.iter().any(|(_, candidate)| {
                signs
                    .iter()
                    .any(|placed| placed.hero && sign_boards_overlap(candidate, placed))
            })
        {
            continue;
        }
        let original: Vec<_> = option
            .iter()
            .map(|(i, _)| (*i, signs[*i].clone()))
            .collect();
        for (i, candidate) in option {
            signs[*i] = candidate.clone();
        }
        if choose_heroes(
            groups,
            group + 1,
            remaining - option.len(),
            pairs_left - usize::from(option.len() == 2),
            signs,
        ) {
            return true;
        }
        for (i, sign) in original {
            signs[i] = sign;
        }
    }
    choose_heroes(groups, group + 1, remaining, pairs_left, signs)
}

fn place_hero_signs(
    buildings: &[Building],
    signs: &mut [Sign],
    rng: &mut Rng,
    texts: &[&'static str],
) {
    let short_texts: Vec<_> = texts
        .iter()
        .copied()
        .filter(|text| {
            if text.is_ascii() {
                text.len() <= 5
            } else {
                text.chars().count() <= 2
            }
        })
        .collect();
    let mut order: Vec<_> = buildings.iter().collect();
    let priority = |b: &Building| {
        let (x, z, yaw, _) = hero_facade(b);
        let dx = x - HERO_CAMERA[0];
        let dz = z - HERO_CAMERA[2];
        let (normal_x, normal_z) = facade_normal(yaw);
        let distance = (dx * dx + dz * dz).sqrt().max(0.001);
        // How squarely the facade faces the camera: a grazing wall looks like a sliver on screen.
        let facing = (-normal_x * dx - normal_z * dz) / distance;
        let front = facing > 0.0;
        // Projection onto the default camera's horizontal view direction (16:9).
        let fx = HERO_TARGET[0] - HERO_CAMERA[0];
        let fz = HERO_TARGET[2] - HERO_CAMERA[2];
        let depth = fx * dx + fz * dz;
        let lateral = fz * dx - fx * dz;
        let in_view = depth > 0.0
            && lateral.abs() <= depth * TAN_CAMERA_HALF_FOV * 16.0 / 9.0;
        // Roughly where a sign at eye level lands on screen: keep landmarks out from
        // behind the control dock in the bottom-left corner of the default frame.
        let fx_len = (fx * fx + fz * fz).sqrt();
        let ahead = (fx * dx + fz * dz) / fx_len.max(0.001);
        let ndc_x = if ahead > 1.0 { lateral / (ahead * TAN_CAMERA_HALF_FOV * 16.0 / 9.0) } else { 0.0 };
        let ndc_y = if ahead > 1.0 { -1.0 / (ahead * TAN_CAMERA_HALF_FOV) } else { 0.0 };
        let behind_hud = ndc_x < -0.33 && ndc_y < 0.42;
        (
            if facing > 0.45 && in_view && !behind_hud {
                0
            } else if facing > 0.45 && in_view {
                1
            } else if front && in_view {
                2
            } else if front {
                2
            } else {
                3
            },
            x * x + z * z,
        )
    };
    order.sort_by(|a, b| {
        let a = priority(a);
        let b = priority(b);
        a.0.cmp(&b.0).then_with(|| a.1.total_cmp(&b.1))
    });
    let visible_count = order.iter().take_while(|b| priority(b).0 == 0).count();
    let near_count = order
        .iter()
        .take_while(|b| {
            let (tier, distance_squared) = priority(b);
            tier == 0 && distance_squared <= 50.0 * 50.0
        })
        .count();

    let mut groups = Vec::new();
    let mut visible_groups = Vec::new();
    for b in order {
        let (x, z, rot_y, facade_width) = hero_facade(b);
        let indices: Vec<_> = signs
            .iter()
            .filter(|sign| sign.building_id == b.id)
            .map(|sign| sign.id)
            .collect();
        let mut candidates = Vec::new();
        let mut visible_candidates = Vec::new();
        for &i in &indices {
            let mut sign = signs[i].clone();
            sign.hero = true;
            sign.kind = "horizontal";
            sign.text = short_texts[rng.next_u32() as usize % short_texts.len()];
            sign.x = x;
            sign.z = z;
            sign.rot_y = rot_y;
            // Small facades may overhang by up to 1m, but both brackets remain
            // on the wall; larger signs stay within the facade's width.
            sign.w = rng.range(13.0, (facade_width - 0.2).clamp(13.0, 16.0)).max(12.5);
            sign.h = rng.range(2.4, 3.6);
            let max_y = (b.h - 1.0 - sign.h * 0.5 - 0.1).min(12.0);
            let mut positions = Vec::new();
            let mut visible_positions = Vec::new();
            for y in [8.5, 6.0, 10.5, 7.0, 9.0, 11.5, 12.0, max_y] {
                if y < 6.0 || y > max_y {
                    continue;
                }
                sign.y = y;
                if signs
                    .iter()
                    .all(|other| other.building_id == b.id || !sign_boards_overlap(&sign, other))
                {
                    if hero_visible_from_camera(&sign, buildings) {
                        visible_positions.push(sign.clone());
                    }
                    positions.push(sign.clone());
                }
            }
            candidates.push(positions);
            visible_candidates.push(visible_positions);
        }
        groups.push(hero_options(signs, b.id, &indices, &candidates));
        visible_groups.push(hero_options(signs, b.id, &indices, &visible_candidates));
    }
    // One hero per facade: four landmarks spread across the block read better than
    // two stacked boards on one wall. Widen the search only if that is impossible.
    let mut found = choose_heroes(&visible_groups[..near_count.min(visible_groups.len())], 0, 4, 0, signs);
    if !found {
        found = choose_heroes(&visible_groups[..visible_count.min(visible_groups.len())], 0, 4, 0, signs);
    }
    if !found {
        found = choose_heroes(&visible_groups, 0, 4, 0, signs);
    }
    if !found {
        found = choose_heroes(&groups, 0, 4, 0, signs);
    }
    assert!(found, "four hero signs must fit");

    // Avoid repeated hero labels without inventing vocabulary or sacrificing
    // seed-driven sampling. Ordinary signs may still repeat naturally.
    let mut used = Vec::new();
    for sign in signs.iter_mut().filter(|sign| sign.hero) {
        if used.contains(&sign.text) {
            let available: Vec<_> = short_texts
                .iter()
                .copied()
                .filter(|s| !used.contains(s))
                .collect();
            sign.text = available[rng.next_u32() as usize % available.len()];
        }
        used.push(sign.text);
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
        for _ in 0..if b.id < 8 { 2 } else { 1 } {
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
                text: texts[rng.next_u32() as usize % texts.len()],
                hero: false,
                x,
                y,
                z,
                w,
                h,
                rot_y,
                color_index: rng.next_u32() % 4,
                font: fonts[rng.next_u32() as usize % fonts.len()],
                building_id: b.id,
            });
        }
    }
    place_hero_signs(&buildings, &mut signs, &mut rng, &texts);

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
            let (w, d) = if s.hero && (b.rot_y == HALF_PI || b.rot_y == PI + HALF_PI) {
                (b.d, b.w)
            } else {
                (b.w, b.d)
            };
            let outside_x = (s.x - b.x).abs() >= w * 0.5 + 0.2;
            let outside_z = (s.z - b.z).abs() >= d * 0.5 + 0.2;
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
    fn hero_signs_are_sized_attached_and_clear_across_seeds() {
        for seed in (0..512).chain([20240917, u32::MAX]) {
            let layout = generate(seed);
            let heroes: Vec<_> = layout.signs.iter().filter(|s| s.hero).collect();
            assert_eq!(heroes.len(), 4, "seed {seed}");
            for hero in heroes {
                let building = &layout.buildings[hero.building_id];
                let (x, z, yaw, facade_width) = hero_facade(building);
                assert_eq!(hero.kind, "horizontal");
                assert!((10.0..=16.0).contains(&hero.w));
                assert!((2.4..=3.6).contains(&hero.h));
                assert!((6.0..=12.0).contains(&hero.y));
                assert!(hero.y > 2.0 && hero.y < building.h);
                assert!(hero.y + hero.h * 0.5 + 0.1 <= building.h - 1.0 + 0.0001);
                assert_eq!((hero.x, hero.z, hero.rot_y), (x, z, yaw));
                let (w, d) = if building.rot_y == HALF_PI || building.rot_y == PI + HALF_PI {
                    (building.d, building.w)
                } else {
                    (building.w, building.d)
                };
                let clearance = if hero.rot_y.abs() == HALF_PI {
                    (hero.x - building.x).abs() - w * 0.5
                } else {
                    (hero.z - building.z).abs() - d * 0.5
                };
                assert!(clearance > 0.145, "cabinet intersects its building");
                assert!(hero.w * 0.68 < facade_width, "brackets must meet the wall");
                assert!(if hero.text.is_ascii() {
                    hero.text.len() <= 5
                } else {
                    hero.text.chars().count() <= 2
                });
                for other in layout.signs.iter().filter(|s| s.id != hero.id) {
                    assert!(
                        !sign_boards_overlap(hero, other),
                        "seed {seed}: hero {} overlaps sign {}",
                        hero.id,
                        other.id
                    );
                }
            }
            for (i, sign) in layout.signs.iter().enumerate() {
                assert_eq!(sign.id, i);
                assert!(sign.x.abs() < 120.0 && sign.z.abs() < 120.0);
                assert!((layout.bounds.min_x..layout.bounds.max_x).contains(&sign.x));
                assert!((layout.bounds.min_z..layout.bounds.max_z).contains(&sign.z));
                if !sign.hero {
                    let (width, height) = match sign.kind {
                        "horizontal" => (5.0..=10.0, 1.4..=2.2),
                        "vertical" => (1.6..=2.4, 4.0..=8.0),
                        "rooftop" => (8.0..=14.0, 1.6..=3.0),
                        "blade" => (2.0..=3.2, 2.2..=4.2),
                        _ => panic!("unexpected sign kind"),
                    };
                    assert!(width.contains(&sign.w) && height.contains(&sign.h));
                }
            }
        }
    }

    #[test]
    fn default_camera_can_see_hero_signs() {
        // Product requirement: the first frame shows landmarks, not a distant skyline.
        for seed in (0_u32..512)
            .chain((0_u32..1024).map(|i| i.wrapping_mul(0x9e3779b9)))
            .chain([20240917, u32::MAX])
        {
            let layout = generate(seed);
            let camera = HERO_CAMERA;
            let hx = HERO_TARGET[0] - camera[0];
            let hz = HERO_TARGET[2] - camera[2];
            let vy = HERO_TARGET[1] - camera[1];
            let horizontal_len = (hx * hx + hz * hz).sqrt();
            let direction_len = (horizontal_len * horizontal_len + vy * vy).sqrt();
            let forward = [hx / direction_len, vy / direction_len, hz / direction_len];
            let right = [-hz / horizontal_len, 0.0, hx / horizontal_len];
            let up = [
                -right[2] * forward[1],
                right[2] * forward[0] - right[0] * forward[2],
                right[0] * forward[1],
            ];
            let tan_half_fov = 24.0_f32.to_radians().tan();
            let mut on_screen = 0;
            for hero in layout.signs.iter().filter(|s| s.hero) {
                let (nx, nz) = facade_normal(hero.rot_y);
                assert!(
                    nx * (camera[0] - hero.x) + nz * (camera[2] - hero.z) > 0.0,
                    "seed {seed}: hero {} faces away from the camera",
                    hero.id
                );
                let point = [hero.x, hero.y, hero.z];
                let ray = [
                    point[0] - camera[0],
                    point[1] - camera[1],
                    point[2] - camera[2],
                ];
                let dot = |axis: [f32; 3]| ray[0] * axis[0] + ray[1] * axis[1] + ray[2] * axis[2];
                let depth = dot(forward);
                assert!(depth > 0.0, "seed {seed}: hero {} is behind the camera", hero.id);
                let ndc_x = dot(right) / (depth * tan_half_fov * 16.0 / 9.0);
                let ndc_y = dot(up) / (depth * tan_half_fov);
                if ndc_x.abs() < 1.0 && ndc_y.abs() < 1.0 {
                    on_screen += 1;
                }
            }
            assert!(
                on_screen >= 3,
                "seed {seed}: only {on_screen}/4 hero signs are inside the default view"
            );
        }
    }

    #[test]
    fn sign_text_font_and_color_are_seed_driven() {
        let first = generate(1);
        let second = generate(2);
        assert_ne!(
            first.signs.iter().map(|s| s.text).collect::<Vec<_>>(),
            second.signs.iter().map(|s| s.text).collect::<Vec<_>>()
        );
        assert_ne!(
            first.signs.iter().map(|s| s.font).collect::<Vec<_>>(),
            second.signs.iter().map(|s| s.font).collect::<Vec<_>>()
        );
        assert_ne!(
            first
                .signs
                .iter()
                .map(|s| s.color_index)
                .collect::<Vec<_>>(),
            second
                .signs
                .iter()
                .map(|s| s.color_index)
                .collect::<Vec<_>>()
        );
        let json = serde_json::to_vec(&first).unwrap();
        assert_eq!(json, serde_json::to_vec(&generate(1)).unwrap());
        let value: serde_json::Value = serde_json::from_slice(&json).unwrap();
        for (sign, serialized) in first.signs.iter().zip(value["signs"].as_array().unwrap()) {
            assert_eq!(serialized["hero"].as_bool(), Some(sign.hero));
        }
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
