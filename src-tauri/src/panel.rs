//! Where the panel sits and how it behaves when it arrives.
//!
//! Design principle §4: it appears, it does not steal keyboard focus mid-
//! sentence, it never covers the centre of the screen, and it does not vanish
//! after five seconds like a toast. They stepped away; the whole point is that
//! it waits.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

pub const PANEL: &str = "panel";

/// Gap from the screen edges, in logical pixels.
const MARGIN: f64 = 14.0;
/// Enough to clear the menu bar on a notched display. The panel is a menu-bar
/// app's window; tucking it under the bar is where the eye already is.
pub const MENU_BAR: f64 = 38.0;

/// The design's panel width (`--mn-panel-w`). Height is driven by content.
const PANEL_WIDTH: f64 = 372.0;
/// Room for the panel's own shadow to the sides and below. The window is
/// transparent and larger than the panel by this much, because a CSS shadow
/// drawn at the window's edge is not faded off but cut off. Sized to contain
/// the resting shadow, which reaches 50px below the panel.
const SHADOW_PAD: f64 = 72.0;

/// The same, above the panel — much smaller, and deliberately so.
///
/// macOS will not place a window above the menu bar. Padding on top is
/// therefore not free: it pushes the panel that far down the screen, and at 72
/// the panel stopped reading as being in the corner at all. The shadow only
/// reaches 22px over the top edge at rest, so 24 costs nothing.
const SHADOW_PAD_TOP: f64 = 24.0;
/// What the window is actually sized to — the panel plus its shadow margin.
pub const WIDTH: f64 = PANEL_WIDTH + SHADOW_PAD * 2.0;
/// Past this the panel scrolls internally rather than growing off-screen.
const MAX_HEIGHT_FRACTION: f64 = 0.6;

// "It never covers the centre of the screen" — design principle §4.
const _: () = assert!(MAX_HEIGHT_FRACTION < 0.8);

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(PANEL)
}

/// Show the panel without taking focus.
///
/// The app runs as an accessory (see `lib.rs`), which is what actually keeps
/// showing a window from activating it — so whatever the user is typing in
/// keeps the keyboard. `Esc` still works because the panel takes key focus the
/// moment the pointer enters it; until then it is something you glance at.
pub fn show(app: &AppHandle) {
    let Some(window) = window(app) else { return };

    let _ = window.set_always_on_top(true);

    // The user stepped away and is doing something else — quite possibly in a
    // fullscreen app, which on macOS is its own Space. A window that is not
    // marked for all Spaces simply does not appear there, which for this
    // product reads exactly like the tool being broken.
    let _ = window.set_visible_on_all_workspaces(true);

    let _ = window.show();

    // Positioned *after* showing, not before: `current_monitor` has nothing to
    // answer with until the window has been on screen once, so positioning
    // first left the very first panel sitting in the middle of the display.
    position(&window);
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = window(app) {
        let _ = window.hide();
        // The panel opens without focus, but it is clickable — Details,
        // History, the pager — and any of those makes Muninn the active app.
        crate::release_focus(app);
    }
}

/// Anchor to the top-right of the active display, under the menu bar.
fn position(window: &WebviewWindow) {
    // Falling back to the primary display matters on the first show, and on any
    // call where the window is not yet placed on a monitor. Without it the
    // panel keeps whatever position it was given, which is the centre of the
    // screen — the one place design principle §4 says it must never be.
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => window.primary_monitor().ok().flatten(),
    };
    let Some(monitor) = monitor else { return };
    let scale = monitor.scale_factor();
    let area = monitor.size();
    let origin = monitor.position();

    // The margin applies to the *panel*, not to the window around it. The
    // window is `SHADOW_PAD` larger on every side and that border is fully
    // transparent, so anchoring the window itself would push the panel that
    // far in from the screen edge and leave it looking mis-hung.
    //
    // The transparent border is allowed to overhang the screen edge, which is
    // exactly what should happen to it.
    let x = origin.x + area.width as i32
        - ((PANEL_WIDTH + SHADOW_PAD + MARGIN) * scale) as i32;

    // Sit the window's top edge exactly at the bottom of the menu bar. Asking
    // for anything higher is pointless — macOS clamps it to here anyway — and
    // relying on that clamp silently moved the panel down by however much top
    // padding it happened to have. The gap the user actually sees between the
    // menu bar and the panel is `SHADOW_PAD_TOP`.
    let y = origin.y + (MENU_BAR * scale) as i32;

    let _ = window.set_position(PhysicalPosition::new(x, y));

    if std::env::var_os("MUNINN_DEBUG_PANEL").is_some() {
        // Read back rather than reporting what we asked for. The two differ
        // whenever the window manager has opinions, and a log that only ever
        // echoes the request cannot tell you that.
        let actual = window.outer_position().unwrap_or(PhysicalPosition::new(0, 0));
        let size = window.outer_size().unwrap_or(PhysicalSize::new(0, 0));
        let px = (actual.x + (SHADOW_PAD * scale) as i32) as f64 / scale;
        let py = (actual.y + (SHADOW_PAD_TOP * scale) as i32) as f64 / scale;
        eprintln!(
            "muninn: asked ({x},{y}) got ({},{}) → panel {}x{:.0} at logical ({px:.0},{py:.0}), \
             {:.0} from the right edge, {py:.0} from the top of {:.0}x{:.0}",
            actual.x,
            actual.y,
            PANEL_WIDTH,
            (size.height as f64 / scale) - SHADOW_PAD_TOP - SHADOW_PAD,
            area.width as f64 / scale - (px + PANEL_WIDTH),
            area.width as f64 / scale,
            area.height as f64 / scale,
        );
    }
}

