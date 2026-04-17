use enigo::{Enigo, Mouse, Keyboard, Button, Direction, Coordinate, Key, Settings, Axis};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tokio::io::{AsyncBufReadExt, BufReader};
use serde::{Deserialize, Serialize};

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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let enigo = Arc::new(Mutex::new(Enigo::new(&Settings::default())?));
    let (sw, sh) = enigo.lock().unwrap().main_display().unwrap_or((1920, 1080));
    let listener = TcpListener::bind("127.0.0.1:7878").await?;

    loop {
        let (stream, _) = listener.accept().await?;
        let enigo_clone = Arc::clone(&enigo);
        tokio::spawn(async move {
            let reader = BufReader::new(stream);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(event) = serde_json::from_str::<InputEvent>(&line) else { continue };
                let Ok(mut eng) = enigo_clone.lock() else { continue };
                match event.event_type.as_str() {
                    "mouse-move" => {
                        if let (Some(x), Some(y)) = (event.x, event.y) {
                            let _ = eng.move_mouse((x * sw as f64) as i32, (y * sh as f64) as i32, Coordinate::Abs);
                        }
                    }
                    "mouse-move-rel" => {
                        if let (Some(dx), Some(dy)) = (event.dx, event.dy) {
                            let _ = eng.move_mouse((dx * sw as f64) as i32, (dy * sh as f64) as i32, Coordinate::Rel);
                        }
                    }
                    "mouse-click" => { let _ = eng.button(Button::Left, Direction::Click); }
                    "mouse-right-click" => { let _ = eng.button(Button::Right, Direction::Click); }
                    "mouse-middle-click" => { let _ = eng.button(Button::Middle, Direction::Click); }
                    "mouse-down" => { let _ = eng.button(Button::Left, Direction::Press); }
                    "mouse-up" => { let _ = eng.button(Button::Left, Direction::Release); }
                    "mouse-scroll" => {
                        if let Some(dy) = event.dy {
                            let lines = dy as i32;
                            if lines != 0 { let _ = eng.scroll(lines, Axis::Vertical); }
                        }
                        if let Some(dx) = event.dx {
                            let cols = dx as i32;
                            if cols != 0 { let _ = eng.scroll(cols, Axis::Horizontal); }
                        }
                    }
                    "key-down" => {
                        if let Some(k) = event.key.as_deref().and_then(key_from_str) {
                            let _ = eng.key(k, Direction::Press);
                        }
                    }
                    "key-up" => {
                        if let Some(k) = event.key.as_deref().and_then(key_from_str) {
                            let _ = eng.key(k, Direction::Release);
                        }
                    }
                    _ => {}
                }
            }
        });
    }
}

