//! Turning a source's payload into the one internal event.
//!
//! Everything source-specific lives here, which is the whole reason the panel
//! never learns which agent produced a summary. Adding Codex is a change to
//! this file.

use std::path::{Path, PathBuf};

use muninn_core::{Kind, MuninnEvent, Source};
use serde_json::Value;
use time::OffsetDateTime;

/// Build an event from a raw hook payload.
///
/// Nothing here returns an error. A payload we cannot make sense of still
/// produces an event — the panel says "finished, no summary" rather than
/// swallowing the fact that a turn ended.
pub fn normalise(source: &str, kind: &str, body: &[u8], id: String) -> MuninnEvent {
    let source = Source::parse(source).unwrap_or(Source::ClaudeCode);
    let kind = Kind::parse(kind).unwrap_or(Kind::Completed);
    let received_at = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());

    let payload: Value = serde_json::from_slice(body).unwrap_or(Value::Null);

    let message = str_field(&payload, "last_assistant_message")
        // `Notification` payloads carry no closing message. The docs mark their
        // shape UNVERIFIED beyond a few fields, so we look for a couple of
        // plausible names and are content to find neither.
        .or_else(|| str_field(&payload, "message"))
        .unwrap_or_default();

    let mut event = MuninnEvent::from_message(id, source, kind, received_at, &message);

    event.session_id = str_field(&payload, "session_id");
    event.prompt_id = str_field(&payload, "prompt_id");
    event.transcript_path = str_field(&payload, "transcript_path");
    let cwd = str_field(&payload, "cwd");
    event.project = cwd.as_deref().and_then(project_name);
    event.git_branch = cwd.as_deref().and_then(|c| git_branch(Path::new(c)));
    event.cwd = cwd;

    event
}

/// Which session a raw payload belongs to.
///
/// The waiting window needs this from a `started` payload, which never becomes
/// a `MuninnEvent` — it is the turn beginning, not a summary. Falling back to
/// the working directory keeps two terminals in two projects apart even if an
/// agent ever stops sending an id; the last resort collapses them, which is
/// the old single-counter behaviour and no worse than it was.
pub fn session_of(body: &[u8]) -> String {
    let payload: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    str_field(&payload, "session_id")
        .or_else(|| str_field(&payload, "cwd"))
        .unwrap_or_else(|| "?".to_string())
}

/// Claude Code's idle nudge, which is not a question.
///
/// Leave a session alone for a minute and the `Notification` hook fires with
/// "Claude is waiting for your input" — a reminder about a turn whose summary
/// already had its panel. Showing a second, emptier panel for it is exactly
/// the "random popup when nothing is going on" experience, so it is dropped
/// before it reaches the queue. Real asks — permission prompts, elicitation
/// dialogs — carry their own question text and pass through untouched.
pub fn idle_reminder(event: &MuninnEvent) -> bool {
    event.kind == Kind::NeedsInput
        && event.raw.trim().to_lowercase().contains("waiting for your input")
}

fn str_field(payload: &Value, key: &str) -> Option<String> {
    let s = payload.get(key)?.as_str()?.trim();
    (!s.is_empty()).then(|| s.to_string())
}

/// Basename of the working directory — what the design shows in the header, and
/// what the avatar's letter comes from.
fn project_name(cwd: &str) -> Option<String> {
    Path::new(cwd).file_name()?.to_str().map(str::to_string)
}

/// Resolve the current branch by reading `.git/HEAD`.
///
/// Deliberately not `git rev-parse`. The shim runs on the agent's stop path and
/// this runs just after it; neither is a place to spawn a subprocess when the
/// answer is one line of a file.
fn git_branch(start: &Path) -> Option<String> {
    let git = find_git_dir(start)?;
    let head = std::fs::read_to_string(git.join("HEAD")).ok()?;
    let head = head.trim();

    match head.strip_prefix("ref: refs/heads/") {
        Some(branch) => Some(branch.to_string()),
        // Detached HEAD. A short hash is more use to the reader than nothing,
        // and it is honest about not being on a branch.
        None if head.len() >= 7 && head.chars().all(|c| c.is_ascii_hexdigit()) => {
            Some(head[..7].to_string())
        }
        None => None,
    }
}

