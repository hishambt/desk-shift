use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

/// Serializable view of one virtual desktop, sent to the frontend.
#[derive(Serialize)]
struct DesktopInfo {
    index: u32,
    name: String,
}

// ─────────────────────────────────────────────────────────────────────────
//  Tauri commands (invoked from the React frontend via `invoke`)
// ─────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_desktops() -> Result<Vec<DesktopInfo>, String> {
    let mut out = Vec::new();
    for d in winvd::get_desktops().map_err(|e| e.to_string())? {
        let index = d.get_index().map_err(|e| e.to_string())?;
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
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn switch_desktop(index: u32) -> Result<(), String> {
    winvd::switch_desktop(index).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_desktop() -> Result<(), String> {
    winvd::create_desktop()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_desktop(index: u32) -> Result<(), String> {
    let count = winvd::get_desktop_count().map_err(|e| e.to_string())?;
    if count <= 1 {
        return Err("Cannot remove the last desktop".into());
    }
    let fallback = if index == 0 { 1 } else { index - 1 };
    winvd::remove_desktop(index, fallback).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_active_window(index: u32) -> Result<(), String> {
    let hwnd = GetForegroundWindow();
    winvd::move_window_to_desktop(index, &hwnd).map_err(|e| e.to_string())
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

fn move_foreground_window(index: u32) {
    let hwnd = GetForegroundWindow();
    let _ = winvd::move_window_to_desktop(index, &hwnd);
}

fn close_current_desktop() {
    let current = match winvd::get_current_desktop().and_then(|d| d.get_index()) {
        Ok(i) => i,
        Err(_) => return,
    };
    let count = match winvd::get_desktop_count() {
        Ok(c) => c,
        Err(_) => return,
    };
    if count <= 1 {
        return;
    }
    let fallback = if current == 0 { 1 } else { current - 1 };
    let _ = winvd::remove_desktop(current, fallback);
}

fn on_shortcut(shortcut: &Shortcut) {
    if let Some(i) = digit_index(shortcut, false) {
        let _ = winvd::switch_desktop(i);
    } else if let Some(i) = digit_index(shortcut, true) {
        move_foreground_window(i);
    } else if shortcut.matches(Modifiers::ALT, Code::KeyN) {
        let _ = winvd::create_desktop();
    } else if shortcut.matches(Modifiers::ALT, Code::KeyW) {
        close_current_desktop();
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
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts(SHORTCUTS)?
                        .with_handler(|_app, shortcut, event| {
                            if event.state == ShortcutState::Pressed {
                                on_shortcut(shortcut);
                            }
                        })
                        .build(),
                )?;
            }

            // System tray: reopen the window or quit.
            let open = MenuItem::with_id(app, "open", "Open DeskShift", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            TrayIconBuilder::new()
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
