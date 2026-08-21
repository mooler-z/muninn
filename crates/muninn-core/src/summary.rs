//! Parsing the summary contract — see `docs/summary-contract.md`.
//!
//! The one rule that outranks the others: **this never fails hard.** There is no
//! `Result` in this module's public surface, because a degraded panel is fine
//! and an empty one is not. Anything this parser cannot make sense of comes back
//! as [`Body::Raw`] carrying the agent's whole message, which the panel renders
//! as markdown.
//!
//! Scanning is hand-rolled rather than done with `regex`. The grammar is four
//! shapes wide and the crate is linked into an app that idles all day; a regex
//! engine is not worth carrying for this.

use std::fmt;

/// What the panel should render.
///
/// There is no error case on purpose. See the module note.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Body {
    /// A `muninn` block was found and carried at least one usable field.
    /// `raw` is the message with the block removed, so the panel never shows
    /// both the parsed fields and their source (contract rule 4).
    Structured { summary: Summary, raw: String },
    /// No block, or nothing usable in it. `raw` is the whole message.
    Raw { raw: String },
}

/// One entry under `changed:`.
///
/// The design sets the path in monospace and the note in body text, so they are
/// split here rather than in the panel.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "model", derive(serde::Serialize, serde::Deserialize))]
pub struct Changed {
    pub path: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "model", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "model", serde(rename_all = "camelCase"))]
pub struct Summary {
    pub done: Option<String>,
    pub changed: Vec<Changed>,
    /// Whatever the agent *says* it checked. Never rendered as something
    /// Muninn observed — see `docs/design-principles.md` §5.
    pub verified: Option<String>,
    pub next: Option<String>,
    pub blocked: Option<String>,
    pub risk: Option<String>,
    /// The agent explaining what it did and why, at length, for someone who
    /// wants to follow the work rather than only know it finished.
    ///
    /// Never shown on the panel — design principle §2 gives the first screen to
    /// the outcome. This is what the details window is for. Markdown, and
    /// usually several paragraphs, so it is the one field written as a `|`
    /// block and kept verbatim.
    pub explain: Option<String>,
    /// Keys we do not recognise, kept in order. Dropping them would lose text
    /// that has already been stripped out of `raw`, which is the one way this
    /// parser could silently swallow something the user needed to see.
    pub extra: Vec<(String, String)>,
}

impl Summary {
    /// The sentence that takes the headline slot.
    ///
    /// `blocked` outranks `done`: it is the only field that requires the user to
    /// act, so it escalates by position rather than by decoration.
    pub fn headline(&self) -> Option<&str> {
        self.blocked.as_deref().or(self.done.as_deref())
    }

    fn is_empty(&self) -> bool {
        self.done.is_none()
            && self.changed.is_empty()
            && self.verified.is_none()
            && self.next.is_none()
            && self.blocked.is_none()
            && self.risk.is_none()
            && self.explain.is_none()
            && self.extra.is_empty()
    }
}

impl fmt::Display for Changed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (&self.path, self.note.is_empty()) {
            (Some(p), true) => write!(f, "{p}"),
            (Some(p), false) => write!(f, "{p} — {}", self.note),
            (None, _) => write!(f, "{}", self.note),
        }
    }
}

/// Parse an agent's closing message.
pub fn parse(message: &str) -> Body {
    let raw_all = message.trim().to_string();

    let Some(block) = last_muninn_block(message) else {
        return Body::Raw { raw: raw_all };
    };

    let summary = parse_block(&message[block.body.clone()]);
    if summary.is_empty() {
        // A fence we could not get anything out of is not a reason to show an
        // empty panel. Fall back to the whole message, fence included — if we
        // stripped it the user would lose text we failed to understand.
        return Body::Raw { raw: raw_all };
    }

    let mut raw = String::with_capacity(message.len());
    raw.push_str(&message[..block.outer.start]);
    raw.push_str(&message[block.outer.end..]);

    Body::Structured { summary, raw: raw.trim().to_string() }
}

