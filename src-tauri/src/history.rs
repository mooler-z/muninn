//! The last N summaries, kept on this Mac and nowhere else.
//!
//! "Kept on this Mac · last 50 turns" is what the design's history window says
//! in its footer, and it is a promise: there is no account, no sync and no
//! telemetry. These payloads carry the user's working directories and their
//! agent's full output.

use muninn_core::MuninnEvent;

fn path() -> Option<std::path::PathBuf> {
    Some(muninn_core::paths::data_dir()?.join("history.json"))
}

pub fn load() -> Vec<MuninnEvent> {
    path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save(events: &[MuninnEvent]) {
    let Some(path) = path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string(events) {
        let _ = std::fs::write(path, text);
    }
}
