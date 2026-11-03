#[derive(Clone)]
pub struct Rng { state: u64 }
impl Rng {
    pub fn new(seed: u32) -> Self { Self { state: (seed as u64) + 0x9e3779b97f4a7c15 } }
    pub fn next_u32(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        (z ^ (z >> 31)) as u32
    }
    pub fn f32(&mut self) -> f32 { (self.next_u32() >> 8) as f32 / 16777216.0 }
    pub fn range(&mut self, a: f32, b: f32) -> f32 { a + (b - a) * self.f32() }
    pub fn chance(&mut self, p: f32) -> bool { self.f32() < p }
}
pub fn hash_u32(mut x: u32) -> u32 {
    x ^= x >> 16; x = x.wrapping_mul(0x7feb352d); x ^= x >> 15;
    x = x.wrapping_mul(0x846ca68b); x ^ (x >> 16)
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn deterministic_rng() { let mut a=Rng::new(4); let mut b=Rng::new(4); for _ in 0..100 { assert_eq!(a.next_u32(),b.next_u32()); } }
    #[test] fn rng_range() { let mut r=Rng::new(5); for _ in 0..100 { assert!((2.0..4.0).contains(&r.range(2.0,4.0))); } }
}
