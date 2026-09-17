use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::thread::sleep;
use std::time::Duration;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, GetForegroundWindow, GetWindowTextLengthW, IsIconic, IsWindow,
    SetForegroundWindow,
};

/// Serializable view of one virtual desktop, sent to the frontend.
#[derive(Serialize)]
struct DesktopInfo {
    index: u32,
    name: String,
}

/// Tracks the last-active window on each desktop (mirrors the AHK `Map`).
/// Stored as `isize` because raw pointers aren't `Send`/`Sync` (required for `static`).
static DESKTOP_WINDOWS: OnceLock<Mutex<HashMap<u32, isize>>> = OnceLock::new();

fn desktop_windows() -> &'static Mutex<HashMap<u32, isize>> {
    DESKTOP_WINDOWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn hwnd_to_isize(hwnd: HWND) -> isize {
    hwnd.0 as isize
}

fn hwnd_from_isize(v: isize) -> HWND {
    HWND(v as *mut core::ffi::c_void)
}

/// `winvd::Error` doesn't implement `Display`, so convert via `Debug`.
fn vd_err(e: winvd::Error) -> String {
    format!("{e:?}")
}

/// Focus a window, bypassing the foreground lock (mirrors AHK's
/// `AllowSetForegroundWindow(-1)` + `WinActivate`).
fn focus_window(hwnd: HWND) {
    unsafe {
        let _ = AllowSetForegroundWindow(u32::MAX); // ASFW_ANY
        let _ = SetForegroundWindow(hwnd);
    }
}

/// A stored window is restorable only if it still exists, isn't minimized,
/// has a title, and is still on the target desktop.
fn is_valid_window_on_desktop(hwnd: HWND, desktop: u32) -> bool {
    let alive =
        unsafe { IsWindow(hwnd).0 != 0 && IsIconic(hwnd).0 == 0 && GetWindowTextLengthW(hwnd) > 0 };
    alive && winvd::is_window_on_desktop(desktop, hwnd).unwrap_or(false)
}

// ─────────────────────────────────────────────────────────────────────────
//  Core desktop actions (shared by hotkeys and UI commands)
// ─────────────────────────────────────────────────────────────────────────

fn switch_to_desktop(num: u32) -> Result<(), String> {
    // Remember the current desktop's active window before leaving.
    if let Ok(cur) = winvd::get_current_desktop().and_then(|d| d.get_index()) {
        let fg = unsafe { GetForegroundWindow() };
        if !fg.0.is_null() {
            desktop_windows()
                .lock()
                .unwrap()
                .insert(cur, hwnd_to_isize(fg));
        }
    }

    winvd::switch_desktop(num).map_err(vd_err)?;
    sleep(Duration::from_millis(30));

    // Restore the last-active window on the target desktop (if any).
    let stored = desktop_windows().lock().unwrap().get(&num).copied();
    if let Some(v) = stored {
        let hwnd = hwnd_from_isize(v);
        if is_valid_window_on_desktop(hwnd, num) {
            focus_window(hwnd);
            return Ok(());
        }
        desktop_windows().lock().unwrap().remove(&num); // stale entry
    }
    Ok(())
}

fn move_to_desktop(num: u32) -> Result<(), String> {
    let fg = unsafe { GetForegroundWindow() };
    if fg.0.is_null() {
        return Err("No active window".into());
    }
    let fg_val = hwnd_to_isize(fg);

    winvd::move_window_to_desktop(num, &fg).map_err(vd_err)?;

    // Drop stale "last active" entries pointing at this window on other desktops.
    {
        let mut map = desktop_windows().lock().unwrap();
        let mut stale = Vec::new();
        for (k, v) in map.iter() {
            if *v == fg_val && *k != num {
                stale.push(*k);
            }
        }
        for k in stale {
            map.remove(&k);
        }
    }

    // Follow the window to the target desktop.
    winvd::switch_desktop(num).map_err(vd_err)?;
    sleep(Duration::from_millis(30));

    desktop_windows().lock().unwrap().insert(num, fg_val);
    focus_window(fg);
    Ok(())
}

fn create_and_switch() -> Result<(), String> {
    let new_index = winvd::create_desktop()
        .and_then(|d| d.get_index())
        .map_err(vd_err)?;
    winvd::switch_desktop(new_index).map_err(vd_err)
}

fn remove_desktop_at(index: u32) -> Result<(), String> {
    let count = winvd::get_desktop_count().map_err(vd_err)?;
    if count <= 1 {
        return Err("Cannot remove the last desktop".into());
    }
    let fallback = if index == 0 { 1 } else { index - 1 };
    winvd::remove_desktop(index, fallback).map_err(vd_err)?;
    desktop_windows().lock().unwrap().remove(&index);
    Ok(())
}