struct Block {
    /// The whole fence including its delimiter lines, for stripping.
    outer: std::ops::Range<usize>,
    /// Just the content between the delimiters, for parsing.
    body: std::ops::Range<usize>,
}

/// Find the **last** ```` ```muninn ```` fence (contract rule 1).
///
/// Fences are consumed in order, so a fence opened inside another fence's body
/// is content rather than a new block — an agent quoting an example does not
/// get misread as closing one.
fn last_muninn_block(message: &str) -> Option<Block> {
    let mut found: Option<Block> = None;
    let mut offset = 0usize;

    while offset < message.len() {
        let (line, next) = line_at(message, offset);
        let Some(ticks) = fence_open(line) else {
            offset = next;
            continue;
        };

        // Walk to the closing delimiter, or to the end of the message if the
        // agent was cut off mid-block — recovering a truncated block beats
        // discarding what it did manage to write.
        let body_start = next;
        let mut cursor = next;
        let mut body_end = message.len();
        let mut outer_end = message.len();
        while cursor < message.len() {
            let (l, n) = line_at(message, cursor);
            if fence_close(l, ticks) {
                body_end = cursor;
                outer_end = n;
                break;
            }
            cursor = n;
        }

        found = Some(Block { outer: offset..outer_end, body: body_start..body_end });
        offset = outer_end;
    }

    found
}

/// Byte range of the line starting at `from`, and the offset of the next line.
fn line_at(s: &str, from: usize) -> (&str, usize) {
    match s[from..].find('\n') {
        Some(i) => (s[from..from + i].trim_end_matches('\r'), from + i + 1),
        None => (&s[from..], s.len()),
    }
}

/// ````muninn` with any indent, three or more backticks. Returns the count.
fn fence_open(line: &str) -> Option<usize> {
    let t = line.trim();
    let ticks = t.chars().take_while(|&c| c == '`').count();
    if ticks < 3 {
        return None;
    }
    let tag = t[ticks..].trim();
    // Case-insensitive: an agent writing ```Muninn meant the same thing.
    tag.eq_ignore_ascii_case("muninn").then_some(ticks)
}

/// A bare run of at least `ticks` backticks and nothing else.
fn fence_close(line: &str, ticks: usize) -> bool {
    let t = line.trim();
    let n = t.chars().take_while(|&c| c == '`').count();
    n >= ticks && t[n..].trim().is_empty()
}

#[derive(Default)]
struct Field {
    scalar: Vec<String>,
    list: Vec<String>,
    /// Set when the field was written as `key: |` — kept exactly as authored.
    literal: Option<String>,
}

fn parse_block(block: &str) -> Summary {
    let mut fields: Vec<(String, Field)> = Vec::new();
    let mut base_indent: Option<usize> = None;

    let lines: Vec<&str> = block.lines().map(|l| l.trim_end_matches('\r')).collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        i += 1;

        if line.trim().is_empty() {
            continue;
        }
        let indent = line.len() - line.trim_start().len();

        // A key must sit at the block's outermost indentation. Anything further
        // in is continuation text, which is what keeps a wrapped sentence like
        // "Wire the limiter: it is unbounded" from being read as a new key.
        let is_key = base_indent.map_or(true, |b| indent <= b);
        if is_key {
            if let Some((k, v)) = split_key(line.trim()) {
                base_indent.get_or_insert(indent);
                let mut f = Field::default();

                // `key: |` — everything indented under it is taken verbatim.
                //
                // Needed because `explain` is several paragraphs of prose, and
                // the ordinary rule joins wrapped lines with a space. That is
                // right for a one-line field and destroys a piece of writing:
                // its blank lines, its lists and its code fences all collapse
                // into one run-on paragraph.
                if matches!(v.trim_end_matches('-'), "|" | ">") {
                    let (text, next) = literal_block(&lines, i, indent);
                    f.literal = Some(text);
                    i = next;
                } else if !v.is_empty() {
                    f.scalar.push(v.to_string());
                }

                fields.push((k.to_ascii_lowercase(), f));
                continue;
            }
        }

        let Some((_, field)) = fields.last_mut() else {
            continue; // text before the first key: nothing to attach it to
        };

        let t = line.trim();
        if let Some(item) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")) {
            field.list.push(item.trim().to_string());
        } else if t == "-" || t == "*" {
            // an empty bullet; nothing to record
        } else {
            // Wrapped prose. Agents wrap; joining with a space is what the
            // author meant, and it is what the panel needs to render one
            // sentence rather than two ragged ones.
            field.scalar.push(t.to_string());
        }
    }

    assemble(fields)
}

