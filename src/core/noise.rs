use super::rng::hash_u32;
fn point(x:i32,z:i32,seed:u32)->f32 { hash_u32((x as u32).wrapping_mul(0x9e3779b9) ^ (z as u32).wrapping_mul(0x85ebca6b) ^ seed) as f32 / u32::MAX as f32 }
fn smooth(t:f32)->f32 { t*t*(3.0-2.0*t) }
fn mix(a:f32,b:f32,t:f32)->f32 { a+(b-a)*t }
pub fn value1(x:f32,seed:u32)->f32 { let i=x.floor() as i32; mix(point(i,0,seed),point(i.wrapping_add(1),0,seed),smooth(x-x.floor())) }
pub fn value2(x:f32,z:f32,seed:u32)->f32 { let ix=x.floor() as i32; let iz=z.floor() as i32; let u=smooth(x-x.floor()); let v=smooth(z-z.floor()); mix(mix(point(ix,iz,seed),point(ix.wrapping_add(1),iz,seed),u),mix(point(ix,iz.wrapping_add(1),seed),point(ix.wrapping_add(1),iz.wrapping_add(1),seed),u),v) }
pub fn fbm2(x:f32,z:f32,seed:u32)->f32 { (value2(x,z,seed)+0.5*value2(x*2.0,z*2.0,seed)+0.25*value2(x*4.0,z*4.0,seed))/1.75 }
#[cfg(test)] mod tests { use super::*; #[test] fn noise_deterministic_bounded() { for i in -20..20 { let v=fbm2(i as f32*0.1,0.2,3); assert!((0.0..=1.0).contains(&v)); assert_eq!(v,fbm2(i as f32*0.1,0.2,3)); } assert!((0.0..=1.0).contains(&value1(0.5,1))); } }
