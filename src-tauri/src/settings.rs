//! What the user has told Muninn to do differently.
//!
//! Small, local, and plain JSON so it can be read and fixed by hand. There is
//! no account and nothing syncs — see the anti-goals in
//! `docs/design-principles.md`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// One click, never buried — design principle §1.
    pub muted: bool,
    /// On by default. Someone who walked away from their desk at eleven at
    /// night has not asked to be chimed at.
    pub silent_hours: SilentHours,
    /// Light and dark follow the system (design principle §6). This overrides
    /// that, which matters mostly for looking at both without changing the
    /// whole machine over.
    pub theme: Theme,
    /// What to do with the wait, if anything.
    pub waiting: Waiting,
}

/// The waiting window.
///
/// Off by default, and deliberately so. Muninn's premise is that you walk away
/// while the agent works — but at five minutes, leaving costs more than it
/// saves, and staring at a log is what this tool exists to stop. This is for
/// that gap, for people who would rather stay put than context-switch. It is a
/// setting because it is a matter of taste, not of correctness.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Waiting {
    pub game: Game,
    /// How long a turn must still be running before the window appears.
    ///
    /// Most turns finish in seconds. Opening a game for those would be an
    /// interruption rather than company, so nothing happens until the wait is
    /// long enough to be a wait.
    pub after_seconds: u64,
}

impl Default for Waiting {
    fn default() -> Self {
        Self { game: Game::Off, after_seconds: 15 }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Game {
    #[default]
    Off,
    /// The raven flies out while the agent works, and the panel is it coming
    /// back — which is the myth the README opens with.
    Raven,
    /// The other one.
    Dino,
    /// Minesweeper in a 5×5×5 volume, orbited and zoomed.
    Mines,
    /// A maze walked in first person, with a pull-back to see the whole thing.
    Maze,
    /// Chess against Stockfish. Muninn draws; the engine does the thinking.
    Chess,
}

impl Game {
    pub const ALL: [Game; 6] =
        [Game::Off, Game::Raven, Game::Dino, Game::Mines, Game::Maze, Game::Chess];

    pub fn label(self) -> &'static str {
        match self {
            Game::Off => "Nothing",
            Game::Raven => "Muninn's flight",
            Game::Dino => "Runner",
            Game::Mines => "Minesweeper 3D",
            Game::Maze => "Maze",
            Game::Chess => "Chess",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Game::Off => "wait-off",
            Game::Raven => "wait-raven",
            Game::Dino => "wait-dino",
            Game::Mines => "wait-mines",
            Game::Maze => "wait-maze",
            Game::Chess => "wait-chess",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|g| g.id() == id)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

impl Theme {
    pub const ALL: [Theme; 3] = [Theme::System, Theme::Light, Theme::Dark];

    pub fn label(self) -> &'static str {
        match self {
            Theme::System => "System",
            Theme::Light => "Light",
            Theme::Dark => "Dark",
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Theme::System => "theme-system",
            Theme::Light => "theme-light",
            Theme::Dark => "theme-dark",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.id() == id)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SilentHours {
    pub enabled: bool,
    /// Local hour, 0–23, inclusive.
    pub from: u8,
    /// Local hour, 0–23, exclusive.
    pub to: u8,
}

impl Default for SilentHours {
    fn default() -> Self {
        Self { enabled: true, from: 22, to: 8 }
    }
}

impl SilentHours {
    pub fn covers(&self, hour: u8) -> bool {
        if !self.enabled {
            return false;
        }
        if self.from == self.to {
            return false;
        }
        if self.from < self.to {
            (self.from..self.to).contains(&hour)
        } else {
            // Wraps midnight, which is the ordinary case: 22 → 8.
            hour >= self.from || hour < self.to
        }
    }
}

fn path() -> Option<std::path::PathBuf> {
    Some(muninn_core::paths::data_dir()?.join("settings.json"))
}

pub fn load() -> Settings {
    path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(settings: &Settings) {
    let Some(path) = path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::write(path, text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silent_hours_wrap_around_midnight() {
        let h = SilentHours { enabled: true, from: 22, to: 8 };
        assert!(h.covers(23), "11pm is inside 10pm–8am");
        assert!(h.covers(0));
        assert!(h.covers(7));
        assert!(!h.covers(8), "8am is the exclusive end");
        assert!(!h.covers(12));
        assert!(!h.covers(21));
    }

    #[test]
    fn silent_hours_also_work_without_wrapping() {
        let h = SilentHours { enabled: true, from: 9, to: 17 };
        assert!(h.covers(9));
        assert!(h.covers(16));
        assert!(!h.covers(17));
        assert!(!h.covers(3));
    }

    #[test]
    fn disabled_or_empty_ranges_never_silence_anything() {
        assert!(!SilentHours { enabled: false, from: 22, to: 8 }.covers(23));
        assert!(!SilentHours { enabled: true, from: 5, to: 5 }.covers(5));
    }

    #[test]
    fn a_missing_or_broken_settings_file_gives_defaults() {
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert!(!s.muted);
        assert!(s.silent_hours.enabled);

        // A partial file must not wipe the rest.
        let s: Settings = serde_json::from_str(r#"{"muted": true}"#).unwrap();
        assert!(s.muted);
        assert_eq!(s.silent_hours.from, 22);
    }
}
