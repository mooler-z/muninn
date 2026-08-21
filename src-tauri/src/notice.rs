//! A short-lived note in the corner.
//!
//! Its own window rather than a state of the panel. The panel is the record of
//! a finished turn and a queue you can page through; a notice is neither, and
//! borrowing that window would mean a passing remark about the wifi could
//! shoulder a summary off the screen before it had been read.
//!
//! Five seconds, then it goes on its own. That is the opposite of the panel's
//! rule — the panel waits because you walked away and it has something you
//! asked for. This has news you did not ask for and cannot act on from here,
//! so it says it and leaves.

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

pub const NOTICE: &str = "notice";

/// What to draw. `urgent` earns the accent; anything else stays in ink.
pub const EVENT_NOTICE: &str = "muninn://notice";

/// How long it stays. Long enough to read twice, short enough that nobody
/// reaches for it.
const LINGER: std::time::Duration = std::time::Duration::from_secs(5);

/// Bumped by every notice, so an earlier one's timer cannot close a later one.
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Notice {
    title: String,
    body: String,
    urgent: bool,
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(NOTICE)
}

pub fn show(app: &AppHandle, title: &str, body: &str, urgent: bool) {
    let payload = Notice {
        title: title.to_string(),
        body: body.to_string(),
        urgent,
    };
    let mine = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();

    // Windows are main-thread work and this is called from the network
    // watcher's thread.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(window) = window(&handle) else { return };
        let _ = handle.emit(EVENT_NOTICE, payload);
        place(&window);
        let _ = window.set_visible_on_all_workspaces(true);
        // Shown without focus, like everything else here. Design principle §4:
        // it must not take the keyboard out of whatever is being typed in.
        let _ = window.show();
    });

    std::thread::spawn(move || {
        std::thread::sleep(LINGER);
        if GENERATION.load(Ordering::SeqCst) != mine {
            return; // a later notice owns the window now
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if GENERATION.load(Ordering::SeqCst) == mine {
                if let Some(window) = window(&handle) {
                    let _ = window.hide();
                }
                crate::release_focus(&handle);
            }
        });
    });
}

/// Top right, under the menu bar — the same corner as the panel.
///
/// Below it, not on top of it: the two can be up at once, and a summary being
/// covered by a remark about the network is exactly the wrong way round.
fn place(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) else {
        return;
    };

    let scale = monitor.scale_factor();
    let area = monitor.size();
    let origin = monitor.position();
    let Ok(size) = window.outer_size() else { return };

    let x = origin.x + area.width as i32 - size.width as i32;
    // macOS refuses to place a window above the menu bar, so this is measured
    // from below it — see the note in panel.rs.
    let y = origin.y + (crate::panel::MENU_BAR * scale) as i32;

    let _ = window.set_position(PhysicalPosition::new(x, y));
}
