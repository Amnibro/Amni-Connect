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
    key: Option<String>,
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
        s if s.len() == 1 => s.chars().next().map(Key::Unicode),
        _ => None,
    }
}
struct Ctl {
    eng: Enigo,
    sw: i32,
    sh: i32,
    errs: u32,
    rebuilds: u32,
    misses: u32,
    direct: bool,
    last: String,
    pending: Option<(i32, i32, Instant)>,
}
impl Ctl {
    fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let eng = Enigo::new(&Settings::default())?;
        let (sw, sh) = eng.main_display().unwrap_or((1920, 1080));
        Ok(Self { eng, sw, sh, errs: 0, rebuilds: 0, misses: 0, direct: false, last: String::new(), pending: None })
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
                let (sw, sh) = self.eng.main_display().unwrap_or((self.sw, self.sh));
                self.sw = sw;
                self.sh = sh;
                self.errs = 0;
                eprintln!("[amni-control] rebuilt enigo #{} display {sw}x{sh}", self.rebuilds);
            }
            Err(e) => {
                eprintln!("[amni-control] enigo rebuild failed {e:?} - exiting for host respawn");
                std::process::exit(2);
            }
        }
    }
    fn status(&self) -> String {
        format!(
            "{{\"type\":\"pong\",\"errs\":{},\"rebuilds\":{},\"misses\":{},\"direct\":{},\"display\":[{},{}],\"last\":{}}}\n",
            self.errs,
            self.rebuilds,
            self.misses,
            self.direct,
            self.sw,
            self.sh,
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
    let (sw, sh) = (c.sw as f64, c.sh as f64);
    match ev.event_type.as_str() {
        "mouse-move" => {
            if let (Some(x), Some(y)) = (ev.x, ev.y) {
                c.move_to((x * sw) as i32, (y * sh) as i32);
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
        "key-down" => {
            if let Some(k) = ev.key.as_deref().and_then(key_from_str) {
                let r = c.eng.key(k, Direction::Press);
                c.note("key-down", r);
            }
        }
        "key-up" => {
            if let Some(k) = ev.key.as_deref().and_then(key_from_str) {
                let r = c.eng.key(k, Direction::Release);
                c.note("key-up", r);
            }
        }
        _ => {}
    }
    c.heal();
    None
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
        eprintln!("[amni-control] v1.5.2 ready display {}x{}", c.sw, c.sh);
    }
    spawn_watchdog(Arc::clone(&ctl));
    let listener = TcpListener::bind("127.0.0.1:7878").await?;
    loop {
        let (stream, _) = listener.accept().await?;
        let ctl = Arc::clone(&ctl);
        tokio::spawn(async move {
            let (r, mut w) = stream.into_split();
            let mut lines = BufReader::new(r).lines();
            while let Ok(Some(line)) = lines.next_line().await {
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
