//! Recovering what the user actually asked for.
//!
//! The `Stop` payload carries the agent's answer but not the question. The
//! question is in the session transcript, which ADR-0002 is emphatic must never
//! be read on the critical path — it lags the live conversation, and racing it
//! is exactly the bug that architecture avoids.
//!
//! Reading it *here* is the case ARCHITECTURE.md anticipated: "the transcript
//! remains useful for context … and Muninn may read it lazily after the panel is
//! already on screen." This runs when the details window opens, seconds or
//! minutes later, and nothing waits on it.
//!
//! Shapes verified against a real Claude Code transcript rather than assumed —
//! AGENTS.md asks for exactly that before relying on a field.

use std::path::Path;

/// Find the prompt that began this turn.
///
/// `prompt_id` comes from the `Stop` payload, so the match is exact rather than
/// "the most recent thing that looked like a user message". Without one — or if
/// that id is not in the file — the last typed prompt is the best available
/// answer, and being one turn stale is better than showing nothing.
pub fn user_prompt(path: &Path, prompt_id: Option<&str>) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;

    let mut fallback = None;
    for line in text.lines() {
        let Ok(record) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(prompt) = typed_prompt(&record) else { continue };

        if prompt_id.is_some() && record.get("promptId").and_then(|v| v.as_str()) == prompt_id {
            return Some(prompt);
        }
        fallback = Some(prompt);
    }

    fallback
}

/// The text of a record, if it is something the user actually typed.
///
/// The filter matters. A transcript's `user` records are mostly tool results
/// being fed back to the agent — 553 of them against 41 real prompts in the
/// session this was written against. `promptSource` is what separates them.
fn typed_prompt(record: &serde_json::Value) -> Option<String> {
    if record.get("type")?.as_str()? != "user" {
        return None;
    }
    if record.get("isSidechain").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None; // a subagent's turn, not the user's
    }
    match record.get("promptSource").and_then(|v| v.as_str()) {
        Some("typed" | "queued") => {}
        _ => return None,
    }

    let content = record.get("message")?.get("content")?;
    let text = match content {
        // Both shapes occur: a bare string, or the block form.
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(items) => items
            .iter()
            .filter(|i| i.get("type").and_then(|t| t.as_str()) == Some("text"))
            .filter_map(|i| i.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };

    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Named per test, not per shape. Keying the file on the line count meant
    /// two tests with the same number of lines shared a path and raced.
    fn write(name: &str, lines: &[&str]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("muninn-transcript-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{name}.jsonl"));
        std::fs::write(&path, lines.join("\n")).unwrap();
        path
    }

    #[test]
    fn matches_the_prompt_that_began_the_turn() {
        let path = write("matched", &[
            r#"{"type":"user","promptSource":"typed","promptId":"a","message":{"content":"first"}}"#,
            r#"{"type":"user","promptSource":"typed","promptId":"b","message":{"content":"second"}}"#,
        ]);
        assert_eq!(user_prompt(&path, Some("a")).as_deref(), Some("first"));
        assert_eq!(user_prompt(&path, Some("b")).as_deref(), Some("second"));
    }

    #[test]
    fn ignores_tool_results_and_subagents() {
        // The overwhelming majority of `user` records are these. Showing one as
        // "what you asked for" would be worse than showing nothing.
        let path = write("filtered", &[
            r#"{"type":"user","message":{"content":"a tool result"},"toolUseResult":{}}"#,
            r#"{"type":"user","promptSource":"typed","isSidechain":true,"message":{"content":"subagent"}}"#,
            r#"{"type":"user","promptSource":"typed","promptId":"x","message":{"content":"the real one"}}"#,
        ]);
        assert_eq!(user_prompt(&path, None).as_deref(), Some("the real one"));
    }

    #[test]
    fn reads_the_block_content_form_too() {
        let path = write("blocked", &[
            r#"{"type":"user","promptSource":"typed","message":{"content":[{"type":"text","text":"blocked form"}]}}"#,
        ]);
        assert_eq!(user_prompt(&path, None).as_deref(), Some("blocked form"));
    }

    #[test]
    fn an_unknown_prompt_id_falls_back_to_the_last_one() {
        // One turn stale beats an empty section.
        let path = write("fallback", &[
            r#"{"type":"user","promptSource":"typed","promptId":"a","message":{"content":"first"}}"#,
            r#"{"type":"user","promptSource":"queued","promptId":"b","message":{"content":"second"}}"#,
        ]);
        assert_eq!(user_prompt(&path, Some("nope")).as_deref(), Some("second"));
    }

    #[test]
    fn a_missing_or_broken_transcript_is_not_an_error() {
        assert_eq!(user_prompt(Path::new("/nonexistent"), None), None);
        let path = write("garbage", &["not json at all", "{}", r#"{"type":"user"}"#]);
        assert_eq!(user_prompt(&path, None), None);
    }
}
