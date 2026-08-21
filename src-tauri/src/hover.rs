//! Is the pointer over the panel?
//!
//! The webview cannot answer this. The panel never takes focus — that is the
//! whole point of design principle §4 — and macOS does not deliver mouse-moved
//! events to a window that is not key. So `mouseenter` never fires, CSS
//! `:hover` never matches, and the countdown ran out from under a pointer
//! sitting directly on top of it. Clicking the panel fixed it only because that
//! made the window key.
//!
//! **Nothing here touches a window off the main thread.** On macOS, window
//! geometry and the cursor belong to the main thread; asking for them from
//! anywhere else makes the caller wait for the main loop to answer. This module
//! used to do that five times a tick, ten times a second — and the app would
//! wedge, with a dead menu bar item and a spinner over the panel.
//!
//! The worker now only sleeps and posts. The posted closure does the asking
//! where it is allowed to, and a pending flag means a busy main thread makes
//! this quieter instead of handing it a backlog it must clear before it can
//! draw again.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// Emitted when the pointer moves onto or off the panel, and as it moves across
/// it. Carries the position in the window's own CSS pixels, so the panel can
/// work out which control is underneath.
pub const EVENT_HOVER: &str = "muninn://hover";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hover {
    pub inside: bool,
    pub x: f64,
    pub y: f64,
}

/// Slower than it was. Hover is a highlight, not a control surface, and every
/// tick costs the main thread a handful of window queries.
const POLL: Duration = Duration::from_millis(140);

static WATCHING: AtomicBool = AtomicBool::new(false);
/// True from posting a tick until it has run, so ticks cannot stack up.
static PENDING: AtomicBool = AtomicBool::new(false);
/// Set when there is nothing left to watch, so the worker retires.
static STOP: AtomicBool = AtomicBool::new(false);
static LAST: Mutex<Option<(bool, i64, i64)>> = Mutex::new(None);

/// Start watching, if something is not already.
///
/// Safe to call for every panel; the guard means repeated shows do not stack up
/// threads.
pub fn watch(app: &AppHandle) {
    STOP.store(false, Ordering::SeqCst);
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        while !STOP.load(Ordering::SeqCst) {
            std::thread::sleep(POLL);

            // Skip rather than queue. If the main thread is busy, the right
            // response is to poll less often, not to give it more to do.
            if PENDING.swap(true, Ordering::SeqCst) {
                continue;
            }

            let handle = app.clone();
            let posted = app.run_on_main_thread(move || {
                tick(&handle);
                PENDING.store(false, Ordering::SeqCst);
            });

            if posted.is_err() {
                PENDING.store(false, Ordering::SeqCst);
                break; // the event loop has gone, and so should we
            }
        }

        *LAST.lock().unwrap() = None;
        PENDING.store(false, Ordering::SeqCst);
        WATCHING.store(false, Ordering::SeqCst);
    });
}

/// Retire the worker — the panel is gone, so there is nothing to hover over.
pub fn stop() {
    STOP.store(true, Ordering::SeqCst);
}

/// One poll, on the main thread, where a window may be asked about itself.
fn tick(app: &AppHandle) {
    let Some(window) = crate::panel::window(app) else {
        stop();
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        stop();
        return;
    }

    let Some((inside, x, y)) = crate::panel::cursor_in_window(app, &window) else {
        return;
    };

    // Rounded before comparing: sub-pixel jitter under a stationary mouse would
    // otherwise count as movement and emit on every tick.
    let now = (inside, x.round() as i64, y.round() as i64);
    let changed = {
        let mut last = LAST.lock().unwrap();
        let changed = match *last {
            Some((was, lx, ly)) => was != inside || (inside && (lx != now.1 || ly != now.2)),
            None => true,
        };
        if changed {
            *last = Some(now);
        }
        changed
    };

    if changed {
        let _ = app.emit(EVENT_HOVER, Hover { inside, x, y });
    }
}
