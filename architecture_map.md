# Amni-Connect Architecture Map

## 2026-08-16 v1.5.2 zoom input gate + daemon wedge instrumentation
- **Pinch to zoom killed all pointer control.** `viewer.html` `touchmove` routed the normal
  single-finger branch to a *local pan* whenever `currentZoom > 1.05`, so once you pinched, a
  one-finger drag moved the **view** and sent **no `mouse-move` at all**. Taps still worked
  (never gated), which is why it read as "it's laggy / it's ignoring me" rather than "zoom broke
  it". Two-finger drag already pans when zoomed, so single-finger panning was redundant.
  Gesture map is now unambiguous: **1 finger = control, 2 fingers = zoom/pan, 3 fingers = scroll**.
- `#touch-overlay` is **inside** `#zoom-container`, so `getBoundingClientRect()` already reflects
  the zoom/pan transform — `screenCoord` needs no inverse transform, and coordinates were never
  the problem. Do not "fix" screenCoord for zoom.
- **The daemon can wedge while alive** — separately observed and reproduced: `amni-control.exe`
  listening on `:7878`, accepting connections, Electron ESTABLISHED to it, every event parsed,
  and the cursor frozen. v1.5.1 only heals a **dead** daemon; a wedged one passes every check
  (TCP connects, writes succeed, socket never closes) so `scheduleReconnect` never fires.
- **Why it was invisible:** enigo reports the real OS error through the `log` crate
  (`error!("{last_err}")` inside `send_input`) and `main.rs` never installed a logger — on top of
  `let _ = eng...` discarding every `Result`. `amni-control.log` was empty because nothing could
  ever write to it. It now runs `env_logger` and logs every `Err` plus `last_os_error()`.
- Daemon escalation ladder: enigo `move_mouse` → cursor **read back** to confirm it landed →
  direct `SetCursorPos` after 3 misses → rebuild `Enigo` after 5 errors → `exit` after 8 misses /
  3 rebuilds so the (proven) host respawn takes over. Poisoned mutex can no longer kill input
  permanently (`unwrap_or_else(|e| e.into_inner())`), and a watchdog thread exits the process if
  the input lock is held >10s (blocked inside the OS call).
- New `{"type":"ping"}` → `pong` with `errs/rebuilds/misses/direct/display/last`. `main.js` pings
  every 5s and calls `restartRust()` if no pong arrives in 15s (20s cooldown, `taskkill /IM` so it
  can also clear a wedged daemon it did not spawn).

## 2026-08-16 v1.5.1 rust-respawn
- `amni-control.exe` dying mid-session was a silent, permanent outage: `spawnRust()`'s spawn
  decision only ran once at Electron startup (probe `:7878`, spawn only if nothing answers).
  If the process it found (or spawned) later died, `scheduleReconnect()` kept retrying the bare
  TCP connect forever with no code path back to launching the binary. Input (touch *and* mouse)
  looked "not implemented" but was actually vanishing at the last hop — everything upstream
  (touch handlers, data channel, relay, IPC) worked fine.
- Now `trySpawnRust()` (5s cooldown, skips if `rustProcess.exitCode === null` i.e. still alive)
  runs from inside `scheduleReconnect()` on every failed cycle, not just the startup probe.
- ~~**Verification limit:** this tool environment cannot move the real OS cursor.~~
  **WRONG — corrected 2026-08-16 (v1.5.2).** A PowerShell `SetCursorPos` P/Invoke from this exact
  shell moved the physical cursor (2104,839 → 700,700) at the same moment `amni-control` could not.
  Cursor position is therefore fully scriptable from here — read *and* write — and end-to-end
  "did the cursor actually move" IS verifiable without a human. Assuming otherwise hid the real
  wedge for a whole release. Probe with `[System.Windows.Forms.Cursor]::Position` to read and a
  `user32!SetCursorPos` P/Invoke to write.

## 2026-08-13 v1.5.0 radio
- Viewer/host chips: signaling · WebRTC · input path.
- ICE restart + rebuild; viewer room reclaim; `GET /qr` pair image; 4 Mbps default; 500ms stats.
- Join-mode input uses data channel first.

E2EE remote-desktop: Electron host app + Rust input daemon + WebRTC to a phone/browser viewer.

## Processes
- **main.js** (Electron main) — creates the host window, spawns/monitors `amni-control.exe`, owns the persistent TCP client to it, exposes IPC (`send-input-event`, `get-sources`, clipboard, local IP). **Single-instance lock** (`requestSingleInstanceLock`); Chromium `userData` + disk/GPU cache under `%AppData%/amni-connect` so multi-start does not fight cache locks.

- **server.js** (signaling) — Express + socket.io on `:3389` (`0.0.0.0`). Room create/join, WebRTC offer/answer/ICE relay, `input-event` relay (viewer → host), `POST /upload` (phone → PC file transfer, saved to `received-files/`), `GET /qr` pair PNG, serves `viewer.html`. Can run standalone (`npm run server`) or in-process inside Electron — `server.listen` gracefully no-ops on `EADDRINUSE` so only one instance ever actually binds.
- **rust/src/main.rs** (`amni-control.exe`) — Tokio TCP listener on `127.0.0.1:7878`. Parses newline-delimited JSON input events and drives the OS cursor/keyboard via `enigo` (Windows: `SendInput`/`SetCursorPos` under the hood).
- **index.html** (host UI, renderer) — hosts the screen-share (`desktopCapturer` + WebRTC), receives `input-event` over its own socket.io connection to `server.js` and forwards to Rust via `window.electronAPI.sendInputEvent` → IPC → `main.js`.
- **viewer.html** (phone/browser UI) — joins a room, renders the incoming video track, captures touch/mouse/keyboard and emits `input-event` to `server.js`; file picker uploads via `POST /upload`.

