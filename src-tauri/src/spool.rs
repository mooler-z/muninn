//! Draining what the shim parked while the app was not running.
//!
//! ARCHITECTURE.md's promise is that nothing is lost when the app is closed.
//! The shim keeps its end by writing the payload verbatim and encoding the two
//! things it knows in the filename; this is the other end.

use std::path::PathBuf;

/// A payload that arrived while nobody was listening.
pub struct Spooled {
    pub source: String,
    pub kind: String,
    pub body: Vec<u8>,
    path: PathBuf,
}

impl Spooled {
    /// Remove the file once the event is safely queued.
    pub fn consume(self) {
        let _ = std::fs::remove_file(self.path);
    }
}

/// How many spooled payloads to replay at launch.
///
/// A fortnight away from the machine should not greet the user with four
/// hundred panels; the whole point of this tool is to remove that kind of pile.
/// Anything past the cap is deleted, and [`drain`] reports how many.
const MAX_REPLAY: usize = 20;

pub struct Drained {
    pub events: Vec<Spooled>,
    /// Discarded because they were older than the most recent [`MAX_REPLAY`].
    pub dropped: usize,
}

/// Read the spool oldest-first.
///
/// Filenames lead with zero-padded milliseconds, so lexical order is
/// chronological order and no parsing is needed to sort.
pub fn drain() -> Drained {
    let Some(dir) = muninn_core::paths::spool_dir() else {
        return Drained { events: Vec::new(), dropped: 0 };
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Drained { events: Vec::new(), dropped: 0 };
    };

    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();

    let dropped = files.len().saturating_sub(MAX_REPLAY);
    for stale in files.iter().take(dropped) {
        let _ = std::fs::remove_file(stale);
    }

    let events = files
        .into_iter()
        .skip(dropped)
        .filter_map(|path| {
            let body = std::fs::read(&path).ok()?;
            let (source, kind) = parse_name(&path);
            Some(Spooled { source, kind, body, path })
        })
        .collect();

    Drained { events, dropped }
}

/// `<millis>-<source>-<kind>-<unique>.json`
///
/// Sources and kinds contain hyphens themselves (`claude-code`, `needs-input`),
/// so this splits from the known ends rather than on every hyphen.
fn parse_name(path: &std::path::Path) -> (String, String) {
    const FALLBACK: (&str, &str) = ("claude-code", "completed");
    let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
        return (FALLBACK.0.into(), FALLBACK.1.into());
    };

    let mut middle = stem.split_once('-').map(|x| x.1).unwrap_or_default();
    if let Some(last) = middle.rfind('-') {
        middle = &middle[..last];
    }

    for source in ["claude-code", "codex"] {
        if let Some(rest) = middle.strip_prefix(source) {
            let kind = rest.trim_start_matches('-');
            let kind = if kind.is_empty() { FALLBACK.1 } else { kind };
            return (source.to_string(), kind.to_string());
        }
    }

    (FALLBACK.0.into(), FALLBACK.1.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn reads_source_and_kind_back_out_of_the_filename() {
        // These are exactly the names crates/muninn-forward/src/main.rs writes.
        let cases = [
            ("0001700000000-claude-code-completed-12345678.json", ("claude-code", "completed")),
            ("0001700000000-claude-code-needs-input-9000.json", ("claude-code", "needs-input")),
            ("0001700000000-codex-completed-1.json", ("codex", "completed")),
            ("0001700000000-codex-failed-1.json", ("codex", "failed")),
        ];
        for (name, want) in cases {
            let (source, kind) = parse_name(Path::new(name));
            assert_eq!((source.as_str(), kind.as_str()), want, "for {name}");
        }
    }

    #[test]
    fn an_unrecognisable_filename_still_yields_a_usable_event() {
        // Losing a summary because its filename got mangled would be worse than
        // guessing the common case.
        let (source, kind) = parse_name(Path::new("garbage.json"));
        assert_eq!(source, "claude-code");
        assert_eq!(kind, "completed");
    }

    #[test]
    fn milliseconds_are_padded_so_lexical_order_is_chronological() {
        // The drain relies on sorting strings. Unpadded numbers would replay a
        // panel from 2001 after one from today.
        let mut names = ["0001700000002-x.json", "0001700000010-x.json", "0001700000001-x.json"];
        names.sort();
        assert_eq!(names[0], "0001700000001-x.json");
        assert_eq!(names[2], "0001700000010-x.json");
    }
}
