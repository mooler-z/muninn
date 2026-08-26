//! Muninn — wake me when it's done.
//!
//! The whole path in one place: the shim POSTs a hook payload to [`receiver`],
//! [`normalise`] turns it into one internal event, [`queue`] decides what is on
//! screen, and [`panel`] puts it there with a sound from [`sound`].

mod details;
mod games;
mod history;
mod history_window;
mod hover;
mod init;
mod markdown;
mod net;
mod normalise;
mod notice;
mod panel;
mod queue;
mod receiver;
mod runtime;
mod settings;
mod sound;
mod spool;
mod transcript;
mod waiting;
mod tray;

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use muninn_core::event::MuninnEvent;
use queue::{Queue, View};
use settings::{Game, Settings, Theme};

/// Emitted to the panel window whenever what it should show changes.
pub const EVENT_VIEW: &str = "muninn://view";
/// Emitted when the user overrides light/dark from the menu bar.
pub const EVENT_APPEARANCE: &str = "muninn://appearance";

#[derive(Default)]
pub struct State {
    queue: Mutex<Queue>,
    settings: Mutex<Settings>,
}

/// Do something to a window, from wherever.
///
/// On macOS a window may only be touched from the main thread, and asking from
/// anywhere else makes the caller wait on the main loop. `deliver` runs on the
/// receiver's thread, so every piece of UI work it triggers goes through here.
/// Posting rather than blocking is the difference between a busy moment and an
/// app with a dead menu bar.
fn on_ui(app: &AppHandle, what: impl FnOnce(AppHandle) + Send + 'static) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || what(handle));
}