/// Where the pointer is, in the window's own CSS pixels, and whether that is
/// over the panel itself.
///
/// "Inside" is measured against the *visible* panel, not the window: the window
/// carries a wide transparent shadow margin, and treating that as part of the
/// panel would hold the countdown while the pointer sat well clear of anything
/// readable. The coordinates are relative to the whole window, because that is
/// the frame `document.elementFromPoint` works in.
pub fn cursor_in_window(app: &AppHandle, window: &WebviewWindow) -> Option<(bool, f64, f64)> {
    let cursor = app.cursor_position().ok()?;
    let origin = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let scale = window.scale_factor().unwrap_or(1.0);

    let x = (cursor.x - origin.x as f64) / scale;
    let y = (cursor.y - origin.y as f64) / scale;

    let inside = x >= SHADOW_PAD
        && y >= SHADOW_PAD_TOP
        && x <= (size.width as f64 / scale) - SHADOW_PAD
        && y <= (size.height as f64 / scale) - SHADOW_PAD;

    Some((inside, x, y))
}

/// Resize to the height the frontend measured, then re-anchor.
///
/// Sized to content is design principle §4; the cap is design principle §2 —
/// past a certain length the first screen still has to carry the outcome, so
/// the panel scrolls rather than becoming a wall.
pub fn resize(window: &WebviewWindow, content_height: f64) {
    let scale = window.scale_factor().unwrap_or(1.0);

    let max = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| (m.size().height as f64 / scale) * MAX_HEIGHT_FRACTION)
        .unwrap_or(700.0);

    // The floor includes the transparent border, which the frontend counts in
    // the height it reports.
    let height = content_height.clamp(SHADOW_PAD_TOP + SHADOW_PAD + 80.0, max);

    let _ = window.set_size(PhysicalSize::new(
        (WIDTH * scale).round() as u32,
        (height * scale).round() as u32,
    ));
    position(window);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pull a `--mn-*` pixel token straight out of the stylesheet.
    fn token(name: &str) -> f64 {
        let css = include_str!("../../ui/src/styles/tokens.css");
        let at = css.find(&format!("{name}:")).unwrap_or_else(|| panic!("{name} not in tokens.css"));
        let value = css[at + name.len() + 1..]
            .split(';')
            .next()
            .expect("token should be terminated");
        value.trim().trim_end_matches("px").parse().expect("token should be a pixel value")
    }

    // These two numbers live in the stylesheet and in this module, and they
    // have to agree: the window is sized here and the panel inside it is sized
    // there. Reading the CSS rather than restating its values is the point —
    // asserting `SHADOW_PAD == 72.0` in both places would have passed happily
    // while the panel sat off-centre in its own window.

    #[test]
    fn the_panel_width_matches_the_stylesheet() {
        assert_eq!(PANEL_WIDTH, token("--mn-panel-w"));
    }

    #[test]
    fn the_shadow_padding_matches_the_stylesheet() {
        assert_eq!(SHADOW_PAD, token("--mn-shadow-pad"));
        assert_eq!(SHADOW_PAD_TOP, token("--mn-shadow-pad-top"));
    }

    #[test]
    fn there_is_less_padding_above_than_below() {
        // Not a style preference: macOS clamps the window to the bottom of the
        // menu bar, so top padding is subtracted from how high the panel can
        // sit. Equal padding put it 58pt too low.
        assert!(SHADOW_PAD_TOP < SHADOW_PAD);
    }

    #[test]
    fn the_window_is_the_panel_plus_its_shadow_margin() {
        assert_eq!(WIDTH, PANEL_WIDTH + SHADOW_PAD * 2.0);
    }
}
