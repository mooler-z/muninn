//! `muninn-forward` — the shim the agent invokes when it finishes a turn.
//!
//! This runs inside the agent's stop path. If it hangs, the agent appears to
//! hang; if it fails loudly, the agent looks broken. That makes it the piece
//! most likely to get Muninn uninstalled, so AGENTS.md gives it three hard
//! rules and this file exists to obey them:
//!
//! 1. **Never block the agent.** A watchdog thread exits the process at 500 ms
//!    no matter what the rest of the code is doing. Timeouts on the socket are
//!    belt and braces; the watchdog is the actual guarantee.
//! 2. **Never write to stdout.** Claude Code interprets hook stdout. Diagnostics
//!    go to a log file and nowhere else — not even stderr.
//! 3. **Always exit 0.** Including on panic, which the release profile would
//!    otherwise turn into an abort and a non-zero status.
//!
//! It also has no dependencies, which it earns by **never parsing the payload**.
//! The agent's stdin becomes the request body untouched and the two things we
//! know go in the query string. Normalising, resolving the git branch and
//! parsing the summary all happen in the app, off the stop path.

use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The whole budget. Claude Code's hook contract asks for fast; 500 ms is the
/// number ARCHITECTURE.md commits to.
const BUDGET: Duration = Duration::from_millis(500);
/// Each socket step gets a third, so all three can time out inside the budget.
const STEP: Duration = Duration::from_millis(150);
/// Closing messages are prose. Anything past this is not a summary and we are
/// not going to hold it in memory on the stop path.
const MAX_BODY: usize = 8 * 1024 * 1024;

const SOURCES: [&str; 2] = ["claude-code", "codex"];
// "started" is not a summary — it is the turn beginning, used to open the
// waiting window. The shim does not care about the difference.
const KINDS: [&str; 4] = ["completed", "needs-input", "failed", "started"];

fn main() {
    // A panic must still leave the agent looking healthy. The release profile
    // sets panic = "abort", so there is no unwinding to catch — the hook runs
    // first and turns it into a clean exit.
    std::panic::set_hook(Box::new(|_| std::process::exit(0)));

    // The watchdog is what actually enforces the budget. Everything below it
    // may block, retry or misbehave; none of that can outlive this thread.
    std::thread::spawn(|| {
        std::thread::sleep(BUDGET);
        std::process::exit(0);
    });

    run();
    std::process::exit(0);
}

fn run() {
    let (source, kind) = match args() {
        Some(v) => v,
        // An unrecognised --source means a caller we do not understand. Better
        // to drop it than to spool something the app will never make sense of.
        None => return log("unrecognised --source/--kind; nothing forwarded"),
    };

    let body = match read_stdin() {
        Some(b) if !b.is_empty() => b,
        Some(_) => return log("empty stdin; nothing forwarded"),
        None => return log("could not read stdin"),
    };

    match deliver(&body, source, kind) {
        Ok(()) => {}
        Err(e) => {
            // ARCHITECTURE.md's promise is that nothing is lost. The app drains
            // this at next launch.
            log(&format!("delivery failed ({e}); spooling"));
            if let Err(e) = spool(&body, source, kind) {
                log(&format!("spooling failed too: {e}"));
            }
        }
    }
}

fn args() -> Option<(&'static str, &'static str)> {
    let mut source = None;
    let mut kind = "completed";

    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        match argv[i].as_str() {
            "--source" => {
                source = argv.get(i + 1).cloned();
                i += 2;
            }
            "--kind" => {
                if let Some(k) = argv.get(i + 1) {
                    kind = KINDS.iter().find(|v| *v == k).copied().unwrap_or("completed");
                }
                i += 2;
            }
            _ => i += 1,
        }
    }

    // Matching against a fixed set is also what makes it safe to drop these
    // straight into a query string without escaping.
    let given = source?;
    let source = SOURCES.iter().find(|v| **v == given)?;
    Some((source, kind))
}

fn read_stdin() -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    std::io::stdin().take(MAX_BODY as u64).read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn deliver(body: &[u8], source: &str, kind: &str) -> Result<(), String> {
    let (port, token) = runtime().ok_or("no runtime file; app is not running")?;
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();

    let stream = TcpStream::connect_timeout(&addr, STEP).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(STEP)).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(STEP)).map_err(|e| e.to_string())?;
    stream.set_nodelay(true).ok();

    let mut stream = stream;
    let head = format!(
        "POST /event?source={source}&kind={kind} HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         Content-Type: application/json\r\n\
         X-Muninn-Token: {token}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );

    stream.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
    stream.write_all(body).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;

    // Only the status line matters, and only so a rejected payload gets spooled
    // rather than silently dropped. Reading a fixed slice keeps a chatty or
    // hostile responder from holding us here.
    let mut head = [0u8; 64];
    let n = stream.read(&mut head).map_err(|e| e.to_string())?;
    stream.shutdown(Shutdown::Both).ok();

    let status = String::from_utf8_lossy(&head[..n]);
    if status.starts_with("HTTP/1.1 2") || status.starts_with("HTTP/1.0 2") {
        Ok(())
    } else {
        Err(format!("receiver said: {}", status.lines().next().unwrap_or("nothing")))
    }
}

/// Read the port and token the app published at startup. See ADR-0005.
///
/// This is a file we write ourselves with a known flat shape, so it is scanned
/// for the two keys rather than parsed as general JSON — the alternative is a
/// serde dependency on the stop path, which is not a trade worth making.
fn runtime() -> Option<(u16, String)> {
    let text = std::fs::read_to_string(muninn_core::paths::runtime_file()?).ok()?;
    let port: u16 = scan(&text, "port")?.parse().ok()?;
    let token = scan(&text, "token")?;
    Some((port, token))
}

fn scan(text: &str, key: &str) -> Option<String> {
    let at = text.find(&format!("\"{key}\""))?;
    let after = text[at..].find(':')? + at + 1;
    let rest = text[after..].trim_start();
    if let Some(s) = rest.strip_prefix('"') {
        Some(s[..s.find('"')?].to_string())
    } else {
        let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
        (end > 0).then(|| rest[..end].to_string())
    }
}

/// Park an undeliverable payload for the app to pick up at launch.
///
/// The body is written verbatim and the two things we know go in the filename,
/// so this path parses nothing either.
fn spool(body: &[u8], source: &str, kind: &str) -> Result<(), String> {
    let dir = muninn_core::paths::spool_dir().ok_or("no home directory")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?;
    // Milliseconds keep the drain order right; the pid and nanos break ties
    // between two agents finishing in the same millisecond.
    let name = format!(
        "{:013}-{source}-{kind}-{}{:09}.json",
        now.as_millis(),
        std::process::id(),
        now.subsec_nanos()
    );

    std::fs::write(dir.join(name), body).map_err(|e| e.to_string())
}

/// Best-effort, and silent when it fails. Rule 2: nothing reaches stdout.
fn log(message: &str) {
    let Some(path) = muninn_core::paths::forward_log() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{secs} muninn-forward: {message}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_the_runtime_file() {
        let text = r#"{"port": 8787, "token": "abc123", "pid": 42}"#;
        assert_eq!(scan(text, "port").as_deref(), Some("8787"));
        assert_eq!(scan(text, "token").as_deref(), Some("abc123"));
    }

    #[test]
    fn a_mangled_runtime_file_is_not_a_panic() {
        // A truncated or half-written file must degrade to spooling.
        for text in ["", "{", r#"{"port":"#, r#"{"port": }"#, r#"{"token": "x"}"#, "not json"] {
            let _ = scan(text, "port");
            let _ = scan(text, "token");
        }
    }
}
