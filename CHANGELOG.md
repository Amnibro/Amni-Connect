# Amni-Connect Changelog

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