fn close_current_desktop() -> Result<(), String> {
    let current = winvd::get_current_desktop()
        .and_then(|d| d.get_index())
        .map_err(vd_err)?;
    remove_desktop_at(current)
}

// ─────────────────────────────────────────────────────────────────────────
//  Tauri commands (invoked from the React frontend via `invoke`)
// ─────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_desktops() -> Result<Vec<DesktopInfo>, String> {
    let mut out = Vec::new();
    for d in winvd::get_desktops().map_err(vd_err)? {
        let index = d.get_index().map_err(vd_err)?;
        let name = match d.get_name() {
            Ok(n) if !n.trim().is_empty() => n,
            _ => format!("Desktop {}", index + 1),
        };
        out.push(DesktopInfo { index, name });
    }
    Ok(out)
}

#[tauri::command]
fn current_desktop() -> Result<u32, String> {
    winvd::get_current_desktop()
        .and_then(|d| d.get_index())
        .map_err(vd_err)
}

#[tauri::command]
fn switch_desktop(index: u32) -> Result<(), String> {
    switch_to_desktop(index)
}

#[tauri::command]
fn create_desktop() -> Result<(), String> {
    create_and_switch()
}

#[tauri::command]
fn remove_desktop(index: u32) -> Result<(), String> {
    remove_desktop_at(index)
}

#[tauri::command]
fn move_active_window(index: u32) -> Result<(), String> {
    move_to_desktop(index)
}

// ─────────────────────────────────────────────────────────────────────────
//  Global hotkeys
// ─────────────────────────────────────────────────────────────────────────

const DIGIT_CODES: [Code; 10] = [
    Code::Digit1,
    Code::Digit2,
    Code::Digit3,
    Code::Digit4,
    Code::Digit5,
    Code::Digit6,
    Code::Digit7,
    Code::Digit8,
    Code::Digit9,
    Code::Digit0,
];

/// Alt+1..0 → desktop index 0..9 (Alt+1 = 0 … Alt+9 = 8, Alt+0 = 9).
/// Alt+Shift+1..0 → move the active window to that desktop (and follow).
fn digit_index(shortcut: &Shortcut, with_shift: bool) -> Option<u32> {
    let modifiers = if with_shift {
        Modifiers::ALT | Modifiers::SHIFT
    } else {
        Modifiers::ALT
    };
    DIGIT_CODES
        .iter()
        .position(|code| shortcut.matches(modifiers, *code))
        .map(|i| i as u32)
}

fn on_shortcut(shortcut: &Shortcut) {
    if let Some(i) = digit_index(shortcut, false) {
        let _ = switch_to_desktop(i);
    } else if let Some(i) = digit_index(shortcut, true) {
        let _ = move_to_desktop(i);
    } else if shortcut.matches(Modifiers::ALT, Code::KeyN) {
        let _ = create_and_switch();
    } else if shortcut.matches(Modifiers::ALT, Code::KeyW) {
        let _ = close_current_desktop();
    }
}

const SHORTCUTS: [&str; 22] = [
    "alt+1",
    "alt+2",
    "alt+3",
    "alt+4",
    "alt+5",
    "alt+6",
    "alt+7",
    "alt+8",
    "alt+9",
    "alt+0",
    "alt+shift+1",
    "alt+shift+2",
    "alt+shift+3",
    "alt+shift+4",
    "alt+shift+5",
    "alt+shift+6",
    "alt+shift+7",
    "alt+shift+8",
    "alt+shift+9",
    "alt+shift+0",
    "alt+n",
    "alt+w",
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_desktops,
            current_desktop,
            switch_desktop,
            create_desktop,
            remove_desktop,
            move_active_window,
        ])
        .on_window_event(|window, event| {
            // Close-to-tray: hide instead of exiting so it keeps running in the tray.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                // Register the plugin (manager + state) with no shortcuts yet.
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;

                // Register each shortcut individually — a conflict (e.g. another
                // app holding Alt+1) logs a warning instead of crashing the app.
                for s in SHORTCUTS {
                    if let Err(e) = app
                        .global_shortcut()
                        .on_shortcut(s, |_app, shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                on_shortcut(shortcut);
                            }
                        })
                    {
                        eprintln!("[deskshift] could not register hotkey '{s}': {e}");
                    }
                }
            }

            let open = MenuItem::with_id(app, "open", "Open DeskShift", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::new()
                .icon(tauri::include_image!("icons/icon.ico"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
