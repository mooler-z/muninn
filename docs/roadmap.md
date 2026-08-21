# Roadmap

Ordered by what de-risks the most, earliest. Each milestone should be usable by
the author before the next begins.

## M0 — Prove the payload (half a day)

No UI. A shell script registered as the `Stop` hook that appends the JSON to a
file. Run real sessions for a day.

**Answers:** Is `last_assistant_message` always populated? How long are real
closing messages? How often does a turn end in a way that produces nothing worth
showing? Does the hook add perceptible latency?

**Kill criterion:** if `last_assistant_message` is frequently empty or useless,
the whole architecture is wrong and ADR-0002 needs revisiting before any code.

## M1 — Ugliest possible panel

Shim + receiver + a window that renders the raw message as markdown, plus the
sound. No parsing, no history, no menu bar.

**Answers:** Is reading a summary in a window actually nicer than glancing at the
terminal? This is the product hypothesis; everything after it is polish.

## M2 — The summary contract

Add the `muninn` block to the author's `CLAUDE.md`, implement the parser and the
structured layout, keep the raw fallback.

**Answers:** Does the agent comply reliably? How bad is the unstructured case?

## M3 — Liveable

Menu bar item, mute, silent hours, queueing for simultaneous finishes, history
of the last N, spool-and-drain when the app is closed. The `needs-input` event
with its own quieter sound.

At this point the author uses it daily and stops thinking about it.

## M4 — Installable by someone else

Signed and notarised macOS build. An installer that merges the hook into
`settings.json` without destroying existing hooks, and offers to append the
prompt fragment. Uninstall that cleanly reverses both.

## M5 — Second agent

Codex, once `docs/integrations/codex.md` is verified. This is the first real
test of the normaliser.

## Later, unscheduled

- Linux
- Windows
- Per-project rules (notify for this repo, stay silent for that one)
- Optional phone push for long-running work, reusing the same summary
- Reading `transcript_path` after the fact to enrich the panel

## Explicitly not planned

Replying to the agent · cloud sync · accounts · usage and cost tracking ·
team features · analytics.
