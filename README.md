# Amni-Connect — E2EE Rust + Electron Remote Desktop

![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-00ffaa)
![Source](https://img.shields.io/badge/Source-Available-lightgrey)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-informational)

**A secure, modern alternative to Windows Remote Desktop and Teamviewer.**

## Download

**[Releases → latest](https://github.com/Amnibro/Amni-Connect/releases/latest)**

| Platform | Install |
| --- | --- |
| **Windows** | [Amni-Connect-Setup-1.5.11.exe](https://github.com/Amnibro/Amni-Connect/releases/latest/download/Amni-Connect-Setup-1.5.11.exe) — run it, allow UAC. If SmartScreen: **More info → Run anyway**. |
| **Linux (AppImage)** | [Amni-Connect-1.5.11.AppImage](https://github.com/Amnibro/Amni-Connect/releases/latest/download/Amni-Connect-1.5.11.AppImage) — `chmod +x` then run. Works on most distros. |
| **Debian / Ubuntu / Mint** | [Amni-Connect-1.5.11.deb](https://github.com/Amnibro/Amni-Connect/releases/latest/download/Amni-Connect-1.5.11.deb) — `sudo apt install ./Amni-Connect-1.5.11.deb` |
| **Fedora / RHEL / openSUSE** | [Amni-Connect-1.5.11.rpm](https://github.com/Amnibro/Amni-Connect/releases/latest/download/Amni-Connect-1.5.11.rpm) — `sudo dnf install ./Amni-Connect-1.5.11.rpm` |

Linux one-liner (downloads the AppImage into `~/.local/bin` and adds a desktop entry):

```bash
curl -fsSL https://raw.githubusercontent.com/Amnibro/Amni-Connect/main/scripts/install-linux.sh | bash
```

Use `| bash -s -- --deb` or `| bash -s -- --rpm` for distro packages instead. No npm or cargo. The viewer is still any browser on phone/tablet.

### Architecture
- **Electron** — Cross-platform desktop app (Windows, macOS, Linux)
- **Rust** — High-performance input controller (`enigo` for mouse/keyboard simulation)
- **WebRTC** — Peer-to-peer encrypted screen streaming (E2EE)
- **Socket.IO** — Signaling server (can be hosted anywhere)

### Core Feature Implemented
> When a device connects to the server, the **viewer immediately gains control** of the host's desktop.

### Project Structure
```
Amni-Connect/
├── main.js              # Electron main process + WebRTC
├── preload.js           # Secure IPC bridge
├── index.html           # Beautiful E2EE UI
├── server.js            # Signaling server
├── rust/
│   ├── Cargo.toml
│   └── src/main.rs      # Rust input daemon (mouse + keyboard)
├── package.json
└── README.md
```

### Run from source (developers)

1. **Start the signaling server**
   ```bash
   npm run server
   ```

2. **Build & run the Rust input controller**
   ```bash
   cd rust
   cargo build --release
   ./target/release/amni-control
   ```

3. **Launch the Electron app**
   ```bash
   npm start
   ```

### Linux setup notes

**Packaged installs** (AppImage / .deb / .rpm) already include `amni-control`. Runtime libs for input:

```bash
# Debian / Ubuntu / Mint (also pulled by the .deb)
sudo apt install libxdo3 libxkbcommon0 libxtst6

# Fedora
sudo dnf install libxdo libxkbcommon libXtst
```

AppImage needs FUSE (`libfuse2` on Ubuntu 22+, or use `--appimage-extract-and-run`). Wayland: screen capture goes through PipeWire (Electron flags in `main.js`); the desktop portal asks which screen to share on first host.

**Building from source** still needs the `-dev` packages before `cargo build`:

```bash
# Debian / Ubuntu
sudo apt install libxdo-dev libxkbcommon-dev libxtst-dev pkg-config

# Fedora
sudo dnf install libxdo-devel libxkbcommon-devel libXtst-devel
```

### Usage
- Click **"Start Hosting (Share Screen)"** on the machine you want to control.
- On the second device, enter the room code → you instantly gain mouse + keyboard control.
- All video is sent over WebRTC (end-to-end encrypted).
- Input events are forwarded securely through the Rust backend.

---

**Next steps you can request:**
- Full Rust + Tauri rewrite (lighter than Electron)
- End-to-end encryption on the signaling layer (libsodium / Noise protocol)
- Auto-start Rust binary from Electron
- Bandwidth optimization + VP9 codec
- Multi-monitor support

## License

**Source-available under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).**

Allowed:
- Personal use
- Self-hosting on your own hardware
- Study, modify, fork, redistribute with attribution
- Security audit and research

Not allowed (without a commercial license):
- Commercial hosted services, SaaS offerings, or managed-remote-desktop products built on this code
- Reselling binaries or derivative products
- Bundling into a for-profit offering

> Source-available, not permissive. The source is public so you can trust it and self-host; the NC clause is how the project stays sustainable. Commercial licenses are cheap and friendly — email **amnibro7@gmail.com**.

See [`LICENSE`](LICENSE) for the full text + trademark notice.

## Links

- Product page — https://amni-scient.com/amni-connect
- Privacy policy — https://amni-scient.com/privacy-connect
- Contact — amnibro7@gmail.com
- Support — https://ko-fi.com/amnibro
