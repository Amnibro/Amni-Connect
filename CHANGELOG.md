# Amni-Connect Changelog

## v1.6.20 - browsers without WebRTC get the screen over the signalling socket (2026-09-23)

### Added
- **Amni-Browse (and any browser without WebRTC) can view a host.** Arch builds WebKitGTK without WebRTC, so `RTCPeerConnection` does not exist in Amni-Browse and the viewer stayed black. The viewer now joins in socket mode and asks for the screen over socket.io (`sv` events). The host clones its capture track (at most 1080p/30), encodes H.264 with WebCodecs `VideoEncoder` in `avc` format, and sends each frame only to that viewer. WebKit's decoder rejects Annex B keyframes, so the avcC description goes with every keyframe. Input already fell back to the socket relay.
- The viewer acknowledges every frame. When a viewer is more than 3 frames behind, the host drops frames before encoding, so the picture never corrupts. It keeps the last frame so a new or recovering viewer gets a keyframe at once, even from a static Wayland screen.
- `?transport=socket` forces socket mode, for networks where WebRTC is blocked.
- The server relays `sv` host → addressed viewer only, and viewer → host only for `want/ack/key/stop` from a joined viewer. The socket.io message cap is 4 MB so keyframes fit.

### Fixed
- **The picture was grainy over the internet.** Three causes, all on the host. (1) Auto-bitrate capped its target at WebRTC's `availableOutgoingBitrate`, but that estimate never probes above the cap it is given, so one dip ratcheted the slider down to 500 kbps and it stayed there; it now only follows the estimate when there is loss, high RTT or a bandwidth limit, and never below 4 Mbps off the LAN. (2) "Source (native)" still fitted the capture into a 1920×1080 box, and on Wayland the portal reports no screen size, so a 3440×1440 screen went out as 1920×804; native now means no size cap. (3) The track was tuned `contentHint 'motion'` with `maintain-framerate`, which sheds detail first; it is `'detail'` with `maintain-resolution` again, so text stays sharp and a tight link drops frames instead. `tests/test_stream_quality.js` passes in full again.
- The screen channel for hardware frames is low priority with a 256 KB backlog limit, so it cannot starve the input channels.

### Tests
- `tests/test_socket_stream.js` (14 checks): wiring, plus a live relay run showing a viewer can't push frames, a non-member is ignored, and a 1.5 MB keyframe reaches only the addressed viewer. It streams live in Amni-Browse (WebKitGTK) and Chrome against a throwaway server.

## v1.6.19 - a Linux host shows its screen and takes touch and pad input on Wayland (2026-09-23)

### Fixed
- **A Linux host sent a black screen to phones.** When every viewer reports it can decode hardware frames, the host switches its normal video track off and sends H.264 from the hardware capturer instead. That capturer only exists on Windows, so on Linux the track went dark and nothing replaced it (OpenH264 logged an input frame rate of 0). The track is now switched off only while hardware capture is actually running.
- **Touch taps landed in the wrong place on Wayland, and the input daemon kept restarting.** Absolute moves went through enigo, XTEST and XWayland, which KWin reads as scaled logical pixels (125%), and the Windows-only cursor fallback made the daemon give up and respawn, raising a new KWin input prompt each time. On Wayland amni-control now creates two uinput devices: an absolute pointer with three buttons, mapped across the whole screen with no scaling, and a relative device for the wheel. Moves, clicks and scroll go through them; the keyboard stays on enigo.
- **Switching touch to pad broke input.** Pad mode's relative moves still went through enigo, failed on Wayland and knocked the daemon over, which took touch down with it. Relative moves now go through the uinput relative device too.
- **Viewer stayed black in browsers without WebRTC** (Amni-Browse on Amni OS: Arch builds
  WebKitGTK without it). `RTCPeerConnection` was undefined, the peer never came up, and nothing
  said why. The viewer now says so and points to Chrome, Firefox, Edge or the Amni-Connect app.
- **Viewer could go black for good when its decoder failed.** It claimed hardware frames whenever
  `VideoDecoder` existed; the host then switched its normal video track off, and a decoder that
  errored or never painted left the screen black because the host was never told. The viewer now
  checks the H.264 profile with `VideoDecoder.isConfigSupported` first, and tells the host to send
  the normal track again on a decoder error or when no frame paints within six seconds.
- **https://connect.amni-scient.com/ said "Cannot GET /".** The viewer was only served at `/viewer`. `/` now serves the same page, so the bare link works.
- **Electron's default File/Edit/View menu bar showed under the Amni title bar.** It is hidden (Alt still shows it).

## v1.6.18 - Amni-Scient look for the host window and the phone viewer (2026-09-22)

