//! The summary parser against the shapes real agents actually produce.
//!
//! Most of these are failure cases, deliberately. ADR-0004 is explicit that the
//! fallback path is not optional — many turns will not carry a block, and a
//! panel that renders nothing in that case is broken. So the question these
//! tests answer is less "does it parse" than "does anything at all make it
//! return an empty panel".

use muninn_core::{parse, Body, Summary};

fn structured(message: &str) -> (Summary, String) {
    match parse(message) {
        Body::Structured { summary, raw } => (summary, raw),
        Body::Raw { raw } => panic!("expected a structured parse, got raw: {raw:?}"),
    }
}

fn raw(message: &str) -> String {
    match parse(message) {
        Body::Raw { raw } => raw,
        Body::Structured { summary, .. } => {
            panic!("expected the raw fallback, got a summary: {summary:?}")
        }
    }
}

const FULL: &str = r#"Here is what I did.

```muninn
done: Added phone-number verification to the signup flow and got the suite green.
changed:
  - apps/api/src/auth/verify.ts — new OTP issue/verify endpoints
  - apps/web/app/signup/page.tsx — phone step before email step
verified: 34 tests pass; manually sent an OTP to a real number and it arrived
next: Wire the rate limiter — currently unbounded, so the endpoint is abusable
blocked: Need a Twilio production key; the sandbox only sends to verified numbers
```"#;

#[test]
fn parses_the_contract_example() {
    let (s, _) = structured(FULL);
    assert_eq!(
        s.done.as_deref(),
        Some("Added phone-number verification to the signup flow and got the suite green.")
    );
    assert_eq!(s.changed.len(), 2);
    assert_eq!(s.changed[0].path.as_deref(), Some("apps/api/src/auth/verify.ts"));
    assert_eq!(s.changed[0].note, "new OTP issue/verify endpoints");
    assert!(s.verified.as_deref().unwrap().starts_with("34 tests pass"));
    assert!(s.next.is_some());
    assert!(s.blocked.is_some());
}

#[test]
fn blocked_outranks_done_for_the_headline() {
    // Design principle §2: blocked is the only field that requires the user to
    // act, so it takes the headline slot and done moves one notch down.
    let (s, _) = structured(FULL);
    assert_eq!(s.headline(), s.blocked.as_deref());
}

#[test]
fn the_fence_is_stripped_from_raw() {
    // Contract rule 4 — the panel must never show both the parsed fields and
    // the block they came from.
    let (_, raw) = structured(FULL);
    assert_eq!(raw, "Here is what I did.");
    assert!(!raw.contains("```"));
    assert!(!raw.contains("done:"));
}

#[test]
fn takes_the_last_block_when_there_are_several() {
    // Contract rule 1. An agent that revises itself mid-message means the
    // later block, not the earlier one.
    let msg = "```muninn\ndone: first attempt\n```\n\nOn reflection:\n\n```muninn\ndone: second attempt\n```";
    let (s, _) = structured(msg);
    assert_eq!(s.done.as_deref(), Some("second attempt"));
}

#[test]
fn a_fence_inside_a_block_is_content_not_a_new_block() {
    // The agent is describing the contract itself. The inner opener sits in the
    // first block's body, so it must not be mistaken for a second block.
    let msg = "```muninn\ndone: Documented the format\nnext: Explain ```muninn to users\n```";
    let (s, _) = structured(msg);
    assert_eq!(s.done.as_deref(), Some("Documented the format"));
}

#[test]
fn recovers_a_block_that_was_never_closed() {
    // Truncated output. What the agent managed to write beats discarding it.
    let msg = "```muninn\ndone: Got halfway\nnext: Finish the migration";
    let (s, _) = structured(msg);
    assert_eq!(s.done.as_deref(), Some("Got halfway"));
    assert_eq!(s.next.as_deref(), Some("Finish the migration"));
}

#[test]
fn wrapped_prose_rejoins_into_one_sentence() {
    // Agents wrap. The panel needs one sentence, not two ragged ones.
    let msg = "```muninn\ndone: Rewrote the exporter to stream rows\n  instead of buffering the whole table\n```";
    let (s, _) = structured(msg);
    assert_eq!(
        s.done.as_deref(),
        Some("Rewrote the exporter to stream rows instead of buffering the whole table")
    );
}

