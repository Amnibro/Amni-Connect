mod wire;
#[cfg(windows)]
mod capture;

use enigo::{Axis, Button, Coordinate, Direction, Enigo, InputError, Key, Keyboard, Mouse, Settings};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
const ERR_LIMIT: u32 = 5;
const REBUILD_LIMIT: u32 = 3;
const LAND_TOL: i32 = 4;
const MISS_DIRECT: u32 = 3;
const MISS_FATAL: u32 = 8;
const SETTLE_MS: u64 = 60;
const STUCK_TICKS: u32 = 5;
#[derive(Serialize, Deserialize, Debug)]
struct InputEvent {
    #[serde(rename = "type")]
    event_type: String,
    x: Option<f64>,
    y: Option<f64>,
    dx: Option<f64>,
    dy: Option<f64>,
    left: Option<f64>,
    top: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    key: Option<String>,
    code: Option<String>,
    room_id: Option<String>,
}
#[cfg(windows)]
fn set_cursor(x: i32, y: i32) -> bool {
    unsafe { windows::Win32::UI::WindowsAndMessaging::SetCursorPos(x, y) }.is_ok()
}
#[cfg(not(windows))]
fn set_cursor(_x: i32, _y: i32) -> bool {
    false
}
fn shift_base(c: char) -> Option<char> {
    match c {
        'A'..='Z' => Some(c.to_ascii_lowercase()),
        '!' => Some('1'),
        '@' => Some('2'),
        '#' => Some('3'),
        '$' => Some('4'),
        '%' => Some('5'),
        '^' => Some('6'),
        '&' => Some('7'),
        '*' => Some('8'),
        '(' => Some('9'),
        ')' => Some('0'),
        '_' => Some('-'),
        '+' => Some('='),
        '{' => Some('['),
        '}' => Some(']'),
        '|' => Some('\\'),
        ':' => Some(';'),
        '"' => Some('\''),
        '<' => Some(','),
        '>' => Some('.'),
        '?' => Some('/'),
        '~' => Some('`'),
        _ => None,
    }
}
fn wants_shift(s: &str) -> bool {
    s.chars().count() == 1 && s.chars().next().and_then(shift_base).is_some()
}
fn key_from_str(s: &str) -> Option<Key> {
    match s {
        "Enter" => Some(Key::Return),
        "Backspace" => Some(Key::Backspace),
        "Tab" => Some(Key::Tab),
        "Escape" => Some(Key::Escape),
        "Delete" => Some(Key::Delete),
        "ArrowUp" => Some(Key::UpArrow),
        "ArrowDown" => Some(Key::DownArrow),
        "ArrowLeft" => Some(Key::LeftArrow),
        "ArrowRight" => Some(Key::RightArrow),
        "Home" => Some(Key::Home),
        "End" => Some(Key::End),
        "PageUp" => Some(Key::PageUp),
        "PageDown" => Some(Key::PageDown),
        "Control" | "Ctrl" => Some(Key::Control),
        "Shift" => Some(Key::Shift),
        "Alt" => Some(Key::Alt),
        "Meta" | "Win" | "Cmd" | "Super" => Some(Key::Meta),
        " " | "Space" => Some(Key::Unicode(' ')),
        "CapsLock" => Some(Key::CapsLock),
        "Insert" => Some(Key::Insert),
        "F1" => Some(Key::F1),
        "F2" => Some(Key::F2),
        "F3" => Some(Key::F3),
        "F4" => Some(Key::F4),
        "F5" => Some(Key::F5),
        "F6" => Some(Key::F6),
        "F7" => Some(Key::F7),
        "F8" => Some(Key::F8),
        "F9" => Some(Key::F9),
        "F10" => Some(Key::F10),
        "F11" => Some(Key::F11),
        "F12" => Some(Key::F12),
        s if s.chars().count() == 1 => s.chars().next().map(|c| Key::Unicode(shift_base(c).unwrap_or(c))),
        s if s.starts_with("Key") && s.len() == 4 => s.chars().nth(3).map(|c| Key::Unicode(c.to_ascii_lowercase())),
        s if s.starts_with("Digit") && s.len() == 6 => s.chars().nth(5).map(Key::Unicode),
        _ => None,
    }
}
struct Ctl {
    eng: Enigo,
    bx: i32,
    by: i32,
    bw: i32,
    bh: i32,
    errs: u32,
    rebuilds: u32,
    misses: u32,
    direct: bool,
    last: String,
    pending: Option<(i32, i32, Instant)>,
    shift_held: bool,
    auto_shift: bool,
}
impl Ctl {
    fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let eng = Enigo::new(&Settings::default())?;
        let (bw, bh) = eng.main_display().unwrap_or((1920, 1080));
        Ok(Self { eng, bx: 0, by: 0, bw, bh, errs: 0, rebuilds: 0, misses: 0, direct: false, last: String::new(), pending: None, shift_held: false, auto_shift: false })
    }
    fn set_bounds(&mut self, bx: i32, by: i32, bw: i32, bh: i32) {
        if bw > 1 && bh > 1 {
            self.bx = bx;
            self.by = by;
            self.bw = bw;
            self.bh = bh;
        }
    }
    fn map_rect(&self) -> (i32, i32, i32, i32) {
        #[cfg(windows)]
        if let Some(b) = capture::stream_bounds() {
            return b;
        }
        (self.bx, self.by, self.bw, self.bh)
    }
    fn shift(&mut self, down: bool, what: &str) {
        let r = self.eng.key(Key::Shift, if down { Direction::Press } else { Direction::Release });
        self.note(what, r);
    }
    fn note(&mut self, what: &str, r: Result<(), InputError>) {
        match r {
            Ok(()) => self.errs = 0,
            Err(e) => {
                let os = std::io::Error::last_os_error();
                self.errs += 1;
                self.last = format!("{what} {e:?} os={:?}", os.raw_os_error());
                eprintln!("[amni-control] ERR #{} {}", self.errs, self.last);
            }
        }
    }
    fn verify(&mut self) {
        let Some((tx, ty, t)) = self.pending else { return };
        if t.elapsed() < Duration::from_millis(SETTLE_MS) {
            return;
        }
        self.pending = None;
        let Ok((cx, cy)) = self.eng.location() else { return };
        if (cx - tx).abs() <= LAND_TOL && (cy - ty).abs() <= LAND_TOL {
            self.misses = 0;
            return;
        }
        self.misses += 1;
        self.last = format!("move did not land target={tx},{ty} cursor={cx},{cy} misses={}", self.misses);
        eprintln!("[amni-control] {}", self.last);
        if self.misses >= MISS_FATAL {
            eprintln!("[amni-control] input not landing after {} misses (direct={}) - exiting for host respawn", self.misses, self.direct);
            std::process::exit(3);
        }
        if self.misses >= MISS_DIRECT && !self.direct {
            self.direct = true;
            eprintln!("[amni-control] switching mouse moves to direct SetCursorPos");
        }
    }
    fn move_to(&mut self, tx: i32, ty: i32) {
        self.verify();
        match self.direct {
            true => {
                let ok = set_cursor(tx, ty);
                self.note("set-cursor", ok.then_some(()).ok_or(InputError::Simulate("SetCursorPos failed")));
            }
            false => {
                let r = self.eng.move_mouse(tx, ty, Coordinate::Abs);
                self.note("move-abs", r);
            }
        }
        self.pending = Some((tx, ty, Instant::now()));
    }
    fn heal(&mut self) {
        if self.errs < ERR_LIMIT {
            return;
        }
        self.rebuilds += 1;
        if self.rebuilds > REBUILD_LIMIT {
            eprintln!("[amni-control] unrecoverable after {REBUILD_LIMIT} rebuilds ({}) - exiting for host respawn", self.last);
            std::process::exit(2);
        }
        match Enigo::new(&Settings::default()) {
            Ok(e) => {
                self.eng = e;
                let (bw, bh) = self.eng.main_display().unwrap_or((self.bw, self.bh));
                self.bw = bw;
                self.bh = bh;
                self.errs = 0;
                eprintln!("[amni-control] rebuilt enigo #{} display {bw}x{bh}", self.rebuilds);
            }
            Err(e) => {
                eprintln!("[amni-control] enigo rebuild failed {e:?} - exiting for host respawn");
                std::process::exit(2);
            }
        }
    }
    fn status(&self) -> String {
        let (bx, by, bw, bh) = self.map_rect();
        format!(
            "{{\"type\":\"pong\",\"errs\":{},\"rebuilds\":{},\"misses\":{},\"direct\":{},\"display\":[{},{}],\"bounds\":[{}, {}, {}, {}],\"last\":{}}}\n",
            self.errs,
            self.rebuilds,
            self.misses,
            self.direct,
            bw,
            bh,
            bx,
            by,
            bw,
            bh,
            serde_json::to_string(&self.last).unwrap_or_else(|_| String::from("\"\""))
        )
    }
}
fn lock_ctl(m: &Arc<Mutex<Ctl>>) -> MutexGuard<'_, Ctl> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}
fn apply(c: &mut Ctl, ev: &InputEvent) -> Option<String> {
    if ev.event_type == "ping" {
        return Some(c.status());
    }
    if ev.event_type == "input-bounds" {
        if let (Some(w), Some(h)) = (ev.width, ev.height) {
            c.set_bounds(
                ev.left.unwrap_or(0.0) as i32,
                ev.top.unwrap_or(0.0) as i32,
                w as i32,
                h as i32,
            );
        }
        return None;
    }
    let (ox, oy, sw, sh) = c.map_rect();
    let (sw, sh) = (sw as f64, sh as f64);
    match ev.event_type.as_str() {
        "mouse-move" => {
            if let (Some(x), Some(y)) = (ev.x, ev.y) {
                c.move_to(ox + (x * sw) as i32, oy + (y * sh) as i32);
            }
        }
        "mouse-move-rel" => {
            if let (Some(dx), Some(dy)) = (ev.dx, ev.dy) {
                let r = c.eng.move_mouse((dx * sw) as i32, (dy * sh) as i32, Coordinate::Rel);
                c.note("move-rel", r);
            }
        }
        "mouse-click" => {
            let r = c.eng.button(Button::Left, Direction::Click);
            c.note("click-left", r);
        }
        "mouse-right-click" => {
            let r = c.eng.button(Button::Right, Direction::Click);
            c.note("click-right", r);
        }
        "mouse-middle-click" => {
            let r = c.eng.button(Button::Middle, Direction::Click);
            c.note("click-middle", r);
        }
        "mouse-down" => {
            let r = c.eng.button(Button::Left, Direction::Press);
            c.note("press-left", r);
        }
        "mouse-up" => {
            let r = c.eng.button(Button::Left, Direction::Release);
            c.note("release-left", r);
        }
        "mouse-scroll" => {
            if let Some(dy) = ev.dy {
                let l = dy as i32;
                if l != 0 {
                    let r = c.eng.scroll(l, Axis::Vertical);
                    c.note("scroll-v", r);
                }
            }
            if let Some(dx) = ev.dx {
                let l = dx as i32;
                if l != 0 {
                    let r = c.eng.scroll(l, Axis::Horizontal);
                    c.note("scroll-h", r);
                }
            }
        }
        "key-down" | "key-up" => {
            let down = ev.event_type == "key-down";
            let raw = ev.key.as_deref().unwrap_or("");
            let mapped = ev.key.as_deref().and_then(key_from_str).or_else(|| ev.code.as_deref().and_then(key_from_str));
            if matches!(mapped, Some(Key::Shift)) {
                c.shift_held = down;
                c.auto_shift = false;
            }
            let need = wants_shift(raw) && !c.shift_held;
            match mapped {
                Some(k) => {
                    if down && need {
                        c.shift(true, "auto-shift-down");
                        c.auto_shift = true;
                    }
                    let r = c.eng.key(k, if down { Direction::Press } else { Direction::Release });
                    c.note(if down { "key-down" } else { "key-up" }, r);
                    if !down && c.auto_shift {
                        c.shift(false, "auto-shift-up");
                        c.auto_shift = false;
                    }
                }
                None => eprintln!("[amni-control] unmapped {} key={:?} code={:?}", ev.event_type, ev.key, ev.code),
            }
        }
        _ => {}
    }
    c.heal();
    None
}
fn capture_command(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let t = v.get("type")?.as_str()?;
    if !matches!(t, "capture-start" | "capture-stop" | "capture-idr" | "capture-status" | "capture-update") {
        return None;
    }
    #[cfg(windows)]
    {
        return Some(capture::command(&v));
    }
    #[cfg(not(windows))]
    {
        Some(format!("{{\"type\":\"capture-status\",\"ok\":false,\"reason\":\"unsupported\"}}\n"))
    }
}

