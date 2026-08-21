// The panel is the only window, and it is opened by an event rather than by
// launching the app — so there is no console to show and nothing to attach to.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `muninn init` and friends are handled before Tauri starts: they are file
    // edits with output, and booting an event loop and a menu-bar item to do
    // them would be absurd. An ordinary launch gets `None` and falls through.
    if let Some(code) = muninn_lib::cli() {
        std::process::exit(code);
    }
    muninn_lib::run()
}