#[test]
fn a_colon_in_wrapped_prose_is_not_read_as_a_key() {
    // The failure this guards against: "limiter: currently unbounded" silently
    // becoming a field and vanishing from the sentence the user reads.
    let msg = "```muninn\nnext: Wire the rate limiter\n  the endpoint: currently unbounded, so it is abusable\n```";
    let (s, _) = structured(msg);
    assert_eq!(
        s.next.as_deref(),
        Some("Wire the rate limiter the endpoint: currently unbounded, so it is abusable")
    );
    assert!(s.extra.is_empty());
}

#[test]
fn handles_crlf() {
    let msg = "```muninn\r\ndone: Windows line endings\r\nnext: Keep going\r\n```\r\n";
    let (s, _) = structured(msg);
    assert_eq!(s.done.as_deref(), Some("Windows line endings"));
    assert_eq!(s.next.as_deref(), Some("Keep going"));
}

#[test]
fn accepts_more_than_three_backticks_and_odd_casing() {
    let msg = "````Muninn\ndone: Still a block\n````";
    let (s, _) = structured(msg);
    assert_eq!(s.done.as_deref(), Some("Still a block"));
}

#[test]
fn changed_entries_survive_every_dash_an_agent_might_reach_for() {
    let msg = "```muninn\ndone: x\nchanged:\n  - a.ts — em dash\n  - b.ts – en dash\n  - c.ts -- double hyphen\n  - d.ts - single hyphen\n```";
    let (s, _) = structured(msg);
    let paths: Vec<_> = s.changed.iter().map(|c| c.path.as_deref().unwrap()).collect();
    assert_eq!(paths, ["a.ts", "b.ts", "c.ts", "d.ts"]);
    assert!(s.changed.iter().all(|c| !c.note.is_empty()));
}

#[test]
fn a_bare_path_keeps_its_monospace_slot_but_a_phrase_does_not() {
    // The design sets path in mono and note in body. "the auth module" is not a
    // path and setting it in mono would read as a filename that does not exist.
    let msg = "```muninn\ndone: x\nchanged:\n  - src/auth/verify.ts\n  - the auth module generally\n```";
    let (s, _) = structured(msg);
    assert_eq!(s.changed[0].path.as_deref(), Some("src/auth/verify.ts"));
    assert_eq!(s.changed[0].note, "");
    assert_eq!(s.changed[1].path, None);
    assert_eq!(s.changed[1].note, "the auth module generally");
}

#[test]
fn a_field_written_as_a_list_still_renders() {
    // The contract says `verified` is a sentence. An agent giving a list is not
    // a reason to drop the field.
    let msg = "```muninn\ndone: x\nverified:\n  - 34 tests pass\n  - sent a real OTP\n```";
    let (s, _) = structured(msg);
    assert_eq!(s.verified.as_deref(), Some("34 tests pass sent a real OTP"));
}

#[test]
fn unknown_keys_are_kept_rather_than_swallowed() {
    // They have already been stripped out of raw, so dropping them here is the
    // one way this parser could lose text the user needed.
    let msg = "```muninn\ndone: x\nfollowup: ask design about the empty state\n```";
    let (s, _) = structured(msg);
    assert_eq!(
        s.extra,
        vec![("followup".to_string(), "ask design about the empty state".to_string())]
    );
}

// ---------------------------------------------------------------------------
// Everything below must reach the raw fallback rather than an empty panel.
// ---------------------------------------------------------------------------

#[test]
fn no_block_at_all_falls_back() {
    let msg = "I refactored the exporter. Memory stays flat now.";
    assert_eq!(raw(msg), msg);
}

#[test]
fn an_empty_block_falls_back_to_the_whole_message_fence_included() {
    // If we stripped a fence we could not understand, the user would lose text
    // and be shown nothing in its place.
    let msg = "Some prose.\n\n```muninn\n```";
    let out = raw(msg);
    assert!(out.contains("Some prose."));
    assert!(out.contains("```muninn"));
}

#[test]
fn a_block_of_junk_falls_back() {
    let msg = "Prose.\n\n```muninn\n!!! not remotely yaml !!!\n<<<>>>\n```";
    assert!(raw(msg).contains("!!! not remotely yaml !!!"));
}

#[test]
fn empty_input_does_not_panic() {
    assert_eq!(raw(""), "");
    assert_eq!(raw("   \n\n  "), "");
}

#[test]
fn a_lone_unterminated_fence_marker_falls_back() {
    assert!(raw("```muninn").contains("```muninn"));
}

