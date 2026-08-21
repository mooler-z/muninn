//! The history window.
//!
//! What this project has finished lately, newest first, grouped by day —
//! section 08 of the design. Kept on this Mac and nowhere else; there is no
//! account and nothing syncs, and these rows carry the user's working
//! directories and their agent's full output.
//!
//! Opened deliberately, so unlike the panel it centres itself and takes focus.

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const HISTORY: &str = "history";

/// Emitted as the window is shown, so the card can unroll itself.
///
/// The window is hidden rather than destroyed between openings, so its
/// frontend does not re-run and has no other way to know it is being looked at
/// again.
pub const EVENT_OPENED: &str = "muninn://history-opened";

/// Fraction of the screen, per axis.
const SCREEN_FRACTION: f64 = 0.44;
/// Transparent margin for the card's shadow — must match `--mn-shadow-pad`.
const SHADOW_PAD: f64 = 72.0;

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(HISTORY)
}

pub fn open(app: &AppHandle) {
    let Some(window) = window(app) else { return };

    if let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) {
        let area = monitor.size();
        let origin = monitor.position();
        let pad = SHADOW_PAD * monitor.scale_factor() * 2.0;

        let width = (area.width as f64 * SCREEN_FRACTION + pad).round();
        let height = (area.height as f64 * 0.62 + pad).round();
        let _ = window.set_size(PhysicalSize::new(width, height));

        // Centred by arithmetic: `center()` reads the size the window had
        // before the resize above has necessarily landed.
        let _ = window.set_position(PhysicalPosition::new(
            origin.x as f64 + (area.width as f64 - width) / 2.0,
            origin.y as f64 + (area.height as f64 - height) / 2.0,
        ));
    }

    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit(EVENT_OPENED, ());
}

pub fn close(app: &AppHandle) {
    if let Some(window) = window(app) {
        let _ = window.hide();
    }
    crate::release_focus(app);
}
