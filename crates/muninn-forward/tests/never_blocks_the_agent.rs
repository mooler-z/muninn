//! The tests AGENTS.md singles out.
//!
//! > Anything touching the shim needs a test that it exits 0 and within budget
//! > when the receiver is unreachable, refusing connections, and hanging. That
//! > failure mode is the one that would make Muninn feel like it broke the
//! > user's agent, and it is the reason they would uninstall it.
//!
//! Each case asserts three things: the process exits 0, it finishes well inside
//! the budget, and the payload was spooled rather than dropped. The hanging case
//! is the one with teeth — the fake receiver sleeps for five seconds, so a shim
//! without its timeouts and watchdog would take five seconds to fail and the
//! elapsed assertion would catch it.

use std::io::Read;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const BIN: &str = env!("CARGO_BIN_EXE_muninn-forward");

/// The shim's own budget is 500 ms. Twice that leaves room for process spawn on
/// a loaded machine while still failing loudly if a guard is ever removed.
const CEILING: Duration = Duration::from_millis(1000);

const PAYLOAD: &str = r#"{"session_id":"t","cwd":"/tmp/p","last_assistant_message":"Did the thing."}"#;

/// An isolated HOME, so a test run never reads or writes the developer's real
/// spool directory.
struct Home(PathBuf);

impl Home {
    fn new(tag: &str) -> Self {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos();
        let dir = std::env::temp_dir().join(format!("muninn-test-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        Home(dir)
    }

    /// Mirrors `muninn_core::paths` for whichever platform the test runs on.
    fn data_dir(&self) -> PathBuf {
        if cfg!(target_os = "macos") {
            self.0.join("Library/Application Support/dev.muninn")
        } else {
            self.0.join(".local/share/dev.muninn")
        }
    }

    fn write_runtime(&self, port: u16) {
        let dir = self.data_dir();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("runtime.json"),
            format!(r#"{{"port": {port}, "token": "test-token"}}"#),
        )
        .unwrap();
    }

    fn spooled(&self) -> Vec<PathBuf> {
        let dir = self.data_dir().join("spool");
        let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
        entries.flatten().map(|e| e.path()).collect()
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Run {
    code: Option<i32>,
    stdout: Vec<u8>,
    elapsed: Duration,
}

fn forward(home: &Path) -> Run {
    let started = Instant::now();
    let mut child = Command::new(BIN)
        .args(["--source", "claude-code", "--kind", "completed"])
        .env("HOME", home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("shim binary should run");

    use std::io::Write;
    child.stdin.take().unwrap().write_all(PAYLOAD.as_bytes()).ok();

    let mut stdout = Vec::new();
    let mut out = child.stdout.take().unwrap();
    let status = child.wait().expect("shim should terminate");
    out.read_to_end(&mut stdout).ok();

    Run { code: status.code(), stdout, elapsed: started.elapsed() }
}

/// Every case asserts the same contract, so it is written down once.
fn assert_contract(run: &Run, case: &str) {
    assert_eq!(run.code, Some(0), "{case}: must exit 0, a shim must never look like a failure");
    assert!(
        run.elapsed < CEILING,
        "{case}: took {:?}, over the {CEILING:?} ceiling — the agent would feel this",
        run.elapsed
    );
    assert!(
        run.stdout.is_empty(),
        "{case}: wrote {:?} to stdout, which Claude Code interprets",
        String::from_utf8_lossy(&run.stdout)
    );
}

#[test]
fn receiver_unreachable_because_the_app_is_not_running() {
    // No runtime file at all: the app has never started, or has quit.
    let home = Home::new("unreachable");
    let run = forward(&home.0);

    assert_contract(&run, "unreachable");
    assert_eq!(home.spooled().len(), 1, "unreachable: payload must be spooled, not lost");
    assert_eq!(std::fs::read_to_string(&home.spooled()[0]).unwrap(), PAYLOAD);
}

#[test]
fn receiver_refusing_connections() {
    // A stale runtime file pointing at a port nothing is listening on — the app
    // crashed, or was killed between publishing the file and now.
    let home = Home::new("refusing");
    let port = {
        // Bind and immediately drop, so the port is real but closed.
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    home.write_runtime(port);

    let run = forward(&home.0);

    assert_contract(&run, "refusing");
    assert_eq!(home.spooled().len(), 1, "refusing: payload must be spooled");
}

#[test]
fn receiver_accepts_then_hangs() {
    // The nastiest case, and the one plain error handling would miss: the
    // connection succeeds and then nothing ever comes back. Without the socket
    // timeouts and the watchdog this test would take five seconds.
    let home = Home::new("hanging");
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    home.write_runtime(listener.local_addr().unwrap().port());

    let hang = std::thread::spawn(move || {
        if let Ok((stream, _)) = listener.accept() {
            std::thread::sleep(Duration::from_secs(5));
            drop(stream);
        }
    });

    let run = forward(&home.0);

    assert_contract(&run, "hanging");
    assert_eq!(home.spooled().len(), 1, "hanging: payload must be spooled");
    drop(hang); // the thread finishes on its own; the test does not wait for it
}

#[test]
fn a_receiver_that_accepts_the_payload_leaves_nothing_spooled() {
    // The happy path, included so the failure cases are not passing by simply
    // never delivering anything.
    let home = Home::new("accepted");
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    home.write_runtime(listener.local_addr().unwrap().port());

    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        use std::io::Write;
        stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n").ok();
        stream.flush().ok();
        String::from_utf8_lossy(&buf[..n]).to_string()
    });

    let run = forward(&home.0);
    let request = server.join().unwrap();

    assert_contract(&run, "accepted");
    assert!(home.spooled().is_empty(), "accepted: nothing should be spooled");

    // The request the app will actually have to serve.
    assert!(request.starts_with("POST /event?source=claude-code&kind=completed HTTP/1.1"));
    assert!(request.contains("X-Muninn-Token: test-token"));
    assert!(request.contains("Content-Type: application/json"));
    assert!(request.ends_with(PAYLOAD), "the payload must arrive verbatim");
    // ADR-0005: the shim never sends an Origin header, which is what lets the
    // receiver treat one as proof the caller is a browser.
    assert!(!request.to_ascii_lowercase().contains("origin:"));
}

#[test]
fn an_unknown_source_is_dropped_rather_than_spooled() {
    // Spooling something the app will never understand just moves the problem.
    let home = Home::new("unknown-source");
    let started = Instant::now();
    let mut child = Command::new(BIN)
        .args(["--source", "some-other-agent"])
        .env("HOME", &home.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write;
    child.stdin.take().unwrap().write_all(PAYLOAD.as_bytes()).ok();
    let status = child.wait().unwrap();

    assert_eq!(status.code(), Some(0));
    assert!(started.elapsed() < CEILING);
    assert!(home.spooled().is_empty());
}

#[test]
fn empty_stdin_is_not_an_error() {
    // A turn that produced nothing still fires the hook.
    let home = Home::new("empty");
    let mut child = Command::new(BIN)
        .args(["--source", "claude-code"])
        .env("HOME", &home.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    drop(child.stdin.take());
    let status = child.wait().unwrap();

    assert_eq!(status.code(), Some(0));
    assert!(home.spooled().is_empty());
}