#[test]
fn other_languages_are_left_alone() {
    let msg = "Done.\n\n```json\n{\"done\": \"not ours\"}\n```";
    assert_eq!(raw(msg), msg);
}

#[test]
fn a_done_only_block_is_enough() {
    // `done` is the only required field. One sentence is a complete panel.
    let (s, raw) = structured("```muninn\ndone: Bumped the dependency\n```");
    assert_eq!(s.headline(), Some("Bumped the dependency"));
    assert_eq!(raw, "");
}

#[test]
fn a_blocked_only_block_is_enough() {
    // No `done`, but the user still has to act, so this must not fall back to
    // rendering the fence as prose.
    let (s, _) = structured("```muninn\nblocked: Need the Twilio key\n```");
    assert_eq!(s.headline(), Some("Need the Twilio key"));
}

#[test]
fn absurd_input_terminates() {
    // Guards the fence scanner against a pathological message pinning the CPU
    // in the app's event path.
    let msg = "```muninn\n".repeat(5_000);
    let _ = parse(&msg);

    let nested = format!("```muninn\ndone: {}\n```", "`".repeat(10_000));
    let _ = parse(&nested);
}

// ---------------------------------------------------------------------------
// `explain` — the long-form account the details window is built around.
// ---------------------------------------------------------------------------

#[test]
fn explain_keeps_its_paragraphs() {
    // The ordinary rule joins wrapped lines with a space, which is right for a
    // one-line field and would turn a piece of writing into one run-on
    // paragraph. A `|` block is kept exactly as authored.
    let msg = "```muninn\n\
        done: Added phone verification\n\
        explain: |\n\
        \x20 The signup flow used to take an email and trust it.\n\
        \n\
        \x20 Now it issues a six-digit code first. Two pieces:\n\
        \n\
        \x20 - `verify.ts` holds the codes\n\
        \x20 - the signup page asks for the phone before the password\n\
        next: Wire the limiter\n\
        ```";
    let (s, _) = structured(msg);

    let explain = s.explain.expect("explain should parse");
    assert!(explain.contains("\n\n"), "blank lines must survive: {explain:?}");
    assert!(explain.contains("- `verify.ts` holds the codes"));
    // The fields around it still parse as themselves.
    assert_eq!(s.done.as_deref(), Some("Added phone verification"));
    assert_eq!(s.next.as_deref(), Some("Wire the limiter"));
}

#[test]
fn explain_keeps_relative_indentation() {
    // Dedented as a group, so nested lists and fenced code inside the
    // explanation survive rather than being flattened to the left margin.
    let msg = "```muninn\n\
        explain: |\n\
        \x20   Top level.\n\
        \x20     Indented under it.\n\
        ```";
    let (s, _) = structured(msg);
    let explain = s.explain.unwrap();
    assert!(explain.starts_with("Top level."), "{explain:?}");
    assert!(explain.contains("\n  Indented under it."), "{explain:?}");
}

#[test]
fn explain_written_inline_still_works() {
    // An agent that ignores the block form should not lose the field.
    let (s, _) = structured("```muninn\nexplain: It swapped the OTP store for Redis.\n```");
    assert_eq!(s.explain.as_deref(), Some("It swapped the OTP store for Redis."));
}

#[test]
fn explain_accepts_the_names_an_agent_might_reach_for() {
    for key in ["explain", "why", "explanation"] {
        let (s, _) = structured(&format!("```muninn\n{key}: Because the sandbox only sends to verified numbers.\n```"));
        assert!(s.explain.is_some(), "{key} should map to explain");
    }
}

#[test]
fn a_block_scalar_does_not_swallow_the_fields_after_it() {
    // The block ends at the first line back at the key's own indentation.
    let msg = "```muninn\n\
        explain: |\n\
        \x20 One.\n\
        \x20 Two.\n\
        done: Still parsed\n\
        risk: So is this\n\
        ```";
    let (s, _) = structured(msg);
    assert_eq!(s.done.as_deref(), Some("Still parsed"));
    assert_eq!(s.risk.as_deref(), Some("So is this"));
    assert_eq!(s.explain.as_deref(), Some("One.\nTwo."));
}

#[test]
fn an_explain_only_block_is_enough() {
    let (s, _) = structured("```muninn\nexplain: |\n  It rewrote the exporter.\n```");
    assert!(s.explain.is_some());
}