/// Take every line indented past `key_indent`, verbatim, dedented as a group.
///
/// Dedenting by the block's own smallest indent rather than by a fixed amount
/// keeps relative indentation intact — which is what makes nested lists and
/// fenced code inside an explanation survive the trip.
fn literal_block(lines: &[&str], from: usize, key_indent: usize) -> (String, usize) {
    let mut end = from;
    while end < lines.len() {
        let line = lines[end];
        let indent = line.len() - line.trim_start().len();
        if !line.trim().is_empty() && indent <= key_indent {
            break;
        }
        end += 1;
    }

    let body = &lines[from..end];
    let dedent = body
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);

    let text = body
        .iter()
        .map(|l| if l.len() >= dedent { &l[dedent..] } else { l.trim_start() })
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .to_string();

    (text, end)
}

/// `key: rest` where the key has no spaces in it.
fn split_key(line: &str) -> Option<(&str, &str)> {
    let colon = line.find(':')?;
    let key = &line[..colon];
    if key.is_empty()
        || !key.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some((key, line[colon + 1..].trim()))
}

fn assemble(fields: Vec<(String, Field)>) -> Summary {
    let mut s = Summary::default();

    for (key, field) in fields {
        // A field given as a list where we expect a sentence still has to
        // render, so it collapses rather than being dropped.
        let scalar = || {
            if let Some(text) = &field.literal {
                return (!text.trim().is_empty()).then(|| text.clone());
            }
            let mut parts = field.scalar.clone();
            parts.extend(field.list.iter().cloned());
            let joined = parts.join(" ").trim().to_string();
            (!joined.is_empty()).then_some(joined)
        };

        match key.as_str() {
            "done" => s.done = scalar(),
            "verified" => s.verified = scalar(),
            "next" => s.next = scalar(),
            "blocked" => s.blocked = scalar(),
            "risk" => s.risk = scalar(),
            // Verbatim if it was written as a block; otherwise fall back to the
            // ordinary joined form, so an agent that writes it inline still
            // gets something readable rather than nothing.
            "explain" | "why" | "explanation" => {
                s.explain = field.literal.clone().or_else(scalar)
            }
            "changed" => {
                let mut items: Vec<&String> = field.scalar.iter().collect();
                items.extend(field.list.iter());
                s.changed = items.iter().map(|i| split_changed(i)).collect();
            }
            _ => {
                if let Some(v) = scalar() {
                    s.extra.push((key, v));
                }
            }
        }
    }

    s
}

/// `path — why it changed`, in any of the dashes an agent might reach for.
fn split_changed(item: &str) -> Changed {
    const SEPS: [&str; 4] = [" — ", " – ", " -- ", " - "];
    for sep in SEPS {
        if let Some((path, note)) = item.split_once(sep) {
            return Changed {
                path: Some(path.trim().to_string()),
                note: note.trim().to_string(),
            };
        }
    }

    // No separator. A bare token with a slash or a dot and no spaces is a path;
    // anything else is the agent describing an area rather than naming a file.
    let t = item.trim();
    let looks_like_path =
        !t.contains(char::is_whitespace) && (t.contains('/') || t.contains('.'));
    if looks_like_path {
        Changed { path: Some(t.to_string()), note: String::new() }
    } else {
        Changed { path: None, note: t.to_string() }
    }
}
