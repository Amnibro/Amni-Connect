# Amni-Connect Architecture Map

## 2026-09-02 v1.5.11 Linux packages ship like Windows Setup
- `package.json` `win.extraResources` / `linux.extraResources` / `mac.extraResources` each pack the matching `amni-control` binary from `build/`.
- Linux targets: AppImage + deb + rpm. Artifact names `Amni-Connect-${version}.{AppImage,deb,rpm}`. `.deb` depends include `libxdo3|libxdo4`, `libxkbcommon0`, `libxtst6`.
- CI `.github/workflows/release.yml` builds Windows (NSIS) and Linux on tag/`workflow_dispatch`, then publishes one GitHub Release with both. `scripts/install-linux.sh` is the curl|bash path (AppImage default; `--deb` / `--rpm`).

## 2026-09-01 v1.5.9 input must not share a clogged pipe with 16 Mbps video
- Three data channels: `input` (ordered, priority high), `clipboard` (ordered), `screen` (unordered, maxRetransmits 0, priority low). Viewer `sendInput` / `sendPaste` prefer `input`. Host applies `{type:'paste',text}` as writeClipboard + Ctrl+V chord.
- Renderer→main input is `ipcRenderer.send`, not invoke. HW video IPC drops non-keyframes while `hwPending`.
- Packaged rust binary is `process.resourcesPath/amni-control.exe` (copied from `build/amni-control.exe` at pack time). NSIS `scripts/installer.nsh` creates `AmniControlElevated` at install time. `rustBinPath()` prefers the packed exe, then `rust/target/release`.
- Default binary distribution is GitHub Releases (`publish.provider=github`, `npm run release`). Packaged hosts call `electron-updater` against that feed. `.github/workflows/release.yml` can rebuild and upload the same assets.
- Auto-host must not call `hideToTray`. Tray only after an explicit Start Hosting click, and only if the toggle is on.

## 2026-08-30 v1.5.8 lock scale + tray host
- Chromium can still drop `scaleResolutionDownBy` after the first `setParameters`. `lockEncodeParams` is the single write path; the 500ms stats loop re-applies if `outbound-rtp.frameWidth` is below `track.getSettings().width` or `qualityLimitationReason === 'resolution'`.
- Host window GPU: no `backdrop-filter` on header/panel. While hosting, default path is hide-to-tray (`trayHost` in `main.js`). `window-all-closed` must not teardown rust when `trayHost && !quitting`. Close while hosting is hide, not quit. Hidden renderer must not throttle (`backgroundThrottling: false`).
- Toggle `amni-tray-host` in localStorage (`0` = stay on screen).

## 2026-08-29 v1.5.7 stream quality + DXGI hardware encode
- Blur was never the Electron shell. Default 1080p @ 4 Mbps on a 2752×1152 desktop downscaled then bilinear-upscaled. Defaults are now source / 60 fps / 12 Mbps; LAN AIMD floor 16 Mbps.
- Chromium fallback still uses `desktopCapturer`. New Windows path: DXGI Desktop Duplication in `amni-control` → NV12 → Media Foundation H.264 (hardware MFT preferred) → length-prefixed ANC1 frames on `:7879` → Electron IPC → WebRTC `screen` data channel (unordered, no retransmit) → viewer WebCodecs + canvas.
- Control plane stays `:7878` JSON. Capture commands: `capture-start` / `capture-update` / `capture-stop` / `capture-idr` / `capture-status`. Capture failure must not exit the input daemon.
- Viewer `#zoom-container` has no transform transition. `updateCrisp()` sets `pixelated` only when `currentZoom > 1.02`. `sourceSize()` reads the canvas when the HW surface is active so zoom/input mapping follows the encoded frame, not a dead `<video>`.
- Codec preference and `contentHint=detail` / `maintain-resolution` apply to the Chromium path only. The HW path's sharpness is bitrate + native resolution + pixelated zoom.

## 2026-08-23 v1.5.6 signaling HTTP timeouts
- 3389 is the frozen forwarded signaling port. Internet RDP probes complete TCP and then stall Node's HTTP parser. `server.headersTimeout=4000` / `requestTimeout=8000` / `keepAliveTimeout=4000` / `timeout=10000` so those sockets die and `socket.io` from the Electron host (`http://localhost:3389`) can connect. Chip `sig down` is `!socket.connected`.

## 2026-08-17 v1.5.5 the key wire carries CHARACTERS, the OS wants PHYSICAL KEYS

- **`key_from_str` is a character→physical-key resolver, not a lookup table.** The viewer sends
  `e.key`, which for Shift+A is the string `"A"`. enigo 0.2.1 resolves a char with `VkKeyScanW`
  (virtual key in the low byte, **required shift state in the high byte**) and then passes the whole
  value to `MapVirtualKeyW`, which accepts a virtual key only — so every char that needs Shift maps
  to 0, returns `InputError::Mapping`, and never reaches `SendInput`. `shift_base()` folds the
  capitals and the 21 shifted symbols down to the key they physically live on before enigo sees them.
- **Shift is state the daemon owns.** `Ctl.shift_held` tracks the client's Shift; `auto_shift` is
  the daemon's own. A client may send the shifted character with Shift (viewer, physical keyboard)
  or without it (any other client) and both must type the same thing.
- **`errs` cannot detect a mapping failure.** It counts `SendInput` results, and this class of bug
  fails before the call. A UIPI discard also reports success. To prove input works, read the target
  back — cursor position for the mouse, the received text for the keyboard.
