//! Something to do while the agent works.
//!
//! Muninn's premise is that you walk away, and for a long run that is right.
//! But at five minutes leaving costs more than it saves — too long to watch a
//! log, too short to pick up anything that needs loading into your head — and
//! that gap is otherwise unserved. This fills it, for people who would rather
//! stay put than context-switch.
//!
//! Off by default. It is a matter of taste, not of correctness, and design
//! principle §4 is unambiguous that Muninn must not demand attention it was not
//! asked for.
//!
//! Two rules shape the whole module:
//!
//! * **Nothing happens for a short turn.** The window is armed when a prompt is
//!   submitted and only opens once the wait has lasted long enough to be a wait.
//!   Opening a game for a four-second turn is an interruption, not company.
//! * **The summary always wins.** When the last turn finishes the window stands
//!   down, whether it had opened or was still counting. The panel arriving is
//!   the raven coming back; nothing should have to be dismissed first.
//!
//! There may be more than one agent. Two Claude Code sessions in two terminals
//! are two independent turns sharing one window, and everything awkward here
//! comes from that: a second session starting must not restart the game the
//! first one is already filling, and a second session *finishing* is not the
//! end of the wait if the first is still going. So the module tracks which
//! sessions are mid-turn rather than counting how many times it has been
//! poked.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::settings::Game;

pub const WAITING: &str = "waiting";

/// Tells the window which game to draw, and that a fresh turn has begun.
pub const EVENT_WAITING: &str = "muninn://waiting";

/// Hold the run where it is. Sent whenever the window is about to go away, so
/// the turn ending costs nobody their game.
pub const EVENT_PAUSE: &str = "muninn://waiting-pause";

/// The sessions with a turn in flight, and when each was armed.
///
/// This used to be a single counter, bumped by every arm and every stand-down.
/// With one agent that is indistinguishable from what is here; with two it is
/// wrong in both directions. Arming cancelled the other session's pending
/// open, and whichever session finished first tore the window away from the
/// one still working.
///
/// A session leaves this map by delivering a summary. A turn that ends before
/// the delay elapses leaves a thread still sleeping; when it wakes it finds
/// its own key gone and does nothing, which is what keeps a fast turn from
/// opening a game seconds after its own panel has been read.
static IN_FLIGHT: Mutex<BTreeMap<String, Instant>> = Mutex::new(BTreeMap::new());

/// How long an entry may sit before it is treated as lost.
///
/// The only way out of the map is a summary arriving. If Muninn is quit
/// mid-turn, or the agent is killed, that summary never comes — and a session
/// that never leaves would stop the window ever standing down again. Long
/// enough that it cannot catch a real run, short enough to heal itself.
const STALE: Duration = Duration::from_secs(6 * 60 * 60);

/// Whether the window is on screen.
///
/// Tracked rather than asked. `is_visible()` is an AppKit call and must happen
/// on the main thread, but the question is asked from the receiver's thread
/// the moment a prompt is submitted.
static SHOWING: AtomicBool = AtomicBool::new(false);

/// Set by the frontend once it has actually drawn something.
///
/// The window is transparent, borderless and always on top. If its webview
/// renders nothing — a stale bundle, a script that 404s, a throw before the
/// first append — the result is not a blank window you can close. It is an
/// invisible rectangle in the middle of the screen that swallows every click,
/// with no way to find it and nothing to click to dismiss it.
///
/// So the window is on probation from the moment it opens: draw something
/// within `PROOF`, or be hidden again.
static DREW: AtomicBool = AtomicBool::new(false);

/// How long the frontend has to prove it is there.
const PROOF: std::time::Duration = std::time::Duration::from_secs(4);

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WAITING)
}

fn in_flight() -> std::sync::MutexGuard<'static, BTreeMap<String, Instant>> {
    // A poisoned lock here would mean a panic between two map operations.
    // There is nothing to be salvaged by refusing to run afterwards, and the
    // cost of giving up is a window that can never be stood down again.
    IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner())
}

fn drop_stale(flight: &mut BTreeMap<String, Instant>) {
    flight.retain(|_, armed| armed.elapsed() < STALE);
}

/// A prompt was submitted. Open the window if the turn outlives the delay.
pub fn arm(app: &AppHandle, session: &str) {
    let waiting = {
        let state = app.state::<crate::State>();
        let settings = state.settings.lock().unwrap();
        settings.waiting.clone()
    };

    if waiting.game == Game::Off {
        return;
    }

    {
        let mut flight = in_flight();
        drop_stale(&mut flight);
        flight.insert(session.to_string(), Instant::now());
    }

    // Already on screen? Then this session simply joins the wait that is
    // being filled. Going further would re-emit the game and restart a run
    // somebody is in the middle of, and re-centre the window under their
    // cursor — which is the whole bug this guard exists for.
    if SHOWING.load(Ordering::SeqCst) {
        return;
    }

    let session = session.to_string();
    let app = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(waiting.after_seconds));
        if !in_flight().contains_key(&session) {
            return; // this turn finished while we were waiting
        }
        // Showing a window is main-thread work; this is a worker thread.
        let handle = app.clone();
        let game = waiting.game;
        let _ = app.run_on_main_thread(move || {
            // Re-read both under the main thread: another session may have
            // opened the window during the sleep, and this one must not
            // reopen it on top.
            if in_flight().contains_key(&session) && !SHOWING.load(Ordering::SeqCst) {
                open(&handle, game);
            }
        });
    });
}