## Input event path

**Two transports carry the session, and they fail independently — this is the single most
important thing to know when debugging "it looks connected but nothing happens":**

| Carries | Transport | Survives signaling loss? |
|---|---|---|
| Video / audio | WebRTC peer-to-peer | **Yes** — already negotiated, needs no server |
| Input (v1.4.0+) | WebRTC **data channel**, peer-to-peer | **Yes** |
| Input (fallback) | socket.io → server.js relay | No |

Primary (v1.4.0+): viewer `sendInput` → **data channel** `{type:'input',ev}` → host
`setupDataChannel.onmessage` → IPC `send-input-event` → main.js `rustClient.write()` → TCP `:7878`
→ amni-control.exe → `enigo.move_mouse` / `.button` / `.key` / `.scroll`.

Fallback (only if the data channel is not open): viewer → socket.io `input-event` → server.js relay
→ host socket.io → same IPC path.

Because video is peer-to-peer, **a perfectly smooth sub-50ms picture proves nothing about whether
input is being delivered.** Before v1.4.0 input rode the relay only, so any signaling hiccup killed
control while the video kept streaming — which read as "laggy/ignoring me", not "disconnected".

### Known failure mode (fixed v1.4.0): host never reclaimed its room
`server.js` deletes a room when the host socket disconnects, and `index.html`'s
`socket.on('connect')` only **logged** — it never re-emitted `create-room`. So one websocket blip
(or a server restart) left the host permanently unroutable: `rooms.get()` returned undefined and
`input-event` was dropped by `if (room)` with **no else branch**, silently, forever.
Measured control test: pre-fix host after a relay blip → `Room not found`, input dead; fixed host,
identical blip → room reclaimed, input routed.
Now: host re-emits `create-room` on reconnect (the server's reclaim path already handled taking a
fixed code back), the server holds the room for `HOST_GRACE_MS` (8s) before tearing it down, and a
dropped input replies `input-dropped` instead of vanishing.

### Known failure mode (fixed v1.4.0): right-click fired twice
A physical right-click fires **both** `mousedown` (button 2) and `contextmenu`. Both handlers sent
`mouse-right-click`, so the host got two: the first opened the context menu, the second clicked
into it and dismissed it — indistinguishable from "right-click does nothing". All four call sites
now go through `sendRightClick()`, which collapses repeats inside 350 ms. Measured: 2 handlers
fire, 1 event sent.

### Scroll sign convention (v1.3.1)
- enigo: `scroll(+n, Vertical)` = down, `scroll(-n, Vertical)` = up; horizontal `+` = right, `−` = left.
- Wheel (`viewer.html` / `index.html` Join): map browser `deltaY/X` with **same** sign (`delta > 0 → +1`) so host matches local wheel.
- Touch two/three-finger: finger-down → positive `dy` (already matched enigo).

Known failure mode (fixed v1.3.0): if the TCP link to `:7878` drops, `main.js`'s reconnect logic must not double-schedule (error + close both firing) — causes unbounded socket/memory growth and a hung renderer that stops processing `input-event` entirely.
Known failure mode (fixed v1.3.1): wheel handlers inverted `deltaY` before enigo; host scrolled opposite of local wheel.

## Viewer zoom / pan (viewer.html only — `index.html` Join mode has none)
`#zoom-container` wraps **both** the `<video>` and `#touch-overlay`, so the overlay's
`getBoundingClientRect()` already includes the zoom transform — that is why `screenCoord()` keeps
mapping touches to the right host pixel at any zoom, with no zoom term in it.

- `setZoom(next, clientX, clientY)` is the **single** clamp + anchor path (toolbar, pinch, ctrl+wheel).
- **Anchor coordinates must be converted out of viewport space.** `panX/panY` translate the container
  inside `#viewer-screen`, which sits *below the status bar*. Passing a raw `clientY` (the v1.4.0 bug)
  offsets every zoom step by the status-bar height — measured 9.25px per step, 104px over six.
  `setZoom` subtracts the `#viewer-screen` rect origin.
- **The cap is derived, not literal.** `maxZoom()` = 4 CSS px per source pixel, floored at 4x, ceiling
  32x. A fixed cap is wrong because the useful limit depends on stream resolution vs viewport size:
  on a 390px phone a 1080p stream displays at 0.203 CSS px per source px, so the old flat 4x cap
  never even reached 1:1 with the source.
- Steps are **multiplicative** (`×1.25`). An additive step is scale-dependent and goes numb as you
  zoom in (2.5% per press at 8x), which is why pinch and the toolbar used to disagree.
- The real detail ceiling is the **host** `resolutionSelect` (defaults 1080p). Zoom beyond source
  resolution is upscale.

## File transfer path (added v1.3.0)
phone (viewer.html file input) → `XMLHttpRequest` POST multipart `:3389/upload` → `multer` disk storage → `received-files/<timestamp>_<rand>_<name>` → `file-received` socket.io event → host (index.html) logs filename/size.

## Backups / docs
- `backups/<file>.<version|date>.bak` before any edit
- `docs/checklists/checklist_<task>_v<version>.md` per task
- `CHANGELOG.md` at repo root
