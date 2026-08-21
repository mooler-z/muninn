//! The one internal event every source collapses into.
//!
//! Shape follows `ARCHITECTURE.md`. The point of normalising here is that the
//! panel never learns which agent produced a summary — adding Codex later is a
//! change to the normaliser, not to the UI.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::summary::{Body, Summary};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    ClaudeCode,
    Codex,
}

impl Source {
    /// How the design labels it in the panel's top-right corner.
    pub fn label(self) -> &'static str {
        match self {
            Source::ClaudeCode => "Claude Code",
            Source::Codex => "Codex",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "claude-code" => Some(Source::ClaudeCode),
            "codex" => Some(Source::Codex),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Completed,
    NeedsInput,
    /// Defined by ARCHITECTURE.md but not currently produced: no Claude Code
    /// hook event distinguishes a failed turn from a finished one. Kept so the
    /// panel's handling exists before a source that can report it does.
    Failed,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "completed" => Some(Kind::Completed),
            "needs-input" => Some(Kind::NeedsInput),
            "failed" => Some(Kind::Failed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MuninnEvent {
    pub id: String,
    pub source: Source,
    pub session_id: Option<String>,
    /// Which prompt began this turn. Lets the transcript be searched for the
    /// exact question rather than the most recent one — see `transcript.rs`.
    pub prompt_id: Option<String>,
    /// What was actually asked, once it has been recovered.
    ///
    /// Kept on the event rather than fetched from the transcript every time.
    /// The transcript is Claude Code's file, not ours: it rotates, it can be
    /// cleaned up, and it goes away entirely if the project moves — so a
    /// history that depends on it is a history that quietly loses its
    /// questions and keeps only the answers.
    ///
    /// Filled in after the panel is already on screen, never before. ADR-0002
    /// is explicit that reading the transcript must not sit between a turn
    /// ending and the panel appearing.
    #[serde(default)]
    pub prompt: Option<String>,
    /// Where the session's transcript lives. Read lazily and never on the
    /// critical path — ADR-0002.
    pub transcript_path: Option<String>,
    pub cwd: Option<String>,
    /// Basename of `cwd`, for grouping and for the design's avatar letter.
    pub project: Option<String>,
    pub git_branch: Option<String>,
    pub kind: Kind,
    #[serde(with = "time::serde::rfc3339")]
    pub received_at: OffsetDateTime,
    /// Present when the agent's closing message carried a usable `muninn`
    /// block. When it is `None` the panel renders `raw` as markdown — that
    /// path is not optional, see ADR-0004.
    pub summary: Option<Summary>,
    /// Always kept. With a summary present this is the message minus the
    /// block; without one it is the whole message.
    pub raw: String,
}

impl MuninnEvent {
    pub fn from_message(
        id: String,
        source: Source,
        kind: Kind,
        received_at: OffsetDateTime,
        message: &str,
    ) -> Self {
        let (summary, raw) = match crate::summary::parse(message) {
            Body::Structured { summary, raw } => (Some(summary), raw),
            Body::Raw { raw } => (None, raw),
        };

        Self {
            id,
            source,
            session_id: None,
            prompt_id: None,
            prompt: None,
            transcript_path: None,
            cwd: None,
            project: None,
            git_branch: None,
            kind,
            received_at,
            summary,
            raw,
        }
    }

    /// True when the agent finished but left us nothing to show. The panel says
    /// so in as many words rather than inventing a summary — design principle §5.
    pub fn is_empty(&self) -> bool {
        self.summary.as_ref().and_then(Summary::headline).is_none() && self.raw.trim().is_empty()
    }
}
