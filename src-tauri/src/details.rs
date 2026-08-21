//! The details window.
//!
//! The panel answers "did it work, am I needed, what next" in thirty seconds.
//! This is where someone goes when the answer was "look closer" — the whole
//! summary uncapped, the agent's message in full, and the working directory and
//! session it came from.
//!
//! It behaves the opposite way to the panel, and deliberately. The panel
//! arrives unbidden and must never take focus; this is opened by a deliberate
//! click, so it centres itself and takes focus like any window a person just
//! asked for.

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const DETAILS: &str = "details";

/// Emitted as the window is shown, so the card can unroll itself. The window
/// is hidden rather than destroyed between openings, so its frontend does not
/// re-run and has no other way to know it is being looked at again.
pub const EVENT_OPENED: &str = "muninn://details-opened";

/// Fraction of the screen the window occupies, per axis.
///
/// Half the width and half the height — a quarter of the area. Big enough for
/// a long summary without becoming the sort of window you have to manage.
const SCREEN_FRACTION: f64 = 0.5;

/// Transparent margin around the card, for its shadow and glow to fall into.
///
/// The window is grown by this on every side so the card itself still measures
/// `SCREEN_FRACTION` of the screen. Must match `--mn-shadow-pad` in
/// `ui/src/styles/tokens.css`, which `ui/src/styles/details.css` sets as the
/// body's padding.
const SHADOW_PAD: f64 = 72.0;

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(DETAILS)
}

/// Size to the screen, centre, show, and focus.
pub fn open(app: &AppHandle) {
    let Some(window) = window(app) else { return };

    // Sized from the monitor every time rather than once at creation: the
    // display can change between two openings, and a window sized for a laptop
    // screen looks lost on an external one.
    if let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) {
        let area = monitor.size();
        let origin = monitor.position();

        let pad = SHADOW_PAD * monitor.scale_factor() * 2.0;
        let width = (area.width as f64 * SCREEN_FRACTION + pad).round();
        let height = (area.height as f64 * SCREEN_FRACTION + pad).round();
        let _ = window.set_size(PhysicalSize::new(width, height));

        // Centred by arithmetic rather than by `center()`. That helper reads
        // the window's current size, and the resize above has not necessarily
        // been applied by the time it runs — so it was centring the old size
        // and leaving the window sitting high on the screen.
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
    // This window took focus when it opened; closing it should give focus back
    // rather than leaving the app in front with nothing on screen.
    crate::release_focus(app);
}
