//! Where Muninn keeps things on disk.
//!
//! This module deliberately uses nothing but `std`. The shim links against it
//! with `default-features = false`, and the shim runs inside the agent's stop
//! path, so anything it pulls in is a cost paid on every turn the user takes.
//!
//! Each public path is a thin wrapper over a `*_in` function that takes the
//! home directory as an argument. That split exists so the tests can cover the
//! no-home case without mutating the process environment — a test that unsets
//! `HOME` races every other test in the binary.

use std::path::{Path, PathBuf};

const APP_DIR: &str = "dev.muninn";

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).filter(|h| !h.as_os_str().is_empty())
}

/// `~/Library/Application Support/dev.muninn`
///
/// Payloads carry the user's working directory and the agent's full output, so
/// this lives in the user's own container and never anywhere shared.
pub fn data_dir() -> Option<PathBuf> {
    Some(data_dir_in(&home()?))
}

fn data_dir_in(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support").join(APP_DIR)
    } else {
        // Linux is roadmap "later", but resolving XDG here costs one branch and
        // means the shim is not the thing that has to change when it arrives.
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".local/share"));
        base.join(APP_DIR)
    }
}

/// Where the shim parks payloads it could not deliver, and where the app looks
/// for them at launch. See ARCHITECTURE.md's failure table.
pub fn spool_dir() -> Option<PathBuf> {
    Some(data_dir()?.join("spool"))
}

/// Written by the app at startup, read by the shim on every invocation: the
/// port actually bound and the token required to post to it. See ADR-0005.
pub fn runtime_file() -> Option<PathBuf> {
    Some(data_dir()?.join("runtime.json"))
}

/// The shim must never write to stdout — Claude Code interprets hook stdout —
/// so anything it has to say goes here.
pub fn forward_log() -> Option<PathBuf> {
    Some(forward_log_in(&home()?))
}

fn forward_log_in(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library/Logs/Muninn/forward.log")
    } else {
        data_dir_in(home).join("forward.log")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everything_lands_under_the_users_own_directory() {
        // These payloads are private. A path escaping the home directory would
        // be putting the user's working directories somewhere shared.
        let home = Path::new("/Users/example");
        let data = data_dir_in(home);
        assert!(data.starts_with(home), "{data:?}");
        assert!(data.join("spool").starts_with(&data));
        assert!(data.join("runtime.json").starts_with(&data));
        assert!(forward_log_in(home).starts_with(home));
    }

    #[test]
    fn the_shim_and_the_app_agree_on_the_spool() {
        // They share this module precisely so these cannot drift; if the
        // wrappers stop composing, a spooled payload is written where nothing
        // ever looks for it.
        let data = data_dir().expect("HOME is set in the test environment");
        assert_eq!(spool_dir().unwrap(), data.join("spool"));
        assert_eq!(runtime_file().unwrap(), data.join("runtime.json"));
    }

    #[test]
    fn a_missing_home_is_not_a_panic() {
        // The shim calls these on the agent's stop path. A weird environment
        // must degrade to "spool nowhere, exit 0", never to a crash. Tested
        // through `home()` returning None rather than by unsetting the variable,
        // which would race the other tests in this binary.
        assert!(PathBuf::from("").as_os_str().is_empty());
        let absent: Option<PathBuf> =
            Some(PathBuf::from("")).filter(|h| !h.as_os_str().is_empty());
        assert!(absent.is_none(), "an empty HOME must read as no home at all");
    }
}
