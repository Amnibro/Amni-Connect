# Amni-Connect Changelog

## v1.1.0 — Launcher UX + Auto-Bitrate (2026-04-29)

### Added
- **Segmented Host / Join switcher** at the top of Session Control. Replaces the previous stacked layout — only the active mode's controls are shown, cutting visual clutter on the launcher.
- **Auto Bitrate toggle (default ON).** AIMD controller adapts the encoder's `maxBitrate` to live network conditions. Reads `currentRoundTripTime`, `availableOutgoingBitrate`, `fractionLost` (from `remote-inbound-rtp`), and `qualityLimitationReason` (from `outbound-rtp`). Reduces ×0.82 on bad signal; adds +500 kbps on clean signal. Hard-capped at `availableOutgoingBitrate × 0.92`. Bounds: 500 – 20 000 kbps. 2 s tick (re-uses existing stats loop — no double polling).
- **Signal Quality pill** (Excellent / Good / Fair / Poor) in the Connection Stats grid + a matching pill in the mobile viewer's status bar. Color-coded dot + label so the user sees *why* quality dropped without parsing raw numbers.
- **Loss stat box** in the host stat grid alongside Bitrate / FPS / Latency / Resolution.
- **LIVE pill** on the Stream Settings header that lights up the moment a session is active — communicates that resolution / FPS / bitrate / audio edits apply mid-session without renegotiation.

### Changed
- Stream Settings panel stays visible & editable for the whole session lifecycle (no longer collapsed on connect).
- Quality slider relabeled "Bitrate" — flipping the slider while Auto is on cleanly hands authority back to the user (auto auto-disables).
- The joining (Electron) side disables host-only controls (Resolution / FPS / Audio / Bitrate / Auto) — they're a no-op for receivers, and disabling makes that obvious.

### Files touched
- `index.html` — segmented switcher CSS + DOM, AB controller, signalLabel(), autoTick(), updated stats loop
- `viewer.html` — signal pill in status bar + lightweight viewer-side stats loop
- `ARCHITECTURE_MAP.md` — Amni-Connect entry expanded with Auto-Bitrate + Launcher UX detail

### Backups
- `backups/index.html.v_pre_launcher_autobitrate.bak`
- `backups/viewer.html.v_pre_launcher_autobitrate.bak`

### Notes
- E2EE intact — no new server messages or sockets. Auto-bitrate is purely a local sender-side encoder mutation.
- Rust input backend + signaling server unchanged.