### Changed
- **Host window and phone viewer now wear the amni-scient.com identity.** Graphite surfaces with hairline borders instead of slate cards and glows, brass for chrome and wayfinding, Connect green (the site's `--p-connect`) for primary and live state, Archivo condensed caps for the app bar, eyebrows, tabs and labels, mono for the room code, stats, chips and log, and 4/3/2 px radii. The leftover Braid purple and indigo accents are gone.
- The host window loads `ui/brand/amni-scient.css` after its inline sheet (Archivo variable fonts bundled in `ui/brand/fonts/`, so it renders offline). The phone viewer carries the same layer inline in `viewer.html`, because the server only sends `/viewer`.
- The status badge is a quiet chip with a state dot. `setStatus()` still sets its background color, and the brand layer maps that color to the dot, so no script changed.
- Viewer toolbar buttons are one graphite family. Color is kept only where it means something: Paste in green, Disconnect in red.

## v1.6.17 - sharing starts on Wayland, End session lets you rename the room, the main screen is the default (2026-09-22)

### Fixed
- **Starting to share on a Wayland desktop failed or crashed the app.** On Wayland Chromium lists screens through the xdg-desktop-portal, so every `getSources()` opened a new ScreenCast session (KDE's "share your screen" dialog). The picker called it on launch and every 3 s for thumbnails, the calls overlapped the real capture, KDE refused them, and Electron 33 died after the failed portal call. On Wayland the app no longer lists screens in the background: the picker says the desktop will ask, and Start opens the portal once. Cancelling it logs "Screen sharing was cancelled" and leaves you on the host screen. `get-sources` also runs one capturer call at a time on every platform.
- **Start could hang or run twice.** A second click started a second capture while the first was still waiting, and any capture error left the page stuck half-started. Start is single-flight, and a failure stops what was opened and logs why.
- **Changing the room name after ending a session.** "End session" reloads the page, and a saved room name then started hosting again straight away, before the name could be edited. Hosting from a saved name now happens only when the app launches.
- **Default screen.** With no choice made the picker took the first screen the OS listed. It now takes the screen you shared last, else the MAIN display. The hardware capture output index follows the screen actually chosen.
- **Every Linux start waited ~3 s for hardware capture.** The Rust capturer is Windows-only; Linux now falls back to Chromium capture immediately.

## v1.6.16 - every phone in the room gets its own connection (2026-09-22)

### Fixed
- **A second viewer joining knocked the first one off.** The host held a single `pc`; `viewer-joined` for a new id ran `createPC()`, which closed the live connection, so the earlier phone lost video and its input channels and only the newest join could ever click or type. The host now keeps one `RTCPeerConnection` per viewer id (`peers` map, `createPeer`), offers are addressed with `to: viewerId`, answers and ICE pick the right pc by `from`, and `viewer-left` drops only that viewer. Screen access units and clipboard sync fan out to every open channel, bitrate applies to every sender, and the absolute-move sequence is tracked per viewer so two phones do not mark each other's moves stale.
- **Signaling was a broadcast.** `server.js` sent `offer` / `answer` / `ice-candidate` to the whole room, so with two viewers each phone also applied the other phone's answer to its own connection. Host packets now go to the addressed socket (or the room when `to` is missing, so an older viewer page still works), viewer packets go to the host only, and every relayed packet carries `from`. `viewer.html` ignores anything addressed to another socket.
- HW policy with mixed phones: hardware H264 frames are sent when any viewer can decode them, the Chromium video track is disabled only when all of them can, and hardware capture stops only when nobody needs it.

### Tests
- `tests/test_multi_viewer.js` (21 checks): static wiring plus a live signaling run with a host and two viewers on :33995. `tests/test_rooms.js` still all ok.

### Notes
- `amni-control.exe` is unchanged and still reports `v1.6.14`.

## v1.6.15 - one video socket, and a rebuild gap stops counting as a death (2026-09-21)

### Fixed
- **Mouse worked, the screen stayed black.** The host held two Established connections on `127.0.0.1:7879` against one on `:7878`, and both video sockets ran `on('data', onVideoData)` into the single shared `videoBuf`. The parser read a frame length from one stream and its payload from the other, failed the ANC1 magic check and resynchronised a byte at a time, so nothing decodable ever reached the viewer while input, which rides the control socket, kept working perfectly. `connectVideoClient` now replaces the stale socket instead of abandoning it, and both the `data` and `close` handlers check socket identity, so a late `close` from a dead socket can no longer null the reference to the live one and invite a third connection.
- **A failed arm stopped a healthy capture.** The 2800 ms hello timeout in `start-hw-capture` sent `capture-stop`, which sets `want.run = false` in the daemon. If the hello was merely late, that killed a session that was about to deliver. The timeout now reports the failure and leaves the session alone.
- **A failed re-arm silenced the health poll.** `done` overwrote `hwWanted` with the result of the attempt, so one bad arm turned off the `capture-status` poll while the renderer was still on the hardware path, leaving nothing watching. `hwWanted` now stays set until `stop-hw-capture` clears it.

### Tests
- `tests/test_video_socket_single.js` drives `connectVideoClient` through the daemon-restart sequence against a fake ANC1 server that writes each frame in two chunks. On `backups/main.js.v1.6.14_pre_video_socket.bak` the host opens 3 sockets, leaves 2 open and delivers a frame spliced from both. On the patched host it opens one socket at a time and the frame arrives whole.

### Notes
- `amni-control.exe` is unchanged, so the daemon still reports `v1.6.14`. The daemon accepts unlimited `:7879` clients and broadcasts to all of them; a single-consumer policy there would make this whole class of bug impossible and is worth doing next time the exe is rebuilt.

## v1.6.14 - hardware capture stops leaking, the input banner stops repeating (2026-09-21)

### Fixed
- **Hardware capture died 19 seconds into every session and dropped the screen onto the slow Chromium path.** `encode_nv12` handed the encoder an `MFT_OUTPUT_DATA_BUFFER` whose `pSample` and `pEvents` are `ManuallyDrop` fields in windows-rs 0.56, so nothing ever released them. One `IMFSample` plus its output buffer leaked per encoded frame, 60 times a second, until `MFCreateMemoryBuffer` answered `0x8007000E`. Anthony's 2026-09-21 log shows it exactly: capture up at `18:11:21.592Z`, `capture membuf Not enough memory resources are available`, renderer on `HW capture failed - Chromium desktop capture` at `18:11:40.910Z`. Both fields are now taken and dropped every frame, including on the `ProcessOutput` error paths.
- **`enum_encoder` leaked every encoder it did not pick.** `MFTEnumEx` returns a CoTaskMem array of `IMFActivate`; the old code cloned entry 0, freed the array and let the rest of the interface pointers leak, and leaked all of them when `ActivateObject` failed. Each entry is released now, and the array is freed on the no-encoder path too.
- **The input banner repeated a frozen line every 5 seconds.** `misses` resets the moment a move lands but `last` was never cleared, and `main.js` re-logged whenever `direct` was true, so the panel filled with `misses=0 ... move did not land ... misses=1` forever. The daemon clears `last` when a move lands, and the host only writes a status line when the state actually changes.
- **Physical mouse movement was scored as a failed remote move.** `verify()` only ever ran from the next `move_to`, so a pending target could be judged minutes later against wherever Anthony had since moved his own mouse - enough false misses to flip the backend to `SetCursorPos` for no reason. A move is now judged only between `SETTLE_MS` and `STALE_MS` (60-400 ms) and is dropped, uncounted, once it is older than that.
- **A mid-session capture death was permanent.** Nothing polled capture health and the renderer had no way to hear about it, so one failure meant Chromium capture for the rest of the session. The host polls `capture-status` on the 5 s ping while capture is meant to be running, sends `hw-dead` once per death, and the renderer re-arms hardware capture three times before it gives up.
- **The daemon banner lied about its version.** It printed a hardcoded `v1.5.16`; it now prints `CARGO_PKG_VERSION`, and the crate version tracks the app at 1.6.14.
- **The phone sat on a black canvas while the host said capture was on.** A bitrate tick tore the DXGI session down before it encoded a frame, the health poll treated that empty gap as a capture death, and the frame stash then threw away the only keyframe (`slice(-12)`). The viewer decoder never got an IDR, so the canvas stayed black. Bitrate now updates on the live encoder, a status with no reason does not count as a death, the stash keeps the keyframe, and a key request actually sets `CODECAPI_AVEncVideoForceKeyFrame`. Desktop duplication also asks for BGRA, so an HDR desktop is not copied into an uninitialized black texture.
- **Mouse kept working and the picture did not.** After the Chromium crash fix, the desktop stayed on the hardware path and was no longer a WebRTC video track. That path was an unreliable, low-priority data channel, so pointer traffic crowded it out and a static desktop never repeated a keyframe. The screen channel is reliable again, a still screen re-sends a frame once a second, and length-prefixed H264 keyframes count as keys.

### Added
- `AMNI_CTL_PORT` and `AMNI_VIDEO_PORT` env overrides so a test daemon runs on its own ports and never touches the live one on 7878/7879.

### Tests
- `tests/test_capture_no_leak.js` spawns the daemon on isolated ports with its own `APPDATA`, holds 60 fps capture for 30 s and requires no out-of-memory in the daemon log, working-set growth under 60 MB and video still flowing after the first 10 s. Against a build that differs only by the missing `ManuallyDrop::take` it fails with `oom=true capture-error=true`; against 1.6.14 it passes at 3 MB growth over 30 s.
- `tests/test_degrade_status.js` carves the real `onRustData` out of `main.js` and drives it with pongs. It requires one status line per state change, exactly one `hw-dead` per capture death, and no `hw-dead` when the status reason is empty. On `backups/main.js.v1.6.13_pre_capture_rearm.bak` it fails three ways: 6 lines for 6 identical pongs, a healed backend still called degraded, and no capture death reaching the renderer.
- `rust` unit tests cover `land_verdict` - settling, landed, missed, stale and both window edges - and `env_port` junk handling. 14 Rust tests pass.

## v1.6.13 — hardware capture survives the audio request (2026-09-21)

### Fixed
- **Every session fell back to Chromium capture, which is why input felt laggy.** The host opened DXGI/H264 hardware capture, then asked for desktop audio with `getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: false })`. Chromium kills a renderer that asks for desktop audio with no video constraint (`bad_message.cc` reason 263, exit 3), so the window died 7–23 ms after capture came up, every time, in all four hardware-capture sessions in `host.log`. `captureDesktopAudioOnly` now asks for a 2×2 @ 1 fps video track alongside the audio, stops and removes that track, and keeps the audio. The renderer stays alive and the host keeps the hardware path.
- **A reloaded renderer could never re-attach to a live capture session.** `amni-control` sent `hw-hello` once, when the capture session opened. After the renderer died and reloaded, `start-hw-capture` waited 2800 ms for a hello that was never coming, gave up, and the whole session ran on the software path. `capture-start` against an already-running session now re-broadcasts the hello.
- **Cold boot asked for hardware capture before the elevated daemon had connected.** The window auto-hosts about half a second after it loads; `amni-control` connected 380 ms later in the 16:17 boot, so `start-hw-capture` answered `no-backend` immediately and the session ran on Chromium capture. Across the whole of `host.log` that is 13 `no-backend` and 7 `timeout` against 5 hardware starts. `main.js` now tracks the control socket with `rustReady` and waits up to 5000 ms for it before giving up.
- **The fallback path was pinned to full resolution.** `lockEncodeParams` set `degradationPreference: 'maintain-resolution'` and `scaleResolutionDownBy = 1`, so the software encoder held 3440×1440 and paid for it in framerate whenever it could not keep up. Both are `balanced` now and the scale override is gone, so a struggling encoder trades pixels for frames.

### Tests
- `tests/test_desktop_audio_capture.js` runs the shipped `captureDesktopAudioOnly` inside real Electron and requires a live audio track, zero video tracks and no `render-process-gone`. It fails on `backups/index.html.v1.6.12_pre_hw_audio_fix.bak`.
- `tests/test_hw_capture_waits_for_backend.js` requires a >= 3000 ms wait budget and readiness tracked on connect/close. It fails on `backups/main.js.v1.6.13_pre_backend_wait.bak`.
- `tests/test_hello_rebroadcast.js` spawns the daemon, sends `capture-start` twice on one session and requires a second `hw-hello`. It fails on `backups/amni-control.exe.installed_v1.6.12_pre_hello_rebroadcast.bak`.

## v1.6.12 — see who is in the session, and boot them (2026-09-17)

### Added
- **Host occupancy.** The session card and the `empty` / `1 in` header chip update when a viewer joins or leaves. The tray tooltip follows (`Hosting CODE · 1 in session`) and grows a Boot item while someone is on.
- **Boot.** Host-only `kick-viewer` drops that socket, tells the phone `kicked`, and leaves the room up. The phone goes back to the connect card and does not auto-rejoin. A second phone still waiting gets an offer after the first is booted.

## v1.6.11 - the phone viewer no longer 404s after Windows cleans Temp (2026-09-17)

### Fixed
- **The phone got `Error: ENOENT ... \Temp\<guid>.tmp.html` instead of the viewer.** `/viewer` answered with `res.sendFile` on a path inside `app.asar`. sendFile needs a real file on disk, so Electron copied `viewer.html` out to `%TEMP%\<uuid>.tmp.html` once at startup and kept handing back that path. Windows temp cleanup deleted the copy, and every request after that answered 404 with the ENOENT text, while `/health` and `/qr` kept working because they never touch a file. The route now reads the page with `fs` (which reads straight out of the asar) and sends it from memory, so no temp copy exists to lose. The socket.io client is served the same way, by basename only, so it cannot rot the same way or walk out of its folder.

### Tests
- `tests/test_viewer_from_asar.js` boots the real signaling server, checks `/viewer` returns viewer.html with no ENOENT, checks the socket.io client still loads, refuses `..` paths, and proves the old `res.sendFile` line still reproduces the phone's 404.

## v1.6.9 — host window no longer paints white (2026-09-12)

### Fixed
- **Host window was a blank white rectangle.** `index.html` started with `@import` of Google Fonts, which blocks the whole stylesheet until that request finishes — hang or no network and Chromium shows the default white canvas. Fonts are system-ui. The BrowserWindow background is `#0A0B0E`, it waits for `ready-to-show`, and Show/tray reloads if the renderer crashed or is not on `index.html`.

## v1.6.8 — stop sending every key twice (2026-09-12)

### Fixed
- **Letters sometimes came out doubled.** v1.6.7 sent each key on the WebRTC data channel *and* on signaling. When the relay won the race, both landed. P2P is the only path again while the channel is open; signaling is the fallback. Main also drops a key-down/up that matches one from the last 40ms so a cached 1.6.7 viewer cannot keep doubling.

## v1.6.7 — minimize no longer kills remote input (2026-09-11)

### Fixed
- **Minimize (or clicking minimize from the phone) left video up and input dead.** Chromium freezes the host renderer when the window is minimized; WebRTC video keeps encoding, but taps go through renderer JS into `amni-control`. Minimize now hides to the tray like Close. The viewer also relays every event on signaling; main applies it if the renderer has been quiet for 80ms, so a frozen window still takes clicks.

## v1.6.6 — 1080p keeps the desktop aspect, Caps Lock is a click (2026-09-11)

### Fixed
- **Mouse missed after changing resolution.** Picking 1080p / 720p on a 3440×1440 desktop asked Chrome for a 16:9 frame, so the picture letterboxed inside the video and taps mapped across the black bars. Capture now fits inside the selected box and keeps the source aspect (1080p → 1920×804 on this PC).
- **Caps Lock stuck on.** The key was Press on keydown and Release on keyup (and repeats toggled it again). It is one Click on keydown. A new viewer also sends `reset-mods`, which turns Caps Lock off if it was left on.

## v1.6.5 — new viewer gets an offer even if an old peer is live (2026-09-11)

### Fixed
- **Waiting for stream forever.** The host skipped a new offer whenever *any* WebRTC peer was `connected`, and the 10s room pulse re-fired `viewer-joined` so the log filled with "keeping live WebRTC". A second phone (or a refresh) joined signaling and never got an offer. Skip only for the same viewer id. Same-host reclaim no longer notifies viewers.

## v1.6.4 — room code survives a host socket drop (2026-09-11)

### Fixed
- **Room not found while the app was still running.** Signaling deleted `ANTMAN-PC` 8s after the host websocket blipped. WebRTC on an already-connected phone kept working, so the PC looked live; the next join missed. Rooms now stay for the life of the process, the last code is written to `room.json` and reloaded on start, and the host republishes every 10s.

## v1.6.3 — tunnel join is room code only (2026-09-10)

### Changed
- **Passkeys are off.** `REQUIRE_PASSKEY` in `auth.js` is false, so `connect.amni-scient.com/viewer` plus the room code gets you in the same way LAN does. Enroll UI on the host is hidden. Flip the flag to put the gate back.

## v1.6.2 — passkey enroll without Windows Hello (2026-09-10)

### Fixed
- **Create passkey died with "User verification was required, but user could not be verified."** Registration and login asked for `userVerification: 'preferred'` (and a resident key), which Windows Hello / some Android stacks treat as required. A laptop with no PIN, or a cancelled Hello prompt, failed the ceremony. Options now discourage UV and resident keys (credential IDs already live on the host). Verify accepts a UV-less assertion.
- **Enrollment still looked double-drawn.** The logo sat above the replaced card, so "Amni-Connect" stacked with itself / the old Connect button on a cached page. Enroll and unlock now replace the whole `#connect-screen`. The QR includes `v=1.6.2` so Cloudflare cannot keep serving the old viewer.

## v1.6.1 — one passkey card, tunnel 502s from short HTTP timeouts (2026-09-10)

### Fixed
- **Enrollment showed two overlapping windows.** `runEnroll` / `showUnlock` appended a second `.card` on top of `#connect-screen` (logo + host/code form still visible), so "Amni-Connect" and "Create passkey" stacked into garbage. Both flows now replace the single connect card.
- **Off-network viewers got HTTP 502.** `headersTimeout`/`keepAliveTimeout` were 5s from the old RDP-probe shed. cloudflared keeps localhost connections alive longer than that; Cloudflare then 502s. Timeouts are 60s / 65s, and loopback sockets have no idle timer.

## v1.6.0 — Cloudflare tunnel + device passkeys for rooms (2026-09-09)

### Added
- **Named Cloudflare tunnel.** `%APPDATA%mni-connect	unnel.json` (`hostname`, `token`) makes the app spawn `cloudflared tunnel run --token` at startup (log: `tunnel.log`, restart with backoff, killed on quit). Tunnel `amni-connect` on the Amniscient account, ingress `connect.amni-scient.com -> http://localhost:3389`, proxied CNAME. The pairing address defaults to `https://<hostname>` when a tunnel is configured.
- **Passkeys gate every room opened through the tunnel.** `auth.js` (`@simplewebauthn/server`): a request is *remote* when its Host is the tunnel hostname or it carries `cf-connecting-ip`. Remote sockets need a session cookie to `join-room` or relay `input-event`, can never `create-room`, and `/upload` + `/ice-servers` return 401 without one. Loopback and LAN-by-IP stay open (Anthony's call: home Wi-Fi keeps working with just the code).
- **Enrollment from the host window only.** `POST /auth/enroll-token` is loopback-only and mints a 5-minute single-use link `https://<host>/viewer?enroll=TOKEN&code=ROOM`, shown as a QR in the new Remote access panel with a countdown and the enrolled-device list (remove per device). The phone opens it, names itself, creates a platform passkey (Face/fingerprint), and gets a 30-day HttpOnly session. Later visits show an Unlock with passkey card before joining.
- `tests/test_passkeys.js`: 20 checks against a live server with a temp APPDATA (remote detection, LAN bypass, gated join/host/ice/upload, loopback-only enrollment, forged cookie). 12 FAIL on the v1.5.20 backups.

- **Host window is a three-card dashboard.** Session (mode, screen picker, room code, QR beside the pairing address, Remote access with the enrollment QR beside the device list), Stream (settings in two columns, stats), and a full-height Connection Log. Joining a session collapses to session + log on the left with the video filling the rest. Nothing lives behind a scroll at 1200x800 any more.
- **Host log reaches disk.** Every line in the Connection Log is also appended to `%APPDATA%mni-connect\host.log` as `ui ...`, and while input is flowing the host logs a 5-second line `input 5s: move-ch= input-ch= relay= moves= stale= rtc= <ice path>` so a "touch is laggy" report can be read from the file.
- **The taskbar shortcut kept launching the previous build.** The NSIS one-click installer moves the existing install to `%TEMP%\...\old-install\` and launches that copy, which then holds the single-instance lock, so every later click just re-showed the stale window. `main.js` now bounces out of any copy running from a Temp/old-install path: it relaunches `%ProgramFiles%\Amni-Connectmni-connect.exe` and exits before the lock is taken. Caught by reading `ExecutablePath` of the running process, which read `...
sg9607.tmp\old-installmni-connect.exe` while `app.asar` on disk was current.
- **Enrollment links last 20 minutes** instead of 5, so a link can be texted to someone.
- **A saved LAN pairing address no longer outranks the tunnel.** `100.71.155.240` was still in localStorage, so the pairing QR and the Link button handed out an address nobody off the network can reach. When a tunnel hostname exists and the saved address is private, the tunnel wins and the log says so.
- **Three-column layout no longer clips the log card** at 1200x800: column minimums are smaller and the two-column breakpoint moved from 1100px to 1240px.
- **Laptop trackpad pans a zoomed view.** Two-finger swipe (wheel events) moves the view when zoomed past 1.05x, in the same direction as the fingers; Shift+swipe still scrolls the host, Ctrl+swipe (trackpad pinch) still zooms, and at 1x every swipe scrolls the host as before.
- `tests/probe_symbols.js` types the full US symbol set through `:7878` into a scratch text box and reports what landed. Only run it when no viewer is connected; it drives the real cursor and keyboard.

### Notes
- Passkeys are bound to the hostname, so a raw IP can never unlock; that is why LAN by IP is exempt rather than gated.
- Verified live: `https://connect.amni-scient.com/auth/status` reports `remote:true`, a socket join through the tunnel gets `auth-required`, `/ice-servers` through the tunnel is 401, the same join by `192.168.0.7` still lands in `ANTMAN-PC`.

## v1.5.20 — the elevated daemon task never survived an install (2026-09-09)

### Fixed
- **Every install deleted `AmniControlElevated` and nothing could put it back.** `scripts/installer.nsh` removed the task and left registration to the app, but a Medium-integrity app gets `Access is denied` from `schtasks /create` for any task with `RunLevel HighestAvailable`. So after each Setup.exe the daemon fell back to Medium integrity, and the moment an elevated window (an admin terminal) had foreground, UIPI dropped every move and click with `errs=0`. That is the "open a terminal and lose input but keep watching" report. Reproduced on :7878 with an elevated Windows Terminal in front: cursor stayed at 729,110, pong clean. Installer now writes the task XML (UTF-16LE, BOM) into `resourcesmni-control-task.xml` and registers it while it is already elevated; the uninstaller ends the task and kills the daemon before deleting it.
- **`ensureElevatedTask` never matched the existing task.** `schtasks /query /xml` prints UTF-8, and the app decoded it as UTF-16LE, so the `<Command>` compare failed on every launch and re-creation ran (and failed) each time, flipping `elevatedTask` to false. Any later daemon restart then spawned Medium. Decoding now follows the BOM.
- **An orphaned Medium daemon was adopted on the next launch.** The installer and any hard kill leave `amni-control.exe` running, the new app finds :7878 answering and never runs the task. Pong now reports `elevated`, and the app restarts through the task when it adopts a daemon that is not elevated (measured: replaced 50 ms after connect).
- **App-side repair.** If the task is missing and the plain `schtasks /create` is denied, the app runs it once through the bundled `elevate.exe` (one UAC prompt at the console) and restarts the daemon on the elevated path when that succeeds.

- **Off-network viewers had no relay.** The pairing link advertises the NordVPN Meshnet address first, and a phone on cellular has only STUN to work with, so any path that cannot hole-punch dies at ICE while `sig up` stays green. The signaling server now serves `/ice-servers`: Google STUN plus the box's own `amni-turn` relay (`AMNI_CHAT_TURN_URL`, 24 h HMAC-SHA1 credentials from `AMNI_CHAT_TURN_SECRET`, the coturn REST scheme Amni-Chat already uses). The viewer fetches it before `join-room`; the host fetches it on signaling connect. `lanIp()` also treats 100.64/10 as a direct peer address, so a meshnet viewer's hidden mDNS candidate gets rewritten to its 100.x address like a LAN one.

### Notes
- `tests/test_ice_servers.js`: static wiring plus a live server with a fake secret, verifies the HMAC and expiry. 9 failures on the pre-TURN backups.
- `tests/test_elevated_task_install.js`: static checks on installer.nsh and main.js, then registers the installer's XML for real (when elevated) and reads the `<Command>` back. 8 failures on the v1.5.19 backups, all ok on the fix.
- The v1.5.18 console theory for "sig down" is unproven; the two measured causes are `server.timeout = 10000` (fixed in v1.5.18) and the Medium-integrity daemon above.

## v1.5.19 — host stays up so phones can actually join (2026-09-09)

### Fixed
- **Nothing could connect.** Closing the window (or a renderer crash, exit 3) quit Electron and took `:3389` with it. The tray now stays from launch; close hides the window and leaves signaling up. A crashed renderer reloads `index.html` instead of sitting blank until you quit.
- **Phone socket.io was also rejected.** With no `ALLOWED_ORIGINS` env, CORS was `['']`, so a viewer at `http://<lan>:3389/viewer` failed the origin check. Unset now means `*`.

## v1.5.18 — Open in Terminal was killing the host (2026-09-09)

### Fixed
- **Right-click → Open in Terminal dropped the session.** `amni-control.exe` was a console-subsystem process. Windows 11's default terminal (Windows Terminal) attaches that console; opening a new terminal sends `CTRL_CLOSE_EVENT` to every process on it, which takes Electron with it. Video can keep flowing on WebRTC while the viewer chip goes `sig down`, then the restarted host auto-reclaims the room and looks like something stole the connection. Daemon is now `windows_subsystem = "windows"`, spawned with `windowsHide` + `detached`, and calls `FreeConsole` at start. stderr goes to `%APPDATA%\amni-connect\amni-control.log`.
- **Idle socket.io was also dying on its own.** v1.5.6 set `server.timeout = 10000` to shed RDP probes on forwarded :3389. Socket.io's ping is 25s, so an idle websocket was destroyed first. `timeout` / `requestTimeout` are 0 again; `headersTimeout` still kills probes that never send HTTP.
- **A signaling re-join no longer tears down a live peer.** `viewer-joined` used to `createPC()` every time, which dropped the phone's WebRTC whenever the viewer reconnected to :3389.

## v1.5.17 — cursor lag: moves ride a lossy channel, one per frame (2026-09-05)

### Fixed
- **Cursor trailed the finger over the internet.** Every touchmove became its own message on the
  `input` data channel, which is ordered and reliable. On a lossy path (this session: phone on a
  Tailscale/cellular route, mDNS + srflx candidates only, no LAN pair) one dropped packet held every
  move behind it until SCTP retransmitted, and dcSCTP's minimum RTO is hundreds of ms. Measured the
  rest of the chain first and cleared it: `:7878` direct is 0.6 ms per move and 60/60 land at an
  8 ms cadence with Nagle on or off; the socket.io relay -> renderer -> IPC -> daemon hop streams at
  a steady 16 ms cadence. The stall is the transport, not the host.
- Host now opens a third channel, `move` (`ordered: false, maxRetransmits: 0, priority: high`).
  The viewer coalesces `mouse-move` / `mouse-move-rel` to one packet per animation frame (last
  position wins, trackpad deltas summed) and sends it there with a sequence number. The host drops
  a `mouse-move` whose sequence went backwards and resets the counter when a channel opens.
- The move that precedes a click, key, or scroll is flushed **reliable** on the `input` stream so a
  tap can never land before its move. Anything but moves is unchanged.
- Viewer no longer repaints the link chips on every event (only when the path changes) and caches
  `getVideoRect()` per frame, so a touchmove no longer forces a layout after a DOM write.

### Notes
- `tests/test_move_channel.js`: coalescing, reliable pre-click flush, delta summing, fallback when
  `move` is closed, stale-seq drop; the v1.5.16 backup sends 10 packets where the fix sends 1.
- Join mode in `index.html` uses the same channel with its own counter; its mousedown move is reliable.

## v1.5.16 — the touch offset was on the host, not the viewer (2026-09-02)

### Fixed
- **Every tap landed at 80% of where it should.** `amni-control.exe` was DPI-unaware, so
  `enigo.main_display()` returned the *logical* primary size (2752x1152 at 125% scale) while
  `enigo.move_mouse(Abs)` interprets its argument as a *physical* pixel (3440x1440). Normalized
  `1.0` therefore drove the cursor to physical 2752 — exactly `1/1.25` of the screen. The error is
  multiplicative, so it read as "close near the top-left, way off near the bottom-right", which is
  what sent v1.5.12–v1.5.15 hunting through the viewer's letterbox math. Fix is
  `SetProcessDpiAwarenessContext(PER_MONITOR_AWARE_V2)` before `Enigo::new`. Verified on `:7878`:
  `0.5,0.5` → 1376,576 (exact centre), `1.0,1.0` → 2751,1151 (exact edge).
- **The daemon was killing and restarting itself constantly.** `verify()` compared its `move_mouse`
  target (logical units) against `location()` (physical units), so every single move counted as a
  miss. The log holds 105 `move did not land` and 22 `exiting for host respawn`. Each respawn drops
  the control socket and the HW video socket. `misses` and `errs` now sit at 0.
- **The elevated input task has never once started.** `schtasks /create /tr "<path>"` was built with
  node's `spawn`, whose Windows argument escaping mangled the quoting — the registered task was
  `<Command>C:\Program</Command>` with the rest as `<Arguments>`, failing with 0x80070002 on every
  run. So `trySpawnRust` always fell through to `spawnRustDirect` and the daemon ran at **Medium**
  integrity, where UIPI silently eats input whenever an elevated window has foreground (the exact
  failure v1.5.4 was supposed to close). Task is now registered from XML via
  `schtasks /create /xml`, and `ensureElevatedTask` re-creates it whenever the stored `<Command>`
  no longer matches the current binary. Verified: task-launched daemon reads back integrity
  **HIGH** (S-1-16-12288).
- **The task refused to run on battery.** `/create` defaults left `DisallowStartIfOnBatteries` and
  `StopIfGoingOnBatteries` true. Both are false in the XML.

### Changed
- `scripts/installer.nsh` no longer creates the task; it deletes any stale one and the app
  registers it from XML on first run, so there is one implementation instead of two.

## v1.5.15 — touch maps to the picture box (2026-09-02)

### Fixed
- **Portrait taps were still off on both axes.** JS letterboxing of the overlay (and toolbar clipping) did not match the video the phone actually painted. The picture is now sized with `contain` into `#media-fit`; taps map to that box's `getBoundingClientRect()`. No `object-fit` math, no `getSettings` fallback, no toolbar clip in the coord path.

## v1.5.14 — touch coords: clip to toolbar, revert input-bounds (2026-09-02)

### Fixed
- **Portrait taps still landed far from the cursor.** The PR #1 toolbar work never changed `screenCoord` math; it changed the box we measured. Restored full-bleed `#zoom-container` (`absolute inset:0`) and `position:fixed` toolbar like pre-merge, then clip the touch target to the toolbar's live top edge in `touchTargetRect()` so letterboxing ignores the bar without CSS `--toolbar-h` hacks.
- **Reverted host `input-bounds`.** Single-monitor hosts map 0–1 to `main_display()` again; the 1.5.12 bounds pass was skewing clicks.

## v1.5.13 — touch coords take 2 (2026-09-02)

### Fixed
- **Taps still landed far from the cursor.** The v1.5.12 padding/flex toolbar inset and `visualViewport` remapping fought the real layout on phone. `#zoom-container` now uses absolute `inset` above the toolbar (in-flow, not `position:fixed` over the video). Touch coords map from `#touch-overlay` directly with no viewport hack.
- **Host input bounds could disagree with the live stream.** `input-bounds` now uses the actual encode/capture width and height (WebRTC track settings or HW hello) with the picked monitor origin, not a stale DXGI override.

## v1.5.12 — touch offset fix (2026-09-02)

### Fixed
- **Mobile touch taps landed off vertically and horizontally.** The viewer toolbar fix left the touch layer full-bleed behind the bottom bar, so Y coords included toolbar padding. Ultrawide streams also pillarbox on wide viewports; taps on the picture were mapped across the full overlay including side bars. Viewer now reserves `--toolbar-h`, letterboxes against the real media aspect ratio, and caches stream dimensions.
- **Host mapped clicks to the wrong monitor / resolution.** `amni-control` always scaled 0–1 to the primary display at `(0,0)`. Sharing an ultrawide or secondary monitor sent the cursor to the wrong place on X and Y. Host now pushes `input-bounds` (monitor origin + size) on session start; HW DXGI capture sets the same bounds automatically.

## v1.5.11 — Linux AppImage / .deb / .rpm (2026-09-02)

### Added
- **Linux packages on GitHub Releases.** AppImage (any distro), `.deb` (Debian/Ubuntu/Mint/Pop), `.rpm` (Fedora/RHEL/openSUSE). Each ships the Linux `amni-control` daemon next to the app — no npm or cargo.
- **One-liner install:** `curl -fsSL https://raw.githubusercontent.com/Amnibro/Amni-Connect/main/scripts/install-linux.sh | bash` (AppImage). Pass `--deb` or `--rpm` for packaged installs.
- **CI builds Windows + Linux** from `.github/workflows/release.yml` and uploads both to the same release tag.

### Changed
- `extraResources` is per-platform so Windows gets `amni-control.exe` and Linux/macOS get `amni-control`. `.deb` / `.rpm` declare `libxdo` / `libxkbcommon` / `libxtst` for enigo input.

## v1.5.10 — viewer toolbar, PR #1 host UX (2026-09-01)

### Fixed
- **Mobile viewer toolbar was mushed.** Ten buttons wrapped into a cramped two-row grid. Toolbar is now a single horizontal scroll row with proper tap targets.
- **On-screen keyboard hid under the bottom bar.** Keyboard and clip sheet used a fixed 52px offset while the toolbar was taller. They now sit on the measured toolbar height (`--toolbar-h`).
- **Packaged host signaling could fail to start.** Missing `multer` dependency and writing `received-files` inside `app.asar` prevented `:3389` from binding. Inbox now lives under `%APPDATA%\amni-connect\received-files`.
- **Elevated task broke on `Program Files` paths.** Installer/register script now quotes the daemon path so `AmniControlElevated` runs the packed `amni-control.exe`.
- **Viewer dialled `:3389` behind HTTPS tunnels** (merged from PR #1). Default-port pages now use 443 for https / 3389 for http; hosts with their own port are not double-suffixed.

### Added (PR #1 — @ancsemi)
- **Live screen preview picker** with thumbnails, resolution, and MAIN badge.
- **Draggable splitter** between settings and connection log (size persists).
- **Pairing address field** for Tailscale, DDNS, or reverse-proxy links and QR.
- **`Amni-Connect.bat`** dev launcher with preflight checks.

## v1.5.9 — tap lag, paste, voice, Setup.exe (2026-09-01)

### Fixed
- **Taps felt late after the quality bump.** Input was sharing an SCTP association with a 12–16 Mbps `screen` data channel, and every click waited on `ipcRenderer.invoke`. Input now has its own high-priority `input` channel; the screen channel is low-priority and drops P-frames if more than 256 KB is queued. Host input is fire-and-forget IPC. Hardware frames are coalesced (`hwPending`) so video IPC cannot stall clicks.
- **Launch looked like a crash.** Auto-host + default tray-hide vanished the window on start. Tray is off unless you turn it on, and auto-host never hides.

### Added
- **Paste from the phone.** Toolbar **Paste** reads the mobile clipboard and the host writes it then injects Ctrl+V. If the browser blocks clipboard read, the clip sheet focuses so you can long-press paste and tap **Paste to PC**.
- **Voice input.** Toolbar **Mic** uses Web Speech (Chrome) and pastes the transcript into the remote PC.
- **One-click Setup.exe from GitHub Releases.** Default install is [github.com/Amnibro/Amni-Connect/releases/latest](https://github.com/Amnibro/Amni-Connect/releases/latest). `npm run release` publishes `Amni-Connect-Setup-${version}.exe` there. The installer drops `amni-control.exe` into `resources/` and registers `AmniControlElevated`. Packaged apps check that same release feed for updates. Windows may SmartScreen-warn because the exe is unsigned — More info → Run anyway. Fresh installs no longer default the room code to `ANTMAN-PC`; a saved code is restored from localStorage so your PC still auto-hosts.

### Notes
- The running elevated daemon still locks `rust/target/release/amni-control.exe`. Dist copies a freshly built binary from `build/amni-control.exe`. After install, restart the PC or `schtasks /run /tn AmniControlElevated` so input uses the new High-IL process.
- Packaged host needs `multer` in dependencies and a writable inbox (`%APPDATA%\amni-connect\received-files`). Writing `received-files` next to `server.js` throws inside `app.asar` and signaling never binds :3389. `AmniControlElevated` `/tr` must be a single Command — an unquoted `Program Files` path becomes `C:\Program` + args.

## v1.5.8 — no silent downscale, tray host (2026-08-30)

### Changed
- **`scaleResolutionDownBy` is locked at 1 for the life of the sender.** `lockEncodeParams` writes it (and `maintain-resolution`) on every `applyBitrate`, immediately after `addTrack`, and again from the stats loop if outbound `frameWidth` falls below the capture track or `qualityLimitationReason` is `resolution`.
- **Host chrome no longer runs `backdrop-filter: blur`.** Header and side panel are opaque `var(--surface)` so the compositor is not blurring a 1200×800 window while you stream.
- **Tray while hosting (default on).** After the room is created the host window hides to the tray; click the icon or use Show. Close-to-tray does not tear down `amni-control` or the session. Tray menu: Show / End session / Quit. Renderer stays awake (`backgroundThrottling: false`, `disable-renderer-backgrounding`) so encode and input keep running while hidden.

### Notes
- Backups: `backups/*v1.5.8_pre_tray_scale.bak`. Tray icon: `assets/icon.png`.

## v1.5.7 — sharper stream, less CPU (2026-08-29)

### Changed
- **Defaults match a desktop, not a webcam.** Host now starts at **source resolution**, **60 fps**, **12 Mbps**. WAN AIMD still drops bitrate; LAN floors at **16 Mbps** and, unless you touched the controls, forces source + 60 fps.
- **Encoder treats this as text, not video.** Capture tracks get `contentHint = 'detail'`. RTP encodings use `degradationPreference = 'maintain-resolution'` and `scaleResolutionDownBy = 1`, so a bad second drops frames instead of smearing glyphs.
- **Codec order is H.264, then VP9, then AV1; VP8 last.** Both host offer and viewer answer call `setCodecPreferences` so phones can hardware-decode.
- **Viewer zoom no longer bilinear-smears.** Zoom CSS transition is gone. Past 1.02× the `<video>` / canvas use `image-rendering: pixelated`.
- **Windows hardware path.** `amni-control` DXGI-duplicates the desktop, encodes H.264 with a Media Foundation hardware MFT when one exists (software MFT otherwise), and ships Annex-B on `127.0.0.1:7879`. Electron forwards that on an unreliable `screen` data channel; the viewer decodes with WebCodecs onto a canvas. If hello does not arrive in 2.8s, host falls back to the existing Chromium `desktopCapturer` path.

### Notes
- Backups: `backups/*v1.5.7_pre_stream_quality.bak`.
- Tests: `tests/test_stream_quality.js`; existing `test_lan_ice.js` / `test_zoom_input_gate.js`. Rebuild `amni-control.exe` (kill the elevated task first) or the host stays on Chromium capture.

## v1.5.6 — sig down: 3389 was listening but not answering (2026-08-23)

Port 3389 is forwarded, so RDP scanners pile TCP onto the Node signaling server. The listen socket stayed up while HTTP/`socket.io` stopped answering (`curl /health` timed out, host chip `sig down`). `headersTimeout`/`requestTimeout`/`keepAliveTimeout` now drop those half-open probes so a new host websocket can connect.

## v1.5.5 — Shift + anything typed nothing on the remote PC (2026-08-17)

### Fixed
- **Every capital letter and every shifted symbol was dropped; `Shift` itself arrived fine.** The
  bug is inside enigo 0.2.1. `get_scancode(c)` calls `VkKeyScanW(c)`, which returns the virtual key
  in the low byte **and the required shift state in the high byte**, then hands that whole value to
  `MapVirtualKeyW`, which takes a virtual key only. Measured on this machine:
  `'a'` → 0x0041 → scan 0x1E; `'A'` → 0x0141 → **0**; `'!'` → 0x0131 → **0**. Zero means "no
  translation", so enigo returns `InputError::Mapping` and never reaches `SendInput`. The viewer
  sends `e.key`, and for Shift+A that string *is* `"A"` — straight into the hole.
- `shift_base(c)` maps the 26 capitals and the 21 shifted symbols to the **physical key** they sit
  on, and `key_from_str` resolves single characters through it, so enigo only ever receives a
  character `VkKeyScanW` can map without a shift state. The Shift the viewer is already holding
  produces the capital, exactly as a real keyboard does.
- `wants_shift` + `Ctl.shift_held`/`auto_shift`: if a client sends `"A"` with **no** Shift of its
  own, the daemon presses Shift around the key itself and releases it on the matching key-up. A
  client that does send Shift is left alone.
- Same change fixes **modifier combos** (`Ctrl+Shift+T` sends `e.key:"T"` and died in the same
  mapping error) and **stuck keys** (release Shift before the letter and the browser reports keyup
  as `"a"` against a keydown of `"A"`; both now resolve to one physical key).
- `s.len()==1` → `s.chars().count()==1`. Byte length excluded every non-ASCII single character.

### Verified
Live probe (`tests/probe_shift_keys.py`) into a real Chrome text field, daemon confirmed at **High**
integrity, click coordinates calibrated from two injected clicks. Before: `abc`. After:
`abcABC!@?D` — capitals, symbols, and a bare uppercase with no client Shift, each arriving with
`shiftKey:true`. `errs` stayed **0** in the broken case, so the ping counters cannot be used to
detect this class of failure.

## v1.5.4 — Remote input died at the last inch: UIPI, not a wedge (2026-08-17)

### Fixed
- **The laptop could not click or type into the PC.** Every hop was healthy — viewer socket connected over Tailscale, `server.js` relayed `input-event` with no `input-dropped`, host gates (`inputLocked`, `viewOnlyToggle`) clear, Electron holding an ESTABLISHED socket to `127.0.0.1:7878`, the daemon parsing every event. The cursor did not move. `amni-control.log` had 103 x `SetCursorPos failed os=Some(6)` (ERROR_INVALID_HANDLE) with the cursor pinned at 442,1035.
- **Root cause is UIPI, not the "daemon wedge" chased in v1.5.2.** `amni-control.exe` ran at **Medium** integrity as a child of non-elevated Electron. Whenever a **High**-integrity window held foreground, Windows silently discarded its `SendInput` and failed `SetCursorPos` with error 6. Nothing in the process is broken — the same daemon works or does not work depending only on who owns the foreground window.
- A/B on one live daemon, same second, only the foreground changed:

  | foreground | daemon IL | before | after | result |
  |---|---|---|---|---|
  | WindowsTerminal (elevated) | Medium | 900,900 | 900,900 | `SetCursorPos failed os=Some(6)` |
  | electron (non-elevated) | Medium | 900,900 | 688,288 | lands |
  | WindowsTerminal (elevated) | **High** | 688,288 | 2064,864 | lands, errs=0 |

- **This retires the v1.5.2 "wedges while alive" diagnosis.** Killing the daemon appeared to restore control only because a non-elevated window happened to hold focus on the next test; it "re-wedged ~3 minutes later" when an elevated window came back to the front. Same symptom, wrong cause. Do not re-chase the wedge.
- Ruled out first, with measurements: lock screen / UAC secure desktop (`OpenInputDesktop` -> `Default`, LogonUI=0, consent=0); stale process (a fresh daemon at errs=0/misses=0/direct=false still could not move the cursor); relay failure; view-only gate.

### Changed
- Daemon now starts **elevated** through the scheduled task `AmniControlElevated` (Interactive logon, RunLevel Highest, MultipleInstances IgnoreNew, no time limit). A `requireAdministrator` manifest was rejected: its UAC prompt renders on the secure desktop, which a **remote** user cannot click.
- `main.js:trySpawnRust` runs `schtasks /run /tn AmniControlElevated`, and on a non-zero exit falls back to direct spawn with a visible `hostStatus` warning naming the consequence.
- `main.js:killStrayRust` ends the task **before** `taskkill /IM` — a Medium IL Electron cannot kill a High IL child, which would strand port 7878 across every restart.
- `window-all-closed` now calls `killStrayRust()`.

### Verified (deployed instance, live, no restart)
- Elevated daemon pid 32788 `TokenElevation=1` owns 7878; Electron reconnected on its own.
- Full chain through the real signaling server (`join ANTMAN-PC` -> `input-event`): `{0.1,0.1}` -> cursor 274,114 (expect 275,115); `{0.6,0.35}` -> cursor 1651,403 (expect 1651,403). Zero daemon errors.
- `schtasks /run` idempotent (exit 0, one daemon). `node --check main.js` clean.
- Backup `backups/main.js.v1.5.2_pre_elevated_control.bak`.

### Still open
- Input cannot reach the UAC secure desktop or the lock screen; that needs a session-0 service with `uiAccess` and a signed binary in Program Files.
- `Ctl.direct` never resets once tripped, and `heal()` rebuilds enigo even when the failing path is raw `SetCursorPos`. Harmless at High IL.

## v1.5.3 — LAN path was invisible; laptop keys dropped unmapped codes (2026-08-16)
- Chrome viewers still emit `*.local` host candidates. Signaling now tells each socket `your-lan` / `peer-lan` from the TCP source (RFC1918 only). Both ends rewrite `.local` ICE lines to that IPv4 and trickle a second candidate so host-host can nominate without mDNS. Offer/answer SDP is munged the same way before setLocal/setRemote (Chromium often ignores trickle host candidates it did not gather).

- ICE never labeled the nominated pair. Two laptops on the same Wi-Fi often settled `srflx-srflx` (public hairpin) because Chromium hid host IPs behind mDNS, so the UI had nothing called LAN and AIMD treated STUN's WAN `availableOutgoingBitrate` as the cap.
- Electron now disables `WebRtcHideLocalIpsWithMdns`. Host + viewer chips show `lan host-host` vs `wan srflx-srflx`. LAN floors AIMD at 8 Mbps and ignores the STUN avail cap.
- Hardware keys sent only `e.key`. Rust `key_from_str` ignored `Space` (string), F-keys, `KeyA`/`DigitN` codes. Viewer/Join now send `{key,code}`; rust maps both and logs unmapped.
- Tests: `node tests/test_lan_ice.js` 10/10. `cargo check` clean. Release exe not rebuilt (file locked by a running daemon).
- Not a zoom/touch regression. Same daemon wedge from v1.5.2 still kills keys if `amni-control` is wedged.

## v1.5.2 — Pinch to zoom disabled all touch control (2026-08-16)

### Fixed
- **After pinching to zoom, touch stopped controlling the PC.** `viewer.html`'s `touchmove` sent the normal single-finger branch into a *local pan* whenever `currentZoom > 1.05`: `} else if (currentZoom > 1.05) { panX += pxDx; panY += pxDy; ... }`. So once you zoomed in, dragging a finger moved the **picture** and emitted **no `mouse-move` at all** — the host cursor sat wherever it was last left. Taps were never gated, so tapping still clicked, which is exactly why it felt like "it worked for a bit then stopped" instead of "zoom broke it". Two-finger drag already pans when zoomed (that branch is untouched), so single-finger panning was redundant. The gesture map is now unambiguous: **1 finger = control, 2 fingers = zoom/pan, 3 fingers = scroll**.
- Confirmed `#touch-overlay` sits **inside** `#zoom-container`, so `getBoundingClientRect()` already carries the zoom/pan transform — `screenCoord` was correct at every zoom level and needed no change.

### Fixed — second, independent failure: the daemon wedges while alive
- Separately reproduced during the same session: `amni-control.exe` **alive**, listening on `:7878`, Electron holding an ESTABLISHED connection, every event parsed — and the cursor frozen. A direct TCP probe (bypassing the phone and the viewer entirely) commanded three distinct positions and the cursor did not move; killing the daemon and letting it respawn restored control, and ~3 minutes later the same pid was wedged again.
- v1.5.1 only heals a **dead** daemon. A wedged one passes every check — TCP connects, writes succeed, the socket never closes — so `scheduleReconnect` never fires and `trySpawnRust` never runs. Silent and permanent.
- **Why nothing was ever logged:** enigo reports the real OS error through the `log` crate (`error!("{last_err}")` inside `send_input`, whose own message is "they may have been blocked by UIPI") and `main.rs` never installed a logger — on top of `let _ = eng...` throwing away every `Result`. `amni-control.log` was empty because nothing could physically write to it. The daemon now installs `env_logger` and logs every `Err` together with `last_os_error()`.
- Daemon escalation ladder: enigo `move_mouse` → **read the cursor back** to confirm it landed → direct `SetCursorPos` after 3 misses → rebuild `Enigo` after 5 errors → `exit` after 8 misses or 3 rebuilds so the proven host respawn takes over. A poisoned mutex can no longer kill input forever (`unwrap_or_else(|e| e.into_inner())`), and a watchdog thread exits the process if the input lock is held >10s (i.e. blocked inside the OS call).
- New `{"type":"ping"}` → `pong` (`errs`/`rebuilds`/`misses`/`direct`/`display`/`last`). `main.js` pings every 5s, calls `restartRust()` when no pong arrives within 15s (20s cooldown), and `restartRust()` uses `taskkill /IM` so it can clear a wedged daemon it did not spawn.

### Corrected
- The v1.5.1 note claiming the dev environment "cannot move the real OS cursor" is **wrong**. A PowerShell `SetCursorPos` P/Invoke from the same shell moved the physical cursor (2104,839 → 700,700) at the moment `amni-control` could not. Cursor position is scriptable here for both read and write, so "did the cursor actually move" is machine-verifiable. Believing otherwise is what let the wedge hide behind "enigo returned `Ok`".

### Verified
- `cargo build --release` clean; fresh binary logs `[amni-control] v1.5.2 ready display 2752x1152`.
- Commanded 0.25/0.5/0.75 → cursor landed on **688,288 / 1376,576 / 2064,864** exactly; `ping` → `{"type":"pong","errs":0,"misses":0,"direct":false,...}`.
- Wedge simulated for real by suspending the daemon (`NtSuspendProcess`) — it kept accepting TCP with the cursor frozen, and the host detected it and brought a fresh daemon back.
- `tests/test_zoom_input_gate.js` extracts the **real** `touchmove` handler source out of `viewer.html` and drives it against a DOM shim: **3/3 pass on the fix, and the pre-fix backup fails the zoomed-drag case with `got [nothing]`** — the test is provably sensitive to the bug.
- Served copy checked live: `GET /viewer` md5 == local `viewer.html`.
- `node --check main.js` clean.
- **Not verified: an actual pinch on a real phone.** Gestures were driven through the extracted handler, not real touch events on a device.

### Notes
- Backups: `backups/viewer.html.v1.5.2_pre_zoom_input_gate.bak`, `backups/main.js.20260816_112724_pre_wedge_watchdog.bak`, `backups/main.rs.20260816_112724_pre_wedge_watchdog.bak`. Checklist: `docs/checklists/checklist_input_wedge_v1.5.2.md`.
- `rust/Cargo.toml` gains `log`, `env_logger` and win-gated `windows 0.56` (all already vendored — builds offline).

## v1.5.1 — Rust input daemon never self-healed after dying (2026-08-16)

### Fixed
- **Touch (and mouse) input from the phone did nothing — no cursor movement at all.** Root cause was not touch-vs-mouse event handling (`viewer.html`'s touch handlers are already comprehensive: drag, tap-to-click, drag-lock, pinch/pan/zoom, multi-finger scroll and right/middle-click). The real bug: `spawnRust()` in `main.js` only decides once, at Electron startup, whether to spawn `amni-control.exe` — it probes `:7878` and skips spawning if *anything* is already listening (normal, avoids duplicate copies). But if that pre-existing process later dies, nothing ever notices: `scheduleReconnect()` only retried the bare TCP connection forever, with no path back to actually launching the binary. Measured live: host app had been running 2h50m, `amni-control.log` was completely empty (this instance never spawned its own copy), and `:7878` had nothing listening — every input event, touch or mouse, was being correctly generated and correctly relayed to the host, then silently vanishing at the last hop.
- Fix: `trySpawnRust()` (cooldown-gated, 5s) now runs from inside the reconnect cycle too, not just the startup probe — if there's no live `rustProcess` handle and nothing answers on `:7878`, it (re)launches the binary. Bounded by the cooldown so a genuinely broken binary can't spawn-loop.

## v1.5.0 — Radio chips, ICE restart, QR pair (2026-08-13)
- Viewer + host show **sig / rtc / input** chips (P2P vs relay vs dead).
- ICE restart + peer rebuild on `failed`/`disconnected`. Viewer waits and reclaims the room instead of hard-disconnect on one `host-disconnected`.
- Host QR (`GET /qr`) after room create — scan to join. Default bitrate **4 Mbps** (AIMD still climbs).
- Stats / signal pill every 500ms. Braid graphite + brass chrome.
- Electron Join input rides the data channel (not local enigo).
- Tests: `docs/checklists/checklist_radio_v1.5.0.md`. Backup: `backups/*v1.5.0_radio.bak`.

## v1.4.1 — Viewer zoom: resolution-aware cap, multiplicative step, anchor fix (2026-08-09)

### Fixed
- **Zoom stopped at 4x — and on a phone that never even reached the source pixels.** The cap was a literal `Math.min(4, …)` duplicated in the toolbar and pinch paths. A 390px-wide phone showing a 1080p desktop displays the stream at **0.203 CSS px per source pixel**, so the old 4x ceiling landed at **0.81 CSS px per source pixel — still shrunk below 1:1**. You could never magnify a single source pixel to full size, which is exactly why it read as "there's a limit". The cap is now computed from the actual stream: `maxZoom()` allows up to **4 CSS px per source pixel**, floored at 4x and hard-capped at 32x. Measured on the real functions: 1080p → **19.69x**, 720p → 13.13x, 1440p → 26.26x, 4K → 32x (ceiling).
- **The zoom button went numb as you zoomed in.** The step was *additive* (`zoom(±0.2)`), so one press changed the view 20% at 1x but only 6.7% at 3x and 2.5% at 8x — the deeper you went, the less the button did. Pinch was already multiplicative, so the two disagreed. Both now share one multiplicative step (`×1.25` / `×0.8`, an exact round-trip back to 1.0), so a press means the same 25% at every depth.
- **Zoom anchoring drifted, and worse the further you zoomed.** `panX/panY` translate `#zoom-container` inside `#viewer-screen`, but the anchor point handed to the zoom math was a raw **viewport** coordinate — the two frames differ by the status-bar height (~37px). Every step pulled the content off the intended anchor. **Measured: 9.25px per step, 104px after six steps.** Now 0.00px, verified by round-tripping the content point back through the transform. This would have made a higher cap feel broken, so it had to go with it.
- **Ctrl+wheel now zooms at the cursor** instead of the screen centre.

### Changed
- All clamping goes through one `setZoom(next, clientX, clientY)`; the toolbar, pinch and ctrl+wheel paths no longer carry their own copies of the limits.
- Zoom via the toolbar shows the level as a toast (`2.4×`).
- `package.json` version bumped `1.0.0` → `1.4.1` (it had drifted three releases behind the changelog).

### Notes
- Backup: `backups/viewer.html.v1.4.1_pre_zoom_limit.bak`. Checklist: `docs/checklists/checklist_zoom_limit_v1.4.1.md`.
- Verified: `node --check` on the extracted inline script; a harness that **extracts the real `getVideoRect`/`clampPan`/`maxZoom`/`setZoom`/`zoom` source text out of `viewer.html`** and drives it against a DOM shim (390×763 viewport, 1920×1080 source) — cap, saturation, pan clamp at depth, pinch-anchor invariance, and the 0.5x floor all checked; plus a separate numeric comparison of old-vs-new anchor drift.
- **Not verified on a real phone or in a browser** — the chrome-devtools MCP browser was already running under another instance and was not killed. Pinch gestures were exercised through `setZoom` directly, not through real touch events.
- **`index.html` (Electron Join mode) has no zoom system at all** and was not touched.
- **Zoom past the source resolution is upscale, not detail.** The host defaults to **1080p** (`resolutionSelect` in `index.html`); Source/1440p/4K are already in that dropdown and cost bandwidth. The viewer cap follows whatever the host sends.

## v1.4.0 — Input reliability: P2P input, room reclaim, right-click dedupe (2026-08-09)

### Fixed
- **Right-click did nothing.** A physical right-click fires **both** `mousedown` (button 2) and `contextmenu`, and both handlers sent `mouse-right-click` — so the host received **two**. The first opened the context menu; the second clicked into it and dismissed it, which looks exactly like right-click being ignored. All four call sites (two-finger tap, long-press, `contextmenu`, physical button 2) now go through `sendRightClick()`, which collapses repeats inside 350 ms. **Measured: 2 handlers fire, 1 event sent, 1 suppressed.**
- **Input died while video stayed perfect — the big one.** Video rides WebRTC **peer-to-peer**, but input rode socket.io through the **relay**. Two independent transports, so a healthy sub-50ms picture said nothing about whether control was arriving. `index.html`'s `socket.on('connect')` only *logged* on reconnect and never re-emitted `create-room`, while `server.js` **deletes** the room the moment the host socket drops. One websocket blip therefore left the host permanently unroutable, with `server.js` discarding every event in `if (room)` — **no else branch, no error, no log**. That is the "often doesn't respond at all even on a good connection" report.
  - **Control test, not inference:** pre-fix host after a simulated relay blip → `Room not found`, input dead. Fixed host, identical blip → room reclaimed, input routed. Same script both runs.
- **Input now rides the WebRTC data channel** (peer-to-peer, the same path as video), with the relay kept only as fallback. A data channel already existed for clipboard/file transfer, so this reuses it: viewer sends `{type:'input',ev}`, host applies it in `setupDataChannel.onmessage` behind the existing `inputLocked` / view-only guards. Input is now as resilient as the picture.
- **Host reclaims its room on reconnect** — `create-room` is re-emitted with the existing `roomId`. The server's reclaim path already handled a host taking a fixed code back; nothing was calling it.
- **Server grace period.** A host disconnect no longer nukes the room instantly; it waits `HOST_GRACE_MS` (8s) and only tears down if the host has not returned. Viewers are no longer kicked by a momentary blip.
- **Dropped input is now reported, not swallowed.** `server.js` replies `input-dropped` (`no-room` / `host-offline`) and the viewer surfaces a toast plus a status line. Silence was what made this so hard to see.
- **Socket.io transports were websocket-only** on both ends, with no polling fallback — brittle on mobile networks (cell/wifi handoff, doze). Now `['websocket','polling']`.

### Notes
- Backups: `backups/{viewer.html,index.html,server.js}.v_input_reliability.bak`.
- Verified: `node --check` on `server.js` and on the extracted inline script of both HTML files; live end-to-end input routing test against the running host; before/after control test across a relay blip; right-click dedupe measured in-browser.
- **Not verified on a real phone** — all tests were driven from this PC (synthetic viewer + browser events). The touch-specific paths (two-finger tap, long-press) share the same `sendRightClick()`/`sendInput()` plumbing that was tested, but no physical device was used.

## v1.3.1 — Scroll wheel direction (2026-08-06)

### Fixed
- **Mouse wheel was inverted on the host.** Browser `deltaY > 0` (scroll down) was sent as `dy: -1`, but enigo treats positive vertical scroll as down. Flipped the sign in both `viewer.html` (laptop/browser control) and `index.html` (Electron Join). Touch two/three-finger scroll was already correct and left alone.
- Backups: `backups/viewer.html.v1.3.1_pre_scroll_invert.bak`, `backups/index.html.v1.3.1_pre_scroll_invert.bak`.

## v1.0.1 — Single instance + Chromium cache paths (2026-08-02)

### Fixed
- **Console spam:** `Unable to move the cache: Access is denied`, `Gpu Cache Creation failed`, intermittent `DxgiDuplicatorController` / keyed mutex abandoned.
- **Cause:** many simultaneous Electron processes (repeat `npm start`) fighting over the default Chromium disk/GPU cache; DXGI fails when multi-instance or another capturer is mid-frame.
- **Fix (`main.js`):** `requestSingleInstanceLock` (second launch focuses existing window); `userData` + disk/GPU cache under `%AppData%/amni-connect`; `disable-gpu-shader-disk-cache`; softer `get-sources` error handling.
- Backup: `backups/main.js.v_cache_single_instance.bak`. Close old Electron windows once, then start again.

## v1.3.0 — Reconnect-storm fix + phone→PC file transfer (2026-07-29)

### Fixed
- **Cursor/click input from the phone stopped working entirely.** Root cause: `connectRustClient()` in `main.js` registered both an `error` and a `close` handler on the Rust backend socket, and each independently scheduled a reconnect via `setTimeout`. A real TCP socket always fires `error` *then* `close` on a failed connection, so a single drop scheduled two reconnect attempts, which (if still failing) each scheduled two more — an exponential storm. Live on this machine, two host windows had ballooned to 2.2 GB and 3.1 GB of RAM, gone "Not Responding", and accumulated 16,000+ stray sockets to `127.0.0.1:7878`. A hung renderer never runs the `socket.on('input-event', ...)` handler, so mouse/keyboard events from the phone were silently dropped. Fixed by gating reconnects behind a single in-flight timer, only scheduling from `close`, and destroying the previous socket before reconnecting. Also piped the Rust child process's stdout/stderr to `amni-control.log` in the Electron userData folder instead of discarding it, for future diagnosis.

### Added
- **File transfer, phone → PC.** The viewer toolbar has a new **Send** button (file picker) that uploads via `POST /upload` (multipart, `multer`) to the signaling server, with a live progress bar during transfer. Received files land in `received-files/` next to `server.js` (override with `INBOX_DIR` in `.env`). The host app logs a confirmation line with filename and size when a file arrives.

## v1.2.1 — On-screen key long-press fix + auto-host (2026-05-31)

### Fixed
- **On-screen keys no longer trigger Android's long-press context menu.** Holding the on-screen **Backspace** (or any repeat key) for key-repeat eventually made Android pop its "download / share / print" callout, hijacking the hold. `bindPress` now suppresses `contextmenu` + `selectstart` on every bound key and sets `touch-action:none` / `user-select:none` / `-webkit-touch-callout:none` on the element, so a sustained hold just repeats the key.

### Added
- **Auto-host on launch.** When `index.html` opens with a room code present in the room field, it now auto-selects Host mode and starts hosting immediately (no manual "Start Hosting" click) — needed so a host PC can be brought up *remotely* (you can't click the button when you're not at the machine). Triggered only when sources are available and not already hosting.
- Setting a persistent room code in the host field makes the app **auto-host that room on launch**, so an unattended PC comes back up hosting without anyone clicking Start Hosting.

## v1.2.0 — Laptop Input + Key-Repeat (2026-05-26)

### Added
- **Desktop/laptop control in the viewer.** `viewer.html` previously bound only touch events, so a laptop's physical mouse and keyboard did nothing. Added a parallel desktop input layer on the touch overlay: `mousedown/mousemove/mouseup/mouseleave/dblclick` → `mouse-move/-down/-up/-right-click/-middle-click` (cursor-follow + click + drag, honours Touch vs Pad mode), and hardware `keydown/keyup` forwarded straight to the host as `key-down/key-up`.
- **Mouse-wheel rescale + scroll.** `Ctrl+wheel` zooms the view (reuses `zoom()`); a plain wheel emits `mouse-scroll`.
- **Press-and-hold key repeat** on the on-screen keyboard. `bindPress` now takes a `repeat` flag: 380 ms hold → ~18/s repeat, stopped at the document level so it survives a mid-hold keyboard re-render. Enabled for character keys, space, backspace, and arrows. Physical-keyboard repeat comes free from the browser's native `keydown` auto-repeat.

## v1.1.0 — Launcher UX + Auto-Bitrate (2026-04-29)

### Added
- **Segmented Host / Join switcher** at the top of Session Control. Replaces the previous stacked layout — only the active mode's controls are shown, cutting visual clutter on the launcher.
- **Auto Bitrate toggle (default ON).** AIMD controller adapts the encoder's `maxBitrate` to live network conditions. Reads `currentRoundTripTime`, `availableOutgoingBitrate`, `fractionLost` (from `remote-inbound-rtp`), and `qualityLimitationReason` (from `outbound-rtp`). Reduces ×0.82 on bad signal; adds +500 kbps on clean signal. Hard-capped at `availableOutgoingBitrate × 0.92`. Bounds: 500 – 20 000 kbps. 2 s tick (re-uses existing stats loop — no double polling).
- **Signal Quality pill** (Excellent / Good / Fair / Poor) in the Connection Stats grid + a matching pill in the mobile viewer's status bar. Color-coded dot + label so the user sees *why* quality dropped without parsing raw numbers.