/// Walk up looking for `.git`, following the `gitdir:` pointer that worktrees
/// and submodules leave behind.
fn find_git_dir(start: &Path) -> Option<PathBuf> {
    for dir in start.ancestors() {
        let candidate = dir.join(".git");
        match std::fs::metadata(&candidate) {
            Ok(m) if m.is_dir() => return Some(candidate),
            Ok(m) if m.is_file() => {
                let text = std::fs::read_to_string(&candidate).ok()?;
                let target = text.trim().strip_prefix("gitdir:")?.trim();
                let target = PathBuf::from(target);
                return Some(if target.is_absolute() { target } else { dir.join(target) });
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const STOP: &str = r#"{
        "session_id": "abc123",
        "transcript_path": "/tmp/t.jsonl",
        "cwd": "/Users/me/signup-flow",
        "hook_event_name": "Stop",
        "last_assistant_message": "```muninn\ndone: Added phone verification\n```"
    }"#;

    #[test]
    fn normalises_a_stop_payload() {
        let e = normalise("claude-code", "completed", STOP.as_bytes(), "1".into());
        assert_eq!(e.session_id.as_deref(), Some("abc123"));
        assert_eq!(e.transcript_path.as_deref(), Some("/tmp/t.jsonl"));
        assert_eq!(e.project.as_deref(), Some("signup-flow"));
        assert_eq!(e.kind, Kind::Completed);
        assert_eq!(
            e.summary.as_ref().unwrap().done.as_deref(),
            Some("Added phone verification")
        );
    }

    #[test]
    fn a_payload_with_no_message_still_produces_an_event() {
        // Claude Code's `Notification` payload carries no closing text. The
        // turn still happened, so the panel still has something to say.
        let body = br#"{"session_id":"x","cwd":"/tmp","notification_type":"permission_prompt"}"#;
        let e = normalise("claude-code", "needs-input", body, "1".into());
        assert_eq!(e.kind, Kind::NeedsInput);
        assert!(e.is_empty());
    }

    #[test]
    fn junk_in_is_an_event_out_not_a_panic() {
        for body in [b"".as_slice(), b"not json", b"[]", b"null", b"{\"cwd\": 42}"] {
            let e = normalise("claude-code", "completed", body, "1".into());
            assert!(e.summary.is_none());
        }
    }

    #[test]
    fn an_unknown_source_or_kind_degrades_rather_than_failing() {
        let e = normalise("some-agent", "exploded", STOP.as_bytes(), "1".into());
        assert_eq!(e.source, Source::ClaudeCode);
        assert_eq!(e.kind, Kind::Completed);
    }

    #[test]
    fn reads_the_branch_from_this_very_repository() {
        // Muninn's own checkout is the fixture: if this stops working, the
        // header loses its branch line.
        let here = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert!(git_branch(here).is_some(), "should resolve a branch from {here:?}");
    }

    #[test]
    fn the_idle_nudge_is_not_a_question() {
        // The exact payload the stray popups carried, from a real history.
        let body = br#"{"session_id":"x","cwd":"/tmp","message":"Claude is waiting for your input"}"#;
        let e = normalise("claude-code", "needs-input", body, "id".into());
        assert!(idle_reminder(&e), "the idle reminder must be dropped");
    }

    #[test]
    fn a_real_permission_prompt_still_knocks() {
        let body = br#"{"session_id":"x","cwd":"/tmp","message":"Claude needs your permission to use Bash"}"#;
        let e = normalise("claude-code", "needs-input", body, "id".into());
        assert!(!idle_reminder(&e), "a genuine ask must pass through");
    }

    #[test]
    fn a_completed_turn_is_never_mistaken_for_a_nudge() {
        let body = br#"{"cwd":"/tmp","last_assistant_message":"waiting for your input is a phrase I merely mentioned"}"#;
        let e = normalise("claude-code", "completed", body, "id".into());
        assert!(!idle_reminder(&e), "the filter is scoped to needs-input");
    }

    #[test]
    fn no_repository_is_not_an_error() {
        assert_eq!(git_branch(Path::new("/")), None);
    }
}
