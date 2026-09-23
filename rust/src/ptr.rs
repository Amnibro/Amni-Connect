#[cfg(target_os = "linux")]
use evdev::{uinput::{VirtualDevice, VirtualDeviceBuilder}, AbsInfo, AbsoluteAxisType as A, AttributeSet, EventType as T, InputEvent as E, Key as K, RelativeAxisType as R, UinputAbsSetup};
#[cfg(target_os = "linux")]
pub struct Ptr { d: Option<VirtualDevice>, m: Option<VirtualDevice>, w: i32, h: i32 }
#[cfg(target_os = "linux")]
impl Ptr {
    pub fn new(w: i32, h: i32) -> Self {
        let keys = || { let mut k = AttributeSet::<K>::new(); [K::BTN_LEFT, K::BTN_RIGHT, K::BTN_MIDDLE].iter().for_each(|b| k.insert(*b)); k };
        let mk = || -> std::io::Result<VirtualDevice> { VirtualDeviceBuilder::new()?.name("Amni-Connect pointer").with_keys(&keys())?.with_absolute_axis(&UinputAbsSetup::new(A::ABS_X, AbsInfo::new(0, 0, w.max(2) - 1, 0, 0, 1)))?.with_absolute_axis(&UinputAbsSetup::new(A::ABS_Y, AbsInfo::new(0, 0, h.max(2) - 1, 0, 0, 1)))?.build() };
        let mw = || -> std::io::Result<VirtualDevice> { let mut r = AttributeSet::<R>::new(); [R::REL_X, R::REL_Y, R::REL_WHEEL, R::REL_HWHEEL].iter().for_each(|a| r.insert(*a)); VirtualDeviceBuilder::new()?.name("Amni-Connect wheel").with_keys(&keys())?.with_relative_axes(&r)?.build() };
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some() || std::env::var("XDG_SESSION_TYPE").map(|s| s == "wayland").unwrap_or(false);
        let use_ui = wayland && std::env::var_os("AMNI_NO_UINPUT").is_none();
        let d = if use_ui { mk().map_err(|e| eprintln!("[amni-control] uinput pointer unavailable ({e}) - using enigo")).ok() } else { None };
        let m = if d.is_some() { mw().map_err(|e| eprintln!("[amni-control] uinput wheel unavailable ({e}) - using enigo")).ok() } else { None };
        d.as_ref().map(|_| eprintln!("[amni-control] uinput absolute pointer {w}x{h} wheel={}", m.is_some()));
        Self { d, m, w, h }
    }
    fn emit(&mut self, ev: &[E]) -> bool { self.d.as_mut().map(|d| d.emit(ev).is_ok()).unwrap_or(false) }
    fn emit_m(&mut self, ev: &[E]) -> bool { self.m.as_mut().map(|d| d.emit(ev).is_ok()).unwrap_or(false) }
    pub fn abs(&mut self, x: i32, y: i32, sw: i32, sh: i32) -> bool {
        let (x, y) = (((x as i64 * self.w as i64) / sw.max(1) as i64).clamp(0, self.w as i64 - 1) as i32, ((y as i64 * self.h as i64) / sh.max(1) as i64).clamp(0, self.h as i64 - 1) as i32);
        self.emit(&[E::new(T::ABSOLUTE, A::ABS_X.0, x), E::new(T::ABSOLUTE, A::ABS_Y.0, y)])
    }
    pub fn btn(&mut self, b: u8, v: Option<bool>) -> bool {
        let c = [K::BTN_LEFT, K::BTN_RIGHT, K::BTN_MIDDLE][b as usize % 3].code();
        match v { Some(p) => self.emit(&[E::new(T::KEY, c, p as i32)]), None => self.emit(&[E::new(T::KEY, c, 1)]) && self.emit(&[E::new(T::KEY, c, 0)]) }
    }
    pub fn wheel(&mut self, v: i32, h: i32) -> bool {
        let ev: Vec<E> = [(R::REL_WHEEL.0, -v), (R::REL_HWHEEL.0, h)].iter().filter(|(_, n)| *n != 0).map(|(a, n)| E::new(T::RELATIVE, *a, *n)).collect();
        ev.is_empty() || self.emit_m(&ev)
    }
}
#[cfg(not(target_os = "linux"))]
pub struct Ptr;
#[cfg(not(target_os = "linux"))]
impl Ptr {
    pub fn new(_w: i32, _h: i32) -> Self { Self }
    pub fn abs(&mut self, _x: i32, _y: i32, _sw: i32, _sh: i32) -> bool { false }
    pub fn btn(&mut self, _b: u8, _v: Option<bool>) -> bool { false }
    pub fn wheel(&mut self, _v: i32, _h: i32) -> bool { false }
}