- Do NOT test keyboard input by calling `SetForegroundWindow`: a script cannot steal foreground, and
  the daemon's own console window holds it when started by `schtasks`. Minimise that console and let
  the **daemon click into the target**; calibrate with two injected clicks and read `e.screenX` vs
  `e.clientX` (offset only, scale 1 at this display).
- Rebuilding `amni-control.exe` needs a kill-and-retry loop: Electron's `trySpawnRust` respawns the
  daemon within seconds and re-locks the file. After rebuilding, restart through
  `schtasks /run /tn AmniControlElevated` or the daemon comes back at **Medium** integrity and every
  keystroke is silently discarded whenever an elevated window has focus.


## 2026-08-17 v1.5.4 input daemon runs elevated (UIPI)

- **Input integrity level is part of the architecture, not a deployment detail.** `amni-control.exe`
  must run at **High** integrity. As a Medium IL child of non-elevated Electron it is silently
  muted by UIPI whenever any elevated window holds foreground: `SendInput` is discarded and
  `SetCursorPos` returns FALSE with `ERROR_INVALID_HANDLE` (6). Anthony runs elevated terminals
  and Braid, so remote control died the moment one of them took focus.
- **The v1.5.2 "daemon wedges while alive" entry below is superseded.** There was no wedge. Every
  observation it records — alive, listening, ESTABLISHED, parsing, cursor frozen, "healed" by a
  kill, "re-wedged" minutes later — is UIPI toggling with the foreground window. Do not add more
  wedge instrumentation; check the foreground window's integrity level first.
- Launch path: `trySpawnRust` -> `schtasks /run /tn AmniControlElevated` (Interactive, RunLevel
  Highest, IgnoreNew, no time limit). Fallback to direct spawn only if the task is missing, and it
  says so in `hostStatus`. A `requireAdministrator` manifest is **wrong here** — its UAC prompt is
  on the secure desktop, unclickable by the remote user this feature exists for.
- Teardown must use `schtasks /end` before `taskkill /IM`: Medium IL Electron cannot kill its own
  High IL daemon, and a survivor holds `127.0.0.1:7878` through every restart.
- Diagnostic order for "input does nothing" — cheapest discriminator first:
  1. foreground window integrity level (elevated? then this is UIPI)
  2. `OpenInputDesktop` name (`Default` vs `Winlogon` = lock screen / UAC)
  3. daemon `ping` -> `errs`/`misses`/`direct`
  4. direct TCP probe to `:7878` with a cursor read-back, bypassing viewer and relay entirely
- Full-chain probe that proves it end to end: socket.io client -> `join-room ANTMAN-PC` ->
  `input-event {type:'mouse-move',x,y}` -> read `GetCursorPos`. Expect `x*2752, y*1152`.

## 2026-08-16 v1.5.3 LAN ICE classify + laptop key map
- WebRTC only had Google STUN. Stats never read `local-candidate`/`remote-candidate` types. A same-LAN pair that nominated `srflx` looked like "just the internet" and AIMD capped to STUN's WAN estimate.
- Electron: `WebRtcHideLocalIpsWithMdns` off so host candidates are real RFC1918, not `*.local`.
- `classifyIcePath`: host-host **or** both RFC1918 = LAN. Chips: `rtc connected lan host-host`. LAN AIMD floor 8 Mbps, do not min() against `availableOutgoingBitrate`.
- Keys: viewer/Join send `code`; rust `key_from_str` accepts Space, F1-F12, CapsLock, Insert, `KeyX`/`DigitN`. Unmapped keys log. Rebuild `amni-control.exe` when the running process releases the file lock.

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
- **main.js** (Electron main) — creates the host window, spawns/monitors `amni-control.exe`, owns the persistent TCP client to it (`:7878` control, `:7879` HW video), exposes IPC (`send-input-event`, `get-sources`, clipboard, local IP, `start-hw-capture`). **Single-instance lock** (`requestSingleInstanceLock`); Chromium `userData` + disk/GPU cache under `%AppData%/amni-connect` so multi-start does not fight cache locks.

- **server.js** (signaling) — Express + socket.io on `:3389` (`0.0.0.0`). Room create/join, WebRTC offer/answer/ICE relay, `input-event` relay (viewer → host), `POST /upload` (phone → PC file transfer, saved to `received-files/`), `GET /qr` pair PNG, serves `viewer.html`. Can run standalone (`npm run server`) or in-process inside Electron — `server.listen` gracefully no-ops on `EADDRINUSE` so only one instance ever actually binds.
- **rust/src/main.rs** (`amni-control.exe`) — Tokio TCP listener on `127.0.0.1:7878` for input + capture commands. Windows also DXGI-captures and MF-encodes H.264 onto `127.0.0.1:7879`. Input still via `enigo` (`SendInput`/`SetCursorPos`).
- **index.html** (host UI, renderer) — hosts the screen-share (DXGI/HW path when hello arrives, else `desktopCapturer` + WebRTC), receives `input-event` and forwards to Rust via `window.electronAPI.sendInputEvent` → IPC → `main.js`.
- **viewer.html** (phone/browser UI) — joins a room, renders the incoming video track or WebCodecs canvas, captures touch/mouse/keyboard and emits `input-event` to `server.js`; file picker uploads via `POST /upload`.

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
