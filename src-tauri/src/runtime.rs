//! The handshake between the app and the shim — see ADR-0005.
//!
//! The app binds a port, mints a token, and publishes both here. The shim reads
//! this file on every invocation. That indirection is what makes a busy port a
//! non-event rather than a lost payload, and it is what lets the receiver
//! demand a secret that a passing web page cannot know.

use std::io::Write;
use std::path::PathBuf;

/// Preferred port. Nothing breaks if it is taken — see [`crate::receiver::bind`].
pub const PREFERRED_PORT: u16 = 8787;

/// 32 bytes of kernel randomness, hex encoded.
///
/// Read straight from `/dev/urandom` rather than through a crate: the app has
/// exactly one use for randomness and this is a dozen lines.
pub fn new_token() -> String {
    use std::io::Read;
    let mut bytes = [0u8; 32];
    match std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)) {
        Ok(()) => bytes.iter().map(|b| format!("{b:02x}")).collect(),
        Err(_) => {
            // Refusing to run would be worse than a weaker token on a machine
            // where /dev/urandom is somehow unavailable, but it must not look
            // like a real one.
            eprintln!("muninn: /dev/urandom unavailable; receiver token is not random");
            format!("fallback-{}-{}", std::process::id(), now_millis())
        }
    }
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn path() -> Option<PathBuf> {
    muninn_core::paths::runtime_file()
}

/// Publish the bound port and token for the shim to find.
pub fn publish(port: u16, token: &str) -> std::io::Result<()> {
    let Some(path) = path() else {
        return Err(std::io::Error::other("no home directory"));
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let contents = format!(
        "{{\n  \"port\": {port},\n  \"token\": \"{token}\",\n  \"pid\": {}\n}}\n",
        std::process::id()
    );

    // Written 0600 before any content lands in it. The token is the only thing
    // standing between a local process and the ability to post a fake panel.
    let mut file = open_private(&path)?;
    file.write_all(contents.as_bytes())?;
    file.sync_all()
}

#[cfg(unix)]
fn open_private(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
}

#[cfg(not(unix))]
fn open_private(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    std::fs::File::create(path)
}

/// Remove the file on the way out, so a shim invoked after the app quits fails
/// fast and spools instead of waiting on a port nobody is listening to.
pub fn clear() {
    if let Some(path) = path() {
        let _ = std::fs::remove_file(path);
    }
}
