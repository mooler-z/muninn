//! Markdown for the raw-fallback path.
//!
//! The text being rendered is whatever the agent happened to write, and it ends
//! up inside the panel's DOM. That makes it untrusted input in the only sense
//! that matters here: nobody is attacking the user through their own agent, but
//! a stray `<script>` or a malformed tag in a code sample should not be able to
//! break or rewrite the panel.
//!
//! Rather than render everything and sanitise afterwards — which is what pulls
//! in an html5ever-sized dependency — raw HTML events are dropped before they
//! are ever rendered. pulldown-cmark escapes all remaining text itself, so what
//! comes out contains only the tags this module chose to emit.

use pulldown_cmark::{html, Event, Options, Parser, Tag, TagEnd};

pub fn render(source: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);

    // Links and images are the two places a URL reaches the document. Both are
    // handled by dropping the surrounding tag and keeping the text inside it,
    // so nothing the agent wrote disappears — it just stops being clickable.
    let mut in_unsafe_link = false;
    let mut in_image = false;

    let events = Parser::new_ext(source, options).filter(|event| match event {
        // Raw HTML in any position. Dropping it means an agent that writes
        // `<b>` gets literal-looking output rather than bold, which is a fair
        // trade for the panel being unable to execute anything.
        Event::Html(_) | Event::InlineHtml(_) => false,

        Event::Start(Tag::Link { dest_url, .. }) => {
            in_unsafe_link = !is_safe_url(dest_url);
            !in_unsafe_link
        }
        Event::End(TagEnd::Link) if in_unsafe_link => {
            in_unsafe_link = false;
            false
        }

        // Images are dropped wholesale. The content security policy would block
        // remote ones anyway, and a full-width image in a 372px panel is not
        // something the design has a place for. The alt text survives.
        Event::Start(Tag::Image { .. }) => {
            in_image = true;
            false
        }
        Event::End(TagEnd::Image) if in_image => {
            in_image = false;
            false
        }

        _ => true,
    });

    let mut out = String::with_capacity(source.len() + source.len() / 4);
    html::push_html(&mut out, events);
    out
}

/// Whether a URL may be used as an `href`.
///
/// An allowlist rather than a blocklist: `javascript:` is the obvious one, but
/// `data:`, `vbscript:` and `file:` are all reachable from a webview too, and
/// the set of schemes worth refusing is open-ended while the set worth allowing
/// is three long.
fn is_safe_url(url: &str) -> bool {
    // Browsers strip whitespace and control characters before resolving a URL,
    // so `java\nscript:` is a live scheme to them. Normalise the same way
    // before looking at it, or the check reads a different string than the
    // webview will.
    let normalised: String =
        url.chars().filter(|c| !c.is_whitespace() && !c.is_control()).collect();

    let Some(colon) = normalised.find(':') else {
        // No scheme at all: relative link, or a bare `#anchor`.
        return true;
    };

    // A colon further into a path is not a scheme separator — `./notes:2` is a
    // relative path, not a `./notes` protocol.
    let candidate = &normalised[..colon];
    if candidate.contains(['/', '?', '#']) {
        return true;
    }

    matches!(candidate.to_ascii_lowercase().as_str(), "http" | "https" | "mailto")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_ordinary_markdown() {
        let out = render("Switched to **streaming**.\n\n- one\n- two");
        assert!(out.contains("<strong>streaming</strong>"));
        assert!(out.contains("<li>one</li>"));
    }

    #[test]
    fn keeps_code_spans_which_the_design_sets_in_monospace() {
        let out = render("behind `EXPORT_STREAMING=0`");
        assert!(out.contains("<code>EXPORT_STREAMING=0</code>"));
    }

    #[test]
    fn drops_raw_html_entirely() {
        let out = render("before\n\n<script>alert(1)</script>\n\nafter");
        assert!(!out.contains("<script"));
        assert!(out.contains("before"));
        assert!(out.contains("after"));
    }

    #[test]
    fn drops_inline_html_too() {
        let out = render("an <img src=x onerror=alert(1)> image");
        assert!(!out.contains("<img"));
        assert!(!out.contains("onerror"));
    }

    #[test]
    fn escapes_text_that_looks_like_markup() {
        // A code sample mentioning a tag must survive as text.
        let out = render("use the `<div>` element");
        assert!(out.contains("&lt;div&gt;"));
    }

    #[test]
    fn executable_urls_do_not_survive_as_links() {
        // The agent's closing message is arbitrary text and it lands in the
        // panel's DOM. A link it can persuade the user to click must not be
        // able to run anything.
        for source in [
            "[click](javascript:alert(1))",
            "[click](JaVaScRiPt:alert(1))",
            "[click](java\nscript:alert(1))",
            "[click](data:text/html,<script>alert(1)</script>)",
            "[click](vbscript:msgbox)",
            "[click](file:///etc/passwd)",
        ] {
            let out = render(source);
            assert!(!out.contains("<a "), "{source} produced a link: {out}");
            // The words survive; only the anchor is gone.
            assert!(out.contains("click"), "{source} lost its text: {out}");
        }
    }

    #[test]
    fn ordinary_links_still_work() {
        for source in [
            "[docs](https://example.com/x)",
            "[docs](http://example.com)",
            "[mail](mailto:someone@example.com)",
            "[relative](./notes.md)",
            "[anchor](#section)",
        ] {
            assert!(render(source).contains("<a href="), "{source} lost its link");
        }
    }

    #[test]
    fn a_path_containing_a_colon_is_not_mistaken_for_a_scheme() {
        assert!(render("[log](./run:2/output.txt)").contains("<a href="));
    }

    #[test]
    fn images_are_dropped_but_their_alt_text_is_kept() {
        let out = render("![a diagram](https://example.com/x.png)");
        assert!(!out.contains("<img"), "got {out}");
        assert!(out.contains("a diagram"), "got {out}");
    }

    #[test]
    fn empty_input_is_empty_output() {
        assert_eq!(render("").trim(), "");
    }
}
