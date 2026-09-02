# Amni-Connect Changelog

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