fn spawn_watchdog(ctl: Arc<Mutex<Ctl>>) {
    std::thread::spawn(move || {
        let mut stuck = 0;
        loop {
            std::thread::sleep(Duration::from_secs(2));
            stuck = match ctl.try_lock() {
                Err(TryLockError::WouldBlock) => stuck + 1,
                _ => 0,
            };
            if stuck >= STUCK_TICKS {
                eprintln!("[amni-control] input lock held {}s - blocked inside the OS input call, exiting for host respawn", stuck * 2);
                std::process::exit(4);
            }
        }
    });
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::new().filter_level(log::LevelFilter::Error).parse_default_env().init();
    let ctl = Arc::new(Mutex::new(Ctl::new()?));
    {
        let c = lock_ctl(&ctl);
        eprintln!("[amni-control] v1.5.7 ready display {}x{}", c.bw, c.bh);
    }
    spawn_watchdog(Arc::clone(&ctl));
    #[cfg(windows)]
    capture::spawn();
    let listener = TcpListener::bind("127.0.0.1:7878").await?;
    loop {
        let (stream, _) = listener.accept().await?;
        let ctl = Arc::clone(&ctl);
        tokio::spawn(async move {
            let (r, mut w) = stream.into_split();
            let mut lines = BufReader::new(r).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(reply) = capture_command(&line) {
                    if w.write_all(reply.as_bytes()).await.is_err() {
                        break;
                    }
                    continue;
                }
                let Ok(ev) = serde_json::from_str::<InputEvent>(&line) else { continue };
                let reply = {
                    let mut c = lock_ctl(&ctl);
                    apply(&mut c, &ev)
                };
                if let Some(m) = reply {
                    if w.write_all(m.as_bytes()).await.is_err() {
                        break;
                    }
                }
            }
        });
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_laptop_keys() {
        assert!(matches!(key_from_str("Space"), Some(Key::Unicode(' '))));
        assert!(matches!(key_from_str(" "), Some(Key::Unicode(' '))));
        assert!(matches!(key_from_str("a"), Some(Key::Unicode('a'))));
        assert!(matches!(key_from_str("KeyA"), Some(Key::Unicode('a'))));
        assert!(matches!(key_from_str("Digit7"), Some(Key::Unicode('7'))));
        assert!(matches!(key_from_str("Enter"), Some(Key::Return)));
        assert!(matches!(key_from_str("F12"), Some(Key::F12)));
        assert!(key_from_str("Unidentified").is_none());
    }
    #[test]
    fn shifted_chars_resolve_to_their_physical_key() {
        assert!(matches!(key_from_str("A"), Some(Key::Unicode('a'))));
        assert!(matches!(key_from_str("Z"), Some(Key::Unicode('z'))));
        assert!(matches!(key_from_str("!"), Some(Key::Unicode('1'))));
        assert!(matches!(key_from_str("?"), Some(Key::Unicode('/'))));
        assert!(matches!(key_from_str(":"), Some(Key::Unicode(';'))));
        assert!(matches!(key_from_str("~"), Some(Key::Unicode('`'))));
        assert!(matches!(key_from_str("1"), Some(Key::Unicode('1'))));
        assert!(matches!(key_from_str("/"), Some(Key::Unicode('/'))));
    }
    #[test]
    fn only_shifted_chars_ask_for_shift() {
        assert!(wants_shift("A"));
        assert!(wants_shift("!"));
        assert!(wants_shift("?"));
        assert!(!wants_shift("a"));
        assert!(!wants_shift("1"));
        assert!(!wants_shift("Shift"));
        assert!(!wants_shift("KeyA"));
        assert!(!wants_shift("Enter"));
    }
}
