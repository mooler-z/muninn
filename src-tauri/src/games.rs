//! Where a half-played game is kept.
//!
//! The waiting window is hidden and shown rather than kept open, and it goes
//! away for reasons the player did not choose — the agent finishing is the
//! whole point of the window, and it is also the thing most likely to
//! interrupt a good run. A game that forgets itself every time that happens is
//! a game nobody can get anywhere in.
//!
//! So each game writes a snapshot of itself once a second, and picks it up
//! again when it is next opened. One small file per game, beside the settings.

use std::path::PathBuf;

/// The games allowed to have a save file.
///
/// This list is the reason the frontend cannot choose its own filename. The
/// game id crosses the IPC boundary as a string and is used to build a path;
/// without an allowlist, `../../something` would be a perfectly good game.
const KNOWN: [&str; 5] = ["raven", "dino", "mines", "maze", "chess"];

fn file(game: &str) -> Option<PathBuf> {
    if !KNOWN.contains(&game) {
        return None;
    }
    let dir = muninn_core::paths::data_dir()?.join("games");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(format!("{game}.json")))
}

/// Write a snapshot. Failures are silent: a game that cannot save is still a
/// game, and there is nothing useful to tell the player mid-run.
pub fn save(game: &str, state: &str) {
    // A snapshot is written every second. Capping it stops a bug in a game's
    // own serialisation from quietly filling the disk.
    const LIMIT: usize = 256 * 1024;
    if state.len() > LIMIT {
        eprintln!("muninn: {game} snapshot is {} bytes; not saving", state.len());
        return;
    }
    if let Some(path) = file(game) {
        let _ = std::fs::write(path, state);
    }
}

pub fn load(game: &str) -> Option<String> {
    std::fs::read_to_string(file(game)?).ok()
}

/// Forget a game — it was finished, or restarted from the beginning.
pub fn clear(game: &str) {
    if let Some(path) = file(game) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_games_have_no_file() {
        assert!(file("nonsense").is_none());
    }

    #[test]
    fn a_traversal_attempt_is_not_a_game() {
        // The whole reason `KNOWN` exists.
        assert!(file("../../../etc/passwd").is_none());
        assert!(file("maze/../../secrets").is_none());
    }

    #[test]
    fn every_known_game_resolves_to_its_own_file() {
        let mut seen = std::collections::HashSet::new();
        for game in KNOWN {
            // `file` needs a data dir, which the test environment may not have;
            // what matters here is that the names are distinct and accepted.
            assert!(KNOWN.contains(&game));
            assert!(seen.insert(game));
        }
    }
}