/// Queue an event, put it on screen, and make the noise.
///
/// Everything funnels through here — the receiver, the spool drain, and any
/// future source — so there is exactly one place where "a turn ended" becomes
/// "the user finds out".
fn deliver(app: &AppHandle, source: &str, kind: &str, body: &[u8]) {
    let id = format!("{}-{}", now_millis(), body.len());
    let event = normalise::normalise(source, kind, body, id);

    // Claude Code's "waiting for your input" idle nudge: a reminder, not a
    // question, about a turn whose panel already appeared. Dropped entirely —
    // no queue, no history, no sound.
    if normalise::idle_reminder(&event) {
        return;
    }

    let event_kind = event.kind;

    let state = app.state::<State>();
    let (view, history) = {
        let mut queue = state.queue.lock().unwrap();
        queue.push(event.clone());
        (queue.current(), queue.history())
    };

    // After the queue, never before it: this reads the transcript off-thread
    // and the panel must not wait on it.
    capture_prompt(app, &event);

    // Written outside the lock, and off this thread.
    //
    // This used to run inside the block above: a synchronous write of fifty
    // events — each carrying an agent's whole closing message — with the queue
    // lock held. The main thread wants that same lock to rebuild the tray menu,
    // so every summary parked the entire interface for the length of a disk
    // write. That is the shape of the freeze: dead menu bar, spinner over the
    // panel, nothing clickable.
    std::thread::spawn(move || history::save(&history));

    // Which agent just finished. `None` stands every session down, which is
    // the right fallback for a payload with no id: better to end a wait that
    // was already over than to leave a window nothing can close.
    let finished = event.session_id.clone();

    if let Some(view) = view {
        // Emitting is thread-safe; showing a window is not.
        let _ = app.emit(EVENT_VIEW, &view);
        let session = finished.clone();
        on_ui(app, move |app| {
            // Whatever this turn's wait was doing, it is over. The panel
            // arriving is the raven coming back; nothing should have to be
            // dismissed first. Any *other* agent still working keeps its game.
            waiting::stand_down(&app, session.as_deref());
            panel::show(&app);
            tray::refresh(&app);
            // The webview cannot see the pointer while the panel is unfocused,
            // so the hover-hold on the countdown is driven from here.
            hover::watch(&app);
        });
    } else {
        on_ui(app, move |app| waiting::stand_down(&app, finished.as_deref()));
    }

    let settings = state.settings.lock().unwrap().clone();
    sound::play(event_kind, &settings);
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Commands the panel calls back with
// ---------------------------------------------------------------------------

/// The panel measures its own content and asks for a window that fits it.
#[tauri::command]
fn resize_panel(app: AppHandle, height: f64) {
    if std::env::var_os("MUNINN_DEBUG_PANEL").is_some() {
        eprintln!("muninn: frontend asked for height {height}");
    }
    if let Some(window) = panel::window(&app) {
        panel::resize(&window, height);
    }
}

/// `Esc`, always — design principle §4. It clears the whole queue rather than
/// stepping through it; see `queue::dismiss_all`.
#[tauri::command]
fn dismiss(app: AppHandle) {
    app.state::<State>().queue.lock().unwrap().dismiss_all();
    hover::stop();
    on_ui(&app, |app| {
        panel::hide(&app);
        tray::refresh(&app);
    });
}

#[tauri::command]
fn page(app: AppHandle, delta: isize) -> Option<View> {
    let view = app.state::<State>().queue.lock().unwrap().step(delta);
    if let Some(view) = &view {
        let _ = app.emit(EVENT_VIEW, view);
    }
    view
}

/// Called by the panel once it is ready, so a window reopened from the tray
/// gets its content without waiting for a new event.
#[tauri::command]
fn current_view(app: AppHandle) -> Option<View> {
    let view = app.state::<State>().queue.lock().unwrap().current();
    if std::env::var_os("MUNINN_DEBUG_PANEL").is_some() {
        eprintln!("muninn: frontend loaded and asked for the current view (some={})", view.is_some());
    }
    view
}

/// Open the history window, and close it again.
#[tauri::command]
fn open_history(app: AppHandle) {
    history_window::open(&app);
}

#[tauri::command]
fn close_history(app: AppHandle) {
    history_window::close(&app);
}

/// Show a past summary in the details window.
///
/// The details window already renders a `View` and follows the same event, so
/// browsing history reuses it rather than growing a second reader.
#[tauri::command]
fn show_from_history(app: AppHandle, id: String) -> bool {
    let view = {
        let state = app.state::<State>();
        let queue = state.queue.lock().unwrap();
        queue.view_of(&id)
    };

    let Some(view) = view else { return false };
    let _ = app.emit(EVENT_VIEW, &view);
    details::open(&app);
    true
}

#[tauri::command]
fn history(app: AppHandle) -> Vec<serde_json::Value> {
    app.state::<State>()
        .queue
        .lock()
        .unwrap()
        .history()
        .iter()
        .filter_map(|e| serde_json::to_value(e).ok())
        .collect()
}

/// Surface a webview-side error in the terminal.
///
/// The panel is a window with no console attached, so without this a JavaScript
/// error is simply an empty panel and no explanation anywhere.
#[tauri::command]
fn report_error(message: String) {
    eprintln!("muninn: panel error: {message}");
}

/// The waiting window has rendered. Clears its probation — see `waiting::DREW`.
#[tauri::command]
fn waiting_ready() {
    waiting::drew();
}

/// Keep a half-played game, so closing the window does not end the run.
#[tauri::command]
fn save_game(game: String, state: String) {
    games::save(&game, &state);
}

/// The snapshot to pick up from, if there is one.
#[tauri::command]
fn load_game(game: String) -> Option<String> {
    games::load(&game)
}

/// Forget a game — finished, or started again from the beginning.
#[tauri::command]
fn clear_game(game: String) {
    games::clear(&game);
}

/// Hand the keyboard back to whatever was in front before.
///
/// Details and history take focus when they open, which activates Muninn.
/// Hiding the window does not undo that: the app stays active with nothing on
/// screen, so the window behind stays grey until it is clicked.
///
/// `NSApp.deactivate()`, not `hide()`. Hiding is the right call for an app
/// with a Dock icon; Muninn is `Accessory`, and hiding it was measured to
/// return `Ok` while changing nothing about which app was in front. It also
/// had a trap — a hidden application's windows do not appear however many
/// times `show` is called on them, so the first panel afterwards would never
/// have arrived. Deactivating gives up activation and leaves every window able
/// to show itself.
///
/// Only once nothing of Muninn's is left visible: deactivating while the panel
/// is up would push a summary behind whatever the user turns to next.
#[cfg(target_os = "macos")]
fn release_focus(app: &AppHandle) {
    let handle = app.clone();
    // AppKit insists this happens on the main thread, and a command handler is
    // not guaranteed to be there.
    let _ = app.run_on_main_thread(move || {
        let visible = handle
            .webview_windows()
            .values()
            .any(|w| w.is_visible().unwrap_or(false));
        if visible {
            return;
        }

        let Some(marker) = objc2::MainThreadMarker::new() else { return };
        objc2_app_kit::NSApplication::sharedApplication(marker).deactivate();
    });
}

#[cfg(not(target_os = "macos"))]
fn release_focus(_app: &AppHandle) {}

/// Show a corner notice. Exists so the thing can be seen without waiting for
/// the network to actually fall over.
#[tauri::command]
fn test_notice(app: AppHandle, urgent: bool) {
    if urgent {
        notice::show(
            &app,
            "No network",
            "Your agent cannot reach its model, so this turn will not finish.",
            true,
        );
    } else {
        notice::show(&app, "Back online", "Your agent can reach its model again.", false);
    }
}

/// Carry a search term across to the details window.
///
/// The two windows are separate webviews and cannot see each other, so a term
/// typed in one has to travel through the app to reach the other. Sent as its
/// own event rather than folded into the view: it is a property of how you
/// arrived at a summary, not a property of the summary.
#[tauri::command]
fn highlight(app: AppHandle, term: String) {
    let _ = app.emit("muninn://highlight", term);
}

/// Write the history out to a file the user picks.
///
/// The save panel comes from `osascript` rather than a dialogue plugin. It is
/// the same native panel, it costs no dependency and no bundle size, and this
/// app already shells out to open a terminal — so the capability is not new.
///
/// A dialogue rather than a fixed path on purpose: the file carries working
/// directories and an agent's full output, and where that lands should be a
/// decision the user makes rather than one they discover afterwards.
///
/// Returns the path written, or `None` if the panel was cancelled.
#[tauri::command]
async fn export_history(stem: String, markdown: String, json: String) -> Option<String> {
    // Anything but a plain name could rewrite the AppleScript below.
    let safe: String = stem
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    let default = if safe.is_empty() { "muninn-history".to_string() } else { safe };

    tauri::async_runtime::spawn_blocking(move || {
        let script = format!(
            r#"set f to choose file name with prompt "Export Muninn history" default name "{default}.md"
return POSIX path of f"#
        );

        let out = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .output()
            .ok()?;

        // A cancelled panel is a non-zero exit, not an error worth reporting.
        if !out.status.success() {
            return None;
        }

        let path = String::from_utf8(out.stdout).ok()?.trim().to_string();
        if path.is_empty() {
            return None;
        }

        // The extension chooses the format: someone who types `.json` means it.
        let body = if path.to_lowercase().ends_with(".json") { &json } else { &markdown };
        std::fs::write(&path, body).ok()?;
        Some(path)
    })
    .await
    .ok()
    .flatten()
}

/// Switch games from inside the waiting window.
///
/// The same setting the tray menu writes, so choosing here is not a temporary
/// override — the next turn opens whatever was picked last, and the menu shows
/// it ticked.
#[tauri::command]
fn choose_game(app: AppHandle, game: Game) {
    set_game(&app, game);
}

/// Open the details window on the summary currently on screen.
///
/// The panel goes away as it opens. Two windows showing the same summary is
/// clutter, and the panel's countdown would otherwise run out underneath and
/// clear the queue while the details window was still being read. Hidden
/// rather than dismissed, so the queue survives and the tray can bring it back.
#[tauri::command]
fn open_details(app: AppHandle) {
    panel::hide(&app);
    details::open(&app);
}

#[tauri::command]
fn close_details(app: AppHandle) {
    details::close(&app);
}

/// What the user asked for, recovered from the session transcript.
///
/// Deliberately its own command rather than part of the view: this reads a file
/// that can be tens of megabytes, and ADR-0002 is explicit that the transcript
/// must never be on the path between a turn ending and the panel appearing. It
/// runs when the details window asks, and nothing waits on it.
#[tauri::command]
fn user_prompt(app: AppHandle) -> Option<String> {
    let event = {
        let state = app.state::<State>();
        let queue = state.queue.lock().unwrap();
        queue.current()?.event
    };

    // Stored first. Events recorded before prompts were kept still fall through
    // to the transcript, and backfill themselves on the way past.
    if event.prompt.is_some() {
        return event.prompt;
    }

    let path = event.transcript_path.as_deref()?;
    let found = transcript::user_prompt(std::path::Path::new(path), event.prompt_id.as_deref())?;
    remember_prompt(&app, &event.id, found.clone());
    Some(found)
}

/// Attach a recovered prompt to an event and write the history back.
fn remember_prompt(app: &AppHandle, id: &str, prompt: String) {
    let state = app.state::<State>();
    let history = {
        let mut queue = state.queue.lock().unwrap();
        if !queue.remember_prompt(id, prompt) {
            return;
        }
        queue.history()
    };
    // Off the lock, as with every other write of this file.
    std::thread::spawn(move || history::save(&history));
}

/// Recover what was asked, in the background.
///
/// Spawned after the panel is already on screen. The transcript is Claude
/// Code's own file and can be tens of megabytes; ADR-0002 is explicit that
/// reading it must never sit between a turn ending and the panel appearing.
/// Nothing waits on this, and if it finds nothing the history is exactly as it
/// would have been.
fn capture_prompt(app: &AppHandle, event: &MuninnEvent) {
    if event.prompt.is_some() {
        return;
    }
    let (Some(path), id) = (event.transcript_path.clone(), event.id.clone()) else {
        return;
    };
    let prompt_id = event.prompt_id.clone();
    let app = app.clone();

    std::thread::spawn(move || {
        let Some(found) = transcript::user_prompt(std::path::Path::new(&path), prompt_id.as_deref())
        else {
            return;
        };
        remember_prompt(&app, &id, found);
    });
}

/// Which game the waiting window should draw, if any.
#[tauri::command]
fn waiting_game(app: AppHandle) -> Game {
    app.state::<State>().settings.lock().unwrap().waiting.game
}

/// Close the waiting window by hand — the player has had enough of it.
#[tauri::command]
fn close_waiting(app: AppHandle) {
    waiting::stand_down(&app, None);
}

pub fn set_game(app: &AppHandle, game: Game) {
    let state = app.state::<State>();
    let updated = {
        let mut settings = state.settings.lock().unwrap();
        settings.waiting.game = game;
        settings.clone()
    };
    settings::save(&updated);
    tray::refresh(app);
}

/// Which theme the panel should force, if any.
///
/// `System` means the panel sets no override and the stylesheet's
/// `prefers-color-scheme` query decides.
#[tauri::command]
fn appearance(app: AppHandle) -> Theme {
    app.state::<State>().settings.lock().unwrap().theme
}

/// Set the override from the menu bar, and tell the panel at once so the change
/// is visible without waiting for the next turn to finish.
pub fn set_appearance(app: &AppHandle, theme: Theme) {
    let state = app.state::<State>();
    let updated = {
        let mut settings = state.settings.lock().unwrap();
        settings.theme = theme;
        settings.clone()
    };
    settings::save(&updated);
    let _ = app.emit(EVENT_APPEARANCE, theme);
    tray::refresh(app);
}

/// Open the terminal the agent is waiting in — the one action the design gives
/// the panel, and only on the states where acting requires the terminal.
#[tauri::command]
fn open_terminal(cwd: Option<String>) {
    let Some(cwd) = cwd else { return };
    let _ = std::process::Command::new("/usr/bin/open")
        .args(["-a", "Terminal", &cwd])
        .spawn();
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/// Handle a command-line invocation, if this was one.
///
/// `None` means an ordinary launch and the caller should start the app.
pub fn cli() -> Option<i32> {
    init::intercept()
}

pub fn run() {
    tauri::Builder::default()
        .manage(State::default())
        .invoke_handler(tauri::generate_handler![
            resize_panel,
            dismiss,
            page,
            current_view,
            history,
            appearance,
            open_terminal,
            open_details,
            close_details,
            user_prompt,
            waiting_game,
            close_waiting,
            open_history,
            close_history,
            show_from_history,
            report_error,
            waiting_ready,
            save_game,
            load_game,
            clear_game,
            choose_game,
            export_history,
            highlight,
            test_notice,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Menu-bar only: no Dock icon, no app switcher entry. This is also
            // what stops the panel stealing focus when it appears — an
            // accessory app showing a window does not activate.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            {
                let state = app.state::<State>();
                *state.settings.lock().unwrap() = settings::load();
                state.queue.lock().unwrap().restore_history(history::load());
            }

            tray::build(&handle)?;

            // Watches for the connection going, which is the one thing that
            // stops an agent without producing any output at all.
            net::watch(&handle);

            // Bind before draining, so a payload arriving during startup is not
            // dropped between the two.
            let listener = receiver::bind()?;
            let port = listener.local_addr()?.port();
            let token = runtime::new_token();
            runtime::publish(port, &token)?;

            let receiver_handle = handle.clone();
            receiver::serve(listener, token, move |received| {
                // "started" is the turn beginning, not a summary — it arms the
                // waiting window and goes no further. Nothing about it belongs
                // in the queue or the history.
                if received.kind == "started" {
                    waiting::arm(&receiver_handle, &normalise::session_of(&received.body));
                    return;
                }
                // A hook for seeing the corner notice without unplugging
                // anything. Never produced by a real agent.
                if received.kind == "debug" {
                    let body = String::from_utf8_lossy(&received.body).to_string();
                    let handle = receiver_handle.clone();
                    let _ = receiver_handle.run_on_main_thread(move || {
                        if body.contains("open-history") {
                            history_window::open(&handle);
                        } else if body.contains("close-history") {
                            history_window::close(&handle);
                        } else if body.contains("open-details") {
                            details::open(&handle);
                        } else if body.contains("close-details") {
                            details::close(&handle);
                        }
                    });
                    return;
                }
                if received.kind == "notice" {
                    let urgent = !received.body.windows(6).any(|w| w == b"online");
                    notice::show(
                        &receiver_handle,
                        if urgent { "No network" } else { "Back online" },
                        if urgent {
                            "Your agent cannot reach its model, so this turn will not finish."
                        } else {
                            "Your agent can reach its model again."
                        },
                        urgent,
                    );
                    return;
                }
                deliver(&receiver_handle, &received.source, &received.kind, &received.body);
            });

            drain_spool(&handle);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the panel is dismissing it, not quitting the app. The
            // tray is the app; the window is one of its outputs.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                // The details window closes on its own; only the panel's close
                // means "dismiss the queue".
                if window.label() == details::DETAILS {
                    details::close(app);
                    return;
                }
                app.state::<State>().queue.lock().unwrap().dismiss_all();
                panel::hide(app);
                tray::refresh(app);
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to start Muninn")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                // A shim invoked after this point should fail fast and spool
                // rather than wait on a port nobody is listening to. This only
                // runs on a clean exit; after a crash the file is left behind
                // and the shim's connect timeout catches it instead — see
                // ADR-0005.
                runtime::clear();
            }
        });
}

/// Replay what the shim parked while the app was closed.
fn drain_spool(app: &AppHandle) {
    let drained = spool::drain();
    if drained.dropped > 0 {
        // Never silently truncate: the user is entitled to know that summaries
        // existed and were discarded.
        eprintln!(
            "muninn: dropped {} spooled payloads older than the replay limit",
            drained.dropped
        );
    }
    for spooled in drained.events {
        deliver(app, &spooled.source, &spooled.kind, &spooled.body);
        spooled.consume();
    }
}
