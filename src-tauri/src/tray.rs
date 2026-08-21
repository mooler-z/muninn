//! The menu bar item.
//!
//! The design draws a custom dropdown — warm, rounded, with the last summary
//! set in the agent's voice. This is the native menu instead: it carries every
//! item the design shows, but not the styling, which needs a second borderless
//! window. That is M3 work in `docs/roadmap.md` and is deliberately not
//! attempted here.
//!
//! What it does keep from design principle §6 is the restraint: nothing counts,
//! nothing pulses, and there is no badge. The work is already done.

use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager};

use crate::settings::{Game, Theme};
use crate::{panel, settings, State};

const TRAY_ID: &str = "muninn";

const SHOW: &str = "show";
const HISTORY: &str = "history";
const MUTE: &str = "mute";
const QUIT: &str = "quit";

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    // A dedicated tray image rather than the app icon. The app icon is square,
    // as the Dock expects, but this mark is portrait — so in a menu bar, which
    // scales the whole image to the bar's height, that square's side padding
    // just makes the bird smaller for nothing. This one is cropped to the
    // artwork.
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))
        .expect("tray icon should decode");

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Muninn")
        .menu(&menu(app)?)
        .on_menu_event(handle)
        .build(app)?;

    // Held by the app; dropping it would remove the item from the menu bar.
    let _: TrayIcon = tray;
    Ok(())
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = app.state::<State>();
    let queue = state.queue.lock().unwrap();
    let (muted, theme, game) = {
        let settings = state.settings.lock().unwrap();
        (settings.muted, settings.theme, settings.waiting.game)
    };

    // The design puts the last summary at the top of the dropdown, truncated.
    // Disabled rather than clickable: it is information, not a control.
    let latest = queue.latest().map(summarise).unwrap_or_else(|| "Nothing yet".to_string());
    let latest = MenuItem::with_id(app, "latest", latest, false, None::<&str>)?;

    let show = MenuItem::with_id(app, SHOW, "Show last summary", !queue.is_empty(), None::<&str>)?;
    // Enabled whenever anything has ever been recorded, not just while a panel
    // is pending — looking back is the whole point of it.
    let history = MenuItem::with_id(
        app,
        HISTORY,
        "History…",
        queue.latest().is_some(),
        None::<&str>,
    )?;
    let mute = MenuItem::with_id(
        app,
        MUTE,
        if muted { "Unmute sounds" } else { "Mute sounds" },
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, QUIT, "Quit Muninn", true, Some("Cmd+Q"))?;

    // Light and dark follow the system by design. This is here so both can be
    // looked at without changing the whole machine over — useful when working
    // on the panel, and harmless otherwise.
    let choices: Vec<CheckMenuItem<tauri::Wry>> = Theme::ALL
        .iter()
        .map(|t| {
            CheckMenuItem::with_id(app, t.id(), t.label(), true, *t == theme, None::<&str>)
        })
        .collect::<tauri::Result<_>>()?;
    let appearance = Submenu::with_items(
        app,
        "Appearance",
        true,
        &choices.iter().map(|c| c as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect::<Vec<_>>(),
    )?;

    // Something to do while the agent works. Off by default — see waiting.rs.
    let games: Vec<CheckMenuItem<tauri::Wry>> = Game::ALL
        .iter()
        .map(|g| CheckMenuItem::with_id(app, g.id(), g.label(), true, *g == game, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    let while_waiting = Submenu::with_items(
        app,
        "While you wait",
        true,
        &games.iter().map(|c| c as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect::<Vec<_>>(),
    )?;

    Menu::with_items(
        app,
        &[
            &latest,
            &PredefinedMenuItem::separator(app)?,
            &show,
            &history,
            &PredefinedMenuItem::separator(app)?,
            &mute,
            &appearance,
            &while_waiting,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )
}

/// The whole line, project included.
///
/// A macOS menu is as wide as its widest item, so this one item decides the
/// width of everything under it. Cutting only the headline was not enough —
/// the project name and separator ride on top of that budget, and a long
/// project name pushed the menu wider still. The budget is the finished line.
///
/// Set just above "Show last summary", the widest of the real controls, so the
/// summary stops driving the width at all: past that point the menu is as wide
/// as its own commands and no wider. It is a glance at what happened last, not
/// the summary itself — the panel underneath it is that.
const MENU_WIDTH: usize = 26;

/// One line, in the agent's own words, cut to fit a menu.
fn summarise(event: &muninn_core::MuninnEvent) -> String {
    let project = event.project.as_deref().unwrap_or("—");
    let headline = event
        .summary
        .as_ref()
        .and_then(|s| s.headline())
        .or(Some(event.raw.as_str()))
        .map(|s| s.lines().next().unwrap_or_default().trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("finished, no summary");

    let line = format!("{project} — {headline}");
    if line.chars().count() <= MENU_WIDTH {
        return line;
    }

    // Counted in characters, not bytes: a summary can be any language, and
    // slicing a multi-byte character in half panics.
    let mut cut: String = line.chars().take(MENU_WIDTH - 1).collect();
    // Not mid-word, if a word boundary is close enough behind.
    if let Some(space) = cut.rfind(' ') {
        if space >= MENU_WIDTH - 9 {
            cut.truncate(space);
        }
    }
    cut.push('…');
    cut
}

/// Rebuild the menu so the last-summary line and the mute label stay true.
pub fn refresh(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn handle(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();

    if let Some(game) = Game::from_id(id) {
        crate::set_game(app, game);
        return;
    }

    if let Some(theme) = Theme::from_id(id) {
        crate::set_appearance(app, theme);
        // Bring the panel back so the change is visible immediately rather
        // than at the next turn that happens to finish.
        panel::show(app);
        return;
    }

    match id {
        SHOW => panel::show(app),
        HISTORY => crate::history_window::open(app),
        MUTE => {
            let state = app.state::<State>();
            let updated = {
                let mut settings = state.settings.lock().unwrap();
                settings.muted = !settings.muted;
                settings.clone()
            };
            settings::save(&updated);
            refresh(app);
        }
        QUIT => app.exit(0),
        _ => {}
    }
}