/// A turn is over. Stand down once nobody is still working.
///
/// `session` is the one that finished. `None` means "regardless of who" — a
/// manual close, or a payload that arrived without an id — and clears the lot,
/// because whoever asked wants the window gone and a leftover entry would only
/// stop some later turn from hiding it.
///
/// Must be called on the main thread — it hides a window. `deliver` routes it
/// through `on_ui` for exactly that reason.
pub fn stand_down(app: &AppHandle, session: Option<&str>) {
    {
        let mut flight = in_flight();
        match session {
            Some(id) => {
                flight.remove(id);
            }
            None => flight.clear(),
        }
        drop_stale(&mut flight);
        // Another agent is still mid-turn, so the wait is not over. Its
        // summary will land in the corner; the game it is not finished with
        // stays where it is.
        if !flight.is_empty() {
            return;
        }
    }

    if let Some(window) = window(app) {
        SHOWING.store(false, Ordering::SeqCst);
        // Pause before hiding, not after. Hiding a window does not stop its
        // webview, so the game would otherwise keep running unseen — and a run
        // that was interrupted by the agent finishing should still count for
        // what it reached.
        let _ = app.emit(EVENT_PAUSE, ());
        let _ = window.hide();
        // The game window is clicked to be played, which activates Muninn.
        // Closing it has to give that back.
        crate::release_focus(app);
    }
}

/// The frontend has drawn. Called from `render()` in waiting.ts.
pub fn drew() {
    DREW.store(true, Ordering::SeqCst);
}

fn open(app: &AppHandle, game: Game) {
    let Some(window) = window(app) else { return };

    // Once per long turn at most, and the one line that makes a wrong answer
    // here visible: two agents starting must produce one of these, not two.
    eprintln!("muninn: waiting window opened for {game:?}");

    DREW.store(false, Ordering::SeqCst);
    SHOWING.store(true, Ordering::SeqCst);
    let _ = app.emit(EVENT_WAITING, game);

    // Shown without focus, like the panel. The prompt was submitted a moment
    // ago and the caret may well be back in the terminal — taking the keyboard
    // out of it to start a game nobody has looked at yet would be exactly the
    // interruption design principle §4 rules out. It becomes playable on the
    // first click.
    let _ = window.set_visible_on_all_workspaces(true);
    let _ = window.show();
    let _ = window.center();

    // Probation. Nothing on screen after this means the webview never came up,
    // and an invisible click-trap is far worse than no game.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(PROOF);
        if DREW.load(Ordering::SeqCst) {
            return;
        }
        let inner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            // `self::` because the local binding above shadows this function.
            if let Some(blank) = self::window(&inner) {
                eprintln!(
                    "muninn: waiting window drew nothing in {PROOF:?}; title={:?}",
                    blank.title()
                );
                SHOWING.store(false, Ordering::SeqCst);
                let _ = blank.hide();
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The map is what decides whether a wait is over, so these exercise it
    /// directly. Everything around it — showing a window, emitting to a
    /// webview — needs an `AppHandle` and a main thread, neither of which a
    /// unit test has.
    fn fresh() -> BTreeMap<String, Instant> {
        BTreeMap::new()
    }

    #[test]
    fn one_session_finishing_ends_its_own_wait() {
        let mut flight = fresh();
        flight.insert("a".into(), Instant::now());
        flight.remove("a");
        assert!(flight.is_empty(), "nobody left working, so the window goes");
    }

    #[test]
    fn a_second_session_finishing_does_not_end_the_first_ones_wait() {
        // The bug this module was rewritten for: two agents, one window, and
        // whichever finished first used to take the game away from the other.
        let mut flight = fresh();
        flight.insert("a".into(), Instant::now());
        flight.insert("b".into(), Instant::now());

        flight.remove("b");
        assert!(!flight.is_empty(), "a is still working; the game stays");

        flight.remove("a");
        assert!(flight.is_empty(), "now the wait is genuinely over");
    }

    #[test]
    fn arming_the_same_session_twice_leaves_one_entry() {
        // Two `started` payloads for one session must not need two summaries
        // to clear.
        let mut flight = fresh();
        flight.insert("a".into(), Instant::now());
        flight.insert("a".into(), Instant::now());
        assert_eq!(flight.len(), 1);
        flight.remove("a");
        assert!(flight.is_empty());
    }

    #[test]
    fn a_manual_close_clears_everyone() {
        // Whoever hit the close button wants the window gone. A leftover entry
        // would only stop some later turn from standing it down.
        let mut flight = fresh();
        flight.insert("a".into(), Instant::now());
        flight.insert("b".into(), Instant::now());
        flight.clear();
        assert!(flight.is_empty());
    }

    #[test]
    fn a_session_that_never_reported_back_is_eventually_forgotten() {
        // Muninn quit mid-turn, or the agent was killed. Without this the
        // window could never be stood down again.
        let mut flight = fresh();
        flight.insert("lost".into(), Instant::now() - STALE - Duration::from_secs(1));
        flight.insert("live".into(), Instant::now());
        drop_stale(&mut flight);
        assert_eq!(flight.keys().collect::<Vec<_>>(), vec!["live"]);
    }

    #[test]
    fn a_long_running_turn_is_not_mistaken_for_a_lost_one() {
        let mut flight = fresh();
        flight.insert("slow".into(), Instant::now() - Duration::from_secs(60 * 60));
        drop_stale(&mut flight);
        assert!(flight.contains_key("slow"), "an hour is a turn, not a leak");
    }
}
