# DeskShift

**Less mouse, more keyboard.** Instant virtual-desktop management for Windows.

DeskShift gives you keyboard-driven control over Windows virtual desktops — switch, move windows, create, and close — without touching the mouse.

> ⚠️ DeskShift is built on Windows' *undocumented* virtual-desktop COM interfaces (via the [`winvd`](https://crates.io/crates/winvd) crate). These are not a supported public API and Microsoft changes them between Windows builds. **Requires Windows 11 24H2 (build 26100.2605) or later.**

## Features

- **Switch desktops instantly** — `Alt+1` … `Alt+0`
- **Move the active window** to another desktop — `Alt+Shift+1` … `Alt+Shift+0`
- **Create** a desktop — `Alt+N`
- **Close** the current desktop — `Alt+W`
- **System tray** — reopen the window or quit
- A live view of your desktops with one-click actions

## Tech stack

- [Tauri 2](https://tauri.app) (Rust backend)
- [React](https://react.dev) + TypeScript + Vite (frontend)
- [`winvd`](https://crates.io/crates/winvd) — Windows virtual-desktop bindings
- [`tauri-plugin-global-shortcut`](https://v2.tauri.app/plugin/global-shortcut/) — global hotkeys

## Development

### Prerequisites

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). On Windows you need:

- [Rust](https://rustup.rs) (MSVC toolchain)
- Microsoft C++ Build Tools ("Desktop development with C++")
- Node.js (LTS)

### Run

```sh
npm install
npm run tauri dev
```

### Build

```sh
npm run tauri build
```

## License

MIT
